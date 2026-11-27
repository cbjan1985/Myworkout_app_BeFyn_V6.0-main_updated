// Bootstrap: storage -> seed/migration -> app services -> router. Failures show a recovery screen, never a blank page.
import { h } from './ui/dom.js';
import { openRepos, loadSeed } from './platform/storage.js';
import * as files from './platform/files.js';
import * as notifications from './platform/notifications.js';
import * as health from './platform/health.js';
import * as voice from './platform/voice.js';
import * as media from './platform/media.js';
import { migrateFromV5 } from './data/migration.js';
import { createApp } from './services/app.js';
import { createRouter } from './ui/router.js';
import { routes } from './ui/screens/index.js';
import { applyTheme } from './ui/theme.js';
import { showUpgradeSummary, maybeOnboard } from './ui/screens/onboarding.js';
import { SPLASH_MS } from './version.js';

const root = document.getElementById('app');
const splash = document.getElementById('splash');
/** Keeps the flash screen up for SPLASH_MS in total (measured from page start), then fades it out. Never longer than needed if boot is slower. */
async function endSplash() {
  const ms = new URLSearchParams(location.search).get('splash') === '0' ? 0 : SPLASH_MS; // '?splash=0' is for automated tests only
  const wait = Math.max(0, ms - performance.now());
  await new Promise((r) => setTimeout(r, wait));
  splash.classList.add('out'); await new Promise((r) => setTimeout(r, 380)); splash.remove();
}

function fatal(title, message, actions = []) {
  splash.remove(); root.replaceChildren(h('div', { class: 'page', style: { paddingTop: '48px' } }, h('div', { class: 'empty' }, h('h2', {}, title), h('p', {}, message), ...actions)));
}

async function boot() {
  const { repos, degraded, reason } = await openRepos();
  const base = new URL('.', location.href).href;
  const platform = { files, notifications, health, voice, media, storage: globalThis.localStorage, subtle: globalThis.crypto && globalThis.crypto.subtle };
  let mig;
  try {
    mig = await migrateFromV5({ repos, storage: platform.storage, loadSeed: () => loadSeed(base), writeBackupFile: async (name, text) => { const r = await files.saveText(name, text); return r.ok ? r.where : null; } });
  } catch (e) { console.error(e); mig = { status: 'failed', stage: 'unexpected', message: String((e && e.message) || e), recovery: 'Your V5.0 data is untouched.' }; }
  if (mig.status === 'failed') {
    return fatal('Your data could not be upgraded yet', `${mig.message} ${mig.recovery || ''}`, [h('button', { class: 'btn', onclick: () => location.reload() }, 'Try again')]);
  }
  const app = createApp({ repos, platform });
  app.state.degraded = degraded; app.state.degradedReason = reason;
  await app.refresh();
  // Test/debug handle, only when explicitly requested (?debug=1). Never exposed in normal use.
  if (new URLSearchParams(location.search).has('debug')) window.__befyn = app;
  applyTheme(app);
  const router = createRouter({ root, routes, app, badge: (tab) => tab === 'calendar' && !!app.scheduleStatus()?.missed.length });
  app.router = router;
  await router.render();
  await endSplash();
  if (mig.status === 'migrated') await showUpgradeSummary(app, mig);
  else await maybeOnboard(app);
  if (app.state.prefs.reminders?.rescheduleOnStart !== false) app.applyReminders().catch(() => {});
}

boot().catch((e) => { console.error(e); fatal('FiT85 could not start', String((e && e.message) || e), [h('button', { class: 'btn', onclick: () => location.reload() }, 'Try again')]); });
