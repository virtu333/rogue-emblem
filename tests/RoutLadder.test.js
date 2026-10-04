// The rout reinforcement ladder (docs/specs/dusk-pressure.md §2a, engine/RoutLadder.js).
// Ways it can go wrong, one test each:
//   - the generated schedule drifts from the spec's table (turns, counts, levels, reward,
//     promoted wave), or reaches First Light, Black Sun, seize/escape or a `ladder: false` map;
//   - generating it moves the map itself (an extra RNG draw);
//   - a chokepoint flank keeps its waves, or a wave scatters over several edges;
//   - an arrival lands within 3 of a player, next to an NPC, on excluded terrain, or on a
//     tile its (promoted) class cannot stand on;
//   - the difficulty's turn offset, jitter or count bonus leaks into the ladder;
//   - arrivals copy the wrong level or class, or carry the wrong reward;
//   - a ladder wave hands par back, or a bandit wave stops doing so;
//   - waves still pending hold off a rout victory;
//   - a resume, a locked map or a save from before the ladder plays a different battle;
//   - the objective line misreports the next wave or names the wrong drawn edge.
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));

import { generateBattle } from '../src/engine/MapGenerator.js';
import { resolveDifficultyMode, validateDifficultyConfig } from '../src/engine/DifficultyEngine.js';
import { validateMapTemplatesConfig } from '../src/engine/MapTemplateEngine.js';
import { scheduleReinforcementsForTurn } from '../src/engine/ReinforcementScheduler.js';
import {
  buildRoutLadder,
  routLadderObjectiveLine,
  routLadderStatus,
} from '../src/engine/RoutLadder.js';
import { calculatePar } from '../src/engine/TurnBonusCalculator.js';
import { buildReinforcementSpawnSpec } from '../src/engine/ReinforcementSpawns.js';
import { createCaravanUnit } from '../src/engine/CaravanSystem.js';
import { CaravanController } from '../src/ui/CaravanController.js';
import { RunManager } from '../src/engine/RunManager.js';
import { HeadlessBattle, HEADLESS_STATES } from './harness/HeadlessBattle.js';
import { BattleScene } from '../src/scenes/BattleScene.js';
import { installSeed, restoreMathRandom } from '../sim/lib/SeededRNG.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const T = Object.fromEntries(data.terrain.map((t, i) => [t.name, i]));

afterEach(() => restoreMathRandom());

// The spec's table, written out by hand: [turn, min, max, +levels, promoted].
const LATE = [[3, 2, 2], [5, 2, 3, 1], [7, 2, 3, 1], [9, 3, 3, 2, true]]; // prettier-ignore
const SPEC = {
  dusk: {
    act1: [[4, 1, 1], [6, 1, 2]],
    act2: [[4, 1, 2], [6, 2, 2, 1], [8, 2, 3, 1]],
    act3: [[4, 2, 2], [6, 2, 2, 1], [8, 2, 3, 1], [10, 2, 3, 2]],
    act4: [[4, 2, 2], [6, 2, 3, 1], [8, 2, 3, 1], [10, 3, 3, 2]],
  },
  hard: {
    act1: [[4, 1, 2], [7, 1, 2, 1]],
    act2: [[3, 1, 2], [5, 2, 2, 1], [7, 2, 3, 1], [9, 2, 3, 2]],
    act3: LATE,
    act4: LATE,
    finalBoss: LATE,
  },
}; // prettier-ignore
const XP = [0.75, 0.5, 0.25, 0.1];

/** Battle params as RunManager.getBattleParams hands them over for a rung. */
function pacing(difficultyId) {
  const m = resolveDifficultyMode(data.difficulty, difficultyId).modifiers;
  return {
    difficultyId,
    routLadder: m.routLadder,
    parInflation: m.parInflation,
    templateWavesRaisePar: m.templateWavesRaisePar,
  };
}
/** The same params as a build without battle pacing passed them. */
function legacy(difficultyId) {
  return { difficultyId };
}

function gen(params, seed, gameData = data) {
  installSeed(seed);
  try {
    return generateBattle({ objective: 'rout', deployCount: 4, ...params }, gameData);
  } finally {
    restoreMathRandom();
  }
}

function harness(params, seed) {
  installSeed(seed);
  const battle = new HeadlessBattle(data, {
    objective: 'rout',
    battleSeed: 1000 + seed,
    deployCount: 4,
    ...params,
  });
  battle.init();
  restoreMathRandom();
  return battle;
}

