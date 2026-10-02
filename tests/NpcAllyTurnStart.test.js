// NPC allies (the merchant caravan, recruit NPCs: scene.npcUnits) take the army's
// phase effects as the army's allies, resolved after the army (armyAndNpcAllies):
//   player phase start  status recovery, acid ticks, Renewal / Renewal Aura, forts
//   player phase end    lava cracks (5, never below 1 HP) and acid ground
// Enemies keep their own phase timing.
//
// Expected values are derived by hand from data/skills.json (Renewal Aura: 3 HP to
// allies in range 1), utils/constants.js (forts: floor(10% max HP) with the
// 1 / 0.67 / ... streak decay; lava 5; acid ceil(5% max HP), both floored at 1 HP)
// and CaravanSystem (caravan HP 18 + 4 × act number).
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
import { CaravanController } from '../src/ui/CaravanController.js';
import { armyAndNpcAllies } from '../src/engine/RecruitNpc.js';
import { hasCondition } from '../src/engine/StatusConditionSystem.js';
import { VisionRewindController } from '../src/ui/VisionRewindController.js';
import { BattleSuspendController } from '../src/ui/BattleSuspendController.js';
import { HeadlessBattle } from './harness/HeadlessBattle.js';
import { RunDriver, JourneyStorage } from './harness/RunDriver.js';
import { journeyBattleScene } from './harness/JourneyBattleScene.js';
import { loadRun } from '../src/engine/RunManager.js';
import { installSeed, restoreMathRandom } from '../sim/lib/SeededRNG.js';
import { TERRAIN } from '../src/utils/constants.js';
import { UI_PALETTE } from '../src/utils/uiStyles.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const P = TERRAIN.Plain;

function unit(name, faction, col, row, currentHP, HP, extra = {}) {
  return {
    name,
    faction,
    col,
    row,
    currentHP,
    stats: { HP, STR: 5, MAG: 0, SKL: 5, SPD: 5, LCK: 5, DEF: 3, RES: 3, MOV: 5 },
    skills: [],
    inventory: [],
    moveType: 'Infantry',
    ...extra,
  };
}
const sera = (col, row, extra) =>
  unit('Sera', 'player', col, row, 18, 18, { skills: ['renewal_aura'], ...extra });
const recruit = (name, col, row, currentHP, HP = 24) =>
  unit(name, 'npc', col, row, currentHP, HP, { className: 'Cavalier' });
const enemy = (col, row, currentHP, HP = 20) => unit('Brigand', 'enemy', col, row, currentHP, HP);
const caravanAt = (col, row, currentHP, act = 'act2') => {
  const caravan = createCaravanUnit(act, { col, row });
  caravan.currentHP = currentHP;
  return caravan;
};

