// Project checks that need no network: design-token contrast (WCAG 2.x), syntax of every module, required files.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const css = fs.readFileSync(path.join(root, 'www/styles/tokens.css'), 'utf8');
const block = (sel) => { const m = new RegExp(sel + '\\s*\\{([\\s\\S]*?)\\n\\}').exec(css); return m ? m[1] : ''; };
const vars = (b) => Object.fromEntries([...b.matchAll(/--([\w-]+):\s*(#[0-9A-Fa-f]{6})\b/g)].map((m) => [m[1], m[2]]));
const light = vars(block(':root')), dark = { ...light, ...vars(block(':root\\[data-theme="dark"\\]')) };

const lum = (hex) => { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

// [foreground, background, minimum ratio, description]
const PAIRS = [
  ['text', 'bg', 4.5, 'body text on page'], ['text', 'surface', 4.5, 'body text on card'], ['text', 'surface-2', 4.5, 'body text on subtle surface'],
  ['text-muted', 'bg', 4.5, 'muted text on page'], ['text-muted', 'surface', 4.5, 'muted text on card'], ['text-muted', 'surface-2', 4.5, 'muted text on subtle surface'],
  ['text-on-primary', 'primary', 4.5, 'primary button label'], ['accent-text', 'bg', 4.5, 'link/selected text on page'], ['accent-text', 'surface', 4.5, 'selected text on card'], ['accent-text', 'accent-soft', 4.5, 'text on accent tint'],
  ['text', 'accent-soft', 4.5, 'body text on accent tint'], ['success', 'success-soft', 4.5, 'success pill'], ['warning', 'warning-soft', 4.5, 'warning pill'], ['error', 'error-soft', 4.5, 'error pill'], ['text', 'warning-soft', 4.5, 'banner text'],
  ['error', 'surface', 4.5, 'error text on card'], ['error', 'bg', 4.5, 'error text on page'], ['success', 'surface', 4.5, 'success text on card'], ['bg', 'text', 4.5, 'toast text'],
  ['focus', 'bg', 3, 'focus ring on page'], ['focus', 'surface', 3, 'focus ring on card'], ['border-strong', 'surface', 3, 'input border'], ['accent', 'surface', 3, 'switch/selection on card'], ['accent', 'bg', 3, 'nav indicator'],
  ['chart-1', 'surface', 3, 'chart series 1'], ['chart-2', 'surface', 3, 'chart series 2'], ['chart-3', 'surface', 3, 'chart series 3'],
];
let bad = 0;
for (const [name, t] of [['light', light], ['dark', dark]]) {
  for (const [fg, bg, min, d] of PAIRS) {
    if (!t[fg] || !t[bg]) { console.log(`MISSING token ${fg}/${bg} (${name})`); bad++; continue; }
    const r = ratio(t[fg], t[bg]);
    if (r < min) { console.log(`FAIL [${name}] ${d}: ${fg} ${t[fg]} on ${bg} ${t[bg]} = ${r.toFixed(2)} (need ${min})`); bad++; }
  }
  // danger button: white text on error (light) / dark text on error (dark)
  const dangerText = name === 'light' ? '#FFFFFF' : '#2A0B09'; const rd = ratio(dangerText, t.error);
  if (rd < 4.5) { console.log(`FAIL [${name}] danger button ${rd.toFixed(2)}`); bad++; }
}
console.log(bad ? `${bad} contrast problem(s)` : `contrast OK (${PAIRS.length * 2 + 2} pairs checked across light and dark)`);

// syntax check every JS module
let syntax = 0;
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
for (const f of [...walk(path.join(root, 'www/src')), ...walk(path.join(root, 'tools')).filter((x) => x.endsWith('.mjs'))]) {
  if (!/\.m?js$/.test(f)) continue;
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); } catch (e) { console.log('SYNTAX', path.relative(root, f), String(e.stderr).split('\n')[0]); syntax++; }
}
console.log(syntax ? `${syntax} syntax error(s)` : 'syntax OK');

// import graph: every relative import must resolve to a file, and every named import must be exported by that file
let graph = 0; const seen = new Set();
const exportsOf = (src) => { const set = new Set(); for (const m of src.matchAll(/export\s+(?:async\s+)?(?:const|let|var|function\*?|class)\s+([A-Za-z0-9_$]+)/g)) set.add(m[1]); for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) m[1].split(',').forEach((x) => { const n = x.trim().split(/\s+as\s+/).pop(); if (n) set.add(n); }); if (/export\s+default/.test(src)) set.add('default'); return set; };
const visit = (file) => {
  if (seen.has(file)) return; seen.add(file); const src = fs.readFileSync(file, 'utf8');
  for (const m of src.matchAll(/import\s+(?:([A-Za-z0-9_$*\s{},]+?)\s+from\s+)?['"](\.[^'"]+)['"]/g)) {
    const target = path.resolve(path.dirname(file), m[2]);
    if (!fs.existsSync(target)) { console.log(`IMPORT ${path.relative(root, file)}: cannot find ${m[2]}`); graph++; continue; }
    if (m[1]) { const named = /\{([^}]*)\}/.exec(m[1]); if (named) { const ex = exportsOf(fs.readFileSync(target, 'utf8')); for (const n of named[1].split(',').map((x) => x.trim().split(/\s+as\s+/)[0]).filter(Boolean)) if (!ex.has(n)) { console.log(`IMPORT ${path.relative(root, file)}: "${n}" is not exported by ${m[2]}`); graph++; } } }
    if (target.endsWith('.js')) visit(target);
  }
};
visit(path.join(root, 'www/src/main.js'));
console.log(graph ? `${graph} broken import(s)` : `import graph OK (${seen.size} modules reachable from main.js)`);
process.exit(bad || syntax || graph ? 1 : 0);
