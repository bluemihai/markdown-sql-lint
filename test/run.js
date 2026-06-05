/**
 * Plain-Node test runner for the pure logic (fence extraction, offset
 * mapping) plus an end-to-end check against the real parser.
 * Run with: npm test
 */
const assert = require('node:assert');
const { extractSqlFences, offsetToPosition, tokenLengthAt } = require('../out/fences');
const { hintFor, tokenFromMessage } = require('../out/hints');
const { parse, SqlError } = require('libpg-query');

const LANGS = ['sql', 'postgres', 'postgresql', 'pgsql'];
let passed = 0;

function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      console.log(`  ok - ${name}`);
    })
    .catch((e) => {
      console.error(`  FAIL - ${name}`);
      console.error(e);
      process.exitCode = 1;
    });
}

(async () => {
  await test('extracts a simple sql fence with correct start line', () => {
    const md = '# Title\n\n```sql\nSELECT 1;\n```\n';
    const fences = extractSqlFences(md, LANGS);
    assert.strictEqual(fences.length, 1);
    assert.strictEqual(fences[0].sql, 'SELECT 1;');
    assert.strictEqual(fences[0].startLine, 3);
  });

  await test('ignores non-sql fences and bare fences', () => {
    const md = '```python\nprint(1)\n```\n\n```\nplain\n```\n\n```sql\nSELECT 2;\n```\n';
    const fences = extractSqlFences(md, LANGS);
    assert.strictEqual(fences.length, 1);
    assert.strictEqual(fences[0].sql, 'SELECT 2;');
  });

  await test('matches info string case-insensitively and by first word', () => {
    const md = '```SQL\nSELECT 1;\n```\n\n```postgresql\nSELECT 2;\n```\n';
    const fences = extractSqlFences(md, LANGS);
    assert.strictEqual(fences.length, 2);
  });

  await test('handles ~~~ fences and longer markers', () => {
    const md = '~~~sql\nSELECT 1;\n~~~\n\n````sql\nhas ``` inside\n````\n';
    const fences = extractSqlFences(md, LANGS);
    assert.strictEqual(fences.length, 2);
    assert.strictEqual(fences[1].sql, 'has ``` inside');
  });

  await test('multi-line block keeps verbatim content', () => {
    const md = '```sql\nCREATE TABLE t (\n    id INT\n);\n```\n';
    const fences = extractSqlFences(md, LANGS);
    assert.strictEqual(fences[0].sql, 'CREATE TABLE t (\n    id INT\n);');
  });

  await test('unclosed fence runs to EOF without crashing', () => {
    const md = '```sql\nSELECT 1;\n';
    const fences = extractSqlFences(md, LANGS);
    assert.strictEqual(fences.length, 1);
    // The file's trailing newline becomes a final empty content line — harmless.
    assert.strictEqual(fences[0].sql, 'SELECT 1;\n');
  });

  await test('offsetToPosition maps across lines', () => {
    const sql = 'SELECT 1;\nSELEC 2;';
    assert.deepStrictEqual(offsetToPosition(sql, 10), { line: 1, character: 0 });
    assert.deepStrictEqual(offsetToPosition(sql, 0), { line: 0, character: 0 });
  });

  await test('tokenLengthAt covers the offending word', () => {
    assert.strictEqual(tokenLengthAt('SELECT id, FROM x;', 11), 4); // FROM
    assert.strictEqual(tokenLengthAt('SELECT 1 +;', 10), 1); // ;
  });

  await test('end-to-end: real parser error maps to the right document line', async () => {
    const md = '# HW\n\nIntro text.\n\n```sql\nSELECT id,\nFROM users\nWHERE;\n```\n';
    const [fence] = extractSqlFences(md, LANGS);
    let error;
    try {
      await parse(fence.sql);
    } catch (e) {
      error = e;
    }
    assert.ok(error instanceof SqlError, 'expected SqlError');
    const pos = offsetToPosition(fence.sql, error.sqlDetails.cursorPosition);
    // 'FROM' sits on block line 1 → document line startLine + 1 = 6
    assert.strictEqual(fence.startLine + pos.line, 6);
    assert.strictEqual(pos.character, 0);
  });

  await test('end-to-end: valid assignment-style block parses clean', async () => {
    const sql = [
      'CREATE TABLE type (',
      '    id SERIAL PRIMARY KEY,',
      '    code TEXT,',
      '    description TEXT',
      ');',
      '',
      "INSERT INTO agent(badge_number, name) VALUES (71717, 'Mik')",
    ].join('\n');
    await parse(sql); // throws if invalid
  });

  await test('hint: trailing comma before FROM', () => {
    const sql = 'SELECT id, FROM users;';
    assert.match(hintFor(sql, 11, 'FROM'), /trailing comma/);
  });

  await test('hint: keyword typo suggests the right keyword', () => {
    assert.strictEqual(hintFor('SELEC * FROM users;', 0, 'SELEC'), 'Did you mean SELECT?');
    assert.strictEqual(hintFor('INSRT INTO t VALUES (1);', 0, 'INSRT'), 'Did you mean INSERT?');
  });

  await test('hint: unclosed parenthesis', () => {
    const sql = 'INSERT INTO t (a, b VALUES (1, 2);';
    assert.match(hintFor(sql, 20, 'VALUES'), /unclosed \(/);
  });

  await test('hint: reserved word as table name', () => {
    const sql = 'CREATE TABLE order (id INT);';
    assert.match(hintFor(sql, 13, 'order'), /reserved word/);
  });

  await test('hint: comma inside a string literal does not trigger trailing-comma', () => {
    const sql = "SELECT 'a,' FROM FROM users;";
    const hint = hintFor(sql, 17, 'FROM');
    assert.ok(hint === undefined || !/trailing comma/.test(hint), `unexpected: ${hint}`);
  });

  await test('hint: none for a plain mystery token', () => {
    assert.strictEqual(hintFor('SELECT * FROM users xyzzyplugh broken;', 31, 'broken'), undefined);
  });

  await test('tokenFromMessage extracts quoted token', () => {
    assert.strictEqual(tokenFromMessage('syntax error at or near "FROM"'), 'FROM');
    assert.strictEqual(tokenFromMessage('something without a token'), undefined);
  });

  console.log(`\n${passed} test(s) passed${process.exitCode ? ', with failures' : ''}`);
})();