/** A BattleScene with its real phase pipeline; only presentation is stubbed. */
function phaseScene({ playerUnits = [], npcUnits = [], enemyUnits = [], layout, visible } = {}) {
  const scene = new BattleScene();
  const delayed = [];
  Object.assign(scene, {
    _battleSession: 1,
    scene: { isActive: () => true },
    battleParams: {},
    battleConfig: { objective: 'rout' },
    battleState: 'PLAYER_IDLE',
    playerUnits,
    npcUnits,
    enemyUnits,
    gameData: data,
    turnPar: null,
    turnCounterText: null,
    registry: { get: () => null },
    turnManager: { currentPhase: 'player', turnNumber: 3, endPlayerPhase: vi.fn() },
    grid: {
      fogEnabled: Boolean(visible),
      isVisible: (col, row) => !visible || visible.has(`${col},${row}`),
      mapLayout: layout || Array.from({ length: 8 }, () => Array(8).fill(P)),
      updateFogOfWar: vi.fn(),
      tickTemporaryTerrains: vi.fn(),
      gridToPixel: () => ({ x: 0, y: 0 }),
    },
    _scheduleSafeDelayedAsync: (ms, label, cb) => delayed.push({ ms, label, cb }),
    showPhaseBanner: vi.fn(),
    dangerZone: { hide: vi.fn() },
    undimUnit: vi.fn(),
    dimUnit: vi.fn(),
    captureVisionSnapshot: vi.fn(),
    _captureSuspendCheckpoint: vi.fn(),
    updateVisionHud: vi.fn(),
    updateEnemyVisibility: vi.fn(),
    refreshEndTurnControl: vi.fn(),
    updateAntiTurtlePressure: vi.fn(),
    processBallistaFire: vi.fn(async () => {}),
    processZombieRevival: vi.fn(async () => {}),
    applyDueHybridOverridesForTurn: vi.fn(),
    updateHPBar: vi.fn(),
    animateHeal: vi.fn(async () => {}),
    showTerrainDamage: vi.fn(async () => {}),
    showAcidDamage: vi.fn(async () => {}),
    showBriefBanner: vi.fn(async () => {}),
    showMinorHintAt: vi.fn(),
    _addConditionIcon: vi.fn(),
    _removeConditionIcon: vi.fn(),
    _combatFx: { playStatus: vi.fn() },
  });
  // The enemy phase proper (caravan step, AI) is out of scope: record the HP it sees.
  scene.startEnemyPhase = vi.fn(async () => {
    scene.hpAtEnemyPhase = [...scene.playerUnits, ...scene.npcUnits, ...scene.enemyUnits].map(
      (u) => u.currentHP,
    );
  });
  const run = async (label) => {
    const entry = delayed.find((d) => d.label === label);
    expect(entry, label).toBeDefined();
    delayed.length = 0;
    await entry.cb();
  };
  scene.startPlayerTurn = async (turn = scene.turnManager.turnNumber) => {
    Object.assign(scene.turnManager, { currentPhase: 'player', turnNumber: turn });
    scene.onPhaseChange('player', turn);
    await run('player_phase_turn_start_pipeline');
    expect(scene.battleState).toBe('PLAYER_IDLE');
  };
  scene.endPlayerTurn = async (turn = scene.turnManager.turnNumber) => {
    Object.assign(scene.turnManager, { currentPhase: 'enemy', turnNumber: turn });
    scene.onPhaseChange('enemy', turn);
    await run('enemy_phase_turn_start_pipeline');
    expect(scene.startEnemyPhase).toHaveBeenCalled();
  };
  return scene;
}

describe('the army and its NPC allies', () => {
  it('lists the army first, then the living NPC allies, never enemies or the removed', () => {
    const army = [sera(0, 0)];
    const caravan = caravanAt(1, 0, 10);
    const fallen = recruit('Lyle', 2, 0, 0);
    const leaving = { ...recruit('Mira', 3, 0, 5), _removing: true };
    const garrick = recruit('Garrick', 4, 0, 5);
    const stray = { ...enemy(5, 0, 5), faction: 'enemy' };
    expect(armyAndNpcAllies(army, [caravan, fallen, leaving, stray, garrick])).toEqual([
      army[0],
      caravan,
      garrick,
    ]);
  });
});

