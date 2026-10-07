// Blink Strike's durable boundary (docs/specs/phase3.md 3E, "Confirm settles the warp and the
// combat as one action, with one checkpoint"), on the production checkpoint, resume, timeline
// and rewind path (the journey harness, as tests/CombatBoundaryPresentation.test.js and
// tests/RewindSmiteTransfuse.test.js). The player's choices are in tests/BlinkStrike.test.js.
//
// What "one checkpoint" means here. An ordinary attack makes two durable writes: the intent
// (saved before any roll is revealed, so a refresh replays the same blow) and the resolved
// action. Blink Strike must make exactly those two and no more: the warp never gets a durable
// state of its own, so there is no checkpoint in which the unit stands on the destination
// without its attack pending, or has attacked without having warped.
//
// Ways this goes wrong, each caught below:
//   checkpoints  a third write (the warp saved alone); the first write holding the unit still
//                on its old tile or the use unspent; the intent forgetting it was a warp
//   the attack   a different outcome from the same attack made from the destination; the unit
//                left off its destination; Canto offered after it
//   resume       a refresh after the intent that replays a different blow, forgets the warp, or
//                offers Canto
//   rewind       a rewind that leaves the unit on the destination, the use spent, or the foe
//                hurt; a rewind row that does not name the action
//   failure      a hidden occupant letting the unit land on another unit, or not spending the use
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
vi.mock('../src/ui/ForecastOverlay.js', () => ({
  ForecastOverlay: class {
    constructor() {
      this.displayObjects = [];
    }
    render() {}
    destroy() {}
  },
}));
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
import { AbilityController } from '../src/ui/AbilityController.js';
import { VisionRewindController } from '../src/ui/VisionRewindController.js';
import { BattleSuspendController } from '../src/ui/BattleSuspendController.js';
import { readCommittedAction } from '../src/ui/BattlePresentationCheckpoint.js';
import { serializeBattleUnit } from '../src/engine/BattleUnitState.js';
import { canUseAbility } from '../src/engine/ActionAbilitySystem.js';
import { _resetUidCounter } from '../src/utils/itemUid.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const SKILL = data.skills.find((s) => s.id === 'blink_strike');
const originalRandom = Math.random;
const plain = data.terrain.find((entry) => entry.name === 'Plain');
const sword = {
  name: 'Test Sword',
  type: 'Sword',
  rankRequired: 'Prof',
  might: 5,
  hit: 100,
  crit: 0,
  weight: 0,
  range: '1',
};
const axe = {
  name: 'Test Axe',
  type: 'Axe',
  rankRequired: 'Prof',
  might: 8,
  hit: 100,
  crit: 0,
  weight: 0,
  range: '1',
};

beforeEach(() => {
  pickers.length = 0;
});
afterEach(() => {
  Math.random = originalRandom;
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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
    hasMoved: false,
    ...extra,
  };
}

// Strip only presentation references and wall-clock metadata.
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

/**
 * An 8×8 battle on the production scene: the commander (0,0), the striker Fighter (1,2)
 * with Blink Strike (and Canto, to prove it is not offered), and a foe at (6,2). The warp's
 * only tile is (5,2), four tiles from the striker.
 */
