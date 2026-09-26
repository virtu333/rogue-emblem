import { describe, it, expect } from 'vitest';
import {
  buildLoomModel,
  describeLoomNode,
  layoutLoom,
  loomAnchorScroll,
  loomHeader,
  loomMedalSize,
  loomScrollToRow,
  loomShortLabel,
  loomViewRow,
  stableIndex,
  toRoman,
  LOOM_MEDAL,
  LOOM_MEDAL_NARROW,
  LOOM_MEDAL_ROOMY,
} from '../src/ui/loomModel.js';
import { generateNodeMap } from '../src/engine/NodeMapGenerator.js';
import { ACT_CONFIG } from '../src/utils/constants.js';
import { loadGameData } from './testData.js';

// The approved board's act (docs/art-direction/board/loom/graph-data.js, seed 6).
const EDGES = {
  act1_0_2: ['act1_1_2', 'act1_1_1', 'act1_1_3'],
  act1_1_1: ['act1_2_1', 'act1_2_2'],
  act1_1_2: ['act1_2_2'],
  act1_1_3: ['act1_2_2', 'act1_2_4'],
  act1_2_1: ['act1_3_1', 'act1_3_0'],
  act1_2_2: ['act1_3_2'],
  act1_2_4: ['act1_3_4'],
  act1_3_0: ['act1_4_1'],
  act1_3_1: ['act1_4_1'],
  act1_3_2: ['act1_4_2', 'act1_4_1'],
  act1_3_4: ['act1_4_4'],
  act1_4_1: ['act1_5_2'],
  act1_4_2: ['act1_5_2', 'act1_5_3'],
  act1_4_4: ['act1_5_4'],
  act1_5_2: ['act1_6_2'],
  act1_5_3: ['act1_6_2'],
  act1_5_4: ['act1_6_2'],
  act1_6_2: ['act1_7_2'],
  act1_7_2: [],
};
const TYPES = {
  act1_2_1: 'shop',
  act1_2_2: 'recruit',
  act1_3_0: 'colosseum',
  act1_3_2: 'church',
  act1_3_4: 'recruit',
  act1_4_2: 'recruit',
  act1_4_4: 'shop',
  act1_5_3: 'shop',
  act1_6_2: 'ruins',
  act1_7_2: 'boss',
};
const ELITE = new Set(['act1_4_1', 'act1_5_2']);

function boardNodes(completed = []) {
  return Object.entries(EDGES).map(([id, edges]) => {
    const [, row, col] = id.split('_').map(Number);
    const type = TYPES[id] || 'battle';
    return {
      id,
      row,
      col,
      type,
      edges,
      completed: completed.includes(id),
      battleParams:
        type === 'battle' || type === 'recruit' || type === 'boss'
          ? { objective: ELITE.has(id) ? 'escape' : 'rout', isElite: ELITE.has(id) || undefined }
          : null,
    };
  });
}

const MID_PATH = ['act1_0_2', 'act1_1_2', 'act1_2_2', 'act1_3_2'];
function midModel() {
  return buildLoomModel({
    nodes: boardNodes(MID_PATH),
    startNodeId: 'act1_0_2',
    availableIds: EDGES.act1_3_2,
    currentId: 'act1_3_2',
  });
}

