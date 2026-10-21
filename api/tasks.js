import { timingSafeEqual } from 'node:crypto';
import { header, queryOf, readBody, send } from '../lib/http.js';
import { jsonBlobStore, memoryStore } from '../lib/blob-store.js';
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

function secretOk(value, env) {
  const expected = env.BOT_STATUS_SECRET || '';
  if (!expected || value == null) return false;
  const left = Buffer.from(String(value));
  const right = Buffer.from(expected);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** Blob-backed store for the tasks document (shared helper in lib/blob-store.js). */
export function blobStore(env = process.env) {
  return jsonBlobStore(tasksBlobKey(env), env, 'tasks');
}

export { memoryStore };

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
