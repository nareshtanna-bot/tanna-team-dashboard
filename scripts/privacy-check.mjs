import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { scanText } from '../lib/privacy.js';

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

const targets = [join(root, 'status.json'), ...filesIn(join(root, 'agents')), ...filesIn(join(root, 'outputs'))]
  .filter((path) => /\.(json|md)$/.test(path));

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
  const seen = new Set();
  for (const hit of hits) {
    const key = `${hit.line}:${hit.rule}`;
    if (seen.has(key)) continue;
    seen.add(key);
    console.error(`${path}:${hit.line} ${hit.rule}`);
    failed = true;
  }
}

if (failed) {
  console.error('Privacy check failed.');
  process.exit(1);
}
console.log(`Privacy check passed (${targets.length} files).`);
