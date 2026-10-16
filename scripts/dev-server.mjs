import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import handler from '../api/status.js';

const root = join(import.meta.dirname, '..');
const port = Number(process.env.PORT || 8765);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.md': 'text/markdown; charset=utf-8'
};

function send(res, code, obj, extra = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra });
  res.end(body);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://127.0.0.1:${port}`);
  if (url.pathname === '/api/status') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf8');
    let body;
    if (raw) {
      try {
        body = JSON.parse(raw);
      } catch {
        send(res, 400, { ok: false, error: 'invalid_json' });
        return;
      }
    }
    const vRes = {
      statusCode: 200,
      headers: {},
      body: '',
      setHeader(key, value) {
        this.headers[key] = value;
        return this;
      },
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(obj) {
        this.body = JSON.stringify(obj);
        return this;
      },
      end(payload) {
        if (payload) this.body = payload;
        return this;
      }
    };
    await handler({ method: req.method, headers: req.headers, body }, vRes);
    res.writeHead(vRes.statusCode || 200, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...vRes.headers
    });
    res.end(vRes.body || '');
    return;
  }

  let pathname = decodeURIComponent(url.pathname);
  if (pathname.endsWith('/')) pathname += 'index.html';
  const file = normalize(join(root, pathname));
  if (!file.startsWith(root)) {
    res.writeHead(403);
    res.end('forbidden');
    return;
  }
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Mission Control at http://127.0.0.1:${port}`);
});
