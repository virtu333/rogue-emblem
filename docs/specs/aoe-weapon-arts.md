# Area-of-effect weapon arts

Status: spec, 2026-10-01. Nothing built yet. The owner's decisions below are binding;
the open questions are at the end.

**Builds:** Splash v2 (each victim's own DEF/RES/effectiveness, XP credit, tile
preview); a preview for every area art; pick-a-center targeting; Line Pierce at range;
Sweeping Cleave; Benediction; Battering Ram; a kill-move for Oathaxe; XP for area kills
(existing arts too); enemy AI scoring for area arts.
**Skipped:** cones (Dragon Breath / Flame Fan). Twinsworn Tempest and Starfall Volley
stay stat-only.
**Kept on purpose:** a hit on a fogged victim still shows its floating label after the
action resolves (owner: an intended reveal). Nothing shown *before* commit may depend on a
hidden unit.

Line refs are `origin/main` @31fb3524 unless marked **#175**
(`fix/stability-combat-boundaries` @8d0eef99) or **#171**
(`fix/stability-death-cleanup` @8788e247).

## 1. What exists today (verified)

- **Data.** `data/weaponArts.json` has 83 arts. Every one has `targeting: "normal_attack"`.
  The field is required by `schemas/weaponArts.schema.json:36,54`, but nothing in `src/`
  reads it, so it is free to give meaning. Splash arts use `effects.aoeSplash`: Burning
  Quake, Radiant Burst, Barrage, Cataclysm, Tempest and Cataclysm Bolt (all player-only,
  act 3). Pierce arts use `afterCombat: pierce_through`: Piercing Charge and Doom Thrust.
  #137 renames display names only (Burning Quake → Cinder Quake, Galeforce Assault →
  Oathstorm); ids don't change. So this spec names arts by id, and every new art is
  additive.
- **Pipeline.** `getPostCombatPipelineSteps` (`WeaponArtPostCombat.js:92-305`) feeds the
  generator in `PostCombatEffects.js:39`. The scene and the harness both drive it
  (`HeadlessBattle.js:1717-1738`).
- **Splash.** `splashTargets` / `splashDamage` (`PostCombatEffects.js:314-354`) deal a
  share of the *first landed hit on the primary* (`WeaponArtPostCombat.js:269-289`). So
  the victim's own DEF, RES and effectiveness are ignored, and Tempest's 3× vs fliers only
  reaches the primary. Radiant Burst's `maxTargets: 1` picks the foe with the lowest HP%
  (`:325-334`).
- **Pierce** (`:258-298`) needs cardinal adjacency (`:262`) and hits exactly one unit
  (`WeaponArtSystem.js:219-227` forces `maxTargets: 1`). Each landed primary strike's
  damage is applied again to that unit.
- **Targets** come from `world.hostilesOf` (`BattleScene._getTier5HostileUnitsFor`
  `:8607`). That list includes fogged units, which is right for execution. The precedent
  for previews is `AbilityController._seenHostiles` (`:65`), plus the seen-only tile tint
  in `_showConfirmPrompt` (`:323-334`) over `ActionAbilitySystem.collectAffected`
  (`:109`).
