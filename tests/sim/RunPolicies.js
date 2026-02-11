// RunPolicies.js - Deterministic policy helpers for full-run simulations.

import { NODE_TYPES, ROSTER_CAP } from '../../src/utils/constants.js';

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

export function chooseDeployRoster(roster, deployCount) {
  if (!Array.isArray(roster) || roster.length === 0) return [];

  // Keep lords deployed first, then highest level units.
  const sorted = [...roster].sort((a, b) => {
    if (Boolean(a.isLord) !== Boolean(b.isLord)) return a.isLord ? -1 : 1;
    return (b.level || 0) - (a.level || 0);
  });
  return sorted.slice(0, Math.max(1, deployCount));
}

export function chooseChurchPlan(runManager, options = {}) {
  const {
    reviveCost = 1000,
    promoteCost = 2000,
  } = options;

  const canRevive = runManager.fallenUnits.length > 0 && runManager.gold >= reviveCost;
  const canPromote = runManager.gold >= promoteCost;

  return {
    heal: true,
    revive: canRevive,
    promote: canPromote,
  };
}

function desiredVulneraries(roster) {
  const unitCount = Math.max(1, Math.min(roster.length, ROSTER_CAP));
  return Math.min(unitCount, 4);
}

function countConsumable(roster, itemName) {
  let count = 0;
  for (const unit of roster) {
    count += (unit.consumables || []).filter(c => c.name === itemName).length;
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
