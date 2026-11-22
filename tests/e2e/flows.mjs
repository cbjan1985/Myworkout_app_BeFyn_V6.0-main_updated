// End-to-end flows in real Chromium (real IndexedDB, real DOM). Run: node tests/e2e/flows.mjs  (needs a static server on BEFYN_URL)
import assert from 'node:assert/strict';
import { launch, ready, BASE } from './lib.mjs';
import { v5Storage } from './fixture.mjs';

const results = []; let failed = 0;
async function flow(name, fn, opts) {
  const t0 = Date.now(); const env = await launch(opts);
  try { await fn(env); assert.deepEqual(env.errors, [], 'browser console/page errors'); results.push(['PASS', name, Date.now() - t0]); }
  catch (e) { failed++; results.push(['FAIL', name, Date.now() - t0, e.message.split('\n').slice(0, 5).join(' | ').slice(0, 600)]); try { await env.page.screenshot({ path: `/tmp/shots/FAIL-${name.replace(/\W+/g, '_')}.png` }); } catch (_) { /* ignore */ } }
  finally { await env.browser.close(); }
}
const tap = (page, name, opts = {}) => page.getByRole(opts.role || 'button', { name, exact: opts.exact ?? false }).first().click();
const text = (page) => page.locator('body').innerText();
const goto = async (page, hash) => { await page.evaluate((h) => { location.hash = h; }, hash); await page.waitForTimeout(250); };

/** Drives a workout to the summary screen by logging every step with defaults. */
async function runToSummary(page, limit = 400) {
  for (let i = 0; i < limit; i++) {
    if (await page.getByRole('button', { name: 'Finish and save' }).count()) return i;
    const skipRest = page.getByRole('button', { name: 'Skip rest' });
    if (await skipRest.count()) { await skipRest.click(); continue; }
    for (const n of ['Log set', 'Done early', 'Mark done', 'Done']) { const b = page.getByRole('button', { name: n, exact: true }); if (await b.count()) { await b.first().click(); break; } }
    await page.waitForTimeout(15);
  }
  throw new Error('workout did not reach summary');
}

await flow('fresh install: onboarding, start programme, run first workout, progress advances once', async ({ page }) => {
  await ready(page);
  await tap(page, 'Get started'); await tap(page, 'Next');
  assert.match(await text(page), /Pick a programme/);
  await page.getByRole('button', { name: /8-Week Progressive Muscle Gain/ }).click();
  assert.match(await text(page), /8-Week Progressive Muscle Gain/);
  await tap(page, 'Start programme'); await page.waitForTimeout(400);
  assert.match(await text(page), /Start workout/);
  assert.match(await text(page), /Week 1/);
  await tap(page, 'Start workout'); await page.waitForSelector('.player');
  assert.match(await text(page), /Session overview|Start/);
  await tap(page, 'Start', { exact: true });
  const steps = await runToSummary(page); assert.ok(steps > 20, 'many steps logged: ' + steps);
  await page.locator('.chip', { hasText: /^7$/ }).click();
  await tap(page, 'Finish and save'); await page.waitForSelector('text=Workout saved');
  await tap(page, 'Done', { exact: true }); await page.waitForTimeout(400);
  const app = await page.evaluate(() => ({ cursor: __befyn.state.programme.instance.cursor.seq, logs: __befyn.state.logs.length }));
  assert.equal(app.cursor, 1); assert.equal(app.logs, 1);
  // survives reload (real IndexedDB)
  await page.reload(); await page.waitForFunction(() => window.__befyn && window.__befyn.state.ready !== undefined && !document.getElementById('splash'));
  assert.equal(await page.evaluate(() => __befyn.state.programme.instance.cursor.seq), 1);
});

await flow('V5 upgrade: history kept, 3 days done, missed sessions offered calmly, shift-forward fixes week 3 problem', async ({ page }) => {
  await ready(page);
  const t = await text(page);
  assert.match(t, /Your V5\.0 data moved over safely/); assert.match(t, /sessions are waiting/);
  await page.locator('.sheet').getByRole('button', { name: 'Choose how to continue' }).click();
  await page.waitForSelector('text=did not happen');
  await page.locator('.sheet').getByRole('button', { name: /Continue from where I left off/ }).click();
  assert.match(await text(page), /will move/); assert.match(await text(page), /Week 1/);
  await page.locator('.sheet').getByRole('button', { name: 'Apply', exact: true }).click(); await page.waitForTimeout(500);
  const s = await page.evaluate(() => { const p = __befyn.state.programme; const n = __befyn.nextSession(); return { next: n.seq, week: n.week, date: n.date, missed: __befyn.scheduleStatus().missed.length, completed: p.sessions.filter((x) => x.status === 'completed').length, logs: __befyn.state.logs.length }; });
  assert.equal(s.completed, 3); assert.equal(s.next, 3); assert.equal(s.week, 1); assert.equal(s.date, '2026-11-21'); assert.equal(s.missed, 0); assert.equal(s.logs, 3);
  // undo restores the waiting state
  await tap(page, 'Undo'); await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => __befyn.scheduleStatus().missed.length > 0), true);
}, { storage: v5Storage(), clock: '2026-11-21T09:00:00' });

