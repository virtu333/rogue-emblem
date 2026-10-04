// ScriptedBattle — the predicates for a battle that teaches instead of counting
// (docs/specs/prologue-chapter.md §8-9). Pure: no Phaser.
//
// A prologue chapter is launched with `battleParams.prologueChapter` (a chapter id of
// data/prologue.json). It plays in one of two ways:
//   - as a node of a prologue run (RunManager.mode === 'prologue'): the battle persists
//     like any run battle (suspend checkpoints, Resume Battle / Continue from Map), its
//     victory commits through completeBattle, and the run save holds it;
//   - standalone, from the title's chapter select: no RunManager, nothing saved.
// Three predicates keep those apart, and every run-layer reader uses one of them,
// never a battleParams field or a mode string of its own, so a new scripted battle
// can't silently turn a system back on (`tests/ScriptedBattleSuppression.test.js`
// drives every reader in both modes and forbids a private flag):
//   isScriptedBattle(battleParams)      teaching suppression, true in BOTH modes: the
//                                       Eclipse, Guidance notes, contextual hints, deeds,
//                                       formation, caravans and villages rolled by
//                                       generation, story beats, the commander's last
//                                       words, the first-battle theme...
//   isStandaloneScriptedBattle(bp, rm)  no run layer at all: nothing to persist, no
//                                       checkpoint to re-open from, no slot to lock.
//   isPrologueRun(runManager)           the run layer's own suppressions on the route
//                                       map and at commit points: the cold open and act
//                                       card, Gaspar's run-start intro, Abandon Run, the
//                                       boss recruit, the third lord, the boss's Vision,
//                                       advanceAct, the act-reached milestone.

export const PROLOGUE_RUN_MODE = 'prologue';
export const STANDARD_RUN_MODE = 'standard';
export const RUN_MODES = Object.freeze([STANDARD_RUN_MODE, PROLOGUE_RUN_MODE]);

/** True for a prologue chapter: `battleParams.prologueChapter` names one. */
export function isScriptedBattle(battleParams) {
  if (!battleParams || typeof battleParams !== 'object') return false;
  return typeof battleParams.prologueChapter === 'string' && battleParams.prologueChapter !== '';
}

/** A scripted battle with no run behind it (the title's replay): nothing is saved. */
export function isStandaloneScriptedBattle(battleParams, runManager) {
  return isScriptedBattle(battleParams) && !runManager;
}

/** A run that is the prologue (the first thread), never a real run. */
export function isPrologueRun(runManager) {
  return Boolean(runManager) && runManager.mode === PROLOGUE_RUN_MODE;
}

/** The authored chapter a scripted battle plays, or null. */
export function prologueChapterOf(battleParams, gameData) {
  const id = battleParams?.prologueChapter;
  if (typeof id !== 'string' || !id) return null;
  const chapters = gameData?.prologue?.chapters;
  return (Array.isArray(chapters) ? chapters : []).find((c) => c?.id === id) || null;
}

/** The battleParams the title launches a standalone prologue chapter with. */
export function prologueBattleParams(chapter, { seed = 0 } = {}) {
  return {
    prologueChapter: chapter.id,
    act: 'act1',
    objective: chapter.objective || 'rout',
    battleSeed: Math.trunc(Number(seed) || 0) >>> 0,
    difficultyId: 'normal',
    fogEnabled: false,
  };
}
