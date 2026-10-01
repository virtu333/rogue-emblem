import { afterEach, describe, expect, it, vi } from 'vitest';
import './harness/JourneyTestSetup.js';
vi.mock('../src/utils/errorReporter.js', () => ({ reportAsyncError: vi.fn() }));
import { reportAsyncError } from '../src/utils/errorReporter.js';
import { journeyBattleScene } from './harness/JourneyBattleScene.js';
import { presentationFailureProxy } from './harness/PresentationFailureProxy.js';
import { JourneyStorage, RunDriver } from './harness/RunDriver.js';
import { createBattleRng } from '../src/engine/BattleRng.js';
import { TurnManager } from '../src/engine/TurnManager.js';
import { BattleScene } from '../src/scenes/BattleScene.js';
import { RunManager } from '../src/engine/RunManager.js';
import { AbilityController } from '../src/ui/AbilityController.js';
import { BattleSuspendController } from '../src/ui/BattleSuspendController.js';
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
    weapon: null,
    _conditions: [],
    _movementCommitted: false,
    _movementSpent: 0,
    _miracleUsed: false,
    _phoenixBroochUsed: false,
    _conditionIcons: null,
    affixPips: null,
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
  driver.run.runRecordId = 'movement-boundary-run';
  driver.run.beginBattleInProgress(driver.run.nodeMap.nodes[0].id, { battleParams: {} });
  const scene = journeyBattleScene(driver.run, data);
  Object.assign(scene, {
    _battleSession: 1,
    _sceneShutdownCleanedUp: false,
    _battleRecruits: [],
    _battleRewindPolicy: 'fixed-v1',
    _battleRng: createBattleRng(kind === 'ballista miss' ? 30 : 7),
    scene: { isActive: () => world !== 'paused' },
    sys: { isActive: () => world !== 'paused' },
    cameras: { main: { width: 640, height: 480, centerX: 320, centerY: 240 } },
    _pinToScreen: () => {},
    showActionMenu: vi.fn(),
    goldEarned: 0,
    _getPortraitKey: () => null,
    time: {
      delayedCall: (_delay, callback) => {
        callback();
        return { remove() {} };
      },
    },
    battleConfig: { objective: 'rout' },
    checkBattleEnd: BattleScene.prototype.checkBattleEnd,
    onVictory: () => {
      scene.result = 'victory';
      scene.battleState = 'BATTLE_END';
    },
    onDefeat: () => {
      scene.result = 'defeat';
      scene.battleState = 'BATTLE_END';
    },
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
    clearTemporaryTerrainsBySource() {},
  });
  const actor = unit('Actor', 2, 2),
    target = unit('Target', 2, 3, 3),
    other = unit('Other', 3, 3, 4),
    full = unit('Commander', 1, 2);
  full.isCommander = true;
  full.isLord = true;
  actor.hasMoved = true;
  scene.playerUnits = [actor, target, other, full];
  const enemy = { ...unit('Enemy', 2, 1), faction: 'enemy' };
  const immune = {
    ...unit('Immune', 1, 2),
    faction: 'enemy',
    accessory: { combatEffects: { statusImmunity: true } },
  };
  scene.enemyUnits =
    kind === 'ensnare' ? [enemy, immune] : [{ ...unit('Reserve', 7, 7), faction: 'enemy' }];
  let skill;
  const skillId = {
    blink: 'blink',
    rally: 'rally_cry_skill',
    circle: 'healing_circle',
    ensnare: 'ensnare',
  }[kind];
  if (skillId) {
    skill = data.skills.find((entry) => entry.id === skillId);
    actor.skills = [skillId];
  }
  if (kind === 'shove' || kind === 'pull') actor.skills = [kind];
  if (kind === 'circle') actor.currentHP = 5;
  if (kind === 'dance' || kind === 'dance growth') {
    actor.skills = ['dance'];
    target.hasActed = true;
    target.hasMoved = true;
    target._movementCommitted = true;
    if (kind === 'dance growth') actor.xp = 95;
  }
  if (kind === 'swap acted') target.hasActed = true;
  if (kind === 'talk') {
    actor.isLord = true;
    target.faction = 'npc';
    scene.playerUnits = [actor, other, full];
    scene.npcUnits = [target];
    const blessing = data.blessings.blessings.find((entry) =>
      entry.boons.some((boon) => boon.type === 'starting_consumable_all'),
    );
    driver.run.activeBlessings = [blessing.id];
  }
  if (kind.startsWith('ballista')) {
    target.currentHP = 20;
    scene.ballistas = [{ col: 0, row: 3, owner: 'enemy' }];
  }
  const calls = presentationFailureProxy(scene, failure, {
    skipped: world === 'skipped' || world === 'paused',
    fastTweens: true,
  });
  scene.dialogueOverlay = { show: calls.call(async () => {}, 'dialogue.show') };
  const addGraphic = scene.addUnitGraphic.bind(scene);
  // Setup allocates stable identities without a rendering failure; presentation
  // adds only idempotent registration via the counted graphics surface.
  for (const entry of [...scene.playerUnits, ...scene.enemyUnits, ...scene.npcUnits]) {
    addGraphic(entry);
    if (world !== 'no sprites') {
      entry.graphic = calls.visual;
      entry.hpBar = { bg: calls.visual, fill: calls.visual };
    }
  }
  scene.addUnitGraphic = calls.call(addGraphic, 'addUnitGraphic');
  scene.turnManager = new TurnManager({
    onPhaseChange: () => {},
    checkBattleEnd: () => scene.checkBattleEnd(),
  });
  scene.turnManager.init(scene.playerUnits, scene.enemyUnits, scene.npcUnits);
  scene._abilityController = new AbilityController(scene);
  const execute = async () => {
    if (kind === 'shove')
      return scene.executeShove(actor, { ally: target, destCol: 2, destRow: 4 });
    if (kind === 'pull')
      return scene.executePull(actor, { ally: target, retreatCol: 2, retreatRow: 1 });
    if (kind.startsWith('swap')) return scene.executeSwap(actor, { ally: target });
    if (kind.startsWith('dance')) return scene.executeDance(actor, { ally: target });
    if (kind === 'talk') return scene.executeTalk(actor);
    if (kind === 'blink')
      return scene._abilityController.executeBlink(actor, skill, { col: 4, row: 2 });
    if (skill) return scene._abilityController.executeSelfCentered(actor, skill);
    await scene.processBallistaFire([target], 'enemy');
    // The shot is a turn-start process; its caller owns the stable turn boundary.
    scene._captureSuspendCheckpoint({ session: scene._battleSession });
  };
  return { scene, actor, target, other, enemy, immune, storage, calls, skill, execute };
}
async function run(kind, failure = 0, world = 'shown') {
  const result = fixture(kind, failure, world);
  await result.execute();
  const { scene, storage } = result;
  return {
    ...result,
    snapshot: clean({
      players: scene.playerUnits,
      enemies: scene.enemyUnits,
      npcs: scene.npcUnits,
      rng: scene._battleRng.getState(),
      state: scene.battleState,
      pending: scene._pendingActionCompletion,
      queue: scene._pendingLevelUpPopups,
      recruits: scene._battleRecruits,
      visible: scene.grid.visibleSet,
      narrative: scene.runManager.narrativeSeen,
      gold: scene.runManager.gold,
      checkpoint: scene.runManager.battleInProgress.checkpoint,
      durable: JSON.parse(storage.getItem('emblem_rogue_slot_1_run')),
    }),
  };
}
const scenarios = [
  'shove',
  'pull',
  'swap',
  'swap acted',
  'dance',
  'dance growth',
  'talk',
  'blink',
  'rally',
  'circle',
  'ensnare',
  'ballista hit',
  'ballista miss',
];
describe('movement and utility actions settle through their shipping entry points', () => {
  for (const kind of scenarios)
    it(kind, { timeout: 20_000 }, async () => {
      const expected = await run(kind);
      const { scene, actor, target, other, enemy, immune, calls, skill } = expected;
      expect(reportAsyncError).not.toHaveBeenCalled();
      expect(calls()).toBeGreaterThan(0);
      if (!kind.startsWith('ballista')) expect(actor.hasActed).toBe(true);
      if (kind === 'shove') expect([target.col, target.row]).toEqual([2, 4]);
      if (kind === 'pull') {
        expect([actor.col, actor.row]).toEqual([2, 1]);
        expect([target.col, target.row]).toEqual([2, 2]);
      }
      if (kind.startsWith('swap')) {
        expect([actor.col, actor.row, target.col, target.row]).toEqual([2, 3, 2, 2]);
        expect(target.hasActed).toBe(kind === 'swap acted');
      }
      if (kind.startsWith('dance')) {
        expect(actor.xp).toBe(kind === 'dance growth' ? 15 : 20);
        expect(target.hasActed).toBe(false);
        expect(target.hasMoved).toBe(false);
        expect(target._movementCommitted).toBe(false);
      }
      if (kind === 'blink') {
        expect([actor.col, actor.row]).toEqual([4, 2]);
        expect(actor._battleAbilityUsage.map.blink).toBe(1);
      }
      if (kind === 'rally')
        for (const ally of [target, other]) {
          expect([ally.stats.STR, ally.stats.SPD]).toEqual([7, 7]);
          expect(ally._battleTimedWeaponArtBuffs).toHaveLength(1);
          expect(ally._battleTimedWeaponArtBuffs[0]).toMatchObject({
            stats: { STR: 2, SPD: 2 },
            expiryPhase: 'player',
            expiryTurn: 3,
          });
        }
      if (kind === 'circle')
        expect([actor.currentHP, target.currentHP, other.currentHP]).toEqual([20, 18, 19]);
      if (kind === 'ensnare') {
        expect(enemy._conditions).toMatchObject([{ id: 'root', turnsRemaining: 2 }]);
        expect(immune._conditions || []).toEqual([]);
      }
      if (skill) expect(actor._battleAbilityUsage.map[skill.id]).toBe(1);
      if (kind === 'talk') {
        expect(scene.npcUnits).toEqual([]);
        expect(scene.playerUnits).toContain(target);
        expect(target.faction).toBe('player');
        expect(target.unitUid).toBeTruthy();
        expect(target.consumables).toHaveLength(1);
        expect(scene._battleRecruits[0].unit.faction).toBe('player');
        expect(scene._battleRecruits[0].unit.unitUid).toBe(target.unitUid);
        expect(calls.labels).toContain('dialogue.show');
      }
      if (kind.startsWith('ballista')) {
        expect(target.currentHP).toBe(kind === 'ballista hit' ? 15 : 20);
        const cursor = createBattleRng(kind === 'ballista miss' ? 30 : 7);
        cursor();
        cursor();
        expect(scene._battleRng.getState()).toEqual(cursor.getState());
        expect(actor.hasActed).toBe(false);
        expect(calls.labels).toContain('fx.ballistaShot');
      } else {
        const cursor = createBattleRng(7);
        // Growth draws eight stats. Talk's blessing creates one item uid.
        const draws = kind === 'dance growth' ? 8 : kind === 'talk' ? 1 : 0;
        for (let draw = 0; draw < draws; draw++) cursor();
        expect(scene._battleRng.getState()).toEqual(cursor.getState());
      }
      const tripwire = kind.startsWith('ballista')
        ? 'fx.ballistaShot'
        : ['shove', 'pull', 'swap', 'swap acted', 'blink'].includes(kind)
          ? 'tween'
          : kind === 'circle'
            ? 'fx.playHeal'
            : kind === 'ensnare'
              ? 'fx.playStatus'
              : kind === 'talk'
                ? 'dialogue.show'
                : 'fx.playBuff';
      expect(calls.labels).toContain(tripwire);
      const count = calls();
      for (const world of ['skipped', 'paused', 'no sprites'])
        expect((await run(kind, 0, world)).snapshot, `${kind}: ${world}`).toEqual(
          expected.snapshot,
        );
      expect((await run(kind, 'all')).snapshot, `${kind}: all presentation failures`).toEqual(
        expected.snapshot,
      );
      for (let nth = 1; nth <= count; nth++)
        expect((await run(kind, nth)).snapshot, `${kind}: failure ${nth}`).toEqual(
          expected.snapshot,
        );
    });
});

