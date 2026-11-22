import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { memoryAdapter, createRepos, counts } from '../www/src/data/db.js';
import { exportBackup, importBackup, validateBackup } from '../www/src/data/backup.js';
import { rowsFromTemplate, templateFromRows } from '../www/src/data/spreadsheet.js';
import { validateTemplate } from '../www/src/domain/programme.js';

const rd = (f) => JSON.parse(fs.readFileSync(new URL('../www/assets/seed/' + f, import.meta.url)));
const tpl = rd('programme-8wk-muscle-gain.json'), exs = rd('exercises.json');

async function seeded() {
  const repos = createRepos(memoryAdapter());
  await repos.write([repos.templates.op(tpl), ...exs.map((e) => repos.exercises.op(e)),
    repos.logs.appendOp({ id: 'l1', date: '2026-11-02', name: 'x', status: 'completed', performances: [] }), repos.nutrition.op({ id: 'n1', date: '2026-11-02', meal: 'Lunch', proteinG: 30, estimate: true })]);
  return repos;
}

test('backup round-trips: replace restores identical counts', async () => {
  const a = await seeded(); const b = await exportBackup(a);
  assert.deepEqual(validateBackup(JSON.parse(JSON.stringify(b))), []);
  const c = createRepos(memoryAdapter());
  const r = await importBackup(c, JSON.parse(JSON.stringify(b)), { mode: 'replace' });
  assert.ok(r.ok);
  const ca = await counts(a), cc = await counts(c); delete ca.meta; delete cc.meta;
  assert.deepEqual(cc, ca);
});

test('merge never overwrites an existing log and reports skips', async () => {
  const a = await seeded(); const b = await exportBackup(a);
  b.data.logs[0].name = 'tampered';
  const r = await importBackup(a, b, { mode: 'merge' });
  assert.ok(r.ok); assert.ok(r.skipped > 0);
  assert.equal((await a.logs.get('l1')).name, 'x');
});

test('rejects malformed, foreign and newer-schema backups safely', async () => {
  const a = await seeded();
  assert.ok(validateBackup({}).length); assert.ok(validateBackup(null).length);
  const b = await exportBackup(a); b.schema = 99; assert.match(validateBackup(b)[0], /newer version/);
  const c = await exportBackup(a); c.data.scheduled = [{ id: 's', instanceId: 'missing' }];
  assert.ok(validateBackup(c).length);
  const before = await counts(a);
  const r = await importBackup(a, c, { mode: 'replace' }); assert.equal(r.ok, false);
  assert.deepEqual(await counts(a), before);
});

test('replace keeps a safety snapshot of the data it replaced', async () => {
  const a = await seeded(); const b = await exportBackup(a);
  await a.logs.append({ id: 'l2', date: '2026-11-03', name: 'y', status: 'completed', performances: [] });
  await importBackup(a, b, { mode: 'replace' });
  const snap = await a.meta.get('backup.pre-restore');
  assert.equal(snap.snapshot.data.logs.length, 2);
  assert.equal((await a.logs.all()).length, 1);
});

test('published templates are immutable; logs are append-only with auditable correction', async () => {
  const a = await seeded();
  const r = await a.templates.save({ ...tpl, name: 'hacked' }); assert.equal(r.ok, false); assert.equal(r.error.code, 'immutable');
  assert.equal((await a.logs.append({ id: 'l1', date: 'x' })).ok, false);
  const c = await a.logs.correct('l1', { notes: 'fixed typo' }, 'typo'); assert.ok(c.ok);
  const l = await a.logs.get('l1'); assert.equal(l.revisions.length, 1); assert.equal(l.revisions[0].previous.notes, undefined);
});

test('archiving a template keeps instances and logs', async () => {
  const a = await seeded(); await a.write([a.instances.op({ id: 'i', templateId: tpl.id, templateVersion: 1, status: 'active' })]);
  await a.templates.archive(tpl.id);
  assert.equal((await a.templates.get(tpl.id, 1)).status, 'archived');
  assert.ok(await a.instances.get('i')); assert.ok(await a.logs.get('l1'));
});

test('health upsert deduplicates by source + external id', async () => {
  const a = createRepos(memoryAdapter());
  const rec = { id: 'h1', extKey: 'hc:steps:abc', type: 'steps', value: 1000, start: '2026-11-02T00:00:00Z', end: '2026-11-02T23:59:00Z', source: 'Google Fit' };
  assert.deepEqual(await a.health.upsertMany([rec]), { added: 1, updated: 0 });
  const again = await a.health.upsertMany([{ ...rec, id: 'h2', value: 1200 }]);
  assert.equal(again.added, 0); assert.equal(again.updated, 1);
  const all = await a.health.all(); assert.equal(all.length, 1); assert.equal(all[0].value, 1200); assert.equal(all[0].id, 'h1');
});

test('spreadsheet round-trip: template -> rows -> template keeps sessions, blocks and exercises', () => {
  const rows = rowsFromTemplate(tpl);
  const idx = new Map(exs.map((e) => [e.name.toLowerCase().replace(/[^a-z0-9]+/g, ''), e.id]));
  const { draft, issues } = templateFromRows(rows, { name: 'RT', exerciseIndex: idx });
  assert.ok(draft, issues.join('; '));
  assert.equal(draft.sessions.length, tpl.sessions.length);
  const count = (t) => t.sessions.reduce((n, s) => n + Object.values(s.sections).reduce((m, b) => m + b.reduce((k, x) => k + (x.items || [x]).length, 0), 0), 0);
  assert.equal(count(draft), count(tpl));
  assert.deepEqual(validateTemplate(draft), []);
  const ss = draft.sessions.find((s) => s.id.startsWith('w3-') && s.sections.main.some((b) => b.type === 'superset'));
  assert.ok(ss, 'supersets survive the round trip');
});

test('spreadsheet import reports row-level problems instead of throwing', () => {
  const r = templateFromRows([['Week', 'Session', 'Exercise', 'Sets'], ['x', 'A', 'Squat', 3], [1, 'A', '', 3], [1, 'A', 'Squat', -2]]);
  assert.equal(r.draft, null); assert.ok(r.issues.length >= 2);
  assert.ok(templateFromRows([['Foo']]).issues[0].includes('Week'));
});
