// PostCombatEffects — what happens after a combat resolves: on-hit affixes, Intimidate,
// Divine Charge, and weapon-art Tier 2 / Tier 5 / miss / kill effects. The single
// implementation behind BattleScene and the headless harness (no Phaser deps).
//
// It is a generator. Every state change happens here, in order; between changes it
// yields "beats" for the caller to act on:
//   { kind: 'remove', unit, killer }  REQUIRED — the unit fell; remove it now
//   { kind: 'moved', units }          REQUIRED — units changed tile; refresh what
//                                     depends on positions (fog, danger)
//   { kind: 'hp', unit }              presentation — HP changed
//   { kind: 'poison', unit, amount }  presentation — a damage-over-time number
//   { kind: 'status', unit, status }  presentation — a status condition landed
//   { kind: 'hint', unit, text, tone} presentation — a short floating label
// The scene awaits each beat (a death animation plays before the next effect); the
// harness acts on the required beats and skips the rest. Either way the effects
// resolve in the same order against the same state.
//
// `world` is the battle as these effects see it:
//   affixes                         gameData.affixes
//   cols, rows, getMoveCost(col, row, moveType), getUnitAt(col, row)
//   hostilesOf(unit), alliesOf(unit)   (area victims; Divine Charge / buff allies)
//   getTerrainAt?(col, row)            (an area victim's terrain DEF; none when absent)
//   turnNumber
//
// Area arts also leave a credit for every victim they hit on `result.areaCredits`
// ({ source, victim, damage, hpBefore, killed }): plain state for the owner's XP award,
// read after the effects finish, so presentation can never lose one.

import { applyGrievousStatus, getAttackAffixes, isDisplacementImmune } from './AffixSystem.js';
import { planAreaBlows } from './AreaDamage.js';
import { gridDistance } from './Combat.js';
import { applyCondition } from './StatusConditionSystem.js';
import { damageUnit, healUnit, setUnitHP } from './UnitHealth.js';
import { applyBattleDebuff } from './BattleStatDeltas.js';
import { applyTimedBuffEntry, resolveTimedBuffExpiry } from './TimedWeaponArtBuffs.js';
import {
  didCombatSideLandHit,
  getPostCombatPipelineSteps,
  resolvePostCombatMove,
} from './WeaponArtPostCombat.js';

const STATUS_LABELS = { root: 'Rooted!', silence: 'Silenced!', sleep: 'Asleep!', acid: 'Acid!' };

/** Every post-combat effect of one resolved combat, in pipeline order. */
export function* postCombatEffects(
  { attacker, defender, result, attackerWeaponArt = null, defenderWeaponArt = null },
  world,
) {
  const steps = getPostCombatPipelineSteps({
    attacker,
    defender,
    result,
    attackerWeaponArt,
    defenderWeaponArt,
  });
  for (const step of steps) {
    const sourceUnit = step.sourceSide === 'defender' ? defender : attacker;
    const targetUnit = step.targetSide
      ? step.targetSide === 'attacker'
        ? attacker
        : defender
      : step.sourceSide === 'defender'
        ? attacker
        : defender;
    yield* postCombatStep(step, { attacker, defender, result, sourceUnit, targetUnit }, world);
  }
}