describe('player turn start', () => {
  it("Sera's Renewal Aura mends adjacent wounded NPC allies, never an enemy or a far one", async () => {
    const healer = sera(4, 4);
    const caravan = caravanAt(4, 5, 20); // act 2: 26 HP, adjacent
    const garrick = recruit('Garrick', 3, 4, 10); // adjacent, 24 HP
    const rowan = recruit('Rowan', 4, 6, 10); // 2 tiles away: outside range 1
    const foe = enemy(5, 4, 5); // adjacent enemy
    const scene = phaseScene({
      _battleSession: 1,
      playerUnits: [healer],
      npcUnits: [caravan, garrick, rowan],
      enemyUnits: [foe],
    });
    expect(caravan.stats.HP).toBe(26);

    await scene.startPlayerTurn();

    expect(caravan.currentHP).toBe(23); // 20 + 3
    expect(garrick.currentHP).toBe(13); // 10 + 3
    expect(rowan.currentHP).toBe(10);
    expect(foe.currentHP).toBe(5);
    expect(scene.animateHeal.mock.calls).toEqual([
      [caravan, 3],
      [garrick, 3],
    ]);
    expect(scene.updateHPBar).toHaveBeenCalledWith(caravan);
    // The caravan stays an NPC: never folded into the army by its turn start.
    expect(scene.playerUnits).toEqual([healer]);
    expect(caravan.faction).toBe('npc');
  });

  it('the aura mends only what is missing and heals the army exactly as before', async () => {
    const healer = sera(4, 4);
    const edric = unit('Edric', 'player', 4, 3, 10, 20);
    const caravan = caravanAt(5, 4, 25); // 1 HP missing
    const scene = phaseScene({ playerUnits: [healer, edric], npcUnits: [caravan] });
    await scene.startPlayerTurn();
    expect(edric.currentHP).toBe(13);
    expect(caravan.currentHP).toBe(26);
    // Army first, NPC after: the army's heals keep their place in the sequence.
    expect(scene.animateHeal.mock.calls).toEqual([
      [edric, 3],
      [caravan, 1],
    ]);
  });

  it('a recruit NPC with Renewal mends itself, and an NPC aura mends the army', async () => {
    const edric = unit('Edric', 'player', 2, 2, 10, 20);
    const bishop = recruit('Oswin', 2, 3, 20, 30);
    bishop.skills = ['renewal', 'renewal_aura'];
    const scene = phaseScene({ playerUnits: [edric], npcUnits: [bishop] });
    await scene.startPlayerTurn();
    expect(bishop.currentHP).toBe(23); // Renewal: floor(30 × 10%) = 3
    expect(edric.currentHP).toBe(13); // its aura: 3
  });

  it('a Fort heals an NPC ally standing on it, with the same streak decay as the army', async () => {
    const layout = Array.from({ length: 8 }, () => Array(8).fill(P));
    layout[1][1] = TERRAIN.Fort;
    layout[5][5] = TERRAIN.Throne;
    layout[6][6] = TERRAIN.Fort;
    const caravan = caravanAt(1, 1, 10); // 26 HP: floor(2.6) = 2, then floor(2 × 0.67) = 1
    const garrick = recruit('Garrick', 5, 5, 4, 24); // throne: floor(2.4) = 2
    const foe = enemy(6, 6, 5); // an enemy on a fort waits for its own phase
    const scene = phaseScene({
      _battleSession: 1,
      playerUnits: [sera(0, 7)],
      npcUnits: [caravan, garrick],
      enemyUnits: [foe],
      layout,
    });

    await scene.startPlayerTurn(3);
    expect(caravan.currentHP).toBe(12);
    expect(garrick.currentHP).toBe(6);
    expect(foe.currentHP).toBe(5);
    expect(caravan._fortHealStreak).toBe(1);

    await scene.startPlayerTurn(4);
    expect(caravan.currentHP).toBe(13);
    expect(foe.currentHP).toBe(5);
  });

  it('an NPC ally the fog hides is mended unseen; the recruit, always in view, is shown', async () => {
    const layout = Array.from({ length: 8 }, () => Array(8).fill(P));
    layout[6][6] = TERRAIN.Fort;
    layout[1][6] = TERRAIN.Fort;
    const hidden = caravanAt(6, 6, 10); // 26 HP: floor(2.6) = 2, then floor(2 × 0.67) = 1
    const garrick = recruit('Garrick', 6, 1, 4, 24); // fort: floor(2.4) = 2
    const visible = new Set(['0,0', '0,1']);
    const scene = phaseScene({
      playerUnits: [sera(0, 0)],
      npcUnits: [hidden, garrick],
      layout,
      visible,
    });
    await scene.startPlayerTurn();
    expect(hidden.currentHP).toBe(12);
    expect(garrick.currentHP).toBe(6);
    // The caravan's tile is fogged: no effect gives it away. The recruit is always
    // in view (its banner and sprite stand above the fog), so its heal shows.
    expect(scene.animateHeal.mock.calls).toEqual([[garrick, 2]]);
    visible.add('6,6');
    await scene.startPlayerTurn(4);
    expect(hidden.currentHP).toBe(13);
    expect(scene.animateHeal).toHaveBeenCalledWith(hidden, 1);
  });
});

