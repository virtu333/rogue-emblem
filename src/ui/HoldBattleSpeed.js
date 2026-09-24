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
