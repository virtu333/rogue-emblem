# Legendary arts rework (and ability slots)

Status: built, 2026-10-11 (slices 1-6 on `claude/elegant-gates-5j5ocs`). Owner decisions in
this file are binding. Builds on
`docs/specs/aoe-weapon-arts.md` (area arts, chosen-center strikes, the area pipeline) and
`docs/specs/phase3.md` 3E (Blink Strike's warp seam).

## 0. Decisions (owner, 2026-10-11)

1. **No new weapons.** Five existing legendaries change instead: Oathblade, Ruin, Tidebreaker,
   Doomblade, Starfall, Hermit's Bow. No icon, loot-pool or seeded-loot change.
2. **Oathblade** drops "Attacks twice" (it overlapped Twinsworn), gains Might and Crit, and its
   art **Phantom Rush** becomes the **dash** (it overlapped Storm Blade).
3. **Ruin**'s art becomes the **cone smash** and is named **Cataclysm**. **Tidebreaker**'s art
   (flat 5 to everything within 2) keeps its behaviour and is renamed **Annihilate**.
4. **Doomblade**'s **Doom Thrust** becomes the **leap** (it overlapped Skewer / Piercing
   Charge), name kept.
5. **Starfall** and **Hermit's Bow** stop sharing Starfall Volley. Starfall's **Starfall
   Volley** becomes a **falling-star volley** aimed at a tile far away; Hermit's Bow gets a
   new **fan** shot.
