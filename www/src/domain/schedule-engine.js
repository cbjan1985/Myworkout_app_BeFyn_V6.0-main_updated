// Smart Schedule Engine: deterministic, UI-independent, storage-independent.
//
// State    = { instance, sessions }          (ScheduledSession[] for ONE programme instance)
// Context  = { today, sequence, trainingDays, phases?, logSessionIds?, newId? }
//   sequence: [{ seq, ref, week, name, kind, phase? }] in programme order (from the immutable template version)
//
// Invariants enforced here (not in the UI):
//  * session identity (id, seq, ref) never changes when a session is moved;
//  * progression follows `seq` (cursor), never calendar arithmetic;
//  * a missed session never advances the cursor, completed sessions are never moved or rewritten;
//  * every operation is previewed first (`preview`) and applied only if no blocking conflict exists;
//  * every applied operation yields an auditable ScheduleChange that `undo` can reverse if nothing changed since.
import { addDays, diffDays, dow, uid, clone, fail, ok, prettyDate, isIsoDate } from '../core/util.js';

/** @typedef {{id:string,instanceId:string,seq:number,run:number,ref:string,week:number,name:string,date:string,status:'planned'|'completed'|'skipped',performedOn?:string,logId?:string,skipReason?:string}} ScheduledSession */

export const effDate = (s) => (s.status === 'completed' ? s.performedOn || s.date : s.date);

/** The newest run of every seq (repeat-week creates later runs; earlier runs stay as history). */
export function latestRuns(sessions) {
  const m = new Map();
  for (const s of sessions) { const c = m.get(s.seq); if (!c || s.run > c.run) m.set(s.seq, s); }
  return m;
}
export const planned = (sessions) => [...latestRuns(sessions).values()].filter((s) => s.status === 'planned').sort((a, b) => a.seq - b.seq);

/** Cursor = lowest seq whose latest run is not completed/skipped. seq === length means programme finished. */
export function deriveCursor(sessions, length) {
  const lr = latestRuns(sessions);
  for (let q = 0; q < length; q++) { const s = lr.get(q); if (!s || s.status === 'planned') return q; }
  return length;
}

export function nextTrainingDay(from, trainingDays, occupied = new Set()) {
  let d = from;
  for (let i = 0; i < 120; i++, d = addDays(d, 1)) if (trainingDays.includes(dow(d)) && !occupied.has(d)) return d;
  return from;
}

/** Initial schedule: sessions placed sequentially on training days from the start date. */
export function generateSchedule(instance, sequence, trainingDays, newId = () => uid('ss')) {
  const out = []; let d = instance.startDate; const used = new Set();
  for (const q of sequence) {
    d = nextTrainingDay(d, trainingDays, used);
    used.add(d);
    out.push({ id: newId(), instanceId: instance.id, seq: q.seq, run: 1, ref: q.ref, week: q.week, name: q.name, date: d, status: 'planned' });
    d = addDays(d, 1);
  }
  return out;
}

/* ------------------------------ validation ------------------------------ */
function weekOrderViolations(next) {
  const pl = planned(next.sessions); const bad = [];
  for (let i = 0; i < pl.length; i++) for (let j = i + 1; j < pl.length; j++) {
    const a = pl[i], b = pl[j]; // a.seq < b.seq
    if (a.week < b.week && a.date >= b.date) bad.push([a, b]);
  }
  return bad;
}

function validate(prev, next, ctx, touchedIds) {
  const conflicts = [];
  const touched = new Set(touchedIds);
  const active = next.sessions.filter((s) => s.status !== 'skipped');
  // duplicate days (planned or completed share a calendar day)
  const byDate = new Map();
  for (const s of active) { const k = effDate(s); (byDate.get(k) || byDate.set(k, []).get(k)).push(s); }
  for (const [date, list] of byDate) {
    if (list.length > 1 && list.some((s) => touched.has(s.id))) {
      conflicts.push({ code: 'duplicate-day', severity: 'block', message: `${prettyDate(date)} would hold ${list.length} sessions (${list.map((s) => s.name).join(' and ')}). Pick another day or swap them.`, sessionIds: list.map((s) => s.id) });
    }
  }
  for (const [a, b] of weekOrderViolations(next)) {
    if (touched.has(a.id) || touched.has(b.id)) conflicts.push({ code: 'sequence', severity: 'block', message: `"${a.name}" (week ${a.week}) must stay before "${b.name}" (week ${b.week}). Sessions can be reordered only within the same programme week.`, sessionIds: [a.id, b.id] });
  }
  for (const s of planned(next.sessions)) {
    if (!touched.has(s.id)) continue;
    const before = prev.sessions.find((p) => p.id === s.id);
    if (s.date < ctx.today && (!before || before.date !== s.date)) conflicts.push({ code: 'in-past', severity: 'block', message: `${s.name} can't be moved to ${prettyDate(s.date)} because that day has passed. Use "Log a past session" instead.`, sessionIds: [s.id] });
    if (!ctx.trainingDays.includes(dow(s.date))) conflicts.push({ code: 'rest-day', severity: 'warn', message: `${prettyDate(s.date)} is one of your rest days.`, sessionIds: [s.id] });
  }
  return conflicts;
}

