// Galeforce (docs/specs/aoe-weapon-arts.md §4, owner decision: full refresh): when
// Oathstorm (Oathaxe's Galeforce Assault) kills its target, its user may move and act
// again, through the same continuation as Commander's Gambit (`refreshActor`). The ways
// this can fail: the refresh fires on a miss, a survivor, a dead or rooted user, or
// another art; it refreshes more than the user; it is lost or forged across a
// suspend/resume or a Vision snapshot; Gambit and Galeforce double up.
import { afterEach, describe, expect, it, vi } from 'vitest';
import './harness/JourneyTestSetup.js';
import { journeyBattleScene } from './harness/JourneyBattleScene.js';
import { presentationFailureProxy as rendering } from './harness/PresentationFailureProxy.js';
import { BattleScene } from '../src/scenes/BattleScene.js';
import { TurnManager } from '../src/engine/TurnManager.js';
import { createBattleRng } from '../src/engine/BattleRng.js';
import { applyCondition } from '../src/engine/StatusConditionSystem.js';
import {
  canUseWeaponArt,
  getWeaponArtKillEffects,
  getWeaponArtTier2Effects,
  killMoveRefreshesActor,
} from '../src/engine/WeaponArtSystem.js';
import { completeResolvedAction } from '../src/ui/BattlePresentationCheckpoint.js';
import { loadGameData } from './testData.js';
import { validateCrossReferences } from '../tools/validateCrossReferences.js';

const data = loadGameData();
const galeforce = data.weaponArts.arts.find((a) => a.id === 'legend_galeforce_assault');
const originalRandom = Math.random;
afterEach(() => {
  Math.random = originalRandom;
  vi.restoreAllMocks();
});

describe('the data', () => {
  it("Oathstorm's step is gone; its kill refreshes; its HP cut and ally buff stay", () => {
    expect(getWeaponArtKillEffects(galeforce).killMove).toEqual({ refresh: true });
    expect(getWeaponArtTier2Effects(galeforce).postCombatMove).toEqual([]);
    expect(getWeaponArtTier2Effects(galeforce).setHp).toEqual([
      expect.objectContaining({ target: 'attacker', value: 5 }),
    ]);
    expect(galeforce.effects.allyBuff).toBeTruthy();
    expect(galeforce.perTurnLimit).toBe(1);
  });

  it('the validator holds a kill-move to a player-only refresh', () => {
    const weaponArts = structuredClone(data.weaponArts);
    const art = weaponArts.arts.find((a) => a.id === 'legend_galeforce_assault');
    art.effects.killMove = { refresh: 'yes' };
    art.allowedFactions = ['player', 'enemy'];
    const { errors } = validateCrossReferences({ ...data, weaponArts });
    expect(errors.some((e) => e.includes('killMove must be'))).toBe(true);
    expect(errors.some((e) => e.includes('player only') && e.includes('galeforce'))).toBe(true);
    expect(validateCrossReferences(data).errors.filter((e) => e.includes('killMove'))).toEqual([]);
  });

  it('no other art refreshes its user', () => {
    const others = data.weaponArts.arts.filter((a) => getWeaponArtKillEffects(a).killMove);
    expect(others.map((a) => a.id)).toEqual(['legend_galeforce_assault']);
  });
});

describe('when the refresh fires', () => {
  const user = (extra = {}) => ({ name: 'Kael', currentHP: 5, ...extra });
  const rooted = user();
  applyCondition(rooted, 'root', 2);
  it.each([
    ['the target fell', galeforce, user(), { currentHP: 0 }, true],
    ['the target lives', galeforce, user(), { currentHP: 3 }, false],
    ['its user fell too', galeforce, user({ currentHP: 0 }), { currentHP: 0 }, false],
    ['its user is rooted', galeforce, rooted, { currentHP: 0 }, false],
    [
      'another art',
      data.weaponArts.arts.find((a) => a.id === 'axe_smash'),
      user(),
      { currentHP: 0 },
      false,
    ],
    ['no art', null, user(), { currentHP: 0 }, false],
    ['no target', galeforce, user(), null, false],
  ])('%s → %s', (_label, art, attacker, primary, expected) => {
    expect(killMoveRefreshesActor({ art, attacker, primary })).toBe(expected);
  });
});

