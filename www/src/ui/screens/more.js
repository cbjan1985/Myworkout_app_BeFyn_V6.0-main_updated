import { h } from '../dom.js';
import { openSheet, toast, confirmDialog } from '../dom.js';
import { btn, card, pill, list, item, sectionTitle, banner, field, input, select, stepper, toggle, segmented } from '../components.js';
import { applyTheme } from '../theme.js';
import { vaultSheet } from './health.js';
import { APP_VERSION } from '../../data/backup.js';
import { prettyDate } from '../../core/util.js';

export async function more(app, ctx) {
  const missed = app.scheduleStatus()?.missed.length;
  const g = (title, rows) => [sectionTitle(title), list(rows)];
  return { title: 'More', content: h('div', { class: 'stack' }, [
    ...g('Health and recovery', [item({ title: 'Health Connect and body', meta: 'Steps, sleep, heart rate, weight, measurements', lead: 'heart', href: '#/more/health' }), item({ title: 'Protein', meta: 'Daily target and what you ate', lead: 'food', href: '#/more/nutrition' }), item({ title: 'Recovery', meta: 'Readiness and training load', lead: 'moon', href: '#/more/recovery' })]),
    ...g('Reminders and guidance', [item({ title: 'Reminders', meta: 'Gentle nudges at times you choose', lead: 'bell', href: '#/more/reminders' }), item({ title: 'Voice and workout preferences', meta: 'Voice guidance, rest times, breathing, theme', lead: 'voice', href: '#/more/preferences' })]),
    ...g('Your data', [item({ title: 'Backup, restore and export', meta: 'Keep a copy of everything, move to a new phone', lead: 'data', href: '#/more/data' }), item({ title: 'Privacy, about and help', meta: `BeFyn ${APP_VERSION}`, lead: 'info', href: '#/more/about' })]),
  ]) };
}

/* ------------------------------ preferences ------------------------------ */
export async function preferences(app, ctx) {
  const rr = ctx.rerender; const p = app.state.prefs; const w = p.workout; const br = p.breathing || { i: 4, h: 0, o: 6, h2: 0 };
  const upd = (patch) => app.updatePref('workout', patch);
  const folders = await app.repos.prefs.get('mediaFolder', null);
  const mediaRow = h('div', { class: 'stack' });
  const mstat = h('p', { class: 'small muted' }, folders ? `Folder: ${folders}` : 'No folder chosen.');
  return { title: 'Preferences', live: false, content: h('div', { class: 'stack-lg' }, [
    card(h('div', { class: 'stack' }, h('label', { class: 'row between' }, h('span', {}, h('span', { class: 'strong' }, 'Voice guidance'), h('span', { class: 'small muted', style: { display: 'block' } }, 'Speaks exercise names, rest and countdowns')), toggle(p.voice?.enabled !== false, (v) => app.updatePref('voice', { enabled: v }), 'Voice guidance')), btn('Test voice', () => app.platform.voice.speak('BeFyn voice guidance is on', { enabled: true }), { kind: 'secondary', sm: true }))),
    sectionTitle('Rest and transitions'),
    card(h('div', { class: 'stack' }, field('Rest between sets (seconds)', stepper({ value: w.restSec, min: 0, max: 300, step: 5, label: 'Rest between sets', onChange: (v) => upd({ restSec: v }) }), { hint: 'Used when a programme does not set its own rest' }), field('Break between exercises (seconds)', stepper({ value: w.breakSec, min: 0, max: 300, step: 5, label: 'Break', onChange: (v) => upd({ breakSec: v }) })), field('Transition preview (seconds)', stepper({ value: w.transitionSec, min: 0, max: 60, step: 5, label: 'Transition', onChange: (v) => upd({ transitionSec: v }) })))),
    sectionTitle('Breathing guidance'),
    card(h('div', { class: 'stack' }, h('div', { class: 'row' }, ...[['i', 'In'], ['h', 'Hold'], ['o', 'Out'], ['h2', 'Hold']].map(([k, l]) => h('div', { class: 'grow' }, field(l, stepper({ value: br[k] || 0, min: 0, max: 20, label: `${l} seconds`, onChange: (v) => app.setPref('breathing', { ...(app.state.prefs.breathing || br), [k]: v }) }))))), h('p', { class: 'small muted' }, 'Seconds for each part of a breath. Used for breathing exercises without their own timing.'))),
    sectionTitle('Appearance'),
    card(segmented([['system', 'System'], ['light', 'Light'], ['dark', 'Dark']], p.theme?.mode || 'system', async (v) => { await app.setPref('theme', { mode: v }); applyTheme(app); rr(); }, 'Theme')),
    sectionTitle('Exercise media folder'),
    card(h('div', { class: 'stack' }, h('p', { class: 'small muted' }, 'Choose a folder of GIFs or videos named after exercises, for example goblet_squat.gif. BeFyn shows them during workouts.'), mstat, h('div', { class: 'row' }, btn('Pick folder', async () => { const r = await app.platform.media.pickFolder(); if (!r.ok) return r.cancelled ? null : toast(r.message); await app.repos.prefs.set('mediaFolder', r.path); mstat.textContent = `Folder: ${r.path}`; const s = await app.platform.media.syncFolder({ path: r.path }); toast(s.ok ? `${s.count} media files found` : s.message); if (s.needAccess) app.platform.media.requestAccess(); }, { kind: 'secondary', sm: true, icon: 'folder' }), btn('Rescan', async () => { const s = await app.platform.media.syncFolder(folders ? { path: folders } : {}); toast(s.ok ? `${s.count} media files found` : s.message); if (s.needAccess) app.platform.media.requestAccess(); }, { kind: 'secondary', sm: true, icon: 'refresh' })))),
  ]) };
}

