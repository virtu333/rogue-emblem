// What headless play does not model (tools/play), as data: written into every
// session's manifest, and noticed in play the first time the army could have used
// it, so a run's record says which of its outcomes the missing rules may have shaped.
//
// A notice is about opportunity, not use: "P3 has Blink" means every turn P3 played
// was planned without it. Each entry's `detect(game)` returns the keys (one per unit
// or map that has the ability) and a line for each.

import { isRelocateStaff } from '../../src/engine/StaffRelocation.js';

function armyOf(game) {
  if (game.phase === 'battle' && game.battle) return game.battle.battle.playerUnits;
  return game.rm?.roster || [];
}

export const UNSUPPORTED = Object.freeze([
  {
    id: 'relocation-staves',
    what: 'Rescue and warp staves.',
    detect: (game) =>
      armyOf(game).flatMap((u) =>
        (u.inventory || [])
          .filter((w) => isRelocateStaff(w))
          .map((w) => ({
            key: `relocate:${u.name}:${w.name}`,
            line: `${u.name} carries ${w.name}: relocation staves are not modelled headless.`,
          })),
      ),
  },
  {
    id: 'battle-seals',
    what: 'Promotion and reclass seals used in battle (they work on the route map).',
    detect: (game) =>
      game.phase !== 'battle'
        ? []
        : armyOf(game)
            .filter((u) =>
              (u.consumables || []).some((c) => c.effect === 'promote' || c.effect === 'reclass'),
            )
            .map((u) => ({
              key: `seal:${u.name}`,
              line: `${u.name} carries a seal: using it in battle is not modelled headless (use it on the route map).`,
            })),
  },
  {
    id: 'ballista',
    what: 'Manning a ballista.',
    detect: (game) =>
      game.phase === 'battle' && game.battle?.battle?.battleConfig?.ballistas?.length
        ? [
            {
              key: `ballista:${game.battle.node.id}`,
              line: 'This map has a ballista: manning it is not modelled headless.',
            },
          ]
        : [],
  },
]);

/** Notices not yet given (keys not in `noticed`), in list order. */
export function newNotices(game, noticed = new Set()) {
  const out = [];
  for (const entry of UNSUPPORTED) {
    for (const notice of entry.detect(game)) {
      if (noticed.has(notice.key) || out.some((n) => n.key === notice.key)) continue;
      out.push({ id: entry.id, ...notice });
    }
  }
  return out;
}

export function noticeLine(notice) {
  return `(Not modelled: ${notice.line})`;
}
