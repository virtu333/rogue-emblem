// eclipseContent — pure copy for the Eclipse (docs/specs/eclipse.md). No DOM, no Phaser.
//
// Vocabulary: the Eclipse is the meter, Shadow the number (never a percentage), the
// phases are Pale · Waning · Umbral · Totality · Hollow, and a node the dark has taken
// is Eclipsed. Every string a surface shows is built here so the words stay one voice.

import { eclipsePhase } from '../engine/EclipseSystem.js';

/** HUD projection label: "Sun holds" or "Shadow +N". */
export function shadowProjectionLabel(gain) {
  const n = Math.max(0, Math.trunc(Number(gain) || 0));
  return n > 0 ? `Shadow +${n}` : 'Sun holds';
}

/** Projection tone for colour: 'held' (0), 'rising' (1-3) or 'dark' (4+). */
export function shadowProjectionTone(gain) {
  const n = Math.max(0, Math.trunc(Number(gain) || 0));
  if (n <= 0) return 'held';
  return n <= 3 ? 'rising' : 'dark';
}

/** Victory band suffix: "Sun held" or "Shadow +N" ('' when the Eclipse is off). */
export function victoryShadowText(gain) {
  if (gain == null || !Number.isFinite(Number(gain))) return '';
  const n = Math.max(0, Math.trunc(Number(gain)));
  return n > 0 ? `Shadow +${n}` : 'Sun held';
}

/** "Umbral · 58" style summary for run end and records. */
export function shadowSummary(shadow, config) {
  const value = Math.max(0, Math.trunc(Number(shadow) || 0));
  return `${eclipsePhase(value, config).name} · ${value} shadow`;
}

/** Inspect-card line for a node that will fall soon. */
export function fallCountdownText(remaining) {
  const n = Math.max(1, Math.trunc(Number(remaining) || 1));
  return `The dark takes this in ${n} more shadow`;
}

/**
 * The explainer card: what darkens the sun, what it does now, how close the next fall is.
 * @param {object} view - RunManager.getEclipseView()
 * @param {object} config - data/eclipse.json
 * @param {{ kindlePrice?: number|null }} [extra]
 */
export function eclipseExplainer(view, config, { kindlePrice = null } = {}) {
  if (!view || !config) return null;
  const phase = view.phase;
  const levels = Array.isArray(config.phaseEnemyLevelBonus) ? config.phaseEnemyLevelBonus : [];
  const levelBonus = Math.trunc(Number(levels[Math.min(phase.index, levels.length - 1)]) || 0);
  const grace = Math.max(0, Math.trunc(Number(config.graceUnderPar) || 0));
  const effects = [];
  if (levelBonus > 0)
    effects.push(`Enemies are ${levelBonus} level${levelBonus > 1 ? 's' : ''} higher.`);
  const affix = config.phaseAffix || {};
  const phases = Array.isArray(config.phases) ? config.phases.map((p) => p.id) : [];
  const hardFrom = phases.indexOf(affix.hardGatingFromPhase);
  const extraFrom = phases.indexOf(affix.extraMaxAffixFromPhase);
  if (hardFrom >= 0 && phase.index >= hardFrom)
    effects.push('Enemy affixes appear as often as on Hard (Normal runs).');
  if (extraFrom >= 0 && phase.index >= extraFrom)
    effects.push(
      `Affixed enemies can carry ${Math.max(1, affix.extraMaxAffixes || 1)} more affix.`,
    );
  if (!effects.length) effects.push('Nothing yet. The land is whole.');
  const next = view.nextFall;
  const fallLine =
    next == null
      ? 'No knot within reach is left for the dark to take this act.'
      : `The next knot within reach falls in ${next} more shadow.`;
  const relief = Math.max(0, Math.trunc(Number(config.bossRelief) || 0));
  const kindle = Math.max(0, Math.trunc(Number(config.kindleAmount) || 0));
  return {
    kicker: 'The Eclipse',
    phase: phase.name,
    shadow: view.shadow,
    actShadow: view.actShadow,
    sections: [
      {
        title: 'What darkens it',
        lines: [
          `Only battle time. A clear ${grace} turns under par holds the sun; every turn past that adds 1 shadow at victory.`,
          `Defeating an act's boss lifts ${relief}. Churches can Kindle the sun for gold (−${kindle}${kindlePrice != null ? `, ${kindlePrice} G here` : ''}).`,
        ],
      },
      { title: `What ${phase.name} does now`, lines: effects },
      {
        title: 'The land ahead',
        lines: [
          `This act has gathered ${view.actShadow} shadow. ${fallLine}`,
          'Eclipsed knots become harder battles with elite spoils (pick 2 of 4).',
        ],
      },
    ],
  };
}

/** "Umbral · 58 shadow" for a run ('' when its Eclipse is off). */
export function runEclipseSummary(runManager) {
  try {
    if (!runManager?.isEclipseActive?.()) return '';
    return shadowSummary(runManager.eclipse?.shadow, runManager.getEclipseConfig());
  } catch {
    return '';
  }
}

/** Act card kicker suffix: "Umbral" (phase name) when the Eclipse runs. */
export function actPhaseName(runManager) {
  try {
    if (!runManager?.isEclipseActive?.()) return '';
    return eclipsePhase(runManager.eclipse?.shadow, runManager.getEclipseConfig()).name;
  } catch {
    return '';
  }
}