/* ------------------------------ diff / change log ------------------------------ */
const snap = (s) => (s ? clone(s) : null);
function diff(prev, next) {
  const a = new Map(prev.sessions.map((s) => [s.id, s])), b = new Map(next.sessions.map((s) => [s.id, s]));
  const changes = [];
  for (const [id, s] of b) {
    const o = a.get(id);
    if (!o) changes.push({ id, kind: 'add', before: null, after: snap(s), label: s.name });
    else if (JSON.stringify(o) !== JSON.stringify(s)) changes.push({ id, kind: o.date !== s.date ? 'move' : 'status', before: snap(o), after: snap(s), label: s.name });
  }
  for (const [id, s] of a) if (!b.has(id)) changes.push({ id, kind: 'remove', before: snap(s), after: null, label: s.name });
  return changes;
}

const needActive = (st) => st.instance.status === 'active';
const PAUSED = () => fail('paused', 'This programme is paused. Resume it before changing the schedule.');

function occupiedDates(sessions, exceptIds = []) {
  const ex = new Set(exceptIds);
  return new Set(sessions.filter((s) => s.status !== 'skipped' && !ex.has(s.id)).map(effDate));
}

/** Re-lay planned sessions starting at `startDate`, preserving gaps between them, avoiding completed days. */
function relay(next, ctx, fromSeq, startDate) {
  const list = planned(next.sessions).filter((s) => s.seq >= fromSeq);
  if (!list.length) return [];
  const occ = occupiedDates(next.sessions, list.map((s) => s.id));
  const anchor = list[0].date;
  const target = nextTrainingDay(startDate, ctx.trainingDays, occ);
  const delta = diffDays(target, anchor);
  let last = null;
  for (const s of list) {
    let d = addDays(s.date, delta);
    if (last && d <= last && weekIdx(s) !== weekIdx(list[list.indexOf(s) - 1])) d = addDays(last, 1);
    while (occ.has(d)) d = addDays(d, 1);
    s.date = d; occ.add(d); last = last && last > d ? last : d;
  }
  return list.map((s) => s.id);
}
const weekIdx = (s) => s.week;

/** Re-create sessions from `seqStart` onwards (repeat week / re-ramp). Completed runs stay as history. */
function restart(next, ctx, seqStart, startDate) {
  const lr = latestRuns(next.sessions); const touched = [];
  next.sessions = next.sessions.filter((s) => !(s.status === 'planned' && s.seq >= seqStart));
  const occ = occupiedDates(next.sessions);
  let d = startDate;
  for (const q of ctx.sequence.filter((x) => x.seq >= seqStart)) {
    d = nextTrainingDay(d, ctx.trainingDays, occ); occ.add(d);
    const prevRun = lr.get(q.seq);
    const run = prevRun ? (prevRun.status === 'planned' ? prevRun.run : prevRun.run + 1) : 1;
    const s = { id: (ctx.newId || (() => uid('ss')))(), instanceId: next.instance.id, seq: q.seq, run, ref: q.ref, week: q.week, name: q.name, date: d, status: 'planned' };
    next.sessions.push(s); touched.push(s.id); d = addDays(d, 1);
  }
  return touched;
}

