// Hash router with parameters. Android Back = history.back(); sheets use their own history entries (see dom.js).
import { h, clear, sheetOpen, historySettled } from './dom.js';
import { icon } from './icons.js';

export const TABS = [['today', 'Today', 'today'], ['train', 'Train', 'train'], ['calendar', 'Calendar', 'calendar'], ['progress', 'Progress', 'progress'], ['more', 'More', 'more']];

export function createRouter({ root, routes, app, badge }) {
  const head = h('header', { class: 'page-head' }), page = h('main', { class: 'page', id: 'main', tabindex: '-1' }), nav = h('nav', { class: 'nav', 'aria-label': 'Primary' });
  root.append(head, page, nav);
  let current = null, token = 0;

  const compiled = routes.map((r) => { const keys = []; const re = new RegExp('^' + r.path.replace(/:[a-zA-Z]+/g, (m) => { keys.push(m.slice(1)); return '([^/]+)'; }) + '/?$'); return { ...r, re, keys }; });
  const parse = () => { const hash = (location.hash || '#/today').slice(1) || '/today'; const [p, q] = hash.split('?'); return { path: p, query: Object.fromEntries(new URLSearchParams(q || '')) }; };
  function match() {
    const { path, query } = parse();
    for (const r of compiled) { const m = r.re.exec(path); if (m) return { route: r, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])), query, path }; }
    return { route: compiled.find((r) => r.path === '/today'), params: {}, query, path: '/today' };
  }
  function drawNav(tab) {
    nav.replaceChildren(...TABS.map(([id, label, ic]) => h('a', { href: `#/${id}`, 'aria-current': id === tab ? 'page' : undefined }, icon(ic, 24), label, badge && badge(id) ? h('span', { class: 'badge', 'aria-label': 'Needs attention' }) : null)));
  }
  async function render({ keepScroll = false } = {}) {
    if (current && current.out && current.out.onLeave && current.path !== parse().path) { try { current.out.onLeave(); } catch (_) { /* ignore */ } }
    const m = match(); const my = ++token; const scroll = page.scrollTop;
    const same = current && current.path === m.path;
    root.dataset.route = m.route.name; root.classList.toggle('chromeless', !!m.route.full);
    head.hidden = nav.hidden = !!m.route.full;
    let out;
    try { out = await m.route.screen(app, { ...m.params, query: m.query, rerender: () => render({ keepScroll: true }), navigate }); }
    catch (e) { console.error(e); out = { title: 'Something went wrong', content: h('div', { class: 'empty' }, h('h2', {}, 'This screen could not load'), h('p', { class: 'muted' }, String((e && e.message) || e)), h('a', { class: 'btn', href: '#/today' }, 'Go to Today')) }; }
    if (my !== token) return; // a newer navigation won
    current = { path: m.path, route: m.route, out };
    if (m.route.full) { page.replaceChildren(); page.hidden = true; document.title = 'BeFyn'; mountFull(out); return; }
    page.hidden = false; removeFull();
    const titleBlock = h('h1', {}, out.title, out.subtitle && h('span', { class: 'sub' }, out.subtitle));
    head.replaceChildren(...[m.route.depth ? h('button', { class: 'icon-btn', 'aria-label': 'Back', onclick: () => back(m.route.parent), style: { marginLeft: '-8px' } }, icon('back')) : null, titleBlock, ...(out.actions || [])].filter(Boolean));
    clear(page); page.append(out.content); drawNav(m.route.tab);
    document.title = `${out.title} · BeFyn`;
    page.scrollTop = same || keepScroll ? scroll : 0;
    if (!same && !keepScroll) page.focus({ preventScroll: true });
  }
  let fullEl = null;
  const mountFull = (out) => { removeFull(); fullEl = out.content; root.append(fullEl); };
  const removeFull = () => { if (fullEl) { fullEl.remove(); fullEl = null; } };
  async function navigate(path, { replace = false } = {}) { await historySettled(); const target = '#' + path; if (location.hash === target) return render(); if (replace) location.replace(target); else location.hash = path; }
  function back(parent) { if (history.length > 1 && document.referrer !== undefined && (history.state === null || !history.state.sheet)) history.back(); else navigate(parent || '/today', { replace: true }); }
  window.addEventListener('hashchange', () => render());
  // Re-render on data changes unless a screen opted out or a sheet is open over a form.
  let pending = false;
  app.on('change', () => { if (pending || !current || current.out.live === false || current.route.full) return; pending = true; requestAnimationFrame(() => { pending = false; if (!sheetOpen()) render({ keepScroll: true }); }); });
  return { render, navigate, back, current: () => current };
}
