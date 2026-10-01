import { afterEach, describe, expect, it, vi } from 'vitest';
import './harness/JourneyTestSetup.js';
import { journeyBattleScene } from './harness/JourneyBattleScene.js';
import { loadGameData } from './testData.js';
import { BattleScene } from '../src/scenes/BattleScene.js';
import { aoeSplash, allyBuff } from '../src/engine/PostCombatEffects.js';
import { createBattleRng } from '../src/engine/BattleRng.js';
import { createUnit } from '../src/engine/UnitManager.js';
import { Grid } from '../src/engine/Grid.js';
import { TurnManager } from '../src/engine/TurnManager.js';
import { VillageController } from '../src/ui/VillageController.js';
import { createVillageState } from '../src/engine/VillageSystem.js';
import { completeBattleAction } from '../src/ui/BattleActionCompletion.js';
import { RunDriver, JourneyStorage } from './harness/RunDriver.js';
import { _resetUidCounter } from '../src/utils/itemUid.js';
import { isolateBattleTextFactory } from '../src/utils/presentationText.js';

const data = loadGameData();
const originalRandom = Math.random;
const veteranFixture = (() => {
  Math.random = createBattleRng(11);
  try {
    return createUnit(
      data.classes.find((c) => c.name === 'Fighter'),
      14,
      data.weapons,
      { name: 'Veteran' },
    );
  } finally {
    Math.random = originalRandom;
  }
})();

