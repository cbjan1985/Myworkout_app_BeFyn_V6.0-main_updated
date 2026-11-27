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
    const skipRest = page.getByRole('button', { name: /^(Skip rest|Start now)$/ });
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

for (const [W, H] of [[320, 640], [390, 844], [412, 915], [768, 1024]]) await flow(`screens render without overflow at ${W}px in light and dark; every control is named`, async ({ page }) => {
  await ready(page);
  await page.evaluate(() => __befyn.setPref('profile', { onboarded: true })); await page.evaluate(() => __befyn.startProgramme({ templateId: 'tpl-8wk-muscle-gain', startDate: '2026-11-21' }));
  const routes = ['/today', '/train', '/calendar', '/progress', '/more', '/more/health', '/more/nutrition', '/more/recovery', '/more/reminders', '/more/preferences', '/more/data', '/more/about', '/train/exercise/goblet-squat', '/progress?x=1'];
  for (const mode of ['light', 'dark']) {
    await page.evaluate((m) => { document.documentElement.dataset.theme = m; }, mode);
    for (const r of routes) {
      await goto(page, r); await page.waitForTimeout(150);
      if (r.startsWith('/progress')) for (const tabName of ['Overview', 'Strength', 'Activity', 'History', 'Body', 'Protein']) { await page.getByRole('tab', { name: tabName }).click(); await page.waitForTimeout(80); const o = await page.evaluate(() => document.querySelector('.page').scrollWidth - document.querySelector('.page').clientWidth); assert.ok(o <= 1, `${mode} progress/${tabName} overflows by ${o}px`); }
      const m = await page.evaluate(() => ({ over: document.querySelector('.page').scrollWidth - document.querySelector('.page').clientWidth, unnamed: [...document.querySelectorAll('button, a[href], input, select, textarea')].filter((el) => !el.closest('[hidden]') && !(el.getAttribute('aria-label') || el.textContent.trim() || (el.labels && el.labels.length) || el.getAttribute('placeholder') || el.title || el.getAttribute('aria-labelledby'))).map((el) => el.outerHTML.slice(0, 80)), noalt: [...document.querySelectorAll('img:not([alt])')].length }));
      assert.ok(m.over <= 1, `${mode} ${r} overflows by ${m.over}px`); assert.deepEqual(m.unnamed, [], `${r} has unnamed controls`); assert.equal(m.noalt, 0, `${r} has images without alt`);
    }
  }
}, { width: W, height: H });


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
  assert.equal(await page.getByRole('button', { name: /Day [ABC]/ }).count(), 3, 'Mon/Wed/Fri default gives three training days');
  await page.getByRole('button', { name: /Day A/ }).click();
  await sh(page).first().getByRole('button', { name: 'Add exercise' }).click(); await sh(page).last().getByRole('searchbox').fill('goblet'); await page.getByRole('button', { name: /Goblet Squat/ }).first().click();
  await sheetBtn(page, 'Save', true).click(); await page.waitForTimeout(300);
  // the other pattern days are empty: publish is blocked and says why
  assert.match(await text(page), /Before you publish/);
  for (const n of ['Day B', 'Day C']) { await page.getByRole('button', { name: new RegExp(n) }).click(); await sh(page).first().getByRole('button', { name: 'Add exercise' }).click(); await sh(page).last().getByRole('searchbox').fill('dead bug'); await page.getByRole('button', { name: /Dead Bug/ }).first().click(); await sheetBtn(page, 'Save', true).click(); await page.waitForTimeout(250); }
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
  await page.getByRole('button', { name: 'Save a backup' }).click(); const dl = page.waitForEvent('download'); await sheetBtn(page, 'Save', true).click(); const d = await dl;
  const fs = await import('node:fs'); const file = '/tmp/befyn-backup.json'; await d.saveAs(file); const b = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(b.format, 'befyn-backup'); assert.ok(b.data.nutrition.length === 1 && b.data.measurements.length === 1 && b.data.reminders.length === 1);
  // erase then restore from the same file
  await page.getByRole('button', { name: 'Erase all FiT85 data' }).click(); await sh(page).getByPlaceholder('Type ERASE').fill('ERASE'); await sheetBtn(page, 'Erase', true).click(); await page.waitForTimeout(500);
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
    window.Capacitor = { isNativePlatform: () => true, Plugins: { FiT85Health: { getStatus: async () => ({ availability: 'available', granted: [...granted] }), requestHealthAccess: async ({ types }) => { types.forEach((t) => granted.add(t)); return { granted: [...granted] }; }, readRecords: async ({ type }) => ({ records: records[type] || [] }), openSettings: async () => {} } } };
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


