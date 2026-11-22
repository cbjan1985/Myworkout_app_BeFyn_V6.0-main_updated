// Backup/restore, spreadsheets, CSV and the legacy V5 health vault.
import { ok, fail, todayIso } from '../core/util.js';
import { exportBackup, importBackup } from '../data/backup.js';
import { decryptLegacyVault, mapLegacyHealth, LEGACY } from '../data/migration.js';

export function installDataIO(app) {
  const { repos } = app; const P = () => app.platform;

  app.exportBackupFile = async ({ share = false } = {}) => {
    const b = await exportBackup(repos);
    const r = await P().files.saveText(`BeFyn-backup-${todayIso()}.json`, JSON.stringify(b), { share });
    if (r.ok) await repos.meta.set('backup.lastExport', { at: new Date().toISOString(), where: r.where });
    return r;
  };
  app.restoreBackupText = async (text, mode = 'merge') => {
    let b; try { b = JSON.parse(text); } catch (_) { return fail('invalid-backup', 'That file could not be read as a BeFyn backup.'); }
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
      return P().files.saveBase64(`BeFyn-programme-${todayIso()}.xlsx`, b64, { share });
    } catch (e) { return fail('xlsx', String((e && e.message) || e)); }
  };
  app.importProgrammeSpreadsheet = async (file, name) => {
    try {
      const X = await P().files.loadXlsx(); const buf = await P().files.readArrayBuffer(file);
      const wb = X.read(buf, { type: 'array' }); const rows = X.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
      return app.importRows(rows, { name: name || file.name.replace(/\.[^.]+$/, '') });
    } catch (e) { return fail('xlsx', 'That spreadsheet could not be read: ' + String((e && e.message) || e)); }
  };
  app.exportHistoryCsv = async () => {
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`; const lines = [['Date', 'Session', 'Exercise', 'Set', 'Reps', 'Weight kg', 'Seconds', 'Rest s'].join(',')];
    for (const l of app.state.logs) for (const p of l.performances || []) p.sets.forEach((s, i) => lines.push([l.date, l.name, p.name + (p.side ? ` (${p.side})` : ''), i + 1, s.reps, s.kg, s.secs, s.restSec].map(esc).join(',')));
    return P().files.saveText(`BeFyn-history-${todayIso()}.csv`, lines.join('\n'), { mime: 'text/csv' });
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
  app.saveMigrationBackup = async () => { const b = await app.migrationBackup(); if (!b) return fail('none', 'No upgrade backup exists.'); return P().files.saveText(`BeFyn-pre-v6-backup-${todayIso()}.json`, JSON.stringify(b), {}); };

  /** Erases BeFyn data in the app. Requires the exact confirmation word and keeps nothing silently. */
  app.eraseEverything = async ({ confirm }) => {
    if (confirm !== 'ERASE') return fail('not-confirmed', 'Type ERASE to confirm.');
    const writes = []; for (const s of ['prefs', 'templates', 'exercises', 'workouts', 'instances', 'scheduled', 'changes', 'logs', 'measurements', 'health', 'nutrition', 'reminders']) writes.push({ op: 'clear', store: s });
    await repos.adapter.transact(writes); await app.refresh(); return ok();
  };
}