afterEach(() => {
  Math.random = originalRandom;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// Proxy every rendering surface supplied by the Journey fixture. Throw at the
// nth actual presentation call, rather than mirroring production failure points.
function rendering(scene, failure = 0) {
  let calls = 0;
  const call =
    (fn) =>
    (...args) => {
      calls++;
      if (failure === 'all' || calls === failure) throw new Error('Renderer unavailable');
      return fn(...args);
    };
  const visual = new Proxy(
    {},
    { get: (_, key) => (key === 'then' ? undefined : call(() => visual)) },
  );
  const surface = (methods) =>
    new Proxy(methods, {
      get: (target, key) => (typeof target[key] === 'function' ? call(target[key]) : target[key]),
    });
  scene.add = surface({
    text: () => {
      Math.random();
      return visual;
    },
  });
  scene.tweens = surface({ add: () => {} });
  scene._combatFx = surface({
    deathFade: async () => {},
    playOverlay: () => {},
    playStatus: () => {},
    finishStrike: () => {},
  });
  scene._musicCtrl = surface({ onCombat: () => {}, onCombatResolved: () => {} });
  scene._battleBeats = surface({ onKill: () => {}, onAllyFall: () => {} });
  scene._inputController = surface({ refreshHoverInfo: () => {} });
  scene._pinnedThreats = surface({ invalidate: () => {} });
  for (const name of [
    'updateHPBar',
    'removeUnitGraphic',
    'updateObjectiveText',
    'showMinorHintAt',
    'updateUnitPosition',
    'refreshVisibleDangerZone',
    'updateEnemyVisibility',
    'animateHeal',
  ]) {
    scene[name] = call(() => {});
  }
  scene._awaitSceneDelay = call(async () => {});
  isolateBattleTextFactory(scene); // Production fixed-v1 setup; legacy streams intentionally differ.
  const count = () => calls;
  count.visual = visual;
  count.call = call;
  return count;
}
function unit(name, faction, col, row, hp = 20) {
  return {
    name,
    faction,
    col,
    row,
    currentHP: hp,
    stats: { HP: 20 },
    className: 'Soldier',
    level: 1,
    affixes: [],
  };
}
function fixture(failure = 0, seed = 42) {
  const scene = journeyBattleScene({}, data);
  scene.runManager = null;
  scene._battleRewindPolicy = 'fixed-v1';
  scene._battleRng = createBattleRng(seed);
  Math.random = scene._battleRng;
  scene.grid.fogEnabled = false;
  scene.grid.clearTemporaryTerrainsBySource = () => {};
  scene.grid.getMoveCost = () => 1;
  scene.battleConfig = { objective: 'rout' };
  scene.goldEarned = 0;
  scene.getEnemyRewardMultiplier = () => 1;
  scene.getTurnPressureState = () => ({ goldMultiplier: 1, xpMultiplier: 1 });
  scene.getCurrentTurnNumber = () => 1;
  scene.showLordDeathVisionPrompt = () => false;
  scene.checkBattleEnd = BattleScene.prototype.checkBattleEnd;
  scene.onVictory = () => {
    scene.result = 'victory';
    scene.battleState = 'BATTLE_END';
  };
  scene.onDefeat = () => {
    scene.result = 'defeat';
    scene.battleState = 'BATTLE_END';
  };
  const calls = rendering(scene, failure);
  if (!vi.isMockFunction(console.warn)) vi.spyOn(console, 'warn').mockImplementation(() => {});
  return { scene, calls };
}
function snapshot(scene) {
  return structuredClone({
    players: scene.playerUnits,
    enemies: scene.enemyUnits,
    npcs: scene.npcUnits,
    deaths: scene._playerDeathsThisBattle || 0,
    gold: scene.goldEarned,
    remains: scene._zombieTombstones || [],
    state: scene.battleState,
    result: scene.result,
    pendingPopups: scene._pendingLevelUpPopups || [],
    checkpoint: scene.runManager?.battleInProgress?.checkpoint || null,
    village: scene._villageState || null,
    phase: scene.turnManager.currentPhase,
    terrainRevision: scene.grid.terrainRevision || 0,
    rng: scene._battleRng.getState(),
  });
}
async function scenario(kind, failure = 0) {
  const { scene, calls } = fixture(failure);
  const commander = { ...unit('Edric', 'player', 0, 0), isCommander: true, isLord: true };
  scene.playerUnits = [commander];
  if (kind === 'post-effects') {
    const source = commander;
    const primary = unit('Primary', 'enemy', 2, 2);
    const first = unit('Splash victim', 'enemy', 3, 2, 4);
    const second = unit('Zombie', 'enemy', 2, 3, 3);
    second.className = 'Zombie';
    scene.enemyUnits = [primary, first, second];
    const ally = unit('Ally', 'player', 0, 1);
    scene.playerUnits.push(ally);
    function* beats() {
      yield* aoeSplash(
        { radius: 1, damageKind: 'fixed', fixedDamage: 6 },
        source,
        primary,
        scene._postCombatWorld(),
      );
      yield* allyBuff(
        { range: 1, stats: { STR: 2 }, durationPhases: 1 },
        source,
        scene._postCombatWorld(),
      );
    }
    await scene._playPostCombatBeats(beats());
    expect(first.currentHP).toBe(0);
    expect(second.currentHP).toBe(0);
    expect(scene.enemyUnits.map((u) => u.name)).toEqual(['Primary']);
    expect(ally.stats.STR).toBe(2);
    expect(scene._zombieTombstones).toHaveLength(1);
  } else if (kind === 'Deathburst') {
    scene.runManager = {};
    scene.gameData = { ...data, deeds: null };
    const burst = { ...unit('Burst', 'enemy', 1, 1, 0), affixes: ['deathburst'] };
    const other = unit('Other enemy', 'enemy', 2, 1, 2);
    const npc = unit('Recruit', 'npc', 1, 2, 2);
    Object.assign(commander, { col: 1, row: 0, currentHP: 2 });
    scene.enemyUnits = [burst, other];
    scene.npcUnits = [npc];
    await scene.removeUnit(burst, { killer: commander });
    await scene.removeUnit(burst, { killer: commander }); // Reward/death chain cannot repeat.
    expect(scene.playerUnits).toEqual([]);
    expect(scene.enemyUnits).toEqual([]);
    expect(scene.npcUnits).toEqual([]);
    expect(scene._playerDeathsThisBattle).toBe(1);
    expect(scene.goldEarned).toBe(72); // Two level-1 enemies at28+8 each, once.
    expect(scene._deathAffixChainDepth).toBe(0);
    expect(scene.result).toBe('defeat');
  } else if (kind === 'Entity splash') {
    const primary = unit('Primary', 'player', 2, 2);
    Object.assign(commander, { col: 2, row: 1, currentHP: 1 });
    scene.playerUnits.push(primary);
    scene.playerUnits.push(unit('Ally', 'player', 3, 2, 1), unit('Third', 'player', 1, 2, 1));
    scene.npcUnits = [unit('Recruit', 'npc', 2, 3, 1)];
    const entity = {
      ...unit('The Entity', 'enemy', 0, 3, 100),
      _entityData: { width: 1, height: 1 },
    };
    scene.enemyUnits = [entity];
    await scene._applyEntitySplash(entity, primary);
    const all = [...scene.playerUnits, ...scene.enemyUnits, ...scene.npcUnits];
    expect(all.every((u) => u.currentHP > 0)).toBe(true);
    expect(scene.playerUnits.length + scene.npcUnits.length).toBe(3); // Exactly two secondary victims fall.
    scene.checkBattleEnd();
  } else if (kind === 'XP') {
    const veteran = structuredClone(veteranFixture);
    Object.assign(veteran, { faction: 'player', col: 1, row: 1, xp: 99 });
    scene.playerUnits.push(veteran);
    await scene.awardScaledXP(veteran, 20);
    expect(veteran.level).toBe(15);
    expect(veteran.xp).toBe(19);
    expect(veteran.skills).toContain('wrath');
    expect(scene._pendingLevelUpPopups).toHaveLength(1);
  } else if (kind === 'resolved combat') {
    const fighter = structuredClone(veteranFixture);
    Object.assign(fighter, { faction: 'player', col: 1, row: 1, skills: ['intimidate'] });
    const defender = structuredClone(veteranFixture);
    Object.assign(defender, { name: 'Defender', faction: 'enemy', col: 2, row: 1, skills: [] });
    scene.playerUnits = [commander, fighter];
    scene.enemyUnits = [defender];
    scene.addUnitGraphic(fighter);
    scene.addUnitGraphic(defender);
    const terrain = data.terrain.find((t) => t.name === 'Plain');
    scene.grid.getTerrainAt = () => terrain;
    // Initial strike failure belongs to PR5: here strikes are shown as no-op
    // rendering while the real combat/context/post-effects/cleanup still run.
    scene.animateStrike = async () => {};
    scene.animateSkillActivation = async () => {};
    const { result } = await scene._runCombatResolution(fighter, defender, {
      dist: 1,
      atkTerrain: terrain,
      defTerrain: terrain,
      selectedArt: null,
    });
    expect(fighter.currentHP).toBe(result.attackerHP);
    expect(defender.currentHP).toBe(result.defenderHP);
    expect(defender.stats.STR).toBe(veteranFixture.stats.STR - 1);
    expect(scene._combatSpeedSnapshot).toBeUndefined();
  } else if (kind === 'Phoenix') {
    Object.assign(commander, {
      currentHP: 2,
      accessory: data.accessories.find((a) => a.name === 'Phoenix Brooch'),
    });
    expect(await scene._checkPhoenixBrooch(commander)).toBe(true);
    expect(commander.currentHP).toBe(12);
    expect(commander._phoenixBroochUsed).toBe(true);
    expect(await scene._checkPhoenixBrooch(commander)).toBe(false);
  } else if (kind === 'action completion') {
    _resetUidCounter();
    const storage = new JourneyStorage();
    vi.stubGlobal('localStorage', storage);
    const driver = new RunDriver(storage);
    scene.runManager = driver.run;
    driver.run.beginBattleInProgress(driver.run.nodeMap.nodes[0].id, { battleParams: {} });
    scene._battleRng = createBattleRng(42);
    Math.random = scene._battleRng;
    const plain = data.terrain.findIndex((t) => t.name === 'Plain');
    scene.grid = Object.assign(Object.create(Grid.prototype), scene.grid, {
      terrainData: data.terrain,
      mapLayout: Array.from({ length: 4 }, () => Array(4).fill(plain)),
      fogEnabled: true,
      fogOverlays: Array.from({ length: 4 }, () => Array(4).fill(calls.visual)),
      updateFogOfWar: Grid.prototype.updateFogOfWar,
      setTerrainAt: Grid.prototype.setTerrainAt,
      _rerenderTile: calls.call(() => {}),
    });
    scene.updateEnemyVisibility = BattleScene.prototype.updateEnemyVisibility;
    scene.dimUnit = calls.call(() => {});
    scene.showBriefBanner = calls.call(() => Promise.resolve());
    scene._villageState = createVillageState({ col: 0, row: 0 });
    scene._villageController = new VillageController(scene);
    scene.enemyUnits = [
      { ...unit('Bandit', 'enemy', 3, 3), aiMode: 'seek_tile', graphic: calls.visual },
    ];
    scene.addUnitGraphic(commander);
    scene.turnManager = new TurnManager({
      onPhaseChange: () => {},
      checkBattleEnd: () => scene.checkBattleEnd(),
    });
    scene.turnManager.init(scene.playerUnits, scene.enemyUnits, scene.npcUnits);
    completeBattleAction(scene, commander);
    const saved = JSON.parse(storage.getItem('emblem_rogue_slot_1_run'))?.battleInProgress
      ?.checkpoint;
    expect(saved).toBeTruthy();
    expect(saved.playerUnits[0].hasActed).toBe(true);
    expect(saved.goldEarned).toBe(150);
    expect(saved.villageState.status).toBe('visited');
    expect(saved.phase).toBe('player');
    expect(scene.turnManager.currentPhase).toBe('enemy');
    expect(scene.enemyUnits[0].aiMode).toBe('chase');
    expect(scene.grid.visibleSet.size).toBe(10);
    expect(scene.grid.terrainRevision).toBe(1);
    scene.enemyUnits[0].graphic = null;
  }

  return { snapshot: snapshot(scene), calls: calls() };
}

describe.each([
  'post-effects',
  'Deathburst',
  'Entity splash',
  'XP',
  'action completion',
  'resolved combat',
  'Phoenix',
])('%s presentation failure matrix', (kind) => {
  it('matches complete fixed-v1 gameplay state with all visuals absent and at every rendering failure', async () => {
    const expected = await scenario(kind);
    expect(expected.calls).toBeGreaterThan(0);
    expect((await scenario(kind, 'all')).snapshot).toEqual(expected.snapshot);
    for (let nth = 1; nth <= expected.calls; nth++) {
      expect((await scenario(kind, nth)).snapshot, `presentation call ${nth}`).toEqual(
        expected.snapshot,
      );
    }
  });
});

it('sweeps all factions through normal removal, retaining Zombie remains and casualty accounting', async () => {
  const { scene } = fixture('all');
  scene.playerUnits = [
    { ...unit('Edric', 'player', 0, 0), isCommander: true },
    unit('Fallen', 'player', 1, 0, 0),
  ];
  scene.enemyUnits = [{ ...unit('Zombie', 'enemy', 2, 0, 0), className: 'Zombie' }];
  scene.npcUnits = [unit('Recruit', 'npc', 3, 0, 0)];
  await scene._sweepFallenUnits();
  expect(scene.playerUnits.map((u) => u.name)).toEqual(['Edric']);
  expect(scene.enemyUnits).toEqual([]);
  expect(scene.npcUnits).toEqual([]);
  expect(scene._playerDeathsThisBattle).toBe(1);
  expect(scene._zombieTombstones).toHaveLength(1);
  expect(scene.checkBattleEnd()).toBe(false); // Pending Zombie revival blocks Rout.
});

it('a zero-HP commander still awaiting removal cannot prevent defeat', () => {
  const { scene } = fixture();
  scene.playerUnits = [
    { ...unit('Edric', 'player', 0, 0, 0), isCommander: true },
    unit('Ally', 'player', 1, 0),
  ];
  scene.enemyUnits = [unit('Enemy', 'enemy', 2, 0)];
  expect(scene.checkBattleEnd()).toBe(true);
  expect(scene.result).toBe('defeat');
});

it('required post-combat beat errors remain visible to the caller', async () => {
  const { scene } = fixture();
  scene.removeUnit = () => {
    throw new Error('required removal failed');
  };
  await expect(scene._playPostCombatBeats([{ kind: 'remove', unit: {} }])).rejects.toThrow(
    'required removal failed',
  );
});
