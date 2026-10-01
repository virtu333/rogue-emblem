import { afterEach, describe, expect, it, vi } from 'vitest';
import './harness/JourneyTestSetup.js';
vi.mock('../src/utils/errorReporter.js', () => ({ reportAsyncError: vi.fn() }));

import { reportAsyncError } from '../src/utils/errorReporter.js';
import { journeyBattleScene } from './harness/JourneyBattleScene.js';
import { presentationFailureProxy } from './harness/PresentationFailureProxy.js';
import { JourneyStorage, RunDriver } from './harness/RunDriver.js';
import { BattleScene } from '../src/scenes/BattleScene.js';
import { createBattleRng } from '../src/engine/BattleRng.js';
import { Grid } from '../src/engine/Grid.js';
import { TurnManager } from '../src/engine/TurnManager.js';
import { RunManager } from '../src/engine/RunManager.js';
import { BattleSuspendController } from '../src/ui/BattleSuspendController.js';
import { serializeBattleUnit } from '../src/engine/BattleUnitState.js';
import { equipAccessory, unequipAccessory } from '../src/engine/UnitManager.js';
import { _resetUidCounter } from '../src/utils/itemUid.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const originalRandom = Math.random;
const plain = data.terrain.find((entry) => entry.name === 'Plain');
const sword = {
  name: 'Test Sword',
  type: 'Sword',
  might: 5,
  hit: 100,
  crit: 0,
  weight: 0,
  range: '1',
};
const axe = { name: 'Test Axe', type: 'Axe', might: 8, hit: 100, crit: 0, weight: 0, range: '1' };
const robe = () => structuredClone(data.accessories.find((entry) => entry.name === 'Seraph Robe'));

