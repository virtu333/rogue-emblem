import { describe, expect, it } from 'vitest';
import {
  actShadowOf,
  applyEclipse,
  buildEclipseView,
  computeShadowGain,
  createEclipseState,
  eclipseBattleMods,
  eclipseHash,
  eclipseNode,
  eclipsePhase,
  fallToastText,
  isEclipseActive,
  kindleBlock,
  kindlePrice,
  kindleResult,
  laneKind,
  nodeFallExemption,
  nodeFallThreshold,
  normalizeEclipseState,
  turnsBeforeShadow,
} from '../src/engine/EclipseSystem.js';
import { generateNodeMap } from '../src/engine/NodeMapGenerator.js';
import { createSeededRng } from '../src/engine/BlessingEngine.js';
import { ACT_CONFIG } from '../src/utils/constants.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const config = data.eclipse;

function seededMap(actId = 'act2', seed = 7, options = {}) {
  const prev = Math.random;
  Math.random = createSeededRng(seed);
  try {
    return generateNodeMap(actId, ACT_CONFIG[actId], data.mapTemplates, {
      halfFogChance: true,
      colosseumConfig: data.colosseum?.nodeGeneration ?? null,
      ...options,
    });
  } finally {
    Math.random = prev;
  }
}

function state(shadow, actStartShadow = 0, extra = {}) {
  return { ...createEclipseState(), shadow, actStartShadow, ...extra };
}

function applyAt(nodeMap, shadow, extra = {}) {
  return applyEclipse({
    state: state(shadow),
    config,
    nodeMap,
    runSeed: 1234,
    mapTemplates: data.mapTemplates,
    halfFogChance: true,
    ...extra,
  });
}

describe('Eclipse data', () => {
  it('ships the spec defaults', () => {
    expect(config.graceUnderPar).toBe(3);
    expect(config.maxGainPerBattle).toBe(6);
    expect(config.noParGain).toBe(1);
    expect(config.bossRelief).toBe(3);
    expect(config.kindleAmount).toBe(8);
    expect(config.cap).toBe(100);
    expect(config.phases.map((p) => [p.name, p.min])).toEqual([
      ['Pale', 0],
      ['Waning', 25],
      ['Umbral', 50],
      ['Totality', 75],
      ['Hollow', 100],
    ]);
    expect(config.phaseEnemyLevelBonus).toEqual([0, 0, 1, 1, 2]);
  });
});

describe('shadow gain (victory commit and HUD projection)', () => {
  const gain = (turnsTaken, par, extra = {}) =>
    computeShadowGain({ turnsTaken, par, ...extra }, config);

  it('holds the sun for an S-rank clear and adds one per turn past par - grace', () => {
    // par 9: S-rank is turn 6 or better (brackets: S at <= par-3).
    expect(gain(4, 9)).toBe(0);
    expect(gain(6, 9)).toBe(0); // S
    expect(gain(7, 9)).toBe(1);
    expect(gain(9, 9)).toBe(3); // A at par
    expect(gain(11, 9)).toBe(5); // B
    expect(gain(12, 9)).toBe(6); // B edge
  });

  it('caps a single battle at maxGainPerBattle', () => {
    expect(gain(15, 9)).toBe(6); // C
    expect(gain(40, 9)).toBe(6);
  });

  it('never lets the free window drop below one turn on tiny pars', () => {
    expect(gain(1, 3)).toBe(0);
    expect(gain(2, 3)).toBe(1);
    expect(gain(1, 1)).toBe(0);
  });

  it('adds noParGain for battles without a par, nothing for tutorials or unknown turns', () => {
    expect(gain(5, null)).toBe(1);
    expect(gain(5, 9, { tutorialMode: true })).toBe(0);
    expect(gain(undefined, 9)).toBe(0);
    expect(gain(0, 9)).toBe(0);
    expect(computeShadowGain({ turnsTaken: 12, par: 9 }, null)).toBe(0);
  });

  it('scales by difficultyGain', () => {
    const hot = { ...config, difficultyGain: { ...config.difficultyGain, lunatic: 1.5 } };
    expect(computeShadowGain({ turnsTaken: 9, par: 9, difficultyId: 'lunatic' }, hot)).toBe(5);
    expect(computeShadowGain({ turnsTaken: 30, par: 9, difficultyId: 'lunatic' }, hot)).toBe(9);
    expect(computeShadowGain({ turnsTaken: 9, par: 9, difficultyId: 'normal' }, hot)).toBe(3);
  });

  it('counts the turns left before the projection rises', () => {
    expect(turnsBeforeShadow({ turnsTaken: 2, par: 9 }, config)).toBe(4);
    expect(turnsBeforeShadow({ turnsTaken: 6, par: 9 }, config)).toBe(0);
  });
});

