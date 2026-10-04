// ScriptedBattle — the one predicate for a battle that teaches instead of counting
// (docs/specs/prologue-chapter.md §8). Pure: no Phaser.
//
// A prologue chapter is launched with `battleParams.prologueChapter` (a chapter id of
// data/prologue.json) and no RunManager. Every run-layer system the old practice
// tutorial switched off (the Eclipse, Guidance notes, contextual hints, deeds, formation,
// caravans and villages, story beats, the commander's last words, suspend and persist
// writes, battle-intent commits, the portrait re-open) reads this predicate, never a
// battleParams field of its own, so a new scripted battle can't silently turn one back on.
// `tests/ScriptedBattleSuppression.test.js` drives every reader with these params.

/** True for a prologue chapter: `battleParams.prologueChapter` names one. */
export function isScriptedBattle(battleParams) {
  if (!battleParams || typeof battleParams !== 'object') return false;
  return typeof battleParams.prologueChapter === 'string' && battleParams.prologueChapter !== '';
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
