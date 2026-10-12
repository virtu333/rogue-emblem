// The Descent's gate boss (docs/specs/act-v-descent.md §6.2, §9.3): the Lieutenant on Nightfall
// and Black Sun is a boss fight that does not end the act. Each test is one row of §9.3's table
// or one way the gate could be mistaken for the act's end.
import { describe, it, expect } from 'vitest';
import { loadGameData } from './testData.js';
import { RunManager } from '../src/engine/RunManager.js';
import { addBurden, isSwornEnemy } from '../src/engine/Burdens.js';
import { actBossPickDue, isActBossVictory } from '../src/engine/EarnedBlessings.js';
import { prepareBossRecruit } from '../src/engine/PendingBossRecruit.js';
import { isGateBossNode, isGateBossParams } from '../src/engine/Descent.js';
import {
  applyGenerationFields,
  battleGenerationSeed,
  generateSeededBattle,
} from '../src/engine/BattleScout.js';

const baseData = loadGameData();
const descentData = () => ({
  ...baseData,
  descent: { ...structuredClone(baseData.descent), enabled: true },
});

function runIntoFinalAct(difficultyId = 'hard', runSeed = 9) {
  const rm = new RunManager(descentData());
  rm.startRun({ runSeed, difficultyId });
  rm.actIndex = rm.actSequence.indexOf('finalBoss') - 1;
  rm.advanceAct();
  return rm;
}

const nodeOf = (rm, key) => rm.nodeMap.nodes.find((n) => n.descentKey === key);
const vision = (rm) => rm.visionChargesRemaining;

/** Win a node's battle as the scene's victory commit does (turns under par). */
function win(rm, key, options = {}) {
  const node = nodeOf(rm, key);
  return rm.completeBattle(
    rm.roster.map((u) => structuredClone(u)),
    node.id,
    0,
    { turnCount: 4, turnPar: 12, ...options },
  );
}

/** Walk the Entity road up to the gate (the battles won, the event and the fork passed). */
function walkToGate(rm) {
  win(rm, 'stair');
  win(rm, 'column');
  win(rm, 'vigil');
  rm.markNodeComplete(nodeOf(rm, 'landing').id);
}

describe('the gate is not the act’s end', () => {
  it('names the gate and only the gate (isGateBossNode reads the role and bossNodeId)', () => {
    const rm = runIntoFinalAct();
    expect(isGateBossNode(rm, nodeOf(rm, 'gate'))).toBe(true);
    expect(isGateBossNode(rm, nodeOf(rm, 'entity'))).toBe(false);
    expect(isGateBossNode(rm, nodeOf(rm, 'vigil'))).toBe(false);
    // A node marked gate that IS the map's boss node is the act's end, not a gate.
    const forged = { ...nodeOf(rm, 'gate'), id: rm.nodeMap.bossNodeId };
    expect(isGateBossNode(rm, forged)).toBe(false);
    expect(isGateBossParams({ bossRole: 'gate' })).toBe(true);
    expect(isGateBossParams({ bossRole: 'finale' })).toBe(false);
    expect(isGateBossParams(null)).toBe(false);
  });

  it('isActComplete and isRunComplete stay false after the gate, true after the finale', () => {
    const rm = runIntoFinalAct();
    walkToGate(rm);
    expect(win(rm, 'gate')).toBe(true);
    expect(rm.isActComplete()).toBe(false);
    expect(rm.isRunComplete()).toBe(false);
    rm.markNodeComplete(nodeOf(rm, 'ruins').id);
    expect(rm.isActComplete()).toBe(false);
    expect(win(rm, 'entity')).toBe(true);
    expect(rm.isActComplete()).toBe(true);
    expect(rm.isRunComplete()).toBe(true);
  });

  it('after the gate the route map offers the Ruins, nothing else', () => {
    const rm = runIntoFinalAct();
    walkToGate(rm);
    win(rm, 'gate');
    expect(rm.getAvailableNodes().map((n) => n.descentKey)).toEqual(['ruins']);
  });

  it('is an act boss victory to nothing that keys on the act’s boss node', () => {
    const rm = runIntoFinalAct();
    expect(isActBossVictory(rm, nodeOf(rm, 'gate'))).toBe(false);
    expect(actBossPickDue(rm, nodeOf(rm, 'gate'))).toBe(false);
  });
});

