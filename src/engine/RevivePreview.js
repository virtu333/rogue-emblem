// What a church or the Ruins will charge to revive the fallen, read before the party gets
// there (the route map's node card). A revive's price is fixed while the unit waits
// (RunManager.getReviveCost: its level when it fell), so the card can name it exactly.
// Pure: no Phaser, no DOM.
import { getReviveCost } from './RunManager.js';
import { churchRevivesLeft } from './ChurchCommands.js';
import { ruinsChoice, ruinsReviveSpent } from './RuinsCommands.js';

const MAX_NAMED = 4;

function priceList(fallen) {
  const named = fallen.slice(0, MAX_NAMED).map((u) => `${u.name} ${getReviveCost(u)} G`);
  const more = fallen.length - named.length;
  return `${named.join(', ')}${more > 0 ? `, +${more} more` : ''}`;
}

/**
 * The lines a church or ruins node's card shows about reviving the fallen, or [] (no fallen,
 * another kind of node, an eclipsed node, or one already left behind).
 * @param {object} run RunManager
 * @param {object} node a route node
 * @returns {string[]}
 */
export function reviveNodeNotes(run, node) {
  if (!run || !node || node.eclipse) return [];
  if (node.type !== 'church' && node.type !== 'ruins') return [];
  if (node.completed && run.currentNodeId !== node.id) return [];
  const fallen = Array.isArray(run.fallenUnits) ? run.fallenUnits.filter(Boolean) : [];
  if (!fallen.length) return [];
  if (run.isChurchReviveDisabled?.()) return ['Revive: your pact forbids it.'];
  if (node.type === 'ruins') {
    if (ruinsChoice(run, node.id) === 'scavenge') return [];
    if (ruinsReviveSpent(run, node.id)) return ['Revive: these ruins gave back their one.'];
    return [`Revive one, who returns injured: ${priceList(fallen)}.`];
  }
  const left = churchRevivesLeft(run, node.id);
  if (left <= 0) return ['Revive: this church has revived all it can.'];
  return [`Revive up to ${left}: ${priceList(fallen)}.`];
}
