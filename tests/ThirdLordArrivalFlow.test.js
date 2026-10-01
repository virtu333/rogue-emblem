// The Power of Friendship arrival, end to end through the scene-facing code: it is
// rolled and saved with the win (or with the boss recruit choice that precedes it),
// shown from that save, its reroll is saved as it is spent, and the choice is durable
// before anything follows it. Real RunManager and saves; only the card surfaces are
// stood in for.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ default: { Scene: class {} } }));
vi.mock('../src/engine/PendingBattleRewards.js', async () => {
  const actual = await vi.importActual('../src/engine/PendingBattleRewards.js');
  return { ...actual, prepareBattleRewards: vi.fn() };
});
// A boss with nobody to recruit (the flag) or the real draft.
vi.mock('../src/engine/BossRecruitSystem.js', async () => {
  const actual = await vi.importActual('../src/engine/BossRecruitSystem.js');
  return {
    ...actual,
    generateBossRecruitCandidates: (...args) =>
      globalThis.__noBossRecruit ? null : actual.generateBossRecruitCandidates(...args),
  };
});
vi.mock('../src/ui/BossRecruitOverlay.js', () => ({
  BossRecruitOverlay: class {
    constructor() {
      this.displayObjects = [];
    }
    show(onComplete) {
      onComplete(null);
    }
  },
}));
// The DOM card menu: hands the test the cards and the ways out.
vi.mock('../src/ui/PartyMenus.js', () => ({
  showArrivalMenu: vi.fn((owner, title, candidates, resolve, options) => {
    globalThis.__menu = { title, candidates, resolve, options };
  }),
}));
import { installFakeDom } from './helpers/fakeDom.js';
import { loadGameData } from './testData.js';
import { RunManager, loadRun } from '../src/engine/RunManager.js';
import { prepareBattleRewards } from '../src/engine/PendingBattleRewards.js';
import { prepareThirdLord } from '../src/engine/PendingThirdLord.js';
import { PostCombatController } from '../src/ui/PostCombatController.js';
import { LordArrivalOverlay } from '../src/ui/LordArrivalOverlay.js';
import { resumeLordArrival } from '../src/ui/LordArrivalResume.js';
import { saveServiceRun } from '../src/ui/serviceSave.js';
import { GrowthCeremonyController } from '../src/ui/GrowthCeremonyController.js';
import { showArrivalMenu } from '../src/ui/PartyMenus.js';
import { _resetInputFocus } from '../src/utils/inputFocus.js';

const gameData = loadGameData();
const names = (draft) => draft.candidates.map((c) => c.unit.name);
const shown = () => globalThis.__menu.candidates.map((c) => c.unit.name);

beforeEach(() => {
  vi.useFakeTimers();
  installFakeDom(vi);
  _resetInputFocus();
  const storage = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k) => storage.get(k) ?? null,
    setItem: (k, v) => storage.set(k, v),
    removeItem: (k) => storage.delete(k),
  });
  vi.spyOn(GrowthCeremonyController, 'available').mockReturnValue(false);
  delete globalThis.__menu;
  delete globalThis.__noBossRecruit;
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  _resetInputFocus();
});

function thirdBattleRun(mode = 'pick3_reroll', seed = 11) {
  const run = new RunManager(gameData);
  run.startRun({ runSeed: seed, difficultyId: 'normal' });
  run.metaEffects = { ...run.metaEffects, thirdLordMode: mode };
  run.completedBattles = 3;
  // The win's reward is owed: a draft only stands beside it.
  run.pendingBattleReward = { version: 1, choices: [{ type: 'gold', amount: 5 }], claimed: [] };
  return run;
}

/** A scene whose saves go to slot 1 and are recorded, as BattleScene's do. */
function sceneFor(run, extra = {}) {
  const meta = { recordLordsMet: vi.fn(() => true) };
  const saves = [];
  const scene = {
    _battleSession: 1,
    gameData,
    runManager: run,
    events: { once() {}, on() {}, off() {} },
    registry: { get: (k) => (k === 'activeSlot' ? 1 : k === 'meta' ? meta : null) },
    scene: { isActive: () => true },
    sys: { isActive: () => true },
    showLootScreen: vi.fn(),
    _showThirdLordArrival: vi.fn(),
    _persistBattleRunState: vi.fn(() => {
      saveServiceRun(scene);
      saves.push(JSON.parse(localStorage.getItem('emblem_rogue_slot_1_run')));
    }),
    meta,
    saves,
    ...extra,
  };
  return scene;
}

