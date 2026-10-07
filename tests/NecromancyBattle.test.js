// The Necromancer in BattleScene (rules: engine/Necromancy.js; presentation:
// ui/NecromancyController.js). Ways this breaks:
//   - a raise draws from the battle's Math.random, or the scene raises a Skeleton the
//     harness would not (or on another tile)
//   - the fog leaks: a banner or effect for a raise the player cannot see, an arrival marker
//   - a Necromancer's fall leaves its Skeletons on the board (the Rout is never won), or takes
//     another Necromancer's, or pays gold / XP for them
//   - a raised unit pays gold, a full share of XP or a deed
//   - a suspend loses the raise or the link to its Necromancer; a resume before the raise raises
//     a different Skeleton; a rewind keeps the raise
//   - a Skeleton the fog hides changes a preview (Danger, Threat Sight, blue range)
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
    Math: { Clamp: (val, min, max) => Math.max(min, Math.min(max, val)) },
  },
}));

import { BattleScene } from '../src/scenes/BattleScene.js';
import { Grid } from '../src/engine/Grid.js';
import { ThreatSightController } from '../src/ui/ThreatSightController.js';
import { threatSummaryText } from '../src/engine/ThreatForecast.js';
import { BattleSuspendController } from '../src/ui/BattleSuspendController.js';
import { VisionRewindController } from '../src/ui/VisionRewindController.js';
import { captureBattleState } from '../src/ui/BattleCheckpointAdapter.js';
import { validateBattleState } from '../src/engine/BattleStateSnapshot.js';
import { serializeBattleUnit } from '../src/engine/BattleUnitState.js';
import { registerBattleEntity, resetBattleIdentities } from '../src/engine/BattleEntityIdentity.js';
import {
  calculateCombatXP,
  createEnemyUnit,
  createPromotedEnemyUnit,
  createUnit,
} from '../src/engine/UnitManager.js';
import { skeletonsOf } from '../src/engine/Necromancy.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const classOf = (name) => data.classes.find((c) => c.name === name);
const T = Object.fromEntries(data.terrain.map((t, i) => [t.name, i]));

afterEach(() => vi.restoreAllMocks());

function stubDisplay() {
  const obj = new Proxy(
    {},
    { get: (t, p) => (p === 'destroy' || p === 'visible' ? undefined : () => obj) },
  );
  return obj;
}

const necromancer = (col, row, { level = 15, id = null, scene = null } = {}) => {
  const unit = createPromotedEnemyUnit(
    classOf('Necromancer'),
    level,
    data.weapons,
    1,
    data.skills,
    'act4',
    data.classes,
  );
  Object.assign(unit, { col, row, aiMode: 'guard' });
  if (id) unit.battleEntityId = id;
  if (scene) registerBattleEntity(scene, unit);
  return unit;
};

const fighter = (col, row) => {
  const unit = createEnemyUnit(classOf('Fighter'), 10, data.weapons, 1, data.skills, 'act4');
  return Object.assign(unit, { col, row });
};

const edric = (col, row) =>
  Object.assign(createUnit(classOf('Fighter'), 12, data.weapons, { name: 'Edric' }), {
    faction: 'player',
    isLord: true,
    isCommander: true,
    col,
    row,
  });

/**
 * A rout on an 10x10 plain with a wall at (7,6), Edric far off, `enemies` as given; the
 * fog hides every tile at column 6 or beyond when `fog` is true.
 */
