// engine/Prologue.js: the battle config a chapter fights on, the beat matcher, and the
// authored units (docs/specs/prologue-chapter.md §8-9).
import { afterEach, describe, expect, it } from 'vitest';
import { loadGameData } from './testData.js';
import {
  buildPrologueBattleConfig,
  buildPrologueUnit,
  buildPrologueUnits,
  forecastConcepts,
  parsePrologueMap,
  prologueBeatsFor,
  prologueUnitRng,
} from '../src/engine/Prologue.js';
import { createBattleRng } from '../src/engine/BattleRng.js';
import { validateBattleConfig } from '../src/engine/MapGenerator.js';
import {
  canEquip,
  getCombatWeapons,
  getStaffWeapon,
  hasStaff,
  isUnarmed,
} from '../src/engine/UnitManager.js';
import {
  getCombatForecast,
  getStaffMaxUses,
  getStaffRemainingUses,
  resolveHeal,
} from '../src/engine/Combat.js';
import { getTurnStartEffects } from '../src/engine/SkillSystem.js';

const data = loadGameData();
const realRandom = Math.random;
afterEach(() => {
  Math.random = realRandom;
});

/** Math.random that fails the test if anything draws from it. */
function forbidMathRandom() {
  Math.random = () => {
    throw new Error('Math.random was drawn');
  };
}

// Hand-written expectations use the save-critical TERRAIN order (constants.js) by number.
const PLAIN = 0;
const FOREST = 1;
const MOUNTAIN = 2;
const FORT = 3;
const THRONE = 4;
const WALL = 5;
const WATER = 6;
const BRIDGE = 7;
const VILLAGE = 9;
const LAVA = 11;

function chapter(overrides = {}) {
  return {
    id: 'test_chapter',
    node: 'prologue_9',
    title: 'Test',
    objective: 'rout',
    map: {
      legend: { '.': 'Plain', F: 'Forest', T: 'Fort', '~': 'Water', '=': 'Bridge' },
      rows: ['. F T ~', '. . = ~', 'F . . .'],
    },
    playerSpawns: [{ col: 0, row: 0 }],
    enemies: [
      { id: 'a', className: 'Fighter', level: 2, col: 3, row: 2, weapon: 'Hand Axe', skills: [] },
    ],
    npc: null,
    villageTile: null,
    loot: null,
    beats: [],
    ...overrides,
  };
}

