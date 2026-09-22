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
  if (kind === 'recovery' && !queued.length && JSON.stringify(previous) === JSON.stringify(preview))
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
  const append = kind === 'player_action' ? finishBattleTimelineAction : appendBattleTimeline;
  const next = append(history, {
    kind,
    turnNumber: state.turnNumber,
    phase: state.phase,
    facts,
    preview,
    snapshot: destination ? state : null,
    destination,
  });
  scene._timelineFacts = [];
  scene._battleTimeline = next;
  scene._timelineCurrentEntryId = next.entries.at(-1)?.id || null;
  flag.timeline = next;
  flag.timelineCurrentEntryId = scene._timelineCurrentEntryId;
  return next;
}
