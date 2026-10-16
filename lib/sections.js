import { assertClean, assertClinical } from './privacy.js';

function isClosedStatus(status) {
  return ['done', 'delivered'].includes(String(status || '').trim().toLowerCase());
}

export const SECTIONS = ['health', 'calendar', 'kids', 'home', 'business', 'money'];

export const MONEY_SCHEMA = 'mission-control-money-card/v1';

export const SCHOOLS = ['Cary Academy', 'Durham Academy', 'Ravenscroft', 'Duke School'];

const HOUR = 60 * 60 * 1000;

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function cleanText(value, max = 80) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function iso(value) {
  const text = String(value || '');
  const ms = Date.parse(text);
  if (Number.isNaN(ms)) return '';
  return text;
}

function day(value) {
  const text = String(value || '');
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

export function overlaps(a, b) {
  const startA = Date.parse(a?.start || '');
  const endA = Date.parse(a?.end || '');
  const startB = Date.parse(b?.start || '');
  const endB = Date.parse(b?.end || '');
  if ([startA, endA, startB, endB].some((ms) => Number.isNaN(ms))) return false;
  return startA < endB && startB < endA;
}

export function annotateConflicts(events) {
  const list = asArray(events).map((event) => ({ ...event, conflict: false, conflictWith: [] }));
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      if (!overlaps(list[i], list[j])) continue;
      list[i].conflict = true;
      list[j].conflict = true;
      if (list[j].id) list[i].conflictWith.push(list[j].id);
      if (list[i].id) list[j].conflictWith.push(list[i].id);
    }
  }
  return list;
}

export function routineIntervalMs(routine) {
  const hours = Number(routine?.intervalHours);
  if (Number.isFinite(hours) && hours > 0) return hours * HOUR;
  const schedule = String(routine?.schedule || '').toLowerCase();
  if (/friday|monday|week/.test(schedule)) return 7 * 24 * HOUR;
  return 24 * HOUR;
}

export function routineHealth(routine, now = Date.now()) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  if (String(routine?.lastResult || '').toLowerCase() === 'failed') return 'failed';
  const lastOk = routine?.lastSuccess || (String(routine?.lastResult || '').toLowerCase() === 'ok' ? routine.lastRun : '');
  const stamp = Date.parse(lastOk || '');
  if (!lastOk || Number.isNaN(stamp)) return 'stalled';
  if (nowMs - stamp > 2 * routineIntervalMs(routine)) return 'stalled';
  return 'ok';
}

export function annotateRoutines(routines, now = Date.now()) {
  return asArray(routines).map((routine) => ({ ...routine, healthFlag: routineHealth(routine, now) }));
}

function splitClosed(items) {
  const open = [];
  const closed = [];
  for (const item of asArray(items)) {
    if (isClosedStatus(item?.status) || isClosedStatus(item?.stage)) closed.push(item);
    else open.push(item);
  }
  return { open, closed };
}

function completionFrom(item, bot) {
  return {
    id: `done:${item.id}`,
    at: item.completedAt || item.at || (item.date ? `${item.date}T12:00:00-04:00` : ''),
    bot: item.owner || bot || '',
    title: item.title || item.name || item.school || item.id,
    detail: item.detail || item.request || 'Done.',
    example: item.example === true,
    output: item.output || '',
    status: 'done'
  };
}

function pushCompletion(activity, item, bot) {
  if (!item?.id) return;
  if (activity.some((row) => row.id === item.id || row.id === `done:${item.id}`)) return;
  activity.push(completionFrom(item, bot));
}

export function settlePersonal(section, source) {
  const body = source && typeof source === 'object' ? { ...source } : {};
  const closed = [];
  if (section === 'home') {
    const issues = splitClosed(body.issues);
    closed.push(...issues.closed);
    body.issues = issues.open;
  }
  if (section === 'business') {
    const pipeline = splitClosed(body.pipeline);
    closed.push(...pipeline.closed);
    body.pipeline = pipeline.open;
  }
  if (section === 'kids') {
    const applications = splitClosed(body.applications);
    closed.push(...applications.closed);
    body.applications = applications.open;
  }
  return { section: body, closed };
}

