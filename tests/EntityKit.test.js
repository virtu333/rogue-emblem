// The Entity's anti-kiting kit (engine/EntityKit.js, EntityKitConfig.js): a longer reach on its
// own turn, the Grasping Limbs on Nightfall and Black Sun, and Black Sun's undertow. Ways this
// breaks, one test (or a few) each:
//   - a rung gets the wrong kit, a malformed kit is half-read, or the validator lets one through
//   - the Entity still only strikes within 2, or strikes past its limbs' reach, or through a
//     fallen limb
//   - the Danger zone misses a limb's reach, or shows the reach of a limb the fog hides
//   - a limb rises somewhere other than where the army struck from (or beside it, nearest the
//     body), past the kit's caps, twice for one turn, with no Entity standing, or from the
//     battle's own stream (a rise would move every later roll)
//   - a limb pays full gold and XP (it is conjured), carries the wrong weapon, or ignores the
//     rung's enemy stat bonus
//   - a cut limb wounds the Entity by the wrong amount, can fell it, or counts a cut the army
//     did not make; the Entity's fall leaves limbs standing
//   - the strike tile is noted after an art moved the attacker, or for a foe's attack
//   - the undertow drags on a miss, drags the wrong way, drags a unit already beside the body,
//     roots a status-immune unit, or acts at all without the kit's undertow
//   - a rooted unit can still be Shoved, Pulled or Swapped out of the Entity's reach
//   - the battle's limb state is lost on suspend or a rewind
import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ default: { Scene: class {} } }));
import { Grid } from '../src/engine/Grid.js';
import { BattleScene } from '../src/scenes/BattleScene.js';
import { AIController } from '../src/engine/AIController.js';
import {
  ENTITY_LIMB_SUMMONER,
  canEntityStrike,
  isEntityLimb,
  livingEntityLimbs,
} from '../src/engine/EntitySystem.js';
import {
  LIMB_ALIVE_CAP,
  entityKitOf,
  entityKitSummaryLines,
  sanitizeEntityKit,
  validateEntityKitConfig,
} from '../src/engine/EntityKitConfig.js';
import {
  ENTITY_KIT_HINTS,
  LIMB_CLASS,
  LIMB_WEAPON,
  buildGraspingLimb,
  createEntityKitState,
  entityKitAfterCombat,
  entityKitForecastNote,
  entityKitWorld,
  initialEntityKitState,
  limbPhaseStep,
  noteEntityStrike,
  sanitizeEntityKitState,
  severLimb,
  undertowPlan,
  witherLimbs,
} from '../src/engine/EntityKit.js';
import { postCombatEffects } from '../src/engine/PostCombatEffects.js';
import { enemyThreatTiles } from '../src/engine/ThreatForecast.js';
import { findShoveTargets } from '../src/engine/ForcedMovement.js';
import { applyCondition, isRooted } from '../src/engine/StatusConditionSystem.js';
import { conjuredXpMultiplier, isConjuredUnit } from '../src/engine/ConjuredUnits.js';
import { enemyRewardMultiplier } from '../src/engine/ReinforcementSpawns.js';
import {
  captureBattleWorldState,
  restoreBattleWorldState,
} from '../src/engine/BattleSnapshotState.js';
import { ENTITY_PRIMARY_ATTACK_RANGE, ENTITY_LIMB_REACH } from '../src/utils/constants.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();
const PLAIN = gameData.terrain.findIndex((t) => t.name === 'Plain');
const KIT = { limbs: { maxAlive: 2, maxSprouted: 3, woundPercent: 4 }, undertow: true };

function mockScene() {
  const stub = new Proxy(
    {},
    { get: (target, prop) => (prop === 'destroy' ? () => {} : () => stub) },
  );
  return {
    cameras: { main: { width: 640, height: 480 } },
    add: { rectangle: () => stub, image: () => stub, text: () => stub, container: () => stub },
    textures: { exists: () => false },
  };
}
const plainGrid = (cols, rows, { fog = false } = {}) =>
  new Grid(
    mockScene(),
    cols,
    rows,
    gameData.terrain,
    Array.from({ length: rows }, () => Array(cols).fill(PLAIN)),
    fog,
  );

