// Runs inside instagram.com (renderer.js injects it into the hidden webview).
// Everything that knows Instagram's DOM lives in this one function.
// ponytail: pure layout heuristics, because Instagram's class names are obfuscated and its
// ARIA roles can't be relied on; retune here when their markup shifts.
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
  window.__vscScroller = scroller // renderer scrolls this to page through history
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
    // photos, GIFs, stickers, video posters: anything picture-sized (avatars are smaller)
    const media = [...row.querySelectorAll('img, video')].find((m) => box(m).width > 80)
    if (media) grow(box(media))
    if (!words.length && !media) continue
    const src = media?.currentSrc || media?.src || media?.poster || ''
    const gapLeft = left - pane.left
    const gapRight = pane.right - right
    const centred = Math.abs(gapLeft - gapRight) < pane.width * 0.1
    rows.push({
      top: box(row).top,
      side: centred || (small && !media) ? 'note' : gapLeft < gapRight ? 'recv' : 'send',
      text: words.length ? words.join(' ') : null,
      media: !!media,
      src: src.startsWith('https:') ? src : null, // blob: previews can't leave the page
    })
  }
  rows.sort((a, b) => a.top - b.top) // visual order, whatever the DOM order
  for (const row of rows) delete row.top // it moves on every scroll; keep snapshots comparable

  // Threads: wide clickable things holding an avatar, left of the chat pane.
  const edge = pane ? pane.left : 520
  const items = new Set()
  for (const img of document.querySelectorAll('img')) {
    let item = img
    while ((item = item.parentElement?.closest(CLICKABLE)) && box(item).width < 200);
    if (item && box(item).right <= edge + 1) items.add(item)
  }
  window.__vscThreads = [...items] // renderer clicks these by index

  // Attachments waiting in the composer: thumbnails in the box that owns the upload input.
  let tray = composer
  while (tray && !tray.querySelector('input[type="file"]')) tray = tray.parentElement
  if (scroller && tray?.contains(scroller)) tray = null
  const pending = [...(tray?.querySelectorAll('img, video') ?? [])].filter((m) => box(m).width >= 40).length

  return {
    // a dialog (notifications prompt, etc.) needs the real page, so report not-ok
    ok: !document.querySelector('[role="dialog"]') && (items.size > 0 || !!composer),
    threads: [...items].map((el) => el.innerText.trim().split('\n')[0]),
    rows,
    pending,
    canSend: !!composer,
  }
}
