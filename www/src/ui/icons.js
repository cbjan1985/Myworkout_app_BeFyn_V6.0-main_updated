// One icon family: 24px grid, 1.8 stroke, round caps. No emoji in the interface.
const P = {
  today: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  train: '<path d="M6.5 8v8M17.5 8v8M3.5 10v4M20.5 10v4M6.5 12h11"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M8 3v4M16 3v4M3.5 10h17"/>',
  progress: '<path d="M4 19.5V5M4 19.5h16"/><path d="M8 15l3.5-4 3 2.5L19 8"/>',
  more: '<circle cx="5.5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="18.5" cy="12" r="1.4"/>',
  back: '<path d="M15 5l-7 7 7 7"/>', chev: '<path d="M9 5l7 7-7 7"/>', down: '<path d="M5 9l7 7 7-7"/>', up: '<path d="M5 15l7-7 7 7"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>', check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>', plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>',
  play: '<path d="M8 5.5v13l11-6.5z"/>', pause: '<path d="M8 5.5v13M16 5.5v13"/>', skip: '<path d="M6 6l8 6-8 6zM18 6v12"/>', undo: '<path d="M9 7L4.5 11.5 9 16"/><path d="M5 11.5h8.5a5.5 5.5 0 010 11"/>',
  heart: '<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0112 7.3a4.3 4.3 0 017.5 2.5C19.5 15.4 12 20 12 20z"/>', breath: '<path d="M3 9h10a2.5 2.5 0 10-2.5-2.5M3 13h14a2.5 2.5 0 11-2.5 2.5M3 17h7"/>',
  food: '<path d="M7 3v8a2 2 0 002 2v8M11 3v8a2 2 0 01-2 2M17 3c-2 2-2.5 5-2.5 8h2.5v10"/>', bell: '<path d="M6 16.5V11a6 6 0 0112 0v5.5l1.5 2h-15zM10 21h4"/>',
  voice: '<path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 10.5v3"/>', data: '<ellipse cx="12" cy="6" rx="7.5" ry="3"/><path d="M4.5 6v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6M4.5 12v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-6"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8"/>',
  moon: '<path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z"/>', bolt: '<path d="M13 3L5 13.5h6L10 21l8-10.5h-6z"/>', flame: '<path d="M12 21c4 0 6.5-2.6 6.5-6 0-3-2-4.5-3-7-1.5 1.5-2 3-2 4C13 9 11 7 11 3 7.500 6 5.5 10 5.5 15c0 3.400 2.500 6 6.500 6z"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8v.2"/>', warn: '<path d="M12 4l9 15.5H3z"/><path d="M12 10v4.5M12 17.2v.2"/>', lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 018 0v2.5"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>', edit: '<path d="M4 20l1-4L16.500 4.500a2 2 0 013 3L8 19z"/>', trash: '<path d="M4.500 7h15M9.500 7V4.500h5V7M6.500 7l1 13h9l1-13"/>', copy: '<rect x="8" y="8" width="12" height="12" rx="2.500"/><path d="M16 8V5.500A1.500 1.500 0 0014.500 4h-9A1.500 1.500 0 004 5.500v9A1.500 1.500 0 005.500 16H8"/>',
  swap: '<path d="M5 8h13l-3.500-3.500M19 16H6l3.500 3.500"/>', shift: '<path d="M4 12h14M13 6l6 6-6 6"/>', share: '<circle cx="6" cy="12" r="2.200"/><circle cx="17.500" cy="6" r="2.200"/><circle cx="17.500" cy="18" r="2.200"/><path d="M8 11l7.500-4M8 13l7.500 4"/>',
  download: '<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>', upload: '<path d="M12 16V5M7 9l5-5 5 5M5 20h14"/>', link: '<path d="M10 14a4 4 0 005.700 0l3-3a4 4 0 00-5.700-5.700l-1 1M14 10a4 4 0 00-5.700 0l-3 3a4 4 0 005.700 5.700l1-1"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 01-8 0zM8 6H4.500v1.500A3.500 3.500 0 008 11M16 6h3.500v1.500A3.500 3.500 0 0116 11M12 13v4M8.500 20h7M10 17h4"/>', activity: '<path d="M3 12h4l2.500-6 4 12 2.500-6h5"/>', sleep: '<path d="M4 17h16M4 13h16v4M7 13V9.500h4V13"/>', scale: '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M8.500 9a5 5 0 017 0M12 9.500l1.500-1.500"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>', refresh: '<path d="M19.500 12a7.500 7.500 0 11-2.200-5.300M19.500 4.500v4h-4"/>', sync: '<path d="M4.500 12a7.500 7.500 0 0112.800-5.300L19.500 9M19.500 4.500V9H15M19.500 12a7.500 7.500 0 01-12.800 5.300L4.500 15M4.500 19.500V15H9"/>',
  folder: '<path d="M3.500 7a2 2 0 012-2H10l2 2.500h6.500a2 2 0 012 2V17a2 2 0 01-2 2h-13a2 2 0 01-2-2z"/>', image: '<rect x="3.500" y="5" width="17" height="14" rx="2.500"/><circle cx="9" cy="10.500" r="1.500"/><path d="M4 17l5-4.500 4 3 3-2.500 4.500 4"/>', star: '<path d="M12 4l2.400 5 5.600.7-4.100 3.800 1.100 5.500L12 16.400 7 19l1.100-5.500L4 9.700 9.600 9z"/>',
};
export function icon(name, size = 22, label) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', size); s.setAttribute('height', size); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '1.8'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
  if (label) { s.setAttribute('role', 'img'); s.setAttribute('aria-label', label); } else s.setAttribute('aria-hidden', 'true');
  s.innerHTML = P[name] || P.info; return s;
}
export const ICON_NAMES = Object.keys(P);
