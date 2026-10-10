// Hybrid arenas: walls and waves (docs/specs/large-maps/02-encounters-and-pacing.md §2.2).
//
// A phase override changes its tile at the start of enemy phase T and a scripted wave
// for T resolves at the end of it, so a wave authored on an override's tile was
// blocked (First Light, Dusk), and on the rungs whose waves come a turn early the wall
// rose under the unit that had just arrived (Nightfall, Black Sun). These run the real
// HeadlessBattle on both shipped templates with a passive, unkillable army.
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ default: { Scene: class {} } }));

import { BattleScene } from '../../src/scenes/BattleScene.js';
import { HeadlessBattle, HEADLESS_STATES } from './HeadlessBattle.js';
import { HeadlessGrid } from './HeadlessGrid.js';
import { loadGameData } from '../testData.js';
import { installSeed, restoreMathRandom } from '../../sim/lib/SeededRNG.js';
import { createLordUnit } from '../../src/engine/UnitManager.js';
import { canStandOnTerrain } from '../../src/engine/TerrainPhases.js';
import {
  captureBattleWorldState,
  restoreBattleWorldState,
} from '../../src/engine/BattleSnapshotState.js';

const CASES = [
  { act: 'act4', templateId: 'act4_boss_intent_bastion' },
  { act: 'act3', templateId: 'act3_dark_champion_keep' },
];
const RUNGS = ['normal', 'dusk', 'hard', 'lunatic'];
const SEEDS = [1, 2, 3, 4, 5, 6];
const TURNS = 7; // past every wave and override of both templates on every rung

afterEach(() => restoreMathRandom());

function sturdyRoster(gameData) {
  return gameData.lords.slice(0, 6).map((lord) => {
    const cls = gameData.classes.find((c) => c.name === lord.class);
    const unit = createLordUnit(lord, cls, gameData.weapons);
    // A passive army that cannot fall, so every turn of the schedule is reached.
    Object.assign(unit.stats, { HP: 400, DEF: 40, RES: 40 });
    unit.currentHP = 400;
    return unit;
  });
}

function startBattle(gameData, { act, templateId, difficultyId, seed, editConfig = null }) {
  installSeed(seed * 101);
  const params = {
    act,
    objective: 'seize',
    isBoss: true,
    templateId,
    difficultyId,
    deployCount: 6,
    row: 9,
  };
  const battle = new HeadlessBattle(gameData, params, sturdyRoster(gameData));
  if (editConfig) {
    const config = battle._generateBattleConfig();
    editConfig(config);
    battle.init({ battleConfig: config });
  } else {
    battle.init();
  }
  expect(battle.battleConfig.templateId).toBe(templateId);
  return battle;
}

async function playTurn(battle) {
  await battle.endTurn();
  if (battle.battleState === HEADLESS_STATES.ENEMY_PHASE) await battle._processEnemyPhase();
}

const liveUnits = (battle) =>
  [...battle.playerUnits, ...battle.enemyUnits, ...battle.npcUnits].filter((u) => u.currentHP > 0);
const unitOn = (battle, col, row) =>
  liveUnits(battle).find((u) => u.col === col && u.row === row) || null;
const terrainAt = (battle, col, row) => battle.gameData.terrain[battle.grid.mapLayout[row][col]];

function overrideTiles(config) {
  const anchors = config.hybridAnchors || {};
  return (config.phaseTerrainOverrides || []).flatMap((entry) =>
    entry.setTiles.map((setTile) => {
      const at = setTile.coord
        ? { col: setTile.coord[0], row: setTile.coord[1] }
        : anchors[setTile.anchor];
      return { turn: entry.turn, col: at.col, row: at.row, terrain: setTile.terrain };
    }),
  );
}

