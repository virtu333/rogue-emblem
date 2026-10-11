// Saved legendaries take the rework's catalog changes (docs/specs/legendary-arts-rework.md
// §6). Pure.
//
// Saves store whole item objects, so an Oathblade looted before the rework still holds 9 Mt
// and "Attacks twice", and a Hermit's Bow still holds Starfall Volley as its innate art,
// while a fresh drop has the new ones. Item names are identity (docs/specs/item-names.md):
// the walk finds those weapons by name anywhere in the save (equipped, convoy, shop stock,
// pending loot and rewards, fallen units' gear, the battle checkpoint, its entry state and
// rewind keyframes), as WeaponCatalogMigration does, and applies each entry of a frozen
// revision table once.
//
// An old copy is recognised by what only an old copy holds (Oathblade's "Attacks twice"
// text, Starfall Volley innate on a Hermit's Bow), never by a stamp or a save revision: a copy
// made after the rework has neither, so it is never changed, and a migrated copy has neither
// any more, so the walk is idempotent; a save written back by an older build keeps its items
// whole, so its old copies are fixed on the next load. Stats change by delta, so a forge (or
// wear) step the copy carries is kept. A run's random legendary is its own weapon and is
// never touched.

import { stripItemNameSuffix } from '../utils/itemNames.js';

/**
 * What the rework changed on each relic, frozen: a later catalog edit needs its own marker
 * and entry, never an edit here. `marker(item)` says the copy is from before the rework.
 */
const RELIC_CHANGES = Object.freeze({
  Oathblade: {
    type: 'Sword',
    marker: (item) => item.special === 'Attacks twice consecutively',
    statDeltas: { might: 6, crit: 20 },
    special: { from: 'Attacks twice consecutively', to: '' },
  },
  "Hermit's Bow": {
    type: 'Bow',
    marker: (item) => innateIndex(item, 'legend_starfall_volley') !== -1,
    innateArt: { from: 'legend_starfall_volley', to: 'legend_hermit_fan' },
  },
});

/** Where `artId` is bound as the item's innate art, or -1. */
function innateIndex(item, artId) {
  const ids = Array.isArray(item?.weaponArtIds) ? item.weaponArtIds : [];
  const sources = Array.isArray(item?.weaponArtSources) ? item.weaponArtSources : [];
  return ids.findIndex((id, i) => id === artId && (sources[i] ?? 'innate') === 'innate');
}

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** The relic a saved item is a copy of: forge suffix and imbue word removed. */
function relicFor(node) {
  const base = stripItemNameSuffix(String(node._baseName || node.name));
  if (RELIC_CHANGES[base]) return RELIC_CHANGES[base];
  if (typeof node._imbueId === 'string') {
    const rest = base.slice(base.indexOf(' ') + 1);
    if (RELIC_CHANGES[rest]) return RELIC_CHANGES[rest];
  }
  return null;
}

function applyRelicChange(node, change) {
  for (const [stat, delta] of Object.entries(change.statDeltas || {})) {
    if (Number.isFinite(node[stat])) node[stat] += delta;
  }
  if (change.special && node.special === change.special.from) node.special = change.special.to;
  if (change.innateArt && Array.isArray(node.weaponArtIds)) {
    const sources = Array.isArray(node.weaponArtSources) ? node.weaponArtSources : [];
    node.weaponArtIds = node.weaponArtIds.map((id, i) =>
      id === change.innateArt.from && (sources[i] ?? 'innate') === 'innate'
        ? change.innateArt.to
        : id,
    );
    // An art can be bound once: a copy that also held the new one by scroll keeps one.
    const seen = new Set();
    const keep = node.weaponArtIds.map((id) => (seen.has(id) ? false : (seen.add(id), true)));
    node.weaponArtIds = node.weaponArtIds.filter((_, i) => keep[i]);
    if (Array.isArray(node.weaponArtSources))
      node.weaponArtSources = node.weaponArtSources.filter((_, i) => keep[i]);
  }
}

/**
 * Bring every saved copy of a reworked relic up to the rework, in place, once. Returns the
 * number of items changed.
 */
export function migrateSavedLegendaryRelics(saved) {
  if (!saved || typeof saved !== 'object') return 0;
  let changed = 0;
  const seen = new Set();
  const visit = (node, depth) => {
    if (!node || typeof node !== 'object' || depth > 64 || seen.has(node)) return;
    seen.add(node);
    if (
      isRecord(node) &&
      typeof node.name === 'string' &&
      typeof node.type === 'string' &&
      !node._isRandomLegendary
    ) {
      const change = relicFor(node);
      if (change && change.type === node.type && change.marker(node)) {
        applyRelicChange(node, change);
        changed += 1;
      }
    }
    for (const key of Object.keys(node)) visit(node[key], depth + 1);
  };
  visit(saved, 0);
  return changed;
}
