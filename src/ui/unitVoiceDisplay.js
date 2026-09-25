// unitVoiceDisplay — the per-run temperament a recruit speaks with, for
// profile surfaces (presentation only; see engine/UnitVoice.js).
import { temperamentFor, temperamentLabel, voiceContext } from '../engine/UnitVoice.js';

/** The recruit's temperament label for this run, or null (lords, no data). */
export function unitTemperament(scene, unit) {
  if (!unit || unit.isLord || (unit.faction && unit.faction !== 'player')) return null;
  const ctx = voiceContext({ gameData: scene?.gameData, runManager: scene?.runManager });
  return temperamentLabel(temperamentFor(unit, ctx), ctx.voice);
}
