// lordOutfitArt.js - what a lord wears on screen (docs/specs/lord-outfits.md). The open
// slot's choice (MetaProgressionManager.wornLordOutfit) is read through one source that
// main.js installs, so the portrait resolver (portraitArt.portraitCandidates) and the map
// sprite resolver (TracedSprites.tracedKeyFor) stay pure functions of the unit. A unit
// outside the player's army (an enemy, an NPC) never wears one.
let source = null;

/** Install the reader (`(lordName) => outfitId | null`); null removes it. */
export function setWornOutfitSource(read) {
  source = typeof read === 'function' ? read : null;
}

/** The outfit id a lord unit wears, or null. */
export function wornOutfitFor(unit) {
  if (!source || !unit || typeof unit.name !== 'string') return null;
  if (unit.faction === 'enemy' || unit.faction === 'npc') return null;
  try {
    const id = source(unit.name);
    return typeof id === 'string' && id ? id : null;
  } catch {
    return null;
  }
}