/** A scene with Kael (the actor), a neighbour and a far ally, all spent. */
function completionScene() {
  const scene = new BattleScene();
  const units = [
    { name: 'Kael', col: 1, row: 1, currentHP: 5 },
    { name: 'Near', col: 2, row: 1, currentHP: 20 },
    { name: 'Far', col: 4, row: 1, currentHP: 20 },
  ].map((unit) => ({
    ...unit,
    hasActed: true,
    hasMoved: true,
    _movementCommitted: true,
    _movementSpent: 3,
  }));
  Object.assign(scene, {
    _battleSession: 1,
    playerUnits: units,
    checkBattleEnd: () => false,
    grid: { clearAttackHighlights: vi.fn() },
    commitVisionSnapshotIfPending: vi.fn(),
    _captureSuspendCheckpoint: vi.fn(),
    finishUnitAction: vi.fn(),
  });
  scene.turnManager = new TurnManager({
    checkBattleEnd: () => false,
    onPhaseChange: () => {},
    onVictory: () => {},
    onDefeat: () => {},
  });
  scene.turnManager.init(units, [{ currentHP: 20 }], []);
  return { scene, units };
}
// Saved and read back as a suspend checkpoint or a Vision snapshot holds it.
const resumed = (continuation) => JSON.parse(JSON.stringify(continuation));

describe('the refresh (completeResolvedAction)', () => {
  it('a JSON-resumed Galeforce refreshes its user alone and checkpoints once', () => {
    const { scene, units } = completionScene();
    completeResolvedAction(
      scene,
      resumed({ kind: 'combat', unitName: 'Kael', refreshActor: true }),
      { session: 1 },
    );
    expect(units.map((u) => u.hasActed)).toEqual([false, true, true]);
    expect(units.map((u) => u.hasMoved)).toEqual([false, true, true]);
    expect(units.map((u) => u._movementSpent)).toEqual([0, 3, 3]);
    expect(units[0]._movementCommitted).toBe(false);
    expect(units[0]._gambitUsedThisTurn).toBeUndefined();
    expect(scene.battleState).toBe('PLAYER_IDLE');
    expect(scene._timelineFacts).toEqual(['Kael can act again.']);
    expect(scene._captureSuspendCheckpoint).toHaveBeenCalledTimes(1);
    expect(scene.finishUnitAction).not.toHaveBeenCalled();
  });

  it('without the flag the action finishes as before', () => {
    const { scene, units } = completionScene();
    completeResolvedAction(scene, resumed({ kind: 'combat', unitName: 'Kael' }), { session: 1 });
    expect(units[0].hasActed).toBe(true);
    expect(scene.finishUnitAction).toHaveBeenCalledTimes(1);
  });

  it("Commander's Gambit wins when both fire: one refresh, the Gambit's", () => {
    const { scene, units } = completionScene();
    completeResolvedAction(
      scene,
      resumed({ kind: 'combat', unitName: 'Kael', gambitTriggered: true, refreshActor: true }),
      { session: 1 },
    );
    expect(units.map((u) => u.hasActed)).toEqual([false, false, true]);
    expect(units[0]._gambitUsedThisTurn).toBe(true);
    expect(scene._timelineFacts).toEqual(["Commander's Gambit refreshed nearby allies."]);
  });

  it('a Gambit already spent this turn leaves the Galeforce refresh to fire', () => {
    const { scene, units } = completionScene();
    units[0]._gambitUsedThisTurn = true;
    completeResolvedAction(
      scene,
      resumed({ kind: 'combat', unitName: 'Kael', gambitTriggered: true, refreshActor: true }),
      { session: 1 },
    );
    expect(units.map((u) => u.hasActed)).toEqual([false, true, true]);
    expect(scene._timelineFacts).toEqual(['Kael can act again.']);
  });

  it('a user that fell before resume is not refreshed', () => {
    const { scene, units } = completionScene();
    units[0].currentHP = 0;
    completeResolvedAction(
      scene,
      resumed({ kind: 'combat', unitName: 'Kael', refreshActor: true }),
      { session: 1 },
    );
    expect(units.map((u) => u.hasActed)).toEqual([true, true, true]);
    expect(scene._timelineFacts || []).toEqual([]);
  });

  it('a forged refresh (not a boolean) is refused whole', () => {
    const { scene, units } = completionScene();
    completeResolvedAction(
      scene,
      resumed({ kind: 'combat', unitName: 'Kael', refreshActor: 'yes' }),
      { session: 1 },
    );
    expect(units[0].hasActed).toBe(true);
    expect(scene.finishUnitAction).not.toHaveBeenCalled();
    expect(scene._captureSuspendCheckpoint).not.toHaveBeenCalled();
  });
});

