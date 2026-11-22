// Shared pieces for showing a programme session: summary line, exercise outline, and the session detail sheet.
import { h } from './dom.js';
import { openSheet, toast } from './dom.js';
import { btn, pill, list, item, banner, sectionTitle } from './components.js';
import { prettyDate } from '../core/util.js';
import { SECTION_LABEL, SECTION_ORDER, phaseLabel } from '../domain/programme.js';
import { openMoveSheet, openSwapSheet } from './sheets.js';

export const targetText = (it) => {
  const bits = [];
  if (it.target) bits.push(it.target); else if (it.reps) bits.push(`${it.reps} reps`); else if (it.secs) bits.push(it.secs >= 60 ? `${Math.round(it.secs / 60)} min` : `${it.secs} sec`);
  if (it.sets > 1) bits.unshift(`${it.sets} \u00d7`);
  if (it.load && !/^body/i.test(it.load)) bits.push(it.load);
  return bits.join(' ');
};
const BLOCK = { superset: 'Superset', triset: 'Tri-set', dropset: 'Drop set' };

/** Human outline of a template session: [{section, rows:[{title, meta}]}] */
export function outline(session) {
  const out = [];
  for (const sec of SECTION_ORDER) {
    const blocks = session.sections?.[sec]; if (!blocks?.length) continue;
    const rows = blocks.map((b) => { const its = b.items || [b];
      return b.type && b.type !== 'straight' ? { title: `${BLOCK[b.type] || b.type}: ${its.map((i) => i.name).join(' + ')}`, meta: `${b.rounds} rounds` } : { title: its[0].name, meta: targetText(its[0]) }; });
    out.push({ section: sec, label: SECTION_LABEL[sec], rows });
  }
  return out;
}
export const countExercises = (session) => Object.values(session.sections || {}).reduce((n, bl) => n + bl.reduce((m, b) => m + (b.items ? b.items.length : 1), 0), 0);
export const estimateMinutes = (steps) => Math.max(5, Math.round(steps.reduce((t, st) => t + (st.item.secs ? st.item.secs : 35) + (st.restAfterRound || 0) + 8, 0) / 60));

export function statusPill(s, today) {
  if (s.status === 'completed') return pill('Done', 'ok'); if (s.status === 'skipped') return pill('Skipped', 'warn');
  if (s.date < today) return pill('Waiting', 'warn'); if (s.date === today) return pill('Today', 'acc'); return pill('Planned');
}

export function openSessionSheet(app, scheduled, onDone) {
  const p = app.state.programme; const tpl = app.sessionTemplate(scheduled); const today = app.today();
  const steps = app.sessionPlan(scheduled.id)?.steps || [];
  const draft = app.state.draft;
  const canStart = scheduled.status === 'planned';
  const body = h('div', { class: 'stack' },
    h('div', { class: 'row wrap' }, statusPill(scheduled, today), pill(`Week ${scheduled.week}`), pill(phaseLabel(p.template, scheduled.week) || 'Programme', 'acc')),
    h('p', { class: 'muted' }, scheduled.status === 'completed' ? `Completed on ${prettyDate(scheduled.performedOn || scheduled.date)}.` : `Planned for ${prettyDate(scheduled.date)}${steps.length ? ` \u00b7 about ${estimateMinutes(steps)} min` : ''}.`),
    tpl ? outline(tpl).map((o) => h('div', {}, h('h3', { class: 'strong small muted', style: { margin: '8px 0 4px' } }, o.label), list(o.rows.map((r) => item({ title: r.title, meta: r.meta, chev: false }))))) : null);
  const sheet = openSheet({ title: scheduled.name, content: body, actions: [
    canStart && { label: draft && draft.scheduledId === scheduled.id ? 'Continue workout' : 'Start workout', close: false, onClick: async (api) => { const r = await app.startDraft({ kind: 'scheduled', scheduledId: scheduled.id }); if (!r.ok) { toast(r.error.message); return false; } api.close(); app.router.navigate('/workout'); return false; } },
    canStart && { label: 'Move', kind: 'secondary', close: false, onClick: (api) => { api.close(); openMoveSheet(app, scheduled, onDone); return false; } },
    canStart && { label: 'Swap', kind: 'secondary', close: false, onClick: (api) => { api.close(); openSwapSheet(app, scheduled, onDone); return false; } },
    !canStart && { label: 'Close', kind: 'secondary' },
  ].filter(Boolean) });
  return sheet;
}
export { banner, btn, sectionTitle };
