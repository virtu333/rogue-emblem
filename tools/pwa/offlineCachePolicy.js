// Service-worker cache policy — the single source for vite.config.js (workbox options)
// and the tests that prove every runtime asset is covered (tests/OfflineCachePolicy.test.js,
// tests/e2e/offline-atlas.spec.js). Pure data + helpers: no Vite, no workbox imports.
//
// Two tiers:
//
// 1. PRECACHE (installed atomically with each service worker, served cache-first):
//    the small app shell (hashed JS/CSS/fonts, index.html, data/*.json, icons,
//    manifest) PLUS every texture atlas — the atlas image and its frame data together.
//    An atlas is a versioned SET: fx_atlas.png + fx_atlas.json, and the node / traced /
//    PC-98 atlas pages whose frame tables are compiled into the (precached) JS bundle.
//    Precaching all halves in one worker means a page only ever sees the image and the
//    frames from the same deploy: an update installs the new pair beside the old one and
//    swaps both (and the JS) on activation; offline, the installed pair is served.
//    ~3.5 MB — boot-critical files BootScene / the deferred warmup load every launch.
//
// 2. RUNTIME (StaleWhileRevalidate, stable filenames): the ~2400 other sprite,
//    portrait, terrain images and the audio. Never precached (well over 100 MB).
//
// Revisions: vite-plugin-pwa defaults `dontCacheBustURLsMatching` to /^assets\//
// (Vite's hashed output dir) — but the game's own media also lives under assets/, so
// with that default a precached atlas gets `revision: null` and an update would KEEP
// the old bytes forever (workbox skips URLs already cached without a revision). Only
// Vite's flat, content-hashed files may skip revisioning.

/** Small, revisioned app shell (unchanged from the original precache list). */
export const APP_SHELL_GLOBS = Object.freeze([
  '**/*.{js,css,html,woff,woff2}',
  'data/*.json',
  'icons/*.png',
  'manifest.webmanifest',
]);

/**
 * Every texture atlas (image + frame data) the game loads. Relative to the build root.
 * Keep in sync with BootScene / assetWarmup; tests fail if an atlas escapes this list.
 */
export const ATLAS_PRECACHE_GLOBS = Object.freeze([
  // Combat FX: PNG + JSON frame table (Phaser atlas loaded from two URLs).
  'assets/sprites/fx/fx_atlas.{png,json}',
  // Node-map medals: frames are NODE_ART_RECTS in the JS bundle (also a CSS sprite).
  'assets/sprites/nodes/weathered-nodes.png',
  // Traced unit sprites: pages; frames in the bundled TracedSpriteManifest.json.
  'assets/sprites/traced/*.png',
  // PC-98 portrait atlases (one per size); frames from the bundled Pc98PortraitManifest.
  'assets/portraits/pc98/atlas/*.png',
]);

export const PRECACHE_GLOB_PATTERNS = Object.freeze([...APP_SHELL_GLOBS, ...ATLAS_PRECACHE_GLOBS]);

/**
 * Files whose URL already carries a content hash: Vite's flat build output
 * (`assets/<name>-<8 char hash>.<ext>`). Game media sits in subdirectories of assets/
 * and never matches, so it always gets an md5 revision.
 */
export const HASHED_BUILD_OUTPUT = /^assets\/[^/]+-[A-Za-z0-9_-]{8}\.[a-z0-9]+$/;

/** Runtime routes, in match order. `urlPattern` is tested against the absolute URL. */
export const RUNTIME_CACHE_ROUTES = Object.freeze([
  {
    // Sprites / portraits / weathered terrain sheets. StaleWhileRevalidate (not
    // CacheFirst) because these filenames are stable, not content-hashed: serve
    // instantly from cache (and offline), but revalidate in the background so a
    // replaced asset refreshes on the next online load. maxAge bounds cache GC, not
    // staleness. Atlas pages also match this pattern but are served by the precache
    // route, which workbox registers first.
    urlPattern: /\/assets\/(sprites|portraits|terrain)\/.*\.(png|jpe?g|webp|gif)$/i,
    cacheName: 'er-image-assets',
    // ~2450 image files ship under assets/{sprites,portraits,terrain} (2126 of them
    // PC-98 portrait renders: 6 sizes per face incl. the variant faces, plates, baked).
    // maxEntries must stay above the whole shipped set so LRU eviction never silently
    // drops a file from the offline cache (tests/OfflineCachePolicy.test.js enforces
    // it); purgeOnQuotaError is the real safety valve if disk quota is hit.
    maxEntries: 3200,
  },
  {
    // Music + SFX — same stable-filename reasoning as images.
    urlPattern: /\/assets\/audio\/.*\.(mp3|ogg|wav|m4a)$/i,
    cacheName: 'er-audio-assets',
    // 208 audio files with the composed soundtrack (#80): 49 music loops and layers,
    // 141 keyed ceremony stingers, 18 SFX. 400 leaves headroom for new tracks and
    // tonics; purgeOnQuotaError is the real safety valve.
    maxEntries: 400,
  },
]);

const SIXTY_DAYS = 60 * 24 * 60 * 60;

/** Workbox `runtimeCaching` entries built from RUNTIME_CACHE_ROUTES. */
export function workboxRuntimeCaching() {
  return RUNTIME_CACHE_ROUTES.map((route) => ({
    urlPattern: route.urlPattern,
    handler: 'StaleWhileRevalidate',
    options: {
      cacheName: route.cacheName,
      expiration: {
        maxEntries: route.maxEntries,
        maxAgeSeconds: SIXTY_DAYS,
        purgeOnQuotaError: true,
      },
      cacheableResponse: { statuses: [0, 200] },
    },
  }));
}

/**
 * The runtime cache that would serve `url` (absolute, or relative to the site root),
 * or null. Mirrors workbox's RegExpRoute, which tests the pattern against the full href.
 */
export function runtimeCacheFor(url) {
  const href = new URL(url, 'https://offline.invalid/').href;
  const route = RUNTIME_CACHE_ROUTES.find((r) => r.urlPattern.test(href));
  return route ? route.cacheName : null;
}
