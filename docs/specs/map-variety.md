# Map variety: template groups, layout choices, mirroring

Status: first slice built (October 2026). The survey and the full proposal (six shapes, later
slices) are in the project's review notes; this file records what the code does.

## Why

Every procedural template put the army on the left edge and the whole enemy force on the right,
and on rout maps every enemy charges from turn 1, so a battle played as one front. Eight
templates were one shape (a middle band with a crossing), 82% of Act IV rout maps because the
tundra and volcano biomes had only band templates.

## Template fields (engine/TemplateLayout.js, pure)

All optional; a template that names none draws and generates exactly what it did before.

| Field | Meaning |
|---|---|
| `enabled: false` | Never drawn by a random pick (`pickTemplate`, `pickTemplateForNode`, via `isTemplateDrawable`). A battle that names it (`templateId`, the dev route) still plays it. New shapes ship this way until they have been played. |
| `choices: [{ id, options: [{ weight?, zones, features? }] }]` | One option per choice is taken for the battle and its zones/features added to the template's. One draw per choice. Option zones may add only an `enemySpawn` zone that carries a group; no Throne. |
| `mirror: 'y'` | The battle flips the template top to bottom half the time (one draw): zones, structures, `escapeZone`, features (`topRight` ↔ `bottomRight`) and reinforcement edges (`top` ↔ `bottom`). Refused beside the tile-placed fields (`hybridArena`, `phaseTerrainOverrides`, `entitySpawn`) and `scriptedWaves`. |
| `extraEnemies: N` | 1-4 more foes than the battle rolled, still under the map's density cap. No draw. |
| `sizeByAct: { act2: [cols, rows], ... }` | The map's size in each act the template lists, in place of the act's size from `mapSizes.json` (a long, narrow road). 10x7 to 20x13: 20 columns fill the 640 px board, 13 rows is the final boss's arena. Needs `acts`, a size for each, and no `fixedSize`. No draw: the act's size roll is still taken first. |
| zone `group: { id, share, ai, wakeTurn?, role? }` | On an `enemySpawn` zone. Filler enemies are split among groups by share (largest remainder; a hold group below 2 folds into the largest other group). `ai`: `chase` (today's), `hold` (one hold pack, `engine/HoldActivation.js`: wakes when its Danger is entered, one is hurt or falls, or on `wakeTurn`, required on rout), `guard` (keeps its post). Clerics and Necromancers keep their own roles. `role` (`GROUP_ROLES`: `front` armour and foot soldiers, `ranged` archers, mages and the odd healer, `flank` riders and fliers) weighs the classes the group's foes are drawn from, in place of the template's `enemyWeights`; the act's pool still decides what exists. Same draws as without a role. |

The draws come from the battle's own seeded stream inside `generateBattle`, after the template
pick, and only for a template with `choices` or `mirror`. A template-group hold pack is numbered
from 100 (`TEMPLATE_GROUP_PACK_BASE`) and its spawns are kept out of the rung's
`assignHolders`, so the two never share a pack.

A locked map writes only fields every shipped client plays (`aiMode`, `holdPack`,
`holdPackSize`, `holdWakeTurn`) plus two inert records, `battleConfig.templateChoices` and
`enemySpawn.templateGroup` (`RUN_FORMAT_FIELDS`), and `battleConfig.mirrored` (read by the
formation's spare tiles).

`validateTemplateLayout` (run by `npm run validate:data`) refuses unknown keys, bad shares or
AI modes, a `wakeTurn` outside 2-12 or on a non-hold group, a rout hold group with no wake turn,
ungrouped enemy zones beside grouped ones, more than one `playerSpawn`, and the mirror/choice
misuses above.

## Shapes

| Id | Objective | Acts | State | Shape |
|---|---|---|---|---|
| `corner_camp` | rout | 2-4 | off | Army in a corner; a raiding party of riders (`flank`) charges down the near edge into it while the main force comes from the far corner; a third group either holds along the other near edge (wakes turn 3) or raids from the top middle (seeded). Two extra foes (they raise par as any foe does). Mirrored. |
| `three_roads` | rout | 2-4 | off | Two walls split the map into a fast middle road (guarded by a ranged group, ballista) and two forest side lanes, each wall with one seeded gap. Par +3. |
| `three_roads_keep` | seize | 2-4 | off | Three Roads with a keep and the throne at the road's end; waves from top and bottom. Par +2. |
| `long_road` | seize | 2-4 | off | 20 columns long and 8-10 rows deep: a road through a pass between two cliff bands, a forest track along each edge. A picket of riders (`flank`) meets the army on the road, a ranged group waits on one track (seeded; the other track has a gap through its cliff) and wakes when you come near or on turn 4, and a `front` garrison guards the keep and its throne. Pursuit comes from behind (the left edge) on the higher rungs. One extra foe. |
| `caught_in_the_open` | rout | 2-4 | off | Army a little in from the left on open ground, the main body ahead; riders (`flank`) wait in pods above and below (or one big pod, seeded) and wake when you come near or on turn 3. One extra foe. Mirrored. |
| `two_camps` | rout | 2-4 | off | A ridge splits the far side into two camps: one charges, the other is a fortified `front` camp that holds until disturbed or turn 4. Which is which is mirrored; the ridge's gap is seeded. One extra foe. |
| `snowbound_woods` | rout | 4 | live | Tundra forest ambush (not a band). |
| `ashen_ridge` | rout | 4 | live | Volcano ridge with a central ballista (not a band). |

The two live Act IV shapes cut the band share of Act IV rout maps from 82% to 63% (300 route
maps per act; Acts I-III unchanged).

## Checks

- `tests/TemplateLayout.test.js`: legacy templates unchanged and drawing nothing, exact mirror,
  switched-off templates never drawn, group counts and orders, rung packs kept apart, a hold
  group waking on its turn in the harness, determinism, the validator.
- `tests/harness/TemplateBattles.test.js`: a run's army at the act's first route battle, fought
  as the node was and on each new shape (tactician and scripted agents): invariants, no hung
  battle, a win-rate floor; prints win rate and turns against par.
- Review: `?devScene=battle&preset=battle_smoke&template=<id>&act=N`.

## Next

Further shapes (corner keep, side exit) and the
owner's later ideas (split-start sieges with a central throne, indoor rooms with treasure,
defeat-the-elites objectives, soft clocks, encounter roles, map-quality metrics in the harness).
