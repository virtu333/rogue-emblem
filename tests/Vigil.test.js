// The Vigil step (engine/Vigil.js; docs/specs/act-v-descent.md §3.1, §5.2, §9.5), pure. Ways
// this breaks, a test each:
//   - a word is counted for a Voice off its sigil, or a fallen one; the Waking speaks double with
//     another Voice fallen, or single with all four alive
//   - a circle calls while a player or NPC unit covers it, or while its Voice is silenced
//   - a call lands on an occupied or impassable tile, or two calls share one
//   - the caps (`maxCalled`, `maxPerCircle`) let one more through, or stop one short
//   - the Hollowed's level ignores the Rite at entry or the words so far, misses the cap, or
//     lets this phase's words in after the call
//   - a call draws from Math.random, or the same call (circle, turn, n, seed) builds another unit
//   - a turn is processed twice (`lastProcessedTurn`), or the step writes its inputs
//   - the conjured predicate misses a summoned unit (gold, XP share, survival XP, carry)
//   - the set piece's vigil data loses `waking` or the caps, or the validator lets bad ones by
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadGameData } from './testData.js';
import {
  HOLLOWED_LEVEL_CAP,
  HOLLOWED_PER_WORD_LEVEL,
  VIGIL_MAX_CALLED,
  createVigilState,
  hollowedLevelBonus,
  isVoiceOf,
  sanitizeVigilState,
  summonKey,
  vigilBoardView,
  vigilPhaseStep,
  wordsSpoken,
} from '../src/engine/Vigil.js';
import {
  conjuredXpMultiplier,
  isConjuredUnit,
  isRaisedUnit,
  isSummonedUnit,
} from '../src/engine/ConjuredUnits.js';
import { keyedBattleRandom } from '../src/engine/BattleRng.js';
import {
  enemyRewardMultiplier,
  enemyXpMultiplier,
  isZeroRewardUnit,
} from '../src/engine/ReinforcementSpawns.js';
import { combatXpAwards } from '../src/engine/BattleXp.js';
import { isCarrierEligible } from '../src/engine/EnemyCarry.js';
import { buildSetPieceBattle, validateSetPiecesConfig } from '../src/engine/SetPieces.js';
import { generateSeededBattle } from '../src/engine/BattleScout.js';
import { DEV_SET_PIECE_FIXTURES, withDevSetPiece } from '../src/utils/devSetPieceFixtures.js';
import { XP_DEFEND_SURVIVE } from '../src/utils/constants.js';

const data = loadGameData();
afterEach(() => vi.restoreAllMocks());

/** A 9x9 open floor with four sigils around the centre and four circles at the edges. */
const VIGIL = Object.freeze({
  sigils: [
    { id: 's_n', col: 4, row: 2, target: 'v_n' },
    { id: 's_e', col: 6, row: 4, target: 'v_e' },
    { id: 's_s', col: 4, row: 6, target: 'v_s' },
    { id: 's_w', col: 2, row: 4, target: 'v_w', waking: true },
  ],
  circles: [
    { id: 'c_n', col: 4, row: 0, voice: 'v_n' },
    { id: 'c_e', col: 8, row: 4, voice: 'v_e' },
    { id: 'c_s', col: 4, row: 8, voice: 'v_s' },
    { id: 'c_w', col: 0, row: 4, voice: 'v_w' },
  ],
  levelRange: [10, 10],
});

const voice = (id, col, row) => ({
  name: id,
  authoredId: id,
  faction: 'enemy',
  className: 'Circle Adept',
  currentHP: 20,
  col,
  row,
});
const voices = () => VIGIL.sigils.map((s) => voice(s.target, s.col, s.row));
const hero = (col, row, faction = 'player') => ({
  name: 'Edric',
  faction,
  currentHP: 30,
  col,
  row,
});

