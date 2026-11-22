// Converts V5.0 plan rows (one row per set/round, Left/Right split) into compact BeFyn template sessions.
// Shared by the build-time seed generator (Node) and the runtime migration (browser), so both behave identically.
import { slug } from '../core/util.js';

const RE_SS = /^(Superset|Tri-set) ([A-Z]), round (\d+) of (\d+)$/;
const RE_DS = /^Drop set Stage (\d+), round (\d+) of (\d+)$/;
const DOW = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const split = (t) => String(t || '').split(/\s*[,/]\s*|\s+and\s+/).map((x) => x.trim()).filter(Boolean);
const catOf = (row) => ({ main: 'strength', pre: 'warm-up', post: 'cool-down', br: 'breathing' }[row.c] || (row.m === 'Yoga' ? 'yoga' : row.m === 'Cardio' ? 'cardio' : 'flow'));
function equipOf(row) {
  const l = (row.load || '').toLowerCase(), n = row.n.toLowerCase(); const out = [];
  if (/kg|dumbbell/.test(l) || /dumbbell/.test(n)) out.push('dumbbells');
  if (/bench/.test(n)) out.push('bench');
  if (/step/.test(n)) out.push('step board');
  if (!out.length) out.push('bodyweight');
  return out;
}

/** Registry of exercises discovered while converting. `details` is PLAN4.exd (slug -> details). */
export function makeRegistry(details = {}, existing = []) {
  const map = new Map(existing.map((e) => [e.id, e]));
  const byName = new Map(existing.map((e) => [norm(e.name), e.id]));
  return {
    map, byName, created: [],
    ensure(row) {
      const base = row.n.replace(/\s*\((each side|left|right)[^)]*\)/i, '');
      let id = row.x || byName.get(norm(base)) || slug(base);
      let e = map.get(id);
      if (!e) {
        const det = row.x ? details[row.x] : null;
        e = {
          id, name: row.n, category: catOf(row), primaryMuscles: split(det ? det.p : row.m), secondaryMuscles: split(det ? det.s : ''), equipment: equipOf(row),
          difficulty: det ? det.d : '', description: '', startingPosition: '', instructions: det ? det.i : (row.how || row.cue || ''), breathing: det ? det.b : (row.bth || row.tmx || ''),
          commonMistakes: [], safetyNotes: [], variations: det && det.a ? [det.a] : [], progressions: [], targets: row.tg || row.tp || '', media: [],
          legacyMediaKey: row.n.toLowerCase().trim(), source: 'befyn-seed', version: 1,
        };
        if (row.tm) e.breathTiming = row.tm;
        map.set(id, e); byName.set(norm(e.name), id); this.created.push(e);
      }
      return id;
    },
  };
}
export const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

function toItem(row, reg) {
  const it = { exercise: reg.ensure(row), name: row.n, sets: row.sets > 1 ? row.sets : 1 };
  if (row.reps) it.reps = row.reps;
  if (row.secs) it.secs = row.secs;
  if (row.rt) it.target = row.rt;
  if (row.load) it.load = row.load;
  const rest = row.restS || row.restAfter; if (rest) it.rest = rest;
  if (row.sd) it.side = row.sd;
  if (row.cue) it.cue = row.cue;
  if (row.tm) it.breath = { in: row.tm.i, hold: row.tm.h, out: row.tm.o, hold2: row.tm.h2 || 0, cycles: row.cyc || 0 };
  if (row.when) it.when = row.when;
  if (row.how) it.how = row.how;
  return it;
}

function parseBlk(b) {
  let m = RE_SS.exec(b || '');
  if (m) return { kind: m[1] === 'Superset' ? 'superset' : 'triset', round: +m[3], total: +m[4] };
  m = RE_DS.exec(b || '');
  if (m) return { kind: 'dropset', round: +m[2], total: +m[3] };
  return null;
}

/** Left/Right rows of the same exercise become one item flagged as "each side". */
function mergeSides(rows) {
  const out = [];
  for (const r of rows) {
    if (r.sd === 'Right') { const p = out[out.length - 1]; if (p && p.n === r.n && p.sd === 'Left') continue; }
    out.push(r.sd === 'Left' ? { ...r, sd: 'each', restAfter: r.restAfter } : r);
  }
  return out;
}

