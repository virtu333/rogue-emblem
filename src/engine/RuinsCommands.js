// The Ruins: the pre-boss camp offers ONE of two paths per visit.
//   rest     — heal everyone (free) and revive the fallen (paid, as at a church)
//   scavenge — the ruins' wares (a marked-up, forge-less shop)
// The choice commits when made and is kept on the run (RunManager.ruinsChoiceByNodeId,
// saved with the run), so leaving, re-entering, reloading, the map view or the roster
// can never open the other side. Saves from before the choice existed carry none:
// that ruins simply has no path chosen yet. Pure: no Phaser, no DOM.
import { RUINS_PATHS } from '../utils/constants.js';
import { settleAccessoryHpOwed } from './UnitManager.js';
import { churchReviveBlock, reviveAtChurch } from './ChurchCommands.js';

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
    healRoster(run);
    return { ok: true, path, message: 'You rest among the stones. All units healed.' };
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
  healRoster(run);
  return { ok: true, message: 'All units healed.' };
}

export function ruinsReviveBlock(run, nodeId, unit) {
  return ruinsServiceBlock(run, nodeId, 'revive') || churchReviveBlock(run, unit);
}

export function reviveAtRuins(run, nodeId, unit) {
  const reason = ruinsServiceBlock(run, nodeId, 'revive');
  if (reason) return { ok: false, reason };
  return reviveAtChurch(run, unit);
}

/** The short line the sanctuary shows once a path is chosen. */
export function chosenLine(path) {
  return path === 'rest'
    ? 'You chose to rest here. The wares stay buried.'
    : 'You chose to scavenge here. No rest tonight.';
}

function healRoster(run) {
  for (const unit of run.roster || []) {
    if (!unit?.stats) continue;
    unit.currentHP = unit.stats.HP;
    settleAccessoryHpOwed(unit);
  }
}