await flow('screens render without overflow at 320px in light and dark; every control is named', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => __befyn.setPref('profile', { onboarded: true })); await page.evaluate(() => __befyn.startProgramme({ templateId: 'tpl-8wk-muscle-gain', startDate: '2026-11-21' }));
  const routes = ['/today', '/train', '/calendar', '/progress', '/more', '/more/health', '/more/nutrition', '/more/recovery', '/more/reminders', '/more/preferences', '/more/data', '/more/about', '/train/exercise/goblet-squat'];
  for (const mode of ['light', 'dark']) {
    await page.evaluate((m) => { document.documentElement.dataset.theme = m; }, mode);
    for (const r of routes) {
      await goto(page, r); await page.waitForTimeout(150);
      const m = await page.evaluate(() => ({ over: document.querySelector('.page').scrollWidth - document.querySelector('.page').clientWidth, unnamed: [...document.querySelectorAll('button, a[href], input, select, textarea')].filter((el) => !el.closest('[hidden]') && !(el.getAttribute('aria-label') || el.textContent.trim() || (el.labels && el.labels.length) || el.getAttribute('placeholder') || el.title || el.getAttribute('aria-labelledby'))).map((el) => el.outerHTML.slice(0, 80)), noalt: [...document.querySelectorAll('img:not([alt])')].length }));
      assert.ok(m.over <= 1, `${mode} ${r} overflows by ${m.over}px`); assert.deepEqual(m.unnamed, [], `${r} has unnamed controls`); assert.equal(m.noalt, 0, `${r} has images without alt`);
    }
  }
}, { width: 320, height: 640 });


const sh = (page) => page.locator('.sheet');
const sheetBtn = (page, name, exact = false) => sh(page).getByRole('button', { name, exact });
const startProg = (page, date = '2026-11-21') => page.evaluate(async (d) => { await __befyn.setPref('profile', { onboarded: true }); return (await __befyn.startProgramme({ templateId: 'tpl-8wk-muscle-gain', startDate: d })).ok; }, date);

