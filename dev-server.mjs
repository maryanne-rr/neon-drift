// dev-server.mjs
// --------------
// A tiny static file server for playing the game on your own machine:
//
//     npm start
//
// It is a development convenience only. start.ng serves the published game at
// apex-kart.start.ng, and the game needs no build step and no server of its
// own to run.
//
// Every request is wrapped, because a static server must never die because
// one browser sent a malformed URL.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT) || 4173;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
};

const server = createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400).end('bad request');
    return;
  }

  // Resolve inside the folder, so ../ cannot walk out of the project.
  const target = resolve(root, `.${normalize(pathname)}`);
  const inside = target === root || target.startsWith(root + sep);
  const file = inside ? (pathname.endsWith('/') ? join(target, 'index.html') : target) : join(root, 'index.html');

  readFile(file)
    .then((body) => {
      res.writeHead(200, {
        'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
        'cache-control': 'no-cache',
      });
      res.end(body);
    })
    .catch(() => {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
    });
});

// A dropped connection must not take the server down with it.
server.on('clientError', (error, socket) => socket.destroy());
server.on('error', (error) => console.error('server error:', error.message));
process.on('uncaughtException', (error) => console.error('uncaught:', error.message));

server.listen(port, () => {
  console.log(`Neon Drift running at http://localhost:${port}`);
  console.log('Press Ctrl+C to stop.');
});