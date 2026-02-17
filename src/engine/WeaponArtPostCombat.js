import { getWeaponArtTier2Effects, getWeaponArtTier5Effects } from './WeaponArtSystem.js';

const SIDE_ORDER = ['attacker', 'defender'];
const TIER2_EFFECT_ORDER = ['afterCombatDamage', 'afterCombatDebuff', 'postCombatMove'];
const VALID_MOVE_MODES = new Set(['advance', 'retreat', 'swap', 'push', 'through']);

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

export function didCombatSideLandHit(events, side, attacker = null, defender = null) {
  if (!Array.isArray(events)) return false;
  const fallbackName = getFallbackNameForSide(side, attacker, defender);
  return events.some((event) => {
    if (event?.type !== 'strike' || event?.miss) return false;
    if (event.attackerSide === 'attacker' || event.attackerSide === 'defender') {
      return event.attackerSide === side;
    }
    return fallbackName !== null && event.attacker === fallbackName;
  });
}

export function getFirstLandedStrikeDamage(events, side, attacker = null, defender = null) {
  if (!Array.isArray(events)) return 0;
  const fallbackName = getFallbackNameForSide(side, attacker, defender);
  for (const event of events) {
    if (event?.type !== 'strike' || event?.miss) continue;
    if (event.attackerSide === 'attacker' || event.attackerSide === 'defender') {
      if (event.attackerSide !== side) continue;
    } else if (fallbackName === null || event.attacker !== fallbackName) {
      continue;
    }
    return Math.max(0, Math.trunc(Number(event.damage) || 0));
  }
  return 0;
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

  for (const effect of (result?.poisonEffects || [])) {
    if (!effect || (effect.target !== 'attacker' && effect.target !== 'defender')) continue;
    const damage = Math.max(0, Math.trunc(Number(effect.damage) || 0));
    if (damage <= 0) continue;
    steps.push({
      type: 'poison',
      targetSide: effect.target,
      damage,
    });
  }

  for (const event of (result?.debuffEvents || [])) {
    if (!event || (event.target !== 'attacker' && event.target !== 'defender')) continue;
    if (!event.debuffs || typeof event.debuffs !== 'object') continue;
    steps.push({
      type: 'debuff',
      targetSide: event.target,
      debuffs: event.debuffs,
    });
  }

  for (const heal of (result?.divineChargeHeals || [])) {
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
    attacker: didCombatSideLandHit(result?.events, 'attacker', attacker, defender),
    defender: didCombatSideLandHit(result?.events, 'defender', attacker, defender),
  };
  const artsBySide = {
    attacker: attackerWeaponArt,
    defender: defenderWeaponArt,
  };

  for (const effectType of TIER2_EFFECT_ORDER) {
    for (const side of SIDE_ORDER) {
      if (!hitBySide[side]) continue;
      const effects = getWeaponArtTier2Effects(artsBySide[side])[effectType];
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
        steps.push({
          type: 'tier2_move',
          sourceSide: side,
          targetSide: getOpposingSide(side),
          mode: effect.mode,
          distance: effect.distance,
        });
      }
    }
  }

  for (const side of SIDE_ORDER) {
    if (!hitBySide[side]) continue;
    const art = artsBySide[side];
    const tier5Effects = getWeaponArtTier5Effects(art);
    if (tier5Effects.aoeSplash) {
      const splash = tier5Effects.aoeSplash;
      const basisDamage = splash.basis === 'first_landed_strike'
        ? getFirstLandedStrikeDamage(result?.events, side, attacker, defender)
        : 0;
      steps.push({
        type: 'tier5_aoe_splash',
        sourceSide: side,
        targetSide: getOpposingSide(side),
        artId: art?.id || null,
        radius: splash.radius,
        maxTargets: splash.maxTargets,
        damageKind: splash.damageKind,
        damageMultiplier: splash.damageMultiplier,
        fixedDamage: splash.fixedDamage,
        nonLethal: splash.nonLethal === true,
        basis: splash.basis,
        basisDamage,
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

function canOccupyTile(unit, col, row, cols, rows, getMoveCost, getUnitAt, allowedOccupants = null) {
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
    if (!canOccupyTile(unit, col, row, cols, rows, getMoveCost, getUnitAt, allowedOccupants)) return null;
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
} = {}) {
  if (!sourceUnit || typeof getMoveCost !== 'function' || typeof getUnitAt !== 'function') {
    return { ok: false, reason: 'invalid_input' };
  }
  if (sourceUnit.currentHP <= 0) return { ok: false, reason: 'source_dead' };

  const normalizedMode = String(mode || '').trim().toLowerCase();
  if (!VALID_MOVE_MODES.has(normalizedMode)) return { ok: false, reason: 'invalid_mode' };
  const stepDistance = Math.max(1, Math.trunc(Number(distance) || 1));
  const direction = isCardinalAdjacent(sourceUnit, targetUnit);
  if (!direction) return { ok: false, reason: 'not_adjacent' };

  const targetAlive = targetUnit?.currentHP > 0;
  const targetStillAtExpectedTile = targetUnit && getUnitAt(targetUnit.col, targetUnit.row) === targetUnit;
  const requiresLiveTarget = normalizedMode === 'swap' || normalizedMode === 'push' || normalizedMode === 'through';
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
    if (!canOccupyTile(sourceUnit, sourceDestCol, sourceDestRow, cols, rows, getMoveCost, getUnitAt, sourceAllowed)) {
      return { ok: false, reason: 'blocked' };
    }
    if (!canOccupyTile(targetUnit, targetDestCol, targetDestRow, cols, rows, getMoveCost, getUnitAt, targetAllowed)) {
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
