// A returning install, not a dev-server cache test: real Workbox workers and
// final production audio bytes. The old worker uses the previous audio policy.
import { test, expect } from '@playwright/test';
import { generateSW } from 'workbox-build';
import { build } from 'esbuild';
import http from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';

const DIST = resolve('dist');
const APP_PACKAGE = process.env.ER_AUDIO_APP_PACKAGE === '1';
const PORT = Number(process.env.ER_AUDIO_UPGRADE_PORT || 4182);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const manifest = JSON.parse(readFileSync('src/utils/AudioAssetManifest.json', 'utf8'));
const KEY = 'music_battle_act1_2';
const CALM = `${KEY}_calm`;
const TYPES = {
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.webmanifest': 'application/json',
  '.html': 'text/html',
  '.mp3': 'audio/mpeg',
};

test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });
test.skip(!existsSync(join(DIST, 'sw.js')), 'requires npm run build');

async function wait(page, check) {
  await expect.poll(() => page.evaluate(check), { timeout: 60_000 }).toBe(true);
}

async function serverFor(legacyWorker, probe) {
  const state = { upgraded: false, offline: false, served: [], blocked: [] };
  const server = http.createServer((req, res) => {
    const path = new URL(req.url, ORIGIN).pathname.slice(1);
    if (state.offline) {
      state.blocked.push(path);
      req.socket.destroy();
      return;
    }
    state.served.push(path);
    let body;
    if (path === 'sw.js' && !state.upgraded) body = legacyWorker;
    else if (path === 'audio-probe.js') body = probe;
    else if (path.startsWith('legacy/'))
      body = readFileSync(join(DIST, manifest.entries.music_battle_act2.url));
    else {
      const file = resolve(DIST, path || 'index.html');
      if (!file.startsWith(DIST + '/') || !existsSync(file)) {
        res.writeHead(404);
        res.end();
        return;
      }
      body = readFileSync(file);
    }
    res.writeHead(200, {
      'content-type': TYPES[extname(path)] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(body);
  });
  await new Promise((done) => server.listen(PORT, '127.0.0.1', done));
  return {
    state,
    close: () =>
      new Promise((done) => {
        server.closeAllConnections();
        server.close(done);
      }),
  };
}

for (const oldKeys of [[KEY], [KEY, CALM]]) {
  test(`an upgraded desktop install ignores legacy audio (${oldKeys.length} stale layers), including offline`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const temp = mkdtempSync(join(tmpdir(), 'er-old-audio-sw-'));
    let server;
    try {
      await generateSW({
        globDirectory: temp,
        globPatterns: [],
        swDest: join(temp, 'sw.js'),
        inlineWorkboxRuntime: true,
        clientsClaim: true,
        runtimeCaching: [
          {
            urlPattern: /\/assets\/audio\/.*\.mp3$/,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'er-audio-assets' },
          },
        ],
      });
      const probe = await build({
        stdin: {
          contents:
            "export {AudioManager} from './src/utils/AudioManager.js'; export {LoopedMusic} from './src/utils/LoopedMusic.js';",
          resolveDir: process.cwd(),
        },
        bundle: true,
        format: 'esm',
        write: false,
      });
      server = await serverFor(readFileSync(join(temp, 'sw.js')), probe.outputFiles[0].contents);
      // Quiet document: no game's update/reload handlers racing the test.
      await page.goto(`${ORIGIN}/manifest.webmanifest`);
      await page.evaluate(() => navigator.serviceWorker.register('/sw.js'));
      await wait(page, () => Boolean(navigator.serviceWorker.controller));
      await page.evaluate(
        async (keys) => {
          const cache = await caches.open('er-audio-assets');
          for (const key of keys)
            await cache.put(`/assets/audio/music/${key}.mp3`, await fetch('/legacy/fixture.mp3'));
          await (
            await caches.open('er-image-assets')
          ).put('/migration-marker', new Response('keep'));
        },
        [...oldKeys, 'music_battle_act1'],
      );
      // First fetch still gets the legacy recording before revalidation.
      const legacy = await page.evaluate(async () =>
        (await fetch('/assets/audio/music/music_battle_act1_2.mp3'))
          .arrayBuffer()
          .then((b) => b.byteLength),
      );
      expect(legacy).toBe(readFileSync(join(DIST, manifest.entries.music_battle_act2.url)).length);

      server.state.upgraded = true;
      await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
      await wait(
        page,
        async () =>
          (await navigator.serviceWorker.getRegistration())?.waiting?.state === 'installed',
      );
      // Waiting is not activation: the old build's cache is still usable, and
      // a track it has never warmed remains available at its legacy web URL.
      expect(await page.evaluate(() => caches.has('er-audio-assets'))).toBe(true);
      expect(existsSync(join(DIST, 'assets/audio/music/music_title.mp3'))).toBe(!APP_PACKAGE);
      if (!APP_PACKAGE) {
        const legacyUnwarmed = await page.evaluate(async () => {
          const response = await fetch('/assets/audio/music/music_title.mp3');
          // Consume the body as a real audio loader does. An unread streaming
          // response can keep the old worker's fetch event alive during activation.
          await response.arrayBuffer();
          return { ok: response.ok, type: response.headers.get('content-type') };
        });
        expect(legacyUnwarmed).toEqual({ ok: true, type: 'audio/mpeg' });
        await wait(page, async () =>
          Boolean(
            await (
              await caches.open('er-audio-assets')
            ).match('/assets/audio/music/music_title.mp3'),
          ),
        );
      }
      await page.evaluate(async () =>
        (await navigator.serviceWorker.getRegistration()).waiting.postMessage({
          type: 'SKIP_WAITING',
        }),
      );
      await wait(page, async () => {
        const reg = await navigator.serviceWorker.getRegistration();
        return !reg.waiting && reg.active?.state === 'activated';
      });
      await wait(page, async () => !(await caches.has('er-audio-assets')));
      expect(await page.evaluate(() => caches.has('er-image-assets'))).toBe(true);

      const urls = [KEY, CALM].map((key) => manifest.entries[key].url);
      const fetched = await page.evaluate(
        async (urls) =>
          Promise.all(
            urls.map(async (url) => {
              const bytes = await (await fetch('/' + url)).arrayBuffer();
              const hash = await crypto.subtle.digest('SHA-256', bytes);
              return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join(
                '',
              );
            }),
          ),
        urls,
      );
      expect(fetched).toEqual([KEY, CALM].map((key) => manifest.entries[key].sha256));
      await wait(page, async () => {
        const cache = await caches.open('er-audio-assets-v2');
        return (await cache.keys()).filter((r) => r.url.includes('/versioned/music/')).length >= 2;
      });
      // Exercise the real loader and native MP3 decoder through the new worker.
      const music = await page.evaluate(async (key) => {
        const { AudioManager } = await import('/audio-probe.js');
        const ctx = new AudioContext();
        const store = new Map();
        const audio = new AudioManager({
          context: ctx,
          destination: ctx.destination,
          sounds: [],
          game: {
            cache: {
              audio: {
                has: (k) => store.has(k),
                get: (k) => store.get(k),
                add: (k, v) => store.set(k, v),
                remove: (k) => store.delete(k),
              },
            },
          },
        });
        // Ceremony downloads are outside this playback contract.
        audio.preloadStingers = () => {};
        audio.prefetchStingers = () => {};
        await audio.playMusic(key, null, 0);
        const result = audio.getAudioDiagnostics();
        audio.stopAllMusic(null);
        await ctx.close();
        return result;
      }, KEY);
      expect(music.current, JSON.stringify(music)).toBe(KEY);
      expect(music.layers.map((l) => l.name)).toEqual(['full', 'calm']);
      expect(music.layers.map((l) => l.asset.sha256)).toEqual(fetched);

      // Playwright's offline toggle need not block a service worker's fetch.
      // Refuse connections at the origin, including those made by the worker.
      server.state.offline = true;
      const servedBeforeOffline = server.state.served.length;
      await page.reload();
      const offline = await page.evaluate(
        async (urls) =>
          Promise.all(
            urls.map(async (url) => {
              const bytes = await (await fetch('/' + url)).arrayBuffer();
              return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) =>
                b.toString(16).padStart(2, '0'),
              ).join('');
            }),
          ),
        urls,
      );
      expect(offline).toEqual(fetched);
      // Unwarmed current recordings cannot fall back to a legacy logical key.
      const unwarmed = manifest.entries.music_battle_act1.url;
      expect(
        await page.evaluate(async (url) => {
          try {
            await fetch('/' + url);
            return true;
          } catch {
            return false;
          }
        }, unwarmed),
      ).toBe(false);
      expect(server.state.served.length).toBe(servedBeforeOffline);
      // Confirm the origin really rejected network attempts (a separate probe
      // also covers Chromium versions that implement browser-wide offline).
      await expect(fetch(`${ORIGIN}/offline-probe`)).rejects.toThrow();
      expect(server.state.blocked).toContain('offline-probe');
    } finally {
      await server?.close();
      rmSync(temp, { recursive: true, force: true });
    }
  });
}

