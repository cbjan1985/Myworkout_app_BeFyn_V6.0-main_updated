import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as E from '../www/src/domain/schedule-engine.js';
import { buildNotifications, MAX_ONE_OFF } from '../www/src/domain/reminders.js';

const tpl = JSON.parse(fs.readFileSync(new URL('../www/assets/seed/programme-8wk-muscle-gain.json', import.meta.url)));
const sequence = tpl.sessions.map((s, i) => ({ seq: i, ref: s.id, week: s.week, name: s.name }));
const ALL = [1, 2, 3, 4, 5, 6, 0];
const mk = () => { const instance = { id: 'i', startDate: '2026-11-21', status: 'active' }; return { instance, sessions: E.generateSchedule(instance, sequence, ALL, (() => { let n = 0; return () => 's' + n++; })()) }; };
const R = (o) => ({ id: 'r1', enabled: true, time: '07:30', days: [], title: '', ...o });
const run = (reminders, st, o = {}) => buildNotifications({ reminders, sessions: st.sessions, instanceStatus: st.instance.status, today: '2026-11-21', now: new Date('2026-11-21T06:00:00'), detailed: true, ...o });

test('workout reminders follow the real schedule: one notification per upcoming session, at the reminder time', () => {
  const p = run([R({ kind: 'workout' })], mk());
  assert.equal(p.repeating.length, 0);
  assert.equal(p.oneOff.length, 22);                      // 21-day horizon: 21 Nov .. 12 Dec inclusive
  assert.equal(p.oneOff[0].at, new Date('2026-11-21T07:30:00').toISOString());
  assert.match(p.oneOff[0].body, /week 1/);
});

test('a reminder time that already passed today is not scheduled for today', () => {
  const p = run([R({ kind: 'workout', time: '05:00' })], mk());
  assert.equal(p.oneOff[0].at.slice(0, 10) >= '2026-11-21', true);
  assert.ok(!p.oneOff.some((o) => new Date(o.at) <= new Date('2026-11-21T06:00:00')));
});

test('moving, completing or pausing changes what fires', () => {
  const st = mk();
  const first = st.sessions[0]; first.status = 'completed'; first.performedOn = '2026-11-21';
  const p1 = run([R({ kind: 'workout' })], st);
  assert.ok(!p1.oneOff.some((o) => o.body.includes(first.name) && o.at.startsWith(new Date('2026-11-21T07:30:00').toISOString().slice(0, 10)) && o.id === run([R({ kind: 'workout' })], mk()).oneOff[0].id), 'completed session has no reminder');
  const moved = mk(); moved.sessions[1].date = '2026-11-30'; moved.sessions[2].date = '2026-12-01';
  assert.ok(run([R({ kind: 'workout' })], moved).oneOff.some((o) => o.at.startsWith('2026-11-30') || new Date(o.at).getDate() === 30));
  const paused = mk(); paused.instance.status = 'paused';
  assert.equal(run([R({ kind: 'workout' }), R({ id: 'r2', kind: 'upcoming' }), R({ id: 'r3', kind: 'missed' })], paused).oneOff.length, 0, 'nothing session-related while paused');
});

test('upcoming = evening before; missed only fires when a session is really overdue; check-in once a week', () => {
  const st = mk();
  const up = run([R({ kind: 'upcoming', time: '20:00' })], st);
  assert.equal(new Date(up.oneOff[0].at).getDate(), 21);       // for the 22 Nov session, on 21 Nov evening
  const none = run([R({ kind: 'missed' })], st, { today: '2026-11-21' });
  assert.equal(none.oneOff.length, 1);                          // next-day check on the first upcoming session
  const late = run([R({ kind: 'missed' })], st, { today: '2026-11-25', now: new Date('2026-11-25T06:00:00') });
  assert.equal(late.oneOff.length, 1); assert.equal(new Date(late.oneOff[0].at).getDate(), 26); // overdue sessions -> tomorrow
  const wk = run([R({ kind: 'milestone', time: '18:00' })], st);
  assert.ok(wk.oneOff.length >= 3 && wk.oneOff.length <= 4); assert.match(wk.oneOff[0].title, /Week 1 check-in/);
});

test('recurring kinds repeat weekly on the chosen days and respect the day filter for session kinds', () => {
  const p = run([R({ kind: 'hydration', days: [1, 3, 5] }), R({ id: 'x', kind: 'backup', time: '09:00' })], mk());
  assert.equal(p.repeating.length, 3 + 7);
  const only = run([R({ kind: 'workout', days: [1] })], mk());
  assert.ok(only.oneOff.length > 0 && only.oneOff.every((o) => new Date(o.at).getDay() === 1));
});

test('disabled reminders and the notification cap', () => {
  assert.equal(run([R({ kind: 'workout', enabled: false })], mk()).oneOff.length, 0);
  const many = run([R({ kind: 'workout' }), R({ id: 'b', kind: 'upcoming' }), R({ id: 'c', kind: 'milestone' })], mk(), { horizonDays: 56 });
  assert.ok(many.oneOff.length <= MAX_ONE_OFF);
  assert.deepEqual(many.oneOff.map((o) => o.at), [...many.oneOff.map((o) => o.at)].sort());
});

test('notification text is generic unless the person opts in to details', () => {
  const st = mk(); const rs = [R({ kind: 'workout' }), R({ id: 'u', kind: 'upcoming' }), R({ id: 'm', kind: 'milestone' })];
  const generic = run(rs, st, { detailed: false }), detailed = run(rs, st, { detailed: true });
  assert.ok(generic.oneOff.length > 0);
  assert.ok(generic.oneOff.every((o) => !/week \d|Week \d/.test(o.title + ' ' + o.body) && !sequence.some((q) => (o.title + o.body).includes(q.name))), 'no session names or week numbers when generic');
  assert.ok(detailed.oneOff.some((o) => /week 1/.test(o.body)));
});
