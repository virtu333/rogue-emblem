// RunGrade — the end-of-run letter (S/A/B/C/D), bragging only: it pays nothing. Pure.
// Five bars out of 100; the difficulty rung never changes the letter, it is shown beside it.

export const GRADE_BARS = Object.freeze([
  { key: 'pace', label: 'Pace', max: 30 },
  { key: 'survival', label: 'Survival', max: 25 },
  { key: 'resolve', label: 'Resolve', max: 20 },
  { key: 'economy', label: 'Economy', max: 10 },
  { key: 'restraint', label: 'Restraint', max: 15 },
]);

/** Score needed for each letter, best first; anything lower is a D. */
export const GRADE_CUTOFFS = Object.freeze([
  { letter: 'S', min: 90 },
  { letter: 'A', min: 75 },
  { letter: 'B', min: 55 },
  { letter: 'C', min: 35 },
]);

export const SURVIVAL_PENALTY_PER_LOSS = 5;
export const NO_META_POINTS = 9;
export const BURDEN_POINTS = [6, 3, 0];

export function gradeLetter(score) {
  const hit = GRADE_CUTOFFS.find((c) => score >= c.min);
  return hit ? hit.letter : 'D';
}

/**
 * Grade a won run. `run` is `{ ledger, gold, noMetaMode, burdens }`; returns null when the run
 * has no ledger (it began before grades) or did not end in victory.
 */
export function gradeRun({ result, ledger, gold = 0, noMetaMode = false, burdens = [] } = {}) {
  if (result !== 'victory' || !ledger) return null;
  const pace = ledger.parBattles > 0 ? ledger.underPar / ledger.parBattles : 1;
  const unspent = Math.max(0, Number(gold) || 0);
  // Share of the gold the run received (its start plus every inflow) that is not left unspent.
  const received = (ledger.goldStart || 0) + (ledger.goldIn || 0);
  const economy = received > 0 ? Math.max(0, 1 - unspent / received) : 1;
  const carried = Array.isArray(burdens) ? burdens.length : 0;
  const points = {
    pace: Math.round(pace * 30),
    survival: Math.max(0, 25 - SURVIVAL_PENALTY_PER_LOSS * ledger.losses),
    resolve: Math.round(ledger.worstSurvival * 20),
    economy: Math.round(economy * 10),
    restraint: (noMetaMode ? NO_META_POINTS : 0) + BURDEN_POINTS[Math.min(carried, 2)],
  };
  const bars = GRADE_BARS.map((bar) => ({ ...bar, points: Math.min(bar.max, points[bar.key]) }));
  const score = bars.reduce((sum, bar) => sum + bar.points, 0);
  return { score, letter: gradeLetter(score), bars };
}

/** "1h 12m" / "42m" / "<1m" for a duration in ms. */
export function formatPlayTime(ms) {
  const minutes = Math.floor(Math.max(0, Number(ms) || 0) / 60000);
  if (minutes < 1) return '<1m';
  const h = Math.floor(minutes / 60);
  return h > 0 ? `${h}h ${String(minutes % 60).padStart(2, '0')}m` : `${minutes}m`;
}