function battle({ enemies = [], fog = false, walls = [] } = {}) {
  const scene = new BattleScene();
  const player = edric(0, 0);
  const wallSet = new Set(walls.map(([c, r]) => `${c},${r}`));
  Object.assign(scene, {
    _battleSession: 1,
    runManager: null,
    playerUnits: [player],
    enemyUnits: enemies,
    npcUnits: [],
    escapedUnits: [],
    nonDeployedUnits: [],
    _zombieTombstones: [],
    battleState: 'ENEMY_PHASE',
    turnManager: { currentPhase: 'enemy', turnNumber: 3 },
    battleConfig: { objective: 'rout', cols: 10, rows: 10 },
    battleParams: { act: 'act4', difficultyId: 'lunatic', battleSeed: 4242, difficultyMod: 1 },
    gameData: { ...data, affixes: { affixes: [] } },
    registry: { get: () => null },
    goldEarned: 0,
    grid: {
      cols: 10,
      rows: 10,
      fogEnabled: fog,
      isVisible: (c) => !fog || c < 6,
      getTerrainAt: (c, r) => ({ moveCost: { Infantry: wallSet.has(`${c},${r}`) ? '--' : '1' } }),
      gridToPixel: (c, r) => ({ x: c * 32 + 16, y: r * 32 + 16 }),
      clearTemporaryTerrainsBySource: vi.fn(),
      clearHighlights: vi.fn(),
      clearAttackHighlights: vi.fn(),
      clearPath: vi.fn(),
    },
    addUnitGraphic: vi.fn((unit) => registerBattleEntity(scene, unit)),
    removeUnitGraphic: vi.fn(),
    updateEnemyVisibility: vi.fn(),
    updateObjectiveText: vi.fn(),
    showBriefBanner: vi.fn(async () => {}),
    getTurnPressureState: () => ({ goldMultiplier: 1, xpMultiplier: 1 }),
    onVictory: vi.fn(() => (scene.battleState = 'BATTLE_END')),
    onDefeat: vi.fn(),
    _combatFx: { raise: vi.fn(async () => {}), deathFade: vi.fn(async () => {}) },
    _inputController: null,
    _pinnedThreats: { invalidate: vi.fn() },
  });
  resetBattleIdentities(scene);
  registerBattleEntity(scene, player);
  for (const unit of enemies) registerBattleEntity(scene, unit);
  scene.getUnitAt = (c, r) =>
    [...scene.playerUnits, ...scene.enemyUnits].find(
      (u) => u.currentHP > 0 && !u._removing && u.col === c && u.row === r,
    ) || null;
  return { scene, player };
}

describe('the scene raises like the harness: at the phase start, from the keyed stream', () => {
  it('raises one beside the Necromancer, draws nothing from Math.random, and acts this phase', async () => {
    const { scene } = battle({});
    const necro = necromancer(4, 4, { scene });
    scene.enemyUnits.push(necro);
    const random = vi.spyOn(Math, 'random');
    await scene.processNecromancy();
    const [sk] = skeletonsOf(necro, scene.enemyUnits);
    expect(sk).toMatchObject({
      className: 'Skeleton',
      col: 3, // left, right, up, down: the first free one
      row: 4,
      hasActed: false,
      _raisedBy: necro.battleEntityId,
    });
    expect(scene.addUnitGraphic).toHaveBeenCalledWith(sk);
    expect(scene.updateEnemyVisibility).not.toHaveBeenCalled(); // no fog: nothing to hide
    // The whole phase's worth: a second, then no more.
    await scene.processNecromancy();
    await scene.processNecromancy();
    expect(random).not.toHaveBeenCalled();
    expect(skeletonsOf(necro, scene.enemyUnits).map((s) => [s.col, s.row])).toEqual([
      [3, 4],
      [5, 4],
    ]);
  });

  it('skips a blocked neighbour and an impassable one; none free means none raised', async () => {
    const { scene } = battle({ walls: [[5, 4]] });
    const necro = necromancer(4, 4, { scene });
    const blocker = fighter(3, 4);
    scene.enemyUnits.push(necro, blocker);
    registerBattleEntity(scene, blocker);
    await scene.processNecromancy();
    expect(skeletonsOf(necro, scene.enemyUnits).map((s) => [s.col, s.row])).toEqual([[4, 3]]);
    // Fill the last free neighbour (down): the next raise has no tile.
    const filler = fighter(4, 5);
    scene.enemyUnits.push(filler);
    const before = scene.enemyUnits.length;
    await scene.processNecromancy();
    expect(scene.enemyUnits).toHaveLength(before);
  });

  it('is the same Skeleton the headless harness raises for the same Necromancer, turn and seed', async () => {
    const { scene } = battle({});
    const necro = necromancer(4, 4, { scene, id: 'u9' });
    scene.enemyUnits.push(necro);
    await scene.processNecromancy();
    const [sk] = skeletonsOf(necro, scene.enemyUnits);
    // The pure rule the harness calls, with the same seed (battleParams.battleSeed) and turn.
    const { raiseFor } = await import('../src/engine/Necromancy.js');
    const direct = raiseFor(necro, {
      enemyUnits: [necro],
      cols: 10,
      rows: 10,
      isOccupied: () => false,
      moveCostAt: () => '1',
      classes: data.classes,
      weapons: data.weapons,
      seed: 4242,
      turn: 3,
      difficultyConfig: { multiplier: 1, enemyStatBonus: 0, classStatBonuses: {}, skillChanceBonus: 0 }, // prettier-ignore
    });
    expect(direct.unit.weapon).toEqual(sk.weapon);
    expect(direct.unit.stats).toEqual(sk.stats);
    expect(direct.unit.growths).toEqual(sk.growths);
    expect(direct.unit.level).toBe(sk.level);
  });
});

