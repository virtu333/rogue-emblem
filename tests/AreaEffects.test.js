// The new area effects in the engine (docs/specs/aoe-weapon-arts.md §4), driven through
// the real post-combat pipeline with fixture arts: a sweep around the attacker, a ram
// that collides, and a heal for allies beside the user. Expected numbers are worked by
// hand from catalog stats quoted inline.
import { describe, expect, it } from 'vitest';
import { loadGameData } from './testData.js';
import { postCombatEffects } from '../src/engine/PostCombatEffects.js';
import { applyCondition } from '../src/engine/StatusConditionSystem.js';
import { weaponArtDetailLines } from '../src/ui/weaponArtDisplay.js';

const data = loadGameData();
const weapon = (name) => structuredClone(data.weapons.find((w) => w.name === name));

const unit = (name, faction, col, row, stats = {}, extra = {}) => ({
  name,
  faction,
  col,
  row,
  level: 5,
  moveType: 'Infantry',
  currentHP: stats.HP ?? 30,
  stats: { HP: 30, STR: 0, MAG: 0, SKL: 0, SPD: 0, DEF: 0, RES: 0, LCK: 0, MOV: 5, ...stats },
  ...extra,
});

function run(art, attacker, defender, units, { events, startHP, walls = [] } = {}) {
  const result = {
    events: events || [{ type: 'strike', attackerSide: 'attacker', miss: false, damage: 1 }],
    ...(startHP ? { startHP } : {}),
  };
  const world = {
    affixes: data.affixes,
    cols: 8,
    rows: 8,
    getMoveCost: (col, row) => (walls.some(([c, r]) => c === col && r === row) ? Infinity : 1),
    getTerrainAt: () => null,
    getUnitAt: (col, row) =>
      units.find((u) => u.col === col && u.row === row && u.currentHP > 0) || null,
    hostilesOf: (u) => units.filter((o) => o.faction !== u.faction && o.faction !== 'npc'),
    alliesOf: (u) => units.filter((o) => o.faction === u.faction),
    turnNumber: 1,
  };
  const beats = [
    ...postCombatEffects({ attacker, defender, result, attackerWeaponArt: art }, world),
  ];
  return { beats, result };
}

describe('Sweeping Cleave shape: around the attacker', () => {
  const cleave = {
    id: 'fixture_cleave',
    targeting: 'normal_attack',
    area: { shape: 'around_attacker', radius: 1, damage: { kind: 'scaled', multiplier: 0.5 } },
    combatMods: { hitBonus: 5 },
  };

  it('hits every other foe next to the attacker, not the target and not foes further off', () => {
    // Iron Axe 7 + STR 12 − DEF 4 = 15, × 0.5 = 7.
    const axe = unit('Axe', 'player', 2, 2, { STR: 12 }, { weapon: weapon('Iron Axe') });
    const target = unit('Target', 'enemy', 3, 2, { DEF: 4 });
    const north = unit('North', 'enemy', 2, 1, { DEF: 4 });
    const west = unit('West', 'enemy', 1, 2, { DEF: 4 });
    const far = unit('Far', 'enemy', 4, 2, { DEF: 4 });
    const ally = unit('Ally', 'player', 2, 3);
    run(cleave, axe, target, [axe, target, north, west, far, ally]);
    expect([target, north, west, far, ally].map((u) => u.currentHP)).toEqual([30, 23, 23, 30, 30]);
  });
});

describe('Battering Ram: push up to two tiles, crash when stopped short', () => {
  const ram = {
    id: 'fixture_ram',
    targeting: 'normal_attack',
    effects: { afterCombat: [{ type: 'move', mode: 'ram', distance: 2, collisionDamage: 5 }] },
    combatMods: {},
  };
  const lancer = () => unit('Lancer', 'player', 1, 1);
  const target = (extra = {}) => unit('Target', 'enemy', 2, 1, {}, extra);

  it('slides two tiles on open ground, no crash', () => {
    const a = lancer();
    const t = target();
    const { beats } = run(ram, a, t, [a, t]);
    expect([t.col, t.row, t.currentHP]).toEqual([4, 1, 30]);
    expect(beats.some((b) => b.kind === 'hint')).toBe(false);
  });

  it('stops before a wall after one tile and crashes for 5', () => {
    const a = lancer();
    const t = target();
    run(ram, a, t, [a, t], { walls: [[4, 1]] });
    expect([t.col, t.currentHP]).toEqual([3, 25]);
  });

  it('crashes into a foe: both take 5, the foe leaves a credit, a fallen foe is removed', () => {
    const a = lancer();
    const t = target();
    const foe = unit('Foe', 'enemy', 3, 1, { HP: 4 });
    const { beats, result } = run(ram, a, t, [a, t, foe]);
    expect([t.col, t.currentHP, foe.currentHP]).toEqual([2, 25, 0]);
    expect(result.areaCredits).toEqual([
      { source: a, victim: foe, damage: 4, hpBefore: 4, killed: true },
    ]);
    // The foe falls here; the target (the combat's primary) is left to its owner.
    expect(beats.filter((b) => b.kind === 'remove').map((b) => b.unit.name)).toEqual(['Foe']);
  });

  it('a crash into an ally of the user hurts only the target', () => {
    const a = lancer();
    const t = target();
    const friend = unit('Friend', 'player', 3, 1);
    run(ram, a, t, [a, t, friend]);
    expect([t.currentHP, friend.currentHP]).toEqual([25, 30]);
  });

  it('rooted, Anchored and Entity targets brace: no move, no crash', () => {
    const rooted = target();
    applyCondition(rooted, 'root', 2, { recoveryChance: 0 });
    const anchored = target({ affixes: ['anchored'] });
    const entity = target({ isEntity: true });
    for (const t of [rooted, anchored, entity]) {
      const a = lancer();
      const { beats } = run(ram, a, t, [a, t], { walls: [[3, 1]] });
      expect([t.col, t.currentHP], t.name).toEqual([2, 30]);
      expect(beats.some((b) => b.kind === 'hint' && b.text === 'Braced!')).toBe(true);
    }
  });

  it('from range 2 nothing moves and nothing braces, Anchored or not', () => {
    for (const extra of [{}, { affixes: ['anchored'] }]) {
      const a = unit('Lancer', 'player', 0, 1);
      const t = target(extra);
      const { beats } = run(ram, a, t, [a, t]);
      expect([t.col, t.currentHP]).toEqual([2, 30]);
      expect(beats.some((b) => b.kind === 'hint')).toBe(false);
    }
  });

  it('reads as one row', () => {
    expect(weaponArtDetailLines({ ...ram, name: 'Ram', hpCost: 6 }).join('\n')).toContain(
      'ram the target back up to 2 tiles (only when next to it); if blocked, it and any foe it hits take 5',
    );
  });
});