6. The long-range bow as its own weapon is dropped (Starfall's volley covers the reach).
7. Every one of these arts stays player-only (`allowedFactions: ["player"]`, as every
   legendary art).
8. **Ability slots** (built first, §7): abilities (Shove, Pull, Dance, Steal and every other
   `trigger: "action"` skill) no longer take one of the five skill slots; they have three of
   their own.

Art ids never change (saves and suspended intents hold ids); names and bodies do. So
`legend_annihilate` is Ruin's art, now named Cataclysm, and `legend_cataclysm` is
Tidebreaker's, now named Annihilate.

## 1. The cone: Ruin's Cataclysm (`legend_annihilate`)

**Shape `cone`** (new in `AreaShapes`): rows of tiles behind the target, on the attacker →
target axis, each row centered on that axis.

```json
"area": { "shape": "cone",
          "rows": [ { "width": 3, "multiplier": 0.75 }, { "width": 3, "multiplier": 0.5 } ],
          "damage": { "kind": "scaled", "multiplier": 1 }, "strikes": "once" }
```

- Row 1 is the target itself (the ordinary attack: hit, crit, counter). `rows[0]` is the row
  right behind it, `rows[1]` the next: 3 + 3 tiles, 7 with the target (owner's figure).
- A tile's blow is the art's area blow × that row's `multiplier` (×0.75, then ×0.5). The
  `damage.multiplier` stays the art-wide factor (1 here). Per-tile multipliers are a general
  field of a shape's tiles, read by `planAreaBlows`, so the preview, execution and the AI
  agree.
- **Facing.** The cone needs a straight approach: attacker and target share a row or column
  (always so for Ruin, range 1). Otherwise the shape is empty (as `line`).
- **Walls.** A solid tile (impassable even to fliers) blocks itself and every tile behind it in
  its own file. Units never block. Off-board tiles are dropped.
- Once per use (`strikes: "once"`), hit-gated and alive-gated like every non-line area.
- `noFollowUp: true` (every area art).
- **Numbers.** Ruin 14 Mt. Art: HP 9, map 2, turn 1, Atk +5, Hit +10. Annihilate's old +16
  Atk and its kill buff go: the area is the payoff. With STR 22 against DEF 10 the primary
  takes about 31, the row behind about 23 each, the last row about 15 each.

## 2. The fan: Hermit's Bow's Fan Shot (`legend_hermit_fan`, new)

**Shape `arc`** (new): the target and the tiles **on the same distance ring** from the
attacker next to it, `width` steps each way round the ring. Width 1: three tiles, the
target and its two neighbours on the ring.

- Range 2, target due south: the two tiles diagonal to the archer, one row closer.
  Range 2, target diagonal (1,1): the tiles 2 straight east and 2 straight south.
  Range 1, target south: the tiles east and west of the archer.
- No facing to choose and no tie to break: the ring is defined for every target.
- Side tiles take the art's blow × 0.7 (the target is the ordinary attack). Once per use.
- **Numbers.** HP 6, map 2, turn 1, Hit +10. `noFollowUp`.
- Hermit's Bow keeps its +4 STR/SPD with no adjacent allies; the fan is a reason to stand
  apart and shoot into a crowd.

## 3. The falling-star volley: Starfall's Starfall Volley (`legend_starfall_volley`)

A chosen-center strike (the Stormcall path, no engine change):

```json
"targeting": "chosen_center",
"area": { "shape": "radius", "radius": 1, "centerRange": { "min": 3, "max": 7 },
          "damage": { "kind": "scaled", "multiplier": 0.6 } }
```

- Aim any tile 3 to 7 away; it and the 4 tiles beside it take ×0.6 blows. No hit roll, no
  crit, no counter (as Stormcall). Blind fire allowed (aoe-weapon-arts §11.2).
- **Numbers.** HP 7, map 2, turn 1, Atk +3. Only Starfall carries it; Hermit's Bow is dropped
  from its `legendaryWeaponIds`.

## 4. The dash: Oathblade's Phantom Rush (`legend_phantom_rush`)

The ordinary attack on the adjacent foe, then a line, then the user dashes through.

```json
"area": { "shape": "line", "length": 2, "damage": { "kind": "scaled", "multiplier": 0.75 },
          "strikes": "once" },
"effects": { "afterCombat": [ { "type": "move", "mode": "dash", "distance": 3 } ] }
```

- **Strike.** The art's normal attack on the target (tile 1). `multiHit` goes.
- **Line.** Foes on tiles 2 and 3 of the straight line take a ×0.75 blow (the existing line
  step: it lands even if the counter fells the user; a wall ends the line).
- **Dash** (new move mode `dash`, distance 3). Needs the target cardinally adjacent (every art
  move does). The user ends on the farthest tile it can stand on, of: tile 4 (just past the
  line), tile 3, tile 2, tile 1 (the target's tile only if it fell). A tile it can stand on
  is on the board, passable for its move type, and free (a fallen unit does not block).
  The path is not walked: units on tiles 1-3 are passed (that is the lunge), but a solid tile
  (a wall) ends the candidates at the tile before it. If no candidate is free, it stays.
- Rooted users don't dash. The dash is the user's own move: no Ice slide. It reads the real
  board (it resolves after the commit): a fogged unit on a candidate only makes it unfree.
- Hit-gated, like every art move: a miss is a plain attack, no line, no dash.
- **Numbers.** Oathblade: Mt 9 → 15, Crit 0 → 20, Hit 85, Wt 8, special none ("Attacks twice"
  dropped). Art: HP 8, map 2, turn 1, Atk +4, Hit +10, Crit +10, `noFollowUp`.

## 5. The leap: Doomblade's Doom Thrust (`legend_doom_thrust`)

A chosen-center art whose center is where the user lands.

```json
"targeting": "chosen_center",
"area": { "shape": "around_attacker", "radius": 1, "leap": true,
          "centerRange": { "min": 1, "max": 2 },
          "damage": { "kind": "scaled", "multiplier": 0.8 } }
```

- **Aim.** Any tile within 2 (Blink's diamond; units and terrain between are leapt over) that
  the user can stand on and that the player knows is free: a fogged tile counts as taken (as
  Blink Strike's `knownTileOccupant`). Its own tile is not a center.
- **Fire.** The intent is saved first (the `area_strike` intent, pre-leap). Then the cost, then
  the leap (the unit is placed on the landing tile), then a ×0.8 blow on every foe adjacent to
  the landing tile. No hit roll, crit or counter.
- **A hidden unit on the landing tile** (the real board) fails the leap: the cost and the use
  are spent, the unit stays, the hidden unit is revealed (contact), the action ends.
- Rooted units can't start it. No Ice slide on landing. No Canto after.
- Preview: the landing tile, and the adjacent tiles with the known foes' blows.
- **Numbers.** Doomblade (12 Mt, 1-2) unchanged. Art: HP 8, map 2, turn 1, Atk +6.
- Validation: a `leap` area is `chosen_center`, `around_attacker`, with a `centerRange`.

## 6. Saves: the relic update

Saves store whole items, so a looted Oathblade keeps 9 Mt and "Attacks twice", and a looted
Hermit's Bow keeps Starfall Volley as its innate art. `engine/LegendaryRelicMigration.js`
(pure, idempotent, the walk of `WeaponCatalogMigration`: every saved item anywhere in the
save, by catalog name with forge suffix and imbue word stripped, never a random legendary)
applies a frozen revision table once per item (`_relicRevision` stamp):

- Oathblade: Might +6, Crit +20 (deltas, so a forge or wear step is kept), `special` set to the
  catalog's.
- Hermit's Bow: the innate `legend_starfall_volley` binding becomes `legend_hermit_fan`
  (scroll-bound arts untouched).

Runs in `RunManager.fromJSON` after the item-name and per-battle migrations. A suspended
intent naming Starfall Volley on a Hermit's Bow fails `_legal` on resume and is dropped (the
unit may act again): accepted.

The other arts change by id, so every owned copy changes at once. A CHANGELOG line says so.

## 7. Ability slots (built)

`engine/SkillSlots.js`: one `unit.skills` list, counted in two pools, MAX_SKILLS (5) skills and
MAX_ABILITIES (3) abilities (`trigger: "action"`, from skills.json). `learnSkill`, the loadout
swap (only a skill of the same kind makes room), the personal-skill restore, starting skills,
run records and the roster and detail views read the per-kind caps. A save holding more than
three abilities benches the overflow once on load, locked skills kept first.

## 8. Slices

1. Ability slots (built).
2. `cone` and `arc` shapes with per-tile multipliers; Ruin, Tidebreaker, Hermit's Bow data;
   display rows; tests (built).
3. Starfall's volley (data, display, tests) (built).
4. `dash` move; Oathblade data; relic migration; tests (built).
5. Leap (`area.leap`): engine centers, AreaTargetingController landing flow, preview,
   resume, the fog failure; tests (built).
6. Browser spec (`tests/e2e/legendary-arts.spec.js`, battle-input lane), CHANGELOG, the
   balance test counts (built).

## 9. As built

- The relic update recognises an old copy by content (Oathblade's "Attacks twice", Starfall
  Volley innate on a Hermit's Bow), never by a stamp: a copy made after the rework never
  matches, so no load applies the deltas twice, and a save written back by an older build is
  fixed on its next load.
- The dash's landing is previewed in the forecast ("Dash if it hits: N tiles on") and drawn as
  a line to a ringed tile; a foe the preview says falls frees its tile. As every art with an
  after-combat effect, Phantom Rush's forecast hides the HP estimate (the fail-closed
  `weaponArtProjectionSafe` rule).
- The leap's settle step is `AreaStrike.settleLeap`, called by the scene and the harness. Its
  prompt reads "Leap: Doom Thrust"; the cursor cycles the landings beside seen foes.
- The kill-buff mechanism (Annihilate's old body) and the old Doom Thrust (line, then push)
  have no catalog art now; their tests run on fixtures (`tests/helpers/legacyArts.js`, the
  kill-buff fixture in `WeaponArtsDeferredClosure.test.js`).
- Not run locally: `test:sim`, `test:harness` (the AreaStrike harness tests are in the unit
  run), the sim full-run slices. CI runs them.