function world({ ordinary = false, canto = false } = {}) {
  _resetUidCounter();
  Math.random = createBattleRng(42);
  vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  reportAsyncError.mockClear();
  const storage = new JourneyStorage();
  vi.stubGlobal('localStorage', storage);
  const driver = new RunDriver(storage);
  driver.run.runRecordId = 'blink-strike-run';
  driver.run.visionChargesRemaining = 3;
  driver.run.beginBattleInProgress(driver.run.nodeMap.nodes[0].id, { battleParams: {} });
  const scene = journeyBattleScene(driver.run, data);
  Object.assign(scene, {
    _clearCombatRollSession: BattleScene.prototype._clearCombatRollSession,
    _clearSelectedWeaponArt: BattleScene.prototype._clearSelectedWeaponArt,
    _battleSession: 1,
    _sceneShutdownCleanedUp: false,
    scene: { isActive: () => true },
    sys: { isActive: () => true, settings: { active: true } },
    cameras: { main: { width: 640, height: 480, centerX: 320, centerY: 240 } },
    textures: { exists: () => false },
    _pinToScreen: () => {},
    _battleRewindPolicy: 'fixed-v1',
    _battleRng: createBattleRng(7),
    battleConfig: { objective: 'rout' },
    goldEarned: 0,
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
    getTerrainAt: () => plain,
    clearTemporaryTerrainsBySource() {},
    gridToPixel: (col, row) => ({ x: col * 32, y: row * 32 }),
    showAttackRange: () => {},
    showRelocateGuide: () => {},
  });
  const calls = presentationFailureProxy(scene, 0, { skipped: false });
  scene.grid.showAttackRange = calls.call(() => {}, 'grid.showAttackRange');
  scene.grid.showRelocateGuide = calls.call(() => {}, 'grid.showRelocateGuide');
  if (canto) {
    // What Canto needs after an attack: the shipping movement range and its menu.
    scene.grid.terrainData = data.terrain;
    scene.grid.getMovementRange = Grid.prototype.getMovementRange;
    scene.grid.reconstructIcePath = Grid.prototype.reconstructIcePath;
    scene.grid.findPath = Grid.prototype.findPath;
    scene._drawActionMenuRows = calls.call(() => {}, 'Canto menu');
    scene.time = { delayedCall: () => ({ remove() {} }) };
    scene.grid.showMovementRange = calls.call(() => {}, 'grid.showMovementRange');
  }
  const commander = unit('Edric', 'player', 0, 0, {
    isCommander: true,
    isLord: true,
    hasMoved: true,
  });
  const striker = unit('Fighter', 'player', ordinary ? 5 : 1, 2, {
    skills: [...(ordinary ? [] : ['blink_strike']), ...(canto ? ['canto'] : [])],
  });
  const foe = unit('Enemy', 'enemy', 6, 2);
  const reserve = unit('Reserve', 'enemy', 7, 7);
  scene.playerUnits = [commander, striker];
  scene.enemyUnits = [foe, reserve];
  for (const entry of [...scene.playerUnits, ...scene.enemyUnits]) {
    scene.addUnitGraphic(entry);
    entry.graphic = calls.visual;
    entry.hpBar = { bg: calls.visual, fill: calls.visual };
  }
  scene.turnManager = new TurnManager({
    onPhaseChange: () => {},
    checkBattleEnd: () => scene.checkBattleEnd(),
  });
  scene.turnManager.init(scene.playerUnits, scene.enemyUnits, scene.npcUnits);
  scene._battleCommanderId = commander.battleEntityId;
  scene._abilityController = new AbilityController(scene);
  scene._visionController = new VisionRewindController(scene, driver.run);
  vi.spyOn(scene._visionController, 'playRewindEffect').mockImplementation(() => {});
  // The turn's start: the timeline's first point and the snapshot a rewind returns to.
  scene.captureVisionSnapshot();
  scene._timelineBoundary = 'turn_start';
  expect(scene._captureSuspendCheckpoint({ session: scene._battleSession })).toBe(true);
  scene.selectedUnit = striker;
  scene.battleState = 'UNIT_ACTION_MENU';
  // Record every durable write the battle makes from here on.
  const writes = [];
  const capture = scene._captureSuspendCheckpoint.bind(scene);
  scene._captureSuspendCheckpoint = (options = {}) => {
    const saved = capture(options);
    writes.push({
      options,
      at: [striker.col, striker.row],
      usage: structuredClone(striker._battleAbilityUsage ?? null),
      hasActed: striker.hasActed,
      intent: structuredClone(scene._pendingCommittedAction ?? null),
      stored: storage.getItem('emblem_rogue_slot_1_run'),
    });
    return saved;
  };
  return { scene, storage, driver, calls, writes, commander, striker, foe, reserve };
}

/** Choose destination (5,2), then the foe, and confirm, as the player does. */
async function blinkStrike(ctx) {
  const { scene, striker } = ctx;
  const flow = scene._abilityController._warpStrike();
  expect(flow.begin(striker, SKILL)).toBe(true);
  scene.handleAbilityTileClick({ col: 5, row: 2 });
  scene.handleAbilityTileClick({ col: 6, row: 2 });
  await Promise.resolve();
  expect(scene.battleState).toBe('SHOWING_FORECAST');
  return flow.confirm();
}
/** The ordinary attack from the same tile: the oracle for the outcome. */
async function ordinaryAttack(ctx) {
  await ctx.scene.executeCombat(ctx.striker, ctx.foe);
}

