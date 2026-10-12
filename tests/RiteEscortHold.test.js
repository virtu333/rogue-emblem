// The Rite's escort drop on a hold pack (docs/specs/act-v-descent.md §4; engine/RiteBattleMods.js,
// HoldActivation.js). A guard the Rite takes never stood on the map: a hold pack it leaves must
// hold as a smaller pack, never wake on turn 1 as if a packmate fell (wakeHolders reads a pack
// with fewer living holders than its `holdPackSize` as a fall). The Glass has no hold slots, so
// the gate fights a synthetic copy whose two strongest guards each stand in a hold pack. Ways
// this breaks:
//   - the drop leaves the survivors' pack size as it was, so the pack wakes `fallen` on turn 1
//     (the scene and the harness both build the unit from the spawn, so both would)
//   - the drop skips holders and takes weaker guards (the Rite's promise is his strongest)
//   - a pack the drop did not touch, or a guard outside every pack, changes
import { describe, it, expect, vi } from 'vitest';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));

import { loadGameData } from './testData.js';
import { RunManager } from '../src/engine/RunManager.js';
import { applyGenerationFields, generateSeededBattle } from '../src/engine/BattleScout.js';
import { wakeHolders } from '../src/engine/HoldActivation.js';
import { BattleScene } from '../src/scenes/BattleScene.js';
import { HeadlessBattle } from './harness/HeadlessBattle.js';
import { installSeed, restoreMathRandom } from '../sim/lib/SeededRNG.js';

const baseData = loadGameData();
const RITE = baseData.descent.rite;
const descentData = () => ({
  ...baseData,
  descent: { ...structuredClone(baseData.descent), enabled: true },
});
const at = (band) => RITE.bands.find((b) => b.id === band).min;

