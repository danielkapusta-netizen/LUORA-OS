/**
 * Keeps the Polish dictionary in step with the code.
 *
 *   pnpm i18n:check
 *
 * Every English string passed to `t('…')`, `msg('…')` or `t.plural(n, '…', '…')` must have an entry in
 * src/lib/i18n/pl. The same extractor backs tests/i18n.test.ts, so CI fails when a string is added without a translation.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(ROOT, 'src');

export type Found = { text: string; file: string; line: number; plural?: boolean };

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      // The dictionaries themselves are not usages.
      if (full === join(SRC, 'lib', 'i18n', 'pl')) continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

/** Reads a string literal starting at `i`; returns its value and the index after it, or null if it is not a plain literal. */
function readLiteral(src: string, start: number): { value: string; end: number } | null {
  let i = start;
  while (/\s/.test(src[i] ?? '')) i++;
  const quote = src[i];
  if (quote !== "'" && quote !== '"' && quote !== '`') return null;
  let value = '';
  for (i++; i < src.length; i++) {
    const c = src[i];
    if (c === '\\') {
      const n = src[i + 1];
      value += n === 'n' ? '\n' : n === 't' ? '\t' : n;
      i++;
    } else if (c === quote) {
      // Adjacent literals joined with + are common for long sentences.
      let j = i + 1;
      while (/\s/.test(src[j] ?? '')) j++;
      if (src[j] === '+') {
        const next = readLiteral(src, j + 1);
        if (next) return { value: value + next.value, end: next.end };
      }
      return { value, end: i + 1 };
    } else if (quote === '`' && c === '$' && src[i + 1] === '{') return null;
    else value += c;
  }
  return null;
}

/** Skips one argument (balanced brackets, strings) and returns the index of the comma or closing paren after it. */
function skipArg(src: string, start: number): number {
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') {
      const lit = readLiteral(src, i);
      if (lit) {
        i = lit.end - 1;
        continue;
      }
    }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      if (depth === 0) return i;
      depth--;
    } else if (c === ',' && depth === 0) return i;
  }
  return src.length;
}

const lineOf = (src: string, index: number) => src.slice(0, index).split('\n').length;

export function extract(): Found[] {
  const found: Found[] = [];
  for (const file of walk(SRC)) {
    const src = readFileSync(file, 'utf8');
    const rel = relative(ROOT, file);

    for (const m of src.matchAll(/(?<![\w.$])(?:t|msg)\(/g)) {
      const lit = readLiteral(src, m.index + m[0].length);
      if (lit) found.push({ text: lit.value, file: rel, line: lineOf(src, m.index) });
    }
    for (const m of src.matchAll(/(?<![\w$])t\.plural\(/g)) {
      const afterCount = skipArg(src, m.index + m[0].length);
      if (src[afterCount] !== ',') continue;
      const one = readLiteral(src, afterCount + 1);
      if (!one) continue;
      found.push({ text: one.value, file: rel, line: lineOf(src, m.index), plural: true });
      const comma = skipArg(src, one.end);
      if (src[comma] === ',') {
        const other = readLiteral(src, comma + 1);
        if (other) found.push({ text: other.value, file: rel, line: lineOf(src, m.index) });
      }
    }
  }
  return found;
}

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

export async function check() {
  const { PL, PL_PLURALS } = await import('../src/lib/i18n/pl/index');
  const found = extract();
  const missing = found.filter((f) => !f.plural && !(f.text in PL) && !(f.text in PL_PLURALS));
  const missingPlural = found.filter((f) => f.plural && !(f.text in PL_PLURALS));
  const used = new Set(found.map((f) => f.text));
  const unused = Object.keys(PL).filter((k) => !used.has(k));
  const badPlaceholders = Object.entries(PL).filter(([en, pl]) => placeholders(en) !== placeholders(pl));
  return { found, missing, missingPlural, unused, badPlaceholders };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { found, missing, missingPlural, unused, badPlaceholders } = await check();
  const show = (title: string, rows: string[]) => {
    if (rows.length) console.log(`\n${title} (${rows.length})\n${rows.map((r) => `  ${r}`).join('\n')}`);
  };
  show('Missing Polish translation', missing.map((f) => `${f.file}:${f.line}  ${JSON.stringify(f.text)}`));
  show('Missing Polish plural forms', missingPlural.map((f) => `${f.file}:${f.line}  ${JSON.stringify(f.text)}`));
  show('Placeholders differ from the English text', badPlaceholders.map(([en]) => JSON.stringify(en)));
  show('Translated but no longer used in the code', unused.map((k) => JSON.stringify(k)));
  console.log(`\n${new Set(found.map((f) => f.text)).size} distinct strings in use.`);
  process.exit(missing.length || missingPlural.length || badPlaceholders.length ? 1 : 0);
}
