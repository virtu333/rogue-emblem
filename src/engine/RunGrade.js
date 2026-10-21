// RunGrade — the end-of-run letter (S/A/B/C/D), bragging only: it pays nothing. Pure.
// Four bars out of 100, all about how the run was played; the difficulty rung never changes the
// letter, it is shown beside it. How the run was set up (No Meta, a gift, a blessing's burden) is
// not graded: No Meta is an achievement, not a bar every run is held to.

export const SURVIVAL_PENALTY_PER_LOSS = 5;

// What each bar measures and how to score well on it, for the credits' helper tips. The numbers
// come from the bar's own `max` and the constant above, so a retune cannot leave the words behind.
export const GRADE_BARS = Object.freeze([
  {
    key: 'pace',
    label: 'Pace',
    max: 35,
    help: 'The share of your battles won at or under their turn par. Win faster to score.',
  },
  {
    key: 'survival',
    label: 'Survival',
    max: 30,
    help: `Starts full; every ally lost costs ${SURVIVAL_PENALTY_PER_LOSS} points. Keep your army alive.`,
  },
  {
    key: 'resolve',
    label: 'Resolve',
    max: 20,
    help: 'Your worst single battle: the share of the units you sent in that came out alive. One bloodbath drags it down, so retreat or rewind rather than lose a third of your force.',
  },
  {
    key: 'economy',
    label: 'Economy',
    max: 15,
    help: 'Gold put to use: the share of all the gold you received that is not still unspent at the end. Spend it on gear, healing and recruits.',
  },
]);

/** Score needed for each letter, best first; anything lower is a D. */
export const GRADE_CUTOFFS = Object.freeze([
  { letter: 'S', min: 90 },
  { letter: 'A', min: 75 },
  { letter: 'B', min: 55 },
  { letter: 'C', min: 35 },
]);

const plural = (n, one, many) => `${n || 0} ${n === 1 ? one : many}`;
const maxOf = (key) => GRADE_BARS.find((bar) => bar.key === key).max;

export function gradeLetter(score) {
  const hit = GRADE_CUTOFFS.find((c) => score >= c.min);
  return hit ? hit.letter : 'D';
}

/**
 * Grade a won run. `run` is `{ ledger, gold }`; returns null when the run has no ledger (it began
 * before grades) or did not end in victory.
 */
export function gradeRun({ result, ledger, gold = 0 } = {}) {
  if (result !== 'victory' || !ledger) return null;
  const pace = ledger.parBattles > 0 ? ledger.underPar / ledger.parBattles : 1;
  const unspent = Math.max(0, Number(gold) || 0);
  // Share of the gold the run received (its start plus every inflow) that is not left unspent.
  const received = (ledger.goldStart || 0) + (ledger.goldIn || 0);
  const economy = received > 0 ? Math.max(0, 1 - unspent / received) : 1;
  const points = {
    pace: Math.round(pace * maxOf('pace')),
    survival: Math.max(0, maxOf('survival') - SURVIVAL_PENALTY_PER_LOSS * ledger.losses),
    resolve: Math.round(ledger.worstSurvival * maxOf('resolve')),
    economy: Math.round(economy * maxOf('economy')),
  };
  const standing = {
    pace: `${ledger.underPar || 0} of ${ledger.parBattles || 0} battles at or under par`,
    survival: `${plural(ledger.losses, 'ally', 'allies')} lost`,
    resolve: `${Math.round(ledger.worstSurvival * 100)}% of your force came out of your worst battle alive`,
    economy: `${unspent} gold unspent of ${received} received`,
  };
  const bars = GRADE_BARS.map((bar) => ({
    ...bar,
    points: Math.min(bar.max, points[bar.key]),
    standing: standing[bar.key],
  }));
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