describe('the win that brings the lord due', () => {
  function victoryScene(run, { isBoss = false } = {}) {
    const scene = sceneFor(run, {
      _battleSession: 1,
      isBoss,
      isElite: false,
      nodeId: 'n1',
      goldEarned: 10,
      battleParams: { act: 'act1' },
      playerUnits: [],
      nonDeployedUnits: [],
      turnManager: { turnNumber: 3 },
      turnPar: 10,
      getTurnPressureState: () => ({ goldMultiplier: 1 }),
      clearBattleScopedDeltas: vi.fn(),
      showBriefBanner: vi.fn(() => Promise.resolve()),
      time: { delayedCall: () => ({ remove() {} }) }, // the band is never left
      _getCeremonies: () => ({ showVictory: () => ({ release() {}, destroy() {} }) }),
    });
    vi.spyOn(run, 'completeBattle').mockReturnValue(true);
    vi.spyOn(run, 'isRunComplete').mockReturnValue(false);
    // The reward is what the save holds beside the draft.
    prepareBattleRewards.mockImplementation((r) => {
      r.pendingBattleReward = { version: 1, choices: [{ type: 'gold', amount: 5 }], claimed: [] };
    });
    return scene;
  }

  it('the arrival is rolled and in the victory save, beside the unclaimed reward', () => {
    const run = thirdBattleRun();
    const scene = victoryScene(run);
    new PostCombatController(scene).onVictory();
    const saved = scene.saves[0];
    expect(saved.pendingBattleReward).toBeTruthy();
    expect(saved.pendingThirdLord.candidates).toHaveLength(3);
    expect(saved.pendingThirdLord.mode).toBe('pick3_reroll');
    expect(saved.pendingThirdLord.candidates.map((c) => c.unit.name)).toEqual(
      names(run.pendingThirdLord),
    );
  });

  it('no arrival is rolled when the upgrade is off or the lord already came', () => {
    const off = thirdBattleRun();
    off.metaEffects = { ...off.metaEffects, thirdLordMode: null };
    new PostCombatController(victoryScene(off)).onVictory();
    expect(off.pendingThirdLord).toBeNull();

    const came = thirdBattleRun();
    came.thirdLordJoined = true;
    new PostCombatController(victoryScene(came)).onVictory();
    expect(came.pendingThirdLord).toBeNull();
  });

  it('a boss win saves the recruit draft first, and the arrival once that choice is made', () => {
    const run = thirdBattleRun('pick3', 5);
    const scene = victoryScene(run, { isBoss: true });
    new PostCombatController(scene).onVictory();
    const atVictory = scene.saves[0];
    expect(atVictory.pendingBossRecruit).toBeTruthy();
    expect(atVictory.pendingThirdLord).toBeNull();

    // The recruit is skipped: the same save clears it and holds the arrival.
    scene.saves.length = 0;
    new PostCombatController(scene).showBossRecruitScreen();
    const after = scene.saves[0];
    expect(after.pendingBossRecruit).toBeNull();
    expect(after.pendingThirdLord.candidates.length).toBeGreaterThan(0);
  });

  it('a boss with nobody to recruit saves the arrival with the win', () => {
    globalThis.__noBossRecruit = true;
    const run = thirdBattleRun('pick3', 5);
    const scene = victoryScene(run, { isBoss: true });
    new PostCombatController(scene).onVictory();
    expect(scene.saves[0].pendingBossRecruit).toBeNull();
    expect(scene.saves[0].pendingThirdLord.candidates.length).toBeGreaterThan(0);
  });
});

