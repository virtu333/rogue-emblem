export function canHoldBattleSpeed(scene) {
  return scene._combatSpeedSnapshot !== undefined || scene.turnManager?.currentPhase === 'enemy';
}

// This dedicated control owns its press. It never listens to map or modal taps.
export function bindHoldBattleSpeed(control, scene) {
  const clear = () => {
    scene._holdBattleFast = false;
    control.setAttribute('aria-pressed', 'false');
  };
  const start = (event) => {
    event.preventDefault();
    if (!canHoldBattleSpeed(scene)) return;
    scene._holdBattleFast = true;
    control.setAttribute('aria-pressed', 'true');
    if (event.pointerId != null) {
      try {
        control.setPointerCapture?.(event.pointerId);
      } catch {
        // A cancelled pointer can lose capture before this handler runs.
        clear();
      }
    }
  };
  const down = (event) => {
    if (event.key === ' ' || event.key === 'Enter') start(event);
  };
  const up = (event) => {
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      clear();
    }
  };
  control.addEventListener('pointerdown', start);
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture', 'blur'])
    control.addEventListener(type, clear);
  control.addEventListener('keydown', down);
  control.addEventListener('keyup', up);
  window.addEventListener('blur', clear);
  document.addEventListener('visibilitychange', clear);
  return () => {
    clear();
    window.removeEventListener('blur', clear);
    document.removeEventListener('visibilitychange', clear);
    control.removeEventListener('pointerdown', start);
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture', 'blur'])
      control.removeEventListener(type, clear);
    control.removeEventListener('keydown', down);
    control.removeEventListener('keyup', up);
  };
}

/**
 * The desktop hold key (docs/specs/large-maps/02-encounters-and-pacing.md §2.5): Shift
 * held alone, and only while `battleState === 'ENEMY_PHASE'`, sets `_holdBattleFast` as
 * the phone's control does. It is narrower than the phone's control: in the player
 * phase Shift is a modifier (Shift+N) and never touches the speed. Releasing Shift,
 * another key or modifier joining it, the window losing focus and `release()` (the
 * scene calls it as the enemy phase ends) all clear it. Space is never used: it
 * dismisses hints and dialogue.
 * @param {object} scene the battle scene
 * @param {{ on: Function, off: Function }} keyboard Phaser's keyboard plugin (DOM events)
 * @returns {{ release: () => void, destroy: () => void }}
 */
export function bindShiftHoldBattleSpeed(scene, keyboard) {
  let held = false;
  const release = () => {
    if (!held) return;
    held = false;
    scene._holdBattleFast = false;
  };
  const down = (event) => {
    if (event?.key !== 'Shift' || event.ctrlKey || event.altKey || event.metaKey) {
      // Not Shift alone: a chord (Shift+N) is never a fast-forward.
      release();
      return;
    }
    if (scene.battleState !== 'ENEMY_PHASE') return;
    held = true;
    scene._holdBattleFast = true;
  };
  const up = (event) => {
    if (event?.key === 'Shift') release();
  };
  keyboard?.on?.('keydown', down);
  keyboard?.on?.('keyup', up);
  const win = typeof window !== 'undefined' ? window : null;
  const doc = typeof document !== 'undefined' ? document : null;
  win?.addEventListener?.('blur', release);
  doc?.addEventListener?.('visibilitychange', release);
  return {
    release,
    destroy() {
      release();
      keyboard?.off?.('keydown', down);
      keyboard?.off?.('keyup', up);
      win?.removeEventListener?.('blur', release);
      doc?.removeEventListener?.('visibilitychange', release);
    },
  };
}