/** What the exchange left: both units, the purse, the battle stream and where the scene is. */
const outcome = ({ scene }) => {
  const striker = scene.playerUnits.find((u) => u.name === 'Fighter');
  const foe = scene.enemyUnits.find((u) => u.name === 'Enemy');
  return {
    striker: {
      at: [striker.col, striker.row],
      hp: striker.currentHP,
      xp: striker.xp,
      hasActed: striker.hasActed,
      usage: striker._battleAbilityUsage ?? null,
    },
    foe: { at: [foe.col, foe.row], hp: foe.currentHP },
    gold: scene.goldEarned,
    rng: scene._battleRng.getState(),
    state: scene.battleState,
  };
};

describe('one action, the two checkpoints an attack always makes', () => {
  it('the first write already holds the warped unit, the spent use and the intent: no write for the warp alone', async () => {
    const ctx = world();
    await blinkStrike(ctx);
    const [first] = ctx.writes;
    expect(first.options.commitIntent).toBe(true);
    expect(first.at).toEqual([5, 2]);
    expect(first.usage).toEqual({ map: { blink_strike: 1 } });
    expect(first.hasActed).toBe(false);
    expect(first.intent).toMatchObject({
      kind: 'attack',
      unitName: 'Fighter',
      weaponArt: null,
      warpStrike: true,
    });
    // And what reached storage in that write is the same: a refresh here resumes the warped
    // unit with its attack pending.
    const stored = JSON.parse(first.stored).battleInProgress.checkpoint;
    const savedStriker = stored.playerUnits.find((u) => u.name === 'Fighter');
    expect([savedStriker.col, savedStriker.row]).toEqual([5, 2]);
    expect(savedStriker._battleAbilityUsage).toEqual({ map: { blink_strike: 1 } });
    expect(stored.pendingCommittedAction).toMatchObject({ kind: 'attack', warpStrike: true });
  });

  it('makes exactly as many durable writes as the same attack made without the warp', async () => {
    const warp = world();
    await blinkStrike(warp);
    const control = world({ ordinary: true });
    await ordinaryAttack(control);
    expect(warp.writes.length).toBe(control.writes.length);
    expect(warp.writes.map((w) => Boolean(w.options.commitIntent))).toEqual(
      control.writes.map((w) => Boolean(w.options.commitIntent)),
    );
    // Two: the intent, then the resolved action (no level-up, no kill).
    expect(warp.writes.map((w) => Boolean(w.options.commitIntent))).toEqual([true, false]);
  });

  it('the last write is the resolved action: acted, on the destination, use spent, intent cleared', async () => {
    const ctx = await (async () => {
      const c = world();
      await blinkStrike(c);
      return c;
    })();
    const last = ctx.writes.at(-1);
    expect(last.hasActed).toBe(true);
    expect(last.at).toEqual([5, 2]);
    expect(last.usage).toEqual({ map: { blink_strike: 1 } });
    expect(last.intent).toBeNull();
    const stored = JSON.parse(last.stored).battleInProgress.checkpoint;
    expect(stored.pendingCommittedAction ?? null).toBeNull();
    expect(stored.playerUnits.find((u) => u.name === 'Fighter')).toMatchObject({
      col: 5,
      row: 2,
      hasActed: true,
    });
    expect(reportAsyncError).not.toHaveBeenCalled();
  });

  it('is a single timeline action: one named rewind row', async () => {
    const ctx = world();
    await blinkStrike(ctx);
    ctx.scene.battleState = 'PLAYER_IDLE';
    expect(ctx.scene._visionController.requestRewind({ force: true })).toBe(true);
    const { rows } = pickers.at(-1).options.listing;
    expect(rows.map((r) => r.title)).toEqual(['Before Fighter’s Blink Strike on Enemy']);
  });
});

