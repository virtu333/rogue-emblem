import { isCurrentBattleSession } from './BattleSession.js';
import { safeBattlePresentation } from './safeBattlePresentation.js';

/** Display an already-settled move. Coordinates and RNG belong to the engine. */
export async function presentTeleporterWarp(scene, unit, warp, { session }) {
  if (!warp || !isCurrentBattleSession(scene, session)) return;
  const targets = [
    unit.graphic,
    unit.label,
    unit.factionIndicator,
    unit.hpBar?.bg,
    unit.hpBar?.fill,
  ].filter(Boolean);
  if (targets.length === 0) return;
  const originalAlpha = new Map(targets.map((target) => [target, target.alpha]));
  try {
    await scene._awaitSceneTween(
      { targets, alpha: 0, duration: 180 },
      { label: 'teleporter_fade_out', session },
    );
    if (!isCurrentBattleSession(scene, session)) return;
    scene.updateUnitPosition(unit);
    await scene._awaitSceneTween(
      { targets, alpha: (target) => originalAlpha.get(target), duration: 180 },
      { label: 'teleporter_fade_in', session },
    );
  } finally {
    if (isCurrentBattleSession(scene, session)) {
      for (const target of targets)
        safeBattlePresentation(
          'warp opacity cleanup',
          () => target.setAlpha?.(originalAlpha.get(target)),
          { scene },
        );
    }
  }
}
