import { h } from '../dom.js';
import { openSheet, toast, confirmDialog } from '../dom.js';
import { btn, iconBtn, card, pill, list, item, sectionTitle, empty, banner, field, input, select, textarea, stepper, chips, segmented, progressBar, toggle } from '../components.js';
import { icon } from '../icons.js';
import { prettyDate, DOW_SHORT, uid } from '../../core/util.js';
import { CATEGORIES, EQUIPMENT } from '../../services/library.js';
import { openSessionSheet, statusPill, targetText, outline } from '../session-view.js';
import { openPauseSheet } from '../sheets.js';
import { openSectionsSheet } from '../section-editor.js';
import { effDate } from '../../domain/schedule-engine.js';
import { phaseLabel, validateTemplate, SECTION_LABEL } from '../../domain/programme.js';
import { exerciseDetail } from './exercise.js';
import { builder } from './builder.js';

let tab = 'programme'; const filt = { q: '', category: '', muscle: '', equipment: '', difficulty: '' };
export { exerciseDetail, builder };

export async function train(app, ctx) {
  const rr = ctx.rerender;
  const body = tab === 'programme' ? programmeTab(app, rr) : tab === 'library' ? libraryTab(app, rr) : workoutsTab(app, rr);
  return { title: 'Train', content: h('div', { class: 'stack-lg' }, segmented([['programme', 'Programme'], ['library', 'Exercises'], ['workouts', 'Workouts']], tab, (v) => { tab = v; rr(); }, 'Train sections'), body) };
}

