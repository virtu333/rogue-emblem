# Choose Your Commander — Feature Spec

**Status:** Implemented (all four phases of Section 12, 2026-06-11) — retained as the design record
**Feature:** Late-game meta unlock that lets the player choose which lord(s) they start a run with, replacing the fixed Edric + Sera pair.
**Date:** 2026-06-11

---

## 1. Summary & Goals

Today every run starts with the same two lords: **Edric** (Lord, sword, permadeath anchor) and **Sera** (Light Sage, healer). The other five lords in `data/lords.json` — Kira, Voss, Rowan, Astrid, Cael — are only obtainable mid-run via the third-lord event (Power of Friendship), boss recruit, or recruit nodes.

This feature adds a **high-cost, late-game Valor purchase** that unlocks choosing the starting lords:

- **Tier 1 — Choose your Commander.** Pick any of the 7 lords as the run's commander (the permadeath anchor). The partner slot stays on the default (Sera; Edric if Sera is the commander).
- **Tier 2 — Choose your Partner.** Also pick the second starting lord from the remaining 6.

Goals:
1. Major replayability lever and the largest single Valor sink in the game (aimed at players who have already beaten the game).
2. Zero behavior change for players who haven't bought it, for no-meta runs, and for all existing saves.
3. Pay down the "Edric is hardcoded" debt with a reusable **commander abstraction** that future features (campaigns, challenge modes) can build on.

The investigation below found the change is very tractable: the third-lord system already builds any lord as a playable unit, all 7 lords have complete data/sprites/portraits, and the tutorial is fully decoupled from real runs. The hard part is a disciplined rename of "Edric" semantics into "commander" semantics across ~14 source files.

---

## 2. Player Experience

1. **Purchase.** In Home Base → Lord Bonuses (Valor), buy *Banner of Command* — gated behind **Power of Friendship Lv1 + beating Hard**, positioning it as an explicit endgame/NG+ feature. *Chosen Companions* (partner choice) appears beneath it, chained on Banner of Command.
2. **Select.** A new **Commander panel** in Home Base shows the 7 lord portraits with class, weapon type, personal skill, and base stats/growths. The player picks a commander (and, with Tier 2, a partner). The selection **persists across runs** (like starting-skill assignments) until changed; default is Edric + Sera.
3. **Confirm.** The Difficulty Select screen shows a small `Commander: Cael · Partner: Sera` line next to the existing `Meta Upgrades: ON` toggle, so the loadout is visible before launch.
4. **Run start.** The run begins with the chosen pair. The commander is the locked deploy, the recruit-scaling anchor, and the unit whose death ends the run. All "starting equipment" meta upgrades apply to the chosen pair (generalized per Section 7).
5. **Knock-on.** Lords not chosen (including Edric and Sera) enter the mid-run lord pool: third-lord event, boss recruit, recruit nodes.
6. **No-meta runs** (`Meta Upgrades: OFF`) always start Edric + Sera — this falls out automatically because `BlessingSelectScene` passes `metaEffects = null` when `noMetaUpgrades` is set (`src/scenes/BlessingSelectScene.js:71-77`).

---

## 3. Current State — Where Edric/Sera Are Wired In

### 3.1 The fixed starting pair

