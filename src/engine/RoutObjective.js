// RoutObjective — when a rout is won, and the objective line that says what is left.
// Pure: no Phaser. BattleScene.checkBattleEnd and the headless harness
// (tests/harness/HeadlessBattle._checkBattleEnd) read this one predicate, so the two
// can never disagree about the end of a rout.
//
// A rout is complete when no enemy stands and none is rising from remains
// (ZombieRemains); the caller still defers victory while the turn's reinforcements
// are pending (to the end of the enemy phase), and a clear field cancels the waves
// still to come (isRoutFieldClear). A battle may also require recruits (`requiredRecruits`: the names of
// green units that must have joined the army by Talk before the rout counts). The
// prologue's P3 requires Sera (docs/specs/prologue-chapter.md §6 P3): if the last
// Soldier falls before Edric reaches her, the battle stays playable and the objective
// line says who must still join; victory fires once she does. A standard run never
// sets `requiredRecruits`, so its recruit rules are untouched.

/** The required recruits not yet in the army (on the field or escaped), by name. */
export function pendingRequiredRecruits(requiredRecruits, playerUnits = [], escapedUnits = []) {
  const required = Array.isArray(requiredRecruits) ? requiredRecruits : [];
  if (!required.length) return [];
  const inArmy = new Set(
    [...(playerUnits || []), ...(escapedUnits || [])]
      .filter((u) => u && typeof u.name === 'string')
      .map((u) => u.name),
  );
  return required.filter((name) => typeof name === 'string' && !inArmy.has(name));
}

/**
 * True when the rout's conditions are met: no enemy standing, no remains rising, and
 * every required recruit in the army. Reinforcements pending this turn are the
 * caller's business (BattleScene defers victory until they have arrived).
 * @param {{ enemyUnits?: object[], zombieTombstones?: object[], requiredRecruits?: string[],
 *   playerUnits?: object[], escapedUnits?: object[] }} state
 */
export function isRoutComplete({
  enemyUnits = [],
  zombieTombstones = [],
  requiredRecruits = [],
  playerUnits = [],
  escapedUnits = [],
} = {}) {
  if ((enemyUnits || []).length > 0) return false;
  if ((zombieTombstones || []).length > 0) return false;
  return pendingRequiredRecruits(requiredRecruits, playerUnits, escapedUnits).length === 0;
}

/**
 * True when a rout's field is clear: no enemy standing and none rising from remains.
 * A clear field cancels every wave still to come (BattleScene.applyReinforcementsForTurn
 * and the harness read this), so a field cleared in the enemy phase ends the battle at
 * that phase's end instead of meeting a wave due the same turn. Required recruits play no
 * part: a clear field with a recruit still to join (the prologue's P3) stays clear.
 * @param {{ objective?: string, enemyUnits?: object[], zombieTombstones?: object[] }} state
 */
export function isRoutFieldClear({ objective, enemyUnits = [], zombieTombstones = [] } = {}) {
  return (
    objective === 'rout' && (enemyUnits || []).length === 0 && (zombieTombstones || []).length === 0
  );
}

function joinNames(names) {
  const list = names.filter(Boolean);
  if (list.length <= 1) return list[0] || '';
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

/**
 * The HUD's rout objective line: "Rout: 3 enemies remaining", "Rout: 1 enemy + 2
 * reviving", and with required recruits still outside the army, who must join:
 * "Rout: 2 enemies remaining · Sera must join", or once the field is clear, "Rout: Sera
 * must join to win". (battleSidebarDisplay.compactBattleObjective shortens it.)
 * @param {{ remaining: number, reviving?: number, pendingRecruits?: string[] }} state
 */
export function routObjectiveLabel({ remaining, reviving = 0, pendingRecruits = [] } = {}) {
  const count = Math.max(0, Math.trunc(Number(remaining) || 0));
  const rising = Math.max(0, Math.trunc(Number(reviving) || 0));
  const pending = Array.isArray(pendingRecruits) ? pendingRecruits.filter(Boolean) : [];
  const foes = `${count} ${count === 1 ? 'enemy' : 'enemies'}`;
  if (pending.length && count === 0 && rising === 0)
    return `Rout: ${joinNames(pending)} must join to win`;
  const base = rising > 0 ? `Rout: ${foes} + ${rising} reviving` : `Rout: ${foes} remaining`;
  return pending.length ? `${base} · ${joinNames(pending)} must join` : base;
}
