import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { webcrypto } from 'node:crypto';
import { memoryAdapter, createRepos } from '../www/src/data/db.js';
import { createApp } from '../www/src/services/app.js';
import { migrateFromV5 } from '../www/src/data/migration.js';
import * as Prog from '../www/src/domain/programme.js';

const rd = (f) => JSON.parse(fs.readFileSync(new URL('../www/assets/seed/' + f, import.meta.url)));
const seed = { template: rd('programme-8wk-muscle-gain.json'), exercises: rd('exercises.json') };

function fakePlatform() {
  const saved = [], store = new Map();
  return {
    saved,
    files: { saveText: async (n, t) => { saved.push({ n, t }); return { ok: true, where: 'test/' + n }; }, saveBase64: async () => ({ ok: true }), loadXlsx: async () => { throw new Error('no xlsx'); }, readArrayBuffer: async () => new ArrayBuffer(0) },
    notifications: { validate: () => [], scheduleAll: async (r) => ({ ok: true, count: r.filter((x) => x.enabled).length }), requestPermission: async () => 'granted' },
    health: { status: async () => ({ availability: 'unavailable', granted: [] }), requestAccess: async () => ({ ok: false }), sync: async () => ({ ok: false, reason: 'unavailable' }) },
    storage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) }, subtle: webcrypto.subtle,
  };
}
async function boot(todayRef = { d: '2026-11-02' }) {
  const repos = createRepos(memoryAdapter());
  await migrateFromV5({ repos, storage: { getItem: () => null }, loadSeed: async () => seed });
  const app = createApp({ repos, platform: fakePlatform(), clock: () => todayRef.d });
  await app.refresh();
  return { app, repos, todayRef };
}

test('fresh install: catalogue loaded, no programme yet; start programme creates instance + 56 sessions', async () => {
  const { app } = await boot();
  assert.equal(app.state.programme, null);
  assert.equal(app.state.exercises.length, seed.exercises.length);
  const r = await app.startProgramme({ templateId: 'tpl-8wk-muscle-gain', startDate: '2026-11-02' });
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(app.state.programme.sessions.length, 56);
  assert.equal(app.nextSession().seq, 0);
  assert.equal((await app.startProgramme({ templateId: 'tpl-8wk-muscle-gain' })).error.code, 'already-active');
});

test('workout flow: draft survives a "restart", finish saves log + advances cursor exactly once', async () => {
  const { app, repos, todayRef } = await boot(); await app.startProgramme({ templateId: 'tpl-8wk-muscle-gain', startDate: '2026-11-02' });
  const sc = app.nextSession(); const plan = app.sessionPlan(sc.id);
  const s = await app.startDraft({ kind: 'scheduled', scheduledId: sc.id }); assert.ok(s.ok);
  const mainIdx = plan.steps.findIndex((x) => x.section === 'main');
  await app.recordSet(s.draft, mainIdx, { reps: 12, kg: 5 });
  await app.recordSet(s.draft, mainIdx + 1, { reps: 11, kg: 5 });
  // simulate app killed and reopened: new app instance over same repos
  const app2 = createApp({ repos, platform: fakePlatform(), clock: () => todayRef.d }); await app2.refresh();
  assert.ok(app2.state.draft); assert.equal(Object.keys(app2.state.draft.records).length, 2);
  assert.ok((await app2.startDraft({ kind: 'scheduled', scheduledId: sc.id })).resumed);
  const fin = await app2.finishSession(app2.state.draft, { feedback: { effort: 7 } });
  assert.ok(fin.ok, JSON.stringify(fin));
  assert.equal(app2.state.programme.instance.cursor.seq, 1);
  assert.equal(app2.state.draft, null);
  assert.equal(app2.state.logs.length, 1);
  assert.equal(app2.state.logs[0].performances.reduce((n, p) => n + p.sets.length, 0), 2);
  // repeated finish with the same draft must not advance again or add a log
  const again = await app2.finishSession(s.draft); assert.ok(again.alreadyCompleted);
  assert.equal(app2.state.programme.instance.cursor.seq, 1); assert.equal(app2.state.logs.length, 1);
});

