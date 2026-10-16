import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertClean } from './privacy.js';
import { withLiveSections } from './sections.js';

const STATUS_MAP = {
  active: 'working',
  working: 'working',
  idle: 'idle',
  standby: 'idle',
  blocked: 'blocked',
  pending_goals: 'blocked'
};

const REQUEST_MAP = {
  queued: 'queued',
  working: 'working',
  waiting: 'waiting',
  waiting_on_naresh: 'waiting',
  done: 'done',
  delivered: 'done'
};

const CLOSED_STATUS = new Set(['done', 'delivered']);

export function isClosedStatus(status) {
  return CLOSED_STATUS.has(String(status || '').trim().toLowerCase());
}

export function openNeedsYou(needsYou, requests = []) {
  const closedIds = new Set(
    (requests || []).filter((item) => item?.id && isClosedStatus(item.status)).map((item) => item.id)
  );
  return (needsYou || []).filter(
    (item) => item && !isClosedStatus(item.status) && !(item.id && closedIds.has(item.id))
  );
}

const DAY = 24 * 60 * 60 * 1000;

export function readSeed() {
  const here = dirname(fileURLToPath(import.meta.url));
  const raw = readFileSync(join(here, '..', 'status.json'), 'utf8');
  return JSON.parse(raw);
}

export function isStale(iso, now = Date.now()) {
  if (!iso) return true;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return true;
  return now - t > DAY;
}

export function formatET(date) {
  const value = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(value.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short'
  }).formatToParts(value);
  const get = (type) => parts.find((part) => part.type === type)?.value || '';
  const tz = get('timeZoneName').includes('ET') ? 'ET' : get('timeZoneName').replace(/^[A-Z]{1,2}/, '').includes('ST') ? 'ET' : 'ET';
  return `${get('month')} ${get('day')}, ${get('year')} · ${get('hour')}:${get('minute')} ${get('dayPeriod')} ${tz}`;
}

export function normalizeBot(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || '').trim().toLowerCase();
  if (!/^[a-z0-9-]{2,32}$/.test(id)) return null;
  const status = STATUS_MAP[raw.status] || 'idle';
  return {
    id,
    name: String(raw.name || id),
    role: String(raw.role || ''),
    does: String(raw.does || ''),
    status,
    task: String(raw.task ?? raw.working_on ?? ''),
    next: String(raw.next || ''),
    lastActivity: raw.lastActivity || raw.last_activity || null
  };
}

function byId(list) {
  const map = new Map();
  for (const item of list || []) {
    if (item && item.id) map.set(item.id, item);
  }
  return map;
}

function recordCompletion(activity, seen, addActivity, item, fallbackBot) {
  if (!item?.id) return;
  const covered = activity.some((row) =>
    row.id === item.id
    || row.id === `done:${item.id}`
    || (item.output && row.output && row.output === item.output)
  );
  if (covered || seen.has(`done:${item.id}`)) return;
  const at = item.completedAt || item.at || (item.date ? `${item.date}T12:00:00-04:00` : '');
  addActivity({
    id: `done:${item.id}`,
    at,
    bot: item.bot || item.owner || fallbackBot || '',
    title: item.title || item.id,
    detail: item.detail || item.request || '',
    example: false,
    output: item.output || '',
    status: 'done'
  }, item.bot || item.owner || fallbackBot || '');
}

function newestIso(values) {
  let best = null;
  let bestMs = -Infinity;
  for (const value of values) {
    const ms = Date.parse(value || '');
    if (!Number.isNaN(ms) && ms > bestMs) {
      bestMs = ms;
      best = value;
    }
  }
  return best;
}

