'use strict';
/**
 * Verificare rapidă pentru CI (npm run check), fără bază de date:
 *  - sintaxa tuturor fișierelor .js (node --check)
 *  - schemele JSON se compilează și exemplele din examples/ trec/pică validarea cum e de așteptat
 *  - fiecare migrare SQL are nume NNN_descriere.sql și numerele sunt consecutive
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
let failed = 0;
const fail = (msg) => { failed += 1; console.error(`✗ ${msg}`); };

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    if (d.name === 'node_modules' || d.name.startsWith('.')) return [];
    const p = path.join(dir, d.name);
    return d.isDirectory() ? walk(p) : [p];
  });
}

const jsFiles = ['src', 'scripts', 'test'].flatMap((d) => walk(path.join(root, d))).filter((f) => f.endsWith('.js'));
for (const f of jsFiles) {
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); } catch (e) { fail(`${path.relative(root, f)}: ${e.stderr}`); }
}
console.log(`✓ sintaxă: ${jsFiles.length} fișiere`);

const { validateTelemetry } = require('../src/lib/validate');
const now = new Date('2026-11-21T10:16:00Z');
for (const f of fs.readdirSync(path.join(root, 'examples')).filter((x) => x.endsWith('.json'))) {
  const r = validateTelemetry(JSON.parse(fs.readFileSync(path.join(root, 'examples', f), 'utf8')), now);
  const shouldFail = f.includes('invalid');
  if (r.ok === shouldFail) fail(`examples/${f}: validare ${r.ok ? 'trecută' : 'picată'} neașteptat`);
}
console.log('✓ scheme JSON + exemple');

const migDir = path.join(root, '..', 'database', 'migrations');
const migs = fs.readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort();
migs.forEach((f, i) => {
  if (!/^\d{3}_[a-z0-9_]+\.sql$/.test(f)) fail(`migrare cu nume invalid: ${f}`);
  else if (Number(f.slice(0, 3)) !== i + 1) fail(`migrări neconsecutive la ${f}`);
});
console.log(`✓ migrări: ${migs.length}`);

if (failed) { console.error(`${failed} probleme`); process.exit(1); }
