import { isCurrentBattleSession } from './BattleSession.js';
import { safeBattlePresentation } from './safeBattlePresentation.js';

function graphics(unit) {
  return [unit.graphic, unit.label, unit.factionIndicator, unit.hpBar?.bg, unit.hpBar?.fill].filter(
    Boolean,
  );
}

/** Milliseconds per tile of a forced move that crossed more than one: Ice slides as walking's. */
const SLIDE_STEP_MS = 60;
const FORCED_STEP_MS = 80;

/**
 * Animate coordinates already settled by ActionMovement; callbacks never change the world.
 * A move that carries its `path` (a forced slide) is drawn tile by tile, the tiles of the
 * slide at walking's slide speed, with the same cleanup as any move: the path is only
 * ever what the settled move already did.
 */
export async function presentSettledMoves(
  scene,
  moves,
  { session, label, fade = false, duration = 80 },
) {
  const presentMove = async ({ unit, to, path }) => {
    if (!isCurrentBattleSession(scene, session)) return;
    const targets = fade ? graphics(unit) : [unit.graphic, unit.label].filter(Boolean);
    const originalAlpha = new Map(targets.map((target) => [target, target.alpha]));
    await safeBattlePresentation(
      `${label} move`,
      async () => {
        try {
          if (targets.length) {
            if (!fade && Array.isArray(path) && path.length > 2) {
              for (const tile of path.slice(1)) {
                const position = scene.grid.gridToPixel(tile.col, tile.row);
                await scene._awaitSceneTween(
                  {
                    targets,
                    x: position.x,
                    y: position.y,
                    duration: tile.slide ? SLIDE_STEP_MS : FORCED_STEP_MS,
                    ease: 'Linear',
                  },
                  { session, label: `${label}_slide` },
                );
                if (!isCurrentBattleSession(scene, session)) return;
              }
            } else {
              const position = scene.grid.gridToPixel(to.col, to.row);
              await scene._awaitSceneTween(
                fade
                  ? { targets, alpha: 0, duration: 180 }
                  : { targets, x: position.x, y: position.y, duration, ease: 'Linear' },
                { session, label: `${label}_${fade ? 'fade_out' : 'move'}` },
              );
              if (!isCurrentBattleSession(scene, session)) return;
            }
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
