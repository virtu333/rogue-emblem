// Formations and the opening (engine/EnemyFormations.js, engine/EngagementScan.js,
// docs/specs/map-variety.md "Formations and the opening"). Ways it can go wrong, one test each:
//   - the scan calls a foe struck or answered when it is not (a wrong reach, a guard that never
//     stirs counted as an answer, the army walking through foes);
//   - the opening's cover leaves a lone foe where it was, moves it out of its zone, or draws;
//   - a strongpoint scatters, seats its captain anywhere but the best cover, or puts its bows in
//     front of its blades; a screen stands in a knot, not across the army's way; a pincer's wings
//     merge or leave a wing of one;
//   - a formation takes a draw from anywhere but the stream it is given;
//   - a shipped formation map leaves a foe the army can strike on turn 1 with nobody to answer
//     for it (Dave's free pick), or a group member alone.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadGameData } from './testData.js';
import { generateBattle } from '../src/engine/MapGenerator.js';
import { installSeed, restoreMathRandom } from '../sim/lib/SeededRNG.js';
import { DEPLOY_LIMITS } from '../src/utils/constants.js';
import {
  FORMATION_REACH,
  MIN_OPENING_SUPPORT,
  coverOpening,
  placeFormation,
} from '../src/engine/EnemyFormations.js';
import { scanOpening } from '../src/engine/EngagementScan.js';
import { HOLD_PACK_RADIUS } from '../src/engine/HoldActivation.js';

const data = loadGameData();
const PLAIN = data.terrain.findIndex((t) => t.name === 'Plain');
const plainMap = (cols, rows) => Array.from({ length: rows }, () => new Array(cols).fill(PLAIN));
const manhattan = (a, b) => Math.abs(a.col - b.col) + Math.abs(a.row - b.row);

afterEach(() => vi.restoreAllMocks());

/** A 10x5 plain field, the army at (0,2), in Act II: foot move 4 and strike 1-2, riders 5 and 1. */
function field(spawns) {
  return {
    mapLayout: plainMap(10, 5),
    terrainData: data.terrain,
    classes: data.classes,
    spawns,
    playerSpawns: [{ col: 0, row: 2 }],
    act: 'act2',
  };
}

describe('the opening scan', () => {
  it('finds who the army can strike on turn 1, and who can answer for them', () => {
    // A at (6,2): a rider reaches (5,2) (5 steps) and strikes it at 1; the foot reaches (4,2)
    // and strikes at 2. B, a Fighter at (9,2) (move 4, axes 1), can stand on (5,2) to strike
    // (4,2) and on (6,2) to strike (5,2): one answer from either tile. C at (9,4) needs 6 steps
    // to stand next to either tile: no answer. B itself stands 7 from the army: out of reach.
    const a = { className: 'Fighter', col: 6, row: 2 };
    const b = { className: 'Fighter', col: 9, row: 2 };
    const c = { className: 'Fighter', col: 9, row: 4 };
    const { foes } = scanOpening(field([a, b, c]));
    expect(foes[0]).toMatchObject({ exposed: true, support: 1 });
    expect(foes[1]).toMatchObject({ exposed: false, support: null });
    expect(foes[2]).toMatchObject({ exposed: false, support: null });
  });

  it('counts a guard only when the striker stands within 3 of its post', () => {
    // The guard at (9,2) stands 5 from (4,2) and 4 from (5,2): it never stirs.
    const a = { className: 'Fighter', col: 6, row: 2 };
    const b = { className: 'Fighter', col: 9, row: 2, aiMode: 'guard' };
    expect(scanOpening(field([a, b])).foes[0].support).toBe(0);
    // Moved to (7,2) it stands 3 from (4,2) and 2 from (5,2), and reaches both.
    expect(scanOpening(field([a, { ...b, col: 7 }])).foes[0].support).toBe(1);
  });

  it('never walks the army through a foe', () => {
    // A wall of foes across the field at column 3: nobody reaches column 4 on foot or horse, so
    // the foe at (6,2) cannot be struck; the wall itself can.
    const wall = [0, 1, 2, 3, 4].map((row) => ({ className: 'Knight', col: 3, row }));
    const { foes } = scanOpening(field([...wall, { className: 'Fighter', col: 6, row: 2 }]));
    expect(foes[5].exposed).toBe(false);
    expect(foes[2].exposed).toBe(true);
  });
});

