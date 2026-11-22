import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { memoryAdapter, createRepos, counts } from '../www/src/data/db.js';
import { migrateFromV5, mapLegacy, verify, LEGACY, decryptLegacyVault, mapLegacyHealth } from '../www/src/data/migration.js';
import { webcrypto } from 'node:crypto';

const rd = (f) => JSON.parse(fs.readFileSync(new URL('../www/assets/seed/' + f, import.meta.url)));
const seed = { template: rd('programme-8wk-muscle-gain.json'), exercises: rd('exercises.json') };
const ctx = {}; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(new URL('../legacy/plan_v4.js', import.meta.url), 'utf8') + ';this.P=PLAN4', ctx);
const PLAN4 = ctx.P;

// Build a V5-shaped state the way V5.0's own expand()/sideRest() would have: Left/Right rows for "/side" exercises.
const cp = (x) => JSON.parse(JSON.stringify(x));
function v5Prog() {
  const W = {};
  for (const w of Object.keys(PLAN4.plan)) { W[w] = {};
    for (const d of Object.keys(PLAN4.plan[w])) {
      const s = PLAN4.plan[w][d], o = [];
      cp(s.ex).forEach((e) => { if (/\/(side|leg|arm|hand)\b/.test(e.rt)) ['Left', 'Right'].forEach((sd) => { const x = cp(e); x.sd = sd; o.push(x); }); else o.push(e); });
      W[w][d] = { name: s.name, ex: o };
    } }
  return { weeks: W, v4: 1 };
}
const mkStorage = (obj) => ({ getItem: (k) => (k in obj ? obj[k] : null), setItem: (k, v) => { obj[k] = v; } });
const logsFor = (date, routine, names, c = 'main') => names.map((e) => ({ d: date, r: routine, e, c, m: 'Chest', reps: 10, kg: 5, s: 0, sets: 3, rt: '10 reps', rs: 45 }));

function legacyState() {
  const week1 = PLAN4.plan[1];
  return {
    logs: [
      ...logsFor('2026-11-02', 'Week 1 - ' + week1[1].name, ['Flat Dumbbell Bench Press', 'Flat Dumbbell Bench Press', 'Incline Dumbbell Fly']),
      ...logsFor('2026-11-03', 'Week 1 - ' + week1[2].name, ['Goblet Squat'], 'pre'),            // warm-up only: partial
      ...logsFor('2026-11-04', 'My own thing', ['Burpee']),                                      // not a programme day
    ],
    set: { rest: 50, brk: 90, tr: 10, brb: 30, rep: 4 }, voice: true, br: { i: 4, h: 0, o: 6, h2: 0 },
    apps: [{ l: 'Strava', u: 'https://www.strava.com/dashboard' }], ov: {}, prog: v5Prog(), sess: {}, lib: [{ id: 'c1', n: 'Zottman Curl', m: 'Arms', yt: 'https://youtu.be/x' }], ytl: {}, libHide: {}, tpl: [{ name: 'My saved plan' }],
  };
}

test('migrates a stock V5 state: seed template used, history preserved, relationships verified', async () => {
  const repos = createRepos(memoryAdapter()); const st = mkStorage({ [LEGACY.state]: JSON.stringify(legacyState()) });
  const r = await migrateFromV5({ repos, storage: st, loadSeed: async () => seed });
  assert.equal(r.status, 'migrated', JSON.stringify(r));
  assert.equal(r.report.programme, 'seed');
  assert.equal(r.report.scheduledSessions, 56);
  assert.equal(r.report.sets, 5);
  assert.equal(r.report.sessionLogs, 3);
  assert.equal(r.report.sessionsCompleted, 1);           // only the main-set day completes its session
  const inst = await repos.instances.get('inst-v5-migrated');
  assert.equal(inst.cursor.seq, 1);
  const sessions = await repos.scheduled.byInstance(inst.id);
  assert.equal(sessions.find((s) => s.seq === 0).status, 'completed');
  assert.equal(sessions.find((s) => s.seq === 1).status, 'planned');     // partial warm-up does not complete it
  assert.equal((await repos.logs.all()).length, 3);
  assert.equal((await repos.exercises.get('zottman-curl')).media[0].kind, 'youtube');
  assert.equal((await repos.prefs.get('workout')).restSec, 50);
  assert.equal((await repos.meta.get('migration.v5-to-v6')).status, 'done');
  // original data never touched, safety backup exists
  assert.equal(st.getItem(LEGACY.state), JSON.stringify(legacyState()));
  assert.ok((await repos.meta.get('backup.pre-v6')).state);
});

