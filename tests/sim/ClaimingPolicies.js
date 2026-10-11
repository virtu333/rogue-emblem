// ClaimingPolicies.js - opt-in player choices that claim what blessings v3 hands out, for the
// blessing balance sims (tests/sim/ClaimingRunDriver.js, `npm run sim:blessings`).
//
// The stock full-run policies (RunPolicies.js) never take a start blessing, a gift or an earned
// pick, never claim battle loot, never steal, swap a candidate, rewind, make a second vow, forge
// or fight in the arena, so the cards those choices reach were never measured (PR #264-#271).
// Each policy here is a plain player habit, not an oracle: it reads only what the game shows the
// player (the offer, the cards, the menus) and acts through the same engine commands the scenes
// call (RunManager, ChurchCommands/ChurchVow, ShopCommands, LootRewardCommands, RosterInventory,
// RosterTransfers, RosterArtCommands, ColosseumEngine/ArenaBout, EarnedBlessings, EventCommands).
// Nothing here re-implements a rule.
//
// Any choice between equals (which card of an offer) is made by a keyed hash of the run seed
// (`policyPick`), never by Math.random, so a policy never moves a game stream by itself, and the
// same seed makes the same choice whatever else the sim turns on.
//
// The stock policies are untouched: nothing here runs unless a driver asks for it.

import { getReviveCost } from '../../src/engine/RunManager.js';
import {
  canEquip,
  canPromote,
  gainExperience,
  resolvePromotionTargets,
} from '../../src/engine/UnitManager.js';
import {
  earnedPickOwed,
  ledgerKeyOf,
  openSanctum,
  skipEarnedBlessing,
  takeEarnedBlessing,
  takeableOffered,
} from '../../src/engine/EarnedBlessings.js';
import { payChurchTithe } from '../../src/engine/ChurchTithe.js';
import {
  churchBlessingOffers,
  churchCleanseBlock,
  churchVowBlock,
  churchVows,
  churchVowsLeft,
  cleanseAtChurch,
  sanctumBlessingOffers,
  takeChurchBlessing,
  takeSanctumBlessing,
} from '../../src/engine/ChurchVow.js';
import {
  churchPromoteCost,
  churchPromotionBlock,
  healRosterAtChurch,
  promoteAtChurch,
  reviveAtChurch,
  churchReviveBlock,
} from '../../src/engine/ChurchCommands.js';
import { cleansableBurdens } from '../../src/engine/Burdens.js';
import {
  chooseRuinsPath,
  reviveAtRuins,
  ruinsReviveBlock,
} from '../../src/engine/RuinsCommands.js';
import { finishRewardClaim, prepareBattleRewards } from '../../src/engine/PendingBattleRewards.js';
import {
  applyAccessoryReward,
  applyRewardBundle,
  applyRewardForge,
  bundleTargetBlock,
  rewardWeaponEligible,
} from '../../src/engine/LootRewardCommands.js';
import { awardTeamXp } from '../../src/engine/TeamXp.js';
import { rosterAccessoryAction, rosterItemAction } from '../../src/engine/RosterInventory.js';
import { teachRosterScroll } from '../../src/engine/RosterTransfers.js';
import { bindRosterArt, rosterArtBlock } from '../../src/engine/RosterArtCommands.js';
import { applyRosterClassChange, rosterClassChangeBlock } from '../../src/engine/RosterCommands.js';
import { forgeShopWeapon, shopForgeBlock, shopForgeTerms } from '../../src/engine/ShopCommands.js';
import {
  arenaEntryBlock,
  arenaEntryFee,
  arenaVisitBouts,
  arenaVisitCap,
  calculateArenaReward,
  calculateArenaXP,
  generateChallenger,
  getArenaWeapon,
  getAvailableTiers,
  getMaxFights,
  getMaxFightsPerVisit,
} from '../../src/engine/ColosseumEngine.js';
import {
  arenaMaxRounds,
  arenaRoundOutcome,
  estimateArenaOdds,
  resolveArenaRound,
} from '../../src/engine/ArenaBout.js';
import { colosseumOfferDue, prepareColosseumOffer } from '../../src/engine/EarnedBlessings.js';
import { equipWeapon } from '../../src/engine/UnitManager.js';
import { getImbueList } from '../../src/engine/ImbueSystem.js';
import { settleAccessoryHpOwed } from '../../src/engine/UnitHealth.js';
import { RECRUIT_PROMOTION_BASE_LEVEL, MAX_SKILLS } from '../../src/utils/constants.js';
import { findCommander } from '../../src/engine/Commander.js';
import { chooseEventOption, eventView } from '../../src/engine/EventCommands.js';
import { eventCatalogOf, findEvent } from '../../src/engine/EventSystem.js';
import {
  choiceGrantsEarned,
  choiceLeadsOn,
  choiceMayFight,
  deploymentCombatValue,
} from './RunPolicies.js';

