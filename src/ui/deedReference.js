// The Compendium's Deeds tab: the deeds this player's armies have earned, in full
// (title, Oath, lore), and only a count of the rest. Deeds are found by playing,
// so an unearned deed shows neither its name nor its condition.
import { deedTitleExample } from '../engine/DeedSystem.js';

const STARS = ['', '★', '★★', '★★★', '★★★★', '★★★★★'];

/**
 * @param {object} gameData  needs `deeds` and `skills`
 * @param {Set<string>|string[]} earned  deed ids earned in any save
 * @returns {{name, type, referenceLines: string[]}[]}
 */
export function deedReferenceEntries(gameData, earned) {
  const found = earned instanceof Set ? earned : new Set(earned || []);
  const deeds = (gameData?.deeds?.deeds || []).filter((d) => d?.id && d?.name);
  const skills = gameData?.skills || [];
  const entries = deeds
    .filter((deed) => found.has(deed.id))
    .sort((a, b) => b.prestige - a.prestige || a.name.localeCompare(b.name))
    .map((deed) => {
      const skill = skills.find((s) => s.id === deed.oathSkill);
      const lines = [`Title: ${deedTitleExample(deed)} · ${STARS[deed.prestige] || ''}`];
      lines.push(
        skill
          ? `Oath: ${skill.name}${skill.description ? ` — ${skill.description}` : ''}`
          : 'No Oath.',
      );
      if (deed.lore) lines.push(deed.lore);
      return { name: deed.name, type: 'Found', referenceLines: lines };
    });
  const hidden = deeds.length - entries.length;
  if (hidden > 0)
    entries.push({
      name: entries.length ? `${hidden} more to find` : `${hidden} deeds to find`,
      type: 'Unknown',
      referenceLines: [
        'Deeds come from what a unit does in battle, not from a list.',
        'Each one found here shows its title, its Oath and its story.',
      ],
    });
  return entries;
}
