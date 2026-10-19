import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertClinical } from '../lib/privacy.js';
import { validateSectionPost } from '../lib/sections.js';
import { loadLiveStatus, storedSections, withFreshness } from '../lib/status.js';

const NOW = new Date('2026-10-18T23:00:00Z'); // Oct 18, 7:00 PM ET

function seed() {
  return {
    updated: '2026-10-15T19:40:00-04:00',
    updatedLabel: 'Oct 15, 2026 · 7:40 PM ET',
    needsYou: [], requests: [], routines: [], queue: [], trips: [],
    bots: [{ id: 'nomad', name: 'Nomad', status: 'idle', lastActivity: '2026-10-15T18:45:00-04:00' }],
    activity: [{ id: 'old', at: '2026-10-15T19:40:00-04:00', bot: 'Nomad', title: 'Example note' }]
  };
}

function storedMoney(receivedAt) {
  const card = validateSectionPost({
    section: 'money',
    schema: 'mission-control-money-card/v1',
    owner: 'Ledger',
    updated: '2026-10-16',
    goal: { target_date: '2036-01-01' },
    net_worth_trend: [{ date: '2026-10-16', pct: 12 }],
    progress_pct: 12
  });
  return { ...card, receivedAt };
}

test('header time is unchanged when no section or agent has a newer stored receivedAt', async () => {
  const status = await loadLiveStatus({ seed: seed(), skipRemote: true, now: NOW });
  assert.equal(status.updated, '2026-10-15T19:40:00-04:00');
  assert.equal(status.updatedLabel, 'Oct 15, 2026 · 7:40 PM ET');
});

test('a newer section post moves the header time', async () => {
  const sections = { health: { section: 'health', habits: [{ id: 'walk', name: 'Walk', streak: 2 }], receivedAt: '2026-10-18T22:34:03.773Z' } };
  const status = await loadLiveStatus({ seed: seed(), skipRemote: true, now: NOW, sections });
  assert.equal(status.updated, '2026-10-18T22:34:03.773Z');
  assert.match(status.updatedLabel, /^Oct 18, 2026 · 6:34 PM ET$/);
});

test('a newer agent post moves the header time even without lastActivity', async () => {
  const agents = [{ id: 'timmy', name: 'Timmy', status: 'working', task: 'Example task', receivedAt: '2026-10-17T16:00:00Z' }];
  const status = await loadLiveStatus({ seed: seed(), skipRemote: true, now: NOW, agents });
  assert.equal(status.updated, '2026-10-17T16:00:00Z');
});

test('the newest of all inputs wins, and future or invalid receivedAt values are ignored', () => {
  const board = { updated: '2026-10-15T23:40:00Z', updatedLabel: 'x' };
  const out = withFreshness(
    board,
    [{ receivedAt: '2026-10-16T12:00:00Z' }, { receivedAt: 'not a date' }, { receivedAt: '2026-10-20T00:00:00Z' }],
    { money: { receivedAt: '2026-10-17T12:00:00Z' }, home: {} },
    NOW
  );
  assert.equal(out.updated, '2026-10-17T12:00:00Z');
  assert.equal(withFreshness(board, [], {}, NOW), board);
});

test('stored money keeps its posted receivedAt on read instead of being re-stamped', () => {
  const sections = storedSections([storedMoney('2026-10-16T17:00:00.000Z')], assertClinical);
  assert.equal(sections.money.receivedAt, '2026-10-16T17:00:00.000Z');
  assert.equal(sections.money.progress_pct, 12);
});

test('stored money without a receivedAt gets none (never "now")', () => {
  const { receivedAt, ...card } = storedMoney(undefined);
  const sections = storedSections([card], assertClinical);
  assert.equal(sections.money.receivedAt, undefined);
});

test('other stored sections keep their receivedAt untouched', () => {
  const health = { section: 'health', habits: [{ id: 'walk', name: 'Walk', streak: 2 }], receivedAt: '2026-10-18T22:34:03.773Z' };
  const sections = storedSections([health], assertClinical);
  assert.equal(sections.health.receivedAt, '2026-10-18T22:34:03.773Z');
});
