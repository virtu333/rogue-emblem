// PostCombatEffects is one implementation driven two ways: the scene awaits every beat
// (with presentation), the harness acts only on the required ones. These tests pin the
// beat protocol both drivers rely on.
import { describe, expect, it } from 'vitest';
import {
  allyBuff,
  areaDamage,
  runPostCombatEffectsSync,
  postCombatEffects,
} from '../src/engine/PostCombatEffects.js';

const unit = (name, faction, col, row, hp, max = hp) => ({
  name,
  faction,
  col,
  row,
  currentHP: hp,
  stats: { HP: max, STR: 10, MOV: 5 },
});

function world(players, enemies) {
  return {
    affixes: { affixes: [] },
    cols: 10,
    rows: 10,
    getMoveCost: () => 1,
    getUnitAt: (col, row) =>
      [...players, ...enemies].find((u) => u.col === col && u.row === row && u.currentHP > 0) ||
      null,
    hostilesOf: (u) => (u.faction === 'enemy' ? players : enemies),
    alliesOf: (u) => (u.faction === 'enemy' ? enemies : players),
    turnNumber: 3,
  };
}

describe('PostCombatEffects beats', () => {
  // A fixed 6-damage blast of radius 1 (Cataclysm's kind of area, smaller).
  const blast = {
    area: {
      shape: 'radius',
      radius: 1,
      pick: 'all',
      maxTargets: null,
      damage: { kind: 'fixed', amount: 6 },
      strikes: 'once',
      nonLethal: false,
    },
    blows: 1,
  };

  it('every blow lands before anyone falls; each victim leaves one credit', () => {
    const caster = unit('Mage', 'player', 0, 0, 20);
    const primary = unit('Primary', 'enemy', 1, 0, 20);
    const frail = unit('Frail', 'enemy', 1, 1, 4, 20);
    const sturdy = unit('Sturdy', 'enemy', 2, 0, 20);
    const result = {};
    const beats = [
      ...areaDamage(blast, caster, primary, world([caster], [primary, frail, sturdy]), result),
    ];
    // Distance from the target, then row: Sturdy (2,0) and Frail (1,1) are both 1 away;
    // Sturdy is on row 0. Both blows, then the fall.
    expect(beats.map((b) => [b.kind, b.unit.name, b.text ?? ''])).toEqual([
      ['hp', 'Sturdy', ''],
      ['hint', 'Sturdy', 'Splash -6'],
      ['hp', 'Frail', ''],
      ['hint', 'Frail', 'Splash -4'],
      ['remove', 'Frail', ''],
    ]);
    expect(beats.at(-1).killer).toBe(caster);
    expect([sturdy.currentHP, frail.currentHP, primary.currentHP]).toEqual([14, 0, 20]);
    expect(result.areaCredits.map((c) => [c.victim.name, c.damage, c.hpBefore, c.killed])).toEqual([
      ['Sturdy', 6, 20, false],
      ['Frail', 4, 4, true],
    ]);
  });

  it("a fall from an earlier victim cannot change a later victim's blow", () => {
    // Both neighbours at 6 HP: both take their blow before either falls, so a death
    // effect resolved by the first removal would find the second already struck.
    const caster = unit('Mage', 'player', 0, 0, 20);
    const primary = unit('Primary', 'enemy', 1, 0, 20);
    const a = unit('A', 'enemy', 2, 0, 6);
    const b = unit('B', 'enemy', 1, 1, 6);
    const kinds = [...areaDamage(blast, caster, primary, world([caster], [primary, a, b]), {})].map(
      (beat) => beat.kind,
    );
    expect(kinds).toEqual(['hp', 'hint', 'hp', 'hint', 'remove', 'remove']);
  });

  it("a survivor finished by a victim's Deathburst is removed once, by that chain", () => {
    // A falls to the blast; its removal (as the scene's removeUnit does) bursts for 5 on
    // its neighbours and removes whoever that drops. B survived the blast with 3 HP, so
    // the burst finishes it. The blast must not ask to remove B a second time: that would
    // pay its gold, remains, deeds and Deathburst twice.
    const caster = unit('Mage', 'player', 0, 0, 20);
    const primary = unit('Primary', 'enemy', 5, 5, 30);
    const a = unit('A', 'enemy', 5, 4, 6, 30);
    const b = unit('B', 'enemy', 4, 5, 9, 30);
    const enemies = [primary, a, b];
    const removals = [];
    const remove = (u) => {
      if (u._removing) return;
      u._removing = true;
      removals.push(u.name);
      enemies.splice(enemies.indexOf(u), 1);
      if (u === a)
        for (const other of [...enemies]) {
          if (Math.abs(other.col - u.col) + Math.abs(other.row - u.row) > 2) continue; // a 2-tile burst
          other.currentHP = Math.max(0, other.currentHP - 5);
          if (other.currentHP <= 0) remove(other);
        }
      u._removing = false;
    };
    const w = { ...world([caster], enemies), hostilesOf: () => enemies };
    const result = {};
    for (const beat of areaDamage(blast, caster, primary, w, result))
      if (beat.kind === 'remove') remove(beat.unit);
    expect(removals).toEqual(['A', 'B']);
    // B's credit is a hit: the blast left it standing.
    expect(result.areaCredits.map((c) => [c.victim.name, c.killed])).toEqual([
      ['A', true],
      ['B', false],
    ]);
  });

  it('a blast victim someone else already removed is not removed again', () => {
    // Both fall to the blast; removing A also sweeps every fallen unit off the board
    // (as a sweep would). By B's turn it is gone, so the blast skips it.
    const caster = unit('Mage', 'player', 0, 0, 20);
    const primary = unit('Primary', 'enemy', 5, 5, 30);
    const a = unit('A', 'enemy', 5, 4, 6, 30);
    const b = unit('B', 'enemy', 4, 5, 6, 30);
    const enemies = [primary, a, b];
    const removals = [];
    const remove = (u) => {
      removals.push(u.name);
      enemies.splice(enemies.indexOf(u), 1);
      if (u === a) for (const other of enemies.filter((e) => e.currentHP <= 0)) remove(other);
    };
    const w = { ...world([caster], enemies), hostilesOf: () => enemies };
    for (const beat of areaDamage(blast, caster, primary, w, {}))
      if (beat.kind === 'remove') remove(beat.unit);
    expect(removals).toEqual(['A', 'B']);
  });

  it('the sync driver acts on the required beats only, in order', () => {
    const caster = unit('Mage', 'player', 0, 0, 20);
    const primary = unit('Primary', 'enemy', 1, 0, 20);
    const frail = unit('Frail', 'enemy', 1, 1, 4, 20);
    const removed = [];
    runPostCombatEffectsSync(
      areaDamage(blast, caster, primary, world([caster], [primary, frail])),
      { remove: (u, { killer }) => removed.push([u.name, killer.name]) },
    );
    expect(removed).toEqual([['Frail', 'Mage']]);
  });

  it('state changes happen whether or not the beats are acted on', () => {
    const source = unit('Edric', 'player', 0, 0, 30);
    const ally = unit('Ally', 'player', 1, 0, 24);
    const step = { artId: 'rally', range: 2, durationPhases: 1, stats: { STR: 3, CRIT: 10 } };
    // Draining the generator with no driver at all still applies the buff.
    for (const beat of allyBuff(step, source, world([source, ally], []))) void beat;
    expect(ally.stats.STR).toBe(13);
    expect(ally._battleTimedWeaponArtBuffs[0]).toMatchObject({
      expiryPhase: 'player',
      expiryTurn: 4, // turn 3 + 1 phase of the source's side
    });
    expect(source.stats.STR).toBe(10); // includeSelf is off
  });
});