describe('buildPrologueBattleConfig', () => {
  it('turns the ASCII map into TERRAIN indices, row by row', () => {
    const config = buildPrologueBattleConfig(chapter(), data.terrain);
    expect(config.cols).toBe(4);
    expect(config.rows).toBe(3);
    expect(config.mapLayout).toEqual([
      [PLAIN, FOREST, FORT, WATER],
      [PLAIN, PLAIN, BRIDGE, WATER],
      [FOREST, PLAIN, PLAIN, PLAIN],
    ]);
  });

  it('reads every terrain name through terrain.json, multi-word names included', () => {
    const config = buildPrologueBattleConfig(
      chapter({
        map: {
          legend: { M: 'Mountain', G: 'Throne', '#': 'Wall', V: 'Village', L: 'Lava Crack' },
          rows: ['M G # V L'],
        },
        playerSpawns: [{ col: 3, row: 0 }],
        enemies: [
          {
            id: 'a',
            className: 'Fighter',
            level: 1,
            col: 1,
            row: 0,
            weapon: 'Iron Axe',
            skills: [],
          },
        ],
      }),
      data.terrain,
    );
    expect(config.mapLayout).toEqual([[MOUNTAIN, THRONE, WALL, VILLAGE, LAVA]]);
  });

  it('has the shape a generated battle has, with the authored kit on its spawns', () => {
    const config = buildPrologueBattleConfig(
      chapter({
        enemies: [
          {
            id: 'a',
            className: 'Fighter',
            level: 2,
            col: 3,
            row: 2,
            weapon: 'Hand Axe',
            skills: [],
          },
          {
            id: 'b',
            className: 'Soldier',
            level: 1,
            col: 1,
            row: 2,
            weapon: 'Javelin',
            skills: ['luna'],
            aiMode: 'hold',
            holdPack: 0,
            holdPackSize: 1,
          },
        ],
      }),
      data.terrain,
    );
    expect(config.objective).toBe('rout');
    expect(config.templateId).toBe('prologue:test_chapter');
    expect(config.prologueChapter).toBe('test_chapter');
    expect(config.playerSpawns).toEqual([{ col: 0, row: 0 }]);
    expect(config.enemySpawns).toEqual([
      {
        className: 'Fighter',
        level: 2,
        col: 3,
        row: 2,
        authoredId: 'a',
        weapon: 'Hand Axe',
        skills: [],
      },
      {
        className: 'Soldier',
        level: 1,
        col: 1,
        row: 2,
        authoredId: 'b',
        weapon: 'Javelin',
        skills: ['luna'],
        aiMode: 'hold',
        holdPack: 0,
        holdPackSize: 1,
      },
    ]);
    expect(config.npcSpawn).toBeNull();
    expect(config.thronePos).toBeNull();
    expect(config.parBonus).toBe(0);
    // No unannounced arrivals (§8): nothing for the scheduler to read.
    expect(config.reinforcements).toBeUndefined();
    expect(config.scriptedWaves).toBeUndefined();
    expect(validateBattleConfig(config, data)).toEqual([]);
    // Plain data: it survives the run save as it is.
    expect(JSON.parse(JSON.stringify(config))).toEqual(
      Object.fromEntries(Object.entries(config).filter(([, v]) => v !== undefined)),
    );
  });

  it('a seize map finds its throne; a village tile is carried', () => {
    const config = buildPrologueBattleConfig(
      chapter({
        objective: 'seize',
        map: { legend: { '.': 'Plain', G: 'Throne', V: 'Village' }, rows: ['. . G', 'V . .'] },
        villageTile: { col: 0, row: 1 },
        enemies: [
          {
            id: 'boss',
            className: 'Fighter',
            level: 3,
            col: 2,
            row: 0,
            weapon: 'Iron Axe',
            skills: [],
            isBoss: true,
            name: 'Captain Varro',
          },
        ],
      }),
      data.terrain,
    );
    expect(config.thronePos).toEqual({ col: 2, row: 0 });
    expect(config.villageTile).toEqual({ col: 0, row: 1, uncontested: true });
    expect(config.enemySpawns[0]).toMatchObject({ isBoss: true, name: 'Captain Varro' });
    expect(validateBattleConfig(config, data)).toEqual([]);
  });

  it('refuses a map that does not parse', () => {
    expect(() =>
      buildPrologueBattleConfig(
        chapter({ map: { legend: { '.': 'Plain' }, rows: ['. .', '. . .'] } }),
        data.terrain,
      ),
    ).toThrow(/rectangular/);
    expect(
      parsePrologueMap({ legend: { '.': 'Plain' }, rows: ['. X'] }, data.terrain).errors,
    ).toEqual(['map tile (1,0) "X" is not in the legend']);
  });

  it('P1 as authored: the map, the Forts and both Fighters', () => {
    const p1 = data.prologue.chapters.find((c) => c.id === 'p1_banner_at_dawn');
    const config = buildPrologueBattleConfig(p1, data.terrain);
    expect(config.cols).toBe(8);
    expect(config.rows).toBe(6);
    expect(config.mapLayout[2][3]).toBe(FORT);
    expect(config.mapLayout[4][5]).toBe(FORT);
    expect(config.enemySpawns.map((s) => [s.authoredId, s.className, s.level, s.weapon])).toEqual([
      ['a', 'Fighter', 1, 'Iron Axe'],
      ['b', 'Fighter', 1, 'Iron Axe'],
    ]);
    expect(config.enemySpawns[1]).toMatchObject({ aiMode: 'hold', holdPack: 0, holdPackSize: 1 });
  });
});