export function withLiveSections(board, files = {}, now = Date.now()) {
  const next = {
    ...board,
    activity: [...(board.activity || [])]
  };
  for (const name of SECTIONS) {
    if (!files[name]) continue;
    const settled = settlePersonal(name, { ...files[name], example: false, live: true });
    next[name] = settled.section;
    for (const item of settled.closed) pushCompletion(next.activity, item, name);
  }
  for (const name of SECTIONS) {
    if (files[name] || !next[name]) continue;
    const settled = settlePersonal(name, next[name]);
    next[name] = settled.section;
    for (const item of settled.closed) pushCompletion(next.activity, item, name);
  }
  next.activity.sort((a, b) => Date.parse(b.at || 0) - Date.parse(a.at || 0));
  next.routines = annotateRoutines(next.routines, now);
  if (next.calendar?.events) {
    next.calendar = { ...next.calendar, events: annotateConflicts(next.calendar.events) };
  }
  return next;
}

function habit(item) {
  const name = cleanText(item?.name, 40);
  const id = cleanText(item?.id, 32).toLowerCase();
  if (!id || !name) return null;
  const streak = Number(item?.streak);
  return {
    id,
    name,
    streak: Number.isFinite(streak) ? Math.max(0, Math.round(streak)) : 0,
    cadence: cleanText(item?.cadence, 24)
  };
}

function appointment(item) {
  const title = cleanText(item?.title, 80);
  const start = iso(item?.start);
  const end = iso(item?.end);
  const id = cleanText(item?.id, 40);
  if (!id || !title || !start) return null;
  return { id, title, start, end };
}

function weightPoint(item) {
  const date = day(item?.date);
  const lb = Number(item?.lb);
  if (!date || !Number.isFinite(lb) || lb < 50 || lb > 600) return null;
  return { date, lb: Math.round(lb * 10) / 10 };
}

function event(item) {
  const calendar = item?.calendar === 'work' ? 'work' : item?.calendar === 'family' ? 'family' : '';
  const title = cleanText(item?.title, 80);
  const start = iso(item?.start);
  const end = iso(item?.end);
  const id = cleanText(item?.id, 40);
  if (!id || !title || !start || !end || !calendar) return null;
  return { id, title, start, end, calendar };
}

function application(item) {
  const school = SCHOOLS.includes(item?.school) ? item.school : '';
  const id = cleanText(item?.id, 40);
  if (!school || !id) return null;
  const dates = asArray(item?.dates).map((entry) => ({
    label: cleanText(entry?.label, 60),
    date: day(entry?.date)
  })).filter((entry) => entry.label && entry.date).slice(0, 8);
  const stage = cleanText(item?.stage, 32);
  return { id, school, stage, dates, status: isClosedStatus(item?.status) ? 'done' : cleanText(item?.status, 24) };
}

function activityItem(item) {
  const id = cleanText(item?.id, 40);
  const name = cleanText(item?.name, 60);
  const when = cleanText(item?.when, 60);
  if (!id || !name) return null;
  return { id, name, when };
}

function issue(item) {
  const id = cleanText(item?.id, 40);
  const title = cleanText(item?.title, 80);
  if (!id || !title) return null;
  const status = isClosedStatus(item?.status) ? 'done' : (item?.status === 'waiting' ? 'waiting' : 'open');
  return { id, title, status, detail: cleanText(item?.detail, 160) };
}

function delivery(item) {
  const id = cleanText(item?.id, 40);
  const name = cleanText(item?.name, 60);
  const date = day(item?.date);
  const kind = item?.kind === 'return' ? 'return' : 'delivery';
  if (!id || !name || !date) return null;
  return { id, name, kind, date };
}

function renewal(item) {
  const id = cleanText(item?.id, 40);
  const name = cleanText(item?.name, 60);
  const date = day(item?.date);
  if (!id || !name || !date) return null;
  return { id, name, date };
}

function pipelineItem(item) {
  const id = cleanText(item?.id, 40);
  const name = cleanText(item?.name, 80);
  const stages = ['research', 'direction', 'building', 'parked'];
  const stage = stages.includes(item?.stage) ? item.stage : '';
  if (!id || !name || !stage) return null;
  const status = isClosedStatus(item?.status) ? 'done' : 'open';
  return { id, name, stage, status, detail: cleanText(item?.detail, 160) };
}

