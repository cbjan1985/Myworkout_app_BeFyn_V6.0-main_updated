import { h } from '../dom.js';
import { card, pill, list, item, sectionTitle, empty, banner, metric, segmented, select, progressBar, btn } from '../components.js';
import { lineChart, barChart } from '../charts.js';
import { prettyDate, addDays } from '../../core/util.js';
import { MEASURE_TYPES } from '../../services/tracking.js';
import { describeTrend, trend } from '../../domain/insights.js';

let tab = 'overview'; let strengthId = '';
export async function progress(app, ctx) {
  const rr = ctx.rerender; const ins = app.insights(); const has = app.state.logs.length > 0;
  const body = !has && tab !== 'body' && tab !== 'nutrition' ? empty({ icon: 'progress', title: 'Your progress will appear here', text: 'Complete your first workout and BeFyn shows strength, consistency and records. Nothing to set up.', action: btn('Go to Today', () => app.router.navigate('/today')) }) : ({ overview, strength, body: bodyTab, nutrition })[tab](app, ins, rr);
  return { title: 'Progress', content: h('div', { class: 'stack-lg' }, segmented([['overview', 'Overview'], ['strength', 'Strength'], ['body', 'Body'], ['nutrition', 'Protein']], tab, (v) => { tab = v; rr(); }, 'Progress sections'), body) };
}

function overview(app, ins) {
  const w = ins.weekly; const total = w.reduce((n, x) => n + x.count, 0); const ad = ins.adherence;
  const kids = [card(h('div', { class: 'metrics' }, metric(ins.totals.sessions, 'Workouts logged'), metric(ins.totals.minutes, 'Minutes trained'), metric(w[w.length - 1].count, 'This week'), ad && ad.rate != null ? metric(Math.round(ad.rate * 100) + '%', 'Programme adherence') : null)),
    card([h('h2', {}, 'Workouts per week'), h('p', { class: 'small muted' }, 'Last 8 weeks, ending today'), barChart(w.map((x, i) => ({ label: i === w.length - 1 ? 'Now' : `-${w.length - 1 - i}w`, value: x.count })), { label: 'Workouts per week' }), total === 0 ? h('p', { class: 'small muted' }, 'No workouts in this period yet.') : null])];
  if (ins.records.length) kids.push(sectionTitle('Recent records'), list(ins.records.slice(0, 5).map((r) => item({ title: r.name, meta: `${r.maxKg.value} kg \u00d7 ${r.maxKg.reps} on ${prettyDate(r.maxKg.date)}`, lead: 'trophy', chev: false }))));
  if (ins.muscles.length) { const mx = ins.muscles[0].sets; kids.push(sectionTitle('Muscle groups, last 14 days'), card(h('div', { class: 'stack' }, ins.muscles.slice(0, 8).map((m) => h('div', {}, h('div', { class: 'row between small' }, h('span', {}, m.muscle), h('span', { class: 'num muted' }, `${m.sets} sets`)), progressBar((m.sets / mx) * 100, `${m.muscle}: ${m.sets} sets`))))), h('p', { class: 'small muted' }, 'Counts logged sets by primary muscle. It shows where your training went, not whether it was enough.')); }
  return h('div', { class: 'stack-lg' }, kids);
}

function strength(app, ins, rr) {
  const exs = app.trainedExercises();
  if (!exs.length) return empty({ icon: 'trophy', title: 'No weights logged yet', text: 'Log reps and weight in a workout to see estimated strength over time.' });
  if (!strengthId || !exs.some((e) => e.id === strengthId)) strengthId = exs[0].id;
  const sel = select(exs.map((e) => [e.id, e.name]), strengthId, { 'aria-label': 'Exercise', onchange: (e) => { strengthId = e.target.value; rr(); } });
  const s = app.strengthSeries(strengthId); const chart = lineChart(s, { unit: 'kg', label: 'Estimated one-rep max' }); const t = trend(s);
  return h('div', { class: 'stack-lg' }, sel, card([h('h2', {}, 'Estimated one-rep max'), h('p', { class: 'small muted' }, 'Calculated from your best set each session (weight \u00d7 reps). It is an estimate, not a tested max.'), chart || h('p', { class: 'muted', style: { marginTop: '8px' } }, s.length ? 'A trend line appears after at least three sessions of this exercise.' : 'No sets with weight yet.'), s.length ? h('p', { class: 'small', style: { marginTop: '8px' } }, `Latest: ${s[s.length - 1].value} kg on ${prettyDate(s[s.length - 1].date)}${s.length > 1 ? `. First: ${s[0].value} kg.` : '.'}`) : null]), sectionTitle('Records'), list(ins.records.map((r) => item({ title: r.name, meta: `Heaviest ${r.maxKg.value} kg \u00d7 ${r.maxKg.reps}${r.best1RM ? ` \u00b7 est. max ${r.best1RM.value} kg` : ''}`, lead: 'trophy', href: `#/train/exercise/${encodeURIComponent(r.exercise)}` }))));
}

function bodyTab(app, ins, rr) {
  const latest = app.latestMeasurements(); const src = app.weightSources(); const pts = src.map((x) => ({ date: x.date, value: x.value })).reverse(); const chart = lineChart(pts, { unit: 'kg', label: 'Body weight' });
  const kids = [card([h('div', { class: 'row between' }, h('h2', {}, 'Body weight'), btn('Add', () => app.router.navigate('/more/health'), { kind: 'text', sm: true })), chart || h('p', { class: 'muted' }, pts.length ? 'Add entries over two weeks or more to see a trend.' : 'No entries yet.'), h('p', { class: 'small muted', style: { marginTop: '8px' } }, ins.weightText)])];
  const rows = MEASURE_TYPES.filter((t) => latest[t.id]).map((t) => item({ title: t.label, meta: `${latest[t.id].value} ${t.unit} on ${prettyDate(latest[t.id].date)}`, chev: false }));
  if (rows.length) kids.push(sectionTitle('Latest measurements'), list(rows));
  if (src.some((x) => x.source.includes('Health Connect')) && src.some((x) => !x.source.includes('Health Connect'))) kids.push(banner('Weights from BeFyn and from Health Connect are both shown. They are not merged, so you can see where each came from.', { kind: 'info' }));
  return h('div', { class: 'stack-lg' }, kids);
}

function nutrition(app) {
  const t = app.proteinTarget(); const hist = app.proteinHistory(14); const logged = hist.some((d) => d.count);
  const wk = app.proteinWeek();
  return h('div', { class: 'stack-lg' }, card([h('h2', {}, 'Protein, last 14 days'), logged ? barChart(hist.map((d) => ({ label: d.date.slice(8), value: Math.round(d.total) })), { label: 'Protein per day', unit: ' g', target: t || undefined }) : h('p', { class: 'muted' }, 'No protein logged yet.'), wk.daysLogged ? h('p', { class: 'small muted', style: { marginTop: '8px' } }, `Last 7 days: logged on ${wk.daysLogged} day${wk.daysLogged === 1 ? '' : 's'}, average ${wk.average} g${t ? `, target reached on ${wk.daysOnTarget}` : ''}. Values marked as estimates are approximate.`) : null]), btn('Log protein', () => app.router.navigate('/more/nutrition'), { block: true }));
}
