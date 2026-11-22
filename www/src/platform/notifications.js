import { plugin, isApp } from './env.js';

export const REMINDER_KINDS = {
  workout: { label: 'Workout time', body: 'Your BeFyn session is ready when you are.' },
  upcoming: { label: 'Upcoming session', body: 'Your next BeFyn session is coming up.' },
  missed: { label: 'Gentle nudge after a missed session', body: 'No pressure. Pick your programme back up whenever you are ready.' },
  recovery: { label: 'Recovery check-in', body: 'A good moment to stretch, hydrate and rest.' },
  milestone: { label: 'Milestone', body: 'You reached a programme milestone. Take a look at your progress.' },
  protein: { label: 'Protein check', body: 'How is your protein target looking today?' },
  hydration: { label: 'Hydration', body: 'Time for some water.' },
  custom: { label: 'Custom reminder', body: '' },
};
export const MAX_PER_DAY = 5;

const hash = (s) => { let h = 7; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h) % 1000000; };
const LN = () => (isApp() ? plugin('LocalNotifications') : null);

export const supported = () => !!LN();
export async function permission() {
  const L = LN(); if (!L) return 'unsupported';
  try { const r = await L.checkPermissions(); return r.display; } catch (_) { return 'unsupported'; }
}
export async function requestPermission() {
  const L = LN(); if (!L) return 'unsupported';
  try { const r = await L.requestPermissions(); return r.display; } catch (_) { return 'unsupported'; }
}

/** Avoids notification overload: reports days that exceed MAX_PER_DAY enabled reminders. */
export function validate(reminders) {
  const problems = [];
  for (let d = 0; d < 7; d++) {
    const n = reminders.filter((r) => r.enabled && (!r.days?.length || r.days.includes(d))).length;
    if (n > MAX_PER_DAY) problems.push(`More than ${MAX_PER_DAY} reminders on some days may feel like too many.`);
  }
  return [...new Set(problems)];
}

/** Replaces all scheduled BeFyn reminders with the enabled ones (weekly repeating, delivered while idle). */
export async function scheduleAll(reminders) {
  const L = LN(); if (!L) return { ok: false, reason: 'unsupported' };
  try {
    const pending = await L.getPending();
    if (pending.notifications?.length) await L.cancel({ notifications: pending.notifications });
    const items = [];
    for (const r of reminders.filter((x) => x.enabled)) {
      const [hour, minute] = String(r.time || '08:00').split(':').map(Number);
      const days = r.days?.length ? r.days : [0, 1, 2, 3, 4, 5, 6];
      for (const d of days) items.push({ id: hash(r.id) * 8 + d, title: r.title || REMINDER_KINDS[r.kind]?.label || 'BeFyn', body: r.body || REMINDER_KINDS[r.kind]?.body || '', schedule: { on: { weekday: d + 1, hour, minute }, allowWhileIdle: true }, smallIcon: 'ic_stat_befyn' });
    }
    if (items.length) await L.schedule({ notifications: items });
    return { ok: true, count: items.length };
  } catch (e) { return { ok: false, reason: 'error', message: String((e && e.message) || e) }; }
}
