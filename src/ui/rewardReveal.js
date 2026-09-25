// Reward reveal (docs/art-direction/items/README.md, "Reward reveal"): the spoils arrive
// face down — Hollow Sun card backs — and turn in order, about 180 ms each with a 90 ms
// stagger; the rarest takes an ember flash. A tap or key skips to the end state; so do
// Reduce motion and Instant speed. Presentation only: the rewards are already saved
// before it plays, and nothing here touches game state or RNG.

export const REVEAL_TURN_MS = 180;
export const REVEAL_STAGGER_MS = 90;
export const REVEAL_LEAD_MS = 120;
export const REVEAL_FLASH_MS = 520;

const RANK = { Legend: 5, Rare: 4, Silver: 3, Steel: 2, Iron: 1 };

/** Rank used to pick the card that flashes (ties: the first). Pure. */
export function revealRank(tier) {
  return RANK[tier] || 0;
}

/** Index of the rarest card, or -1 when none outranks a plain reward. Pure. */
export function rarestIndex(tiers = []) {
  let best = -1;
  let rank = 2; // Only Silver and above flash.
  tiers.forEach((t, i) => {
    const r = revealRank(t);
    if (r > rank) {
      rank = r;
      best = i;
    }
  });
  return best;
}

/** Total reveal time for n cards (ms). Pure. */
export function revealDuration(n, flash = true) {
  if (n <= 0) return 0;
  return (
    REVEAL_LEAD_MS + (n - 1) * REVEAL_STAGGER_MS + REVEAL_TURN_MS + (flash ? REVEAL_FLASH_MS : 0)
  );
}

/**
 * Turn the given cards face up in order.
 * @param {HTMLElement} container element that holds the cards (receives the skip tap)
 * @param {HTMLElement[]} cards
 * @param {{still?:boolean, tiers?:string[], onDone?:() => void,
 *   setTimeout?:Function, clearTimeout?:Function}} [options]
 * @returns {{ skip: () => void, done: boolean }}
 */
export function playRewardReveal(container, cards, options = {}) {
  const {
    still = false,
    tiers = [],
    onDone,
    setTimeout: later = globalThis.setTimeout,
    clearTimeout: cancel = globalThis.clearTimeout,
  } = options;
  const flashAt = rarestIndex(tiers);
  const state = { done: false, skip: () => {} };
  const backs = [];
  let timers = [];
  const finish = () => {
    if (state.done) return;
    state.done = true;
    timers.forEach((t) => cancel(t));
    timers = [];
    container.classList.remove('ia-revealing');
    for (const card of cards) card.classList.remove('ia-face-down', 'ia-flash');
    for (const back of backs) back.remove();
    container.removeEventListener('pointerdown', onSkip, true);
    container.removeEventListener('keydown', onSkip, true);
    onDone?.();
  };
  function onSkip(event) {
    if (state.done) return;
    // The skipping tap only ends the reveal; it must not also pick a card.
    event.preventDefault?.();
    event.stopPropagation?.();
    finish();
  }
  state.skip = finish;
  if (still || !cards.length) {
    finish();
    return state;
  }
  container.classList.add('ia-revealing');
  cards.forEach((card, i) => {
    card.style.setProperty('--ia-i', String(i));
    card.classList.add('ia-face-down');
    const back = document.createElement('span');
    back.className = 'ia-card-back';
    back.setAttribute('aria-hidden', 'true');
    card.append(back);
    backs.push(back);
  });
  if (flashAt >= 0) {
    const card = cards[flashAt];
    const at = REVEAL_LEAD_MS + flashAt * REVEAL_STAGGER_MS + REVEAL_TURN_MS;
    timers.push(
      later(() => {
        card.classList.add('ia-flash');
        timers.push(later(() => card.classList.remove('ia-flash'), REVEAL_FLASH_MS));
      }, at),
    );
  }
  container.addEventListener('pointerdown', onSkip, true);
  container.addEventListener('keydown', onSkip, true);
  timers.push(later(finish, revealDuration(cards.length, flashAt >= 0)));
  return state;
}
