import { reportAsyncError } from '../utils/errorReporter.js';

const REPORT_INTERVAL_MS = 60_000;
const sceneReports = new WeakMap();
const standaloneReports = new Map();

// Call only with presentation work: model mutations and required effects stay
// outside this boundary so a destroyed renderer cannot interrupt resolution.
export function safeBattlePresentation(label, present, { scene } = {}) {
  const failed = (error) => {
    let reports = standaloneReports;
    if (scene && typeof scene === 'object') {
      reports = sceneReports.get(scene);
      if (!reports) sceneReports.set(scene, (reports = new Map()));
    }
    const now = Date.now();
    const key = `${label}:${error?.name || 'Error'}`;
    const prior = reports.get(key);
    if (prior !== undefined && now - prior < REPORT_INTERVAL_MS) return;
    reports.set(key, now);
    console.warn(`[BattleScene] ${label} presentation failed; continuing:`, error);
    reportAsyncError('battle_presentation_failed', error, {
      label,
      battleState: scene?.battleState,
      phase: scene?.turnManager?.currentPhase,
      turn: scene?.turnManager?.turnNumber,
    });
  };
  try {
    const result = present();
    return result && typeof result.catch === 'function' ? result.catch(failed) : result;
  } catch (error) {
    failed(error);
  }
}
