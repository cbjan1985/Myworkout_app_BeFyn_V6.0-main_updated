import { plugin, isApp } from './env.js';

import { KINDS, overload } from '../domain/reminders.js';
export const REMINDER_KINDS = KINDS;
export const MAX_PER_DAY = 5;

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

export const validate = (reminders) => overload(reminders, MAX_PER_DAY);

/** Replaces every scheduled FiT85 notification with the given plan {repeating, oneOff}. */
export async function scheduleAll(plan) {
  const L = LN(); if (!L) return { ok: false, reason: 'unsupported' };
  try {
    const pending = await L.getPending();
    if (pending.notifications?.length) await L.cancel({ notifications: pending.notifications });
    const items = [
      ...plan.repeating.map((r) => ({ id: r.id, title: r.title, body: r.body, schedule: { on: { weekday: r.weekday + 1, hour: r.hour, minute: r.minute }, allowWhileIdle: true }, smallIcon: 'ic_stat_fit85' })),
      ...plan.oneOff.map((o) => ({ id: o.id, title: o.title, body: o.body, schedule: { at: new Date(o.at), allowWhileIdle: true }, smallIcon: 'ic_stat_fit85' })),
    ];
    if (items.length) await L.schedule({ notifications: items });
    return { ok: true, count: items.length, repeating: plan.repeating.length, oneOff: plan.oneOff.length };
  } catch (e) { return { ok: false, reason: 'error', message: String((e && e.message) || e) }; }
}
