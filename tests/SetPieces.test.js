// Event set pieces (docs/specs/event-set-pieces.md): the authored map an event battle names.
//
// Ways this goes wrong:
//   - the same seed builds a different map (a resume or a scout disagrees with the battle);
//   - a variant or the mirror is never drawn, or the mirror flips the map but not the units;
//   - a rung or act gate moves the other slots (Black Sun is not "First Light plus");
//   - a slot reads the wrong class list for its act, or a level off the battle's range;
//   - the captain is not a named boss at the elite captain's level;
//   - a wave never reaches the scheduler's scripted waves, or a gated wave spawn still comes;
//   - a hold pack is sized by the authored slots instead of the ones in play (it never wakes);
//   - the shared steps (affixes, carry, the Hunted wave, par fields) are skipped on a set piece;
//   - the template path changes when a set piece is not asked for;
//   - the validator lets a broken map, tile, class or gate ship.
import { describe, expect, it } from 'vitest';
import {
  buildSetPieceBattle,
  captainLevelFor,
  classesForAct,
  findSetPiece,
  setPieceIdOfConfig,
  validateSetPiecesConfig,
} from '../src/engine/SetPieces.js';
import { generateSeededBattle } from '../src/engine/BattleScout.js';
import { validateBattleConfig } from '../src/engine/MapGenerator.js';
import { HOLD_AI_MODE } from '../src/engine/HoldDisturbance.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const PLAIN = data.terrain.findIndex((t) => t.name === 'Plain');
const WALL = data.terrain.findIndex((t) => t.name === 'Wall');

/** A random that hands out the given values in order and fails loudly past the end. */
function scripted(values) {
  const queue = [...values];
  const random = () => {
    if (queue.length === 0) throw new Error('random drawn more often than the test expects');
    return queue.shift();
  };
  random.left = () => queue.length;
  return random;
}

const FIXTURE = {
  id: 'fixture',
  title: 'Fixture',
  lore: 'A test.',
  objective: 'rout',
  deploy: { max: 3 },
  variants: [
    {
      id: 'a',
      mirror: true,
      map: {
        legend: { '.': 'Plain', '#': 'Wall' },
        rows: [
          '. . . . . .',
          '. # . . . .',
          '. . . . . .',
          '. . . . . .',
          '. . . . . .',
          '. . . . . .',
        ],
      },
      playerSpawns: [
        { col: 0, row: 2 },
        { col: 0, row: 3 },
        { col: 0, row: 4 },
        { col: 0, row: 5 },
      ],
      enemies: [
        { col: 5, row: 0, classes: ['Fighter', 'Archer'], level: 1 },
        {
          col: 5,
          row: 5,
          classes: { act1: ['Fighter'], act3: ['Knight'] },
          captain: { name: 'Boss' },
        },
        { col: 4, row: 4, classes: ['Archer'], minRung: 'hard' },
        { col: 3, row: 3, classes: ['Fighter'], hold: 2 },
        { col: 3, row: 4, classes: ['Fighter'], hold: 2, minRung: 'lunatic' },
      ],
      waves: [
        {
          turn: 2,
          spawns: [
            { col: 5, row: 3, classes: ['Fighter'], level: -5 },
            { col: 5, row: 2, classes: ['Fighter'], minAct: 'act3' },
          ],
        },
      ],
    },
  ],
};

function buildFixture({ act = 'act1', difficultyId = 'normal', random, deployCount = 2 }) {
  return buildSetPieceBattle({
    setPiece: FIXTURE,
    act,
    difficultyId,
    levelRange: [3, 6],
    deployCount,
    classes: data.classes,
    terrain: data.terrain,
    random,
  });
}

