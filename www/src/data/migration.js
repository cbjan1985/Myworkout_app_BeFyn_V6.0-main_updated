// V5.0 -> V6.0 migration. Steps: detect, back up, validate, map, verify, commit atomically, mark success last.
// Never deletes or edits the legacy data. Idempotent: deterministic ids mean a retry overwrites the same records.
import { addDays, dow, diffDays } from '../core/util.js';
import { createInstance } from '../domain/programme.js';
import { makeRegistry, convertDay, DAY_ORDER, signature, sigHash, norm } from './legacy-convert.js';

export const LEGACY = { state: 'myWorkouts.v3', vault: 'myWorkouts.v3.health.vault', vaultSalt: 'myWorkouts.v3.health.salt', autobackup: 'myWorkouts.v3.autobackup', mediaDb: 'wk3' };
export const LEGACY_START = '2026-11-02'; // fixed programme start used by V5.0
export const MIGRATION_ID = 'migration.v5-to-v6';

export function detectLegacy(storage) {
  let raw = null; try { raw = storage.getItem(LEGACY.state); } catch (_) { /* storage unavailable */ }
  return { found: !!raw, bytes: raw ? raw.length : 0, hasVault: !!safeGet(storage, LEGACY.vault) };
}
const safeGet = (st, k) => { try { return st.getItem(k); } catch (_) { return null; } };

/* ------------------------------ pure mapping ------------------------------ */
/**
 * @param S parsed V5 state  @param seed { template, exercises }
 * @returns { writes, report, errors }
 */
