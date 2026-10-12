// descentRunFormatFixtures.js - Descent runs at the moments an older client must refuse them
// (engine/RunFormat.js, the Descent's ids): route entry, a Rite that has taken words, a battle
// checkpoint mid-Vigil and the gate's battle in progress. Real RunManager runs with
// data/descent.json switched on (as it ships), walked by the victory commit the scene calls;
// each battle's map is generated and locked as the scene's entry does. Pure but for Math.random,
// which each run borrows seeded.

import { RunManager } from '../../src/engine/RunManager.js';
import { applyGenerationFields, generateSeededBattle } from '../../src/engine/BattleScout.js';
import { createSeededRng } from '../../src/engine/BlessingEngine.js';
import { createVigilState } from '../../src/engine/Vigil.js';

/** The game data with the Descent switched on (a copy; whatever the data file says). */
export function withDescentOn(gameData) {
  return { ...gameData, descent: { ...structuredClone(gameData.descent), enabled: true } };
}

/**
 * The game data with the Descent switched off (a copy; the data file ships it on): the build
 * before the Descent, whose final act is the old 2-node map.
 */
export function withDescentOff(gameData) {
  return { ...gameData, descent: { ...structuredClone(gameData.descent), enabled: false } };
}

export function withSeededRandom(seed, fn) {
  const previous = Math.random;
  Math.random = createSeededRng(seed >>> 0);
  try {
    return fn();
  } finally {
    Math.random = previous;
  }
}

/** A standard run on `difficultyId`, started (seeded) and not yet in the Descent. */
export function startedRun(gameData, { difficultyId = 'hard', seed = 9 } = {}) {
  return withSeededRandom(seed, () => {
    const run = new RunManager(gameData);
    run.startRun({ runSeed: seed, difficultyId });
    return run;
  });
}

/** A run that has just gone down into the final act (the act before it skipped to its end). */
export function descentEntryRun(gameData, options = {}) {
  const run = startedRun(gameData, options);
  run.actIndex = run.actSequence.indexOf('finalBoss') - 1;
  withSeededRandom(options.seed ?? 9, () => run.advanceAct());
  return run;
}

export const descentNode = (run, key) => run.nodeMap.nodes.find((n) => n.descentKey === key);

/** A node's battle params and map, generated and locked as the scene's entry does. */
export function enterBattle(run, node, { checkpoint = null } = {}) {
  const isBoss = node.type === 'boss';
  const params = applyGenerationFields(run.getBattleParams(node), {
    deployCount: Math.max(1, run.roster.length),
    isBoss,
  });
  const config = generateSeededBattle(params, run.gameData, params.battleSeed);
  run.lockBattleConfig(node.id, config);
  run.currentNodeId = node.id;
  run.beginBattleInProgress(node.id, {
    battleParams: params,
    isBoss,
    isElite: params.isElite === true,
  });
  if (checkpoint) run.battleInProgress.checkpoint = checkpoint;
  return { params, config };
}

/** Win a node's battle as the victory commit does (under par); a Vigil speaks `riteWords`. */
export function winBattle(run, key, options = {}) {
  const node = descentNode(run, key);
  enterBattle(run, node);
  const won = run.completeBattle(
    run.roster.map((u) => structuredClone(u)),
    node.id,
    0,
    { turnCount: 4, turnPar: 12, ...options },
  );
  if (!won) throw new Error(`the ${key} battle was not won`);
  return node;
}

/**
 * A checkpoint written mid-Vigil, in the shape the scene's capture writes
 * (BattleSnapshotState.captureBattleWorldState): its `vigilState` after two enemy phases.
 */
export function midVigilCheckpoint() {
  return {
    version: 1,
    turnNumber: 2,
    phase: 'player',
    playerUnits: [],
    enemyUnits: [],
    vigilState: {
      ...createVigilState(),
      words: 4,
      byVoice: { voice_calling: 2, voice_binding: 2 },
      byCircle: { circle_calling: 1 },
      summoned: 1,
      lastProcessedTurn: 2,
    },
  };
}

/** The Entity road walked to the Vigil's battle, mid-battle (Nightfall: the gate lies ahead). */
export function midVigilRun(gameData, options = {}) {
  const run = descentEntryRun(gameData, { difficultyId: 'hard', ...options });
  winBattle(run, 'stair');
  winBattle(run, 'column');
  enterBattle(run, descentNode(run, 'vigil'), { checkpoint: midVigilCheckpoint() });
  return run;
}

/** The Entity road past the Vigil, whose words the Rite took, and the Landing. */
export function pastVigilRun(gameData, options = {}) {
  const run = descentEntryRun(gameData, { difficultyId: 'hard', ...options });
  winBattle(run, 'stair');
  winBattle(run, 'column');
  winBattle(run, 'vigil', { riteWords: 4 });
  run.markNodeComplete(descentNode(run, 'landing').id);
  return run;
}

/** The gate's battle in progress (the Lieutenant fought as a defeat of `@boss`). */
export function atGateRun(gameData, options = {}) {
  const run = pastVigilRun(gameData, options);
  enterBattle(run, descentNode(run, 'gate'), {
    checkpoint: { version: 1, turnNumber: 1, phase: 'player', playerUnits: [], enemyUnits: [] },
  });
  return run;
}