const weapon = (name) => structuredClone(gameData.weapons.find((w) => w.name === name));
const entityAt = (col, row, extra = {}) => ({
  name: 'The Entity',
  className: 'Entity',
  faction: 'enemy',
  isEntity: true,
  isBoss: true,
  level: 22,
  col,
  row,
  currentHP: 120,
  mov: 0,
  stats: { MOV: 0, HP: 120, STR: 24, MAG: 22, SKL: 20, SPD: 12, DEF: 22, RES: 20, LCK: 15 },
  moveType: 'Infantry',
  weapon: weapon('Eldritch Grasp'),
  inventory: [weapon('Eldritch Grasp'), weapon('Twisting Vortex')],
  ...extra,
});
const player = (name, col, row, extra = {}) => ({
  name,
  faction: 'player',
  col,
  row,
  currentHP: 30,
  stats: { HP: 30, STR: 10, MAG: 0, SKL: 10, SPD: 10, DEF: 8, RES: 4, LCK: 5, MOV: 5 },
  moveType: 'Infantry',
  weapon: weapon('Longbow'),
  inventory: [weapon('Longbow')],
  skills: [],
  ...extra,
});
const limbAt = (col, row, extra = {}) => ({
  name: LIMB_CLASS,
  className: LIMB_CLASS,
  faction: 'enemy',
  col,
  row,
  currentHP: 22,
  stats: { HP: 22 },
  _summonedBy: ENTITY_LIMB_SUMMONER,
  ...extra,
});
// The distance to a 3x3 body at (bc, br): an independent form of entityDistanceTo.
const gapToBody = (bc, br, c, r) =>
  Math.max(bc - c, 0, c - (bc + 2)) + Math.max(br - r, 0, r - (br + 2));

describe('the kit on each rung (difficulty.json entityKit)', () => {
  it('First Light and Dusk hold none; Nightfall limbs; Black Sun limbs and the undertow', () => {
    const d = gameData.difficulty.modes;
    expect(sanitizeEntityKit(d.normal.entityKit)).toBeNull();
    expect(sanitizeEntityKit(d.dusk.entityKit)).toBeNull();
    expect(sanitizeEntityKit(d.hard.entityKit)).toEqual({
      limbs: { maxAlive: 2, maxSprouted: 8, woundPercent: 4 },
      undertow: false,
    });
    expect(sanitizeEntityKit(d.lunatic.entityKit)).toEqual({
      limbs: { maxAlive: 4, maxSprouted: 12, woundPercent: 4 },
      undertow: true,
    });
    for (const [id, mode] of Object.entries(d))
      expect(validateEntityKitConfig(mode.entityKit, id), id).toEqual([]);
  });

  it('reads a malformed kit as off, never as half a rule, and the validator names it', () => {
    expect(sanitizeEntityKit(null)).toBeNull();
    expect(sanitizeEntityKit({ limbs: { maxAlive: 0, maxSprouted: 2, woundPercent: 4 } })).toBe(
      null,
    );
    expect(
      sanitizeEntityKit({ limbs: { maxAlive: 3, maxSprouted: 2, woundPercent: 4 }, undertow: 1 }),
    ).toBeNull();
    expect(
      sanitizeEntityKit({ limbs: { maxAlive: LIMB_ALIVE_CAP + 1, maxSprouted: 40 } }),
    ).toBeNull();
    expect(sanitizeEntityKit({ limbs: null, undertow: true })).toEqual({
      limbs: null,
      undertow: true,
    });
    expect(validateEntityKitConfig(undefined, 'x')).toHaveLength(1);
    expect(
      validateEntityKitConfig({ limbs: { maxAlive: 3, maxSprouted: 2 }, undertow: 'yes' }, 'x'),
    ).toEqual([
      'x.entityKit.undertow must be boolean',
      'x.entityKit.limbs.maxSprouted must be a whole number from maxAlive to 32',
      'x.entityKit.limbs.woundPercent must be a whole number 0-100',
    ]);
    expect(validateEntityKitConfig({ limbs: null, undertow: false, more: 1 }, 'x')).toEqual([
      'x.entityKit.more is unknown',
    ]);
  });

  it('the difficulty screen names what the rung adds, and nothing on the lower rungs', () => {
    const d = gameData.difficulty.modes;
    expect(entityKitSummaryLines(d.normal.entityKit)).toEqual([]);
    expect(entityKitSummaryLines(d.hard.entityKit)).toEqual([
      'The Entity grows limbs where it is struck from (up to 2 at once)',
    ]);
    expect(entityKitSummaryLines(d.lunatic.entityKit)).toHaveLength(2);
  });

  it('a locked config carries it, and the run format refuses it to an older client', () => {
    expect(entityKitOf({ entityKit: KIT })).toEqual(KIT);
    expect(entityKitOf({})).toBeNull();
    expect(initialEntityKitState({ entityKit: KIT })).toEqual(createEntityKitState());
    expect(initialEntityKitState({ entityKit: { limbs: null, undertow: true } })).toBeNull();
    expect(initialEntityKitState({})).toBeNull();
  });
});