describe('Loom node states', () => {
  it('act start: only the first knot is live and the lead thread glows', () => {
    const m = buildLoomModel({
      nodes: boardNodes(),
      startNodeId: 'act1_0_2',
      availableIds: ['act1_0_2'],
      currentId: null,
    });
    expect(m.nodeState('act1_0_2')).toBe('live');
    expect(m.leadKind).toBe('live');
    expect(m.frontierRow).toBe(-1);
    expect(m.nodeState('act1_7_2')).toBe('future');
    expect(m.steps.get('act1_0_2')).toBe(1);
    expect(m.steps.get('act1_1_2')).toBe(2);
    expect(m.bossId).toBe('act1_7_2');
    expect(m.rows).toBe(8);
  });

  it('mid act: woven path, reachable choices, futures and frayed branches', () => {
    const m = midModel();
    for (const id of ['act1_0_2', 'act1_1_2', 'act1_2_2']) expect(m.nodeState(id)).toBe('done');
    expect(m.nodeState('act1_3_2')).toBe('current');
    expect(m.nodeState('act1_4_1')).toBe('live');
    expect(m.nodeState('act1_4_2')).toBe('live');
    expect(m.nodeState('act1_5_2')).toBe('future');
    expect(m.nodeState('act1_5_3')).toBe('future');
    expect(m.nodeState('act1_7_2')).toBe('future');
    // Roads the party can no longer take fray.
    for (const id of ['act1_1_1', 'act1_2_1', 'act1_3_0', 'act1_4_4', 'act1_5_4'])
      expect(m.nodeState(id)).toBe('cut');
    expect(m.leadKind).toBe('woven');
    expect(m.frontierRow).toBe(3);
  });

  it('mid act: thread kinds follow the walked route', () => {
    const m = midModel();
    const kind = (a, b) => m.edges.find((e) => e.from === a && e.to === b).kind;
    expect(kind('act1_0_2', 'act1_1_2')).toBe('woven');
    expect(kind('act1_2_2', 'act1_3_2')).toBe('woven');
    expect(kind('act1_3_2', 'act1_4_1')).toBe('live');
    expect(kind('act1_4_2', 'act1_5_3')).toBe('future');
    expect(kind('act1_6_2', 'act1_7_2')).toBe('future');
    expect(kind('act1_0_2', 'act1_1_1')).toBe('cut');
    expect(kind('act1_4_4', 'act1_5_4')).toBe('cut');
    // An unwalked edge between two knots of the path would be impossible; the walked
    // route is exactly one edge per row.
    expect(m.edges.filter((e) => e.kind === 'woven')).toHaveLength(3);
  });

  it('vision traces every route from the party to an inspected future, and nothing else', () => {
    const m = midModel();
    const vision = m.visionEdges('act1_5_2').map((e) => `${e.from}>${e.to}`);
    expect(vision.sort()).toEqual(
      ['act1_3_2>act1_4_1', 'act1_3_2>act1_4_2', 'act1_4_1>act1_5_2', 'act1_4_2>act1_5_2'].sort(),
    );
    expect(m.visionEdges('act1_4_1')).toEqual([]); // live choices need no vision
    expect(m.visionEdges('act1_5_4')).toEqual([]); // frayed, out of reach
    expect(m.visionEdges('act1_1_2')).toEqual([]); // already walked
    expect(m.visionEdges('missing')).toEqual([]);
  });

  it('futures stay quiet (opacity <= 0.68) and dissolve with distance but never vanish', () => {
    const m = midModel();
    expect(m.nodeOpacity('act1_4_1')).toBe(1);
    expect(m.nodeOpacity('act1_3_2')).toBe(1);
    const near = m.nodeOpacity('act1_5_2');
    expect(near).toBeLessThanOrEqual(0.68);
    expect(near).toBeGreaterThanOrEqual(0.5);
    expect(m.nodeOpacity('act1_6_2')).toBeLessThanOrEqual(near);
    expect(m.nodeOpacity('act1_7_2')).toBe(0.68); // the Hollow Sun never fades
    const cut = m.nodeOpacity('act1_5_4');
    expect(cut).toBeGreaterThanOrEqual(0.42);
    expect(cut).toBeLessThanOrEqual(0.6);
    expect(m.rowFade(3)).toBe(1);
    expect(m.rowFade(7)).toBeLessThan(1);
    expect(m.rowFade(40)).toBe(0.28);
  });

  it('a re-enterable shop stays the current knot while also being available', () => {
    const nodes = boardNodes(['act1_0_2', 'act1_1_1', 'act1_2_1']);
    const m = buildLoomModel({
      nodes,
      startNodeId: 'act1_0_2',
      availableIds: [...EDGES.act1_2_1, 'act1_2_1'],
      currentId: 'act1_2_1',
    });
    expect(m.nodeState('act1_2_1')).toBe('current');
    expect(m.available.has('act1_2_1')).toBe(true);
    expect(m.nodeState('act1_3_1')).toBe('live');
  });

  it('read-only campaign view: the node being fought is current and its walked thread is woven', () => {
    const m = buildLoomModel({
      nodes: boardNodes(MID_PATH),
      startNodeId: 'act1_0_2',
      availableIds: EDGES.act1_4_1,
      currentId: 'act1_4_1',
    });
    expect(m.nodeState('act1_4_1')).toBe('current');
    expect(m.edgeKind('act1_3_2', 'act1_4_1')).toBe('woven');
    expect(m.edgeKind('act1_3_2', 'act1_4_2')).toBe('cut');
    expect(m.edgeKind('act1_4_1', 'act1_5_2')).toBe('live');
  });

  it('tolerates empty or partial graphs', () => {
    const m = buildLoomModel({});
    expect(m.rows).toBe(0);
    expect(m.edges).toEqual([]);
    expect(m.nodeState('x')).toBe('cut');
    const orphan = buildLoomModel({
      nodes: [{ id: 'a', row: 0, col: 2, type: 'battle', edges: ['ghost'] }],
      startNodeId: 'nope',
      availableIds: ['a', 'ghost'],
      currentId: 'ghost',
    });
    expect(orphan.startId).toBe('a');
    expect(orphan.current).toBeNull();
    expect(orphan.edges).toEqual([]);
    expect(orphan.available.has('ghost')).toBe(false);
  });

  it('classifies every node of a real generated act without leaving any unreachable live node', () => {
    const data = loadGameData();
    for (const actId of ['act1', 'act2', 'act4', 'finalBoss']) {
      const map = generateNodeMap(actId, ACT_CONFIG[actId], data.mapTemplates, {});
      const start = map.nodes.find((n) => n.id === map.startNodeId);
      const m = buildLoomModel({
        nodes: map.nodes,
        startNodeId: map.startNodeId,
        availableIds: [start.id],
        currentId: null,
      });
      for (const n of map.nodes) expect(['live', 'future']).toContain(m.nodeState(n.id));
      expect(m.bossId).toBe(map.bossNodeId);
    }
  });
});

