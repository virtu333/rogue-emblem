import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import {
  HASHED_BUILD_OUTPUT,
  PRECACHE_GLOB_PATTERNS,
  workboxRuntimeCaching,
} from './tools/pwa/offlineCachePolicy.js';

// Cache policy (precache list, revisioning, runtime routes) lives in
// tools/pwa/offlineCachePolicy.js so tests can prove every runtime asset is covered
// and every texture atlas ships as one versioned set. Exported for those tests.
export const pwaWorkboxOptions = {
  // Precache the small revisioned app shell plus every texture atlas (image and
  // frame data together, ~3.5 MB). The rest of the game's media (well over
  // 100 MB of sprites/audio/portraits) is runtime-cached, never precached.
  // NOTE: do NOT add broad png/mp3 globs — Vite's JS chunks and the game's media
  // both live under dist/assets/, so **/*.png would pull in the whole sprite set.
  globPatterns: [...PRECACHE_GLOB_PATTERNS],
  // Only Vite's flat content-hashed files skip revisioning. The plugin default
  // (/^assets\//) would also cover the game's atlases and pin old bytes forever.
  dontCacheBustURLsMatching: HASHED_BUILD_OUTPUT,
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
  runtimeCaching: workboxRuntimeCaching(),
};

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
      workbox: pwaWorkboxOptions,
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
    // Agent worktrees and local tooling live under .claude/; watching them
    // exhausts the OS file-watcher limit and crashes the dev server.
    watch: { ignored: ['**/.claude/**', '**/References/**'] },
  },
});