describe('forecastConcepts', () => {
  const unit = (name) => buildPrologueUnits(data.prologue, data, [name])[0];

  it('names what a forecast shows: triangle, doubling, a counter or not, the hit chance', () => {
    const edric = unit('Edric');
    const fighter = {
      name: 'Fighter',
      stats: { HP: 22, STR: 8, MAG: 0, SKL: 3, SPD: 5, DEF: 4, RES: 1, LCK: 2, MOV: 4 },
      currentHP: 22,
      skills: [],
      proficiencies: [{ type: 'Axe', rank: 'Prof' }],
    };
    const axe = data.weapons.find((w) => w.name === 'Iron Axe');
    const plain = data.terrain[PLAIN];
    const forecast = getCombatForecast(edric, edric.weapon, fighter, axe, 1, plain, plain);
    const concepts = forecastConcepts(forecast, { weapon: edric.weapon });
    // Sword against axe, AS 6 against 0, and the axe reaches 1: no 'noCounter', no magic.
    expect(concepts).toContain('triangle');
    expect(concepts).toContain('doubling');
    expect(concepts).not.toContain('noCounter');
    expect(concepts).not.toContain('magic');
    expect(concepts).not.toContain('uncertainHit');
  });

  it('reads magic from the weapon and an open shot from the defender', () => {
    const glimmer = data.weapons.find((w) => w.name === 'Glimmer');
    const forecast = {
      display: { triangle: { damage: 0, hit: 0 } },
      attacker: { doubles: false, hit: 87 },
      defender: { doubles: false, canCounter: false },
    };
    expect(forecastConcepts(forecast, { weapon: glimmer })).toEqual([
      'noCounter',
      'magic',
      'uncertainHit',
    ]);
  });
});

