import regions from '../../data/regions.json';
import { findSetPiece, setPieceIdOfConfig } from '../engine/SetPieces.js';

export function regionName(act) {
  return regions[act] || '';
}

export function battlePlace(gameData, config, act) {
  const region = regionName(act);
  // An event's set piece names its own place (docs/specs/event-set-pieces.md).
  const setPiece = findSetPiece(gameData?.setPieces, setPieceIdOfConfig(config));
  if (setPiece) {
    return {
      title: [region, setPiece.title].filter(Boolean).join(' — '),
      lore: setPiece.lore || '',
    };
  }
  const templates = Object.values(gameData?.mapTemplates || {})
    .filter(Array.isArray)
    .flat();
  const template = templates.find((entry) => entry.id === config?.templateId);
  return {
    title: [region, template?.name].filter(Boolean).join(' — '),
    lore: template?.lore || '',
  };
}
