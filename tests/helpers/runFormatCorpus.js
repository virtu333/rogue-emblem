// runFormatCorpus.js - the corpus RunFormatRegistry.test.js takes its key census over
// (docs/specs/large-maps/04-set-pieces.md §12.1 step 8, test 24): real runs on every rung and
// act, their nodes' params, the maps generated for every battle node, and every event set piece
// on every rung and act. Pure but for Math.random, which each run and map borrows seeded.

import { RunManager } from '../../src/engine/RunManager.js';
import { DIFFICULTY_IDS } from '../../src/engine/DifficultyEngine.js';
import { applyGenerationFields, generateSeededBattle } from '../../src/engine/BattleScout.js';
import { setPieceList } from '../../src/engine/SetPieces.js';
import { createSeededRng } from '../../src/engine/BlessingEngine.js';

const BATTLE_NODE_TYPES = new Set(['battle', 'boss', 'recruit']);

function withSeed(seed, fn) {
  const previous = Math.random;
  Math.random = createSeededRng(seed >>> 0);
  try {
    return fn();
  } finally {
    Math.random = previous;
  }
}

/**
 * Walk `seeds` runs on each rung through every act. `visit` receives
 * { kind: 'run' | 'nodeParams' | 'battleParams' | 'config', value, where }.
 */
export function walkRunFormatCorpus(gameData, { seeds = 3, visit }) {
  for (const difficultyId of DIFFICULTY_IDS) {
    for (let seed = 1; seed <= seeds; seed++) {
      withSeed(seed * 7919 + difficultyId.length, () => {
        const run = new RunManager(gameData);
        run.startRun({ runSeed: seed, difficultyId });
        const acts = run.actSequence.length;
        for (let act = 0; act < acts; act++) {
          const where = `${difficultyId}#${seed} act ${act + 1}`;
          for (const node of run.nodeMap?.nodes || []) {
            if (!node.battleParams) continue;
            visit({ kind: 'nodeParams', value: node.battleParams, where: `${where} ${node.id}` });
            if (!BATTLE_NODE_TYPES.has(node.type)) continue;
            const params = run.getBattleParams(node);
            if (!params) continue;
            applyGenerationFields(params, {
              deployCount: Math.max(1, run.roster.length),
              isBoss: node.type === 'boss',
            });
            visit({ kind: 'battleParams', value: params, where: `${where} ${node.id}` });
            const config = generateSeededBattle(params, gameData, seed * 31 + act);
            visit({ kind: 'config', value: config, where: `${where} ${node.id}` });
          }
          visit({ kind: 'run', value: run.toJSON(), where });
          if (act < acts - 1) run.advanceAct();
        }
      });
    }
  }
  // Every event set piece (#282) on every rung and act.
  const base = new RunManager(gameData);
  withSeed(1, () => base.startRun({ runSeed: 1, difficultyId: 'normal' }));
  const node = base.nodeMap.nodes.find((n) => n.type === 'battle' && n.battleParams);
  for (const piece of setPieceList(gameData.setPieces)) {
    for (const difficultyId of DIFFICULTY_IDS) {
      for (const act of ['act1', 'act2', 'act3', 'act4']) {
        const params = {
          ...base.getBattleParams(node),
          act,
          difficultyId,
          setPiece: piece.id,
          objective: piece.objective || 'rout',
        };
        applyGenerationFields(params, { deployCount: 6, isBoss: false });
        const where = `set piece ${piece.id} ${difficultyId} ${act}`;
        visit({ kind: 'battleParams', value: params, where });
        visit({ kind: 'config', value: generateSeededBattle(params, gameData, 5), where });
      }
    }
  }
}
