const { app, BrowserWindow, BrowserView, ipcMain, shell, session, dialog } = require('electron')
const path   = require('path')
const os     = require('os')
const fs     = require('fs')
const http   = require('http')
const crypto = require('crypto')

// ── HTML escape helper (prevent XSS in error pages) ───────────────────────────
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// ── App tier classification (mirrors backend src/routes/apps.ts) ─────────────
// Tier 1: real OAuth + refresh tokens -> CLYX reconnects it silently via the
//         backend the moment the user logs into CLYX. No re-login, ever.
// Tier 2/3: no full-account OAuth available -> CLYX opens the app in the
//         user's real system browser so a completely normal login happens.
//         We never try to embed or auto-fill these; the user signs in once
//         per device, the same way they would with any other website.
const TIER1_APPS = new Set([
  'gmail','gdrive','spotify','twitch','discord','reddit',
  'github','figma','notion','slack','trello','dropbox'
])
function tierFor(appId) { return TIER1_APPS.has(appId) ? 1 : 3 }

// ── Load config (Google Client ID, etc.) ──────────────────────────────────────
function loadConfig() {
  const configPath = path.join(__dirname, 'config.json')

  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'))
    }
  } catch (e) {
    console.error('Failed to load config.json:', e.message)
  }
  return {}
}
const APP_CONFIG = loadConfig()

let win      = null
let view     = null
let TOPBAR_H = 96

const SESSION = 'persist:clyx_apps'

// Google sign-in URL patterns — used only to detect that an embedded page is
// asking for Google login, so we can hand that off to the real system browser
// instead of trying to complete it inside CLYX.
const GOOGLE_SIGNIN_PATTERNS = [
  'accounts.google.com/v3/signin',
  'accounts.google.com/o/oauth2',
  'accounts.google.com/signin',
  'accounts.google.com/ServiceLogin',
  'accounts.google.com/AccountChooser',
  'accounts.google.com/AddSession',
  'accounts.google.com/CheckCookie',
  'accounts.google.com/embedded/setup',
]

function isGoogleSignInUrl(url) {
  return GOOGLE_SIGNIN_PATTERNS.some(pattern => url.includes(pattern))
}

function createWindow() {
  win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 900, minHeight: 600,
    backgroundColor: '#080808', autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false,
    }
  })
  win.loadFile('clyx.html')
  win.on('resize', () => fitView())
}

function fitView() {
  if (!view || !win) return
  const [w, h] = win.getContentSize()
  view.setBounds({ x: 0, y: TOPBAR_H, width: w, height: Math.max(0, h - TOPBAR_H) })
}

