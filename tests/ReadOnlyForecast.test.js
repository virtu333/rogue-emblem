// The attack forecast is read-only for equipment (step 2 of
// docs/specs/compression-plan-2026-09-25.md). Planning an attack never changes
// unit.weapon or the bag; confirming equips the planned weapon
// (scene._forecastWeapon) and moves it to the top.
//
// Characterisation (pinned on main before the change, unchanged after):
//   - the confirmed attack's committed state and resolution after a long
//     open → cycle → switch target → switch back → cycle → confirm sequence;
//   - Doublebow / _grantedSkill forecast parity with truly equipping;
//   - a weapon art on a non-equipped duplicate weapon without uids;
//   - the legacy-v1 Gambler Math.random draw count.
// Contract (new): every preview interaction leaves equipment and bag order
// untouched, and fixed-v1 planning makes no Math.random call.
//
// Expected numbers are derived by hand from the fixture (see the comments),
// never by re-running the code under test.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));
vi.mock('../src/ui/HintDisplay.js', () => ({
  showImportantHint: vi.fn(async () => {}),
  showMinorHint: vi.fn(),
  showContextualHint: vi.fn(),
  claimContextualHint: vi.fn(() => false),
  observeContextualHint: vi.fn(() => () => {}),
  isHintTextVisible: vi.fn(() => false),
}));
const renders = [];
vi.mock('../src/ui/ForecastOverlay.js', () => ({
  ForecastOverlay: class {
    constructor(scene) {
      this.scene = scene;
      this.displayObjects = [];
    }
    render(config) {
      renders.push(config);
    }
    destroy() {}
  },
}));
// Level-up presentation and the post-action continuation are covered elsewhere;
// here the action ends once the attack is resolved and applied.
vi.mock('../src/ui/BattlePresentationCheckpoint.js', async (importOriginal) => ({
  ...(await importOriginal()),
  presentQueuedLevelUps: vi.fn(async () => {}),
  completeResolvedAction: vi.fn(),
}));
// Every resolved attack: the attacker weapon passed in and the result.
const resolutions = [];
vi.mock('../src/engine/Combat.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    resolveCombat: vi.fn((...args) => {
      const result = actual.resolveCombat(...args);
      resolutions.push({ attacker: args[0], weapon: args[1], defender: args[2], result });
      return result;
    }),
  };
});

import { BattleScene } from '../src/scenes/BattleScene.js';
import { serializeBattleUnit } from '../src/engine/BattleUnitState.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const catalog = (name) => structuredClone(data.weapons.find((w) => w.name === name));
const item = (name, uid, extra = {}) => ({ ...catalog(name), ...(uid ? { uid } : {}), ...extra });
const terrain = data.terrain.find((t) => t.name === 'Plain') || data.terrain[0];

function makeUnit(name, faction, col, row, inventory, extra = {}) {
  return {
    name,
    faction,
    col,
    row,
    className: faction === 'player' ? 'Lord' : 'Fighter',
    tier: 'promoted',
    level: 5,
    skills: [],
    affixes: [],
    _conditions: [],
    consumables: [],
    // STR 7, SKL 7, SPD 8, DEF 5, LCK 5 on both sides (see the hand-derived numbers).
    stats: { HP: 22, STR: 7, MAG: 1, SKL: 7, SPD: 8, DEF: 5, RES: 2, LCK: 5, MOV: 5 },
    currentHP: 22,
    proficiencies: [
      { type: 'Sword', rank: 'Prof' },
      { type: 'Bow', rank: 'Mast' },
      { type: 'Staff', rank: 'Prof' },
    ],
    weaponRank: 'Prof',
    inventory,
    weapon: inventory[0] || null,
    ...extra,
  };
}

const stubObject = () => {
  const o = {
    on: () => o,
    setColor: () => o,
    setDepth: () => o,
    setOrigin: () => o,
    setStrokeStyle: () => o,
    setInteractive: () => o,
    disableInteractive: () => o,
    destroy: () => {},
  };
  return o;
};

