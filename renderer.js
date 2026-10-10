const view = document.querySelector('webview')
const sidebar = document.querySelector('.sidebar')
const editor = document.querySelector('.editor')
const code = document.querySelector('.code')
const draft = document.getElementById('draft')

document.body.classList.toggle('win', navigator.userAgentData.platform !== 'macOS') // see .win in index.html

let active = null // name of the thread opened from the explorer
let pinned = false // user forced the real Instagram page
let manual = false // README.md opened from the explorer
let away = true // webview is not on the DM pages (logged out, challenge, still loading)
let readme = '' // README.md: the page shown whenever no chat is open
let wasDoc = false
let last = '' // last rendered state, to skip no-op renders
let level = Number(localStorage.getItem('camouflage') ?? 2) // how much filler code surrounds the messages
let draftSeed = '' // picks the code around the line being typed; frozen while there is text in it

const span = (className, textContent) =>
  Object.assign(document.createElement('span'), { className, textContent })
const line = (...tokens) => {
  const el = document.createElement('div')
  el.className = 'line'
  el.append(...tokens)
  return el
}

// Python colouring for the filler code: comments, strings, numbers, keywords, calls.
const TOKEN =
  /(#.*$)|((?:\b[fFrRbB])?(["'])(?:\\.|(?!\3).)*\3)|\b(\d+(?:\.\d+)?)\b|\b(import|from|return|if|elif|else|for|while|with|as|try|except|finally|raise|yield|pass|break|continue|await|async)\b|\b(def|class|lambda|None|True|False|and|or|not|in|is|self)\b|(@\w+)|\b([A-Za-z_]\w*)(?=\()/g
const highlight = (text) => {
  const out = []
  let at = 0
  for (const m of text.matchAll(TOKEN)) {
    out.push(text.slice(at, m.index), span(m[1] ? 'com' : m[2] ? 'str' : m[4] ? 'num' : m[5] ? 'kw' : m[6] ? 'decl' : 'fn', m[0]))
    at = m.index + m[0].length
  }
  out.push(text.slice(at))
  return out
}

// A picture argument: open("file.jpg"), with the image itself in a hover card.
const picture = (src) => {
  const el = span('media', '')
  const img = Object.assign(new Image(), { loading: 'lazy', src }) // lazy: fetched on first hover
  el.append(span('fn', 'open'), '(', span('str', camo.quote(camo.file(src))), ')', img)
  return el
}
// One line of the generated file (see camo.js). Messages get a gutter bar: blue = theirs, green = ours.
const codeLine = (l) => {
  if (l.kind === 'code') return line(...highlight(l.text))
  if (l.kind === 'note') return line(l.indent, span('com', '# ' + l.text))
  const args = [l.text != null && span('str', camo.quote(l.text)), l.src && picture(l.src)].filter(Boolean)
  const el = line(
    l.indent,
    ...highlight(l.pre),
    ...args.flatMap((arg, i) => (i ? [', ', arg] : [arg])),
    ...highlight(l.post),
    ...(l.media && !l.src ? [span('com', '  # media')] : []),
  )
  el.classList.add(l.kind)
  return el
}

// README.md as markdown source: headings and `inline code` get a colour.
const markdown = (text) =>
  text
    .trimEnd()
    .split('\n')
    .map((l) =>
      /^#+ /.test(l)
        ? line(span('h', l))
        : line(...l.split(/(`[^`]*`)/).map((part) => (part.startsWith('`') ? span('str', part) : part))),
    )

// The typing line reads `reply = input()` until there is text, then `reply = input("...")`.
const quotes = () => document.querySelector('.line.input').classList.toggle('empty', !draft.value)
draft.addEventListener('input', quotes)

function render(snap, path) {
  const nowAway = !path?.startsWith('/direct')
  if (away && !nowAway) pinned = false // just logged in: back to the editor
  away = nowAway
  // Logged out shows the manual rather than a bare login page; a dialog on the DM pages needs the real page.
  const raw = pinned || (!away && !snap.ok)
  const doc = !raw && (manual || !snap.canSend) // README.md is the page whenever no chat is open
  if (!draft.value) draftSeed = `${active}:${snap.rows.length}` // a new spot in the file after every message
  const state = JSON.stringify([snap, raw, active, path, doc, readme.length, level, draftSeed])
  if (state === last) return
  last = state

  editor.classList.toggle('raw', raw)

  // tab + breadcrumbs: the manual, the thread "file", or Instagram's route in raw mode
  const route = (path ?? '').split('/').filter(Boolean)
  const parts = doc ? ['README.md'] : raw ? [...route.slice(0, -1), (route.at(-1) || 'index') + '.py'] : ['direct', (active ?? 'inbox') + '.py']
  document.getElementById('tab-icon').className = 'codicon codicon-' + (doc ? 'markdown' : 'python')
  document.getElementById('readme').classList.toggle('active', doc)
  document.getElementById('lang').textContent = doc ? 'Markdown' : '{} Python'
  document.querySelector('.tab-label').textContent = parts.at(-1)
  document.querySelector('.breadcrumbs').replaceChildren(
    ...parts.flatMap((part, i) => {
      const sep = span('codicon codicon-chevron-right', '')
      return i ? [sep, span('', part)] : [span('', part)]
    }),
  )

  // explorer: one "file" per thread
  document.getElementById('threads').replaceChildren(
    ...snap.threads.map((name, i) => {
      const file = document.createElement('button')
      file.append(span('codicon codicon-python', ''), span('', name + '.py'))
      file.classList.toggle('active', name === active && !doc)
      file.addEventListener('click', () => {
        active = name
        manual = false
        view.executeJavaScript(GUEST.open(i))
        code.scrollTop = code.scrollHeight // land on the newest message
        draft.focus()
      })
      return file
    }),
  )

  // editor: the manual, or the conversation as code with the line being typed somewhere inside it
  const stick = code.scrollHeight - code.scrollTop - code.clientHeight < 40
  const file = doc ? [] : camo(snap.rows, level, { seed: draftSeed })
  const at = file.findIndex((l) => l.kind === 'draft')
  const typing = file[at] ?? { indent: '', pre: '', post: '' }
  document.getElementById('lines').replaceChildren(
    ...(doc
      ? markdown(readme)
      : [
          ...(snap.rows.length
            ? []
            : [line(span('com', '# nothing read from this chat yet (the preview icon, top right, shows the real page)'))]),
          ...file.slice(0, at).map(codeLine),
          ...(snap.pending ? [line(typing.indent, span('com', `# ${snap.pending} attachment(s) ready, Enter sends`))] : []),
        ]),
  )
  quotes()
  document.getElementById('draft-pre').replaceChildren(typing.indent, ...highlight(typing.pre))
  document.getElementById('draft-post').replaceChildren(...highlight(typing.post))
  document.getElementById('after').replaceChildren(...(doc ? [] : file.slice(at + 1).map(codeLine)))
  const input = document.querySelector('.line.input')
  const opened = input.hidden && !doc
  input.hidden = doc
  if (opened) draft.focus() // a thread just opened: put the cursor on the last line
  if (doc !== wasDoc) code.scrollTop = doc ? 0 : code.scrollHeight
  else if (stick && !doc) code.scrollTop = code.scrollHeight
  wasDoc = doc
}

// ponytail: 1s polling; switch to a MutationObserver + sendToHost if latency matters
async function poll() {
  let path = null
  try {
    path = new URL(view.getURL()).pathname
  } catch {
    // webview not ready yet: same as being away
  }
  // Login and challenge pages are left exactly as Instagram serves them: nothing runs in them.
  let snap = { ok: false, threads: [], rows: [], pending: 0, canSend: false }
  if (path?.startsWith('/direct')) {
    try {
      snap = await view.executeJavaScript(GUEST.scrape)
    } catch {
      return // mid-navigation: keep what's on screen
    }
  }
  render(snap, path)
}
setInterval(poll, 1000)
fetch('README.md')
  .then((res) => res.text())
  .then((text) => {
    readme = text
    poll()
  })

// Enter on the last line types the draft into Instagram's own composer and sends it
// (with an empty draft it just sends whatever attachment is waiting there).
draft.addEventListener('keydown', async (e) => {
  if (e.key !== 'Enter' || e.isComposing) return
  if (!(await view.executeJavaScript(GUEST.focus))) return // keep the draft rather than lose it
  const text = draft.value
  draft.value = ''
  quotes()
  if (text) await view.insertText(text)
  for (const type of ['keyDown', 'char', 'keyUp']) view.sendInputEvent({ type, keyCode: 'Enter' })
  code.scrollTop = code.scrollHeight
})

// Attach: paste (Cmd+V) or drop files on the editor, or Cmd+O for Instagram's own file picker.
// Pasted/dropped files are handed to Instagram's upload input, as if picked there.
const dataUrl = (file) =>
  new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.readAsDataURL(file)
  })
async function attach(files) {
  const payload = await Promise.all(
    files.map(async (f) => ({ name: f.name || 'image.png', type: f.type, data: (await dataUrl(f)).split(',')[1] })),
  )
  view.executeJavaScript(GUEST.attach(payload))
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
addEventListener('keydown', (e) => {
  if (!(e.metaKey || e.ctrlKey) || e.key !== 'o') return
  e.preventDefault()
  view.executeJavaScript(GUEST.pick, true)
})
code.addEventListener('click', () => getSelection().toString() || draft.focus())

// Scrolling past either end of the file pages Instagram's own list, which loads older messages.
let paged = 0
code.addEventListener(
  'wheel',
  (e) => {
    const up = e.deltaY < 0
    const atEnd = up ? code.scrollTop === 0 : code.scrollHeight - code.scrollTop - code.clientHeight < 2
    if (!atEnd || Date.now() - paged < 400) return
    paged = Date.now()
    view.executeJavaScript(GUEST.page(up ? -1 : 1))
  },
  { passive: true },
)

document.querySelectorAll('[data-toggle-sidebar]').forEach((el) =>
  el.addEventListener('click', () => {
    sidebar.hidden = !sidebar.hidden
    document.querySelector('.activitybar button').classList.toggle('active', !sidebar.hidden)
  }),
)
document.getElementById('raw').addEventListener('click', () => {
  pinned = !pinned
  poll()
})
document.getElementById('readme').addEventListener('click', () => {
  manual = true
  poll()
})
// The status bar's "Spaces" number is the camouflage level: more spaces, more filler code.
const spaces = document.getElementById('spaces')
spaces.textContent = 'Spaces: ' + level
spaces.addEventListener('click', () => {
  level = camo.LEVELS[(camo.LEVELS.indexOf(level) + 1) % camo.LEVELS.length]
  localStorage.setItem('camouflage', level)
  spaces.textContent = 'Spaces: ' + level
  poll()
})
document.getElementById('back').addEventListener('click', () => view.goBack())
document.getElementById('forward').addEventListener('click', () => view.goForward())