export function mapLegacy(S, { template, exercises }) {
  const errors = [], warnings = [], writes = [], put = (store, value) => writes.push({ op: 'put', store, value });
  if (!Array.isArray(S.logs)) errors.push('Workout history is not a list.');
  const bad = (S.logs || []).filter((l) => !l || typeof l.d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(l.d) || !l.e);
  if (bad.length) warnings.push(`${bad.length} history row(s) had no valid date or exercise name and were kept only in the recovery backup.`);
  const rows = (S.logs || []).filter((l) => l && /^\d{4}-\d{2}-\d{2}$/.test(l.d || '') && l.e);

  /* preferences */
  const set = S.set || {};
  put('prefs', { key: 'workout', value: { restSec: set.rest ?? 45, breakSec: set.brk ?? 90, transitionSec: set.tr ?? 10, breathBreakSec: set.brb ?? 30, repSec: set.rep ?? 4, autoRest: true } });
  put('prefs', { key: 'voice', value: { enabled: S.voice !== false } });
  if (S.br) put('prefs', { key: 'breathing', value: S.br });
  if (Array.isArray(S.apps)) put('prefs', { key: 'appLinks', value: S.apps });

  /* exercise master: seed + V5 custom library + YouTube links + hidden items */
  const reg = makeRegistry({}, exercises);
  for (const w of S.lib || []) {
    if (!w || !w.n) continue;
    const id = reg.byName.get(norm(w.n));
    if (id) { // already in the catalogue: no duplicate definition, but keep the person's own video link
      const url = String(w.yt || '').split(/[\s,]+/)[0], ex = reg.map.get(id);
      if (/^https?:\/\//i.test(url) && !ex.media.some((m) => m.url === url)) ex.media.push({ kind: 'youtube', url });
      continue;
    }
    const nid = reg.ensure({ n: w.n, m: w.m || 'Custom', c: w.c || 'main', load: w.load || '', x: '', how: w.how || '' });
    const e = reg.map.get(nid); e.source = 'v5-custom'; if (w.id) e.legacyId = w.id; if (w.yt && /^https?:\/\//i.test(String(w.yt))) e.media.push({ kind: 'youtube', url: String(w.yt).split(/[\s,]+/)[0] });
  }
  for (const [k, url] of Object.entries(S.ytl || {})) {
    const id = [...reg.map.values()].find((e) => norm(e.name) === k)?.id; const url0 = String(url || '').split(/[\s,]+/)[0];
    if (id && /^https?:\/\//i.test(url0) && !reg.map.get(id).media.some((m) => m.url === url0)) reg.map.get(id).media.push({ kind: 'youtube', url: url0 });
  }
  for (const k of Object.keys(S.libHide || {})) { const e = [...reg.map.values()].find((x) => norm(x.name) === k); if (e) e.archived = true; }

  /* programme: stock plan -> seed template, edited plan -> a personal template that keeps the edits */
  let tpl = template, programme = 'seed';
  const weeks = S.prog && S.prog.weeks;
  if (weeks && template.legacySignature && sigHash(signature(weeks)) !== template.legacySignature) {
    const sessions = [], diag = {};
    for (const w of Object.keys(weeks).map(Number).sort((a, b) => a - b)) for (const d of DAY_ORDER) { const day = weeks[w][d]; if (day) sessions.push(convertDay({ week: w, dow: d, day, reg, diag })); }
    tpl = { ...template, id: 'tpl-v5-edited', name: 'My V5 programme (edited)', description: 'Your V5.0 programme with the edits you made.', phases: [], legacySignature: undefined, sessions, source: 'v5-edited', weeks: Math.max(...sessions.map((s) => s.week)) };
    put('templates', { ...tpl, key: `${tpl.id}@${tpl.version}` }); programme = 'edited';
    warnings.push('Your edited V5.0 programme was kept as a separate personal template.');
  }
  /* exercises are written after all registrations */

  /* instance + schedule */
  const used = [...new Set((weeks ? Object.values(weeks) : []).flatMap((w) => Object.keys(w).map(Number)))];
  const days = used.length ? DAY_ORDER.filter((d) => used.includes(d)) : DAY_ORDER;
  let n = 0;
  const made = createInstance({ template: tpl, startDate: LEGACY_START, trainingDays: days, name: tpl.name, newId: () => `ss-v5-${n++}` });
  if (!made.ok) { errors.push(made.error.message); return { writes: [], report: {}, errors, warnings }; }
  made.instance.id = 'inst-v5-migrated'; made.instance.source = 'v5-migration';
  made.sessions.forEach((s) => { s.instanceId = made.instance.id; });
  const byDate = new Map(made.sessions.map((s) => [s.date, s]));

  /* history: V5 stored one row per completed set; group by day + routine into session logs */
  const groups = new Map();
  for (const r of rows) { const k = `${r.d}\u0001${r.r || ''}`; (groups.get(k) || groups.set(k, []).get(k)).push(r); }
  let li = 0, setCount = 0, linked = 0; const linkedSessions = new Set(); const logs = [];
  for (const [k, list] of [...groups].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const [date, routine] = k.split('\u0001');
    const pm = /^Week (\d+) - /.exec(routine);
    let sess = pm ? byDate.get(date) : null;
    if (sess && linkedSessions.has(sess.id)) sess = null; // a second run of the same day never advances the programme twice
    const hasMain = list.some((r) => r.c === 'main');
    const complete = !!sess && (hasMain || (tpl.sessions.find((x) => x.id === sess.ref)?.kind === 'recovery'));
    const perf = new Map(); let seq = 0;
    for (const r of list) {
      const id = reg.byName.get(norm(r.e)) || reg.ensure({ n: r.e, m: r.m || 'Other', c: r.c || 'main', load: '' });
      const pk = `${id}|${r.sd || ''}`;
      if (!perf.has(pk)) perf.set(pk, { id: `perf-v5-${li}-${seq}`, exercise: id, name: r.e, category: r.c || 'main', sequence: seq++, side: r.sd || undefined, sets: [], notes: '' });
      perf.get(pk).sets.push({ reps: r.reps || 0, kg: r.kg || 0, secs: r.s || 0, restSec: r.rs || 0, done: true }); setCount++;
    }
    const log = { id: `log-v5-${li++}`, instanceId: sess ? made.instance.id : undefined, scheduledId: sess ? sess.id : undefined, sessionRef: sess ? sess.ref : undefined, date, name: routine || 'Workout', status: complete || !sess ? 'completed' : 'partial', performances: [...perf.values()], notes: '', feedback: null, source: 'v5-migration' };
    logs.push(log);
    if (sess && complete) { sess.status = 'completed'; sess.performedOn = date; sess.logId = log.id; linkedSessions.add(sess.id); linked++; }
  }
  made.instance.cursor = { seq: made.sessions.filter((s) => s.status === 'completed').length ? firstOpen(made.sessions) : 0 };
  put('instances', made.instance); made.sessions.forEach((s) => put('scheduled', s)); logs.forEach((l) => put('logs', l));

  /* per-day overrides, saved sessions and saved plans become Saved workouts (nothing is dropped) */
  let saved = 0;
  for (const [date, o] of Object.entries(S.ov || {})) {
    if (!o || !Array.isArray(o.ex)) continue;
    const s = convertDay({ week: 0, dow: dow(date), day: { name: o.name || `Custom day ${date}`, ex: o.ex }, reg, diag: {} });
    put('workouts', { id: `wo-v5-ov-${date}`, name: o.name || `Custom day ${date}`, category: 'custom-day', date, sections: s.sections, source: 'v5-override' }); saved++;
  }
  for (const id of ['yoga', 'cardio']) {
    const x = S.sess && S.sess[id]; if (!x || !Array.isArray(x.ex)) continue;
    const s = convertDay({ week: 0, dow: 1, day: { name: x.name || id, ex: x.ex.map((e) => ({ c: 'flow', ...e })) }, reg, diag: {} });
    put('workouts', { id: `wo-v5-${id}`, name: x.name || id, category: id, sections: s.sections, source: 'v5-session' }); saved++;
  }
  (Array.isArray(S.tpl) ? S.tpl : []).forEach((t, i) => { put('workouts', { id: `wo-v5-tpl-${i}`, name: (t && (t.name || t.n)) || `Saved plan ${i + 1}`, category: 'saved-plan', legacy: t, source: 'v5-saved-plan' }); saved++; });
  if (S.snotes && Object.keys(S.snotes).length) put('meta', { key: 'legacy.sessionNotes', value: S.snotes });

  [...reg.map.values()].forEach((e) => put('exercises', e));
  const report = { programme, templateId: tpl.id, scheduledSessions: made.sessions.length, sessionsCompleted: linked, sessionLogs: logs.length, sets: setCount, savedWorkouts: saved, exercises: reg.map.size, customExercises: [...reg.map.values()].filter((e) => e.source === 'v5-custom').length, legacyRows: (S.logs || []).length, skippedRows: bad.length };
  return { writes, report, errors, warnings, template: tpl };
}
const firstOpen = (sessions) => { const s = sessions.find((x) => x.status === 'planned'); return s ? s.seq : sessions.length; };

/** Post-commit style verification over the planned writes (counts, relationships, essential values). */
export function verify(writes, report, S) {
  const problems = []; const by = (st) => writes.filter((w) => w.store === st).map((w) => w.value);
  const logs = by('logs'), sess = by('scheduled'), inst = by('instances'), ex = new Set(by('exercises').map((e) => e.id));
  const sets = logs.reduce((t, l) => t + l.performances.reduce((a, p) => a + p.sets.length, 0), 0);
  const valid = (S.logs || []).filter((l) => l && /^\d{4}-\d{2}-\d{2}$/.test(l.d || '') && l.e).length;
  if (sets !== valid) problems.push(`History sets: expected ${valid}, mapped ${sets}.`);
  if (inst.length !== 1) problems.push('Programme instance missing.');
  const ids = new Set(sess.map((s) => s.id));
  for (const l of logs) {
    if (l.scheduledId && !ids.has(l.scheduledId)) problems.push(`Log ${l.id} points to a missing session.`);
    for (const p of l.performances) if (!ex.has(p.exercise)) problems.push(`Log ${l.id} uses an unknown exercise.`);
  }
  const completed = sess.filter((s) => s.status === 'completed');
  if (completed.some((s) => !logs.find((l) => l.id === s.logId))) problems.push('A completed session has no workout log.');
  if (new Set(sess.map((s) => s.date)).size !== sess.length) problems.push('Two scheduled sessions share a date.');
  return problems;
}

/* ------------------------------ runner ------------------------------ */
/**
 * @param {{repos:any, storage:any, loadSeed:()=>Promise<{template:any,exercises:any[]}>, now?:()=>string, writeBackupFile?:(name:string,text:string)=>Promise<string|null>}} deps
 */
export async function migrateFromV5({ repos, storage, loadSeed, now = () => new Date().toISOString(), writeBackupFile }) {
  const prior = await repos.meta.get(MIGRATION_ID);
  if (prior && prior.status === 'done') return { status: 'already-done', report: prior.report };
  const fail = async (stage, message, extra = {}) => {
    const rec = { status: 'failed', stage, message, at: now(), ...extra };
    try { await repos.meta.set(MIGRATION_ID, rec); } catch (_) { /* meta write failed too */ }
    return { status: 'failed', stage, message, recovery: 'Your V5.0 data is untouched. Retry, or restore the recovery backup from More > Data.', ...extra };
  };
  const det = detectLegacy(storage);
  const seed = await loadSeed();
  if (!det.found) {
    await repos.write([...seedOps(seed), repos.meta.op(MIGRATION_ID, { status: 'done', at: now(), report: { fresh: true } })]);
    return { status: 'fresh-install' };
  }
  let S; const raw = storage.getItem(LEGACY.state);
  try { S = JSON.parse(raw); } catch (e) { return fail('validate', 'Your saved V5.0 data could not be read, so nothing was changed.'); }
  if (!S || typeof S !== 'object') return fail('validate', 'Your saved V5.0 data has an unexpected format, so nothing was changed.');

  // 1. recoverable backup before touching anything
  const stamp = now().replace(/[:.]/g, '-');
  const backup = { kind: 'befyn-pre-v6-backup', at: now(), state: raw, vault: safeGet(storage, LEGACY.vault), vaultSalt: safeGet(storage, LEGACY.vaultSalt) };
  let file = null;
  try { await repos.write([repos.meta.op('backup.pre-v6', backup)]); } catch (e) { return fail('backup', 'A safety backup could not be saved, so the upgrade was stopped before changing anything.'); }
  try { if (writeBackupFile) file = await writeBackupFile(`BeFyn-pre-v6-backup-${stamp}.json`, JSON.stringify(backup)); } catch (_) { /* file copy is best effort; the in-app copy exists */ }

  // 2. map + verify
  const mapped = mapLegacy(S, seed);
  if (mapped.errors.length) return fail('map', mapped.errors[0], { errors: mapped.errors });
  const problems = verify(mapped.writes, mapped.report, S);
  if (problems.length) return fail('verify', problems[0], { problems });

  // 3. atomic commit; success is recorded in the same transaction, so it can never be marked early
  const record = { status: 'done', at: now(), report: mapped.report, warnings: mapped.warnings, backupFile: file, hasLegacyVault: det.hasVault };
  try { await repos.write([...seedOps(seed), ...mapped.writes, repos.meta.op('legacy.hasVault', det.hasVault), repos.meta.op(MIGRATION_ID, record)]); }
  catch (e) { return fail('commit', 'The upgrade could not be saved. Your V5.0 data is untouched.', { detail: String(e && e.message || e) }); }
  return { status: 'migrated', report: mapped.report, warnings: mapped.warnings, backupFile: file };
}

/** Seed content ops (template + catalogue). Existing user records are never overwritten. */
export function seedOps(seed) {
  const ops = [{ op: 'put', store: 'templates', value: { ...seed.template, key: `${seed.template.id}@${seed.template.version}` } }];
  for (const e of seed.exercises) ops.push({ op: 'put', store: 'exercises', value: e });
  return ops;
}

/* ------------------------------ legacy encrypted health vault ------------------------------ */
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
/** Decrypts the V5.0 vault with the person's own password (PBKDF2-SHA256 250k + AES-GCM, as V5.0 wrote it). */
export async function decryptLegacyVault(vaultJson, password, subtle = globalThis.crypto?.subtle) {
  if (!subtle) throw new Error('Secure decryption is not available in this WebView.');
  const o = JSON.parse(vaultJson);
  const base = await subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  const key = await subtle.deriveKey({ name: 'PBKDF2', salt: unb64(o.salt), iterations: 250000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const plain = await subtle.decrypt({ name: 'AES-GCM', iv: unb64(o.iv) }, key, unb64(o.cipher));
  return JSON.parse(new TextDecoder().decode(plain));
}

/** V5 health records -> BodyMeasurement rows (deterministic ids, so re-import never duplicates). */
export function mapLegacyHealth(data) {
  const out = []; const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));
  const defs = [['weight', 'kg'], ['height', 'cm'], ['systolic', 'mmHg'], ['diastolic', 'mmHg'], ['glucose', 'mg/dL'], ['hba1c', '%'], ['bodyFat', '%'], ['muscleMass', 'as entered']];
  for (const r of data.records || []) {
    if (!r.date) continue;
    for (const [type, unit] of defs) {
      const v = num(r[type]); if (v == null) continue;
      out.push({ id: `meas-v5-${r.date}-${type}`, type, value: v, unit, date: r.date, recordedAt: `${r.date}T00:00:00`, source: 'manual', provenance: 'Imported from the V5.0 protected health tracker', notes: type === 'glucose' ? r.glucoseType || '' : (type === 'weight' ? r.notes || '' : '') });
    }
  }
  return out;
}
export { addDays, diffDays };
