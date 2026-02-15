import { describe, it, expect, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
  },
}));

import { HomeBaseScene } from '../src/scenes/HomeBaseScene.js';

describe('HomeBaseScene upgrade description helpers', () => {
  it('describes deadly arsenal split tiers', () => {
    const scene = new HomeBaseScene();
    expect(scene._getActionDesc({ effects: [{ deadlyArsenalTier: 1 }] })).toBe('Edric starting sword upgrades');
    expect(scene._formatEffectValue({ deadlyArsenalTier: 1 })).toBe('Tier 1');
    expect(scene._formatEffectValue({ deadlyArsenalTier: 2 })).toBe('Tier 2');
  });

  it('describes iron/steel/art adept weapon-art spawn upgrades', () => {
    const scene = new HomeBaseScene();

    expect(scene._getActionDesc({ effects: [{ ironArms: 1 }] })).toBe('Iron weapons can spawn with arts');
    expect(scene._getActionDesc({ effects: [{ steelArms: 1 }] })).toBe('Steel weapons can spawn with arts');
    expect(scene._getActionDesc({ effects: [{ artAdept: 1 }] })).toBe('Extra art on a lord starting weapon');
  });

  it('describes upgraded weapon quality economy upgrade', () => {
    const scene = new HomeBaseScene();

    const effect = { lootWeaponQualityBonus: 10 };
    expect(scene._getActionDesc({ effects: [effect] })).toBe('Higher chance for upgraded weapons');
    expect(scene._formatEffectValue(effect)).toBe('+10%');
  });

  it('describes loot category bonus economy upgrades', () => {
    const scene = new HomeBaseScene();
    const effect = {
      lootCategoryWeightBonuses: {
        skillScroll: 2,
        weaponArtScroll: 2,
        gold: -2,
      },
    };

    expect(scene._formatEffectValue(effect)).toBe('+Scroll, +W.Art');
    // _getActionDesc falls through to upgrade.description when lootCategoryWeightBonuses present
    expect(scene._getActionDesc({ effects: [effect], description: 'Increases art scroll quality' }))
      .toBe('Increases art scroll quality');
  });

  it('formats and describes extra starting unit tier upgrade', () => {
    const scene = new HomeBaseScene();

    expect(scene._getActionDesc({ effects: [{ extraStartingUnitTier: 1 }] })).toBe('Extra random starting unit class pool');
    expect(scene._formatEffectValue({ extraStartingUnitTier: 1 })).toBe('Archer');
    expect(scene._formatEffectValue({ extraStartingUnitTier: 4 })).toBe('Archer/Knight/Cavalier/Paladin');
    expect(scene._formatEffectValue({ extraStartingUnitTier: 9 })).toBe('Tier 9');
  });

  it('formats and describes lethal armory upgrades', () => {
    const scene = new HomeBaseScene();

    expect(scene._getActionDesc({ effects: [{ lethalArmoryTier: 1 }] })).toBe('Recruits can gain extra weapons');
    expect(scene._formatEffectValue({ lethalArmoryTier: 2 })).toBe('Tier 2');
    expect(scene._formatEffectValue({ lethalArmoryTier: 3 })).toBe('Tier 3');
  });

  it('formats and describes recruit field supplies upgrade', () => {
    const scene = new HomeBaseScene();

    expect(scene._getActionDesc({ effects: [{ recruitStartingVulnerary: 1 }] })).toBe('Recruits start with Vulnerary');
    expect(scene._formatEffectValue({ recruitStartingVulnerary: 1 })).toBe('+1');
  });
});

