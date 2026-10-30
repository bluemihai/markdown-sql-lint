/**
 * Style rules — formatting suggestions beyond syntax errors. Defaults follow
 * https://www.sqlstyle.guide (minus its "river" alignment, and with JOIN … ON
 * kept on one line where the guide breaks before ON). Pure module,
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
  joinOnSameLine: boolean;
  qualifyColumnsInSubqueries: boolean;
}

export const DEFAULT_STYLE: StyleConfig = {
  keywordCase: 'upper',
  requireSemicolon: true,
  discourageSelectStar: false,
  joinOnSameLine: true,
  qualifyColumnsInSubqueries: true,
};

/** A libpg-query parse result (`await parse(sql)`), walked as plain JSON. */
export type ParseTree = { stmts?: unknown[] } | undefined;

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

/**
 * Apply every finding's fix to `sql`, right to left so earlier offsets stay
 * valid. This is what "Format SQL blocks" does — only the safe, one-click
 * fixes, never a reflow of the SQL itself.
 */
export function applyFixes(sql: string, findings: StyleFinding[]): string {
  const fixes = findings
    .filter((f): f is StyleFinding & { fix: NonNullable<StyleFinding['fix']> } => f.fix !== undefined)
    .sort((a, b) => b.fix.offset - a.fix.offset);
  let out = sql;
  for (const { fix } of fixes) {
    out = out.slice(0, fix.offset) + fix.newText + out.slice(fix.offset + fix.length);
  }
  return out;
}

/**
 * Blank comments only, keeping string literals and quoted identifiers as
 * (opaque) content, so "the end of the last statement" includes a trailing
 * literal. Literals are replaced first so a `--` inside one is not a comment.
 */
function maskComments(sql: string): string {
  return sql
    .replace(/'(?:[^']|'')*'/g, (m) => 'x'.repeat(m.length))
    .replace(/"(?:[^"]|"")*"/g, (m) => 'x'.repeat(m.length))
    .replace(/--[^\n]*/g, (m) => ' '.repeat(m.length))
    .replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length));
}

/**
 * Style check. Token-level rules need only `sql`; the AST rule
 * (qualify-in-subquery) runs only when the caller also passes the parse
 * tree, since parsing is async and callers already have it in hand.
 */
export function checkStyle(sql: string, config: StyleConfig, tree?: ParseTree): StyleFinding[] {
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
      // `stripped` decides WHETHER a terminator exists (literals and comments
      // can't hide one), but it blanks literals to spaces — so a trailing
      // 'Groucho' would be trimmed away and the fix would land after LIKE.
      // Position the fix on a mask that keeps literals as content.
      const at = maskComments(sql).trimEnd().length - 1;
      findings.push({
        offset: at,
        length: 1,
        message: 'Suggestion: terminate the statement with a semicolon.',
        ruleId: 'require-semicolon',
        fix: { offset: at + 1, length: 0, newText: ';', title: 'Add terminating semicolon' },
      });
    }
  }

  if (config.joinOnSameLine) {
    const join = /\bJOIN\b/gi;
    // The first of these after JOIN decides: ON → check it; anything else
    // (USING, CROSS/NATURAL JOIN running into WHERE, a subquery's paren, the
    // next JOIN) → not this rule's business.
    const next = /\b(?:ON|USING|JOIN|WHERE|GROUP|ORDER|HAVING|LIMIT|UNION|SELECT)\b|[();]/gi;
    let m;
    while ((m = join.exec(stripped)) !== null) {
      const joinEnd = m.index + m[0].length;
      next.lastIndex = joinEnd;
      const n = next.exec(stripped);
      if (!n || n[0].toUpperCase() !== 'ON') {
        continue;
      }
      const segment = sql.slice(joinEnd, n.index);
      if (!segment.includes('\n')) {
        continue;
      }
      const finding: StyleFinding = {
        offset: n.index,
        length: 2,
        message: 'Suggestion: keep JOIN and its ON on the same line.',
        ruleId: 'join-on-same-line',
      };
      // Fix only the simple case: one line break, no comment that the join
      // would swallow. Touching only whitespace keeps it clear of keyword fixes.
      const breaks = [...segment.matchAll(/[ \t]*\n\s*/g)];
      if (breaks.length === 1 && !/--|\/\*/.test(segment)) {
        const at = joinEnd + breaks[0].index!;
        finding.fix = { offset: at, length: breaks[0][0].length, newText: ' ', title: 'Join the ON line to the JOIN line' };
      }
      findings.push(finding);
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
        message: 'Suggestion: consider listing the columns you need; SELECT * is fine while exploring.',
        ruleId: 'select-star',
        // no auto-fix: only the author knows which columns they need
      });
    }
  }

  if (config.qualifyColumnsInSubqueries && tree) {
    findings.push(...checkSubqueryQualification(sql, tree));
  }

  return applyNoqa(sql, findings);
}

/** Every style rule id, as written in a `-- noqa: <rule-id>` comment. */
export const RULE_IDS = ['keyword-case', 'require-semicolon', 'join-on-same-line', 'select-star', 'qualify-in-subquery'] as const;

