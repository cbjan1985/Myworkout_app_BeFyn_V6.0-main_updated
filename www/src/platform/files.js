import { plugin, isApp } from './env.js';
import { todayIso } from '../core/util.js';

/** Saves text the person can keep (backups, spreadsheets). Uses app Documents/FiT85 on Android, a download in the browser. */
export async function saveText(name, text, { share = false, mime = 'application/json' } = {}) {
  const FS = plugin('Filesystem');
  if (isApp() && FS) {
    try {
      const r = await FS.writeFile({ path: `FiT85/${name}`, data: text, directory: 'DOCUMENTS', encoding: 'utf8', recursive: true });
      if (share) await shareFile(r.uri, name);
      return { ok: true, where: `Documents/FiT85/${name}`, uri: r.uri };
    } catch (e) { return { ok: false, message: 'The file could not be saved: ' + String((e && e.message) || e) }; }
  }
  return download(name, new Blob([text], { type: mime }));
}
export async function saveBase64(name, b64, { share = false } = {}) {
  const FS = plugin('Filesystem');
  if (isApp() && FS) {
    try {
      const r = await FS.writeFile({ path: `FiT85/${name}`, data: b64, directory: 'DOCUMENTS', recursive: true });
      if (share) await shareFile(r.uri, name);
      return { ok: true, where: `Documents/FiT85/${name}`, uri: r.uri };
    } catch (e) { return { ok: false, message: 'The file could not be saved: ' + String((e && e.message) || e) }; }
  }
  const bin = atob(b64); const buf = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return download(name, new Blob([buf]));
}
async function shareFile(uri, name) { const S = plugin('Share'); if (S) { try { await S.share({ title: name, url: uri, dialogTitle: 'Share' }); } catch (_) { /* cancelled */ } } }
function download(name, blob) {
  try { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); return { ok: true, where: 'Downloads' }; }
  catch (e) { return { ok: false, message: 'The file could not be created.' }; }
}
/** Lets the person choose a file (Android shows its own picker, so no storage permission is needed). */
export function pickFile(accept = '.json,application/json') {
  return new Promise((resolve) => {
    const i = document.createElement('input'); i.type = 'file'; i.accept = accept; i.style.display = 'none';
    i.onchange = () => { const f = i.files && i.files[0]; i.remove(); resolve(f || null); };
    i.oncancel = () => { i.remove(); resolve(null); };
    document.body.appendChild(i); i.click();
  });
}
export const readText = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsText(file); });
export const readArrayBuffer = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsArrayBuffer(file); });
export const stamp = () => `${todayIso()}`;

/** SheetJS is only needed for spreadsheets, so it is loaded on demand and its absence is reported plainly. */
let xlsxP = null;
export function loadXlsx() {
  if (globalThis.XLSX) return Promise.resolve(globalThis.XLSX);
  return xlsxP || (xlsxP = new Promise((resolve, reject) => {
    const s = document.createElement('script'); s.src = 'xlsx.full.min.js';
    s.onload = () => (globalThis.XLSX ? resolve(globalThis.XLSX) : reject(new Error('Spreadsheet support did not load.')));
    s.onerror = () => { xlsxP = null; reject(new Error('Spreadsheet support file is missing. Rebuild the app with the GitHub workflow.')); };
    document.head.appendChild(s);
  }));
}
