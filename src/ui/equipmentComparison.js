import { staffRunOptions } from '../engine/StaffBlessings.js';
import { getStaticCombatStats, getStaffMaxUses } from '../engine/Combat.js';
import { itemKeywords } from '../engine/ItemKeywords.js';
import { getImbueDisplayInfo } from '../engine/ImbueSystem.js';
import { resolveWeaponArtIds } from './WeaponArtVisibility.js';

// Keyword tags a row already says: the Crit row covers "Crit 30", the Range row
// covers the tags that only explain a range.
const COVERED_KEYWORDS = new Set(['crit', 'longRange', 'siege', 'thrown', 'gust', 'closeBow']);

function artNames(weapon, arts) {
  if (!weapon) return [];
  const byId = new Map(arts.map((art) => [art.id, art]));
  return resolveWeaponArtIds(weapon, arts).map((id) => byId.get(id)?.name || id);
}

function effectNames(weapon, imbues) {
  if (!weapon) return [];
  const names = itemKeywords(weapon)
    .filter((tag) => !COVERED_KEYWORDS.has(tag.id))
    .map((tag) => tag.text);
  const imbue = imbues ? getImbueDisplayInfo(weapon, imbues) : null;
  if (imbue?.name) names.push(imbue.name);
  return names;
}

const sameList = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const listText = (list) => list.join(', ') || 'none';
// "Crit 5 → 35" wraps as a unit (no-break spaces), so a narrow card never
// strands the arrow; only the " · " between parts breaks.
const change = (label, from, to) => `${label}\u00a0${from}\u00a0→\u00a0${to}`;

/**
 * What equipping `item` in place of `before` changes for `unit`, one row per
 * stat: `{ id, label, from, to, delta, better }`. Attack and Attack speed always
 * lead (they answer "is it stronger?"); Hit, Crit, Range, weapon arts and
 * special effects follow only when they differ. Number rows carry `delta`
 * (new minus old) and `better` (true, false, or null when equal); Range, Art
 * and Effect are trade-offs the player weighs, so `better` stays null. Shared
 * by the shop, the reward screen and the roster, so they never disagree about
 * an upgrade.
 *
 * @param {object} [options]
 * @param {object[]} [options.arts] weapon-art catalog (gameData.weaponArts.arts), for art names
 * @param {object} [options.imbues] imbue catalog (gameData.imbues), for imbue names
 */
export function weaponComparisonRows(unit, item, before = unit?.weapon, options = {}) {
  if (!unit || !item) return [];
  const arts = Array.isArray(options.arts) ? options.arts : [];
  const old = getStaticCombatStats(unit, before),
    next = getStaticCombatStats(unit, item);
  const number = (id, label, from, to) => ({
    id,
    label,
    from,
    to,
    delta: to - from,
    better: to === from ? null : to > from,
  });
  const text = (id, label, from, to) => ({ id, label, from, to, delta: null, better: null });
  const rows = [
    number('atk', 'Attack', old.atk, next.atk),
    number('as', 'Attack speed', old.as, next.as),
  ];
  if (old.hit !== next.hit) rows.push(number('hit', 'Hit', old.hit, next.hit));
  if (old.crit !== next.crit) rows.push(number('crit', 'Crit', old.crit, next.crit));
  if (before?.range != null && item.range != null && String(before.range) !== String(item.range))
    rows.push(text('range', 'Range', String(before.range), String(item.range)));
  const oldArts = artNames(before, arts),
    newArts = artNames(item, arts);
  if (!sameList(oldArts, newArts))
    rows.push(text('art', 'Art', listText(oldArts), listText(newArts)));
  const oldEffects = effectNames(before, options.imbues),
    newEffects = effectNames(item, options.imbues);
  if (!sameList(oldEffects, newEffects))
    rows.push(text('effect', 'Effect', listText(oldEffects), listText(newEffects)));
  return rows;
}

/** The same rows as short "Label old → new" parts, for one-line screens. */
export function weaponComparisonParts(unit, item, before = unit?.weapon, options = {}) {
  return weaponComparisonRows(unit, item, before, options).map((row) =>
    change(row.label, row.from, row.to),
  );
}

export function equipmentComparison(unit, item, before = unit?.weapon, options = {}) {
  if (!unit || !item) return '';
  // A staff's uses for this unit, with the run's blessing uses (`options.run`: Saint's Reserve).
  if (item.type === 'Staff')
    return `${getStaffMaxUses(item, unit, staffRunOptions(options.run, unit))} uses per map for ${unit.name} · Uses refresh each battle`;
  if (item.might == null) return '';
  return `If equipped: ${weaponComparisonParts(unit, item, before, options).join(' · ')}`;
}
