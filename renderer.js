// The VS Code look-alike around the hidden sites. They run in <webview>s under the editor; GUEST (scrape.js) and
// TELEGRAM (telegram.js) read and drive them, camo.js turns a conversation into a source file. The rest is the
// workbench: explorer, tabs, side views, quick input, menus, the panel with a real terminal, the status bar.
'use strict'

// ---- helpers ---------------------------------------------------------------------------------------------------
const $ = (id) => document.getElementById(id)
const h = (tag, props, ...kids) => {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(props ?? {})) {
    if (k === 'class') el.className = v
    else if (k === 'text') el.textContent = v
    else if (k === 'style') el.style.cssText = v
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v)
    else if (v != null && v !== false) el.setAttribute(k, v === true ? '' : v)
  }
  el.append(...kids.flat().filter((k) => k != null && k !== false))
  return el
}
const span = (className, textContent) => Object.assign(document.createElement('span'), { className, textContent })
const codicon = (name) => span('codicon codicon-' + name, '')
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const later = (fn, ms) => {
  let timer
  return (...args) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }
}
const load = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback
  } catch {
    return fallback
  }
}
const save = (key, value) => localStorage.setItem(key, JSON.stringify(value))
const norm = (s) => (s ?? '').replace(/\s+/g, ' ').trim()
const fmtTime = (t) => new Date(t).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' }) // 2026-11-04 14:03
// preload.js's window.host; missing when index.html is opened in a plain browser. (A `const host` would clash with
// it: contextBridge makes it non-configurable.)
const native = window.host
const mac = native ? native.platform === 'darwin' : /mac/i.test(navigator.userAgentData?.platform ?? navigator.platform)
document.body.classList.toggle('win', !mac) // see .win in index.html

const code = $('code')
const draft = $('draft')
const inputLine = $('input-line')
const tree = $('tree')

// ---- settings: .vscode/settings.json, JSON with comments --------------------------------------------------------
const jsonc = (text) => {
  let out = ''
  for (let i = 0; i < text.length; ) {
    if (text[i] === '"') {
      const string = /"(?:\\.|[^"\\])*"/y
      string.lastIndex = i
      const m = string.exec(text)
      if (!m) throw new SyntaxError('unterminated string')
      out += m[0]
      i += m[0].length
    } else if (text.startsWith('//', i)) i = text.indexOf('\n', i) < 0 ? text.length : text.indexOf('\n', i)
    else if (text.startsWith('/*', i)) i = text.indexOf('*/', i) < 0 ? text.length : text.indexOf('*/', i) + 2
    else out += text[i++]
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'))
}
const DEFAULT_SETTINGS = `{
  // How much camouflage code sits between messages: 0, 2, 4 or 8 (also "Spaces" in the status bar)
  "editor.tabSize": ${[0, 2, 4, 8].includes(Number(localStorage.getItem('camouflage') ?? 2)) ? Number(localStorage.getItem('camouflage') ?? 2) : 2},
  // Long lines wrap instead of running off the screen (Alt+Z)
  "editor.wordWrap": "on",
  // Extension of the conversation files, which picks their language: py, js, kt, swift, sql, html, md, ...
  "files.defaultLanguage": "py",
  // The key that jumps straight to main.py, e.g. "Escape", "F12", "Ctrl+Shift+Space"
  "workbench.panicKey": "Escape",
  "notifications.enabled": true,
  "notifications.showPreview": true,
  "window.title": "\${activeEditorShort}\${separator}\${rootName}\${separator}Visual Studio Code"
}
`
const DEFAULTS = jsonc(DEFAULT_SETTINGS)
let settingsText = localStorage.getItem('vsc.settings') ?? DEFAULT_SETTINGS
let settings = { ...DEFAULTS }
let problems = 0
function applySettings() {
  try {
    settings = { ...DEFAULTS, ...jsonc(settingsText) }
    problems = 0
    native?.setPanicKey?.(accel(settings['workbench.panicKey'] || 'Escape'))
    retype()
  } catch {
    problems = 1 // keep the last good settings
  }
  render()
}
// Changes one value in the file, leaving the user's comments and layout alone.
function setSetting(key, value) {
  const re = new RegExp(`("${key.replace(/\./g, '\\.')}"\\s*:\\s*)("(?:\\\\.|[^"\\\\])*"|[^,\\n}]+)`)
  const json = JSON.stringify(value)
  settingsText = re.test(settingsText) ? settingsText.replace(re, `$1${json}`) : settingsText.replace('{', `{\n  "${key}": ${json},`)
  localStorage.setItem('vsc.settings', settingsText)
  if (te.id === 'settings') {
    te.input.value = settingsText
    paintText()
  }
  applySettings()
}
const level = () => (camo.LEVELS.includes(Number(settings['editor.tabSize'])) ? Number(settings['editor.tabSize']) : 2)
const wrapOn = () => settings['editor.wordWrap'] !== 'off'
const defaultExt = () => {
  const ext = String(settings['files.defaultLanguage'] ?? '').trim().replace(/^\.+/, '').toLowerCase()
  return /^[\w+#-]+(\.[\w+#-]+)*$/.test(ext) ? ext : 'py'
}
// Conversation files carry files.defaultLanguage as their extension. When it changes, the ones that had the old
// extension are renamed; the rest were given a language of their own.
const firstRun = localStorage.getItem('vsc.fileType') == null // nothing picked yet: ask once, at startup
function retype() {
  const to = defaultExt()
  const from = localStorage.getItem('vsc.fileType') ?? 'py'
  localStorage.setItem('vsc.fileType', to)
  if (from === to) return
  for (const [id, c] of Object.entries(ws.chats))
    if (c.name.toLowerCase().endsWith('.' + from)) c.name = freeName(c.parent, c.name.slice(0, -from.length) + to, id)
  chatList = null
  te.id = null
  saveWs()
}

// ---- the workspace: folders and files the explorer shows ---------------------------------------------------------
// Conversation files come from the services' thread lists; ws.chats keeps what the user did to them (rename, move,
// delete). Everything else lives in ws.nodes. A file's language follows its extension.
const SEED = () => ({
  nodes: {
    root: { id: 'root', kind: 'folder', name: 'api-server', parent: null },
    vscode: { id: 'vscode', kind: 'folder', name: '.vscode', parent: 'root' },
    settings: { id: 'settings', kind: 'settings', name: 'settings.json', parent: 'vscode' },
    direct: { id: 'direct', kind: 'folder', name: 'direct', parent: 'root' },
    telegram: { id: 'telegram', kind: 'folder', name: 'telegram', parent: 'root' },
    decoy: { id: 'decoy', kind: 'decoy', name: 'main.py', parent: 'root' },
    activity: { id: 'activity', kind: 'activity', name: 'activity.log', parent: 'root' },
    readme: { id: 'readme', kind: 'readme', name: 'README.md', parent: 'root' },
  },
  chats: {},
  open: { root: true, direct: true },
})
const FIXED = new Set(Object.keys(SEED().nodes)) // renamed and moved, never deleted
const ws = load('vsc.workspace', null) ?? SEED()
for (const [id, n] of Object.entries(SEED().nodes)) ws.nodes[id] ??= n
const saveWs = later(() => save('vsc.workspace', ws), 300)
const rootName = () => ws.nodes.root.name

// ---- the sites ----------------------------------------------------------------------------------------------------
const EMPTY = { ok: false, threads: [], rows: [], pending: 0, canSend: false, badge: 0, me: null, open: null }
const services = [
  { id: 'instagram', name: 'Instagram', folder: 'direct', G: GUEST, partition: 'persist:instagram', home: 'https://www.instagram.com/direct/inbox/', ready: (u) => u.hostname.endsWith('instagram.com') && u.pathname.startsWith('/direct') },
  { id: 'telegram', name: 'Telegram', folder: 'telegram', G: TELEGRAM, partition: 'persist:telegram', home: 'https://web.telegram.org/k/', ready: (u) => u.hostname === 'web.telegram.org' },
].map((s) => ({ ...s, view: null, snap: EMPTY, away: true, threads: load('vsc.threads.' + s.id, []), queue: Promise.resolve(), busy: 0, want: null, switchedAt: 0, ours: false }))
const [IG, TG] = services
IG.view = $('ig')
// Telegram only runs once it has been used: one more hidden page otherwise.
function start(s) {
  if (s.view) return
  s.view = h('webview', { src: s.home, partition: s.partition, webpreferences: 'backgroundThrottling=no' })
  $('stage').prepend(s.view)
  guard(s.view)
  localStorage.setItem('vsc.' + s.id, '1')
}
// A page that focuses its own composer (Instagram does when a conversation opens) would take the keyboard from the
// input line and break Korean typing; while it is hidden, focus goes straight back to the editor.
const guard = (view) =>
  view.addEventListener('focus', () => {
    if (rawNow) return
    setTimeout(() => {
      focusEditor()
      if (document.activeElement === view) view.blur() // nothing to type into: still never the hidden page
    })
  })
guard(IG.view)
if (localStorage.getItem('vsc.telegram')) start(TG)
// Page actions go one at a time per site; resolves to the action's result, or null if it failed.
const queue = (s, job) => (s.queue = s.queue.then(job).catch(() => null))
const page = (s, js) => queue(s, () => s.view.executeJavaScript(js))

const rowsCache = load('vsc.rows', {}) // chat id -> the last rows seen, shown until the page has the conversation
const saveRows = later(() => {
  const ids = Object.keys(rowsCache)
  for (const id of ids.slice(0, Math.max(0, ids.length - 60))) delete rowsCache[id] // the 60 most recent chats
  save('vsc.rows', rowsCache)
}, 3000)
const saveThreads = later(() => services.forEach((s) => save('vsc.threads.' + s.id, s.threads)), 2000)

// The list on the page is virtual, so threads seen while it was scrolled further down are kept, with where they were.
function merge(s, fresh) {
  const byName = new Map(s.threads.map((t) => [t.name, t]))
  for (const t of fresh) if (t.name) byName.set(t.name, { ...byName.get(t.name), ...t })
  const next = [...byName.values()].sort((a, b) => a.y - b.y).slice(0, 400)
  if (JSON.stringify(next) === JSON.stringify(s.threads)) return // polled every second: save only changes
  s.threads = next
  saveThreads()
}
// The conversation the page has open right now (by the name in its header), if any.
function liveThread(s) {
  if (s.away || !s.snap.canSend) return null
  if (s.snap.open) return s.threads.find((t) => norm(t.name) === norm(s.snap.open))?.name ?? s.snap.open
  return Date.now() - s.switchedAt > 2500 ? s.want : null
}
function openThread(s, name) {
  s.want = name
  s.switchedAt = Date.now()
  if (s.away || !s.view) return (s.pendingOpen = true)
  if (liveThread(s) === name) return
  page(s, s.G.openThread(name, s.threads.find((t) => t.name === name)?.y))
}
let loading = 0
async function loadMore(s = IG, pages = 4) {
  if (s.away || loading > Date.now() - 2000) return
  loading = Date.now()
  const found = await page(s, s.G.more(pages))
  if (found?.length) merge(s, found)
  loading = 0
  render()
}

// ---- conversation files ------------------------------------------------------------------------------------------
const chatId = (s, name) => `chat:${s.id}:${name}`
const takenNames = (parent, except) => [
  ...Object.values(ws.nodes).filter((n) => n.parent === parent && n.id !== except).map((n) => n.name.toLowerCase()),
  ...Object.entries(ws.chats).filter(([id, c]) => c.parent === parent && !c.hidden && id !== except).map(([, c]) => c.name.toLowerCase()),
]
function freeName(parent, name, except) {
  const taken = takenNames(parent, except)
  const [, stem, ext] = /^(.*?)(\.[^.]*)?$/.exec(name)
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? name : `${stem}_${n}${ext ?? ''}`
    if (!taken.includes(candidate.toLowerCase())) return candidate
  }
}
let chatList = null // rebuilt once per render
function chats() {
  if (chatList) return chatList
  chatList = []
  for (const s of services)
    for (const t of s.threads) {
      const id = chatId(s, t.name)
      let meta = ws.chats[id]
      if (!meta) {
        meta = ws.chats[id] = { name: freeName(s.folder, camo.slug(t.name) + '.' + defaultExt()), parent: s.folder }
        saveWs()
      }
      if (meta.hidden && t.unread) meta.hidden = false // a deleted file comes back with a new message
      if (!ws.nodes[meta.parent]) meta.parent = s.folder // its folder was deleted
      if (!meta.hidden) chatList.push({ id, kind: 'chat', service: s, thread: t.name, t, name: meta.name, parent: meta.parent })
    }
  return chatList
}
const nodeOf = (id) => ws.nodes[id] ?? chats().find((c) => c.id === id) ?? null
const isFolder = (nd) => nd?.kind === 'folder'
function children(parent) {
  const kids = Object.values(ws.nodes).filter((n) => n.parent === parent)
  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true })
  return [
    ...kids.filter(isFolder).sort(byName),
    ...chats().filter((c) => c.parent === parent), // newest first, like explorer.sortOrder "modified"
    ...kids.filter((n) => !isFolder(n)).sort(byName),
  ]
}
const pathOf = (nd) => {
  const parts = []
  for (let n = nd; n; n = n.parent ? nodeOf(n.parent) : null) parts.unshift(n.name)
  return parts
}

