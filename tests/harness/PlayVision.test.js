// Vision rewinds in headless play (tools/play/session.js), as VisionRewindController
// runs them: a charge returns the battle to an earlier moment of the player's phase,
// the battle's random stream resumes where it stood (the same orders roll the same),
// and a fallen commander with a charge left is a choice, not the end.

import { describe, it, expect } from 'vitest';
import { loadGameData } from '../testData.js';
import { PlaySession, digestOf } from '../../tools/play/session.js';
import { PlayError } from '../../tools/play/parse.js';
import { canonicalForm, snapshotOf } from '../../tools/play/snapshot.js';

const gameData = loadGameData();

async function inBattle(options = {}) {
  const session = await PlaySession.create(gameData, { seed: 3, ...options });
  for (const cmd of ['bless skip', 'go act1_0_2', 'start']) await session.exec(cmd);
  return session;
}

/** The battle's whole state, but for the Vision count a rewind changes by design. */
function battleState(session) {
  const form = canonicalForm(session.game.battle.battle, { gameData: session.gameData });
  delete form.runManager.visionChargesRemaining;
  delete form.runManager.visionCount;
  return form;
}

describe('Vision rewinds', () => {
  it('returns to an earlier moment, spends one charge, and replays from the log', async () => {
    const session = await inBattle();
    await session.exec('move P1 stay wait'); // command 4
    await session.exec('move P2 stay wait'); // command 5
    const at4 = await PlaySession.fromRecord(gameData, {
      ...session.toRecord(),
      log: session.log.slice(0, 4),
    });
    const list = await session.query('rewinds');
    expect(list).toMatch(/rewind 4: turn 1, before "move P2 stay wait"/);
    expect(list).toMatch(/rewind 3: turn 1 start, before "move P1 stay wait"/);
    expect(list).not.toMatch(/rewind 5/); // you are here
    expect(session.game.rm.visionChargesRemaining).toBe(1);

    await session.exec('rewind 4');
    expect(session.game.rm.visionChargesRemaining).toBe(0);
    expect(session.game.rm.visionCount).toBe(1);
    expect(battleState(session)).toEqual(battleState(at4));
    // The undone command stays in the log as history; the replay agrees.
    expect(session.log.map((e) => e.cmd).slice(-2)).toEqual(['move P2 stay wait', 'rewind 4']);
    const replay = await PlaySession.fromRecord(gameData, session.toRecord());
    expect(snapshotOf(replay.game)).toEqual(snapshotOf(session.game));

    // No charge left.
    await expect(session.exec('rewind 3')).rejects.toThrow(/No Vision charges/);
  });

  it('the same orders roll the same after a rewind', async () => {
    const session = await inBattle({ meta: 'max' });
    expect(session.game.rm.visionChargesRemaining).toBeGreaterThan(1);
    await session.exec('end'); // an enemy phase: rolls
    const first = battleState(session);
    await session.exec('rewind 3');
    await session.exec('end');
    expect(battleState(session)).toEqual(first);
  });

  it('a rewound line of play is history: its moments are no longer destinations', async () => {
    const session = await inBattle({ meta: 'max' });
    await session.exec('move P1 stay wait'); // 4
    await session.exec('move P2 stay wait'); // 5
    await session.exec('rewind 3'); // 6: back to the turn's start
    const list = await session.query('rewinds');
    expect(list).not.toMatch(/rewind [345]:/);
    await session.exec('move P3 stay wait'); // 7
    expect(await session.query('rewinds')).toMatch(
      /rewind 6: turn 1 start, before "move P3 stay wait"/,
    );
  });

  it('refuses mid-order, and on Black Sun offers turn starts only', async () => {
    const session = await inBattle({ difficulty: 'lunatic' });
    await session.exec('move P1 stay wait');
    await session.exec('move P2 stay wait');
    const list = await session.query('rewinds');
    expect(list).toMatch(/rewind 4: turn 1, .*unavailable: Turn starts only/);
    await expect(session.exec('rewind 4')).rejects.toThrow(/Turn starts only/);
    await expect(session.exec('rewind 99')).rejects.toBeInstanceOf(PlayError);
  });

  it('a fallen commander with a charge left can rewind or accept fate', async () => {
    for (const choice of ['accept', 'rewind']) {
      const session = await inBattle();
      const b = session.game.battle.battle;
      const edric = b.playerUnits.find((u) => u.isCommander);
      // The commander stands beside an overwhelming foe and strikes it: the counter kills.
      const foe = b.enemyUnits[0];
      Object.assign(foe, { col: edric.col + 1, row: edric.row, currentHP: 99 });
      foe.stats = { ...foe.stats, HP: 99, STR: 99, SKL: 99, SPD: 0, DEF: 99, LCK: 0 };
      if (b.grid.getMoveCost(foe.col, foe.row, foe.moveType) === Infinity)
        b.grid.mapLayout[foe.row][foe.col] = b.gameData.terrain.findIndex(
          (t) => t.name === 'Plain',
        );
      edric.currentHP = 1;
      b._refreshFogVisibility();
      session.game.battle._afterStep();
      const id = session.game.battle.ids.id(foe);
      await session.exec(`move Edric stay attack ${id}`);
      expect(session.phase).toBe('fatal');
      expect(session.game.rm.status).not.toBe('defeat');
      if (choice === 'accept') {
        await session.exec('accept');
        expect(session.phase).toBe('ended');
        expect(session.game.rm.status).toBe('defeat');
      } else {
        expect(await session.query('rewinds')).toMatch(/rewind 3: turn 1 start/);
        await session.exec('rewind 3');
        expect(session.phase).toBe('battle');
        expect(session.game.rm.visionChargesRemaining).toBe(0);
        expect(digestOf(session.game)).toBeTruthy();
      }
    }
  });
});
