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
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
    Math: { Clamp: (val, min, max) => Math.max(min, Math.min(max, val)) },
  },
}));

import { BattleScene } from '../src/scenes/BattleScene.js';
import { VigilController, VIGIL_BANNERS, VOICE_SILENCED_CUE } from '../src/ui/VigilController.js';
import { BattleSuspendController } from '../src/ui/BattleSuspendController.js';
import { captureBattleState } from '../src/ui/BattleCheckpointAdapter.js';
import { validateBattleState } from '../src/engine/BattleStateSnapshot.js';
import { serializeBattleUnit } from '../src/engine/BattleUnitState.js';
import { registerBattleEntity, resetBattleIdentities } from '../src/engine/BattleEntityIdentity.js';
import { markFoesShown } from '../src/engine/BattleInformation.js';
import { createVigilState } from '../src/engine/Vigil.js';
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

  it('a seen Voice’s fall plays the voice_silenced cue; a fogged one and a guard’s are silent', async () => {
    // Failure: the cue never plays (the stinger the music PR made goes unheard), or it plays for
    // a fall in the fog (sound leaking what the board hides) or for any foe's fall.
    const withAudio = (scene) => {
      const audio = { playStinger: vi.fn(async () => null), playSFX: vi.fn() };
      scene.registry = { get: (key) => (key === 'audio' ? audio : null) };
      return audio;
    };
    const cues = (audio) => audio.playStinger.mock.calls.map((c) => c[0]);
    const seenFall = sceneOf().scene;
    const seenAudio = withAudio(seenFall);
    await seenFall.removeUnit(voiceOf(seenFall.enemyUnits, 'voice_binding'), {
      killer: seenFall.playerUnits[0],
    });
    expect(cues(seenAudio)).toEqual([VOICE_SILENCED_CUE]);
    expect(VOICE_SILENCED_CUE).toBe('voice_silenced');

    const fogged = sceneOf({ visible: ['0,10', '1,9'] }).scene;
    const foggedAudio = withAudio(fogged);
    await fogged.removeUnit(voiceOf(fogged.enemyUnits, 'voice_binding'), {});
    expect(cues(foggedAudio)).not.toContain(VOICE_SILENCED_CUE);

    const guard = sceneOf().scene;
    const guardAudio = withAudio(guard);
    await guard.removeUnit(
      guard.enemyUnits.find((u) => u.className === 'Dark Knight'),
      { killer: guard.playerUnits[0] },
    );
    expect(cues(guardAudio)).not.toContain(VOICE_SILENCED_CUE);
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

describe('the markers and the fog', () => {
  /** A scene whose graphics record the primitives drawn (colour setters left out). */
  function recording(scene) {
    const made = [];
    const COLOUR = new Set(['lineStyle', 'fillStyle', 'setDepth', 'setAlpha']);
    scene.add = {
      graphics: () => {
        const g = { calls: [], destroyed: false };
        const proxy = new Proxy(g, {
          get: (t, p) =>
            p in t
              ? t[p]
              : p === 'destroy'
                ? () => (t.destroyed = true)
                : () => {
                    if (!COLOUR.has(p)) t.calls.push(p);
                    return proxy;
                  },
          set: (t, p, v) => ((t[p] = v), true),
        });
        made.push(proxy);
        return proxy;
      },
    };
    scene.tweens = { add: vi.fn(), killTweensOf: vi.fn() };
    scene._reduceMotion = () => true;
    return made;
  }
  const tiles = (made) => made.map((g) => g.name).sort();

  it('a marker is drawn only on a tile the fog shows: a sigil in the dark names no hidden Voice', () => {
    // Failure: every sigil is drawn from turn 1, and a Voice stands on its sigil, so the board
    // points at the unseen foes.
    const probe = sceneOf();
    const sigil = tileOf(probe.b, 'sigils', 'sigil_calling');
    const circle = tileOf(probe.b, 'circles', 'circle_waking');
    const { scene } = sceneOf({
      visible: [`${sigil.col},${sigil.row}`, `${circle.col},${circle.row}`],
    });
    const made = recording(scene);
    const ctrl = new VigilController(scene).create();
    expect(tiles(made)).toEqual(['vigil-circle-open', 'vigil-sigil-lit']);
    expect(ctrl.shown.sigils.map((s) => s.id)).toEqual(['sigil_calling']);
    expect(ctrl.shown.circles.map((c) => c.id)).toEqual(['circle_waking']);
    // The model still says what every marker is (a test, a tooltip), and which the fog shows.
    expect(ctrl.markerStates().sigils.map((s) => s.seen)).toEqual([true, false, false, false]);
    // Fully hidden: nothing at all.
    const dark = sceneOf({ visible: ['0,10'] }).scene;
    const none = recording(dark);
    new VigilController(dark).create();
    expect(none).toHaveLength(0);
    // The sight moves: the board is redrawn for what is now seen.
    dark.grid.isVisible = (c, r) => c === sigil.col && r === sigil.row;
    const ctrl2 = new VigilController(dark);
    ctrl2.sync();
    expect(none).toHaveLength(1);
    expect(none[0].name).toBe('vigil-sigil-lit');
  });

  it("under Seer's Eye the fogged foes show, so every marker does; the same board without it shows none", () => {
    const { scene } = sceneOf({ visible: ['0,10'] });
    const without = recording(scene);
    new VigilController(scene).create();
    expect(without).toHaveLength(0);
    markFoesShown(scene.grid, { foesShown: true });
    const withEye = recording(scene);
    new VigilController(scene).create();
    expect(withEye).toHaveLength(8);
  });

  it('a fallen Voice’s sigil and closed circle stay out of the dark too', () => {
    const { scene, b } = sceneOf({ visible: ['0,10'] });
    voiceOf(scene.enemyUnits, 'voice_binding').currentHP = 0;
    const made = recording(scene);
    new VigilController(scene).create();
    expect(made).toHaveLength(0);
    const sigil = tileOf(b, 'sigils', 'sigil_binding');
    scene.grid.isVisible = (c, r) => c === sigil.col && r === sigil.row;
    new VigilController(scene).create();
    expect(tiles(made)).toEqual(['vigil-sigil-silent']);
  });

  it('every state has a shape of its own, so no state is told from another by colour alone', () => {
    // Failure: lit and empty sigils (or open, blocked and closed circles) draw the same figure
    // in different hues, which a colour-blind player cannot tell apart.
    const { scene, b } = sceneOf();
    voiceOf(scene.enemyUnits, 'voice_binding').col += 1; // empty
    voiceOf(scene.enemyUnits, 'voice_feeding').currentHP = 0; // silent; its circle closed
    const covered = tileOf(b, 'circles', 'circle_calling');
    Object.assign(scene.playerUnits[0], { col: covered.col, row: covered.row });
    const made = recording(scene);
    const ctrl = new VigilController(scene).create();
    const shapeOf = (name) => made.find((g) => g.name === name)?.calls.join('>');
    const sigilShapes = ['lit', 'dim', 'silent'].map((s) => shapeOf(`vigil-sigil-${s}`));
    const circleShapes = ['open', 'covered', 'closed'].map((s) => shapeOf(`vigil-circle-${s}`));
    for (const shapes of [sigilShapes, circleShapes]) {
      expect(shapes.every(Boolean)).toBe(true);
      expect(new Set(shapes).size).toBe(shapes.length);
    }
    // A sigil is not a circle: the two families never share a figure.
    expect(new Set([...sigilShapes, ...circleShapes]).size).toBe(6);
    // The Waking's sigil adds its inner diamond to the lit one's figure.
    const lit = made.filter((g) => g.name === 'vigil-sigil-lit');
    const waking = ctrl.shown.sigils.findIndex((s) => s.id === 'sigil_waking');
    expect(waking).toBeGreaterThanOrEqual(0);
    expect(new Set(lit.map((g) => g.calls.join('>'))).size).toBe(2);
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
