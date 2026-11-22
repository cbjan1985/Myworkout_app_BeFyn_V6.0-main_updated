import { h } from '../dom.js';
import { btn, iconBtn, card, pill, list, item, sectionTitle, empty, banner } from '../components.js';
import { prettyDate, addDays, dow, weekStart, monthStart, MONTHS, DOW_LONG } from '../../core/util.js';
import { effDate } from '../../domain/schedule-engine.js';
import { openSessionSheet, statusPill } from '../session-view.js';
import { openMissedSheet, openMoveWeekSheet, openShiftSheet, openJumpSheet, openRestartSheet, openPauseSheet, openResyncSheet, openChangeLog } from '../sheets.js';

let view = null;

export async function calendar(app, ctx) {
  const t = app.today(); if (!view) view = { month: monthStart(t), selected: t };
  const p = app.state.programme; const rr = ctx.rerender;
  const bySession = new Map(); const logsBy = new Map();
  if (p) for (const s of p.sessions) { const d = effDate(s); (bySession.get(d) || bySession.set(d, []).get(d)).push(s); }
  for (const l of app.state.logs) if (!l.scheduledId) (logsBy.get(l.date) || logsBy.set(l.date, []).get(l.date)).push(l);
  const range = p ? [p.instance.startDate, [...p.sessions].map(effDate).sort().pop()] : null;
  const kind = (iso) => {
    const ss = bySession.get(iso) || [], ls = logsBy.get(iso) || [];
    if (ss.some((s) => s.status === 'completed') || ls.length) return 'done';
    if (ss.some((s) => s.status === 'planned')) return iso < t ? 'missed' : 'planned';
    if (ss.some((s) => s.status === 'skipped')) return 'skipped';
    if (range && iso >= range[0] && iso <= range[1]) return 'rest'; return '';
  };
  const NAMES = { done: 'completed', planned: 'planned', missed: 'waiting', skipped: 'skipped', rest: 'rest day', '': 'nothing planned' };

  const first = view.month, startGrid = weekStart(first); const [yy, mm] = first.split('-').map(Number); const dim = new Date(yy, mm, 0).getDate();
  const weeks = Math.ceil((((dow(first) + 6) % 7) + dim) / 7);
  const cells = [];
  for (let i = 0; i < weeks * 7; i++) {
    const iso = addDays(startGrid, i), inMonth = iso.slice(0, 7) === first.slice(0, 7), k = kind(iso), names = (bySession.get(iso) || []).map((s) => s.name).concat((logsBy.get(iso) || []).map((l) => l.name));
    cells.push(h('button', { class: `day${inMonth ? '' : ' out'}${iso === t ? ' today' : ''}`, type: 'button', 'aria-pressed': String(iso === view.selected), 'aria-label': `${DOW_LONG[dow(iso)]} ${Number(iso.slice(8))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}: ${names.join(', ') || NAMES[k]}${names.length ? ', ' + NAMES[k] : ''}`, onclick: () => { view.selected = iso; if (!inMonth) view.month = monthStart(iso); rr(); } }, h('span', { class: 'dn' }, Number(iso.slice(8))), h('span', { class: 'dot ' + k, 'aria-hidden': 'true', style: k ? {} : { visibility: 'hidden' } })));
  }
  const shiftMonth = (n) => { const d = new Date(yy, mm - 1 + n, 1); view.month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; rr(); };

  const grid = card([
    h('div', { class: 'row between', style: { marginBottom: '8px' } }, iconBtn('back', 'Previous month', () => shiftMonth(-1)), h('h2', { 'aria-live': 'polite' }, `${MONTHS[mm - 1]} ${yy}`), iconBtn('chev', 'Next month', () => shiftMonth(1))),
    h('div', { class: 'week-strip', 'aria-hidden': 'true' }, ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d) => h('div', { class: 'dow' }, d))),
    h('div', { class: 'week-strip', role: 'group', 'aria-label': 'Month' }, cells),
    h('div', { class: 'legend', style: { marginTop: '10px' } }, [['done', 'Done'], ['planned', 'Planned'], ['missed', 'Waiting'], ['skipped', 'Skipped'], ['rest', 'Rest']].map(([k, l]) => h('span', {}, h('i', { class: 'dot ' + k }), l))),
  ]);

  // agenda for the selected day
  const sel = view.selected, ss = (bySession.get(sel) || []), ls = (logsBy.get(sel) || []);
  const rows = [];
  for (const s of ss) {
    const log = app.state.logs.find((l) => l.scheduledId === s.id && l.status === 'completed');
    rows.push(item({ title: s.name, meta: `Week ${s.week}${log ? ` \u00b7 ${log.performances.reduce((n, pf) => n + pf.sets.length, 0)} sets${log.durationSec ? ` \u00b7 ${Math.round(log.durationSec / 60)} min` : ''}` : ''}`, trailing: statusPill(s, t), onClick: () => openSessionSheet(app, s, rr) }));
  }
  for (const l of ls) rows.push(item({ title: l.name, meta: l.durationSec ? `${Math.round(l.durationSec / 60)} min` : 'Logged', trailing: pill('Done', 'ok'), chev: false }));
  const agenda = [sectionTitle(prettyDate(sel, true) + (sel === t ? ' (today)' : ''))];
  if (rows.length) agenda.push(list(rows)); else agenda.push(card(h('p', { class: 'muted' }, range && sel >= range[0] && sel <= range[1] ? 'Rest day. Recovery is part of the programme.' : 'Nothing planned.')));

  const kids = [grid, ...agenda];
  if (!p) kids.push(empty({ icon: 'calendar', title: 'No active programme', text: 'Start a programme in Train to see your plan here. Activities you log still appear on the calendar.', action: btn('Go to Train', () => app.router.navigate('/train')) }));
  else {
    const st = app.scheduleStatus(); const paused = p.instance.status === 'paused'; const done = p.instance.status === 'completed';
    if (st.missed.length && !paused) kids.push(banner([h('strong', {}, `${st.missed.length} session${st.missed.length === 1 ? '' : 's'} waiting. `), 'Choose how to carry on.', h('div', { style: { marginTop: '8px' } }, btn('Choose how to continue', () => openMissedSheet(app, rr), { sm: true }))]));
    kids.push(sectionTitle('Adjust schedule'));
    kids.push(list([
      !paused && !done && item({ title: 'Move a week', meta: 'Shift a whole week to new dates', lead: 'calendar', onClick: () => openMoveWeekSheet(app, rr) }),
      !paused && !done && item({ title: 'Shift upcoming sessions', meta: 'Push everything later (or earlier) by some days', lead: 'shift', onClick: () => openShiftSheet(app, rr) }),
      !paused && !done && item({ title: 'Repeat from a week', meta: 'Go back and train a week again', lead: 'refresh', onClick: () => openRestartSheet(app, rr) }),
      !paused && !done && item({ title: 'Jump ahead', meta: 'Continue from a later session', lead: 'skip', onClick: () => openJumpSheet(app, rr) }),
      !done && item({ title: paused ? 'Resume programme' : 'Pause programme', meta: paused ? `Paused since ${prettyDate(p.instance.pause.since)}` : 'Travel, illness or a break', lead: paused ? 'play' : 'pause', onClick: () => openPauseSheet(app, rr) }),
      item({ title: 'Re-synchronise', meta: 'Check position, order and dates agree', lead: 'sync', onClick: () => openResyncSheet(app, rr) }),
      item({ title: 'Schedule changes', meta: app.state.changes.length ? `${app.state.changes.length} recorded, latest can be undone` : 'No changes yet', lead: 'list', onClick: () => openChangeLog(app, rr) }),
    ]));
  }
  return { title: 'Calendar', actions: [btn('Today', () => { view = { month: monthStart(t), selected: t }; ctx.rerender(); }, { kind: 'text', sm: true })], content: h('div', { class: 'stack-lg' }, kids) };
}
