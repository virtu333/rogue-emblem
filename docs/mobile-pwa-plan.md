# Mobile Strategy — Decision & Sequencing

**Date:** 2026-06-19
**Status:** Active. Supersedes the conflicting resolution guidance in `docs/mobile-controls-spec.md` and `docs/ios-port-spec.md`.

## Decision: mobile-web-first, then wrap

The earlier `docs/ios-port-spec.md` framed iOS as a packaging problem (wrap `dist/` in Capacitor → App Store). That is the right *wrapper* choice (Capacitor over a native rewrite), but the wrong *sequencing*. The actual problem is mobile **UX quality**, which Capacitor does nothing for — it ships the same WebView experience to a higher-stakes, slower-to-iterate channel.

So: **make mobile web genuinely first-class first, prove it on the free/instant channel, then wrap with Capacitor.** The wrapper is the easy ~20%; the mobile UX is the hard ~80% and benefits mobile-web users too.

`docs/mobile-controls-spec.md` already recorded this instinct ("deferred until mobile web stable"). This doc makes it the standing decision.

## The biggest lever: screen real estate (DONE — this change)

Because the game renders 640×480 with `Phaser.Scale.FIT`, **height is the binding constraint on a phone in landscape**, so every pixel the browser chrome steals shrinks the *entire* canvas (width included), not just the top strip. Removing the chrome is therefore the single highest-leverage mobile change — and it does **not** require the App Store.

A standalone **PWA** (Add to Home Screen) runs in a chrome-less WKWebView — identical fullscreen real estate to a Capacitor app. On this axis, Capacitor buys nothing over a home-screen PWA; the App Store only adds discoverability and a "real" install.

### What shipped
- `public/manifest.webmanifest` — `display: standalone`, `display_override: [fullscreen,…]`, `orientation: landscape`, dark theme.
- Apple `<head>` meta tags in `index.html` (both `apple-mobile-web-app-capable` and standardized `mobile-web-app-capable`, `black` status bar, title, `apple-touch-icon`).
- App icons generated from `tools/icon-src/app-icon*.svg` via `npm run gen:icons` (sharp) → `public/icons/` (180 apple-touch, 192, 512, 512-maskable).
- `public/_headers` — forces `application/manifest+json` MIME on Netlify; 1-day revalidating cache for icons (stable filenames, so not `immutable`).
- Removed the "Best played on desktop | Not optimized for mobile" banner on mobile (canvas gate in `TitleScene.js` via `getStartupFlags().isMobile`; CSS `@media (pointer: coarse)` for the auth-overlay `.desktop-note`).

### iOS reality (set expectations)
- ✅ Standalone landscape with **no Safari toolbar** — the real-estate win.
- ⚠️ A thin **status bar stays** (solid `black` bar, content below it) — iOS has no true fullscreen for home-screen PWAs.
- ⚠️ iOS **ignores** manifest `orientation` lock → the existing `#rotate-prompt` must stay (it does).
- ⚠️ **No install prompt** on iOS — install is manual via Share → Add to Home Screen.
- ⚠️ iOS can evict installed-PWA `localStorage` under storage pressure — Supabase cloud backup mitigates, but treat save durability as a known risk (relevant to the resolution + Capacitor steps below).
- ✅ Android Chrome honors `display_override: fullscreen` + `orientation: landscape` and shows an install prompt — fuller experience.

### Verify after deploy
Netlify's SPA catch-all (`public/_redirects: /* → /index.html 200`) must not shadow the manifest/icons. Real files win over the catch-all, but confirm: `GET /manifest.webmanifest` returns JSON with `application/manifest+json` (not the HTML shell), and `GET /icons/*.png` returns `image/png`.

## Offline play (service worker) — SHIPPED

