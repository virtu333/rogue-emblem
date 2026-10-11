// The sims play the map the player would meet (docs/specs/act-v-descent.md §12, PR 12: "the sim
// driver's applyGenerationFields parity"). BattleScene.beginBattle makes a node's map with three
// calls (applyGenerationFields, battleGenerationSeed, generateSeededBattle) and locks it; the
// full-run drivers must make it the same way, never let the harness generate one from the sim's
// own Math.random.
//
// Each test names the realistic failure it catches.
import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import { loadGameData } from '../testData.js';
import { RunManager } from '../../src/engine/RunManager.js';
import {
  applyGenerationFields,
  battleGenerationSeed,
  generateSeededBattle,
} from '../../src/engine/BattleScout.js';
import { createSeededRng } from '../../src/engine/BlessingEngine.js';
import { RunSimulationDriver, battleConfigForNode } from './RunSimulationDriver.js';
import { ClaimingRunDriver } from './ClaimingRunDriver.js';
import { installStatefulSeed, restoreStatefulRandom } from '../../sim/lib/StatefulRNG.js';
import { HeadlessBattle } from '../harness/HeadlessBattle.js';

const baseData = loadGameData();
const descentData = () => ({
  ...baseData,
  descent: { ...structuredClone(baseData.descent), enabled: true },
});
const realRandom = Math.random;
afterEach(() => {
  Math.random = realRandom;
  restoreStatefulRandom();
  vi.restoreAllMocks();
});

/** A run standing at the Descent's entry (the route switched on for the test). */
function descentRun(difficultyId, seed = 7) {
  const rm = new RunManager(descentData());
  rm.startRun({ runSeed: seed, difficultyId, applyBlessingsAtStart: false });
  rm.actIndex = rm.actSequence.indexOf('finalBoss') - 1;
  rm.advanceAct();
  return rm;
}

/** The scene's map for a node, step for step as BattleScene.beginBattle makes it. */
function sceneMap(rm, node, deployCount) {
  const params = rm.getBattleParams(node);
  applyGenerationFields(params, { deployCount, isBoss: node.type === 'boss' });
  const seed = battleGenerationSeed(params, { runSeed: rm.runSeed, nodeId: node.id });
  return generateSeededBattle(params, rm.gameData, seed);
}

const descentBattles = (rm) =>
  rm.nodeMap.nodes.filter((n) => ['battle', 'boss'].includes(n.type) && n.battleParams);

