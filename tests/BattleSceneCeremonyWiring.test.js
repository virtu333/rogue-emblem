// BattleScene only wires ceremonies: these pin the seams (once-per-battle boss
// card, silent resume, HP → bar, phase/boss-felled bands with canvas fallback).
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ default: { Scene: class {} } }));
import { installFakeDom } from './helpers/fakeDom.js';
import { BattleScene } from '../src/scenes/BattleScene.js';
import { BossPresenceController } from '../src/ui/BossPresenceController.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const ceremonies = () => ({
  showBossIntro: vi.fn(async () => true),
  showPhase: vi.fn(() => ({ destroy: vi.fn() })),
  showBossFelled: vi.fn(() => ({ destroy: vi.fn() })),
  isBlocking: vi.fn(() => false),
});

function textStub() {
  const t = {};
  for (const m of ['setOrigin', 'setAlpha', 'setDepth']) t[m] = () => t;
  t.destroy = vi.fn();
  return t;
}

describe('BattleScene ceremony wiring', () => {
  it('a blocking ceremony locks story input like dialogue does', () => {
    const scene = Object.create(BattleScene.prototype);
    scene._ceremonies = { isBlocking: () => true };
    expect(scene.isStoryInputLocked()).toBe(true);
    scene._ceremonies = { isBlocking: () => false };
    expect(scene.isStoryInputLocked()).toBe(false);
  });

  it('fresh boss battle: bar created, card shown once with the boss and act', async () => {
    const scene = Object.create(BattleScene.prototype);
    const boss = { name: 'Dark Rider', isBoss: true };
    Object.assign(scene, {
      isBoss: true,
      _bossName: 'Dark Rider',
      runManager: {},
      enemyUnits: [{ name: 'Fighter' }, boss],
      battleParams: { act: 'act2' },
      _resumeCheckpoint: null,
    });
    const c = ceremonies();
    scene._getCeremonies = () => c;
    await scene._presentBossEncounter();
    expect(scene._bossPresence).toBeInstanceOf(BossPresenceController);
    expect(c.showBossIntro).toHaveBeenCalledWith({ unit: boss, actId: 'act2' });
  });

  it('resumed battle never replays the card; non-boss battles never show it', async () => {
    const c = ceremonies();
    const resumed = Object.create(BattleScene.prototype);
    Object.assign(resumed, {
      isBoss: true,
      _bossName: 'Dark Rider',
      runManager: {},
      enemyUnits: [],
      _resumeCheckpoint: { turnNumber: 4 },
      _getCeremonies: () => c,
    });
    await resumed._presentBossEncounter();
    const plain = Object.create(BattleScene.prototype);
    Object.assign(plain, {
      isBoss: false,
      _bossName: 'Warchief', // seize maps carry a named boss outside boss nodes
      runManager: {},
      enemyUnits: [],
      _resumeCheckpoint: null,
      _getCeremonies: () => c,
    });
    await plain._presentBossEncounter();
    expect(c.showBossIntro).not.toHaveBeenCalled();
    expect(plain._bossPresence).toBeInstanceOf(BossPresenceController);
  });

  it('boss HP changes reach the bar through updateHPBar; others do not', () => {
    const scene = Object.create(BattleScene.prototype);
    const hp = {
      bg: { setPosition: vi.fn() },
      fill: { setPosition: vi.fn(), setSize: vi.fn(), setFillStyle: vi.fn() },
    };
    scene.grid = { gridToPixel: () => ({ x: 0, y: 0 }) };
    scene._bossPresence = { onUnitHp: vi.fn() };
    const boss = { isBoss: true, col: 0, row: 0, currentHP: 5, stats: { HP: 10 }, hpBar: hp };
    const grunt = { col: 0, row: 0, currentHP: 5, stats: { HP: 10 }, hpBar: hp };
    scene.updateHPBar(grunt);
    expect(scene._bossPresence.onUnitHp).not.toHaveBeenCalled();
    scene.updateHPBar(boss);
    expect(scene._bossPresence.onUnitHp).toHaveBeenCalledWith(boss);
  });

  it('phase banner: DOM band when hosted (bar status refreshed), canvas text otherwise', () => {
    installFakeDom(vi);
    const scene = Object.create(BattleScene.prototype);
    const c = ceremonies();
    Object.assign(scene, {
      _getCeremonies: () => c,
      _bossPresence: { sync: vi.fn() },
      gameData: {},
      battleConfig: {},
      battleParams: { act: 'act1' },
      add: { text: vi.fn(() => textStub()) },
    });
    scene.showPhaseBanner('enemy', 3);
    expect(c.showPhase).toHaveBeenCalledWith({ phase: 'enemy', turn: 3, place: '' });
    expect(scene._bossPresence.sync).toHaveBeenCalled();
    expect(scene.add.text).not.toHaveBeenCalled();
    expect(scene._phaseBanner).toBe(c.showPhase.mock.results[0].value);
  });

  it('boss felled: FOE VANQUISHED when hosted; canvas keeps its seize-only prompt', () => {
    installFakeDom(vi);
    const scene = Object.create(BattleScene.prototype);
    const c = ceremonies();
    Object.assign(scene, {
      _getCeremonies: () => c,
      battleConfig: { objective: 'rout' },
      enemyUnits: [{}, {}],
      tweens: { add: vi.fn() },
    });
    scene._showBossDefeatedBanner();
    expect(c.showBossFelled).toHaveBeenCalledWith({ objective: 'rout', remaining: 2 });
    vi.unstubAllGlobals();
    const canvas = Object.create(BattleScene.prototype);
    Object.assign(canvas, {
      battleConfig: { objective: 'rout' },
      add: { text: vi.fn(() => textStub()) },
      tweens: { add: vi.fn() },
      cameras: { main: { centerX: 0, centerY: 0 } },
      _pinToScreen: vi.fn(),
    });
    canvas._showBossDefeatedBanner();
    expect(canvas.add.text).not.toHaveBeenCalled();
    canvas.battleConfig.objective = 'seize';
    canvas._showBossDefeatedBanner();
    expect(canvas.add.text).toHaveBeenCalledTimes(1);
  });

  it('a boss death drains the bar; the band shows only when the battle goes on', async () => {
    const boss = {
      name: 'Dark Rider',
      isBoss: true,
      faction: 'enemy',
      col: 1,
      row: 1,
      affixes: [],
    };
    const make = (objective, others) => {
      const scene = Object.create(BattleScene.prototype);
      Object.assign(scene, {
        registry: { get: () => null },
        enemyUnits: [boss, ...others],
        playerUnits: [],
        npcUnits: [],
        battleConfig: { objective },
        gameData: { affixes: { affixes: [] } },
        grid: { gridToPixel: () => ({ x: 0, y: 0 }) },
        _bossPresence: { onBossDefeated: vi.fn() },
        _showBossDefeatedBanner: vi.fn(),
        _applyKillRewards: vi.fn(),
        removeUnitGraphic: vi.fn(),
        updateObjectiveText: vi.fn(),
        _combatFx: { deathFade: vi.fn(async () => {}) },
        _battleBeats: { onKill: vi.fn() },
      });
      return scene;
    };
    const last = make('rout', []);
    await last.removeUnit(boss);
    expect(last._bossPresence.onBossDefeated).toHaveBeenCalledTimes(1);
    expect(last._showBossDefeatedBanner).not.toHaveBeenCalled(); // victory follows
    const seize = make('seize', []);
    await seize.removeUnit(boss);
    expect(seize._showBossDefeatedBanner).toHaveBeenCalledTimes(1);
    const more = make('rout', [{ name: 'Fighter', faction: 'enemy' }]);
    await more.removeUnit(boss);
    expect(more._showBossDefeatedBanner).toHaveBeenCalledTimes(1);
  });
});