The manifest made the app installable + fullscreen but not offline; a **service worker** now caches the app shell + data so the installed PWA (and mobile Safari / Android Chrome) cold-starts with no network. Game logic + saves were already offline-friendly (localStorage-first, cloud sync no-ops offline, "Play offline (no cloud saves)" boot path in `src/main.js`), so the only gap was asset caching — now closed. **Offline does not require a native app.**

Implemented with **`vite-plugin-pwa`** (Workbox `generateSW`), wired in `vite.config.js`. Two-tier strategy driven by the asset-size split (236 MB media vs 349 KB data):
- **Precache** (44 entries, ~3 MB): `index.html`, hashed JS/CSS chunks (incl. `vendor-phaser`), all `data/*.json` (23, required for boot), app icons, manifest. Content-hash revisioned → atomic updates on deploy.
- **Runtime cache, StaleWhileRevalidate** (never precached): `/assets/{sprites,sprites-v1,portraits}/*` (images) and `/assets/audio/*` (music + SFX). Served instantly from cache (offline too) and revalidated in the background. SWR rather than CacheFirst because these filenames are **stable, not content-hashed** — CacheFirst would pin a replaced asset until expiry; SWR refreshes it on the next online load. `purgeOnQuotaError`, capped entries; `maxAge` bounds cache GC, not staleness.

Config notes:
- `manifest: false` — keeps the existing hand-written `public/manifest.webmanifest`; the plugin owns only the SW.
- `registerType: 'prompt'` + `clientsClaim`, **no `skipWaiting`** (+ `cleanupOutdatedCaches`) — a new deploy's worker stays in `waiting` and activates only on the next cold start, so it never swaps the code-split build under a live run (which would 404 an old lazy chunk like `scene-battle` after `cleanupOutdatedCaches` purges it). `clientsClaim` is safe here (acts only at the now-deferred activation) and preserves offline-after-first-visit by controlling the first page load. `public/_headers` sets `no-cache` on `/sw.js` + `/registerSW.js` so the *update check* is instant; *activation* still waits for a full restart. No update UI is wired (nothing imported into `src/`).
- `injectRegister: 'auto'` injects registration into `index.html` at build (nothing imported into `src/` → the 4155-test Vitest suite is unaffected).
- **`base: './'` gotcha (verified OK):** registration resolves to `/sw.js` (root scope), precache URLs are root-relative, `navigateFallback: 'index.html'` — all correct because the site is served from the Netlify root. Empirically confirmed via a live SW in a headless browser: it registered, activated, claimed the page, and precached all 44 entries (index.html + 23 data + 14 chunks + 4 icons + manifest, 0 media).
- **Key trap avoided:** Vite's JS chunks and the game's media both live under `dist/assets/`, so precache globs match only `js/css/html` (+ `data`, `icons`); a broad `**/*.png` would have pulled in the 115 MB sprite set.

Caveats: the first offline session lacks any asset never fetched while online (cache-first-not-precached → graceful: missing image = Phaser fallback, missing audio = silence). iOS can evict PWA caches under storage pressure → offline is best-effort there (durable offline = the eventual Capacitor build, which bundles assets). Kill-switch if ever needed: ship `VitePWA({ selfDestroying: true })` once to unregister all clients.

## Open decision (NEXT): base resolution

Still unresolved and the #1 remaining driver of the "second class" feel. The two old specs contradict:
- `mobile-controls-spec.md`: keep 640×480, improve readability via landscape + side panels.
- `ios-port-spec.md`: bump base to 960×640.

Going fullscreen first (this change) was deliberate: it gives the **real shipping viewport** to judge the resolution tradeoff against, instead of the chrome-shrunk one. Recommended next step: prototype 960×640 on a branch and compare on a real phone before committing (it touches hardcoded scene coordinates broadly, so it's a real change, not a config flip).

## Later: Capacitor / App Store

Only after mobile web is something we'd defend. At that point the wrapper is the quick last step `ios-port-spec.md` describes. Re-confirm the Capacitor/iOS/Xcode version baseline against current docs at that time; pick one bundle ID and keep it consistent.
