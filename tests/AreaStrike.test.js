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
  canStartAreaStrike,
  isAreaStrikeCenter,
  settleLeap,
} from '../src/engine/AreaStrike.js';
import { applyCondition } from '../src/engine/StatusConditionSystem.js';
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

  it("aims by the art's weapon, and a refused center leaves the sword equipped", () => {
    const caster = sage();
    const tome = caster.weapon;
    const sword = weapon('Iron Sword');
    caster.inventory = [sword, tome];
    caster.weapon = sword;
    caster.proficiencies.push({ type: 'Sword', rank: 'Prof' });
    const foe = unit('Foe', 'enemy', 1, 3);
    const far = unit('Far', 'enemy', 4, 3, { RES: 6 });
    const battle = battleWith([caster, foe, far]);
    // Next to the caster: the sword reaches it, Breachbolt (3-10) doesn't.
    expect(battle.executeAreaStrike(caster, stormcall.id, { col: 1, row: 3 })).toBe(false);
    expect([caster.weapon?.name, caster.currentHP, foe.currentHP]).toEqual(['Iron Sword', 40, 30]);
    // Four tiles out: past the sword, inside Breachbolt. The strike equips the tome.
    expect(battle.executeAreaStrike(caster, stormcall.id, { col: 4, row: 3 })).toBe(true);
    expect([caster.weapon?.name, far.currentHP]).toEqual(['Breachbolt', 11]);
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

// Doomblade's Lionheart Thrust, the leap (docs/specs/legendary-arts-rework.md §5): the catalog art.
describe('a leap: the center is where the user lands', () => {
  const doomThrust = data.weaponArts.arts.find((a) => a.id === 'legend_doom_thrust');
  const lancer = (col = 2, row = 3, stats = {}) => {
    // Doomblade: 12 might, range 1-2.
    const lance = weapon('Doomblade');
    return unit(
      'Lancer',
      'player',
      col,
      row,
      { STR: 20, HP: 40, ...stats },
      {
        weapon: lance,
        inventory: [lance],
        weaponRank: 'Mast',
        proficiencies: [{ type: 'Lance', rank: 'Mast' }],
        _gambitUsedThisTurn: true,
        isCommander: true,
      },
    );
  };
  const world = (extra = {}) => ({ cols: 16, rows: 8, getMoveCost: () => 1, ...extra });

  it('lands within 2 on ground it can stand on, never its own tile; the choices skip known units', () => {
    const user = lancer(2, 3);
    const pairs = (tiles) => tiles.map((t) => `${t.col},${t.row}`).sort();
    // The radius-2 diamond around (2,3), minus (2,3): 12 tiles.
    expect(areaStrikeCenters(user, doomThrust, world())).toHaveLength(12);
    // Water (impassable to infantry) at (4,3) is not a landing.
    const wet = world({ getMoveCost: (c, r) => (c === 4 && r === 3 ? Infinity : 1) });
    expect(pairs(areaStrikeCenters(user, doomThrust, wet))).not.toContain('4,3');
    // A tile the caller knows is taken is not offered; the real board decides later.
    const taken = (c, r) => (c === 3 && r === 3 ? { name: 'Known' } : null);
    expect(pairs(areaStrikeCenters(user, doomThrust, world(), user.weapon, { occupiedAt: taken }))).not.toContain('3,3'); // prettier-ignore
    expect(isAreaStrikeCenter(user, doomThrust, { col: 4, row: 3 }, world())).toBe(true);
    expect(isAreaStrikeCenter(user, doomThrust, { col: 5, row: 3 }, world())).toBe(false);
    expect(isAreaStrikeCenter(user, doomThrust, { col: 2, row: 3 }, world())).toBe(false);
  });

  it('a rooted user cannot leap', () => {
    const user = lancer(2, 3);
    applyCondition(user, 'root', 2);
    expect(canStartAreaStrike(user, user.weapon, doomThrust, world())).toBe(false);
    expect(isAreaStrikeCenter(user, doomThrust, { col: 4, row: 3 }, world())).toBe(false);
  });

  it('through the harness: lands, then every foe beside the landing takes 80%, no counter', () => {
    const user = lancer(2, 3);
    // Blow: STR 20 + Mt 12 + Atk 6 - DEF 4 = 34, × 0.8 = 27. No triangle (no weapons).
    const east = unit('East', 'enemy', 5, 3, { DEF: 4, HP: 40 });
    const north = unit('North', 'enemy', 4, 2, { DEF: 4, HP: 40 });
    const far = unit('Far', 'enemy', 6, 3, { DEF: 4, HP: 40 });
    const battle = battleWith([user, east, north, far]);
    expect(battle.executeAreaStrike(user, 'legend_doom_thrust', { col: 4, row: 3 })).toBe(true);
    expect([user.col, user.row]).toEqual([4, 3]);
    expect([east.currentHP, north.currentHP, far.currentHP]).toEqual([13, 13, 40]);
    expect(user.currentHP).toBe(40 - 8); // the art's HP and nothing else
    expect(user.hasActed).toBe(true);
  });

  it('a unit on the landing (one the fog hid) fails it: the cost is spent, nothing moves or lands', () => {
    const user = lancer(2, 3);
    const hidden = unit('Hidden', 'enemy', 4, 3, { DEF: 4, HP: 40 });
    const beside = unit('Beside', 'enemy', 5, 3, { DEF: 4, HP: 40 });
    const battle = battleWith([user, hidden, beside]);
    expect(battle.executeAreaStrike(user, 'legend_doom_thrust', { col: 4, row: 3 })).toBe(true);
    expect([user.col, user.row]).toEqual([2, 3]);
    expect([hidden.currentHP, beside.currentHP]).toEqual([40, 40]);
    expect(user.currentHP).toBe(40 - 8);
    expect(user._battleWeaponArtUsage.map.legend_doom_thrust).toBe(1);
  });

  it('settleLeap reads only the board it is given', () => {
    const user = lancer(2, 3);
    const other = { name: 'Other', col: 4, row: 3, currentHP: 10 };
    expect(settleLeap(user, { col: 4, row: 3 }, () => other)).toMatchObject({
      landed: false,
      blocker: other,
    });
    expect([user.col, user.row]).toEqual([2, 3]);
    // A fallen unit still on the grid does not hold the tile.
    const fallen = { ...other, currentHP: 0 };
    expect(settleLeap(user, { col: 4, row: 3 }, () => fallen).landed).toBe(true);
    expect([user.col, user.row]).toEqual([4, 3]);
  });
});

// Starfall's volley (legendary-arts-rework §3): the catalog art, a chosen center 3-7 away.
describe("Starfall's falling-star volley", () => {
  const volley = data.weaponArts.arts.find((a) => a.id === 'legend_starfall_volley');
  it('aims 3 to 7 tiles away and lands 60% blows on the center and its four neighbours', () => {
    const bow = weapon('Starfall');
    const archer = unit(
      'Archer',
      'player',
      0,
      3,
      { STR: 20, HP: 40 },
      {
        weapon: bow,
        inventory: [bow],
        weaponRank: 'Mast',
        proficiencies: [{ type: 'Bow', rank: 'Mast' }],
        _gambitUsedThisTurn: true,
        isCommander: true,
      },
    );
    const w = { cols: 16, rows: 8, getMoveCost: () => 1 };
    expect(isAreaStrikeCenter(archer, volley, { col: 2, row: 3 }, w)).toBe(false);
    expect(isAreaStrikeCenter(archer, volley, { col: 3, row: 3 }, w)).toBe(true);
    expect(isAreaStrikeCenter(archer, volley, { col: 7, row: 3 }, w)).toBe(true);
    expect(isAreaStrikeCenter(archer, volley, { col: 8, row: 3 }, w)).toBe(false);
    // Blow: STR 20 + Mt 12 + Atk 3 - DEF 5 = 30, × 0.6 = 18.
    const hit = unit('Hit', 'enemy', 6, 3, { DEF: 5, HP: 40 });
    const side = unit('Side', 'enemy', 6, 4, { DEF: 5, HP: 40 });
    const out = unit('Out', 'enemy', 6, 5, { DEF: 5, HP: 40 });
    const battle = battleWith([archer, hit, side, out]);
    expect(battle.executeAreaStrike(archer, 'legend_starfall_volley', { col: 6, row: 3 })).toBe(
      true,
    );
    expect([hit.currentHP, side.currentHP, out.currentHP]).toEqual([22, 22, 40]);
  });
});
