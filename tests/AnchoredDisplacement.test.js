// Anchored (affixes.json `immuneToDisplacement`) keeps its holder on its tile when a
// weapon art would push or swap it. Driven through the real post-combat pipeline with
// the real art and affix data, so a missed wire anywhere (affix lookup, the resolver,
// the world the generator passes) leaves the unit moved.
import { describe, expect, it } from 'vitest';
import { loadGameData } from './testData.js';
import { postCombatEffects } from '../src/engine/PostCombatEffects.js';
import { isDisplacementImmune } from '../src/engine/AffixSystem.js';

const data = loadGameData();
const art = (id) => data.weaponArts.arts.find((a) => a.id === id);

const unit = (name, faction, col, row, extra = {}) => ({
  name,
  faction,
  col,
  row,
  currentHP: 30,
  stats: { HP: 30, STR: 10, MOV: 5 },
  ...extra,
});

function run(artId, defenderAffixes) {
  const attacker = unit('Lancer', 'player', 1, 1);
  const defender = unit('Brute', 'enemy', 2, 1, { affixes: defenderAffixes });
  const units = [attacker, defender];
  const world = {
    affixes: data.affixes,
    cols: 8,
    rows: 8,
    getMoveCost: () => 1,
    getUnitAt: (col, row) => units.find((u) => u.col === col && u.row === row) || null,
    hostilesOf: (u) => units.filter((o) => o.faction !== u.faction),
    alliesOf: (u) => units.filter((o) => o.faction === u.faction),
    turnNumber: 1,
  };
  // One landed strike by the attacker: the hit gate every move art requires.
  const result = {
    events: [{ type: 'strike', attackerSide: 'attacker', miss: false, damage: 3 }],
  };
  for (const beat of postCombatEffects(
    { attacker, defender, result, attackerWeaponArt: art(artId) },
    world,
  ))
    void beat;
  return { attacker, defender };
}

describe('Anchored resists weapon-art displacement', () => {
  it('reads the flag from affix data, not from the affix id', () => {
    expect(isDisplacementImmune({ affixes: ['anchored'] }, data.affixes)).toBe(true);
    expect(isDisplacementImmune({ affixes: ['thorns'] }, data.affixes)).toBe(false);
    expect(isDisplacementImmune({ affixes: ['anchored'] }, null)).toBe(false);
  });

  it('a push (Overrun) moves a plain foe one tile but not an Anchored one', () => {
    expect(run('lance_overrun', []).defender).toMatchObject({ col: 3, row: 1 });
    expect(run('lance_overrun', ['anchored']).defender).toMatchObject({ col: 2, row: 1 });
  });

  it('a swap (Lunge) trades places with a plain foe but not with an Anchored one', () => {
    const plain = run('sword_lunge', []);
    expect([plain.attacker.col, plain.defender.col]).toEqual([2, 1]);
    const anchored = run('sword_lunge', ['anchored']);
    expect([anchored.attacker.col, anchored.defender.col]).toEqual([1, 2]);
  });

  it('moves of the attacker alone (Strike and Fade) still work beside an Anchored foe', () => {
    expect(run('lance_hit_and_run', ['anchored']).attacker).toMatchObject({ col: 0, row: 1 });
  });
});
