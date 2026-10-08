# CLYX — Your Digital Universe

## How to run

### Windows — double click START-WINDOWS.bat
That's it. It starts the proxy and opens CLYX.

### Mac / Linux
```
chmod +x start-mac-linux.sh
./start-mac-linux.sh
```

---

## How it works

CLYX runs a tiny local proxy server (`proxy.js`) alongside the app.
When you click **Open YouTube** (or any app), CLYX loads it through
the proxy — which strips the headers that normally block embedding.
YouTube, WhatsApp, Gmail — everything opens fully inside CLYX.

**You will need to log in to each app the first time** (sign in within
the embedded page). After that your browser saves the session cookies.

---

## Files

| File | Purpose |
|------|---------|
| `clyx.html` | The full CLYX app (UI, logic, styling) |
| `proxy.js` | Local proxy server — strips X-Frame-Options |
| `START-WINDOWS.bat` | Windows: starts proxy + opens CLYX |
| `start-mac-linux.sh` | Mac/Linux: starts proxy + opens CLYX |
| `package.json` | Electron config (for desktop build) |
| `main.js` | Electron main (for desktop build) |
| `preload.js` | Electron preload (for desktop build) |
