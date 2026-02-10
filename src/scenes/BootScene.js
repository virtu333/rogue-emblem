// BootScene — loads game data, then launches TitleScene

import { DataLoader } from '../engine/DataLoader.js';
import { AudioManager } from '../utils/AudioManager.js';
import { SettingsManager } from '../utils/SettingsManager.js';
import { ALL_MUSIC_KEYS } from '../utils/musicConfig.js';
import { cloudState } from '../main.js';
import { pushSettings } from '../cloud/CloudSync.js';
import { migrateOldSaves } from '../engine/SlotManager.js';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload() {
    // Character sprites (32) — keyed by filename
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

    // Enemy sprites (25) — keyed as enemy_{name}
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

    // Portraits (32) — keyed as portrait_{name}
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
    for (const name of portraits) {
      this.load.image(`portrait_${name}`, `assets/portraits/${name}.png`);
    }

    // Node map icons (6) — keyed as node_{type}
    const nodeIcons = ['battle', 'rest', 'boss', 'boss_final', 'shop', 'recruit', 'elite'];
    for (const name of nodeIcons) {
      this.load.image(`node_${name}`, `assets/sprites/nodes/node_${name}.png`);
    }

    // UI icons (37) — keyed as icon_{type}
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

    // Music (21 tracks — per-act battle, boss, exploration + title, home base, stingers)
    for (const key of ALL_MUSIC_KEYS) {
      this.load.audio(key, `assets/audio/music/${key}.ogg`);
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
      this.load.audio(key, `assets/audio/sfx/${key}.ogg`);
    }
  }

  async create() {
    let data;
    try {
      const loader = new DataLoader();
      data = await loader.loadAll();
    } catch (err) {
      this.children.removeAll(true);
      this.add.text(320, 220, 'Failed to load game data.\nPlease refresh the page.', {
        fontFamily: 'monospace', fontSize: '16px', color: '#ff4444', align: 'center',
      }).setOrigin(0.5);
      this.add.text(320, 280, err.message, {
        fontFamily: 'monospace', fontSize: '11px', color: '#999999', align: 'center',
      }).setOrigin(0.5);
      console.error('BootScene data load failed:', err);
      return;
    }

    // Migrate old single-save data to slot 1 (idempotent)
    migrateOldSaves();

    const settings = new SettingsManager();
    this.registry.set('settings', settings);

    const audio = new AudioManager(this.sound);
    audio.setMusicVolume(settings.getMusicVolume());
    audio.setSFXVolume(settings.getSFXVolume());
    this.registry.set('audio', audio);

    // Wire cloud sync callbacks (settings only — meta is per-slot, wired on slot selection)
    if (cloudState) {
      const uid = cloudState.userId;
      settings.onSave = (d) => pushSettings(uid, d);
      this.registry.set('cloud', cloudState);
    }

    this.scene.start('Title', { gameData: data });
  }
}
