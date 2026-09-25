import { describe, expect, it } from 'vitest';
import { RunManager } from '../src/engine/RunManager.js';
import { generateNodeMap } from '../src/engine/NodeMapGenerator.js';
import { getLatePressureState, formatParTooltip } from '../src/engine/TurnBonusCalculator.js';
import { churchKindleBlock, kindleAtChurch } from '../src/engine/ChurchCommands.js';
import { loadGameData } from './testData.js';

const data = loadGameData();

function freshRun(seed = 4242, difficultyId = 'normal', gameData = data) {
  const rm = new RunManager(gameData);
  rm.startRun({ runSeed: seed, difficultyId, applyBlessingsAtStart: false });
  return rm;
}

function winNext(rm, { turnCount, turnPar }, pick = (nodes) => nodes[0]) {
  const node = pick(rm.getAvailableNodes());
  expect(rm.completeBattle(rm.getRoster(), node.id, 0, { turnCount, turnPar })).toBe(true);
  return node;
}

function bossPathTo(rm) {
  // Walk to the boss: complete every node on a route (service nodes via markNodeComplete).
  for (let guard = 0; guard < 40 && !rm.isActComplete(); guard++) {
    const node = rm.getAvailableNodes()[0];
    if (['battle', 'boss', 'recruit'].includes(node.type))
      rm.completeBattle(rm.getRoster(), node.id, 0, { turnCount: 1, turnPar: 9 });
    else rm.markNodeComplete(node.id);
  }
}

describe('RunManager · Eclipse commit', () => {
  it('starts every run at shadow 0, enabled; tutorial runs are off', () => {
    const rm = freshRun();
    expect(rm.eclipse).toEqual({
      version: 1,
      shadow: 0,
      actStartShadow: 0,
      enabled: true,
      kindledNodeIds: [],
    });
    expect(rm.isEclipseActive()).toBe(true);
    const tutorial = new RunManager(data);
    tutorial.startRun({ runSeed: 1, tutorialMode: true, applyBlessingsAtStart: false });
    expect(tutorial.eclipse.enabled).toBe(false);
    expect(tutorial.isEclipseActive()).toBe(false);
    expect(tutorial.projectShadowGain(20, 5)).toBe(0);
  });

  it('adds the battle gain at victory and records the commit', () => {
    const rm = freshRun();
    const node = winNext(rm, { turnCount: 9, turnPar: 8 });
    expect(rm.eclipse.shadow).toBe(4);
    expect(rm.lastEclipseCommit).toMatchObject({ nodeId: node.id, before: 0, gain: 4, relief: 0 });
    expect(rm.projectShadowGain(9, 8)).toBe(4);
  });

  it('adds nothing for an S-rank clear and noParGain without a par', () => {
    const rm = freshRun();
    winNext(rm, { turnCount: 5, turnPar: 8 });
    expect(rm.eclipse.shadow).toBe(0);
    winNext(rm, { turnCount: 5, turnPar: null });
    expect(rm.eclipse.shadow).toBe(data.eclipse.noParGain);
  });

  it('adds nothing when a caller omits the turn count (legacy callers)', () => {
    const rm = freshRun();
    const node = rm.getAvailableNodes()[0];
    rm.completeBattle(rm.getRoster(), node.id, 0);
    expect(rm.eclipse.shadow).toBe(0);
  });

  it('lifts bossRelief when the act boss falls, floored at 0', () => {
    const rm = freshRun();
    rm.eclipse = { ...rm.eclipse, shadow: 2 };
    bossPathTo(rm);
    expect(rm.isActComplete()).toBe(true);
    expect(rm.eclipse.shadow).toBe(0);
    const rm2 = freshRun();
    rm2.eclipse = { ...rm2.eclipse, shadow: 40 };
    bossPathTo(rm2);
    expect(rm2.eclipse.shadow).toBe(40 - data.eclipse.bossRelief);
    expect(rm2.lastEclipseCommit.relief).toBe(data.eclipse.bossRelief);
  });

  it('caps shadow at the data cap', () => {
    const rm = freshRun();
    rm.eclipse = { ...rm.eclipse, shadow: 98 };
    winNext(rm, { turnCount: 30, turnPar: 5 });
    expect(rm.eclipse.shadow).toBe(100);
  });

  it('does nothing when the Eclipse is disabled or has no data', () => {
    const off = freshRun();
    off.eclipse = { ...off.eclipse, enabled: false };
    winNext(off, { turnCount: 30, turnPar: 5 });
    expect(off.eclipse.shadow).toBe(0);
    const { eclipse: _drop, ...noEclipse } = data;
    const bare = freshRun(4242, 'normal', noEclipse);
    winNext(bare, { turnCount: 30, turnPar: 5 });
    expect(bare.eclipse.shadow).toBe(0);
    expect(bare.lastEclipseCommit).toBeNull();
  });
});

