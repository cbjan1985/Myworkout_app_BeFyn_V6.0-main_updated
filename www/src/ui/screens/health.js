import { h } from '../dom.js';
import { openSheet, toast, confirmDialog } from '../dom.js';
import { btn, iconBtn, card, pill, list, item, sectionTitle, empty, banner, field, input, select, stepper, toggle, progressBar, chips, segmented, metric } from '../components.js';
import { icon } from '../icons.js';
import { barChart } from '../charts.js';
import { prettyDate, DOW_SHORT } from '../../core/util.js';
import { MEASURE_TYPES } from '../../services/tracking.js';
import { MEALS, QUICK_FOODS } from '../../domain/nutrition.js';
import { HEALTH_TYPES, availabilityMessage, labelOf, dailySummary, latest, averageHeartRate } from '../../platform/health.js';
import { REMINDER_KINDS, MAX_PER_DAY } from '../../platform/notifications.js';
import { DISCLAIMER } from '../../domain/insights.js';

const NOT_MEDICAL = 'These are personal logs for your own tracking. BeFyn does not give medical advice. Talk to a health professional about anything that worries you.';

/* ------------------------------ Health Connect + body measurements ------------------------------ */
export async function health(app, ctx) {
  const rr = ctx.rerender; const st = await app.healthStatus(); const last = app.state.lastSync; const kids = [];
  const connected = st.availability === 'available' && st.granted.length > 0;
  const hcCard = [h('div', { class: 'row between' }, h('h2', {}, 'Health Connect'), pill(connected ? 'Connected' : st.availability === 'available' ? 'Not connected' : 'Unavailable', connected ? 'ok' : 'warn'))];
  if (st.availability !== 'available') {
    hcCard.push(h('p', { class: 'muted', style: { marginTop: '6px' } }, availabilityMessage(st.availability)), st.availability === 'update_required' || st.availability === 'not_installed' ? btn('Open Health Connect settings', () => app.platform.health.openSettings(), { kind: 'secondary', sm: true }) : null);
  } else {
    hcCard.push(h('p', { class: 'muted', style: { margin: '6px 0 10px' } }, 'Read-only. BeFyn reads data your fitness apps and watch already store in Health Connect. It never writes to it and never uploads it.'));
    if (!connected) hcCard.push(btn('Choose data to connect', () => connectSheet(app, st, rr), { block: true }));
    else hcCard.push(h('p', { class: 'small' }, `Allowed: ${st.granted.map(labelOf).join(', ')}.`), h('div', { class: 'row', style: { marginTop: '10px' } }, btn('Sync now', async (e) => { e.currentTarget.setAttribute('aria-busy', 'true'); const r = await app.syncHealth({ days: 30 }); toast(r.ok ? `Synced: ${r.added} new, ${r.updated} updated` : r.message); rr(); }, { sm: true, icon: 'sync' }), btn('Change data', () => connectSheet(app, st, rr), { kind: 'secondary', sm: true })), last ? h('p', { class: 'small muted', style: { marginTop: '8px' } }, `Last synced ${new Date(last.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}${last.errors?.length ? `. Some data could not be read: ${last.errors.join('; ')}` : ''}`) : h('p', { class: 'small muted', style: { marginTop: '8px' } }, 'Not synced yet.'));
  }
  kids.push(card(hcCard));

  const hs = app.state.health;
  if (hs.length) {
    const steps = dailySummary(hs, 'steps').slice(-7); const hr = averageHeartRate(hs, app.today()); const w = latest(hs, 'weight'); const sl = latest(hs, 'sleep'); const cal = dailySummary(hs, 'activeCalories').slice(-1)[0];
    kids.push(sectionTitle('From Health Connect'), card([h('div', { class: 'metrics' }, steps.length ? metric(Math.round(steps[steps.length - 1].value).toLocaleString(), `Steps ${steps[steps.length - 1].date === app.today() ? 'today' : prettyDate(steps[steps.length - 1].date)}`) : null, cal ? metric(Math.round(cal.value), 'Active kcal') : null, hr ? metric(hr, 'Avg heart rate today', 'bpm') : null, sl ? metric(Math.round(sl.value * 10) / 10, 'Last sleep', 'h') : null, w ? metric(Math.round(w.value * 10) / 10, `Weight (${w.source})`, 'kg') : null), steps.length >= 2 ? barChart(steps.map((d) => ({ label: d.date.slice(8), value: Math.round(d.value) })), { label: 'Steps per day', unit: ' steps' }) : null, steps.some((d) => d.otherSources.length) ? h('p', { class: 'small muted' }, 'When two apps record the same thing, BeFyn uses the one with the larger total for that day so nothing is counted twice.') : null]));
    kids.push(btn('Remove synced health data from BeFyn', async () => { if (await confirmDialog({ title: 'Remove synced data?', message: 'This deletes the copy BeFyn holds. Your data in Health Connect is not affected.', confirmLabel: 'Remove', danger: true })) { await app.disconnectHealthData(); toast('Synced data removed'); } }, { kind: 'text', block: true }));
  }

  const m = app.latestMeasurements();
  kids.push(sectionTitle('Body measurements', btn('Add', () => measureSheet(app, rr), { kind: 'text', sm: true, icon: 'plus' })));
  const rows = MEASURE_TYPES.filter((t) => m[t.id]).map((t) => item({ title: t.label, meta: `${m[t.id].value} ${t.unit} \u00b7 ${prettyDate(m[t.id].date)}${m[t.id].source !== 'manual' ? ' \u00b7 ' + m[t.id].provenance : ''}`, chev: false }));
  kids.push(rows.length ? list(rows) : card(h('p', { class: 'muted' }, 'No measurements yet. Add your weight to see a trend over time.')));
  if (app.state.measurements.length) kids.push(sectionTitle('History'), list(app.state.measurements.slice(0, 12).map((r) => item({ title: `${MEASURE_TYPES.find((t) => t.id === r.type)?.label || r.type}: ${r.value} ${r.unit}`, meta: prettyDate(r.date, true) + (r.notes ? ` \u00b7 ${r.notes}` : ''), chev: false, trailing: iconBtn('trash', 'Delete this entry', async () => { if (await confirmDialog({ title: 'Delete entry?', message: 'This removes the measurement.', confirmLabel: 'Delete', danger: true })) { await app.deleteMeasurement(r.id); toast('Entry deleted'); } }) }))));
  kids.push(app.legacyVaultPresent() && !app.state.measurements.some((x) => x.id?.startsWith('meas-v5-')) ? banner(['Your V5.0 protected health records are still locked. ', btn('Import them', () => vaultSheet(app, rr), { kind: 'text', sm: true })], { kind: 'info', icon: 'lock' }) : null);
  kids.push(h('p', { class: 'small muted' }, NOT_MEDICAL));
  return { title: 'Health', content: h('div', { class: 'stack-lg' }, kids) };
}