describe('the attack itself', () => {
  it('is the ordinary attack from the destination: same HP, XP, gold and RNG cursor', async () => {
    const warp = world();
    await blinkStrike(warp);
    const control = world({ ordinary: true });
    await ordinaryAttack(control);
    // Independent oracle: sword (5) + STR 10 − DEF 4 = 11 on a 22 HP foe; the foe counters with
    // 9 STR + 8 might − 6 DEF = 11 on the striker's 20 (a sword has no weapon-triangle edge
    // here: the triangle's sword beats axe: +1 / −1, so 12 dealt and 10 taken).
    expect(warp.foe.currentHP).toBe(22 - 12);
    expect(warp.striker.currentHP).toBe(20 - 10);
    expect(outcome(warp).foe).toEqual(outcome(control).foe);
    expect(outcome(warp).rng).toEqual(outcome(control).rng);
    expect(warp.striker.xp).toBe(control.striker.xp);
    expect([warp.striker.col, warp.striker.row]).toEqual([5, 2]);
    expect(warp.striker.hasActed).toBe(true);
  });

  it('never offers Canto afterwards, though the unit has it; the same attack made plainly does', async () => {
    const warp = world({ canto: true });
    await blinkStrike(warp);
    expect(warp.scene.battleState).toBe('PLAYER_IDLE');
    const control = world({ ordinary: true, canto: true });
    await ordinaryAttack(control);
    expect(control.scene.battleState).toBe('CANTO_MOVING');
  });

  it('spends the use for the battle, and the ability is then greyed', async () => {
    const ctx = world();
    await blinkStrike(ctx);
    expect(canUseAbility(ctx.striker, SKILL)).toEqual({ ok: false, reason: 'per_map_limit' });
  });

  it('draws the battle RNG exactly as the ordinary attack does: planning and warping add nothing', async () => {
    const warp = world();
    await blinkStrike(warp);
    const control = world({ ordinary: true });
    await ordinaryAttack(control);
    expect(warp.scene._battleRng.getState()).toEqual(control.scene._battleRng.getState());
  });
});

describe('a refresh after the intent', () => {
  it('resumes the warped unit, keeps it a Blink Strike, and finishes with the same outcome', async () => {
    const live = world();
    const resumeFrom = (() => {
      let stored = null;
      const capture = live.scene._captureSuspendCheckpoint;
      live.scene._captureSuspendCheckpoint = (options = {}) => {
        const saved = capture(options);
        if (options.commitIntent && stored === null)
          stored = live.storage.getItem('emblem_rogue_slot_1_run');
        return saved;
      };
      return () => stored;
    })();
    await blinkStrike(live);
    const expected = outcome(live);
    const saved = JSON.parse(resumeFrom());
    const intent = readCommittedAction(saved.battleInProgress.checkpoint.pendingCommittedAction);
    expect(intent).toMatchObject({ kind: 'attack', warpStrike: true });

    // A fresh scene from the stored checkpoint, as a refresh builds it.
    const fresh = world({ canto: true });
    fresh.scene.runManager = RunManager.fromJSON(saved, data);
    // The resumed battle re-seeds the live stream from the checkpoint (as the scene does).
    fresh.scene.reseedBattleRng = BattleScene.prototype.reseedBattleRng;
    fresh.scene.playerUnits = [];
    fresh.scene.enemyUnits = [];
    fresh.scene.npcUnits = [];
    const checkpoint = fresh.scene.runManager.battleInProgress.checkpoint;
    const suspend = new BattleSuspendController(fresh.scene);
    fresh.scene._battleSuspendController = suspend;
    suspend.applyUnits(checkpoint);
    fresh.scene.turnManager.init(fresh.scene.playerUnits, fresh.scene.enemyUnits, []);
    const striker = fresh.scene.playerUnits.find((u) => u.name === 'Fighter');
    // The checkpoint holds the warp: the unit is already there, the use already spent.
    expect([striker.col, striker.row]).toEqual([5, 2]);
    expect(striker._battleAbilityUsage).toEqual({ map: { blink_strike: 1 } });
    expect(striker.hasActed).toBe(false);

    let replay;
    fresh.scene._scheduleSafeDelayedAsync = (_delay, label, callback) => {
      expect(label).toBe('resume_committed_attack');
      replay = callback;
    };
    const combat = vi.spyOn(fresh.scene, 'executeCombat');
    suspend.finalizeResume(checkpoint);
    await replay();
    // The replay is the attack alone, still marked as a Blink Strike.
    expect(combat).toHaveBeenCalledTimes(1);
    expect(combat.mock.calls[0][2]).toEqual({ warpStrike: {} });
    // The same blow, the same purse, the same stream; and no Canto after a resumed
    // Blink Strike either (the unit has it, and the live run offered none).
    expect(outcome(fresh)).toEqual(expected);
    expect(expected.state).toBe('PLAYER_IDLE');
    expect(reportAsyncError).not.toHaveBeenCalled();
  });
});