describe('RunManager · the dark takes the map', () => {
  it('lets nodes fall at the victory commit, never the completed or current node', () => {
    const rm = freshRun(99);
    rm.eclipse = { ...rm.eclipse, shadow: 30, actStartShadow: 0 };
    const node = winNext(rm, { turnCount: 1, turnPar: 9 });
    const fell = rm.lastEclipseCommit.fell;
    expect(fell.length).toBeGreaterThan(0);
    expect(fell).not.toContain(node.id);
    const byId = new Map(rm.nodeMap.nodes.map((n) => [n.id, n]));
    for (const id of fell) {
      expect(byId.get(id).eclipse.seen).toBe(false);
      expect(byId.get(id).type).toBe('battle');
    }
    expect(byId.get(rm.nodeMap.startNodeId).eclipse).toBeUndefined();
  });

  it('keeps every edge and the boss reachable after any falls', () => {
    for (const seed of [1, 2, 3, 17, 88]) {
      const rm = freshRun(seed);
      const edges = JSON.stringify(rm.nodeMap.nodes.map((n) => [n.id, n.edges]));
      rm.eclipse = { ...rm.eclipse, shadow: 100, actStartShadow: 0 };
      rm.applyEclipseNow();
      expect(JSON.stringify(rm.nodeMap.nodes.map((n) => [n.id, n.edges]))).toBe(edges);
      const byId = new Map(rm.nodeMap.nodes.map((n) => [n.id, n]));
      const seen = new Set();
      const stack = [rm.nodeMap.startNodeId];
      while (stack.length) {
        const id = stack.pop();
        if (seen.has(id)) continue;
        seen.add(id);
        stack.push(...byId.get(id).edges);
      }
      expect(seen.has(rm.nodeMap.bossNodeId)).toBe(true);
      expect(byId.get(rm.nodeMap.bossNodeId).type).toBe('boss');
      for (const n of rm.nodeMap.nodes.filter((x) => x.type === 'ruins'))
        expect(n.eclipse).toBeUndefined();
      // Every node is still enterable as a battle, service or the boss.
      for (const n of rm.nodeMap.nodes)
        if (n.type === 'battle') expect(rm.getBattleParams(n)).toBeTruthy();
    }
  });

  it('advanceAct opens a fresh land: act shadow restarts from the carried shadow', () => {
    const rm = freshRun(5);
    rm.eclipse = { ...rm.eclipse, shadow: 37 };
    bossPathTo(rm);
    const carried = rm.eclipse.shadow;
    rm.advanceAct();
    expect(rm.eclipse.actStartShadow).toBe(carried);
    expect(rm.nodeMap.nodes.some((n) => n.eclipse)).toBe(false);
  });

  it('never perturbs node-map generation for a seed', () => {
    const { eclipse: _drop, ...noEclipse } = data;
    for (const seed of [11, 12, 13]) {
      const withEclipse = freshRun(seed);
      const without = freshRun(seed, 'normal', noEclipse);
      expect(JSON.stringify(withEclipse.nodeMap)).toBe(JSON.stringify(without.nodeMap));
      bossPathTo(withEclipse);
      bossPathTo(without);
      withEclipse.advanceAct();
      without.advanceAct();
      // Shadow 0 (fast clears) → no falls: the act-2 maps match exactly.
      expect(JSON.stringify(withEclipse.nodeMap)).toBe(JSON.stringify(without.nodeMap));
    }
  });

  it('matches a direct seeded generateNodeMap call', () => {
    const rm = freshRun(77);
    const direct = rm._withNodeMapSeed(() =>
      generateNodeMap(rm.currentAct, rm.currentActConfig, data.mapTemplates, {
        fogChanceBonus: rm.getDifficultyModifier('fogChanceBonus', 0),
        halfFogChance: true,
        villageAmbushChance: rm.getDifficultyModifier('villageAmbushChance', 0),
        colosseumConfig: data.colosseum?.nodeGeneration ?? null,
        caravanChanceBonus: 0,
      }),
    );
    // Recruit previews are added after generation on their own seeded stream
    // (RecruitNodeSystem); everything the generator produced is unchanged.
    const withoutPreviews = structuredClone(rm.nodeMap);
    for (const node of withoutPreviews.nodes) delete node.recruitPreview;
    expect(JSON.stringify(withoutPreviews)).toBe(JSON.stringify(direct));
    expect(
      rm.nodeMap.nodes.filter((n) => n.type === 'recruit').every((n) => n.recruitPreview),
    ).toBe(true);
  });
});

