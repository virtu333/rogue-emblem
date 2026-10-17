// The Iron Guardian's Hammerfall in BattleScene (rules: engine/IronGuardian.js; presentation:
// ui/HammerfallController.js), on the Sunken Mine's lit hall (data/setPieces.json
// `guardian_hall`). Ways this breaks:
//   - the scene marks or slams differently from the harness for the same board, turn and seed,
//     or draws from Math.random (the battle stream)
//   - the fog leaks: marks, the banner or the impact for a Guardian the player cannot see; or a
//     slam that lands only when it is seen
//   - a second pass in the same turn (a resumed enemy phase) slams again
//   - a checkpoint loses the marks, carries a malformed record past validation, or a resume
//     lands on a different set of marks
//   - a victim the slam fells stays on the board, or the Guardian's fall leaves its marks behind
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
    Math: { Clamp: (val, min, max) => Math.max(min, Math.min(max, val)) },
  },
}));

import { BattleScene } from '../src/scenes/BattleScene.js';
import { HammerfallController, HAMMERFALL_BANNERS } from '../src/ui/HammerfallController.js';
import { BattleSuspendController } from '../src/ui/BattleSuspendController.js';
import { captureBattleState } from '../src/ui/BattleCheckpointAdapter.js';
import { validateBattleState } from '../src/engine/BattleStateSnapshot.js';
import { serializeBattleUnit } from '../src/engine/BattleUnitState.js';
import { registerBattleEntity, resetBattleIdentities } from '../src/engine/BattleEntityIdentity.js';
import { createHammerfallState, slamDamage } from '../src/engine/IronGuardian.js';
import { combatDistance, getFootprint } from '../src/engine/EntitySystem.js';
import { processHammerfall } from './harness/headlessConjuring.js';
import {
  computeDangerTiles,
  threatSummaryText,
  threatsOnTile,
  threatWorldSignature,
} from '../src/engine/ThreatForecast.js';
import { GameDriver } from './harness/GameDriver.js';
import { installSeed, restoreMathRandom } from '../sim/lib/SeededRNG.js';
import { loadGameData } from './testData.js';

const data = loadGameData();

afterEach(() => {
  restoreMathRandom();
  vi.restoreAllMocks();
});

/** The harness's lit-hall battle at its start. */
function harness(seed = 3, setPiece = 'guardian_hall') {
  installSeed(seed);
  const driver = new GameDriver(data, {
    act: 'act2',
    objective: 'rout',
    setPiece,
    battleSeed: seed,
    difficultyId: 'normal',
    deployCount: 4,
  });
  driver.init();
  restoreMathRandom();
  return driver.battle;
}

const guardianOf = (units) => units.find((u) => u.className === 'Iron Guardian');

/**
 * A BattleScene on the same board as a fresh harness battle (units copied), mid enemy phase,
 * with its Hammerfall controller. `visible`: tiles the player sees ("col,row"; null: no fog).
 */
function sceneOf({ seed = 3, visible = null, turn = 1, state = null } = {}) {
  const b = harness(seed);
  const scene = new BattleScene();
  const copy = (units) => units.map((u) => structuredClone(serializeBattleUnit(u)));
  const seen = visible ? new Set(visible) : null;
  Object.assign(scene, {
    _battleSession: 1,
    runManager: { convoy: { weapons: [], consumables: [] }, accessories: [], gold: 0 },
    playerUnits: copy(b.playerUnits),
    enemyUnits: copy(b.enemyUnits),
    npcUnits: [],
    escapedUnits: [],
    nonDeployedUnits: [],
    _zombieTombstones: [],
    _hammerfallState: state ? structuredClone(state) : createHammerfallState(),
    battleState: 'ENEMY_PHASE',
    turnManager: { currentPhase: 'enemy', turnNumber: turn },
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
    },
    showBriefBanner: vi.fn(async () => {}),
    showMinorHintAt: vi.fn(),
    shakeScreen: vi.fn(),
    updateHPBar: vi.fn(),
    _sweepFallenUnits: vi.fn(async () => {}),
    removeUnit: vi.fn(async (unit) => {
      for (const list of [scene.playerUnits, scene.enemyUnits]) {
        const i = list.indexOf(unit);
        if (i >= 0) list.splice(i, 1);
      }
      scene._hammerfallCtrl?.onEnemyFell(unit);
    }),
    add: { graphics: vi.fn(() => fakeGraphics()) },
    tweens: { add: vi.fn(), killTweensOf: vi.fn() },
  });
  resetBattleIdentities(scene);
  for (const u of [...scene.playerUnits, ...scene.enemyUnits]) registerBattleEntity(scene, u);
  b.turnManager.turnNumber = turn;
  b._hammerfallState = state ? structuredClone(state) : createHammerfallState();
  scene._hammerfallCtrl = new HammerfallController(scene).create();
  return { scene, b };
}

