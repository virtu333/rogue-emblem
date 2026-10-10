// earnedBlessingPickModel — what the earned-blessing pick says (docs/specs/blessings-v3.md §6.4),
// computed without the DOM. An act boss's pick (engine/EarnedBlessings.js) is two earned
// blessings drawn at the victory commit; this turns the owed ledger entry into the cards, the
// footer line for whichever card is chosen and the words of the skip confirmation.
// Pure: reads the run and the catalog, never changes them, never draws.

import { blessingTerms } from '../engine/BlessingTerms.js';
import { buildBlessingIndex } from '../engine/BlessingEngine.js';
import { earnedPickOwed } from '../engine/EarnedBlessings.js';
import { blessingCardContent } from './choiceContent.js';
import { actLabel } from './ceremonyContent.js';

export const EARNED_PICK_TITLE = 'An earned blessing';
export const EARNED_PICK_TAKE = 'Take';
export const EARNED_PICK_SKIP = 'Skip';
/** A take or skip the device refused to save (the battle's minor hint; serviceSave's words). */
export const EARNED_PICK_SAVE_FAILED = 'Save failed: device storage may be full or unavailable.';

/** The skip confirmation (a ChoicePicker): a stray Escape or Skip never leaves them silently. */
export const EARNED_SKIP_CONFIRM = Object.freeze({
  title: 'Leave them?',
  heading: 'Leave both blessings',
  text: 'They are gone for good: this pick will not be offered again.',
  confirmLabel: 'Leave them',
  closeLabel: 'Back',
});

function catalogIndex(run) {
  try {
    const catalog = run?.gameData?.blessings;
    return catalog?.blessings?.length ? buildBlessingIndex(catalog) : new Map();
  } catch {
    return new Map();
  }
}

/** Where the pick came from, for its lead line: "the Act I boss" (or "the act's boss"). */
export function earnedPickSource(entry) {
  const act = actLabel(entry?.actId);
  return act ? `the ${act} boss` : "the act's boss";
}

/**
 * The owed pick as the menu shows it, or null when nothing is owed (or none of its cards is
 * still in the catalog). `cards[i]` = `{ id, content, terms }`: `content` is the tarot face
 * (choiceContent.blessingCardContent), `terms` explain the words its boon uses (Vision).
 * @param {object} run - RunManager
 * @param {object} [entry] - a ledger entry; the owed one by default
 */
export function earnedPickModel(run, entry = earnedPickOwed(run)) {
  if (!entry || entry.status !== 'owed' || !Array.isArray(entry.offered)) return null;
  const index = catalogIndex(run);
  const cards = [];
  for (const id of entry.offered) {
    const blessing = index.get(id);
    if (!blessing || blessing.earned !== true) continue;
    const content = blessingCardContent(blessing);
    cards.push({
      id,
      content,
      terms: blessingTerms([content.boon], {
        burdens: run?.gameData?.events?.burdens,
        difficultyId: run?.difficultyId,
      }),
    });
  }
  if (!cards.length) return null;
  return {
    actId: entry.actId,
    source: earnedPickSource(entry),
    cards,
  };
}

/**
 * The footer's line for the chosen card: its terms when its words need explaining (Second
 * Dawn names Vision), else its lore; before a choice, what the pick is.
 * @returns {{ kind: 'terms', terms: Array<{term: string, text: string}> }
 *   | { kind: 'lore', text: string } | { kind: 'prompt', text: string }}
 */
export function earnedPickFooter(model, chosenId = null) {
  const card = model?.cards?.find((c) => c.id === chosenId) || null;
  if (!card) {
    const source = model?.source || "the act's boss";
    return { kind: 'prompt', text: `Won from ${source}. Take one, or leave them both.` };
  }
  if (card.terms.length) return { kind: 'terms', terms: card.terms };
  if (card.content.lore) return { kind: 'lore', text: card.content.lore };
  return { kind: 'prompt', text: card.content.boon };
}
