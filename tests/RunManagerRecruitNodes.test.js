// RunManager × recruit nodes (docs/specs/strategy-layer.md): every recruit node knows
// who waits there, legacy saves get their previews on load, locked encounters keep
// the recruit their battle rolled, battle params carry the preview and the elite-like
// modifiers, and the harness spawns exactly the unit the Loom shows.
import { describe, expect, it, vi } from 'vitest';
import { RunManager } from '../src/engine/RunManager.js';
import { GameDriver } from './harness/GameDriver.js';
import { installSeed, restoreMathRandom } from '../sim/lib/SeededRNG.js';
import { loadGameData } from './testData.js';

const data = loadGameData();

function freshRun(seed = 4242, difficultyId = 'normal') {
  const rm = new RunManager(data);
  rm.startRun({ runSeed: seed, difficultyId, applyBlessingsAtStart: false });
  return rm;
}

function recruitNodes(rm) {
  return rm.nodeMap.nodes.filter((n) => n.type === 'recruit');
}

function stripUids(value) {
  return JSON.parse(JSON.stringify(value, (key, v) => (key === 'uid' ? undefined : v)));
}

describe('recruit previews on the run map', () => {
  it('every recruit node gets a preview at run start and after each act advance', () => {
    const rm = freshRun(11);
    expect(recruitNodes(rm).length).toBeGreaterThan(0);
    for (const node of recruitNodes(rm)) expect(node.recruitPreview?.name).toBeTruthy();
    rm.advanceAct();
    expect(rm.currentAct).toBe('act2');
    const pool = data.recruits.act2.classPool;
    for (const node of recruitNodes(rm)) {
      if (node.eclipse) continue;
      expect(pool).toContain(node.recruitPreview.className);
    }
  });

  it('is part of the run seed: the same seed gives the same recruits', () => {
    const a = freshRun(77);
    const b = freshRun(77);
    expect(recruitNodes(a).map((n) => n.recruitPreview)).toEqual(
      recruitNodes(b).map((n) => n.recruitPreview),
    );
  });

  it('fills previews into a legacy save on load, and a save round trip is stable', () => {
    const rm = freshRun(5);
    const expected = recruitNodes(rm).map((n) => n.recruitPreview);
    const saved = JSON.parse(JSON.stringify(rm.toJSON()));
    for (const node of saved.nodeMap.nodes) delete node.recruitPreview;
    const loaded = RunManager.fromJSON(saved, data);
    expect(recruitNodes(loaded).map((n) => n.recruitPreview)).toEqual(expected);
    const again = RunManager.fromJSON(JSON.parse(JSON.stringify(loaded.toJSON())), data);
    expect(JSON.stringify(again.toJSON().nodeMap)).toBe(JSON.stringify(loaded.toJSON().nodeMap));
  });

  it('a locked encounter keeps the recruit its battle already rolled', () => {
    const rm = freshRun(5);
    const node = recruitNodes(rm)[0];
    rm.battleConfigsByNodeId[node.id] = {
      npcSpawn: { className: 'Myrmidon', name: 'Kenji', col: 3, row: 2, level: 3 },
    };
    const loaded = RunManager.fromJSON(JSON.parse(JSON.stringify(rm.toJSON())), data);
    const again = loaded.nodeMap.nodes.find((n) => n.id === node.id);
    expect(again.recruitPreview).toMatchObject({ className: 'Myrmidon', name: 'Kenji' });
  });
});

describe('recruit battle params', () => {
  it('carry the preview, one more hunter and an affixed captain (normal)', () => {
    const rm = freshRun(21);
    const node = recruitNodes(rm)[0];
    const params = rm.getBattleParams(node);
    expect(params.recruitPreview).toEqual({
      className: node.recruitPreview.className,
      name: node.recruitPreview.name,
    });
    expect(params.recruitEnemyCountBonus).toBe(1);
    expect(params.eclipseAffix.guaranteedCount).toBeGreaterThanOrEqual(1);
    expect(rm.getRecruitNodeBattleMods(node)).toEqual({ enemyCountBonus: 1, affixCount: 1 });
  });

  it('hard and lunatic send two extra hunters', () => {
    for (const id of ['hard', 'lunatic']) {
      const rm = freshRun(21, id);
      const node = recruitNodes(rm)[0];
      expect(rm.getBattleParams(node).recruitEnemyCountBonus).toBe(2);
    }
  });

  it('plain battles are untouched', () => {
    const rm = freshRun(21);
    const battle = rm.nodeMap.nodes.find((n) => n.type === 'battle' && !n.battleParams?.isElite);
    const params = rm.getBattleParams(battle);
    expect(params.recruitPreview).toBeUndefined();
    expect(params.eclipseAffix).toBeUndefined();
    expect(rm.getRecruitNodeBattleMods(battle)).toEqual({ enemyCountBonus: 0, affixCount: 0 });
  });

  it('legacy runs keep their saved difficulty values (no surprise hunters mid-run)', () => {
    const rm = freshRun(21);
    const saved = JSON.parse(JSON.stringify(rm.toJSON()));
    saved.difficultyModifiers.recruitEnemyCountBonus = 0;
    delete saved.difficultyModifiers.recruitAffixCount;
    const loaded = RunManager.fromJSON(saved, data);
    const node = recruitNodes(loaded)[0];
    expect(loaded.getRecruitNodeBattleMods(node)).toEqual({ enemyCountBonus: 0, affixCount: 0 });
    expect(loaded.getBattleParams(node).eclipseAffix).toBeUndefined();
  });
});

describe('the recruit you see is the recruit you get', () => {
  it('getRecruitNodeUnit is deterministic and never consumes Math.random', () => {
    const rm = freshRun(33);
    const node = recruitNodes(rm)[0];
    const spy = vi.spyOn(Math, 'random');
    const a = rm.getRecruitNodeUnit(node);
    const b = rm.getRecruitNodeUnit(node);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    expect(stripUids(a)).toEqual(stripUids(b));
  });

  it('follows the roster: a stronger squad meets a higher-level recruit', () => {
    const rm = freshRun(33);
    const node = recruitNodes(rm)[0];
    const before = rm.getRecruitNodeUnit(node).level;
    for (const unit of rm.roster) unit.level += 3;
    expect(rm.getRecruitNodeUnit(node).level).toBe(before + 3);
  });

  it('the headless battle spawns the unit the Loom previews', async () => {
    for (const seed of [3, 8, 13]) {
      const rm = freshRun(seed);
      const node = recruitNodes(rm)[0];
      const preview = rm.getRecruitNodeUnit(node);
      const params = rm.getBattleParams(node);
      const ctx = rm.getRecruitBattleContext(node);
      Object.assign(params, {
        metaEffects: rm.getEffectiveMetaEffects(),
        fallenUnits: rm.fallenUnits,
        recruitNodeId: ctx.nodeId,
        recruitRunSeed: ctx.runSeed,
        recruitRoster: structuredClone(ctx.roster),
        startingLordNames: ctx.startingLordNames,
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
      expect(npc.level).toBe(preview.unit.level);
      expect(npc.stats).toEqual(preview.unit.stats);
      expect(npc.traits).toEqual(preview.unit.traits);
    }
  });
});
