// Acceptance, scenario 3 (the Lieutenant at the gate, Nightfall and Black Sun): the gate's battle,
// played in the harness on the map the game locks for it, is won by a real kill of the Lieutenant
// through every Revival Stone he carries (the defeat of `@boss`), his guards need not fall; the
// run then grants exactly one Vision charge, stays on the route (no RunComplete, no act advance,
// no finale reward) and the Entity's node opens past the Ruins. Ways this breaks:
//   - the gate ends the act or the run (RunComplete, the run-end currencies, an act advance)
//   - the gate pays its Vision twice (a second commit, a reload) or not at all, or the finale pays
//     one too
//   - the gate's objective waits for the escort, or ends on a bar a stone refills
//   - the Ruins and then the Entity are not the way on; the Entity is fought as anything but the
//     act's finale
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installSeed, restoreMathRandom } from '../../sim/lib/SeededRNG.js';
import { RunManager } from '../../src/engine/RunManager.js';
import { isGateBossNode } from '../../src/engine/Descent.js';
import {
  descentData,
  descentRun,
  endTurn,
  nodeOf,
  passNode,
  playNode,
  strike,
  strongArmy,
  survivorsOf,
  winNode,
} from './DescentAcceptanceKit.js';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));
const router = vi.hoisted(() => ({ targets: [] }));
vi.mock('../../src/utils/SceneRouter.js', async () => {
  const actual = await vi.importActual('../../src/utils/SceneRouter.js');
  return {
    ...actual,
    transitionToScene: vi.fn(async (_scene, target) => {
      router.targets.push(target);
      return true;
    }),
  };
});
const { BattleScene } = await import('../../src/scenes/BattleScene.js');

afterEach(() => {
  restoreMathRandom();
  router.targets.length = 0;
});

/** A run at the gate: the stair, the Column and the Vigil won, the Landing passed. */
function atTheGate(difficultyId, seed) {
  installSeed(seed);
  const rm = descentRun(difficultyId, { runSeed: seed });
  winNode(rm, 'stair');
  winNode(rm, 'column');
  winNode(rm, 'vigil', { riteWords: 3 });
  passNode(rm, 'landing');
  return rm;
}

/** Fight the gate: every unit that can strikes the Lieutenant each turn until he falls. */
async function fightTheGate(rm) {
  const node = nodeOf(rm, 'gate');
  const { driver, b, battleConfig } = playNode(rm, node, strongArmy(rm, 3));
  const lieutenant = b.enemyUnits.find((u) => u.isBoss);
  expect(lieutenant?.name).toBe('The Lieutenant');
  const stones = lieutenant.revivalStones || 0;
  let bars = 0;
  for (let turn = 0; turn < 8 && !b.result; turn++) {
    for (const unit of [...b.playerUnits]) {
      if (b.result || unit.hasActed || !b.enemyUnits.includes(lieutenant)) break;
      const before = lieutenant.revivalStones || 0;
      await strike(driver, unit, lieutenant);
      if ((lieutenant.revivalStones || 0) < before) bars++;
    }
    if (!b.result) await endTurn(driver);
  }
  return { node, b, battleConfig, lieutenant, stones, bars };
}

for (const [difficultyId, seed] of [
  ['hard', 31],
  ['lunatic', 32],
]) {
  describe(`${difficultyId}: the gate`, () => {
    it('a real kill through his stones wins it with guards standing; one Vision; back to the route', async () => {
      const rm = atTheGate(difficultyId, seed);
      const node = nodeOf(rm, 'gate');
      expect(isGateBossNode(rm, node)).toBe(true);
      const { b, lieutenant, stones, bars } = await fightTheGate(rm);
      expect(stones).toBeGreaterThan(0);
      expect(bars).toBe(stones); // every stone broke before the last bar fell
      expect(b.result).toBe('victory');
      expect(b.enemyUnits).not.toContain(lieutenant);
      expect(b.enemyUnits.length).toBeGreaterThan(0); // the defeat of @boss, not a rout

      const before = {
        vision: rm.visionChargesRemaining,
        act: rm.actIndex,
        mapIds: rm.nodeMap.nodes.map((n) => n.id),
        picks: structuredClone(rm.earnedBlessingPicks),
      };
      const commit = () =>
        rm.completeBattle(survivorsOf(b), node.id, b.goldEarned, {
          turnCount: b.turnManager.turnNumber,
          turnPar: b.turnPar ?? null,
        });
      expect(commit()).toBe(true);
      expect(rm.visionChargesRemaining).toBe(before.vision + 1);
      expect(rm.isActComplete()).toBe(false);
      expect(rm.isRunComplete()).toBe(false);
      expect(rm.status).not.toBe('victory');
      expect(rm.actIndex).toBe(before.act);
      expect(rm.nodeMap.nodes.map((n) => n.id)).toEqual(before.mapIds);
      expect(rm.earnedBlessingPicks).toEqual(before.picks);
      expect(rm.pendingBossRecruit ?? null).toBeNull();

      // Exactly once: a second commit and a reload's commit are refused.
      expect(commit()).toBe(false);
      const reloaded = RunManager.fromJSON(JSON.parse(JSON.stringify(rm.toJSON())), descentData());
      expect(reloaded.visionChargesRemaining).toBe(before.vision + 1);
      expect(
        reloaded.completeBattle(survivorsOf(b), node.id, 0, { turnCount: 3, turnPar: 12 }),
      ).toBe(false);
      expect(reloaded.visionChargesRemaining).toBe(before.vision + 1);

      // The scene's way out of the battle (after the loot): the route map, never RunComplete.
      const scene = new BattleScene();
      Object.assign(scene, {
        runManager: rm,
        gameData: rm.gameData,
        registry: { get: () => null },
        _battleSession: 1,
        _persistBattleRunState: vi.fn(),
        _showStoryDialogueOnce: vi.fn(async () => {}),
      });
      await BattleScene.prototype.transitionAfterBattle.call(scene);
      expect(router.targets).toEqual(['NodeMap']);
      expect(rm.status).not.toBe('victory');
      expect(rm.actIndex).toBe(before.act);

      // The way on: the Ruins, then the Entity's node, the act's finale.
      expect(rm.getAvailableNodes().map((n) => n.descentKey)).toEqual(['ruins']);
      passNode(rm, 'ruins');
      const entity = nodeOf(rm, 'entity');
      expect(rm.getAvailableNodes().map((n) => n.id)).toEqual([entity.id]);
      expect(entity.id).toBe(rm.nodeMap.bossNodeId);
      expect(rm.getBattleParams(entity)).toMatchObject({ bossRole: 'finale' });
      // The finale pays no Vision of its own (the gate's was the act's one).
      winNode(rm, 'entity');
      expect(rm.visionChargesRemaining).toBe(before.vision + 1);
      expect(rm.isRunComplete()).toBe(true);
    }, 120_000);
  });
}
