/**
 * psql awareness. A ```sql block in course material or docs is usually
 * "what you type into psql", not pure server SQL — so it may contain
 * psql meta-commands (\d, \dt staff, \c dbname, \timing) and, when pasted
 * from a terminal, psql prompts (sd42=# ). The server parser rejects both.
 *
 * This module separates the psql layer from the SQL: meta-command lines
 * and prompts are blanked out (replaced by spaces, so every offset still
 * maps 1:1 onto the document), and the meta-commands themselves are checked
 * against psql's real command list. Pure module, unit-testable.
 *
 * Reference: the `\?` output of psql 18, verified against a live psql —
 * including its leniencies (`\d staff;` works, `\dstaff` silently lists
 * everything) and its errors (`\q;` is "invalid command").
 */

import { editDistance, stripLiterals } from './hints';

/**
 * check  — recognise meta-commands, flag unknown ones (default)
 * ignore — recognise meta-commands, never flag them
 * error  — pure SQL only: every meta-command / prompt is an error
 */
export type PsqlMode = 'check' | 'ignore' | 'error';

export interface PsqlFinding {
  /** 0-based character offset into the block. */
  offset: number;
  length: number;
  message: string;
}

export interface PsqlSplit {
  /** The block with psql meta-command lines and prompts blanked to spaces. */
  sql: string;
  findings: PsqlFinding[];
}

/**
 * Meta-command names as regexes (without the backslash), from psql 18's `\?`.
 * Modifier letters (S = system objects, x = expanded, + = verbose) are
 * order-free in psql, so they are one trailing class. `\d{t,v,m,i,s,E}`
 * may be combined in any order (`\dtvs`).
 */
const D_FAMILY = [
  '[tvmisE]*', 'f[anptw]*', 'P[itn]*',
  'a', 'A', 'Ac', 'Af', 'Ao', 'Ap', 'b', 'c', 'config', 'C', 'd', 'D', 'ddp',
  'es', 'et', 'eu', 'ew', 'F', 'Fd', 'Fp', 'Ft', 'g', 'l', 'L', 'n', 'o', 'O',
  'p', 'rds', 'rg', 'Rp', 'Rs', 'T', 'u', 'x', 'X', 'y',
];

const MODIFIED = ['l', 'list', 'z', 'sf', 'sv', 'lo_list'];

const PLAIN = [
  // general
  'copyright', 'crosstabview', 'errverbose', 'g', 'gdesc', 'gexec', 'gset', 'gx',
  'q', 'restrict', 'unrestrict', 'watch',
  // help
  '\\?', 'h', 'help',
  // query buffer
  'e', 'edit', 'ef', 'ev', 'p', 'print', 'r', 'reset', 's', 'w', 'write',
  // input/output
  'copy', 'echo', 'i', 'include', 'ir', 'include_relative', 'o', 'out', 'qecho', 'warn',
  // conditional
  'if', 'elif', 'else', 'endif',
  // large objects
  'lo_export', 'lo_import', 'lo_unlink',
  // formatting
  'a', 'C', 'f', 'H', 'pset', 't', 'T', 'x',
  // connection
  'c', 'connect', 'conninfo', 'encoding', 'password',
  // operating system
  'cd', 'getenv', 'setenv', 'timing', '!.*',
  // variables
  'prompt', 'set', 'unset',
  // extended query protocol
  'bind', 'bind_named', 'close', 'close_prepared', 'endpipeline', 'flush',
  'flushrequest', 'getresults', 'parse', 'sendpipeline', 'startpipeline',
];

const KNOWN = new RegExp(
  '^(?:' +
    `d(?:${D_FAMILY.join('|')})[Sx+]*` +
    `|(?:${MODIFIED.join('|')})[Sx+]*` +
    `|(?:${PLAIN.join('|')})` +
    ')$'
);

/** Names worth a "did you mean" — the ones people actually type. */
const COMMON = [
  'd', 'dt', 'dn', 'df', 'dv', 'di', 'ds', 'du', 'dT', 'l', 'c', 'x', 'q',
  'i', 'copy', 'timing', 'h', 'help', 'e', 'echo', 'set', 'pset', 'g', 'gx',
  'conninfo', 'password', 'watch', 'cd', 'encoding',
];

