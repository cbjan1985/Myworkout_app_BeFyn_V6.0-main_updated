import { h } from '../dom.js';
import { openSheet, toast, confirmDialog } from '../dom.js';
import { btn, card, pill, list, item, sectionTitle, empty, banner, field, input, select, stepper } from '../components.js';
import { DOW_SHORT } from '../../core/util.js';
import { expandWeeklyPattern, validateTemplate } from '../../domain/programme.js';
import { openSectionsSheet, countItems } from '../section-editor.js';
import { openProgrammeSheet } from './train.js';

/** Old pattern days stored flat `items`; the builder now stores full `sections` (warm-up, main with supersets, breathing, stretching). */
const normalizePattern = (d) => {
  (d.pattern || []).forEach((p) => {
    if (p.sections) return;
    p.sections = { main: (p.items || []).map((it) => ({ type: 'straight', items: [it] })) };
    if (p.warmup?.length) p.sections.warmup = p.warmup.map((it) => ({ type: 'straight', items: [{ sets: 1, ...it }] }));
    if (p.cooldown?.length) p.sections.cooldown = p.cooldown.map((it) => ({ type: 'straight', items: [{ sets: 1, ...it }] }));
    delete p.items; delete p.warmup; delete p.cooldown;
  });
};

/** Programme Builder. Pattern programmes (one typical week + progression) regenerate every week; imported/forked programmes edit sessions directly. */
export async function builder(app, ctx) {
  const stored = await app.repos.templates.get(ctx.id, +ctx.version);
  if (!stored) return { title: 'Builder', content: empty({ icon: 'info', title: 'Draft not found', action: btn('Back to Train', () => app.router.navigate('/train')) }) };
  if (stored.status !== 'draft') return { title: stored.name, content: empty({ icon: 'lock', title: 'This version is published', text: 'Published programmes cannot be changed, so running programmes stay safe. Make a new version to edit.', action: btn('Create editable copy', async () => { const r = await app.forkTemplate(stored.id); if (r.ok) app.router.navigate(`/train/builder/${r.draft.id}/${r.draft.version}`, { replace: true }); else toast(r.error.message); }) }) };
  const d = stored; normalizePattern(d); const root = h('div', { class: 'stack-lg' }); const ids = () => new Set(app.state.exIndex.keys());
  const regen = () => { if (d.pattern) { d.sessions = expandWeeklyPattern({ weeks: d.weeks, pattern: d.pattern, progression: d.progression }); d.weeklyFrequency = d.pattern.length; } };
  let saveT; const commit = async (now = false) => { regen(); const run = async () => { const r = await app.saveTemplateDraft(d); if (!r.ok) toast(r.error.message); }; if (now) return run(); clearTimeout(saveT); saveT = setTimeout(run, 350); };

  function draw() {
    const errs = validateTemplate({ ...d, sessions: d.sessions }, ids()); const patErrs = (d.pattern || []).filter((p) => !countItems(p.sections)).map((p) => `${p.name} has no exercises yet.`);
    const all = [...patErrs, ...errs];
    const name = input({ value: d.name, maxlength: 60, onchange: (e) => { d.name = e.target.value; commit(); } }), obj = input({ value: d.objective || '', maxlength: 120, onchange: (e) => { d.objective = e.target.value; commit(); } });
    const kids = [card(h('div', { class: 'stack' }, field('Name', name), field('Goal', obj),
      d.pattern ? h('div', { class: 'stack' }, field('Weeks', stepper({ value: d.weeks, min: 1, max: 24, label: 'Weeks', onChange: (v) => { d.weeks = v; commit(); draw(); } })), h('div', { class: 'row' }, h('div', { class: 'grow' }, field('Add reps every', stepper({ value: d.progression?.everyWeeks || 1, min: 1, max: 8, label: 'Every how many weeks', onChange: (v) => { d.progression = { ...d.progression, everyWeeks: v }; commit(); } }), { hint: 'weeks' })), h('div', { class: 'grow' }, field('Reps to add', stepper({ value: d.progression?.addReps || 0, min: 0, max: 5, label: 'Reps to add', onChange: (v) => { d.progression = { ...d.progression, addReps: v }; commit(); } }), { hint: 'per step' }))), h('p', { class: 'small muted' }, 'Reps go up on a schedule for straight sets. Weights are suggested from what you actually lift, never changed automatically. Days you do not choose are rest days.')) : h('p', { class: 'small muted' }, `${d.weeks} weeks \u00b7 ${d.sessions.length} sessions. Edit any session below.`)))];
    kids.push(sectionTitle(d.pattern ? 'Your typical week' : 'Sessions', d.pattern && d.pattern.length < 7 ? btn('Add day', () => { d.pattern.push({ name: `Day ${String.fromCharCode(65 + d.pattern.length)}`, dayOfWeek: [1, 3, 5, 2, 4, 6, 0][d.pattern.length], sections: { main: [] } }); commit(); draw(); }, { kind: 'text', sm: true }) : null));
    if (d.pattern) {
      kids.push(h('div', { class: 'week-strip', role: 'img', 'aria-label': `Week at a glance: ${[1, 2, 3, 4, 5, 6, 0].map((x) => `${DOW_SHORT[x]} ${d.pattern.find((p) => p.dayOfWeek === x)?.name || 'rest'}`).join(', ')}` }, [1, 2, 3, 4, 5, 6, 0].map((x) => { const p = d.pattern.find((q) => q.dayOfWeek === x); return h('div', { class: 'center small', style: { padding: '6px 0', borderRadius: '8px', background: p ? 'var(--accent-soft)' : 'transparent', border: '1px solid var(--border)', minWidth: 0 } }, h('div', { class: 'muted' }, DOW_SHORT[x][0]), h('div', { class: 'strong' }, p ? p.name.replace(/^Day /, '') : '\u2013')); })));
      kids.push(list(d.pattern.map((p, i) => item({ title: p.name, meta: `${DOW_SHORT[p.dayOfWeek]} \u00b7 ${countItems(p.sections)} exercise${countItems(p.sections) === 1 ? '' : 's'}`, onClick: () => editPatternDay(i) }))));
    } else { const byWeek = new Map(); d.sessions.forEach((s, i) => (byWeek.get(s.week) || byWeek.set(s.week, []).get(s.week)).push([s, i])); kids.push(...[...byWeek].map(([w, ss]) => h('details', { class: 'card', open: w === 1 ? '' : undefined }, h('summary', { class: 'strong', style: { cursor: 'pointer', minHeight: '36px' } }, `Week ${w}`), h('div', { class: 'list', style: { marginTop: '8px' } }, ss.map(([s, i]) => item({ title: s.name, meta: `${DOW_SHORT[s.dayOfWeek]} \u00b7 ${countItems(s.sections)} exercises`, onClick: () => editSession(i) })))))); }
    if (all.length) kids.push(banner([h('strong', {}, 'Before you publish: '), all.slice(0, 3).join(' ')], { icon: 'info' }));
    kids.push(h('div', { class: 'stack' }, btn('Publish programme', publish, { block: true, disabled: !!all.length }), btn('Delete draft', async () => { if (await confirmDialog({ title: 'Delete this draft?', message: 'This cannot be undone.', confirmLabel: 'Delete', danger: true })) { clearTimeout(saveT); await app.deleteDraft(d.id, d.version); app.router.navigate('/train', { replace: true }); } }, { kind: 'text', block: true })));
    root.replaceChildren(...kids);
  }
  async function publish() { clearTimeout(saveT); await commit(true); const r = await app.publishTemplate(d.id, d.version); if (!r.ok) return toast(r.error.message); toast('Programme published'); const t = r.template; openSheet({ title: 'Published', content: h('p', {}, `${t.name} (version ${t.version}) is ready.`), actions: [{ label: 'Later', kind: 'secondary', onClick: () => app.router.navigate('/train', { replace: true }) }, { label: 'Start it', close: false, onClick: (api) => { api.close(); app.router.navigate('/train', { replace: true }); setTimeout(() => openProgrammeSheet(app, t), 50); return false; } }] }); }

  function editPatternDay(i) {
    const p = d.pattern[i]; const day = select([1, 2, 3, 4, 5, 6, 0].map((x) => [String(x), DOW_SHORT[x]]), String(p.dayOfWeek));
    const used = (x) => d.pattern.some((q, k) => k !== i && q.dayOfWeek === x);
    openSectionsSheet(app, { title: `Edit ${p.name}`, name: p.name, sections: p.sections, extra: h('div', { class: 'stack' }, field('Day of the week', day, { hint: 'Each day can hold one session.' }), d.pattern.length > 1 ? btn('Remove this day', async () => { d.pattern.splice(i, 1); commit(); draw(); }, { kind: 'text', sm: true }) : null),
      onSave: async ({ name, sections }) => { if (used(+day.value)) return { ok: false, error: { message: `${DOW_SHORT[+day.value]} already has a session.` } }; p.name = name || p.name; p.dayOfWeek = +day.value; p.sections = sections; commit(); draw(); return { ok: true }; } });
  }
  function editSession(i) {
    const s = d.sessions[i];
    openSectionsSheet(app, { title: `Week ${s.week} session`, name: s.name, sections: s.sections, extra: btn('Delete this session', async () => { if (await confirmDialog({ title: 'Delete this session?', message: 'It will be removed from this draft only.', confirmLabel: 'Delete', danger: true })) { d.sessions.splice(i, 1); commit(true); draw(); } }, { kind: 'text', sm: true }),
      onSave: async ({ name, sections }) => { s.name = name || s.name; s.sections = sections; commit(); draw(); return { ok: true }; } });
  }
  draw();
  return { title: d.name, subtitle: `Draft \u00b7 version ${d.version}`, live: false, content: root };
}
