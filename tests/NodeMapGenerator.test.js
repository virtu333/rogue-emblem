import { describe, it, expect } from 'vitest';
import { generateNodeMap } from '../src/engine/NodeMapGenerator.js';
import { ACT_CONFIG, NODE_TYPES } from '../src/utils/constants.js';

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

    it('guarantees at least 1 RECRUIT node per act (non-finalBoss)', () => {
      for (let i = 0; i < 50; i++) {
        const map = generateNodeMap('act2', ACT_CONFIG.act2);
        const recruitCount = map.nodes.filter(n => n.type === NODE_TYPES.RECRUIT).length;
        expect(recruitCount).toBeGreaterThanOrEqual(1);
      }
    });

    it('never more than 2 RECRUIT nodes per act', () => {
      for (let i = 0; i < 50; i++) {
        const map = generateNodeMap('act1', ACT_CONFIG.act1);
        const recruitCount = map.nodes.filter(n => n.type === NODE_TYPES.RECRUIT).length;
        expect(recruitCount).toBeLessThanOrEqual(2);
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

    it('act2+ battle nodes have no levelRange in battleParams', () => {
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
  });

  describe('seize objective restricted to later nodes', () => {
    it('row 0 and row 1 battle nodes never have seize objective', () => {
      for (let i = 0; i < 50; i++) {
        const map = generateNodeMap('act1', ACT_CONFIG.act1);
        const earlyBattle = map.nodes.filter(n =>
          n.row <= 1 && n.type === NODE_TYPES.BATTLE
        );
        for (const node of earlyBattle) {
          expect(node.battleParams.objective).toBe('rout');
        }
      }
    });

    it('seize objectives can appear on row 2+ battle nodes', () => {
      let foundSeize = false;
      for (let i = 0; i < 100; i++) {
        const map = generateNodeMap('act1', ACT_CONFIG.act1);
        const laterBattle = map.nodes.filter(n =>
          n.row >= 2 && n.type === NODE_TYPES.BATTLE
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
    // Generate 1000 maps, count CHURCH nodes, expect ~20% of middle-row nodes
    let totalMiddle = 0;
    let totalChurch = 0;
    for (let i = 0; i < 1000; i++) {
      const map = generateNodeMap('act1', ACT_CONFIG.act1);
      const middleNodes = map.nodes.filter(n => n.row > 1 && n.row < ACT_CONFIG.act1.rows - 1);
      totalMiddle += middleNodes.length;
      totalChurch += middleNodes.filter(n => n.type === NODE_TYPES.CHURCH).length;
    }
    const churchPercent = (totalChurch / totalMiddle) * 100;
    expect(churchPercent).toBeGreaterThan(15); // 20% ± margin
    expect(churchPercent).toBeLessThan(25);
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
