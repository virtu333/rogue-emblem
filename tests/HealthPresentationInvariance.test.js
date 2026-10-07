// The same HP change must leave the same game state however it is presented: every
// strike shown with real HP bars, strikes not shown at all (a skipped animation, a
// headless run), or HP bars that never draw. Before UnitHealth, HP accessory debt was
// settled by BattleScene.updateHPBar, and Thorns damage existed only in the strike
// animation, so the answers below depended on rendering.
import { describe, expect, it, vi, afterEach } from 'vitest';
vi.mock('phaser', () => ({ default: { Scene: class {} } }));
vi.mock('../src/utils/SceneRouter.js', async () => {
  const actual = await vi.importActual('../src/utils/SceneRouter.js');
  return { ...actual, transitionToScene: vi.fn(async () => true) };
});
vi.mock('../src/ui/RosterOverlay.js', async () => {
  const actual = await vi.importActual('../src/ui/RosterOverlay.js');
  return actual;
});

import { BattleScene } from '../src/scenes/BattleScene.js';
import { RosterOverlay } from '../src/ui/RosterOverlay.js';
import { equipAccessory, unequipAccessory } from '../src/engine/UnitManager.js';
import { applyCombatHP, applyCombatSideHP } from '../src/engine/UnitHealth.js';
import { resolveCombat } from '../src/engine/Combat.js';
import { TERRAIN } from '../src/utils/constants.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();
const ROBE = () => structuredClone(gameData.accessories.find((a) => a.name === 'Seraph Robe'));
const bar = () => ({ setPosition() {}, setSize() {}, setFillStyle() {} });
const plain = { name: 'Plain', avoidBonus: 0, defBonus: 0 };

afterEach(() => vi.restoreAllMocks());

/** A 20/20 unit with a +5 HP robe taken off at 1 HP (owes 5), then set to `hp`. */
function debtor(hp, extra = {}) {
  const unit = {
    name: 'Mage',
    faction: 'player',
    col: 2,
    row: 2,
    level: 5,
    moveType: 'Infantry',
    className: 'Mage',
    stats: { HP: 20, STR: 10, MAG: 0, SKL: 8, SPD: 9, DEF: 6, RES: 3, LCK: 5, MOV: 5 },
    currentHP: 20,
    skills: [],
    consumables: [],
    proficiencies: [{ type: 'Sword', rank: 'Prof' }],
    hpBar: { bg: bar(), fill: bar() },
    graphic: { clearTint() {}, setTint() {}, setAlpha() {} },
    ...extra,
  };
  equipAccessory(unit, ROBE());
  unit.currentHP = 1;
  unequipAccessory(unit);
  expect(unit._accessoryHpOwed).toBe(5);
  unit.currentHP = hp;
  return unit;
}

function foe(extra = {}) {
  return {
    name: 'Brute',
    faction: 'enemy',
    col: 3,
    row: 2,
    level: 5,
    moveType: 'Infantry',
    className: 'Fighter',
    weapon: { name: 'Iron Axe', type: 'Axe', might: 8, hit: 100, crit: 0, weight: 0, range: '1' },
    inventory: [],
    skills: [],
    proficiencies: [{ type: 'Axe', rank: 'Prof' }],
    stats: { HP: 22, STR: 9, MAG: 0, SKL: 5, SPD: 6, DEF: 4, RES: 1, LCK: 0, MOV: 5 },
    currentHP: 22,
    hpBar: { bg: bar(), fill: bar() },
    graphic: { clearTint() {}, setTint() {}, setAlpha() {} },
    ...extra,
  };
}

const chain = () => {
  const o = {
    setOrigin: () => o,
    setDepth: () => o,
    setStrokeStyle: () => o,
    setAngle: () => o,
    destroy() {},
  };
  return o;
};

/**
 * A battle scene resolving one combat for real. `show` runs the strike's
 * HP-bar presentation; `bars` selects the real bar drawer or an absent renderer.
 */
function battle({ show, bars }) {
  const scene = new BattleScene();
  Object.assign(scene, {
    _battleSession: 1,
    gameData: { ...gameData, weaponArts: { arts: [] } },
    grid: {
      fogEnabled: false,
      getTerrainAt: () => plain,
      gridToPixel: () => ({ x: 64, y: 64 }),
      isVisible: () => true,
      mapLayout: [[TERRAIN.Fort]],
      cols: 10,
      rows: 10,
    },
    playerUnits: [],
    enemyUnits: [],
    npcUnits: [],
    battleParams: {},
    turnManager: { turnNumber: 1 },
    runManager: {
      getActHitBonusForUnit: () => 0,
      getTerrainCombatBonuses: () => [],
      blessingRuntimeModifiers: {},
    },
    registry: { get: () => null },
    add: { text: () => chain(), rectangle: () => chain() },
    tweens: { add() {} },
    isDevToolsEnabled: () => false,
    animateSkillActivation: async () => {},
    animateHeal: async () => {},
    _applyResolvedCombatPostEffects: async () => {},
    _checkPhoenixBrooch: async () => {},
    _getSelectedWeaponArtForUnit: () => null,
  });
  if (!bars) scene.updateHPBar = () => {};
  scene.animateStrike = async (event, attacker, defender) => {
    if (!show || event.miss) return;
    // Rendering runs independently of strike settlement in UnitHealth.
    scene.updateHPBar(attacker);
    scene.updateHPBar(defender);
    // A broken Revival Stone's refill and pips are drawn at the blow, never settled by it.
    if (event.stoneBroken)
      scene._stoneBreakFx().playBreak(event.attackerSide === 'defender' ? attacker : defender);
  };
  return scene;
}