describe('player phase end: terrain hazards', () => {
  it('lava cracks burn NPC allies for 5 before the caravan steps, never below 1 HP', async () => {
    const layout = Array.from({ length: 8 }, () => Array(8).fill(P));
    for (const [col, row] of [
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 4],
    ])
      layout[row][col] = TERRAIN.LavaCrack;
    const edric = unit('Edric', 'player', 1, 1, 10, 20);
    const caravan = caravanAt(2, 2, 12);
    const garrick = recruit('Garrick', 3, 3, 3);
    const foe = enemy(4, 4, 15); // burns at the end of its own phase instead
    const scene = phaseScene({
      _battleSession: 1,
      playerUnits: [edric],
      npcUnits: [caravan, garrick],
      enemyUnits: [foe],
      layout,
    });

    await scene.endPlayerTurn();

    expect(edric.currentHP).toBe(5);
    expect(caravan.currentHP).toBe(7);
    expect(garrick.currentHP).toBe(1); // 3 - 5, floored at 1: lava never kills
    expect(foe.currentHP).toBe(15);
    // Resolved before the enemy phase proper (the caravan's step, then the AI).
    expect(scene.hpAtEnemyPhase).toEqual([5, 7, 1, 15]);
    expect(scene.showTerrainDamage.mock.calls).toEqual([
      [edric, 5],
      [caravan, 5],
      [garrick, 2],
    ]);
  });

  it('a caravan on lava at 1 HP stays 1 HP and still counts as surviving', async () => {
    const layout = Array.from({ length: 8 }, () => Array(8).fill(P));
    layout[2][2] = TERRAIN.LavaCrack;
    const caravan = caravanAt(2, 2, 1);
    const scene = phaseScene({ playerUnits: [sera(0, 0)], npcUnits: [caravan], layout });
    scene.battleConfig.caravanSpawn = { col: 2, row: 2 };
    await scene.endPlayerTurn();
    expect(caravan.currentHP).toBe(1);
    expect(scene.showTerrainDamage).not.toHaveBeenCalled();
    expect(new CaravanController(scene).caravanSurvived()).toBe(true);
  });

  it('acid ground corrodes an NPC ally, which then ticks and recovers at player turn starts', async () => {
    const layout = Array.from({ length: 8 }, () => Array(8).fill(P));
    layout[3][3] = TERRAIN.AcidicBog;
    const garrick = recruit('Garrick', 3, 3, 20, 24);
    const scene = phaseScene({ playerUnits: [sera(0, 0)], npcUnits: [garrick], layout });

    await scene.endPlayerTurn(3);
    expect(garrick._conditions).toEqual([{ id: 'acid', turnsRemaining: 3 }]);
    expect(scene._addConditionIcon).toHaveBeenCalledWith(garrick, 'acid');

    garrick.col = 4; // stepped off the bog (it would re-corrode each phase end)
    await scene.startPlayerTurn(4);
    expect(garrick.currentHP).toBe(18); // ceil(24 × 5%) = 2
    expect(scene.showAcidDamage).toHaveBeenCalledWith(garrick, 2);
    await scene.startPlayerTurn(5);
    expect(garrick.currentHP).toBe(16);
    await scene.startPlayerTurn(6); // third tick of 3: acid ends before it bites
    expect(garrick.currentHP).toBe(16);
    expect(hasCondition(garrick, 'acid')).toBe(false);
    expect(scene._removeConditionIcon).toHaveBeenCalledWith(garrick, 'acid');
  });

  it('an NPC status from an enemy art runs out at player turn starts like the army’s', async () => {
    const garrick = recruit('Garrick', 3, 3, 20);
    garrick._conditions = [{ id: 'root', turnsRemaining: 2, recoveryChance: 0 }];
    const scene = phaseScene({ playerUnits: [sera(0, 0)], npcUnits: [garrick] });
    await scene.startPlayerTurn(3);
    expect(garrick._conditions).toEqual([{ id: 'root', turnsRemaining: 1, recoveryChance: 0 }]);
    await scene.startPlayerTurn(4);
    expect(garrick._conditions).toEqual([]);
    expect(scene.showBriefBanner).toHaveBeenCalledWith('Garrick can move again!', UI_PALETTE.good);
  });
});

describe('headless harness mirror', () => {
  function battle() {
    const roster = [
      {
        ...sera(0, 0),
        className: 'Cleric',
        proficiencies: [{ type: 'Staff', rank: 'Prof' }],
      },
    ];
    const b = new HeadlessBattle(data, { act: 'act1', objective: 'rout' }, roster);
    b.init();
    return b;
  }

  it('mends an adjacent NPC ally at player turn start and burns one on lava at phase end', async () => {
    const b = battle();
    const healer = b.playerUnits[0];
    healer.isCommander = true;
    b.turnManager.turnNumber = 2;
    const caravan = caravanAt(healer.col + 1, healer.row, 10);
    b.npcUnits.push(caravan);
    b._onPhaseChange('player', 2);
    expect(caravan.currentHP).toBe(13);

    b.grid.mapLayout[caravan.row][caravan.col] = TERRAIN.LavaCrack;
    // The harness steps the caravan at the start of the enemy phase, as the scene does.
    // Wall it in (ahead and to both sides of its eastward exit) so it holds still beside
    // the healer.
    caravan.caravanExit = { dc: 1, dr: 0 };
    for (const [dc, dr] of [
      [1, 0],
      [0, -1],
      [0, 1],
    ]) {
      const row = b.grid.mapLayout[caravan.row + dr];
      if (row && caravan.col + dc < row.length) row[caravan.col + dc] = TERRAIN.Wall;
    }
    b.aiController.processEnemyPhase = async () => {}; // no AI turn: only the hazards
    b.turnManager.currentPhase = 'enemy';
    await b._processEnemyPhase();
    // 13 - 5 lava at the end of turn 2, then turn 3's aura: + 3.
    expect(b.turnManager.turnNumber).toBe(3);
    expect(caravan.currentHP).toBe(11);
  });
});