function* postCombatStep(step, { attacker, defender, result, sourceUnit, targetUnit }, world) {
  switch (step.type) {
    case 'affix':
      yield* onAttackAffixes(sourceUnit, targetUnit, result.events, step.sourceSide, world);
      break;
    case 'poison':
      // resolveCombat already took the poison off; this is its number.
      if (targetUnit && targetUnit.currentHP > 0)
        yield { kind: 'poison', unit: targetUnit, amount: step.damage };
      break;
    case 'debuff':
      if (!targetUnit || targetUnit.currentHP <= 0) break;
      for (const [stat, val] of Object.entries(step.debuffs || {})) {
        applyBattleDebuff(targetUnit, stat, val);
      }
      yield { kind: 'hint', unit: targetUnit, text: 'Intimidated!', tone: 'intimidate' };
      break;
    case 'divine_charge':
      yield* divineChargeHeal(step, attacker, defender, world);
      break;
    case 'tier2_damage':
      if (!targetUnit || targetUnit.currentHP <= 0) break;
      yield* damageOverTime(targetUnit, step.amount, step.nonLethal ? 1 : 0);
      break;
    case 'tier2_debuff':
      if (!targetUnit || targetUnit.currentHP <= 0) break;
      applyBattleDebuff(targetUnit, step.stat, step.amount);
      yield {
        kind: 'hint',
        unit: targetUnit,
        text: `-${Math.abs(step.amount)} ${step.stat}`,
        tone: 'bad',
      };
      break;
    case 'tier2_status': {
      if (!targetUnit || targetUnit.currentHP <= 0) break;
      // durationPhases = full phases; recovery decrements at the start of the
      // afflicted side's phase before it acts, hence the +1.
      const applied = applyCondition(targetUnit, step.status, step.durationPhases + 1, {
        recoveryChance: 0,
      });
      if (!applied) {
        // A statusImmunity accessory (or an invalid status) blocked it.
        yield { kind: 'hint', unit: targetUnit, text: 'Immune!', tone: 'good' };
        break;
      }
      yield { kind: 'status', unit: targetUnit, status: step.status };
      yield {
        kind: 'hint',
        unit: targetUnit,
        text: STATUS_LABELS[step.status] || 'Afflicted!',
        tone: 'status',
      };
      break;
    }
    case 'art_miss_self_damage':
      if (!targetUnit || targetUnit.currentHP <= 0) break;
      yield* damageOverTime(targetUnit, step.amount, step.nonLethal === false ? 0 : 1);
      break;
    case 'art_kill_buff':
      if (!sourceUnit || sourceUnit.currentHP <= 0) break;
      if (!targetUnit || targetUnit.currentHP > 0) break;
      {
        const { expiryPhase, expiryTurn } = resolveTimedBuffExpiry(
          sourceUnit,
          world.turnNumber,
          step.durationPhases,
        );
        applyTimedBuffEntry(sourceUnit, {
          key: `${String(step.artId || 'kill_buff')}::${String(sourceUnit.name || '')}::self`,
          artId: step.artId || null,
          sourceName: sourceUnit.name || null,
          sourceFaction: sourceUnit.faction || null,
          expiryPhase,
          expiryTurn,
          stats: { ...(step.stats || {}) },
        });
        yield { kind: 'hint', unit: sourceUnit, text: 'Bloodlust!', tone: 'bloodlust' };
      }
      break;
    case 'tier2_move':
      yield* postCombatMove(sourceUnit, targetUnit, step, world, result);
      break;
    case 'tier2_set_hp':
      yield* setHp(step, sourceUnit, targetUnit);
      break;
    case 'area_damage':
      yield* areaDamage(step, sourceUnit, targetUnit, world, result);
      break;
    case 'ally_heal':
      yield* allyHeal(step, sourceUnit, world);
      break;
    case 'tier5_ally_buff':
      yield* allyBuff(step, sourceUnit, world);
      break;
    default:
      break;
  }
}

function* damageOverTime(unit, amount, floor) {
  const actual = damageUnit(unit, amount, { floor });
  if (actual > 0) {
    yield { kind: 'hp', unit };
    yield { kind: 'poison', unit, amount: actual };
  }
}

