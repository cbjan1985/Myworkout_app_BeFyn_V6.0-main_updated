import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as E from '../www/src/domain/schedule-engine.js';
import { addDays, dow } from '../www/src/core/util.js';

const tpl = JSON.parse(fs.readFileSync(new URL('../www/assets/seed/programme-8wk-muscle-gain.json', import.meta.url)));
const sequence = tpl.sessions.map((s, i) => ({ seq: i, ref: s.id, week: s.week, name: s.name, kind: s.kind, phase: s.week <= 2 ? 'p1' : 'p2' }));
const ALL = [1, 2, 3, 4, 5, 6, 0];
let n = 0; const newId = () => 'id' + (++n);
const mk = (today = '2026-11-02', trainingDays = ALL) => {
  const instance = { id: 'inst1', startDate: '2026-11-02', status: 'active', cursor: { seq: 0 } };
  const sessions = E.generateSchedule(instance, sequence, trainingDays, newId);
  return { state: { instance, sessions }, ctx: { today, sequence, trainingDays, newId } };
};
const applyOk = (st, ctx, op) => { const r = E.apply(st, ctx, op, { confirm: true }); assert.ok(r.ok, JSON.stringify(r.error)); return r; };

test('generates 56 sessions, 7 per week, no duplicate dates, programme order kept', () => {
  const { state } = mk();
  assert.equal(state.sessions.length, 56);
  assert.equal(new Set(state.sessions.map((s) => s.date)).size, 56);
  assert.equal(state.sessions[0].date, '2026-11-02');
  assert.equal(state.sessions[55].date, '2026-12-27');
  assert.ok(state.sessions.every((s, i) => s.seq === i));
});

test('a missed week does not advance the cursor; shift forward waits for the user (week 3 stays week 3)', () => {
  const { state, ctx } = mk('2026-11-21');
  const st = E.status(state, ctx);
  assert.equal(st.cursor, 0);                // nothing done: still session 1
  assert.equal(st.missed.length, 19);         // 2 Nov .. 20 Nov overdue
  const r = applyOk(state, { ...ctx, today: '2026-11-21' }, { type: 'resolveMissed', mode: 'shift' });
  const pl = E.planned(r.state.sessions);
  assert.equal(pl[0].seq, 0);
  assert.equal(pl[0].date, '2026-11-21');
  assert.equal(pl[0].week, 1);
  assert.equal(E.deriveCursor(r.state.sessions, 56), 0);
  assert.equal(r.preview.cursorAfter, 0);
  assert.ok(pl.every((s, i) => i === 0 || s.date > pl[i - 1].date));
  assert.equal(r.state.sessions.length, 56);  // identity preserved
  assert.deepEqual(r.state.sessions.map((s) => s.id), state.sessions.map((s) => s.id));
});

test('skip marks missed sessions skipped without completing them; cursor moves past them', () => {
  const { state, ctx } = mk('2026-11-05');
  const r = applyOk(state, ctx, { type: 'resolveMissed', mode: 'skip' });
  assert.equal(r.state.sessions.filter((s) => s.status === 'skipped').length, 3);
  assert.equal(r.state.sessions.filter((s) => s.status === 'completed').length, 0);
  assert.equal(E.deriveCursor(r.state.sessions, 56), 3);
});

test('repeat week re-creates the week from today, keeps completed history', () => {
  let { state, ctx } = mk('2026-11-03');
  state.sessions[0].status = 'completed'; state.sessions[0].performedOn = '2026-11-02';
  const c2 = { ...ctx, today: '2026-11-09' };
  const r = applyOk(state, c2, { type: 'resolveMissed', mode: 'repeatWeek' });
  const w1 = r.state.sessions.filter((s) => s.week === 1);
  assert.equal(w1.filter((s) => s.status === 'completed').length, 1);           // history intact
  assert.equal(E.planned(r.state.sessions)[0].seq, 0);                            // cursor back at week 1
  assert.equal(E.planned(r.state.sessions)[0].run, 2);                            // new run of seq 0
  assert.equal(E.planned(r.state.sessions)[0].date, '2026-11-09');
});