/* ------------------------------ programme tab ------------------------------ */
function programmeTab(app, rr) {
  const p = app.state.programme; const kids = []; const t = app.today();
  if (p) {
    const ad = app.adherence(); const inst = p.instance; const weeks = [...new Set(p.sessions.map((s) => s.week))].sort((a, b) => a - b);
    const cur = app.nextSession();
    kids.push(card([h('div', { class: 'row between' }, h('h2', {}, p.template.name), pill(inst.status === 'active' ? 'Active' : inst.status === 'paused' ? 'Paused' : inst.status === 'completed' ? 'Complete' : inst.status, inst.status === 'active' ? 'ok' : 'warn')),
      h('p', { class: 'muted small', style: { margin: '4px 0 10px' } }, `Started ${prettyDate(inst.startDate, true)} \u00b7 ${ad.completed} of ${ad.total} sessions done${ad.skipped ? ` \u00b7 ${ad.skipped} skipped` : ''}`), progressBar(ad.progressPct, 'Programme progress'),
      h('div', { class: 'row', style: { marginTop: '12px' } }, inst.status === 'completed' ? btn('Start it again', () => openProgrammeSheet(app, p.template, rr), { sm: true }) : btn(inst.status === 'paused' ? 'Resume' : 'Pause', () => openPauseSheet(app, rr), { kind: 'secondary', sm: true }), inst.status === 'completed' ? null : btn('Stop programme', async () => { if (await confirmDialog({ title: 'Stop this programme?', message: 'Your history stays. You can start a programme again any time.', confirmLabel: 'Stop programme', danger: true })) { await app.endProgramme('cancelled'); toast('Programme stopped'); } }, { kind: 'text', sm: true }))]));
    kids.push(sectionTitle('Weeks'));
    kids.push(h('div', { class: 'stack' }, weeks.map((w) => {
      const ss = p.sessions.filter((s) => s.week === w && s.id === [...p.sessions].filter((x) => x.seq === s.seq).sort((a, b) => b.run - a.run)[0].id).sort((a, b) => a.seq - b.seq);
      const dn = ss.filter((s) => s.status === 'completed').length; const open = cur && cur.week === w;
      return h('details', { class: 'card', open: open ? '' : undefined }, h('summary', { style: { cursor: 'pointer', minHeight: '36px', display: 'flex', alignItems: 'center', gap: '8px' } }, h('span', { class: 'strong grow' }, `Week ${w}`, h('span', { class: 'small muted' }, ` \u00b7 ${phaseLabel(p.template, w)}`)), h('span', { class: 'small muted num' }, `${dn}/${ss.length}`)),
        h('div', { class: 'list', style: { marginTop: '8px' } }, ss.map((s) => item({ title: s.name, meta: prettyDate(effDate(s)), trailing: statusPill(s, t), onClick: () => openSessionSheet(app, s, rr) }))));
    })));
  } else kids.push(banner('You have no active programme. Start one below, or build your own.', { kind: 'info' }));

  const tpls = app.latestTemplates(); const pub = tpls.filter((x) => x.status === 'published'), drafts = tpls.filter((x) => x.status === 'draft'), pubIds = new Set(pub.map((x) => x.id));
  kids.push(sectionTitle(p ? 'Other programmes' : 'Programmes'));
  const rows = pub.filter((x) => !p || x.id !== p.template.id).map((x) => item({ title: x.name, meta: `${x.weeks} weeks \u00b7 ${x.sessions.length} sessions${x.source === 'v5-edited' ? ' \u00b7 your V5 edits' : ''}`, lead: 'train', onClick: () => openProgrammeSheet(app, x, rr) }));
  kids.push(rows.length ? list(rows) : card(h('p', { class: 'muted' }, p ? 'No other programmes yet.' : 'No programmes yet.')));
  const dr = drafts.map((x) => item({ title: x.name + ' (draft)', meta: `Version ${x.version} \u00b7 ${x.weeks} weeks`, lead: 'edit', onClick: () => app.router.navigate(`/train/builder/${x.id}/${x.version}`) }));
  if (dr.length) { kids.push(sectionTitle('Drafts')); kids.push(list(dr)); }
  kids.push(sectionTitle('Create'));
  kids.push(list([item({ title: 'Build a programme', meta: 'Weekly pattern, progression and your own exercises', lead: 'plus', onClick: () => openNewProgramme(app, rr) }), item({ title: 'Import from a spreadsheet', meta: 'Use an Excel file in BeFyn format', lead: 'upload', onClick: () => importSheet(app, rr) }), p && item({ title: 'Download a spreadsheet of this programme', meta: 'Edit in Excel, then import it back', lead: 'download', onClick: async () => { const r = await app.exportProgrammeSpreadsheet(p.template.id, p.template.version, { share: false }); toast(r.ok ? `Saved to ${r.where}` : (r.error?.message || r.message)); } }), item({ title: 'Download a blank spreadsheet template', meta: 'Fill it in Excel, then import it', lead: 'download', onClick: async () => { const r = await app.exportBlankSpreadsheet({ share: false }); toast(r.ok ? `Saved to ${r.where}` : (r.error?.message || r.message)); } }), p && item({ title: 'Duplicate this programme as a new one', meta: 'An independent copy you can change freely', lead: 'copy', onClick: async () => { const r = await app.duplicateTemplate(p.template.id); if (r.ok) app.router.navigate(`/train/builder/${r.draft.id}/${r.draft.version}`); else toast(r.error.message); } }), p && item({ title: 'Edit a copy of this programme', meta: 'Creates a new version; your running programme stays as it is', lead: 'copy', onClick: async () => { const r = await app.forkTemplate(p.template.id); if (r.ok) app.router.navigate(`/train/builder/${r.draft.id}/${r.draft.version}`); else toast(r.error.message); } })]));
  return h('div', { class: 'stack-lg' }, kids);
}

