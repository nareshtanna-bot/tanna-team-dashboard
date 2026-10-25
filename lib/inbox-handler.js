import { header, queryOf, readBody, send } from './http.js';
import { jsonBlobStore } from './blob-store.js';
import { bearerOk, createItem, emptyInbox, filterItems, inboxBlobKey, LIMITS, normalizeInbox, updateItem } from './inbox.js';

/*
 * /api/inbox and /api/inbox/:id
 *
 * Every request first passes the site's existing gate (Vercel Deployment Protection), same as /api/tasks.
 * Then:
 * - Bots: `Authorization: Bearer <MC_INBOX_TOKEN>` for GET, POST, and PATCH. Missing or wrong token is 401.
 * - The page itself (Sec-Fetch-Site: same-origin, set by the browser and not by page script) may GET and POST,
 *   since the gate session already identifies Naresh. Only bots PATCH.
 *
 * Production uses `inbox/inbox.json`; every other deployment uses `inbox/preview/inbox.json`.
 */

const STATUS_FOR = { invalid_item: 400, invalid_status: 400, privacy: 422, not_found: 404 };

export function inboxStore(env = process.env) {
  return jsonBlobStore(inboxBlobKey(env), env, 'inbox');
}

function actorOf(req, env) {
  const auth = header(req, 'authorization');
  if (auth != null && auth !== '') return bearerOk(auth, env) ? 'bot' : null;
  return header(req, 'sec-fetch-site') === 'same-origin' ? 'browser' : null;
}

function errorBody(error) {
  return { ok: false, error: error.code || 'invalid_item', rules: error.rules, message: error.message };
}

async function readDoc(store) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await store.read();
    } catch (error) {
      if (error.code !== 'conflict' || attempt === 2) throw error;
    }
  }
  return { doc: null, etag: null };
}

export function createInboxHandler({ store: storeOption, env = process.env, now = () => new Date() } = {}) {
  return async function handler(req, res) {
    try {
      if (!['GET', 'POST', 'PATCH'].includes(req.method)) {
        res.setHeader?.('allow', 'GET, POST, PATCH');
        send(res, 405, { ok: false, error: 'method_not_allowed' });
        return;
      }
      const actor = actorOf(req, env);
      if (!actor) {
        send(res, 401, { ok: false, error: 'unauthorized', message: 'Send Authorization: Bearer <MC_INBOX_TOKEN>, or use the page.' });
        return;
      }
      const query = queryOf(req);
      const id = query.id || null;
      if (req.method === 'PATCH' && actor !== 'bot') {
        send(res, 401, { ok: false, error: 'unauthorized', message: 'Only bots update inbox items.' });
        return;
      }
      if (req.method === 'PATCH' && !id) {
        send(res, 400, { ok: false, error: 'invalid_item', message: 'PATCH /api/inbox/:id' });
        return;
      }
      if (req.method === 'POST' && id) {
        send(res, 405, { ok: false, error: 'method_not_allowed', message: 'POST /api/inbox' });
        return;
      }
      const store = storeOption || inboxStore(env);
      if (!store.configured()) {
        send(res, 503, { ok: false, error: 'storage_unconfigured', message: 'No Vercel Blob token is configured.' });
        return;
      }

      if (req.method === 'GET') {
        const { doc } = await readDoc(store);
        const all = normalizeInbox(doc).items;
        let items;
        try {
          items = filterItems(id ? all.filter((item) => item.id === id) : all, query.status);
        } catch (error) {
          send(res, 400, errorBody(error));
          return;
        }
        send(res, 200, { ok: true, items });
        return;
      }

      let body;
      try {
        body = await readBody(req);
      } catch {
        send(res, 400, { ok: false, error: 'invalid_body', message: 'Body must be JSON.' });
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
        const doc = normalizeInbox(raw || emptyInbox(at));
        let item;
        let items;
        try {
          if (req.method === 'POST') {
            item = createItem(body, { now: at });
            items = [...doc.items, item].slice(-LIMITS.items);
          } else {
            const current = doc.items.find((row) => row.id === id);
            if (!current) {
              send(res, 404, { ok: false, error: 'not_found', message: 'No inbox item with that id.' });
              return;
            }
            item = updateItem(current, body, { now: at });
            items = doc.items.map((row) => (row.id === id ? item : row));
          }
        } catch (error) {
          send(res, STATUS_FOR[error.code] || 400, errorBody(error));
          return;
        }
        try {
          await store.write({ ...doc, updated: at.toISOString(), items }, etag);
        } catch (error) {
          if (error.code === 'conflict') continue;
          throw error;
        }
        send(res, req.method === 'POST' ? 201 : 200, { ok: true, item });
        return;
      }
      send(res, 409, { ok: false, error: 'conflict', message: 'The inbox changed while saving. Try again.' });
    } catch (error) {
      console.error(`inbox: ${req.method} failed (${error?.name || 'error'})`);
      send(res, 500, { ok: false, error: 'inbox_failed' });
    }
  };
}
