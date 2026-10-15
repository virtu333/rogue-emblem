// Recruit nodes in one act never preview the same lord: a node that rolls a lord leaves
// the lords earlier pending recruit nodes (row, then column) already show to them. The
// lord roll itself (lord or not) is untouched, a claim is released when its node is
// done, and the harness spawns the lord the Loom shows.
import { describe, expect, it } from 'vitest';
import { RunManager } from '../src/engine/RunManager.js';
import { buildRecruitNodeUnit } from '../src/engine/RecruitNodeSystem.js';
import { GameDriver } from './harness/GameDriver.js';
import { installSeed, restoreMathRandom } from '../sim/lib/SeededRNG.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const SEEDS = Array.from({ length: 60 }, (_, i) => i + 1);

// lordRecruitChanceBonus 1 makes every recruit node a lord node (chance clamps to 1).
function run(seed, lordRecruitChanceBonus = 1) {
  const rm = new RunManager(data);
  rm.startRun({ runSeed: seed, difficultyId: 'normal', applyBlessingsAtStart: false });
  rm.metaEffects = { ...(rm.metaEffects || {}), lordRecruitChanceBonus };
  return rm;
}

function recruitNodes(rm) {
  return rm.nodeMap.nodes
    .filter((n) => n.type === 'recruit')
    .sort((a, b) => a.row - b.row || a.col - b.col);
}

function lordOf(rm, node) {
  const built = rm.getRecruitNodeUnit(node);
  return built?.isLord ? built.unit.name : null;
}

describe('recruit lord claims', () => {
  it('no two pending recruit nodes of an act preview the same lord', () => {
    let lordNodes = 0;
    for (const seed of SEEDS) {
      const rm = run(seed);
      // The flat odds (a run from before lord odds v2), so every node holds a lord.
      rm.lordRecruitOdds = null;
      const lords = recruitNodes(rm).map((n) => lordOf(rm, n));
      expect(lords.every(Boolean)).toBe(true);
      lordNodes += lords.length;
      expect(new Set(lords).size).toBe(lords.length);
    }
    expect(lordNodes).toBeGreaterThan(SEEDS.length * 2 - 1);
  });

  it('under lord odds v2 the lord nodes still never preview the same lord', () => {
    let lordNodes = 0;
    for (const seed of SEEDS) {
      const rm = run(seed);
      const lords = recruitNodes(rm)
        .map((n) => lordOf(rm, n))
        .filter(Boolean);
      lordNodes += lords.length;
      expect(new Set(lords).size).toBe(lords.length);
    }
    expect(lordNodes).toBeGreaterThan(SEEDS.length * 2 - 1);
  });

  it('keeps which nodes roll a lord: the roll is the unclaimed one', () => {
    for (const seed of SEEDS) {
      const rm = run(seed, 0.24);
      for (const node of recruitNodes(rm)) {
        const unclaimed = buildRecruitNodeUnit({
          preview: node.recruitPreview,
          gameData: data,
          ...rm.getRecruitBattleContext(node),
          claimedLordNames: [],
        });
        expect(rm.getRecruitNodeUnit(node).isLord).toBe(unclaimed.isLord);
      }
    }
  });

  it('a later node keeps its lord when an earlier node is recruited, and a node left behind claims nothing', () => {
    let checked = 0;
    for (const seed of SEEDS) {
      const rm = run(seed);
      const [first, ...rest] = recruitNodes(rm);
      const later = rest.map((n) => lordOf(rm, n));
      const firstLord = rm.getRecruitNodeUnit(first).unit;

      // Recruited: the first node's lord joins and its node is done.
      const recruited = run(seed);
      const recruitedFirst = recruitNodes(recruited)[0];
      recruited.roster.push(structuredClone(firstLord));
      recruited.markNodeComplete(recruitedFirst.id);
      expect(
        recruitNodes(recruited)
          .slice(1)
          .map((n) => lordOf(recruited, n)),
      ).toEqual(later);

      // Left behind: the node is done without him, so it claims nothing; only the
      // nodes still pending claim, and they still show different lords.
      const left = run(seed);
      left.markNodeComplete(recruitNodes(left)[0].id);
      const pending = recruitNodes(left).slice(1);
      const pendingLords = pending.map((n) => lordOf(left, n));
      expect(left.getClaimedRecruitLordNames(pending.at(-1))).toEqual(pendingLords.slice(0, -1));
      expect(new Set(pendingLords).size).toBe(pendingLords.length);
      checked++;
    }
    expect(checked).toBe(SEEDS.length);
  });

  it('falls back to every free lord when the others are all claimed', () => {
    const rm = run(3);
    const node = recruitNodes(rm)[0];
    const ctx = rm.getRecruitBattleContext(node);
    const built = buildRecruitNodeUnit({
      preview: node.recruitPreview,
      gameData: data,
      ...ctx,
      claimedLordNames: data.lords.map((l) => l.name),
    });
    expect(built.isLord).toBe(true);
  });

  it('the headless battle spawns the lord a later node previews', () => {
    for (const seed of [3, 8, 13]) {
      const rm = run(seed);
      const node = recruitNodes(rm).at(-1);
      const preview = rm.getRecruitNodeUnit(node);
      const ctx = rm.getRecruitBattleContext(node);
      expect(ctx.claimedLordNames.length).toBeGreaterThan(0);
      const params = rm.getBattleParams(node);
      Object.assign(params, {
        metaEffects: rm.getEffectiveMetaEffects(),
        fallenUnits: rm.fallenUnits,
        recruitNodeId: ctx.nodeId,
        recruitRunSeed: ctx.runSeed,
        recruitRoster: structuredClone(ctx.roster),
        startingLordNames: ctx.startingLordNames,
        recruitClaimedLords: ctx.claimedLordNames,
        recruitLordOdds: ctx.lordOdds,
        recruitLevelBonus: ctx.recruitLevelBonus,
        deployBonus: ctx.deployBonus,
        deployCount: rm.roster.length,
      });
      installSeed(params.battleSeed);
      let npc;
      try {
        const driver = new GameDriver(data, params, rm.getRoster());
        driver.init();
        npc = driver.battle.npcUnits[0];
      } finally {
        restoreMathRandom();
      }
      expect(npc.name).toBe(preview.unit.name);
      expect(npc.className).toBe(preview.unit.className);
    }
  });
});