describe('the sims fight the map the game would generate', () => {
  it('every Descent battle (set pieces, the Vigil, the gate, both finales) is the scene’s map', () => {
    // Failure: the driver lets the harness generate the map (its own stream, no isBoss), so the
    // sim plays another Glass, another Vigil, another Entity map than the player for that run.
    for (const difficultyId of ['normal', 'hard']) {
      const rm = descentRun(difficultyId);
      for (const node of descentBattles(rm)) {
        const params = rm.getBattleParams(node);
        const config = battleConfigForNode(rm, node, params, {
          deployCount: 6,
          gameData: rm.gameData,
        });
        expect(config, node.id).toEqual(sceneMap(rm, node, 6));
        expect(params.isBoss, node.id).toBe(node.type === 'boss');
        expect(params.deployCount).toBe(6);
      }
    }
  });

  it('locks the map to the node, and a locked node plays its lock', () => {
    // Failure: the sim never locks (the Eclipse could still take an entered node; the Rite's
    // commit reads the locked config's vigil), or regenerates over a lock.
    const rm = descentRun('hard');
    const vigil = rm.nodeMap.nodes.find((n) => n.descentKey === 'vigil');
    const first = battleConfigForNode(rm, vigil, rm.getBattleParams(vigil), {
      deployCount: 5,
      gameData: rm.gameData,
    });
    expect(rm.getLockedBattleConfig(vigil.id)).toEqual(first);
    expect(first.vigil?.sigils?.length).toBe(4);
    const again = battleConfigForNode(rm, vigil, rm.getBattleParams(vigil), {
      deployCount: 8,
      gameData: rm.gameData,
    });
    expect(again).toEqual(first);
  });

  it('generating a map never moves the sim’s own stream', () => {
    // Failure: map generation draws from the sim's Math.random, so every later roll of the
    // run (and the comparison between two arms of a sim) depends on the maps drawn before it.
    const rm = descentRun('normal');
    const stair = rm.nodeMap.nodes.find((n) => n.descentKey === 'stair');
    Math.random = createSeededRng(99);
    battleConfigForNode(rm, stair, rm.getBattleParams(stair), {
      deployCount: 6,
      gameData: rm.gameData,
    });
    const after = Math.random();
    expect(after).toBe(createSeededRng(99)());
  });

  it('an act boss is generated as a boss map (par, Hunted), in a standard run too', () => {
    // Failure: the driver drops `isBoss`, so a boss map takes a non-boss par offset or a Hunted
    // wave (MapGenerator reads params.isBoss) and the Eclipse's shadow drifts from the game's.
    const rm = new RunManager(baseData);
    rm.startRun({ runSeed: 21, difficultyId: 'hard', applyBlessingsAtStart: false });
    const boss = rm.nodeMap.nodes.find((n) => n.id === rm.nodeMap.bossNodeId);
    const params = rm.getBattleParams(boss);
    battleConfigForNode(rm, boss, params, { deployCount: 4, gameData: rm.gameData });
    expect(params.isBoss).toBe(true);
    expect(rm.getLockedBattleConfig(boss.id)).toEqual(sceneMap(rm, boss, 4));
  });

  it('a full-run driver plays the node’s map: the stock driver and the claiming driver', async () => {
    // Failure: a driver builds its battle from params alone (the harness's generateBattle), or
    // sizes the map by another deploy count than the units it deploys.
    for (const Driver of [RunSimulationDriver, ClaimingRunDriver]) {
      const handle = installStatefulSeed(5);
      const driver = new Driver(descentData(), {
        runOptions: { runSeed: 5, difficultyId: 'normal', autoSelectBlessing: false },
        invincibility: true,
        maxBattleActions: 1500,
        ...(Driver === ClaimingRunDriver ? { rng: handle, claims: { startOffer: 'none' } } : {}),
      });
      driver.init();
      const rm = driver.runManager;
      rm.actIndex = rm.actSequence.indexOf('finalBoss') - 1;
      rm.advanceAct();
      const stair = rm.getAvailableNodes().find((n) => n.descentKey === 'stair');
      const deployCount = Math.min(rm.roster.length, 8);
      const expected = sceneMap(rm, stair, deployCount);
      // What the harness was handed to play (every replay of the claiming driver's battle too).
      const played = [];
      const setup = HeadlessBattle.prototype._setupBattle;
      vi.spyOn(HeadlessBattle.prototype, '_setupBattle').mockImplementation(function (bc) {
        played.push(structuredClone(bc));
        return setup.call(this, bc);
      });
      await driver._runBattleNode(stair);
      vi.restoreAllMocks();
      expect(played.length, Driver.name).toBeGreaterThan(0);
      for (const bc of played) expect(bc, Driver.name).toEqual(expected);
      expect(rm.battleConfigsByNodeId[stair.id], Driver.name).toEqual(expected);
      restoreStatefulRandom();
    }
  }, 60_000);

  it('no full-run driver builds a battle without the node’s map (a static boundary)', () => {
    // Failure: a new driver (or a refactor) goes back to `driver.init()` with params only.
    for (const file of ['tests/sim/RunSimulationDriver.js', 'tests/sim/ClaimingRunDriver.js']) {
      const src = fs.readFileSync(file, 'utf8');
      expect(src, file).toMatch(/battleConfigForNode\(/);
      expect(src, file).not.toMatch(/driver\.init\(\);/);
      expect(src, file).not.toMatch(/generateBattle\(/);
    }
  });
});