// sender labels: a digit-free note right above someone's message is their name in a group chat
const prepare = (rows) =>
  rows.map((r, i) => (r.side === 'note' && !/\d/.test(r.text ?? '') && rows[i + 1]?.side === 'recv' && rows[i + 1].who ? { ...r, user: rows[i + 1].who } : r))
const rowsOf = (nd) => prepare(liveThread(nd.service) === nd.thread ? nd.service.snap.rows : rowsCache[nd.id] ?? [])
const titleCase = (slug) => slug.split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ')
const participants = (nd, rows) => [...new Set(rows.filter((r) => r.side === 'recv' && r.who && r.who !== nd.service.snap.me).map((r) => r.who))]
// The comment block on top of a conversation file: who, and when it was last looked at.
const visits = load('vsc.visits', {}) // chat id -> when it was last open
const shownVisit = {} // chat id -> the visit before this one, which the header shows
function headerFor(nd, rows) {
  const who = participants(nd, rows)
  const lines = [`Author: ${titleCase(camo.slug(nd.thread))}${who.length === 1 ? ` (@${who[0]})` : ''}`]
  if (who.length > 1) lines.push('Members: ' + who.map((u) => '@' + u).join(', '))
  if (shownVisit[nd.id]) lines.push('Last checked: ' + fmtTime(shownVisit[nd.id]))
  return lines
}

// ---- colouring ----------------------------------------------------------------------------------------------------
// Each language's hl (camo.js) says how: one of the modes below, or code: comments, strings, numbers, its keywords.
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const STRING = String.raw`(?:\b[fFrRbBuU]{1,2})?(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|${'`'}(?:\\.|[^${'`'}\\])*${'`'})`
const MODES = {
  markup: [[String.raw`<!--.*?(?:-->|$)`, 'com'], [String.raw`<[\/!?]?(?=\w)`, 'punc'], [String.raw`(?<=<[\/!?]?)[\w:.-]+`, 'decl'], [String.raw`[\/?]?>`, 'punc'], [String.raw`[\w:@.#-]+(?==)`, 'key'], [String.raw`"[^"]*"|'[^']*'`, 'str'], [String.raw`\{[#:\/@]\w+`, 'kw'], [String.raw`&\w+;`, 'decl']],
  css: [[String.raw`\/\*.*?(?:\*\/|$)`, 'com'], [STRING, 'str'], [String.raw`@[\w-]+`, 'kw'], [String.raw`\$[\w-]+|--[\w-]+`, 'key'], [String.raw`#[\da-fA-F]{3,8}\b`, 'num'], [String.raw`(?<=^\s*|[{;]\s*)[\w-]+(?=\s*:(?!:))`, 'key'], [String.raw`-?\b\d*\.?\d+(?:px|r?em|%|s|ms|vh|vw|deg|fr)?\b`, 'num'], [String.raw`!important`, 'kw'], [String.raw`[.#&%][\w-]+|::?[\w-]+`, 'fn'], [String.raw`[\w-]+(?=\()`, 'fn']],
  data: [[String.raw`(?:^|(?<=\s))[#;].*$`, 'com'], [String.raw`^\s*\[\[?[^\]]*\]\]?`, 'type'], [String.raw`^\s*(?:-\s+)?[\w.$\/@-]+(?=\s*[:=])`, 'key'], [String.raw`"(?:\\.|[^"\\])*"|'[^']*'`, 'str'], [String.raw`\b(?:true|false|null|yes|no)\b`, 'decl'], [String.raw`-?\b\d+(?:\.\d+)?\b`, 'num']],
  diff: [[String.raw`^(?:diff|index|---|\+\+\+) .*$`, 'kw'], [String.raw`^@@.*$`, 'decl'], [String.raw`^\+.*$`, 'num'], [String.raw`^-.*$`, 'str']],
}
const tokenizers = {}
function tokenizer(lang) {
  if (tokenizers[lang]) return tokenizers[lang]
  const L = camo.LANGS[lang]
  const hl = L.hl
  const words = (list) => list && `\\b(?:${list.split(' ').map(esc).join('|')})\\b`
  let parts = MODES[hl.mode]
  if (hl.mode === 'css' && L.comment === '// ') parts = [[String.raw`\/\/.*$`, 'com'], ...parts] // Sass and Less
  parts ??= [
    [(hl.com ?? [L.comment.trim()]).map((c) => esc(c) + (/\w$/.test(c) ? '\\b' : '') + '.*$').join('|'), 'com'],
    [hl.str ?? STRING, 'str'],
    ...(hl.extra ?? []),
    [String.raw`\b\d+(?:\.\d+)?\b`, 'num'],
    [words(hl.kw), 'kw'],
    [words(hl.decl), 'decl'],
    [words(hl.types), 'type'],
    [hl.call ?? String.raw`\b[A-Za-z_]\w*(?=\s*!?\()`, 'fn'],
  ]
  parts = parts.filter(([source]) => source)
  return (tokenizers[lang] = { re: new RegExp(parts.map(([source]) => `(${source})`).join('|'), hl.ci ? 'gi' : 'g'), classes: parts.map(([, cls]) => cls) })
}
function highlight(text, lang) {
  if (!text) return [text ?? '']
  const mode = camo.LANGS[lang]?.hl.mode
  if (mode === 'plain') return [text]
  if (mode === 'md') return markdownLine(text)
  const out = []
  let at = 0
  const push = (m, cls) => {
    out.push(text.slice(at, m.index), span(cls, m[0]))
    at = m.index + m[0].length
  }
  if (mode === 'log') {
    const m = /^\s*(INFO|DEBUG|WARN|WARNING|ERROR|INPUT|TRACE)\b/.exec(text)
    if (m) push({ index: m.index, 0: m[0] }, 'lv-' + ({ WARNING: 'warn', INPUT: 'info', TRACE: 'debug' }[m[1]] ?? m[1].toLowerCase()))
    if (text.trimStart().startsWith('#')) return [span('com', text)]
    out.push(text.slice(at))
    return out
  }
  if (mode === 'json') {
    for (const m of text.matchAll(/(\/\/.*$)|("(?:\\.|[^"\\])*")(?=\s*:)|("(?:\\.|[^"\\])*")|\b(-?\d+(?:\.\d+)?)\b|\b(true|false|null)\b/g))
      push(m, m[1] ? 'com' : m[2] ? 'key' : m[3] ? 'str' : m[4] ? 'num' : 'decl')
    out.push(text.slice(at))
    return out
  }
  const { re, classes } = tokenizer(lang)
  for (const m of text.matchAll(re)) push(m, classes[m.findIndex((g, i) => i && g !== undefined) - 1])
  out.push(text.slice(at))
  return out
}
// README.md and other markdown: headings and `inline code` get a colour.
const markdownLine = (text) =>
  /^#+ /.test(text) ? [span('h', text)] : /^\s*<!--/.test(text) ? [span('com', text)] : text.split(/(`[^`]*`)/).map((part) => (part.startsWith('`') ? span('str', part) : part))
const line = (...tokens) => {
  const el = document.createElement('div')
  el.className = 'line'
  el.append(...tokens)
  return el
}

// ---- file icons: the Material Icon Theme's (icons/, MIT), picked the way VS Code picks an icon theme's icons ---------
// the whole name, then the longest extension (a.spec.ts: spec.ts, then ts), then the language; an open folder: -open
function iconOf(name, folder, open) {
  const lower = name.toLowerCase()
  if (folder) return (MATERIAL.folderNames[lower] ?? MATERIAL.folder) + (open ? '-open' : '')
  if (MATERIAL.fileNames[lower]) return MATERIAL.fileNames[lower]
  const parts = lower.split('.')
  for (let i = 1; i < parts.length; i++) if (MATERIAL.fileExtensions[parts.slice(i).join('.')]) return MATERIAL.fileExtensions[parts.slice(i).join('.')]
  return MATERIAL.languageIds[camo.lang(name, null)] ?? MATERIAL.file
}
const fileIcon = (name, folder, open) => h('img', { class: 'file-icon', src: `icons/${iconOf(name, folder, open)}.svg`, alt: '', draggable: 'false' })

// ---- tabs -----------------------------------------------------------------------------------------------------------
const tabs = load('vsc.tabs', { list: ['readme'], active: 'readme', closed: [] })
const saveTabs = later(() => save('vsc.tabs', tabs), 200)
const recent = [tabs.active].filter(Boolean) // most recently active last
let navAt = -1
const nav = [] // back/forward through the editors that were active
const drafts = {} // chat id -> what is typed on its input line
const seeds = {} // chat id -> where its input line sits; frozen while there is text in it
let landing = false // the next chat render scrolls to the newest message and puts the cursor on the input line
const activeNode = () => (tabs.active ? nodeOf(tabs.active) : null)

function leave(nd) {
  if (!nd) return
  if (nd.kind === 'chat') {
    drafts[nd.id] = draft.textContent
    visits[nd.id] = Date.now()
    save('vsc.visits', visits)
  }
  if (nd.kind === 'activity') markActivitySeen()
}
function activate(id, { record = true } = {}) {
  const nd = nodeOf(id)
  if (!nd) return
  if (tabs.active !== id) leave(activeNode())
  if (!tabs.list.includes(id)) tabs.list.splice(tabs.list.indexOf(tabs.active) + 1, 0, id)
  tabs.active = id
  forget(id)
  recent.push(id)
  if (record && nav[navAt] !== id) {
    nav.splice(navAt + 1, Infinity, id)
    navAt = nav.length - 1
  }
  pinned = false
  selected = id
  if (nd.kind === 'chat') {
    shownVisit[id] = visits[id] // when it was last left: "Last checked" in its header
    draft.textContent = drafts[id] ?? ''
    openThread(nd.service, nd.thread)
    landing = true
  }
  if (nd.kind === 'activity') fetchActivity()
  saveTabs()
  render()
  focusEditor()
}
const openTab = (id) => activate(id)
const forget = (id) => recent.includes(id) && recent.splice(recent.indexOf(id), 1)
function closeTab(id = tabs.active) {
  const at = tabs.list.indexOf(id)
  if (at < 0) return
  if (id === tabs.active) leave(activeNode())
  tabs.list.splice(at, 1)
  tabs.closed = [...tabs.closed.filter((x) => x !== id), id].slice(-30)
  forget(id)
  if (id === tabs.active) {
    const next = [...recent].reverse().find((x) => tabs.list.includes(x)) ?? tabs.list[Math.min(at, tabs.list.length - 1)]
    tabs.active = null
    if (next) return activate(next)
  }
  saveTabs()
  render()
}
function reopenClosed() {
  while (tabs.closed.length) {
    const id = tabs.closed.pop()
    if (nodeOf(id)) return activate(id)
  }
}
function cycleTab(dir) {
  const at = tabs.list.indexOf(tabs.active)
  if (tabs.list.length > 1) activate(tabs.list[(at + dir + tabs.list.length) % tabs.list.length])
}
function navigate(dir) {
  for (let i = navAt + dir; i >= 0 && i < nav.length; i += dir) {
    if (!nodeOf(nav[i])) continue
    navAt = i
    return activate(nav[i], { record: false })
  }
}