/**
 * A BattleScene with the real attack flow, action menu, weapon-art picker,
 * confirm, force End Turn, deselect and executeCombat; presentation stubbed.
 * Hero (u1) at (5,5): Iron Sword [equipped], Steel Sword, Iron Bow. Fighter
 * (u2) adjacent at (6,5), Archer (u3) two tiles away at (5,7).
 */
function makeScene({ policy = 'fixed-v1', inventory = null, heroExtra = {} } = {}) {
  const iron = item('Iron Sword', 'iron');
  const steel = item('Steel Sword', 'steel');
  const bow = item('Iron Bow', 'bow');
  const hero = makeUnit('Edric', 'player', 5, 5, inventory || [iron, steel, bow], {
    battleEntityId: 'u1',
    ...heroExtra,
  });
  const fighter = makeUnit('Fighter', 'enemy', 6, 5, [item('Iron Axe', 'axe')], {
    battleEntityId: 'u2',
    proficiencies: [{ type: 'Axe', rank: 'Prof' }],
  });
  const archer = makeUnit('Archer', 'enemy', 5, 7, [item('Iron Bow', 'ebow')], {
    battleEntityId: 'u3',
    proficiencies: [{ type: 'Bow', rank: 'Prof' }],
  });
  const scene = Object.create(BattleScene.prototype);
  const checkpoints = [];
  Object.assign(scene, {
    gameData: data,
    battleParams: {},
    battleConfig: {},
    runManager: {
      battleInProgress: true,
      blessingRuntimeModifiers: {},
      getActHitBonusForUnit: () => 0,
      getTerrainCombatBonuses: () => [],
    },
    turnManager: {
      currentPhase: 'player',
      turnNumber: 1,
      endPlayerPhase: vi.fn(),
      unitActed: vi.fn(),
    },
    playerUnits: [hero],
    enemyUnits: [fighter, archer],
    npcUnits: [],
    ballistas: [],
    selectedUnit: hero,
    battleState: 'UNIT_ACTION_MENU',
    attackTargets: [],
    healTargets: [],
    _selectedWeaponArt: null,
    _combatRollSession: null,
    _battleRewindPolicy: policy,
    visionBaseSeed: 7,
    grid: {
      fogEnabled: false,
      cols: 20,
      rows: 20,
      isVisible: () => true,
      getTerrainAt: () => terrain,
      clearAttackHighlights: vi.fn(),
      clearHighlights: vi.fn(),
      clearPath: vi.fn(),
      showAttackRange: vi.fn(),
      gridToPixel: (c, r) => ({ x: c * 32 + 16, y: r * 32 + 16 }),
    },
    registry: { get: () => null },
    add: { rectangle: stubObject, text: stubObject },
    tweens: { add: vi.fn() },
    _gridCursor: { snapTo: vi.fn() },
    _pinToScreen: vi.fn(),
    _clampMenuPosition: (x, y) => ({ x, y }),
    _makeMenuTextButton: (x, y, label, style, color, onClick, options = {}) =>
      Object.assign(stubObject(), {
        text: label,
        _action: onClick,
        _menuDisabled: Boolean(options.disabled),
      }),
    hideActionMenu: vi.fn(function () {
      this.actionMenu = null;
    }),
    _hideMenuTooltip: vi.fn(),
    findHealTargets: () => [],
    findShoveTargets: () => [],
    findPullTargets: () => [],
    findTradeTargets: () => [],
    findSwapTargets: () => [],
    findDanceTargets: () => [],
    findBreakTargets: () => [],
    getUsableReclassConsumables: () => [],
    getPromotionConsumable: () => null,
    _hasAbilities: () => false,
    isStoryInputLocked: () => false,
    _isTutorialStrictGateActive: () => false,
    commitVisionSnapshotIfPending: vi.fn(),
    refreshEndTurnControl: vi.fn(),
    cleanupTradeUI: vi.fn(),
    dimUnit: vi.fn(),
    // Checkpoints: what a refresh would restore at that moment.
    _captureSuspendCheckpoint: vi.fn((options = {}) => {
      checkpoints.push({
        commitIntent: Boolean(options.commitIntent),
        intent: structuredClone(scene._pendingCommittedAction ?? null),
        hero: serializeBattleUnit(hero),
        rollSessionKey: scene._combatRollSession?.key ?? null,
      });
    }),
    // Resolution presentation.
    resetFortHealStreak: vi.fn(),
    animateStrike: vi.fn(async () => {}),
    animateSkillActivation: vi.fn(async () => {}),
    updateHPBar: vi.fn(),
    _applyResolvedCombatPostEffects: vi.fn(async () => {}),
    _checkPhoenixBrooch: vi.fn(async () => false),
    isDevToolsEnabled: () => false,
    awardXP: vi.fn(async () => {}),
    removeUnit: vi.fn(async () => {}),
    _maybeShowTutorialPermadeathHint: vi.fn(async () => {}),
    _battleBeats: { checkBossHalfHealth: vi.fn(async () => {}) },
    _deedController: { onCombat: vi.fn(), onUnitRemoved: vi.fn() },
  });
  // confirmForecastCombat does not await the attack; keep its promise.
  let attack = null;
  scene.executeCombat = function (...args) {
    attack = BattleScene.prototype.executeCombat.apply(this, args);
    return attack;
  };
  return {
    scene,
    hero,
    iron,
    steel,
    bow,
    fighter,
    archer,
    checkpoints,
    settled: () => attack,
  };
}

