// BattleStatDeltas — battle-scoped stat changes (debuffs, Intimidate) that never
// outlive the battle (no Phaser deps). Each applied change is recorded on
// `unit._battleDeltas`, so it can be taken back exactly, whatever floor clamped it.

import { unitUidOf } from './UnitIdentity.js';

/** Change `stat` by `value` for this battle (never below 0; MOV never below 1). */
export function applyBattleDebuff(unit, stat, value) {
  if (!unit._battleDeltas) unit._battleDeltas = {};
  if (!unit._battleDeltas[stat]) unit._battleDeltas[stat] = 0;

  const oldVal = unit.stats[stat];
  unit.stats[stat] = Math.max(0, unit.stats[stat] + value);
  if (stat === 'MOV') unit.stats[stat] = Math.max(1, unit.stats[stat]);

  // Record the change actually applied (the floor may have clamped it).
  unit._battleDeltas[stat] += unit.stats[stat] - oldVal;

  if (stat === 'MOV') unit.mov = unit.stats.MOV;
}

/** Take back every battle-scoped change on `unit`. */
export function revertBattleStatDeltas(unit) {
  if (!unit?._battleDeltas) return;
  if (unit.stats && typeof unit.stats === 'object') {
    for (const [stat, delta] of Object.entries(unit._battleDeltas)) {
      if (!Number.isFinite(delta) || delta === 0) continue;
      unit.stats[stat] = (unit.stats[stat] || 0) - delta;
      if (stat === 'MOV') unit.stats[stat] = Math.max(1, unit.stats[stat] || 1);
      else unit.stats[stat] = Math.max(0, unit.stats[stat] || 0);
    }
    unit.mov = unit.stats.MOV;
  }
  delete unit._battleDeltas;
}

export function clearBattleScopedDeltas(units) {
  if (!Array.isArray(units)) return;
  for (const unit of units) revertBattleStatDeltas(unit);
}

/**
 * The stat deltas a battle starts with (`battleParams.battleDebuffs`: the Wounded burden,
 * engine/Burdens.js): [{ unitUid, stat, value, source }]. Each lands on the unit that carries
 * the uid, as a battle delta, so it is taken back with every other one when the battle ends
 * and previews, forecasts and the headless harness all read the same stats. A unit that is not
 * in this battle (benched, fallen) takes nothing. Call once per fresh start, never on a resume
 * (a checkpoint's units already carry it).
 * @returns {Array<{ unit: object, stat: string, applied: number, source: string|null }>}
 */
export function applyBattleStartDebuffs(units, debuffs) {
  const landed = [];
  if (!Array.isArray(units) || !Array.isArray(debuffs)) return landed;
  for (const debuff of debuffs) {
    const uid = typeof debuff?.unitUid === 'string' ? debuff.unitUid : null;
    const value = Math.trunc(Number(debuff?.value));
    if (!uid || !debuff.stat || !Number.isFinite(value) || value === 0) continue;
    const unit = units.find((candidate) => unitUidOf(candidate) === uid);
    if (!unit?.stats || !Number.isFinite(unit.stats[debuff.stat])) continue;
    const before = unit.stats[debuff.stat];
    applyBattleDebuff(unit, debuff.stat, value);
    landed.push({
      unit,
      stat: debuff.stat,
      applied: unit.stats[debuff.stat] - before,
      source: debuff.source || null,
    });
  }
  return landed;
}
