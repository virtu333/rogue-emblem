# Fix brief: second external review + #190/#191 (2026-10-02)

Reviewed head: main `942973ce`. Every item below was reproduced with real modules unless marked read-only. Line numbers are on `942973ce` (or the PR head where noted).

## Merge order

Owner decisions recorded 2026-10-02: Foresight extends counters (item 2), #191 balance kept (item 4), Danger area tint approved (item 5b), Black Sun skill chance trimmed to +30% (item 5). #190 and #191 merged before review; their open items ship in the round-6 fix PR.

1. **Fix PR A+B** ("Area-strike presentation guard and reach previews"): items 1–2. Small, local.
2. **Fix PR D** ("Ownership check before restoring a cloud reservation"): item 3. Can ride with A+B if preferred.
3. **#191**: add item 4 before merge.
4. **#190**: item 5 (PR text + one nit) before merge.
5. **Danger area tint**: item 5b, its own feature PR, any time after item 2.
6. **Test flakes**: item 6, any time (own PR).
7. **Cloud hydration (C)**: item 7, folded into PR 7. **Release gate: PR 7 merges before `VITE_CLOUD_ENABLED` is turned on anywhere.**

Every new guard needs a test that fails with the guard removed (plant it once, then revert).

---

## 1. Area strike can lock the battle on a music error (finding A)

**Bug.** `AreaTargetingController.execute` sets `COMBAT_RESOLVING` (:497), commits intent, passes the save gate, then calls `scene._musicCtrl?.onCombat?.()` bare at :516. The recovery `try` starts at :517. In the `finally` (:603), `onCombatResolved` is also bare.

- If `onCombat` throws, `execute` rejects. The state stays `COMBAT_RESOLVING`, no cost is charged and input is blocked. Callers use `void this.fire()` (:265, :305), so nothing recovers it.
- If `onCombatResolved` throws, the action has already settled, but `execute` rejects with an unhandled rejection.
- Normal combat already guards the same two calls (`BattleScene._runCombatResolution`, :7974 and :7981-7985). `BattleMusicController.onCombat` and `onCombatResolved` (:181-190), and the AudioManager / LoopedMusic Web Audio calls beneath them, have no try/catch.

**Fix.** Make both calls go through `safeBattlePresentation`, which is already imported:

```js
safeBattlePresentation('area combat music', () => scene._musicCtrl?.onCombat?.(), { scene });
...
} finally {
  if (isCurrentBattleSession(scene, session))
    safeBattlePresentation('area combat music end', () => scene._musicCtrl?.onCombatResolved?.(), { scene });
}
```

**Tests.**

1. Add an area-strike case to the presentation-failure matrix (`tests/CombatBoundaryPresentation.test.js`, or `tests/AreaTargeting.test.js` using its `battle()` fixture with `presentationFailureProxy(scene, failure, { skipped })`).
   - The proxy already counts `music.onCombat` and `music.onCombatResolved`, so the standard "fail the nth call" loop covers both.
   - For each world (shown, skipped, nth call fails), snapshot:
     - the return value and `battleState`
     - `finishUnitAction` call count (must be 1) and `hasActed`
     - caster and foe HP, and the remaining enemies
     - `weapon._usesSpent`, art usage, XP and `_pendingCommittedAction`
   - Require every world to equal the shown world.
2. Add two explicit worlds with a real `_musicCtrl`: one whose `onCombat` throws, one whose `onCombatResolved` throws. `execute` must resolve, and the result must equal the shown world.

Without the fix, the matrix fails on the first music call. With the prototype fix, the matrix and all 43 existing area tests pass.

