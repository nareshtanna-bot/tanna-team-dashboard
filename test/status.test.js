import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanText } from '../lib/privacy.js';
import { readFileSync } from 'node:fs';
import { isClosedStatus, isStale, mergeStatus, openNeedsYou, validateAgentPost } from '../lib/status.js';
import handler from '../api/status.js';

const NOW = new Date('2026-10-15T23:16:00Z');

function seed() {
  return {
    updated: '2026-10-01T12:00:00Z',
    updatedLabel: 'Oct 1, 2026 · 8:00 AM ET',
    source: 'seed',
    needsYou: [{ id: 'keep', title: 'Keep this' }],
    requests: [],
    routines: [],
    queue: [],
    trips: [{ id: 'london', name: 'London', mapsUrl: '' }],
    bots: [
      { id: 'nomad', name: 'Nomad', role: 'Travel', does: 'Plans trips', status: 'idle', task: 'Standing by', next: '', lastActivity: '2026-10-01T12:00:00Z' }
    ],
    activity: [{ id: 'old', at: '2026-10-01T12:00:00Z', bot: 'Nomad', title: 'Example note', example: true }]
  };
}

test('dollar amounts, health terms, secrets, addresses, and parcel ids fail', () => {
  assert.ok(scanText('about $2.3k left').some((hit) => hit.rule === 'dollar_amount'));
  assert.ok(scanText('creatine in the stack').some((hit) => hit.rule === 'health_term'));
  assert.ok(scanText('token: abcdefghijklmnop').some((hit) => hit.rule === 'secret'));
  assert.ok(scanText('10 Oak Street').some((hit) => hit.rule === 'street_address'));
  assert.ok(scanText('PIN 123456').some((hit) => hit.rule === 'parcel_or_plat'));
  assert.ok(scanText('plat BM2000-12').some((hit) => hit.rule === 'parcel_or_plat'));
  assert.equal(scanText('Drive about 75 miles to the resort.').length, 0);
  assert.equal(scanText('The rear lot line is 219.23 ft. The street address is omitted.').length, 0);
  assert.equal(scanText('https://example.com/article/1275449912004 is a public page').length, 0);
});

test('merge overlays one agent and flags stale bots', () => {
  const merged = mergeStatus(seed(), [{
    id: 'nomad',
    name: 'Nomad',
    role: 'Travel',
    does: 'Plans trips',
    status: 'working',
    task: 'Bermuda plan',
    lastActivity: '2026-10-15T22:00:00Z',
    needsYou: [{ id: 'flight', title: 'Pick a flight' }],
    activity: [{ id: 'new', at: '2026-10-15T22:00:00Z', title: 'Filed the plan', example: false }]
  }], NOW);
  assert.equal(merged.bots[0].status, 'working');
  assert.equal(merged.bots[0].stale, false);
  assert.equal(merged.needsYou.length, 2);
  assert.equal(merged.activity[0].id, 'new');
  assert.equal(merged.trips[0].name, 'London');
});

test('done and delivered items leave Needs you and show up as completions', () => {
  const merged = mergeStatus({
    ...seed(),
    needsYou: [
      { id: 'keep', title: 'Keep this', status: 'waiting' },
      { id: 'maps', title: 'Puerto Rico Google Maps list', status: 'done', bot: 'Nomad', detail: 'List filed.' },
      { id: 'glasses', title: 'Ray-Ban glasses order', status: 'delivered', bot: 'Inspector Gadget' },
      { id: 'plan', title: 'Pinehurst plan', status: 'waiting', bot: 'Nomad' }
    ],
    requests: [
      { id: 'plan', title: 'Pinehurst plan', status: 'done', owner: 'Nomad', request: 'The plan is filed.' },
      { id: 'rerank', title: "Rick's online-business re-rank", status: 'delivered', owner: 'Rick', date: '2026-10-15' }
    ]
  }, [], NOW);
  assert.deepEqual(merged.needsYou.map((item) => item.id), ['keep']);
  assert.equal(merged.requests.find((item) => item.id === 'rerank').status, 'done');
  const titles = merged.activity.map((item) => item.title);
  assert.ok(titles.includes('Puerto Rico Google Maps list'));
  assert.ok(titles.includes('Ray-Ban glasses order'));
  assert.ok(titles.includes('Pinehurst plan'));
  assert.ok(titles.includes("Rick's online-business re-rank"));
  assert.equal(isClosedStatus('delivered'), true);
  assert.deepEqual(openNeedsYou(merged.needsYou, merged.requests).map((item) => item.id), ['keep']);
});