/* ------------------------------ operations ------------------------------ */
const ops = {
  move(next, ctx, op) {
    if (!needActive(next)) return PAUSED();
    const s = next.sessions.find((x) => x.id === op.sessionId);
    if (!s || s.status !== 'planned') return fail('not-movable', 'Only upcoming sessions can be moved. Completed sessions keep their date.');
    if (!isIsoDate(op.toDate)) return fail('bad-date', 'Choose a valid date.');
    if (s.date === op.toDate) return fail('no-change', 'That session is already on this day.');
    const other = next.sessions.find((x) => x.id !== s.id && x.status === 'planned' && x.date === op.toDate);
    if (other && op.onOccupied === 'swap') { other.date = s.date; s.date = op.toDate; return ok({ touched: [s.id, other.id] }); }
    s.date = op.toDate; return ok({ touched: [s.id] });
  },
  swap(next, ctx, op) {
    if (!needActive(next)) return PAUSED();
    const a = next.sessions.find((x) => x.id === op.a), b = next.sessions.find((x) => x.id === op.b);
    if (!a || !b || a.status !== 'planned' || b.status !== 'planned') return fail('not-movable', 'Both sessions must be upcoming to swap them.');
    [a.date, b.date] = [b.date, a.date]; return ok({ touched: [a.id, b.id] });
  },
  moveWeek(next, ctx, op) {
    if (!needActive(next)) return PAUSED();
    const wk = planned(next.sessions).filter((s) => s.week === op.week);
    if (!wk.length) return fail('nothing-to-move', `Week ${op.week} has no upcoming sessions.`);
    if (!isIsoDate(op.toStartDate)) return fail('bad-date', 'Choose a valid date.');
    const delta = diffDays(op.toStartDate, wk[0].date);
    if (!delta) return fail('no-change', 'That week already starts on this day.');
    const set = op.ripple ? planned(next.sessions).filter((s) => s.seq >= wk[0].seq) : wk;
    set.forEach((s) => { s.date = addDays(s.date, delta); });
    return ok({ touched: set.map((s) => s.id) });
  },
  shift(next, ctx, op) {
    if (!needActive(next)) return PAUSED();
    const set = planned(next.sessions).filter((s) => s.seq >= (op.fromSeq ?? 0));
    if (!set.length) return fail('nothing-to-move', 'There are no upcoming sessions to shift.');
    if (!op.days) return fail('no-change', 'Choose how many days to shift by.');
    set.forEach((s) => { s.date = addDays(s.date, op.days); });
    return ok({ touched: set.map((s) => s.id) });
  },
  pause(next, ctx, op) {
    if (next.instance.status !== 'active') return fail('not-active', 'Only an active programme can be paused.');
    next.instance.status = 'paused'; next.instance.pause = { since: op.date || ctx.today };
    return ok({ touched: [] });
  },
  resume(next, ctx, op) {
    if (next.instance.status !== 'paused') return fail('not-paused', 'This programme is not paused.');
    const date = op.date || ctx.today, since = next.instance.pause?.since || date;
    const gap = Math.max(0, diffDays(date, since));
    next.instance.status = 'active'; next.instance.pause = null;
    next.instance.pauseHistory = [...(next.instance.pauseHistory || []), { from: since, to: date, days: gap }];
    const cur = deriveCursor(next.sessions, ctx.sequence.length);
    let touched = [];
    const sug = reramp(next, ctx, gap);
    if (op.reramp && sug) touched = restart(next, ctx, sug.fromSeq, date);
    else touched = relay(next, ctx, cur, date);
    return ok({ touched, suggestion: sug });
  },
  resolveMissed(next, ctx, op) {
    if (!needActive(next)) return PAUSED();
    const missed = planned(next.sessions).filter((s) => s.date < ctx.today);
    if (!missed.length) return fail('nothing-missed', 'No sessions are overdue.');
    const first = missed[0];
    if (op.mode === 'skip') { missed.forEach((s) => { s.status = 'skipped'; s.skipReason = 'missed'; }); return ok({ touched: missed.map((s) => s.id) }); }
    if (op.mode === 'repeatWeek') return ok({ touched: restart(next, ctx, firstSeqOfWeek(ctx, first.week), ctx.today) });
    if (op.mode === 'jump') return ops.jump(next, ctx, { toSeq: op.toSeq });
    return ok({ touched: relay(next, ctx, first.seq, ctx.today) }); // 'shift' (default)
  },
  restartFromWeek(next, ctx, op) {
    if (!needActive(next)) return PAUSED();
    const seq = firstSeqOfWeek(ctx, op.week);
    if (seq < 0) return fail('bad-week', `Week ${op.week} is not part of this programme.`);
    const cur = deriveCursor(next.sessions, ctx.sequence.length);
    if (seq > cur) return fail('use-jump', 'That week is ahead of your current position. Use "Jump ahead" instead.');
    return ok({ touched: restart(next, ctx, seq, op.startDate || ctx.today) });
  },
  jump(next, ctx, op) {
    if (!needActive(next)) return PAUSED();
    const cur = deriveCursor(next.sessions, ctx.sequence.length);
    if (!(op.toSeq > cur) || op.toSeq >= ctx.sequence.length) return fail('bad-target', 'Choose a later session in this programme.');
    const touched = [];
    planned(next.sessions).filter((s) => s.seq < op.toSeq).forEach((s) => { s.status = 'skipped'; s.skipReason = 'jump'; touched.push(s.id); });
    touched.push(...relay(next, ctx, op.toSeq, op.startDate || ctx.today));
    const from = ctx.sequence[cur], to = ctx.sequence[op.toSeq];
    const warnings = [];
    if (from?.phase && to?.phase && from.phase !== to.phase) warnings.push({ code: 'phase-skip', severity: 'warn', message: `This skips ${op.toSeq - cur} session(s) and moves you into a harder phase before finishing the current one.`, sessionIds: [] });
    return ok({ touched, warnings });
  },
  reconcile(next, ctx) {
    const touched = []; const notes = [];
    const cur = deriveCursor(next.sessions, ctx.sequence.length);
    if (next.instance.cursor?.seq !== cur) notes.push(`Programme position corrected to session ${cur + 1}.`);
    next.instance.cursor = { seq: cur };
    // duplicate days among planned: push later sessions forward
    const occ = new Set(next.sessions.filter((s) => s.status === 'completed').map(effDate));
    for (const s of planned(next.sessions)) {
      if (occ.has(s.date)) { const before = s.date; s.date = nextTrainingDay(addDays(s.date, 1), ctx.trainingDays, occ); touched.push(s.id); notes.push(`${s.name} moved from ${prettyDate(before)} to ${prettyDate(s.date)} (day was taken).`); }
      occ.add(s.date);
    }
    // sequence order: re-lay when weeks are out of order
    if (weekOrderViolations(next).length) {
      const list = planned(next.sessions); const used = new Set(next.sessions.filter((s) => s.status === 'completed').map(effDate));
      let d = list.map((s) => s.date).sort()[0];
      for (const s of list) { d = nextTrainingDay(d, ctx.trainingDays, used); s.date = d; used.add(d); d = addDays(d, 1); touched.push(s.id); }
      notes.push('Upcoming sessions were re-ordered to follow the programme sequence.');
    }
    const ids = new Set(ctx.logSessionIds || []);
    const unlogged = next.sessions.filter((s) => s.status === 'completed' && ctx.logSessionIds && !ids.has(s.id));
    if (unlogged.length) notes.push(`${unlogged.length} completed session(s) have no workout log. Their history is kept as is.`);
    return ok({ touched: [...new Set(touched)], notes });
  },
};

