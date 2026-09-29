# Spec: Gaspar follow-ups (review of PR 164)

**Status:** Proposed, 2026-09-29. Addresses the review of
[PR 164](https://github.com/virtu333/rogue-emblem/pull/164) against
`docs/specs/veteran-knight.md`.
**Size:** Medium. Data plus small engine helpers, one art pass, tests. No balance changes.

The PR has no correctness bugs found so far. Creation, saves, records, meta rounding,
recruit/revival exclusion and the Canto rule all behave as specified. This spec closes the
gaps: the unit is under-explained, a quip repeats, refusals are terse, the sprite skipped the
tracer, rules are hardcoded, and tests are thin.

## 1. Explain him through special traits

**Problem.** The spec requires the UI to explain these rules:

- low growth and XP
- half-rate home-base growths
- the fixed kit
- no reclass
- restricted Canto
- no class curriculum or mastery

Today only the mobile roster sheet has a card (`MobileRosterSheet.js:443-449`), and it covers
three of the six. Desktop (`UnitDetailOverlay`, the roster) and help say nothing.

**Solution.** Put the rules where players already read unit rules: traits and skills. Every
surface that lists traits (`UnitDetailOverlay`, `MobileRosterSheet`, `PartyMenus`, the Loom
panels, choice screens) then explains him with no Gaspar-specific UI code.

Two **special traits** in `data/traits.json`:

| id | Name (≤ 16 chars) | Text |
|---|---|---|
| `old_campaigner` | Old Campaigner | Joins promoted with a fixed kit. Learns slowly, grows little; home-base growth upgrades count half. |
| `set_in_his_ways` | Set in His Ways | Cannot reclass or promote again. Learns no class skills or mastery. |

- Schema: add `rarity: "special"` and `specialCharId: "old_knight"`. This mirrors the legendary
  lord traits (`rarity: "legendary"`, `lordName`).
- `isTraitEligible` (`TraitSystem.js:125`) returns true only for the unit whose
  `specialCharId` matches, the way `lordName` gates lord traits. Special traits never roll.
- `traitEffectText` returns the catalog description for `rarity: "special"`, as it does for
  legendary traits.
- The traits carry **no mods**; they only describe rules enforced elsewhere (sections 2
  and 6).
- The rarity needs one colour or badge treatment in trait rows, like legendary traits.
- `createVeteranKnight` sets `traits: ['old_campaigner', 'set_in_his_ways']`.
- `fromJSON` adds any missing ones to an existing Gaspar (keyed on `specialCharId`,
  idempotent).
- `migrateUnitTraits` must keep them.
- Trait slot count: recruits hold 0–2 traits, so these two fill his slots. That is correct,
  because he gets no random traits.

The mobile "Veteran knight" card becomes **bio only**. Show the same bio on desktop unit
detail, under the name, one wrapped line at 640×480.

Help (Meta-Progression page or a new "Special characters" paragraph): three lines naming
Gaspar, pointing to his traits, and saying he joins every new run.

UI checks, per CLAUDE.md:

- longest trait name and text at 9px Press Start 2P, 640×480
- portrait-mode unit detail
- mobile sheet

## 2. A named Canto: "Measured Step"

**Problem.** He shows `Canto` in his skill list but does not behave like Canto. The rule is
also keyed on `specialCharId` inside `completeResolvedAction`, which is invisible to players
and to data.

**Solution.** A distinct skill, so the list tells the truth:

```json
{ "id": "measured_step", "name": "Measured Step",
  "description": "Use remaining movement after a noncombat action. Not after fighting.",
  "trigger": "passive", "cantoRule": "noncombat" }
```

- Add `"cantoRule": "any"` to `canto`. The schema allows `cantoRule` on passive skills.
- Name alternatives if you prefer: *Steady Pace*, *Parade Step*, *Old Soldier's Pace*.
- New pure helper `cantoRuleFor(unit, skillsData)`, in `engine/CantoRule.js` or
  `SpecialCharacterPolicy.js`. It returns `null | 'any' | 'noncombat'`, and a root still
  wins.
  - `BattleScene.finishUnitAction` (`:5103`) replaces `skills.includes('canto')` with it.
  - `completeResolvedAction` uses `cantoRuleFor(unit) === 'noncombat'` for `kind: 'combat'`,
    instead of `combatBlocksCanto(unit)`.
  - A unit with both skills takes `any`.
- `data/specialChars.json` skills become `["measured_step", "aegis"]`.
- A `fromJSON` migration replaces `canto` with `measured_step` on units with
  `specialCharId: 'old_knight'` (once, idempotent).
- Class-innate re-adds (reclass, promotion) are already blocked for him.
  `normalizeUnitClassState` must not re-add `canto`; pin this in a test.
- `devStartup.js:311`, which pushes `canto`, is unaffected.
- Headless harness: Canto stays disabled (`HeadlessBattle.js:136`), a known gap listed in
  CLAUDE.md. Note it in the harness comment. Wiring Canto into the harness is out of scope.

## 3. Refusals with his voice

**Problem.** A reclass seal shows "No valid reclass targets." or "Cannot reclass this unit.".
A Master Seal says "Requires a base class at level 10 or higher.", which is wrong for a
promoted unit.

**Solution.**

- Add `dialogue.specialChars.old_knight.reclassRefusal` and `promoteRefusal` pools.
- When a seal targets Gaspar, show one line (`pickNarrativeLine`, key `refusal:reclass`)
  as his speech in the existing notice or banner, with his portrait where the surface
  supports one. **No seal is consumed.**
- Surfaces:
  - `RosterCommands.rosterClassChangeBlock` (reason text)
  - `BattleScene` item menu (`:7339` banner)
  - the Church and roster seal flows
- Master Seal on him routes to `promoteRefusal`, not the level-10 message.

Draft lines (≤ 90 chars, no double quotes, no lord names):

- Reclass:
  - "A new class? At my age? I would sooner teach the horse to fly."
  - "Thirty years in this armor. It knows me better than any seal ever will."
  - "Save the seal for someone who still has growing to do."
  - "I tried being something else once. The horse objected."
- Promotion:
  - "Promote me again and I outrank the king. Neither of us wants that."
  - "There is no rank above tired, and I already hold it."

## 4. Low-HP quip: once per battle

**Problem.** `BattleBeatsController.onLowHealth` fires after every combat while he is at or
below half HP. It is limited only by the shared 10 s quip cooldown, and its pool has one line.

**Solution.**

- Latch it per unit per battle: a `Set` of `unitUid` on the controller, which lives for one
  battle.
- If the cooldown blocks the first attempt, retry on the next qualifying combat until it has
  been spoken once.
- The quip must not reset or consume the lord-quip cooldown.
- After a resume, a new controller may speak it once more. Accept that; do not persist it.
- Grow the pool to at least three lines.

## 5. Missing authored lines

The spec's sword and lance acknowledgments are absent.

- Add `onChipLance`: Gaspar initiates with a lance and the enemy survives. Chance 0.35 under
  the cooldown.
- Add `onKillSword`: a sword kill. It replaces generic `onKill` for swords; lance kills keep
  `onKill`.
- Draft lines: "Watch the opening. It is yours." / "Some lessons are best ended quickly."
- Add a `levelUp.major` pool (two or more stats gained) beside `perfect`, or document that
  `perfect` covers it.

## 6. Traced map sprite

**Problem.** Traced sprites are the battlefield default (`docs/specs/traced-sprites.md`).
Gaspar bypasses them:

- `battleUnitSpriteKey` returns his rebuilt static sprite first (`BattleUnitVisuals.js`).
- `preloadRebuiltSprites` loads `special_*` even outside rebuilt mode.

He has no idle, windup or strike frames, so combat choreography cannot pose him, and his
style differs from every other unit.

**Solution.** Run him through `tools/art/sprite-trace`:

1. Add to `tools/art/sprite-trace/roster.mjs`:

   ```js
   special_old_knight: { src: R('special_old_knight'), kind: 'mounted', main: 'blue',
                         hair: 'silver', armor: true, rects: HORSE }
   ```

   The source already lives at `docs/art/rebuilt-sprite-sources/special_old_knight.png`,
   which is where `R()` points.
2. `node tools/art/sprite-trace/cli.mjs trace …` to review. Then `lineup` at display size
   on dusk and night grades, next to `lord_rowan` and the Paladin, Cavalier and enemy
   Paladin sprites.
   - Check the traced scale against the 0.55–0.9 band. The v3 README redrew sprites that
     traced at 0.11–0.45.
   - Redraw via `gen-refs.mjs` if needed.
3. `cli.mjs bake`: idle0–3, windup and strike join the atlas. Then `npm run sync-assets`.
4. `tracedKeyFor` (`TracedSprites.js:73`): before the lord branch, return
   `special_<specialCharId>` when the manifest has it.
5. Remove the rebuilt-first override in `battleUnitSpriteKey` and the `special_` preload
   exception.
   - The rebuilt sprite remains for `?spriteArt=rebuilt`.
   - `classic` falls back to the Paladin sprite.
6. Keep `tests/RebuiltArtBudget.test.js`, `npm run check:sprites`, `combat-fx.spec.js` and the
   traced-sprite e2e green. Update `rebuilt-sprites.spec.js`, which currently expects
   `rebuilt-special_old_knight` in every mode.
7. Report the texture-memory delta; one sprite should be negligible.

**Portrait.** It has already been through the PC-98 pipeline: 192/96/64/48/40/32 bakes plus
the rebuilt 512. There is no separate tracing step for portraits. Still:

- review it beside the lord portraits in PC-98 and rebuilt modes
- confirm it is in the `shrinkRebuiltPortraits` budget flow

## 7. Rules in data, not literals

`'old_knight'` is checked inline in about a dozen places:

- `UnitManager.js:194, 243, 1275, 1386`
- `RunManager.js:4271, 4479`
- `RunRecords.js:31`
- `NodeMapScene.js:460`
- `RunCompleteScene.js:393`
- `UnitDetailOverlay.js:599`
- `MobileRosterSheet.js:518`

Separately, `SpecialCharacterPolicy` helpers exist but `UnitManager` does not use them. The
0.5 is a literal in `SpecialCharacters.js`.

Changes:

- Add policy fields to the `specialChars.json` entry and schema:
  - `canReclass: false`
  - `canPromote: false`
  - `classProgression: false`
  - `countsTowardRosterLevel: false`
  - `metaGrowthScale: 0.5`

  Canto moves to the skill (section 2).
- `SpecialCharacterPolicy` resolves the entry by `unit.specialCharId` from the loaded data.
  It exposes `canReclassSpecial`, `canPromoteSpecial`, `skipsClassProgression`,
  `contributesToTeamLevel` and `metaGrowthScale`. Every inline check calls these.
- `RunRecords` keeps any `specialCharId` that is a known special character id, not the
  literal.
- `createVeteranKnight` becomes `createSpecialCharacter(id, …)`; the old name stays as a thin
  wrapper.
- A test fails if `'old_knight'` appears in `src/` outside `SpecialCharacters*.js` and data
  loading, in the style of `HpWriteBoundary.test.js`.

## 8. Smaller fixes

- **Temperament:** the spec said `grim`, but data and tests use `wry`. Pick one and update the
  spec or the data. Gate `temperamentFor`'s stored-temperament branch on `unit.specialCharId`,
  so no other unit bypasses the per-run hash.
- **Tutorial flag:** `startRun({ tutorialMode })` is never passed. The tutorial builds its own
  roster. Either remove the option, or pass it from the tutorial entry if a future tutorial
  uses `startRun`.
- **Badge line:** `RunFlowMenus.js:41` reads `rm.noMetaMode`. Read the stored victory record,
  so the line matches what the archive shows.
- **Sims:**
  - `sim/strategy.js:1083, 1667` call `createInitialRoster()` and now silently include Gaspar.
    Make it explicit (`includeVeteran` flag, default matching the game) and note the shift in
    the PR.
  - `tests/sim/RunPolicies.chooseDeployRoster` sorts by raw level. The spec asks for
    battlefield value. At minimum, keep Gaspar deployed while his combat value exceeds a
    recruit's, e.g. a simple forecast-based score.

## 9. Tests to add

Each catches a realistic failure:

1. **Canto, scene level.** Run `finishUnitAction` / `executeCombat` for Gaspar with and
   without a weapon art, for an ordinary Paladin, and for Gaspar after a noncombat item use.
   Assert `battleState` enters `CANTO_MOVING` only where allowed, with the remaining MOV
   budget. Add a variant through a serialized level-up checkpoint.
2. **Measured Step migration.** A saved Gaspar with `canto` loads with `measured_step` once.
   Normalization never re-adds `canto`.
3. **Special traits.** Never rolled for any other unit; present on a new Gaspar; added to an
   old save; text renders.
4. **Refusals.** Reclass seal and Master Seal on Gaspar show a refusal line, and the seal
   count is unchanged, at every surface.
5. **Low-HP latch.** Three combats at low HP give one quip. A lord crit quip in the same
   battle is not suppressed.
6. **Rapier damage pin.** Forecast damage against a plain target and an Armored or Cavalry
   target, with hand-derived expected values.
7. **Alternate commander + Gaspar** start run (commander choice), and a **Vanguard four-starter**
   deploy.
8. **Boundary averages.** `resolveTeamAverageLevel([gaspar])`,
   `resolveRecruitNodeLevel({roster:[gaspar]})` and `revivalCatchUpPlan(x, [gaspar])`.
9. **Meta integration.** `startRun` with real `metaEffects.growthBonuses` on Dusk yields the
   hand-computed growths. This pins `_getGrowthBonusMultiplier` wiring.
10. **Band.** Replace the re-derived expectation with a hand-computed value.

## Out of scope (still open from the main spec)

Full-run validation: paired seeds, arms, 200 runs, feeding and Sera-bait policies.
`sim:fullrun:pr` cannot see Gaspar's effect; both Act 1 pressure slices lose all 12 runs on
main and on this branch. Human playtesting remains the balance gate until that exists.
