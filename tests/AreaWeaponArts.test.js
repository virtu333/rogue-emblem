// Area weapon arts end to end in the engine: a real resolveCombat feeds the post-combat
// pipeline, and the area blow lands on each victim against its own defences
// (docs/specs/aoe-weapon-arts.md §2). Expected numbers are worked by hand from catalog
// stats quoted inline.
import { describe, expect, it } from 'vitest';
import { loadGameData } from './testData.js';
import { resolveCombat } from '../src/engine/Combat.js';
import { getWeaponArtCombatMods } from '../src/engine/WeaponArtSystem.js';
import { postCombatEffects } from '../src/engine/PostCombatEffects.js';
import { AREA_EFFECTIVENESS_CAP, planAreaBlows } from '../src/engine/AreaDamage.js';
import { validateCrossReferences } from '../tools/validateCrossReferences.js';

const data = loadGameData();
const weapon = (name) => structuredClone(data.weapons.find((w) => w.name === name));
const art = (id) => data.weaponArts.arts.find((a) => a.id === id);
const forest = data.terrain.find((t) => t.name === 'Forest');

const unit = (name, faction, col, row, stats = {}, extra = {}) => ({
  name,
  faction,
  col,
  row,
  level: 5,
  moveType: 'Infantry',
  weaponRank: 'Prof',
  currentHP: stats.HP ?? 40,
  stats: { HP: 40, STR: 0, MAG: 0, SKL: 0, SPD: 0, DEF: 0, RES: 0, LCK: 0, MOV: 5, ...stats },
  ...extra,
});

function worldOf(units, { terrainAt = () => null } = {}) {
  return {
    affixes: data.affixes,
    cols: 8,
    rows: 8,
    getMoveCost: () => 1,
    getTerrainAt: terrainAt,
    getUnitAt: (col, row) => units.find((u) => u.col === col && u.row === row) || null,
    hostilesOf: (u) => units.filter((o) => o.faction !== u.faction && o.faction !== 'npc'),
    alliesOf: (u) => units.filter((o) => o.faction === u.faction),
    turnNumber: 1,
  };
}

/** Resolve a real combat with the art, then run its post-combat effects. */
function strike(attacker, defender, artId, units, { random = () => 0.01, world } = {}) {
  const prev = Math.random;
  const distance = Math.abs(attacker.col - defender.col) + Math.abs(attacker.row - defender.row);
  Math.random = random;
  let result;
  try {
    result = resolveCombat(
      attacker,
      attacker.weapon,
      defender,
      defender.weapon,
      distance,
      null,
      null,
      {
        atkWeaponArtMods: getWeaponArtCombatMods(art(artId)),
      },
    );
  } finally {
    Math.random = prev;
  }
  defender.currentHP = result.defenderHP;
  attacker.currentHP = result.attackerHP;
  const beats = [
    ...postCombatEffects(
      { attacker, defender, result, attackerWeaponArt: art(artId) },
      world || worldOf(units),
    ),
  ];
  return { result, beats };
}

