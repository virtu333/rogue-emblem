import { generateLootChoices, calculateSkipLootBonus } from './LootSystem.js';
import { getRating, calculateBonusGold } from './TurnBonusCalculator.js';
import {
  LOOT_CHOICES,
  ELITE_LOOT_CHOICES,
  ELITE_MAX_PICKS,
  GOLD_LOOT_REWARD_MULTIPLIER,
} from '../utils/constants.js';

// Prepared once with the victorious roster, before the completed-battle save.
// Rendering, leaving, and reloading must never roll choices or award earnings.
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
  const choices = generateLootChoices(
    run.currentAct,
    data.lootTables,
    data.weapons,
    data.consumables,
    ctx.isElite ? ELITE_LOOT_CHOICES : LOOT_CHOICES,
    ctx.metaEffects?.lootWeaponQualityBonus ?? ctx.metaEffects?.lootWeaponWeightBonus ?? 0,
    data.accessories,
    data.whetstones,
    run.roster,
    ctx.isBoss,
    null,
    ctx.isElite,
    run.getWeaponArtSpawnConfig(),
    {
      lootCategoryWeightBonuses: ctx.metaEffects?.lootCategoryWeightBonuses,
      imbues: data.imbues || null,
    },
  );
  for (const choice of choices) if (choice.item?.name === 'Vulnerary') choice.quantity = 2;
  for (const choice of choices)
    if (choice.type === 'gold')
      choice.goldAmount = Math.max(0, Math.floor((choice.goldAmount || 0) * pressure));
  const total = (ctx.goldEarned || 0) + (ctx.completionGoldAward || 0) + turnGold;
  run.pendingBattleReward = {
    version: 1,
    nodeId: ctx.nodeId || run.currentNodeId,
    actId: run.currentAct,
    choices: JSON.parse(JSON.stringify(choices)),
    claimed: [],
    picksRemaining: ctx.isElite ? ELITE_MAX_PICKS : 1,
    skipGold: Math.floor(calculateSkipLootBonus(total) * GOLD_LOOT_REWARD_MULTIPLIER),
    summary: `Battle and completion: ${ctx.battleCompletionAwardedGold ?? total - turnGold} gold${turnGold ? ` · Turn ${rating}: +${turnGold} gold` : ''}`,
    draft: { selected: 0, path: [] },
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
