# agent-trace-viewer

**See what your coding agents actually did** — tokens, cost, tool calls, and the pull
requests and files they produced.

Claude Code already writes a complete record of every session to
`~/.claude/projects/**/*.jsonl`: your prompts, every tool call and its raw output,
per-model token usage including cache reads and writes, and links to the PRs it opened.
There is just no way to read any of it.

This is a local viewer for those logs. It adds **no instrumentation** to your agent — it
only reads what is already on disk.

It is not a quota meter. It answers the other question: **where did all of that go?**

---

## Features

- **Session list** — active time, tokens, cache hit rate, tool calls, errors, and cost per
  session, filterable by project.
- **Session timeline** — the full step chain: thinking → tool call → result. Expand raw
  tool arguments and output, see per-step output tokens and the gap to the next step,
  spot failed calls, and drill into subagent traces.
- **Outcome tracking** — the PRs a session opened and the files it actually changed. This
  is what turns a log into a record of work.
- **Full-text search** — search across prompts, tool arguments, and tool output. Ranked by
  relevance, with highlighted snippets that link straight to the step in its timeline.
- **Aggregates** — tool usage and per-tool failure rate, spend by project, output by model.

"Active" is wall-clock time minus idle. A session you pick up again three days later spans
429 hours but holds about 3 hours of work; the raw span is shown underneath when the two
diverge. The threshold is 5 minutes, chosen by measuring: between 5 and 15 minutes the
totals barely move, so short gaps and real idle separate cleanly there.

Cost is computed from per-model rates including the cache multipliers (5-minute cache
writes at 1.25×, 1-hour at 2×, reads at 0.1×), so the numbers reflect what prompt caching
actually saved you.

---

## Quick start

### With Node

Requires **Node 22.5 or newer** — the app uses the built-in `node:sqlite`, so there are no
native modules to compile and no runtime dependencies beyond Next.js and React.

```bash
git clone https://github.com/PYSoYa/agent-trace-viewer.git
cd agent-trace-viewer
pnpm install
pnpm dev
```

Open http://localhost:3000. It finds your logs automatically and indexes them on first
load; there is nothing to configure.

### With Docker

```bash
docker compose up --build
```

Open http://localhost:3000. Compose mounts `~/.claude/projects` **read-only** and keeps the
parsed index in a named volume.

To point at logs somewhere else, or to use a different port:

```bash
CLAUDE_PROJECTS_DIR=/path/to/logs PORT=8080 docker compose up --build
```

---

## Configuration

Both are optional; the defaults work for a normal Claude Code install.

| Variable | Default | Purpose |
|---|---|---|
| `CLAUDE_PROJECTS_DIR` | `~/.claude/projects` | Where to read session logs from |
| `TRACE_DATA_DIR` | `./.data` | Where to keep the parsed index |

The index is a cache. Delete it and it rebuilds from the logs. When the schema changes the
app detects it via `PRAGMA user_version` and rebuilds automatically, rather than leaving a
stale cache in place.

---

## Privacy

**Everything stays on your machine.** The app makes no network calls; it reads local files
and serves a local page.

Your logs contain whatever your agent saw — source code, file paths, command output, and
secrets that happened to appear in a terminal. Two layers handle that:

**Secret masking, always on.** Anything shaped like a credential is masked before it
reaches the page: provider API keys, GitHub tokens, AWS keys, JWTs, `Authorization` headers,
private key blocks, URL credentials, and `SECRET=`-style assignments. The key name survives
so you can still tell *what* was hidden. Masking happens at render time — the index keeps
the original, because it has to stay reproducible from the logs.

**Demo mode, for screenshots.** Toggle it in the header. Project names, repositories,
branches, titles, and file paths become stable pseudonyms; prose is replaced by its length;
PR links are dropped; search snippets are withheld. Metrics and structure — token counts, cache hit rate, timings, tool
names, step shape — are untouched, so the screenshot still shows something real.

Even so: don't expose the server beyond localhost.

The test fixtures in this repository are synthetic. No real session data is committed.

---

## How it works

```
lib/trace/       Source-agnostic trace model + the TraceAdapter interface
  adapters/      claude-code.ts — the JSONL parser
lib/db/          Incremental indexer and queries on node:sqlite
lib/pricing.ts   Per-model rates and cache multipliers
app/             Next.js App Router pages
```

Indexing is incremental: a file is re-parsed only when its mtime or size changes, so
starting the app with tens of megabytes of logs costs milliseconds after the first run.

Search uses SQLite's built-in FTS5 with the `unicode61` tokenizer, which splits on
whitespace and punctuation — so English words, path fragments, and space-separated Korean
all match. Queries run in single-digit milliseconds over ~13k indexed steps. User input is
never passed to FTS5 as syntax: each word is quoted and joined with `AND`, so searching for
`AND` or `build*` finds those literal strings.

Parsing sits behind a `TraceAdapter` interface, so another agent's log format needs only a
new adapter, not changes to the indexer or the UI.

---

## Notes on the log format

Three things about the JSONL are easy to get wrong, and each one produces plausible-looking
but incorrect numbers rather than an error. They are worth knowing if you plan to parse
these logs yourself.

**One assistant message spans several lines.** A single response is written as up to four
lines sharing a `message.id`, and **every one of them repeats the same `usage` object**.
Summing per line inflates token counts — by 2.5× on the session used to develop this.
Deduplicate on `message.id`.

**Most of your tokens are attached to thinking blocks.** `usage` rides on the *first* line
of a message, and that line almost always contains only a `thinking` block. A parser that
handles just `text` and `tool_use` drops that line, and the usage with it — losing about
68% of all output tokens. Keep thinking blocks as steps, and carry the usage forward to
whichever step comes first.

**Subagents share their parent's `sessionId`.** Subagent traces live in a separate file at
`<session-id>/subagents/agent-*.jsonl`, but the `sessionId` inside is the parent's. Keying
on it directly makes the subagent overwrite the parent session.

On Opus 5, `thinking.display` defaults to `omitted`, so thinking *content* is recorded as an
empty string. The token counts survive, so you can see how much a step thought about, just
not what it thought.

---

## Development

```bash
pnpm test        # parser and pricing regression tests (node:test)
pnpm typecheck
pnpm lint
pnpm build
```

The tests pin the invariants behind the three parsing traps above — most importantly that
**the sum of per-step tokens equals the session total**. Each was verified by reintroducing
the original bug and confirming the suite goes red.

Fixtures are hand-written JSONL under `lib/trace/adapters/__fixtures__/`.

---

## License

MIT — see [LICENSE](./LICENSE).