describe('the gate’s Vision charge (§6.2)', () => {
  it('a gate victory grants +1, once', () => {
    const rm = runIntoFinalAct();
    walkToGate(rm);
    const before = vision(rm);
    expect(win(rm, 'gate')).toBe(true);
    expect(vision(rm)).toBe(before + 1);
    // completeBattle refuses a node already done: no second charge.
    expect(win(rm, 'gate')).toBe(false);
    expect(vision(rm)).toBe(before + 1);
  });

  it('no other Descent battle grants one: not the stair, the Vigil, nor the finale', () => {
    const rm = runIntoFinalAct();
    const start = vision(rm);
    walkToGate(rm);
    expect(vision(rm)).toBe(start);
    win(rm, 'gate');
    rm.markNodeComplete(nodeOf(rm, 'ruins').id);
    const afterGate = vision(rm);
    win(rm, 'entity');
    expect(vision(rm)).toBe(afterGate);
  });

  it('a battle reverted before its victory grants nothing; the victory then grants once', () => {
    const rm = runIntoFinalAct();
    walkToGate(rm);
    const gate = nodeOf(rm, 'gate');
    const entry = vision(rm);
    rm.beginBattleInProgress(gate.id, {
      isBoss: true,
      battleParams: rm.getBattleParams(gate),
    });
    // A rewind spent mid-battle, then Continue from Map: the entry's charges come back.
    rm.visionChargesRemaining = Math.max(0, entry - 1);
    rm.visionCount += 1;
    expect(rm.revertBattleInProgressToEntry()).toBe(true);
    expect(vision(rm)).toBe(entry);
    expect(gate.completed).toBe(false);
    win(rm, 'gate');
    expect(vision(rm)).toBe(entry + 1);
  });

  it('the charge is saved with the victory', () => {
    const rm = runIntoFinalAct();
    walkToGate(rm);
    win(rm, 'gate');
    const loaded = RunManager.fromJSON(JSON.parse(JSON.stringify(rm.toJSON())), descentData());
    expect(loaded.visionChargesRemaining).toBe(rm.visionChargesRemaining);
    expect(nodeOf(loaded, 'gate').completed).toBe(true);
  });
});

describe('what the gate does not give (§9.3)', () => {
  it('no Eclipse boss relief at the gate; the finale (the act’s boss node) keeps it', () => {
    const rm = runIntoFinalAct();
    expect(rm.isEclipseActive()).toBe(true);
    const relief = rm.getEclipseConfig().bossRelief;
    expect(relief).toBeGreaterThan(0);
    walkToGate(rm);
    rm.eclipse = { ...rm.eclipse, shadow: 40 };
    win(rm, 'gate');
    expect(rm.lastEclipseCommit.relief).toBe(0);
    rm.markNodeComplete(nodeOf(rm, 'ruins').id);
    win(rm, 'entity');
    expect(rm.lastEclipseCommit.relief).toBe(relief);
  });

  it('no earned-blessing pick at the gate or the finale', () => {
    const rm = runIntoFinalAct();
    const before = structuredClone(rm.earnedBlessingPicks);
    walkToGate(rm);
    win(rm, 'gate');
    expect(rm.earnedBlessingPicks).toEqual(before);
    rm.markNodeComplete(nodeOf(rm, 'ruins').id);
    win(rm, 'entity');
    expect(rm.earnedBlessingPicks).toEqual(before);
  });

  it('no boss recruit is drafted for the final act’s gate', () => {
    const rm = runIntoFinalAct();
    walkToGate(rm);
    win(rm, 'gate');
    expect(prepareBossRecruit(rm, descentData())).toBeNull();
    expect(rm.pendingBossRecruit ?? null).toBeNull();
  });

  it('the act does not advance: still the final act, the same map', () => {
    const rm = runIntoFinalAct();
    walkToGate(rm);
    const index = rm.actIndex;
    const mapIds = rm.nodeMap.nodes.map((n) => n.id);
    win(rm, 'gate');
    expect(rm.actIndex).toBe(index);
    expect(rm.currentAct).toBe('finalBoss');
    expect(rm.nodeMap.nodes.map((n) => n.id)).toEqual(mapIds);
  });
});