export function buildMain(rowsIn, reg, diag = {}) {
  const rows = mergeSides(rowsIn); const blocks = [];
  for (let i = 0; i < rows.length;) {
    const p = parseBlk(rows[i].blk);
    if (!p) { blocks.push({ type: 'straight', items: [toItem(rows[i], reg)] }); diag.straight = (diag.straight || 0) + 1; i++; continue; }
    let k = 0;
    while (p.round === 1 && i + k < rows.length) { const q = parseBlk(rows[i + k].blk); if (!q || q.kind !== p.kind || q.round !== 1 || q.total !== p.total) break; k++; }
    let ok = p.round === 1 && k > 0; const N = p.total;
    for (let r = 0; ok && r < N * k; r++) { const row = rows[i + r], q = row && parseBlk(row.blk); ok = !!q && q.kind === p.kind && q.round === Math.floor(r / k) + 1 && row.n === rows[i + (r % k)].n; }
    if (!ok) { blocks.push({ type: 'straight', items: [toItem(rows[i], reg)] }); diag.fallback = (diag.fallback || 0) + 1; i++; continue; }
    const items = rows.slice(i, i + k).map((r) => toItem(r, reg)); items.forEach((it) => { delete it.rest; it.sets = 1; });
    const block = { type: p.kind, rounds: N, items, restAfterRound: rows[i + k - 1].restAfter || 0 };
    if (rows[i].bn) block.note = rows[i].bn;
    blocks.push(block); diag[p.kind] = (diag[p.kind] || 0) + 1; i += N * k;
  }
  return blocks;
}

export function buildFlat(rowsIn, reg) {
  const out = [];
  for (const r of mergeSides(rowsIn)) {
    const last = out[out.length - 1];
    if (last && last.name === r.n && /^hold \d+ of \d+$/.test(r.blk || '')) continue;
    const it = toItem(r, reg);
    if (/^hold 1 of (\d+)$/.test(r.blk || '')) it.repeats = +/of (\d+)/.exec(r.blk)[1];
    if (r.dtx) it.detail = r.dtx; if (r.tg) it.targets = r.tg; if (r.bth) it.breathing = r.bth; if (r.tp) it.kind = r.tp; if (r.est) it.estimate = r.est;
    out.push(it);
  }
  return out;
}

/** One V5 day ({name, ex:[rows]}) -> template session. */
export function convertDay({ week, dow, day, reg, diag }) {
  const by = (c) => day.ex.filter((e) => e.c === c);
  const sections = { warmup: buildFlat(by('pre'), reg), main: buildMain(by('main'), reg, diag), cooldown: buildFlat(by('post'), reg), breathing: buildFlat(by('br'), reg), flow: buildFlat(by('flow'), reg) };
  for (const k of Object.keys(sections)) if (!sections[k].length) delete sections[k];
  return { id: `w${week}-${DOW[dow]}`, week, dayOfWeek: dow, name: day.name, kind: dow === 0 ? 'recovery' : 'training', sections };
}

/** Programme order used by V5: Monday..Saturday then Sunday, week by week. */
export const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

/** Signature that ignores V5's Left/Right expansion, so a stock V5 plan equals the seed plan. */
export function signature(weeks) {
  const parts = [];
  for (const w of Object.keys(weeks).map(Number).sort((a, b) => a - b)) for (const d of DAY_ORDER) {
    const day = weeks[w] && weeks[w][d]; if (!day) continue;
    parts.push(`${w}:${d}:` + day.ex.filter((e) => e.sd !== 'Right').map((e) => `${e.c}|${e.n}|${e.blk || ''}|${e.load || ''}`).join('~'));
  }
  return parts.join('#');
}

/** Compact fingerprint of a signature string (two independent FNV-1a passes), stored in the seed instead of the full text. */
export function sigHash(str) {
  let a = 0x811c9dc5, b = 0x01000193 ^ 0xdeadbeef;
  for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); a = Math.imul(a ^ c, 0x01000193) >>> 0; b = Math.imul(b + c + i, 0x85ebca6b) >>> 0; b ^= b >>> 13; }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0') + str.length.toString(16);
}
