// The Vigil in BattleScene (rules: engine/Vigil.js; presentation: ui/VigilController.js), on the
// review set piece (utils/devSetPieceFixtures.js `dev_vigil`). Ways this breaks:
//   - the scene speaks or calls differently from the harness for the same board, turn and seed
//   - the fog leaks: a banner or a rising effect for a Voice or a Hollowed the player cannot see,
//     a lit sigil for an unseen Voice; or the Seer's Eye is ignored
//   - "A Voice falls silent." plays for a fall in the fog, or not for one the player saw
//   - the markers show the wrong state (a shoved Voice's sigil still lit, a fallen Voice's circle
//     still open, a covered circle unmarked), ignore reduced motion, or redraw every frame
//   - a checkpoint loses the count, carries a malformed one past validation, or a resume replays
//     the phase step
//   - a drawing that fails cuts a call short (a Hollowed left off the roster, which the turn guard
//     never calls again), changes an identity, a count, the history or the battle stream, or stops
//     the enemy phase; a Voice's fall interrupted by a marker that fails to draw
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
    Math: { Clamp: (val, min, max) => Math.max(min, Math.min(max, val)) },
  },
}));

import { BattleScene } from '../src/scenes/BattleScene.js';
import { VigilController, VIGIL_BANNERS } from '../src/ui/VigilController.js';
import { BattleSuspendController } from '../src/ui/BattleSuspendController.js';
import { captureBattleState } from '../src/ui/BattleCheckpointAdapter.js';
import { validateBattleState } from '../src/engine/BattleStateSnapshot.js';
import { serializeBattleUnit } from '../src/engine/BattleUnitState.js';
import { registerBattleEntity, resetBattleIdentities } from '../src/engine/BattleEntityIdentity.js';
import { markFoesShown } from '../src/engine/BattleInformation.js';
import { createVigilState } from '../src/engine/Vigil.js';
import { createBattleRng } from '../src/engine/BattleRng.js';
import { withDevSetPiece } from '../src/utils/devSetPieceFixtures.js';
import { GameDriver } from './harness/GameDriver.js';
import { installSeed, restoreMathRandom } from '../sim/lib/SeededRNG.js';
import { loadGameData } from './testData.js';

const data = withDevSetPiece(loadGameData(), 'dev_vigil');
const VOICES = ['voice_calling', 'voice_binding', 'voice_feeding', 'voice_waking'];

afterEach(() => {
  restoreMathRandom();
  vi.restoreAllMocks();
});

/** The harness's Vigil battle at its start (seed 3: the authored, unmirrored layout). */
function harness(seed = 3) {
  installSeed(seed);
  const driver = new GameDriver(data, {
    act: 'finalBoss',
    objective: 'rout',
    setPiece: 'dev_vigil',
    battleSeed: seed,
    difficultyId: 'hard',
    deployCount: 2,
  });
  driver.init();
  restoreMathRandom();
  return driver.battle;
}

/**
 * A BattleScene on the same board as a fresh harness battle (units copied), mid enemy phase.
 * `visible`: tiles the player sees ("col,row"; null: no fog).
 */