async function fight(world, attacker, defender) {
  const scene = battle(world);
  scene.playerUnits = [attacker];
  scene.enemyUnits = [defender];
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  const ctx = scene._prepareCombatContext(attacker, defender, { isPlayerInitiator: true });
  await scene._runCombatResolution(attacker, defender, ctx);
  vi.restoreAllMocks();
  return { attacker, defender };
}

const WORLDS = [
  { name: 'strike presentation runs, bars drawn', show: true, bars: true },
  { name: 'strike presentation absent', show: false, bars: true },
  { name: 'strike presentation runs, bars absent', show: true, bars: false },
];

describe('a drain that tops the unit up mid-combat settles its debt in every world', () => {
  // Hand-worked (sword beats axe: +1 damage to the sword, -1 to the axe): attacker
  // 16/20 hits for (10 + 5) - 4 + 1 = 12 and drains 12 → 20/20 (debt forgiven); the
  // counter hits for (9 + 8) - 6 - 1 = 10 → 10/20. The robe then goes back on for
  // the full +5: 15/25. Without the settle it would stay 10/25.
  const drainSword = {
    name: 'Drain Sword',
    type: 'Sword',
    might: 5,
    hit: 100,
    crit: 0,
    weight: 0,
    range: '1',
    special: 'Drains HP',
  };
  for (const world of WORLDS) {
    it(world.name, async () => {
      const unit = debtor(16, { weapon: drainSword, inventory: [drainSword] });
      const { defender } = await fight(world, unit, foe());
      expect([unit.currentHP, defender.currentHP]).toEqual([10, 10]);
      expect(unit._accessoryHpOwed).toBeUndefined();
      equipAccessory(unit, ROBE());
      expect([unit.currentHP, unit.stats.HP]).toEqual([15, 25]);
    });
  }
});

describe('Thorns hurts the striker in every world, and it stays hurt', () => {
  // Hand-worked (sword beats axe): the attacker hits the Thorns foe for
  // (10 + 5) - 4 + 1 = 12; Thorns reflects floor(12 * 0.25) = 3 → 17/20; the counter
  // hits for (9 + 8) - 6 - 1 = 10 → 7/20. Before, the 3 came back after the strike.
  const sword = {
    name: 'Iron Sword',
    type: 'Sword',
    might: 5,
    hit: 100,
    crit: 0,
    weight: 0,
    range: '1',
  };
  const thornsPct = gameData.affixes.affixes.find((a) => a.id === 'thorns').effects.reflectMeleePct;
  expect(Math.floor(12 * thornsPct)).toBe(3);
  for (const world of WORLDS) {
    it(world.name, async () => {
      const attacker = { ...debtor(20), weapon: sword, inventory: [sword] };
      delete attacker._accessoryHpOwed;
      const { defender } = await fight(world, attacker, foe({ affixes: ['thorns'] }));
      expect(defender.currentHP).toBe(10);
      expect(attacker.currentHP).toBe(7);
    });
  }
});

describe('Shielded counts only the player’s own hits', () => {
  it('a counter that lands on the player does not spend the guard', async () => {
    const sword = {
      name: 'Iron Sword',
      type: 'Sword',
      might: 5,
      hit: 0,
      crit: 0,
      weight: 0,
      range: '1',
    };
    const attacker = { ...debtor(20), weapon: sword, inventory: [sword] };
    const shielded = foe({ affixes: ['shielded'], _hitByPlayerThisPhase: false });
    await fight({ show: false, bars: true }, attacker, shielded); // the player misses (hit 0)
    expect(attacker.currentHP).toBeLessThan(20); // the counter landed
    expect(shielded._hitByPlayerThisPhase).toBe(false);
  });

  it('a player hit spends it even when the strike is not shown', async () => {
    const sword = {
      name: 'Iron Sword',
      type: 'Sword',
      might: 5,
      hit: 100,
      crit: 0,
      weight: 0,
      range: '1',
    };
    const attacker = { ...debtor(20), weapon: sword, inventory: [sword] };
    const shielded = foe({ affixes: ['shielded'], _hitByPlayerThisPhase: false });
    await fight({ show: false, bars: true }, attacker, shielded);
    expect(shielded._hitByPlayerThisPhase).toBe(true);
  });
});