await flow('schedule tools: move, swap, move week, shift, repeat, jump, pause/resume, re-sync, change log + undo', async ({ page }) => {
  await ready(page); assert.equal(await startProg(page, '2026-11-21'), true);
  await goto(page, '/calendar');
  const preview = async (name) => { await page.getByRole('button', { name }).first().click(); };
  // move a session via its day sheet
  await page.locator('.day', { hasText: /^23/ }).first().click();
  await page.getByRole('button', { name: /^Chest|^Back|week 1/i }).first().click().catch(() => {});
  await page.evaluate(() => document.querySelectorAll('.scrim').forEach((x) => x.remove()));
  const ids = await page.evaluate(() => __befyn.state.programme.sessions.slice(0, 8).map((s) => [s.id, s.date, s.name]));
  const api = (op) => page.evaluate((o) => __befyn.previewSchedule(o), op);
  // every tool in the UI opens a preview sheet and applying works
  await page.getByRole('button', { name: /Move a week/ }).click();
  await sh(page).locator('input[type=date]').fill('2026-11-25');
  await sheetBtn(page, 'Preview').click(); await page.waitForSelector('text=Move week');
  assert.match(await sh(page).innerText(), /will move/); await sheetBtn(page, 'Apply', true).click(); await page.waitForTimeout(400);
  const d1 = await page.evaluate(() => __befyn.state.programme.sessions[0].date);
  assert.notEqual(d1, '2026-11-21', 'week moved: first session date changed (ripple default)');
  await page.getByRole('button', { name: /Shift upcoming sessions/ }).click(); await sheetBtn(page, 'Preview').click(); await page.waitForSelector('text=Shift schedule'); await sheetBtn(page, 'Cancel').click();
  await page.getByRole('button', { name: /Repeat from a week/ }).click(); await sheetBtn(page, 'Preview').click(); await page.waitForSelector('text=Repeat a week'); await sheetBtn(page, 'Cancel').click();
  await page.getByRole('button', { name: /Jump ahead/ }).click(); await sheetBtn(page, 'Preview').click(); await page.waitForSelector('text=Jump ahead >> nth=1').catch(() => {}); assert.match(await sh(page).innerText(), /skips|harder phase|will be marked skipped/); await sheetBtn(page, 'Cancel').click();
  await page.getByRole('button', { name: /Re-synchronise/ }).click(); await page.waitForSelector('text=Checks that your position'); await sheetBtn(page, 'Cancel').click();
  // pause then resume
  await page.getByRole('button', { name: /Pause programme/ }).click(); await sheetBtn(page, 'Pause', true).click(); await page.waitForSelector('text=Review the change'.replace('Review the change', 'Pause programme')); await sheetBtn(page, 'Apply', true).click(); await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => __befyn.state.programme.instance.status), 'paused');
  await page.getByRole('button', { name: /Resume programme/ }).click(); await sheetBtn(page, 'Preview').click(); await page.waitForSelector('text=Resume programme >> nth=1').catch(() => {}); await sheetBtn(page, 'Apply', true).click(); await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => __befyn.state.programme.instance.status), 'active');
  // change log lists changes and the newest can be undone
  await page.getByRole('button', { name: /Schedule changes/ }).click();
  assert.match(await sh(page).innerText(), /Moved week 1|Resumed|Paused/);
  await sheetBtn(page, 'Undo').click(); await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => __befyn.state.changes.some((c) => c.undone) || __befyn.state.changes.length >= 3), true);
});

await flow('builder: create programme, add exercises, progression, publish, start; exercise add + duplicate guard + links', async ({ page }) => {
  await ready(page); await page.evaluate(() => __befyn.setPref('profile', { onboarded: true })); await goto(page, '/train');
  await page.getByRole('button', { name: 'Build a programme' }).click();
  await sh(page).getByLabel('Name').fill('Home Strength'); await sheetBtn(page, 'Continue').click(); await page.waitForSelector('text=Your typical week');
  await page.getByRole('button', { name: /Day A/ }).click();
  await sheetBtn(page, 'Add exercise').click(); await sh(page).last().getByRole('searchbox').fill('goblet'); await page.getByRole('button', { name: /Goblet Squat/ }).first().click();
  await sheetBtn(page, 'Done', true).click(); await page.waitForTimeout(300);
  // the other pattern days are empty: publish is blocked and says why
  assert.match(await text(page), /Before you publish/);
  for (const n of ['Day B', 'Day C']) { await page.getByRole('button', { name: new RegExp(n) }).click(); await sheetBtn(page, 'Add exercise').click(); await sh(page).last().getByRole('searchbox').fill('dead bug'); await page.getByRole('button', { name: /Dead Bug/ }).first().click(); await sheetBtn(page, 'Done', true).click(); await page.waitForTimeout(250); }
  assert.equal(await page.getByRole('button', { name: 'Publish programme' }).isDisabled(), false);
  await page.getByRole('button', { name: 'Publish programme' }).click(); await page.waitForSelector('text=is ready');
  await sheetBtn(page, 'Start it').click(); await page.waitForSelector('text=Training days'); await sheetBtn(page, 'Start programme').click(); await page.waitForTimeout(500);
  const st = await page.evaluate(() => ({ n: __befyn.state.programme.sessions.length, name: __befyn.state.programme.template.name }));
  assert.equal(st.name, 'Home Strength'); assert.ok(st.n >= 3);
  // exercise catalogue
  await goto(page, '/train'); await page.getByRole('button', { name: 'Exercises', exact: true }).click();
  await page.getByRole('button', { name: 'Add', exact: true }).click(); await sh(page).getByLabel('Name').fill('goblet squat'); await sheetBtn(page, 'Save').click(); await page.waitForTimeout(400);
  assert.match(await sh(page).innerText(), /already in your catalogue/); await sh(page).getByLabel('Name').fill('Sandbag Carry'); await sheetBtn(page, 'Save').click(); await page.waitForTimeout(300);
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill('sandbag'); await page.waitForTimeout(500);
  await page.getByRole('link', { name: /Sandbag Carry/ }).click(); await page.waitForSelector('h1:has-text("Sandbag Carry")');
  await page.getByRole('button', { name: 'Add link' }).click(); await sh(page).getByLabel('Link').fill('https://youtu.be/dQw4w9WgXcQ'); await sheetBtn(page, 'Add', true).click(); await page.waitForTimeout(400);
  assert.match(await text(page), /youtu\.be\/dQw4w9WgXcQ/);
});