describe('accepted utility actions checkpoint before their first rendering call', () => {
  for (const kind of scenarios.filter((value) => !value.startsWith('ballista'))) {
    it(kind, async () => {
      const f = fixture(kind);
      let first;
      f.scene.grid.clearAttackHighlights = () => {
        first ||= clean(structuredClone(f.scene.runManager.battleInProgress.checkpoint));
        throw new Error('first render failed');
      };
      await f.execute();
      expect(first.pendingActionCompletion).toMatchObject({ kind: 'finish', unitName: 'Actor' });
      const actor = first.playerUnits.find((entry) => entry.name === 'Actor');
      const target = first.playerUnits.find((entry) => entry.name === 'Target');
      expect(actor.hasActed).toBe(false);
      if (kind === 'shove') expect([target.col, target.row]).toEqual([2, 4]);
      if (kind === 'pull')
        expect([actor.col, actor.row, target.col, target.row]).toEqual([2, 1, 2, 2]);
      if (kind.startsWith('swap'))
        expect([actor.col, actor.row, target.col, target.row]).toEqual([2, 3, 2, 2]);
      if (kind === 'blink') {
        expect([actor.col, actor.row]).toEqual([4, 2]);
        expect(actor._battleAbilityUsage.map.blink).toBe(1);
      }
      if (kind === 'rally')
        for (const entry of [target, first.playerUnits.find((entry) => entry.name === 'Other')])
          expect(entry._battleTimedWeaponArtBuffs).toHaveLength(1);
      if (kind === 'circle')
        expect(first.playerUnits.slice(0, 3).map((entry) => entry.currentHP)).toEqual([20, 18, 19]);
      if (kind === 'ensnare')
        expect(first.enemyUnits[0]._conditions).toMatchObject([{ id: 'root', turnsRemaining: 2 }]);
      if (kind === 'talk') {
        expect(first.npcUnits).toEqual([]);
        expect(target.faction).toBe('player');
        expect(first.battleRecruits[0].unit.unitUid).toBe(target.unitUid);
      }
      if (kind.startsWith('dance')) {
        expect(actor.xp).toBe(kind === 'dance growth' ? 15 : 20);
        expect(target.hasActed).toBe(false);
      }
    });
  }
});

