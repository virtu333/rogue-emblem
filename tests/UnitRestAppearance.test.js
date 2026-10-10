// Playtest: "Sometimes units are not grayed out after moves — maybe some heals do this?"
// A flash (a heal's green, a cure, a lava or acid burn) tinted a unit's sprite and then
// ended by clearing the tint, or by restoring a tint remembered when it began. A staff
// heal on an ally that had already acted therefore left that spent ally looking ready.
// The rule now: a flash ends on the look the unit's state asks for at that moment
// (ui/UnitRestAppearance.js), whatever happened while it played.
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import './harness/JourneyTestSetup.js';
vi.mock('../src/utils/errorReporter.js', () => ({ reportAsyncError: vi.fn() }));
import { reportAsyncError } from '../src/utils/errorReporter.js';
import { journeyBattleScene } from './harness/JourneyBattleScene.js';
import { presentationFailureProxy } from './harness/PresentationFailureProxy.js';
import { JourneyStorage, RunDriver } from './harness/RunDriver.js';
import { createBattleRng } from '../src/engine/BattleRng.js';
import { BattleScene, resetPlayerUnitsForTurn } from '../src/scenes/BattleScene.js';
import { TurnManager } from '../src/engine/TurnManager.js';
import { refreshActedAlly } from '../src/engine/ActionAbilitySystem.js';
import { completeBattleAction } from '../src/ui/BattleActionCompletion.js';
import { presentRefreshSparkle } from '../src/ui/MovementActionController.js';
import { completeResolvedAction } from '../src/ui/BattlePresentationCheckpoint.js';
import { battlefieldContrastEnabled } from '../src/ui/battlefieldArtFlags.js';
import { UI_HEX } from '../src/utils/uiStyles.js';
import { loadGameData } from './testData.js';
import { _resetUidCounter } from '../src/utils/itemUid.js';