/** A step on a 9x9 floor (every tile passable unless `walls` lists it). */
function step({
  vigil = VIGIL,
  state = null,
  enemyUnits = voices(),
  playerUnits = [],
  npcUnits = [],
  walls = [],
  turn = 1,
  seed = 77,
  riteAtEntry = 0,
} = {}) {
  const wall = new Set(walls.map(([c, r]) => `${c},${r}`));
  const all = [...enemyUnits, ...playerUnits, ...npcUnits];
  return vigilPhaseStep({
    vigil,
    state,
    enemyUnits,
    playerUnits,
    npcUnits,
    cols: 9,
    rows: 9,
    isOccupied: (c, r) => all.some((u) => u.currentHP > 0 && u.col === c && u.row === r),
    moveCostAt: (c, r) => (wall.has(`${c},${r}`) ? '--' : '1'),
    turn,
    seed,
    riteAtEntry,
    classes: data.classes,
    weapons: data.weapons,
  });
}
const tiles = (summons) => summons.map((s) => [s.circleId, s.tile.col, s.tile.row]);

describe('the words', () => {
  it('each Voice on its sigil speaks one; the Waking two while the other three live', () => {
    expect(wordsSpoken(VIGIL, voices())).toEqual([
      { voiceId: 'v_n', sigilId: 's_n', count: 1 },
      { voiceId: 'v_e', sigilId: 's_e', count: 1 },
      { voiceId: 'v_s', sigilId: 's_s', count: 1 },
      { voiceId: 'v_w', sigilId: 's_w', count: 2 },
    ]);
    const { state } = step();
    expect(state.words).toBe(5);
    expect(state.byVoice).toEqual({ v_n: 1, v_e: 1, v_s: 1, v_w: 2 });
  });

  it('a Voice off its sigil speaks nothing; the Waking still speaks two while all live', () => {
    const units = voices();
    units[1].col = 7; // the East Voice shoved one tile off
    expect(wordsSpoken(VIGIL, units).map((w) => [w.voiceId, w.count])).toEqual([
      ['v_n', 1],
      ['v_s', 1],
      ['v_w', 2],
    ]);
    expect(step({ enemyUnits: units }).state.words).toBe(4);
  });

  it('the Waking speaks one once another Voice has fallen (dead or on its way out)', () => {
    const dead = voices();
    dead[0].currentHP = 0;
    expect(wordsSpoken(VIGIL, dead).map((w) => [w.voiceId, w.count])).toEqual([
      ['v_e', 1],
      ['v_s', 1],
      ['v_w', 1],
    ]);
    const leaving = voices();
    leaving[2]._removing = true;
    expect(wordsSpoken(VIGIL, leaving).find((w) => w.voiceId === 'v_w').count).toBe(1);
    // An off-sigil Voice still lives: the Waking keeps its double.
    const off = voices();
    off[0].row = 1;
    expect(wordsSpoken(VIGIL, off).find((w) => w.voiceId === 'v_w').count).toBe(2);
  });

  it('a unit that is not the Voice standing on a sigil speaks nothing', () => {
    const units = voices().slice(1);
    units.push({ ...voice('impostor', 4, 2) });
    expect(wordsSpoken(VIGIL, units).map((w) => w.voiceId)).toEqual(['v_e', 'v_s', 'v_w']);
  });

  it('the words accumulate across phases', () => {
    const first = step({ turn: 1 });
    const second = step({ turn: 2, state: first.state });
    expect(second.state.words).toBe(10);
    expect(second.state.byVoice.v_w).toBe(4);
  });
});

