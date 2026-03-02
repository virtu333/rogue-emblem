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
  if (item.effect === 'promote') return 'Promote a Lv 10+ unit';
  if (item.effect === 'reclass') {
    const label =
      String(item.subEffect || 'infantry')
        .trim()
        .toLowerCase() || 'infantry';
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
