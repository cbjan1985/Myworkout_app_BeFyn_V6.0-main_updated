// Smart Schedule sheets. Every operation: choose -> PREVIEW (changes + conflicts) -> apply -> toast with Undo.
import { h } from './dom.js';
import { openSheet, toast, confirmDialog } from './dom.js';
import { btn, field, input, select, stepper, toggle, banner, pill, list, item } from './components.js';
import { prettyDate, addDays, todayIso } from '../core/util.js';
import * as Engine from '../domain/schedule-engine.js';

const label = (s) => `${s.name}`;
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** Generic preview-then-apply sheet for a schedule operation. */
export function openPreview(app, op, { title = 'Review the change', onDone, intro } = {}) {
  const p = app.previewSchedule(op);
  const sheet = openSheet({ title, content: '' });
  const body = [];
  if (!p.ok) { body.push(banner(p.error.message, { kind: 'err', icon: 'warn' })); sheet.setContent(h('div', { class: 'stack' }, body)); sheet.setActions([{ label: 'Close', kind: 'secondary' }]); return sheet; }
  if (intro) body.push(h('p', {}, intro));
  const moves = p.changes.filter((c) => c.kind === 'move'), adds = p.changes.filter((c) => c.kind === 'add'), rem = p.changes.filter((c) => c.kind === 'remove'), st = p.changes.filter((c) => c.kind === 'status');
  const parts = [];
  if (moves.length) parts.push(`${plural(moves.length, 'session')} will move`);
  if (adds.length) parts.push(`${plural(adds.length, 'session')} will be set up again`);
  if (st.length) parts.push(`${plural(st.length, 'session')} will be marked skipped`);
  if (!parts.length) parts.push('Nothing changes');
  body.push(h('p', { class: 'strong' }, parts.join(', ') + '.'));
  const rows = p.changes.slice(0, 6).map((c) => item({ title: c.label, meta: c.kind === 'move' ? `${prettyDate(c.before.date)} \u2192 ${prettyDate(c.after.date)}` : c.kind === 'add' ? `New on ${prettyDate(c.after.date)}` : c.kind === 'remove' ? `Was ${prettyDate(c.before.date)}` : `Marked ${c.after.status}`, chev: false }));
  if (rows.length) body.push(list(rows)); if (p.changes.length > 6) body.push(h('p', { class: 'small muted' }, `and ${p.changes.length - 6} more`));
  if (p.cursorBefore !== p.cursorAfter || (p.op.type === 'restartFromWeek' || p.op.type === 'resolveMissed')) {
    const seq = app.state.programme.sequence; const a = seq[p.cursorAfter];
    body.push(h('p', { class: 'small muted' }, a ? `You will continue from: Week ${a.week}, ${a.name}.` : 'The programme will be complete.'));
  }
  for (const c of p.conflicts) body.push(banner(c.message, { kind: c.severity === 'block' ? 'err' : '', icon: c.severity === 'block' ? 'warn' : 'info' }));
  for (const n of p.notes || []) body.push(banner(n, { kind: 'info' }));
  if (p.suggestion) body.push(banner(p.suggestion.message, { kind: 'info' }));
  body.push(h('p', { class: 'small muted' }, 'Completed sessions and your history are never changed. You can undo this right after.'));
  sheet.setContent(h('div', { class: 'stack' }, body));
  sheet.setActions([{ label: 'Cancel', kind: 'secondary' }, { label: 'Apply', disabled: !p.valid || !p.changes.length && op.type !== 'pause', busy: true, onClick: async () => {
    const r = await app.applySchedule(op);
    if (!r.ok) { toast(r.error.message); return false; }
    toast(r.change.summary, { action: { label: 'Undo', onClick: async () => { const u = await app.undoSchedule(r.change.id); toast(u.ok ? 'Change undone' : u.error.message); onDone && onDone(); } } });
    onDone && onDone();
  } }]);
  return sheet;
}

const upcoming = (app) => Engine.planned(app.state.programme.sessions);
const sessionOption = (s) => [s.id, `${prettyDate(s.date)}: ${label(s)} (week ${s.week})`];

export function openMoveSheet(app, session, onDone) {
  const date = input({ type: 'date', value: session.date, min: app.today() });
  const swap = toggle(true, () => {}, 'Swap if the day is taken');
  const sheet = openSheet({ title: 'Move session', content: h('div', { class: 'stack' }, h('p', {}, `${label(session)} is planned for ${prettyDate(session.date)}.`), field('New day', date), h('label', { class: 'row between' }, h('span', {}, h('span', { class: 'strong' }, 'Swap if the day is taken'), h('span', { class: 'small muted', style: { display: 'block' } }, 'Exchanges the two sessions instead of refusing.')), swap)), actions: [{ label: 'Cancel', kind: 'secondary' }, { label: 'Preview', close: false, onClick: () => { sheet.close(); openPreview(app, { type: 'move', sessionId: session.id, toDate: date.value, onOccupied: swap.querySelector('input').checked ? 'swap' : 'block' }, { title: 'Move session', onDone }); } }] });
}

