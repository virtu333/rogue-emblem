// The Ruins: the pre-boss camp offers ONE of two paths per visit.
//   rest     — heal everyone (free) and revive one of the fallen (paid, as at a church)
//   scavenge — the ruins' wares (a marked-up, forge-less shop)
// The choice commits when made and is kept on the run (RunManager.ruinsChoiceByNodeId,
// saved with the run), so leaving, re-entering, reloading, the map view or the roster
// can never open the other side. Saves from before the choice existed carry none:
// that ruins simply has no path chosen yet.
// Rest revives ONE of the fallen per ruins (RunManager.ruinsRevivedByNodeId: node -> the unit's
// uid, saved with the run), and that unit comes back with a Lingering Injury (Burdens `wounded`,
// on its attack stat, the rung's numbers) that the same ruins' Heal all leaves be (`takenAt`):
// a church mends it, as any injury. Pure: no Phaser, no DOM.
import { RUINS_PATHS } from '../utils/constants.js';
import { churchReviveBlock, healRosterAtChurch, reviveAtChurch } from './ChurchCommands.js';
import { addBurden, burdenDefFor } from './Burdens.js';
import { resolveAttackStat } from './TraitSystem.js';
import { unitUidOf } from './UnitIdentity.js';
import { omenRuinsReviveBlock } from './Omens.js';

export { RUINS_PATHS };

// Which path each service belongs to.
const SERVICE_PATH = Object.freeze({ heal: 'rest', revive: 'rest', wares: 'scavenge' });

function findRuinsNode(run, nodeId) {
  if (typeof nodeId !== 'string' || !nodeId) return null;
  return run?.nodeMap?.nodes?.find((n) => n?.id === nodeId && n.type === 'ruins') || null;
}

/** The path chosen at this ruins node: 'rest', 'scavenge', or null (none yet). */
export function ruinsChoice(run, nodeId) {
  const map = run?.ruinsChoiceByNodeId;
  if (!map || typeof map !== 'object' || !Object.hasOwn(map, nodeId)) return null;
  return RUINS_PATHS.includes(map[nodeId]) ? map[nodeId] : null;
}

/** Why this path cannot be chosen here ('' when it can). */
export function ruinsChoiceBlock(run, nodeId, path) {
  if (!RUINS_PATHS.includes(path)) return 'Choose rest or scavenge.';
  if (!findRuinsNode(run, nodeId)) return 'There are no ruins here.';
  const chosen = ruinsChoice(run, nodeId);
  if (chosen === path) return 'Already chosen.';
  if (chosen) return chosenLine(chosen);
  return '';
}

/** Commit a path. Rest heals everyone at once; Scavenge opens the wares. */
export function chooseRuinsPath(run, nodeId, path) {
  const reason = ruinsChoiceBlock(run, nodeId, path);
  if (reason) return { ok: false, reason };
  if (!run.ruinsChoiceByNodeId || typeof run.ruinsChoiceByNodeId !== 'object')
    run.ruinsChoiceByNodeId = {};
  run.ruinsChoiceByNodeId[nodeId] = path;
  if (path === 'rest') {
    const healed = healRosterAtChurch(run, { nodeId });
    return { ok: true, path, message: `You rest among the stones. ${healed.message}` };
  }
  return { ok: true, path, message: 'You scavenge the ruins.' };
}

/** Why a ruins service is closed ('' when open): heal and revive need Rest, wares need Scavenge. */
export function ruinsServiceBlock(run, nodeId, service) {
  const needed = SERVICE_PATH[service];
  if (!needed) return 'Unknown service.';
  if (!findRuinsNode(run, nodeId)) return 'There are no ruins here.';
  const chosen = ruinsChoice(run, nodeId);
  if (!chosen) return needed === 'rest' ? 'Choose Rest first.' : 'Choose Scavenge first.';
  return chosen === needed ? '' : chosenLine(chosen);
}

export function healAtRuins(run, nodeId) {
  const reason = ruinsServiceBlock(run, nodeId, 'heal');
  if (reason) return { ok: false, reason };
  return healRosterAtChurch(run, { nodeId });
}

/** True once this ruins has given one of the fallen back. */
export function ruinsReviveSpent(run, nodeId) {
  const map = run?.ruinsRevivedByNodeId;
  return Boolean(map && typeof map === 'object' && Object.hasOwn(map, nodeId) && map[nodeId]);
}

export const RUINS_REVIVE_SPENT_LINE = 'The ruins give back only one of the fallen.';

export function ruinsReviveBlock(run, nodeId, unit) {
  return (
    ruinsServiceBlock(run, nodeId, 'revive') ||
    (ruinsReviveSpent(run, nodeId) ? RUINS_REVIVE_SPENT_LINE : '') ||
    omenRuinsReviveBlock(run) ||
    churchReviveBlock(run, unit)
  );
}

/**
 * The Lingering Injury a unit revived here comes back with: its attack stat, at the rung's
 * numbers (data/events.json `burdens.wounded`). Known before the revive, so the card can say it.
 * @returns {{ stat: string, value: number, battles: number }}
 */
export function ruinsReviveInjury(run, unit) {
  const def = burdenDefFor(run?.gameData?.events, 'wounded', run?.difficultyId) || {};
  return {
    stat: resolveAttackStat(unit),
    value: -Math.abs(Math.trunc(Number(def.value)) || 2),
    battles: Math.max(1, Math.trunc(Number(def.battles)) || 1),
  };
}

export function reviveAtRuins(run, nodeId, unit) {
  const reason = ruinsServiceBlock(run, nodeId, 'revive');
  if (reason) return { ok: false, reason };
  if (ruinsReviveSpent(run, nodeId)) return { ok: false, reason: RUINS_REVIVE_SPENT_LINE };
  const result = reviveAtChurch(run, unit);
  if (!result.ok) return result;
  if (!run.ruinsRevivedByNodeId || typeof run.ruinsRevivedByNodeId !== 'object')
    run.ruinsRevivedByNodeId = {};
  // A living unit always has a uid; a legacy one is given one here, as the run gives any.
  const uid = unitUidOf(unit) || run.assignUnitUid?.(unit) || null;
  run.ruinsRevivedByNodeId[nodeId] = uid || unit.name || 'revived';
  const injury = ruinsReviveInjury(run, unit);
  const wound = uid
    ? addBurden(run, 'wounded', {
        unitUid: uid,
        unitName: unit.name,
        stat: injury.stat,
        takenAt: nodeId,
      })
    : null;
  const taken = wound?.ok ? wound.burden : null;
  return {
    ...result,
    injury: taken,
    message: taken
      ? `${result.message} ${unit.name} carries a lingering injury: ${taken.value} ${taken.stat} for ${taken.battles} ${taken.battles === 1 ? 'battle' : 'battles'}, until a church heals it.`
      : result.message,
  };
}

/** The short line the sanctuary shows once a path is chosen. */
export function chosenLine(path) {
  return path === 'rest'
    ? 'You chose to rest here. The wares stay buried.'
    : 'You chose to scavenge here. No rest tonight.';
}
