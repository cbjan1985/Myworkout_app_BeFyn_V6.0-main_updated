import { createRepos, indexedDbAdapter, memoryAdapter } from '../data/db.js';

/** Opens the database. If IndexedDB is unusable the app still starts, but says so: nothing would be saved. */
export async function openRepos() {
  try {
    const a = indexedDbAdapter();
    await a.get('meta', 'probe'); // forces the upgrade and surfaces blocked/denied errors now
    try { await navigator.storage?.persist?.(); } catch (_) { /* best effort */ }
    return { repos: createRepos(a), degraded: false };
  } catch (e) {
    return { repos: createRepos(memoryAdapter()), degraded: true, reason: String((e && e.message) || e) };
  }
}
export async function loadSeed(base = '') {
  const get = async (f) => { const r = await fetch(`${base}assets/seed/${f}`); if (!r.ok) throw new Error(`Could not load ${f}`); return r.json(); };
  const [template, exercises] = await Promise.all([get('programme-8wk-muscle-gain.json'), get('exercises.json')]);
  return { template, exercises };
}
