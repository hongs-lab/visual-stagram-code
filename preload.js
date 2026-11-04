// The app window's line to the main process (main.js): menu, badge, notifications' focus, the terminal.
// The hidden Instagram/Telegram pages never see this; it only runs in index.html.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('host', {
  platform: process.platform,
  setMenu: (spec) => ipcRenderer.send('menu', spec),
  onCommand: (run) => ipcRenderer.on('command', (_, cmd) => run(cmd)),
  badge: (count, png) => ipcRenderer.send('badge', count, png),
  focus: () => ipcRenderer.send('focus'),
  setPanicKey: (key) => ipcRenderer.send('panic-key', key),
  term: {
    start: () => ipcRenderer.invoke('term:start'),
    input: (line) => ipcRenderer.send('term:input', line),
    interrupt: () => ipcRenderer.send('term:signal'),
    kill: () => ipcRenderer.send('term:kill'),
    on: (listener) => ipcRenderer.on('term', (_, msg) => listener(msg)),
  },
})
