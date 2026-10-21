// Syntax-check every JavaScript file (the site has no bundler, so this is the build step).
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const skip = new Set(['node_modules', '.git', 'vendor', '.vercel']);
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (skip.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(m?js)$/.test(name)) out.push(path);
  }
  return out;
}
const files = walk(root);
let failed = 0;
for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (error) {
    failed += 1;
    console.error(String(error.stderr || error.message));
  }
}
if (failed) process.exit(1);
console.log(`Lint passed (${files.length} files).`);
