import * as vscode from 'vscode';
import { parse, SqlError, hasSqlDetails } from 'libpg-query';
import { extractSqlFences, offsetToPosition, tokenLengthAt } from './fences';
import { hintFor, tokenFromMessage } from './hints';

const SOURCE = 'markdown-sql-lint';

let diagnostics: vscode.DiagnosticCollection;
const pendingLints = new Map<string, NodeJS.Timeout>();
/** Guards against an older async lint overwriting a newer one's results. */
const lintGenerations = new Map<string, number>();

function config() {
  const cfg = vscode.workspace.getConfiguration('markdownSqlLint');
  return {
    enable: cfg.get<boolean>('enable', true),
    fenceLanguages: cfg.get<string[]>('fenceLanguages', ['sql', 'postgres', 'postgresql', 'pgsql']),
    debounceMs: cfg.get<number>('debounceMs', 300),
  };
}

async function lintDocument(doc: vscode.TextDocument): Promise<void> {
  if (doc.languageId !== 'markdown') {
    return;
  }
  const { enable, fenceLanguages } = config();
  if (!enable) {
    diagnostics.delete(doc.uri);
    return;
  }

  const key = doc.uri.toString();
  const generation = (lintGenerations.get(key) ?? 0) + 1;
  lintGenerations.set(key, generation);

  const fences = extractSqlFences(doc.getText(), fenceLanguages);
  const found: vscode.Diagnostic[] = [];

  for (const fence of fences) {
    if (fence.sql.trim() === '') {
      continue;
    }
    try {
      await parse(fence.sql);
    } catch (e) {
      if (!(e instanceof SqlError)) {
        throw e;
      }
      found.push(toDiagnostic(e, fence.sql, fence.startLine));
    }
  }

  // A newer lint started while we were awaiting the parser; let it win.
  if (lintGenerations.get(key) !== generation) {
    return;
  }
  diagnostics.set(doc.uri, found);
}

function toDiagnostic(error: SqlError, sql: string, startLine: number): vscode.Diagnostic {
  let range: vscode.Range;
  let message = error.message;
  const cursor = hasSqlDetails(error) ? error.sqlDetails.cursorPosition : undefined;
  if (typeof cursor === 'number' && cursor >= 0 && cursor <= sql.length) {
    const pos = offsetToPosition(sql, cursor);
    const line = startLine + pos.line;
    range = new vscode.Range(line, pos.character, line, pos.character + tokenLengthAt(sql, cursor));
    const token = tokenFromMessage(error.message);
    const hint = token !== undefined ? hintFor(sql, cursor, token) : undefined;
    if (hint) {
      message += `\nHint: ${hint}`;
    }
  } else {
    // No position info: flag the first non-empty line of the block.
    const lines = sql.split('\n');
    const idx = Math.max(0, lines.findIndex((l) => l.trim() !== ''));
    range = new vscode.Range(startLine + idx, 0, startLine + idx, lines[idx].length);
  }
  const diagnostic = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Error);
  diagnostic.source = SOURCE;
  return diagnostic;
}

function scheduleLint(doc: vscode.TextDocument): void {
  if (doc.languageId !== 'markdown') {
    return;
  }
  const key = doc.uri.toString();
  const existing = pendingLints.get(key);
  if (existing) {
    clearTimeout(existing);
  }
  pendingLints.set(
    key,
    setTimeout(() => {
      pendingLints.delete(key);
      void lintDocument(doc);
    }, config().debounceMs)
  );
}

export function activate(context: vscode.ExtensionContext): void {
  console.log('markdown-sql-lint: activated');
  diagnostics = vscode.languages.createDiagnosticCollection(SOURCE);
  context.subscriptions.push(
    diagnostics,
    vscode.workspace.onDidOpenTextDocument((doc) => void lintDocument(doc)),
    vscode.workspace.onDidChangeTextDocument((event) => scheduleLint(event.document)),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      diagnostics.delete(doc.uri);
      lintGenerations.delete(doc.uri.toString());
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('markdownSqlLint')) {
        for (const doc of vscode.workspace.textDocuments) {
          void lintDocument(doc);
        }
      }
    })
  );

  for (const doc of vscode.workspace.textDocuments) {
    void lintDocument(doc);
  }
}

export function deactivate(): void {
  for (const timer of pendingLints.values()) {
    clearTimeout(timer);
  }
  pendingLints.clear();
}