// ---- the explorer ----------------------------------------------------------------------------------------------------
let selected = tabs.active
let editing = null // inline input: { id } to rename, { parent, kind } to create
let dragging = null
let explorerSig = ''
const unreadIn = (id) => chats().some((c) => c.t.unread && ancestors(c).includes(id))
const ancestors = (nd) => {
  const out = []
  for (let n = nd.parent ? nodeOf(nd.parent) : null; n; n = n.parent ? nodeOf(n.parent) : null) out.push(n.id)
  return out
}
function renderExplorer() {
  $('root-name').textContent = rootName().toUpperCase()
  $('root-header').firstElementChild.className = 'codicon codicon-chevron-' + (ws.open.root ? 'down' : 'right')
  if (editing && tree.querySelector('input')) return // typing a name: leave the row alone
  const items = []
  const walk = (parent, depth) => {
    if (editing?.parent === parent) items.push({ input: true, depth, kind: editing.kind })
    for (const nd of children(parent)) {
      items.push({ id: nd.id, name: nd.name, depth, folder: isFolder(nd), open: !!ws.open[nd.id], unread: nd.kind === 'chat' ? nd.t.unread : isFolder(nd) && unreadIn(nd.id), input: editing?.id === nd.id })
      if (isFolder(nd) && ws.open[nd.id]) walk(nd.id, depth + 1)
    }
  }
  if (ws.open.root) walk('root', 0)
  const sig = JSON.stringify([items, selected])
  if (sig === explorerSig) return
  explorerSig = sig
  tree.replaceChildren(
    ...items.map((it) => {
      const row = h('div', { class: 'row' + (it.id === selected ? ' selected' : '') + (it.unread ? ' untracked' : ''), style: `--depth: ${it.depth}`, draggable: it.input ? null : 'true', 'data-id': it.id })
      const twistie = span('twistie', '')
      const isNew = it.input && !it.id
      const folderish = it.folder || (isNew && it.kind === 'folder')
      if (folderish) twistie.append(codicon(it.open ? 'chevron-down' : 'chevron-right'))
      row.append(twistie, fileIcon(isNew ? '' : it.name, folderish, it.open))
      if (it.input) {
        const input = h('input', { spellcheck: 'false', value: editing.id ? it.name : '' })
        row.append(input)
        row.draggable = false
      } else row.append(span('label', it.name))
      if (it.unread) row.append(span('deco', it.folder ? '●' : 'U'))
      return row
    }),
  )
  const input = tree.querySelector('input')
  if (input) {
    input.focus()
    const dot = input.value.lastIndexOf('.')
    input.setSelectionRange(0, dot > 0 && editing.id ? dot : input.value.length)
    input.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault() // or the Enter lands in the file it opens
        finishEdit(input)
      }
      if (e.key === 'Escape') cancelEdit()
    })
    input.addEventListener('input', () => input.classList.toggle('bad', !!problem(input.value)))
    input.addEventListener('blur', () => editing && finishEdit(input, true))
  }
}
const problem = (value) => {
  const name = value.trim()
  if (!name) return 'A file or folder name must be provided.'
  if (/[/\\]/.test(name)) return 'The name can not contain / or \\.'
  const parent = editing.id ? nodeOf(editing.id)?.parent : editing.parent
  if (editing.id !== 'root' && takenNames(parent, editing.id).includes(name.toLowerCase())) return `A file or folder ${name} already exists at this location.`
  return null
}
function finishEdit(input, blurred) {
  if (!editing) return
  const name = input.value.trim()
  if (problem(name)) {
    if (blurred) cancelEdit()
    return
  }
  const { id, parent, kind } = editing
  editing = null
  explorerSig = ''
  chatList = null
  if (id) {
    if (ws.chats[id]) ws.chats[id].name = name
    else ws.nodes[id].name = name
    if (id === tabs.active) te.id = null // the language may have changed with the extension
    saveWs()
    render()
    return tree.focus()
  }
  const nid = (kind === 'folder' ? 'd' : 'f') + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  ws.nodes[nid] = { id: nid, kind, name, parent, ...(kind === 'file' && { text: '' }) }
  ws.open[nid] = kind === 'folder'
  selected = nid
  saveWs()
  if (kind === 'file') return openTab(nid)
  render()
  tree.focus()
}
function cancelEdit() {
  editing = null
  explorerSig = ''
  render()
  tree.focus()
}
function targetFolder() {
  const nd = nodeOf(selected)
  return !nd ? 'root' : isFolder(nd) ? nd.id : nd.parent ?? 'root'
}
function newItem(kind) {
  showView('explorer')
  const parent = targetFolder()
  ws.open[parent] = true
  ws.open.root = true
  editing = { parent, kind }
  explorerSig = ''
  render()
}
function rename(id = selected) {
  if (!nodeOf(id)) return
  if (id === 'root') return renameRoot()
  showView('explorer')
  for (const a of ancestors(nodeOf(id))) ws.open[a] = true
  editing = { id }
  explorerSig = ''
  render()
}
function renameRoot() {
  quick({
    placeholder: 'New name for the folder',
    value: rootName(),
    items: () => [],
    accept: (_, value) => {
      if (value.trim()) ws.nodes.root.name = value.trim()
      saveWs()
      render()
    },
  })
}
function remove(id = selected) {
  const nd = nodeOf(id)
  if (!nd) return
  if (FIXED.has(id)) return toast(`'${nd.name}' is part of the workspace and can't be deleted.`)
  if (!confirm(`Are you sure you want to delete '${nd.name}'${isFolder(nd) ? ' and its contents' : ''}?`)) return
  if (nd.kind === 'chat') ws.chats[id].hidden = true // the file comes back when the conversation changes
  else {
    const doomed = new Set([id])
    for (let grew = true; grew; ) {
      grew = false
      for (const n of Object.values(ws.nodes)) if (doomed.has(n.parent) && !doomed.has(n.id)) doomed.add(n.id) && (grew = true)
    }
    for (const c of Object.values(ws.chats)) if (doomed.has(c.parent)) c.parent = null // back to its service's folder
    for (const d of doomed) {
      delete ws.nodes[d]
      closeTab(d)
    }
  }
  closeTab(id)
  chatList = null
  saveWs()
  explorerSig = ''
  render()
}
function move(id, folder) {
  const nd = nodeOf(id)
  if (!nd || !canMove(id, folder)) return
  const name = freeName(folder, nd.name, id)
  if (ws.chats[id]) Object.assign(ws.chats[id], { parent: folder, name })
  else Object.assign(ws.nodes[id], { parent: folder, name })
  ws.open[folder] = true
  chatList = null
  saveWs()
  render()
}
const canMove = (id, folder) => id !== 'root' && folder && id !== folder && nodeOf(id)?.parent !== folder && !ancestors(nodeOf(folder)).includes(id)
function toggleFolder(nd) {
  ws.open[nd.id] = !ws.open[nd.id]
  if (nd.id === 'telegram' && ws.open.telegram) {
    start(TG)
    if (TG.away) {
      rawService = TG
      pinned = true
      toast('Sign in to Telegram on the page; the files show up once you are in.')
    }
  }
  saveWs()
  render()
}

tree.addEventListener('click', (e) => {
  const row = e.target.closest('.row')
  if (!row || e.target.tagName === 'INPUT') return
  const nd = nodeOf(row.dataset.id)
  selected = nd?.id
  if (isFolder(nd)) {
    toggleFolder(nd)
    tree.focus()
  } else if (nd) openTab(nd.id) // the cursor goes to the file, ready to type
})
tree.addEventListener('contextmenu', (e) => {
  e.preventDefault()
  const id = e.target.closest('.row')?.dataset.id ?? 'root'
  selected = id
  render()
  const nd = nodeOf(id)
  menu(e.clientX, e.clientY, [
    { label: 'New File...', run: () => newItem('file') },
    { label: 'New Folder...', run: () => newItem('folder') },
    ...(nd?.kind === 'chat' || id === 'direct' ? [{ label: 'New Message...', run: newChat }] : []),
    '-',
    ...(isFolder(nd) ? [] : [{ label: 'Open to the Side', run: () => openTab(id) }]),
    { label: 'Copy Path', key: mac ? 'Alt+Cmd+C' : 'Shift+Alt+C', run: () => navigator.clipboard.writeText(pathOf(nd).join('/')) },
    '-',
    { label: 'Rename...', key: 'F2', run: () => rename(id) },
    { label: 'Delete', key: mac ? 'Cmd+Backspace' : 'Delete', run: () => remove(id), disabled: FIXED.has(id) },
  ])
})
tree.addEventListener('keydown', (e) => {
  if (e.target !== tree) return
  const ids = [...tree.querySelectorAll('.row')].map((r) => r.dataset.id)
  const at = ids.indexOf(selected)
  const nd = nodeOf(selected)
  if (e.key === 'F2') rename()
  else if (e.key === 'Delete' || (e.key === 'Backspace' && e.metaKey)) remove()
  else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') selected = ids[Math.max(0, Math.min(ids.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)))]
  else if (e.key === 'ArrowRight' && isFolder(nd) && !ws.open[nd.id]) toggleFolder(nd)
  else if (e.key === 'ArrowLeft' && isFolder(nd) && ws.open[nd.id]) toggleFolder(nd)
  else if (e.key === 'Enter' && nd) isFolder(nd) ? toggleFolder(nd) : openTab(nd.id)
  else return
  e.preventDefault()
  render()
  tree.querySelector('.row.selected')?.scrollIntoView({ block: 'nearest' })
})
// drag a file or folder onto a folder (or a file in it) to move it there
const dropFolder = (e) => {
  const nd = nodeOf(e.target.closest('.row')?.dataset.id)
  return !nd ? 'root' : isFolder(nd) ? nd.id : nd.parent
}
tree.addEventListener('dragstart', (e) => {
  dragging = e.target.closest('.row')?.dataset.id
  if (!dragging) return e.preventDefault()
  e.dataTransfer.effectAllowed = 'move'
  e.dataTransfer.setData('text/plain', nodeOf(dragging)?.name ?? '')
})
tree.addEventListener('dragover', (e) => {
  if (!dragging) return
  const folder = dropFolder(e)
  tree.querySelectorAll('.drop').forEach((r) => r.classList.remove('drop'))
  if (!canMove(dragging, folder)) return
  e.preventDefault()
  tree.querySelector(`.row[data-id="${CSS.escape(folder)}"]`)?.classList.add('drop')
})
tree.addEventListener('drop', (e) => {
  e.preventDefault()
  if (dragging) move(dragging, dropFolder(e))
  dragging = null
})
tree.addEventListener('dragend', () => {
  dragging = null
  tree.querySelectorAll('.drop').forEach((r) => r.classList.remove('drop'))
})
// conversations further down the site's list load as the explorer reaches its end
tree.addEventListener('scroll', () => {
  if (tree.scrollTop + tree.clientHeight > tree.scrollHeight - 60 && ws.open.direct) loadMore(IG)
})
$('root-header').addEventListener('click', (e) => {
  if (e.target.closest('button')) return
  ws.open.root = !ws.open.root
  render()
})

// ---- side views ---------------------------------------------------------------------------------------------------
let view = 'explorer'
let sidebar = true
function showView(name, { toggle = false } = {}) {
  if (toggle && view === name && sidebar) sidebar = false
  else {
    view = name
    sidebar = true
  }
  render()
  if (name === 'search' && sidebar) $('search-input').select()
}
document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view, { toggle: true })))

// Search: the open conversations (their loaded messages) and every text file, as VS Code would show them.
const searchFlags = { case: false, word: false, regex: false }
for (const flag of Object.keys(searchFlags))
  $('search-' + flag).addEventListener('click', () => {
    searchFlags[flag] = !searchFlags[flag]
    $('search-' + flag).classList.toggle('on', searchFlags[flag])
    runSearch()
  })
const linesOf = (nd) => {
  if (nd.kind === 'chat') {
    const lang = camo.lang(nd.name)
    const rows = rowsOf(nd)
    return camo(rows, level(), { lang, header: headerFor(nd, rows) }).map((l) => camo.text(l, lang))
  }
  if (nd.kind === 'activity') return camo(activityRows(), level(), { lang: camo.lang(nd.name), header: activityHeader() }).map((l) => camo.text(l, camo.lang(nd.name)))
  return textOf(nd).split('\n')
}
const textOf = (nd) => (nd.kind === 'settings' ? settingsText : nd.kind === 'readme' ? readme : nd.kind === 'decoy' ? decoyText(nd).slice(0, nd.typed ?? 0) : nd.text ?? '')
function runSearch() {
  const q = $('search-input').value
  const results = $('search-results')
  if (!q) {
    $('search-summary').textContent = ''
    return results.replaceChildren()
  }
  let re
  try {
    const source = searchFlags.regex ? q : q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    re = new RegExp(searchFlags.word ? `\\b${source}\\b` : source, searchFlags.case ? 'g' : 'gi')
  } catch {
    $('search-summary').textContent = 'Invalid regular expression'
    return results.replaceChildren()
  }
  const files = [...Object.values(ws.nodes).filter((n) => !isFolder(n)), ...chats()]
  let hits = 0
  let count = 0
  const rows = []
  for (const nd of files) {
    const found = linesOf(nd)
      .map((text, i) => ({ text, i, m: [...text.matchAll(re)] }))
      .filter((x) => x.m.length)
    if (!found.length) continue
    count++
    hits += found.reduce((sum, x) => sum + x.m.length, 0)
    rows.push(h('div', { class: 'row', style: '--depth: 0', 'data-open': nd.id }, span('twistie', ''), fileIcon(nd.name), span('label', nd.name), span('description', pathOf(nd).slice(1, -1).join('/')), span('deco', String(found.length))))
    for (const x of found.slice(0, 50)) {
      const lead = Math.max(0, x.m[0].index - 30)
      const text = x.text.slice(lead).trimStart()
      const body = span('label', '') // one inline run: flex items would drop the spaces around a match
      let at = 0
      for (const m of text.matchAll(re)) {
        body.append(text.slice(at, m.index), h('mark', { text: m[0] }))
        at = m.index + m[0].length
      }
      body.append(text.slice(at))
      rows.push(h('div', { class: 'row hit', style: '--depth: 3', 'data-open': nd.id, 'data-line': x.i, title: x.text.trim() }, body))
    }
  }
  $('search-summary').textContent = hits ? `${hits} result${hits > 1 ? 's' : ''} in ${count} file${count > 1 ? 's' : ''}` : 'No results found.'
  results.replaceChildren(...rows)
}
$('search-input').addEventListener('input', later(runSearch, 200))
$('search-results').addEventListener('click', (e) => {
  const row = e.target.closest('[data-open]')
  if (!row) return
  openTab(row.dataset.open)
  if (row.dataset.line) reveal(Number(row.dataset.line))
})
// Scrolls to line i of the active file and flashes it.
function reveal(i) {
  requestAnimationFrame(() => {
    if (!$('text-editor').hidden) {
      const text = te.input.value.split('\n')
      const at = text.slice(0, i).join('\n').length + (i ? 1 : 0)
      te.input.focus()
      te.input.setSelectionRange(at, at + (text[i]?.length ?? 0))
      $('text-editor').scrollTop = i * lineHeight() - $('text-editor').clientHeight / 3
      return
    }
    landing = false
    const el = [...code.querySelectorAll('.line')][i]
    if (!el) return
    code.scrollTop = el.offsetTop - code.clientHeight / 3
    el.classList.add('flash')
    setTimeout(() => el.classList.remove('flash'), 1500)
  })
}
const lineHeight = () => (document.body.classList.contains('win') ? 19 : 18)

