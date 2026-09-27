// Staves heal green units: the merchant caravan (CaravanSystem.createCaravanUnit) and
// recruit NPCs live in scene.npcUnits, and a player's heal, cure and Fortify staves
// (and Healing Circle) treat them as allies, as Fire Emblem does. Relocation staves
// stay army-only, enemies never mend them, and the fog still hides them.
//
// Expected values are derived by hand from the staff formula (Combat.resolveHeal):
// healed = min(MAG + healBase, max HP - current HP).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import './harness/JourneyTestSetup.js';

const pickers = vi.hoisted(() => []);
vi.mock('../src/ui/VisionRewindPicker.js', () => ({
  VisionRewindPicker: class {
    constructor(scene, options) {
      this.options = options;
      pickers.push(this);
    }
    destroy() {}
  },
}));

import { BattleScene } from '../src/scenes/BattleScene.js';
import { createCaravanUnit } from '../src/engine/CaravanSystem.js';
import { isNpcAlly, staffAllyCandidates } from '../src/engine/RecruitNpc.js';
import { AbilityController } from '../src/ui/AbilityController.js';
import { AIController } from '../src/engine/AIController.js';
import { VisionRewindController } from '../src/ui/VisionRewindController.js';
import { BattleSuspendController } from '../src/ui/BattleSuspendController.js';
import { RunDriver, JourneyStorage } from './harness/RunDriver.js';
import { journeyBattleScene } from './harness/JourneyBattleScene.js';
import { loadRun } from '../src/engine/RunManager.js';
import { installSeed, restoreMathRandom } from '../sim/lib/SeededRNG.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const weapon = (name) => structuredClone(data.weapons.find((w) => w.name === name));