describe("the Entity's reach on its own turn", () => {
  it('strikes within 3 of its body, never 4, whatever its weapons say', () => {
    expect(ENTITY_PRIMARY_ATTACK_RANGE).toBe(3);
    const entity = entityAt(5, 5);
    expect(canEntityStrike(entity, player('A', 10, 6))).toBe(true); // 3 from the body
    expect(canEntityStrike(entity, player('A', 11, 6))).toBe(false); // 4: counter only
    expect(canEntityStrike(entity, player('A', 2, 2))).toBe(false); // 3 + 3 diagonal
    expect(canEntityStrike(player('B', 0, 0), player('A', 1, 0))).toBe(false); // not the Entity
  });

  it('also strikes anyone within 1 of a living limb, however far from the body', () => {
    expect(ENTITY_LIMB_REACH).toBe(1);
    const entity = entityAt(5, 5);
    const limb = limbAt(14, 6);
    const far = player('Far', 15, 6);
    expect(canEntityStrike(entity, far)).toBe(false);
    expect(canEntityStrike(entity, far, [entity, limb])).toBe(true);
    expect(canEntityStrike(entity, player('Diag', 15, 7), [entity, limb])).toBe(false);
    expect(canEntityStrike(entity, player('Two', 16, 6), [entity, limb])).toBe(false);
    // A fallen limb (or one mid-removal) lends nothing.
    expect(canEntityStrike(entity, far, [entity, { ...limb, currentHP: 0 }])).toBe(false);
    expect(canEntityStrike(entity, far, [entity, { ...limb, _removing: true }])).toBe(false);
    // An ordinary foe beside the target is no limb.
    expect(canEntityStrike(entity, far, [entity, { ...limb, _summonedBy: 'circle:a' }])).toBe(
      false,
    );
  });

  it('the AI attacks through a limb, and only through a living one', () => {
    const grid = { cols: 30, rows: 30, getMoveCost: () => 1 };
    const ai = new AIController(grid, {}, { objective: 'rout' });
    const entity = entityAt(5, 5);
    const far = player('Far', 15, 6);
    const limb = limbAt(14, 6);
    expect(ai._decideEntityAction(entity, [far], [], [entity]).target).toBeNull();
    expect(ai._decideEntityAction(entity, [far], [], [entity, limb]).target).toBe(far);
    expect(ai._decideEntityAction(entity, [player('T', 10, 6)], [], [entity]).target).not.toBe(
      null,
    );
  });
});

