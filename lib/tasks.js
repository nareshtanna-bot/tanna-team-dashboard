/**
 * Tasks: one JSON document in private Blob storage.
 * Pure functions only, so the page (tasks.js) and the API (api/tasks.js) share them.
 */
import { scanText } from './privacy.js';

export const TASKS_SCHEMA = 'mission-control-tasks/v1';

export const VIEWS = ['inbox', 'today', 'upcoming', 'anytime', 'someday', 'logbook'];
export const SOURCES = ['manual', 'bot', 'things-import'];
export const STATUSES = ['open', 'completed', 'canceled'];
export const STARTS = ['inbox', 'anytime', 'someday'];
export const CATEGORIES = ['health', 'money', 'family', 'home', 'work', 'personal'];
/** Tasks in these categories are always private: left out of any shared view. */
export const PRIVATE_CATEGORIES = ['health', 'money'];

export const LIMITS = { title: 300, notes: 10000, tag: 40, tags: 20, checklist: 100, batch: 2000 };

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function fail(code, message, extra = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, extra);
  throw error;
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function has(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

export function newId(prefix = 't') {
  const uuid = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${uuid.replace(/-/g, '').slice(0, 16)}`;
}

/** Calendar day in America/New_York, as YYYY-MM-DD. */
export function etDay(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(date);
}

export function validDay(value) {
  if (typeof value !== 'string' || !DAY_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function text(value, max, field, { required = false } = {}) {
  if (value == null) {
    if (required) fail('invalid_task', `${field} is required`);
    return '';
  }
  if (typeof value !== 'string') fail('invalid_task', `${field} must be a string`);
  const clean = field === 'notes' ? value.replace(/\r\n/g, '\n').trim() : value.replace(/\s+/g, ' ').trim();
  if (required && !clean) fail('invalid_task', `${field} is required`);
  if (clean.length > max) fail('invalid_task', `${field} is longer than ${max} characters`);
  return clean;
}

function dayOrNull(value, field) {
  if (value == null || value === '') return null;
  if (!validDay(value)) fail('invalid_task', `${field} must be a date like 2026-10-18`);
  return value;
}

function isoOrNull(value, field) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) fail('invalid_task', `${field} must be an ISO timestamp`);
  return new Date(value).toISOString();
}

function refOrNull(value, field) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !/^[A-Za-z0-9_:.-]{1,80}$/.test(value)) fail('invalid_task', `${field} is not a valid id`);
  return value;
}

export function cleanTags(value) {
  if (value == null) return [];
  const list = typeof value === 'string' ? value.split(',') : value;
  if (!Array.isArray(list)) fail('invalid_task', 'tags must be a list of strings');
  const seen = new Set();
  const tags = [];
  for (const raw of list) {
    if (typeof raw !== 'string') fail('invalid_task', 'tags must be a list of strings');
    const tag = raw.replace(/\s+/g, ' ').trim().replace(/^#+/, '').trim();
    if (!tag) continue;
    if (tag.length > LIMITS.tag) fail('invalid_task', `a tag is longer than ${LIMITS.tag} characters`);
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
  }
  if (tags.length > LIMITS.tags) fail('invalid_task', `at most ${LIMITS.tags} tags`);
  return tags;
}

function cleanChecklist(value, existing = []) {
  if (value == null) return [];
  if (!Array.isArray(value)) fail('invalid_task', 'checklist must be a list');
  if (value.length > LIMITS.checklist) fail('invalid_task', `at most ${LIMITS.checklist} checklist items`);
  const prior = new Map(existing.map((item) => [item.id, item]));
  return value.map((item) => {
    const row = typeof item === 'string' ? { title: item } : item;
    if (!isObject(row)) fail('invalid_task', 'checklist items need a title');
    const id = refOrNull(row.id, 'checklist id') || newId('c');
    return {
      id,
      title: text(row.title, LIMITS.title, 'checklist title', { required: true }),
      done: Boolean(row.done ?? prior.get(id)?.done ?? false),
      externalId: refOrNull(row.externalId, 'checklist externalId')
    };
  });
}

/**
 * Turn a "when" value into the stored schedule fields.
 *   null / 'inbox'     -> Inbox
 *   'anytime'          -> Anytime, no date
 *   'someday'          -> Someday
 *   'today'            -> start date today
 *   'evening'          -> start date today, in the This Evening section
 *   'YYYY-MM-DD'       -> start date (Today once that day arrives, Upcoming before)
 */
export function parseWhen(when, today) {
  if (when == null || when === '' || when === 'inbox') return { start: 'inbox', startDate: null, evening: false };
  if (when === 'anytime') return { start: 'anytime', startDate: null, evening: false };
  if (when === 'someday') return { start: 'someday', startDate: null, evening: false };
  if (when === 'today') return { start: 'anytime', startDate: today, evening: false };
  if (when === 'evening' || when === 'this-evening' || when === 'tonight') return { start: 'anytime', startDate: today, evening: true };
  if (validDay(when)) return { start: 'anytime', startDate: when, evening: false };
  return fail('invalid_task', 'when must be inbox, today, evening, anytime, someday, or a date like 2026-10-18');
}

function privacyFields(input, current = {}) {
  const category = has(input, 'category')
    ? (input.category == null || input.category === '' ? null : input.category)
    : (current.category ?? null);
  if (category != null && !CATEGORIES.includes(category)) {
    fail('invalid_task', `category must be one of ${CATEGORIES.join(', ')}`);
  }
  let flag = has(input, 'private') ? input.private : current.private;
  if (flag != null && typeof flag !== 'boolean') fail('invalid_task', 'private must be true or false');
  if (category && PRIVATE_CATEGORIES.includes(category)) flag = true;
  return { category, private: Boolean(flag) };
}

/** Secrets never belong in a task, even a private one. Health and money wording is allowed: those tasks are marked private. */
export function assertNoSecrets(task) {
  const hits = scanText([task.title, task.notes, ...(task.checklist || []).map((item) => item.title)].join('\n'))
    .filter((hit) => hit.rule === 'secret');
  if (hits.length) fail('privacy', 'Task rejected by the secret check.', { hits });
}

/** Validate a new task. `source` is decided by the caller (auth), not trusted from the body for browser posts. */
export function createTask(input, { now = new Date(), source = 'manual', id } = {}) {
  if (!isObject(input)) fail('invalid_task', 'Task must be an object');
  const nowIso = now.toISOString();
  const today = etDay(now);
  let schedule;
  if (has(input, 'when')) schedule = parseWhen(input.when, today);
  else {
    const start = input.start ?? 'inbox';
    if (!STARTS.includes(start)) fail('invalid_task', `start must be one of ${STARTS.join(', ')}`);
    schedule = { start, startDate: dayOrNull(input.startDate, 'startDate'), evening: Boolean(input.evening) };
    if (schedule.startDate && schedule.start === 'inbox') schedule.start = 'anytime';
  }
  const status = input.status ?? 'open';
  if (!STATUSES.includes(status)) fail('invalid_task', `status must be one of ${STATUSES.join(', ')}`);
  if (!SOURCES.includes(source)) fail('invalid_task', `source must be one of ${SOURCES.join(', ')}`);
  const task = {
    id: id || newId('t'),
    title: text(input.title, LIMITS.title, 'title', { required: true }),
    notes: text(input.notes, LIMITS.notes, 'notes'),
    ...schedule,
    deadline: dayOrNull(input.deadline, 'deadline'),
    tags: cleanTags(input.tags),
    checklist: cleanChecklist(input.checklist),
    status,
    areaId: refOrNull(input.areaId, 'areaId'),
    projectId: refOrNull(input.projectId, 'projectId'),
    headingId: refOrNull(input.headingId, 'headingId'),
    ...privacyFields(input),
    source,
    externalId: refOrNull(input.externalId, 'externalId'),
    createdBy: input.createdBy == null ? null : text(input.createdBy, 40, 'createdBy'),
    createdAt: isoOrNull(input.createdAt, 'createdAt') || nowIso,
    updatedAt: nowIso,
    completedAt: status === 'open' ? null : (isoOrNull(input.completedAt, 'completedAt') || nowIso)
  };
  assertNoSecrets(task);
  return task;
}

const PATCHABLE = new Set([
  'title', 'notes', 'when', 'start', 'startDate', 'evening', 'deadline', 'tags', 'checklist', 'status',
  'complete', 'areaId', 'projectId', 'headingId', 'private', 'category', 'completedAt'
]);

/** Apply a PATCH. `complete: true` is the one-tap shortcut for status completed (the Logbook). */
export function updateTask(current, patch, { now = new Date() } = {}) {
  if (!isObject(patch)) fail('invalid_task', 'Patch must be an object');
  const unknown = Object.keys(patch).filter((key) => key !== 'id' && !PATCHABLE.has(key));
  if (unknown.length) fail('invalid_task', `cannot change ${unknown.join(', ')}`);
  const next = { ...current };
  const today = etDay(now);
  if (has(patch, 'title')) next.title = text(patch.title, LIMITS.title, 'title', { required: true });
  if (has(patch, 'notes')) next.notes = text(patch.notes, LIMITS.notes, 'notes');
  if (has(patch, 'when')) Object.assign(next, parseWhen(patch.when, today));
  if (has(patch, 'start')) {
    if (!STARTS.includes(patch.start)) fail('invalid_task', `start must be one of ${STARTS.join(', ')}`);
    next.start = patch.start;
  }
  if (has(patch, 'startDate')) next.startDate = dayOrNull(patch.startDate, 'startDate');
  if (has(patch, 'evening')) next.evening = Boolean(patch.evening);
  if (has(patch, 'deadline')) next.deadline = dayOrNull(patch.deadline, 'deadline');
  if (has(patch, 'tags')) next.tags = cleanTags(patch.tags);
  if (has(patch, 'checklist')) next.checklist = cleanChecklist(patch.checklist, current.checklist || []);
  for (const key of ['areaId', 'projectId', 'headingId']) if (has(patch, key)) next[key] = refOrNull(patch[key], key);
  Object.assign(next, privacyFields(patch, current));
  let status = next.status;
  if (has(patch, 'complete')) {
    if (typeof patch.complete !== 'boolean') fail('invalid_task', 'complete must be true or false');
    status = patch.complete ? 'completed' : 'open';
  }
  if (has(patch, 'status')) {
    if (!STATUSES.includes(patch.status)) fail('invalid_task', `status must be one of ${STATUSES.join(', ')}`);
    status = patch.status;
  }
  if (status !== current.status) {
    next.status = status;
    next.completedAt = status === 'open' ? null : (isoOrNull(patch.completedAt, 'completedAt') || now.toISOString());
  }
  next.updatedAt = now.toISOString();
  assertNoSecrets(next);
  return next;
}

export function emptyDoc(now = new Date()) {
  return { schema: TASKS_SCHEMA, updated: now.toISOString(), areas: [], projects: [], tasks: [] };
}

export function normalizeDoc(doc) {
  if (!isObject(doc) || doc.schema !== TASKS_SCHEMA) return emptyDoc();
  return {
    ...doc,
    areas: Array.isArray(doc.areas) ? doc.areas : [],
    projects: Array.isArray(doc.projects) ? doc.projects : [],
    tasks: Array.isArray(doc.tasks) ? doc.tasks : []
  };
}

function cleanArea(input, { now, source }) {
  if (!isObject(input)) fail('invalid_task', 'Area must be an object');
  const area = {
    id: refOrNull(input.id, 'area id') || newId('a'),
    title: text(input.title, LIMITS.title, 'area title', { required: true }),
    tags: cleanTags(input.tags),
    ...privacyFields(input),
    source,
    externalId: refOrNull(input.externalId, 'externalId'),
    updatedAt: now.toISOString()
  };
  assertNoSecrets({ title: area.title, notes: '' });
  return area;
}

function cleanProject(input, { now, source }) {
  if (!isObject(input)) fail('invalid_task', 'Project must be an object');
  const status = input.status ?? 'open';
  if (!STATUSES.includes(status)) fail('invalid_task', `status must be one of ${STATUSES.join(', ')}`);
  const start = input.start ?? 'anytime';
  if (!STARTS.includes(start)) fail('invalid_task', `start must be one of ${STARTS.join(', ')}`);
  const headings = Array.isArray(input.headings) ? input.headings : [];
  const project = {
    id: refOrNull(input.id, 'project id') || newId('p'),
    title: text(input.title, LIMITS.title, 'project title', { required: true }),
    notes: text(input.notes, LIMITS.notes, 'notes'),
    areaId: refOrNull(input.areaId, 'areaId'),
    start,
    startDate: dayOrNull(input.startDate, 'startDate'),
    deadline: dayOrNull(input.deadline, 'deadline'),
    tags: cleanTags(input.tags),
    headings: headings.map((heading) => ({
      id: refOrNull(heading?.id, 'heading id') || newId('h'),
      title: text(heading?.title, LIMITS.title, 'heading title', { required: true }),
      externalId: refOrNull(heading?.externalId, 'externalId')
    })),
    status,
    ...privacyFields(input),
    source,
    externalId: refOrNull(input.externalId, 'externalId'),
    createdAt: isoOrNull(input.createdAt, 'createdAt') || now.toISOString(),
    completedAt: status === 'open' ? null : (isoOrNull(input.completedAt, 'completedAt') || now.toISOString()),
    updatedAt: now.toISOString()
  };
  assertNoSecrets(project);
  return project;
}

function upsert(list, item, { keepId = true } = {}) {
  const index = item.externalId ? list.findIndex((row) => row.externalId === item.externalId) : -1;
  if (index === -1) {
    list.push(item);
    return { item, created: true };
  }
  const prev = list[index];
  const merged = { ...prev, ...item, id: keepId ? prev.id : item.id, createdAt: prev.createdAt || item.createdAt };
  list[index] = merged;
  return { item: merged, created: false };
}

/**
 * Add one task, or a batch { areas, projects, tasks } from an importer.
 * Records with an externalId already in the doc are updated in place (dedup), so a re-run is a no-op.
 * Batch rows that fail validation are reported, not stored; the rest still land.
 */
export function applyPost(doc, body, { now = new Date(), source = 'manual' } = {}) {
  const next = normalizeDoc(structuredClone(doc));
  const isBatch = isObject(body) && (Array.isArray(body.tasks) || Array.isArray(body.projects) || Array.isArray(body.areas));
  if (!isBatch) {
    const task = createTask(body, { now, source });
    const result = upsert(next.tasks, task);
    next.updated = now.toISOString();
    return { doc: next, task: result.item, created: result.created ? 1 : 0, updated: result.created ? 0 : 1, rejected: [] };
  }
  const total = (body.areas?.length || 0) + (body.projects?.length || 0) + (body.tasks?.length || 0);
  if (total > LIMITS.batch) fail('too_large', `at most ${LIMITS.batch} records per post`);
  const counts = { created: 0, updated: 0, rejected: [] };
  const ids = { area: new Map(), project: new Map(), heading: new Map() };
  const step = (kind, list, rows, clean) => {
    (rows || []).forEach((row, index) => {
      try {
        const item = clean(row);
        const { item: stored, created } = upsert(list, item);
        if (ids[kind] && row?.id && row.id !== stored.id) ids[kind].set(row.id, stored.id);
        if (kind === 'project') {
          (row.headings || []).forEach((heading, i) => {
            if (heading?.id && stored.headings[i]) ids.heading.set(heading.id, stored.headings[i].id);
          });
        }
        counts[created ? 'created' : 'updated'] += 1;
      } catch (error) {
        counts.rejected.push({ kind, index, externalId: row?.externalId || null, error: error.code || 'invalid_task', message: error.code === 'privacy' ? 'secret' : error.message });
      }
    });
  };
  step('area', next.areas, body.areas, (row) => cleanArea(row, { now, source }));
  step('project', next.projects, body.projects, (row) => cleanProject({ ...row, areaId: ids.area.get(row?.areaId) || row?.areaId }, { now, source }));
  step('task', next.tasks, body.tasks, (row) => {
    if (!isObject(row)) fail('invalid_task', 'Task must be an object');
    const prior = row.externalId ? next.tasks.find((task) => task.externalId === row.externalId) : null;
    return createTask({
      ...row,
      areaId: ids.area.get(row.areaId) || row.areaId,
      projectId: ids.project.get(row.projectId) || row.projectId,
      headingId: ids.heading.get(row.headingId) || row.headingId
    }, { now, source, id: prior?.id });
  });
  next.updated = now.toISOString();
  return { doc: next, created: counts.created, updated: counts.updated, rejected: counts.rejected };
}

export function applyPatch(doc, id, patch, { now = new Date() } = {}) {
  const next = normalizeDoc(structuredClone(doc));
  const index = next.tasks.findIndex((task) => task.id === id || (task.externalId && task.externalId === id));
  if (index === -1) fail('not_found', 'No task with that id');
  next.tasks[index] = updateTask(next.tasks[index], patch, { now });
  next.updated = now.toISOString();
  return { doc: next, task: next.tasks[index] };
}

/** Which list a task shows in, the way Things files it. */
export function viewOf(task, today) {
  if (task.status !== 'open') return 'logbook';
  if (task.start === 'someday') return 'someday';
  if (task.startDate && task.startDate <= today) return 'today';
  if (task.startDate) return 'upcoming';
  if (task.start === 'inbox') return 'inbox';
  return 'anytime';
}

export function filterView(tasks, view, { today = etDay(), shared = false } = {}) {
  if (!VIEWS.includes(view)) fail('invalid_view', `view must be one of ${VIEWS.join(', ')}`);
  return (tasks || []).filter((task) => {
    if (shared && task.private) return false;
    const where = viewOf(task, today);
    if (view === 'anytime') return where === 'anytime' || where === 'today';
    return where === view;
  });
}

/** The date a task sorts by: completed time in the Logbook, else start date, then deadline, then created. */
export function sortDate(task, view) {
  if (view === 'logbook') return task.completedAt || task.updatedAt || task.createdAt || '';
  return task.startDate || task.deadline || task.createdAt || '';
}

export function sortTasks(tasks, direction = 'asc', view = 'inbox') {
  if (direction !== 'asc' && direction !== 'desc') fail('invalid_sort', 'sort must be asc or desc');
  const sign = direction === 'asc' ? 1 : -1;
  return [...(tasks || [])].sort((a, b) => {
    const ka = sortDate(a, view);
    const kb = sortDate(b, view);
    if (ka !== kb) return ka < kb ? -sign : sign;
    const ca = a.createdAt || '';
    const cb = b.createdAt || '';
    if (ca !== cb) return ca < cb ? -sign : sign;
    return String(a.title).localeCompare(String(b.title));
  });
}

/** Today view, split into the day and This Evening. */
export function todaySections(tasks, direction, today, options = {}) {
  const list = sortTasks(filterView(tasks, 'today', { today, ...options }), direction, 'today');
  return { day: list.filter((task) => !task.evening), evening: list.filter((task) => task.evening) };
}

export function counts(tasks, today, options = {}) {
  const out = Object.fromEntries(VIEWS.map((view) => [view, 0]));
  for (const view of VIEWS) out[view] = filterView(tasks, view, { today, ...options }).length;
  return out;
}

/** Blob key for the tasks document. Production and preview never share one. */
export function tasksBlobKey(env = {}) {
  if (env.TASKS_BLOB_KEY && /^[a-z0-9/_-]+\.json$/i.test(env.TASKS_BLOB_KEY)) return env.TASKS_BLOB_KEY;
  return env.VERCEL_ENV === 'production' ? 'tasks/tasks.json' : 'tasks/preview/tasks.json';
}
