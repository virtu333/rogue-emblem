# Enemy AI profiles: weighted scoring in data

Status: proposal, revision 1 (2026-10-05). No game code or data changes yet.

The enemy AI picks an attack by adding up weighted parts of a score. Today the weights
are numbers written into `AIController.js`. This spec moves them into a data file of
named **profiles**. It adds the parts a profile needs to play differently: danger at the
landing tile, staying near allies, and target roles. A unit's profile comes from fixed
rules, never a random roll. The idea comes from Fire Emblem: The Sacred Stones
(`AiComputeCombatScore` in the FE8 decompilation: `src/cp_battle.c`,
`src/cp_data.c`). This spec takes only the structure from FE8, no code or numbers.

## 1. Where we are

### How an enemy chooses today

All references are to `src/engine/AIController.js`. `_decideAction` (283-782) takes the
first rule that applies:

1. hold
2. planted artillery
3. guard
4. seize-boss throne clamp
5. seek_tile
6. heal
7. a healer with no weapon follows its allies
8. status staff
9. **attack**
10. chase the priority target
11. move toward a wall to break it
12. greedy fallback
13. recovery
14. break wall

Only the **attack** step is scored across choices. It finds the best
`_scoreAttackTarget(enemy, target, berserk, landing)` over every candidate landing
tile × every target in range of the **equipped** weapon. On a tie the first pair found
wins: the current tile, then the movement-range order, players before NPCs.

`_scoreAttackTarget` (1262-1305):

| Term | Today |
|---|---|
| Damage dealt | expected damage from `getCombatForecast` from the landing tile: Σ damage × `hitProbability(hit)` × count. Crit is not counted |
| Kill | +12 if expected damage ≥ target HP |
| Counter damage taken | − taken × (0.35 + 0.65 × (1 − own HP fraction)) |
| Wounded target | + 0.01 × target's missing HP (tie-break) |
| Landing terrain | + (avoid × 0.002 + def × 0.02), ×2 when below 50% HP |
| Caravan | +40 |
| Aggressive mode: target on Fort/Throne | +35 |
| Aggressive mode: target holds a Staff | +25 |
| Berserker (`aiOverride: target_lowest_hp`) | replaces everything with `1000 − target HP` |

What the score never looks at:
- What the player can do to the unit next turn. Nothing scores danger at the landing
  tile.
- Where allies stand.
- What the target is: healer, caster, commander.
- Any weapon other than the equipped one. After the target is chosen, a raw
  `atk + might − def` formula picks a weapon among those in range (609-619).

Chase moves are not scored at all:
- `_findPriorityTarget` takes the nearest player. In aggressive mode it ranks
  Fort/Throne first, then staff users, then distance.
- It then walks to the farthest reachable step of the shortest path to that target.

### What already comes from data

- `affixes.json`: one `aiOverride` (`target_lowest_hp` on Berserker).
- `mapTemplates.json`: three `aiMode: "guard"` spawns.
- `difficulty.json`: `holdShare`, `statusStaffConfig`, `siegeWeaponConfig`.

Everything else is in code:
- the scoring weights above;
- the guard radius 3 and throne radius 1;
- the heal threshold 0.75;
- the sleep and silence staff scores;
- the enemy weapon-art tuning, which `EnemyArtScoring.enemyWeaponArtTuning` (99-106)
  switches on the difficulty id. That breaks the CLAUDE.md rule that a table keyed by
  difficulty lives in `difficulty.json`.

### Rules this work must keep

- **Determinism.** AI decisions draw no RNG: AIController has no `Math.random`. Battle
  replays, resume and the harness `Determinism.test.js` hashes depend on that. Profiles
  are fixed when a unit spawns, and spawning must not draw new `Math.random` either, or
  every seeded map after it shifts.
- **Danger stays truthful.** `ThreatForecast` (the Danger overlay, threat sight, the hold
  wake zone) draws each enemy's full reach with its `nextStrikeWeapon`.
  - A profile may use **less** of that reach (stop short, pick another target): Danger
    is an upper bound and stays correct.
  - A profile must never strike from outside it, for example by swapping to a
    longer-range weapon. `SiegeArtillery.test.js:446` pins "every tile Danger marks is
    one it strikes" for artillery, and the same contract applies here.
- **The AI sees the whole board.** Only execution and the enemy AI see every unit
  (CLAUDE.md, "Previews read what the player knows"). The danger term may read every
  player unit, even in fog.

## 2. Proposal

