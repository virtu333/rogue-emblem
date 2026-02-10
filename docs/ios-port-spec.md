# Rogue Emblem — iOS Port Specification

**Version:** 1.0
**Date:** 2026-02-09
**Status:** Draft
**Owner:** Product/Engineering

---

## Executive Summary

This document outlines the requirements, technical approach, and implementation plan for porting Rogue Emblem from a web-based game to a native iOS application distributed via the Apple App Store.

### Goals
- Enable iOS users to play Rogue Emblem natively on iPhone and iPad
- Maintain feature parity with web version (cloud saves, Supabase auth)
- Achieve 60 FPS gameplay on iPhone 12 and newer
- Launch on App Store within Q2 2026

### Non-Goals (v1.0)
- Android port (separate initiative)
- iPad-specific UI optimizations (use iPhone layout scaled up)
- Offline AI opponents (web version also requires connection)
- In-App Purchases (monetization deferred to v1.1)

---

## Current State Analysis

### Technology Stack
- **Engine:** Phaser.js 3.90 (HTML5 Canvas + WebGL)
- **Language:** JavaScript (ES modules)
- **Build:** Vite (static bundle)
- **Backend:** Supabase (PostgreSQL + Auth)
- **Resolution:** 640×480 canvas (scales via Phaser.Scale.FIT)
- **Input:** Mouse + keyboard only
- **Audio:** Web Audio API (21 music tracks, 18 SFX)
- **Storage:** localStorage (3 save slots + settings)

### Web Version Limitations for Mobile
1. **Input:** No touch controls—relies on ESC, D, R, arrow keys, right-click
2. **Resolution:** 640×480 too small for phones (becomes ~390×293 on iPhone 13)
3. **Orientation:** 4:3 landscape awkward on portrait-first devices
4. **Performance:** Unknown—never tested in iOS WebView
5. **Safe Areas:** No handling for notch/home indicator/Dynamic Island

---

## Technical Approach

### Option 1: Capacitor (Recommended)