describe("the opening's cover", () => {
  it('moves a lone foe out of reach, beside its group, inside its zone, with no draw', () => {
    const random = vi.spyOn(Math, 'random');
    const a = { className: 'Fighter', col: 6, row: 2, templateGroup: 'g' };
    const b = { className: 'Fighter', col: 9, row: 2, templateGroup: 'g', aiMode: 'guard' };
    const zone = [];
    for (let row = 0; row < 5; row++) for (let col = 6; col < 10; col++) zone.push({ col, row });
    const moved = coverOpening({
      spawns: [a, b],
      tilesFor: () => zone,
      standScore: () => 1,
      scan: field([]),
    });
    expect(moved).toBe(1);
    // (8,2), (9,1) and (9,3) stand beside B and out of the army's reach; (8,2) is the nearest
    // to where A stood.
    expect(a).toMatchObject({ col: 8, row: 2 });
    expect(b).toMatchObject({ col: 9, row: 2 });
    expect(random).not.toHaveBeenCalled();
    const { foes } = scanOpening(field([a, b]));
    expect(foes.every((f) => !f.exposed || f.support >= MIN_OPENING_SUPPORT)).toBe(true);
  });

  it('leaves a foe that no tile of its zone can cover, and never moves one with no zone', () => {
    const a = { className: 'Fighter', col: 6, row: 2, templateGroup: 'g' };
    const boss = { className: 'Fighter', col: 5, row: 0, isBoss: true };
    const moved = coverOpening({
      spawns: [a, boss],
      tilesFor: (i) => (i === 0 ? [{ col: 6, row: 2 }] : null),
      standScore: () => 1,
      scan: field([]),
    });
    expect(moved).toBe(0);
    expect(a).toMatchObject({ col: 6, row: 2 });
    expect(boss).toMatchObject({ col: 5, row: 0 });
  });
});

