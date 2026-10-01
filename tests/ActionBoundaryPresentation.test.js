import { afterEach, describe, expect, it, vi } from 'vitest';
import './harness/JourneyTestSetup.js';
vi.mock('../src/utils/errorReporter.js', () => ({ reportAsyncError: vi.fn() }));
import { reportAsyncError } from '../src/utils/errorReporter.js';
import { journeyBattleScene } from './harness/JourneyBattleScene.js';
import { presentationFailureProxy } from './harness/PresentationFailureProxy.js';
import { JourneyStorage, RunDriver } from './harness/RunDriver.js';
import { createBattleRng } from '../src/engine/BattleRng.js';
import { BattleScene } from '../src/scenes/BattleScene.js';
import { Grid } from '../src/engine/Grid.js';
import { RunManager } from '../src/engine/RunManager.js';
import { TurnManager } from '../src/engine/TurnManager.js';
import { loadGameData } from './testData.js';
import { _resetUidCounter } from '../src/utils/itemUid.js';

const data = loadGameData();
const originalRandom = Math.random;
afterEach(() => {
  Math.random = originalRandom;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function clean(value) {
  if (value === undefined || typeof value === 'function') return undefined;
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Set) return [...value].sort();
  if (Array.isArray(value)) return value.map(clean);
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key, entry]) =>
          !['graphic', 'label', 'hpBar', 'factionIndicator', 'savedAt'].includes(key) &&
          entry !== undefined &&
          typeof entry !== 'function',
      )
      .map(([key, entry]) => [key, clean(entry)]),
  );
}
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
  driver.run.runRecordId = 'action-boundary-run';
  driver.run.beginBattleInProgress(driver.run.nodeMap.nodes[0].id, { battleParams: {} });
  const scene = journeyBattleScene(driver.run, data);
  Object.assign(scene, {
    _battleSession: 1,
    _sceneShutdownCleanedUp: false,
    _battleRewindPolicy: 'fixed-v1',
    _battleRng: createBattleRng(7),
    scene: { isActive: () => world !== 'paused' },
    sys: { isActive: () => world !== 'paused' },
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
  const actor = unit('Sera', 2, 2),
    target = unit('Target', 2, 3, 5),
    other = unit('Other', 3, 3, 5),
    full = unit('Full', 1, 2);
  scene.playerUnits = [actor, target, other, full];
  scene.enemyUnits = [unit('Enemy', 7, 7)];
  scene.enemyUnits[0].faction = 'enemy';
  const calls = presentationFailureProxy(scene, failure, {
    skipped: world === 'skipped' || world === 'paused',
    fastTweens: true,
  });
  for (const entry of [...scene.playerUnits, ...scene.enemyUnits]) {
    scene.addUnitGraphic(entry);
    if (world !== 'no sprites') {
      entry.graphic = calls.visual;
      entry.hpBar = { bg: calls.visual, fill: calls.visual };
    }
  }
  scene.turnManager = new TurnManager({ onPhaseChange: () => {}, checkBattleEnd: () => false });
  scene.turnManager.init(scene.playerUnits, scene.enemyUnits, []);
  const tome = structuredClone(data.weapons.find((w) => w.type === 'Tome'));
  let staff = {
    rankRequired: 'Prof',
    name: 'Heal Staff',
    type: 'Staff',
    range: '1',
    healBase: 5,
    uses: 3,
  };
  if (kind === 'mend') staff.healBase = 15;
  if (kind === 'fortify') Object.assign(staff, { healAll: true, range: '1-3' });
  if (kind === 'cure') {
    staff.cureConditions = true;
    target._conditions = [{ id: 'sleep', turnsRemaining: 2 }];
  }
  if (kind === 'rescue' || kind === 'warp') {
    staff = structuredClone(
      data.weapons.find((w) => w.name === (kind === 'rescue' ? 'Rescue Staff' : 'Warp Staff')),
    );
    if (kind === 'rescue') target.row = 5;
  }
  if (kind === 'mend') target.currentHP = 18;
  if (kind === 'growth') actor.xp = 95;
  if (kind === 'Canto') {
    actor.skills = ['canto'];
    actor._movementSpent = 1;
    Object.assign(scene.grid, {
      terrainData: data.terrain,
      getMovementRange: Grid.prototype.getMovementRange,
      reconstructIcePath: Grid.prototype.reconstructIcePath,
      findPath: Grid.prototype.findPath,
    });
    scene.grid.showMovementRange = calls.call(() => {}, 'grid.showMovementRange');
  }
  if (kind === 'grace') {
    actor.currentHP = 10;
    actor.traits = ['overflowing_grace'];
  }
  if (kind === 'depletion') staff.uses = 1;
  actor.inventory = [tome, staff];
  actor.weapon = tome;
  const controller =
    scene._healController || (scene.findHealTargets(actor, staff), scene._healController);
  controller.holdStaff(actor, staff);
  let item;
  if (['vulnerary', 'elixir', 'herb', 'remedy'].includes(kind)) {
    item = {
      name: kind,
      effect: { vulnerary: 'heal', elixir: 'healFull', herb: 'cure', remedy: 'cureHeal' }[kind],
      value: 10,
      uses: kind === 'vulnerary' ? 3 : kind === 'herb' ? 2 : 1,
    };
    actor.consumables = [item];
    actor.currentHP = 5;
    actor.weapon = tome;
    if (kind === 'herb' || kind === 'remedy') {
      target._conditions = [{ id: 'sleep', turnsRemaining: 2 }];
      scene._pendingCureTarget = target;
    }
    if (kind === 'elixir') actor._accessoryHpOwed = 5;
  }
  const execute = () =>
    item
      ? scene.useConsumable(actor, item)
      : kind === 'fortify'
        ? scene.executeHealAll(actor, [target, other, full])
        : ['rescue', 'warp'].includes(kind)
          ? scene.executeRelocate(actor, target, { col: 3, row: 2 })
          : scene.executeHeal(actor, target);
  return { scene, actor, target, other, staff, item, tome, storage, calls, execute };
}
async function run(kind, failure = 0, world = 'shown') {
  const result = fixture(kind, failure, world);
  await result.execute();
  const { scene, storage } = result;
  return {
    ...result,
    snapshot: clean({
      players: scene.playerUnits,
      rng: scene._battleRng.getState(),
      state: scene.battleState,
      pending: scene._pendingActionCompletion,
      queue: scene._pendingLevelUpPopups,
      checkpoint: scene.runManager.battleInProgress.checkpoint,
      durable: JSON.parse(storage.getItem('emblem_rogue_slot_1_run')),
    }),
  };
}
const scenarios = [
  'heal',
  'mend',
  'fortify',
  'cure',
  'growth',
  'grace',
  'depletion',
  'rescue',
  'warp',
  'vulnerary',
  'elixir',
  'herb',
  'remedy',
  'Canto',
];
describe('remaining action settlement through real scene entries', () => {
  for (const kind of scenarios)
    it(kind, { timeout: 20_000 }, async () => {
      const expected = await run(kind);
      const { actor, target, other, staff, item, tome, calls } = expected;
      expect(actor.hasActed).toBe(true);
      expect(actor.weapon).toBe(tome);
      expect(reportAsyncError).not.toHaveBeenCalled();
      expect(calls()).toBeGreaterThan(0);
      expect(calls.labels).toContain(
        item ? 'showBriefBanner' : ['rescue', 'warp'].includes(kind) ? 'tween' : 'fx.playHeal',
      );
      if (item) {
        expect(item.uses).toBe(kind === 'vulnerary' ? 2 : kind === 'herb' ? 1 : 0);
        expect(actor.xp).toBe(0);
        if (kind === 'vulnerary') expect(actor.currentHP).toBe(15);
        if (kind === 'elixir') {
          expect(actor.currentHP).toBe(20);
          expect(actor._accessoryHpOwed).toBeUndefined();
        }
        if (kind === 'herb' || kind === 'remedy') {
          expect(target._conditions).toEqual([]);
          expect(target.currentHP).toBe(kind === 'herb' ? 5 : 15);
        }
      } else {
        expect(staff._usesSpent).toBe(1);
        expect(actor.xp).toBe(kind === 'growth' ? 15 : 20);
        if (kind === 'growth') expect(actor.level).toBe(6);
        else if (kind === 'mend') expect(target.currentHP).toBe(20);
        else if (kind === 'cure') {
          expect(target.currentHP).toBe(5);
          expect(target._conditions).toEqual([]);
        } else if (kind === 'rescue' || kind === 'warp') {
          expect([target.col, target.row]).toEqual([3, 2]);
          expect(target.hasActed).toBe(false);
        } else {
          expect(target.currentHP).toBe(16);
          if (kind === 'fortify') expect(other.currentHP).toBe(16);
        }
        if (kind === 'grace') {
          expect(actor.currentHP).toBe(13);
          expect(actor._legendaryGraceTurn).toBe(1);
        }
      }
      for (const world of ['skipped', 'paused', 'no sprites'])
        expect((await run(kind, 0, world)).snapshot).toEqual(expected.snapshot);
      expect((await run(kind, 'all')).snapshot).toEqual(expected.snapshot);
      for (let nth = 1; nth <= calls(); nth++) {
        const failed = await run(kind, nth);
        expect(failed.snapshot, `failure ${nth}: ${failed.calls.labels[nth - 1]}`).toEqual(
          expected.snapshot,
        );
      }
    });
});

it('effect, cost, growth and finish checkpoint are durable before the first renderer call', async () => {
  const f = fixture('growth');
  let observed;
  f.calls.observe(() => {
    if (!observed)
      observed = {
        checkpoint: JSON.parse(f.storage.getItem('emblem_rogue_slot_1_run')).battleInProgress
          ?.checkpoint,
        hp: f.target.currentHP,
        spent: f.staff._usesSpent,
        xp: f.actor.xp,
        queueLength: f.scene._pendingLevelUpPopups?.length,
      };
  });
  f.scene.grid.clearAttackHighlights = () => {
    throw new Error('broken highlight');
  };
  await f.execute();
  expect(observed).toMatchObject({ hp: 16, spent: 1, xp: 15, queueLength: 1 });
  expect(observed.checkpoint.pendingActionCompletion).toMatchObject({
    kind: 'finish',
    unitName: 'Sera',
  });
  expect(observed.checkpoint.playerUnits.find((unit) => unit.name === 'Target').currentHP).toBe(16);
  expect(observed.checkpoint.playerUnits.find((unit) => unit.name === 'Sera').xp).toBe(15);
  expect(f.actor.hasActed).toBe(true);
});
it('HealAll rejects programmatic re-entry while the first target is rendering', async () => {
  const f = fixture('fortify');
  let release;
  f.scene.animateHeal = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  const first = f.execute();
  expect(f.staff._usesSpent).toBe(1);
  expect(await f.execute()).toBe(false);
  expect(f.staff._usesSpent).toBe(1);
  release();
  for (let n = 0; n < 5; n++) await Promise.resolve();
  release();
  await first;
  expect(f.actor.xp).toBe(20);
});
it('unsupported or stale consumables preserve the item and action', async () => {
  const f = fixture('vulnerary');
  f.item.effect = 'statBoost';
  expect(await f.execute()).toBe(false);
  expect(f.item.uses).toBe(3);
  expect(f.actor.currentHP).toBe(5);
  expect(f.actor.hasActed).toBe(false);
  expect(f.scene.showActionMenu).toHaveBeenCalledWith(f.actor);
});
it('init discards a cure target retained by an interrupted prior session', () => {
  const f = fixture('herb');
  f.scene.init({ gameData: data });
  expect(f.scene._pendingCureTarget).toBeNull();
  expect(f.scene._pendingCureItem).toBeNull();
  expect(f.scene._pendingCureUser).toBeNull();
});

it.each(['fixed-v1', 'legacy-v1'])(
  'resume a settled %s heal without repeating XP, staff cost or RNG',
  async (policy) => {
    const f = fixture('growth');
    f.scene._battleRewindPolicy = policy;
    f.scene.reseedBattleRng = BattleScene.prototype.reseedBattleRng;
    if (policy === 'legacy-v1')
      f.scene.add.text = f.calls.call(() => {
        Math.random();
        return f.calls.visual;
      }, 'legacy UUID text');
    let release;
    f.scene.animateHeal = () =>
      new Promise((resolve) => {
        release = resolve;
      });
    const cursorBefore = f.scene._battleRng.getState();
    const pending = f.execute();
    const checkpoint = JSON.parse(f.storage.getItem('emblem_rogue_slot_1_run')).battleInProgress
      .checkpoint;
    expect(checkpoint.pendingActionCompletion).toMatchObject({ kind: 'finish' });
    expect(
      checkpoint.playerUnits
        .find((u) => u.name === 'Sera')
        .inventory.find((w) => w.type === 'Staff')._usesSpent,
    ).toBe(1);
    const growthRng = createBattleRng(7, cursorBefore);
    for (let n = 0; n < 8; n++) growthRng();
    expect(checkpoint.rngState).toEqual(growthRng.getState());
    const resumed = fixture('growth').scene;
    resumed.playerUnits = [];
    resumed.enemyUnits = [];
    resumed.npcUnits = [];
    resumed._battleRewindPolicy = policy;
    resumed.reseedBattleRng = BattleScene.prototype.reseedBattleRng;
    resumed.runManager = RunManager.fromJSON(
      JSON.parse(f.storage.getItem('emblem_rogue_slot_1_run')),
      data,
    );
    const { BattleSuspendController } = await import('../src/ui/BattleSuspendController.js');
    const suspend = new BattleSuspendController(resumed);
    resumed.runManager.setBattleCheckpoint(checkpoint);
    suspend.applyUnits(checkpoint);
    resumed.turnManager.playerUnits = resumed.playerUnits;
    resumed.turnManager.enemyUnits = resumed.enemyUnits;
    suspend.finalizeResume(checkpoint);
    const healer = resumed.playerUnits.find((u) => u.name === 'Sera');
    expect(healer.hasActed).toBe(true);
    expect(healer.level).toBe(6);
    expect(healer.xp).toBe(15);
    expect(healer.inventory.find((w) => w.type === 'Staff')._usesSpent).toBe(1);
    expect(resumed.playerUnits.find((u) => u.name === 'Target').currentHP).toBe(16);
    // Fixed-v1 captures preserve the same cursor; legacy completion intentionally
    // reseeds, and both resumed completion and live completion follow that rule.
    Math.random = f.scene._battleRng;
    release();
    await pending;
    expect(resumed._battleRng.getState()).toEqual(f.scene._battleRng.getState());
  },
);

it('storage retry writes a frozen staff settlement without repeating its cost or growth', async () => {
  const f = fixture('growth');
  f.storage.failWrites = true;
  const pending = f.execute();
  f.scene._saveRetry.keepPlaying();
  await pending;
  expect(f.scene._checkpointPersistenceResult.ok).toBe(false);
  const before = clean({
    players: f.scene.playerUnits,
    rng: f.scene._battleRng.getState(),
    checkpoint: f.scene.runManager.battleInProgress.checkpoint,
  });
  f.storage.failWrites = false;
  expect(
    f.scene._battleSuspendController.retryCheckpoint({ session: f.scene._battleSession }).ok,
  ).toBe(true);
  expect(
    clean({
      players: f.scene.playerUnits,
      rng: f.scene._battleRng.getState(),
      checkpoint: f.scene.runManager.battleInProgress.checkpoint,
    }),
  ).toEqual(before);
  expect(f.staff._usesSpent).toBe(1);
  expect(f.actor.xp).toBe(15);
});

it('a retry gate runs after settlement and before presentation, never repeats costs', async () => {
  const f = fixture('heal');
  f.storage.failWrites = true;
  let release;
  let draws = 0;
  f.scene._saveRetryGate = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  f.scene.animateHeal = () => {
    draws++;
  };
  const pending = f.execute();
  expect(f.target.currentHP).toBe(16);
  expect(f.staff._usesSpent).toBe(1);
  expect(draws).toBe(0);
  expect(f.actor.hasActed).toBe(false);
  expect(release).toBeTypeOf('function');
  release();
  await pending;
  expect(draws).toBe(1);
  expect(f.actor.hasActed).toBe(true);
  expect(f.staff._usesSpent).toBe(1);
});

it.each([
  '_fatalDecision',
  '_fatalCapturePending',
  '_defeatDecision',
  'BATTLE_END',
  'stale_session',
])(
  'a retry boundary stops presentation and completion after %s',
  async (decision) => {
    const f = fixture('heal');
    f.storage.failWrites = true;
    let release;
    let draws = 0;
    f.scene._saveRetryGate = () =>
      new Promise((resolve) => {
        release = resolve;
      });
    f.scene.animateHeal = () => {
      draws++;
    };
    const pending = f.execute();
    expect(f.target.currentHP).toBe(16);
    expect(f.staff._usesSpent).toBe(1);
    expect(release).toBeTypeOf('function');
    if (decision === 'BATTLE_END') f.scene.battleState = 'BATTLE_END';
    else if (decision === 'stale_session') f.scene._battleSession++;
    else f.scene[decision] = {};
    release();
    await pending;
    expect(draws).toBe(0);
    expect(f.actor.hasActed).toBe(false);
    expect(f.staff._usesSpent).toBe(1);
    expect(f.target.currentHP).toBe(16);
  },
  20_000,
);

it('restart after settlement cannot complete or save into the replacement battle', async () => {
  const f = fixture('heal');
  let release;
  f.scene.animateHeal = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  const pending = f.execute();
  expect(f.staff._usesSpent).toBe(1);
  const writes = f.storage.writes;
  const durable = f.storage.getItem('emblem_rogue_slot_1_run');
  f.scene._sceneShutdownCleanedUp = true;
  f.scene._cancelLifecycleAwaits('scene_shutdown');
  f.scene.init({ gameData: data });
  f.scene.battleState = 'NEW_BATTLE';
  release();
  await pending;
  expect(f.storage.writes).toBe(writes);
  expect(f.storage.getItem('emblem_rogue_slot_1_run')).toBe(durable);
  expect(f.scene.battleState).toBe('NEW_BATTLE');
  expect(f.actor.hasActed).toBe(false);
});

it('a malformed domain hook is reported and recovered exactly once', async () => {
  const f = fixture('heal');
  f.scene.awardScaledXP = () => {
    throw new Error('growth bug');
  };
  const finish = vi.spyOn(f.scene, 'finishUnitAction');
  await f.execute();
  expect(reportAsyncError.mock.calls.map(([code]) => code)).toContain('battle_action_domain_error');
  expect(finish).toHaveBeenCalledTimes(1);
  expect(f.actor.hasActed).toBe(true);
  expect(f.staff._usesSpent).toBe(1);
});

it.each(['removed actor', 'enemy actor', 'no proficiency', 'relocation as heal', 'missing staff'])(
  '%s is refused before settlement',
  async (kind) => {
    const f = fixture('heal');
    if (kind === 'removed actor')
      f.scene.playerUnits = f.scene.playerUnits.filter((u) => u !== f.actor);
    if (kind === 'enemy actor') f.actor.faction = 'enemy';
    if (kind === 'no proficiency') f.actor.proficiencies = [];
    if (kind === 'relocation as heal') f.staff.relocate = 'warp';
    if (kind === 'missing staff') f.actor.weapon = null;
    const hp = f.target.currentHP;
    await f.execute();
    expect(f.target.currentHP).toBe(hp);
    expect(f.staff._usesSpent).toBeUndefined();
    expect(f.actor.xp).toBe(0);
    expect(f.actor.hasActed).toBe(false);
    expect(f.scene.showActionMenu).toHaveBeenCalledWith(f.actor);
    expect(reportAsyncError).not.toHaveBeenCalled();
  },
);
it('Fortify settles each still-valid ally once even if a stale caller repeats targets', async () => {
  const f = fixture('fortify');
  await f.scene.executeHealAll(f.actor, [f.target, f.target, f.other]);
  expect(f.target.currentHP).toBe(16);
  expect(f.other.currentHP).toBe(16);
  expect(f.staff._usesSpent).toBe(1);
  expect(f.actor.xp).toBe(20);
});
it.each(['removed actor', 'no conditions'])(
  'consumables refuse %s without spending or changing HP',
  async (kind) => {
    const f = fixture('remedy');
    if (kind === 'removed actor')
      f.scene.playerUnits = f.scene.playerUnits.filter((u) => u !== f.actor);
    else f.target._conditions = [];
    expect(await f.execute()).toBe(false);
    expect(f.target.currentHP).toBe(5);
    expect(f.item.uses).toBe(1);
    expect(f.actor.hasActed).toBe(false);
  },
);
it('a stale action callback during enemy phase changes nothing', async () => {
  const f = fixture('heal');
  f.scene.turnManager.currentPhase = 'enemy';
  f.scene.battleState = 'ENEMY_PHASE';
  const before = clean({
    players: f.scene.playerUnits,
    state: f.scene.battleState,
    rng: f.scene._battleRng.getState(),
  });
  expect(await f.execute()).toBe(false);
  expect(
    clean({
      players: f.scene.playerUnits,
      state: f.scene.battleState,
      rng: f.scene._battleRng.getState(),
    }),
  ).toEqual(before);
});
it('an unexpected asynchronous XP command reports a domain error and completes once', async () => {
  const f = fixture('heal');
  f.scene.awardScaledXP = () => Promise.reject(new Error('bad XP adapter'));
  const finish = vi.spyOn(f.scene, 'finishUnitAction');
  await f.execute();
  expect(finish).toHaveBeenCalledTimes(1);
  expect(f.actor.hasActed).toBe(true);
  expect(f.staff._usesSpent).toBe(1);
  expect(reportAsyncError.mock.calls.map(([code]) => code)).toContain('battle_action_domain_error');
});
it('a consumable cost is durable before its banner and repeated activation is refused', async () => {
  const f = fixture('vulnerary');
  let release;
  f.scene.showBriefBanner = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  const pending = f.execute();
  const checkpoint = JSON.parse(f.storage.getItem('emblem_rogue_slot_1_run')).battleInProgress
    .checkpoint;
  const savedActor = checkpoint.playerUnits.find((unit) => unit.name === 'Sera');
  expect(savedActor.currentHP).toBe(15);
  expect(savedActor.consumables[0].uses).toBe(2);
  expect(await f.execute()).toBe(false);
  expect(f.item.uses).toBe(2);
  for (let n = 0; n < 5; n++) await Promise.resolve();
  release();
  await pending;
  expect(f.item.uses).toBe(2);
  expect(f.actor.currentHP).toBe(15);
});
it('an unrelated stale cure selection cannot block self-heal consumables', async () => {
  const f = fixture('vulnerary');
  f.scene._pendingCureTarget = f.target;
  expect(await f.execute()).toBe(true);
  expect(f.actor.currentHP).toBe(15);
  expect(f.item.uses).toBe(2);
  expect(f.target.currentHP).toBe(5);
  expect(f.scene._pendingCureTarget).toBeNull();
});

it('adversary: relocation capture keeps old fog until action completion then reveals current tiles', async () => {
  const f = fixture('rescue');
  const { Grid } = await import('../src/engine/Grid.js');
  Object.assign(f.scene.grid, {
    scene: f.scene,
    fogEnabled: true,
    visibleSet: new Set(),
    everSeenSet: new Set(),
    getVisionRange: Grid.prototype.getVisionRange,
    updateFogOfWar: Grid.prototype.updateFogOfWar,
    isVisible: Grid.prototype.isVisible,
  });
  f.scene.grid.updateFogOfWar(f.scene.playerUnits);
  expect(f.scene.grid.isVisible(2, 7)).toBe(true);
  let inspected;
  f.scene._healController.animateRelocate = async () => {
    inspected = JSON.parse(f.storage.getItem('emblem_rogue_slot_1_run')).battleInProgress
      .checkpoint;
  };
  await f.execute();
  expect(inspected.playerUnits.find((u) => u.name === 'Target')).toMatchObject({ col: 3, row: 2 });
  expect(inspected.fog.visible).toContain('2,7');
  expect(f.scene.grid.isVisible(2, 7)).toBe(false);
  expect(f.scene.grid.everSeenSet.has('2,7')).toBe(true);
  expect(reportAsyncError).not.toHaveBeenCalled();
});

it('adversary: staff Canto and its resumed continuation charge and finish exactly once', async () => {
  const f = fixture('heal');
  const { Grid } = await import('../src/engine/Grid.js');
  const installCanto = (scene) => {
    scene.grid.terrainData = data.terrain;
    scene.grid.getMovementRange = Grid.prototype.getMovementRange;
    scene.grid.showMovementRange = () => {};
    scene.grid.clearHighlights = () => {};
  };
  installCanto(f.scene);
  f.actor.skills = ['canto'];
  const finishes = vi.spyOn(f.scene, 'finishUnitAction');
  await f.execute();
  expect(finishes).toHaveBeenCalledTimes(1);
  expect(f.scene.battleState).toBe('CANTO_MOVING');
  expect(f.actor.hasActed).toBe(true);
  expect(f.staff._usesSpent).toBe(1);
  expect(f.actor.xp).toBe(20);
  expect(await f.execute()).toBe(false);
  const saved = JSON.parse(f.storage.getItem('emblem_rogue_slot_1_run'));
  expect(saved.battleInProgress.checkpoint.pendingActionCompletion).toMatchObject({
    kind: 'finish',
  });
  const { RunManager } = await import('../src/engine/RunManager.js');
  const { BattleSuspendController } = await import('../src/ui/BattleSuspendController.js');
  const { BattleScene } = await import('../src/scenes/BattleScene.js');
  const r = fixture('heal').scene;
  installCanto(r);
  r.reseedBattleRng = BattleScene.prototype.reseedBattleRng;
  r.runManager = RunManager.fromJSON(saved, data);
  const cp = r.runManager.battleInProgress.checkpoint;
  r.playerUnits = [];
  r.enemyUnits = [];
  r.npcUnits = [];
  const suspend = new BattleSuspendController(r);
  suspend.applyUnits(cp);
  r.turnManager.init(r.playerUnits, r.enemyUnits, []);
  suspend.finalizeResume(cp);
  expect(r.battleState).toBe('CANTO_MOVING');
  const a = r.playerUnits.find((u) => u.name === 'Sera');
  expect(a.xp).toBe(20);
  expect(a.inventory.find((w) => w.type === 'Staff')._usesSpent).toBe(1);
  r.handleCantoClick({ col: a.col, row: a.row });
  expect(r.battleState).toBe('PLAYER_IDLE');
  expect(a.xp).toBe(20);
  expect(a.inventory.find((w) => w.type === 'Staff')._usesSpent).toBe(1);
});

it('adversary: a recovered action promise awaits queued level-ups before returning', async () => {
  const f = fixture('growth');
  const { LevelUpPopup } = await import('../src/ui/LevelUpPopup.js');
  let release;
  vi.spyOn(LevelUpPopup.prototype, 'show').mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const real = f.scene._captureSuspendCheckpoint.bind(f.scene);
  let failed = false;
  f.scene._captureSuspendCheckpoint = (options) => {
    if (!failed) {
      failed = true;
      throw new Error('capture adapter failed');
    }
    return real(options);
  };
  let returned = false;
  const pending = f.execute().then(() => {
    returned = true;
  });
  for (let i = 0; i < 8; i++) await Promise.resolve();
  expect(release).toBeTypeOf('function');
  expect(returned).toBe(false);
  release();
  await pending;
  expect(f.actor.hasActed).toBe(true);
  expect(f.scene.battleState).toBe('PLAYER_IDLE');
});
