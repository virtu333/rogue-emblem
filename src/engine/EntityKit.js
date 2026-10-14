// EntityKit — the rules that keep the Entity from being picked apart from range on the higher
// rungs (the kit's numbers: EntityKitConfig.js and difficulty.json `entityKit`). Pure: no Phaser,
// no scene, never `Math.random`. Like Vigil.js, the one implementation behind BattleScene
// (ui/EntityLimbController.js, PostCombatEffects) and the headless harness, so the two cannot
// drift.
//
// THE GRASPING LIMBS (Nightfall and Black Sun). Every tile the army struck the Entity from in a
// player phase is noted (`noteEntityStrike`, from the post-combat effects). At the next enemy
// phase's start (right after the Vigil's step) a limb rises on each noted tile, or beside it when
// it is taken (the open neighbour nearest the Entity first), while fewer than `maxAlive` limbs
// stand and fewer than `maxSprouted` have risen in the battle. A limb is a one-tile foe (class
// Grasping Limb, MOV 0) that strikes what stands beside it; while it stands the Entity also
// strikes anyone within ENTITY_LIMB_REACH of it (EntitySystem.canEntityStrike). Cutting one
// down wounds the Entity for `woundPercent` of its max HP (never past 1 HP: the last blow is
// the army's to land). When the Entity falls its limbs wither with it.
// A limb is built on its own keyed stream, `keyedBattleRandom(battleSeed, 'limb:<turn>:<n>')`
// (`n`: how many have risen before it), so a rise never moves the battle stream and a resume or
// rewind that replays the phase raises the same limb. `_summonedBy: 'entity:limb'`
// (ConjuredUnits: gold 0, half the XP, no survival XP, no deed, no carry).
//
// THE UNDERTOW (Black Sun). An Entity counter that lands on a player unit that struck it drags
// the striker one tile toward the Entity's body (a forced move: an Ice slide carries on; nothing
// is dragged that already stands beside the body) and roots it until its next phase: no Canto,
// no Swap, Shove or Pull, no walking away after a Dance.
//
// The battle's state rides the suspend checkpoint and the Vision snapshot
// (BattleSnapshotState.captureBattleWorldState, as `entityKitState`):
//   { strikes: [{ col, row }], sprouted, severed, lastProcessedTurn }

import { keyedBattleRandom } from './BattleRng.js';
import { applyEnemyDifficultyModifiers, createUnit } from './UnitManager.js';
import {
  ENTITY_LIMB_SUMMONER,
  combatDistance,
  getFootprint,
  isEntity,
  isEntityLimb,
  livingEntityLimbs,
} from './EntitySystem.js';
import { entityKitOf } from './EntityKitConfig.js';
import { applyCondition } from './StatusConditionSystem.js';
import { damageUnit } from './UnitHealth.js';
import { traceForcedMove } from './ForcedMovement.js';
import { didCombatSideLandHit } from './WeaponArtPostCombat.js';
import { isDisplacementImmune } from './AffixSystem.js';

export const LIMB_CLASS = 'Grasping Limb';
export const LIMB_WEAPON = 'Grasping Coil';
/** A limb's level when no Entity stands to lend it its own (XP reads the level). */
export const LIMB_LEVEL = 20;
/** The most strike tiles a phase keeps (more than any kit can sprout). */
const STRIKES_KEPT = 16;
/** The undertow's root: until the dragged unit's next phase starts. */
export const UNDERTOW_ROOT_TURNS = 1;

export const ENTITY_KIT_HINTS = Object.freeze({
  dragged: 'Dragged!',
  held: 'Held!',
  severed: 'Severed!',
});

const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const count = (v) => Math.max(0, Math.trunc(Number(v) || 0));
const NEIGHBOURS = [
  { dc: -1, dr: 0 },
  { dc: 1, dr: 0 },
  { dc: 0, dr: -1 },
  { dc: 0, dr: 1 },
];

/** A fresh battle's state: no strike noted, nothing risen, no phase processed. */
export function createEntityKitState() {
  return { strikes: [], sprouted: 0, severed: 0, lastProcessedTurn: 0 };
}