describe('phases', () => {
  it.each([
    [0, 'pale'],
    [24, 'pale'],
    [25, 'waning'],
    [49, 'waning'],
    [50, 'umbral'],
    [74, 'umbral'],
    [75, 'totality'],
    [99, 'totality'],
    [100, 'hollow'],
    [140, 'hollow'],
  ])('shadow %i is %s', (shadow, id) => {
    expect(eclipsePhase(shadow, config).id).toBe(id);
  });

  it('reports the next boundary', () => {
    expect(eclipsePhase(30, config)).toMatchObject({ index: 1, min: 25, nextMin: 50 });
    expect(eclipsePhase(100, config).nextMin).toBeNull();
  });
});

describe('state', () => {
  it('normalizes legacy and malformed saves', () => {
    expect(normalizeEclipseState(undefined)).toEqual(createEclipseState());
    expect(normalizeEclipseState(null)).toEqual(createEclipseState());
    expect(
      normalizeEclipseState(
        {
          shadow: 180,
          actStartShadow: -4,
          enabled: false,
          kindledNodeIds: ['a', 'a', 3, ''],
          junk: 1,
        },
        config,
      ),
    ).toEqual({
      version: 1,
      shadow: 100,
      actStartShadow: 0,
      enabled: false,
      kindledNodeIds: ['a'],
    });
  });

  it('round-trips a normal state unchanged (save idempotence)', () => {
    const s = state(37, 22, { kindledNodeIds: ['act2_3_1'] });
    expect(normalizeEclipseState(JSON.parse(JSON.stringify(s)), config)).toEqual(s);
  });

  it('act shadow is floored at zero', () => {
    expect(actShadowOf(state(30, 22))).toBe(8);
    expect(actShadowOf(state(10, 22))).toBe(0);
  });

  it('is inert without config or when disabled', () => {
    expect(isEclipseActive(createEclipseState(), null)).toBe(false);
    expect(isEclipseActive(createEclipseState({ enabled: false }), config)).toBe(false);
    expect(isEclipseActive(createEclipseState(), config)).toBe(true);
  });
});

describe('fall thresholds', () => {
  const map = seededMap();
  const rows = Math.max(...map.nodes.map((n) => n.row)) + 1;

  it('maps lanes outer / inner / center', () => {
    expect([0, 1, 2, 3, 4].map((c) => laneKind(c))).toEqual([
      'outer',
      'inner',
      'center',
      'inner',
      'outer',
    ]);
  });

  it('is deterministic per run seed and node, and varies across nodes', () => {
    const a = map.nodes.map((n) => nodeFallThreshold(n, { runSeed: 99, rows, config }));
    const b = map.nodes.map((n) => nodeFallThreshold(n, { runSeed: 99, rows, config }));
    const c = map.nodes.map((n) => nodeFallThreshold(n, { runSeed: 100, rows, config }));
    expect(a).toEqual(b);
    expect(new Set(a).size).toBeGreaterThan(2);
    expect(a).not.toEqual(c);
    expect(eclipseHash('eclipse:99:act2_3_1')).toBe(eclipseHash('eclipse:99:act2_3_1'));
  });

  it('stays inside laneBase + rowBias + jitter, earlier rows falling later', () => {
    for (const node of map.nodes) {
      const t = nodeFallThreshold(node, { runSeed: 5, rows, config });
      const base = config.laneBase[laneKind(node.col)];
      expect(t).toBeGreaterThanOrEqual(base);
      expect(t).toBeLessThanOrEqual(base + config.rowBias + config.jitter);
    }
    const early = { id: 'x', row: 0, col: 0 };
    const late = { id: 'x', row: rows - 1, col: 0 };
    expect(nodeFallThreshold(early, { runSeed: 5, rows, config })).toBe(
      nodeFallThreshold(late, { runSeed: 5, rows, config }) + config.rowBias,
    );
  });
});

