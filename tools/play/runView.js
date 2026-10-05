// The run between battles as text, for headless play (tools/play): the route map,
// the army, the convoy and item descriptions. Reads the run; never changes it.

import { getConsumableDescription, formatUses } from '../../src/utils/consumableText.js';
import { formatAccessoryDetail } from '../../src/utils/accessoryText.js';
import { skillScrollText, weaponArtScrollText } from '../../src/ui/weaponArtDisplay.js';
import { canEquip, canPromote } from '../../src/engine/UnitManager.js';
import { getReviveCost } from '../../src/engine/RunManager.js';
import { ELITE_LOOT_CHOICES, ELITE_MAX_PICKS, NODE_TYPES } from '../../src/utils/constants.js';
import {
  buildLoomModel,
  describeLoomNode,
  describeRecruitPreview,
} from '../../src/ui/loomModel.js';
import { traitLines } from '../../src/ui/traitContent.js';
import { ruinsChoice } from '../../src/engine/RuinsCommands.js';
import { createSeededRng } from '../../src/engine/BlessingEngine.js';
import { _getUidCounter, _setUidCounter } from '../../src/utils/itemUid.js';

/**
 * Run a read on a throwaway random stream and give the item-uid counter back after:
 * building a recruit's preview unit draws both, and a look must never change the game.
 */
export function sandboxed(fn) {
  const random = Math.random;
  const uid = _getUidCounter();
  Math.random = createSeededRng(0x9e3779b9);
  try {
    return fn();
  } finally {
    Math.random = random;
    _setUidCounter(uid);
  }
}
import { skillNames, statsText, weaponText } from './battleView.js';

const NODE_LABEL = {
  [NODE_TYPES.BATTLE]: 'Battle',
  [NODE_TYPES.BOSS]: 'BOSS',
  [NODE_TYPES.SHOP]: 'Shop',
  [NODE_TYPES.RUINS]: 'Ruins',
  [NODE_TYPES.RECRUIT]: 'Recruit battle',
  [NODE_TYPES.CHURCH]: 'Church',
  [NODE_TYPES.COLOSSEUM]: 'Colosseum',
};

/** One line describing an item (weapon stats, consumable effect, scroll, accessory). */
export function itemDetail(item, gameData) {
  if (!item) return '?';
  if (item.type === 'Accessory' || item.combatEffects || item.statBonuses)
    return `${item.name} (accessory: ${formatAccessoryDetail(item, { fallback: 'Accessory' }).replace(/\n/g, '; ')})`;
  if (item.type === 'Consumable')
    return `${item.name} (${getConsumableDescription(item) || item.special || 'consumable'}${formatUses(item) ? `, ${formatUses(item)}` : ''})`;
  if (item.teachesWeaponArtId)
    return `${item.name} (${weaponArtScrollText(item, gameData.weaponArts?.arts || []).replace(/\n/g, '; ')})`;
  if (item.type === 'Scroll')
    return `${item.name} (${skillScrollText(item, gameData.skills || []).replace(/\n/g, '; ')})`;
  if (item.type === 'Whetstone')
    return `${item.name} (forge stone: ${item.forgeStat || item.imbueId || '?'})`;
  return weaponText(item);
}

/** Nodes reachable from `available` (NodeMapMenu.reachableFrom): what the Eclipse can take. */
function reachableFrom(nodes, available) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const seen = new Set();
  const stack = [...available];
  while (stack.length) {
    const id = stack.pop();
    if (seen.has(id) || !byId.has(id)) continue;
    seen.add(id);
    for (const e of byId.get(id).edges || []) stack.push(e);
  }
  return seen;
}

/** The route as the Loom shows it (NodeMapMenu + LoomPanels.renderLoomCard). */
function loomContext(rm, gameData, available) {
  const nodes = rm.nodeMap?.nodes || [];
  const ids = new Set(available.map((n) => n.id));
  for (const n of nodes) if (rm.canReenterService?.(n.id)) ids.add(n.id);
  return {
    ids,
    model: buildLoomModel({
      nodes,
      startNodeId: rm.nodeMap?.startNodeId,
      availableIds: [...ids],
      currentId: rm.currentNodeId,
    }),
    eclipse: rm.getEclipseView?.({ reachableIds: reachableFrom(nodes, ids) }) || null,
  };
}