/** On-hit affixes of the side that landed a hit (poison never kills; a stat debuff; Wounded). */
function* onAttackAffixes(attacker, defender, events, sourceSide, world) {
  if (!attacker || !defender || defender.currentHP <= 0) return;
  const side = sourceSide || null;
  const didLandHit = side
    ? didCombatSideLandHit(
        events,
        side,
        side === 'attacker' ? attacker : defender,
        side === 'attacker' ? defender : attacker,
      )
    : events.some((e) => e.type === 'strike' && !e.miss && e.attacker === attacker.name);
  if (!didLandHit || !attacker.affixes?.length) return;
  const affixResult = getAttackAffixes(attacker, world.affixes);

  if (affixResult.poisonDamage > 0 && defender.currentHP > 0) {
    damageUnit(defender, affixResult.poisonDamage, { floor: 1 });
    yield { kind: 'hp', unit: defender };
    yield { kind: 'poison', unit: defender, amount: affixResult.poisonDamage };
  }

  if (affixResult.debuffStat && defender.currentHP > 0) {
    applyBattleDebuff(defender, affixResult.debuffStat, affixResult.debuffValue);
    yield {
      kind: 'hint',
      unit: defender,
      text: `-${Math.abs(affixResult.debuffValue)} ${affixResult.debuffStat}`,
      tone: 'bad',
    };
  }

  // Grievous: the hit leaves the defender Wounded (no healing but a staff's).
  if (affixResult.inflictStatus && defender.currentHP > 0) {
    if (applyGrievousStatus(defender, affixResult)) {
      yield { kind: 'status', unit: defender, status: affixResult.inflictStatus };
      yield { kind: 'hint', unit: defender, text: 'Wounded', tone: 'bad' };
    }
  }
}

/** Divine Charge: part of the damage dealt heals the most-hurt ally in range. */
function* divineChargeHeal(step, attacker, defender, world) {
  const caster = step.side === 'defender' ? defender : attacker;
  if (!caster || caster.currentHP <= 0) return;
  const healAmount = Math.floor((step.damageDealt * step.percent) / 100);
  if (healAmount <= 0) return;
  const allies = world
    .alliesOf(caster)
    .filter(
      (u) =>
        u.currentHP > 0 &&
        u.currentHP < u.stats.HP &&
        u !== caster &&
        gridDistance(caster.col, caster.row, u.col, u.row) <= step.range,
    );
  if (allies.length === 0) return;
  allies.sort((a, b) => a.currentHP / a.stats.HP - b.currentHP / b.stats.HP);
  const healTarget = allies[0];
  const actualHeal = healUnit(healTarget, healAmount);
  yield { kind: 'hp', unit: healTarget };
  if (actualHeal > 0)
    yield { kind: 'hint', unit: healTarget, text: `+${actualHeal} HP`, tone: 'heal' };
}

function* postCombatMove(sourceUnit, targetUnit, step, world, result) {
  if (!sourceUnit) return;
  const moveResult = resolvePostCombatMove({
    sourceUnit,
    targetUnit,
    mode: step.mode,
    distance: step.distance,
    cols: world.cols,
    rows: world.rows,
    getMoveCost: world.getMoveCost,
    getUnitAt: world.getUnitAt,
    isImmovable: (unit) => isDisplacementImmune(unit, world.affixes),
  });
  if (!moveResult.ok) {
    const pinned = moveResult.reason === 'rooted' || moveResult.reason === 'immovable';
    if (step.mode === 'ram' && pinned && targetUnit?.currentHP > 0)
      yield { kind: 'hint', unit: targetUnit, text: 'Braced!', tone: 'good' };
    return;
  }
  const units = [];
  for (const assignment of moveResult.assignments) {
    assignment.unit.col = assignment.col;
    assignment.unit.row = assignment.row;
    units.push(assignment.unit);
  }
  if (units.length > 0) yield { kind: 'moved', units };
  if (moveResult.collision) yield* collide(step, sourceUnit, targetUnit, moveResult, world, result);
}

/**
 * A ram that stopped short: the target takes the collision damage, and so does a foe of
 * the user it hit (an ally of the user never). Both take their damage before either
 * falls. The target is the combat's primary, so its owner removes it (and pays its XP);
 * the obstacle is an area victim: it falls here and leaves a credit.
 */