describe('the arrival overlay', () => {
  it('an arrival not yet rolled is rolled, kept on the run and saved before it is drawn', () => {
    const run = thirdBattleRun();
    const scene = sceneFor(run);
    let savesWhenDrawn = -1;
    vi.mocked(showArrivalMenu).mockImplementationOnce((owner, title, candidates, resolve, o) => {
      savesWhenDrawn = scene.saves.length;
      globalThis.__menu = { title, candidates, resolve, options: o };
    });
    new LordArrivalOverlay(scene, run, gameData).show(vi.fn());
    expect(savesWhenDrawn).toBe(1);
    expect(scene.saves[0].pendingThirdLord.candidates.map((c) => c.unit.name)).toEqual(shown());
  });

  it('a reroll is spent and its new cards are saved before they are drawn', () => {
    const run = thirdBattleRun();
    const scene = sceneFor(run);
    new LordArrivalOverlay(scene, run, gameData).show(vi.fn());
    const first = shown();
    scene.saves.length = 0;

    globalThis.__menu.options.reroll(); // the Reroll button
    const second = shown();
    expect(second).not.toEqual(first);
    expect(globalThis.__menu.options.reroll).toBeNull(); // only one reroll
    // The save that holds the new cards also holds the spent reroll.
    expect(scene.saves).toHaveLength(1);
    expect(scene.saves[0].thirdLordRerolled).toBe(true);
    expect(scene.saves[0].pendingThirdLord.rerolled).toBe(true);
    expect(scene.saves[0].pendingThirdLord.candidates.map((c) => c.unit.name)).toEqual(second);

    // A reload now shows those cards, with no reroll left and nothing new to save.
    const resumed = loadRun(gameData, 1);
    const reloaded = sceneFor(resumed);
    new LordArrivalOverlay(reloaded, resumed, gameData).show(vi.fn());
    expect(shown()).toEqual(second);
    expect(globalThis.__menu.options.reroll).toBeNull();
    expect(reloaded.saves).toHaveLength(0);
  });

  it('reloading cannot fish: however often it is reopened, only the two hands ever show', () => {
    const run = thirdBattleRun();
    new LordArrivalOverlay(sceneFor(run), run, gameData).show(vi.fn());
    const seen = new Set([shown().join()]);
    globalThis.__menu.options.reroll();
    seen.add(shown().join());
    for (let i = 0; i < 4; i++) {
      const resumed = loadRun(gameData, 1);
      new LordArrivalOverlay(sceneFor(resumed), resumed, gameData).show(vi.fn());
      expect(globalThis.__menu.options.reroll).toBeNull();
      seen.add(shown().join());
    }
    expect(seen.size).toBe(2);
  });
});

describe('resuming the arrival from the route map', () => {
  it('re-offers the saved cards, then joins the pick, clears the draft and saves', () => {
    const run = thirdBattleRun();
    prepareThirdLord(run, gameData);
    const offered = names(run.pendingThirdLord);
    saveServiceRun(sceneFor(run));

    const resumed = loadRun(gameData, 1);
    const scene = sceneFor(resumed);
    const done = vi.fn();
    resumeLordArrival(scene, done);
    expect(shown()).toEqual(offered);
    expect(scene.saves).toHaveLength(0);

    const pick = globalThis.__menu.candidates[2].unit;
    globalThis.__menu.resolve(pick);
    expect(done).toHaveBeenCalledTimes(1);
    const saved = JSON.parse(localStorage.getItem('emblem_rogue_slot_1_run'));
    expect(saved.pendingThirdLord).toBeNull();
    expect(saved.thirdLordJoined).toBe(true);
    expect(saved.roster.map((u) => u.name)).toContain(pick.name);
    expect(saved.pendingBattleReward).toBeTruthy(); // the rewards come next
    expect(scene.meta.recordLordsMet).toHaveBeenCalledWith(expect.arrayContaining([pick.name]));
  });

  it('a skipped arrival is cleared and saved, and the rewards follow', () => {
    const run = thirdBattleRun('pick3');
    prepareThirdLord(run, gameData);
    saveServiceRun(sceneFor(run));
    const resumed = loadRun(gameData, 1);
    const done = vi.fn();
    resumeLordArrival(sceneFor(resumed), done);
    globalThis.__menu.resolve(null);
    const saved = JSON.parse(localStorage.getItem('emblem_rogue_slot_1_run'));
    expect(saved.pendingThirdLord).toBeNull();
    expect(saved.thirdLordJoined).toBe(true);
    expect(done).toHaveBeenCalledTimes(1);
  });
});