afterEach(() => {
  Math.random = originalRandom;
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('checkpoint retry saves the frozen result with a fresh timestamp, without rerolling combat', async () => {
  const { scene, storage, attacker, defender } = fixture('plain kill');
  storage.failWrites = true;
  const pending = scene.executeCombat(attacker, defender);
  expect(scene._saveRetry.isBlocking()).toBe(true);
  scene._saveRetry.keepPlaying();
  await pending;
  expect(scene._checkpointPersistenceResult.ok).toBe(false);
  const checkpoint = model(scene.runManager.battleInProgress.checkpoint);
  const cursor = scene._battleRng.getState();
  const state = model({ attacker, defender, gold: scene.goldEarned });
  const oldTimestamp = JSON.parse(storage.getItem('emblem_rogue_slot_1_run')).savedAt;
  storage.failWrites = false;
  Date.now.mockReturnValue(oldTimestamp + 1000);
  expect(scene._battleSuspendController.retryCheckpoint({ session: 1 }).ok).toBe(true);
  const durable = JSON.parse(storage.getItem('emblem_rogue_slot_1_run'));
  expect(durable.savedAt).toBe(oldTimestamp + 1000);
  expect(model(durable.battleInProgress.checkpoint)).toEqual(checkpoint);
  expect(scene._battleRng.getState()).toEqual(cursor);
  expect(model({ attacker, defender, gold: scene.goldEarned })).toEqual(state);
});

it(
  'failed committed-attack save blocks rolls and HP until Keep playing',
  { timeout: 20_000 },
  async () => {
    const { scene, storage, attacker, defender } = fixture('plain kill');
    const hp = [attacker.currentHP, defender.currentHP];
    const rng = scene._battleRng.getState();
    storage.failWrites = true;
    const work = scene.executeCombat(attacker, defender);
    await Promise.resolve();
    expect(scene._saveRetry.isBlocking()).toBe(true);
    expect([attacker.currentHP, defender.currentHP]).toEqual(hp);
    expect(scene._battleRng.getState()).toEqual(rng);
    scene._saveRetry.keepPlaying();
    await work;
    expect(defender.currentHP).toBe(0);
    expect(attacker.hasActed).toBe(true);
  },
);

it.each(['_fatalDecision', '_fatalCapturePending', '_defeatDecision', 'BATTLE_END'])(
  'committed save gate cannot resume combat after %s',
  { timeout: 20_000 },
  async (flag) => {
    const { scene, storage, attacker, defender } = fixture('plain kill');
    storage.failWrites = true;
    const hp = [attacker.currentHP, defender.currentHP];
    const cursor = scene._battleRng.getState();
    const work = scene.executeCombat(attacker, defender);
    if (flag === 'BATTLE_END') scene.battleState = flag;
    else scene[flag] = true;
    scene._saveRetry.update();
    await work;
    expect([attacker.currentHP, defender.currentHP]).toEqual(hp);
    expect(scene._battleRng.getState()).toEqual(cursor);
    expect(attacker.hasActed).toBe(false);
  },
);

it.each(['player', 'enemy'])(
  '%s entry reports a required-domain failure instead of masking it as presentation',
  async (side) => {
    const { scene, attacker, defender } = fixture(side === 'player' ? 'plain kill' : 'enemy kill');
    scene.buildSkillCtx = () => {
      throw new Error('Injected required-domain failure');
    };
    if (side === 'player') await scene.executeCombat(attacker, defender);
    else await scene.executeEnemyCombat(defender, attacker);
    expect(reportAsyncError.mock.calls.map(([context]) => context)).toEqual([
      'battle_combat_domain_error',
    ]);
    expect(defender.currentHP).toBe(side === 'player' ? 8 : 22);
    expect(scene._pendingCommittedAction ?? null).toBeNull();
    if (side === 'player') expect(attacker.hasActed).toBe(true);
  },
);

it('a real mid-strike tween timeout settles the same result and checkpoint', async () => {
  const expected = await run('Teleporter survives');
  const { scene, attacker, defender, calls } = fixture('Teleporter survives');
  vi.useFakeTimers();
  let timedOut = false;
  scene.tweens = {
    add: calls.call(() => ({ remove() {} }), 'stalled tween'),
  };
  scene._combatFx.lungeForward = calls.call(async () => {
    const outcome = await scene._awaitSceneTween({ duration: 10 }, { timeoutMs: 5 });
    timedOut = outcome.status === 'timed_out';
    // Every later tween finishes immediately; only this awaited renderer stalls.
    scene.tweens = { add: calls.call(() => {}, 'tweens.add') };
  }, 'fx.lungeForward');
  const pending = scene.executeCombat(attacker, defender);
  await vi.advanceTimersByTimeAsync(10);
  await pending;
  expect(timedOut).toBe(true);
  expect(
    model({
      attacker,
      defender,
      checkpoint: scene.runManager.battleInProgress.checkpoint,
      durable: JSON.parse(localStorage.getItem('emblem_rogue_slot_1_run')),
      rng: scene._battleRng.getState(),
    }),
  ).toEqual({
    attacker: expected.snapshot.attacker,
    defender: expected.snapshot.defender,
    checkpoint: expected.snapshot.checkpoint,
    durable: expected.snapshot.durable,
    rng: expected.snapshot.rng,
  });
  expect(reportAsyncError.mock.calls.map(([context]) => context)).toEqual([
    'battle_lifecycle_timeout',
  ]);
});

it.each(['player', 'enemy'])(
  '%s shutdown and immediate init during a real strike cannot mutate or save the replacement battle',
  async (side) => {
    const { scene, storage, attacker, defender, calls } = fixture(
      side === 'player' ? 'Teleporter survives' : 'enemy Teleporter',
    );
    if (side === 'enemy') {
      scene._enemyActionCheckpoint = true;
      scene._captureSuspendCheckpoint({ preserveRng: true, session: scene._battleSession });
      scene._enemyActionCheckpoint = false;
    }
    let release;
    scene._combatFx.lungeForward = calls.call(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
      'fx.lungeForward',
    );
    const pending =
      side === 'player'
        ? scene.executeCombat(attacker, defender)
        : scene.executeEnemyCombat(defender, attacker);
    for (let i = 0; i < 12; i++) await Promise.resolve();
    expect(release).toBeTypeOf('function');
    const durable = storage.getItem('emblem_rogue_slot_1_run');
    const writes = storage.writes;
    if (side === 'player')
      expect(JSON.parse(durable).battleInProgress.checkpoint.pendingCommittedAction.kind).toBe(
        'attack',
      );
    else expect(JSON.parse(durable).battleInProgress.checkpoint.phase).toBe('enemy');
    scene._sceneShutdownCleanedUp = true;
    scene._cancelLifecycleAwaits('scene_shutdown');
    scene.init({ gameData: data });
    scene.battleState = 'NEW_BATTLE';
    scene._selectedWeaponArt = 'new selection';
    scene._combatSpeedSnapshot = 3;
    const state = model({
      players: scene.playerUnits,
      enemies: scene.enemyUnits,
      state: scene.battleState,
      selected: scene._selectedWeaponArt,
      speed: scene._combatSpeedSnapshot,
    });
    release();
    await pending;
    expect(
      model({
        players: scene.playerUnits,
        enemies: scene.enemyUnits,
        state: scene.battleState,
        selected: scene._selectedWeaponArt,
        speed: scene._combatSpeedSnapshot,
      }),
    ).toEqual(state);
    expect(storage.getItem('emblem_rogue_slot_1_run')).toBe(durable);
    expect(storage.writes).toBe(writes);
    expect(reportAsyncError).not.toHaveBeenCalled();
  },
);

it('real strike contact observes settled Thorns HP before the final combat backstop', async () => {
  const { scene, attacker, defender } = fixture('Thorns');
  const contact = [];
  scene._combatFx.playImpact = () => contact.push([attacker.currentHP, defender.currentHP]);
  await scene.executeCombat(attacker, defender);
  expect(contact).toEqual([
    [17, 10],
    [7, 10],
  ]);
  expect([attacker.currentHP, defender.currentHP]).toEqual([7, 10]);
  expect(reportAsyncError).not.toHaveBeenCalled();
});

it.each(['fixed-v1', 'legacy-v1'])(
  'a serialized %s committed Teleporter attack resumes with the same outcome on this build',
  async (policy) => {
    const resumeFixture = () => {
      const result = fixture('Teleporter survives');
      result.scene._battleRewindPolicy = policy;
      result.scene.runManager.battleInProgress.rewindPolicy = policy;
      result.scene.reseedBattleRng = BattleScene.prototype.reseedBattleRng;
      if (policy === 'legacy-v1')
        // Legacy scene factories are genuinely unisolated; individual shipping
        // presentationText calls still isolate their own UUID draws.
        result.scene.add.text = result.calls.call(() => {
          Math.random();
          return result.calls.visual;
        }, 'add.text');
      return result;
    };
    const live = resumeFixture();
    // Resume relinks only proficient weapons; ordinary matrix weapons omit this
    // catalog field because they never cross the real load boundary.
    for (const unit of [...live.scene.playerUnits, ...live.scene.enemyUnits])
      unit.weapon.rankRequired = 'Prof';
    live.scene._commitCombatIntent(live.attacker, live.defender);
    const saved = JSON.parse(live.storage.getItem('emblem_rogue_slot_1_run'));
    expect(saved.battleInProgress.checkpoint).toMatchObject({
      rewindPolicy: policy,
      rngState: { algorithm: 'mulberry32-v1', cursor: 7 },
      pendingCommittedAction: { kind: 'attack' },
    });
    await live.scene.executeCombat(live.attacker, live.defender);
    const outcome = (scene) => {
      const checkpoint = structuredClone(scene.runManager.battleInProgress.checkpoint);
      // This envelope is used for fixed-v1 decision keys. Legacy captures leave
      // it unchanged, while finalizeResume fills it from the incoming checkpoint;
      // compare the legacy live stream and complete gameplay state separately.
      if (policy === 'legacy-v1') delete checkpoint.decisionRngState;
      return model({
        players: scene.playerUnits.map(serializeBattleUnit),
        enemies: scene.enemyUnits.map(serializeBattleUnit),
        gold: scene.goldEarned,
        rng: scene._battleRng.getState(),
        phase: scene.turnManager.currentPhase,
        state: scene.battleState,
        checkpoint,
      });
    };
    const expected = outcome(live.scene);

    const resumed = resumeFixture();
    resumed.scene.runManager = RunManager.fromJSON(saved, data);
    const checkpoint = resumed.scene.runManager.battleInProgress.checkpoint;
    resumed.scene.playerUnits = [];
    resumed.scene.enemyUnits = [];
    resumed.scene.npcUnits = [];
    const suspend = new BattleSuspendController(resumed.scene);
    resumed.scene._battleSuspendController = suspend;
    suspend.applyUnits(checkpoint);
    resumed.scene.turnManager.init(resumed.scene.playerUnits, resumed.scene.enemyUnits, []);
    let replay;
    resumed.scene._scheduleSafeDelayedAsync = (_delay, label, callback) => {
      expect(label).toBe('resume_committed_attack');
      replay = callback;
    };
    suspend.finalizeResume(checkpoint);
    expect(replay).toBeTypeOf('function');
    await replay();
    expect(outcome(resumed.scene)).toEqual(expected);
    const defender = resumed.scene.enemyUnits.find((entry) => entry.name === 'Enemy');
    expect([defender.currentHP, defender.col, defender.row]).toEqual([10, 4, 4]);
    if (policy === 'fixed-v1')
      expect(resumed.scene._battleRng.getState().cursor).toBe((7 + 4 * 0x6d2b79f5) >>> 0);
    else {
      expect(live.scene.runManager.battleInProgress.checkpoint.decisionRngState).toEqual(
        live.scene._battleRng.getState(),
      );
      expect(resumed.scene.runManager.battleInProgress.checkpoint.decisionRngState).toEqual({
        algorithm: 'mulberry32-v1',
        cursor: 7,
      });
    }
    expect(reportAsyncError).not.toHaveBeenCalled();
  },
);

it.each(['normal', 'position failure', 'fade-in failure'])(
  'a real Teleporter exchange restores each target alpha after %s',
  async (failure) => {
    const { scene, attacker, defender, calls } = fixture('Teleporter survives');
    const node = (alpha) => {
      const target = Object.assign(Object.create(calls.visual), { alpha });
      target.setAlpha = calls.call((value) => {
        target.alpha = value;
        return target;
      }, 'visual.setAlpha');
      return target;
    };
    defender.graphic = node(0.3);
    defender.label = node(0.4);
    defender.factionIndicator = node(0.5);
    defender.hpBar = { bg: node(0.6), fill: node(0.7) };
    const targets = [
      defender.graphic,
      defender.label,
      defender.factionIndicator,
      defender.hpBar.bg,
      defender.hpBar.fill,
    ];
    const alphas = targets.map((target) => target.alpha);
    scene.tweens = {
      add: calls.call((config) => {
        if (failure === 'fade-in failure' && typeof config.alpha === 'function')
          throw new Error('Injected fade-in scheduling failure');
        if (config.alpha !== undefined)
          for (const target of [config.targets].flat()) {
            target.alpha = typeof config.alpha === 'function' ? config.alpha(target) : config.alpha;
          }
        config.onComplete?.();
        return { remove() {} };
      }, 'tweens.add'),
    };
    if (failure === 'position failure')
      scene.updateUnitPosition = () => {
        throw new Error('Injected post-fade position draw failure');
      };
    await scene.executeCombat(attacker, defender);
    expect([defender.col, defender.row]).toEqual([4, 4]);
    expect(targets.map((target) => target.alpha)).toEqual(alphas);
    if (failure === 'normal') expect(reportAsyncError).not.toHaveBeenCalled();
    else {
      expect(reportAsyncError).toHaveBeenCalled();
      expect(reportAsyncError.mock.calls.map(([context]) => context)).not.toContain(
        'battle_combat_domain_error',
      );
    }
  },
);

it('real combat Canto supports Back, retap and Wait without repeating combat or its rewards', async () => {
  const { scene, attacker, defender, calls, storage } = fixture('Canto');
  await scene.executeCombat(attacker, defender);
  expect(scene.battleState).toBe('CANTO_MOVING');
  const combat = model({
    attackerHP: attacker.currentHP,
    defenderHP: defender.currentHP,
    xp: attacker.xp,
  });
  const saved = storage.getItem('emblem_rogue_slot_1_run');
  scene.tweens = {
    add: calls.call((config) => {
      config.onComplete?.();
      return {};
    }, 'Canto tween'),
  };
  scene.handleCantoClick({ col: 2, row: 3 });
  expect(scene.battleState).toBe('CANTO_CONFIRM');
  expect([attacker.col, attacker.row]).toEqual([2, 3]);
  scene.undoCantoMove();
  expect(scene.battleState).toBe('CANTO_MOVING');
  expect([attacker.col, attacker.row]).toEqual([2, 2]);
  scene.handleCantoClick({ col: 2, row: 3 });
  scene.handleCantoConfirmClick({ col: 1, row: 2 });
  expect(scene.battleState).toBe('CANTO_CONFIRM');
  expect([attacker.col, attacker.row]).toEqual([1, 2]);
  expect(storage.getItem('emblem_rogue_slot_1_run')).toBe(saved);
  scene.confirmCantoMove();
  const writes = storage.writes;
  scene.confirmCantoMove();
  expect(storage.writes).toBe(writes);
  expect(scene.battleState).toBe('PLAYER_IDLE');
  expect(
    model({ attackerHP: attacker.currentHP, defenderHP: defender.currentHP, xp: attacker.xp }),
  ).toEqual(combat);
  expect(
    JSON.parse(storage.getItem('emblem_rogue_slot_1_run')).battleInProgress.checkpoint
      .playerUnits[1],
  ).toMatchObject({ col: 1, row: 2, hasActed: true });
  expect(reportAsyncError).not.toHaveBeenCalled();
});

function unit(name, faction, col, row, extra = {}) {
  const weapon = structuredClone(faction === 'enemy' ? axe : sword);
  return {
    name,
    faction,
    col,
    row,
    level: 5,
    xp: 0,
    className: 'Fighter',
    moveType: 'Infantry',
    stats: {
      HP: faction === 'enemy' ? 22 : 20,
      STR: faction === 'enemy' ? 9 : 10,
      MAG: 0,
      SKL: 0,
      SPD: 6,
      DEF: faction === 'enemy' ? 4 : 6,
      RES: 1,
      LCK: 0,
      MOV: 5,
    },
    currentHP: faction === 'enemy' ? 22 : 20,
    growths: { HP: 0, STR: 0, MAG: 0, SKL: 0, SPD: 0, DEF: 0, RES: 0, LCK: 0 },
    proficiencies: [{ type: weapon.type, rank: 'Prof' }],
    skills: [],
    affixes: [],
    weapon,
    inventory: [weapon],
    consumables: [],
    hasActed: false,
    hasMoved: true,
    ...extra,
  };
}

// Strip only presentation references and wall-clock metadata. Keep the complete
// remaining unit, battle, continuation and durable checkpoint state.
const visualKeys = new Set([
  'graphic',
  'label',
  'factionIndicator',
  'hpBar',
  'affixPips',
  '_conditionIcons',
  'poisonIcon',
  'weaponArtIcon',
]);
const timeKeys = new Set(['savedAt', 'startedAt', 'capturedAt', 'timestamp', 'createdAt']);
function model(value) {
  if (value == null || typeof value !== 'object')
    return typeof value === 'function' ? undefined : value;
  if (value instanceof Set) return [...value].sort();
  if (value instanceof Map) return [...value.entries()].map(model);
  if (Array.isArray(value)) return value.map(model);
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key, val]) => !visualKeys.has(key) && !timeKeys.has(key) && typeof val !== 'function',
      )
      .map(([key, val]) => [key, model(val)]),
  );
}

