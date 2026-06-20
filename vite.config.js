import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  publicDir: 'public',
  plugins: [
    VitePWA({
      // 'prompt' (not 'autoUpdate') so a freshly deployed worker does NOT skipWaiting and
      // take over a page still running the old code-split build. It stays in the waiting
      // state and activates on the next cold start — once no old client (whose lazy chunks
      // cleanupOutdatedCaches has since purged) is around — avoiding a mid-run dynamic-import
      // failure. No update UI is wired (nothing imported into src/); the update simply
      // applies on the next full app restart.
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
                maxEntries: 800,
                maxAgeSeconds: 60 * 24 * 60 * 60,
                purgeOnQuotaError: true,
              },
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
                maxEntries: 80,
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
    exclude: ['tests/e2e/**', 'node_modules/**'],
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