export function mergeStatus(seed, agentFiles, now = new Date()) {
  const status = structuredClone(seed);
  const order = (status.bots || []).map((bot) => bot.id);
  const bots = new Map();
  for (const bot of status.bots || []) {
    const normalized = normalizeBot(bot);
    if (normalized) bots.set(normalized.id, normalized);
  }
  const needs = byId(status.needsYou);
  const requests = byId(status.requests);
  const routines = byId(status.routines);
  const queue = byId(status.queue);
  const trips = byId(status.trips);
  const activity = [];
  const seen = new Set();

  function addActivity(item, fallbackBot) {
    if (!item || !item.id || seen.has(item.id)) return;
    seen.add(item.id);
    activity.push({
      ...item,
      bot: item.bot || fallbackBot || ''
    });
  }

  for (const item of status.activity || []) addActivity(item, item.bot);

  for (const file of agentFiles || []) {
    const bot = normalizeBot(file);
    if (!bot) continue;
    const prev = bots.get(bot.id) || {};
    bots.set(bot.id, { ...prev, ...bot });
    for (const item of file.needsYou || []) if (item?.id) needs.set(item.id, item);
    for (const item of file.requests || []) {
      if (!item?.id) continue;
      requests.set(item.id, {
        ...item,
        status: REQUEST_MAP[item.status] || item.status || 'queued'
      });
    }
    for (const item of file.routines || []) if (item?.id) routines.set(item.id, item);
    for (const item of file.queue || []) if (item?.id) queue.set(item.id, item);
    for (const item of file.trips || []) if (item?.id) trips.set(item.id, { ...(trips.get(item.id) || {}), ...item });
    for (const item of file.activity || []) addActivity(item, file.name || bot.id);
  }

  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  const botList = [...bots.values()]
    .map((bot) => ({ ...bot, stale: isStale(bot.lastActivity, nowMs) }))
    .sort((a, b) => {
      const ai = order.indexOf(a.id);
      const bi = order.indexOf(b.id);
      if (ai === -1 && bi === -1) return a.name.localeCompare(b.name);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });

  const normalizedRequests = [...requests.values()].map((item) => ({
    ...item,
    status: REQUEST_MAP[item.status] || item.status || 'queued'
  }));
  const closedIds = new Set(
    normalizedRequests.filter((item) => item?.id && isClosedStatus(item.status)).map((item) => item.id)
  );
  for (const item of needs.values()) {
    if (!item?.id) continue;
    if (!isClosedStatus(item.status) && !closedIds.has(item.id)) continue;
    recordCompletion(activity, seen, addActivity, item, item.bot || item.owner || '');
  }
  for (const item of normalizedRequests) {
    if (!isClosedStatus(item.status)) continue;
    recordCompletion(activity, seen, addActivity, item, item.owner || '');
  }

  activity.sort((a, b) => Date.parse(b.at || 0) - Date.parse(a.at || 0));
  const updated = newestIso([
    status.updated,
    ...botList.map((bot) => bot.lastActivity),
    ...activity.map((item) => item.at)
  ]);

  return {
    ...status,
    updated: updated || status.updated,
    updatedLabel: updated ? formatET(updated) : status.updatedLabel || '',
    bots: botList,
    needsYou: openNeedsYou([...needs.values()], normalizedRequests),
    requests: normalizedRequests,
    routines: [...routines.values()],
    queue: [...queue.values()],
    trips: [...trips.values()],
    activity: activity.slice(0, 300)
  };
}

export function blobConfigured(env = process.env) {
  return Boolean(env.BLOB_READ_WRITE_TOKEN || env.BLOB_STORE_ID);
}

export function blobAccess(env = process.env) {
  return env.BLOB_ACCESS === 'public' ? 'public' : 'private';
}