function openView(url, topbarH) {
  if (topbarH > 0) TOPBAR_H = topbarH
  closeView()

  view = new BrowserView({
    webPreferences: {
      preload:          path.join(__dirname, 'view-preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
      webSecurity:      true,
      partition:        SESSION,
    }
  })

  win.addBrowserView(view)
  fitView()

  // ── Google sign-in inside an embedded app ────────────────────────────────
  // We never try to complete Google auth inside the embedded view. Instead we
  // hand the URL to the user's real system browser, where sign-in works
  // normally with no impersonation involved.
  view.webContents.on('will-navigate', (event, navUrl) => {
    if (isGoogleSignInUrl(navUrl)) {
      event.preventDefault()
      shell.openExternal(navUrl)
    }
  })

  view.webContents.setWindowOpenHandler(({ url: u }) => {
    if (u.startsWith('mailto:') || u.startsWith('tel:')) {
      shell.openExternal(u)
      return { action: 'deny' }
    }
    if (isGoogleSignInUrl(u)) {
      shell.openExternal(u)
      return { action: 'deny' }
    }
    view.webContents.loadURL(u)
    return { action: 'deny' }
  })

  view.webContents.loadURL(url)

  view.webContents.on('did-navigate',         (_, u) => win?.webContents.send('nav-url',  u))
  view.webContents.on('did-navigate-in-page', (_, u) => win?.webContents.send('nav-url',  u))
  view.webContents.on('did-start-loading',    ()     => win?.webContents.send('nav-load', true))
  view.webContents.on('did-stop-loading',     ()     => win?.webContents.send('nav-load', false))
}

function closeView() {
  if (!view) return
  try { win?.removeBrowserView(view); view.webContents.destroy() } catch(e) {}
  view = null
}

// ── IPC ────────────────────────────────────────────────────────────────────────
ipcMain.handle('open-url',       (_, url, h) => { openView(url, h || TOPBAR_H); return 'ok' })
ipcMain.handle('close-view',     ()           => { closeView();                   return 'ok' })
ipcMain.handle('nav-back',       ()           => { view?.webContents.goBack();    return 'ok' })
ipcMain.handle('nav-forward',    ()           => { view?.webContents.goForward(); return 'ok' })
ipcMain.handle('nav-reload',     ()           => { view?.webContents.reload();    return 'ok' })
ipcMain.handle('nav-goto',       (_, url)     => { view?.webContents.loadURL(url); return 'ok' })
ipcMain.handle('set-topbar',     (_, h)       => { TOPBAR_H = h; fitView();        return 'ok' })
ipcMain.handle('open-external',  (_, url)     => { shell.openExternal(url);        return 'ok' })

// Called from the UI when the user finishes signing into an app that opened
// in the system browser (Tier 2/3 apps). Simply reload the embedded view so
// it can pick up whatever public state the site itself exposes — CLYX never
// injects or imports cookies from another browser.
ipcMain.handle('confirm-signin', async () => {
  win?.webContents.send('google-signin-complete')
  if (view) view.webContents.reload()
  return { ok: true }
})

// ── Google OAuth 2.0 Flow ─────────────────────────────────────────────────────
// Opens Google sign-in in the system browser with proper OAuth 2.0 client ID.
// A local HTTP server on port 17839 receives the callback with the auth code.
// The code is exchanged with the CLYX backend for JWT tokens.

// Load Google Client ID from config.json instead of hardcoding
const GOOGLE_CLIENT_ID    = APP_CONFIG.GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || ''
const OAUTH_CALLBACK_PORT = 17839
const OAUTH_REDIRECT_URI  = `http://localhost:${OAUTH_CALLBACK_PORT}/callback`
const BACKEND_URL         = APP_CONFIG.BACKEND_URL || 'http://localhost:4002/api'

let oauthServer = null

function buildSuccessPage() {
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>CLYX — Authenticated</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Outfit:wght@700;800&display=swap" rel="stylesheet">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{min-height:100vh;display:flex;align-items:center;justify-content:center;background:#080808;color:#fff;font-family:'Inter',sans-serif}
  .card{text-align:center;max-width:520px;padding:48px 40px}
  .logo{display:flex;align-items:center;justify-content:center;gap:10px;margin-bottom:32px}
  .logo svg{width:44px;height:44px}
  .logo span{font-family:'Outfit',sans-serif;font-size:28px;font-weight:800;letter-spacing:.06em}
  h1{font-family:'Outfit',sans-serif;font-size:28px;font-weight:700;margin-bottom:12px;color:#fff}
  p{font-size:14px;color:rgba(255,255,255,.5);line-height:1.6;margin-bottom:8px}
  .hint{font-size:12px;color:rgba(255,255,255,.25);margin-top:16px}
  .confetti{position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;overflow:hidden;z-index:0}
  .card{position:relative;z-index:1}
  .dot{position:absolute;width:6px;height:6px;border-radius:50%;animation:fall linear forwards}
  @keyframes fall{0%{opacity:1;transform:translateY(-20px) rotate(0deg)}100%{opacity:0;transform:translateY(100vh) rotate(720deg)}}
</style></head>
<body>
<div class="confetti" id="confetti"></div>
<div class="card">
  <div class="logo">
    <svg viewBox="0 0 100 100" fill="none"><defs><clipPath id="c"><circle cx="50" cy="50" r="44"/></clipPath></defs><g clip-path="url(#c)"><ellipse cx="50" cy="50" rx="38" ry="14" stroke="#f05a00" stroke-width="2" fill="none" opacity=".4"/><ellipse cx="50" cy="50" rx="38" ry="14" stroke="#f05a00" stroke-width="2" fill="none" opacity=".4" transform="rotate(60 50 50)"/><ellipse cx="50" cy="50" rx="38" ry="14" stroke="#f05a00" stroke-width="2" fill="none" opacity=".4" transform="rotate(120 50 50)"/><circle cx="50" cy="50" r="7" fill="#ff7530"/><circle cx="50" cy="50" r="2.5" fill="#fff" opacity=".4"/></g></svg>
    <span>CLYX</span>
  </div>
  <h1>You have successfully authenticated.</h1>
  <p>You should be redirected back to CLYX.<br>You can safely close this tab.</p>
  <p class="hint">Sessions are AES-256 encrypted and synced across all your devices.</p>
</div>
<script>
  const colors=['#f05a00','#ff7530','#3b82f6','#22c55e','#a855f7','#eab308','#ef4444'];
  const c=document.getElementById('confetti');
  for(let i=0;i<60;i++){const d=document.createElement('div');d.className='dot';d.style.left=Math.random()*100+'%';d.style.top='-10px';d.style.background=colors[Math.floor(Math.random()*colors.length)];d.style.animationDuration=(Math.random()*2+1.5)+'s';d.style.animationDelay=(Math.random()*1.5)+'s';d.style.width=d.style.height=(Math.random()*4+4)+'px';c.appendChild(d);}
</script>
</body></html>`
}

function buildErrorPage(error) {
  // HTML-escape the error to prevent XSS (M7 fix)
  const safeError = escapeHtml(error)
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>CLYX — Auth Error</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{min-height:100vh;display:flex;align-items:center;justify-content:center;background:#080808;color:#fff;font-family:system-ui,sans-serif}.card{text-align:center;max-width:420px;padding:48px 40px}h1{font-size:24px;margin-bottom:12px;color:#ef4444}p{font-size:14px;color:rgba(255,255,255,.5);line-height:1.6}</style></head>
<body><div class="card"><h1>Authentication Failed</h1><p>${safeError}</p><p style="margin-top:16px;font-size:12px;color:rgba(255,255,255,.25)">Please close this tab and try again in CLYX.</p></div></body></html>`
}

ipcMain.handle('google-auth-start', async (_, clientIdFromConfig) => {
  // Use provided client ID or fallback
  const clientId = clientIdFromConfig || GOOGLE_CLIENT_ID

  // Generate CSRF state parameter
  const state = crypto.randomBytes(16).toString('hex')

  // Close any existing OAuth server
  if (oauthServer) {
    try { oauthServer.close() } catch {}
    oauthServer = null
  }

  return new Promise((resolve) => {
    // ── Start local callback HTTP server ────────────────────────────────
    oauthServer = http.createServer(async (req, res) => {
      const url = new URL(req.url, `http://localhost:${OAUTH_CALLBACK_PORT}`)

      // Handle the OAuth callback
      if (url.pathname === '/callback') {
        const code       = url.searchParams.get('code')
        const retState   = url.searchParams.get('state')
        const error      = url.searchParams.get('error')

        if (error) {
          res.writeHead(200, { 'Content-Type': 'text/html' })
          res.end(buildErrorPage('Google sign-in was cancelled or denied.'))
          win?.webContents.send('google-auth-result', { success: false, error: 'User cancelled' })
          closeOAuthServer()
          return
        }

        if (!code || retState !== state) {
          res.writeHead(200, { 'Content-Type': 'text/html' })
          res.end(buildErrorPage('Invalid callback — possible CSRF. Please try again.'))
          win?.webContents.send('google-auth-result', { success: false, error: 'Invalid state' })
          closeOAuthServer()
          return
        }

        // Exchange the code with the CLYX backend
        try {
          const backendRes = await fetch(`${BACKEND_URL}/auth/google`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              code,
              redirectUri: OAUTH_REDIRECT_URI,
              deviceId:    undefined,
            }),
          })

          const data = await backendRes.json()

          if (data.success) {
            // Success! Serve the celebration page and notify renderer
            res.writeHead(200, { 'Content-Type': 'text/html' })
            res.end(buildSuccessPage())
            win?.webContents.send('google-auth-result', {
              success: true,
              user: data.user,
              accessToken:  data.accessToken,
              refreshToken: data.refreshToken,
              deviceId:     data.deviceId,
            })
          } else {
            res.writeHead(200, { 'Content-Type': 'text/html' })
            res.end(buildErrorPage(data.message || 'Authentication failed'))
            win?.webContents.send('google-auth-result', { success: false, error: data.message })
          }
        } catch (err) {
          res.writeHead(200, { 'Content-Type': 'text/html' })
          res.end(buildErrorPage('Cannot connect to CLYX backend. Make sure the backend server is running.'))
          win?.webContents.send('google-auth-result', {
            success: false,
            error: 'Backend not reachable — is clyx-ts-backend running?',
          })
        }

        closeOAuthServer()
        return
      }

      // Health check endpoint
      if (url.pathname === '/auth-complete') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
        return
      }

      // Unknown route
      res.writeHead(404)
      res.end('Not found')
    })

    oauthServer.listen(OAUTH_CALLBACK_PORT, '127.0.0.1', () => {
      // Build the Google OAuth authorization URL
      const params = new URLSearchParams({
        client_id:     clientId,
        redirect_uri:  OAUTH_REDIRECT_URI,
        response_type: 'code',
        scope:         'openid email profile',
        access_type:   'offline',
        prompt:        'select_account',
        state:         state,
      })

      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`

      // Open in the system browser (Chrome, Edge, Firefox — not Electron)
      shell.openExternal(authUrl)

      resolve('ok')
    })

    oauthServer.on('error', (err) => {
      console.error('OAuth server error:', err.message)
      win?.webContents.send('google-auth-result', {
        success: false,
        error: `Cannot start auth server: ${err.message}`,
      })
      resolve('error')
    })
  })
})

function closeOAuthServer() {
  if (oauthServer) {
    setTimeout(() => {
      try { oauthServer.close() } catch {}
      oauthServer = null
    }, 2000) // Keep alive briefly so the browser can finish loading the page
  }
}

app.whenReady().then(() => {
  createWindow()
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('activate', () => { if (!win) createWindow() })
