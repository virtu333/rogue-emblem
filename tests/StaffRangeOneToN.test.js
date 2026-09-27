// Staves reach from 1 to N, as in Fire Emblem: Physic and Fortify list "range": "1-2"
// (they used to say "2", parsed as exactly 2 tiles, so an adjacent ally could not be
// healed and Fortify skipped the allies beside the healer). MAG range bonuses still
// extend the far end only.
//
// Expected values are derived by hand: heal = min(MAG + healBase, max HP - current HP);
// Physic reach = 1 to 2 (+1 at MAG 10, +1 more at MAG 18).
import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));

import { BattleScene } from '../src/scenes/BattleScene.js';
import { battleItemBrief, battleItemSummary } from '../src/ui/battleItemSummary.js';
import { HeadlessBattle } from './harness/HeadlessBattle.js';
import { AIController } from '../src/engine/AIController.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const weapon = (name) => structuredClone(data.weapons.find((w) => w.name === name));

function healer(staffName, { MAG = 8, col = 4, row = 4 } = {}) {
  const staff = weapon(staffName);
  return {
    name: 'Sera',
    className: 'Cleric',
    faction: 'player',
    level: 1,
    xp: 0,
    col,
    row,
    currentHP: 18,
    stats: { HP: 18, STR: 0, MAG, SKL: 5, SPD: 5, LCK: 5, DEF: 2, RES: 5, MOV: 5 },
    weapon: staff,
    inventory: [staff],
    consumables: [],
    skills: [],
    proficiencies: [{ type: 'Staff', rank: 'Mast' }],
  };
}

const ally = (name, col, row, currentHP, HP = 30) => ({
  name,
  faction: 'player',
  col,
  row,
  currentHP,
  stats: { HP },
  inventory: [],
  skills: [],
});

function text() {
  return {
    setOrigin() {
      return this;
    },
    setDepth() {
      return this;
    },
    destroy() {},
  };
}

/** A BattleScene with its real heal flow and XP award; only rendering is stubbed. */
function scene(playerUnits) {
  const s = new BattleScene();
  Object.assign(s, {
    playerUnits,
    npcUnits: [],
    enemyUnits: [],
    battleState: 'PLAYER_IDLE',
    battleParams: {},
    gameData: data,
    turnPar: null,
    turnBonusConfig: null,
    turnManager: { turnNumber: 1, currentPhase: 'player' },
    runManager: {
      getDifficultyModifier: (_key, fallback) => fallback,
      getXpMultiplierDelta: () => 0,
    },
    registry: { get: () => null },
    grid: {
      fogEnabled: false,
      isVisible: () => true,
      clearAttackHighlights: vi.fn(),
      showHealRange: vi.fn(),
      gridToPixel: () => ({ x: 0, y: 0 }),
    },
    add: { text: () => text() },
    tweens: { add: ({ onComplete }) => onComplete?.() },
    updateHPBar: vi.fn(),
    animateHeal: vi.fn(async () => {}),
    _reduceMotion: () => true,
    _awaitSceneDelay: async () => {},
    _recoverUnitActionError: vi.fn((_unit, label, err) => {
      throw new Error(`${label} failed: ${err?.message}`);
    }),
    finishUnitAction: vi.fn(),
  });
  return s;
}