describe('exemptions', () => {
  const map = seededMap();
  const find = (pred) => map.nodes.find(pred);

  it('never lets the start, boss, ruins, current, completed, locked or eclipsed nodes fall', () => {
    const ctx = { nodeMap: map, currentNodeId: null };
    expect(
      nodeFallExemption(
        find((n) => n.id === map.startNodeId),
        ctx,
      ),
    ).toBe('start');
    expect(
      nodeFallExemption(
        find((n) => n.id === map.bossNodeId),
        ctx,
      ),
    ).toBe('boss');
    expect(
      nodeFallExemption(
        find((n) => n.type === 'ruins'),
        ctx,
      ),
    ).toBe('ruins');
    const mid = find((n) => n.row === 3);
    expect(nodeFallExemption(mid, { ...ctx, currentNodeId: mid.id })).toBe('current');
    expect(nodeFallExemption(mid, { ...ctx, activeNodeId: mid.id })).toBe('current');
    expect(nodeFallExemption({ ...mid, completed: true }, ctx)).toBe('completed');
    expect(nodeFallExemption({ ...mid, encounterLocked: true }, ctx)).toBe('locked');
    expect(nodeFallExemption({ ...mid, eclipse: { fromType: 'shop' } }, ctx)).toBe('eclipsed');
    expect(nodeFallExemption(mid, ctx)).toBeNull();
  });
});

