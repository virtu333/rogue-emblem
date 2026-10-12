// Art bodies the catalog no longer carries, kept so the mechanics they were the only users of
// stay covered (docs/specs/legendary-arts-rework.md: Doomblade's Doom Thrust became the leap).

/** Doom Thrust as it was: a range-2 line that pierces one tile, then a push when adjacent. */
export const LEGACY_DOOM_THRUST = Object.freeze({
  id: 'fixture_doom_thrust',
  name: 'Doom Thrust (old)',
  weaponType: 'Lance',
  tierAffinity: 'Legendary',
  unlockAct: 'act3',
  requiredRank: 'Mast',
  hpCost: 8,
  perTurnLimit: 1,
  perMapLimit: 2,
  targeting: 'normal_attack',
  area: {
    shape: 'line',
    length: 1,
    damage: { kind: 'scaled', multiplier: 1 },
    strikes: 'each_landed',
  },
  description: 'Runs one foe through and shoves it back.',
  allowedFactions: ['player'],
  effects: { afterCombat: [{ type: 'move', mode: 'push', distance: 1 }] },
  combatMods: {
    atkBonus: 8,
    hitBonus: 15,
    activated: [{ id: 'weapon_art', name: 'Doom Thrust (old)' }],
  },
  noFollowUp: true,
});
