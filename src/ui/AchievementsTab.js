// AchievementsTab — the Records screen's second tab (docs/specs/achievements.md §5): a summary
// (earned of all, a bar, a medal count per tier) and one list per section, each row a medal,
// a name, its rule, and its date or progress. Content comes from ui/achievementsModel.js;
// this file only lays it out. Styles: achievements.css.

import { element } from './MenuSurface.js';
import { achievementsView } from './achievementsModel.js';
import { achievementsOnDevice } from '../engine/AchievementStore.js';
import { achievementTotals } from '../engine/AchievementFacts.js';

/** A tier's medal: a CSS disc (the Black Sun's with its dark corona). Decorative. */
export function achievementMedal(tier, { earned = true, hidden = false } = {}) {
  const medal = element('span', null, 'ach-medal');
  medal.dataset.tier = tier;
  if (!earned) medal.classList.add('is-locked');
  if (hidden) medal.classList.add('is-hidden');
  medal.setAttribute('aria-hidden', 'true');
  medal.append(element('span', hidden ? '?' : null, 'ach-medal-face'));
  return medal;
}

function progressBar(have, goal, className) {
  const bar = element('span', null, className);
  bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', String(goal));
  bar.setAttribute('aria-valuenow', String(have));
  const fill = element('span', null, `${className}-fill`);
  fill.style.width = `${goal > 0 ? Math.round((have * 100) / goal) : 0}%`;
  bar.append(fill);
  return bar;
}

function row(entry) {
  const li = element('li', null, `ach-row${entry.earned ? ' is-earned' : ''}`);
  li.dataset.id = entry.id;
  li.dataset.tier = entry.tier;
  if (entry.hidden) li.classList.add('is-hidden');
  li.append(achievementMedal(entry.tier, { earned: entry.earned, hidden: entry.hidden }));
  const text = element('div', null, 'ach-text');
  const head = element('div', null, 'ach-head');
  head.append(element('strong', entry.name, 'ach-name'));
  head.append(element('span', entry.tierLabel, 'ach-tier'));
  text.append(head, element('p', entry.rule, 'ach-rule'));
  if (entry.earned)
    text.append(element('p', entry.date ? `Earned ${entry.date}` : 'Earned', 'ach-when')); // prettier-ignore
  else if (entry.progress) {
    const line = element('div', null, 'ach-progress');
    line.append(
      progressBar(entry.progress.have, entry.progress.goal, 'ach-bar'),
      element('span', `${entry.progress.have} / ${entry.progress.goal}`, 'ach-count'),
    );
    text.append(line);
  }
  li.append(text);
  li.setAttribute(
    'aria-label',
    `${entry.name}, ${entry.tierLabel}. ${entry.rule} ${entry.earned ? 'Earned.' : 'Not yet earned.'}`,
  );
  return li;
}

/**
 * Lay the tab out in `container` (its children replaced). `state` defaults to every copy on
 * this device; `gameData` gives the totals the counted ones need.
 */
export function renderAchievementsTab(container, { gameData = {}, state = null } = {}) {
  const view = achievementsView(state ?? achievementsOnDevice(), {
    totals: achievementTotals(gameData),
  });
  const summary = element('section', null, 'ach-summary re-bracket');
  summary.setAttribute('aria-label', 'Achievements earned');
  const top = element('div', null, 'ach-summary-top');
  top.append(
    element('strong', `${view.earned} / ${view.total}`, 'ach-total'),
    element('span', `${view.percent}% earned`, 'ach-percent'),
  );
  summary.append(top, progressBar(view.earned, view.total, 'ach-summary-bar'));
  const tiers = element('ul', null, 'ach-tiers');
  for (const tier of view.byTier) {
    const li = element('li', null, 'ach-tier-count');
    li.dataset.tier = tier.tier;
    li.append(
      achievementMedal(tier.tier, { earned: tier.earned > 0 }),
      element('span', `${tier.label} ${tier.earned}/${tier.total}`),
    );
    tiers.append(li);
  }
  summary.append(tiers);
  summary.append(
    element(
      'p',
      'Shared by every save slot on this device. They change nothing in play.',
      'ach-note',
    ),
  );
  const parts = [summary];
  for (const section of view.sections) {
    const h = element('h3', section.label, 'rr-section-title ach-section-title');
    h.append(' ', element('span', `${section.earned}/${section.total}`, 'rr-count'));
    const list = element('ul', null, 'ach-list');
    for (const entry of section.rows) list.append(row(entry));
    parts.push(h, list);
  }
  container.replaceChildren(...parts);
  return view;
}
