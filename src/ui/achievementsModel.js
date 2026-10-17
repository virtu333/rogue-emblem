// achievementsModel — what the Records screen's Achievements tab, the Home Base chip and the
// unlock card show (docs/specs/achievements.md §5, §6). Pure: plain data in, plain data out.
//
// A secret achievement not yet earned shows "???" in place of its name and its rule; once
// earned it shows both. A counted one shows its progress ("3 / 5") until it is earned.

import {
  ACHIEVEMENT_TIERS,
  achievementCatalog,
  achievementEntries,
  achievementProgress,
  isEarned,
  normalizeAchievementState,
} from '../engine/Achievements.js';

export const HIDDEN_TEXT = '???';
export const HIDDEN_RULE = 'A secret. Keep playing.';

const tierLabels = (catalog) =>
  Object.fromEntries((catalog.tiers || []).map((t) => [t.id, t.label || t.id]));

/** "Oct 17, 2026" (an unknown date: null). */
export function earnedDate(at) {
  if (!(Number(at) > 0)) return null;
  try {
    return new Date(Number(at)).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return null;
  }
}

/** One entry as a row: what it is called, what it asks, whether and when it was earned. */
export function achievementRow(entry, state, { totals = {}, catalog = achievementCatalog() } = {}) {
  const earned = isEarned(state, entry.id);
  const hidden = entry.secret === true && !earned;
  const progress = earned ? null : achievementProgress(state, entry, totals);
  return {
    id: entry.id,
    name: hidden ? HIDDEN_TEXT : entry.name,
    rule: hidden ? HIDDEN_RULE : entry.rule,
    tier: entry.tier,
    tierLabel: tierLabels(catalog)[entry.tier] || entry.tier,
    secret: entry.secret === true,
    hidden,
    earned,
    date: earned ? earnedDate(state.earned[entry.id]?.at) : null,
    progress: progress && progress.goal > 0 ? progress : null,
  };
}

/**
 * The whole tab: a summary (earned of all, and by tier) and the sections in catalog order.
 * Achievements a newer build earned that this one does not know are left out of the counts.
 */
export function achievementsView(rawState, { totals = {}, catalog = achievementCatalog() } = {}) {
  const state = normalizeAchievementState(rawState);
  const entries = achievementEntries(catalog);
  const rows = entries.map((entry) => ({
    section: entry.section,
    row: achievementRow(entry, state, { totals, catalog }),
  }));
  const sections = (catalog.sections || []).map((section) => {
    const items = rows.filter((r) => r.section === section.id).map((r) => r.row);
    return {
      id: section.id,
      label: section.label || section.id,
      earned: items.filter((r) => r.earned).length,
      total: items.length,
      rows: items,
    };
  });
  const byTier = ACHIEVEMENT_TIERS.map((tier) => {
    const items = rows.filter((r) => r.row.tier === tier);
    return {
      tier,
      label: tierLabels(catalog)[tier] || tier,
      earned: items.filter((r) => r.row.earned).length,
      total: items.length,
    };
  });
  const earned = rows.filter((r) => r.row.earned).length;
  return {
    earned,
    total: rows.length,
    percent: rows.length ? Math.floor((earned * 100) / rows.length) : 0,
    byTier,
    sections: sections.filter((s) => s.total > 0),
  };
}

/** The Home Base chip's words: "Achievements 12 / 69". */
export function achievementChipText(rawState, catalog = achievementCatalog()) {
  const view = achievementsView(rawState, { catalog });
  return { label: 'Achievements', count: `${view.earned} / ${view.total}` };
}

/**
 * The unlock card's content for one notice. `ids` are newly earned; `retro` marks the
 * retroactive pass, told as one card ("From your past runs: 6 achievements").
 * Returns a list of cards (one per achievement, or the one summary).
 */
export function unlockCards(ids, { retro = false, catalog = achievementCatalog() } = {}) {
  const byId = new Map(achievementEntries(catalog).map((e) => [e.id, e]));
  const known = (Array.isArray(ids) ? ids : []).map((id) => byId.get(id)).filter(Boolean);
  if (!known.length) return [];
  const labels = tierLabels(catalog);
  if (retro) {
    const best = [...ACHIEVEMENT_TIERS].reverse().find((t) => known.some((e) => e.tier === t));
    return [
      {
        kind: 'retro',
        tier: best,
        heading: 'From your past runs',
        name: `${known.length} achievement${known.length === 1 ? '' : 's'} earned`,
        rule: 'See them in Records.',
      },
    ];
  }
  return known.map((entry) => ({
    kind: 'unlock',
    id: entry.id,
    tier: entry.tier,
    heading: `Achievement · ${labels[entry.tier] || entry.tier}`,
    name: entry.name,
    rule: entry.rule,
  }));
}