describe("the Danger zone reads the limbs' reach", () => {
  const ctxFor = (g, units) => ({
    grid: g,
    enemyUnits: units.filter((u) => u.faction === 'enemy'),
    ballistas: [],
    positions: () => new Map(units.map((u) => [`${u.col},${u.row}`, { faction: u.faction }])),
    costModifier: () => 0,
  });

  it('adds the tiles beside each visible limb to the strike zone, and out of the band', () => {
    const g = plainGrid(20, 15);
    const entity = entityAt(3, 5);
    const limb = limbAt(14, 6);
    const { damage, counter } = enemyThreatTiles(ctxFor(g, [entity, limb]), entity);
    const expected = new Set();
    for (let c = 0; c < 20; c++)
      for (let r = 0; r < 15; r++)
        if (gapToBody(3, 5, c, r) <= 3 || Math.abs(c - 14) + Math.abs(r - 6) === 1)
          expected.add(`${c},${r}`);
    expect([...damage].sort()).toEqual([...expected].sort());
    for (const key of counter) expect(damage.has(key)).toBe(false);
  });

  it('a limb the fog hides lends the zone nothing (it would name an unseen foe)', () => {
    const g = plainGrid(20, 15, { fog: true });
    g.isVisible = (c, r) => !(c === 14 && r === 6); // the limb's tile alone is dark
    const entity = entityAt(3, 5);
    const limb = limbAt(14, 6);
    const { damage } = enemyThreatTiles(ctxFor(g, [entity, limb]), entity);
    expect(damage.has('15,6')).toBe(false);
    expect(damage.has('14,6')).toBe(false);
  });
});

describe('a limb rises where the army struck from', () => {
  const world = (units, extra = {}) => ({
    kit: KIT,
    enemyUnits: units.filter((u) => u.faction === 'enemy'),
    cols: 20,
    rows: 15,
    isOccupied: (c, r) =>
      units.some((u) =>
        u.isEntity
          ? gapToBody(u.col, u.row, c, r) === 0
          : u.col === c && u.row === r && u.currentHP > 0,
      ),
    moveCostAt: () => 1,
    turn: 2,
    seed: 77,
    classes: gameData.classes,
    weapons: gameData.weapons,
    ...extra,
  });

  it('on the tile itself when it is free', () => {
    const entity = entityAt(3, 5);
    const state = createEntityKitState();
    noteEntityStrike(state, { col: 10, row: 6 });
    const step = limbPhaseStep({ ...world([entity]), state });
    expect(step.sprouts.map((s) => s.tile)).toEqual([{ col: 10, row: 6 }]);
    expect(step.state).toEqual({ strikes: [], sprouted: 1, severed: 0, lastProcessedTurn: 2 });
  });

  it('beside it, the free neighbour nearest the body, when the striker still stands there', () => {
    const entity = entityAt(3, 5); // body columns 3..5, rows 5..7
    const archer = player('Archer', 9, 6);
    const state = createEntityKitState();
    noteEntityStrike(state, { col: 9, row: 6 });
    const step = limbPhaseStep({ ...world([entity, archer]), state });
    // (8, 6) is 3 from the body; (10, 6) 5, (9, 5) and (9, 7) 4.
    expect(step.sprouts.map((s) => s.tile)).toEqual([{ col: 8, row: 6 }]);
    // The tile toward the body taken too: the next nearest, left/right/up/down on a tie.
    const blocker = player('Blocker', 8, 6);
    const again = limbPhaseStep({
      ...world([entity, archer, blocker]),
      state: { ...createEntityKitState(), strikes: [{ col: 9, row: 6 }] },
    });
    expect(again.sprouts.map((s) => s.tile)).toEqual([{ col: 9, row: 5 }]);
  });

  it('within the caps: never more than maxAlive standing nor maxSprouted in a battle', () => {
    const entity = entityAt(3, 5);
    const strikes = [
      { col: 10, row: 2 },
      { col: 10, row: 4 },
      { col: 10, row: 8 },
    ];
    const first = limbPhaseStep({
      ...world([entity]),
      state: { ...createEntityKitState(), strikes },
    });
    expect(first.sprouts).toHaveLength(2); // maxAlive 2
    // Both standing: nothing more rises, the notes are dropped.
    const standing = first.sprouts.map((s) => s.unit);
    const second = limbPhaseStep({
      ...world([entity, ...standing]),
      state: { ...first.state, strikes: [{ col: 12, row: 2 }] },
      turn: 3,
    });
    expect(second.sprouts).toHaveLength(0);
    expect(second.state.strikes).toEqual([]);
    // One cut down: one more may rise, and then the battle's three are spent.
    const third = limbPhaseStep({
      ...world([entity, standing[0]]),
      state: {
        ...second.state,
        strikes: [
          { col: 12, row: 2 },
          { col: 12, row: 4 },
        ],
      },
      turn: 4,
    });
    expect(third.sprouts).toHaveLength(1);
    expect(third.state.sprouted).toBe(3);
    const fourth = limbPhaseStep({
      ...world([entity]),
      state: { ...third.state, strikes: [{ col: 14, row: 2 }] },
      turn: 5,
    });
    expect(fourth.sprouts).toHaveLength(0);
  });

  it('once a turn, never with the Entity gone, never without the kit', () => {
    const entity = entityAt(3, 5);
    const state = { ...createEntityKitState(), strikes: [{ col: 10, row: 6 }] };
    const done = limbPhaseStep({ ...world([entity]), state });
    const twice = limbPhaseStep({
      ...world([entity]),
      state: { ...done.state, strikes: [{ col: 11, row: 6 }] },
    });
    expect(twice.skipped).toBe(true);
    expect(twice.sprouts).toHaveLength(0);
    const gone = limbPhaseStep({ ...world([]), state });
    expect(gone.sprouts).toHaveLength(0);
    expect(gone.state.strikes).toEqual([]);
    expect(
      limbPhaseStep({ ...world([entity]), kit: { limbs: null, undertow: true }, state }).skipped,
    ).toBe(true);
  });

  it("from its own keyed stream: the same limb on a replay, the battle's stream untouched", () => {
    const entity = entityAt(3, 5);
    const state = { ...createEntityKitState(), strikes: [{ col: 10, row: 6 }] };
    const spy = vi.spyOn(Math, 'random');
    const a = limbPhaseStep({ ...world([entity]), state });
    const b = limbPhaseStep({ ...world([entity]), state });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    expect(JSON.stringify(a.sprouts[0].unit)).toBe(JSON.stringify(b.sprouts[0].unit));
    expect(a.sprouts[0].unit.weapon.uid).toBe(b.sprouts[0].unit.weapon.uid);
  });
});

