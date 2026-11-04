// Instagram DMs inside real VS Code, as source files (Python unless visualStagram.fileType says otherwise).
// This is only the editor side. The Visual Stagram Code desktop app is the engine: it holds the
// Instagram session and talks to us over a local socket (see bridge.js in the app).
const vscode = require('vscode')
const net = require('net')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')
const camo = require('./camo') // copied from the app by `npm run sync`

const SCHEME = 'vstagram'

// Keep in step with `where` in the app's bridge.js.
const bridgePath = () =>
  process.env.VSC_BRIDGE ||
  (process.platform === 'win32'
    ? `\\\\.\\pipe\\visual-stagram-code-${os.userInfo().username}`
    : path.join(os.homedir(), '.visual-stagram-code.sock'))

// Conversations are files with English names (김민수 -> kim_minsu.py), like in the app; slugs maps thread -> file name.
// The extension (visualStagram.fileType) picks the language they are written in, and the icon theme's icon.
let slugs = new Map()
function nameFiles(threads) {
  const taken = new Set()
  slugs = new Map(
    threads.map((name) => {
      const base = camo.slug(name)
      let file = base
      for (let n = 2; taken.has(file); n++) file = `${base}_${n}`
      taken.add(file)
      return [name, file]
    }),
  )
}
const config = () => vscode.workspace.getConfiguration('visualStagram')
const fileType = () => String(config().get('fileType') || 'py').trim().replace(/^\.+/, '') || 'py'
const uriFor = (name) => vscode.Uri.from({ scheme: SCHEME, path: `/direct/${slugs.get(name) ?? camo.slug(name)}.${fileType()}` })
const langOf = () => camo.lang('x.' + fileType())

