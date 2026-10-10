// LotteryLoot.js - Lottery Loot (`next_act_loot_card`, blessings v3 §5.4): one card of each
// battle's loot is drawn from the NEXT act's table (the final act, or one whose next table pays only
// gold, draws its own; a gold-only act has no lottery).
//
// The battle's own draw is made first, exactly as without the blessing (its Math.random draws do
// not move: the same cards, the same cursor); then its last card(s) are replaced by a draw from
// the next act's table made under a seeded Math.random on its own stream
// (`lottery-loot:${runSeed}:${nodeId}:${round}`, round 0 for the first offer and n for the n-th
// Branching Threads reroll), so the battle, node-map and loot streams never see it. Which table
// was used is saved on the reward record (`draw.lotteryActId`), so a reroll draws from the same
// one. Authored loot (the prologue's) has no draw and is never touched. Pure but for the swap.

import { generateLootChoices } from './LootSystem.js';
import { withEclipseSeed } from './EclipseSystem.js';
import { isPrologueRun } from './ScriptedBattle.js';
import { shrineBoonsOf } from './ShrineBoons.js';

// Extra draws on the lottery stream when the first repeats a card already on offer.
const LOTTERY_ATTEMPTS = 3;

/** A loot table that can pay something other than gold (the final boss's pays only gold). */
function drawsItems(table) {
  const weights = table?.weights;
  if (!weights || typeof weights !== 'object') return false;
  return Object.entries(weights).some(
    ([category, weight]) => category !== 'gold' && Number(weight) > 0,
  );
}

/**
 * The loot table a run's lottery draws from: the next act's, else the current act's own (the
 * last act, or a next act whose table pays only gold), else none (null: no lottery). A table
 * with no positive non-gold weight is never drawn: it could only repeat the battle's gold.
 */
export function lotteryActFor(run, lootTables = run?.gameData?.lootTables) {
  const sequence = Array.isArray(run?.actSequence) ? run.actSequence : [];
  const index = Number.isInteger(run?.actIndex) ? run.actIndex : sequence.indexOf(run?.currentAct);
  for (const actId of [sequence[index + 1], run?.currentAct])
    if (actId && drawsItems(lootTables?.[actId])) return actId;
  return null;
}

/** The lottery line a reward card shows: only a card drawn from the next act's table says so. */
export function lotteryCardLine(card) {
  return card?.lottery && card.lottery.nextAct !== false
    ? "Lottery: from the next act's spoils"
    : '';
}

/**
 * The lottery's part of a battle's draw parameters (`rewardDrawParams`): `{ lotteryActId,
 * lotteryCards, lotteryKey }` while Lottery Loot is held, or null (no key is then written, so a
 * run without it saves the draw exactly as before). Never in the prologue.
 */
export function lotteryDrawParams(run, { nodeId = null } = {}) {
  if (!run || isPrologueRun(run)) return null;
  const cards = shrineBoonsOf(run).nextActLootCards;
  const actId = cards > 0 ? lotteryActFor(run) : null;
  if (!actId) return null;
  return { lotteryActId: actId, lotteryCards: cards, lotteryKey: String(nodeId ?? '') };
}

const sameCard = (a, b) =>
  a?.type === b?.type && (a.type === 'gold' || (a.item?.name && a.item.name === b.item?.name));

/**
 * Replace the last `draw.lotteryCards` of `choices` (the battle's own draw) with cards from the
 * lottery's table, each marked `lottery: { actId }`. At least one card of the battle's own draw
 * is always kept. Returns a new array; `choices` is not changed. Uses no caller randomness.
 * @param {object} run
 * @param {object} data game data (loot tables, catalogs)
 * @param {object} draw the reward record's draw parameters
 * @param {object[]} choices
 * @param {{ round?: number }} [options]
 */
export function applyLotteryCards(run, data, draw, choices, { round = 0 } = {}) {
  const actId = draw?.lotteryActId;
  const wanted = Math.max(0, Math.trunc(Number(draw?.lotteryCards) || 0));
  if (!actId || wanted <= 0 || !Array.isArray(choices) || choices.length < 2) return choices;
  const count = Math.min(wanted, choices.length - 1);
  const kept = choices.slice(0, choices.length - count);
  const seed = Number.isFinite(Number(run?.runSeed)) ? Number(run.runSeed) >>> 0 : 0;
  const drawOne = (slot, attempt) =>
    withEclipseSeed(
      `lottery-loot:${seed}:${draw.lotteryKey ?? ''}:${Math.max(0, Math.trunc(round))}:${slot}:${attempt}`,
      () =>
        generateLootChoices(
          actId,
          data.lootTables,
          data.weapons,
          run.getConsumableCatalog(),
          1,
          draw.lootWeaponQualityBonus || 0,
          data.accessories,
          data.whetstones,
          run.roster,
          draw.isBoss === true,
          null,
          draw.isElite === true,
          run.getWeaponArtSpawnConfig(),
          {
            lootCategoryWeightBonuses: draw.lootCategoryWeightBonuses || undefined,
            imbues: data.imbues || null,
          },
        )[0] || null,
    );
  // `nextAct`: whether the card came from a later act's table (the card says so) or the act's own.
  const nextAct = actId !== (draw.actId || run?.currentAct);
  const out = [...kept];
  for (let slot = 0; slot < count; slot++) {
    let card = null;
    for (let attempt = 0; attempt < LOTTERY_ATTEMPTS && !card; attempt++) {
      const candidate = drawOne(slot, attempt);
      if (candidate && !out.some((existing) => sameCard(existing, candidate))) card = candidate;
    }
    // Nothing new drawable (an empty table, or every attempt repeated a card already on offer):
    // the battle's own card stays.
    out.push(card ? { ...card, lottery: { actId, nextAct } } : choices[kept.length + slot]);
  }
  return out;
}
