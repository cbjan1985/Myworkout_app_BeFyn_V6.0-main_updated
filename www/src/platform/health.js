import { callNative } from './env.js';
import { uid } from '../core/util.js';

/** Data types FiT85 can read from Android Health Connect. Read-only; nothing is ever written back. */
export const HEALTH_TYPES = [
  { id: 'steps', label: 'Steps', unit: 'steps' },
  { id: 'activeCalories', label: 'Active calories', unit: 'kcal' },
  { id: 'heartRate', label: 'Heart rate', unit: 'bpm' },
  { id: 'sleep', label: 'Sleep', unit: 'h' },
  { id: 'exercise', label: 'Exercise sessions', unit: 'min' },
  { id: 'weight', label: 'Weight', unit: 'kg' },
  { id: 'bodyFat', label: 'Body fat', unit: '%' },
  { id: 'oxygenSaturation', label: 'Oxygen saturation (SpO2)', unit: '%' },
  { id: 'height', label: 'Height', unit: 'cm' },
];
const PLUGIN = 'FiT85Health';

/** availability: available | not_installed | update_required | not_supported | unavailable (plugin missing, e.g. in a browser) */
export async function status() {
  const r = await callNative(PLUGIN, 'getStatus');
  if (!r.ok) return { availability: 'unavailable', granted: [], reason: r.reason, message: r.message };
  return { availability: r.value.availability, granted: r.value.granted || [] };
}
export async function requestAccess(types) { const r = await callNative(PLUGIN, 'requestHealthAccess', { types }); return r.ok ? { ok: true, granted: r.value.granted || [] } : { ok: false, message: r.message || 'Health Connect is not available on this device.' }; }
export async function openSettings() { return callNative(PLUGIN, 'openSettings'); }

/** Maps native records to FiT85 HealthRecords with provenance and a dedup key (source + external id). */
export function toRecord(type, n, syncedAt) {
  const def = HEALTH_TYPES.find((t) => t.id === type);
  return { id: uid('hc'), extKey: `hc:${type}:${n.source || 'unknown'}:${n.id || n.start}`, type, value: n.value, unit: def?.unit || n.unit || '', start: n.start, end: n.end || n.start, source: n.source || 'Unknown app', sourceType: 'health-connect', extra: n.extra || undefined, syncedAt };
}

/** Reads each granted type for the last `days` days and upserts without duplicating records. */
export async function sync(repos, { types, days = 30, now = () => new Date() } = {}) {
  const st = await status();
  if (st.availability !== 'available') return { ok: false, reason: st.availability, message: availabilityMessage(st.availability) };
  const want = (types || HEALTH_TYPES.map((t) => t.id)).filter((t) => st.granted.includes(t));
  if (!want.length) return { ok: false, reason: 'no-permission', message: 'No health data types are allowed yet.' };
  const end = now(), start = new Date(end.getTime() - days * 86400000), at = end.toISOString();
  let added = 0, updated = 0; const perType = {}; const errors = [];
  for (const t of want) {
    const r = await callNative(PLUGIN, 'readRecords', { type: t, start: start.toISOString(), end: at });
    if (!r.ok) { errors.push(`${labelOf(t)}: ${r.message || 'could not be read'}`); continue; }
    const recs = (r.value.records || []).map((n) => toRecord(t, n, at));
    const res = await repos.health.upsertMany(recs); added += res.added; updated += res.updated; perType[t] = recs.length;
  }
  await repos.meta.set('health.lastSync', { at, added, updated, perType, errors });
  return { ok: true, added, updated, perType, errors, at };
}
export const labelOf = (t) => HEALTH_TYPES.find((x) => x.id === t)?.label || t;
export function availabilityMessage(a) {
  return ({ not_installed: 'Health Connect is not installed on this phone. You can install it from Google Play, then come back.', update_required: 'Health Connect needs an update before FiT85 can use it.', not_supported: 'This Android version does not support Health Connect.', unavailable: 'Health Connect is only available in the Android app.' })[a] || 'Health Connect is not available.';
}

/**
 * Daily totals. When several apps report the same measure (for example two step counters), adding them would
 * double count, so the single source with the highest total for that day is used and the others are listed.
 */
export function dailySummary(records, type, tz = 0) {
  const byDay = new Map();
  for (const r of records.filter((x) => x.type === type)) {
    const day = r.start.slice(0, 10); const m = byDay.get(day) || byDay.set(day, new Map()).get(day);
    m.set(r.source, (m.get(r.source) || 0) + (Number(r.value) || 0));
  }
  return [...byDay].map(([date, m]) => { const best = [...m].sort((a, b) => b[1] - a[1])[0]; return { date, value: Math.round(best[1] * 10) / 10, source: best[0], otherSources: [...m.keys()].filter((s) => s !== best[0]) }; }).sort((a, b) => (a.date < b.date ? -1 : 1));
}
export function latest(records, type) { return records.filter((r) => r.type === type).sort((a, b) => (a.start < b.start ? 1 : -1))[0] || null; }
export function averageHeartRate(records, date) { const r = records.filter((x) => x.type === 'heartRate' && x.start.slice(0, 10) === date); return r.length ? Math.round(r.reduce((t, x) => t + x.value, 0) / r.length) : null; }
