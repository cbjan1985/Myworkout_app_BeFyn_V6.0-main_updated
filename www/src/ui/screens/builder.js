import { h } from '../dom.js';
import { openSheet, toast, confirmDialog } from '../dom.js';
import { btn, iconBtn, card, pill, list, item, sectionTitle, empty, banner, field, input, select, textarea, stepper, toggle } from '../components.js';
import { DOW_SHORT } from '../../core/util.js';
import { expandWeeklyPattern, validateTemplate, publishTemplate } from '../../domain/programme.js';
import { targetText } from '../session-view.js';
import { pickExercise, openProgrammeSheet } from './train.js';

/** Programme Builder. Pattern programmes (one typical week + progression) regenerate every week; imported/forked programmes edit sessions directly. */
export async function builder(app, ctx) {
  const stored = await app.repos.templates.get(ctx.id, +ctx.version);
  if (!stored) return { title: 'Builder', content: empty({ icon: 'info', title: 'Draft not found', action: btn('Back to Train', () => app.router.navigate('/train')) }) };
  if (stored.status !== 'draft') return { title: stored.name, content: empty({ icon: 'lock', title: 'This version is published', text: 'Published programmes cannot be changed, so running programmes stay safe. Make a new version to edit.', action: btn('Create editable copy', async () => { const r = await app.forkTemplate(stored.id); if (r.ok) app.router.navigate(`/train/builder/${r.draft.id}/${r.draft.version}`, { replace: true }); else toast(r.error.message); }) }) };
  const d = stored; const root = h('div', { class: 'stack-lg' }); const ids = () => new Set(app.state.exIndex.keys());
  const regen = () => { if (d.pattern) { d.sessions = expandWeeklyPattern({ weeks: d.weeks, pattern: d.pattern, progression: d.progression }); d.weeklyFrequency = d.pattern.length; } };
  let saveT; const commit = async (now = false) => { regen(); const run = async () => { const r = await app.saveTemplateDraft(d); if (!r.ok) toast(r.error.message); }; if (now) return run(); clearTimeout(saveT); saveT = setTimeout(run, 350); };

  function draw() {
    const errs = validateTemplate({ ...d, sessions: d.sessions }, ids()); const patErrs = (d.pattern || []).filter((p) => !p.items.length).map((p) => `${p.name} has no exercises yet.`);
    const all = [...patErrs, ...errs];
    const name = input({ value: d.name, maxlength: 60, onchange: (e) => { d.name = e.target.value; commit(); } }), obj = input({ value: d.objective || '', maxlength: 120, onchange: (e) => { d.objective = e.target.value; commit(); } });
    const kids = [card(h('div', { class: 'stack' }, field('Name', name), field('Goal', obj),
      d.pattern ? h('div', { class: 'stack' }, field('Weeks', stepper({ value: d.weeks, min: 1, max: 24, label: 'Weeks', onChange: (v) => { d.weeks = v; commit(); draw(); } })), h('div', { class: 'row' }, h('div', { class: 'grow' }, field('Add reps every', stepper({ value: d.progression?.everyWeeks || 1, min: 1, max: 8, label: 'Every how many weeks', onChange: (v) => { d.progression = { ...d.progression, everyWeeks: v }; commit(); } }), { hint: 'weeks' })), h('div', { class: 'grow' }, field('Reps to add', stepper({ value: d.progression?.addReps || 0, min: 0, max: 5, label: 'Reps to add', onChange: (v) => { d.progression = { ...d.progression, addReps: v }; commit(); } }), { hint: 'per step' }))), h('p', { class: 'small muted' }, 'Reps go up on a schedule. Your weights are suggested from what you actually lift, never changed automatically.')) : h('p', { class: 'small muted' }, `${d.weeks} weeks \u00b7 ${d.sessions.length} sessions. Edit any session below.`))), ];
    kids.push(sectionTitle(d.pattern ? 'Your typical week' : 'Sessions', d.pattern && d.pattern.length < 7 ? btn('Add day', () => { d.pattern.push({ name: `Day ${String.fromCharCode(65 + d.pattern.length)}`, dayOfWeek: [1, 3, 5, 2, 4, 6, 0][d.pattern.length], items: [] }); commit(); draw(); }, { kind: 'text', sm: true }) : null));
    if (d.pattern) kids.push(list(d.pattern.map((p, i) => item({ title: p.name, meta: `${DOW_SHORT[p.dayOfWeek]} \u00b7 ${p.items.length} exercise${p.items.length === 1 ? '' : 's'}`, onClick: () => editPatternDay(i) }))));
    else { const byWeek = new Map(); d.sessions.forEach((s, i) => (byWeek.get(s.week) || byWeek.set(s.week, []).get(s.week)).push([s, i])); kids.push(...[...byWeek].map(([w, ss]) => h('details', { class: 'card', open: w === 1 ? '' : undefined }, h('summary', { class: 'strong', style: { cursor: 'pointer', minHeight: '36px' } }, `Week ${w}`), h('div', { class: 'list', style: { marginTop: '8px' } }, ss.map(([s, i]) => item({ title: s.name, meta: `${DOW_SHORT[s.dayOfWeek]} \u00b7 ${Object.values(s.sections || {}).reduce((n, b) => n + b.length, 0)} blocks`, onClick: () => editSession(i) })))))); }
    if (all.length) kids.push(banner([h('strong', {}, 'Before you publish: '), all.slice(0, 3).join(' ')], { icon: 'info' }));
    kids.push(h('div', { class: 'stack' }, btn('Publish programme', publish, { block: true, disabled: !!all.length }), btn('Delete draft', async () => { if (await confirmDialog({ title: 'Delete this draft?', message: 'This cannot be undone.', confirmLabel: 'Delete', danger: true })) { clearTimeout(saveT); await app.deleteDraft(d.id, d.version); app.router.navigate('/train', { replace: true }); } }, { kind: 'text', block: true })));
    root.replaceChildren(...kids);
  }
  async function publish() { clearTimeout(saveT); await commit(true); const r = await app.publishTemplate(d.id, d.version); if (!r.ok) return toast(r.error.message); toast('Programme published'); const t = r.template; openSheet({ title: 'Published', content: h('p', {}, `${t.name} (version ${t.version}) is ready.`), actions: [{ label: 'Later', kind: 'secondary', onClick: () => app.router.navigate('/train', { replace: true }) }, { label: 'Start it', close: false, onClick: (api) => { api.close(); app.router.navigate('/train', { replace: true }); setTimeout(() => openProgrammeSheet(app, t), 50); return false; } }] }); }

  function editPatternDay(i) {
    const p = d.pattern[i]; const name = input({ value: p.name, maxlength: 40 }), day = select([1, 2, 3, 4, 5, 6, 0].map((x) => [String(x), DOW_SHORT[x]]), String(p.dayOfWeek)); const box = h('div', { class: 'stack' });
    const drawItems = () => box.replaceChildren(...p.items.map((it, k) => item({ title: it.name, meta: targetText(it), chev: false, onClick: () => editItem(it, drawItems), trailing: h('span', { class: 'row' }, iconBtn('up', 'Move up', (e) => { e.stopPropagation(); if (k) { [p.items[k - 1], p.items[k]] = [p.items[k], p.items[k - 1]]; drawItems(); } }), iconBtn('trash', `Remove ${it.name}`, (e) => { e.stopPropagation(); p.items.splice(k, 1); drawItems(); })) })), btn('Add exercise', () => pickExercise(app, (ex) => { p.items.push({ exercise: ex.id, name: ex.name, sets: 3, reps: 10, rest: 60, load: '' }); drawItems(); }), { kind: 'secondary', block: true, icon: 'plus' }));
    drawItems();
    openSheet({ title: `Edit ${p.name}`, content: h('div', { class: 'stack' }, field('Name', name), field('Day', day), h('div', { class: 'list' }, box)), actions: [{ label: d.pattern.length > 1 ? 'Remove day' : '', kind: 'secondary', close: false, onClick: async (api) => { if (d.pattern.length < 2) return false; d.pattern.splice(i, 1); api.close(); commit(); draw(); return false; } }, { label: 'Done', onClick: () => { p.name = name.value || p.name; p.dayOfWeek = +day.value; commit(); draw(); } }].filter((a) => a.label), onClose: () => { commit(); draw(); } });
  }
  function editSession(i) {
    const s = d.sessions[i]; const name = input({ value: s.name, maxlength: 60 }); const box = h('div', { class: 'stack' });
    const main = s.sections.main = s.sections.main || [];
    const drawItems = () => box.replaceChildren(...main.map((b, k) => { const single = !b.type || b.type === 'straight'; const it = b.items[0]; return item({ title: single ? it.name : `${b.type}: ${b.items.map((x) => x.name).join(' + ')}`, meta: single ? targetText(it) : `${b.rounds} rounds`, chev: single, onClick: single ? () => editItem(it, drawItems) : undefined, trailing: iconBtn('trash', 'Remove', (e) => { e.stopPropagation(); main.splice(k, 1); drawItems(); }) }); }), btn('Add exercise', () => pickExercise(app, (ex) => { main.push({ type: 'straight', items: [{ exercise: ex.id, name: ex.name, sets: 3, reps: 10, rest: 60 }] }); drawItems(); }), { kind: 'secondary', block: true, icon: 'plus' }));
    drawItems();
    openSheet({ title: `Week ${s.week} session`, content: h('div', { class: 'stack' }, field('Name', name), h('p', { class: 'small muted' }, 'Main workout blocks. Warm-up, stretching and breathing are kept as they are.'), h('div', { class: 'list' }, box)), actions: [{ label: 'Delete session', kind: 'secondary', close: false, onClick: async (api) => { api.close(); if (await confirmDialog({ title: 'Delete this session?', message: 'It will be removed from this draft only.', confirmLabel: 'Delete', danger: true })) { d.sessions.splice(i, 1); commit(true); draw(); } return false; } }, { label: 'Done', onClick: () => { s.name = name.value || s.name; commit(); draw(); } }] });
  }
  function editItem(it, redraw) {
    const sets = stepper({ value: it.sets || 1, min: 1, max: 12, label: 'Sets' }), reps = stepper({ value: it.reps || 0, min: 0, max: 100, label: 'Reps' }), secs = stepper({ value: it.secs || 0, min: 0, max: 900, step: 5, label: 'Seconds' }), rest = stepper({ value: it.rest || 0, min: 0, max: 300, step: 5, label: 'Rest in seconds' }), load = input({ value: it.load || '', placeholder: 'e.g. 5 kg each hand' });
    openSheet({ title: it.name, content: h('div', { class: 'stack' }, field('Sets', sets), field('Reps (0 if timed)', reps), field('Seconds (0 if counted in reps)', secs), field('Rest between sets (seconds)', rest), field('Load', load)), actions: [{ label: 'Cancel', kind: 'secondary' }, { label: 'Save', onClick: () => { Object.assign(it, { sets: sets.get(), reps: reps.get() || undefined, secs: secs.get() || undefined, rest: rest.get() || undefined, load: load.value }); delete it.target; commit(); redraw && redraw(); } }] });
  }
  draw();
  return { title: d.name, subtitle: `Draft \u00b7 version ${d.version}`, live: false, content: root };
}