describe('RunManager · battle params', () => {
  it('adds no Eclipse keys in Pale on a whole node', () => {
    const rm = freshRun();
    const node = rm.getAvailableNodes()[0];
    const params = rm.getBattleParams(node);
    expect(params).not.toHaveProperty('eclipsePhaseIndex');
    expect(params).not.toHaveProperty('eclipseAffix');
    expect(params.enemyLevelBonus).toBe(0);
  });

  it('adds phase levels, affix overrides and eclipsed-node bonuses', () => {
    const rm = freshRun(99);
    rm.eclipse = { ...rm.eclipse, shadow: 60, actStartShadow: 0 };
    rm.applyEclipseNow();
    const start = rm.nodeMap.nodes.find((n) => n.id === rm.nodeMap.startNodeId);
    const params = rm.getBattleParams(start);
    expect(params.enemyLevelBonus).toBe(1);
    expect(params.eclipsePhaseIndex).toBe(2);
    expect(params.eclipseAffix).toMatchObject({ gatingDifficultyId: 'hard' });
    const eclipsed = rm.nodeMap.nodes.find((n) => n.eclipse);
    const ep = rm.getBattleParams(eclipsed);
    expect(ep.enemyLevelBonus).toBe(2);
    expect(ep.isElite).toBe(true);
    expect(ep.eclipseAffix).toMatchObject({ guaranteedCount: 2 });
    expect(rm.getEclipseLevelBonus(eclipsed)).toBe(2);
  });
});