// Pin the disclosure against the actual on-hit pipeline, rather than a parallel model.
describe('Venomous and Corrosive disclosure', () => {
  const affixes = {
    affixes: [
      { id: 'venomous', name: 'Venomous', trigger: 'on-attack', effects: { poisonDamage: 5 } },
      {
        id: 'corrosive',
        name: 'Corrosive',
        trigger: 'on-attack',
        effects: { debuffStat: 'DEF', debuffValue: -2 },
      },
    ],
  };
  it('even zero-damage hits from a fallen source apply once per combat, and poison cannot kill', () => {
    const source = { ...unit('Soldier', 'enemy', 0, 0, 0, 20), affixes: ['venomous', 'corrosive'] };
    const target = { ...unit('Edric', 'player', 1, 0, 4, 20), stats: { HP: 20, DEF: 6 } };
    const context = { ...world([target], [source]), affixes };
    const events = Array.from({ length: 2 }, () => ({
      type: 'strike',
      attackerSide: 'attacker',
      damage: 0,
      miss: false,
    }));
    runPostCombatEffectsSync(
      postCombatEffects({ attacker: source, defender: target, result: { events } }, context),
    );
    expect(target.currentHP).toBe(1);
    expect(target.stats.DEF).toBe(4);
    runPostCombatEffectsSync(
      postCombatEffects({ attacker: source, defender: target, result: { events } }, context),
    );
    expect(target.currentHP).toBe(1);
    expect(target.stats.DEF).toBe(2);
  });
  it('all misses cause neither poison nor corrosion', () => {
    const source = { ...unit('Soldier', 'enemy', 0, 0, 20), affixes: ['venomous', 'corrosive'] };
    const target = { ...unit('Edric', 'player', 1, 0, 20), stats: { HP: 20, DEF: 6 } };
    runPostCombatEffectsSync(
      postCombatEffects(
        {
          attacker: source,
          defender: target,
          result: { events: [{ type: 'strike', attackerSide: 'attacker', miss: true }] },
        },
        { ...world([target], [source]), affixes },
      ),
    );
    expect(target.currentHP).toBe(20);
    expect(target.stats.DEF).toBe(6);
  });
});