// Source control: conversations with unread messages are the "changes".
function renderScm(unread) {
  $('changes-count').textContent = unread.length
  const sig = JSON.stringify(unread.map((c) => [c.id, c.name]))
  if ($('changes').dataset.sig === sig) return
  $('changes').dataset.sig = sig
  $('changes').replaceChildren(...unread.map((c) => h('div', { class: 'row untracked', style: '--depth: 1', 'data-open': c.id }, fileIcon(c.name), span('label', c.name), span('description', pathOf(c).slice(1, -1).join('/')), span('deco', 'U'))))
}
$('changes').addEventListener('click', (e) => {
  const row = e.target.closest('[data-open]')
  if (row) openTab(row.dataset.open)
})
$('commit').addEventListener('click', () => toast('There are no staged changes to commit.'))
const EXTENSIONS = [
  ['Py', '#3572a5', 'Python', 'Python language support with extension access points for IntelliSense...', 'Microsoft'],
  ['Pl', '#1c6db2', 'Pylance', 'A performant, feature-rich language server for Python in VS Code', 'Microsoft'],
  ['Jp', '#f37726', 'Jupyter', 'Jupyter notebook support, interactive programming and computing...', 'Microsoft'],
  ['GL', '#2a7a3b', 'GitLens — Git supercharged', 'Supercharge Git within VS Code — Visualize code authorship at a glance...', 'GitKraken'],
  ['P', '#56b3b4', 'Prettier - Code formatter', 'Code formatter using prettier', 'Prettier'],
  ['ES', '#4b32c3', 'ESLint', 'Integrates ESLint JavaScript into VS Code.', 'Microsoft'],
  ['D', '#1d63ed', 'Docker', 'Makes it easy to create, manage, and debug containerized applications.', 'Microsoft'],
  ['R', '#007acc', 'Remote - SSH', 'Open any folder on a remote machine using SSH and take advantage of...', 'Microsoft'],
]
$('extensions').append(...EXTENSIONS.map(([logo, color, name, desc, pub]) => h('div', { class: 'ext' }, h('div', { class: 'logo', style: `background:${color}`, text: logo }), h('div', { class: 'meta' }, span('name', name), span('desc', desc), span('pub', pub)))))

// ---- the editor area ----------------------------------------------------------------------------------------------
let readme = '' // README.md: the manual
let pinned = false // the user asked for the real page (preview icon)
let rawService = null // whose page that is
let viewSig = ''
let rawNow = false
const te = { id: null, input: $('te-input'), hl: $('te-hl'), gutter: $('te-gutter'), cur: $('te-current') }

