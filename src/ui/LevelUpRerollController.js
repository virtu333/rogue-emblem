// LevelUpRerollController — commits a level-up card's Reroll (Branching Threads, the shared
// pool: engine/RerollPool.js) wherever a card is shown, and hands the card a small handle:
// `state()` (what the button shows: ui/rewardRerollButton.js) and `run()` (one reroll,
// committed and saved, or nothing changed). The cards themselves (GrowthCeremonyController's
// level-up card, LevelUpPopup's canvas fallback, the reward screen's Team XP notice) only
// draw: they never touch the unit, the RNG or a save.
//
// Where it saves:
//   - In battle, the reroll is written over the checkpoint the card's boundary already
//     captured (BattleSuspendController.rewriteCheckpoint: same index, seed and cursor), so
//     a refresh resumes with the new stats and the charge spent, and the battle's stream is
//     never touched. After a victory (the card of an enemy-phase counter that won the
//     battle), the battle is already saved as won: the roster's copy of the unit takes the
//     same swap and the run is saved.
//   - Between battles (Team XP, the arena), through the run save that screen uses.
// Any failed write rolls the unit, the record and the count back (engine/LevelUpReroll.js).
import { battleSession, isCurrentBattleSession } from './BattleSession.js';
import { BattleSuspendController } from './BattleSuspendController.js';
import { findBattleEntity } from '../engine/BattleEntityIdentity.js';
import { isSameUnit } from '../engine/UnitIdentity.js';
import {
  battleLevelUpRerollRng,
  levelUpRerollStatus,
  nextRerollOrdinal,
  rerollLevelUp,
  runLevelUpRerollRng,
} from '../engine/LevelUpReroll.js';
import { rerollsGranted, rerollsLeft } from '../engine/RerollPool.js';
import { levelUpRerollButtonState } from './rewardRerollButton.js';
import { shiftDisplayStats } from './progressionDisplay.js';
import { safeBattlePresentation } from './safeBattlePresentation.js';

export const REROLL_SAVE_FAILED = 'Could not save the reroll: nothing changed.';

/**
 * A handle for one card. `target()` says where the commit goes now (null: it cannot be
 * committed now), `after(result)` updates what other views show.
 */
function handle(run, record, { target, after = null }) {
  const status = () => {
    const where = target();
    if (!where) {
      // Nothing can commit here: hidden without rerolls, else shown but not offered.
      return rerollsGranted(run) > 0
        ? { granted: rerollsGranted(run), left: rerollsLeft(run), block: 'invalid' }
        : { granted: 0, left: 0, block: 'none' };
    }
    return levelUpRerollStatus(run, where.unit, record);
  };
  return {
    state: () => levelUpRerollButtonState(status()),
    run() {
      const where = target();
      if (!where) return { ok: false, message: 'This level-up cannot be rerolled now.' };
      const result = rerollLevelUp(run, where.unit, record, {
        rng: where.rng(),
        persist: where.persist,
        mirrors: where.mirrors || [],
      });
      if (!result.ok)
        return {
          ok: false,
          reason: result.reason,
          message: result.saveFailed ? REROLL_SAVE_FAILED : 'No reroll available.',
        };
      after?.(result, where.unit);
      return { ok: true, result: record, previous: result.previous, gains: result.gains };
    },
  };
}

/**
 * The Reroll handle of a battle level-up card (`entry`: a `_pendingLevelUpPopups` record),
 * or null when the run has no rerolls at all. `cards` is the queue the card came from: a
 * later card of the same unit counts its stats from this one, so its display moves too.
 */
export function battleLevelUpReroll(
  scene,
  entry,
  { session = battleSession(scene), cards = [] } = {},
) {
  const run = scene?.runManager;
  const record = entry?.levelUp;
  if (!run || !record || rerollsGranted(run) <= 0) return null;
  const target = () => {
    if (!isCurrentBattleSession(scene, session)) return null;
    if (scene._fatalDecision || scene._fatalCapturePending || scene._defeatDecision) return null;
    const unit = findBattleEntity(scene, entry, ['playerUnits']);
    if (!unit) return null;
    const rng = () =>
      battleLevelUpRerollRng(
        scene.getReinforcementSeed?.() ?? scene.visionBaseSeed ?? 0,
        unit,
        record,
        nextRerollOrdinal(run),
      );
    if (run.battleInProgress) {
      if (!run.battleInProgress.checkpoint || scene.battleState === 'BATTLE_END') return null;
      return {
        unit,
        rng,
        persist: () =>
          (scene._battleSuspendController ||= new BattleSuspendController(scene)).rewriteCheckpoint(
            { session },
          ).ok,
      };
    }
    // Won and saved: the roster holds the unit now (completeBattle), so it takes the swap too.
    if (scene.battleState !== 'BATTLE_END' || run.status !== 'active') return null;
    const twin = (run.roster || []).find((u) => isSameUnit(u, unit));
    if (!twin) return null;
    return {
      unit,
      rng,
      mirrors: [twin],
      persist: () => {
        const saved = scene._persistBattleRunState?.(null, { session });
        return saved?.ok === true || saved?.reason === 'missing_slot';
      },
    };
  };
  return handle(run, record, {
    target,
    after: (result, unit) => {
      const index = cards.indexOf(entry);
      const sameUnit = (card) =>
        card === entry ||
        (entry.unitId ? card?.unitId === entry.unitId : card?.unitName === entry.unitName);
      if (index >= 0)
        shiftDisplayStats(
          cards
            .slice(index)
            .filter(sameUnit)
            .map((card) => card.levelUp),
          result.previous,
          result.gains,
        );
      else shiftDisplayStats([record], result.previous, result.gains);
      safeBattlePresentation('level-up reroll HP', () => scene.updateHPBar?.(unit), { scene });
    },
  });
}

/**
 * The Reroll handle of a level-up card between battles (the arena), or of a Team XP line:
 * `unit` is the roster unit itself, `persist()` the screen's run save (true when written).
 * `displays` are the display records whose stats count from this level (this card's and
 * later cards' of the same unit); `onRerolled` runs after a committed reroll.
 */
export function runLevelUpReroll({
  run,
  unit,
  record,
  persist,
  displays = [record],
  onRerolled = null,
}) {
  if (!run || !record || rerollsGranted(run) <= 0) return null;
  return handle(run, record, {
    target: () =>
      unit
        ? {
            unit,
            rng: () => runLevelUpRerollRng(run, unit, record, nextRerollOrdinal(run)),
            persist,
          }
        : null,
    after: (result) => {
      shiftDisplayStats(displays, result.previous, result.gains);
      onRerolled?.(result);
    },
  });
}