function connectSheet(app, st, rr) {
  const sel = new Set(st.granted.length ? st.granted : HEALTH_TYPES.map((t) => t.id)); const row = h('div', { class: 'stack' });
  const draw = () => row.replaceChildren(...HEALTH_TYPES.map((t) => h('label', { class: 'row between', style: { minHeight: '48px' } }, h('span', {}, h('span', { class: 'strong' }, t.label), h('span', { class: 'small muted', style: { display: 'block' } }, WHY[t.id])), toggle(sel.has(t.id), (v) => { v ? sel.add(t.id) : sel.delete(t.id); }, t.label))));
  draw();
  const sheet = openSheet({ title: 'Choose what to connect', content: h('div', { class: 'stack' }, h('p', { class: 'muted' }, 'BeFyn asks Android for read access to only what you turn on. You can change this any time, and BeFyn works fully without it.'), row), actions: [{ label: 'Cancel', kind: 'secondary' }, { label: 'Continue', close: false, busy: true, onClick: async (api) => { if (!sel.size) { toast('Turn on at least one type.'); return false; } const r = await app.connectHealth([...sel]); if (!r.ok) { toast(r.message); return false; } api.close(); const s = await app.syncHealth({ types: r.granted, days: 30 }); toast(s.ok ? `Connected. ${s.added} records synced.` : s.message || 'Permission was not granted.'); rr(); return false; } }] });
}
const WHY = { steps: 'Daily activity on Progress and Today', activeCalories: 'Daily activity context', heartRate: 'Resting and workout context', sleep: 'Used for the recovery guide', exercise: 'Sessions from your watch or other apps', weight: 'Shown beside your own entries', bodyFat: 'Body composition trend', height: 'Reference only' };