**What:** Wrap existing web build in native iOS container using [Capacitor](https://capacitorjs.com/).

**Pros:**
- ✅ Minimal code changes—reuse 100% of game logic
- ✅ Phaser.js proven to work in WKWebView
- ✅ Supabase SDK works natively (REST API calls)
- ✅ localStorage maps to native iOS storage
- ✅ Fastest time-to-market (~4-6 weeks)
- ✅ Ionic team maintains Capacitor—good ecosystem
- ✅ Can use native iOS plugins (haptics, GameCenter, notifications)

**Cons:**
- ⚠️ WebView performance ceiling (~10-15% slower than native)
- ⚠️ Larger app size (~15-20MB for WebView overhead)
- ⚠️ Still need to implement touch controls (game logic issue, not wrapper)

**Technical Requirements:**
```bash
npm install @capacitor/core @capacitor/cli @capacitor/ios
npx cap init "Rogue Emblem" "com.rogueemblem.app"
npx cap add ios
npm run build
npx cap copy
npx cap open ios  # Opens Xcode
```

**Capacitor Config:**
```json
{
  "appId": "com.rogueemblem.app",
  "appName": "Rogue Emblem",
  "webDir": "dist",
  "server": {
    "hostname": "app.rogueemblem.com",
    "iosScheme": "capacitor"
  },
  "ios": {
    "contentInset": "always",
    "limitsNavigationsToAppBoundDomains": true
  }
}
```

### Option 2: Cordova

**What:** Similar to Capacitor but older technology.

**Pros:**
- ✅ Mature ecosystem (11+ years old)
- ✅ More plugins available

**Cons:**
- ❌ Worse performance than Capacitor
- ❌ Config more complex (XML-based)
- ❌ Declining community support (Ionic moved to Capacitor)

**Verdict:** Skip in favor of Capacitor.

### Option 3: Native Swift Rewrite

**What:** Rewrite entire game in Swift using SpriteKit or Metal.

**Pros:**
- ✅ Best possible performance
- ✅ Native iOS feel
- ✅ Smaller app size

**Cons:**
- ❌ 6-9 months development time (vs. 4-6 weeks)
- ❌ Lose web version unless maintained separately
- ❌ Requires iOS engineering expertise
- ❌ Supabase integration more complex (no JS SDK)

**Verdict:** Not viable for initial launch. Revisit if WebView performance inadequate.

---

## Recommended Approach: Capacitor

### Why Capacitor Wins
1. **Speed:** 90% of work is touch controls (needed for web anyway)
2. **Risk:** Phaser + Capacitor is proven (see [Phaser iOS games](https://phaser.io/examples/v3/category/mobile))
3. **Maintenance:** Single codebase for web + iOS
4. **Fallback:** If performance issues found, can migrate to native later

---

## Feature Gaps & Requirements

### Must-Have for iOS v1.0

#### 1. Touch Controls (Critical)
**Problem:** Game requires keyboard—iOS has none.

**Solution:** Implement touch equivalents for all inputs:

| Desktop Input | iOS Equivalent | Implementation |
|---------------|----------------|----------------|
| Click tile | Tap tile | ✅ Already works (pointer events) |
| Right-click unit | Long-press unit (800ms) | Add `holdDelay` to Grid.js |
| ESC (pause/back) | Floating ⚙️ button (bottom-right) | New UI component |
| D (danger zone) | Floating 🎯 button (top-right) | New UI component |
| R (roster overlay) | Floating 👥 button (top-right) | New UI component |
| Arrow keys (tabs) | Swipe left/right OR visible ◄ ► buttons | Detect swipe gestures |
| Space (confirm) | Tap highlighted button | ✅ Already works |

**Acceptance Criteria:**
- [ ] All game functions accessible without keyboard
- [ ] Tutorial updated to show touch gestures
- [ ] Touch buttons scale with device resolution (min 60×60 logical px)

#### 2. Orientation Lock (Critical)
**Problem:** Game is 4:3 landscape, phones default to portrait.

**Solution:**
- Lock to landscape via `info.plist`:
  ```xml
  <key>UISupportedInterfaceOrientations</key>
  <array>
    <string>UIInterfaceOrientationLandscapeLeft</string>
    <string>UIInterfaceOrientationLandscapeRight</string>
  </array>
  ```
- Show rotation prompt if user tries portrait (overlay in index.html)

**Acceptance Criteria:**
- [ ] App only runs in landscape
- [ ] Smooth rotation between landscape-left/right

#### 3. Safe Area Handling (Critical)
**Problem:** iPhone notch/Dynamic Island/home indicator overlap game canvas.

**Solution:**
- Use CSS `env(safe-area-inset-*)` to pad game container:
  ```css
  #game-container {
    padding-top: env(safe-area-inset-top);
    padding-bottom: env(safe-area-inset-bottom);
    padding-left: env(safe-area-inset-left);
    padding-right: env(safe-area-inset-right);
  }
  ```
- Test on iPhone 14 Pro (Dynamic Island) + iPhone SE (no notch)

**Acceptance Criteria:**
- [ ] No UI elements obscured by notch/home indicator
- [ ] Touch buttons positioned in safe zone

#### 4. Resolution Scaling (Critical)
**Problem:** 640×480 canvas too small—text unreadable.

**Options:**
- **A. Increase base resolution** to 960×640 (1.5× scale)
  - Pros: Larger fonts, better readability
  - Cons: Need higher-res assets, more GPU load
- **B. Use `Phaser.Scale.RESIZE`** to fill screen dynamically
  - Pros: Maximizes screen usage
  - Cons: Need responsive UI layouts (complex)
- **C. Use `Phaser.Scale.ENVELOP`** (scale up, crop edges)
  - Pros: Simple, fills screen
  - Cons: May crop UI at edges

**Recommendation:** Start with **960×640 base resolution** + `FIT` mode. Test on iPhone SE (4.7", smallest target) and iPhone 14 Pro Max (6.7", largest).

**Acceptance Criteria:**
- [ ] 12px fonts readable without squinting
- [ ] Tap targets ≥44×44 pts (Apple HIG)
- [ ] Tested on iPhone SE (2nd gen) minimum

#### 5. Performance Optimization (High Priority)
**Problem:** Unknown if Phaser maintains 60 FPS in WKWebView.

**Solution:**
- Enable WebGL renderer (already default in Phaser config)
- Profile on real devices:
  - iPhone 12 (target minimum: A14 chip)
  - iPhone 15 Pro (120Hz ProMotion—test for smoothness)
- Optimize if FPS < 60:
  - Reduce particle counts
  - Disable scanline overlay on low-end devices
  - Use sprite atlases (already doing for characters)

**Acceptance Criteria:**
- [ ] 60 FPS sustained during battle on iPhone 12
- [ ] No frame drops during scene transitions
- [ ] Battery drain < 10%/hour during gameplay

#### 6. Audio Handling (High Priority)
**Problem:** iOS requires user gesture to start audio (same as web, but stricter).

**Solution:**
- Already handled in `main.js` (`unlockAudio()` on first interaction)
- Verify works in Capacitor WebView
- Add iOS-specific audio session config:
  ```javascript
  // capacitor.config.json
  "plugins": {
    "Keyboard": { "resize": "native" },
    "StatusBar": { "style": "dark" },
    "SplashScreen": { "launchShowDuration": 0 }
  }
  ```

**Acceptance Criteria:**
- [ ] Music starts after login (first tap)
- [ ] SFX work without delay
- [ ] Audio respects iOS silent switch
- [ ] Audio pauses when app backgrounds

#### 7. App Store Assets (Critical)
**Requirements:**
- [ ] App icon (1024×1024 PNG, no alpha, no rounded corners)
- [ ] Launch screen (storyboard or static image)
- [ ] Screenshots (6.7", 6.5", 5.5" sizes required)
  - 2× iPhone 15 Pro Max landscape screenshots (2796×1290)
  - Optional: iPad screenshots (deferred to v1.1)
- [ ] Privacy policy URL (required for Supabase data collection)
- [ ] App description (170 chars subtitle, 4000 chars description)
- [ ] Age rating (ESRB: Everyone 10+ for fantasy violence)

#### 8. Cloud Saves & Auth (High Priority)
**Current:** Supabase REST API + localStorage.

**iOS Changes:**
- Verify Supabase JS SDK works in Capacitor (should be fine)
- Test RLS policies from iOS IP addresses
- Add iCloud backup exclusion for localStorage (avoid conflicts):
  ```javascript
  // Use Capacitor Preferences plugin instead of raw localStorage
  import { Preferences } from '@capacitor/preferences';
  ```

**Acceptance Criteria:**
- [ ] Login/register works
- [ ] Cloud saves sync on launch
- [ ] Offline mode works (localStorage fallback)
- [ ] No data loss during app kill/restart

---

## Out of Scope (v1.0)

### Deferred to v1.1+
- **In-App Purchases:** No monetization in initial launch (free app)
- **Game Center Integration:** No leaderboards/achievements
- **Haptic Feedback:** Nice-to-have, not critical
- **iPad Optimization:** Use iPhone layout scaled up (Capacitor handles this)
- **Push Notifications:** No marketing/retention features yet
- **Localization:** English-only launch
- **Dark Mode Support:** Game already has fixed dark theme

### Will Not Implement
- **Android Port:** Separate project (Capacitor makes this easier later)
- **Apple Watch Companion:** Not applicable to game type
- **SharePlay:** Multiplayer not in roadmap

---

## Implementation Plan

### Phase 1: Foundation (Week 1-2)
**Goal:** Capacitor wrapper + basic build pipeline.

**Tasks:**
1. Install Capacitor + iOS platform (`npx cap add ios`)
2. Configure `capacitor.config.json` (bundle ID, app name, schemes)
3. Create Xcode project (`npx cap open ios`)
4. Set up iOS signing & provisioning profile (requires Apple Developer account)
5. Build web bundle → copy to iOS → run on simulator
6. Test basic functionality (title screen, login, battle)

**Success Criteria:**
- [ ] App launches in iOS Simulator
- [ ] Web build displays correctly in WKWebView
- [ ] No console errors in Safari Web Inspector

**Risks:**
- Apple Developer account approval (can take 24-48 hours)
- Code signing issues (mitigate: use automatic signing initially)

---

### Phase 2: Touch Controls (Week 3-4)
**Goal:** Replace all keyboard shortcuts with touch equivalents.

**Tasks:**
1. **Long-press for right-click:**
   - Add `holdDelay: 800` to Grid.js `setInteractive()`
   - Fire `pointerdown-hold` event after 800ms
   - Show unit inspection panel on hold
   - Show enemy range on hold (enemy units)

2. **Floating action buttons:**
   - Create `MobileControls.js` UI component
   - Add buttons: ⚙️ (ESC), 🎯 (danger zone), 👥 (roster)
   - Position in safe area (check `env(safe-area-inset-*)`)
   - Scale with device resolution (min 60×60 logical px)
   - Depth 950 (above all game UI)

3. **Tab navigation:**
   - Option A: Add visible ◄ ► buttons to tabbed UIs
   - Option B: Swipe gesture detection (left/right)
   - Test both, choose based on usability

4. **Tutorial updates:**
   - Replace "Press ESC" → "Tap ⚙️ button"
   - Replace "Press D" → "Tap 🎯 button"
   - Add "Long-press unit for details"

**Success Criteria:**
- [ ] Can complete full run without keyboard
- [ ] All UI screens accessible
- [ ] Touch targets ≥44×44 pts

**Risks:**
- Long-press conflicts with scroll (mitigate: disable scroll during hold)
- Floating buttons obstruct gameplay (mitigate: semi-transparent, draggable?)

---

### Phase 3: Resolution & Performance (Week 5)
**Goal:** Optimize for iOS screen sizes and test performance.

**Tasks:**
1. **Resolution scaling:**
   - Change Phaser config: `width: 960, height: 640`
   - Update all scene layouts for 1.5× scale (or make responsive)
   - Generate higher-res assets if needed (upscale pixel art 2×)

2. **Safe area handling:**
   - Add CSS safe-area padding to `#game-container`
   - Test on iPhone SE, 14 Pro, 15 Pro Max simulators
   - Verify notch doesn't overlap UI

3. **Performance profiling:**
   - Run on physical device (iPhone 12 minimum)
   - Use Xcode Instruments to measure:
     - FPS (target: 60)
     - Memory usage (target: <200MB)
     - CPU load (target: <50% sustained)
   - Optimize if needed (reduce particles, disable scanlines)

**Success Criteria:**
- [ ] 60 FPS on iPhone 12 during battle
- [ ] No visual glitches on any device size
- [ ] Battery drain <10%/hour

**Risks:**
- WebView performance insufficient (mitigate: profile early, have native rewrite as fallback)
- Higher-res assets bloat app size (mitigate: compress PNGs with pngquant)

---

### Phase 4: Polish & App Store Prep (Week 6)
**Goal:** App Store submission-ready build.

**Tasks:**
1. **App Store assets:**
   - Design app icon (1024×1024, no alpha)
   - Create launch screen (static image or storyboard)
   - Capture screenshots (iPhone 15 Pro Max landscape)
   - Write app description + subtitle
   - Set up privacy policy page (GitHub Pages or Netlify)

2. **Metadata:**
   - Bundle ID: `com.rogueemblem.app` (must match provisioning profile)
   - Version: 1.0.0 (follow SemVer)
   - Build number: 1 (auto-increment via Xcode)
   - Age rating: 10+ (fantasy violence)
   - Categories: Games > Strategy, Games > Role-Playing

3. **Testing:**
   - TestFlight internal testing (add 25 testers)
   - Fix critical bugs from feedback
   - TestFlight external testing (optional, adds 1-2 weeks review)

4. **Submission:**
   - Upload via Xcode → App Store Connect
   - Fill out App Review Information (demo account, contact info)
   - Submit for review (expect 1-3 day turnaround)

**Success Criteria:**
- [ ] App approved by Apple
- [ ] Listed on App Store

**Risks:**
- Rejection for guideline violations (mitigate: follow [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/))
- Privacy policy missing (mitigate: create before submission)

---

## Resource Estimates

### Engineering Time
| Phase | Tasks | Estimate |
|-------|-------|----------|
| Phase 1: Foundation | Capacitor setup, Xcode config | 16 hours |
| Phase 2: Touch Controls | Long-press, buttons, gestures | 32 hours |
| Phase 3: Resolution/Perf | Scaling, safe areas, profiling | 20 hours |
| Phase 4: App Store Prep | Assets, metadata, submission | 12 hours |
| **Total** | | **80 hours (~2 sprints)** |

### External Dependencies
- **Apple Developer Account:** $99/year (required for App Store)
- **Physical iOS Device:** iPhone 12+ for testing (~$400 used, or borrow)
- **Design Assets:** App icon design (if outsourced: $100-500)

### Team Requirements
- **1× Engineer:** Familiar with JavaScript, Phaser, iOS basics
- **0.5× Designer:** App icon, screenshots, store page
- **0.25× QA:** TestFlight testing, device matrix

---

## Success Metrics

### Launch Criteria (v1.0)
- [ ] App approved and live on App Store
- [ ] No crash rate >0.5% (Xcode Organizer analytics)
- [ ] 60 FPS on iPhone 12 minimum
- [ ] All features from web version functional

### Post-Launch KPIs (Month 1)
- **Adoption:** 100+ downloads
- **Retention:** D1 retention >40%, D7 >20%
- **Performance:** Crash-free rate >99.5%
- **Ratings:** Average >4.0 stars (if rated)

### Future Optimization Triggers
- If crash rate >1%: Emergency patch
- If FPS <50 on iPhone 12: Investigate native rewrite
- If retention <15% D7: UX research (compare to web)

---

## Risks & Mitigations

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| WebView performance too slow | Medium | High | Profile early (Phase 3); have native rewrite as Plan B |
| App Store rejection | Low | High | Follow guidelines strictly; use pre-submission checklist |
| Touch controls feel clunky | Medium | Medium | User testing in Phase 2; iterate based on feedback |
| Asset size bloat (>50MB) | Low | Low | Compress audio (OGG→AAC), use sprite atlases |
| Supabase API blocked by iOS | Very Low | High | Test auth/RLS in Phase 1; fallback to Firebase if needed |
| Apple Developer account delayed | Low | Medium | Apply 2 weeks before Phase 1 starts |

---

## Open Questions

1. **Monetization Strategy:** Free with ads? Paid ($2.99)? Free with IAP later?
   - **Decision:** Launch free, add IAP in v1.1 (unlock additional lords, cosmetics)

2. **iPad Support:** Should we optimize for iPad in v1.0 or defer?
   - **Decision:** Defer to v1.1—use iPhone layout scaled up initially

3. **Landscape-Only Restriction:** Could we support portrait with redesigned UI?
   - **Decision:** No—game is 4:3 landscape by design, portrait would need full redesign

4. **TestFlight Duration:** How long to test before App Store submission?
   - **Decision:** 1 week internal testing minimum (25 testers from existing community)

5. **Offline Mode:** Should iOS work fully offline or require internet like web?
   - **Decision:** Match web behavior (require connection for auth/cloud saves)

---

## Appendix

### Useful Resources
- [Capacitor iOS Documentation](https://capacitorjs.com/docs/ios)
- [Phaser Mobile Examples](https://phaser.io/examples/v3/category/mobile)
- [Apple Human Interface Guidelines (iOS)](https://developer.apple.com/design/human-interface-guidelines/ios)
- [App Store Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [TestFlight Beta Testing Guide](https://developer.apple.com/testflight/)

### Device Test Matrix
| Device | Screen Size | Resolution | iOS Version | Priority |
|--------|-------------|------------|-------------|----------|
| iPhone SE (2nd gen) | 4.7" | 1334×750 | 15.0+ | High (min spec) |
| iPhone 12 | 6.1" | 2532×1170 | 15.0+ | High (baseline) |
| iPhone 14 Pro | 6.1" | 2556×1179 | 16.0+ | High (Dynamic Island) |
| iPhone 15 Pro Max | 6.7" | 2796×1290 | 17.0+ | Medium (screenshots) |
| iPad Air (5th gen) | 10.9" | 2360×1640 | 15.0+ | Low (v1.1) |

### Capacitor Plugins Needed
- `@capacitor/preferences` — Replaces localStorage with iOS-native storage
- `@capacitor/status-bar` — Hide status bar during gameplay
- `@capacitor/splash-screen` — Launch screen management
- `@capacitor/haptics` — (v1.1) Vibration feedback for attacks

---

**Document Status:** Ready for review
**Next Steps:** Engineering to prototype Phase 1 (Capacitor setup) and validate WebView performance on real device.