const menuRow = (scene, prefix) =>
  (scene.actionMenu || []).find((o) => String(o.text).startsWith(prefix));
const uids = (unit) => unit.inventory.map((w) => w.uid ?? null);

let random;
beforeEach(() => {
  renders.length = 0;
  resolutions.length = 0;
  // Every roll 0: every strike hits, no strike crits (all crit rates here are 0).
  random = vi.spyOn(Math, 'random').mockReturnValue(0);
});
afterEach(() => random.mockRestore());

describe('characterisation: a confirmed attack after planning', () => {
  it('open → cycle → switch target → switch back → cycle → confirm commits and resolves the Steel Sword', async () => {
    const { scene, hero, iron, steel, bow, fighter, archer, checkpoints, settled } = makeScene();
    const flow = scene._attackFlow();
    flow.begin(hero);
    await flow.openForecast(hero, fighter);
    expect(scene._cycleForecastWeapon(1)).toBe(true); // Iron → Steel
    expect(scene._cycleForecastTarget(1)).toBe(true); // Fighter → Archer (bow only)
    expect(scene.forecastTarget).toBe(archer);
    expect(scene._cycleForecastTarget(-1)).toBe(true); // back to the Fighter
    expect(scene.forecastTarget).toBe(fighter);
    expect(scene._cycleForecastWeapon(1)).toBe(true); // a new target starts on Iron → Steel
    expect(renders.at(-1).forecast.attacker.damage).toBe(11);
    scene.confirmForecastCombat();
    await settled();

    // Equipped and moved to the top; the rest keep their order.
    expect(hero.weapon).toBe(steel);
    expect(hero.inventory).toEqual([steel, iron, bow]);
    expect(uids(hero)).toEqual(['steel', 'iron', 'bow']);

    // The pre-roll checkpoint: the intent and the equipped weapon as saved.
    const commit = checkpoints.find((c) => c.commitIntent);
    expect(commit.intent).toEqual({
      kind: 'attack',
      unitId: 'u1',
      unitName: 'Edric',
      targetId: 'u2',
      weaponArt: null,
    });
    expect(commit.hero.equippedInventoryIndex).toBe(0);
    expect(commit.hero.inventory.map((w) => w.uid)).toEqual(['steel', 'iron', 'bow']);
    expect(commit.rollSessionKey).toBe(':player:1:u1:u2:5,5:6,5');

    // Resolved once, with the Steel Sword. Steel: 7 STR + 8 Mt + 1 (sword beats
    // axe) - 5 DEF = 11. Axe counter: 7 + 7 - 1 - 5 = 8. AS 8-5=3 vs 8-6=2: no
    // doubles. Every roll is 0, so both strikes hit and neither crits.
    expect(resolutions).toHaveLength(1);
    const [{ weapon, result }] = resolutions;
    expect(weapon).toBe(steel);
    const strikes = result.events.filter((e) => e.type === 'strike');
    expect(strikes.map((e) => [e.attackerSide ?? 'attacker', e.damage, !!e.miss])).toEqual([
      ['attacker', 11, false],
      ['defender', 8, false],
    ]);
    expect(result.defenderHP).toBe(11);
    expect(result.attackerHP).toBe(14);
    expect(fighter.currentHP).toBe(11);
    expect(hero.currentHP).toBe(14);
    // The intent is cleared once the result is applied.
    expect(scene._pendingCommittedAction).toBeNull();
  });
});

