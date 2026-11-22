import { plugin, isApp, cap } from './env.js';
import { norm } from '../data/legacy-convert.js';

/** Exercise media: local files found in a chosen folder, blobs stored by V5.0 / added in-app, and YouTube links. */
const folderIndex = new Map();   // norm(name) -> { url, type }
const blobUrls = new Map();
let legacyDb = null;

/** Only web links are ever opened or used as image sources (never javascript:, data: or file: from imported data). */
export const safeUrl = (u) => (/^https?:\/\//i.test(String(u || '')) ? String(u) : null);
export const youtubeId = (url) => { const m = /(?:youtu\.be\/|v=|embed\/|shorts\/)([A-Za-z0-9_-]{11})/.exec(url || ''); return m ? m[1] : null; };
export const youtubeThumb = (url) => { const id = youtubeId(url); return id ? `https://img.youtube.com/vi/${id}/hqdefault.jpg` : null; };
export const youtubeSearch = (name) => `https://www.youtube.com/results?search_query=${encodeURIComponent(name + ' exercise proper form')}`;
const isVideo = (n) => /\.(mp4|webm|mov|mkv|3gp|m4v)$/i.test(n);

function openLegacy() {
  return legacyDb || (legacyDb = new Promise((resolve) => {
    try { const r = indexedDB.open('wk3', 1); r.onupgradeneeded = () => { try { r.result.createObjectStore('g'); } catch (_) { /* exists */ } }; r.onsuccess = () => resolve(r.result); r.onerror = () => resolve(null); } catch (_) { resolve(null); }
  }));
}
const req = (r) => new Promise((res) => { r.onsuccess = () => res(r.result); r.onerror = () => res(undefined); });

export async function putBlob(key, blob) {
  const db = await openLegacy(); if (!db) return false;
  return new Promise((res) => { try { const tx = db.transaction('g', 'readwrite'); tx.objectStore('g').put(blob, key); tx.oncomplete = () => res(true); tx.onerror = tx.onabort = () => res(false); } catch (_) { res(false); } });
}
export async function removeBlob(key) { const db = await openLegacy(); if (!db) return; try { db.transaction('g', 'readwrite').objectStore('g').delete(key); } catch (_) { /* ignore */ } blobUrls.delete(key); }
async function getBlobUrl(key) {
  if (blobUrls.has(key)) return blobUrls.get(key);
  const db = await openLegacy(); if (!db) return null;
  const v = await req(db.transaction('g').objectStore('g').get(key));
  if (!v || typeof v === 'string') return typeof v === 'string' ? { url: v, type: isVideo(v) ? 'video' : 'image' } : null;
  const out = { url: URL.createObjectURL(v), type: (v.type || '').startsWith('video') ? 'video' : 'image' };
  blobUrls.set(key, out); return out;
}

/** Indexes media files from a folder by exercise name (file "goblet_squat.gif" matches "Goblet Squat"). */
export async function syncFolder({ folder, path } = {}) {
  const P = isApp() ? plugin('GifFolder') : null;
  if (!P) return { ok: false, message: 'Folder media is only available in the Android app. In a browser, add files to an exercise directly.' };
  try {
    const r = await P.listGifs(path ? { path } : { folder: folder || 'workout_gif' });
    if (!r.exists) return { ok: false, message: 'That folder was not found. Choose it with "Pick folder".' };
    if (!r.granted) return { ok: false, needAccess: true, message: 'Android needs "Allow access to manage all files" to read this folder in place.' };
    folderIndex.clear();
    for (const f of r.files || []) {
      const base = f.name.replace(/\.[^.]+$/, '').replace(/_+/g, ' ');
      folderIndex.set(norm(base), { url: cap().convertFileSrc(f.path.split('/').map(encodeURIComponent).join('/')), type: isVideo(f.name) ? 'video' : 'image' });
    }
    return { ok: true, count: folderIndex.size, path: r.path };
  } catch (e) { return { ok: false, message: String((e && e.message) || e) }; }
}
export async function pickFolder() {
  const P = isApp() ? plugin('GifFolder') : null; if (!P) return { ok: false, message: 'Folder picking is only available in the Android app.' };
  try { const r = await P.pickFolder(); return { ok: true, ...r }; } catch (e) { return { ok: false, cancelled: String(e && e.message) === 'cancelled', message: String((e && e.message) || e) }; }
}
export async function requestAccess() { try { await plugin('GifFolder')?.requestAccess?.(); } catch (_) { /* ignore */ } }

/** Best available visual for an exercise: explicit file, folder match, stored blob, then null (caller shows a fallback). */
export async function resolve(exercise) {
  if (!exercise) return null;
  const hit = folderIndex.get(norm(exercise.name)) || folderIndex.get(norm(exercise.legacyMediaKey || ''));
  if (hit) return hit;
  for (const key of [exercise.legacyMediaKey, exercise.name?.toLowerCase().trim()].filter(Boolean)) { const b = await getBlobUrl(key); if (b) return b; }
  return null;
}
export const links = (exercise) => (exercise?.media || []).filter((m) => m.kind === 'youtube' && safeUrl(m.url));
export const folderCount = () => folderIndex.size;
