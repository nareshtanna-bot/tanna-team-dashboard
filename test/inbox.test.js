import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryStore } from '../lib/blob-store.js';
import { createInboxHandler } from '../lib/inbox-handler.js';
import { bearerOk, inboxBlobKey } from '../lib/inbox.js';

const NOW = new Date('2026-10-20T23:00:00Z');
const TOKEN = 'test-inbox-token-not-real';

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

function setup(env = { MC_INBOX_TOKEN: TOKEN }) {
  const store = memoryStore();
  const handler = createInboxHandler({ store, env, now: () => NOW });
  async function call(method, { body, headers = {}, query = {} } = {}) {
    const res = mockRes();
    await handler({ method, headers, body, query }, res);
    return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
  }
  return { store, call, bot: { authorization: `Bearer ${TOKEN}` }, page: { 'sec-fetch-site': 'same-origin' } };
}

const answer = { card: 'peopleconnect-dob', bot: 'Porter', text: 'Skip that one', choice: 'decline' };

test('no auth is 401 for every method', async () => {
  const { call } = setup();
  for (const method of ['GET', 'POST', 'PATCH']) {
    const res = await call(method, { body: answer, query: { id: 'x' } });
    assert.equal(res.status, 401, method);
    assert.equal(res.body.error, 'unauthorized');
  }
});

test('wrong or malformed bearer token is 401, even from the page', async () => {
  const { call, page } = setup();
  assert.equal((await call('GET', { headers: { authorization: 'Bearer nope' } })).status, 401);
  assert.equal((await call('GET', { headers: { authorization: TOKEN } })).status, 401);
  assert.equal((await call('POST', { body: answer, headers: { ...page, authorization: 'Bearer nope' } })).status, 401);
});

test('no token configured means bots are 401', async () => {
  const { call } = setup({});
  assert.equal((await call('GET', { headers: { authorization: 'Bearer anything' } })).status, 401);
  assert.equal(bearerOk('Bearer ', {}), false);
});

test('the page cannot PATCH', async () => {
  const { call, page } = setup();
  assert.equal((await call('PATCH', { headers: page, query: { id: 'x' }, body: { status: 'done' } })).status, 401);
});

test('validation rejects bad submissions with clear messages', async () => {
  const { call, page } = setup();
  const cases = [
    [{ bot: 'Porter', text: 'hi' }, 400, /card is required/],
    [{ card: 'bad id!', bot: 'Porter', text: 'hi' }, 400, /card is not a valid id/],
    [{ card: 'a', text: 'hi' }, 400, /bot is required/],
    [{ card: 'a', bot: 'Porter' }, 400, /Pick an option or write a reply/],
    [{ card: 'a', bot: 'Porter', text: 'x'.repeat(2001) }, 400, /longer than/],
    [{ card: 'a', bot: 'Porter', text: 'Approve up to $1,200' }, 422, /dollar amounts/],
    [{ card: 'a', bot: 'Porter', text: 'Fine, 500 dollars' }, 422, /dollar amounts/],
    [{ card: 'a', bot: 'Porter', text: 'Refill the medication first' }, 422, /Health, lab, and medication/],
    [{ card: 'a', bot: 'Porter', text: 'My A1C came back at 6' }, 422, /Health, lab, and medication/],
    [{ card: 'a', bot: 'Porter', text: 'Take 20 mg daily' }, 422, /Health, lab, and medication/]
  ];
  for (const [body, status, message] of cases) {
    const res = await call('POST', { headers: page, body });
    assert.equal(res.status, status, JSON.stringify(body));
    assert.match(res.body.message, message);
  }
  assert.equal((await call('POST', { headers: page, body: '{not json' })).status, 400);
});

test('round trip: page submits, bot lists new, picks up, finishes', async () => {
  const { call, bot, page } = setup();
  const posted = await call('POST', { headers: page, body: answer });
  assert.equal(posted.status, 201);
  const item = posted.body.item;
  assert.match(item.id, /^in_/);
  assert.deepEqual(Object.keys(item).sort(), ['bot', 'card', 'choice', 'created_at', 'id', 'result_note', 'status', 'text', 'updated_at']);
  assert.equal(item.status, 'new');

  const fresh = await call('GET', { headers: bot, query: { status: 'new' } });
  assert.equal(fresh.status, 200);
  assert.deepEqual(fresh.body.items.map((row) => row.id), [item.id]);

  const picked = await call('PATCH', { headers: bot, query: { id: item.id }, body: { status: 'picked_up', result_note: 'On it' } });
  assert.equal(picked.status, 200);
  assert.equal(picked.body.item.status, 'picked_up');
  assert.equal((await call('GET', { headers: bot, query: { status: 'new' } })).body.items.length, 0);

  const done = await call('PATCH', { headers: bot, query: { id: item.id }, body: { status: 'done', result_note: 'Skipped the PeopleConnect opt-out.' } });
  assert.equal(done.body.item.status, 'done');
  assert.equal(done.body.item.result_note, 'Skipped the PeopleConnect opt-out.');

  const mine = await call('GET', { headers: page });
  assert.equal(mine.body.items[0].status, 'done');
  assert.equal((await call('GET', { headers: bot, query: { status: 'bogus' } })).status, 400);
});

test('PATCH validation', async () => {
  const { call, bot, page } = setup();
  const { item } = (await call('POST', { headers: page, body: { card: 'c1', bot: 'Porter', choice: 'approve' } })).body;
  const q = { id: item.id };
  assert.equal((await call('PATCH', { headers: bot, query: q, body: { status: 'new' } })).status, 400);
  assert.equal((await call('PATCH', { headers: bot, query: q, body: { status: 'done', result_note: 'x'.repeat(281) } })).status, 400);
  assert.equal((await call('PATCH', { headers: bot, query: q, body: { status: 'done', text: 'changed' } })).status, 400);
  assert.equal((await call('PATCH', { headers: bot, query: { id: 'in_missing' }, body: { status: 'done' } })).status, 404);
  assert.equal((await call('PATCH', { headers: bot, query: q, body: { status: 'done', result_note: 'x'.repeat(280) } })).status, 200);
});

test('preview and production use separate Blob keys', () => {
  assert.equal(inboxBlobKey({ VERCEL_ENV: 'production' }), 'inbox/inbox.json');
  assert.equal(inboxBlobKey({ VERCEL_ENV: 'preview' }), 'inbox/preview/inbox.json');
});