it.each(['shove', 'pull', 'swap', 'blink', 'rally', 'circle', 'ensnare', 'dance', 'talk'])(
  're-entry spends %s only once',
  async (kind) => {
    const f = fixture(kind);
    const first = f.execute();
    expect(await f.execute()).toBe(false);
    await first;
    expect(f.actor.hasActed).toBe(true);
    if (f.skill) expect(f.actor._battleAbilityUsage.map[f.skill.id]).toBe(1);
    if (kind === 'talk') expect(f.scene._battleRecruits).toHaveLength(1);
    if (kind === 'dance') expect(f.actor.xp).toBe(20);
    expect(f.scene.runManager.battleInProgress.checkpoint.checkpointIndex).toBe(2);
  },
);

it.each(['shove', 'pull', 'swap', 'blink', 'dance', 'talk'])(
  'a stale %s choice spends no action or cost',
  async (kind) => {
    const f = fixture(kind);
    const before = clean({
      players: f.scene.playerUnits,
      npcs: f.scene.npcUnits,
      rng: f.scene._battleRng.getState(),
    });
    if (kind === 'talk') f.scene.npcUnits = [];
    else if (kind === 'blink') f.scene.grid.getMoveCost = () => Infinity;
    else f.scene.playerUnits = f.scene.playerUnits.filter((entry) => entry !== f.target);
    expect(await f.execute()).toBe(false);
    expect(f.actor.hasActed).toBe(false);
    expect(f.actor._battleAbilityUsage).toBeUndefined();
    expect(f.scene.runManager.battleInProgress.checkpoint).toBeNull();
    expect(clean(f.actor)).toEqual(before.players[0]);
    expect(f.scene._battleRng.getState()).toEqual(before.rng);
  },
);