function firstSeqOfWeek(ctx, week) { const q = ctx.sequence.find((x) => x.week === week); return q ? q.seq : -1; }

/** Re-ramp suggestion after a long break: repeat the most recent week (14-27 days) or the week before (28+). */
export function reramp(state, ctx, gapDays) {
  if (gapDays < 14) return null;
  const cur = deriveCursor(state.sessions, ctx.sequence.length);
  const curWeek = ctx.sequence[Math.min(cur, ctx.sequence.length - 1)]?.week ?? 1;
  const back = gapDays >= 28 ? 2 : 1;
  const week = Math.max(1, curWeek - back);
  const fromSeq = Math.min(firstSeqOfWeek(ctx, week), cur);
  if (fromSeq === cur && week === curWeek) return null;
  return { gapDays, fromWeek: week, fromSeq, message: `After ${gapDays} days away, easing back from week ${week} is a sensible restart. You can still continue where you left off.` };
}

/* ------------------------------ public API ------------------------------ */
export function preview(state, ctx, op) {
  const next = clone(state);
  const fn = ops[op.type];
  if (!fn) return { ok: false, valid: false, error: { code: 'unknown-op', message: `Unknown schedule operation "${op.type}".` }, conflicts: [], changes: [] };
  const r = fn(next, ctx, op);
  if (!r.ok) return { ok: false, valid: false, error: r.error, conflicts: [], changes: [] };
  const changes = diff(state, next);
  const conflicts = [...validate(state, next, ctx, r.touched || []), ...(r.warnings || [])];
  const cursorBefore = deriveCursor(state.sessions, ctx.sequence.length), cursorAfter = deriveCursor(next.sessions, ctx.sequence.length);
  next.instance.cursor = { seq: cursorAfter };
  const completedMoved = changes.filter((c) => c.before?.status === 'completed' && (c.kind === 'move' || c.kind === 'remove'));
  if (completedMoved.length) conflicts.push({ code: 'completed-changed', severity: 'block', message: 'Completed sessions cannot be changed.', sessionIds: completedMoved.map((c) => c.id) });
  const valid = !conflicts.some((c) => c.severity === 'block');
  return { ok: true, valid, op, changes, conflicts, notes: r.notes || [], suggestion: r.suggestion || null, cursorBefore, cursorAfter, next };
}

