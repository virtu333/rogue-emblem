// itemDetailView — an item's full detail as the shop shows it: the picture, what it
// is, its rules, its numbers, its story, its weapon arts, who in the army could use
// it, and its forge, wear and imbue. The shop's detail pane and the battle rewards'
// detail sheet (long press, Details) both build it here, so they cannot disagree.

import { shopRequirementLabel } from './itemDecisionText.js';
import { comparisonFragment, equipmentComparisonSegments } from './equipmentComparison.js';
import { appendItemArtDetails } from './ItemArtDetails.js';
import { itemKeywordRow } from './itemKeywordChips.js';
import { itemHero } from './itemIcons.js';
import { element as el } from './MenuSurface.js';
import { skillScrollText, weaponArtScrollText } from './weaponArtDisplay.js';
import { getWeaponArtTooltipLines } from './WeaponArtVisibility.js';
import { itemBaseLine } from '../engine/ItemKeywords.js';
import { canEquip } from '../engine/UnitManager.js';
import { classChangeItemTag } from '../engine/TwistedBoons.js';
import { whetstoneTag } from '../engine/SmithsExile.js';
import { forgeStatusLine, getForgeDisplayInfo } from '../engine/ForgeSystem.js';
import { isWorn, wearDisplay } from '../engine/WeaponWear.js';
import {
  getImbueDisplayInfo,
  getImbueStoneDetailText,
  isImbueStone,
} from '../engine/ImbueSystem.js';
import { formatAccessoryDetail } from '../utils/accessoryText.js';
import { formatUses, getConsumableDescription } from '../utils/consumableText.js';
import { itemDisplayName } from '../utils/itemNames.js';

/** "Worn 2/3 · Dulled −1 Might · Bent −5 Hit": the wear, by name. */
export function wearDisplayText(weapon) {
  const { count, max, steps } = wearDisplay(weapon);
  const named = steps.map((step) => `${step.label} ${step.effect}`);
  return [`Worn ${count}/${max}`, ...named].join(' · ');
}

/**
 * What an item does, as plain lines: an accessory's effect, a consumable's use and
 * uses, a scroll's lesson, a stone's forge, or a weapon's numbers, special and arts.
 * `entry` is a shop entry or `{ item }`; `arts` is the weapon-art catalog.
 */
export function itemDetailText(entry, gameData = {}, arts = gameData?.weaponArts?.arts || []) {
  const item = entry?.item || {};
  const entryType = entry?.type || item.type;

  if (entryType === 'accessory' || item.type === 'Accessory') {
    return (
      formatAccessoryDetail(item, { fallback: 'Accessory', skills: gameData?.skills }) ||
      'Accessory'
    );
  }

  if (entryType === 'consumable' || item.type === 'Consumable') {
    const description = getConsumableDescription(item);
    if (description) {
      const usesText = formatUses(item);
      return usesText ? `${description} (${usesText})` : description;
    }
    return item.special || 'Consumable';
  }

  if (item.teachesWeaponArtId) return weaponArtScrollText(item, gameData?.weaponArts?.arts || []);

  if (entryType === 'scroll' || item.type === 'Scroll')
    return skillScrollText(item, gameData?.skills || []);

  if (item.type === 'Whetstone') {
    if (isImbueStone(item)) {
      return getImbueStoneDetailText(item, gameData?.imbues) || 'Imbue a weapon';
    }
    if (item.forgeStat === 'choice') return 'Forge: choose a stat boost';
    if (item.forgeStat === 'might') return 'Forge: +1 Mt';
    if (item.forgeStat === 'crit') return 'Forge: +5 Crit';
    if (item.forgeStat === 'hit') return 'Forge: +5 Hit';
    if (item.forgeStat === 'weight') return 'Forge: -1 Wt';
    return 'Forge item';
  }

  const mt = Number.isFinite(Number(item.might)) ? Number(item.might) : 0;
  const hit = Number.isFinite(Number(item.hit)) ? Number(item.hit) : 0;
  const crt = Number.isFinite(Number(item.crit)) ? Number(item.crit) : 0;
  const wt = Number.isFinite(Number(item.weight)) ? Number(item.weight) : 0;
  const rng = item.range ?? '1';

  const lines = [];
  if (item.type) lines.push(item.type);
  lines.push(`Mt: ${mt}   Hit: ${hit}   Crt: ${crt}`);
  lines.push(`Wt: ${wt}   Rng: ${rng}`);
  if (item.special) lines.push(`Special: ${item.special}`);
  lines.push(...getWeaponArtTooltipLines(item, arts));
  return lines.join('\n');
}

