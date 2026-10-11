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
// text; on a Hermit's Bow, Starfall Volley innate, or no innate art at all), never by a stamp
// or a save revision: a copy made after the rework has none of them, so it is never changed,
// and a migrated copy has none any more, so the walk is idempotent. A save written back by an
// older build is fixed on the next load: it keeps an Oathblade whole, and its load drops the
// Fan Shot it does not know, which leaves a bow with no innate art. Stats change by delta, so a forge (or
// wear) step the copy carries is kept. A run's random legendary is its own weapon and is
// never touched.

import { stripItemNameSuffix } from '../utils/itemNames.js';
import { getWeaponArtBindings } from './WeaponArtSystem.js';

/** A weapon's art slots (WeaponArtSystem's MAX_WEAPON_ART_SLOTS, RosterArtCommands' cap). */
const MAX_ART_SLOTS = 3;

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
    // Two states need Fan Shot: Starfall Volley still innate (saved before the rework), or no
    // innate art at all with a slot free (an older build dropped the art it did not know, as
    // its load does with every unknown id, and saved). A bow whose innate slot the player
    // filled with a scroll is full, so it is left alone.
    marker: (item) => {
      const bindings = getWeaponArtBindings(item);
      if (bindings.some((b) => b.id === 'legend_starfall_volley' && b.source === 'innate'))
        return true;
      return !bindings.some((b) => b.source === 'innate') && bindings.length < MAX_ART_SLOTS;
    },
    innateArt: { from: 'legend_starfall_volley', to: 'legend_hermit_fan' },
  },
});

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
  if (change.innateArt) {
    // Every place a binding can live is read (the arrays and the legacy single-art fields, as
    // getWeaponArtBindings reads them) and every one is rewritten: a legacy field left holding
    // the old art would bring it back as a second binding on the next normalize.
    const { from, to } = change.innateArt;
    const kept = getWeaponArtBindings(node).filter(
      (b) => b.id !== to && !(b.id === from && b.source === 'innate'),
    );
    const bindings = [{ id: to, source: 'innate' }, ...kept].slice(0, MAX_ART_SLOTS);
    delete node.weaponArtBinding;
    delete node.weaponArt;
    delete node.artId;
    node.weaponArtIds = bindings.map((b) => b.id);
    node.weaponArtSources = bindings.map((b) => b.source);
    node.weaponArtId = node.weaponArtIds[0];
    node.weaponArtSource = node.weaponArtSources[0];
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
      // A weapon item, never a bare { name, type } record elsewhere in the save.
      Number.isFinite(node.might) &&
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