export function isKnownMetaCommand(name: string): boolean {
  return KNOWN.test(name);
}

/**
 * A psql prompt at column 0: database name, one status character
 * (= normal, - continuation, ( ' " $ inside an open construct, * ! ?
 * transaction state, ^ single-line mode), then # (superuser) or >.
 */
const PROMPT = /^[A-Za-z_][A-Za-z0-9_]*[=\-(*!?^'"$][#>](?: |$)/;

/** The command name runs from the backslash to whitespace, another backslash, or EOL. */
const META = /^(\s*)\\([^\s\\]*)/;

export function splitPsql(block: string, mode: PsqlMode): PsqlSplit {
  const lines = block.split('\n');
  const stripped = stripLiterals(block);
  const findings: PsqlFinding[] = [];
  const out: string[] = [];

  // Prompts are only stripped in "transcript mode": the block's first
  // non-blank line carries one. That keeps `foo=> 1` (a named argument on
  // a continuation line) from ever being mistaken for a prompt.
  const firstContent = lines.find((l) => l.trim() !== '') ?? '';
  const transcript = PROMPT.test(firstContent);

  let offset = 0;
  for (let line of lines) {
    const lineStart = offset;
    offset += line.length + 1;
    let blankedPrefix = 0;

    if (transcript) {
      const prompt = line.match(PROMPT);
      if (prompt) {
        if (mode === 'error') {
          findings.push({
            offset: lineStart,
            length: prompt[0].trimEnd().length,
            message: 'This is a psql prompt, not SQL — remove it (or set markdownSqlLint.psqlCommands to allow psql transcripts).',
          });
        }
        blankedPrefix = prompt[0].length;
        line = ' '.repeat(blankedPrefix) + line.slice(blankedPrefix);
      }
    }

    const meta = line.slice(blankedPrefix).match(META);
    if (meta) {
      const keep = blankedPrefix + meta[1].length;
      const at = lineStart + keep;
      // A backslash inside a string literal or comment is not a meta-command.
      if (stripped[at] === '\\') {
        const name = meta[2];
        const message = messageFor(name, mode);
        if (message) {
          findings.push({ offset: at, length: name.length + 1, message });
        }
        line = line.slice(0, keep) + ' '.repeat(line.length - keep);
      }
    }
    out.push(line);
  }

  return { sql: out.join('\n'), findings };
}

function messageFor(name: string, mode: PsqlMode): string | undefined {
  if (mode === 'ignore') {
    return undefined;
  }
  if (mode === 'error') {
    return `\\${name} is a psql meta-command, not SQL — it only works inside the psql client (or set markdownSqlLint.psqlCommands to allow it).`;
  }
  if (isKnownMetaCommand(name)) {
    return undefined;
  }
  const unknown = `Unknown psql command \\${name}.`;
  if (name.endsWith(';') && isKnownMetaCommand(name.slice(0, -1))) {
    return `${unknown} psql meta-commands are not terminated with a semicolon — use \\${name.slice(0, -1)}.`;
  }
  if (name !== name.toLowerCase() && isKnownMetaCommand(name.toLowerCase())) {
    return `${unknown} psql commands are case-sensitive — did you mean \\${name.toLowerCase()}?`;
  }
  if (name.length > 1 && name[0] === 'd') {
    return `${unknown} To describe a table, use \\d followed by a space and the name: \\d tablename`;
  }
  const maxDistance = name.length >= 6 ? 2 : 1;
  let best: string | undefined;
  let bestDistance = maxDistance + 1;
  if (name.length >= 2) {
    for (const candidate of COMMON) {
      const d = editDistance(name, candidate);
      if (d < bestDistance) {
        bestDistance = d;
        best = candidate;
      }
    }
  }
  if (best !== undefined) {
    return `${unknown} Did you mean \\${best}?`;
  }
  return `${unknown} Type \\? in psql for the list of meta-commands.`;
}