describe('Loom geometry: the horizontal loom is pinned (landscape and desktop never move)', () => {
  // Values worked out by hand from the README metrics (pad 40/50/42/30, dx = medal + 26
  // up to 96, lanes up to 2.2 medals apart), not by re-running layoutLoom.
  const pick = (l, rows) => ({
    innerW: l.innerW,
    dx: l.dx,
    dy: l.dy,
    padL: l.padL,
    padT: l.padT,
    numeralY: l.numeralY,
    tickY: l.tickY,
    xs: Array.from({ length: rows }, (_, r) => l.x(r)),
    ys: Array.from({ length: 5 }, (_, c) => l.y(c)),
  });

  it('a narrow phone loom scrolls: 62px rows from x 40, lanes 57px apart from y 42', () => {
    const l = layoutLoom({ rows: 9, width: 420, height: 300, medal: 36 });
    expect(pick(l, 9)).toEqual({
      innerW: 586,
      dx: 62,
      dy: 57,
      padL: 40,
      padT: 42,
      numeralY: 15,
      tickY: 20,
      xs: [40, 102, 164, 226, 288, 350, 412, 474, 536],
      ys: [42, 99, 156, 213, 270],
    });
    // The default axis is horizontal, and naming it changes nothing.
    expect(
      pick(layoutLoom({ rows: 9, width: 420, height: 300, medal: 36, axis: 'horizontal' }), 9),
    ).toEqual(pick(l, 9));
  });

  it('a wide desktop loom centres 96px rows and fills the height with lanes', () => {
    const l = layoutLoom({ rows: 8, width: 1200, height: 320, medal: 40 });
    expect(pick(l, 8)).toEqual({
      innerW: 1200,
      dx: 96,
      dy: 62,
      padL: 259,
      padT: 42,
      numeralY: 15,
      tickY: 20,
      xs: [259, 355, 451, 547, 643, 739, 835, 931],
      ys: [42, 104, 166, 228, 290],
    });
  });

  it('a tall loom caps lane spacing at 2.2 medals and centres the lanes', () => {
    const l = layoutLoom({ rows: 8, width: 700, height: 700, medal: 44 });
    expect(l.innerW).toBe(700);
    expect(l.dx).toBeCloseTo(610 / 7, 9);
    expect(l.dy).toBeCloseTo(96.8, 9);
    expect(l.padT).toBe(162);
    expect(l.numeralY).toBe(135);
    expect(l.tickY).toBe(140);
    expect(l.y(4)).toBeCloseTo(162 + 4 * 96.8, 9);
  });

  it('anchor scroll sits 1.4 rows before the choices, clamped to the scroll range', () => {
    const m = midModel(); // choices on row 4
    // x(4) = 40 + 4 * 62 = 288; 288 - 86.8 = 201.2
    expect(loomAnchorScroll(layoutLoom({ rows: 8, width: 300, height: 320, medal: 36 }), m)).toBe(
      201,
    );
    // innerW 524 in a 520px viewport: only 4px of scroll exist
    expect(loomAnchorScroll(layoutLoom({ rows: 8, width: 520, height: 320, medal: 36 }), m)).toBe(
      4,
    );
  });
});

