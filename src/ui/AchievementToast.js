// AchievementToast — the small card that says an achievement was earned
// (docs/specs/achievements.md §6). Installed once at boot (main.js); it listens to
// AchievementStore's notices, which come only after the meta write that holds them landed.
//
// A card sits in the top corner over whatever is open (route map, battle, menu) for a few
// seconds and goes. It is click-through (never takes a tap meant for the HUD below it), never
// pauses play and takes no input scope. Several at once stack, three at most on screen, the
// rest waiting their turn. The retroactive pass is one summary card. One chime per notice.
// Reduce motion: no slide, the card simply appears and goes. Timers only: no Phaser tween and
// never the RNG, so a card shown mid-battle changes nothing in it.

import { element } from './MenuSurface.js';
import { achievementMedal } from './AchievementsTab.js';
import { unlockCards } from './achievementsModel.js';
import { onAchievementsUnlocked } from '../engine/AchievementStore.js';

export const TOAST_HOLD_MS = 4200;
export const TOAST_LEAVE_MS = 260;
export const TOAST_MAX_SHOWN = 3;
export const TOAST_SFX = 'sfx_chime';

function defaultHost() {
  return document.getElementById('game-wrapper') || document.body;
}

/**
 * Start listening. Returns the uninstall (tests; the game keeps it for good).
 * @param {object} [options]
 * @param {() => object|null} [options.gameGetter]  the Phaser game (settings, audio)
 * @param {() => HTMLElement} [options.host]
 * @param {(fn: Function, ms: number) => any} [options.setTimer]
 */
export function installAchievementToasts({
  gameGetter = () => globalThis.window?.__emblemRogueGame || null,
  host = defaultHost,
  setTimer = (fn, ms) => globalThis.setTimeout(fn, ms),
} = {}) {
  const waiting = [];
  let shown = 0;
  let stack = null;

  const registry = () => gameGetter()?.registry || null;
  const reducedMotion = () => {
    try {
      return Boolean(registry()?.get?.('settings')?.getReduceMotion?.());
    } catch {
      return false;
    }
  };
  const chime = () => {
    try {
      registry()?.get?.('audio')?.playSFX?.(TOAST_SFX);
    } catch {
      /* sound is decoration */
    }
  };
  const stackEl = () => {
    if (stack?.isConnected) return stack;
    stack = element('div', null, 'ach-toasts');
    stack.setAttribute('role', 'status');
    stack.setAttribute('aria-live', 'polite');
    host().append(stack);
    return stack;
  };

  const showNext = () => {
    while (shown < TOAST_MAX_SHOWN && waiting.length) {
      const card = waiting.shift();
      const parent = stackEl();
      parent.classList.toggle('is-still', reducedMotion());
      const toast = element('div', null, 'ach-toast');
      toast.dataset.tier = card.tier;
      toast.dataset.kind = card.kind;
      if (card.id) toast.dataset.id = card.id;
      const text = element('div', null, 'ach-toast-text');
      text.append(
        element('span', card.heading, 'ach-toast-heading'),
        element('strong', card.name, 'ach-toast-name'),
        element('span', card.rule, 'ach-toast-rule'),
      );
      toast.append(achievementMedal(card.tier), text);
      parent.append(toast);
      shown++;
      setTimer(() => {
        toast.classList.add('is-leaving');
        setTimer(
          () => {
            toast.remove();
            shown--;
            if (!stack?.childElementCount) stack?.remove();
            showNext();
          },
          reducedMotion() ? 0 : TOAST_LEAVE_MS,
        );
      }, TOAST_HOLD_MS);
    }
  };

  return onAchievementsUnlocked((ids, { retro = false } = {}) => {
    try {
      const cards = unlockCards(ids, { retro });
      if (!cards.length) return;
      waiting.push(...cards);
      chime();
      showNext();
    } catch (error) {
      console.warn('[Achievements] card skipped:', error?.message || error);
    }
  });
}
