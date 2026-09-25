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
      version: 2,
      shadow: 0,
      actStartShadow: 0,
      actShadow: 0,
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
    rm.eclipse = { ...rm.eclipse, shadow: 30, actStartShadow: 0, actShadow: 30 };
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
      rm.eclipse = { ...rm.eclipse, shadow: 100, actStartShadow: 0, actShadow: 100 };
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
    expect(rm.eclipse.shadow).toBe(carried);
    expect(rm.eclipse.actShadow).toBe(0);
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
    expect(JSON.stringify(rm.nodeMap)).toBe(JSON.stringify(direct));
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
    rm.eclipse = { ...rm.eclipse, shadow: 60, actStartShadow: 0, actShadow: 60 };
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
    rm.eclipse = {
      ...rm.eclipse,
      shadow: 44,
      actStartShadow: 20,
      actShadow: 24,
      kindledNodeIds: ['x'],
    };
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
      version: 2,
      shadow: 0,
      actStartShadow: 0,
      actShadow: 0,
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
    // A version-1 save (no act pressure field): it is derived as shadow - actStartShadow.
    saved.eclipse = {
      version: 1,
      shadow: 100,
      actStartShadow: 0,
      enabled: true,
      kindledNodeIds: [],
    };
    const loaded = RunManager.fromJSON(saved, data);
    expect(loaded.eclipse.actShadow).toBe(100);
    expect(loaded.nodeMap.nodes.find((n) => n.id === target.id).eclipse).toBeUndefined();
    expect(loaded.nodeMap.nodes.some((n) => n.eclipse)).toBe(true);
  });

  it('marks falls seen once', () => {
    const rm = freshRun(34);
    rm.eclipse = { ...rm.eclipse, shadow: 20, actShadow: 20 };
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

describe('late pressure alongside the Eclipse', () => {
  const cfg = data.turnBonus;
  it('decays XP and gold past par whether or not the Eclipse runs', () => {
    const late = getLatePressureState(20, 5, cfg);
    expect(late.active).toBe(true);
    expect(late.xpMultiplier).toBeLessThan(1);
    expect(late.goldMultiplier).toBeLessThan(1);
    expect(formatParTooltip(20, 5, cfg)).toMatch(/Late/);
  });
});

describe('church Kindle', () => {
  it('costs the act price, lifts shadow once per chapel and floors at 0', () => {
    const rm = freshRun();
    rm.gold = 5000;
    rm.eclipse = { ...rm.eclipse, shadow: 12, actShadow: 10 };
    const price = data.eclipse.kindlePrice.act1;
    const res = kindleAtChurch(rm, 'act1_3_1');
    expect(res.ok).toBe(true);
    expect(res.message).toMatch(/Shadow −8/);
    expect(rm.gold).toBe(5000 - price);
    expect(rm.eclipse.shadow).toBe(4);
    // Kindle lowers both the sun and this act's pressure.
    expect(rm.eclipse.actShadow).toBe(2);
    expect(churchKindleBlock(rm, 'act1_3_1')).toMatch(/Already kindled/);
    const again = kindleAtChurch(rm, 'act1_4_1');
    expect(again.ok).toBe(true);
    expect(rm.eclipse.shadow).toBe(0);
    expect(rm.eclipse.actShadow).toBe(0);
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

// Review R2: act pressure is its own field, uncapped by the global meter, so an act
// that opens near the cap still loses land to slow play.
describe('act pressure vs the global cap (review R2)', () => {
  /** Seed 42 on Normal, walked (fast clears) to Act III, whose map has an outer-lane
   *  shop (act3_6_0) with fall threshold 8. */
  function act3Seed42() {
    const rm = freshRun(42);
    for (let act = 0; act < 2; act++) {
      bossPathTo(rm);
      rm.advanceAct();
    }
    expect(rm.currentAct).toBe('act3');
    const shop = rm.nodeMap.nodes.find((n) => n.id === 'act3_6_0');
    expect(shop).toMatchObject({ type: 'shop', col: 0 });
    return { rm, shop };
  }
  const slow = { turnCount: 30, turnPar: 5 }; // maxGainPerBattle (6)
  const pickBattle = (nodes) => nodes.find((n) => n.type === 'battle') || nodes[0];

  it('the review reproduction: shadow 100 / act start 97 — the shop now falls to slow victories', () => {
    const { rm, shop } = act3Seed42();
    // The reviewed save: a version-1 state (act pressure derived: 100 - 97 = 3).
    const saved = JSON.parse(JSON.stringify(rm.toJSON()));
    saved.eclipse = {
      version: 1,
      shadow: 100,
      actStartShadow: 97,
      enabled: true,
      kindledNodeIds: [],
    };
    const loaded = RunManager.fromJSON(saved, data);
    expect(loaded.eclipse).toMatchObject({ shadow: 100, actShadow: 3 });
    const view = loaded.getEclipseView();
    expect(view.actShadow).toBe(3);
    expect(view.atCap).toBe(true);
    expect(view.nodes.get(shop.id)).toMatchObject({ threshold: 8, remaining: 5 });
    expect(loaded.nodeMap.nodes.some((n) => n.eclipse)).toBe(false);
    // One slow victory: the sun stays at the cap, the act gathers the full gain.
    winNext(loaded, slow, pickBattle);
    expect(loaded.eclipse.shadow).toBe(100);
    expect(loaded.eclipse.actShadow).toBe(9);
    expect(loaded.lastEclipseCommit).toMatchObject({ gain: 6, meterGain: 0, actAfter: 9 });
    const fell = loaded.nodeMap.nodes.find((n) => n.id === shop.id);
    expect(fell.type).toBe('battle');
    expect(fell.eclipse).toMatchObject({ fromType: 'shop', fellAtShadow: 100 });
    expect(loaded.lastEclipseCommit.fell).toContain(shop.id);
  });

  it('a new act opening at 97 (cap minus boss relief) keeps losing land to slow play', () => {
    const rm = freshRun(42);
    bossPathTo(rm);
    rm.advanceAct();
    // Act II ends at the cap; the boss's flare leaves 97 for Act III.
    rm.eclipse = { ...rm.eclipse, shadow: 100, actShadow: 40 };
    bossPathTo(rm);
    expect(rm.eclipse.shadow).toBe(100 - data.eclipse.bossRelief);
    rm.advanceAct();
    expect(rm.eclipse).toMatchObject({ shadow: 97, actStartShadow: 97, actShadow: 0 });
    expect(rm.getEclipseView().nextFall).not.toBeNull();
    const falls = [];
    const pick = (nodes) => nodes.find((n) => n.type === 'battle' && !n.eclipse) || nodes[0];
    for (let i = 0; i < 3; i++) {
      winNext(rm, slow, pick);
      falls.push(...rm.lastEclipseCommit.fell);
    }
    expect(rm.eclipse.shadow).toBe(100);
    expect(rm.eclipse.actShadow).toBe(18);
    expect(falls.length).toBeGreaterThan(0);
  });

  it('boundaries at the cap: the meter takes what fits, the act takes it all', () => {
    const rm = freshRun(7);
    rm.eclipse = { ...rm.eclipse, shadow: 94, actShadow: 0 };
    winNext(rm, slow);
    expect(rm.eclipse).toMatchObject({ shadow: 100, actShadow: 6 });
    expect(rm.lastEclipseCommit).toMatchObject({ before: 94, after: 100, meterGain: 6 });
    rm.eclipse = { ...rm.eclipse, shadow: 97, actShadow: 6 };
    winNext(rm, slow);
    expect(rm.eclipse).toMatchObject({ shadow: 100, actShadow: 12 });
    expect(rm.lastEclipseCommit.meterGain).toBe(3);
    winNext(rm, slow);
    expect(rm.eclipse).toMatchObject({ shadow: 100, actShadow: 18 });
    expect(rm.lastEclipseCommit.meterGain).toBe(0);
    // A held sun adds to neither.
    winNext(rm, { turnCount: 2, turnPar: 9 });
    expect(rm.eclipse).toMatchObject({ shadow: 100, actShadow: 18 });
  });

  it('Kindle lowers both the capped meter and the uncapped act pressure', () => {
    const rm = freshRun();
    rm.gold = 5000;
    rm.eclipse = { ...rm.eclipse, shadow: 100, actStartShadow: 97, actShadow: 21 };
    const res = rm.kindleSun('act1_3_1');
    expect(res).toMatchObject({ ok: true, removed: 8, actRemoved: 8, shadow: 92, actShadow: 13 });
    expect(rm.eclipse).toMatchObject({ shadow: 92, actShadow: 13 });
    // Act pressure floors at 0 independently.
    rm.eclipse = { ...rm.eclipse, shadow: 50, actShadow: 3 };
    expect(rm.kindleSun('act1_4_1')).toMatchObject({ ok: true, removed: 8, actRemoved: 3 });
    expect(rm.eclipse).toMatchObject({ shadow: 42, actShadow: 0 });
  });

  it('falls stay deterministic (runSeed + node id), never drawing from Math.random', () => {
    const play = () => {
      const { rm } = act3Seed42();
      rm.eclipse = { ...rm.eclipse, shadow: 97, actStartShadow: 97, actShadow: 0 };
      const prev = Math.random;
      let draws = 0;
      Math.random = () => {
        draws++;
        return prev();
      };
      try {
        for (let i = 0; i < 3; i++) winNext(rm, slow, pickBattle);
      } finally {
        Math.random = prev;
      }
      return { map: JSON.stringify(rm.nodeMap), draws, eclipse: rm.eclipse };
    };
    const a = play();
    const b = play();
    expect(a.map).toBe(b.map);
    expect(a.eclipse).toEqual(b.eclipse);
    expect(a.draws).toBe(0);
    expect(a.map).toContain('"fromType":"shop"');
  });

  it('save round trip keeps act pressure beyond the global cap', () => {
    const rm = freshRun(31);
    rm.eclipse = { ...rm.eclipse, shadow: 100, actStartShadow: 97, actShadow: 23 };
    rm.applyEclipseNow();
    const settled = JSON.stringify(
      RunManager.fromJSON(JSON.parse(JSON.stringify(rm.toJSON())), data).toJSON(),
    );
    const loaded = RunManager.fromJSON(JSON.parse(settled), data);
    expect(JSON.stringify(loaded.toJSON())).toBe(settled);
    expect(loaded.eclipse).toEqual(rm.eclipse);
  });
});
