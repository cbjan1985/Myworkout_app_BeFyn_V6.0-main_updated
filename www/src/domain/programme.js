// Programme domain: Template (immutable once published) -> Instance (a user's run) -> SessionLog (history).
import { uid, clone, ok, fail, slug, todayIso, diffDays, isIsoDate, addDays, dow } from '../core/util.js';
import * as Engine from './schedule-engine.js';

export const SECTION_ORDER = ['warmup', 'main', 'flow', 'breathing', 'cooldown'];
export const SECTION_LABEL = { warmup: 'Warm-up', main: 'Main workout', flow: 'Guided flow', breathing: 'Breathing', cooldown: 'Stretching' };

/** Ordered list of programme positions (the progression axis). Never derived from dates. */
export function sequenceOf(template) {
  const phaseOf = (w) => template.phases?.find((p) => w >= p.fromWeek && w <= p.toWeek)?.id;
  return template.sessions
    .map((s, i) => ({ s, i }))
    .sort((a, b) => a.s.week - b.s.week || a.i - b.i)
    .map(({ s }, seq) => ({ seq, ref: s.id, week: s.week, name: s.name, kind: s.kind || 'training', phase: phaseOf(s.week) }));
}

export function sessionOf(template, ref) { return template.sessions.find((s) => s.id === ref) || null; }

/**
 * Flattens a session's sections into the ordered steps a person performs.
 * Exercises marked "each side" become a Left step then a Right step, so each side is logged on its own.
 */
export function flattenSession(session) {
  const steps = [];
  const emit = (base, it) => {
    if (it.side === 'each') { steps.push({ ...base, item: { ...it, side: 'Left' }, last: false, restAfterRound: 0, sideOf: 'Left' }); steps.push({ ...base, item: { ...it, side: 'Right' }, sideOf: 'Right' }); }
    else steps.push({ ...base, item: it });
  };
  for (const sec of SECTION_ORDER) {
    for (const block of session.sections?.[sec] || []) {
      const items = block.items || [block];
      if (block.type && block.type !== 'straight') {
        const rounds = block.rounds || 1;
        for (let r = 1; r <= rounds; r++) items.forEach((it, k) => emit({ section: sec, blockType: block.type, round: r, rounds, last: k === items.length - 1, restAfterRound: block.restAfterRound || 0, note: block.note }, it));
      } else {
        const it = items[0]; const n = Math.max(sec === 'main' ? it.sets || 1 : 1, it.repeats || 1);
        for (let r = 1; r <= n; r++) emit({ section: sec, blockType: 'straight', round: r, rounds: n, last: true, restAfterRound: it.rest || 0 }, it);
      }
    }
  }
  return steps.map((st, i) => ({ ...st, index: i }));
}

/* ------------------------------ template lifecycle ------------------------------ */
export function validateTemplate(t, exerciseIds = null) {
  const errs = [];
  if (!t.name?.trim()) errs.push('Give the programme a name.');
  if (!t.sessions?.length) errs.push('Add at least one session.');
  const weeks = [...new Set((t.sessions || []).map((s) => s.week))].sort((a, b) => a - b);
  weeks.forEach((w, i) => { if (w !== i + 1) errs.push(`Weeks must be continuous (week ${i + 1} is missing).`); });
  const ids = new Set();
  for (const s of t.sessions || []) {
    if (ids.has(s.id)) errs.push(`Duplicate session id ${s.id}.`); ids.add(s.id);
    if (!s.name?.trim()) errs.push(`A session in week ${s.week} has no name.`);
    if (exerciseIds) for (const sec of Object.values(s.sections || {})) for (const b of sec) for (const it of b.items || [b]) if (it.exercise && !exerciseIds.has(it.exercise)) errs.push(`"${it.name}" is not in the exercise catalogue.`);
  }
  return errs;
}

export function newDraft({ name, objective = '', weeks = 4, weeklyFrequency = 3, sessions = [] }) {
  return { id: uid('tpl'), name, objective, description: '', weeks, weeklyFrequency, version: 1, status: 'draft', phases: [], progression: { mode: 'completion' }, sessions, guide: [], source: 'user', createdAt: new Date().toISOString() };
}

/** Published versions are immutable: editing yields a new draft with version + 1 under the same id. */
export function forkTemplate(published) {
  const d = clone(published); d.version = published.version + 1; d.status = 'draft'; d.createdAt = new Date().toISOString(); return d;
}
export function publishTemplate(draft, exerciseIds) {
  const errs = validateTemplate(draft, exerciseIds);
  if (errs.length) return fail('invalid-template', errs[0], { errors: errs });
  return ok({ template: { ...clone(draft), status: 'published', publishedAt: new Date().toISOString() } });
}

/**
 * Builder helper: repeat a weekly pattern over N weeks, applying a simple progression
 * (reps + step every week, or load note), so a user can create a programme without typing every week.
 * pattern: [{ name, dayOfWeek, items:[{exercise,name,sets,reps,secs,load,rest,target}] , warmup?:[], cooldown?:[] }]
 */
