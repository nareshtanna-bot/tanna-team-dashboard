import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { scanText } from '../lib/privacy.js';
import { mergeStatus } from '../lib/status.js';

const root = join(import.meta.dirname, '..');
const agentsDir = join(root, 'agents');
const statusPath = join(root, 'status.json');

function fail(message) {
  console.error(message);
  process.exit(1);
}

let names = [];
try {
  names = readdirSync(agentsDir).filter((name) => name.endsWith('.json')).sort();
} catch {
  names = [];
}

const agents = [];
for (const name of names) {
  const path = join(agentsDir, name);
  const text = readFileSync(path, 'utf8');
  const hits = scanText(text);
  if (hits.length) fail(`Refusing to merge ${name}: ${hits.map((hit) => hit.rule).join(', ')}`);
  try {
    agents.push(JSON.parse(text));
  } catch {
    fail(`Invalid JSON: agents/${name}`);
  }
}

const seed = JSON.parse(readFileSync(statusPath, 'utf8'));
const merged = mergeStatus(seed, agents, new Date());
delete merged.meta;
const staleBots = merged.bots.map(({ stale, ...bot }) => bot);
const output = { ...merged, bots: staleBots, source: 'seed' };
const text = `${JSON.stringify(output, null, 2)}\n`;
const hits = scanText(text);
if (hits.length) fail(`Merged status.json failed the privacy check: ${[...new Set(hits.map((hit) => hit.rule))].join(', ')}`);
writeFileSync(statusPath, text);
console.log(`Merged ${agents.length} agent file(s) into status.json.`);