it.each(['blink', 'circle', 'talk', 'dance'])(
  'failed-save retry never repeats %s settlement',
  async (kind) => {
    const f = fixture(kind);
    f.storage.failWrites = true;
    const pending = f.execute();
    f.scene._saveRetry.keepPlaying();
    await pending;
    expect(f.scene._checkpointPersistenceResult).toMatchObject({ ok: false, reason: 'quota' });
    const before = clean({
      players: f.scene.playerUnits,
      npcs: f.scene.npcUnits,
      recruits: f.scene._battleRecruits,
      rng: f.scene._battleRng.getState(),
      checkpoint: f.scene.runManager.battleInProgress.checkpoint,
    });
    f.storage.failWrites = false;
    expect(
      f.scene._battleSuspendController.retryCheckpoint({ session: f.scene._battleSession }),
    ).toMatchObject({ ok: true });
    expect(
      clean({
        players: f.scene.playerUnits,
        npcs: f.scene.npcUnits,
        recruits: f.scene._battleRecruits,
        rng: f.scene._battleRng.getState(),
        checkpoint: f.scene.runManager.battleInProgress.checkpoint,
      }),
    ).toEqual(before);
    const saved = JSON.parse(f.storage.getItem('emblem_rogue_slot_1_run'));
    expect(clean(saved.battleInProgress.checkpoint)).toEqual(before.checkpoint);
  },
);

