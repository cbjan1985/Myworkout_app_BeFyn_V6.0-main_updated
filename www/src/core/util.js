// Pure helpers shared by every layer. No DOM, no storage, no platform APIs.

let _seq = 0;
/** Sortable, collision-resistant id with a readable prefix. */
export function uid(prefix = 'id') {
  _seq = (_seq + 1) % 1679616;
  return `${prefix}_${Date.now().toString(36)}${_seq.toString(36).padStart(2, '0')}${Math.random().toString(36).slice(2, 6)}`;
}

export const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
export const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
export const sum = (a, f = (x) => x) => a.reduce((t, x) => t + (Number(f(x)) || 0), 0);
export const uniq = (a) => [...new Set(a)];

/* ---------- ISO date (YYYY-MM-DD) arithmetic, timezone and DST safe ---------- */
const MS_DAY = 86400000;
const toUtc = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
const fromUtc = (ms) => new Date(ms).toISOString().slice(0, 10);

export function isIsoDate(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(toUtc(s)) && fromUtc(toUtc(s)) === s; }
export function localIso(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export const todayIso = () => localIso(new Date());
export const addDays = (iso, n) => fromUtc(toUtc(iso) + n * MS_DAY);
export const diffDays = (a, b) => Math.round((toUtc(a) - toUtc(b)) / MS_DAY); // a - b
/** 0 = Sunday ... 6 = Saturday */
export const dow = (iso) => new Date(toUtc(iso)).getUTCDay();
/** Monday-based start of the week containing iso. */
export const weekStart = (iso) => addDays(iso, -((dow(iso) + 6) % 7));
export const monthStart = (iso) => iso.slice(0, 8) + '01';
export const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const DOW_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export function prettyDate(iso, withYear = false) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${DOW_SHORT[dow(iso)]} ${d} ${MONTHS[m - 1].slice(0, 3)}${withYear ? ' ' + y : ''}`;
}

/* ---------- tiny event emitter ---------- */
export function emitter() {
  const m = new Map();
  return {
    on(evt, fn) { (m.get(evt) || m.set(evt, new Set()).get(evt)).add(fn); return () => m.get(evt)?.delete(fn); },
    emit(evt, payload) { (m.get(evt) || []).forEach((fn) => { try { fn(payload); } catch (e) { console.error('listener error', e); } }); },
  };
}

/** Result helper so domain code can report plain-language problems without throwing. */
export const ok = (value = {}) => ({ ok: true, ...value });
export const fail = (code, message, extra = {}) => ({ ok: false, error: { code, message, ...extra } });

export function formatDuration(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
export const round1 = (n) => Math.round(n * 10) / 10;
