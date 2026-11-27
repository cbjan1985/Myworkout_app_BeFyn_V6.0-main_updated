import { h } from '../dom.js';
import { openSheet, toast } from '../dom.js';
import { card, pill, list, item, sectionTitle, empty, banner, metric, select, progressBar, btn, field, input, textarea, chips } from '../components.js';
import { lineChart, barChart } from '../charts.js';
import { prettyDate, addDays, formatDuration } from '../../core/util.js';
import { MEASURE_TYPES } from '../../services/tracking.js';
import { describeTrend, trend, sessionsPerWeek } from '../../domain/insights.js';
import { dailySummary, latest as latestHealth } from '../../platform/health.js';

let tab = 'overview', strengthId = '', weeks = 8, days = 14, measureType = 'weight', hist = { q: '', kind: 'all' };
const TABS = [['overview', 'Overview'], ['strength', 'Strength'], ['activity', 'Activity'], ['history', 'History'], ['body', 'Body'], ['nutrition', 'Protein']];

export async function progress(app, ctx) {
  const rr = ctx.rerender; const ins = app.insights(); const has = app.state.logs.length > 0;
  const needsLogs = ['overview', 'strength'].includes(tab);
  const body = !has && needsLogs ? empty({ icon: 'progress', title: 'Your progress will appear here', text: 'Complete your first workout and BeFyn shows strength, consistency and records. Nothing to set up.', action: btn('Go to Today', () => app.router.navigate('/today')) }) : ({ overview, strength, activity, history, body: bodyTab, nutrition })[tab](app, ins, rr);
  const bar = h('div', { class: 'seg scroll', role: 'tablist', 'aria-label': 'Progress sections' }, TABS.map(([v, l]) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(v === tab), onclick: () => { tab = v; rr(); } }, l)));
  return { title: 'Progress', content: h('div', { class: 'stack-lg' }, bar, body) };
}

const rangeSel = (label, options, value, set, rr) => h('div', { class: 'row between' }, h('span', { class: 'small muted' }, label), select(options.map((o) => [String(o[0]), o[1]]), String(value), { 'aria-label': label, onchange: (e) => { set(+e.target.value); rr(); } }));

function overview(app, ins, rr) {
  const w = sessionsPerWeek(app.state.logs, app.today(), weeks); const total = w.reduce((n, x) => n + x.count, 0); const ad = ins.adherence;
  const kids = [card(h('div', { class: 'metrics' }, metric(ins.totals.sessions, 'Workouts logged'), metric(ins.totals.minutes, 'Minutes trained'), metric(w[w.length - 1].count, 'This week'), ad && ad.rate != null ? metric(Math.round(ad.rate * 100) + '%', 'Programme adherence') : null)),
    card([h('h2', {}, 'Workouts per week'), rangeSel('Time range', [[4, 'Last 4 weeks'], [8, 'Last 8 weeks'], [12, 'Last 12 weeks']], weeks, (v) => { weeks = v; }, rr), barChart(w.map((x, i) => ({ label: i === w.length - 1 ? 'Now' : `-${w.length - 1 - i}w`, value: x.count })), { label: 'Workouts per week' }), total === 0 ? h('p', { class: 'small muted' }, 'No workouts in this period yet.') : null])];
  if (ins.records.length) kids.push(sectionTitle('Recent records'), list(ins.records.slice(0, 5).map((r) => item({ title: r.name, meta: `${r.maxKg.value} kg \u00d7 ${r.maxKg.reps} on ${prettyDate(r.maxKg.date)}`, lead: 'trophy', chev: false }))));
  if (ins.muscles.length) { const mx = ins.muscles[0].sets; kids.push(sectionTitle('Muscle groups, last 14 days'), card(h('div', { class: 'stack' }, ins.muscles.slice(0, 8).map((m) => h('div', {}, h('div', { class: 'row between small' }, h('span', {}, m.muscle), h('span', { class: 'num muted' }, `${m.sets} sets`)), progressBar((m.sets / mx) * 100, `${m.muscle}: ${m.sets} sets`))))), h('p', { class: 'small muted' }, 'Counts logged sets by primary muscle. It shows where your training went, not whether it was enough.')); }
  kids.push(btn('See recovery and training load', () => app.router.navigate('/more/recovery'), { kind: 'secondary', block: true }));
  return h('div', { class: 'stack-lg' }, kids);
}

