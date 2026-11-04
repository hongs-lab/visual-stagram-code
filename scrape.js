// Runs inside instagram.com: renderer.js and bridge.js inject these functions into the hidden webview.
// Everything that knows Instagram's DOM lives in this file.
// ponytail: layout heuristics plus a few aria-labels and input names (checked against the live page,
// Nov 2026), because Instagram's class names are obfuscated; retune here when their markup shifts.
const GUEST = (() => {
  function scrape() {
    const CLICKABLE = 'a, [role="link"], [role="button"], [role="listitem"]'
    const box = (el) => el.getBoundingClientRect()
    const visible = (el) => box(el).width > 2 && box(el).height > 2 // skips 1px screen-reader-only labels

    const composer = document.querySelector('[role="textbox"][contenteditable="true"]')

    // The message list is whatever scrolls just above the composer.
    let scroller = null
    if (composer) {
      const c = box(composer)
      scroller =
        document
          .elementsFromPoint(c.left + c.width / 2, c.top - 200)
          .find((el) => /auto|scroll/.test(getComputedStyle(el).overflowY) && !el.contains(composer)) ?? null
    }
    window.__vscScroller = scroller // the app scrolls this to page through history
    const pane = scroller && box(scroller)

    // One message = the smallest block we reach by unwrapping single children and vertical
    // stacks (day groups, row lists) while still at full pane width; a bubble is narrower.
    const filled = (el) => box(el).height > 0 && (el.textContent.trim() || el.querySelector('img, video'))
    const split = (el) => {
      if (box(el).width < pane.width * 0.8) return [el]
      const kids = [...el.children].filter(filled).sort((a, b) => box(a).top - box(b).top)
      if (kids.length === 1) return split(kids[0])
      const stacked = kids.every((k, i) => !i || box(k).top >= box(kids[i - 1]).bottom - 1)
      return kids.length && stacked ? kids.flatMap(split) : [el]
    }

    // A message hugging the left edge is theirs, the right edge is ours; centred or
    // small-print lines (timestamps, "seen", sender names) are notes.
    const rows = []
    const media = []
    const range = document.createRange()
    for (const row of scroller ? split(scroller) : []) {
      const words = []
      let left = Infinity
      let right = -Infinity
      let small = false
      const grow = (r) => {
        left = Math.min(left, r.left)
        right = Math.max(right, r.right)
      }
      const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT)
      for (let node; (node = walker.nextNode()); ) {
        if (!node.data.trim() || !visible(node.parentElement)) continue
        if (!words.length) small = parseFloat(getComputedStyle(node.parentElement).fontSize) < 13
        range.selectNodeContents(node)
        grow(range.getBoundingClientRect())
        words.push(node.data.trim())
      }
      // photos, GIFs, stickers, story and post previews: anything picture-sized (avatars are smaller)
      const pic = [...row.querySelectorAll('img, video, [style*="background-image"]')].find((m) => box(m).width > 80)
      if (pic) grow(box(pic))
      if (!words.length && !pic) continue
      const src = pic ? pic.currentSrc || pic.src || pic.poster || /url\("?(.*?)"?\)/.exec(pic.style.backgroundImage)?.[1] || '' : ''
      const gapLeft = left - pane.left
      const gapRight = pane.right - right
      const centred = Math.abs(gapLeft - gapRight) < pane.width * 0.1
      const r = box(row)
      const message = {
        top: r.top,
        bottom: r.bottom,
        side: centred || (small && !pic) ? 'note' : gapLeft < gapRight ? 'recv' : 'send',
        text: words.length ? words.join(' ') : null,
        media: !!pic,
        src: src.startsWith('https:') ? src : null, // blob: previews can't leave the page; the app asks for them by mi
      }
      if (pic) message.mi = media.push(pic) - 1
      rows.push(message)
    }
    window.__vscMedia = media
    rows.sort((a, b) => a.top - b.top) // visual order, whatever the DOM order

    // Who wrote what: each message's action buttons carry the sender's username ("<user>님의 메시지에 답장하기"),
    // and the avatar under a run of messages links to "Open the profile page of <user>".
    const WHO = [/^(.+?)님의 메시지/, /^Open the profile page of (.+)$/, /^(.+?)님의 프로필 페이지/, /(?:message from|reply to|react to) @?([\w.]+)/i]
    const labels = []
    for (const el of scroller?.querySelectorAll('[aria-label]') ?? []) {
      const label = el.getAttribute('aria-label')
      const hit = WHO.map((re) => re.exec(label)).find(Boolean)
      const b = box(el)
      if (hit && b.height) labels.push({ y: (b.top + b.bottom) / 2, who: hit[1].trim() })
    }
    for (const row of rows) if (row.side !== 'note') row.who = labels.find((l) => l.y >= row.top - 6 && l.y <= row.bottom + 6)?.who
    // the avatar only sits under the last message of a run: hand its name up the run
    for (let i = rows.length - 2; i >= 0; i--) if (rows[i].side === 'recv' && !rows[i].who && rows[i + 1].side === 'recv') rows[i].who = rows[i + 1].who
    for (const row of rows) {
      delete row.top // it moves on every scroll; keep snapshots comparable
      delete row.bottom
      if (!row.who) delete row.who
    }

    // Threads: wide clickable things holding an avatar, left of the chat pane. The list is virtual (only ~30
    // are rendered), so each one also reports where it sits in the list, to scroll back to it later.
    const edge = pane ? pane.left : 520
    const items = new Set()
    for (const img of document.querySelectorAll('img')) {
      let item = img
      while ((item = item.parentElement?.closest(CLICKABLE)) && box(item).width < 200);
      if (item && box(item).right <= edge + 1) items.add(item)
    }
    const list = [...items]
    window.__vscThreads = list // the app clicks these
    let threadScroller = list[0]?.parentElement
    while (threadScroller && !/auto|scroll/.test(getComputedStyle(threadScroller).overflowY)) threadScroller = threadScroller.parentElement
    window.__vscThreadScroller = threadScroller
    const origin = threadScroller ? box(threadScroller).top - threadScroller.scrollTop : 0
    const threads = list.map((el) => {
      const lines = el.innerText.split('\n').map((l) => l.trim()).filter(Boolean)
      const name = el.querySelector('span')
      return {
        name: lines[0] ?? '',
        preview: lines[1] && lines[1] !== '·' ? lines[1] : '',
        // unread threads end in a screen-reader "Unread" and have a bold name
        unread: lines.includes('Unread') || Number(name && getComputedStyle(name).fontWeight) >= 600,
        group: el.querySelectorAll('img').length > 1,
        y: Math.round(box(el).top - origin),
      }
    })

    // Attachments waiting in the composer: thumbnails in the box that owns the upload input.
    let tray = composer
    while (tray && !tray.querySelector('input[type="file"]')) tray = tray.parentElement
    if (scroller && tray?.contains(scroller)) tray = null
    const pending = [...(tray?.querySelectorAll('img, video') ?? [])].filter((m) => box(m).width >= 40).length

    // our own username: the avatar link in the left navigation
    const meLink = [...document.querySelectorAll('a[href][role="link"]')].find((a) => box(a).left < 80 && /^\/[\w.]+\/$/.test(a.getAttribute('href')) && a.querySelector('img'))
    // the open conversation's name, in the header above the messages
    const header = pane && [...document.querySelectorAll('h2')].find((h) => box(h).width > 0 && box(h).left >= pane.left - 60 && box(h).bottom <= pane.top + 4)

    return {
      // a dialog (notifications prompt, etc.) needs the real page, so report not-ok
      ok: !document.querySelector('[role="dialog"]') && (items.size > 0 || !!composer),
      threads,
      rows,
      pending,
      canSend: !!composer,
      badge: Number(/^\((\d+)\)/.exec(document.title)?.[1] ?? 0), // "(2) Instagram": unread conversations
      me: meLink?.getAttribute('href').slice(1, -1) ?? null,
      open: header?.innerText.split('\n')[0].trim() || null,
    }
  }

  // Sends without touching focus: the text goes straight into the composer's Lexical editor and the send button
  // gets clicked. (Focusing the hidden page broke Korean IME typing in the app and lost the Enter; text inserted
  // without focus was ignored by the editor, so only the first message went.) Afterwards it checks that the message
  // really showed up in the conversation, and sends once more if it didn't.
  // expect: the conversation it is meant for; nothing goes out if a different one is open.
  async function send(text, expect, scrape) {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    const box = (el) => el.getBoundingClientRect()
    const norm = (s) => (s ?? '').replace(/\s+/g, '')
    const composer = () => document.querySelector('[role="textbox"][contenteditable="true"]')
    const open = scrape().open
    if (expect && open && norm(open) !== norm(expect)) return { ok: false, why: 'thread' }
    const editor = composer()?.__lexicalEditor
    if (!composer() || (text && !editor)) return { ok: false, why: 'composer' }
    const count = () => (text ? scrape().rows.filter((r) => r.side === 'send' && norm(r.text).includes(norm(text))).length : scrape().pending)
    const before = count()
    const button = () => {
      const c = box(composer())
      return [...document.querySelectorAll('[role="button"], button')].find((b) => {
        const r = box(b)
        const label = b.getAttribute('aria-label') || b.innerText || b.querySelector('svg[aria-label]')?.getAttribute('aria-label') || ''
        return r.width > 0 && r.left >= c.left && r.top < c.bottom + 30 && r.bottom > c.top - 30 && /^(보내기|send|전송)$/i.test(label.trim())
      })
    }
    const submit = async () => {
      if (text && norm(composer().textContent) !== norm(text)) {
        const children = []
        text.split('\n').forEach((part, i) => {
          if (i) children.push({ type: 'linebreak', version: 1 })
          if (part) children.push({ type: 'text', text: part, detail: 0, format: 0, mode: 'normal', style: '', version: 1 })
        })
        const paragraph = { type: 'paragraph', version: 1, direction: 'ltr', format: '', indent: 0, textFormat: 0, textStyle: '', children }
        editor.setEditorState(editor.parseEditorState({ root: { type: 'root', version: 1, direction: 'ltr', format: '', indent: 0, children: [paragraph] } }))
      }
      let b
      for (let i = 0; i < 20 && !(b = button()); i++) await sleep(50) // React shows the button once the editor has text
      if (b) b.click()
      else composer()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }))
    }
    const landed = async (ms) => {
      for (let t = 0; t < ms; t += 150) {
        await sleep(150)
        if (text ? count() > before : count() < before) return true
      }
      return false
    }
    await submit()
    if (await landed(3000)) return { ok: true }
    await submit()
    return { ok: await landed(3000), retried: true }
  }

  // Opens a conversation by name. The list only renders what is near its scroll position, so a buried one is found
  // by scrolling to where it was last seen, then by scanning down from the top (which also loads older threads).
  async function openThread(name, y, scrape) {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    const norm = (s) => (s ?? '').replace(/\s+/g, ' ').trim()
    const find = () => {
      scrape()
      return (window.__vscThreads ?? []).find((el) => norm(el.innerText.split('\n')[0]) === norm(name))
    }
    let el = find()
    const list = window.__vscThreadScroller
    if (!el && list && y != null) {
      list.scrollTop = Math.max(0, y - 300)
      await sleep(500)
      el = find()
    }
    for (let i = 0; !el && list && i < 80; i++) {
      const bottom = () => list.scrollTop + list.clientHeight >= list.scrollHeight - 4
      if (i) list.scrollTop += list.clientHeight * 0.7
      else list.scrollTop = 0
      await sleep(450)
      if (!(el = find()) && bottom()) {
        await sleep(1200) // at the end: give the next page a moment to load
        if (!(el = find()) && bottom()) break
      }
    }
    el?.click()
    await sleep(300)
    if (list) list.scrollTop = 0 // back to the top, where new messages show up
    return !!el
  }

  // Loads older threads: scrolls the thread list to its end `pages` times (each time Instagram fetches about five
  // more), collecting what renders on the way, then goes back to the top.
  async function more(pages, scrape) {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    scrape()
    const list = window.__vscThreadScroller
    if (!list) return []
    const found = new Map()
    for (let page = 0; page < pages; page++) {
      const height = list.scrollHeight
      list.scrollTop = height
      for (let i = 0; i < 15 && list.scrollHeight === height; i++) await sleep(150)
      await sleep(250)
      for (const t of scrape().threads) found.set(t.name, t)
      if (list.scrollHeight === height) break // nothing more to load
    }
    list.scrollTop = 0
    return [...found.values()]
  }

  // Instagram's notifications (likes, follows, comments): opens the drawer, reads it, closes it again.
  // (Opening it marks them seen on Instagram, as it does on the site.)
  async function activity() {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    const box = (el) => el.getBoundingClientRect()
    const own = (el) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.data).join('').trim()
    const SECTION = /^(새로운 항목|오늘|어제|이번 주|이번 달|이전 활동|최근 7일|최근 30일|New|Today|Yesterday|This week|This month|Earlier|Last 7 days|Last 30 days)$/
    const link = [...document.querySelectorAll('a, [role="link"], [role="button"]')].find((a) => a.querySelector('svg[aria-label="알림"], svg[aria-label="Notifications"]'))
    if (!link) return null
    link.click()
    let heads = []
    for (let i = 0; i < 30 && !heads.length; i++) {
      await sleep(200)
      heads = [...document.querySelectorAll('span')].filter((el) => SECTION.test(own(el)) && box(el).width > 0)
    }
    await sleep(400) // let the rest of the list render
    const items = []
    if (heads.length) {
      let list = heads[0]
      while (list && !(heads.every((h) => list.contains(h)) && box(list).height > 200)) list = list.parentElement
      const found = []
      const walk = (el, depth) => {
        for (const kid of el.children) {
          const b = box(kid)
          if (b.height > 30 && b.height < 130 && b.width > 250 && kid.querySelector('img')) found.push(kid)
          else if (depth < 14) walk(kid, depth + 1)
        }
      }
      if (list) walk(list, 0)
      const WHEN = /\s*(\d+\s*(?:초|분|시간|일|주|개월|년|[smhdwy])|\d+월 \d+일|\d{4}년 \d+월 \d+일|어제|yesterday|[A-Z][a-z]{2,8} \d{1,2}(?:, \d{4})?)$/i
      for (const row of found) {
        const buttons = [...row.querySelectorAll('button, [role="button"]')].map((b) => b.innerText.trim()).filter(Boolean)
        const text = row.innerText
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l && !buttons.includes(l))
          .join(' ')
          .replace(/\s+(님|,)/g, '$1')
        const when = WHEN.exec(text)?.[1] ?? ''
        const head = heads.filter((h) => box(h).top <= box(row).top).at(-1)
        const user = [...row.querySelectorAll('a[href]')].map((a) => /^\/([\w.]+)\/$/.exec(a.getAttribute('href'))?.[1]).find(Boolean)
        items.push({
          section: head ? own(head) : '',
          text: when ? text.slice(0, text.length - when.length).trim() : text,
          when,
          kind: /좋아|liked/i.test(text) ? 'like' : /팔로우|follow/i.test(text) ? 'follow' : /댓글|답글|comment|repl/i.test(text) ? 'comment' : /언급|태그|mention|tag/i.test(text) ? 'mention' : 'info',
          user: user ?? null,
        })
      }
    }
    const close = [...document.querySelectorAll('svg[aria-label="닫기"], svg[aria-label="Close"]')].map((s) => s.closest('[role="button"], button')).find((b) => b && box(b).top < 120 && box(b).left < 600)
    if (close) close.click()
    else link.click()
    return items
  }

  // New message: the "To:" search in Instagram's new-message dialog (opened on first use). -> [{ name, user }]
  async function people(query) {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    const dialog = () => [...document.querySelectorAll('[role="dialog"]')].find((d) => d.querySelector('input[name="queryBox"]'))
    let d = dialog()
    if (!d) {
      const pencil = [...document.querySelectorAll('[role="button"]')].find((b) => b.querySelector('svg[aria-label="새로운 메시지"], svg[aria-label="New message"]'))
      if (!pencil) return null
      pencil.click()
      for (let i = 0; i < 30 && !(d = dialog()); i++) await sleep(150)
      if (!d) return null
    }
    const input = d.querySelector('input[name="queryBox"]')
    const options = () => [...d.querySelectorAll('[role="option"]')]
    const seen = () => options().map((o) => o.innerText).join('|')
    const was = seen()
    if (input.value !== query) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, query) // the React way
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }
    // results come a moment later: wait for them to change, then to settle
    let last = ''
    for (let i = 0, same = 0; i < 25 && same < 3; i++) {
      await sleep(150)
      const now = seen()
      same = now === last && (now !== was || i > 8) ? same + 1 : 0
      last = now
    }
    window.__vscPeople = options()
    return window.__vscPeople.slice(0, 30).map((o) => {
      const [name = '', user = ''] = o.innerText.split('\n').map((l) => l.trim())
      return { name, user }
    })
  }

  // Picks result i of people() and presses "Chat": the conversation opens (a new one if there was none).
  async function chatWith(i) {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    const option = window.__vscPeople?.[i]
    const d = option?.closest('[role="dialog"]')
    if (!d) return false
    if (!option.querySelector('input[type="checkbox"]')?.checked) option.click()
    const chat = () => [...d.querySelectorAll('[role="button"], button')].find((b) => /^(채팅|chat|다음|next)$/i.test(b.innerText.trim()))
    let b
    for (let n = 0; n < 20; n++) {
      b = chat()
      if (b && b.getAttribute('aria-disabled') !== 'true' && !b.disabled) break
      await sleep(150)
    }
    if (!b) return false
    b.click()
    for (let n = 0; n < 30 && d.isConnected; n++) await sleep(150)
    return !d.isConnected
  }

  function closeDialog() {
    const d = [...document.querySelectorAll('[role="dialog"]')].find((x) => x.querySelector('input[name="queryBox"]'))
    const close = d && [...d.querySelectorAll('svg[aria-label="닫기"], svg[aria-label="Close"]')].map((s) => s.closest('[role="button"], button')).find(Boolean)
    close?.click()
    return !!close
  }

  // A picture the app window can't load itself (blob: previews, video frames): as a data: URL.
  async function media(i) {
    const el = window.__vscMedia?.[i]
    if (!el) return null
    const w = el.videoWidth || el.naturalWidth || el.clientWidth
    const h = el.videoHeight || el.naturalHeight || el.clientHeight
    const scale = Math.min(1, 480 / Math.max(w, h, 1))
    const canvas = Object.assign(document.createElement('canvas'), { width: Math.round(w * scale), height: Math.round(h * scale) })
    try {
      if (el.tagName !== 'IMG' && el.tagName !== 'VIDEO') throw 0
      canvas.getContext('2d').drawImage(el, 0, 0, canvas.width, canvas.height)
      return canvas.toDataURL('image/jpeg', 0.85)
    } catch {
      // cross-origin (tainted) or a background image: fetch the bytes instead
      const url = el.currentSrc || el.src || /url\("?(.*?)"?\)/.exec(el.style.backgroundImage)?.[1]
      try {
        const blob = await (await fetch(url, { credentials: 'include' })).blob()
        return await new Promise((resolve) => {
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result)
          reader.readAsDataURL(blob)
        })
      } catch {
        return null
      }
    }
  }

  const COMPOSER = '[role="textbox"][contenteditable="true"]'
  const UPLOAD = `(() => { let el = document.querySelector('${COMPOSER}'); while (el && !el.querySelector('input[type="file"]')) el = el.parentElement; return el?.querySelector('input[type="file"]') })()`
  return {
    scrape: `(${scrape})()`,
    send: (text, expect) => `(${send})(${JSON.stringify(String(text))}, ${JSON.stringify(expect ?? null)}, ${scrape})`,
    openThread: (name, y) => `(${openThread})(${JSON.stringify(String(name))}, ${Number.isFinite(y) ? y : 'null'}, ${scrape})`,
    more: (pages = 4) => `(${more})(${Number(pages) || 1}, ${scrape})`,
    activity: `(${activity})()`,
    people: (query) => `(${people})(${JSON.stringify(String(query))})`,
    chatWith: (i) => `(${chatWith})(${Number(i)})`,
    closeDialog: `(${closeDialog})()`,
    media: (i) => `(${media})(${Number(i)})`,
    pick: `${UPLOAD}?.click()`, // Instagram's own file picker
    page: (dir) => `window.__vscScroller?.scrollBy(0, ${dir < 0 ? -1 : 1} * innerHeight)`,
    // files: [{ name, type, data (base64) }], handed to Instagram's upload input as if picked there
    // ponytail: whole file goes over as base64; fine for photos, stream it if large videos matter
    attach: (files) => `(() => {
      const upload = ${UPLOAD}
      if (!upload) return false
      const dt = new DataTransfer()
      for (const f of ${JSON.stringify(files)})
        dt.items.add(new File([Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0))], f.name, { type: f.type }))
      upload.files = dt.files
      upload.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    })()`,
  }
})()

if (typeof module !== 'undefined') module.exports = GUEST
