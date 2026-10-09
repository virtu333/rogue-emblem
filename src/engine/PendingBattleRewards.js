import { generateLootChoices, calculateSkipLootBonus } from './LootSystem.js';
import { getRating, calculateBonusGold } from './TurnBonusCalculator.js';
import { buildPrologueLootChoices } from './Prologue.js';
import { isPrologueRun } from './ScriptedBattle.js';
import { gambleSummary } from './BattleGoldGamble.js';
import {
  LOOT_CHOICES,
  ELITE_LOOT_CHOICES,
  ELITE_MAX_PICKS,
  GOLD_LOOT_REWARD_MULTIPLIER,
  LOOT_VULNERARY_BUNDLE,
} from '../utils/constants.js';

/**
 * The parameters a battle's random loot draw is made with, saved on the reward record
 * (`record.draw`) so a Branching Threads reroll draws exactly as the original did.
 * Pure: reads the reward context only.
 */
export function rewardDrawParams(run, ctx) {
  const meta = ctx.metaEffects || null;
  const pressure = Number(ctx.victoryPressureState?.goldMultiplier ?? 1);
  return {
    actId: run.currentAct,
    isElite: ctx.isElite === true,
    isBoss: ctx.isBoss === true,
    lootWeaponQualityBonus: meta?.lootWeaponQualityBonus ?? meta?.lootWeaponWeightBonus ?? 0,
    lootCategoryWeightBonuses: meta?.lootCategoryWeightBonuses
      ? structuredClone(meta.lootCategoryWeightBonuses)
      : null,
    goldMultiplier: Number.isFinite(pressure) ? pressure : 1,
  };
}

/**
 * Roll a battle's random item choices: the one draw the first offer and every reroll
 * share, so they cannot drift. Uses Math.random (as it always has); the Vulnerary bundle
 * and the late-pressure gold multiplier apply here. Accessory skills and weapon-art
 * spawns ride generateLootChoices itself.
 */
export function rollBattleRewardChoices(run, data, draw) {
  const choices = generateLootChoices(
    draw.actId || run.currentAct,
    data.lootTables,
    data.weapons,
    run.getConsumableCatalog(),
    draw.isElite ? ELITE_LOOT_CHOICES : LOOT_CHOICES,
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
  );
  // A rolled Vulnerary reward is a small bundle (LOOT_VULNERARY_BUNDLE items).
  for (const choice of choices)
    if (choice.item?.name === 'Vulnerary') choice.quantity = LOOT_VULNERARY_BUNDLE;
  const pressure = Number.isFinite(draw.goldMultiplier) ? draw.goldMultiplier : 1;
  for (const choice of choices)
    if (choice.type === 'gold')
      choice.goldAmount = Math.max(0, Math.floor((choice.goldAmount || 0) * pressure));
  return JSON.parse(JSON.stringify(choices));
}

// Prepared once with the victorious roster, before the completed-battle save.
// Rendering, leaving, and reloading must never roll choices or award earnings.
// `ctx.authoredLoot` (a prologue chapter's offer, battleConfig.loot) replaces the
// random draw with the authored choices.
export function prepareBattleRewards(run, data, ctx) {
  if (run.pendingBattleReward) return run.pendingBattleReward;
  const pressure = ctx.victoryPressureState?.goldMultiplier ?? 1;
  let turnGold = 0,
    rating = '';
  if (ctx.turnPar != null && ctx.turnBonusConfig) {
    const result = getRating(ctx.turnNumber, ctx.turnPar, ctx.turnBonusConfig);
    rating = result.rating;
    turnGold = run.awardGold(
      Math.max(
        0,
        Math.floor(calculateBonusGold(result, run.currentAct, ctx.turnBonusConfig) * pressure),
      ),
    );
  }
  const authored = Array.isArray(ctx.authoredLoot);
  const draw = authored ? null : rewardDrawParams(run, ctx);
  const choices = authored
    ? buildPrologueLootChoices(ctx.authoredLoot, data, { actId: run.currentAct })
    : rollBattleRewardChoices(run, data, draw);
  // Authored loot (the prologue's) keeps the quantity its data names, and its gold as written
  // but for the late-pressure multiplier every gold card takes.
  if (authored)
    for (const choice of choices)
      if (choice.type === 'gold')
        choice.goldAmount = Math.max(0, Math.floor((choice.goldAmount || 0) * pressure));
  const total = (ctx.goldEarned || 0) + (ctx.completionGoldAward || 0) + turnGold;
  // Gambler's Toss: the header says the battle's gold was doubled or cut to a third (this node's toss).
  const toss = run.lastBattleGoldGamble;
  const tossNote =
    toss && toss.nodeId === (ctx.nodeId || run.currentNodeId) ? ` · ${gambleSummary(toss)}` : '';
  run.pendingBattleReward = {
    version: 1,
    nodeId: ctx.nodeId || run.currentNodeId,
    actId: run.currentAct,
    choices: JSON.parse(JSON.stringify(choices)),
    claimed: [],
    picksRemaining: ctx.isElite ? ELITE_MAX_PICKS : 1,
    // The skip pays from the gold the battle earned, never from the choices, so a reroll
    // leaves it as it is.
    skipGold: Math.floor(calculateSkipLootBonus(total) * GOLD_LOOT_REWARD_MULTIPLIER),
    summary: `Battle and completion: ${ctx.battleCompletionAwardedGold ?? total - turnGold} gold${turnGold ? ` · Turn ${rating}: +${turnGold} gold` : ''}${tossNote}`,
    draft: { selected: 0, path: [] },
    // How the choices were drawn (Branching Threads rerolls with the same); null for
    // authored loot, which can never be rerolled.
    draw,
  };
  return run.pendingBattleReward;
}

