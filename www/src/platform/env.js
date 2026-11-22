// Thin access to Capacitor and the browser. Everything platform-specific goes through this folder.
export const cap = () => globalThis.Capacitor || null;
export const isApp = () => { try { const c = cap(); return !!c && (c.isNativePlatform ? c.isNativePlatform() : c.getPlatform?.() !== 'web'); } catch (_) { return false; } };
const cache = new Map();
export function plugin(name) {
  if (cache.has(name)) return cache.get(name);
  const c = cap();
  if (!c) return null;
  let p = null;
  try { p = (c.Plugins && c.Plugins[name]) || (c.registerPlugin ? c.registerPlugin(name) : null); } catch (_) { p = null; }
  if (p) cache.set(name, p);
  return p;
}
/** Calls a native plugin method and turns "not implemented / missing" into a plain result instead of an exception. */
export async function callNative(name, method, args) {
  const p = plugin(name);
  if (!p || typeof p[method] !== 'function') return { ok: false, reason: 'unavailable' };
  try { return { ok: true, value: await p[method](args || {}) }; } catch (e) { return { ok: false, reason: 'error', message: String((e && e.message) || e) }; }
}
export const online = () => (typeof navigator !== 'undefined' ? navigator.onLine !== false : true);
