import { validateBlessingsConfig } from './BlessingEngine.js';

// DataLoader — fetches and parses game data JSON files

export class DataLoader {
  constructor() {
    this.terrain = null;
    this.lords = null;
    this.classes = null;
    this.weapons = null;
    this.skills = null;
    this.mapSizes = null;
    this.mapTemplates = null;
    this.enemies = null;
    this.consumables = null;
    this.lootTables = null;
    this.recruits = null;
    this.metaUpgrades = null;
    this.accessories = null;
    this.whetstones = null;
    this.turnBonus = null;
    this.blessings = null;
  }

  async loadAll() {
    const [terrain, lords, classes, weapons, skills, mapSizes, mapTemplates, enemies, consumables, lootTables, recruits, metaUpgrades, accessories, whetstones, turnBonus, blessings] = await Promise.all([
      this.loadJSON('data/terrain.json'),
      this.loadJSON('data/lords.json'),
      this.loadJSON('data/classes.json'),
      this.loadJSON('data/weapons.json'),
      this.loadJSON('data/skills.json'),
      this.loadJSON('data/mapSizes.json'),
      this.loadJSON('data/mapTemplates.json'),
      this.loadJSON('data/enemies.json'),
      this.loadJSON('data/consumables.json'),
      this.loadJSON('data/lootTables.json'),
      this.loadJSON('data/recruits.json'),
      this.loadJSON('data/metaUpgrades.json'),
      this.loadJSON('data/accessories.json'),
      this.loadJSON('data/whetstones.json'),
      this.loadJSON('data/turnBonus.json'),
      this.loadOptionalJSON('data/blessings.json'),
    ]);
    this.terrain = terrain;
    this.lords = lords;
    this.classes = classes;
    this.weapons = weapons;
    this.skills = skills;
    this.mapSizes = mapSizes;
    this.mapTemplates = mapTemplates;
    this.enemies = enemies;
    this.consumables = consumables;
    this.lootTables = lootTables;
    this.recruits = recruits;
    this.metaUpgrades = metaUpgrades;
    this.accessories = accessories;
    this.whetstones = whetstones;
    this.turnBonus = turnBonus;
    this.blessings = blessings;
    if (this.blessings) {
      const validation = validateBlessingsConfig(this.blessings);
      if (!validation.valid) {
        throw new Error(`Invalid blessings data: ${validation.errors.join('; ')}`);
      }
    }
    return { terrain, lords, classes, weapons, skills, mapSizes, mapTemplates, enemies, consumables, lootTables, recruits, metaUpgrades, accessories, whetstones, turnBonus, blessings };
  }

  async loadJSON(path) {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`Failed to load ${path}: ${response.status}`);
    return response.json();
  }

  async loadOptionalJSON(path) {
    const response = await fetch(path);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Failed to load ${path}: ${response.status}`);
    return response.json();
  }
}
