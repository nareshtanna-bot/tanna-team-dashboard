#!/usr/bin/env node
/**
 * Things 3 -> Mission Control tasks importer (skeleton).
 *
 * Reads a Things export on the box and posts it to /api/tasks in batches.
 * Dry run is the default: nothing is sent unless --apply is given.
 * Idempotent: every record gets id `things_<uuid>` and externalId `things:<uuid>`,
 * and the API updates a record whose externalId it already has instead of adding a copy.
 *
 *   node scripts/import-things.mjs --source fixtures/things-export.example.json
 *   node scripts/import-things.mjs --source <export.json|main.sqlite> --apply --url https://<deployment>
 *
 * See docs/tasks-import-plan.md. The secret and the bypass value are read from files and never printed.
 */
import { existsSync, readFileSync, statSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const DEFAULT_PRIVATE_MAP = { health: 'health', wellness: 'health', medical: 'health', money: 'money', finance: 'money', finances: 'money', taxes: 'money' };

const STATUS = { incomplete: 'open', open: 'open', 0: 'open', completed: 'completed', 3: 'completed', canceled: 'canceled', cancelled: 'canceled', 2: 'canceled' };
const START = { inbox: 'inbox', 0: 'inbox', anytime: 'anytime', 1: 'anytime', someday: 'someday', 2: 'someday' };

export function thingsId(uuid) {
  return `things_${String(uuid).replace(/[^A-Za-z0-9_-]/g, '')}`;
}

export function thingsExternalId(uuid) {
  return `things:${String(uuid).replace(/[^A-Za-z0-9_.-]/g, '')}`;
}

/** Things stores startDate/deadline as a packed integer: year << 16 | month << 12 | day << 7. */
export function decodeThingsDate(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  const year = n >> 16;
  const month = (n >> 12) & 0xf;
  const day = (n >> 7) & 0x1f;
  if (year < 1970 || month < 1 || month > 12 || day < 1) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Things creation/stop dates are Unix seconds (float) in SQLite, ISO strings in a JSON export. */
export function decodeTimestamp(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return new Date(value * 1000).toISOString();
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

function stripNoteXml(notes) {
  const text = String(notes || '');
  if (!text.startsWith('<note')) return text;
  return text.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function pick(row, ...keys) {
  for (const key of keys) if (row?.[key] != null) return row[key];
  return null;
}

function categoryFor(names, privateMap) {
  for (const name of names) {
    const hit = privateMap[String(name || '').trim().toLowerCase()];
    if (hit) return hit;
  }
  return null;
}

/**
 * Map a parsed export ({ areas, projects, todos }) to an /api/tasks batch body.
 * Things -> model:
 *   start Inbox/Anytime/Someday -> start; start_date -> startDate (Today when <= today, Upcoming when later)
 *   evening (startBucket 1)     -> evening (This Evening)
 *   status incomplete/completed/canceled -> open/completed/canceled (completed + canceled = Logbook)
 *   area / project / heading    -> areaId / projectId / headingId (stable things_<uuid> ids)
 *   tags, notes, checklist, deadline, created, stop_date -> same-named fields
 * An area, project, or tag whose name is in privateMap (Health, Finance, ...) marks the record private.
 */
export function mapExport(data, { privateMap = DEFAULT_PRIVATE_MAP, includeLogbook = true } = {}) {
  const areaCategory = new Map();
  const areas = (data.areas || []).filter((row) => !row.trashed).map((row) => {
    const category = categoryFor([row.title, ...(row.tags || [])], privateMap);
    areaCategory.set(row.uuid, category);
    return {
      id: thingsId(row.uuid), externalId: thingsExternalId(row.uuid), title: row.title || 'Untitled area',
      tags: row.tags || [], ...(category ? { category } : {})
    };
  });
  const projectInfo = new Map();
  const projects = (data.projects || []).filter((row) => !row.trashed).map((row) => {
    const area = pick(row, 'area', 'area_uuid');
    const category = categoryFor([row.title, ...(row.tags || [])], privateMap) || areaCategory.get(area) || null;
    projectInfo.set(row.uuid, { area, category });
    const startDate = decodeThingsDate(pick(row, 'startDate', 'start_date'));
    return {
      id: thingsId(row.uuid), externalId: thingsExternalId(row.uuid), title: row.title || 'Untitled project',
      notes: stripNoteXml(row.notes), areaId: area ? thingsId(area) : null,
      start: startDate ? 'anytime' : (START[String(row.start ?? 'anytime').toLowerCase()] || 'anytime'),
      startDate, deadline: decodeThingsDate(row.deadline), tags: row.tags || [],
      headings: (row.headings || []).map((h) => ({ id: thingsId(h.uuid), externalId: thingsExternalId(h.uuid), title: h.title || 'Untitled heading' })),
      status: STATUS[String(row.status ?? 'incomplete').toLowerCase()] || 'open',
      createdAt: decodeTimestamp(pick(row, 'created', 'creationDate')),
      completedAt: decodeTimestamp(pick(row, 'stop_date', 'stopDate', 'completionDate')),
      ...(category ? { category } : {})
    };
  });
  const tasks = [];
  for (const row of data.todos || []) {
    if (row.trashed) continue;
    const status = STATUS[String(row.status ?? 'incomplete').toLowerCase()] || 'open';
    if (!includeLogbook && status !== 'open') continue;
    const project = pick(row, 'project', 'project_uuid');
    const area = pick(row, 'area', 'area_uuid') || projectInfo.get(project)?.area || null;
    const category = categoryFor([...(row.tags || [])], privateMap)
      || projectInfo.get(project)?.category || areaCategory.get(area) || null;
    const startDate = decodeThingsDate(pick(row, 'startDate', 'start_date'));
    tasks.push({
      id: thingsId(row.uuid),
      externalId: thingsExternalId(row.uuid),
      title: row.title || 'Untitled',
      notes: stripNoteXml(row.notes),
      start: startDate ? 'anytime' : (START[String(row.start ?? 'inbox').toLowerCase()] || 'inbox'),
      startDate,
      evening: Boolean(row.evening ?? (row.startBucket === 1)),
      deadline: decodeThingsDate(row.deadline),
      tags: row.tags || [],
      checklist: (row.checklist || []).map((item) => ({
        id: thingsId(item.uuid), externalId: thingsExternalId(item.uuid), title: item.title || 'Untitled',
        done: (STATUS[String(item.status ?? 'incomplete').toLowerCase()] || 'open') !== 'open'
      })),
      status,
      areaId: area ? thingsId(area) : null,
      projectId: project ? thingsId(project) : null,
      headingId: pick(row, 'heading', 'heading_uuid') ? thingsId(pick(row, 'heading', 'heading_uuid')) : null,
      createdAt: decodeTimestamp(pick(row, 'created', 'creationDate')),
      completedAt: status === 'open' ? null : decodeTimestamp(pick(row, 'stop_date', 'stopDate', 'completionDate')),
      ...(category ? { category } : {})
    });
  }
  return { source: 'things-import', areas, projects, tasks };
}

/** Read Things' main.sqlite with node:sqlite (Node 22.5+) or the sqlite3 CLI. Read only. */
export function readThingsSqlite(path) {
  const queries = {
    areas: 'SELECT uuid, title FROM TMArea',
    tags: 'SELECT uuid, title FROM TMTag',
    taskTags: 'SELECT tasks AS task, tags AS tag FROM TMTaskTag',
    areaTags: "SELECT areas AS area, tags AS tag FROM TMAreaTag",
    tasks: 'SELECT uuid, type, title, notes, status, trashed, start, startDate, startBucket, deadline, area, project, heading, creationDate, stopDate FROM TMTask',
    checklist: 'SELECT uuid, title, status, task, "index" AS idx FROM TMChecklistItem ORDER BY task, "index"'
  };
  let run;
  try {
    const { DatabaseSync } = loadSqliteModule();
    const db = new DatabaseSync(path, { readOnly: true });
    run = (sql) => { try { return db.prepare(sql).all(); } catch { return []; } };
  } catch {
    run = (sql) => {
      try {
        const out = execFileSync('sqlite3', ['-readonly', '-json', path, sql], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
        return out.trim() ? JSON.parse(out) : [];
      } catch { return []; }
    };
  }
  const tagName = new Map(run(queries.tags).map((row) => [row.uuid, row.title]));
  const tagsOf = (rows, key) => {
    const map = new Map();
    for (const row of rows) {
      if (!map.has(row[key])) map.set(row[key], []);
      if (tagName.has(row.tag)) map.get(row[key]).push(tagName.get(row.tag));
    }
    return map;
  };
  const taskTags = tagsOf(run(queries.taskTags), 'task');
  const areaTags = tagsOf(run(queries.areaTags), 'area');
  const checklist = new Map();
  for (const row of run(queries.checklist)) {
    if (!checklist.has(row.task)) checklist.set(row.task, []);
    checklist.get(row.task).push({ uuid: row.uuid, title: row.title, status: row.status });
  }
  const all = run(queries.tasks);
  const headingsOf = new Map();
  const headingProject = new Map();
  for (const row of all.filter((r) => r.type === 2 && !r.trashed)) {
    headingProject.set(row.uuid, row.project);
    if (!headingsOf.has(row.project)) headingsOf.set(row.project, []);
    headingsOf.get(row.project).push({ uuid: row.uuid, title: row.title });
  }
  const shape = (row) => ({
    uuid: row.uuid, title: row.title, notes: row.notes, status: row.status, trashed: Boolean(row.trashed),
    start: row.start, startDate: row.startDate, startBucket: row.startBucket, deadline: row.deadline,
    area: row.area, project: row.project || (row.heading ? headingProject.get(row.heading) : null), heading: row.heading,
    tags: taskTags.get(row.uuid) || [], creationDate: row.creationDate, stopDate: row.stopDate
  });
  return {
    areas: run(queries.areas).map((row) => ({ uuid: row.uuid, title: row.title, tags: areaTags.get(row.uuid) || [] })),
    projects: all.filter((r) => r.type === 1).map((row) => ({ ...shape(row), headings: headingsOf.get(row.uuid) || [] })),
    todos: all.filter((r) => r.type === 0).map((row) => ({ ...shape(row), checklist: checklist.get(row.uuid) || [] }))
  };
}

function loadSqliteModule() {
  // node:sqlite loads synchronously through process.getBuiltinModule on Node 22.5+.
  const mod = process.getBuiltinModule?.('node:sqlite');
  if (!mod) throw new Error('node:sqlite unavailable');
  return mod;
}

export function loadExport(source) {
  const path = resolve(source);
  if (!existsSync(path)) throw new Error(`No export at ${path}`);
  let file = path;
  if (statSync(path).isDirectory()) {
    const names = readdirSync(path);
    const pickName = names.find((n) => n.endsWith('.json')) || names.find((n) => n.endsWith('.sqlite'));
    if (!pickName) throw new Error(`No .json or .sqlite export in ${path}`);
    file = join(path, pickName);
  }
  if (file.endsWith('.sqlite')) return readThingsSqlite(file);
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function summarize(body) {
  const by = (list, key) => list.reduce((acc, row) => ({ ...acc, [row[key] || 'none']: (acc[row[key] || 'none'] || 0) + 1 }), {});
  return {
    areas: body.areas.length,
    projects: body.projects.length,
    headings: body.projects.reduce((n, p) => n + p.headings.length, 0),
    tasks: body.tasks.length,
    byStatus: by(body.tasks, 'status'),
    byStart: by(body.tasks, 'start'),
    scheduled: body.tasks.filter((t) => t.startDate).length,
    evening: body.tasks.filter((t) => t.evening).length,
    withDeadline: body.tasks.filter((t) => t.deadline).length,
    withChecklist: body.tasks.filter((t) => t.checklist.length).length,
    privateByCategory: by(body.tasks.filter((t) => t.category), 'category')
  };
}

export function batches(body, size = 250) {
  const out = [{ source: body.source, areas: body.areas, projects: body.projects, tasks: [] }];
  for (let i = 0; i < body.tasks.length; i += size) out.push({ source: body.source, tasks: body.tasks.slice(i, i + size) });
  return out;
}

function parseArgs(argv) {
  const args = { apply: false, batch: 250, includeLogbook: true };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--apply') args.apply = true;
    else if (a === '--dry-run') args.apply = false;
    else if (a === '--no-logbook') args.includeLogbook = false;
    else if (a === '--source') args.source = argv[++i];
    else if (a === '--url') args.url = argv[++i];
    else if (a === '--secret-file') args.secretFile = argv[++i];
    else if (a === '--bypass-file') args.bypassFile = argv[++i];
    else if (a === '--batch') args.batch = Number(argv[++i]) || 250;
    else if (a === '--private-map') {
      args.privateMap = Object.fromEntries(String(argv[++i]).split(',').map((pair) => pair.split('=').map((s) => s.trim().toLowerCase())));
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.source) {
    console.error('Usage: import-things.mjs --source <export.json|main.sqlite|dir> [--apply --url <deployment>] [--secret-file f] [--bypass-file f]');
    process.exit(2);
  }
  const body = mapExport(loadExport(args.source), {
    privateMap: { ...DEFAULT_PRIVATE_MAP, ...(args.privateMap || {}) },
    includeLogbook: args.includeLogbook
  });
  console.log(JSON.stringify({ mode: args.apply ? 'apply' : 'dry-run', ...summarize(body) }, null, 2));
  if (!args.apply) {
    console.log('Dry run: nothing sent. Add --apply --url <deployment> to post.');
    return;
  }
  if (!args.url) throw new Error('--apply needs --url');
  const secret = readFileSync(args.secretFile || '/workspace/mission-control/.bot-status-secret', 'utf8').trim();
  const bypassPath = args.bypassFile || '/workspace/mission-control/.vercel-bypass-secret';
  const bypass = existsSync(bypassPath) ? readFileSync(bypassPath, 'utf8').trim() : '';
  const endpoint = new URL('/api/tasks', args.url).href;
  let created = 0;
  let updated = 0;
  const rejected = [];
  for (const chunk of batches(body, args.batch)) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-bot-secret': secret,
        ...(bypass ? { 'x-vercel-protection-bypass': bypass } : {})
      },
      body: JSON.stringify(chunk)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`POST failed: ${response.status} ${result.error || ''}`);
    created += result.created || 0;
    updated += result.updated || 0;
    rejected.push(...(result.rejected || []));
  }
  console.log(JSON.stringify({ created, updated, rejected }, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
