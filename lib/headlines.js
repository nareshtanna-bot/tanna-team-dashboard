// Headlines card: market news titles with links only. No prices, positions, or dollar figures.

const PRICE_LIKE = [
  /\$/, /¢/, /€|£|¥/,
  /\bUSD\b/, /\bdollars?\b/i,
  /\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b/,          // 5,123 or 42,000.50
  /\b\d+\.\d{2,}\b/,                              // 187.42
  /\b\d+(?:\.\d+)?\s?(?:k|m|bn|b)\b/i,             // 2.5bn, 40k
  /\b(?:shares? (?:of|in)|my (?:position|portfolio|holdings?)|positions?|holdings?|cost basis|account balance|balance)\b/i
];

export const HEADLINE_LIMIT = 15;

export function isPriceLike(text) {
  const value = String(text ?? '');
  return PRICE_LIKE.some((re) => re.test(value));
}

function clean(value, max) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function httpsUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' ? url.toString() : '';
  } catch {
    return '';
  }
}

function stamp(value) {
  const text = String(value || '');
  return Number.isNaN(Date.parse(text)) ? '' : text;
}

// Returns a clean headline, or null when it is incomplete or carries a figure.
export function headline(item, fallbackFetchedAt = '') {
  const title = clean(item?.title, 160);
  const source = clean(item?.source, 60);
  const url = httpsUrl(item?.url);
  if (!title || !url) return null;
  if (isPriceLike(title) || isPriceLike(source)) return null;
  return { title, source, url, fetched_at: stamp(item?.fetched_at) || stamp(fallbackFetchedAt) };
}

export function sanitizeHeadlines(body) {
  const list = Array.isArray(body?.items) ? body.items : [];
  const fetchedAt = stamp(body?.fetched_at);
  const items = list.map((item) => headline(item, fetchedAt)).filter(Boolean).slice(0, HEADLINE_LIMIT);
  return { items, dropped: Math.min(list.length, 200) - items.length, fetched_at: fetchedAt || items[0]?.fetched_at || '' };
}

// Privacy-check hits for a committed headlines block (status.json or fixtures).
export function headlineHits(data) {
  const items = data?.headlines?.items;
  if (!Array.isArray(items)) return [];
  return items
    .map((item, index) => (isPriceLike(item?.title) || isPriceLike(item?.source)
      ? { rule: 'headline_figure', line: 1, path: `headlines.items[${index}]` }
      : null))
    .filter(Boolean);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

// Compact linked list for the card. Empty string means "hide the card".
export function headlinesMarkup(section) {
  const items = (Array.isArray(section?.items) ? section.items : [])
    .map((item) => headline(item))
    .filter(Boolean);
  if (!items.length) return '';
  return items.map((item) => `<li><a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.title)}</a>${item.source ? ` <span class="meta">${escapeHtml(item.source)}</span>` : ''}</li>`).join('');
}
