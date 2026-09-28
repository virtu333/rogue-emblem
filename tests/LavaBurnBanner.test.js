// Playtest (Sep 2026, portrait): "I don't think I saw lava cracks' start-of-turn effect?"
// Lava burns at the end of the standing side's phase, and its only sign was a 12px
// float that faded in under half a second. Burns seen by the army are now named in one
// banner after the pass; a unit at 1 HP (no damage) or out of sight is not.
import { describe, it, expect, vi } from 'vitest';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));

import { BattleScene } from '../src/scenes/BattleScene.js';
import { lavaBurnBanner } from '../src/engine/TerrainHazards.js';
import { TERRAIN } from '../src/utils/constants.js';
import { loadGameData } from './testData.js';

const terrain = loadGameData().terrain;

function scene(layout, hidden = new Set()) {
  const s = Object.create(BattleScene.prototype);
  s.grid = { mapLayout: layout };
  s._showsTurnEffectOn = (unit) => !hidden.has(unit.name);
  s.showTerrainDamage = vi.fn(async () => {});
  s.showBriefBanner = vi.fn(async () => {});
  s.updateHPBar = vi.fn();
  s._checkPhoenixBrooch = vi.fn(async () => {});
  return s;
}
const unit = (name, col, hp = 20) => ({
  name,
  col,
  row: 0,
  currentHP: hp,
  stats: { HP: 20 },
  moveType: 'Infantry',
});

describe('lava burns', () => {
  it('the lava tile says when it burns', () => {
    const lava = terrain.find((t) => t.name === 'Lava Crack');
    expect(lava.special).toMatch(/end of its side's phase/);
  });

  it('names every burn the army saw in one banner, after the pass', async () => {
    const L = TERRAIN.LavaCrack;
    const s = scene([[L, L, L, L, 0]], new Set(['Hidden']));
    const units = [
      unit('Edric', 0),
      unit('Sera', 1, 3),
      unit('Hidden', 2),
      unit('Spent', 3, 1),
      unit('Dry', 4),
    ];
    await s.processTerrainDamage(units);
    expect(units.map((u) => u.currentHP)).toEqual([15, 1, 15, 1, 20]);
    expect(s.showBriefBanner).toHaveBeenCalledTimes(1);
    expect(s.showBriefBanner.mock.calls[0][0]).toBe(lavaBurnBanner(['Edric -5', 'Sera -2']));
    expect(s.showBriefBanner.mock.calls[0][0]).toBe('Lava burns Edric -5, Sera -2');
  });

  it('no banner when nothing burned', async () => {
    const s = scene([[0, 0]]);
    await s.processTerrainDamage([unit('Edric', 0)]);
    expect(s.showBriefBanner).not.toHaveBeenCalled();
  });
});
