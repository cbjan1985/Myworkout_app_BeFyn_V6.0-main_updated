// Small, honest SVG charts. Each one has a text alternative and states its time range; short histories are reported, not drawn.
import { prettyDate } from '../core/util.js';
const NS = 'http://www.w3.org/2000/svg';
const s = (tag, attrs = {}, ...kids) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); kids.flat().forEach((c) => c && e.append(c.nodeType ? c : document.createTextNode(c))); return e; };
const nice = (min, max) => { if (min === max) { min -= 1; max += 1; } const pad = (max - min) * 0.15; return [Math.floor((min - pad) * 10) / 10, Math.ceil((max + pad) * 10) / 10]; };

/** points: [{date, value}] oldest first. */
export function lineChart(points, { unit = '', label = 'Chart', minPoints = 3, w = 320, h = 150 } = {}) {
  const pts = points.filter((p) => p.value != null);
  if (pts.length < minPoints) return null;
  const [lo, hi] = nice(Math.min(...pts.map((p) => p.value)), Math.max(...pts.map((p) => p.value)));
  const L = 38, R = 8, T = 10, B = 22, x = (i) => L + (pts.length === 1 ? 0 : (i * (w - L - R)) / (pts.length - 1)), y = (v) => T + (1 - (v - lo) / (hi - lo)) * (h - T - B);
  const svg = s('svg', { class: 'chart', viewBox: `0 0 ${w} ${h}`, role: 'img', 'aria-label': `${label}: ${pts.length} entries from ${prettyDate(pts[0].date)} to ${prettyDate(pts[pts.length - 1].date)}, from ${pts[0].value} to ${pts[pts.length - 1].value} ${unit}.` });
  for (let i = 0; i <= 3; i++) { const v = lo + ((hi - lo) * i) / 3, yy = y(v); svg.append(s('line', { class: 'grid', x1: L, x2: w - R, y1: yy, y2: yy }), s('text', { x: L - 4, y: yy + 4, 'text-anchor': 'end' }, String(Math.round(v * 10) / 10))); }
  svg.append(s('text', { x: L, y: h - 4 }, prettyDate(pts[0].date)), s('text', { x: w - R, y: h - 4, 'text-anchor': 'end' }, prettyDate(pts[pts.length - 1].date)));
  svg.append(s('polyline', { class: 'l1', points: pts.map((p, i) => `${x(i)},${y(p.value)}`).join(' ') }));
  pts.forEach((p, i) => svg.append(s('circle', { class: 'p1', cx: x(i), cy: y(p.value), r: 3.5 }, s('title', {}, `${prettyDate(p.date)}: ${p.value} ${unit}`))));
  return svg;
}

/** items: [{label, value, note?}]; shows a value label on every bar so colour is never the only cue. */
export function barChart(items, { label = 'Chart', unit = '', w = 320, h = 150, target } = {}) {
  if (!items.length) return null;
  const max = Math.max(target || 0, ...items.map((i) => i.value), 1), L = 8, R = 8, T = 18, B = 22, bw = (w - L - R) / items.length;
  const svg = s('svg', { class: 'chart', viewBox: `0 0 ${w} ${h}`, role: 'img', 'aria-label': `${label}: ${items.map((i) => `${i.label} ${i.value}${unit}`).join(', ')}.` });
  svg.append(s('line', { class: 'grid', x1: L, x2: w - R, y1: h - B, y2: h - B }));
  if (target) { const ty = T + (1 - target / max) * (h - T - B); svg.append(s('line', { class: 'grid', x1: L, x2: w - R, y1: ty, y2: ty, 'stroke-dasharray': '4 4' }), s('text', { x: w - R, y: ty - 3, 'text-anchor': 'end' }, `target ${target}`)); }
  items.forEach((it, i) => { const bh = (it.value / max) * (h - T - B), bx = L + i * bw + bw * 0.18;
    svg.append(s('rect', { class: 'b1', x: bx, y: h - B - bh, width: bw * 0.64, height: Math.max(it.value ? 2 : 0, bh), rx: 3 }, s('title', {}, `${it.label}: ${it.value} ${unit}`)), s('text', { x: bx + bw * 0.32, y: h - B - bh - 4, 'text-anchor': 'middle' }, it.value ? String(it.value) : ''), s('text', { x: bx + bw * 0.32, y: h - 6, 'text-anchor': 'middle' }, it.label)); });
  return svg;
}

export function ring(pct, size = 190, stroke = 10) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const svg = s('svg', { width: size, height: size, viewBox: `0 0 ${size} ${size}`, 'aria-hidden': 'true' }, s('circle', { cx: size / 2, cy: size / 2, r, fill: 'none', stroke: 'var(--surface-2)', 'stroke-width': stroke }), s('circle', { class: 'arc', cx: size / 2, cy: size / 2, r, fill: 'none', stroke: 'var(--accent)', 'stroke-width': stroke, 'stroke-linecap': 'round', 'stroke-dasharray': c, 'stroke-dashoffset': c * (1 - pct) }));
  svg.set = (p) => svg.querySelector('.arc').setAttribute('stroke-dashoffset', String(c * (1 - Math.max(0, Math.min(1, p))))); return svg;
}