/**
 * Per-line suppression: a `-- noqa: rule-a, rule-b` (or `/* noqa … *\/`) comment
 * drops the named rules' findings on its line; a bare `noqa` drops every
 * style finding on that line. Only style findings pass through here, so a
 * parse error can never be silenced. One left-to-right scan over literals,
 * quoted identifiers and comments keeps a `-- noqa` inside a string literal
 * from counting (and an apostrophe inside a comment from opening a literal).
 */
function applyNoqa(sql: string, findings: StyleFinding[]): StyleFinding[] {
  if (!/noqa/i.test(sql)) {
    return findings;
  }
  const byLine = new Map<number, Set<string> | 'all'>();
  for (const { line, rules: named } of noqaComments(sql)) {
    if (!named) {
      byLine.set(line, 'all');
      continue;
    }
    const current = byLine.get(line);
    if (current === 'all') {
      continue;
    }
    const rules = current ?? new Set<string>();
    for (const id of named.split(',')) {
      rules.add(id.trim().toLowerCase());
    }
    byLine.set(line, rules);
  }
  if (byLine.size === 0) {
    return findings;
  }
  return findings.filter((f) => {
    const rules = byLine.get(lineOf(sql, f.offset));
    return !(rules === 'all' || rules?.has(f.ruleId));
  });
}

/** `'…'`, `"…"`, `-- …` and `/* … *\/`, scanned left to right so each hides the others' markers. */
const LEXICAL_TOKEN = /'(?:[^']|'')*'|"(?:[^"]|"")*"|--[^\n]*|\/\*[\s\S]*?\*\//g;
const NOQA = /\bnoqa\b(?:\s*:\s*([A-Za-z0-9_-]+(?:\s*,\s*[A-Za-z0-9_-]+)*))?/i;

interface NoqaComment {
  /** 0-based line the comment starts on (the line it silences). */
  line: number;
  /** The rule list as written (`keyword-case, select-star`), or undefined for a bare `noqa`. */
  rules?: string;
  /** Character offset just past the rule list (or past the bare `noqa`). */
  end: number;
}

/** Every `noqa` comment in `sql`; a `noqa` inside a string literal or quoted identifier is not one. */
function noqaComments(sql: string): NoqaComment[] {
  const out: NoqaComment[] = [];
  const token = new RegExp(LEXICAL_TOKEN.source, 'g');
  let m;
  while ((m = token.exec(sql)) !== null) {
    if (!m[0].startsWith('--') && !m[0].startsWith('/*')) {
      continue;
    }
    const found = NOQA.exec(m[0]);
    if (found) {
      out.push({ line: lineOf(sql, m.index), rules: found[1], end: m.index + found.index + found[0].length });
    }
  }
  return out;
}

/**
 * The "Ignore on this line" quick fix for a finding: the edit that adds its
 * rule to a `noqa` comment on the finding's line, so the next lint drops it.
 * Appends to an existing `-- noqa: …` list when the line has one, otherwise
 * ends the line with `  -- noqa: <rule-id>` (after any trailing comment, which
 * the `--` then simply continues). Undefined when the line is already silenced
 * for this rule, or when it ends inside a multi-line string literal (a comment
 * there would become part of the string).
 */
export function noqaEdit(sql: string, finding: StyleFinding): { offset: number; length: number; newText: string; title: string } | undefined {
  const line = lineOf(sql, finding.offset);
  const lineStart = sql.lastIndexOf('\n', finding.offset - 1) + 1;
  const nl = sql.indexOf('\n', finding.offset);
  const lineEnd = nl === -1 ? sql.length : nl;
  const title = `Ignore on this line (-- noqa: ${finding.ruleId})`;

  const existing = noqaComments(sql).filter((c) => c.line === line);
  if (existing.some((c) => !c.rules || c.rules.split(',').some((id) => id.trim().toLowerCase() === finding.ruleId))) {
    return undefined;
  }
  const named = existing.find((c) => c.rules);
  if (named) {
    return { offset: named.end, length: 0, newText: `, ${finding.ruleId}`, title };
  }

  const token = new RegExp(LEXICAL_TOKEN.source, 'g');
  let m;
  while ((m = token.exec(sql)) !== null && m.index < lineEnd) {
    const isLiteral = m[0].startsWith("'") || m[0].startsWith('"');
    if (isLiteral && m.index + m[0].length > lineEnd) {
      return undefined;
    }
  }
  const trailing = /[ \t]*$/.exec(sql.slice(lineStart, lineEnd))!;
  const at = lineStart + trailing.index;
  return { offset: at, length: lineEnd - at, newText: `  -- noqa: ${finding.ruleId}`, title };
}

/** 0-based line of a character offset into `sql`. */
function lineOf(sql: string, offset: number): number {
  let line = 0;
  for (let i = 0; i < offset && i < sql.length; i++) {
    if (sql.charCodeAt(i) === 10) {
      line++;
    }
  }
  return line;
}

type AstNode = Record<string, any>;