describe('the summons', () => {
  it('each open circle calls one Hollowed onto itself, acting this phase, linked to it', () => {
    const { summons, state } = step();
    expect(tiles(summons)).toEqual([
      ['c_n', 4, 0],
      ['c_e', 8, 4],
      ['c_s', 4, 8],
      ['c_w', 0, 4],
    ]);
    for (const { unit, circleId } of summons)
      expect(unit).toMatchObject({
        className: 'Hollowed',
        faction: 'enemy',
        _summonedBy: `circle:${circleId}`,
        hasActed: false,
        hasMoved: false,
        isBoss: false,
        isElite: false,
        consumables: [],
        accessory: null,
        skills: [],
      });
    expect(summons.every(({ unit }) => unit.inventory.length === 1)).toBe(true);
    expect(summons.every(({ unit }) => unit.authoredId === undefined)).toBe(true);
    expect(state.summoned).toBe(4);
    expect(state.byCircle).toEqual({ c_n: 1, c_e: 1, c_s: 1, c_w: 1 });
  });

  it('a player or NPC unit on a circle blocks it; an enemy on it sends the call beside it', () => {
    const { summons } = step({
      playerUnits: [hero(4, 0)],
      npcUnits: [hero(8, 4, 'npc')],
      enemyUnits: [...voices(), { ...voice('guard', 4, 8), authoredId: undefined }],
    });
    // c_n and c_e are covered; c_s's own tile holds a guard: left of it is the first free one.
    expect(tiles(summons)).toEqual([
      ['c_s', 3, 8],
      ['c_w', 0, 4],
    ]);
  });

  it('riseTile order: left, right, up, down; walls and units skipped; no room, no call', () => {
    const guard = (col, row) => ({ ...voice('g', col, row), authoredId: undefined });
    // c_w at (0,4): its own tile and (1,4) held, left is off the map: up (0,3).
    let s = step({ enemyUnits: [...voices(), guard(0, 4), guard(1, 4)] });
    expect(tiles(s.summons).find((t) => t[0] === 'c_w')).toEqual(['c_w', 0, 3]);
    // ... and with up a wall: down (0,5).
    s = step({ enemyUnits: [...voices(), guard(0, 4), guard(1, 4)], walls: [[0, 3]] });
    expect(tiles(s.summons).find((t) => t[0] === 'c_w')).toEqual(['c_w', 0, 5]);
    // ... and down held too: nothing is called there, and nothing is counted for it.
    s = step({ enemyUnits: [...voices(), guard(0, 4), guard(1, 4), guard(0, 5)], walls: [[0, 3]] });
    expect(s.summons.map((x) => x.circleId)).toEqual(['c_n', 'c_e', 'c_s']);
    expect(s.state.byCircle.c_w).toBeUndefined();
    expect(s.state.summoned).toBe(3);
  });

  it('two calls in one phase never share a tile', () => {
    // Two circles side by side: the first takes its tile; the second's own is held by a guard,
    // its left is the first call's (taken this phase), its right the East Voice's: up.
    const vigil = {
      ...VIGIL,
      circles: [
        { id: 'a', col: 4, row: 4, voice: 'v_n' },
        { id: 'b', col: 5, row: 4, voice: 'v_e' },
      ],
    };
    const guard = { ...voice('g', 5, 4), authoredId: undefined };
    const { summons } = step({ vigil, enemyUnits: [...voices(), guard] });
    expect(tiles(summons)).toEqual([
      ['a', 4, 4],
      ['b', 5, 3],
    ]);
  });

  it('a silenced Voice closes its circle for good; the others still call', () => {
    const units = voices();
    units[3].currentHP = 0; // the Waking is silenced
    const first = step({ enemyUnits: units, turn: 1 });
    expect(first.summons.map((s) => s.circleId)).toEqual(['c_n', 'c_e', 'c_s']);
    const later = step({ enemyUnits: units, turn: 2, state: first.state });
    expect(later.summons.map((s) => s.circleId)).not.toContain('c_w');
  });

  it('caps: at most maxCalled in a battle (default 8), and maxPerCircle when named', () => {
    expect(VIGIL_MAX_CALLED).toBe(8);
    let state = null;
    const called = [];
    for (let turn = 1; turn <= 5; turn++) {
      // Each phase's Hollowed walk away, so every circle stays clear.
      const s = step({ turn, state });
      state = s.state;
      called.push(s.summons.length);
    }
    expect(called).toEqual([4, 4, 0, 0, 0]);
    expect(state.summoned).toBe(8);

    const capped = { ...VIGIL, maxCalled: 6, maxPerCircle: 1 };
    const a = step({ vigil: capped, turn: 1 });
    expect(a.summons).toHaveLength(4);
    const b = step({ vigil: capped, turn: 2, state: a.state });
    expect(b.summons).toHaveLength(0); // one per circle already
    const c = step({ vigil: { ...capped, maxPerCircle: 2 }, turn: 2, state: a.state });
    expect(c.summons.map((s) => s.circleId)).toEqual(['c_n', 'c_e']); // 6 in all
    expect(c.state.summoned).toBe(6);
  });
});

