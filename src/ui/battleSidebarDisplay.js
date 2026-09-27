// Compact labels derived from the existing public objective text. Never inspect
// hidden enemies or change objective rules to construct the sidebar.
import { canInspectUnit } from '../engine/BattleInformation.js';

export function compactBattleObjective(text = 'Battle') {
  const first = String(text).split('\n')[0];
  const escape = first.match(/^Escape:.*\((\d+\/\d+)\)/);
  if (escape) return `Escape · Lords ${escape[1]}`;
  if (/^Seize: Defeat boss/.test(first)) return 'Seize · Defeat the boss';
  if (/^Seize: Capture throne/.test(first)) return 'Seize · Capture throne';
  // "Rout: 1 enemy remaining" → "Rout · 1 enemy remains" (verb agrees with the count).
  const remaining = first.match(/^(.*?)(\d+) (\S+) remaining$/);
  if (remaining) {
    const [, head, count, noun] = remaining;
    const verb = Number(count) === 1 ? 'remains' : 'remain';
    return `${head}${count} ${noun} ${verb}`.replace(': ', ' · ');
  }
  return first.replace(': ', ' · ');
}
export function sidebarCounters(turnText, charges) {
  const par = String(turnText || '').match(/Par:\s*(\d+)\s*\(([^)]+)\)/);
  return `${par ? `Par ${par[1]} · ${par[2]} | ` : ''}Visions ${Math.max(0, Math.trunc(charges || 0))}`;
}

/**
 * The battle's side objectives as short parts for the compact header, which keeps only
 * the main objective's first line: the village (intact, visited, razed) and the merchant
 * caravan (its HP while it travels, then escaped or lost). Empty without either.
 *
 * `village`: the village status ('intact' | 'visited' | 'razed') or null.
 * `caravan`: null, or { state: 'travelling', hp, maxHp } | { state: 'unseen' } |
 * { state: 'escaped' } | { state: 'lost' }. The caller decides what fog lets the player
 * know (sideObjectiveInputs); this only words it.
 *
 * Each part: { id, text, tone } with tone 'open' (still in play), 'good', 'warn' or 'bad'.
 */
export function secondaryObjectiveStatus({ village = null, caravan = null } = {}) {
  const parts = [];
  const villageText = {
    intact: 'Village intact',
    visited: 'Village visited',
    razed: 'Village razed',
  };
  const villageTone = { intact: 'open', visited: 'good', razed: 'bad' };
  if (Object.hasOwn(villageText, village))
    parts.push({ id: 'village', text: villageText[village], tone: villageTone[village] });
  if (caravan?.state === 'travelling') {
    const hp = Math.max(0, Math.trunc(Number(caravan.hp) || 0));
    const max = Math.max(1, Math.trunc(Number(caravan.maxHp) || 0));
    parts.push({
      id: 'caravan',
      text: `Caravan ${hp}/${max} HP`,
      tone: hp * 2 <= max ? 'warn' : 'open',
    });
  } else if (caravan?.state === 'unseen') {
    parts.push({ id: 'caravan', text: 'Caravan in fog', tone: 'open' });
  } else if (caravan?.state === 'escaped') {
    parts.push({ id: 'caravan', text: 'Caravan escaped', tone: 'good' });
  } else if (caravan?.state === 'lost') {
    parts.push({ id: 'caravan', text: 'Caravan lost', tone: 'bad' });
  }
  return parts;
}

/**
 * What the player can know about the side objectives right now, for
 * secondaryObjectiveStatus. Fog decides the caravan's wording: its HP only while its tile
 * is in sight; out of sight it is "in fog", and a caravan that is gone reads as lost only
 * once its last tile is in sight again (so the header never reports a fight in the fog
 * before the map shows it). `memory` ({ caravanTile }) belongs to the caller and keeps the
 * caravan's last tile between calls. Reads scene state only; changes nothing in the battle.
 */
export function sideObjectiveInputs(scene, memory = {}) {
  const villageStatus = scene?.battleConfig?.villageTile
    ? scene._villageState?.status || null
    : null;
  let caravan = null;
  const live = (scene?.npcUnits || []).find((u) => u?.isCaravan && u.currentHP > 0);
  if (live) {
    memory.caravanTile = { col: live.col, row: live.row };
    caravan = canInspectUnit(scene.grid, live)
      ? { state: 'travelling', hp: live.currentHP, maxHp: live.stats?.HP }
      : { state: 'unseen' };
  } else if (scene?._caravanExited) caravan = { state: 'escaped' };
  else if (scene?.battleConfig?.caravanSpawn) {
    const tile = memory.caravanTile;
    const hidden = scene.grid?.fogEnabled && tile && !scene.grid.isVisible?.(tile.col, tile.row);
    caravan = { state: hidden ? 'unseen' : 'lost' };
  }
  return { village: villageStatus, caravan };
}
