// Vigil — the court circle's Voices speak words and their summoning circles call Hollowed
// (docs/specs/act-v-descent.md §3.1, §5.2, §9.5). Pure: no Phaser, no scene, never
// `Math.random`. Modelled on Necromancy.js, and like it the one implementation behind
// BattleScene (ui/VigilController.js) and the headless harness (`_processVigil`), so the two
// cannot drift.
//
// battleConfig.vigil (SetPieces.js builds it from a variant, mirrored with the map; MapGenerator
// adds `levelRange`; locked with the map):
//   { sigils:  [{ id, col, row, target, waking? }],   // `target`: the Voice's authoredId
//     circles: [{ id, col, row, voice }],             // `voice`: the Voice that keeps it
//     maxCalled?, maxPerCircle?,                      // caps (defaults below)
//     levelRange: [lo, hi],                           // the battle's adjusted range
//     perWordLevel?, levelCap? }                      // the Rite's level rule (defaults below)
//
// The step runs at each enemy-phase start, right after the Necromancer's raise:
//   - THE WORDS. Each living Voice standing on its sigil speaks one word; the Waking (its sigil
//     `waking: true`) speaks two while every other Voice lives. A Voice moved off its sigil
//     speaks nothing until it walks back (SiegeArtillery's post return). No draw.
//   - THE SUMMONS. Then each circle, in order, whose Voice lives and that no player or NPC
//     unit covers, calls one Hollowed onto the circle, or onto its first free passable
//     neighbour in `riseTile` order (left, right, up, down), or not at all. A silenced Voice
//     closes its circle for good (a Voice never rises again: the set-piece validator refuses a
//     Zombie target). At most `maxCalled` (8) in a battle, and `maxPerCircle` per circle when
//     the data names one. The Hollowed is built on its own keyed stream,
//     `keyedBattleRandom(battleSeed, 'summon:<circle>:<turn>:<n>')` (`n`: how many that circle
//     has called before), never the battle's `Math.random`, so a call leaves the battle stream
//     where it was and a resume or rewind that replays the phase calls the same unit.
//   - THE LEVEL. A Hollowed rolls in the battle's adjusted range (the filler rule) and adds
//     min(levelCap, floor((riteAtEntry + words) / perWordLevel)), where `words` counts this
//     battle's words so far, this phase's included (the Voices speak before the circles call).
//     `riteAtEntry` is the run's Rite at the battle's start (battleParams.riteAtEntry, from
//     RunManager.getBattleParams; 0 with no Rite). The per-word rule's numbers are the Rite's
//     (descent.json `rite`, written into the locked vigil at generation from
//     battleParams.riteLevel); without them the defaults stand in.
//     A Hollowed is a base class: never above BASE_CLASS_LEVEL_CAP.
//   - THE CALLED. `_summonedBy: 'circle:<id>'` (ConjuredUnits.isSummonedUnit): gold 0, half the
//     XP, no survival XP, no deed record, no carry. It has not acted, so it acts in that same
//     phase (as a raised Skeleton does). It is never a `defeat` target (no authoredId) and never
//     falls with its Voice: the guards and the called need not die (BattleObjectives).
//
// The battle's state rides the suspend checkpoint and the Vision snapshot
// (BattleSnapshotState.captureBattleWorldState, as `vigilState`):
//   { words, byVoice: { <voiceId>: n }, byCircle: { <circleId>: n }, summoned,
//     lastProcessedTurn }
// `lastProcessedTurn` makes the step run at most once a turn: an enemy-phase resume skips the
// turn-start pipeline anyway, and a pipeline that ran twice for a turn speaks and calls once.
// A rewind restores the earlier state with the earlier units, so the phase replays exactly.
// The words are only counted here; the run's Rite takes them at the victory commit
// (RunManager.completeBattle `riteWords`, engine/Rite.js), never from a battle in progress.

import { BASE_CLASS_LEVEL_CAP } from '../utils/constants.js';
import { keyedBattleRandom } from './BattleRng.js';
import { riseTile } from './ZombieRemains.js';
import {
  applyEnemyDifficultyModifiers,
  createUnit,
  parseWeaponProficiencies,
} from './UnitManager.js';
import { HOLLOWED_CLASS, ironWeaponOfType } from './Necromancy.js';
import { SUMMONED_XP_MULTIPLIER, isSummonedUnit } from './ConjuredUnits.js';

export { HOLLOWED_CLASS, SUMMONED_XP_MULTIPLIER, isSummonedUnit };