it.each(['shove', 'pull', 'swap', 'blink'])(
  'a timed-out %s tween retains the accepted move',
  async (kind) => {
    const baseline = await run(kind);
    const f = fixture(kind);
    f.scene._awaitSceneTween = async () => ({ status: 'timed_out' });
    await f.execute();
    expect(clean(f.scene.runManager.battleInProgress.checkpoint)).toEqual(
      baseline.snapshot.checkpoint,
    );
    expect(f.actor.hasActed).toBe(true);
  },
);

it.each(['shove', 'blink', 'talk'])(
  'restart during %s presentation cannot complete the replacement battle',
  async (kind) => {
    const f = fixture(kind);
    let release;
    const paused = () =>
      new Promise((resolve) => {
        release = resolve;
      });
    if (kind === 'talk') f.scene.dialogueOverlay.show = paused;
    else f.scene._awaitSceneTween = paused;
    const first = f.execute();
    for (let step = 0; step < 8 && !release; step++) await Promise.resolve();
    expect(release).toBeTypeOf('function');
    const durable = f.storage.getItem('emblem_rogue_slot_1_run');
    const oldSession = f.scene._battleSession;
    f.scene.init({ gameData: data });
    const replacement = unit('Replacement', 6, 6);
    f.scene.playerUnits = [replacement];
    f.scene.battleState = 'PLAYER_IDLE';
    f.scene.selectedUnit = replacement;
    release();
    await first;
    expect(f.scene._battleSession).toBe(oldSession + 1);
    expect([replacement.col, replacement.row, replacement.hasActed]).toEqual([6, 6, false]);
    expect(f.scene.selectedUnit).toBe(replacement);
    expect(f.scene.battleState).toBe('PLAYER_IDLE');
    expect(f.storage.getItem('emblem_rogue_slot_1_run')).toBe(durable);
  },
);

it.each(['fade out', 'fade in'])(
  'Blink restores each original opacity after a failed %s',
  async (failure) => {
    const f = fixture('blink');
    const alpha = [0.8, 0.6, 0.4];
    const objects = alpha.map((value) => ({
      alpha: value,
      setAlpha(next) {
        this.alpha = next;
      },
    }));
    f.actor.graphic = objects[0];
    f.actor.label = objects[1];
    f.actor.hpBar = { bg: objects[2] };
    let count = 0;
    f.scene._awaitSceneTween = async ({ targets, alpha: next }) => {
      count++;
      for (const target of targets) target.alpha = typeof next === 'function' ? next(target) : next;
      if (count === (failure === 'fade out' ? 1 : 2)) throw new Error('fade interrupted');
      return { status: 'completed' };
    };
    await f.execute();
    expect(objects.map((entry) => entry.alpha)).toEqual(alpha);
    expect([f.actor.col, f.actor.row, f.actor.hasActed]).toEqual([4, 2, true]);
    expect(f.actor._battleAbilityUsage.map.blink).toBe(1);
  },
);

