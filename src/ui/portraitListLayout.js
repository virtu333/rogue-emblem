// Portrait mode for the list-and-detail screens (Reference menus, roster sheet).
//
// The portrait shell sets `portrait-ui` on <html> while an opted-in phone is held
// upright and announces each change with PORTRAIT_UI_EVENT. The CSS for these
// screens keys off that class *and* `(orientation: portrait)`; the few behaviours
// that need script (a master -> detail step, a Back button) ask the same question
// here, so markup and styles always agree. Without the class nothing changes.

export const PORTRAIT_UI_CLASS = 'portrait-ui';
export const PORTRAIT_UI_EVENT = 'emblem-rogue:portrait-ui';
const PORTRAIT_QUERY = '(orientation: portrait)';

/** True when the upright list layouts apply right now. */
export function portraitListLayout(env = globalThis) {
  try {
    const root = env?.document?.documentElement;
    if (!root?.classList?.contains(PORTRAIT_UI_CLASS)) return false;
    return env.matchMedia?.(PORTRAIT_QUERY)?.matches === true;
  } catch {
    return false;
  }
}

/**
 * Call `onChange(active)` whenever portraitListLayout() flips (the shell's event or a
 * rotation). Returns an unsubscribe function.
 */
export function watchPortraitListLayout(onChange, env = globalThis) {
  let last = portraitListLayout(env);
  const check = () => {
    const now = portraitListLayout(env);
    if (now === last) return;
    last = now;
    onChange(now);
  };
  const media = (() => {
    try {
      return env?.matchMedia?.(PORTRAIT_QUERY) || null;
    } catch {
      return null;
    }
  })();
  env?.addEventListener?.(PORTRAIT_UI_EVENT, check);
  media?.addEventListener?.('change', check);
  return () => {
    env?.removeEventListener?.(PORTRAIT_UI_EVENT, check);
    media?.removeEventListener?.('change', check);
  };
}