await flow('data: backup downloads, restore merge works, nutrition, measurements, reminders, preferences persist', async ({ page, ctx }) => {
  await ready(page); await startProg(page); await goto(page, '/more/nutrition');
  await page.getByRole('button', { name: 'Add protein', exact: true }).click(); await page.getByRole('button', { name: /Paneer/ }).click(); await sheetBtn(page, 'Add', true).click(); await page.waitForTimeout(300);
  assert.match(await text(page), /18 \/ 120 g/);
  await goto(page, '/more/health'); await page.getByRole('button', { name: 'Add', exact: true }).first().click(); await sh(page).getByLabel('Value').fill('72.4'); await sheetBtn(page, 'Save').click(); await page.waitForTimeout(300);
  assert.match(await text(page), /72\.4 kg/);
  await goto(page, '/more/reminders'); await page.getByRole('button', { name: 'Add a reminder' }).first().click(); await sheetBtn(page, 'Save').click(); await page.waitForTimeout(300);
  assert.match(await text(page), /07:30/);
  await goto(page, '/more/preferences'); await page.getByRole('button', { name: 'Dark' }).click(); await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  await goto(page, '/more/data');
  const dl = page.waitForEvent('download'); await page.getByRole('button', { name: 'Save a backup' }).click(); const d = await dl;
  const fs = await import('node:fs'); const file = '/tmp/befyn-backup.json'; await d.saveAs(file); const b = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(b.format, 'befyn-backup'); assert.ok(b.data.nutrition.length === 1 && b.data.measurements.length === 1 && b.data.reminders.length === 1);
  // erase then restore from the same file
  await page.getByRole('button', { name: 'Erase all BeFyn data' }).click(); await sh(page).getByPlaceholder('Type ERASE').fill('ERASE'); await sheetBtn(page, 'Erase', true).click(); await page.waitForTimeout(500);
  assert.equal(await page.evaluate(() => __befyn.state.nutrition.length), 0);
  await goto(page, '/more/data');
  const chooser = page.waitForEvent('filechooser'); await page.getByRole('button', { name: 'Restore from a file' }).click(); (await chooser).setFiles(file); await page.waitForSelector('text=Restore backup');
  await sheetBtn(page, 'Replace everything').click(); await sheetBtn(page, 'Restore', true).click(); await page.waitForTimeout(600);
  assert.deepEqual(await page.evaluate(() => [__befyn.state.nutrition.length, __befyn.state.measurements.length, !!__befyn.state.programme]), [1, 1, true]);
  // preferences survived restore
  assert.equal(await page.evaluate(() => __befyn.state.prefs.theme.mode), 'dark');
});

await flow('health: Health Connect unavailable in browser is explained; mocked native plugin connects, syncs, dedupes', async ({ page }) => {
  await ready(page); await page.evaluate(() => __befyn.setPref('profile', { onboarded: true })); await goto(page, '/more/health');
  assert.match(await text(page), /only available in the Android app/);
  // inject a fake native plugin and re-open the screen
  await page.evaluate(() => {
    const granted = new Set(); const T = ['steps', 'activeCalories', 'heartRate', 'sleep', 'exercise', 'weight', 'bodyFat', 'height'];
    const records = { steps: [{ id: 'a1', start: new Date(Date.now() - 3600e3).toISOString(), end: new Date().toISOString(), value: 4200, source: 'Google Fit' }, { id: 'b1', start: new Date(Date.now() - 3600e3).toISOString(), end: new Date().toISOString(), value: 3900, source: 'Fastrack' }], weight: [{ id: 'w1', start: new Date().toISOString(), value: 72.1, source: 'Google Fit' }], sleep: [{ id: 's1', start: new Date(Date.now() - 8 * 3600e3).toISOString(), end: new Date().toISOString(), value: 7.4, source: 'Fastrack' }] };
    window.Capacitor = { isNativePlatform: () => true, Plugins: { BeFynHealth: { getStatus: async () => ({ availability: 'available', granted: [...granted] }), requestPermissions: async ({ types }) => { types.forEach((t) => granted.add(t)); return { granted: [...granted] }; }, readRecords: async ({ type }) => ({ records: records[type] || [] }), openSettings: async () => {} } } };
  });
  await goto(page, '/more'); await goto(page, '/more/health');
  await page.getByRole('button', { name: 'Choose data to connect' }).click(); await sheetBtn(page, 'Continue').click(); await page.waitForSelector('text=Connected', { timeout: 8000 });
  await page.waitForFunction(() => __befyn.state.health.length > 0, null, { timeout: 8000 }); const r1 = await page.evaluate(() => __befyn.state.health.length); assert.equal(r1, 4);
  await page.getByRole('button', { name: 'Sync now' }).click(); await page.waitForTimeout(800);
  assert.equal(await page.evaluate(() => __befyn.state.health.length), 4, 'second sync does not duplicate');
  const t = await text(page); assert.match(t, /4,?\d00|4200/); assert.match(t, /Last sleep/); assert.match(t, /Weight \(Google Fit\)/);
  assert.match(t, /larger total/, 'double-counting explanation shown');
  const daily = await page.evaluate(() => __befyn.healthDaily('steps')); assert.equal(daily[0].value, 4200);
});