describe('rewinding a Blink Strike', () => {
  it('puts the unit back on its tile, the foe at full HP and the use unspent', async () => {
    const ctx = world();
    const start = model({
      units: [...ctx.scene.playerUnits, ...ctx.scene.enemyUnits].map(serializeBattleUnit),
      rng: ctx.scene._battleRng.getState(),
    });
    await blinkStrike(ctx);
    expect(model({ units: [...ctx.scene.playerUnits, ...ctx.scene.enemyUnits].map(serializeBattleUnit) }).units).not.toEqual(start.units); // prettier-ignore
    ctx.scene.battleState = 'PLAYER_IDLE';
    expect(ctx.scene._visionController.requestRewind({ force: true })).toBe(true);
    const { rows } = pickers.at(-1).options.listing;
    pickers.at(-1).options.onConfirm(rows[0].id);

    const striker = ctx.scene.playerUnits.find((u) => u.name === 'Fighter');
    const foe = ctx.scene.enemyUnits.find((u) => u.name === 'Enemy');
    expect([striker.col, striker.row]).toEqual([1, 2]);
    expect(striker.currentHP).toBe(20);
    expect(striker.hasActed).toBe(false);
    expect(striker._battleAbilityUsage ?? null).toBeNull();
    expect(foe.currentHP).toBe(22);
    expect(canUseAbility(striker, SKILL).ok).toBe(true);
    expect(
      model({
        units: [...ctx.scene.playerUnits, ...ctx.scene.enemyUnits].map(serializeBattleUnit),
      }).units,
    ).toEqual(start.units);
  });
});

describe('a hidden occupant on the destination', () => {
  it('fails the warp, spends the use, leaves the unit where it was and ends the action with no Canto', async () => {
    const ctx = world();
    const { scene, striker } = ctx;
    const flow = scene._abilityController._warpStrike();
    flow.begin(striker, SKILL);
    scene.handleAbilityTileClick({ col: 5, row: 2 });
    scene.handleAbilityTileClick({ col: 6, row: 2 });
    await Promise.resolve();
    // A unit the player's view lacks, standing on the chosen tile in the real board.
    const ghost = unit('Ghost', 'enemy', 5, 2);
    const realAt = scene.getUnitAt.bind(scene);
    scene.getUnitAt = (col, row) => (col === 5 && row === 2 ? ghost : realAt(col, row));
    const foeHP = ctx.foe.currentHP;
    await flow.confirm();
    expect([striker.col, striker.row]).toEqual([1, 2]);
    expect(striker._battleAbilityUsage).toEqual({ map: { blink_strike: 1 } });
    expect(striker.hasActed).toBe(true);
    expect(ctx.foe.currentHP).toBe(foeHP); // no attack was made
    expect(scene.battleState).toBe('PLAYER_IDLE'); // no Canto
    // The spent use and the ended action are durable.
    const stored = JSON.parse(ctx.writes.at(-1).stored).battleInProgress.checkpoint;
    expect(stored.playerUnits.find((u) => u.name === 'Fighter')).toMatchObject({
      col: 1,
      row: 2,
      hasActed: true,
      _battleAbilityUsage: { map: { blink_strike: 1 } },
    });
    expect(reportAsyncError).not.toHaveBeenCalled();
  });
});

describe('the choices on this board', () => {
  it('the warp’s only tile is (5,2); a unit standing there leaves nothing to choose', () => {
    const ctx = world();
    const flow = ctx.scene._abilityController._warpStrike();
    expect(flow.options(ctx.striker, SKILL).map((o) => `${o.col},${o.row}`)).toEqual(['5,2']);
    ctx.scene.playerUnits.push(unit('Blocker', 'player', 5, 2));
    expect(flow.options(ctx.striker, SKILL)).toEqual([]);
  });
});
