import {
  appendHistoryPresentation,
  retainHistoryPresentation,
  createHistoryPresentation,
  validHistoryFrame,
} from '../engine/BattleHistoryPresentation.js';
import { serializedBytes } from '../engine/BattleStateSnapshot.js';
import { captureHistoryFrame, historyRecordInfo } from './BattleHistoryRecorder.js';
import {
  appendBattleTimeline,
  finishBattleTimelineAction,
  createBattleTimeline,
  hydrateBattleTimeline,
} from '../engine/BattleTimeline.js';
import {
  battleTimelinePreview,
  packPreviewTiles,
  timelineChanges,
} from '../engine/BattleTimelineFacts.js';
import { summarizeActionFact } from '../engine/RewindDestinations.js';
import { classifyBattleBoundary } from './BattleCheckpointAdapter.js';

/**
 * Deterministic serialization of one carried item: its identity plus every
 * per-instance field. Two equally named items (two "Iron Sword +1" forged
 * differently) differ by `uid` and by their forged stat fields; legacy items
 * without a uid are told apart by content alone (forge level / allocations /
 * history, might-hit-crit-weight, `_imbueId`, uses and `_usesSpent`, granted
 * skills, ...). A battle checkpoint restores items as full structured clones
 * (which keep key order), so any field difference is a different board.
 * Items are plain persisted data; native JSON keeps this cheap enough to run
 * at every activation. Pure: never allocates a uid, never draws randomness.
 */
export function itemFingerprint(item) {
  if (item === null || item === undefined) return 'null';
  try {
    return JSON.stringify(item) ?? 'null';
  } catch {
    // Not plain data (never expected): fall back to what identifies it.
    return JSON.stringify([item.uid ?? null, item.name ?? null, item.uses ?? null]);
  }
}

const itemList = (items) =>
  Array.isArray(items) ? `[${items.map(itemFingerprint).join(',')}]` : 'null';

/**
 * What free (no-action) changes can touch between two actions: positions and
 * commitment, equipment, bags, accessories, convoy and gold. Compared at the
 * next activation so an equip-then-set-aside is not folded into the next
 * unit's rewind point. Items are fingerprinted by identity and instance
 * fields (itemFingerprint), never by name, so equipping a different item
 * with the same name is a change. Cheap: a few short strings per unit and
 * one for the run domain; no clone.
 */
export function rewindFingerprint(scene) {
  const units = {};
  for (const unit of scene.playerUnits || []) {
    const inventory = Array.isArray(unit.inventory) ? unit.inventory : [];
    units[unit.battleEntityId] = [
      JSON.stringify([
        unit.col,
        unit.row,
        unit.hasMoved === true,
        unit._movementCommitted === true,
        inventory.indexOf(unit.weapon),
      ]),
      // The equipped item itself (identity + fields), even if not carried.
      unit.weapon ? itemFingerprint(unit.weapon) : 'null',
      itemList(inventory),
      itemList(unit.consumables || []),
      unit.accessory ? itemFingerprint(unit.accessory) : 'null',
    ].join('|');
  }
  // The run domain a checkpoint restores (runBattleState): gold, convoy and
  // the unequipped accessory pool — by identity, not by counts.
  const rm = scene.runManager;
  return {
    units,
    run: [
      JSON.stringify(rm?.gold ?? null),
      itemList(rm?.convoy?.weapons),
      itemList(rm?.convoy?.consumables),
      itemList(rm?.accessories),
    ].join('|'),
  };
}

/**
 * Free state that differs from `before` (a rewindFingerprint).
 * @returns {{ units: string[], run: boolean, changed: boolean } | null}
 *   `units`: player units whose free state changed (including units that
 *   appeared or left); `run`: the run domain (gold, convoy, accessory pool)
 *   changed; `changed`: either. null when there is no baseline (unknown).
 */
export function fingerprintChanges(scene, before) {
  if (!before || typeof before !== 'object' || !before.units) return null;
  const now = rewindFingerprint(scene);
  const ids = Object.keys(now.units).filter((id) => now.units[id] !== before.units[id]);
  for (const id of Object.keys(before.units)) if (!(id in now.units)) ids.push(id);
  const run = now.run !== before.run;
  return { units: ids, run, changed: ids.length > 0 || run };
}

function playerActionFact(scene) {
  const actorId = scene._historyActor || scene._pendingActionCompletion?.unitId || null;
  const units = new Map(
    [
      ...(scene.playerUnits || []),
      ...(scene.enemyUnits || []),
      ...(scene.npcUnits || []),
      ...(scene.escapedUnits || []),
    ].map((unit) => [unit.battleEntityId, unit]),
  );
  const actor = units.get(actorId);
  if (!actor || actor.faction !== 'player') return null;
  try {
    return summarizeActionFact(scene._historyBeats || [], actorId, (id) => {
      const unit = units.get(id);
      return unit ? { name: unit.name, className: unit.className } : null;
    });
  } catch {
    return null;
  }
}

