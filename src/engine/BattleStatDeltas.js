// BattleStatDeltas — battle-scoped stat changes (debuffs, Intimidate) that never
// outlive the battle (no Phaser deps). Each applied change is recorded on
// `unit._battleDeltas`, so it can be taken back exactly, whatever floor clamped it.

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
