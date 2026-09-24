import Phaser from 'phaser';
import { battlefieldTerrainArtEnabled } from '../ui/battlefieldArtFlags.js';
import { loadWeatheredArt } from '../ui/WeatheredTerrain.js';
import { BattleHistoryRenderer } from '../ui/BattleHistoryRenderer.js';

let terrainArt;

// Owns only display objects and a camera. No BattleScene/RunManager references.
export class BattleHistoryScene extends Phaser.Scene {
  constructor(key, ready) {
    super({ key });
    this.onReady = ready;
  }
  create() {
    this.cameras.main.setBackgroundColor('#101722');
    this.renderer = new BattleHistoryRenderer(this);
    this.events.once('shutdown', () => this.renderer.destroy());
    // Removing a scene emits destroy directly, without a preceding shutdown.
    this.events.once('destroy', () => this.renderer.destroy());
    if (battlefieldTerrainArtEnabled()) {
      terrainArt ||= loadWeatheredArt(`${import.meta.env.BASE_URL}assets/terrain/weathered`).catch(
        () => null,
      );
      terrainArt.then((art) => {
        if (this.sys.isActive()) {
          this.renderer.art = art;
          this.onReady(this);
        }
      });
    } else this.onReady(this);
  }
}
