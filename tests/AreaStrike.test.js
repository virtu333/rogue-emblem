// AreaStrike: a chosen-center weapon art (docs/specs/aoe-weapon-arts.md §6) in the engine
// and the headless harness. A fixture art shaped like Stormcall (Breachbolt's; the real
// art ships with the scene's targeting flow): aim within the weapon's range, radius 1,
// 0.8 of the art's own blow to each foe, no hit roll, no counter. Numbers are worked by
// hand from catalog stats quoted inline.
import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ default: { Scene: class {} } }));
import { loadGameData } from './testData.js';
import {
  areaStrikeCenters,
  areaStrikeEffects,
  isAreaStrikeCenter,
} from '../src/engine/AreaStrike.js';
import { HeadlessBattle } from './harness/HeadlessBattle.js';

const data = loadGameData();
const weapon = (name) => structuredClone(data.weapons.find((w) => w.name === name));

const stormcall = {
  id: 'fixture_stormcall',
  name: 'Fixture Stormcall',
  weaponType: 'Tome',
  allowedTypes: ['Tome'],
  tierAffinity: 'Silver',
  unlockAct: 'act1',
  requiredRank: 'Prof',
  hpCost: 8,
  perMapLimit: 2,
  targeting: 'chosen_center',
  area: {
    shape: 'radius',
    radius: 1,
    damage: { kind: 'scaled', multiplier: 0.8 },
    centerRange: 'weapon',
  },
  allowedFactions: ['player'],
  description: 'Fixture.',
  combatMods: {},
};

const unit = (name, faction, col, row, stats = {}, extra = {}) => ({
  name,
  faction,
  col,
  row,
  level: 5,
  tier: 'base',
  moveType: 'Infantry',
  currentHP: stats.HP ?? 30,
  stats: { HP: 30, STR: 0, MAG: 0, SKL: 0, SPD: 0, DEF: 0, RES: 0, LCK: 0, MOV: 5, ...stats },
  skills: [],
  accessory: null,
  ...extra,
});

function battleWith(units) {
  const gameData = structuredClone(data);
  gameData.weaponArts.arts.push(stormcall);
  const battle = new HeadlessBattle(gameData, { act: 'act1', objective: 'rout' });
  battle.turnManager = { turnNumber: 1, unitActed() {} };
  battle.battleConfig = { objective: 'rout' };
  battle.playerUnits = units.filter((u) => u.faction === 'player');
  battle.enemyUnits = units.filter((u) => u.faction === 'enemy');
  battle.npcUnits = [];
  battle.grid = {
    cols: 16,
    rows: 8,
    fogEnabled: false,
    getTerrainAt: () => ({}),
    getMoveCost: () => 1,
    updateFogOfWar() {},
  };
  battle.turnPar = 99;
  return battle;
}

function sage(col = 0, row = 3) {
  // Breachbolt: 8 might, range 3-10.
  const tome = { ...weapon('Breachbolt'), weaponArtIds: [stormcall.id] };
  return unit(
    'Sage',
    'player',
    col,
    row,
    { MAG: 22, HP: 40 },
    {
      weapon: tome,
      inventory: [tome],
      weaponRank: 'Mast',
      proficiencies: [{ type: 'Tome', rank: 'Mast' }],
      _gambitUsedThisTurn: true,
      isCommander: true,
    },
  );
}

describe('aiming', () => {
  it('reaches exactly the weapon range (Breachbolt 3-10)', () => {
    const caster = sage(0, 3);
    const world = { cols: 16, rows: 8, getMoveCost: () => 1 };
    expect(isAreaStrikeCenter(caster, stormcall, { col: 2, row: 3 }, world)).toBe(false);
    expect(isAreaStrikeCenter(caster, stormcall, { col: 3, row: 3 }, world)).toBe(true);
    expect(isAreaStrikeCenter(caster, stormcall, { col: 10, row: 3 }, world)).toBe(true);
    expect(isAreaStrikeCenter(caster, stormcall, { col: 11, row: 3 }, world)).toBe(false);
    expect(
      areaStrikeCenters(caster, stormcall, world).every((t) => {
        const d = Math.abs(t.col) + Math.abs(t.row - 3);
        return d >= 3 && d <= 10;
      }),
    ).toBe(true);
  });
});

describe('a chosen-center strike through the harness', () => {
  it('hits every foe in the blast with its own blow, never an ally, with no counter', () => {
    const caster = sage();
    // Breachbolt 8 + MAG 22 − RES 6 = 24, × 0.8 = 19.
    const center = unit('Center', 'enemy', 4, 3, { RES: 6 }, { weapon: weapon('Iron Lance') });
    const side = unit('Side', 'enemy', 4, 4, { RES: 6 });
    const outside = unit('Outside', 'enemy', 6, 3, { RES: 6 });
    const friend = unit('Friend', 'player', 4, 2);
    const battle = battleWith([caster, center, side, outside, friend]);
    expect(battle.executeAreaStrike(caster, stormcall.id, { col: 4, row: 3 })).toBe(true);
    expect([center, side, outside, friend].map((u) => u.currentHP)).toEqual([11, 11, 30, 30]);
    // The art's 8 HP and nothing else: no counter from the lance-wielder at the center.
    expect(caster.currentHP).toBe(32);
    expect(caster._battleWeaponArtUsage.map[stormcall.id]).toBe(1);
    expect(caster.hasActed).toBe(true);
  });

  it('a kill is removed and pays XP, the best credit counting as the primary', () => {
    const caster = sage();
    const frail = unit('Frail', 'enemy', 4, 3, { RES: 6, HP: 10 });
    const sturdy = unit('Sturdy', 'enemy', 4, 4, { RES: 6 });
    const battle = battleWith([caster, frail, sturdy]);
    const granted = [];
    battle._grantScaledXP = (u, xp) => granted.push([u.name, xp]);
    battle.executeAreaStrike(caster, stormcall.id, { col: 4, row: 3 });
    expect(battle.enemyUnits).toEqual([sturdy]);
    // Frail (a kill, 25 + 15 = 40) is the primary; Sturdy took 19 of 30:
    // 25 × 19/30 × 0.35 = 5.5 → 5. Total 45.
    expect(granted).toEqual([['Sage', 45]]);
  });

  it('an out-of-range center spends nothing', () => {
    const caster = sage();
    const foe = unit('Foe', 'enemy', 1, 3);
    const battle = battleWith([caster, foe]);
    expect(battle.executeAreaStrike(caster, stormcall.id, { col: 1, row: 3 })).toBe(false);
    expect([caster.currentHP, foe.currentHP, caster.hasActed]).toEqual([40, 30, undefined]);
  });

  it('draws no random number (exact on resume, no hit roll)', () => {
    const caster = sage();
    const foe = unit('Foe', 'enemy', 4, 3, { RES: 6 });
    const world = {
      cols: 16,
      rows: 8,
      getMoveCost: () => 1,
      getTerrainAt: () => null,
      hostilesOf: () => [foe],
    };
    const spy = vi.spyOn(Math, 'random');
    try {
      for (const beat of areaStrikeEffects({
        unit: caster,
        art: stormcall,
        center: { col: 4, row: 3 },
        world,
      }))
        void beat;
    } finally {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
    expect(foe.currentHP).toBe(11);
  });
});
