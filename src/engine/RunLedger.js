import { gradeRun } from './RunGrade.js';

// RunLedger — the run's own tally for the end-of-run grade and credits (pure, saved as
// `runLedger`, an inert run key: an older client ignores it). Written only at a victory commit
// (RunManager.completeBattle), so a suspend, a Vision rewind or Continue from Map never touches
// it. A run saved before it has none and is simply not graded.

/** A gap between two victories longer than this counts as the player being away. */
export const ACTIVE_GAP_CAP_MS = 30 * 60 * 1000;

const count = (v) => Math.max(0, Math.trunc(Number(v)) || 0);

export function createRunLedger(now = Date.now()) {
  return {
    v: 1,
    startedAt: Number.isFinite(now) ? now : 0,
    lastAt: Number.isFinite(now) ? now : 0,
    activeMs: 0,
    parBattles: 0,
    underPar: 0,
    battleGold: 0,
    losses: 0,
    // The smallest share of an entering army that came out alive in any one battle (0..1).
    worstSurvival: 1,
  };
}

/** A whole v1 ledger, or null for anything else. */
export function sanitizeRunLedger(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.v !== 1) return null;
  const worst = Number(raw.worstSurvival);
  return {
    v: 1,
    startedAt: count(raw.startedAt),
    lastAt: count(raw.lastAt),
    activeMs: count(raw.activeMs),
    parBattles: count(raw.parBattles),
    underPar: Math.min(count(raw.underPar), count(raw.parBattles)),
    battleGold: count(raw.battleGold),
    losses: count(raw.losses),
    worstSurvival: Number.isFinite(worst) ? Math.max(0, Math.min(1, worst)) : 1,
  };
}

/**
 * One won battle: `{ turnCount, turnPar, gold, survivors, fallen, now }`. Returns the new
 * ledger (a null ledger stays null: the run predates it).
 */
export function recordLedgerBattle(ledger, battle = {}) {
  const base = sanitizeRunLedger(ledger);
  if (!base) return null;
  const now = Number.isFinite(battle.now) ? battle.now : Date.now();
  const hasPar = Number.isFinite(battle.turnPar) && battle.turnPar > 0;
  const turns = Number(battle.turnCount);
  const fallen = count(battle.fallen);
  const entered = count(battle.survivors) + fallen;
  return {
    ...base,
    lastAt: now,
    activeMs: base.activeMs + Math.min(ACTIVE_GAP_CAP_MS, Math.max(0, now - base.lastAt)),
    parBattles: base.parBattles + (hasPar && Number.isFinite(turns) ? 1 : 0),
    underPar: base.underPar + (hasPar && Number.isFinite(turns) && turns <= battle.turnPar ? 1 : 0),
    battleGold: base.battleGold + count(battle.gold),
    losses: base.losses + fallen,
    worstSurvival:
      entered > 0
        ? Math.min(base.worstSurvival, count(battle.survivors) / entered)
        : base.worstSurvival,
  };
}

/** The ledger with the time since the last victory counted, for the run's end. */
export function closeRunLedger(ledger, now = Date.now()) {
  const base = sanitizeRunLedger(ledger);
  if (!base) return null;
  return {
    ...base,
    lastAt: now,
    activeMs: base.activeMs + Math.min(ACTIVE_GAP_CAP_MS, Math.max(0, now - base.lastAt)),
  };
}

/** The run's ledger after a won battle, in completeBattle's own terms (options, final gold, who lived and fell). */
export function settleLedger(rm, options, gold, survivors, fallen) {
  return recordLedgerBattle(rm.runLedger, {
    turnCount: options?.turnCount,
    turnPar: options?.turnPar,
    gold,
    survivors: survivors?.length,
    fallen: fallen?.length,
  });
}

/** The grade of a run manager's run (null unless a graded run was won). */
export function gradeRunOf(rm, result = rm?.status) {
  return gradeRun({
    result,
    ledger: rm?.runLedger,
    gold: rm?.gold,
    noMetaMode: rm?.noMetaMode === true,
    burdens: rm?.burdens,
  });
}

/** Time actually played, ms (idle gaps capped); null for a run without a ledger. */
export function runPlayTimeOf(rm, now = Date.now()) {
  return closeRunLedger(rm?.runLedger, now)?.activeMs ?? null;
}

/** The victory record's `grade` key (`{}` when the run has none). */
export function gradeRecordField(rm, result) {
  const grade = gradeRunOf(rm, result);
  return grade ? { grade: { letter: grade.letter, score: grade.score } } : {};
}