export function openSwapSheet(app, session, onDone) {
  const others = upcoming(app).filter((s) => s.id !== session.id && s.week === session.week);
  if (!others.length) { toast('There is no other upcoming session in this week to swap with.'); return; }
  const sel = select(others.map(sessionOption), others[0].id);
  const sheet = openSheet({ title: 'Swap sessions', content: h('div', { class: 'stack' }, h('p', {}, `Swap ${label(session)} with another session in week ${session.week}. Sessions can be reordered within a programme week.`), field('Swap with', sel)), actions: [{ label: 'Cancel', kind: 'secondary' }, { label: 'Preview', close: false, onClick: () => { sheet.close(); openPreview(app, { type: 'swap', a: session.id, b: sel.value }, { title: 'Swap sessions', onDone }); } }] });
}

export function openMoveWeekSheet(app, onDone) {
  const weeks = [...new Set(upcoming(app).map((s) => s.week))]; if (!weeks.length) { toast('There are no upcoming weeks to move.'); return; }
  const wk = select(weeks.map((w) => [String(w), `Week ${w}`]), String(weeks[0])); const first = (w) => upcoming(app).find((s) => s.week === +w).date;
  const date = input({ type: 'date', value: first(weeks[0]), min: app.today() }); wk.addEventListener('change', () => { date.value = first(wk.value); });
  const ripple = toggle(true, () => {}, 'Move later weeks too');
  const sheet = openSheet({ title: 'Move a week', content: h('div', { class: 'stack' }, field('Week', wk), field('New start day', date), h('label', { class: 'row between' }, h('span', {}, h('span', { class: 'strong' }, 'Move later weeks too'), h('span', { class: 'small muted', style: { display: 'block' } }, 'Keeps the weeks in order without overlap.')), ripple)), actions: [{ label: 'Cancel', kind: 'secondary' }, { label: 'Preview', close: false, onClick: () => { sheet.close(); openPreview(app, { type: 'moveWeek', week: +wk.value, toStartDate: date.value, ripple: ripple.querySelector('input').checked }, { title: 'Move week', onDone }); } }] });
}

export function openShiftSheet(app, onDone) {
  const up = upcoming(app); if (!up.length) { toast('There are no upcoming sessions to shift.'); return; }
  const from = select(up.slice(0, 40).map((s) => [String(s.seq), `From ${prettyDate(s.date)}: ${label(s)}`]), String(up[0].seq));
  const days = stepper({ value: 1, min: -14, max: 60, label: 'Days' });
  const sheet = openSheet({ title: 'Shift upcoming sessions', content: h('div', { class: 'stack' }, h('p', {}, 'Moves this session and everything after it by the same number of days.'), field('Start from', from), field('Days (negative moves earlier)', days)), actions: [{ label: 'Cancel', kind: 'secondary' }, { label: 'Preview', close: false, onClick: () => { sheet.close(); openPreview(app, { type: 'shift', fromSeq: +from.value, days: days.get() }, { title: 'Shift schedule', onDone }); } }] });
}

export function openJumpSheet(app, onDone) {
  const p = app.state.programme; const cur = Engine.deriveCursor(p.sessions, p.sequence.length);
  const opts = p.sequence.filter((q) => q.seq > cur && p.sessions.some((s) => s.seq === q.seq && s.status === 'planned')).slice(0, 80);
  if (!opts.length) { toast('There is nothing further ahead to jump to.'); return; }
  const sel = select(opts.map((q) => [String(q.seq), `Week ${q.week}: ${q.name}`]), String(opts[0].seq));
  const sheet = openSheet({ title: 'Jump ahead', content: h('div', { class: 'stack' }, banner('Skipped sessions are marked skipped, not completed. Only jump if you have really done or want to skip that training.', { icon: 'warn' }), field('Continue from', sel)), actions: [{ label: 'Cancel', kind: 'secondary' }, { label: 'Preview', close: false, onClick: () => { sheet.close(); openPreview(app, { type: 'jump', toSeq: +sel.value }, { title: 'Jump ahead', onDone }); } }] });
}

export function openRestartSheet(app, onDone, week) {
  const p = app.state.programme; const cur = Engine.deriveCursor(p.sessions, p.sequence.length); const curWeek = p.sequence[Math.min(cur, p.sequence.length - 1)].week;
  const weeks = [...new Set(p.sequence.filter((q) => q.week <= curWeek).map((q) => q.week))];
  const sel = select(weeks.map((w) => [String(w), `Week ${w}`]), String(week || curWeek));
  const sheet = openSheet({ title: 'Repeat from a week', content: h('div', { class: 'stack' }, h('p', {}, 'Go back to the start of a week and train it again from today. What you already did stays in your history.'), field('Start again from', sel)), actions: [{ label: 'Cancel', kind: 'secondary' }, { label: 'Preview', close: false, onClick: () => { sheet.close(); openPreview(app, { type: 'restartFromWeek', week: +sel.value }, { title: 'Repeat a week', onDone }); } }] });
}

