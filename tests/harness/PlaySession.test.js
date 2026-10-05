// Headless play sessions (tools/play): a session is its options plus a command log, and
// the game is rebuilt by replaying it. These pin the properties an agent's playtest
// depends on: replay reproduces every logged state, a refusal or a look changes
// nothing, sessions do not leak randomness or item uids into each other, the fog
// hides what it hides, and a forecast says what the strike then does.

import { describe, it, expect } from 'vitest';
import { loadGameData } from '../testData.js';
import { PlaySession, ReplayDivergence, digestOf } from '../../tools/play/session.js';
import { PlayError } from '../../tools/play/parse.js';
import {
  forecastAttack,
  knowledgeOf,
  movementTiles,
  weaponsReaching,
  defaultWeapon,
} from '../../tools/play/battleView.js';
import { forecastStrikeGroups } from '../../src/engine/Combat.js';

const gameData = loadGameData();

/** A fixed policy that walks a run through every kind of phase it meets. */
async function playScripted(session, maxCommands) {
  const order = ['recruit', 'battle', 'shop', 'church', 'ruins', 'colosseum', 'boss'];
  const tryAll = async (cmds) => {
    for (const cmd of cmds) {
      try {
        await session.exec(cmd);
        return true;
      } catch (err) {
        if (!(err instanceof PlayError)) throw err;
      }
    }
    return false;
  };
  for (let i = 0; i < maxCommands && !session.over; i++) {
    const g = session.game;
    const rm = g.rm;
    let ok;
    switch (session.phase) {
      case 'blessing':
        ok = await tryAll(['bless 1']);
        break;
      case 'map':
        ok = await tryAll(
          g
            .availableNodes()
            .sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type))
            .map((n) => `go ${n.id}`),
        );
        break;
      case 'deploy':
        ok = await tryAll(['deploy last']);
        break;
      case 'battle':
        ok = await tryAll(['auto battle']);
        break;
      case 'reward':
        ok = await tryAll([
          'recruit 1',
          'lord 1',
          ...(rm.pendingBattleReward?.choices || []).flatMap((_, n) => [
            `take ${n + 1}`,
            `take ${n + 1} to ${rm.roster[0].name}`,
            `take ${n + 1} to convoy`,
          ]),
          'skip',
        ]);
        break;
      case 'shop':
        await tryAll([`buy 1 for ${rm.roster[0].name}`]);
        ok = await tryAll(['leave']);
        break;
      case 'church':
        await tryAll(['heal']);
        ok = await tryAll(['leave']);
        break;
      case 'ruins':
        await tryAll(['path rest']);
        ok = await tryAll(['leave']);
        break;
      case 'colosseum':
        await tryAll(['mercs']);
        ok = await tryAll(['leave']);
        break;
      default:
        ok = false;
    }
    if (!ok) throw new Error(`scripted play stuck in ${session.phase}`);
  }
}

async function firstBattle(seed) {
  const session = await PlaySession.create(gameData, { seed });
  await session.exec('bless skip');
  await session.exec(`go ${session.game.availableNodes()[0].id}`);
  return session;
}

describe('PlaySession replay', () => {
  it('replays a log to the same state, command by command', async () => {
    const session = await PlaySession.create(gameData, { seed: 11, invincible: true });
    await playScripted(session, 45);
    const record = session.toRecord();
    // Shops, rewards and at least two battles: more than the opening.
    expect(session.game.rm.completedBattles).toBeGreaterThanOrEqual(2);

    const replay = await PlaySession.fromRecord(gameData, JSON.parse(JSON.stringify(record)));
    expect(replay.log.map((e) => e.digest)).toEqual(record.log.map((e) => e.digest));
    expect(replay.digest()).toBe(session.digest());
    expect(replay.view()).toBe(session.view());
  });

  it('plays two interleaved sessions exactly as it plays each alone', async () => {
    // A battle won and its spoils taken: units, gear and rewards all draw item uids.
    const script = ['bless 1', null, 'start', 'auto turn', 'auto battle', 'skip', null];
    const nodeOf = (s) => `go ${s.game.availableNodes()[0].id}`;
    const alone = [];
    for (const seed of [5, 6]) {
      const s = await PlaySession.create(gameData, { seed });
      for (const cmd of script) await s.exec(cmd ?? nodeOf(s));
      alone.push(s.digest());
    }
    const a = await PlaySession.create(gameData, { seed: 5 });
    const b = await PlaySession.create(gameData, { seed: 6 });
    for (const cmd of script) {
      await a.exec(cmd ?? nodeOf(a));
      await b.exec(cmd ?? nodeOf(b));
    }
    expect([a.digest(), b.digest()]).toEqual(alone);
    // The process's own Math.random is handed back after every command.
    const native = Math.random;
    await a.query('look');
    expect(Math.random).toBe(native);
  });

  it('refuses a replay whose logged state differs', async () => {
    const session = await firstBattle(3);
    await session.exec('start');
    const record = session.toRecord();
    record.log[1].digest = '0000000000000000';
    await expect(PlaySession.fromRecord(gameData, record)).rejects.toBeInstanceOf(ReplayDivergence);
    // Unchecked, the same log replays (the adapter's --rebase).
    const rebased = await PlaySession.fromRecord(gameData, record, { verify: false });
    expect(rebased.digest()).toBe(session.digest());
  });

  it('forks a session at an earlier command', async () => {
    const session = await firstBattle(3);
    await session.exec('start');
    await session.exec('end');
    const fork = await PlaySession.fromRecord(gameData, session.toRecord(), { upTo: 2 });
    expect(fork.log.map((e) => e.cmd)).toEqual(session.log.slice(0, 2).map((e) => e.cmd));
    expect(fork.phase).toBe('battle');
    expect(fork.game.battle.formation).not.toBeNull();
  });
});