/* ------------------------------ data ------------------------------ */
export async function data(app, ctx) {
  const rr = ctx.rerender; const last = await app.lastBackup(); const mig = app.state.migration; const hasPre = !!(await app.migrationBackup());
  const kids = [
    card([h('h2', {}, 'Backup'), h('p', { class: 'muted', style: { margin: '4px 0 10px' } }, last ? `Last backup ${new Date(last.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} (${last.where}).` : 'You have not made a backup yet. A backup is one file with everything: programmes, history, measurements and settings.'), h('div', { class: 'stack' }, btn('Save a backup', async () => { const r = await app.exportBackupFile({ share: false }); toast(r.ok ? `Saved to ${r.where}` : r.message); rr(); }, { block: true, icon: 'download' }), btn('Save and share', async () => { const r = await app.exportBackupFile({ share: true }); toast(r.ok ? 'Backup ready' : r.message); rr(); }, { kind: 'secondary', block: true, icon: 'share' }))]),
    card([h('h2', {}, 'Restore'), h('p', { class: 'muted', style: { margin: '4px 0 10px' } }, 'Choose a BeFyn backup file. BeFyn checks it first and keeps a safety copy of your current data.'), btn('Restore from a file', () => restoreSheet(app, rr), { kind: 'secondary', block: true, icon: 'upload' })]),
    sectionTitle('Export'),
    list([item({ title: 'Workout history (CSV)', meta: 'Every set you logged, for a spreadsheet', lead: 'list', onClick: async () => { const r = await app.exportHistoryCsv(); toast(r.ok ? `Saved to ${r.where}` : r.message); } }), app.state.programme && item({ title: 'Current programme (Excel)', meta: 'Edit in Excel and import it back', lead: 'download', onClick: async () => { const t = app.state.programme.template; const r = await app.exportProgrammeSpreadsheet(t.id, t.version, { share: true }); toast(r.ok ? `Saved to ${r.where}` : (r.error?.message || r.message)); } })]),
  ];
  if (mig && mig.status === 'done' && !mig.report?.fresh) {
    kids.push(sectionTitle('From V5.0'));
    kids.push(card([h('p', { class: 'small' }, `Upgraded ${new Date(mig.at).toLocaleDateString()}: ${mig.report.sessionLogs} workouts, ${mig.report.sets} sets, ${mig.report.savedWorkouts} saved workouts.`), mig.warnings?.length ? h('p', { class: 'small muted' }, mig.warnings.join(' ')) : null, h('div', { class: 'stack', style: { marginTop: '8px' } }, hasPre ? btn('Save a copy of the pre-upgrade backup', async () => { const r = await app.saveMigrationBackup(); toast(r.ok ? `Saved to ${r.where}` : r.error?.message || r.message); }, { kind: 'secondary', sm: true }) : null, app.legacyVaultPresent() ? btn('Import V5.0 protected health records', () => vaultSheet(app, rr), { kind: 'secondary', sm: true, icon: 'lock' }) : null, app.legacyVaultPresent() && !!app.state.measurements.some((m) => m.id?.startsWith('meas-v5-')) ? btn('Remove the old encrypted health copy', async () => { if (await confirmDialog({ title: 'Remove the old copy?', message: 'Your health records were imported into BeFyn. This deletes only the old encrypted V5.0 copy.', confirmLabel: 'Remove', danger: true })) { const r = await app.discardLegacyVault(); toast(r.ok ? 'Old copy removed' : r.error.message); rr(); } }, { kind: 'text', sm: true }) : null)]));
  }
  kids.push(sectionTitle('Danger zone'), card([h('p', { class: 'muted' }, 'Erases programmes, history, measurements and settings from BeFyn on this phone. Save a backup first.'), btn('Erase all BeFyn data', () => eraseSheet(app), { kind: 'danger', block: true })]));
  return { title: 'Backup and export', content: h('div', { class: 'stack-lg' }, kids) };
}
async function restoreSheet(app, rr) {
  const f = await app.platform.files.pickFile('.json,application/json'); if (!f) return;
  let text; try { text = await app.platform.files.readText(f); } catch (_) { return toast('That file could not be read.'); }
  const mode = { v: 'merge' };
  const area = h('div', { class: 'stack' }); const draw = () => area.replaceChildren(h('p', {}, `Restoring "${f.name}".`), h('div', { class: 'seg', role: 'group', 'aria-label': 'Restore mode' }, [['merge', 'Add what is missing'], ['replace', 'Replace everything']].map(([v, l]) => h('button', { type: 'button', 'aria-pressed': String(mode.v === v), onclick: () => { mode.v = v; draw(); } }, l))), h('p', { class: 'small muted' }, mode.v === 'merge' ? 'Keeps everything you have now and adds records from the file. Existing workout logs are never overwritten.' : 'Makes BeFyn match the file. A safety copy of your current data is kept first.')); draw();
  openSheet({ title: 'Restore backup', content: area, actions: [{ label: 'Cancel', kind: 'secondary' }, { label: 'Restore', close: false, busy: true, onClick: async (api) => { const r = await app.restoreBackupText(text, mode.v); if (!r.ok) { toast(r.error.message); return false; } toast(`Restored: ${r.added} records added${r.skipped ? `, ${r.skipped} already present` : ''}`); api.close(); return false; } }] });
}
function eraseSheet(app) {
  const t = input({ placeholder: 'Type ERASE', autocomplete: 'off', autocapitalize: 'characters' }); const err = h('div', { class: 'err', role: 'alert' });
  openSheet({ title: 'Erase everything?', center: true, content: h('div', { class: 'stack' }, h('p', {}, 'This removes all BeFyn data on this phone and cannot be undone. Health Connect data is not affected.'), field('Type ERASE to confirm', t), err), actions: [{ label: 'Cancel', kind: 'secondary' }, { label: 'Erase', kind: 'danger', close: false, onClick: async (api) => { const r = await app.eraseEverything({ confirm: t.value.trim() }); if (!r.ok) { err.textContent = r.error.message; return false; } api.close(); toast('All data erased'); app.router.navigate('/today'); return false; } }] });
}