describe('hybrid arenas: every scripted wave arrives and no wall rises under a unit', () => {
  const gameData = loadGameData();
  const moveTypeOf = (className) =>
    gameData.classes.find((c) => c.name === className)?.moveType || 'Infantry';

  for (const { act, templateId } of CASES) {
    for (const difficultyId of RUNGS) {
      it(`${templateId} on ${difficultyId}`, async () => {
        const totals = { requested: 0, arrived: 0, heldByUnit: 0 };
        for (const seed of SEEDS) {
          const battle = startBattle(gameData, { act, templateId, difficultyId, seed });
          const authoredWaves = battle.battleConfig.reinforcements.scriptedWaves;
          const overrides = overrideTiles(battle.battleConfig);
          for (let turn = 1; turn <= TURNS; turn++) {
            await playTurn(battle);
            const where = `${templateId}/${difficultyId}/seed ${seed}/T${turn}`;

            // Every authored spawn of a wave due this turn arrived, or a unit holds its tile;
            // terrain never refuses it.
            const schedule = battle.lastReinforcementSchedule || {};
            for (const due of schedule.dueWaves || []) {
              if (due.waveType !== 'scripted') continue;
              for (const spawn of authoredWaves[due.waveIndex].spawns) {
                totals.requested++;
                const tile = terrainAt(battle, spawn.col, spawn.row);
                expect(
                  canStandOnTerrain(tile, moveTypeOf(spawn.className)),
                  `${where}: ${spawn.className} at [${spawn.col},${spawn.row}] lands on ${tile.name}`,
                ).toBe(true);
                const arrived = (schedule.spawns || []).some(
                  (s) =>
                    s.waveType === 'scripted' &&
                    s.waveIndex === due.waveIndex &&
                    s.col === spawn.col &&
                    s.row === spawn.row,
                );
                if (arrived) totals.arrived++;
                else {
                  totals.heldByUnit++;
                  expect(
                    unitOn(battle, spawn.col, spawn.row),
                    `${where}: ${spawn.className} at [${spawn.col},${spawn.row}] was refused with nobody there`,
                  ).not.toBeNull();
                }
              }
            }

            // Nobody stands on terrain their move type cannot stand on.
            for (const unit of liveUnits(battle)) {
              const tile = terrainAt(battle, unit.col, unit.row);
              expect(
                canStandOnTerrain(tile, unit.moveType),
                `${where}: ${unit.name} (${unit.moveType}) stands on ${tile.name}`,
              ).toBe(true);
            }

            // Every override that is due is on the board, or waits for its tile.
            for (const o of overrides.filter((entry) => entry.turn <= turn)) {
              const pending = battle.pendingHybridOverrideTiles.some(
                (p) => p.col === o.col && p.row === o.row && p.terrain === o.terrain,
              );
              if (!pending) expect(terrainAt(battle, o.col, o.row).name, where).toBe(o.terrain);
            }
          }
        }
        // Six seeds of two two-spawn waves each.
        expect(totals.requested).toBe(SEEDS.length * 4);
        // Only a garrison unit already standing on a spawn tile turns an arrival away.
        expect(totals.arrived + totals.heldByUnit).toBe(totals.requested);
      }, 120_000);
    }
  }
});

