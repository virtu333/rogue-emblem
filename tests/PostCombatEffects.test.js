// PostCombatEffects is one implementation driven two ways: the scene awaits every beat
// (with presentation), the harness acts only on the required ones. These tests pin the
// beat protocol both drivers rely on.
import { describe, expect, it } from 'vitest';
import {
  allyBuff,
  aoeSplash,
  runPostCombatEffectsSync,
  postCombatEffects,
  splashDamage,
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
  it('a splash that drops a foe changes HP first, then asks for its removal', () => {
    const caster = unit('Mage', 'player', 0, 0, 20);
    const primary = unit('Primary', 'enemy', 1, 0, 20);
    const frail = unit('Frail', 'enemy', 1, 1, 4, 20);
    const sturdy = unit('Sturdy', 'enemy', 2, 0, 20);
    const step = { radius: 1, damageKind: 'fixed', fixedDamage: 6, nonLethal: false };
    expect(splashDamage(step)).toBe(6);
    const beats = [...aoeSplash(step, caster, primary, world([caster], [primary, frail, sturdy]))];
    // Row-major order: Sturdy (row 0) before Frail (row 1).
    expect(beats.map((b) => [b.kind, b.unit.name, b.text ?? ''])).toEqual([
      ['hp', 'Sturdy', ''],
      ['hint', 'Sturdy', 'Splash -6'],
      ['hp', 'Frail', ''],
      ['hint', 'Frail', 'Splash -4'],
      ['remove', 'Frail', ''],
    ]);
    expect(beats.at(-1).killer).toBe(caster);
    expect([sturdy.currentHP, frail.currentHP]).toEqual([14, 0]);
  });

  it('the sync driver acts on the required beats only, in order', () => {
    const caster = unit('Mage', 'player', 0, 0, 20);
    const primary = unit('Primary', 'enemy', 1, 0, 20);
    const frail = unit('Frail', 'enemy', 1, 1, 4, 20);
    const removed = [];
    runPostCombatEffectsSync(
      aoeSplash(
        { radius: 1, damageKind: 'fixed', fixedDamage: 6 },
        caster,
        primary,
        world([caster], [primary, frail]),
      ),
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
