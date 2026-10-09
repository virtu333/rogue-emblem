// ExtraShopPass.js — Pilgrim's Road (`pilgrim_coin`, docs/specs/blessings-v3.md §4).
// Pure: no Phaser, no Math.random, no RunManager.
//
// A route map is generated per act by NodeMapGenerator from the node-map stream, which this
// pass never touches. Pilgrim's Road adds one more shop to each act's map afterwards by
// converting one non-combat node: a post-pass on its OWN keyed stream (a hash of the run
// seed, the act and the shop's index), so a map with the blessing is the map without it
// except for the converted node, and the same seed always converts the same node.
//
// Eligible: an `event` or `church` node that is not complete, is not the node the party stands
// on, sits at or below `fromRow`, and has not been touched by the Eclipse (`node.eclipse`,
// `node.darkOmen`). Never a battle, recruit, Colosseum, Ruins, boss or an existing shop.
// Preference tiers (the first non-empty one is drawn from): events whose neighbours hold no
// shop, churches whose neighbours hold no shop, any event, any church. "Neighbours" is the
// generator's own pacing rule (NodeMapGenerator's service-streak repair): a parent that is a
// shop, or a parent's other child that is a shop; here also the node's own children, so two
// shops never end up side by side whichever of them was placed last.

import { NODE_TYPES } from '../utils/constants.js';
import { createSeededRng } from './BlessingEngine.js';

function hashToUint32(input) {
  let hash = 2166136261 >>> 0;
  const text = String(input ?? '');
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** The nodes the pass converted earlier on this map (it marks each with `pilgrimShop`). */
export function pilgrimShopCount(nodeMap) {
  return (nodeMap?.nodes || []).filter((node) => node?.pilgrimShop === true).length;
}

function hasShopNeighbour(node, nodes) {
  const parents = nodes.filter((other) => other.edges?.includes(node.id));
  const isShop = (other) => other.id !== node.id && other.type === NODE_TYPES.SHOP;
  if (parents.some(isShop)) return true;
  for (const parent of parents) {
    if ((parent.edges || []).some((id) => isShop(nodes.find((n) => n.id === id) || {})))
      return true;
  }
  return (node.edges || []).some((id) => isShop(nodes.find((n) => n.id === id) || {}));
}

/** Nodes the pass may convert, sorted by id. */
export function extraShopCandidates(nodeMap, { fromRow = 0, currentNodeId = null } = {}) {
  const nodes = nodeMap?.nodes || [];
  return nodes
    .filter(
      (node) =>
        (node.type === NODE_TYPES.EVENT || node.type === NODE_TYPES.CHURCH) &&
        node.completed !== true &&
        node.id !== currentNodeId &&
        node.row >= fromRow &&
        !node.eclipse &&
        node.darkOmen !== true,
    )
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Convert nodes of `nodeMap` into shops until it holds `count` Pilgrim shops, in place.
 * Returns the ids it converted this call (none when the map already holds `count`, or when
 * no node is eligible; the map is then left exactly as it was).
 * @param {object} nodeMap - { actId, nodes }
 * @param {{ runSeed: number, count?: number, fromRow?: number, currentNodeId?: string|null }} options
 * @returns {string[]}
 */
export function stampExtraShops(
  nodeMap,
  { runSeed, count = 1, fromRow = 0, currentNodeId = null } = {},
) {
  const wanted = Math.max(0, Math.trunc(Number(count) || 0));
  const nodes = nodeMap?.nodes;
  if (!Array.isArray(nodes) || wanted <= 0) return [];
  const converted = [];
  for (let index = pilgrimShopCount(nodeMap); index < wanted; index++) {
    const candidates = extraShopCandidates(nodeMap, { fromRow, currentNodeId });
    if (candidates.length === 0) break;
    const calm = (type) =>
      candidates.filter((node) => node.type === type && !hasShopNeighbour(node, nodes));
    const pool =
      [
        calm(NODE_TYPES.EVENT),
        calm(NODE_TYPES.CHURCH),
        candidates.filter((node) => node.type === NODE_TYPES.EVENT),
        candidates.filter((node) => node.type === NODE_TYPES.CHURCH),
      ].find((list) => list.length > 0) || [];
    if (pool.length === 0) break;
    const rng = createSeededRng(
      hashToUint32(`pilgrim-shop:${Number(runSeed) >>> 0}:${nodeMap.actId}:${index}`),
    );
    const pick = pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];
    pick.type = NODE_TYPES.SHOP;
    pick.battleParams = null;
    pick.pilgrimShop = true;
    converted.push(pick.id);
  }
  return converted;
}
