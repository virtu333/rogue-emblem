import {
  getWeaponArtArea,
  getWeaponArtCombatMods,
  getWeaponArtTargeting,
  getWeaponArtTier2Effects,
  getWeaponArtTier5Effects,
  getWeaponArtMissEffects,
  getWeaponArtKillEffects,
} from './WeaponArtSystem.js';
import { mergeCombatMods } from './Combat.js';
import { isRooted } from './StatusConditionSystem.js';
import { isEntity } from './EntitySystem.js';

const SIDE_ORDER = ['attacker', 'defender'];
const TIER2_EFFECT_ORDER = [
  'afterCombatDamage',
  'afterCombatDebuff',
  'inflictStatus',
  'lineArea',
  'postCombatMove',
  'setHp',
];
const VALID_MOVE_MODES = new Set(['advance', 'retreat', 'swap', 'push', 'through', 'ram']);

function getOpposingSide(side) {
  return side === 'attacker' ? 'defender' : 'attacker';
}

function resolveRelativeTargetSide(sourceSide, target) {
  return target === 'attacker' ? sourceSide : getOpposingSide(sourceSide);
}

function getFallbackNameForSide(side, attacker, defender) {
  if (side === 'attacker') return attacker?.name || null;
  return defender?.name || null;
}

/**
 * The helpers below read a side's strikes from a combat's events. `artStrikesOnly` leaves
 * out an art user's follow-up (`artFollowUp`): a plain strike that carries none of the art.
 */
export function didCombatSideLandHit(
  events,
  side,
  attacker = null,
  defender = null,
  { artStrikesOnly = false } = {},
) {
  if (!Array.isArray(events)) return false;
  const fallbackName = getFallbackNameForSide(side, attacker, defender);
  return events.some((event) => {
    if (event?.type !== 'strike' || event?.miss) return false;
    if (artStrikesOnly && event.artFollowUp) return false;
    if (event.attackerSide === 'attacker' || event.attackerSide === 'defender') {
      return event.attackerSide === side;
    }
    return fallbackName !== null && event.attacker === fallbackName;
  });
}

export function getMissedStrikeCount(
  events,
  side,
  attacker = null,
  defender = null,
  { artStrikesOnly = false } = {},
) {
  if (!Array.isArray(events)) return 0;
  const fallbackName = getFallbackNameForSide(side, attacker, defender);
  let count = 0;
  for (const event of events) {
    if (event?.type !== 'strike' || !event?.miss) continue;
    if (artStrikesOnly && event.artFollowUp) continue;
    if (event.attackerSide === 'attacker' || event.attackerSide === 'defender') {
      if (event.attackerSide !== side) continue;
    } else if (fallbackName === null || event.attacker !== fallbackName) {
      continue;
    }
    count += 1;
  }
  return count;
}

export function getLandedStrikeDamages(
  events,
  side,
  attacker = null,
  defender = null,
  { artStrikesOnly = false } = {},
) {
  if (!Array.isArray(events)) return [];
  const fallbackName = getFallbackNameForSide(side, attacker, defender);
  const out = [];
  for (const event of events) {
    if (event?.type !== 'strike' || event?.miss) continue;
    if (artStrikesOnly && event.artFollowUp) continue;
    if (event.attackerSide === 'attacker' || event.attackerSide === 'defender') {
      if (event.attackerSide !== side) continue;
    } else if (fallbackName === null || event.attacker !== fallbackName) {
      continue;
    }
    out.push(Math.max(0, Math.trunc(Number(event.damage) || 0)));
  }
  return out;
}

/**
 * The `area_damage` step of a normal-attack area art (docs/specs/aoe-weapon-arts.md §2.3),
 * or null. The blow reuses the side's flat combat mods from the resolved combat
 * (`result.strikeMods`); a result without them (a hand-built one) falls back to the
 * art's own mods.
 */