describe('Physic reaches 1 to 2', () => {
  it('offers an adjacent ally and one 2 tiles away, not one at 3', () => {
    const sera = healer('Physic'); // MAG 8: reach 1-2
    const next = ally('Edric', 4, 5, 10); // distance 1
    const two = ally('Rowan', 6, 4, 10); // distance 2
    const three = ally('Kira', 4, 1, 10); // distance 3
    const s = scene([sera, next, two, three]);
    expect(s.findHealTargets(sera)).toEqual([next, two]);
  });

  it('heals the adjacent ally: MAG 8 + 5 = 13', async () => {
    const sera = healer('Physic');
    const next = ally('Edric', 5, 4, 10);
    const s = scene([sera, next]);
    s.startHealTargetSelection(sera, s.findHealTargets(sera), sera.weapon);
    expect(s.battleState).toBe('SELECTING_HEAL_TARGET');
    expect(s.healTargets).toEqual([next]);
    await s.executeHeal(sera, next);
    expect(next.currentHP).toBe(23);
    expect(sera.inventory[0]._usesSpent).toBe(1);
  });

  it('MAG bonuses still extend only the far end: 3 at MAG 10, 4 at MAG 18', () => {
    const at = (MAG) => {
      const sera = healer('Physic', { MAG });
      const units = [1, 2, 3, 4, 5].map((d) => ally(`D${d}`, 4 + d, 4, 10));
      return scene([sera, ...units])
        .findHealTargets(sera)
        .map((u) => u.name);
    };
    expect(at(9)).toEqual(['D1', 'D2']);
    expect(at(10)).toEqual(['D1', 'D2', 'D3']);
    expect(at(18)).toEqual(['D1', 'D2', 'D3', 'D4']);
  });
});

describe('Fortify reaches 1 to 2', () => {
  it('heals the allies beside the healer too, for one use', async () => {
    const sera = healer('Fortify', { MAG: 10 }); // 10 + 5 = 15 per ally
    const beside = ally('Edric', 4, 3, 4); // distance 1
    const two = ally('Rowan', 4, 6, 20); // distance 2
    const three = ally('Kira', 7, 4, 5); // distance 3: out of reach
    const s = scene([sera, beside, two, three]);
    const staff = sera.weapon;
    s.startHealTargetSelection(sera, s.findHealTargets(sera), staff);
    await vi.waitFor(() => expect(s.finishUnitAction).toHaveBeenCalledWith(sera));
    expect(beside.currentHP).toBe(19); // 4 + 15
    expect(two.currentHP).toBe(30); // 20 + 10 (capped at 30)
    expect(three.currentHP).toBe(5);
    expect(staff._usesSpent).toBe(1);
  });
});

describe('the item card and brief', () => {
  it('say "Rng 1-2" / "Range 1-2", and the MAG-extended reach for the holder', () => {
    const physic = weapon('Physic');
    const sera = { stats: { MAG: 8 } };
    // Physic: 1 use, +1 at MAG 8 → 2/2.
    expect(battleItemBrief(physic, sera)).toBe('Rng 1-2 · 2/2 uses');
    expect(battleItemSummary(physic, sera)).toContain('Range 1-2');
    expect(battleItemSummary(physic, { stats: { MAG: 18 } })).toContain('Range 1-4');
    expect(battleItemSummary(weapon('Fortify'), sera)).toContain('Range 1-2');
  });
});

describe('the other staff users agree', () => {
  it('the headless harness offers an adjacent ally to Physic', () => {
    const roster = [{ ...healer('Physic'), isCommander: true, moveType: 'Infantry' }];
    const b = new HeadlessBattle(data, { act: 'act1', objective: 'rout' }, roster);
    b.init();
    const sera = b.playerUnits[0];
    const next = ally('Edric', sera.col, sera.row + 1, 10);
    next.faction = 'player';
    b.playerUnits.push(next);
    expect(b._findHealTargets(sera)).toContain(next);
  });

  it('an enemy healer with Physic mends an adjacent ally', () => {
    const staff = weapon('Physic');
    const cleric = {
      name: 'Cleric',
      faction: 'enemy',
      col: 1,
      row: 1,
      currentHP: 20,
      stats: { HP: 20, MAG: 5 },
      weapon: staff,
      inventory: [staff],
      proficiencies: [{ type: 'Staff', rank: 'Prof' }],
    };
    const brute = { name: 'Brute', faction: 'enemy', col: 2, row: 1, currentHP: 4 };
    brute.stats = { HP: 30 };
    const ai = new AIController({ getMovementRange: () => new Map() }, data);
    const result = ai.applyHealDecision(cleric, brute, staff);
    expect(result.healAmount).toBe(10); // MAG 5 + 5
    expect(brute.currentHP).toBe(14);
  });
});
