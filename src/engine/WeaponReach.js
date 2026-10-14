// WeaponReach.js - Siegebreaker's reach (an act boss's trade card, docs/specs/blessings-v3.md §6.8,
// engine/TradeBoons.js `ranged_range_bonus`): a player unit's bows and tomes reach further in
// battle. Pure leaf module (no imports) so every range reader can ask it.
//
// The bonus is stamped on each player unit for the battle (`stampArmyBattleRules` in
// engine/TradeBoons.js, from `battleParams.rangedRangeBonus`: the scene and the harness at the
// battle's start and resume, a joiner as it joins) and read here by every reader of a unit's own
// reach: AttackOptions.getAttackRange (through SkillSystem.getWeaponRangeBonus: targeting, the
// forecast's weapons, the harness's picks), Combat.canCounter (a counter from the far tile),
// ThreatForecast's move preview, and AreaStrike's weapon-range centre. A unit leaves the battle
// without it (UnitSerialization.serializeUnit).

/** The field the battle's reach bonus rides on a unit (checkpoints and rewinds keep it). */
export const RANGED_REACH_FIELD = '_rangedReachBonus';
/** The weapon types that reach further: bows and tomes, dark and light. */
export const REACH_WEAPON_TYPES = Object.freeze(['Bow', 'Tome', 'Light']);

/** The max range `weapon` gains in `unit`'s hands this battle (0 when none). */
export function rangedReachBonusOf(unit, weapon) {
  if (!unit || unit.faction !== 'player' || !weapon) return 0;
  if (!REACH_WEAPON_TYPES.includes(weapon.type)) return 0;
  const bonus = Math.trunc(Number(unit[RANGED_REACH_FIELD]) || 0);
  return bonus > 0 ? bonus : 0;
}
