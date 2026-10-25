import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createStatusHandler } from '../api/status.js';
import { memoryStore } from '../lib/blob-store.js';
import { scanText } from '../lib/privacy.js';
import { isStale, mergeStatus, normalizeBot } from '../lib/status.js';

const NOW = new Date('2026-10-25T16:00:00.000Z');
const SECRET = 'test-secret-value';

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(key, value) { this.headers[key] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(obj) { this.body = JSON.stringify(obj); return this; },
    end(payload) { if (payload) this.body = payload; return this; }
  };
}

function existingBot() {
  return {
    id: 'nomad',
    name: 'Nomad',
    role: 'Travel',
    does: 'Plans trips',
    status: 'working',
    task: 'Bermuda plan',
    next: 'Wait for a date',
    needsYou: [{ id: 'flight', title: 'Pick a flight' }],
    lastActivity: '2026-10-01T12:00:00.000Z',
    customNote: 'keep me'
  };
}

function handlerFor(store, env = { BOT_STATUS_SECRET: SECRET }) {
  return createStatusHandler({
    env,
    now: () => NOW,
    agentStore: () => store
  });
}

async function post(handler, body, headers = { 'x-bot-secret': SECRET }) {
  const res = mockRes();
  await handler({ method: 'POST', headers, body }, res);
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : {} };
}

test('a heartbeat merges and preserves existing fields', async () => {
  const store = memoryStore(existingBot());
  const { status, body } = await post(handlerFor(store), {
    heartbeat: true,
    id: 'nomad',
    status: 'Routine finished. Board is current.',
    state: 'ok',
    task: 'This line must not replace the task',
    needsYou: []
  });
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.id, 'nomad');
  assert.equal(body.stored, 'blob');
  assert.equal(body.at, NOW.toISOString());

  const saved = store.peek();
  assert.equal(saved.name, 'Nomad');
  assert.equal(saved.role, 'Travel');
  assert.equal(saved.does, 'Plans trips');
  assert.equal(saved.status, 'working');
  assert.equal(saved.task, 'Bermuda plan');
  assert.equal(saved.next, 'Wait for a date');
  assert.equal(saved.customNote, 'keep me');
  assert.deepEqual(saved.needsYou, [{ id: 'flight', title: 'Pick a flight' }]);
  assert.equal(saved.lastActivity, NOW.toISOString());
  assert.equal(saved.lastRun, NOW.toISOString());
  assert.deepEqual(saved.heartbeat, {
    at: NOW.toISOString(),
    line: 'Routine finished. Board is current.',
    state: 'ok'
  });
});

test('a heartbeat clears staleness', async () => {
  assert.equal(isStale(existingBot().lastActivity, NOW.getTime()), true);
  const store = memoryStore(existingBot());
  const { status } = await post(handlerFor(store), {
    heartbeat: true,
    id: 'Nomad',
    status: 'Routine finished. Board is current.'
  });
  assert.equal(status, 200);
  const saved = store.peek();
  assert.equal(isStale(saved.lastActivity, NOW.getTime()), false);
  const board = mergeStatus({
    updated: '2026-10-01T12:00:00.000Z',
    bots: [existingBot()],
    needsYou: [],
    requests: [],
    routines: [],
    queue: [],
    trips: [],
    activity: []
  }, [saved], NOW);
  const bot = board.bots.find((item) => item.id === 'nomad');
  assert.equal(bot.stale, false);
  assert.equal(bot.task, 'Bermuda plan');
  assert.equal(bot.heartbeat.line, 'Routine finished. Board is current.');
  assert.equal(bot.heartbeat.state, null);
  assert.equal(bot.lastRun, NOW.toISOString());
});

test('an unknown bot is not created', async () => {
  const store = memoryStore(null);
  const { status, body } = await post(handlerFor(store), {
    heartbeat: true,
    id: 'ghost-bot',
    status: 'First run.',
    state: 'ok'
  });
  assert.equal(status, 404);
  assert.deepEqual(body, { ok: false, error: 'unknown_bot' });
  assert.equal(store.peek(), null);
  const seed = JSON.parse(readFileSync(new URL('../status.json', import.meta.url), 'utf8'));
  const merged = mergeStatus(seed, [], NOW);
  assert.equal(merged.bots.some((bot) => bot.id === 'ghost-bot'), false);
});