describe('the fog keeps its secret', () => {
  it('a raise the player sees has a banner and an effect', async () => {
    const { scene } = battle({ fog: true });
    const necro = necromancer(3, 4, { scene }); // column 3: visible; its Skeleton lands on 2
    scene.enemyUnits.push(necro);
    await scene.processNecromancy();
    expect(scene.showBriefBanner).toHaveBeenCalledWith('Necromancer raises a Skeleton!', expect.anything()); // prettier-ignore
    const [sk] = skeletonsOf(necro, scene.enemyUnits);
    expect(scene._combatFx.raise).toHaveBeenCalledWith(sk);
    expect(scene.updateEnemyVisibility).toHaveBeenCalled();
  });

  it('a raise in fog: no banner, no effect, no arrival marker, the unit hidden like any foe', async () => {
    const { scene } = battle({ fog: true });
    scene.showReinforcementBanner = vi.fn();
    scene.runManager = { battleInProgress: { rewindPolicy: 'fixed-v1' } };
    const necro = necromancer(8, 4, { scene }); // column 8: fogged; so is its Skeleton at 7
    scene.enemyUnits.push(necro);
    await scene.processNecromancy();
    expect(skeletonsOf(necro, scene.enemyUnits)).toHaveLength(1);
    expect(scene.showBriefBanner).not.toHaveBeenCalled();
    expect(scene._combatFx.raise).not.toHaveBeenCalled();
    expect(scene.showReinforcementBanner).not.toHaveBeenCalled();
    expect(scene._reinforcements).toBeUndefined();
    expect(scene.updateEnemyVisibility).toHaveBeenCalled(); // the fog update hides the new unit
    // Nothing of it reaches the action history either: neither end of the raise is seen.
    expect(scene._historyBeats || []).toEqual([]);
  });

  it('a Skeleton raised at the edge of the light is told only as seen: the actor stays "Unseen enemy"', async () => {
    const { scene } = battle({ fog: true });
    scene.runManager = { battleInProgress: { rewindPolicy: 'fixed-v1' } };
    // The Necromancer stands in fog (6), its Skeleton raised on 5 (visible).
    scene.battleParams.battleSeed = 1;
    const necro = necromancer(6, 4, { scene });
    scene.enemyUnits.push(necro);
    await scene.processNecromancy();
    const [beat] = scene._historyBeats;
    expect(beat.label).toBe('Unseen enemy raised Skeleton.');
    expect(beat.actorId).toBeNull();
    expect(beat.actorPosition).toBeNull();
  });
});

