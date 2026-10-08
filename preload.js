const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('electron', {
  openURL:        (url,h) => ipcRenderer.invoke('open-url',      url, h),
  closeView:      ()      => ipcRenderer.invoke('close-view'),
  navBack:        ()      => ipcRenderer.invoke('nav-back'),
  navForward:     ()      => ipcRenderer.invoke('nav-forward'),
  navReload:      ()      => ipcRenderer.invoke('nav-reload'),
  navGoto:        (url)   => ipcRenderer.invoke('nav-goto',      url),
  setTopbar:      (h)     => ipcRenderer.invoke('set-topbar',    h),
  openExternal:   (url)   => ipcRenderer.invoke('open-external', url),
  confirmSignin:  ()      => ipcRenderer.invoke('confirm-signin'),
  startGoogleAuth: ()     => ipcRenderer.invoke('google-auth-start'),
  onGoogleAuthResult: (fn) => ipcRenderer.once('google-auth-result', (_, data) => fn(data)),
  onNavUrl:       (fn)    => ipcRenderer.on('nav-url',  (_,u) => fn(u)),
  onNavLoad:      (fn)    => ipcRenderer.on('nav-load', (_,b) => fn(b)),
  onSigninStarted:  (fn)  => ipcRenderer.on('google-signin-started',  () => fn()),
  onSigninComplete: (fn)  => ipcRenderer.on('google-signin-complete', () => fn()),
})