export function measureSheet(app, rr) {
  const type = select(MEASURE_TYPES.map((t) => [t.id, `${t.label} (${t.unit})`]), 'weight'), val = input({ type: 'number', inputmode: 'decimal', step: '0.1', min: '0' }), date = input({ type: 'date', value: app.today(), max: app.today() }), note = input({ placeholder: 'Optional', maxlength: 80 }); const err = h('div', { class: 'err', role: 'alert' });
  openSheet({ title: 'Add a measurement', content: h('div', { class: 'stack' }, field('What', type), field('Value', val), field('Date', date), field('Note', note), err, h('p', { class: 'small muted' }, NOT_MEDICAL)), actions: [{ label: 'Cancel', kind: 'secondary' }, { label: 'Save', close: false, busy: true, onClick: async (api) => { const r = await app.addMeasurement({ type: type.value, value: val.value, date: date.value, notes: note.value }); if (!r.ok) { err.textContent = r.error.message; return false; } toast('Saved'); api.close(); return false; } }] });
}
function vaultSheet(app, rr) {
  const pw = input({ type: 'password', autocomplete: 'current-password' }); const err = h('div', { class: 'err', role: 'alert' });
  openSheet({ title: 'Import V5.0 health records', content: h('div', { class: 'stack' }, h('p', {}, 'Enter the password you used for the protected health tracker in V5.0. BeFyn decrypts the records on this phone and saves them as measurements. The old encrypted copy stays untouched.'), field('V5.0 health password', pw, { hint: 'If you never changed it, it may still be the initial V5.0 password.' }), err), actions: [{ label: 'Cancel', kind: 'secondary' }, { label: 'Import', close: false, busy: true, onClick: async (api) => { const r = await app.importLegacyVault(pw.value); if (!r.ok) { err.textContent = r.error.message; return false; } toast(`${r.count} measurements imported`); api.close(); return false; } }] });
}
export { vaultSheet };

