// Shared helpers for browser tests (Playwright is resolved from the global tool path; no install needed in this sandbox).
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
export const BASE = process.env.BEFYN_URL || 'http://localhost:8099/';
export async function launch({ width = 390, height = 844, dark = false, storage = null, clock = null } = {}) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: dark ? 'dark' : 'light', deviceScaleFactor: 2, serviceWorkers: 'block' });
  if (storage) await ctx.addInitScript((s) => { if (!sessionStorage.getItem('__seeded')) { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); sessionStorage.setItem('__seeded', '1'); } }, storage);
  if (clock) await ctx.addInitScript((iso) => { const R = Date; const fixed = new R(iso).getTime(); const start = R.now(); class D extends R { constructor(...a) { if (a.length) super(...a); else super(fixed + (R.now() - start)); } static now() { return fixed + (R.now() - start); } } globalThis.Date = D; }, clock);
  // Offline thumbnail loads (YouTube) are expected in the sandbox and handled in the UI, so they are not counted as errors.
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message)); page.on('console', (m) => { if (m.type() === 'error' && !/ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|ERR_CONNECTION/.test(m.text())) errors.push('console: ' + m.text()); });
  return { browser, ctx, page, errors };
}
export const ready = async (page, path = '') => { await page.goto(BASE + '?debug=1' + path); await page.waitForSelector('#app .page, #app .player, #app .page-head', { timeout: 15000 }); await page.waitForFunction(() => !document.getElementById('splash'), null, { timeout: 15000 }); };