/** A saved state, made whole. */
export function sanitizeEntityKitState(raw) {
  if (!isRecord(raw)) return createEntityKitState();
  const strikes = (Array.isArray(raw.strikes) ? raw.strikes : [])
    .filter((t) => isRecord(t) && Number.isInteger(t.col) && Number.isInteger(t.row))
    .slice(0, STRIKES_KEPT)
    .map((t) => ({ col: t.col, row: t.row }));
  return {
    strikes,
    sprouted: count(raw.sprouted),
    severed: count(raw.severed),
    lastProcessedTurn: count(raw.lastProcessedTurn),
  };
}

/** The state a battle on `config` starts with: only a kit with limbs keeps one. */
export function initialEntityKitState(config) {
  return entityKitOf(config)?.limbs ? createEntityKitState() : null;
}

/**
 * Note a tile the army struck the Entity from (mutates `state`: the battle's own object, as the
 * scene and the harness hold it). The same tile twice in a phase is one strike.
 */
export function noteEntityStrike(state, tile) {
  if (!state || !Number.isInteger(tile?.col) || !Number.isInteger(tile?.row)) return false;
  if (!Array.isArray(state.strikes)) state.strikes = [];
  if (state.strikes.some((t) => t.col === tile.col && t.row === tile.row)) return false;
  if (state.strikes.length >= STRIKES_KEPT) return false;
  state.strikes.push({ col: tile.col, row: tile.row });
  return true;
}

/** The living Entity among `units`, or null. */
export function livingEntity(units) {
  return (units || []).find((u) => isEntity(u) && u.currentHP > 0 && !u._removing) || null;
}

/**
 * Where a limb noted at `strike` rises: the tile itself when open and standable, else its open
 * neighbours, the nearest the Entity's body first (left, right, up, down on a tie), else nowhere.
 */
export function limbRiseTile(strike, entity, { cols, rows, isOccupied, moveCostAt }) {
  const open = (col, row) => {
    if (col < 0 || col >= cols || row < 0 || row >= rows || isOccupied(col, row)) return false;
    const cost = moveCostAt(col, row, 'Infantry');
    return cost != null && cost !== '--' && cost !== Infinity;
  };
  if (open(strike.col, strike.row)) return { col: strike.col, row: strike.row };
  const near = NEIGHBOURS.map(({ dc, dr }, i) => {
    const tile = { col: strike.col + dc, row: strike.row + dr };
    return { tile, i, dist: entity ? combatDistance(entity, tile) : 0 };
  })
    .filter(({ tile }) => open(tile.col, tile.row))
    .sort((a, b) => a.dist - b.dist || a.i - b.i);
  return near[0]?.tile || null;
}

/** The keyed-stream key of the battle's `ordinal`-th limb (0-based), risen on `turn`. */
export function limbKey(turn, ordinal) {
  return `limb:${Math.max(1, Math.trunc(Number(turn) || 1))}:${count(ordinal)}`;
}

/**
 * Build a Grasping Limb on `tile`. Pure: it places nothing and draws nothing from Math.random.
 * Its stats are the class's (no growths), at the Entity's level, with the rung's enemy stat
 * modifiers; it holds the Grasping Coil and nothing else.
 * @returns {object|null} the unit (hasActed false), or null when the class or weapon is missing
 */
export function buildGraspingLimb(tile, world) {
  const { classes, weapons, seed, turn, ordinal = 0, level, difficultyConfig = 1.0 } = world;
  const classData = (classes || []).find((c) => c?.name === LIMB_CLASS);
  const coil = (weapons || []).find((w) => w?.name === (classData?.enemyWeapon || LIMB_WEAPON));
  if (!classData || !coil) return null;
  const key = limbKey(turn, ordinal);
  const rng = keyedBattleRandom(Number(seed) >>> 0, key);
  const unit = createUnit({ ...classData, growthRanges: {} }, 1, weapons, {
    rng,
    faction: 'enemy',
    col: tile.col,
    row: tile.row,
  });
  const weapon = structuredClone(coil);
  // A uid from the key, not the global counter: the same rise replays the same item.
  weapon.uid = `itm_${key.replace(/[^a-zA-Z0-9]+/g, '_')}`;
  unit.level = count(level) || LIMB_LEVEL;
  unit.weapon = weapon;
  unit.inventory = [weapon];
  unit.consumables = [];
  unit.accessory = null;
  unit.skills = [];
  unit.isBoss = false;
  unit.isElite = false;
  unit._hitByPlayerThisPhase = false;
  unit._summonedBy = ENTITY_LIMB_SUMMONER;
  unit.hasMoved = false;
  unit.hasActed = false;
  applyEnemyDifficultyModifiers(unit, difficultyConfig);
  return unit;
}