/* ------------------------------ nutrition ------------------------------ */
export async function nutrition(app, ctx) {
  const t = app.proteinTarget(); const d = app.proteinDay(); const kids = [];
  kids.push(card([h('div', { class: 'row between' }, h('h2', {}, 'Today'), h('span', { class: 'num strong' }, `${d.total}${t ? ` / ${t}` : ''} g`)), t ? progressBar(d.pct, 'Protein progress today') : null, h('p', { class: 'small muted', style: { marginTop: '8px' } }, t ? (d.reached ? 'You reached your protein target today.' : `${d.remaining} g to go.`) : 'Set a daily target to see progress.'), d.estimated ? h('p', { class: 'small muted' }, `${d.estimated} g of today's total is estimated.`) : null, h('div', { class: 'row', style: { marginTop: '10px' } }, btn('Add protein', () => addProteinSheet(app), { icon: 'plus', block: true }), btn('Target', () => targetSheet(app), { kind: 'secondary' }))]));
  const entries = app.state.nutrition.filter((e) => e.date === app.today()).sort((a, b) => (a.recordedAt < b.recordedAt ? 1 : -1));
  kids.push(sectionTitle('Logged today'));
  kids.push(entries.length ? list(entries.map((e) => item({ title: e.item, meta: `${e.meal} \u00b7 ${e.proteinG} g${e.estimate ? ' (estimate)' : ''}`, chev: false, trailing: iconBtn('trash', `Delete ${e.item}`, async () => { await app.removeProtein(e.id); toast('Entry removed'); }) }))) : card(h('p', { class: 'muted' }, 'Nothing logged yet today.')));
  const hist = app.proteinHistory(7); if (hist.some((x) => x.count)) kids.push(sectionTitle('Last 7 days'), card(barChart(hist.map((x) => ({ label: x.date.slice(8), value: Math.round(x.total) })), { label: 'Protein per day', unit: ' g', target: t || undefined })));
  kids.push(h('p', { class: 'small muted' }, 'Common-food amounts are rough starting points and are labelled as estimates. Enter exact values from a label when you have them.'));
  return { title: 'Protein', content: h('div', { class: 'stack-lg' }, kids) };
}
function addProteinSheet(app) {
  const item_ = input({ placeholder: 'What did you eat?', maxlength: 60 }), g = input({ type: 'number', inputmode: 'decimal', min: '1', max: '300', placeholder: 'grams of protein' }), meal = select(MEALS.map((m) => [m, m]), 'Snack'); const est = { v: true }; const err = h('div', { class: 'err', role: 'alert' });
  const estSw = toggle(true, (v) => { est.v = v; }, 'This is an estimate');
  openSheet({ title: 'Add protein', content: h('div', { class: 'stack' }, h('div', { class: 'chips', role: 'group', 'aria-label': 'Common foods' }, QUICK_FOODS.map((f) => h('button', { class: 'chip', type: 'button', onclick: () => { item_.value = f.name; g.value = f.proteinG; estSw.querySelector('input').checked = true; est.v = true; } }, f.name))), field('Food', item_), field('Protein (g)', g), field('Meal', meal), h('label', { class: 'row between' }, h('span', {}, h('span', { class: 'strong' }, 'This is an estimate'), h('span', { class: 'small muted', style: { display: 'block' } }, 'Turn off if you read it from a label or scale.')), estSw), err), actions: [{ label: 'Cancel', kind: 'secondary' }, { label: 'Add', close: false, busy: true, onClick: async (api) => { const r = await app.addProtein({ item: item_.value, proteinG: g.value, meal: meal.value, estimate: est.v }); if (!r.ok) { err.textContent = r.error.message; return false; } toast('Added'); api.close(); return false; } }] });
}
function targetSheet(app) {
  const s = stepper({ value: app.proteinTarget() || 120, min: 0, max: 500, step: 5, label: 'Daily protein target in grams' }); const err = h('div', { class: 'err', role: 'alert' });
  openSheet({ title: 'Daily protein target', content: h('div', { class: 'stack' }, field('Grams per day', s, { hint: 'Choose a target that suits you. If you are unsure, ask a dietitian or doctor.' }), err), actions: [{ label: 'Cancel', kind: 'secondary' }, { label: 'Save', close: false, onClick: async (api) => { const r = await app.setProteinTarget(s.get()); if (!r.ok) { err.textContent = r.error.message; return false; } api.close(); return false; } }] });
}

/* ------------------------------ recovery ------------------------------ */
export async function recovery(app) {
  const ins = app.insights(); const r = ins.readiness; const kids = [];
  kids.push(card([h('div', { class: 'row between' }, h('h2', {}, r.headline), r.level !== 'unknown' ? pill(r.level === 'good' ? 'Ready' : r.level === 'moderate' ? 'Steady' : 'Take care', r.level === 'good' ? 'ok' : r.level === 'moderate' ? 'acc' : 'warn') : null), r.basis.length ? h('ul', { style: { margin: '10px 0 0', paddingLeft: '20px' } }, r.basis.map((b) => h('li', {}, b))) : null, r.missing.length ? h('div', { style: { marginTop: '10px' } }, h('div', { class: 'small strong' }, 'Not used (no data):'), h('ul', { class: 'small muted', style: { margin: '4px 0 0', paddingLeft: '20px' } }, r.missing.map((b) => h('li', {}, b)))) : null, h('p', { class: 'small muted', style: { marginTop: '10px' } }, r.note)]));
  const l = ins.load; kids.push(sectionTitle('Training load'), card(h('div', { class: 'stack' }, h('div', { class: 'metrics' }, metric(l.sessions7, 'Sessions, last 7 days'), metric(l.sessions28, 'Sessions, last 28 days'), l.ratio != null ? metric(l.ratio, 'This week vs your average') : null), h('p', { class: 'small muted' }, l.sessions28 < 6 ? 'Load trends need a few more weeks of sessions.' : l.ratio > 1.5 ? 'This week is much heavier than your recent average. Listen to how you feel.' : l.ratio < 0.6 ? 'This week is lighter than your recent average.' : 'This week is in line with your recent average.'), l.estimatedShare > 0 ? h('p', { class: 'small muted' }, `Load is estimated for ${Math.round(l.estimatedShare * 100)}% of sessions because no effort rating was given. Rating how hard sessions felt makes this more accurate.`) : null)));
  kids.push(h('p', { class: 'small muted' }, DISCLAIMER));
  return { title: 'Recovery', content: h('div', { class: 'stack-lg' }, kids) };
}

