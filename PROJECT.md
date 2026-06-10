# Markdown SQL Lint — project notes

A small VS Code extension Mihai wrote, **published to the marketplace** (publisher
`MB42`, current version `0.2.0`). It's a *pet project* in the sense of **unofficial** —
not part of any sanctioned Saxion deliverable — but it does a real job: it supports the
**SQL module** assignments (notably **sql-practice**), where course material and homework
embed SQL inside Markdown code fences.

## What it does

Live PostgreSQL syntax checking for ` ```sql ` / ` ```postgresql ` / ` ```pgsql ` code
blocks in Markdown. Errors show as red squiggles **as you type** — powered by
[libpg_query](https://github.com/pganalyze/libpg_query), the actual PostgreSQL parser
extracted from the server (the same C library behind the Ruby `pg_query` gem), shipped
here as a bundled **pure-WASM** parser. No Python, no database, nothing to install.

Three layers of feedback:
1. **Real syntax errors** — exact line/column, matching what `psql` would report (one
   error per block; the parser stops at the first).
2. **Heuristic hints** — trailing comma before `FROM`, keyword typos (`SELEC` →
   "Did you mean SELECT?"), unclosed parens, reserved words as table names.
3. **Style suggestions** (blue squiggles, never red, prefixed "Suggestion:") — keyword
   case, terminating semicolons, `SELECT *`. Defaults follow
   [sqlstyle.guide](https://www.sqlstyle.guide); each rule is configurable or off, with
   one-click lightbulb fixes. House style can be committed per-workspace via
   `.vscode/settings.json`, like a `.rubocop.yml`.

## Why it exists

Every SQL linter wants a `.sql` file
([SQLFluff explicitly declined Markdown support](https://github.com/sqlfluff/sqlfluff/issues/6604));
"inline SQL" extensions target strings in Python/Go/JS, not Markdown fences. Nothing
linted SQL-in-Markdown, which is exactly the shape of the SQL-module course material —
so Mihai built it.

## Stack & layout

- **TypeScript**, compiled with `tsc` to `out/`; targets VS Code `^1.85.0`.
- `src/` — `extension.ts` (activation + wiring), `fences.ts` (find SQL fences),
  `hints.ts` (heuristic hints), `rules.ts` (style suggestions).
- Dependency: `libpg-query@17.7.3` (WASM PostgreSQL parser).
- Scripts: `npm run compile` / `watch` / `test` (`npm run compile && node test/run.js`).
- Packaged `.vsix` artifacts checked in (0.1.0 → 0.2.0).

## Settings

| Setting | Default | Purpose |
|---|---|---|
| `markdownSqlLint.enable` | `true` | Master switch |
| `markdownSqlLint.fenceLanguages` | `["sql","postgres","postgresql","pgsql"]` | Fence info strings treated as SQL |
| `markdownSqlLint.debounceMs` | `300` | Idle delay before re-linting |
| `markdownSqlLint.rules.keywordCase` | `"upper"` | Suggest `upper`/`lower` keyword case, or `off` |
| `markdownSqlLint.rules.requireSemicolon` | `true` | Suggest terminating semicolons |
| `markdownSqlLint.rules.discourageSelectStar` | `true` | Suggest explicit columns over `SELECT *` |

## Scope (by design, for now)

- **Syntax only** — no schema awareness (`SELECT * FROM tabel_typo` parses fine).
  Semantic checks would need a live DB; planned as opt-in.
- **PostgreSQL dialect** — MySQL/SQLite-specific syntax gets flagged.

## Hosting

Dual-hosted. The local repo has two remotes:

- `origin` → `git@gitlab.com:saxionnl/42/markdown-sql-lint.git` — internal Saxion mirror
- `github` → `github.com/bluemihai/markdown-sql-lint` — the public home

The published **`repository.url` in `package.json` points at GitHub** (the Marketplace
listing needs a publicly reachable link, and it matches README/CONTRIBUTING). Keep it
that way on future publishes; the GitLab remote is just an internal mirror.
