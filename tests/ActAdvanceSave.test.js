// The act boss falls, the run advances to the next act, and only then do the act
// card and story play (they wait on the player). A reload in that window must
// resume on the NEXT act's map, not on the finished one.
import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ default: { Scene: class {} } }));
vi.mock('../src/utils/SceneRouter.js', async (importOriginal) => ({
  ...(await importOriginal()),
  transitionToScene: vi.fn(async () => true),
}));
import { PostCombatController } from '../src/ui/PostCombatController.js';
import { RunManager } from '../src/engine/RunManager.js';
import { earnedPickOwed, skipEarnedBlessing } from '../src/engine/EarnedBlessings.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();

function winAct(rm) {
  for (let guard = 0; guard < 60 && !rm.isActComplete(); guard++) {
    const node = rm.getAvailableNodes()[0];
    if (['battle', 'boss', 'recruit'].includes(node.type))
      rm.completeBattle(rm.getRoster(), node.id, 0, { turnCount: 5, turnPar: 7 });
    else rm.markNodeComplete(node.id);
  }
  // The boss's earned-blessing pick is made (left) before the act advances, as the pick
  // screen would (tests/EarnedBlessingPickFlow.test.js covers the pick itself).
  const owed = earnedPickOwed(rm);
  if (owed) skipEarnedBlessing(rm, owed.actId);
}

describe('act boss victory: the act advance is saved before the act card and story play', () => {
  it('a save taken while the act transition story is still on screen already holds the next act', async () => {
    const rm = new RunManager(gameData);
    rm.startRun({ runSeed: 42, difficultyId: 'normal' });
    winAct(rm);
    rm.advanceAct();
    winAct(rm); // Act 2's boss is won and its rewards are claimed
    expect(rm.currentAct).toBe('act2');
    expect(rm.isActComplete()).toBe(true);

    const saves = [];
    const scene = {
      _battleSession: 1,
      runManager: rm,
      gameData,
      isElite: false,
      battleState: 'BATTLE_END',
      nodeId: rm.nodeMap.bossNodeId,
      registry: { get: () => null },
      reportLootError: vi.fn(),
      forceTransitionAfterBattle: vi.fn(),
      _persistBattleRunState: () => {
        saves.push(JSON.parse(JSON.stringify(rm.toJSON())));
        return { ok: true };
      },
      // The app is closed while the story is on screen: it never resolves.
      _showStoryDialogueOnce: () => new Promise(() => {}),
    };
    void new PostCombatController(scene).transitionAfterBattle();
    await vi.waitFor(() => expect(saves.length).toBeGreaterThan(0));

    const resumed = RunManager.fromJSON(saves.at(-1), gameData);
    expect(resumed.currentAct).toBe('act3');
    expect(resumed.isActComplete()).toBe(false);
    expect(resumed.currentNodeId).toBeNull();
    expect(resumed.battleInProgress).toBeNull(); // a map save, not a battle checkpoint
    expect(resumed.pendingBattleReward).toBeFalsy();
  });
});
