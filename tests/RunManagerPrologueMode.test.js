// RunManager in prologue mode (docs/specs/prologue-chapter.md §9): startPrologue builds
// the first thread (authored roster, literal route, every chapter pre-locked, no Vision,
// Eclipse off), the mode and the route survive the run save (a refresh mid-chapter
// resumes it), a save from before the prologue is standard, the authored joins commit
// with a chapter's victory (once), the last chapter completes the prologue without a
// Vision grant, and the prologue's restart reverts to the chapter's entry even past a
// fatal checkpoint while the standard run's guard stays as it was.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RunManager,
  saveRun,
  loadRun,
  clearSavedRun,
  clearBattleInProgressInSave,
} from '../src/engine/RunManager.js';
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
    // The last chapter on the route ends the prologue (P3 until P4 is authored).
    expect(rm.nodeMap.bossNodeId).toBe('prologue_3');
    expect(rm.getAvailableNodes().map((n) => n.id)).toEqual(['prologue_0']);
    for (const node of route.nodes) {
      const chapter = data.prologue.chapters.find((c) => c.id === node.chapter);
      if (!chapter) {
        // A service node (the row-2 fork): no battle, no chapter.
        expect(rm.getLockedBattleConfig(node.id) ?? null).toBeNull();
        expect(rm.getPrologueChapter(node.id)).toBeNull();
        continue;
      }
      expect(rm.getLockedBattleConfig(node.id)).toEqual(
        buildPrologueBattleConfig(chapter, data.terrain),
      );
      expect(rm.getPrologueChapter(node.id)).toBe(chapter);
    }
    // Row 2 forks into the Market and the Chapel; both lead to P3.
    expect(nodeOf(rm, 'prologue_1').edges).toEqual(['prologue_2a', 'prologue_2b']);
    expect([nodeOf(rm, 'prologue_2a').type, nodeOf(rm, 'prologue_2b').type]).toEqual([
      'shop',
      'church',
    ]);
    expect(nodeOf(rm, 'prologue_2a').edges).toEqual(['prologue_3']);
    expect(nodeOf(rm, 'prologue_2b').edges).toEqual(['prologue_3']);
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
    expect(loaded.nodeMap.nodes.map((n) => n.battleParams?.prologueChapter ?? null)).toEqual([
      'p1_banner_at_dawn',
      'p2_old_hands',
      null,
      null,
      'p3_seer_on_the_road',
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

  it("P3's victory completes the prologue; the run is never advanced or settled", () => {
    const rm = prologue();
    expect(rm.completeBattle(rm.roster, 'prologue_0', 0)).toBe(true);
    expect(rm.completeBattle(rm.roster, 'prologue_1', 0)).toBe(true);
    expect(rm.isPrologueComplete()).toBe(false);
    expect(rm.getAvailableNodes().map((n) => n.id)).toEqual(['prologue_2a', 'prologue_2b']);
    rm.currentNodeId = 'prologue_2b';
    rm.markNodeComplete('prologue_2b');
    expect(rm.getAvailableNodes().map((n) => n.id)).toEqual(['prologue_3']);
    expect(rm.completeBattle(rm.roster, 'prologue_3', 0)).toBe(true);
    expect(rm.isPrologueComplete()).toBe(true);
    expect(rm.isActComplete()).toBe(true);
    expect(rm.visionChargesRemaining).toBe(0);
    expect(rm.pendingBossRecruit).toBeNull();
    expect(rm.pendingThirdLord).toBeNull();
    expect(rm.shouldTriggerThirdLord()).toBe(false);
    expect(rm.status).not.toBe('victory');
    expect(rm.endRunRewards ?? null).toBeNull();
  });

  it("grantPrologueVision adds P3's charge once per run, saved with the run", () => {
    const rm = prologue();
    expect(rm.grantPrologueVision()).toBe(true);
    expect(rm.visionChargesRemaining).toBe(1);
    // A replayed beat (a resume, a re-shown note) never grants twice.
    expect(rm.grantPrologueVision()).toBe(false);
    expect(rm.visionChargesRemaining).toBe(1);
    const loaded = RunManager.fromJSON(rm.toJSON(), data);
    expect(loaded.visionChargesRemaining).toBe(1);
    expect(loaded.prologueVisionGranted).toBe(true);
    expect(loaded.grantPrologueVision()).toBe(false);
    // Spent, it stays spent: the grant is not a refill.
    loaded.visionChargesRemaining = 0;
    expect(loaded.grantPrologueVision()).toBe(false);
    expect(loaded.visionChargesRemaining).toBe(0);
  });

  it('a chapter restart or Continue from Map takes the grant back with the battle', () => {
    const rm = prologue();
    const node = nodeOf(rm, 'prologue_0');
    rm.beginBattleInProgress(node.id, { battleParams: rm.getBattleParams(node) });
    expect(rm.grantPrologueVision()).toBe(true);
    expect(rm.restartPrologueBattle()).toBe(true);
    expect(rm.visionChargesRemaining).toBe(0);
    expect(rm.prologueVisionGranted).toBe(false);
    // The restarted chapter can grant it again.
    rm.beginBattleInProgress(node.id, { battleParams: rm.getBattleParams(node) });
    expect(rm.grantPrologueVision()).toBe(true);
    rm.setBattleCheckpoint({ recoveryKind: 'suspend' });
    expect(saveRun(rm, null, 1).ok).toBe(true);
    expect(clearBattleInProgressInSave(null, 1).ok).toBe(true);
    const reverted = loadRun(data, 1);
    expect(reverted.visionChargesRemaining).toBe(0);
    expect(reverted.prologueVisionGranted).toBe(false);
  });

  it('a standard run is never granted the prologue charge', () => {
    const rm = new RunManager(data, null);
    rm.startRun({ difficultyId: 'normal' });
    const before = rm.visionChargesRemaining;
    expect(rm.grantPrologueVision()).toBe(false);
    expect(rm.visionChargesRemaining).toBe(before);
  });
});

