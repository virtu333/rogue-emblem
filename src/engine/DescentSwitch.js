// DescentSwitch.js — is Act V's Descent switched on, and what does a dark build keep out of
// the player's reference pages? (pure: no Phaser, no storage)
//
// The Descent ships dark (data/descent.json `enabled: false`; a build without the file is
// dark too). While it is dark nothing a player can meet is Act V's, so Help and the
// Compendium must not teach or list it. This is the one reader of the flag for those pages:
// callers pass the game data and never test `descent.enabled` themselves. An entry that
// belongs to the Descent carries `descentOnly: true` in its catalog row (classes.json,
// weapons.json); a Help page carries the same flag.

/** Is the Descent switched on in this game data? */
export function isDescentEnabled(gameData) {
  return gameData?.descent?.enabled === true;
}

/** Does this catalog row, or Help page, belong to the Descent? */
export function isDescentOnly(entry) {
  return entry?.descentOnly === true;
}

/**
 * Does a reference page show this entry? Always, unless it is the Descent's and the Descent
 * is dark; `met` keeps one the save has somehow already met.
 */
export function descentEntryShown(entry, gameData, met = false) {
  return !isDescentOnly(entry) || isDescentEnabled(gameData) || Boolean(met);
}