function fixture(kind, failure = 0, world = 'shown') {
  _resetUidCounter();
  Math.random = createBattleRng(42);
  vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  reportAsyncError.mockClear();
  const storage = new JourneyStorage();
  vi.stubGlobal('localStorage', storage);
  const driver = new RunDriver(storage);
  driver.run.runRecordId = 'combat-boundary-run';
  driver.run.beginBattleInProgress(driver.run.nodeMap.nodes[0].id, { battleParams: {} });
  const scene = journeyBattleScene(driver.run, data);
  scene._clearCombatRollSession = BattleScene.prototype._clearCombatRollSession;
  scene._clearSelectedWeaponArt = BattleScene.prototype._clearSelectedWeaponArt;
  scene._battleSession = 1;
  scene._sceneShutdownCleanedUp = false;
  scene.scene = { isActive: () => world !== 'paused' };
  scene.sys = { isActive: () => world !== 'paused', settings: { active: world !== 'paused' } };
  scene.cameras = { main: { width: 640, height: 480, centerX: 320, centerY: 240 } };
  scene.textures = { exists: () => false };
  scene._pinToScreen = () => {};
  scene._battleRewindPolicy = 'fixed-v1';
  scene._battleRng = createBattleRng(kind === 'enemy Entity' ? 42 : 7);
  Math.random = scene._battleRng;
  Object.assign(scene.grid, {
    cols: 6,
    rows: 6,
    mapLayout: Array.from({ length: 6 }, () => Array(6).fill(0)),
    fogEnabled: false,
    getMoveCost: () => 1,
    getTerrainAt: () => plain,
    clearTemporaryTerrainsBySource() {},
    gridToPixel: (col, row) => ({ x: col * 32, y: row * 32 }),
  });
  scene.battleConfig = { objective: 'rout' };
  scene.goldEarned = 0;
  scene.checkBattleEnd = BattleScene.prototype.checkBattleEnd;
  scene.onVictory = () => {
    scene.result = 'victory';
    scene.battleState = 'BATTLE_END';
  };
  scene.onDefeat = () => {
    scene.result = 'defeat';
    scene.battleState = 'BATTLE_END';
  };
  const calls = presentationFailureProxy(scene, failure, {
    skipped: world === 'skipped' || world === 'paused',
  });
  const commander = unit('Edric', 'player', 0, 0, { isCommander: true, isLord: true });
  const attacker = unit('Fighter', 'player', 2, 2);
  const defender = unit('Enemy', 'enemy', 3, 2);
  const reserve = unit('Reserve', 'enemy', 0, 5);
  scene.playerUnits = [commander, attacker];
  scene.enemyUnits = [defender, reserve];
  if (kind.includes('Teleporter')) defender.affixes = ['teleporter'];
  if (kind === 'Teleporter lethal' || kind === 'plain kill' || kind === 'victory') {
    defender.level = 1;
    defender.currentHP = 8;
  }
  if (kind === 'victory') scene.enemyUnits = [defender];
  if (kind === 'Teleporter boxed')
    scene.grid.getMoveCost = (col, row) => (col === 3 && row === 2 ? 1 : Infinity);
  if (kind === 'Thorns') defender.affixes = ['thorns'];
  if (kind === 'drain debt') {
    attacker.weapon.special = 'Drains HP';
    equipAccessory(attacker, robe());
    attacker.currentHP = 1;
    unequipAccessory(attacker);
    expect(attacker._accessoryHpOwed).toBe(5);
    attacker.currentHP = 16;
  }
  if (kind === 'counter kills') attacker.currentHP = 1;
  if (kind === 'Deathburst' || kind === 'Deathburst Light bounty Zombie') {
    defender.level = 1;
    defender.currentHP = 8;
    defender.affixes = ['deathburst'];
    const secondary = unit('Secondary', 'enemy', 3, 3, { level: 1, currentHP: 2 });
    if (kind === 'Deathburst Light bounty Zombie') {
      defender.className = 'Zombie';
      secondary.className = 'Zombie';
      attacker.weapon.type = 'Light';
      attacker.weapon.special = null;
      attacker.stats.MAG = 10;
      attacker.proficiencies = [{ type: 'Light', rank: 'Prof' }];
      equipAccessory(
        attacker,
        structuredClone(data.accessories.find((entry) => entry.name === "Bounty Hunter's Mark")),
      );
    }
    scene.enemyUnits.push(secondary);
  }
  if (kind === 'poison') attacker.weapon.special = 'Poison: target loses 5 HP after combat';
  if (kind === 'brave double') {
    attacker.weapon.special = 'Attacks twice consecutively';
    attacker.stats.SPD = 15;
    defender.currentHP = 100;
    defender.stats.HP = 100;
  }
  if (kind === 'level-up') {
    attacker.level = 14;
    attacker.xp = 99;
    defender.level = 14;
  }
  if (kind === 'art Phoenix') {
    attacker.weapon.name = 'Iron Sword';
    attacker.weapon.weaponArtIds = ['sword_precise_cut'];
    attacker.stats.HP = 12;
    attacker.currentHP = 5;
    attacker.accessory = structuredClone(
      data.accessories.find((entry) => entry.name === 'Phoenix Brooch'),
    );
    defender.stats.DEF = 100;
    defender.stats.STR = 0;
    defender.weapon.might = 0;
    scene._selectedWeaponArt = {
      unitName: attacker.name,
      artId: 'sword_precise_cut',
      weaponIndex: 0,
    };
  }
  if (kind === 'Tier5 splash Zombie') {
    attacker.weapon = structuredClone(data.weapons.find((entry) => entry.name === 'Tidebreaker'));
    attacker.inventory = [attacker.weapon];
    attacker.proficiencies = [{ type: 'Axe', rank: 'Mast' }];
    attacker.currentHP = 100;
    attacker.stats.HP = 100;
    defender.currentHP = 100;
    defender.stats.HP = 100;
    scene._selectedWeaponArt = {
      unitName: attacker.name,
      artId: 'legend_cataclysm',
      weaponIndex: 0,
    };
    scene.enemyUnits.push(
      unit('Splash Zombie', 'enemy', 3, 3, { level: 1, currentHP: 5, className: 'Zombie' }),
      unit('Splash secondary', 'enemy', 4, 2, { level: 1, currentHP: 5 }),
    );
  }
  if (kind === 'Teleporter pierce') {
    attacker.weapon = structuredClone(data.weapons.find((entry) => entry.name === 'Oathlance'));
    attacker.inventory = [attacker.weapon];
    attacker.proficiencies = [{ type: 'Lance', rank: 'Mast' }];
    attacker.currentHP = 100;
    attacker.stats.HP = 100;
    defender.currentHP = 100;
    defender.stats.HP = 100;
    scene._selectedWeaponArt = {
      unitName: attacker.name,
      artId: 'legend_piercing_charge',
      weaponIndex: 0,
    };
    scene.enemyUnits.push(unit('Behind original tile', 'enemy', 4, 2));
  }
  if (kind === 'Canto') {
    attacker.skills = ['canto'];
    scene.grid.terrainData = data.terrain;
    scene.grid.getMovementRange = Grid.prototype.getMovementRange;
    scene.grid.reconstructIcePath = Grid.prototype.reconstructIcePath;
    scene.grid.findPath = Grid.prototype.findPath;
    scene._drawActionMenuRows = calls.call(() => {}, 'Canto menu');
    scene.time = { delayedCall: () => ({ remove() {} }) };
    scene.grid.showMovementRange = calls.call(() => {}, 'grid.showMovementRange');
  }
  if (kind === 'Gambit') {
    attacker.skills = ['commanders_gambit'];
    attacker.stats.SKL = 200;
    defender.stats.LCK = 200;
    defender.stats.SPD = 0;
    commander.col = 2;
    commander.row = 1;
    commander.hasActed = true;
  }
  if (kind === 'enemy counter kill') {
    defender.currentHP = 8;
    defender.weapon.might = 0;
  }
  if (kind === 'enemy kill') attacker.currentHP = 1;
  if (kind === 'enemy Entity') {
    Object.assign(defender, {
      name: 'The Entity',
      isEntity: true,
      _entityData: { width: 1, height: 1 },
      currentHP: 100,
      stats: { ...defender.stats, HP: 100 },
    });
    scene.playerUnits.push(
      unit('Splash victim 1', 'player', 2, 1, { currentHP: 1 }),
      unit('Splash victim 2', 'player', 1, 2, { currentHP: 1 }),
      unit('Splash victim 3', 'player', 2, 3, { currentHP: 1 }),
    );
  }
  for (const entry of [...scene.playerUnits, ...scene.enemyUnits]) {
    scene.addUnitGraphic(entry);
    if (world !== 'no sprites') {
      entry.graphic = entry.isEntity
        ? Object.assign(Object.create(calls.visual), { displayWidth: 92, displayHeight: 92 })
        : calls.visual;
      entry.hpBar = { bg: calls.visual, fill: calls.visual };
    }
  }
  if (kind === 'Teleporter fog') {
    // Use shipping fog/visibility rules, rather than the journey fixture's fixed
    // fog. The surviving defender moves from a visible tile to (4,4), outside
    // both infantry vision diamonds. Check at the next domain boundary: action
    // completion refreshes fog again and would hide a missing warp refresh.
    Object.assign(scene.grid, {
      scene,
      fogEnabled: true,
      visibleSet: new Set(),
      everSeenSet: new Set(),
      getVisionRange: Grid.prototype.getVisionRange,
      updateFogOfWar: Grid.prototype.updateFogOfWar,
      isVisible: Grid.prototype.isVisible,
    });
    scene.grid.updateFogOfWar(scene.playerUnits);
    scene.updateEnemyVisibility = BattleScene.prototype.updateEnemyVisibility;
    scene.refreshVisibleDangerZone = calls.call(
      BattleScene.prototype.refreshVisibleDangerZone.bind(scene),
      'refreshVisibleDangerZone',
    );
    // Keep renderer failures counted while observing its player-visible output.
    const graphic = Object.assign(Object.create(calls.visual), { visible: true });
    graphic.setVisible = calls.call((visible) => {
      graphic.visible = visible;
      return graphic;
    }, 'enemy.graphic.setVisible');
    if (world !== 'no sprites') defender.graphic = graphic;
    const postEffects = scene._applyResolvedCombatPostEffects.bind(scene);
    scene._applyResolvedCombatPostEffects = async (...args) => {
      scene._warpFogBoundary = {
        visible: [...scene.grid.visibleSet].sort(),
        seen: [...scene.grid.everSeenSet].sort(),
        warpVisible: scene.grid.isVisible(defender.col, defender.row),
        rng: scene._battleRng.getState(),
      };
      scene._warpGraphicVisible = graphic.visible;
      return postEffects(...args);
    };
  }
  scene.turnManager = new TurnManager({
    onPhaseChange: () => {},
    checkBattleEnd: () => scene.checkBattleEnd(),
  });
  scene.turnManager.init(scene.playerUnits, scene.enemyUnits, scene.npcUnits);
  if (kind.startsWith('enemy')) {
    scene.turnManager.currentPhase = 'enemy';
    scene.battleState = 'ENEMY_PHASE';
  }
  return { scene, storage, calls, attacker, defender };
}

