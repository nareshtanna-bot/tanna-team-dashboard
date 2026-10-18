import { timingSafeEqual } from 'node:crypto';
import { blobAccess, blobConfigured } from '../lib/status.js';
import {
  applyPatch, applyPost, counts, emptyDoc, etDay, filterView, normalizeDoc, sortTasks, tasksBlobKey, todaySections, VIEWS
} from '../lib/tasks.js';

/*
 * /api/tasks: one JSON document in the private Blob store (never in git).
 *
 * Who can call it:
 * - Every request first passes Vercel Deployment Protection (SSO for Naresh's browser, the automation
 *   bypass header for bots), the same gate as /api/status.
 * - GET is open behind that gate, like GET /api/status. `?shared=1` leaves out private tasks.
 * - POST and PATCH from a bot need `x-bot-secret` (BOT_STATUS_SECRET). Source is `bot`, or `things-import`
 *   when the body says so.
 * - POST and PATCH from the page itself (Sec-Fetch-Site: same-origin, which a browser sets and page script
 *   cannot) are allowed without the secret, since the SSO cookie already identifies Naresh. Source is `manual`.
 * - A wrong secret is always 401.
 *
 * Production writes `tasks/tasks.json`; every other deployment writes `tasks/preview/tasks.json`
 * (override with TASKS_BLOB_KEY), so a preview never touches the production document.
 */

function send(res, code, obj) {
  res.setHeader?.('cache-control', 'no-store');
  res.setHeader?.('content-type', 'application/json; charset=utf-8');
  if (typeof res.status === 'function' && typeof res.json === 'function') {
    res.status(code).json(obj);
    return;
  }
  res.statusCode = code;
  res.end(JSON.stringify(obj));
}

function header(req, name) {
  return req.headers?.[name] ?? req.headers?.get?.(name) ?? null;
}