function activate(context) {
  let socket = null
  let retry = null
  let launched = false // we start the app at most once per window
  let state = { away: true, ok: false, threads: [], unread: [], rows: [], pending: 0, canSend: false }
  let active = null // name of the thread whose file is live
  let switchedAt = 0
  let lastPaged = 0
  let land = null // uri of the file whose cursor goes onto the input line at its next update
  // uri -> the generated file, head + draft + tail. draft is what is typed between the input line's quotes;
  // shown is the head/tail the editor has right now (it lags behind while an edit is on its way); ours is
  // the document version our last edit produced.
  const docs = new Map()
  const tops = new WeakMap() // editor -> first visible line, to notice scrolling up to the top
  const counts = new WeakMap() // editor -> line count before the last update
  let queue = Promise.resolve() // edits and saves of the files, one at a time
  let disposed = false

  const treeChanged = new vscode.EventEmitter()
  const decorationsChanged = new vscode.EventEmitter()
  const say = (message) => socket?.write(JSON.stringify(message) + '\n')
  const status = () => vscode.commands.executeCommand('setContext', 'visualStagram.status', !socket ? 'offline' : state.away ? 'away' : 'ok')
  const switching = () => Date.now() - switchedAt < 1200 // right after switching threads the engine still reports the previous conversation
  const enqueue = (job) => (queue = queue.then(job).catch(() => {}))
  const fileOf = (uri) => {
    const key = uri.toString()
    if (!docs.has(key)) docs.set(key, { head: '', draft: '', tail: '', lines: [], seed: '', shown: { head: '', tail: '' } })
    return docs.get(key)
  }

  // ---- the engine -------------------------------------------------------------------------
  function startApp() {
    launched = true
    const custom = config().get('appPath')
    if (process.platform === 'darwin') {
      // -g: don't bring it to the front; the app hides its window and Dock icon for --background
      spawn('open', ['-g', '-a', custom || 'Visual Stagram Code', '--args', '--background'], { stdio: 'ignore' }).on('error', () => {})
    } else {
      const local = process.env.LOCALAPPDATA || ''
      const exe = [custom, path.join(local, 'Programs', 'visual-stagram-code', 'Visual Stagram Code.exe'), path.join(local, 'Programs', 'Visual Stagram Code', 'Visual Stagram Code.exe')].find(
        (p) => p && fs.existsSync(p),
      )
      if (exe) spawn(exe, ['--background'], { detached: true, stdio: 'ignore' }).unref()
    }
  }

  function connect() {
    clearTimeout(retry)
    const s = net.connect(bridgePath())
    let buffer = ''
    s.setEncoding('utf8')
    s.on('connect', () => {
      socket = s
      status()
    })
    s.on('data', (chunk) => {
      buffer += chunk
      for (let end; (end = buffer.indexOf('\n')) !== -1; ) {
        const text = buffer.slice(0, end)
        buffer = buffer.slice(end + 1)
        try {
          const message = JSON.parse(text)
          if (message.type === 'state') update(message)
        } catch {
          // not JSON: ignore the line
        }
      }
    })
    s.on('error', () => {})
    s.on('close', () => {
      if (disposed) return
      socket = null
      update({ ...state, away: true, threads: [] })
      if (!launched) startApp() // nothing listening: the app isn't running yet
      retry = setTimeout(connect, 2000)
    })
  }

  // ---- state -> explorer + file ---------------------------------------------------------------
  function update(next) {
    state = { unread: [], ...next }
    nameFiles(state.threads)
    status()
    treeChanged.fire()
    decorationsChanged.fire()
    refresh()
  }

  function refresh() {
    if (active == null || state.away || switching()) return
    const uri = uriFor(active)
    const doc = fileOf(uri)
    if (!doc.draft) doc.seed = `${active}:${state.rows.length}` // picks the code around the input line; frozen while there is text in it
    const lang = langOf()
    const lines = camo(state.rows, config().get('camouflage'), { seed: doc.seed, lang })
    const input = lines.find((l) => l.kind === 'draft')
    if (state.pending) lines.splice(lines.indexOf(input), 0, { kind: 'note', indent: input.indent, text: `${state.pending} attachment(s) ready, Enter sends` })
    const text = lines.map((l) => camo.text(l, lang))
    const at = lines.indexOf(input)
    // The quotes stay even with nothing typed: adding them mid-typing would break a Korean (IME) composition.
    const [open, close] = camo.quotes(lang)
    doc.head = [...text.slice(0, at), `${input.indent}${input.pre}${open}`].join('\n')
    doc.tail = [`${close}${input.post}`, ...text.slice(at + 1)].join('\n').trimEnd() + '\n' // nothing for "trim on save" settings to remove
    doc.lines = lines
    const document = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString())
    if (document) enqueue(() => write(document))
  }

  // Takes in what the user changed. Text between the input line's quotes is the draft; any other change is undone
  // by the next write, and what was typed there goes onto the input line instead (in the app a click anywhere focuses it).
  function read(document, typed) {
    const doc = fileOf(document.uri)
    const { head, tail } = doc.shown
    if (!tail) return // nothing of ours in it yet (e.g. restored after a restart): the next write replaces it all
    const now = document.getText()
    if (now.startsWith(head) && now.endsWith(tail) && now.length >= head.length + tail.length) {
      doc.draft = now.slice(head.length, now.length - tail.length)
    } else {
      doc.draft += typed
      land = document.uri.toString()
    }
  }

  // Brings an open file in line with docs, editing only what differs, then saves it so the tab doesn't stay dirty.
  async function write(document) {
    if (document.isClosed) return
    const doc = fileOf(document.uri)
    const { head, draft, tail } = doc
    const have = document.getText()
    // an empty input line can change shape under the cursor (input("") -> input("").strip()): keep the cursor in it
    const waiting = draft ? [] : editorsOf(document).filter((e) => e.selection.isEmpty && document.offsetAt(e.selection.active) === doc.shown.head.length)
    if (have !== head + draft + tail) {
      const { start, end, text } = camo.diff(have, head + draft + tail)
      const edit = new vscode.WorkspaceEdit()
      edit.replace(document.uri, new vscode.Range(document.positionAt(start), document.positionAt(end)), text)
      const version = document.version
      if (!(await vscode.workspace.applyEdit(edit))) return // the file changed meanwhile; that change queues another write
      doc.ours = version + 1 // the change event of this edit is not the user typing
    }
    doc.shown = { head, tail }
    doc.shownLines = doc.lines // what is on screen now: the bars follow these, not lines still on their way
    for (const editor of editorsOf(document)) decorate(editor)
    const landing = land === document.uri.toString() && !switching()
    if (landing) land = null
    for (const editor of landing ? editorsOf(document) : waiting) {
      const at = document.positionAt(head.length + draft.length)
      editor.selection = new vscode.Selection(at, at)
      if (landing) editor.revealRange(editor.selection)
    }
    clearTimeout(doc.saving)
    doc.saving = setTimeout(() => enqueue(() => document.isDirty && document.save()), 300) // after a pause, not on every key
  }

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('visualStagram.threads', {
      onDidChangeTreeData: treeChanged.event,
      getChildren: () => state.threads.map((name, index) => ({ name, index })),
      getTreeItem({ name, index }) {
        const item = new vscode.TreeItem(uriFor(name).path.split('/').pop())
        item.resourceUri = uriFor(name) // with ThemeIcon.File this gives it the icon theme's icon for the extension
        item.iconPath = vscode.ThemeIcon.File
        item.command = { command: 'visualStagram.open', title: 'Open', arguments: [index, name] }
        return item
      },
    }),
    // A writable file system rather than a content provider: VS Code opens those read-only.
    vscode.workspace.registerFileSystemProvider(
      SCHEME,
      {
        onDidChangeFile: new vscode.EventEmitter().event, // never fires: open files change through edits (write)
        watch: () => new vscode.Disposable(() => {}),
        // mtime stays 0, so a save never looks like it overwrites a newer file
        stat: (uri) => ({ type: uri.path.split('/').length > 2 ? vscode.FileType.File : vscode.FileType.Directory, ctime: 0, mtime: 0, size: 0 }), // /direct/<file>
        readFile(uri) {
          const doc = fileOf(uri)
          doc.shown = { head: doc.head, tail: doc.tail }
          return Buffer.from(doc.head + doc.draft + doc.tail || '\n') // never empty: an empty file takes the platform's line ending (CRLF on Windows)
        },
        writeFile() {}, // saving only clears the dirty mark: the file is generated
        readDirectory: () => [],
        createDirectory() {},
        delete() {},
        rename() {},
      },
      { isCaseSensitive: true },
    ),
    // unread conversations look like untracked files: green, with a U (in the list and on their tabs)
    vscode.window.registerFileDecorationProvider({
      onDidChangeFileDecorations: decorationsChanged.event,
      provideFileDecoration(uri) {
        if (uri.scheme !== SCHEME || !state.unread.some((name) => uriFor(name).toString() === uri.toString())) return
        return { badge: 'U', tooltip: 'Untracked', color: new vscode.ThemeColor('gitDecoration.untrackedResourceForeground') }
      },
    }),
  )

  // ---- which lines are messages: bars like git's changed-line markers ------------------------------
  const bar = (color) =>
    vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      borderStyle: 'solid',
      borderWidth: '0 0 0 3px',
      borderColor: new vscode.ThemeColor(color),
      overviewRulerColor: new vscode.ThemeColor(color),
      overviewRulerLane: vscode.OverviewRulerLane.Left,
    })
  const bars = { recv: bar('editorGutter.modifiedBackground'), send: bar('editorGutter.addedBackground') } // blue = theirs, green = ours

  function decorate(editor) {
    const doc = docs.get(editor.document.uri.toString())
    if (!doc?.shownLines) return
    for (const kind of ['recv', 'send']) {
      const marked = (l) => l.kind === kind || (kind === 'send' && l.kind === 'draft')
      editor.setDecorations(bars[kind], doc.shownLines.flatMap((l, i) => (marked(l) ? [new vscode.Range(i, 0, i, 0)] : [])))
    }
  }
  const editorsOf = (document) => vscode.window.visibleTextEditors.filter((e) => e.document === document)
  const bottom = (editor) => editor.revealRange(new vscode.Range(editor.document.lineCount, 0, editor.document.lineCount, 0))

  context.subscriptions.push(
    bars.recv,
    bars.send,
    vscode.window.onDidChangeVisibleTextEditors((editors) => editors.forEach(decorate)),
    // a tab is a conversation: going back to one switches the engine to it, so what is typed there goes to that person
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      const index = state.threads.findIndex((name) => uriFor(name).toString() === editor?.document.uri.toString())
      if (index !== -1 && state.threads[index] !== active) vscode.commands.executeCommand('visualStagram.open', index, state.threads[index])
    }),
    vscode.workspace.onDidChangeTextDocument(({ document, contentChanges, reason }) => {
      if (document.uri.scheme !== SCHEME || !contentChanges.length) return
      const version = document.version
      const typed = reason ? '' : contentChanges.map((c) => c.text).join('') // undo/redo isn't typing
      enqueue(() => {
        if (version === fileOf(document.uri).ours) return
        read(document, typed)
        return write(document)
      })
      for (const editor of editorsOf(document)) {
        decorate(editor)
        // follow new messages unless the reader has scrolled up into the history
        const shown = editor.visibleRanges.at(-1)?.end.line ?? 0
        if (shown >= (counts.get(editor) ?? 0) - 3) bottom(editor)
        counts.set(editor, document.lineCount)
      }
    }),
    // scrolling up to the first line asks the engine for older messages
    vscode.window.onDidChangeTextEditorVisibleRanges(({ textEditor, visibleRanges }) => {
      if (textEditor.document.uri.scheme !== SCHEME || !visibleRanges.length) return
      const top = visibleRanges[0].start.line
      const before = tops.get(textEditor)
      tops.set(textEditor, top)
      if (top === 0 && before > 0 && Date.now() - lastPaged > 1500) {
        lastPaged = Date.now()
        say({ type: 'page', dir: -1 })
      }
    }),
    // hovering a picture line shows the picture
    vscode.languages.registerHoverProvider(
      { scheme: SCHEME },
      {
        provideHover(document, position) {
          const src = docs.get(document.uri.toString())?.lines[position.line]?.src
          if (src) return new vscode.Hover(new vscode.MarkdownString(`![](${src}|width=320)`))
        },
      },
    ),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('visualStagram.fileType')) {
        update(state) // the files are renamed: open the conversation again under its new name
        const index = state.threads.indexOf(active)
        if (index !== -1) vscode.commands.executeCommand('visualStagram.open', index, active)
      } else if (e.affectsConfiguration('visualStagram.camouflage')) refresh()
    }),
  )

  // ---- commands -------------------------------------------------------------------------------------------------
  const command = (id, run) => context.subscriptions.push(vscode.commands.registerCommand(id, run))

  command('visualStagram.open', async (index, name) => {
    active = name
    switchedAt = Date.now()
    land = uriFor(name).toString()
    say({ type: 'open', index })
    const editor = await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uriFor(name)), { preview: false })
    decorate(editor)
    bottom(editor)
    setTimeout(refresh, 1300) // once the engine has switched, even if nothing else changes
  })
  // Enter: the input line goes out. Queued, so it comes after the typing that came before it.
  command('visualStagram.send', () =>
    enqueue(async () => {
      const document = vscode.window.activeTextEditor?.document
      // only to the person whose file this is; while it can't go out, the text stays on the line
      if (document?.uri.toString() !== uriFor(active).toString() || switching() || state.away || !state.canSend) return
      const doc = fileOf(document.uri)
      say({ type: 'send', text: doc.draft }) // empty is fine: it sends a waiting attachment
      doc.draft = ''
      await write(document)
    }),
  )
  command('visualStagram.attach', async () => {
    const picked = await vscode.window.showOpenDialog({ canSelectMany: true })
    if (!picked?.length) return
    const TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic', mp4: 'video/mp4', mov: 'video/quicktime' }
    const files = await Promise.all(
      picked.map(async (uri) => ({
        name: path.basename(uri.fsPath),
        type: TYPES[path.extname(uri.fsPath).slice(1).toLowerCase()] ?? 'application/octet-stream',
        data: Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('base64'),
      })),
    )
    say({ type: 'attach', files })
  })
  command('visualStagram.older', () => say({ type: 'page', dir: -1 }))
  command('visualStagram.showApp', () => say({ type: 'show' }))
  command('visualStagram.retry', () => {
    launched = false
    connect()
  })
  // every language camo.js can write, by its usual extension
  command('visualStagram.fileType', async () => {
    const items = Object.values(camo.LANGUAGES)
      .filter((l) => l.exts.length)
      .map((l) => ({ label: l.exts[0], description: l.name }))
      .sort((a, b) => a.description.localeCompare(b.description))
    const pick = await vscode.window.showQuickPick(items, { placeHolder: `대화 파일 형식 (지금: .${fileType()})`, matchOnDescription: true })
    if (pick) config().update('fileType', pick.label.slice(1), vscode.ConfigurationTarget.Global)
  })
  command('visualStagram.camouflage', async () => {
    const pick = await vscode.window.showQuickPick(camo.LEVELS.map(String), { placeHolder: `Spaces: ${config().get('camouflage')}` })
    if (pick) config().update('camouflage', Number(pick), vscode.ConfigurationTarget.Global)
  })

  context.subscriptions.push({
    dispose() {
      disposed = true
      clearTimeout(retry)
      socket?.destroy()
    },
  })
  status()
  connect()
}

module.exports = { activate, deactivate() {} }
