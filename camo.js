// Turns a conversation into a believable Python file.
// Messages stay recognisable (received = print(...), sent = input(...)); everything around
// them is filler. The filler is picked by a hash of each message, so the file doesn't
// reshuffle between refreshes or when older messages load above.
// Shared by the desktop app (as a <script>) and the VS Code extension (require).
const camo = (() => {
  // level (the "Spaces" number) -> odds of [wrapping a message in a block, a filler block before it, a fancier call]
  const ODDS = { 0: [0, 0, 0], 2: [0.25, 0.12, 0.3], 4: [0.45, 0.3, 0.5], 8: [0.7, 0.6, 0.7] }

  const HEADER = ['import json', 'import logging', 'from pathlib import Path', '', 'logger = logging.getLogger(__name__)', '']

  const RECV = [['print(', ')'], ['print(', ', flush=True)'], ['print(', ', end="\\n")']]
  const SEND = [['input(', ')'], ['reply = input(', ')'], ['answer = input(', ').strip()'], ['name = input(', ')'], ['choice = input(', ').lower()']]

  const NAMES = ['handle_event', 'on_message', 'process', 'dispatch', 'sync_users', 'load_batch', 'refresh', 'run_job', 'consume', 'apply_patch', 'validate', 'export_rows']

  // The message goes on the line marked @, at that line's indentation.
  const WRAPPERS = [
    'def $f(event):\n    payload = json.loads(event["body"])\n    @\n    return payload.get("id")',
    'for attempt in range(3):\n    @\n    if attempt:\n        break',
    'with open(CONFIG_PATH) as f:\n    config = json.load(f)\n    @',
    'try:\n    @\nexcept ValueError as err:\n    logger.warning("retrying: %s", err)',
    'if __name__ == "__main__":\n    @',
    'def $f(times=3):\n    while times > 0:\n        @\n        times -= 1',
    'async def $f(client, url):\n    resp = await client.get(url)\n    @\n    return resp.json()',
    'class Session:\n    def __init__(self, user):\n        self.user = user\n        @',
    'if not CACHE:\n    @\nelse:\n    logger.debug("cache hit")',
    'def $f(rows):\n    for row in rows:\n        if not row:\n            continue\n        @\n    return len(rows)',
  ]

  const BLOCKS = [
    'def $f(rows):\n    return [r.strip().lower() for r in rows if r]',
    'CACHE = {}\nTIMEOUT = 30',
    'def $f(items, size):\n    for i in range(0, len(items), size):\n        yield items[i:i + size]',
    'total = sum(order.price * order.qty for order in orders)\nlogger.info("total=%s", total)',
    '# TODO: move this into settings\nBASE_URL = "https://api.example.com/v1"',
    'def $f(value):\n    try:\n        return datetime.strptime(value, "%Y-%m-%d")\n    except ValueError:\n        return None',
    'users = {u.id: u for u in session.query(User).all()}',
    '@dataclass\nclass Order:\n    id: int\n    price: float\n    qty: int = 1',
    'result = []\nfor row in rows:\n    if not row.get("active"):\n        continue\n    result.append(row["name"])',
    'def $f(path, data):\n    Path(path).write_text(json.dumps(data, indent=2))',
    'CONFIG_PATH = Path(__file__).parent / "config.json"',
    'def $f(a, b):\n    merged = {**a, **b}\n    merged.pop("password", None)\n    return merged',
    'retries = 0\nwhile retries < TIMEOUT:\n    retries += 1',
    'def $f(text):\n    words = text.split()\n    counts = {}\n    for word in words:\n        counts[word] = counts.get(word, 0) + 1\n    return sorted(counts.items(), key=lambda kv: kv[1], reverse=True)',
  ]

  // FNV-1a seed, then a small mixing generator: same text in, same sequence out.
  const seeded = (text) => {
    let h = 2166136261
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
    return () => {
      h = Math.imul(h ^ (h >>> 15), 2246822507)
      h = Math.imul(h ^ (h >>> 13), 3266489909)
      return ((h ^= h >>> 16) >>> 0) / 4294967296
    }
  }

  const quote = (s) => `"${s.replace(/[\\"]/g, '\\$&').replace(/\n/g, '\\n')}"`
  const file = (src) => new URL(src).pathname.split('/').pop()

  // rows: [{ side: 'recv' | 'send' | 'note', text, media, src }] -> lines:
  //   { kind: 'code', text }                              filler, header, blank lines
  //   { kind: 'note', indent, text }                      a "# ..." comment (timestamps, seen)
  //   { kind: 'recv' | 'send', indent, pre, post, ... }   a message: pre + "text" + post
  function camo(rows, level) {
    const [wrapOdds, blockOdds, fancyOdds] = ODDS[level] ?? ODDS[0]
    const out = level ? HEADER.map((text) => ({ kind: 'code', text })) : []
    const code = (text) => out.push({ kind: 'code', text })
    const blank = () => out.length && out.at(-1).text !== '' && code('') // one empty line between blocks

    for (const row of rows) {
      if (row.side === 'note') {
        out.push({ kind: 'note', indent: '', text: row.text ?? 'media' })
        continue
      }
      const rand = seeded(row.side + '\n' + row.text)
      const pick = (list) => list[Math.floor(rand() * list.length)]
      const forms = row.side === 'recv' ? RECV : SEND
      const [pre, post] = rand() < fancyOdds ? pick(forms) : forms[0]
      const message = (indent) => out.push({ kind: row.side, indent, pre, post, text: row.text, media: row.media, src: row.src })

      for (let n = 0; n < 2 && rand() < blockOdds; n++) {
        blank()
        pick(BLOCKS).replaceAll('$f', pick(NAMES)).split('\n').forEach(code)
        blank()
      }
      if (rand() < wrapOdds) {
        blank()
        for (const l of pick(WRAPPERS).replaceAll('$f', pick(NAMES)).split('\n')) l.trim() === '@' ? message(l.slice(0, l.indexOf('@'))) : code(l)
        blank()
      } else {
        message('')
      }
    }
    return out
  }

  // A line as plain source text.
  camo.text = (l) => {
    if (l.kind === 'code') return l.text
    if (l.kind === 'note') return `${l.indent}# ${l.text}`
    const args = [l.text != null && quote(l.text), l.src && `open(${quote(file(l.src))})`].filter(Boolean)
    return l.indent + l.pre + args.join(', ') + l.post + (l.media && !l.src ? '  # media' : '')
  }
  camo.quote = quote
  camo.file = file
  camo.LEVELS = Object.keys(ODDS).map(Number)
  return camo
})()