/**
 * Append an item's detail to `copy` (a `.shop-copy` container).
 * @param {HTMLElement} copy
 * @param {object} item  the whole item (forge, wear, imbue and bound skill are its own)
 * @param {object} options
 * @param {object} options.gameData
 * @param {object[]} [options.roster]  units to compare it with (who can equip it)
 * @param {object} [options.run]  the run (a staff's uses count its blessings)
 * @param {object} [options.compareOptions]  equipmentComparison options
 * @param {string} [options.detailText]  what it does; defaults to itemDetailText
 * @param {string} [options.name]  the heading; defaults to the item's display name
 * @param {boolean} [options.showName]  false when the container's own title names it
 * @param {string} [options.usage]  how much this very item has been used
 * @param {(title: string, blocks: any[]) => void} [options.openHelp]
 * @param {boolean} [options.expanded]  open the weapon arts and the comparison (a sheet
 *   opened to read the item; the shop keeps them folded beside its stock)
 */
export function appendItemDetail(
  copy,
  item,
  {
    gameData = {},
    roster = [],
    run = null,
    compareOptions = {},
    detailText,
    name,
    showName = true,
    usage = '',
    openHelp,
    expanded = false,
  } = {},
) {
  if (!item) return;
  // The item, large: its painting (or pixel icon at 2x) beside the name and its kind.
  const head = el('div', null, 'shop-hero');
  const title = el('div', null, 'shop-hero-title');
  // What it is ("Silver Lance", "Legend Sword"), then its rules as tags.
  const kicker = itemBaseLine(item) || [item.tier, item.type].filter(Boolean).join(' · ');
  if (kicker) title.append(el('p', kicker, 'shop-kicker'));
  if (showName) title.append(el('h3', name || itemDisplayName(item, gameData?.skills)));
  const keys = itemKeywordRow(item, { baseLine: false, make: (tag) => el(tag) });
  if (keys) title.append(keys);
  const requirement = shopRequirementLabel(item);
  if (requirement) title.append(el('p', requirement, 'shop-meta'));
  // A Master Seal under Kingmaker's Oath: sold and dropped, but it can't be used.
  const banned = run ? classChangeItemTag(run, item) : '';
  if (banned) title.append(el('p', banned, 'shop-meta'));
  // A whetstone under Smith's Exile: offered, but it forges nothing.
  const exiled = run ? whetstoneTag(run, item) : '';
  if (exiled) title.append(el('p', exiled, 'shop-meta'));
  head.append(itemHero(item, { size: 96 }), title);
  copy.append(head);
  const text = detailText ?? itemDetailText({ item }, gameData);
  // What it does reads beside the picture, so a phone shows it without scrolling.
  title.append(
    el(
      'p',
      // The kicker already names the type; drop it from the numbers' first line.
      text
        .replace(new RegExp(`^${item.type}\\n`), '')
        .replace(/\bMt:/g, 'Might:')
        .replace(/\bCrt:/g, 'Crit:')
        .replace(/\bWt:/g, 'Weight:')
        .replace(/\bRng:/g, 'Range:'),
      'shop-mechanics',
    ),
  );
  if (usage) title.append(el('p', usage, 'shop-usage'));
  if (item.lore) copy.append(el('p', item.lore, 'shop-lore'));
  appendItemArtDetails(copy, item, gameData?.weaponArts?.arts || [], { openHelp });
  if (expanded) for (const art of copy.querySelectorAll('.item-art-details')) art.open = true;
  if (item.might != null || item.type === 'Staff') {
    const comparisons = el('details');
    comparisons.append(el('summary', 'Compare with your roster'));
    const able = roster.filter((u) => canEquip(u, item));
    for (const unit of able)
      comparisons.append(
        el(
          'p',
          comparisonFragment([
            { text: `${unit.name}: `, better: null },
            ...equipmentComparisonSegments(unit, item, unit.weapon, { ...compareOptions, run }),
          ]),
        ),
      );
    if (!able.length)
      comparisons.append(el('p', 'No one in your army can wield it yet.', 'shop-meta'));
    comparisons.open = expanded;
    copy.append(comparisons);
  }
  const forge = getForgeDisplayInfo(item);
  if (forge.level)
    copy.append(
      el(
        'p',
        `Forge ${forge.level} · ${Object.entries(forge.bonuses)
          .filter(([, v]) => v)
          .map(([k, v]) => `${v > 0 ? '+' : ''}${v} ${k}`)
          .join(' · ')}`,
      ),
    );
  // How many forge slots are spent, an NG+ weapon's sleeping forges included (they take a slot).
  const forgeStatus = forgeStatusLine(item);
  if (forgeStatus) copy.append(el('p', forgeStatus));
  if (isWorn(item)) copy.append(el('p', wearDisplayText(item), 'shop-wear'));
  const imbue = getImbueDisplayInfo(item, gameData?.imbues);
  if (imbue) copy.append(el('p', `${imbue.name}: ${imbue.description}`));
}