/** A seeded stream for the formation's own picks. */
function stream(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function zoneTiles(c0, c1, r0, r1) {
  const out = [];
  for (let row = r0; row < r1; row++) for (let col = c0; col < c1; col++) out.push({ col, row });
  return out;
}

const WEST = { dc: -1, dr: 0 };
const linked = (tiles, reach) =>
  tiles.every((t, i) => tiles.some((u, j) => j !== i && manhattan(t, u) <= reach));
const meanCol = (tiles) => tiles.reduce((s, t) => s + t.col, 0) / tiles.length;

describe('formations', () => {
  it('a strongpoint knots on the best cover, the captain there, blades toward the army', () => {
    const tiles = zoneTiles(10, 18, 0, 10);
    const fort = { col: 14, row: 5 };
    const members = [
      { back: true },
      { back: false },
      { back: false, core: true },
      { back: true },
      { back: false },
    ];
    for (let seed = 1; seed <= 30; seed++) {
      const placed = placeFormation({
        formation: 'strongpoint',
        members,
        tiles,
        standScore: () => 1,
        cover: (t) => (t.col === fort.col && t.row === fort.row ? 10 : 0),
        facing: WEST,
        random: stream(seed),
      });
      expect(placed.every(Boolean)).toBe(true);
      expect(new Set(placed.map((t) => `${t.col},${t.row}`)).size).toBe(5);
      expect(linked(placed, FORMATION_REACH)).toBe(true);
      expect(placed.every((t) => manhattan(t, placed[2]) <= FORMATION_REACH + 1)).toBe(true);
      // The army is west: the blades stand west of the bows.
      const front = placed.filter((_, i) => !members[i].back);
      const back = placed.filter((_, i) => members[i].back);
      expect(meanCol(front)).toBeLessThan(meanCol(back));
    }
    // The heart's pick is the best of three, weighted 3:2:1: a first roll seats the captain on
    // the fort.
    const best = placeFormation({
      formation: 'strongpoint',
      members,
      tiles,
      standScore: () => 1,
      cover: (t) => (t.col === fort.col && t.row === fort.row ? 10 : 0),
      facing: WEST,
      random: () => 0,
    });
    expect(best[2]).toEqual(fort);
  });

  it('a strongpoint around a heart rings it, no side favoured', () => {
    const heart = { col: 14, row: 5 };
    const tiles = zoneTiles(10, 18, 0, 10).filter((t) => manhattan(t, heart) > 0);
    for (let seed = 1; seed <= 20; seed++) {
      const placed = placeFormation({
        formation: 'strongpoint',
        members: [{ back: false }, { back: false }, { back: true }, { back: false }],
        tiles,
        standScore: () => 1,
        cover: () => 0,
        facing: WEST,
        random: stream(seed),
        heart,
      });
      expect(manhattan(placed[0], heart)).toBe(1);
      expect(placed.every((t) => manhattan(t, heart) <= FORMATION_REACH + 2)).toBe(true);
    }
  });

  it("a screen stands across the army's way at the front of its zone, the back line behind", () => {
    const tiles = zoneTiles(10, 18, 0, 13);
    const members = [
      { back: false },
      { back: false },
      { back: false },
      { back: true },
      { back: true },
    ];
    for (let seed = 1; seed <= 30; seed++) {
      const placed = placeFormation({
        formation: 'screen',
        members,
        tiles,
        standScore: () => 1,
        cover: () => 0,
        facing: WEST,
        random: stream(seed),
      });
      const front = placed.filter((_, i) => !members[i].back);
      const back = placed.filter((_, i) => members[i].back);
      // Across: the line's columns within one of each other, its rows spread two apart.
      const cols = front.map((t) => t.col);
      expect(Math.max(...cols) - Math.min(...cols)).toBeLessThanOrEqual(2);
      const rows = front.map((t) => t.row).sort((x, y) => x - y);
      expect(rows.at(-1) - rows[0]).toBeGreaterThanOrEqual(3);
      // At the front of the zone (its western part) and the bows behind it.
      expect(Math.min(...cols)).toBeLessThanOrEqual(13);
      expect(meanCol(back)).toBeGreaterThan(meanCol(front));
      expect(linked(placed, FORMATION_REACH)).toBe(true);
    }
  });

  it('a pincer stands two wings at the ends of its zone, each with company', () => {
    const tiles = zoneTiles(14, 20, 0, 13);
    const members = Array.from({ length: 6 }, (_, i) => ({ back: i >= 4 }));
    for (let seed = 1; seed <= 30; seed++) {
      const placed = placeFormation({
        formation: 'pincer',
        members,
        tiles,
        standScore: () => 1,
        cover: () => 0,
        facing: WEST,
        random: stream(seed),
      });
      const top = placed.filter((t) => t.row < 6);
      const bottom = placed.filter((t) => t.row > 6);
      expect(top.length).toBeGreaterThanOrEqual(2);
      expect(bottom.length).toBeGreaterThanOrEqual(2);
      expect(top.length + bottom.length).toBe(6);
      expect(linked(top, FORMATION_REACH)).toBe(true);
      expect(linked(bottom, FORMATION_REACH)).toBe(true);
      const gap = Math.min(...top.flatMap((t) => bottom.map((u) => manhattan(t, u))));
      expect(gap).toBeGreaterThanOrEqual(4);
    }
  });

  it('draws only from the stream it is given, the same picks for the same stream', () => {
    const random = vi.spyOn(Math, 'random');
    const args = {
      members: [{ back: false }, { back: true }, { back: false }, { back: false }],
      tiles: zoneTiles(10, 18, 0, 10),
      standScore: (t) => 1 + ((t.col * 7 + t.row) % 3),
      cover: (t) => (t.col + t.row) % 4,
      facing: WEST,
    };
    for (const formation of ['strongpoint', 'screen', 'pincer']) {
      const a = placeFormation({ ...args, formation, random: stream(7) });
      const b = placeFormation({ ...args, formation, random: stream(7) });
      expect(a).toEqual(b);
    }
    expect(random).not.toHaveBeenCalled();
  });

  it('a member the zone cannot fit stands on the free tile nearest the rest, or nowhere', () => {
    const placed = placeFormation({
      formation: 'strongpoint',
      members: [{ back: false }, { back: false }, { back: false }],
      tiles: [
        { col: 0, row: 0 },
        { col: 1, row: 0 },
        { col: 9, row: 0 },
      ],
      standScore: (t) => (t.col === 9 ? 0 : 1),
      cover: () => 0,
      facing: WEST,
      random: () => 0,
    });
    expect(placed.filter(Boolean)).toHaveLength(2);
    expect(placed.filter((t) => t === null)).toHaveLength(1);
  });
});

const FORMATION_TEMPLATES = Object.values(data.mapTemplates)
  .flat()
  .filter((t) =>
    [
      ...(t.zones || []),
      ...(t.choices || []).flatMap((c) => c.options.flatMap((o) => o.zones)),
    ].some((z) => z?.group?.formation),
  );
const objectiveOf = (id) =>
  Object.keys(data.mapTemplates).find((k) => data.mapTemplates[k].some((t) => t.id === id));

describe('the formation maps', () => {
  it('are drawn in runs, all but the Warband (a captains map needs the defeat-objective save format)', () => {
    expect(FORMATION_TEMPLATES.length).toBeGreaterThan(0);
    const off = FORMATION_TEMPLATES.filter((t) => t.enabled === false).map((t) => t.id);
    expect(off).toEqual(['warband']);
  });

  it('leave no foe the army can strike on turn 1 unanswered, and no group member alone', () => {
    const lone = [];
    const apart = [];
    for (const template of FORMATION_TEMPLATES) {
      for (const act of template.acts) {
        for (const difficultyId of ['normal', 'hard']) {
          for (let seed = 1; seed <= 6; seed++) {
            installSeed(seed * 131 + act.length);
            let config;
            try {
              config = generateBattle(
                {
                  act,
                  objective: objectiveOf(template.id),
                  templateId: template.id,
                  deployCount: DEPLOY_LIMITS[act].max,
                  difficultyId,
                  row: 4,
                },
                data,
              );
            } finally {
              restoreMathRandom();
            }
            const where = `${template.id} ${act} ${difficultyId} seed ${seed}`;
            const { foes } = scanOpening({
              mapLayout: config.mapLayout,
              terrainData: data.terrain,
              classes: data.classes,
              spawns: config.enemySpawns,
              playerSpawns: config.playerSpawns,
              act,
              thronePos: config.thronePos,
              objective: config.objective,
              timing: false,
            });
            for (const f of foes) {
              const s = config.enemySpawns[f.index];
              // The seize boss holds the throne: the only foe the cover never moves.
              if (s.isBoss) continue;
              if (f.exposed && f.support < MIN_OPENING_SUPPORT)
                lone.push(`${where}: ${s.className} (${s.col},${s.row}) answered by ${f.support}`);
            }
            for (const s of config.enemySpawns) {
              if (!s.templateGroup) continue;
              const mates = config.enemySpawns.filter(
                (o) => o !== s && o.templateGroup === s.templateGroup,
              );
              if (mates.length && !mates.some((o) => manhattan(o, s) <= HOLD_PACK_RADIUS))
                apart.push(`${where}: ${s.templateGroup} ${s.className} (${s.col},${s.row})`);
            }
          }
        }
      }
    }
    expect(lone).toEqual([]);
    expect(apart).toEqual([]);
  });
});
