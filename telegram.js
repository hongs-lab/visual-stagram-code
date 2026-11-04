// Runs inside web.telegram.org/k/ (Telegram Web K), the same way scrape.js runs inside Instagram: renderer.js
// injects these into the hidden Telegram webview. Same shape of snapshot as Instagram's scrape().
// ponytail: written from Telegram Web K's (stable, readable) class names but not yet checked against a signed-in
// session; retune the selectors here if a part stays empty.
const TELEGRAM = (() => {
  function scrape() {
    const box = (el) => el.getBoundingClientRect()
    const text = (el) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()
    const composer = document.querySelector('.input-message-input[contenteditable="true"]:not(.input-field-input-fake)')

    const items = [...document.querySelectorAll('.chatlist-chat')].filter((el) => box(el).height > 0)
    window.__vscThreads = items
    let list = items[0]?.parentElement
    while (list && !/auto|scroll/.test(getComputedStyle(list).overflowY)) list = list.parentElement
    window.__vscThreadScroller = list
    const origin = list ? box(list).top - list.scrollTop : 0
    const threads = items.map((el) => ({
      name: text(el.querySelector('.peer-title')),
      preview: text(el.querySelector('.row-subtitle, .dialog-subtitle')),
      unread: [...el.querySelectorAll('.dialog-subtitle-badge-unread, .badge-unread')].some((b) => box(b).width > 0 && text(b)),
      group: Number(el.dataset.peerId) < 0, // groups and channels have negative peer ids
      y: Math.round(box(el).top - origin),
    }))

    const rows = []
    const media = []
    const scroller = document.querySelector('.bubbles .scrollable')
    window.__vscScroller = scroller
    for (const b of document.querySelectorAll('.bubbles-inner .bubble')) {
      if (!box(b).height) continue
      if (b.classList.contains('service')) {
        if (text(b)) rows.push({ side: 'note', text: text(b) })
        continue
      }
      const message = b.querySelector('.message')
      const copy = message?.cloneNode(true)
      copy?.querySelectorAll('.time, .reactions, .bubble-name-rank, .reply, .name').forEach((x) => x.remove())
      const pic = b.querySelector('.media-photo, .media-video, .media-sticker')
      const name = text(b.querySelector('.name .peer-title, .colored-name'))
      if (name && !b.classList.contains('is-out')) rows.push({ side: 'note', text: name })
      const row = { side: b.classList.contains('is-out') ? 'send' : 'recv', text: text(copy) || null, media: !!pic, src: null }
      if (pic) row.mi = media.push(pic) - 1
      if (name) row.who = name
      if (row.text || pic) rows.push(row)
    }
    window.__vscMedia = media

    let pending = 0 // Telegram asks about attachments in a popup of its own
    return {
      ok: !document.querySelector('.popup, #auth-pages') && (items.length > 0 || !!composer),
      threads,
      rows,
      pending,
      canSend: !!composer,
      badge: threads.filter((t) => t.unread).length,
      me: null,
      open: text(document.querySelector('.chat-info .peer-title, .topbar .peer-title')) || null,
    }
  }

  // The composer is a plain contenteditable: set its text, tell it, press send. Nothing is focused.
  async function send(text, expect, scrape) {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    const norm = (s) => (s ?? '').replace(/\s+/g, '')
    const composer = () => document.querySelector('.input-message-input[contenteditable="true"]:not(.input-field-input-fake)')
    const open = scrape().open
    if (expect && open && norm(open) !== norm(expect)) return { ok: false, why: 'thread' }
    if (!composer() || !text) return { ok: false, why: 'composer' }
    const count = () => scrape().rows.filter((r) => r.side === 'send' && norm(r.text).includes(norm(text))).length
    const before = count()
    const submit = async () => {
      const input = composer()
      input.innerText = text
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }))
      await sleep(80)
      const button = document.querySelector('.btn-send')
      if (button?.classList.contains('send')) button.click() // in its other states it records voice
      else input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }))
    }
    const landed = async () => {
      for (let t = 0; t < 3000; t += 150) {
        await sleep(150)
        if (count() > before) return true
      }
      return false
    }
    await submit()
    if (await landed()) return { ok: true }
    await submit()
    return { ok: await landed(), retried: true }
  }

  async function openThread(name, y, scrape) {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    const norm = (s) => (s ?? '').replace(/\s+/g, ' ').trim()
    const find = () => {
      scrape()
      return (window.__vscThreads ?? []).find((el) => norm(el.querySelector('.peer-title')?.textContent) === norm(name))
    }
    let el = find()
    const list = window.__vscThreadScroller
    for (let i = 0; !el && list && i < 40; i++) {
      list.scrollTop += list.clientHeight * 0.8
      await sleep(400)
      el = find()
    }
    el?.click()
    if (list) list.scrollTop = 0
    return !!el
  }

  async function more(pages, scrape) {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    scrape()
    const list = window.__vscThreadScroller
    if (!list) return []
    const found = new Map()
    for (let page = 0; page < pages; page++) {
      list.scrollTop = list.scrollHeight
      await sleep(600)
      for (const t of scrape().threads) found.set(t.name, t)
    }
    list.scrollTop = 0
    return [...found.values()]
  }

  async function media(i) {
    const el = window.__vscMedia?.[i]?.querySelector('img, video, canvas') ?? window.__vscMedia?.[i]
    if (!el) return null
    if (el.tagName === 'CANVAS') return el.toDataURL('image/jpeg', 0.85)
    const canvas = Object.assign(document.createElement('canvas'), { width: el.videoWidth || el.naturalWidth || 320, height: el.videoHeight || el.naturalHeight || 320 })
    try {
      canvas.getContext('2d').drawImage(el, 0, 0, canvas.width, canvas.height)
      return canvas.toDataURL('image/jpeg', 0.85)
    } catch {
      return null
    }
  }

  return {
    scrape: `(${scrape})()`,
    send: (text, expect) => `(${send})(${JSON.stringify(String(text))}, ${JSON.stringify(expect ?? null)}, ${scrape})`,
    openThread: (name, y) => `(${openThread})(${JSON.stringify(String(name))}, ${Number.isFinite(y) ? y : 'null'}, ${scrape})`,
    more: (pages = 4) => `(${more})(${Number(pages) || 1}, ${scrape})`,
    media: (i) => `(${media})(${Number(i)})`,
    page: (dir) => `window.__vscScroller?.scrollBy(0, ${dir < 0 ? -1 : 1} * innerHeight)`,
    // not on Telegram (yet): new message search, the activity file, attachments
    activity: 'null',
    people: () => 'null',
    chatWith: () => 'false',
    closeDialog: 'false',
    pick: 'false',
    attach: () => 'false',
  }
})()

if (typeof module !== 'undefined') module.exports = TELEGRAM