describe('arrival at the row-2 fork', () => {
  /** A prologue run that won P1 and P2, standing at a fork node. */
  function atFork(nodeId, { visitedVillage = true } = {}) {
    const rm = prologue();
    rm.completeBattle(rm.roster, 'prologue_0', 0);
    rm.completeBattle(rm.roster, 'prologue_1', 0);
    if (visitedVillage) rm.addToConvoy(data.weapons.find((w) => w.name === 'Iron Bow'));
    rm.currentNodeId = nodeId;
    return rm;
  }
  const bows = (rm) =>
    [...rm.convoy.weapons, ...rm.roster.flatMap((u) => u.inventory || [])].filter(
      (w) => w.name === 'Iron Bow',
    ).length;

  for (const nodeId of ['prologue_2a', 'prologue_2b']) {
    it(`Tamsin joins on arrival at ${nodeId}, unarmed, with the convoy's bow named`, () => {
      const rm = atFork(nodeId);
      const result = rm.arriveAtPrologueNode(nodeId);
      expect(result).toEqual({ joined: [{ name: 'Tamsin', line: 'tamsin_joins' }], granted: [] });
      const tamsin = rm.roster.find((u) => u.name === 'Tamsin');
      expect(tamsin.className).toBe('Archer');
      expect(tamsin.level).toBe(1);
      expect(tamsin.inventory).toEqual([]);
      expect(tamsin.weapon ?? null).toBeNull();
      expect(tamsin.unitUid).toMatch(/^ru\d+$/);
      expect(bows(rm)).toBe(1);
      // Arriving again (a reload at the node) joins and grants nothing.
      expect(rm.arriveAtPrologueNode(nodeId)).toEqual({ joined: [], granted: [] });
      expect(rm.roster.filter((u) => u.name === 'Tamsin')).toHaveLength(1);
      // The join is saved with the run.
      const loaded = RunManager.fromJSON(rm.toJSON(), data);
      expect(loaded.roster.map((u) => u.name)).toEqual(['Edric', 'Gaspar', 'Tamsin']);
    });
  }

  it("without P2's village bow the node grants one, and her line says so", () => {
    const rm = atFork('prologue_2a', { visitedVillage: false });
    expect(bows(rm)).toBe(0);
    const result = rm.arriveAtPrologueNode('prologue_2a');
    expect(result).toEqual({
      joined: [{ name: 'Tamsin', line: 'tamsin_joins_bow_rack' }],
      granted: ['Iron Bow'],
    });
    expect(bows(rm)).toBe(1);
    expect(rm.convoy.weapons.at(-1).name).toBe('Iron Bow');
    expect(rm.arriveAtPrologueNode('prologue_2a').granted).toEqual([]);
    expect(bows(rm)).toBe(1);
  });

  it('a bow someone already carries counts: no second bow', () => {
    const rm = atFork('prologue_2b', { visitedVillage: false });
    const bow = structuredClone(data.weapons.find((w) => w.name === 'Iron Bow'));
    rm.roster[1].inventory.push(bow);
    expect(rm.arriveAtPrologueNode('prologue_2b').granted).toEqual([]);
    expect(bows(rm)).toBe(1);
  });

  it('a chapter node or a standard run brings nobody', () => {
    const rm = atFork('prologue_1');
    expect(rm.arriveAtPrologueNode('prologue_1')).toEqual({ joined: [], granted: [] });
    const standard = new RunManager(data, null);
    standard.startRun({ difficultyId: 'normal' });
    expect(standard.arriveAtPrologueNode('prologue_2a')).toEqual({ joined: [], granted: [] });
  });
});

