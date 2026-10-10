// The Roster from the formation screen: manage gear, items, accessories and skills
// before turn 1 without leaving for the route map.
//
// The battle's units are copies of the run's roster made when the battle was entered
// (RunManager.getRoster), and the run's battle flag snapshots the convoy, accessories
// and gold at that moment for Continue from Map. A roster edit made under that flag
// would be undone by the revert on one side only (an item taken from the convoy would
// come back to it while the unit keeps it). So opening the Roster leaves the battle the
// way Back to map does (revertBattleInProgressToEntry, saved: Vision and the RNG
// refunded, the locked map kept), and closing it enters the same battle again: the
// scene restarts as the route map would start it, with the run's roster as it now
// stands. What the player set up on the formation screen rides that restart
// (`formationReturn`): who deploys, and where each placed unit stood. The boss card is
// not shown twice and the battle's track plays on.
import { MobileRosterSheet } from './MobileRosterSheet.js';
import { battleSession, isCurrentBattleSession } from './BattleSession.js';
import { unitIdentityKey } from '../engine/UnitIdentity.js';
import {
  restartScene,
  transitionToSceneWithBlockedRetry,
  TRANSITION_REASONS,
  TRANSITION_RESULTS,
} from '../utils/SceneRouter.js';

/**
 * What the formation screen keeps across the Roster: the deployed units (by identity,
 * in deploy order) and the tile each placed unit stood on. Pure.
 * @returns {{ deployed: string[], placed: { key: string, col: number, row: number }[] }}
 */
export function formationMemory(formation) {
  const units = formation?.units || [];
  const deployed = [];
  const placed = [];
  for (const [u, unit] of units.entries()) {
    const key = unitIdentityKey(unit);
    if (!key) continue;
    deployed.push(key);
    const t = formation.formation?.at?.[u];
    const tile = t === null || t === undefined ? null : formation.tiles?.[t];
    if (tile) placed.push({ key, col: tile.col, row: tile.row });
  }
  return { deployed, placed };
}

/**
 * The units to deploy again, in roster order, or null when the remembered army can't
 * be found whole (the deploy screen then asks again). Pure.
 */
export function deployedFromMemory(roster, memory, limits = null) {
  const keys = memory?.deployed;
  if (!Array.isArray(roster) || !Array.isArray(keys) || !keys.length) return null;
  const wanted = new Set(keys);
  const found = roster.filter((unit) => wanted.has(unitIdentityKey(unit)));
  if (found.length !== wanted.size) return null;
  if (limits && (found.length < limits.min || found.length > limits.max)) return null;
  return found;
}

/**
 * Put the remembered units back on their tiles. `place(u, t)` places unit u on tile t
 * and returns false when it may not stand there (a reclassed unit can lose its tile),
 * leaving that unit waiting. Returns how many were placed. Pure but for `place`.
 */
export function restorePlacement(formation, memory, place) {
  let count = 0;
  for (const entry of memory?.placed || []) {
    const u = formation.units.findIndex((unit) => unitIdentityKey(unit) === entry.key);
    const t = formation.tiles.findIndex((tile) => tile.col === entry.col && tile.row === entry.row);
    if (u === -1 || t === -1 || formation.formation.at[u] !== null) continue;
    if (formation.formation.at.includes(t)) continue;
    if (place(u, t)) count++;
  }
  return count;
}

/** A fingerprint of what the Roster can change, to tell the player whether it did. */
function runFingerprint(run) {
  try {
    return JSON.stringify([run.roster, run.convoy, run.accessories, run.scrolls, run.gold]);
  } catch {
    return null;
  }
}

/** Offered while Back to map is: a run battle, before turn 1, nothing else open. */
export function canOpenFormationRoster(scene) {
  const f = scene?._formation;
  return Boolean(
    f?.ready &&
    !f.menu &&
    !f.picker &&
    !scene._formationRoster &&
    scene.runManager?.roster &&
    f.canReturnToMap(),
  );
}

