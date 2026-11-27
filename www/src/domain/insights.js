// Progress and recovery insights. Explainable by construction: every output lists its basis and what is missing.
// Not medical advice; nothing here changes a programme.
import { addDays, diffDays, sum, round1, clamp } from '../core/util.js';

export function sessionsPerWeek(logs, endDate, weeks = 8) {
  const out = [];
  for (let w = weeks - 1; w >= 0; w--) {
    const to = addDays(endDate, -7 * w), from = addDays(to, -6);
    out.push({ from, to, count: logs.filter((l) => l.status === 'completed' && l.date >= from && l.date <= to).length });
  }
  return out;
}

/** Session load units: minutes x effort (1-10) when effort was given; minutes x 5 otherwise (flagged as estimated). */
export function sessionLoad(log) {
  const min = (log.durationSec || 0) / 60;
  const effort = log.feedback?.effort;
  return { load: Math.round(min * (effort || 5)), estimated: !effort };
}

export function trainingLoad(logs, today) {
  const done = logs.filter((l) => l.status === 'completed');
  const within = (from, to) => done.filter((l) => l.date >= from && l.date <= to);
  const acute = within(addDays(today, -6), today), chronic = within(addDays(today, -27), today);
  const a = sum(acute, (l) => sessionLoad(l).load), c = sum(chronic, (l) => sessionLoad(l).load) / 4;
  const ratio = c > 0 ? round1(a / c) : null;
  return { acute: a, chronicWeekly: Math.round(c), ratio, sessions7: acute.length, sessions28: chronic.length, estimatedShare: done.length ? round1(done.filter((l) => sessionLoad(l).estimated).length / done.length) : 0 };
}

/**
 * Plain-language readiness. Uses only what exists; lists missing inputs; never prescribes changes.
 * health: { sleepHours?: number|null, restingHr?: number|null, sleepSource?: string }
 */
export function readiness(logs, today, health = {}) {
  const done = logs.filter((l) => l.status === 'completed').sort((a, b) => (a.date < b.date ? 1 : -1));
  const basis = [], missing = []; let score = 70;
  if (!done.length) return { level: 'unknown', headline: 'Not enough history yet', basis: [], missing: ['Complete a few sessions to see recovery context.'], note: DISCLAIMER };
  const daysSince = diffDays(today, done[0].date);
  if (daysSince === 0) { basis.push('You trained today.'); score -= 10; } else if (daysSince === 1) { basis.push('You trained yesterday.'); score -= 5; } else if (daysSince >= 2) { basis.push(`${daysSince} days since your last session.`); score += 5; }
  let streak = 0; for (let i = 0; i < 14; i++) { if (done.some((l) => l.date === addDays(today, -i))) streak++; else if (i > 0) break; }
  if (streak >= 4) { basis.push(`${streak} training days in a row.`); score -= 15; }
  const tl = trainingLoad(logs, today);
  if (tl.ratio != null && tl.sessions28 >= 6) {
    if (tl.ratio > 1.5) { basis.push('This week is much heavier than your recent average.'); score -= 15; } else if (tl.ratio < 0.6) { basis.push('This week is lighter than your recent average.'); score += 5; } else basis.push('This week is in line with your recent average.');
  } else missing.push('A few more weeks of sessions will make load trends meaningful.');
  if (health.sleepHours != null) { basis.push(`Sleep last night: ${round1(health.sleepHours)} h${health.sleepSource ? ' (' + health.sleepSource + ')' : ''}.`); score += health.sleepHours >= 7 ? 8 : health.sleepHours < 6 ? -12 : 0; } else missing.push('Sleep data is not connected.');
  score = clamp(score, 0, 100);
  const level = score >= 65 ? 'good' : score >= 45 ? 'moderate' : 'low';
  const headline = { good: 'You look ready to train', moderate: 'A steady session suits today', low: 'Consider an easier day or rest' }[level];
  return { level, score, headline, basis, missing, note: DISCLAIMER };
}
export const DISCLAIMER = 'A general guide based on your logged training. It is not medical advice and never changes your programme on its own.';

/** performances: [{date, exercise, muscles:[...], sets:[...]}] -> sets per muscle group over the last N days */
export function muscleActivity(performances, today, days = 14) {
  const from = addDays(today, -(days - 1)); const m = {};
  for (const p of performances) {
    if (p.date < from || p.date > today) continue;
    const n = (p.sets || []).filter((s) => s.done !== false).length; if (!n) continue;
    for (const mu of p.muscles?.length ? p.muscles : ['Other']) m[mu] = (m[mu] || 0) + n;
  }
  return Object.entries(m).map(([muscle, sets]) => ({ muscle, sets })).sort((a, b) => b.sets - a.sets);
}

/** Least-squares slope per week for [{date,value}]; null when fewer than 3 points or <14 day span. */
export function trend(points) {
  const p = [...points].filter((x) => x.value != null).sort((a, b) => (a.date < b.date ? -1 : 1));
  if (p.length < 3 || diffDays(p[p.length - 1].date, p[0].date) < 14) return null;
  const x0 = p[0].date, xs = p.map((q) => diffDays(q.date, x0)), ys = p.map((q) => q.value);
  const mx = sum(xs) / xs.length, my = sum(ys) / ys.length;
  const den = sum(xs, (x) => (x - mx) ** 2); if (!den) return null;
  const slope = sum(xs.map((x, i) => (x - mx) * (ys[i] - my))) / den;
  return { perWeek: round1(slope * 7), first: ys[0], last: ys[ys.length - 1], points: p.length };
}

export function describeTrend(t, unit, label) {
  if (!t) return `Not enough ${label} entries yet. Log a few over two weeks or more to see a trend.`;
  const dir = Math.abs(t.perWeek) < 0.05 ? 'is steady' : t.perWeek > 0 ? `is rising about ${Math.abs(t.perWeek)} ${unit} a week` : `is falling about ${Math.abs(t.perWeek)} ${unit} a week`;
  return `Your ${label} ${dir} (${t.points} entries). This shows direction only, not the cause.`;
}

/** Training load per week (oldest first) for the recovery trend chart. */
export function weeklyLoad(logs, endDate, weeks = 8) {
  const out = [];
  for (let w = weeks - 1; w >= 0; w--) {
    const to = addDays(endDate, -7 * w), from = addDays(to, -6);
    const inWeek = logs.filter((l) => l.status === 'completed' && l.date >= from && l.date <= to);
    out.push({ from, to, load: sum(inWeek, (l) => sessionLoad(l).load), sessions: inWeek.length });
  }
  return out;
}
