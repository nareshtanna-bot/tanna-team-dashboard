import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTasksHandler, memoryStore } from '../api/tasks.js';
import {
  applyPost, createTask, emptyDoc, filterView, parseWhen, sortTasks, tasksBlobKey, todaySections, updateTask, viewOf
} from '../lib/tasks.js';
import { batches, decodeThingsDate, mapExport } from '../scripts/import-things.mjs';

// 2026-10-18 15:00 ET
const NOW = new Date('2026-10-18T19:00:00Z');
const TODAY = '2026-10-18';
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

function setup(initial = null) {
  const store = memoryStore(initial);
  const handler = createTasksHandler({ store, env: { BOT_STATUS_SECRET: SECRET }, now: () => NOW });
  async function call(method, { body, headers = {}, query = {} } = {}) {
    const res = mockRes();
    await handler({ method, headers, body, query }, res);
    return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
  }
  const bot = { 'x-bot-secret': SECRET };
  const page = { 'sec-fetch-site': 'same-origin' };
  return { store, call, bot, page };
}

test('when maps to Inbox, Today, This Evening, a date, and Someday', () => {
  assert.deepEqual(parseWhen(null, TODAY), { start: 'inbox', startDate: null, evening: false });
  assert.deepEqual(parseWhen('today', TODAY), { start: 'anytime', startDate: TODAY, evening: false });
  assert.deepEqual(parseWhen('evening', TODAY), { start: 'anytime', startDate: TODAY, evening: true });
  assert.deepEqual(parseWhen('2026-10-25', TODAY), { start: 'anytime', startDate: '2026-10-25', evening: false });
  assert.equal(parseWhen('someday', TODAY).start, 'someday');
  assert.throws(() => parseWhen('next week', TODAY), /when must be/);
  assert.throws(() => parseWhen('2026-02-30', TODAY), /when must be/);
});

test('task validation rejects bad input with a clear code', () => {
  const bad = [
    [{}, /title is required/],
    [{ title: '   ' }, /title is required/],
    [{ title: 42 }, /title must be a string/],
    [{ title: 'x'.repeat(301) }, /title is longer/],
    [{ title: 'ok', deadline: '10/30/2026' }, /deadline must be a date/],
    [{ title: 'ok', status: 'done' }, /status must be one of/],
    [{ title: 'ok', tags: 'a,b', category: 'secrets' }, /category must be one of/],
    [{ title: 'ok', private: 'yes' }, /private must be true or false/],
    [{ title: 'ok', tags: [1] }, /tags must be a list of strings/],
    [{ title: 'ok', checklist: 'buy' }, /checklist must be a list/]
  ];
  for (const [input, message] of bad) {
    assert.throws(() => createTask(input, { now: NOW }), (error) => error.code === 'invalid_task' && message.test(error.message));
  }
  assert.throws(() => createTask({ title: 'Wifi password: hunter2hunter2' }, { now: NOW }), (error) => error.code === 'privacy');
});

test('a new task gets the model fields and health or money makes it private', () => {
  const task = createTask({ title: 'Example task', notes: 'n', when: 'evening', deadline: '2026-10-20', tags: 'home, #errand, Home', checklist: ['one'] }, { now: NOW, source: 'bot' });
  assert.equal(task.start, 'anytime');
  assert.equal(task.startDate, TODAY);
  assert.equal(task.evening, true);
  assert.deepEqual(task.tags, ['home', 'errand']);
  assert.equal(task.checklist[0].title, 'one');
  assert.equal(task.status, 'open');
  assert.equal(task.source, 'bot');
  assert.equal(task.private, false);
  assert.equal(task.completedAt, null);
  assert.equal(task.createdAt, NOW.toISOString());
  assert.equal(createTask({ title: 'Example checkup', category: 'health' }, { now: NOW }).private, true);
  assert.equal(createTask({ title: 'Example budget', category: 'money', private: false }, { now: NOW }).private, true);
  assert.equal(createTask({ title: 'Example gift', private: true }, { now: NOW }).private, true);
});

test('views follow Things: Inbox, Today with an Evening section, Upcoming, Someday, Logbook', () => {
  const t = (title, input) => createTask({ title, ...input }, { now: NOW });
  const tasks = [
    t('inbox', {}), t('today', { when: 'today' }), t('evening', { when: 'evening' }),
    t('overdue start', { when: '2026-10-10' }), t('later', { when: '2026-10-30' }),
    t('someday', { when: 'someday' }), t('anytime', { when: 'anytime' }), t('done', { when: 'today', status: 'completed' })
  ];
  const titles = (view) => filterView(tasks, view, { today: TODAY }).map((task) => task.title).sort();
  assert.deepEqual(titles('inbox'), ['inbox']);
  assert.deepEqual(titles('today'), ['evening', 'overdue start', 'today']);
  assert.deepEqual(titles('upcoming'), ['later']);
  assert.deepEqual(titles('someday'), ['someday']);
  assert.deepEqual(titles('logbook'), ['done']);
  assert.ok(titles('anytime').includes('anytime') && titles('anytime').includes('today'));
  const sections = todaySections(tasks, 'asc', TODAY);
  assert.deepEqual(sections.evening.map((task) => task.title), ['evening']);
  assert.deepEqual(sections.day.map((task) => task.title), ['overdue start', 'today']);
  assert.equal(viewOf(tasks[7], TODAY), 'logbook');
  const shared = filterView([t('private', { category: 'money' }), t('open', {})], 'inbox', { today: TODAY, shared: true });
  assert.deepEqual(shared.map((task) => task.title), ['open']);
});

