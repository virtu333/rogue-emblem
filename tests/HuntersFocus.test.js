// Hunter's Focus came back from retirement as a self-buff (owner, 2026-10-13): the shot
// gets +10 Hit, and on a hit the archer alone keeps +15 Hit and +2 SPD until the end of
// its next turn. Driven through the real post-combat pipeline and the timed-buff expiry.
import { describe, expect, it } from 'vitest';
import { loadGameData } from './testData.js';
import { postCombatEffects } from '../src/engine/PostCombatEffects.js';
import { expireTimedBuffs, timedBuffCombatMods } from '../src/engine/TimedWeaponArtBuffs.js';
import { getWeaponArtCombatMods } from '../src/engine/WeaponArtSystem.js';

const data = loadGameData();
const focus = data.weaponArts.arts.find((a) => a.id === 'bow_hunters_focus');

const unit = (name, faction, col, row) => ({
  name,
  faction,
  col,
  row,
  currentHP: 30,
  stats: { HP: 30, STR: 8, SKL: 10, SPD: 8, MOV: 5 },
});

function shoot(missed = false) {
  const archer = unit('Archer', 'player', 1, 1);
  const ally = unit('Ally', 'player', 1, 2);
  const foe = unit('Foe', 'enemy', 3, 1);
  const units = [archer, ally, foe];
  const world = {
    affixes: data.affixes,
    cols: 8,
    rows: 8,
    getMoveCost: () => 1,
    getUnitAt: (col, row) => units.find((u) => u.col === col && u.row === row) || null,
    hostilesOf: (u) => units.filter((o) => o.faction !== u.faction),
    alliesOf: (u) => units.filter((o) => o.faction === u.faction),
    turnNumber: 3,
  };
  const result = {
    events: [{ type: 'strike', attackerSide: 'attacker', miss: missed, damage: missed ? 0 : 3 }],
  };
  for (const beat of postCombatEffects(
    { attacker: archer, defender: foe, result, attackerWeaponArt: focus },
    world,
  ))
    void beat;
  return { archer, ally, foe, units };
}

describe("Hunter's Focus", () => {
  it('is live again: +10 Hit on the shot itself', () => {
    expect(focus.legacy).toBeUndefined();
    expect(getWeaponArtCombatMods(focus).hitBonus).toBe(10);
  });

  it('on a hit, the archer alone gains +15 Hit and +2 SPD', () => {
    const { archer, ally, foe } = shoot();
    expect(timedBuffCombatMods(archer).hitBonus).toBe(15);
    expect(archer.stats.SPD).toBe(10);
    expect(ally._battleTimedWeaponArtBuffs ?? []).toHaveLength(0);
    expect(ally.stats.SPD).toBe(8);
    expect(foe._battleTimedWeaponArtBuffs ?? []).toHaveLength(0);
  });

  it('a miss buffs nobody', () => {
    const { archer } = shoot(true);
    expect(archer._battleTimedWeaponArtBuffs ?? []).toHaveLength(0);
  });

  it('lasts through the next player turn and ends as the one after begins', () => {
    const { archer, units } = shoot();
    // Shot on turn 3: the buff holds on turn 4's player phase...
    expireTimedBuffs(units, 'enemy', 3);
    expireTimedBuffs(units, 'player', 4);
    expect(timedBuffCombatMods(archer).hitBonus).toBe(15);
    expireTimedBuffs(units, 'enemy', 4);
    // ...and is gone when turn 5's player phase starts.
    expireTimedBuffs(units, 'player', 5);
    expect(timedBuffCombatMods(archer).hitBonus ?? 0).toBe(0);
    expect(archer.stats.SPD).toBe(8);
  });
});
