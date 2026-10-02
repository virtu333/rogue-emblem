# Area-of-effect weapon arts

Status: spec, 2026-10-01. Nothing built yet. The owner's decisions below are binding;
the owner's answers to the open questions (2026-10-01) are at the end.

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

Both PRs are now on main (merge aff4518e). Rechecked there: area victims fall through
`removeUnit` inside `_playPostCombatBeats` (`remove`/`moved` required, the rest guarded,
each beat behind the battle session); Deathburst chains no longer call
`checkBattleEnd`; the combat owner removes the primary, sweeps, then runs
`hasBattleDefeat`; victory waits for `completeResolvedAction` after XP. The Phoenix
check over area victims (§2.6 step 3) runs after the attacker's and defender's, each
behind the session guard. The line numbers below are still the pre-merge ones.

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

- **A line starts past the target.** A hostile standing between the attacker and the
  target (a range-2 shot) is not touched.
- **`unitsOnTiles` excludes by identity,** not by tile. The Entity's other footprint tiles
  can't bring the excluded primary back in.
- **Factions come from `world.hostilesOf`.** For a player that is the enemy roster only
  (`_getTier5HostileUnitsFor` `:8607-8611`), so area arts never hit `npcUnits`.

### 2.2 Per-victim damage: `Combat.areaStrikeDamage`

Extract the attacker-damage block of `getCombatForecast` (`Combat.js:954-971`) into
`strikeDamage(attacker, atkWeapon, victim, victimWeapon, victimTerrain, atkMods, defMods,
{ effectivenessCap })`. Then:

- `getCombatForecast` calls `strikeDamage`. Forecast numbers must not move; pin them first.
- `areaStrikeDamage(attacker, weapon, victim, { art, skillAtkMods, world })` calls the
  same helper.
  - **atkMods:** the primary combat's already built `skillCtx.atkMods`, merged with the
    art's `combatMods` and the weapon's imbue mods exactly as the forecast merges them
    (`Combat.js:923-930`). These are the deterministic flat mods: passive skills,
    accessories, timed buffs, the act's hit bonus.
    - The scene builds them in `buildSkillCtx` (`BattleScene.js:7781`, through
      `getSkillCombatMods`, `SkillSystem.js:199`).
    - The forecast path gets them from `_buildForecastSkillCtx`, the harness from
      `_buildSkillCtx` (`HeadlessBattle.js:1700-1714`).
    - They were computed against the primary, so a bonus that depends on the opponent
      reads the primary. This is accepted, and the rule text says so.
  - **chosen_center** has no primary combat. It uses the art, imbue and
    `timedBuffCombatMods` only.
  - **defMods:** only the victim's timed-buff DEF/RES.
  - **The victim's side:** the triangle against the victim's own weapon, and the victim's
    terrain DEF.
  - **Effectiveness:** weapon and art effectiveness (and `negateEffectiveness`), capped at
    **3×** for area blows (decided). The 5× cap stays for the
    primary.
- **Excluded:** per-strike procs (`rollStrikeSkills`: Luna, Sol, Astra and the like). An
  area blow never rolls hit or crit. Rule text: "an area blow always lands and never crits;
  strike skills don't trigger on it."
- The result is deterministic, so the same function serves execution, the preview and the
  AI. A parity test holds `strikeDamage` equal to `resolveCombat`'s non-crit, non-proc
  strike damage (`:1532`) on fixtures, so the two copies can't drift.

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

### 2.4 Credits ride on `result`

The area step pushes `{ source, victim, damage, hpBefore, killed }` onto
`result.areaCredits` (created on first use) at the moment HP changes. `killed` is decided
by the blow itself, not by a later chain. Nothing is pushed for the primary.

Why `result`:

- The scene builds the combat object inline for `_applyResolvedCombatPostEffects`
  (`BattleScene.js:8313-8319`) and returns only `{ result, selectedArt }` (`:8328`). The
  harness does the same (`HeadlessBattle.js:1810-1826`).
- `result` already reaches `executeCombat` and the harness's XP code, so no signature
  changes.

Why not a beat: on **#175**, beats other than `remove`/`moved` run inside
`safeBattlePresentation`, so a credit carried by a beat would be lost on a cosmetic
failure.

### 2.5 XP for many victims: `BattleXp.actionXpAwards`

`actionXpAwards({ unit, primary, credits, ...the inputs of combatXpAwards })` returns the
same `{unit, baseXp, share}[]`, with **one entry per recipient**.

The rates are **decided** (owner, 2026-10-01). They are data: a new root block, `areaXp`, in
`weaponArts.json`.

**Primary.** Exactly what `combatXpAwards` gives today: damage ratio, kill bonus,
survival floor. Pinned.

**Each credit**, computed on *base* XP before any battle multiplier:

1. Start from `calculateCombatXP(unit, victim, killed)`.
2. If the blow did not kill, multiply by `min(1, damage/hpBefore)`.
3. Multiply by `areaXp.hitRate` (**0.35**), or by `areaXp.killRate` (**0.6**) for a kill.
4. Multiply by the victim's own `getEnemyXpMultiplier`, the turn-pressure multiplier and
   Training Doctrine, as the primary gets.

Victims with `_noXP` are skipped.

**Cap.** The summed credit base is capped at `areaXp.actionBaseCap` (**75**) and never
lowers the primary. `scaledXp`'s battle multipliers (par, difficulty, blessings, trait)
then apply once to the total.

**chosen_center** has no primary. The credit with the highest base counts at the primary
rate; the rest count as area credits.

**Mentor's Band.**

- Recipients are fixed once, before the holder's gain (as today), from the holder's
  position after post-combat moves.
- Each recipient's share is the sum of `calculateSharedXp` over the primary and every
  credit, at the same rates and under the same cap.
- Each recipient gets one `awardScaledXP` per action. So the 1-XP floor applies once, and
  level-ups happen once, in order.

**Who gets credit for a kill.**

- *Keeping today's rule.* `executeCombat` reads `defender.currentHP <= 0` after the
  post-combat effects (`BattleScene.js:8458-8463`). So when a splash victim's Deathburst
  finishes the *primary*, the attacker gets the primary's kill XP. Gold is paid once, at
  removal. The rule stays: the primary counts as killed by the action, whatever finished it
  inside the action. A test pins it.
- An area victim that the blow left alive and a Deathburst chain then finished gives a
  *hit* credit, because `killed` is decided at the blow.