describe('characterisation: forecast parity with truly equipping', () => {
  /** Forecast for `weapon` via cycling (equipped: the first bag item). */
  async function cycledForecast(inventory, weapon, target = 'archer', heroExtra = {}) {
    const fx = makeScene({ inventory, heroExtra });
    const defender = fx[target];
    fx.scene._attackFlow().begin(fx.hero);
    await fx.scene._attackFlow().openForecast(fx.hero, defender);
    // The weapon the forecast is showing (main: the provisionally equipped one).
    const shown = () => fx.scene._forecastWeapon ?? fx.hero.weapon;
    const valid = fx.scene._forecastValidWeapons;
    for (let i = 0; i < valid.length && shown()?.name !== weapon; i++)
      fx.scene._cycleForecastWeapon(1);
    expect(shown()?.name).toBe(weapon);
    expect(fx.hero.inventory[0].name).not.toBe(weapon); // it was never truly equipped
    return renders.at(-1).forecast;
  }

  /** Forecast with `weapon` equipped (and first) before the attack begins. */
  async function equippedForecast(inventory, weapon, target = 'archer', heroExtra = {}) {
    const chosen = inventory.find((w) => w.name === weapon);
    const fx = makeScene({
      inventory: [chosen, ...inventory.filter((w) => w !== chosen)],
      heroExtra,
    });
    fx.scene._attackFlow().begin(fx.hero);
    await fx.scene._attackFlow().openForecast(fx.hero, fx[target]);
    expect(renders.at(-1).forecast).toBeTruthy();
    return renders.at(-1).forecast;
  }

  it('Doublebow (+4 STR/SPD with no adjacent ally) shows its conditional bonus when cycled to', async () => {
    const bag = () => [item('Iron Bow', 'bow'), item('Doublebow', 'dbow')];
    const cycled = await cycledForecast(bag(), 'Doublebow');
    const equipped = await equippedForecast(bag(), 'Doublebow');
    // 7 STR + 11 Mt + 4 (Doublebow, alone) - 5 DEF = 17 against the Archer.
    expect(cycled.attacker.damage).toBe(17);
    expect(cycled).toEqual(equipped);
  });

  it("a weapon's granted skill (Death Blow: +6 ATK when initiating) counts when cycled to", async () => {
    const bag = () => [
      item('Iron Sword', 'iron'),
      item('Steel Sword', 'steel', { _grantedSkill: 'death_blow' }),
    ];
    const cycled = await cycledForecast(bag(), 'Steel Sword', 'fighter');
    const equipped = await equippedForecast(bag(), 'Steel Sword', 'fighter');
    // 7 STR + 8 Mt + 6 (Death Blow) + 1 (sword beats axe) - 5 DEF = 17.
    expect(cycled.attacker.damage).toBe(17);
    expect(cycled.attacker.skills.map((s) => s.id)).toContain('death_blow');
    expect(cycled).toEqual(equipped);
  });
});