test('a bot with no recent post is stale after 24 hours', () => {
  assert.equal(isStale('2026-10-14T22:00:00Z', NOW.getTime()), true);
  assert.equal(isStale('2026-10-15T20:00:00Z', NOW.getTime()), false);
  assert.equal(isStale(null, NOW.getTime()), true);
});

test('the seed decision strip is only the open items', () => {
  const status = JSON.parse(readFileSync(new URL('../status.json', import.meta.url), 'utf8'));
  const merged = mergeStatus(status, [], NOW);
  assert.deepEqual(merged.needsYou.map((item) => item.title), [
    'Date of birth for the PeopleConnect opt-out, or skip it',
    'Remaining data-broker opt-outs',
    'Pinehurst dates',
    'Top-10 trip window',
    'Business direction / Alpaca',
    'A Shaan version of the reading list',
    'Merge PR #1 (Mission Control)'
  ]);
  for (const item of merged.needsYou) assert.equal(isClosedStatus(item.status), false);
  const doneTitles = [
    'Puerto Rico Google Maps list',
    'Ray-Ban glasses order',
    'Do Not Call registry',
    'Mission Control GitHub access',
    'Grok plan question'
  ];
  for (const title of doneTitles) {
    assert.equal(merged.needsYou.some((item) => item.title === title), false);
    assert.equal(merged.requests.find((item) => item.title === title).status, 'done');
    assert.ok(merged.activity.some((item) => item.title === title));
  }
  assert.equal(merged.needsYou.some((item) => /re-rank/i.test(item.title)), false);
  assert.ok(merged.activity.some((item) => /re-rank/i.test(item.title)));
  assert.equal(merged.requests.find((item) => item.id === 'business-ideas').status, 'done');
});

test('posts with prices or health detail are rejected before storage', () => {
  assert.throws(() => validateAgentPost({ id: 'ledger', name: 'Ledger', status: 'idle', task: 'Spent $20' }), /privacy/);
  const clean = validateAgentPost({ id: 'timmy', name: 'Timmy', status: 'idle', task: 'Standing by' });
  assert.equal(clean.id, 'timmy');
  assert.ok(clean.receivedAt);
});

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

test('POST without a configured secret is refused', async () => {
  const previous = process.env.BOT_STATUS_SECRET;
  delete process.env.BOT_STATUS_SECRET;
  const res = mockRes();
  await handler({ method: 'POST', headers: {}, body: { id: 'timmy', name: 'Timmy' } }, res);
  assert.equal(res.statusCode, 503);
  assert.equal(JSON.parse(res.body).error, 'secret_unconfigured');
  if (previous) process.env.BOT_STATUS_SECRET = previous;
});

test('POST with the wrong secret is unauthorized', async () => {
  const previous = process.env.BOT_STATUS_SECRET;
  process.env.BOT_STATUS_SECRET = 'test-secret-value';
  const res = mockRes();
  await handler({ method: 'POST', headers: { 'x-bot-secret': 'nope' }, body: { id: 'timmy', name: 'Timmy', status: 'idle', task: 'Standing by' } }, res);
  assert.equal(res.statusCode, 401);
  if (previous) process.env.BOT_STATUS_SECRET = previous;
  else delete process.env.BOT_STATUS_SECRET;
});

test('POST of a clean agent explains the free-storage fallback when Blob is unset', async () => {
  const previous = process.env.BOT_STATUS_SECRET;
  const blob = process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.BLOB_STORE_ID;
  process.env.BOT_STATUS_SECRET = 'test-secret-value';
  const res = mockRes();
  await handler({
    method: 'POST',
    headers: { 'x-bot-secret': 'test-secret-value' },
    body: { id: 'timmy', name: 'Timmy', status: 'idle', task: 'Standing by' }
  }, res);
  assert.equal(res.statusCode, 503);
  assert.equal(JSON.parse(res.body).error, 'storage_unconfigured');
  if (previous) process.env.BOT_STATUS_SECRET = previous;
  else delete process.env.BOT_STATUS_SECRET;
  if (blob) process.env.BLOB_READ_WRITE_TOKEN = blob;
});