describe('the ladder a rout map is generated with', () => {
  it('is the spec table on Dusk and Nightfall, for every act', () => {
    for (const [rung, acts] of Object.entries(SPEC)) {
      for (const [act, rows] of Object.entries(acts)) {
        for (const seed of [1, 2, 3]) {
          const ladder = gen({ act, ...pacing(rung) }, seed).reinforcements?.ladder;
          const label = `${rung} ${act} seed ${seed}`;
          expect(ladder, label).toBeTruthy();
          expect(
            ladder.waves.map((w) => [
              w.turn,
              w.count[0],
              w.count[1],
              w.levelBonus || 0,
              w.promoted === true,
            ]),
            label,
          ).toEqual(rows.map(([t, a, b, l = 0, p = false]) => [t, a, b, l, p]));
          expect(
            ladder.waves.map((w) => w.xpMultiplier),
            label,
          ).toEqual(XP.slice(0, rows.length));
          expect(ladder.waves[0].edge, label).toBe(ladder.front);
          for (const w of ladder.waves.slice(1))
            expect([...ladder.flanks, ladder.front], label).toContain(w.edge);
          expect(ladder.minPlayerDistance, label).toBe(3);
        }
      }
    }
  });

  it('replaces the template waves (no par-raising procedural waves left)', () => {
    for (const seed of [1, 2, 3, 4]) {
      const bc = gen({ act: 'act3', ...pacing('dusk') }, seed);
      expect(bc.reinforcements.waves).toEqual([]);
    }
  });

  it('never reaches First Light or Black Sun, seize or escape maps', () => {
    for (const seed of [1, 2, 3]) {
      for (const act of ['act1', 'act3']) {
        expect(gen({ act, ...pacing('normal') }, seed).reinforcements?.ladder).toBeUndefined();
        expect(gen({ act, ...pacing('lunatic') }, seed).reinforcements?.ladder).toBeUndefined();
      }
      for (const objective of ['seize', 'escape']) {
        const bc = gen({ act: 'act3', objective, ...pacing('hard') }, seed);
        expect(bc.reinforcements?.ladder, objective).toBeUndefined();
        expect(bc.reinforcements?.waves?.length, objective).toBeGreaterThan(0);
      }
    }
  });

  it('a `ladder: false` template keeps its own waves', () => {
    const optedOut = structuredClone(data);
    for (const t of optedOut.mapTemplates.rout) t.ladder = false;
    expect(validateMapTemplatesConfig(optedOut.mapTemplates).valid).toBe(true);
    const bc = gen({ act: 'act3', ...pacing('hard') }, 5, optedOut);
    expect(bc.reinforcements.ladder).toBeUndefined();
    expect(bc.reinforcements.waves.length).toBeGreaterThan(0);
    const bad = structuredClone(data.mapTemplates);
    bad.rout[0].ladder = true;
    expect(validateMapTemplatesConfig(bad).valid).toBe(false);
  });

  it('leaves the map itself untouched (same layout and spawns as without it)', () => {
    for (const seed of [1, 7, 19]) {
      for (const rung of ['dusk', 'hard']) {
        const withLadder = gen({ act: 'act2', ...pacing(rung) }, seed);
        const without = gen({ act: 'act2', ...legacy(rung) }, seed);
        expect(withLadder.mapLayout).toEqual(without.mapLayout);
        expect(withLadder.enemySpawns).toEqual(without.enemySpawns);
        expect(withLadder.playerSpawns).toEqual(without.playerSpawns);
      }
    }
  });

  it('First Light maps are generated exactly as before, par included', () => {
    for (const seed of [1, 2, 3, 4]) {
      for (const act of ['act1', 'act2', 'act3']) {
        const now = gen({ act, ...pacing('normal') }, seed);
        const before = gen({ act, ...legacy('normal') }, seed);
        const { parInflation, ...rest } = now;
        expect(rest).toEqual(before);
        expect(parInflation).toBe(3);
        const par = (bc) =>
          calculatePar(
            {
              cols: bc.cols,
              rows: bc.rows,
              enemyCount: bc.enemySpawns.length,
              objective: bc.objective,
              mapLayout: bc.mapLayout,
              terrainData: data.terrain,
              parBonus: bc.parBonus,
              parInflation: bc.parInflation,
            },
            data.turnBonus,
            'normal',
          );
        expect(par(now)).toBe(par(before));
      }
    }
  });

  it('stacks on a village map: the bandit wave stays, with its own reward', () => {
    let checked = 0;
    for (let seed = 1; seed <= 40 && checked < 3; seed++) {
      const bc = gen({ act: 'act2', hasVillage: true, ...pacing('dusk') }, seed);
      const bandits = (bc.reinforcements?.scriptedWaves || []).find((w) =>
        w.spawns?.some((s) => s.aiMode === 'seek_tile'),
      );
      if (!bc.villageTile || !bandits) continue;
      checked++;
      expect(bandits.turn).toBe(1);
      expect(bc.reinforcements.ladder.waves).toHaveLength(3);
    }
    expect(checked).toBe(3);
  });
});