function strength(app, ins, rr) {
  const exs = app.trainedExercises();
  if (!exs.length) return empty({ icon: 'trophy', title: 'No weights logged yet', text: 'Log reps and weight in a workout to see estimated strength over time.' });
  if (!strengthId || !exs.some((e) => e.id === strengthId)) strengthId = exs[0].id;
  const sel = select(exs.map((e) => [e.id, e.name]), strengthId, { 'aria-label': 'Exercise', onchange: (e) => { strengthId = e.target.value; rr(); } });
  const s = app.strengthSeries(strengthId); const chart = lineChart(s, { unit: 'kg', label: 'Estimated one-rep max' });
  return h('div', { class: 'stack-lg' }, sel, card([h('h2', {}, 'Estimated one-rep max'), h('p', { class: 'small muted' }, 'Calculated from your best set each session (weight \u00d7 reps). It is an estimate, not a tested max.'), chart || h('p', { class: 'muted', style: { marginTop: '8px' } }, s.length ? 'A trend line appears after at least three sessions of this exercise.' : 'No sets with weight yet.'), s.length ? h('p', { class: 'small', style: { marginTop: '8px' } }, `Latest: ${s[s.length - 1].value} kg on ${prettyDate(s[s.length - 1].date)}${s.length > 1 ? `. First: ${s[0].value} kg.` : '.'}`) : null]), sectionTitle('Records'), list(ins.records.map((r) => item({ title: r.name, meta: `Heaviest ${r.maxKg.value} kg \u00d7 ${r.maxKg.reps}${r.best1RM ? ` \u00b7 est. max ${r.best1RM.value} kg` : ''}`, lead: 'trophy', href: `#/train/exercise/${encodeURIComponent(r.exercise)}` }))));
}

/** Health Connect activity: steps, calories, sleep, heart rate, exercise sessions, SpO2. */
function activity(app, ins, rr) {
  const hs = app.state.health; const today = app.today();
  if (!hs.length) return empty({ icon: 'activity', title: 'No activity data yet', text: 'Connect Health Connect to see steps, sleep, heart rate and exercise sessions from your watch and fitness apps. It is optional and read-only.', action: btn('Open Health', () => app.router.navigate('/more/health')) });
  const from = addDays(today, -(days - 1)); const inRange = (d) => d >= from;
  const steps = dailySummary(hs, 'steps').filter((x) => inRange(x.date)), cal = dailySummary(hs, 'activeCalories').filter((x) => inRange(x.date)), sleep = dailySummary(hs, 'sleep').filter((x) => inRange(x.date));
  const hr = hs.filter((x) => x.type === 'heartRate' && inRange(x.start.slice(0, 10)));
  const hrDays = [...new Set(hr.map((x) => x.start.slice(0, 10)))].sort().map((d) => { const r = hr.filter((x) => x.start.slice(0, 10) === d); return { date: d, value: Math.round(r.reduce((t, x) => t + x.value, 0) / r.length) }; });
  const ex = hs.filter((x) => x.type === 'exercise' && inRange(x.start.slice(0, 10))).sort((a, b) => (a.start < b.start ? 1 : -1)).slice(0, 8);
  const spo2 = latestHealth(hs, 'oxygenSaturation'); const bf = latestHealth(hs, 'bodyFat');
  const chart = (rows, label, unit) => (rows.length ? barChart(rows.map((d) => ({ label: d.date.slice(8), value: Math.round(d.value * 10) / 10 })), { label, unit }) : h('p', { class: 'small muted' }, 'No data in this range.'));
  const kids = [rangeSel('Time range', [[7, 'Last 7 days'], [14, 'Last 14 days'], [30, 'Last 30 days']], days, (v) => { days = v; }, rr),
    card([h('h2', {}, 'Steps'), chart(steps.slice(-14), 'Steps per day', ' steps')]), card([h('h2', {}, 'Active calories'), chart(cal.slice(-14), 'Active calories per day', ' kcal')]),
    card([h('h2', {}, 'Sleep'), chart(sleep.slice(-14), 'Hours of sleep', ' h')]), card([h('h2', {}, 'Average heart rate'), hrDays.length >= 3 ? lineChart(hrDays, { unit: 'bpm', label: 'Average heart rate' }) : h('p', { class: 'small muted' }, hrDays.length ? `${hrDays[hrDays.length - 1].value} bpm on ${prettyDate(hrDays[hrDays.length - 1].date)}. A trend appears with three or more days.` : 'No heart-rate data in this range.')])];
  if (ex.length) kids.push(sectionTitle('Exercise sessions'), list(ex.map((e) => item({ title: e.extra?.title || 'Exercise session', meta: `${prettyDate(e.start.slice(0, 10))} \u00b7 ${Math.round(e.value)} min \u00b7 ${e.source}`, chev: false }))));
  if (spo2 || bf) kids.push(card(h('div', { class: 'metrics' }, spo2 ? metric(Math.round(spo2.value * 10) / 10, `Oxygen saturation (${prettyDate(spo2.start.slice(0, 10))})`, '%') : null, bf ? metric(Math.round(bf.value * 10) / 10, `Body fat (${bf.source})`, '%') : null)));
  kids.push(h('p', { class: 'small muted' }, 'When two apps record the same thing, the larger total for the day is used so nothing is counted twice. These numbers are for your own tracking and are not medical advice.'));
  return h('div', { class: 'stack-lg' }, kids);
}