function fakeGraphics() {
  const g = { calls: [] };
  for (const name of ['setDepth', 'fillStyle', 'fillRect', 'lineStyle', 'strokeRect', 'lineBetween', 'destroy']) // prettier-ignore
    g[name] = vi.fn(() => g);
  return g;
}

const hp = (units) => units.map((u) => [u.name, u.currentHP]);
const banners = (scene) => scene.showBriefBanner.mock.calls.map((c) => c[0]);
const tileKeys = (tiles) => tiles.map((t) => `${t.col},${t.row}`);

/** Stand the army's first unit on the first marked tile (the harness and the scene alike). */
function standOnMark(scene, b) {
  const mark = scene._hammerfallState.marks[0];
  for (const units of [scene.playerUnits, b.playerUnits]) Object.assign(units[0], mark);
  return mark;
}

describe('the lit hall fields the Guardian', () => {
  it('a 2x2 Iron Guardian on its authored tiles, and the map flags Hammerfall', () => {
    const b = harness();
    const g = guardianOf(b.enemyUnits);
    expect(g).toBeTruthy();
    expect(g.isBoss).toBe(true);
    expect(getFootprint(g)).toHaveLength(4);
    expect(b.battleConfig.hammerfall).toEqual({ v: 1 });
  });
});

describe('the scene marks and slams as the harness does', () => {
  it('turn 1 sets marks; turn 2 slams whoever stands on them; no Math.random', async () => {
    const { scene, b } = sceneOf();
    const random = vi.spyOn(Math, 'random');
    await scene._hammerfallCtrl.processPhase();
    processHammerfall(b);
    expect(scene._hammerfallState).toEqual(b._hammerfallState);
    expect(scene._hammerfallState.marks.length).toBeGreaterThan(0);
    expect(scene._hammerfallState).toMatchObject({ slams: 0, lastProcessedTurn: 1 });
    expect(banners(scene)).toEqual([]); // nothing fell yet

    standOnMark(scene, b);
    const victim = scene.playerUnits[0];
    const expected = slamDamage(guardianOf(scene.enemyUnits), victim);
    const before = victim.currentHP;
    scene.turnManager.turnNumber = 2;
    b.turnManager.turnNumber = 2;
    await scene._hammerfallCtrl.processPhase();
    processHammerfall(b);
    expect(random).not.toHaveBeenCalled();
    expect(scene._hammerfallState).toEqual(b._hammerfallState);
    expect(scene._hammerfallState.slams).toBe(1);
    expect(hp(scene.playerUnits)).toEqual(hp(b.playerUnits));
    expect(victim.currentHP).toBe(Math.max(0, before - expected));
    expect(banners(scene)).toEqual([HAMMERFALL_BANNERS.slam]);
    expect(scene.shakeScreen).toHaveBeenCalledWith('crash');
  });

  it('a second pass in the same turn (a resumed enemy phase) does nothing', async () => {
    const { scene } = sceneOf();
    await scene._hammerfallCtrl.processPhase();
    const state = structuredClone(scene._hammerfallState);
    await scene._hammerfallCtrl.processPhase();
    expect(scene._hammerfallState).toEqual(state);
  });

  it('a victim the slam fells leaves the board', async () => {
    const { scene, b } = sceneOf();
    await scene._hammerfallCtrl.processPhase();
    standOnMark(scene, b);
    scene.playerUnits[0].currentHP = 1;
    scene.turnManager.turnNumber = 2;
    await scene._hammerfallCtrl.processPhase();
    expect(scene.removeUnit).toHaveBeenCalledTimes(1);
    expect(scene.removeUnit.mock.calls[0][1]).toMatchObject({
      killer: guardianOf(scene.enemyUnits),
    });
  });

  it("the Guardian's fall clears its marks", async () => {
    const { scene } = sceneOf();
    await scene._hammerfallCtrl.processPhase();
    expect(scene._hammerfallCtrl.shown.length).toBeGreaterThan(0);
    const g = guardianOf(scene.enemyUnits);
    g.currentHP = 0;
    await scene.removeUnit(g);
    expect(scene._hammerfallState.marks).toEqual([]);
    expect(scene._hammerfallCtrl.shown).toEqual([]);
  });
});