- If a Deathburst kills the source during phase 2, the source keeps its credits. Kill
  rewards and history attribution stay as they are (`_applyKillRewards` / `onKill` /
  `observeHistoryAction`: main `:9101`, `:9203-9204`; **#175** `:9309`, `:9422-9425`).
  No XP is paid, because `awardXP` requires a living attacker.

**Not counted.** Player victims of an enemy area art earn nothing. The primary defender
keeps `survivedAttack`.

### 2.6 Order when one action kills several units

Final shape (**#171**+**#175**):

1. Strikes are applied per strike (`applyStrikeHP`), then the final HP (`applyCombatHP`).
2. Post-combat runs. Area victims fall here, in area order, each through `removeUnit`:
   gold, Zombie remains, boss bar and FOE VANQUISHED, last words, Deathburst chains.
3. Phoenix checks run for the attacker, the defender, and **every player-side area
   victim** (new: an enemy area art can drop a Brooch holder into range).
4. `awardXP` runs from `result.areaCredits`, only if the attacker is alive.
5. The primary is removed, then the attacker, then `_sweepFallenUnits`.
6. **#171** `hasBattleDefeat → checkBattleEnd` runs. The commander falling anywhere in
   steps 2-5, including a chain from a splash kill, ends the run here, before popups.
7. Level-ups, then `completeResolvedAction → checkBattleEnd`. A rout cleared by the area
   wins only after XP.

**Main differs today.** On main, a Deathburst chain calls `checkBattleEnd()` itself when it
unwinds to depth 0 (`removeUnit`'s `finally`, `BattleScene.js:9265-9270`). So a splash
kill whose Deathburst kills the last foe wins the battle *before* the attacker's XP.
**#171** removes that call ("a chain must not steal that work", #171 head `:9350`).

The post-merge rule is victory after XP. The §9 death-order matrix pins it, and the
scene-side slices wait for #171.

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
- `effects.killMove`: `{ "refresh": true }`

### 3.2 Migrating the eight existing arts

Each `aoeSplash` / `pierce_through` becomes an `area` block with the same radius,
multiplier, maxTargets and cadence. The blow is now computed against each victim.

| Art | New area block |
|---|---|
| Burning Quake | radius 1, ×0.6, once |
| Radiant Burst | radius 1, `lowest_hp_pct`, maxTargets 1, ×0.75 |
| Barrage | radius 1, ×0.5, once (still includes Oathbow's 0.9 per-strike factor) |
| Cataclysm | radius 2, fixed 5 |
| Tempest | radius 1, ×0.75; fliers in the area now take its effectiveness (area cap 3×) |
| Cataclysm Bolt | radius 2, ×0.5 |
| Piercing Charge | line 1, ×1.0, each_landed |
| Doom Thrust | line 1, ×1.0, each_landed |

**Parity, stated precisely.** Today's basis is the *actual* first landed strike on the
primary for splash, or each landed strike for pierce (`WeaponArtPostCombat.js:45-58`,
`:76-90`, `:271-273`). That number includes the flat skill and accessory mods, and also
any crit or strike proc (Luna and the like).

The new blow keeps the flat mods (§2.2: the primary's `skillCtx.atkMods`) and drops crits
and procs. So against a victim identical to the primary (same stats, weapon, terrain), the
area damage equals today's on every non-crit, non-proc strike. It is lower whenever
today's basis strike critted or procced.

**Victim order changes.** Today's splash takes its victims in row, then col order
(`splashTargets`; lowest HP% first when it hits one). The area takes them in tile order:
distance from the center, then row, then col (`radiusTiles`); `lowest_hp_pct` keeps its
rule. So with several victims the blows, the hints, the credits and the removals come in
a different order than today, and a `maxTargets` cap above 1 keeps the nearest victims,
not the top rows. Totals for one blast are unchanged: every victim still takes its own
blow, and removals now all follow the blows (phase 2) instead of each following its own.

**Migration test.** It pins exactly that: equal on a fixture with no crit and no proc, and
the documented difference on a fixture where the first strike crits.

**Doom Thrust.** Doomblade (1-2) gains a pierce at range 2, because the line shape works
at range (decided). Its push still needs adjacency
(`resolvePostCombatMove` returns `not_adjacent`). Its display row says so: "at range 2 it
pierces but doesn't push".

**Saves.** Saves hold art ids, never art bodies, so no save migration is needed.

**Balance note.** Slice 3 changes the live balance of existing arts by itself. It ships
with a CHANGELOG entry and a help note.

### 3.3 New arts

| id / name | Weapons | Tier, act, rank | HP | Limits | Shape | Mods | Factions |
|---|---|---|---|---|---|---|---|
| `axe_sweeping_cleave` Sweeping Cleave | Axe, Sword | Steel, act2, Prof | 6 | map 2 | around_attacker r1, ×0.5, once | Hit +5 | any |
| `lance_skewer` Skewer | Lance, Bow | Steel, act2, Prof | 6 | map 2 | line 2, ×0.6, each_landed | Hit +10 | any |
| `light_benediction` Benediction | Light | Silver, act3, Prof | 6 | map 3 | allyHeal r1, 50% of damage dealt | Atk +2, Hit +10 | player |
| `lance_battering_ram` Battering Ram | Lance, Axe | Silver, act3, Prof | 6 | map 2 | ram 2, collision 5 | Atk +3, Hit +10 | any |
| `legend_stormcall` Stormcall | Breachbolt | Legendary, act3, Mast | 8 | map 2, turn 1 | chosen_center r1, range = weapon (3-10), ×0.8 | none | player |

Names are display names, kept free of FE names in the spirit of #137. Breachbolt keeps
Cataclysm Bolt and gains Stormcall as a second binding (`weaponArtIds`, at most 3).

**Deferred:** Ashfall, a non-legendary act-4 Tome scroll. Stormcall is the only
chosen-center art in this spec.

**`any` faction** means the art is legal for enemies. Today no enemy spawn path gives
enemies arts (§7).

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
- **Tempest vs fliers.** Area blows cap at 3× (decided), so a flier in the area takes
  about (MAG 25 + 12×3 + 5 − RES 10) × 0.75 ≈ 42. At the primary's 5× cap it would be
  about 60. The owner asked for the restore; the 3× area cap keeps it below a guaranteed
  one-shot.

`WeaponArtDataBalance.test.js` counts become Mast 16 and Prof 72. Every new legendary
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
  - Doom Thrust: "at range 2 it pierces but doesn't push"
  - "On hit: allies next to you heal 50% of the damage"
  - "On hit: ram the target back up to 2 tiles (only when next to it); if blocked, it and
    any foe it hits take 5" (the shop and roster tooltips wrap it to four to six lines at
    640x480, under Galeforce Assault and Doom Thrust)
  - "On kill: you may move again"
  - Splash rows lose "of the first hit". The "an area blow…" rule goes once into
    `WEAPON_ARTS_HELP`.
- **Then:** `npm run sync-data`, `check:reference`, and an icon atlas rebuild for the new
  scroll items (Skewer, Sweeping Cleave, Battering Ram and Benediction scrolls in act 2/3
  `weaponArtScroll` pools).

New pool entries shift loot RNG, so the content slice carries `check:threshold-pr-notes`.

## 4. Mechanics of the new effects

### Battering Ram (`mode: "ram"`)

- **Direction:** cardinal adjacency, as with push.
- **Immovable targets:** a target that is rooted, the Entity, or Anchored doesn't move
  and takes no collision. The hint is "Braced!". Anchored becomes a shared rule for push,
  swap and ram alike (slice 0, §10).
- **The push:** step up to `distance` tiles. Stop before a tile that is out of bounds,
  impassable for the target's `moveType`, or holds a live unit.
- **Collision:** if the push stopped short, the target takes `collisionDamage`
  (`damageUnit`, can kill). If the obstacle is a unit hostile to the attacker, it takes
  the same damage and becomes a credit.
- **Beats:** `moved` (required), `hp`, `hint` "Crash -5", then two-phase removes.
- **Allies:** an ally of the attacker is never hurt.

### Benediction (`allyHeal`)

- **Gate:** hit-gated.
- **Amount:** `floor(dealt × pct/100)`.
  - `dealt` is Divine Charge's sum: Σ `e.damage` over the user's landed strikes
    (`Combat.js:2205-2215`).
  - It is capped at the primary's HP at the start of combat, so overkill heals nothing.
  - Benediction computes `dealt` itself in the pipeline from `result.events`; it doesn't
    need the skill.
- **Who:** each living ally within 1 of the user, the user excluded.
- **How:** `healUnit` each one (Wounded heals 0). The `divine_charge` beat path is reused.
  Divine Charge itself keeps its single most-hurt target.

### Oathstorm kill-move (`killMove`): full refresh (decided)

Owner, 2026-10-01: a kill refreshes the actor (FE Galeforce), through the Gambit refresh
path.

- Oathstorm's placeholder `advance 1` is removed; it stood in for this
  (`weapon_arts_tier2_legendary_spec_2026-02-17.md:38-50`). `set_hp 5` and the ally buff
  stay.
- **Trigger:** after `executeCombat` removes its casualties, if the attacker is alive and
  not rooted, and the primary died.
- **Data:** `effects.killMove: { "refresh": true }`.
- **Continuation:** gains a `refreshActor` boolean. `readActionContinuation`
  (`ActionContinuation.js:20-40`) validates it, and `BattleStateSnapshot.js:124-127` uses
  the same reader.
- **Refresh:** `completeResolvedAction`'s existing Gambit refresh path
  (`BattlePresentationCheckpoint.js:97-116`) refreshes the actor alone. It clears
  `hasActed`, `hasMoved`, `_movementCommitted` and `_movementSpent`, records history
  "refreshed", and takes the checkpoint. About 10 lines.
- **Limits:** `perTurnLimit: 1` (already set) keeps it to one refresh a turn. Its HP cost
  gets a playtest review.
- **Precedence:** Commander's Gambit wins if both fire.
- **Harness:** ignores the flag. This is a documented residual gap.

The move-only Canto variant was considered and not chosen.

**Built (slice 11).** `getWeaponArtKillEffects(art).killMove` reads the data;
`killMoveRefreshesActor({ art, attacker, primary })` (WeaponArtSystem) is the trigger;
`executeCombat` puts `refreshActor: true` on its continuation after the casualties fall;
`completeResolvedAction` refreshes the actor alone (history "refreshed … Galeforce",
timeline "X can act again."), with Gambit checked first. The flag rides the saved
continuation, so a suspend/resume completes the same refresh, and Vision never rewinds
into a pending continuation. The art's once-a-turn use is unit state, saved and rewound
with it, so a refresh cannot chain. The validator holds `killMove` to a player-only
`{ "refresh": true }`.

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

### One state, reusing the Blink tile flow

The flow adds a single new `battleState`, `SELECTING_AREA_CENTER`. It is built the way
Blink's `SELECTING_ABILITY_TILE` is: `AbilityController.startBlinkTileSelection` (`:238`)
and the `InputController` click switch (`:484-486`). The confirm step is a prompt, like
`AbilityController._showConfirmPrompt` (`:323`), not a second state.

```
UNIT_ACTION_MENU ──pick art──▶ SELECTING_AREA_CENTER ──legal tile──▶ confirm prompt [Fire] [Back]
        ▲                         ▲   │ back                               │ back      │ fire
        └──────── back ───────────┼───┘                                    │           ▼
                                  └────────────────────────────────────────┘    COMBAT_RESOLVING
```

**Registration.** The state goes into every list `SELECTING_ABILITY_TILE` is in:

- the cancel list (`BattleScene.js:3948`)
- `handleCancel` (`:4088`)
- `canForceEndTurn` (`:4187`)
- `_emitMobileContext` (`:4219`)
- the click switch

A test greps for `SELECTING_ABILITY_TILE` and requires the new state beside it. Vision
rewind stays idle-only (`VisionRewindController.js:427`).

**`src/ui/AreaTargetingController.js`** owns the flow: `create`/`destroy`, plus
`begin(unit, art)`, `aim(tile)`, `lock(tile)`, `fire()`, `back()`.

**Aiming.**

- The legal centers (`centerTiles`) get a range tint.
- The cursor starts on the nearest *seen* hostile in range. If there is none, it starts on
  the unit's tile, clamped into range.
- Every hover or cursor step re-runs the preview through
  `InputController.refreshHoverInfo`, which both the mouse and the grid cursor already
  call.

**The prompt.** It shows the art name, HP `32→24`, the forecast Area row and
[Fire] [Back]. While it is open the state is the prompt's, as with `_showConfirmPrompt`.
Back reopens aiming on the same tile.

### Input by device

| Device | Aim | Lock (opens prompt) | Fire | Back | Cycle seen foes |
|---|---|---|---|---|---|
| Mouse | hover | left-click a legal tile | Fire, or click the same tile | right-click | none |
| Keyboard | arrows (`GridCursorController.move`) | Enter/Z | Enter/Z on Fire | Esc/X | Q/E |
| Gamepad | D-pad/stick | A | A on Fire | B | L1/R1 |
| Touch | tap a tile | the tap locks | Fire, or tap the same tile | Cancel button | Prev/Next buttons |

- An illegal tile does nothing, and neither does the first click after a camera drag.
- **Touch:** a new context `battle_area_target` in `MobileControls.js` shows
  [Cancel] [◀ Foe ▶]. Long-press still inspects. A press that began before a geometry
  change never acts (existing behaviour).
- **Gamepad:** e2e drives it with `padTap`.

**Portrait.** The cursor's arrows already follow the drawn board
(`grid.board.displayDeltaToGrid`, `GridCursorController.js:50`). Centers are stored in
game coordinates. If the phone turns mid-aim, the switch waits:
`canSwitchBattlePresentation` needs `PLAYER_IDLE` (`portraitBattle.js:190`), and the note
reads "…when this action is done".

**Esc.** Overlays above the battle (unit detail, pause, help) consume Esc first through
`consumeEscEvent`; the controller checks `isEscConsumed`. After that, each Esc steps back
one level: prompt → aiming → art picker → action menu. The unit stays where it moved, as
when Attack is cancelled. End Turn cancels the flow first.

### What the strike does that `executeCombat` does (B2)

A chosen-center strike never calls `resolveCombat`. It has its own owner,
`executeAreaStrike(unit, art, center)`, which mirrors `executeCombat`'s tail. Each side
effect of `executeCombat` / `_runCombatResolutionAtSpeed`, decided:

| Side effect (main) | Decision |
|---|---|
| `_commitCombatIntent` (`:8336`, needs `defender.battleEntityId` `:8340`) | **Sibling** `_commitAreaStrikeIntent`: `{ kind: 'area_strike', unitId, unitName, center: {col,row}, weaponArt }`. Same checkpoint call, same session. |
| Art cost, `recordWeaponArtUse`, recoil guard, caster Phoenix | **Do**, as `_runCombatResolutionAtSpeed` does. |
| `resetFortHealStreak` (`:8439`, sets `_fortHealStreak = 0`) | **Do**: it is an attack action. |
| Music `onCombat` / `onCombatResolved` (`:8209-8215`) | **Do**: the controller wraps the strike the way `_runCombatResolution` does. |
| History and timeline facts (`:8252-8275`) | **Do**: `observeHistoryAction('called down', unit, null, art.name)`, then one fact per victim the player can see (`historyUnitVisible`). No strike rows (there are no strikes). |
| `_hitByPlayerThisPhase` / Shielded (`:8296-8303`; `Combat.js:1702`; `AffixForecast.js:48`) | **Ignore and don't spend.** Area blows, like today's splash and pierce (`damageUnit`), bypass Shielded's first-hit negation and leave the guard up. The rule text says "area blows go around a shield"; `AffixForecast` stays accurate. |
| `deedsFor().onCombat` (`:8314`) | **Skip**: there is no combat result. Kills still reach deeds through `removeUnit → onUnitRemoved`. |
| `checkBossHalfHealth` / `onLowHealth` (`:8491-8494`) | **Do**, guarded as presentation: boss half health after the blows; `onLowHealth` for the caster after the HP cost. |
| Tutorial hooks (`:8467` XP lesson, `:8475` permadeath hint) | **Skip**: the tutorial has no chosen-center art. |
| XP, removals, sweep, `hasBattleDefeat`, level-ups, `completeResolvedAction` | **Do**: the §2.6 tail. The continuation is `kind: 'combat'`, so Canto applies. |

**Resume.** `BattleSuspendController.js:302-303` calls `readCommittedAction` and then
`resumeCommittedAttack`. Both learn the new kind:

- `readCommittedAction` (`BattlePresentationCheckpoint.js:17`; `attack` only today, `:19`)
  validates `area_strike`: the unit id, and a center in bounds.
- The dispatcher calls `resumeCommittedAreaStrike` for it.
- `BattleFatalDecision.js:27-28` already clears any pending intent, whatever its kind.

Aiming is UI state, so a refresh while aiming resumes at the last checkpoint, as Attack
targeting does now. Rewind treats the strike as an action; add it to
`rewind-action-types`.

### Built (slice 10)

- `src/ui/AreaTargetingController.js` owns aiming, the prompt and the strike; BattleScene
  only registers `SELECTING_AREA_CENTER` beside `SELECTING_ABILITY_TILE` (cancel list,
  `handleCancel`, `canForceEndTurn`, the phone context `battle_area_target`; a test
  holds every such list to it), routes clicks (`InputController`), hover and cursor
  (`updatePathPreview`), keys and pad actions to it, and drops the aim on End Turn.
  Keyboard E cycles foes while aiming instead of ending the turn.
- The prompt is a menu registered under the aiming state (as Canto's confirm is), so
  the cursor keeps moving under it and confirming the locked tile fires. The phone rail
  shows its rows and ◀ Foe ▶; the left panel's Cancel and the rail's Back step back.
- **Not `settleAndPresent`** (#177). It settles synchronously and checkpoints before
  presenting; a strike kills through `removeUnit` (gold, deeds, Deathburst, last
  words), which is async, and pays XP for every victim. So it follows `executeCombat`:
  the `area_strike` intent is saved before any cost or blow, and a refresh replays it
  from that state (`resumeCommittedAreaStrike`, which drops it when no longer legal);
  then the blows, Phoenix checks, XP, the sweep, `hasBattleDefeat`, and the `combat`
  continuation that level-ups save and `completeResolvedAction` finishes. Every step
  checks the session the action began in. Rewind needs no list: the continuation's
  `player_action` boundary makes the strike a rewind point like any action.
- **Breachbolt's shots** (#183). Availability goes through `canAttackWithWeapon`
  (AttackOptions), which refuses a per-battle weapon with no shots left. A cast is the
  tome's strike, so it spends one shot (`PerBattleWeapons.spendAreaStrikeShot`) beside
  the art cost, whatever the blast hits, empty ground included. The intent is saved
  before it, so a replay spends it once. A tome that fired its last shot is swapped
  out (`_swapSpentWeapons`) only after the sweep and the defeat check, as
  `executeCombat` does: kill credit, deeds and remains read the weapon that struck. A
  blast that wins the battle still swaps (victory is decided after it, when the
  action completes); a defeat or a fatal decision returns before the swap.
- **The item's counters** (#181). A cast has no strike events, so
  `DeedSystem.recordAreaStrike` counts it: one `_strikes` a cast (no hit roll, still
  one use) and one `_kills` for each foe the blast itself dropped (`areaCredits`
  `killed`). A Deathburst kill it set off is not the tome's, as in `recordCombat`.
  Deeds only (a run battle, not the tutorial). A targeted area art (Cataclysm Bolt,
  Sweeping Cleave) still counts only its primary strike's kill: its area victims
  never reach `recordCombat`.

## 7. Enemy AI

### Extraction

`_scoreEnemyWeaponArt` moves to `engine/EnemyArtScoring.js`. The scene's version
(`WeaponArtController.js:413-456`) is the one moved, and it is pinned. The harness copy
(`HeadlessBattle.js:1541-1570`) is deleted, per the residual-gap rule.

That copy already lacks six terms the scene has: status count, `damageMultiplier`,
`ignoreWeaponTriangle`, `ignoreRES`, `killBuff` and `selfDamageOnMiss`. So the extraction
changes the harness's art picks, and slice 7 carries `check:threshold-pr-notes`.

### Area bonus

`scoreAreaBonus(unit, art, target, world)` runs the preview planner with the *full* world
(the AI sees every unit):

`0.8 × Σ (min(damage, hp)/hp × 4 + kill × 6)`, plus heal value for Benediction-like arts.

- An ally is never in a hostile area, so there is no ally penalty; a test pins that.
- The AI picks its art after choosing a target, so it doesn't reposition for a better
  area. That counts as "reasonably easy".
- `_selectEnemyWeaponArt` filters out `chosen_center` arts.

### Which enemies get area arts

No enemy spawn path gives enemies arts today (§1). Decided:

- **Who:** act 3+ elites, on Nightfall and Black Sun (`isDifficultyAtLeast(id, 'hard')`).
- **What:** Sweeping Cleave or Skewer only, bound to their weapon at spawn. No enemy
  knockback: Battering Ram is player-only.
- **Where (built, slice 7b):** `enemies.json` `eliteAreaArts` (`minDifficulty: "hard"`,
  `acts`, `count: [1, 2]`, `byWeaponType`: Axe/Sword → Sweeping Cleave, Lance/Bow →
  Skewer), read by `engine/EnemyAreaArts.js`. It sits with the enemy pools rather than in
  `difficulty.json`: it is one rule with a floor, not a table keyed by rung, so there is
  no `dusk` entry to keep. The cross-reference validator holds every listed art to one
  the AI can swing with that weapon type: open to enemies, AI on, not a legendary's own,
  `normal_attack` with an area, and never one that moves a unit.
- **How:** `MapGenerator` writes `areaArt` on one or two eligible spawns (not a boss, the
  Entity, a siege crew or a recruit guardian; the type is the class's first non-staff
  proficiency, the type its weapon is drawn from). It draws from the battle seed only
  when the battle qualifies, so every other battle generates exactly as before. The scene
  and the harness bind the art to the weapon that can carry it (`bindEnemyAreaArt`) when
  they build the unit; from there it is an ordinary bound art: HP cost, per-map uses,
  `selectEnemyWeaponArt`.
- **What the AI does with it:** the §7 score. Sweeping Cleave on its own scores
  5 Hit × 0.35 − 6 HP × 0.75 = −2.75, so it swings only when the arc is worth about 3.5
  (Nightfall's bar is 0.75): a kill beside it, or two foes each losing more than half
  their HP. Skewer (+10 Hit, −1.0 alone) needs one foe behind the target to lose about
  55%. Armed elites are threats when a swing would finish someone, not on every attack.

### Danger and ThreatForecast

Unchanged (decided). Danger shows where a foe can *start* a fight.
Spill depends on who stands where, so painting it would mostly be noise. Threat Sight's
line says how many of the foes that reach the tile carry a usable area art:
"2 foes can reach · 1 with an area art" (`threatsOnTile(...).area` from
`ctx.areaArtOf`, WeaponArtController.enemyAreaArt → `EnemyArtScoring.enemyAreaArtOf`).
A spent or unaffordable art drops out, and the threat cache's signature includes it.

## 8. Harness parity

- **Through the shared generator:** area damage, `result.areaCredits`, removes, ram moves,
  and Benediction heals. `runPostCombatEffectsSync` is unchanged. The harness passes
  `result.areaCredits` into `_awardCombatXP → actionXpAwards`
  (`HeadlessBattle.js:1810-1826`).
- **Chosen center:** `HeadlessBattle.executeAreaStrike(unit, artId, center)` drives
  `engine/AreaStrike.js`.
- **Kill-move refresh:** ignored, because the harness never refreshes an actor. This is a
  documented residual gap.
- **Optional:** move Entity splash into the engine as an `entity_splash` step that takes
  `world.random`, keeping today's draw order. The harness then gains it. (**#175** notes
  that hoisting the rolls would change the fixed-v1 stream.)

## 9. Tests

Each test targets one way the change could fail. It asserts outcomes, and its expected
numbers come from hand-derivation from data. Each new test is proved by planting its bug
once.

| Area | Failure it must catch |
|---|---|
| AreaShapes | Off-by-one at an edge; a diagonal line; a line through a wall; a hostile between attacker and target hit by a line; an Entity counted twice, or excluded by tile instead of identity; unstable order. |
| strikeDamage | Forecast numbers move (pin them before the refactor); flat skill mods dropped from the area blow; a crit or proc leaking into it; DEF/RES, triangle, terrain or effectiveness ignored; the area effectiveness cap at 5× instead of 3× (Tempest vs a pegasus, hand-computed); drift from `resolveCombat`. |
| Migration | Equal to today when no crit and no proc; the documented difference when the first strike crits. |
| Area step | A victim at 0 HP hit again; victim 1's Deathburst changing victim 2's damage (two-phase); the `nonLethal` floor; each_landed counting misses; the primary taking splash or getting a credit; NPCs hit. |
| XP | Primary XP unchanged (pinned); rates applied after the battle multipliers instead of before; the 75 cap; one Mentor's Band share per recipient; `_noXP`; a chain-finished victim counted as a kill; a primary finished by a splash victim's Deathburst still paying the attacker kill XP; no XP when the source died in a chain; one level-up queue. |
| Death order (scene; the **#175** `PresentationFailureProxy` matrix) | A splash kill of the last foe wins only after XP. A splash kill whose Deathburst kills the last foe wins only after XP: today main ends the battle first (`:9265-9270`), and this test fails until #171. A splash kill whose Deathburst kills Edric ends the run before popups. A boss splash kill gives the banner and the throne. Gold is paid once per victim. State is the same whether presentation is shown, skipped or failed. |
| Shielded | An area blow spends the guard or is negated by it. |
| Ram / Anchored | A rooted, Anchored or Entity target moved (by push, swap or ram); a collision without a block; an allied obstacle hurt; a hidden obstacle in the preview. |
| Benediction | Overkill heals; the user heals; a Wounded ally heals. |
| Kill-move refresh | Granted on a miss or a non-kill; ignores root; lost on refresh (resume continuation); a second refresh in one turn; beats Gambit. |
| Preview | Each PlayerKnowledge pair (§5); chips equal the executed damage when nothing is hidden. |
| Pick-a-center | Esc order; an illegal tile locks; the state lists are complete; resuming from the `area_strike` intent gives identical HP and RNG cursor; a fatal decision clears the intent; history and boss half-health fire; deeds `onCombat` doesn't; portrait cursor mapping. |
| AI | Pinned scene scores for every existing art; the area bonus is zero with no victims; `chosen_center` never chosen; harness and scene pick the same art for a seed. |
| Data | The validator rejects retired keys and a bad `centerRange`; balance counts; display rows exist for every area art. |

**e2e.** Each spec joins a lane in `tests/e2e/lanes.json` and waits on state, never on
time.

- `area-art-preview.spec.js` (lane `presentation`): chips; a fog-hidden unit gets none; the
  label that reveals it after commit.
- `area-center-targeting.spec.js` (lane `battle-input`): keyboard and gamepad aim, lock,
  fire, back, Esc.
- `portrait-area-targeting.spec.js` (lane `portrait`, uses `portraitHelpers.js`): tap,
  Fire and Cancel on the turned board.
- `combat-refresh-commit.spec.js` (lane `battle-history`): extended with a refresh in the
  middle of Stormcall.

## 10. Implementation slices

**Pre:** can land before #171/#175 merge. **Post:** edits code those PRs rewrite
(`executeCombat`, `_runCombatResolutionAtSpeed`, `_playPostCombatBeats`,
`BattlePresentationCheckpoint`, `removeUnit`).

#171 and #175 are not ancestors of each other (their common base is e25885cf). Post slices
are re-anchored after **both** land, with line numbers re-read on the merged tree. Neither
PR touches `PostCombatEffects`, `WeaponArtPostCombat`, `BattleXp`, `AttackFlowController`,
`WeaponArtController` or `ForecastOverlay`.

| # | Slice | When | Size |
|---|---|---|---|
| 0 | Anchored respected by push, swap and ram in `resolvePostCombatMove` (`WeaponArtPostCombat.js:387-393`; the world passes an immovable check through `world.affixes`) | Pre, first | XS |
| 1 | `AreaShapes.js` + tests | Pre | S (~150 + 250 test) |
| 2 | `strikeDamage` / `areaStrikeDamage` extraction; forecast pinned | Pre | S-M |
| 3 | Area step replaces splash and pierce; migrate the 8 arts; `area` schema, validators and display rows; `result.areaCredits` written but unread; `_postCombatWorld` gains `getTerrainAt`/`isSolid` (2 lines in a function #175 leaves alone); CHANGELOG + help note (live balance change) | Pre | M |
| 4a | `actionXpAwards` + harness wiring | Pre | S-M |
| 4b | Scene passes `result.areaCredits` to `awardXP`; Phoenix for area victims | Post | S |
| 5 | Engine support for ram, `allyHeal`, `around_attacker`, line at range; fixture arts only, nothing in loot | Pre | M |
| 6 | `AreaPreview.js` + `AreaPreviewController` + forecast Area row + PlayerKnowledge pairs | Pre | M-L |
| 7 | `EnemyArtScoring.js` extraction + area bonus; harness copy deleted; threshold PR notes | Pre | S-M |
| 7b | Enemy elite art binding | Pre | S |
| 8 | Content: Sweeping Cleave, Skewer, Benediction, Battering Ram data, scrolls, loot, help, icons, threshold notes (after 6, so no area art ships without a preview) | Pre, after 6 | M |
| 9 | `AreaStrike.js` + harness `executeAreaStrike` + tests | Pre | M |
| 10 | Pick-a-center scene wiring: `AreaTargetingController`, `SELECTING_AREA_CENTER`, input, mobile context, the `area_strike` intent and resume dispatch, history and rewind, Stormcall data, e2e | Post | L |
| 11 | Oathstorm kill-move (full refresh) | Post | S |
| 12 | Entity splash into the engine (optional) | Post | S |

**Order:** 0 → 1 → 2 → 3 → 4a → 5 → 6 → 7 → 8 → 9, then 4b → 10 → 11 → 12 once both
stability PRs are in and the post slices are re-anchored.

## 11. Decisions (owner, 2026-10-01)

1. **Friendly fire:** none for any art. A ram never hurts an ally.
2. **Blind fire:** allowed. Stormcall may target a center with no *seen* foe; the prompt
   says "no known foes".
3. **Doom Thrust:** gains a pierce at range 2. It can't push there, and its row says so.
4. **Oathstorm:** `advance 1` is replaced by a full refresh on a kill, through the Gambit
   path with `refreshActor`.
5. **Anchored:** respected by every push, swap and ram (slice 0).
6. **Enemy area arts:** act 3+ elites on Nightfall and Black Sun, Sweeping Cleave and
   Skewer only. No enemy knockback.
7. **Danger:** primary reach only, plus a Threat Sight line.
8. **XP:** hit 0.35, kill 0.6, cap 75, on base XP before the battle multipliers.
9. **Area effectiveness cap:** 3×. Only the primary can reach 5×.
10. **Collision:** fixed 5, also dealt to an enemy obstacle.
11. **Names:** Sweeping Cleave, Skewer, Benediction, Battering Ram, Stormcall.
12. **Ashfall:** deferred. Stormcall ships.
