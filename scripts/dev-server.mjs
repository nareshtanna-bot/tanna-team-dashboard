import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { readFileSync } from 'node:fs';
import handler from '../api/status.js';
import tasksHandler, { createTasksHandler, memoryStore } from '../api/tasks.js';
import { applyPost, emptyDoc } from '../lib/tasks.js';
import { blobConfigured, normalizeBot } from '../lib/status.js';
import { memoryStore as inboxMemory } from '../lib/blob-store.js';
import { createInboxHandler } from '../lib/inbox-handler.js';

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

// Without a Blob token, /api/tasks runs on an in-memory store seeded with the fake example tasks.
function localTasks() {
  const example = JSON.parse(readFileSync(join(root, 'fixtures', 'tasks.example.json'), 'utf8'));
  const { doc } = applyPost(emptyDoc(), example, { source: 'manual' });
  return createTasksHandler({ store: memoryStore(doc) });
}
const tasksRoute = blobConfigured() ? tasksHandler : localTasks();
// Without a Blob token, /api/inbox runs on an in-memory store.
const inboxRoute = createInboxHandler(blobConfigured() ? {} : { store: inboxMemory() });
const inboxPath = /^\/api\/inbox(?:\/([A-Za-z0-9_-]+))?\/?$/;

// Local preview only. Stamps the fixture bot as just-run so the card is not Stale.
function overlayHeartbeatFixture(text) {
  const status = JSON.parse(text);
  const agent = JSON.parse(readFileSync(join(root, 'fixtures/heartbeat.example.json'), 'utf8'));
  const bot = normalizeBot(agent);
  if (!bot) return text;
  const at = new Date().toISOString();
  bot.lastActivity = at;
  bot.lastRun = at;
  if (bot.heartbeat) bot.heartbeat = { ...bot.heartbeat, at };
  const bots = (status.bots || []).filter((item) => item.id !== bot.id);
  bots.push(bot);
  return JSON.stringify({ ...status, bots });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://127.0.0.1:${port}`);
  const inboxMatch = inboxPath.exec(url.pathname);
  if (url.pathname === '/api/status' || url.pathname === '/api/tasks' || inboxMatch) {
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
    const route = inboxMatch ? inboxRoute : url.pathname === '/api/tasks' ? tasksRoute : handler;
    const query = Object.fromEntries(url.searchParams);
    if (inboxMatch?.[1]) query.id = inboxMatch[1];
    await route({ method: req.method, headers: req.headers, body, url: req.url, query }, vRes);
    let payload = vRes.body || '';
    if (process.env.HEARTBEAT_FIXTURE === '1' && url.pathname === '/api/status' && req.method === 'GET' && vRes.statusCode === 200 && payload) {
      payload = overlayHeartbeatFixture(payload);
    }
    res.writeHead(vRes.statusCode || 200, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...vRes.headers
    });
    res.end(payload);
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
