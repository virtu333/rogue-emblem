// The service worker must serve every asset the game fetches after a warmed install
// goes offline, and a texture atlas's image and frame data must always come from the
// same deploy. These tests prove both against the real loaders and the real workbox
// globbing, so a new asset folder or atlas cannot silently escape the cache.
// (Browser-level proof: tests/e2e/offline-atlas.spec.js against the production build.)
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getManifest } from 'workbox-build';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));
vi.mock('../src/main.js', () => ({ cloudState: null }));

import {
  ATLAS_PRECACHE_GLOBS,
  HASHED_BUILD_OUTPUT,
  PRECACHE_GLOB_PATTERNS,
  RUNTIME_CACHE_ROUTES,
  runtimeCacheFor,
  workboxRuntimeCaching,
} from '../tools/pwa/offlineCachePolicy.js';
import { pwaWorkboxOptions } from '../vite.config.js';
import { BootScene } from '../src/scenes/BootScene.js';
import {
  PC98_MANIFEST,
  PC98_SIZES,
  pc98AtlasUrl,
  pc98BakedUrl,
  pc98FigureUrl,
  pc98PlateUrl,
  rebuiltPortraitUrl,
} from '../src/ui/portraitArt.js';
import rebuiltPortraitManifest from '../src/ui/RebuiltPortraitManifest.json';
import { loadWeatheredArt } from '../src/ui/WeatheredTerrain.js';
import { AudioManager } from '../src/utils/AudioManager.js';
import { MUSIC } from '../src/utils/musicConfig.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');
const NOT_FETCHED = new Set(['_headers', '_redirects']); // Netlify control files

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );
}
const md5 = (file) => createHash('md5').update(readFileSync(file)).digest('hex');

