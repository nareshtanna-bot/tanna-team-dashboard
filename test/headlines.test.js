import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSectionPost, withLiveSections } from '../lib/sections.js';
import { storedSections } from '../lib/status.js';
import { assertClinical } from '../lib/privacy.js';
import { headlineHits, headlinesMarkup, isPriceLike, sanitizeHeadlines } from '../lib/headlines.js';

const good = { title: 'Fed holds rates steady and signals patience', source: 'Reuters', url: 'https://www.reuters.com/markets/fed-holds', fetched_at: '2026-10-21T06:30:00-04:00' };

test('a headlines post keeps title, source, url and fetched_at', () => {
  const stored = validateSectionPost({ section: 'headlines', items: [good] });
  assert.equal(stored.section, 'headlines');
  assert.deepEqual(stored.items, [good]);
  assert.equal(stored.example, false);
});

test('prices, positions and dollar figures are stripped item by item', () => {
  const stored = validateSectionPost({
    section: 'headlines',
    fetched_at: '2026-10-21T06:30:00-04:00',
    items: [
      good,
      { title: 'Apple closes at $187.42', source: 'CNBC', url: 'https://cnbc.com/a' },
      { title: 'Bitcoin tops 70,000', source: 'Bloomberg', url: 'https://bloomberg.com/b' },
      { title: 'S&P 500 ends at 5812.35', source: 'AP', url: 'https://apnews.com/c' },
      { title: 'Your NVDA position is up', source: 'Broker', url: 'https://example.com/d' },
      { title: 'Deal valued at 2.5bn', source: 'FT', url: 'https://ft.com/e' }
    ]
  });
  assert.deepEqual(stored.items.map((item) => item.title), [good.title]);
  assert.equal(stored.dropped, 5);
});

test('a post with only figures, no https url, or no title is rejected', () => {
  assert.throws(() => validateSectionPost({ section: 'headlines', items: [{ title: 'Oil at $80', url: 'https://x.com' }] }), /at least one headline/);
  assert.throws(() => validateSectionPost({ section: 'headlines', items: [{ title: 'Plain', url: 'http://x.com' }] }), /at least one headline/);
  assert.throws(() => validateSectionPost({ section: 'headlines', items: [{ url: 'https://x.com' }] }), /at least one headline/);
  assert.throws(() => validateSectionPost({ section: 'headlines' }), /at least one headline/);
});

test('fetched_at falls back to the post-level value', () => {
  const { items } = sanitizeHeadlines({ fetched_at: '2026-10-21T06:30:00-04:00', items: [{ ...good, fetched_at: undefined }] });
  assert.equal(items[0].fetched_at, '2026-10-21T06:30:00-04:00');
});

test('plain percentages and index names are allowed', () => {
  assert.equal(isPriceLike('Stocks slip 1% as yields climb'), false);
  assert.equal(isPriceLike('S&P 500 futures edge higher'), false);
  assert.equal(isPriceLike('Gold near $2,400'), true);
});

test('a stored headlines file is re-checked on read', () => {
  const sections = storedSections([{ section: 'headlines', items: [good, { title: 'Tesla at $250', url: 'https://x.com' }] }], assertClinical);
  assert.deepEqual(sections.headlines.items.map((item) => item.title), [good.title]);
  assert.equal(storedSections([{ section: 'headlines', items: [{ title: '$5', url: 'https://x.com' }] }], assertClinical).headlines, undefined);
});

test('live headlines reach the board', () => {
  const board = withLiveSections({ activity: [] }, { headlines: { section: 'headlines', items: [good] } });
  assert.equal(board.headlines.items.length, 1);
});

test('the card renders a compact linked list and hides when empty', () => {
  const html = headlinesMarkup({ items: [good, { title: '<b>x</b>', source: 'S', url: 'https://s.com/"q' }] });
  assert.match(html, /<a href="https:\/\/www\.reuters\.com\/markets\/fed-holds" target="_blank" rel="noopener noreferrer">Fed holds/);
  assert.ok(!html.includes('<b>x</b>'));
  assert.equal(headlinesMarkup(undefined), '');
  assert.equal(headlinesMarkup({ items: [] }), '');
  assert.equal(headlinesMarkup({ items: [{ title: 'Oil at $80', url: 'https://x.com' }] }), '');
});

test('the privacy check flags a committed headline with a figure', () => {
  assert.equal(headlineHits({ headlines: { items: [good] } }).length, 0);
  assert.equal(headlineHits({ headlines: { items: [{ title: 'Shares at 187.42' }] } })[0].rule, 'headline_figure');
});
