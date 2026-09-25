// Production-build service-worker contract for texture atlases (run by
// playwright.release.config.js after `npm run build`; needs dist/).
//
// 1. A warmed install reopened with the network gone loads every atlas — image AND
//    frame data (fx_atlas.json was never cached before: an offline reload lost the FX).
// 2. An installed build upgraded to a new atlas version never pairs the old image with
//    the new frames (or vice versa): the old worker serves the old set, the new worker
//    the new set, and offline after the upgrade still has the complete new set.
//
// The spec serves dist/ from its own tiny server so "offline" is real (the server is
// shut down, not just emulated) and the second build can be swapped in underneath.
import { test, expect } from '@playwright/test';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';

const DIST = resolve('dist');
const PORT = Number(process.env.ER_OFFLINE_ATLAS_PORT || 4180);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const FX_PNG = 'assets/sprites/fx/fx_atlas.png';
const FX_JSON = 'assets/sprites/fx/fx_atlas.json';
// A precached, fallback-exempt document: controlled by the worker but running no game
// code, so update/activation steps are not raced by the game's own worker listeners.
const QUIET_PAGE = 'data/weapons.json';
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.mp3': 'audio/mpeg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
};

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const md5 = (buf) => createHash('md5').update(buf).digest('hex');

/** Static server over dist/ with an in-memory overlay (the "next deploy"). */
function startServer(overlay = new Map()) {
  const state = { overlay, requests: [] };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, ORIGIN);
    let path = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    if (path === '' || path.endsWith('/')) path += 'index.html';
    state.requests.push(`${path}${url.search}`);
    let body = state.overlay.get(path);
    if (!body) {
      const file = normalize(join(DIST, path));
      if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) {
        res.writeHead(404);
        res.end();
        return;
      }
      body = readFileSync(file);
    }
    res.writeHead(200, {
      'content-type': TYPES[extname(path)] || 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(body);
  });
  return new Promise((ready) =>
    server.listen(PORT, '127.0.0.1', () =>
      ready({
        state,
        close: () =>
          new Promise((done) => {
            server.closeAllConnections?.();
            server.close(done);
          }),
      }),
    ),
  );
}

/** Reopen the app the way a player does: a fresh navigation to the start URL. */
async function reopen(page) {
  await page.goto(`${ORIGIN}/`);
}

/**
 * Poll an async in-page check until it returns true. (page.waitForFunction does not
 * await a predicate's promise — a pending Promise is truthy — so async checks such as
 * service-worker registration state must be polled from here.)
 */
async function pollInPage(page, check, arg, timeout = 90_000) {
  await expect
    .poll(() => page.evaluate(check, arg).catch(() => false), { timeout, intervals: [250] })
    .toBe(true);
}

/** The worker has finished writing every same-origin asset this page used. */
async function waitForCachedAssets(page) {
  const uncached = () =>
    page.evaluate(async () => {
      const urls = [...new Set(performance.getEntriesByType('resource').map((e) => e.name))].filter(
        (u) => {
          const url = new URL(u);
          return url.origin === location.origin && /^\/(assets|data)\//.test(url.pathname);
        },
      );
      const missing = [];
      for (const u of urls)
        if (!(await caches.match(u, { ignoreSearch: true }))) missing.push(new URL(u).pathname);
      return urls.length ? missing : ['(no resources yet)'];
    });
  // Names the offending files on failure (e.g. an atlas JSON no route caches).
  await expect.poll(uncached, { timeout: 60_000, intervals: [500] }).toEqual([]);
}

async function waitForTitle(page) {
  await page.waitForFunction(() => window.__emblemRogueGame?.scene?.isActive('Title'), null, {
    timeout: 60_000,
  });
}

/** An activated worker (so its precache install finished) controls this page. */
async function waitForServiceWorkerControl(page) {
  await pollInPage(page, async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    return Boolean(navigator.serviceWorker.controller && reg?.active?.state === 'activated');
  });
}

async function waitForWarmup(page) {
  await page.waitForFunction(
    () => {
      const reg = window.__emblemRogueGame?.registry;
      if (!reg) return false;
      const pending = reg.get('deferredAssets');
      return reg.get('deferredAssetWarmupDone') === true || !pending?.length;
    },
    null,
    { timeout: 90_000 },
  );
}

/** What the running game actually has in its texture manager. */
function atlasSummary(page) {
  return page.evaluate(() => {
    const t = window.__emblemRogueGame.textures;
    const frames = (k) => (t.exists(k) ? t.get(k).getFrameNames().length : -1);
    const keys = t.getTextureKeys();
    return {
      fx: frames('fx_atlas'),
      nodes: frames('weathered_nodes'),
      pc98: Object.fromEntries(
        keys
          .filter((k) => k.startsWith('pc98-portraits-'))
          .sort()
          .map((k) => [k, frames(k)]),
      ),
      tracedPages: keys.filter((k) => k.startsWith('traced-page-')).length,
      tracedSprites: keys.filter((k) => k.startsWith('traced-') && !k.startsWith('traced-page-'))
        .length,
      failures: (window.__emblemRogueStartupTelemetry?.assetFailures || []).map(
        (f) => f.src || f.key,
      ),
    };
  });
}

