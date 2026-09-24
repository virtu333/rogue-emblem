import { presentationText } from '../utils/presentationText.js';
import { hasDOMHost } from '../utils/domUI.js';
import { MenuSurface, element, button } from './MenuSurface.js';
import { inputHint } from '../utils/inputHint.js';
import { UI_PALETTE, UI_HEX } from '../utils/uiStyles.js';
// HintDisplay — Two display functions for tutorial hints
// Important/long hints require dismissal. Short hints allow a reading window.

const DEPTH = 965;

/**
 * Show a centered hint box that blocks until the player dismisses it.
 * Returns a Promise that resolves when Space, Enter, or click is pressed.
 */
export function showImportantHint(scene, message, { minimumMs = 0 } = {}) {
  if (hasDOMHost())
    return new Promise((resolve) => {
      let settled = false;
      const openedAt = Date.now();
      const shutdown = () => finish(false);
      const finish = (acknowledged = true) => {
        if (acknowledged && Date.now() - openedAt < minimumMs) return;
        if (settled) return;
        settled = true;
        scene.events.off('shutdown', shutdown);
        menu.destroy();
        resolve(acknowledged);
      };
      const menu = new MenuSurface(scene, 'Field notes', finish, { modal: true });
      menu.root.classList.add('re-run-flow');
      menu.header.querySelector('button').remove();
      if (scene.battleParams?.tutorialMode) menu.root.classList.add('re-tutorial-note');
      menu.body.append(element('p', message), button('Continue', finish, 're-btn re-btn--primary'));
      menu.onKey = (event) => {
        if (event.key !== ' ') return false;
        finish();
        return true;
      };
      scene.events.once('shutdown', shutdown);
      menu.focusContent();
    });
  return new Promise((resolve) => {
    const cam = scene.cameras.main;
    const cx = cam.centerX;
    const cy = cam.centerY;
    const objects = [];

    // Dark box background
    const textObj = presentationText(scene, cx, cy - 10, message, {
      fontFamily: 'monospace',
      fontSize: '12px',
      color: UI_PALETTE.accentText,
      align: 'center',
      wordWrap: { width: 420 },
      lineSpacing: 4,
    })
      .setOrigin(0.5)
      .setDepth(DEPTH + 1)
      .setAlpha(0);

    const footerObj = presentationText(
      scene,
      cx,
      0,
      inputHint(scene, '[Space / Click to continue]', 'Tap to continue'),
      {
        fontFamily: 'monospace',
        fontSize: '9px',
        color: UI_PALETTE.muted,
        align: 'center',
      },
    )
      .setOrigin(0.5)
      .setDepth(DEPTH + 1)
      .setAlpha(0);

    // Size box around text
    const padX = 30;
    const padTop = 20;
    const padBottom = 32;
    const boxW = textObj.width + padX * 2;
    const boxH = textObj.height + padTop + padBottom;
    const boxY = cy - 10;

    footerObj.setY(boxY + boxH / 2 - 14);

    const bg = scene.add
      .rectangle(cx, boxY, boxW, boxH, 0x000000, 0.92)
      .setStrokeStyle(2, UI_HEX.accent)
      .setDepth(DEPTH)
      .setAlpha(0);

    objects.push(bg, textObj, footerObj);

    // Fade in
    for (const obj of objects) {
      scene.tweens.add({ targets: obj, alpha: 1, duration: 200 });
    }

    // Dismiss handler
    const openedAt = Date.now();
    const cleanup = (acknowledged) => {
      spaceKey.off('down', onDismiss);
      enterKey.off('down', onDismiss);
      bg.off('pointerdown', onDismiss);
      for (const obj of objects) obj.destroy();
      resolve(acknowledged);
    };

    let dismissed = false;
    const onShutdown = () => {
      if (dismissed) return;
      dismissed = true;
      cleanup(false);
    };
    scene.events.once('shutdown', onShutdown);

    const onDismiss = () => {
      if (Date.now() - openedAt < minimumMs) return;
      if (dismissed) return;
      dismissed = true;
      scene.events.off('shutdown', onShutdown);
      cleanup(true);
    };

    const spaceKey = scene.input.keyboard.addKey('SPACE');
    const enterKey = scene.input.keyboard.addKey('ENTER');
    spaceKey.on('down', onDismiss);
    enterKey.on('down', onDismiss);
    bg.setInteractive().on('pointerdown', onDismiss);
  });
}