describe('buildSetPieceBattle: draws, classes and levels', () => {
  // Draws: mirror, then (class, level) for each of 5 slots, then 2 wave spawns = 15.
  const UNMIRRORED = [0.9, 0.6, 0.0, 0.1, 0.99, 0.3, 0.3, 0.2, 0.5, 0.4, 0.4, 0.0, 0.0, 0.5, 0.5];

  it('takes two draws per slot and wave spawn, gated or not, and resolves each as authored', () => {
    const random = scripted(UNMIRRORED);
    const built = buildFixture({ random });
    expect(random.left()).toBe(0);
    expect(built.mirrored).toBe(false);
    expect(built.variantId).toBe('a');
    // Slot 1: classes[floor(0.6 * 2)] = Archer; level 3 + floor(0 * 4) + 1 = 4.
    // Captain: act1 list, Fighter; a base class at the top of the range: 6 + 0 (Act I).
    // Slot 3 (Nightfall up) and slot 5 (Black Sun) are out on First Light.
    // Slot 4: Fighter, 3 + floor(0.5 * 4) = 5, a pack of one in play.
    expect(built.enemySpawns).toEqual([
      { className: 'Archer', level: 4, col: 5, row: 0, isBoss: false },
      { className: 'Fighter', level: 6, col: 5, row: 5, isBoss: true, name: 'Boss' },
      {
        className: 'Fighter',
        level: 5,
        col: 3,
        row: 3,
        isBoss: false,
        aiMode: HOLD_AI_MODE,
        holdPack: 2,
        holdPackSize: 1,
      },
    ]);
    // Wave: 3 + 0 - 5 floors at 1; its Act III spawn is not in Act I.
    expect(built.reinforcements).toEqual({
      reinforcementContractVersion: 1,
      reinforcements: {
        waves: [],
        scriptedWaves: [{ turn: 2, spawns: [{ className: 'Fighter', level: 1, col: 5, row: 3 }] }],
      },
    });
  });

  it('a harder rung adds its slots and moves nothing the rungs share', () => {
    const normal = buildFixture({ random: scripted(UNMIRRORED) });
    const lunatic = buildFixture({ difficultyId: 'lunatic', random: scripted(UNMIRRORED) });
    const key = (s) => `${s.col},${s.row}`;
    const shared = new Set(normal.enemySpawns.map(key));
    const { holdPackSize: _n, ...normalHolder } = normal.enemySpawns[2];
    const lunaticShared = lunatic.enemySpawns.filter((s) => shared.has(key(s)));
    expect(lunaticShared.map(({ holdPackSize: _l, ...rest }) => rest)).toEqual([
      normal.enemySpawns[0],
      normal.enemySpawns[1],
      normalHolder,
    ]);
    // The two extra slots come in, and the pack is now two strong (it wakes on a fall).
    expect(lunatic.enemySpawns.map(key)).toEqual(['5,0', '5,5', '4,4', '3,3', '3,4']);
    expect(lunatic.enemySpawns.filter((s) => s.holdPack === 2).map((s) => s.holdPackSize)).toEqual([
      2, 2,
    ]);
  });

  it('an act table holds from its act up', () => {
    expect(classesForAct({ act1: ['Fighter'], act3: ['Knight'] }, 'act2')).toEqual(['Fighter']);
    expect(classesForAct({ act1: ['Fighter'], act3: ['Knight'] }, 'act4')).toEqual(['Knight']);
    expect(classesForAct({ act3: ['Knight'] }, 'act1')).toBeNull();
    const act3 = buildFixture({ act: 'act3', random: scripted(UNMIRRORED) });
    // The captain's Act III class, two above the range's top (the elite captain's offset).
    expect(act3.enemySpawns[1]).toMatchObject({ className: 'Knight', level: 8, isBoss: true });
    // The Act III wave spawn now comes: 3 + floor(0.5 * 4) = 5.
    expect(act3.reinforcements.reinforcements.scriptedWaves[0].spawns).toHaveLength(2);
    expect(act3.reinforcements.reinforcements.scriptedWaves[0].spawns[1]).toEqual({
      className: 'Fighter',
      level: 5,
      col: 5,
      row: 2,
    });
  });

  it('a promoted captain takes the promotion base level off, as an elite captain does', () => {
    expect(captainLevelFor('act1', 6, false)).toBe(6);
    expect(captainLevelFor('act3', 16, false)).toBe(18);
    expect(captainLevelFor('act3', 16, true)).toBe(8);
    expect(captainLevelFor('act3', 3, true)).toBe(1);
  });

  it('the mirror flips the map and every unit with it', () => {
    const random = scripted([0.1, ...UNMIRRORED.slice(1)]);
    const built = buildFixture({ random });
    expect(built.mirrored).toBe(true);
    // The wall at (1,1) is now at (4,1); nothing else in that row is a wall.
    expect(built.mapLayout[1]).toEqual([PLAIN, PLAIN, PLAIN, PLAIN, WALL, PLAIN]);
    expect(built.enemySpawns.map((s) => [s.col, s.row])).toEqual([
      [0, 0],
      [0, 5],
      [2, 3],
    ]);
    expect(built.playerSpawns.map((s) => [s.col, s.row])).toEqual([
      [5, 2],
      [5, 3],
    ]);
    expect(built.reinforcements.reinforcements.scriptedWaves[0].spawns[0]).toMatchObject({
      col: 0,
      row: 3,
    });
  });

  it('the spawns past the deploy count are the formation spares, in authored order', () => {
    const built = buildFixture({ random: scripted(UNMIRRORED), deployCount: 3 });
    expect(built.playerSpawns).toEqual([
      { col: 0, row: 2 },
      { col: 0, row: 3 },
      { col: 0, row: 4 },
    ]);
    expect(built.formationSpares).toEqual([{ col: 0, row: 5 }]);
  });
});

