// The EXP bar in unit profiles (docs/specs/exp-bars.md §3.1), beside healthBar.js.
// Presentation only: it reads a unit's XP (engine/XpProgress) and never writes it.
// Player units only: enemies and NPCs have no EXP to show.
import { XP_PER_LEVEL } from '../utils/constants.js';
import { xpSnapshot } from '../engine/XpProgress.js';

/** Whether a unit's profile shows EXP at all. */
export function showsXp(unit) {
  return unit?.faction === 'player';
}

/** The bar's facts: the XP shown, and whether the unit is at its level cap (MAX). */
export function xpBarFacts(unit, { extendedLevelingEnabled = false } = {}) {
  const snapshot = xpSnapshot(unit, { extendedLevelingEnabled });
  const xp = Math.min(snapshot.xp, XP_PER_LEVEL - 1);
  return snapshot.capped
    ? { capped: true, xp, value: 'MAX', text: 'EXP MAX, at the level cap', ratio: 1 }
    : {
        capped: false,
        xp,
        value: `${xp}/${XP_PER_LEVEL}`,
        text: `${xp} of ${XP_PER_LEVEL} EXP`,
        ratio: xp / XP_PER_LEVEL,
      };
}

/**
 * The meter: `span.re-xp[role=meter]` with its fill, or null for a unit that shows
 * no EXP. At the level cap the bar is full in the muted colour and reads MAX.
 * `extendedLevelingEnabled` (the run's difficulty) keeps a promoted unit at 20
 * filling a normal bar.
 */
export function createXpBar(unit, { extendedLevelingEnabled = false } = {}) {
  if (!showsXp(unit)) return null;
  const facts = xpBarFacts(unit, { extendedLevelingEnabled });
  const bar = document.createElement('span');
  bar.className = facts.capped ? 're-xp is-max' : 're-xp';
  bar.setAttribute('role', 'meter');
  bar.setAttribute('aria-label', `${unit.name} EXP`);
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', String(XP_PER_LEVEL));
  bar.setAttribute('aria-valuenow', String(facts.capped ? XP_PER_LEVEL : facts.xp));
  bar.setAttribute('aria-valuetext', facts.text);
  const fill = document.createElement('span');
  fill.className = 're-xp-fill';
  fill.style.width = `${facts.ratio * 100}%`;
  bar.append(fill);
  return bar;
}

/**
 * The profile row under the HP bar: "EXP [bar] 45/100" (or MAX), or null for a unit
 * that shows no EXP.
 */
export function createXpRow(unit, options = {}) {
  const bar = createXpBar(unit, options);
  if (!bar) return null;
  const facts = xpBarFacts(unit, options);
  const row = document.createElement('span');
  row.className = 're-xp-row';
  const label = document.createElement('span');
  label.className = 're-xp-label';
  label.textContent = 'EXP';
  label.setAttribute('aria-hidden', 'true');
  const value = document.createElement('span');
  value.className = 're-xp-value';
  value.textContent = facts.value;
  value.setAttribute('aria-hidden', 'true');
  row.append(label, bar, value);
  return row;
}