### 2.1 `data/aiProfiles.json`

```jsonc
{
  "defaultProfile": "standard",
  "profiles": {
    "standard": {
      "label": "Standard",
      "targeting": "scored",            // "scored" | "lowestHp"
      "chase": "nearest",               // "nearest" (today); see §2.4 for later options
      "weights": {
        "dealt": 1,
        "kill": 12,
        "takenBase": 0.35,
        "takenWounded": 0.65,
        "woundedTarget": 0.01,
        "terrainAvoid": 0.002,
        "terrainDef": 0.02,
        "terrainLowHpBelow": 0.5,
        "terrainLowHpMult": 2,
        "caravan": 40,
        "aggressiveFortTarget": 35,
        "aggressiveStaffTarget": 25,
        // New terms. All 0 in "standard", so it plays exactly as today.
        "critInDealt": 0,
        "danger": 0,
        "dangerLethal": 0,
        "friendZone": 0,
        "friendZoneCap": 0,
        "role": {}
      }
    }
  }
}
```

- **Every weight is a multiplier or a flat bonus measured in expected HP**, the unit the
  score already uses. FE8's scale is different (damage × hit / 100, capped at 40, the sum
  ×40), so its numbers do not carry over. Only the idea of named parts × a coefficient
  table does.
- The file follows every other data file:
  - a schema `schemas/aiProfiles.schema.json`, registered in `tools/validateSchemas.js`;
  - synced to `public/data/` by `npm run sync-data`;
  - loaded through `DataLoader.loadOptionalJSON`. When the file is missing, the built-in
    `standard` profile applies;
  - read in tests through `tests/testData.js`.
- A cross-reference check (`tools/validateCrossReferences.js`) fails when:
  - an affix, spawn, boss or difficulty names a profile that doesn't exist;
  - a `role` key is not one of the roles in §2.3.

### 2.2 The new terms

`score = today's terms (with weights from the profile) + the new terms below`. With every
new weight at 0, the score equals today's to the last bit.

| Term | Definition | FE8 counterpart |
|---|---|---|
| `critInDealt` | Adds `critInDealt × crit% × (crit damage − damage)` to each strike group's expected damage. 0 = today | none (FE8 ignores crit) |
| `danger` | − `danger × min(D, own HP)`. D is the expected damage players could deal this unit at the landing tile next player phase (below) | `AiGetDangerScoreComponent` |
| `dangerLethal` | − `dangerLethal` when D ≥ own HP **after** this exchange's expected counter damage | none |
| `friendZone` | + `friendZone × min(allies within 3 tiles of the landing tile, friendZoneCap)` | `AiGetFriendZoneCombatScoreComponent` |
| `role.<role>` | + a flat bonus when the target has that role (§2.3) | `AiGetTargetClassCombatScoreComponent` |

**Computing D.**
- **Built once per enemy decision, against the board as it is now.** Earlier enemies this
  phase may have moved or killed someone.
- **A pure `engine/PlayerThreatMap.js`** returns, for each player unit and allied NPC, the
  tiles it could strike next player phase:
  - every tile reachable by stopping on some tile of `grid.getMovementRange(...)` and
    then attacking with any usable weapon from there;
  - unlike `ThreatForecast.unitReach`, tiles inside its movement range count too.
  - The enemy that is choosing counts as gone from its start tile, so it doesn't block
    paths to itself (`positionsWithMoverAt` does this already).
- **D(landing)** = Σ over players that can strike the landing tile of
  `expectedDamage(player → this enemy)`:
  - one `getCombatForecast` per (player, enemy) pair, with the player's equipped weapon;
  - the distance is the player weapon's minimum range;
  - the defender's terrain is the landing tile's terrain.
  - Memoise per (player, enemy, terrain type). The cost is about players × enemies ×
    terrain types per phase, not per landing tile.
- **D ignores** Vision rewinds, staves, items, weapon arts, Rally and dance. It is a
  heuristic, not a promise. The spec says so in the code comment so nobody "fixes" it
  into a full simulation.

**Performance budget.** One enemy phase with 15 enemies and 10 players must stay under
**50 ms** of AI time on a mid-range phone.
- Measure it with the harness `byReason` run plus a timing wrapper. If it goes over, D
  falls back to "number of players who can strike × 0.5 × own HP" for that phase. That
  fallback must also be deterministic.
- PR 2 records the measurement here.

### 2.3 Roles

Roles are derived from existing unit fields, in a pure `AiScoring.targetRoles(unit)`.
No new unit fields.

