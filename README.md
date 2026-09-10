# Markdown SQL Lint

Live PostgreSQL syntax checking for ```` ```sql ```` code blocks in Markdown files —
including the psql layer: `\d`, `\dt staff`, `\c dbname` and pasted `sd42=#` prompts are
understood, not flagged.

Errors show up as red squiggles **as you type**, exactly like any other linter — powered by
[libpg_query](https://github.com/pganalyze/libpg_query), the *actual* PostgreSQL parser
extracted from the server source (the same library behind the `pg_query` Ruby gem).
That means the error messages match what `psql` would tell you, with accurate line and
column positions.

## Why

Course material, homework assignments, and documentation sometimes embed SQL in Markdown
code fences. Every SQL linter we could find wants a `.sql` file
([SQLFluff explicitly declined markdown support](https://github.com/sqlfluff/sqlfluff/issues/6604)),
and "inline SQL" extensions target strings inside Python/Go/JS — not Markdown.
This extension fills that gap.

## Features

- Lints every ```` ```sql ```` / ```` ```postgresql ```` / ```` ```pgsql ```` / ```` ```psql ```` fence on open and as you type (debounced)
- Real PostgreSQL syntax errors with exact positions, squiggle on the offending token
- **psql-aware.** A block is what you'd type into `psql`, so meta-commands (`\d`,
  `\dt staff`, `\timing on`, `\copy …`) and pasted prompts (`sd42=# `) are recognised
  and set aside before the SQL is parsed. Mistyped ones are flagged against psql's own
  command list: `\q;` ("not terminated with a semicolon"), `\D` ("case-sensitive"),
  `\dstaff` ("use `\d` followed by a space"), `\timeing` ("did you mean `\timing`?")
- Heuristic `Hint:` lines for common mistakes — trailing comma before `FROM`, keyword
  typos (`SELEC` → "Did you mean SELECT?"), unclosed parentheses, reserved words used
  as table names
- **Style suggestions** (blue squiggles, clearly worded as suggestions — never errors):
  keyword capitalization, terminating semicolons, optionally `SELECT *`. Defaults follow
  [sqlstyle.guide](https://www.sqlstyle.guide); every rule is configurable or can be
  switched off, and safe fixes are offered as one-click lightbulb actions
- **Format SQL blocks** — the command palette entry *Markdown SQL Lint: Format SQL blocks*,
  also registered as a Markdown formatter so *Format Document* (⇧⌥F) works. It applies
  every safe style fix (keyword case, terminating semicolons) to each SQL block that
  parses, and touches nothing else: no reflow, no changes outside the fences, blocks
  with a syntax error left alone
- Multi-statement blocks supported
- Pure-WASM parser bundled with the extension — **no Python, no database, nothing to install**
- `~~~` fences, longer fence markers, and case-insensitive info strings all handled

## Settings

| Setting | Default | Description |
|---|---|---|
| `markdownSqlLint.enable` | `true` | Master switch |
| `markdownSqlLint.fenceLanguages` | `["sql", "postgres", "postgresql", "pgsql", "psql"]` | Fence info strings treated as SQL |
| `markdownSqlLint.psqlCommands` | `"check"` | `check`: recognise psql meta-commands, flag unknown ones · `ignore`: recognise, never flag · `error`: pure SQL only, every meta-command is an error |
| `markdownSqlLint.debounceMs` | `300` | Idle delay before re-linting |
| `markdownSqlLint.rules.keywordCase` | `"upper"` | Suggest `upper`/`lower` keyword case, or `off` |
| `markdownSqlLint.rules.requireSemicolon` | `true` | Suggest terminating semicolons |
| `markdownSqlLint.rules.discourageSelectStar` | `false` | Suggest listing columns instead of `SELECT *` (opt-in: `SELECT *` is normal while exploring) |

Style rules are *suggestions by design*: they render as blue info squiggles (never red),
their messages start with "Suggestion:", and they only appear on blocks that already
parse — a block with a syntax error shows exactly one problem, the error.

Like a `.rubocop.yml`, you can commit house style with a project: put the
`markdownSqlLint.rules.*` keys in the workspace's `.vscode/settings.json` and everyone
opening that folder gets the same conventions.

## Limitations (by design, for now)

- **Syntax only.** `SELECT * FROM tabel_with_typo` parses fine — the parser can't know
  your schema. Semantic checks (unknown table/column) would need a live database; planned
  as an opt-in feature.
- **One error per block.** The parser stops at the first syntax error in a block
  (subsequent blocks are still checked independently).
- **PostgreSQL dialect.** MySQL/SQLite-specific syntax will be flagged. Other dialects
  would need a different parser backend.
- **psql meta-commands are checked by name only.** `\d staff` is accepted whether or not
  `staff` exists; a meta-command must start its line (`SELECT 1 \g` is not recognised).

## Contributing

Bug reports, hint heuristics, and dialect ideas welcome — see
[CONTRIBUTING.md](https://github.com/bluemihai/markdown-sql-lint/blob/main/CONTRIBUTING.md)
for setup and the extension-testing workflow.

## License

MIT
