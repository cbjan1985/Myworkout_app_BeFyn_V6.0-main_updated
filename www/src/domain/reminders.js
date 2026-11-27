// Turns reminder preferences + the real programme schedule into concrete notifications.
// Pure and deterministic. Session reminders are one-off notifications on real dates, so they always follow the schedule.
import { addDays, dow } from '../core/util.js';
import { planned } from './schedule-engine.js';

export const KINDS = {
  workout: { label: 'Workout time', session: true },
  upcoming: { label: 'Evening before a session', session: true },
  missed: { label: 'Gentle nudge after a missed session', session: true },
  milestone: { label: 'Weekly check-in', session: true },
  recovery: { label: 'Recovery check-in', session: false, body: 'A good moment to stretch, hydrate and rest.' },
  protein: { label: 'Protein check', session: false, body: 'How is your protein target looking today?' },
  hydration: { label: 'Hydration', session: false, body: 'Time for some water.' },
  backup: { label: 'Back up your data', session: false, body: 'Save a BeFyn backup so your history is safe.' },
  custom: { label: 'Custom reminder', session: false, body: '' },
};
export const MAX_ONE_OFF = 60;

const hash = (s) => { let h = 7; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h) % 100000000; };
const at = (date, time) => { const [h, m] = String(time || '08:00').split(':').map(Number); return new Date(`${date}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`); };

/**
 * @param {{reminders:any[], sessions:any[], instanceStatus?:string, today:string, now:Date, horizonDays?:number}} p
 * @returns {{repeating:any[], oneOff:any[]}}
 */
export function buildNotifications({ reminders, sessions = [], instanceStatus = 'none', today, now, horizonDays = 21, detailed = false }) {
  const repeating = [], oneOff = [];
  const active = instanceStatus === 'active';
  const upcoming = active ? planned(sessions).filter((s) => s.date >= today && s.date <= addDays(today, horizonDays)) : [];
  const overdue = active ? planned(sessions).filter((s) => s.date < today) : [];
  const allowed = (r, date) => !r.days?.length || r.days.includes(dow(date));
  const push = (r, date, title, body, tag) => { const when = at(date, r.time); if (when > now) oneOff.push({ id: hash(`${r.id}|${date}|${tag}`), title, body, at: when.toISOString() }); };
  for (const r of reminders.filter((x) => x.enabled)) {
    const kind = KINDS[r.kind] ? r.kind : 'custom'; const title = r.title || KINDS[kind].label;
    if (kind === 'workout') upcoming.forEach((s) => allowed(r, s.date) && push(r, s.date, r.title || 'Time to train', detailed ? `${s.name} (week ${s.week})` : 'Your BeFyn session is ready.', s.id));
    else if (kind === 'upcoming') upcoming.forEach((s) => { const d = addDays(s.date, -1); if (d >= today && allowed(r, d)) push(r, d, r.title || 'Tomorrow in BeFyn', detailed ? `${s.name} (week ${s.week})` : 'Your next session is tomorrow.', s.id); });
    else if (kind === 'missed') {
      // Only when a session really is overdue (or becomes overdue tomorrow); completing it reschedules and removes this.
      const next = overdue.length ? addDays(today, 1) : upcoming.length ? addDays(upcoming[0].date, 1) : null;
      if (next && allowed(r, next)) push(r, next, r.title || 'Ready when you are', 'No pressure. Pick your programme back up whenever you are ready.', 'missed');
    } else if (kind === 'milestone') {
      const lastOfWeek = new Map(); upcoming.forEach((s) => lastOfWeek.set(s.week, s)); // planned() is in seq order, so the last wins
      [...lastOfWeek].forEach(([w, s]) => allowed(r, s.date) && push(r, s.date, r.title || (detailed ? `Week ${w} check-in` : 'Weekly check-in'), 'Have a look at your progress this week.', `wk${w}`));
    } else {
      const [hour, minute] = String(r.time || '08:00').split(':').map(Number);
      for (const d of (r.days?.length ? r.days : [0, 1, 2, 3, 4, 5, 6])) repeating.push({ id: hash(`${r.id}|w${d}`), title, body: r.body || KINDS[kind].body || '', weekday: d, hour, minute });
    }
  }
  oneOff.sort((a, b) => (a.at < b.at ? -1 : 1));
  return { repeating, oneOff: oneOff.slice(0, MAX_ONE_OFF) };
}

/** Warns when too many reminders would land on the same day. */
export function overload(reminders, max = 5) {
  const per = Array(7).fill(0);
  reminders.filter((r) => r.enabled).forEach((r) => (r.days?.length ? r.days : [0, 1, 2, 3, 4, 5, 6]).forEach((d) => { per[d]++; }));
  return per.some((n) => n > max) ? [`More than ${max} reminders on some days may feel like too many.`] : [];
}
