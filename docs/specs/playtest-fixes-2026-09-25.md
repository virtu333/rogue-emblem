# Playtest fixes — 2026-09-25 (fallen recruits, forecast, iOS saves, timeline preview)

Status: **built** on `claude/playtest-fixes`. Source: player playtests (iPhone app and
desktop Mac) relayed on 2026-09-25.

## 1. A recruit who falls in the battle it joined can be revived

**Report.** "My archer died last map and I can't revive him at the church (I used rewind
then lost him again…) or maybe it was because I lost him on the mission I recruited him."
The Church read "Revive fallen ally — No fallen allies."

**Root cause.** `RunManager.completeBattle` recorded casualties by diffing the run roster
(as it entered the battle) against the survivors. A unit recruited by Talk during the
battle was never on that roster, so when it fell before the victory it vanished: no
fallen-ally record, no revival, and its items were lost with it. Rewind was not the cause
(a rewound roster death is recorded normally); the fatal-decision path ends the run.

**Rule.** A recruit that joined and then fell in the same battle is a fallen ally exactly
like a roster casualty: its record is the unit *as it joined the army* (the roster analogue
is the unit as it entered the battle), items go to the convoy with the usual notice, a
recruited lord counts toward the run's lord falls, and revival uses the normal cost and
catch-up.

**Fix.** `src/engine/BattleRecruits.js` keeps an as-joined record (`serializeUnit`, battle
deltas and conditions cleared) for each Talk recruit in `scene._battleRecruits`. It is part
of the battle world state (`BattleSnapshotState`), so suspend checkpoints, Vision snapshots
and rewind-any-action states carry it: a rewind to before the recruitment forgets it, a
rewind to before the death keeps it with the unit alive. `PostCombatController` hands the
fallen ones to `completeBattle({ fallenRecruits })`. `validateBattleState` accepts (and
validates) the new optional field; legacy snapshots restore an empty list.

**Old saves.** Not recoverable: after the victory the save held no copy of the recruit
(the battle checkpoint is cleared at completion and victories keep no battle report).

## 2. Forecast — damage preview with triangle disadvantage

**Report.** "Damage preview on myrmidon attack doesn't work (I'm guessing doesn't take
disadvantage into account)." Screenshot: Myrmidon Daska (Iron Sword) vs Cavalier (Iron
Lance, 9/20 HP): "Triangle disadvantage · −1 damage · −10 Hit", Damage/hit 3, Hit 78,
"If all hits land: 6 HP".