export function expandWeeklyPattern({ weeks, pattern, progression = { everyWeeks: 1, addReps: 0 } }) {
  const sessions = [];
  for (let w = 1; w <= weeks; w++) {
    const bump = Math.floor((w - 1) / Math.max(1, progression.everyWeeks)) * (progression.addReps || 0);
    pattern.forEach((p, i) => {
      const main = (p.items || []).map((it) => ({ type: 'straight', items: [{ ...clone(it), reps: it.reps ? it.reps + bump : it.reps, target: it.reps ? `${it.reps + bump} reps` : it.target }] }));
      const sections = { main };
      if (p.warmup?.length) sections.warmup = clone(p.warmup).map((it) => ({ sets: 1, ...it }));
      if (p.cooldown?.length) sections.cooldown = clone(p.cooldown).map((it) => ({ sets: 1, ...it }));
      sessions.push({ id: `w${w}-${slug(p.name)}-${i + 1}`, week: w, dayOfWeek: p.dayOfWeek ?? 1, name: p.name, kind: 'training', sections });
    });
  }
  return sessions;
}

/* ------------------------------ instances ------------------------------ */
export function createInstance({ template, startDate, trainingDays, name, newId }) {
  if (template.status !== 'published') return fail('not-published', 'Only a published programme version can be started.');
  if (!isIsoDate(startDate)) return fail('bad-date', 'Choose a valid start date.');
  const days = trainingDays?.length ? trainingDays : [...new Set(template.sessions.map((s) => s.dayOfWeek))];
  const seqs = sequenceOf(template);
  const instance = {
    id: uid('inst'), templateId: template.id, templateVersion: template.version, name: name || template.name, startDate, status: 'active',
    trainingDays: days, cursor: { seq: 0 }, pause: null, pauseHistory: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  const sessions = Engine.generateSchedule(instance, seqs, days, newId);
  return ok({ instance, sessions, sequence: seqs });
}

export const contextFor = (instance, sequence, extra = {}) => ({ today: todayIso(), sequence, trainingDays: instance.trainingDays, ...extra });

/**
 * Mark a scheduled session completed exactly once and advance the (derived) cursor.
 * Out-of-order completion is allowed only inside the cursor's programme week; further ahead needs "jump".
 */
export function completeSession(state, ctx, { sessionId, performedOn, logId }) {
  const s = state.sessions.find((x) => x.id === sessionId);
  if (!s) return fail('not-found', 'That session no longer exists.');
  if (s.status === 'completed') return ok({ state, alreadyCompleted: true, cursor: Engine.deriveCursor(state.sessions, ctx.sequence.length) });
  if (s.status !== 'planned') return fail('not-planned', 'This session was skipped. Restart the week to do it again.');
  const cur = Engine.deriveCursor(state.sessions, ctx.sequence.length);
  const curWeek = ctx.sequence[cur]?.week ?? s.week;
  if (s.week > curWeek) return fail('out-of-sequence', `Finish week ${curWeek} first, or use "Jump ahead" to move on deliberately.`);
  const next = clone(state);
  const t = next.sessions.find((x) => x.id === sessionId);
  t.status = 'completed'; t.performedOn = performedOn || todayIso(); t.logId = logId || t.logId;
  next.instance.cursor = { seq: Engine.deriveCursor(next.sessions, ctx.sequence.length) };
  if (next.instance.cursor.seq >= ctx.sequence.length) next.instance.status = 'completed';
  next.instance.updatedAt = new Date().toISOString();
  return ok({ state: next, cursor: next.instance.cursor.seq, finished: next.instance.status === 'completed' });
}

/** The session Today should offer: one scheduled today (inside the cursor week), else the cursor session. */
export function nextSession(state, ctx) {
  if (state.instance.status !== 'active') return null;
  const pl = Engine.planned(state.sessions);
  if (!pl.length) return null;
  const curWeek = pl[0].week;
  const today = pl.find((s) => s.date === ctx.today && s.week <= curWeek);
  return today || pl[0];
}

export function adherence(state, ctx) {
  const lr = [...Engine.latestRuns(state.sessions).values()];
  const dueToDate = lr.filter((s) => Engine.effDate(s) <= ctx.today && s.status !== 'skipped');
  const done = dueToDate.filter((s) => s.status === 'completed').length;
  const skipped = lr.filter((s) => s.status === 'skipped').length;
  const missed = lr.filter((s) => s.status === 'planned' && s.date < ctx.today).length;
  const total = lr.length;
  return { total, completed: lr.filter((s) => s.status === 'completed').length, skipped, missed, dueToDate: dueToDate.length, doneOfDue: done, rate: dueToDate.length ? done / dueToDate.length : null, progressPct: total ? Math.round((lr.filter((s) => s.status === 'completed').length / total) * 100) : 0 };
}

export function weekSummary(state, ctx, week) {
  const lr = [...Engine.latestRuns(state.sessions).values()].filter((s) => s.week === week);
  return { week, total: lr.length, completed: lr.filter((s) => s.status === 'completed').length, skipped: lr.filter((s) => s.status === 'skipped').length };
}

/** Which template phase a session belongs to, for UI labels. */
export function phaseLabel(template, week) { return template.phases?.find((p) => week >= p.fromWeek && week <= p.toWeek)?.name || ''; }

export { dow, addDays, diffDays };