async function run(kind, failure = 0, world = 'shown') {
  const fixtureState = fixture(kind, failure, world);
  const { scene, attacker, defender, storage, calls } = fixtureState;
  if (kind.startsWith('enemy')) {
    await scene.executeEnemyCombat(defender, attacker);
    if (!scene.result) {
      scene._enemyActionCheckpoint = true;
      scene._captureSuspendCheckpoint({ preserveRng: true, session: scene._battleSession });
      scene._enemyActionCheckpoint = false;
    }
  } else await scene.executeCombat(attacker, defender);
  const snapshot = model({
    players: scene.playerUnits,
    enemies: scene.enemyUnits,
    npcs: scene.npcUnits,
    attacker,
    defender,
    gold: scene.goldEarned,
    deaths: scene._playerDeathsThisBattle || 0,
    remains: scene._zombieTombstones || [],
    phase: scene.turnManager.currentPhase,
    turn: scene.turnManager.turnNumber,
    state: scene.battleState,
    result: scene.result,
    pendingAction: scene._pendingActionCompletion,
    committed: scene._pendingCommittedAction,
    popups: scene._pendingLevelUpPopups,
    visible: scene.grid.visibleSet,
    warpFogBoundary: scene._warpFogBoundary,
    rng: scene._battleRng.getState(),
    selectedArt: scene._selectedWeaponArt,
    rolls: scene._combatRollSession,
    checkpoint: scene.runManager.battleInProgress?.checkpoint,
    durable: JSON.parse(storage.getItem('emblem_rogue_slot_1_run')),
  });
  const errors = reportAsyncError.mock.calls.map(([context]) => context);
  return { ...fixtureState, snapshot, errors, count: calls() };
}

