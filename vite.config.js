import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  publicDir: 'public',
  plugins: [
    VitePWA({
      // 'prompt' (not 'autoUpdate') so a freshly deployed worker does NOT skipWaiting and
      // take over a page still running the old code-split build. It stays in the waiting
      // state, avoiding a mid-run dynamic-import failure (cleanupOutdatedCaches purges the
      // old lazy chunks the live page still needs). src/main.js imports registerSW from
      // 'virtual:pwa-register' and, on onNeedRefresh, shows a passive DOM update toast; the
      // user's RESTART tap calls updateSW(true) to skipWaiting + reload THIS client only.
      // With injectRegister:'auto' that in-bundle import means the plugin no longer injects
      // its own registerSW.js — registration happens exactly once, from main.js.
      registerType: 'prompt',
      injectRegister: 'auto',
      // Keep the existing hand-written public/manifest.webmanifest (+ its <link> in
      // index.html). The plugin only owns the service worker, not the manifest.
      manifest: false,
      // No service worker in dev — avoids stale-cache headaches while iterating.
      devOptions: { enabled: false },
      workbox: {
        // Precache the small, essential, revisioned app shell only. The game's
        // 236 MB of media (sprites/audio/portraits) is runtime-cached below, never
        // precached. NOTE: do NOT add png/mp3 globs here — Vite's JS chunks and the
        // game's media both live under dist/assets/, so a broad **/*.png would pull
        // in the 115 MB sprite set. data/*.json (349 KB) is required for boot.
        globPatterns: ['**/*.{js,css,html}', 'data/*.json', 'icons/*.png', 'manifest.webmanifest'],
        // Headroom for the vendor-phaser chunk (>2 MB default cap).
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        // clientsClaim lets the FIRST-installed worker control the initial page load, so
        // offline works after the very first visit. skipWaiting is intentionally NOT set
        // (defaults false): updates wait for old clients to close before activating, so a
        // new deploy never swaps the build under a live run — see the registerType note.
        clientsClaim: true,
        // SPA: navigations fall back to the cached shell, except real asset/data/SW paths.
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/assets\//, /^\/data\//, /\/sw\.js$/, /\/registerSW\.js$/],
        runtimeCaching: [
          {
            // Sprites / portraits. StaleWhileRevalidate (not CacheFirst) because these
            // filenames are stable, not content-hashed: serve instantly from cache (and
            // offline), but revalidate in the background so a replaced asset refreshes on
            // the next online load instead of being pinned until the 60-day expiry. maxAge
            // now bounds cache GC, not staleness.
            urlPattern: /\/assets\/(sprites|sprites-v1|portraits)\/.*\.(png|jpe?g|webp|gif)$/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'er-image-assets',
              expiration: {
                // ~630 image files today under assets/{sprites,sprites-v1,portraits};
                // the set grew ~95/month during recent sprite upgrades. 1200 leaves
                // headroom through the roster/FX roadmap so LRU eviction never
                // silently drops sprites from the offline cache. purgeOnQuotaError
                // below is the real safety valve if disk quota is actually hit.
                maxEntries: 1200,
                maxAgeSeconds: 60 * 24 * 60 * 60,
                purgeOnQuotaError: true,
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Google Fonts stylesheet ('Press Start 2P' — the game's only font). Without
            // this rule an offline cold start past the CSS's 24h HTTP max-age falls back
            // to a system font and misaligns every text layout budgeted for this face.
            // StaleWhileRevalidate: the css2 URL is stable but its payload varies by UA.
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'er-google-fonts-css',
              expiration: { maxEntries: 4, maxAgeSeconds: 365 * 24 * 60 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // The font binaries themselves are immutable (hashed URLs) — CacheFirst.
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'er-google-fonts-webfonts',
              expiration: { maxEntries: 8, maxAgeSeconds: 365 * 24 * 60 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Music + SFX — same stable-filename reasoning as images: StaleWhileRevalidate
            // serves from cache instantly/offline and refreshes a replaced track in the
            // background.
            urlPattern: /\/assets\/audio\/.*\.(mp3|ogg|wav|m4a)$/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'er-audio-assets',
              expiration: {
                // 57 audio files today (music + SFX); 120 leaves matching headroom
                // for new tracks. purgeOnQuotaError is the real safety valve.
                maxEntries: 120,
                maxAgeSeconds: 60 * 24 * 60 * 60,
                purgeOnQuotaError: true,
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  test: {
    // .claude/** holds per-session git worktrees — their duplicated test
    // trees must not run (or fail) as part of this repo's own suite.
    exclude: ['tests/e2e/**', 'node_modules/**', '.claude/**'],
    coverage: {
      thresholds: {
        lines: 70,
      },
    },
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id) return;
          if (id.includes('node_modules/phaser')) return 'vendor-phaser';
          if (id.includes('node_modules/@supabase')) return 'vendor-supabase';
          if (id.includes('/src/scenes/BattleScene.js')) return 'scene-battle';
          if (id.includes('/src/scenes/NodeMapScene.js')) return 'scene-nodemap';
          if (id.includes('/src/scenes/HomeBaseScene.js')) return 'scene-homebase';
          if (id.includes('/src/scenes/TitleScene.js')) return 'scene-title';
        },
      },
    },
  },
  server: {
    port: 3000,
    open: true,
  },
});
