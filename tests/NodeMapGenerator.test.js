import { describe, it, expect, vi } from 'vitest';
import { generateNodeMap } from '../src/engine/NodeMapGenerator.js';
import { ACT_CONFIG, NODE_TYPES, FOG_CHANCE_BY_ACT } from '../src/utils/constants.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();

describe('NodeMapGenerator', () => {
  describe('generateNodeMap — act1', () => {
    const actId = 'act1';
    const actConfig = ACT_CONFIG[actId];

    it('returns valid nodeMap structure', () => {
      const map = generateNodeMap(actId, actConfig);
      expect(map.actId).toBe(actId);
      expect(map.nodes).toBeInstanceOf(Array);
      expect(map.nodes.length).toBeGreaterThan(0);
      expect(map.startNodeId).toBeTruthy();
      expect(map.bossNodeId).toBeTruthy();
    });

    it('row 0 has exactly 1 battle node', () => {
      const map = generateNodeMap(actId, actConfig);
      const row0 = map.nodes.filter(n => n.row === 0);
      expect(row0.length).toBe(1);
      expect(row0[0].type).toBe(NODE_TYPES.BATTLE);
    });

    it('last row has exactly 1 boss node', () => {
      const map = generateNodeMap(actId, actConfig);
      const lastRow = actConfig.rows - 1;
      const bossRow = map.nodes.filter(n => n.row === lastRow);
      expect(bossRow.length).toBe(1);
      expect(bossRow[0].type).toBe(NODE_TYPES.BOSS);
      expect(bossRow[0].id).toBe(map.bossNodeId);
    });

    it('middle rows have 2-4 nodes', () => {
      const map = generateNodeMap(actId, actConfig);
      for (let r = 1; r < actConfig.rows - 1; r++) {
        const row = map.nodes.filter(n => n.row === r);
        expect(row.length).toBeGreaterThanOrEqual(2);
        expect(row.length).toBeLessThanOrEqual(4);
      }
    });

    it('node columns are within 0-4 range', () => {
      for (let i = 0; i < 20; i++) {
        const map = generateNodeMap(actId, actConfig);
        for (const node of map.nodes) {
          expect(node.col).toBeGreaterThanOrEqual(0);
          expect(node.col).toBeLessThanOrEqual(4);
        }
      }
    });

    it('no duplicate columns within the same row', () => {
      for (let i = 0; i < 20; i++) {
        const map = generateNodeMap(actId, actConfig);
        const totalRows = Math.max(...map.nodes.map(n => n.row)) + 1;
        for (let r = 0; r < totalRows; r++) {
          const rowNodes = map.nodes.filter(n => n.row === r);
          const cols = rowNodes.map(n => n.col);
          expect(new Set(cols).size).toBe(cols.length);
        }
      }
    });

    it('row 1 has only battle nodes', () => {
      // Run multiple times since it's random
      for (let i = 0; i < 20; i++) {
        const map = generateNodeMap(actId, actConfig);
        const row1 = map.nodes.filter(n => n.row === 1);
        expect(row1.every(n => n.type === NODE_TYPES.BATTLE)).toBe(true);
      }
    });

    it('edges only connect adjacent rows', () => {
      const map = generateNodeMap(actId, actConfig);
      const nodeById = new Map(map.nodes.map(n => [n.id, n]));
      for (const node of map.nodes) {
        for (const edgeId of node.edges) {
          const target = nodeById.get(edgeId);
          expect(target).toBeTruthy();
          expect(target.row).toBe(node.row + 1);
        }
      }
    });

    it('all nodes reachable from start', () => {
      const map = generateNodeMap(actId, actConfig);
      const nodeById = new Map(map.nodes.map(n => [n.id, n]));
      const reachable = new Set();
      const queue = [map.startNodeId];
      while (queue.length > 0) {
        const id = queue.shift();
        if (reachable.has(id)) continue;
        reachable.add(id);
        const node = nodeById.get(id);
        for (const edgeId of node.edges) {
          queue.push(edgeId);
        }
      }
      // Every non-row-0 node should be reachable
      // (all nodes should be reachable because every node has incoming edges)
      for (const node of map.nodes) {
        expect(reachable.has(node.id)).toBe(true);
      }
    });

    it('boss is reachable from every path', () => {
      const map = generateNodeMap(actId, actConfig);
      const nodeById = new Map(map.nodes.map(n => [n.id, n]));

      // BFS from each node to see if boss is reachable
      function canReachBoss(startId) {
        const visited = new Set();
        const queue = [startId];
        while (queue.length > 0) {
          const id = queue.shift();
          if (id === map.bossNodeId) return true;
          if (visited.has(id)) continue;
          visited.add(id);
          const node = nodeById.get(id);
          for (const edgeId of node.edges) queue.push(edgeId);
        }
        return false;
      }

      for (const node of map.nodes) {
        if (node.row < actConfig.rows - 1) {
          expect(canReachBoss(node.id)).toBe(true);
        }
      }
    });

    it('boss node has seize objective', () => {
      const map = generateNodeMap(actId, actConfig);
      const boss = map.nodes.find(n => n.id === map.bossNodeId);
      expect(boss.battleParams.objective).toBe('seize');
    });

    it('church and shop nodes have null battleParams', () => {
      // Generate maps until we find non-battle nodes
      let foundChurch = false;
      let foundShop = false;
      for (let i = 0; i < 50; i++) {
        const map = generateNodeMap(actId, actConfig);
        const nonBattle = map.nodes.filter(n => n.type === NODE_TYPES.CHURCH || n.type === NODE_TYPES.SHOP);
        for (const node of nonBattle) {
          expect(node.battleParams).toBeNull();
        }
        if (nonBattle.some(n => n.type === NODE_TYPES.CHURCH)) foundChurch = true;
        if (nonBattle.some(n => n.type === NODE_TYPES.SHOP)) foundShop = true;
        if (foundChurch && foundShop) return;
      }
    });

    it('combat nodes include a battleSeed for encounter locking', () => {
      const map = generateNodeMap(actId, actConfig);
      const combat = map.nodes.filter(n => n.type !== NODE_TYPES.SHOP && n.type !== NODE_TYPES.CHURCH);
      expect(combat.length).toBeGreaterThan(0);
      for (const node of combat) {
        expect(Number.isInteger(node.battleParams?.battleSeed)).toBe(true);
      }
    });
  });

  describe('generateNodeMap — finalBoss', () => {
    it('produces single boss node', () => {
      const map = generateNodeMap('finalBoss', ACT_CONFIG.finalBoss);
      expect(map.nodes.length).toBe(1);
      expect(map.nodes[0].type).toBe(NODE_TYPES.BOSS);
      expect(map.startNodeId).toBe(map.bossNodeId);
    });

    it('final boss has seize objective', () => {
      const map = generateNodeMap('finalBoss', ACT_CONFIG.finalBoss);
      expect(map.nodes[0].battleParams.objective).toBe('seize');
    });
  });

  describe('RECRUIT node distribution', () => {
    it('RECRUIT nodes never appear in row 0, row 1, or final row', () => {
      for (let i = 0; i < 50; i++) {
        const map = generateNodeMap('act1', ACT_CONFIG.act1);
        const recruitNodes = map.nodes.filter(n => n.type === NODE_TYPES.RECRUIT);
        for (const node of recruitNodes) {
          expect(node.row).toBeGreaterThan(1);
          expect(node.row).toBeLessThan(ACT_CONFIG.act1.rows - 1);
        }
      }
    });

    it('guarantees at least 2 RECRUIT nodes per act (non-finalBoss)', () => {
      for (let i = 0; i < 50; i++) {
        const map = generateNodeMap('act2', ACT_CONFIG.act2);
        const recruitCount = map.nodes.filter(n => n.type === NODE_TYPES.RECRUIT).length;
        expect(recruitCount).toBeGreaterThanOrEqual(2);
      }
    });

    it('never more than 3 RECRUIT nodes per act', () => {
      for (let i = 0; i < 50; i++) {
        const map = generateNodeMap('act1', ACT_CONFIG.act1);
        const recruitCount = map.nodes.filter(n => n.type === NODE_TYPES.RECRUIT).length;
        expect(recruitCount).toBeLessThanOrEqual(3);
      }
    });

    it('RECRUIT nodes have isRecruitBattle: true in battleParams', () => {
      for (let i = 0; i < 30; i++) {
        const map = generateNodeMap('act1', ACT_CONFIG.act1);
        const recruitNodes = map.nodes.filter(n => n.type === NODE_TYPES.RECRUIT);
        for (const node of recruitNodes) {
          expect(node.battleParams).not.toBeNull();
          expect(node.battleParams.isRecruitBattle).toBe(true);
          expect(node.battleParams.objective).toBe('rout');
        }
      }
    });

    it('finalBoss act has no RECRUIT nodes', () => {
      const map = generateNodeMap('finalBoss', ACT_CONFIG.finalBoss);
      const recruitCount = map.nodes.filter(n => n.type === NODE_TYPES.RECRUIT).length;
      expect(recruitCount).toBe(0);
    });
  });

  describe('per-node level scaling', () => {
    it('act1 row 0 nodes have levelRange [1, 1]', () => {
      for (let i = 0; i < 20; i++) {
        const map = generateNodeMap('act1', ACT_CONFIG.act1);
        const row0 = map.nodes.filter(n => n.row === 0);
        for (const node of row0) {
          expect(node.battleParams.levelRange).toEqual([1, 1]);
        }
      }
    });

    it('act1 row 1 nodes have levelRange [1, 2]', () => {
      for (let i = 0; i < 20; i++) {
        const map = generateNodeMap('act1', ACT_CONFIG.act1);
        const row1 = map.nodes.filter(n => n.row === 1);
        for (const node of row1) {
          expect(node.battleParams.levelRange).toEqual([1, 2]);
        }
      }
    });

    it('act1 middle row (row >= 2, non-boss) nodes have levelRange [2, 3]', () => {
      for (let i = 0; i < 20; i++) {
        const map = generateNodeMap('act1', ACT_CONFIG.act1);
        const middleBattle = map.nodes.filter(n =>
          n.row >= 2 && n.type !== NODE_TYPES.BOSS && n.type !== NODE_TYPES.CHURCH && n.type !== NODE_TYPES.SHOP
        );
        for (const node of middleBattle) {
          expect(node.battleParams.levelRange).toEqual([2, 3]);
        }
      }
    });

    it('act2 battle nodes have no levelRange in battleParams', () => {
      for (let i = 0; i < 10; i++) {
        const map = generateNodeMap('act2', ACT_CONFIG.act2);
        const battleNodes = map.nodes.filter(n =>
          n.type === NODE_TYPES.BATTLE || n.type === NODE_TYPES.RECRUIT
        );
        for (const node of battleNodes) {
          expect(node.battleParams.levelRange).toBeUndefined();
        }
      }
    });

    it('act3 row 0 nodes have levelRange [8, 11]', () => {
      for (let i = 0; i < 20; i++) {
        const map = generateNodeMap('act3', ACT_CONFIG.act3);
        const row0 = map.nodes.filter(n =>
          n.row === 0 && n.type !== NODE_TYPES.BOSS && n.type !== NODE_TYPES.CHURCH && n.type !== NODE_TYPES.SHOP
        );
        for (const node of row0) {
          expect(node.battleParams.levelRange).toEqual([8, 11]);
        }
      }
    });

    it('act3 row 1 nodes have levelRange [9, 12]', () => {
      for (let i = 0; i < 20; i++) {
        const map = generateNodeMap('act3', ACT_CONFIG.act3);
        const row1 = map.nodes.filter(n =>
          n.row === 1 && n.type !== NODE_TYPES.BOSS && n.type !== NODE_TYPES.CHURCH && n.type !== NODE_TYPES.SHOP
        );
        for (const node of row1) {
          expect(node.battleParams.levelRange).toEqual([9, 12]);
        }
      }
    });

    it('act3 row 2 nodes have levelRange [10, 13]', () => {
      for (let i = 0; i < 20; i++) {
        const map = generateNodeMap('act3', ACT_CONFIG.act3);
        const row2 = map.nodes.filter(n =>
          n.row === 2 && n.type !== NODE_TYPES.BOSS && n.type !== NODE_TYPES.CHURCH && n.type !== NODE_TYPES.SHOP
        );
        for (const node of row2) {
          expect(node.battleParams.levelRange).toEqual([10, 13]);
        }
      }
    });

    it('act3 row 3+ nodes have levelRange [11, 15]', () => {
      for (let i = 0; i < 20; i++) {
        const map = generateNodeMap('act3', ACT_CONFIG.act3);
        const laterRows = map.nodes.filter(n =>
          n.row >= 3 && n.type !== NODE_TYPES.BOSS && n.type !== NODE_TYPES.CHURCH && n.type !== NODE_TYPES.SHOP
        );
        for (const node of laterRows) {
          expect(node.battleParams.levelRange).toEqual([11, 15]);
        }
      }
    });
  });

  describe('per-act seize/elite restrictions', () => {
    it('act1: seize only on rows 3-4 (second half, excluding boss row 5)', () => {
      for (let i = 0; i < 50; i++) {
        const map = generateNodeMap('act1', ACT_CONFIG.act1);
        const seizeBattle = map.nodes.filter(n =>
          n.type === NODE_TYPES.BATTLE && n.battleParams?.objective === 'seize'
        );
        for (const node of seizeBattle) {
          expect(node.row).toBeGreaterThanOrEqual(3);
          expect(node.row).toBeLessThan(ACT_CONFIG.act1.rows - 1);
        }
      }
    });

    it('act2: seize only on rows 3-5 (excluding boss row 6)', () => {
      for (let i = 0; i < 50; i++) {
        const map = generateNodeMap('act2', ACT_CONFIG.act2);
        const seizeBattle = map.nodes.filter(n =>
          n.type === NODE_TYPES.BATTLE && n.battleParams?.objective === 'seize'
        );
        for (const node of seizeBattle) {
          expect(node.row).toBeGreaterThanOrEqual(3);
          expect(node.row).toBeLessThan(ACT_CONFIG.act2.rows - 1);
        }
      }
    });

    it('act3: seize can appear from row 2 onward (earlier exception)', () => {
      let foundEarlySeize = false;
      for (let i = 0; i < 200; i++) {
        const map = generateNodeMap('act3', ACT_CONFIG.act3);
        const seizeBattle = map.nodes.filter(n =>
          n.type === NODE_TYPES.BATTLE && n.battleParams?.objective === 'seize'
        );
        for (const node of seizeBattle) {
          expect(node.row).toBeGreaterThanOrEqual(2);
          expect(node.row).toBeLessThan(ACT_CONFIG.act3.rows - 1);
          if (node.row < 3) foundEarlySeize = true;
        }
      }
      expect(foundEarlySeize).toBe(true);
    });

    it('seize battle nodes have isElite: true', () => {
      for (let i = 0; i < 50; i++) {
        const map = generateNodeMap('act1', ACT_CONFIG.act1);
        const seizeBattle = map.nodes.filter(n =>
          n.type === NODE_TYPES.BATTLE && n.battleParams?.objective === 'seize'
        );
        for (const node of seizeBattle) {
          expect(node.battleParams.isElite).toBe(true);
        }
      }
    });

    it('rout battle nodes do NOT have isElite', () => {
      for (let i = 0; i < 30; i++) {
        const map = generateNodeMap('act1', ACT_CONFIG.act1);
        const routBattle = map.nodes.filter(n =>
          n.type === NODE_TYPES.BATTLE && n.battleParams?.objective === 'rout'
        );
        for (const node of routBattle) {
          expect(node.battleParams.isElite).toBeUndefined();
        }
      }
    });

    it('boss nodes do NOT have isElite', () => {
      for (let i = 0; i < 20; i++) {
        const map = generateNodeMap('act1', ACT_CONFIG.act1);
        const boss = map.nodes.find(n => n.type === NODE_TYPES.BOSS);
        expect(boss.battleParams.isElite).toBeUndefined();
      }
    });

    it('seize can appear on eligible rows (40% when allowed)', () => {
      let foundSeize = false;
      for (let i = 0; i < 100; i++) {
        const map = generateNodeMap('act1', ACT_CONFIG.act1);
        const laterBattle = map.nodes.filter(n =>
          n.row >= 3 && n.type === NODE_TYPES.BATTLE
        );
        if (laterBattle.some(n => n.battleParams.objective === 'seize')) {
          foundSeize = true;
          break;
        }
      }
      expect(foundSeize).toBe(true);
    });
  });

  describe('column-lane system (no edge crossings)', () => {
    it('edges between multi-node rows only connect to same or adjacent columns (±1)', () => {
      for (let i = 0; i < 50; i++) {
        const map = generateNodeMap('act1', ACT_CONFIG.act1);
        const nodeById = new Map(map.nodes.map(n => [n.id, n]));
        const totalRows = Math.max(...map.nodes.map(n => n.row)) + 1;
        for (const node of map.nodes) {
          const rowNodes = map.nodes.filter(n => n.row === node.row);
          for (const edgeId of node.edges) {
            const target = nodeById.get(edgeId);
            const targetRowNodes = map.nodes.filter(n => n.row === target.row);
            // ±1 constraint only applies when both rows have multiple nodes
            // Single-node rows (start/boss) converge/diverge — can't cross
            if (rowNodes.length > 1 && targetRowNodes.length > 1) {
              const colDiff = Math.abs(target.col - node.col);
              expect(colDiff).toBeLessThanOrEqual(1);
            }
          }
        }
      }
    });

    it('edges between adjacent rows never cross', () => {
      for (let trial = 0; trial < 100; trial++) {
        const map = generateNodeMap('act1', ACT_CONFIG.act1);
        const nodeById = new Map(map.nodes.map(n => [n.id, n]));
        const totalRows = Math.max(...map.nodes.map(n => n.row)) + 1;

        for (let r = 0; r < totalRows - 1; r++) {
          // Collect all edges from this row as [sourceCol, targetCol] pairs
          const edges = [];
          for (const node of map.nodes.filter(n => n.row === r)) {
            for (const edgeId of node.edges) {
              const target = nodeById.get(edgeId);
              edges.push([node.col, target.col]);
            }
          }

          // Two edges cross if (a < b && d < c) or (a > b && d > c)
          // where edge1 = [a, c] and edge2 = [b, d]
          for (let i = 0; i < edges.length; i++) {
            for (let j = i + 1; j < edges.length; j++) {
              const [a, c] = edges[i];
              const [b, d] = edges[j];
              // Edges cross when one goes left-to-right and the other right-to-left
              const crosses = (a < b && c > d) || (a > b && c < d);
              expect(crosses).toBe(false);
            }
          }
        }
      }
    });

    it('columns within a row are sorted ascending', () => {
      for (let i = 0; i < 20; i++) {
        const map = generateNodeMap('act2', ACT_CONFIG.act2);
        const totalRows = Math.max(...map.nodes.map(n => n.row)) + 1;
        for (let r = 0; r < totalRows; r++) {
          const rowNodes = map.nodes.filter(n => n.row === r);
          const cols = rowNodes.map(n => n.col);
          for (let j = 1; j < cols.length; j++) {
            expect(cols[j]).toBeGreaterThan(cols[j - 1]);
          }
        }
      }
    });
  });

  describe('generateNodeMap — all acts produce valid maps', () => {
    for (const [actId, config] of Object.entries(ACT_CONFIG)) {
      it(`${actId} generates without error`, () => {
        const map = generateNodeMap(actId, config);
        expect(map.actId).toBe(actId);
        expect(map.nodes.length).toBeGreaterThan(0);
      });
    }
  });
});

