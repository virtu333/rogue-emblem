import regions from '../../data/regions.json';

export function regionName(act) {
  return regions[act] || '';
}

export function battlePlace(gameData, config, act) {
  const templates = Object.values(gameData?.mapTemplates || {})
    .filter(Array.isArray)
    .flat();
  const template = templates.find((entry) => entry.id === config?.templateId);
  const region = regionName(act);
  return {
    title: [region, template?.name].filter(Boolean).join(' — '),
    lore: template?.lore || '',
  };
}