test('sort by date runs ascending and descending', () => {
  const at = (iso) => new Date(iso);
  const a = createTask({ title: 'a', deadline: '2026-11-01' }, { now: at('2026-10-01T12:00:00Z') });
  const b = createTask({ title: 'b' }, { now: at('2026-10-05T12:00:00Z') });
  const c = createTask({ title: 'c', when: '2026-10-03' }, { now: at('2026-10-09T12:00:00Z') });
  const d = createTask({ title: 'd' }, { now: at('2026-10-02T12:00:00Z') });
  // Sort date: start date, else deadline, else created.
  assert.deepEqual(sortTasks([a, b, c, d], 'asc').map((x) => x.title), ['d', 'c', 'b', 'a']);
  assert.deepEqual(sortTasks([a, b, c, d], 'desc').map((x) => x.title), ['a', 'b', 'c', 'd']);
  assert.throws(() => sortTasks([a], 'up'), (error) => error.code === 'invalid_sort');
  const done1 = updateTask(b, { complete: true }, { now: at('2026-10-10T12:00:00Z') });
  const done2 = updateTask(d, { complete: true }, { now: at('2026-10-12T12:00:00Z') });
  assert.deepEqual(sortTasks([done2, done1], 'asc', 'logbook').map((x) => x.title), ['b', 'd']);
});

test('POST creates, GET lists by view and sort, PATCH completes into the Logbook', async () => {
  const { call, bot, page, store } = setup();
  const empty = await call('GET');
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.body.tasks, []);

  const one = await call('POST', { headers: page, body: { title: 'Example from the page', when: 'today', source: 'bot' } });
  assert.equal(one.status, 201);
  assert.equal(one.body.task.source, 'manual');
  const two = await call('POST', { headers: bot, body: { title: 'Example from Sylvia', when: 'evening', createdBy: 'Sylvia' } });
  assert.equal(two.status, 201);
  assert.equal(two.body.task.source, 'bot');
  assert.equal(two.body.task.createdBy, 'Sylvia');
  await call('POST', { headers: bot, body: { title: 'Example inbox item' } });

  const today = await call('GET', { query: { view: 'today', sort: 'asc' } });
  assert.equal(today.body.tasks.length, 2);
  assert.equal(today.body.sections.evening[0].title, 'Example from Sylvia');
  assert.equal(today.body.meta.counts.inbox, 1);
  const bad = await call('GET', { query: { view: 'today', sort: 'sideways' } });
  assert.equal(bad.status, 400);
  assert.equal((await call('GET', { query: { view: 'nope' } })).status, 400);

  const done = await call('PATCH', { headers: page, query: { id: one.body.task.id }, body: { complete: true } });
  assert.equal(done.status, 200);
  assert.equal(done.body.task.status, 'completed');
  assert.equal(done.body.task.completedAt, NOW.toISOString());
  const logbook = await call('GET', { query: { view: 'logbook' } });
  assert.deepEqual(logbook.body.tasks.map((task) => task.title), ['Example from the page']);
  const reopened = await call('PATCH', { headers: bot, body: { id: one.body.task.id, complete: false } });
  assert.equal(reopened.body.task.status, 'open');
  assert.equal(reopened.body.task.completedAt, null);

  assert.equal((await call('PATCH', { headers: bot, body: { complete: true } })).status, 400);
  assert.equal((await call('PATCH', { headers: bot, query: { id: 'missing' }, body: { complete: true } })).status, 404);
  assert.equal((await call('PATCH', { headers: bot, query: { id: one.body.task.id }, body: { source: 'x' } })).status, 400);
  assert.equal((await call('POST', { headers: bot, body: { notes: 'no title' } })).status, 400);
  assert.equal(store.peek().tasks.length, 3);
});

test('writes need the bot secret or the page itself', async () => {
  const { call } = setup();
  assert.equal((await call('POST', { body: { title: 'x' } })).status, 401);
  assert.equal((await call('POST', { headers: { 'sec-fetch-site': 'cross-site' }, body: { title: 'x' } })).status, 401);
  assert.equal((await call('POST', { headers: { 'x-bot-secret': 'nope', 'sec-fetch-site': 'same-origin' }, body: { title: 'x' } })).status, 401);
  assert.equal((await call('PATCH', { headers: { 'x-bot-secret': 'nope' }, body: { id: 'a', complete: true } })).status, 401);
  assert.equal((await call('DELETE')).status, 405);
  const unconfigured = createTasksHandler({ store: memoryStore(), env: {}, now: () => NOW });
  const res = mockRes();
  await unconfigured({ method: 'POST', headers: { 'x-bot-secret': 'any' }, body: { title: 'x' } }, res);
  assert.equal(res.statusCode, 503);
  assert.equal(JSON.parse(res.body).error, 'secret_unconfigured');
});

