// The route preview's scout (docs/specs/blessings-v3.md §6.6, decision D-21): Thief's Lantern
// lists the foes that carry items, Seer's Eye every foe with its affixes and what it carries.
// The scout generates a node's map exactly as the battle will, never locks it and never moves a
// stream.
//
// Each test names the realistic failure it catches.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import { installFakeDom } from './helpers/fakeDom.js';
import { renderLoomCard } from '../src/ui/LoomPanels.js';
import { RunManager } from '../src/engine/RunManager.js';
import {
  applyGenerationFields,
  battleGenerationSeed,
  deriveNodeBattleSeed,
  generateSeededBattle,
  scoutBattle,
  scoutDeployCount,
} from '../src/engine/BattleScout.js';
import { nodeFallExemption } from '../src/engine/EclipseSystem.js';
import { describeBattleScout } from '../src/ui/loomModel.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const realRandom = Math.random;
afterEach(() => {
  Math.random = realRandom;
});

function runHolding(ids, { seed = 11, difficultyId = 'hard' } = {}) {
  const rm = new RunManager(data);
  rm.startRun({ runSeed: seed, difficultyId, applyBlessingsAtStart: false });
  for (const id of ids) expect(rm.addBlessingMidRun(id, { earned: true }), id).toBe(true);
  return rm;
}
const battleNodes = (rm) =>
  rm.nodeMap.nodes.filter((n) => ['battle', 'boss', 'recruit'].includes(n.type) && n.battleParams);
const roundTrip = (rm) => RunManager.fromJSON(JSON.parse(JSON.stringify(rm.toJSON())), rm.gameData);

/** The battle's own generation, step for step as BattleScene.beginBattle does it. */
function enterAndGenerate(rm, node, deployCount) {
  const params = rm.getBattleParams(node);
  applyGenerationFields(params, { deployCount, isBoss: node.type === 'boss' });
  const seed = battleGenerationSeed(params, { runSeed: rm.runSeed, nodeId: node.id });
  return generateSeededBattle(params, rm.gameData, seed);
}
const foesOf = (config) =>
  config.enemySpawns.map((s) => ({
    className: s.className,
    level: s.level,
    isBoss: s.isBoss === true,
    affixes: s.affixes || [],
    carries: s.carries || null,
  }));

