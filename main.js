const { app, BrowserWindow, nativeTheme, shell } = require('electron')
const path = require('path')
const allowed = require('./allow')

nativeTheme.themeSource = 'dark' // Instagram follows prefers-color-scheme
// Instagram turns away unknown browsers, so present as plain Chrome
app.userAgentFallback = app.userAgentFallback
  .replace(/Gecko\) .*?Chrome/, 'Gecko) Chrome')
  .replace(/ Electron\/\S+/, '')

const openExternal = (url) => {
  if (/^https?:/.test(url)) shell.openExternal(url)
}

app.on('web-contents-created', (_, wc) => {
  if (wc.getType() !== 'webview') return
  wc.setWindowOpenHandler(({ url }) => {
    openExternal(url)
    return { action: 'deny' }
  })
  // The editor has no address bar, so the page itself must never leave Instagram.
  // Iframes (captcha, Meta sign-in checks) are left alone or login breaks.
  const guard = (e) => {
    if (!e.isMainFrame || allowed(e.url)) return
    e.preventDefault()
    openExternal(e.url)
  }
  wc.on('will-navigate', guard)
  wc.on('will-redirect', guard)
})

app.whenReady().then(() => {
  if (!app.isPackaged) app.dock?.setIcon(path.join(__dirname, 'build/icon.png'))
  new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 720,
    minHeight: 400,
    backgroundColor: '#1f1f1f',
    // Our own title bar on every OS: macOS keeps its traffic lights, Windows/Linux get the
    // native minimise/maximise/close buttons drawn over its right end.
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 12, y: 11 },
    titleBarOverlay: process.platform !== 'darwin' && { color: '#181818', symbolColor: '#cccccc', height: 35 },
    autoHideMenuBar: true,
    webPreferences: { webviewTag: true },
  }).loadFile(path.join(__dirname, 'index.html'))
})

app.on('window-all-closed', () => app.quit())
