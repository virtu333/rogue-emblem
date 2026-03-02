import { transitionToScene, TRANSITION_REASONS } from '../utils/SceneRouter.js';
import { resetTransitionLocks } from '../utils/sceneLoader.js';
import { clearSavedRun } from '../engine/RunManager.js';
import { deleteRunSave } from '../cloud/CloudSync.js';

export class TransitionRecoveryController {
  constructor(scene) {
    this.scene = scene;
  }

  showDefeatRecovery() {
    const scene = this.scene;
    if (scene.defeatRecoveryPrompt?.length) return;
    const cam = scene.cameras.main;
    const group = [];

    const blocker = scene.add
      .rectangle(cam.centerX, cam.centerY, cam.width, cam.height, 0x000000, 0.72)
      .setDepth(910)
      .setInteractive();
    group.push(blocker);

    const panel = scene.add
      .rectangle(cam.centerX, cam.centerY, 420, 170, 0x111122, 0.97)
      .setDepth(911)
      .setStrokeStyle(2, 0x777777)
      .setInteractive();
    group.push(panel);

    const title = scene.add
      .text(cam.centerX, cam.centerY - 42, 'Transition failed', {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#ff8888',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setDepth(912);
    group.push(title);

    const msg = scene.add
      .text(
        cam.centerX,
        cam.centerY - 12,
        'Could not open Run Complete.\nRetry or return to title.',
        {
          fontFamily: 'monospace',
          fontSize: '12px',
          color: '#dddddd',
          align: 'center',
        },
      )
      .setOrigin(0.5)
      .setDepth(912);
    group.push(msg);

    const retryBtn = scene.add
      .text(cam.centerX - 84, cam.centerY + 44, '[ Retry ]', {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#aaddff',
        backgroundColor: '#223344',
        padding: { x: 10, y: 5 },
      })
      .setOrigin(0.5)
      .setDepth(912)
      .setInteractive({ useHandCursor: true });
    retryBtn.on('pointerover', () => retryBtn.setColor('#ffdd44'));
    retryBtn.on('pointerout', () => retryBtn.setColor('#aaddff'));
    retryBtn.on('pointerdown', async (pointer) => {
      if (pointer?.button !== 0) return;
      retryBtn.disableInteractive();
      retryBtn.setText('[ Retrying... ]');
      resetTransitionLocks(scene);
      const transitioned = await scene.transitionToRunCompleteWithRetry('defeat');
      if (!transitioned) {
        // Nuclear fallback: bypass startSceneLazy entirely
        try {
          // prettier-ignore
          scene.scene.start('RunComplete', { gameData: scene.gameData, runManager: scene.runManager, result: 'defeat' }); // scene-router-bypass
        } catch (err) {
          console.error('[BattleScene] direct RunComplete fallback failed:', err);
          retryBtn.setText('[ Retry ]');
          retryBtn.setInteractive({ useHandCursor: true });
        }
      }
    });
    group.push(retryBtn);

    const titleBtn = scene.add
      .text(cam.centerX + 84, cam.centerY + 44, '[ Title ]', {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#e0e0e0',
        backgroundColor: '#333333',
        padding: { x: 10, y: 5 },
      })
      .setOrigin(0.5)
      .setDepth(912)
      .setInteractive({ useHandCursor: true });
    titleBtn.on('pointerover', () => titleBtn.setColor('#ffdd44'));
    titleBtn.on('pointerout', () => titleBtn.setColor('#e0e0e0'));
    titleBtn.on('pointerdown', (pointer) => {
      if (pointer?.button !== 0) return;
      titleBtn.disableInteractive();
      const cloud = scene.registry.get('cloud');
      const slot = scene.registry.get('activeSlot');
      clearSavedRun(
        cloud ? (resolvedSlot) => deleteRunSave(cloud.userId, resolvedSlot) : null,
        slot,
      );
      const audio = scene.registry.get('audio');
      if (audio) audio.stopMusic(scene, 0);
      resetTransitionLocks(scene);
      transitionToScene(
        scene,
        'Title',
        { gameData: scene.gameData },
        { reason: TRANSITION_REASONS.DEFEAT },
      ).then((ok) => {
        if (!ok) {
          try {
            scene.scene.start('Title', { gameData: scene.gameData }); // scene-router-bypass
          } catch (err) {
            console.error('[BattleScene] direct Title fallback failed:', err);
            titleBtn.setInteractive({ useHandCursor: true });
          }
        }
      });
    });
    group.push(titleBtn);

    scene._pinToScreen(group);
    scene.defeatRecoveryPrompt = group;
  }

  showVictoryRecovery() {
    const scene = this.scene;
    if (scene.victoryRecoveryPrompt?.length) return;

    // Clear the victory banner so recovery UI is visible.
    if (scene._victoryBanner) {
      scene._victoryBanner.destroy();
      scene._victoryBanner = null;
    }

    const cam = scene.cameras.main;
    const group = [];

    const blocker = scene.add
      .rectangle(cam.centerX, cam.centerY, cam.width, cam.height, 0x000000, 0.72)
      .setDepth(910)
      .setInteractive();
    group.push(blocker);

    const panel = scene.add
      .rectangle(cam.centerX, cam.centerY, 420, 170, 0x111122, 0.97)
      .setDepth(911)
      .setStrokeStyle(2, 0x777777)
      .setInteractive();
    group.push(panel);

    const title = scene.add
      .text(cam.centerX, cam.centerY - 42, 'Transition failed', {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#ff8888',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setDepth(912);
    group.push(title);

    const msg = scene.add
      .text(
        cam.centerX,
        cam.centerY - 12,
        'Could not open Run Complete.\nRetry or return to title.',
        {
          fontFamily: 'monospace',
          fontSize: '12px',
          color: '#dddddd',
          align: 'center',
        },
      )
      .setOrigin(0.5)
      .setDepth(912);
    group.push(msg);

    const retryBtn = scene.add
      .text(cam.centerX - 84, cam.centerY + 44, '[ Retry ]', {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#aaddff',
        backgroundColor: '#223344',
        padding: { x: 10, y: 5 },
      })
      .setOrigin(0.5)
      .setDepth(912)
      .setInteractive({ useHandCursor: true });
    retryBtn.on('pointerover', () => retryBtn.setColor('#ffdd44'));
    retryBtn.on('pointerout', () => retryBtn.setColor('#aaddff'));
    retryBtn.on('pointerdown', async (pointer) => {
      if (pointer?.button !== 0) return;
      retryBtn.disableInteractive();
      retryBtn.setText('[ Retrying... ]');
      resetTransitionLocks(scene);
      const transitioned = await scene.transitionToRunCompleteWithRetry('victory');
      if (!transitioned) {
        // RunCompleteScene class may not be loaded: reload page as last resort.
        try {
          globalThis.location?.reload();
        } catch (err) {
          console.error('[BattleScene] victory reload fallback failed:', err);
          retryBtn.setText('[ Retry ]');
          retryBtn.setInteractive({ useHandCursor: true });
        }
      }
    });
    group.push(retryBtn);

    const titleBtn = scene.add
      .text(cam.centerX + 84, cam.centerY + 44, '[ Title ]', {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#e0e0e0',
        backgroundColor: '#333333',
        padding: { x: 10, y: 5 },
      })
      .setOrigin(0.5)
      .setDepth(912)
      .setInteractive({ useHandCursor: true });
    titleBtn.on('pointerover', () => titleBtn.setColor('#ffdd44'));
    titleBtn.on('pointerout', () => titleBtn.setColor('#e0e0e0'));
    titleBtn.on('pointerdown', (pointer) => {
      if (pointer?.button !== 0) return;
      titleBtn.disableInteractive();
      const cloud = scene.registry.get('cloud');
      const slot = scene.registry.get('activeSlot');
      clearSavedRun(
        cloud ? (resolvedSlot) => deleteRunSave(cloud.userId, resolvedSlot) : null,
        slot,
      );
      const audio = scene.registry.get('audio');
      if (audio) audio.stopMusic(scene, 0);
      resetTransitionLocks(scene);
      transitionToScene(
        scene,
        'Title',
        { gameData: scene.gameData },
        { reason: TRANSITION_REASONS.RETURN_TITLE },
      ).then((ok) => {
        if (!ok) {
          try {
            scene.scene.start('Title', { gameData: scene.gameData }); // scene-router-bypass
          } catch (err) {
            console.error('[BattleScene] victory Title fallback failed:', err);
            titleBtn.setInteractive({ useHandCursor: true });
          }
        }
      });
    });
    group.push(titleBtn);

    scene._pinToScreen(group);
    scene.victoryRecoveryPrompt = group;
  }

  destroy() {
    this.scene = null;
  }
}
