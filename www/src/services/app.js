// Application layer: orchestrates use cases over repositories, domain rules and platform adapters.
// No DOM access here, so it runs (and is tested) in Node with the in-memory adapter.
import { emitter, todayIso, clone, ok, fail, uid } from '../core/util.js';
import * as Engine from '../domain/schedule-engine.js';
import * as Prog from '../domain/programme.js';
import { installSessions } from './sessions.js';
import { installLibrary } from './library.js';
import { installTracking } from './tracking.js';
import { installDataIO } from './dataio.js';

export const DEFAULT_PREFS = {
  workout: { restSec: 45, breakSec: 90, transitionSec: 10, breathBreakSec: 30, repSec: 4, autoRest: true },
  voice: { enabled: true },
  nutrition: { proteinTargetG: 120 },
  profile: { name: '', goal: '', onboarded: false },
  theme: { mode: 'light' },
  units: { weight: 'kg' },
  privacy: { notificationDetail: false },
};

/**
 * @param {{repos:any, platform:any, clock?:()=>string}} deps
 */
export function createApp({ repos, platform, clock = todayIso }) {
  const bus = emitter();
  const app = {
    repos, platform, bus, clock,
    state: {
      ready: false, degraded: false, migration: null, prefs: structuredClone(DEFAULT_PREFS), templates: [], exercises: [], exIndex: new Map(), workouts: [],
      programme: null,   // { instance, sessions, template, sequence, ctx }
      logs: [], measurements: [], nutrition: [], health: [], reminders: [], changes: [], draft: null, lastSync: null,
    },
    on: bus.on, emit: bus.emit,
    _remT: null,
    /** Re-plans notifications shortly after data changes (completed or moved sessions change what should fire). */
    scheduleReminderRefresh() { if (!app.state.reminders.length) return; clearTimeout(app._remT); app._remT = setTimeout(() => { app.applyReminders().catch(() => {}); }, 1200); },
    async dismissCompleted() { const p = app.state.programme; if (p?.instance.status === 'completed') { await repos.meta.set('completed.dismissed.' + p.instance.id, true); await app.refresh(); } },
    today: () => clock(),

    async refresh() {
      const s = app.state, r = repos;
      const [prefs, templates, exercises, workouts, logs, measurements, nutrition, health, reminders, draft, lastSync, migration] = await Promise.all([
        r.prefs.all(), r.templates.all(), r.exercises.all(), r.workouts.all(), r.logs.all(), r.measurements.all(), r.nutrition.all(), r.health.all(), r.reminders.all(),
        r.meta.get('draft.session'), r.meta.get('health.lastSync'), r.meta.get('migration.v5-to-v6'),
      ]);
      s.prefs = { ...structuredClone(DEFAULT_PREFS), ...prefs };
      s.templates = templates; s.exercises = exercises.filter((e) => !e.archived); s.exIndex = new Map(exercises.map((e) => [e.id, e]));
      s.workouts = workouts; s.logs = logs; s.measurements = measurements; s.nutrition = nutrition; s.health = health; s.reminders = reminders;
      s.draft = draft || null; s.lastSync = lastSync || null; s.migration = migration || null;
      let inst = await r.instances.active();
      if (!inst) { // a finished programme stays visible (so Today can celebrate it and offer the next step)
        const done = (await r.instances.all()).filter((i) => i.status === 'completed').sort((a, b) => ((b.updatedAt || '') > (a.updatedAt || '') ? 1 : -1))[0];
        if (done && !(await r.meta.get('completed.dismissed.' + done.id))) inst = done;
      }
      if (inst) {
        const st = await r.loadInstanceState(inst.id); const template = await r.templates.get(inst.templateId, inst.templateVersion);
        if (st && template) {
          const sequence = Prog.sequenceOf(template);
          s.programme = { instance: st.instance, sessions: st.sessions, template, sequence, ctx: Prog.contextFor(st.instance, sequence, { today: app.today(), logSessionIds: logs.filter((l) => l.scheduledId).map((l) => l.scheduledId) }) };
          s.changes = await r.changes.byInstance(inst.id);
        } else s.programme = null;
      } else { s.programme = null; s.changes = []; }
      app.emit('change', null);
      app.scheduleReminderRefresh();
    },

    /* ------------------------------ programme lifecycle ------------------------------ */
    latestTemplates() {
      const best = new Map();
      for (const t of app.state.templates) { const c = best.get(t.id); if (!c || t.version > c.version) best.set(t.id, t); }
      return [...best.values()].sort((a, b) => a.name.localeCompare(b.name));
    },
    publishedTemplate(id) { return app.state.templates.filter((t) => t.id === id && t.status === 'published').sort((a, b) => b.version - a.version)[0] || null; },

    async startProgramme({ templateId, version, startDate, trainingDays, name }) {
      if (app.state.programme && ['active', 'paused'].includes(app.state.programme.instance.status)) return fail('already-active', 'You already have an active programme. Finish or stop it before starting another.');
      const t = version ? await repos.templates.get(templateId, version) : app.publishedTemplate(templateId);
      if (!t) return fail('no-template', 'That programme could not be found.');
      const made = Prog.createInstance({ template: t, startDate: startDate || app.today(), trainingDays, name });
      if (!made.ok) return made;
      await repos.saveInstanceState({ instance: made.instance, sessions: made.sessions });
      await app.refresh();
      return ok({ instanceId: made.instance.id });
    },
    async endProgramme(status = 'cancelled') {
      const p = app.state.programme; if (!p) return fail('none', 'There is no active programme.');
      const instance = { ...p.instance, status, endedAt: new Date().toISOString() };
      await repos.write([repos.instances.op(instance)]); await app.refresh(); return ok();
    },

    /* ------------------------------ smart schedule ------------------------------ */
    engineState() { const p = app.state.programme; return p ? { instance: p.instance, sessions: p.sessions } : null; },
    scheduleStatus() { const p = app.state.programme; return p ? Engine.status({ instance: p.instance, sessions: p.sessions }, p.ctx) : null; },
    previewSchedule(op) {
      const p = app.state.programme; if (!p) return { ok: false, valid: false, error: { code: 'none', message: 'There is no active programme.' }, conflicts: [], changes: [] };
      const { next, ...rest } = Engine.preview({ instance: p.instance, sessions: p.sessions }, p.ctx, op); return rest;
    },
    async applySchedule(op) {
      const p = app.state.programme; if (!p) return fail('none', 'There is no active programme.');
      const before = { instance: p.instance, sessions: p.sessions };
      const r = Engine.apply(before, p.ctx, op, { confirm: true });
      if (!r.ok) return r;
      const gone = before.sessions.filter((s) => !r.state.sessions.some((n) => n.id === s.id)).map((s) => s.id);
      r.state.instance.updatedAt = new Date().toISOString();
      await repos.saveInstanceState(r.state, r.change, gone); await app.refresh();
      return ok({ change: r.change });
    },
    async undoSchedule(changeId) {
      const p = app.state.programme; const ch = app.state.changes.find((c) => c.id === changeId);
      if (!p || !ch) return fail('not-found', 'That change could not be found.');
      const u = Engine.undo({ instance: p.instance, sessions: p.sessions }, ch);
      if (!u.ok) return u;
      const gone = p.sessions.filter((s) => !u.state.sessions.some((n) => n.id === s.id)).map((s) => s.id);
      await repos.saveInstanceState(u.state, u.change, gone); await app.refresh(); return ok();
    },
    nextSession() { const p = app.state.programme; return p ? Prog.nextSession({ instance: p.instance, sessions: p.sessions }, p.ctx) : null; },
    adherence() { const p = app.state.programme; return p ? Prog.adherence({ instance: p.instance, sessions: p.sessions }, p.ctx) : null; },
    sessionTemplate(scheduled) { return app.state.programme ? Prog.sessionOf(app.state.programme.template, scheduled.ref) : null; },

    /* ------------------------------ preferences ------------------------------ */
    async setPref(key, value) { await repos.prefs.set(key, value); app.state.prefs[key] = value; app.emit('change', 'prefs'); },
    async updatePref(key, patch) { return app.setPref(key, { ...app.state.prefs[key], ...patch }); },
  };
  installSessions(app); installLibrary(app); installTracking(app); installDataIO(app);
  return app;
}
export { uid, clone };