describe('RunManager · save', () => {
  it('round-trips byte-identically', () => {
    const rm = freshRun(31);
    rm.eclipse = { ...rm.eclipse, shadow: 44, actStartShadow: 20, kindledNodeIds: ['x'] };
    rm.applyEclipseNow();
    rm.markEclipseSeen(
      rm.nodeMap.nodes
        .filter((n) => n.eclipse)
        .map((n) => n.id)
        .slice(0, 1),
    );
    // One load settles unrelated legacy repairs (recruit-name index); from then on a
    // save → load → save cycle is byte-identical, Eclipse state and falls included.
    const settled = JSON.stringify(
      RunManager.fromJSON(JSON.parse(JSON.stringify(rm.toJSON())), data).toJSON(),
    );
    const loaded = RunManager.fromJSON(JSON.parse(settled), data);
    expect(JSON.stringify(loaded.toJSON())).toBe(settled);
    expect(loaded.eclipse).toEqual(rm.eclipse);
    expect(JSON.stringify(loaded.nodeMap)).toBe(JSON.stringify(rm.nodeMap));
  });

  it('gives legacy saves a fresh, enabled clock without touching their map', () => {
    const rm = freshRun(32);
    const saved = JSON.parse(JSON.stringify(rm.toJSON()));
    delete saved.eclipse;
    const nodes = JSON.stringify(saved.nodeMap);
    const loaded = RunManager.fromJSON(saved, data);
    expect(loaded.eclipse).toEqual({
      version: 1,
      shadow: 0,
      actStartShadow: 0,
      enabled: true,
      kindledNodeIds: [],
    });
    expect(JSON.stringify(loaded.nodeMap)).toBe(nodes);
  });

  it('applies missing falls idempotently on load, sparing the battle in progress', () => {
    const rm = freshRun(33);
    const target = rm.nodeMap.nodes.find((n) => n.col === 0 && n.type !== 'ruins');
    rm.battleInProgress = { nodeId: target.id, checkpoint: { version: 2 } };
    const saved = JSON.parse(JSON.stringify(rm.toJSON()));
    saved.eclipse = { ...saved.eclipse, shadow: 100, actStartShadow: 0 };
    const loaded = RunManager.fromJSON(saved, data);
    expect(loaded.nodeMap.nodes.find((n) => n.id === target.id).eclipse).toBeUndefined();
    expect(loaded.nodeMap.nodes.some((n) => n.eclipse)).toBe(true);
  });

  it('marks falls seen once', () => {
    const rm = freshRun(34);
    rm.eclipse = { ...rm.eclipse, shadow: 20 };
    rm.applyEclipseNow();
    const ids = rm.nodeMap.nodes.filter((n) => n.eclipse).map((n) => n.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(rm.markEclipseSeen(ids)).toBe(true);
    expect(rm.markEclipseSeen(ids)).toBe(false);
    expect(rm.getEclipseView().unseen).toEqual([]);
  });

  it('records final shadow in the victory record', () => {
    const rm = freshRun(35);
    rm.eclipse = { ...rm.eclipse, shadow: 57 };
    rm.status = 'victory';
    const recorded = [];
    rm._applySettledRewardsToMeta(
      {
        recordMilestone() {},
        hasMilestone: () => false,
        addValor() {},
        addSupply() {},
        incrementRunsCompleted() {},
        recordRunEnd: (entry) => recorded.push(entry),
      },
      { result: 'victory', valor: 0, supply: 0 },
    );
    expect(recorded[0]?.victoryRecord?.shadow).toBe(57);
  });
});

describe('late pressure while the Eclipse is the clock', () => {
  const cfg = data.turnBonus;
  it('never decays XP or gold when the Eclipse is active', () => {
    const on = getLatePressureState(20, 5, cfg, { eclipseActive: true });
    expect(on).toMatchObject({ active: false, xpMultiplier: 1, goldMultiplier: 1 });
    expect(formatParTooltip(20, 5, cfg, { eclipseActive: true })).not.toMatch(/Late/);
  });
  it('is unchanged when the Eclipse is off', () => {
    const off = getLatePressureState(20, 5, cfg);
    expect(off.active).toBe(true);
    expect(off.xpMultiplier).toBeLessThan(1);
    expect(off).toEqual(getLatePressureState(20, 5, cfg, { eclipseActive: false }));
  });
});

describe('church Kindle', () => {
  it('costs the act price, lifts shadow once per chapel and floors at 0', () => {
    const rm = freshRun();
    rm.gold = 5000;
    rm.eclipse = { ...rm.eclipse, shadow: 12 };
    const price = data.eclipse.kindlePrice.act1;
    const res = kindleAtChurch(rm, 'act1_3_1');
    expect(res.ok).toBe(true);
    expect(res.message).toMatch(/Shadow −8/);
    expect(rm.gold).toBe(5000 - price);
    expect(rm.eclipse.shadow).toBe(4);
    expect(churchKindleBlock(rm, 'act1_3_1')).toMatch(/Already kindled/);
    const again = kindleAtChurch(rm, 'act1_4_1');
    expect(again.ok).toBe(true);
    expect(rm.eclipse.shadow).toBe(0);
    expect(churchKindleBlock(rm, 'act1_5_1')).toMatch(/clear/);
  });

  it('refuses without gold and never spends on refusal', () => {
    const rm = freshRun();
    rm.gold = 10;
    rm.eclipse = { ...rm.eclipse, shadow: 12 };
    expect(kindleAtChurch(rm, 'act1_3_1')).toMatchObject({ ok: false });
    expect(rm.gold).toBe(10);
    expect(rm.eclipse.shadow).toBe(12);
  });
});
