// BootScene - loads game data, then launches TitleScene

import { DataLoader } from '../engine/DataLoader.js';
import { AudioManager } from '../utils/AudioManager.js';
import { SettingsManager } from '../utils/SettingsManager.js';
import { cloudState } from '../main.js';
import { pushSettings } from '../cloud/CloudSync.js';
import { migrateOldSaves } from '../engine/SlotManager.js';
import { getStartupFlags } from '../utils/runtimeFlags.js';
import { markStartup, recordStartupAssetFailure } from '../utils/startupTelemetry.js';

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

async function loadGameDataWithRetry({ retries, timeoutMs, delayMs }) {
  let lastError = null;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      markStartup('boot_data_load_attempt', { attempt, retries, timeoutMs });
      const loader = new DataLoader();
      const data = await withTimeout(loader.loadAll(), timeoutMs);
      return data;
    } catch (err) {
      lastError = err;
      markStartup('boot_data_load_retry', { attempt, message: err?.message || 'unknown' });
      if (attempt < retries) await wait(delayMs);
    }
  }
  throw lastError || new Error('Failed to load game data');
}

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload() {
    this._startupFlags = getStartupFlags();
    this._deferredAssetGroups = [];

    const failedFiles = [];
    const statusText = this.add.text(320, 210, 'Loading assets...', {
      fontFamily: 'monospace', fontSize: '14px', color: '#cccccc', align: 'center',
    }).setOrigin(0.5);
    const progressText = this.add.text(320, 240, '0%', {
      fontFamily: 'monospace', fontSize: '12px', color: '#aaaaaa', align: 'center',
    }).setOrigin(0.5);

    markStartup('boot_preload_start', {
      reducedPreload: this._startupFlags.reducedPreload,
      mobileSafeBoot: this._startupFlags.mobileSafeBoot,
    });

    this.load.on('progress', (value) => {
      progressText.setText(`${Math.round(value * 100)}%`);
    });
    this.load.on('fileprogress', (file) => {
      if (file?.key) statusText.setText(`Loading ${file.key}...`);
    });
    this.load.on('loaderror', (file) => {
      if (file?.key) failedFiles.push(file.key);
      recordStartupAssetFailure(file, 'Boot');
    });
    this.load.once('complete', () => {
      this._failedAssetKeys = failedFiles;
      statusText.destroy();
      progressText.destroy();
      markStartup('boot_preload_complete', {
        failedAssetCount: failedFiles.length,
        deferredAssetGroups: this._deferredAssetGroups,
      });
    });

    // Character sprites (32) - keyed by filename
    const characterSprites = [
      'edric', 'archer', 'assassin', 'bishop', 'bishop_alt',
      'cavalier', 'cleric', 'cleric_alt', 'dancer', 'falcon_knight',
      'fighter', 'general', 'grandmaster', 'great_lord', 'hero',
      'knight', 'light_priestess', 'light_sage', 'lord', 'mage',
      'mercenary', 'myrmidon', 'paladin', 'pegasus_knight', 'ranger',
      'sage', 'sniper', 'swordmaster', 'tactician', 'thief',
      'vanguard', 'warrior',
    ];
    for (const name of characterSprites) {
      this.load.image(name, `assets/sprites/characters/${name}.png`);
    }

    // Enemy sprites (25) - keyed as enemy_{name}
    const enemySprites = [
      'archer', 'assassin', 'bishop', 'cavalier', 'cleric', 'dragon',
      'falcon_knight', 'fighter', 'general', 'hero', 'knight',
      'mage', 'mercenary', 'myrmidon', 'paladin', 'pegasus_knight',
      'sage', 'sniper', 'swordmaster', 'thief', 'warrior', 'warrior_alt',
      'wyvern_priest', 'zombie', 'zombie_brute',
    ];
    for (const name of enemySprites) {
      this.load.image(`enemy_${name}`, `assets/sprites/enemies/${name}.png`);
    }

    // Terrain tiles (10)
    const terrainNames = [
      'plain', 'forest', 'mountain', 'fort', 'throne',
      'wall', 'water', 'bridge', 'sand', 'village',
    ];
    for (const name of terrainNames) {
      this.load.image(`terrain_${name}`, `assets/sprites/tilesets/${name}.png`);
    }

    // Portraits (32) - keyed as portrait_{name}
    const portraits = [
      'lord_edric', 'lord_kira', 'lord_sera', 'lord_voss',
      'generic_archer', 'generic_assassin', 'generic_bishop',
      'generic_cavalier', 'generic_cleric', 'generic_dancer',
      'generic_falcon_knight', 'generic_fighter', 'generic_general',
      'generic_hero', 'generic_knight', 'generic_mage',
      'generic_mercenary', 'generic_myrmidon', 'generic_paladin',
      'generic_pegasus_knight', 'generic_sage', 'generic_sniper',
      'generic_swordmaster', 'generic_thief', 'generic_warrior',
      'boss_iron_captain', 'boss_warchief', 'boss_knight_commander',
      'boss_archmage', 'boss_blade_lord', 'boss_iron_wall', 'boss_dark_champion',
    ];
    if (this._startupFlags.reducedPreload) {
      this._deferredAssetGroups.push('portraits');
    } else {
      for (const name of portraits) {
        this.load.image(`portrait_${name}`, `assets/portraits/${name}.png`);
      }
    }

    // Node map icons (6) - keyed as node_{type}
    const nodeIcons = ['battle', 'rest', 'boss', 'boss_final', 'shop', 'recruit', 'elite'];
    for (const name of nodeIcons) {
      this.load.image(`node_${name}`, `assets/sprites/nodes/node_${name}.png`);
    }

    // UI icons (37) - keyed as icon_{type}
    const uiIcons = [
      'sword', 'axe', 'lance', 'bow', 'tome',
      'staff', 'potion', 'gold', 'scroll', 'light',
      // Stat boosters
      'energy_drop', 'spirit_dust', 'secret_book', 'speedwing',
      'dracoshield', 'talisman', 'angelic_robe',
      // Extra items
      'whetstone', 'master_seal', 'elixir',
      // Accessories
      'power_ring', 'magic_ring', 'speed_ring', 'shield_ring',
      'barrier_ring', 'skill_ring', 'goddess_icon', 'seraph_robe',
      'boots', 'delphi_shield', 'veterans_crest',
      'wrath_band', 'counter_seal', 'pursuit_ring', 'nullify_ring',
      'life_ring', 'forest_charm',
    ];
    for (const name of uiIcons) {
      this.load.image(`icon_${name}`, `assets/sprites/ui/icon_${name}.png`);
    }

    // SFX (18 effects)
    const sfxKeys = [
      'sfx_sword', 'sfx_lance', 'sfx_axe', 'sfx_bow',
      'sfx_fire', 'sfx_thunder', 'sfx_ice', 'sfx_light', 'sfx_dark',
      'sfx_heal', 'sfx_hit', 'sfx_crit', 'sfx_death',
      'sfx_cursor', 'sfx_confirm', 'sfx_cancel',
      'sfx_levelup', 'sfx_gold',
    ];
    for (const key of sfxKeys) {
      this.load.audio(key, [
        `assets/audio/sfx/${key}.ogg`,
        `assets/audio/sfx/${key}.mp3`,
      ]);
    }
  }

  async create() {
    markStartup('boot_create_start');

    if (Array.isArray(this._failedAssetKeys) && this._failedAssetKeys.length > 0) {
      const sample = this._failedAssetKeys.slice(0, 3).join(', ');
      this.add.text(320, 26, `Warning: ${this._failedAssetKeys.length} asset(s) failed (${sample})`, {
        fontFamily: 'monospace', fontSize: '10px', color: '#ffb347', align: 'center',
      }).setOrigin(0.5);
    }

    let data;
    try {
      const retries = this._startupFlags.mobileSafeBoot ? 3 : 2;
      const timeoutMs = this._startupFlags.mobileSafeBoot ? 4500 : 6000;
      data = await loadGameDataWithRetry({ retries, timeoutMs, delayMs: 250 });
      markStartup('boot_data_load_complete');
    } catch (err) {
      this.children.removeAll(true);
      this.add.text(320, 220, 'Failed to load game data.\nPlease refresh the page.', {
        fontFamily: 'monospace', fontSize: '16px', color: '#ff4444', align: 'center',
      }).setOrigin(0.5);
      this.add.text(320, 280, err.message, {
        fontFamily: 'monospace', fontSize: '11px', color: '#999999', align: 'center',
      }).setOrigin(0.5);
      markStartup('boot_data_load_failed', { message: err?.message || 'unknown' });
      console.error('BootScene data load failed:', err);
      return;
    }

    // Migrate old single-save data to slot 1 (idempotent)
    migrateOldSaves();

    const settings = new SettingsManager();
    this.registry.set('settings', settings);
    this.registry.set('startupFlags', this._startupFlags);

    const audio = new AudioManager(this.sound);
    audio.setMusicVolume(settings.getMusicVolume());
    audio.setSFXVolume(settings.getSFXVolume());
    this.registry.set('audio', audio);

    // Wire cloud sync callbacks (settings only - meta is per-slot, wired on slot selection)
    if (cloudState) {
      const uid = cloudState.userId;
      settings.onSave = (d) => pushSettings(uid, d);
      this.registry.set('cloud', cloudState);
    }

    markStartup('boot_scene_complete');
    this.scene.start('Title', { gameData: data });
  }
}