/**
 * Queue a hint: short notes fade; long notes require acknowledgement.
 * Non-blocking. Returns a Promise for optional chaining.
 */
export function showMinorHint(scene, message, options = {}) {
  let canceled = false;
  const cancel = () => {
    canceled = true;
  };
  scene.events?.once?.('shutdown', cancel);
  const render = () => {
    if (canceled || (options.canShow && !options.canShow())) return;
    options.onShown?.();
    return renderMinorHint(scene, message).then((read) => {
      if (read) options.onRead?.();
    });
  };
  const next = (
    scene._minorHintQueue ? scene._minorHintQueue.then(render) : Promise.resolve(render())
  ).finally(() => scene.events?.off?.('shutdown', cancel));
  scene._minorHintQueue = next.catch(() => {});
  return next;
}

export function hintReadingPolicy(message) {
  const words = String(message).trim().split(/\s+/).filter(Boolean).length;
  return { requiresDismissal: words > 12, duration: Math.max(4000, words * 300) };
}

function renderMinorHint(scene, message) {
  const policy = hintReadingPolicy(message);
  if (policy.requiresDismissal) return showImportantHint(scene, message, { minimumMs: 500 });
  if (hasDOMHost())
    return new Promise((resolve) => {
      const toast = element('div', message, 're re-hint-toast');
      toast.setAttribute('role', 'status');
      document.getElementById('game-wrapper').append(toast);
      let remainedVisible = document.visibilityState !== 'hidden';
      const visibilityChanged = () => {
        if (document.visibilityState === 'hidden') remainedVisible = false;
      };
      document.addEventListener('visibilitychange', visibilityChanged);
      const shutdown = () => finish(false);
      const finish = (read = true) => {
        clearTimeout(timer);
        scene.events.off('shutdown', shutdown);
        document.removeEventListener('visibilitychange', visibilityChanged);
        toast.remove();
        resolve(read && remainedVisible);
      };
      const timer = setTimeout(finish, policy.duration);
      scene.events.once('shutdown', shutdown);
    });
  return new Promise((resolve) => {
    const cam = scene.cameras.main;
    const cx = cam.centerX;
    const y = cam.height - 40;

    const text = presentationText(scene, cx, y, message, {
      fontFamily: 'monospace',
      fontSize: '11px',
      color: UI_PALETTE.accentText,
      align: 'center',
      backgroundColor: '#000000cc',
      padding: { x: 12, y: 6 },
    })
      .setOrigin(0.5)
      .setDepth(DEPTH)
      .setAlpha(0);

    let settled = false;
    const shutdown = () => finish(false);
    const finish = (read) => {
      if (settled) return;
      settled = true;
      scene.events.off('shutdown', shutdown);
      scene.tweens.killTweensOf?.(text);
      text.destroy();
      resolve(read);
    };
    scene.events.once('shutdown', shutdown);
    // Fade in → hold → fade out → destroy
    scene.tweens.add({
      targets: text,
      alpha: 1,
      duration: 200,
      onComplete: () => {
        scene.tweens.add({
          targets: text,
          alpha: 0,
          delay: policy.duration,
          duration: 200,
          onComplete: () => {
            finish(true);
          },
        });
      },
    });
  });
}

// Shared budget for inline explanations and queued toasts. Only claim on display.
export function claimContextualHint(scene, id) {
  const hints = scene.registry?.get?.('hints');
  if (
    scene.battleParams?.tutorialMode ||
    !hints ||
    hints.hasSeen(id) ||
    scene.registry.get('settings')?.getHints?.() === false
  )
    return false;
  const battle = `${scene.battleParams?.battleSeed ?? ''}:${scene.runManager?.currentNodeId ?? ''}`;
  if (scene._contextualHintBattle === battle) return false;
  scene._contextualHintBattle = battle;
  return true;
}

