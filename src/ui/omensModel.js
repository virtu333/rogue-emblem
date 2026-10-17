// omensModel.js — the words and rules of the Omens picker (difficulty screen) and the pause
// list's Heat entry, as plain data. Pure: no Phaser, no DOM. The rules themselves (ranks, Heat,
// which rungs) are engine/Omens.js; this file only arranges them for a menu.
import { omenList, sanitizeOmenRanks, heatOf, runHeat } from '../engine/Omens.js';

/** The footer button's label. */
export const heatLabel = (heat) => `Omens: Heat ${Math.max(0, Math.trunc(Number(heat) || 0))}`;

/** One row per Omen: the rank chosen, its words and Heat (the lore line while Off). */
export function omenRows(gameData, ranks) {
  const clean = sanitizeOmenRanks(ranks, gameData);
  return omenList(gameData).map((omen) => {
    const rank = clean[omen.id] || 0;
    const entry = rank > 0 ? omen.ranks[rank - 1] : null;
    const next = rank < omen.ranks.length ? omen.ranks[rank] : null;
    return {
      id: omen.id,
      name: omen.name,
      rank,
      max: omen.ranks.length,
      heat: entry ? entry.heat : 0,
      text: entry ? entry.text : omen.lore,
      nextHeat: next ? next.heat : null,
      rankLabel: rank > 0 ? `Rank ${rank}/${omen.ranks.length}` : 'Off',
    };
  });
}

/** 0 -> 1 -> ... -> max -> 0. */
export function cycleRank(rank, max) {
  const next = (Math.trunc(Number(rank)) || 0) + 1;
  return next > max ? 0 : Math.max(0, next);
}

/** The choice after one Omen's rank cycles (a new object; rank 0 is dropped). */
export function cycleOmen(gameData, ranks, id) {
  const omen = omenList(gameData).find((o) => o.id === id);
  const clean = sanitizeOmenRanks(ranks, gameData);
  if (!omen) return clean;
  const rank = cycleRank(clean[id] || 0, omen.ranks.length);
  const out = { ...clean };
  if (rank > 0) out[id] = rank;
  else delete out[id];
  return out;
}

/** The detail area's note, or '' when nothing is chosen. */
export function omensNote(gameData, ranks) {
  const clean = sanitizeOmenRanks(ranks, gameData);
  const names = omenList(gameData)
    .filter((o) => clean[o.id])
    .map((o) => (o.ranks.length > 1 ? `${o.name} ${clean[o.id]}` : o.name));
  return names.length ? `Omens · Heat ${heatOf(clean, gameData)}: ${names.join(', ')}` : '';
}

/** The picker header's summary. */
export function omensSummary(gameData, ranks, best) {
  const heat = heatOf(sanitizeOmenRanks(ranks, gameData), gameData);
  return `Heat ${heat} · Best: ${Math.max(0, Math.trunc(Number(best) || 0))}`;
}

/** The pause list's entry for a run's Omens, or null when it has none. */
export function omensPauseEntry(run) {
  const heat = runHeat(run);
  if (heat <= 0) return null;
  const ranks = run?.omens?.ranks || {};
  const text = omenList(run.gameData)
    .filter((o) => ranks[o.id] > 0)
    .map((o) => `${o.name}: ${o.ranks[Math.min(ranks[o.id], o.ranks.length) - 1].text}`)
    .join(' ');
  return { id: 'omens-heat', label: `Omens · Heat ${heat}`, short: `Heat ${heat}`, text };
}
