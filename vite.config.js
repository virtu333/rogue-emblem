import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  publicDir: 'public',
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
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
        clientsClaim: true,
        skipWaiting: true,
        // SPA: navigations fall back to the cached shell, except real asset/data/SW paths.
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/assets\//, /^\/data\//, /\/sw\.js$/, /\/registerSW\.js$/],
        runtimeCaching: [
          {
            // Sprites / portraits — lazy, cached the first time they're fetched in play.
            urlPattern: /\/assets\/(sprites|sprites-v1|portraits)\/.*\.(png|jpe?g|webp|gif)$/i,
            handler: 'CacheFirst',
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
            // Music + SFX — lazy, cache-first.
            urlPattern: /\/assets\/audio\/.*\.(mp3|ogg|wav|m4a)$/i,
            handler: 'CacheFirst',
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