function renderEditor() {
  const nd = activeNode()
  const s = nd?.kind === 'chat' ? nd.service : rawService ?? IG
  // a dialog on the page (a prompt Instagram shows) needs the real page; ours (new message) is driven from here
  const raw = pinned || (nd?.kind === 'chat' && !s.away && !s.snap.ok && !s.ours)
  $('stage').closest('.editor').classList.toggle('raw', raw)
  for (const x of services) x.view?.classList.toggle('shown', raw && x === s)
  if (raw && !s.view) start(s)
  rawNow = raw
  // tabs
  const tabSig = JSON.stringify([tabs.list.map((id) => [id, nodeOf(id)?.name, nodeOf(id)?.t?.unread]), tabs.active])
  if ($('tab-list').dataset.sig !== tabSig) {
    $('tab-list').dataset.sig = tabSig
    $('tab-list').replaceChildren(
      ...tabs.list.map((id) => {
        const n = nodeOf(id)
        if (!n) return null
        const tab = h('div', { class: 'tab' + (id === tabs.active ? ' active' : '') + (n.t?.unread ? ' untracked' : ''), 'data-id': id, title: pathOf(n).join('/') }, fileIcon(n.name), span('name', n.name), h('span', { class: 'close', title: `Close (${keyLabel('CmdOrCtrl+W')})` }, codicon('close')))
        return tab
      }),
    )
    $('tab-list').querySelector('.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }
  // breadcrumbs
  $('breadcrumbs').replaceChildren(
    ...(nd ? pathOf(nd).slice(1) : []).flatMap((part, i, all) => [i ? codicon('chevron-right') : null, fileIcon(part, i < all.length - 1), span('', part)].filter(Boolean)),
  )
  // body
  const kind = nd?.kind
  $('watermark').hidden = !!nd
  $('text-editor').hidden = !(kind === 'file' || kind === 'settings')
  code.hidden = !(kind === 'chat' || kind === 'readme' || kind === 'activity' || kind === 'decoy')
  code.classList.toggle('wrap', wrapOn() && kind !== 'decoy')
  inputLine.hidden = kind !== 'chat'
  if (kind === 'chat') renderChat(nd)
  else if (kind === 'file' || kind === 'settings') renderText(nd)
  else if (kind === 'readme' || kind === 'activity' || kind === 'decoy') renderDoc(nd)
}

// A conversation as code, with the line being typed somewhere near the end.
function renderChat(nd) {
  const s = nd.service
  const live = liveThread(s) === nd.thread
  const rows = rowsOf(nd)
  const lang = camo.lang(nd.name)
  if (!draft.textContent) seeds[nd.id] = `${nd.id}:${rows.length}` // a new spot in the file after every message
  const header = headerFor(nd, rows)
  const pending = live ? s.snap.pending : 0
  const sig = JSON.stringify([nd.id, nd.name, rows, level(), seeds[nd.id], header, pending, s.away, wrapOn(), notSent[nd.id]])
  if (sig === viewSig && !landing) return
  viewSig = sig
  const stick = code.scrollHeight - code.scrollTop - code.clientHeight < 40
  const file = camo(rows, level(), { lang, seed: seeds[nd.id], text: draft.textContent, header })
  const at = file.findIndex((l) => l.kind === 'draft')
  const typing = file[at]
  const empty = s.away ? `not signed in to ${s.name} (the preview icon, top right, shows the sign-in page)` : 'nothing read from this chat yet'
  $('lines').replaceChildren(
    ...(rows.length ? [] : [line(span('com', camo.comment(lang, empty)))]),
    ...file.slice(0, at).map((l) => codeLine(l, lang, nd)),
    ...(notSent[nd.id] ? [line(typing.indent, span('com', camo.comment(lang, `not sent: ${notSent[nd.id]}`)))] : []),
    ...(pending ? [line(typing.indent, span('com', camo.comment(lang, `${pending} attachment(s) ready, Enter sends`)))] : []),
  )
  $('draft-pre').replaceChildren(typing.indent, ...highlight(typing.pre, lang))
  $('draft-post').replaceChildren(...highlight(typing.post, lang))
  $('after').replaceChildren(...file.slice(at + 1).map((l) => codeLine(l, lang, nd)))
  const [open, close] = camo.quotes(lang) // "..." around what is typed; nothing for plain text
  inputLine.querySelectorAll('.q').forEach((q, i) => (q.textContent = i ? close : open))
  draft.parentElement.className = open ? 'str' : ''
  quotes()
  if (landing) {
    landing = false
    code.scrollTop = code.scrollHeight
    if (!document.activeElement || document.activeElement === document.body || code.contains(document.activeElement)) focusDraft()
  } else if (stick) code.scrollTop = code.scrollHeight
}
// One line of the generated file. Messages get a gutter bar: blue = theirs, green = ours.
function codeLine(l, lang, nd) {
  const L = camo.LANGS[lang]
  if (l.kind === 'code') return mentions(line(...highlight(l.text, lang)))
  if (l.kind === 'note') {
    const el = line(l.indent, span('com', camo.comment(lang, l.text)))
    if (l.user) {
      el.lastChild.classList.add('mention')
      el.dataset.user = l.user
      el.title = 'Mention @' + l.user
    }
    return el
  }
  const literal = camo.quotes(lang)[0] ? 'str' : '' // a string, or bare text (HTML, Markdown, plain text)
  const args = [l.text != null && span(literal, L.quote(l.text)), (l.src || l.mi != null) && picture(l, lang, nd)].filter(Boolean)
  const el = line(
    l.indent,
    ...highlight(l.pre, lang),
    ...args.flatMap((arg, i) => (i ? [', ', arg] : [arg])),
    ...highlight(l.post, lang),
    ...(l.media && !l.src && l.mi == null ? ['  ', span('com', camo.comment(lang, 'media'))] : []),
  )
  el.classList.add(l.kind)
  return el
}
// "@user" in comments (the header's member list) can be clicked to mention them, like sender names.
function mentions(el) {
  for (const com of el.querySelectorAll('.com')) {
    if (!com.textContent.includes('@')) continue
    com.replaceChildren(...com.textContent.split(/(@[\w.]+)/).map((part) => (part.startsWith('@') ? Object.assign(span('mention', part), { title: 'Mention ' + part }) : part)))
    com.querySelectorAll('.mention').forEach((m) => (m.dataset.user = m.textContent.slice(1)))
  }
  return el
}
// A picture argument, e.g. open("photo.jpg"), with the picture itself in a hover card. Pictures the window can't
// load itself (blob: previews, videos, stories) are fetched from the page on first hover.
function picture(l, lang, nd) {
  const L = camo.LANGS[lang]
  const el = span('media', '')
  const img = new Image()
  // only while the page shows this conversation: mi points into what it has rendered
  const fromPage = () => nd && l.mi != null && liveThread(nd.service) === nd.thread && nd.service.view.executeJavaScript(nd.service.G.media(l.mi)).then((url) => url && (img.src = url))
  img.onerror = () => {
    img.removeAttribute('src')
    fromPage()
  }
  el.addEventListener('mouseenter', () => img.getAttribute('src') || (l.src ? (img.src = l.src) : fromPage()))
  el.append(...highlight(L.open[0], lang), span(camo.quotes(lang)[0] ? 'str' : '', L.quote(l.src ? camo.file(l.src) : 'media.jpg')), ...highlight(L.open[1], lang), img)
  return el
}

// README, activity.log and main.py: generated text in the code view.
function renderDoc(nd) {
  const lang = camo.lang(nd.name)
  if (nd.kind === 'decoy') return renderDecoy(nd, lang)
  const sig = JSON.stringify([nd.kind, nd.name, nd.kind === 'readme' ? readme.length : [activity, level()]])
  if (sig === viewSig) return
  const first = !viewSig.startsWith(`["${nd.kind}"`)
  viewSig = sig
  if (nd.kind === 'readme') $('lines').replaceChildren(...readme.trimEnd().split('\n').map((l) => line(...markdownLine(l))))
  else $('lines').replaceChildren(...camo(activityRows(), level(), { lang, header: activityHeader() }).map((l) => codeLine(l, lang, null)))
  $('after').replaceChildren()
  if (first) code.scrollTop = 0
}

// ---- main.py: the decoy. Any key types out real code, a few characters at a time -----------------------------------
const corpus = {}
const decoyText = (nd) => (corpus[camo.lang(nd.name)] ??= camo.corpus(camo.lang(nd.name)).repeat(3))
function renderDecoy(nd, lang) {
  const text = decoyText(nd)
  nd.typed ??= text.split('\n').slice(0, 42).join('\n').length + 1 // a file already half written
  const sig = JSON.stringify(['decoy', nd.name, nd.typed])
  if (sig === viewSig) return
  viewSig = sig
  const lines = text.slice(0, nd.typed).split('\n')
  $('lines').replaceChildren(...lines.map((l, i) => line(...highlight(l, lang), ...(i === lines.length - 1 ? [span('caret', '')] : []))))
  $('after').replaceChildren()
  const caret = code.querySelector('.caret')?.parentElement
  if (caret && caret.offsetTop + caret.offsetHeight > code.scrollTop + code.clientHeight) code.scrollTop = caret.offsetTop + caret.offsetHeight - code.clientHeight + 40
  else if (caret && caret.offsetTop < code.scrollTop) code.scrollTop = caret.offsetTop - 40
}
code.addEventListener('keydown', (e) => {
  const nd = activeNode()
  if (nd?.kind !== 'decoy' || e.metaKey || e.ctrlKey || e.altKey) return
  const text = decoyText(nd)
  if (e.key === 'Backspace') nd.typed = Math.max(0, nd.typed - 1)
  else if (e.key === 'Enter') nd.typed = text.indexOf('\n', nd.typed) + 1 || text.length
  else if (e.key.length === 1 || e.key === 'Tab' || e.key === 'Process' || e.key === 'Unidentified') nd.typed = Math.min(text.length, nd.typed + 2 + Math.floor(Math.random() * 3))
  else return
  e.preventDefault()
  if (nd.typed >= text.length) nd.typed = 0 // all typed out: start the file over
  saveWs()
  render()
})

// ---- a real editor for the user's own files and settings.json --------------------------------------------------------
function renderText(nd) {
  const lang = camo.lang(nd.name)
  if (te.id !== nd.id || te.lang !== lang) {
    te.id = nd.id
    te.lang = lang
    if (te.input.value !== textOf(nd)) te.input.value = textOf(nd)
    paintText()
  }
}
function paintText() {
  const text = te.input.value
  const lines = text.split('\n')
  te.hl.replaceChildren(...lines.flatMap((l, i) => [i ? '\n' : '', ...highlight(l, te.lang)]), '\n')
  te.gutter.textContent = lines.map((_, i) => i + 1).join('\n')
  te.cur.style.top = text.slice(0, te.input.selectionStart).split('\n').length * lineHeight() - lineHeight() + 'px'
  renderStatus()
}
const saveText = later(() => saveWs(), 400)
const reloadSettings = later(applySettings, 500)
te.input.addEventListener('input', () => {
  const nd = activeNode()
  if (nd?.kind === 'settings') {
    settingsText = te.input.value
    localStorage.setItem('vsc.settings', settingsText)
    reloadSettings()
  } else if (nd?.kind === 'file') {
    nd.text = te.input.value
    saveText()
  }
  paintText()
})
for (const ev of ['keyup', 'click', 'select']) te.input.addEventListener(ev, paintText)
te.input.addEventListener('keydown', (e) => {
  const unit = camo.LANGS[te.lang].indent
  const { selectionStart: from, selectionEnd: to, value } = te.input
  const lineStart = value.lastIndexOf('\n', from - 1) + 1
  const insert = (text) => document.execCommand('insertText', false, text) // keeps undo working
  if (e.key === 'Tab' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
    e.preventDefault()
    insert(unit)
  } else if (e.key === 'Tab' && e.shiftKey) {
    e.preventDefault()
    const removed = Math.min(/^[ \t]*/.exec(value.slice(lineStart))[0].length, unit.length)
    if (!removed) return
    te.input.setSelectionRange(lineStart, lineStart + removed)
    insert('')
    te.input.setSelectionRange(Math.max(lineStart, from - removed), Math.max(lineStart, to - removed)) // Chromium parks it before a final newline
  } else if (e.key === 'Enter' && !e.isComposing && !e.metaKey && !e.ctrlKey) {
    e.preventDefault()
    const current = value.slice(lineStart, from)
    const lead = /^[ \t]*/.exec(current)[0]
    insert('\n' + lead + (/[:{[(]\s*$/.test(current) ? unit : ''))
  } else if (e.key === '/' && (mac ? e.metaKey : e.ctrlKey)) {
    e.preventDefault()
    commentLines(from, to)
  }
})
// Toggles a line comment on the selected lines, as Cmd+/ does.
function commentLines(from, to) {
  const { comment: mark, commentEnd: tail = '' } = camo.LANGS[te.lang] // "# ", or "<!-- " and " -->"
  const value = te.input.value
  const start = value.lastIndexOf('\n', from - 1) + 1
  const end = value.indexOf('\n', to) < 0 ? value.length : value.indexOf('\n', to)
  const lines = value.slice(start, end).split('\n')
  const on = lines.every((l) => !l.trim() || l.trimStart().startsWith(mark.trim()))
  const strip = (l) => {
    const body = l.replace(mark, '').replace(mark.trim(), '')
    return tail && body.trimEnd().endsWith(tail.trim()) ? body.trimEnd().slice(0, -tail.trim().length).trimEnd() : body
  }
  const next = lines.map((l) => (!l.trim() ? l : on ? strip(l) : l.replace(/^(\s*)/, `$1${mark}`) + tail)).join('\n')
  te.input.setSelectionRange(start, end)
  document.execCommand('insertText', false, next)
  te.input.setSelectionRange(start, start + next.length)
}

// ---- the input line: typing, sending, mentions, attachments ------------------------------------------------------------
const notSent = {} // chat id -> text that could not go out
// The typing line reads `reply = input()` until there is text, then `reply = input("...")`.
const quotes = () => inputLine.classList.toggle('empty', !draft.textContent)
function focusDraft() {
  draft.focus()
  const range = document.createRange()
  range.selectNodeContents(draft)
  range.collapse(false)
  getSelection().removeAllRanges()
  getSelection().addRange(range)
}
function focusEditor() {
  const nd = activeNode()
  if (quickState) quickState.el.querySelector('input').focus() // a picker is open: it keeps the keyboard
  else if (nd?.kind === 'chat') focusDraft()
  else if (nd?.kind === 'file' || nd?.kind === 'settings') te.input.focus()
  else if (nd) code.focus()
}
draft.addEventListener('input', () => {
  quotes()
  const nd = activeNode()
  if (nd?.kind === 'chat') drafts[nd.id] = draft.textContent
  suggest()
  renderStatus()
})
draft.addEventListener('keydown', (e) => {
  if (suggestion && suggestKey(e)) return
  if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return
  e.preventDefault()
  if (e.shiftKey) document.execCommand('insertText', false, '\n')
  else sendDraft()
})
draft.addEventListener('keyup', (e) => /Arrow|Home|End/.test(e.key) && suggest())

// Enter sends the input line to the conversation the file belongs to. The text leaves the line at once, so the next
// message can be typed while this one goes out; if it doesn't go out, it comes back.
async function sendDraft() {
  const nd = activeNode()
  if (nd?.kind !== 'chat') return
  const s = nd.service
  const text = draft.textContent.replace(/\u00a0/g, ' ')
  const live = liveThread(s) === nd.thread
  if ((!text.trim() && !(live && s.snap.pending)) || s.away) return
  draft.textContent = ''
  drafts[nd.id] = ''
  delete notSent[nd.id]
  quotes()
  closeSuggest()
  code.scrollTop = code.scrollHeight
  const result = await queue(s, async () => {
    if (liveThread(s) !== nd.thread) {
      await s.view.executeJavaScript(s.G.openThread(nd.thread, s.threads.find((t) => t.name === nd.thread)?.y))
      await sleep(1500)
    }
    let r = await s.view.executeJavaScript(s.G.send(text.trim() ? text : '', nd.thread))
    if (r?.why === 'thread') {
      await s.view.executeJavaScript(s.G.openThread(nd.thread, null))
      await sleep(1500)
      r = await s.view.executeJavaScript(s.G.send(text.trim() ? text : '', nd.thread))
    }
    return r
  })
  if (result?.ok || !text.trim()) return render()
  if (!draft.textContent && activeNode()?.id === nd.id) {
    draft.textContent = text // nothing typed since: put it back on the line
    drafts[nd.id] = text
    quotes()
  } else notSent[nd.id] = text
  render()
}

// Mentions: "@" on the input line opens a suggestion list of the people in the conversation, like IntelliSense.
let suggestion = null // { el, items, at, start }
function suggest() {
  const nd = activeNode()
  const sel = getSelection()
  if (nd?.kind !== 'chat' || !sel.rangeCount || !draft.contains(sel.anchorNode)) return closeSuggest()
  const before = draft.textContent.slice(0, caretOffset())
  const m = /(?:^|\s)@([\w.]*)$/.exec(before)
  if (!m) return closeSuggest()
  const rows = rowsOf(nd)
  const labels = new Map(rows.filter((r) => r.user).map((r) => [r.user, r.text]))
  const people = participants(nd, rows)
  const items = people.filter((u) => u.toLowerCase().startsWith(m[1].toLowerCase()) || labels.get(u)?.toLowerCase().startsWith(m[1].toLowerCase()))
  if (!items.length) return closeSuggest()
  const rect = sel.getRangeAt(0).getBoundingClientRect()
  suggestion?.el.remove()
  const el = h('div', { class: 'suggest' }, ...items.map((u, i) => h('div', { class: 'suggest-item' + (i ? '' : ' selected'), 'data-i': i }, codicon('symbol-field'), span('', u), span('description', labels.get(u) ?? ''))))
  document.body.append(el)
  el.style.left = Math.max(4, rect.left - m[1].length * 7 - 8) + 'px'
  el.style.top = Math.max(4, rect.top - el.offsetHeight - 4) + 'px' // above the line, as asked
  el.addEventListener('mousedown', (e) => {
    e.preventDefault()
    const item = e.target.closest('.suggest-item')
    if (item) accept(Number(item.dataset.i))
  })
  suggestion = { el, items, at: 0, start: before.length - m[1].length - 1 }
}
function suggestKey(e) {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    suggestion.at = (suggestion.at + (e.key === 'ArrowDown' ? 1 : -1) + suggestion.items.length) % suggestion.items.length
    suggestion.el.querySelectorAll('.suggest-item').forEach((item, i) => item.classList.toggle('selected', i === suggestion.at))
  } else if ((e.key === 'Enter' || e.key === 'Tab') && !e.isComposing) accept(suggestion.at)
  else if (e.key === 'Escape') closeSuggest()
  else return false
  e.preventDefault()
  e.stopPropagation()
  return true
}
function accept(i) {
  const { items, start } = suggestion
  const end = caretOffset()
  closeSuggest()
  insertMention(items[i], start, end)
}
function closeSuggest() {
  suggestion?.el.remove()
  suggestion = null
}
const caretOffset = () => {
  const sel = getSelection()
  if (!sel.rangeCount) return draft.textContent.length
  const range = document.createRange()
  range.selectNodeContents(draft)
  range.setEnd(sel.anchorNode, sel.anchorOffset)
  return range.toString().length
}
// Puts "@user " into the input line, replacing text[start, end) (the typed "@que"), or at the end.
function insertMention(user, start, end) {
  const text = draft.textContent
  if (start == null) {
    start = end = text.length
    if (text && !/\s$/.test(text)) user = ' @' + user
    else user = '@' + user
  } else user = '@' + user
  draft.textContent = text.slice(0, start) + user + ' ' + text.slice(end)
  const nd = activeNode()
  if (nd?.kind === 'chat') drafts[nd.id] = draft.textContent
  quotes()
  draft.focus()
  const at = start + user.length + 1
  const range = document.createRange()
  range.setStart(draft.firstChild ?? draft, Math.min(at, draft.textContent.length))
  range.collapse(true)
  getSelection().removeAllRanges()
  getSelection().addRange(range)
}
// a click on a sender's name (a comment line) mentions them
code.addEventListener('mousedown', (e) => {
  const target = e.target.closest('[data-user]')
  if (!target || activeNode()?.kind !== 'chat') return
  e.preventDefault()
  insertMention(target.dataset.user)
})

// Attach: paste (Cmd+V) or drop files on the editor, or Cmd+O for the site's own file picker.
// Pasted/dropped files are handed to the page's upload input, as if picked there.
const dataUrl = (file) =>
  new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.readAsDataURL(file)
  })
async function attach(files) {
  const nd = activeNode()
  if (nd?.kind !== 'chat' || !files.length) return
  const payload = await Promise.all(files.map(async (f) => ({ name: f.name || 'image.png', type: f.type, data: (await dataUrl(f)).split(',')[1] })))
  page(nd.service, nd.service.G.attach(payload))
}
draft.addEventListener('paste', (e) => {
  if (!e.clipboardData.files.length) return // plain text pastes into the draft as usual
  e.preventDefault()
  attach([...e.clipboardData.files])
})
code.addEventListener('dragover', (e) => e.preventDefault())
code.addEventListener('drop', (e) => {
  e.preventDefault()
  attach([...e.dataTransfer.files])
})
code.addEventListener('click', (e) => {
  const kind = activeNode()?.kind
  if (kind === 'decoy') return code.focus()
  if (kind === 'chat' && !getSelection().toString() && !e.target.closest('[data-user]') && !draft.contains(e.target)) focusDraft()
})
// Scrolling past either end of the file pages the site's own list, which loads older messages.
let paged = 0
code.addEventListener(
  'wheel',
  (e) => {
    const nd = activeNode()
    if (nd?.kind !== 'chat') return
    const up = e.deltaY < 0
    const atEnd = up ? code.scrollTop === 0 : code.scrollHeight - code.scrollTop - code.clientHeight < 2
    if (!atEnd || Date.now() - paged < 400) return
    paged = Date.now()
    page(nd.service, nd.service.G.page(up ? -1 : 1))
  },
  { passive: true },
)

// ---- activity.log: Instagram's notifications, with a marker where they were last read -----------------------------------
const activity = load('vsc.activity', { items: [], seen: [], checkedAt: 0, fetchedAt: 0 })
const activityKey = (it) => `${it.kind}|${it.text}`
async function fetchActivity(force) {
  if (IG.away || !IG.view || (!force && Date.now() - activity.fetchedAt < 30000)) return
  activity.fetchedAt = Date.now()
  IG.busy++ // the drawer covers the page for a moment: don't read it meanwhile
  try {
    const items = await page(IG, IG.G.activity)
    if (items) activity.items = items
    save('vsc.activity', activity)
  } finally {
    IG.busy--
  }
  render()
}
function markActivitySeen() {
  if (!activity.items.length) return
  activity.seen = activity.items.map(activityKey)
  activity.checkedAt = Date.now()
  save('vsc.activity', activity)
}
const activityHeader = () => ['Activity feed: likes, follows, comments', `Updated ${activity.fetchedAt ? fmtTime(activity.fetchedAt) : 'never'}`]
function activityRows() {
  const rows = []
  let section = null
  let marked = !activity.checkedAt
  for (const it of activity.items) {
    if (!marked && activity.seen.includes(activityKey(it))) {
      rows.push({ side: 'note', text: `---- last checked ${fmtTime(activity.checkedAt)} ----` })
      marked = true
    }
    if (it.section !== section) rows.push({ side: 'note', text: (section = it.section) || 'earlier' })
    rows.push({ side: 'recv', text: `[${it.kind}] ${it.text}${it.when ? ' · ' + it.when : ''}` })
  }
  if (!rows.length) rows.push({ side: 'note', text: IG.away ? 'not signed in' : 'loading...' })
  return rows
}

// ---- a new conversation: Instagram's "To:" search, as a quick pick ----------------------------------------------------
function newChat() {
  if (IG.away) return toast('Sign in first: the preview icon (top right) shows the sign-in page.')
  IG.ours = true // its dialog is driven from here: don't switch to the real page for it
  let picked = false
  quick({
    placeholder: 'To: search people by name or username',
    mode: 'async',
    items: async (q) => {
      const people = (await page(IG, IG.G.people(q))) ?? []
      return people.map((p, i) => ({ label: p.name || p.user, description: p.user && p.name ? '@' + p.user : '', icon: 'account', i, p }))
    },
    accept: async (item) => {
      if (!item) {
        IG.ours = false
        return page(IG, IG.G.closeDialog)
      }
      picked = true
      const ok = await page(IG, IG.G.chatWith(item.i))
      IG.ours = false
      if (!ok) return toast('Could not open that conversation; the real page is under the preview icon.')
      const name = item.p.name || item.p.user
      if (!IG.threads.some((t) => t.name === name)) merge(IG, [{ name, preview: '', unread: false, group: false, y: -1 }])
      chatList = null
      openTab(chatId(IG, name))
    },
    cancel: () => {
      if (picked) return
      IG.ours = false
      page(IG, IG.G.closeDialog)
    },
  })
}

// ---- quick input: Go to File (Cmd+P), the command palette (Cmd+Shift+P), pickers ------------------------------------------
let quickState = null
function quick({ placeholder, value = '', items, accept, cancel, mode }) {
  closeOverlays()
  const input = h('input', { placeholder, spellcheck: 'false', value })
  const list = h('div', { class: 'quick-list' })
  const el = h('div', { class: 'quick' }, h('div', { class: 'field' }, input), list)
  document.body.append(el)
  const state = (quickState = { el, items: [], at: 0, seq: 0, cancel, mode })
  const show = async () => {
    const seq = ++state.seq
    const found = await items(input.value)
    if (seq !== state.seq || quickState !== state) return // a newer query is on its way
    state.items = found ?? []
    state.at = 0
    list.replaceChildren(
      ...(state.items.length
        ? state.items.map((it, i) => h('div', { class: 'quick-item' + (i ? '' : ' selected'), 'data-i': i }, it.icon ? codicon(it.icon) : it.file != null ? fileIcon(it.file) : it.fileIcon ? fileIcon(it.label) : null, span('label', ''), it.description ? span('description', it.description) : null, it.keys ? span('keys', it.keys) : null))
        : [h('div', { class: 'quick-empty', text: input.value ? 'No matching results' : '' })]),
    )
    list.querySelectorAll('.quick-item .label').forEach((label, i) => label.append(...marked(state.items[i].label, state.items[i].match)))
  }
  const choose = (i) => {
    const it = state.items[i]
    const q = input.value
    closeQuick(false)
    accept(it, q)
  }
  input.addEventListener('input', mode === 'async' ? later(show, 250) : show) // filtered before an Enter right after it
  input.addEventListener('keydown', (e) => {
    e.stopPropagation()
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!state.items.length) return
      state.at = (state.at + (e.key === 'ArrowDown' ? 1 : -1) + state.items.length) % state.items.length
      list.querySelectorAll('.quick-item').forEach((it, i) => it.classList.toggle('selected', i === state.at))
      list.querySelector('.selected')?.scrollIntoView({ block: 'nearest' })
    } else if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault()
      choose(state.at)
    } else if (e.key === 'Escape') closeQuick()
  })
  list.addEventListener('mousedown', (e) => {
    e.preventDefault()
    const item = e.target.closest('.quick-item')
    if (item) choose(Number(item.dataset.i))
  })
  input.addEventListener('blur', () => setTimeout(() => quickState === state && document.activeElement !== input && closeQuick(), 100))
  input.focus()
  if (mode === 'prefix') input.setSelectionRange(value.length, value.length) // keep the ">" of the command palette
  else input.select()
  show()
  return state
}
function closeQuick(cancelled = true) {
  const state = quickState
  if (!state) return
  quickState = null
  const had = state.el.contains(document.activeElement)
  state.el.remove()
  if (had) focusEditor() // the keyboard goes back to the editor, as in VS Code
  if (cancelled) state.cancel?.()
}
// highlight what matched: indexes of the label's matched characters
function marked(label, match) {
  if (!match?.length) return [label]
  const set = new Set(match)
  return [...label].map((c, i) => (set.has(i) ? h('b', { text: c }) : c))
}
// fuzzy: the query's characters in order; contiguous and early matches rank first
function fuzzy(label, q) {
  if (!q) return { score: 0, match: [] }
  const lower = label.toLowerCase()
  const at = lower.indexOf(q.toLowerCase())
  if (at >= 0) return { score: 1000 - at, match: [...q].map((_, i) => at + i) }
  const match = []
  let from = 0
  for (const c of q.toLowerCase()) {
    const i = lower.indexOf(c, from)
    if (i < 0) return null
    match.push(i)
    from = i + 1
  }
  return { score: 100 - (match.at(-1) - match[0]), match }
}
function quickOpen(prefix = '') {
  quick({
    placeholder: 'Search files by name (append : to go to line or @ to go to symbol)',
    value: prefix,
    mode: prefix ? 'prefix' : null,
    items: (q) => {
      if (q.startsWith('>')) return commandItems(q.slice(1).trim())
      const files = [...Object.values(ws.nodes).filter((n) => !isFolder(n)), ...chats()]
      const query = q.trim()
      const found = files
        .map((nd) => {
          const m = fuzzy(nd.name, query) ?? (nd.thread && norm(nd.thread).toLowerCase().includes(query.toLowerCase()) ? { score: 1, match: [] } : null)
          return m && { label: nd.name, description: pathOf(nd).slice(1, -1).join('/'), fileIcon: true, id: nd.id, score: m.score + (recent.includes(nd.id) && !query ? 2000 + recent.indexOf(nd.id) : 0), match: m.match }
        })
        .filter(Boolean)
        .sort((a, b) => b.score - a.score)
        .slice(0, 60)
      // buried conversations: load more of the list and search again
      if (query && !IG.away) found.push({ label: 'Search older conversations...', description: 'loads more of the list', icon: 'history', more: query })
      return found
    },
    accept: async (it, q) => {
      if (!it) return
      if (it.run) return it.run()
      if (it.more) {
        toast('Loading older conversations...')
        await loadMore(IG, 10)
        return quickOpen(q)
      }
      openTab(it.id)
    },
  })
}
function commandItems(q) {
  return Object.entries(COMMANDS)
    .filter(([, c]) => c.title)
    .map(([id, c]) => {
      const m = fuzzy(c.title, q)
      return m && { label: c.title, keys: c.key ? keyLabel(c.key) : '', score: m.score, match: m.match, run: () => run(id) }
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
}
// Select Language Mode (the language in the status bar): every language VS Code knows, by name. Picking one gives
// the file that language's extension, the way the language of a file on disk follows its name.
function changeLanguage() {
  const nd = activeNode()
  if (!nd || isFolder(nd) || nd.kind === 'readme' || nd.kind === 'settings') return
  const current = camo.lang(nd.name)
  const langs = Object.entries(camo.LANGUAGES).filter(([, l]) => l.exts.length)
  quick({
    placeholder: 'Select Language Mode',
    items: (q) =>
      langs
        .map(([id, l]) => {
          const m = fuzzy(l.name, q) ?? (fuzzy(id, q) && { score: 0, match: [] })
          return m && { label: l.name, description: `(${id})${id === current ? ' - Configured Language' : ''}`, file: 'x' + l.exts[0], ext: l.exts[0].slice(1), match: m.match, score: m.score }
        })
        .filter(Boolean)
        .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label)),
    accept: (it) => {
      if (!it) return
      // the whole extension of the old language goes (a.agent.md -> a.html), else the last one
      const old = camo.LANGUAGES[current]?.exts.filter((e) => nd.name.toLowerCase().endsWith(e.toLowerCase())).sort((a, b) => b.length - a.length)[0]
      renameTo(nd, (old ? nd.name.slice(0, -old.length) : nd.name.replace(/\.[^.]*$/, '')) + '.' + it.ext)
    },
  })
}
function renameTo(nd, name) {
  const fresh = freeName(nd.parent, name, nd.id)
  if (ws.chats[nd.id]) ws.chats[nd.id].name = fresh
  else if (ws.nodes[nd.id]) ws.nodes[nd.id].name = fresh
  chatList = null
  te.id = null
  saveWs()
  render()
}
// The file type of the conversation files (files.defaultLanguage), asked on the first start: every extension VS Code
// has a language for, and every one the icon theme has an icon for. The usual ones first.
const POPULAR = 'py js ts jsx tsx java kt swift c cpp h cs go rs dart php rb sh ps1 bat sql html css scss json yaml toml md txt log lua pl r jl scala ex erl hs ml clj fs vb m groovy coffee zig vue svelte tf sol graphql csv xml ini env diff tex mk cmake'.split(' ')
function fileTypes() {
  const exts = new Set([...Object.values(camo.LANGUAGES).flatMap((l) => l.exts.map((e) => e.slice(1).toLowerCase())), ...Object.keys(MATERIAL.fileExtensions)])
  const rank = (ext) => (POPULAR.includes(ext) ? POPULAR.indexOf(ext) : camo.lang('x.' + ext, null) ? 1000 : 2000)
  return [...exts].filter((ext) => /^[\w+#-]+(\.[\w+#-]+)*$/.test(ext)).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
}
function pickFileType() {
  const current = defaultExt()
  const all = fileTypes().map((ext) => ({ label: '.' + ext, description: camo.LANGS[camo.lang('x.' + ext)].name + (ext === current ? ' (current)' : ''), file: 'x.' + ext, ext }))
  quick({
    placeholder: 'Select the file type for conversations (files.defaultLanguage), e.g. py, kt, swift, sql',
    items: (q) => {
      const query = q.trim().replace(/^\./, '')
      if (!query) return all
      return all
        .map((it) => {
          const m = fuzzy(it.ext, query)
          return m ? { ...it, score: m.score + 2000, match: m.match.map((i) => i + 1) } : it.description.toLowerCase().includes(query.toLowerCase()) && { ...it, score: 1, match: [] }
        })
        .filter(Boolean)
        .sort((a, b) => b.score - a.score)
    },
    accept: (it) => it && it.ext !== current && setSetting('files.defaultLanguage', it.ext),
  })
}

// ---- context menus and the Windows menu bar ---------------------------------------------------------------------------------
let menuState = null
function menu(x, y, items, { onClose } = {}) {
  closeOverlays()
  const el = h('div', { class: 'menu', tabindex: '-1' })
  const live = items.filter((it) => it === '-' || !it.hidden)
  el.append(
    ...live.map((it, i) =>
      it === '-'
        ? h('hr')
        : h('div', { class: 'menu-item' + (it.disabled ? ' disabled' : ''), 'data-i': i }, span('', it.label), it.key ? span('keys', keyLabel(it.key)) : null),
    ),
  )
  document.body.append(el)
  el.style.left = Math.min(x, innerWidth - el.offsetWidth - 4) + 'px'
  el.style.top = Math.min(y, innerHeight - el.offsetHeight - 4) + 'px'
  el.addEventListener('mousedown', (e) => e.preventDefault())
  el.addEventListener('click', (e) => {
    const item = e.target.closest('.menu-item')
    if (!item) return
    closeMenu()
    live[Number(item.dataset.i)].run?.()
  })
  el.addEventListener('keydown', (e) => {
    const rows = [...el.querySelectorAll('.menu-item:not(.disabled)')]
    const at = rows.findIndex((r) => r.classList.contains('selected'))
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      rows.forEach((r) => r.classList.remove('selected'))
      rows[(at + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length]?.classList.add('selected')
    } else if (e.key === 'Enter') rows[at]?.click()
    else if (e.key === 'Escape') closeMenu()
    else return
    e.preventDefault()
    e.stopPropagation()
  })
  el.focus()
  menuState = { el, onClose }
}
function closeMenu() {
  const state = menuState
  if (!state) return
  menuState = null
  state.el.remove()
  state.onClose?.()
}
const closeOverlays = () => {
  closeMenu()
  closeQuick()
  closeSuggest()
}
addEventListener('mousedown', (e) => {
  if (menuState && !menuState.el.contains(e.target) && !e.target.closest('.menubar')) closeMenu()
  if (quickState && !quickState.el.contains(e.target)) closeQuick()
  if (suggestion && !suggestion.el.contains(e.target)) closeSuggest()
})
addEventListener('blur', () => closeMenu())

// ---- commands, menus, keys -------------------------------------------------------------------------------------------------
const COMMANDS = {
  'workbench.action.quickOpen': { title: 'Go to File...', key: 'CmdOrCtrl+P', run: () => quickOpen() },
  'workbench.action.showCommands': { title: 'Show All Commands', key: 'CmdOrCtrl+Shift+P', run: () => quickOpen('>') },
  'workbench.action.toggleSidebarVisibility': { title: 'View: Toggle Primary Side Bar Visibility', key: 'CmdOrCtrl+B', run: () => ((sidebar = !sidebar), render()) },
  'workbench.action.togglePanel': { title: 'View: Toggle Panel Visibility', key: 'CmdOrCtrl+J', run: () => togglePanel() },
  'workbench.action.terminal.toggleTerminal': { title: 'View: Toggle Terminal', key: 'Ctrl+`', run: () => (panelOpen && panelTab === 'terminal' ? togglePanel() : showTerminal()) },
  'workbench.action.terminal.new': { title: 'Terminal: Create New Terminal', key: 'Ctrl+Shift+`', run: () => showTerminal() },
  'workbench.action.terminal.kill': { title: 'Terminal: Kill the Active Terminal Instance', run: () => killTerminal() },
  'workbench.action.terminal.clear': { title: 'Terminal: Clear', run: () => $('term-out').replaceChildren() },
  'workbench.actions.view.problems': { title: 'View: Focus Problems', key: 'CmdOrCtrl+Shift+M', run: () => showPanel('problems') },
  'workbench.view.explorer': { title: 'View: Show Explorer', key: 'CmdOrCtrl+Shift+E', run: () => showView('explorer') },
  'workbench.view.search': { title: 'View: Show Search', key: 'CmdOrCtrl+Shift+F', run: () => showView('search') },
  'workbench.view.scm': { title: 'View: Show Source Control', key: 'Ctrl+Shift+G', run: () => showView('scm') },
  'workbench.view.debug': { title: 'View: Show Run and Debug', key: 'CmdOrCtrl+Shift+D', run: () => showView('debug') },
  'workbench.view.extensions': { title: 'View: Show Extensions', key: 'CmdOrCtrl+Shift+X', run: () => showView('extensions') },
  'actions.find': { title: 'Find', key: 'CmdOrCtrl+F', run: () => showView('search') },
  'workbench.action.closeActiveEditor': { title: 'View: Close Editor', key: 'CmdOrCtrl+W', run: () => closeTab() },
  'workbench.action.reopenClosedEditor': { title: 'View: Reopen Closed Editor', key: 'CmdOrCtrl+Shift+T', run: () => reopenClosed() },
  'workbench.action.nextEditor': { title: 'View: Open Next Editor', key: 'Ctrl+Tab', run: () => cycleTab(1) },
  'workbench.action.previousEditor': { title: 'View: Open Previous Editor', key: 'Ctrl+Shift+Tab', run: () => cycleTab(-1) },
  'workbench.action.navigateBack': { title: 'Go Back', key: mac ? 'Ctrl+-' : 'Alt+Left', run: () => navigate(-1) },
  'workbench.action.navigateForward': { title: 'Go Forward', key: mac ? 'Ctrl+Shift+-' : 'Alt+Right', run: () => navigate(1) },
  'workbench.action.openSettings': { title: 'Preferences: Open User Settings (JSON)', key: 'CmdOrCtrl+,', run: () => openTab('settings') },
  'workbench.action.files.save': { title: 'File: Save', key: 'CmdOrCtrl+S', run: () => saveWs() },
  'explorer.newFile': { title: 'File: New File...', key: 'CmdOrCtrl+N', run: () => newItem('file') },
  'explorer.newFolder': { title: 'File: New Folder...', run: () => newItem('folder') },
  'explorer.collapse': { title: 'Collapse Folders in Explorer', run: () => ((ws.open = { root: true }), render()) },
  'renameFile': { title: 'File: Rename...', key: 'F2', run: () => rename(selected ?? tabs.active) },
  'deleteFile': { title: 'File: Delete', run: () => remove(selected ?? tabs.active) },
  'editor.action.toggleWordWrap': { title: 'View: Toggle Word Wrap', key: 'Alt+Z', run: () => setSetting('editor.wordWrap', wrapOn() ? 'off' : 'on') },
  'workbench.action.editor.changeLanguageMode': { title: 'Change Language Mode', run: () => changeLanguage() },
  'direct.fileType': { title: 'Direct: Change File Type of Conversations...', run: () => pickFileType() },
  'workbench.action.debug.start': { title: 'Debug: Start Debugging', key: 'F5', run: () => runFile() },
  'workbench.action.debug.run': { title: 'Debug: Run Without Debugging', key: 'Ctrl+F5', run: () => runFile() },
  'direct.new': { title: 'Direct: New Message...', run: () => newChat() },
  'direct.loadMore': { title: 'Direct: Load Older Conversations', run: () => loadMore(IG, 6) },
  'direct.togglePage': { title: 'Direct: Toggle Site Page', run: () => togglePage() },
  'direct.attach': { title: 'Direct: Attach File...', key: 'CmdOrCtrl+O', run: () => activeNode()?.kind === 'chat' && page(activeNode().service, activeNode().service.G.pick) },
  'direct.activity': { title: 'Direct: Refresh Activity', run: () => (openTab('activity'), fetchActivity(true)) },
  'workbench.action.focusDecoy': { title: 'View: Focus main.py', run: () => panic() },
  'help.readme': { title: 'Help: Show README', run: () => openTab('readme') },
  'search.clear': { title: 'Search: Clear Search Results', run: () => (($('search-input').value = ''), runSearch()) },
}
const run = (id) => COMMANDS[id]?.run()
const MENUS = [
  { label: 'File', items: ['explorer.newFile', 'explorer.newFolder', 'direct.new', '-', 'workbench.action.files.save', '-', 'workbench.action.openSettings', '-', 'workbench.action.reopenClosedEditor', 'workbench.action.closeActiveEditor'] },
  { label: 'Edit', items: [{ role: 'undo', label: 'Undo', key: 'CmdOrCtrl+Z' }, { role: 'redo', label: 'Redo', key: 'CmdOrCtrl+Shift+Z' }, '-', { role: 'cut', label: 'Cut', key: 'CmdOrCtrl+X' }, { role: 'copy', label: 'Copy', key: 'CmdOrCtrl+C' }, { role: 'paste', label: 'Paste', key: 'CmdOrCtrl+V' }, '-', 'actions.find', 'workbench.view.search'] },
  { label: 'Selection', items: [{ role: 'selectAll', label: 'Select All', key: 'CmdOrCtrl+A' }] },
  { label: 'View', items: ['workbench.action.showCommands', '-', 'workbench.view.explorer', 'workbench.view.search', 'workbench.view.scm', 'workbench.view.debug', 'workbench.view.extensions', '-', 'workbench.actions.view.problems', 'workbench.action.terminal.toggleTerminal', '-', 'editor.action.toggleWordWrap', 'workbench.action.toggleSidebarVisibility', 'workbench.action.togglePanel'] },
  { label: 'Go', items: ['workbench.action.navigateBack', 'workbench.action.navigateForward', '-', 'workbench.action.quickOpen', '-', 'workbench.action.nextEditor', 'workbench.action.previousEditor'] },
  { label: 'Run', items: ['workbench.action.debug.start', 'workbench.action.debug.run'] },
  { label: 'Terminal', items: ['workbench.action.terminal.new', 'workbench.action.terminal.kill', 'workbench.action.terminal.clear'] },
  { label: 'Window', role: 'windowMenu' },
  { label: 'Help', items: ['help.readme', '-', { role: 'toggleDevTools', label: 'Toggle Developer Tools' }] },
]
const menuItem = (it) => (it === '-' ? '-' : typeof it === 'string' ? { label: COMMANDS[it].title.replace(/^[\w ]+: /, ''), key: COMMANDS[it].key, cmd: it } : it)
native?.setMenu(MENUS.map((m) => ({ label: m.label, role: m.role, items: m.items?.map(menuItem) })))
native?.onCommand(run)
// Windows/Linux: the same menus in the title bar
const menubar = document.querySelector('.menubar')
let menubarOpen = null
for (const m of MENUS.filter((x) => x.items)) {
  const button = h('button', { text: m.label })
  const open = () => {
    const r = button.getBoundingClientRect()
    menubarOpen = button
    button.classList.add('open')
    menu(
      r.left,
      r.bottom,
      m.items.map(menuItem).map((it) => (it === '-' ? it : it.role ? { ...it, hidden: it.role === 'toggleDevTools', run: () => document.execCommand(it.role === 'selectAll' ? 'selectAll' : it.role) } : { ...it, run: () => run(it.cmd) })),
      { onClose: () => (button.classList.remove('open'), menubarOpen === button && (menubarOpen = null)) },
    )
  }
  button.addEventListener('mousedown', (e) => {
    e.preventDefault()
    if (menubarOpen === button) closeMenu()
    else open()
  })
  button.addEventListener('mouseenter', () => menubarOpen && menubarOpen !== button && open())
  menubar.append(button)
}

// keys: e.code, so shortcuts work with a Korean keyboard layout too. "Mod" is Cmd on macOS, Ctrl elsewhere.
const CODES = { Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Space: 'Space' }
function keyName(e) {
  let k = /^Key[A-Z]$/.test(e.code) ? e.code.slice(3) : /^Digit\d$/.test(e.code) ? e.code.slice(5) : (CODES[e.code] ?? e.key)
  if (k.length === 1) k = k.toUpperCase()
  return [(mac ? e.metaKey : e.ctrlKey) && 'Mod', mac && e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', k].filter(Boolean).join('+')
}
function accel(a) {
  const parts = String(a).split('+')
  const key = parts.pop()
  const mods = new Set(parts.map((p) => (/^(CmdOrCtrl|Cmd|Command|Meta|Mod)$/i.test(p) || (!mac && /^Ctrl$/i.test(p)) ? 'Mod' : /^(Alt|Option)$/i.test(p) ? 'Alt' : p[0].toUpperCase() + p.slice(1).toLowerCase())))
  return [...['Mod', 'Ctrl', 'Alt', 'Shift'].filter((m) => mods.has(m)), key.length === 1 ? key.toUpperCase() : key[0].toUpperCase() + key.slice(1)].join('+')
}
function keyLabel(a) {
  const k = accel(a).split('+')
  if (!mac) return k.map((p) => ({ Mod: 'Ctrl' })[p] ?? p).join('+')
  const sym = { Mod: '⌘', Ctrl: '⌃', Alt: '⌥', Shift: '⇧', Backspace: '⌫', Left: '←', Right: '→', Up: '↑', Down: '↓', Enter: '↩', Escape: 'Esc', Tab: '⇥' }
  const order = ['Ctrl', 'Alt', 'Shift', 'Mod']
  return [...order.filter((m) => k.includes(m)).map((m) => sym[m]), sym[k.at(-1)] ?? k.at(-1)].join('')
}
const KEYS = Object.fromEntries(Object.entries(COMMANDS).flatMap(([id, c]) => (c.key ? [[accel(c.key), id]] : [])))
Object.assign(KEYS, { F1: 'workbench.action.showCommands', [accel(mac ? 'Cmd+Alt+Right' : 'Ctrl+PageDown')]: 'workbench.action.nextEditor', [accel(mac ? 'Cmd+Alt+Left' : 'Ctrl+PageUp')]: 'workbench.action.previousEditor' })
addEventListener(
  'keydown',
  (e) => {
    const key = keyName(e)
    const panicKey = accel(settings['workbench.panicKey'] || 'Escape')
    if (key === panicKey && !quickState && !menuState && !suggestion && !editing) {
      e.preventDefault()
      return panic()
    }
    if (quickState || menuState) return // they handle their own keys
    if (key === accel('CmdOrCtrl+K') && document.activeElement === $('term-input')) return $('term-out').replaceChildren()
    if (key === accel('CmdOrCtrl+/') && document.activeElement === te.input) return // the editor's own
    const id = KEYS[key]
    if (!id || (id === 'renameFile' && document.activeElement === te.input)) return
    e.preventDefault()
    e.stopPropagation()
    run(id)
  },
  true,
)
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-cmd]')
  if (b && !b.closest('.menu')) run(b.dataset.cmd)
})

