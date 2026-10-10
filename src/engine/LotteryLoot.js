// LotteryLoot.js - Lottery Loot (`next_act_loot_card`, blessings v3 §5.4): one card of each
// battle's loot is drawn from the NEXT act's table (the final act draws its own).
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

/** The loot table a run's lottery draws from: the next act's, or the final act's own. */
export function lotteryActFor(run, lootTables = run?.gameData?.lootTables) {
  const sequence = Array.isArray(run?.actSequence) ? run.actSequence : [];
  const index = Number.isInteger(run?.actIndex) ? run.actIndex : sequence.indexOf(run?.currentAct);
  const next = sequence[index + 1];
  if (next && lootTables?.[next]) return next;
  return run?.currentAct || null;
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
  const out = [...kept];
  for (let slot = 0; slot < count; slot++) {
    let card = null;
    for (let attempt = 0; attempt < LOTTERY_ATTEMPTS; attempt++) {
      const candidate = drawOne(slot, attempt);
      if (!candidate) continue;
      card = candidate;
      if (!out.some((existing) => sameCard(existing, candidate))) break;
    }
    // Nothing drawable (an empty table): the battle's own card stays.
    out.push(card ? { ...card, lottery: { actId } } : choices[kept.length + slot]);
  }
  return out;
}
