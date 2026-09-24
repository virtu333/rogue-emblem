// Church lifecycle only. ChurchMenu owns rendering and input on every device.
import { ChurchMenu } from './ChurchMenu.js';
import { MUSIC, getMusicKey, pickTrack } from '../utils/musicConfig.js';
import { showMinorHint } from './HintDisplay.js';
import { trackSceneTimer, clearTrackedSceneTimer } from '../utils/sceneTimers.js';
import { saveServiceRun } from './serviceSave.js';

export class ChurchController {
  constructor(scene) {
    this.scene = scene;
  }
  handleChurch(node, options = {}) {
    const scene = this.scene;
    const ruinsMode = options?.ruinsMode === true;
    const audio = scene.registry.get('audio');
    if (audio) audio.playMusic(pickTrack(MUSIC.rest), scene, 300); // Peaceful music

    scene._churchPromotionsThisVisit = ruinsMode
      ? 0
      : scene.runManager.getChurchPromotionCount(node.id);
    scene._currentChurchNodeId = node.id;
    scene.showChurchOverlay(node, { ruinsMode });
  }

  handleRuins(node) {
    this.handleChurch(node, { ruinsMode: true });
  }

  showChurchOverlay(node, options = {}) {
    const scene = this.scene;
    scene._churchRuinsMode = options?.ruinsMode === true;
    scene.churchOverlay = [];
    scene._churchNode = node;
    scene._churchViewingMap = false;
    this.nativeMenu?.destroy();
    this.nativeMenu = new ChurchMenu(this);
  }

  leaveChurchNode() {
    const scene = this.scene;
    if (!scene.churchOverlay) return;
    if (typeof scene.sound?.stopByKey === 'function') scene.sound.stopByKey('sfx_levelup');
    const node = scene._churchNode;
    const audio = scene.registry.get('audio');
    if (audio) audio.playMusic(getMusicKey('nodeMap', scene.runManager.currentAct), scene, 300);
    scene.closeChurchOverlay();
    if (node) {
      scene.runManager.markNodeComplete(node.id);
      const warning = saveServiceRun(scene);
      if (warning) showMinorHint(scene, warning.trim());
      scene.checkActComplete();
    }
  }

  _showChurchSuccessMessage(node, functionalMessage, functionalColor, flavorType) {
    const scene = this.scene;
    scene.refreshChurchOverlay(node);
    scene.showChurchMessage(functionalMessage, functionalColor);
    try {
      scene._scheduleChurchFlavor(flavorType);
    } catch (_) {
      /* best-effort flavor — don't block functional message */
    }
  }

  _scheduleChurchFlavor(flavorType, delayMs = 600) {
    const scene = this.scene;
    clearTrackedSceneTimer(scene, scene._churchFlavorTimer);
    scene._churchFlavorTimer = null;
    const act = scene.runManager?.currentAct || 'act1';
    const pool =
      scene.gameData?.dialogue?.churchFlavor?.[flavorType]?.[act] ||
      scene.gameData?.dialogue?.churchFlavor?.[flavorType]?.['act3'];
    if (!Array.isArray(pool) || pool.length === 0) return;
    const line = pool[Math.floor(Math.random() * pool.length)];
    scene._churchFlavorTimer = trackSceneTimer(
      scene,
      scene.time?.delayedCall?.(delayMs, () => {
        scene._churchFlavorTimer = null;
        if (scene.scene?.isActive && !scene.scene.isActive()) return;
        if (!Array.isArray(scene.churchOverlay)) return;
        scene.showChurchMessage(line, '#aabbcc');
      }),
    );
  }

  showChurchMessage(text) {
    if (this.scene.scene?.isActive && !this.scene.scene.isActive()) return;
    if (!this.scene.churchOverlay) return;
    this.nativeMenu?.render(text);
  }

  refreshChurchOverlay() {
    this.nativeMenu?.render();
  }

  closeChurchOverlay() {
    this.nativeMenu?.destroy();
    this.nativeMenu = null;
    const scene = this.scene;
    scene._churchViewingRoster = false;
    clearTrackedSceneTimer(scene, scene._churchMessageTimer);
    scene._churchMessageTimer = null;
    clearTrackedSceneTimer(scene, scene._churchFlavorTimer);
    scene._churchFlavorTimer = null;
    if (scene.churchOverlay) {
      scene.churchOverlay.forEach((o) => o.destroy());
      scene.churchOverlay = null;
    }
    if (scene.churchContentGroup) {
      scene.churchContentGroup.forEach((o) => o.destroy());
      scene.churchContentGroup = null;
    }
    if (scene.churchMessage) {
      scene.churchMessage.destroy();
      scene.churchMessage = null;
    }
    scene.churchGoldText = null;
    scene._churchNode = null;
    scene._churchViewingMap = false;
    if (scene._churchReturnBtn) {
      scene._churchReturnBtn.destroy();
      scene._churchReturnBtn = null;
    }
    scene._churchMapViewSuppressCancel = false;
    scene.churchScrollOffset = 0;
    scene.churchScrollMax = 0;
    scene._churchScrollItems = null;
    scene._churchRuinsMode = false;
    scene._touchScrollDrag = null;
  }

  destroy() {
    this.closeChurchOverlay();
    this.scene = null;
  }
}