describe('prologueBeatsFor', () => {
  const beats = (list) => ({ id: 'c', beats: list });

  it('returns matching beats in authored order, each action tagged with its beat', () => {
    const ch = beats([
      { id: 'first', on: 'battleStart', do: [{ coach: 'one' }, { note: 'two' }] },
      { id: 'other', on: 'victory', do: [{ dialogue: 'never' }] },
      { id: 'second', on: 'battleStart', do: [{ gateSelect: { unit: 'Edric' } }] },
    ]);
    const out = prologueBeatsFor(ch, { type: 'battleStart' });
    expect(out.fired).toEqual(['first', 'second']);
    expect(out.actions).toEqual([
      { coach: 'one', beat: 'first' },
      { note: 'two', beat: 'first' },
      { gateSelect: { unit: 'Edric' }, beat: 'second' },
    ]);
  });

  it('a once beat fires once; the state carries it and is never mutated', () => {
    const ch = beats([
      { id: 'once', on: 'unitSelected', unit: 'Edric', once: true, do: [{ coach: 'move' }] },
      { id: 'always', on: 'unitSelected', unit: 'Edric', do: [{ note: 'again' }] },
    ]);
    const start = { fired: [], other: 'kept' };
    const first = prologueBeatsFor(ch, { type: 'unitSelected', unit: 'Edric' }, start);
    expect(first.fired).toEqual(['once', 'always']);
    expect(start).toEqual({ fired: [], other: 'kept' });
    expect(first.state).toEqual({ fired: ['once'], other: 'kept' });
    const second = prologueBeatsFor(ch, { type: 'unitSelected', unit: 'Edric' }, first.state);
    expect(second.fired).toEqual(['always']);
    expect(second.actions).toEqual([{ note: 'again', beat: 'always' }]);
    expect(second.state.fired).toEqual(['once']);
    // A once beat that did not match stays armed.
    const miss = prologueBeatsFor(ch, { type: 'unitSelected', unit: 'Sera' }, start);
    expect(miss.fired).toEqual([]);
    expect(miss.state.fired).toEqual([]);
  });

  it('every condition must hold', () => {
    const ch = beats([
      { id: 'fort', on: 'afterMove', unit: 'Edric', terrain: 'Fort', do: [{ note: 'terrain' }] },
      { id: 'tile', on: 'afterMove', tile: { col: 3, row: 2 }, do: [{ note: 'tile' }] },
      { id: 'reach_b', on: 'afterMove', dangerFrom: 'b', do: [{ note: 'hold' }] },
      { id: 'reach_any', on: 'afterMove', dangerFrom: '*', do: [{ note: 'any' }] },
    ]);
    const ids = (event) => prologueBeatsFor(ch, { type: 'afterMove', ...event }).fired;
    expect(
      ids({ unit: 'Edric', terrain: 'Fort', tile: { col: 3, row: 2 }, dangerFrom: [] }),
    ).toEqual(['fort', 'tile']);
    expect(
      ids({ unit: 'Sera', terrain: 'Fort', tile: { col: 3, row: 3 }, dangerFrom: ['a'] }),
    ).toEqual(['reach_any']);
    expect(
      ids({ unit: 'Edric', terrain: 'Plain', tile: { col: 5, row: 4 }, dangerFrom: ['a', 'b'] }),
    ).toEqual(['reach_b', 'reach_any']);
  });

  it('forecast, HP and turn triggers read their own fields', () => {
    const ch = beats([
      { id: 'nth1', on: 'forecastOpened', nth: 1, do: [{ note: 'forecast' }] },
      {
        id: 'tri_b',
        on: 'forecastOpened',
        target: 'b',
        concept: 'triangle',
        do: [{ note: 'tri' }],
      },
      { id: 'low', on: 'hpBelow', unit: 'Edric', pct: 60, do: [{ note: 'vuln' }] },
      { id: 'ep1', on: 'turnStart', phase: 'enemy', turn: 1, do: [{ note: 'ep' }] },
      { id: 'pp2', on: 'turnStart', turn: 2, do: [{ note: 'pp' }] },
    ]);
    const ids = (event) => prologueBeatsFor(ch, event).fired;
    expect(ids({ type: 'forecastOpened', nth: 1, target: 'a', concepts: ['triangle'] })).toEqual([
      'nth1',
    ]);
    expect(ids({ type: 'forecastOpened', nth: 2, target: 'b', concepts: ['doubling'] })).toEqual(
      [],
    );
    expect(ids({ type: 'forecastOpened', nth: 3, target: 'b', concepts: ['triangle'] })).toEqual([
      'tri_b',
    ]);
    expect(ids({ type: 'hpBelow', unit: 'Edric', hpPct: 61 })).toEqual([]);
    expect(ids({ type: 'hpBelow', unit: 'Edric', hpPct: 60 })).toEqual(['low']);
    expect(ids({ type: 'turnStart', phase: 'enemy', turn: 1 })).toEqual(['ep1']);
    expect(ids({ type: 'turnStart', phase: 'player', turn: 1 })).toEqual([]);
    // A turnStart beat without a phase is the player's.
    expect(ids({ type: 'turnStart', phase: 'enemy', turn: 2 })).toEqual([]);
    expect(ids({ type: 'turnStart', phase: 'player', turn: 2 })).toEqual(['pp2']);
  });

  it('P1 as authored: the first select, the gate to the Fort, the first forecast', () => {
    const p1 = data.prologue.chapters.find((c) => c.id === 'p1_banner_at_dawn');
    let state = {};
    const step = (event) => {
      const out = prologueBeatsFor(p1, event, state);
      state = out.state;
      return out.actions.map(({ beat: _beat, ...action }) => action);
    };
    expect(step({ type: 'battleStart' })).toEqual([
      { coach: 'p1_select_edric' },
      { gateSelect: { unit: 'Edric' } },
      { highlight: { unit: 'Edric' } },
    ]);
    expect(step({ type: 'unitSelected', unit: 'Edric', turn: 1 })).toContainEqual({
      gateMove: { col: 3, row: 2 },
    });
    // Selecting Edric again never re-gates.
    expect(step({ type: 'unitSelected', unit: 'Edric', turn: 1 })).toEqual([]);
    expect(
      step({ type: 'forecastOpened', unit: 'Edric', target: 'a', nth: 1, concepts: [] }),
    ).toContainEqual({
      gateConfirm: true,
    });
  });
});