/** Loader URLs are page-relative (base './'); the site root is the build root. */
function sitePath(url) {
  return new URL(url, 'https://site.invalid/').pathname.replace(/^\//, '');
}

const shipped = walk(PUBLIC)
  .map((f) => relative(PUBLIC, f).split('\\').join('/'))
  .filter((f) => !NOT_FETCHED.has(f));

/** Precache entries exactly as the build computes them (same options, same globber). */
async function precacheFor(globDirectory, overrides = {}) {
  const { manifestEntries, warnings } = await getManifest({
    globDirectory,
    globPatterns: [...PRECACHE_GLOB_PATTERNS],
    dontCacheBustURLsMatching: HASHED_BUILD_OUTPUT,
    maximumFileSizeToCacheInBytes: pwaWorkboxOptions.maximumFileSizeToCacheInBytes,
    ...overrides,
  });
  return { entries: new Map(manifestEntries.map((e) => [e.url, e.revision])), warnings };
}

let precache;
beforeAll(async () => {
  precache = (await precacheFor(PUBLIC)).entries;
});

function coverage(path) {
  if (precache.has(path)) return 'precache';
  return runtimeCacheFor(`/${path}`);
}

// --- Recording loaders ---------------------------------------------------------------

function recordingLoader() {
  const calls = [];
  const load = {
    calls,
    on() {},
    once() {},
    image: (key, url) => calls.push({ type: 'image', key, urls: [url] }),
    audio: (key, urls) => calls.push({ type: 'audio', key, urls: [].concat(urls) }),
    atlas: (key, png, data) => calls.push({ type: 'atlas', key, urls: [png], data }),
  };
  return load;
}

function runBootPreload({ reducedPreload }) {
  globalThis.__emblemRogueStartupFlags = { reducedPreload, mobileSafeBoot: reducedPreload };
  const scene = Object.create(BootScene.prototype);
  scene.load = recordingLoader();
  const text = { setOrigin: () => text, setText: () => text, destroy() {} };
  scene.add = { text: () => text };
  scene.textures = { exists: () => false };
  scene._installPreloadStallWatch = () => {};
  scene.preload();
  const deferred = scene._deferredAssets.map((a) => ({
    type: a.type,
    key: a.key,
    urls: [].concat(a.src),
    data: a.data,
  }));
  return [...scene.load.calls, ...deferred];
}

afterEach(() => {
  delete globalThis.__emblemRogueStartupFlags;
  vi.unstubAllGlobals();
});

// --- Tests -----------------------------------------------------------------------------

describe('vite.config wires the shared cache policy', () => {
  it('uses the policy globs, revisioning rule and runtime routes', () => {
    expect(pwaWorkboxOptions.globPatterns).toEqual([...PRECACHE_GLOB_PATTERNS]);
    expect(pwaWorkboxOptions.dontCacheBustURLsMatching).toBe(HASHED_BUILD_OUTPUT);
    expect(pwaWorkboxOptions.runtimeCaching).toEqual(workboxRuntimeCaching());
    for (const glob of ATLAS_PRECACHE_GLOBS) expect(PRECACHE_GLOB_PATTERNS).toContain(glob);
  });
});

describe('revisioning', () => {
  it("skips revisions only for Vite's flat content-hashed output", () => {
    for (const hashed of [
      'assets/index-C68ug_0w.js',
      'assets/index-BrSbRMD3.css',
      'assets/vendor-phaser-0RJB29YE.js',
      'assets/workbox-window.prod.es5-BqEJf4Xk.js',
      'assets/press-start-2p-latin-400-normal-_wFEWmAB.woff2',
      'assets/scene-homebase-DhJW_-Ss.js',
    ])
      expect(hashed).toMatch(HASHED_BUILD_OUTPUT);
    for (const media of [
      'assets/sprites/fx/fx_atlas.png',
      'assets/sprites/fx/fx_atlas.json',
      'assets/sprites/traced/traced-atlas-0.png',
      'assets/portraits/pc98/atlas/32.png',
      'assets/sprites/nodes/weathered-nodes.png',
      'index.html',
      'data/weapons.json',
    ])
      expect(media).not.toMatch(HASHED_BUILD_OUTPUT);
  });

  it('every precached game file carries a content revision (md5 of its bytes)', () => {
    const atlasEntries = [...precache].filter(([url]) => url.startsWith('assets/'));
    expect(atlasEntries.length).toBeGreaterThanOrEqual(8);
    for (const [url, revision] of precache)
      expect({ url, revision }).toEqual({ url, revision: md5(join(PUBLIC, url)) });
  });

  it('precaching stays small: atlases only, no broad media globs', async () => {
    const { warnings } = await precacheFor(PUBLIC);
    // public/ holds no JS (Vite emits it at build), so only that glob may come up empty.
    // Any other warning is an atlas glob matching nothing or a file over the size cap.
    expect(warnings.filter((w) => !w.includes('"**/*.{js,css,html,woff,woff2}"'))).toEqual([]);
    const bytes = [...precache.keys()].reduce(
      (sum, url) => sum + readFileSync(join(PUBLIC, url)).length,
      0,
    );
    // data + icons + manifest + atlases (~3.8 MB today); the JS shell is added by the build.
    expect(bytes).toBeLessThan(6 * 1024 * 1024);
    expect([...precache.keys()].filter((u) => u.endsWith('.mp3'))).toEqual([]);
  });
});

describe('every shipped asset is served offline', () => {
  it('each file under public/ is precached or matched by a runtime cache route', () => {
    const uncovered = shipped.filter((f) => !coverage(f));
    expect(shipped.length).toBeGreaterThan(2000);
    expect(uncovered).toEqual([]);
  });

  it('runtime caches are large enough to hold every file they serve (no LRU loss)', () => {
    for (const route of RUNTIME_CACHE_ROUTES) {
      const served = shipped.filter((f) => coverage(f) === route.cacheName).length;
      expect({ cache: route.cacheName, fits: served <= route.maxEntries, served }).toEqual({
        cache: route.cacheName,
        fits: true,
        served,
      });
    }
  });
});

describe('BootScene and the deferred warmup', () => {
  for (const reducedPreload of [false, true]) {
    it(`every queued URL exists and is covered (reducedPreload=${reducedPreload})`, () => {
      const calls = runBootPreload({ reducedPreload });
      expect(calls.length).toBeGreaterThan(200);
      const problems = [];
      for (const call of calls)
        for (const url of call.urls) {
          const path = sitePath(url);
          if (!shipped.includes(path)) problems.push({ missing: path, key: call.key });
          else if (!coverage(path)) problems.push({ uncovered: path, key: call.key });
        }
      expect(problems).toEqual([]);
    });

    it(`every atlas ships as one precached, revisioned set (reducedPreload=${reducedPreload})`, () => {
      const atlases = runBootPreload({ reducedPreload }).filter((c) => c.type === 'atlas');
      // fx, node medals, four PC-98 sizes (traced pages are checked below).
      expect(atlases.map((a) => a.key)).toEqual(
        expect.arrayContaining(['fx_atlas', 'weathered_nodes', 'pc98-portraits-32']),
      );
      for (const atlas of atlases) {
        const halves = [atlas.urls[0]];
        // Frame data is either a JSON URL (fetched) or an object compiled into the
        // precached JS bundle; either way the image must be precached with it.
        if (typeof atlas.data === 'string') halves.push(atlas.data);
        else expect(atlas.data?.frames, atlas.key).toBeTruthy();
        for (const url of halves) {
          const path = sitePath(url);
          expect({ key: atlas.key, path, revision: precache.get(path) }).toEqual({
            key: atlas.key,
            path,
            revision: md5(join(PUBLIC, path)),
          });
        }
      }
    });
  }

  it('traced sprite atlas pages (frames in the bundled manifest) are precached', () => {
    const pages = runBootPreload({ reducedPreload: false }).filter((c) =>
      c.key.startsWith('traced-page-'),
    );
    expect(pages.length).toBeGreaterThanOrEqual(1);
    for (const page of pages) expect(precache.has(sitePath(page.urls[0]))).toBe(true);
  });

  it('pc98AtlasUrl agrees with the atlas URLs BootScene loads', () => {
    const atlases = runBootPreload({ reducedPreload: false }).filter((c) =>
      c.key.startsWith('pc98-portraits-'),
    );
    expect(atlases.length).toBe(PC98_MANIFEST.atlas.sizes.length);
    for (const size of PC98_MANIFEST.atlas.sizes)
      expect(precache.has(sitePath(pc98AtlasUrl(size)))).toBe(true);
  });
});

describe('lazy loaders', () => {
  function expectCovered(urls) {
    const problems = urls
      .map((url) => sitePath(url))
      .filter((path) => !shipped.includes(path) || !coverage(path));
    expect(problems).toEqual([]);
  }

  it('PC-98 figures, plates and baked renders (variant faces load lazily)', () => {
    const urls = [];
    for (const [id, entry] of Object.entries(PC98_MANIFEST.portraits)) {
      // Variant faces have no atlas frame and no baked render: only per-size figures.
      if (Number.isInteger(entry.frame)) urls.push(pc98BakedUrl(id));
      for (const size of PC98_SIZES) urls.push(pc98FigureUrl(id, size));
    }
    for (const faction of PC98_MANIFEST.factions)
      for (const size of PC98_SIZES) urls.push(pc98PlateUrl(faction, size));
    expect(urls.length).toBeGreaterThan(500);
    expectCovered(urls);
  });

  it('rebuilt portraits (classic mode, ceremonies, home base)', () => {
    const urls = Object.keys(rebuiltPortraitManifest)
      .map((id) => rebuiltPortraitUrl(id, 'classic'))
      .filter(Boolean);
    expect(urls.length).toBeGreaterThan(10);
    expectCovered(urls);
  });

  it('weathered terrain sheets', async () => {
    const urls = [];
    vi.stubGlobal(
      'Image',
      class {
        set src(value) {
          urls.push(value);
          queueMicrotask(() => this.onload?.());
        }
      },
    );
    await loadWeatheredArt('./assets/terrain/weathered');
    expect(urls.length).toBeGreaterThanOrEqual(6);
    expectCovered(urls);
  });

  it('every music track', () => {
    const keys = new Set();
    const collect = (v) => {
      if (typeof v === 'string') keys.add(v);
      else if (Array.isArray(v)) v.forEach(collect);
      else if (v && typeof v === 'object') Object.values(v).forEach(collect);
    };
    collect(MUSIC);
    const urls = [...keys].flatMap((k) => AudioManager.prototype._getMusicSources.call({}, k));
    expect(urls.length).toBeGreaterThan(20);
    expectCovered(urls);
  });

  it('every assets/ path written in src resolves to shipped, covered files', () => {
    const sources = walk(join(ROOT, 'src')).filter((f) => /\.(js|css|html)$/.test(f));
    sources.push(join(ROOT, 'index.html'));
    const prefixes = new Set();
    for (const file of sources) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/assets\/[A-Za-z0-9_./-]*[A-Za-z0-9_/-]/g))
        prefixes.add(m[0].replace(/\/+$/, '/'));
    }
    const problems = [];
    for (const prefix of prefixes) {
      const files = shipped.filter((f) => f.startsWith(prefix));
      if (files.length === 0) problems.push({ prefix, shipped: 0 });
      for (const f of files) if (!coverage(f)) problems.push({ prefix, uncovered: f });
    }
    expect(prefixes.size).toBeGreaterThan(10);
    expect(problems).toEqual([]);
  });
});