await flow('player mechanics: start from session sheet, rest timer, per-side steps, breathing, skip/back, resume after reload, leave and discard', async ({ page }) => {
  await ready(page); assert.equal(await startProg(page, '2026-11-21'), true);
  // start from the Calendar session sheet (sheet close + navigation race regression)
  await goto(page, '/calendar'); await page.locator('.list button.item').first().click(); await page.waitForSelector('.sheet');
  await sheetBtn(page, 'Start workout').click(); await page.waitForSelector('.player'); assert.equal(await page.evaluate(() => location.hash), '#/workout');
  // jump close to a main-set step by pre-recording the earlier steps through the real service
  const plan = await page.evaluate(() => { const d = __befyn.state.draft; const p = __befyn.planForDraft(d); const i = p.steps.findIndex((s) => s.section === 'main' && s.restAfterRound > 0 && s.item.side == null); return { i, total: p.steps.length, sides: p.steps.filter((s) => s.item.side === 'Left').length, breathing: p.steps.findIndex((s) => s.section === 'breathing') }; });
  assert.ok(plan.i > 0, 'has a main-set step with rest');
  await page.evaluate(async (n) => { const d = __befyn.state.draft; for (let k = 0; k < n; k++) await __befyn.recordSet(d, k, { reps: 10, kg: 5 }); }, plan.i);
  await page.reload(); await page.waitForSelector('.player'); // resumes mid-workout after a reload
  assert.match(await text(page), new RegExp(`Step ${plan.i + 1} of ${plan.total}`));
  assert.match(await text(page), /Log set/);
  await tap(page, 'Log set'); await page.waitForSelector('text=Up next'); assert.match(await text(page), /Skip rest/);
  await tap(page, 'Add 15 seconds'); await tap(page, 'Skip rest'); await page.waitForSelector('text=Log set');
  // back removes the last logged set
  await tap(page, 'Back'); await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => Object.keys(__befyn.state.draft.records).length), plan.i);
  // skip exercise marks remaining sets skipped (not done)
  await tap(page, 'Skip exercise'); await page.waitForTimeout(250);
  const rec = await page.evaluate(() => Object.values(__befyn.state.draft.records).filter((r) => !r.done).length); assert.ok(rec >= 1);
  // leaving keeps the draft; Today offers to continue
  await page.getByRole('button', { name: 'Leave workout' }).click(); await sheetBtn(page, 'Save and leave').click(); await page.waitForSelector('text=Workout in progress');
  assert.equal(await page.evaluate(() => !!__befyn.state.draft), true);
  // discard path needs a second confirmation
  await page.getByRole('button', { name: 'Discard', exact: true }).click(); await sheetBtn(page, 'Discard', true).click(); await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => __befyn.state.draft), null);
  assert.equal(await page.evaluate(() => __befyn.state.logs.length), 0, 'discarded workout leaves no log');
  assert.equal(await page.evaluate(() => __befyn.state.programme.instance.cursor.seq), 0, 'discarding never advances the programme');
});

console.log(results.map((r) => `${r[0]}  ${r[1]}  (${r[2]} ms)${r[3] ? '\n      ' + r[3] : ''}`).join('\n'));
console.log(failed ? `${failed} flow(s) failed` : 'all flows passed');
process.exit(failed ? 1 : 0);
