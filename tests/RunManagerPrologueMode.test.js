// RunManager in prologue mode (docs/specs/prologue-chapter.md §9): startPrologue builds
// the first thread (authored roster, literal route, every chapter pre-locked, no Vision,
// Eclipse off), the mode and the route survive the run save (a refresh mid-chapter
// resumes it), a save from before the prologue is standard, the authored joins commit
// with a chapter's victory (once), the last chapter completes the prologue without a
// Vision grant, and the prologue's restart reverts to the chapter's entry even past a
// fatal checkpoint while the standard run's guard stays as it was.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RunManager, saveRun, loadRun, clearSavedRun } from '../src/engine/RunManager.js';
import { isPrologueRun, PROLOGUE_RUN_MODE } from '../src/engine/ScriptedBattle.js';
import { buildPrologueBattleConfig } from '../src/engine/Prologue.js';
import { loadGameData } from './testData.js';

const store = {};
const localStorageMock = {
  getItem: vi.fn((key) => (Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null)),
  setItem: vi.fn((key, val) => {
    store[key] = String(val);
  }),
  removeItem: vi.fn((key) => {
    delete store[key];
  }),
};
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true });

const data = loadGameData();
const prologue = () => {
  const rm = new RunManager(data, null);
  rm.startPrologue(data, data.prologue);
  return rm;
};
const nodeOf = (rm, id) => rm.nodeMap.nodes.find((n) => n.id === id);

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
});

describe('startPrologue', () => {
  it('builds the first thread: Edric alone, no gold, no Vision, the Eclipse off, Normal', () => {
    const rm = prologue();
    expect(rm.mode).toBe(PROLOGUE_RUN_MODE);
    expect(isPrologueRun(rm)).toBe(true);
    expect(rm.roster.map((u) => u.name)).toEqual(['Edric']);
    expect(rm.roster[0].isCommander).toBe(true);
    expect(rm.gold).toBe(0);
    expect(rm.visionChargesRemaining).toBe(0);
    expect(rm.isEclipseActive()).toBe(false);
    expect(rm.difficultyId).toBe('normal');
    expect(rm.actSequence).toEqual(['act1']);
    expect(rm.runSeed).toBe(data.prologue.seed);
    expect(rm.activeBlessings).toEqual([]);
    expect(rm._blessingChosen).toBe(true);
  });

  it('lays the literal route with every chapter pre-locked on its node', () => {
    const rm = prologue();
    const route = data.prologue.route;
    expect(rm.nodeMap.nodes.map((n) => n.id)).toEqual(route.nodes.map((n) => n.id));
    expect(rm.nodeMap.startNodeId).toBe('prologue_0');
    expect(rm.nodeMap.bossNodeId).toBe('prologue_1');
    expect(rm.getAvailableNodes().map((n) => n.id)).toEqual(['prologue_0']);
    for (const node of route.nodes) {
      const chapter = data.prologue.chapters.find((c) => c.id === node.chapter);
      expect(rm.getLockedBattleConfig(node.id)).toEqual(
        buildPrologueBattleConfig(chapter, data.terrain),
      );
      expect(rm.getPrologueChapter(node.id)).toBe(chapter);
    }
    const params = rm.getBattleParams(nodeOf(rm, 'prologue_0'));
    expect(params).toMatchObject({ prologueChapter: 'p1_banner_at_dawn', act: 'act1' });
    expect(Number.isInteger(params.battleSeed)).toBe(true);
  });
});

describe('the run save', () => {
  it('round-trips the mode, the route, the locks and a suspended chapter', () => {
    const rm = prologue();
    const node = nodeOf(rm, 'prologue_0');
    rm.beginBattleInProgress(node.id, { battleParams: rm.getBattleParams(node) });
    rm.setBattleCheckpoint({ recoveryKind: 'suspend', turn: 2 });
    expect(saveRun(rm, null, 1).ok).toBe(true);
    const loaded = loadRun(data, 1);
    expect(loaded.mode).toBe(PROLOGUE_RUN_MODE);
    expect(isPrologueRun(loaded)).toBe(true);
    expect(loaded.battleInProgress.nodeId).toBe('prologue_0');
    expect(loaded.battleInProgress.checkpoint).toEqual({ recoveryKind: 'suspend', turn: 2 });
    expect(loaded.getActivePrologueChapter()?.id).toBe('p1_banner_at_dawn');
    expect(loaded.getLockedBattleConfig('prologue_1')).toEqual(
      rm.getLockedBattleConfig('prologue_1'),
    );
    expect(loaded.nodeMap.nodes.map((n) => n.battleParams.prologueChapter)).toEqual([
      'p1_banner_at_dawn',
      'p2_old_hands',
    ]);
    expect(loaded.visionChargesRemaining).toBe(0);
    expect(loaded.isEclipseActive()).toBe(false);
    expect(loaded.roster.map((u) => u.name)).toEqual(['Edric']);
  });

  it('a save from before the prologue, and a standard run, are standard', () => {
    const rm = new RunManager(data, null);
    rm.startRun({ difficultyId: 'normal' });
    const json = rm.toJSON();
    expect(json.mode).toBe('standard');
    delete json.mode;
    const old = RunManager.fromJSON(json, data);
    expect(old.mode).toBe('standard');
    expect(isPrologueRun(old)).toBe(false);
    expect(RunManager.fromJSON({ ...json, mode: 'bogus' }, data).mode).toBe('standard');
  });
});