function sanitize(section, body) {
  if (section === 'health') {
    return {
      weight: asArray(body.weight).map(weightPoint).filter(Boolean).slice(0, 120),
      appointments: asArray(body.appointments).map(appointment).filter(Boolean).slice(0, 40),
      habits: asArray(body.habits).map(habit).filter(Boolean).slice(0, 20)
    };
  }
  if (section === 'calendar') {
    return { events: asArray(body.events).map(event).filter(Boolean).slice(0, 200) };
  }
  if (section === 'kids') {
    return {
      applications: asArray(body.applications).map(application).filter(Boolean).slice(0, 8),
      activities: asArray(body.activities).map(activityItem).filter(Boolean).slice(0, 20)
    };
  }
  if (section === 'home') {
    return {
      issues: asArray(body.issues).map(issue).filter(Boolean).slice(0, 40),
      deliveries: asArray(body.deliveries).map(delivery).filter(Boolean).slice(0, 40),
      renewals: asArray(body.renewals).map(renewal).filter(Boolean).slice(0, 40)
    };
  }
  return { pipeline: asArray(body.pipeline).map(pipelineItem).filter(Boolean).slice(0, 40) };
}

export function validateSectionPost(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('invalid_body', 'Body must be one object');
  const section = String(body.section || '');
  if (!SECTIONS.includes(section)) fail('invalid_section', 'section must be health, calendar, kids, home, business, or money');
  const text = JSON.stringify(body);
  if (text.length > 60000) fail('too_large', 'Payload is too large');
  if (section === 'money') return validateMoneyPost(body);
  assertClean(text, `sections/${section}.json`);
  if (section === 'health') assertClinical(body, `sections/${section}.json`);
  const clean = sanitize(section, body);
  const empty = Object.values(clean).every((value) => !value || (Array.isArray(value) && value.length === 0));
  if (empty) fail('invalid_body', 'Section post needs at least one valid item');
  return { section, ...clean, example: false, receivedAt: new Date().toISOString() };
}

const MONEY_ACCOUNT_KEYS = new Set([
  'account', 'accounts', 'account_number', 'account_name', 'accountname', 'accountnumber',
  'balance', 'balances', 'transaction', 'transactions', 'holding', 'holdings',
  'position', 'positions', 'ticker', 'tickers', 'symbol', 'symbols', 'shares',
  'cusip', 'routing', 'iban', 'brokerage', 'institution', 'bank'
]);

const ACCOUNT_TEXT = /\b(accounts?|account number|brokerage|checking|savings|holdings?|transactions?|tickers?|shares|positions?|routing|iban|cusip|401\(k\)|401k)\b/i;

const MONEY_TOP = new Set(['section', 'schema', 'owner', 'updated', 'goal', 'net_worth_trend', 'progress_pct', 'notes', 'example', 'receivedAt']);
const MONEY_GOAL = new Set(['amount', 'target_date', 'target_usd', 'by']);
const MONEY_POINT = new Set(['date', 'value', 'pct', 'as_of', 'net_worth_usd', 'source']);
export const MONEY_GOAL_DATE = '2036-01-01';

function privacyError(hits, label) {
  const error = new Error(`privacy: ${hits.map((hit) => `${label}:${hit.line} ${hit.rule}`).join('; ')}`);
  error.code = 'privacy';
  error.hits = hits;
  return error;
}

function walkMoneyKeys(value, allowed, path, hits) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  for (const key of Object.keys(value)) {
    const rule = MONEY_ACCOUNT_KEYS.has(key.toLowerCase()) ? 'account_detail' : (!allowed.has(key) ? 'unknown_key' : '');
    if (rule) hits.push({ rule, line: 1, path: `${path}.${key}` });
  }
}

function walkMoneyStrings(value, hits) {
  if (typeof value === 'string') {
    if (ACCOUNT_TEXT.test(value)) hits.push({ rule: 'account_detail', line: 1 });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => walkMoneyStrings(item, hits));
    return;
  }
  if (value && typeof value === 'object') {
    Object.values(value).forEach((item) => walkMoneyStrings(item, hits));
  }
}