describe('buildPrologueUnit', () => {
  const edricSpec = () => structuredClone(data.prologue.units.Edric);

  it('Edric is built as authored, without a draw from Math.random', () => {
    forbidMathRandom();
    const [edric] = buildPrologueUnits(data.prologue, data, ['Edric']);
    Math.random = realRandom;
    const spec = edricSpec();
    expect(edric.name).toBe('Edric');
    expect(edric.isLord).toBe(true);
    expect(edric.level).toBe(1);
    expect(edric.stats).toEqual(spec.stats);
    expect(edric.currentHP).toBe(spec.stats.HP);
    expect(edric.mov).toBe(spec.stats.MOV);
    expect(edric.growths).toEqual(spec.growths);
    expect(edric.traits).toEqual([]);
    expect(edric.skills).toEqual(['charisma']);
    expect(edric.weapon.name).toBe('Iron Sword');
    expect(edric.inventory.map((w) => w.name)).toEqual(['Iron Sword']);
    expect(edric.inventory[0]).toBe(edric.weapon);
    expect(edric.consumables.map((c) => [c.name, c.uses])).toEqual([['Vulnerary', 3]]);
    const uids = [...edric.inventory, ...edric.consumables].map((i) => i.uid);
    expect(uids.every((uid) => typeof uid === 'string')).toBe(true);
    expect(new Set(uids).size).toBe(uids.length);
    expect(edric.accessory).toBeNull();
  });

  it("Edric's authored stats are his lords.json base stats (the spec's verified numbers)", () => {
    const lord = data.lords.find((l) => l.name === 'Edric');
    expect(edricSpec().stats).toEqual(lord.baseStats);
  });

  it("Edric's authored growths lie inside what a real Edric can roll", () => {
    const lord = data.lords.find((l) => l.name === 'Edric');
    const cls = data.classes.find((c) => c.name === lord.class);
    for (const [stat, growth] of Object.entries(edricSpec().growths)) {
      const [lo, hi] = cls.growthRanges[stat].split('-').map(Number);
      const personal = lord.personalGrowths[stat] || 0;
      expect(growth).toBeGreaterThanOrEqual(lo + personal);
      expect(growth).toBeLessThanOrEqual(hi + personal);
    }
  });

  it('the same seed builds the same unit; another seed changes only the item uids', () => {
    const a = buildPrologueUnit(edricSpec(), data, prologueUnitRng(1209, 'Edric'));
    const b = buildPrologueUnit(edricSpec(), data, prologueUnitRng(1209, 'Edric'));
    const strip = (u) => ({
      ...u,
      weapon: u.weapon?.name,
      inventory: u.inventory.map(({ uid: _uid, ...rest }) => rest),
      consumables: u.consumables.map(({ uid: _uid, ...rest }) => rest),
    });
    expect(a.inventory[0].uid.split('_')[2]).toBe(b.inventory[0].uid.split('_')[2]);
    const c = buildPrologueUnit(edricSpec(), data, prologueUnitRng(77, 'Edric'));
    expect(strip(c)).toEqual(strip(a));
  });

  it('unauthored stats and growths come from the seeded stream, never Math.random', () => {
    const spec = { lord: 'Edric', level: 4, inventory: ['Iron Sword'] };
    forbidMathRandom();
    const a = buildPrologueUnit(spec, data, createBattleRng(5));
    const b = buildPrologueUnit(spec, data, createBattleRng(5));
    Math.random = realRandom;
    expect(a.level).toBe(4);
    expect(a.stats).toEqual(b.stats);
    expect(a.growths).toEqual(b.growths);
    const lord = data.lords.find((l) => l.name === 'Edric');
    // Three level-ups: each grants at least one stat point.
    const gained = Object.keys(lord.baseStats)
      .filter((s) => s !== 'MOV')
      .reduce((sum, s) => sum + a.stats[s] - lord.baseStats[s], 0);
    expect(gained).toBeGreaterThanOrEqual(3);
  });

  it("Sera's kit: Light and Staff ranks, Glimmer equipped, Heal she can use", () => {
    const spec = {
      lord: 'Sera',
      level: 1,
      proficiencies: ['Light', 'Staff'],
      inventory: ['Glimmer', 'Heal', 'Vulnerary'],
    };
    forbidMathRandom();
    const sera = buildPrologueUnit(spec, data, prologueUnitRng(1209, 'Sera'));
    Math.random = realRandom;
    expect(sera.proficiencies).toEqual([
      { type: 'Light', rank: 'Prof' },
      { type: 'Staff', rank: 'Prof' },
    ]);
    expect(sera.weapon.name).toBe('Glimmer');
    expect(sera.inventory.map((w) => w.name)).toEqual(['Glimmer', 'Heal']);
    expect(sera.consumables.map((c) => c.name)).toEqual(['Vulnerary']);
    expect(sera.skills).toEqual(['renewal_aura']);
    // Staff usability as the battle decides it (UnitManager.hasStaff / getStaffWeapon).
    expect(hasStaff(sera)).toBe(true);
    const heal = getStaffWeapon(sera);
    expect(heal.name).toBe('Heal');
    expect(canEquip(sera, heal)).toBe(true);
    expect(getCombatWeapons(sera).map((w) => w.name)).toEqual(['Glimmer']);
    // Heal: MAG + 5 (6 + 5 = 11) on an ally down 15, three uses (MAG 6 is below the +1 at 8).
    const ally = { name: 'Edric', stats: { HP: 20 }, currentHP: 5 };
    expect(resolveHeal(heal, sera, ally).healAmount).toBe(11);
    expect(getStaffMaxUses(heal, sera)).toBe(3);
    expect(getStaffRemainingUses(heal, sera)).toBe(3);
    // Renewal Aura heals an adjacent ally at turn start.
    const hurt = { ...ally, faction: 'player', col: 1, row: 0, skills: [] };
    Object.assign(sera, { col: 0, row: 0, faction: 'player' });
    const effects = getTurnStartEffects([sera, hurt], data.skills);
    expect(effects.some((e) => e.type === 'heal' && e.target === hurt && e.amount > 0)).toBe(true);
  });

  it('a staff listed first is carried, not equipped, while a combat weapon is there', () => {
    const sera = buildPrologueUnit(
      { lord: 'Sera', level: 1, proficiencies: ['Light', 'Staff'], inventory: ['Heal', 'Glimmer'] },
      data,
      prologueUnitRng(1209, 'Sera'),
    );
    expect(sera.weapon.name).toBe('Glimmer');
    expect(sera.inventory.map((w) => w.name)).toEqual(['Glimmer', 'Heal']);
    const cleric = buildPrologueUnit(
      { className: 'Cleric', level: 1, inventory: ['Heal'] },
      data,
      prologueUnitRng(1209, 'Cleric'),
    );
    expect(cleric.weapon.name).toBe('Heal');
  });

  it('without the Staff rank, the same Heal is unusable (the gap the spec closes)', () => {
    const sera = buildPrologueUnit(
      { lord: 'Sera', level: 1, inventory: ['Glimmer', 'Heal'] },
      data,
      prologueUnitRng(1209, 'Sera'),
    );
    expect(hasStaff(sera)).toBe(false);
  });

  it('a generic unit (Tamsin) takes its name and its authored, empty kit: unarmed', () => {
    forbidMathRandom();
    const tamsin = buildPrologueUnit(
      { className: 'Archer', level: 1, inventory: [] },
      data,
      prologueUnitRng(1209, 'Tamsin'),
      { name: 'Tamsin' },
    );
    Math.random = realRandom;
    expect(tamsin.name).toBe('Tamsin');
    expect(tamsin.className).toBe('Archer');
    expect(tamsin.isLord).toBe(false);
    expect(tamsin.weapon).toBeNull();
    expect(tamsin.inventory).toEqual([]);
    expect(isUnarmed(tamsin)).toBe(true);
    const archer = data.classes.find((c) => c.name === 'Archer');
    expect(tamsin.stats).toEqual(archer.baseStats);
    for (const [stat, range] of Object.entries(archer.growthRanges)) {
      const [lo, hi] = range.split('-').map(Number);
      expect(tamsin.growths[stat]).toBeGreaterThanOrEqual(lo);
      expect(tamsin.growths[stat]).toBeLessThanOrEqual(hi);
    }
  });
});