/** One node as its Loom card reads (kind, objective, place, tags, text, recruit). */
export function describeNode(rm, gameData, node, ctx) {
  const actId = rm.nodeMap?.actId || rm.currentAct;
  const state = ctx.model.nodeState(node.id);
  let recruit = null;
  if (node.type === NODE_TYPES.RECRUIT && !node.eclipse && state !== 'done') {
    recruit = sandboxed(() =>
      describeRecruitPreview(rm.getRecruitNodeUnit?.(node) || null, {
        traitLines: (unit) => traitLines(unit, gameData),
      }),
    );
  }
  return describeLoomNode(node, {
    state,
    steps: ctx.model.steps.get(node.id) ?? null,
    actId,
    mapTemplates: gameData?.mapTemplates,
    dialogue: gameData?.dialogue,
    enemyLevelBonus:
      (rm.getDifficultyModifier?.('enemyLevelBonus', 0) ?? 0) +
      (rm.getEclipseLevelBonus?.(node) ?? 0) +
      (rm.getBlessingEnemyLevelDelta?.(actId) ?? 0),
    firstBattle: rm.completedBattles === 0 && ctx.ids.has(node.id),
    eliteLoot: { choices: ELITE_LOOT_CHOICES, picks: ELITE_MAX_PICKS },
    shopOpen: !!rm.canReenterService?.(node.id),
    eclipse: ctx.eclipse?.nodes?.get?.(node.id) || null,
    recruit,
    recruitMods: rm.getRecruitNodeBattleMods?.(node) || null,
    ruinsChoice: node.type === NODE_TYPES.RUINS ? ruinsChoice(rm, node.id) : null,
  });
}

function shortCard(info) {
  const tags = info.tags.map((t) => t.text);
  return `${info.kind}${info.objective ? ` ${info.objective}` : ''}${tags.length ? ` [${tags.join(', ')}]` : ''}`;
}

export function nodeLine(rm, node, gameData = rm.gameData) {
  try {
    const ctx = loomContext(rm, gameData, rm.getAvailableNodes?.() || []);
    return `${node.id} ${shortCard(describeNode(rm, gameData, node, ctx))}`;
  } catch {
    return `${node.id} ${NODE_LABEL[node.type] || node.type}`;
  }
}

function fullCard(info) {
  const lines = [`${shortCard(info)}${info.place ? ` · ${info.place}` : ''}`];
  if (info.boss) lines.push(`Boss: ${info.boss}`);
  if (info.text) lines.push(info.text);
  for (const t of info.tags) if (t.detail) lines.push(`${t.text}: ${t.detail}`);
  const r = info.recruit;
  if (r)
    lines.push(
      `Recruit ${r.name}: ${r.kicker}. ${r.stats.map((x) => `${x.stat} ${x.value}`).join(' ')}. Best growths ${r.growths.map((g) => `${g.stat} ${g.value}%`).join(', ')}.${r.traits.length ? ` Traits: ${r.traits.map((t) => `${t.name} (${t.text})`).join('; ')}.` : ''}`,
    );
  if (info.warning) lines.push(info.warning);
  return lines;
}

/** The act's route: rows top to bottom; what can be entered now, in full. */
export function mapView(rm, { available = [], reenter = null, gameData = rm.gameData } = {}) {
  const out = [];
  const nodes = rm.nodeMap?.nodes || [];
  const ctx = loomContext(rm, gameData, available);
  const byRow = new Map();
  for (const n of nodes) {
    if (!byRow.has(n.row)) byRow.set(n.row, []);
    byRow.get(n.row).push(n);
  }
  const eclipse = rm.isEclipseActive?.() ? ctx.eclipse : null;
  out.push(
    `== ROUTE MAP · ${rm.currentAct} (act ${rm.actIndex + 1} of ${rm.actSequence?.length ?? '?'}) · ${rm.difficultyId || 'normal'} · ${rm.gold} gold${eclipse ? ` · Eclipse shadow ${eclipse.shadow}/${eclipse.cap} (${eclipse.phase?.name}; next node falls in ${eclipse.nextFall})` : ''} ==`,
  );
  const here = rm.currentNodeId;
  for (const row of [...byRow.keys()].sort((a, b) => a - b)) {
    const cells = byRow
      .get(row)
      .sort((a, b) => a.col - b.col)
      .map((n) => {
        const mark = n.id === here ? '@' : available.some((a) => a.id === n.id) ? '>' : ' ';
        const info = describeNode(rm, gameData, n, ctx);
        return `${mark}${n.id} ${shortCard(info)}${n.completed ? ' (done)' : ''} -> ${(n.edges || []).join(',') || 'end'}`;
      });
    out.push(`row ${row}: ${cells.join('  |  ')}`);
  }
  out.push('(@ = where you stand, > = can travel there now)');
  out.push('Within reach:');
  for (const n of [...available, ...(reenter ? [reenter] : [])]) {
    const card = fullCard(describeNode(rm, gameData, n, ctx));
    out.push(`  ${n === reenter ? 're-enter ' : 'go '}${n.id}: ${card[0]}`);
    for (const line of card.slice(1)) out.push(`      ${line}`);
  }
  if (!available.length && !reenter) out.push('  (nothing)');
  return out.join('\n');
}

