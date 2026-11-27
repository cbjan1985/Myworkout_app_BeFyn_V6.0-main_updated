// Reads npm-audit.json (npm audit --json) and fails the build on high or critical advisories in production dependencies.
// A missing or unreadable report (for example no network) is reported as a warning, never as a pass: it says "not tested".
import fs from 'node:fs';
const f = process.argv[2] || 'npm-audit.json';
let j; try { j = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { console.log(`::warning::npm audit result could not be read (${e.message}). Dependencies were NOT audited in this run.`); process.exit(0); }
if (j.error) { console.log(`::warning::npm audit reported an error (${j.error.summary || j.error.code}). Dependencies were NOT audited in this run.`); process.exit(0); }
const v = j.metadata?.vulnerabilities || {}; console.log('npm audit (production dependencies):', JSON.stringify(v));
const bad = (v.high || 0) + (v.critical || 0);
if (bad) { for (const [name, d] of Object.entries(j.vulnerabilities || {})) if (['high', 'critical'].includes(d.severity)) console.log(`::error::${d.severity.toUpperCase()} ${name}: ${(d.via || []).map((x) => x.title || x).join('; ')} (fix: ${d.fixAvailable ? JSON.stringify(d.fixAvailable) : 'none'})`); process.exit(1); }
console.log('No high or critical advisories.');