// The panic key: straight to main.py, nothing of the chat left in sight.
function panic() {
  closeOverlays()
  pinned = false
  activate('decoy')
  code.focus()
}
function togglePage() {
  const nd = activeNode()
  rawService = nd?.kind === 'chat' ? nd.service : IG
  pinned = !pinned
  render()
}
$('raw').addEventListener('click', togglePage)
$('back').addEventListener('click', () => navigate(-1))
$('forward').addEventListener('click', () => navigate(1))
$('tab-list').addEventListener('mousedown', (e) => {
  const tab = e.target.closest('.tab')
  if (!tab) return
  if (e.button === 1 || e.target.closest('.close')) {
    e.preventDefault()
    return closeTab(tab.dataset.id)
  }
  if (e.button === 0) activate(tab.dataset.id)
})
$('tab-list').addEventListener('contextmenu', (e) => {
  const id = e.target.closest('.tab')?.dataset.id
  if (!id) return
  e.preventDefault()
  menu(e.clientX, e.clientY, [
    { label: 'Close', key: 'CmdOrCtrl+W', run: () => closeTab(id) },
    { label: 'Close Others', run: () => tabs.list.filter((x) => x !== id).forEach((x) => closeTab(x)) },
    { label: 'Close All', run: () => [...tabs.list].forEach((x) => closeTab(x)) },
    '-',
    { label: 'Reopen Closed Editor', key: 'CmdOrCtrl+Shift+T', run: reopenClosed },
    '-',
    { label: 'Rename...', run: () => rename(id) },
  ])
})
$('tab-more').addEventListener('click', (e) => {
  const r = e.currentTarget.getBoundingClientRect()
  menu(r.right - 220, r.bottom, [
    { label: 'Close All', run: () => [...tabs.list].forEach((x) => closeTab(x)) },
    { label: 'Reopen Closed Editor', key: 'CmdOrCtrl+Shift+T', run: reopenClosed },
    '-',
    { label: 'New Message...', run: newChat },
    { label: 'Load Older Conversations', run: () => loadMore(IG, 6) },
    { label: 'Toggle Word Wrap', key: 'Alt+Z', run: () => run('editor.action.toggleWordWrap') },
  ])
})
$('manage').addEventListener('click', (e) => {
  const r = e.currentTarget.getBoundingClientRect()
  menu(r.right, r.bottom - 180, [
    { label: 'Command Palette...', key: 'CmdOrCtrl+Shift+P', run: () => run('workbench.action.showCommands') },
    '-',
    { label: 'Settings', key: 'CmdOrCtrl+,', run: () => run('workbench.action.openSettings') },
    { label: 'Extensions', key: 'CmdOrCtrl+Shift+X', run: () => run('workbench.view.extensions') },
    '-',
    { label: 'Show README', run: () => run('help.readme') },
  ])
})
$('accounts').addEventListener('click', (e) => {
  const r = e.currentTarget.getBoundingClientRect()
  menu(r.right, r.bottom - 60, [{ label: IG.snap.me ? `${IG.snap.me} (GitHub)` : 'Backup and Sync Settings...', disabled: true }])
})
$('spaces').addEventListener('click', () => setSetting('editor.tabSize', camo.LEVELS[(camo.LEVELS.indexOf(level()) + 1) % camo.LEVELS.length]))

