// Turns a conversation into a believable Python file.
// Messages stay recognisable (received = print(...), sent = ... input(...)); everything around
// them is filler. The filler is picked by a hash of each message, so the file doesn't
// reshuffle between refreshes or when older messages load above.
// Shared by the desktop app (as a <script>) and the VS Code extension (require).
const camo = (() => {
  // level (the "Spaces" number) -> wrap: odds a message sits inside a block; block: odds of a
  // filler block before it (up to two); fancy: odds of a dressed-up print such as print(..., flush=True)
  const LEVEL = {
    2: { wrap: 0.25, block: 0.12, fancy: 0.3 },
    4: { wrap: 0.45, block: 0.3, fancy: 0.5 },
    8: { wrap: 0.7, block: 0.6, fancy: 0.7 },
  }

  const HEADER = ['import json', 'import logging', 'from pathlib import Path', '', 'logger = logging.getLogger(__name__)', '']

  const RECV = [['print(', ')'], ['print(', ', flush=True)'], ['print(', ', end="\\n")']]
  // input() never stands alone: a bare call that throws its answer away doesn't look like real code
  const SEND = [
    ['answer = input(', ')'],
    ['reply = input(', ')'],
    ['name = input(', ').strip()'],
    ['choice = input(', ').lower()'],
    ['query = input(', ')'],
    ['text = input(', ').strip()'],
    ['value = input(', ') or DEFAULT'],
    ['line = input(', ')'],
    ['command = input(', ').split()'],
    ['user_input = input(', ')'],
  ]

  const NAMES = ['handle_event', 'on_message', 'process', 'dispatch', 'sync_users', 'load_batch', 'refresh', 'run_job', 'consume', 'apply_patch', 'validate', 'export_rows']

  // The message goes on the line marked @, at that line's indentation.
  const WRAPPERS = [
    'if __name__ == "__main__":\n    @',
    'with open(CONFIG_PATH) as f:\n    config = json.load(f)\n    @',
    'for attempt in range(3):\n    @\n    if attempt:\n        break',
    'try:\n    @\nexcept ValueError as err:\n    logger.warning("retrying: %s", err)',
    'if not CACHE:\n    @\nelse:\n    logger.debug("cache hit")',
    'def $f(event):\n    payload = json.loads(event["body"])\n    @\n    return payload.get("id")',
    'def $f(times=3):\n    while times > 0:\n        @\n        times -= 1',
    'async def $f(client, url):\n    resp = await client.get(url)\n    @\n    return resp.json()',
    'class Session:\n    def __init__(self, user):\n        self.user = user\n        @',
    'def $f(rows):\n    for row in rows:\n        if not row:\n            continue\n        @\n    return len(rows)',
  ]

  const BLOCKS = [
    'count += 1',
    'rows = [r for r in rows if r]',
    'logger.debug("tick")',
    'data = CACHE.get(key)',
    'index = (index + 1) % len(items)',
    'payload["seen"] = True',
    'queue.append(job)',
    'users = {u.id: u for u in session.query(User).all()}',
    'CONFIG_PATH = Path(__file__).parent / "config.json"',
    'CACHE = {}\nTIMEOUT = 30',
    '# TODO: move this into settings\nBASE_URL = "https://api.example.com/v1"',
    'total = sum(order.price * order.qty for order in orders)\nlogger.info("total=%s", total)',
    'def $f(rows):\n    return [r.strip().lower() for r in rows if r]',
    'def $f(path, data):\n    Path(path).write_text(json.dumps(data, indent=2))',
    'retries = 0\nwhile retries < TIMEOUT:\n    retries += 1',
    'def $f(items, size):\n    for i in range(0, len(items), size):\n        yield items[i:i + size]',
    'def $f(a, b):\n    merged = {**a, **b}\n    merged.pop("password", None)\n    return merged',
    '@dataclass\nclass Order:\n    id: int\n    price: float\n    qty: int = 1',
    'result = []\nfor row in rows:\n    if not row.get("active"):\n        continue\n    result.append(row["name"])',
    'def $f(value):\n    try:\n        return datetime.strptime(value, "%Y-%m-%d")\n    except ValueError:\n        return None',
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

  // rows: [{ side: 'recv' | 'send' | 'note', text, media, src }]
  // draft: { seed, text } adds the line being typed at the end, placed like a sent message
  // -> lines:
  //   { kind: 'code', text }                                       filler, header, blank lines
  //   { kind: 'note', indent, text }                               a "# ..." comment (timestamps, seen)
  //   { kind: 'recv' | 'send' | 'draft', indent, pre, post, ... }  a message: pre + "text" + post
  function camo(rows, level, draft) {
    const odds = LEVEL[level]
    const out = odds ? HEADER.map((text) => ({ kind: 'code', text })) : []
    const code = (text) => out.push({ kind: 'code', text })
    const isBlank = (l) => l.kind === 'code' && l.text === ''
    let previous // the last filler used, so the same snippet never comes twice in a row
    const blank = () => out.length && !isBlank(out.at(-1)) && code('') // one empty line between blocks

    // Puts one message line into the file, with its share of filler.
    const place = (seed, forms, line) => {
      const rand = seeded(seed)
      const pick = (list) => list[Math.floor(rand() * list.length)]
      // every input gets a variable to land in, at any level; print only sometimes gets extras
      const [pre, post] = forms === SEND || (odds && rand() < odds.fancy) ? pick(forms) : forms[0]
      if (!odds) return out.push({ ...line, indent: '', pre, post })
      const snippet = (list) => {
        let i = Math.floor(rand() * list.length)
        if (list[i] === previous) i = (i + 1) % list.length
        previous = list[i]
        return list[i].replaceAll('$f', pick(NAMES)).split('\n')
      }
      for (let n = 0; n < 2 && rand() < odds.block; n++) {
        blank()
        snippet(BLOCKS).forEach(code)
        blank()
      }
      if (rand() < odds.wrap) {
        blank()
        for (const l of snippet(WRAPPERS)) l.trim() === '@' ? out.push({ ...line, indent: l.slice(0, l.indexOf('@')), pre, post }) : code(l)
        blank()
      } else {
        out.push({ ...line, indent: '', pre, post })
      }
    }

    for (const row of rows) {
      if (row.side === 'note') out.push({ kind: 'note', indent: '', text: row.text ?? 'media' })
      else place(row.side + '\n' + row.text, row.side === 'recv' ? RECV : SEND, { kind: row.side, text: row.text, media: row.media, src: row.src })
    }
    if (draft) place('draft\n' + draft.seed, SEND, { kind: 'draft', text: draft.text ?? '' })
    return out
  }

  // A line as plain source text.
  camo.text = (l) => {
    if (l.kind === 'code') return l.text
    if (l.kind === 'note') return `${l.indent}# ${l.text}`
    const empty = l.kind === 'draft' && !l.text // nothing typed yet: a plain input(), no empty quotes
    const args = [l.text != null && !empty && quote(l.text), l.src && `open(${quote(file(l.src))})`].filter(Boolean)
    return l.indent + l.pre + args.join(', ') + l.post + (l.media && !l.src ? '  # media' : '')
  }
  camo.quote = quote
  camo.file = file
  camo.LEVELS = [0, ...Object.keys(LEVEL).map(Number)]
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
    { side: 'recv', text: '하나' },
    { side: 'recv', text: '둘' },
  ]
  for (const level of camo.LEVELS) {
    const lines = camo(rows, level, { seed: 'thread:7', text: '' })
    const text = lines.map(camo.text)
    // every message survives, in order, still marked print / input
    assert.deepStrictEqual(lines.filter((l) => l.kind !== 'code').map((l) => l.kind), ['note', 'recv', 'send', 'recv', 'send', 'recv', 'recv', 'draft'], `level ${level}`)
    for (const [i, l] of lines.entries()) {
      if (l.kind === 'recv') assert(text[i].trimStart().startsWith('print('), text[i])
      // sent lines and the typing line are always `name = input(...)`, never a bare call
      if (l.kind === 'send' || l.kind === 'draft') assert(/^\s*\w+ = input\(/.test(text[i]), text[i])
      assert(!text[i].includes('\n'), 'one line each')
      assert(!text[i].includes('@') || l.kind === 'code', 'placeholder replaced')
    }
    assert(text.some((t) => t.includes('"say \\"hi\\"\\nok\\\\"')), 'quotes, newlines, backslashes escaped')
    assert(text.some((t) => t.includes('open("photo.jpg")')))
    assert.deepStrictEqual(lines, camo(rows, level, { seed: 'thread:7', text: '' }), 'same input, same file')
    if (!level) assert.strictEqual(lines.length, rows.length + 1, 'level 0 is messages only')
    // typing must not move anything: only the draft line's text changes
    const typed = camo(rows, level, { seed: 'thread:7', text: '안녕' })
    assert.deepStrictEqual(typed.map((l) => ({ ...l, text: l.kind === 'draft' ? '' : l.text })), lines, 'typing keeps the layout')
    assert(/= input\(\)/.test(text.at(-1)) || level, 'nothing typed: input() without empty quotes')
    assert(text.some((t) => /= input\(\)/.test(t)) && typed.map(camo.text).some((t) => t.includes('input("안녕")')), 'quotes appear once there is text')
    assert.strictEqual(camo(rows, level).filter((l) => l.kind === 'draft').length, 0, 'no draft unless asked')
  }
  const many = Array.from({ length: 60 }, (_, i) => ({ side: i % 2 ? 'recv' : 'send', text: 'message ' + i }))
  assert(camo(many, 8).length > camo(many, 4).length && camo(many, 4).length > camo(many, 2).length, 'higher level, more filler')
  console.log('ok')
}