describe('Benediction: allies beside the user heal a share of the damage dealt', () => {
  const benediction = {
    id: 'fixture_benediction',
    targeting: 'normal_attack',
    effects: { allyHeal: { radius: 1, percentOfDamage: 50 } },
    combatMods: {},
  };
  const twoHits = [
    { type: 'strike', attackerSide: 'attacker', miss: false, damage: 8 },
    { type: 'strike', attackerSide: 'attacker', miss: false, damage: 8 },
  ];

  it('heals each adjacent ally 50% of what the target lost (overkill excluded)', () => {
    const priest = unit('Priest', 'player', 2, 2, {}, { currentHP: 10 });
    const target = unit('Target', 'enemy', 3, 2);
    const beside = unit('Beside', 'player', 2, 1, {}, { currentHP: 10 });
    const away = unit('Away', 'player', 2, 4, {}, { currentHP: 10 });
    const wounded = unit('Wounded', 'player', 1, 2, {}, { currentHP: 10 });
    applyCondition(wounded, 'wounded', 2, { recoveryChance: 0 });
    // 16 dealt but the target entered with 10 HP: 50% of 10 = 5.
    run(benediction, priest, target, [priest, target, beside, away, wounded], {
      events: twoHits,
      startHP: { attacker: 10, defender: 10 },
    });
    expect([beside, away, wounded, priest].map((u) => u.currentHP)).toEqual([15, 10, 10, 10]);
  });

  it('heals nothing on a miss', () => {
    const priest = unit('Priest', 'player', 2, 2);
    const target = unit('Target', 'enemy', 3, 2);
    const beside = unit('Beside', 'player', 2, 1, {}, { currentHP: 10 });
    run(benediction, priest, target, [priest, target, beside], {
      events: [{ type: 'strike', attackerSide: 'attacker', miss: true, damage: 8 }],
    });
    expect(beside.currentHP).toBe(10);
  });
});

describe('the shipped area arts (catalog)', () => {
  const catalog = (id) => data.weaponArts.arts.find((a) => a.id === id);

  it("Sweeping Cleave and Skewer are open to any side; Benediction and Battering Ram are the player's", () => {
    // No enemy knockback (owner decision 2026-10-01).
    expect(catalog('axe_sweeping_cleave').allowedFactions).toBeUndefined();
    expect(catalog('lance_skewer').allowedFactions).toBeUndefined();
    expect(catalog('light_benediction').allowedFactions).toEqual(['player']);
    expect(catalog('lance_battering_ram').allowedFactions).toEqual(['player']);
  });

  it('each is taught by a scroll that drops in acts 2-3', () => {
    const teaches = (id) => data.weapons.find((w) => w.teachesWeaponArtId === id)?.name;
    for (const [id, acts] of [
      ['axe_sweeping_cleave', ['act2', 'act3']],
      ['lance_skewer', ['act2', 'act3']],
      ['light_benediction', ['act3']],
      ['lance_battering_ram', ['act3']],
    ]) {
      const scroll = teaches(id);
      expect(scroll, id).toBe(`${catalog(id).name} Scroll`);
      for (const act of acts)
        expect(data.lootTables[act].weaponArtScroll, `${id} ${act}`).toContain(scroll);
    }
  });

  it('the shipped Sweeping Cleave lands as its fixture did', () => {
    // Iron Axe 7 + STR 12 − DEF 4 = 15, × 0.5 = 7.
    const axe = unit('Axe', 'player', 2, 2, { STR: 12 }, { weapon: weapon('Iron Axe') });
    const target = unit('Target', 'enemy', 3, 2, { DEF: 4 });
    const north = unit('North', 'enemy', 2, 1, { DEF: 4 });
    run(catalog('axe_sweeping_cleave'), axe, target, [axe, target, north]);
    expect(north.currentHP).toBe(23);
  });

  it('every shipped area art explains itself in its rows', () => {
    for (const id of [
      'axe_sweeping_cleave',
      'lance_skewer',
      'light_benediction',
      'lance_battering_ram',
    ]) {
      const text = weaponArtDetailLines(catalog(id)).join('\n');
      expect(text, id).toMatch(/Area: |heal 50%|ram the target back up to 2 tiles/);
    }
  });
});
