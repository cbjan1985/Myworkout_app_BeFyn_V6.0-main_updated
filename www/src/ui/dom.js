// Tiny DOM toolkit: element builder, sheets, dialogs and toasts. No framework, no build step.
import { icon } from './icons.js';

/** h('div', {class:'x', onclick: fn, 'aria-label':'..'}, child, 'text', [more]) */
export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v; else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') el.value = v; else if (k === 'checked' || k === 'disabled' || k === 'hidden' || k === 'selected') el[k] = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  add(el, kids); return el;
}
function add(el, kids) { for (const k of kids.flat(Infinity)) { if (k === null || k === undefined || k === false) continue; el.append(k.nodeType ? k : document.createTextNode(String(k))); } }
export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
export const mount = (el, ...kids) => { clear(el); add(el, kids); return el; };

/* ------------------------------ sheets and dialogs ------------------------------ */
const stack = [];
let seq = 0;
/** Opens a bottom sheet (or centred dialog). content: Node | (close) => Node. Android Back closes the top sheet first. */
export function openSheet({ title, content, actions = [], center = false, onClose, label }) {
  const opener = document.activeElement; const id = 'sh' + (++seq);
  const scrim = h('div', { class: 'scrim' + (center ? ' center' : ''), onclick: (e) => { if (e.target === scrim) api.close(); } });
  const titleEl = h('h2', { id: id + 't' }, title || '');
  const body = h('div', { class: 'sheet-body' });
  const foot = h('div', { class: 'sheet-foot', hidden: !actions.length });
  const sheet = h('div', { class: 'sheet' + (center ? ' center' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': id + 't', 'aria-label': label }, h('div', { class: 'sheet-head' }, titleEl, h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: () => api.close() }, icon('close'))), body, foot);
  scrim.append(sheet);
  const api = {
    el: sheet, body, closed: false,
    setContent(c) { body.replaceChildren(typeof c === 'function' ? c(api) : c); },
    setActions(a) { foot.hidden = !a.length; foot.replaceChildren(...a.map((x) => h('button', { class: 'btn ' + (x.kind || ''), disabled: x.disabled, onclick: async (e) => { if (x.busy) { e.currentTarget.setAttribute('aria-busy', 'true'); } try { const r = await x.onClick?.(api); if (x.close !== false && r !== false) api.close(); } finally { e.currentTarget?.removeAttribute?.('aria-busy'); } } }, x.label))); },
    close(fromPop) {
      if (api.closed) return; api.closed = true; const i = stack.indexOf(api); if (i >= 0) stack.splice(i, 1);
      scrim.remove(); document.removeEventListener('keydown', onKey, true);
      if (!fromPop && history.state && history.state.sheet === id) { suppress++; history.back(); }
      try { opener && opener.focus && opener.focus(); } catch (_) { /* gone */ }
      onClose && onClose();
    },
    id,
  };
  const onKey = (e) => {
    if (stack[stack.length - 1] !== api) return;
    if (e.key === 'Escape') { e.stopPropagation(); api.close(); }
    if (e.key === 'Tab') { const f = [...sheet.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((x) => !x.disabled && x.offsetParent !== null); if (!f.length) return; const first = f[0], last = f[f.length - 1]; if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); } }
  };
  document.addEventListener('keydown', onKey, true);
  // Any inline error line (.err) inside the sheet is linked to the sheet's form controls (aria-describedby + aria-invalid) while it has text.
  new MutationObserver(() => {
    const errs = [...body.querySelectorAll('.err')].filter((e) => e.textContent.trim()); const controls = body.querySelectorAll('input:not([type=hidden]), select, textarea');
    errs.forEach((e, i) => { if (!e.id) e.id = `${id}err${i}`; });
    controls.forEach((c) => { if (errs.length) { c.setAttribute('aria-describedby', errs.map((e) => e.id).join(' ')); c.setAttribute('aria-invalid', 'true'); } else { c.removeAttribute('aria-describedby'); c.removeAttribute('aria-invalid'); } });
  }).observe(body, { childList: true, subtree: true, characterData: true });
  api.setContent(content || ''); api.setActions(actions);
  document.body.append(scrim); stack.push(api);
  history.pushState({ sheet: id }, '');
  requestAnimationFrame(() => { const f = sheet.querySelector('input:not([type=hidden]), select, textarea') || sheet.querySelector('.sheet-foot .btn') || sheet.querySelector('.icon-btn'); f && f.focus && f.focus(); });
  return api;
}
let suppress = 0; let waiters = [];
const settle = () => { const w = waiters; waiters = []; w.forEach((r) => r()); };
window.addEventListener('popstate', () => { if (suppress > 0) { suppress--; if (suppress === 0) settle(); return; } const top = stack[stack.length - 1]; if (top) top.close(true); });
/** Closing a sheet calls history.back(), which is asynchronous. Navigation must wait for it, or the back step undoes the navigation. */
export function historySettled() {
  if (suppress === 0) return Promise.resolve();
  return new Promise((res) => { waiters.push(res); setTimeout(() => { suppress = 0; settle(); }, 500); });
}
export const sheetOpen = () => stack.length > 0;
export const closeAllSheets = () => { while (stack.length) stack[stack.length - 1].close(); };

export function confirmDialog({ title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false }) {
  return new Promise((resolve) => {
    let answered = false; const done = (v) => { if (!answered) { answered = true; resolve(v); } };
    openSheet({ title, center: true, content: h('p', {}, message), onClose: () => done(false), actions: [{ label: cancelLabel, kind: 'secondary', onClick: () => done(false) }, { label: confirmLabel, kind: danger ? 'danger' : '', onClick: () => done(true) }] });
  });
}

/* ------------------------------ toasts ------------------------------ */
let toastHost = null;
export function toast(message, { action, ms = 4500 } = {}) {
  if (!toastHost) { toastHost = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }); document.body.append(toastHost); }
  const el = h('div', { class: 'toast' }, h('span', {}, message), action && h('button', { onclick: () => { action.onClick(); el.remove(); } }, action.label));
  toastHost.append(el); setTimeout(() => el.remove(), action ? Math.max(ms, 7000) : ms); return el;
}