- **Deaths.** A `remove` beat calls `removeUnit` in the middle of the effects. On **#175**
  that is `_playPostCombatBeats` `:8779`, where `remove`/`moved` are required and
  everything else is guarded. This happens before `executeCombat` awards the primary's XP
  and removes the primary (**#175** `:8601`). `removeUnit` (**#175** `:9283`) checks the
  roster and recurses for Deathburst (`:9458+`); chains never decide the battle.
  `_sweepFallenUnits` (`:9526`) reconciles what is left. **#171** adds `hasBattleDefeat`
  right after the sweep (`engine/BattleDefeat.js`), so a fatal cascade ends the battle
  before any level-up popup can checkpoint an army with no commander.
- **XP gap.** Splash and pierce kills pay gold through `removeUnit → _applyKillRewards`
  (`:7764`) but give no XP. `BattleXp.combatXpAwards` (`:41`) knows a single opponent.
- **Labels.** `hint` beats draw at the victim's tile with `showMinorHintAt` (`:9846`),
  with no fog check. That is the intended reveal above.
- **Enemy AI.** `_scoreEnemyWeaponArt` (`WeaponArtController.js:413`) is a flat score of
  the art's mods; the harness keeps a copy (`HeadlessBattle.js:1541`).
  `ThreatForecast`/Danger know nothing about areas. In practice no enemy carries an art:
  the only code that writes `weaponArtIds` is player-side (LootSystem `:396`, RunManager
  `:2371`, RosterArtCommands, RosterOverlay, devStartup), and every legendary art is
  `allowedFactions: ["player"]`.
- **Entity splash** lives only in the scene (`_applyEntitySplash` `:10483`; **#175**
  `:10832`). It draws from `Math.random`, which during a battle *is* the seeded battle
  stream (`installBattleRng` `:2324`, `Math.random = this._battleRng` `:2352`). So it is
  deterministic for fixed-v1, but the harness never runs it.
- **Anchored** (`affixes.json:154`, "cannot be moved by Shove or Pull") sets
  `immuneToDisplacement` in combat mods (`AffixSystem.js:44`, `SkillSystem.js:275`), but
  nothing reads the flag. Art pushes (`resolvePostCombatMove` `:364-390`) check root only,
  so Overrun and Doom Thrust move Anchored foes today.

## 2. Engine primitives

### 2.1 `engine/AreaShapes.js` (new, pure)

The module is pure: no RNG, game coordinates only (a portrait board is just a
presentation transform), output in a stable order. A suspend, a rewind or a preview
always gets the same tiles.

```js
radiusTiles(center, r, bounds)              // diamond, ordered by distance, then row, then col
aroundTiles(origin, r, bounds)              // radiusTiles minus the origin
lineTiles(from, through, length, bounds)    // `length` tiles past `through` on the from→through
                                            // axis; [] unless the two share a row or column;
                                            // stops before a solid tile (bounds.isSolid)
centerTiles(origin, {min, max}, bounds)     // the legal centers for chosen_center
unitsOnTiles(tiles, units, {exclude})       // units whose footprint (getFootprint: the Entity)
                                            // meets the tiles; one entry each, in tile order
areaTilesFor(area, {attacker, target, center}, bounds)   // dispatches on area.shape
```

`isSolid` means impassable even to Flying (Wall today). Terrain is public, so a line that
stops at a wall leaks nothing. **Units never block a line**, so its geometry can't depend
on a hidden unit.

### 2.2 Per-victim damage: `Combat.areaStrikeDamage`

Extract the attacker-damage block of `getCombatForecast` (`Combat.js:954-971`) into
`strikeDamage(attacker, atkWeapon, victim, victimWeapon, victimTerrain, atkMods, defMods)`.
Then:

- `getCombatForecast` calls `strikeDamage`. Forecast numbers must not move; pin them first.
- `areaStrikeDamage(attacker, weapon, victim, {art, world})` calls the same helper with:
  - **atkMods:** the art's `combatMods`, the weapon's imbue mods and the attacker's
    `timedBuffCombatMods`. Skills, procs and accessory phase mods are left out.
  - **defMods:** only the victim's timed-buff DEF/RES.
  - The triangle against the victim's own weapon, the victim's terrain DEF and
    `getCombinedEffectivenessMultiplier` (5× cap, `negateEffectiveness`).
- An area strike never rolls hit or crit. Rule text: "an area blow is the art's own
  strike: it always lands, never crits, and skills don't trigger."
- The result is deterministic, so the same function serves execution, the preview and the
  AI. A parity test holds `strikeDamage` equal to `resolveCombat`'s non-crit strike damage
  (`:1532`) on fixtures, so the two copies can't drift.

### 2.3 One area step replaces splash and pierce

`WeaponArtSystem.getWeaponArtArea(art)` normalizes the new `area` block (§3).

**Steps.** The pipeline emits `area_damage` steps. The `aoeSplash` / `pierce_through`
normalizers, `splashTargets`, `splashDamage` and `pierceTarget` are deleted. Where a step
runs depends on the shape:

- `line`: the old pierce slot, before `postCombatMove`, so Doom Thrust still pierces and
  then pushes.
- `radius` / `around_attacker`: the old Tier 5 slot.

**`area_damage` step.**

1. **Gate.** For `normal_attack`, the source must be alive and have landed at least one
   strike.
2. **Victims.** `unitsOnTiles(areaTilesFor(...), world.hostilesOf(source), {exclude:
   primary})`, keeping live units only. `pick: "lowest_hp_pct"` with `maxTargets` keeps
   Radiant Burst's rule.
3. **Damage per victim:**
   - `scaled`: `floor(areaStrikeDamage × multiplier)`;
   - `fixed`: the amount (Cataclysm keeps 5).
   - `strikes: "each_landed"` repeats it once per landed primary strike (pierce cadence
     today); `"once"` applies it once (splash cadence today).
4. **Two phases.** First, for each victim in order: `damageUnit` (floor 1 if `nonLethal`),
   `yield hp` + `hint` ("Splash -7" / "Pierce -7"), and push a **credit** (§2.4). Then, for
   each victim now at 0 HP, in the same order: `yield remove` (killer = source). Every
   victim takes its blow before any death resolves. So a Deathburst chain can't steal a
   blow or reorder the credits, and the preview, which is phase 1, is exact.

HP changes only through `UnitHealth` (`damageUnit` / `healUnit`). The generator never
touches the scene.

### 2.4 Credits: a ledger, not a beat

`postCombatEffects(combat, world)` gets `combat.credits = []`. The area step pushes
`{ source, victim, damage, hpBefore, killed }` at the moment HP changes; nothing is pushed
for the primary. The owner reads the ledger after the generator finishes.

Why not a beat: on **#175**, beats other than `remove`/`moved` run inside
`safeBattlePresentation`. A credit carried by a beat would be lost on a cosmetic failure,
or would need a third required kind. The ledger is plain state, so the scene and the
harness read identical credits however presentation goes.

### 2.5 XP for many victims: `BattleXp.actionXpAwards`

`actionXpAwards({ unit, primary, credits, ...the inputs of combatXpAwards })` returns the
same `{unit, baseXp, share}[]`, with **one entry per recipient**:

- **Primary:** exactly what `combatXpAwards` gives today (damage ratio, kill, survival
  floor). Behaviour pinned.
- **Each credit:** `calculateCombatXP(unit, victim, killed)`. A hit that doesn't kill is
  scaled by `min(1, damage/hpBefore)`. Then multiply by the victim's own
  `getEnemyXpMultiplier`, pressure and Training Doctrine, and by
  `areaXp.hitRate` (0.5) or `areaXp.killRate` (1.0). Victims with `_noXP` are skipped.
- **chosen_center** has no primary. The credit with the highest base counts at the
  primary rate; the rest count as secondary.
- **Cap.** Area credits can't raise the action's base above
  `max(primaryBase, areaXp.actionBaseCap)` (100), and never lower the primary.
- **Mentor's Band.** Recipients are fixed once, from the holder's position after
  post-combat moves, before the holder's gain (as today). Each recipient's share is the
  sum of `calculateSharedXp` over the primary and every credit, with the same rates, under
  the same cap.
- **Scaling.** One `awardScaledXP` per recipient. `scaledXp`'s 1-XP floor and the
  level-up order apply once per action, not once per victim.
- **Not counted:** player victims of an enemy area art earn nothing (they weren't in
  combat). The primary defender keeps `survivedAttack`. A Deathburst kill belongs to the
  unit that burst (killer = the dying unit), so it earns no XP, as today.

`areaXp` is a new root block in `weaponArts.json`, so the numbers are data.

### 2.6 Order when one action kills several units

Final shape (**#171**+**#175**):

1. Strikes are applied per strike (`applyStrikeHP`), then the final HP (`applyCombatHP`).
2. Post-combat runs. Area victims fall here, in area order, each through `removeUnit`:
   gold, Zombie remains, boss bar and FOE VANQUISHED, last words, Deathburst chains.
3. Phoenix checks run for the attacker, the defender, and **every player-side area
   victim** (new: an enemy area art can drop a Brooch holder into range).
4. `awardXP` runs from the ledger, only if the attacker is alive.
5. The primary is removed, then the attacker, then `_sweepFallenUnits`.
6. **#171** `hasBattleDefeat → checkBattleEnd` runs. The commander falling anywhere in
   steps 2-5, including a chain from a splash kill, ends the run here, before popups.
7. Level-ups, then `completeResolvedAction → checkBattleEnd`. A rout cleared by the area
   wins only after XP, as today.

Seize is unchanged: a boss killed by the area unlocks the throne, and the seize itself
still needs a lord.

## 3. Data

### 3.1 Schema

`targeting` becomes the enum `normal_attack | chosen_center`. A new optional `area`:

```json
"area": {
  "shape": "radius | line | around_attacker",
  "radius": 1, "length": 2,
  "pick": "all | lowest_hp_pct", "maxTargets": 1,
  "damage": { "kind": "scaled", "multiplier": 0.6 } ,
  "strikes": "once | each_landed",
  "nonLethal": false,
  "centerRange": { "min": 2, "max": 5 }
}
```

`centerRange` is chosen_center only; `"weapon"` there means the weapon's range.
`chosen_center` requires `shape: "radius"`. Further effect blocks:

- `effects.allyHeal`: `{ "radius": 1, "percentOfDamage": 50 }`
- `afterCombat` move `mode: "ram"`: `{ "distance": 2, "collisionDamage": 5 }`
- `effects.killMove`: `{ "distance": "full" }`

### 3.2 Migrating the eight existing arts

Each `aoeSplash` / `pierce_through` becomes an `area` block with the same radius,
multiplier, maxTargets and cadence. The blow is now computed against each victim.

| Art | New area block |
|---|---|
| Burning Quake | radius 1, ×0.6, once |
| Radiant Burst | radius 1, `lowest_hp_pct`, maxTargets 1, ×0.75 |
| Barrage | radius 1, ×0.5, once (still includes Oathbow's 0.9 per-strike factor) |
| Cataclysm | radius 2, fixed 5 |
| Tempest | radius 1, ×0.75; its 3× now reaches fliers in the area |
| Cataclysm Bolt | radius 2, ×0.5 |
| Piercing Charge | line 1, ×1.0, each_landed |
| Doom Thrust | line 1, ×1.0, each_landed |

Against a victim with the primary's DEF/RES, splash numbers equal today's.

Pierce changes in one more way: today it re-applies each landed strike's actual damage,
crits included; now it applies the victim's own blow per landed strike, and that blow
never crits. Doomblade (1-2) gains a pierce at range 2, because the line shape works at
range (open question 3). Saves hold art ids, never art bodies, so no save migration is
needed.

### 3.3 New arts

| id / name | Weapons | Tier, act, rank | HP | Limits | Shape | Mods | Factions |
|---|---|---|---|---|---|---|---|
| `axe_sweeping_cleave` Sweeping Cleave | Axe, Sword | Steel, act2, Prof | 6 | map 2 | around_attacker r1, ×0.5, once | Hit +5 | any |
| `lance_skewer` Skewer | Lance, Bow | Steel, act2, Prof | 6 | map 2 | line 2, ×0.6, each_landed | Hit +10 | any |
| `light_benediction` Benediction | Light | Silver, act3, Prof | 6 | map 3 | allyHeal r1, 50% of damage dealt | Atk +2, Hit +10 | player |
| `lance_battering_ram` Battering Ram | Lance, Axe | Silver, act3, Prof | 6 | map 2 | ram 2, collision 5 | Atk +3, Hit +10 | any |
| `legend_stormcall` Stormcall | Breachbolt | Legendary, act3, Mast | 8 | map 2, turn 1 | chosen_center r1, range = weapon (3-10), ×0.8 | none | player |
| `magic_ashfall` Ashfall (scrollOnly) | Tome | Silver, act4, Prof | 9 | map 1 | chosen_center r1, range 2-5, ×0.6 | none | player |

Names are display names, kept free of FE names in the spirit of #137. Breachbolt keeps
Cataclysm Bolt and gains Stormcall as a second binding (`weaponArtIds`, at most 3).

**Power check.** Typical act 2-3 numbers, against arts that already exist:

- **Sweeping Cleave.** STR 12 + Steel Axe 11 − DEF 6 = 17 on the primary, plus about 8 to
  each adjacent foe. With two foes beside the attacker, that is +16: about Adamant Cleave's
  +14 Attack (HP 8), and only when flanked.
- **Skewer.** STR 12 + Steel Lance 10 − DEF 6 = 16, so about 9 per foe behind the target
  per landed strike, up to two foes; a doubling lancer roughly doubles it.
- **Benediction.** MAG 14 + 6 − RES 4 = 16 damage heals each adjacent ally 8. That is
  below Grave Hunger's self-drain (HP 8), but it spreads.
- **Battering Ram.** Overrun (push 1, Atk +5) plus a second tile and 5 collision damage.
- **Stormcall.** MAG 22 + 8 − RES 6 = 24 × 0.8 ≈ 19 to each of up to 5 tiles, with no
  miss and no counter. Cataclysm Bolt: about 29 at Breachbolt's 55 base Hit, plus ×0.5
  over 12 tiles. Same budget, traded for reliability.
- **Ashfall.** About 13 per victim, once per map.
- **Tempest vs fliers** reaches the 5× cap through Firstwind's own 3×, so a flier in the
  area takes about 60 and most die. The owner asked for this restore. Flagged for
  playtest.

`WeaponArtDataBalance.test.js` counts become Mast 16 and Prof 73. Every new legendary
stays Mast with HP ≥ 5 and map ≤ 2.

### 3.4 Validators and rule text

- **`tools/validateSchemas.js` / schema:** the targeting enum, the `area` shape, the root
  `areaXp`.
- **`tools/validateCrossReferences.js`:**
  - `chosen_center` needs `shape: radius` and `centerRange`, and must be player-only (the
    AI doesn't aim).
  - Reject the retired `aoeSplash` / `pierce_through` keys.
  - Every `legendaryWeaponIds` entry must name a weapon.
  - Every new scroll's `teachesWeaponArtId` must resolve.
- **`ItemKeywords.js`:** no change. Tags describe weapons, and an art's rules are its own
  rows.
- **`weaponArtDisplay.weaponArtEffectRows`:** new rows.
  - "Area: 50% blow to each foe next to you"
  - "Area: 60% blow to up to 2 foes behind the target, per hit"
  - "Aim: any tile 3-10 away; a 1-tile blast; always lands, no counter"
  - "On hit: allies next to you heal 50% of the damage"
  - "On hit: push 2; a crash deals 5 (and 5 to a foe it hits)"
  - "On kill: you may move again"
  - Splash rows lose "of the first hit". The "an area blow…" rule goes once into
    `WEAPON_ARTS_HELP`.
- **Then:** `npm run sync-data`, `check:reference`, and an icon atlas rebuild for the new
  scroll items (Skewer, Sweeping Cleave, Battering Ram and Benediction scrolls in act 2/3
  `weaponArtScroll` pools; Ashfall in act 4).

New pool entries shift loot RNG, so the content slice carries `check:threshold-pr-notes`.

## 4. Mechanics of the new effects

### Battering Ram (`mode: "ram"`)

- **Direction:** cardinal adjacency, as with push.
- **Immovable targets:** a target that is rooted, the Entity, or Anchored doesn't move and
  takes no collision. The hint is "Braced!".
- **The push:** step up to `distance` tiles. Stop before a tile that is out of bounds,
  impassable for the target's `moveType`, or holds a live unit.
- **Collision:** if the push stopped short, the target takes `collisionDamage`
  (`damageUnit`, can kill). If the obstacle is a unit hostile to the attacker, it takes
  the same damage and becomes a credit.
- **Beats:** `moved` (required), `hp`, `hint` "Crash -5", then two-phase removes.
- **Allies:** an ally of the attacker is never hurt.

### Benediction (`allyHeal`)

- **Gate:** hit-gated.
- **Amount:** `floor(hpLost × pct/100)`. `hpLost` is the HP the primary actually lost to
  the user's landed strikes, read from the strike events' `targetHPAfter`.
- **Who:** each living ally within 1 of the user, the user excluded.
- **How:** `healUnit` each one (Wounded heals 0). The `divine_charge` beat path is reused.
  Divine Charge itself keeps its single most-hurt target.

### Oathstorm kill-move (`killMove`)

The owner asked to reuse Dance/refresh. Dance hands the whole action back; Canto is the
move-only primitive that already survives a refresh.

- **Trigger:** after `executeCombat` removes its casualties, if the attacker is alive and
  not rooted and the primary died.
- **Continuation:** gains `freeMove: unit's MOV` (`ActionContinuation.js` validates an
  integer 1-20; the snapshot validator uses the same reader).
- **Move:** `completeResolvedAction → finishUnitAction(unit, { freeMove })` starts
  `startCantoMove(unit, max(freeMove, cantoRemaining))` even without a Canto skill.
- **Precedence:** Commander's Gambit wins (it already refreshes everything).
- **Data:** the placeholder `advance 1` is removed (it stood in for this,
  `weapon_arts_tier2_legendary_spec_2026-02-17.md:38-50`). `set_hp 5` and the ally buff
  stay.

## 5. Previews (all area arts, before confirmation)

**Pure planner: `engine/AreaPreview.js`.**

```
previewAreaArt({ attacker, art, target | center, knowledge, world })
  → { tiles, victims:[{unit, damage, hpAfter, kills}], heals:[...], push:{path, crash, obstacle} }
```

It runs the same `areaTilesFor`, `unitsOnTiles` and `areaStrikeDamage`, over
`createPlayerKnowledge(...).units` only.

- A hidden unit is never a victim, never a collision obstacle, and never the Radiant Burst
  pick.
- The footprint is pure geometry, so drawing it over fog is safe.
- The preview can still differ from execution because of a hidden unit (a crash the
  preview didn't show, a hidden foe that takes the Radiant Burst blow). That is the rule
  working as intended.

**Rendering: `src/ui/AreaPreviewController.js`** (`create`/`destroy`; nothing inline in
BattleScene).

- A low-alpha footprint tint, plus per-victim chips: "-8", "KO", a green "+8", and a push
  arrow with a crash star. Depths come from `uiDepths.js` constants.
- Tiles are placed with `grid.gridToPixel`, so the portrait transform is free.

**Where it shows:**

- **Normal-attack arts:** `AttackFlowController.focusTarget` / `openForecast` /
  `switchForecastTarget` show it; `cancelTargetSelection` / `closeForecast` clear it.
- **Chosen-center arts:** `AreaTargetingController` (§6) shows it.

**Forecast.** `ForecastOverlay` and the DOM forecast sheet (portrait) get an Area row:
"Area: 2 foes, 1 KO". On desktop it lists up to 3 lines ("Brigand −8 KO"), then
"+N more". Heals read "if it hits". Seen units only. Test with the longest class names at
640×480 and on the 375-wide sheet.

**Fog.** After commit, `hint` beats still draw at fogged victims. That is intended and
gets a test of its own.

**`tests/PlayerKnowledgePreviews.test.js`** gains pairs of worlds that differ only by a
hidden unit. The planner output, the forecast row, `AreaPreviewController` draw calls and
chosen-center snapping must be identical in each pair. Cases: a hidden foe in a radius; one
behind a Skewer line; one in a ram path; a hidden lower-HP% foe next to a Radiant Burst
target.

## 6. Pick-a-center flow

### Entry

Action menu → Weapon Art → a `chosen_center` art. The art's availability is
`canUseWeaponArt` plus "some center in range". It never depends on targets, so fog can't
shape the menu. The art's weapon is equipped on confirm, as with other arts.

### States

These are new `battleState` values. They are registered in every state list: the cancel
list (`BattleScene.js:3948`), `handleCancel` (`:4088`), `canForceEndTurn` (`:4187`),
`_emitMobileContext` (`:4219`) and the `InputController` click switch (`:484`). A test
greps the lists for `SELECTING_ABILITY_TILE` and requires the new states beside it. Vision
rewind stays idle-only (`VisionRewindController.js:427`), as for Attack targeting.

```
UNIT_ACTION_MENU ──pick art──▶ SELECTING_AREA_CENTER ──aim──▶ CONFIRMING_AREA_STRIKE ──fire──▶ COMBAT_RESOLVING
        ▲                         │  ▲ back                      │ re-aim (stays)
        └──────── back ───────────┘  └───────── back ────────────┘
```

**`src/ui/AreaTargetingController.js`** owns the whole flow (`create`/`destroy`, plus
`begin(unit, art)`, `aim(tile)`, `confirm()`, `back()`).

**Aiming:**

- **Range:** `centerTiles` gets a range tint.
- **Initial aim:** the cursor snaps to the nearest *seen* hostile in range, else the unit's
  own tile clamped into range.
- **Live preview:** each hover or cursor step re-runs the preview, through
  `InputController.refreshHoverInfo`, which both mouse and grid cursor already call.

**Confirm panel:** art name, HP `32→24`, the forecast Area row, [Fire] [Back].

### Input by device

| Device | Aim | Lock | Fire | Back | Cycle seen foes |
|---|---|---|---|---|---|
| Mouse | hover | left-click a legal tile | click the same tile or Fire | right-click | none |
| Keyboard | arrows (`GridCursorController.move`) | Enter/Z | Enter/Z again | Esc/X | Q/E |
| Gamepad | D-pad/stick | A | A again | B | L1/R1 |
| Touch | tap a tile | the tap locks | tap the same tile or the Confirm button | Cancel button | Prev/Next buttons |

- **Locking:** an illegal tile does nothing, and so does the first click after a camera
  drag.
- **Touch:** a new context `battle_area_target` in `MobileControls.js` shows
  [Confirm][Cancel][◀ Foe ▶]. Long-press still inspects. A press from before a geometry
  change never acts (existing).
- **Gamepad:** `padTap` drives it in e2e.

**Portrait.** The cursor's arrows already follow the drawn board
(`grid.board.displayDeltaToGrid`, `GridCursorController.js:50`). Centers are stored in game
coordinates. A turn of the phone mid-aim waits: `canSwitchBattlePresentation` needs
`PLAYER_IDLE` (`portraitBattle.js:190`), and the note reads "…when this action is done".

**Esc order.** Overlays above the battle (unit detail, pause, help) consume first
(`consumeEscEvent`); the controller checks `isEscConsumed`. Then: confirm → aiming → art
picker → action menu. The unit stays where it moved, matching Attack's cancel. End Turn
cancels the flow first.

### Suspend and resume

Aiming is UI state, so a refresh while aiming resumes at the last checkpoint, as attack
targeting does now.

Fire runs `_commitCombatIntent`'s sibling: a new `readCommittedAction` kind
(`BattlePresentationCheckpoint.js:17` accepts only `attack` today):

```
{ kind: 'area_strike', unitId, unitName, center: {col, row}, weaponArt }
```

`resumeCommittedAreaStrike` replays it, so the growth rolls after XP land the same.

The strike itself:

1. Art cost, `recordWeaponArtUse`, a Phoenix check.
2. The engine generator `areaStrikeEffects` (`engine/AreaStrike.js`): the §2.3 two-phase
   step with every victim a credit, and no counter.
3. The §2.6 tail, with continuation `kind: 'combat'` (Canto applies).

History records "called down Stormcall" plus per-victim facts, with the timeline's usual
visibility check. Rewind treats it as an action (add to `rewind-action-types`).

## 7. Enemy AI

- **Extraction.** `_scoreEnemyWeaponArt` moves to `engine/EnemyArtScoring.js` unchanged
  (pinned). The harness copy (`HeadlessBattle.js:1541-1590`) is deleted and imports it, per
  the residual-gap rule.
- **Area bonus.** `scoreAreaBonus(unit, art, target, world)` runs the preview planner with
  the *full* world (the AI sees all):
  `0.8 × Σ (min(damage, hp)/hp × 4 + kill × 6)`, plus heal value for Benediction-like arts.
  Allies are never in a hostile area, so there is no ally penalty, and a test pins that.
  The AI picks the art after choosing its target, so it doesn't reposition for a better
  area. That is acceptable at "reasonably easy".
- **Never for the AI:** `_selectEnemyWeaponArt` filters out `chosen_center` arts.
- **Dormant until enemies carry arts.** Today no enemy spawns with one (§1), so this stays
  dormant until a spawn path exists (open question 6).
- **Danger / ThreatForecast:** unchanged. Danger shows where a foe can *start* a fight.
  Spill is conditional on who stands where, and painting it would mostly be noise.
  Threat Sight's per-unit panel gains a line ("Art: Skewer, also hits 2 tiles behind").
  Owner to confirm (open question 7).

## 8. Harness parity

- **Shared through the generator:** area damage, credits, removes, ram moves, Benediction
  heals. `runPostCombatEffectsSync` is unchanged, and the harness reads `combat.credits`
  into `_awardCombatXP → actionXpAwards`.
- **`HeadlessBattle.executeAreaStrike(unit, artId, center)`** drives `engine/AreaStrike.js`.
- **Kill-move** is ignored by the harness (Canto off). This is a documented residual gap.
- **Optional:** move Entity splash into the engine as an `entity_splash` step that takes
  `world.random`, keeping today's draw order (**#175** note: hoisting the rolls would
  change fixed-v1). The harness then gains it.

## 9. Tests

Each test targets one way the change could fail, asserts outcomes, and derives its
expected numbers by hand from data. Each new test is proved by planting its bug once.

| Slice | Failure it must catch |
|---|---|
| AreaShapes | Off-by-one at an edge; a diagonal line where only cardinal ones exist; a line that passes a wall; an Entity counted twice; order unstable between calls. |
| strikeDamage | Forecast numbers move (pinned before the refactor); an area blow ignores DEF vs RES, triangle, terrain or 3× (Tempest vs a pegasus = hand-computed 5× cap); drift from `resolveCombat`. |
| Area step | A victim at 0 HP is hit again; a Deathburst from victim 1 changes victim 2's damage (two-phase); `nonLethal` floor; each_landed counts misses; the primary takes splash; the primary is in credits. |
| XP | Primary XP unchanged (pinned); a splash kill pays kill XP; the cap; Mentor's Band shares once per recipient; `_noXP`; no XP when the attacker died in a chain; one level-up queue. |
| Death order (scene, matrix from **#175**'s `PresentationFailureProxy`) | A splash kill of the last foe wins only after XP; a splash kill whose Deathburst kills Edric ends the run before popups; boss splash kill → banner + throne; gold once per victim; same state with presentation shown, skipped or failed. |
| Ram | A rooted/Anchored/Entity target moves; collision without a block; an ally obstacle hurt; a hidden obstacle shown in the preview. |
| Benediction | Heals by raw damage instead of HP lost; heals the user; heals a Wounded ally. |
| Kill-move | Granted on a miss or a non-kill; ignores root; lost on refresh (resume continuation); beats Gambit. |
| Preview | Each PlayerKnowledge pair (§5); chips equal the executed damage when nothing is hidden. |
| Pick-a-center | Esc order; illegal tile locks; state lists complete; commit-intent resume gives identical HP and RNG cursor; portrait cursor mapping. |
| AI | Pinned scores for every existing art; area bonus zero with no victims; `chosen_center` never chosen; harness and scene pick the same art for a seed. |
| Data | Validator rejects the retired keys and a bad `centerRange`; balance counts; display rows exist for every area art. |

**e2e** (each spec joins a lane in `tests/e2e/lanes.json` and waits on state):

- `area-art-preview.spec.js` in `presentation`: chips, the fog-hidden unit gets none, the
  post-commit reveal label.
- `area-center-targeting.spec.js` in `battle-input`: keyboard and gamepad aim, lock, fire,
  back, Esc.
- `portrait-area-targeting.spec.js` in `portrait` (`portraitHelpers.js`): tap, Confirm and
  Cancel on the turned board.
- Extend `combat-refresh-commit.spec.js` in `battle-history` with a refresh mid-Stormcall.

## 10. Implementation slices

**Pre** can land before #171/#175 merge. **Post** waits, because it edits code those PRs
rewrite (`executeCombat`, `_runCombatResolutionAtSpeed`, `_playPostCombatBeats`,
`BattlePresentationCheckpoint`). Neither PR touches `PostCombatEffects`, `BattleXp`,
`AttackFlowController`, `WeaponArtController` or `ForecastOverlay`.

| # | Slice | When | Size |
|---|---|---|---|
| 1 | `AreaShapes.js` + tests | Pre | S (~150 + 250 test) |
| 2 | `strikeDamage` / `areaStrikeDamage` extraction, forecast pinned | Pre | S-M |
| 3 | Area step replaces splash/pierce; migrate the 8 arts; `area` schema + validators + display rows; credits ledger (written, unread); `_postCombatWorld` gains `getTerrainAt`/`isSolid` (2 lines; that function is untouched by #175) | Pre | M |
| 4a | `actionXpAwards` + harness wiring | Pre | S-M |
| 4b | Scene reads `combat.credits` into `awardXP`; Phoenix on area victims | Post | S |
| 5 | Engine support for ram, `allyHeal`, `around_attacker`, line at range, with fixture arts only (no loot) | Pre | M |
| 6 | `AreaPreview.js` + `AreaPreviewController` + forecast Area row + PlayerKnowledge pairs | Pre | M-L |
| 7 | `EnemyArtScoring.js` extraction + area bonus; harness copy deleted | Pre | S-M |
| 8 | Content: Sweeping Cleave, Skewer, Benediction, Battering Ram data + scrolls + loot + help + icons + threshold notes (after 6, so no area art ships without a preview) | Pre (after 6) | M |
| 9 | `AreaStrike.js` + harness `executeAreaStrike` + tests | Pre | M |
| 10 | Pick-a-center scene wiring: `AreaTargetingController`, states, input, mobile context, commit intent/resume, history/rewind, Stormcall + Ashfall data, e2e | Post | L |
| 11 | Oathstorm kill-move (continuation, `finishUnitAction`, data) | Post | S-M |
| 12 | Entity splash into the engine (optional) | Post | S |

Order: 1 → 2 → 3 → 4a → 5 → 6 → 7 → 8 → 9, then 4b → 10 → 11 → 12 once both stability PRs
are in. Slice 3 changes the balance of existing arts by itself: ship it with a CHANGELOG
note.

## 11. Open questions for the owner

1. **Friendly fire.** The spec says none for every art; a ram never hurts an ally. Should
   Stormcall/Ashfall hit allies, as a trade-off?
2. **Blind fire.** May a chosen-center art fire at a center with no *seen* foe in the area?
   The spec allows it, and the confirm panel says "no known foes". Hidden victims then get
   revealed by labels.
3. **Doom Thrust** gains pierce at range 2 through the line shape. Accept, or keep the
   existing pierce arts melee-only?
4. **Oathstorm:** replace `advance 1` with the kill-move (spec), or keep both?
5. **Anchored:** its flag is read nowhere today. Should every art push (Overrun, Doom
   Thrust, Battering Ram) respect it? The spec does this for Ram only.
6. **Enemy access.** No enemy carries an art today. Should Act 3+ elites or bosses get
   Sweeping Cleave, Skewer or Battering Ram, so the AI work matters?
7. **Danger.** Keep it to primary reach, with the Threat Sight text line (spec)?
8. **XP rates:** 0.5 per hit, 1.0 per kill, base cap 100.
9. **Collision 5:** fixed or scaled? Should an enemy obstacle take it too (spec: yes)?
10. **Names:** Sweeping Cleave, Skewer, Benediction, Battering Ram, Stormcall, Ashfall.
11. **Ashfall:** an act 4 scroll, or leave Stormcall as the only chosen-center art?
12. **Tempest:** the 5× cap vs fliers in the area one-shots most fliers. Keep it?
