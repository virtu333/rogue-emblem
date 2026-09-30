# Spec: Gaspar follow-ups, round 2 (review of PR 164 at `ff6081f`)

**Status:** Implemented, 2026-09-30. Reviews the round-1 follow-ups
(`docs/specs/veteran-knight-followups.md`, commits `239142b` and `ff6081f`) on
[PR 164](https://github.com/virtu333/rogue-emblem/pull/164).
**Size:** Small. Mostly one-line fixes, plus tests.

Round 1 holds up well:

- **Sprite and portrait:** redrawn source (traced scale 0.879), idle, windup and strike frames,
  and only one atlas entry added. Reviewed on day, dusk and night grades.
- **Measured Step:** `CantoRule` is data-driven, and the migration is idempotent.
- **Traits:** special traits never roll for other units.
- **Low-HP quip:** latched once per battle.
- **Rules and ids:** policies read from data, and a guard test keeps the `'old_knight'` literal
  out of `src/`.
- **Deploy sort:** forecast-based.

What remains is a red CI run, three bugs and some gaps.

## 1. CI: Resume Battle adds `traitRulesVersion` to Gaspar (blocking)

**Failing lanes:**

- `e2e (portrait-2of6)`, `portrait-journey.spec.js`:
  - 477: Resume Battle restores the exact battle, upright
  - 503: a refresh after turning the phone restores the same battle
  - 612: Resume Battle in landscape is unchanged by portrait mode
- `e2e (portrait-3of6)`, `portrait-rotation.spec.js:882`: a switch whose save fails keeps the
  battle playable, and turning again retries

**Symptom.** The restored battle's domain state has `"traitRulesVersion": 2` on Gaspar, and the
live battle did not.

**Cause.**

1. `createSpecialCharacter` (`src/engine/SpecialCharacters.js:44`) now gives him traits, but
   does not stamp `traitRulesVersion`.
2. A new run never passes his unit through `migrateUnitTraits`, so the live battle has no
   version.
3. The checkpoint restore runs `migrateUnitTraits` (`BattleSnapshotState.js`,
   `BattleSuspendController.applyUnits`), which stamps the version (`TraitSystem.js:456-491`).

It did not show up before round 1 because an empty `traits` array returns early at `:456`.

**Fix.** In `createSpecialCharacter`, set `traitRulesVersion: TRAIT_RULES_VERSION`
(import it from `TraitSystem.js`).

Audit the other constructors that set `traits` without going through `rollAndApplyTraits`,
which already stamps the version at `:207`. They have the same latent bug.

**Test.** A new Gaspar is deep-equal to itself after `migrateUnitTraits` and after
`normalizeSpecialCharacter`, so restore changes nothing. This test fails before the fix.

## 2. The refusal check changes its line and writes save state while drawing (bug)

`specialCharacterRefusal(gameData, unit, effect, run)` calls `run.pickNarrativeLine`. That
function advances `pickFresh` and writes `run.narrativeSeen`, which `toJSON` persists.

`rosterClassChangeBlock` passes `run`, and the mobile roster calls it **while drawing**:

- `src/ui/MobileRosterSheet.js:1418`: Gear tab, once per seal in Gaspar's bag, on every
  `render()`
- `src/ui/MobileRosterSheet.js:1476`: `convoyUse`, once per convoy seal, on every render

Effects:

- The line changes on every tab or unit switch.
- Two seals on screen show two different lines, because they share the key
  `refusal:reclass:old_knight`.
- Save state is dirtied with no player action, and the next unrelated save persists it.

**Fix.** Split the two uses:

- `specialCharacterRefusalText(gameData, unit, effect)` is **pure** and hash-stable, for
  example `pool[hash(unitUid + effect) % pool.length]`, or `pool[0]`. It is used by every
  "blocked" or render check:
  - `rosterClassChangeBlock`
  - `churchPromotionBlock`
  - the `RosterOverlay` and `BattleScene` menu labels
- `speakSpecialCharacterRefusal(run, …)` uses `pickNarrativeLine`. It is called **only on a
  player tap** of the refused seal or button:
  - `RosterOverlay.js:1778, 1841`
  - `BattleScene.js:7344`
  - `PromotionController.js:44`
- `RosterCommands` and `ChurchCommands` never receive `run` for the refusal.

**Tests:**

- Calling `rosterClassChangeBlock` five times on the same seal returns the same string.
- `JSON.stringify(run.narrativeSeen)` is unchanged afterwards.
- A tap does advance the line.

## 3. His normal level-up lines never play (bug)

`levelUpKind` (`src/ui/growthContent.js:299`) returns:

- `blank` for one gain or fewer
- `perfect` for gains in every stat
- `normal` otherwise, which means at least two gains

The new branch at `src/engine/UnitVoice.js:216` sends any non-perfect level-up with
`gained >= 2` to `levelUp.major`. So every `normal` level-up takes `major`, and the `normal`
pool never plays.

**Fix.** Gate `major` on `gained >= 3`. With about 1.2 expected gains per level (1.9 with
meta), that is his genuinely rare big level-up.

**Test.** Pin the pool choice by gain count:

| Gains | Pool |
|---|---|
| 1 | `blank` |
| 2 | `normal` |
| 3 | `major` |
| all | `perfect` |

## 4. Measured Step can be benched (bug)

- The old `canto` was a Paladin class-innate skill, so `SkillLoadout.lockedSkillIds` locked it.
- `measured_step` is not class-innate, so `benchSkillBlock` allows benching it.
- The version-gated migration never restores it, so a player who benches it loses his
  movement rule.
- Meanwhile `lockedSkillIds` still locks the Paladin innate `canto`, which he no longer has.

**Fix.** In `lockedSkillIds` (`src/engine/SkillLoadout.js:29`), add the unit's
`specialCharacterDefinition(unit)?.skills` to the locked set. Aegis stays locked through the
class rule. The bench message reads "Personal skills can't be benched."

**Test:**

- `benchSkillBlock(gaspar, 'measured_step')` returns a refusal.
- A recruit Paladin can still bench anything it could bench before.

## 5. Gaps

- **Help page length.** Meta-Progression grew from 13 to 17 lines
  (`src/data/helpContent.js:535`). Line 16 sits against the panel's bottom border.
  - Move the three Gaspar lines to their own short page (for example "Gaspar", under the Units
    or Meta tab).
  - Extend the `≤ 15 lines` check (`HelpContentInput.test.js:36`) to every tab.
- **Desktop roster.** `RosterOverlay` still shows no traits or bio. Unit detail, mobile and
  party menus do. Add a trait row, or a pointer to unit detail, to the roster stats panel, and
  check it fits at 640×480.
- **Refusal portrait.** Spec round 1 §3 said to show his portrait where the surface supports
  one. None do. The banner surfaces could show his `portrait_special_old_knight` thumbnail.
  Optional.
- **Loom dead branch.** `loomModel.js:460` drops `special`, so `LoomPanels.js:145`'s
  `trait.special` branch never fires. Either pass the flag through or delete the branch.

## 6. Test gaps

1. **Resume test with an old Gaspar.** The current "serialized level-up checkpoint" test
   re-runs completion after `executeCombat` already finished. Replace it with a real resume:
   - Restore an old checkpoint (Gaspar with `canto`, no `specialRulesVersion`) through
     `BattleSuspendController`.
   - Complete one attack.
   - Assert no `CANTO_MOVING`, and that the skills are `['measured_step', 'aegis']`.
2. **`onChipLance` / `onKillSword`.** A lance attack that leaves the enemy alive can quip chip
   (seeded chance). A sword kill picks `onKillSword`, not `onKill`. A lance kill picks
   `onKill`.
3. **The sections above:** the refusal-stability and `narrativeSeen` checks (§2), the
   level-up pool table (§3), and the bench lock (§4).

## 7. Housekeeping

- Re-serialising `data/dialogue.json`, `data/skills.json` and the schemas turned about 30
  unrelated `—`/`’` characters into `\u` escapes. Restore the literal characters to cut diff
  noise; there is no semantic change.
- `tests/sim/RunPolicies.chooseDeployRoster`: the comment says it keeps lord
  "placement/activation order", but the code sorts lords by level, as before. Fix the comment.

## Out of scope (unchanged)

Full-run balance validation and human playtesting remain the balance gate. See
`veteran-knight.md` "Validation before gameplay delivery".

## Implementation notes

- New special characters carry the current trait rules version. The other direct trait
  assignments already call `applyTraitCreationMods`, which stamps it.
- Refusal previews use the first line without changing narrative history; explicit canvas
  roster/battle attempts pick fresh lines. Disabled DOM buttons show stable refusal text.
- Fixed personal skills are locked in both the commands and rendered skill cards.
- The canvas roster has fitted trait and biography rows with full text on hover/long-press.
  Loom previews retain the special trait flag.
- Gaspar has a separate help page. Existing overlong help pages are split at topic boundaries
  (or lose a blank separator), so every page satisfies the shared 15-line test.
- Regression coverage includes a real legacy checkpoint captured/restored through
  `BattleSuspendController`, exact new-unit migration/JSON round trips, repeated DOM
  Gear/Convoy redraws, all four level-up pools, bench/swap protection, and weapon quip pools
  without advancing battle RNG. Planted version, refusal-state, voice and lock bugs fail their new tests.
- Literal Unicode punctuation is restored without changing dialogue or JSON semantics.

Validation: the full local unit suite, targeted roster/checkpoint tests, all four previously
failing portrait browser cases, data validation/parity, reference check, production build,
formatting, lint, and a 640×480 canvas roster/tooltip visual check. Refusal portrait thumbnails
remain optional and deferred. Balance, growths and difficulty bases are unchanged; the full-run
balance and human-playtest gate remains open as described above.
