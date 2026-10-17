import { describe, expect, it } from 'vitest';
import { RunManager } from '../src/engine/RunManager.js';
import { loadGameData } from './testData.js';

const data = loadGameData();

function freshRun() {
  const rm = new RunManager(data);
  rm.startRun({ runSeed: 4242, difficultyId: 'normal', applyBlessingsAtStart: false });
  return rm;
}

describe('RunManager · run ledger', () => {
  it('a victory commits par, gold and survival; the save round trips it', () => {
    const rm = freshRun();
    const node = rm.getAvailableNodes()[0];
    rm.completeBattle(rm.getRoster(), node.id, 0, { turnCount: 4, turnPar: 6 });
    expect(rm.runLedger).toMatchObject({ parBattles: 1, underPar: 1, losses: 0, worstSurvival: 1 });
    const back = RunManager.fromJSON(JSON.parse(JSON.stringify(rm.toJSON())), data);
    expect(back.runLedger).toEqual(rm.runLedger);
  });

  it('a save from before the ledger loads ungraded', () => {
    const saved = JSON.parse(JSON.stringify(freshRun().toJSON()));
    delete saved.runLedger;
    const back = RunManager.fromJSON(saved, data);
    expect(back.runLedger).toBeNull();
    const node = back.getAvailableNodes()[0];
    back.completeBattle(back.getRoster(), node.id, 0, { turnCount: 4, turnPar: 6 });
    expect(back.runLedger).toBeNull();
  });

  it('a lost battle is never recorded (a revert writes nothing)', () => {
    const rm = freshRun();
    const before = structuredClone(rm.runLedger);
    expect(rm.completeBattle(rm.getRoster(), 'no-such-node', 0, { turnCount: 4, turnPar: 6 })).toBe(
      false,
    );
    expect(rm.runLedger).toEqual(before);
  });
});
