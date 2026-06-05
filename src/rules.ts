/**
 * Style rules — formatting suggestions beyond syntax errors. Defaults follow
 * https://www.sqlstyle.guide (minus its "river" alignment). Pure module,
 * unit-testable; severity and quick-fix wiring live in extension.ts.
 *
 * Design principle (see CONTRIBUTING.md): no false positives. A rule that
 * can't be checked reliably at the token level doesn't belong here.
 */

import { stripLiterals } from './hints';

export interface StyleConfig {
  /** 'upper' | 'lower' | 'off' */
  keywordCase: string;
  requireSemicolon: boolean;
  discourageSelectStar: boolean;
}

export const DEFAULT_STYLE: StyleConfig = {
  keywordCase: 'upper',
  requireSemicolon: true,
  discourageSelectStar: true,
};

export interface StyleFinding {
  /** 0-based character offset into the block's SQL. */
  offset: number;
  length: number;
  message: string;
  ruleId: string;
  /** Optional one-click fix: replace [offset, offset+length) with newText. */
  fix?: { offset: number; length: number; newText: string; title: string };
}

/**
 * Keywords checked for capitalization. Deliberately omits words that are
 * plausible column names in teaching schemas (TIME, DATE, TYPE, NAME, KEY
 * is kept only because PRIMARY KEY/FOREIGN KEY are so common — flagging a
 * column actually named "key" is the accepted trade-off).
 */
const CASE_KEYWORDS = new Set([
  'SELECT', 'FROM', 'WHERE', 'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET',
  'DELETE', 'CREATE', 'TABLE', 'DROP', 'ALTER', 'ADD', 'COLUMN',
  'PRIMARY', 'KEY', 'FOREIGN', 'REFERENCES', 'CONSTRAINT', 'UNIQUE',
  'DEFAULT', 'NOT', 'NULL', 'AND', 'OR', 'IN', 'IS', 'BETWEEN', 'LIKE',
  'ILIKE', 'EXISTS', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'JOIN',
  'INNER', 'LEFT', 'RIGHT', 'FULL', 'OUTER', 'CROSS', 'ON', 'GROUP',
  'BY', 'ORDER', 'HAVING', 'LIMIT', 'OFFSET', 'UNION', 'ALL', 'DISTINCT',
  'AS', 'ASC', 'DESC', 'RETURNING', 'TRUE', 'FALSE', 'SERIAL', 'TEXT',
  'INTEGER', 'INT', 'BIGINT', 'SMALLINT', 'BOOLEAN', 'TIMESTAMP',
  'NUMERIC', 'DECIMAL', 'VARCHAR', 'CASCADE', 'IF', 'USING',
]);

export function checkStyle(sql: string, config: StyleConfig): StyleFinding[] {
  const findings: StyleFinding[] = [];
  const stripped = stripLiterals(sql);

  if (config.keywordCase === 'upper' || config.keywordCase === 'lower') {
    const wantUpper = config.keywordCase === 'upper';
    const word = /[A-Za-z_][A-Za-z0-9_]*/g;
    let m;
    while ((m = word.exec(stripped)) !== null) {
      const upper = m[0].toUpperCase();
      if (!CASE_KEYWORDS.has(upper)) {
        continue;
      }
      const expected = wantUpper ? upper : m[0].toLowerCase();
      if (m[0] !== expected) {
        findings.push({
          offset: m.index,
          length: m[0].length,
          message: `Suggestion: SQL keywords in ${wantUpper ? 'uppercase' : 'lowercase'} (${expected}).`,
          ruleId: 'keyword-case',
          fix: { offset: m.index, length: m[0].length, newText: expected, title: `Change to ${expected}` },
        });
      }
    }
  }

  if (config.requireSemicolon) {
    const trimmed = stripped.trimEnd();
    if (trimmed.length > 0 && !trimmed.endsWith(';')) {
      const at = trimmed.length - 1;
      findings.push({
        offset: at,
        length: 1,
        message: 'Suggestion: terminate the statement with a semicolon.',
        ruleId: 'require-semicolon',
        fix: { offset: at + 1, length: 0, newText: ';', title: 'Add terminating semicolon' },
      });
    }
  }

  if (config.discourageSelectStar) {
    const star = /\bSELECT\s+\*/gi;
    let m;
    while ((m = star.exec(stripped)) !== null) {
      const starAt = m.index + m[0].length - 1;
      findings.push({
        offset: starAt,
        length: 1,
        message: 'Suggestion: name the columns you need instead of SELECT *.',
        ruleId: 'select-star',
        // no auto-fix: only the author knows which columns they need
      });
    }
  }

  return findings;
}