describe('Loom geometry: the vertical loom (upright phones)', () => {
  // 390x844 with the bottom sheet: a ~366 x 540 loom. 375x667: ~351 x 364.
  it('a whole 9-row act fits a 366x540 loom: row I at the bottom, the boss row on top', () => {
    const l = layoutLoom({ rows: 9, width: 366, height: 540, medal: 36, axis: 'vertical' });
    expect(l.axis).toBe('vertical');
    // (540 - 38 - 44) / 8 = 57.25 between rows; (366 - 66 - 34) / 4 = 66.5 between lanes.
    expect(l.rowStep).toBeCloseTo(57.25, 9);
    expect(l.laneStep).toBeCloseTo(66.5, 9);
    expect(l.innerW).toBe(366);
    expect(l.innerH).toBe(540);
    expect(l.scrollSpan).toBe(0);
    expect(l.row(8)).toBe(38);
    expect(l.row(0)).toBe(38 + 8 * 57.25);
    expect(l.pos(0, 0)).toEqual({ x: 66, y: 496 });
    expect(l.pos(8, 4)).toEqual({ x: 332, y: 38 });
    for (let r = 1; r < 9; r++) expect(l.row(r)).toBeLessThan(l.row(r - 1));
    for (let c = 1; c < 5; c++) expect(l.lane(c)).toBeGreaterThan(l.lane(c - 1));
    // The ruler stands left of lane I's medals.
    expect(l.numeralX).toBeLessThan(l.lane(0) - 18);
    expect(l.tickX + 4).toBeLessThanOrEqual(l.lane(0) - 18);
  });

  it('a short loom (375x667) keeps 56px rows and scrolls instead of crushing them', () => {
    const l = layoutLoom({ rows: 9, width: 351, height: 364, medal: 36, axis: 'vertical' });
    expect(l.rowStep).toBe(56);
    expect(l.innerH).toBe(38 + 44 + 8 * 56);
    expect(l.scrollSpan).toBe(530 - 364);
    expect(l.innerW).toBe(351); // never scrolls sideways
  });

  it('wide upright looms centre the lanes and cap them at 2.2 medals', () => {
    const l = layoutLoom({ rows: 8, width: 700, height: 900, medal: 44, axis: 'vertical' });
    expect(l.laneStep).toBeCloseTo(96.8, 9);
    const block = 66 + 34 + 4 * 96.8;
    expect(l.lane(0)).toBe(66 + Math.floor((700 - block) / 2));
    expect(l.rowStep).toBe(96);
    // 38 + 44 + 7 * 96 = 754 < 900: the act is centred vertically.
    expect(l.row(7)).toBe(38 + (900 - 754) / 2);
  });

  it('knots of real generated acts never overlap and stay inside the weave', () => {
    const data = loadGameData();
    for (const actId of ['act1', 'act2', 'act3', 'act4', 'finalBoss']) {
      const map = generateNodeMap(actId, ACT_CONFIG[actId], data.mapTemplates, {});
      const rows = Math.max(...map.nodes.map((n) => n.row)) + 1;
      for (const [width, height] of [
        [366, 540],
        [351, 364],
      ]) {
        const l = layoutLoom({ rows, width, height, medal: 36, axis: 'vertical' });
        const pts = map.nodes.map((n) => ({ ...l.pos(n.row, n.col), boss: n.type === 'boss' }));
        for (const p of pts) {
          const half = p.boss ? 28 : 24; // hit areas: 48px, the boss 56px
          expect(p.x - half).toBeGreaterThanOrEqual(0);
          expect(p.x + half).toBeLessThanOrEqual(l.innerW);
          expect(p.y - half).toBeGreaterThanOrEqual(0);
          expect(p.y + half).toBeLessThanOrEqual(l.innerH);
        }
        for (let i = 0; i < pts.length; i++)
          for (let j = i + 1; j < pts.length; j++) {
            const gap = Math.max(Math.abs(pts[i].x - pts[j].x), Math.abs(pts[i].y - pts[j].y));
            expect(gap).toBeGreaterThanOrEqual(48);
          }
        // The start knot (row 0) is the lowest; the boss the highest.
        const start = map.nodes.find((n) => n.id === map.startNodeId);
        const boss = map.nodes.find((n) => n.id === map.bossNodeId);
        for (const n of map.nodes) {
          expect(l.pos(n.row, n.col).y).toBeLessThanOrEqual(l.pos(start.row, start.col).y);
          expect(l.pos(n.row, n.col).y).toBeGreaterThanOrEqual(l.pos(boss.row, boss.col).y);
        }
      }
    }
  });

  it("anchor scroll shows the choices with the party's knot whole below them, clamped", () => {
    // 8 rows in a 351x364 loom: 56px rows, innerH 474, 110px of scroll; row r at
    // 38 + (7 - r) * 56. Lead-in: one row + half a medal + 14 = 88px.
    const l = layoutLoom({ rows: 8, width: 351, height: 364, medal: 36, axis: 'vertical' });
    expect(l.scrollSpan).toBe(110);
    const at = (ids) =>
      buildLoomModel({ nodes: boardNodes(), startNodeId: 'act1_0_2', availableIds: ids });
    // Act start (row 0 at y 430): 430 + 88 - 364 = 154, clamped to 110.
    expect(loomAnchorScroll(l, at(['act1_0_2']))).toBe(110);
    // Choices on row 2 (y 318): 318 + 88 - 364 = 42.
    const s2 = loomAnchorScroll(l, at(['act1_2_1', 'act1_2_2']));
    expect(s2).toBe(42);
    expect(318 - 18).toBeGreaterThan(s2);
    // The row below (the party's, y 374) is whole: its medal and ring end above the edge.
    expect(374 + 18 + 5).toBeLessThanOrEqual(s2 + 364);
    // Choices on row 4 (y 206) are already in view from the top.
    expect(loomAnchorScroll(l, midModel())).toBe(0);
    // A loom that fits never scrolls.
    const fit = layoutLoom({ rows: 8, width: 366, height: 540, medal: 36, axis: 'vertical' });
    expect(loomAnchorScroll(fit, at(['act1_0_2']))).toBe(0);
  });

  it('the view row survives a switch between axes (rotation keeps the browsing place)', () => {
    const h = layoutLoom({ rows: 9, width: 300, height: 320, medal: 36 });
    // scrollLeft 201: centre at 351 -> row (351 - 40) / 62
    expect(loomViewRow(h, 201)).toBeCloseTo(311 / 62, 9);
    expect(loomScrollToRow(h, 311 / 62)).toBe(201);
    const v = layoutLoom({ rows: 9, width: 351, height: 364, medal: 36, axis: 'vertical' });
    // centre row 5 -> y 38 + 3 * 56 = 206 -> scrollTop 206 - 182 = 24
    expect(loomScrollToRow(v, 5)).toBe(24);
    expect(loomViewRow(v, 24)).toBeCloseTo(5, 9);
    // Row 0 wants to be centred below the weave's end: clamped to the full scroll.
    expect(loomScrollToRow(v, 0)).toBe(v.scrollSpan);
    expect(loomScrollToRow(v, 8)).toBe(0);
    // Round trip horizontal -> vertical -> horizontal lands on the same place.
    const row = loomViewRow(h, 150);
    const back = loomScrollToRow(h, loomViewRow(v, loomScrollToRow(v, row)));
    expect(Math.abs(back - 150)).toBeLessThanOrEqual(1);
  });
});