if (typeof module !== 'undefined') module.exports = camo

// node camo.js: self-check
if (typeof require !== 'undefined' && require.main === module) {
  const assert = require('assert')
  const rows = [
    { side: 'note', text: '오후 2:14' },
    { side: 'recv', text: '뭐해?' },
    { side: 'send', text: 'say "hi"\nok\\' },
    { side: 'recv', text: null, media: true, src: 'https://cdn.example.com/v/a/photo.jpg?sig=1' },
    { side: 'send', text: null, media: true, src: null },
  ]
  for (const level of camo.LEVELS) {
    const lines = camo(rows, level)
    const text = lines.map(camo.text)
    // every message survives, in order, still marked print / input
    const kinds = lines.filter((l) => l.kind !== 'code').map((l) => l.kind)
    assert.deepStrictEqual(kinds, ['note', 'recv', 'send', 'recv', 'send'], `level ${level}`)
    for (const [i, l] of lines.entries()) {
      if (l.kind === 'recv') assert(text[i].trimStart().startsWith('print('), text[i])
      if (l.kind === 'send') assert(/\binput\(/.test(text[i]), text[i])
      assert(!text[i].includes('\n'), 'one line each')
      assert(!text[i].includes('@') || l.kind === 'code', 'placeholder replaced')
    }
    assert(text.some((t) => t.includes('"say \\"hi\\"\\nok\\\\"')), 'quotes, newlines, backslashes escaped')
    assert(text.some((t) => t.includes('open("photo.jpg")')))
    assert.deepStrictEqual(lines, camo(rows, level), 'same input, same file')
    if (!level) assert.strictEqual(lines.length, rows.length, 'level 0 is messages only')
  }
  assert(camo(rows, 8).length > camo(rows, 2).length, 'higher level, more filler')
  console.log('ok')
}
