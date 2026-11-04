const { app, BrowserWindow, Menu, ipcMain, nativeImage, nativeTheme, session, shell } = require('electron')
const path = require('path')
const os = require('os')
const { spawn } = require('child_process')
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
if (process.platform === 'win32') app.setAppUserModelId('com.visualstagramcode.app') // needed for notifications

const openExternal = (url) => {
  if (/^https?:/.test(url)) shell.openExternal(url)
}

const PAGES = ['persist:instagram', 'persist:telegram'] // the hidden webviews' sessions (see index.html)
let win
const guests = new Map() // partition -> that webview's webContents
let editors = 0 // VS Code windows connected through the bridge
let quitting = false
let idle

app.on('web-contents-created', (_, wc) => {
  if (wc.getType() !== 'webview') return
  const partition = PAGES.find((p) => wc.session === session.fromPartition(p))
  if (partition) guests.set(partition, wc)
  wc.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown' || keyName(input) !== panicKey) return
    e.preventDefault()
    command('workbench.action.focusDecoy')
  })
  wc.setWindowOpenHandler(({ url }) => {
    openExternal(url)
    return { action: 'deny' }
  })
  // The editor has no address bar, so the page itself must never leave the site.
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

// ---- the window's side of preload.js -------------------------------------------------------------------------
const command = (cmd) => win?.webContents.send('command', cmd)

