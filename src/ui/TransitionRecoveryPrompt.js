// TransitionRecoveryPrompt — shared stateless recovery UI for pause transition failures.
// Used by BattleScene and NodeMapScene when transitionToScene('Title') fails.

import { transitionToScene } from '../utils/SceneRouter.js';
import { resetTransitionLocks } from '../utils/sceneLoader.js';
import { markStartup } from '../utils/startupTelemetry.js';

/**
 * Show a recovery prompt with Retry + Reload buttons.
 *
 * @param {Phaser.Scene} scene
 * @param {object} opts
 * @param {string} opts.reason       — TRANSITION_REASONS value
 * @param {string} opts.sceneName    — telemetry label ('Battle'|'NodeMap')
 * @param {string} opts.guardKey     — property on scene for idempotency
 * @param {object} opts.titleData    — data for Title scene ({ gameData })
 * @param {string} [opts.overlayKey] — scene property to null-out (e.g. 'pauseOverlay')
 * @returns {object[]|null}          — created UI group, or null if guard blocked
 */
export function showTransitionRecoveryPrompt(
  scene,
  { reason, sceneName, guardKey, titleData, overlayKey },
) {
  if (scene[guardKey]?.length) return null;
  if (overlayKey) scene[overlayKey] = null; // clean stale overlay ref
  const cam = scene.cameras.main;
  const group = [];

  const blocker = scene.add
    .rectangle(cam.centerX, cam.centerY, cam.width, cam.height, 0x000000, 0.72)
    .setDepth(910)
    .setInteractive();
  group.push(blocker);

  const panel = scene.add
    .rectangle(cam.centerX, cam.centerY, 380, 150, 0x111122, 0.97)
    .setDepth(911)
    .setStrokeStyle(2, 0x777777)
    .setInteractive();
  group.push(panel);

  const msg = scene.add
    .text(cam.centerX, cam.centerY - 28, 'Transition to title failed.', {
      fontFamily: 'monospace',
      fontSize: '13px',
      color: '#ff8888',
    })
    .setOrigin(0.5)
    .setDepth(912);
  group.push(msg);

  // Retry button
  const retryBtn = scene.add
    .text(cam.centerX, cam.centerY + 12, '[ Retry ]', {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#aaddff',
      backgroundColor: '#223344',
      padding: { x: 12, y: 5 },
    })
    .setOrigin(0.5)
    .setDepth(912)
    .setInteractive({ useHandCursor: true });
  retryBtn.on('pointerover', () => retryBtn.setColor('#ffdd44'));
  retryBtn.on('pointerout', () => retryBtn.setColor('#aaddff'));
  retryBtn.on('pointerdown', () => {
    retryBtn.disableInteractive();
    retryBtn.setText('[ Retrying... ]');
    markStartup('pause_transition_recovery_retry', { scene: sceneName, reason: String(reason) });
    resetTransitionLocks(scene);
    transitionToScene(scene, 'Title', titleData, { reason })
      .then((ok) => {
        if (!ok) {
          try {
            scene.scene.start('Title', titleData);
          } catch (err) {
            // scene-router-bypass
            console.error(`[${sceneName}] pause recovery fallback failed:`, err);
            retryBtn.setText('[ Retry ]');
            retryBtn.setInteractive({ useHandCursor: true });
          }
        }
      })
      .catch((err) => {
        console.error(`[${sceneName}] pause recovery retry rejected:`, err);
        retryBtn.setText('[ Retry ]');
        retryBtn.setInteractive({ useHandCursor: true });
      });
  });
  group.push(retryBtn);

  // Reload escape hatch
  const reloadBtn = scene.add
    .text(cam.centerX, cam.centerY + 48, '[ Reload Page ]', {
      fontFamily: 'monospace',
      fontSize: '11px',
      color: '#777777',
      padding: { x: 8, y: 3 },
    })
    .setOrigin(0.5)
    .setDepth(912)
    .setInteractive({ useHandCursor: true });
  reloadBtn.on('pointerover', () => reloadBtn.setColor('#aaaaaa'));
  reloadBtn.on('pointerout', () => reloadBtn.setColor('#777777'));
  reloadBtn.on('pointerdown', () => {
    markStartup('pause_transition_reload', { scene: sceneName, reason: String(reason) });
    globalThis.location?.reload?.();
  });
  group.push(reloadBtn);

  scene[guardKey] = group;
  return group;
}
