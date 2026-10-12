// The act boss falls, the run advances to the next act, and only then do the act
// card and story play (they wait on the player). A reload in that window must
// resume on the NEXT act's map, not on the finished one.
import { readFileSync } from 'node:fs';
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
// The old two-node final act: the same data with the Descent switched off (the shipped file
// has it on), so a test of the road before the Descent never rests on the shipped flag.
const descentOffData = {
  ...gameData,
  descent: { ...structuredClone(gameData.descent), enabled: false },
};
const dialogue = JSON.parse(
  readFileSync(new URL('../data/dialogue.json', import.meta.url), 'utf8'),
);

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

describe('the Act IV to Act V transition follows where the road ends', () => {
  // Failure: the Emperor's fall plays the Entity's "the ground is waking" descent on a road that
  // ends at the Lieutenant (Dusk), or a Nightfall / Black Sun run loses the descent it has always
  // had, because the key is chosen without the run's finale.
  async function transitionAfterEmperor(difficultyId, commander = 'Edric', data = gameData) {
    const rm = new RunManager(data);
    rm.startRun({ runSeed: 42, difficultyId });
    rm.getStartingLordNames = () => [commander, commander === 'Sera' ? 'Edric' : 'Sera'];
    while (rm.currentAct !== 'act4') {
      winAct(rm);
      rm.advanceAct();
    }
    winAct(rm);
    expect(rm.isActComplete()).toBe(true);
    expect(rm.isRunComplete()).toBe(false);
    const shown = [];
    const scene = {
      _battleSession: 1,
      runManager: rm,
      gameData: { ...data, dialogue },
      isElite: false,
      battleState: 'BATTLE_END',
      nodeId: rm.nodeMap.bossNodeId,
      registry: { get: () => null },
      reportLootError: vi.fn(),
      forceTransitionAfterBattle: vi.fn(),
      _persistBattleRunState: () => ({ ok: true }),
      _showStoryDialogueOnce: vi.fn(async (key, entries) => {
        shown.push({ key, lines: (entries || []).map((e) => e.line) });
      }),
    };
    await new PostCombatController(scene).transitionAfterBattle();
    expect(rm.currentAct).toBe('finalBoss');
    // Which final act was built: the Descent's route (its marker) or the old two-node act.
    shown.finalActRoute = rm.nodeMap.descent?.routeId ?? null;
    return shown;
  }

  it('Dusk goes down to the Lieutenant: the Act IV close, then the descent to him alone', async () => {
    const shown = await transitionAfterEmperor('dusk');
    expect(shown.map((s) => s.key)).toEqual(['act4_to_finalBoss_lieutenant']);
    const text = shown[0].lines.join('\n');
    expect(text).toMatch(/emperor is defeated/);
    expect(text).toMatch(/lieutenant went down/);
    // Not the Entity's descent: no waking ground, and its arrival scene does not follow.
    expect(text).not.toMatch(/ground is shaking|Time doesn't pass/);
  });

  it("Dusk plays its commander's own line last, whoever leads", async () => {
    const shown = await transitionAfterEmperor('dusk', 'Cael');
    const cael = dialogue.actTransitions.act4_to_finalBoss_lieutenant.variants.find(
      (v) => v.when.commander === 'Cael',
    );
    expect(shown[0].lines.at(-1)).toBe(cael.entries.at(-1).line);
  });

  it.each(['hard', 'lunatic'])(
    "%s keeps the Entity's descent exactly: the ground wakes, then the arrival",
    async (difficultyId) => {
      const shown = await transitionAfterEmperor(difficultyId, 'Edric', descentOffData);
      expect(shown.finalActRoute).toBe(null);
      expect(shown.map((s) => s.key)).toEqual(['finalBoss_to_secretAct']);
      const act = dialogue.actTransitions;
      // The Descent is off here: Edric's lines from before it (its variants name `descent`).
      const lines = (section) =>
        section.variants.find((v) => v.when.commander === 'Edric' && !v.when.descent).entries;
      expect(shown[0].lines).toEqual(
        [...lines(act.finalBoss_to_secretAct), ...lines(act.secretAct_start)].map((e) => e.line),
      );
    },
  );

  it.each(['hard', 'lunatic'])(
    '%s with the Descent on (as shipped): the ground wakes, then Sera on the stair',
    async (difficultyId) => {
      const shown = await transitionAfterEmperor(difficultyId);
      expect(shown.finalActRoute).toBe('entity');
      expect(shown.map((s) => s.key)).toEqual(['finalBoss_to_secretAct']);
      const act = dialogue.actTransitions;
      const lines = (section) =>
        section.variants.find((v) => v.when.commander === 'Edric' && v.when.descent === true)
          .entries;
      expect(shown[0].lines).toEqual(
        [...lines(act.finalBoss_to_secretAct), ...lines(act.secretAct_start)].map((e) => e.line),
      );
    },
  );
});
