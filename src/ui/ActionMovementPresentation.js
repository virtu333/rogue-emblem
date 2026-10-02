import { isCurrentBattleSession } from './BattleSession.js';
import { safeBattlePresentation } from './safeBattlePresentation.js';

function graphics(unit) {
  return [unit.graphic, unit.label, unit.factionIndicator, unit.hpBar?.bg, unit.hpBar?.fill].filter(
    Boolean,
  );
}

/** Animate coordinates already settled by ActionMovement; callbacks never change the world. */
export async function presentSettledMoves(
  scene,
  moves,
  { session, label, fade = false, duration = 80 },
) {
  const presentMove = async ({ unit, to }) => {
    if (!isCurrentBattleSession(scene, session)) return;
    const targets = fade ? graphics(unit) : [unit.graphic, unit.label].filter(Boolean);
    const originalAlpha = new Map(targets.map((target) => [target, target.alpha]));
    await safeBattlePresentation(
      `${label} move`,
      async () => {
        try {
          if (targets.length) {
            const position = scene.grid.gridToPixel(to.col, to.row);
            await scene._awaitSceneTween(
              fade
                ? { targets, alpha: 0, duration: 180 }
                : { targets, x: position.x, y: position.y, duration, ease: 'Linear' },
              { session, label: `${label}_${fade ? 'fade_out' : 'move'}` },
            );
            if (!isCurrentBattleSession(scene, session)) return;
          }
          scene.updateUnitPosition(unit);
          if (fade && targets.length) {
            await scene._awaitSceneTween(
              { targets, alpha: (target) => originalAlpha.get(target), duration: 180 },
              { session, label: `${label}_fade_in` },
            );
          }
        } finally {
          if (isCurrentBattleSession(scene, session)) {
            safeBattlePresentation(
              `${label} position cleanup`,
              () => scene.updateUnitPosition(unit),
              { scene },
            );
            if (fade)
              for (const target of targets)
                safeBattlePresentation(
                  `${label} opacity cleanup`,
                  () => target.setAlpha?.(originalAlpha.get(target)),
                  { scene },
                );
          }
        }
      },
      { scene },
    );
  };
  if (fade) {
    for (const move of moves) {
      await presentMove(move);
      if (!isCurrentBattleSession(scene, session)) return;
    }
  } else {
    // Pull and Swap retain simultaneous position tweens; only their renderer waits.
    await Promise.all(moves.map(presentMove));
  }
}
