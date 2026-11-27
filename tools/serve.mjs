// Zero-dependency static server for www/ (development and browser tests). Usage: node tools/serve.mjs [port]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../www');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.gif': 'image/gif', '.mp4': 'video/mp4' };
// Test-only: the original V5.0 page is served at /__v5/ (same origin, so its localStorage is exactly what an upgrade would find). Not part of the app.
const legacyRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../legacy');
const port = Number(process.argv[2] || process.env.PORT || 8099);
http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html';
  const isV5 = p.startsWith('/__v5/'); const base = isV5 ? legacyRoot : root; let f = path.join(base, isV5 ? p.slice(6) : p);
  if (isV5 && /app_icon(_splash)?\.png$/.test(p) && !fs.existsSync(f)) f = path.join(root, 'assets', path.basename(p)); // the V5.0 page used these two images from its own folder
  if (isV5 && p.endsWith('/xlsx.full.min.js') && !fs.existsSync(f)) { res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end('/* test stub: the spreadsheet library is not needed for the upgrade test */'); return; }
  if (!(f.startsWith(base) || f.startsWith(root)) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('Not found'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); fs.createReadStream(f).pipe(res);
}).listen(port, () => console.log(`BeFyn dev server on http://localhost:${port}/`));