describe('an NPC turn-start heal on the battle timeline (production checkpoint and restore)', () => {
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

  it('the aura heal on the Merchant is in the turn-start checkpoint, and a rewind to it restores it exactly', async () => {
    const driver = new RunDriver(storage, { seed: 42 });
    const run = driver.run;
    run.visionChargesRemaining = 3;
    run.beginBattleInProgress(run.nodeMap.nodes[0].id, { battleParams: {} });
    const scene = journeyBattleScene(run, driver.data);
    scene.grid.fogEnabled = false;
    scene.grid.showHealRange = () => {};
    scene.animateHeal = async () => {};
    scene.playerUnits = structuredClone(run.roster.slice(0, 2));
    scene.playerUnits.forEach((u, index) => {
      delete u.battleEntityId;
      Object.assign(u, { col: 1, row: index, faction: 'player', isCommander: index === 0 });
      u.currentHP = u.stats.HP;
      scene.addUnitGraphic(u);
    });
    scene._battleCommanderId = scene.playerUnits[0].battleEntityId;
    const seraUnit = scene.playerUnits.find((u) => u.name === 'Sera');
    expect(seraUnit.skills).toContain('renewal_aura');
    expect(seraUnit.row).toBe(1);
    const caravan = caravanAt(2, 1, 9); // adjacent to Sera at (1,1)
    scene.npcUnits.push(caravan);
    scene.addUnitGraphic(caravan);
    scene._visionController = new VisionRewindController(scene, run);
    vi.spyOn(scene._visionController, 'playRewindEffect').mockImplementation(() => {});
    // Presentation the journey fixture leaves out.
    const delayed = [];
    Object.assign(scene, {
      scene: { isActive: () => true },
      showPhaseBanner: () => {},
      dangerZone: { hide: () => {} },
      undimUnit: () => {},
      showBriefBanner: async () => {},
      processBallistaFire: async () => {},
      _scheduleSafeDelayedAsync: (ms, label, cb) => delayed.push({ label, cb }),
    });
    const errors = vi.spyOn(console, 'error');

    // Turn 2 begins: the production pipeline heals the caravan, then records the
    // playable turn boundary (Vision snapshot + suspend checkpoint).
    Object.assign(scene.turnManager, { currentPhase: 'player', turnNumber: 2 });
    scene.onPhaseChange('player', 2);
    await delayed.find((d) => d.label === 'player_phase_turn_start_pipeline').cb();
    expect(errors).not.toHaveBeenCalled();
    expect(scene.battleState).toBe('PLAYER_IDLE');
    const merchant = () => scene.npcUnits.find((u) => u.isCaravan);
    expect(merchant().currentHP).toBe(12); // 9 + 3

    const saved = loadRun(driver.data, 1);
    const checkpoint = saved.battleInProgress.checkpoint;
    expect(checkpoint.npcUnits).toEqual([
      expect.objectContaining({ isCaravan: true, currentHP: 12 }),
    ]);
    const resumed = journeyBattleScene(saved, driver.data);
    const resume = new BattleSuspendController(resumed);
    resume.applyUnits(checkpoint);
    resume.finalizeResume(checkpoint);
    expect(resumed.npcUnits.find((u) => u.isCaravan)).toMatchObject({ currentHP: 12 });

    // Sera then mends it with her staff; rewinding before that action returns
    // to the turn-start state: the aura heal kept, never applied twice or lost.
    const heal = seraUnit.inventory.find((w) => w.name === 'Heal');
    scene.startHealTargetSelection(seraUnit, scene.findHealTargets(seraUnit, heal), heal);
    await scene.executeHeal(seraUnit, merchant());
    expect(merchant().currentHP).toBe(23); // 12 + MAG 6 + 5
    scene.battleState = 'PLAYER_IDLE';
    expect(scene._visionController.requestRewind({ force: true })).toBe(true);
    const { rows } = pickers.at(-1).options.listing;
    expect(rows[0].action).toMatchObject({ actor: 'Sera', verb: 'heal', target: 'Merchant' });
    pickers.at(-1).options.onConfirm(rows[0].id);
    expect(merchant()).toMatchObject({ isCaravan: true, currentHP: 12 });
    expect(errors).not.toHaveBeenCalled();
  });
});
