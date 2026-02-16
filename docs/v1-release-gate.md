# v1.0.0 Release Gate Checklist

**Current version:** v0.10.0 (Feb 15, 2026)
**Target:** Feature-complete public release

---

## 1. Content Completeness
- [ ] Act 4 reinforcement tuning pass complete (no placeholder values)
- [ ] All 4 acts + final boss playable on Normal and Hard without softlocks
- [ ] Weapon arts: all act-unlocked arts reachable in a normal playthrough
- [ ] Blessings: all implemented blessings trigger correctly with visual feedback
- [ ] No placeholder/temp sprites in deployed build (check wyvern rider/lord)

## 2. Economy & Balance
- [ ] Full playthrough on Normal: player can afford 1-2 promotions by Act 3 without meta bonuses
- [ ] Full playthrough on Hard: gold scarcity feels intentional, not broken
- [ ] Meta upgrades: all 41 upgrades purchasable and functional
- [ ] Turn bonus gold rewards feel meaningful (S-rank should noticeably help)
- [ ] Sim harness: `npm run sim:fullrun` passes threshold gates
- [ ] No more major gold/cost constant changes needed (numbers are stable)

## 3. Mobile
- [ ] Virtual controls functional for full campaign (all actions accessible)
- [ ] No ghost clicks or input bleed between overlays
- [ ] Landscape prompt displays on portrait orientation
- [ ] Touch scrolling works in shop, home base, roster overlays
- [ ] Long-press inspection works on enemy and player units
- [ ] No critical bugs after 2+ full-act mobile soak test

## 4. Stability & Audio
- [ ] No music overlap on any scene transition path (Title→NodeMap→Battle→Loot→NodeMap cycle)
- [ ] No audio crashes on rapid scene transitions or pause/resume
- [ ] Scene transition hardening: no freeze/hang on node click, battle end, or run complete
- [ ] Cloud sync: no silent currency/progress loss on normal usage patterns
- [ ] Save migration: old saves (pre-convoy, pre-weapon-arts) load without crash

## 5. Testing
- [ ] `npm test` passes (all 1227+ tests green)
- [ ] `npm run test:harness` passes (headless battle harness)
- [ ] `npm run sim:fullrun` passes threshold gates
- [ ] Manual playthrough: Normal full campaign, no crashes
- [ ] Manual playthrough: Hard full campaign, no crashes
- [ ] Manual test: fresh account → sign up → play → cloud sync → sign out → sign in → continue

## 6. Known Bug Zero
- [ ] No game-breaking bugs in issue tracker
- [ ] No known softlocks or freeze states
- [ ] No known data corruption paths (save/load, cloud sync)
- [ ] No known exploits that trivialize difficulty (fog scouting fixed, trade rollback fixed)

## 7. Build & Deploy
- [ ] `npm run build` succeeds with no warnings
- [ ] Deployed build matches local dev behavior
- [ ] All `data/*.json` synced to `public/data/*.json`
- [ ] All sprite/audio assets present in `public/assets/`
- [ ] No .env secrets or PII in committed code

---

## Version History

| Version | Commit | Date | Milestone |
|---------|--------|------|-----------|
| v0.1.0 | `f63d11e` | Feb 9 | Foundation: initial playable game (phases 1-8) |
| v0.2.0 | `5293b85` | Feb 10 | Wave 0: tutorial, balance, music expansion |
| v0.3.0 | `3aee32d` | Feb 10 | Community polish: GBA forecast, elite nodes, first PRs |
| v0.4.0 | `01f9531` | Feb 10 | Difficulty & blessings: terrain AI, fog templates, harness |
| v0.5.0 | `1b826fe` | Feb 10 | Combat UI: blessing flow, end turn, roster cycling |
| v0.6.0 | `e1ef57b` | Feb 11 | Stability gate: mobile hardening, economy, AI fixes |
| v0.7.0 | `207b936` | Feb 12 | Convoy & village: storage MVP, scene stability |
| v0.8.0 | `7459574` | Feb 12 | Weapon arts: 39+ arts, wyvern foundation, mastery wave |
| v0.9.0 | `5ffa1e9` | Feb 14 | Act 4 hard mode: hazards, reinforcements, boss arenas |
| v0.10.0 | `4d13468` | Feb 15 | Current: mobile controls, narrative, economy tuning |

## Post v1.0

| Version | Feature |
|---------|---------|
| v1.0.1 | Hotfix patches (crash fixes, balance numbers) |
| v1.1.0 | Dynamic recruit nodes OR expanded skills |
| v1.2.0 | Additional map objectives (Defend/Survive/Escape) |
| v1.3.0 | Lunatic difficulty mode |
| v1.4.0 | Secret act + narrative expansion |
| v2.0.0 | Campaign system + lord selection |
