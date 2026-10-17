import { describe, expect, it } from 'vitest';
import { RunManager } from '../src/engine/RunManager.js';
import { PostCombatController } from '../src/ui/PostCombatController.js';
import { runCreditsModel } from '../src/ui/runCreditsModel.js';
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

  it('Resolve reads the force that deployed: sixteen benched recruits do not cushion three deaths', () => {
    const rm = freshRun();
    const lord = rm.getRoster()[0];
    const mk = (name) => ({ ...structuredClone(lord), name, unitUid: `uid_${name}` });
    const deployed = ['D0', 'D1', 'D2', 'D3'].map(mk);
    const bench = Array.from({ length: 16 }, (_, i) => mk(`B${i}`));
    rm.roster = [...deployed, ...bench];
    const node = rm.getAvailableNodes()[0];
    rm.completeBattle([deployed[0], ...bench], node.id, 0, {
      turnCount: 4,
      turnPar: 6,
      deployedSurvivors: 1,
    });
    expect(rm.runLedger).toMatchObject({ losses: 3, worstSurvival: 0.25 });
  });

  it('gold flows are tallied: the start, battle gold, a sale, an event cost and a purchase', () => {
    const rm = freshRun();
    const start = rm.gold;
    expect(rm.runLedger.goldStart).toBe(start);
    rm.awardGold(400);
    rm.addGold(-150); // an event's price
    expect(rm.spendGold(250)).toBe(true);
    expect(rm.spendGold(start + 10_000)).toBe(false); // refused: nothing tallied
    expect(rm.runLedger).toMatchObject({ goldIn: 400, goldOut: 400 });
    const back = RunManager.fromJSON(JSON.parse(JSON.stringify(rm.toJSON())), data);
    expect(back.runLedger).toMatchObject({ goldStart: start, goldIn: 400, goldOut: 400 });
  });

  it('a lost run carries the final board through failRun and a save', () => {
    const rm = freshRun();
    const terminal = {
      turns: 5,
      survivors: [{ name: 'Gaspar', className: 'Fighter', level: 3, kills: 2 }],
      fallen: [{ name: 'Edric', className: 'Lord', level: 3, kills: 7 }],
    };
    rm.failRun({ defeatedBy: 'Varro', wasBoss: false, terminal });
    expect(rm.status).toBe('defeat');
    const back = RunManager.fromJSON(JSON.parse(JSON.stringify(rm.toJSON())), data);
    expect(back.runLedger.terminal).toEqual(terminal);
    const rows = Object.fromEntries(
      runCreditsModel(back, { result: 'defeat' }).details.map((d) => [d.key, d.value]),
    );
    expect(rows).toMatchObject({ turns: '5', army: '1', fallen: 'Edric' });
    expect(rows.mvp).toContain('Edric');
    // An abandon passes no context: no board is invented.
    const abandoned = freshRun();
    abandoned.failRun();
    expect(abandoned.runLedger.terminal).toBeNull();
  });

  it('the scene takes the terminal summary from the live battle before failRun clears it', () => {
    const rm = freshRun();
    const lord = rm.getRoster()[0];
    const mk = (name, extra = {}) => ({
      ...structuredClone(lord),
      name,
      unitUid: `uid_${name}`,
      ...extra,
    });
    const edric = mk('Edric');
    const gaspar = mk('Gaspar');
    rm.roster = [edric, gaspar];
    const scene = {
      runManager: rm,
      playerUnits: [mk('Gaspar', { currentHP: 6, _battleDeeds: { kills: 3 } })],
      escapedUnits: [],
      nonDeployedUnits: [],
      _battleRecruits: [],
      _fallenBattleRecords: [{ name: 'Edric', unitUid: 'uid_Edric', battleDeeds: { kills: 2 } }],
      turnManager: { turnNumber: 6 },
    };
    const terminal = PostCombatController.prototype.terminalSummary.call({ scene });
    expect(terminal.turns).toBe(6);
    expect(terminal.survivors.map((u) => u.name)).toEqual(['Gaspar']);
    expect(terminal.fallen.map((u) => [u.name, u.kills])).toEqual([['Edric', 2]]);
  });
});
