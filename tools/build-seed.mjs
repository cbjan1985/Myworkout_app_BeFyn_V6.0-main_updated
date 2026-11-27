// Converts the V5.0 hard-coded plan (legacy/plan_v4.js) into FiT85 seed data:
//   www/assets/seed/programme-8wk-muscle-gain.json  (ProgrammeTemplate, published v1)
//   www/assets/seed/exercises.json                  (Exercise Master records)
// Run: node tools/build-seed.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'legacy/plan_v4.js'), 'utf8');
const ctx = {};
vm.createContext(ctx);
vm.runInContext(src + ';this.PLAN4=PLAN4;', ctx);
const PLAN4 = ctx.PLAN4;


import { makeRegistry, convertDay, DAY_ORDER, signature, sigHash } from '../www/src/data/legacy-convert.js';

const reg = makeRegistry(PLAN4.exd);
const exercises = reg.map;
const diag = {};
const sessions = [];
for (const w of Object.keys(PLAN4.plan).map(Number).sort((a, b) => a - b)) {
  for (const d of DAY_ORDER) {
    const day = PLAN4.plan[w][d];
    if (day) sessions.push(convertDay({ week: w, dow: d, day, reg, diag }));
  }
}

const template = {
  id: 'tpl-8wk-muscle-gain', name: '8-Week Progressive Muscle Gain', version: 1, status: 'published',
  objective: 'Hypertrophy, strength, cardio, breathing and mobility with dumbbells (3 kg and 5 kg), flat/incline bench and step board.',
  description: 'Imported from the V5.0 programme. Weeks 1-2 use straight sets; from week 3 the main work uses supersets, tri-sets and drop sets. Sunday is active recovery.',
  weeks: 8, weeklyFrequency: 6,
  phases: [
    { id: 'p1', name: 'Foundation (straight sets)', fromWeek: 1, toWeek: 2, technique: 'straight' },
    { id: 'p2', name: 'Progression (supersets, tri-sets, drop sets)', fromWeek: 3, toWeek: 8, technique: 'superset' },
  ],
  progression: { mode: 'completion', note: 'Advance the programme cursor only when a session is completed.' },
  legacySignature: sigHash(signature(PLAN4.plan)), sessions, guide: PLAN4.guide || [], source: 'v5.0-import', createdAt: '2026-11-21T00:00:00.000Z',
};

const outDir = path.join(root, 'www/assets/seed');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'programme-8wk-muscle-gain.json'), JSON.stringify(template));
fs.writeFileSync(path.join(outDir, 'exercises.json'), JSON.stringify([...exercises.values()]));
const bytes = (f) => fs.statSync(path.join(outDir, f)).size;
console.log('sessions', sessions.length, 'exercises', exercises.size, 'blocks', diag);
console.log('template bytes', bytes('programme-8wk-muscle-gain.json'), 'exercises bytes', bytes('exercises.json'));
const missing = [...exercises.values()].filter((e) => !e.instructions).length;
console.log('exercises without instructions', missing);