export function openProgrammeSheet(app, tpl, rr) {
  const date = input({ type: 'date', value: app.today() });
  const days = new Set([...new Set(tpl.sessions.map((s) => s.dayOfWeek))]); const dayRow = h('div', { class: 'chips', role: 'group', 'aria-label': 'Training days' });
  const draw = () => dayRow.replaceChildren(...[1, 2, 3, 4, 5, 6, 0].map((d) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(days.has(d)), onclick: () => { days.has(d) ? days.delete(d) : days.add(d); draw(); } }, DOW_SHORT[d])));
  draw();
  const err = h('div', { class: 'err', role: 'alert' });
  const per = new Set(tpl.sessions.map((s) => s.week)).size;
  const sheet = openSheet({ title: tpl.name, content: h('div', { class: 'stack' }, tpl.objective && h('p', {}, tpl.objective), tpl.description && h('p', { class: 'small muted' }, tpl.description), (tpl.phases || []).length ? h('div', { class: 'stack' }, h('h3', {}, 'Phases'), ...tpl.phases.map((ph) => h('p', { class: 'small' }, `Weeks ${ph.fromWeek}\u2013${ph.toWeek}: ${ph.name}`))) : null, (tpl.guide || []).length ? h('div', { class: 'stack' }, h('h3', {}, 'Programme guide'), ...tpl.guide.map((g) => h('details', { class: 'card' }, h('summary', { class: 'strong', style: { cursor: 'pointer', minHeight: '32px' } }, g.t), h('p', { class: 'small', style: { whiteSpace: 'pre-line', marginTop: '8px' } }, g.x)))) : null, h('div', { class: 'row wrap' }, pill(`${per} weeks`), pill(`${tpl.sessions.length} sessions`)), field('Start on', date), h('div', {}, h('div', { class: 'label strong small', style: { marginBottom: '6px' } }, 'Training days'), dayRow, h('p', { class: 'small muted', style: { marginTop: '6px' } }, 'Sessions are placed on these days in order. You can adjust any day later.')), err), actions: [{ label: 'Cancel', kind: 'secondary' }, { label: 'Start programme', close: false, busy: true, onClick: async (api) => { if (!days.size) { err.textContent = 'Choose at least one training day.'; return false; } const r = await app.startProgramme({ templateId: tpl.id, version: tpl.version, startDate: date.value, trainingDays: [1, 2, 3, 4, 5, 6, 0].filter((d) => days.has(d)) }); if (!r.ok) { err.textContent = r.error.message; return false; } toast('Programme started'); api.close(); app.router.navigate('/today'); return false; } }] });
}

function openNewProgramme(app, rr) {
  const name = input({ placeholder: 'e.g. Home strength', maxlength: 60 }), obj = input({ placeholder: 'e.g. Build strength with dumbbells', maxlength: 120 });
  const weeks = stepper({ value: 8, min: 1, max: 24, label: 'Weeks' }); const days = new Set([1, 3, 5]); const dayRow = h('div', { class: 'chips', role: 'group', 'aria-label': 'Training days' });
  const draw = () => dayRow.replaceChildren(...[1, 2, 3, 4, 5, 6, 0].map((d) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(days.has(d)), onclick: () => { days.has(d) ? days.delete(d) : days.add(d); draw(); } }, DOW_SHORT[d]))); draw();
  const err = h('div', { class: 'err', role: 'alert' });
  openSheet({ title: 'Build a programme', content: h('div', { class: 'stack' }, field('Name', name), field('Goal (optional)', obj), field('Weeks', weeks), h('div', {}, h('div', { class: 'label strong small', style: { marginBottom: '6px' } }, 'Training days'), dayRow, h('p', { class: 'small muted', style: { marginTop: '6px' } }, 'The days you do not pick are rest days. You can change a day later.')), h('p', { class: 'small muted' }, 'Next you set up one typical week with exercises, supersets, warm-up and stretching, then choose how it progresses. BeFyn repeats it for every week.'), err), actions: [{ label: 'Cancel', kind: 'secondary' }, { label: 'Continue', close: false, busy: true, onClick: async (api) => {
    if (!name.value.trim()) { err.textContent = 'Give the programme a name.'; return false; } if (!days.size) { err.textContent = 'Choose at least one training day.'; return false; }
    const chosen = [1, 2, 3, 4, 5, 6, 0].filter((d) => days.has(d)); const pattern = chosen.map((d, i) => ({ name: `Day ${String.fromCharCode(65 + i)}`, dayOfWeek: d, sections: { main: [] } }));
    const r = await app.newProgrammeDraftFrom({ ...(await import('../../domain/programme.js')).newDraft({ name: name.value.trim(), objective: obj.value.trim(), weeks: weeks.get(), weeklyFrequency: chosen.length, sessions: [] }), pattern, progression: { everyWeeks: 1, addReps: 0 } });
    if (!r.ok) { err.textContent = r.error.message; return false; } api.close(); app.router.navigate(`/train/builder/${r.draft.id}/${r.draft.version}`); return false; } }] });
}