test('shared GET leaves out private tasks; the default view keeps them', async () => {
  const { call, bot } = setup();
  await call('POST', { headers: bot, body: { title: 'Example checkup', category: 'health' } });
  await call('POST', { headers: bot, body: { title: 'Example errand' } });
  assert.equal((await call('GET')).body.tasks.length, 2);
  const shared = await call('GET', { query: { shared: '1' } });
  assert.deepEqual(shared.body.tasks.map((task) => task.title), ['Example errand']);
  assert.equal(shared.body.meta.counts.inbox, 1);
});

test('batch posts dedup by external id, so a re-run changes nothing', async () => {
  const { call, bot, store } = setup();
  const example = JSON.parse(readFileSync(new URL('../fixtures/things-export.example.json', import.meta.url), 'utf8'));
  const body = mapExport(example);
  assert.equal(body.tasks.length, 9, 'trashed rows are skipped');
  for (const chunk of batches(body, 4)) {
    const res = await call('POST', { headers: bot, body: chunk });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.rejected, []);
  }
  const first = store.peek();
  for (const chunk of batches(body, 4)) {
    const res = await call('POST', { headers: bot, body: chunk });
    assert.equal(res.body.created, 0);
  }
  const second = store.peek();
  assert.equal(second.tasks.length, first.tasks.length);
  assert.equal(second.areas.length, 2);
  assert.equal(second.projects[0].headings.length, 2);
  assert.ok(second.tasks.every((task) => task.source === 'things-import'));
  const byTitle = Object.fromEntries(second.tasks.map((task) => [task.title, task]));
  assert.equal(byTitle['Example task for today'].startDate, '2026-10-18');
  assert.equal(byTitle['Example evening task'].evening, true);
  assert.equal(byTitle['Example upcoming task'].start, 'anytime');
  assert.equal(byTitle['Example upcoming task'].deadline, '2026-11-05');
  assert.equal(byTitle['Example inbox item'].start, 'inbox');
  assert.equal(byTitle['Example someday idea'].start, 'someday');
  assert.equal(byTitle['Example finished task'].status, 'completed');
  assert.equal(byTitle['Example canceled task'].status, 'canceled');
  assert.equal(byTitle['Example wellness reminder'].private, true);
  assert.equal(byTitle['Example wellness reminder'].category, 'health');
  const inProject = byTitle['Example anytime task in a project'];
  assert.equal(inProject.projectId, 'things_EXPROJ0000000000000001');
  assert.equal(inProject.headingId, 'things_EXHEAD0000000000000001');
  assert.equal(inProject.areaId, 'things_EXAREA0000000000000001');
  assert.deepEqual(inProject.checklist.map((item) => item.done), [true, false]);
  const rejected = applyPost(emptyDoc(), { tasks: [{ title: '' }, { title: 'Example ok' }] }, { now: NOW, source: 'bot' });
  assert.equal(rejected.created, 1);
  assert.equal(rejected.rejected[0].index, 0);
});

test('Things packed dates decode, and preview never shares the production key', () => {
  assert.equal(decodeThingsDate((2026 << 16) | (10 << 12) | (18 << 7)), '2026-10-18');
  assert.equal(decodeThingsDate('2026-11-02'), '2026-11-02');
  assert.equal(decodeThingsDate(null), null);
  assert.equal(tasksBlobKey({ VERCEL_ENV: 'production' }), 'tasks/tasks.json');
  assert.equal(tasksBlobKey({ VERCEL_ENV: 'preview' }), 'tasks/preview/tasks.json');
  assert.equal(tasksBlobKey({}), 'tasks/preview/tasks.json');
  assert.equal(tasksBlobKey({ VERCEL_ENV: 'preview', TASKS_BLOB_KEY: 'tasks/other.json' }), 'tasks/other.json');
});

test('a write that loses a race retries on the fresh document', async () => {
  const store = memoryStore(emptyDoc(NOW));
  let raced = false;
  const racing = {
    ...store,
    async read() {
      const snapshot = await store.read();
      if (!raced) {
        raced = true;
        await store.write(applyPost(snapshot.doc, { title: 'Example from elsewhere' }, { now: NOW }).doc, snapshot.etag);
      }
      return snapshot;
    }
  };
  const handler = createTasksHandler({ store: racing, env: { BOT_STATUS_SECRET: SECRET }, now: () => NOW });
  const res = mockRes();
  await handler({ method: 'POST', headers: { 'x-bot-secret': SECRET }, body: { title: 'Example mine' } }, res);
  assert.equal(res.statusCode, 201);
  assert.deepEqual(store.peek().tasks.map((task) => task.title).sort(), ['Example from elsewhere', 'Example mine']);
});
