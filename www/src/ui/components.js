// Reusable components. One visual version of each control; screens never hand-roll their own.
import { h } from './dom.js';
import { icon } from './icons.js';

export const btn = (label, onClick, { kind = '', icon: ic, block = false, sm = false, disabled = false, attrs = {} } = {}) =>
  h('button', { class: ['btn', kind, block && 'block', sm && 'sm'].filter(Boolean).join(' '), onclick: onClick, disabled, type: 'button', ...attrs }, ic && icon(ic, 20), label);
export const iconBtn = (name, label, onClick) => h('button', { class: 'icon-btn', 'aria-label': label, onclick: onClick, type: 'button' }, icon(name));

export function field(label, control, { hint, error, id } = {}) {
  const fid = id || 'f' + Math.random().toString(36).slice(2, 7); if (control.setAttribute && !control.id) control.id = fid;
  if (error && control.setAttribute) { control.setAttribute('aria-invalid', 'true'); control.setAttribute('aria-describedby', fid + 'e'); }
  return h('div', { class: 'field' }, h('label', { class: 'label', for: control.id || fid }, label), control, hint && h('div', { class: 'hint' }, hint), error && h('div', { class: 'err', id: fid + 'e', role: 'alert' }, error));
}
export const input = (props = {}) => h('input', { class: 'input', ...props });
export const select = (options, value, props = {}) => h('select', { class: 'input', ...props }, options.map(([v, l]) => h('option', { value: v, selected: v === value }, l)));
export const textarea = (props = {}) => h('textarea', { class: 'input', ...props });

export function stepper({ value = 0, min = 0, max = 999, step = 1, onChange, label = 'Value', decimals = 0 }) {
  const i = h('input', { type: 'number', inputmode: decimals ? 'decimal' : 'numeric', value: String(value), min, max, step, 'aria-label': label });
  const set = (v) => { v = Math.min(max, Math.max(min, Number.isFinite(v) ? v : min)); i.value = String(+v.toFixed(decimals)); onChange && onChange(+i.value); };
  i.addEventListener('change', () => set(parseFloat(i.value)));
  const el = h('div', { class: 'stepper' }, h('button', { type: 'button', 'aria-label': `Decrease ${label}`, onclick: () => set((parseFloat(i.value) || 0) - step) }, '\u2212'), i, h('button', { type: 'button', 'aria-label': `Increase ${label}`, onclick: () => set((parseFloat(i.value) || 0) + step) }, '+'));
  el.get = () => parseFloat(i.value) || 0; el.input = i; return el;
}
export function toggle(checked, onChange, label) {
  const i = h('input', { type: 'checkbox', role: 'switch', checked, 'aria-label': label, onchange: () => onChange(i.checked) });
  return h('span', { class: 'switch' }, i, h('i'));
}
export function segmented(options, value, onChange, label) {
  const el = h('div', { class: 'seg', role: 'group', 'aria-label': label }, options.map(([v, l]) => h('button', { type: 'button', 'aria-pressed': String(v === value), onclick: () => onChange(v) }, l))); return el;
}
export const chips = (options, value, onChange, label) => h('div', { class: 'chips', role: 'group', 'aria-label': label }, options.map(([v, l]) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(v === value), onclick: () => onChange(v === value ? '' : v) }, l)));

export const pill = (text, kind = '') => h('span', { class: 'pill ' + kind }, text);
export const banner = (kids, { kind = '', icon: ic = 'info' } = {}) => h('div', { class: 'banner ' + kind, role: kind === 'err' ? 'alert' : undefined }, icon(ic, 20), h('div', { class: 'grow' }, kids));
export const progressBar = (pct, label) => h('div', { class: 'bar', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(pct), 'aria-label': label }, h('i', { style: { width: Math.max(0, Math.min(100, pct)) + '%' } }));
export const metric = (value, label, unit) => h('div', { class: 'metric' }, h('div', { class: 'metric-v' }, value, unit && h('span', { class: 'small muted' }, ' ' + unit)), h('div', { class: 'metric-l' }, label));
export const sectionTitle = (text, action) => h('div', { class: 'section-title' }, h('h2', {}, text), action || null);
export const card = (kids, cls = '') => h('section', { class: 'card ' + cls }, kids);

export function item({ title, meta, lead, trailing, onClick, href, chev = true, attrs = {} }) {
  const kids = [lead && h('span', { class: 'lead' }, typeof lead === 'string' ? icon(lead, 22) : lead), h('span', { class: 'grow' }, h('div', { class: 'title' }, title), meta && h('div', { class: 'meta' }, meta)), trailing, (onClick || href) && chev && h('span', { class: 'chev' }, icon('chev', 20))];
  return href ? h('a', { class: 'item', href, ...attrs }, kids) : h(onClick ? 'button' : 'div', { class: 'item', type: onClick ? 'button' : undefined, onclick: onClick, ...attrs }, kids);
}
export const list = (items) => h('div', { class: 'list' }, items.filter(Boolean));

export function empty({ icon: ic = 'info', title, text, action }) { return h('div', { class: 'empty' }, icon(ic, 44), h('h2', {}, title), text && h('p', {}, text), action || null); }
export const loading = () => h('div', { class: 'stack', 'aria-busy': 'true', 'aria-label': 'Loading' }, h('div', { class: 'skeleton' }), h('div', { class: 'skeleton' }), h('div', { class: 'skeleton', style: { minHeight: '120px' } }));
export function errorState(message, retry) { return h('div', { class: 'empty' }, icon('warn', 44), h('h2', {}, 'Something went wrong'), h('p', {}, message), retry ? btn('Try again', retry) : null); }