describe('Splash v2: each victim takes its own blow', () => {
  // Burning Quake: Fire (4 might) + the art's +10 Hit; area ×0.6. MAG 20.
  const mage = () => unit('Mage', 'player', 1, 1, { MAG: 20, SKL: 20 }, { weapon: weapon('Fire') });

  it("a neighbour identical to the primary takes today's splash: 0.6 × the non-crit hit", () => {
    const caster = mage();
    const primary = unit('Primary', 'enemy', 2, 1, { RES: 4, LCK: 30 });
    const twin = unit('Twin', 'enemy', 3, 1, { RES: 4, LCK: 30 });
    const { result } = strike(caster, primary, 'magic_burning_quake', [caster, primary, twin]);
    // 20 + 4 − 4 = 20 on the primary; 0.6 × 20 = 12 on the twin.
    expect(result.events[0]).toMatchObject({ miss: false, isCrit: false, damage: 20 });
    expect(twin.currentHP).toBe(40 - 12);
  });

  it('a crit on the primary no longer feeds the splash', () => {
    const caster = unit('Mage', 'player', 1, 1, { MAG: 20, SKL: 80 }, { weapon: weapon('Fire') });
    const primary = unit('Primary', 'enemy', 2, 1, { RES: 4 });
    const twin = unit('Twin', 'enemy', 3, 1, { RES: 4 });
    const { result } = strike(caster, primary, 'magic_burning_quake', [caster, primary, twin]);
    expect(result.events[0].isCrit).toBe(true);
    // Today's basis would be the critted 60; the area blow stays 0.6 × 20 = 12.
    expect(twin.currentHP).toBe(40 - 12);
  });

  it("reads the victim's own RES and terrain, and the attacker's flat skill mods", () => {
    const caster = mage();
    const primary = unit('Primary', 'enemy', 2, 1, { RES: 4, LCK: 30 });
    const warded = unit('Warded', 'enemy', 2, 0, { RES: 10 });
    const sheltered = unit('Sheltered', 'enemy', 3, 1, { RES: 3 });
    const units = [caster, primary, warded, sheltered];
    const world = worldOf(units, {
      terrainAt: (col, row) => (col === 3 && row === 1 ? forest : null),
    });
    const prev = Math.random;
    Math.random = () => 0.01;
    let result;
    try {
      result = resolveCombat(caster, caster.weapon, primary, null, 1, null, null, {
        atkMods: { atkBonus: 3 },
        atkWeaponArtMods: getWeaponArtCombatMods(art('magic_burning_quake')),
      });
    } finally {
      Math.random = prev;
    }
    for (const beat of postCombatEffects(
      {
        attacker: caster,
        defender: primary,
        result,
        attackerWeaponArt: art('magic_burning_quake'),
      },
      world,
    ))
      void beat;
    // +3 Attack from a skill reaches the area blow:
    // Warded: (20 + 4 + 3 − 10) × 0.6 = 10.2 → 10. Sheltered on a forest (DEF +1 is
    // terrain DEF, which a magic blow also pays): (20 + 4 + 3 − 3 − 1) × 0.6 = 13.8 → 13
    // (14 on open ground).
    expect(warded.currentHP).toBe(30);
    expect(sheltered.currentHP).toBe(27);
    expect(result.areaCredits.map((c) => [c.victim.name, c.damage, c.killed])).toEqual([
      ['Warded', 10, false],
      ['Sheltered', 13, false],
    ]);
  });

  it('Tempest reaches fliers in the area, capped at 3×', () => {
    expect(AREA_EFFECTIVENESS_CAP).toBe(3);
    const sage = unit('Sage', 'player', 1, 1, { MAG: 20 }, { weapon: weapon('Firstwind') });
    const primary = unit('Primary', 'enemy', 2, 1, { RES: 5 });
    const pegasus = unit('Pegasus', 'enemy', 3, 1, { RES: 5 }, { moveType: 'Flying' });
    const plan = planAreaBlows({
      source: sage,
      primary,
      area: { shape: 'radius', radius: 1, damage: { kind: 'scaled', multiplier: 0.75 } },
      units: [primary, pegasus],
      world: worldOf([sage, primary, pegasus]),
      strikeMods: getWeaponArtCombatMods(art('legend_tempest')),
    });
    // Firstwind 12 × 3 + MAG 20 + Tempest's +5 − RES 5 = 56; × 0.75 = 42.
    // (At the primary's 5× cap it would be (60 + 20) × 0.75 = 60.)
    expect(plan.map((p) => [p.unit.name, p.damage])).toEqual([['Pegasus', 42]]);
  });

  it('never hits allies, green units or the primary, and a blast needs its user alive', () => {
    const caster = mage();
    const primary = unit('Primary', 'enemy', 2, 1, { RES: 4, LCK: 30 });
    const ally = unit('Ally', 'player', 1, 0);
    const villager = unit('Villager', 'npc', 2, 2);
    const units = [caster, primary, ally, villager];
    strike(caster, primary, 'magic_burning_quake', units);
    expect([ally.currentHP, villager.currentHP]).toEqual([40, 40]);
    expect(primary.currentHP).toBe(40 - 20);

    const fallen = mage();
    const foe = unit('Foe', 'enemy', 2, 1, { RES: 4, LCK: 30 });
    const neighbour = unit('Neighbour', 'enemy', 3, 1, { RES: 4 });
    const result = {
      events: [{ type: 'strike', attackerSide: 'attacker', miss: false, damage: 20 }],
    };
    fallen.currentHP = 0;
    for (const beat of postCombatEffects(
      { attacker: fallen, defender: foe, result, attackerWeaponArt: art('magic_burning_quake') },
      worldOf([fallen, foe, neighbour]),
    ))
      void beat;
    expect(neighbour.currentHP).toBe(40);
  });
});

describe('Lines', () => {
  it('a line never touches a foe between the attacker and its target', () => {
    // Doomblade 1-2: a range-2 thrust over a foe standing in between.
    const lancer = unit('Lancer', 'player', 0, 1, { STR: 12 }, { weapon: weapon('Doomblade') });
    const between = unit('Between', 'enemy', 1, 1, { DEF: 5 });
    const target = unit('Target', 'enemy', 2, 1, { DEF: 5, LCK: 30 });
    const behind = unit('Behind', 'enemy', 3, 1, { DEF: 5 });
    const units = [lancer, between, target, behind];
    strike(lancer, target, 'legend_doom_thrust', units);
    // Doomblade 12 + STR 12 + the art's +8 − DEF 5 = 27, on the target and once behind.
    expect([between.currentHP, target.currentHP, behind.currentHP]).toEqual([40, 13, 13]);
    // Its push needs adjacency, so at range 2 the target stays where it is.
    expect(target.col).toBe(2);
  });
});

describe('Validators', () => {
  it('refuse the retired splash and pierce keys and a chosen-center art the AI could hold', () => {
    const arts = structuredClone(data.weaponArts);
    const quake = arts.arts.find((a) => a.id === 'magic_burning_quake');
    quake.effects = { aoeSplash: { radius: 1 } };
    const doom = arts.arts.find((a) => a.id === 'legend_doom_thrust');
    doom.effects.afterCombat.push({ type: 'pierce_through', target: 'defender' });
    const bolt = arts.arts.find((a) => a.id === 'legend_cataclysm_bolt');
    bolt.targeting = 'chosen_center';
    bolt.allowedFactions = ['player', 'enemy'];
    const { errors } = validateCrossReferences({ ...data, weaponArts: arts });
    expect(errors.some((e) => e.includes('magic_burning_quake') && e.includes('aoeSplash'))).toBe(
      true,
    );
    expect(errors.some((e) => e.includes('legend_doom_thrust') && e.includes('pierce'))).toBe(true);
    expect(
      errors.some((e) => e.includes('legend_cataclysm_bolt') && e.includes('centerRange')),
    ).toBe(true);
    expect(
      errors.some((e) => e.includes('legend_cataclysm_bolt') && e.includes('player only')),
    ).toBe(true);
    expect(validateCrossReferences(data).errors).toEqual([]);
  });
});
