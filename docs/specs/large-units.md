# Big bodies and the Iron Guardian

Status: built (October 2026). Owner ask: a brand-new unit, maybe a multi-tile one with a lot of
health, for the Sunken Mine's end fight, and a body other events can reuse.

## 1. Big bodies

A unit whose class carries `footprint: { width, height }` (1-3 each; classes.schema) fills that
many tiles from its anchor `(col, row)`, its top-left tile. The Entity's 3x3 stays a constant
(`ENTITY_FOOTPRINT`), never this field. `EntitySystem.footprintSize` is the one reader;
`isLargeUnit` asks "more than one tile", `getFootprint` lists the tiles and `bodyCenter` is
the middle (a 2x2's lies between tiles, at +0.5) for drawing.

The body rules that were the Entity's now ask `isLargeUnit`, so every big body follows them:

- **Standing and blocking.** Every body tile is occupied (walks, placement, reinforcement
  arrivals, `PlayerKnowledge`).
- **Distance.** `combatDistance` measures to the nearest body tile, both ways (attack ranges,
  counters, auras, Deathburst, ability radii).
- **Sight.** A body tile the fog shows shows the unit (`BattleInformation.isUnitSeenAt`).
- **Never moved.** A push, ram, Smite, Swap or slide never moves a big body
  (`ForcedMovement.displacementBlockReason`, `resolvePostCombatMove`).
- **Never walks.** The AI holds and strikes from where it stands; Danger and Threat Sight draw
  its reach from its body, not as a walker (`ThreatForecast`).
- **Drawing.** One sprite over the body's middle (traced sprites one tile wider than the body:
  the Entity 128 world px, a 2x2 96), the HP bar and the ground ring spanning the body
  (`factionRingStyles.ringGeometry` `bodyWidthTiles`), the boss bar as wide.

What stays the Entity's alone (`isEntity`): its splash, limbs, Undertow, Unfathomed, crit and
proc odds, music, and its `entityReachInfo`.

Tests: `tests/LargeUnits.test.js`.

## 2. The Iron Guardian

An enemy-only boss-tier class (data/classes.json; in `NEVER_COPIED_CLASSES`): a 2x2 body, MOV 0,
the enemy-only maul **Ironfall Maul** (Axe, Mt 10, range 1, price 0, in no loot table). Its
stats come by act (`statsByAct`: act2 68 HP, act3 96, act4 124, RES 2 / 6 / 10 (mages are the answer to the plate, not a turn-2 kill); `UnitManager.bossStatsForAct`:
the act's block, else the nearest earlier one, else `baseStats`); its level is the spawn's, so
XP reads it. A set piece's captain slot fields it (`isBoss`: the boss stat bonus, the boss bar,
a `defeat` of `@boss`).

**Iron Plates** (`plates: { count, defPerPlate, strPerPlate }`): a plate is shed for each
equal share of max HP lost (never the last), each one DEF down and Might up
(`IronGuardian.platesOf`; added in `SkillSystem.getSkillCombatMods`, so the forecast and the
blow agree). The longer the fight, the softer and the harder-hitting it is.

**Hammerfall** (`hammerfall: { might }`): at each enemy-phase start, after the Entity's limbs,
`hammerfallPhase` lets the marked tiles fall (each unit standing on one takes STR + plates +
might − its DEF, through `damageUnitDetailed`, the Banner and stones honoured; a fallen victim
is removed before the next), then marks the next ones toward the nearest unit of the army,
alternating **front** (the body's facing edge, 3 rows deep) and **shock** (every tile within 2
of the body). The marks follow from the board alone, never a random draw. State
`hammerfallState = { marks, pattern, next, slams, lastProcessedTurn }` rides the battle
checkpoint (validated in `BattleStateSnapshot`), so a resume or a Vision rewind lands on the
same marks and a resumed phase never slams twice. A map flags it in its config
(`hammerfall: { v: 1 }`, the run-format capability `hammerfall`).

Danger shows the marks as the Guardian's reach (`ThreatForecast.enemyThreatTiles` reads
`ctx.hammerfallMarks`, which `BattleScene.threatContext` and the harness's
`_playerThreatContext` pass; they are in `threatWorldSignature`, so Threat Sight redraws when
they move), and the TacticianAgent plants any big body as it does the Entity.

Scene: `ui/HammerfallController.js` (marks drawn only while the Guardian is seen, the
"Hammerfall!" banner, the `sfx_hammerfall` cue, a crash shake, the hit numbers). Harness:
`tests/harness/headlessConjuring.js` (`processHammerfall`). Cards: `guardianCardLines`
("Iron Plates: 2 of 4 · DEF -6, Might +4", "Hammerfall: falls in front next (marked)").

Tests: `tests/IronGuardian.test.js`, `tests/GuardianBattle.test.js`, and the whole battles in
`tests/harness/HeadlessGuardianHall.test.js` (an act-level army, careful and reckless policies).

## 3. The Guardian's Hall

Two set pieces (data/setPieces.json, acts II-IV): `guardian_hall` (lit) and
`guardian_hall_dark` (fog forced on), the same 14x11 hall of floor, wall and pillars, the
Guardian at its far end, Zombies beside it and two small waves. The Sunken Mine's level three
names one or the other by the torches left (docs/specs/event-nodes.md, "Act-fit events").

A set piece slot whose class has a body claims and checks every tile (`SetPieces` validator:
`bodyOf`, `bodyTiles`); a big body may not hold, be gated by rung or act, or arrive in a wave,
and a mirrored one shifts by its width.
