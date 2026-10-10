const { app, BrowserWindow, nativeTheme, shell } = require('electron')
const path = require('path')
const allowed = require('./allow')
const bridge = require('./bridge')

// One instance per profile: a second launch just brings this one's window up.
if (!app.requestSingleInstanceLock()) {
  app.quit()
  return
}

// The VS Code extension starts the app with --background: no window, no Dock icon, just the engine.
const background = process.argv.includes('--background')

nativeTheme.themeSource = 'dark' // Instagram follows prefers-color-scheme
// Instagram turns away unknown browsers, so present as plain Chrome
app.userAgentFallback = app.userAgentFallback
  .replace(/Gecko\) .*?Chrome/, 'Gecko) Chrome')
  .replace(/ Electron\/\S+/, '')

const openExternal = (url) => {
  if (/^https?:/.test(url)) shell.openExternal(url)
}

let win
let guest // the Instagram webview's webContents
let editors = 0 // VS Code windows connected through the bridge
let quitting = false
let idle

app.on('web-contents-created', (_, wc) => {
  if (wc.getType() !== 'webview') return
  guest = wc
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
  // Right after login Instagram asks "save your login info?". The session already lives in this
  // app's own profile, so answering is pointless: go straight on to the messages.
  const skipSavePrompt = (_, url) => {
    if (URL.canParse(url) && new URL(url).pathname.startsWith('/accounts/onetap')) wc.loadURL('https://www.instagram.com/direct/inbox/')
  }
  wc.on('did-navigate', skipSavePrompt)
  wc.on('did-navigate-in-page', skipSavePrompt)
})

const reveal = () => {
  app.dock?.show()
  win.show()
  win.focus()
}
app.on('second-instance', reveal)

app.whenReady().then(() => {
  if (background) app.dock?.hide()
  else if (!app.isPackaged) app.dock?.setIcon(path.join(__dirname, 'build/icon.png'))

  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 720,
    minHeight: 400,
    show: !background,
    backgroundColor: '#1f1f1f',
    // Our own title bar on every OS: macOS keeps its traffic lights, Windows/Linux get the
    // native minimise/maximise/close buttons drawn over its right end.
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 12, y: 11 },
    titleBarOverlay: process.platform !== 'darwin' && { color: '#181818', symbolColor: '#cccccc', height: 35 },
    autoHideMenuBar: true,
    // not throttled: the page must keep laying out and taking typed input while the window is hidden
    webPreferences: { webviewTag: true, backgroundThrottling: false },
  })
  win.loadFile(path.join(__dirname, 'index.html'))
  // While an editor is connected, closing the window only hides it.
  win.on('close', (e) => {
    if (quitting || !editors) return
    e.preventDefault()
    win.hide()
    app.dock?.hide()
  })

  const close = bridge({
    page: () => (guest && !guest.isDestroyed() ? guest : null),
    show: reveal,
    onClients(n) {
      editors = n
      clearTimeout(idle)
      // nothing on screen and the last editor left: no reason to keep running
      if (!n && !win.isVisible()) idle = setTimeout(() => app.quit(), 30000)
    },
  })
  app.on('will-quit', close)
  if (background) idle = setTimeout(() => app.quit(), 60000) // started for an editor that never connected
})

app.on('before-quit', () => (quitting = true))
app.on('window-all-closed', () => app.quit())
