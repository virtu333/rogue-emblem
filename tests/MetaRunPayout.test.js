// The run-end payout is back-loaded: restarting after the opening map earns nothing, an
// Act I clear little, and finishing a run far more per battle than either (constants.js
// META_*; RunManager.metaBattlePoints banks each won battle by its act).
import { describe, it, expect } from 'vitest';
import { RunManager } from '../src/engine/RunManager.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();
const BATTLE_TYPES = new Set(['battle', 'boss', 'recruit']);

function newRun(difficultyId, runSeed = 11) {
  const rm = new RunManager(gameData);
  rm.startRun({ difficultyId, runSeed });
  return rm;
}

/** Win one node: a battle through completeBattle, anything else is just walked past. */
function winNode(rm, node) {
  if (BATTLE_TYPES.has(node.type)) {
    expect(rm.completeBattle(rm.getRoster(), node.id, 0)).not.toBe(false);
  } else rm.markNodeComplete(node.id);
}

/** Walk the current act to its boss, preferring battles, and win it. Returns battles won. */
function clearAct(rm) {
  let battles = 0;
  for (let guard = 0; guard < 60 && !rm.isActComplete(); guard++) {
    const options = rm.getAvailableNodes();
    const node = options.find((n) => BATTLE_TYPES.has(n.type)) || options[0];
    if (BATTLE_TYPES.has(node.type)) battles++;
    winNode(rm, node);
  }
  expect(rm.isActComplete()).toBe(true);
  return battles;
}

describe('back-loaded run payout', () => {
  it('a won opening map and an abandon pays nothing (the restart farm loop)', () => {
    const rm = newRun('lunatic');
    const start = rm.getAvailableNodes()[0];
    winNode(rm, start);
    expect(rm.completedBattles).toBe(1);
    expect(rm.previewEndRunRewards('defeat')).toEqual({ valor: 0, supply: 0 });
  });

  it('banks each battle by the act it was fought in, and an Act I clear pays little', () => {
    const rm = newRun('normal');
    const battles = clearAct(rm);
    // Act I: the first battle 0, every other 7.
    expect(rm.metaBattlePoints).toBe((battles - 1) * 7);
    rm.advanceAct();
    // Abandoning at Act II's start: 25 for Act I + the battles, x0.8 (this walk never enters a
    // battle, so the boss milestone, set at battle entry, is not in it).
    const owed = Math.floor(((battles - 1) * 7 + 25) * 0.8);
    expect(rm.previewEndRunRewards('defeat')).toEqual({ valor: owed, supply: owed });
    const before = rm.metaBattlePoints;
    winNode(rm, rm.getAvailableNodes()[0]);
    expect(rm.metaBattlePoints - before).toBe(15); // an Act II battle
  });

  it('a won run pays far more per battle than restarting after Act I', () => {
    const rm = newRun('lunatic');
    const act1Battles = clearAct(rm);
    rm.advanceAct();
    const act1Payout = rm.previewEndRunRewards('defeat').valor;
    let battles = act1Battles;
    while (!rm.isRunComplete()) {
      battles += clearAct(rm);
      if (!rm.isRunComplete()) rm.advanceAct();
    }
    const win = rm.previewEndRunRewards('victory').valor;
    // Black Sun x2: the victory alone is worth 600.
    expect(win - rm.previewEndRunRewards('defeat').valor).toBe(600);
    expect(win / battles).toBeGreaterThan(2.5 * (act1Payout / act1Battles));
  });

  it('banked points survive a save and load', () => {
    const rm = newRun('hard');
    clearAct(rm);
    rm.advanceAct();
    winNode(rm, rm.getAvailableNodes()[0]);
    const restored = RunManager.fromJSON(rm.toJSON(), gameData);
    expect(restored.metaBattlePoints).toBe(rm.metaBattlePoints);
    expect(restored.previewEndRunRewards('defeat')).toEqual(rm.previewEndRunRewards('defeat'));
  });

  it('a save from before banked points is credited the old 15 a battle', () => {
    const rm = newRun('normal');
    clearAct(rm);
    const saved = rm.toJSON();
    delete saved.metaBattlePoints;
    const restored = RunManager.fromJSON(saved, gameData);
    expect(restored.metaBattlePoints).toBe(rm.completedBattles * 15);
  });
});
