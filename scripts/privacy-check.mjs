import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { personalSeedHits, scanText } from '../lib/privacy.js';
import { headlineHits } from '../lib/headlines.js';

const root = join(import.meta.dirname, '..');

function filesIn(dir) {
  const found = [];
  let entries = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return found;
  }
  for (const name of entries) {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) found.push(...filesIn(path));
    else found.push(path);
  }
  return found;
}

const targets = [
  join(root, 'status.json'),
  ...filesIn(join(root, 'agents')),
  ...filesIn(join(root, 'outputs')),
  ...filesIn(join(root, 'sections')),
  ...filesIn(join(root, 'fixtures'))
].filter((path) => /\.(json|md)$/.test(path));

let failed = false;
for (const path of targets) {
  const text = readFileSync(path, 'utf8');
  if (path.endsWith('.json')) {
    try {
      JSON.parse(text);
    } catch {
      console.error(`${path}: invalid_json`);
      failed = true;
      continue;
    }
  }
  const hits = scanText(text);
  if (path.endsWith('.json')) {
    hits.push(...personalSeedHits(text));
    try { hits.push(...headlineHits(JSON.parse(text))); } catch { /* invalid JSON is reported above */ }
  }
  const seen = new Set();
  for (const hit of hits) {
    const key = `${hit.line}:${hit.rule}`;
    if (seen.has(key)) continue;
    seen.add(key);
    console.error(`${path}:${hit.line} ${hit.rule}`);
    failed = true;
  }
}

// The live task list lives only in Blob. A committed task document, or a task list not marked
// as example data, fails the check.
function repoJson(dir) {
  const found = [];
  for (const name of readdirSync(dir)) {
    if (['node_modules', '.git', 'vendor', '.vercel'].includes(name)) continue;
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) found.push(...repoJson(path));
    else if (name.endsWith('.json')) found.push(path);
  }
  return found;
}
for (const path of repoJson(root)) {
  let data;
  try {
    data = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    continue;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) continue;
  const taskList = Array.isArray(data.tasks) || Array.isArray(data.todos);
  if (data.schema === 'mission-control-tasks/v1' || (taskList && data.example !== true)) {
    console.error(`${path}:1 committed_tasks`);
    failed = true;
  }
}

if (failed) {
  console.error('Privacy check failed.');
  process.exit(1);
}
console.log(`Privacy check passed (${targets.length} files).`);
