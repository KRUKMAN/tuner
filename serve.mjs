// Minimal zero-dependency static server for the tuner web app.
// Serves ./web over http://localhost so ES modules load and getUserMedia works
// (localhost counts as a secure context). Run: node serve.mjs [port]
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), 'web');
const PORT = Number(process.argv[2]) || 8173;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = createServer(async (req, res) => {
  try {
    let path = decodeURIComponent((req.url || '/').split('?')[0]);
    if (path === '/') path = '/index.html';
    // prevent path traversal
    const full = normalize(join(ROOT, path));
    if (!full.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }
    const data = await readFile(full);
    res.writeHead(200, {
      'Content-Type': MIME[extname(full).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(data);
  } catch (err) {
    res.writeHead(err.code === 'ENOENT' ? 404 : 500);
    res.end(err.code === 'ENOENT' ? 'Not found' : 'Server error');
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Tuner running at http://localhost:${PORT}`);
});
