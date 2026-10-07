// The report on a headless play session (tools/play/report.js): what went into each
// battle and came out, what spoils were offered and taken. Expectations come from
// the game as it is played here, read before and after each step.

import { describe, it, expect } from 'vitest';
import { loadGameData } from '../testData.js';
import { PlaySession } from '../../tools/play/session.js';
import { buildReport, reportText } from '../../tools/play/report.js';

const gameData = loadGameData();

describe('session report', () => {
  it('records each battle and the spoils offered and taken', async () => {
    const session = await PlaySession.create(gameData, { seed: 7, invincible: true });
    await session.exec('bless skip');
    const node = session.game.availableNodes()[0].id;
    await session.exec(`go ${node}`);
    const deployed = session.game.battle.battle.playerUnits.map((u) => u.name);
    const par = session.game.battle.battle.turnPar;
    await session.exec('auto battle');
    expect(session.phase).toBe('reward');
    const turns = session.game.lastBattle.turns;
    const offered = session.game.rm.pendingBattleReward.choices.map((c) =>
      c.type === 'gold' ? `${c.goldAmount}g` : c.item.name,
    );
    const gold = session.game.rm.gold;
    await session.exec('skip');

    const report = await buildReport(gameData, session.toRecord(), {
      journal: [{ type: 'query' }, { type: 'refused' }, { type: 'query' }],
    });
    expect(report.battles).toHaveLength(1);
    const [battle] = report.battles;
    expect(battle).toMatchObject({ node, result: 'victory', turns, par, fallen: [] });
    expect(battle.deployed.map((u) => u.name)).toEqual(deployed);
    expect(battle.deployed.find((u) => u.name === 'Sera').damage).toEqual(['magic', 'staff']);
    expect(report.rewards).toHaveLength(1);
    expect(
      report.rewards[0].offers.map((o) => (o.type === 'gold' ? `${o.gold}g` : o.item)),
    ).toEqual(offered);
    expect(report.rewards[0].picks).toEqual(['skip']);
    expect(report.run.gold).toBe(session.game.rm.gold);
    expect(session.game.rm.gold).toBeGreaterThan(gold);
    expect(report.journal).toMatchObject({ queries: 2, refusals: 1 });
    expect(report.outcome).toEqual({ kind: 'unfinished' });
    expect(reportText(report)).toMatch(
      new RegExp(`${node} \\(battle, \\w+\\): victory in ${turns} turns`),
    );
  });
});
