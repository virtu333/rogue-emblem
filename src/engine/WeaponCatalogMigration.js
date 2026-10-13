// Saved per-battle weapons take the catalog's shot counts. Pure.
//
// A combat weapon with `perBattleUses` (Breachbolt) reads its shots per battle from
// its own `uses` / `usesByFaction` (Combat.getPerBattleMaxUses). Saves store whole
// item objects, so a Breachbolt looted before the shot counts changed still holds the
// old `uses: 1` and no `usesByFaction`: it would fire once a battle while a fresh drop
// fires three times. Item names are identity (docs/specs/item-names.md), so the walk
// finds those weapons by name, anywhere in the save (equipped, convoy, shop stock,
// pending loot and rewards, fallen units' gear, colosseum mercs, the battle
// checkpoint, its entry state and rewind keyframes), and copies the catalog's counts.
// RunManager.fromJSON runs it right after the item-name migration, so names are
// current when it looks them up.
//
// Only `uses` and `usesByFaction` change; instance state (uid, forge, imbue, the shots
// already spent this battle) is left alone. Idempotent and ungated by a save revision,
// like AccessoryCatalogMigration: a migrated weapon already matches the catalog, and a
// save written back by an older build is fixed on its next load.

import { stripItemNameSuffix } from '../utils/itemNames.js';

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Catalog combat weapons with per-battle uses, by name (staves keep their own rule). */
function perBattleCatalog(gameData) {
  const map = new Map();
  for (const w of gameData?.weapons || []) {
    if (w?.perBattleUses && w.type !== 'Staff' && typeof w.name === 'string') map.set(w.name, w);
  }
  return map;
}

/** The catalog entry a saved item is a copy of: forge suffix and imbue word removed. */
function catalogEntryFor(node, catalog) {
  const base = stripItemNameSuffix(String(node._baseName || node.name));
  if (catalog.has(base)) return catalog.get(base);
  if (typeof node._imbueId === 'string') {
    const rest = base.slice(base.indexOf(' ') + 1);
    if (catalog.has(rest)) return catalog.get(rest);
  }
  return null;
}

function sameCounts(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * Give every saved per-battle weapon the catalog's `uses` / `usesByFaction`, in place.
 * Returns the number of items changed.
 */
export function migrateSavedPerBattleWeapons(saved, gameData = null) {
  const catalog = perBattleCatalog(gameData);
  if (!catalog.size || !saved || typeof saved !== 'object') return 0;
  let changed = 0;
  const seen = new Set();
  const visit = (node, depth) => {
    if (!node || typeof node !== 'object' || depth > 64 || seen.has(node)) return;
    seen.add(node);
    if (
      isRecord(node) &&
      typeof node.name === 'string' &&
      node.perBattleUses === true &&
      node.type !== 'Staff' &&
      !node._isRandomLegendary
    ) {
      const entry = catalogEntryFor(node, catalog);
      if (
        entry &&
        entry.type === node.type &&
        (node.uses !== entry.uses || !sameCounts(node.usesByFaction, entry.usesByFaction))
      ) {
        node.uses = entry.uses;
        if (isRecord(entry.usesByFaction))
          node.usesByFaction = structuredClone(entry.usesByFaction);
        else delete node.usesByFaction;
        changed += 1;
      }
    }
    for (const key of Object.keys(node)) visit(node[key], depth + 1);
  };
  visit(saved, 0);
  return changed;
}

// Saved staves take the catalog's use rules (the Warp Staff nerf). A staff's own MAG
// steps (`useBonuses`) and cap (`maxUses`) are read off the item (Combat.getStaffMaxUses),
// so a Warp Staff saved before the nerf would keep the shared +1 at MAG 8/14/20 and no
// cap. The same walk copies `uses`, `useBonuses` and `maxUses` from the catalog onto
// every saved staff whose catalog entry names either rule, or that holds one the catalog
// no longer names. `_usesSpent` and the rest of the instance stay. Idempotent, ungated.

const STAFF_RULE_KEYS = ['useBonuses', 'maxUses'];

function staffCatalog(gameData) {
  const map = new Map();
  for (const w of gameData?.weapons || []) {
    if (w?.type === 'Staff' && typeof w.name === 'string') map.set(w.name, w);
  }
  return map;
}

const hasStaffRule = (item) => STAFF_RULE_KEYS.some((key) => item?.[key] !== undefined);

/**
 * Give every saved staff with a use rule of its own the catalog's `uses`, `useBonuses`
 * and `maxUses`, in place. Returns the number of items changed.
 */
export function migrateSavedStaffUseRules(saved, gameData = null) {
  const catalog = staffCatalog(gameData);
  if (!catalog.size || !saved || typeof saved !== 'object') return 0;
  let changed = 0;
  const seen = new Set();
  const visit = (node, depth) => {
    if (!node || typeof node !== 'object' || depth > 64 || seen.has(node)) return;
    seen.add(node);
    if (
      isRecord(node) &&
      typeof node.name === 'string' &&
      node.type === 'Staff' &&
      !node._isRandomLegendary
    ) {
      const entry = catalogEntryFor(node, catalog);
      if (entry && (hasStaffRule(entry) || hasStaffRule(node))) {
        const differs =
          node.uses !== entry.uses ||
          STAFF_RULE_KEYS.some((key) => !sameCounts(node[key], entry[key]));
        if (differs) {
          node.uses = entry.uses;
          for (const key of STAFF_RULE_KEYS) {
            if (entry[key] === undefined) delete node[key];
            else node[key] = structuredClone(entry[key]);
          }
          changed += 1;
        }
      }
    }
    for (const key of Object.keys(node)) visit(node[key], depth + 1);
  };
  visit(saved, 0);
  return changed;
}