/** The calm "I missed some training" flow. Missing sessions never changes the programme on its own. */
export function openMissedSheet(app, onDone) {
  const st = app.scheduleStatus(); if (!st || !st.missed.length) { toast('You are all caught up.'); return; }
  const m = st.missed; const week = m[0].week; const cur = app.state.programme.sequence[st.cursor];
  const choice = (title, text, op, extra) => item({ title, meta: text, chev: true, onClick: () => { sheet.close(); extra ? extra() : openPreview(app, op, { title, onDone }); } });
  const sheet = openSheet({ title: 'Pick up where you are', content: h('div', { class: 'stack' }, h('p', {}, `${plural(m.length, 'session')} from ${prettyDate(m[0].date)} to ${prettyDate(m[m.length - 1].date)} did not happen. That is fine: your programme did not move on without you.`), cur && h('p', { class: 'small muted' }, `Your next programme session is Week ${cur.week}: ${cur.name}.`), st.reramp ? banner(st.reramp.message, { kind: 'info' }) : null, list([
    choice('Continue from where I left off', 'Move everything forward so the next session is today. Nothing is skipped.', { type: 'resolveMissed', mode: 'shift' }),
    choice(`Repeat week ${week}`, 'Start that week again from today.', { type: 'resolveMissed', mode: 'repeatWeek' }),
    choice('Skip the missed sessions', 'Mark them skipped and keep the rest of the dates.', { type: 'resolveMissed', mode: 'skip' }),
    choice('Jump ahead\u2026', 'Choose a later session to continue from.', null, () => openJumpSheet(app, onDone)),
  ])), actions: [{ label: 'Not now', kind: 'secondary' }] });
}

export function openPauseSheet(app, onDone) {
  const p = app.state.programme.instance;
  if (p.status === 'active') {
    openSheet({ title: 'Pause programme', center: true, content: h('p', {}, 'Pause when you are travelling, unwell or taking a break. Nothing is marked missed while paused, and you can resume any day.'), actions: [{ label: 'Cancel', kind: 'secondary' }, { label: 'Pause', close: false, onClick: (api) => { api.close(); openPreview(app, { type: 'pause' }, { title: 'Pause programme', onDone }); return false; } }] });
    return;
  }
  const date = input({ type: 'date', value: app.today(), min: p.pause?.since || app.today() });
  const mode = { v: 'continue' };
  const gapOf = (d) => Math.max(0, Math.round((new Date(d) - new Date(p.pause?.since || d)) / 864e5));
  const area = h('div', { class: 'stack' });
  const draw = () => { const g = gapOf(date.value); const pv = app.previewSchedule({ type: 'resume', date: date.value }); area.replaceChildren(h('p', { class: 'small muted' }, `Paused for ${plural(g, 'day')}.`), pv.suggestion ? h('div', { class: 'stack' }, banner(pv.suggestion.message, { kind: 'info' }), h('div', { class: 'seg', role: 'group', 'aria-label': 'How to restart' }, [['continue', 'Continue where I left off'], ['reramp', `Ease back in (week ${pv.suggestion.fromWeek})`]].map(([v, l]) => h('button', { type: 'button', 'aria-pressed': String(mode.v === v), onclick: () => { mode.v = v; draw(); } }, l)))) : null); };
  date.addEventListener('change', draw); draw();
  const sheet = openSheet({ title: 'Resume programme', content: h('div', { class: 'stack' }, field('Resume on', date), area), actions: [{ label: 'Cancel', kind: 'secondary' }, { label: 'Preview', close: false, onClick: () => { sheet.close(); openPreview(app, { type: 'resume', date: date.value, reramp: mode.v === 'reramp' }, { title: 'Resume programme', onDone }); } }] });
}

export function openResyncSheet(app, onDone) {
  openPreview(app, { type: 'reconcile' }, { title: 'Re-synchronise', intro: 'Checks that your position in the programme, session order and dates agree, and repairs any mismatch without touching completed sessions.', onDone });
}

export function openChangeLog(app, onDone) {
  const ch = app.state.changes.slice(0, 12);
  const sheet = openSheet({ title: 'Schedule changes', content: ch.length ? list(ch.map((c, i) => item({ title: c.summary, meta: `${new Date(c.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}${c.undone ? ' \u00b7 undone' : ''}`, chev: false, trailing: !c.undone && i === 0 ? btn('Undo', async () => { const u = await app.undoSchedule(c.id); toast(u.ok ? 'Change undone' : u.error.message); sheet.close(); onDone && onDone(); }, { kind: 'secondary', sm: true }) : null }))) : h('p', { class: 'muted' }, 'No schedule changes yet.'), actions: [{ label: 'Close', kind: 'secondary' }] });
}
export { confirmDialog, pill, addDays, todayIso };
