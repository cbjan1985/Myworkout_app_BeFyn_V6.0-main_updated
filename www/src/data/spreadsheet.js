// Spreadsheet import/export for programmes. Pure row <-> template mapping; SheetJS is used only by the caller.
import { slug, uid } from '../core/util.js';
import { newDraft } from '../domain/programme.js';

export const HEADERS = ['Week', 'Day', 'Session', 'Section', 'Exercise', 'Sets', 'Reps', 'Seconds', 'Rest (s)', 'Load', 'Block', 'Rounds', 'Notes'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SEC = { warmup: 'Warm-up', main: 'Main', flow: 'Flow', breathing: 'Breathing', cooldown: 'Cool-down' };
const SEC_REV = Object.fromEntries(Object.entries(SEC).map(([k, v]) => [v.toLowerCase(), k]));

export function rowsFromTemplate(t) {
  const rows = [HEADERS];
  for (const s of t.sessions) for (const [sec, blocks] of Object.entries(s.sections || {})) for (const b of blocks) {
    const type = b.type && b.type !== 'straight' ? b.type : '';
    for (const it of b.items || [b]) rows.push([s.week, DAYS[s.dayOfWeek] || '', s.name, SEC[sec] || sec, it.name, it.sets || 1, it.reps || '', it.secs || '', it.rest || '', it.load || '', type, type ? b.rounds || '' : '', it.target || '']);
  }
  return rows;
}

/** rows: array of arrays (first row = headers). Returns { draft, issues } and never throws on bad data. */
export function templateFromRows(rows, { name = 'Imported programme', exerciseIndex = new Map() } = {}) {
  const issues = [];
  if (!rows.length) return { draft: null, issues: ['The file is empty.'] };
  const head = rows[0].map((h) => String(h || '').trim().toLowerCase());
  const col = (n) => head.indexOf(n.toLowerCase());
  const idx = Object.fromEntries(HEADERS.map((h) => [h, col(h)]));
  for (const must of ['Week', 'Session', 'Exercise']) if (idx[must] < 0) return { draft: null, issues: [`Column "${must}" is missing. Download the template to see the expected columns.`] };
  const sessions = new Map();
  rows.slice(1).forEach((r, i) => {
    const line = i + 2; const g = (h) => (idx[h] >= 0 ? r[idx[h]] : '');
    if (!r.some((c) => c !== '' && c != null)) return;
    const week = Number(g('Week')); const ex = String(g('Exercise') || '').trim(); const sname = String(g('Session') || '').trim();
    if (!Number.isInteger(week) || week < 1 || week > 52) { issues.push(`Row ${line}: week must be a whole number from 1 to 52.`); return; }
    if (!ex || !sname) { issues.push(`Row ${line}: exercise and session are required.`); return; }
    const key = `${week}|${String(g('Day') || '').toLowerCase()}|${sname}`;
    if (!sessions.has(key)) sessions.set(key, { id: `w${week}-${slug(String(g('Day') || ''))}${g('Day') ? '-' : ''}${slug(sname)}`, week, dayOfWeek: Math.max(0, DAYS.findIndex((d) => d.toLowerCase() === String(g('Day')).toLowerCase())), name: sname, kind: 'training', sections: {}, _blocks: new Map() });
    const s = sessions.get(key);
    const sec = SEC_REV[String(g('Section') || 'Main').toLowerCase()] || 'main';
    const num = (v) => (v === '' || v == null ? 0 : Number(v));
    const [sets, reps, secs, rest] = [num(g('Sets')) || 1, num(g('Reps')), num(g('Seconds')), num(g('Rest (s)'))];
    if ([sets, reps, secs, rest].some((n) => Number.isNaN(n) || n < 0)) { issues.push(`Row ${line}: sets, reps, seconds and rest must be positive numbers.`); return; }
    const known = exerciseIndex.get(ex.toLowerCase().replace(/[^a-z0-9]+/g, ''));
    if (!known) issues.push(`Row ${line}: "${ex}" is not in your exercise catalogue yet; it will be added.`);
    const it = { exercise: known || slug(ex), name: ex, sets, ...(reps ? { reps } : {}), ...(secs ? { secs } : {}), ...(rest ? { rest } : {}), ...(g('Load') ? { load: String(g('Load')) } : {}), ...(g('Notes') ? { target: String(g('Notes')) } : {}) };
    const type = String(g('Block') || '').toLowerCase(); const rounds = num(g('Rounds')) || 1;
    s.sections[sec] = s.sections[sec] || [];
    if (['superset', 'triset', 'dropset'].includes(type)) {
      const bk = `${sec}|${type}`; let b = s._blocks.get(bk) || (s._blocks.set(bk, null), null);
      const last = s.sections[sec][s.sections[sec].length - 1];
      if (last && last.type === type && last._open) b = last;
      if (!b) { b = { type, rounds, items: [], restAfterRound: rest || 0, _open: true }; s.sections[sec].push(b); }
      it.sets = 1; b.items.push(it);
    } else { const last = s.sections[sec][s.sections[sec].length - 1]; if (last && last._open) delete last._open; s.sections[sec].push({ type: 'straight', items: [it] }); }
  });
  const list = [...sessions.values()].filter((s) => Object.keys(s.sections).length).map((s) => { Object.values(s.sections).forEach((bl) => bl.forEach((b) => delete b._open)); delete s._blocks; return s; }).sort((a, b) => a.week - b.week);
  if (!list.length) return { draft: null, issues: [...issues, 'No usable rows were found.'] };
  const weeks = Math.max(...list.map((s) => s.week));
  const draft = newDraft({ name, weeks, weeklyFrequency: Math.round(list.length / weeks), sessions: list }); draft.source = 'spreadsheet';
  return { draft, issues };
}