/* ------------------------------ about / privacy ------------------------------ */
export async function about(app) {
  const rows = (items) => h('ul', { style: { margin: '6px 0 0', paddingLeft: '20px' } }, items.map((x) => h('li', { style: { marginBottom: '4px' } }, x)));
  return { title: 'Privacy and about', content: h('div', { class: 'stack-lg' }, [
    card([h('h2', {}, `BeFyn ${APP_VERSION}`), h('p', { class: 'muted' }, 'A personal fitness and wellness companion. Designed by CB.')]),
    card([h('h2', {}, 'Your data stays with you'), rows(['Everything is stored on this phone. There is no account, no cloud sync and no analytics.', 'Health Connect data is read-only and only for types you allow. BeFyn never writes to it.', 'Backups are plain files you create and keep. Share them only with people you trust.', 'Reminders are local notifications and contain general wording only.'])]),
    card([h('h2', {}, 'Good to know'), rows(['Recovery guidance, estimated maximums and trends are general information from your own logs, not medical advice.', 'Check with a health professional before starting a new programme, especially if you have a health condition or injury.', 'Missed sessions never change your programme on their own.'])]),
    card([h('h2', {}, 'Permissions'), rows(['Health Connect read access: only what you turn on in More > Health.', 'Notifications: only if you add reminders.', 'Media folder access: only if you choose an exercise media folder.'])]),
    card([h('h2', {}, 'Open-source'), h('p', { class: 'small muted' }, 'Built with Capacitor (MIT) and SheetJS Community Edition (Apache 2.0) for spreadsheets.')]),
  ]) };
}