describe('a Galeforce Assault in the scene (executeCombat)', () => {
  async function fight(primaryHP) {
    const oathaxe = structuredClone(data.weapons.find((w) => w.name === 'Oathaxe'));
    const kael = {
      name: 'Kael',
      faction: 'player',
      level: 15,
      tier: 'promoted',
      col: 1,
      row: 1,
      xp: 0,
      currentHP: 30,
      stats: { HP: 30, STR: 30, MAG: 0, SKL: 99, SPD: 10, DEF: 7, RES: 3, LCK: 30, MOV: 5 },
      moveType: 'Infantry',
      weapon: oathaxe,
      inventory: [oathaxe],
      proficiencies: [{ type: 'Axe', rank: 'Mast' }],
      skills: [],
      accessory: null,
      affixes: [],
      isCommander: true,
      isLord: true,
      _gambitUsedThisTurn: true,
    };
    const enemy = (name, col, row, hp) => ({
      name,
      faction: 'enemy',
      level: 10,
      tier: 'base',
      className: 'Soldier',
      col,
      row,
      currentHP: hp,
      stats: { HP: hp, STR: 5, MAG: 0, SKL: 5, SPD: 5, DEF: 0, RES: 0, LCK: 0, MOV: 5 },
      moveType: 'Infantry',
      weapon: null,
      inventory: [],
      skills: [],
      accessory: null,
      affixes: [],
    });
    const primary = enemy('Primary', 2, 1, primaryHP);
    const far = enemy('Far', 3, 3, 20); // keeps the battle going
    const scene = journeyBattleScene({}, data);
    scene.runManager = null;
    scene._battleRewindPolicy = 'fixed-v1';
    scene._battleRng = createBattleRng(42);
    Math.random = scene._battleRng;
    Object.assign(scene.grid, {
      fogEnabled: false,
      clearTemporaryTerrainsBySource: () => {},
      getMoveCost: () => 1,
      getTerrainAt: () => data.terrain.find((t) => t.name === 'Plain'),
    });
    scene.battleConfig = { objective: 'rout' };
    scene.goldEarned = 0;
    scene.turnPar = 99;
    scene.getCurrentTurnNumber = () => 1;
    scene.playerUnits = [kael];
    scene.enemyUnits = [primary, far];
    rendering(scene, 0);
    scene._getSelectedWeaponArtForUnit = () => galeforce;
    scene.animateStrike = async () => {};
    scene.animateSkillActivation = async () => {};
    scene._battleBeats.checkBossHalfHealth = async () => {};
    scene._battleBeats.onChipLance = () => {};
    scene._battleBeats.onLowHealth = () => {};
    scene.sys = { isActive: () => true };
    scene.scene = { isActive: () => true };
    scene.awardScaledXP = async () => {};
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await scene.executeCombat(kael, primary);
    return { scene, kael, primary };
  }

  it('a kill leaves its user free to move and act, at 5 HP', async () => {
    // (30 STR + 11 might + 10) × 0.6 = 30 a strike: the 20-HP target falls.
    const { scene, kael, primary } = await fight(20);
    expect(primary.currentHP).toBe(0);
    expect(scene.enemyUnits).not.toContain(primary);
    expect(kael.currentHP).toBe(5);
    expect([kael.hasActed, kael.hasMoved]).toEqual([false, false]);
    expect(scene.battleState).toBe('PLAYER_IDLE');
    // Once a turn: the art's use rides on the unit (saved and rewound with it), so a
    // refreshed Kael, or one restored from a checkpoint, cannot chain a second one.
    // (HP topped up so the 5 HP cost is not what refuses it.)
    const restored = JSON.parse(JSON.stringify({ ...kael, currentHP: 30 }));
    for (const unit of [{ ...kael, currentHP: 30 }, restored])
      expect(canUseWeaponArt(unit, unit.weapon, galeforce, { turnNumber: 1 }).reason).toBe(
        'per_turn_limit',
      );
  });

  it('a survivor ends its turn as any attack does', async () => {
    const { kael, primary } = await fight(500);
    expect(primary.currentHP).toBeGreaterThan(0);
    expect(kael.hasActed).toBe(true);
  });
});