describe('the gate is a boss battle to the battle’s readers (§9.3)', () => {
  it('a Sworn Enemy marks the gate’s boss and ends at its victory', () => {
    const rm = runIntoFinalAct();
    expect(addBurden(rm, 'sworn_enemy').ok).toBe(true);
    walkToGate(rm);
    expect(isSwornEnemy(rm)).toBe(true);
    expect(rm.getBattleParams(nodeOf(rm, 'gate')).swornEnemy).toBeTruthy();
    win(rm, 'gate');
    expect(isSwornEnemy(rm)).toBe(false);
  });

  it('a Hunted wave never lands on the gate (a boss battle), but does on a Descent battle', () => {
    const rm = runIntoFinalAct();
    expect(addBurden(rm, 'hunted').ok).toBe(true);
    expect(rm.getBattleParams(nodeOf(rm, 'gate')).huntedWave).toBeUndefined();
    expect(rm.getBattleParams(nodeOf(rm, 'stair')).huntedWave).toBeTruthy();
  });

  it('launches as a boss (the scene and the scout read `type: boss`), named and in its role', () => {
    const rm = runIntoFinalAct();
    const gate = nodeOf(rm, 'gate');
    expect(gate.type).toBe('boss');
    const params = applyGenerationFields(rm.getBattleParams(gate), {
      deployCount: 8,
      isBoss: gate.type === 'boss',
    });
    expect(params).toMatchObject({ isBoss: true, bossName: 'The Lieutenant', bossRole: 'gate' });
  });
});

describe('the gate’s Revival Stones', () => {
  // The rung's `lieutenant` entry reaches the Lieutenant and nobody else on this road: the
  // Entity is never stoned, and the Vigil's captain is no boss, so no lieutenant stone sits there.
  for (const difficultyId of ['hard', 'lunatic']) {
    it(`${difficultyId}: the gate’s Lieutenant carries 2; the Entity and the Vigil carry none`, () => {
      expect(baseData.difficulty.modes[difficultyId].revivalStones.lieutenant).toBe(2);
      const rm = runIntoFinalAct(difficultyId, 9);
      const built = (key) => {
        const node = nodeOf(rm, key);
        const params = applyGenerationFields(rm.getBattleParams(node), {
          deployCount: 8,
          isBoss: node.type === 'boss',
        });
        const seed = battleGenerationSeed(params, { runSeed: rm.runSeed, nodeId: node.id });
        return generateSeededBattle(params, rm.gameData, seed);
      };
      const gate = built('gate');
      const lieutenant = gate.enemySpawns.find((s) => s.isBoss);
      expect(lieutenant.name).toBe('The Lieutenant');
      expect(lieutenant.revivalStones).toBe(2);
      expect(gate.enemySpawns.filter((s) => s.revivalStones > 0)).toHaveLength(1);

      const entity = built('entity').enemySpawns.find((s) => s.isEntity);
      expect(entity).toBeDefined();
      expect('revivalStones' in entity).toBe(false);

      expect(built('vigil').enemySpawns.filter((s) => s.revivalStones > 0)).toEqual([]);
    });
  }
});