describe('Loom geometry', () => {
  it('medal size follows the loom width (compact on narrow phones, roomy on desktop)', () => {
    expect(loomMedalSize(420, 300)).toBe(LOOM_MEDAL_NARROW);
    expect(loomMedalSize(560, 300)).toBe(LOOM_MEDAL_NARROW);
    expect(loomMedalSize(600, 320)).toBe(LOOM_MEDAL);
    expect(loomMedalSize(720, 640)).toBe(LOOM_MEDAL_ROOMY);
    expect(loomMedalSize(0, 0)).toBe(LOOM_MEDAL);
  });

  it('row spacing is at least medal + 26 and at most 96; wide looms centre the weave', () => {
    const tight = layoutLoom({ rows: 9, width: 420, height: 300, medal: 36 });
    expect(tight.dx).toBe(62);
    expect(tight.innerW).toBeGreaterThan(420);
    expect(tight.x(0)).toBe(40);
    const wide = layoutLoom({ rows: 8, width: 1200, height: 320, medal: 40 });
    expect(wide.dx).toBe(96);
    expect(wide.innerW).toBe(1200);
    expect(wide.x(0)).toBeGreaterThan(40);
    expect(wide.x(7) - wide.x(0)).toBe(96 * 7);
  });

  it('lanes fill the height up to 2.2 medals apart and are centred when taller', () => {
    const phone = layoutLoom({ rows: 8, width: 600, height: 330, medal: 40 });
    expect(phone.dy).toBeCloseTo((330 - 72) / 4, 5);
    expect(phone.padT).toBe(42);
    expect(phone.y(4) + 30).toBeCloseTo(330, 5);
    const tall = layoutLoom({ rows: 8, width: 700, height: 700, medal: 44 });
    expect(tall.dy).toBeCloseTo(44 * 2.2, 5);
    expect(tall.padT).toBeGreaterThan(42);
    expect(tall.numeralY).toBe(tall.padT - 27);
  });

  it('a fresh loom anchors its scroll on the choices with a little lead-in', () => {
    const m = midModel();
    const l = layoutLoom({ rows: 8, width: 300, height: 320, medal: 36 });
    const scroll = loomAnchorScroll(l, m);
    expect(scroll).toBe(Math.round(l.x(4) - l.dx * 1.4));
    const wide = layoutLoom({ rows: 8, width: 2000, height: 320, medal: 36 });
    expect(loomAnchorScroll(wide, m)).toBe(0);
  });
});

