import { timingSafeEqual } from 'node:crypto';
import { jsonBlobStore } from '../lib/blob-store.js';
import { validateSectionPost } from '../lib/sections.js';
import {
  applyHeartbeat,
  blobAccess,
  blobConfigured,
  loadLiveStatus,
  parseHeartbeat,
  readSeed,
  rosterBot,
  validateAgentPost
} from '../lib/status.js';

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.setHeader?.('cache-control', 'no-store');
  res.setHeader?.('content-type', 'application/json; charset=utf-8');
  if (typeof res.status === 'function' && typeof res.json === 'function') {
    res.status(code).json(obj);
    return;
  }
  res.statusCode = code;
  res.end(body);
}

function secretOk(headerValue, env) {
  const expected = env.BOT_STATUS_SECRET || '';
  if (!expected || headerValue == null) return false;
  const left = Buffer.from(String(headerValue));
  const right = Buffer.from(expected);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string' && req.body) return JSON.parse(req.body);
  if (typeof req.text === 'function') {
    const raw = await req.text();
    return raw ? JSON.parse(raw) : {};
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

async function storeJson(path, payload, env) {
  if (!blobConfigured(env)) {
    const error = new Error('storage_unconfigured');
    error.code = 'storage_unconfigured';
    throw error;
  }
  const { put } = await import('@vercel/blob');
  await put(path, JSON.stringify(payload), {
    access: blobAccess(env),
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
    cacheControlMaxAge: 60
  });
}

async function storeAgent(agent, env) {
  await storeJson(`agents/${agent.id}.json`, agent, env);
}

async function storeSection(section, env) {
  await storeJson(`sections/${section.section}.json`, section, env);
}

function errorBody(error) {
  const privacy = error.code === 'privacy';
  return {
    ok: false,
    error: privacy ? 'privacy' : (error.code || 'invalid_body'),
    rules: privacy ? [...new Set((error.hits || []).map((hit) => hit.rule))] : undefined,
    message: privacy ? 'Post rejected by the privacy check.' : error.message
  };
}

function isRecord(doc) {
  return Boolean(doc) && typeof doc === 'object' && !Array.isArray(doc);
}

/*
 * Read the bot record, merge, and write with the Blob etag. A conflict retries the merge
 * so a full status post or another heartbeat is not lost. No Blob record and no seed-roster
 * card means the id is unknown: do not create a file.
 */
async function writeHeartbeat(store, parsed, now, roster) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    let doc;
    let etag;
    try {
      ({ doc, etag } = await store.read());
    } catch (error) {
      if (error.code === 'conflict') continue;
      throw error;
    }
    const base = isRecord(doc) ? doc : roster;
    if (!base) {
      const error = new Error('unknown_bot');
      error.code = 'unknown_bot';
      throw error;
    }
    const stored = applyHeartbeat(base, parsed, now());
    try {
      await store.write(stored, etag);
      return stored;
    } catch (error) {
      if (error.code === 'conflict') continue;
      throw error;
    }
  }
  const error = new Error('conflict');
  error.code = 'conflict';
  throw error;
}

export function createStatusHandler({
  env = process.env,
  now = () => new Date(),
  agentStore = null,
  load = loadLiveStatus,
  seed = readSeed
} = {}) {
  return async function handler(req, res) {
    try {
      if (req.method === 'GET') {
        const status = await load({ env });
        send(res, 200, status);
        return;
      }
      if (req.method === 'POST') {
        const header = req.headers?.['x-bot-secret'] || req.headers?.get?.('x-bot-secret');
        if (!env.BOT_STATUS_SECRET) {
          send(res, 503, {
            ok: false,
            error: 'secret_unconfigured',
            message: 'Set BOT_STATUS_SECRET on the Vercel project before accepting posts.'
          });
          return;
        }
        if (!secretOk(header, env)) {
          send(res, 401, { ok: false, error: 'unauthorized' });
          return;
        }
        let body;
        try {
          body = await readBody(req);
        } catch {
          send(res, 400, { ok: false, error: 'invalid_body', message: 'Body must be JSON.' });
          return;
        }
        if (body && typeof body === 'object' && !Array.isArray(body) && body.heartbeat === true) {
          let parsed;
          try {
            parsed = parseHeartbeat(body);
          } catch (error) {
            send(res, 400, errorBody(error));
            return;
          }
          const store = agentStore
            ? agentStore(parsed.id)
            : jsonBlobStore(`agents/${parsed.id}.json`, env, 'heartbeat');
          if (!store.configured()) {
            send(res, 503, {
              ok: false,
              error: 'storage_unconfigured',
              message: 'No Vercel Blob token is configured. A heartbeat merges into the bot record in Blob.'
            });
            return;
          }
          try {
            const roster = rosterBot(parsed.id, seed());
            const stored = await writeHeartbeat(store, parsed, now, roster);
            send(res, 200, { ok: true, id: stored.id, stored: 'blob', at: stored.lastRun });
          } catch (error) {
            if (error.code === 'unknown_bot') {
              send(res, 404, { ok: false, error: 'unknown_bot' });
              return;
            }
            if (error.code === 'conflict') {
              send(res, 409, { ok: false, error: 'conflict', message: 'The bot record changed while saving. Try again.' });
              return;
            }
            send(res, 502, { ok: false, error: 'store_failed' });
          }
          return;
        }
        const sectionPost = body && typeof body === 'object' && !Array.isArray(body) && body.section;
        let stored;
        try {
          stored = sectionPost ? validateSectionPost(body) : validateAgentPost(body);
        } catch (error) {
          send(res, 400, errorBody(error));
          return;
        }
        try {
          if (sectionPost) await storeSection(stored, env);
          else await storeAgent(stored, env);
        } catch (error) {
          if (error.code === 'storage_unconfigured') {
            send(res, 503, {
              ok: false,
              error: 'storage_unconfigured',
              message: sectionPost
                ? 'No Vercel Blob token is configured. Health, calendar, kids, home, business, and money posts stay in Blob only. Do not commit them.'
                : 'No Vercel Blob token is configured. Commit agents/<id>.json on main instead. GET /api/status reads GitHub when it can, and the committed status.json is always the fallback. Blob on the Hobby plan has a free allowance; do not turn on a paid plan for this.'
            });
            return;
          }
          send(res, 502, { ok: false, error: 'store_failed' });
          return;
        }
        send(res, 200, sectionPost
          ? { ok: true, section: stored.section, stored: 'blob' }
          : { ok: true, id: stored.id, stored: 'blob' });
        return;
      }
      res.setHeader?.('allow', 'GET, POST');
      send(res, 405, { ok: false, error: 'method_not_allowed' });
    } catch {
      send(res, 500, { ok: false, error: 'status_failed' });
    }
  };
}

export default createStatusHandler();