describe('ladder edges', () => {
  // 10 x 8, players on the left, enemies on the right: front = right, flanks top/bottom.
  const open = () => Array.from({ length: 8 }, () => Array(10).fill(T.Plain));
  const players = [{ col: 1, row: 3 }, { col: 1, row: 4 }]; // prettier-ignore
  const enemies = [{ col: 8, row: 3 }, { col: 8, row: 5 }]; // prettier-ignore
  const ladderOn = (layout) =>
    buildRoutLadder({
      routLadder: data.difficulty.modes.dusk.routLadder,
      act: 'act3',
      playerSpawns: players,
      enemySpawns: enemies,
      mapLayout: layout,
      terrain: data.terrain,
    });

  it('wave 1 from the front, then alternating flanks', () => {
    const ladder = ladderOn(open());
    expect(ladder.front).toBe('right');
    expect([...ladder.flanks].sort()).toEqual(['bottom', 'top']);
    const [a, b] = ladder.flanks;
    expect(ladder.waves.map((w) => w.edge)).toEqual(['right', a, b, a]);
  });

  it('a chokepoint flank (fewer than 4 usable tiles) passes its waves on', () => {
    const walled = open();
    for (let col = 0; col < 10; col++) walled[0][col] = T.Wall;
    walled[0][4] = T.Plain;
    walled[0][5] = T.Plain;
    walled[0][6] = T.Plain; // three usable tiles on top
    expect(ladderOn(walled).waves.map((w) => w.edge)).toEqual([
      'right',
      'bottom',
      'bottom',
      'bottom',
    ]);
    for (let col = 0; col < 10; col++) walled[7][col] = T.Wall; // and none at the bottom
    expect(ladderOn(walled).waves.map((w) => w.edge)).toEqual(['right', 'right', 'right', 'right']);
  });
});