describe('the Grasping Limb itself', () => {
  const build = (difficultyConfig = 1.0) =>
    buildGraspingLimb(
      { col: 4, row: 4 },
      {
        classes: gameData.classes,
        weapons: gameData.weapons,
        seed: 9,
        turn: 3,
        ordinal: 1,
        level: 23,
        difficultyConfig,
      },
    );

  it('is the class as written, at the Entity level, holding the Coil alone', () => {
    const cls = gameData.classes.find((c) => c.name === LIMB_CLASS);
    const limb = build();
    expect(limb.className).toBe(LIMB_CLASS);
    expect(limb.stats).toEqual(cls.baseStats);
    expect(limb.currentHP).toBe(cls.baseStats.HP);
    expect(limb.level).toBe(23);
    expect(limb.mov).toBe(0);
    expect(limb.weapon.name).toBe(LIMB_WEAPON);
    expect(limb.weapon.range).toBe('1');
    expect(limb.inventory).toEqual([limb.weapon]);
    expect(limb.skills).toEqual([]);
    expect(limb.isBoss).toBe(false);
    expect(limb.hasActed).toBe(false);
    expect(isEntityLimb(limb)).toBe(true);
  });

  it("takes the rung's enemy stat bonus", () => {
    const plain = build();
    const harder = build({ difficultyMod: 1.0, enemyStatBonus: 2 });
    expect(harder.stats.STR).toBe(plain.stats.STR + 2);
    expect(harder.stats.HP).toBe(plain.stats.HP + 4);
  });

  it('is conjured: no gold, half the XP', () => {
    const limb = build();
    expect(isConjuredUnit(limb)).toBe(true);
    expect(conjuredXpMultiplier(limb)).toBe(0.5);
    expect(enemyRewardMultiplier(limb)).toBe(0);
  });

  it('is immovable, as the Entity is', async () => {
    const { displacementBlockReason } = await import('../src/engine/ForcedMovement.js');
    expect(displacementBlockReason(build(), [])).not.toBeNull();
  });
});

