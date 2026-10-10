// Local bridge for the VS Code extension: streams the conversation out, takes commands in.
// It is a Unix socket in the home directory (a named pipe on Windows), not a TCP port, so only
// this user's own programs can reach it and web pages can't.
// Protocol: one JSON object per line.
//   app -> client   { type: 'state', away, ok, threads, rows, pending, canSend }  on every change
//   client -> app   { type: 'open', index } | { type: 'send', text } | { type: 'page', dir }
//                   | { type: 'attach', files: [{ name, type, data }] } | { type: 'show' }
const net = require('net')
const fs = require('fs')
const os = require('os')
const path = require('path')
const GUEST = require('./scrape')

// Keep in step with bridgePath() in vscode-extension/extension.js.
const where =
  process.env.VSC_BRIDGE ||
  (process.platform === 'win32'
    ? `\\\\.\\pipe\\visual-stagram-code-${os.userInfo().username}`
    : path.join(os.homedir(), '.visual-stagram-code.sock'))

const MAX_LINE = 64 * 1024 * 1024 // an attachment arrives as one base64 line

// page(): the Instagram webview's webContents (or null); show(): bring the window up, e.g. to log in;
// onClients(n): told whenever the number of connected editors changes.
module.exports = function bridge({ page, show, onClients }) {
  const clients = new Set()
  let last = ''

  const tick = async () => {
    const wc = page()
    if (!clients.size || !wc) return
    let state = { type: 'state', away: true, ok: false, threads: [], rows: [], pending: 0, canSend: false }
    try {
      if (new URL(wc.getURL()).pathname.startsWith('/direct')) {
        state = { ...state, away: false, ...(await wc.executeJavaScript(GUEST.scrape)) }
      }
    } catch {
      return // not loaded yet or mid-navigation
    }
    const json = JSON.stringify(state)
    if (json === last) return
    last = json
    for (const client of clients) client.write(json + '\n')
  }
  setInterval(tick, 1000)

  const run = (js) => page()?.executeJavaScript(js)
  const commands = {
    open: ({ index }) => run(GUEST.open(index)),
    page: ({ dir }) => run(GUEST.page(dir)),
    attach: ({ files }) =>
      Array.isArray(files) &&
      run(GUEST.attach(files.map((f) => ({ name: String(f.name), type: String(f.type), data: String(f.data) })))),
    show: () => show(),
    async send({ text }) {
      const wc = page()
      if (!wc || !(await wc.executeJavaScript(GUEST.focus))) return
      if (text) await wc.insertText(String(text))
      for (const type of ['keyDown', 'char', 'keyUp']) wc.sendInputEvent({ type, keyCode: 'Enter' })
    },
  }

  const server = net.createServer((socket) => {
    clients.add(socket)
    onClients(clients.size)
    last = '' // make the next tick send the current state to the newcomer
    tick()

    let buffer = ''
    socket.setEncoding('utf8')
    socket.on('data', (chunk) => {
      buffer += chunk
      if (buffer.length > MAX_LINE) return socket.destroy()
      for (let end; (end = buffer.indexOf('\n')) !== -1; ) {
        const text = buffer.slice(0, end)
        buffer = buffer.slice(end + 1)
        try {
          const message = JSON.parse(text)
          if (Object.hasOwn(commands, message.type)) Promise.resolve(commands[message.type](message)).catch(() => {})
        } catch {
          // not JSON: ignore the line
        }
      }
    })
    socket.on('error', () => {})
    socket.on('close', () => {
      clients.delete(socket)
      onClients(clients.size)
    })
  })
  server.on('error', (err) => console.error('bridge:', err.message))

  const unix = process.platform !== 'win32'
  if (unix) fs.rmSync(where, { force: true }) // left over from a crash; the single-instance lock means nobody else owns it
  server.listen(where, () => unix && fs.chmodSync(where, 0o600))
  return () => {
    server.close()
    if (unix) fs.rmSync(where, { force: true })
  }
}