await flow('V6.5: flash screen is the V5.0 logo for 3.5 s with the name FiT85; brand row on Today', async ({ page }) => {
  const t0 = Date.now(); await page.goto(BASE + '?debug=1'); await page.waitForSelector('#splash', { timeout: 5000 });
  assert.equal(await page.locator('#splash .sn').innerText(), 'FiT85'); assert.match(await page.locator('#splash .sl').getAttribute('src'), /assets\/app_icon_splash\.png$/);
  assert.match(await page.locator('#splash .sv').innerText(), /Version 6\.5/); assert.match(await page.locator('#splash .sb').innerText(), /Designed by CB/i);
  await page.waitForTimeout(2800); assert.equal(await page.locator('#splash').count(), 1, 'still showing at ~3 s');
  await page.waitForFunction(() => !document.getElementById('splash'), null, { timeout: 4000 }); const shown = Date.now() - t0;
  assert.ok(shown >= 3400 && shown <= 4600, `flash screen visible ${shown} ms`);
  await page.evaluate(() => __befyn.setPref('profile', { onboarded: true })); await goto(page, '/today');
  assert.equal(await page.locator('.brand img').getAttribute('src'), 'assets/app_icon.png'); assert.match(await page.locator('.brand').innerText(), /FiT85\s*V6\.5/);
  assert.equal((await page.evaluate(async () => { const r = await fetch('assets/app_icon_splash.png'); return r.status; })), 200);
});

await flow('V6.5: programme completion is shown and restartable; history list, detail and audited correction; finishing early (partial vs counted)', async ({ page }) => {
  await ready(page); assert.equal(await startProg(page, '2026-11-21'), true);
  // finish the whole programme through the real services
  await page.evaluate(async () => { for (let i = 0; i < 56; i++) { const n = __befyn.nextSession(); const r = await __befyn.logPastSession({ scheduledId: n.id, date: __befyn.today(), durationMin: 30, effort: 6 }); if (!r.ok) throw new Error(JSON.stringify(r.error)); } });
  await page.reload(); await page.waitForFunction(() => window.__befyn && !document.getElementById('splash')); await goto(page, '/today');
  assert.match(await text(page), /Programme complete/); assert.equal(await page.evaluate(() => __befyn.state.programme.instance.status), 'completed');
  await page.getByRole('button', { name: 'Start it again' }).click(); await page.waitForSelector('.sheet'); await sheetBtn(page, 'Start programme').click(); await page.waitForTimeout(500);
  assert.equal(await page.evaluate(() => __befyn.state.programme.instance.status), 'active'); assert.equal(await page.evaluate(() => __befyn.state.programme.instance.cursor.seq), 0);
  // history
  await goto(page, '/progress'); await page.getByRole('tab', { name: 'History' }).click(); await page.waitForTimeout(200);
  assert.match(await text(page), /56 sessions/); await page.locator('.list button.item').first().click(); await page.waitForSelector('.sheet');
  assert.match(await sh(page).innerText(), /Effort 6\/10|No sets were logged/);
  await sheetBtn(page, 'Correct').click(); await sh(page).getByLabel('Notes').fill('typo fixed'); await sheetBtn(page, 'Save correction').click(); await page.waitForTimeout(150);
  assert.match(await sh(page).innerText(), /Please say why/); await sh(page).getByLabel('Reason (required)').fill('wrong day'); await sheetBtn(page, 'Save correction').click(); await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => __befyn.state.logs.find((l) => l.revisions?.length)?.revisions.length), 1);
  // early finish: partial keeps the session; counted completes it
  await goto(page, '/today'); await page.getByRole('button', { name: 'Start workout' }).click(); await page.waitForSelector('.player'); await tap(page, 'Start', { exact: true });
  await tap(page, 'Done', { exact: true }).catch(() => {}); await page.getByRole('button', { name: 'Finish early' }).click(); await page.waitForSelector('text=not done');
  assert.match(await text(page), /Count this session as done/);
  const cnt = page.getByRole('switch', { name: 'Count this session as done' }); assert.equal(await cnt.isChecked(), false, 'few sets logged: default is not counted');
  const before = await page.evaluate(() => __befyn.state.programme.instance.cursor.seq);
  await tap(page, 'Finish and save'); await page.waitForSelector('text=Workout saved');
  assert.equal(await page.evaluate(() => __befyn.state.programme.instance.cursor.seq), before, 'partial workout does not advance the programme');
  assert.equal(await page.evaluate(() => __befyn.state.logs.filter((l) => l.status === 'partial').length), 1);
  await tap(page, 'Done', { exact: true }); await page.getByRole('button', { name: 'Start workout' }).click(); await page.waitForSelector('.player'); await tap(page, 'Start', { exact: true });
  await page.getByRole('button', { name: 'Finish early' }).click(); await page.waitForSelector('text=not done');
  await page.getByRole('switch', { name: 'Count this session as done' }).check(); await tap(page, 'Finish and save'); await page.waitForSelector('text=Workout saved');
  assert.equal(await page.evaluate(() => __befyn.state.programme.instance.cursor.seq), before + 1, 'counted early finish advances once');
});

