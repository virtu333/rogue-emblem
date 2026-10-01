import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/utils/errorReporter.js', () => ({ reportAsyncError: vi.fn() }));

import { reportAsyncError } from '../src/utils/errorReporter.js';
import { BattleBeatsController } from '../src/ui/BattleBeatsController.js';

function fixture() {
  const shown = new Set();
  const boss = { name: 'Boss', isBoss: true, currentHP: 4, stats: { HP: 20 } };
  const lord = { name: 'Edric', isLord: true, faction: 'player', currentHP: 15, col: 1, row: 1 };
  const scene = {
    isBoss: true,
    _bossName: 'Boss',
    _resolveBossDialogueName: (name) => name,
    battleState: 'COMBAT_RESOLVING',
    turnManager: { currentPhase: 'player', turnNumber: 3 },
    enemyUnits: [boss],
    playerUnits: [lord],
    runManager: {
      gold: 731,
      hasShownDialogue: (key) => shown.has(key),
      markDialogueShown: vi.fn((key) => shown.add(key)),
      pickNarrativeLine: vi.fn((pool) => pool[0]),
    },
    gameData: {
      dialogue: {
        bossEncounters: {
          Boss: {
            halfHealth: [
              { speaker: 'Boss', line: 'Hold the line.' },
              { speaker: 'Boss', line: 'Again!' },
            ],
          },
        },
        lordQuips: { onCrit: { Edric: ['Stay down!'] } },
      },
    },
    dialogueOverlay: { show: vi.fn(async () => {}) },
    time: { now: 10000 },
    grid: { gridToPixel: () => ({ x: 100, y: 100 }) },
    add: {
      text: vi.fn(() => {
        const text = { scene, destroy: vi.fn() };
        for (const method of ['setOrigin', 'setDepth', 'setAlpha']) text[method] = () => text;
        return text;
      }),
    },
    tweens: { add: vi.fn() },
  };
  return { scene, boss, lord, shown, beats: new BattleBeatsController(scene, () => 0) };
}

function expectReport(error, label) {
  expect(reportAsyncError).toHaveBeenCalledExactlyOnceWith('battle_presentation_failed', error, {
    label,
    battleState: 'COMBAT_RESOLVING',
    phase: 'player',
    turn: 3,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('real battle story presentation reports', () => {
  it('normal dialogue and quips report no errors and retain one-time narrative selection', async () => {
    const { scene, shown, lord, beats } = fixture();
    await beats.checkBossHalfHealth();
    await beats.checkBossHalfHealth();
    beats.onCritStrike(lord);
    beats.onCritStrike(lord);
    expect(reportAsyncError).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
    expect(shown).toEqual(new Set(['boss_half_Boss']));
    expect(scene.runManager.markDialogueShown).toHaveBeenCalledTimes(1);
    expect(scene.dialogueOverlay.show).toHaveBeenCalledTimes(2);
    expect(scene.runManager.pickNarrativeLine).toHaveBeenCalledExactlyOnceWith(
      ['Stay down!'],
      'quip:onCrit:Edric',
    );
    expect(scene.add.text).toHaveBeenCalledTimes(1);
  });

  it.each(['throw', 'reject'])(
    'reports a dialogue %s, continues entries and never replays the marked beat',
    async (failure) => {
      const { scene, boss, lord, shown, beats } = fixture();
      const error = new Error('destroyed boss dialogue');
      scene.dialogueOverlay.show.mockImplementationOnce(() => {
        expect(shown.has('boss_half_Boss')).toBe(true);
        if (failure === 'throw') throw error;
        return Promise.reject(error);
      });
      await expect(beats.checkBossHalfHealth()).resolves.toBeUndefined();
      await beats.checkBossHalfHealth();
      expectReport(error, 'boss half health dialogue');
      expect(scene.dialogueOverlay.show).toHaveBeenCalledTimes(2);
      expect(scene.runManager.markDialogueShown).toHaveBeenCalledTimes(1);
      expect([boss.currentHP, lord.currentHP, scene.runManager.gold]).toEqual([4, 15, 731]);
      expect(scene.battleState).toBe('COMBAT_RESOLVING');
    },
  );

  it.each(['text', 'tween'])(
    'reports failed quip %s while preserving selection and cooldown',
    (failure) => {
      const { scene, boss, lord, beats } = fixture();
      const error = new Error(`destroyed quip ${failure}`);
      (failure === 'text' ? scene.add.text : scene.tweens.add).mockImplementationOnce(() => {
        throw error;
      });
      expect(() => beats.onCritStrike(lord)).not.toThrow();
      beats.onCritStrike(lord);
      expectReport(error, 'battle quip');
      expect(scene.runManager.pickNarrativeLine).toHaveBeenCalledExactlyOnceWith(
        ['Stay down!'],
        'quip:onCrit:Edric',
      );
      expect(scene.add.text).toHaveBeenCalledTimes(1);
      expect(beats._lastQuipAt).toBe(10000);
      expect([boss.currentHP, lord.currentHP, scene.runManager.gold]).toEqual([4, 15, 731]);
      expect(scene.battleState).toBe('COMBAT_RESOLVING');
    },
  );
});
