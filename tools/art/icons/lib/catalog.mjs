// catalog — every icon the game can show, from data/*.json, with its runtime id,
// socket (category plaque) and rim (tier / rarity). One list feeds the atlas build, the
// design previews, the painted-hero pipeline and the coverage test.
//
// Ids are stable and readable:
//   items (weapons, scrolls, consumables, accessories, whetstones, stones) -> slug(name)
//   blessings -> blessing-<id>        upgrades -> upgrade-<id>
//   generic fallbacks (an item the data does not know) -> generic-<kind>
import fs from 'node:fs';
import path from 'node:path';
import * as G from './itemGrammar.mjs';
import { itemSlug } from '../../../../src/ui/itemIconIds.js';

export const slug = itemSlug;

const FILES = [
  'weapons',
  'consumables',
  'accessories',
  'whetstones',
  'imbues',
  'blessings',
  'metaUpgrades',
  'skills',
  'weaponArts',
];

export function loadData(root = process.cwd()) {
  const read = (f) => JSON.parse(fs.readFileSync(path.join(root, 'data', `${f}.json`), 'utf8'));
  const out = {};
  for (const f of FILES) out[f] = read(f);
  return out;
}

const WEAPON_ORDER = ['Sword', 'Lance', 'Axe', 'Bow', 'Tome', 'Light', 'Staff', 'Breath'];
const TIER_RANK = { Iron: 0, Steel: 1, Silver: 2, Legend: 3, Rare: 4 };

/** Accessories the game treats as legendary (CLAUDE.md, accessories.json notes). */
export const LEGENDARY_ACCESSORIES = new Set(["Mentor's Band", 'Mercury Sandals']);

/** Socket (plaque shape) per icon category. */
export const SOCKETS = Object.freeze([
  'weapon', // heater shield: weapons, staves, tomes, breath stones
  'scroll', // cartouche: skill and weapon-art scrolls
  'supply', // roundel: consumables, boosters, seals, gold
  'accessory', // lozenge: rings, charms, gear
  'forge', // octagon: whetstones, imbuing stones
  'blessing', // sun disc
  'upgrade', // pennant
]);

/** Rims: weapon tiers, then rarities for untiered things, then blessing tiers. */
export const RIMS = Object.freeze([
  'Iron',
  'Steel',
  'Silver',
  'Rare',
  'Legend',
  'plain',
  'fine',
  'I',
  'II',
  'III',
  'IV',
]);

function consumableRim(c) {
  if (c.effect === 'statBoost' || c.effect === 'promote') return 'Rare';
  if (c.effect === 'reclass' || c.effect === 'healFull') return 'fine';
  return 'plain';
}

/**
 * @returns {Array<{id:string, group:string, name:string, socket:string, rim:string,
 *   spec:object, kind:string, type?:string, source?:object}>}
 */
export function iconEntries(data) {
  const out = [];
  const add = (e) => out.push(e);
  const byType = {};
  for (const w of data.weapons) (byType[w.type] ||= []).push(w);
  const ctx = G.grammarContext(data);

  for (const t of WEAPON_ORDER)
    for (const w of (byType[t] || [])
      .slice()
      .sort((a, b) => (TIER_RANK[a.tier] ?? 0) - (TIER_RANK[b.tier] ?? 0)))
      add({
        id: slug(w.name),
        group: t,
        name: w.name,
        kind: 'weapon',
        type: w.type,
        socket: 'weapon',
        rim: TIER_RANK[w.tier] != null ? w.tier : 'Iron',
        spec: G.weaponSpec(w, ctx),
        source: w,
      });
  for (const w of byType.Scroll || [])
    add({
      id: slug(w.name),
      group: 'Scroll',
      name: w.name,
      kind: 'scroll',
      type: 'Scroll',
      socket: 'scroll',
      rim: 'Rare',
      spec: G.scrollSpec(w, ctx),
      source: w,
    });
  for (const c of data.consumables)
    add({
      id: slug(c.name),
      group: 'Consumables',
      name: c.name,
      kind: 'consumable',
      type: c.type,
      socket: 'supply',
      rim: consumableRim(c),
      spec: G.consumableSpec(c),
      source: c,
    });
  for (const a of data.accessories)
    add({
      id: slug(a.name),
      group: 'Accessories',
      name: a.name,
      kind: 'accessory',
      type: 'Accessory',
      socket: 'accessory',
      rim: LEGENDARY_ACCESSORIES.has(a.name) ? 'Legend' : a.price >= 3000 ? 'fine' : 'plain',
      spec: G.accessorySpec(a),
      source: a,
    });
  for (const w of data.whetstones)
    add({
      id: slug(w.name),
      group: 'Forge',
      name: w.name,
      kind: 'whetstone',
      type: w.type,
      socket: 'forge',
      rim: w.forgeStat === 'choice' ? 'Silver' : 'plain',
      spec: G.whetstoneSpec(w),
      source: w,
    });
  for (const i of data.imbues.imbues)
    add({
      id: slug(i.stone.name),
      group: 'Forge',
      name: i.stone.name,
      kind: 'imbueStone',
      type: 'ImbueStone',
      socket: 'forge',
      rim: 'Rare',
      spec: G.imbueStoneSpec(i),
      source: i,
    });
  const prism = data.imbues.prismaticStone;
  add({
    id: slug(prism.name),
    group: 'Forge',
    name: prism.name,
    kind: 'imbueStone',
    type: 'ImbueStone',
    socket: 'forge',
    rim: 'Legend',
    spec: G.imbueStoneSpec(null),
    source: prism,
  });
  add({
    id: 'gold',
    group: 'Forge',
    name: 'Gold',
    kind: 'gold',
    socket: 'supply',
    rim: 'plain',
    spec: G.goldSpec(),
  });
  for (const b of data.blessings.blessings)
    add({
      id: `blessing-${b.id}`,
      group: 'Blessings',
      name: b.name,
      kind: 'blessing',
      socket: 'blessing',
      rim: ['I', 'II', 'III', 'IV'][Math.max(0, Math.min(3, (b.tier || 1) - 1))],
      spec: G.blessingSpec(b),
      source: b,
    });
  const upgrades = data.metaUpgrades.upgrades || data.metaUpgrades;
  for (const u of upgrades)
    add({
      id: `upgrade-${u.id}`,
      group: 'Upgrades',
      name: u.name,
      kind: 'upgrade',
      socket: 'upgrade',
      rim: 'plain',
      spec: G.upgradeSpec(u, ctx),
      source: u,
    });
  for (const g of G.genericSpecs())
    add({
      id: `generic-${g.key}`,
      group: 'Generic',
      name: g.name,
      kind: 'generic',
      socket: g.socket,
      rim: g.rim || 'plain',
      spec: g.spec,
    });
  return out;
}
