// The Compendium's "???" rows: an Arms, Items or Skills entry this player has not met yet
// keeps its place in the list (so the collection's size shows) and says nothing more than
// its kind. What counts as met is engine/CompendiumDiscovery.js.

export const LOCKED_NAME = '???';
export const LOCKED_LINE =
  'Not found yet. Find it, be offered it, or meet it in battle to fill this in.';

/** What a "???" row still says: a weapon's or item's type (the filters show it anyway). */
export function lockedSummary(key, item) {
  return key === 'skills' ? '' : String(item?.type || '');
}
