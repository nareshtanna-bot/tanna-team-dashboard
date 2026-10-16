import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { personalSeedHits, scanText } from '../lib/privacy.js';
import { moneySeries, validateSectionPost, withLiveSections } from '../lib/sections.js';
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

test('sauna is allowed and lab values, doses, and unlabeled calendars are not', () => {
  assert.equal(scanText('Sauna streak is 4').length, 0);
  assert.ok(scanText('LDL 140').some((hit) => hit.rule === 'health_term'));
  assert.ok(scanText('take 10 mg nightly').some((hit) => hit.rule === 'health_term'));
  assert.throws(() => validateSectionPost({
    section: 'health',
    habits: [{ id: 'bad', name: 'LDL check', streak: 1 }]
  }), (error) => error.code === 'privacy');
  assert.throws(() => validateSectionPost({
    section: 'health',
    appointments: [{ id: 'visit', title: 'Visit', start: '2026-11-02T09:00:00-05:00', diagnosis: 'omitted' }]
  }), (error) => error.code === 'privacy');
  const clean = validateSectionPost({
    section: 'health',
    habits: [{ id: 'sauna', name: 'Sauna', streak: 4, cadence: 'week' }]
  });
  assert.equal(clean.example, false);
  assert.equal(clean.habits[0].name, 'Sauna');
  const unlabeled = personalSeedHits({
    calendar: { example: true, events: [{ id: 'real', title: 'A private appointment', start: '2026-10-16T09:00:00-04:00' }] }
  });
  assert.ok(unlabeled.some((hit) => hit.rule === 'unlabeled_personal'));
  const committed = JSON.parse(readFileSync(new URL('../status.json', import.meta.url), 'utf8'));
  assert.equal(personalSeedHits(committed).length, 0);
});

test('done section items leave the open list and land on the timeline', () => {
  const base = seed();
  base.home = {
    example: true,
    issues: [
      { id: 'open-one', title: 'Example open issue', status: 'open', example: true },
      { id: 'done-one', title: 'Example finished permit', status: 'delivered', example: true }
    ]
  };
  const merged = withLiveSections(mergeStatus(base, [], NOW), {}, NOW);
  assert.deepEqual(merged.home.issues.map((item) => item.id), ['open-one']);
  assert.ok(merged.activity.some((item) => item.id === 'done:done-one'));
});

test('the example week flags conflicts and stalled routines', () => {
  const status = JSON.parse(readFileSync(new URL('../status.json', import.meta.url), 'utf8'));
  const merged = withLiveSections(mergeStatus(status, [], NOW), {}, NOW);
  const overlap = merged.calendar.events.filter((event) => event.id === 'ex-fam-16' || event.id === 'ex-work-16');
  assert.equal(overlap.length, 2);
  assert.equal(overlap.every((event) => event.conflict), true);
  assert.equal(merged.routines.find((item) => item.id === 'porter-renewals').healthFlag, 'stalled');
  assert.equal(merged.routines.find((item) => item.id === 'example-failed').healthFlag, 'failed');
  assert.equal(merged.routines.find((item) => item.id === 'sylvia-rollup').healthFlag, 'ok');
  assert.equal(merged.needsYou.some((item) => isClosedStatus(item.status)), false);
});

test('money posts keep figures on the API and out of git', () => {
  const posted = validateSectionPost({
    section: 'money',
    schema: 'mission-control-money-card/v1',
    owner: 'Ledger',
    updated: '2026-10-16T12:00:00-04:00',
    goal: { amount: 100, target_date: '2036-01-01' },
    net_worth_trend: [{ date: '2026-10-16', value: 100 }],
    progress_pct: 12,
    notes: 'High level only'
  });
  assert.equal(posted.example, false);
  assert.equal(posted.schema, 'mission-control-money-card/v1');
  assert.equal(posted.goal.amount, 100);
  assert.equal(moneySeries(posted).caption, 'More points coming');
  assert.equal(moneySeries({
    example: false,
    net_worth_trend: [
      { date: '2026-09-01', value: 80 },
      { date: '2026-10-01', value: 90 }
    ]
  }).caption, '');
  assert.throws(() => validateSectionPost({
    ...posted,
    receivedAt: undefined,
    holdings: [{ ticker: 'FUND' }]
  }), (error) => error.code === 'privacy' && error.hits.some((hit) => hit.rule === 'account_detail'));
  assert.throws(() => validateSectionPost({
    section: 'money',
    schema: 'mission-control-money-card/v1',
    owner: 'Ledger',
    updated: '2026-10-16T12:00:00-04:00',
    goal: { amount: 100, target_date: '2036-01-01' },
    net_worth_trend: [{ date: '2026-10-16', value: 100 }],
    progress_pct: 12,
    nickname: 'personal'
  }), (error) => error.code === 'privacy' && error.hits.some((hit) => hit.rule === 'unknown_key'));
  assert.throws(() => validateSectionPost({
    section: 'money',
    schema: 'mission-control-money-card/v1',
    owner: 'Ledger',
    updated: '2026-10-16T12:00:00-04:00',
    goal: { amount: 100, target_date: '2036-01-01' },
    net_worth_trend: [{ date: '2026-10-16', value: 100 }],
    progress_pct: 12,
    notes: `about ${String.fromCharCode(36)}100`
  }), (error) => error.code === 'privacy');
  const committed = JSON.parse(readFileSync(new URL('../status.json', import.meta.url), 'utf8'));
  assert.equal(personalSeedHits(committed).length, 0);
  assert.equal(committed.money.goal.amount, undefined);
  assert.equal(committed.money.net_worth_trend[0].value, undefined);
  const series = moneySeries(committed.money);
  assert.equal(committed.money.progress_pct, 12);
  assert.equal(committed.money.net_worth_trend.length, 1);
  assert.deepEqual(series.data, [12]);
  assert.equal(series.currency, false);
  assert.equal(series.caption, 'More points coming');
  assert.ok(personalSeedHits({
    money: {
      example: true,
      goal: { amount: 100, target_date: '2036-01-01', example: true },
      net_worth_trend: [{ date: '2026-10-16', value: 100, example: true }]
    }
  }).some((hit) => hit.rule === 'committed_money_figure'));
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

test('a health section post is stored only when Blob is configured', async () => {
  const previous = process.env.BOT_STATUS_SECRET;
  const blob = process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.BLOB_STORE_ID;
  process.env.BOT_STATUS_SECRET = 'test-secret-value';
  const res = mockRes();
  await handler({
    method: 'POST',
    headers: { 'x-bot-secret': 'test-secret-value' },
    body: { section: 'health', habits: [{ id: 'sauna', name: 'Sauna', streak: 4 }] }
  }, res);
  assert.equal(res.statusCode, 503);
  assert.equal(JSON.parse(res.body).error, 'storage_unconfigured');
  const rejected = mockRes();
  await handler({
    method: 'POST',
    headers: { 'x-bot-secret': 'test-secret-value' },
    body: { section: 'health', habits: [{ id: 'bad', name: 'LDL 140', streak: 1 }] }
  }, rejected);
  assert.equal(rejected.statusCode, 400);
  assert.equal(JSON.parse(rejected.body).error, 'privacy');
  if (previous) process.env.BOT_STATUS_SECRET = previous;
  else delete process.env.BOT_STATUS_SECRET;
  if (blob) process.env.BLOB_READ_WRITE_TOKEN = blob;
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