function* collide(step, sourceUnit, targetUnit, moveResult, world, result) {
  const amount = Math.max(0, Math.trunc(Number(step.collisionDamage) || 0));
  if (amount <= 0) return;
  const obstacle = moveResult.collision.obstacle;
  const hostile =
    obstacle && obstacle.currentHP > 0 && world.hostilesOf(sourceUnit).includes(obstacle);
  const struck = [targetUnit, hostile ? obstacle : null].filter((u) => u && u.currentHP > 0);
  const dealt = new Map();
  for (const unit of struck) {
    const hpBefore = unit.currentHP;
    const actual = damageUnit(unit, amount);
    dealt.set(unit, { hpBefore, actual });
    if (actual <= 0) continue;
    yield { kind: 'hp', unit };
    yield { kind: 'hint', unit, text: `Crash -${actual}`, tone: 'splash' };
  }
  if (hostile && dealt.get(obstacle)?.actual > 0) {
    if (result)
      (result.areaCredits ||= []).push({
        source: sourceUnit,
        victim: obstacle,
        damage: dealt.get(obstacle).actual,
        hpBefore: dealt.get(obstacle).hpBefore,
        killed: obstacle.currentHP <= 0,
      });
    if (obstacle.currentHP <= 0) yield { kind: 'remove', unit: obstacle, killer: sourceUnit };
  }
}

/** Benediction: on hit, each ally beside the user heals a share of the damage dealt. */
function* allyHeal(step, sourceUnit, world) {
  if (!sourceUnit || sourceUnit.currentHP <= 0) return;
  const amount = Math.floor(
    (Math.max(0, Number(step.dealt) || 0) * (Number(step.percent) || 0)) / 100,
  );
  if (amount <= 0) return;
  const radius = Math.max(0, Math.trunc(Number(step.radius) || 0));
  const allies = world
    .alliesOf(sourceUnit)
    .filter((ally) => ally && ally !== sourceUnit && ally.currentHP > 0)
    .filter((ally) => gridDistance(sourceUnit.col, sourceUnit.row, ally.col, ally.row) <= radius)
    .sort((a, b) => {
      const da = gridDistance(sourceUnit.col, sourceUnit.row, a.col, a.row);
      const db = gridDistance(sourceUnit.col, sourceUnit.row, b.col, b.row);
      if (da !== db) return da - db;
      if (a.row !== b.row) return a.row - b.row;
      return a.col - b.col;
    });
  for (const ally of allies) {
    const healed = healUnit(ally, amount);
    if (healed <= 0) continue;
    yield { kind: 'hp', unit: ally };
    yield { kind: 'hint', unit: ally, text: `+${healed} HP`, tone: 'heal' };
  }
}

function* setHp(step, sourceUnit, targetUnit) {
  if (!sourceUnit || sourceUnit.currentHP <= 0) return;
  if (!targetUnit || targetUnit.currentHP <= 0) return;
  const value = Math.max(1, Math.trunc(Number(step?.value) || 0));
  if (value <= 0) return;
  const maxHp = Math.max(1, Math.trunc(Number(targetUnit.stats?.HP) || 1));
  const nextHp = Math.min(maxHp, value);
  if (targetUnit.currentHP === nextHp) return;
  setUnitHP(targetUnit, nextHp);
  yield { kind: 'hp', unit: targetUnit };
  yield { kind: 'hint', unit: targetUnit, text: `HP -> ${nextHp}`, tone: 'warn' };
}

/**
 * An area art's blows (docs/specs/aoe-weapon-arts.md §2.3), in two phases: every victim
 * takes its blow(s) first, then each one the blows dropped falls, in area order. So a
 * death's own effects (a Deathburst) can never change another victim's blow, and the
 * preview, which is the first phase, is exact. Each victim hit leaves one credit.
 */
