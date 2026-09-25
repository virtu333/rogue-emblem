// MusicIntensity — when an adaptive battle theme plays its calm or full layer.
// Pure logic (no Phaser): BattleMusicController feeds it battle events.
//
// Modeled on the "rain / thunder" pairs of Fire Emblem: Three Houses:
//  - a battle opens on the calm layer;
//  - any exchange of blows raises it to full at once;
//  - the enemy phase raises it when some enemy can reach a player unit;
//  - it settles back to calm at the start of a player phase only after a
//    whole round (player + enemy phase) passed with no combat and no player
//    unit inside the enemy threat range.

export const INTENSITY = Object.freeze({ CALM: 'calm', FULL: 'full' });

export function createIntensityState() {
  return { level: INTENSITY.CALM, combatThisRound: false };
}

/**
 * @param {{level: string, combatThisRound: boolean}} state
 * @param {{type: 'combat'|'phase', phase?: 'player'|'enemy', playersInDanger?: boolean}} event
 * @returns {{level: string, combatThisRound: boolean}} next state (inputs are not mutated)
 */
export function nextIntensity(state, event) {
  const s = { ...(state || createIntensityState()) };
  if (!event) return s;
  if (event.type === 'combat') {
    s.combatThisRound = true;
    s.level = INTENSITY.FULL;
    return s;
  }
  if (event.type === 'phase') {
    const danger = Boolean(event.playersInDanger);
    if (event.phase === 'enemy') {
      if (danger) s.level = INTENSITY.FULL;
      return s;
    }
    if (event.phase === 'player') {
      // A round ends when the next player phase begins.
      if (!s.combatThisRound && !danger) s.level = INTENSITY.CALM;
      else if (danger) s.level = INTENSITY.FULL;
      s.combatThisRound = false;
      return s;
    }
  }
  return s;
}

/** Level to open a battle (or a resumed battle) with. */
export function initialIntensity({ playersInDanger = false } = {}) {
  return playersInDanger ? INTENSITY.FULL : INTENSITY.CALM;
}
