// Theme: system | light | dark. All components use semantic tokens, so dark mode is complete rather than inverted.
let mq = null;
export function applyTheme(app) {
  const mode = app.state.prefs.theme?.mode || 'system';
  const set = () => { const dark = mode === 'dark' || (mode === 'system' && globalThis.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches); document.documentElement.dataset.theme = dark ? 'dark' : 'light'; const m = document.querySelector('meta[name=theme-color]'); if (m) m.content = dark ? '#0E1A1B' : '#164E52'; };
  set();
  if (!mq && globalThis.matchMedia) { mq = matchMedia('(prefers-color-scheme: dark)'); mq.addEventListener?.('change', () => applyTheme(app)); }
}