describe('upgrades never pair an old atlas image with new frame data', () => {
  // Workbox precaches `url + revision`; a new worker installs every entry whose
  // revision changed beside the old ones, and swaps the whole set (with the JS) on
  // activation. An entry whose revision is null is keyed by URL alone and is NOT
  // refetched when its bytes change — that was the trap for assets/** files.
  function build(dir, { png, json }) {
    mkdirSync(join(dir, 'assets/sprites/fx'), { recursive: true });
    writeFileSync(join(dir, 'assets/sprites/fx/fx_atlas.png'), png);
    writeFileSync(join(dir, 'assets/sprites/fx/fx_atlas.json'), json);
    writeFileSync(join(dir, 'index.html'), '<!doctype html>');
  }

  it('changing an atlas changes the revision of its image and its frame data together', async () => {
    const root = mkdtempSync(join(tmpdir(), 'er-atlas-'));
    try {
      const png = readFileSync(join(PUBLIC, 'assets/sprites/fx/fx_atlas.png'));
      const json = readFileSync(join(PUBLIC, 'assets/sprites/fx/fx_atlas.json'), 'utf8');
      const frames = JSON.parse(json);
      build(join(root, 'a'), { png, json });
      // Version B: repacked atlas — new pixels and a different frame table.
      frames.meta = { ...(frames.meta || {}), repack: 'b' };
      build(join(root, 'b'), {
        png: Buffer.concat([png, Buffer.from('repacked')]),
        json: JSON.stringify(frames),
      });
      const a = (await precacheFor(join(root, 'a'))).entries;
      const b = (await precacheFor(join(root, 'b'))).entries;
      for (const url of ['assets/sprites/fx/fx_atlas.png', 'assets/sprites/fx/fx_atlas.json']) {
        expect(a.get(url)).toMatch(/^[0-9a-f]{32}$/);
        expect(b.get(url)).toMatch(/^[0-9a-f]{32}$/);
        expect(b.get(url)).not.toBe(a.get(url));
      }

      // The vite-plugin-pwa default (/^assets\//) would have left both unrevisioned:
      // an installed worker would keep serving version A's bytes to version B's code.
      const pluginDefault = (
        await precacheFor(join(root, 'b'), { dontCacheBustURLsMatching: /^assets\// })
      ).entries;
      expect(pluginDefault.get('assets/sprites/fx/fx_atlas.png')).toBeNull();
      expect(pluginDefault.get('assets/sprites/fx/fx_atlas.json')).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