/** Every logged session, searchable, with full detail and audited corrections. */
function history(app, ins, rr) {
  const q = input({ type: 'search', value: hist.q, placeholder: 'Search sessions or exercises', 'aria-label': 'Search history' }); let tm;
  q.addEventListener('input', () => { clearTimeout(tm); tm = setTimeout(() => { hist.q = q.value; rr(); setTimeout(() => { const el = document.querySelector('input[type=search]'); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }, 0); }, 250); });
  const logs = app.historyList(hist);
  return h('div', { class: 'stack' }, q, chips([['programme', 'Programme'], ['activity', 'Activities'], ['partial', 'Partial']], hist.kind === 'all' ? '' : hist.kind, (v) => { hist.kind = v || 'all'; rr(); }, 'Filter'),
    h('div', { class: 'row between' }, h('span', { class: 'small muted' }, `${logs.length} session${logs.length === 1 ? '' : 's'}`), btn('Export CSV', async () => { const r = await app.exportHistoryCsv(); toast(r.ok ? `Saved to ${r.where}` : r.message); }, { kind: 'text', sm: true })),
    logs.length ? list(logs.slice(0, 60).map((l) => item({ title: l.name, meta: `${prettyDate(l.date, true)} \u00b7 ${l.performances.reduce((n, p) => n + p.sets.filter((x) => x.done !== false).length, 0)} sets${l.durationSec ? ` \u00b7 ${Math.round(l.durationSec / 60)} min` : ''}`, trailing: l.status === 'partial' ? pill('Partial', 'warn') : l.revisions?.length ? pill('Corrected') : null, onClick: () => openLogSheet(app, l, rr) }))) : empty({ icon: 'list', title: 'No sessions found', text: hist.q || hist.kind !== 'all' ? 'Try a different search or filter.' : 'Finished workouts appear here.' }),
    logs.length > 60 ? h('p', { class: 'small muted center' }, `Showing the newest 60 of ${logs.length}. Search to narrow down.`) : null);
}

export function openLogSheet(app, log, rr) {
  const sets = (p) => p.sets.map((s, i) => `${i + 1}: ${s.done === false ? 'skipped' : [s.reps ? `${s.reps} reps` : '', s.secs ? `${s.secs}s` : '', s.kg ? `${s.kg} kg` : ''].filter(Boolean).join(' \u00d7 ') || 'done'}`).join('   ');
  const body = h('div', { class: 'stack' }, h('div', { class: 'row wrap' }, pill(prettyDate(log.date, true)), log.durationSec ? pill(`${Math.round(log.durationSec / 60)} min`) : null, log.feedback?.effort ? pill(`Effort ${log.feedback.effort}/10`) : null, log.status === 'partial' ? pill('Partial', 'warn') : null),
    log.notes ? h('p', {}, log.notes) : null,
    log.performances.length ? list(log.performances.map((p) => item({ title: p.name + (p.side ? ` (${p.side})` : ''), meta: sets(p), chev: false }))) : h('p', { class: 'muted' }, 'No sets were logged for this session (it was logged by time only).'),
    log.revisions?.length ? h('p', { class: 'small muted' }, `Corrected ${log.revisions.length} time${log.revisions.length === 1 ? '' : 's'}. Last reason: ${log.revisions[log.revisions.length - 1].reason}`) : null);
  const sheet = openSheet({ title: log.name, content: body, actions: [{ label: 'Close', kind: 'secondary' }, { label: 'Correct', close: false, onClick: (api) => { api.close(); openCorrectSheet(app, log, rr); return false; } }] });
}
function openCorrectSheet(app, log, rr) {
  const notes = textarea({ value: log.notes || '' }), eff = select([['', 'Not set'], ...Array.from({ length: 10 }, (_, i) => [String(i + 1), String(i + 1)])], String(log.feedback?.effort || '')), dur = input({ type: 'number', min: '0', max: '600', value: String(Math.round((log.durationSec || 0) / 60)) }), why = input({ placeholder: 'Why are you changing this?', maxlength: 120 }); const err = h('div', { class: 'err', role: 'alert' });
  openSheet({ title: 'Correct this session', content: h('div', { class: 'stack' }, h('p', { class: 'muted' }, 'The original is kept in the record. Sets can not be edited here, only notes, effort and time.'), field('Notes', notes), field('Effort (1 to 10)', eff), field('Minutes', dur), field('Reason (required)', why), err), actions: [{ label: 'Cancel', kind: 'secondary' }, { label: 'Save correction', close: false, busy: true, onClick: async (api) => { if (!why.value.trim()) { err.textContent = 'Please say why you are correcting this.'; return false; } const r = await app.correctLog(log.id, { notes: notes.value, feedback: eff.value ? { ...(log.feedback || {}), effort: +eff.value } : null, durationSec: Math.round((+dur.value || 0) * 60) }, why.value.trim()); if (!r.ok) { err.textContent = r.error.message; return false; } toast('Correction saved'); api.close(); return false; } }] });
}