describe('cutting a limb wounds the Entity; its fall withers them', () => {
  it(`a cut takes 4% of the Entity's max HP, never its last point`, () => {
    const entity = entityAt(3, 5);
    const limb = limbAt(10, 6);
    const state = createEntityKitState();
    const killer = player('Cutter', 10, 7);
    const wound = severLimb(limb, { kit: KIT, state, enemyUnits: [entity], killer });
    expect(wound).toEqual({ entity, amount: 5 }); // round(120 × 4%)
    expect(entity.currentHP).toBe(115);
    expect(state.severed).toBe(1);
    entity.currentHP = 3;
    expect(severLimb(limb, { kit: KIT, state, enemyUnits: [entity], killer }).amount).toBe(2);
    expect(entity.currentHP).toBe(1);
  });

  it("counts only the army's cut, and only while the Entity stands", () => {
    const entity = entityAt(3, 5);
    const limb = limbAt(10, 6);
    const args = { kit: KIT, state: createEntityKitState(), enemyUnits: [entity] };
    expect(severLimb(limb, { ...args, killer: null })).toBeNull();
    expect(severLimb(limb, { ...args, killer: { faction: 'enemy' } })).toBeNull();
    expect(severLimb(limb, { ...args, enemyUnits: [], killer: player('C', 0, 0) })).toBeNull();
    expect(
      severLimb({ ...limb, _summonedBy: 'circle:a' }, { ...args, killer: player('C', 0, 0) }),
    ).toBeNull();
    expect(entity.currentHP).toBe(120);
    // An NPC ally's cut counts.
    expect(severLimb(limb, { ...args, killer: { faction: 'npc' } })?.amount).toBe(5);
  });

  it('the Entity falling takes every limb off the roster with it', () => {
    const other = { name: 'Hollowed', faction: 'enemy', currentHP: 10 };
    const limbs = [limbAt(1, 1), limbAt(2, 2)];
    const roster = [limbs[0], other, limbs[1]];
    expect(witherLimbs(roster)).toEqual(limbs);
    expect(roster).toEqual([other]);
    expect(livingEntityLimbs(roster)).toEqual([]);
  });
});