describe('a Necromancer falls through BattleScene.removeUnit', () => {
  async function twoNecromancers() {
    const ctx = battle({});
    const a = necromancer(2, 4, { scene: ctx.scene });
    const b = necromancer(7, 7, { scene: ctx.scene });
    ctx.scene.enemyUnits.push(a, b);
    for (let i = 0; i < 2; i++) await ctx.scene.processNecromancy();
    return { ...ctx, a, b };
  }

  it("its Skeletons crumble with no killer (no gold, no XP) and another Necromancer's stay", async () => {
    const { scene, player, a, b } = await twoNecromancers();
    expect(skeletonsOf(a, scene.enemyUnits)).toHaveLength(2);
    expect(skeletonsOf(b, scene.enemyUnits)).toHaveLength(2);
    const mine = skeletonsOf(a, scene.enemyUnits);
    const keep = skeletonsOf(b, scene.enemyUnits);
    scene.runManager = {};
    const xp = vi.spyOn(scene, 'awardXP').mockResolvedValue();
    await scene.removeUnit(a, { killer: player });
    expect(scene.enemyUnits).not.toContain(a);
    for (const sk of mine) expect(scene.enemyUnits).not.toContain(sk);
    expect(skeletonsOf(b, scene.enemyUnits)).toEqual(keep);
    expect(scene.enemyUnits).toContain(b);
    // Gold: only the Necromancer's own kill reward; XP: removeUnit grants none (combat did).
    const { calculateKillReward } = await import('../src/engine/LootSystem.js');
    expect(scene.goldEarned).toBe(calculateKillReward(a, player, { rewardMultiplier: 1 }));
    expect(xp).not.toHaveBeenCalled();
    for (const sk of mine) expect(scene.removeUnitGraphic).toHaveBeenCalledWith(sk);
    // Seen crumbles fall with the bone-dust effect; each Skeleton once.
    expect(scene._combatFx.deathFade.mock.calls.map((c) => c[0])).toEqual(
      expect.arrayContaining(mine),
    );
  });

  it('a Rout is won the moment the Necromancer, the last living foe, falls', async () => {
    const { scene, player } = battle({});
    const necro = necromancer(4, 4, { scene });
    scene.enemyUnits.push(necro);
    for (let i = 0; i < 2; i++) await scene.processNecromancy();
    expect(scene.enemyUnits).toHaveLength(3);
    expect(scene.checkBattleEnd()).toBe(false);
    await scene.removeUnit(necro, { killer: player });
    expect(scene.enemyUnits).toEqual([]);
    expect(scene.checkBattleEnd()).toBe(true);
    expect(scene.onVictory).toHaveBeenCalledTimes(1);
  });

  it('the Skeletons dying first do not end the Rout while the Necromancer stands', async () => {
    const { scene, player } = battle({});
    const necro = necromancer(4, 4, { scene });
    scene.enemyUnits.push(necro);
    for (let i = 0; i < 2; i++) await scene.processNecromancy();
    for (const sk of skeletonsOf(necro, scene.enemyUnits)) await scene.removeUnit(sk, { killer: player }); // prettier-ignore
    expect(scene.enemyUnits).toEqual([necro]);
    expect(scene.checkBattleEnd()).toBe(false);
    // And it raises again the next phase.
    await scene.processNecromancy();
    expect(skeletonsOf(necro, scene.enemyUnits)).toHaveLength(1);
  });

  it('a crumble in fog plays no fall, but the Skeleton is still gone', async () => {
    const { scene, player } = battle({ fog: true });
    const necro = necromancer(8, 4, { scene }); // fogged
    scene.enemyUnits.push(necro);
    await scene.processNecromancy();
    const [sk] = skeletonsOf(necro, scene.enemyUnits);
    await scene.removeUnit(necro, { killer: player });
    expect(scene.enemyUnits).not.toContain(sk);
    expect(scene._combatFx.deathFade).not.toHaveBeenCalledWith(sk);
  });
});

describe('what a raised unit pays through the scene', () => {
  async function raised() {
    const { scene, player } = battle({});
    const necro = necromancer(4, 4, { scene });
    scene.enemyUnits.push(necro);
    await scene.processNecromancy();
    return { scene, player, necro, sk: skeletonsOf(necro, scene.enemyUnits)[0] };
  }

  it('multipliers: gold 0, XP a quarter (the Necromancer itself pays in full)', async () => {
    const { scene, necro, sk } = await raised();
    expect(scene.getEnemyRewardMultiplier(sk)).toBe(0);
    expect(scene.getEnemyXpMultiplier(sk)).toBe(0.25);
    expect(scene.getEnemyRewardMultiplier(necro)).toBe(1);
    expect(scene.getEnemyXpMultiplier(necro)).toBe(1);
  });

  it('a killing blow on a Skeleton awards a quarter of the XP; none of it is a deed record', async () => {
    const { scene, player, sk } = await raised();
    scene.awardScaledXP = vi.fn(async () => {});
    // A level 1 recruit meets a level 1 Skeleton: 25 + 15 raw, a number the quarter shows in.
    Object.assign(player, { level: 1, tier: 'base' });
    const base = calculateCombatXP(player, sk, true);
    expect(base).toBe(40);
    await BattleScene.prototype.awardXP.call(scene, player, sk, true);
    expect(scene.awardScaledXP).toHaveBeenCalledWith(player, Math.floor(base * 0.25));
  });

  it('the kill pays no gold, while the same kill of an ordinary foe does', async () => {
    const { scene, player, sk } = await raised();
    scene.runManager = {};
    await scene.removeUnit(sk, { killer: player });
    expect(scene.goldEarned).toBe(0);
    const grunt = fighter(8, 8);
    registerBattleEntity(scene, grunt);
    scene.enemyUnits.push(grunt);
    await scene.removeUnit(grunt, { killer: player });
    expect(scene.goldEarned).toBeGreaterThan(0);
  });
});

