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
import { battleTimelinePreview, timelineChanges } from '../engine/BattleTimelineFacts.js';
import { classifyBattleBoundary } from './BattleCheckpointAdapter.js';

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
  if (
    kind === 'recovery' &&
    !queued.length &&
    !scene._historyBeats?.length &&
    JSON.stringify(previous) === JSON.stringify(preview)
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
  ].slice(0, 256);
  const destination =
    ['turn_start', 'player_action'].includes(kind) &&
    classifyBattleBoundary(scene) === 'destination' &&
    (policy !== 'legacy-v1' || kind === 'turn_start');
  // Old battles can show fresh history, but their old anchors remain accessed
  // by the compatibility confirmation until a complete new turn is captured.
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
    preview,
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
  flag.timeline = next;
  flag.timelineCurrentEntryId = scene._timelineCurrentEntryId;
  return next;
}