describe('PlaySession commands', () => {
  it('a refused command changes nothing and is not logged', async () => {
    const session = await firstBattle(3);
    await session.exec('start');
    const before = digestOf(session.game);
    const logged = session.log.length;
    for (const cmd of [
      'go nowhere',
      'move P1 99,99 wait',
      'move P1 stay attack E1',
      'move P9 stay wait',
      'move P1 stay dance',
      'move P2 stay heal P1',
      'move P1 stay item Elixir',
      'bless 1',
    ]) {
      await expect(session.exec(cmd), cmd).rejects.toBeInstanceOf(PlayError);
      expect(digestOf(session.game), cmd).toBe(before);
    }
    expect(session.log.length).toBe(logged);
  });

  it('a look, an options list, a forecast or a threat query changes nothing', async () => {
    const session = await firstBattle(3);
    await session.exec('start');
    await session.exec('end');
    const before = digestOf(session.game);
    const rng = session.game.rngState();
    const b = session.game.battle.battle;
    for (const q of ['look', 'roster', 'map', 'help', 'options P1', 'options P3', 'unit P2']) {
      expect(typeof (await session.query(q))).toBe('string');
    }
    for (const u of b.playerUnits) await session.query(`threat ${u.col},${u.row} P1`);
    const foe = b.enemyUnits.find((e) => knowledgeOf(b).isKnown(e));
    const p1 = b.playerUnits[0];
    for (const key of movementTiles(b, p1).keys()) {
      const [col, row] = key.split(',').map(Number);
      if (weaponsReaching(b, p1, foe, col, row).length)
        await session.query(`forecast P1 ${col},${row} ${session.game.battle.ids.id(foe)}`);
    }
    expect(digestOf(session.game)).toBe(before);
    expect(session.game.rngState()).toEqual(rng);
  });

  it('a strike deals the damage its forecast showed', async () => {
    const session = await firstBattle(3);
    await session.exec('start');
    let checked = 0;
    for (let turn = 0; turn < 8 && checked < 3 && session.phase === 'battle'; turn++) {
      const pb = session.game.battle;
      const b = pb.battle;
      let plan = null;
      for (const unit of b.playerUnits.filter((u) => !u.hasActed)) {
        for (const key of movementTiles(b, unit).keys()) {
          const [col, row] = key.split(',').map(Number);
          for (const foe of b.enemyUnits.filter((e) => knowledgeOf(b).isKnown(e))) {
            const reaching = weaponsReaching(b, unit, foe, col, row);
            if (reaching.length)
              plan ||= { unit, foe, col, row, weapon: defaultWeapon(unit, reaching) };
          }
        }
      }
      if (!plan) {
        await session.exec('end');
        continue;
      }
      const { forecast } = session.game.peek(() =>
        forecastAttack(b, plan.unit, plan.foe, {
          col: plan.col,
          row: plan.row,
          weapon: plan.weapon,
        }),
      );
      await session.exec(
        `move ${pb.ids.id(plan.unit)} ${plan.col},${plan.row} attack ${pb.ids.id(plan.foe)} with ${plan.weapon.name}`,
      );
      const combat = pb.events.find((e) => e.type === 'combat' && e.attacker === plan.unit);
      const strikes = (combat.result.events || []).filter((e) => e.type === 'strike');
      const mine = strikes.filter((e) => e.attackerSide !== 'defender');
      const theirs = strikes.filter((e) => e.attackerSide === 'defender');
      const myGroups = forecastStrikeGroups(forecast.attacker);
      expect(mine.length).toBeGreaterThan(0);
      expect(mine.length).toBeLessThanOrEqual(forecast.attacker.attackCount);
      for (const s of mine.filter((e) => !e.miss && !e.isCrit && !e.skillActivations?.length))
        expect(myGroups.map((g) => g.damage)).toContain(s.damage);
      if (!forecast.defender?.canCounter) expect(theirs).toHaveLength(0);
      for (const s of theirs.filter((e) => !e.miss && !e.isCrit && !e.skillActivations?.length))
        expect(forecastStrikeGroups(forecast.defender).map((g) => g.damage)).toContain(s.damage);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('formation places units on its tiles only, swapping an occupant', async () => {
    const session = await firstBattle(3);
    const f = session.game.battle.formation;
    expect(f).not.toBeNull();
    const [a, b] = f.units;
    const aTile = { col: a.col, row: a.row };
    const bTile = { col: b.col, row: b.row };
    await expect(session.exec('place P1 0,0')).rejects.toBeInstanceOf(PlayError);
    await expect(session.exec('move P1 stay wait')).rejects.toBeInstanceOf(PlayError);
    await session.exec(`place ${a.name} ${bTile.col},${bTile.row}`);
    expect({ col: a.col, row: a.row }).toEqual(bTile);
    expect({ col: b.col, row: b.row }).toEqual(aTile);
    await session.exec('start');
    expect(session.game.battle.formation).toBeNull();
    expect({ col: a.col, row: a.row }).toEqual(bTile);
  });

  it('the fog hides enemies from the view and from ids until they are seen', async () => {
    // Seed 1's second battle (act1_1_1) is fogged with every enemy out of sight.
    const session = await PlaySession.create(gameData, { seed: 1, invincible: true });
    for (const cmd of ['bless skip', 'go act1_0_2', 'auto battle', 'skip', 'go act1_1_1'])
      await session.exec(cmd);
    const pb = session.game.battle;
    const b = pb.battle;
    expect(b.grid.fogEnabled).toBe(true);
    const hidden = b.enemyUnits.filter((e) => !knowledgeOf(b).isKnown(e));
    expect(hidden.length).toBeGreaterThan(0);
    for (const e of hidden) expect(pb.ids.byUnit.has(e)).toBe(false);
    const view = session.view();
    expect(view).toMatch(/ENEMIES \(0 visible; more may hide in fog\)/);
    for (const e of hidden) expect(view).not.toContain(`@${e.col},${e.row}`);
  });

  it('an "end" straight after the turn ended by itself is refused; "end again" skips on purpose', async () => {
    const session = await firstBattle(3);
    await session.exec('start');
    const ids = session.game.battle.battle.playerUnits.map((u) => session.game.battle.ids.id(u));
    let last;
    for (const id of ids) last = await session.exec(`move ${id} stay wait`);
    expect(last.lines).toContain('Every unit has acted: the player phase ends.');
    const turn = session.game.battle.battle.turnManager.turnNumber;
    const before = digestOf(session.game);
    await expect(session.exec('end')).rejects.toThrow(/end again/);
    expect(digestOf(session.game)).toBe(before);
    await session.exec('end again');
    expect(session.game.battle?.battle.turnManager.turnNumber ?? turn + 1).toBe(turn + 1);
    // Only straight after: a later "end" is an ordinary end.
    const turn2 = session.game.battle.battle.turnManager.turnNumber;
    await session.exec('end');
    expect(session.game.battle.battle.turnManager.turnNumber).toBe(turn2 + 1);
  });

  it("reports an enemy healer's heal, which the AI applies itself", async () => {
    const session = await firstBattle(3);
    await session.exec('start');
    const b = session.game.battle.battle;
    const [hurt, healer] = b.enemyUnits;
    healer.inventory.push(structuredClone(gameData.weapons.find((w) => w.name === 'Heal')));
    healer.proficiencies.push({ type: 'Staff', rank: 'Prof' });
    healer.aiMode = 'heal';
    healer.col = hurt.col;
    healer.row = hurt.row > 0 ? hurt.row - 1 : hurt.row + 1;
    hurt.currentHP = 5;
    const { lines } = await session.exec('end');
    expect(lines.some((l) => /E\d+ \w+ heals E\d+ \w+: HP 5->\d+\./.test(l))).toBe(true);
  });

  it('names the affix behind damage the strikes do not explain', async () => {
    const session = await firstBattle(3);
    await session.exec('start');
    for (const e of session.game.battle.battle.enemyUnits) e.affixes = ['venomous'];
    let seen = null;
    for (let i = 0; i < 12 && !seen && session.phase === 'battle'; i++) {
      const { lines } = await session.exec('end');
      seen = lines.find((l) => /lost 5 more than the strikes dealt \(\w+'s Venomous\)/.test(l));
    }
    expect(seen).toBeTruthy();
  });
});