describe('failRun', () => {
  it('is refused in the prologue: nothing is settled, counted or cleared', () => {
    const rm = prologue();
    const node = nodeOf(rm, 'prologue_0');
    rm.beginBattleInProgress(node.id, { battleParams: rm.getBattleParams(node) });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(rm.failRun({ defeatedBy: 'Fighter' })).toBe(false);
    warn.mockRestore();
    expect(rm.status).toBe('active');
    expect(rm.battleInProgress).not.toBeNull();
    expect(rm.defeatContext ?? null).toBeNull();
  });
});

describe('the restart', () => {
  it('reverts gold, convoy, Vision and the flag from the entry snapshot even past a fatal checkpoint', () => {
    const rm = prologue();
    rm.completeBattle(rm.roster, 'prologue_0', 0);
    const node = nodeOf(rm, 'prologue_1');
    const lance = structuredClone(data.weapons.find((w) => w.name === 'Iron Lance'));
    rm.addToConvoy(lance);
    rm.gold = 120;
    const entry = {
      convoy: structuredClone(rm.convoy),
      gold: rm.gold,
      roster: structuredClone(rm.roster),
      rngSeed: rm.rngSeed,
    };
    rm.beginBattleInProgress(node.id, { battleParams: rm.getBattleParams(node) });
    // Mid-battle: gold picked up, a village item, the convoy emptied, a reseed.
    rm.gold += 300;
    rm.convoy.weapons.length = 0;
    rm.convoy.consumables.push({ name: 'Vulnerary', uid: 'picked-up', type: 'Consumable' });
    rm.rngSeed = 999;
    rm.visionChargesRemaining = 2;
    rm.setBattleCheckpoint({ recoveryKind: 'fatal_pending' });
    expect(rm.revertBattleInProgressToEntry()).toBe(false); // the standard guard
    expect(rm.battleInProgress).not.toBeNull();
    expect(rm.restartPrologueBattle()).toBe(true);
    expect(rm.battleInProgress).toBeNull();
    expect(rm.gold).toBe(entry.gold);
    expect(rm.convoy).toEqual(entry.convoy);
    expect(rm.convoy.weapons.map((w) => w.name)).toEqual(['Iron Lance']);
    expect(rm.rngSeed).toBe(entry.rngSeed);
    expect(rm.visionChargesRemaining).toBe(0);
    // The roster is never written mid-battle: it re-enters exactly as it entered.
    expect(rm.roster).toEqual(entry.roster);
    expect(rm.roster.map((u) => u.name)).toEqual(['Edric', 'Gaspar']);
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