describe('Danger shows where the hammer falls', () => {
  it('every marked tile is in the Danger view, past the maul’s own reach, and moves it', () => {
    const b = harness();
    const before = new Set(tileKeys(computeDangerTiles(b._playerThreatContext())));
    const beforeSig = threatWorldSignature(b._playerThreatContext(), b.enemyUnits);
    b.turnManager.turnNumber = 1;
    processHammerfall(b);
    const marks = tileKeys(b._hammerfallState.marks);
    expect(marks.length).toBeGreaterThan(0);
    // Hammerfall reaches farther than the maul (range 1): some mark was not in Danger before.
    expect(marks.some((k) => !before.has(k))).toBe(true);
    const after = new Set(tileKeys(computeDangerTiles(b._playerThreatContext())));
    for (const k of marks) expect(after.has(k), k).toBe(true);
    // Threat Sight and the pinned zone redraw: the world's signature changed with the marks.
    expect(threatWorldSignature(b._playerThreatContext(), b.enemyUnits)).not.toBe(beforeSig);
  });
});

describe('Threat Sight names the hammer, never a foe that "targets you"', () => {
  // Failure: a marked tile reads "1 foe can reach · none target you" (the AI's own pick is
  // someone else), though the slam lands on whoever stands there.
  const occupied = (b) =>
    new Set(
      [...b.playerUnits, ...b.enemyUnits].flatMap((u) =>
        getFootprint(u).map((t) => `${t.col},${t.row}`),
      ),
    );

  function markedTile(b, { inMaulReach }) {
    const ctx = b._playerThreatContext();
    const guardian = guardianOf(b.enemyUnits);
    const taken = occupied(b);
    return b._hammerfallState.marks.find((t) => {
      if (taken.has(`${t.col},${t.row}`)) return false;
      const reach = threatsOnTile({ ...ctx, hammerfallMarks: new Set() }, t.col, t.row);
      return reach.damage.includes(guardian) === inMaulReach;
    });
  }

  it('a mark past the maul: no foe reaches, the hazard says the hit and its damage, and it lands', () => {
    const b = harness();
    b.turnManager.turnNumber = 1;
    processHammerfall(b);
    const guardian = guardianOf(b.enemyUnits);
    b.enemyUnits = [guardian]; // the hall's other foes would add clauses of their own
    const tile = markedTile(b, { inMaulReach: false });
    expect(tile).toBeTruthy();
    const mover = b.playerUnits[0];
    mover.col = tile.col;
    mover.row = tile.row;
    const result = threatsOnTile(b._playerThreatContext(), tile.col, tile.row, { mover });
    expect(result.damage).toEqual([]);
    // STR + the slam's might, less DEF (plates add nothing at full health).
    const expected = Math.max(0, guardian.stats.STR + guardian.hammerfall.might - mover.stats.DEF);
    expect(result.hazards).toEqual([{ kind: 'hammerfall', source: guardian, damage: expected }]);
    // Threat Sight folds in `aimed` = 0 (the AI picks no one here): still no "targets you".
    const text = threatSummaryText({ ...result, aimed: 0 });
    expect(text).not.toMatch(/target/);
    expect(text).not.toMatch(/No foe can reach/);
    expect(text).toContain(`Hammerfall hits this tile next enemy phase: ${expected} damage`);
    const before = mover.currentHP;
    b.turnManager.turnNumber = 2;
    processHammerfall(b);
    expect(before - mover.currentHP).toBe(Math.min(before, expected));
  });

  it('a mark the maul reaches too: the foe and the hazard each get their clause', () => {
    const b = harness();
    b.turnManager.turnNumber = 1;
    processHammerfall(b);
    // Shock rings the body: its inner ring is in the maul's reach. Front may not reach far
    // enough, so play on until a mark beside the body is free.
    let tile = markedTile(b, { inMaulReach: true });
    for (let turn = 2; !tile && turn < 6; turn++) {
      b.turnManager.turnNumber = turn;
      processHammerfall(b);
      tile = markedTile(b, { inMaulReach: true });
    }
    expect(tile).toBeTruthy();
    const guardian = guardianOf(b.enemyUnits);
    const result = threatsOnTile(b._playerThreatContext(), tile.col, tile.row);
    expect(result.damage).toContain(guardian);
    expect(result.hazards.map((h) => h.source)).toEqual([guardian]);
    expect(result.count).toBe(result.damage.length + result.ballistas.length + 1);
    const text = threatSummaryText({ ...result, aimed: 0 });
    expect(text).toMatch(/^\d+ foes? can reach · none target you · /);
    expect(text).toContain('Hammerfall hits this tile next enemy phase');
  });

  it('an unmarked tile reads as before', () => {
    const b = harness();
    const mover = b.playerUnits[0];
    const result = threatsOnTile(b._playerThreatContext(), mover.col, mover.row, { mover });
    expect(result.hazards).toEqual([]);
    expect(threatSummaryText(result)).not.toContain('Hammerfall');
  });
});

