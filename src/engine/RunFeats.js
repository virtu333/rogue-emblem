// RunFeats — the few run counters the achievements read that the run keeps nowhere else
// (docs/specs/achievements.md). Saved as `run.feats` (an older client ignores it: RunFormat
// 'inert'); a save from before it reads as all zero.
//
// Only out-of-battle commits write it (a shop purchase, a boss draft's pick, a contract paid,
// an arena win) and the victory commit (`completeBattle`: the battle's falls and its par), so
// a Vision rewind or Continue from Map never has to take a count back.
//
// Pure: no Phaser, no DOM, never the RNG.

export const RUN_FEAT_KEYS = Object.freeze([
  'shopBuys',
  'bossRecruits',
  'contractsPaid',
  'arenaGoldWins',
  'arenaPlatinumWins',
  'allyFalls',
  'battlesWon',
  'overPar',
]);

const MAX = 999_999;
const whole = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Math.trunc(Number(v))) : 0);

export function emptyRunFeats() {
  const out = { v: 1 };
  for (const key of RUN_FEAT_KEYS) out[key] = 0;
  return out;
}

/** A saved `run.feats`, cleaned (anything missing or garbled reads as 0). */
export function sanitizeRunFeats(raw) {
  const out = emptyRunFeats();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const key of RUN_FEAT_KEYS) out[key] = Math.min(MAX, whole(raw[key]));
  return out;
}

/** Add `by` to one counter (the run's `feats` is created when missing). */
export function bumpRunFeat(run, key, by = 1) {
  if (!run || !RUN_FEAT_KEYS.includes(key)) return;
  const feats = sanitizeRunFeats(run.feats);
  feats[key] = Math.min(MAX, feats[key] + whole(by));
  run.feats = feats;
}

export function runFeat(run, key) {
  return sanitizeRunFeats(run?.feats)[key] || 0;
}

/** The victory commit's counts: one more win, the battle's falls, and whether it ran past par. */
export function recordVictoryFeats(run, { fallen = 0, turnCount = 0, turnPar = 0 } = {}) {
  bumpRunFeat(run, 'battlesWon');
  if (whole(fallen)) bumpRunFeat(run, 'allyFalls', fallen);
  if (whole(turnPar) > 0 && whole(turnCount) > whole(turnPar)) bumpRunFeat(run, 'overPar');
}
