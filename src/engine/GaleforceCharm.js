// GaleforceCharm.js — the Galeforce Charm (combatEffects `galeforce: { activation, perBattle }`).
// Pure but for its roll, which is the battle's Math.random (as a skill proc).
//
// When its wearer, a player unit, attacks on its own turn and kills, the charm may proc
// (`activation`, a skill activation type: 'SKL' rolls at the wearer's SKL %). A proc readies
// the wearer (`_galeforceReady`), and as its action completes it stands ready to act again
// (`consumeGaleforce`: BattleActionCompletion in the scene, _finishUnitAction in the harness),
// with no Canto that action. At most `perBattle` procs a battle (`_galeforceUses`). The roll is
// taken only on a kill with a use left, so a battle without the charm draws nothing new.
//
// `_galeforceUses` and `_galeforceReady` ride the battle checkpoint (BattleUnitState), so a
// resume and a Vision rewind keep them; a fresh battle and the run save clear them
// (BattleScene.resetUnitForBattle, UnitSerialization).

import { getActivationChance } from './SkillSystem.js';

export const GALEFORCE_NAME = 'Galeforce Charm';
export const GALEFORCE_ACTIVATION = Object.freeze({ id: 'galeforce_charm', name: GALEFORCE_NAME });
const DEFAULT_PER_BATTLE = 2;

export function galeforceConfig(unit) {
  const raw = unit?.accessory?.combatEffects?.galeforce;
  if (!raw) return null;
  const cfg = typeof raw === 'object' ? raw : {};
  const perBattle = Math.trunc(Number(cfg.perBattle));
  return {
    activation: typeof cfg.activation === 'string' ? cfg.activation : 'SKL',
    perBattle: Number.isFinite(perBattle) && perBattle > 0 ? perBattle : DEFAULT_PER_BATTLE,
  };
}

/** Procs this battle so far. */
export function galeforceUses(unit) {
  return Math.max(0, Math.trunc(Number(unit?._galeforceUses) || 0));
}

/** The proc chance (0-100) for this wearer, or 0 when it cannot proc now (no charm, spent). */
export function galeforceChance(unit) {
  const cfg = galeforceConfig(unit);
  if (!cfg || unit?.faction !== 'player') return 0;
  if (galeforceUses(unit) >= cfg.perBattle) return 0;
  return Math.max(0, Math.min(100, getActivationChance(unit, cfg.activation)));
}

/**
 * Roll the charm after a kill its wearer made attacking. Returns true when it procs (and readies
 * the wearer). Draws Math.random once, only when a proc is possible.
 */
export function rollGaleforce(unit, random = Math.random) {
  const chance = galeforceChance(unit);
  if (!(chance > 0) || unit._galeforceReady === true) return false;
  if (!(random() * 100 < chance)) return false;
  unit._galeforceUses = galeforceUses(unit) + 1;
  unit._galeforceReady = true;
  return true;
}

/** As the wearer's action completes: refresh it if the charm readied it. Returns whether it did. */
export function consumeGaleforce(unit) {
  if (!unit || unit._galeforceReady !== true) return false;
  delete unit._galeforceReady;
  if (!(unit.currentHP > 0)) return false;
  // Dance's refresh (ActionAbilitySystem.refreshActedAlly), kept here: importing it would
  // close an import cycle through the post-combat pipeline.
  unit.hasMoved = false;
  unit._movementCommitted = false;
  unit.hasActed = false;
  return true;
}

/** A fresh battle: every use back, nothing readied. */
export function readyGaleforce(unit) {
  if (!unit) return;
  delete unit._galeforceUses;
  delete unit._galeforceReady;
}