/**
 * One enemy-phase start of the limbs: a limb rises for each tile noted since the last, within
 * the kit's caps. Pure: it changes none of its inputs; the caller adds each limb to its roster
 * and keeps the returned state. A turn already processed does nothing. With no Entity standing
 * the notes are dropped and nothing rises.
 * @returns {{ sprouts: { tile: object, unit: object }[], state: object, skipped: boolean }}
 */
export function limbPhaseStep({
  kit,
  state,
  enemyUnits = [],
  cols,
  rows,
  isOccupied,
  moveCostAt,
  turn,
  seed,
  classes,
  weapons,
  difficultyConfig = 1.0,
}) {
  const before = sanitizeEntityKitState(state);
  const phase = Math.max(1, Math.trunc(Number(turn) || 1));
  const limbs = kit?.limbs;
  if (!limbs || phase <= before.lastProcessedTurn)
    return { sprouts: [], state: before, skipped: true };
  const next = structuredClone(before);
  const entity = livingEntity(enemyUnits);
  const sprouts = [];
  if (entity) {
    let alive = livingEntityLimbs(enemyUnits).length;
    const placed = new Set();
    for (const strike of next.strikes) {
      if (alive >= limbs.maxAlive || next.sprouted >= limbs.maxSprouted) break;
      const tile = limbRiseTile(strike, entity, {
        cols,
        rows,
        // A tile an earlier limb took this phase is taken.
        isOccupied: (c, r) => placed.has(`${c},${r}`) || Boolean(isOccupied?.(c, r)),
        moveCostAt,
      });
      if (!tile) continue;
      const unit = buildGraspingLimb(tile, {
        classes,
        weapons,
        seed,
        turn: phase,
        ordinal: next.sprouted,
        level: entity.level,
        difficultyConfig,
      });
      if (!unit) continue;
      placed.add(`${tile.col},${tile.row}`);
      next.sprouted += 1;
      alive += 1;
      sprouts.push({ tile, unit });
    }
  }
  next.strikes = [];
  next.lastProcessedTurn = phase;
  return { sprouts, state: next, skipped: false };
}

/**
 * A limb fell to `killer`: the Entity takes `woundPercent` of its max HP, through UnitHealth with
 * a floor of 1 (a wound never fells it). Only a cut the army made counts (a player or NPC
 * killer), and only while the Entity stands. Mutates the Entity and `state.severed`.
 * @returns {{ entity: object, amount: number }|null}
 */
export function severLimb(limb, { kit, state, enemyUnits, killer }) {
  const limbs = kit?.limbs;
  if (!limbs || !isEntityLimb(limb) || !killer || killer.faction === 'enemy') return null;
  const entity = livingEntity(enemyUnits);
  if (!entity) return null;
  const wound = Math.max(1, Math.round(((entity.stats?.HP || 0) * limbs.woundPercent) / 100));
  const amount = limbs.woundPercent > 0 ? damageUnit(entity, wound, { floor: 1 }) : 0;
  if (state) state.severed = count(state.severed) + 1;
  return { entity, amount };
}

/**
 * The Entity fell: every limb of it still on `enemyUnits` withers with it (no killer: no gold,
 * no XP, no wound). Removes them from the array in place and returns them, as
 * Necromancy.crumbleFor does for a Necromancer's Skeletons.
 */
export function witherLimbs(enemyUnits) {
  if (!Array.isArray(enemyUnits)) return [];
  const withered = enemyUnits.filter(isEntityLimb);
  for (const limb of withered) {
    const i = enemyUnits.indexOf(limb);
    if (i >= 0) enemyUnits.splice(i, 1);
  }
  return withered;
}

/**
 * Where the undertow drags `unit`: one tile toward the nearest tile of the Entity's body (the
 * longer axis first, the other when that one is blocked), an Ice slide carrying on. Null when
 * it already stands beside the body or nothing can move it.
 * @returns {{ col, row, path, slid }|null}
 */
