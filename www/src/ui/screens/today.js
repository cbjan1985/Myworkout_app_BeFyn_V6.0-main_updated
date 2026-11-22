import { h } from '../dom.js';
import { openSheet, toast, confirmDialog } from '../dom.js';
import { btn, card, banner, pill, progressBar, metric, empty, sectionTitle, field, input, stepper, select, textarea, list, item } from '../components.js';
import { icon } from '../icons.js';
import { prettyDate, DOW_LONG } from '../../core/util.js';
import { weekSummary, phaseLabel } from '../../domain/programme.js';
import { openMissedSheet, openPauseSheet } from '../sheets.js';
import { openSessionSheet, estimateMinutes, countExercises } from '../session-view.js';

export async function today(app, ctx) {
  const s = app.state, t = app.today(); const p = s.programme; const rr = ctx.rerender;
  const kids = [];
  if (s.degraded) kids.push(banner(['Storage is not available on this device right now, so changes will not be saved after you close BeFyn. ', s.degradedReason || ''], { kind: 'err', icon: 'warn' }));

  if (s.draft) kids.push(card([h('div', { class: 'row' }, h('span', { class: 'lead item', style: { width: '40px', minHeight: '40px', padding: 0, justifyContent: 'center' } }, icon('play', 22)), h('div', { class: 'grow' }, h('h2', {}, 'Workout in progress'), h('p', { class: 'muted small' }, s.draft.name))), h('div', { class: 'row', style: { marginTop: '12px' } }, btn('Continue', () => app.router.navigate('/workout'), { block: true }), btn('Discard', async () => { if (await confirmDialog({ title: 'Discard this workout?', message: 'The sets you logged so far will be lost.', confirmLabel: 'Discard', danger: true })) { await app.discardDraft(); toast('Workout discarded'); } }, { kind: 'secondary' }))], 'tint'));

  if (!p) {
    kids.push(empty({ icon: 'train', title: 'Choose your training', text: 'Pick a ready-made programme or build your own. You can change the schedule any time without losing progress.', action: btn('Browse programmes', () => app.router.navigate('/train'), { block: true }) }));
  } else {
    const st = app.scheduleStatus(); const inst = p.instance;
    if (inst.status === 'paused') kids.push(banner(['Your programme is paused since ', h('strong', {}, prettyDate(inst.pause.since)), '. Nothing is marked missed while paused.', h('div', { style: { marginTop: '8px' } }, btn('Resume', () => openPauseSheet(app, rr), { sm: true }))], { kind: 'info' }));
    else if (st.missed.length) kids.push(banner([h('strong', {}, `${st.missed.length} session${st.missed.length === 1 ? '' : 's'} waiting.`), ' Your programme has waited for you. Choose how to carry on.', h('div', { style: { marginTop: '8px' } }, btn('Choose how to continue', () => openMissedSheet(app, rr), { sm: true }))], { icon: 'info' }));
    else if (st.reramp && inst.status === 'active') kids.push(banner(st.reramp.message, { kind: 'info' }));

    const next = app.nextSession();
    if (inst.status === 'completed') kids.push(card([h('h2', {}, 'Programme complete'), h('p', { class: 'muted' }, 'Well done. Start another programme from Train whenever you are ready.'), btn('Go to Train', () => app.router.navigate('/train'), { block: true })], 'tint'));
    else if (next && inst.status === 'active') {
      const plan = app.sessionPlan(next.id); const isToday = next.date === t; const overdue = next.date < t;
      const mins = plan ? estimateMinutes(plan.steps) : 0;
      kids.push(card([
        h('div', { class: 'row wrap', style: { marginBottom: '6px' } }, pill(isToday ? 'Today' : overdue ? 'Up next' : prettyDate(next.date), isToday ? 'acc' : ''), pill(`Week ${next.week}`), pill(phaseLabel(p.template, next.week) || 'Programme')),
        h('h2', { style: { fontSize: 'var(--fs-xl)', lineHeight: 1.2 } }, next.name),
        h('p', { class: 'muted', style: { margin: '4px 0 14px' } }, plan ? `${countExercises(plan.session)} exercises \u00b7 about ${mins} min` : ''),
        h('div', { class: 'stack' }, btn(s.draft && s.draft.scheduledId === next.id ? 'Continue workout' : (isToday || overdue ? 'Start workout' : 'Start early'), async () => { const r = await app.startDraft({ kind: 'scheduled', scheduledId: next.id }); if (!r.ok) return toast(r.error.message); app.router.navigate('/workout'); }, { block: true, ic: 'play', icon: 'play' }), btn('Preview session', () => openSessionSheet(app, next, rr), { kind: 'secondary', block: true })),
        !isToday && !overdue ? h('p', { class: 'small muted', style: { marginTop: '10px' } }, `Rest day. Your next session is on ${DOW_LONG[new Date(next.date + 'T00:00').getDay()]}.`) : null,
      ]));
      const ws = weekSummary({ instance: inst, sessions: p.sessions }, p.ctx, next.week);
      kids.push(card([h('div', { class: 'row between' }, h('h2', {}, `Week ${next.week}`), h('span', { class: 'small muted num' }, `${ws.completed} of ${ws.total} done`)), progressBar(ws.total ? (ws.completed / ws.total) * 100 : 0, `Week ${next.week} progress`), h('p', { class: 'small muted', style: { marginTop: '8px' } }, `Programme: ${app.adherence().progressPct}% complete`)]));
    }
  }

  // recovery context, only when there is history to base it on
  const ins = app.insights();
  if (ins.readiness.level !== 'unknown') kids.push(card([h('div', { class: 'row between' }, h('h2', {}, 'Recovery'), pill(ins.readiness.level === 'good' ? 'Ready' : ins.readiness.level === 'moderate' ? 'Steady' : 'Take care', ins.readiness.level === 'good' ? 'ok' : ins.readiness.level === 'moderate' ? 'acc' : 'warn')), h('p', { style: { marginTop: '6px' } }, ins.readiness.headline), h('p', { class: 'small muted' }, ins.readiness.basis.slice(0, 2).join(' ')), btn('Details', () => app.router.navigate('/more/recovery'), { kind: 'text', sm: true })]));

  const prot = app.proteinTarget() && s.nutrition.length ? app.proteinDay() : null;
  if (prot) kids.push(card([h('div', { class: 'row between' }, h('h2', {}, 'Protein today'), h('span', { class: 'small num muted' }, `${prot.total} of ${app.proteinTarget()} g`)), progressBar(prot.pct, 'Protein progress'), btn('Add protein', () => app.router.navigate('/more/nutrition'), { kind: 'text', sm: true })]));

  kids.push(sectionTitle('Quick log'));
  kids.push(h('div', { class: 'row' }, btn('Log an activity', () => openActivitySheet(app), { kind: 'secondary', block: true }), p ? btn('Log a past session', () => openPastSheet(app), { kind: 'secondary', block: true }) : null));
  return { title: 'Today', subtitle: prettyDate(t, true), content: h('div', { class: 'stack-lg' }, kids) };
}