describe('after a strike on the Entity (PostCombatEffects)', () => {
  const counterHit = { type: 'strike', attackerSide: 'defender', miss: false };
  const counterMiss = { type: 'strike', attackerSide: 'defender', miss: true };
  const board = (units, extra = {}) => ({
    cols: 20,
    rows: 15,
    affixes: gameData.affixes,
    getMoveCost: () => 1,
    getUnitAt: (c, r) =>
      units.find((u) =>
        u.isEntity ? gapToBody(u.col, u.row, c, r) === 0 : u.col === c && u.row === r,
      ) || null,
    ...extra,
  });
  const run = (gen) => [...gen];

  it("notes the attacker's tile from before any move, for the player's strikes only", () => {
    const entity = entityAt(3, 5);
    const archer = player('Archer', 9, 6);
    const state = createEntityKitState();
    const world = board([entity, archer], {
      entityKit: { ...KIT, undertow: false },
      entityKitState: state,
    });
    run(
      entityKitAfterCombat(
        {
          attacker: archer,
          defender: entity,
          result: { events: [] },
          strikeTile: { col: 9, row: 6 },
        },
        world,
      ),
    );
    expect(state.strikes).toEqual([{ col: 9, row: 6 }]);
    // A foe's strike, or a strike on anyone else, is never noted.
    const foe = { ...archer, faction: 'enemy' };
    run(
      entityKitAfterCombat(
        { attacker: foe, defender: entity, result: {}, strikeTile: { col: 1, row: 1 } },
        world,
      ),
    );
    run(
      entityKitAfterCombat(
        { attacker: archer, defender: foe, result: {}, strikeTile: { col: 2, row: 2 } },
        world,
      ),
    );
    expect(state.strikes).toEqual([{ col: 9, row: 6 }]);
  });

  it('postCombatEffects notes the tile the attacker struck from', () => {
    const entity = entityAt(3, 5);
    const archer = player('Archer', 9, 6);
    const state = createEntityKitState();
    const world = {
      ...board([entity, archer]),
      hostilesOf: () => [entity],
      alliesOf: () => [archer],
      turnNumber: 1,
      entityKit: KIT,
      entityKitState: state,
    };
    const result = { events: [], attackerHP: 30, defenderHP: 100 };
    run(postCombatEffects({ attacker: archer, defender: entity, result }, world));
    expect(state.strikes).toEqual([{ col: 9, row: 6 }]);
  });

  it('Black Sun: a counter that lands drags the striker one tile in and roots it', () => {
    const entity = entityAt(3, 5);
    const archer = player('Archer', 9, 6); // 4 from the body (cols 3..5)
    const world = board([entity, archer], {
      entityKit: KIT,
      entityKitState: createEntityKitState(),
    });
    const beats = run(
      entityKitAfterCombat(
        {
          attacker: archer,
          defender: entity,
          result: { events: [counterHit] },
          strikeTile: { col: 9, row: 6 },
        },
        world,
      ),
    );
    expect({ col: archer.col, row: archer.row }).toEqual({ col: 8, row: 6 });
    expect(isRooted(archer)).toBe(true);
    expect(beats.map((b) => b.kind)).toEqual(['moved', 'hint', 'status', 'hint']);
    expect(beats[0].units).toEqual([archer]);
    expect(beats[1].text).toBe(ENTITY_KIT_HINTS.dragged);
    expect(beats[3].text).toBe(ENTITY_KIT_HINTS.held);
  });

  it('a miss does nothing; a unit beside the body is rooted where it stands', () => {
    const entity = entityAt(3, 5);
    const archer = player('Archer', 9, 6);
    const world = board([entity, archer], {
      entityKit: KIT,
      entityKitState: createEntityKitState(),
    });
    const strike = (events) =>
      run(
        entityKitAfterCombat(
          {
            attacker: archer,
            defender: entity,
            result: { events },
            strikeTile: { col: archer.col, row: archer.row },
          },
          world,
        ),
      );
    expect(strike([counterMiss])).toEqual([]);
    expect(archer.col).toBe(9);
    expect(isRooted(archer)).toBe(false);
    archer.col = 6; // beside the body
    const beats = strike([counterHit]);
    expect(archer.col).toBe(6);
    expect(beats.map((b) => b.kind)).toEqual(['status', 'hint']);
  });

  it('without the undertow (Nightfall) a landed counter moves and roots nothing', () => {
    const entity = entityAt(3, 5);
    const archer = player('Archer', 9, 6);
    const world = board([entity, archer], {
      entityKit: { ...KIT, undertow: false },
      entityKitState: createEntityKitState(),
    });
    expect(
      run(
        entityKitAfterCombat(
          {
            attacker: archer,
            defender: entity,
            result: { events: [counterHit] },
            strikeTile: { col: 9, row: 6 },
          },
          world,
        ),
      ),
    ).toEqual([]);
    expect(archer.col).toBe(9);
    expect(isRooted(archer)).toBe(false);
  });

  it('drags along the longer axis, the other when that one is blocked, never through a unit', () => {
    const entity = entityAt(3, 5); // body (3..5, 5..7)
    const unit = player('U', 9, 9); // 4 across, 2 down: across first
    const units = [entity, unit];
    expect(undertowPlan(unit, entity, board(units))).toMatchObject({ col: 8, row: 9 });
    units.push(player('Block', 8, 9));
    expect(undertowPlan(unit, entity, board(units))).toMatchObject({ col: 9, row: 8 });
    units.push(player('Block2', 9, 8));
    expect(undertowPlan(unit, entity, board(units))).toBeNull();
  });

  it('a status-immune unit is dragged but never held', () => {
    const entity = entityAt(3, 5);
    const archer = player('Archer', 9, 6, {
      accessory: { name: 'Ward', combatEffects: { statusImmunity: true } },
    });
    const world = board([entity, archer], {
      entityKit: KIT,
      entityKitState: createEntityKitState(),
    });
    const beats = run(
      entityKitAfterCombat(
        {
          attacker: archer,
          defender: entity,
          result: { events: [counterHit] },
          strikeTile: { col: 9, row: 6 },
        },
        world,
      ),
    );
    expect(archer.col).toBe(8);
    expect(isRooted(archer)).toBe(false);
    expect(beats.map((b) => b.kind)).toEqual(['moved', 'hint']);
  });

  it('the forecast warns before Confirm', () => {
    const entity = entityAt(3, 5);
    const archer = player('Archer', 9, 6);
    expect(entityKitForecastNote(KIT, archer, entity)).toBe(
      'A limb rises where you strike from · a counter that lands drags you in and roots you',
    );
    expect(entityKitForecastNote({ ...KIT, undertow: false }, archer, entity)).toBe(
      'A limb rises where you strike from',
    );
    expect(entityKitForecastNote(KIT, archer, entity, { defender: { canCounter: false } })).toBe(
      'A limb rises where you strike from',
    );
    expect(entityKitForecastNote(null, archer, entity)).toBe('');
    expect(entityKitForecastNote(KIT, archer, player('Ally', 1, 1))).toBe('');
  });

  it("the post-combat world carries the battle's kit and its state", () => {
    const owner = { battleConfig: { entityKit: KIT } };
    const world = entityKitWorld(owner);
    expect(world.entityKit).toEqual(KIT);
    expect(world.entityKitState).toBe(owner._entityKitState);
    expect(entityKitWorld({ battleConfig: {} })).toEqual({});
  });
});