/** At most this many Hollowed are called in a battle (spec §3.1 *tune*). */
export const VIGIL_MAX_CALLED = 8;
/** A Hollowed gains a level per this many words (spec §5.2 *tune*; the Rite's `perWordLevel`). */
export const HOLLOWED_PER_WORD_LEVEL = 4;
/** ...and at most this many (spec §5.2 *tune*; the Rite's `levelCap`). */
export const HOLLOWED_LEVEL_CAP = 4;
/** The Waking's word while every other Voice lives. */
export const WAKING_WORDS = 2;

/** The `_summonedBy` a circle's Hollowed carries. */
export const summonedByOf = (circleId) => `circle:${circleId}`;

const alive = (unit) => Boolean(unit) && unit.currentHP > 0 && !unit._removing;
const count = (value) => Math.max(0, Math.trunc(Number(value) || 0));
const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const positiveInt = (value, fallback) => (Number.isInteger(value) && value >= 1 ? value : fallback);

/** The config's sigils and circles as lists (never null). */
function partsOf(vigil) {
  return {
    sigils: Array.isArray(vigil?.sigils) ? vigil.sigils : [],
    circles: Array.isArray(vigil?.circles) ? vigil.circles : [],
  };
}

/** A fresh battle's state: nothing spoken, nothing called, no phase processed. */
export function createVigilState() {
  return { words: 0, byVoice: {}, byCircle: {}, summoned: 0, lastProcessedTurn: 0 };
}

/** A saved state, made whole: counts are whole numbers from 0, maps of ids to counts. */
export function sanitizeVigilState(raw) {
  if (!isRecord(raw)) return createVigilState();
  const counts = (map) =>
    isRecord(map)
      ? Object.fromEntries(
          Object.entries(map)
            .filter(([id]) => typeof id === 'string' && id)
            .map(([id, n]) => [id, count(n)]),
        )
      : {};
  return {
    words: count(raw.words),
    byVoice: counts(raw.byVoice),
    byCircle: counts(raw.byCircle),
    summoned: count(raw.summoned),
    lastProcessedTurn: count(raw.lastProcessedTurn),
  };
}

/** The living Voice an authored id names (null when it has fallen). */
export function voiceUnit(voiceId, enemyUnits) {
  if (typeof voiceId !== 'string' || !voiceId) return null;
  return (enemyUnits || []).find((u) => alive(u) && u.authoredId === voiceId) || null;
}

/**
 * How many of this Vigil's Voices have fallen (are no longer on the field). Read from the
 * roster alone, so a resume or a Vision rewind (which restore it) count the same: the one
 * "which fall is this" the presentation needs. Called as a Voice leaves the roster, it counts it.
 * A Voice counts once it is off the roster, never at 0 HP (array presence, the objective's own
 * test, BattleObjectives): an area art that drops two Voices at once leaves both at 0 HP before
 * removeUnit takes the first, and that first fall must still count as one.
 */
export function voicesFallen(vigil, enemyUnits) {
  const targets = new Set(partsOf(vigil).sigils.map((s) => s.target));
  const onField = new Set((enemyUnits || []).filter(Boolean).map((u) => u.authoredId));
  let fallen = 0;
  for (const id of targets) if (!onField.has(id)) fallen++;
  return fallen;
}

/** Is `unit` one of this Vigil's Voices (a sigil's target)? */
export function isVoiceOf(vigil, unit) {
  const id = unit?.authoredId;
  return typeof id === 'string' && partsOf(vigil).sigils.some((s) => s.target === id);
}

/** The sigil a Voice keeps (null for any other unit). */
export function sigilOf(vigil, unit) {
  const id = unit?.authoredId;
  return (typeof id === 'string' && partsOf(vigil).sigils.find((s) => s.target === id)) || null;
}

/**
 * What each sigil's Voice speaks now, in sigil order: 1 on its sigil, the Waking 2 while every
 * other Voice lives, 0 off its sigil or fallen. No draw.
 * @returns {{ voiceId: string, sigilId: string, count: number }[]} only those that speak
 */
export function wordsSpoken(vigil, enemyUnits) {
  const { sigils } = partsOf(vigil);
  const spoken = [];
  for (const sigil of sigils) {
    const voice = voiceUnit(sigil.target, enemyUnits);
    if (!voice || voice.col !== sigil.col || voice.row !== sigil.row) continue;
    const othersLive = sigils.every(
      (other) => other === sigil || Boolean(voiceUnit(other.target, enemyUnits)),
    );
    const n = sigil.waking === true && othersLive ? WAKING_WORDS : 1;
    spoken.push({ voiceId: sigil.target, sigilId: sigil.id, count: n });
  }
  return spoken;
}