// ---- the panel: problems, output, and a terminal running a real shell -------------------------------------------------------
let panelOpen = false
let panelTab = 'terminal'
const term = { started: false, running: false, info: null, cwd: '', history: [], at: 0 }
function showPanel(tab) {
  panelOpen = true
  panelTab = tab
  render()
}
function togglePanel() {
  panelOpen = !panelOpen
  render()
  if (panelOpen && panelTab === 'terminal') showTerminal()
}
$('panel-tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-panel]')
  if (!b) return
  showPanel(b.dataset.panel)
  if (b.dataset.panel === 'terminal') showTerminal()
})
const promptText = () => {
  const i = term.info
  if (!i) return ''
  const dir = term.cwd === i.home ? '~' : term.cwd.startsWith(i.home + '/') ? '~' + term.cwd.slice(i.home.length) : term.cwd
  if (/cmd/i.test(i.shell)) return term.cwd + '>'
  if (/bash/.test(i.shell)) return `${i.user}@${i.host}:${dir}$ `
  return `${i.user}@${i.host} ${dir === '~' ? '~' : dir.split('/').pop()} % ` // zsh
}
function termWrite(text) {
  const out = $('term-out')
  out.append(text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '').replace(/\r/g, ''))
  if (out.textContent.length > 200000) out.textContent = out.textContent.slice(-150000)
  $('terminal').scrollTop = $('terminal').scrollHeight
}
function showPrompt() {
  $('term-prompt').textContent = term.running ? '' : promptText()
  $('terminal').scrollTop = $('terminal').scrollHeight
}
async function showTerminal(focus = true) {
  showPanel('terminal')
  if (!term.started) {
    term.started = true
    if (!native?.term) termWrite('The terminal runs in the desktop app.\n')
    else {
      term.info = await native.term.start()
      term.cwd = term.info.home
      term.running = true // until the shell's first prompt
    }
  }
  showPrompt()
  if (focus) $('term-input').focus()
}
native?.term.on((msg) => {
  if (msg.type === 'data') termWrite(msg.text)
  else if (msg.type === 'prompt') {
    term.running = false
    term.cwd = msg.cwd
  } else if (msg.type === 'exit') {
    termWrite(`\n[process exited with code ${msg.code}]\n`)
    term.started = false
    term.running = false
  }
  showPrompt()
})
function killTerminal() {
  native?.term.kill()
  $('term-out').replaceChildren()
}
$('term-input').addEventListener('keydown', async (e) => {
  const input = e.currentTarget
  if (e.key === 'Enter' && !e.isComposing) {
    const text = input.value
    input.value = ''
    termWrite(promptText() + text + '\n')
    if (text.trim()) term.history.push(text)
    term.at = term.history.length
    if (/^\s*(clear|cls)\s*$/.test(text)) return $('term-out').replaceChildren()
    if (!term.started) await showTerminal()
    if (!native?.term) return
    term.running = true
    showPrompt()
    native.term.input(text)
  } else if (e.code === 'KeyC' && e.ctrlKey) {
    e.preventDefault()
    termWrite(promptText() + input.value + '^C\n')
    input.value = ''
    if (term.running) native?.term.interrupt()
    showPrompt()
  } else if (e.code === 'KeyL' && e.ctrlKey) {
    e.preventDefault()
    $('term-out').replaceChildren()
  } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    e.preventDefault()
    term.at = Math.max(0, Math.min(term.history.length, term.at + (e.key === 'ArrowUp' ? -1 : 1)))
    input.value = term.history[term.at] ?? ''
  }
})
$('terminal').addEventListener('click', () => getSelection().toString() || $('term-input').focus())
// F5: run the open file in the terminal (Python and JavaScript files of your own), like the Run button.
async function runFile() {
  const nd = activeNode()
  await showTerminal()
  if (nd?.kind !== 'file' || !native?.term || native.platform === 'win32') return
  const lang = camo.lang(nd.name)
  const runner = { python: 'python3 -', javascript: 'node -', shellscript: 'bash -s' }[lang]
  if (!runner) return termWrite(`No runner for ${camo.LANGS[lang].name} files.\n`)
  const tag = 'EOF_' + Math.random().toString(36).slice(2, 8)
  termWrite(promptText() + `${runner.split(' ')[0]} ${nd.name}\n`)
  term.running = true
  showPrompt()
  native.term.input(`${runner} <<'${tag}'\n${nd.text ?? ''}\n${tag}`)
}