function secretOk(value, env) {
  const expected = env.BOT_STATUS_SECRET || '';
  if (!expected || value == null) return false;
  const left = Buffer.from(String(value));
  const right = Buffer.from(expected);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string' && req.body) return JSON.parse(req.body);
  if (Buffer.isBuffer(req.body)) return req.body.length ? JSON.parse(req.body.toString('utf8')) : {};
  if (typeof req.text === 'function') {
    const raw = await req.text();
    return raw ? JSON.parse(raw) : {};
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function queryOf(req) {
  if (req.query && typeof req.query === 'object') return req.query;
  try {
    return Object.fromEntries(new URL(req.url || '/', 'http://local').searchParams);
  } catch {
    return {};
  }
}

async function readStream(stream) {
  if (typeof stream.getReader === 'function') {
    const reader = stream.getReader();
    const chunks = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks).toString('utf8');
  }
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

/** Blob-backed store with optimistic concurrency (ETag / ifMatch). */
export function blobStore(env = process.env) {
  const key = tasksBlobKey(env);
  return {
    key,
    kind: 'blob',
    configured: () => blobConfigured(env),
    async read() {
      const { get, head, BlobNotFoundError } = await import('@vercel/blob');
      // The ETag comes from head() (the Blob API), the same source put() checks ifMatch against.
      // If the document changes between head() and get(), the write fails the ifMatch check and retries,
      // so an update is never lost.
      let meta;
      try {
        meta = await head(key);
      } catch (error) {
        if (error instanceof BlobNotFoundError) return { doc: null, etag: null };
        throw error;
      }
      const file = await get(key, { access: blobAccess(env), useCache: false });
      if (!file || file.statusCode !== 200 || !file.stream) {
        const stale = new Error('conflict');
        stale.code = 'conflict';
        throw stale;
      }
      return { doc: JSON.parse(await readStream(file.stream)), etag: meta?.etag || file.blob?.etag || null };
    },
    async write(doc, etag) {
      const { put, BlobPreconditionFailedError } = await import('@vercel/blob');
      try {
        await put(key, JSON.stringify(doc), {
          access: blobAccess(env),
          addRandomSuffix: false,
          allowOverwrite: Boolean(etag),
          ...(etag ? { ifMatch: etag } : {}),
          contentType: 'application/json',
          cacheControlMaxAge: 60
        });
      } catch (error) {
        const precondition = error instanceof BlobPreconditionFailedError;
        if (precondition || /already exists/i.test(String(error?.message))) {
          console.warn(`tasks: write conflict (${precondition ? 'etag' : 'exists'})`);
          const conflict = new Error('conflict');
          conflict.code = 'conflict';
          throw conflict;
        }
        throw error;
      }
    }
  };
}

/** In-memory store for tests and the local dev server. */
export function memoryStore(initial = null) {
  let doc = initial ? structuredClone(initial) : null;
  let version = initial ? 1 : 0;
  return {
    key: 'memory',
    kind: 'memory',
    configured: () => true,
    async read() {
      return { doc: doc ? structuredClone(doc) : null, etag: doc ? String(version) : null };
    },
    async write(next, etag) {
      if ((etag || null) !== (doc ? String(version) : null)) {
        const conflict = new Error('conflict');
        conflict.code = 'conflict';
        throw conflict;
      }
      doc = structuredClone(next);
      version += 1;
    },
    peek: () => (doc ? structuredClone(doc) : null)
  };
}

function errorBody(error) {
  const code = error.code || 'invalid_task';
  return {
    ok: false,
    error: code,
    rules: code === 'privacy' ? [...new Set((error.hits || []).map((hit) => hit.rule))] : undefined,
    message: code === 'privacy' ? 'Task rejected by the secret check.' : error.message
  };
}

const STATUS_FOR = { invalid_task: 400, invalid_view: 400, invalid_sort: 400, privacy: 400, too_large: 413, not_found: 404 };

export function createTasksHandler({ store: storeOption, env = process.env, now = () => new Date() } = {}) {
  return async function handler(req, res) {
    const store = storeOption || blobStore(env);
    try {
      if (req.method === 'GET') {
        if (!store.configured()) {
          send(res, 503, { ok: false, error: 'storage_unconfigured', message: 'No Vercel Blob token is configured. Tasks live only in Blob, never in git.' });
          return;
        }
        const query = queryOf(req);
        const view = query.view || null;
        const sort = query.sort || 'asc';
        const shared = query.shared === '1' || query.shared === 'true';
        const today = etDay(now());
        let raw = null;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            ({ doc: raw } = await store.read());
            break;
          } catch (error) {
            if (error.code !== 'conflict' || attempt === 2) throw error;
          }
        }
        const doc = normalizeDoc(raw || emptyDoc(now()));
        const visible = shared ? doc.tasks.filter((task) => !task.private) : doc.tasks;
        const meta = { schema: doc.schema, updated: doc.updated, today, storage: store.kind, key: store.key, shared, counts: counts(doc.tasks, today, { shared }) };
        if (view) {
          if (!VIEWS.includes(view)) {
            send(res, 400, { ok: false, error: 'invalid_view', message: `view must be one of ${VIEWS.join(', ')}` });
            return;
          }
          if (sort !== 'asc' && sort !== 'desc') {
            send(res, 400, { ok: false, error: 'invalid_sort', message: 'sort must be asc or desc' });
            return;
          }
          const tasks = sortTasks(filterView(doc.tasks, view, { today, shared }), sort, view);
          const body = { ok: true, view, sort, tasks, meta };
          if (view === 'today') body.sections = todaySections(doc.tasks, sort, today, { shared });
          send(res, 200, body);
          return;
        }
        const visibleIds = new Set(visible.map((task) => task.id));
        send(res, 200, {
          ok: true,
          areas: shared ? doc.areas.filter((area) => !area.private) : doc.areas,
          projects: shared ? doc.projects.filter((project) => !project.private) : doc.projects,
          tasks: doc.tasks.filter((task) => visibleIds.has(task.id)),
          meta
        });
        return;
      }

      if (req.method !== 'POST' && req.method !== 'PATCH') {
        res.setHeader?.('allow', 'GET, POST, PATCH');
        send(res, 405, { ok: false, error: 'method_not_allowed' });
        return;
      }

      const secret = header(req, 'x-bot-secret');
      let actor;
      if (secret != null) {
        if (!env.BOT_STATUS_SECRET) {
          send(res, 503, { ok: false, error: 'secret_unconfigured', message: 'Set BOT_STATUS_SECRET on the Vercel project before accepting bot posts.' });
          return;
        }
        if (!secretOk(secret, env)) {
          send(res, 401, { ok: false, error: 'unauthorized' });
          return;
        }
        actor = 'bot';
      } else if (header(req, 'sec-fetch-site') === 'same-origin') {
        actor = 'browser';
      } else {
        send(res, 401, { ok: false, error: 'unauthorized', message: 'Send x-bot-secret, or use the page.' });
        return;
      }

      let body;
      try {
        body = await readBody(req);
      } catch {
        send(res, 400, { ok: false, error: 'invalid_body', message: 'Body must be JSON.' });
        return;
      }
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        send(res, 400, { ok: false, error: 'invalid_body', message: 'Body must be a JSON object.' });
        return;
      }
      if (JSON.stringify(body).length > 2_000_000) {
        send(res, 413, { ok: false, error: 'too_large' });
        return;
      }
      if (!store.configured()) {
        send(res, 503, { ok: false, error: 'storage_unconfigured', message: 'No Vercel Blob token is configured. Tasks live only in Blob, never in git.' });
        return;
      }

      const source = actor === 'browser' ? 'manual' : (body.source === 'things-import' ? 'things-import' : 'bot');
      const { source: _ignored, ...payload } = body;
      const id = queryOf(req).id || payload.id;
      if (req.method === 'PATCH' && !id) {
        send(res, 400, { ok: false, error: 'invalid_task', message: 'PATCH needs an id (in the body or ?id=).' });
        return;
      }

      for (let attempt = 0; attempt < 4; attempt += 1) {
        const at = now();
        let raw;
        let etag;
        try {
          ({ doc: raw, etag } = await store.read());
        } catch (error) {
          if (error.code === 'conflict') continue;
          throw error;
        }
        const doc = normalizeDoc(raw || emptyDoc(at));
        let result;
        try {
          result = req.method === 'POST'
            ? applyPost(doc, payload, { now: at, source })
            : applyPatch(doc, id, body, { now: at });
        } catch (error) {
          send(res, STATUS_FOR[error.code] || 400, errorBody(error));
          return;
        }
        try {
          await store.write(result.doc, etag);
        } catch (error) {
          if (error.code === 'conflict') continue;
          throw error;
        }
        if (req.method === 'PATCH') {
          send(res, 200, { ok: true, task: result.task });
        } else {
          send(res, result.task && result.created ? 201 : 200, {
            ok: true,
            task: result.task,
            created: result.created,
            updated: result.updated,
            rejected: result.rejected
          });
        }
        return;
      }
      send(res, 409, { ok: false, error: 'conflict', message: 'The task list changed while saving. Try again.' });
    } catch (error) {
      console.error(`tasks: ${req.method} failed (${error?.name || 'error'})`);
      send(res, 500, { ok: false, error: 'tasks_failed' });
    }
  };
}

export default createTasksHandler();
