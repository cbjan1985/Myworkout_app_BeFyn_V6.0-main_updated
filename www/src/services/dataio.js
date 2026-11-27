// Backup/restore, spreadsheets, CSV and the legacy V5 health vault.
import { ok, fail, todayIso } from '../core/util.js';
import { exportBackup, importBackup, safeParse } from '../data/backup.js';
import { encryptBackup, decryptBackup, isEncrypted } from '../data/backup-crypto.js';
import { decryptLegacyVault, mapLegacyHealth, LEGACY } from '../data/migration.js';
import { HEADERS } from '../data/spreadsheet.js';

export function installDataIO(app) {
  const { repos } = app; const P = () => app.platform;

  app.exportBackupFile = async ({ share = false, password = '' } = {}) => {
    const b = await exportBackup(repos);
    let payload = JSON.stringify(b);
    if (password) { try { payload = JSON.stringify(await encryptBackup(payload, password, P().subtle)); } catch (e) { return fail('encrypt', String((e && e.message) || e)); } }
    const r = await P().files.saveText(`FiT85-backup-${todayIso()}${password ? '-protected' : ''}.json`, payload, { share });
    if (r.ok) await repos.meta.set('backup.lastExport', { at: new Date().toISOString(), where: r.where });
    return r;
  };
  app.backupNeedsPassword = (text) => { try { return isEncrypted(safeParse(text)); } catch (_) { return false; } };
  app.restoreBackupText = async (text, mode = 'merge', password = '') => {
    if (text.length > 60 * 1024 * 1024) return fail('invalid-backup', 'That file is too large to be a FiT85 backup.');
    let b; try { b = safeParse(text); } catch (_) { return fail('invalid-backup', 'That file could not be read as a FiT85 backup.'); }
    if (isEncrypted(b)) {
      if (!password) return fail('needs-password', 'This backup is password protected. Enter its password.');
      try { b = safeParse(await decryptBackup(b, password, P().subtle)); } catch (e) { return fail(e.message === 'wrong-password' ? 'wrong-password' : 'invalid-backup', e.message === 'wrong-password' ? 'That password did not open the backup, or the file was changed.' : e.message); }
    }
    const r = await importBackup(repos, b, { mode }); if (r.ok) await app.refresh(); return r;
  };
  app.lastBackup = () => repos.meta.get('backup.lastExport');

  app.exportProgrammeSpreadsheet = async (id, version, { share = false } = {}) => {
    const rows = app.programmeRows(id, version); if (!rows) return fail('not-found', 'Programme not found.');
    try {
      const X = await P().files.loadXlsx(); const wb = X.utils.book_new();
      X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(rows), 'Programme');
      X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([['How to edit'], ['One row per exercise. Week and Session group rows into sessions.'], ['Section: Warm-up, Main, Flow, Breathing or Cool-down.'], ['Block: leave empty for straight sets, or superset / triset / dropset with Rounds.']]), 'Instructions');
      const b64 = X.write(wb, { bookType: 'xlsx', type: 'base64' });
      return P().files.saveBase64(`FiT85-programme-${todayIso()}.xlsx`, b64, { share });
    } catch (e) { return fail('xlsx', String((e && e.message) || e)); }
  };
  app.exportBlankSpreadsheet = async ({ share = false } = {}) => {
    try {
      const X = await P().files.loadXlsx(); const wb = X.utils.book_new();
      const rows = [HEADERS, [1, 'Monday', 'Upper body A', 'Warm-up', 'Arm Circles', 1, 10, '', '', '', '', '', ''], [1, 'Monday', 'Upper body A', 'Main', 'Goblet Squat', 3, 10, '', 60, '5 kg', '', '', ''], [1, 'Monday', 'Upper body A', 'Main', 'Dumbbell Curl', 1, 12, '', '', '3 kg', 'superset', 3, 'Pair with the next row'], [1, 'Monday', 'Upper body A', 'Main', 'Overhead Press', 1, 12, '', 60, '3 kg', 'superset', 3, ''], [1, 'Monday', 'Upper body A', 'Cool-down', 'Chest Stretch', 1, '', 30, '', '', '', '', '']];
      X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(rows), 'Programme');
      X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([['How to fill this in'], ['One row per exercise. Rows with the same Week, Day and Session form one session.'], ['Section: Warm-up, Main, Flow, Breathing or Cool-down.'], ['Block: leave empty for straight sets, or superset / triset / dropset with Rounds. Put the exercises of one block on consecutive rows.'], ['Exercise names that are not in your catalogue are added automatically.']]), 'Instructions');
      return P().files.saveBase64(`FiT85-programme-template.xlsx`, X.write(wb, { bookType: 'xlsx', type: 'base64' }), { share });
    } catch (e) { return fail('xlsx', String((e && e.message) || e)); }
  };
  app.importProgrammeSpreadsheet = async (file, name) => {
    if (file.size > 5 * 1024 * 1024) return fail('too-big', 'That spreadsheet is over 5 MB, which is far larger than a programme should be.');
    try {
      const X = await P().files.loadXlsx(); const buf = await P().files.readArrayBuffer(file);
      const wb = X.read(buf, { type: 'array', sheetRows: 20000, cellFormula: false, cellHTML: false, cellStyles: false, cellNF: false, bookVBA: false }); const rows = X.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
      return app.importRows(rows, { name: name || file.name.replace(/\.[^.]+$/, '') });
    } catch (e) { return fail('xlsx', 'That spreadsheet could not be read: ' + String((e && e.message) || e)); }
  };
  app.exportHistoryCsv = async () => {
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`; const lines = [['Date', 'Session', 'Exercise', 'Set', 'Reps', 'Weight kg', 'Seconds', 'Rest s'].join(',')];
    for (const l of app.state.logs) for (const p of l.performances || []) p.sets.forEach((s, i) => lines.push([l.date, l.name, p.name + (p.side ? ` (${p.side})` : ''), i + 1, s.reps, s.kg, s.secs, s.restSec].map(esc).join(',')));
    return P().files.saveText(`FiT85-history-${todayIso()}.csv`, lines.join('\n'), { mime: 'text/csv' });
  };

  /* ---------------- legacy protected health vault ---------------- */
  app.legacyVaultPresent = () => { try { return !!P().storage.getItem(LEGACY.vault); } catch (_) { return false; } };
  /** The person supplies their own V5 password; no default is assumed or stored. */
  app.importLegacyVault = async (password) => {
    let raw = null; try { raw = P().storage.getItem(LEGACY.vault); } catch (_) { /* unavailable */ }
    if (!raw) return fail('none', 'No V5.0 protected health records were found.');
    let data; try { data = await decryptLegacyVault(raw, password, P().subtle); } catch (_) { return fail('wrong-password', 'That password did not open the V5.0 records. Check it and try again.'); }
    const rows = mapLegacyHealth(data);
    await repos.write([...rows.map((r) => repos.measurements.op(r)), repos.meta.op('legacy.vaultImported', { at: new Date().toISOString(), count: rows.length })]);
    await app.refresh(); return ok({ count: rows.length });
  };
  /** Only on explicit request, and only after the records were imported. Never automatic. */
  app.discardLegacyVault = async () => {
    const imp = await repos.meta.get('legacy.vaultImported'); if (!imp) return fail('not-imported', 'Import the V5.0 records first so nothing is lost.');
    try { P().storage.removeItem(LEGACY.vault); } catch (_) { return fail('storage', 'The old records could not be removed.'); }
    return ok();
  };
  app.migrationBackup = async () => repos.meta.get('backup.pre-v6');
  app.saveMigrationBackup = async () => { const b = await app.migrationBackup(); if (!b) return fail('none', 'No upgrade backup exists.'); return P().files.saveText(`FiT85-pre-v6-backup-${todayIso()}.json`, JSON.stringify(b), {}); };

  /** Erases FiT85 data in the app. Requires the exact confirmation word and keeps nothing silently. */
  app.eraseEverything = async ({ confirm }) => {
    if (confirm !== 'ERASE') return fail('not-confirmed', 'Type ERASE to confirm.');
    const writes = []; for (const s of ['prefs', 'templates', 'exercises', 'workouts', 'instances', 'scheduled', 'changes', 'logs', 'measurements', 'health', 'nutrition', 'reminders']) writes.push({ op: 'clear', store: s });
    await repos.adapter.transact(writes); await app.refresh(); return ok();
  };
}
