// Workout execution: drafts that survive interruption, set logging, and an append-only finish that advances the programme exactly once.
import { uid, ok, fail, clone, todayIso, slug } from '../core/util.js';
import * as Prog from '../domain/programme.js';
import * as Progress from '../domain/progression.js';

export function installSessions(app) {
  const { repos } = app;

  app.sessionPlan = (scheduledId) => {
    const p = app.state.programme; const sc = p?.sessions.find((s) => s.id === scheduledId);
    if (!p || !sc) return null;
    const session = Prog.sessionOf(p.template, sc.ref);
    return session ? { scheduled: sc, session, steps: Prog.flattenSession(session), name: session.name, week: sc.week } : null;
  };
  app.workoutPlan = (workoutId) => {
    const w = app.state.workouts.find((x) => x.id === workoutId);
    if (!w || !w.sections) return null;
    return { workout: w, session: w, steps: Prog.flattenSession(w), name: w.name };
  };
  app.planForDraft = (d) => (d.kind === 'scheduled' ? app.sessionPlan(d.scheduledId) : d.kind === 'workout' ? app.workoutPlan(d.workoutId) : { steps: [], name: d.name });

  /** Starts (or resumes) a workout. An unfinished draft for the same target is resumed, never overwritten. */
  app.startDraft = async ({ kind, scheduledId, workoutId }) => {
    const cur = app.state.draft;
    if (cur && cur.kind === kind && cur.scheduledId === scheduledId && cur.workoutId === workoutId) return ok({ draft: cur, resumed: true });
    if (cur) return fail('draft-exists', 'You have an unfinished workout. Resume it or discard it first.', { draft: cur });
    const plan = kind === 'scheduled' ? app.sessionPlan(scheduledId) : app.workoutPlan(workoutId);
    if (!plan) return fail('no-plan', 'That workout could not be found.');
    if (kind === 'scheduled') {
      const sc = plan.scheduled;
      if (sc.status !== 'planned') return fail('not-planned', 'This session is already finished or was skipped.');
    }
    const draft = { id: uid('draft'), kind, scheduledId, workoutId, name: plan.name, startedAt: new Date().toISOString(), stepIndex: 0, records: {}, notes: '' };
    await repos.meta.set('draft.session', draft); app.state.draft = draft; app.emit('change', 'draft');
    return ok({ draft });
  };
  app.saveDraft = async (draft) => { app.state.draft = draft; await repos.meta.set('draft.session', draft); };
  app.discardDraft = async () => { await repos.write([{ op: 'delete', store: 'meta', key: 'draft.session' }]); app.state.draft = null; app.emit('change', 'draft'); };

  app.recordSet = async (draft, stepIndex, rec) => {
    draft.records[stepIndex] = { reps: rec.reps || 0, kg: rec.kg || 0, secs: rec.secs || 0, restSec: rec.restSec || 0, done: rec.done !== false, at: new Date().toISOString() };
    draft.stepIndex = Math.max(draft.stepIndex || 0, stepIndex + 1);
    await app.saveDraft(draft); return draft;
  };
  app.undoRecord = async (draft, stepIndex) => { delete draft.records[stepIndex]; draft.stepIndex = Math.min(draft.stepIndex, stepIndex); await app.saveDraft(draft); return draft; };

  /** Newest-first history of one exercise: [{date, sets}] from completed logs. */
  app.exerciseHistory = (exerciseId) => {
    const out = [];
    for (const l of app.state.logs) for (const p of l.performances || []) if (p.exercise === exerciseId && p.sets?.some((s) => s.done !== false)) out.push({ date: l.date, sets: p.sets });
    return out;
  };
  app.previousPerformance = (exerciseId) => app.exerciseHistory(exerciseId)[0] || null;
  app.suggestFor = (item) => Progress.suggestNext(item, app.exerciseHistory(item.exercise), { stepKg: 1 });

  function performancesFromDraft(draft, steps) {
    const by = new Map(); let seq = 0;
    steps.forEach((st) => {
      const r = draft.records[st.index]; if (!r) return;
      const side = st.item.side && st.item.side !== 'each' ? st.item.side : undefined;
      const k = `${st.item.exercise}|${side || ''}|${st.section}`;
      if (!by.has(k)) by.set(k, { id: uid('perf'), exercise: st.item.exercise, name: st.item.name, category: st.section, sequence: seq++, side, sets: [], notes: '' });
      by.get(k).sets.push({ reps: r.reps, kg: r.kg, secs: r.secs, restSec: r.restSec, done: r.done });
    });
    return [...by.values()];
  }

  /**
   * Saves the session log and (for programme sessions) advances the cursor in ONE atomic write.
   * Calling it twice for the same scheduled session is safe: the second call reports alreadyCompleted.
   */
  app.finishSession = async (draft, { feedback = null, notes = '', now = new Date() } = {}) => {
    const plan = app.planForDraft(draft); if (!plan) return fail('no-plan', 'The workout this belongs to no longer exists.');
    const performances = performancesFromDraft(draft, plan.steps);
    const date = app.today();
    const durationSec = Math.max(0, Math.round((now.getTime() - new Date(draft.startedAt).getTime()) / 1000));
    const base = { date, name: plan.name, status: 'completed', performances, notes: notes || draft.notes || '', feedback, startedAt: draft.startedAt, durationSec, source: 'befyn' };
    const records = [];
    const prevPerf = (exId) => app.exerciseHistory(exId).map((h) => ({ date: h.date, exercise: exId, sets: h.sets }));
    for (const p of performances) { const nr = Progress.newRecords(prevPerf(p.exercise), { date, exercise: p.exercise, sets: p.sets }); if (nr.length) records.push({ exercise: p.exercise, name: p.name, records: nr }); }

    if (draft.kind === 'scheduled') {
      const p = app.state.programme; if (!p) return fail('no-programme', 'The programme for this session is no longer active.');
      const logId = `log-${draft.scheduledId}-r${p.sessions.find((s) => s.id === draft.scheduledId)?.run || 1}`;
      if (await repos.logs.get(logId)) { await app.discardDraft(); await app.refresh(); return ok({ alreadyCompleted: true, logId }); }
      const state = { instance: p.instance, sessions: p.sessions };
      const done = Prog.completeSession(state, p.ctx, { sessionId: draft.scheduledId, performedOn: date, logId });
      if (!done.ok) return done;
      const log = { id: logId, instanceId: p.instance.id, scheduledId: draft.scheduledId, sessionRef: plan.scheduled.ref, ...base };
      await repos.write([repos.logs.appendOp(log), ...repos.instanceStateOps(done.state), { op: 'delete', store: 'meta', key: 'draft.session' }]);
      app.state.draft = null; await app.refresh();
      return ok({ log, records, finished: !!done.finished, cursor: done.cursor });
    }
    const log = { id: uid('log'), ...base };
    await repos.write([repos.logs.appendOp(log), { op: 'delete', store: 'meta', key: 'draft.session' }]);
    app.state.draft = null; await app.refresh();
    return ok({ log, records });
  };

  /** Records a session done earlier without per-set detail (completes the programme session if one is given). */
  app.logPastSession = async ({ scheduledId, date, durationMin = 0, effort = null, notes = '' }) => {
    const d = date || app.today();
    const p = app.state.programme; const sc = scheduledId && p?.sessions.find((s) => s.id === scheduledId);
    const logId = scheduledId ? `log-${scheduledId}-r${sc?.run || 1}` : uid('log');
    if (scheduledId && await repos.logs.get(logId)) return ok({ alreadyCompleted: true });
    const log = { id: logId, instanceId: sc ? p.instance.id : undefined, scheduledId: sc ? sc.id : undefined, sessionRef: sc?.ref, date: d, name: sc?.name || 'Workout', status: 'completed', performances: [], notes, feedback: effort ? { effort } : null, durationSec: durationMin * 60, source: 'manual-log' };
    const writes = [repos.logs.appendOp(log)];
    if (sc) { const done = Prog.completeSession({ instance: p.instance, sessions: p.sessions }, p.ctx, { sessionId: sc.id, performedOn: d, logId }); if (!done.ok) return done; writes.push(...repos.instanceStateOps(done.state)); }
    await repos.write(writes); await app.refresh(); return ok({ log });
  };

  /** Quick activity (walk, cycle, sport) from Today. Standalone; never touches the programme. */
  app.logActivity = async ({ name, minutes, date, effort = null, notes = '' }) => {
    if (!name?.trim()) return fail('invalid', 'Give the activity a name.');
    if (!(minutes > 0)) return fail('invalid', 'Enter how many minutes it took.');
    const log = { id: uid('log'), date: date || app.today(), name: name.trim(), status: 'completed', performances: [], notes, feedback: effort ? { effort } : null, durationSec: Math.round(minutes * 60), source: 'quick-activity', activity: true };
    await repos.write([repos.logs.appendOp(log)]); await app.refresh(); return ok({ log });
  };

  /** Explicit, auditable correction of an existing log (never a silent overwrite). */
  app.correctLog = async (id, patch, reason) => { const r = await repos.logs.correct(id, patch, reason); if (r.ok) await app.refresh(); return r; };
}
export { slug, clone, todayIso };
