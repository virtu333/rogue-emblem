// earnedBlessingPickModel — what the earned-blessing pick says (docs/specs/blessings-v3.md §6.4),
// computed without the DOM. An act boss's pick (engine/EarnedBlessings.js) is two earned
// blessings drawn at the victory commit, an eclipsed elite's drop one; this turns the owed ledger
// entry into the cards, the footer line for whichever card is chosen and the words of the skip
// confirmation.
// Pure: reads the run and the catalog, never changes them, never draws.

import { blessingTerms } from '../engine/BlessingTerms.js';
import { buildBlessingIndex } from '../engine/BlessingEngine.js';
import { earnedPickOwed, ledgerKeyOf, takeableOffered } from '../engine/EarnedBlessings.js';
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
/** The same confirmation for a pick of one card (an eclipsed elite's drop). */
export const EARNED_SKIP_CONFIRM_ONE = Object.freeze({
  title: 'Leave it?',
  heading: 'Leave the blessing',
  text: 'It is gone for good: it will not be offered again.',
  confirmLabel: 'Leave it',
  closeLabel: 'Back',
});

/** The skip confirmation's words for a pick of `count` cards. */
export function earnedSkipConfirm(count) {
  return count === 1 ? EARNED_SKIP_CONFIRM_ONE : EARNED_SKIP_CONFIRM;
}

function catalogIndex(run) {
  try {
    const catalog = run?.gameData?.blessings;
    return catalog?.blessings?.length ? buildBlessingIndex(catalog) : new Map();
  } catch {
    return new Map();
  }
}

/**
 * Where the pick came from, for its lead line: "the Act I boss" (or "the act's boss"), "an
 * eclipsed elite", "the Colosseum".
 */
export function earnedPickSource(entry) {
  if (entry?.source === 'eclipsed_elite') return 'an eclipsed elite';
  if (entry?.source === 'colosseum') return 'the Colosseum';
  const act = actLabel(entry?.actId);
  return act ? `the ${act} boss` : "the act's boss";
}

/**
 * The owed pick as the menu shows it, or null when nothing is owed (or none of its cards is
 * still in the catalog, or one the run does not already hold: a Take of it would be refused). `cards[i]` = `{ id, content, terms }`: `content` is the tarot face
 * (choiceContent.blessingCardContent), `terms` explain the words its boon uses (Vision).
 * @param {object} run - RunManager
 * @param {object} [entry] - a ledger entry; the owed one by default
 */
export function earnedPickModel(run, entry = earnedPickOwed(run)) {
  if (!entry || entry.status !== 'owed' || !Array.isArray(entry.offered)) return null;
  const index = catalogIndex(run);
  const cards = [];
  for (const id of takeableOffered(run, entry)) {
    const blessing = index.get(id);
    if (!blessing || blessing.earned !== true) continue;
    const content = blessingCardContent(blessing);
    cards.push({
      id,
      content,
      // A twisted card's twist is explained too (Hunted, Ill Omen, shadow): it is taken knowingly.
      terms: blessingTerms([content.boon, content.cost], {
        burdens: run?.gameData?.events?.burdens,
        difficultyId: run?.difficultyId,
        effects: blessing.twist?.effects || null,
      }),
    });
  }
  if (!cards.length) return null;
  return {
    actId: entry.actId,
    key: ledgerKeyOf(entry),
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
    const choice =
      model?.cards?.length === 1 ? 'Take it, or leave it.' : 'Take one, or leave them both.';
    return { kind: 'prompt', text: `Won from ${source}. ${choice}` };
  }
  if (card.terms.length) return { kind: 'terms', terms: card.terms };
  if (card.content.lore) return { kind: 'lore', text: card.content.lore };
  return { kind: 'prompt', text: card.content.boon };
}