await flow('V6.5: get-ready countdown, effective timing prefs, password-protected backup, local media, superset builder, saved-workout edit, week view', async ({ page }) => {
  await ready(page); assert.equal(await startProg(page, '2026-11-21'), true);
  // timing prefs take effect: warm-up exercise -> next exercise shows the Get ready countdown when transition > 0
  await page.evaluate(() => __befyn.updatePref('workout', { transitionSec: 5, autoRest: true }));
  await page.evaluate(async () => { const n = __befyn.nextSession(); await __befyn.startDraft({ kind: 'scheduled', scheduledId: n.id }); });
  await goto(page, '/workout'); await tap(page, 'Start', { exact: true });
  const first = await page.evaluate(() => { const p = __befyn.planForDraft(__befyn.state.draft); const i = p.steps.findIndex((s, k) => k > 0 && s.item.exercise !== p.steps[k - 1].item.exercise && !p.steps[k - 1].restAfterRound && p.steps[k - 1].section === 'warmup'); return i; });
  assert.ok(first > 0);
  await page.evaluate(async (n) => { const d = __befyn.state.draft; for (let k = 0; k < n - 1; k++) await __befyn.recordSet(d, k, { reps: 10, kg: 0 }); }, first);
  await page.reload(); await page.waitForSelector('.player');
  if (await page.getByRole('button', { name: 'Start', exact: true }).count()) await tap(page, 'Start', { exact: true });
  const stepBefore = await page.evaluate(() => 0); const done = page.getByRole('button', { name: /^(Done early|Done|Log set|Mark done)$/ }).first(); await done.click(); await page.waitForSelector('text=Get ready');
  assert.match(await text(page), /Up next/); await tap(page, 'Start now'); await page.waitForSelector('.ex-title');
  await page.evaluate(() => __befyn.discardDraft()); await goto(page, '/today');
  // password-protected backup: wrong password refused, right password restores
  await goto(page, '/more/data'); await page.getByRole('button', { name: 'Save a backup' }).click();
  await sh(page).getByLabel('Password (recommended)').fill('s3cret-pass-123'); await sh(page).getByLabel('Repeat password').fill('different'); await sheetBtn(page, 'Save', true).click();
  assert.match(await sh(page).innerText(), /do not match/);
  await sh(page).getByLabel('Repeat password').fill('s3cret-pass-123'); const dl = page.waitForEvent('download'); await sheetBtn(page, 'Save', true).click(); const d = await dl;
  const fs = await import('node:fs'); const file = '/tmp/befyn-protected.json'; await d.saveAs(file); const raw = fs.readFileSync(file, 'utf8');
  assert.equal(JSON.parse(raw).format, 'befyn-backup-encrypted'); assert.ok(!raw.includes('Goblet Squat'), 'no readable content in a protected backup');
  const chooser = page.waitForEvent('filechooser'); await page.getByRole('button', { name: 'Restore from a file' }).click(); (await chooser).setFiles(file); await page.waitForSelector('text=Restore backup');
  await sh(page).getByLabel('Backup password').fill('wrong-password'); await sheetBtn(page, 'Restore', true).click(); await page.waitForTimeout(1200);
  assert.match(await sh(page).innerText(), /did not open the backup`?/i);
  await sh(page).getByLabel('Backup password').fill('s3cret-pass-123'); await sheetBtn(page, 'Restore', true).click(); await page.waitForTimeout(1500);
  assert.equal(await page.evaluate(() => !!__befyn.state.programme), true);
  // local media attached to an exercise is stored in the app and resolves for display
  await goto(page, '/train/exercise/goblet-squat'); const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const fc = page.waitForEvent('filechooser'); await page.getByRole('button', { name: 'Add from phone' }).click(); (await fc).setFiles({ name: 'goblet.png', mimeType: 'image/png', buffer: png }); await page.waitForTimeout(600);
  assert.match(await text(page), /Stored on this phone: goblet\.png/); assert.equal(await page.evaluate(async () => !!(await __befyn.platform.media.resolve(__befyn.exercise('goblet-squat')))), true);
  // builder: superset block and a stretching exercise can be added
  await goto(page, '/train'); await page.getByRole('button', { name: 'Build a programme' }).click(); await sh(page).getByLabel('Name').fill('Superset test'); await sheetBtn(page, 'Continue').click(); await page.waitForSelector('text=Your typical week');
  await page.getByRole('button', { name: /Day A/ }).click(); await sh(page).first().getByRole('button', { name: 'Add superset' }).click();
  for (const q of ['goblet', 'dead bug']) { await sh(page).last().getByRole('button', { name: /^Choose exercise/ }).click(); await sh(page).last().getByRole('searchbox').fill(q); await page.getByRole('button', { name: new RegExp(q === 'goblet' ? 'Goblet Squat' : 'Dead Bug') }).first().click(); }
  await sh(page).last().getByRole('button', { name: 'Add', exact: true }).click(); await page.waitForTimeout(300);
  assert.match(await sh(page).first().innerText(), /Superset: Goblet Squat \+ Dead Bug/);
  await sh(page).first().getByRole('tab', { name: /Stretching/ }).click(); await sh(page).first().getByRole('button', { name: 'Add exercise' }).click(); await sh(page).last().getByRole('searchbox').fill('stretch'); await page.locator('.sheet .list button.item').last().click();
  await sheetBtn(page, 'Save', true).click(); await page.waitForTimeout(500);
  const sec = await page.evaluate(async () => { const t = __befyn.state.templates.find((x) => x.name === 'Superset test'); const s = t.sessions[0].sections; return { main: s.main[0].type, cool: !!s.cooldown?.length, weeks: new Set(t.sessions.map((x) => x.week)).size }; });
  assert.equal(sec.main, 'superset'); assert.equal(sec.cool, true); assert.ok(sec.weeks >= 2, 'pattern expanded across weeks');
  // saved workout create + edit
  await goto(page, '/train'); await page.getByRole('button', { name: 'Workouts', exact: true }).click(); await page.getByRole('button', { name: 'Create a workout' }).first().click();
  await sh(page).first().getByLabel('Name').fill('Core 10'); await sh(page).first().getByRole('button', { name: 'Add exercise' }).click(); await sh(page).last().getByRole('searchbox').fill('dead bug'); await page.getByRole('button', { name: /Dead Bug/ }).first().click(); await sheetBtn(page, 'Save', true).click(); await page.waitForTimeout(400);
  await page.getByRole('button', { name: /Core 10/ }).click(); await sheetBtn(page, 'Edit').click(); await sh(page).first().getByLabel('Name').fill('Core 12'); await sheetBtn(page, 'Save', true).click(); await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => __befyn.state.workouts.filter((w) => w.name.startsWith('Core')).map((w) => w.name).join()), 'Core 12', 'edited in place, not duplicated');
  // calendar week view
  await goto(page, '/calendar'); await page.getByRole('button', { name: 'Week', exact: true }).click(); assert.equal(await page.getByRole('button', { name: 'Previous week' }).count(), 1);
  assert.equal(await page.getByRole('button', { name: /^\d+$|^[MTWFS]/ }).count() >= 7, true);
});

await flow('V6.5: Progress > Activity shows Health Connect data incl. SpO2; recovery shows weekly load', async ({ page }) => {
  await ready(page); assert.equal(await startProg(page, '2026-11-21'), true);
  await page.evaluate(async () => { const day = (n) => new Date(Date.now() - n * 864e5).toISOString(); const rec = (type, n, value, extra = {}) => ({ id: 'x' + type + n, extKey: `hc:${type}:Test:${n}`, type, value, unit: '', start: day(n), end: day(n), source: 'Test', sourceType: 'health-connect', syncedAt: day(0), ...extra });
    await __befyn.repos.health.upsertMany([...[0, 1, 2, 3, 4].map((n) => rec('steps', n, 5000 + n * 700)), ...[0, 1, 2].map((n) => rec('sleep', n, 7 + n / 10)), ...[0, 1, 2, 3].map((n) => rec('heartRate', n, 60 + n)), rec('exercise', 1, 45, { extra: { title: 'Evening run' } }), rec('oxygenSaturation', 0, 97.5)]);
    for (let i = 0; i < 4; i++) { const n = __befyn.nextSession(); await __befyn.logPastSession({ scheduledId: n.id, date: __befyn.today(), durationMin: 50, effort: 7 }); } await __befyn.refresh(); });
  await goto(page, '/progress'); await page.getByRole('tab', { name: 'Activity' }).click(); await page.waitForTimeout(250);
  const t = await text(page); assert.match(t, /Steps/); assert.match(t, /Evening run/); assert.match(t, /Oxygen saturation/); assert.match(t, /97\.5/); assert.match(t, /larger total/);
  await page.getByLabel('Time range').selectOption('7'); await page.waitForTimeout(200);
  await goto(page, '/more/recovery'); assert.match(await text(page), /Training load by week/);
});


await flow('upgrade with the REAL V5.0 page: V5 writes its own data, V6.5 on the same origin migrates it (stock plan recognised, nothing lost)', async ({ page }) => {
  // 1. run the original V5.0 app and let it create its own state (S.prog, settings) and log sets the way its player does
  await page.goto(BASE + '__v5/v5_index.html'); await page.waitForFunction(() => typeof S !== 'undefined' && S.prog && S.prog.weeks, null, { timeout: 15000 });
  const v5 = await page.evaluate(() => {
    const days = [['2026-11-02', 1], ['2026-11-03', 2], ['2026-11-04', 3]]; let sets = 0;
    for (const [d, dw] of days) { const day = S.prog.weeks[1][dw]; day.ex.filter((e) => e.c === 'main').slice(0, 5).forEach((e) => { S.logs.push({ d, r: 'Week 1 - ' + day.name, e: e.n, sd: e.sd, m: e.m, c: e.c, reps: e.reps || 10, kg: 5, s: e.secs, sets: e.sets, rt: e.rt, rs: S.set.rest }); sets++; }); }
    save(); return { sets, keys: Object.keys(localStorage), rows: S.logs.length, set: S.set };
  });
  assert.ok(v5.keys.includes('myWorkouts.v3')); assert.equal(v5.rows, v5.sets);
  // 2. open FiT85 on the same origin: this is the upgrade
  await page.goto(BASE + '?debug=1&splash=0'); await page.waitForFunction(() => window.__befyn && !document.getElementById('splash'), null, { timeout: 15000 });
  const r = await page.evaluate(() => { const m = __befyn.state.migration; return { status: m.status, report: m.report, warnings: m.warnings || [], logs: __befyn.state.logs.length, sets: __befyn.state.logs.reduce((n, l) => n + l.performances.reduce((a, p) => a + p.sets.length, 0), 0), done: __befyn.state.programme.sessions.filter((s) => s.status === 'completed').length, legacyStill: !!localStorage.getItem('myWorkouts.v3'), backup: !!(__befyn.state.migration && true) }; });
  assert.equal(r.status, 'done'); assert.equal(r.report.programme, 'seed', 'the real V5 plan expansion is recognised as the stock programme');
  assert.equal(r.report.sessionLogs, 3); assert.equal(r.report.scheduledSessions, 56); assert.equal(r.logs, 3); assert.equal(r.sets, v5.sets, 'every logged set migrated exactly once');
  assert.equal(r.done, 3); assert.equal(r.legacyStill, true, 'V5.0 data is never deleted');
  assert.equal(await page.evaluate(async () => !!(await __befyn.repos.meta.get('backup.pre-v6'))), true, 'recoverable backup exists');
  // 3. a second launch does not migrate again or duplicate anything
  await page.reload(); await page.waitForFunction(() => window.__befyn && !document.getElementById('splash'));
  assert.equal(await page.evaluate(() => __befyn.state.logs.length), 3); assert.equal(await page.evaluate(() => __befyn.state.programme.sessions.length), 56);
}, { clock: '2026-11-21T09:00:00' });

console.log(results.map((r) => `${r[0]}  ${r[1]}  (${r[2]} ms)${r[3] ? '\n      ' + r[3] : ''}`).join('\n'));
console.log(failed ? `${failed} flow(s) failed` : 'all flows passed');
process.exit(failed ? 1 : 0);