// ── Keyed choices ──────────────────────────────────────────────────────────

/** FNV-1a over a string, unsigned. */
export function policyHash(text) {
  let h = 2166136261 >>> 0;
  for (const ch of String(text)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h >>> 0;
}

/** A choice among `n` equals keyed by the run seed and `key` (never Math.random). */
export function policyPick(run, key, n) {
  if (!(n > 0)) return -1;
  return policyHash(`claim:${Number(run?.runSeed) >>> 0}:${key}`) % n;
}

// ── The shrine: a start blessing, a gift, or nothing ───────────────────────

/**
 * The start offer as a list of options: each offered blessing, the gift (when the shrine offers
 * one) and "no blessing".
 */
export function startOfferOptions(run) {
  const options = (run.getBlessingOptions?.() || []).map((b) => ({ kind: 'blessing', id: b.id }));
  const gift = run.getStartGiftOffer?.();
  if (gift) options.push({ kind: 'gift', id: gift.id });
  options.push({ kind: 'none', id: null });
  return options;
}

/**
 * Take something at the shrine. `mode`:
 * - 'random' (the report's default): one of the options, blessings, gift and "no blessing" alike,
 *   keyed by the run seed. A player with no preference; it makes taking a card independent of
 *   the run, so "took it" against "was offered it and took something else" is a fair comparison.
 * - 'first': the first card (the free tier I), as a cautious player would.
 * - 'none': no blessing (the stock sims' choice).
 * A gift that cannot be taken falls back to no blessing (the shrine would offer the choice
 * again; the sim records the refusal).
 * @returns {{ kind: 'blessing'|'gift'|'none', id: string|null, offered: object[], ok: boolean }}
 */
export function chooseStartOffer(run, { mode = 'random' } = {}) {
  const offered = startOfferOptions(run);
  let pick = offered.at(-1);
  if (mode === 'random') pick = offered[policyPick(run, 'start-offer', offered.length)];
  else if (mode === 'first') pick = offered.find((o) => o.kind === 'blessing') || pick;
  if (pick.kind === 'gift') {
    const taken = run.chooseStartGift(pick.id);
    if (taken?.ok) return { ...pick, offered, ok: true };
    run.chooseBlessing(null);
    return { kind: 'none', id: null, offered, ok: false, refused: pick.id };
  }
  const ok = run.chooseBlessing(pick.kind === 'blessing' ? pick.id : null) === true;
  return { ...pick, offered, ok };
}

// ── Earned picks ───────────────────────────────────────────────────────────

/**
 * Take every owed earned pick (an act boss's pair, an eclipsed elite's card, the Colosseum's):
 * one card, keyed by the run seed and the ledger key. Pure upside or a twist the player reads
 * on the card, a player takes one rather than leave the pick; a pick with nothing takeable left
 * is skipped (the game would show nothing). `sources` limits it (e.g. ['colosseum']).
 * @returns {{ key: string, source: string, offered: string[], taken: string|null }[]}
 */
export function takeOwedEarnedPicks(run, { sources = null } = {}) {
  const taken = [];
  for (let guard = 0; guard < 16; guard++) {
    const entry = earnedPickOwed(run, sources ? { sources } : {});
    if (!entry) break;
    const key = ledgerKeyOf(entry);
    const offered = takeableOffered(run, entry);
    const source = entry.source || 'act_boss';
    if (offered.length === 0) {
      if (!skipEarnedBlessing(run, key).ok) break;
      taken.push({ key, source, offered: [], taken: null });
      continue;
    }
    const id = offered[policyPick(run, `earned:${key}`, offered.length)];
    const result = takeEarnedBlessing(run, key, id);
    if (!result.ok) {
      if (!skipEarnedBlessing(run, key).ok) break;
      taken.push({ key, source, offered: [...entry.offered], taken: null, refused: id });
      continue;
    }
    taken.push({ key, source, offered: [...entry.offered], taken: id });
  }
  return taken;
}

// ── Battle rewards ─────────────────────────────────────────────────────────

function weaponUpgradeFor(unit, item) {
  if (!unit || item?.type === 'Consumable' || item?.type === 'Scroll') return -Infinity;
  if (!canEquip(unit, item)) return -Infinity;
  const current = unit.weapon;
  const mightGain = (Number(item.might) || 0) - (Number(current?.might) || 0);
  return current ? mightGain : 10;
}

/** What a reward card is worth to this player (higher is better). */
export function rewardChoiceValue(run, choice) {
  const item = choice?.item;
  if (choice?.type === 'gold') return (Number(choice.goldAmount) || 0) / 30;
  if (choice?.type === 'accessory') return 30;
  if (choice?.type === 'forge') return 35;
  if (!item) return 0;
  if (item.type === 'Consumable' && item.effect === 'statBoost') return 60;
  if (item.type === 'Scroll') return item.teachesWeaponArtId ? 12 : 28;
  if (item.type === 'Consumable') return item.effect === 'promote' ? 26 : 14;
  const best = Math.max(...(run.roster || []).map((u) => weaponUpgradeFor(u, item)));
  if (best >= 2) return 40 + best;
  return best > 0 ? 18 : 6;
}

function rewardTarget(run, choice) {
  const item = choice.item;
  const quantity = choice.quantity || 1;
  const roster = run.roster || [];
  const ok = (target) => !bundleTargetBlock(run, item, target, quantity);
  if (item.type === 'Consumable' && item.effect === 'statBoost') {
    const commander = findCommander(roster);
    return [commander, ...roster].find((u) => u && ok(u)) || null;
  }
  if (item.type === 'Consumable') {
    const hurt = [...roster].sort((a, b) => a.currentHP / a.stats.HP - b.currentHP / b.stats.HP);
    return hurt.find(ok) || (ok('convoy') ? 'convoy' : null);
  }
  const ranked = [...roster]
    .filter(ok)
    .sort((a, b) => weaponUpgradeFor(b, item) - weaponUpgradeFor(a, item));
  return ranked[0] || (ok('convoy') ? 'convoy' : null);
}

/** Apply one reward card as the reward screen does (PendingRewardController, MobileRewards). */
function applyRewardChoice(run, data, record, index) {
  const choice = record.choices[index];
  if (!choice) {
    run.awardGold(record.skipGold);
    return { ok: true };
  }
  if (choice.type === 'gold') {
    run.awardGold(choice.goldAmount || 0);
    awardTeamXp(run.roster, choice.xpAmount, data.classes, {
      extendedLevelingEnabled: run.getDifficultyModifier('extendedLevelingEnabled', false),
    });
    return { ok: true };
  }
  const item = choice.item;
  if (choice.type === 'accessory') {
    const bare = (run.roster || []).find((u) => !u.accessory);
    return applyAccessoryReward(run, item, bare || 'pool');
  }
  if (item?.type === 'Scroll') {
    (run.scrolls ||= []).push(structuredClone(item));
    return { ok: true };
  }
  if (choice.type === 'forge') {
    const commander = findCommander(run.roster || []);
    for (const unit of [commander, ...(run.roster || [])].filter(Boolean)) {
      const weapon = [unit.weapon, ...(unit.inventory || [])].find(
        (w) => w && unit.inventory?.includes(w) && rewardWeaponEligible(item, w),
      );
      if (!weapon) continue;
      const selection = item.imbueId === 'choice' ? getImbueList(data.imbues)[0]?.id : 'might';
      const result = applyRewardForge(run, data, item, unit, weapon, selection);
      if (result.ok) return result;
    }
    return { ok: false, reason: 'no eligible weapon' };
  }
  const target = rewardTarget(run, choice);
  if (!target) return { ok: false, reason: 'no room' };
  return applyRewardBundle(run, item, target, choice.quantity || 1);
}

/**
 * Claim a won battle's loot as the reward screen does: prepare the record (turn gold, Dawn
 * Tithe, the draw with Lottery Loot's card and Hollow Sun's Favor's gold), then take the best card
 * by `rewardChoiceValue` for each pick (an elite gives more), applying it through the engine's
 * reward commands; a card that cannot be placed falls to the next, and the skip gold is the last
 * resort. `ctx` is PostCombatController.rewardContext's shape.
 * @returns {{ record: object, picks: object[] }|null}
 */
export function claimBattleRewards(run, data, ctx) {
  const record = prepareBattleRewards(run, data, ctx);
  if (!record) return null;
  const picks = [];
  const lotteryOffered = record.choices.filter((c) => c?.lottery).length;
  for (let guard = 0; guard < 8 && run.pendingBattleReward === record; guard++) {
    const order = record.choices
      .map((choice, index) => ({ index, value: rewardChoiceValue(run, choice) }))
      .filter((entry) => !record.claimed.includes(entry.index))
      .sort((a, b) => b.value - a.value || a.index - b.index);
    let done = false;
    for (const { index } of order) {
      const result = applyRewardChoice(run, data, record, index);
      if (!result?.ok) continue;
      picks.push({ index, choice: record.choices[index] });
      finishRewardClaim(run, index);
      done = true;
      break;
    }
    if (!done) {
      applyRewardChoice(run, data, record, record.choices.length);
      finishRewardClaim(run, record.choices.length);
      picks.push({ index: record.choices.length, choice: null });
    }
  }
  return { record, picks, lotteryOffered };
}

// ── Between battles: items, accessories, scrolls, seals ────────────────────

const HEAL_BELOW = 0.6;

/**
 * Between battles a player drinks what the army carries: a unit below 60% HP uses a healing
 * item from its own bag, then the convoy's (Vulnerary before Elixir); every Gold Pouch is
 * opened; a stat booster a unit carries is used by that unit. All through rosterItemAction.
 * @returns {{ heals: object[], pouches: number, boosters: number }}
 */
export function useItemsBetweenBattles(run) {
  const out = { heals: [], pouches: 0, boosters: 0, pouchGold: 0 };
  const roster = run.roster || [];
  const convoy = () => run.convoy?.consumables || [];
  const healOrder = (a, b) =>
    (a.effect === 'healFull') - (b.effect === 'healFull') || (a.value || 0) - (b.value || 0);
  for (const unit of roster) {
    for (let guard = 0; guard < 6 && unit.currentHP < unit.stats.HP * HEAL_BELOW; guard++) {
      const own = (unit.consumables || []).filter((c) => ['heal', 'healFull'].includes(c.effect));
      const shared = convoy().filter((c) => ['heal', 'healFull'].includes(c.effect));
      const item = [...own.sort(healOrder), ...shared.sort(healOrder)][0];
      if (!item) break;
      const name = item.name;
      if (rosterItemAction(run, unit, item, 'heal')) break;
      out.heals.push({ unit: unit.name, item: name });
    }
  }
  for (const unit of roster) {
    for (const item of [...(unit.consumables || [])]) {
      if (item.effect === 'gold' && !rosterItemAction(run, unit, item, 'use')) out.pouches++;
      else if (item.effect === 'statBoost' && !rosterItemAction(run, unit, item, 'use'))
        out.boosters++;
    }
  }
  const commander = findCommander(roster) || roster[0];
  for (const item of [...convoy()]) {
    if (!commander) break;
    if (item.effect === 'gold') {
      const before = run.gold;
      if (!rosterItemAction(run, commander, item, 'use')) {
        out.pouches++;
        out.pouchGold += run.gold - before;
      }
    } else if (item.effect === 'statBoost' && !rosterItemAction(run, commander, item, 'use'))
      out.boosters++;
  }
  return out;
}

/** Equip the shared pool's accessories on units wearing none (commander first). */
export function equipAccessories(run) {
  let equipped = 0;
  const roster = run.roster || [];
  const commander = findCommander(roster);
  for (const unit of [commander, ...roster].filter(Boolean)) {
    if (unit.accessory || !(run.accessories || []).length) continue;
    if (!rosterAccessoryAction(run, unit, run.accessories[0])) equipped++;
  }
  return equipped;
}

/**
 * Learn the team's scrolls: a skill scroll goes to the first unit (commander, then lords, then
 * the rest) that does not know it and has a free skill slot; an art scroll is bound to the first
 * weapon it fits (RosterArtCommands). A scroll nobody can use stays.
 */
export function learnScrolls(run, data) {
  const out = { skills: 0, arts: 0 };
  const roster = run.roster || [];
  const order = [...roster].sort(
    (a, b) =>
      Number(!!b.isCommander) - Number(!!a.isCommander) || Number(!!b.isLord) - Number(!!a.isLord),
  );
  const arts = data.weaponArts?.arts || [];
  for (const scroll of [...(run.scrolls || [])]) {
    if (scroll.teachesWeaponArtId) {
      let bound = false;
      for (const unit of order) {
        for (const weapon of unit.inventory || []) {
          if (rosterArtBlock(run, unit, weapon, scroll, arts)) continue;
          if (bindRosterArt(run, unit, weapon, scroll, arts).ok) {
            out.arts++;
            bound = true;
            break;
          }
        }
        if (bound) break;
      }
      continue;
    }
    for (const unit of order) {
      if ((unit.skills || []).length >= MAX_SKILLS) continue;
      if (teachRosterScroll(run, unit, scroll, data.skills || []).ok) {
        out.skills++;
        break;
      }
    }
  }
  return out;
}

/**
 * Use a Master Seal on a unit that can promote (lords first). Kingmaker's Oath refuses every seal
 * (its twist): the refusal is counted, as a player who tries would see it.
 */
export function useMasterSeals(run, data) {
  const out = { promoted: 0, refused: 0 };
  const seals = () => [
    ...(run.roster || []).flatMap((u) =>
      (u.consumables || [])
        .filter((c) => c.effect === 'promote')
        .map((item) => ({ holder: u, item })),
    ),
    ...(run.convoy?.consumables || [])
      .filter((c) => c.effect === 'promote')
      .map((item) => ({ holder: null, item })),
  ];
  const candidates = [...(run.roster || [])]
    .filter((u) => canPromote(u))
    .sort((a, b) => Number(!!b.isLord) - Number(!!a.isLord) || (b.level || 0) - (a.level || 0));
  for (const unit of candidates) {
    const seal = seals().find((s) => s.holder === unit || s.holder === null);
    if (!seal) break;
    const target = resolvePromotionTargets(unit, data.classes, data.lords)?.[0];
    if (!target) continue;
    if (rosterClassChangeBlock(run, unit, seal.item, data)) {
      out.refused++;
      continue;
    }
    if (applyRosterClassChange(run, unit, seal.item, target, data)?.ok !== false) out.promoted++;
  }
  return out;
}

// ── Recruit nodes: Open Roll's second candidate ────────────────────────────

/**
 * Open Roll: before a recruit battle, meet the other candidate when it would be the stronger
 * unit (RunManager.getRecruitNodeUnit builds both exactly as the battle would; the loom shows
 * both). Saved with the run, as the loom's "Meet X instead" does.
 * @returns {{ offered: boolean, swapped: boolean }}
 */
export function chooseRecruitCandidate(run, node) {
  const alt = run.getRecruitAlternate?.(node.id);
  if (!alt) return { offered: false, swapped: false };
  const current = run.getRecruitNodeUnit(node)?.unit;
  const other = run.getRecruitNodeUnit(node, { preview: alt })?.unit;
  if (!other) return { offered: true, swapped: false };
  if (current && deploymentCombatValue(other) <= deploymentCombatValue(current))
    return { offered: true, swapped: false };
  const result = run.swapRecruitCandidate(node.id);
  return { offered: true, swapped: result?.ok === true };
}

// ── Churches, the Old Sanctum and the Ruins ────────────────────────────────

function promotable(run, nodeId, data) {
  return [...(run.roster || [])]
    .filter((u) => !churchPromotionBlock(run, u, nodeId, data))
    .sort((a, b) => Number(!!b.isLord) - Number(!!a.isLord) || (b.level || 0) - (a.level || 0));
}

/**
 * A church visit as a player makes it (ChurchController + ChurchMenu, through their commands):
 * the door (the Old Sanctum's pair, the Tithe Box), Heal all, revive the cheapest fallen the
 * purse affords, then the vows the church accepts (one, two with Twin Chapel), in this order of
 * preference: the sanctum's earned card, Promotion (as many as the purse and the rung allow),
 * Cleansing (the first burden a church lifts), a tier I Blessing. Each vow is a different one.
 * @returns {object} what was done, for the sim's counters
 */
export function playChurch(run, node, data) {
  const nodeId = node.id;
  const out = {
    tithe: 0,
    sanctum: null,
    sanctumOffered: [],
    revived: [],
    promoted: [],
    freePromotions: 0,
    cleansed: null,
    blessing: null,
    vows: [],
  };
  openSanctum(run, nodeId);
  const tithe = payChurchTithe(run, nodeId);
  out.tithe = Number(tithe?.paid) || 0;
  healRosterAtChurch(run);
  for (let guard = 0; guard < 8; guard++) {
    const affordable = (run.fallenUnits || [])
      .filter((u) => !churchReviveBlock(run, u))
      .sort((a, b) => getReviveCost(a) - getReviveCost(b));
    if (!affordable.length) break;
    const unit = affordable[0];
    if (!reviveAtChurch(run, unit).ok) break;
    out.revived.push(unit.name);
  }
  if (out.revived.length) healRosterAtChurch(run);
  const vowOrder = ['sanctum', 'promote', 'cleanse', 'blessing'];
  for (const vow of vowOrder) {
    if (churchVowsLeft(run, nodeId) <= 0 && !churchVows(run, nodeId).includes(vow)) break;
    if (vow === 'sanctum') {
      const offers = sanctumBlessingOffers(run, nodeId, data);
      if (!offers.length) continue;
      out.sanctumOffered = offers.map((b) => b.id);
      const pick = offers[policyPick(run, `sanctum:${nodeId}`, offers.length)];
      if (takeSanctumBlessing(run, nodeId, pick.id, data).ok) out.sanctum = pick.id;
      continue;
    }
    if (vow === 'promote') {
      if (churchVowBlock(run, nodeId, 'promote')) continue;
      for (let guard = 0; guard < 8; guard++) {
        const unit = promotable(run, nodeId, data)[0];
        if (!unit) break;
        const target = resolvePromotionTargets(unit, data.classes, data.lords)?.[0];
        const cost = churchPromoteCost(unit, run);
        if (!target || !promoteAtChurch(run, unit, nodeId, target, data).ok) break;
        out.promoted.push(unit.name);
        if (cost === 0) out.freePromotions++;
      }
      continue;
    }
    if (vow === 'cleanse') {
      const burden = cleansableBurdens(run).find((b) => !churchCleanseBlock(run, nodeId, b.id));
      if (burden && cleanseAtChurch(run, nodeId, burden.id).ok) out.cleansed = burden.id;
      continue;
    }
    if (vow === 'blessing') {
      if (churchVows(run, nodeId).includes('blessing')) continue;
      const offers = churchBlessingOffers(run, nodeId, data);
      if (!offers.length) continue;
      const pick = offers[policyPick(run, `church-blessing:${nodeId}`, offers.length)];
      if (takeChurchBlessing(run, nodeId, pick.id, data).ok) out.blessing = pick.id;
    }
  }
  out.vows = churchVows(run, nodeId);
  return out;
}

/** The Ruins before the boss: Rest (heal all), then revive the cheapest fallen affordable. */
export function playRuins(run, node) {
  const out = { rested: false, revived: [] };
  out.rested = chooseRuinsPath(run, node.id, 'rest').ok === true;
  for (let guard = 0; guard < 8 && out.rested; guard++) {
    const affordable = (run.fallenUnits || [])
      .filter((u) => !ruinsReviveBlock(run, node.id, u))
      .sort((a, b) => getReviveCost(a) - getReviveCost(b));
    if (!affordable.length) break;
    if (!reviveAtRuins(run, node.id, affordable[0]).ok) break;
    out.revived.push(affordable[0].name);
  }
  return out;
}

// ── Shops: the forge ───────────────────────────────────────────────────────

/**
 * Forge at a shop as the forge tab does (ShopCommands): every free forge the run's blessings
 * give (Smith's Mark, Smith's Covenant) goes on the commander's weapon (+1 Might, else Hit),
 * and one paid forge when the purse is comfortable (3000 gold or more after it).
 * @returns {{ free: number, paid: number }}
 */
export function forgeAtShop(run, node) {
  const out = { free: 0, paid: 0 };
  const commander = findCommander(run.roster || []);
  if (!commander) return out;
  let forgesUsed = 0;
  for (let guard = 0; guard < 6; guard++) {
    const terms = shopForgeTerms(run, { forgesUsed, ambushDiscount: node?.isAmbush === true });
    if (forgesUsed >= terms.forgeLimit) break;
    const weapons = [commander.weapon, ...(commander.inventory || [])].filter(
      (w, i, list) => w && list.indexOf(w) === i && commander.inventory?.includes(w),
    );
    let forged = false;
    for (const weapon of weapons) {
      for (const stat of ['might', 'hit']) {
        if (shopForgeBlock(run, weapon, stat, terms)) continue;
        if (!terms.free) {
          const goldBefore = run.gold;
          // A paid forge only with room to spare.
          if (goldBefore < 3000) continue;
        }
        const result = forgeShopWeapon(run, weapon, stat, terms);
        if (!result.ok) continue;
        if (result.free) out.free++;
        else out.paid++;
        forgesUsed++;
        forged = true;
        break;
      }
      if (forged) break;
    }
    if (!forged || out.paid >= 1) break;
  }
  return out;
}

// ── The Colosseum ──────────────────────────────────────────────────────────

const ARENA_MIN_WIN_ODDS = 0.6;

/**
 * Fight the arena as ColosseumOverlay does, through the same engine calls in the same order
 * (generateChallenger, estimateArenaOdds, the fee at the start, resolveArenaRound until
 * arenaRoundOutcome, calculateArenaReward, gainExperience, the Colosseum's earned offer). Each
 * bout: the fighter and tier with the best odds of winning, the highest tier first, if those odds
 * are at least 60% and the fee is affordable; within the visit's and each unit's caps. A fighter
 * never dies in the arena (resolveArenaRound floors the entrant at 1 HP).
 * @returns {{ bouts: object[], feesPaid: number, feeSaved: number }}
 */
export function playColosseum(run, node, data) {
  const out = { bouts: [], feesPaid: 0, feeSaved: 0 };
  const colosseum = data.colosseum;
  if (!colosseum?.arena) return out;
  const difficultyId = run.difficultyId || 'normal';
  const state = structuredClone(node.colosseumState || {});
  const fightsPerUnit = state.fightsPerUnit || {};
  const levelsGained = state.levelsGained || {};
  const maxFights = getMaxFights(difficultyId, colosseum);
  // As ArenaMenu: the tier the overlay holds is `{ name, ...tier }`.
  const tiers = getAvailableTiers(run.currentAct, colosseum)
    .map(([name, tier]) => ({ name, ...tier }))
    .sort((a, b) => (b.goldReward || 0) - (a.goldReward || 0));
  const maxRounds = arenaMaxRounds(colosseum);
  for (let guard = 0; guard < 12; guard++) {
    const visitCap = arenaVisitCap(getMaxFightsPerVisit(difficultyId, colosseum), run);
    let best = null;
    for (const unit of run.roster || []) {
      if (
        arenaEntryBlock(
          unit,
          fightsPerUnit[unit.name] || 0,
          maxFights,
          arenaVisitBouts(fightsPerUnit),
          visitCap,
        )
      )
        continue;
      if (!getArenaWeapon(unit) || unit.currentHP < unit.stats.HP * 0.75) continue;
      for (const tier of tiers) {
        const fee = arenaEntryFee(tier, run);
        if (run.gold < fee) continue;
        const level =
          unit.tier === 'promoted'
            ? RECRUIT_PROMOTION_BASE_LEVEL + Math.max(1, Math.trunc(Number(unit.level) || 1))
            : Math.max(1, Math.trunc(Number(unit.level) || 1));
        const challenger = generateChallenger(
          level,
          tier,
          run.currentAct,
          data.enemies,
          data.classes,
          data.weapons,
          difficultyId,
          colosseum,
          Math.random,
          data.difficulty,
        );
        if (!challenger?.unit) continue;
        const odds = estimateArenaOdds(unit, challenger.unit, data, { trials: 120, maxRounds });
        if (!odds || odds.win < ARENA_MIN_WIN_ODDS) continue;
        if (!best || odds.win * (tier.goldReward || 1) > best.score)
          best = { unit, tier, challenger, fee, score: odds.win * (tier.goldReward || 1) };
        break; // the highest tier this unit would take
      }
    }
    if (!best) break;
    const { unit, tier, challenger, fee } = best;
    if (fee > 0 && run.spendGold(fee) === false) break;
    settleAccessoryHpOwed(unit);
    const weapon = getArenaWeapon(unit);
    if (weapon !== unit.weapon) equipWeapon(unit, weapon);
    fightsPerUnit[unit.name] = (fightsPerUnit[unit.name] || 0) + 1;
    let outcome = null;
    for (let round = 1; !outcome; round++)
      outcome = arenaRoundOutcome(resolveArenaRound(unit, challenger.unit, data), round, maxRounds);
    const baseXP = calculateArenaXP(unit, challenger.unit, outcome === 'win');
    const reward = calculateArenaReward(
      tier,
      outcome,
      baseXP,
      levelsGained[unit.name] || 0,
      colosseum,
      { entryFee: fee },
    );
    const payout = reward.goldDelta + fee;
    if (payout > 0) run.awardGold(payout);
    const offer = colosseumOfferDue(run, { tier: tier?.name, outcome });
    if (offer) prepareColosseumOffer(run, node.id);
    if (reward.xpGained > 0) {
      const before = unit.level;
      gainExperience(unit, reward.xpGained, {
        extendedLevelingEnabled: run.getDifficultyModifier('extendedLevelingEnabled', false),
      });
      if (unit.level > before)
        levelsGained[unit.name] = (levelsGained[unit.name] || 0) + (unit.level - before);
    }
    node.colosseumState = { ...state, fightsPerUnit, levelsGained };
    out.feesPaid += fee;
    out.feeSaved += Math.max(0, (Number(tier.entryFee) || 0) - fee);
    out.bouts.push({ unit: unit.name, tier: tier.name, outcome, fee, offer });
  }
  return out;
}

// ── Events ─────────────────────────────────────────────────────────────────

/**
 * The claiming event policy: a choice that may grant an earned blessing comes first (the
 * Wandering Smith's covenant, the Collectors' fight, Old Faces' ride), then the stock policy's
 * (the first choice that does not start a battle). Pages with a low counter prefer a way out,
 * as the stock policy does.
 */
export function chooseClaimEventPlan(run, nodeId) {
  const view = eventView(run, nodeId);
  if (!view || view.phase !== 'choosing') return null;
  const event = findEvent(eventCatalogOf(run), view.eventId);
  const open = view.choices
    .filter((choice) => !choice.block)
    .map((choice) => ({
      choice,
      earned: choiceGrantsEarned(event, choice.id, view.page),
      mayFight: choiceMayFight(event, choice.id, view.page),
      leadsOn: choiceLeadsOn(event, choice.id, view.page),
    }));
  if (open.length === 0) return null;
  const low = (view.counters || []).some((counter) => counter.value <= 1);
  const pick =
    open.find((e) => e.earned) ||
    (low && open.find((e) => !e.mayFight && !e.leadsOn)) ||
    open.find((e) => !e.mayFight) ||
    open[0];
  const target = pick.choice.target?.candidates.find((c) => c.ok) || null;
  return {
    choiceId: pick.choice.id,
    targetUid: target?.uid ?? null,
    mayFight: pick.mayFight,
    leadsOn: pick.leadsOn,
    earned: pick.earned,
  };
}

/** Walk an event with the claiming policy (as RunPolicies.playEventChoices). */
export function playClaimEventChoices(run, nodeId, { maxSteps = 12 } = {}) {
  const steps = [];
  for (let i = 0; i < maxSteps; i++) {
    const plan = chooseClaimEventPlan(run, nodeId);
    if (!plan) break;
    const chosen = chooseEventOption(run, nodeId, plan.choiceId, { targetUid: plan.targetUid });
    steps.push({ plan, chosen });
    if (!chosen.ok || !chosen.next || chosen.battle) break;
  }
  return steps;
}

// ── Vision ─────────────────────────────────────────────────────────────────

/**
 * Whether to spend a Vision charge on a fall: always for the commander (the run would end);
 * for a lord, or anyone when a charge would otherwise be wasted (a Watcher's Grace charge fades
 * with its boss battle; an act boss's victory gives one back), when one is left; for anyone
 * else, only with a charge to spare (one is kept for the commander).
 */
export function shouldRewindForFall(run, fallen, { bossBattle = false, graceUnspent = 0 } = {}) {
  const charges = Math.max(0, Math.trunc(Number(run.visionChargesRemaining) || 0));
  if (charges <= 0 || !fallen) return false;
  if (fallen.isCommander) return true;
  if (graceUnspent > 0 || bossBattle) return true;
  if (fallen.isLord) return true;
  return charges >= 2;
}
