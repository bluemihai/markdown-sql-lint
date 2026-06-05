# Contributing

Contributions welcome — bug reports, hint heuristics, and dialect ideas especially.

## Setup

```bash
npm install
npm test        # compile + run unit/e2e tests (plain Node, no VS Code needed)
```

The interesting code is small:

- `src/fences.ts` — pure logic: extracting ```` ```sql ```` fences from Markdown,
  mapping parser offsets to document positions
- `src/hints.ts` — pure logic: heuristic `Hint:` lines for common mistakes
- `src/extension.ts` — VS Code wiring: diagnostics, debouncing, configuration
- `test/run.js` — the test suite; runs in plain Node, no VS Code required

Most changes (new hints, fence edge cases) can be developed and tested entirely
with `npm test` — add a test, make it pass.

## Trying the extension before it's packaged

VS Code extensions are tested in an **Extension Development Host**: a second,
sandboxed VS Code window that loads the unpublished extension from this folder.
This is only a development ritual — end users never see any of this; they install
the packaged extension and it just works.

Step by step:

1. Open **this folder** (the extension project) as the workspace root:
   `code /path/to/markdown-sql-lint`
2. In that window, press **F5** (macOS: **Fn+F5** if your function keys are media
   keys; or *Run → Start Debugging*).
3. A **second window** opens, titled *“[Extension Development Host]”*, with
   `sample/demo.md` loaded. **This window is the test sandbox** — the broken SQL
   blocks in `demo.md` should show red squiggles, and the Problems panel (⇧⌘M)
   lists them with source `markdown-sql-lint`.
4. Edit code → stop debugging → press F5 again in the **first** window to test
   the change. (The compile step runs automatically before each launch.)

Gotchas:

- F5 only works from the window that has *this folder* open as its root —
  pressing it in the dev host window (or with a parent folder open) makes
  VS Code try to “debug the current file” and offer to find a Markdown debugger.
  Cancel, switch to the project window, F5 there.
- Multiple dev host windows can pile up; close stale ones before judging
  whether a change worked.
- `markdown-sql-lint: activated` is logged to the *project* window's Debug
  Console on every successful launch.

## Design principles

- **No false positives.** A wrong squiggle teaches students to ignore squiggles.
  Hints are conservative by design — when in doubt, emit the bare parser error.
- **Zero install for users.** The parser is pure WASM, bundled with the
  extension. Don't add dependencies that require Python, native compilation,
  or a running database (the planned semantic layer will be strictly opt-in).
- **Keep logic pure and tested.** Anything that doesn't need the `vscode` API
  lives in its own module and gets covered in `test/run.js`.