describe('where ladder arrivals land', () => {
  const W = 12;
  const H = 10;
  const ladderConfig = (waves, front = 'right') => ({
    waves: [],
    ladder: { front, flanks: ['top', 'bottom'], minPlayerDistance: 3, waves },
  });
  const run = (over = {}) =>
    scheduleReinforcementsForTurn({
      turn: 4,
      seed: 99,
      mapLayout: Array.from({ length: H }, () => Array(W).fill(T.Plain)),
      terrain: data.terrain,
      ...over,
    });
  const manhattan = (a, b) => Math.abs(a.col - b.col) + Math.abs(a.row - b.row);

  it('a wave takes its whole count from its one edge', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const { spawns, dueWaves, blockedSpawns } = run({
        seed,
        reinforcements: ladderConfig([{ turn: 4, count: [3, 3], edge: 'top', xpMultiplier: 1 }]),
      });
      expect(blockedSpawns).toBe(0);
      expect(dueWaves[0].requestedCount).toBe(3);
      expect(spawns.map((s) => s.edge)).toEqual(['top', 'top', 'top']);
      expect(
        spawns.every((s) => s.row === 0),
        `seed ${seed}`,
      ).toBe(true);
    }
  });

  it('rolls counts within the row, absolute: no turn offset, jitter or count bonus', () => {
    const seen = new Set();
    for (let seed = 1; seed <= 40; seed++) {
      const reinforcements = {
        ...ladderConfig([{ turn: 4, count: [2, 3], edge: 'top', xpMultiplier: 1 }]),
        difficultyScaling: true,
        turnOffsetByDifficulty: { hard: -2 },
        turnJitter: [-1, 1],
      };
      const opts = {
        seed,
        reinforcements,
        difficultyId: 'hard',
        difficultyTurnOffset: -1,
        enemyCountBonus: 3,
      };
      const due = run(opts);
      expect(due.spawns.length).toBeGreaterThanOrEqual(2);
      expect(due.spawns.length).toBeLessThanOrEqual(3);
      seen.add(due.spawns.length);
      for (const turn of [1, 2, 3, 5]) expect(run({ ...opts, turn }).spawns).toEqual([]);
    }
    expect([...seen].sort()).toEqual([2, 3]);
  });

  it('never within 3 of a player, next to an NPC, on excluded terrain or an unwalkable tile', () => {
    // Top edge: Mountain at 0 (Infantry may climb it, Cavalry may not), Lava Crack at 1,
    // a Ballista at 2, a Village at 9. The player at (6,1) covers columns 4-8 of the
    // edge; the NPC at (10,1) covers column 10.
    const layout = Array.from({ length: H }, () => Array(W).fill(T.Plain));
    layout[0][0] = T.Mountain;
    layout[0][1] = T['Lava Crack'];
    layout[0][2] = T.Ballista;
    layout[0][9] = T.Village;
    const playerTiles = [{ col: 6, row: 1 }];
    const npcTiles = [{ col: 10, row: 1 }];
    const tiles = { plain: new Set(), promoted: new Set() };
    for (const promoted of [false, true]) {
      const reinforcements = ladderConfig([
        { turn: 4, count: [2, 2], edge: 'top', promoted, xpMultiplier: 1 },
      ]);
      for (let seed = 1; seed <= 40; seed++) {
        const { spawns } = run({
          seed,
          reinforcements,
          mapLayout: layout,
          playerTiles,
          npcTiles,
          moveTypes: ['Infantry'],
          promotedMoveTypes: ['Cavalry'],
        });
        for (const s of spawns) {
          const name = data.terrain[layout[s.row][s.col]].name;
          expect(['Lava Crack', 'Ballista', 'Village'], `seed ${seed}`).not.toContain(name);
          for (const p of playerTiles) expect(manhattan(s, p)).toBeGreaterThan(3);
          for (const n of npcTiles) expect(manhattan(s, n)).toBeGreaterThan(1);
          if (s.edge === 'top') tiles[promoted ? 'promoted' : 'plain'].add(s.col);
        }
      }
    }
    // Infantry copies may take the Mountain; a promoted (Cavalry) wave never does.
    expect([...tiles.plain].sort((a, b) => a - b)).toEqual([0, 3, 11]);
    expect([...tiles.promoted].sort((a, b) => a - b)).toEqual([3, 11]);
  });

  it('an edge the exclusions empty falls back to the front; the rest is blocked', () => {
    // A player in the middle of the top edge covers all of it on a 7-wide map.
    const layout = Array.from({ length: H }, () => Array(7).fill(T.Plain));
    const reinforcements = ladderConfig([{ turn: 4, count: [2, 2], edge: 'top', xpMultiplier: 1 }]);
    const toFront = run({ reinforcements, mapLayout: layout, playerTiles: [{ col: 3, row: 0 }] });
    expect(toFront.spawns.map((s) => s.edge)).toEqual(['right', 'right']);
    const blocked = run({
      reinforcements,
      mapLayout: layout,
      playerTiles: [
        { col: 3, row: 0 },
        { col: 6, row: 2 },
        { col: 6, row: 7 },
      ],
    });
    expect(blocked.spawns).toEqual([]);
    expect(blocked.blockedSpawns).toBe(2);
  });

  it('a flank with one free tile keeps its whole wave: one edge, the rest blocked', () => {
    // A player at (2,0) covers columns 0-5 of the top edge of a 7-wide map: column 6 is
    // the flank's only free tile. The wave never splits between the flank and the front.
    const layout = Array.from({ length: H }, () => Array(7).fill(T.Plain));
    const reinforcements = ladderConfig([{ turn: 4, count: [3, 3], edge: 'top', xpMultiplier: 1 }]);
    for (let seed = 1; seed <= 10; seed++) {
      const r = run({ seed, reinforcements, mapLayout: layout, playerTiles: [{ col: 2, row: 0 }] });
      expect(r.spawns.map((s) => [s.edge, s.col, s.row])).toEqual([['top', 6, 0]]);
      expect(r.blockedSpawns).toBe(2);
    }
  });

  it('the objective line names every edge a wave can come from', () => {
    // Wherever the units stand, the arrivals come from an edge the line named.
    const layout = Array.from({ length: H }, () => Array(7).fill(T.Plain));
    const reinforcements = ladderConfig([{ turn: 4, count: [2, 2], edge: 'top', xpMultiplier: 1 }]);
    const status = routLadderStatus(reinforcements, { resolvedThroughTurn: 3 });
    expect(routLadderObjectiveLine(status)).toBe(
      'Reinforcements 0/1 · T4: up to 2, top or right edge',
    );
    const named = [status.next.edge, status.next.fallback];
    for (const playerTiles of [
      [],
      [{ col: 3, row: 0 }],
      [{ col: 2, row: 0 }],
      [{ col: 6, row: 4 }],
    ]) {
      for (const s of run({ reinforcements, mapLayout: layout, playerTiles }).spawns)
        expect(named).toContain(s.edge);
    }
    // A front wave has nowhere else to go: one edge named.
    const front = ladderConfig([{ turn: 4, count: [2, 2], edge: 'right', xpMultiplier: 1 }]);
    expect(routLadderObjectiveLine(routLadderStatus(front, { resolvedThroughTurn: 3 }))).toBe(
      'Reinforcements 0/1 · T4: up to 2, right edge',
    );
  });
});

