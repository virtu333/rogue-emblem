// The canonical snapshot behind headless play's digests (tools/play/snapshot.js). A
// digest that misses a field lets two different games pass as one, and lets a
// refusal that changed that field pass as harmless. Each case here changes one kind
// of state the old hand-picked digest left out, and only that, and requires the
// digest to notice; the rollback cases change state and then fail.

import { describe, it, expect } from 'vitest';
import { loadGameData } from '../testData.js';
import { PlaySession, digestOf } from '../../tools/play/session.js';
import { PlayError } from '../../tools/play/parse.js';
import { canonicalForm, snapshotOf } from '../../tools/play/snapshot.js';
import { applyCondition } from '../../src/engine/StatusConditionSystem.js';

const gameData = loadGameData();

async function inBattle() {
  const session = await PlaySession.create(gameData, { seed: 3 });
  for (const cmd of ['bless skip', 'go act1_0_2', 'start']) await session.exec(cmd);
  return session;
}

async function atSpoils() {
  const session = await PlaySession.create(gameData, { seed: 7, invincible: true });
  for (const cmd of ['bless skip', 'go act1_0_2', 'auto battle']) await session.exec(cmd);
  expect(session.phase).toBe('reward');
  return session;
}

/** Each mutation changes one thing a later command could notice. */
const BATTLE_CHANGES = {
  'an enemy stat': (s) => s.game.battle.battle.enemyUnits[0].stats.DEF++,
  'a player stat': (s) => s.game.battle.battle.playerUnits[0].stats.SPD++,
  'which carried weapon is equipped': (s) => {
    const u = s.game.battle.battle.playerUnits.find((p) => p.inventory.length > 1);
    u.weapon = u.inventory.find((w) => w !== u.weapon);
  },
  'a weapon use spent': (s) => {
    const w = s.game.battle.battle.playerUnits[0].weapon;
    w._usesSpent = (w._usesSpent || 0) + 1;
  },
  'a status condition': (s) => applyCondition(s.game.battle.battle.enemyUnits[0], 'sleep', 1),
  'a temporary wall': (s) => {
    const u = s.game.battle.battle.playerUnits[0];
    s.game.battle.battle.grid.setTemporaryTerrain(u.col, u.row + 1, 'Wall', 2);
  },
  'the fog': (s) => s.game.battle.battle.grid.visibleSet.add('0,0:extra'),
  'an enemy skill': (s) => s.game.battle.battle.enemyUnits[0].skills.push('vantage'),
  'an item in a bag': (s) =>
    s.game.battle.battle.playerUnits[0].consumables.push({ name: 'Elixir', uses: 1 }),
  'the turn par': (s) => s.game.battle.battle.turnPar++,
  'the gold earned in battle': (s) => (s.game.battle.battle.goldEarned += 1),
  'which unit an id names': (s) => {
    const ids = s.game.battle.ids;
    const [a, b] = s.game.battle.battle.playerUnits;
    const ia = ids.byUnit.get(a);
    ids.byUnit.set(a, ids.byUnit.get(b));
    ids.byUnit.set(b, ia);
  },
};

const RUN_CHANGES = {
  "an unclaimed spoil's contents (same count)": (s) => {
    const choice = s.game.rm.pendingBattleReward.choices.find((c) => c.type === 'gold');
    choice.goldAmount += 1;
  },
  'a pooled scroll': (s) =>
    (s.game.rm.scrolls ||= []).push({ name: 'Shove Scroll', type: 'Scroll' }),
  'a pooled accessory': (s) => (s.game.rm.accessories ||= []).push({ name: 'Power Ring' }),
  "a roster unit's growth": (s) => s.game.rm.roster[0].growths.HP++,
  'a node on the route': (s) => (s.game.rm.nodeMap.nodes.at(-1).completed = true),
};

describe('canonical snapshot', () => {
  for (const [what, change] of Object.entries(BATTLE_CHANGES)) {
    it(`changes with ${what}`, async () => {
      const session = await inBattle();
      const before = digestOf(session.game);
      change(session);
      expect(digestOf(session.game)).not.toBe(before);
    });
  }

  for (const [what, change] of Object.entries(RUN_CHANGES)) {
    it(`changes with ${what}`, async () => {
      const session = await atSpoils();
      const before = digestOf(session.game);
      change(session);
      expect(digestOf(session.game)).not.toBe(before);
    });
  }

  it('is the same for two replays of one log, at any wall-clock time', async () => {
    const a = await inBattle();
    await new Promise((done) => setTimeout(done, 15));
    const b = await PlaySession.fromRecord(gameData, a.toRecord());
    expect(snapshotOf(b.game)).toEqual(snapshotOf(a.game));
    // The engine stamped times and named the run; both came from the session, not the machine.
    expect(a.game.rm.runRecordId).toBe(b.game.rm.runRecordId);
    expect(a.game.rm.runRecordId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('keeps shared references and catalog objects distinguishable', () => {
    const catalog = { weapons: [{ name: 'Iron Sword', might: 5 }] };
    const sword = { name: 'Iron Sword', might: 5 };
    const shared = canonicalForm({ weapon: sword, bag: [sword] }, { gameData: catalog });
    const copied = canonicalForm({ weapon: { ...sword }, bag: [sword] }, { gameData: catalog });
    expect(shared).not.toEqual(copied);
    const fromCatalog = canonicalForm({ weapon: catalog.weapons[0] }, { gameData: catalog });
    expect(fromCatalog.weapon).toEqual({ $data: '/weapons/0' });
  });
});

describe('rollback after a failure', () => {
  for (const [kind, fail] of [
    ['a refusal', () => new PlayError('refused late')],
    ['an engine fault', () => new TypeError('engine exploded')],
  ]) {
    it(`restores everything when ${kind} comes after a change`, async () => {
      const session = await inBattle();
      const before = snapshotOf(session.game);
      const beforeLog = session.toRecord().log;
      const game = session.game;
      const def = game.battle.battle.enemyUnits[0].stats.DEF;
      game.exec = async () => {
        // One change the old digest never looked at, then the failure.
        game.battle.battle.enemyUnits[0].stats.DEF += 5;
        throw fail();
      };
      await expect(session.exec('end')).rejects.toThrow();
      expect(session.game).not.toBe(game); // rebuilt from the log
      expect(session.game.battle.battle.enemyUnits[0].stats.DEF).toBe(def);
      expect(snapshotOf(session.game)).toEqual(before);
      expect(session.toRecord().log).toEqual(beforeLog);
    });
  }

  it('keeps the game as it is after a refusal that changed nothing', async () => {
    const session = await inBattle();
    const game = session.game;
    const before = snapshotOf(game);
    await expect(session.exec('move P1 99,99 wait')).rejects.toBeInstanceOf(PlayError);
    expect(session.game).toBe(game);
    expect(snapshotOf(session.game)).toEqual(before);
  });
});