describe('the chapters commit', () => {
  it("P1's victory brings Gaspar in once, with the same save, and no Vision", () => {
    const rm = prologue();
    const node = nodeOf(rm, 'prologue_0');
    rm.beginBattleInProgress(node.id, { battleParams: rm.getBattleParams(node) });
    rm.battleInProgress = null;
    expect(rm.completeBattle(rm.roster, node.id, 25)).toBe(true);
    expect(rm.roster.map((u) => u.name)).toEqual(['Edric', 'Gaspar']);
    const gaspar = rm.roster[1];
    expect(gaspar.specialCharId).toBe('old_knight');
    expect(gaspar.className).toBe('Paladin');
    expect(gaspar.unitUid).toMatch(/^ru\d+$/);
    expect(rm.visionChargesRemaining).toBe(0);
    expect(rm.getAvailableNodes().map((n) => n.id)).toEqual(['prologue_1']);
    expect(rm.isPrologueComplete()).toBe(false);
    // The join is idempotent (a second application never duplicates him).
    rm._applyPrologueJoins(node);
    expect(rm.roster.map((u) => u.name)).toEqual(['Edric', 'Gaspar']);
  });

  it("P2's victory completes the prologue; the run is never advanced or settled", () => {
    const rm = prologue();
    expect(rm.completeBattle(rm.roster, 'prologue_0', 0)).toBe(true);
    expect(rm.completeBattle(rm.roster, 'prologue_1', 0)).toBe(true);
    expect(rm.isPrologueComplete()).toBe(true);
    expect(rm.isActComplete()).toBe(true);
    expect(rm.visionChargesRemaining).toBe(0);
    expect(rm.pendingBossRecruit).toBeNull();
    expect(rm.pendingThirdLord).toBeNull();
    expect(rm.shouldTriggerThirdLord()).toBe(false);
    expect(rm.status).not.toBe('victory');
    expect(rm.endRunRewards ?? null).toBeNull();
  });

  it("grantPrologueVision adds P3's charge like any charge", () => {
    const rm = prologue();
    rm.grantPrologueVision();
    expect(rm.visionChargesRemaining).toBe(1);
    const loaded = RunManager.fromJSON(rm.toJSON(), data);
    expect(loaded.visionChargesRemaining).toBe(1);
  });
});

describe('the restart', () => {
  it('reverts gold, convoy and the flag from the entry snapshot even past a fatal checkpoint', () => {
    const rm = prologue();
    const node = nodeOf(rm, 'prologue_0');
    rm.convoy = [];
    rm.beginBattleInProgress(node.id, { battleParams: rm.getBattleParams(node) });
    rm.gold += 300;
    rm.convoy.push({ name: 'Iron Lance', uid: 'picked-up' });
    rm.rngSeed = 999;
    rm.setBattleCheckpoint({ recoveryKind: 'fatal_pending' });
    expect(rm.revertBattleInProgressToEntry()).toBe(false); // the standard guard
    expect(rm.battleInProgress).not.toBeNull();
    expect(rm.restartPrologueBattle()).toBe(true);
    expect(rm.battleInProgress).toBeNull();
    expect(rm.gold).toBe(0);
    expect(rm.convoy).toEqual([]);
    expect(rm.rngSeed).toBe(data.prologue.seed >>> 0);
    expect(rm.roster.map((u) => u.name)).toEqual(['Edric']);
  });

  it('is refused outside the prologue and without a battle in progress', () => {
    const standard = new RunManager(data, null);
    standard.startRun({ difficultyId: 'normal' });
    standard.beginBattleInProgress('n1', {});
    expect(standard.restartPrologueBattle()).toBe(false);
    expect(standard.battleInProgress).not.toBeNull();
    const rm = prologue();
    expect(rm.restartPrologueBattle()).toBe(false);
  });

  it('clearSavedRun after the ending leaves no run save behind', () => {
    const rm = prologue();
    expect(saveRun(rm, null, 1).ok).toBe(true);
    expect(loadRun(data, 1)).not.toBeNull();
    clearSavedRun(null, 1);
    expect(loadRun(data, 1)).toBeNull();
  });
});
