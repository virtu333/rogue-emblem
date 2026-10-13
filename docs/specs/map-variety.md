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
| two `playerSpawn` zones | A split start: the army deploys in two groups. The deploy count is shared, the first zone taking the larger half (a zone too small passes its overflow to the other), and the slots alternate between the zones (Edric's first slot in the first zone, the second unit's in the second, ...), so auto-placement splits the army and Formation lets the player move units between groups. The generator opens a way from the first group to the second as it does to the foes, and Formation's spare tiles come from both zones. No more than two. |
| `sizeByAct: { act2: [cols, rows], ... }` | The map's size in each act the template lists, in place of the act's size from `mapSizes.json` (a long, narrow road). 10x7 to 20x13: 20 columns fill the 640 px board, 13 rows is the final boss's arena. Needs `acts`, a size for each, and no `fixedSize`. No draw: the act's size roll is still taken first. |
| zone `group: { id, share, ai, wakeTurn?, role? }` | On an `enemySpawn` zone. Filler enemies are split among groups by share (largest remainder; a hold group below 2 folds into the largest other group). `ai`: `chase` (today's), `hold` (one hold pack, `engine/HoldActivation.js`: wakes when its Danger is entered, one is hurt or falls, or on `wakeTurn`, required on rout), `guard` (keeps its post). Clerics and Necromancers keep their own roles. `role` (`GROUP_ROLES`: `front` armour and foot soldiers, `ranged` archers, mages and the odd healer, `flank` riders and fliers) weighs the classes the group's foes are drawn from, in place of the template's `enemyWeights`; the act's pool still decides what exists. Same draws as without a role. |
| group `captain: { name }` | Rout templates only, on a base zone (never a choice's: the route map names the captains before the battle). The group's strongest foe (the earlier on a tie; a healer, Necromancer or Zombie only when the group has nobody else) becomes its captain: the name, an authored id `captain_<group id>` and the elite captain's level (`CaptainLevel.captainLevelFor`) when that is higher than its own. It keeps its group's orders and never carries. The map becomes a defeat of the captains (`BattleObjectives`, `{ id: 'captains', kind: 'defeat', targets, label: 'the captains' }`), its legacy family still `rout`: kill the captains and the rest need not fall; waves keep coming, so a slow dive costs. Par reads `defeat` (`turnBonus.json` 4/1, `objectiveParOffset.defeat` if a rung names one). A captain group always fields its captain (a hold group a pack of two), taken from the largest group. The route card, the tooltip and the deploy screen read the captains from the template (`ObjectivePreview.previewObjectives(params, setPieces, mapTemplates)`); in battle each target wears a pale diamond first in its pip row. Never on a boss's map. No draw. |

The draws come from the battle's own seeded stream inside `generateBattle`, after the template
pick, and only for a template with `choices` or `mirror`. A template-group hold pack is numbered
from 100 (`TEMPLATE_GROUP_PACK_BASE`) and its spawns are kept out of the rung's
`assignHolders`, so the two never share a pack.

A locked map writes only fields every shipped client plays (`aiMode`, `holdPack`,
`holdPackSize`, `holdWakeTurn`) plus two inert records, `battleConfig.templateChoices` and
`enemySpawn.templateGroup` (`RUN_FORMAT_FIELDS`), and `battleConfig.mirrored` (read by the
formation's spare tiles).

A captains map also writes `battleConfig.objectives` and the captains' `authoredId` and `name`.
The model is the run-format guard's `defeatObjective` capability (`RunFormat.js`), so a run that
locks one is refused by an older client and kept off the cloud while
`CloudSync.CLOUD_SAFE_RUN_FORMAT` is 1, as a Descent run is. The Warband ships switched off.

`validateTemplateLayout` (run by `npm run validate:data`) refuses unknown keys, bad shares or
AI modes, a `wakeTurn` outside 2-12 or on a non-hold group, a rout hold group with no wake turn,
ungrouped enemy zones beside grouped ones, more than two `playerSpawn` zones, a captain off a rout
template, on a choice's zone or with a name over 18 characters, and the mirror/choice misuses
above.

## Shapes

| Id | Objective | Acts | State | Shape |
|---|---|---|---|---|
| `corner_camp` | rout | 2-4 | off | Army in a corner; a raiding party of riders (`flank`) charges down the near edge into it while the main force comes from the far corner; a third group either holds along the other near edge (wakes turn 3) or raids from the top middle (seeded). Two extra foes (they raise par as any foe does). Mirrored. |
| `three_roads` | rout | 2-4 | off | Two walls split the map into a fast middle road (guarded by a ranged group, ballista) and two forest side lanes, each wall with one seeded gap. Par +3. |
| `three_roads_keep` | seize | 2-4 | off | Three Roads with a keep and the throne at the road's end; waves from top and bottom. Par +2. |
| `long_road` | seize | 2-4 | off | 20 columns long and 8-10 rows deep: a road through a pass between two cliff bands, a forest track along each edge. A picket of riders (`flank`) meets the army on the road, a ranged group waits on one track (seeded; the other track has a gap through its cliff) and wakes when you come near or on turn 4, and a `front` garrison guards the keep and its throne. Pursuit comes from behind (the left edge) on the higher rungs. One extra foe. |
| `two_gates` | seize | 2-4 | off | A walled keep in the middle with the throne at its centre; the army comes at it in two companies, one at the west gate and one at the south (mirrored: the north). A `front` garrison holds the keep, riders (`flank`) sally from the far corner, and a seeded third gate (north or east) opens beside a ranged tower group that holds until disturbed or turn 3. 16x11 / 18x12 / 18x13. |
| `caught_in_the_open` | rout | 2-4 | off | Army a little in from the left on open ground, the main body ahead; riders (`flank`) wait in pods above and below (or one big pod, seeded) and wake when you come near or on turn 3. One extra foe. Mirrored. |
| `two_camps` | rout | 2-4 | off | A ridge splits the far side into two camps: one charges, the other is a fortified `front` camp that holds until disturbed or turn 4. Which is which is mirrored; the ridge's gap is seeded. One extra foe. |
| `warband` | rout (defeat) | 2-4 | off | Two camps behind a ridge, each with a captain: the riders' camp (`flank`, holds until disturbed or turn 4) and the camp proper (`ranged`, guards its post). A `front` screen in the middle charges. Defeat both captains to win; the rest need not fall, but waves keep coming from the right and top. Mirrored. One extra foe. |
| `snowbound_woods` | rout | 4 | live | Tundra forest ambush (not a band). |
| `ashen_ridge` | rout | 4 | live | Volcano ridge with a central ballista (not a band). |

The two live Act IV shapes cut the band share of Act IV rout maps from 82% to 63% (300 route
maps per act; Acts I-III unchanged).

## Checks

- `tests/TemplateLayout.test.js`: legacy templates unchanged and drawing nothing, exact mirror,
  switched-off templates never drawn, group counts and orders, rung packs kept apart, a hold
  group waking on its turn in the harness, determinism, the validator.
- `tests/TemplateCaptains.test.js`: one captain per captain group (its strongest, in its zone,
  at the captain level), no draw, the model and its family, the battle's end, the route map's and
  deploy screen's words, the split floor, the validator.
- `tests/harness/TemplateBattles.test.js`: a run's army at the act's first route battle, fought
  as the node was and on each new shape (tactician and scripted agents): invariants, no hung
  battle, a win-rate floor; prints win rate and turns against par.
- Review: `?devScene=battle&preset=battle_smoke&template=<id>&act=N`.

## Next

Further shapes (corner keep, side exit) and the
owner's later ideas (indoor rooms with treasure, soft clocks, encounter roles, map-quality
metrics in the harness).