describe("the scout is the battle's own map", () => {
  it('lists exactly the foes the battle generates at the same deploy count, for every node', () => {
    // Failure: the scout builds its params differently from the battle (a missing generation
    // field, another seed), so the preview names foes the battle never fields.
    for (const seed of [11, 12, 13]) {
      const rm = runHolding(['seers_eye'], { seed });
      for (const node of battleNodes(rm)) {
        const scout = scoutBattle(rm, node);
        expect(scout, node.id).not.toBeNull();
        expect(scout.locked).toBe(false);
        const battle = enterAndGenerate(rm, node, scout.deployCount);
        expect(scout.foes, node.id).toEqual(foesOf(battle));
      }
    }
  });

  it('the scene generates through the same three calls (a static boundary)', () => {
    // Failure: BattleScene goes back to its own generateBattle call (another seed rule, the
    // fields set by hand), and the preview and the battle silently drift apart.
    const scene = fs.readFileSync('src/scenes/BattleScene.js', 'utf8');
    const begin = scene.slice(scene.indexOf('  async beginBattle('), scene.indexOf('const bc = '));
    expect(begin).toMatch(/applyGenerationFields\(this\.battleParams, \{ deployCount/);
    expect(begin).toMatch(/battleGenerationSeed\(this\.battleParams/);
    expect(begin).toMatch(/generateSeededBattle\(this\.battleParams, this\.gameData, battleSeed\)/);
    expect(begin).not.toMatch(/generateBattle\(this\.battleParams/);
    expect(begin).not.toMatch(/this\.battleParams\.(deployCount|isBoss) =/);
    // The scene's fallback seed is the shared rule too.
    expect(scene).toMatch(/deriveBattleSeed\(\) \{\s*return deriveNodeBattleSeed\(/);
  });

  it('the fallback seed is the scene’s old FNV-1a of "<run seed>:<node>"', () => {
    // Failure: the shared rule hashes another string, so a node without a battleSeed generates a
    // different map than it did before (a save mid-run changes its next fight).
    let h = 2166136261 >>> 0;
    for (const ch of '77:act2_3_1') {
      h ^= ch.charCodeAt(0);
      h = Math.imul(h, 16777619);
    }
    expect(deriveNodeBattleSeed(77, 'act2_3_1')).toBe(h >>> 0);
    expect(battleGenerationSeed({ battleSeed: 5 }, { runSeed: 77, nodeId: 'x' })).toBe(5);
    expect(battleGenerationSeed({ act: 'act1' }, { runSeed: 77 })).toBe(
      deriveNodeBattleSeed(77, 'act1'),
    );
  });

  it('assumes the deploy screen’s count: the roster up to the act’s cap and bonus', () => {
    // Failure: the scout sizes foes for another deploy than the player will see (the act's
    // minimum, or the whole roster past the cap).
    const rm = runHolding(['seers_eye']);
    const node = battleNodes(rm).find((n) => n.type === 'battle');
    expect(scoutDeployCount(rm, node)).toBe(Math.min(rm.roster.length, 4));
    const extra = rm.roster[1];
    for (let i = 0; i < 6; i++) rm.roster.push({ ...structuredClone(extra), name: `X${i}` });
    expect(scoutDeployCount(rm, node)).toBe(4 + (rm.getDeployBonus?.() || 0));
    expect(scoutBattle(rm, node).deployCount).toBe(scoutDeployCount(rm, node));
  });
});

describe('the scout touches nothing', () => {
  it('never draws from Math.random, and puts it back exactly', () => {
    // Failure: the generation runs on the shared stream (every later draw in the run moves), or
    // the swap is not undone (the run keeps drawing from the scout's seed).
    // Seed 12's map holds a recruit node too (its params and its recruit are built as well).
    const runs = [11, 12].map((seed) => runHolding(['seers_eye'], { seed }));
    expect(runs.some((rm) => battleNodes(rm).some((n) => n.type === 'recruit'))).toBe(true);
    let calls = 0;
    const spy = () => {
      calls += 1;
      return realRandom();
    };
    Math.random = spy;
    for (const rm of runs) for (const node of battleNodes(rm)) scoutBattle(rm, node);
    expect(calls).toBe(0);
    expect(Math.random).toBe(spy);
  });

  it('puts Math.random back even when the generation throws', () => {
    const spy = () => 0.5;
    Math.random = spy;
    expect(() => generateSeededBattle({ act: 'act1', objective: 'no_such' }, data, 1)).toThrow();
    expect(Math.random).toBe(spy);
  });

  it('never locks a node (the Eclipse could still take it) and writes nothing to the run', () => {
    // Failure: the scout locks what it shows (lockBattleConfig), which exempts the node from the
    // Eclipse's falls ('locked') and changes the run for every holder; or a recruit battle's
    // generation writes its recruit's name into the run's used-name ledger (the params share it).
    // The battle-entry roster preparation getBattleParams always does (idempotent, no stream)
    // is done first, so what is compared is everything else.
    const rm = runHolding(['seers_eye'], { seed: 12 });
    expect(battleNodes(rm).some((n) => n.type === 'recruit')).toBe(true);
    rm.getBattleParams(battleNodes(rm)[0]);
    const before = JSON.stringify(rm.toJSON());
    for (const node of battleNodes(rm)) {
      expect(scoutBattle(rm, node)).not.toBeNull();
      expect(node.encounterLocked).toBeFalsy();
      if (node.type === 'battle')
        expect(nodeFallExemption(node, { nodeMap: rm.nodeMap }), node.id).not.toBe('locked');
    }
    expect(rm.battleConfigsByNodeId?.[battleNodes(rm)[0].id]).toBeUndefined();
    expect(JSON.stringify(rm.toJSON())).toBe(before);
  });

  it('a scouted battle generates the same map as one never scouted', () => {
    // Failure: scouting leaves something behind (a stream, a cached object the battle then
    // mutates), so looking at a node changes the fight it holds.
    const scouted = runHolding(['seers_eye'], { seed: 31 });
    const plain = runHolding([], { seed: 31 });
    const a = battleNodes(scouted)[0];
    const b = battleNodes(plain)[0];
    scoutBattle(scouted, a);
    scoutBattle(scouted, a);
    const fieldA = enterAndGenerate(scouted, a, 4);
    const fieldB = enterAndGenerate(plain, b, 4);
    // Seer's Eye adds its own key (foesShown) to the params, nothing that shapes the map.
    expect(JSON.stringify(fieldA)).toBe(JSON.stringify(fieldB));
  });
});

describe('what the scout reads', () => {
  it('reads a locked node’s map as stored, and generates no other', () => {
    // Failure: a locked node is generated afresh (the preview names foes the set map lacks).
    const rm = runHolding(['seers_eye']);
    const node = battleNodes(rm).find((n) => n.type === 'battle');
    const config = enterAndGenerate(rm, node, 3);
    config.enemySpawns = [
      { className: 'Knight', level: 9, col: 0, row: 0, affixes: ['thorns'], carries: 'Elixir' },
    ];
    rm.lockBattleConfig(node.id, config);
    const scout = scoutBattle(rm, node);
    expect(scout).toMatchObject({ locked: true, deployCount: config.playerSpawns.length });
    expect(scout.foes).toEqual([
      { className: 'Knight', level: 9, isBoss: false, affixes: ['thorns'], carries: 'Elixir' },
    ]);
    const view = describeBattleScout(scout, { affixNames: { thorns: 'Thorns' } });
    expect(view.note).toBe('The map is set: these foes wait here.');
    expect(view.rows[0]).toMatchObject({ text: 'Knight Lv 9', detail: 'Thorns · carries Elixir' });
  });

  it('shows nothing to a run without the Lantern or the Eye', () => {
    // Failure: previews leak the foes to every run.
    const rm = runHolding([]);
    for (const node of battleNodes(rm)) expect(scoutBattle(rm, node)).toBeNull();
    expect(describeBattleScout(null)).toBeNull();
  });

  it("Thief's Lantern shows the carriers alone, never their affixes or the rest", () => {
    // Failure: the Lantern shows the whole field (the Eye's preview for the Lantern's price).
    let checked = 0;
    for (const seed of [41, 42, 43, 44, 45, 46]) {
      const lantern = runHolding(['thiefs_lantern'], { seed, difficultyId: 'lunatic' });
      const eye = runHolding(['seers_eye'], { seed, difficultyId: 'lunatic' });
      for (const node of battleNodes(lantern)) {
        const lit = scoutBattle(lantern, node);
        const seen = scoutBattle(
          eye,
          eye.nodeMap.nodes.find((n) => n.id === node.id),
        );
        expect(lit.level).toBe('carriers');
        expect(lit.foes).toEqual(
          seen.foes.filter((f) => f.carries).map((f) => ({ ...f, affixes: [] })),
        );
        if (seen.foes.some((f) => !f.carries)) checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('holding both, the Eye’s full list wins', () => {
    const rm = runHolding(['thiefs_lantern', 'seers_eye']);
    const node = battleNodes(rm)[0];
    expect(scoutBattle(rm, node).level).toBe('foes');
  });

  it('never scouts the prologue, a walked node or a service', () => {
    const rm = runHolding(['seers_eye']);
    const node = battleNodes(rm)[0];
    expect(scoutBattle(rm, { ...node, completed: true })).toBeNull();
    expect(scoutBattle(rm, { ...node, type: 'shop' })).toBeNull();
    expect(scoutBattle(rm, { ...node, type: 'event', eventBattle: true })).toBeNull();
    rm.mode = 'prologue';
    expect(scoutBattle(rm, node)).toBeNull();
  });

  it('scouts again when the inputs change (the roster grows), and keeps no stale list', () => {
    // Failure: the cache keys on the node alone, so a bigger army reads foes sized for a smaller.
    const rm = runHolding(['seers_eye']);
    rm.roster = rm.roster.slice(0, 1);
    const node = battleNodes(rm).find((n) => n.type === 'battle');
    const small = scoutBattle(rm, node);
    expect(small.deployCount).toBe(1);
    const back = runHolding(['seers_eye']);
    rm.roster = back.roster;
    const big = scoutBattle(rm, node);
    expect(big.deployCount).toBe(scoutDeployCount(rm, node));
    expect(big.foes).toEqual(foesOf(enterAndGenerate(rm, node, big.deployCount)));
  });

  it('survives a reload: the same seed, the same list (the cache is never saved)', () => {
    const rm = runHolding(['seers_eye'], { seed: 51 });
    const node = battleNodes(rm)[1];
    const first = scoutBattle(rm, node);
    const back = roundTrip(rm);
    expect(JSON.stringify(rm.toJSON())).not.toMatch(/"foes":/);
    expect(
      scoutBattle(
        back,
        back.nodeMap.nodes.find((n) => n.id === node.id),
      ),
    ).toEqual(first);
  });
});

describe('the loom’s words', () => {
  it('counts alike foes together, the boss first, and says what it assumed', () => {
    const view = describeBattleScout(
      {
        level: 'foes',
        locked: false,
        deployCount: 4,
        foes: [
          { className: 'Fighter', level: 2, isBoss: false, affixes: [], carries: null },
          { className: 'Fighter', level: 2, isBoss: false, affixes: [], carries: null },
          {
            className: 'Archer',
            level: 3,
            isBoss: false,
            affixes: ['venomous'],
            carries: 'Vulnerary',
          },
          { className: 'Brigand', level: 5, isBoss: true, affixes: [], carries: null },
        ],
      },
      { affixNames: { venomous: 'Venomous' } },
    );
    expect(view.title).toBe("Seer's Eye");
    expect(view.note).toBe('Scouted for 4 in the field.');
    expect(view.rows.map((r) => [r.text, r.detail])).toEqual([
      ['Boss · Brigand Lv 5', ''],
      ['Fighter Lv 2 ×2', ''],
      ['Archer Lv 3', 'Venomous · carries Vulnerary'],
    ]);
    expect(view.empty).toBeNull();
  });

  it('the Lantern with no carrier says so (an empty list is not a broken one)', () => {
    const view = describeBattleScout({
      level: 'carriers',
      locked: false,
      deployCount: 3,
      foes: [],
    });
    expect(view.title).toBe("Thief's Lantern");
    expect(view.rows).toEqual([]);
    expect(view.empty).toBe('No foe here carries anything.');
  });
});

describe('the route map’s card', () => {
  beforeEach(() => installFakeDom(vi));
  afterEach(() => vi.unstubAllGlobals());

  const model = { nodeState: () => 'live', steps: new Map() };
  const render = (rm, node) => {
    const card = document.createElement('section');
    renderLoomCard(card, node, {
      model,
      actId: rm.currentAct,
      gameData: rm.gameData,
      runManager: rm,
      isFirstBattle: () => false,
    });
    return card;
  };
  const scoutPanel = (card) => card.querySelector('.re-loom-scout');

  it("lists the Eye's foes on a battle node, as the scout found them", () => {
    // Failure: the card never shows the scout (the panel is wired to no caller), or shows
    // something other than what the scout found.
    const rm = runHolding(['seers_eye'], { seed: 61 });
    const node = battleNodes(rm).find((n) => n.type === 'battle');
    const card = render(rm, node);
    const panel = scoutPanel(card);
    expect(panel).not.toBeNull();
    expect(panel.textContent).toContain("Seer's Eye");
    expect(panel.textContent).toContain(`Scouted for ${scoutDeployCount(rm, node)} in the field.`);
    const view = describeBattleScout(scoutBattle(rm, node), {
      affixNames: Object.fromEntries(data.affixes.affixes.map((a) => [a.id, a.name])),
    });
    expect(panel.querySelectorAll('li').map((li) => li.textContent)).toEqual(
      view.rows.map((r) => `${r.text}${r.detail ? ` · ${r.detail}` : ''}`),
    );
  });

  it('shows no panel to a run without the Lantern or the Eye, nor on a service node', () => {
    // Failure: every run's route preview leaks the foes.
    const plain = runHolding([], { seed: 61 });
    expect(scoutPanel(render(plain, battleNodes(plain)[0]))).toBeNull();
    const eye = runHolding(['seers_eye'], { seed: 61 });
    const shop = eye.nodeMap.nodes.find((n) => !n.battleParams && n.type !== 'boss');
    expect(scoutPanel(render(eye, shop))).toBeNull();
  });
});
