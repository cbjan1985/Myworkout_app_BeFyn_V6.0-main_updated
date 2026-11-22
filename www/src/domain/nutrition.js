// Practical protein tracking. Estimates are always distinguishable from measured values.
import { sum, round1, addDays } from '../core/util.js';
export const MEALS = ['Breakfast', 'Lunch', 'Dinner', 'Snack', 'Shake / supplement'];

export function dayTotals(entries, date, target) {
  const day = entries.filter((e) => e.date === date);
  const total = round1(sum(day, (e) => e.proteinG));
  const estimated = round1(sum(day.filter((e) => e.estimate), (e) => e.proteinG));
  const byMeal = Object.fromEntries(MEALS.map((m) => [m, round1(sum(day.filter((e) => e.meal === m), (e) => e.proteinG))]));
  return { date, total, estimated, measured: round1(total - estimated), remaining: target ? Math.max(0, round1(target - total)) : null, pct: target ? Math.min(100, Math.round((total / target) * 100)) : null, count: day.length, byMeal, reached: !!target && total >= target };
}

export function history(entries, endDate, days, target) {
  const out = [];
  for (let i = days - 1; i >= 0; i--) out.push(dayTotals(entries, addDays(endDate, -i), target));
  return out;
}
export function weeklyAverage(entries, endDate, target) {
  const h = history(entries, endDate, 7, target).filter((d) => d.count > 0);
  return { daysLogged: h.length, average: h.length ? round1(sum(h, (d) => d.total) / h.length) : null, daysOnTarget: h.filter((d) => d.reached).length };
}
/** Common foods give a starting point only; every value is labelled as an estimate unless the user enters it. */
export const QUICK_FOODS = [
  { name: 'Egg (large)', proteinG: 6 }, { name: 'Greek yoghurt (150 g)', proteinG: 15 }, { name: 'Paneer (100 g)', proteinG: 18 },
  { name: 'Dal (1 cup, cooked)', proteinG: 12 }, { name: 'Chicken breast (100 g, cooked)', proteinG: 31 }, { name: 'Whey scoop', proteinG: 24 },
  { name: 'Milk (250 ml)', proteinG: 8 }, { name: 'Tofu (100 g)', proteinG: 8 }, { name: 'Peanuts (30 g)', proteinG: 8 },
];