/** The army between battles. */
export function rosterView(rm, gameData, { detail = false } = {}) {
  const out = [`== ARMY (${rm.roster.length}) · ${rm.gold} gold ==`];
  for (const u of rm.roster) {
    const tags = [];
    if (u.isCommander) tags.push('commander');
    else if (u.isLord) tags.push('lord');
    if (canPromote(u)) tags.push('can promote');
    out.push(
      `${u.name} (${u.className}${tags.length ? `, ${tags.join(', ')}` : ''}) Lv${u.level} ${u.xp || 0}xp HP ${u.currentHP}/${u.stats.HP} · ${u.moveType}`,
    );
    out.push(`    ${statsText(u)}`);
    const bag = (u.inventory || []).filter((w) => w !== u.weapon);
    out.push(
      `    Equipped: ${weaponText(u.weapon, u)}${bag.length ? ` · Bag: ${bag.map((w) => weaponText(w, u) + (canEquip(u, w) ? '' : ' [cannot equip]')).join('; ')}` : ''}`,
    );
    const extras = [];
    if (u.consumables?.length)
      extras.push(`Items: ${u.consumables.map((i) => itemDetail(i, gameData)).join(', ')}`);
    if (u.accessory) extras.push(`Accessory: ${u.accessory.name}`);
    const skills = skillNames(u, gameData);
    if (skills.length) extras.push(`Skills: ${skills.join(', ')}`);
    if (u.benchedSkills?.length)
      extras.push(`Benched: ${skillNames({ skills: u.benchedSkills }, gameData).join(', ')}`);
    if (u.proficiencies?.length)
      extras.push(`Ranks: ${u.proficiencies.map((p) => `${p.type} ${p.rank}`).join(', ')}`);
    if (extras.length) out.push(`    ${extras.join(' · ')}`);
    if (detail && u.growths)
      out.push(
        `    Growths: ${Object.entries(u.growths)
          .map(([k, v]) => `${k} ${v}%`)
          .join(' ')}`,
      );
  }
  if (rm.fallenUnits?.length)
    out.push(
      `Fallen (revive at a church or a resting ruins): ${rm.fallenUnits.map((u) => `${u.name} ${u.className} Lv${u.level} (${getReviveCost(u)} G)`).join(', ')}`,
    );
  const convoy = rm.getConvoyItems?.() || { weapons: [], consumables: [] };
  const caps = rm.getConvoyCapacities?.() || {};
  out.push(
    `Convoy weapons (${convoy.weapons.length}/${caps.weapons ?? '?'}): ${convoy.weapons.map((i) => i.name).join(', ') || 'none'}`,
  );
  out.push(
    `Convoy supplies (${convoy.consumables.length}/${caps.consumables ?? '?'}): ${convoy.consumables.map((i) => `${i.name}${i.uses !== undefined ? ` x${i.uses}` : ''}`).join(', ') || 'none'}`,
  );
  if (rm.accessories?.length)
    out.push(`Accessory pool: ${rm.accessories.map((a) => a.name).join(', ')}`);
  if (rm.scrolls?.length) out.push(`Scroll pool: ${rm.scrolls.map((s) => s.name).join(', ')}`);
  const blessings = (rm.activeBlessings || []).map((b) => b.name || b.id);
  if (blessings.length) out.push(`Blessings: ${blessings.join(', ')}`);
  if (Number.isFinite(rm.visionChargesRemaining))
    out.push(
      `Vision charges: ${rm.visionChargesRemaining} (battle rewinds are not modelled headless)`,
    );
  return out.join('\n');
}
