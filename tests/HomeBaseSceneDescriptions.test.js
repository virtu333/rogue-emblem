import { describe, it, expect, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
  },
}));

import { HomeBaseScene } from '../src/scenes/HomeBaseScene.js';

describe('HomeBaseScene upgrade description helpers', () => {
  it('surfaces weapon art unlock side effects on deadly arsenal upgrade text', () => {
    const scene = new HomeBaseScene();
    const upgrade = {
      description: 'deadly arsenal',
      effects: [{
        deadlyArsenal: 1,
        unlockWeaponArts: ['legend_gemini_tempest', 'legend_starfall_volley'],
      }],
    };

    const desc = scene._getActionDesc(upgrade);
    expect(desc).toContain('Random Silver/Killer/Brave/Legend weapon');
    expect(desc).toContain('unlocks 2 weapon arts');
  });

  it('describes standalone weapon art unlock effects', () => {
    const scene = new HomeBaseScene();
    const upgrade = {
      description: 'fallback text',
      effects: [{
        unlockWeaponArt: 'legend_gemini_tempest',
      }],
    };

    expect(scene._getActionDesc(upgrade)).toBe('Unlocks 1 weapon art');
  });
});