test('out-of-sequence completion is refused without writing anything', async () => {
  const { app } = await boot(); await app.startProgramme({ templateId: 'tpl-8wk-muscle-gain', startDate: '2026-11-02' });
  const far = app.state.programme.sessions.find((s) => s.week === 4);
  const d = await app.startDraft({ kind: 'scheduled', scheduledId: far.id }); assert.ok(d.ok);
  const r = await app.finishSession(d.draft);
  assert.equal(r.ok, false); assert.equal(r.error.code, 'out-of-sequence');
  assert.equal(app.state.logs.length, 0); assert.equal(app.state.programme.instance.cursor.seq, 0);
});

test('missed three weeks: preview, apply shift, persisted after reload, undo restores', async () => {
  const { app, repos, todayRef } = await boot(); await app.startProgramme({ templateId: 'tpl-8wk-muscle-gain', startDate: '2026-11-02' });
  todayRef.d = '2026-11-21'; await app.refresh();
  assert.equal(app.scheduleStatus().missed.length, 19);
  const p = app.previewSchedule({ type: 'resolveMissed', mode: 'shift' });
  assert.ok(p.valid); assert.equal(p.cursorAfter, 0);
  assert.equal((await app.applySchedule({ type: 'resolveMissed', mode: 'shift' })).ok, true);
  assert.equal(app.nextSession().date, '2026-11-21'); assert.equal(app.nextSession().week, 1);
  const reload = createApp({ repos, platform: fakePlatform(), clock: () => '2026-11-21' }); await reload.refresh();
  assert.equal(reload.nextSession().date, '2026-11-21'); assert.equal(reload.state.changes.length, 1);
  const u = await reload.undoSchedule(reload.state.changes[0].id); assert.ok(u.ok, JSON.stringify(u));
  assert.equal(reload.scheduleStatus().missed.length, 19);
});

test('editing a published programme forks a new version; the running instance keeps its version', async () => {
  const { app } = await boot(); await app.startProgramme({ templateId: 'tpl-8wk-muscle-gain', startDate: '2026-11-02' });
  const f = await app.forkTemplate('tpl-8wk-muscle-gain'); assert.ok(f.ok); assert.equal(f.draft.version, 2);
  f.draft.name = 'Edited'; await app.saveTemplateDraft(f.draft);
  const pub = await app.publishTemplate('tpl-8wk-muscle-gain', 2); assert.ok(pub.ok);
  assert.equal(app.state.programme.instance.templateVersion, 1);
  assert.equal(app.state.programme.template.name, '8-Week Progressive Muscle Gain');
  assert.equal((await app.repos.templates.save({ ...pub.template, name: 'x' })).ok, false);
});

test('exercise master refuses duplicates and keeps usage info', async () => {
  const { app } = await boot();
  const dup = await app.saveExercise({ name: 'goblet  SQUAT' }); assert.equal(dup.ok, false); assert.equal(dup.error.code, 'duplicate');
  const mk = await app.saveExercise({ name: 'Zercher Squat', category: 'strength', primaryMuscles: ['Legs'] }); assert.ok(mk.ok);
  assert.ok(app.exercise(mk.exercise.id));
  assert.ok(app.exerciseUsage('goblet-squat').templates.length >= 1);
  assert.ok((await app.addExerciseLink(mk.exercise.id, 'https://youtu.be/abc')).ok);
  assert.equal((await app.addExerciseLink(mk.exercise.id, 'javascript:alert(1)')).ok, false);
});

