// Measurements, protein, reminders, Health Connect and insights.
import { uid, ok, fail, addDays } from '../core/util.js';
import * as Nutr from '../domain/nutrition.js';
import * as Insights from '../domain/insights.js';
import * as Progress from '../domain/progression.js';
import * as HC from '../platform/health.js';
import { buildNotifications } from '../domain/reminders.js';

export const MEASURE_TYPES = [
  { id: 'weight', label: 'Body weight', unit: 'kg' }, { id: 'height', label: 'Height', unit: 'cm' }, { id: 'bodyFat', label: 'Body fat', unit: '%' }, { id: 'muscleMass', label: 'Muscle mass', unit: 'kg' },
  { id: 'waist', label: 'Waist', unit: 'cm' }, { id: 'chest', label: 'Chest', unit: 'cm' }, { id: 'arm', label: 'Arm', unit: 'cm' }, { id: 'thigh', label: 'Thigh', unit: 'cm' },
  { id: 'systolic', label: 'Blood pressure (top)', unit: 'mmHg' }, { id: 'diastolic', label: 'Blood pressure (bottom)', unit: 'mmHg' }, { id: 'glucose', label: 'Glucose', unit: 'mg/dL' }, { id: 'hba1c', label: 'HbA1c', unit: '%' },
];

