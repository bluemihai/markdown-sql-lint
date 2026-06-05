/**
 * Pure logic: extracting SQL code fences from Markdown text and mapping
 * parser error offsets back to document positions. No vscode imports,
 * so this module is unit-testable with plain Node.
 */

export interface SqlFence {
  /** The fence's SQL content, lines joined verbatim with '\n'. */
  sql: string;
  /** 0-based document line index of the first content line (the line after the opening fence). */
  startLine: number;
}

/**
 * CommonMark-ish fence scanner. Handles ``` and ~~~ fences (3+ chars,
 * up to 3 spaces of indentation), matching closers of the same character
 * and at least the same length. The fence's language is the first word
 * of the info string, compared case-insensitively against `languages`.
 *
 * Content lines are kept verbatim (indentation included) so that
 * character offsets into `sql` map 1:1 onto document columns.
 */
export function extractSqlFences(text: string, languages: string[]): SqlFence[] {
  const langs = new Set(languages.map((l) => l.toLowerCase()));
  const lines = text.split(/\r?\n/);
  const fences: SqlFence[] = [];

  let i = 0;
  while (i < lines.length) {
    const open = lines[i].match(/^ {0,3}(`{3,}|~{3,})\s*(\S*)/);
    if (!open) {
      i++;
      continue;
    }
    const marker = open[1];
    // CommonMark: a backtick fence's info string may not contain backticks.
    if (marker[0] === '`' && open[2].includes('`')) {
      i++;
      continue;
    }
    const lang = open[2].toLowerCase();
    const closer = new RegExp(`^ {0,3}${marker[0]}{${marker.length},}\\s*$`);
    const contentStart = i + 1;
    let j = contentStart;
    while (j < lines.length && !closer.test(lines[j])) {
      j++;
    }
    if (langs.has(lang)) {
      fences.push({
        sql: lines.slice(contentStart, j).join('\n'),
        startLine: contentStart,
      });
    }
    i = j + 1; // skip past the closing fence (or EOF)
  }
  return fences;
}

export interface BlockPosition {
  /** 0-based line index within the block. */
  line: number;
  /** 0-based character column. */
  character: number;
}

/** Convert a 0-based character offset within `sql` to a line/column position. */
export function offsetToPosition(sql: string, offset: number): BlockPosition {
  const clamped = Math.max(0, Math.min(offset, sql.length));
  const before = sql.slice(0, clamped);
  const lastNewline = before.lastIndexOf('\n');
  return {
    line: before.split('\n').length - 1,
    character: clamped - (lastNewline + 1),
  };
}

/**
 * Length of the token at `offset`, so the diagnostic squiggle covers the
 * offending word (e.g. all of `FROM`) instead of a single character.
 */
export function tokenLengthAt(sql: string, offset: number): number {
  const match = sql.slice(offset).match(/^[A-Za-z_][A-Za-z0-9_]*|^[0-9]+|^\S/);
  return match ? match[0].length : 1;
}