async function readStream(stream) {
  if (!stream) return '';
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

async function readBlobPrefix(prefix, env) {
  const { list, get } = await import('@vercel/blob');
  const access = blobAccess(env);
  const files = [];
  let cursor;
  do {
    const page = await list({ prefix, limit: 100, cursor });
    for (const blob of page.blobs || []) {
      if (!blob.pathname.endsWith('.json')) continue;
      const file = await get(blob.pathname, { access, useCache: false });
      if (!file || file.statusCode !== 200 || !file.stream) continue;
      const text = await readStream(file.stream);
      try {
        assertClean(text, blob.pathname);
        files.push(JSON.parse(text));
      } catch {
        // Drop a stored file that no longer passes the privacy gate.
      }
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return files;
}

export async function readBlobAgents(env = process.env) {
  if (!blobConfigured(env)) return [];
  return readBlobPrefix('agents/', env);
}

export async function readBlobSections(env = process.env) {
  if (!blobConfigured(env)) return {};
  const { assertClinical } = await import('./privacy.js');
  const files = await readBlobPrefix('sections/', env);
  const sections = {};
  for (const file of files) {
    const name = file?.section;
    if (!name || sections[name]) continue;
    if (name === 'health') {
      try {
        assertClinical(file, `sections/${name}.json`);
      } catch {
        continue;
      }
    }
    sections[name] = file;
  }
  return sections;
}

function githubHeaders(env) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'tanna-mission-control',
    'X-GitHub-Api-Version': '2022-11-28'
  };
  const token = env.GITHUB_TOKEN || env.GH_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function githubGet(path, env, fetchImpl) {
  const repo = env.GITHUB_REPOSITORY || 'nareshtanna-bot/tanna-team-dashboard';
  const url = `https://api.github.com/repos/${repo}/contents/${path}`;
  const response = await fetchImpl(url, {
    headers: githubHeaders(env),
    signal: AbortSignal.timeout(8000)
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    const error = new Error(`github ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

export async function readGithubStatus(env = process.env, fetchImpl = fetch) {
  const result = { status: null, agents: [], ok: false };
  try {
    const statusBody = await githubGet('status.json', env, fetchImpl);
    if (statusBody?.content) {
      const text = Buffer.from(statusBody.content, 'base64').toString('utf8');
      assertClean(text, 'github:status.json');
      result.status = JSON.parse(text);
    }
    const listing = await githubGet('agents', env, fetchImpl);
    if (Array.isArray(listing)) {
      for (const entry of listing) {
        if (entry.type !== 'file' || !entry.name.endsWith('.json')) continue;
        const file = await githubGet(`agents/${entry.name}`, env, fetchImpl);
        if (!file?.content) continue;
        const text = Buffer.from(file.content, 'base64').toString('utf8');
        try {
          assertClean(text, `github:agents/${entry.name}`);
          result.agents.push(JSON.parse(text));
        } catch {
          // Skip a file the privacy gate rejects.
        }
      }
    }
    result.ok = true;
  } catch {
    result.ok = false;
  }
  return result;
}

export async function loadLiveStatus(options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || fetch;
  const seed = options.seed || readSeed();
  let base = seed;
  let source = 'seed';
  let githubOk = false;
  let blobCount = 0;

  if (options.skipRemote !== true) {
    const github = await (options.readGithub
      ? options.readGithub(env, fetchImpl)
      : readGithubStatus(env, fetchImpl));
    githubOk = Boolean(github?.ok);
    const seedUpdated = Date.parse(seed.updated || '');
    const githubUpdated = Date.parse(github?.status?.updated || '');
    if (github?.status && !Number.isNaN(githubUpdated) && (Number.isNaN(seedUpdated) || githubUpdated > seedUpdated)) {
      base = github.status;
      source = 'github';
    }
    const githubAgents = github?.agents || [];
    let blobAgents = [];
    if (blobConfigured(env)) {
      try {
        blobAgents = options.readBlob ? await options.readBlob(env) : await readBlobAgents(env);
        blobCount = blobAgents.length;
      } catch {
        blobAgents = [];
      }
    }
    const agents = [...githubAgents, ...blobAgents];
    if (blobCount > 0) source = 'blob';
    else if (githubAgents.length && source === 'seed') source = 'github';
    let liveSections = {};
    if (blobConfigured(env)) {
      try {
        liveSections = options.readSections ? await options.readSections(env) : await readBlobSections(env);
      } catch {
        liveSections = {};
      }
    }
    const merged = withLiveSections(mergeStatus(base, agents, options.now || new Date()), liveSections, options.now || new Date());
    return {
      ...merged,
      source,
      meta: {
        source,
        blob: blobConfigured(env) && (blobCount > 0 || Object.keys(liveSections).length > 0),
        blobConfigured: blobConfigured(env),
        github: githubOk,
        agents: agents.length,
        sections: Object.keys(liveSections)
      }
    };
  }

  const merged = withLiveSections(mergeStatus(base, options.agents || [], options.now || new Date()), options.sections || {}, options.now || new Date());
  return {
    ...merged,
    source,
    meta: { source, blob: false, blobConfigured: blobConfigured(env), github: false, agents: (options.agents || []).length }
  };
}

export function validateAgentPost(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    const error = new Error('Body must be one agent object');
    error.code = 'invalid_body';
    throw error;
  }
  const bot = normalizeBot(body);
  if (!bot) {
    const error = new Error('id must be 2–32 lowercase letters, numbers, or hyphens');
    error.code = 'invalid_id';
    throw error;
  }
  if (!bot.name) {
    const error = new Error('name is required');
    error.code = 'invalid_body';
    throw error;
  }
  const text = JSON.stringify(body);
  if (text.length > 60000) {
    const error = new Error('Payload is too large');
    error.code = 'too_large';
    throw error;
  }
  assertClean(text, `agents/${bot.id}.json`);
  return { ...body, id: bot.id, name: bot.name, status: bot.status, receivedAt: new Date().toISOString() };
}
