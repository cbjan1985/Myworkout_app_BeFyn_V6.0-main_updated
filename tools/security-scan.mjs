// FiT85 static security scan (no network needed). Complements, and does not replace, npm audit / MobSF / Semgrep / Gitleaks in CI.
// Areas: secrets, dangerous browser APIs, CSP, Android configuration, dependencies, CI workflow, storage/crypto rules.
// Exit code 1 if any finding of severity P0 or P1 is not suppressed. Usage: node tools/security-scan.mjs [--json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rel = (f) => path.relative(root, f);
const walk = (d, skip = ['node_modules', '.git', 'android', 'dist']) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (skip.includes(e.name) ? [] : e.isDirectory() ? walk(path.join(d, e.name), skip) : [path.join(d, e.name)]));
const isText = (f) => /\.(js|mjs|json|md|html|css|yml|yaml|py|sh|kt|java|xml|txt|gradle)$/i.test(f) || /\.(jss)$/.test(f);
const read = (f) => fs.readFileSync(f, 'utf8');
const findings = []; // {id, sev, cls, area, where, what, fix}
const add = (id, sev, area, where, what, fix = '', cls = 'confirmed') => findings.push({ id, sev, cls, area, where, what, fix });
const all = walk(root); const text = all.filter(isText);
const appCode = text.filter((f) => /^(www\/(src|index\.html)|www\/styles)/.test(rel(f)));

