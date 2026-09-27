import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname, relative } from 'path';
import { fileURLToPath } from 'url';

vi.mock('phaser', () => ({ default: { Scene: class {}, Math: {} } }));

import { HomeBaseScene } from '../src/scenes/HomeBaseScene.js';
import { canDouble } from '../src/engine/Combat.js';
import { loadGameData } from './testData.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function filesUnder(dir, exts) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === 'archive') continue; // retired balance proposals, never shown
      out.push(...filesUnder(path, exts));
    } else if (exts.some((ext) => name.endsWith(ext))) out.push(path);
  }
  return out;
}

const unit = (SPD, STR = 0) => ({ stats: { SPD, STR, SKL: 0, LCK: 0 } });

describe('doubling copy follows the attack-speed rule', () => {
  it('a raw 5-SPD lead does not double when the weapon is heavy (the rule the copy must teach)', () => {
    // SPD 10 vs 5 is a raw lead of 5, but 3 effective weight (STR 0) leaves
    // Attack Speed 7 against 5: no follow-up. A light weapon keeps the lead.
    const heavy = { type: 'Axe', might: 8, hit: 70, crit: 0, weight: 3 };
    const light = { type: 'Sword', might: 5, hit: 90, crit: 0, weight: 0 };
    expect(canDouble(unit(10), unit(5), heavy, light)).toBe(false);
    expect(canDouble(unit(10), unit(5), light, light)).toBe(true);
  });

  it('Speed upgrade help (Quick Feet, Lord Swiftness) explains attack speed and weight', () => {
    const scene = new HomeBaseScene();
    const upgrades = loadGameData().metaUpgrades.filter(
      (u) => u.effects[0]?.recruitGrowth === 'SPD' || u.effects[0]?.lordGrowth === 'SPD',
    );
    expect(upgrades.map((u) => u.name).sort()).toEqual(['Lord Swiftness', 'Quick Feet']);
    for (const upgrade of upgrades) {
      const help = scene._getUpgradeTooltipLines(upgrade).join(' ');
      expect(help).not.toMatch(/SPD\s*(>=|≥)/);
      expect(help).toMatch(/Atk Spd/);
      expect(help).toMatch(/by 5\b/);
      expect(help).toMatch(/heavy weapons/i);
    }
  });

  it('no player-facing copy states the doubling rule on raw SPD', () => {
    const sources = [
      ...filesUnder(join(root, 'src'), ['.js']),
      ...filesUnder(join(root, 'data'), ['.json']),
    ];
    const rawSpdRule = /\bSPD\s*(>=|≥)\s*(the\s+)?(foe|enemy|defender|target)/i;
    const offenders = sources
      .filter((path) => rawSpdRule.test(readFileSync(path, 'utf-8')))
      .map((path) => relative(root, path));
    expect(offenders).toEqual([]);
  });
});