- `RunManager.createInitialRoster()` (`src/engine/RunManager.js:2261-2379`) hardcodes Edric + Sera by name, including Edric-specific loadout (extra Steel Sword, Deadly Arsenal swords, starting accessory) and Sera-specific loadout (Staff proficiency push, Heal staff + Healer's Art tiers).
- `BossRecruitSystem.getAvailableLords()` (`src/engine/BossRecruitSystem.js:161-165`) excludes the hardcoded set `{'Edric', 'Sera'}` from the mid-run lord pool.

### 3.2 Edric as permadeath/objective anchor

- Defeat check: `BattleScene.checkBattleEnd()` (`src/scenes/BattleScene.js:9546-9554`) — "Edric defeat = immediate loss"; an escaped Edric counts as alive.
- Escape victory: `src/scenes/BattleScene.js:9571-9576` — victory requires `edricEscaped && !lordsOnField`.
- Vision rewind (run-revive on lord death): mechanic is name-agnostic (`RunManager.visionChargesRemaining`, `getBaseVisionCharges()` at `src/engine/RunManager.js:381-384`), but the prompt copy is `"Sera's vision fractures!"` (`src/ui/VisionRewindController.js:347`).
- Lord farewell on death is explicitly non-Edric (`src/scenes/BattleScene.js:8308-8312`); `data/dialogue.json` has `lordFarewell` entries for all lords **except Edric**.

### 3.3 Edric as scaling anchor

- `RecruitScaling.resolveRecruitScalingTargets()` (`src/engine/RecruitScaling.js:5-19`) — "Edric is the sole scaling anchor"; finds him by name to derive recruit levels, promotion targets, and boss-recruit levels.
- `ColosseumOverlay` (`src/ui/ColosseumOverlay.js:1204-1209`) — checks `hasEdric` with an existing fallback comment for "custom rosters/campaigns that do not include Edric by name."

### 3.4 Meta upgrades targeting the pair

| Upgrade | Effect key | Current behavior | Coupling |
|---|---|---|---|
| Deadly Arsenal I/II | `deadlyArsenalTier` | Replaces Edric's Steel Sword with Rapier; tier 2 adds Silver Sword (`RunManager.js:2181-2205`) | Sword-only, Edric-only |
| Battle Trinket | `startingAccessoryTier` | Accessory equipped on Edric (`RunManager.js:2342-2348`) | Edric-only |
| Healer's Art | `startingStaffTier` | Upgrades Sera's staff (`RunManager.js:2303-2307`) | Sera-only |
| Honed Blades | `startingWeaponForge` | Forges both lords' weapons | Generic ✓ |
| Iron/Steel Arms + Art Adept | `ironArms`/`steelArms`/`artAdept` | Weapon-art spawns on starting weapons — already pooled **per weapon type and tier** (`RunManager.js:1948-2002`) | Generic ✓ |
| Field Supplies | `extraVulnerary` | Extra Vulnerary on Edric | Trivial |
| Lord stat/growth upgrades | `lordStatBonuses`/`lordGrowthBonuses` | Applied to every lord via `_applyLordMetaBonuses` | Generic ✓ |
| Starting skills | `startingSkills` | Keyed by lord **name** — engine is generic; Home Base UI filters to Edric/Sera (`src/scenes/HomeBaseScene.js:1104`) | UI-only |
| Power of Friendship | `thirdLordMode` | Third lord joins after battle 3; modes random/pick3/pick3_reroll/pick_all | Generic ✓ — **and the direct precedent for this feature** |
| Sera's Revelation | `visionChargesBonus` | +Vision charges | Name is flavor only |

Shop description strings hardcode names at `src/scenes/HomeBaseScene.js:923, 929, 930`.

### 3.5 UI / presentation

- **Deploy screen** (`src/ui/DeployScreenOverlay.js:77-256, 456`): Edric is auto-selected, row rendered with a LOCKED badge and no click handler; hint text says "Edric always deploys."
- **Sprites** (`src/scenes/BattleScene.js:2724-2731`): Edric has tier-specific sprites (`lordedric`/`greatlordedric`, loaded by name in `BootScene.js:111-112`); other lords use a single name-keyed sprite for both tiers. Asset check: all 7 lords have a base sprite in `assets/sprites/characters/` and a portrait `lord_<name>.png`; only Edric has a promoted variant.
- **Help text** (`src/data/helpContent.js:354, 419`): "If Edric (your lord) falls, the run ends."
- **Tutorial**: fully standalone — launched from `TitleScene` with its own scripted roster from `buildTutorialRoster()` (`src/engine/TutorialHelpers.js:35-73`, Edric Lv3 + Sera Lv3). It never touches the real run roster.
- **Dialogue** (`data/dialogue.json`): story-sequence speakers include Edric and Sera; victory narration is Sera's; Sera's farewell line names Edric; Edric has a recruit line (usable if he becomes recruitable) but no farewell.
- `src/utils/devStartup.js:185` and the standalone fallback at `src/scenes/BattleScene.js:972-977` reference Edric for dev/QA paths.

### 3.6 What's already generic (no changes needed)

- `createLordUnit()` (`src/engine/UnitManager.js:178-231`) builds any lord from data: proficiencies, personal growths, personal skill parsing, L20 skill, promotion metadata.
- `createBossLordUnit()` + `generateThirdLordCandidates()` (`src/engine/BossRecruitSystem.js:171-260, 587-639`) level/promote any lord to the current scaling target.
- Run/battle serialization, suspend checkpoints, and cloud sync carry the roster as data with no name assumptions.
- All 7 lords' portraits are already preloaded.

---

## 4. Design: The Commander Abstraction

Introduce **commander** as a first-class concept = "the unit whose death ends the run." This is the keystone refactor and ships first, with zero behavior change.

```js
// Unit flag (serialized with the unit — serializeUnit spreads {...unit}, so
// no whitelist changes needed; survives suspend/resume):
unit.isCommander = true;   // exactly one living-or-escaped roster unit

// New pure module src/engine/Commander.js:
findCommander(units)       // flag → Edric by name. NO first-lord fallback —
                           // keeps today's no-Edric defaults (RecruitScaling
                           // level-1 anchor, Colosseum's own fallback) intact.
stampCommanderFlag(units)  // healing: flag → Edric → first isLord; stamps the
                           // winner, clears stray duplicate flags, returns it.

// RunManager API:
getCommander()             // findCommander(this.roster)
getCommanderName()         // convenience for name-based checks/UI
getStartingLordNames()     // ['Edric','Sera'] in PR 1; metaEffects-driven in PR 2
```

**Stamping points** (every unit pool that feeds a flag-strict check must be healed, because three pools never pass through `createInitialRoster`):

1. `createInitialRoster` — flag on the commander slot at creation.
2. `RunManager.fromJSON` — stamp `rm.roster` (next to the existing `isLord` repair at `RunManager.js:3390-3403`).
3. `RunManager.fromJSON` — **also stamp the suspended-battle checkpoint** (`battleInProgress.checkpoint.playerUnits` + `escapedUnits` as one combined pool — the commander may be among the escaped). Verified: the checkpoint is assigned raw at `RunManager.js:3694-3702` and `BattleSuspendController.applyUnits` restores its unit arrays directly into the scene, so it does **not** flow through the roster path. Without this, resuming a legacy suspended battle under a flag-strict defeat check would instantly game-over.
4. `BattleScene` — defensive stamp right after the player-unit population branch (covers tutorial roster from `buildTutorialRoster()`, the standalone dev fallback, and resume — none of which pass through RunManager).
5. `tests/harness/HeadlessBattle.js` — same stamp after player-unit setup, and its mirrored defeat check converts identically, keeping harness/scene parity.

**After stamping, the defeat/escape checks are strict on the flag** (no lookup fallback at check time). This is deliberate: a fallback there would silently change the rule "commander dead but other lords alive → defeat" into "promote the next lord to commander."

Call-site conversions (all behavior-preserving while commander = Edric):

| Site | Change |
|---|---|
| `BattleScene.checkBattleEnd()` defeat + escape-victory checks (`9546-9576`) | `name === 'Edric'` → `unit.isCommander` (escaped-units check included) |
| `RecruitScaling.resolveRecruitScalingTargets()` | anchor = `findCommander(units)` (flag → Edric only — no first-lord fallback, so no-Edric rosters keep the level-1 default pinned by `tests/RecruitScaling.test.js`). Rename internals `edricLevel` → `anchorLevel`; result gains `anchorPromotedLevel`, keeping `edricPromotedLevel` as a deprecated alias key |
| `BossRecruitSystem.getAvailableLords()` | new param `startingLordNames` (callers pass `runManager.getStartingLordNames()`) |
| `ColosseumOverlay:1204` | `hasEdric` → has commander (the fallback branch already exists) |
| `DeployScreenOverlay` lock rules (`77-256`) | `isEdric` → `unit.isCommander`; hint becomes "Your commander always deploys." |
| Lord farewell guard (`BattleScene:8308`) | `name !== 'Edric'` → `!unit.isCommander` |
| `helpContent.js`, deploy hint | "Edric (your lord)" → "your commander" |
| `devStartup.js:185`, `BattleScene:972` fallback | find commander / keep Edric (dev-only; either is fine) |

Explicitly **unchanged**: the tutorial (standalone Edric+Sera script — the player bought this upgrade long after the tutorial), `VisionRewindController` mechanics, suspend/resume, blessing system, turn-par.

---

## 5. Meta Upgrade Definition (data)

`data/metaUpgrades.json`, category `lord_bonuses` (Valor — consistent with `CATEGORY_CURRENCY` in `src/utils/constants.js:226-233`). Two separate upgrade entries chained via `requires.upgrades` — the same pattern as Deadly Arsenal I/II and Lethal Armory I–III, so no schema changes:

```json
{
  "id": "commander_choice",
  "name": "Banner of Command",
  "description": "Choose which lord leads your army at run start",
  "category": "lord_bonuses",
  "maxLevel": 1,
  "costs": [1500],
  "requires": {
    "upgrades": [{ "id": "legendary_heir", "level": 1 }],
    "milestones": ["beatHard"]
  },
  "effects": [{ "commanderChoiceTier": 1 }]
},
{
  "id": "partner_choice",
  "name": "Chosen Companions",
  "description": "Choose your second starting lord as well",
  "category": "lord_bonuses",
  "maxLevel": 1,
  "costs": [1000],
  "requires": {
    "upgrades": [{ "id": "commander_choice", "level": 1 }],
    "milestones": ["beatHard"]
  },
  "effects": [{ "commanderChoiceTier": 2 }]
}
```

- **Decided gating (NG+ positioning):** both upgrades sit behind **Power of Friendship** (`legendary_heir` Lv1, itself gated on `beatHard`). The full chain reads: beat Hard → unlock the third-lord system → unlock commander choice → unlock partner choice. Thematically the third-lord event introduces the other lords mid-run; this upgrade then graduates them to run-start.
- The explicit `beatHard` milestone is technically redundant (transitive through `legendary_heir`) but is included deliberately: `isMilestoneLocked` drives the "???" mystery display in the shop, and that check only reads the upgrade's own milestones.
- **Costs decided: 1500 / 1000 Valor** — the largest Valor items in the game (Power of Friendship tier 1 is 1000). Sim matrix may still adjust (Section 11), but these are the shipping defaults.
- `getActiveEffects()` accumulates `commanderChoiceTier` via `max()`, mirroring the existing `deadlyArsenalTier` handling (`MetaProgressionManager.js:525-530`).

---

## 6. Persistent Selection State & Cloud Sync

Follow the `skillAssignments` precedent exactly (`MetaProgressionManager.js:64, 369-402, 727-757`):

```js
// MetaProgressionManager
this.lordSelection = { commander: 'Edric', partner: 'Sera' }; // persisted

setCommander(name)  // validates: lords.json name; tier >= 1; != partner (auto-swap partner to default if collision)
setPartner(name)    // validates: lords.json name; tier >= 2; != commander
getLordSelection()  // returns validated copy with fallbacks applied
```

- **Persistence:** add `lordSelection` to the `_save()` payload — cloud sync inherits it automatically since `onSave(payload)` ships the whole payload.
- **Merge:** in `_adoptForeignDiskStateIfNewer()` adopt the disk value when local is unset/default (same adopt-if-absent rule as `skillAssignments`, `MetaProgressionManager.js:719-723`).
- **Validation at read time** (inside `getActiveEffects()`, like the `startingSkills` trim at `551-558`): unknown lord name → default; tier 0 → `{Edric, Sera}`; tier 1 → commander honored, partner forced to default (Sera, or Edric when commander is Sera); commander == partner → partner reset to default.
- **Refund** (`refundUpgrade`, `622-660`): refunding tier 2 resets `partner` to default; refunding to 0 resets the whole selection — mirrors the existing skill-unlock auto-unassign behavior.
- **Exposure:** `getActiveEffects()` emits `startingLords: { commander, partner }` (post-validation). `RunManager` consumes `metaEffects.startingLords` — so no-meta runs and missing-effect saves degrade to Edric+Sera with zero special-casing.

---

## 7. Run Start Changes (`createInitialRoster`)

Rewrite `createInitialRoster()` (`RunManager.js:2261-2379`) to be slot-driven:

```
const { commander, partner } = this.metaEffects?.startingLords ?? { commander: 'Edric', partner: 'Sera' };
buildStartingLord(lordDef, { isCommander })  // shared path for both slots
```

Per-slot loadout rules, generalized from today's behavior:

1. **Base kit (any lord):** `createLordUnit` + `_applyLordMetaBonuses` + Vulnerary (+ `extraVulnerary` on the commander). Unchanged.
2. **Commander extra weapon** (today: Edric's Steel Sword): grant a Steel-tier weapon of the commander's **primary proficiency** using the existing `LETHAL_ARMORY_WEAPONS[type].steel` table (`src/engine/UnitManager.js:622-653` — covers Sword/Lance/Axe/Bow/Tome/Light, i.e. every lord's primary). Voss (Swords+Bows) uses his first proficiency (Swords), matching `getDefaultWeapon` ordering.
3. **Deadly Arsenal, generalized per type — with signature weapons (decided):**
   - Tier 1 replaces the Steel slot with the type's signature weapon:
     | Type | Tier-1 weapon | Notes |
     |---|---|---|
     | Sword | Rapier | current behavior |
     | Lance | Horseslayer | existing; Steel tier, effective vs Cavalry |
     | Axe | Hammer | existing; Steel tier, effective vs Armored |
     | Bow | Killer Bow | existing; crit niche (no effective bow in the catalog) |
     | Tome | **Witchfire** *(new)* | killer-line tome: Steel tier, ~25-30 crit |
     | Light | **Sunflare** *(new)* | killer-line light tome: Steel tier, ~25-30 crit |
   - **Two new weapons** (names are placeholders — finalize in PR 2): killer-line casters rather than effective-damage casters, because magic already targets RES (armored enemies are naturally weak to it), so an "anti-armor tome" would be redundant where Rapier is not. Stats/prices mirror the Killing Edge / Killer Lance family.
   - **Bonus synergy:** the new weapons also fill the `killer: null` gaps for Tome/Light in `LETHAL_ARMORY_WEAPONS` (`UnitManager.js:643-652`), so Lethal Armory II/III stop falling back to Steel for caster recruits — a small free upgrade to an existing purchase.
   - Like Rapier (priced 1800, shop-eligible), the new weapons enter the normal shop/loot pools; verify pool weights in the PR 4 balance pass.
   - Tier 2 adds + auto-equips the type's silver weapon via `LETHAL_ARMORY_WEAPONS[type].silver` (Bolganone/Aura for casters).
   - The unused `DEADLY_ARSENAL_POOL` constant (`constants.js:288-295`) shows this generalization was already anticipated; either use it for a random-pick variant or delete it when this lands.
   - Shop description (`HomeBaseScene.js:923`) becomes "Commander's starting weapon upgrades."
4. **Sera's healer kit travels with Sera, not the slot.** The Staff proficiency push and Heal staff (`RunManager.js:2296-2307`) apply only when Sera is in the starting pair. **Healer's Art is inert without Sera** — the shop card shows "Inactive: Sera not selected" (same UI affordance as milestone-locked rows). Deliberately *not* granting staves to arbitrary partners: that would erase Sera's identity and swing balance. Choosing to start without a healer is the intended tradeoff (see Section 11).
5. **Battle Trinket** accessory → commander. **Honed Blades**, **Iron/Steel Arms**, **Art Adept** already iterate the lords array and pool arts per weapon type — pass the new pair through unchanged.
6. **Starting skills** apply by name (`startingSkills[unit.name]`) — already correct for any pair. Assignments for non-selected lords persist harmlessly (they simply don't apply), so switching commanders preserves each lord's configured skills.
7. **Commander flag:** `isCommander = true` on slot 1; serialized with the unit.
8. **Third lord / boss recruit / recruit node pools:** pass `getStartingLordNames()` into `getAvailableLords`. Edric and Sera become recruitable when not chosen. All 7 lords already have `lordRecruitLines` entries in `dialogue.json`, so a recruited Edric/Sera speaks correctly out of the box; the only content gap is a `lordFarewell` entry for Edric (needed once he can fall as a non-commander; the renderer already guards on missing pools, `BattleScene.js:8310-8312`).

---

## 8. Presentation Changes

- **Sprites** (`BattleScene.getSpriteKey`, `2724-2731`): replace the Edric special case with a lookup table `LORD_SPRITE_KEYS = { Edric: { base: 'lordedric', promoted: 'greatlordedric' } }` falling through to the existing name-key → class-key chain. Non-Edric lords keep their single sprite at both tiers (status quo). Optional art backlog: promoted variants for the other six via the Imagen pipeline.
- **Vision prompt copy** (`VisionRewindController.js:347`): `"Sera's vision fractures!"` when Sera is in the run roster, else `"A vision fractures!"`. Mechanic untouched.
- **Dialogue:** act transitions are voiced by Edric and Sera (`actTransitions` keys: Edric speaks in `act2_to_act3`, `act3_to_act4`, `act4_to_finalBoss`; Sera elsewhere), and all `runComplete` narration is Sera's. v1 keeps the scripts as-is except: (a) speaker `Edric` renders as the commander (template token `{commander}`, portrait resolved by name — small addition to the dialogue renderer); (b) Sera-spoken entries fall back to the partner when Sera is absent. Full per-lord narrative variants are out of scope (Section 14).
- **Home Base:**
  - New **Commander panel** (reachable from the Lord Bonuses tab or the existing starting-skills screen): 7 portrait cards showing name, class, weapon type, MOV/move type, personal skill, and the L20 skill; locked state until `commander_choice` purchased; partner picking enabled at tier 2. Reuse the card layout patterns from `LordArrivalOverlay` (portrait + statline + confirm).
  - Starting-skills screen (`HomeBaseScene.js:1104`): filter lords by `getLordSelection()` instead of the hardcoded Edric/Sera pair. Layout already renders two cards; it keys off the filtered list, so only the filter changes.
  - Description strings at `923/929/930` reworded to commander/partner phrasing.
- **Difficulty Select:** one status line `Commander: <name> · Partner: <name>` near the meta toggle (`DifficultySelectScene.js:393`), hidden when the upgrade isn't owned.
- **Deploy screen:** LOCKED badge follows `isCommander` (Section 4).

---

## 9. Save Compatibility & Edge Cases

| Case | Handling |
|---|---|
| Legacy run save (no `isCommander`) | `fromJSON` stamps Edric (fallback chain) on the roster **and separately on the suspend checkpoint's player+escaped pools** — the checkpoint is restored raw and bypasses the roster path (see Section 4 stamping points) |
| Legacy meta save (no `lordSelection`) | defaults to `{Edric, Sera}`; tier 0 ignores it anyway |
| Cloud meta conflict | adopt-if-absent merge (Section 6); selection is small and non-monotonic, so last-writer-wins via `savedAt` is acceptable |
| Upgrade purchased mid-run | no effect until next run (metaEffects are snapshotted at run creation — existing behavior) |
| Commander dies with Vision charge | unchanged — Vision rewind already keys off the defeat check, which now keys off `isCommander` |
| Escape objective | victory check becomes commander-escaped && no lords on field; objective label is already lord-generic |
| Commander = Sera (tier 1) | partner defaults to Edric; both healer kit and commander kit apply to Sera |
| All 7 lords in roster (pick_all third lord + boss recruits) | `getAvailableLords` returns `[]`; `generateThirdLordCandidates` already returns `null`; overlay already no-ops |
| First-battle composition (`firstBattleFightersOnly`) | unchanged; axe-heavy first battle is mildly easier for sword commanders, harder for Kira — covered by the balance pass |
| Run summary / RunComplete | roster-driven already; verify commander name renders where "Edric" was implied |

---

## 10. Testing Plan

Existing suite: ~45 test files reference Edric, but the default selection keeps every current behavior, so the refactor PR should land green with only targeted updates (e.g., tests that assert the literal hint string or `getAvailableLords` signature).

New coverage:

1. **Commander abstraction:** flag stamping on new run + legacy deserialize fallback chain (roster **and** suspend-checkpoint pools, including commander-among-escaped); battle-setup stamping for rosters that bypass RunManager (tutorial/standalone/harness); defeat/escape/farewell/deploy-lock keyed off the flag (non-Edric commander fixtures); stray-duplicate-flag cleanup.
2. **MetaProgressionManager:** selection validation matrix (tier gating, collisions, unknown names, refund resets, merge adoption, payload round-trip).
3. **createInitialRoster parameterized:** each of the 7 lords as commander — correct extra weapon per primary proficiency, Deadly Arsenal table per type, trinket on commander, staff kit present iff Sera, weapon-art spawns and forges on the pair, starting skills by name.
4. **Pool exclusion:** `getAvailableLords` with custom pairs (Edric/Sera recruitable; chosen pair excluded).
5. **RecruitScaling:** anchor follows a promoted non-Edric commander; Colosseum fallback.
6. **Integration:** escape victory with non-Edric commander (extend `tests/EscapeObjective.test.js`); Vision prompt copy with/without Sera.

CI note: if the balance pass moves any strict slice thresholds in `tests/sim/fullrun-slices.js`, the PR body must include the threshold-triage fields enforced by `tools/checkThresholdPrNotes.js`.

---

## 11. Balance Considerations & Sim Plan

Per-commander deltas worth measuring before tuning costs:

- **No Sera ⇒ no starting healer and no Renewal Aura.** Early-act sustain collapses to Vulneraries until a staff user is recruited. **Decided: ship with no compensation** — this is an endgame choice and managing it is deferred to the player. The sim matrix acts only as a tripwire: if a Sera-less pair drops Act 1 winrate dramatically vs. the Edric+Sera baseline (alarm threshold ~10 points on Normal), revisit with +1 Vulnerary as a measured fix — never free staves.
- **Losing Charisma** (Edric's +10 Hit/+5 Avoid aura) is a real army-wide nerf when Edric isn't fielded — partially self-balancing against stronger personal kits.
- **Rowan (Cavalry, MOV 5)** and **Astrid (Flying)** commanders accelerate seize/escape pacing and interact with turn-par bonuses; Astrid ignores pursuit terrain on escape maps.
- **Cael** (HP25/STR9/DEF9 + Intimidate) is likely the strongest stat commander; **Kira** (squishy, MAG-based, +1 Tome range) the riskiest with the fighters-only first battle.
- **Recruit scaling** is unaffected structurally (anchor generalizes), but commander class changes which loot weapons the roster can use (`lootTables` filter by proficiencies).

Sim support (shipped in PR 4): `--commander <name> [--partner <name>]` on both `sim/fullrun.js` (abstract Monte Carlo) and `tests/sim/fullrun-runner.js` (real-engine harness, via `metaEffects.startingLords` through `RunSimulationDriver`), plus `--meta-preset endgame` on the harness runner (every upgrade maxed via the real `MetaProgressionManager` — the loadout an actual purchaser has).

### Matrix results (2026-06-11, 12 harness seeds Normal / 400 abstract trials)

**Instrument limitation:** neither agent can produce a meaningful *winrate* at realistic strength — the scripted harness agent is a flow harness, not a skilled player (at zero meta every pair loses; at endgame meta every pair stalls into action-budget timeouts because maxed `lordStatBonuses` make battles unloseable but the agent can't close them — pre-existing behavior, it's why the PR gates run `--invincibility`). The usable signal is **relative early-run survival**, and the two instruments agree on the ordering:

| Pair | Harness avg nodes (0-meta) | Abstract avg battles (meta 2) |
|---|---|---|
| Cael + Sera | 5.7 | 6.1 |
| Voss + Sera | 5.7 | 6.2 |
| **Cael + Kira (Sera-less)** | **5.8** | **5.8** |
| Edric + Sera (baseline) | 2.6 | 3.0 |
| Sera + Edric | 1.8 | 1.8 |
| Kira + Sera | 1.4 | 1.5 |
| Rowan + Sera | 1.3 | 3.0 |
| Astrid + Sera | 1.1 | 2.0 |

Findings:
1. **Sera-less tripwire: clear.** Removing Sera barely moves survival for the same commander (Cael+Kira ≈ Cael+Sera on both instruments). Commander bulk dominates; healer absence does not. The "ship with no compensation" decision stands on data, not just principle.
2. **Durability ordering matches the Section 11 predictions:** Cael/Voss far above baseline; Kira, Astrid, and a commanding Sera are the high-risk picks. This is the intended skill-expression spread for an endgame unlock — no stat compensation.
3. **Costs confirmed at 1500/1000 Valor.** Nothing in the data argues the unlock is over- or under-powered as a purchase; it is a sidegrade selector, not a power buy.
4. **No threshold re-baselines needed:** the default pair's behavior (and therefore every PR-gate slice) is unchanged; the full slice suite passes untouched.

---

## 12. Phased Implementation Plan

**PR 1 — Commander abstraction (no behavior change).**
`isCommander` flag + RunManager accessors + fallback chain; convert all call sites in Section 4; copy changes ("your commander"); tests. Riskiest-by-breadth but mechanically simple; full suite must stay green with zero gameplay diffs.

**PR 2 — Meta upgrade + selection + roster generalization.**
`commander_choice` + `partner_choice` data; the two new caster signature weapons in `weapons.json` + `LETHAL_ARMORY_WEAPONS` killer-gap fill; MetaProgressionManager state/validation/refund/merge; `getActiveEffects().startingLords`; `createInitialRoster` slot rewrite incl. Deadly Arsenal/extra-weapon generalization and Sera-conditional staff kit; pool exclusion plumbing; Home Base Commander panel + skills-tab filter + shop strings; Difficulty Select status line.

**PR 3 — Presentation polish.**
Sprite lookup table; Vision prompt conditional copy; dialogue `{commander}` token + Sera-absence fallback; Edric `lordFarewell` lines in `dialogue.json`; help-content rewording.

**PR 4 — Balance pass.**
Sim matrix, cost/gate tuning, any compensation mechanics, threshold re-baselines with triage notes. *Outcome (see Section 11): costs confirmed, no compensation, no re-baselines; `--commander/--partner` and `--meta-preset endgame` tooling shipped.*

---

## 13. Design Decisions (resolved 2026-06-11)

1. **Gating:** both upgrades locked behind **Power of Friendship Lv1** (+ explicit `beatHard` for the "???" shop display) — deliberate endgame/NG+ positioning. Implemented as two chained upgrade entries (`commander_choice` → `partner_choice`), the existing Deadly Arsenal I/II pattern, so no schema changes.
2. **Costs:** **1500 / 1000 Valor** confirmed, with the upgrade-chain gate carrying the rest of the weight. Sim matrix may fine-tune.
3. **Caster Deadly Arsenal:** **add two new signature weapons** (killer-line Tome + Light, placeholder names *Witchfire* / *Sunflare*) instead of forge compensation — picking a caster commander should feel exciting. They double as the missing `killer` entries for Lethal Armory.
4. **Sera-less sustain:** **no compensation.** Endgame players manage it themselves; sims act only as a tripwire (Section 11).
5. **Selection placement:** **persistent Home Base panel** + Difficulty Select status line. A per-run override can be layered on later without rework.

Remaining open (small, decide inside PR 2/4): final names/stats/prices for the two new weapons, and their shop/loot pool weights.

## 14. Out of Scope

- Per-lord story campaigns / full narrative variants (template-token substitution only).
- Promoted-tier sprites for the six non-Edric lords (optional art backlog).
- Choosing >2 starting lords, random-commander modes, or commander-specific blessings.
- Tutorial changes — it stays the scripted Edric+Sera intro.