describe('a rooted unit is held where it stands', () => {
  it('cannot be Shoved', () => {
    const g = plainGrid(10, 10);
    const shover = player('Shover', 4, 4);
    const ally = player('Ally', 5, 4);
    const ctx = { grid: g, allies: [shover, ally], getUnitAt: () => null };
    expect(findShoveTargets(shover, ctx)).toHaveLength(1);
    applyCondition(ally, 'root', 1, { recoveryChance: 0 });
    expect(findShoveTargets(shover, ctx)).toHaveLength(0);
  });

  it('cannot Swap or be Swapped, Pull or be Pulled', () => {
    const scene = new BattleScene();
    scene.grid = plainGrid(10, 10);
    scene.getUnitAt = () => null;
    const a = player('A', 4, 4);
    const b = player('B', 5, 4);
    scene.playerUnits = [a, b];
    expect(scene.findSwapTargets(a)).toHaveLength(1);
    expect(scene.findPullTargets(a)).toHaveLength(1);
    applyCondition(b, 'root', 1, { recoveryChance: 0 });
    expect(scene.findSwapTargets(a)).toHaveLength(0);
    expect(scene.findPullTargets(a)).toHaveLength(0);
    expect(scene.findSwapTargets(b)).toHaveLength(0);
    expect(scene.findPullTargets(b)).toHaveLength(0);
  });
});

describe("the battle's limb state rides suspend and rewind", () => {
  it('is captured, restored, and marks the checkpoint for the run format', () => {
    const scene = { playerUnits: [], enemyUnits: [], npcUnits: [] };
    scene._entityKitState = {
      strikes: [{ col: 2, row: 3 }],
      sprouted: 2,
      severed: 1,
      lastProcessedTurn: 4,
    };
    const snap = captureBattleWorldState(scene);
    expect(snap.entityKitState).toEqual(scene._entityKitState);
    scene._entityKitState = createEntityKitState();
    restoreBattleWorldState(scene, structuredClone(snap));
    expect(scene._entityKitState).toEqual(snap.entityKitState);
    // A battle without one saves nothing of it.
    expect(
      captureBattleWorldState({ playerUnits: [], enemyUnits: [], npcUnits: [] }),
    ).not.toHaveProperty('entityKitState');
    expect(sanitizeEntityKitState({ strikes: 'x', sprouted: -2 })).toEqual(createEntityKitState());
  });
});
