// Progression, records and explainable load suggestions. Deterministic and side-effect free.
import { round1 } from '../core/util.js';

/** "12-15 reps" | "10/side" | "40 sec" | "max reps" -> {min,max,unit,perSide} */
export function parseTarget(str, item = {}) {
  const s = String(str || '').toLowerCase();
  const perSide = /\/(side|arm|leg)|each side/.test(s) || !!item.side;
  const range = /(\d+)\s*-\s*(\d+)/.exec(s), single = /(\d+)/.exec(s);
  const timed = /sec|min|hold/.test(s) || (item.secs > 0 && !item.reps);
  let min = 0, max = 0;
  if (range) { min = +range[1]; max = +range[2]; } else if (single) { min = max = +single[1]; } else if (item.reps) { min = max = item.reps; } else if (item.secs) { min = max = item.secs; }
  if (/min/.test(s) && !/sec/.test(s)) { min *= 60; max *= 60; }
  return { min, max, unit: timed ? 'secs' : 'reps', perSide, open: /max/.test(s) };
}

/** "5 kg each hand" | "Bodyweight" -> {kg, text} */
export function parseLoad(str) {
  const s = String(str || '');
  const m = /(\d+(?:\.\d+)?)\s*kg/i.exec(s);
  return { kg: m ? +m[1] : /body/i.test(s) ? 0 : null, text: s };
}

export const estimate1RM = (kg, reps) => (kg > 0 && reps > 0 ? round1(kg * (1 + Math.min(reps, 30) / 30)) : 0);
export const setVolume = (s) => (s.kg || 0) * (s.reps || 0);

/**
 * history: newest-first [{date, sets:[{reps,kg,secs,done}]}] for one exercise.
 * Returns a suggestion with a plain-language reason. Never changes a programme by itself.
 */
export function suggestNext(item, history = [], opts = {}) {
  const t = parseTarget(item.target, item);
  const planned = parseLoad(item.load);
  const step = item.progression?.stepKg ?? opts.stepKg ?? 1;
  const last = history[0];
  if (!last || !last.sets?.some((s) => s.done !== false)) {
    return { kg: planned.kg, reps: t.max || t.min, reason: planned.kg != null ? 'Starting load from your programme.' : 'Follow the programme target.', basis: 'programme' };
  }
  const sets = last.sets.filter((s) => s.done !== false);
  const kg = Math.max(...sets.map((s) => s.kg || 0));
  const topReps = Math.min(...sets.map((s) => s.reps || s.secs || 0));
  if (t.unit === 'secs') {
    const secs = Math.min(...sets.map((s) => s.secs || 0));
    return { kg, secs: secs + 5, reason: `You held ${secs}s last time. Try ${secs + 5}s.`, basis: 'history' };
  }
  if (t.max && topReps >= t.max && kg >= 0 && planned.kg !== 0) {
    return { kg: round1(kg + step), reps: t.min, reason: `You reached ${t.max} reps on every set at ${kg} kg. Try ${round1(kg + step)} kg for ${t.min} reps.`, basis: 'history' };
  }
  if (t.max && topReps < t.min && last.sets.length) {
    return { kg, reps: t.min, reason: `Last time you managed ${topReps} reps. Stay at ${kg} kg and aim for ${t.min}.`, basis: 'history' };
  }
  return { kg, reps: Math.min(t.max || topReps + 1, topReps + 1), reason: `Stay at ${kg} kg and add a rep: aim for ${Math.min(t.max || topReps + 1, topReps + 1)}.`, basis: 'history' };
}

/**
 * performances: [{date, exercise, sets:[{reps,kg,secs}]}] -> per-exercise records.
 */
export function personalRecords(performances) {
  const rec = new Map();
  for (const p of performances) {
    let r = rec.get(p.exercise); if (!r) rec.set(p.exercise, r = { exercise: p.exercise, maxKg: null, maxReps: null, best1RM: null, bestVolume: null, longestSecs: null });
    let vol = 0;
    for (const s of p.sets || []) {
      if (s.done === false) continue;
      vol += setVolume(s);
      if (s.kg > 0 && (!r.maxKg || s.kg > r.maxKg.value)) r.maxKg = { value: s.kg, reps: s.reps, date: p.date };
      if (s.reps > 0 && (!r.maxReps || s.reps > r.maxReps.value)) r.maxReps = { value: s.reps, kg: s.kg || 0, date: p.date };
      const e = estimate1RM(s.kg, s.reps); if (e > 0 && (!r.best1RM || e > r.best1RM.value)) r.best1RM = { value: e, date: p.date };
      if (s.secs > 0 && (!r.longestSecs || s.secs > r.longestSecs.value)) r.longestSecs = { value: s.secs, date: p.date };
    }
    if (vol > 0 && (!r.bestVolume || vol > r.bestVolume.value)) r.bestVolume = { value: vol, date: p.date };
  }
  return [...rec.values()];
}

/** Which sets of a just-finished performance beat everything earlier? */
export function newRecords(previous, current) {
  const before = personalRecords(previous).find((r) => r.exercise === current.exercise);
  const after = personalRecords([current])[0];
  const out = [];
  if (!after) return out;
  if (after.maxKg && (!before?.maxKg || after.maxKg.value > before.maxKg.value) && before) out.push({ type: 'weight', value: after.maxKg.value });
  if (after.best1RM && before?.best1RM && after.best1RM.value > before.best1RM.value) out.push({ type: 'estimated-1rm', value: after.best1RM.value });
  if (after.longestSecs && before?.longestSecs && after.longestSecs.value > before.longestSecs.value) out.push({ type: 'hold', value: after.longestSecs.value });
  return out; // first-ever performances are baselines, not records
}