**Finding.** Reproduced through the real code: the numbers were right (5 STR + 5 might − 1
triangle − 6 DEF = 3; 9 − 3 = 6) and equal to what `resolveCombat` applies. What did not
work was the *preview on the HP bar*: the canvas forecast drew the projected loss as a
translucent `accent` fill, and `hpMedium` **is** `accent` (#dca044) — so for any unit at
40–70% HP (the Cavalier at 9/20) the damage segment was invisible.

**Fixes.**
- `drawForecastHpBar` (ForecastOverlay): the projected loss is a dark segment with bright
  hatching (the canvas twin of the DOM `.re-health-projection`), visible on every HP band.
- `forecastProjection` counts every strike of a round (brave weapons, multi-hit arts)
  instead of one per round (brave became eligible for the projection with the attack-flow
  change).
- Weapon-art forecasts are computed in the same simulated state resolution uses (after
  the HP cost, the Recoil Guard buff and a Phoenix Brooch heal); previously the skill
  context saw that state but the forecast numbers were read after it was restored, so a
  Recoil Guard art overstated the counter damage. *(See the attack-flow note below.)*

**Property test.** `tests/ForecastResolutionParity.test.js`: 2,500 seeded matchups across
every combat weapon type (triangle advantage/disadvantage, reavers, brave, effective, magic
swords, Sunder, stat-bonus weapons), ranks, class skills (incl. Myrmidon Vantage /
Swordmaster crit), mastery perks, traits, affixes, combat accessories, imbues, weapon arts,
terrain and range: the forecast's per-hit damage, Hit, Crit and strike count equal what
`resolveCombat` applies (Hit probed at `hit ± 0.5` with a constant RNG), and a shown "if all
hits land" projection equals the resolved HP.

## 3. Saving when the iPhone app is closed

See `docs/ios-development.md` → "Saves on iOS". Summary:

- **(a) Synchronous saves.** Audited every player-visible state change. Gap found and
  fixed: the roster sheet (the DOM roster used in the app) saved item use/equip/store/
  withdraw as they applied but left **gifts between units, scroll teaching, weapon-art
  binds, reclassing and accessory equip/unequip** in memory until the sheet closed (and,
  in the pre-battle Deploy roster, until the battle started). Every roster mutation now
  saves as it applies. Shop buys/sells/forges/restocks, church services, reward claims,
  node travel, colosseum, level-up/promotion (battle checkpoints) and settings/meta were
  already immediate.
- **(b) Lifecycle.** `src/utils/saveLifecycle.js`: `visibilitychange` (hidden),
  `pagehide`, `freeze`, and Capacitor App `pause` / `appStateChange(inactive)` run the
  active scene's flusher (the route map saves its state) and dispatch pending native
  writes. Battles are already checkpointed after every resolved action.
- **(c) Native mirror.** `src/utils/nativeSaveMirror.js`: with `@capacitor/filesystem`,
  game keys are mirrored to `Library/emblem-rogue-saves/` (double-buffered, torn-write
  safe), read back before boot (evicted store → restore; lost newer run/meta write →
  recover; deletions never resurrected), feature-detected off on the web.
  `@capacitor/app` + `@capacitor/filesystem` are added for the native side only (called
  through the injected bridge; no plugin JS bundled; `Package.swift` matches `cap sync`).
- **(d) Quota.** Measured sizes (see the iOS doc). `src/engine/SaveSpace.js`: a run or meta
  write that hits the quota sheds the *other* slots' optional battle history in stages and
  retries.

## 4. Timeline preview fell back to the text sketch

**Report.** "Rewind interface reverted to this lo fi version" — the Battle timeline showed
terrain initials and numbered circles instead of the rendered battlefield.

**Root causes.** The rendered view needed the optional frame archive, which was dropped
wholesale in three ways: (1) keyframes were scheduled by record id, so records appended
after a rewind branch extended a delta chain past what hydration accepts — the next reload
discarded the archive; (2) one frame the validator rejected nulled the entire archive
(traced sprites' `~corrupt` keys did exactly that, and any other bad frame would); (3) under
byte pressure the archive is the first thing shed, and the view only drew rows that still
had a frame. Separately, since previews were packed the sketch showed every tile as
unknown.

**Fix.** Keyframes by actual chain length; a rejected frame costs only its row (the next
record is a gap keyframe); sprite keys may use `~` and `.`; `BattleTimelineView` draws the
archived frame, else a board rebuilt from the row's rewind state
(`captureHistoryFrame`) or compact preview (`frameFromCompactPreview`). Only rows with no
board data show the sketch, labelled **"Preview unavailable — map sketch"**, and the sketch
reads packed terrain again.

## Other bugs found while reproducing

Fixed:
- The Church's disabled Kindle button read "Kindle · −0 shadow" when the sun was clear.
- The pre-battle Deploy roster left roster changes unsaved until the battle started
  (covered by the roster-sheet fix above).
- The forecast projection counted one strike per round for brave weapons (above).
- Since previews were packed, the timeline sketch showed every tile as unknown (above).

Not fixed (listed for follow-up):
- A unit's `weaponRank` is taken from its first proficiency, not the weapon type it
  attacks with. Not seen in the playtest matchup, but a unit whose proficiencies have
  different ranks can get the wrong triangle bonus (Mastery vs Prof) for its other
  weapon types. Forecast and resolution agree either way (both read the same field).
- Free in-battle changes that are not actions (equip swaps, trades) are not part of the
  per-action checkpoint, so they revert on Resume Battle. By design of the checkpoint
  (one per resolved action), but surprising.
- The iOS native side (mirror + lifecycle plugins) is covered by unit tests with a fake
  bridge and a browser e2e, not on a device. Needs `npm ci && npm run ios:sync` and an
  Xcode package resolve before the next TestFlight build.

## Tests

- Unit: `FallenRecruitRevival`, `PostCombatController`, `BattleSceneActionErrorRecovery`,
  `ForecastResolutionParity` (2,500 matchups), `ForecastHpBar`, `ForecastWeaponArtState`,
  `NativeSaveMirror`, `SaveLifecycle`, `RosterSheetPersistence`, `SaveSpaceQuota`,
  `TimelinePreviewFallback`, `TimelineRecorderFrameLoss`, `BattleTimelineView`.
- e2e: `fallen-recruit.spec.js`, `forecast-triangle.spec.js` (1280×800, 640×480,
  844×390; the resolved HP equals the forecast), `save-lifecycle.spec.js`,
  `timeline-preview.spec.js` (1280×800 and 1440×900 at DPR 2, several turns including an
  enemy phase, then a reload).

## Deviations / notes

- The weapon-art forecast is computed by `BattleScene._computePlayerForecast`, which
  whichever code owns `showForecast` calls (the attack-flow change moves `showForecast`
  to `AttackFlowController`).
- Doc screenshots are refreshed only with `PLAYTEST_FIX_SHOTS` set, like the other specs.