describe('the generator on shipped set pieces', () => {
  const params = (setPiece, extra = {}) => ({
    act: 'act1',
    objective: 'rout',
    setPiece,
    difficultyId: 'normal',
    deployCount: 4,
    levelRange: [2, 3],
    ...extra,
  });

  it('the same seed builds the same map; seeds reach every variant and both sides', () => {
    for (const id of ['toll_house', 'toll_crossing']) {
      const seen = new Set();
      for (let seed = 1; seed <= 40; seed++) {
        const a = generateSeededBattle(params(id), data, seed);
        const b = generateSeededBattle(params(id), data, seed);
        expect(b).toEqual(a);
        seen.add(`${a.setPieceVariant}:${a.mirrored}`);
      }
      const variants = findSetPiece(data.setPieces, id).variants.map((v) => v.id);
      const expected = variants.flatMap((v) => [`${v}:false`, `${v}:true`]);
      expect([...seen].sort()).toEqual(expected.sort());
    }
  });

  it('never touches the caller’s Math.random stream', () => {
    const before = Math.random;
    generateSeededBattle(params('toll_house'), data, 7);
    expect(Math.random).toBe(before);
  });

  it('a set piece config names itself and reads as the set piece everywhere', () => {
    const config = generateSeededBattle(params('toll_house'), data, 3);
    expect(config.templateId).toBe('setpiece:toll_house');
    expect(setPieceIdOfConfig(config)).toBe('toll_house');
    expect(config).toMatchObject({ setPieceId: 'toll_house', objective: 'rout', npcSpawn: null });
    expect(config.playerSpawns).toHaveLength(4);
    // The captain, named, with no carried item (a captain never carries one).
    const captain = config.enemySpawns.find((s) => s.isBoss);
    expect(captain).toMatchObject({ name: 'The Toll-Keeper', className: 'Zombie' });
    expect(captain.carries).toBeUndefined();
    // The turn-2 rising from the bog reaches the scheduler.
    expect(config.reinforcements.scriptedWaves[0].turn).toBe(2);
    expect(
      config.reinforcements.scriptedWaves[0].spawns.every((s) => s.className === 'Zombie'),
    ).toBe(true);
  });

  it('every shipped variant builds a valid map at every act and rung its event reaches', () => {
    for (const id of ['toll_house', 'toll_crossing'])
      for (const act of ['act1', 'act2', 'act3'])
        for (const difficultyId of ['normal', 'dusk', 'hard', 'lunatic'])
          for (let seed = 1; seed <= 12; seed++) {
            const levelRange = act === 'act1' ? [2, 3] : undefined;
            const config = generateSeededBattle(
              params(id, { act, difficultyId, levelRange, deployCount: 5 }),
              data,
              seed,
            );
            expect(validateBattleConfig(config, data, { expectedPlayerSpawns: 5 })).toEqual([]);
            expect(config.enemySpawns.length).toBeGreaterThan(0);
          }
  });

  it('runs the shared steps: affixes on a hard rung, carried items, the Hunted wave, par fields', () => {
    let affixed = 0;
    let carried = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const config = generateSeededBattle(
        params('toll_crossing', {
          act: 'act2',
          levelRange: undefined,
          difficultyId: 'lunatic',
          carryConfig: data.difficulty.modes.lunatic.carryConfig,
          huntedWave: { turn: 3, count: [1, 2], xpMultiplier: 0.5 },
          objectiveParOffset: { rout: -1 },
        }),
        data,
        seed,
      );
      affixed += config.enemySpawns.filter((s) => s.affixes?.length).length;
      carried += config.enemySpawns.filter((s) => s.carries).length;
      expect(config.reinforcements.hunted).toMatchObject({ turn: 3, count: [1, 2] });
      // The authored wave stays beside the Hunted one.
      expect(config.reinforcements.scriptedWaves.length).toBe(1);
      expect(config.parOffset).toBe(-1);
      expect(config.enemySpawns.find((s) => s.isBoss)?.carries).toBeUndefined();
    }
    expect(affixed).toBeGreaterThan(0);
    expect(carried).toBeGreaterThan(0);
  });

  it('the event level bonus raises every slot, the captain included', () => {
    const base = generateSeededBattle(params('toll_house'), data, 11);
    const raised = generateSeededBattle(params('toll_house', { enemyLevelBonus: 2 }), data, 11);
    expect(raised.enemySpawns.map((s) => s.level)).toEqual(
      base.enemySpawns.map((s) => s.level + 2),
    );
  });

  it('without a set piece the template path is untouched', () => {
    const plain = { act: 'act2', objective: 'rout', difficultyId: 'dusk', deployCount: 5 };
    const a = generateSeededBattle(plain, data, 99);
    const b = generateSeededBattle({ ...plain, setPiece: undefined }, data, 99);
    expect(b).toEqual(a);
    expect(a.templateId.startsWith('setpiece:')).toBe(false);
    expect(a.setPieceId).toBeUndefined();
  });

  it('an unknown set piece throws rather than building a different fight', () => {
    expect(() => generateSeededBattle(params('no_such_place'), data, 1)).toThrow(
      /Unknown set piece "no_such_place"/,
    );
  });
});

