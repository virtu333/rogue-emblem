// RunPolicies.js - Deterministic policy helpers for full-run simulations.

import { NODE_TYPES } from '../../src/utils/constants.js';
import { getReviveCost } from '../../src/engine/RunManager.js';
import { getCombatForecast } from '../../src/engine/Combat.js';

const NODE_PRIORITY = {
  [NODE_TYPES.RECRUIT]: 5,
  [NODE_TYPES.BATTLE]: 4,
  [NODE_TYPES.SHOP]: 3,
  [NODE_TYPES.CHURCH]: 2,
  [NODE_TYPES.BOSS]: 1,
};

function scoreNode(node) {
  const base = NODE_PRIORITY[node.type] || 0;
  // Bias deeper-row nodes to keep progression moving.
  return base * 100 + (node.row || 0);
}

export function chooseNode(availableNodes) {
  if (!availableNodes || availableNodes.length === 0) return null;
  return [...availableNodes].sort((a, b) => scoreNode(b) - scoreNode(a))[0];
}

// A common plain-ground foe makes this a battlefield comparison, not a level comparison.
// It remains a simple deployment heuristic, not the deliberate-feeding balance policy.
export function deploymentCombatValue(unit) {
  const stats = unit?.stats;
  if (!stats) return unit?.level || 0;
  if (unit.weapon?.type === 'Staff') return (stats.MAG || 0) * 2 + (stats.HP || 0) / 4;
  const foe = {
    stats: { HP: 28, STR: 10, MAG: 0, SKL: 8, SPD: 8, DEF: 6, RES: 3, LCK: 3 },
    moveType: 'Infantry',
    skills: [],
    faction: 'enemy',
  };
  const plain = { name: 'Plain', defBonus: 0, avoidBonus: 0 };
  const forecast = getCombatForecast(unit, unit.weapon, foe, null, 1, plain, plain);
  const attack = forecast.attacker;
  return (
    (attack.damage * (attack.doubles ? 2 : 1) * (attack.brave ? 2 : 1) * attack.hit) / 100 +
    (stats.HP || 0) / 4 +
    (stats.DEF || 0) +
    (stats.RES || 0) / 2
  );
}

export function chooseDeployRoster(roster, deployCount) {
  if (!Array.isArray(roster) || roster.length === 0) return [];

  // Keep lords deployed first, then compare actual combat value.
  const sorted = [...roster].sort((a, b) => {
    if (Boolean(a.isLord) !== Boolean(b.isLord)) return a.isLord ? -1 : 1;
    // Preserve lord placement/activation order; forecast ranks the remaining recruits.
    if (a.isLord && b.isLord) return (b.level || 0) - (a.level || 0);
    return deploymentCombatValue(b) - deploymentCombatValue(a);
  });
  return sorted.slice(0, Math.max(1, deployCount));
}

export function chooseChurchPlan(runManager, options = {}) {
  const { promoteCost = 2000 } = options;

  const fallen = runManager.fallenUnits;
  const cheapest = fallen.length > 0 ? Math.min(...fallen.map((u) => getReviveCost(u))) : Infinity;
  const canRevive = fallen.length > 0 && runManager.gold >= cheapest;
  const canPromote = runManager.gold >= promoteCost;

  return {
    heal: true,
    revive: canRevive,
    promote: canPromote,
  };
}

function desiredVulneraries(roster) {
  const unitCount = Math.max(1, roster.length);
  return Math.min(unitCount, 4);
}

function countConsumable(roster, itemName) {
  let count = 0;
  for (const unit of roster) {
    count += (unit.consumables || []).filter((c) => c.name === itemName).length;
  }
  return count;
}

export function chooseShopPurchases(runManager, inventory) {
  const picks = [];
  if (!Array.isArray(inventory) || inventory.length === 0) return picks;

  const roster = runManager.roster || [];
  const vulnCount = countConsumable(roster, 'Vulnerary');
  const needVulnerary = vulnCount < desiredVulneraries(roster);

  const sorted = [...inventory].sort((a, b) => {
    // Prefer consumables first, then cheaper items.
    if (a.type !== b.type) return a.type === 'consumable' ? -1 : 1;
    return (a.price || 0) - (b.price || 0);
  });

  for (const entry of sorted) {
    if ((entry.price || 0) > runManager.gold) continue;
    if (entry.type === 'consumable' && entry.item?.name === 'Vulnerary' && needVulnerary) {
      picks.push(entry);
      continue;
    }
    if (entry.type === 'consumable' && entry.item?.name === 'Elixir' && runManager.gold > 1200) {
      picks.push(entry);
      continue;
    }
    if (entry.type === 'weapon' && runManager.gold > 1500) {
      picks.push(entry);
      continue;
    }
  }

  return picks;
}