export function undertowPlan(unit, entity, { cols, rows, getMoveCost, getUnitAt }) {
  if (!unit || !entity || combatDistance(entity, unit) <= 1) return null;
  const fp = getFootprint(entity);
  const cs = fp.map((t) => t.col);
  const rs = fp.map((t) => t.row);
  const near = {
    col: Math.min(Math.max(unit.col, Math.min(...cs)), Math.max(...cs)),
    row: Math.min(Math.max(unit.row, Math.min(...rs)), Math.max(...rs)),
  };
  const dx = near.col - unit.col;
  const dy = near.row - unit.row;
  const axes = [
    { dc: Math.sign(dx), dr: 0, len: Math.abs(dx) },
    { dc: 0, dr: Math.sign(dy), len: Math.abs(dy) },
  ]
    .filter((a) => a.len > 0)
    .sort((a, b) => b.len - a.len);
  const grid = { cols, rows, getMoveCost };
  const occupant = (c, r) => {
    const u = getUnitAt(c, r);
    return u && u !== unit ? u : null;
  };
  for (const { dc, dr } of axes) {
    const landing = traceForcedMove(unit, dc, dr, 1, grid, occupant);
    if (landing.steps > 0)
      return {
        col: landing.col,
        row: landing.row,
        path: landing.path,
        slid: Boolean(landing.slid),
      };
  }
  return null;
}

/**
 * The kit's post-combat effects, after every other step (PostCombatEffects): a player unit that
 * struck the Entity has its tile noted for a limb, and on Black Sun a counter that landed drags
 * and holds it. Beats as PostCombatEffects documents them (`moved` is required).
 * `world.entityKit` (the locked config's kit), `world.entityKitState` (the battle's, mutated).
 */
export function* entityKitAfterCombat({ attacker, defender, result, strikeTile }, world) {
  const kit = world?.entityKit;
  if (!kit || !isEntity(defender) || attacker?.faction !== 'player') return;
  if (kit.limbs) noteEntityStrike(world.entityKitState, strikeTile);
  if (!kit.undertow || !(attacker.currentHP > 0) || !(defender.currentHP > 0)) return;
  if (!didCombatSideLandHit(result?.events, 'defender', attacker, defender)) return;
  if (!isDisplacementImmune(attacker, world.affixes)) {
    const plan = undertowPlan(attacker, defender, world);
    if (plan) {
      const from = { col: attacker.col, row: attacker.row };
      attacker.col = plan.col;
      attacker.row = plan.row;
      const to = { col: plan.col, row: plan.row };
      const slides = plan.slid ? [{ unit: attacker, from, to, path: plan.path }] : [];
      yield { kind: 'moved', units: [attacker], ...(slides.length > 0 ? { slides } : {}) };
      yield { kind: 'hint', unit: attacker, text: ENTITY_KIT_HINTS.dragged, tone: 'bad' };
    }
  }
  if (applyCondition(attacker, 'root', UNDERTOW_ROOT_TURNS, { recoveryChance: 0 })) {
    yield { kind: 'status', unit: attacker, status: 'root' };
    yield { kind: 'hint', unit: attacker, text: ENTITY_KIT_HINTS.held, tone: 'bad' };
  }
}

/** The post-combat world's kit fields for an owner (the scene or the harness). */
export function entityKitWorld(owner) {
  const kit = entityKitOf(owner?.battleConfig);
  if (!kit) return {};
  if (kit.limbs && !owner._entityKitState) owner._entityKitState = createEntityKitState();
  return { entityKit: kit, entityKitState: owner._entityKitState ?? null };
}

/**
 * What the forecast says under the Entity when a player unit is about to strike it with the kit
 * in play, or '' (forecastDisplay shows it as the side's note): where a limb will rise, and on
 * Black Sun that a counter drags and roots.
 */
export function entityKitForecastNote(kit, attacker, defender, forecast = null) {
  if (!kit || !isEntity(defender) || attacker?.faction !== 'player') return '';
  const parts = [];
  if (kit.limbs) parts.push('A limb rises where you strike from');
  if (kit.undertow && forecast?.defender?.canCounter !== false)
    parts.push('a counter that lands drags you in and roots you');
  if (parts.length === 0) return '';
  const text = parts.join(' · ');
  return text[0].toUpperCase() + text.slice(1);
}