describe("the harness measures a fight from the Guardian's nearest tile", () => {
  // Failure: the harness measured from the Guardian's top-left tile, so a sword beside its
  // bottom-right tile fought at distance 3 and no one countered (the scene uses the body).
  function duel() {
    const b = harness();
    const guardian = guardianOf(b.enemyUnits);
    b.enemyUnits = [guardian];
    const fencer = b.playerUnits[0];
    b.playerUnits = [fencer];
    const sword = structuredClone(data.weapons.find((w) => w.name === 'Iron Sword'));
    fencer.inventory = [sword];
    fencer.weapon = sword;
    Object.assign(fencer.stats, { HP: 300, STR: 40, SKL: 60, SPD: 0, LCK: 0, DEF: 0 });
    fencer.currentHP = 300;
    Object.assign(guardian.stats, { SKL: 60, SPD: 0, LCK: 0 });
    fencer.skills = [];
    return { b, guardian, fencer };
  }

  it("a sword beside the Guardian's bottom-right tile is countered", () => {
    const { b, guardian, fencer } = duel();
    fencer.col = guardian.col + 2; // right of the bottom-right tile (anchor distance 3)
    fencer.row = guardian.row + 1;
    expect(combatDistance(fencer, guardian)).toBe(1);
    installSeed(11);
    b._executeCombat(fencer, guardian);
    restoreMathRandom();
    expect(fencer.currentHP).toBeLessThan(300);
  });

  it('the harness finds the Guardian on any of its four tiles', () => {
    const { b, guardian } = duel();
    for (const t of getFootprint(guardian)) expect(b.getUnitAt(t.col, t.row)).toBe(guardian);
  });

  it('the Guardian striking from its bottom-right tile is countered', () => {
    const { b, guardian, fencer } = duel();
    const hpBefore = guardian.currentHP;
    fencer.col = guardian.col + 1; // below the bottom-right tile (anchor distance 3)
    fencer.row = guardian.row + 2;
    expect(combatDistance(guardian, fencer)).toBe(1);
    installSeed(11);
    b._executeEnemyCombat(guardian, fencer);
    restoreMathRandom();
    expect(fencer.currentHP).toBeLessThan(300);
    expect(guardian.currentHP).toBeLessThan(hpBefore);
  });
});