it.each(['shove', 'blink', 'talk', 'dance growth', 'rally', 'circle', 'ensnare'])(
  'resume of settled %s never reapplies its effect or XP',
  async (kind) => {
    const baseline = await run(kind);
    const f = fixture(kind);
    let saved;
    f.scene.grid.clearAttackHighlights = () => {
      saved ||= JSON.parse(f.storage.getItem('emblem_rogue_slot_1_run'));
    };
    await f.execute();
    const checkpoint = saved.battleInProgress.checkpoint;
    expect(checkpoint.pendingActionCompletion).toMatchObject({ kind: 'finish', unitName: 'Actor' });
    const restoredRun = RunManager.fromJSON(saved, data);
    const restored = journeyBattleScene(restoredRun, data);
    restored._battleSession = 1;
    restored.scene = { isActive: () => true };
    restored._addConditionIcon = () => {};
    Object.assign(restored.grid, {
      cols: 8,
      rows: 8,
      mapLayout: Array.from({ length: 8 }, () => Array(8).fill(0)),
      fogEnabled: false,
      getMoveCost: () => 1,
      getTerrainAt: () => data.terrain[0],
    });
    const suspend = new BattleSuspendController(restored);
    suspend.applyUnits(checkpoint);
    restored.turnManager = new TurnManager({
      onPhaseChange: () => {},
      checkBattleEnd: () => false,
    });
    restored.turnManager.init(restored.playerUnits, restored.enemyUnits, restored.npcUnits);
    suspend.finalizeResume(checkpoint);
    for (let step = 0; step < 20; step++) await Promise.resolve();
    expect(clean(restored.playerUnits)).toEqual(baseline.snapshot.players);
    expect(clean(restored.npcUnits)).toEqual(baseline.snapshot.npcs);
    expect(clean(restored._battleRecruits)).toEqual(baseline.snapshot.recruits);
    expect(restored._battleRng.getState()).toEqual(baseline.snapshot.rng);
    expect(restored.playerUnits.find((entry) => entry.name === 'Actor').hasActed).toBe(true);
  },
);

it('ballista damage is settled before a pending shot animation', async () => {
  const f = fixture('ballista hit');
  let release;
  f.scene._combatFx.ballistaShot = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  const shot = f.scene.processBallistaFire([f.target], 'enemy');
  expect(f.target.currentHP).toBe(15);
  const cursor = createBattleRng(7);
  cursor();
  cursor();
  expect(f.scene._battleRng.getState()).toEqual(cursor.getState());
  release();
  await shot;
  expect(f.target.currentHP).toBe(15);
});

it.each(['rally', 'circle', 'ensnare'])(
  'an empty %s ability choice retains its use',
  async (kind) => {
    const f = fixture(kind);
    f.scene.playerUnits = [f.actor];
    f.actor.currentHP = 20;
    f.scene.enemyUnits = [];
    expect(await f.execute()).toBe(false);
    expect(f.actor._battleAbilityUsage).toBeUndefined();
    expect(f.actor.hasActed).toBe(false);
    expect(f.scene.runManager.battleInProgress.checkpoint).toBeNull();
  },
);

it.each(['faction changed', 'already in army', 'actor is not a lord'])(
  'a stale Talk choice (%s) preserves the action and roster',
  async (reason) => {
    const f = fixture('talk');
    if (reason === 'faction changed') f.target.faction = 'player';
    if (reason === 'already in army') f.scene.playerUnits.push(f.target);
    if (reason === 'actor is not a lord') f.actor.isLord = false;
    const before = clean({
      players: f.scene.playerUnits,
      npcs: f.scene.npcUnits,
      rng: f.scene._battleRng.getState(),
    });
    expect(await f.execute()).toBe(false);
    expect(
      clean({
        players: f.scene.playerUnits,
        npcs: f.scene.npcUnits,
        rng: f.scene._battleRng.getState(),
      }),
    ).toEqual(before);
    expect(f.actor.hasActed).toBe(false);
    expect(f.target.unitUid).toBeUndefined();
    expect(f.target.consumables).toEqual([]);
  },
);

it.each(['shove', 'pull', 'dance'])(
  'a removed %s skill invalidates its previously selected action without changing state',
  async (kind) => {
    const f = fixture(kind);
    f.actor.skills = [];
    const before = clean({
      players: f.scene.playerUnits,
      rng: f.scene._battleRng.getState(),
      checkpoint: f.scene.runManager.battleInProgress.checkpoint,
    });
    const writes = f.storage.writes;
    expect(await f.execute()).toBe(false);
    expect(
      clean({
        players: f.scene.playerUnits,
        rng: f.scene._battleRng.getState(),
        checkpoint: f.scene.runManager.battleInProgress.checkpoint,
      }),
    ).toEqual(before);
    expect(f.storage.writes).toBe(writes);
    expect(f.actor.hasActed).toBe(false);
    expect(f.scene.showActionMenu).toHaveBeenCalledWith(f.actor);
  },
);