/* ------------------------------ reminders ------------------------------ */
export async function reminders(app, ctx) {
  const rr = ctx.rerender; const perm = await app.platform.notifications.permission(); const rs = app.state.reminders; const kids = [];
  if (perm === 'unsupported') kids.push(banner('Reminders need the Android app. In a browser they are saved but not delivered.', { kind: 'info' }));
  else if (perm !== 'granted') kids.push(banner([h('strong', {}, 'Notifications are off. '), 'Allow them so reminders can reach you. BeFyn works without them.', h('div', { style: { marginTop: '8px' } }, btn('Allow notifications', async () => { const p = await app.enableReminders(); toast(p === 'granted' ? 'Notifications allowed' : 'Notifications were not allowed'); await app.applyReminders(); rr(); }, { sm: true }))]));
  const warn = app.platform.notifications.validate(rs); warn.forEach((w) => kids.push(banner(w, { icon: 'bell' })));
  kids.push(rs.length ? list(rs.sort((a, b) => a.time.localeCompare(b.time)).map((r) => item({ title: `${r.time} \u00b7 ${r.title || REMINDER_KINDS[r.kind]?.label}`, meta: r.days?.length ? r.days.map((d) => DOW_SHORT[d]).join(', ') : 'Every day', chev: true, onClick: () => reminderSheet(app, r), trailing: toggle(r.enabled, async (v) => { await app.saveReminder({ ...r, enabled: v }); }, `Reminder at ${r.time}`) }))) : empty({ icon: 'bell', title: 'No reminders yet', text: 'Add a gentle nudge at the time you usually train. Reminders never use guilt.', action: btn('Add a reminder', () => reminderSheet(app, null)) }));
  if (rs.length) kids.push(btn('Add a reminder', () => reminderSheet(app, null), { kind: 'secondary', block: true, icon: 'plus' }));
  kids.push(h('p', { class: 'small muted' }, `Reminders repeat weekly and are delivered even when the phone is idle. Messages are general, so they do not reveal your session names. More than ${MAX_PER_DAY} a day is flagged as too many.`));
  return { title: 'Reminders', content: h('div', { class: 'stack-lg' }, kids) };
}
function reminderSheet(app, r) {
  const e = r || { kind: 'workout', time: '07:30', days: [], title: '', enabled: true }; const kind = select(Object.entries(REMINDER_KINDS).map(([k, v]) => [k, v.label]), e.kind), time = input({ type: 'time', value: e.time }), title = input({ value: e.title || '', placeholder: 'Optional custom title', maxlength: 40 }); const days = new Set(e.days || []); const row = h('div', { class: 'chips', role: 'group', 'aria-label': 'Days' });
  const draw = () => row.replaceChildren(...[1, 2, 3, 4, 5, 6, 0].map((d) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(days.has(d)), onclick: () => { days.has(d) ? days.delete(d) : days.add(d); draw(); } }, DOW_SHORT[d]))); draw(); const err = h('div', { class: 'err', role: 'alert' });
  openSheet({ title: r ? 'Edit reminder' : 'New reminder', content: h('div', { class: 'stack' }, field('Type', kind), field('Time', time), h('div', {}, h('div', { class: 'label strong small', style: { marginBottom: '6px' } }, 'Days'), row, h('p', { class: 'small muted', style: { marginTop: '4px' } }, 'None selected means every day.')), field('Title', title), err), actions: [r && { label: 'Delete', kind: 'secondary', close: false, onClick: async (api) => { await app.deleteReminder(r.id); api.close(); return false; } }, { label: 'Save', close: false, busy: true, onClick: async (api) => { const res = await app.saveReminder({ ...(r ? { id: r.id } : {}), kind: kind.value, time: time.value, title: title.value, days: [...days], enabled: e.enabled }); if (!res.ok) { err.textContent = res.error.message; return false; } toast('Reminder saved'); api.close(); return false; } }].filter(Boolean) });
}
