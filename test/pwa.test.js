import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import vm from 'node:vm';
import { inflateSync } from 'node:zlib';
import { draw } from '../scripts/build-icons.mjs';

const root = new URL('..', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

function pngSize(path) {
  const data = readFileSync(new URL(path, root));
  return [data.readUInt32BE(16), data.readUInt32BE(20)];
}

test('manifest installs as a standalone app with original icons and no orientation lock', () => {
  const manifest = JSON.parse(read('manifest.json'));
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.id, './');
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  assert.equal(manifest.orientation, undefined, 'Mac and iPad windows must be free to rotate and resize');
  assert.ok(manifest.short_name.length <= 12);
  for (const icon of manifest.icons) {
    assert.ok(existsSync(new URL(icon.src, root)), icon.src);
    assert.equal(pngSize(icon.src).join('x'), icon.sizes);
  }
  assert.ok(manifest.icons.some((icon) => icon.purpose === 'maskable'));
  assert.ok(manifest.icons.some((icon) => icon.sizes === '512x512' && icon.purpose !== 'maskable'));
  assert.ok(manifest.shortcuts.some((s) => s.url === './#tasks'));
});

test('index has standalone metas, light and dark theme colors, and a 180px apple-touch-icon', () => {
  const html = read('index.html');
  assert.match(html, /viewport-fit=cover/);
  assert.match(html, /<meta name="theme-color" content="#efeae2" media="\(prefers-color-scheme: light\)"/);
  assert.match(html, /<meta name="theme-color" content="#141614" media="\(prefers-color-scheme: dark\)"/);
  assert.match(html, /<meta name="apple-mobile-web-app-capable" content="yes"/);
  assert.match(html, /<meta name="apple-mobile-web-app-title" content="Mission"/);
  assert.match(html, /<link rel="manifest" href="manifest.json"/);
  assert.match(html, /<link rel="apple-touch-icon" href="icons\/apple-touch-icon.png"/);
  assert.deepEqual(pngSize('icons/apple-touch-icon.png'), [180, 180]);
});

function alphaAt(png, size) {
  const idat = [];
  let offset = 8;
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    if (png.toString('ascii', offset + 4, offset + 8) === 'IDAT') idat.push(png.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  return (x, y) => raw[y * (size * 4 + 1) + 1 + x * 4 + 3];
}

test('icon generator: apple-touch and maskable icons are opaque, "any" icons have rounded corners', () => {
  // iOS fills transparent apple-touch-icon pixels with black, so it must be full bleed.
  const touch = alphaAt(draw(180, { fullBleed: true }), 180);
  for (let y = 0; y < 180; y += 1) {
    for (let x = 0; x < 180; x += 1) assert.equal(touch(x, y), 255, `alpha at ${x},${y}`);
  }
  const maskable = alphaAt(draw(512, { fullBleed: true, ringScale: 0.2 }), 512);
  assert.equal(maskable(0, 0), 255);
  const any = alphaAt(draw(192), 192);
  assert.equal(any(0, 0), 0);
  assert.equal(any(96, 96), 255);
});

function loadWorker() {
  const handlers = {};
  const stored = new Map();
  const cache = {
    addAll: async () => {},
    put: async (key, response) => { stored.set(String(key), response); },
    match: async (key) => stored.get(String(key))
  };
  const context = {
    URL,
    Response: { error: () => 'network-error' },
    Promise,
    self: {
      location: { origin: 'https://mission.test' },
      addEventListener: (type, fn) => { handlers[type] = fn; },
      skipWaiting: () => {},
      clients: { claim: () => {} }
    },
    caches: {
      open: async () => cache,
      keys: async () => [],
      delete: async () => true,
      match: async (key) => stored.get(String(key))
    },
    fetch: async () => context.nextResponse
  };
  vm.runInNewContext(read('sw.js'), context);
  async function dispatch(url, { method = 'GET', mode = 'cors' } = {}) {
    let responded = null;
    handlers.fetch({ request: { url, method, mode }, respondWith: (p) => { responded = p; } });
    const result = responded ? await responded : undefined;
    await new Promise((resolve) => setTimeout(resolve, 0));
    return { responded: Boolean(responded), result };
  }
  return { context, stored, dispatch };
}

function fakeResponse(extra = {}) {
  return { ok: true, type: 'basic', redirected: false, clone() { return { ...this, cloned: true }; }, ...extra };
}

test('service worker never handles or caches /api/* data', async () => {
  const sw = loadWorker();
  for (const path of ['/api/tasks', '/api/tasks?t=1', '/api/status?t=2', '/api/sections', '/api/anything']) {
    sw.context.nextResponse = fakeResponse();
    const { responded } = await sw.dispatch(`https://mission.test${path}`);
    assert.equal(responded, false, path);
  }
  assert.equal(sw.stored.size, 0);
  const post = await sw.dispatch('https://mission.test/api/tasks', { method: 'POST' });
  assert.equal(post.responded, false);
});

test('service worker caches app files once per path and skips redirects and other origins', async () => {
  const sw = loadWorker();
  sw.context.nextResponse = fakeResponse();
  await sw.dispatch('https://mission.test/status.json?t=123');
  await sw.dispatch('https://mission.test/status.json?t=456');
  assert.deepEqual([...sw.stored.keys()], ['https://mission.test/status.json']);

  sw.context.nextResponse = fakeResponse({ redirected: true });
  await sw.dispatch('https://mission.test/app.js');
  sw.context.nextResponse = fakeResponse({ type: 'opaqueredirect', ok: false });
  await sw.dispatch('https://mission.test/styles.css');
  const other = await sw.dispatch('https://vercel.com/sso-api');
  assert.equal(other.responded, false);
  assert.deepEqual([...sw.stored.keys()], ['https://mission.test/status.json']);

  sw.context.fetch = async () => { throw new TypeError('offline'); };
  const offline = await sw.dispatch('https://mission.test/status.json?t=789');
  assert.equal(offline.result.cloned, true);
});

test('every precached asset exists', () => {
  const source = read('sw.js');
  const list = source.slice(source.indexOf('const ASSETS = ['), source.indexOf('];'));
  const assets = [...list.matchAll(/'\.\/([^']*)'/g)].map((m) => m[1]).filter(Boolean);
  assert.ok(assets.length > 10);
  for (const asset of assets) assert.ok(existsSync(new URL(asset, root)), asset);
});

test('offline cache is the next version above main and includes headlines plus inbox assets', () => {
  const source = read('sw.js');
  assert.match(source, /const CACHE = 'mission-control-v10'/);
  for (const asset of ["'./lib/headlines.js'", "'./inbox.css'", "'./inbox.js'"]) {
    assert.ok(source.includes(asset), asset);
  }
});

test('package.json has no build script, so Vercel serves the static root', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.scripts.build, undefined);
  assert.match(pkg.scripts.verify, /lint && npm run check && npm test/);
});