function areaDamageStep(side, art, result, attacker, defender) {
  if (getWeaponArtTargeting(art) !== 'normal_attack') return null;
  const area = getWeaponArtArea(art);
  if (!area) return null;
  const landed = getLandedStrikeDamages(result?.events, side, attacker, defender, {
    artStrikesOnly: true,
  }).length;
  return {
    type: 'area_damage',
    sourceSide: side,
    targetSide: getOpposingSide(side),
    artId: art?.id || null,
    area,
    blows: area.strikes === 'each_landed' ? landed : 1,
    // A line runs through with the strike, so it lands even if the counter then fells
    // its user (as pierce always has); a blast around the target needs its user alive.
    requiresLiveSource: area.shape !== 'line',
    strikeMods: result?.strikeMods?.[side] ?? mergeCombatMods(null, getWeaponArtCombatMods(art)),
  };
}

export function getPostCombatPipelineSteps({
  attacker = null,
  defender = null,
  result = null,
  attackerWeaponArt = null,
  defenderWeaponArt = null,
} = {}) {
  const steps = [
    { type: 'affix', sourceSide: 'attacker' },
    { type: 'affix', sourceSide: 'defender' },
  ];

  for (const effect of result?.poisonEffects || []) {
    if (!effect || (effect.target !== 'attacker' && effect.target !== 'defender')) continue;
    const damage = Math.max(0, Math.trunc(Number(effect.damage) || 0));
    if (damage <= 0) continue;
    steps.push({
      type: 'poison',
      targetSide: effect.target,
      damage,
    });
  }

  for (const event of result?.debuffEvents || []) {
    if (!event || (event.target !== 'attacker' && event.target !== 'defender')) continue;
    if (!event.debuffs || typeof event.debuffs !== 'object') continue;
    steps.push({
      type: 'debuff',
      targetSide: event.target,
      debuffs: event.debuffs,
    });
  }

  // Imbue status procs (e.g. Binding → root) ride the tier2_status step so
  // application (applyCondition + statusImmunity gate + UI feedback) is shared
  // with weapon-art inflictStatus in BattleScene and the headless harness.
  for (const effect of result?.imbueStatusEffects || []) {
    if (!effect || (effect.target !== 'attacker' && effect.target !== 'defender')) continue;
    const status = typeof effect.status === 'string' ? effect.status : '';
    if (!status) continue;
    steps.push({
      type: 'tier2_status',
      sourceSide: getOpposingSide(effect.target),
      targetSide: effect.target,
      status,
      durationPhases: Math.max(1, Math.trunc(Number(effect.durationPhases) || 1)),
    });
  }

  for (const heal of result?.divineChargeHeals || []) {
    if (!heal || (heal.side !== 'attacker' && heal.side !== 'defender')) continue;
    steps.push({
      type: 'divine_charge',
      side: heal.side,
      percent: Number(heal.percent) || 0,
      range: Math.max(0, Math.trunc(Number(heal.range) || 0)),
      damageDealt: Math.max(0, Math.trunc(Number(heal.damageDealt) || 0)),
    });
  }

  const hitBySide = {
    attacker: didCombatSideLandHit(result?.events, 'attacker', attacker, defender, {
      artStrikesOnly: true,
    }),
    defender: didCombatSideLandHit(result?.events, 'defender', attacker, defender, {
      artStrikesOnly: true,
    }),
  };
  const artsBySide = {
    attacker: attackerWeaponArt,
    defender: defenderWeaponArt,
  };

  for (const effectType of TIER2_EFFECT_ORDER) {
    for (const side of SIDE_ORDER) {
      const hitGated = effectType !== 'setHp';
      if (hitGated && !hitBySide[side]) continue;
      if (effectType === 'lineArea') {
        const step = areaDamageStep(side, artsBySide[side], result, attacker, defender);
        if (step?.area.shape === 'line') steps.push(step);
        continue;
      }
      const effects = getWeaponArtTier2Effects(artsBySide[side])[effectType] || [];
      if (effects.length <= 0) continue;
      for (const effect of effects) {
        if (effectType === 'afterCombatDamage') {
          steps.push({
            type: 'tier2_damage',
            sourceSide: side,
            targetSide: resolveRelativeTargetSide(side, effect.target),
            amount: effect.amount,
            nonLethal: effect.nonLethal !== false,
          });
          continue;
        }
        if (effectType === 'afterCombatDebuff') {
          steps.push({
            type: 'tier2_debuff',
            sourceSide: side,
            targetSide: resolveRelativeTargetSide(side, effect.target),
            stat: effect.stat,
            amount: effect.amount,
          });
          continue;
        }
        if (effectType === 'inflictStatus') {
          steps.push({
            type: 'tier2_status',
            sourceSide: side,
            targetSide: resolveRelativeTargetSide(side, effect.target),
            status: effect.status,
            durationPhases: effect.durationPhases,
          });
          continue;
        }
        if (effectType === 'postCombatMove') {
          steps.push({
            type: 'tier2_move',
            sourceSide: side,
            targetSide: getOpposingSide(side),
            mode: effect.mode,
            distance: effect.distance,
            ...(effect.mode === 'ram' ? { collisionDamage: effect.collisionDamage } : {}),
          });
          continue;
        }
        steps.push({
          type: 'tier2_set_hp',
          sourceSide: side,
          targetSide: resolveRelativeTargetSide(side, effect.target),
          value: effect.value,
        });
      }
    }
  }

  // All or Nothing: self-damage per missed strike by the art user (not hit-gated)
  for (const side of SIDE_ORDER) {
    const art = artsBySide[side];
    const { selfDamageOnMiss } = getWeaponArtMissEffects(art);
    if (!selfDamageOnMiss) continue;
    const missCount = getMissedStrikeCount(result?.events, side, attacker, defender, {
      artStrikesOnly: true,
    });
    if (missCount <= 0) continue;
    steps.push({
      type: 'art_miss_self_damage',
      sourceSide: side,
      targetSide: side,
      amount: selfDamageOnMiss * missCount,
      nonLethal: true,
    });
  }

  // Annihilate: timed self-buff if the art user's combat killed the opponent.
  // Death is checked at application time (after earlier steps resolve).
  for (const side of SIDE_ORDER) {
    if (!hitBySide[side]) continue;
    const art = artsBySide[side];
    const { killBuff } = getWeaponArtKillEffects(art);
    if (!killBuff) continue;
    steps.push({
      type: 'art_kill_buff',
      sourceSide: side,
      targetSide: getOpposingSide(side),
      artId: art?.id || null,
      durationPhases: killBuff.durationPhases,
      stats: { ...killBuff.stats },
    });
  }

  for (const side of SIDE_ORDER) {
    if (!hitBySide[side]) continue;
    const art = artsBySide[side];
    const tier5Effects = getWeaponArtTier5Effects(art);
    const areaStep = areaDamageStep(side, art, result, attacker, defender);
    if (areaStep && areaStep.area.shape !== 'line') steps.push(areaStep);
    if (tier5Effects.allyHeal) {
      // What the user dealt the target, overkill excluded (Divine Charge's sum, capped
      // at the HP the target entered the combat with).
      const landed = getLandedStrikeDamages(result?.events, side, attacker, defender, {
        artStrikesOnly: true,
      }).reduce((sum, damage) => sum + damage, 0);
      const targetStartHp = Number(result?.startHP?.[getOpposingSide(side)]);
      steps.push({
        type: 'ally_heal',
        sourceSide: side,
        artId: art?.id || null,
        radius: tier5Effects.allyHeal.radius,
        percent: tier5Effects.allyHeal.percentOfDamage,
        dealt: Number.isFinite(targetStartHp) ? Math.min(landed, targetStartHp) : landed,
      });
    }
    if (tier5Effects.allyBuff) {
      const buff = tier5Effects.allyBuff;
      steps.push({
        type: 'tier5_ally_buff',
        sourceSide: side,
        artId: art?.id || null,
        range: buff.range,
        durationPhases: buff.durationPhases,
        stats: { ...buff.stats },
        includeSelf: buff.includeSelf === true,
      });
    }
  }

  return steps;
}