describe('the fog keeps its secret', () => {
  it('an unseen Guardian: no marks drawn, no banner, no shake, but the slam still lands', async () => {
    const { scene, b } = sceneOf({ visible: ['0,0'] });
    await scene._hammerfallCtrl.processPhase();
    expect(scene._hammerfallState.marks.length).toBeGreaterThan(0);
    expect(scene._hammerfallCtrl.shown).toEqual([]);
    expect(scene.showMinorHintAt).not.toHaveBeenCalled();
    standOnMark(scene, b);
    const victim = scene.playerUnits[0];
    const before = victim.currentHP;
    scene.turnManager.turnNumber = 2;
    await scene._hammerfallCtrl.processPhase();
    expect(victim.currentHP).toBeLessThan(before);
    expect(scene.showBriefBanner).not.toHaveBeenCalled();
  });

  it('a seen Guardian: every mark drawn, and the hint names the pattern', async () => {
    const { scene } = sceneOf();
    await scene._hammerfallCtrl.processPhase();
    expect(tileKeys(scene._hammerfallCtrl.shown)).toEqual(tileKeys(scene._hammerfallState.marks));
    expect(scene.showMinorHintAt.mock.calls[0].at(-1)).toBe(
      HAMMERFALL_BANNERS[scene._hammerfallState.pattern],
    );
  });
});

describe('saves and resume', () => {
  it('a checkpoint carries the marks, validates, and its resume lands on the same marks', async () => {
    const { scene } = sceneOf();
    await scene._hammerfallCtrl.processPhase();
    const state = JSON.parse(JSON.stringify(captureBattleState(scene, { rngSeed: 7 })));
    expect(state.hammerfallState).toEqual(scene._hammerfallState);
    expect(validateBattleState(state)).toBe(true);

    const restored = sceneOf().scene;
    restored.playerUnits = [];
    restored.enemyUnits = [];
    new BattleSuspendController(restored).applyUnits(state);
    expect(restored._hammerfallState).toEqual(scene._hammerfallState);
    // The resumed enemy phase reaches the step again: nothing more happens.
    await restored._hammerfallCtrl.processPhase();
    expect(restored._hammerfallState).toEqual(scene._hammerfallState);
  });

  it('a malformed record fails validation; a battle without a Guardian saves none', async () => {
    const { scene } = sceneOf();
    await scene._hammerfallCtrl.processPhase();
    const good = JSON.parse(JSON.stringify(captureBattleState(scene, { rngSeed: 7 })));
    const bad = (edit) => {
      const state = structuredClone(good);
      edit(state.hammerfallState);
      return validateBattleState(state);
    };
    expect(bad(() => {})).toBe(true);
    expect(bad((h) => (h.next = 'up'))).toBe(false);
    expect(bad((h) => (h.pattern = 'sideways'))).toBe(false);
    expect(bad((h) => (h.slams = -1))).toBe(false);
    expect(bad((h) => delete h.lastProcessedTurn)).toBe(false);
    expect(bad((h) => (h.marks = [{ col: 'a', row: 1 }]))).toBe(false);

    scene._hammerfallState = null;
    const plain = JSON.parse(JSON.stringify(captureBattleState(scene, { rngSeed: 7 })));
    expect(plain).not.toHaveProperty('hammerfallState');
    expect(validateBattleState(plain)).toBe(true);
  });
});