describe('applyEclipse', () => {
  it('does nothing at zero act shadow', () => {
    const map = seededMap();
    const before = JSON.stringify(map);
    expect(applyAt(map, 0)).toEqual([]);
    expect(JSON.stringify(map)).toBe(before);
  });

  it('transforms every fallable node at full shadow and keeps the graph intact', () => {
    const map = seededMap('act2', 11, { villageAmbushChance: 0.5 });
    const edgesBefore = map.nodes.map((n) => [n.id, [...n.edges]]);
    const typesBefore = new Map(map.nodes.map((n) => [n.id, n.type]));
    const fell = applyAt(map, 100);
    expect(fell.length).toBeGreaterThan(0);
    expect(map.nodes.map((n) => [n.id, n.edges])).toEqual(edgesBefore);
    for (const node of map.nodes) {
      const was = typesBefore.get(node.id);
      if (node.id === map.startNodeId || ['boss', 'ruins'].includes(was)) {
        expect(node.eclipse).toBeUndefined();
        expect(node.type).toBe(was);
        continue;
      }
      expect(node.type).toBe('battle');
      expect(node.eclipse).toMatchObject({ fromType: was, seen: false, fellAtShadow: 100 });
      expect(node.eclipse.label).toBe(config.falls[was].label);
      expect(node.battleParams).toMatchObject({ isEclipsed: true, isElite: true });
      expect(node.isAmbush).toBeUndefined();
    }
  });

  it('follows the transformation table', () => {
    const map = seededMap('act2', 3);
    const byType = {};
    for (const n of map.nodes) if (n.id !== map.startNodeId && !byType[n.type]) byType[n.type] = n;
    const battle = byType.battle;
    const before = structuredClone(battle.battleParams);
    const ctx = {
      runSeed: 42,
      config,
      actId: 'act2',
      mapTemplates: data.mapTemplates,
      halfFogChance: true,
      shadow: 30,
    };
    eclipseNode(battle, ctx);
    // A battle keeps its encounter (objective, seed, template) and turns elite.
    expect(battle.battleParams).toEqual({ ...before, isEclipsed: true, isElite: true });
    expect(battle.eclipse.label).toBe('Eclipsed battle');
    const service = {
      id: 'act2_4_0',
      row: 4,
      col: 0,
      type: 'church',
      edges: [],
      battleParams: null,
    };
    eclipseNode(service, ctx);
    expect(service.type).toBe('battle');
    expect(service.battleParams).toMatchObject({
      act: 'act2',
      objective: 'rout',
      row: 4,
      isEclipsed: true,
      isElite: true,
    });
    expect(Number.isFinite(service.battleParams.battleSeed)).toBe(true);
    expect(service.battleParams.hasVillage).toBeUndefined();
    expect(service.battleParams.hasCaravan).toBeUndefined();
    expect(service.battleParams.isRecruitBattle).toBeUndefined();
    expect(service.eclipse.label).toBe('Desecrated chapel');
    const recruit = { id: 'act2_5_1', row: 5, col: 1, type: 'recruit', edges: [] };
    recruit.battleParams = { act: 'act2', objective: 'rout', isRecruitBattle: true };
    eclipseNode(recruit, ctx);
    expect(recruit.battleParams.isRecruitBattle).toBeUndefined();
    expect(recruit.eclipse.label).toBe('Lost to the dark');
    const arena = { id: 'act2_3_2', row: 3, col: 2, type: 'colosseum', edges: [] };
    eclipseNode(arena, ctx);
    expect(arena.eclipse.label).toBe('Silent arena');
    const village = { id: 'act2_2_4', row: 2, col: 4, type: 'shop', edges: [], isAmbush: true };
    village.ambushCleared = false;
    eclipseNode(village, ctx);
    expect(village.eclipse.label).toBe('Burned village');
    expect(village).not.toHaveProperty('isAmbush');
    expect(village).not.toHaveProperty('ambushCleared');
  });

  it('is idempotent', () => {
    const map = seededMap('act3', 21);
    applyAt(map, 18);
    const once = JSON.stringify(map);
    expect(applyAt(map, 18)).toEqual([]);
    expect(JSON.stringify(map)).toBe(once);
  });

  it('never touches the caller Math.random and rolls conversions on their own stream', () => {
    const map = seededMap('act2', 5);
    const twin = structuredClone(map);
    let calls = 0;
    const spy = () => {
      calls++;
      return 0.5;
    };
    const prev = Math.random;
    Math.random = spy;
    try {
      applyAt(map, 100);
      expect(Math.random).toBe(spy);
      expect(calls).toBe(0);
    } finally {
      Math.random = prev;
    }
    // Same seed + node id → same conversion, whatever the ambient RNG was.
    Math.random = createSeededRng(999);
    try {
      applyAt(twin, 100);
    } finally {
      Math.random = prev;
    }
    expect(JSON.stringify(twin)).toBe(JSON.stringify(map));
  });

  it('falls the outer lanes first as act shadow rises', () => {
    const map = seededMap('act2', 8);
    const fell = applyAt(map, 10);
    expect(fell.length).toBeGreaterThan(0);
    for (const node of fell) expect(laneKind(node.col)).toBe('outer');
  });
});

describe('battle modifiers', () => {
  it('adds nothing in Pale for a whole node', () => {
    expect(eclipseBattleMods({ state: state(10), config })).toEqual({
      enemyLevelBonus: 0,
      phaseId: 'pale',
      phaseIndex: 0,
      affix: null,
    });
  });

  it('raises levels and affixes by phase', () => {
    const umbral = eclipseBattleMods({ state: state(55), config });
    expect(umbral.enemyLevelBonus).toBe(1);
    expect(umbral.affix).toMatchObject({ gatingDifficultyId: 'hard', extraMaxAffixes: 0 });
    const hardUmbral = eclipseBattleMods({ state: state(55), config, difficultyId: 'hard' });
    expect(hardUmbral.affix).toBeNull();
    const totality = eclipseBattleMods({ state: state(80), config, difficultyId: 'lunatic' });
    expect(totality.affix).toMatchObject({ gatingDifficultyId: null, extraMaxAffixes: 1 });
    expect(eclipseBattleMods({ state: state(100), config }).enemyLevelBonus).toBe(2);
  });

  it('eclipsed nodes add levels and guaranteed affixes', () => {
    const mods = eclipseBattleMods({ state: state(5), config, isEclipsed: true });
    expect(mods.enemyLevelBonus).toBe(1);
    expect(mods.affix).toMatchObject({ guaranteedCount: 2, guaranteedTier: 1 });
  });

  it('is empty when the Eclipse is off', () => {
    expect(eclipseBattleMods({ state: state(90, 0, { enabled: false }), config })).toEqual({
      enemyLevelBonus: 0,
      phaseId: null,
      phaseIndex: 0,
      affix: null,
    });
  });
});