test('is idempotent: running twice does not duplicate anything', async () => {
  const repos = createRepos(memoryAdapter()); const st = mkStorage({ [LEGACY.state]: JSON.stringify(legacyState()) });
  await migrateFromV5({ repos, storage: st, loadSeed: async () => seed });
  const c1 = await counts(repos);
  const again = await migrateFromV5({ repos, storage: st, loadSeed: async () => seed });
  assert.equal(again.status, 'already-done');
  assert.deepEqual(await counts(repos), c1);
  // forced re-run (e.g. after a failed first attempt) also overwrites by deterministic id
  await repos.meta.set('migration.v5-to-v6', { status: 'failed' });
  await migrateFromV5({ repos, storage: st, loadSeed: async () => seed });
  const c2 = await counts(repos); assert.equal(c2.logs, c1.logs); assert.equal(c2.scheduled, c1.scheduled); assert.equal(c2.instances, c1.instances);
});

test('an edited V5 programme is kept as its own template', async () => {
  const S = legacyState(); S.prog.weeks[1][1].ex[0].n = 'My Custom Press';
  const repos = createRepos(memoryAdapter());
  const r = await migrateFromV5({ repos, storage: mkStorage({ [LEGACY.state]: JSON.stringify(S) }), loadSeed: async () => seed });
  assert.equal(r.report.programme, 'edited'); assert.equal(r.report.templateId, 'tpl-v5-edited');
  const t = await repos.templates.latestPublished('tpl-v5-edited');
  assert.equal(t.sessions.length, 56);
  assert.ok(JSON.stringify(t.sessions[0]).includes('My Custom Press'));
});

test('corrupt legacy data: nothing is written except a failure note, original untouched', async () => {
  const repos = createRepos(memoryAdapter()); const st = mkStorage({ [LEGACY.state]: '{broken' });
  const r = await migrateFromV5({ repos, storage: st, loadSeed: async () => seed });
  assert.equal(r.status, 'failed'); assert.equal(r.stage, 'validate');
  assert.equal((await repos.meta.get('migration.v5-to-v6')).status, 'failed');
  assert.equal((await repos.logs.all()).length, 0);
  assert.equal(st.getItem(LEGACY.state), '{broken');
});

test('failed commit leaves data untouched and does not mark success', async () => {
  const base = memoryAdapter(); const repos = createRepos(base);
  const real = base.transact.bind(base);
  base.transact = async (w) => { if (w.some((x) => x.store === 'logs')) throw new Error('disk full'); return real(w); };
  const r = await migrateFromV5({ repos, storage: mkStorage({ [LEGACY.state]: JSON.stringify(legacyState()) }), loadSeed: async () => seed });
  assert.equal(r.status, 'failed'); assert.equal(r.stage, 'commit');
  assert.equal((await repos.meta.get('migration.v5-to-v6')).status, 'failed');
  assert.equal((await repos.logs.all()).length, 0);
  assert.ok((await repos.meta.get('backup.pre-v6')), 'backup was saved first');
});

test('fresh install (no legacy data) seeds the catalogue and completes', async () => {
  const repos = createRepos(memoryAdapter());
  const r = await migrateFromV5({ repos, storage: mkStorage({}), loadSeed: async () => seed });
  assert.equal(r.status, 'fresh-install');
  assert.equal((await repos.exercises.all()).length, seed.exercises.length);
  assert.equal((await repos.templates.versions('tpl-8wk-muscle-gain')).length, 1);
});

test('verification catches a broken mapping', () => {
  const S = legacyState(); const m = mapLegacy(S, seed);
  assert.deepEqual(verify(m.writes, m.report, S), []);
  const cut = m.writes.filter((w) => !(w.store === 'scheduled' && w.value.seq === 0));
  assert.ok(verify(cut, m.report, S).length > 0);
});

test('legacy encrypted vault decrypts with the right password and maps to measurements', async () => {
  const subtle = webcrypto.subtle, enc = new TextEncoder();
  const b64 = (b) => Buffer.from(b).toString('base64');
  const salt = webcrypto.getRandomValues(new Uint8Array(16)), iv = webcrypto.getRandomValues(new Uint8Array(12));
  const base = await subtle.importKey('raw', enc.encode('hunter22'), 'PBKDF2', false, ['deriveKey']);
  const key = await subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 250000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const cipher = await subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify({ records: [{ date: '2026-11-05', weight: '72.4', systolic: '118', diastolic: '76', glucose: '', notes: 'morning' }] })));
  const vault = JSON.stringify({ salt: b64(salt), iv: b64(iv), cipher: b64(cipher) });
  await assert.rejects(decryptLegacyVault(vault, 'wrong', subtle));
  const data = await decryptLegacyVault(vault, 'hunter22', subtle);
  const meas = mapLegacyHealth(data);
  assert.deepEqual(meas.map((m) => m.type), ['weight', 'systolic', 'diastolic']);
  assert.equal(meas[0].value, 72.4); assert.equal(meas[0].unit, 'kg'); assert.match(meas[0].provenance, /V5\.0/);
});
