// Category is independent of weapon quality. Unranked supplies never acquire an
// invented rarity just because the roller puts them in a particular pool.
const TIERS = {
  Iron: 'muted',
  Steel: 'good',
  Silver: 'info',
  Rare: 'rarity-epic',
  Legend: 'rarity-legend',
};
export function rewardPresentation(choice) {
  const item = choice.item;
  let category = 'Weapon';
  if (choice.type === 'gold' || choice.type === 'skip') category = 'Gold';
  else if (choice.type === 'accessory' || item?.type === 'Accessory') category = 'Accessory';
  else if (item?.teachesWeaponArtId || choice.type === 'weaponArtScroll')
    category = 'Weapon Art Scroll';
  else if (item?.type === 'Scroll' || choice.type === 'skillScroll') category = 'Skill Scroll';
  else if (item?.imbueId) category = 'Imbue';
  else if (choice.type === 'forge' || item?.type === 'Whetstone') category = 'Forge';
  else if (item?.effect === 'statBoost') category = 'Booster';
  else if (['promote', 'reclass'].includes(item?.effect)) category = 'Seal';
  else if (item?.type === 'Consumable' || ['healing', 'consumable'].includes(choice.type))
    category = 'Supply';
  const tier = TIERS[item?.tier] ? item.tier : null;
  return {
    category,
    tier,
    label: tier ? `${tier} · ${category}` : category,
    token: tier ? TIERS[tier] : category === 'Gold' ? 'accent' : 'muted',
  };
}
const PATHS = {
  Weapon: 'M11 1h4v4l-7 7-2-2zM3 8l5 5-2 2-5-5zM1 13l2-2 2 2-2 2H1z',
  Supply: 'M6 1h4v3H6zM5 5h6v2l2 2v5H3V9l2-2z',
  Booster: 'M6 14V7H2l6-6 6 6h-4v7z',
  Scroll: 'M4 2h9v10h-2v3H2v-3h2zM5 5v1h6V5zM5 8v1h6V8z',
  Accessory: 'M5 2h6v2h2v2h1v5h-2v2H4v-2H2V6h1V4h2zM5 6v4h6V6z',
  Forge: 'M2 2h9v4H7v2H4V6H2zM6 8h3v7H6zM11 4h3v3h-3z',
  Gold: 'M5 1h6l4 4v6l-4 4H5l-4-4V5zM7 4v8h2V4z',
  Imbue: 'M7 1h2v4l2 2h4v2h-4l-2 2v4H7v-4L5 9H1V7h4l2-2z',
  Seal: 'M2 2h12v8l-6 5-6-5zM7 4v6h2V4z',
};
export function rewardIcon(category) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.classList.add('reward-glyph');
  const path = document.createElementNS(svg.namespaceURI, 'path');
  path.setAttribute('d', PATHS[category.endsWith('Scroll') ? 'Scroll' : category] || PATHS.Supply);
  path.setAttribute('fill', 'currentColor');
  path.setAttribute('fill-rule', 'evenodd');
  svg.append(path);
  return svg;
}