describe('Kindle', () => {
  const base = { config, nodeId: 'act2_4_1', actId: 'act2' };

  it('prices by act from data', () => {
    expect(kindlePrice('act2', config)).toBe(700);
    expect(kindlePrice('nowhere', config)).toBeNull();
  });

  it('lifts kindleAmount, once per node, floored at zero', () => {
    const r = kindleResult({ ...base, state: state(30), gold: 5000 });
    expect(r).toMatchObject({ ok: true, price: 700, removed: 8 });
    expect(r.state.shadow).toBe(22);
    expect(r.state.kindledNodeIds).toEqual(['act2_4_1']);
    expect(kindleBlock({ ...base, state: r.state, gold: 5000 })).toMatch(/Already kindled/);
    const low = kindleResult({ ...base, state: state(5), gold: 5000 });
    expect(low.state.shadow).toBe(0);
    expect(low.removed).toBe(5);
  });

  it('refuses a clear sun, a poor purse or a disabled clock', () => {
    expect(kindleBlock({ ...base, state: state(0), gold: 5000 })).toMatch(/clear/);
    expect(kindleBlock({ ...base, state: state(30), gold: 10 })).toMatch(/gold/);
    expect(
      kindleBlock({ ...base, state: state(30, 0, { enabled: false }), gold: 5000 }),
    ).toBeTruthy();
  });
});

describe('view model and copy', () => {
  it('marks near falls, next fall and lane darkness', () => {
    const map = seededMap('act2', 8);
    const st = state(40, 30); // act shadow 10
    applyEclipse({
      state: st,
      config,
      nodeMap: map,
      runSeed: 1234,
      mapTemplates: data.mapTemplates,
    });
    const view = buildEclipseView({ state: st, config, nodeMap: map, runSeed: 1234 });
    expect(view.phase.id).toBe('waning');
    expect(view.actShadow).toBe(10);
    const eclipsed = [...view.nodes.values()].filter((v) => v.eclipsed);
    expect(eclipsed.length).toBe(map.nodes.filter((n) => n.eclipse).length);
    for (const [id, info] of view.nodes) {
      if (!Number.isFinite(info.remaining)) continue;
      expect(info.remaining).toBeGreaterThanOrEqual(1);
      expect(info.near).toBe(info.remaining <= config.fallWarning && !info.guarded);
      expect(map.nodes.find((n) => n.id === id).eclipse).toBeUndefined();
    }
    expect(view.nextFall).toBeGreaterThanOrEqual(1);
    expect(view.laneDarkness).toHaveLength(5);
    expect(Math.max(view.laneDarkness[0], view.laneDarkness[4])).toBeGreaterThan(0);
    expect(view.unseen.length).toBe(eclipsed.length);
  });

  it('names the loss in one line', () => {
    const a = { eclipse: { fromType: 'shop' } };
    const b = { eclipse: { fromType: 'church' } };
    expect(fallToastText([a], config)).toBe('The dark takes the village.');
    expect(fallToastText([a, b], config)).toBe('The dark takes the village and 1 more.');
    const field = { eclipse: { fromType: 'battle' } };
    expect(fallToastText([field, b], config)).toBe('The dark takes the chapel and 1 more.');
    expect(fallToastText([], config)).toBe('');
  });
});
