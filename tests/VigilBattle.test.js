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
import { readFileSync } from 'node:fs';

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
import { areaDamage } from '../src/engine/PostCombatEffects.js';
import { getWeaponArtArea } from '../src/engine/WeaponArtSystem.js';
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

describe('what the court says (dialogue.json vigil, engine/VigilWords.js)', () => {
  // Failures: a Voice in the fog is heard (a word floats over a hidden unit); the words restart
  // or skip instead of walking each Voice's verse by the counts the battle keeps (so a resume
  // or a rewind would say other words); the Waking says one word where it spoke two; the roll
  // call never answers, or answers over a Hollowed the player cannot see; a Voice's last line
  // plays for a fall in the fog or for a guard's.
  const dialogue = JSON.parse(
    readFileSync(new URL('../data/dialogue.json', import.meta.url), 'utf8'),
  );
  const verse = (id) => dialogue.vigil.voices[id].words;
  /** A scene that records what is said: floating lines and the dialogue box. */
  function speaking(opts) {
    const made = sceneOf(opts);
    const { scene } = made;
    scene.gameData = { ...scene.gameData, dialogue };
    scene._battleBeats = { speakOver: vi.fn(), onKill: vi.fn(), onAllyFall: vi.fn() };
    scene.dialogueOverlay = { show: vi.fn(async () => {}) };
    scene._getPortraitKey = (unit) => `portrait_of_${unit.authoredId || unit.className}`;
    return made;
  }
  const said = (scene) =>
    scene._battleBeats.speakOver.mock.calls.map(([unit, line, options]) => ({
      who: unit.authoredId || unit._summonedBy,
      line,
      foe: options?.foe === true,
    }));

  it('in full view, each Voice says the start of its verse, the Waking two words, and the roll is answered once', async () => {
    const { scene } = speaking();
    await scene.processVigil();
    const words = said(scene).filter((s) => VOICES.includes(s.who));
    expect(new Set(words.map((w) => w.who))).toEqual(new Set(VOICES));
    for (const w of words) {
      expect(w.foe).toBe(true);
      const own = verse(w.who);
      expect(w.line).toBe(w.who === 'voice_waking' ? `${own[0]} ${own[1]}` : own[0]);
    }
    const calls = said(scene).filter((s) => !VOICES.includes(s.who));
    expect(calls).toHaveLength(1);
    expect(calls[0].line).toBe(dialogue.vigil.call[0]);
    expect(calls[0].who).toMatch(/^circle:/);
  });

  it('no line floats while a notice band of the phase is still on screen', async () => {
    // On an upright phone the turned ring puts a Voice high on the board, under the band.
    const { scene } = speaking();
    const events = [];
    scene.showBriefBanner = vi.fn(async (message) => {
      events.push(`band:${message}`);
      await Promise.resolve();
      events.push('band:end');
    });
    scene._battleBeats.speakOver = vi.fn((unit) => events.push(`line:${unit.authoredId}`));
    await scene.processVigil();
    const bands = events.filter((e) => e.startsWith('band:') && e !== 'band:end');
    expect(bands).toHaveLength(2);
    expect(events.filter((e) => e.startsWith('line:')).length).toBeGreaterThan(1);
    expect(events.findIndex((e) => e.startsWith('line:'))).toBeGreaterThan(
      events.lastIndexOf('band:end'),
    );
  });

  it('the next phase walks on through each verse, and the roll call answers in turn', async () => {
    const { scene } = speaking();
    await scene.processVigil();
    scene._battleBeats.speakOver.mockClear();
    scene.turnManager.turnNumber = 2;
    await scene.processVigil();
    const byVoice = Object.fromEntries(said(scene).map((s) => [s.who, s.line]));
    expect(byVoice.voice_calling).toBe(verse('voice_calling')[1]);
    expect(byVoice.voice_waking).toBe(`${verse('voice_waking')[2]} ${verse('voice_waking')[3]}`);
    // Four were called on turn 1, so the first called on turn 2 answers fifth.
    const call = said(scene).find((s) => !VOICES.includes(s.who));
    expect(call.line).toBe(dialogue.vigil.call[4 % dialogue.vigil.call.length]);
  });

  it('in the fog only a seen Voice is heard, and no unseen Hollowed answers', async () => {
    const b = harness();
    const waking = tileOf(b, 'sigils', 'sigil_waking');
    const { scene } = speaking({ visible: [`${waking.col},${waking.row}`] });
    await scene.processVigil();
    expect(said(scene)).toEqual([
      {
        who: 'voice_waking',
        line: `${verse('voice_waking')[0]} ${verse('voice_waking')[1]}`,
        foe: true,
      },
    ]);
    const dark = speaking({ visible: ['0,10', '1,9'] }).scene;
    await dark.processVigil();
    expect(dark._battleBeats.speakOver).not.toHaveBeenCalled();
  });

  it('a seen Voice falls with its last line in the dialogue box; a fogged one and a guard say nothing', async () => {
    const seen = speaking().scene;
    const binding = voiceOf(seen.enemyUnits, 'voice_binding');
    await seen.removeUnit(binding, { killer: seen.playerUnits[0] });
    expect(seen.dialogueOverlay.show.mock.calls).toEqual([
      [binding.name, dialogue.vigil.voices.voice_binding.silenced, 'portrait_of_voice_binding'],
    ]);

    const fogged = speaking({ visible: ['0,10', '1,9'] }).scene;
    await fogged.removeUnit(voiceOf(fogged.enemyUnits, 'voice_binding'), {});
    expect(fogged.dialogueOverlay.show).not.toHaveBeenCalled();

    const guard = speaking().scene;
    await guard.removeUnit(
      guard.enemyUnits.find((u) => u.className === 'Dark Knight'),
      { killer: guard.playerUnits[0] },
    );
    expect(guard.dialogueOverlay.show).not.toHaveBeenCalled();
  });

  describe('the last lines: the first Voice to fall in the dialogue box, each later one floating', () => {
    // Failures: every fall blocks on its own box (four in a turn stack four); the later ones are
    // dropped instead of floating; the floating line is not foe-styled or not over the spot the
    // Voice fell; a fall in the fog speaks; "first" is remembered somewhere a resume or a rewind
    // does not restore (a rewind to before the first fall must block on the first fall again).
    const silenced = (id) => dialogue.vigil.voices[id].silenced;
    const floats = (scene) =>
      scene._battleBeats.speakOver.mock.calls
        .filter(([unit]) => VOICES.includes(unit.authoredId))
        .map(([unit, line, options]) => ({ who: unit.authoredId, line, options }));
    const fell = (scene, id) =>
      scene.removeUnit(voiceOf(scene.enemyUnits, id), { killer: scene.playerUnits[0] });

    it('the first seen fall blocks and floats nothing; the second floats and blocks nothing', async () => {
      const { scene } = speaking();
      const binding = voiceOf(scene.enemyUnits, 'voice_binding');
      const spot = { col: binding.col, row: binding.row };
      await fell(scene, 'voice_binding');
      expect(scene.dialogueOverlay.show.mock.calls).toEqual([
        [binding.name, silenced('voice_binding'), 'portrait_of_voice_binding'],
      ]);
      expect(floats(scene)).toEqual([]);

      const feeding = voiceOf(scene.enemyUnits, 'voice_feeding');
      const feedingSpot = { col: feeding.col, row: feeding.row };
      await fell(scene, 'voice_feeding');
      // Still the one box; the second line floats, foe-styled, over the tile it fell on.
      expect(scene.dialogueOverlay.show).toHaveBeenCalledTimes(1);
      expect(floats(scene)).toEqual([
        {
          who: 'voice_feeding',
          line: silenced('voice_feeding'),
          options: { foe: true, tile: feedingSpot },
        },
      ]);
      expect(spot).not.toEqual(feedingSpot);
      // A third and a fourth float too.
      await fell(scene, 'voice_calling');
      await fell(scene, 'voice_waking');
      expect(scene.dialogueOverlay.show).toHaveBeenCalledTimes(1);
      expect(floats(scene).map((f) => f.who)).toEqual([
        'voice_feeding',
        'voice_calling',
        'voice_waking',
      ]);
    });

    it('one area art that fells two Voices at once: the first removed gets the box, the other floats', async () => {
      // A radius-2 area art dealing a fixed 5 a blow (a fixture, so a retuned legendary art
      // never moves this test) on the guard at the ring's heart reaches all four sigils, each
      // 2 tiles off. Two Voices at 4 HP drop together: both are at
      // 0 HP before the first is removed (the area's blows land first, then each falls in area
      // order through removeUnit), so a count that read 0 HP as fallen saw "2" at the first fall
      // and floated both lines, opening no box. A rewind to before the strike chooses the same.
      const art = {
        name: 'Fixture Splash',
        area: { shape: 'radius', radius: 2, damage: { kind: 'fixed', amount: 5 }, strikes: 'once' },
      };
      const doomed = ['voice_binding', 'voice_feeding'];
      const strike = async (scene) => {
        const guard = scene.enemyUnits.find((u) => u.className === 'Dark Knight');
        const hero = scene.playerUnits[0];
        const removed = [];
        const remove = scene.removeUnit.bind(scene);
        scene.removeUnit = (unit, options) => {
          if (unit.authoredId) removed.push(unit.authoredId);
          return remove(unit, options);
        };
        const step = { area: getWeaponArtArea(art), blows: 1 };
        await scene._playPostCombatBeats(
          areaDamage(step, hero, guard, scene._postCombatWorld(), {}),
        );
        return removed;
      };
      const setUp = (scene, b) => {
        scene.grid.getMoveCost = (c, r, moveType) => b.grid.getMoveCost(c, r, moveType);
        scene.showMinorHintAt = vi.fn();
        scene.runManager = { convoy: { weapons: [], consumables: [] }, accessories: [], gold: 0 };
      };
      const { scene, b } = speaking();
      setUp(scene, b);
      const guard = scene.enemyUnits.find((u) => u.className === 'Dark Knight');
      Object.assign(scene.playerUnits[0], { col: guard.col + 1, row: guard.row });
      for (const id of doomed) voiceOf(scene.enemyUnits, id).currentHP = 4;
      const before = JSON.parse(JSON.stringify(captureBattleState(scene, { rngSeed: 7 })));

      const expectOneBoxOneFloat = (target, removed) => {
        expect([...removed].sort()).toEqual([...doomed].sort());
        expect(target.enemyUnits.filter((u) => doomed.includes(u.authoredId))).toEqual([]);
        const [first, second] = removed;
        expect(target.dialogueOverlay.show).toHaveBeenCalledTimes(1);
        expect(target.dialogueOverlay.show.mock.calls[0][1]).toBe(silenced(first));
        expect(target.dialogueOverlay.show.mock.calls[0][2]).toBe(`portrait_of_${first}`);
        expect(floats(target).map((f) => [f.who, f.line])).toEqual([[second, silenced(second)]]);
      };
      expectOneBoxOneFloat(scene, await strike(scene));

      // A rewind to before the strike: the same strike, the same choice.
      const { scene: rewound, b: rb } = speaking();
      setUp(rewound, rb);
      rewound.playerUnits = [];
      rewound.enemyUnits = [];
      new BattleSuspendController(rewound).applyUnits(before);
      expect(doomed.map((id) => voiceOf(rewound.enemyUnits, id).currentHP)).toEqual([4, 4]);
      expectOneBoxOneFloat(rewound, await strike(rewound));
    });

    it('a fall in the fog says nothing, blocking or floating', async () => {
      const { scene } = speaking({ visible: ['0,10', '1,9'] });
      await fell(scene, 'voice_binding');
      await fell(scene, 'voice_feeding');
      expect(scene.dialogueOverlay.show).not.toHaveBeenCalled();
      expect(floats(scene)).toEqual([]);
    });

    it('a rewind or a resume to before the first fall blocks on the first fall again', async () => {
      const { scene } = speaking();
      scene.runManager = { convoy: { weapons: [], consumables: [] }, accessories: [], gold: 0 };
      const before = JSON.parse(JSON.stringify(captureBattleState(scene, { rngSeed: 7 })));
      await fell(scene, 'voice_binding');
      const after = JSON.parse(JSON.stringify(captureBattleState(scene, { rngSeed: 7 })));
      await fell(scene, 'voice_feeding');
      expect(floats(scene).map((f) => f.who)).toEqual(['voice_feeding']);

      const restored = (state) => {
        const { scene: next } = speaking();
        next.playerUnits = [];
        next.enemyUnits = [];
        next._vigilState = createVigilState();
        next.runManager = { convoy: { weapons: [], consumables: [] }, accessories: [], gold: 0 };
        new BattleSuspendController(next).applyUnits(state);
        return next;
      };
      // Back before any fall: the first fall in sight is the box again, whoever falls.
      const rewound = restored(before);
      await fell(rewound, 'voice_feeding');
      expect(rewound.dialogueOverlay.show).toHaveBeenCalledTimes(1);
      expect(floats(rewound)).toEqual([]);
      // Back after the first fall: the next one floats, as it did.
      const resumed = restored(after);
      await fell(resumed, 'voice_feeding');
      expect(resumed.dialogueOverlay.show).not.toHaveBeenCalled();
      expect(floats(resumed).map((f) => f.who)).toEqual(['voice_feeding']);
    });
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
      // The court's words and the roll call (with the lines to say), and the boxes they float in.
      const dialogue = JSON.parse(
        readFileSync(new URL('../data/dialogue.json', import.meta.url), 'utf8'),
      );
      scene.gameData = { ...scene.gameData, dialogue };
      scene._battleBeats = { speakOver: vi.fn(boom) };
      scene.grid.gridToPixel = boom; // the markers
    });
    expect(broken.outcome).toEqual(drawn.outcome);
    expect(broken.error).toBeNull();
    expect(broken.scene._battleBeats.speakOver).toHaveBeenCalled();
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
