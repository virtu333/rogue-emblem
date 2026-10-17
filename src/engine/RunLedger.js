import { gradeRun } from './RunGrade.js';
import { deedStats, findFallenBattleRecord, sanitizeBattleDeeds } from './DeedSystem.js';
import { resolveBattleCasualties } from './UnitIdentity.js';

// RunLedger — the run's own tally for the end-of-run grade and credits (pure, saved as
// `runLedger`, an inert run key: an older client ignores it). Written only at a victory commit
// (RunManager.completeBattle), so a suspend, a Vision rewind or Continue from Map never touches
// it. A run saved before it has none and is simply not graded.

/** A gap between two victories longer than this counts as the player being away. */
export const ACTIVE_GAP_CAP_MS = 30 * 60 * 1000;

const count = (v) => Math.max(0, Math.trunc(Number(v)) || 0);

export function createRunLedger(now = Date.now(), startGold = 0) {
  return {
    v: 1,
    startedAt: Number.isFinite(now) ? now : 0,
    lastAt: Number.isFinite(now) ? now : 0,
    activeMs: 0,
    parBattles: 0,
    underPar: 0,
    // Gold the run began with, then every inflow and outflow after it (RunManager.addGold /
    // spendGold): Economy is the share of what was received that is not left unspent.
    goldStart: count(startGold),
    goldIn: 0,
    goldOut: 0,
    losses: 0,
    // The smallest share of an entering army that came out alive in any one battle (0..1).
    worstSurvival: 1,
    // How a lost run ended (terminalSummary), kept beside the tally; null for a win.
    terminal: null,
  };
}

const text = (v, max = 40) => (typeof v === 'string' ? v.slice(0, max) : '');

function sanitizeTerminalUnit(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.name !== 'string' || !raw.name) return null;
  return {
    name: text(raw.name),
    className: text(raw.className),
    level: count(raw.level),
    kills: count(raw.kills),
  };
}

/** A whole terminal summary (`{ turns, survivors, fallen }`), or null. */
export function sanitizeTerminalSummary(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const units = (list) =>
    (Array.isArray(list) ? list : []).slice(0, 64).map(sanitizeTerminalUnit).filter(Boolean);
  return { turns: count(raw.turns), survivors: units(raw.survivors), fallen: units(raw.fallen) };
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
    goldStart: count(raw.goldStart),
    goldIn: count(raw.goldIn),
    goldOut: count(raw.goldOut),
    losses: count(raw.losses),
    worstSurvival: Number.isFinite(worst) ? Math.max(0, Math.min(1, worst)) : 1,
    terminal: sanitizeTerminalSummary(raw.terminal),
  };
}

/**
 * One won battle: `{ turnCount, turnPar, survivors, fallen, now }` (survivors and fallen are counts of the
 * force that fought, never the bench). Returns the new
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

/**
 * The run's ledger after a won battle, in completeBattle's own terms. `options.deployedSurvivors`
 * is how many of the force that fought stood at the end (escaped units included, a mid-battle
 * recruit counted where it stood); the benched are not part of the battle, so a caller that
 * does not say falls back to every unit handed over.
 */
export function settleLedger(rm, options, survivors, fallen) {
  const stood = Number.isFinite(options?.deployedSurvivors)
    ? options.deployedSurvivors
    : survivors?.length;
  return recordLedgerBattle(rm.runLedger, {
    turnCount: options?.turnCount,
    turnPar: options?.turnPar,
    survivors: stood,
    fallen: fallen?.length,
  });
}

/** A gold flow: positive in, negative out (RunManager.addGold, spendGold). A null ledger stays null. */
export function tallyGold(ledger, amount) {
  const n = Math.trunc(Number(amount)) || 0;
  if (!ledger || n === 0) return ledger;
  return n > 0
    ? { ...ledger, goldIn: ledger.goldIn + n }
    : { ...ledger, goldOut: ledger.goldOut - n };
}

const killsOf = (unit) =>
  count(deedStats(unit).kills) + count(sanitizeBattleDeeds(unit?._battleDeeds).kills);

const terminalUnit = (unit, kills) => ({
  name: unit.name,
  className: unit.className || '',
  level: count(unit.level),
  kills,
});

/**
 * How a lost run ended, taken before the checkpoint is cleared: who still stands (the battle's
 * live units, escaped ones included, and the bench) and who fell in this last battle, with
 * their kills counting what they did there. `roster` is the army as it entered; `survivors` are
 * the battle's live units; `benched` the units that did not deploy.
 */
export function buildTerminalSummary({
  roster = [],
  survivors = [],
  benched = [],
  fallenRecruits = [],
  fallenBattleRecords = [],
  turnCount = 0,
  isValidUnit,
} = {}) {
  const { newlyFallen } = resolveBattleCasualties({
    roster,
    survivors: [...survivors, ...benched],
    fallenRecruits,
    isValidUnit,
  });
  const fallen = newlyFallen.map((unit) => {
    const record = findFallenBattleRecord(fallenBattleRecords, unit);
    const scratch = count(sanitizeBattleDeeds(record?.battleDeeds).kills);
    return terminalUnit(unit, count(deedStats(unit).kills) + scratch);
  });
  return sanitizeTerminalSummary({
    turns: turnCount,
    survivors: [...survivors, ...benched].map((unit) => terminalUnit(unit, killsOf(unit))),
    fallen,
  });
}

/** The ledger with a lost run's terminal summary (a null ledger stays null). */
export function withTerminalSummary(ledger, terminal) {
  return ledger ? { ...ledger, terminal: sanitizeTerminalSummary(terminal) } : ledger;
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