function assertOutcome(kind, result) {
  const { scene, attacker, defender } = result;
  if (kind === 'plain kill' || kind === 'Teleporter lethal' || kind === 'victory') {
    expect(defender.currentHP).toBe(0);
    expect(scene.enemyUnits).not.toContain(defender);
    expect(scene.goldEarned).toBe(36); // Level 1: 28 base + 8 per level.
    expect(attacker.currentHP).toBe(20);
  } else if (kind === 'Thorns') {
    expect([attacker.currentHP, defender.currentHP]).toEqual([7, 10]);
  } else if (kind === 'drain debt') {
    expect([attacker.currentHP, defender.currentHP]).toEqual([10, 10]);
    expect(attacker._accessoryHpOwed).toBeUndefined();
  } else if (kind === 'counter kills' || kind === 'enemy kill') {
    expect(scene.playerUnits).not.toContain(attacker);
    expect(scene._playerDeathsThisBattle).toBe(1);
    expect(attacker.xp).toBe(0);
  } else if (kind === 'Deathburst' || kind === 'Deathburst Light bounty Zombie') {
    expect(scene.enemyUnits.map((entry) => entry.name)).toEqual(['Reserve']);
    expect(scene.goldEarned).toBe(kind === 'Deathburst' ? 72 : 372);
    expect(scene._deathAffixChainDepth).toBe(0);
    if (kind === 'Deathburst Light bounty Zombie') {
      expect(scene._zombieTombstones).toHaveLength(1);
      expect(scene._zombieTombstones[0]).toMatchObject({ col: 3, row: 3 });
    }
  } else if (kind === 'Teleporter survives' || kind === 'enemy Teleporter') {
    expect(defender.col + defender.row).toBeGreaterThan(5);
    expect(defender.currentHP).toBeGreaterThan(0);
  } else if (kind === 'Teleporter boxed') {
    expect([defender.col, defender.row]).toEqual([3, 2]);
  } else if (kind === 'enemy counter kill') {
    expect(scene.enemyUnits).not.toContain(defender);
    expect(attacker.xp).toBeGreaterThan(0);
  } else if (kind === 'enemy Entity') {
    expect(scene._playerDeathsThisBattle).toBe(2);
    expect(scene.playerUnits.map((entry) => entry.name)).toEqual([
      'Edric',
      'Fighter',
      'Splash victim 1',
    ]);
  } else if (kind === 'Gambit') {
    expect(attacker._gambitUsedThisTurn).toBe(true);
    expect(scene.playerUnits.every((entry) => !entry.hasActed)).toBe(true);
  }
  if (kind === 'Teleporter survives' || kind === 'Teleporter fog') {
    // One strike: two hit draws, one crit draw, then exactly one warp draw.
    expect(scene._battleRng.getState().cursor).toBe((7 + 4 * 0x6d2b79f5) >>> 0);
    expect([defender.col, defender.row]).toEqual([4, 4]);
  }
  if (kind === 'Teleporter fog') {
    expect(scene._warpGraphicVisible).toBe(false);
    // Hand-enumerated union of radius-3 Manhattan diamonds at (0,0) and (2,2).
    const visible = [
      '0,0',
      '0,1',
      '0,2',
      '0,3',
      '1,0',
      '1,1',
      '1,2',
      '1,3',
      '1,4',
      '2,0',
      '2,1',
      '2,2',
      '2,3',
      '2,4',
      '2,5',
      '3,0',
      '3,1',
      '3,2',
      '3,3',
      '3,4',
      '4,1',
      '4,2',
      '4,3',
      '5,2',
    ];
    expect(scene._warpFogBoundary).toEqual({
      visible,
      seen: visible,
      warpVisible: false,
      rng: { algorithm: 'mulberry32-v1', cursor: (7 + 4 * 0x6d2b79f5) >>> 0 },
    });
    expect([...result.snapshot.checkpoint.fog.visible].sort()).toEqual(visible);
    expect([...result.snapshot.checkpoint.fog.everSeen].sort()).toEqual(visible);
  }
  if (kind === 'Teleporter lethal' || kind === 'Teleporter boxed') {
    expect(scene._battleRng.getState().cursor).toBe((7 + 3 * 0x6d2b79f5) >>> 0);
  }
  if (kind === 'enemy Teleporter') {
    // Enemy's strike, player's counter, then the living enemy warps.
    expect(scene._battleRng.getState().cursor).toBe((7 + 7 * 0x6d2b79f5) >>> 0);
  }
  if (kind === 'poison') expect(defender.currentHP).toBe(5);
  if (kind === 'art Phoenix') {
    expect(attacker.currentHP).toBe(12);
    expect(attacker._phoenixBroochUsed).toBe(true);
    expect(attacker._battleWeaponArtUsage.map.sword_precise_cut).toBe(1);
  }
  if (kind === 'level-up') {
    expect(attacker.level).toBe(15);
    expect(attacker.skills).toContain('wrath');
    expect(attacker.xp).toBe(12); // floor(25 * 12/22)=13 XP; 99+13 crosses once.
  }
  if (kind === 'Teleporter pierce') {
    expect(scene.enemyUnits.find((entry) => entry.name === 'Behind original tile')).toMatchObject({
      currentHP: 22,
    });
    expect([defender.col, defender.row]).not.toEqual([3, 2]);
    expect(attacker._battleWeaponArtUsage.map.legend_piercing_charge).toBe(1);
  }
  if (kind === 'brave double') {
    expect(defender.currentHP).toBe(52); // Four sword strikes of 12, one 10-HP counter.
    expect(attacker.currentHP).toBe(10);
  }
  if (kind === 'Tier5 splash Zombie') {
    expect(scene.enemyUnits.map((entry) => entry.name)).toEqual(['Enemy', 'Reserve']);
    expect(scene.goldEarned).toBe(72);
    expect(scene._zombieTombstones).toHaveLength(1);
    expect(scene._zombieTombstones[0]).toMatchObject({ col: 3, row: 3 });
    expect(attacker._battleWeaponArtUsage.map.legend_cataclysm).toBe(1);
  }
  if (kind === 'Canto') {
    expect(scene.battleState).toBe('CANTO_MOVING');
    expect(scene.selectedUnit).toBe(attacker);
    expect(attacker.hasActed).toBe(true);
    expect(scene.cantoRange.size).toBeGreaterThan(0);
  }
  if (kind === 'victory') expect(scene.result).toBe('victory');
  else if (!['Canto', 'Gambit'].includes(kind)) {
    expect(result.snapshot.checkpoint).toBeTruthy();
    expect(result.snapshot.durable.battleInProgress.checkpoint).toEqual(result.snapshot.checkpoint);
  }
}

