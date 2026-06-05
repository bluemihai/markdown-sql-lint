# Markdown SQL Lint

Live PostgreSQL syntax checking for ```` ```sql ```` code blocks in Markdown files.

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

- Lints every ```` ```sql ```` / ```` ```postgresql ```` / ```` ```pgsql ```` fence on open and as you type (debounced)
- Real PostgreSQL syntax errors with exact positions, squiggle on the offending token
- Heuristic `Hint:` lines for common mistakes — trailing comma before `FROM`, keyword
  typos (`SELEC` → "Did you mean SELECT?"), unclosed parentheses, reserved words used
  as table names
- Multi-statement blocks supported
- Pure-WASM parser bundled with the extension — **no Python, no database, nothing to install**
- `~~~` fences, longer fence markers, and case-insensitive info strings all handled

## Settings

| Setting | Default | Description |
|---|---|---|
| `markdownSqlLint.enable` | `true` | Master switch |
| `markdownSqlLint.fenceLanguages` | `["sql", "postgres", "postgresql", "pgsql"]` | Fence info strings treated as SQL |
| `markdownSqlLint.debounceMs` | `300` | Idle delay before re-linting |

## Limitations (by design, for now)

- **Syntax only.** `SELECT * FROM tabel_with_typo` parses fine — the parser can't know
  your schema. Semantic checks (unknown table/column) would need a live database; planned
  as an opt-in feature.
- **One error per block.** The parser stops at the first syntax error in a block
  (subsequent blocks are still checked independently).
- **PostgreSQL dialect.** MySQL/SQLite-specific syntax will be flagged. Other dialects
  would need a different parser backend.

## Contributing

Bug reports, hint heuristics, and dialect ideas welcome — see
[CONTRIBUTING.md](https://github.com/bluemihai/markdown-sql-lint/blob/main/CONTRIBUTING.md)
for setup and the extension-testing workflow.

## License

MIT