function makeHealer(staffName, { MAG = 8, col = 4, row = 4 } = {}) {
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

function makeRecruit(name, col, row, currentHP, maxHP = 24) {
  return { name, className: 'Cavalier', faction: 'npc', col, row, currentHP, stats: { HP: maxHP } };
}

function makeText() {
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
function makeScene({ playerUnits = [], npcUnits = [], enemyUnits = [], visible = null } = {}) {
  const scene = new BattleScene();
  Object.assign(scene, {
    playerUnits,
    npcUnits,
    enemyUnits,
    battleState: 'PLAYER_IDLE',
    battleParams: {},
    gameData: data,
    turnPar: null,
    turnBonusConfig: null,
    turnManager: { turnNumber: 1, currentPhase: 'player' },
    // A run battle, so deeds and history beats record like production.
    runManager: {
      battleInProgress: {},
      getDifficultyModifier: (_key, fallback) => fallback,
      getXpMultiplierDelta: () => 0,
    },
    registry: { get: () => null },
    grid: {
      fogEnabled: Boolean(visible),
      isVisible: (col, row) => !visible || visible.has(`${col},${row}`),
      clearAttackHighlights: vi.fn(),
      showHealRange: vi.fn(),
      showAttackRange: vi.fn(),
      gridToPixel: () => ({ x: 0, y: 0 }),
    },
    add: { text: () => makeText() },
    tweens: { add: ({ onComplete }) => onComplete?.() },
    updateHPBar: vi.fn(),
    animateHeal: vi.fn(async () => {}),
    _removeAllConditionIcons: vi.fn(),
    undimUnit: vi.fn(),
    _reduceMotion: () => true,
    _awaitSceneDelay: async () => {},
    _recoverUnitActionError: vi.fn((_unit, label, err) => {
      throw new Error(`${label} failed: ${err?.message}`);
    }),
    finishUnitAction: vi.fn(),
  });
  return scene;
}

describe('NPC allies of the army', () => {
  it('are living green units: recruits and the caravan, never enemies or the removed', () => {
    const caravan = createCaravanUnit('act2', { col: 0, row: 0 });
    const recruit = makeRecruit('Garrick', 1, 0, 10);
    expect(isNpcAlly(caravan)).toBe(true);
    expect(isNpcAlly(recruit)).toBe(true);
    expect(isNpcAlly({ ...recruit, currentHP: 0 })).toBe(false);
    expect(isNpcAlly({ ...recruit, _removing: true })).toBe(false);
    expect(isNpcAlly({ ...recruit, faction: 'enemy' })).toBe(false);
    expect(isNpcAlly({ ...recruit, faction: 'player' })).toBe(false);
    const army = [{ name: 'Edric', faction: 'player' }];
    expect(staffAllyCandidates(army, [caravan, { ...recruit, currentHP: 0 }])).toEqual([
      army[0],
      caravan,
    ]);
    expect(staffAllyCandidates(undefined, undefined)).toEqual([]);
  });
});

describe('heal staff targets', () => {
  // Physic ("range": "1-2") reaches 1 to 2 tiles at MAG 8 (its +1 bonus starts at
  // MAG 10). Every candidate below stands 2 tiles from the healer at (4,4) except
  // Tess (3, out of reach), so only the rule under test can exclude it.
  function board() {
    const healer = makeHealer('Physic');
    const hurtAlly = {
      ...makeHealer('Heal'),
      name: 'Edric',
      col: 4,
      row: 2,
      currentHP: 10,
      stats: { HP: 20 },
    };
    const caravan = createCaravanUnit('act2', { col: 4, row: 6 });
    caravan.currentHP = 7;
    const recruit = makeRecruit('Garrick', 6, 4, 11);
    const fullRecruit = makeRecruit('Rowan', 5, 5, 24); // full HP
    const deadRecruit = makeRecruit('Lyle', 3, 3, 0); // fallen
    const leaving = { ...makeRecruit('Mira', 2, 4, 5), _removing: true }; // Talked away
    const farRecruit = makeRecruit('Tess', 7, 4, 5); // distance 3, out of reach
    const enemy = { name: 'Brigand', faction: 'enemy', col: 5, row: 3, currentHP: 3 };
    enemy.stats = { HP: 20 };
    const npcUnits = [caravan, fullRecruit, deadRecruit, leaving, farRecruit, recruit];
    return { healer, hurtAlly, caravan, recruit, npcUnits, enemy };
  }

  it('offer a wounded caravan and recruit in reach after the army, and nothing else', () => {
    const { healer, hurtAlly, caravan, recruit, npcUnits, enemy } = board();
    const scene = makeScene({ playerUnits: [healer, hurtAlly], npcUnits, enemyUnits: [enemy] });
    expect(scene.findHealTargets(healer)).toEqual([hurtAlly, caravan, recruit]);
  });

  it('never reveal an NPC the fog hides', () => {
    const { healer, hurtAlly, caravan, recruit, npcUnits } = board();
    // Everything visible except Garrick's tile.
    const visible = new Set();
    for (let c = 0; c < 10; c++) for (let r = 0; r < 10; r++) visible.add(`${c},${r}`);
    visible.delete('6,4');
    const scene = makeScene({ playerUnits: [healer, hurtAlly], npcUnits, visible });
    expect(scene.findHealTargets(healer)).toEqual([hurtAlly, caravan]);
    visible.add('6,4');
    expect(scene.findHealTargets(healer)).toEqual([hurtAlly, caravan, recruit]);
  });

  it('offer the caravan alone when only it is hurt, and nothing once it is whole', () => {
    const healer = makeHealer('Heal');
    const caravan = createCaravanUnit('act2', { col: 4, row: 5 });
    caravan.currentHP = 3;
    const scene = makeScene({ playerUnits: [healer], npcUnits: [caravan] });
    expect(scene.findHealTargets(healer)).toEqual([caravan]);
    caravan.currentHP = caravan.stats.HP;
    expect(scene.findHealTargets(healer)).toEqual([]);
  });

  it('cure a slept recruit with Restore, but relocation staves never move NPCs', () => {
    const healer = makeHealer('Restore');
    const recruit = makeRecruit('Garrick', 4, 6, 24); // distance 2, full HP
    recruit._conditions = [{ id: 'sleep', turnsRemaining: 2 }];
    const caravan = createCaravanUnit('act2', { col: 4, row: 5 }); // no conditions
    const scene = makeScene({ playerUnits: [healer], npcUnits: [caravan, recruit] });
    expect(scene.findHealTargets(healer)).toEqual([recruit]);

    // Rescue (range 2-3 at MAG 8) would pull a unit 2+ tiles away; Warp sends an
    // adjacent one. Both see only the army.
    scene.getUnitAt = (col, row) =>
      [...scene.playerUnits, ...scene.npcUnits].find((u) => u.col === col && u.row === row) || null;
    scene.grid.cols = 10;
    scene.grid.rows = 10;
    scene.grid.getMoveCost = () => 1;
    caravan.currentHP = 2;
    for (const name of ['Rescue Staff', 'Warp Staff']) {
      const relocator = makeHealer(name);
      scene.playerUnits = [relocator];
      expect(scene.findHealTargets(relocator)).toEqual([]);
    }
  });
});

describe('healing the merchant caravan', () => {
  it('restores MAG + healBase, spends one use, and grants the healer heal XP and deeds', async () => {
    const healer = makeHealer('Heal'); // MAG 8, Heal healBase 5 → 13
    const caravan = createCaravanUnit('act2', { col: 4, row: 5 }); // 18 + 4 × 2 = 26 HP
    expect(caravan.stats.HP).toBe(26);
    caravan.currentHP = 10;
    caravan.battleEntityId = 'npc-caravan';
    healer.battleEntityId = 'player-sera';
    const scene = makeScene({ playerUnits: [healer], npcUnits: [caravan] });
    const targets = scene.findHealTargets(healer);
    scene.startHealTargetSelection(healer, targets, healer.weapon);
    expect(scene.battleState).toBe('SELECTING_HEAL_TARGET');
    const staff = healer.weapon;

    await scene.executeHeal(healer, caravan);

    expect(caravan.currentHP).toBe(23);
    expect(staff._usesSpent).toBe(1);
    expect(healer.xp).toBe(20); // XP_BASE_HEAL, no multipliers in play
    expect(healer._battleDeeds.healed).toBe(13);
    expect(scene.animateHeal).toHaveBeenCalledWith(caravan, 13, healer);
    expect(scene.updateHPBar).toHaveBeenCalledWith(caravan);
    expect(scene.finishUnitAction).toHaveBeenCalledWith(healer);
    expect(scene._historyBeats).toContainEqual(
      expect.objectContaining({
        type: 'healed',
        actorId: 'player-sera',
        targetId: 'npc-caravan',
        outcome: { amount: 13 },
      }),
    );
    // The caravan stays an NPC: still the caravan shop's merchant, never an army unit.
    expect(scene.npcUnits).toEqual([caravan]);
    expect(caravan.faction).toBe('npc');
    expect(scene.playerUnits).toEqual([healer]);
  });

  it('never heals past max HP', async () => {
    const healer = makeHealer('Heal');
    const caravan = createCaravanUnit('act3', { col: 4, row: 5 }); // 18 + 4 × 3 = 30 HP
    caravan.currentHP = 25; // 5 missing < 13 output
    const scene = makeScene({ playerUnits: [healer], npcUnits: [caravan] });
    scene.startHealTargetSelection(healer, scene.findHealTargets(healer), healer.weapon);
    await scene.executeHeal(healer, caravan);
    expect(caravan.currentHP).toBe(30);
    expect(scene.animateHeal).toHaveBeenCalledWith(caravan, 5, healer);
  });

  it('cures a recruit NPC with Restore without touching its HP', async () => {
    const healer = makeHealer('Restore');
    const recruit = makeRecruit('Garrick', 4, 5, 9);
    recruit._conditions = [{ id: 'silence', turnsRemaining: 2 }];
    const scene = makeScene({ playerUnits: [healer], npcUnits: [recruit] });
    scene.startHealTargetSelection(healer, scene.findHealTargets(healer), healer.weapon);
    scene._healController.animateCure = vi.fn(async () => {});
    const staff = healer.weapon;
    await scene.executeHeal(healer, recruit);
    expect(recruit._conditions).toEqual([]);
    expect(recruit.currentHP).toBe(9);
    expect(staff._usesSpent).toBe(1);
    expect(healer.xp).toBe(20);
  });

  it('Fortify heals the army and every NPC ally in range for one use', async () => {
    const healer = makeHealer('Fortify', { MAG: 10 }); // 10 + 5 = 15 per target, range 1-2
    // Everyone below stands within Fortify's reach of 1 to 2 tiles.
    const ally = { ...makeHealer('Heal'), name: 'Edric', col: 4, row: 6, currentHP: 4 };
    ally.stats = { HP: 30 };
    const caravan = createCaravanUnit('act2', { col: 5, row: 5 }); // 26 HP, distance 2
    caravan.currentHP = 20;
    const recruit = makeRecruit('Garrick', 2, 4, 1); // distance 2, 24 HP
    const scene = makeScene({ playerUnits: [healer, ally], npcUnits: [caravan, recruit] });
    const staff = healer.weapon;

    scene.startHealTargetSelection(healer, scene.findHealTargets(healer), staff);
    await vi.waitFor(() => expect(scene.finishUnitAction).toHaveBeenCalledWith(healer));

    expect(ally.currentHP).toBe(19); // 4 + 15
    expect(caravan.currentHP).toBe(26); // 20 + 6 (capped)
    expect(recruit.currentHP).toBe(16); // 1 + 15
    expect(staff._usesSpent).toBe(1);
    expect(healer.xp).toBe(20);
  });
});

describe('Healing Circle', () => {
  const circle = data.skills.find((s) => s.id === 'healing_circle');

  function circleScene() {
    const caster = { ...makeHealer('Heal'), skills: ['healing_circle'], currentHP: 18 };
    const caravan = createCaravanUnit('act2', { col: 4, row: 6 }); // distance 2
    caravan.currentHP = 5;
    const farRecruit = makeRecruit('Tess', 4, 7, 5); // distance 3, outside radius 2
    const enemy = { name: 'Brigand', faction: 'enemy', col: 5, row: 4, currentHP: 3 };
    enemy.stats = { HP: 20 };
    const scene = makeScene({
      playerUnits: [caster],
      npcUnits: [caravan, farRecruit],
      enemyUnits: [enemy],
    });
    scene.getUnitAt = () => null;
    scene._getTier5HostileUnitsFor = () => scene.enemyUnits;
    scene.showMinorHintAt = vi.fn();
    scene._combatFx = { playHeal: vi.fn() };
    scene.hideActionMenu = vi.fn();
    scene.commitVisionSnapshotIfPending = vi.fn();
    return { scene, caster, caravan, farRecruit, enemy };
  }

  it('counts a wounded caravan as a target and restores it like an ally', async () => {
    const { scene, caster, caravan, farRecruit, enemy } = circleScene();
    const abilities = new AbilityController(scene);
    // The caster is at full HP: the caravan alone makes the circle worth using.
    expect(abilities._getAbilityEntries(caster)).toEqual([
      expect.objectContaining({ hasTargets: true, canUse: true }),
    ]);
    await abilities.executeSelfCentered(caster, circle);
    expect(caravan.currentHP).toBe(20); // 5 + 15
    expect(farRecruit.currentHP).toBe(5);
    expect(enemy.currentHP).toBe(3);
    expect(caster._battleDeeds.healed).toBe(15);
    expect(scene.finishUnitAction).toHaveBeenCalledWith(caster);
  });

  it('with only full-HP units around, has nothing to do', () => {
    const { scene, caster, caravan } = circleScene();
    caravan.currentHP = caravan.stats.HP;
    expect(new AbilityController(scene)._getAbilityEntries(caster)).toEqual([
      expect.objectContaining({ hasTargets: false }),
    ]);
  });
});

describe('enemy healers', () => {
  it('never mend the caravan, even when it is the only wounded unit in reach', async () => {
    const staff = weapon('Heal');
    const healer = {
      name: 'Cleric',
      faction: 'enemy',
      col: 1,
      row: 1,
      mov: 2,
      moveType: 'Infantry',
      aiMode: 'heal',
      currentHP: 20,
      stats: { HP: 20, MAG: 5 },
      weapon: staff,
      inventory: [staff],
      proficiencies: [{ type: 'Staff', rank: 'Prof' }],
    };
    const caravan = createCaravanUnit('act2', { col: 2, row: 1 });
    caravan.currentHP = 4;
    const ai = new AIController({ getMovementRange: () => new Map() }, data);
    ai._delay = async () => {};
    const onHeal = vi.fn();
    await ai._processOneEnemy(healer, [healer], [], [caravan], {
      onHeal,
      onAttack: vi.fn(),
      onUnitDone: vi.fn(),
    });
    expect(onHeal).not.toHaveBeenCalled();
    expect(ai.applyHealDecision(healer, caravan, staff)).toBeNull();
    expect(caravan.currentHP).toBe(4);
    expect(staff._usesSpent || 0).toBe(0);
  });
});

describe('a caravan heal on the battle timeline (production checkpoint and restore)', () => {
  let storage;
  beforeEach(() => {
    pickers.length = 0;
    storage = new JourneyStorage();
    vi.stubGlobal('localStorage', storage);
    installSeed(42);
  });
  afterEach(() => {
    restoreMathRandom();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function fixture() {
    const driver = new RunDriver(storage, { seed: 42 });
    const run = driver.run;
    run.visionChargesRemaining = 3;
    run.beginBattleInProgress(run.nodeMap.nodes[0].id, { battleParams: {} });
    const scene = journeyBattleScene(run, driver.data);
    scene.grid.fogEnabled = false;
    scene.grid.showHealRange = () => {};
    scene.animateHeal = async () => {};
    scene.playerUnits = structuredClone(run.roster.slice(0, 2));
    scene.playerUnits.forEach((unit, index) => {
      delete unit.battleEntityId;
      Object.assign(unit, { col: 1, row: index, faction: 'player', isCommander: index === 0 });
      unit.currentHP = unit.stats.HP; // only the caravan is hurt
      scene.addUnitGraphic(unit);
    });
    scene._battleCommanderId = scene.playerUnits[0].battleEntityId;
    const caravan = createCaravanUnit('act2', { col: 2, row: 1 });
    caravan.currentHP = 9;
    scene.npcUnits.push(caravan);
    scene.addUnitGraphic(caravan);
    scene._visionController = new VisionRewindController(scene, run);
    vi.spyOn(scene._visionController, 'playRewindEffect').mockImplementation(() => {});
    scene.captureVisionSnapshot();
    scene._timelineBoundary = 'turn_start';
    expect(scene._captureSuspendCheckpoint()).toBe(true);
    return { driver, run, scene };
  }

  const caravanOf = (scene) => scene.npcUnits.find((u) => u.isCaravan);
  const heal = (unit) => unit.inventory.find((w) => w.name === 'Heal');

  it('a heal on the Merchant saves, resumes and rewinds exactly', async () => {
    const { driver, scene } = fixture();
    const sera = scene.playerUnits.find((u) => u.name === 'Sera');
    expect(sera.stats.MAG).toBe(6); // Heal: 6 + 5 = 11
    const xpBefore = sera.xp;
    const errors = vi.spyOn(console, 'error');

    const targets = scene.findHealTargets(sera, heal(sera));
    expect(targets).toEqual([caravanOf(scene)]);
    scene.startHealTargetSelection(sera, targets, heal(sera));
    await scene.executeHeal(sera, caravanOf(scene));

    expect(errors).not.toHaveBeenCalled();
    expect(caravanOf(scene).currentHP).toBe(20);
    expect(heal(sera)._usesSpent).toBe(1);
    expect(sera.hasActed).toBe(true);
    expect(sera.xp).toBeGreaterThan(xpBefore);

    // The suspend checkpoint holds the healed caravan; a resume restores it exactly.
    const saved = loadRun(driver.data, 1);
    const checkpoint = saved.battleInProgress.checkpoint;
    expect(checkpoint.npcUnits).toEqual([
      expect.objectContaining({ isCaravan: true, faction: 'npc', currentHP: 20 }),
    ]);
    const resumed = journeyBattleScene(saved, driver.data);
    const resume = new BattleSuspendController(resumed);
    resume.applyUnits(checkpoint);
    resume.finalizeResume(checkpoint);
    expect(caravanOf(resumed)).toMatchObject({ isCaravan: true, currentHP: 20 });
    const resumedSera = resumed.playerUnits.find((u) => u.name === 'Sera');
    expect(heal(resumedSera)._usesSpent).toBe(1);

    // The timeline names the heal on the Merchant; rewinding before it restores
    // the caravan's HP, the staff use and the healer's XP together.
    scene.battleState = 'PLAYER_IDLE';
    expect(scene._visionController.requestRewind({ force: true })).toBe(true);
    const { rows } = pickers.at(-1).options.listing;
    expect(rows[0].action).toMatchObject({ actor: 'Sera', verb: 'heal', target: 'Merchant' });
    expect(rows[0].chips).toContainEqual(expect.objectContaining({ text: '+11 HP' }));
    pickers.at(-1).options.onConfirm(rows[0].id);
    expect(caravanOf(scene)).toMatchObject({ isCaravan: true, currentHP: 9 });
    const rewoundSera = scene.playerUnits.find((u) => u.name === 'Sera');
    expect(heal(rewoundSera)._usesSpent || 0).toBe(0);
    expect(rewoundSera.xp).toBe(xpBefore);
    expect(rewoundSera.hasActed).toBeFalsy();
  });
});