describe('saves and rewind', () => {
  /** A scene with the pieces a checkpoint reads and writes (as ZombieRemainsBattle's). */
  function saveScene(enemies = []) {
    const scene = {
      _battleSession: 1,
      playerUnits: [],
      enemyUnits: [],
      npcUnits: [],
      escapedUnits: [],
      nonDeployedUnits: [],
      battleState: 'PLAYER_IDLE',
      turnManager: { currentPhase: 'player', turnNumber: 3 },
      _zombieTombstones: [],
      grid: {
        mapLayout: Array.from({ length: 10 }, () => Array(10).fill(0)),
        temporaryTerrains: [],
        fogEnabled: false,
        cols: 10,
        rows: 10,
        isVisible: () => true,
        getTerrainAt: () => ({ moveCost: { Infantry: '1' } }),
        gridToPixel: (c, r) => ({ x: c * 32 + 16, y: r * 32 + 16 }),
      },
      runManager: { convoy: { weapons: [], consumables: [] }, accessories: [], gold: 0 },
      battleConfig: { cols: 10, rows: 10, objective: 'rout' },
      battleParams: { act: 'act4', difficultyId: 'lunatic', battleSeed: 4242 },
      gameData: { ...data },
      addUnitGraphic: vi.fn((unit) => registerBattleEntity(scene, unit)),
      dimUnit() {},
    };
    scene.getUnitAt = (c, r) =>
      [...scene.playerUnits, ...scene.enemyUnits].find((u) => u.col === c && u.row === r) || null;
    scene.getReinforcementSeed = () => 4242;
    resetBattleIdentities(scene);
    const lord = edric(0, 0);
    registerBattleEntity(scene, lord);
    scene.playerUnits.push(lord);
    for (const unit of enemies) {
      registerBattleEntity(scene, unit);
      scene.enemyUnits.push(unit);
    }
    return scene;
  }
  const raiseOn = async (scene) => {
    const { NecromancyController } = await import('../src/ui/NecromancyController.js');
    scene.showBriefBanner = async () => {};
    scene._combatFx = { raise: async () => {}, deathFade: async () => {} };
    scene.turnManager = { currentPhase: 'enemy', turnNumber: 3 };
    await new NecromancyController(scene).processRaises();
  };
  const roundTrip = (scene) => {
    const state = JSON.parse(JSON.stringify(captureBattleState(scene, { rngSeed: 7 })));
    expect(validateBattleState(state)).toBe(true);
    return state;
  };

  it('a suspend after a raise resumes with the Skeleton still linked to its Necromancer', async () => {
    const scene = saveScene([necromancer(4, 4, { id: 'u2' })]);
    await raiseOn(scene);
    const [necro] = scene.enemyUnits;
    const [sk] = skeletonsOf(necro, scene.enemyUnits);
    expect(sk._raisedBy).toBe('u2');
    const state = roundTrip(scene);
    const restored = saveScene();
    restored.playerUnits = [];
    new BattleSuspendController(restored).applyUnits(state);
    const [rn, rs] = restored.enemyUnits;
    expect(rn.className).toBe('Necromancer');
    expect(rn.battleEntityId).toBe(necro.battleEntityId);
    expect(rs).toMatchObject({ className: 'Skeleton', _raisedBy: rn.battleEntityId });
    expect(skeletonsOf(rn, restored.enemyUnits)).toEqual([rs]);
    // The lifetime count rides the Necromancer through the save.
    expect(necro._raisedCount).toBe(1);
    expect(rn._raisedCount).toBe(1);
    // The restored Skeleton's weapon is the one in its inventory (identity survives JSON).
    expect(rs.weapon).toBe(rs.inventory[0]);
    expect(serializeBattleUnit(rs)).toEqual(serializeBattleUnit(sk));
    // It counts toward the Necromancer's two: one more raise, then no more.
    await raiseOn(restored);
    await raiseOn(restored);
    expect(skeletonsOf(rn, restored.enemyUnits)).toHaveLength(2);
  });

  it('a suspend keeps a spent cap: a Necromancer that raised six raises no more after the resume', async () => {
    const spent = necromancer(4, 4, { id: 'u2' });
    spent._raisedCount = 6;
    const scene = saveScene([spent]);
    const state = roundTrip(scene);
    const restored = saveScene();
    restored.playerUnits = [];
    new BattleSuspendController(restored).applyUnits(state);
    expect(restored.enemyUnits[0]._raisedCount).toBe(6);
    await raiseOn(restored);
    expect(restored.enemyUnits).toHaveLength(1);
    // One short of it: exactly one more raise, then none.
    const nearly = necromancer(4, 4, { id: 'u2' });
    nearly._raisedCount = 5;
    const again = saveScene();
    again.playerUnits = [];
    new BattleSuspendController(again).applyUnits(roundTrip(saveScene([nearly])));
    await raiseOn(again);
    expect(again.enemyUnits).toHaveLength(2);
    expect(again.enemyUnits[0]._raisedCount).toBe(6);
    await raiseOn(again);
    expect(again.enemyUnits).toHaveLength(2);
  });

  it('a resume before the raise replays it identically', async () => {
    const live = saveScene([necromancer(4, 4, { id: 'u2' })]);
    const before = roundTrip(live); // the checkpoint of the player phase's end
    await raiseOn(live);
    const [liveNecro] = live.enemyUnits;
    const [liveSkeleton] = skeletonsOf(liveNecro, live.enemyUnits);

    const resumed = saveScene();
    resumed.playerUnits = [];
    new BattleSuspendController(resumed).applyUnits(before);
    expect(resumed.enemyUnits).toHaveLength(1);
    await raiseOn(resumed);
    const [resumedSkeleton] = skeletonsOf(resumed.enemyUnits[0], resumed.enemyUnits);
    expect(serializeBattleUnit(resumedSkeleton)).toEqual(serializeBattleUnit(liveSkeleton));
  });

  it('a Vision rewind to before the raise takes the Skeleton away; raising again gives the same one', async () => {
    const { scene } = battle({});
    const necro = necromancer(4, 4, { scene, id: null });
    scene.enemyUnits.push(necro);
    registerBattleEntity(scene, necro);
    Object.assign(scene, {
      add: new Proxy({}, { get: () => () => stubDisplay() }),
      cameras: { main: { width: 640, height: 480, centerX: 320, centerY: 240 } },
      tweens: { add: vi.fn(), killTweensOf: vi.fn() },
      hideForecast: vi.fn(),
      cleanupTradeUI: vi.fn(),
      reseedBattleRng: vi.fn(),
      updateTopLeftHudLayout: vi.fn(),
      isStoryInputLocked: () => false,
      getBestLordThroneDistance: () => 5,
      getTurnPressureSummary: () => '',
      aiController: { setAggressiveMode: vi.fn() },
      antiTurtleState: {},
      ballistas: [],
      commitVisionSnapshotIfPending: BattleScene.prototype.commitVisionSnapshotIfPending,
    });
    necro._raisedCount = 3; // three raised earlier in the battle, before the snapshot
    const vision = new VisionRewindController(scene, null);
    scene._visionController = vision;
    vision.captureSnapshot();
    await scene.processNecromancy();
    expect(necro._raisedCount).toBe(4);
    const [first] = skeletonsOf(necro, scene.enemyUnits);
    expect(first).toBeTruthy();
    const firstData = serializeBattleUnit(first);
    expect(vision._applySnapshot()).toBe(true);
    // The rewind rebuilds the roster from the snapshot: one Necromancer, no Skeleton.
    expect(scene.enemyUnits.map((u) => u.className)).toEqual(['Necromancer']);
    const [restoredNecro] = scene.enemyUnits;
    expect(restoredNecro.battleEntityId).toBe(necro.battleEntityId);
    expect(skeletonsOf(restoredNecro, scene.enemyUnits)).toEqual([]);
    // The count went back with the Skeleton: the rewound raise is not spent.
    expect(restoredNecro._raisedCount).toBe(3);
    await scene.processNecromancy();
    expect(restoredNecro._raisedCount).toBe(4);
    const [again] = skeletonsOf(restoredNecro, scene.enemyUnits);
    expect(serializeBattleUnit(again)).toEqual(firstData);
  });
});

