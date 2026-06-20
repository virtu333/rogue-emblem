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

## Next: offline play (service worker) — flagged

The manifest makes the app installable + fullscreen but does **not** make it work offline — that needs a **service worker** to cache the app shell + assets. None exists yet (verified), so launching the installed PWA with no network currently fails to load the bundle.

The game logic + saves are already offline-friendly (localStorage-first, cloud sync no-ops offline, and the "Play offline (no cloud saves)" boot path in `src/main.js` with timeouts/background refetch). So the gap is asset caching + verifying the offline cold-start, not game logic.

Plan: `vite-plugin-pwa` (Workbox). Precache the shell (`index.html`, hashed JS/CSS, `public/data/*.json`); runtime-cache assets (`/assets/*` sprites/portraits/audio) **cache-first, not precached** — 38 music tracks + sprites are hundreds of MB. Verify offline cold-start reaches the "Play offline" path; handle cache versioning on deploy. iOS caveat: it can evict PWA caches under storage pressure, so offline is best-effort (the durable-offline answer for iOS is the eventual Capacitor build, which bundles assets). **Offline does not require a native app** — a service worker on this same web build covers mobile Safari, the installed PWA, and Android Chrome.

## Open decision (NEXT): base resolution

Still unresolved and the #1 remaining driver of the "second class" feel. The two old specs contradict:
- `mobile-controls-spec.md`: keep 640×480, improve readability via landscape + side panels.
- `ios-port-spec.md`: bump base to 960×640.

Going fullscreen first (this change) was deliberate: it gives the **real shipping viewport** to judge the resolution tradeoff against, instead of the chrome-shrunk one. Recommended next step: prototype 960×640 on a branch and compare on a real phone before committing (it touches hardcoded scene coordinates broadly, so it's a real change, not a config flip).

## Later: Capacitor / App Store

Only after mobile web is something we'd defend. At that point the wrapper is the quick last step `ios-port-spec.md` describes. Re-confirm the Capacitor/iOS/Xcode version baseline against current docs at that time; pick one bundle ID and keep it consistent.