describe('the Hollowed level: the battle range plus the Rite', () => {
  it('min(levelCap, floor((riteAtEntry + words) / perWordLevel)), this phase’s words included', () => {
    expect([HOLLOWED_PER_WORD_LEVEL, HOLLOWED_LEVEL_CAP]).toEqual([4, 4]);
    // Phase 1 speaks 5 words: 0 + 5 → +1; a Rite of 6 at entry: 11 → +2; 40 → the cap, +4.
    expect(step({ riteAtEntry: 0 }).summons[0].unit.level).toBe(11);
    expect(step({ riteAtEntry: 6 }).summons[0].unit.level).toBe(12);
    expect(step({ riteAtEntry: 40 }).summons[0].unit.level).toBe(14);
    // No word this phase (every Voice off its sigil) and none before: the range alone.
    const off = voices().map((u) => ({
      ...u,
      col: u.col === 4 ? 3 : u.col,
      row: u.row === 4 ? 3 : u.row,
    }));
    expect(step({ enemyUnits: off }).summons[0].unit.level).toBe(10);
    // Phase 2 reads both phases' words: 10 → +2.
    const first = step({ turn: 1 });
    expect(step({ turn: 2, state: first.state }).summons[0].unit.level).toBe(12);
  });

  it('the vigil may carry the Rite’s own numbers; a base class never passes level 20', () => {
    const vigil = { ...VIGIL, perWordLevel: 2, levelCap: 1 };
    expect(step({ vigil }).summons[0].unit.level).toBe(11); // floor(5/2) = 2, capped at 1
    expect(hollowedLevelBonus({ riteAtEntry: 3, words: 4, perWordLevel: 2, levelCap: 9 })).toBe(3);
    expect(hollowedLevelBonus({ riteAtEntry: 0, words: 3 })).toBe(0);
    const high = { ...VIGIL, levelRange: [19, 19] };
    expect(step({ vigil: high, riteAtEntry: 40 }).summons[0].unit.level).toBe(20);
  });

  it('the level is rolled in the range from the call’s own stream (its first draw)', () => {
    const vigil = { ...VIGIL, levelRange: [10, 15] };
    for (let turn = 1; turn <= 6; turn++) {
      const off = voices().map((u) => ({ ...u, row: u.row + 1 })); // no words: no bonus
      const { summons } = step({ vigil, enemyUnits: off, turn, seed: 4242 });
      for (const { circleId, unit } of summons) {
        const roll = keyedBattleRandom(4242, `summon:${circleId}:${turn}:0`)();
        expect(unit.level).toBe(10 + Math.floor(roll * 6));
      }
    }
  });
});

describe('the keyed stream', () => {
  it('never draws from Math.random', () => {
    const random = vi.spyOn(Math, 'random');
    const s = step();
    expect(s.summons).toHaveLength(4);
    expect(random).not.toHaveBeenCalled();
  });

  it('the same call (circle, turn, n, seed) builds the same unit; another turn or seed another', () => {
    const a = step({ turn: 3 }).summons;
    const b = step({ turn: 3 }).summons;
    expect(b.map((s) => s.unit)).toEqual(a.map((s) => s.unit));
    expect(summonKey('c_n', 3, 0)).toBe('summon:c_n:3:0');
    expect(a[0].unit.weapon.uid).toBe('itm_summon_c_n_3_0');
    const growths = (summons) => summons.map((s) => JSON.stringify(s.unit.growths));
    expect(growths(step({ turn: 4 }).summons)).not.toEqual(growths(a));
    expect(growths(step({ turn: 3, seed: 78 }).summons)).not.toEqual(growths(a));
    // Over many calls both of the Hollowed's weapons come up.
    const weapons = new Set();
    for (let turn = 1; turn <= 20; turn++)
      for (const s of step({ turn }).summons) weapons.add(s.unit.weapon.name);
    expect([...weapons].sort()).toEqual(['Iron Lance', 'Iron Sword']);
  });

  it('the n in the key is how many that circle called before', () => {
    const first = step({ turn: 2 });
    const second = step({ turn: 2, state: { ...first.state, lastProcessedTurn: 0 } });
    expect(second.summons[0].unit.weapon.uid).toBe('itm_summon_c_n_2_1');
  });
});