export function finishRewardClaim(run, index) {
  const record = run.pendingBattleReward;
  if (!record || record.claimed.includes(index) || index < 0 || index > record.choices.length)
    return false;
  record.claimed.push(index);
  record.picksRemaining = index === record.choices.length ? 0 : record.picksRemaining - 1;
  record.draft = { selected: 0, path: [] };
  if (record.picksRemaining <= 0) run.pendingBattleReward = null;
  return true;
}

// ── Branching Threads: battle-reward rerolls ────────────────────────────

/**
 * Rerolls this run was granted (the Home Base upgrade, snapshotted into the run's meta
 * effects at its start). The prologue run applies no meta effects and has none.
 */
export function rewardRerollsGranted(run) {
  if (!run || isPrologueRun(run)) return 0;
  return Math.max(0, Math.trunc(Number(run.metaEffects?.rewardRerolls) || 0));
}

/** Rerolls spent this run (saved as `run.rewardRerollsSpent`; older saves read 0). */
export function rewardRerollsSpent(run) {
  return Math.max(0, Math.trunc(Number(run?.rewardRerollsSpent) || 0));
}

/** Rerolls left this run. */
export function rewardRerollsLeft(run) {
  return Math.max(0, rewardRerollsGranted(run) - rewardRerollsSpent(run));
}

export const REWARD_REROLL_BLOCKS = Object.freeze({
  none: 'none', // no Branching Threads this run
  noReward: 'noReward', // nothing pending
  fixed: 'fixed', // authored loot, or a record saved before rerolls existed
  picked: 'picked', // a pick from this reward was already taken
  spent: 'spent', // every reroll this run is spent
});

/**
 * Why the pending reward cannot be rerolled now, or '' when it can. Pure.
 * @returns {'' | keyof REWARD_REROLL_BLOCKS}
 */
export function rewardRerollBlock(run, record = run?.pendingBattleReward) {
  if (rewardRerollsGranted(run) <= 0) return REWARD_REROLL_BLOCKS.none;
  if (!record || record !== run.pendingBattleReward) return REWARD_REROLL_BLOCKS.noReward;
  if (!record.draw || typeof record.draw !== 'object') return REWARD_REROLL_BLOCKS.fixed;
  if ((record.claimed?.length || 0) > 0) return REWARD_REROLL_BLOCKS.picked;
  if (rewardRerollsLeft(run) <= 0) return REWARD_REROLL_BLOCKS.spent;
  return '';
}

/** What the reward screen shows about rerolls. Pure. */
export function rewardRerollStatus(run, record = run?.pendingBattleReward) {
  return {
    granted: rewardRerollsGranted(run),
    left: rewardRerollsLeft(run),
    block: rewardRerollBlock(run, record),
  };
}

/**
 * Reroll the pending battle reward: one atomic commit. The whole set of choices is drawn
 * again with the original draw's parameters and the charge is spent, then `persist` saves
 * both together; when it fails, the record and the count are put back as they were. Gold
 * already earned (turn bonus, kills, completion, the skip's figure) is never touched.
 * @param {object} run
 * @param {object} data - game data (loot tables and catalogs)
 * @param {{ persist?: () => boolean }} [options]
 * @returns {{ ok: true, choices: object[] } | { ok: false, reason: string, saveFailed?: boolean }}
 */
export function rerollBattleReward(run, data, { persist = null } = {}) {
  const block = rewardRerollBlock(run);
  if (block) return { ok: false, reason: block };
  const record = run.pendingBattleReward;
  const before = {
    choices: record.choices,
    draft: record.draft,
    revealed: record.revealed,
    rerolls: record.rerolls,
    spent: run.rewardRerollsSpent,
  };
  const choices = rollBattleRewardChoices(run, data, record.draw);
  record.choices = choices;
  record.draft = { selected: 0, path: [] };
  // The new cards turn face up as they arrive; a reload shows them face up.
  record.revealed = true;
  record.rerolls = Math.max(0, Math.trunc(Number(record.rerolls) || 0)) + 1;
  run.rewardRerollsSpent = rewardRerollsSpent(run) + 1;
  if (persist && !persist()) {
    record.choices = before.choices;
    record.draft = before.draft;
    if (before.revealed === undefined) delete record.revealed;
    else record.revealed = before.revealed;
    if (before.rerolls === undefined) delete record.rerolls;
    else record.rerolls = before.rerolls;
    run.rewardRerollsSpent = before.spent;
    return { ok: false, reason: 'save', saveFailed: true };
  }
  return { ok: true, choices };
}
