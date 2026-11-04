// Turns a conversation into a believable source file, in whatever language the file's extension says.
// Messages stay recognisable (received = an output call such as print(...), sent = an input-like
// assignment such as reply = input(...)); everything around them is filler. The filler is picked by a
// hash of each message, so the file doesn't reshuffle between refreshes or when older messages load above.
// Shared by the desktop app (as a <script>) and the VS Code extension (require).
const camo = (() => {
  // level (the "Spaces" number) -> wrap: odds a message sits inside a block; block: odds of a filler block
  // before it (up to two); fancy: odds of a dressed-up call such as print(..., flush=True); group: odds that a
  // run of messages from the same side shares one structure (a list, a dict, a multi-line call)
  const LEVEL = {
    2: { wrap: 0.35, block: 0.3, fancy: 0.4, group: 0.3 },
    4: { wrap: 0.55, block: 0.55, fancy: 0.6, group: 0.45 },
    8: { wrap: 0.75, block: 0.85, fancy: 0.8, group: 0.6 },
  }

  const SNAKE = ['handle_event', 'on_message', 'process', 'dispatch', 'sync_users', 'load_batch', 'refresh', 'run_job', 'consume', 'apply_patch', 'validate', 'export_rows', 'parse_args', 'build_index', 'flush_cache', 'resolve_path']
  const CAMEL = ['handleEvent', 'onMessage', 'process', 'dispatch', 'syncUsers', 'loadBatch', 'refresh', 'runJob', 'consume', 'applyPatch', 'validate', 'exportRows', 'parseArgs', 'buildIndex', 'flushCache', 'resolvePath']
  const PASCAL = CAMEL.map((s) => s[0].toUpperCase() + s.slice(1))
  const KEBAB = SNAKE.map((s) => s.replaceAll('_', '-'))
  const VERBS = ['Invoke-Sync', 'Get-Config', 'Update-Cache', 'Start-Worker', 'Remove-Stale', 'Export-Rows', 'Test-Health', 'Send-Report', 'Read-Batch', 'Sync-Users', 'Build-Index', 'Clear-Cache']
  const KEYS = ['title', 'body', 'status', 'detail', 'hint', 'label', 'summary', 'note', 'reason', 'message', 'prompt', 'error']

  // A message as a literal of the language. The input line shows the two ends around what is typed (quotes()).
  const dq = (s) => `"${s.replace(/[\\"]/g, '\\$&').replace(/\n/g, '\\n')}"`
  const sq = (s) => `'${s.replace(/[\\']/g, '\\$&').replace(/\n/g, '\\n')}'`
  const doubled = (q) => (s) => q + s.replaceAll(q, q + q).replace(/\n/g, ' ') + q // SQL '', VB and CSV ""
  const dollar = (quote) => (s) => quote(s).replace(/\$/g, '\\$') // "$name" would be interpolated
  const shell = (s) => `"${s.replace(/[\\"$`]/g, '\\$&').replace(/\n/g, '\\n')}"`
  const bare = (s) => s.replace(/\n/g, ' ')
  const markup = (s) => bare(s.replace(/&/g, '&amp;').replace(/</g, '&lt;'))

  // for the editor's colouring (hl): comment starts, and patterns of [regex, class] tried before keywords
  const C = ['//', '/*']
  const AT = ['@\\w+', 'fn'] // decorators, annotations, macros
  const PRE = ['^\\s*#\\s*\\w+', 'kw'] // C preprocessor
  const SIGIL = ['\\$\\{?\\w+\\}?', 'key'] // $variables

  // A language: header/footer lines around the file, recv/send forms [pre, post] around the quoted message
  // (recv[0] is the plain one), wrap: blocks a message sits in (the line that is just "@"), block: filler,
  // group: [structure with an "@@" line, item pre, item post] for a run of messages. $f is a function name,
  // $k a dict key. base: indent of everything between header and footer; first: how many header lines go above the
  // comment block on top (#!, <?php). hl: how the editor colours it.
  const LANGS = {
    python: {
      comment: '# ', open: ['open(', ')'], names: SNAKE, indent: '    ',
      hl: { kw: 'import from return if elif else for while with as try except finally raise yield pass break continue await async del global nonlocal assert match case', decl: 'def class lambda None True False and or not in is self cls', types: 'int str float bool dict list tuple set bytes object Path Any Optional', extra: [AT] },
      header: ['import json', 'import logging', 'import os', 'import sys', 'from dataclasses import dataclass', 'from pathlib import Path', '', 'logger = logging.getLogger(__name__)', ''],
      recv: [['print(', ')'], ['print(', ', flush=True)'], ['print(', ', end="\\n")'], ['print(', ', file=sys.stderr)'], ['logger.info(', ')'], ['logger.debug(', ')'], ['logger.warning(', ')'], ['sys.stdout.write(', ' + "\\n")']],
      // input() never stands alone: a bare call that throws its answer away doesn't look like real code
      send: [['answer = input(', ')'], ['reply = input(', ')'], ['name = input(', ').strip()'], ['choice = input(', ').lower()'], ['query = input(', ')'], ['text = input(', ').strip()'], ['value = input(', ') or DEFAULT'], ['line = input(', ')'], ['command = input(', ').split()'], ['user_input = input(', ')'], ['response = input(', ').strip().lower()'], ['token = input(', ').strip()'], ['message = input(', ')']],
      wrap: [
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
        '@dataclass\nclass Job:\n    name: str\n    retries: int = 0\n\n    def run(self):\n        @\n        self.retries += 1',
        'while queue:\n    job = queue.pop(0)\n    @',
        'with lock:\n    @\n    counter += 1',
        'if os.environ.get("DEBUG"):\n    @',
        'def $f(path: Path) -> dict:\n    """Read a JSON file, or an empty dict when there is none."""\n    if not path.exists():\n        @\n        return {}\n    return json.loads(path.read_text())',
        'for key, value in config.items():\n    if value is None:\n        @',
        'try:\n    result = $f(payload)\nexcept KeyError:\n    @\n    result = None',
        'match command:\n    case "start":\n        @\n    case _:\n        pass',
      ],
      block: [
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
        'class Cache:\n    def __init__(self, size=128):\n        self.size = size\n        self.store = {}\n\n    def get(self, key, default=None):\n        return self.store.get(key, default)',
        'headers = {\n    "Content-Type": "application/json",\n    "Authorization": f"Bearer {token}",\n}',
        'if response.status_code != 200:\n    raise RuntimeError(f"bad status: {response.status_code}")',
        'assert isinstance(items, list), "items must be a list"',
        'elapsed = time.perf_counter() - started\nlogger.info("done in %.2fs", elapsed)',
        'def $f(n: int) -> int:\n    if n < 2:\n        return n\n    return $f(n - 1) + $f(n - 2)',
        'parser = argparse.ArgumentParser()\nparser.add_argument("--dry-run", action="store_true")\nargs = parser.parse_args()',
        'lookup = dict(zip(keys, values))',
        '# NOTE: keep in sync with the schema\nFIELDS = ("id", "name", "created_at")',
        'for i, row in enumerate(rows):\n    row["index"] = i',
        'with ThreadPoolExecutor(max_workers=4) as pool:\n    results = list(pool.map($f, urls))',
        'try:\n    import ujson as json\nexcept ImportError:\n    pass',
        'pending = [job for job in jobs if job.state == "pending"]\nlogger.debug("%d pending", len(pending))',
        'def $f(config):\n    return {\n        "host": config.get("host", "localhost"),\n        "port": int(config.get("port", 8080)),\n    }',
      ],
      group: {
        recv: [['for line in [\n    @@\n]:\n    print(line)', '', ','], ['MESSAGES = (\n    @@\n)', '', ','], ['print(\n    @@\n    sep="\\n",\n)', '', ','], ['RESPONSES = {\n    @@\n}', '"$k": ', ',']],
        send: [['answers = [\n    @@\n]', 'input(', '),'], ['responses = {\n    @@\n}', '"$k": input(', '),']],
      },
    },
    javascript: {
      comment: '// ', open: ['readFileSync(', ')'], names: CAMEL, indent: '  ',
      hl: { com: C, kw: 'import export from return if else for while do switch case break continue try catch finally throw new await async yield of in typeof instanceof default delete', decl: 'const let var function class extends this null undefined true false static get set', types: 'Promise Map Set Array Object JSON Math Date Error', extra: [AT] },
      header: ["import fs from 'node:fs/promises';", "import path from 'node:path';", "import readline from 'node:readline/promises';", '', 'const rl = readline.createInterface({ input: process.stdin, output: process.stdout });', 'const logger = console;', ''],
      recv: [['console.log(', ');'], ['console.info(', ');'], ['logger.debug(', ');'], ['console.warn(', ');'], ['process.stdout.write(', ' + "\\n");']],
      send: [['const answer = await rl.question(', ');'], ['const reply = await rl.question(', ');'], ['const name = (await rl.question(', ')).trim();'], ['let input = await rl.question(', ');'], ['const choice = (await rl.question(', ')).toLowerCase();'], ['const query = await rl.question(', ');'], ['const line = await rl.question(', ');']],
      wrap: [
        'if (import.meta.url === `file://${process.argv[1]}`) {\n  @\n}',
        'for (let attempt = 0; attempt < 3; attempt++) {\n  @\n  if (attempt) break;\n}',
        'try {\n  @\n} catch (err) {\n  logger.warn(`retrying: ${err.message}`);\n}',
        'async function $f(url) {\n  const res = await fetch(url);\n  @\n  return res.json();\n}',
        'function $f(rows) {\n  for (const row of rows) {\n    if (!row) continue;\n    @\n  }\n  return rows.length;\n}',
        'export class Session {\n  constructor(user) {\n    this.user = user;\n    @\n  }\n}',
        'if (!cache.has(key)) {\n  @\n} else {\n  logger.debug("cache hit");\n}',
        'const $f = async (event) => {\n  const payload = JSON.parse(event.body);\n  @\n  return payload.id;\n};',
        'process.on("SIGINT", () => {\n  @\n  process.exit(0);\n});',
        'setTimeout(() => {\n  @\n}, 1000);',
        'switch (command) {\n  case "start":\n    @\n    break;\n  default:\n    break;\n}',
      ],
      block: [
        'let count = 0;',
        'count += 1;',
        'const rows = items.filter(Boolean);',
        'const cache = new Map();\nconst TIMEOUT = 30_000;',
        '// TODO: move this into config\nconst BASE_URL = "https://api.example.com/v1";',
        'const total = orders.reduce((sum, o) => sum + o.price * o.qty, 0);\nlogger.info(`total=${total}`);',
        'function $f(rows) {\n  return rows.map((r) => r.trim().toLowerCase()).filter(Boolean);\n}',
        'async function $f(file, data) {\n  await fs.writeFile(file, JSON.stringify(data, null, 2));\n}',
        'const headers = {\n  "Content-Type": "application/json",\n  Authorization: `Bearer ${token}`,\n};',
        'const users = Object.fromEntries(list.map((u) => [u.id, u]));',
        'function* $f(items, size) {\n  for (let i = 0; i < items.length; i += size) {\n    yield items.slice(i, i + size);\n  }\n}',
        'const { id, name, ...rest } = payload;',
        'if (!res.ok) {\n  throw new Error(`bad status: ${res.status}`);\n}',
        'const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));',
        'export const $f = (a, b) => ({ ...a, ...b, updatedAt: Date.now() });',
        'const started = performance.now();',
        'queue.push(job);',
        'index = (index + 1) % items.length;',
      ],
      group: {
        recv: [['const messages = [\n  @@\n];', '', ','], ['logger.info([\n  @@\n].join("\\n"));', '', ','], ['const RESPONSES = {\n  @@\n};', '$k: ', ',']],
        send: [['const answers = [\n  @@\n];', 'await rl.question(', '),']],
      },
    },
    typescript: {
      comment: '// ', open: ['readFileSync(', ')'], names: CAMEL, indent: '  ',
      hl: { com: C, kw: 'import export from return if else for while do switch case break continue try catch finally throw new await async yield of in typeof instanceof default as satisfies keyof', decl: 'const let var function class extends implements interface type enum this null undefined true false public private protected readonly static', types: 'string number boolean any unknown void never Promise Record Partial Array Map Set Request Response', extra: [AT] },
      header: ['import { readFile } from "node:fs/promises";', 'import * as readline from "node:readline/promises";', 'import type { Request, Response } from "express";', '', 'const rl = readline.createInterface({ input: process.stdin, output: process.stdout });', ''],
      recv: [['console.log(', ');'], ['console.info(', ');'], ['console.debug(', ');'], ['console.warn(', ');']],
      send: [['const answer: string = await rl.question(', ');'], ['const reply = await rl.question(', ');'], ['const name: string = (await rl.question(', ')).trim();'], ['let input: string = await rl.question(', ');'], ['const choice = (await rl.question(', ')).toLowerCase() as Choice;'], ['const query: string = await rl.question(', ');']],
      wrap: [
        'async function $f(url: string): Promise<unknown> {\n  const res = await fetch(url);\n  @\n  return res.json();\n}',
        'export class Session {\n  constructor(private readonly user: User) {\n    @\n  }\n}',
        'function $f(rows: Row[]): number {\n  for (const row of rows) {\n    if (!row) continue;\n    @\n  }\n  return rows.length;\n}',
        'try {\n  @\n} catch (err: unknown) {\n  console.warn("retrying", err);\n}',
        'if (process.env.DEBUG) {\n  @\n}',
        'for (let attempt = 0; attempt < 3; attempt++) {\n  @\n}',
        'export const $f = async (req: Request, res: Response): Promise<void> => {\n  @\n  res.json({ ok: true });\n};',
      ],
      block: [
        'interface User {\n  id: number;\n  name: string;\n  email?: string;\n}',
        'type Status = "idle" | "loading" | "done";',
        'const cache = new Map<string, number>();',
        'export enum Level {\n  Debug,\n  Info,\n  Warn,\n}',
        'function $f<T>(items: T[], size: number): T[][] {\n  const out: T[][] = [];\n  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));\n  return out;\n}',
        'const total = orders.reduce((sum: number, o: Order) => sum + o.price * o.qty, 0);',
        'let retries = 0;',
        '// TODO: move this into config\nconst BASE_URL = "https://api.example.com/v1";',
        'export const $f = (a: Config, b: Partial<Config>): Config => ({ ...a, ...b });',
        'const timeout: number = Number(process.env.TIMEOUT ?? 30);',
        'type Handler = (event: Event) => Promise<void>;',
        'const seen = new Set<string>();',
      ],
      group: {
        recv: [['const messages: string[] = [\n  @@\n];', '', ','], ['const RESPONSES: Record<string, string> = {\n  @@\n};', '$k: ', ',']],
        send: [['const answers: string[] = [\n  @@\n];', 'await rl.question(', '),']],
      },
    },
    java: {
      comment: '// ', open: ['new File(', ')'], names: CAMEL, indent: '    ', base: '    ',
      hl: { com: C, kw: 'import package return if else for while do switch case break continue try catch finally throw throws new assert default', decl: 'public private protected static final abstract class interface record enum extends implements void this super null true false synchronized var', types: 'String int long double float boolean char byte List Map Set Optional Integer Logger Console Object', extra: [AT] },
      header: ['package com.example.app;', '', 'import java.io.Console;', 'import java.io.IOException;', 'import java.util.*;', 'import java.util.logging.Logger;', '', 'public final class App {', '    private static final Logger LOG = Logger.getLogger(App.class.getName());', '    private static final Console console = System.console();', ''],
      footer: ['}'],
      recv: [['System.out.println(', ');'], ['LOG.info(', ');'], ['System.err.println(', ');'], ['LOG.fine(', ');']],
      send: [['String reply = console.readLine(', ');'], ['String answer = console.readLine(', ').trim();'], ['var input = console.readLine(', ');'], ['String name = console.readLine(', ').strip();'], ['final String choice = console.readLine(', ').toLowerCase();'], ['String line = console.readLine(', ');']],
      wrap: [
        'public static void main(String[] args) {\n    @\n}',
        'private void $f(List<String> rows) {\n    for (String row : rows) {\n        if (row.isEmpty()) continue;\n        @\n    }\n}',
        'private void $f() throws IOException {\n    try {\n        @\n    } catch (IllegalStateException e) {\n        LOG.warning("retrying: " + e.getMessage());\n    }\n}',
        '@Override\npublic void run() {\n    @\n}',
        'private synchronized void $f() {\n    @\n    counter++;\n}',
        'private static void $f(int times) {\n    for (int attempt = 0; attempt < times; attempt++) {\n        @\n    }\n}',
      ],
      block: [
        'private int count = 0;',
        'private final Map<String, Integer> cache = new HashMap<>();',
        '// TODO: move this into config\nprivate static final String BASE_URL = "https://api.example.com/v1";',
        'private static final int TIMEOUT = 30;',
        'public record Order(long id, double price, int qty) {}',
        'private static List<String> $f(List<String> rows) {\n    return rows.stream()\n        .map(String::trim)\n        .filter(s -> !s.isEmpty())\n        .toList();\n}',
        '@Deprecated\nprivate void $f() {\n    throw new UnsupportedOperationException();\n}',
        'private static int $f(int n) {\n    return n < 2 ? n : $f(n - 1) + $f(n - 2);\n}',
        'private final Object lock = new Object();',
        'private double $f(List<Order> orders) {\n    return orders.stream().mapToDouble(o -> o.price() * o.qty()).sum();\n}',
      ],
      group: {
        recv: [['private static final List<String> MESSAGES = List.of(\n    @@\n);', '', ','], ['private static final Map<String, String> RESPONSES = Map.of(\n    @@\n);', '"$k", ', ',']],
        send: [['private final String[] answers = {\n    @@\n};', 'console.readLine(', '),']],
      },
    },
    c: {
      comment: '// ', open: ['fopen(', ', "rb")'], names: SNAKE, indent: '    ',
      hl: { com: C, kw: 'return if else for while do switch case break continue goto sizeof default', decl: 'int char void const static struct typedef unsigned signed long short double float enum extern NULL', types: 'size_t FILE bool uint8_t uint32_t int64_t', extra: [PRE] },
      header: ['#include <stdio.h>', '#include <stdlib.h>', '#include <string.h>', '#include <readline/readline.h>', '', '#define TIMEOUT 30', ''],
      recv: [['puts(', ');'], ['printf("%s\\n", ', ');'], ['fprintf(stderr, "%s\\n", ', ');'], ['fputs(', ', stdout);']],
      send: [['char *reply = readline(', ');'], ['char *line = readline(', ');'], ['const char *answer = readline(', ');'], ['char *input = readline(', ');']],
      wrap: [
        'int main(int argc, char **argv) {\n    @\n    return 0;\n}',
        'for (int i = 0; i < 3; i++) {\n    @\n    if (i) break;\n}',
        'if (argc < 2) {\n    @\n    return EXIT_FAILURE;\n}',
        'static void $f(const char *path) {\n    FILE *fp = fopen(path, "r");\n    if (!fp) {\n        @\n        return;\n    }\n    fclose(fp);\n}',
        'while (running) {\n    @\n    usleep(1000);\n}',
        'switch (cmd) {\ncase \'s\':\n    @\n    break;\ndefault:\n    break;\n}',
      ],
      block: [
        'static int count = 0;',
        'count++;',
        'struct order {\n    int id;\n    double price;\n    int qty;\n};',
        'static char buf[BUFSIZ];',
        'size_t len = strlen(buf);',
        'static int $f(int n) {\n    return n < 2 ? n : $f(n - 1) + $f(n - 2);\n}',
        '/* TODO: move this into config */\nstatic const char *BASE_URL = "https://api.example.com/v1";',
        'char *copy = malloc(len + 1);\nif (!copy) {\n    perror("malloc");\n    exit(1);\n}\nmemcpy(copy, buf, len + 1);',
        'typedef enum { IDLE, RUNNING, DONE } state_t;',
        'static void $f(int *items, size_t n) {\n    for (size_t i = 0; i < n; i++)\n        items[i] *= 2;\n}',
        'free(copy);',
      ],
      group: {
        recv: [['static const char *MESSAGES[] = {\n    @@\n};', '', ',']],
        send: [['char *answers[] = {\n    @@\n};', 'readline(', '),']],
      },
    },
    cpp: {
      comment: '// ', open: ['std::ifstream(', ')'], names: SNAKE, indent: '    ',
      hl: { com: C, kw: 'return if else for while do switch case break continue try catch throw new delete sizeof default co_await', decl: 'int char void const static struct class public private protected template typename namespace using auto bool double float unsigned long constexpr explicit virtual override nullptr true false this', types: 'std string vector unordered_map map size_t mutex', extra: [PRE] },
      header: ['#include <iostream>', '#include <string>', '#include <vector>', '#include <unordered_map>', '', 'namespace app {', ''],
      footer: ['}  // namespace app'],
      recv: [['std::cout << ', ' << std::endl;'], ['std::cout << ', " << '\\n';"], ['std::cerr << ', ' << std::endl;'], ['spdlog::info(', ');']],
      send: [['std::string reply = prompt(', ');'], ['auto answer = prompt(', ');'], ['const std::string input = prompt(', ');'], ['std::string line = read_line(', ');']],
      wrap: [
        'int main(int argc, char* argv[]) {\n    @\n    return 0;\n}',
        'for (const auto& row : rows) {\n    if (row.empty()) continue;\n    @\n}',
        'try {\n    @\n} catch (const std::exception& e) {\n    std::cerr << e.what() << std::endl;\n}',
        'void Session::$f() {\n    std::lock_guard<std::mutex> lock(mutex_);\n    @\n}',
        'if (cache.find(key) == cache.end()) {\n    @\n}',
      ],
      block: [
        'std::vector<std::string> rows;',
        'std::unordered_map<std::string, int> cache;',
        'constexpr int kTimeout = 30;',
        'struct Order {\n    int id;\n    double price;\n    int qty = 1;\n};',
        'template <typename T>\nT $f(const std::vector<T>& items) {\n    T sum{};\n    for (const auto& x : items) sum += x;\n    return sum;\n}',
        'auto it = std::find_if(rows.begin(), rows.end(), [](const auto& r) { return r.empty(); });',
        '// TODO: move this into config\nconst std::string kBaseUrl = "https://api.example.com/v1";',
        'class Cache {\npublic:\n    explicit Cache(size_t size) : size_(size) {}\n\nprivate:\n    size_t size_;\n};',
        '++count;',
      ],
      group: {
        recv: [['const std::vector<std::string> kMessages = {\n    @@\n};', '', ',']],
        send: [['std::vector<std::string> answers = {\n    @@\n};', 'prompt(', '),']],
      },
    },
    csharp: {
      comment: '// ', open: ['File.ReadAllBytes(', ')'], names: PASCAL, indent: '    ', base: '    ',
      hl: { com: C, kw: 'using namespace return if else for foreach while do switch case break continue try catch finally throw new await async yield in is as default when lock', decl: 'public private protected internal static readonly const sealed abstract override virtual class record struct interface enum void var this base null true false get set init', types: 'string int long double decimal float bool char object Task List Dictionary IEnumerable IReadOnlyList Console Exception CancellationToken', extra: [PRE] },
      header: ['using System;', 'using System.Collections.Generic;', 'using System.Linq;', 'using System.Threading.Tasks;', '', 'namespace App;', '', 'public sealed class Program', '{'],
      footer: ['}'],
      recv: [['Console.WriteLine(', ');'], ['Debug.WriteLine(', ');'], ['_logger.LogInformation(', ');'], ['Console.Error.WriteLine(', ');'], ['Trace.TraceInformation(', ');']],
      send: [['var reply = Prompt(', ');'], ['string answer = Prompt(', ').Trim();'], ['var input = Prompt(', ');'], ['string? line = Prompt(', ');'], ['var choice = Prompt(', ').ToLowerInvariant();']],
      wrap: [
        'public static void Main(string[] args)\n{\n    @\n}',
        'private void $f(IEnumerable<string> rows)\n{\n    foreach (var row in rows)\n    {\n        if (string.IsNullOrEmpty(row)) continue;\n        @\n    }\n}',
        'try\n{\n    @\n}\ncatch (InvalidOperationException ex)\n{\n    _logger.LogWarning(ex, "retrying");\n}',
        'if (_cache.TryGetValue(key, out var value))\n{\n    @\n}',
        'public async Task $f(CancellationToken ct)\n{\n    await Task.Delay(100, ct);\n    @\n}',
        'for (var attempt = 0; attempt < 3; attempt++)\n{\n    @\n}',
        'lock (_sync)\n{\n    @\n    _count++;\n}',
      ],
      block: [
        'private int _count;',
        'private readonly Dictionary<string, int> _cache = new();',
        'private readonly object _sync = new();',
        'public record Order(int Id, decimal Price, int Qty = 1);',
        'private const int Timeout = 30;',
        'var total = orders.Sum(o => o.Price * o.Qty);',
        '// TODO: move this into appsettings.json\nprivate static readonly string BaseUrl = "https://api.example.com/v1";',
        'private static IEnumerable<T[]> $f<T>(IReadOnlyList<T> items, int size)\n{\n    for (var i = 0; i < items.Count; i += size)\n        yield return items.Skip(i).Take(size).ToArray();\n}',
        'var rows = items.Where(x => !string.IsNullOrWhiteSpace(x)).Select(x => x.Trim()).ToList();',
        'private static int $f(int n) => n < 2 ? n : $f(n - 1) + $f(n - 2);',
      ],
      group: {
        recv: [['private static readonly string[] Messages =\n{\n    @@\n};', '', ','], ['private static readonly Dictionary<string, string> Responses = new()\n{\n    @@\n};', '["$k"] = ', ',']],
        send: [['var answers = new List<string>\n{\n    @@\n};', 'Prompt(', '),']],
      },
    },
    go: {
      comment: '// ', open: ['os.Open(', ')'], names: CAMEL, indent: '\t',
      hl: { com: C, kw: 'package import return if else for range switch case break continue go defer select default fallthrough goto', decl: 'func var const type struct interface map chan nil true false', types: 'string int int64 float64 bool byte error any context' },
      header: ['package main', '', 'import (', '\t"bufio"', '\t"fmt"', '\t"log"', '\t"os"', ')', ''],
      recv: [['fmt.Println(', ')'], ['log.Println(', ')'], ['fmt.Fprintln(os.Stderr, ', ')'], ['fmt.Printf("%s\\n", ', ')']],
      send: [['reply := prompt(', ')'], ['answer := prompt(', ')'], ['input, _ := readLine(', ')'], ['line := strings.TrimSpace(prompt(', '))'], ['name := prompt(', ')']],
      wrap: [
        'func main() {\n\t@\n}',
        'for attempt := 0; attempt < 3; attempt++ {\n\t@\n\tif attempt > 0 {\n\t\tbreak\n\t}\n}',
        'if err != nil {\n\t@\n\treturn err\n}',
        'func $f(rows []string) int {\n\tfor _, row := range rows {\n\t\tif row == "" {\n\t\t\tcontinue\n\t\t}\n\t\t@\n\t}\n\treturn len(rows)\n}',
        'go func() {\n\t@\n}()',
        'select {\ncase <-ctx.Done():\n\t@\ndefault:\n}',
        'defer func() {\n\t@\n}()',
      ],
      block: [
        'var count int',
        'count++',
        'type Order struct {\n\tID    int\n\tPrice float64\n\tQty   int\n}',
        'cache := make(map[string]int)',
        'const timeout = 30 * time.Second',
        '// TODO: move this into config\nconst baseURL = "https://api.example.com/v1"',
        'func $f(items []int, size int) [][]int {\n\tvar out [][]int\n\tfor i := 0; i < len(items); i += size {\n\t\tend := i + size\n\t\tif end > len(items) {\n\t\t\tend = len(items)\n\t\t}\n\t\tout = append(out, items[i:end])\n\t}\n\treturn out\n}',
        'reader := bufio.NewReader(os.Stdin)',
        'ctx, cancel := context.WithTimeout(context.Background(), timeout)\ndefer cancel()',
        'if err := json.Unmarshal(data, &cfg); err != nil {\n\tlog.Fatal(err)\n}',
      ],
      group: {
        recv: [['messages := []string{\n\t@@\n}', '', ',']],
        send: [['answers := []string{\n\t@@\n}', 'prompt(', '),']],
      },
    },
    rust: {
      comment: '// ', open: ['File::open(', ')?'], names: SNAKE, indent: '    ',
      hl: { com: C, kw: 'use mod return if else for while loop match break continue in as where unsafe async await move', decl: 'fn let mut pub struct enum impl trait const static self Self crate super true false ref dyn', types: 'String str Vec Option Result HashMap Box i32 i64 u32 u64 usize f64 bool io' },
      header: ['use std::collections::HashMap;', 'use std::io::{self, Write};', '', 'const TIMEOUT: u64 = 30;', ''],
      recv: [['println!(', ');'], ['eprintln!(', ');'], ['log::info!(', ');'], ['log::debug!(', ');']],
      send: [['let reply = prompt(', ')?;'], ['let answer = read_line(', ')?;'], ['let input = prompt(', ')?.trim().to_string();'], ['let mut line = prompt(', ')?;'], ['let name = prompt(', ').unwrap_or_default();']],
      wrap: [
        'fn main() -> io::Result<()> {\n    @\n    Ok(())\n}',
        'for attempt in 0..3 {\n    @\n    if attempt > 0 {\n        break;\n    }\n}',
        'if let Some(value) = cache.get(&key) {\n    @\n}',
        'match command.as_str() {\n    "start" => {\n        @\n    }\n    _ => {}\n}',
        'impl Session {\n    pub fn $f(&mut self) {\n        @\n    }\n}',
        'fn $f(rows: &[String]) -> usize {\n    for row in rows {\n        if row.is_empty() {\n            continue;\n        }\n        @\n    }\n    rows.len()\n}',
        'loop {\n    @\n    break;\n}',
      ],
      block: [
        'let mut count = 0;',
        'count += 1;',
        '#[derive(Debug, Clone)]\nstruct Order {\n    id: u32,\n    price: f64,\n    qty: u32,\n}',
        'let mut cache: HashMap<String, u32> = HashMap::new();',
        '// TODO: move this into config\nconst BASE_URL: &str = "https://api.example.com/v1";',
        'fn $f(items: &[i32]) -> i32 {\n    items.iter().filter(|x| **x > 0).sum()\n}',
        'let total: f64 = orders.iter().map(|o| o.price * o.qty as f64).sum();',
        'io::stdout().flush()?;',
        'let rows: Vec<&str> = text.lines().filter(|l| !l.is_empty()).collect();',
        'enum State {\n    Idle,\n    Running,\n    Done,\n}',
      ],
      group: {
        recv: [['let messages = [\n    @@\n];', '', ',']],
        send: [['let answers = vec![\n    @@\n];', 'prompt(', ')?,']],
      },
    },
    kotlin: {
      comment: '// ', open: ['File(', ').readBytes()'], names: CAMEL, indent: '    ', quote: dollar(dq),
      hl: { com: C, kw: 'package import return if else for while do when break continue try catch finally throw in is as by repeat', decl: 'fun val var class data object interface enum sealed companion private public internal protected override open abstract suspend const lateinit init this null true false', types: 'String Int Long Double Boolean Unit List Map Set MutableList Any', extra: [AT] },
      header: ['package app', '', 'import java.io.File', 'import kotlinx.coroutines.*', ''],
      recv: [['println(', ')'], ['print(', ')'], ['System.err.println(', ')'], ['logger.info(', ')']],
      send: [['val reply = prompt(', ')'], ['val answer = prompt(', ').trim()'], ['var input = prompt(', ')'], ['val name = prompt(', ').orEmpty()'], ['val choice = prompt(', ').lowercase()']],
      wrap: [
        'fun main() {\n    @\n}',
        'fun $f(rows: List<String>): Int {\n    for (row in rows) {\n        if (row.isBlank()) continue\n        @\n    }\n    return rows.size\n}',
        'repeat(3) { attempt ->\n    @\n    if (attempt > 0) return@repeat\n}',
        'try {\n    @\n} catch (e: IllegalStateException) {\n    System.err.println("retrying: ${e.message}")\n}',
        'when (command) {\n    "start" -> {\n        @\n    }\n    else -> Unit\n}',
        'suspend fun $f(scope: CoroutineScope) = scope.launch {\n    delay(100)\n    @\n}',
        'class Session(private val user: User) {\n    init {\n        @\n    }\n}',
      ],
      block: [
        'private var count = 0',
        'data class Order(val id: Long, val price: Double, val qty: Int = 1)',
        'val cache = mutableMapOf<String, Int>()',
        'private const val TIMEOUT = 30',
        'val total = orders.sumOf { it.price * it.qty }',
        'fun $f(items: List<Int>) = items.filter { it > 0 }.sum()',
        '// TODO: move this into config\nprivate const val BASE_URL = "https://api.example.com/v1"',
        'enum class State { IDLE, RUNNING, DONE }',
        'val rows = lines.map(String::trim).filter(String::isNotEmpty)',
      ],
      group: {
        recv: [['val messages = listOf(\n    @@\n)', '', ','], ['val responses = mapOf(\n    @@\n)', '"$k" to ', ',']],
        send: [['val answers = listOf(\n    @@\n)', 'prompt(', '),']],
      },
    },
    swift: {
      comment: '// ', open: ['UIImage(named: ', ')'], names: CAMEL, indent: '    ',
      hl: { com: C, kw: 'import return if else guard for in while repeat switch case default break continue do try catch throw throws await async defer where', decl: 'func let var struct class enum protocol extension init self Self nil true false private public internal fileprivate static override mutating some any', types: 'String Int Double Bool Array Dictionary Set Optional Void Error Data URL Date Task', extra: [AT] },
      header: ['import Foundation', 'import os', '', 'private let logger = Logger(subsystem: "app", category: "chat")', ''],
      recv: [['print(', ')'], ['debugPrint(', ')'], ['logger.info(', ')'], ['NSLog(', ')'], ['print(', ', terminator: "\\n")']],
      send: [['let reply = prompt(', ')'], ['let answer = prompt(', ') ?? ""'], ['var input = prompt(', ')'], ['let name = prompt(', ')?.trimmingCharacters(in: .whitespaces)']],
      wrap: [
        'func $f(_ rows: [String]) -> Int {\n    for row in rows where !row.isEmpty {\n        @\n    }\n    return rows.count\n}',
        'guard let value = cache[key] else {\n    @\n    return\n}',
        'do {\n    @\n} catch {\n    logger.error("\\(error.localizedDescription)")\n}',
        'Task {\n    @\n}',
        'DispatchQueue.main.async {\n    @\n}',
        'switch command {\ncase "start":\n    @\ndefault:\n    break\n}',
        'for attempt in 0..<3 {\n    @\n    if attempt > 0 { break }\n}',
      ],
      block: [
        'var count = 0',
        'struct Order: Codable {\n    let id: Int\n    let price: Double\n    var qty = 1\n}',
        'private var cache: [String: Int] = [:]',
        'let total = orders.reduce(0) { $0 + $1.price * Double($1.qty) }',
        'enum State {\n    case idle, running, done\n}',
        'let decoder = JSONDecoder()',
        '// TODO: move this into Info.plist\nlet baseURL = URL(string: "https://api.example.com/v1")!',
        'func $f(_ items: [Int]) -> Int {\n    items.filter { $0 > 0 }.reduce(0, +)\n}',
        'extension String {\n    var trimmed: String { trimmingCharacters(in: .whitespacesAndNewlines) }\n}',
      ],
      group: {
        recv: [['let messages = [\n    @@\n]', '', ','], ['let responses: [String: String] = [\n    @@\n]', '"$k": ', ',']],
        send: [['let answers = [\n    @@\n]', 'prompt(', '),']],
      },
    },
    dart: {
      comment: '// ', open: ['File(', ').readAsBytesSync()'], names: CAMEL, indent: '  ', quote: dollar(sq),
      hl: { com: C, kw: 'import export library part return if else for in while do switch case default break continue try catch on finally throw rethrow await async yield new is as', decl: 'void var final const late class extends implements with mixin enum abstract static required this super null true false get set', types: 'String int double num bool dynamic List Map Set Future Stream Object Duration', extra: [AT] },
      header: ["import 'dart:async';", "import 'dart:convert';", "import 'dart:io';", ''],
      recv: [['print(', ');'], ['stdout.writeln(', ');'], ['stderr.writeln(', ');'], ['log.info(', ');']],
      send: [['final reply = prompt(', ');'], ['var answer = prompt(', ').trim();'], ['final input = prompt(', ');'], ["final name = prompt(", ") ?? '';"]],
      wrap: [
        'void main(List<String> args) {\n  @\n}',
        'Future<void> $f(Uri url) async {\n  final res = await client.get(url);\n  @\n}',
        'for (final row in rows) {\n  if (row.isEmpty) continue;\n  @\n}',
        "try {\n  @\n} on FormatException catch (e) {\n  stderr.writeln('retrying: ${e.message}');\n}",
        'class Session {\n  Session(this.user) {\n    @\n  }\n\n  final User user;\n}',
        "if (Platform.environment.containsKey('DEBUG')) {\n  @\n}",
      ],
      block: [
        'var count = 0;',
        'final cache = <String, int>{};',
        "// TODO: move this into config\nconst baseUrl = 'https://api.example.com/v1';",
        'class Order {\n  const Order(this.id, this.price, [this.qty = 1]);\n\n  final int id;\n  final double price;\n  final int qty;\n}',
        'final total = orders.fold<double>(0, (sum, o) => sum + o.price * o.qty);',
        'enum Status { idle, loading, done }',
        'int $f(int n) => n < 2 ? n : $f(n - 1) + $f(n - 2);',
        'final rows = lines.map((l) => l.trim()).where((l) => l.isNotEmpty).toList();',
      ],
      group: {
        recv: [['const messages = [\n  @@\n];', '', ','], ['const responses = {\n  @@\n};', "'$k': ", ',']],
        send: [['final answers = [\n  @@\n];', 'prompt(', '),']],
      },
    },
    'objective-c': {
      comment: '// ', open: ['[NSData dataWithContentsOfFile:', ']'], names: CAMEL, indent: '    ', quote: (s) => '@' + dq(s),
      hl: { com: C, kw: 'return if else for in while do switch case default break continue', decl: 'static const void self super nil YES NO NULL', types: 'NSString NSArray NSDictionary NSMutableArray NSMutableDictionary NSInteger NSUInteger NSNumber BOOL id instancetype NSData NSError', extra: [PRE, ['@\\w+', 'kw']] },
      header: ['#import <Foundation/Foundation.h>', '', '@implementation ChatController', ''],
      footer: ['@end'],
      recv: [['NSLog(', ');'], ['NSLog(@"%@", ', ');'], ['printf("%s\\n", [', ' UTF8String]);']],
      send: [['NSString *reply = [self prompt:', '];'], ['NSString *answer = [[self prompt:', '] stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceCharacterSet];'], ['NSString *input = [self prompt:', '];']],
      wrap: [
        '- (void)$f:(NSArray<NSString *> *)rows {\n    for (NSString *row in rows) {\n        if (row.length == 0) continue;\n        @\n    }\n}',
        'dispatch_async(dispatch_get_main_queue(), ^{\n    @\n});',
        '@try {\n    @\n} @catch (NSException *e) {\n    NSLog(@"%@", e.reason);\n}',
        'if (self.debug) {\n    @\n}',
        '- (void)viewDidLoad {\n    [super viewDidLoad];\n    @\n}',
      ],
      block: [
        'static NSInteger count = 0;',
        'NSMutableDictionary<NSString *, NSNumber *> *cache = [NSMutableDictionary dictionary];',
        '#define TIMEOUT 30',
        '- (NSInteger)$f:(NSInteger)n {\n    return n < 2 ? n : [self $f:n - 1] + [self $f:n - 2];\n}',
        '// TODO: move this into Info.plist\nstatic NSString *const kBaseURL = @"https://api.example.com/v1";',
      ],
      group: { recv: [['NSArray *messages = @[\n    @@\n];', '', ',']] },
    },
    php: {
      first: 1, comment: '// ', open: ['file_get_contents(', ')'], names: CAMEL, indent: '    ', quote: sq,
      hl: { com: ['//', '#', '/*'], kw: 'namespace use return if else elseif foreach for while do switch case default break continue try catch finally throw new match fn yield as instanceof echo print require require_once include', decl: 'function class interface trait enum extends implements public private protected static final abstract readonly const null true false self parent', types: 'string int float bool array mixed void callable iterable object', extra: [SIGIL] },
      header: ['<?php', '', 'declare(strict_types=1);', '', 'namespace App;', '', 'use Psr\\Log\\LoggerInterface;', ''],
      recv: [['echo ', ', PHP_EOL;'], ['print(', ');'], ['$logger->info(', ');'], ['error_log(', ');'], ['fwrite(STDOUT, ', ' . "\\n");']],
      send: [['$reply = readline(', ');'], ['$answer = trim(readline(', '));'], ['$input = readline(', ');'], ["$name = readline(", ") ?: 'guest';"]],
      wrap: [
        'function $f(array $rows): int\n{\n    foreach ($rows as $row) {\n        if (!$row) {\n            continue;\n        }\n        @\n    }\n    return count($rows);\n}',
        'try {\n    @\n} catch (\\Throwable $e) {\n    $logger->warning($e->getMessage());\n}',
        "if (getenv('DEBUG')) {\n    @\n}",
        'foreach ($items as $id => $item) {\n    @\n}',
        'for ($attempt = 0; $attempt < 3; $attempt++) {\n    @\n}',
        "switch ($command) {\n    case 'start':\n        @\n        break;\n    default:\n        break;\n}",
      ],
      block: [
        '$count = 0;',
        '$count++;',
        '$rows = array_filter($items);',
        "$config = json_decode(file_get_contents(__DIR__ . '/config.json'), true);",
        'final class Order\n{\n    public function __construct(\n        public readonly int $id,\n        public readonly float $price,\n        public readonly int $qty = 1,\n    ) {}\n}',
        'const TIMEOUT = 30;',
        "// TODO: move this into .env\nconst BASE_URL = 'https://api.example.com/v1';",
        '$total = array_sum(array_map(fn ($o) => $o->price * $o->qty, $orders));',
        'function $f(string $text): array\n{\n    return array_count_values(str_word_count(strtolower($text), 1));\n}',
      ],
      group: {
        recv: [['$messages = [\n    @@\n];', '', ','], ['$responses = [\n    @@\n];', "'$k' => ", ',']],
        send: [['$answers = [\n    @@\n];', 'readline(', '),']],
      },
    },
    ruby: {
      comment: '# ', open: ['File.read(', ')'], names: SNAKE, indent: '  ',
      hl: { kw: 'require require_relative return if elsif else unless case when while until for in do end begin rescue ensure raise yield break next then and or not', decl: 'def class module self nil true false attr_reader attr_accessor private protected public', types: 'String Integer Hash Array Struct JSON File Logger', extra: [['@\\w+', 'key']] },
      header: ["require 'json'", "require 'logger'", '', 'LOGGER = Logger.new($stdout)', ''],
      recv: [['puts ', ''], ['LOGGER.info ', ''], ['warn ', ''], ['$stdout.puts ', ''], ['print ', ', "\\n"']],
      send: [['reply = ask(', ')'], ['answer = ask(', ').strip'], ['input = prompt(', ')'], ['choice = ask(', ').downcase'], ['name = prompt(', ').chomp']],
      wrap: [
        'def $f(rows)\n  rows.each do |row|\n    next if row.nil?\n\n    @\n  end\nend',
        'begin\n  @\nrescue StandardError => e\n  LOGGER.warn(e.message)\nend',
        "if ENV['DEBUG']\n  @\nend",
        '3.times do |attempt|\n  @\n  break if attempt.positive?\nend',
        'class Session\n  def initialize(user)\n    @user = user\n    @\n  end\nend',
        "case command\nwhen 'start'\n  @\nelse\n  nil\nend",
        'items.each_with_index do |item, i|\n  @\nend',
      ],
      block: [
        'count += 1',
        'rows = items.compact.map(&:strip)',
        "CONFIG = JSON.parse(File.read('config.json'))",
        'Order = Struct.new(:id, :price, :qty)',
        'def $f(a, b)\n  a.merge(b) { |_key, old, new| new || old }\nend',
        'total = orders.sum { |o| o.price * o.qty }',
        "# TODO: move this into config/settings.yml\nBASE_URL = 'https://api.example.com/v1'",
        'TIMEOUT = 30',
        'def $f(text)\n  text.split.tally.sort_by { |_, n| -n }\nend',
      ],
      group: {
        recv: [['MESSAGES = [\n  @@\n].freeze', '', ','], ['RESPONSES = {\n  @@\n}.freeze', '$k: ', ',']],
        send: [['answers = [\n  @@\n]', 'ask(', '),']],
      },
    },
    scala: {
      comment: '// ', open: ['Source.fromFile(', ').mkString'], names: CAMEL, indent: '  ', base: '  ',
      hl: { com: C, kw: 'package import return if else then for yield while do match case try catch finally throw new extends with given using', decl: 'def val var lazy object class trait enum sealed private protected override implicit final this null true false', types: 'String Int Long Double Boolean Unit List Map Set Option Future Seq Array', extra: [AT] },
      header: ['package app', '', 'import scala.io.{Source, StdIn}', 'import scala.util.Try', '', 'object Main:'],
      recv: [['println(', ')'], ['Console.err.println(', ')'], ['logger.info(', ')'], ['print(', ' + "\\n")']],
      send: [['val reply = StdIn.readLine(', ')'], ['val answer = StdIn.readLine(', ').trim'], ['var input = StdIn.readLine(', ')']],
      wrap: [
        'def main(args: Array[String]): Unit =\n  @',
        'def $f(rows: List[String]): Int =\n  for row <- rows if row.nonEmpty do\n    @\n  rows.size',
        'Try {\n  @\n}.recover { case e: Exception => Console.err.println(e.getMessage) }',
        'command match\n  case "start" =>\n    @\n  case _ => ()',
        'if sys.env.contains("DEBUG") then\n  @',
      ],
      block: [
        'private var count = 0',
        'final case class Order(id: Long, price: Double, qty: Int = 1)',
        'private val cache = collection.mutable.Map.empty[String, Int]',
        'val total = orders.map(o => o.price * o.qty).sum',
        'def $f(items: List[Int]): Int = items.filter(_ > 0).sum',
        '// TODO: move this into application.conf\nval BaseUrl = "https://api.example.com/v1"',
        'enum State:\n  case Idle, Running, Done',
      ],
      group: {
        recv: [['val messages = List(\n  @@\n)', '', ',']],
        send: [['val answers = List(\n  @@\n)', 'StdIn.readLine(', '),']],
      },
    },
    groovy: {
      // a Jenkinsfile: the usual home of Groovy
      comment: '// ', open: ['readFile(', ')'], names: CAMEL, indent: '    ', base: '                ', quote: sq,
      hl: { com: C, kw: 'pipeline agent stages stage steps post always success failure environment options when script def return if else for in try catch finally', decl: 'true false null', types: 'String Map List' },
      header: ['pipeline {', '    agent any', '', '    options {', "        timeout(time: 20, unit: 'MINUTES')", '    }', '', '    stages {', "        stage('Build') {", '            steps {'],
      footer: ['            }', '        }', '    }', '}'],
      recv: [['echo ', ''], ['println ', ''], ['echo ', '.trim()']],
      send: [['def reply = input message: ', ''], ['def answer = input(message: ', ')']],
      wrap: [
        'script {\n    @\n}',
        "dir('backend') {\n    @\n}",
        "withEnv(['CI=true']) {\n    @\n}",
        'retry(3) {\n    @\n}',
        "timeout(time: 5, unit: 'MINUTES') {\n    @\n}",
      ],
      block: ["sh 'npm ci'", "sh './gradlew build --no-daemon'", "archiveArtifacts artifacts: 'build/libs/*.jar', fingerprint: true", "junit 'build/test-results/**/*.xml'", 'checkout scm', 'sh "docker build -t app:${BUILD_NUMBER} ."', "// TODO: move this into a shared library\nsh 'make lint'"],
    },
    lua: {
      comment: '-- ', open: ['io.open(', '):read("a")'], names: SNAKE, indent: '  ',
      hl: { kw: 'return if then elseif else end for in do while repeat until break goto and or not', decl: 'local function nil true false self', types: 'string table math io os coroutine' },
      header: ['local json = require("cjson")', 'local log = require("log")', '', 'local M = {}', ''],
      footer: ['return M'],
      recv: [['print(', ')'], ['log.info(', ')'], ['io.write(', ', "\\n")'], ['log.debug(', ')']],
      send: [['local reply = prompt(', ')'], ['local answer = prompt(', '):lower()'], ['local input = ask(', ')'], ['local name = prompt(', ') or "guest"']],
      wrap: [
        'local function $f(rows)\n  for _, row in ipairs(rows) do\n    if row ~= "" then\n      @\n    end\n  end\n  return #rows\nend',
        'if os.getenv("DEBUG") then\n  @\nend',
        'for attempt = 1, 3 do\n  @\nend',
        'local ok, err = pcall(function()\n  @\nend)',
        'function M.$f(self)\n  @\nend',
        'while not done do\n  @\n  done = true\nend',
      ],
      block: [
        'local count = 0',
        'count = count + 1',
        'local cache = {}',
        'local TIMEOUT = 30',
        'local function $f(t)\n  local out = {}\n  for k, v in pairs(t) do\n    out[k] = v\n  end\n  return out\nend',
        '-- TODO: move this into config.lua\nlocal BASE_URL = "https://api.example.com/v1"',
        'local total = 0\nfor _, o in ipairs(orders) do\n  total = total + o.price * o.qty\nend',
      ],
      group: {
        recv: [['local messages = {\n  @@\n}', '', ',']],
        send: [['local answers = {\n  @@\n}', 'prompt(', '),']],
      },
    },
    perl: {
      first: 1, comment: '# ', open: ['path(', ')->slurp_raw'], names: SNAKE, indent: '    ', quote: sq,
      hl: { kw: 'use require return if elsif else unless for foreach while until last next redo my our local sub package die eval do and or not', decl: 'print say printf chomp shift push pop keys values defined undef', types: '', extra: [['[$@%]\\{?\\w+\\}?', 'key']] },
      header: ['#!/usr/bin/env perl', 'use strict;', 'use warnings;', 'use feature qw(say);', 'use JSON::PP;', ''],
      recv: [['say ', ';'], ['print ', ', "\\n";'], ['warn ', ', "\\n";'], ['printf "%s\\n", ', ';']],
      send: [['my $reply = prompt(', ');'], ['chomp(my $answer = prompt(', '));'], ['my $input = prompt(', ');'], ['my $name = prompt(', ") // 'guest';"]],
      wrap: [
        'sub $f {\n    my ($rows) = @_;\n    for my $row (@$rows) {\n        next unless $row;\n        @\n    }\n    return scalar @$rows;\n}',
        'if ($ENV{DEBUG}) {\n    @\n}',
        'for my $attempt (1 .. 3) {\n    @\n}',
        'eval {\n    @\n    1;\n} or do {\n    warn "retrying: $@";\n};',
        'while (my $line = <STDIN>) {\n    chomp $line;\n    @\n}',
      ],
      block: [
        'my $count = 0;',
        '$count++;',
        'my %cache;',
        'use constant TIMEOUT => 30;',
        'my @rows = grep { defined && length } @items;',
        "my $config = decode_json(do { local $/; open my $in, '<', 'config.json' or die $!; <$in> });",
        "# TODO: move this into config\nmy $base_url = 'https://api.example.com/v1';",
        'my %seen;\nmy @unique = grep { !$seen{$_}++ } @names;',
      ],
      group: {
        recv: [['my @messages = (\n    @@\n);', '', ','], ['my %responses = (\n    @@\n);', '$k => ', ',']],
        send: [['my @answers = (\n    @@\n);', 'prompt(', '),']],
      },
    },
    r: {
      comment: '# ', open: ['readBin(', ', "raw", 1e6)'], names: SNAKE, indent: '  ',
      hl: { kw: 'if else for while repeat in next break return function library require', decl: 'TRUE FALSE NULL NA Inf NaN', types: '' },
      header: ['library(jsonlite)', 'library(dplyr)', '', 'options(stringsAsFactors = FALSE)', ''],
      recv: [['print(', ')'], ['message(', ')'], ['cat(', ', "\\n")'], ['writeLines(', ')']],
      send: [['reply <- readline(', ')'], ['answer <- trimws(readline(', '))'], ['input <- readline(prompt = ', ')'], ['choice <- tolower(readline(', '))']],
      wrap: [
        '$f <- function(rows) {\n  for (row in rows) {\n    if (is.na(row)) next\n    @\n  }\n  length(rows)\n}',
        'if (interactive()) {\n  @\n}',
        'tryCatch({\n  @\n}, error = function(e) {\n  warning(conditionMessage(e))\n})',
        'for (i in seq_len(3)) {\n  @\n}',
      ],
      block: [
        'count <- 0',
        'count <- count + 1',
        'df <- read.csv("data/events.csv")',
        'summary <- df %>%\n  group_by(user) %>%\n  summarise(total = sum(amount), .groups = "drop")',
        'config <- fromJSON("config.json")',
        '# TODO: move this into config.yml\nbase_url <- "https://api.example.com/v1"',
        '$f <- function(x) {\n  (x - mean(x)) / sd(x)\n}',
      ],
      group: {
        recv: [['messages <- c(\n  @@\n)', '', ',']],
        send: [['answers <- c(\n  @@\n)', 'readline(', '),']],
      },
    },
    julia: {
      comment: '# ', open: ['read(', ')'], names: SNAKE, indent: '    ', quote: dollar(dq),
      hl: { kw: 'using import export return if elseif else for in while do begin let try catch finally end break continue', decl: 'function struct mutable module const global local true false nothing', types: 'Int Float64 String Bool Vector Dict Any Nothing Symbol', extra: [AT] },
      header: ['using JSON', 'using Logging', ''],
      recv: [['println(', ')'], ['@info ', ''], ['print(', ', "\\n")'], ['@debug ', '']],
      send: [['reply = prompt(', ')'], ['answer = strip(prompt(', '))'], ['input = prompt(', ')'], ['name = something(prompt(', '), "guest")']],
      wrap: [
        'function $f(rows)\n    for row in rows\n        isempty(row) && continue\n        @\n    end\n    return length(rows)\nend',
        'if haskey(ENV, "DEBUG")\n    @\nend',
        'for attempt in 1:3\n    @\nend',
        'try\n    @\ncatch err\n    @warn "retrying" exception = err\nend',
        'let cache = Dict{String,Int}()\n    @\nend',
      ],
      block: [
        'count = 0',
        'count += 1',
        'const TIMEOUT = 30',
        'struct Order\n    id::Int\n    price::Float64\n    qty::Int\nend',
        'total = sum(o.price * o.qty for o in orders)',
        '$f(n) = n < 2 ? n : $f(n - 1) + $f(n - 2)',
        '# TODO: move this into config.toml\nconst BASE_URL = "https://api.example.com/v1"',
      ],
      group: {
        recv: [['messages = [\n    @@\n]', '', ',']],
        send: [['answers = [\n    @@\n]', 'prompt(', '),']],
      },
    },
    shellscript: {
      first: 1, comment: '# ', open: ['"$(cat ', ')"'], names: SNAKE, indent: '  ', quote: shell,
      hl: { kw: 'if then else elif fi for in do done while until case esac return exit break continue function local export readonly set unset shift trap source', decl: 'echo printf read cd test true false', types: '', extra: [SIGIL] },
      header: ['#!/usr/bin/env bash', 'set -euo pipefail', '', 'readonly LOG_FILE="${LOG_FILE:-/tmp/app.log}"', ''],
      recv: [['echo ', ''], ["printf '%s\\n' ", ''], ['echo ', ' >&2'], ['logger -t app ', ''], ['echo ', ' | tee -a "$LOG_FILE"']],
      send: [['read -r -p ', ' reply'], ['read -rp ', ' answer'], ['read -r -p ', ' choice'], ['read -r -p ', ' name']],
      wrap: [
        'if [[ -n "${DEBUG:-}" ]]; then\n  @\nfi',
        'for attempt in 1 2 3; do\n  @\n  break\ndone',
        '$f() {\n  local dir="$1"\n  @\n}',
        'while read -r line; do\n  @\ndone < "$INPUT"',
        'case "${1:-}" in\n  start)\n    @\n    ;;\n  *)\n    ;;\nesac',
        'if ! command -v jq >/dev/null 2>&1; then\n  @\n  exit 1\nfi',
      ],
      block: [
        'cd "$(dirname "$0")"',
        'export PATH="$HOME/.local/bin:$PATH"',
        'mkdir -p "$OUT_DIR"',
        'count=$((count + 1))',
        'logs=$(find . -name "*.log" -mtime +7)',
        'TMP=$(mktemp -d)\ntrap \'rm -rf "$TMP"\' EXIT',
        '$f() {\n  curl -fsSL "$1" -o "$2"\n}',
        '# TODO: move this into .env\nBASE_URL="https://api.example.com/v1"',
      ],
      group: { recv: [['messages=(\n  @@\n)', '', '']] },
    },
    powershell: {
      comment: '# ', open: ['(Get-Content -AsByteStream ', ')'], names: VERBS, indent: '    ', quote: doubled("'"),
      hl: { ci: true, kw: 'function param begin process end if elseif else foreach for while do switch return break continue try catch finally throw trap in', decl: 'true false null', types: 'string int bool hashtable array', extra: [SIGIL, ['\\b[A-Z][a-z]+-[A-Z]\\w+', 'fn']] },
      header: ['#Requires -Version 7', 'Set-StrictMode -Version Latest', "$ErrorActionPreference = 'Stop'", ''],
      recv: [['Write-Host ', ''], ['Write-Output ', ''], ['Write-Verbose ', ''], ['Write-Information ', ''], ['Write-Host ', ' -ForegroundColor Cyan']],
      send: [['$reply = Read-Host ', ''], ['$answer = Read-Host -Prompt ', ''], ['$choice = (Read-Host ', ').ToLower()'], ['$name = Read-Host ', '']],
      wrap: [
        'function $f {\n    param([string]$Path)\n    @\n}',
        'foreach ($item in $items) {\n    @\n}',
        'try {\n    @\n} catch {\n    Write-Warning $_.Exception.Message\n}',
        'if ($env:DEBUG) {\n    @\n}',
        'for ($attempt = 0; $attempt -lt 3; $attempt++) {\n    @\n}',
        "switch ($command) {\n    'start' {\n        @\n    }\n    default {}\n}",
      ],
      block: [
        '$items = Get-ChildItem -Path $PSScriptRoot -Filter *.json',
        '$config = Get-Content ./config.json -Raw | ConvertFrom-Json',
        '$count++',
        'Import-Module ./Helpers.psm1',
        "$headers = @{\n    'Content-Type' = 'application/json'\n    Authorization  = \"Bearer $token\"\n}",
        '$rows = $items | Where-Object { $_.Length -gt 0 } | Select-Object -First 10',
        "# TODO: move this into settings.psd1\n$BaseUrl = 'https://api.example.com/v1'",
        'function $f([int]$n) {\n    if ($n -lt 2) { return $n }\n    return ($f ($n - 1)) + ($f ($n - 2))\n}',
      ],
      group: { recv: [['$messages = @(\n    @@\n)', '', '']] },
    },
    bat: {
      first: 1, comment: 'REM ', open: ['%~dp0', ''], names: SNAKE, indent: '    ', quote: bare,
      hl: { com: ['REM', '::'], ci: true, kw: 'if else goto call exit for in do not exist defined errorlevel setlocal endlocal shift', decl: 'echo set pause cls cd pushd popd start', types: '', extra: [['%%?~?\\w+%?', 'key']] },
      header: ['@echo off', 'setlocal enabledelayedexpansion', 'cd /d "%~dp0"', ''],
      recv: [['echo ', ''], ['echo [info] ', ''], ['echo ', ' >> "%LOG%"'], ['echo ', ' 1>&2']],
      send: [['set /p reply=', ''], ['set /p answer=', ''], ['set /p choice=', ''], ['set /p name=', '']],
      wrap: [
        'if "%~1"=="" (\n    @\n)',
        'for %%i in (*.log) do (\n    @\n)',
        ':$f\n@\ngoto :eof',
        'if exist "%CONFIG%" (\n    @\n) else (\n    echo missing config\n)',
        'if errorlevel 1 (\n    @\n    exit /b 1\n)',
      ],
      block: [
        'set COUNT=0',
        'set /a COUNT+=1',
        'set "LOG=%TEMP%\\app.log"',
        'if not exist "%OUT%" mkdir "%OUT%"',
        'call :cleanup',
        "for /f \"tokens=*\" %%i in ('git rev-parse --short HEAD') do set REV=%%i",
        'REM TODO: move this into config.ini\nset "BASE_URL=https://api.example.com/v1"',
        'timeout /t 2 /nobreak >nul',
      ],
    },
    sql: {
      comment: '-- ', open: ['OPENROWSET(BULK ', ', SINGLE_BLOB)'], names: SNAKE, indent: '    ', quote: doubled("'"),
      hl: { ci: true, kw: 'select from where and or not in is null as join left right inner outer on group by order having top insert into values update set delete create alter drop table index view procedure function begin end if else exists declare return go with case when then union all distinct print exec commit rollback transaction try catch while nocount', decl: 'int bigint varchar nvarchar text datetime2 bit decimal primary key foreign references default identity unique max', types: '', extra: [['@\\w+', 'key']] },
      header: ['SET NOCOUNT ON;', 'GO', ''],
      recv: [['SELECT ', ';'], ['SELECT ', ' AS message;'], ['PRINT ', ';'], ['RAISERROR(', ', 0, 1) WITH NOWAIT;']],
      send: [['INSERT INTO replies (body) VALUES (', ');'], ['UPDATE drafts SET body = ', ' WHERE id = @id;'], ['DECLARE @reply NVARCHAR(MAX) = ', ';'], ['EXEC dbo.send_reply @body = ', ';']],
      wrap: [
        'BEGIN TRANSACTION;\n@\nCOMMIT TRANSACTION;',
        'IF EXISTS (SELECT 1 FROM users WHERE id = @id)\nBEGIN\n    @\nEND',
        'CREATE OR ALTER PROCEDURE dbo.$f\n    @id INT\nAS\nBEGIN\n    SET NOCOUNT ON;\n    @\nEND;\nGO',
        'BEGIN TRY\n    @\nEND TRY\nBEGIN CATCH\n    PRINT ERROR_MESSAGE();\nEND CATCH',
        'WHILE @attempt < 3\nBEGIN\n    @\n    SET @attempt += 1;\nEND',
      ],
      block: [
        'CREATE TABLE replies (\n    id INT IDENTITY PRIMARY KEY,\n    body NVARCHAR(MAX) NOT NULL,\n    created_at DATETIME2 DEFAULT SYSUTCDATETIME()\n);',
        'SELECT u.id, u.name, COUNT(o.id) AS orders\nFROM users u\nLEFT JOIN orders o ON o.user_id = u.id\nGROUP BY u.id, u.name;',
        'CREATE INDEX ix_orders_user_id ON orders (user_id);',
        'DECLARE @attempt INT = 0;',
        'UPDATE users SET last_seen = SYSUTCDATETIME() WHERE id = @id;',
        'DELETE FROM sessions WHERE expires_at < SYSUTCDATETIME();',
        '-- TODO: move this into a view\nSELECT TOP 10 * FROM events ORDER BY created_at DESC;',
        'WITH recent AS (\n    SELECT * FROM events WHERE created_at > DATEADD(day, -7, SYSUTCDATETIME())\n)\nSELECT type, COUNT(*) AS n FROM recent GROUP BY type;',
      ],
      group: { recv: [['INSERT INTO messages (body) VALUES\n    @@\n;', '(', '),']] },
    },
    html: {
      first: 1, comment: '<!-- ', commentEnd: ' -->', open: ['<img src="', '" alt="">'], names: KEBAB, indent: '  ', base: '    ', quote: markup,
      hl: { mode: 'markup' },
      header: ['<!DOCTYPE html>', '<html lang="en">', '<head>', '  <meta charset="UTF-8">', '  <meta name="viewport" content="width=device-width, initial-scale=1.0">', '  <title>Dashboard</title>', '  <link rel="stylesheet" href="/static/style.css">', '</head>', '<body>', '  <main class="container">'],
      footer: ['  </main>', '  <script src="/static/app.js" defer></script>', '</body>', '</html>'],
      recv: [['<p>', '</p>'], ['<span class="message">', '</span>'], ['<li>', '</li>'], ['<div class="toast">', '</div>'], ['<p class="muted">', '</p>'], ['<h3>', '</h3>']],
      send: [['<textarea name="reply">', '</textarea>'], ['<button type="submit">', '</button>'], ['<label for="reply">', '</label>'], ['<option selected>', '</option>']],
      wrap: [
        '<section class="card">\n  @\n</section>',
        '<form method="post" action="/api/reply">\n  @\n  <button type="submit">Send</button>\n</form>',
        '<div class="row">\n  <div class="col">\n    @\n  </div>\n</div>',
        '<template id="$f">\n  @\n</template>',
        '<article>\n  <header>\n    <h2>Update</h2>\n  </header>\n  @\n</article>',
        '<details>\n  <summary>More</summary>\n  @\n</details>',
      ],
      block: [
        '<img src="/static/logo.svg" alt="logo" width="32" height="32">',
        '<nav class="navbar">\n  <a href="/">Home</a>\n  <a href="/settings">Settings</a>\n</nav>',
        '<hr>',
        '<input type="search" id="q" placeholder="Search" autocomplete="off">',
        '<table>\n  <tr><th>Name</th><th>Status</th></tr>\n  <tr><td>api</td><td>ok</td></tr>\n</table>',
        '<div class="spinner" hidden></div>',
        '<!-- TODO: move this into a component -->\n<footer class="footer">v1.4.2</footer>',
      ],
      group: {
        recv: [['<ul class="messages">\n  @@\n</ul>', '<li>', '</li>']],
        send: [['<select name="reply">\n  @@\n</select>', '<option>', '</option>']],
      },
    },
    vue: {
      comment: '<!-- ', commentEnd: ' -->', open: ['<img src="', '" alt="">'], names: KEBAB, indent: '  ', base: '    ', quote: markup,
      hl: { mode: 'markup' },
      header: ['<script setup lang="ts">', "import { ref } from 'vue'", '', "const draft = ref('')", 'const loaded = ref(true)', '</script>', '', '<template>', '  <div class="chat">'],
      footer: ['  </div>', '</template>', '', '<style scoped>', '.chat {', '  padding: 8px;', '}', '</style>'],
      recv: [['<p>', '</p>'], ['<span class="message">', '</span>'], ['<li>', '</li>'], ['<p class="muted">', '</p>']],
      send: [['<textarea v-model="draft">', '</textarea>'], ['<button @click="send">', '</button>'], ['<label for="reply">', '</label>']],
      wrap: ['<div v-if="loaded">\n  @\n</div>', '<template v-for="item in items" :key="item.id">\n  @\n</template>', '<section class="card">\n  @\n</section>', '<Transition name="fade">\n  @\n</Transition>'],
      block: ['<img :src="avatar" alt="" width="32" height="32">', '<hr>', '<RouterLink to="/settings">Settings</RouterLink>', '<BaseSpinner v-if="loading" />', '<!-- TODO: move this into its own component -->\n<footer class="footer">v1.4.2</footer>'],
      group: { recv: [['<ul class="messages">\n  @@\n</ul>', '<li>', '</li>']] },
    },
    svelte: {
      comment: '<!-- ', commentEnd: ' -->', open: ['<img src="', '" alt="" />'], names: KEBAB, indent: '  ', quote: markup,
      hl: { mode: 'markup' },
      header: ['<script lang="ts">', "  let draft = $state('');", '  let loaded = $state(true);', '</script>', ''],
      footer: ['<style>', '  .card {', '    padding: 8px;', '  }', '</style>'],
      recv: [['<p>', '</p>'], ['<span class="message">', '</span>'], ['<li>', '</li>'], ['<p class="muted">', '</p>']],
      send: [['<textarea bind:value={draft}>', '</textarea>'], ['<button onclick={send}>', '</button>'], ['<label for="reply">', '</label>']],
      wrap: ['{#if loaded}\n  @\n{/if}', '{#each items as item (item.id)}\n  @\n{/each}', '<section class="card">\n  @\n</section>', '{#await promise}\n  <p>loading</p>\n{:then}\n  @\n{/await}'],
      block: ['<img src={avatar} alt="" width="32" height="32" />', '<hr />', '<a href="/settings">Settings</a>', '<Spinner />', '<!-- TODO: move this into its own component -->\n<footer class="footer">v1.4.2</footer>'],
      group: { recv: [['<ul class="messages">\n  @@\n</ul>', '<li>', '</li>']] },
    },
    jade: {
      comment: '//- ', open: ['img(src="', '")'], names: KEBAB, indent: '  ', base: '      ', quote: bare,
      hl: { com: ['//'], kw: 'if else unless each in case when mixin include extends block append prepend', decl: 'doctype html head body title meta link script style div span p a ul ol li img input button form label textarea select option section header footer nav main article details summary h1 h2 h3 hr br table tr td th', types: '' },
      header: ['doctype html', 'html(lang="en")', '  head', '    title Dashboard', '    link(rel="stylesheet" href="/static/style.css")', '  body', '    main.container'],
      recv: [['p ', ''], ['span.message ', ''], ['li ', ''], ['p.muted ', '']],
      send: [['textarea#reply ', ''], ['button(type="submit") ', ''], ['label(for="reply") ', '']],
      wrap: ['.card\n  @', 'if user\n  @', 'each item in items\n  @', 'section.panel\n  h2 Update\n  @'],
      block: ['img(src="/static/logo.svg" alt="logo")', 'hr', 'a(href="/settings") Settings', 'nav.navbar\n  a(href="/") Home\n  a(href="/settings") Settings', '//- TODO: move this into a mixin\n+spinner()'],
    },
    xml: {
      first: 1, comment: '<!-- ', commentEnd: ' -->', open: ['<attachment href="', '"/>'], names: KEBAB, indent: '  ', base: '  ', quote: markup,
      hl: { mode: 'markup' },
      header: ['<?xml version="1.0" encoding="UTF-8"?>', '<feed xmlns="http://www.w3.org/2005/Atom">', '  <title>Release notes</title>', '  <updated>2026-11-04T09:00:00Z</updated>'],
      footer: ['</feed>'],
      recv: [['<summary>', '</summary>'], ['<title>', '</title>'], ['<content type="text">', '</content>'], ['<message>', '</message>']],
      send: [['<reply>', '</reply>'], ['<comment>', '</comment>'], ['<note type="draft">', '</note>']],
      wrap: ['<entry>\n  <id>urn:uuid:1225c695-cfb8</id>\n  @\n</entry>', '<item>\n  @\n</item>', '<section name="$f">\n  @\n</section>'],
      block: ['<link rel="alternate" href="https://example.com/"/>', '<author>\n  <name>build-bot</name>\n</author>', '<category term="release"/>', '<generator uri="https://example.com/" version="2.1">feedgen</generator>', '<!-- TODO: paginate -->\n<link rel="next" href="https://example.com/feed?page=2"/>'],
      group: { recv: [['<items>\n  @@\n</items>', '<item>', '</item>']] },
    },
    css: {
      comment: '/* ', commentEnd: ' */', open: ['url(', ')'], names: KEBAB, indent: '  ',
      hl: { mode: 'css' },
      header: ['@import url("./reset.css");', '', ':root {', '  --accent: #0e639c;', '  --radius: 4px;', '}', ''],
      recv: [['.toast::after { content: ', '; }'], ['.badge::before { content: ', '; }'], ['.message::after { content: ', '; }'], ['.hint::before { content: ', '; }']],
      send: [['.reply::after { content: ', '; }'], ['#draft::before { content: ', '; }'], ['.input:empty::before { content: ', '; }']],
      wrap: ['@media (max-width: 768px) {\n  @\n}', '@supports (display: grid) {\n  @\n}', '.dark {\n  @\n}', '@layer components {\n  @\n}', '@container (min-width: 400px) {\n  @\n}'],
      block: [
        'body {\n  margin: 0;\n  font-family: system-ui, sans-serif;\n}',
        '.container {\n  display: flex;\n  gap: 8px;\n  padding: 16px;\n}',
        '.btn:hover {\n  background: var(--accent);\n}',
        '.card {\n  border-radius: var(--radius);\n  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);\n}',
        '@keyframes fade-in {\n  from { opacity: 0; }\n  to { opacity: 1; }\n}',
        '.sr-only {\n  position: absolute;\n  width: 1px;\n  height: 1px;\n  overflow: hidden;\n}',
        '/* TODO: move this into the theme */\n.header {\n  color: #fff;\n}',
      ],
      group: { recv: [['.feed {\n  @@\n}', '--message-$k: ', ';']] },
    },
    scss: {
      comment: '// ', open: ['url(', ')'], names: KEBAB, indent: '  ',
      hl: { mode: 'css' },
      header: ['@use "sass:math";', '', '$primary: #0e639c;', '$gap: 8px;', ''],
      recv: [['@debug ', ';'], ['.toast::after { content: ', '; }'], ['$message: ', ';'], ['@warn ', ';'], ['.badge::before { content: ', '; }']],
      send: [['$reply: ', ' !default;'], ['$answer: ', ';'], ['.reply::after { content: ', '; }']],
      wrap: [
        '@mixin $f {\n  @\n}',
        '.card {\n  &:hover {\n    @\n  }\n}',
        '@each $name in (light, dark) {\n  @\n}',
        '@if $debug {\n  @\n}',
        '@media (max-width: 768px) {\n  @\n}',
        '@function $f($value) {\n  @\n  @return math.div($value, 16px) * 1rem;\n}',
      ],
      block: [
        '.btn {\n  padding: math.div($gap, 2) $gap;\n\n  &--primary {\n    background: $primary;\n  }\n}',
        '%truncate {\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}',
        '.title {\n  @extend %truncate;\n  font-weight: 600;\n}',
        '$breakpoints: (sm: 576px, md: 768px, lg: 992px);',
        '// TODO: move this into _variables.scss\n$radius: 4px;',
        '.list {\n  > li + li {\n    margin-top: $gap;\n  }\n}',
      ],
      group: { recv: [['$messages: (\n  @@\n);', '', ',']] },
    },
    less: {
      comment: '// ', open: ['url(', ')'], names: KEBAB, indent: '  ',
      hl: { mode: 'css' },
      header: ['@import (reference) "mixins.less";', '', '@primary: #0e639c;', '@gap: 8px;', ''],
      recv: [['.toast::after { content: ', '; }'], ['@message: ', ';'], ['.badge::before { content: ', '; }']],
      send: [['@reply: ', ';'], ['@answer: ', ';']],
      wrap: ['.$f() {\n  @\n}', '.card {\n  &:hover {\n    @\n  }\n}', '@media (max-width: 768px) {\n  @\n}', '.theme(@mode) when (@mode = dark) {\n  @\n}'],
      block: [
        '.btn {\n  .rounded(4px);\n  color: darken(@primary, 10%);\n}',
        '.rounded(@r: 4px) {\n  border-radius: @r;\n}',
        '// TODO: move this into variables.less\n@radius: 4px;',
        '.list {\n  > li + li {\n    margin-top: @gap;\n  }\n}',
      ],
    },
    json: {
      comment: '// ', open: ['{ "file": ', ' }'], names: CAMEL, indent: '  ', base: '    ',
      hl: { mode: 'json' },
      header: ['{', '  "version": 2,', '  "source": "sync",', '  "items": ['],
      footer: ['  ]', '}'],
      recv: [['{ "text": ', ' },'], ['{ "type": "text", "body": ', ' },'], ['{ "message": ', ', "read": true },'], ['{ "level": "info", "msg": ', ' },']],
      send: [['{ "reply": ', ' },'], ['{ "type": "reply", "body": ', ' },'], ['{ "draft": ', ' },']],
      wrap: ['{\n  "id": 1024,\n  "data": [\n    @\n  ]\n},', '{\n  "batch": true,\n  "events": [\n    @\n  ]\n},'],
      block: ['{ "type": "ping", "ts": 1730793600 },', '{ "type": "typing", "user": "system" },', '{ "type": "seen", "count": 3 },', '{ "type": "presence", "online": false },', '{\n  "type": "config",\n  "retries": 3,\n  "timeout": 30\n},'],
      group: { recv: [['{\n  "messages": [\n    @@\n  ]\n},', '', ',']] },
    },
    jsonl: {
      comment: '// ', open: ['{"type":"image","file":', '}'], names: CAMEL, indent: '  ',
      hl: { mode: 'json' },
      recv: [['{"role":"user","content":', '}'], ['{"role":"user","content":', ',"lang":"ko"}']],
      send: [['{"role":"assistant","content":', '}'], ['{"role":"assistant","content":', ',"final":true}']],
      block: ['{"role":"system","content":"You are a helpful assistant."}', '{"role":"tool","content":"{\\"ok\\":true}"}'],
    },
    yaml: {
      // a GitHub Actions workflow
      comment: '# ', open: ['$(cat ', ')'], names: KEBAB, indent: '  ', base: '      ',
      hl: { mode: 'data' },
      header: ['name: CI', '', 'on:', '  push:', '    branches: [main]', '  pull_request:', '', 'jobs:', '  build:', '    runs-on: ubuntu-latest', '    steps:', '      - uses: actions/checkout@v4'],
      recv: [['- run: echo ', ''], ['- name: ', ''], ["- run: printf '%s\\n' ", ''], ['- run: echo ', ' >> "$GITHUB_STEP_SUMMARY"']],
      send: [['- run: read -r -p ', ' REPLY'], ['- run: read -rp ', ' ANSWER']],
      block: [
        '- uses: actions/setup-node@v4\n  with:\n    node-version: 20\n    cache: npm',
        '- run: npm ci',
        '- run: npm test -- --ci',
        "- name: Cache\n  uses: actions/cache@v4\n  with:\n    path: ~/.npm\n    key: ${{ runner.os }}-node-${{ hashFiles('**/package-lock.json') }}",
        '- name: Build\n  run: npm run build\n  env:\n    NODE_ENV: production',
        '- uses: actions/upload-artifact@v4\n  with:\n    name: dist\n    path: dist/',
        '# TODO: split this into a reusable workflow\n- run: ./scripts/deploy.sh --dry-run',
      ],
      group: { recv: [['- run: |\n    @@', 'echo ', '']] },
    },
    toml: {
      comment: '# ', open: ['{ file = ', ' }'], names: SNAKE, indent: '  ',
      hl: { mode: 'data' },
      header: ['[package]', 'name = "chat-sync"', 'version = "0.4.1"', 'edition = "2021"', ''],
      recv: [['description = ', ''], ['message = ', ''], ['summary = ', ''], ['title = ', ''], ['notes = ', '']],
      send: [['reply = ', ''], ['answer = ', ''], ['draft = ', '']],
      wrap: ['[[messages]]\nid = 12\n@', '[tool.chat]\n@', '[profile.release]\nlto = true\n@'],
      block: ['[dependencies]\nserde = { version = "1.0", features = ["derive"] }\ntokio = { version = "1", features = ["full"] }', 'timeout = 30', '[dev-dependencies]\npretty_assertions = "1"', '[features]\ndefault = ["tls"]', '# TODO: pin this\nregion = "ap-northeast-2"', 'retries = 3\nverbose = false'],
      group: { recv: [['messages = [\n  @@\n]', '', ',']] },
    },
    ini: {
      comment: '; ', open: ['file://', ''], names: SNAKE, indent: '  ', quote: bare,
      hl: { mode: 'data' },
      header: ['[general]', 'version=2', 'locale=ko_KR', ''],
      recv: [['message=', ''], ['text=', ''], ['greeting=', ''], ['status=', ''], ['title=', '']],
      send: [['reply=', ''], ['answer=', ''], ['draft=', '']],
      wrap: ['[messages]\n@', '[ui]\ntheme=dark\n@', '[notify]\nenabled=true\n@'],
      block: ['[database]\nhost=localhost\nport=5432', 'timeout=30', 'debug=false', '[paths]\ndata=./data\nlogs=./logs', '; TODO: move this into the server config\nretries=3'],
    },
    properties: {
      comment: '# ', open: ['classpath:', ''], names: SNAKE, indent: '  ', quote: bare,
      hl: { mode: 'data' },
      header: ['spring.application.name=chat-sync', 'server.port=8080', ''],
      recv: [['app.message=', ''], ['app.greeting=', ''], ['ui.title=', ''], ['app.notice=', '']],
      send: [['app.reply=', ''], ['app.answer=', '']],
      block: ['spring.datasource.url=jdbc:postgresql://localhost:5432/app', 'spring.jpa.hibernate.ddl-auto=validate', 'logging.level.root=INFO', 'management.endpoints.web.exposure.include=health,info', '# TODO: move this into the vault\napp.api.timeout=30'],
    },
    dotenv: {
      comment: '# ', open: ['file:', ''], names: SNAKE, indent: '  ',
      hl: { mode: 'data' },
      header: ['NODE_ENV=production', 'PORT=8080', ''],
      recv: [['MESSAGE=', ''], ['GREETING=', ''], ['APP_TITLE=', ''], ['NOTICE=', ''], ['STATUS_TEXT=', '']],
      send: [['REPLY=', ''], ['ANSWER=', ''], ['DRAFT=', '']],
      block: ['DATABASE_URL=postgres://localhost:5432/app', 'LOG_LEVEL=info', 'REDIS_URL=redis://localhost:6379', 'API_TIMEOUT=30', '# TODO: rotate before release\nSESSION_SECRET=change-me'],
    },
    csv: {
      comment: '# ', names: SNAKE, indent: '  ', quote: doubled('"'),
      hl: {},
      header: ['side,text,state'],
      recv: [['in,', ','], ['in,', ',read'], ['recv,', ',']],
      send: [['out,', ','], ['out,', ',sent']],
      block: ['meta,"synced",2026-11-04', 'meta,"cursor",42'],
    },
    markdown: {
      comment: '<!-- ', commentEnd: ' -->', open: ['![](', ')'], names: KEBAB, indent: '  ', quote: bare,
      hl: { mode: 'md' },
      header: ['# Meeting notes', ''],
      recv: [['', ''], ['- ', ''], ['> ', ''], ['* ', '']],
      send: [['- [ ] ', ''], ['- [x] ', ''], ['1. ', '']],
      block: ['## Action items', '---', '| Owner | Status |\n| ----- | ------ |\n| api   | done   |\n| web   | wip    |', '```bash\nnpm run build\n```', '### Follow-ups', '> **Note**\n> Numbers are from the staging dashboard.'],
    },
    restructuredtext: {
      comment: '.. ', open: ['.. image:: ', ''], names: KEBAB, indent: '   ', quote: bare,
      hl: {},
      header: ['Release notes', '=============', ''],
      recv: [['', ''], ['* ', ''], ['- ', '']],
      send: [['#. ', '']],
      wrap: ['.. note::\n\n   @', 'Changes\n-------\n\n@'],
      block: ['Highlights\n----------', '.. code-block:: bash\n\n   make html', '.. _install:', ':ref:`install` covers the details.'],
    },
    latex: {
      comment: '% ', open: ['\\includegraphics[width=\\linewidth]{', '}'], names: KEBAB, indent: '  ', quote: bare,
      hl: { extra: [['\\\\[A-Za-z@]+', 'kw']] },
      header: ['\\documentclass{article}', '\\usepackage{kotex}', '\\usepackage{graphicx}', '', '\\begin{document}', ''],
      footer: ['\\end{document}'],
      recv: [['', ''], ['\\item ', ''], ['\\paragraph{', '}'], ['\\textit{', '}']],
      send: [['\\todo{', '}'], ['\\emph{', '}'], ['\\note{', '}']],
      wrap: ['\\begin{itemize}\n  @\n\\end{itemize}', '\\section{Results}\n@', '\\begin{quote}\n  @\n\\end{quote}', '\\begin{abstract}\n  @\n\\end{abstract}'],
      block: ['\\section{Introduction}', '\\subsection{Method}', '\\begin{equation}\n  E = mc^2\n\\end{equation}', '\\label{sec:intro}', 'As shown in \\cite{knuth1984}, the bound is tight.', '\\begin{figure}[h]\n  \\centering\n  \\includegraphics[width=0.8\\linewidth]{figures/plot.pdf}\n  \\caption{Latency by region}\n\\end{figure}', '% TODO: tighten this section\n\\newpage'],
    },
    fsharp: {
      comment: '// ', open: ['File.ReadAllBytes(', ')'], names: CAMEL, indent: '    ',
      hl: { com: ['//', '(*'], kw: 'open module namespace let rec in if then elif else for to do while match with when try finally raise return yield async task fun function type of', decl: 'mutable member static private public internal true false null', types: 'string int decimal float bool unit list option seq array Async Task' },
      header: ['module App', '', 'open System', 'open System.IO', ''],
      recv: [['printfn "%s" ', ''], ['Console.WriteLine(', ')'], ['eprintfn "%s" ', ''], ['logger.LogInformation(', ')']],
      send: [['let reply = prompt ', ''], ['let answer = (prompt ', ').Trim()'], ['let input = prompt ', '']],
      wrap: [
        'let $f (rows: string list) =\n    for row in rows do\n        if not (String.IsNullOrEmpty row) then\n            @\n    rows.Length',
        '[<EntryPoint>]\nlet main argv =\n    @\n    0',
        'try\n    @\nwith ex ->\n    eprintfn "retrying: %s" ex.Message',
        'match command with\n| "start" ->\n    @\n| _ -> ()',
        'async {\n    @\n} |> Async.RunSynchronously',
      ],
      block: [
        'let mutable count = 0',
        'type Order = { Id: int; Price: decimal; Qty: int }',
        'let cache = Collections.Generic.Dictionary<string, int>()',
        'let total = orders |> List.sumBy (fun o -> o.Price * decimal o.Qty)',
        '[<Literal>]\nlet Timeout = 30',
        'let rec $f n = if n < 2 then n else $f (n - 1) + $f (n - 2)',
        '// TODO: move this into appsettings.json\nlet baseUrl = "https://api.example.com/v1"',
      ],
      group: { recv: [['let messages = [\n    @@\n]', '', '']] },
    },
    haskell: {
      comment: '-- ', open: ['readFile ', ''], names: CAMEL, indent: '  ',
      hl: { kw: 'module where import qualified as hiding let in if then else case of do data type newtype class instance deriving', decl: 'True False Nothing Just', types: 'String Int Integer Double Bool IO Maybe Either Map Text' },
      header: ['module Main where', '', 'import Control.Monad (forM_, unless, when)', 'import qualified Data.Map.Strict as Map', 'import System.IO', ''],
      recv: [['putStrLn ', ''], ['hPutStrLn stderr ', ''], ['print ', ''], ['logInfo ', '']],
      send: [['reply <- prompt ', ''], ['answer <- prompt ', ''], ['input <- prompt ', ''], ['name <- trim <$> prompt ', '']],
      wrap: [
        'main :: IO ()\nmain = do\n  hSetBuffering stdout NoBuffering\n  @',
        '$f :: [String] -> IO ()\n$f rows = forM_ rows $ \\row ->\n  unless (null row) $ do\n    @',
        'when verbose $ do\n  @',
        'case command of\n  "start" -> do\n    @\n  _ -> pure ()',
      ],
      block: [
        'data Order = Order\n  { orderId :: Int\n  , price :: Double\n  , qty :: Int\n  } deriving (Show, Eq)',
        'timeout :: Int\ntimeout = 30',
        '$f :: [Int] -> Int\n$f = sum . filter (> 0)',
        'type Cache = Map.Map String Int',
        '-- TODO: read this from the environment\nbaseUrl :: String\nbaseUrl = "https://api.example.com/v1"',
      ],
    },
    ocaml: {
      comment: '(* ', commentEnd: ' *)', open: ['In_channel.with_open_bin ', ' In_channel.input_all'], names: SNAKE, indent: '  ',
      hl: { com: ['(*'], kw: 'let rec in if then else match with when fun function try begin end for to do done while open module struct sig type of', decl: 'mutable true false ref', types: 'int float string bool unit list option array' },
      header: ['open Printf', ''],
      recv: [['print_endline ', ';'], ['printf "%s\\n" ', ';'], ['prerr_endline ', ';']],
      send: [['let reply = prompt ', ' in'], ['let answer = String.trim (prompt ', ') in']],
      wrap: ['let () =\n  @\n  ()', 'let $f rows =\n  List.iter (fun row ->\n    @\n    ignore row) rows', 'match command with\n| "start" ->\n  @\n  ()\n| _ -> ()', 'try\n  @\n  ()\nwith Not_found -> ()'],
      block: ['let timeout = 30', 'type order = { id : int; price : float; qty : int }', 'let count = ref 0', 'let $f items = List.filter (fun x -> x > 0) items |> List.fold_left ( + ) 0', '(* TODO: read this from the environment *)\nlet base_url = "https://api.example.com/v1"'],
    },
    elixir: {
      comment: '# ', open: ['File.read!(', ')'], names: SNAKE, indent: '  ', base: '  ',
      hl: { kw: 'do end fn if else unless case cond with when for receive after try rescue catch raise import alias require use and or not in', decl: 'def defp defmodule defstruct defmacro defimpl defprotocol nil true false', types: 'String Enum Map List Logger IO File System', extra: [['@\\w+', 'key']] },
      header: ['defmodule App.Chat do', '  require Logger', '', '  @timeout 30_000', ''],
      footer: ['end'],
      recv: [['IO.puts(', ')'], ['Logger.info(', ')'], ['IO.inspect(', ')'], ['Logger.debug(', ')']],
      send: [['reply = IO.gets(', ')'], ['answer = IO.gets(', ') |> String.trim()'], ['input = IO.gets(', ')']],
      wrap: [
        'def $f(rows) do\n  Enum.each(rows, fn row ->\n    @\n  end)\nend',
        'case command do\n  "start" ->\n    @\n\n  _ ->\n    :ok\nend',
        'if System.get_env("DEBUG") do\n  @\nend',
        'with {:ok, body} <- fetch(url) do\n  @\nend',
        'defp $f(state) do\n  @\n  {:noreply, state}\nend',
      ],
      block: [
        'defstruct [:id, :price, qty: 1]',
        'def $f(items), do: Enum.filter(items, &(&1 > 0))',
        'total = Enum.reduce(orders, 0, fn o, acc -> acc + o.price * o.qty end)',
        '# TODO: move this into config/runtime.exs\n@base_url "https://api.example.com/v1"',
        'def handle_info(:tick, state), do: {:noreply, state}',
      ],
      group: { recv: [['@messages [\n  @@\n]', '', ',']] },
    },
    erlang: {
      comment: '% ', open: ['element(2, file:read_file(', '))'], names: SNAKE, indent: '    ',
      hl: { kw: 'case of if when receive after end fun try catch begin', decl: 'module export define record ok error true false', types: 'io lists maps logger string' },
      header: ['-module(chat).', '-export([start/0]).', '', '-define(TIMEOUT, 30000).', ''],
      recv: [['io:format("~ts~n", [', ']),'], ['logger:info(', '),'], ['io:fwrite("~ts~n", [', ']),']],
      send: [['Reply = io:get_line(', '),'], ['Answer = string:trim(io:get_line(', ')),']],
      wrap: [
        'start() ->\n    @\n    ok.',
        '$f(Rows) ->\n    lists:foreach(fun(Row) ->\n        @\n        Row\n    end, Rows).',
        'try\n    @\n    ok\ncatch\n    error:Reason -> logger:warning("~p", [Reason])\nend.',
        'loop(State) ->\n    receive\n        stop -> ok\n    after ?TIMEOUT ->\n        @\n        loop(State)\n    end.',
      ],
      block: ['-record(order, {id, price, qty = 1}).', '$f(Items) ->\n    lists:sum([X || X <- Items, X > 0]).', '%% TODO: move this into sys.config\nbase_url() -> "https://api.example.com/v1".', 'total(Orders) ->\n    lists:foldl(fun(#order{price = P, qty = Q}, Acc) -> Acc + P * Q end, 0, Orders).'],
    },
    clojure: {
      comment: ';; ', open: ['(slurp ', ')'], names: KEBAB, indent: '  ',
      hl: { str: '"(?:\\\\.|[^"\\\\])*"', kw: 'ns require import if when when-not cond case let loop recur do doseq for try catch finally throw fn', decl: 'def defn defn- defrecord defprotocol defmacro nil true false', types: '', call: '(?<=\\()[^\\s()\\[\\]{}"]+' },
      header: ['(ns app.core', '  (:require [clojure.string :as str]', '            [clojure.tools.logging :as log]))', ''],
      recv: [['(println ', ')'], ['(log/info ', ')'], ['(prn ', ')'], ['(log/debug ', ')']],
      send: [['(def reply (prompt ', '))'], ['(def answer (str/trim (prompt ', ')))'], ['(def input (prompt ', '))']],
      wrap: [
        '(defn -main [& args]\n  @\n  (System/exit 0))',
        '(defn $f [rows]\n  (doseq [row rows :when (seq row)]\n    @\n    row))',
        '(when (System/getenv "DEBUG")\n  @\n  nil)',
        '(try\n  @\n  (catch Exception e\n    (log/warn (.getMessage e))))',
      ],
      block: ['(def timeout 30)', '(defrecord Order [id price qty])', '(defn $f [items]\n  (->> items (filter pos?) (reduce +)))', '(def cache (atom {}))', '(swap! cache assoc :seen true)', ';; TODO: move this into config.edn\n(def base-url "https://api.example.com/v1")'],
      group: { recv: [['(def messages\n  [\n   @@\n   ])', '', '']] },
    },
    coffeescript: {
      comment: '# ', open: ['fs.readFileSync(', ')'], names: CAMEL, indent: '  ',
      hl: { kw: 'if else unless then for in of when while until loop switch return break continue try catch finally throw new and or not is isnt await yield', decl: 'class extends this super null undefined true false yes no on off', types: 'Promise JSON Math', extra: [['@\\w+', 'key']] },
      header: ["fs = require 'fs'", "readline = require 'readline/promises'", '', 'rl = readline.createInterface input: process.stdin, output: process.stdout', ''],
      recv: [['console.log ', ''], ['console.info ', ''], ['console.warn ', '']],
      send: [['reply = await rl.question ', ''], ['answer = (await rl.question ', ').trim()'], ['input = await rl.question ', '']],
      wrap: ['$f = (rows) ->\n  for row in rows when row\n    @\n  rows.length', 'if process.env.DEBUG\n  @', 'try\n  @\ncatch err\n  console.warn err.message', 'class Session\n  constructor: (@user) ->\n    @', 'for attempt in [1..3]\n  @'],
      block: ['count = 0', 'count += 1', 'cache = {}', 'TIMEOUT = 30', 'total = orders.reduce ((sum, o) -> sum + o.price * o.qty), 0', '$f = (items) -> (x for x in items when x > 0)', "# TODO: move this into config.cson\nBASE_URL = 'https://api.example.com/v1'"],
      group: { recv: [['messages = [\n  @@\n]', '', '']] },
    },
    zig: {
      comment: '// ', open: ['@embedFile(', ')'], names: CAMEL, indent: '    ',
      hl: { kw: 'const var fn pub return if else for while switch break continue try catch defer errdefer orelse and or comptime test', decl: 'struct enum union error true false null undefined', types: 'u8 u16 u32 u64 usize i32 i64 f64 bool void anyerror type', extra: [AT] },
      header: ['const std = @import("std");', 'const builtin = @import("builtin");', 'const log = std.log.scoped(.chat);', ''],
      recv: [['std.debug.print("{s}\\n", .{', '});'], ['log.info("{s}", .{', '});'], ['log.debug("{s}", .{', '});']],
      send: [['const reply = try prompt(', ');'], ['const answer = try prompt(', ');'], ['var input = try prompt(', ');']],
      wrap: [
        'pub fn main() !void {\n    @\n}',
        'fn $f(rows: []const []const u8) usize {\n    for (rows) |row| {\n        if (row.len == 0) continue;\n        @\n    }\n    return rows.len;\n}',
        'if (builtin.mode == .Debug) {\n    @\n}',
        'while (attempt < 3) : (attempt += 1) {\n    @\n}',
        'test "$f" {\n    @\n}',
      ],
      block: [
        'var count: usize = 0;',
        'const Order = struct {\n    id: u32,\n    price: f64,\n    qty: u32 = 1,\n};',
        'var gpa = std.heap.GeneralPurposeAllocator(.{}){};\ndefer _ = gpa.deinit();',
        'const timeout_ms = 30_000;',
        'fn $f(n: u32) u32 {\n    return if (n < 2) n else $f(n - 1) + $f(n - 2);\n}',
        '// TODO: move this into build.zig.zon\nconst base_url = "https://api.example.com/v1";',
      ],
      group: { recv: [['const messages = [_][]const u8{\n    @@\n};', '', ',']] },
    },
    vb: {
      comment: "' ", open: ['File.ReadAllBytes(', ')'], names: PASCAL, indent: '    ', base: '    ', quote: doubled('"'),
      hl: { ci: true, com: ["'", 'REM'], kw: 'imports module end sub function return if then else elseif for each in next while do loop select case try catch finally throw new dim as of and or not andalso orelse is isnot continue exit to', decl: 'public private friend protected shared readonly const class structure property true false nothing me', types: 'string integer long double decimal boolean object list dictionary' },
      header: ['Imports System', 'Imports System.Collections.Generic', 'Imports System.IO', '', 'Module Program'],
      footer: ['End Module'],
      recv: [['Console.WriteLine(', ')'], ['Debug.WriteLine(', ')'], ['Console.Error.WriteLine(', ')'], ['Trace.WriteLine(', ')']],
      send: [['Dim reply = Prompt(', ')'], ['Dim answer As String = Prompt(', ').Trim()'], ['Dim input = Prompt(', ')']],
      wrap: [
        'Sub Main(args As String())\n    @\nEnd Sub',
        'Private Sub $f(rows As List(Of String))\n    For Each row In rows\n        If String.IsNullOrEmpty(row) Then Continue For\n        @\n    Next\nEnd Sub',
        'Try\n    @\nCatch ex As Exception\n    Console.Error.WriteLine(ex.Message)\nEnd Try',
        'If Environment.GetEnvironmentVariable("DEBUG") IsNot Nothing Then\n    @\nEnd If',
        'For attempt = 1 To 3\n    @\nNext',
      ],
      block: [
        'Private count As Integer = 0',
        'Private Const Timeout As Integer = 30',
        'Private ReadOnly cache As New Dictionary(Of String, Integer)',
        'count += 1',
        "' TODO: move this into App.config\nPrivate ReadOnly BaseUrl As String = \"https://api.example.com/v1\"",
        'Private Function $f(n As Integer) As Integer\n    Return If(n < 2, n, $f(n - 1) + $f(n - 2))\nEnd Function',
      ],
    },
    dockerfile: {
      first: 1, comment: '# ', open: ['$(cat ', ')'], names: SNAKE, indent: '  ',
      hl: { kw: 'FROM AS RUN CMD ENTRYPOINT COPY ADD ENV ARG EXPOSE WORKDIR USER LABEL VOLUME HEALTHCHECK SHELL ONBUILD STOPSIGNAL', decl: '', types: '', extra: [SIGIL] },
      header: ['# syntax=docker/dockerfile:1', 'FROM node:20-alpine AS build', 'WORKDIR /app', ''],
      footer: ['CMD ["node", "dist/server.js"]'],
      recv: [['RUN echo ', ''], ['LABEL description=', ''], ["RUN printf '%s\\n' ", ''], ['LABEL org.opencontainers.image.title=', '']],
      send: [['ARG REPLY=', ''], ['ENV ANSWER=', ''], ['ARG MESSAGE=', '']],
      block: ['COPY package*.json ./', 'RUN npm ci', 'COPY . .', 'RUN npm run build', 'EXPOSE 8080', 'ENV NODE_ENV=production', 'USER node', 'HEALTHCHECK --interval=30s CMD wget -qO- http://localhost:8080/health || exit 1', 'FROM node:20-alpine\nWORKDIR /app\nCOPY --from=build /app/dist ./dist', '# TODO: pin the base image digest\nRUN apk add --no-cache tini'],
    },
    makefile: {
      comment: '# ', open: ['$(shell cat ', ')'], names: SNAKE, indent: '\t',
      hl: { kw: 'ifeq ifneq ifdef ifndef else endif include define endef export', decl: '', types: '', extra: [['\\$[(@<^][\\w ]*\\)?', 'key']] },
      header: ['.PHONY: all build test clean', '', 'CC ?= cc', 'CFLAGS ?= -O2 -Wall', '', 'all: build', ''],
      recv: [['\t@echo ', ''], ["\t@printf '%s\\n' ", ''], ['\t$(info ', ')']],
      send: [['\t@read -r -p ', ' REPLY'], ['\t@read -rp ', ' ANSWER']],
      wrap: ['build:\n@\n\t$(CC) $(CFLAGS) -o build/app src/*.c', 'test: build\n@\n\t./build/app --self-test', 'clean:\n@\n\trm -rf build/', 'release: test\n@\n\tgit tag v$(VERSION)'],
      block: ['VERSION := $(shell git describe --tags --always)', 'build/%.o: src/%.c\n\t@mkdir -p $(dir $@)\n\t$(CC) $(CFLAGS) -c $< -o $@', 'lint:\n\tclang-format --dry-run src/*.c', '# TODO: add a docker target\nPREFIX ?= /usr/local'],
    },
    cmake: {
      comment: '# ', names: SNAKE, indent: '  ',
      hl: { ci: true, kw: 'if elseif else endif foreach endforeach while endwhile function endfunction macro endmacro return', decl: 'set option project add_executable add_library target_link_libraries target_include_directories find_package include message install cmake_minimum_required', types: 'STATUS WARNING NOTICE VERBOSE FATAL_ERROR PUBLIC PRIVATE INTERFACE REQUIRED ON OFF', extra: [['\\$\\{\\w+\\}', 'key']] },
      header: ['cmake_minimum_required(VERSION 3.24)', 'project(chat_sync LANGUAGES CXX)', '', 'set(CMAKE_CXX_STANDARD 20)', ''],
      recv: [['message(STATUS ', ')'], ['message(', ')'], ['message(VERBOSE ', ')'], ['message(NOTICE ', ')']],
      send: [['set(REPLY ', ')'], ['set(ANSWER ', ' CACHE STRING "")']],
      wrap: ['if(BUILD_TESTING)\n  @\nendif()', 'foreach(target IN LISTS TARGETS)\n  @\nendforeach()', 'function($f)\n  @\nendfunction()', 'if(NOT CMAKE_BUILD_TYPE)\n  @\n  set(CMAKE_BUILD_TYPE Release)\nendif()'],
      block: ['add_executable(app src/main.cpp)', 'target_link_libraries(app PRIVATE fmt::fmt)', 'find_package(fmt REQUIRED)', 'option(BUILD_TESTING "Build the tests" ON)', 'target_include_directories(app PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/include)', '# TODO: move this into a preset\nset(CMAKE_EXPORT_COMPILE_COMMANDS ON)'],
    },
    terraform: {
      comment: '# ', open: ['file(', ')'], names: SNAKE, indent: '  ',
      hl: { com: ['#', '//'], kw: 'resource data variable output locals module provider terraform for_each count depends_on lifecycle dynamic for in if', decl: 'true false null', types: 'string number bool list map object set any' },
      header: ['terraform {', '  required_version = ">= 1.6"', '}', '', 'provider "aws" {', '  region = var.region', '}', ''],
      recv: [['description = ', ''], ['value       = ', ''], ['default     = ', ''], ['comment     = ', '']],
      send: [['default = ', ''], ['value   = ', '']],
      wrap: ['resource "aws_sns_topic" "$f" {\n  name = "events"\n  @\n}', 'variable "$f" {\n  type = string\n  @\n}', 'output "$f" {\n  @\n}', 'locals {\n  @\n}'],
      block: ['module "vpc" {\n  source = "terraform-aws-modules/vpc/aws"\n  cidr   = "10.0.0.0/16"\n}', 'data "aws_caller_identity" "current" {}', 'resource "aws_s3_bucket" "logs" {\n  bucket = "app-logs-${var.env}"\n}', '# TODO: move this into a module\nvariable "region" {\n  default = "ap-northeast-2"\n}'],
    },
    solidity: {
      comment: '// ', open: ['abi.encodePacked(', ')'], names: CAMEL, indent: '    ', base: '    ',
      hl: { com: C, kw: 'pragma import contract interface library is function modifier event emit return returns if else for while require revert error new delete', decl: 'public private internal external view pure payable memory storage calldata constant immutable override virtual true false', types: 'address uint256 uint8 int256 bool string bytes bytes32 mapping' },
      header: ['// SPDX-License-Identifier: MIT', 'pragma solidity ^0.8.24;', '', 'contract Inbox {', '    event Message(string text);', ''],
      footer: ['}'],
      recv: [['emit Message(', ');'], ['console.log(', ');'], ['require(ok, ', ');']],
      send: [['string memory reply = ', ';'], ['bytes memory answer = bytes(', ');']],
      wrap: ['function $f(uint256 id) external {\n    @\n}', 'constructor() {\n    @\n}', 'modifier onlyOwner() {\n    @\n    _;\n}'],
      block: ['address public owner;', 'mapping(address => uint256) public balances;', 'uint256 private constant TIMEOUT = 30;', 'error Unauthorized();', '// TODO: move this into a library\nfunction $f(uint256 a, uint256 b) internal pure returns (uint256) {\n    return a > b ? a : b;\n}'],
    },
    graphql: {
      comment: '# ', names: CAMEL, indent: '  ', base: '  ',
      hl: { kw: 'query mutation subscription fragment on type input enum interface union scalar schema extend implements directive', decl: 'true false null', types: 'ID String Int Float Boolean', extra: [SIGIL] },
      header: ['mutation SyncInbox($id: ID!) {'],
      footer: ['}'],
      recv: [['notify(text: ', ') { id }'], ['message(body: ', ') { id createdAt }'], ['log(text: ', ')']],
      send: [['reply(text: ', ') { id }'], ['sendMessage(threadId: $id, text: ', ') { id }']],
      block: ['viewer { id name }', 'unreadCount', 'markSeen(threadId: $id) { ok }', '# TODO: batch these\nping'],
    },
    diff: {
      // a patch to a notes file: theirs are context lines, ours are added; time stamps are the hunk headers
      first: 4, comment: '@@ ', commentEnd: ' @@', open: ['Binary files a/', ' differ'], names: SNAKE, indent: ' ', quote: bare,
      hl: { mode: 'diff' },
      header: ['diff --git a/NOTES.md b/NOTES.md', 'index 3f2a1c4..8b7d9e0 100644', '--- a/NOTES.md', '+++ b/NOTES.md'],
      recv: [[' ', ''], [' - ', ''], [' > ', '']],
      send: [['+', ''], ['+- ', ''], ['+> ', '']],
      block: ['-TODO: write the migration notes', ' ', '-- [ ] rotate the staging keys', ' ## Notes', '-old: see the wiki'],
    },
    'git-rebase': {
      comment: '# ', names: SNAKE, indent: '  ', quote: bare,
      hl: { kw: 'pick reword edit squash fixup drop exec break label reset merge' },
      recv: [['pick 3f2a1c4 ', ''], ['pick 8b7d9e0 ', ''], ['pick a1b2c3d ', ''], ['pick 5e6f7a8 ', ''], ['squash 9c0d1e2 ', '']],
      send: [['reword 4b5c6d7 ', ''], ['pick 7e8f9a0 ', ''], ['fixup 2c3d4e5 ', '']],
      block: ['exec npm test', 'break', 'drop 6d7e8f9 wip: debug logging'],
      footer: ['# Rebase 3f2a1c4..7e8f9a0 onto 1a2b3c4 (12 commands)', '#', '# Commands:', '# p, pick <commit> = use commit', '# r, reword <commit> = use commit, but edit the commit message', '# s, squash <commit> = use commit, but meld into previous commit'],
    },
    // log and plain text: messages as bare lines, no quotes
    log: {
      comment: '# ', open: ['[', ']'], names: SNAKE, indent: '  ', quote: bare,
      hl: { mode: 'log' },
      recv: [['INFO  [main] ', ''], ['INFO  [worker-1] ', ''], ['DEBUG [sync] ', ''], ['INFO  [http] ', '']],
      send: [['INPUT [stdin] ', '']],
      block: ['DEBUG [pool] worker-3 idle', 'INFO  [http] GET /health 200 3ms', 'WARN  [cache] miss ratio 0.41', 'DEBUG [gc] collected 1204 objects', 'INFO  [db] connection pool size=8', 'DEBUG [scheduler] next run in 30s', 'INFO  [http] POST /api/v1/events 202 18ms', 'DEBUG [cache] evicted 12 keys'],
    },
    plaintext: {
      comment: '# ', open: ['[', ']'], names: SNAKE, indent: '  ', quote: bare,
      hl: { mode: 'plain' },
      recv: [['', '']],
      send: [['> ', '']],
      block: ['- [ ] update dependencies', '- [x] fix flaky test', 'TODO: write the migration notes', '- [ ] rotate the staging keys', 'NOTE: see the wiki for the release checklist'],
    },
  }
  // languages written like another one
  const LIKE = {
    javascriptreact: 'javascript', typescriptreact: 'typescript', 'cuda-cpp': 'cpp', hlsl: 'c', glsl: 'c', shaderlab: 'c', 'objective-cpp': 'objective-c',
    jsonc: 'json', snippets: 'json', dockercompose: 'yaml', raku: 'perl', tex: 'latex', bibtex: 'latex', crystal: 'ruby', mojo: 'python',
    elm: 'haskell', purescript: 'haskell', scheme: 'clojure', racket: 'clojure', sass: 'scss', stylus: 'scss', xsl: 'xml',
    razor: 'html', handlebars: 'html', astro: 'html', twig: 'html', liquid: 'html', jinja: 'html', nunjucks: 'html', blade: 'html',
    juliamarkdown: 'markdown', prompt: 'markdown', instructions: 'markdown', chatagent: 'markdown', skill: 'markdown',
    'git-commit': 'plaintext', ignore: 'plaintext', wat: 'plaintext', 'search-result': 'plaintext',
  }

  // VS Code's languages (from its built-in extensions, then a few popular extensions'): id | name | extensions | file names
  const LANGUAGES = Object.fromEntries(
    `plaintext | Plain Text | .txt
log | Log | .log
python | Python | .py .rpy .pyw .cpy .gyp .gypi .pyi .ipy .pyt | SConstruct SConscript
javascript | JavaScript | .js .es6 .mjs .cjs .pac | jakefile
javascriptreact | JavaScript JSX | .jsx
typescript | TypeScript | .ts .cts .mts
typescriptreact | TypeScript JSX | .tsx
java | Java | .java .jav
c | C | .c .i
cpp | C++ | .cpp .cppm .cc .ccm .cxx .cxxm .c++ .c++m .hpp .hh .hxx .h++ .h .ii .ino .inl .ipp .ixx .mpp .mxx .tpp .txx .hpp.in .h.in
cuda-cpp | CUDA C++ | .cu .cuh
csharp | C# | .cs .csx .cake
go | Go | .go
rust | Rust | .rs
kotlin | Kotlin | .kt .kts
swift | Swift | .swift
dart | Dart | .dart
objective-c | Objective-C | .m
objective-cpp | Objective-C++ | .mm
php | PHP | .php .php4 .php5 .phtml .ctp
ruby | Ruby | .rb .rbx .rjs .gemspec .rake .ru .erb .podspec .rbi | rakefile gemfile guardfile podfile capfile cheffile hobofile vagrantfile appraisals rantfile berksfile berksfile.lock thorfile puppetfile dangerfile brewfile fastfile appfile deliverfile matchfile scanfile snapfile gymfile
scala | Scala | .scala .sc .sbt
groovy | Groovy | .groovy .gvy .gradle .jenkinsfile .nf | Jenkinsfile
lua | Lua | .lua
perl | Perl | .pl .pm .pod .t .psgi
raku | Raku | .raku .rakumod .rakutest .rakudoc .nqp .p6 .pl6 .pm6
r | R | .r .rhistory .rprofile .rt
julia | Julia | .jl
juliamarkdown | Julia Markdown | .jmd
shellscript | Shell Script | .sh .bash .bashrc .bash_aliases .bash_profile .bash_login .ebuild .eclass .profile .bash_logout .xprofile .xsession .xsessionrc .zsh .zshrc .zprofile .zlogin .zlogout .zshenv .zsh-theme .fish .ksh .csh .cshrc .tcshrc .yashrc .yash_profile | APKBUILD PKGBUILD .envrc .hushlogin zshrc zshenv zlogin zprofile zlogout bashrc_Apple_Terminal zshrc_Apple_Terminal
powershell | PowerShell | .ps1 .psm1 .psd1 .pssc .psrc
bat | Batch | .bat .cmd
sql | MS SQL | .sql .dsql
html | HTML | .html .htm .shtml .xhtml .xht .mdoc .jsp .asp .aspx .jshtm .volt .ejs .rhtml
razor | Razor | .cshtml .razor
handlebars | Handlebars | .handlebars .hbs .hjs
jade | Pug | .pug .jade
vue | Vue | .vue
svelte | Svelte | .svelte
astro | Astro | .astro
twig | Twig | .twig
liquid | Liquid | .liquid
jinja | Jinja | .jinja .jinja2 .j2
nunjucks | Nunjucks | .njk
blade | Blade | .blade.php
xml | XML | .xml .xsd .ascx .atom .axml .axaml .bpmn .cpt .csl .csproj .csproj.user .dita .ditamap .dtd .ent .mod .dtml .fsproj .fxml .iml .isml .jmx .launch .menu .mxml .nuspec .opml .owl .proj .props .pt .publishsettings .pubxml .pubxml.user .rbxlx .rbxmx .rdf .rng .rss .shproj .slnx .storyboard .svg .targets .tld .tmx .vbproj .vbproj.user .vcxproj .vcxproj.filters .wixproj .wsdl .wxi .wxl .wxs .xaml .xbl .xib .xlf .xliff .xpdl .xul .xoml
xsl | XSL | .xsl .xslt
css | CSS | .css
scss | SCSS | .scss
sass | Sass | .sass
less | Less | .less
stylus | Stylus | .styl
json | JSON | .json .bowerrc .jscsrc .webmanifest .js.map .css.map .ts.map .har .jslintrc .jsonld .geojson .ipynb .vuerc .code-profile .tsbuildinfo | composer.lock .watchmanconfig
jsonc | JSON with Comments | .jsonc .eslintrc .eslintrc.json .jsfmtrc .jshintrc .swcrc .hintrc .babelrc .code-workspace | settings.json launch.json tasks.json mcp.json keybindings.json extensions.json argv.json profiles.json devcontainer.json .devcontainer.json babel.config.json .babelrc.json .ember-cli typedoc.json tsconfig.json jsconfig.json language-configuration.json icon-theme.json color-theme.json
jsonl | JSON Lines | .jsonl .ndjson
snippets | Code Snippets | .code-snippets
yaml | YAML | .yaml .yml .eyaml .eyml .cff .yaml-tmlanguage .yaml-tmpreferences .yaml-tmtheme .winget
dockercompose | Compose | | compose.yml compose.yaml docker-compose.yml docker-compose.yaml
toml | TOML | .toml | Cargo.lock poetry.lock uv.lock
ini | Ini | .ini
properties | Properties | .conf .properties .cfg .directory .gitattributes .gitconfig .gitmodules .editorconfig .repo .npmrc | gitconfig
dotenv | Dotenv | .env | .env .flaskenv user-dirs.dirs
csv | CSV | .csv
markdown | Markdown | .md .mkd .mkdn .mdwn .mdown .markdown .markdn .mdtxt .mdtext .litcoffee .ron .ronn .workbook .copilotmd
prompt | Prompt | .prompt.md
instructions | Instructions | .instructions.md | copilot-instructions.md
chatagent | Agent | .agent.md .chatmode.md
skill | Skill | | SKILL.md
restructuredtext | reStructuredText | .rst
latex | LaTeX | .tex .ltx .ctx
tex | TeX | .sty .cls .bbx .cbx
bibtex | BibTeX | .bib
fsharp | F# | .fs .fsi .fsx .fsscript
haskell | Haskell | .hs .lhs
elm | Elm | .elm
purescript | PureScript | .purs
ocaml | OCaml | .ml .mli
elixir | Elixir | .ex .exs
erlang | Erlang | .erl .hrl
clojure | Clojure | .clj .cljs .cljc .cljx .clojure .edn
scheme | Scheme | .scm .ss
racket | Racket | .rkt
coffeescript | CoffeeScript | .coffee .cson .iced
crystal | Crystal | .cr
mojo | Mojo | .mojo
zig | Zig | .zig
vb | Visual Basic | .vb .brs .vbs .bas .vba
hlsl | HLSL | .hlsl .hlsli .fx .fxh .vsh .psh .cginc .compute
glsl | GLSL | .glsl .vert .frag .geom .comp .tesc .tese
shaderlab | ShaderLab | .shader
solidity | Solidity | .sol
terraform | Terraform | .tf .tfvars
graphql | GraphQL | .graphql .gql .graphqls
dockerfile | Docker | .dockerfile .containerfile | Dockerfile Containerfile
makefile | Makefile | .mak .mk | Makefile makefile GNUmakefile OCamlMakefile
cmake | CMake | .cmake | CMakeLists.txt
diff | Diff | .diff .patch .rej
git-commit | Git Commit Message | | COMMIT_EDITMSG MERGE_MSG
git-rebase | Git Rebase Message | | git-rebase-todo
ignore | Ignore | .gitignore .gitignore_global .git-blame-ignore-revs .npmignore | .vscodeignore .copilotignore
wat | WebAssembly Text Format | .wat .wasm
search-result | Search Result | .code-search`
      .split('\n')
      .map((row) => {
        const [id, name, exts, names] = row.split('|').map((s) => s.trim())
        return [id, { name, exts: exts ? exts.split(' ') : [], names: names ? names.split(' ') : [] }]
      }),
  )
  const BY_EXT = {}
  const BY_NAME = {}
  for (const [id, { exts, names }] of Object.entries(LANGUAGES)) {
    for (const ext of exts) BY_EXT[ext.slice(1).toLowerCase()] ??= id
    for (const name of names) BY_NAME[name.toLowerCase()] ??= id
  }
  // file name -> language id, as VS Code picks it: the whole name, then the longest extension (a.d.ts: d.ts, then ts);
  // for any other name, fallback
  const lang = (fileName, fallback = 'plaintext') => {
    const base = (fileName ?? '').split('/').pop().toLowerCase()
    if (BY_NAME[base]) return BY_NAME[base]
    const parts = base.split('.')
    for (let i = 1; i < parts.length; i++) if (BY_EXT[parts.slice(i).join('.')]) return BY_EXT[parts.slice(i).join('.')]
    return fallback
  }
  // every language gets a full template, with what was left out filled in
  for (const id of Object.keys(LANGUAGES)) {
    const own = LANGS[LIKE[id] ?? id]
    if (!own) throw new Error('no template for ' + id)
    LANGS[id] = { quote: dq, open: ['', ''], names: SNAKE, indent: '    ', header: [], wrap: [], group: {}, hl: {}, ...own, name: LANGUAGES[id].name }
  }
  for (const id of Object.keys(LANGS)) if (!LANGUAGES[id]) delete LANGS[id]

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

  const picker = (rand) => (list) => list[Math.floor(rand() * list.length)]
  const file = (src) => new URL(src).pathname.split('/').pop()
  const comment = (L, text) => L.comment + text + (L.commentEnd ?? '')

  // rows: [{ side: 'recv' | 'send' | 'note', text, media, src, mi, user }]
  // opts: { lang, seed, text, header } -- seed (with text) adds the line being typed at the end, placed like a
  //   sent message; header: comment lines for the top of the file
  // -> lines:
  //   { kind: 'code', text }                                       filler, header, blank lines
  //   { kind: 'note', indent, text, user, row }                    a comment line (timestamps, seen, names)
  //   { kind: 'recv' | 'send' | 'draft', indent, pre, post, ... }  a message: pre + "text" + post
  function camo(rows, level, opts = {}) {
    const L = LANGS[opts.lang] ?? LANGS.python
    const odds = LEVEL[level]
    const base = odds ? (L.base ?? '') : ''
    const out = []
    const code = (text) => out.push({ kind: 'code', text })
    const isBlank = (l) => l.kind === 'code' && l.text === ''
    const blank = () => out.length && !isBlank(out.at(-1)) && code('') // one empty line between blocks
    let previous // the last filler used, so the same snippet never comes twice in a row
    if (odds) {
      const rest = L.header.slice(L.first ?? 0)
      L.header.slice(0, L.first ?? 0).forEach(code)
      for (const text of opts.header ?? []) code(comment(L, text))
      if (opts.header?.length && rest[0] !== '') code('')
      rest.forEach(code)
    }
    const msg = (row, i) => ({ kind: row.side, text: row.text, media: row.media, src: row.src, mi: row.mi, row: i })
    const snippet = (rand, list) => {
      let i = Math.floor(rand() * list.length)
      if (list[i] === previous) i = (i + 1) % list.length
      previous = list[i]
      return list[i].replaceAll('$f', picker(rand)(L.names)).split('\n')
    }
    const indented = (l) => code(l && base + l)
    const fillers = (rand) => {
      for (let n = 0; n < 2 && L.block.length && rand() < odds.block; n++) {
        blank()
        snippet(rand, L.block).forEach(indented)
        blank()
      }
    }

    // Puts one message line into the file, with its share of filler.
    const place = (seed, forms, line) => {
      const rand = seeded(seed)
      // every input gets a variable to land in, at any level; output only sometimes gets extras
      const [pre, post] = forms === L.send || (odds && rand() < odds.fancy) ? picker(rand)(forms) : forms[0]
      if (!odds) return out.push({ ...line, indent: '', pre, post })
      fillers(rand)
      if (L.wrap.length && rand() < odds.wrap) {
        blank()
        for (const l of snippet(rand, L.wrap)) l.trim() === '@' ? out.push({ ...line, indent: base + l.slice(0, l.indexOf('@')), pre, post }) : indented(l)
        blank()
      } else {
        out.push({ ...line, indent: base, pre, post })
      }
    }

    // A run of messages from one side inside one structure. Seeded by the run's first message, so a run that grows
    // at the bottom keeps its shape.
    const group = (run, start) => {
      const side = run[0].side
      const forms = L.group[side] ?? []
      const rand = seeded('group\n' + side + '\n' + run[0].text)
      if (!odds || run.length < 2 || !forms.length || rand() >= odds.group) return false
      const [template, pre, post] = picker(rand)(forms)
      fillers(rand)
      blank()
      let key = Math.floor(rand() * KEYS.length)
      for (const l of template.replaceAll('$f', picker(rand)(L.names)).split('\n')) {
        if (l.trim() !== '@@') {
          indented(l)
          continue
        }
        const indent = base + l.slice(0, l.indexOf('@@'))
        run.forEach((row, i) => out.push({ ...msg(row, start + i), indent, pre: pre.replace('$k', KEYS[key++ % KEYS.length]), post }))
      }
      blank()
      return true
    }

    for (let i = 0; i < rows.length; ) {
      const row = rows[i]
      if (row.side === 'note') {
        out.push({ kind: 'note', indent: base, text: row.text ?? 'media', user: row.user, row: i })
        i++
        continue
      }
      let end = i + 1
      while (end < rows.length && end - i < 6 && rows[end].side === row.side) end++
      if (group(rows.slice(i, end), i)) {
        i = end
        continue
      }
      place(row.side + '\n' + row.text, row.side === 'recv' ? L.recv : L.send, msg(row, i))
      i++
    }
    if (opts.seed != null) place('draft\n' + opts.seed, L.send, { kind: 'draft', text: opts.text ?? '' })
    if (odds && L.footer) {
      blank()
      L.footer.forEach(code)
    }
    return out
  }

  // A line as plain source text.
  camo.text = (l, lang) => {
    const L = LANGS[lang] ?? LANGS.python
    if (l.kind === 'code') return l.text
    if (l.kind === 'note') return l.indent + comment(L, l.text)
    const empty = l.kind === 'draft' && !l.text // nothing typed yet: a plain input(), no empty quotes
    const args = [l.text != null && !empty && L.quote(l.text), l.src && L.open[0] + L.quote(file(l.src)) + L.open[1]].filter(Boolean)
    return l.indent + l.pre + args.join(', ') + l.post + (l.media && !l.src ? '  ' + comment(L, 'media') : '')
  }
  // a comment line in the language, and the two ends of a message literal (what the input line puts around the typing)
  camo.comment = (lang, text) => comment(LANGS[lang] ?? LANGS.python, text)
  camo.quotes = (lang) => (LANGS[lang] ?? LANGS.python).quote('\0').split('\0')

  // Code to type out in the decoy file: the language's header and a long run of its filler.
  camo.corpus = (lang) => {
    const L = LANGS[lang] ?? LANGS.python
    const rand = seeded('corpus\n' + lang)
    const pick = picker(rand)
    const say = ['starting worker', 'cache warmed', 'retrying request', 'skipping empty row', 'loaded config', 'request failed', 'processing batch', 'shutting down', 'connection closed', 'done']
    const base = L.base ?? ''
    const out = [...L.header]
    let previous
    for (let n = 0; n < 80; n++) {
      const list = L.wrap.length && rand() < 0.4 ? L.wrap : L.block
      let i = Math.floor(rand() * list.length)
      if (list[i] === previous) i = (i + 1) % list.length
      previous = list[i]
      for (const l of list[i].replaceAll('$f', pick(L.names)).split('\n')) {
        const [pre, post] = pick(L.recv)
        out.push(l.trim() === '@' ? base + l.slice(0, l.indexOf('@')) + pre + L.quote(pick(say)) + post : l && base + l)
      }
      out.push('')
    }
    return [...out, ...(L.footer ?? [])].join('\n') + '\n'
  }
  // A display name as an English file name: Hangul romanised (Revised Romanization, with the usual spelling
  // of common surnames), everything else lower-cased, words joined with "_".
  const INITIAL = ['g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's', 'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h']
  const MEDIAL = ['a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i']
  const FINAL = ['', 'k', 'k', 'k', 'n', 'n', 'n', 't', 'l', 'k', 'm', 'l', 'l', 'l', 'p', 'l', 'm', 'p', 'p', 't', 't', 'ng', 't', 't', 'k', 't', 'p', 't']
  // a final consonant carried onto a following silent ㅇ (민아 -> mina): what it sounds like as an initial
  const CARRY = { 1: 'g', 2: 'kk', 4: 'n', 7: 'd', 8: 'r', 16: 'm', 17: 'b', 19: 's', 20: 'ss', 22: 'j', 23: 'ch', 24: 'k', 25: 't', 26: 'p', 27: '' }
  const SURNAME = Object.fromEntries(
    '김 kim 이 lee 박 park 최 choi 정 jung 강 kang 조 cho 윤 yoon 장 jang 임 lim 한 han 오 oh 서 seo 신 shin 권 kwon 황 hwang 안 ahn 송 song 류 ryu 유 yoo 전 jeon 홍 hong 고 ko 문 moon 양 yang 손 son 배 bae 백 baek 허 heo 노 noh 남 nam 심 shim 하 ha 곽 kwak 성 sung 차 cha 주 joo 우 woo 구 koo 민 min 진 jin 나 na 지 ji 엄 um 채 chae 원 won 천 cheon 방 bang 공 kong 현 hyun 함 ham 변 byun 염 yeom 여 yeo 추 choo 도 do 소 so 석 seok 선 sun 설 seol 마 ma 길 gil 연 yeon 위 wi 표 pyo 명 myung 기 ki 반 ban 왕 wang 금 keum 옥 ok 육 yuk 인 in 맹 maeng 제 je 모 mo 탁 tak 국 kook 편 pyeon 용 yong 경 kyung 봉 bong 황보 hwangbo 남궁 namgung 제갈 jegal 선우 sunwoo 독고 dokgo'
      .split(' ')
      .flatMap((w, i, all) => (i % 2 ? [] : [[w, all[i + 1]]])),
  )
  const hangul = (word) => {
    let out = ''
    for (let i = 0; i < word.length; i++) {
      const code = word.charCodeAt(i) - 0xac00
      const next = word.charCodeAt(i + 1) - 0xac00
      const fin = code % 28
      let initial = INITIAL[Math.floor(code / 588)]
      const before = i ? (word.charCodeAt(i - 1) - 0xac00) % 28 : 0
      if (before in CARRY && initial === '') initial = CARRY[before] // the previous final moved here
      else if (before === 8 && initial === 'r') initial = 'l' // ㄹㄹ -> ll
      const carried = fin in CARRY && next >= 0 && next < 11172 && Math.floor(next / 588) === 11
      out += initial + MEDIAL[Math.floor((code % 588) / 28)] + (carried ? '' : FINAL[fin])
    }
    return out
  }
  camo.slug = (name) => {
    const words = (name ?? '').normalize('NFC').match(/[\uac00-\ud7a3]+|[a-z0-9]+/gi) ?? []
    const parts = words.map((w) => {
      if (!/[\uac00-\ud7a3]/.test(w)) return w.toLowerCase()
      // a three-syllable word is a full name (김민수 -> kim_minsu); four, with a two-syllable surname (남궁민수)
      const n = w.length === 4 && SURNAME[w.slice(0, 2)] ? 2 : w.length === 3 && SURNAME[w[0]] ? 1 : 0
      return n ? SURNAME[w.slice(0, n)] + '_' + hangul(w.slice(n)) : hangul(w)
    })
    return parts.join('_').slice(0, 40).replace(/_+$/, '') || 'chat'
  }

  // The single replacement that turns `from` into `to`: from.slice(start, end) becomes text.
  // The unchanged ends are left alone, so a cursor or scroll position sitting there stays put.
  camo.diff = (from, to) => {
    let start = 0
    while (start < from.length && from[start] === to[start]) start++
    let end = 0
    while (end < from.length - start && end < to.length - start && from.at(-1 - end) === to.at(-1 - end)) end++
    const low = (c) => c >= '\uDC00' && c <= '\uDFFF' // second half of an emoji: never cut there
    if (start && low(from[start])) start--
    if (end && low(from.at(-end))) end--
    return { start, end: from.length - end, text: to.slice(start, to.length - end) }
  }
  camo.file = file
  camo.lang = lang
  camo.LANGS = LANGS
  camo.LANGUAGES = LANGUAGES
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
    { side: 'recv', text: '셋' },
    { side: 'send', text: '넷' },
    { side: 'send', text: '다섯' },
  ]
  const kinds = rows.map((r) => r.side).concat('draft')
  for (const lang of Object.keys(camo.LANGS)) {
    const L = camo.LANGS[lang]
    const shown = L.quote
    for (const level of camo.LEVELS) {
      const what = `${lang} level ${level}`
      const lines = camo(rows, level, { lang, seed: 'thread:7', text: '' })
      const text = lines.map((l) => camo.text(l, lang))
      // every message survives, in order, with its text
      assert.deepStrictEqual(lines.filter((l) => l.kind !== 'code').map((l) => l.kind), kinds, what)
      assert.deepStrictEqual(lines.filter((l) => l.row != null).map((l) => l.row), rows.map((_, i) => i), what + ': rows point back at their message')
      for (const [i, l] of lines.entries()) {
        if (l.kind === 'recv' || l.kind === 'send') assert(l.text == null || text[i].includes(shown(l.text)), `${what}: ${text[i]}`)
        assert(!text[i].includes('\n'), 'one line each')
        assert(!/^\s*@@?\s*$/.test(text[i]) && !/\$[fk]/.test(text[i]), `${what}: placeholder replaced: ${text[i]}`)
      }
      const draft = lines.find((l) => l.kind === 'draft')
      assert(L.send.some(([pre, post]) => draft.pre === pre && draft.post === post), `${what}: the typing line is a plain input form`)
      if (L.quote('"') === '"\\""') assert(text.some((t) => t.includes('"say \\"hi\\"\\nok\\\\"')), 'quotes, newlines, backslashes escaped')
      assert(text.some((t) => t.includes(L.open[0] + L.quote('photo.jpg') + L.open[1])), what + ': picture')
      assert.deepStrictEqual(lines, camo(rows, level, { lang, seed: 'thread:7', text: '' }), 'same input, same file')
      if (!level) assert.strictEqual(lines.length, rows.length + 1, 'level 0 is messages only')
      // typing must not move anything: only the draft line's text changes
      const typed = camo(rows, level, { lang, seed: 'thread:7', text: '안녕' })
      assert.deepStrictEqual(typed.map((l) => ({ ...l, text: l.kind === 'draft' ? '' : l.text })), lines, 'typing keeps the layout')
      assert.strictEqual(camo(rows, level, { lang }).filter((l) => l.kind === 'draft').length, 0, 'no draft unless asked')
    }
    assert(camo.corpus(lang).split('\n').length > 50, lang + ': a corpus to type out')
  }
  // header comments sit on top, above the imports
  const head = camo(rows, 2, { header: ['Author: 김민수'] }).map((l) => camo.text(l))
  assert.strictEqual(head[0], '# Author: 김민수')
  const many = Array.from({ length: 60 }, (_, i) => ({ side: i % 3 ? 'recv' : 'send', text: 'message ' + i }))
  assert(camo(many, 8).length > camo(many, 4).length && camo(many, 4).length > camo(many, 2).length, 'higher level, more filler')
  assert(camo(many, 8).some((l, i, all) => l.kind === 'recv' && all[i + 1]?.kind === 'recv' && l.indent === all[i + 1].indent && l.post === ','), 'runs share a structure')
  // languages follow the file name, as in VS Code
  assert.deepStrictEqual(
    ['a.py', 'b.JS', 'c.tsx', 'Main.java', 'x.h', 'y.cc', 'main.go', 'lib.rs', 'app.log', 'notes.txt', 'README', 'Dockerfile', 'settings.json', 'x.d.ts', 'a.kt', 'b.blade.php', 'CMakeLists.txt', '.gitignore', 'dir/run.SH', 'x.unknown'].map((name) => camo.lang(name)),
    ['python', 'javascript', 'typescriptreact', 'java', 'cpp', 'cpp', 'go', 'rust', 'log', 'plaintext', 'plaintext', 'dockerfile', 'jsonc', 'typescript', 'kotlin', 'blade', 'cmake', 'ignore', 'shellscript', 'plaintext'],
  )
  assert.deepStrictEqual(Object.keys(camo.LANGS).sort(), Object.keys(camo.LANGUAGES).sort(), 'every language has a template')
  assert.deepStrictEqual([camo.quotes('python'), camo.quotes('sql'), camo.quotes('html'), camo.quotes('objective-c')], [['"', '"'], ["'", "'"], ['', ''], ['@"', '"']])
  assert.strictEqual(camo.comment('html', 'x'), '<!-- x -->')
  assert.strictEqual(camo.text({ kind: 'recv', indent: '', pre: 'echo ', post: '', text: 'a$b "c"' }, 'shellscript'), 'echo "a\\$b \\"c\\""')
  // names as English file names
  for (const [name, slug] of [['김민수', 'kim_minsu'], ['홍길동', 'hong_gildong'], ['이은영', 'lee_eunyeong'], ['민아', 'mina'], ['박은지', 'park_eunji'], ['Jane Doe', 'jane_doe'], ['주말 계획은', 'jumal_gyehoegeun'], ['남궁민수', 'namgung_minsu'], ['별래', 'byeollae'], ['🐶', 'chat'], ['team.dev 🔥 2', 'team_dev_2']])
    assert.strictEqual(camo.slug(name), slug, name)
  // diff: one replacement that leaves the unchanged ends alone and never splits an emoji
  for (const [from, to] of [['a\nb\n', 'a\nx\nb\n'], ['', 'ab\n'], ['ab\n', ''], ['say 😀 hi', 'say 😂 hi'], ['😀', '😂'], ['x("hi")', 'x("")'], ['same', 'same']]) {
    const { start, end, text } = camo.diff(from, to)
    assert.strictEqual(from.slice(0, start) + text + from.slice(end), to, `${from} -> ${to}`)
    assert(!/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(text), 'emoji kept whole')
  }
  assert.deepStrictEqual(camo.diff('a\nb\n', 'a\nx\nb\n'), { start: 2, end: 2, text: 'x\n' }, 'a line added above leaves the line below untouched')
  console.log('ok')
}