async function importSheet(app, rr) {
  const { pickFile } = app.platform.files; const f = await pickFile('.xlsx,.xls');
  if (!f) return; toast('Reading spreadsheet\u2026'); const r = await app.importProgrammeSpreadsheet(f);
  if (!r.ok) { openSheet({ title: 'Import problem', content: h('div', { class: 'stack' }, h('p', {}, r.error.message), ...(r.error.issues || []).slice(0, 8).map((x) => h('p', { class: 'small muted' }, x))), actions: [{ label: 'Close', kind: 'secondary' }] }); return; }
  openSheet({ title: 'Imported as a draft', content: h('div', { class: 'stack' }, h('p', {}, `${r.draft.sessions.length} sessions imported. ${r.addedExercises ? `${r.addedExercises} new exercise(s) were added to your catalogue.` : ''}`), ...(r.issues || []).slice(0, 6).map((x) => h('p', { class: 'small muted' }, x))), actions: [{ label: 'Review draft', close: false, onClick: (api) => { api.close(); app.router.navigate(`/train/builder/${r.draft.id}/${r.draft.version}`); return false; } }] });
}

/* ------------------------------ exercise library tab ------------------------------ */
function libraryTab(app, rr) {
  const f = app.exerciseFacets(); const results = app.searchExercises(filt.q, filt);
  const q = input({ type: 'search', placeholder: 'Search exercises or muscles', value: filt.q, 'aria-label': 'Search exercises' }); let tm; q.addEventListener('input', () => { clearTimeout(tm); tm = setTimeout(() => { filt.q = q.value; rr(); setTimeout(() => { const el = document.querySelector('input[type=search]'); el && (el.focus(), el.setSelectionRange(el.value.length, el.value.length)); }, 0); }, 250); });
  const muscle = select([['', 'Any muscle'], ...f.muscles.map((m) => [m, m])], filt.muscle, { 'aria-label': 'Muscle group', onchange: (e) => { filt.muscle = e.target.value; rr(); } });
  const equip = select([['', 'Any equipment'], ...f.equipment.map((m) => [m, m])], filt.equipment, { 'aria-label': 'Equipment', onchange: (e) => { filt.equipment = e.target.value; rr(); } });
  const any = filt.q || filt.category || filt.muscle || filt.equipment || filt.difficulty;
  return h('div', { class: 'stack' }, h('div', { class: 'row' }, h('div', { class: 'grow' }, q), btn('Add', () => openExerciseForm(app, null, rr), { sm: true, icon: 'plus' })), chips(f.categories, filt.category, (v) => { filt.category = v; rr(); }, 'Category'), h('div', { class: 'row' }, h('div', { class: 'grow' }, muscle), h('div', { class: 'grow' }, equip)), select([['', 'Any difficulty'], ['Beginner', 'Beginner'], ['Intermediate', 'Intermediate'], ['Advanced', 'Advanced']], filt.difficulty, { 'aria-label': 'Difficulty', onchange: (e) => { filt.difficulty = e.target.value; rr(); } }),
    h('div', { class: 'row between' }, h('span', { class: 'small muted' }, `${results.length} exercise${results.length === 1 ? '' : 's'}`), [...app.state.exIndex.values()].some((e) => e.archived) ? btn('Archived', () => openArchived(app, rr), { kind: 'text', sm: true }) : null, any ? btn('Reset filters', () => { Object.assign(filt, { q: '', category: '', muscle: '', equipment: '', difficulty: '' }); rr(); }, { kind: 'text', sm: true }) : null),
    results.length ? list(results.slice(0, 80).map((e) => item({ title: e.name, meta: [(e.primaryMuscles || []).join(', '), (CATEGORIES.find((c) => c[0] === e.category) || [])[1]].filter(Boolean).join(' \u00b7 '), href: `#/train/exercise/${encodeURIComponent(e.id)}` }))) : empty({ icon: 'search', title: 'No exercises match', text: 'Try a different search or clear the filters.', action: btn('Reset filters', () => { Object.assign(filt, { q: '', category: '', muscle: '', equipment: '', difficulty: '' }); rr(); }) }),
    results.length > 80 ? h('p', { class: 'small muted center' }, `Showing the first 80 of ${results.length}. Search to narrow down.`) : null);
}