test('move: conflict on occupied day is blocked, swap option resolves it, completed cannot move', () => {
  const { state, ctx } = mk('2026-11-02');
  const a = state.sessions[2], b = state.sessions[3];
  const p = E.preview(state, ctx, { type: 'move', sessionId: a.id, toDate: b.date });
  assert.equal(p.valid, false);
  assert.equal(p.conflicts[0].code, 'duplicate-day');
  const r = applyOk(state, ctx, { type: 'move', sessionId: a.id, toDate: b.date, onOccupied: 'swap' });
  const na = r.state.sessions.find((s) => s.id === a.id), nb = r.state.sessions.find((s) => s.id === b.id);
  assert.equal(na.date, b.date); assert.equal(nb.date, a.date);
  assert.equal(na.seq, a.seq); assert.equal(na.ref, a.ref);                         // identity unchanged
  state.sessions[0].status = 'completed';
  const bad = E.preview(state, ctx, { type: 'move', sessionId: state.sessions[0].id, toDate: '2026-12-30' });
  assert.equal(bad.ok, false);
});

test('cross-week reordering is blocked, within-week swap is allowed', () => {
  const { state, ctx } = mk('2026-11-02');
  const w1 = state.sessions[0], w2 = state.sessions[7];
  const bad = E.preview(state, ctx, { type: 'swap', a: w1.id, b: w2.id });
  assert.equal(bad.valid, false);
  assert.ok(bad.conflicts.some((c) => c.code === 'sequence'));
  const good = E.preview(state, ctx, { type: 'swap', a: state.sessions[1].id, b: state.sessions[4].id });
  assert.equal(good.valid, true);
});

test('moving to the past is blocked; rest-day move is a warning only', () => {
  const { state, ctx } = mk('2026-11-10', [1, 2, 3, 4, 5, 6]);
  const s = state.sessions.find((x) => x.date >= '2026-11-12');
  const past = E.preview(state, ctx, { type: 'move', sessionId: s.id, toDate: '2026-11-09' });
  assert.ok(past.conflicts.some((c) => c.code === 'in-past'));
  const sunday = E.preview(state, ctx, { type: 'move', sessionId: state.sessions.at(-1).id, toDate: '2027-01-17' });
  assert.equal(dow('2027-01-17'), 0);
  assert.ok(sunday.conflicts.some((c) => c.code === 'rest-day' && c.severity === 'warn'));
  assert.equal(sunday.valid, true);
});

test('shift moves all future sessions and keeps cursor', () => {
  const { state, ctx } = mk('2026-11-02');
  const r = applyOk(state, ctx, { type: 'shift', fromSeq: 5, days: 3 });
  assert.equal(r.state.sessions[5].date, addDays(state.sessions[5].date, 3));
  assert.equal(r.state.sessions[4].date, state.sessions[4].date);
  assert.equal(r.preview.cursorAfter, 0);
});

test('moveWeek without ripple that would collide with the next week is blocked; with ripple it works', () => {
  const { state, ctx } = mk('2026-11-02');
  const p = E.preview(state, ctx, { type: 'moveWeek', week: 1, toStartDate: '2026-11-04' });
  assert.equal(p.valid, false);
  const r = E.preview(state, ctx, { type: 'moveWeek', week: 1, toStartDate: '2026-11-04', ripple: true });
  assert.equal(r.valid, true);
  assert.equal(r.next.sessions[0].date, '2026-11-04');
  assert.equal(r.next.sessions[55].date, '2027-12-29'.replace('2027-12-29', '2026-12-29'));
});

test('pause then resume after 20 days: re-ramp suggested; continue keeps position, reramp repeats an earlier week', () => {
  let { state, ctx } = mk('2026-11-02');
  for (let i = 0; i < 10; i++) { state.sessions[i].status = 'completed'; state.sessions[i].performedOn = state.sessions[i].date; }
  const paused = applyOk(state, { ...ctx, today: '2026-11-12' }, { type: 'pause' });
  assert.equal(paused.state.instance.status, 'paused');
  assert.equal(E.preview(paused.state, ctx, { type: 'move', sessionId: paused.state.sessions[12].id, toDate: '2026-12-01' }).ok, false);
  const c2 = { ...ctx, today: '2026-12-02' };
  const prev = E.preview(paused.state, c2, { type: 'resume' });
  assert.ok(prev.suggestion, 'long break suggests re-ramp');
  assert.equal(prev.suggestion.gapDays, 20);
  const cont = applyOk(paused.state, c2, { type: 'resume' });
  assert.equal(cont.state.instance.status, 'active');
  assert.equal(E.planned(cont.state.sessions)[0].seq, 10);
  assert.equal(E.planned(cont.state.sessions)[0].date, '2026-12-02');
  const ramp = applyOk(paused.state, c2, { type: 'resume', reramp: true });
  assert.equal(E.planned(ramp.state.sessions)[0].week, prev.suggestion.fromWeek);
  assert.equal(ramp.state.sessions.filter((s) => s.status === 'completed').length, 10);
});