/** Fetch through the page (and so its service worker); sha256 of each body. */
function fetchHashes(page, paths) {
  return page.evaluate(async (list) => {
    const out = {};
    for (const p of list) {
      const res = await fetch(new URL(p, `${location.origin}/`));
      const digest = await crypto.subtle.digest('SHA-256', await res.arrayBuffer());
      out[p] =
        `${res.status}:${[...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
    }
    return out;
  }, paths);
}

function expectedAtlases() {
  const fx = JSON.parse(readFileSync(join(DIST, FX_JSON), 'utf8'));
  const pc98 = JSON.parse(readFileSync(resolve('src/ui/Pc98PortraitManifest.json'), 'utf8'));
  const pc98Frames = Object.values(pc98.portraits).filter((p) => Number.isInteger(p.frame)).length;
  return {
    fx: Object.keys(fx.frames).length,
    pc98: Object.fromEntries(
      [...pc98.atlas.sizes].map((s) => [`pc98-portraits-${s}`, pc98Frames]).sort(),
    ),
  };
}

function expectAllAtlases(summary, fxFrames = expectedAtlases().fx) {
  const expected = expectedAtlases();
  expect(summary.fx).toBe(fxFrames);
  expect(summary.nodes).toBeGreaterThan(5);
  expect(summary.pc98).toEqual(expected.pc98);
  expect(summary.tracedPages).toBeGreaterThanOrEqual(1);
  expect(summary.tracedSprites).toBeGreaterThan(50);
  expect(summary.failures).toEqual([]);
}

/** A valid PNG with an extra tEXt chunk: new bytes (a new deploy), identical pixels. */
function pngWithMarker(png, marker) {
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (buf) => {
    let c = 0xffffffff;
    for (const byte of buf) c = table[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const data = Buffer.from(`Comment\0${marker}`, 'latin1');
  const typeAndData = Buffer.concat([Buffer.from('tEXt', 'latin1'), data]);
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeAndData.copy(chunk, 4);
  chunk.writeUInt32BE(crc32(typeAndData), 8 + data.length);
  const iend = png.length - 12; // IEND is always the final 12 bytes
  expect(png.subarray(iend + 4, iend + 8).toString('latin1')).toBe('IEND');
  return Buffer.concat([png.subarray(0, iend), chunk, png.subarray(iend)]);
}

test.skip(!existsSync(join(DIST, 'sw.js')), 'needs the production build (npm run build)');

test.beforeEach(async ({ page }) => {
  // waitForCachedAssets reads resource timing; boot alone loads more than the default 250.
  await page.addInitScript(() => performance.setResourceTimingBufferSize(10_000));
});

for (const variant of ['mobile', 'desktop']) {
  test.describe(`offline reopen (${variant})`, () => {
    if (variant === 'desktop')
      test.use({
        viewport: { width: 1280, height: 800 },
        isMobile: false,
        hasTouch: false,
        userAgent:
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        deviceScaleFactor: 1,
      });

    test('a warmed install loads every atlas (image + frames) with the network gone', async ({
      page,
      context,
    }) => {
      test.setTimeout(240_000);
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      const server = await startServer();
      try {
        // First visit installs the worker (precache: shell + atlases).
        await page.goto(`${ORIGIN}/`);
        await waitForTitle(page);
        await waitForServiceWorkerControl(page);
        // Second launch under the worker fills the runtime caches like a returning
        // player's; the deferred warmup (mobile safe boot) runs to completion.
        await reopen(page);
        await waitForTitle(page);
        await waitForWarmup(page);
        expectAllAtlases(await atlasSummary(page));
        await waitForCachedAssets(page);
      } finally {
        await server.close();
      }
      await context.setOffline(true);
      await reopen(page);
      await waitForTitle(page);
      await waitForWarmup(page);
      const offline = await atlasSummary(page);
      expectAllAtlases(offline);
      // Both halves of the FX atlas come from the worker, byte-identical to the build.
      expect(await fetchHashes(page, [FX_PNG, FX_JSON])).toEqual({
        [FX_PNG]: `200:${sha256(readFileSync(join(DIST, FX_PNG)))}`,
        [FX_JSON]: `200:${sha256(readFileSync(join(DIST, FX_JSON)))}`,
      });
      expect(errors).toEqual([]);
      await context.setOffline(false);
    });
  });
}

test('an upgraded install never pairs an old atlas image with new frame data', async ({
  page,
  context,
}) => {
  test.setTimeout(240_000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // Build A = dist. Build B = the same build with a repacked FX atlas: new PNG bytes and
  // a frame table with one extra frame. Its sw.js is A's with those two precache
  // revisions replaced — exactly what the build emits, since workbox revisions are the
  // md5 of the file (asserted here for A, and via workbox-build in
  // tests/OfflineCachePolicy.test.js).
  const pngA = readFileSync(join(DIST, FX_PNG));
  const jsonA = readFileSync(join(DIST, FX_JSON));
  const swA = readFileSync(join(DIST, 'sw.js'), 'utf8');
  for (const [path, buf] of [
    [FX_PNG, pngA],
    [FX_JSON, jsonA],
  ])
    expect(swA).toContain(`{url:"${path}",revision:"${md5(buf)}"}`);
  const pngB = pngWithMarker(pngA, 'build-b');
  const framesB = JSON.parse(jsonA.toString('utf8'));
  const [firstFrame] = Object.keys(framesB.frames);
  framesB.frames['upgrade-probe/0'] = framesB.frames[firstFrame];
  const jsonB = Buffer.from(JSON.stringify(framesB));
  const swB = swA
    .replace(
      `{url:"${FX_PNG}",revision:"${md5(pngA)}"}`,
      `{url:"${FX_PNG}",revision:"${md5(pngB)}"}`,
    )
    .replace(
      `{url:"${FX_JSON}",revision:"${md5(jsonA)}"}`,
      `{url:"${FX_JSON}",revision:"${md5(jsonB)}"}`,
    );
  expect(swB).not.toBe(swA);
  const framesA = Object.keys(JSON.parse(jsonA.toString('utf8')).frames).length;
  const A = { [FX_PNG]: `200:${sha256(pngA)}`, [FX_JSON]: `200:${sha256(jsonA)}` };
  const B = { [FX_PNG]: `200:${sha256(pngB)}`, [FX_JSON]: `200:${sha256(jsonB)}` };

  const overlay = new Map();
  const server = await startServer(overlay);
  try {
    // Install A.
    await page.goto(`${ORIGIN}/`);
    await waitForTitle(page);
    await waitForServiceWorkerControl(page);
    await reopen(page);
    await waitForTitle(page);
    expect((await atlasSummary(page)).fx).toBe(framesA);
    expect(await fetchHashes(page, [FX_PNG, FX_JSON])).toEqual(A);

    // Deploy B. The worker checks for an update, installs B's set beside A's and waits
    // (registerType 'prompt': it never swaps under a live page). The check runs from the
    // quiet page: with the game open, Chromium held the update check back ~60 s.
    const fxRequests = () => server.state.requests.filter((r) => r.includes('fx_atlas'));
    const fxBeforeDeploy = fxRequests().length;
    overlay.set(FX_PNG, pngB).set(FX_JSON, jsonB).set('sw.js', Buffer.from(swB));
    await page.goto(`${ORIGIN}/${QUIET_PAGE}`);
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
    await pollInPage(
      page,
      async () => (await navigator.serviceWorker.getRegistration())?.waiting?.state === 'installed',
    );
    // B's install fetched both changed halves (workbox fetches revisioned entries with
    // cache: 'reload', past the HTTP cache)...
    expect(fxRequests().slice(fxBeforeDeploy).sort()).toEqual([FX_JSON, FX_PNG]);
    // ...but A's worker still serves A's pair, whole.
    expect(await fetchHashes(page, [FX_PNG, FX_JSON])).toEqual(A);
    // A launch while B waits is entirely A: A's code, A's image, A's frames.
    await reopen(page);
    await waitForTitle(page);
    expect((await atlasSummary(page)).fx).toBe(framesA);
    expect(await fetchHashes(page, [FX_PNG, FX_JSON])).toEqual(A);

    // The player chooses Restart (updateSW(true) posts SKIP_WAITING): B activates and
    // claims the app; the next launch is B's set — new image with new frames.
    await page.goto(`${ORIGIN}/${QUIET_PAGE}`);
    await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      reg.waiting.postMessage({ type: 'SKIP_WAITING' });
    });
    await pollInPage(page, async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      return !reg.waiting && !reg.installing && reg.active?.state === 'activated';
    });
    expect(await fetchHashes(page, [FX_PNG, FX_JSON])).toEqual(B);
    await reopen(page);
    await waitForTitle(page);
    await waitForServiceWorkerControl(page);
    expect((await atlasSummary(page)).fx).toBe(framesA + 1);
    expect(await fetchHashes(page, [FX_PNG, FX_JSON])).toEqual(B);
    await waitForWarmup(page);
    await waitForCachedAssets(page);
  } finally {
    await server.close();
  }

  // Offline after the upgrade: B's complete set, never a mix.
  await context.setOffline(true);
  await reopen(page);
  await waitForTitle(page);
  await waitForWarmup(page);
  expectAllAtlases(await atlasSummary(page), framesA + 1);
  expect(await fetchHashes(page, [FX_PNG, FX_JSON])).toEqual(B);
  expect(errors).toEqual([]);
  await context.setOffline(false);
});