test('builder: weekly pattern becomes a publishable programme that can start', async () => {
  const { app } = await boot();
  const r = await app.buildFromPattern({ name: 'Home 3-day', objective: 'Strength', weeks: 4, progression: { everyWeeks: 1, addReps: 1 },
    pattern: [{ name: 'Day A', dayOfWeek: 1, items: [{ exercise: 'goblet-squat', name: 'Goblet Squat', sets: 3, reps: 10, load: '5 kg', rest: 60 }] }, { name: 'Day B', dayOfWeek: 3, items: [{ exercise: 'dead-bug', name: 'Dead Bug', sets: 3, reps: 8, load: 'Bodyweight' }] }] });
  assert.ok(r.ok);
  const pub = await app.publishTemplate(r.draft.id, 1); assert.ok(pub.ok, JSON.stringify(pub));
  const st = await app.startProgramme({ templateId: r.draft.id, startDate: '2026-12-01', trainingDays: [1, 3] });
  assert.ok(st.ok); assert.equal(app.state.programme.sessions.length, 8);
  assert.equal(app.state.programme.template.sessions.find((s) => s.week === 4 && s.name === 'Day A').sections.main[0].items[0].reps, 13);
});

test('standalone workout, quick activity, past-session log never double-advance', async () => {
  const { app, todayRef } = await boot(); await app.startProgramme({ templateId: 'tpl-8wk-muscle-gain', startDate: '2026-11-02' });
  assert.ok((await app.logActivity({ name: 'Evening walk', minutes: 30 })).ok);
  assert.equal(app.state.programme.instance.cursor.seq, 0);
  const sc = app.nextSession();
  assert.ok((await app.logPastSession({ scheduledId: sc.id, date: '2026-11-02', durationMin: 60, effort: 6 })).ok);
  assert.ok((await app.logPastSession({ scheduledId: sc.id, date: '2026-11-02' })).alreadyCompleted);
  assert.equal(app.state.programme.instance.cursor.seq, 1);
  assert.equal(app.state.logs.length, 2);
});

test('protein, measurements, reminders and insights work together', async () => {
  const { app } = await boot();
  assert.ok((await app.setProteinTarget(130)).ok);
  assert.ok((await app.addProtein({ item: 'Paneer 100 g', proteinG: 18, meal: 'Lunch' })).ok);
  assert.ok((await app.addProtein({ item: 'Whey', proteinG: 24, meal: 'Shake / supplement', estimate: false })).ok);
  const d = app.proteinDay(); assert.equal(d.total, 42); assert.equal(d.remaining, 88); assert.equal(d.estimated, 18);
  assert.equal((await app.addProtein({ item: 'x', proteinG: -3 })).ok, false);
  assert.ok((await app.addMeasurement({ type: 'weight', value: 72.5 })).ok); assert.equal((await app.addMeasurement({ type: 'weight', value: 'abc' })).ok, false);
  assert.equal(app.latestMeasurements().weight.value, 72.5);
  const rem = await app.saveReminder({ kind: 'workout', time: '07:30', days: [1, 3, 5] }); assert.ok(rem.ok); assert.equal(rem.scheduling.count, 1);
  assert.equal((await app.saveReminder({ time: '25:00' })).ok, false);
  const ins = app.insights(); assert.equal(ins.readiness.level, 'unknown'); assert.equal(ins.weekly.length, 8);
});

test('backup export -> erase -> restore returns the same data', async () => {
  const { app } = await boot(); await app.startProgramme({ templateId: 'tpl-8wk-muscle-gain', startDate: '2026-11-02' });
  await app.addProtein({ item: 'Egg', proteinG: 6 }); await app.logActivity({ name: 'Walk', minutes: 20 });
  const exp = await app.exportBackupFile(); assert.ok(exp.ok);
  const text = app.platform.saved.at(-1).t;
  assert.equal((await app.eraseEverything({ confirm: 'nope' })).ok, false);
  await app.eraseEverything({ confirm: 'ERASE' }); assert.equal(app.state.programme, null); assert.equal(app.state.logs.length, 0);
  const r = await app.restoreBackupText(text, 'replace'); assert.ok(r.ok, JSON.stringify(r));
  assert.equal(app.state.programme.sessions.length, 56); assert.equal(app.state.logs.length, 1); assert.equal(app.state.nutrition.length, 1);
});
