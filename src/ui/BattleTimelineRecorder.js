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
 * What free (no-action) changes can touch between two actions: positions and
 * commitment, equipment, bags, accessories, convoy and gold. Compared at the
 * next activation so an equip-then-set-aside is not folded into the next
 * unit's rewind point. Cheap: a few strings per unit, no clone.
 */
export function rewindFingerprint(scene) {
  const units = {};
  for (const unit of scene.playerUnits || []) {
    units[unit.battleEntityId] = JSON.stringify([
      unit.col,
      unit.row,
      unit.hasMoved === true,
      unit._movementCommitted === true,
      (unit.inventory || []).indexOf(unit.weapon),
      (unit.inventory || []).map((w) => [w?.name, w?.uses ?? null, w?._usesSpent ?? 0]),
      (unit.consumables || []).map((c) => [c?.name, c?.uses ?? null]),
      unit.accessory?.name || null,
    ]);
  }
  const rm = scene.runManager;
  return {
    units,
    run: JSON.stringify([
      rm?.gold ?? null,
      rm?.convoy?.weapons?.length ?? 0,
      rm?.convoy?.consumables?.length ?? 0,
      (rm?.accessories || []).length,
    ]),
  };
}

/** Player units whose free state differs from the fingerprint (null: unknown). */
export function fingerprintChanges(scene, before) {
  if (!before) return null;
  const now = rewindFingerprint(scene);
  const ids = Object.keys(now.units).filter((id) => now.units[id] !== before.units[id]);
  return ids.length || now.run !== before.run ? ids : [];
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
