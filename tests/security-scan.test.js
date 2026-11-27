import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
function copyProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'befyn-sec-'));
  const skip = new Set(['node_modules', '.git', 'android', 'dist', 'docs']);
  const cp = (from, to) => { fs.mkdirSync(to, { recursive: true }); for (const e of fs.readdirSync(from, { withFileTypes: true })) { if (skip.has(e.name)) continue; const a = path.join(from, e.name), b = path.join(to, e.name); e.isDirectory() ? cp(a, b) : fs.copyFileSync(a, b); } };
  cp(ROOT, dir); return dir;
}
const scan = (dir) => { const r = spawnSync(process.execPath, [path.join(dir, 'tools/security-scan.mjs'), '--json'], { encoding: 'utf8' }); return { code: r.status, out: r.stdout ? JSON.parse(r.stdout) : null, err: r.stderr }; };

test('the clean project has no blocking findings', () => {
  const dir = copyProject(); const r = scan(dir);
  assert.equal(r.code, 0, r.err); assert.equal(r.out.summary.blocking, 0);
});

test('the scanner catches seeded vulnerabilities (so a clean result means something)', () => {
  const dir = copyProject();
  fs.writeFileSync(path.join(dir, 'www/src/evil.js'), 'export const a = eval("1+1"); document.getElementById("x").innerHTML = "<b>" + location.hash; const password = "hunter2hunter2"; const u = "javascript:alert(1)"; setTimeout("x()", 1);\nconst k = "http://example.org/leak";\n');
  const idx = path.join(dir, 'www/index.html'); fs.writeFileSync(idx, fs.readFileSync(idx, 'utf8').replace("script-src 'self'", "script-src 'self' 'unsafe-eval' https://evil.example"));
  const wf = path.join(dir, '.github/workflows/build-apk.yml'); fs.writeFileSync(wf, fs.readFileSync(wf, 'utf8').replace(/shell: bash/, '').replace(/if-no-files-found: error/, 'if-no-files-found: warn'));
  const pm = path.join(dir, 'patch_manifest.py'); fs.writeFileSync(pm, fs.readFileSync(pm, 'utf8').replace('allowBackup="false"', 'allowBackup="true"').replace('"android.permission.VIBRATE",', '"android.permission.VIBRATE", "android.permission.READ_SMS",'));
  const pg = path.join(dir, 'patch_gradle.py'); fs.writeFileSync(pg, fs.readFileSync(pg, 'utf8').replace(/debuggable false/g, 'debuggable true'));
  const pj = path.join(dir, 'package.json'); const j = JSON.parse(fs.readFileSync(pj, 'utf8')); j.dependencies.xlsx = '0.18.5'; j.dependencies.evil = 'git+https://example.org/x.git'; fs.writeFileSync(pj, JSON.stringify(j));
  fs.writeFileSync(path.join(dir, 'signing-secrets.txt'), 'NAME: x');
  const cc = path.join(dir, 'capacitor.config.json'); const c = JSON.parse(fs.readFileSync(cc, 'utf8')); c.android.webContentsDebuggingEnabled = true; c.server.url = 'http://10.0.0.5'; fs.writeFileSync(cc, JSON.stringify(c));
  const r = scan(dir); const ids = new Set(r.out.findings.map((f) => f.id));
  assert.equal(r.code, 1);
  for (const id of ['SEC-API-EVAL', 'SEC-API-INNERHTML', 'SEC-API-JAVASCRIPT-URL', 'SEC-CSP-EVAL', 'SEC-CSP-SCRIPT', 'CI-PIPEFAIL', 'CI-UPLOAD', 'AND-BACKUP', 'AND-DEBUGGABLE', 'AND-PERM-DENY', 'AND-WEBVIEW-DEBUG', 'AND-SERVER', 'DEP-XLSX-OLD', 'DEP-INSECURE-SOURCE', 'SEC-SECRET-FILE']) assert.ok(ids.has(id), `missing detection: ${id}. Found: ${[...ids].join(', ')}`);
  assert.ok([...ids].some((i) => i.startsWith('SEC-SECRET-HARD-CODED')), 'hard-coded credential not detected');
  assert.ok([...ids].some((i) => i.startsWith('SEC-CLEARTEXT')), 'cleartext URL not detected');
});