describe('turn-start healing to full settles the debt with or without a drawn bar', () => {
  for (const bars of [true, false]) {
    it(bars ? 'bars drawn' : 'bars never drawn', async () => {
      const scene = battle({ show: false, bars });
      const unit = debtor(19, { col: 0, row: 0 });
      await scene.processTerrainHealing([unit]); // the Fort heals it to 20/20
      expect(unit.currentHP).toBe(20);
      expect(unit._accessoryHpOwed).toBeUndefined();
    });
  }
});

describe('the arena applies a bout like a battle does', () => {
  it('a drain to full mid-bout settles the debt (the arena keeps only its fighter)', () => {
    const drainSword = {
      name: 'Drain Sword',
      type: 'Sword',
      might: 5,
      hit: 100,
      crit: 0,
      weight: 0,
      range: '1',
      special: 'Drains HP',
    };
    const arena = debtor(16, { weapon: drainSword, inventory: [drainSword] });
    const inBattle = debtor(16, { weapon: drainSword, inventory: [drainSword] });
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const result = resolveCombat(arena, drainSword, foe(), foe().weapon, 1, plain, plain, null);
    vi.restoreAllMocks();
    applyCombatSideHP(arena, 'attacker', result, { floor: 1 });
    applyCombatHP(inBattle, foe(), result);
    expect([arena.currentHP, arena._accessoryHpOwed]).toEqual([10, undefined]);
    expect([inBattle.currentHP, inBattle._accessoryHpOwed]).toEqual([10, undefined]);
  });
});

describe('the roster’s item heal settles the debt on a heal to full', () => {
  it('a Vulnerary that fills the unit forgives it; one that falls short keeps it', () => {
    const overlay = Object.create(RosterOverlay.prototype);
    Object.assign(overlay, {
      scene: { registry: { get: () => null } },
      _showBanner() {},
      refresh() {},
    });
    const full = debtor(15);
    overlay._useHealItem(full, { name: 'Vulnerary', effect: 'heal', value: 10, uses: 3 });
    expect([full.currentHP, full._accessoryHpOwed]).toEqual([20, undefined]);
    const short = debtor(5);
    overlay._useHealItem(short, { name: 'Vulnerary', effect: 'heal', value: 10, uses: 3 });
    expect([short.currentHP, short._accessoryHpOwed]).toEqual([15, 5]);
  });
});

describe('a forecast preview changes nothing it does not restore', () => {
  it('a Phoenix Brooch that fills the unit in the preview leaves its debt standing', () => {
    // A 12-max unit at 8 owes 5. The previewed art costs it down to 3 (the brooch's
    // 25% line: floor(12 * 0.25) = 3), so the brooch heals 10 → 12/12 inside the
    // preview only. Afterwards the unit must be exactly as before: 8/12, owing 5.
    const scene = battle({ show: false, bars: false });
    scene._getWeaponArtHpAfterCost = () => 3;
    scene._applyRecoilGuardAfterArtUse = () => {};
    const unit = {
      name: 'Knight',
      faction: 'player',
      stats: { HP: 12 },
      currentHP: 8,
      _accessoryHpOwed: 5,
      accessory: structuredClone(gameData.accessories.find((a) => a.name === 'Phoenix Brooch')),
    };
    const seen = scene._withForecastArtState(unit, { name: 'Test Art' }, () => unit.currentHP);
    expect(seen).toBe(12);
    expect([unit.currentHP, unit._accessoryHpOwed, unit._phoenixBroochUsed]).toEqual([
      8,
      5,
      undefined,
    ]);
  });
});

describe('a stoned boss breaks a bar the same way in every world', () => {
  // Hand-worked (sword beats axe): the attacker hits for (10 + 5) - 4 + 1 = 12, which would
  // fell the 10-HP boss. Its one Revival Stone breaks instead: back to 22/22 and the
  // exchange ends, so there is no counter (the attacker stays 20/20). The stone is spent
  // by the exchange itself, not by drawing it or the bar.
  const sword = {
    name: 'Iron Sword',
    type: 'Sword',
    might: 5,
    hit: 100,
    crit: 0,
    weight: 0,
    range: '1',
  };
  const stoned = (stones) =>
    foe({
      isBoss: true,
      currentHP: 10,
      ...(stones > 0 ? { revivalStones: stones, revivalStonesMax: stones } : {}),
    });
  const hero = () => {
    const attacker = { ...debtor(20), weapon: sword, inventory: [sword] };
    delete attacker._accessoryHpOwed;
    return attacker;
  };
  for (const world of WORLDS) {
    it(world.name, async () => {
      const attacker = hero();
      const { defender } = await fight(world, attacker, stoned(1));
      expect([defender.currentHP, defender.revivalStones, attacker.currentHP]).toEqual([22, 0, 20]);
    });

    it(`${world.name}: with no stone the same blow falls it`, async () => {
      const attacker = hero();
      const { defender } = await fight(world, attacker, stoned(0));
      expect([defender.currentHP, attacker.currentHP]).toEqual([0, 20]);
    });
  }
});