function bodyTab(app, ins, rr) {
  const latestM = app.latestMeasurements(); const types = MEASURE_TYPES.filter((t) => app.state.measurements.some((m) => m.type === t.id));
  if (!types.some((t) => t.id === measureType)) measureType = types[0]?.id || 'weight';
  const def = MEASURE_TYPES.find((t) => t.id === measureType); const pts = measureType === 'weight' ? app.weightSources().map((x) => ({ date: x.date, value: x.value })).reverse() : app.measurementSeries(measureType);
  const chart = lineChart(pts, { unit: def.unit, label: def.label }); const t = trend(pts);
  const kids = [types.length > 1 ? select(types.map((x) => [x.id, x.label]), measureType, { 'aria-label': 'Measurement', onchange: (e) => { measureType = e.target.value; rr(); } }) : null,
    card([h('div', { class: 'row between' }, h('h2', {}, def.label), btn('Add', () => app.router.navigate('/more/health'), { kind: 'text', sm: true })), chart || h('p', { class: 'muted' }, pts.length ? 'Add entries over two weeks or more to see a trend.' : 'No entries yet.'), h('p', { class: 'small muted', style: { marginTop: '8px' } }, measureType === 'weight' ? ins.weightText : describeTrend(t, def.unit, def.label.toLowerCase()))])];
  const rows = MEASURE_TYPES.filter((x) => latestM[x.id]).map((x) => item({ title: x.label, meta: `${latestM[x.id].value} ${x.unit} on ${prettyDate(latestM[x.id].date)}`, chev: false }));
  if (rows.length) kids.push(sectionTitle('Latest measurements'), list(rows));
  if (app.weightSources().some((x) => x.source.includes('Health Connect')) && app.weightSources().some((x) => !x.source.includes('Health Connect'))) kids.push(banner('Weights from BeFyn and from Health Connect are both shown. They are not merged, so you can see where each came from.', { kind: 'info' }));
  return h('div', { class: 'stack-lg' }, kids);
}

function nutrition(app) {
  const t = app.proteinTarget(); const histo = app.proteinHistory(14); const logged = histo.some((d) => d.count); const wk = app.proteinWeek();
  return h('div', { class: 'stack-lg' }, card([h('h2', {}, 'Protein, last 14 days'), logged ? barChart(histo.map((d) => ({ label: d.date.slice(8), value: Math.round(d.total) })), { label: 'Protein per day', unit: ' g', target: t || undefined }) : h('p', { class: 'muted' }, 'No protein logged yet.'), wk.daysLogged ? h('p', { class: 'small muted', style: { marginTop: '8px' } }, `Last 7 days: logged on ${wk.daysLogged} day${wk.daysLogged === 1 ? '' : 's'}, average ${wk.average} g${t ? `, target reached on ${wk.daysOnTarget}` : ''}. Values marked as estimates are approximate.`) : null]), btn('Log protein', () => app.router.navigate('/more/nutrition'), { block: true }));
}