export function* areaDamage(step, sourceUnit, primary, world, result = null) {
  if (!sourceUnit || !step?.area) return;
  if (step.requiresLiveSource !== false && sourceUnit.currentHP <= 0) return;
  const plan = planAreaBlows({
    source: sourceUnit,
    primary,
    center: step.center ?? null,
    area: step.area,
    units: world.hostilesOf(sourceUnit),
    world,
    strikeMods: step.strikeMods,
  });
  if (plan.length <= 0) return;
  const blows = Math.max(0, Math.trunc(Number(step.blows) || 0));
  const floor = step.area.nonLethal ? 1 : 0;
  const label = step.area.shape === 'line' ? 'Pierce' : 'Splash';
  const tone = step.area.shape === 'line' ? 'pierce' : 'splash';
  const dealt = new Map(plan.map(({ unit }) => [unit, { hpBefore: unit.currentHP, damage: 0 }]));

  for (let blow = 0; blow < blows; blow++) {
    for (const { unit, damage } of plan) {
      if (unit.currentHP <= 0 || damage <= 0) continue;
      const actual = damageUnit(unit, damage, { floor });
      if (actual <= 0) continue;
      dealt.get(unit).damage += actual;
      yield { kind: 'hp', unit };
      yield { kind: 'hint', unit, text: `${label} -${actual}`, tone };
    }
  }

  for (const { unit } of plan) {
    const { hpBefore, damage } = dealt.get(unit);
    if (damage <= 0) continue;
    if (result)
      (result.areaCredits ||= []).push({
        source: sourceUnit,
        victim: unit,
        damage,
        hpBefore,
        killed: unit.currentHP <= 0,
      });
  }
  for (const { unit } of plan) {
    if (dealt.get(unit).damage > 0 && unit.currentHP <= 0)
      yield { kind: 'remove', unit, killer: sourceUnit };
  }
}

/**
 * A Tier 5 ally buff (also the Rally action ability): every living ally within range
 * gains the step's stats until the source's phase `durationPhases` turns on.
 */
export function* allyBuff(step, sourceUnit, world) {
  if (!sourceUnit || sourceUnit.currentHP <= 0) return;
  const range = Math.max(0, Math.trunc(Number(step?.range) || 0));
  if (range <= 0) return;
  const rawStats = step?.stats;
  if (!rawStats || typeof rawStats !== 'object') return;
  const stats = {};
  for (const [rawStat, rawValue] of Object.entries(rawStats)) {
    const stat = String(rawStat || '')
      .trim()
      .toUpperCase();
    if (!stat) continue;
    const value = Math.trunc(Number(rawValue) || 0);
    if (value === 0) continue;
    stats[stat] = value;
  }
  if (Object.keys(stats).length <= 0) return;

  const includeSelf = step?.includeSelf === true;
  const allies = world
    .alliesOf(sourceUnit)
    .filter((ally) => ally && ally.currentHP > 0)
    .filter((ally) => includeSelf || ally !== sourceUnit)
    .filter((ally) => gridDistance(sourceUnit.col, sourceUnit.row, ally.col, ally.row) <= range);
  if (allies.length <= 0) return;

  const { expiryPhase, expiryTurn } = resolveTimedBuffExpiry(
    sourceUnit,
    world.turnNumber,
    step?.durationPhases,
  );
  const keyRoot = `${String(step?.artId || 'tier5_buff')}::${String(sourceUnit.name || '')}`;
  for (const ally of allies) {
    applyTimedBuffEntry(ally, {
      key: `${keyRoot}::${String(ally.name || '')}`,
      artId: step?.artId || null,
      sourceName: sourceUnit.name || null,
      sourceFaction: sourceUnit.faction || null,
      expiryPhase,
      expiryTurn,
      stats,
    });
    yield { kind: 'hint', unit: ally, text: 'Buffed!', tone: 'buff' };
  }
}

/**
 * Run the effects without presentation (the headless harness): act on the required
 * beats, skip the rest.
 */
export function runPostCombatEffectsSync(beats, { remove, moved } = {}) {
  for (const beat of beats) {
    if (beat.kind === 'remove') remove?.(beat.unit, { killer: beat.killer });
    else if (beat.kind === 'moved') moved?.(beat.units);
  }
}