// A mounted note may still be below a phone's scroll viewport. Require its
// full text rectangle to fit inside the viewport and every clipping ancestor.
export function isHintTextVisible(node) {
  if (!node?.isConnected || !node.getBoundingClientRect) return false;
  const rect = node.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  let left = 0,
    top = 0;
  let right = globalThis.window?.innerWidth ?? Infinity;
  let bottom = globalThis.window?.innerHeight ?? Infinity;
  for (let parent = node; parent; parent = parent.parentElement) {
    if (parent.hidden || parent.inert) return false;
    const style = globalThis.getComputedStyle?.(parent);
    if (style?.visibility === 'hidden' || style?.display === 'none' || style?.opacity === '0')
      return false;
    if (parent === node) continue;
    const bounds = parent.getBoundingClientRect();
    if (/auto|scroll|hidden|clip/.test(style?.overflowX || '')) {
      left = Math.max(left, bounds.left);
      right = Math.min(right, bounds.right);
    }
    if (/auto|scroll|hidden|clip/.test(style?.overflowY || '')) {
      top = Math.max(top, bounds.top);
      bottom = Math.min(bottom, bounds.bottom);
    }
  }
  return rect.left >= left && rect.right <= right && rect.top >= top && rect.bottom <= bottom;
}

// Inline explanations count as read only after continuous visible exposure.
// Hidden/offscreen time resets the window; scrolling back in can still teach it.
export function observeContextualHint(scene, id, message, isVisible) {
  const battle = scene._contextualHintBattle;
  const hints = scene.registry.get('hints');
  let finished = false;
  const visible = () => globalThis.document?.visibilityState !== 'hidden' && isVisible();
  let visibleSince = visible() ? Date.now() : null;
  const stop = () => {
    if (finished) return;
    finished = true;
    clearInterval(timer);
    scene.events?.off?.('shutdown', stop);
    scene.events?.off?.('update', check);
    globalThis.document?.removeEventListener('visibilitychange', check);
    if (!hints.hasSeen(id) && scene._contextualHintBattle === battle)
      scene._contextualHintBattle = undefined;
  };
  const check = () => {
    if (!visible()) visibleSince = null;
    else if (visibleSince === null) visibleSince = Date.now();
    else if (Date.now() - visibleSince >= hintReadingPolicy(message).duration) {
      hints.markSeen(id);
      stop();
    }
  };
  const timer = setInterval(check, 100);
  scene.events?.once?.('shutdown', stop);
  scene.events?.on?.('update', check);
  globalThis.document?.addEventListener('visibilitychange', check);
  return stop;
}

function waitForHintIdle(scene) {
  if (scene.battleState === 'PLAYER_IDLE') return Promise.resolve(true);
  return new Promise((resolve) => {
    const finish = (ready) => {
      scene.events.off('update', check);
      scene.events.off('shutdown', shutdown);
      resolve(ready);
    };
    const check = () => {
      if (scene.battleState === 'PLAYER_IDLE') finish(true);
    };
    const shutdown = () => finish(false);
    scene.events.on('update', check);
    scene.events.once('shutdown', shutdown);
  });
}

// At most one optional helper per battle. Unshown hints remain unseen so later
// encounters can teach them. Scripted tutorial notes use their own strict flow.
export function showContextualHint(scene, id, message) {
  if (scene.battleParams?.tutorialMode) return false;
  const hints = scene.registry.get('hints');
  if (!hints || scene.registry.get('settings')?.getHints?.() === false || hints.hasSeen(id))
    return false;
  const battle = `${scene.battleParams?.battleSeed ?? ''}:${scene.runManager?.currentNodeId ?? ''}`;
  if (scene._contextualHintBattle === battle) return false;
  const pending = (scene._pendingContextualHints ||= new Set());
  if (pending.has(id)) return false;
  pending.add(id);
  const display = () =>
    showMinorHint(scene, message, {
      canShow: () =>
        scene.battleState === 'PLAYER_IDLE' &&
        scene._contextualHintBattle !== battle &&
        !hints.hasSeen(id) &&
        scene.registry.get('settings')?.getHints?.() !== false,
      onShown: () => {
        scene._contextualHintBattle = battle;
      },
      onRead: () => hints.markSeen(id),
    });
  // Keep menu/heal lessons queued until they can own input safely.
  const task =
    scene.battleState === 'PLAYER_IDLE'
      ? display()
      : waitForHintIdle(scene).then((ready) => ready && display());
  void task.finally(() => pending.delete(id));
  return true;
}
