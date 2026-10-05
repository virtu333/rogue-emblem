// What headless play does not model (tools/play), as data: written into every
// session's manifest, and noticed in play the first time the army could have used
// it, so a run's record says which of its outcomes the missing rules may have shaped.
//
// A notice is about opportunity, not use: "P3 has Canto" means every move P3 made
// was planned without it. Each entry's `detect(game)` returns the keys (one per unit
// or map that has the ability) and a line for each.

import { cantoRuleFor } from '../../src/engine/CantoRule.js';
import { isRelocateStaff } from '../../src/engine/StaffRelocation.js';

const ACTION_SKILLS = Object.freeze({
  shove: 'Shove',
  pull: 'Pull',
  dance: 'Dance',
  blink: 'Blink',
  rally_cry_skill: 'Rally Cry',
  healing_circle: 'Healing Circle',
  ensnare: 'Ensnare',
});

function armyOf(game) {
  if (game.phase === 'battle' && game.battle) return game.battle.battle.playerUnits;
  return game.rm?.roster || [];
}

export const UNSUPPORTED = Object.freeze([
  {
    id: 'canto',
    what: 'Canto and Measured Step: moving again after acting.',
    detect: (game) =>
      armyOf(game)
        .filter((u) => cantoRuleFor(u, game.gameData.skills))
        .map((u) => ({
          key: `canto:${u.name}`,
          line: `${u.name} has ${cantoRuleFor(u, game.gameData.skills) === 'any' ? 'Canto' : 'Measured Step'}: moving on after an action is not modelled headless.`,
        })),
  },
  {
    id: 'action-skills',
    what: 'Action skills: Shove, Pull, Dance, Blink, Rally Cry, Healing Circle, Ensnare.',
    detect: (game) =>
      armyOf(game).flatMap((u) =>
        (u.skills || [])
          .filter((id) => ACTION_SKILLS[id])
          .map((id) => ({
            key: `action:${id}:${u.name}`,
            line: `${u.name} has ${ACTION_SKILLS[id]}: the action is not modelled headless.`,
          })),
      ),
  },
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
    id: 'trade',
    what: 'In-battle Trade between adjacent units.',
    detect: () => [],
  },
  {
    id: 'vision',
    what: 'Vision rewinds (a battle cannot be rewound; forking a session is not the same).',
    detect: (game) =>
      (game.rm?.visionChargesRemaining || 0) > 0 && game.phase === 'battle'
        ? [
            {
              key: 'vision',
              line: `The army holds ${game.rm.visionChargesRemaining} Vision charge(s): rewinds are not modelled headless.`,
            },
          ]
        : [],
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
