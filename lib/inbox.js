import { randomBytes, timingSafeEqual } from 'node:crypto';
import { scanText } from './privacy.js';

/*
 * Inbox: answers Naresh gives on Needs-you cards, waiting for a bot to pick them up.
 * One JSON document in private Blob: { schema, updated, items: [...] }.
 */

export const INBOX_SCHEMA = 'mission-control-inbox/1';
export const INBOX_STATUSES = ['new', 'picked_up', 'done'];
export const LIMITS = { text: 2000, choice: 80, bot: 40, note: 280, items: 500 };
const REF = /^[A-Za-z0-9_:.-]{1,80}$/;

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export function inboxBlobKey(env = {}) {
  if (env.INBOX_BLOB_KEY && /^[a-z0-9/_-]+\.json$/i.test(env.INBOX_BLOB_KEY)) return env.INBOX_BLOB_KEY;
  return env.VERCEL_ENV === 'production' ? 'inbox/inbox.json' : 'inbox/preview/inbox.json';
}

export function emptyInbox(now = new Date()) {
  return { schema: INBOX_SCHEMA, updated: now.toISOString(), items: [] };
}

export function normalizeInbox(doc) {
  if (!isObject(doc) || doc.schema !== INBOX_SCHEMA || !Array.isArray(doc.items)) return emptyInbox();
  return doc;
}

/** Bearer token check for bots (MC_INBOX_TOKEN). Constant-time compare. */
export function bearerOk(authorization, env = {}) {
  const expected = env.MC_INBOX_TOKEN || '';
  const match = /^Bearer\s+(\S+)$/i.exec(String(authorization || '').trim());
  if (!expected || !match) return false;
  const left = Buffer.from(match[1]);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function str(value, max, field, { required = false } = {}) {
  if (value == null || value === '') {
    if (required) fail('invalid_item', `${field} is required`);
    return '';
  }
  if (typeof value !== 'string') fail('invalid_item', `${field} must be a string`);
  const clean = value.replace(/\r\n?/g, '\n').trim();
  if (required && !clean) fail('invalid_item', `${field} is required`);
  if (clean.length > max) fail('invalid_item', `${field} is longer than ${max} characters`);
  return clean;
}

const PRIVACY_MESSAGE = {
  dollar_amount: 'Leave dollar amounts out of Mission Control. Say it in words, like "approve the quote", and share figures directly with the bot.',
  health_term: 'Health, lab, and medication details stay off Mission Control. Tell the bot directly instead.',
  secret: 'That looks like a password, token, or account number. Keep it off Mission Control.'
};

/** Reject money figures, health/lab/medication text, and secrets with a clear message. */
export function assertPostable(text) {
  const rules = [...new Set(scanText(text).map((hit) => hit.rule))].filter((rule) => PRIVACY_MESSAGE[rule]);
  if (!rules.length) return;
  const error = new Error(rules.map((rule) => PRIVACY_MESSAGE[rule]).join(' '));
  error.code = 'privacy';
  error.rules = rules;
  throw error;
}

export function newInboxId() {
  return `in_${Date.now().toString(36)}${randomBytes(4).toString('hex')}`;
}

/** Validate a submission from the page. */
export function createItem(input, { now = new Date(), id } = {}) {
  if (!isObject(input)) fail('invalid_item', 'Body must be a JSON object');
  const card = str(input.card, 80, 'card', { required: true });
  if (!REF.test(card)) fail('invalid_item', 'card is not a valid id');
  const bot = str(input.bot, LIMITS.bot, 'bot', { required: true });
  const text = str(input.text, LIMITS.text, 'text');
  const choice = str(input.choice, LIMITS.choice, 'choice') || null;
  if (!text && !choice) fail('invalid_item', 'Pick an option or write a reply');
  assertPostable([bot, text, choice || ''].join('\n'));
  const at = now.toISOString();
  return { id: id || newInboxId(), card, bot, text, choice, created_at: at, status: 'new', result_note: '', updated_at: at };
}

/** Validate a bot update: { status: 'picked_up' | 'done', result_note <= 280 chars }. */
export function updateItem(current, patch, { now = new Date() } = {}) {
  if (!isObject(patch)) fail('invalid_item', 'Body must be a JSON object');
  const unknown = Object.keys(patch).filter((key) => key !== 'status' && key !== 'result_note');
  if (unknown.length) fail('invalid_item', `cannot change ${unknown.join(', ')}`);
  if (!['picked_up', 'done'].includes(patch.status)) fail('invalid_item', "status must be 'picked_up' or 'done'");
  const next = { ...current, status: patch.status, updated_at: now.toISOString() };
  if (patch.result_note !== undefined) {
    next.result_note = str(patch.result_note, LIMITS.note, 'result_note');
    assertPostable(next.result_note);
  }
  return next;
}

export function filterItems(items, status) {
  if (status == null || status === '' || status === 'all') return items;
  if (!INBOX_STATUSES.includes(status)) fail('invalid_status', `status must be one of ${INBOX_STATUSES.join(', ')}`);
  return items.filter((item) => item.status === status);
}