/**
 * Open the Roster over the formation, on `unit` when given (a battle copy: matched to
 * the run's unit by identity). Returns false when it isn't offered now.
 */
export function openFormationRoster(scene, unit = null) {
  if (!canOpenFormationRoster(scene)) return false;
  const s = scene;
  const f = s._formation;
  const rm = s.runManager;
  const session = battleSession(s);
  const memory = formationMemory(f);
  if (s.unitDetailOverlay?.visible) s.unitDetailOverlay.hide();
  s.clearInspectionVisuals?.();
  // Leave the battle as Back to map does; the save now says "on the map", so closing
  // the app with the Roster open lands there, and every Roster save is a map save.
  rm.revertBattleInProgressToEntry();
  s._persistBattleRunState?.(null, { session });
  const before = runFingerprint(rm);
  // Placement waits under the sheet: no taps, no dock.
  f.ready = false;
  f.heldUnit = null;
  f.selectedTile = null;
  f.drawMarkers();
  f.touch();
  s.refreshEndTurnControl?.();
  const key = unit ? unitIdentityKey(unit) : null;
  const index = key ? rm.roster.findIndex((u) => unitIdentityKey(u) === key) : -1;
  const state = { closed: false, sheet: null };
  s._formationRoster = state;
  state.sheet = new MobileRosterSheet({
    scene: s,
    gameData: s.gameData,
    units: rm.roster,
    index: Math.max(0, index),
    run: rm,
    // Where Close leads: placement, with everyone where they stood.
    closeLabel: 'Back to formation',
    onClose: () => {
      if (state.closed) return;
      state.closed = true;
      state.sheet?.destroy();
      if (!isCurrentBattleSession(s, session)) return;
      const changed = before === null || runFingerprint(rm) !== before;
      reenterBattle(s, { ...memory, changed });
    },
  });
  return true;
}

/**
 * The battle's params as the route map builds them on entry (`rm.getBattleParams(node)`),
 * read after the Roster closed: `battleDebuffs` and the move-type deltas (Cavalier's Hour)
 * are taken from the roster as it now stands, so a unit that changed its move type there
 * (Mercury Sandals, a seal, a promotion) gets its new bonus. Falls back to the scene's own
 * params when the node is not on the route map (it always is where the Roster is offered).
 */
export function reentryBattleData(s) {
  const rm = s.runManager;
  const node = rm?.nodeMap?.nodes?.find((n) => n?.id === s.nodeId);
  const battleParams = node ? rm.getBattleParams(node) : null;
  if (!battleParams) return { battleParams: s.battleParams, isBoss: s.isBoss, isElite: s.isElite };
  return { battleParams, isBoss: s.isBoss, isElite: battleParams.isElite || false };
}

/** Enter the same battle again with the run's roster as it now stands. */
function reenterBattle(s, memory) {
  const rm = s.runManager;
  if (s.input) s.input.enabled = false;
  // The track plays on into the re-opened battle (it asks for the same one).
  s._keepMusicOnShutdown = true;
  const ok = restartScene(
    s,
    {
      gameData: s.gameData,
      runManager: rm,
      // The params the route map would build now: some follow the roster just edited
      // (a unit's Lingering Injury, Cavalier's Hour by move type).
      ...reentryBattleData(s),
      roster: rm.getRoster(),
      nodeId: s.nodeId,
      formationReturn: memory,
    },
    { reason: TRANSITION_REASONS.CONTINUE },
  );
  if (ok) return;
  // The save already says "on the map": go there, as Back to map would.
  s._keepMusicOnShutdown = false;
  if (s.input) s.input.enabled = true;
  s.registry?.get?.('audio')?.stopMusic?.(s, 0);
  void transitionToSceneWithBlockedRetry(
    s,
    'NodeMap',
    { gameData: s.gameData, runManager: rm },
    { reason: TRANSITION_REASONS.BACK },
  ).then((result) => {
    if (result?.status !== TRANSITION_RESULTS.STARTED && s.sys?.isActive?.() !== false)
      s.showPauseTransitionRecovery?.(TRANSITION_REASONS.BACK);
  });
}