test('shared-clock crossfades and a late layer stay aligned over repeated wraps in native Web Audio', async ({
  page,
}) => {
  const probe = await build({
    stdin: {
      contents: "export {LoopedMusic} from './src/utils/LoopedMusic.js';",
      resolveDir: process.cwd(),
    },
    bundle: true,
    format: 'esm',
    write: false,
  });
  const server = await serverFor(null, probe.outputFiles[0].contents);
  try {
    await page.goto(`${ORIGIN}/manifest.webmanifest`);
    const result = await page.evaluate(async () => {
      const { LoopedMusic } = await import('/audio-probe.js');
      async function render(adaptive) {
        const rate = 48000;
        const context = new OfflineAudioContext(1, rate * 2, rate);
        const buffer = context.createBuffer(1, rate / 2, rate);
        for (const t of [0.05, 0.15, 0.25, 0.35])
          buffer.getChannelData(0)[Math.round(t * rate)] = 1;
        const loop = { loopStart: 0.1, loopEnd: 0.4, duration: 0.5 };
        const music = new LoopedMusic({
          context,
          destination: context.destination,
          key: 'pulse',
          layers: { full: buffer },
          loops: { full: loop },
        });
        music.play();
        const added = adaptive ? context.suspend(0.65) : null;
        const switched = adaptive ? context.suspend(0.9) : null;
        const returned = adaptive ? context.suspend(1.3) : null;
        const rendered = context.startRendering();
        if (adaptive) {
          await added;
          music.addLayer('calm', buffer, loop);
          await context.resume();
          await switched;
          music.setLayer('calm', 100);
          await context.resume();
          await returned;
          music.setLayer('full', 100);
          await context.resume();
        }
        const out = (await rendered).getChannelData(0);
        const pulses = [];
        for (let i = 0; i < out.length; i++) if (out[i] > 0.1) pulses.push(i);
        return pulses;
      }
      return { baseline: await render(false), adaptive: await render(true) };
    });
    expect(result.baseline.length).toBeGreaterThan(15);
    expect(result.adaptive).toHaveLength(result.baseline.length);
    for (let i = 0; i < result.baseline.length; i++)
      expect(Math.abs(result.adaptive[i] - result.baseline[i])).toBeLessThanOrEqual(1);
  } finally {
    await server.close();
  }
});