test('a roster bot with no blob record is stamped onto its existing card', async () => {
  const seed = JSON.parse(readFileSync(new URL('../status.json', import.meta.url), 'utf8'));
  const roster = seed.bots.find((bot) => bot.id === 'nomad');
  const store = memoryStore(null);
  const { status } = await post(handlerFor(store), {
    heartbeat: true,
    id: 'nomad',
    status: 'Routine finished. Board is current.',
    state: 'ok'
  });
  assert.equal(status, 200);
  const saved = store.peek();
  assert.equal(saved.name, roster.name);
  assert.equal(saved.role, roster.role);
  assert.equal(saved.task, roster.task);
  assert.equal(saved.heartbeat.line, 'Routine finished. Board is current.');
  const merged = mergeStatus(seed, [saved], NOW);
  assert.equal(merged.bots.length, seed.bots.length);
  assert.equal(merged.bots.filter((bot) => bot.id === 'nomad').length, 1);
  assert.equal(merged.bots.find((bot) => bot.id === 'nomad').stale, false);
});

test('a bad id is rejected', async () => {
  const store = memoryStore(existingBot());
  const { status, body } = await post(handlerFor(store), {
    heartbeat: true,
    id: 'nope!',
    status: 'Routine finished.'
  });
  assert.equal(status, 400);
  assert.equal(body.error, 'invalid_id');
  assert.equal(store.peek().task, 'Bermuda plan');
  assert.equal(store.peek().lastActivity, '2026-10-01T12:00:00.000Z');
});

test('a privacy-violating line is rejected', async () => {
  const store = memoryStore(existingBot());
  const lines = [
    ['about $2 left', 'dollar_amount'],
    ['creatine in the stack', 'health_term'],
    ['token: abcdefghijklmnop', 'secret'],
    ['10 Oak Street', 'street_address']
  ];
  for (const [line, rule] of lines) {
    const { status, body } = await post(handlerFor(store), {
      heartbeat: true,
      id: 'nomad',
      status: line
    });
    assert.equal(status, 400);
    assert.equal(body.error, 'privacy');
    assert.ok(body.rules.includes(rule));
    assert.equal(JSON.stringify(body).includes(line), false);
  }
  assert.equal(store.peek().lastActivity, '2026-10-01T12:00:00.000Z');
  assert.equal(store.peek().heartbeat, undefined);
});

test('a missing secret is rejected', async () => {
  const store = memoryStore(existingBot());
  const { status, body } = await post(
    handlerFor(store),
    { heartbeat: true, id: 'nomad', status: 'Routine finished.' },
    {}
  );
  assert.equal(status, 401);
  assert.equal(body.error, 'unauthorized');
  assert.equal(store.peek().task, 'Bermuda plan');
});

test('a heartbeat retries a conflict and then merges', async () => {
  const inner = memoryStore(existingBot());
  let writes = 0;
  const store = {
    configured: () => true,
    read: () => inner.read(),
    async write(doc, etag) {
      writes += 1;
      if (writes === 1) {
        const error = new Error('conflict');
        error.code = 'conflict';
        throw error;
      }
      return inner.write(doc, etag);
    },
    peek: () => inner.peek()
  };
  const { status } = await post(handlerFor(store), {
    heartbeat: true,
    id: 'nomad',
    status: 'Routine finished. Board is current.',
    state: 'working'
  });
  assert.equal(status, 200);
  assert.equal(writes, 2);
  assert.equal(store.peek().task, 'Bermuda plan');
  assert.equal(store.peek().heartbeat.state, 'working');
  assert.equal(store.peek().status, 'working');
});

test('the heartbeat fixture is a clean bot card', () => {
  const agent = JSON.parse(readFileSync(new URL('../fixtures/heartbeat.example.json', import.meta.url), 'utf8'));
  const bot = normalizeBot(agent);
  assert.equal(bot.id, 'example-bot');
  assert.equal(bot.name, 'Example Bot');
  assert.equal(bot.heartbeat.line, 'Last routine failed.');
  assert.equal(bot.heartbeat.state, 'failed');
  assert.equal(isStale(bot.lastActivity, Date.parse('2026-10-25T12:30:00.000Z')), false);
  assert.equal(scanText(JSON.stringify(agent)).length, 0);
});