// The menu bar, from the spec renderer.js sends: [{ label, items: [{ label, cmd, key, role } | '-'] }].
// Only macOS shows it; Windows/Linux draw theirs in the title bar (index.html), so they get none.
// Shortcuts are only displayed here; the window itself handles the keys, so nothing fires twice.
ipcMain.on('menu', (_, spec) => {
  if (process.platform !== 'darwin') return Menu.setApplicationMenu(null)
  const item = (it) =>
    it === '-'
      ? { type: 'separator' }
      : it.role
        ? { role: it.role, ...(it.label && { label: it.label }) }
        : { label: it.label, accelerator: it.key, registerAccelerator: false, click: () => command(it.cmd) }
  const appMenu = { label: app.name, submenu: [{ role: 'about' }, { type: 'separator' }, item({ label: 'Settings...', cmd: 'workbench.action.openSettings', key: 'Cmd+,' }), { type: 'separator' }, { role: 'services' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] }
  Menu.setApplicationMenu(Menu.buildFromTemplate([appMenu, ...spec.map((m) => ({ label: m.label, ...(m.role ? { role: m.role } : { submenu: m.items.map(item) }) }))]))
})

// Unread count on the Dock icon / taskbar button (Windows needs a drawn overlay, which the window makes).
ipcMain.on('badge', (_, count, png) => {
  if (process.platform === 'win32') win?.setOverlayIcon(count && png ? nativeImage.createFromDataURL(png) : null, count ? String(count) : '')
  else app.setBadgeCount(count)
})
ipcMain.on('focus', () => reveal())

// The panic key (settings.json "workbench.panicKey", e.g. "Escape") also works while the real page has the keyboard.
// Same naming as keyName() in renderer.js: "Mod" is Cmd on macOS, Ctrl elsewhere.
let panicKey = 'Escape'
ipcMain.on('panic-key', (_, key) => (panicKey = String(key)))
const CODES = { Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Space: 'Space' }
const keyName = (i) => {
  const mac = process.platform === 'darwin'
  let k = /^Key[A-Z]$/.test(i.code) ? i.code.slice(3) : /^Digit\d$/.test(i.code) ? i.code.slice(5) : (CODES[i.code] ?? i.key)
  if (k.length === 1) k = k.toUpperCase()
  return [(mac ? i.meta : i.control) && 'Mod', mac && i.control && 'Ctrl', i.alt && 'Alt', i.shift && 'Shift', k].filter(Boolean).join('+')
}

// The panel's terminal: one long-lived shell fed line by line, so cd and variables carry over.
// ponytail: pipes, not a pty -- no line editing, colours or full-screen programs (vim, top); add node-pty if those matter.
let term = null
function startShell(emit) {
  const win32 = process.platform === 'win32'
  const file = win32 ? process.env.ComSpec || 'cmd.exe' : process.env.SHELL || '/bin/zsh'
  const child = spawn(file, win32 ? ['/D', '/Q', '/K', 'chcp 65001>nul'] : ['-l'], {
    cwd: os.homedir(),
    env: { ...process.env, TERM: 'dumb', PAGER: 'cat', GIT_PAGER: 'cat' },
    detached: !win32, // its own process group, so Ctrl+C reaches the running command
    windowsHide: true,
  })
  const eol = win32 ? '\r\n' : '\n'
  // After every command the shell prints \x1f<exit code>\x1f<cwd>\x1f: that line ends the command.
  const marker = (win32 ? 'echo \x1f%ERRORLEVEL%\x1f%CD%\x1f' : `printf '\\037%s\\037%s\\037\\n' "$?" "$PWD"`) + eol
  let out = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    out += chunk
    for (let m; (m = /\x1f(-?\d+)\x1f(.*?)\x1f\r?\n/.exec(out)); out = out.slice(m.index + m[0].length)) {
      if (m.index) emit({ type: 'data', text: out.slice(0, m.index) })
      emit({ type: 'prompt', code: Number(m[1]), cwd: m[2] })
    }
    const hold = out.indexOf('\x1f') // a marker cut in half: wait for the rest
    if (hold && out) emit({ type: 'data', text: hold < 0 ? out : out.slice(0, hold) })
    out = hold < 0 ? '' : out.slice(hold)
  })
  child.stderr.on('data', (text) => emit({ type: 'data', text }))
  child.on('error', (err) => emit({ type: 'data', text: err.message + '\n' }))
  child.on('exit', (code) => {
    term = null
    emit({ type: 'exit', code })
  })
  if (!win32) child.stdin.write("trap ':' INT" + eol) // a handler, not ignore: commands still die on Ctrl+C
  child.stdin.write(marker) // the first prompt
  const signal = (sig) => {
    try {
      if (win32) child.kill()
      else process.kill(-child.pid, sig)
    } catch {
      // already gone
    }
  }
  return {
    file,
    write: (line) => child.stdin.write(line + eol + marker),
    // a command reading stdin may have swallowed the marker: send another so a prompt comes back
    interrupt: () => (signal('SIGINT'), setTimeout(() => child.stdin.writable && child.stdin.write(marker), 150)),
    kill: () => signal('SIGKILL'),
  }
}
ipcMain.handle('term:start', (e) => {
  if (term) term.write('') // already running (the window reloaded): a fresh prompt
  term ??= startShell((msg) => !e.sender.isDestroyed() && e.sender.send('term', msg))
  return { user: os.userInfo().username, host: os.hostname().replace(/\.local$/, ''), home: os.homedir(), shell: path.basename(term.file) }
})
ipcMain.on('term:input', (_, line) => term?.write(String(line)))
ipcMain.on('term:signal', () => term?.interrupt())
ipcMain.on('term:kill', () => term?.kill())

app.whenReady().then(() => {
  if (background) app.dock?.hide()
  else if (!app.isPackaged) app.dock?.setIcon(path.join(__dirname, 'build/icon.png'))

  // The pages' own notifications came back after every restart; the window shows its own instead (renderer.js),
  // remembering which ones it has shown.
  for (const p of PAGES) {
    session.fromPartition(p).setPermissionRequestHandler((_, permission, done) => done(permission !== 'notifications'))
    session.fromPartition(p).setPermissionCheckHandler((_, permission) => permission !== 'notifications')
  }

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
    webPreferences: { preload: path.join(__dirname, 'preload.js'), webviewTag: true, backgroundThrottling: false },
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
    page: () => {
      const wc = guests.get('persist:instagram')
      return wc && !wc.isDestroyed() ? wc : null
    },
    show: reveal,
    onClients(n) {
      editors = n
      clearTimeout(idle)
      // nothing on screen and the last editor left: no reason to keep running
      if (!n && !win.isVisible()) idle = setTimeout(() => app.quit(), 30000)
    },
  })
  app.on('will-quit', () => {
    close()
    term?.kill()
  })
  if (background) idle = setTimeout(() => app.quit(), 60000) // started for an editor that never connected
})

app.on('before-quit', () => (quitting = true))
app.on('window-all-closed', () => app.quit())