export function moneySeries(money) {
  const trend = Array.isArray(money?.net_worth_trend) ? money.net_worth_trend : [];
  const valued = trend.filter((point) => Number.isFinite(Number(point?.pct)));
  if (valued.length) {
    return {
      labels: valued.map((point) => String(point.date || '')),
      data: valued.map((point) => Number(point.pct)),
      currency: false,
      caption: valued.length < 2 ? 'More points coming' : ''
    };
  }
  const pct = Number(money?.progress_pct);
  const date = trend[0]?.date || 'Now';
  if (Number.isFinite(pct)) {
    return { labels: [date], data: [pct], currency: false, caption: 'More points coming' };
  }
  return { labels: [], data: [], currency: false, caption: 'More points coming' };
}

function validateMoneyPost(body) {
  const hits = [];
  walkMoneyKeys(body, MONEY_TOP, 'money', hits);
  walkMoneyKeys(body.goal, MONEY_GOAL, 'money.goal', hits);
  asArray(body.net_worth_trend).forEach((point, index) => {
    if (point && typeof point === 'object' && !Array.isArray(point)) walkMoneyKeys(point, MONEY_POINT, `money.net_worth_trend[${index}]`, hits);
    else hits.push({ rule: 'unknown_key', line: 1, path: `money.net_worth_trend[${index}]` });
  });
  // Figures and the free-text source label are dropped before any check or storage.
  const redacted = structuredClone(body);
  if (redacted.goal && typeof redacted.goal === 'object') {
    delete redacted.goal.amount;
    delete redacted.goal.target_usd;
    delete redacted.goal.by;
  }
  for (const point of asArray(redacted.net_worth_trend)) {
    if (point && typeof point === 'object') {
      delete point.value;
      delete point.net_worth_usd;
      delete point.source;
    }
  }
  walkMoneyStrings(redacted, hits);
  try {
    assertClean(JSON.stringify(redacted), 'sections/money.json');
  } catch (error) {
    if (error.code === 'privacy') hits.push(...(error.hits || []));
    else throw error;
  }
  if (hits.length) throw privacyError(hits, 'sections/money.json');
  if (body.schema !== MONEY_SCHEMA) fail('invalid_body', 'schema must be mission-control-money-card/v1');
  const owner = cleanText(body.owner, 40);
  const updated = iso(body.updated);
  const progress = Number(body.progress_pct);
  if (!owner || !updated) fail('invalid_body', 'owner and updated are required');
  if (!Number.isFinite(progress) || progress < 0 || progress > 100) fail('invalid_body', 'progress_pct must be from 0 to 100');
  const goalRaw = body.goal?.target_usd ?? body.goal?.amount;
  const goal = goalRaw == null ? NaN : Number(goalRaw);
  if (goalRaw != null && (!Number.isFinite(goal) || goal <= 0 || goal > 1e15)) fail('invalid_body', 'goal amount must be a positive number');
  const trend = asArray(body.net_worth_trend).slice(0, 240).map((point) => {
    const date = day(point?.date ?? point?.as_of);
    let pct = Number(point?.pct);
    const raw = point?.net_worth_usd ?? point?.value;
    if (!Number.isFinite(pct) && raw != null && Number.isFinite(goal)) pct = (Number(raw) / goal) * 100;
    if (!date || !Number.isFinite(pct)) return null;
    return { date, pct: Math.round(Math.max(0, Math.min(pct, 1000)) * 10) / 10 };
  }).filter(Boolean);
  if (!trend.length) fail('invalid_body', 'net_worth_trend needs at least one date and value');
  const notes = body.notes == null || body.notes === '' ? '' : cleanText(body.notes, 280);
  return {
    section: 'money',
    schema: MONEY_SCHEMA,
    owner,
    updated,
    goal: { target_date: MONEY_GOAL_DATE },
    net_worth_trend: trend,
    progress_pct: Math.round(progress * 10) / 10,
    notes,
    example: false,
    receivedAt: new Date().toISOString()
  };
}