/* ---------- 1. secrets ---------- */
const SECRET_RULES = [
  [/-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/, 'private key block'], [/AKIA[0-9A-Z]{16}/, 'AWS access key id'], [/gh[pousr]_[A-Za-z0-9]{30,}/, 'GitHub token'],
  [/xox[baprs]-[A-Za-z0-9-]{10,}/, 'Slack token'], [/AIza[0-9A-Za-z_-]{35}/, 'Google API key'], [/eyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}/, 'JWT'],
  [/(storepass|keypass|password|passwd|secret|api[_-]?key|token)\s*[:=]\s*['"][^'"\s]{8,}['"]/i, 'hard-coded credential assignment'], [/ANDROID_KEYSTORE_BASE64\s*[:=]\s*[A-Za-z0-9+/]{100,}/, 'keystore content'],
  [/\bM[IA][A-Za-z0-9+/]{300,}={0,2}\b/, 'long base64 blob that looks like a keystore or certificate'],
];
for (const f of text) {
  if (/^docs\/legacy\//.test(rel(f)) || rel(f) === 'tools/security-scan.mjs' || /^tests\//.test(rel(f))) continue;
  const t = read(f);
  for (const [re, name] of SECRET_RULES) { const m = re.exec(t); if (m) { const sev = /password|credential/.test(name) && /(storepass|keypass) *[:=] *['"]android['"]/i.test(m[0]) ? 'P3' : 'P0'; add('SEC-SECRET-' + name.replace(/\W+/g, '-').toUpperCase(), sev, 'Secrets', rel(f), `Possible ${name}: "${m[0].slice(0, 40)}..."`, 'Remove it, rotate the credential, and keep it in a repository secret.'); } }
}
for (const f of all.filter((x) => /\.(jks|keystore|p12|pfx|pem)$/i.test(x))) add('SEC-KEYSTORE-IN-REPO', 'P2', 'Secrets', rel(f), 'A signing keystore file is committed. It is the V5.0 debug identity (alias androiddebugkey, the Android default password) that lets FiT85 install over V5.0, so it protects nothing secret, but a signing file in source control is still poor practice.', 'Store it as the repository secret BEFYN_V5_KEYSTORE_BASE64 (the workflow already prefers it) and delete the file. The workflow verifies the certificate fingerprint either way.', 'accepted-risk');
for (const f of all) if (/signing-secrets|\.env$|id_rsa|\.npmrc$/.test(path.basename(f))) add('SEC-SECRET-FILE', 'P0', 'Secrets', rel(f), 'A credentials file is present in the repository.', 'Delete it, rotate anything it contained, and add it to .gitignore.');

/* ---------- 2. dangerous browser APIs in app code ---------- */
const DANGER = [[/\beval\s*\(/, 'eval()', 'P1'], [/new\s+Function\s*\(/, 'new Function()', 'P1'], [/document\.write\s*\(/, 'document.write()', 'P1'], [/insertAdjacentHTML\s*\(/, 'insertAdjacentHTML()', 'P2'], [/\.outerHTML\s*=/, 'outerHTML assignment', 'P2'],
  [/setTimeout\s*\(\s*['"`]/, 'setTimeout with a string', 'P1'], [/javascript:/i, 'javascript: URL', 'P1'], [/\bdangerouslySetInnerHTML\b/, 'dangerouslySetInnerHTML', 'P1'], [/localStorage\.(setItem)\s*\([^)]*(pass|secret|token)/i, 'secret written to localStorage', 'P1'], [/console\.(log|debug)\s*\(/, 'console logging in app code', 'P3']];
for (const f of appCode.filter((x) => /\.js$/.test(x))) {
  const t = read(f);
  for (const [re, name, sev] of DANGER) if (re.test(t) && !(name === 'javascript: URL' && /safeUrl|\^https\?|test\(/.test(t) && !/href\s*[:=]\s*['"]javascript:/i.test(t))) add('SEC-API-' + name.replace(/\W+/g, '-').replace(/^-|-$/g, '').toUpperCase(), sev, 'Source code', rel(f), `Uses ${name}.`, 'Remove it or replace it with a safe DOM API.');
  if (/\.innerHTML\s*=/.test(t) && rel(f) !== 'www/src/ui/icons.js') add('SEC-API-INNERHTML', 'P1', 'Source code', rel(f), 'innerHTML assignment outside the static icon table.', 'Build nodes with h() / textContent.');
}
{ const icons = read(path.join(root, 'www/src/ui/icons.js')); if (/innerHTML\s*=\s*(?!P\[)/.test(icons.replace(/s\.innerHTML = P\[name\] \|\| P\.info/, ''))) add('SEC-ICON-INNERHTML', 'P1', 'Source code', 'www/src/ui/icons.js', 'innerHTML used with a non-constant value.', 'Only constant SVG path data may be assigned.'); }
for (const f of appCode.filter((x) => /\.js$/.test(x))) { const t = read(f); for (const m of t.matchAll(/https?:\/\/[^\s'"`)]+/g)) { if (/localhost|w3\.org|img\.youtube\.com|youtube\.com|youtu\.be|strava\.com|cdn\.sheetjs\.com|dQw4w9WgXcQ|market:/.test(m[0])) continue; if (m[0].startsWith('http://')) add('SEC-CLEARTEXT-URL', 'P2', 'Network', rel(f), `Cleartext URL ${m[0]}`, 'Use https.'); } }

/* ---------- 3. Content-Security-Policy ---------- */
{ const html = read(path.join(root, 'www/index.html')); const m = /Content-Security-Policy"\s+content="([^"]+)"/.exec(html);
  if (!m) add('SEC-CSP-MISSING', 'P1', 'WebView', 'www/index.html', 'No Content-Security-Policy.', 'Add a strict CSP meta tag.');
  else { const csp = m[1]; const dir = (n) => (new RegExp(`${n}\s+([^;]+)`).exec(csp) || [])[1] || '';
    if (/unsafe-eval/.test(csp)) add('SEC-CSP-EVAL', 'P1', 'WebView', 'www/index.html', "CSP allows 'unsafe-eval'.", 'Remove it.');
    if (/script-src[^;]*(unsafe-inline|\*|https?:)/.test(csp)) add('SEC-CSP-SCRIPT', 'P1', 'WebView', 'www/index.html', 'script-src allows inline or remote scripts.', "Use 'self' only.");
    if (!/object-src\s+'none'/.test(csp)) add('SEC-CSP-OBJECT', 'P2', 'WebView', 'www/index.html', "object-src is not 'none'.", "Add object-src 'none'.");
    if (/connect-src[^;]*\*/.test(csp)) add('SEC-CSP-CONNECT', 'P2', 'WebView', 'www/index.html', 'connect-src allows any host.', 'List hosts explicitly.');
    if (!/base-uri\s+'self'/.test(csp)) add('SEC-CSP-BASE', 'P3', 'WebView', 'www/index.html', 'base-uri is not restricted.', "Add base-uri 'self'.");
    if (/img-src[^;]*https:\/\/(?!img\.youtube\.com|localhost)/.test(csp)) add('SEC-CSP-IMG', 'P3', 'WebView', 'www/index.html', 'img-src allows extra remote hosts.', 'Keep only what is needed.'); }
  if (/<script(?![^>]*\bsrc=)[^>]*>[^<]/.test(html)) add('SEC-INLINE-SCRIPT', 'P1', 'WebView', 'www/index.html', 'Inline script in index.html.', 'Move it to a module.'); }

/* ---------- 4. Android configuration (checked in the patch scripts that generate the final project) ---------- */
{ const pm = read(path.join(root, 'patch_manifest.py')), pg = read(path.join(root, 'patch_gradle.py')), cc = JSON.parse(read(path.join(root, 'capacitor.config.json')));
  if (!/allowBackup="false"/.test(pm)) add('AND-BACKUP', 'P1', 'Android', 'patch_manifest.py', 'Cloud backup is not disabled, so health data could be uploaded by Android auto-backup.', 'Set android:allowBackup="false".');
  if (!/usesCleartextTraffic="false"/.test(pm)) add('AND-CLEARTEXT', 'P1', 'Android', 'patch_manifest.py', 'Cleartext traffic is not explicitly disabled.', 'Set usesCleartextTraffic false and a network security config.');
  if (!/debuggable false/.test(pg)) add('AND-DEBUGGABLE', 'P1', 'Android', 'patch_gradle.py', 'The APK would be debuggable (private data readable over adb).', 'Set debuggable false.');
  if (cc.android?.webContentsDebuggingEnabled !== false) add('AND-WEBVIEW-DEBUG', 'P1', 'Android', 'capacitor.config.json', 'WebView remote debugging is not disabled.', 'Set android.webContentsDebuggingEnabled false.');
  if (cc.android?.allowMixedContent !== false) add('AND-MIXED', 'P2', 'Android', 'capacitor.config.json', 'Mixed content is not disabled.', 'Set android.allowMixedContent false.');
  if (cc.server?.cleartext === true || cc.server?.url) add('AND-SERVER', 'P1', 'Android', 'capacitor.config.json', 'The app is configured to load remote or cleartext content.', 'Remove server.url / cleartext.');
  const perms = [...pm.matchAll(/"(android\.permission\.[A-Z_]+)"/g)].map((m) => m[1]);
  const DENY = /READ_SMS|SEND_SMS|CAMERA|RECORD_AUDIO|ACCESS_FINE_LOCATION|ACCESS_COARSE_LOCATION|READ_CONTACTS|READ_CALL_LOG|READ_PHONE_STATE|SYSTEM_ALERT_WINDOW|REQUEST_INSTALL_PACKAGES|WRITE_EXTERNAL_STORAGE|BIND_ACCESSIBILITY_SERVICE/;
  for (const p of perms) if (DENY.test(p)) add('AND-PERM-DENY', 'P1', 'Android', 'patch_manifest.py', `Disallowed permission ${p}.`, 'Remove it.');
  if (perms.includes('android.permission.MANAGE_EXTERNAL_STORAGE')) add('AND-PERM-ALLFILES', 'P3', 'Android', 'patch_manifest.py', 'MANAGE_EXTERNAL_STORAGE (all files access) is declared for the optional exercise-media folder feature that V5.0 users rely on. Android only grants it if the person turns it on in system settings, and FiT85 asks only when that feature is used. Google Play would not accept it; FiT85 is sideloaded.', 'Attach media per exercise with the file picker (no permission needed, already available). The folder feature can then be removed in a future release.', 'accepted-risk');
  if (!/health\./.test(pm)) add('AND-HEALTH', 'P3', 'Android', 'patch_manifest.py', 'No Health Connect permissions are declared.', 'Expected unless Health Connect was removed.', 'potential'); }

/* ---------- 5. dependencies ---------- */
{ const pkg = JSON.parse(read(path.join(root, 'package.json'))); const all2 = { ...pkg.dependencies, ...pkg.devDependencies };
  for (const [n, v] of Object.entries(all2)) {
    if (/^(git\+|github:|http:\/\/)/.test(v)) add('DEP-INSECURE-SOURCE', 'P1', 'Dependencies', 'package.json', `${n} is installed from an insecure source (${v}).`, 'Use a registry release or an https tarball.');
    if (n === 'xlsx' && /^(\^|~)?0\.(1[0-9]|[0-9])\./.test(v)) add('DEP-XLSX-OLD', 'P1', 'Dependencies', 'package.json', `xlsx ${v} (npm registry) has known vulnerabilities (CVE-2023-30533 prototype pollution, CVE-2024-22363 ReDoS); fixed releases are only published on cdn.sheetjs.com.`, 'Install xlsx 0.20.3 from https://cdn.sheetjs.com.');
    if (n === 'xlsx' && /cdn\.sheetjs\.com\/xlsx-0\.(20\.([2-9]|\d\d)|2[1-9]|[3-9])/.test(v)) add('DEP-XLSX-OK', 'P3', 'Dependencies', 'package.json', `xlsx is installed from the SheetJS CDN (${v}), which carries the fixes. npm audit cannot see this source, so it is checked here.`, '', 'false-positive');
    if (/^[\^~]?[0-9]/.test(v) === false && !/^https:/.test(v) && v !== '*') add('DEP-UNPINNED', 'P3', 'Dependencies', 'package.json', `${n}: ${v}`, 'Pin to an exact version.');
  }
  if (!fs.existsSync(path.join(root, 'package-lock.json'))) add('DEP-NO-LOCKFILE', 'P3', 'Dependencies', 'package.json', 'No package-lock.json, so a build can pick up newer patch releases. Capacitor is limited to 6.x by its version range.', 'Commit the package-lock.json produced by the first CI run.', 'accepted-risk'); }

/* ---------- 6. CI workflow ---------- */
{ const wf = read(path.join(root, '.github/workflows/build-apk.yml'));
  if (/pull_request_target/.test(wf)) add('CI-PRT', 'P1', 'CI', 'build-apk.yml', 'pull_request_target runs untrusted code with secrets.', 'Do not use it.');
  if (!/permissions:\s*\n\s*contents:\s*read/.test(wf)) add('CI-PERMS', 'P2', 'CI', 'build-apk.yml', 'Workflow token permissions are not restricted.', 'Add permissions: contents: read.');
  if (/echo\s+\$\{\{\s*secrets\./.test(wf)) add('CI-ECHO-SECRET', 'P0', 'CI', 'build-apk.yml', 'A secret is echoed to the log.', 'Never print secrets.');
  for (const m of wf.matchAll(/uses:\s*([^\s@]+)@([^\s]+)/g)) if (!/^(actions)\//.test(m[1])) add('CI-THIRD-PARTY-ACTION', 'P2', 'CI', 'build-apk.yml', `Third-party action ${m[1]}@${m[2]}`, 'Pin it to a commit SHA.');
  const wfCode = wf.split('\n').filter((l) => !/^\s*#/.test(l)).map((l) => l.replace(/\s+#.*$/, '')).join('\n');
  // GitHub Actions' default `bash` shell is only `bash -e` (no pipefail).
  // Explicit `shell: bash` enables `bash --noprofile --norc -e -o pipefail`.
  // Accept either a workflow/job-level defaults.run.shell or a step-level shell,
  // but do not treat comments or unrelated script text as proof.
  const hasPipefailShell =
    /^ {4}shell:\s*bash\s*$/m.test(wfCode) ||
    /^ {6,}shell:\s*bash\s*$/m.test(wfCode) ||
    /^ {0,6}set -euo pipefail\s*$/m.test(wfCode);
  if (!hasPipefailShell) add('CI-PIPEFAIL', 'P1', 'CI', 'build-apk.yml', 'No explicit pipefail protection is configured for GitHub Actions run steps; default bash does not enable pipefail.', 'Set defaults.run.shell: bash or add `set -euo pipefail` to every run script that uses pipelines.');
  if (!/if-no-files-found:\s*error/.test(wf)) add('CI-UPLOAD', 'P1', 'CI', 'build-apk.yml', 'APK upload only warns when no file exists.', 'Set if-no-files-found: error.'); }

/* ---------- 7. data protection rules in code ---------- */
{ const bk = read(path.join(root, 'www/src/data/backup-crypto.js'));
  if (!/AES-GCM/.test(bk) || !/600000/.test(bk)) add('DATA-CRYPTO', 'P1', 'Data', 'backup-crypto.js', 'Backup encryption is not AES-GCM with a strong PBKDF2 iteration count.', 'Use AES-256-GCM and at least 600000 PBKDF2 iterations.');
  const mig = read(path.join(root, 'www/src/data/migration.js')); if (/removeItem\(LEGACY\.state/.test(mig) || /localStorage\.clear/.test(mig)) add('DATA-LEGACY-DELETE', 'P1', 'Data', 'migration.js', 'Migration deletes V5.0 data.', 'Never delete legacy data automatically.');
  if (/['"]0000['"]/.test(read(path.join(root, 'www/src/services/dataio.js')) + mig)) add('DATA-DEFAULT-PASSWORD', 'P1', 'Data', 'services', 'A default password is present.', 'Remove it.');
  if (!/safeParse/.test(read(path.join(root, 'www/src/services/dataio.js')))) add('DATA-IMPORT-PARSE', 'P1', 'Data', 'dataio.js', 'Imported files are parsed without prototype-pollution protection.', 'Use safeParse.'); }

/* ---------- report ---------- */
const order = { P0: 0, P1: 1, P2: 2, P3: 3 }; findings.sort((a, b) => order[a.sev] - order[b.sev] || a.id.localeCompare(b.id));
const live = findings.filter((f) => f.cls !== 'false-positive'); const blocking = live.filter((f) => (f.sev === 'P0' || f.sev === 'P1') && f.cls === 'confirmed');
const summary = { scanned: { files: text.length, appCodeFiles: appCode.length }, total: findings.length, bySeverity: Object.fromEntries(['P0', 'P1', 'P2', 'P3'].map((s) => [s, live.filter((f) => f.sev === s).length])), blocking: blocking.length };
if (process.argv.includes('--json')) console.log(JSON.stringify({ summary, findings }, null, 1));
else { console.log(`Security scan: ${text.length} files (${appCode.length} app files)`); for (const f of findings) console.log(`  ${f.sev} [${f.cls}] ${f.id}  ${f.where}\n      ${f.what}`); console.log(blocking.length ? `${blocking.length} blocking finding(s) (P0/P1)` : `no blocking findings. P2/P3 remaining: ${summary.bySeverity.P2}/${summary.bySeverity.P3}`); }
fs.mkdirSync(path.join(root, 'docs/security'), { recursive: true }); fs.writeFileSync(path.join(root, 'docs/security/scan-results.json'), JSON.stringify({ tool: 'tools/security-scan.mjs', summary, findings }, null, 1));
process.exit(blocking.length ? 1 : 0);