describe('the step', () => {
  it('runs once a turn: a turn already processed does nothing', () => {
    const first = step({ turn: 3 });
    const again = step({ turn: 3, state: first.state });
    expect(again.skipped).toBe(true);
    expect(again.words).toEqual([]);
    expect(again.summons).toEqual([]);
    expect(again.state).toEqual(first.state);
    // An earlier turn (a stale pipeline) does nothing either; the next one runs.
    expect(step({ turn: 2, state: first.state }).skipped).toBe(true);
    expect(step({ turn: 4, state: first.state }).skipped).toBe(false);
    // Even a phase with no word and no call marks its turn.
    const quiet = step({ enemyUnits: [], turn: 5 });
    expect(quiet.state.lastProcessedTurn).toBe(5);
  });

  it('writes none of its inputs', () => {
    const units = voices();
    const before = JSON.stringify(units);
    const state = createVigilState();
    step({ enemyUnits: units, state });
    expect(JSON.stringify(units)).toBe(before);
    expect(state).toEqual(createVigilState());
  });

  it('a saved state is made whole; garbage reads as fresh', () => {
    expect(sanitizeVigilState(null)).toEqual(createVigilState());
    expect(
      sanitizeVigilState({
        words: 7.9,
        byVoice: { a: 3, '': 1, b: -2 },
        byCircle: [],
        summoned: '4',
        lastProcessedTurn: -1,
      }),
    ).toEqual({
      words: 7,
      byVoice: { a: 3, b: 0 },
      byCircle: {},
      summoned: 4,
      lastProcessedTurn: 0,
    });
  });

  it('the board view and the Voice test', () => {
    const units = voices();
    units[1].col = 7;
    units[3].currentHP = 0;
    const view = vigilBoardView(VIGIL, { enemyUnits: units, playerUnits: [hero(4, 8)] });
    expect(view.sigils.map((s) => [s.id, Boolean(s.voice), s.onSigil, s.waking])).toEqual([
      ['s_n', true, true, false],
      ['s_e', true, false, false],
      ['s_s', true, true, false],
      ['s_w', false, false, true],
    ]);
    expect(view.circles.map((c) => [c.id, Boolean(c.voice), c.covered])).toEqual([
      ['c_n', true, false],
      ['c_e', true, false],
      ['c_s', true, true],
      ['c_w', false, false],
    ]);
    expect(isVoiceOf(VIGIL, units[0])).toBe(true);
    expect(isVoiceOf(VIGIL, { authoredId: 'guard' })).toBe(false);
    expect(isVoiceOf(VIGIL, {})).toBe(false);
  });
});

