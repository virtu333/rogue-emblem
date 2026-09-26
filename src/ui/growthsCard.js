// Roster "Growths" card: one bar per stat (the chance it rises on a level-up), tiered
// high / mid / low, with the stat a level-up falls back to when every roll fails.
import { XP_STAT_NAMES } from '../utils/constants.js';
import { levelUpFallbackStat } from '../engine/UnitManager.js';
import './growthsCard.css';

export const GROWTH_TIERS = { high: 60, mid: 30 };

const STAT_NAMES = {
  HP: 'HP',
  STR: 'Strength',
  MAG: 'Magic',
  SKL: 'Skill',
  SPD: 'Speed',
  DEF: 'Defense',
  RES: 'Resistance',
  LCK: 'Luck',
};

/** Pure rows for the card, in level-up order. */
export function growthRows(growths = {}) {
  const fallback = levelUpFallbackStat(growths);
  return XP_STAT_NAMES.filter((stat) => growths[stat] != null).map((stat) => {
    const value = Number(growths[stat]) || 0;
    const tier = value >= GROWTH_TIERS.high ? 'high' : value >= GROWTH_TIERS.mid ? 'mid' : 'low';
    return {
      stat,
      name: STAT_NAMES[stat] || stat,
      value,
      fill: Math.max(0, Math.min(100, value)),
      tier,
      fallback: stat === fallback,
    };
  });
}

export function growthsNote(growths = {}) {
  const fallback = levelUpFallbackStat(growths);
  return `Chance each stat rises on a level-up. If none do, ${STAT_NAMES[fallback] || fallback}\u00a0◆ still gains +1.`;
}

function node(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text != null) n.textContent = text;
  return n;
}

/** A collapsible card (closed by default, like before). */
export function growthsCard(growths) {
  const details = node('details', 'mr-card mr-growths');
  const summary = node('summary');
  summary.append(node('span', 'mr-growths-title', 'Growths'));
  details.append(summary, node('p', 'mr-growths-note', growthsNote(growths)));
  const list = node('ul', 'mr-growths-list');
  for (const row of growthRows(growths)) {
    const item = node('li', `mr-growth is-${row.tier}${row.fallback ? ' is-fallback' : ''}`);
    const label = node('span', 'mr-growth-stat', row.stat);
    label.title = row.name;
    if (row.fallback) {
      const mark = node('span', 'mr-growth-mark', '◆');
      mark.setAttribute('role', 'img');
      mark.setAttribute('aria-label', 'gains +1 if every roll fails');
      label.append(mark);
    }
    const bar = node('span', 'mr-growth-bar');
    bar.setAttribute('aria-hidden', 'true');
    const fill = node('span', 'mr-growth-fill');
    fill.style.width = `${row.fill}%`;
    bar.append(fill);
    item.append(label, bar, node('span', 'mr-growth-value', `${row.value}%`));
    list.append(item);
  }
  details.append(list);
  return details;
}