describe('a Skeleton the fog hides changes no preview', () => {
  const mockGridScene = () => {
    const stub = new Proxy({}, { get: (t, p) => (p === 'destroy' ? () => {} : () => stub) });
    return {
      cameras: { main: { width: 640, height: 480 } },
      add: { rectangle: () => stub, image: () => stub, text: () => stub, container: () => stub },
      textures: { exists: () => false },
    };
  };
  function makeGrid(rows, hidden) {
    const map = rows.map((line) => [...line].map(() => T.Plain));
    const grid = new Grid(mockGridScene(), map[0].length, map.length, data.terrain, map, true);
    grid.isVisible = (col, row) => !hidden.has(`${col},${row}`);
    return grid;
  }
  const foe = (col, row, extra = {}) => ({
    name: 'Fighter',
    faction: 'enemy',
    col,
    row,
    currentHP: 20,
    mov: 3,
    stats: { MOV: 3, HP: 20 },
    moveType: 'Infantry',
    weapon: { name: 'Iron Axe', type: 'Axe', range: '1' },
    ...extra,
  });
  const hero = (col, row) => ({
    name: 'Edric',
    faction: 'player',
    col,
    row,
    currentHP: 20,
    mov: 5,
    stats: { MOV: 5, HP: 20 },
    moveType: 'Infantry',
    weapon: { name: 'Iron Sword', type: 'Sword', range: '1' },
  });
  /** A corridor with a visible Fighter at (8,0); (5,0) is fogged and hides a Skeleton in one world. */
  function worlds() {
    return [false, true].map((withSkeleton) => {
      const visible = foe(8, 0);
      const player = hero(0, 0);
      const skeleton = foe(5, 0, {
        name: 'Skeleton',
        className: 'Skeleton',
        _raisedBy: 'u3',
        battleEntityId: 'u9',
      });
      const scene = new BattleScene();
      Object.assign(scene, {
        _battleSession: 1,
        grid: makeGrid(['..........'], new Set(['5,0'])),
        enemyUnits: withSkeleton ? [visible, skeleton] : [visible],
        playerUnits: [player],
        npcUnits: [],
        ballistas: [],
        gameData: { skills: [] },
      });
      return { scene, visible, player };
    });
  }
  const counts = (tiles) =>
    Object.fromEntries(tiles.map((t) => [`${t.col},${t.row}`, t.count]).sort());

  it("Danger, one enemy's reach and Threat Sight read the same", () => {
    const [a, b] = worlds();
    const danger = counts(a.scene.calculateDangerZone());
    expect(danger['4,0']).toBe(1); // the visible Fighter's stop: the hidden one does not block it
    expect(counts(b.scene.calculateDangerZone())).toEqual(danger);
    expect(counts(b.scene.calculateDangerZone(b.visible))).toEqual(
      counts(a.scene.calculateDangerZone(a.visible)),
    );
    const text = (w) => threatSummaryText(new ThreatSightController(w.scene).query(w.player, 4, 0));
    expect(text(b)).toBe(text(a));
  });

  it('the blue range and the known positions never include it', () => {
    const [a, b] = worlds();
    expect([...b.scene.buildUnitPositionMap().keys()].sort()).toEqual(
      [...a.scene.buildUnitPositionMap().keys()].sort(),
    );
    expect(b.scene.buildUnitPositionMap().has('5,0')).toBe(false);
    const range = (w) =>
      [
        ...w.scene.grid
          .getMovementRange(0, 0, 8, 'Infantry', w.scene.buildUnitPositionMap(), 'player')
          .keys(),
      ].sort();
    expect(range(b)).toEqual(range(a));
  });
});