function sceneOf({ seed = 3, visible = null, edit = null } = {}) {
  const b = harness(seed);
  edit?.(b);
  const scene = new BattleScene();
  const copy = (units) => units.map((u) => structuredClone(serializeBattleUnit(u)));
  const seen = visible ? new Set(visible) : null;
  Object.assign(scene, {
    _battleSession: 1,
    runManager: null,
    playerUnits: copy(b.playerUnits),
    enemyUnits: copy(b.enemyUnits),
    npcUnits: [],
    escapedUnits: [],
    nonDeployedUnits: [],
    _zombieTombstones: [],
    _vigilState: createVigilState(),
    battleState: 'ENEMY_PHASE',
    turnManager: { currentPhase: 'enemy', turnNumber: 1 },
    battleConfig: b.battleConfig,
    battleParams: b.battleParams,
    gameData: { ...data, affixes: { affixes: [] } },
    registry: { get: () => null },
    goldEarned: 0,
    grid: {
      cols: b.battleConfig.cols,
      rows: b.battleConfig.rows,
      mapLayout: b.battleConfig.mapLayout,
      temporaryTerrains: [],
      fogEnabled: Boolean(seen),
      isVisible: (c, r) => !seen || seen.has(`${c},${r}`),
      getTerrainAt: (c, r) => b.grid.getTerrainAt(c, r),
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
    dimUnit() {},
  });
  resetBattleIdentities(scene);
  for (const u of [...scene.playerUnits, ...scene.enemyUnits]) registerBattleEntity(scene, u);
  scene.getUnitAt = (c, r) =>
    [...scene.playerUnits, ...scene.enemyUnits].find(
      (u) => u.currentHP > 0 && !u._removing && u.col === c && u.row === r,
    ) || null;
  return { scene, b };
}

const called = (units) => units.filter((u) => typeof u._summonedBy === 'string');
const voiceOf = (units, id) => units.find((u) => u.authoredId === id);
const shape = (unit) => {
  const { battleEntityId: _id, ...rest } = serializeBattleUnit(unit);
  return rest;
};
const banners = (scene) => scene.showBriefBanner.mock.calls.map((c) => c[0]);
const tileOf = (b, kind, id) => b.battleConfig.vigil[kind].find((x) => x.id === id);

describe('the scene speaks and calls as the harness does', () => {
  it('same board, turn and seed: the same state and the same Hollowed, drawing no Math.random', async () => {
    const { scene, b } = sceneOf();
    const random = vi.spyOn(Math, 'random');
    await scene.processVigil();
    expect(random).not.toHaveBeenCalled();
    random.mockRestore();
    b.turnManager.turnNumber = 1;
    b._processVigil();
    expect(scene._vigilState).toEqual(b._vigilState);
    expect(scene._vigilState).toMatchObject({ words: 5, summoned: 4, lastProcessedTurn: 1 });
    expect(called(scene.enemyUnits).map(shape)).toEqual(called(b.enemyUnits).map(shape));
    for (const unit of called(scene.enemyUnits)) {
      expect(scene.addUnitGraphic).toHaveBeenCalledWith(unit);
      expect(unit.battleEntityId).toMatch(/^u\d+$/);
    }
    expect(scene.dangerZoneStale).toBe(true);
  });

  it('a second pipeline run in the same turn does nothing; a non-Vigil map skips the step', async () => {
    const { scene } = sceneOf();
    await scene.processVigil();
    const state = structuredClone(scene._vigilState);
    const count = scene.enemyUnits.length;
    scene.showBriefBanner.mockClear();
    await scene.processVigil();
    expect(scene._vigilState).toEqual(state);
    expect(scene.enemyUnits).toHaveLength(count);
    expect(scene.showBriefBanner).not.toHaveBeenCalled();
    const plain = sceneOf().scene;
    plain.battleConfig = { ...plain.battleConfig, vigil: undefined };
    await plain.processVigil();
    expect(called(plain.enemyUnits)).toEqual([]);
  });
});

describe('the fog keeps its secret', () => {
  it('in full view: both banners once, and the rising effect on each Hollowed', async () => {
    const { scene } = sceneOf();
    await scene.processVigil();
    expect(banners(scene)).toEqual([VIGIL_BANNERS.words, VIGIL_BANNERS.call]);
    expect(scene._combatFx.raise).toHaveBeenCalledTimes(4);
    expect(scene.updateEnemyVisibility).not.toHaveBeenCalled(); // no fog: nothing to hide
  });

  it('all in fog: no banner, no effect; the Hollowed still come and the fog hides them', async () => {
    const { scene } = sceneOf({ visible: ['0,10', '1,9'] });
    await scene.processVigil();
    expect(called(scene.enemyUnits)).toHaveLength(4);
    expect(scene._vigilState.words).toBe(5);
    expect(scene.showBriefBanner).not.toHaveBeenCalled();
    expect(scene._combatFx.raise).not.toHaveBeenCalled();
    expect(scene.updateEnemyVisibility).toHaveBeenCalled();
  });

  it('a seen speaker alone: the words banner; a seen call alone: the call banner and its effect', async () => {
    const harnessB = harness();
    const waking = tileOf(harnessB, 'sigils', 'sigil_waking');
    const circle = tileOf(harnessB, 'circles', 'circle_calling');
    const heard = sceneOf({ visible: [`${waking.col},${waking.row}`] }).scene;
    await heard.processVigil();
    expect(banners(heard)).toEqual([VIGIL_BANNERS.words]);
    expect(heard._combatFx.raise).not.toHaveBeenCalled();

    const watched = sceneOf({ visible: [`${circle.col},${circle.row}`] }).scene;
    await watched.processVigil();
    expect(banners(watched)).toEqual([VIGIL_BANNERS.call]);
    const [onCircle] = called(watched.enemyUnits).filter((u) => u._summonedBy === 'circle:circle_calling'); // prettier-ignore
    expect(watched._combatFx.raise.mock.calls.map((c) => c[0])).toEqual([onCircle]);
  });

  it("under Seer's Eye the same fogged phase plays both banners", async () => {
    // Paired with the all-in-fog test: only the Eye differs.
    const { scene } = sceneOf({ visible: ['0,10'] });
    markFoesShown(scene.grid, { foesShown: true });
    await scene.processVigil();
    expect(banners(scene)).toEqual([VIGIL_BANNERS.words, VIGIL_BANNERS.call]);
    expect(scene._combatFx.raise).toHaveBeenCalledTimes(4);
  });

  it('a Voice’s fall: "A Voice falls silent." when seen, nothing in the fog', async () => {
    const seenFall = sceneOf().scene;
    const player = seenFall.playerUnits[0];
    await seenFall.removeUnit(voiceOf(seenFall.enemyUnits, 'voice_binding'), { killer: player });
    expect(banners(seenFall)).toContain(VIGIL_BANNERS.silenced);

    const fogged = sceneOf({ visible: ['0,10', '1,9'] }).scene;
    await fogged.removeUnit(voiceOf(fogged.enemyUnits, 'voice_binding'), {});
    expect(banners(fogged)).not.toContain(VIGIL_BANNERS.silenced);
    expect(voiceOf(fogged.enemyUnits, 'voice_binding')).toBeUndefined();

    // A guard's fall is no Voice's.
    const guard = sceneOf().scene;
    await guard.removeUnit(
      guard.enemyUnits.find((u) => u.className === 'Dark Knight'),
      {
        killer: guard.playerUnits[0],
      },
    );
    expect(banners(guard)).not.toContain(VIGIL_BANNERS.silenced);
  });
});

describe('the markers', () => {
  const states = (ctrl) => ({
    sigils: Object.fromEntries(ctrl.markerStates().sigils.map((s) => [s.id, s.state])),
    circles: Object.fromEntries(ctrl.markerStates().circles.map((c) => [c.id, c.state])),
  });

  it('lit with its Voice seen on it; dim unseen or shoved off; silent fallen; circles follow', () => {
    const view = sceneOf().scene;
    expect(states(new VigilController(view))).toEqual({
      sigils: { sigil_calling: 'lit', sigil_binding: 'lit', sigil_feeding: 'lit', sigil_waking: 'lit' }, // prettier-ignore
      circles: { circle_calling: 'open', circle_binding: 'open', circle_feeding: 'open', circle_waking: 'open' }, // prettier-ignore
    });

    const fog = sceneOf({ visible: ['0,10'] }).scene;
    expect(Object.values(states(new VigilController(fog)).sigils)).toEqual(['dim', 'dim', 'dim', 'dim']); // prettier-ignore
    // Under the Eye the fogged Voices light their sigils.
    markFoesShown(fog.grid, { foesShown: true });
    expect(Object.values(states(new VigilController(fog)).sigils)).toEqual(['lit', 'lit', 'lit', 'lit']); // prettier-ignore

    const moved = sceneOf().scene;
    voiceOf(moved.enemyUnits, 'voice_binding').col += 1;
    voiceOf(moved.enemyUnits, 'voice_waking').currentHP = 0;
    const circle = tileOf(sceneOf().b, 'circles', 'circle_feeding');
    Object.assign(moved.playerUnits[0], { col: circle.col, row: circle.row });
    expect(states(new VigilController(moved))).toEqual({
      sigils: { sigil_calling: 'lit', sigil_binding: 'dim', sigil_feeding: 'lit', sigil_waking: 'silent' }, // prettier-ignore
      circles: { circle_calling: 'open', circle_binding: 'open', circle_feeding: 'covered', circle_waking: 'closed' }, // prettier-ignore
    });
  });

  /** A scene whose `add.graphics` records what is drawn, and whose tweens are counted. */
  function drawing(scene, { reduced = false } = {}) {
    const made = [];
    scene.add = {
      graphics: () => {
        const g = new Proxy(
          { destroyed: false },
          {
            get: (t, p) => (p === 'destroy' ? () => (t.destroyed = true) : p in t ? t[p] : () => g),
            set: (t, p, v) => ((t[p] = v), true),
          },
        );
        made.push(g);
        return g;
      },
    };
    scene.tweens = { add: vi.fn(), killTweensOf: vi.fn() };
    scene._reduceMotion = () => reduced;
    return made;
  }

  it('draws eight tile overlays at their tiles, redraws only on a change, pulses unless reduced', () => {
    const { scene } = sceneOf();
    const made = drawing(scene);
    const ctrl = new VigilController(scene).create();
    expect(made).toHaveLength(8);
    expect(made.map((g) => g.name).sort()).toEqual([
      ...Array(4).fill('vigil-circle-open'),
      ...Array(4).fill('vigil-sigil-lit'),
    ]);
    const waking = ctrl.shown.sigils.find((s) => s.id === 'sigil_waking');
    expect(waking).toMatchObject({
      waking: true,
      x: waking.col * 32 + 16,
      y: waking.row * 32 + 16,
    });
    expect(scene.tweens.add).toHaveBeenCalledTimes(8);
    ctrl.sync();
    ctrl.sync();
    expect(made).toHaveLength(8); // nothing changed: nothing redrawn
    voiceOf(scene.enemyUnits, 'voice_binding').col += 1;
    ctrl.sync();
    expect(made).toHaveLength(16);
    expect(made.slice(0, 8).every((g) => g.destroyed)).toBe(true);
    ctrl.destroy();
    expect(made.every((g) => g.destroyed)).toBe(true);

    const still = sceneOf().scene;
    drawing(still, { reduced: true });
    new VigilController(still).create();
    expect(still.tweens.add).not.toHaveBeenCalled();
  });
});

describe('saves and resume', () => {
  it('a checkpoint carries the count, validates, and its resume never replays the phase', async () => {
    const { scene } = sceneOf();
    scene.runManager = { convoy: { weapons: [], consumables: [] }, accessories: [], gold: 0 };
    await scene.processVigil();
    const state = JSON.parse(JSON.stringify(captureBattleState(scene, { rngSeed: 7 })));
    expect(state.vigilState).toEqual(scene._vigilState);
    expect(validateBattleState(state)).toBe(true);

    const restored = sceneOf().scene;
    restored.playerUnits = [];
    restored.enemyUnits = [];
    restored._vigilState = createVigilState();
    restored.runManager = { convoy: { weapons: [], consumables: [] }, accessories: [], gold: 0 };
    new BattleSuspendController(restored).applyUnits(state);
    expect(restored._vigilState).toEqual(scene._vigilState);
    expect(called(restored.enemyUnits).map(shape)).toEqual(called(scene.enemyUnits).map(shape));
    // The resumed enemy phase reaches the turn-start step again: nothing more happens.
    restored.showBriefBanner.mockClear();
    await restored.processVigil();
    expect(called(restored.enemyUnits)).toHaveLength(4);
    expect(restored._vigilState.words).toBe(5);
    expect(restored.showBriefBanner).not.toHaveBeenCalled();
  });

  it('a malformed count fails validation; a battle without a Vigil saves none', async () => {
    const { scene } = sceneOf();
    scene.runManager = { convoy: { weapons: [], consumables: [] }, accessories: [], gold: 0 };
    await scene.processVigil();
    const good = JSON.parse(JSON.stringify(captureBattleState(scene, { rngSeed: 7 })));
    const bad = (edit) => {
      const state = structuredClone(good);
      edit(state.vigilState);
      return validateBattleState(state);
    };
    expect(bad(() => {})).toBe(true);
    expect(bad((v) => (v.words = -1))).toBe(false);
    expect(bad((v) => (v.summoned = 1.5))).toBe(false);
    expect(bad((v) => delete v.lastProcessedTurn)).toBe(false);
    expect(bad((v) => (v.byVoice = { voice_waking: 'two' }))).toBe(false);
    expect(bad((v) => (v.byCircle = []))).toBe(false);

    scene._vigilState = null;
    const plain = JSON.parse(JSON.stringify(captureBattleState(scene, { rngSeed: 7 })));
    expect(plain).not.toHaveProperty('vigilState');
    expect(validateBattleState(plain)).toBe(true);
  });
});

describe('the Voices are named targets, never bosses', () => {
  it('each Voice carries its authored id and name; no Voice and no Hollowed is a boss', async () => {
    const { scene } = sceneOf();
    await scene.processVigil();
    for (const id of VOICES) expect(voiceOf(scene.enemyUnits, id).isBoss).toBeFalsy();
    expect(called(scene.enemyUnits).every((u) => !u.isBoss && !u.authoredId)).toBe(true);
  });
});

describe('rendering never changes the call (as HealthPresentationInvariance)', () => {
  const RNG_SEED = 11;

  /**
   * One Vigil phase in full view under fog (every presentation path runs: the fog pass, both
   * banners, each rising), with the history recording and the battle stream installed.
   * `breakIt(scene)` makes some of the drawing throw. Resolves to what the phase left behind.
   */
  async function phase(breakIt = () => {}) {
    const { scene } = sceneOf();
    scene.runManager = { battleInProgress: {} };
    Object.assign(scene.grid, { fogEnabled: true, isVisible: () => true });
    breakIt(scene);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const before = Math.random;
    scene._battleRng = createBattleRng(RNG_SEED);
    Math.random = scene._battleRng;
    let error = null;
    try {
      await scene.processVigil();
    } catch (err) {
      error = err;
    } finally {
      Math.random = before;
    }
    return {
      scene,
      error,
      outcome: {
        enemies: scene.enemyUnits.map(sameItems),
        vigilState: structuredClone(scene._vigilState),
        history: structuredClone(scene._historyBeats || []),
        nextEntityId: scene._nextBattleEntityId,
        rng: scene._battleRng.getState(),
        dangerZoneStale: scene.dangerZoneStale,
      },
    };
  }

  /**
   * A unit as saved, every field, ids, tiles and levels included. An item's uid carries the
   * process-wide item counter, which each fixture's harness build moves on: only its own part
   * is compared.
   */
  const sameItems = (unit) =>
    JSON.parse(
      JSON.stringify(serializeBattleUnit(unit), (key, value) =>
        key === 'uid' && typeof value === 'string' ? value.replace(/^itm_\d+_/, 'itm_') : value,
      ),
    );

  /** addUnitGraphic that throws (before it registers anything) on the calls `fails` picks. */
  const graphicFails = (fails) => (scene) => {
    let n = 0;
    scene.addUnitGraphic = vi.fn((unit) => {
      n += 1;
      if (fails(n)) throw new Error('graphic failed');
      registerBattleEntity(scene, unit);
    });
  };

  it('a graphic failing on the first summon, or on every one: the same units, counts, history and stream', async () => {
    const drawn = await phase();
    const firstFails = await phase(graphicFails((n) => n === 1));
    const allFail = await phase(graphicFails(() => true));

    // The normal phase, from the fixture's known board: four Hollowed, five words, a record each.
    expect(drawn.error).toBeNull();
    const summoned = called(drawn.scene.enemyUnits);
    expect(summoned).toHaveLength(4);
    expect(drawn.outcome.vigilState).toMatchObject({ words: 5, summoned: 4, lastProcessedTurn: 1 });
    expect(new Set(summoned.map((u) => u.battleEntityId)).size).toBe(4);
    expect(drawn.outcome.history.filter((b) => b.type === 'called').map((b) => b.targetId)).toEqual(
      summoned.map((u) => u.battleEntityId),
    );
    // Nothing in the phase draws from the battle stream.
    expect(drawn.outcome.rng).toEqual(createBattleRng(RNG_SEED).getState());

    for (const broken of [firstFails, allFail]) {
      expect(broken.outcome).toEqual(drawn.outcome);
      expect(broken.error).toBeNull(); // the enemy phase goes on
      expect(broken.scene.addUnitGraphic).toHaveBeenCalledTimes(4); // each summon was tried
      expect(banners(broken.scene)).toEqual([VIGIL_BANNERS.words, VIGIL_BANNERS.call]);
    }
    expect(firstFails.scene._combatFx.raise).toHaveBeenCalledTimes(4);
  });

  it('every piece of the drawing failing at once: the same outcome, and the phase still resolves', async () => {
    const drawn = await phase();
    const broken = await phase((scene) => {
      graphicFails(() => true)(scene);
      const boom = () => {
        throw new Error('render');
      };
      scene.showBriefBanner = vi.fn(async () => boom());
      scene._combatFx = { raise: vi.fn(boom) };
      scene.updateEnemyVisibility = vi.fn(boom);
      scene.updateObjectiveText = vi.fn(boom);
      scene._pinnedThreats = { invalidate: vi.fn(boom) };
      scene.grid.gridToPixel = boom; // the markers
    });
    expect(broken.outcome).toEqual(drawn.outcome);
    expect(broken.error).toBeNull();
    expect(broken.scene.updateEnemyVisibility).toHaveBeenCalled();
    expect(broken.scene.updateObjectiveText).toHaveBeenCalled();
  });

  it("a Voice's fall whose markers fail to draw still finishes, with its banner", async () => {
    const { scene } = sceneOf();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    scene.grid.gridToPixel = () => {
      throw new Error('render');
    };
    const voice = voiceOf(scene.enemyUnits, 'voice_binding');
    await expect(scene.removeUnit(voice, { killer: scene.playerUnits[0] })).resolves.not.toThrow();
    expect(voiceOf(scene.enemyUnits, 'voice_binding')).toBeUndefined();
    expect(banners(scene)).toContain(VIGIL_BANNERS.silenced);
    expect(scene.dangerZoneStale).toBe(true); // removeUnit ran past the Voice's step
  });
});
