// BattleGoldGamble.js - the `battle_gold_gamble` blessing boon (Gambler's Toss): each victory's
// battle gold is doubled or cut to a third on a toss, seeded by the run and the node.
// Docs: docs/blessings_contract.md, docs/specs/blessings-v3.md §5.4.
//
// Pure. The toss never touches `Math.random`: it hashes `gamble:<runSeed>:<nodeId>` into a
// seeded stream and takes its first draw, so it moves no other stream, and a battle that is
// completed again (a retry, a reload, a Vision rewind) tosses the same face for the same node.

import { createSeededRng } from './BlessingEngine.js';

function hashToUint32(text) {
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Normalised boon params `{ chance, win, lose }`, or null when they are not a usable toss. */
export function parseBattleGoldGamble(params) {
  if (!params || typeof params !== 'object') return null;
  const chance = Number(params.chance);
  const win = Number(params.win);
  const lose = Number(params.lose);
  if (!(chance > 0 && chance < 1)) return null;
  if (!(win > 0 && Number.isFinite(win))) return null;
  if (!(lose >= 0 && Number.isFinite(lose))) return null;
  return { chance, win, lose };
}

/** The toss for one node: `{ face: 'win'|'lose', multiplier }`. */
export function rollBattleGoldGamble({ runSeed, nodeId, gamble }) {
  const rand = createSeededRng(hashToUint32(`gamble:${(Number(runSeed) || 0) >>> 0}:${nodeId}`));
  const face = rand() < gamble.chance ? 'win' : 'lose';
  return { face, multiplier: face === 'win' ? gamble.win : gamble.lose };
}

/**
 * The battle's gold after the toss: the multiplier applies to what the battle paid (after the
 * elite, Merchant Bane and rung multipliers), floored, before any Debt garnishes it.
 * @returns {{ nodeId: string, face: 'win'|'lose', multiplier: number, goldBefore: number,
 *   goldAfter: number }}
 */
export function settleBattleGoldGamble({ runSeed, nodeId, gamble, gold }) {
  const { face, multiplier } = rollBattleGoldGamble({ runSeed, nodeId, gamble });
  const goldBefore = Math.max(0, Math.floor(gold) || 0);
  return { nodeId, face, multiplier, goldBefore, goldAfter: Math.floor(goldBefore * multiplier) };
}

/** The card's own faces in words ("doubled", "cut to a third", "halved"), else ×N. */
export function gambleWord(record) {
  if (!record) return '';
  const m = record.multiplier;
  if (m === 2) return 'doubled';
  if (m === 0.5) return 'halved';
  if (Math.abs(m - 1 / 3) < 0.005) return 'cut to a third';
  return `×${m}`;
}

/** The victory band's line for a toss record: ["Gambler's Toss: doubled (+120 G)"]. */
export function gambleLines(record) {
  if (!record) return [];
  const delta = record.goldAfter - record.goldBefore;
  const sign = delta < 0 ? '−' : '+';
  return [`Gambler's Toss: ${gambleWord(record)} (${sign}${Math.abs(delta)} G)`];
}

/** The reward header's suffix for a toss record ("Gambler's Toss: doubled"), or ''. */
export function gambleSummary(record) {
  return record ? `Gambler's Toss: ${gambleWord(record)}` : '';
}
