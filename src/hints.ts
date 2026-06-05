/**
 * Heuristic hints for bare "syntax error at or near X" messages, in the
 * spirit of PostgreSQL's own HINT: lines. Each heuristic is conservative —
 * a wrong hint is worse than no hint. Pure module, unit-testable.
 */

const KEYWORDS = [
  'SELECT', 'FROM', 'WHERE', 'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET',
  'DELETE', 'CREATE', 'TABLE', 'DROP', 'ALTER', 'ADD', 'COLUMN', 'JOIN',
  'INNER', 'LEFT', 'RIGHT', 'FULL', 'OUTER', 'CROSS', 'ON', 'USING',
  'GROUP', 'ORDER', 'BY', 'HAVING', 'LIMIT', 'OFFSET', 'DISTINCT', 'AS',
  'AND', 'OR', 'NOT', 'NULL', 'PRIMARY', 'KEY', 'FOREIGN', 'REFERENCES',
  'SERIAL', 'UNIQUE', 'DEFAULT', 'CONSTRAINT', 'BETWEEN', 'LIKE', 'ILIKE',
  'UNION', 'EXCEPT', 'INTERSECT', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
  'EXISTS', 'IN', 'IS', 'ASC', 'DESC', 'RETURNING', 'WITH', 'CASCADE',
  'TEXT', 'INTEGER', 'BOOLEAN', 'TIMESTAMP', 'VARCHAR', 'NUMERIC',
];

/** Reserved words students commonly try to use as table/column names. */
const RESERVED_AS_NAME = new Set([
  'order', 'user', 'group', 'table', 'select', 'from', 'where', 'check',
  'default', 'desc', 'asc', 'all', 'any', 'some', 'case', 'cast', 'column',
  'constraint', 'distinct', 'do', 'else', 'end', 'for', 'grant', 'having',
  'in', 'limit', 'not', 'null', 'offset', 'on', 'or', 'to', 'union',
  'unique', 'using', 'when', 'with', 'references', 'primary',
]);

function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > 2) {
    return 3; // beyond anything we care about
  }
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const curr = [i];
    for (let j = 1; j <= n; j++) {
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prev = curr;
  }
  return prev[n];
}

/** Strip string literals and comments so structural checks don't trip on their contents. */
function stripLiterals(sql: string): string {
  return sql
    .replace(/'(?:[^']|'')*'/g, (s) => ' '.repeat(s.length))
    .replace(/--[^\n]*/g, (s) => ' '.repeat(s.length))
    .replace(/\/\*[\s\S]*?\*\//g, (s) => ' '.repeat(s.length));
}

/**
 * Produce a hint for a syntax error at `cursor` (0-based char offset) whose
 * offending token is `token`. Returns undefined when no heuristic applies.
 */
export function hintFor(sql: string, cursor: number, token: string): string | undefined {
  const stripped = stripLiterals(sql);
  const before = stripped.slice(0, cursor);
  const lastChar = before.trimEnd().slice(-1);
  const prevWord = (before.match(/([A-Za-z_][A-Za-z0-9_]*)\s*$/) || [])[1]?.toUpperCase();

  // 1. Trailing comma: `SELECT id, FROM ...`, `(a, b,)`, `VALUES (1, 2,);`
  if (lastChar === ',') {
    return 'There is a comma right before this — remove the trailing comma?';
  }

  // 2. Unclosed parenthesis before the error.
  const opens = (before.match(/\(/g) || []).length;
  const closes = (before.match(/\)/g) || []).length;
  if (opens > closes) {
    return 'There is an unclosed ( earlier — check your parentheses.';
  }

  // 3. Keyword typo: SELEC, INSRT, WEHRE, ...
  const upper = token.toUpperCase();
  if (/^[A-Za-z_]+$/.test(token) && !KEYWORDS.includes(upper)) {
    const maxDistance = token.length >= 6 ? 2 : 1;
    let best: string | undefined;
    let bestDistance = maxDistance + 1;
    for (const kw of KEYWORDS) {
      const d = editDistance(upper, kw);
      if (d < bestDistance) {
        bestDistance = d;
        best = kw;
      }
    }
    if (best && bestDistance <= maxDistance) {
      return `Did you mean ${best}?`;
    }
  }

  // 4. Reserved word used as a table/column name: CREATE TABLE order (...)
  if (
    RESERVED_AS_NAME.has(token.toLowerCase()) &&
    (prevWord === 'TABLE' || prevWord === 'INTO' || prevWord === 'FROM' ||
      prevWord === 'JOIN' || prevWord === 'UPDATE' || lastChar === '(' || lastChar === ',')
  ) {
    return `"${token.toLowerCase()}" is a reserved word in SQL — to use it as a name, double-quote it or pick another name.`;
  }

  return undefined;
}

/** Extract the offending token from a PostgreSQL error message, if present. */
export function tokenFromMessage(message: string): string | undefined {
  return (message.match(/at or near "((?:[^"]|"")*)"/) || [])[1];
}