export function openExerciseForm(app, ex, onDone) {
  const e = ex || { name: '', category: 'strength', primaryMuscles: [], equipment: ['bodyweight'], difficulty: '', instructions: '', breathing: '', commonMistakes: [], safetyNotes: [] };
  const name = input({ value: e.name, maxlength: 80 }), cat = select(CATEGORIES, e.category), mus = input({ value: (e.primaryMuscles || []).join(', '), placeholder: 'Chest, Triceps' }), diff = select([['', 'Not set'], ['Beginner', 'Beginner'], ['Intermediate', 'Intermediate'], ['Advanced', 'Advanced']], e.difficulty || '');
  const eq = new Set(e.equipment || []); const eqRow = h('div', { class: 'chips' }); const drawEq = () => eqRow.replaceChildren(...EQUIPMENT.map((x) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(eq.has(x)), onclick: () => { eq.has(x) ? eq.delete(x) : eq.add(x); drawEq(); } }, x))); drawEq();
  const sec = input({ value: (e.secondaryMuscles || []).join(', '), placeholder: 'Shoulders, Core' }), startPos = textarea({ value: e.startingPosition || '' }), vari = textarea({ value: (e.variations || []).join('\n'), placeholder: 'One per line' }), prog = textarea({ value: (e.progressions || []).join('\n'), placeholder: 'Harder options, one per line' }), ins = textarea({ value: e.instructions || '' }), br = input({ value: e.breathing || '' }), mis = textarea({ value: (e.commonMistakes || []).join('\n'), placeholder: 'One per line' }), safe = textarea({ value: (e.safetyNotes || []).join('\n'), placeholder: 'One per line' }), yt = input({ type: 'url', placeholder: 'https://youtube.com/...' });
  const err = h('div', { class: 'err', role: 'alert' });
  openSheet({ title: ex ? 'Edit exercise' : 'New exercise', content: h('div', { class: 'stack' }, field('Name', name), field('Category', cat), field('Primary muscles', mus, { hint: 'Separate with commas' }), field('Secondary muscles', sec),  h('div', {}, h('div', { class: 'label strong small', style: { marginBottom: '6px' } }, 'Equipment'), eqRow), field('Difficulty', diff), field('Starting position', startPos), field('Instructions', ins), field('Breathing', br), field('Variations', vari), field('Progressions', prog), field('Common mistakes', mis), field('Safety notes', safe), !ex && field('Video link (optional)', yt), err), actions: [{ label: 'Cancel', kind: 'secondary' }, { label: 'Save', close: false, busy: true, onClick: async (api) => {
    const lines = (t) => t.split('\n').map((x) => x.trim()).filter(Boolean);
    const r = await app.saveExercise({ ...(ex ? { id: ex.id } : {}), name: name.value, category: cat.value, primaryMuscles: mus.value.split(',').map((x) => x.trim()).filter(Boolean), secondaryMuscles: sec.value.split(',').map((x) => x.trim()).filter(Boolean), startingPosition: startPos.value, variations: lines(vari.value), progressions: lines(prog.value), equipment: [...eq], difficulty: diff.value, instructions: ins.value, breathing: br.value, commonMistakes: lines(mis.value), safetyNotes: lines(safe.value) });
    if (!r.ok) { err.textContent = r.error.message; return false; }
    if (!ex && yt.value) await app.addExerciseLink(r.exercise.id, yt.value);
    toast('Exercise saved'); api.close(); onDone && onDone(r.exercise); return false; } }] });
}