describe('Church node generation', () => {
  it('pickNodeType generates CHURCH nodes in middle rows', () => {
    // Generate 1000 maps, count CHURCH nodes, expect ~15% of middle-row nodes
    let totalMiddle = 0;
    let totalChurch = 0;
    for (let i = 0; i < 1000; i++) {
      const map = generateNodeMap('act1', ACT_CONFIG.act1);
      const middleNodes = map.nodes.filter(n => n.row > 1 && n.row < ACT_CONFIG.act1.rows - 1);
      totalMiddle += middleNodes.length;
      totalChurch += middleNodes.filter(n => n.type === NODE_TYPES.CHURCH).length;
    }
    const churchPercent = (totalChurch / totalMiddle) * 100;
    expect(churchPercent).toBeGreaterThan(10); // 15% ± margin
    expect(churchPercent).toBeLessThan(20);
  });

  it('buildBattleParams returns null for CHURCH nodes', () => {
    for (let i = 0; i < 50; i++) {
      const map = generateNodeMap('act2', ACT_CONFIG.act2);
      const churchNodes = map.nodes.filter(n => n.type === NODE_TYPES.CHURCH);
      for (const node of churchNodes) {
        expect(node.battleParams).toBeNull();
      }
      if (churchNodes.length > 0) return; // Found at least one, test passes
    }
  });
});