export function installTracking(app) {
  const { repos } = app; const P = () => app.platform;

  /* ---------------- body measurements ---------------- */
  app.addMeasurement = async ({ type, value, date, notes = '' }) => {
    const def = MEASURE_TYPES.find((t) => t.id === type); const v = Number(value);
    if (!def) return fail('invalid', 'Choose what you measured.');
    if (!Number.isFinite(v) || v <= 0) return fail('invalid', 'Enter a number greater than zero.');
    const rec = { id: uid('meas'), type, value: v, unit: def.unit, date: date || app.today(), recordedAt: new Date().toISOString(), source: 'manual', provenance: 'Entered in BeFyn', notes };
    await repos.write([repos.measurements.op(rec)]); await app.refresh(); return ok({ record: rec });
  };
  app.deleteMeasurement = async (id) => { await repos.write([repos.measurements.delOp(id)]); await app.refresh(); return ok(); };
  app.latestMeasurements = () => { const m = {}; for (const r of app.state.measurements) if (!m[r.type]) m[r.type] = r; return m; };
  app.measurementSeries = (type) => app.state.measurements.filter((m) => m.type === type).map((m) => ({ date: m.date, value: m.value, source: m.source })).reverse();

  /** Body weight from the app and from Health Connect side by side, never merged silently. */
  app.weightSources = () => {
    const mine = app.state.measurements.filter((m) => m.type === 'weight').map((m) => ({ date: m.date, value: m.value, source: 'Entered in BeFyn' }));
    const ext = app.state.health.filter((h) => h.type === 'weight').map((h) => ({ date: h.start.slice(0, 10), value: Math.round(h.value * 10) / 10, source: h.source + ' (Health Connect)' }));
    return [...mine, ...ext].sort((a, b) => (a.date < b.date ? 1 : -1));
  };

  /* ---------------- nutrition ---------------- */
  app.proteinTarget = () => app.state.prefs.nutrition?.proteinTargetG || 0;
  app.setProteinTarget = async (g) => { const n = Number(g); if (!(n >= 0 && n <= 500)) return fail('invalid', 'Choose a target between 0 and 500 g.'); await app.updatePref('nutrition', { proteinTargetG: n }); return ok(); };
  app.addProtein = async ({ item, proteinG, meal = 'Snack', date, estimate = true }) => {
    const g = Number(proteinG); if (!item?.trim()) return fail('invalid', 'Describe what you ate.'); if (!(g > 0 && g <= 300)) return fail('invalid', 'Enter protein between 1 and 300 g.');
    const rec = { id: uid('nut'), date: date || app.today(), meal, item: item.trim(), proteinG: g, estimate: !!estimate, source: 'manual', recordedAt: new Date().toISOString() };
    await repos.write([repos.nutrition.op(rec)]); await app.refresh(); return ok({ entry: rec });
  };
  app.updateProtein = async (id, patch) => {
    const cur = app.state.nutrition.find((e) => e.id === id); if (!cur) return fail('not-found', 'That entry no longer exists.');
    const g = patch.proteinG !== undefined ? Number(patch.proteinG) : cur.proteinG;
    if (!(patch.item ?? cur.item).trim()) return fail('invalid', 'Describe what you ate.'); if (!(g > 0 && g <= 300)) return fail('invalid', 'Enter protein between 1 and 300 g.');
    await repos.write([repos.nutrition.op({ ...cur, ...patch, proteinG: g, item: (patch.item ?? cur.item).trim() })]); await app.refresh(); return ok();
  };
  app.removeProtein = async (id) => { await repos.write([repos.nutrition.delOp(id)]); await app.refresh(); return ok(); };
  app.proteinDay = (date) => Nutr.dayTotals(app.state.nutrition, date || app.today(), app.proteinTarget());
  app.proteinHistory = (days = 14) => Nutr.history(app.state.nutrition, app.today(), days, app.proteinTarget());
  app.proteinWeek = () => Nutr.weeklyAverage(app.state.nutrition, app.today(), app.proteinTarget());

  /* ---------------- reminders ---------------- */
  app.saveReminder = async (r) => {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(r.time || '')) return fail('invalid', 'Choose a valid time.');
    const rec = { id: r.id || uid('rem'), kind: r.kind || 'custom', title: r.title || '', body: r.body || '', time: r.time, days: r.days || [], enabled: r.enabled !== false };
    await repos.write([repos.reminders.op(rec)]); await app.refresh(); const sched = await app.applyReminders(); return ok({ reminder: rec, scheduling: sched });
  };
  app.deleteReminder = async (id) => { await repos.write([repos.reminders.delOp(id)]); await app.refresh(); await app.applyReminders(); return ok(); };
  app.applyReminders = async () => {
    const N = P().notifications; if (!N) return { ok: false, reason: 'unsupported' };
    const p = app.state.programme;
    const plan = buildNotifications({ reminders: app.state.reminders, sessions: p ? p.sessions : [], instanceStatus: p ? p.instance.status : 'none', today: app.today(), now: new Date(), detailed: app.state.prefs.privacy?.notificationDetail === true });
    const res = await N.scheduleAll(plan);
    return { ...res, problems: N.validate(app.state.reminders), plan };
  };
  app.enableReminders = async () => { const p = await P().notifications.requestPermission(); return p; };

  /* ---------------- Health Connect ---------------- */
  app.healthStatus = async () => P().health.status();
  app.connectHealth = async (types) => { const r = await P().health.requestAccess(types); await app.repos.meta.set('health.requested', types); return r; };
  app.syncHealth = async (opts) => { const r = await P().health.sync(repos, opts); await app.refresh(); return r; };
  app.disconnectHealthData = async () => { await repos.write([repos.health.clearOp(), repos.meta.op('health.lastSync', null)]); await app.refresh(); return ok(); };
  app.healthDaily = (type) => HC.dailySummary(app.state.health, type);

  /* ---------------- insights ---------------- */
  app.insights = () => {
    const s = app.state, today = app.today();
    const logs = s.logs.filter((l) => l.status === 'completed');
    const sleep = HC.latest(s.health, 'sleep');
    const health = { sleepHours: sleep && sleep.end && sleep.end.slice(0, 10) >= addDays(today, -1) ? sleep.value : null, sleepSource: sleep?.source };
    const perf = []; for (const l of logs) for (const p of l.performances || []) perf.push({ date: l.date, exercise: p.exercise, muscles: s.exIndex.get(p.exercise)?.primaryMuscles || [], sets: p.sets });
    const strength = perf.filter((p) => s.exIndex.get(p.exercise)?.category === 'strength');
    const records = Progress.personalRecords(strength).filter((r) => r.maxKg).sort((a, b) => (b.maxKg.date > a.maxKg.date ? 1 : -1)).slice(0, 12).map((r) => ({ ...r, name: s.exIndex.get(r.exercise)?.name || r.exercise }));
    const w = Insights.trend(app.weightSources().map((x) => ({ date: x.date, value: x.value })));
    return {
      readiness: Insights.readiness(logs, today, health), load: Insights.trainingLoad(logs, today), loadSeries: Insights.weeklyLoad(logs, today, 8), weekly: Insights.sessionsPerWeek(logs, today, 8),
      muscles: Insights.muscleActivity(strength, today, 14), records, adherence: app.adherence(), weightTrend: w, weightText: Insights.describeTrend(w, 'kg', 'weight'),
      totals: { sessions: logs.length, minutes: Math.round(logs.reduce((t, l) => t + (l.durationSec || 0), 0) / 60) },
    };
  };
  app.strengthSeries = (exerciseId) => app.exerciseHistory(exerciseId).map((h) => ({ date: h.date, value: Math.max(0, ...h.sets.filter((x) => x.done !== false).map((x) => Progress.estimate1RM(x.kg, x.reps))) })).filter((x) => x.value > 0).reverse();
  app.trainedExercises = () => { const ids = new Set(); for (const l of app.state.logs) for (const p of l.performances || []) if (p.sets?.some((x) => x.kg > 0 && x.reps > 0)) ids.add(p.exercise); return [...ids].map((id) => app.state.exIndex.get(id)).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name)); };
}