describe.each([
  'plain kill',
  'counter kills',
  'Thorns',
  'drain debt',
  'Teleporter survives',
  'Teleporter fog',
  'Teleporter lethal',
  'Teleporter boxed',
  'Deathburst',
  'Deathburst Light bounty Zombie',
  'poison',
  'victory',
  'enemy counter kill',
  'enemy kill',
  'enemy Teleporter',
  'enemy Entity',
  'Gambit',
  'art Phoenix',
  'level-up',
  'Teleporter pierce',
  'brave double',
  'Canto',
  'Tier5 splash Zombie',
])('%s real combat entry', (kind) => {
  it('settles identically with skipped, failed and every nth presentation call', async () => {
    const expected = await run(kind);
    expect(expected.errors).toEqual([]);
    expect(expected.count).toBeGreaterThan(0);
    expect(expected.calls.labels).toContain('fx.playImpact');
    assertOutcome(kind, expected);
    expect((await run(kind, 0, 'skipped')).snapshot).toEqual(expected.snapshot);
    expect((await run(kind, 0, 'paused')).snapshot).toEqual(expected.snapshot);
    expect((await run(kind, 0, 'no sprites')).snapshot).toEqual(expected.snapshot);
    const absent = await run(kind, 'all');
    expect(absent.errors).toContain('battle_presentation_failed');
    expect(absent.errors).not.toContain('battle_combat_domain_error');
    expect(absent.snapshot).toEqual(expected.snapshot);
    for (let nth = 1; nth <= expected.count; nth++) {
      const actual = await run(kind, nth);
      expect(
        actual.errors.some((context) =>
          [
            'battle_presentation_failed',
            'battle_tween_schedule_error',
            'battle_delay_schedule_error',
          ].includes(context),
        ),
        `call ${nth}: ${expected.calls.labels[nth - 1]}`,
      ).toBe(true);
      expect(actual.errors).not.toContain('battle_combat_domain_error');
      expect(actual.snapshot, `call ${nth}: ${expected.calls.labels[nth - 1]}`).toEqual(
        expected.snapshot,
      );
    }
  }, 20_000);
});