/** Does a player or NPC unit stand on (col, row)? A circle so covered calls nothing. */
function coveredBy(tile, playerUnits, npcUnits) {
  return [...(playerUnits || []), ...(npcUnits || [])].some(
    (u) => alive(u) && u.col === tile.col && u.row === tile.row,
  );
}

/**
 * The Rite's level bonus for a Hollowed called after `words` words of this battle:
 * min(levelCap, floor((riteAtEntry + words) / perWordLevel)).
 */
export function hollowedLevelBonus({
  riteAtEntry = 0,
  words = 0,
  perWordLevel = HOLLOWED_PER_WORD_LEVEL,
  levelCap = HOLLOWED_LEVEL_CAP,
} = {}) {
  const per = positiveInt(perWordLevel, HOLLOWED_PER_WORD_LEVEL);
  const cap = Math.max(0, Math.trunc(Number(levelCap) || 0));
  return Math.min(cap, Math.floor((count(riteAtEntry) + count(words)) / per));
}

/** The keyed-stream key of a circle's `ordinal`-th call (0-based) on `turn`. */
export function summonKey(circleId, turn, ordinal) {
  return `summon:${circleId}:${Math.max(1, Math.trunc(Number(turn) || 1))}:${count(ordinal)}`;
}

/**
 * Build the Hollowed `circle` calls onto `tile`, from its keyed stream: the level roll first
 * (one draw), then its weapon (one draw), then the unit's growths and level-ups. Pure: it places
 * nothing and draws nothing from Math.random. A called unit never carries (EnemyCarry) and
 * holds its one Iron weapon and nothing else.
 * @param {{ id: string }} circle
 * @param {{ col: number, row: number }} tile
 * @param {{ classes: object[], weapons: object[], seed: number, turn: number, ordinal?: number,
 *   levelRange?: number[], levelBonus?: number, difficultyConfig?: object|number }} world
 * @returns {object|null} the unit (hasActed false), or null when the Hollowed class or an
 *   Iron weapon is missing from the data
 */
export function buildSummonedHollowed(circle, tile, world) {
  const {
    classes,
    weapons,
    seed,
    turn,
    ordinal = 0,
    levelRange = [1, 1],
    levelBonus = 0,
    difficultyConfig = 1.0,
  } = world;
  const classData = (classes || []).find((c) => c?.name === HOLLOWED_CLASS);
  if (!classData || typeof circle?.id !== 'string') return null;
  const key = summonKey(circle.id, turn, ordinal);
  const rng = keyedBattleRandom(Number(seed) >>> 0, key);

  const lo = Math.max(1, Math.trunc(Number(levelRange?.[0]) || 1));
  const hi = Math.max(lo, Math.trunc(Number(levelRange?.[1]) || lo));
  const rolled = lo + Math.floor(rng() * (hi - lo + 1));
  const level = Math.min(BASE_CLASS_LEVEL_CAP, Math.max(1, rolled + count(levelBonus)));

  const armed = parseWeaponProficiencies(classData.weaponProficiencies)
    .map((prof) => ironWeaponOfType(weapons, prof.type))
    .filter(Boolean);
  if (armed.length === 0) return null;
  const weapon = structuredClone(armed[Math.floor(rng() * armed.length)]);
  // A uid from the key, not the global counter: the same call replays the same item.
  weapon.uid = `itm_${key.replace(/[^a-zA-Z0-9]+/g, '_')}`;

  const unit = createUnit(classData, level, weapons, {
    rng,
    faction: 'enemy',
    col: tile.col,
    row: tile.row,
  });
  unit.weapon = weapon;
  unit.inventory = [weapon];
  unit.consumables = [];
  unit.accessory = null;
  unit.skills = [];
  unit.isBoss = false;
  unit.isElite = false;
  unit._hitByPlayerThisPhase = false;
  unit._summonedBy = summonedByOf(circle.id);
  unit.hasMoved = false;
  unit.hasActed = false;
  applyEnemyDifficultyModifiers(unit, difficultyConfig);
  return unit;
}

