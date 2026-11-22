// Renders the BeFyn launcher icons with headless Chromium (Playwright). Output: android-res/. Run only when changing the mark.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEAL = '#164E52', IVORY = '#F5F3EE', MINT = '#75C9B7';
// 108-unit design grid (Android adaptive icon): the mark stays inside the central 66 units.
const mark = (stroke = IVORY) => `<path d="M42 33 V75 M42 33 H56 a10.5 10.5 0 0 1 0 21 H42 M42 54 H59 a10.5 10.5 0 0 1 0 21 H42" stroke="${stroke}" stroke-width="7.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/><circle cx="75" cy="32" r="4.4" fill="${MINT}"/>`;
const svg = (size, kind) => {
  const bg = kind === 'fg' ? '' : `<rect width="108" height="108" fill="${TEAL}" ${kind === 'round' ? 'rx="54"' : 'rx="24"'}/>`;
  const scale = kind === 'fg' ? 1 : 1.18, t = kind === 'fg' ? '' : `transform="translate(54 54) scale(${scale}) translate(-54 -54)"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 108 108">${bg}<g ${t}>${mark()}</g></svg>`;
};
const dens = { mdpi: [48, 108], hdpi: [72, 162], xhdpi: [96, 216], xxhdpi: [144, 324], xxxhdpi: [192, 432] };
const b = await chromium.launch(); const page = await b.newPage();
const shot = async (size, kind, file) => { await page.setViewportSize({ width: size, height: size }); await page.setContent(`<style>html,body{margin:0;background:transparent}</style>${svg(size, kind)}`); fs.mkdirSync(path.dirname(file), { recursive: true }); await page.screenshot({ path: file, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } }); };
for (const [d, [legacy, adaptive]] of Object.entries(dens)) {
  const dir = path.join(root, 'android-res', `mipmap-${d}`);
  await shot(legacy, 'square', path.join(dir, 'ic_launcher.png'));
  await shot(legacy, 'round', path.join(dir, 'ic_launcher_round.png'));
  await shot(adaptive, 'fg', path.join(dir, 'ic_launcher_foreground.png'));
}
await shot(512, 'square', path.join(root, 'docs/brand/befyn-icon-512.png'));
await b.close();
const w = (f, t) => { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), t); };
w('android-res/values/ic_launcher_background.xml', `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${TEAL}</color>\n    <color name="befyn_splash">${IVORY}</color>\n</resources>\n`);
const adaptive = '<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n    <background android:drawable="@color/ic_launcher_background"/>\n    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n</adaptive-icon>\n';
w('android-res/mipmap-anydpi-v26/ic_launcher.xml', adaptive); w('android-res/mipmap-anydpi-v26/ic_launcher_round.xml', adaptive);
w('android-res/drawable/ic_stat_befyn.xml', `<?xml version="1.0" encoding="utf-8"?>\n<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="24dp" android:height="24dp" android:viewportWidth="24" android:viewportHeight="24">\n    <path android:strokeColor="#FFFFFF" android:strokeWidth="2.2" android:strokeLineCap="round" android:strokeLineJoin="round" android:pathData="M8 5V19M8 5H13A3.2 3.2 0 0 1 13 11.4H8M8 11.4H14A3.2 3.2 0 0 1 14 19H8"/>\n</vector>\n`);
console.log('icons written');