describe('Loom inspect card', () => {
  const templates = {
    rout: [{ id: 'open_field', name: 'Open Field', lore: 'Flat ground.' }],
    escape: [{ id: 'pursuit_road', name: 'Pursuit Road', lore: 'Run.' }],
  };
  const dialogue = {
    nodeFlavor: {
      battle: { act1: ['a', 'b', 'c'] },
      elite: { act1: ['elite line'] },
    },
    shopFlavor: { act1: ['shop line'] },
  };

  it('describes an elite with its objective, place, levels and loot', () => {
    const node = {
      id: 'act1_4_1',
      type: 'battle',
      templateId: 'pursuit_road',
      battleParams: { objective: 'escape', isElite: true, levelRange: [2, 3] },
    };
    const card = describeLoomNode(node, {
      state: 'live',
      mapTemplates: templates,
      dialogue,
      eliteLoot: { choices: 4, picks: 2 },
    });
    expect(card.kind).toBe('ELITE');
    expect(card.objective).toBe('ESCAPE');
    expect(card.place).toBe('Pursuit Road');
    expect(card.tags.map((t) => t.text)).toEqual(['Foes Lv 2–3', 'Loot: pick 2 of 4']);
    expect(card.flavor).toBe('elite line');
    expect(card.stateLine).toEqual({ tone: 'live', text: 'Within reach · the next knot' });
  });

  it('applies the difficulty level offset and the first-battle fog rule', () => {
    const node = {
      id: 'n',
      type: 'battle',
      fogEnabled: true,
      battleParams: { objective: 'rout', levelRange: [1, 1] },
    };
    const hard = describeLoomNode(node, { state: 'future', steps: 3, enemyLevelBonus: 2 });
    expect(hard.tags.map((t) => t.text)).toEqual(['Foes Lv 3', 'Fog']);
    expect(hard.stateLine.text).toBe('Possible future · 3 steps');
    const first = describeLoomNode(node, { state: 'live', firstBattle: true });
    expect(first.tags.map((t) => t.text)).toEqual(['Foes Lv 1']);
    const floor = describeLoomNode(node, { state: 'live', enemyLevelBonus: -5 });
    expect(floor.tags[0].text).toBe('Foes Lv 1');
  });

  it('never reveals the hidden battle of a village ambush', () => {
    const ambush = {
      id: 'act1_2_1',
      type: 'shop',
      isAmbush: true,
      templateId: 'open_field',
      fogEnabled: true,
      battleParams: { objective: 'rout', levelRange: [1, 3], isAmbush: true },
    };
    const card = describeLoomNode(ambush, { state: 'live', mapTemplates: templates, dialogue });
    expect(card.kind).toBe('VILLAGE');
    expect(card.objective).toBeNull();
    expect(card.place).toBeNull();
    expect(card.tags).toEqual([]);
    expect(card.text).toBe('Buy, sell and forge equipment.');
    expect(card.flavor).toBe('shop line');
    expect(loomShortLabel(ambush)).toBe('VILLAGE');
  });

  it('picks flavour deterministically per node and drops it for frayed threads', () => {
    const node = { id: 'act1_1_2', type: 'battle', battleParams: { objective: 'rout' } };
    const a = describeLoomNode(node, { state: 'live', dialogue });
    const b = describeLoomNode(node, { state: 'future', dialogue });
    expect(a.flavor).toBe(b.flavor);
    expect(['a', 'b', 'c']).toContain(a.flavor);
    expect(describeLoomNode(node, { state: 'cut', dialogue }).flavor).toBeNull();
    expect(stableIndex('x', 5)).toBe(stableIndex('x', 5));
    expect(stableIndex('x', 0)).toBe(-1);
  });

  it('recruit, services and the state lines read as the board specifies', () => {
    const recruit = describeLoomNode(
      { id: 'r', type: 'recruit', battleParams: { objective: 'rout', isRecruitBattle: true } },
      { state: 'done' },
    );
    expect(recruit.place).toBe('A potential ally');
    expect(recruit.objective).toBeNull();
    expect(recruit.text).toBe('Battle with a potential ally.');
    expect(recruit.stateLine.text).toBe('Woven · already walked');
    const church = describeLoomNode({ id: 'c', type: 'church' }, { state: 'cut' });
    expect(church.kind).toBe('CHURCH');
    expect(church.stateLine).toEqual({ tone: 'cut', text: 'A frayed thread · out of reach' });
    const shop = describeLoomNode({ id: 's', type: 'shop' }, { state: 'current', shopOpen: true });
    expect(shop.stateLine.text).toBe('Shop still open · Stock and prices retained');
    const here = describeLoomNode({ id: 'h', type: 'church' }, { state: 'current' });
    expect(here.stateLine.text).toBe('The party rests here');
    const boss = describeLoomNode(
      { id: 'b', type: 'boss', battleParams: { objective: 'seize' } },
      { state: 'future', steps: 1 },
    );
    expect(boss.kind).toBe('BOSS');
    expect(boss.objective).toBe('SEIZE');
    expect(boss.stateLine.text).toBe('Possible future');
    expect(describeLoomNode(null)).toBeNull();
  });
});

describe('Loom header', () => {
  it('reads "Act I · Border Marches" with the act name and row as the pixel subline', () => {
    expect(
      loomHeader({
        actIndex: 0,
        actName: 'Border Skirmishes',
        region: 'Border Marches',
        rows: 8,
        frontierRow: 0,
      }),
    ).toEqual({ act: 'Act I', title: 'Border Marches', sub: 'BORDER SKIRMISHES · ROW 2 OF 8' });
    expect(loomHeader({ actIndex: 3, actName: 'X', region: '', rows: 9, frontierRow: 8 })).toEqual({
      act: 'Act IV',
      title: 'X',
      sub: 'X · ROW 9 OF 9',
    });
    expect(loomHeader({ actIndex: 0, rows: 8, frontierRow: -1 }).sub).toBe('ROW 1 OF 8');
    expect(toRoman(9)).toBe('IX');
    expect(toRoman(20)).toBe('20');
  });
});