/**
 * Bare column names inside a subquery (a SubLink's subselect: `= (SELECT …)`,
 * `IN (SELECT …)`, `EXISTS (SELECT …)`) of a query that has its own FROM.
 * `WHERE staff_id = (SELECT staff_id FROM staff …)` runs without an error when
 * `staff` has no `staff_id`: the bare name falls through to the outer query's
 * column, the filter keeps every row, and nobody sees a message. A parser can't
 * know the schema, so the rule flags the shape; qualifying the name turns the
 * silent fall-through into a real error. Applied at every nesting level; a
 * derived table in FROM is not a SubLink and is left alone.
 */
function checkSubqueryQualification(sql: string, tree: ParseTree): StyleFinding[] {
  const findings: StyleFinding[] = [];
  const toCharOffset = byteToCharOffset(sql);

  const flagColumn = (ref: AstNode, table: TableHint | undefined) => {
    const fields: AstNode[] = ref.fields ?? [];
    if (fields.length !== 1 || !fields[0].String || typeof ref.location !== 'number' || ref.location < 0) {
      return; // `t.col` / `t.*` are qualified; `*` is not a column
    }
    const col: string = fields[0].String.sval;
    const offset = toCharOffset(ref.location);
    const token = sql.slice(offset).match(/^"(?:[^"]|"")*"|^[A-Za-z_][A-Za-z0-9_$]*/);
    const owner = table === undefined ? "one of the subquery's tables" : `\`${table.name}\``;
    const prefix =
      table === undefined
        ? `write it as \`table.${col}\` (the right table or alias)`
        : table.isAlias
          ? `write \`${table.name}.${col}\``
          : `write \`${table.name}.${col}\` (or use an alias)`;
    const article = /^[aeiou]/i.test(col) ? 'an' : 'a';
    // Three short lines for the hover: what it is (a hint), why it matters, what to do.
    findings.push({
      offset,
      length: token ? token[0].length : col.length,
      message:
        `Suggestion, worth a quick check (not an error): \`${col}\` has no table prefix.\n` +
        `If ${owner} has ${article} \`${col}\` column, this is fine. If not, PostgreSQL silently uses the outer query's \`${col}\` instead, and the query still runs without an error.\n` +
        `To be sure, ${prefix}. Or, if you know it's fine, ignore this line with Quick Fix (Cmd+. / Ctrl+.).`,
      ruleId: 'qualify-in-subquery',
      // no auto-fix that qualifies: only the author knows which table the column was meant to come from.
      // The extension offers "Ignore on this line" via noqaEdit instead.
    });
  };

  // `scope.select` is the SelectStmt we are inside; `scope.flag` says whether
  // its bare columns are suspects (it is a SubLink subselect of a query that has
  // a FROM). Every SelectStmt opens its own scope, so nesting works per level.
  const visit = (node: unknown, scope: { select?: AstNode; flag: boolean; table?: TableHint }): void => {
    if (Array.isArray(node)) {
      for (const item of node) {
        visit(item, scope);
      }
      return;
    }
    if (node === null || typeof node !== 'object') {
      return;
    }
    const n = node as AstNode;
    if (n.ColumnRef) {
      if (scope.flag) {
        flagColumn(n.ColumnRef, scope.table);
      }
      return;
    }
    if (n.SubLink) {
      visit(n.SubLink.testexpr, scope);
      const sub: AstNode | undefined = n.SubLink.subselect?.SelectStmt;
      if (sub) {
        const outerHasFrom = Array.isArray(scope.select?.fromClause) && scope.select!.fromClause.length > 0;
        visit(sub, { select: sub, flag: outerHasFrom, table: singleTable(sub) });
      }
      return;
    }
    if (n.SelectStmt) {
      // A new scope that is not a SubLink subselect (top level, derived table in
      // FROM, CTE, UNION arm): its own bare columns are fine.
      visit(n.SelectStmt, { select: n.SelectStmt, flag: false });
      return;
    }
    for (const key of Object.keys(n)) {
      visit(n[key], scope);
    }
  };

  visit(tree?.stmts ?? [], { flag: false });
  return findings;
}

interface TableHint {
  name: string;
  isAlias: boolean;
}

/** The one table a subselect reads from, as the name to qualify with (its alias when it has one); undefined when the FROM is not that simple. */
function singleTable(select: AstNode): TableHint | undefined {
  const from: AstNode[] = select.fromClause ?? [];
  if (from.length !== 1 || !from[0].RangeVar) {
    return undefined;
  }
  const rv = from[0].RangeVar;
  return rv.alias?.aliasname ? { name: rv.alias.aliasname, isAlias: true } : { name: rv.relname, isAlias: false };
}

/** libpg-query locations are UTF-8 byte offsets; findings are character offsets. */
function byteToCharOffset(sql: string): (byteOffset: number) => number {
  // eslint-disable-next-line no-control-regex
  if (!/[^\x00-\x7f]/.test(sql)) {
    return (b) => b;
  }
  const bytes = Buffer.from(sql, 'utf8');
  return (b) => bytes.subarray(0, Math.min(b, bytes.length)).toString('utf8').length;
}