function isInBounds(col, row, cols, rows) {
  return col >= 0 && col < cols && row >= 0 && row < rows;
}

function isCardinalAdjacent(sourceUnit, targetUnit) {
  if (!sourceUnit || !targetUnit) return null;
  const dc = targetUnit.col - sourceUnit.col;
  const dr = targetUnit.row - sourceUnit.row;
  if (Math.abs(dc) + Math.abs(dr) !== 1) return null;
  return { dc, dr };
}

function canOccupyTile(
  unit,
  col,
  row,
  cols,
  rows,
  getMoveCost,
  getUnitAt,
  allowedOccupants = null,
) {
  if (!isInBounds(col, row, cols, rows)) return false;
  if (!Number.isFinite(getMoveCost(col, row, unit.moveType))) return false;
  const occupant = getUnitAt(col, row);
  if (!occupant) return true;
  // Post-combat movement resolves before dead units are removed from the grid.
  // Treat defeated units as non-blocking so advance can enter the defender tile.
  if (typeof occupant.currentHP === 'number' && occupant.currentHP <= 0) return true;
  if (allowedOccupants && allowedOccupants.has(occupant)) return true;
  return false;
}

function traceLinearDestination({
  unit,
  startCol,
  startRow,
  dc,
  dr,
  distance,
  cols,
  rows,
  getMoveCost,
  getUnitAt,
  allowedOccupants = null,
}) {
  let col = startCol;
  let row = startRow;
  for (let i = 0; i < distance; i++) {
    col += dc;
    row += dr;
    if (!canOccupyTile(unit, col, row, cols, rows, getMoveCost, getUnitAt, allowedOccupants))
      return null;
  }
  return { col, row };
}