/* ------------------------------ saved workouts tab ------------------------------ */
function workoutsTab(app, rr) {
  const ws = app.state.workouts; const label = { yoga: 'Yoga', cardio: 'Cardio', 'custom-day': 'Custom day', 'saved-plan': 'Saved plan', custom: 'Workout' };
  const startable = (w) => w.sections && Object.keys(w.sections).length;
  const rows = ws.sort((a, b) => a.name.localeCompare(b.name)).map((w) => item({ title: w.name, meta: `${label[w.category] || 'Workout'}${startable(w) ? '' : ' \u00b7 kept from V5 (view only)'}`, lead: w.category === 'yoga' ? 'breath' : w.category === 'cardio' ? 'activity' : 'train', onClick: () => openWorkoutSheet(app, w, rr) }));
  return h('div', { class: 'stack' }, h('p', { class: 'muted small' }, 'Run a workout on its own, outside your programme. Standalone workouts never change your programme position.'), rows.length ? list(rows) : empty({ icon: 'train', title: 'No saved workouts yet', text: 'Your V5 yoga and cardio sessions and custom days appear here after the upgrade. You can also create a workout.', action: btn('Create a workout', () => openWorkoutBuilder(app, rr)) }), rows.length ? btn('Create a workout', () => openWorkoutBuilder(app, rr), { kind: 'secondary', block: true, icon: 'plus' }) : null);
}
function openWorkoutSheet(app, w, rr) {
  const can = w.sections && Object.keys(w.sections).length;
  openSheet({ title: w.name, content: h('div', { class: 'stack' }, can ? outline(w).map((o) => h('div', {}, h('h3', { class: 'strong small muted', style: { margin: '8px 0 4px' } }, o.label), list(o.rows.map((r) => item({ title: r.title, meta: r.meta, chev: false }))))) : h('p', { class: 'muted' }, 'This saved item came from V5.0 and has no exercise list to run. It is kept so nothing is lost.')), actions: [can && { label: 'Start workout', close: false, onClick: async (api) => { const r = await app.startDraft({ kind: 'workout', workoutId: w.id }); if (!r.ok) { toast(r.error.message); return false; } api.close(); app.router.navigate('/workout'); return false; } }, can && { label: 'Edit', kind: 'secondary', close: false, onClick: (api) => { api.close(); openWorkoutBuilder(app, rr, w); return false; } }, { label: 'Delete', kind: 'secondary', close: false, onClick: async (api) => { api.close(); if (await confirmDialog({ title: 'Delete this workout?', message: 'Your history is not affected.', confirmLabel: 'Delete', danger: true })) { await app.deleteWorkout(w.id); toast('Workout deleted'); } return false; } }].filter(Boolean) });
}
function openWorkoutBuilder(app, rr, existing) {
  openSectionsSheet(app, { title: existing ? 'Edit workout' : 'Create a workout', name: existing?.name ?? '', sections: existing?.sections || { main: [] },
    onSave: async ({ name, sections }) => { const r = await app.saveWorkout({ ...(existing ? { id: existing.id } : { category: 'custom' }), name, sections }); if (r.ok) toast('Workout saved'); return r; } });
}

/** Searchable exercise picker used by the builder and workout creator. */
export function pickExercise(app, onPick) {
  const q = input({ type: 'search', placeholder: 'Search exercises', 'aria-label': 'Search exercises' }); const out = h('div', { class: 'list' });
  const draw = () => { const r = app.searchExercises(q.value).slice(0, 40); out.replaceChildren(...(r.length ? r.map((e) => item({ title: e.name, meta: (e.primaryMuscles || []).join(', '), chev: false, onClick: () => { sheet.close(); onPick(e); } })) : [h('p', { class: 'muted', style: { padding: '12px' } }, 'No match. Add it in Train > Exercises first.')])); };
  q.addEventListener('input', draw); const sheet = openSheet({ title: 'Choose an exercise', content: h('div', { class: 'stack' }, q, out), actions: [] }); draw();
}

function openArchived(app, rr) {
  const arch = [...app.state.exIndex.values()].filter((e) => e.archived).sort((a, b) => a.name.localeCompare(b.name));
  openSheet({ title: 'Archived exercises', content: arch.length ? list(arch.map((e) => item({ title: e.name, meta: (e.primaryMuscles || []).join(', '), chev: false, trailing: btn('Restore', async () => { await app.archiveExercise(e.id, false); toast(`${e.name} restored`); }, { kind: 'secondary', sm: true }) }))) : h('p', { class: 'muted' }, 'Nothing is archived.'), actions: [{ label: 'Close', kind: 'secondary' }] });
}