test('jump ahead skips intermediate sessions and warns when crossing a phase', () => {
  const { state, ctx } = mk('2026-11-02');
  const r = E.preview(state, ctx, { type: 'jump', toSeq: 14 });
  assert.equal(r.valid, true);
  assert.ok(r.conflicts.some((c) => c.code === 'phase-skip'));
  assert.equal(r.cursorAfter, 14);
  assert.equal(E.preview(state, ctx, { type: 'jump', toSeq: 0 }).ok, false);
});

test('apply requires explicit confirmation', () => {
  const { state, ctx } = mk();
  const r = E.apply(state, ctx, { type: 'shift', fromSeq: 0, days: 1 });
  assert.equal(r.ok, false); assert.equal(r.error.code, 'needs-confirmation');
});

test('undo restores previous schedule, and refuses when state moved on', () => {
  const { state, ctx } = mk();
  const r = applyOk(state, ctx, { type: 'shift', fromSeq: 3, days: 2 });
  const u = E.undo(r.state, r.change);
  assert.ok(u.ok);
  assert.deepEqual(u.state.sessions, state.sessions);
  const later = applyOk(r.state, ctx, { type: 'shift', fromSeq: 3, days: 1 });
  assert.equal(E.undo(later.state, r.change).ok, false);
});

test('undo of repeat-week removes added runs and restores removed planned sessions', () => {
  let { state, ctx } = mk('2026-11-09');
  const r = applyOk(state, ctx, { type: 'resolveMissed', mode: 'repeatWeek' });
  const u = E.undo(r.state, r.change);
  assert.ok(u.ok);
  assert.deepEqual([...u.state.sessions].sort((a, b) => a.id.localeCompare(b.id)), [...state.sessions].sort((a, b) => a.id.localeCompare(b.id)));
});

test('reconcile fixes a stale cursor and duplicate days without touching completed sessions', () => {
  const { state, ctx } = mk('2026-11-02');
  state.instance.cursor = { seq: 9 };
  state.sessions[3].date = state.sessions[2].date;
  state.sessions[0].status = 'completed'; state.sessions[0].performedOn = state.sessions[0].date;
  const r = applyOk(state, ctx, { type: 'reconcile' });
  assert.equal(r.state.instance.cursor.seq, 1);
  assert.equal(new Set(r.state.sessions.map((s) => s.date)).size, 56);
  assert.deepEqual(r.state.sessions[0], state.sessions[0]);
});

test('cursor is derived from completion, not from the calendar', () => {
  const { state, ctx } = mk('2030-01-01');
  assert.equal(E.deriveCursor(state.sessions, 56), 0);
  state.sessions.forEach((s) => { s.status = 'completed'; });
  assert.equal(E.deriveCursor(state.sessions, 56), 56);
});

import * as Prog from '../www/src/domain/programme.js';
test('flattenSession expands "each side" into Left then Right steps and supersets into rounds', () => {
  const steps = Prog.flattenSession({ sections: { main: [{ type: 'straight', items: [{ exercise: 'a', name: 'Lunge', sets: 2, reps: 10, side: 'each', rest: 45 }] }, { type: 'superset', rounds: 2, restAfterRound: 60, items: [{ exercise: 'b', name: 'Curl', sets: 1 }, { exercise: 'c', name: 'Press', sets: 1 }] }] } });
  assert.deepEqual(steps.map((s) => s.item.name + (s.item.side ? ':' + s.item.side : '')), ['Lunge:Left', 'Lunge:Right', 'Lunge:Left', 'Lunge:Right', 'Curl', 'Press', 'Curl', 'Press']);
  assert.equal(steps[0].restAfterRound, 0); assert.equal(steps[1].restAfterRound, 45);
  assert.equal(steps[5].restAfterRound, 60); assert.ok(steps.every((s, i) => s.index === i));
});