describe('a locked bastion from before the fix (spawns on the walled anchors)', () => {
  const gameData = loadGameData();
  // The shipped data before PR 0b: the T2 Fighter on wave1_a [8,1], the T5 Knight on wave2_a.
  const oldSpawns = (config) => {
    const [wave1, wave2] = config.reinforcements.scriptedWaves;
    Object.assign(
      wave1.spawns.find((s) => s.className === 'Fighter'),
      { col: 8, row: 1 },
    );
    Object.assign(
      wave2.spawns.find((s) => s.className === 'Knight'),
      { col: 10, row: 1 },
    );
  };
  const start = () =>
    startBattle(gameData, {
      act: 'act4',
      templateId: 'act4_boss_intent_bastion',
      difficultyId: 'hard', // waves a turn early: the T2 wave lands at the end of T1
      seed: 1,
      editConfig: oldSpawns,
    });
  const fighterOn81 = (battle) =>
    battle.enemyUnits.find((u) => u.className === 'Fighter' && u.col === 8 && u.row === 1);

  async function toPendingWall() {
    const battle = start();
    await playTurn(battle); // T1: the wave lands on [8,1]
    expect(fighterOn81(battle)).toBeTruthy();
    await playTurn(battle); // T2: the wall at [8,1] is due
    return battle;
  }

  it('defers the wall under the guard, then raises it once he has gone', async () => {
    const battle = await toPendingWall();
    const fighter = fighterOn81(battle);
    expect(fighter, 'the guard holds his post').toBeTruthy();
    expect(terrainAt(battle, 8, 1).name).toBe('Plain');
    expect(terrainAt(battle, 8, 2).name).toBe('Wall'); // the free half of the override
    expect(battle.pendingHybridOverrideTiles).toEqual([
      { turn: 2, col: 8, row: 1, terrain: 'Wall' },
    ]);

    // He leaves (the player phase moves him off: here, by hand, to a free tile).
    expect(unitOn(battle, 9, 0)).toBeNull();
    Object.assign(fighter, { col: 9, row: 0 });
    await playTurn(battle); // T3's enemy phase starts with the retry
    expect(terrainAt(battle, 8, 1).name).toBe('Wall');
    expect(battle.pendingHybridOverrideTiles).toEqual([]);
  });

  it('the waiting wall round-trips the saved world state', async () => {
    const live = await toPendingWall();
    const saved = JSON.parse(JSON.stringify(captureBattleWorldState(live)));
    expect(saved.pendingHybridOverrideTiles).toEqual([
      { turn: 2, col: 8, row: 1, terrain: 'Wall' },
    ]);

    // A second battle reaches the same point; its live list is lost, then restored.
    const resumed = await toPendingWall();
    resumed.pendingHybridOverrideTiles = [];
    restoreBattleWorldState(resumed, saved);
    expect(resumed.pendingHybridOverrideTiles).toEqual(saved.pendingHybridOverrideTiles);

    for (const battle of [live, resumed]) {
      Object.assign(fighterOn81(battle), { col: 9, row: 0 });
      await playTurn(battle);
    }
    expect(resumed.grid.mapLayout).toEqual(live.grid.mapLayout);
    expect(terrainAt(resumed, 8, 1).name).toBe('Wall');
    expect(resumed.pendingHybridOverrideTiles).toEqual([]);
  });
});

describe('scene and harness apply the same overrides', () => {
  const gameData = loadGameData();

  it('BattleScene.applyDueHybridOverridesForTurn and the harness agree on board, result and pending', async () => {
    const battle = startBattle(gameData, {
      act: 'act3',
      templateId: 'act3_dark_champion_keep',
      difficultyId: 'normal',
      seed: 2,
    });
    // Put a unit on one override tile of each turn so both deferral and writing happen.
    const [, , third] = overrideTiles(battle.battleConfig); // [8,1] at T6
    const [first] = overrideTiles(battle.battleConfig); // wave1_a [7,1] at T3
    const blockers = battle.enemyUnits.slice(0, 2);
    Object.assign(blockers[0], { col: first.col, row: first.row });
    Object.assign(blockers[1], { col: third.col, row: third.row });

    const scene = Object.assign(Object.create(BattleScene.prototype), {
      battleConfig: battle.battleConfig,
      gameData,
      grid: new HeadlessGrid(
        battle.grid.cols,
        battle.grid.rows,
        gameData.terrain,
        battle.grid.mapLayout.map((r) => [...r]),
        false,
      ),
      playerUnits: battle.playerUnits,
      enemyUnits: battle.enemyUnits,
      npcUnits: battle.npcUnits,
      appliedHybridOverrideTurns: new Set(),
      pendingHybridOverrideTiles: [],
      _pinnedThreats: null,
      updateObjectiveText: vi.fn(),
    });

    for (let turn = 1; turn <= 8; turn++) {
      if (turn === 7) blockers[0].col -= 1; // the first blocker steps off before T7
      const fromScene = scene.applyDueHybridOverridesForTurn(turn);
      const fromHarness = battle._applyDueHybridOverridesForTurn(turn);
      expect(fromScene).toEqual(fromHarness);
      expect(scene.grid.mapLayout).toEqual(battle.grid.mapLayout);
      expect(scene.pendingHybridOverrideTiles).toEqual(battle.pendingHybridOverrideTiles);
    }
    expect(scene.updateObjectiveText).toHaveBeenCalled();
    // T3 deferred [7,1] under the first blocker until T7; [8,1] still waits at T8.
    expect(terrainAt(battle, first.col, first.row).name).toBe('Wall');
    expect(battle.pendingHybridOverrideTiles).toEqual([
      { turn: third.turn, col: third.col, row: third.row, terrain: 'Wall' },
    ]);
  });
});