export function resolvePostCombatMove({
  sourceUnit = null,
  targetUnit = null,
  mode = null,
  distance = 1,
  cols = 0,
  rows = 0,
  getMoveCost = null,
  getUnitAt = null,
  isImmovable = null,
} = {}) {
  if (!sourceUnit || typeof getMoveCost !== 'function' || typeof getUnitAt !== 'function') {
    return { ok: false, reason: 'invalid_input' };
  }
  if (sourceUnit.currentHP <= 0) return { ok: false, reason: 'source_dead' };

  const normalizedMode = String(mode || '')
    .trim()
    .toLowerCase();
  if (!VALID_MOVE_MODES.has(normalizedMode)) return { ok: false, reason: 'invalid_mode' };

  // Every art move needs the target beside its user; from range nothing moves, so no
  // pin (root, Anchored) is ever reported for a move that could not have happened.
  const stepDistance = Math.max(1, Math.trunc(Number(distance) || 1));
  const direction = isCardinalAdjacent(sourceUnit, targetUnit);
  if (!direction) return { ok: false, reason: 'not_adjacent' };

  // Root pins units against art-driven displacement: a rooted source cannot
  // reposition itself, and a rooted defender cannot be swapped or pushed.
  // (Deliberate ally actions like Shove/Pull remain allowed as counterplay.)
  const movesSource = normalizedMode !== 'push' && normalizedMode !== 'ram';
  const movesTarget =
    normalizedMode === 'swap' || normalizedMode === 'push' || normalizedMode === 'ram';
  if (movesSource && isRooted(sourceUnit)) return { ok: false, reason: 'rooted' };
  if (movesTarget && targetUnit && isRooted(targetUnit)) return { ok: false, reason: 'rooted' };
  // Anchored (and anything else the caller pins) is never displaced by another unit.
  if (movesTarget && targetUnit && isImmovable?.(targetUnit)) {
    return { ok: false, reason: 'immovable' };
  }

  const targetAlive = targetUnit?.currentHP > 0;
  const targetStillAtExpectedTile =
    targetUnit && getUnitAt(targetUnit.col, targetUnit.row) === targetUnit;
  const requiresLiveTarget =
    normalizedMode === 'swap' ||
    normalizedMode === 'push' ||
    normalizedMode === 'through' ||
    normalizedMode === 'ram';
  if (requiresLiveTarget && (!targetAlive || !targetStillAtExpectedTile)) {
    return { ok: false, reason: 'invalid_target' };
  }

  if (normalizedMode === 'advance') {
    const dest = traceLinearDestination({
      unit: sourceUnit,
      startCol: sourceUnit.col,
      startRow: sourceUnit.row,
      dc: direction.dc,
      dr: direction.dr,
      distance: stepDistance,
      cols,
      rows,
      getMoveCost,
      getUnitAt,
    });
    if (!dest) return { ok: false, reason: 'blocked' };
    return { ok: true, assignments: [{ unit: sourceUnit, col: dest.col, row: dest.row }] };
  }

  if (normalizedMode === 'retreat') {
    const dest = traceLinearDestination({
      unit: sourceUnit,
      startCol: sourceUnit.col,
      startRow: sourceUnit.row,
      dc: -direction.dc,
      dr: -direction.dr,
      distance: stepDistance,
      cols,
      rows,
      getMoveCost,
      getUnitAt,
    });
    if (!dest) return { ok: false, reason: 'blocked' };
    return { ok: true, assignments: [{ unit: sourceUnit, col: dest.col, row: dest.row }] };
  }

  if (normalizedMode === 'swap') {
    const sourceDestCol = targetUnit.col;
    const sourceDestRow = targetUnit.row;
    const targetDestCol = sourceUnit.col;
    const targetDestRow = sourceUnit.row;
    const sourceAllowed = new Set([targetUnit]);
    const targetAllowed = new Set([sourceUnit]);
    if (
      !canOccupyTile(
        sourceUnit,
        sourceDestCol,
        sourceDestRow,
        cols,
        rows,
        getMoveCost,
        getUnitAt,
        sourceAllowed,
      )
    ) {
      return { ok: false, reason: 'blocked' };
    }
    if (
      !canOccupyTile(
        targetUnit,
        targetDestCol,
        targetDestRow,
        cols,
        rows,
        getMoveCost,
        getUnitAt,
        targetAllowed,
      )
    ) {
      return { ok: false, reason: 'blocked' };
    }
    return {
      ok: true,
      assignments: [
        { unit: sourceUnit, col: sourceDestCol, row: sourceDestRow },
        { unit: targetUnit, col: targetDestCol, row: targetDestRow },
      ],
    };
  }

  if (normalizedMode === 'ram') {
    // The Entity's footprint never moves. Otherwise the target slides up to `distance`
    // tiles and stops before the edge, impassable ground or a living unit; stopping
    // short is a collision (with that unit, or with nothing for a wall).
    if (isEntity(targetUnit)) return { ok: false, reason: 'immovable' };
    let col = targetUnit.col;
    let row = targetUnit.row;
    let collision = null;
    for (let i = 0; i < stepDistance; i++) {
      const nextCol = col + direction.dc;
      const nextRow = row + direction.dr;
      if (
        !isInBounds(nextCol, nextRow, cols, rows) ||
        !Number.isFinite(getMoveCost(nextCol, nextRow, targetUnit.moveType))
      ) {
        collision = { obstacle: null };
        break;
      }
      const occupant = getUnitAt(nextCol, nextRow);
      if (occupant && occupant !== targetUnit && !(occupant.currentHP <= 0)) {
        collision = { obstacle: occupant };
        break;
      }
      col = nextCol;
      row = nextRow;
    }
    const moved = col !== targetUnit.col || row !== targetUnit.row;
    return {
      ok: true,
      assignments: moved ? [{ unit: targetUnit, col, row }] : [],
      collision,
    };
  }

  if (normalizedMode === 'push') {
    const dest = traceLinearDestination({
      unit: targetUnit,
      startCol: targetUnit.col,
      startRow: targetUnit.row,
      dc: direction.dc,
      dr: direction.dr,
      distance: stepDistance,
      cols,
      rows,
      getMoveCost,
      getUnitAt,
    });
    if (!dest) return { ok: false, reason: 'blocked' };
    return { ok: true, assignments: [{ unit: targetUnit, col: dest.col, row: dest.row }] };
  }

  const dest = traceLinearDestination({
    unit: sourceUnit,
    startCol: targetUnit.col,
    startRow: targetUnit.row,
    dc: direction.dc,
    dr: direction.dr,
    distance: stepDistance,
    cols,
    rows,
    getMoveCost,
    getUnitAt,
  });
  if (!dest) return { ok: false, reason: 'blocked' };
  return { ok: true, assignments: [{ unit: sourceUnit, col: dest.col, row: dest.row }] };
}