describe('characterisation: weapon art on a non-equipped duplicate without uids', () => {
  it('the art stays bound to the picked copy through confirm, the commit and resolution', async () => {
    const art = data.weaponArts.arts.find((a) => a.id === 'sword_wrath_strike');
    const copy = () => ({
      ...catalog('Iron Sword'),
      weaponArtIds: [art.id],
      weaponArtSources: ['scroll'],
    });
    const first = copy();
    const second = copy();
    const { scene, hero, fighter, checkpoints, settled } = makeScene({
      inventory: [first, second],
    });
    scene.showActionMenu(hero);
    menuRow(scene, 'Weapon Art')._action();
    // Picker rows: Normal Attack, then one row per (weapon, art).
    const rows = scene.actionMenu.filter((o) => String(o.text).includes(art.name));
    expect(rows).toHaveLength(2);
    rows[1]._action(); // the second copy
    expect(scene.battleState).toBe('SELECTING_TARGET');
    expect(scene._selectedWeaponArt).toEqual({
      unitName: 'Edric',
      artId: art.id,
      weaponIndex: 1,
    });
    await scene._attackFlow().openForecast(hero, fighter);
    expect(renders.at(-1).weaponArt?.id).toBe(art.id);
    expect(renders.at(-1).validWeapons).toEqual([second]);
    scene.confirmForecastCombat();
    await settled();

    expect(hero.weapon).toBe(second);
    expect(hero.inventory).toEqual([second, first]);
    // No uid was stamped anywhere along the way.
    expect(hero.inventory.every((w) => w.uid === undefined)).toBe(true);
    const commit = checkpoints.find((c) => c.commitIntent);
    expect(commit.intent.weaponArt).toEqual({ artId: art.id, weaponIndex: 0 });
    expect(commit.hero.equippedInventoryIndex).toBe(0);
    expect(resolutions).toHaveLength(1);
    expect(resolutions[0].weapon).toBe(second);
    // Iron Sword 7 + 5 Mt + 5 (Wrath Strike) + 1 (sword beats axe) - 5 DEF = 13.
    const strike = resolutions[0].result.events.find(
      (e) => e.type === 'strike' && (e.attackerSide ?? 'attacker') === 'attacker',
    );
    expect(strike.damage).toBe(13);
    // The art's 3 HP cost, then the axe counter (7 + 7 - 1 - 5 = 8): 22 - 3 - 8.
    expect(hero.currentHP).toBe(11);
  });
});

describe('characterisation: legacy-v1 Gambler draws', () => {
  it('rolls once per roll session: open, new target, back, cancel and reopen', async () => {
    const gambler = {
      name: "Gambler's Coin",
      combatEffects: { gambler: { winChance: 0.5, winAtkBonus: 5, lossAtkPenalty: -3 } },
    };
    const { scene, hero, fighter, archer, checkpoints, settled } = makeScene({
      policy: 'legacy-v1',
      heroExtra: { accessory: gambler },
    });
    random.mockReturnValue(0.25); // < winChance: +5
    const flow = scene._attackFlow();
    flow.begin(hero);
    expect(random).toHaveBeenCalledTimes(0);
    await flow.openForecast(hero, fighter); // session 1: roll
    expect(random).toHaveBeenCalledTimes(1);
    scene._cycleForecastWeapon(1); // same session: reuse
    expect(random).toHaveBeenCalledTimes(1);
    scene._cycleForecastTarget(1); // the Archer: session 2, roll
    expect(scene.forecastTarget).toBe(archer);
    expect(random).toHaveBeenCalledTimes(2);
    scene._cycleForecastTarget(-1); // back to the Fighter: session 3, roll
    expect(random).toHaveBeenCalledTimes(3);
    scene.handleCancel(); // drops the session
    await flow.openForecast(hero, fighter); // session 4: roll
    expect(random).toHaveBeenCalledTimes(4);
    scene._cycleForecastWeapon(1);
    expect(random).toHaveBeenCalledTimes(4);
    expect(renders.at(-1).gamblerLine).toBe('GAMBLER: ATK +5 (locked)');
    scene.confirmForecastCombat();
    await settled();
    // The committed intent carries the forecast's roll; resolution reused it.
    const commit = checkpoints.find((c) => c.commitIntent);
    expect(commit.intent.gamblerAtkDelta).toEqual({ attacker: 5, defender: null });
    // Steel 11 (see above) + 5 Gambler = 16.
    const strike = resolutions[0].result.events.find(
      (e) => e.type === 'strike' && (e.attackerSide ?? 'attacker') === 'attacker',
    );
    expect(strike.damage).toBe(16);
  });
});

