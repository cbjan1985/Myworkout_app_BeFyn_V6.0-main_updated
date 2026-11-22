// Builds a realistic V5.0 localStorage state (the shape V5.0's own code writes) for migration tests.
import fs from 'node:fs';
import vm from 'node:vm';
const ctx = {}; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(new URL('../../legacy/plan_v4.js', import.meta.url), 'utf8') + ';this.P=PLAN4', ctx);
const PLAN4 = ctx.P; const cp = (x) => JSON.parse(JSON.stringify(x));
export function v5State({ completedDays = ['2026-11-02', '2026-11-03', '2026-11-04'] } = {}) {
  const W = {};
  for (const w of Object.keys(PLAN4.plan)) { W[w] = {}; for (const d of Object.keys(PLAN4.plan[w])) {
    const s = PLAN4.plan[w][d], o = [];
    cp(s.ex).forEach((e) => { if (/\/(side|leg|arm|hand)\b/.test(e.rt)) ['Left', 'Right'].forEach((sd) => { const x = cp(e); x.sd = sd; o.push(x); }); else o.push(e); });
    W[w][d] = { name: s.name, ex: o };
  } }
  const logs = []; const startMs = Date.UTC(2026, 10, 2);
  completedDays.forEach((date, i) => {
    const day = PLAN4.plan[1][[1, 2, 3, 4, 5, 6, 0][i]];
    day.ex.filter((e) => e.c === 'main').slice(0, 6).forEach((e) => { for (let s = 0; s < (e.sets || 1); s++) logs.push({ d: date, r: `Week 1 - ${day.name}`, e: e.n, c: 'main', m: e.m, reps: e.reps || 10, kg: 5, s: 0, sets: e.sets, rt: e.rt, rs: 45 }); });
  });
  return { logs, set: { rest: 50, brk: 90, tr: 10, brb: 30, rep: 4 }, voice: true, br: { i: 4, h: 0, o: 6, h2: 0 }, apps: [], ov: {}, prog: { weeks: W, v4: 1 }, sess: {}, lib: [{ id: 'c1', n: 'Zottman Curl', m: 'Arms', yt: 'https://youtu.be/dQw4w9WgXcQ' }], ytl: {}, libHide: {}, tpl: [] };
}
export const v5Storage = (opts) => ({ 'myWorkouts.v3': JSON.stringify(v5State(opts)) });