describe('conjured units: one predicate for the raised and the called', () => {
  const summoned = {
    className: 'Hollowed',
    faction: 'enemy',
    _summonedBy: 'circle:c_n',
    level: 12,
  };
  const raised = { className: 'Skeleton', faction: 'enemy', _raisedBy: 'u3', level: 12 };
  const plain = { className: 'Hollowed', faction: 'enemy', level: 12 };

  it('the predicates read the link, not the class', () => {
    expect([isSummonedUnit(summoned), isRaisedUnit(summoned), isConjuredUnit(summoned)]).toEqual([true, false, true]); // prettier-ignore
    expect([isSummonedUnit(raised), isRaisedUnit(raised), isConjuredUnit(raised)]).toEqual([false, true, true]); // prettier-ignore
    expect(isConjuredUnit(plain)).toBe(false);
    expect(isConjuredUnit({ className: 'Fighter', _summonedBy: 'circle:x' })).toBe(true);
    expect(isConjuredUnit({ _summonedBy: '' })).toBe(false);
    expect(isConjuredUnit(null)).toBe(false);
  });

  it('gold 0; XP half for the called, a quarter for the raised, never the elite bonus', () => {
    expect(enemyRewardMultiplier(summoned)).toBe(0);
    expect(enemyXpMultiplier(summoned)).toBe(0.5);
    expect(enemyXpMultiplier({ ...summoned, isElite: true }, 2)).toBe(0.5);
    expect(enemyXpMultiplier(raised)).toBe(0.25);
    expect(conjuredXpMultiplier(plain)).toBeNull();
    expect(enemyRewardMultiplier(plain)).toBe(1);
  });

  it('no deed record, never a carrier', () => {
    expect(isZeroRewardUnit(summoned)).toBe(true);
    expect(isZeroRewardUnit(plain)).toBe(false);
    expect(isCarrierEligible({ className: 'Fighter', _summonedBy: 'circle:c_n' })).toBe(false);
    expect(isCarrierEligible({ className: 'Fighter' })).toBe(true);
  });

  it('surviving a called Hollowed’s attack pays no survival XP; a plain foe’s does', () => {
    const unit = { name: 'Recruit', faction: 'player', level: 5, tier: 'base', currentHP: 10, stats: { HP: 20 } }; // prettier-ignore
    const survived = (opponent) =>
      combatXpAwards({ unit, opponent: { ...opponent, tier: 'base' }, opponentDied: false, damageDealt: 0, opponentHpAtStart: 20, survivedAttack: true }); // prettier-ignore
    expect(survived(summoned)).toEqual([]);
    expect(survived(plain)).toEqual([{ unit, baseXp: XP_DEFEND_SURVIVE, share: false }]);
  });
});

describe('the set piece carries the Vigil to the battle', () => {
  const piece = DEV_SET_PIECE_FIXTURES.dev_vigil;

  it('waking, the caps and the battle’s level range reach the locked config, mirrored', () => {
    const gameData = withDevSetPiece(data, 'dev_vigil');
    const params = { act: 'finalBoss', objective: 'rout', setPiece: 'dev_vigil', difficultyId: 'hard', deployCount: 3, levelRange: [12, 14], enemyLevelBonus: 1 }; // prettier-ignore
    const config = generateSeededBattle(params, gameData, 5);
    expect(config.vigil.levelRange).toEqual([13, 15]); // the adjusted range
    expect(config.vigil.maxCalled).toBe(8);
    const waking = config.vigil.sigils.filter((s) => s.waking);
    expect(waking).toHaveLength(1);
    expect(waking[0].target).toBe('voice_waking');
    const voice = config.enemySpawns.find((s) => s.authoredId === 'voice_waking');
    expect([waking[0].col, waking[0].row]).toEqual([voice.col, voice.row]);
    // A mirror keeps the flag on the Waking's (mirrored) tile.
    const built = buildSetPieceBattle({ setPiece: piece, act: 'finalBoss', difficultyId: 'hard', levelRange: [1, 1], deployCount: 3, classes: data.classes, terrain: data.terrain, random: () => 0.1 }); // prettier-ignore
    expect(built.mirrored).toBe(true);
    const mirroredWaking = built.vigil.sigils.find((s) => s.waking);
    expect(mirroredWaking).toMatchObject({ target: 'voice_waking', col: 12 - 4, row: 5 });
  });

  it('the validator refuses two Wakings, a bad cap and an unknown key', () => {
    const errorsFor = (edit) => {
      const gameData = structuredClone(withDevSetPiece(data, 'dev_vigil'));
      edit(gameData.setPieces.setPieces.find((p) => p.id === piece.id).variants[0].vigil);
      return validateSetPiecesConfig(gameData.setPieces, gameData).errors.join('\n');
    };
    expect(errorsFor(() => {})).toBe('');
    expect(errorsFor((v) => (v.sigils[0].waking = true))).toMatch(
      /at most one sigil is the Waking/,
    );
    expect(errorsFor((v) => (v.sigils[0].waking = 'yes'))).toMatch(/waking must be true or false/);
    expect(errorsFor((v) => (v.maxCalled = 0))).toMatch(/maxCalled must be a whole number/);
    expect(errorsFor((v) => (v.maxPerCircle = 2.5))).toMatch(/maxPerCircle must be a whole number/);
    expect(errorsFor((v) => (v.levelRange = [1, 2]))).toMatch(/unknown key "levelRange"/);
  });
});