// ---- notifications and the unread badge -------------------------------------------------------------------------------------
// The sites' own notifications are off (main.js): they came back after every restart. These remember what they have
// shown, across restarts, and skip conversations already read (on the phone, say), since those are no longer unread.
const notified = new Set(load('vsc.notified', []))
function notify() {
  if (!settings['notifications.enabled'] || typeof Notification === 'undefined') return
  let changed = false
  for (const s of services)
    for (const t of s.snap.threads) {
      const key = `${s.id}\n${t.name}\n${t.preview}`
      if (!t.unread || notified.has(key)) continue
      notified.add(key)
      changed = true
      const nd = chats().find((c) => c.id === chatId(s, t.name))
      if (document.hasFocus() && activeNode()?.id === nd?.id) continue // looking at it already
      const n = new Notification(nd?.name ?? t.name, { body: settings['notifications.showPreview'] ? t.preview : 'New changes' })
      n.onclick = () => {
        native?.focus()
        if (nd) openTab(nd.id)
      }
    }
  if (changed) save('vsc.notified', [...notified].slice(-500))
}
let shownBadge = -1
function badge(unread) {
  // the page title's "(2)" counts every unread conversation, not only the rendered ones
  const n = services.reduce((sum, s) => sum + (s.away ? 0 : s.snap.badge || s.snap.threads.filter((t) => t.unread).length), 0) || unread.length
  $('scm-badge').hidden = !n
  $('scm-badge').textContent = n
  if (n === shownBadge) return
  shownBadge = n
  let png = null
  if (n && !mac) {
    const c = Object.assign(document.createElement('canvas'), { width: 32, height: 32 })
    const g = c.getContext('2d')
    g.fillStyle = '#e51400'
    g.beginPath()
    g.arc(16, 16, 16, 0, Math.PI * 2)
    g.fill()
    g.fillStyle = '#fff'
    g.font = 'bold 20px Segoe UI, sans-serif'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText(n > 99 ? '99+' : String(n), 16, 17)
    png = c.toDataURL()
  }
  native?.badge(n, png)
}

// ---- toasts ----------------------------------------------------------------------------------------------------------------
let toastTimer
function toast(text) {
  document.querySelector('.toast')?.remove()
  const el = h('div', { class: 'toast' }, codicon('info'), span('', text))
  document.body.append(el)
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => el.remove(), 4000)
}

// ---- status bar, title, sidebar, panel ----------------------------------------------------------------------------------------
function renderStatus() {
  const nd = activeNode()
  const lang = nd && !isFolder(nd) ? camo.lang(nd.name) : null
  let ln = 1
  let col = 1
  if (nd?.kind === 'chat' && document.activeElement === draft) {
    ln = $('lines').children.length + 1
    col = $('draft-pre').textContent.length + (draft.textContent ? camo.quotes(camo.lang(nd.name))[0].length : 0) + caretOffset() + 1
  } else if ((nd?.kind === 'file' || nd?.kind === 'settings') && !$('text-editor').hidden) {
    const before = te.input.value.slice(0, te.input.selectionStart).split('\n')
    ln = before.length
    col = before.at(-1).length + 1
  } else if (nd?.kind === 'decoy') {
    const before = decoyText(nd).slice(0, nd.typed ?? 0).split('\n')
    ln = before.length
    col = before.at(-1).length + 1
  }
  $('cursor').textContent = `Ln ${ln}, Col ${col}`
  $('spaces').textContent = 'Spaces: ' + level()
  $('lang').textContent = !lang ? 'Plain Text' : (lang === 'python' ? '{} ' : '') + camo.LANGS[lang].name
  $('python').hidden = lang !== 'python'
  $('errors').textContent = problems
}
function renderTitle() {
  const nd = activeNode()
  const vars = { activeEditorShort: nd?.name ?? '', activeEditorLong: nd ? pathOf(nd).join('/') : '', rootName: rootName(), folderName: rootName(), appName: 'Visual Studio Code', dirty: '', profileName: '' }
  const title = String(settings['window.title'] ?? '')
    .replace(/\$\{(\w+)\}/g, (all, name) => (name === 'separator' ? '\u0000' : (vars[name] ?? '')))
    .split('\u0000')
    .filter((part) => part.trim())
    .join(mac ? ' — ' : ' - ')
  document.title = title || 'Visual Studio Code'
  $('workspace-name').textContent = rootName()
}
const WATERMARK = [['Show All Commands', 'CmdOrCtrl+Shift+P'], ['Go to File', 'CmdOrCtrl+P'], ['Find in Files', 'CmdOrCtrl+Shift+F'], ['Toggle Terminal', 'Ctrl+`'], ['Start Debugging', 'F5']]
$('watermark-keys').append(...WATERMARK.flatMap(([label, key]) => [h('dt', { text: label }), h('dd', {}, ...(mac ? [...keyLabel(key)] : keyLabel(key).split('+')).map((c) => h('kbd', { text: c })))]))

// ---- the main loop ------------------------------------------------------------------------------------------------------------
function render() {
  chatList = null
  const unread = chats().filter((c) => c.t.unread)
  document.querySelector('.sidebar').hidden = !sidebar
  document.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('active', sidebar && b.dataset.view === view))
  document.querySelectorAll('.view').forEach((v) => (v.hidden = v.dataset.pane !== view))
  $('panel').hidden = !panelOpen
  $('panel-icon').className = 'codicon codicon-' + (panelOpen ? 'layout-panel' : 'layout-panel-off')
  document.querySelectorAll('[data-panel]').forEach((b) => b.classList.toggle('active', b.dataset.panel === panelTab))
  document.querySelectorAll('.panel-pane').forEach((p) => (p.hidden = p.dataset.pane !== panelTab))
  if (tabs.active && !nodeOf(tabs.active) && chats().length) closeTab(tabs.active) // its file is gone
  renderExplorer()
  renderScm(unread)
  renderEditor()
  renderStatus()
  renderTitle()
  badge(unread)
}

// ponytail: 1s polling; switch to a MutationObserver + sendToHost if latency matters
async function poll() {
  for (const s of services) {
    if (!s.view || s.busy) continue
    let url = null
    try {
      url = new URL(s.view.getURL())
    } catch {
      // not ready yet: same as being away
    }
    // Login and challenge pages are left exactly as the site serves them: nothing runs in them.
    let snap = EMPTY
    if (url && s.ready(url)) {
      try {
        snap = await s.view.executeJavaScript(s.G.scrape)
      } catch {
        continue // mid-navigation: keep what's on screen
      }
    }
    const away = !(url && s.ready(url)) || (!snap.ok && !snap.threads.length && !snap.canSend)
    if (s.away && !away && rawService === s) pinned = false // just signed in: back to the editor
    s.away = away
    s.snap = snap
    if (snap.threads.length) merge(s, snap.threads)
    const live = liveThread(s)
    const id = live && chatId(s, live)
    const rows = snap.rows.slice(-300)
    if (live && rows.length && JSON.stringify(rowsCache[id]) !== JSON.stringify(rows)) {
      delete rowsCache[id]
      rowsCache[id] = rows // re-inserted: the most recently changed last
      saveRows()
    }
    if (!away && s.pendingOpen) {
      s.pendingOpen = false
      openThread(s, s.want)
    }
  }
  notify()
  render()
}
setInterval(poll, 1000)
fetch('README.md')
  .then((res) => res.text())
  .then((text) => {
    readme = text
    viewSig = ''
    render()
  })
applySettings()
if (tabs.active) activate(tabs.active, { record: true })
poll()
if (firstRun) setTimeout(pickFileType, 800)