const data = loadGameData();
const originalRandom = Math.random;
afterEach(() => {
  Math.random = originalRandom;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// The acted grey, written out here rather than read from the module under test.
const ACTED = () => (battlefieldContrastEnabled() ? 0xb8b8b8 : UI_HEX.lineStrong);

/** A sprite with Phaser's tint semantics (clearTint is setTint(0xffffff)). */
function sprite() {
  return {
    tint: 0xffffff,
    tintFill: false,
    alpha: 1,
    active: true,
    get isTinted() {
      return this.tintFill || this.tint !== 0xffffff;
    },
    get tintTopLeft() {
      return this.tint;
    },
    setTint(c = 0xffffff) {
      this.tint = c;
      this.tintFill = false;
      return this;
    },
    setTintFill(c = 0xffffff) {
      this.tint = c;
      this.tintFill = true;
      return this;
    },
    clearTint() {
      return this.setTint(0xffffff);
    },
    setAlpha(a) {
      this.alpha = a;
      return this;
    },
  };
}
const look = (u) => ({ tint: u.graphic.tint, fill: u.graphic.tintFill, label: u.label.alpha });
const SPENT = () => ({ tint: ACTED(), fill: false, label: 0.5 });
const READY = { tint: 0xffffff, fill: false, label: 1 };

function unit(name, col, row, hp = 20) {
  return {
    name,
    faction: 'player',
    className: 'Cleric',
    tier: 'base',
    level: 5,
    xp: 0,
    col,
    row,
    moveType: 'Infantry',
    hasActed: false,
    hasMoved: false,
    skills: [],
    traits: [],
    growths: Object.fromEntries(
      ['HP', 'STR', 'MAG', 'SKL', 'SPD', 'DEF', 'RES', 'LCK'].map((k) => [k, 50]),
    ),
    stats: { HP: 20, STR: 5, MAG: 6, SKL: 5, SPD: 5, DEF: 5, RES: 5, LCK: 5, MOV: 4 },
    currentHP: hp,
    proficiencies: [
      { type: 'Staff', rank: 'Mast' },
      { type: 'Tome', rank: 'Mast' },
    ],
    inventory: [],
    consumables: [],
  };
}

/**
 * A real BattleScene over a real run (ActionBoundaryPresentation's fixture), rendering
 * stubbed except for what this bug is about: each unit's sprite tint and label alpha,
 * and the scene's real dimUnit / undimUnit. `onDelay(label)` runs inside each awaited
 * presentation delay (a flash's "tint clear" wait), i.e. while a flash is still playing.
 */
function fixture({ staff: staffKind = 'heal' } = {}) {
  _resetUidCounter();
  Math.random = createBattleRng(42);
  vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  reportAsyncError.mockClear();
  const storage = new JourneyStorage();
  vi.stubGlobal('localStorage', storage);
  const driver = new RunDriver(storage);
  driver.run.runRecordId = 'rest-appearance-run';
  driver.run.beginBattleInProgress(driver.run.nodeMap.nodes[0].id, { battleParams: {} });
  const scene = journeyBattleScene(driver.run, data);
  Object.assign(scene, {
    _battleSession: 1,
    _sceneShutdownCleanedUp: false,
    _battleRewindPolicy: 'fixed-v1',
    _battleRng: createBattleRng(7),
    scene: { isActive: () => true },
    sys: { isActive: () => true },
    cameras: { main: { width: 640, height: 480, centerX: 320, centerY: 240 } },
    _pinToScreen: () => {},
    showActionMenu: vi.fn(),
    goldEarned: 0,
  });
  Math.random = scene._battleRng;
  Object.assign(scene.grid, {
    cols: 8,
    rows: 8,
    mapLayout: Array.from({ length: 8 }, () => Array(8).fill(0)),
    fogEnabled: false,
    getMoveCost: () => 1,
    getTerrainAt: () => data.terrain[0],
    gridToPixel: (col, row) => ({ x: col * 32, y: row * 32 }),
  });
  const actor = unit('Sera', 2, 2);
  const target = unit('Target', 2, 3, 5);
  const other = unit('Other', 5, 5);
  scene.playerUnits = [actor, target, other];
  scene.enemyUnits = [Object.assign(unit('Enemy', 7, 7), { faction: 'enemy' })];
  presentationFailureProxy(scene, 0, { fastTweens: true });
  // The look under test is real: the scene's own dim/undim on Phaser-like sprites.
  scene.dimUnit = BattleScene.prototype.dimUnit;
  scene.undimUnit = BattleScene.prototype.undimUnit;
  scene.onDelay = null;
  scene._awaitSceneDelay = async (_ms, { label } = {}) => {
    await scene.onDelay?.(label);
    return { status: 'finished' };
  };
  for (const entry of [...scene.playerUnits, ...scene.enemyUnits]) {
    scene.addUnitGraphic(entry);
    entry.graphic = sprite();
    entry.label = sprite();
  }
  scene.turnManager = new TurnManager({ onPhaseChange: () => {}, checkBattleEnd: () => false });
  scene.turnManager.init(scene.playerUnits, scene.enemyUnits, []);
  const tome = structuredClone(data.weapons.find((w) => w.type === 'Tome'));
  const staff = {
    rankRequired: 'Prof',
    name: 'Heal Staff',
    type: 'Staff',
    range: '1',
    healBase: 5,
    uses: 3,
    ...(staffKind === 'cure' ? { cureConditions: true } : {}),
  };
  actor.inventory = [tome, staff];
  actor.weapon = tome;
  const controller =
    scene._healController || (scene.findHealTargets(actor, staff), scene._healController);
  controller.holdStaff(actor, staff);
  return { scene, actor, target, other };
}

/** A unit spends its action the way Wait does (the real action completion). */
function spend(scene, u) {
  expect(completeBattleAction(scene, u, { session: scene._battleSession })).toBe(true);
  expect(look(u)).toEqual(SPENT());
}

describe('a staff on an ally that has already acted (the reported case)', () => {
  it('Heal: the spent ally is still dimmed once the green flash ends', async () => {
    const { scene, actor, target } = fixture();
    spend(scene, target);
    let flashed = null;
    scene.onDelay = (label) => {
      if (label === 'animate_heal_tint_clear') flashed = target.graphic.tint;
    };
    await scene.executeHeal(actor, target);
    expect(target.currentHP).toBeGreaterThan(5);
    expect(flashed).toBe(UI_HEX.hpHigh); // the flash did play on the spent ally
    expect(look(target)).toEqual(SPENT());
    // The healer's own action ended after the flash: it is spent too.
    expect(actor.hasActed).toBe(true);
    expect(look(actor)).toEqual(SPENT());
    expect(reportAsyncError).not.toHaveBeenCalled();
  });

  it('Cure: the spent ally is still dimmed once the cure flash ends', async () => {
    const { scene, actor, target } = fixture({ staff: 'cure' });
    spend(scene, target);
    target._conditions = [{ id: 'poison', turnsRemaining: 3 }];
    let flashed = null;
    scene.onDelay = (label) => {
      if (label === 'animate_cure_tint_clear') flashed = target.graphic.tint;
    };
    await scene.executeHeal(actor, target);
    expect(target._conditions).toEqual([]);
    expect(flashed).toBe(0x88ffcc);
    expect(look(target)).toEqual(SPENT());
    expect(look(actor)).toEqual(SPENT());
  });

  it('Cure of Sleep on an ally that has not acted lifts the sleep dim', async () => {
    const { scene, actor, target } = fixture({ staff: 'cure' });
    target._conditions = [{ id: 'sleep', turnsRemaining: 2 }];
    scene.dimUnit(target); // asleep: dimmed at turn start
    await scene.executeHeal(actor, target);
    expect(target._conditions).toEqual([]);
    expect(look(target)).toEqual(READY);
  });

  it('a heal on an ally that can still act leaves it ready', async () => {
    const { scene, actor, target } = fixture();
    await scene.executeHeal(actor, target);
    expect(look(target)).toEqual(READY);
    expect(look(actor)).toEqual(SPENT());
  });
});

describe('turn-start flashes end on the state at their end', () => {
  it('Fort healing on a sleeping unit (dimmed at turn start) keeps it dimmed', async () => {
    const { scene, target } = fixture();
    target._conditions = [{ id: 'sleep', turnsRemaining: 2 }];
    scene.dimUnit(target);
    await scene.animateHeal(target, 3);
    expect(look(target)).toEqual(SPENT());
  });

  for (const [name, method] of [
    ['lava', 'showTerrainDamage'],
    ['acid', 'showAcidDamage'],
  ]) {
    it(`${name}: a spent unit burned at the enemy phase's start stays dimmed`, async () => {
      const { scene, target } = fixture();
      spend(scene, target);
      await BattleScene.prototype[method].call(scene, target, 2);
      expect(look(target)).toEqual(SPENT());
    });

    it(`${name}: a unit that is spent while the flash plays ends dimmed`, async () => {
      const { scene, target } = fixture();
      expect(look(target)).toEqual(READY);
      scene.onDelay = (label) => {
        if (label.endsWith('_tint_clear')) spend(scene, target);
      };
      await BattleScene.prototype[method].call(scene, target, 2);
      expect(look(target)).toEqual(SPENT());
    });

    it(`${name}: a unit refreshed by a Dance while the flash plays ends ready`, async () => {
      const { scene, target } = fixture();
      spend(scene, target);
      scene.onDelay = (label) => {
        if (!label.endsWith('_tint_clear')) return;
        refreshActedAlly(target);
        presentRefreshSparkle(scene, target);
      };
      await BattleScene.prototype[method].call(scene, target, 2);
      expect(target.hasActed).toBe(false);
      expect(look(target)).toEqual(READY);
    });
  }

  it('a heal flash that ends after a Dance refresh leaves the ally ready', async () => {
    const { scene, target } = fixture();
    spend(scene, target);
    scene.onDelay = (label) => {
      if (label !== 'animate_heal_tint_clear') return;
      refreshActedAlly(target);
      presentRefreshSparkle(scene, target);
    };
    await scene.animateHeal(target, 3);
    expect(look(target)).toEqual(READY);
  });
});

describe('refreshes and new phases restore the whole look', () => {
  it("Commander's Gambit lifts the label's dim as well as the sprite's", () => {
    const { scene, actor, target } = fixture();
    spend(scene, target);
    completeResolvedAction(
      scene,
      { kind: 'combat', unitName: actor.name, gambitTriggered: true },
      { session: scene._battleSession },
    );
    expect(target.hasActed).toBe(false);
    expect(look(target)).toEqual(READY);
  });

  it("an enemy dimmed as it acted is ready again at the player phase's start", () => {
    const { scene } = fixture();
    const [enemy] = scene.enemyUnits;
    enemy.hasActed = true;
    scene.dimUnit(enemy);
    expect(look(enemy)).toEqual(SPENT());
    // TurnManager.endEnemyPhase resets the foe; then the player phase begins.
    enemy.hasActed = false;
    resetPlayerUnitsForTurn(scene, 2);
    expect(look(enemy)).toEqual(READY);
  });
});

// Every flash in src ends through UnitRestAppearance: a raw clearTint (or a remembered
// tint read back from tintTopLeft) on a unit's sprite is how this bug was written.
describe('no flash clears a unit sprite tint by hand', () => {
  const ALLOWED = {
    'src/ui/UnitRestAppearance.js': Infinity, // the rule itself
    'src/ui/FactionRings.js': 1, // the ring's own acted dim, not the sprite
    'src/art/BattleLightLayer.js': 1, // light bulbs, not units
    // A dying unit's sprite, cleared just before its texture is swapped for the dissolve.
    'src/ui/CombatFxController.js': 1,
  };
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(js|mjs)$/.test(entry.name)) files.push(full);
    }
  };
  walk(path.resolve(__dirname, '../src'));

  it('src has clearTint / tintTopLeft only where allowed', () => {
    const found = {};
    for (const file of files) {
      const rel = path.relative(path.resolve(__dirname, '..'), file).split(path.sep).join('/');
      const text = fs.readFileSync(file, 'utf8');
      const n = (text.match(/\bclearTint\b|\btintTopLeft\b/g) || []).length;
      if (n > (ALLOWED[rel] ?? 0)) found[rel] = n;
    }
    expect(found).toEqual({});
  });
});