describe('ladder arrivals in a battle (headless harness, as the scene)', () => {
  // Each arrival with the spawn spec it was built from (spec.level is the copied level
  // plus the bonus; a promoted unit's own level counts from its promotion).
  const arrivalsByTurn = (battle, turns = 12) => {
    const out = [];
    const build = battle._buildReinforcementSpawnSpec.bind(battle);
    const specs = new Map();
    battle._buildReinforcementSpawnSpec = (spawn, i) => {
      const spec = build(spawn, i);
      if (spec) specs.set(`${spec.col},${spec.row}`, spec);
      return spec;
    };
    for (let turn = 1; turn <= turns; turn++) {
      const before = new Set(battle.enemyUnits);
      battle._applyReinforcementsForTurn(turn);
      for (const u of battle.enemyUnits.filter((e) => !before.has(e))) {
        const spec = specs.get(`${u.col},${u.row}`);
        out.push({ turn, className: u.className, level: spec.level, col: u.col, row: u.row, u });
      }
    }
    return out;
  };

  it('arrive on the spec turns, at the copied level plus the wave bonus, with its reward', () => {
    for (const seed of [1, 2, 3]) {
      const battle = harness({ act: 'act3', ...pacing('dusk') }, seed);
      const templates = battle.battleConfig.enemySpawns.filter((s) => !s.isBoss);
      const arrivals = arrivalsByTurn(battle);
      expect(arrivals.length).toBeGreaterThan(0);
      const rows = SPEC.dusk.act3;
      for (const a of arrivals) {
        const i = rows.findIndex(([t]) => t === a.turn);
        expect(i, `seed ${seed} turn ${a.turn}`).toBeGreaterThanOrEqual(0);
        const bonus = rows[i][3] || 0;
        expect(
          templates.some((s) => s.className === a.className && s.level + bonus === a.level),
          `seed ${seed}: ${a.className} L${a.level} on turn ${a.turn}`,
        ).toBe(true);
        expect(a.u._reinforcementRewardMultiplier).toBe(XP[i]);
      }
      for (const [turn, , max] of rows)
        expect(arrivals.filter((a) => a.turn === turn).length).toBeLessThanOrEqual(max);
    }
  });

  it("Nightfall's fourth wave from Act III is promoted classes from the act pool", () => {
    const promotedPool = new Set(data.enemies.pools.act3.promoted);
    let seen = 0;
    for (const seed of [1, 2, 3]) {
      const battle = harness({ act: 'act3', ...pacing('hard') }, seed);
      for (const a of arrivalsByTurn(battle)) {
        const tier = data.classes.find((c) => c.name === a.className)?.tier;
        if (a.turn === 9) {
          seen++;
          expect(promotedPool.has(a.className), a.className).toBe(true);
          expect(tier).toBe('promoted');
          expect(a.u.weapon?.name).toBeTruthy();
        }
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('a promoted arrival keeps only the copied affixes its new class may carry', () => {
    // affixes.json class_exclude: no haste on Paladins or Falcon Knights, no teleporter
    // on Knights or Generals. Every other class keeps the copied affix.
    const excluded = { haste: ['Paladin', 'Falcon Knight'], teleporter: ['General'] };
    for (const [affix, banned] of Object.entries(excluded)) {
      const classes = { banned: 0, kept: 0 };
      for (let seed = 1; seed <= 300; seed++) {
        const spec = buildReinforcementSpawnSpec({
          scheduledSpawn: { col: seed % 13, row: seed % 7, waveIndex: 3, promoted: true },
          seed,
          templates: [{ className: 'Fighter', level: 14, affixes: [affix] }],
          battleConfig: { enemySpawns: [] },
          battleParams: { act: 'act4', difficultyId: 'hard' },
          gameData: data,
        });
        expect(data.enemies.pools.act4.promoted).toContain(spec.className);
        if (banned.includes(spec.className)) {
          classes.banned++;
          expect(spec.affixes, `${spec.className} seed ${seed}`).not.toContain(affix);
        } else {
          classes.kept++;
          expect(spec.affixes, `${spec.className} seed ${seed}`).toContain(affix);
        }
      }
      expect(classes.banned, affix).toBeGreaterThan(0);
      expect(classes.kept, affix).toBeGreaterThan(0);
    }
  });

  it('a ladder wave leaves par alone; a village bandit wave still adds one', () => {
    const battle = harness({ act: 'act2', ...pacing('dusk') }, 4);
    const par = battle.turnPar;
    const res = battle._applyReinforcementsForTurn(4);
    expect(res.spawned).toBeGreaterThan(0);
    expect(battle.turnPar).toBe(par);

    let village = null;
    for (let seed = 1; seed <= 40 && !village; seed++) {
      const b = harness({ act: 'act2', hasVillage: true, ...pacing('dusk') }, seed);
      if (b.battleConfig.villageTile && b.battleConfig.reinforcements?.scriptedWaves?.length)
        village = b;
    }
    expect(village).toBeTruthy();
    const villagePar = village.turnPar;
    expect(village._applyReinforcementsForTurn(1).spawned).toBeGreaterThan(0);
    expect(village.turnPar).toBe(villagePar + 1);
    village._applyReinforcementsForTurn(4);
    expect(village.turnPar).toBe(villagePar + 1);
  });

  it("Black Sun's template waves keep coming but no longer raise par", () => {
    let checked = 0;
    for (let seed = 1; seed <= 12 && checked < 2; seed++) {
      const battle = harness({ act: 'act3', ...pacing('lunatic') }, seed);
      const par = battle.turnPar;
      let arrived = 0;
      for (let turn = 1; turn <= 12; turn++)
        arrived += battle._applyReinforcementsForTurn(turn).spawned;
      if (arrived === 0) continue;
      checked++;
      expect(battle.turnPar).toBe(par);
    }
    expect(checked).toBe(2);
    // A Black Sun map generated before (no flag) still raises par, as it did.
    const old = harness({ act: 'act3', ...legacy('lunatic') }, 1);
    const oldPar = old.turnPar;
    let waves = 0;
    for (let turn = 1; turn <= 12; turn++)
      waves += old
        ._applyReinforcementsForTurn(turn)
        .dueWaves.filter((w) => w.spawnedCount > 0).length;
    expect(old.turnPar).toBe(oldPar + waves);
  });

  it('clearing the field wins at once; the waves still due never come', () => {
    const battle = harness({ act: 'act2', ...pacing('dusk') }, 6);
    battle._applyReinforcementsForTurn(4);
    battle.turnManager.turnNumber = 5;
    const killer = battle.playerUnits[0];
    for (const enemy of [...battle.enemyUnits]) battle._removeUnit(enemy, { killer });
    battle._zombieTombstones = []; // any remains smashed too
    battle._checkBattleEnd();
    expect(battle.result).toBe('victory');
    expect(battle.battleState).toBe(HEADLESS_STATES.BATTLE_END);
    expect(battle.enemyUnits).toEqual([]);
  });

  // The victory rule is unchanged: a field cleared during an enemy phase waits for that
  // phase's reinforcements, so a wave due the same turn still arrives and the battle goes
  // on. A clear in a phase with no wave due wins at the end of that phase.
  it('a field cleared in the enemy phase still meets a wave due that turn', async () => {
    const clearInEnemyPhase = async (turn) => {
      const battle = harness({ act: 'act2', ...pacing('dusk') }, 6);
      const killer = battle.playerUnits[0];
      battle.turnManager.turnNumber = turn;
      battle.turnManager.currentPhase = 'enemy';
      // The enemy phase ends with every enemy fallen (on counters, say).
      battle.aiController.processEnemyPhase = async () => {
        for (const enemy of [...battle.enemyUnits]) battle._removeUnit(enemy, { killer });
        battle._zombieTombstones = [];
        battle._checkBattleEnd();
      };
      await battle._processEnemyPhase();
      return battle;
    };
    const due = await clearInEnemyPhase(4); // Dusk Act II: a wave at the end of T4
    expect(due.result).toBeNull();
    expect(due.enemyUnits.length).toBeGreaterThan(0);
    expect(due.enemyUnits.every((u) => u._isReinforcement)).toBe(true);
    expect(due.turnManager.turnNumber).toBe(5);
    const quiet = await clearInEnemyPhase(5); // no wave due at the end of T5
    expect(quiet.result).toBe('victory');
    expect(quiet.enemyUnits).toEqual([]);
  });

  it('the scene holds a rout victory the same way while the phase still owes its wave', () => {
    const scene = new BattleScene();
    Object.assign(scene, {
      battleState: 'ENEMY_PHASE',
      battleConfig: { objective: 'rout', reinforcements: { ladder: { waves: [] } } },
      playerUnits: [{ name: 'Edric', isCommander: true, currentHP: 10, faction: 'player' }],
      enemyUnits: [],
      escapedUnits: [],
      _reinforcementsPendingThisTurn: true,
    });
    scene.onVictory = vi.fn();
    expect(scene.checkBattleEnd()).toBe(false);
    expect(scene.onVictory).not.toHaveBeenCalled();
    scene._reinforcementsPendingThisTurn = false;
    expect(scene.checkBattleEnd()).toBe(true);
    expect(scene.onVictory).toHaveBeenCalledTimes(1);
  });

  it('a replay of the same battle brings the same arrivals', () => {
    const trace = (battle) =>
      arrivalsByTurn(battle).map(({ turn, className, level, col, row }) => ({
        turn,
        className,
        level,
        col,
        row,
      }));
    const a = trace(harness({ act: 'act3', ...pacing('hard') }, 8));
    const b = trace(harness({ act: 'act3', ...pacing('hard') }, 8));
    expect(a.length).toBeGreaterThan(0);
    expect(b).toEqual(a);
  });
});

describe('the scene and the harness resolve arrivals with the same code', () => {
  it('same ladder, units and seed: same tiles, same enemies', () => {
    for (const [rung, act, seed] of [
      ['dusk', 'act3', 2],
      ['hard', 'act3', 3],
      ['hard', 'act2', 5],
    ]) {
      const battle = harness({ act, ...pacing(rung) }, seed);
      const scene = new BattleScene();
      Object.assign(scene, {
        battleConfig: battle.battleConfig,
        battleParams: battle.battleParams,
        gameData: data,
        playerUnits: battle.playerUnits,
        enemyUnits: battle.enemyUnits,
        npcUnits: battle.npcUnits,
      });
      for (let turn = 1; turn <= 10; turn++) {
        const a = scene.resolveReinforcementsForTurn(turn);
        const b = battle._resolveReinforcementsForTurn(turn);
        expect(a, `${rung} ${act} turn ${turn}`).toEqual(b);
        a.spawns.forEach((spawn, i) =>
          expect(scene.buildReinforcementSpawnSpec(spawn, i)).toEqual(
            battle._buildReinforcementSpawnSpec(spawn, i),
          ),
        );
      }
    }
  });
});

describe('caravan maps: the harness fields the merchant as the scene does', () => {
  function caravanBattle() {
    for (let seed = 1; seed <= 60; seed++) {
      const battle = harness({ act: 'act2', hasCaravan: true, ...pacing('dusk') }, seed);
      if (battle.battleConfig.caravanSpawn) return battle;
    }
    throw new Error('no seed placed a caravan');
  }

  it('spawns the caravan into the NPCs, as CaravanController.spawnIfConfigured', () => {
    const battle = caravanBattle();
    const caravans = battle.npcUnits.filter((u) => u.isCaravan);
    expect(caravans).toHaveLength(1);
    expect(caravans[0]).toMatchObject(createCaravanUnit('act2', battle.battleConfig.caravanSpawn));
  });

  it('steps and exits on the same turns as CaravanController.stepTurn', () => {
    const battle = caravanBattle();
    const scene = {
      _caravanExited: false,
      playerUnits: structuredClone(battle.playerUnits),
      enemyUnits: structuredClone(battle.enemyUnits),
      npcUnits: structuredClone(battle.npcUnits),
      grid: { ...battle.grid, gridToPixel: () => ({ x: 0, y: 0 }) },
      removeUnitGraphic() {},
    };
    const ctrl = new CaravanController(scene);
    const where = (units) => units.filter((u) => u.isCaravan).map((u) => [u.col, u.row]);
    let exitedOn = null;
    for (let turn = 1; turn <= 30 && exitedOn == null; turn++) {
      ctrl.stepTurn();
      battle._stepCaravan();
      expect(where(battle.npcUnits), `turn ${turn}`).toEqual(where(scene.npcUnits));
      expect(battle._caravanExited, `turn ${turn}`).toBe(scene._caravanExited);
      if (battle._caravanExited) exitedOn = turn;
    }
    expect(exitedOn).not.toBeNull();
  });

  it('ladder arrivals keep off the tiles next to the caravan', () => {
    let checked = 0;
    for (let seed = 1; seed <= 60 && checked < 4; seed++) {
      const battle = harness({ act: 'act2', hasCaravan: true, ...pacing('dusk') }, seed);
      const caravan = battle.npcUnits.find((u) => u.isCaravan);
      if (!caravan) continue;
      // Park the caravan on the front edge, mid-way, where wave 1 lands.
      const { front } = battle.battleConfig.reinforcements.ladder;
      const { cols, rows } = battle.battleConfig;
      const tiles = [];
      for (let i = 0; i < (front === 'left' || front === 'right' ? rows : cols); i++)
        tiles.push(
          front === 'left' ? { col: 0, row: i } : front === 'right' ? { col: cols - 1, row: i }
          : front === 'top' ? { col: i, row: 0 } : { col: i, row: rows - 1 }, // prettier-ignore
        );
      const free = tiles.filter((t) => !battle.getUnitAt(t.col, t.row));
      Object.assign(caravan, free[Math.floor(free.length / 2)]);
      const firstTurn = battle.battleConfig.reinforcements.ladder.waves[0].turn;
      const { spawns } = battle._resolveReinforcementsForTurn(firstTurn);
      for (const s of spawns)
        expect(Math.abs(s.col - caravan.col) + Math.abs(s.row - caravan.row)).toBeGreaterThan(1);
      checked++;
    }
    expect(checked).toBe(4);
  });
});

describe('locked maps and saves', () => {
  it('a Dusk run hands the ladder and inflation 2 to its maps; the lock keeps them', () => {
    const rm = new RunManager(data);
    rm.startRun({ difficultyId: 'dusk', applyBlessingsAtStart: false });
    rm.completedBattles = 1;
    const node = rm.nodeMap.nodes.find((n) => n.battleParams?.objective === 'rout');
    const params = rm.getBattleParams(node);
    expect(params.routLadder).toEqual(data.difficulty.modes.dusk.routLadder);
    expect(params.parInflation).toBe(2);
    const bc = gen({ ...params, deployCount: 4 }, 3);
    expect(bc.parInflation).toBe(2);
    rm.lockBattleConfig(node.id, bc);
    const restored = RunManager.fromJSON(JSON.parse(JSON.stringify(rm.toJSON())), data);
    const locked = restored.getLockedBattleConfig(node.id);
    expect(locked.reinforcements.ladder).toEqual(bc.reinforcements.ladder);
    expect(locked.parInflation).toBe(2);
  });

  it('a Dusk run saved before the ladder keeps its old pacing on new and locked maps', () => {
    const rm = new RunManager(data);
    rm.startRun({ difficultyId: 'dusk', applyBlessingsAtStart: false });
    rm.completedBattles = 1;
    const node = rm.nodeMap.nodes.find((n) => n.battleParams?.objective === 'rout');
    const saved = JSON.parse(JSON.stringify(rm.toJSON()));
    for (const key of ['routLadder', 'parInflation', 'templateWavesRaisePar'])
      delete saved.difficultyModifiers[key];
    const restored = RunManager.fromJSON(saved, data);
    const params = restored.getBattleParams(node);
    expect(params.routLadder).toBeNull();
    expect(params.parInflation).toBeUndefined();
    const bc = gen({ ...params, act: 'act3', deployCount: 4 }, 3);
    expect(bc.reinforcements?.ladder).toBeUndefined();
    expect(bc.parInflation).toBeUndefined();
    // Par for a map without a locked inflation: turnBonus.parInflation (3), as before.
    const mapParams = {
      cols: 10,
      rows: 10,
      enemyCount: 6,
      objective: 'rout',
      mapLayout: [],
      terrainData: data.terrain,
    };
    const legacyPar = calculatePar(mapParams, data.turnBonus, 'dusk');
    expect(calculatePar({ ...mapParams, parInflation: 2 }, data.turnBonus, 'dusk')).toBe(
      legacyPar - 1,
    );
    expect(calculatePar({ ...mapParams, parInflation: undefined }, data.turnBonus, 'dusk')).toBe(
      legacyPar,
    );
  });

  it('difficulty data: every rung has an inflation, the ladders validate, bad shapes do not', () => {
    expect(validateDifficultyConfig(data.difficulty)).toEqual({ valid: true, errors: [] });
    const m = data.difficulty.modes;
    expect([m.normal, m.dusk, m.hard, m.lunatic].map((x) => x.parInflation)).toEqual([3, 2, 3, 3]);
    expect([m.normal.routLadder, m.lunatic.routLadder]).toEqual([null, null]);
    expect(m.lunatic.templateWavesRaisePar).toBe(false);
    const bad = structuredClone(data.difficulty);
    bad.modes.dusk.routLadder.acts.act1 = [
      { turn: 6, count: [1, 1] },
      { turn: 4, count: [2, 1] },
    ];
    bad.modes.hard.parInflation = -1;
    const errors = validateDifficultyConfig(bad).errors.join('\n');
    expect(errors).toMatch(/dusk\.routLadder\.acts\.act1\[1\]\.turn/);
    expect(errors).toMatch(/dusk\.routLadder\.acts\.act1\[1\]\.count/);
    expect(errors).toMatch(/hard\.parInflation/);
  });
});

describe('the objective line', () => {
  const reinforcements = {
    ladder: {
      front: 'right',
      waves: [
        { turn: 4, count: [1, 2], edge: 'right' },
        { turn: 6, count: [2, 3], edge: 'top' },
      ],
    },
  };

  it('names the waves resolved, the next turn, its most arrivals and its edge', () => {
    const line = (through) =>
      routLadderObjectiveLine(routLadderStatus(reinforcements, { resolvedThroughTurn: through }));
    expect(line(0)).toBe('Reinforcements 0/2 · T4: up to 2, right edge');
    expect(line(4)).toBe('Reinforcements 1/2 · T6: up to 3, top or right edge');
    expect(line(6)).toBe('Reinforcements 2/2 · no more waves');
    expect(routLadderStatus({ waves: [] })).toBeNull();
  });

  function scene({ turn, phase, rotation = 'none', resolvedTurn = 0 }) {
    const s = new BattleScene();
    s.battleConfig = { objective: 'rout', reinforcements };
    s.turnManager = { turnNumber: turn, currentPhase: phase };
    s.grid = { board: { rotation } };
    s.enemyUnits = [{}, {}];
    s.npcUnits = [];
    s._ladderResolvedTurn = resolvedTurn;
    s.objectiveText = { text: '', setText(t) { this.text = t; }, setColor() {} }; // prettier-ignore
    return s;
  }

  it('the scene shows it on the rout line, in the edges the player sees', () => {
    const before = scene({ turn: 4, phase: 'player' });
    before.updateObjectiveText();
    expect(before.objectiveText.text).toBe(
      'Rout: 2 enemies remaining\nReinforcements 0/2 · T4: up to 2, right edge',
    );
    // The enemy phase of turn 4 resolved its wave: the line moves on at once.
    const after = scene({ turn: 4, phase: 'enemy', resolvedTurn: 4 });
    expect(after.getLadderObjectiveLine()).toBe(
      'Reinforcements 1/2 · T6: up to 3, top or right edge',
    );
    // Upright (portrait) boards are turned: 'ccw' draws the grid's top edge on the left
    // and its right edge at the top; 'cw' draws them on the right and at the bottom.
    const upright = scene({ turn: 5, phase: 'player', rotation: 'ccw' });
    expect(upright.getLadderObjectiveLine()).toBe(
      'Reinforcements 1/2 · T6: up to 3, left or top edge',
    );
    const cw = scene({ turn: 5, phase: 'player', rotation: 'cw' });
    expect(cw.getLadderObjectiveLine()).toBe(
      'Reinforcements 1/2 · T6: up to 3, right or bottom edge',
    );
    // A rewind back into turn 4's player phase does not count turn 4 as resolved.
    const rewound = scene({ turn: 4, phase: 'player', resolvedTurn: 4 });
    expect(rewound.getLadderObjectiveLine()).toBe('Reinforcements 0/2 · T4: up to 2, right edge');
  });
});