**Also in this PR** (from `battle-action-coordinator.md` §1.3; this item is that note's PR A):

- **D7.** In the `executeCombat` catch, `this.grid.clearHighlights()` / `clearAttackHighlights()` (BattleScene ~:8437) run after `attacker.hasActed = true` and are unguarded. If either throws, `completeBattleAction` is skipped, `unitActed` never runs and the phase cannot auto-end. Wrap both in `safeBattlePresentation`, and add a test that forces `clearHighlights` to throw inside the catch: the action must still complete once.
- **D8.** `_announceWeaponSwaps` (:7231-7235) swallows banner errors with no telemetry. Route the banner through `safeBattlePresentation` so the failure is reported.
- **Unhandled rejections from `fire()`.** Attach `.catch(reportAsyncError)` to `void this.fire()` (:265, :305) so a future rejection is reported rather than silent.

**Out of scope (note only).** Several enemy-phase presentation calls are unguarded:
- `onPhaseStart` (BattleScene :9329)
- `_playBossEnrageFx` / `onBossEnrage` (:2984)
- the `executeEnemyStatusStaff` banner, icon and fx (:10405-10458)
- `onHeal` (:10242-10246)

A throw in any of them cuts the enemy phase short through phase-level recovery rather than locking the game. A throw from a status-staff banner was reproduced: the staff use is spent, the enemy is never marked acted, and no checkpoint is written. They will move under the shared action coordinator (`battle-action-coordinator.md`, PR G). Wrapping them in `safeBattlePresentation` now is welcome but optional.

## 2. Player reach previews disagree with real targeting (finding B)

**Bug.** `ThreatForecast.unitReach` (:109-136) uses `Grid.getAttackRange`, which reads raw `weapon.range` from the equipped weapon only. Real targeting (`findAttackTargets`, BattleScene :4985-5013) instead uses the union of `getAttackWeapons(unit)`, with ranges from `AttackOptions.getAttackRange` (:49), which adds `getWeaponRangeBonus`.

The affected callers are unit inspection (`InputController.js:1036`) and the formation screen (`FormationController.js:704`). On an open 15×15 grid, the drawn fringe compared with legal targets from all reachable tiles:

| Case | Error |
|---|---|
| Kira (Foresight, Fire 1–2) | 24 legal tiles not drawn (preview shows max 2, targeting allows 3) |
| Silenced unit with Fire equipped and an Iron Sword | 20 tiles drawn that are illegal |
| Unit carrying an unequipped Iron Bow | 20 legal tiles not drawn |

The enemy Danger overlay, pinned threat and Threat Sight are **correct as they are**. The AI strikes with `enemy.weapon` at raw range (`AIController` :553, :785, :864), and Danger matches that. Do not change them.

**Fix.**

1. Add one pure function in `AttackOptions.js`, for example `attackFringe(grid, unit, moveTiles, { skillsData, weapons })`. It takes the union over `getAttackWeapons(unit)`, using `getAttackRange` for each weapon.
2. Point `unitReach`'s player callers at it (`InputController`, `FormationController`), passing `skillsData`.
3. Positions still come from `buildUnitPositionMap()` (PlayerKnowledge rule).

Policy:
- **Player inspection and formation:** use every usable weapon, so silence and spent per-battle weapons fall out naturally.
- **Enemy Danger, pinned threat and Threat Sight:** keep `nextStrikeWeapon` at raw range.
- **Weapon arts:** pre-selection previews do not include art range bonuses (Curved Shot and the like). That is acceptable and unchanged.

**Test.** Write a property test. For each case below, assert that the drawn fringe equals the legal-target tiles from `AttackOptions` over reachable stop tiles, minus the move tiles. It fails today by 24, 20 and 20 tiles in the first three cases.
- Kira with Foresight
- a silenced unit with tome and sword
- a unit carrying an unequipped bow
- a unit with a spent per-battle weapon and a carried bow

Also assert that, for an enemy, Danger reach equals the reach the AI's `isInRange` gives.

**Owner decision: Foresight extends counter range (decided 2026-10-02).** Kira can attack at distance 3 but today cannot counter at 3, because `Combat.canCounter` (:895-899) uses raw range. Make counters use the same effective range as attacks (`AttackOptions.getAttackRange` with skills), so a 1–2 tome with Foresight counters at 1–3. This can ride in this PR or go on its own.

Every consumer that predicts a counter must change with it, or they will disagree:
- the forecast's counter flag and damage;
- the AI's counter-risk scoring (`counterRisk` / `_scoreAttackTarget`);
- `TacticianAgent` and the strategy sim;
- the area preview.

Grep for `canCounter` and `isInRange(` and route all of them through one function.

Enemy reach and Danger stay raw. No enemy has Foresight, and the AI attacks with raw `isInRange`. If an enemy ever gains a range skill, `AIController` (:553, :785, :864) and Danger must move to the shared function together.

Tests:
- Kira at distance 3 is attacked by a 1–3 or 2–3 archer and counters, and the forecast shows the counter.
- The same case with Foresight removed shows no counter.
- Forecast and resolution agree, both in the existing parity property test extended with range skills and in a hand case.

## 3. A failed device acknowledgement can bring back a stale cloud reservation (finding D)

**Bug.** The final catch in `CloudSync.applyPendingCloudSlot` (:237-240) restores `originalPendingRaw` whenever the reservation key is absent. It never checks whether newer canonical data was written while `ensureDurable(key, null)` was awaited.

Reproduction: a newer run is written during the await and the ack then returns false. The reservation comes back over the newer run, and the slot becomes `recovery-required`:
- Cloud backup for the slot pauses (`protected_slot`).
- The slot opens the recovery dialog.
- It does not heal itself after a relaunch, because the in-memory `pendingRecoveryWrites` proof is gone.
- No data is lost.

It needs the native app with cloud on.

**Fix.** Hoist an ownership proof and add it to the restore condition: every recovery key is still null, and every canonical key still holds the bytes this operation wrote (`canonicalKeys.every(k => localStorage.getItem(k) === expected.get(k))`).

**Test.** In the `tests/CloudPendingNativeRestore.test.js` harness, on `ensureDurable(PENDING, null)`, write a newer `RUN` and then return false. Assert:
- PENDING is absent
- the newer run is kept
- `inspectSlot(1).status === 'valid'`

Planting the old condition back must fail the test. The existing 11 restore tests, `CloudPendingAuthTransport` and `CloudSync.test.js` (67) must still pass.

## 4. #191: Act 1 drops the Grounder and Helm Splitter scrolls as battle loot (should-fix before merge)

**Bug.** #191 puts both scrolls in `data/lootTables.json` `act1.weaponArtScroll` with base weight 0, intending them to be sold and never dropped. Two things raise that weight above 0 at reward time:
- the elite shift `ELITE_LOOT_WEIGHT_SHIFT.weaponArtScroll: +2` (`LootSystem.js:596-598`, applied at :918-919)
- the Studied Training meta bonus (`applyMetaWeightBonuses`, :830-841)

The pool used to be empty, so the raised weight did nothing; now it draws. Over 2,000 seeds of `generateLootChoices('act1', …)`:
- elite battles offered a scroll on 224 reward screens (0 on main)
- normal battles with Studied Training II offered one on 123 (0 on main)

**Fix (pick one).**
- Add a shop-only list (`act1.shopWeaponArtScroll`) that only `generateShopInventory` reads.
- Or skip weight shifts and meta bonuses for any category whose table weight is 0. This is more general and also guards future data.

**Test.** `generateLootChoices('act1', …)` never returns a `weaponArtScroll` choice across N seeds for elite battles, or with a `weaponArtScroll` meta bonus. The test must fail on the current head.

**Text nits (same PR).**
- `forecastDisplay.js:136-139` and `tutorialLessons.js:46` still say a lead of 5 gives a second attack. With an active art the lead is 10.
- `weaponArtDisplay.js:118-119`: Barrage and Piercing Charge say "2 strikes at 90%" and then "strikes once however fast you are". Use "no Speed follow-up" instead.

**Owner decisions (decided 2026-10-02): keep as implemented.**
- At a lead of 10 or more, Windsweep and Sanctuary get the art strike plus a plain follow-up, with no counter.
- `halfPhysicalDamage` and the art's DEF/RES bonuses last the whole combat (that combat only, not the battle).
- Annihilate and Crown Splitter follow-ups take the weapon triangle again; counters still ignore it. No decision was recorded on this one; leave it unless the owner says otherwise.

Pin the first two with tests so a later refactor can't drop them silently:
- Windsweep at a +10 lead produces two strikes and no counter.
- An art's DEF bonus still applies to a counter that lands after the follow-up.

Forecast and resolution agree in every one of these cases.

**Already correct.**
- Forecast and resolution match strike for strike.
- The art's follow-up threshold uses the same attack speed, Pursuit Ring and preventEnemyDouble rules as normal doubling.
- Costs are recorded once.
- The splash drain goes through `healUnit` and settles before presentation.
- Healing Light cannot kill its user.
- The Hollow Feast id `legend_life_drain` is stable, so old saves load. Do not add "Life Drain" to `ITEM_RENAMES`: the skill named Life Drain would be renamed too.

## 5. #190: before merge

- **Fix the PR text.**
  - The skill-chance bonus applies to every rung, not only Dusk: Nightfall +20%, Black Sun +40%, every act, including the Entity.
  - In-progress runs pick up both the skill chance and the Act IV 60% promoted share on their next battle, because `difficultyModifiers` snapshots already carry `enemySkillChance`.
  - Only `bossLevelBonus` is held back for runs saved before the change.
- **Owner decision (2026-10-03): trim Black Sun to +30%** (`lunatic` `enemySkillChance` 0.4 → 0.3): Act 1 40%, Act 2 55%, Act 3 80%, Act 4 90%, Entity 95% for enemies of level 5+.
- **Nit.** `UnitManager.js:477`: an act key missing from `SKILL_CHANCE_BY_ACT` (for example `postAct`) jumps from 0 to the full bonus. Add the bonus only where a base exists, or list the keys explicitly.
- **Nit.** Add a test that a Dusk elite captain gets no `bossLevelBonus`.
- **CI.** The red `battle-input-1of3` is not caused by #190 (see item 6). Re-run it.

## 5b. Danger: area-threat tint (feature, own PR; decided 2026-10-02)

Today Danger and Threat Sight show only direct reach. For enemies that carry area arts, Threat Sight adds a note (documented behaviour). A unit outside an enemy's direct reach can still be caught by an area art aimed at a neighbour.

**Add a second, visibly distinct tint for "possible area hit".** A tile gets the tint when it is not in direct reach but would be inside the area of at least one centre that enemy can legally pick this turn.

To compute the tint for each enemy that has a usable area art, take every reachable stop tile, then every legal centre from that tile, then every tile inside the radius around that centre. Remove the direct-reach tiles from the result.

**Inputs:**
- **Usable art:** check it is learned, has art uses left, the HP cost is payable and the weapon is equipped or usable.
- **Legal centres:** read them from the same functions execution uses:
  - `AreaStrike.areaStrikeRange` for chosen-centre arts;
  - for target-centred arts, the occupied tiles in normal attack range from that stop tile.
- **Ally safety:** if `AreaStrike` refuses centres that would hit the enemy's own allies, the tint must apply the same rule.
- **What the player knows:** positions come from `buildUnitPositionMap()` / `PlayerKnowledge` (CLAUDE.md "Previews read what the player knows"). Hidden enemies contribute nothing.
- **AI intent:** match what the enemy AI can actually do. If `EnemyArtScoring` never fires an art in some situation (for example when no target is in direct reach), the tint should follow the AI's actual rule, not the art's theoretical reach. Read the AI path and state the rule in the PR.

**Display:**
- A lighter or hatched variant of the Danger colour, with a legend or help line: "Area: an enemy art could catch this tile."
- It must be distinguishable from the direct-reach tint in colour-blind palettes (check `uiStyles` / the theme check).
- The pinned enemy threat shows the same split for that enemy.
- Portrait and landscape both.

**Performance:** cache per enemy-phase state, with the same invalidation as Danger. On a large map, the stops × centres × radius loop must stay within a frame on a phone. Measure it.

**Tests:**
- A pure function test: an enemy with a radius-1 art at a known position yields exactly the hand-derived ring outside its direct reach.
- A hidden enemy contributes nothing (the PlayerKnowledge pair-worlds pattern).
- Spent art uses or an unpayable HP cost contribute nothing.
- The tint matches the centres the AI can legally pick (property test against `AreaStrike` over random boards).
- The help text is updated.

## 6. Flaky browser tests (own PR)

- **`tests/e2e/gamepad-battle.spec.js:267`** ("L1/R1 cycle…") fails about 10% of the time on main (2 of 20 runs).
  - Cause: the spec passes no `?seed=`, and map generation uses `Math.random`. When a player unit deploys at (0,0), which is the cursor's start, `_cycleCursorToUnit` (BattleScene :872-887) anchors on that unit. The first R1 then lands on the second unit.
  - Fix the test: move the cursor off every player unit before the first R1, or compute the expected target from the cursor's actual tile. Add a unit test of `_cycleCursorToUnit` with the cursor starting on a unit.
- **`tests/e2e/mobile-run-loop.spec.js:215`** fails about 1 run in 8 on main.
  - Cause: an unseeded shop purchase races the roster sheet opening on the first unit.
  - Fix: seed the run, or wait for the sheet's state before asserting.

## 7. Cloud hydration can half-apply a save (finding C): fold into PR 7

**Exposure today: none.** Cloud runs only when `VITE_CLOUD_ENABLED === 'true'` (`supabaseClient.js:10`). The latest TestFlight log prints "Cloud: off", and `netlify.toml` does not set the flag. The Netlify dashboard is still to be confirmed.

**Bug.**
- `applyRunSlots` writes the run.
- `applyMetaSlots` swallows a failed `setItem` with a `console.warn` (`CloudSync.js:350-353`).
- `fetchAllToLocalStorage` reports only fetch rejections and deferred reservations (:444-465).
- So `isCloudHydrationComplete` (:469) returns true, and `backgroundCloudRefetch` (`main.js:456`) stops retrying.

**Loss path (reproduced).** The device holds older non-empty meta. The run write succeeds and the meta write fails. The slot then inspects as **valid**. The next meta save stamps a fresh `savedAt` and passes the remote-newer guard, so the stale local meta overwrites the cloud copy: in the reproduction, 900 Valor became 130 and an upgrade was lost. A meta-only failure does the same.

On a fresh device the slot instead shows the recovery card, and the cloud copy stays safe.

**Requirements for PR 7's contract.**
1. A failed local write for a slot, whether run, meta or native mirror, must block every upload for that slot: `pushMeta`, `pushRunSave`, `pushAllLocalSlots` and `backupAllLocalSlots`. This rule is what prevents the loss. Rolling back the run alone is not enough: an empty fresh-device slot plus New Game would then overwrite the cloud run.
2. Write the run and meta for a slot as one pair: if meta fails, the run write is undone.
3. Hydration returns a per-slot result, and completion requires no failed slots, so the background retry continues.
4. Hydration writes go through the same freeing-space path as gameplay saves, or the difference is documented.

**Test.**
1. Fetch with the meta `setItem` throwing and older non-empty local meta.
2. Save meta through the real `MetaProgressionManager.onSave → pushMeta`.
3. Assert the cloud meta is unchanged and `isCloudHydrationComplete(result) === false`.

**Stopgap (only if cloud must come on before PR 7).** A roughly 30-line version of the four requirements has been prototyped: failed slots tracked, uploads blocked, the run write rolled back, and completion made truthful.

## 8. Process

- Main's CI on `942973ce` has one red job, `portrait-2of6`, a runner shutdown. The same shard passed on #190. Re-run it.
- `main` has no branch protection. Add one required aggregate job (`ci-ok`, `needs:` every job, `if: always()`, fails unless all succeeded), so sharded browser lanes don't each need to be listed as required.