/**
 * One enemy-phase start of the Vigil: the words, then the summons. Pure: it changes none of its
 * inputs; the caller adds each summoned unit to its roster and keeps the returned state.
 * A turn already processed (`state.lastProcessedTurn`) does nothing.
 * @param {object} p
 * @param {object} p.vigil the locked config's `vigil`
 * @param {object|null} p.state the battle's vigilState (null: a fresh one)
 * @param {object[]} p.enemyUnits, p.playerUnits, p.npcUnits the live board
 * @param {number} p.cols, p.rows
 * @param {(col: number, row: number) => boolean} p.isOccupied every unit, seen or not
 * @param {(col: number, row: number, moveType: string) => any} p.moveCostAt
 * @param {number} p.turn
 * @param {number} p.seed the battle's seed (the reinforcement seed, as the raise's)
 * @param {number} [p.riteAtEntry] the run's Rite at the battle's start
 * @param {object[]} p.classes, p.weapons
 * @param {object|number} [p.difficultyConfig]
 * @returns {{ words: { voiceId: string, sigilId: string, count: number }[],
 *   summons: { circleId: string, voiceId: string, tile: { col: number, row: number },
 *   unit: object }[], state: object, skipped: boolean }}
 */
export function vigilPhaseStep({
  vigil,
  state,
  enemyUnits = [],
  playerUnits = [],
  npcUnits = [],
  cols,
  rows,
  isOccupied,
  moveCostAt,
  turn,
  seed,
  riteAtEntry = 0,
  classes,
  weapons,
  difficultyConfig = 1.0,
}) {
  const before = sanitizeVigilState(state);
  const phase = Math.max(1, Math.trunc(Number(turn) || 1));
  if (!vigil || phase <= before.lastProcessedTurn)
    return { words: [], summons: [], state: before, skipped: true };
  const next = structuredClone(before);

  // The words first: the summons read the battle's count with this phase's words in it.
  const words = wordsSpoken(vigil, enemyUnits);
  for (const word of words) {
    next.words += word.count;
    next.byVoice[word.voiceId] = count(next.byVoice[word.voiceId]) + word.count;
  }

  const maxCalled = positiveInt(vigil.maxCalled, VIGIL_MAX_CALLED);
  const maxPerCircle = positiveInt(vigil.maxPerCircle, Infinity);
  const levelBonus = hollowedLevelBonus({
    riteAtEntry,
    words: next.words,
    perWordLevel: vigil.perWordLevel,
    levelCap: vigil.levelCap ?? HOLLOWED_LEVEL_CAP,
  });
  const placed = new Set();
  const summons = [];
  for (const circle of partsOf(vigil).circles) {
    if (next.summoned >= maxCalled) break;
    const called = count(next.byCircle[circle.id]);
    if (called >= maxPerCircle) continue;
    const voice = voiceUnit(circle.voice, enemyUnits);
    if (!voice) continue; // silenced: the circle is closed for good
    if (coveredBy(circle, playerUnits, npcUnits)) continue;
    const tile = riseTile(
      { col: circle.col, row: circle.row, snapshot: { moveType: 'Infantry' } },
      {
        cols,
        rows,
        // A tile an earlier circle's Hollowed took this phase is taken.
        isOccupied: (c, r) => placed.has(`${c},${r}`) || Boolean(isOccupied?.(c, r)),
        moveCostAt,
      },
    );
    if (!tile) continue; // no room on or beside the circle: nothing is called
    const unit = buildSummonedHollowed(circle, tile, {
      classes,
      weapons,
      seed,
      turn: phase,
      ordinal: called,
      levelRange: vigil.levelRange,
      levelBonus,
      difficultyConfig,
    });
    if (!unit) continue;
    placed.add(`${tile.col},${tile.row}`);
    next.byCircle[circle.id] = called + 1;
    next.summoned += 1;
    summons.push({ circleId: circle.id, voiceId: circle.voice, tile, unit });
  }
  next.lastProcessedTurn = phase;
  return { words, summons, state: next, skipped: false };
}

/**
 * What the markers draw, from the board as it stands (the controller applies the fog):
 * each sigil with its Voice (alive, on it) and each circle (its Voice alive, covered).
 */
export function vigilBoardView(vigil, { enemyUnits = [], playerUnits = [], npcUnits = [] } = {}) {
  const { sigils, circles } = partsOf(vigil);
  return {
    sigils: sigils.map((sigil) => {
      const voice = voiceUnit(sigil.target, enemyUnits);
      return {
        id: sigil.id,
        col: sigil.col,
        row: sigil.row,
        voiceId: sigil.target,
        waking: sigil.waking === true,
        voice,
        onSigil: Boolean(voice) && voice.col === sigil.col && voice.row === sigil.row,
      };
    }),
    circles: circles.map((circle) => {
      const voice = voiceUnit(circle.voice, enemyUnits);
      return {
        id: circle.id,
        col: circle.col,
        row: circle.row,
        voiceId: circle.voice,
        voice,
        covered: coveredBy(circle, playerUnits, npcUnits),
      };
    }),
  };
}
