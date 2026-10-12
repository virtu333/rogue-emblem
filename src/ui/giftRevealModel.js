// giftRevealModel — what the shrine shows once a start gift is taken (docs/specs/blessings-v3.md
// §7): the gift's contents are rolled at the take (engine/StartGifts.js), so the player sees what
// it held before the run begins. A blessing gift (the Sealed Reliquary, the Pilgrim's Wager) shows
// the rolled blessing as its tarot card, its catch as the card's price; any other gift shows its
// own card with what it gave in place of its description.
// Pure: reads the run's saved gift record and the catalog, never changes them, never draws.

import { blessingTerms } from '../engine/BlessingTerms.js';
import { buildBlessingIndex } from '../engine/BlessingEngine.js';
import { findGift, giftGrantedText } from '../engine/StartGifts.js';
import { blessingCardContent, giftCardContent } from './choiceContent.js';

export const GIFT_REVEAL_BEGIN = 'Begin the run';

function catalogIndex(run) {
  try {
    const catalog = run?.gameData?.blessings;
    return catalog?.blessings?.length ? buildBlessingIndex(catalog) : new Map();
  } catch {
    return new Map();
  }
}

/**
 * The reveal for the run's taken gift, or null when there is nothing to show (no gift taken,
 * nothing granted, a gift or card no longer in the catalog).
 * @param {object} run - RunManager
 * @returns {{ giftId: string, title: string, lead: string, blessingId: string|null,
 *   content: object, terms: Array<{term: string, text: string}> } | null}
 */
export function giftRevealModel(run) {
  const record = run?.startGift;
  if (!record?.granted?.length) return null;
  const gift = findGift(run?.gameData, record.id);
  if (!gift) return null;
  const termsOf = (content) =>
    content?.cost
      ? blessingTerms([content.cost], {
          burdens: run?.gameData?.events?.burdens,
          difficultyId: run?.difficultyId,
        })
      : [];
  const granted = record.granted.find((entry) => entry.kind === 'blessing');
  if (granted) {
    const blessing = catalogIndex(run).get(granted.id);
    if (!blessing) return null;
    const held = (run.activeBlessings || []).find((entry) => entry?.id === blessing.id);
    const content = blessingCardContent({
      ...blessing,
      // The gift's catch is the card's price; a pact the gift waived is not.
      pact: null,
      rolledCost: held?.rolledCost || {
        label: record.catchLabel || gift.catch?.label || '',
        kind: 'gift',
      },
    });
    return {
      giftId: gift.id,
      title: gift.name,
      lead: `The ${gift.name} held ${blessing.name}.`,
      blessingId: blessing.id,
      content,
      terms: termsOf(content),
    };
  }
  const gave = giftGrantedText(record, run?.gameData?.skills);
  if (!gave) return null;
  const content = { ...giftCardContent(gift), boon: gave };
  return {
    giftId: gift.id,
    title: gift.name,
    lead: `The ${gift.name} gave: ${gave}.`,
    blessingId: null,
    content,
    terms: termsOf(content),
  };
}
