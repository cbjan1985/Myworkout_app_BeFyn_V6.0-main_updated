// Randomised UI exercise ("monkey test"): thousands of clicks, taps and keystrokes on a populated app, seeded so failures can be replayed.
// Fails on any uncaught script error, console error, or app that stops responding. Usage: node tests/e2e/monkey.mjs [seed] [actions]
import { launch, ready } from './lib.mjs';
import { v5Storage } from './fixture.mjs';
const seed0 = Number(process.argv[2] || 1), N = Number(process.argv[3] || 600);
let a = seed0 >>> 0; const rnd = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const AVOID = /erase|delete draft|stop programme|discard|remove synced|remove the old|restore from|save a backup|save and share|download|export|add from phone|replace file|pick folder|csv|excel|spreadsheet|import|allow notifications|choose data to connect|sync now|^save$/i;
const WORDS = ['abc', '12', '-5', '0', '999999', '<b>x</b>', "'; drop table--", '😀', ' ', 'a'.repeat(300), '1e9', '../../etc/passwd', '{{7*7}}'];
const { browser, page, errors } = await launch({ width: 390, height: 844, storage: v5Storage(), clock: '2026-11-21T09:00:00' });
page.setDefaultTimeout(1500);
browser.on('disconnected', () => console.log('BROWSER DISCONNECTED (process died)'));
page.context().on('close', () => console.log('CONTEXT CLOSED'));
page.on('popup', (p) => console.log('POPUP opened:', p.url()));
page.on('crash', () => console.log('PAGE CRASHED'));
page.on('close', () => console.log('PAGE CLOSED after:', log.filter((x) => !x.startsWith('ERR')).slice(-8).join(' | ')));
page.on('framenavigated', (f) => { if (f === page.mainFrame()) console.log('nav ->', f.url().replace('http://localhost:8099', '')); });
page.on('console', (m) => { if (m.type() === 'warning') console.log('warn:', m.text().slice(0, 120)); });
await ready(page); await page.waitForTimeout(400);
let acted = 0, failures = 0; const log = [];
for (let i = 0; i < N; i++) {
  try {
    const kind = rnd();
    if (kind < 0.12) { await page.evaluate((h) => { location.hash = h; }, pick(['/today', '/train', '/calendar', '/progress', '/more', '/more/health', '/more/nutrition', '/more/recovery', '/more/reminders', '/more/preferences', '/more/data', '/more/about', '/train/exercise/goblet-squat', '/workout'])); log.push('nav'); }
    else if (kind < 0.55) {
      // External links open the system browser and the sandbox has no network, so they are skipped below.
      const els = await page.$$('button:not([disabled]), a[href], [role=tab], [role=switch], summary');
      const vis = []; for (const el of els) { if (!(await el.isVisible())) continue; const label = ((await el.getAttribute('aria-label')) || (await el.innerText()) || '').trim().slice(0, 60); if (AVOID.test(label)) continue;
      const href = (await el.getAttribute('href')) || ''; if ((await el.getAttribute('target')) === '_blank' || /^https?:/i.test(href)) continue; vis.push([el, label]); }
      if (vis.length) { const [el, label] = pick(vis); log.push('click ' + label); await el.click({ timeout: 800 }).catch(() => {}); }
    } else if (kind < 0.8) {
      const inputs = await page.$$('input:not([type=file]):not([type=checkbox]):not([type=hidden]), textarea, select'); const vis = []; for (const el of inputs) if (await el.isVisible()) vis.push(el);
      if (vis.length) { const el = pick(vis); const tag = await el.evaluate((n) => n.tagName); if (tag === 'SELECT') { const opts = await el.evaluate((n) => [...n.options].map((o) => o.value)); await el.selectOption(pick(opts)).catch(() => {}); log.push('select'); } else { await el.fill(pick(WORDS)).catch(() => {}); await el.press('Enter').catch(() => {}); log.push('type'); } }
    } else if (kind < 0.9) { await page.keyboard.press(pick(['Escape', 'Tab', 'Enter', 'ArrowDown'])); log.push('key'); }
    else if (kind < 0.95) { await page.goBack().catch(() => {}); if (!page.url().startsWith('http://localhost')) await page.goForward().catch(() => {}); log.push('back@' + page.url().replace('http://localhost:8099/', '')); /* Android's Back at the root exits the app; the test stays inside it */ }
    else { await page.mouse.wheel(0, pick([-400, 400])); log.push('scroll'); }
    acted++;
    if (i % 25 === 0) { const alive = await page.evaluate(() => !!document.querySelector('#app') && document.body.innerText.length > 0); if (!alive) throw new Error('app blank'); }
  } catch (e) { failures++; log.push('ERR ' + e.message.split('\n')[0]); }
  if (errors.length) break;
}
// the app must still respond after all that
// A random "back" can leave a navigation in flight; retry the final health check instead of crashing the harness.
let ok = false;
for (let k = 0; k < 4 && !ok; k++) { try { await page.waitForTimeout(400); await page.evaluate(() => { document.querySelectorAll('.scrim').forEach((x) => x.remove()); location.hash = '/today'; }); await page.waitForTimeout(300); ok = await page.evaluate(() => document.querySelector('.page-head h1, .player') !== null); } catch (e) { /* context was replaced by a navigation: try again */ } }
if (!ok) { console.log('DIAGNOSIS url:', page.url(), '| hash:', await page.evaluate(() => location.hash).catch(() => '?')); console.log('body text:', (await page.evaluate(() => document.body.innerText).catch(() => '?')).slice(0, 300).replace(/\n+/g, ' | ')); console.log('last actions:', log.slice(-15).join(' | ')); }
console.log(`monkey seed ${seed0}: ${acted} actions, ${errors.length} script errors, responsive after: ${ok}`);
if (errors.length) { console.log(errors.slice(0, 5).join('\n')); console.log('last actions:', log.slice(-12).join(' | ')); }
await browser.close(); process.exit(errors.length || !ok ? 1 : 0);
