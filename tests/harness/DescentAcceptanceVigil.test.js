// Acceptance, scenario 1 (the Vigil's objective and its commit): on the shipped Vigil (data's
// `the_vigil`, generated and locked for a real Descent run's node, not the review fixture), the
// army Unweaves the circles that ward the Voices, the last Voice falling to a real attack wins the
// battle while its guards and the circles' Hollowed still stand; the Rite takes the battle's words
// and the rewards are paid exactly once. Ways this breaks:
//   - a Voice is hurt through its ward, or stays warded once its circle is broken, or the Waking
//     falls while another Voice still lives (the choir)
//   - the defeat objective waits for the guards, the Warden (an elite captain, a boss) or the
//     Hollowed, or ends before the last Voice falls
//   - the run's victory commit takes the words twice (a second commit, a reload and a second
//     commit), takes another count than the battle spoke, or pays the battle's gold twice
//   - the scene's victory flow, reached twice (a kill and the post-combat check both end the
//     battle), commits twice
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installSeed, restoreMathRandom } from '../../sim/lib/SeededRNG.js';
import { RunManager } from '../../src/engine/RunManager.js';
import { objectivesOf } from '../../src/engine/BattleObjectives.js';
import {
  descentData,
  descentRun,
  endTurn,
  unweaveOn,
  nodeOf,
  playNode,
  strike,
  strongArmy,
  survivorsOf,
  winNode,
} from './DescentAcceptanceKit.js';

const VOICES = ['voice_calling', 'voice_binding', 'voice_feeding', 'voice_waking'];
const voiceOf = (b, id) => b.enemyUnits.find((u) => u.authoredId === id);
const called = (b) => b.enemyUnits.filter((u) => typeof u._summonedBy === 'string');

afterEach(() => restoreMathRandom());

/** A Nightfall run at the Vigil (the stair and the Column won), the Rite at `words`. */
function atTheVigil({ words = 6, seed = 21 } = {}) {
  installSeed(seed);
  const rm = descentRun('hard', { runSeed: seed, words });
  winNode(rm, 'stair');
  winNode(rm, 'column', { turnCount: 30, turnPar: 12 }); // over par: the Column lowers nothing
  return rm;
}