export function recordBattleTimeline(scene, state) {
  const flag = scene.runManager?.battleInProgress;
  if (!flag) return null;
  const policy = flag.rewindPolicy || 'legacy-v1';
  const history =
    scene._battleTimeline ||
    hydrateBattleTimeline(flag.timeline) ||
    createBattleTimeline({ policy });
  const kind = scene._timelineBoundary || 'recovery';
  scene._timelineBoundary = null;
  const queued = scene._timelineFacts || [];
  // Avoid duplicate rows for writes with no new event or completed boundary.
  const preview = battleTimelinePreview(state, scene.gameData?.terrain);
  const previous = history.entries.at(-1)?.preview;
  let frame = null;
  try {
    frame = captureHistoryFrame(scene, state, history.presentation);
    if (!validHistoryFrame(frame)) frame = null;
  } catch {
    /* Optional visuals never block core history. */
  }
  // Compact fallback obeys the same historical terrain knowledge as the map.
  if (frame)
    preview.tiles = frame.tiles.slice(0, 1024).map(({ col, row, label }) => ({ col, row, label }));
  else if (state.fog) {
    const visible = new Set(state.fog.visible);
    preview.tiles = preview.tiles.map((t) =>
      visible.has(`${t.col},${t.row}`) ? t : { ...t, label: 'Unknown' },
    );
  }
  const stored = packPreviewTiles(preview);
  if (
    kind === 'recovery' &&
    !queued.length &&
    !scene._historyBeats?.length &&
    JSON.stringify(previous) === JSON.stringify(stored)
  )
    return history;
  const labels = {
    turn_start: 'Player turn begins.',
    player_action: 'Player action completed.',
    enemy_action: 'Enemy action completed.',
    recovery: 'Action resolved.',
  };
  const facts = [
    ...new Set([
      labels[kind] || 'Battle update.',
      ...queued,
      ...timelineChanges(previous, preview),
    ]),
  ].slice(0, 255);
  // Structured "who did what" for the rewind picker (player actions only).
  const actionFact =
    state.phase === 'player' && ['player_action', 'recovery'].includes(kind)
      ? playerActionFact(scene)
      : null;
  if (actionFact) facts.push(actionFact);
  // Every settled player point is a destination, in legacy battles too: a
  // legacy rewind restores the same canonical checkpoint a resume would and
  // keeps that battle's reroll-on-rewind RNG rule (VisionRewindController).
  const destination =
    ['turn_start', 'player_action'].includes(kind) &&
    classifyBattleBoundary(scene) === 'destination';
  const previousActor = history.presentation?.records.at(-1)?.actorId;
  const actor = scene._historyActor || scene._pendingActionCompletion?.unitId;
  const append =
    kind === 'player_action' && (!previousActor || !actor || previousActor === actor)
      ? finishBattleTimelineAction
      : appendBattleTimeline;
  const next = append(history, {
    kind,
    turnNumber: state.turnNumber,
    phase: state.phase,
    facts,
    preview: stored,
    snapshot: destination ? state : null,
    destination,
  });
  const entry = next.entries.at(-1);
  if (entry && frame) {
    try {
      const presentation = appendHistoryPresentation(
        history.presentation || createHistoryPresentation(history.presentationNextId),
        frame,
        historyRecordInfo(scene, history, entry, frame),
      );
      next.presentationNextId = Math.max(next.presentationNextId || 1, presentation.nextId);
      next.presentation = retainHistoryPresentation(
        presentation,
        Math.max(
          0,
          Math.min(
            128 * 1024,
            next.limits.maxBytes - serializedBytes({ ...next, presentation: null }),
          ),
        ),
      );
    } catch {
      next.presentation = null;
      next.presentationGeneration = (next.presentationGeneration || 0) + 1;
    }
  } else if (!frame) {
    next.presentation = null;
    next.presentationGeneration = (next.presentationGeneration || 0) + 1;
  }
  scene._historyBeats = [];
  scene._historyActor = null;
  scene._timelineFacts = [];
  scene._battleTimeline = next;
  scene._timelineCurrentEntryId = next.entries.at(-1)?.id || null;
  // The board a new destination restores; free changes after it are detected
  // before the next activation (VisionRewindController.settleParkedActivation).
  if (next.entries.at(-1)?.destination) scene._rewindFingerprint = rewindFingerprint(scene);
  flag.timeline = next;
  flag.timelineCurrentEntryId = scene._timelineCurrentEntryId;
  return next;
}
