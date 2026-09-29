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
//   hostilesOf(unit), alliesOf(unit)   (Tier 5 targets; Divine Charge / buff allies)
//   turnNumber

import { applyGrievousStatus, getAttackAffixes } from './AffixSystem.js';
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
    case 'tier2_pierce':
      yield* pierce(step, sourceUnit, targetUnit, world);
      break;
    case 'tier2_move':
      yield* postCombatMove(sourceUnit, targetUnit, step, world);
      break;
    case 'tier2_set_hp':
      yield* setHp(step, sourceUnit, targetUnit);
      break;
    case 'tier5_aoe_splash':
      yield* aoeSplash(step, sourceUnit, targetUnit, world);
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

function* postCombatMove(sourceUnit, targetUnit, step, world) {
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
  });
  if (!moveResult.ok) return;
  const units = [];
  for (const assignment of moveResult.assignments) {
    assignment.unit.col = assignment.col;
    assignment.unit.row = assignment.row;
    units.push(assignment.unit);
  }
  yield { kind: 'moved', units };
}

/** The foe directly behind the primary target, in the line of the strike. */
export function pierceTarget(sourceUnit, primaryTarget, world) {
  if (!sourceUnit || !primaryTarget) return null;
  const dc = primaryTarget.col - sourceUnit.col;
  const dr = primaryTarget.row - sourceUnit.row;
  if (Math.abs(dc) + Math.abs(dr) !== 1) return null;
  const secondaryCol = primaryTarget.col + dc;
  const secondaryRow = primaryTarget.row + dr;
  if (
    secondaryCol < 0 ||
    secondaryCol >= world.cols ||
    secondaryRow < 0 ||
    secondaryRow >= world.rows
  ) {
    return null;
  }
  const candidate = world.getUnitAt(secondaryCol, secondaryRow);
  if (!candidate || candidate.currentHP <= 0) return null;
  if (!world.hostilesOf(sourceUnit).includes(candidate)) return null;
  return candidate;
}

function* pierce(step, sourceUnit, primaryTarget, world) {
  if (!sourceUnit || !primaryTarget) return;
  const strikeDamages = Array.isArray(step?.damages) ? step.damages : [];
  if (strikeDamages.length <= 0) return;
  const target = pierceTarget(sourceUnit, primaryTarget, world);
  if (!target) return;
  for (const rawDamage of strikeDamages) {
    if (target.currentHP <= 0) break;
    const damage = Math.max(0, Math.trunc(Number(rawDamage) || 0));
    if (damage <= 0) continue;
    const actualDamage = damageUnit(target, damage);
    if (actualDamage <= 0) continue;
    yield { kind: 'hp', unit: target };
    yield { kind: 'hint', unit: target, text: `Pierce -${actualDamage}`, tone: 'pierce' };
    if (target.currentHP <= 0) {
      yield { kind: 'remove', unit: target, killer: sourceUnit };
      break;
    }
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

/** Foes a Tier 5 splash hits around the primary target (lowest HP% first when it hits one). */
export function splashTargets(step, sourceUnit, primaryTarget, world) {
  if (!sourceUnit || !primaryTarget) return [];
  const radius = Math.max(0, Math.trunc(Number(step?.radius) || 0));
  if (radius <= 0) return [];
  const candidates = world
    .hostilesOf(sourceUnit)
    .filter((unit) => unit && unit !== primaryTarget && unit.currentHP > 0)
    .filter(
      (unit) => gridDistance(primaryTarget.col, primaryTarget.row, unit.col, unit.row) <= radius,
    );
  const maxTargets = Math.max(0, Math.trunc(Number(step?.maxTargets) || 0));
  if (maxTargets === 1) {
    candidates.sort((a, b) => {
      const aHpPct = (Number(a.currentHP) || 0) / Math.max(1, Number(a.stats?.HP) || 1);
      const bHpPct = (Number(b.currentHP) || 0) / Math.max(1, Number(b.stats?.HP) || 1);
      if (aHpPct !== bHpPct) return aHpPct - bHpPct;
      if (a.row !== b.row) return a.row - b.row;
      if (a.col !== b.col) return a.col - b.col;
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
    return candidates.slice(0, 1);
  }
  candidates.sort((a, b) => {
    if (a.row !== b.row) return a.row - b.row;
    if (a.col !== b.col) return a.col - b.col;
    return String(a.name || '').localeCompare(String(b.name || ''));
  });
  return maxTargets > 0 ? candidates.slice(0, maxTargets) : candidates;
}

/** A Tier 5 splash's damage per target: fixed, or a share of the strike's damage. */
export function splashDamage(step) {
  const damageKind = String(step?.damageKind || '').toLowerCase();
  if (damageKind === 'fixed') {
    return Math.max(0, Math.trunc(Number(step?.fixedDamage) || 0));
  }
  let multiplier = Number(step?.damageMultiplier) || 0;
  if (multiplier > 1) multiplier /= 100;
  const basisDamage = Math.max(0, Math.trunc(Number(step?.basisDamage) || 0));
  return Math.max(0, Math.floor(basisDamage * Math.max(0, multiplier)));
}

/** A Tier 5 splash around the primary target; a foe it drops is removed. */
export function* aoeSplash(step, sourceUnit, primaryTarget, world) {
  if (!sourceUnit || sourceUnit.currentHP <= 0) return;
  if (!primaryTarget) return;
  const targets = splashTargets(step, sourceUnit, primaryTarget, world);
  if (targets.length <= 0) return;
  const damage = splashDamage(step);
  if (damage <= 0) return;
  for (const target of targets) {
    if (!target || target.currentHP <= 0) continue;
    const actualDamage = damageUnit(target, damage, { floor: step?.nonLethal ? 1 : 0 });
    if (actualDamage <= 0) continue;
    yield { kind: 'hp', unit: target };
    yield { kind: 'hint', unit: target, text: `Splash -${actualDamage}`, tone: 'splash' };
    if (target.currentHP <= 0) yield { kind: 'remove', unit: target, killer: sourceUnit };
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