describe('the last Voice falls: the Vigil is won with its guards standing', () => {
  it('the shipped Vigil: circles broken, real enemy phases of words and summons, four real kills', async () => {
    const rm = atTheVigil();
    const node = nodeOf(rm, 'vigil');
    const army = strongArmy(rm, 2);
    const { driver, b, battleConfig } = playNode(rm, node, army);

    // The shipped set piece, its defeat model naming the four Voices, its guards on the field.
    expect(battleConfig.templateId).toBe('setpiece:the_vigil');
    expect(objectivesOf(battleConfig).primary[0]).toMatchObject({ kind: 'defeat' });
    for (const id of VOICES) expect(voiceOf(b, id), id).toBeTruthy();
    const warden = b.enemyUnits.find((u) => u.name === 'Warden of the Rite');
    expect(warden?.isBoss).toBe(true);
    const guards = b.enemyUnits.filter((u) => !VOICES.includes(u.authoredId));
    expect(guards.length).toBeGreaterThanOrEqual(5);

    // Every Voice starts warded; a blow on one does nothing.
    const attackers = [...b.playerUnits];
    expect(attackers.length).toBeGreaterThanOrEqual(5);
    for (const id of VOICES) expect(voiceOf(b, id).warded, id).toBe(true);
    const calling = voiceOf(b, 'voice_calling');
    const hp = calling.currentHP;
    await strike(driver, attackers[4], calling);
    expect(calling.currentHP).toBe(hp);

    // Turn 1: three of the army Unweave the circles of the Calling, the Binding and the Feeding;
    // each breaks at once. The Waking's circle stays open.
    const circle = (id) => battleConfig.vigil.circles.find((c) => c.id === id);
    for (const [i, id] of ['circle_calling', 'circle_binding', 'circle_feeding'].entries()) {
      await unweaveOn(driver, attackers[i], circle(id));
      expect(b._vigilState.broken, id).toHaveProperty(id);
      expect(attackers[i].hasActed).toBe(true);
    }
    expect(Object.keys(b._vigilState.broken).sort()).toEqual([
      'circle_binding',
      'circle_calling',
      'circle_feeding',
    ]);
    for (const id of VOICES.slice(0, 3)) expect(voiceOf(b, id).warded, id).toBeUndefined();

    // One enemy phase: the Voices speak, the open circle calls.
    await endTurn(driver);
    expect(b.result).toBeNull();
    const spoken = b._vigilState.words;
    expect(spoken).toBeGreaterThan(0);
    expect(called(b).length).toBeGreaterThan(0);
    // (A Voice may already have fallen to a counter in that phase: no ward holds it now.)
    for (const id of VOICES.slice(0, 3)) expect(voiceOf(b, id)?.warded, id).toBeUndefined();
    // The Waking: its own circle and the choir.
    expect(voiceOf(b, 'voice_waking')).toMatchObject({ warded: true, wardReason: 'both' });

    // Player turn 2: three Voices fall to real attacks; the battle goes on. One more of the army
    // Unweaves the Waking's circle.
    for (const [i, id] of VOICES.slice(0, 3).entries()) {
      const voice = voiceOf(b, id);
      for (let tries = 0; voiceOf(b, id) && tries < 3; tries++) {
        if (attackers[i].hasActed) break;
        await strike(driver, attackers[i], voice);
      }
      expect(voiceOf(b, id), `${id} fell`).toBeUndefined();
      expect(b.result).toBeNull();
    }
    // The choir is silent; the Waking's circle still wards it.
    expect(voiceOf(b, 'voice_waking')).toMatchObject({ warded: true, wardReason: 'circle' });
    await unweaveOn(driver, attackers[3], circle('circle_waking'));
    expect(b._vigilState.broken).toHaveProperty('circle_waking');
    expect(voiceOf(b, 'voice_waking').warded).toBeUndefined();
    await endTurn(driver);
    expect(b.result).toBeNull();
    const wordsBeforeKill = b._vigilState.words;
    expect(wordsBeforeKill).toBeGreaterThan(spoken);

    // The last Voice falls: victory, with guards (the Warden among them) and Hollowed standing.
    await strike(driver, attackers[3], voiceOf(b, 'voice_waking'));
    expect(voiceOf(b, 'voice_waking')).toBeUndefined();
    expect(b.result).toBe('victory');
    expect(b.enemyUnits.filter((u) => !VOICES.includes(u.authoredId)).length).toBeGreaterThan(0);
    expect(b.enemyUnits).toContain(warden);
    // The Hollowed the open circle called (a strong army's counters may have cut them down).
    expect(b._vigilState.summoned).toBeGreaterThan(0);
    // Nothing more speaks after the win: the words are the ones the enemy phases spoke.
    expect(b._vigilState.words).toBe(wordsBeforeKill);

    // The run's commit, as PostCombatController hands it over (riteWords from the battle).
    const before = {
      words: rm.rite.words,
      gold: rm.gold,
      vision: rm.visionChargesRemaining,
      battles: rm.completedBattles,
    };
    const commit = () =>
      rm.completeBattle(survivorsOf(b), node.id, b.goldEarned, {
        turnCount: b.turnManager.turnNumber,
        turnPar: b.turnPar ?? null,
        riteWords: b._vigilState.words,
      });
    expect(commit()).toBe(true);
    expect(rm.rite.words).toBe(before.words + wordsBeforeKill);
    expect(rm.rite.log.filter((e) => e.source === 'vigil')).toEqual([
      expect.objectContaining({ source: 'vigil', delta: wordsBeforeKill, nodeId: node.id }),
    ]);
    expect(nodeOf(rm, 'vigil').completed).toBe(true);
    expect(rm.completedBattles).toBe(before.battles + 1);
    const paid = rm.gold - before.gold;
    expect(paid).toBeGreaterThanOrEqual(b.goldEarned);
    // The Vigil is no gate: no Vision charge.
    expect(rm.visionChargesRemaining).toBe(before.vision);

    // A second commit, and a reload's second commit: refused, nothing paid twice.
    const after = JSON.stringify(rm.toJSON());
    expect(commit()).toBe(false);
    expect(JSON.stringify(rm.toJSON())).toBe(after);
    const reloaded = RunManager.fromJSON(JSON.parse(after), descentData());
    expect(
      reloaded.completeBattle(survivorsOf(b), node.id, b.goldEarned, {
        turnCount: 3,
        turnPar: 12,
        riteWords: 99,
      }),
    ).toBe(false);
    expect(reloaded.rite.words).toBe(before.words + wordsBeforeKill);
    expect(reloaded.gold).toBe(rm.gold);
  }, 60_000);
});

