// BattleJoinBoons — what a unit that joins the army mid-battle (a Talk recruit: a recruit node's,
// an event's `battle.recruit`) is owed of the effects the army was given as the battle began.
// Pure: no Phaser, no RNG.
//
// The battle-start effects that reach player units, and whether a joiner is owed them (by each
// card's own words: "all units", "every unit", "mounted units" take in a joiner; a named unit's
// does not):
//
//   Cavalier's Hour        "Mounted units +1 Move in battle; foot soldiers +1 DEF": OWED, by the
//   (move_type_battle_     joiner's move type, the one rule the battle's start reads
//   stats)                 (ShrineBoons.unitMoveTypeBattleDeltas), applied as battle deltas
//                          (`_battleDeltas`), so the battle's end takes them back exactly as it
//                          takes back the army's.
//   Captain's Whistle      "Every unit has +1 Move on turn 1": OWED to a unit joining on turn 1:
//   (first_turn_mov_delta) the same timed buff the turn-1 pipeline gives the army
//                          (BattleBlessings.blessingTurnStartEffects), ending as turn 1's enemy
//                          phase starts. A join on a later turn is owed nothing.
//   Lingering Injury       a burden on one named unit (uid-keyed in `battleDebuffs`): NOT owed.
//   (burden `wounded`)
//
// Not here, because they are not battle-start state: the act-scoped stat cards ("+3 STR to all
// units in Act 1", the Act 1 DEF prices) and Blood Covenant are permanent run stats a joiner takes
// through RunManager.grantRecruitBlessingConsumables (keyed on the unit); every combat-time card
// (Hold the Line, Phalanx Rite, Keen Eye, the Act 1 Hit price, Saint's Reserve, Unbroken Banner,
// ...) reads a player unit as it fights, a joiner included. Lantern of the Road reveals the map
// as it opens and Mark of the Road rolls as the phase starts: a joiner was not there then.
//
// Never twice: a source the unit already carries (`BattleStatDeltas.battleDeltaSourcesOf`) is not
// owed again, and the Whistle's buff is keyed (a second application refreshes it). A suspend
// keeps both on the checkpoint's units, and a resume never joins anyone again; a Vision rewind
// to before the join puts the recruit back without them.

import { blessingTurnStartEffects } from './BattleBlessings.js';
import { applyBattleStartDebuffs, battleDeltaSourcesOf } from './BattleStatDeltas.js';
import { shrineBoonsOf, unitMoveTypeBattleDeltas } from './ShrineBoons.js';
import { applyTimedBuffEntry } from './TimedWeaponArtBuffs.js';

/**
 * The battle-start effects `unit` is owed as it joins the player army.
 * `unit` must already be a player unit with its run identity (RunManager.assignUnitUid): the
 * deltas are uid-keyed like `battleParams.battleDebuffs`, so a unit without a uid (a battle with
 * no run) is owed no delta, as a battle with no run starts with none.
 * @param {{ unit: object, run?: object|null, battleBlessings?: object|null, turn?: number|null,
 *   classes?: object[] }} input
 *   `run` the RunManager (its held Cavalier's Hour), `battleBlessings` the battle's earned-blessing
 *   state (engine/BattleBlessings.js: the Whistle), `turn` the turn the join happens on.
 * @returns {{ deltas: Array<{ unitUid: string, stat: string, value: number, source: string }>,
 *   buffs: object[] }} `buffs` are timed-buff entries (TimedWeaponArtBuffs.applyTimedBuffEntry).
 */
export function battleJoinBoons({
  unit,
  run = null,
  battleBlessings = null,
  turn = null,
  classes = run?.gameData?.classes || [],
} = {}) {
  if (!unit || unit.faction !== 'player') return { deltas: [], buffs: [] };
  const carried = new Set(battleDeltaSourcesOf(unit));
  const deltas = run
    ? unitMoveTypeBattleDeltas(unit, shrineBoonsOf(run).moveTypeBattleStats, classes).filter(
        (delta) => !carried.has(delta.source),
      )
    : [];
  const buffs = blessingTurnStartEffects([unit], battleBlessings, turn).map(
    (effect) => effect.entry,
  );
  return { deltas, buffs };
}

/**
 * Give `unit` what it is owed as it joins (`battleJoinBoons`): the deltas as battle deltas
 * (`BattleStatDeltas.applyBattleStartDebuffs`, so `_battleDeltas` and the source ledger record
 * them), the buffs as timed buffs.
 * @returns {{ landed: object[], buffs: object[] }}
 */
export function applyBattleJoinBoons(unit, options = {}) {
  const { deltas, buffs } = battleJoinBoons({ ...options, unit });
  const landed = applyBattleStartDebuffs([unit], deltas);
  for (const entry of buffs) applyTimedBuffEntry(unit, entry);
  return { landed, buffs };
}