describe('characterisation: confirm and resume', () => {
  it('confirming a weapon from deeper in the bag moves only it to the top', async () => {
    // Bag [Iron, Bow, Steel]: the Fighter's weapons are Iron and Steel; the
    // Bow keeps its place behind Iron (a swap-to-front would put it last).
    const iron = item('Iron Sword', 'iron');
    const bow = item('Iron Bow', 'bow');
    const steel = item('Steel Sword', 'steel');
    const { scene, hero, fighter, settled } = makeScene({ inventory: [iron, bow, steel] });
    scene._attackFlow().begin(hero);
    await scene._attackFlow().openForecast(hero, fighter);
    expect(renders.at(-1).validWeapons).toEqual([iron, steel]);
    scene._cycleForecastWeapon(1);
    scene.confirmForecastCombat();
    await settled();
    expect(hero.weapon).toBe(steel);
    expect(hero.inventory).toEqual([steel, iron, bow]);
  });

  it('a new target starts on the equipped weapon, not the one shown for the last target', async () => {
    const { scene, hero, fighter, archer } = makeScene();
    // A second adjacent Fighter: both targets are in reach of both swords.
    const second = makeUnit('Brigand', 'enemy', 4, 5, [item('Iron Axe', 'axe2')], {
      battleEntityId: 'u4',
      proficiencies: [{ type: 'Axe', rank: 'Prof' }],
    });
    scene.enemyUnits = [fighter, second, archer];
    const flow = scene._attackFlow();
    flow.begin(hero);
    await flow.openForecast(hero, fighter);
    scene._cycleForecastWeapon(1);
    expect(renders.at(-1).forecast.attacker.damage).toBe(11); // Steel
    flow.switchForecastTarget(second);
    expect(scene.forecastTarget).toBe(second);
    // Iron: 7 + 5 + 1 - 5 = 8.
    expect(renders.at(-1).forecast.attacker.damage).toBe(8);
  });

  it('the silence guard checks the planned weapon', async () => {
    const fire = item('Fire', 'fire');
    const { scene, hero, fighter } = makeScene({
      inventory: [item('Iron Sword', 'iron'), fire],
      heroExtra: {
        proficiencies: [
          { type: 'Sword', rank: 'Prof' },
          { type: 'Tome', rank: 'Prof' },
        ],
      },
    });
    const iron = hero.inventory[0];
    scene._attackFlow().begin(hero);
    await scene._attackFlow().openForecast(hero, fighter);
    scene._cycleForecastWeapon(1); // Fire
    hero._conditions = [{ id: 'silence', turnsRemaining: 1 }];
    scene.confirmForecastCombat();
    expect(scene.battleState).toBe('UNIT_ACTION_MENU');
    expect(resolutions).toHaveLength(0);
    expect(hero.weapon).toBe(iron);
    expect(hero.inventory).toEqual([iron, fire]);
  });

  it('resuming a committed art attack equips the art weapon, then resolves with it', async () => {
    const art = data.weaponArts.arts.find((a) => a.id === 'sword_wrath_strike');
    const iron = item('Iron Sword', 'iron');
    const steel = item('Steel Sword', 'steel', {
      weaponArtIds: [art.id],
      weaponArtSources: ['scroll'],
    });
    const { scene, hero, settled } = makeScene({ inventory: [iron, steel] });
    scene.selectedUnit = null;
    scene.battleState = 'PLAYER_IDLE';
    scene._scheduleSafeDelayedAsync = (delay, label, run) => run();
    expect(
      scene.resumeCommittedAttack({
        kind: 'attack',
        unitId: 'u1',
        unitName: 'Edric',
        targetId: 'u2',
        weaponArt: { artId: art.id, weaponIndex: 1, weaponUid: 'steel' },
      }),
    ).toBe(true);
    await settled();
    expect(hero.weapon).toBe(steel);
    expect(hero.inventory).toEqual([steel, iron]);
    expect(resolutions[0].weapon).toBe(steel);
    // Steel 11 + 5 (Wrath Strike) = 16.
    const strike = resolutions[0].result.events.find(
      (e) => e.type === 'strike' && (e.attackerSide ?? 'attacker') === 'attacker',
    );
    expect(strike.damage).toBe(16);
  });
});

