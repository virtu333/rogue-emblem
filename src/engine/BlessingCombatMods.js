// Blessing combat modifiers: the one place a run's blessings reach a combat's mods
// (docs/specs/blessings-v3.md §4). Pure: BattleScene and the headless harness both call
// `applyBlessingCombatMods` right after their accessory phase mods, so the two cannot
// disagree about what a blessing grants.
//
// The `profile` is `RunManager.getBlessingCombatProfile()`:
//   { actHitBonus,                    // today's act hit (Steady-style bonus, Act 1 price)
//     firstStrikeHitBonus,            // Keen Eye
//     stationary: { defBonus, avoidBonus },   // Holdfast
//     legacyTerrainBonuses }          // saves from before Holdfast (retired by the migration)
// Only player-faction units ever receive anything; enemies and NPC allies get zeros.

/**
 * Remember where each living unit stood as `turn`'s player phase began. Holdfast reads it
 * through the player phase and the enemy phase that follows. Called wherever the player
 * units' per-turn flags are reset.
 */
export function stampTurnAnchors(units, turn) {
  for (const unit of units || []) {
    if (!unit || (unit.currentHP ?? 1) <= 0) continue;
    unit._turnAnchor = { turn, col: unit.col, row: unit.row };
  }
}

/**
 * Holdfast's predicate: the unit has not moved this turn. True while it stands on the tile
 * `stampTurnAnchors` recorded for `turn`, has not been marked as moved and has spent no
 * movement; this holds through the enemy phase after it (a push or a Blink off the tile
 * ends it). A unit with no anchor for this turn (a mid-turn arrival, an older checkpoint)
 * is not holding.
 */
export function isHoldingGround(unit, turn) {
  const anchor = unit?._turnAnchor;
  if (!anchor || !Number.isFinite(turn) || anchor.turn !== turn) return false;
  if (unit.col !== anchor.col || unit.row !== anchor.row) return false;
  if (unit.hasMoved === true) return false;
  if ((Number(unit._movementSpent) || 0) > 0) return false;
  return true;
}

const ZERO = () => ({
  hitBonus: 0,
  avoidBonus: 0,
  defBonus: 0,
  critBonus: 0,
  firstStrikeHitBonus: 0,
});

/**
 * What the run's blessings add to one side of a combat.
 * `side` = { unit, foe, initiating, turn, terrain, allies }: `allies` is the unit's own
 * side (self and the fallen ignored by any reader), for blessings that count nearby units.
 */
export function blessingCombatModsFor(profile, side) {
  const out = ZERO();
  const unit = side?.unit;
  if (!profile || unit?.faction !== 'player') return out;

  out.hitBonus += Math.trunc(Number(profile.actHitBonus) || 0);

  // Keen Eye: the side that starts the combat only.
  if (side.initiating) out.firstStrikeHitBonus += Math.trunc(profile.firstStrikeHitBonus || 0);

  // Holdfast: a unit that has not moved this turn.
  const stationary = profile.stationary;
  if (stationary && isHoldingGround(unit, side.turn)) {
    out.defBonus += Math.trunc(stationary.defBonus || 0);
    out.avoidBonus += Math.trunc(stationary.avoidBonus || 0);
  }

  // Saves from before Holdfast still carry the old terrain boon until they migrate.
  const terrainName = side.terrain?.name;
  if (terrainName && Array.isArray(profile.legacyTerrainBonuses)) {
    for (const bonus of profile.legacyTerrainBonuses) {
      if (Array.isArray(bonus?.terrains) && bonus.terrains.includes(terrainName)) {
        out.avoidBonus += bonus.avoidBonus || 0;
        out.defBonus += bonus.defBonus || 0;
      }
    }
  }
  return out;
}

function addInto(mods, add) {
  if (!mods) return;
  mods.hitBonus = (mods.hitBonus || 0) + add.hitBonus;
  mods.avoidBonus = (mods.avoidBonus || 0) + add.avoidBonus;
  mods.defBonus = (mods.defBonus || 0) + add.defBonus;
  mods.critBonus = (mods.critBonus || 0) + add.critBonus;
  if (add.firstStrikeHitBonus)
    mods.firstStrikeHitBonus = (mods.firstStrikeHitBonus || 0) + add.firstStrikeHitBonus;
}

/**
 * Add the blessings' bonuses into the mutable mods `getSkillCombatMods` returned for the
 * attacker (the side that starts the combat) and the defender.
 */
export function applyBlessingCombatMods(
  atkMods,
  defMods,
  { profile, attacker, defender, atkTerrain, defTerrain, turn, alliesOf },
) {
  if (!profile) return;
  addInto(
    atkMods,
    blessingCombatModsFor(profile, {
      unit: attacker,
      foe: defender,
      initiating: true,
      turn,
      terrain: atkTerrain,
      allies: alliesOf?.(attacker) || [],
    }),
  );
  addInto(
    defMods,
    blessingCombatModsFor(profile, {
      unit: defender,
      foe: attacker,
      initiating: false,
      turn,
      terrain: defTerrain,
      allies: alliesOf?.(defender) || [],
    }),
  );
}
