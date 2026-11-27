// Edits a session's sections (warm-up, main, flow, breathing, stretching) including supersets, tri-sets and drop sets.
// Used by the Programme Builder (pattern days and individual sessions) and by saved-workout editing.
import { h } from './dom.js';
import { openSheet } from './dom.js';
import { btn, iconBtn, item, list, field, input, stepper, segmented } from './components.js';
import { targetText } from './session-view.js';
import { SECTION_LABEL } from '../domain/programme.js';
import { pickExercise } from './screens/train.js';

const ORDER = ['warmup', 'main', 'flow', 'breathing', 'cooldown'];
const DEFAULT_ITEM = {
  main: { sets: 3, reps: 10, rest: 60 }, warmup: { sets: 1, reps: 10 }, flow: { sets: 1, secs: 45 }, breathing: { sets: 1, secs: 60 }, cooldown: { sets: 1, secs: 30 },
};
const BLOCKS = { superset: 'Superset', triset: 'Tri-set', dropset: 'Drop set' };
export const countItems = (sections) => Object.values(sections || {}).reduce((n, bl) => n + bl.reduce((m, b) => m + (b.items ? b.items.length : 1), 0), 0);

/** @returns {HTMLElement} a node that edits `sections` in place and calls onChange() after every edit */
export function sectionsEditor(app, sections, onChange, { tab: startTab = 'main' } = {}) {
  let tab = startTab; const root = h('div', { class: 'stack' });
  const blocksOf = () => (sections[tab] = sections[tab] || []);
  const itemFor = (ex) => ({ exercise: ex.id, name: ex.name, ...DEFAULT_ITEM[tab] });
  const changed = () => { onChange && onChange(); draw(); };

  function editItem(it, extra) {
    const sets = stepper({ value: it.sets || 1, min: 1, max: 12, label: 'Sets' }), reps = stepper({ value: it.reps || 0, min: 0, max: 100, label: 'Reps' }), secs = stepper({ value: it.secs || 0, min: 0, max: 900, step: 5, label: 'Seconds' }), rest = stepper({ value: it.rest || 0, min: 0, max: 300, step: 5, label: 'Rest in seconds' }), load = input({ value: it.load || '', placeholder: 'e.g. 5 kg each hand' });
    openSheet({ title: it.name, content: h('div', { class: 'stack' }, extra ? null : field('Sets', sets), field('Reps (0 if timed)', reps), field('Seconds (0 if counted in reps)', secs), extra ? null : field('Rest between sets (seconds)', rest), field('Load', load)), actions: [{ label: 'Cancel', kind: 'secondary' }, { label: 'Save', onClick: () => { Object.assign(it, { sets: extra ? 1 : sets.get(), reps: reps.get() || undefined, secs: secs.get() || undefined, rest: extra ? undefined : rest.get() || undefined, load: load.value }); delete it.target; changed(); } }] });
  }
  function editBlock(b) {
    const rounds = stepper({ value: b.rounds || 3, min: 1, max: 10, label: 'Rounds' }), rest = stepper({ value: b.restAfterRound || 0, min: 0, max: 300, step: 5, label: 'Rest after each round in seconds' });
    openSheet({ title: `${BLOCKS[b.type]}: ${b.items.map((i) => i.name).join(' + ')}`, content: h('div', { class: 'stack' }, field('Rounds', rounds), field('Rest after each round (seconds)', rest), h('p', { class: 'small strong' }, 'Exercises in this block'), list(b.items.map((it) => item({ title: it.name, meta: targetText({ ...it, sets: 1 }), onClick: () => editItem(it, true) })))), actions: [{ label: 'Cancel', kind: 'secondary' }, { label: 'Save', onClick: () => { b.rounds = rounds.get(); b.restAfterRound = rest.get(); changed(); } }] });
  }
  function addSuperset(type) {
    const need = type === 'triset' ? 3 : 2; const picked = []; const listEl = h('div', { class: 'stack' }); const rounds = stepper({ value: 3, min: 1, max: 10, label: 'Rounds' }), rest = stepper({ value: 60, min: 0, max: 300, step: 5, label: 'Rest after each round' });
    const draw2 = () => { listEl.replaceChildren(...picked.map((p, i) => item({ title: `${String.fromCharCode(65 + i)}: ${p.name}`, chev: false, trailing: iconBtn('trash', `Remove ${p.name}`, () => { picked.splice(i, 1); draw2(); }) })), picked.length < need ? btn(`Choose exercise ${String.fromCharCode(65 + picked.length)}`, () => pickExercise(app, (ex) => { picked.push(itemFor(ex)); draw2(); }), { kind: 'secondary', block: true, icon: 'plus' }) : null); };
    draw2(); const err = h('div', { class: 'err', role: 'alert' });
    openSheet({ title: `Add a ${BLOCKS[type].toLowerCase()}`, content: h('div', { class: 'stack' }, h('p', { class: 'muted' }, `Do the exercises back to back, then rest. Choose ${need}.`), listEl, field('Rounds', rounds), field('Rest after each round (seconds)', rest), err), actions: [{ label: 'Cancel', kind: 'secondary' }, { label: 'Add', close: false, onClick: (api) => { if (picked.length < need) { err.textContent = `Choose ${need} exercises.`; return false; } picked.forEach((p) => { p.sets = 1; delete p.rest; }); blocksOf().push({ type, rounds: rounds.get(), restAfterRound: rest.get(), items: picked }); api.close(); changed(); return false; } }] });
  }
  const move = (arr, i, d) => { const j = i + d; if (j < 0 || j >= arr.length) return; [arr[i], arr[j]] = [arr[j], arr[i]]; changed(); };

  function draw() {
    const present = ORDER.filter((k) => k === 'main' || sections[k]?.length || k === tab);
    const blocks = blocksOf();
    const rows = blocks.map((b, k) => { const flat = !b.type || b.type === 'straight'; const its = b.items || [b]; const it0 = its[0];
      return item({ title: flat ? it0.name : `${BLOCKS[b.type] || b.type}: ${its.map((x) => x.name).join(' + ')}`, meta: flat ? targetText(it0) : `${b.rounds} rounds`, onClick: () => (flat ? editItem(it0) : editBlock(b)),
        trailing: h('span', { class: 'row', style: { gap: 0 } }, iconBtn('up', `Move ${it0.name} up`, (e) => { e.stopPropagation(); move(blocks, k, -1); }), iconBtn('down', `Move ${it0.name} down`, (e) => { e.stopPropagation(); move(blocks, k, 1); }), iconBtn('trash', `Remove ${it0.name}`, (e) => { e.stopPropagation(); blocks.splice(k, 1); changed(); })) }); });
    root.replaceChildren(
      h('div', { class: 'seg scroll', role: 'tablist', 'aria-label': 'Workout sections' }, ORDER.map((k) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(k === tab), onclick: () => { tab = k; draw(); } }, SECTION_LABEL[k] + (sections[k]?.length ? ` (${sections[k].length})` : '')))),
      rows.length ? list(rows) : h('p', { class: 'muted small' }, `No ${SECTION_LABEL[tab].toLowerCase()} yet.`),
      h('div', { class: 'row wrap' }, btn('Add exercise', () => pickExercise(app, (ex) => { blocksOf().push({ type: 'straight', items: [itemFor(ex)] }); changed(); }), { kind: 'secondary', sm: true, icon: 'plus' }),
        tab === 'main' ? btn('Add superset', () => addSuperset('superset'), { kind: 'secondary', sm: true }) : null, tab === 'main' ? btn('Add tri-set', () => addSuperset('triset'), { kind: 'secondary', sm: true }) : null));
  }
  draw(); return root;
}

/** Sheet wrapper: edit a whole sections object and hand it back on Save. */
export function openSectionsSheet(app, { title, name, sections, onSave, extra }) {
  const working = JSON.parse(JSON.stringify(sections || {})); const nameIn = input({ value: name ?? '', maxlength: 60 }); const err = h('div', { class: 'err', role: 'alert' });
  openSheet({ title, content: h('div', { class: 'stack' }, name !== undefined ? field('Name', nameIn) : null, extra || null, sectionsEditor(app, working, null), err), actions: [{ label: 'Cancel', kind: 'secondary' }, { label: 'Save', close: false, busy: true, onClick: async (api) => { if (name !== undefined && !nameIn.value.trim()) { err.textContent = 'Give it a name.'; return false; } if (!countItems(working)) { err.textContent = 'Add at least one exercise.'; return false; } const r = await onSave({ name: nameIn.value.trim(), sections: working }); if (r && r.ok === false) { err.textContent = r.error.message; return false; } api.close(); return false; } }] });
}