describe('validateSetPiecesConfig', () => {
  const deps = {
    terrain: data.terrain,
    classes: data.classes,
    weapons: data.weapons,
    difficulty: data.difficulty,
    events: { events: [] },
  };
  const validate = (mutate, extraDeps = {}) => {
    const piece = structuredClone(FIXTURE);
    mutate?.(piece);
    return validateSetPiecesConfig({ setPieces: [piece] }, { ...deps, ...extraDeps }).errors;
  };

  it('accepts the shipped data and the fixture', () => {
    expect(
      validateSetPiecesConfig(data.setPieces, { ...deps, events: data.events }).errors,
    ).toEqual([]);
    expect(validate()).toEqual([]);
  });

  it.each([
    ['an unknown class', (p) => (p.variants[0].enemies[0].classes = ['Fighterr']), /unknown class/],
    [
      'an unknown act key',
      (p) => (p.variants[0].enemies[1].classes = { act9: ['Fighter'] }),
      /unknown act/,
    ],
    [
      'a slot on a wall',
      (p) => Object.assign(p.variants[0].enemies[0], { col: 1, row: 1 }),
      /cannot stand/,
    ],
    [
      'a slot walled off from the army',
      (p) => {
        p.variants[0].map.rows = [
          '. . . . # .',
          '. . . . # .',
          '. . . . # .',
          '. . . . # .',
          '. . . . # .',
          '. . . . # .',
        ];
      },
      /cannot be reached/,
    ],
    ['too few player spawns', (p) => (p.deploy.max = 5), /player spawns; deploy.max needs 5/],
    [
      'two units on one tile',
      (p) => Object.assign(p.variants[0].enemies[0], { col: 0, row: 2 }),
      /is also/,
    ],
    [
      'two captains',
      (p) => (p.variants[0].enemies[0].captain = { name: 'Other' }),
      /more than one captain/,
    ],
    ['a gated captain', (p) => (p.variants[0].enemies[1].minRung = 'hard'), /always in play/],
    ['an unknown rung', (p) => (p.variants[0].enemies[2].minRung = 'nightmare'), /not a rung/],
    ['an unknown key', (p) => (p.variants[0].enemies[0].lvl = 2), /unknown key "lvl"/],
    ['an unknown weapon', (p) => (p.variants[0].enemies[0].weapon = 'Spoon'), /unknown weapon/],
    ['a wave turn of 0', (p) => (p.variants[0].waves[0].turn = 0), /turn must be/],
    ['an unknown objective', (p) => (p.objective = 'defend'), /objective must be/],
    ['lore with a double quote', (p) => (p.lore = 'He said "toll".'), /double quotes/],
    ['a map too small', (p) => (p.variants[0].map.rows = ['. .', '. .']), /must be 6x6/],
  ])('refuses %s', (_label, mutate, pattern) => {
    expect(validate(mutate).join('\n')).toMatch(pattern);
  });

  it('refuses an event naming an unknown set piece', () => {
    const events = {
      events: [
        {
          id: 'e',
          acts: ['act1'],
          choices: [{ outcomes: [{ effects: [{ type: 'battle', setPiece: 'nowhere' }] }] }],
        },
      ],
    };
    expect(validate(null, { events }).join('\n')).toMatch(/unknown set piece "nowhere"/);
  });

  it('refuses a class a rung holds back in an act the event reaches', () => {
    // Dusk meets Necromancers from Act IV only: a set piece in Act III would break the promise.
    const events = {
      events: [
        {
          id: 'e',
          acts: ['act3'],
          choices: [{ outcomes: [{ effects: [{ type: 'battle', setPiece: 'fixture' }] }] }],
        },
      ],
    };
    const errors = validate((p) => (p.variants[0].enemies[0].classes = ['Necromancer']), {
      events,
    });
    expect(errors.join('\n')).toMatch(/Necromancer in act3 breaks dusk's gate \(act4\)/);
    // Gated to Black Sun, the slot is fine (Black Sun meets them from Act III).
    const gated = validate(
      (p) => {
        p.variants[0].enemies[0].classes = ['Necromancer'];
        p.variants[0].enemies[0].minRung = 'lunatic';
      },
      { events },
    );
    expect(gated).toEqual([]);
  });

  it('refuses a variant that fields no foe at a rung and act the event reaches', () => {
    const events = {
      events: [
        {
          id: 'e',
          acts: ['act1'],
          choices: [{ outcomes: [{ effects: [{ type: 'battle', setPiece: 'fixture' }] }] }],
        },
      ],
    };
    const errors = validate(
      (p) => {
        p.variants[0].enemies = [p.variants[0].enemies[2]];
      },
      { events },
    );
    expect(errors.join('\n')).toMatch(/fixture\/a fields no foe in act1 on normal/);
  });
});
