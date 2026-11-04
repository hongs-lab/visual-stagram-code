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
  const KEYS = ['title', 'body', 'status', 'detail', 'hint', 'label', 'summary', 'note', 'reason', 'message', 'prompt', 'error']

  // A language: header/footer lines around the file, recv/send forms [pre, post] around the quoted message
  // (recv[0] is the plain one), wrap: blocks a message sits in (the line that is just "@"), block: filler,
  // group: [structure with an "@@" line, item pre, item post] for a run of messages. $f is a function name,
  // $k a dict key. hl: words for the editor's colouring.
  const LANGS = {
    py: {
      name: 'Python', comment: '# ', open: ['open(', ')'], names: SNAKE, indent: '    ',
      hl: { line: '#', kw: 'import from return if elif else for while with as try except finally raise yield pass break continue await async del global nonlocal assert match case', decl: 'def class lambda None True False and or not in is self cls', types: 'int str float bool dict list tuple set bytes object Path Any Optional' },
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
    js: {
      name: 'JavaScript', comment: '// ', open: ['readFileSync(', ')'], names: CAMEL, indent: '  ',
      hl: { line: '//', kw: 'import export from return if else for while do switch case break continue try catch finally throw new await async yield of in typeof instanceof default delete', decl: 'const let var function class extends this null undefined true false static get set', types: 'Promise Map Set Array Object JSON Math Date Error' },
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
    ts: {
      name: 'TypeScript', comment: '// ', open: ['readFileSync(', ')'], names: CAMEL, indent: '  ',
      hl: { line: '//', kw: 'import export from return if else for while do switch case break continue try catch finally throw new await async yield of in typeof instanceof default as satisfies keyof', decl: 'const let var function class extends implements interface type enum this null undefined true false public private protected readonly static', types: 'string number boolean any unknown void never Promise Record Partial Array Map Set Request Response' },
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
      name: 'Java', comment: '// ', open: ['new File(', ')'], names: CAMEL, indent: '    ', base: '    ',
      hl: { line: '//', kw: 'import package return if else for while do switch case break continue try catch finally throw throws new assert default', decl: 'public private protected static final abstract class interface record enum extends implements void this super null true false synchronized var', types: 'String int long double float boolean char byte List Map Set Optional Integer Logger Console Object' },
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
      name: 'C', comment: '// ', open: ['fopen(', ', "rb")'], names: SNAKE, indent: '    ',
      hl: { line: '//', kw: 'return if else for while do switch case break continue goto sizeof default', decl: 'int char void const static struct typedef unsigned signed long short double float enum extern NULL', types: 'size_t FILE bool uint8_t uint32_t int64_t' },
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
      name: 'C++', comment: '// ', open: ['std::ifstream(', ')'], names: SNAKE, indent: '    ',
      hl: { line: '//', kw: 'return if else for while do switch case break continue try catch throw new delete sizeof default co_await', decl: 'int char void const static struct class public private protected template typename namespace using auto bool double float unsigned long constexpr explicit virtual override nullptr true false this', types: 'std string vector unordered_map map size_t mutex' },
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
    go: {
      name: 'Go', comment: '// ', open: ['os.Open(', ')'], names: CAMEL, indent: '\t',
      hl: { line: '//', kw: 'package import return if else for range switch case break continue go defer select default fallthrough goto', decl: 'func var const type struct interface map chan nil true false', types: 'string int int64 float64 bool byte error any context' },
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
    rs: {
      name: 'Rust', comment: '// ', open: ['File::open(', ')?'], names: SNAKE, indent: '    ',
      hl: { line: '//', kw: 'use mod return if else for while loop match break continue in as where unsafe async await move', decl: 'fn let mut pub struct enum impl trait const static self Self crate super true false ref dyn', types: 'String str Vec Option Result HashMap Box i32 i64 u32 u64 usize f64 bool io' },
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
    // log and plain text: messages as bare lines, no quotes
    log: {
      name: 'Log', comment: '# ', open: ['[', ']'], names: SNAKE, indent: '  ', quote: (s) => s.replace(/\n/g, ' '),
      hl: { log: true },
      header: [],
      recv: [['INFO  [main] ', ''], ['INFO  [worker-1] ', ''], ['DEBUG [sync] ', ''], ['INFO  [http] ', '']],
      send: [['INPUT [stdin] ', '']],
      wrap: [],
      block: ['DEBUG [pool] worker-3 idle', 'INFO  [http] GET /health 200 3ms', 'WARN  [cache] miss ratio 0.41', 'DEBUG [gc] collected 1204 objects', 'INFO  [db] connection pool size=8', 'DEBUG [scheduler] next run in 30s', 'INFO  [http] POST /api/v1/events 202 18ms', 'DEBUG [cache] evicted 12 keys'],
      group: {},
    },
    txt: {
      name: 'Plain Text', comment: '# ', open: ['[', ']'], names: SNAKE, indent: '  ', quote: (s) => s.replace(/\n/g, ' '),
      hl: { plain: true },
      header: [],
      recv: [['', '']],
      send: [['> ', '']],
      wrap: [],
      block: ['- [ ] update dependencies', '- [x] fix flaky test', 'TODO: write the migration notes', '- [ ] rotate the staging keys', 'NOTE: see the wiki for the release checklist'],
      group: {},
    },
  }

  // file name -> language key
  const EXT = { py: 'py', pyw: 'py', js: 'js', mjs: 'js', cjs: 'js', jsx: 'js', ts: 'ts', tsx: 'ts', mts: 'ts', java: 'java', c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp', go: 'go', rs: 'rs', log: 'log' }
  const lang = (name) => EXT[/\.([^./]+)$/.exec(name ?? '')?.[1]?.toLowerCase()] ?? 'txt'

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
  const quote = (s) => `"${s.replace(/[\\"]/g, '\\$&').replace(/\n/g, '\\n')}"`
  const file = (src) => new URL(src).pathname.split('/').pop()

  // rows: [{ side: 'recv' | 'send' | 'note', text, media, src, mi, user }]
  // opts: { lang, seed, text, header } -- seed (with text) adds the line being typed at the end, placed like a
  //   sent message; header: comment lines for the top of the file
  // -> lines:
  //   { kind: 'code', text }                                       filler, header, blank lines
  //   { kind: 'note', indent, text, user, row }                    a comment line (timestamps, seen, names)
  //   { kind: 'recv' | 'send' | 'draft', indent, pre, post, ... }  a message: pre + "text" + post
  function camo(rows, level, opts = {}) {
    const L = LANGS[opts.lang] ?? LANGS.py
    const odds = LEVEL[level]
    const base = odds ? (L.base ?? '') : ''
    const out = []
    const code = (text) => out.push({ kind: 'code', text })
    const isBlank = (l) => l.kind === 'code' && l.text === ''
    const blank = () => out.length && !isBlank(out.at(-1)) && code('') // one empty line between blocks
    let previous // the last filler used, so the same snippet never comes twice in a row
    if (odds) {
      for (const text of opts.header ?? []) code(L.comment + text)
      if (opts.header?.length) code('')
      L.header.forEach(code)
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
    const L = LANGS[lang] ?? LANGS.py
    if (l.kind === 'code') return l.text
    if (l.kind === 'note') return `${l.indent}${L.comment}${l.text}`
    const empty = l.kind === 'draft' && !l.text // nothing typed yet: a plain input(), no empty quotes
    const args = [l.text != null && !empty && (L.quote ?? quote)(l.text), l.src && `${L.open[0]}${quote(file(l.src))}${L.open[1]}`].filter(Boolean)
    return l.indent + l.pre + args.join(', ') + l.post + (l.media && !l.src ? `  ${L.comment}media` : '')
  }

  // Code to type out in the decoy file: the language's header and a long run of its filler.
  camo.corpus = (lang) => {
    const L = LANGS[lang] ?? LANGS.py
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
        out.push(l.trim() === '@' ? base + l.slice(0, l.indexOf('@')) + pre + (L.quote ?? quote)(pick(say)) + post : l && base + l)
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
  camo.quote = quote
  camo.file = file
  camo.lang = lang
  camo.LANGS = LANGS
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
    const shown = (s) => (L.quote ?? camo.quote)(s)
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
      if (L.quote == null) {
        assert(text.some((t) => t.includes('"say \\"hi\\"\\nok\\\\"')), 'quotes, newlines, backslashes escaped')
        assert(text.some((t) => t.includes(`${L.open[0]}"photo.jpg"${L.open[1]}`)), what + ': picture')
      }
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
  // languages follow the extension
  assert.deepStrictEqual(['a.py', 'b.JS', 'c.tsx', 'Main.java', 'x.h', 'y.cc', 'main.go', 'lib.rs', 'app.log', 'notes.txt', 'README'].map(camo.lang), ['py', 'js', 'ts', 'java', 'c', 'cpp', 'go', 'rs', 'log', 'txt', 'txt'])
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