// The scene's half: PostCombatController.onVictory on a won Vigil commits once, with the
// scene's own words, even when the battle's end is reached twice.
vi.mock('phaser', () => ({ default: { Scene: class {} } }));
vi.mock('../../src/utils/SceneRouter.js', async () => {
  const actual = await vi.importActual('../../src/utils/SceneRouter.js');
  return {
    ...actual,
    transitionToScene: vi.fn(async () => true),
    transitionToSceneWithBlockedRetry: vi.fn(async () => ({ status: 'started' })),
  };
});
const { BattleScene } = await import('../../src/scenes/BattleScene.js');

function wonVigilScene(rm, node, words) {
  const scene = new BattleScene();
  const pending = [];
  Object.assign(scene, {
    battleState: 'PLAYER_IDLE',
    battleParams: rm.getBattleParams(node),
    battleConfig: { objective: 'rout', vigil: {} },
    scene: { isActive: () => true },
    cameras: { main: { centerX: 320, centerY: 240 } },
    add: {
      text: vi.fn(() => ({
        setOrigin() {
          return this;
        },
        setDepth() {
          return this;
        },
        destroy: vi.fn(),
      })),
    },
    time: { delayedCall: vi.fn((_ms, cb) => pending.push(cb())) },
    registry: { get: (key) => (key === 'audio' ? { playMusic: vi.fn() } : null) },
    _pinToScreen: vi.fn(),
    playerUnits: rm.roster.map((u) => structuredClone(u)),
    nonDeployedUnits: [],
    escapedUnits: [],
    getTurnPressureState: () => ({ goldMultiplier: 1, xpMultiplier: 1 }),
    goldEarned: 40,
    nodeId: node.id,
    gameData: rm.gameData,
    isBoss: false,
    runManager: rm,
    turnManager: { turnNumber: 5 },
    turnPar: 12,
    _vigilState: { words, byVoice: {}, byCircle: {}, summoned: 3, lastProcessedTurn: 4 },
    transitionAfterBattle: vi.fn(async () => true),
    showLootScreen: vi.fn(),
    showBossRecruitScreen: vi.fn(),
  });
  return { scene, pending };
}

describe('the scene’s victory flow commits a Vigil once', () => {
  it('onVictory twice (and the battle-end check after it): one commit, the scene’s words', async () => {
    const rm = atTheVigil({ words: 4 });
    const node = nodeOf(rm, 'vigil');
    const spy = vi.spyOn(rm, 'completeBattle');
    const { scene, pending } = wonVigilScene(rm, node, 7);
    BattleScene.prototype.onVictory.call(scene);
    BattleScene.prototype.onVictory.call(scene);
    expect(BattleScene.prototype.checkBattleEnd.call(scene)).toBe(true);
    await Promise.all(pending);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][3]).toMatchObject({ riteWords: 7 });
    expect(rm.rite.words).toBe(4 + 7);
    expect(nodeOf(rm, 'vigil').completed).toBe(true);
  });
});
