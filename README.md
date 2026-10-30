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
- A heuristic `Hint:` after the error for common mistakes — trailing comma before `FROM`, keyword
  typos (`SELEC` → "Did you mean SELECT?"), unclosed parentheses, reserved words used
  as table names
- **Style suggestions** (blue squiggles, clearly worded as suggestions — never errors):
  keyword capitalization, terminating semicolons, `JOIN … ON` on one line, qualified
  column names inside subqueries, optionally `SELECT *`. Defaults follow
  [sqlstyle.guide](https://www.sqlstyle.guide); every rule is configurable or can be
  switched off, and safe fixes are offered as one-click lightbulb actions
- **Format SQL blocks** — the command palette entry *Markdown SQL Lint: Format SQL blocks*,
  also registered as a Markdown formatter so *Format Document* (⇧⌥F) works. It applies
  every safe style fix (keyword case, terminating semicolons, joining an `ON` line to
  its `JOIN`) to each SQL block that
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
| `markdownSqlLint.rules.joinOnSameLine` | `true` | Suggest keeping a `JOIN` and its `ON` on the same line |
| `markdownSqlLint.rules.qualifyColumnsInSubqueries` | `true` | Suggest `staff.staff_id` (or an alias) for bare column names inside a subquery — see below |

### Why qualify columns in subqueries?

```sql
SELECT DISTINCT customer_id
FROM payment
WHERE staff_id = (SELECT staff_id FROM staff WHERE first_name = 'Mike')
```

`staff` has no `staff_id` (its key is `id`), yet PostgreSQL runs this without an error:
the bare `staff_id` inside the subquery resolves to the *outer* query's `payment.staff_id`,
so the filter keeps every row. The parser cannot know your schema, so the rule flags the
shape — every unqualified column inside `= (SELECT …)`, `IN (SELECT …)` or
`EXISTS (SELECT …)` — because `staff.staff_id` would have produced a real error message.
This may or may not be a bug: if the inner table does have the column, the query is fine
and you can ignore the suggestion. The squiggle's Quick Fix (Cmd+. / Ctrl+.) offers
**Qualify as `staff.staff_id`** when the subquery reads from exactly one table (its alias
if you wrote one; not offered with a JOIN, several tables or a derived table), and
**Ignore on this line**, which adds `-- noqa: qualify-in-subquery` to that line (see
below). Qualifying is only right if that table really has the column; if it doesn't, the
query now fails with "column does not exist", which is the point. Derived tables in `FROM`
are left alone.

The rule stays quiet when the statement itself shows the column must come from the
subquery's own tables (no schema is read, only that statement's text):

- the same column is written qualified on an inner table elsewhere in the statement
  (`s.staff_id`): if `staff` lacked it, that would already be a real error;
- a derived table in the subquery's `FROM` outputs that name
  (`FROM (SELECT customer_id, COUNT(id) …) AS d` outputs `count`);
- every table of every outer query level is also read inside the subquery
  (`WHERE length > (SELECT AVG(length) FROM film)` inside `… FROM film`): an outer table
  could only supply the column if the inner copy had it too, and then the inner one wins.

Style rules are *suggestions by design*: they render as blue info squiggles (never red),
their messages start with "Suggestion:", and they only appear on blocks that already
parse — a block with a syntax error shows exactly one problem, the error.

Like a `.rubocop.yml`, you can commit house style with a project: put the
`markdownSqlLint.rules.*` keys in the workspace's `.vscode/settings.json` and everyone
opening that folder gets the same conventions.

### Silencing one line

When a suggestion is right in general but wrong here, end the line with a `noqa` comment —
ordinary SQL, so the block still runs anywhere:

```sql
SELECT DISTINCT customer_id
FROM payment
WHERE staff_id = (SELECT id FROM staff  -- noqa: qualify-in-subquery
                  WHERE first_name = 'Mike');
```

- `-- noqa: <rule-id>` silences that rule's findings on that line; several with commas
  (`-- noqa: keyword-case, require-semicolon`)
- bare `-- noqa` silences every style rule on that line
- `/* noqa: … */` works the same; `noqa` is case-insensitive, and a `noqa` inside a
  string literal is just text
- syntax errors are never silenced — only the suggestions are

Rule ids: `keyword-case`, `require-semicolon`, `join-on-same-line`, `select-star`,
`qualify-in-subquery`.

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
