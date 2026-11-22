import { h } from '../dom.js';
import { openSheet, toast, confirmDialog } from '../dom.js';
import { btn, card, pill, list, item, sectionTitle, empty, banner, field, input } from '../components.js';
import { icon } from '../icons.js';
import { lineChart } from '../charts.js';
import { prettyDate } from '../../core/util.js';
import { CATEGORIES } from '../../services/library.js';
import { youtubeThumb, youtubeSearch, safeUrl } from '../../platform/media.js';
import { personalRecords } from '../../domain/progression.js';
import { openExerciseForm } from './train.js';

export async function exerciseDetail(app, ctx) {
  const ex = app.exercise(ctx.id) || app.state.exIndex.get(ctx.id);
  if (!ex) return { title: 'Exercise', content: empty({ icon: 'search', title: 'Exercise not found', text: 'It may have been removed.', action: btn('Back to exercises', () => app.router.navigate('/train')) }) };
  const rr = ctx.rerender; const hist = app.exerciseHistory(ex.id); const usage = app.exerciseUsage(ex.id);
  const pr = personalRecords(hist.map((x) => ({ date: x.date, exercise: ex.id, sets: x.sets })))[0];
  const mediaBox = h('div', { class: 'media' }, icon('image', 40));
  app.platform.media.resolve(ex).then((m) => { if (!mediaBox.isConnected) return; if (m) mediaBox.replaceChildren(m.type === 'video' ? h('video', { src: m.url, controls: true, loop: true, muted: true, playsinline: true, preload: 'metadata' }) : h('img', { src: m.url, alt: `${ex.name} demonstration` })); }).catch(() => {});
  const links = (ex.media || []).filter((m) => m.kind === 'youtube' && safeUrl(m.url));
  const series = app.strengthSeries(ex.id); const chart = lineChart(series, { unit: 'kg', label: `${ex.name} estimated one-rep max` });
  const sec = (title, text) => text ? h('div', {}, h('h3', { class: 'strong' }, title), h('p', { class: 'muted', style: { marginTop: '2px' } }, text)) : null;
  const kids = [
    h('div', { class: 'row wrap' }, pill((CATEGORIES.find((c) => c[0] === ex.category) || [])[1] || ex.category, 'acc'), ex.difficulty ? pill(ex.difficulty) : null, ...(ex.equipment || []).map((e) => pill(e))),
    (ex.primaryMuscles || []).length ? h('p', {}, h('strong', {}, 'Works: '), ex.primaryMuscles.join(', '), ex.secondaryMuscles?.length ? h('span', { class: 'muted' }, ` (also ${ex.secondaryMuscles.join(', ')})`) : null) : null,
    mediaBox,
    card([h('div', { class: 'row between' }, h('h2', {}, 'Demo videos'), btn('Add link', () => addLink(app, ex), { kind: 'text', sm: true })), links.length ? h('div', { class: 'stack', style: { marginTop: '8px' } }, links.map((l) => h('div', { class: 'row' }, youtubeThumb(l.url) ? h('img', { src: youtubeThumb(l.url), alt: '', width: 80, height: 45, style: { borderRadius: '6px', objectFit: 'cover' }, onerror: (e) => e.target.remove() }) : icon('link'), h('a', { class: 'grow', href: l.url, target: '_blank', rel: 'noopener', style: { overflowWrap: 'anywhere' } }, l.url.replace(/^https?:\/\//, '')), h('button', { class: 'icon-btn', 'aria-label': 'Remove link', onclick: async () => { await app.removeExerciseLink(ex.id, l.url); rr(); } }, icon('trash'))))) : h('p', { class: 'small muted', style: { marginTop: '6px' } }, [ 'No link yet. ', h('a', { href: youtubeSearch(ex.name), target: '_blank', rel: 'noopener' }, 'Find a demo video'), ' and paste its link here.' ])]),
    card(h('div', { class: 'stack' }, sec('How to do it', ex.instructions || ex.description), sec('Starting position', ex.startingPosition), sec('Breathing', ex.breathing), (ex.commonMistakes || []).length ? sec('Common mistakes', ex.commonMistakes.join('; ')) : null, (ex.safetyNotes || []).length ? sec('Safety', ex.safetyNotes.join('; ')) : null, (ex.variations || []).length ? sec('Variations', ex.variations.join('; ')) : null, !ex.instructions && !ex.description ? h('p', { class: 'muted' }, 'No instructions yet. Tap Edit to add your own.') : null)),
  ];
  if (hist.length) {
    kids.push(sectionTitle('Your history'));
    kids.push(card(h('div', { class: 'stack' }, pr && pr.maxKg ? h('p', {}, h('strong', {}, 'Heaviest: '), `${pr.maxKg.value} kg \u00d7 ${pr.maxKg.reps}`, h('span', { class: 'muted' }, ` on ${prettyDate(pr.maxKg.date)}`)) : null, chart || (series.length ? h('p', { class: 'small muted' }, 'A trend line appears after at least three sessions with weights.') : null), list(hist.slice(0, 5).map((x) => item({ title: prettyDate(x.date), meta: x.sets.filter((s) => s.done !== false).map((s) => `${s.reps || s.secs}${s.kg ? ` \u00d7 ${s.kg}kg` : ''}`).join(', '), chev: false }))))));
  }
  kids.push(h('div', { class: 'row' }, btn('Edit', () => openExerciseForm(app, ex, rr), { kind: 'secondary', block: true, icon: 'edit' }), btn(ex.archived ? 'Restore' : 'Archive', async () => {
    if (!ex.archived && (usage.templates.length || usage.logs)) { if (!await confirmDialog({ title: 'Archive this exercise?', message: `It is used in ${usage.templates.length} programme(s) and ${usage.logs} logged workout(s). Those keep working; the exercise just stops appearing in the catalogue.`, confirmLabel: 'Archive' })) return; }
    await app.archiveExercise(ex.id, !ex.archived); toast(ex.archived ? 'Exercise restored' : 'Exercise archived'); if (!ex.archived) app.router.navigate('/train'); }, { kind: 'secondary', block: true })));
  return { title: ex.name, content: h('div', { class: 'stack-lg' }, kids) };
}

function addLink(app, ex) {
  const url = input({ type: 'url', placeholder: 'https://youtube.com/...' }); const err = h('div', { class: 'err', role: 'alert' });
  openSheet({ title: 'Add a video link', content: h('div', { class: 'stack' }, field('Link', url, { hint: 'YouTube or any web link. Opens in your browser.' }), err), actions: [{ label: 'Cancel', kind: 'secondary' }, { label: 'Add', close: false, onClick: async (api) => { const r = await app.addExerciseLink(ex.id, url.value.trim()); if (!r.ok) { err.textContent = r.error.message; return false; } api.close(); return false; } }] });
}