describe('HomeBaseScene _getUpgradeTooltipLines', () => {
  it('returns growth tooltip with stat hint and growth explanation', () => {
    const scene = new HomeBaseScene();
    const upgrade = {
      name: 'HP Growth',
      description: 'Increase HP growth',
      effects: [{ recruitGrowth: 'HP', growthValue: 5 }],
    };
    const lines = scene._getUpgradeTooltipLines(upgrade);
    expect(lines[0]).toBe('HP Growth');
    expect(lines).toEqual(expect.arrayContaining([
      expect.stringContaining('Hit Points'),
    ]));
    expect(lines).toEqual(expect.arrayContaining([
      expect.stringContaining('Growth'),
    ]));
  });

  it('returns lord growth tooltip with stat hint and growth explanation', () => {
    const scene = new HomeBaseScene();
    const upgrade = {
      name: 'Lord SPD Growth',
      description: 'Increase lord SPD growth',
      effects: [{ lordGrowth: 'SPD', growthValue: 5 }],
    };
    const lines = scene._getUpgradeTooltipLines(upgrade);
    expect(lines[0]).toBe('Lord SPD Growth');
    expect(lines).toEqual(expect.arrayContaining([
      expect.stringContaining('Speed'),
    ]));
    expect(lines).toEqual(expect.arrayContaining([
      expect.stringContaining('level-up'),
    ]));
  });

  it('returns flat recruit tooltip with stat hint and recruitment text', () => {
    const scene = new HomeBaseScene();
    const upgrade = {
      name: 'STR Bonus',
      description: 'Recruit STR bonus',
      effects: [{ stat: 'STR', value: 1 }],
    };
    const lines = scene._getUpgradeTooltipLines(upgrade);
    expect(lines[0]).toBe('STR Bonus');
    expect(lines).toEqual(expect.arrayContaining([
      expect.stringContaining('Strength'),
    ]));
    expect(lines).toEqual(expect.arrayContaining([
      expect.stringContaining('recruitment'),
    ]));
  });

  it('returns lord flat tooltip with stat hint and run text', () => {
    const scene = new HomeBaseScene();
    const upgrade = {
      name: 'Lord DEF',
      description: 'Lord DEF bonus',
      effects: [{ lordStat: 'DEF', value: 1 }],
    };
    const lines = scene._getUpgradeTooltipLines(upgrade);
    expect(lines[0]).toBe('Lord DEF');
    expect(lines).toEqual(expect.arrayContaining([
      expect.stringContaining('Defense'),
    ]));
    expect(lines).toEqual(expect.arrayContaining([
      expect.stringContaining('run'),
    ]));
  });

  it('returns name + description for named upgrades', () => {
    const scene = new HomeBaseScene();
    const upgrade = {
      name: 'Starting Gold',
      description: 'Begin each run with extra gold.',
      effects: [{ goldBonus: 100 }],
    };
    const lines = scene._getUpgradeTooltipLines(upgrade);
    expect(lines).toEqual(['Starting Gold', 'Begin each run with extra gold.']);
  });

  it('falls back gracefully for empty effects', () => {
    const scene = new HomeBaseScene();
    expect(scene._getUpgradeTooltipLines(null)).toEqual([]);
    expect(scene._getUpgradeTooltipLines({ effects: [] })).toEqual([]);
    expect(scene._getUpgradeTooltipLines({ description: 'Fallback' })).toEqual(['Fallback']);
  });

  it('falls back to description for unrecognized growth stat key', () => {
    const scene = new HomeBaseScene();
    const upgrade = {
      name: 'CHA Growth',
      description: 'Increase CHA growth rate',
      effects: [{ recruitGrowth: 'CHA', growthValue: 5 }],
    };
    const lines = scene._getUpgradeTooltipLines(upgrade);
    expect(lines[0]).toBe('CHA Growth');
    // Should include the description as fallback instead of silently omitting
    expect(lines[1]).toBe('Increase CHA growth rate');
    expect(lines).toEqual(expect.arrayContaining([
      expect.stringContaining('level-up'),
    ]));
  });

  it('falls back to description for unrecognized flat stat key', () => {
    const scene = new HomeBaseScene();
    const upgrade = {
      name: 'CHA Bonus',
      description: 'Recruit CHA bonus',
      effects: [{ stat: 'CHA', value: 1 }],
    };
    const lines = scene._getUpgradeTooltipLines(upgrade);
    expect(lines[0]).toBe('CHA Bonus');
    expect(lines[1]).toBe('Recruit CHA bonus');
    expect(lines).toEqual(expect.arrayContaining([
      expect.stringContaining('recruitment'),
    ]));
  });
});

describe('HomeBaseScene tooltip tab scope', () => {
  it('ignores stale tooltip requests after a tab switch', () => {
    const scene = new HomeBaseScene();
    scene.activeTab = 'recruit_stats';
    const tooltipObject = {
      setDepth() { return this; },
      setY() { return this; },
      destroy: vi.fn(),
      height: 16,
    };
    const addText = vi.fn(() => tooltipObject);

    scene.add = { text: addText };

    scene._showUpgradeTooltip(10, 20, ['Recruit growth'], 'starting_skills');
    expect(addText).not.toHaveBeenCalled();
    expect(scene._upgradeTooltip).toBeUndefined();

    scene.activeTab = 'starting_skills';
    scene._showUpgradeTooltip(10, 20, ['Starting skill'], 'starting_skills');
    expect(addText).toHaveBeenCalledTimes(1);
    expect(scene._upgradeTooltip).toBe(tooltipObject);
  });
});

describe('HomeBaseScene tab switching tooltip cleanup', () => {
  it('hides tooltip before redraw when switching tabs', () => {
    const scene = new HomeBaseScene();
    scene.activeTab = 'recruit_stats';
    scene.tabScrollOffsets = {};

    const hideSpy = vi.spyOn(scene, '_hideUpgradeTooltip').mockImplementation(() => {});
    const drawSpy = vi.spyOn(scene, 'drawUI').mockImplementation(() => {});

    const tabs = [];
    scene.add = {
      text: vi.fn((x, y, label) => {
        const handlers = {};
        const tab = {
          width: String(label).length * 8,
          setInteractive() { return this; },
          setColor() { return this; },
          on(event, handler) {
            handlers[event] = handler;
            return this;
          },
          getBounds() {
            return { x: 0, y: 0, width: this.width, height: 12 };
          },
        };
        tabs.push({ label, handlers });
        return tab;
      }),
      rectangle: vi.fn(() => ({})),
    };

    scene.drawTabs();

    const before = scene.activeTab;
    for (const tab of tabs) {
      if (typeof tab.handlers.pointerdown === 'function') tab.handlers.pointerdown();
      if (scene.activeTab !== before) break;
    }

    expect(scene.activeTab).not.toBe(before);
    expect(hideSpy).toHaveBeenCalledTimes(1);
    expect(drawSpy).toHaveBeenCalledTimes(1);
    expect(hideSpy.mock.invocationCallOrder[0]).toBeLessThan(drawSpy.mock.invocationCallOrder[0]);
  });
});