describe('the Lieutenant: a dropped guard from a hold pack wakes no one', () => {
  const glass = baseData.setPieces.setPieces.find((p) => p.id === 'the_glass');
  const slot = (col, row, extra = {}) => ({ col, row, classes: ['General'], ...extra });
  // Offsets far past the battle's level spread, so the order of the escort is fixed.
  const holdGlass = {
    ...structuredClone(glass),
    id: 'rite_hold_glass',
    variants: [
      {
        ...structuredClone(glass.variants[0]),
        id: 'hold_hall',
        mirror: false,
        enemies: [
          { col: 14, row: 6, boss: true, aiMode: 'guard' },
          slot(13, 2, { hold: 0, level: 12 }), // the strongest: pack 0 of two
          slot(14, 2, { hold: 0 }),
          slot(13, 11, { hold: 1, level: 9 }), // the second: pack 1 of three
          slot(14, 11, { hold: 1 }),
          slot(14, 12, { hold: 1 }),
          slot(12, 5, { hold: 2 }), // pack 2 of two, untouched
          slot(12, 7, { hold: 2 }),
          slot(11, 6, { aiMode: 'guard', level: 5 }), // the strongest outside every pack
        ],
      },
    ],
  };
  const holdData = () => ({
    ...descentData(),
    setPieces: { ...baseData.setPieces, setPieces: [...baseData.setPieces.setPieces, holdGlass] },
  });

  function holdGate(words) {
    const rm = new RunManager(holdData());
    rm.startRun({ runSeed: 13, difficultyId: 'hard', applyBlessingsAtStart: false });
    rm.actIndex = rm.actSequence.indexOf('finalBoss') - 1;
    rm.advanceAct();
    rm.rite = words === null ? null : { ...rm.rite, words };
    const node = rm.nodeMap.nodes.find((n) => n.descentKey === 'gate');
    const params = { ...rm.getBattleParams(node), setPiece: holdGlass.id };
    applyGenerationFields(params, { deployCount: 6, isBoss: true });
    return { config: generateSeededBattle(params, rm.gameData, params.battleSeed), params, rm };
  }

  const tile = (s) => `${s.col},${s.row}`;
  const packSizes = (spawns) =>
    Object.fromEntries(
      spawns.filter((s) => s.aiMode === 'hold').map((s) => [tile(s), s.holdPackSize]),
    );

  it('Broken drops his two strongest guards, both holders, and their packs shrink', () => {
    const none = holdGate(null).config;
    const broken = holdGate(at('broken')).config;
    expect(none.templateId).toBe('setpiece:rite_hold_glass');
    expect(RITE.mods.broken.lieutenant.escortDrop).toBe(2);
    // Expected from the untouched map, by level: the two named slots, and both hold.
    const byLevel = none.enemySpawns
      .filter((s) => !s.isBoss)
      .sort((a, b) => b.level - a.level)
      .map(tile);
    expect(byLevel.slice(0, 3)).toEqual(['13,2', '13,11', '11,6']);
    expect(packSizes(none.enemySpawns)).toEqual({
      '13,2': 2, '14,2': 2, '13,11': 3, '14,11': 3, '14,12': 3, '12,5': 2, '12,7': 2,
    }); // prettier-ignore
    // The two strongest leave; the packs they stood in count only who is left.
    expect(broken.enemySpawns.map(tile)).toEqual(
      none.enemySpawns.map(tile).filter((t) => t !== '13,2' && t !== '13,11'),
    );
    expect(packSizes(broken.enemySpawns)).toEqual({
      '14,2': 1, '14,11': 2, '14,12': 2, '12,5': 2, '12,7': 2,
    }); // prettier-ignore
    // Nothing else about any survivor changes.
    const strip = ({ holdPackSize: _size, ...rest }) => rest;
    expect(broken.enemySpawns.map(strip)).toEqual(
      none.enemySpawns.filter((s) => !['13,2', '13,11'].includes(tile(s))).map(strip),
    );
    expect(broken.riteMods).toEqual({ band: 'broken', target: 'lieutenant', escortDropped: 2 });
  });

  it('the scene builds the survivors as holders that no rule wakes on turn 1', async () => {
    const { config, params } = holdGate(at('broken'));
    const scene = new BattleScene();
    Object.assign(scene, {
      gameData: baseData,
      battleParams: params,
      battleConfig: config,
      runManager: null,
      enemyUnits: [],
      addUnitGraphic: () => {},
    });
    for (const spawn of config.enemySpawns) scene.addEnemyFromSpawn(spawn);
    const holders = scene.enemyUnits.filter((u) => u.aiMode === 'hold');
    expect(holders).toHaveLength(5);
    // The wake check AIController.processEnemyPhase opens every enemy phase with; far from
    // the army, so only a miscounted pack could wake one.
    const players = config.playerSpawns.map((t) => ({ ...t, currentHP: 20 }));
    expect(wakeHolders({ enemyUnits: scene.enemyUnits, playerUnits: players, turn: 1 })).toEqual(
      [],
    );
    expect(holders.every((u) => u.aiMode === 'hold' && !u.holdWoke)).toBe(true);
  });

  it('the harness plays turn 1 and every holder stands its post', async () => {
    const { config, params, rm } = holdGate(at('broken'));
    installSeed(99);
    try {
      const battle = new HeadlessBattle(rm.gameData, params, rm.getRoster().slice(0, 4));
      battle.init({ battleConfig: config });
      const holders = battle.enemyUnits.filter((u) => u.aiMode === 'hold');
      expect(holders.map(tile).sort()).toEqual(['12,5', '12,7', '14,11', '14,12', '14,2']);
      const posts = holders.map(tile);
      await battle.endTurn();
      await battle._processEnemyPhase();
      expect(holders.filter((u) => u.holdWoke).map((u) => [tile(u), u.holdWoke])).toEqual([]);
      expect(holders.every((u) => u.aiMode === 'hold' && u.holdCheckedTurn === 1)).toBe(true);
      expect(holders.map(tile)).toEqual(posts);
    } finally {
      restoreMathRandom();
    }
  });
});
