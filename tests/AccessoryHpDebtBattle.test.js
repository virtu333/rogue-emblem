// An HP accessory taken off at critical HP leaves a debt (UnitManager); a genuine
// full heal in battle must clear it before later damage makes it stale.
import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ default: { Scene: class {} } }));

import { BattleScene } from '../src/scenes/BattleScene.js';
import { HealController } from '../src/ui/HealController.js';
import { equipAccessory, unequipAccessory } from '../src/engine/UnitManager.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();
const ROBE = () => structuredClone(gameData.accessories.find((a) => a.name === 'Seraph Robe'));
const bar = () => ({ setPosition: vi.fn(), setSize: vi.fn(), setFillStyle: vi.fn() });

function battle() {
  const scene = Object.create(BattleScene.prototype);
  Object.assign(scene, {
    gameData,
    battleState: 'UNIT_ACTION_MENU',
    grid: { gridToPixel: () => ({ x: 0, y: 0 }), clearAttackHighlights: vi.fn() },
    turnManager: { turnNumber: 1, currentPhase: 'player' },
    registry: { get: () => null },
    animateHeal: vi.fn(async () => {}),
    awardScaledXP: vi.fn(async () => {}),
    finishUnitAction: vi.fn(),
  });
  const unit = (name, extra) => ({
    name,
    faction: 'player',
    col: 0,
    row: 0,
    stats: { HP: 20, MAG: 5, SKL: 5 },
    currentHP: 20,
    skills: [],
    hpBar: { bg: bar(), fill: bar() },
    ...extra,
  });
  const staff = { ...gameData.weapons.find((w) => w.name === 'Mend'), _usesSpent: 0 };
  const healer = unit('Sera', {
    weapon: staff,
    inventory: [staff],
    stats: { HP: 18, MAG: 12, SKL: 5 },
  });
  const wearer = unit('Edric');
  return { scene, healer, wearer };
}

describe('HP accessory debt and a full heal in battle', () => {
  it('review case: 1/25, robe off, healed to full, 8 damage, robe on → 17/25', async () => {
    const { scene, healer, wearer } = battle();
    const robe = ROBE();
    equipAccessory(wearer, robe); // 25/25
    wearer.currentHP = 1;
    unequipAccessory(wearer); // 1/20, owes 5
    expect(wearer._accessoryHpOwed).toBe(5);
    await new HealController(scene).executeHeal(healer, wearer);
    expect(wearer.currentHP).toBe(20);
    expect(wearer._accessoryHpOwed).toBeUndefined();
    wearer.currentHP -= 8; // 12/20
    equipAccessory(wearer, robe);
    expect([wearer.currentHP, wearer.stats.HP]).toEqual([17, 25]);
  });

  it('a heal that stops short of full keeps the debt (no free HP)', async () => {
    const { scene, healer, wearer } = battle();
    const robe = ROBE();
    equipAccessory(wearer, robe);
    wearer.currentHP = 1;
    unequipAccessory(wearer); // 1/20, owes 5
    healer.stats.MAG = 0; // a small heal
    await new HealController(scene).executeHeal(healer, wearer);
    expect(wearer.currentHP).toBeLessThan(20);
    const healed = wearer.currentHP;
    equipAccessory(wearer, robe);
    // Same as healing with the robe on from 1/25: the heal amount, no more.
    expect(wearer.currentHP).toBe(healed);
  });
});