| Role | Meaning |
|---|---|
| `healer` | carries a usable healing staff |
| `caster` | attacks with MAG (Tome / Light / Dark / Breath) |
| `ranged` | can strike at distance 2 or more |
| `armored` | an Armored move type |
| `lord` | a lord unit |
| `commander` | the run's commander: the lord whose fall ends the run |
| `fragile` | DEF + RES at or below the enemy's attack minus a margin in the profile (`role.fragileMargin`) |

A target can hold several roles; their bonuses add up. `caravan` stays its own term,
since it is an objective, not a role.

### 2.4 Assigning profiles

`AiScoring.resolveProfileId(unit, ctx)` decides. It is pure, draws no RNG, and the first
match wins:

1. An affix's `aiProfile` (Berserker: `"berserker"`, which replaces
   `aiOverride: "target_lowest_hp"`; the old key stays readable for one release).
2. The spawn's own `aiProfile`: a template spawn in `mapTemplates.json`, a boss def in
   `enemies.json`, a reinforcement wave.
3. `difficulty.json` `aiProfiles.byClassRole`: the rung may give a class role a profile,
   for example "thieves are hunters on Nightfall".
4. `difficulty.json` `aiProfiles.default`.
5. `aiProfiles.json` `defaultProfile` (`standard`).

- The id is stored on the unit at spawn (`unit.aiProfile`). It saves with the battle, as
  every unit field does through `serializeBattleUnit`.
- A unit loaded from an older save without the field resolves on first use.
- `aiMode` (guard, hold, heal, seek_tile) is **not** replaced. A mode still decides
  *whether* a unit fights or moves. A profile decides *how it ranks* fights. Healers,
  artillery, holders and the Entity keep their own rules; only their attack choice reads
  the profile.

### 2.5 Starting profiles (PR 2, tuned by sim)

| Profile | Character | Weights that differ from `standard` |
|---|---|---|
| `standard` | today's AI | none |
| `berserker` | the affix as it plays today | `targeting: "lowestHp"` |
| `reckless` | ignores the counterattack, loves kills | `takenBase 0`, `takenWounded 0.3`, `kill 18` |
| `cautious` | avoids your kill zones, keeps near allies | `danger 0.6`, `dangerLethal 10`, `friendZone 1.5`, `friendZoneCap 3` |
| `hunter` | goes for the soft back line | `role.healer 10`, `role.caster 6`, `role.fragile 4`, `danger 0.2` |
| `warden` | bosses and elites: holds a good tile | `terrainDef 0.1`, `terrainAvoid 0.01`, `danger 0.3` |

The numbers are starting points only. PR 2 tunes each one with the sims in §4 before any
rung uses it.

**First Light stays `standard` everywhere except Berserker.** That matches the Dusk
pressure rule that First Light doesn't change. The other rungs get profiles only through
`byClassRole` and boss defs, after the sims.

### 2.6 Enemy weapon arts move to data

`enemyWeaponArtTuning` (`EnemyArtScoring.js:99-106`) becomes
`difficulty.json` `enemyArtTuning: { minScore, useChance }` on all four rungs:

| Rung | minScore | useChance |
|---|---|---|
| `normal` | 2.25 | 0.6 |
| `dusk` | 1.5 | 0.75 |
| `hard` | 0.75 | 0.9 (today's fallback branch) |
| `lunatic` | 0.25 | 1.0 |

The function keeps its signature and reads the config. With no difficulty id it keeps
today's fallback (0.75 / 1.0). The roll order is unchanged:
`EnemyArtScoring.test.js` and the harness tuning ladder must pass untouched.

### 2.7 Later, not committed: a scored chase

A unit that cannot attack this turn still runs to the nearest player. A later revision
could score the approach tile instead:
- `chase: "scored"` scores the farthest reachable step of each target's path with
  `danger`, `friendZone` and the target's role.
- A `cautious` unit could then stop at the edge of your reach instead of walking into
  it.

This is held back because standing still at the edge of your reach is the turtle-bait
standoff that `docs/specs/dusk-pressure.md` worked to remove. If it ships, it must:
- switch off under `aggressiveMode` and boss enrage;
- stay out of rout maps unless a rout ladder is active;
- show no rise in `no_reachable_move` / stall rates in the harness.

## 3. Out of scope

- **Retreating or healing at a fort.** FE8 has a retreat AI and Rogue Dawn has none.
  That is a new decision, not a weight.
- **Scoring every weapon in the inventory** for (landing, target). It would change which
  tiles a unit can strike from, and `ThreatForecast` would have to draw the union of
  every weapon's reach. Its own spec, if wanted.
- **Changing the order of the decision steps** in `_decideAction`.
- **Making the AI read fog.**

Known oddities to note in code comments, not fix here:
- the seek_tile opportunistic attack scores from the start tile, not the landing tile;
- Berserker is ignored by the Entity and by seek_tile attacks.

## 4. Testing and measurement

Following CLAUDE.md "Writing tests". Each test catches one way the change can fail.

| Failure | Test |
|---|---|
| The move to data changes today's AI | **Golden decisions.** Before PR 1, record `_lastAiDecision` (reason, target, landing tile, weapon) for every enemy action across the `Determinism.test.js` scenarios plus 40 seeded `HeadlessBattle` battles over all four rungs, into `tests/fixtures/ai-golden.json`. PR 1 must match it exactly. The Determinism hashes must not move either |
| A weight is read with the wrong name or scale | `AiScoring.test.js`: hand-computed expected scores (from a fixed forecast, not by calling the scorer) for each term on its own, then all together |
| A new term leaks into `standard` | Property test: with `standard`, `scoreAttack(...)` equals the frozen copy of today's `_scoreAttackTarget` kept in the test, for 500 generated (enemy, target, terrain) cases |
| D is wrong | `PlayerThreatMap.test.js`: hand-built grids. A player behind a wall can't strike; a bow reaches 2 but not 1; tiles inside the movement range count; the mover doesn't block itself; a dead player adds nothing |
| A profile strikes outside Danger | For every profile, extend the SiegeArtillery-style check: over seeded battles, every executed enemy attack starts from a tile the Danger overlay drew for that unit before the enemy phase |
| RNG gets drawn | Profile resolution and scoring under a `Math.random` that throws (as `ThreatForecast.test.js:214` does) |
| Spawning draws RNG | Seeded `MapGenerator` output (positions, classes, levels) is identical before and after profile assignment |
| A save without `aiProfile` breaks | Load a fixture checkpoint from before the change; resume; same decisions as the golden record |
| Bad data | `validate:data` fails on an unknown profile id, an unknown role, or a negative cap |
| Too slow | Harness timing over 40 battles; the 95th-percentile enemy phase is under the §2.2 budget |

**Sims (PR 2 and on).** Per profile, run the calibrated `sim/pacing.js` turtle and push
policies and `sim:fullrun` with that profile forced on every non-boss enemy. Report:
- player would-be KOs per battle;
- turns per battle and the shadow gained;
- the decision `byReason` mix, including `no_reachable_move`;
- the AI time per phase.

A profile is ready for a rung when it:
- moves KOs per battle by less than the rung's target change (the owner sets this per
  rung);
- does not raise stalls.

## 5. Delivery

| PR | Content | Behaviour change |
|---|---|---|
| 1 | `engine/AiScoring.js` (pure scoring + profile resolution), `data/aiProfiles.json` with `standard` and `berserker`, schema, loader, cross-reference checks, `enemyArtTuning` in `difficulty.json`, golden-decision fixture and tests | **None.** Golden decisions and Determinism hashes match exactly |
| 2 | `PlayerThreatMap`, the new terms, the starting profiles (unused by any rung), sims and timing recorded in this spec | None in play. Profiles exist only in tests and sims |
| 3 | Assigning profiles per rung (`byClassRole`, boss defs) from the sim results; changelog | Yes, Dusk and above only |
| 4 (optional) | Show the profile on enemy inspect (a one-word tag + one line, e.g. "Cautious — avoids your attack range") | UI only |

## 6. Decisions for the owner

1. **Tell the player?** Show a unit's profile on inspect (PR 4)? Recommended: yes. It
   turns profiles into something to read and plan around, which fits "positioning
   matters". FE8 hides it.
2. **Which rungs get which profiles first?** Proposed: Dusk gives `hunter` to thieves
   and Myrmidon-line units; Nightfall and Black Sun add `cautious` to armored units and
   `warden` to bosses. Final calls after the PR 2 sims.
3. **Scored chase (§2.7)**: keep it out for now?
4. **Crit in expected damage**: turn `critInDealt` on in `standard`? It makes enemies
   favour high-crit attacks (killers, Myrmidons). Small behaviour change on every rung,
   including First Light. Recommended: no, keep it per profile.