export function openActivitySheet(app) {
  const name = input({ placeholder: 'e.g. Evening walk', maxlength: 60 }), min = stepper({ value: 30, min: 1, max: 600, step: 5, label: 'Minutes' }), eff = select([['', 'Not set'], ...Array.from({ length: 10 }, (_, i) => [String(i + 1), String(i + 1)])], '');
  const err = h('div', { class: 'err', role: 'alert' });
  openSheet({ title: 'Log an activity', content: h('div', { class: 'stack' }, field('What did you do?', name), field('Minutes', min), field('How hard did it feel? (1 to 10, optional)', eff), err), actions: [{ label: 'Cancel', kind: 'secondary' }, { label: 'Save', close: false, busy: true, onClick: async (api) => { const r = await app.logActivity({ name: name.value, minutes: min.get(), effort: eff.value ? +eff.value : null }); if (!r.ok) { err.textContent = r.error.message; return false; } toast('Activity saved'); api.close(); return false; } }] });
}

export function openPastSheet(app) {
  const p = app.state.programme; const up = p ? app.state.programme.sessions.filter((x) => x.status === 'planned').sort((a, b) => a.seq - b.seq).slice(0, 14) : [];
  if (!up.length) return toast('There are no sessions to log.');
  const sel = select(up.map((x) => [x.id, `Week ${x.week}: ${x.name} (${prettyDate(x.date)})`]), up[0].id), date = input({ type: 'date', value: app.today(), max: app.today() }), min = stepper({ value: 45, min: 0, max: 400, step: 5, label: 'Minutes' }), note = textarea({ placeholder: 'Optional' });
  const err = h('div', { class: 'err', role: 'alert' });
  openSheet({ title: 'Log a past session', content: h('div', { class: 'stack' }, h('p', { class: 'muted' }, 'Use this if you trained but did not log the sets. It completes the session in your programme.'), field('Which session?', sel), field('Date you trained', date), field('Minutes', min), field('Notes', note), err), actions: [{ label: 'Cancel', kind: 'secondary' }, { label: 'Save', close: false, busy: true, onClick: async (api) => { const r = await app.logPastSession({ scheduledId: sel.value, date: date.value, durationMin: min.get(), notes: note.value }); if (!r.ok) { err.textContent = r.error.message; return false; } toast('Session logged'); api.close(); return false; } }] });
}
