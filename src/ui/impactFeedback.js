// impactFeedback — the feel of a landed strike beyond its animation: a haptic pulse and,
// for a boss's blow on the army, a camera shake. Presentation only: it reads the settled
// combat event and never changes game state, draws Math.random or throws (haptic() and
// the shake both swallow their own errors).

import { haptic } from '../utils/haptics.js';

/**
 * A strike has made contact (the scene's `onContact`). A miss and a blow that dealt
 * nothing give no feedback; a crit is heavy, any other damaging strike light. A boss
 * landing damage on a player unit also shakes the screen.
 */
export function strikeFeedback(scene, event, striker, target) {
  if (!event || event.miss) return;
  if (!(Number(event.damage) > 0)) return;
  haptic(event.isCrit ? 'heavy' : 'light');
  if (striker?.isBoss && target?.faction === 'player') scene?.shakeScreen?.('boss');
}