describe('contract: planning an attack never changes equipment', () => {
  /** Identity and order of every carried item, and every item's uid. */
  const snapshot = (unit) => ({
    weapon: unit.weapon,
    inventory: [...unit.inventory],
    uids: unit.inventory.map((w) => w.uid),
  });
  const expectUntouched = (unit, before, step) => {
    expect(unit.weapon, step).toBe(before.weapon);
    expect(unit.inventory, step).toEqual(before.inventory);
    unit.inventory.forEach((w, i) => expect(w, step).toBe(before.inventory[i]));
    expect(
      unit.inventory.map((w) => w.uid),
      step,
    ).toEqual(before.uids);
  };

  it('Attack, the forecast, cycling, targets, Cancel, Back, deselect and force End Turn', async () => {
    // One uid-less item: the forecast must never stamp one (generateItemUid draws RNG).
    const bag = [item('Iron Sword', 'iron'), item('Steel Sword', 'steel'), item('Iron Bow')];
    const { scene, hero, fighter, archer, checkpoints } = makeScene({ inventory: bag });
    const before = snapshot(hero);
    const planned = () => scene._forecastWeapon?.name ?? null;
    const flow = scene._attackFlow();
    const step = async (label, fn) => {
      await fn();
      expectUntouched(hero, before, label);
    };

    await step('action menu', () => scene.showActionMenu(hero));
    await step('Attack', () => menuRow(scene, 'Attack')._action());
    expect(scene.battleState).toBe('SELECTING_TARGET');
    await step('focus next target', () => flow.cycleTarget(1));
    await step('open forecast', () => flow.openForecast(hero, fighter));
    expect(planned()).toBe('Iron Sword');
    await step('next weapon', () => scene._cycleForecastWeapon(1));
    expect(planned()).toBe('Steel Sword');
    expect(renders.at(-1).forecast.attacker.damage).toBe(11);
    await step('next weapon again', () => scene._cycleForecastWeapon(1));
    expect(planned()).toBe('Iron Sword');
    await step('previous weapon', () => scene._cycleForecastWeapon(-1));
    expect(planned()).toBe('Steel Sword');
    await step('next target', () => scene._cycleForecastTarget(1));
    expect(scene.forecastTarget).toBe(archer);
    expect(planned()).toBe('Iron Bow');
    await step('tap the first target', () => flow.switchForecastTarget(fighter));
    expect(planned()).toBe('Iron Sword');
    await step('next weapon', () => scene._cycleForecastWeapon(1));
    await step('a checkpoint while planning', () => scene._captureSuspendCheckpoint());
    expect(checkpoints.at(-1).hero.equippedInventoryIndex).toBe(0);
    expect(checkpoints.at(-1).hero.weapon.uid).toBe('iron');
    await step('Cancel', () => scene.handleCancel());
    expect(scene.battleState).toBe('SELECTING_TARGET');
    expect(scene._forecastWeapon ?? null).toBeNull();
    await step('Back', () => scene.handleCancel());
    expect(scene.battleState).toBe('UNIT_ACTION_MENU');

    await step('Attack again', () => menuRow(scene, 'Attack')._action());
    await step('open again', () => flow.openForecast(hero, fighter));
    await step('next weapon', () => scene._cycleForecastWeapon(1));
    await step('deselect', () => scene.deselectUnit());
    expect(scene.battleState).toBe('PLAYER_IDLE');

    scene.selectedUnit = hero;
    await step('menu again', () => scene.showActionMenu(hero));
    await step('Attack a third time', () => menuRow(scene, 'Attack')._action());
    await step('open a third time', () => flow.openForecast(hero, fighter));
    await step('next weapon', () => scene._cycleForecastWeapon(1));
    await step('force End Turn', () => scene.forceEndTurn());
    expect(scene.turnManager.endPlayerPhase).toHaveBeenCalledOnce();
    expect(scene._forecastWeapon ?? null).toBeNull();
    // The End Turn checkpoint holds the equipped weapon, never the plan.
    expect(checkpoints.at(-1).hero.equippedInventoryIndex).toBe(0);

    // fixed-v1: planning draws no randomness at all.
    expect(random).not.toHaveBeenCalled();
    expect(resolutions).toHaveLength(0);
  });

  it('the Weapon Art menu with a staff equipped, its picker, Back and an art forecast', async () => {
    const art = data.weaponArts.arts.find((a) => a.id === 'sword_wrath_strike');
    const staff = item('Heal', 'heal');
    const sword = item('Iron Sword', 'iron', {
      weaponArtIds: [art.id],
      weaponArtSources: ['scroll'],
    });
    const { scene, hero, fighter } = makeScene({ inventory: [staff, sword] });
    const before = snapshot(hero);
    const flow = scene._attackFlow();
    const step = async (label, fn) => {
      await fn();
      expectUntouched(hero, before, label);
    };

    await step('action menu', () => scene.showActionMenu(hero));
    await step('Weapon Art', () => menuRow(scene, 'Weapon Art')._action());
    expect(scene.inEquipMenu).toBe(true);
    await step('Back from the picker', () => scene.handleCancel());
    expect(scene.inEquipMenu).toBe(false);
    await step('Weapon Art again', () => menuRow(scene, 'Weapon Art')._action());
    const artRow = scene.actionMenu.find((o) => String(o.text).includes(art.name));
    await step('pick the art', () => artRow._action());
    expect(scene.battleState).toBe('SELECTING_TARGET');
    expect(scene._selectedWeaponArt?.artId).toBe(art.id);
    await step('open the art forecast', () => flow.openForecast(hero, fighter));
    expect(scene._forecastWeapon).toBe(sword);
    expect(renders.at(-1).weaponArt?.id).toBe(art.id);
    // Iron 7 + 5 + 5 (Wrath Strike) + 1 - 5 = 13, planned with the staff still equipped.
    expect(renders.at(-1).forecast.attacker.damage).toBe(13);
    await step('Cancel', () => scene.handleCancel());
    await step('Back to the menu', () => scene.handleCancel());
    // Returning to the action menu drops the chosen art.
    expect(scene._selectedWeaponArt).toBeNull();
    expect(random).not.toHaveBeenCalled();
  });

  it('confirm aborts to the action menu when the planned weapon is gone or unusable', async () => {
    for (const change of ['dropped', 'unequippable']) {
      resolutions.length = 0;
      const { scene, hero, iron, steel, bow, fighter } = makeScene();
      scene._attackFlow().begin(hero);
      await scene._attackFlow().openForecast(hero, fighter);
      scene._cycleForecastWeapon(1); // Steel
      if (change === 'dropped') hero.inventory.splice(hero.inventory.indexOf(steel), 1);
      else steel.rankRequired = 'Mast';
      scene.confirmForecastCombat();
      expect(scene.battleState, change).toBe('UNIT_ACTION_MENU');
      expect(resolutions, change).toHaveLength(0);
      expect(hero.weapon, change).toBe(iron);
      expect(hero.inventory, change).toEqual(
        change === 'dropped' ? [iron, bow] : [iron, steel, bow],
      );
    }
  });

  it('confirm equips the planned weapon; the forecast never serialises the plan', async () => {
    const { scene, hero, steel, fighter, settled } = makeScene();
    scene._attackFlow().begin(hero);
    await scene._attackFlow().openForecast(hero, fighter);
    scene._cycleForecastWeapon(1);
    expect(scene._forecastWeapon).toBe(steel);
    expect(hero.weapon).not.toBe(steel);
    scene.confirmForecastCombat();
    expect(scene._forecastWeapon ?? null).toBeNull();
    await settled();
    expect(hero.weapon).toBe(steel);
    // No unit field carries the plan.
    expect(Object.keys(hero).filter((k) => /forecast/i.test(k))).toEqual([]);
  });
});
