// Versioned backup / restore. Backups are plain JSON the person owns; restores validate first and snapshot first.
import { STORES, SCHEMA_VERSION } from './db.js';
import { ok, fail } from '../core/util.js';

export const BACKUP_FORMAT = 'befyn-backup';
export const APP_VERSION = '6.0.0';
const EXCLUDE_META = (r) => !String(r.key).startsWith('backup.');

export async function exportBackup(repos, { includeLegacy = true } = {}) {
  const data = {};
  for (const s of Object.keys(STORES)) data[s] = await repos.adapter.getAll(s);
  data.meta = data.meta.filter(EXCLUDE_META);
  const out = { format: BACKUP_FORMAT, schema: SCHEMA_VERSION, app: APP_VERSION, exportedAt: new Date().toISOString(), data };
  if (includeLegacy) { const pre = await repos.meta.get('backup.pre-v6'); if (pre) out.legacyPreV6 = pre; }
  return out;
}

const REQUIRED_KEYS = { templates: 'key', exercises: 'id', workouts: 'id', instances: 'id', scheduled: 'id', changes: 'id', logs: 'id', measurements: 'id', health: 'id', nutrition: 'id', reminders: 'id', prefs: 'key', meta: 'key' };

export function validateBackup(b) {
  const errors = [];
  if (!b || typeof b !== 'object') return ['This file is not a BeFyn backup.'];
  if (b.format !== BACKUP_FORMAT) errors.push('This file is not a BeFyn backup.');
  if (typeof b.schema !== 'number') errors.push('The backup has no version.');
  else if (b.schema > SCHEMA_VERSION) errors.push('This backup was made by a newer version of BeFyn. Update the app first.');
  if (!b.data || typeof b.data !== 'object') errors.push('The backup has no data.');
  else for (const [store, key] of Object.entries(REQUIRED_KEYS)) {
    const rows = b.data[store];
    if (rows === undefined) continue; // older/partial backups are allowed
    if (!Array.isArray(rows)) { errors.push(`"${store}" is not a list.`); continue; }
    const missing = rows.findIndex((r) => !r || r[key] === undefined);
    if (missing >= 0) errors.push(`A record in "${store}" has no ${key}.`);
  }
  if (!errors.length) { // relationships
    const inst = new Set((b.data.instances || []).map((i) => i.id)), sess = new Set((b.data.scheduled || []).map((s) => s.id));
    for (const s of b.data.scheduled || []) if (!inst.has(s.instanceId)) { errors.push('A scheduled session refers to a programme that is not in the backup.'); break; }
    for (const l of b.data.logs || []) if (l.scheduledId && !sess.has(l.scheduledId)) { errors.push('A workout log refers to a session that is not in the backup.'); break; }
  }
  return errors;
}

/**
 * mode 'replace': the backup becomes the data (after a safety snapshot of the current data).
 * mode 'merge': adds what is missing; existing workout logs and records are never overwritten.
 */
export async function importBackup(repos, b, { mode = 'merge' } = {}) {
  const errors = validateBackup(b);
  if (errors.length) return fail('invalid-backup', errors[0], { errors });
  const snapshot = await exportBackup(repos, { includeLegacy: false });
  const writes = [];
  let added = 0, skipped = 0;
  for (const [store, rows] of Object.entries(b.data)) {
    if (!STORES[store] || !Array.isArray(rows)) continue;
    if (mode === 'replace') writes.push({ op: 'clear', store });
    const key = STORES[store].keyPath;
    const existing = mode === 'merge' ? new Set((await repos.adapter.getAll(store)).map((r) => r[key])) : new Set();
    for (const r of rows) {
      if (mode === 'merge' && existing.has(r[key])) { skipped++; continue; }
      writes.push({ op: 'put', store, value: r }); added++;
    }
  }
  if (mode === 'replace') { // keep the safety snapshots that live in meta
    const keep = (await repos.adapter.getAll('meta')).filter((r) => String(r.key).startsWith('backup.'));
    keep.forEach((r) => { if (r.key !== 'backup.pre-restore') writes.push({ op: 'put', store: 'meta', value: r }); });
  }
  writes.push(repos.meta.op('backup.pre-restore', { at: new Date().toISOString(), snapshot })); // last, so a 'clear' above cannot remove it
  await repos.adapter.transact(writes);
  return ok({ added, skipped, mode });
}
