// runCreditsModel — what the run's end credits say (pure; the DOM is in runCreditsView.js).

import { deedStats } from '../engine/DeedSystem.js';
import { everFallenUnits } from '../engine/LaidToRest.js';
import { formatPlayTime } from '../engine/RunGrade.js';
import { runPlayTimeOf } from '../engine/RunLedger.js';

// A live unit's deed tally, or a terminal summary entry's own `kills`.
const kills = (unit) => Math.max(0, Math.trunc(Number(unit?.kills ?? deedStats(unit).kills)) || 0);

/** The unit with the most kills across the army and the fallen (null when nobody has one). */
export function runMvp(roster = [], fallen = []) {
  let best = null;
  for (const unit of [...roster, ...fallen]) {
    const n = kills(unit);
    if (n > 0 && typeof unit?.name === 'string' && (!best || n > best.kills))
      best = { name: unit.name, className: unit.className || '', kills: n };
  }
  return best;
}

/**
 * `{ grade, details }`: the grade (null for a defeat or an ungraded run) and
 * `[{ key, label, value }]` rows, only what the run knows.
 */
export function runCreditsModel(rm, { result, grade = null, gameData = null, now } = {}) {
  const details = [];
  const add = (key, label, value) => {
    if (value != null && value !== '') details.push({ key, label, value: String(value) });
  };
  const ledger = rm?.runLedger;
  const playMs = runPlayTimeOf(rm, now);
  if (playMs != null) add('time', 'Time played', formatPlayTime(playMs));
  // A lost run's last battle is not in the run's totals yet: its summary (taken at the defeat,
  // before the checkpoint was cleared) carries the final army, the fallen and the turns played.
  const terminal = result === 'victory' ? null : ledger?.terminal;
  if (Number.isFinite(rm?.totalTurns))
    add('turns', 'Turns', rm.totalTurns + (terminal?.turns || 0));
  if (ledger?.parBattles > 0)
    add('par', 'At or under par', `${ledger.underPar} of ${ledger.parBattles} battles`);
  const roster = terminal ? terminal.survivors : rm?.roster || [];
  const fallen = [...everFallenUnits(rm), ...(terminal?.fallen || [])];
  add('army', 'Survivors', roster.length);
  add('fallen', 'Fallen', fallen.length ? fallen.map((u) => u.name).join(', ') : 'None');
  const mvp = runMvp(roster, fallen);
  if (mvp) add('mvp', 'Most kills', `${mvp.name} (${mvp.className}) · ${mvp.kills}`);
  const blessings = (gameData?.blessings?.blessings || []).filter((b) =>
    (rm?.getActiveBlessingIds?.() || []).includes(b.id),
  );
  if (blessings.length) add('blessings', 'Blessings', blessings.map((b) => b.name).join(', '));
  if (rm?.startGift?.id) add('gift', 'Start gift', rm.startGift.id.replace(/_/g, ' '));
  add('seed', 'Seed', rm?.runSeed);
  return { grade: result === 'victory' ? grade : null, details };
}