/** Apply a previewed operation. Requires explicit confirm; returns the new state and an auditable change record. */
export function apply(state, ctx, op, { confirm = false } = {}) {
  if (!confirm) return fail('needs-confirmation', 'Schedule changes must be confirmed after previewing.');
  const p = preview(state, ctx, op);
  if (!p.ok) return { ok: false, error: p.error };
  if (!p.valid) return fail('conflict', p.conflicts.find((c) => c.severity === 'block').message, { conflicts: p.conflicts });
  const change = {
    id: (ctx.newId || (() => uid('chg')))(), instanceId: state.instance.id, type: op.type, at: ctx.nowIso || new Date().toISOString(),
    summary: describe(op, p), affected: p.changes.map((c) => c.id), changes: p.changes,
    instanceBefore: { status: state.instance.status, pause: state.instance.pause || null, pauseHistory: state.instance.pauseHistory || [], cursor: state.instance.cursor || null },
    instanceAfter: { status: p.next.instance.status, pause: p.next.instance.pause || null, pauseHistory: p.next.instance.pauseHistory || [], cursor: p.next.instance.cursor },
    undone: false,
  };
  return ok({ state: p.next, change, preview: p });
}

function describe(op, p) {
  const n = p.changes.length;
  switch (op.type) {
    case 'move': return `Moved a session to ${prettyDate(op.toDate)}`;
    case 'swap': return 'Swapped two sessions';
    case 'moveWeek': return `Moved week ${op.week} to start ${prettyDate(op.toStartDate)}`;
    case 'shift': return `Shifted ${n} upcoming session(s) by ${op.days} day(s)`;
    case 'pause': return 'Paused the programme';
    case 'resume': return op.reramp ? 'Resumed with an easier restart' : 'Resumed the programme';
    case 'resolveMissed': return { shift: 'Moved missed sessions forward', skip: 'Skipped missed sessions', repeatWeek: 'Repeating the week', jump: 'Jumped ahead' }[op.mode || 'shift'];
    case 'restartFromWeek': return `Restarted from week ${op.week}`;
    case 'jump': return 'Jumped ahead in the programme';
    case 'reconcile': return 'Re-synchronised the programme';
    default: return op.type;
  }
}

/** Undo a change if the sessions it touched are still exactly as that change left them. */
export function undo(state, change) {
  if (change.undone) return fail('already-undone', 'This change was already undone.');
  const cur = new Map(state.sessions.map((s) => [s.id, s]));
  for (const c of change.changes) {
    const now = cur.get(c.id);
    const expected = c.after;
    if ((expected === null) !== !now || (expected && JSON.stringify(now) !== JSON.stringify(expected))) return fail('stale', 'Those sessions changed since, so this can no longer be undone safely.');
  }
  const next = clone(state);
  for (const c of change.changes) {
    const i = next.sessions.findIndex((s) => s.id === c.id);
    if (c.before === null) { if (i >= 0) next.sessions.splice(i, 1); }
    else if (i >= 0) next.sessions[i] = clone(c.before); else next.sessions.push(clone(c.before));
  }
  Object.assign(next.instance, clone(change.instanceBefore));
  return ok({ state: next, change: { ...change, undone: true } });
}

/** Summary used by Today/Calendar: what is overdue and whether a re-ramp is advisable. */
export function status(state, ctx) {
  const missed = planned(state.sessions).filter((s) => s.date < ctx.today);
  const done = state.sessions.filter((s) => s.status === 'completed').map(effDate).sort();
  const last = done[done.length - 1] || null;
  const since = state.instance.status === 'paused' ? state.instance.pause?.since : last;
  const gapDays = since ? Math.max(0, diffDays(ctx.today, since)) : 0;
  return { missed, cursor: deriveCursor(state.sessions, ctx.sequence.length), lastCompleted: last, gapDays, reramp: gapDays >= 14 ? reramp(state, ctx, gapDays) : null };
}