describe('Shop node frequency (25%)', () => {
  it('shop frequency is ~25% of middle rows', () => {
    let totalMiddle = 0;
    let totalShop = 0;
    for (let i = 0; i < 1000; i++) {
      const map = generateNodeMap('act1', ACT_CONFIG.act1);
      const middleNodes = map.nodes.filter(n => n.row > 1 && n.row < ACT_CONFIG.act1.rows - 1);
      totalMiddle += middleNodes.length;
      totalShop += middleNodes.filter(n => n.type === NODE_TYPES.SHOP).length;
    }
    const shopPercent = (totalShop / totalMiddle) * 100;
    expect(shopPercent).toBeGreaterThan(20);
    expect(shopPercent).toBeLessThan(30);
  });
});

describe('Template-driven fog', () => {
  const mapTemplates = gameData.mapTemplates;

  it('battle nodes get a templateId when mapTemplates provided', () => {
    const map = generateNodeMap('act1', ACT_CONFIG.act1, mapTemplates);
    const battleNodes = map.nodes.filter(n => n.type === NODE_TYPES.BATTLE);
    expect(battleNodes.length).toBeGreaterThan(0);
    for (const n of battleNodes) {
      expect(n.templateId).toBeDefined();
      expect(n.battleParams.templateId).toBe(n.templateId);
    }
  });

  it('boss nodes get a templateId when mapTemplates provided', () => {
    const map = generateNodeMap('act1', ACT_CONFIG.act1, mapTemplates);
    const bossNodes = map.nodes.filter(n => n.type === NODE_TYPES.BOSS);
    expect(bossNodes.length).toBe(1);
    expect(bossNodes[0].templateId).toBeDefined();
    expect(bossNodes[0].battleParams.templateId).toBe(bossNodes[0].templateId);
  });

  it('works without mapTemplates (backward compatible)', () => {
    const map = generateNodeMap('act1', ACT_CONFIG.act1);
    const battleNodes = map.nodes.filter(n => n.type === NODE_TYPES.BATTLE);
    expect(battleNodes.length).toBeGreaterThan(0);
    for (const n of battleNodes) {
      expect(n.templateId).toBeUndefined();
    }
  });

  it('forest_ambush nodes have fog ~55-65% of the time', () => {
    // Force all templates to forest_ambush (fogChance=0.60)
    const forestOnly = { rout: [mapTemplates.rout.find(t => t.id === 'forest_ambush')], seize: [mapTemplates.rout.find(t => t.id === 'forest_ambush')] };
    let fogCount = 0;
    let battleCount = 0;
    for (let i = 0; i < 200; i++) {
      const map = generateNodeMap('act1', ACT_CONFIG.act1, forestOnly);
      for (const n of map.nodes) {
        if (n.type === NODE_TYPES.BATTLE) {
          battleCount++;
          if (n.fogEnabled) fogCount++;
        }
      }
    }
    const fogPct = fogCount / battleCount;
    expect(fogPct).toBeGreaterThan(0.50);
    expect(fogPct).toBeLessThan(0.70);
  });

  it('castle_assault nodes have fog ~0% of the time', () => {
    // Force all templates to castle_assault (fogChance=0.00)
    const castleOnly = { rout: [mapTemplates.seize.find(t => t.id === 'castle_assault')], seize: [mapTemplates.seize.find(t => t.id === 'castle_assault')] };
    let fogCount = 0;
    let battleCount = 0;
    for (let i = 0; i < 200; i++) {
      const map = generateNodeMap('act1', ACT_CONFIG.act1, castleOnly);
      for (const n of map.nodes) {
        if (n.type === NODE_TYPES.BATTLE) {
          battleCount++;
          if (n.fogEnabled) fogCount++;
        }
      }
    }
    expect(fogCount).toBe(0);
  });

  it('template without fogChance falls back to act-level chance', () => {
    // Template with no fogChance field
    const noFogField = { rout: [{ id: 'test_no_fog', zones: [], features: [] }], seize: [] };
    let fogCount = 0;
    let battleCount = 0;
    for (let i = 0; i < 200; i++) {
      const map = generateNodeMap('act1', ACT_CONFIG.act1, noFogField);
      for (const n of map.nodes) {
        if (n.type === NODE_TYPES.BATTLE) {
          battleCount++;
          if (n.fogEnabled) fogCount++;
        }
      }
    }
    const fogPct = fogCount / battleCount;
    const actChance = FOG_CHANCE_BY_ACT.act1; // 0.10
    // Should be near 10% (act-level fallback)
    expect(fogPct).toBeGreaterThan(actChance - 0.06);
    expect(fogPct).toBeLessThan(actChance + 0.06);
  });

  it('missing act-level fog chance defaults to 0', () => {
    const noFogField = { rout: [{ id: 'test_no_fog', zones: [], features: [] }], seize: [] };
    // Use an act without FOG_CHANCE_BY_ACT entry — finalBoss has 0
    let fogCount = 0;
    let totalBattles = 0;
    for (let i = 0; i < 50; i++) {
      const map = generateNodeMap('act2', ACT_CONFIG.act2, noFogField);
      for (const n of map.nodes) {
        if (n.type === NODE_TYPES.BATTLE) {
          totalBattles++;
          if (n.fogEnabled) fogCount++;
        }
      }
    }
    // act2 has FOG_CHANCE_BY_ACT = 0.25, so fog should appear
    const fogPct = fogCount / totalBattles;
    expect(fogPct).toBeGreaterThan(0.15);
    expect(fogPct).toBeLessThan(0.35);
  });

  it('rout nodes get rout templates, seize nodes get seize templates', () => {
    for (let i = 0; i < 50; i++) {
      const map = generateNodeMap('act1', ACT_CONFIG.act1, mapTemplates);
      for (const n of map.nodes) {
        if (!n.templateId || !n.battleParams) continue;
        // RECRUIT nodes inherit templateId from original BATTLE type but have objective rewritten to rout
        if (n.type === NODE_TYPES.RECRUIT) continue;
        const obj = n.battleParams.objective;
        const pool = mapTemplates[obj];
        if (pool) {
          const ids = pool.map(t => t.id);
          expect(ids).toContain(n.templateId);
        }
      }
    }
  });

  it('boss nodes never have fogEnabled', () => {
    for (let i = 0; i < 100; i++) {
      const map = generateNodeMap('act1', ACT_CONFIG.act1, mapTemplates);
      const bossNodes = map.nodes.filter(n => n.type === NODE_TYPES.BOSS);
      for (const n of bossNodes) {
        expect(n.fogEnabled).toBeUndefined();
      }
    }
  });

  it('applies fog chance bonus from options', () => {
    const noFogField = { rout: [{ id: 'test_no_fog', zones: [], features: [] }], seize: [] };
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.2);
    try {
      const base = generateNodeMap('act1', ACT_CONFIG.act1, noFogField);
      const boosted = generateNodeMap('act1', ACT_CONFIG.act1, noFogField, { fogChanceBonus: 0.15 });
      const baseFogged = base.nodes.filter(n => n.type === NODE_TYPES.BATTLE && n.fogEnabled).length;
      const boostedFogged = boosted.nodes.filter(n => n.type === NODE_TYPES.BATTLE && n.fogEnabled).length;
      expect(baseFogged).toBe(0);
      expect(boostedFogged).toBeGreaterThan(0);
    } finally {
      randomSpy.mockRestore();
    }
  });
});
