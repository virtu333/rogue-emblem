function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function withIndefiniteArticle(label) {
  const value = String(label || '').trim();
  if (!value) return '';
  const startsWithVowel = /^[aeiou]/i.test(value);
  return `${startsWithVowel ? 'an' : 'a'} ${value}`;
}

export function getConsumableDescription(item) {
  if (!item || typeof item !== 'object') return '';
  if (item.effect === 'heal') return `Restore ${toNumber(item.value)} HP`;
  if (item.effect === 'healFull') return 'Restore HP to full';
  if (item.effect === 'promote') return 'Promote an eligible level 10+ base-class unit';
  if (item.effect === 'reclass') {
    const label =
      String(item.subEffect || 'infantry')
        .trim()
        .toLowerCase() || 'infantry';
    if (label === 'infantry') return 'Reclass to an infantry or armored class';
    if (label === 'mounted') return 'Reclass to a cavalry or flying class';
    return `Reclass to ${withIndefiniteArticle(label)} class`;
  }
  if (item.effect === 'statBoost')
    return `Permanent +${toNumber(item.value)} ${item.stat || 'Stat'}`;
  if (item.effect === 'cure') return 'Cure all status conditions';
  if (item.effect === 'cureHeal') return `Cure conditions & restore ${toNumber(item.value)} HP`;
  return '';
}

export function formatUses(item) {
  if (!item || item.uses === undefined || item.uses === null) return '';
  const uses = Number(item.uses);
  if (!Number.isFinite(uses)) return '';
  const normalizedUses = Math.trunc(uses);
  return `${normalizedUses} use${normalizedUses === 1 ? '' : 's'}`;
}

/**
 * Uses line for a reward that grants `quantity` separate copies of an item, each with
 * its full uses (LootRewardCommands.applyRewardBundle): "3 uses each" for a bundle,
 * the plain "3 uses" for a single item.
 */
export function formatBundleUses(item, quantity = 1) {
  const text = formatUses(item);
  return text && Number(quantity) > 1 ? `${text} each` : text;
}
