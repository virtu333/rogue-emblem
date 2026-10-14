import { isDifficultyId } from './DifficultyEngine.js';
import {
  NG_PLUS_COST,
  NG_PLUS_MILESTONE,
  NG_PLUS_UNLOCK_KEY,
  applyRidePicks,
  applyRunEnd,
  defaultNgPlusState,
  isNgPlusRung,
  mergeNgPlusState,
  normalizeNgPlusState,
  passRide,
  releaseRecord,
  runStartOf,
  setBring,
} from './NgPlusState.js';
import { DEFAULT_MARK_CHANCE } from './MarkSystem.js';
import {
  settledBalanceRevision,
  withBalanceRevisionMarker,
  withoutBalanceRevisionMarker,
  isBalanceRevisionMarker,
} from './BalanceRevisionMarker.js';
import { mergeSeenDialogueKeys } from '../utils/seenDialogue.js';
import { mergeRunRecords, runRecordsUnderPressure } from './RunRecords.js';
import { isQuotaExceededError, setItemFreeingSpace } from './SaveSpace.js';
import {
  isRepeatableUpgrade,
  joinUpgradeLevel,
  repeatTiersKey,
  splitUpgradeLevel,
  upgradeEffectAtLevel,
  upgradeMaxedAt,
  upgradeTierCost,
} from './RepeatableUpgrades.js';
// MetaProgressionManager.js — Pure class: persistent meta-progression (dual currency + upgrades)
// No Phaser deps. Follows SettingsManager pattern.

import {
  VALOR_PER_ACT,
  VALOR_PER_BATTLE,
  VALOR_VICTORY_BONUS,
  SUPPLY_PER_ACT,
  SUPPLY_PER_BATTLE,
  SUPPLY_VICTORY_BONUS,
  CATEGORY_CURRENCY,
  REFUND_FEE,
  MAX_STARTING_SKILLS,
} from '../utils/constants.js';
import { DEFAULT_STARTING_LORD_NAMES, defaultPartnerFor } from './Commander.js';
import {
  ALWAYS_MET_LORD_NAMES,
  lordNamesInRun,
  lordsMetOfMetaSave,
  mergeLordNames,
} from './LordsMet.js';
import {
  discoveriesInRun,
  discoveriesOfMetaSave,
  isDiscoveryKey,
  mergeDiscoveries,
  withDiscoveryKeys,
  withoutDiscoveryKeys,
} from './CompendiumDiscovery.js';

const DEFAULT_LORD_SELECTION = Object.freeze({
  commander: DEFAULT_STARTING_LORD_NAMES[0],
  partner: DEFAULT_STARTING_LORD_NAMES[1],
});

function normalizeLordSelection(raw) {
  const commander =
    typeof raw?.commander === 'string' && raw.commander.length > 0
      ? raw.commander
      : DEFAULT_LORD_SELECTION.commander;
  let partner =
    typeof raw?.partner === 'string' && raw.partner.length > 0
      ? raw.partner
      : defaultPartnerFor(commander);
  if (partner === commander) partner = defaultPartnerFor(commander);
  return { commander, partner };
}

function defaultStoryFlags() {
  return {
    bossSlain: {},
    defeatedBy: {},
    lordFalls: {},
    lastRun: null,
    linesPlayed: [],
    narrativeSeen: {},
    lossStreak: 0,
  };
}

// Barks and flavour pools carried between runs (utils/pickFresh.js bags, compact: line
// keys, not lines), so a lord's quips or a node's flavour walk the whole pool across runs
// before any line repeats. Bounded: one bag per pool key, each no longer than its pool.
const MAX_NARRATIVE_BAGS = 512;
const MAX_BAG_SEEN = 64;
const LINE_KEY_PATTERN = /^l[0-9a-z]+$/;

function normalizeNarrativeSeen(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [key, bag] of Object.entries(raw).slice(-MAX_NARRATIVE_BAGS)) {
    if (!key || !bag || typeof bag !== 'object' || !Array.isArray(bag.seen)) continue;
    const seen = [
      ...new Set(bag.seen.filter((k) => typeof k === 'string' && LINE_KEY_PATTERN.test(k))),
    ].slice(-MAX_BAG_SEEN);
    out[key] = { cycle: Math.max(0, Math.floor(Number(bag.cycle) || 0)), seen };
  }
  return out;
}

// Room for the commander's run-start pool and the bosses' rematch exchanges
// (several a run), so neither pushes the other's history out within a few runs.
const MAX_LINES_PLAYED = 256;

/**
 * Pool lines already played on this save (NarrativeDirector line keys), least
 * recent first; later lists are more recent. Bounded, one entry per key.
 */
function mergeLinesPlayed(...lists) {
  const keys = [];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const key of list) {
      if (typeof key !== 'string' || !key) continue;
      const existing = keys.indexOf(key);
      if (existing !== -1) keys.splice(existing, 1);
      keys.push(key);
    }
  }
  return keys.slice(-MAX_LINES_PLAYED);
}

function normalizeStoryCountMap(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const [name, value] of Object.entries(raw)) {
    const count = Math.max(0, Math.floor(Number(value) || 0));
    if (count > 0) out[name] = count;
  }
  return out;
}

function normalizeLastRun(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const result = raw.result === 'victory' || raw.result === 'defeat' ? raw.result : null;
  if (!result) return null;
  return {
    result,
    act: typeof raw.act === 'string' ? raw.act : null,
    difficultyId: typeof raw.difficultyId === 'string' ? raw.difficultyId : 'normal',
    defeatedBy: typeof raw.defeatedBy === 'string' ? raw.defeatedBy : null,
    endedAt: Number.isFinite(raw.endedAt) ? raw.endedAt : 0,
    lordsFell: Array.isArray(raw.lordsFell)
      ? [...new Set(raw.lordsFell.filter((name) => typeof name === 'string' && name))]
      : [],
  };
}

function normalizeStoryFlags(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return defaultStoryFlags();
  return {
    bossSlain: normalizeStoryCountMap(raw.bossSlain),
    defeatedBy: normalizeStoryCountMap(raw.defeatedBy),
    lordFalls: normalizeStoryCountMap(raw.lordFalls),
    lastRun: normalizeLastRun(raw.lastRun),
    linesPlayed: mergeLinesPlayed(raw.linesPlayed),
    narrativeSeen: normalizeNarrativeSeen(raw.narrativeSeen),
    lossStreak: Math.max(0, Math.floor(Number(raw.lossStreak) || 0)),
  };
}

// The prologue on this save (docs/specs/prologue-chapter.md §9): where it stands, whether
// its Home Base grant was paid (the idempotence ledger: paid once across refreshes and
// cloud merges), the chapters won and the lessons practised (§8).
export const PROLOGUE_STATES = Object.freeze(['none', 'in_progress', 'skipped', 'complete']);
const PROLOGUE_STATE_RANK = Object.freeze({ none: 0, in_progress: 1, skipped: 2, complete: 3 });

function defaultPrologueState() {
  return { state: 'none', grantPaid: false, chaptersCompleted: [], practised: [] };
}

const idList = (list) =>
  Array.isArray(list) ? [...new Set(list.filter((id) => typeof id === 'string' && id))] : [];

export function normalizePrologueState(raw) {
  const base = defaultPrologueState();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;
  return {
    state: PROLOGUE_STATES.includes(raw.state) ? raw.state : base.state,
    grantPaid: raw.grantPaid === true,
    chaptersCompleted: idList(raw.chaptersCompleted),
    practised: idList(raw.practised),
  };
}

/**
 * The union of two prologue records: the further state, a paid grant stays paid, the
 * lists unioned. Right only where both records' economies are kept too (the local
 * adopt-merge, `_adoptForeignDiskStateIfNewer`, takes each currency and upgrade at
 * its max, so a paid copy's grant is still in the result and paying again would pay
 * twice). A merge that keeps one payload's economy whole reads
 * `reconcilePickedPrologue` instead.
 */
export function mergePrologueState(a, b) {
  const x = normalizePrologueState(a);
  const y = normalizePrologueState(b);
  return {
    state: PROLOGUE_STATE_RANK[y.state] > PROLOGUE_STATE_RANK[x.state] ? y.state : x.state,
    grantPaid: x.grantPaid || y.grantPaid,
    chaptersCompleted: idList([...x.chaptersCompleted, ...y.chaptersCompleted]),
    practised: idList([...x.practised, ...y.practised]),
  };
}

/** The prologue's Home Base grant (prologue.json `grant`) as whole, non-negative amounts. */
export function prologueGrantAmounts(grant) {
  return {
    valor: Math.max(0, Math.floor(Number(grant?.valor) || 0)),
    supply: Math.max(0, Math.floor(Number(grant?.supply) || 0)),
  };
}

const currencyOf = (payload, key) =>
  Math.max(0, Math.floor(Number(payload?.[key] ?? payload?.totalRenown) || 0));

/**
 * The prologue record of a meta payload picked whole by `savedAt` (the cloud fetch's
 * merge, CloudSync.applyMetaSlots), where the picked payload (`winner`) keeps its
 * currencies and upgrades and the other copy's are dropped.
 *
 * The grant's receipt (`grantPaid`) travels with the economy that holds its effect, so
 * it comes from the winner alone; the state, the chapters and the lessons union freely.
 * A union that reaches 'complete' while the winner never paid (the other copy finished
 * the prologue; its grant was dropped with its economy) is repaired once: the grant is
 * added to the winner's currencies and the receipt set, because that grant was never in
 * the winner's snapshot. Never by taking the larger balance (that restores spent
 * currency). The result is idempotent: merged again with either copy, the winner is
 * paid and nothing is added.
 *
 * Only a winner that has taken part in the prologue (state past 'none') vouches for its
 * receipt. A payload with no record, or 'none', may have been saved by a client from
 * before the prologue, which drops the record and keeps the currencies (a grant it
 * fetched included), so its receipt is unknown: the other copy's is kept, as a union,
 * and nothing is added.
 * @param {object|null} winner - the meta payload whose economy is kept
 * @param {object|null} loser - the other copy
 * @param {{ valor?: number, supply?: number }} grant - prologue.json `grant`
 * @returns {{ prologue: object, economy: { totalValor: number, totalSupply: number } | null }}
 *   `economy`: the winner's repaired currencies, or null when nothing was added
 */
export function reconcilePickedPrologue(winner, loser, grant) {
  const merged = mergePrologueState(winner?.prologue, loser?.prologue);
  const own = normalizePrologueState(winner?.prologue);
  if (own.state === 'none') return { prologue: merged, economy: null };
  const paid = own.grantPaid;
  if (merged.state !== 'complete' || paid)
    return { prologue: { ...merged, grantPaid: paid }, economy: null };
  const amounts = prologueGrantAmounts(grant);
  return {
    prologue: { ...merged, grantPaid: true },
    economy: {
      totalValor: currencyOf(winner, 'totalValor') + amounts.valor,
      totalSupply: currencyOf(winner, 'totalSupply') + amounts.supply,
    },
  };
}

const MAX_SETTLED_RUN_IDS = 50;

/** Union of settled run ids, newest last, bounded so meta cannot grow forever. */
function mergeSettledRunIds(...lists) {
  const ids = [];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const id of list) {
      if (typeof id !== 'string' || !id) continue;
      const existing = ids.indexOf(id);
      if (existing !== -1) ids.splice(existing, 1);
      ids.push(id);
    }
  }
  return ids.slice(-MAX_SETTLED_RUN_IDS);
}

/**
 * Price cuts that credit past buyers. A save carries the revision it was last settled
 * at (`balanceRevision`); loading an older save credits every later revision once:
 * for each tier bought, `from` price - `to` price, in the upgrade's currency. Both
 * price lists are frozen here, never read from metaUpgrades.json, so a later cut
 * cannot change what an earlier revision owes (revision 1 used to read the live
 * prices, which revision 2 lowered again). The newest revision's `to` prices are the
 * data's (tests/SeptemberBalance.test.js holds them together).
 */
export const BALANCE_REVISIONS = Object.freeze([
  {
    revision: 1, // September 2026 balance
    from: {
      recruit_weapon_forge: [800, 1400],
      weapon_forge: [150, 325, 550],
      lethal_armory_killer: [900],
      lethal_armory_silver: [1400],
      recruit_field_supplies: [375],
      master_of_arms: [600],
    },
    to: {
      recruit_weapon_forge: [400, 700],
      weapon_forge: [150, 250, 400],
      lethal_armory_killer: [600],
      lethal_armory_silver: [900],
      recruit_field_supplies: [250],
      master_of_arms: [350],
    },
  },
  {
    revision: 2, // 2026-09-29 playtest: the Battalion tab at half price
    from: {
      deploy_limit: [500],
      recruit_skill: [500],
      recruit_field_supplies: [250],
      veteran_recruits: [250, 450, 700],
      extra_starting_unit_pool: [400, 700, 1000, 1500],
      lethal_armory: [500],
      lethal_armory_killer: [600],
      lethal_armory_silver: [900],
      master_of_arms: [350],
      recruit_xp: [350, 700],
      recruit_accessory: [650],
      recruit_weapon_forge: [400, 700],
    },
    to: {
      deploy_limit: [150],
      recruit_skill: [250],
      recruit_field_supplies: [125],
      veteran_recruits: [125, 225, 350],
      extra_starting_unit_pool: [200, 350, 500, 750],
      lethal_armory: [250],
      lethal_armory_killer: [300],
      lethal_armory_silver: [450],
      master_of_arms: [175],
      recruit_xp: [175, 350],
      recruit_accessory: [325],
      recruit_weapon_forge: [200, 350],
    },
  },
  {
    revision: 3, // 2026-10-08 balance: cheaper loot-chance upgrades, Steel Arms, Legends Awaken
    // Quick Feet, Lord Swiftness, their flat tracks and Deadly Arsenal II rose the same day.
    // A rise credits nothing; it is listed (since revision 5) so a tier bought before it
    // records the price it was paid (`legacyTierCosts`): its refund, and revision 5's cut
    // of the growth tracks, start from that price, never the risen one.
    from: {
      recruit_spd_growth: [65, 85, 130, 175, 260],
      lord_spd_growth: [105, 150, 260, 365, 570],
      recruit_spd_flat: [150, 365, 760],
      lord_spd_flat: [250, 695, 1460],
      weapon_tier_silver: [600],
      steel_arms: [800],
      legendary_lord_chance: [300, 600],
      trade_contacts: [150, 250],
      loot_quality: [150, 300],
      studied_training: [150, 300],
      trinket_collector: [150, 300],
      heros_call: [150, 300, 500],
    },
    to: {
      recruit_spd_growth: [75, 100, 150, 200, 300],
      lord_spd_growth: [120, 175, 300, 420, 655],
      recruit_spd_flat: [175, 420, 875],
      lord_spd_flat: [290, 800, 1680],
      weapon_tier_silver: [1000],
      steel_arms: [500],
      legendary_lord_chance: [150, 300],
      trade_contacts: [60, 100],
      loot_quality: [120, 240],
      studied_training: [120, 240],
      trinket_collector: [120, 240],
      heros_call: [120, 240, 400],
    },
  },
  {
    revision: 4, // 2026-10-10 Branching Threads: tiers 3 and 4 rise (250 -> 300, 250 -> 350)
    // A rise credits nobody, but a refund pays the CURRENT price: a buyer from before this
    // revision would net +50/+100 a tier. `_creditBalanceRevisionsSince` therefore records
    // what each tier already owned was paid (`legacyTierCosts`) and the refund returns that.
    from: {
      branching_threads: [100, 200, 250, 250],
    },
    to: {
      branching_threads: [100, 200, 300, 350],
    },
  },
  {
    revision: 5, // 2026-10-11 growth tracks: +3% a tier (was +5%), about 25% cheaper
    // A tier bought before revision 3's Swiftness/Quick Feet rise, in a save still below
    // revision 3, is credited from what it cost then (its `legacyTierCosts` record). A save
    // already past revision 3 kept no record of that price, so it is credited from the risen one.
    from: {
      recruit_hp_growth: [35, 40, 60, 85, 125],
      recruit_str_growth: [45, 60, 90, 120, 180],
      recruit_mag_growth: [35, 40, 45, 60, 90],
      recruit_def_growth: [55, 75, 115, 155, 225],
      recruit_spd_growth: [75, 100, 150, 200, 300],
      recruit_skl_growth: [35, 40, 45, 60, 90],
      recruit_res_growth: [35, 40, 50, 70, 100],
      recruit_lck_growth: [35, 40, 45, 55, 80],
      lord_hp_growth: [50, 70, 125, 175, 275],
      lord_str_growth: [70, 105, 180, 255, 400],
      lord_mag_growth: [50, 55, 90, 125, 200],
      lord_def_growth: [90, 130, 230, 320, 495],
      lord_spd_growth: [120, 175, 300, 420, 655],
      lord_skl_growth: [50, 55, 90, 125, 200],
      lord_res_growth: [50, 60, 100, 145, 225],
      lord_lck_growth: [50, 55, 80, 110, 175],
    },
    to: {
      recruit_hp_growth: [25, 30, 45, 65, 95],
      recruit_str_growth: [35, 45, 70, 90, 135],
      recruit_mag_growth: [25, 30, 35, 45, 70],
      recruit_def_growth: [40, 55, 85, 115, 170],
      recruit_spd_growth: [55, 75, 110, 150, 225],
      recruit_skl_growth: [25, 30, 35, 45, 70],
      recruit_res_growth: [25, 30, 40, 50, 75],
      recruit_lck_growth: [25, 30, 35, 40, 60],
      lord_hp_growth: [40, 50, 95, 130, 205],
      lord_str_growth: [50, 80, 135, 190, 300],
      lord_mag_growth: [40, 45, 70, 95, 150],
      lord_def_growth: [70, 100, 170, 240, 370],
      lord_spd_growth: [90, 130, 225, 315, 490],
      lord_skl_growth: [40, 45, 70, 95, 150],
      lord_res_growth: [40, 45, 75, 110, 170],
      lord_lck_growth: [40, 45, 60, 80, 130],
    },
  },
  {
    revision: 6, // 2026-10-11 Lucky Finds: no Legend before Act III, its Legend step at half
    // the chance, so the upgrade costs 25% less and past buyers are credited the difference.
    from: {
      loot_quality: [120, 240],
    },
    to: {
      loot_quality: [90, 180],
    },
  },
  {
    revision: 7, // 2026-10-12 starting skills: Vantage 300 -> 600, Adept 300 -> 450, Guard
    // 175 -> 300 (its bonus +3 -> +2). Rises credit nobody; listed so a tier bought before
    // them refunds what it was paid (`legacyTierCosts`).
    from: {
      unlock_vantage: [300],
      unlock_adept: [300],
      unlock_guard: [175],
    },
    to: {
      unlock_vantage: [600],
      unlock_adept: [450],
      unlock_guard: [300],
    },
  },
]);

export const CURRENT_BALANCE_REVISION = BALANCE_REVISIONS[BALANCE_REVISIONS.length - 1].revision;

/**
 * Upgrades taken out of the game. Each purchased level is refunded once, in its
 * currency, and the key is deleted; `retiredUpgradeRefunds` records how many levels
 * were paid, so a stale copy that brings the key back (the disk/cloud max-merge) is
 * cleared again without paying twice.
 */
export const RETIRED_UPGRADES = Object.freeze({
  // Expanded Ranks: the roster no longer has a cap (2026-09-29 playtest).
  roster_cap: { currency: 'supply', refundPerLevel: 175 },
});

function normalizeRetiredUpgradeRefunds(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const id of Object.keys(RETIRED_UPGRADES)) {
    const levels = Math.max(0, Math.floor(Number(raw[id]) || 0));
    if (levels > 0) out[id] = levels;
  }
  return out;
}

function normalizeLegacyTierCosts(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [id, tiers] of Object.entries(raw)) {
    if (!tiers || typeof tiers !== 'object' || Array.isArray(tiers)) continue;
    const kept = {};
    for (const [tier, cost] of Object.entries(tiers)) {
      const t = Math.trunc(Number(tier));
      const c = Math.trunc(Number(cost));
      if (t >= 1 && c > 0) kept[t] = c;
    }
    if (Object.keys(kept).length) out[id] = kept;
  }
  return out;
}

const DEFAULT_STORAGE_KEY = 'emblem_rogue_meta_save';

/**
 * Every top-level key this build writes in a meta save (`_save`), plus `totalRenown`, the
 * pre-split currency it reads once and no longer writes. Any other key on disk came from a
 * newer build: it is kept as found and written back unchanged, so an older client playing
 * the slot (an app build behind the web, a rollback) never strips it, and the cloud copy it
 * pushes carries it to the device that wrote it. `tests/MetaUnknownFields.test.js` holds
 * this list to the payload.
 */
export const META_SAVE_FIELDS = Object.freeze([
  'balanceRevision',
  'solRefundBasis',
  'totalValor',
  'totalSupply',
  'purchasedUpgrades',
  'retiredUpgradeRefunds',
  'legacyTierCosts',
  'runsCompleted',
  'runsStarted',
  'lastDifficulty',
  'skillAssignments',
  'lordSelection',
  'milestones',
  'storyFlags',
  'runRecords',
  'settledRunIds',
  'seenDialogueKeys',
  'deedsEarned',
  'lordsMet',
  'hintState',
  'prologue',
  'ngPlus',
  'savedAt',
]);
const META_READ_ONLY_FIELDS = Object.freeze(['totalRenown']);
const KNOWN_META_KEYS = new Set([...META_SAVE_FIELDS, ...META_READ_ONLY_FIELDS]);

/** The keys of a meta payload this build does not know (a newer build's), as found. */
export function unknownMetaFields(saved) {
  const unknown = {};
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return unknown;
  for (const [key, value] of Object.entries(saved))
    if (!KNOWN_META_KEYS.has(key)) unknown[key] = value;
  return unknown;
}
const DEADLY_ARSENAL_SPLIT_MIGRATION_CUTOFF = Date.UTC(2026, 1, 14);
const LOOT_CATEGORY_WEIGHT_BONUS_KEYS = new Set([
  'weapon',
  'healing',
  'statBooster',
  'promotion',
  'skillScroll',
  'weaponArtScroll',
  'legendaryWeapon',
  'accessory',
  'forge',
  'gold',
]);

function normalizeLootCategoryWeight(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function normalizeLootCategoryWeightBonuses(rawMap) {
  if (!rawMap || typeof rawMap !== 'object' || Array.isArray(rawMap)) return null;
  const out = {};
  let added = false;
  for (const [key, rawValue] of Object.entries(rawMap)) {
    if (!LOOT_CATEGORY_WEIGHT_BONUS_KEYS.has(key)) continue;
    const value = normalizeLootCategoryWeight(rawValue);
    if (value === 0) continue;
    out[key] = (out[key] || 0) + value;
    added = true;
  }
  return added ? out : null;
}

/**
 * Starting-skill assignments with each skill on one lord only: a skill listed for
 * several lords (saves from before the rule) stays with the first, in save order.
 */
export function exclusiveSkillAssignments(assignments) {
  const out = {};
  const taken = new Set();
  if (!assignments || typeof assignments !== 'object') return out;
  for (const [lord, slots] of Object.entries(assignments)) {
    if (!Array.isArray(slots)) continue;
    const kept = slots.filter((id) => typeof id === 'string' && !taken.has(id));
    for (const id of kept) taken.add(id);
    if (kept.length) out[lord] = kept;
  }
  return out;
}

/** Deed ids as a sorted, de-duplicated list (unions any number of lists). */
export function mergeDeedIds(...lists) {
  const ids = new Set();
  for (const list of lists)
    for (const id of Array.isArray(list) ? list : [])
      if (typeof id === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(id)) ids.add(id);
  return [...ids].sort();
}

export class MetaProgressionManager {
  /**
   * @param {Array} upgradesData - metaUpgrades.json array
   * @param {string} [storageKey] - localStorage key (defaults to legacy key)
   */
  constructor(upgradesData, storageKey = DEFAULT_STORAGE_KEY) {
    this.onSave = null;
    this.upgradesData = upgradesData;
    this.storageKey = storageKey;
    this.balanceRevision = CURRENT_BALANCE_REVISION;
    this.solRefundBasis = 600;
    this.totalValor = 0;
    this.totalSupply = 0;
    this.savedAt = 0;
    this.purchasedUpgrades = {};
    this.retiredUpgradeRefunds = {}; // { roster_cap: 1 }: retired levels already refunded
    // { branching_threads: { 3: 250 } }: what a tier bought before a price rise was paid, so
    // its refund returns that (BALANCE_REVISIONS revision 4). Old clients ignore the field.
    this.legacyTierCosts = {};
    this.runsCompleted = 0;
    this.runsStarted = 0;
    this.lastDifficulty = null;
    this.runRecords = [];
    this.settledRunIds = []; // recent runs whose end rewards were paid (idempotency)
    this.seenDialogueKeys = [];
    this.deedsEarned = []; // deed ids any unit of this save has earned (the Compendium's)
    // Lords who have joined an army on this save; the home base and Compendium show only
    // these (Edric and Sera always).
    this.lordsMet = [...ALWAYS_MET_LORD_NAMES];
    // Items (catalog names) and skills (ids) this save has met: the Compendium fills in
    // these and shows the rest as "???" (engine/CompendiumDiscovery.js).
    this.itemsSeen = [];
    this.skillsSeen = [];
    this.hintState = null;
    this.skillAssignments = {}; // { "Edric": ["sol", "vantage"], "Sera": ["miracle"] }
    this.lordSelection = { ...DEFAULT_LORD_SELECTION }; // commander-choice picks, persisted
    this.milestones = new Set(); // e.g. "beatAct1", "beatAct2", "beatAct3"
    this.storyFlags = defaultStoryFlags(); // run-aware narrative memory
    this.prologue = defaultPrologueState();
    this.ngPlus = defaultNgPlusState(); // NG+: the Barracks and the ride (NgPlusState.js)
    // A newer build's keys, kept as found and written back by `_save` (META_SAVE_FIELDS).
    this.unknownFields = {};

    let savedMeta = null;
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (raw) {
        const saved = JSON.parse(raw);
        savedMeta = saved;
        this.unknownFields = unknownMetaFields(saved);
        this.lastDifficulty = isDifficultyId(saved.lastDifficulty) ? saved.lastDifficulty : null;

        // Migration: old single-currency saves have totalRenown but no totalValor
        if (typeof saved.totalRenown === 'number' && saved.totalValor === undefined) {
          // Give full renown to BOTH currencies
          this.totalValor = Number.isFinite(saved.totalRenown)
            ? Math.max(0, Math.floor(saved.totalRenown))
            : 0;
          this.totalSupply = Number.isFinite(saved.totalRenown)
            ? Math.max(0, Math.floor(saved.totalRenown))
            : 0;
        } else {
          if (Number.isFinite(saved.totalValor))
            this.totalValor = Math.max(0, Math.floor(saved.totalValor));
          if (Number.isFinite(saved.totalSupply))
            this.totalSupply = Math.max(0, Math.floor(saved.totalSupply));
        }

        // Discoveries and the balance-revision marker ride inside the saved map
        // (CompendiumDiscovery.js, BalanceRevisionMarker.js); in memory it holds upgrades.
        if (saved.purchasedUpgrades)
          this.purchasedUpgrades = withoutDiscoveryKeys(
            withoutBalanceRevisionMarker(saved.purchasedUpgrades),
          );
        this._migrateLegacyWeaponArtUpgradeState();
        this._migrateLegacyDeadlyArsenalUpgradeState(saved);
        if (typeof saved.runsCompleted === 'number') this.runsCompleted = saved.runsCompleted;
        if (typeof saved.runsStarted === 'number')
          this.runsStarted = Math.max(0, Math.floor(saved.runsStarted));
        // Migration: saves predating the started counter — every finished run
        // was started, so the completed count is a floor.
        if (this.runsStarted < this.runsCompleted) this.runsStarted = this.runsCompleted;
        if (saved.skillAssignments)
          this.skillAssignments = exclusiveSkillAssignments(saved.skillAssignments);
        if (saved.lordSelection) this.lordSelection = normalizeLordSelection(saved.lordSelection);
        if (Number.isFinite(saved.savedAt)) this.savedAt = saved.savedAt;
        // Migration: old saves without milestones default to empty
        if (Array.isArray(saved.milestones)) this.milestones = new Set(saved.milestones);
        // Migration: old saves without storyFlags default to empty memory
        if (Array.isArray(saved.hintState?.seen)) this.hintState = saved.hintState;
        this.runRecords = mergeRunRecords(saved.runRecords || []);
        this.settledRunIds = mergeSettledRunIds(saved.settledRunIds);
        this.seenDialogueKeys = mergeSeenDialogueKeys(saved.seenDialogueKeys || []);
        this.deedsEarned = mergeDeedIds(saved.deedsEarned);
        if (saved.storyFlags) this.storyFlags = normalizeStoryFlags(saved.storyFlags);
        this.prologue = normalizePrologueState(saved.prologue);
        this.ngPlus = normalizeNgPlusState(saved.ngPlus);
        this.solRefundBasis = Number(saved.solRefundBasis) === 400 ? 400 : 600;
        if (!saved.balanceRevision && this.getUpgradeLevel('unlock_sol') > 0)
          this.solRefundBasis = 400;
        this.retiredUpgradeRefunds = normalizeRetiredUpgradeRefunds(saved.retiredUpgradeRefunds);
        this.legacyTierCosts = normalizeLegacyTierCosts(saved.legacyTierCosts);
        // An older build re-saves its own balanceRevision; the copy in purchasedUpgrades
        // keeps a credit from being paid twice (BalanceRevisionMarker.js).
        this._creditBalanceRevisionsSince(settledBalanceRevision(saved));
        // A save a newer build settled keeps its revision: writing ours would let that
        // build credit its own revisions again.
        this.balanceRevision = Math.max(CURRENT_BALANCE_REVISION, settledBalanceRevision(saved));
        this._settleRetiredUpgrades();
        // The next normal save persists credits and markers atomically without making
        // a read-only load appear newer than a pending cloud merge.
      }
    } catch (_) {
      /* incognito / quota exceeded */
    }
    // Saves from before the list backfill it from their records; lords in the slot's
    // in-progress run have joined, so they always count.
    const savedRun = this._readSavedRun();
    this.lordsMet = mergeLordNames(lordsMetOfMetaSave(savedMeta), lordNamesInRun(savedRun));
    // Discoveries: the save's keys unioned with its records' backfill; what the slot's
    // in-progress run holds has been met, so it always counts.
    const seen = mergeDiscoveries(discoveriesOfMetaSave(savedMeta), discoveriesInRun(savedRun));
    this.itemsSeen = seen.items;
    this.skillsSeen = seen.skills;
  }

  /** The run saved beside this meta (its slot's run save), or null. */
  _readSavedRun() {
    const slot = /^emblem_rogue_slot_(\d+)_meta$/.exec(this.storageKey)?.[1];
    const runKey = slot
      ? `emblem_rogue_slot_${slot}_run`
      : this.storageKey === DEFAULT_STORAGE_KEY
        ? 'emblem_rogue_run_save'
        : null;
    if (!runKey) return null;
    try {
      return JSON.parse(localStorage.getItem(runKey) || 'null');
    } catch (_) {
      return null;
    }
  }

  /**
   * A price rise owes nobody anything, but a tier bought at the old price must refund what
   * it cost: remember the old price of each tier in `tiersOf(id)` ([first, last], 1-based)
   * for every revision newer than `savedRevision`, up to `throughRevision` (never over a
   * price already recorded).
   */
  _recordLegacyTierCosts(
    savedRevision,
    tiersOf = (id) => [1, this.getUpgradeLevel(id)],
    throughRevision = Infinity,
  ) {
    const settled = Math.max(0, Math.floor(Number(savedRevision) || 0));
    for (const { revision, from, to } of BALANCE_REVISIONS) {
      if (revision <= settled || revision > throughRevision) continue;
      for (const [id, oldCosts] of Object.entries(from)) {
        const [first, last] = tiersOf(id);
        for (let tier = Math.max(1, first); tier <= Math.min(last, oldCosts.length); tier++) {
          const now = Number(to[id]?.[tier - 1]) || 0;
          if (now > oldCosts[tier - 1] && this.legacyTierCosts[id]?.[tier] === undefined)
            this.legacyTierCosts[id] = { ...this.legacyTierCosts[id], [tier]: oldCosts[tier - 1] };
        }
      }
    }
  }

  /**
   * Credit every balance revision newer than the save's (see BALANCE_REVISIONS), in order:
   * a rise records what each owned tier was paid (`_recordLegacyTierCosts`); a cut credits
   * what the tier was paid (that record, else the revision's old price) minus the new price,
   * and a tier the cut brings down to (or below) what it was paid is no longer a legacy tier.
   */
  _creditBalanceRevisionsSince(savedRevision) {
    const settled = Math.max(0, Math.floor(Number(savedRevision) || 0));
    for (const { revision, from, to } of BALANCE_REVISIONS) {
      if (revision <= settled) continue;
      this._recordLegacyTierCosts(revision - 1, undefined, revision);
      for (const [id, oldCosts] of Object.entries(from)) {
        const newCosts = to[id] || [];
        let credit = 0;
        for (let i = 0; i < Math.min(this.getUpgradeLevel(id), oldCosts.length); i++) {
          const now = Number(newCosts[i]) || 0;
          const legacy = Number(this.legacyTierCosts[id]?.[i + 1]);
          const paid = Number.isFinite(legacy) && legacy > 0 ? legacy : oldCosts[i];
          credit += Math.max(0, paid - now);
          if (Number.isFinite(legacy) && legacy >= now) {
            delete this.legacyTierCosts[id][i + 1];
            if (Object.keys(this.legacyTierCosts[id]).length === 0) delete this.legacyTierCosts[id];
          }
        }
        if (credit <= 0) continue;
        if (this.getCurrencyForUpgrade(id) === 'valor') this.totalValor += credit;
        else this.totalSupply += credit;
      }
    }
  }

  /**
   * Refund retired upgrades once and drop their keys (see RETIRED_UPGRADES). Runs at
   * load and again after a disk merge, which can bring a retired key back.
   */
  _settleRetiredUpgrades() {
    for (const [id, { currency, refundPerLevel }] of Object.entries(RETIRED_UPGRADES)) {
      if (!Object.prototype.hasOwnProperty.call(this.purchasedUpgrades, id)) continue;
      const level = this.getUpgradeLevel(id);
      const refunded = this.retiredUpgradeRefunds[id] || 0;
      if (level > refunded) {
        const credit = (level - refunded) * refundPerLevel;
        if (currency === 'valor') this.totalValor += credit;
        else this.totalSupply += credit;
        this.retiredUpgradeRefunds[id] = level;
      }
      delete this.purchasedUpgrades[id];
    }
  }

  _migrateLegacyWeaponArtUpgradeState() {
    const legacyLevel = Math.max(0, Number(this.purchasedUpgrades?.weapon_art_infusion) || 0);
    if (legacyLevel <= 0) return;

    // Legacy Arcane Etching mapped to both Iron and Steel Arms.
    this.purchasedUpgrades.iron_arms = Math.max(
      legacyLevel,
      Number(this.purchasedUpgrades?.iron_arms) || 0,
    );
    this.purchasedUpgrades.steel_arms = Math.max(
      legacyLevel,
      Number(this.purchasedUpgrades?.steel_arms) || 0,
    );
  }

  _migrateLegacyDeadlyArsenalUpgradeState(saved = null) {
    const legacyLevel = Math.max(0, Number(this.purchasedUpgrades?.weapon_tier) || 0);
    const splitLevel = Math.max(0, Number(this.purchasedUpgrades?.weapon_tier_silver) || 0);
    if (legacyLevel <= 0 || splitLevel > 0) return;

    const savedAt = Number(saved?.savedAt);
    const shouldGrantSplitTier =
      !Number.isFinite(savedAt) || savedAt < DEADLY_ARSENAL_SPLIT_MIGRATION_CUTOFF;
    if (!shouldGrantSplitTier) return;

    // Preserve old Deadly Arsenal value after split: prior buyers receive both new tiers.
    this.purchasedUpgrades.weapon_tier_silver = 1;
  }

  getTotalValor() {
    return this.totalValor;
  }

  getTotalSupply() {
    return this.totalSupply;
  }

  addValor(amount) {
    if (!Number.isFinite(amount)) return;
    const current = Number.isFinite(this.totalValor) ? this.totalValor : 0;
    this.totalValor = Math.max(0, Math.floor(current + amount));
    this._save();
  }

  addSupply(amount) {
    if (!Number.isFinite(amount)) return;
    const current = Number.isFinite(this.totalSupply) ? this.totalSupply : 0;
    this.totalSupply = Math.max(0, Math.floor(current + amount));
    this._save();
  }

  getRunsCompleted() {
    return this.runsCompleted;
  }

  /** True when this run's end rewards were already paid into this meta. */
  hasSettledRun(runId) {
    return typeof runId === 'string' && this.settledRunIds.includes(runId);
  }

  /**
   * Remember a paid run so a reload that re-settles it (the run save failed
   * after the payout) cannot pay again. Persisted by the payout's own saves.
   */
  markRunSettled(runId) {
    if (typeof runId !== 'string' || !runId) return;
    this.settledRunIds = mergeSettledRunIds(this.settledRunIds, [runId]);
  }

  incrementRunsCompleted() {
    this.runsCompleted += 1;
    // A finished run was necessarily started (covers runs begun before the
    // started counter existed, or counted on another device).
    if (this.runsStarted < this.runsCompleted) this.runsStarted = this.runsCompleted;
    this._save();
  }

  getRunsStarted() {
    return this.runsStarted;
  }

  // ── The prologue ───────────────────────────────────────────────────────

  /** 'none' | 'in_progress' | 'skipped' | 'complete' (routing reads this). */
  getPrologueState() {
    return normalizePrologueState(this.prologue).state;
  }

  /** The whole record, as a copy. */
  getPrologue() {
    return normalizePrologueState(this.prologue);
  }

  /**
   * Record where the prologue stands ('in_progress' when it starts, 'skipped' when the
   * player skips to the first run). Never steps back from 'complete', and a paid
   * grant stays paid. Persists.
   */
  setPrologueState(state) {
    if (!PROLOGUE_STATES.includes(state)) return { ok: false };
    const current = normalizePrologueState(this.prologue);
    if (current.state === 'complete') return { ok: true };
    this.prologue = { ...current, state };
    return this._save();
  }

  /** A prologue chapter won on this save (what later runs may skip explaining). */
  recordPrologueChapter(chapterId) {
    if (typeof chapterId !== 'string' || !chapterId) return { ok: false };
    const current = normalizePrologueState(this.prologue);
    if (current.chaptersCompleted.includes(chapterId)) return { ok: true };
    this.prologue = { ...current, chaptersCompleted: [...current.chaptersCompleted, chapterId] };
    return this._save();
  }

  /** True once the prologue won this chapter on this save (even if later skipped). */
  hasCompletedPrologueChapter(chapterId) {
    return normalizePrologueState(this.prologue).chaptersCompleted.includes(chapterId);
  }

  /** Lessons the player practised (not just saw) in the prologue (§8's second fact). */
  recordProloguePractised(ids) {
    const current = normalizePrologueState(this.prologue);
    const practised = idList([...current.practised, ...(Array.isArray(ids) ? ids : [])]);
    if (practised.length === current.practised.length) return { ok: true };
    this.prologue = { ...current, practised };
    return this._save();
  }

  /**
   * The prologue ends (won or skipped mid-way): state 'complete', and the Home Base
   * grant paid exactly once. The ledger flag and the currencies land in one write; a
   * failed write rolls the memory back so a retry pays, never a second call. A copy
   * on disk that already paid (another device, a cloud merge) is adopted first.
   * @param {{ grant?: { valor?: number, supply?: number }, chaptersCompleted?: string[],
   *   practised?: string[] }} [options]
   * @returns {{ ok: boolean, paid: boolean }}
   */
  completePrologue({ grant = null, chaptersCompleted = [], practised = [] } = {}) {
    this._adoptForeignDiskStateIfNewer();
    const before = this._captureState();
    const current = normalizePrologueState(this.prologue);
    const paid = !current.grantPaid;
    this.prologue = mergePrologueState(current, {
      state: 'complete',
      grantPaid: true,
      chaptersCompleted,
      practised,
    });
    if (paid) {
      const { valor, supply } = prologueGrantAmounts(grant);
      this.totalValor = Math.max(0, Math.floor((this.totalValor || 0) + valor));
      this.totalSupply = Math.max(0, Math.floor((this.totalSupply || 0) + supply));
    }
    const result = this._save();
    if (!result.ok) {
      this._restoreState(before);
      return { ok: false, paid: false };
    }
    return { ok: true, paid };
  }

  incrementRunsStarted() {
    this.runsStarted += 1;
    this._save();
  }

  /**
   * The upgrade's tier. For a repeatable upgrade (RepeatableUpgrades.js) that is the listed
   * tiers plus the repeat tiers, which are stored apart (`repeatTiersKey`): the synced
   * `purchasedUpgrades[id]` never passes the tiers an older build's data lists, so an old
   * client never reads `effects[level - 1]` or `costs[level - 1]` out of range.
   */
  getUpgradeLevel(id) {
    const count = (key) => {
      const raw = this.purchasedUpgrades[key];
      return Math.max(0, Number.isFinite(raw) ? Math.floor(raw) : 0);
    };
    const upgrade = this.upgradesData.find((u) => u.id === id);
    if (!isRepeatableUpgrade(upgrade)) return count(id);
    return joinUpgradeLevel(count(id), count(repeatTiersKey(id)));
  }

  /** Store an upgrade's tier (the one writer; the split is described at getUpgradeLevel). */
  _setUpgradeLevel(id, level) {
    const upgrade = this.upgradesData.find((u) => u.id === id);
    const { listed, repeat } = isRepeatableUpgrade(upgrade)
      ? splitUpgradeLevel(upgrade, level)
      : { listed: level, repeat: 0 };
    const put = (key, value) => {
      if (value > 0) this.purchasedUpgrades[key] = value;
      else delete this.purchasedUpgrades[key];
    };
    put(id, listed);
    if (isRepeatableUpgrade(upgrade)) put(repeatTiersKey(id), repeat);
  }

  getNextCost(id) {
    const upgrade = this.upgradesData.find((u) => u.id === id);
    if (!upgrade) return null;
    const level = this.getUpgradeLevel(id);
    // A repeatable upgrade (RepeatableUpgrades.js) sells tiers past its list forever.
    if (upgradeMaxedAt(upgrade, level)) return null;
    return upgradeTierCost(upgrade, level + 1);
  }

  /**
   * What refunding the top tier returns: the Sol's basis, what a tier bought before a price
   * rise was paid (`legacyTierCosts`), else the tier's current price.
   */
  _refundAmount(upgrade, level) {
    if (upgrade.id === 'unlock_sol') return this.solRefundBasis;
    const legacy = Number(this.legacyTierCosts[upgrade.id]?.[level]);
    if (Number.isFinite(legacy) && legacy > 0) return legacy;
    return upgradeTierCost(upgrade, level) || 0;
  }

  /** Get the currency type ('valor' or 'supply') for an upgrade by its ID. */
  getCurrencyForUpgrade(id) {
    const upgrade = this.upgradesData.find((u) => u.id === id);
    if (!upgrade) return 'supply';
    return CATEGORY_CURRENCY[upgrade.category] || 'supply';
  }

  canAfford(id) {
    const cost = this.getNextCost(id);
    if (cost === null) return false;
    const currency = this.getCurrencyForUpgrade(id);
    const balance = currency === 'valor' ? this.totalValor : this.totalSupply;
    return balance >= cost;
  }

  isMaxed(id) {
    const upgrade = this.upgradesData.find((u) => u.id === id);
    if (!upgrade) return false;
    return upgradeMaxedAt(upgrade, this.getUpgradeLevel(id));
  }

  // --- Milestone methods ---

  hasMilestone(milestone) {
    return this.milestones.has(milestone);
  }

  recordMilestone(milestone) {
    if (this.milestones.has(milestone)) return;
    this.milestones.add(milestone);
    this._save();
  }

  getMilestones() {
    return [...this.milestones];
  }

  // --- NG+ (docs/specs/ng-plus.md; the rules are NgPlusState.js) ---

  /** The slot's NG+ state (a copy). */
  getNgPlus() {
    return structuredClone(this.ngPlus);
  }

  isNgPlusUnlocked() {
    return (Number(this.purchasedUpgrades[NG_PLUS_UNLOCK_KEY]) || 0) > 0;
  }

  /** Why NG+ cannot be bought now ('unlocked' | 'milestone' | 'valor' | 'supply'), or null. */
  ngPlusUnlockBlock() {
    if (this.isNgPlusUnlocked()) return 'unlocked';
    if (!this.milestones.has(NG_PLUS_MILESTONE)) return 'milestone';
    if (this.totalValor < NG_PLUS_COST.valor) return 'valor';
    if (this.totalSupply < NG_PLUS_COST.supply) return 'supply';
    return null;
  }

  /** Buy NG+: both currencies and the unlock in one write. Never refundable. */
  unlockNgPlus() {
    const reason = this.ngPlusUnlockBlock();
    if (reason) return { ok: false, reason };
    return this._commitNgPlus(() => {
      this.totalValor -= NG_PLUS_COST.valor;
      this.totalSupply -= NG_PLUS_COST.supply;
      this.purchasedUpgrades[NG_PLUS_UNLOCK_KEY] = 1;
      return { ok: true };
    });
  }

  /** What an NG+ run on `difficultyId` starts with (RunManager.startRun's `ngPlus`), or null. */
  ngPlusRunStart(difficultyId) {
    if (!this.isNgPlusUnlocked() || !isNgPlusRung(difficultyId)) return null;
    return runStartOf(this.ngPlus);
  }

  /** "Who rides again?": commit the picks (NgPlusState.applyRidePicks). */
  chooseNgPlusRide(picks) {
    if (!this.isNgPlusUnlocked()) return { ok: false, reason: 'locked' };
    return this._commitNgPlus((state) => applyRidePicks(state, picks));
  }

  passNgPlusRide() {
    return this._commitNgPlus((state) => ({ ok: passRide(state) }));
  }

  releaseNgPlusVeteran(id) {
    return this._commitNgPlus((state) => ({ ok: releaseRecord(state, id) }));
  }

  setNgPlusBring(ids) {
    return this._commitNgPlus((state) => setBring(state, ids));
  }

  /** A run's end (NgPlusRun.ngPlusRunEnd), applied inside the run's payout write. */
  recordNgPlusRunEnd(end) {
    if (!end) return { ok: true };
    return this._commitNgPlus((state) => ({ ok: true, ...applyRunEnd(state, end) }));
  }

  /**
   * Change the NG+ state (and anything else `change` touches) in one write: `change` gets the
   * state and returns `{ ok }`; a refusal or a failed write leaves everything as it was.
   */
  _commitNgPlus(change) {
    const before = this._captureState();
    const result = change(this.ngPlus);
    if (!result?.ok) {
      this._restoreState(before);
      return result || { ok: false };
    }
    const saved = this._save();
    if (!saved.ok) {
      this._restoreState(before);
      return { ok: false, reason: 'save_failed' };
    }
    return result;
  }

  // --- Story flag methods (run-aware narrative memory) ---

  /** The barks and flavour bags carried between runs (compact), for RunManager.startRun. */
  getNarrativeSeen() {
    return structuredClone(this.storyFlags?.narrativeSeen || {});
  }

  getStoryFlags() {
    return this.storyFlags;
  }

  getBossSlainCount(name) {
    return Math.max(0, Math.floor(Number(this.storyFlags?.bossSlain?.[name]) || 0));
  }

  getDefeatedByCount(name) {
    return Math.max(0, Math.floor(Number(this.storyFlags?.defeatedBy?.[name]) || 0));
  }

  /** Remember pool lines just played (NarrativeDirector keys) so a set rotates fully. */
  recordLinesPlayed(keys) {
    const fresh = (Array.isArray(keys) ? keys : []).filter((k) => typeof k === 'string' && k);
    if (!fresh.length) return;
    this.storyFlags.linesPlayed = mergeLinesPlayed(this.storyFlags.linesPlayed, fresh);
    this._save();
  }

  recordBossSlain(name) {
    if (typeof name !== 'string' || !name.trim()) return;
    const key = name.trim();
    this.storyFlags.bossSlain[key] = this.getBossSlainCount(key) + 1;
    this._save();
  }

  /**
   * Record how a run ended. Called exactly once per run, from
   * RunManager._applySettledRewardsToMeta (under its appliedToMeta guard).
   * defeatedBy is only counted when the fatal battle was a boss fight.
   */
  hasSeenDialogue(key) {
    return this.seenDialogueKeys.includes(key);
  }

  /** Deeds any unit of this save has earned: the Compendium lists these, hides the rest. */
  hasEarnedDeed(id) {
    return this.deedsEarned.includes(id);
  }

  recordDeedsEarned(ids) {
    const merged = mergeDeedIds(this.deedsEarned, ids);
    if (merged.length === this.deedsEarned.length) return;
    this.deedsEarned = merged;
    this._save();
  }

  /** Has this lord joined an army on this save? Edric and Sera always have. */
  hasMetLord(name) {
    return ALWAYS_MET_LORD_NAMES.includes(name) || this.lordsMet.includes(name);
  }

  /** The lords this save has met, sorted. */
  getLordsMet() {
    return [...this.lordsMet];
  }

  /**
   * Remember lords who joined (idempotent; saves only when one is new).
   * @returns {boolean} whether any name was new
   */
  recordLordsMet(names) {
    const merged = mergeLordNames(this.lordsMet, names);
    if (merged.length === this.lordsMet.length) return false;
    this.lordsMet = merged;
    this._save();
    return true;
  }

  /** Has this save met the item (by catalog name) / skill (by id)? */
  hasSeenItem(name) {
    return this.itemsSeen.includes(name);
  }

  hasSeenSkill(id) {
    return this.skillsSeen.includes(id);
  }

  /**
   * Remember items and skills the save has met (`{ items, skills }`; idempotent, saves
   * only when one is new).
   * @returns {boolean} whether anything was new
   */
  recordDiscoveries(found) {
    const merged = mergeDiscoveries({ items: this.itemsSeen, skills: this.skillsSeen }, found);
    if (
      merged.items.length === this.itemsSeen.length &&
      merged.skills.length === this.skillsSeen.length
    )
      return false;
    this.itemsSeen = merged.items;
    this.skillsSeen = merged.skills;
    this._save();
    return true;
  }

  markDialogueSeen(key) {
    if (this.hasSeenDialogue(key)) return;
    this.seenDialogueKeys = mergeSeenDialogueKeys(this.seenDialogueKeys, [key]);
    this._save();
  }

  recordRunEnd({
    result,
    act = null,
    difficultyId = 'normal',
    defeatedBy = null,
    wasBossDefeat = false,
    lordFalls = [],
    victoryRecord = null,
    narrativeSeen = null,
  } = {}) {
    if (result !== 'victory' && result !== 'defeat') return;
    if (result === 'victory' && victoryRecord)
      this.runRecords = mergeRunRecords(this.runRecords, [victoryRecord]);
    const foe = typeof defeatedBy === 'string' && defeatedBy ? defeatedBy : null;
    this.storyFlags.lastRun = {
      result,
      act: typeof act === 'string' ? act : null,
      difficultyId: typeof difficultyId === 'string' ? difficultyId : 'normal',
      defeatedBy: foe,
      endedAt: Date.now(),
      lordsFell: Array.isArray(lordFalls)
        ? [...new Set(lordFalls.filter((name) => typeof name === 'string' && name))]
        : [],
    };
    this.storyFlags.lossStreak =
      result === 'defeat'
        ? Math.max(0, Math.floor(Number(this.storyFlags.lossStreak) || 0)) + 1
        : 0;
    if (narrativeSeen) {
      this.storyFlags.narrativeSeen = normalizeNarrativeSeen({
        ...this.storyFlags.narrativeSeen,
        ...narrativeSeen,
      });
    }
    if (result === 'defeat' && wasBossDefeat && foe) {
      this.storyFlags.defeatedBy[foe] = this.getDefeatedByCount(foe) + 1;
    }
    if (Array.isArray(lordFalls)) {
      for (const lordName of lordFalls) {
        if (typeof lordName !== 'string' || !lordName) continue;
        const current = Math.max(0, Math.floor(Number(this.storyFlags.lordFalls[lordName]) || 0));
        this.storyFlags.lordFalls[lordName] = current + 1;
      }
    }
    this._save();
  }

  // --- Prerequisite methods ---

  /**
   * Check if all prerequisites for an upgrade are met.
   * @param {string} id - upgrade ID
   * @returns {boolean}
   */
  meetsPrerequisites(id) {
    const upgrade = this.upgradesData.find((u) => u.id === id);
    if (!upgrade || !upgrade.requires) return true;
    const reqs = upgrade.requires;

    if (reqs.upgrades) {
      for (const req of reqs.upgrades) {
        if (this.getUpgradeLevel(req.id) < req.level) return false;
      }
    }
    if (reqs.milestones) {
      for (const m of reqs.milestones) {
        if (!this.milestones.has(m)) return false;
      }
    }
    return true;
  }

  /**
   * Get structured info about prerequisites for UI display.
   * @param {string} id - upgrade ID
   * @returns {{ met: boolean, missing: string[] }} - missing is human-readable list
   */
  getPrerequisiteInfo(id) {
    const upgrade = this.upgradesData.find((u) => u.id === id);
    if (!upgrade || !upgrade.requires) return { met: true, missing: [] };

    const missing = [];
    const reqs = upgrade.requires;

    if (reqs.upgrades) {
      for (const req of reqs.upgrades) {
        if (this.getUpgradeLevel(req.id) < req.level) {
          const reqUpgrade = this.upgradesData.find((u) => u.id === req.id);
          const isPurchased = this.getUpgradeLevel(req.id) > 0;
          const name = !reqUpgrade
            ? req.id
            : this.isMilestoneLocked(reqUpgrade) && !isPurchased
              ? '???'
              : reqUpgrade.name;
          missing.push(`${name} Lv${req.level}`);
        }
      }
    }
    if (reqs.milestones) {
      const MILESTONE_LABELS = {
        beatAct1: 'Beat Act 1',
        beatAct2: 'Beat Act 2',
        beatAct3: 'Beat Act 3',
        beatGame: 'Beat the Game',
        beatDusk: 'Beat the Game on Dusk',
        beatHard: 'Beat the Game on Nightfall',
        beatLunatic: 'Beat the Game on Black Sun',
      };
      for (const m of reqs.milestones) {
        if (!this.milestones.has(m)) {
          missing.push(MILESTONE_LABELS[m] || m);
        }
      }
    }

    return { met: missing.length === 0, missing };
  }

  isMilestoneLocked(upgrade) {
    if (!upgrade?.requires?.milestones) return false;
    return upgrade.requires.milestones.some((milestone) => !this.milestones.has(milestone));
  }

  purchaseUpgrade(id) {
    if (!this.meetsPrerequisites(id)) return false;
    if (!this.canAfford(id)) return false;
    const cost = this.getNextCost(id);
    const currency = this.getCurrencyForUpgrade(id);
    if (currency === 'valor') {
      this.totalValor -= cost;
    } else {
      this.totalSupply -= cost;
    }
    if (id === 'unlock_sol') this.solRefundBasis = cost;
    this._setUpgradeLevel(id, this.getUpgradeLevel(id) + 1);
    this._save();
    return true;
  }

  // --- Skill assignment methods ---

  /** Get list of skill IDs unlocked via purchased unlock_* upgrades. */
  getUnlockedSkills() {
    const unlocked = [];
    for (const upgrade of this.upgradesData) {
      if (this.getUpgradeLevel(upgrade.id) === 0) continue;
      const effect = upgrade.effects[0];
      if (effect?.unlockSkill) unlocked.push(effect.unlockSkill);
    }
    return unlocked;
  }

  /**
   * Resolve weapon-art unlocks from purchased meta upgrades.
   * Supports:
   * - effect.unlockWeaponArt: string
   * - effect.unlockWeaponArts: string[]
   * - effect.unlockWeaponArtsByWeaponType: string | string[]
   * Returns a stable, de-duplicated ID list and fails closed for unknown IDs.
   */
  getUnlockedWeaponArts(weaponArtCatalog = null) {
    const catalog = Array.isArray(weaponArtCatalog) ? weaponArtCatalog : [];
    const validArtIds = new Set();
    const artIdsByWeaponType = new Map();

    for (const art of catalog) {
      if (!art?.id) continue;
      validArtIds.add(art.id);
      const weaponType = typeof art.weaponType === 'string' ? art.weaponType : null;
      if (!weaponType) continue;
      if (!artIdsByWeaponType.has(weaponType)) artIdsByWeaponType.set(weaponType, []);
      artIdsByWeaponType.get(weaponType).push(art.id);
    }

    const unlocked = [];
    const seen = new Set();
    const pushIfValid = (artId) => {
      if (typeof artId !== 'string' || artId.length <= 0) return;
      if (!validArtIds.has(artId)) return;
      if (seen.has(artId)) return;
      seen.add(artId);
      unlocked.push(artId);
    };
    const toStringList = (value) => {
      if (typeof value === 'string') return [value];
      if (Array.isArray(value)) return value.filter((v) => typeof v === 'string' && v.length > 0);
      return [];
    };

    for (const upgrade of this.upgradesData) {
      const level = this.getUpgradeLevel(upgrade.id);
      if (level === 0) continue;
      const effect = upgradeEffectAtLevel(upgrade, level);
      if (!effect) continue;

      pushIfValid(effect.unlockWeaponArt);
      for (const artId of toStringList(effect.unlockWeaponArts)) pushIfValid(artId);
      for (const weaponType of toStringList(effect.unlockWeaponArtsByWeaponType)) {
        const bundle = artIdsByWeaponType.get(weaponType) || [];
        for (const artId of bundle) pushIfValid(artId);
      }
    }

    return unlocked;
  }

  /** Get the skill assignments object: { lordName: [skillId, ...] } */
  getSkillAssignments() {
    return this.skillAssignments;
  }

  /** Number of starting skill slots available (1 base + extra_skill_slot upgrade). */
  getStartingSkillSlots() {
    return Math.min(1 + this.getUpgradeLevel('extra_skill_slot'), MAX_STARTING_SKILLS);
  }

  /** The lord a starting skill is assigned to, or null. Each skill sits on one lord. */
  getSkillHolder(skillId) {
    for (const [lord, slots] of Object.entries(this.skillAssignments))
      if (Array.isArray(slots) && slots.includes(skillId)) return lord;
    return null;
  }

  /**
   * Assign a skill to a lord (max getStartingSkillSlots() per lord). An unlocked
   * skill sits on one lord at a time: held by another lord, it is refused, or with
   * `{ move: true }` taken from that lord. Returns true on success.
   */
  assignSkill(lordName, skillId, { move = false } = {}) {
    const holder = this.getSkillHolder(skillId);
    if (holder === lordName) return false;
    if (holder && !move) return false;
    const slots = this.skillAssignments[lordName] || [];
    if (slots.length >= this.getStartingSkillSlots()) return false;
    // Must be an unlocked skill
    if (!this.getUnlockedSkills().includes(skillId)) return false;
    if (holder) {
      const held = this.skillAssignments[holder];
      held.splice(held.indexOf(skillId), 1);
      if (held.length === 0) delete this.skillAssignments[holder];
    }
    this.skillAssignments[lordName] = [...slots, skillId];
    this._save();
    return true;
  }

  /** Unassign a skill from a lord. Returns true if found and removed. */
  unassignSkill(lordName, skillId) {
    const slots = this.skillAssignments[lordName];
    if (!slots) return false;
    const idx = slots.indexOf(skillId);
    if (idx === -1) return false;
    slots.splice(idx, 1);
    if (slots.length === 0) delete this.skillAssignments[lordName];
    this._save();
    return true;
  }

  // --- Commander choice methods ---

  /** Highest commanderChoiceTier across purchased upgrades (0 = not purchased). */
  getCommanderChoiceTier() {
    let tier = 0;
    for (const upgrade of this.upgradesData) {
      const level = this.getUpgradeLevel(upgrade.id);
      if (level === 0) continue;
      const effectTier = Number(upgradeEffectAtLevel(upgrade, level)?.commanderChoiceTier) || 0;
      if (effectTier > tier) tier = effectTier;
    }
    return tier;
  }

  /**
   * The starting pair after tier gating: tier 0 forces the default pair,
   * tier 1 honors the commander and forces the default partner, tier 2
   * honors both. A lord this save has not met falls back like tier gating
   * (unmet commander -> default pair; unmet partner -> default partner).
   * Lord-name existence is enforced by the consumer
   * (RunManager falls back to the default pair for unknown names).
   */
  getLordSelection() {
    const tier = this.getCommanderChoiceTier();
    if (tier <= 0) return { ...DEFAULT_LORD_SELECTION };
    const stored = normalizeLordSelection(this.lordSelection);
    // A pick of a lord this save has not met never leads a run.
    if (!this.hasMetLord(stored.commander)) return { ...DEFAULT_LORD_SELECTION };
    if (tier === 1 || !this.hasMetLord(stored.partner))
      return { commander: stored.commander, partner: defaultPartnerFor(stored.commander) };
    return stored;
  }

  /**
   * Pick the commander (requires tier >= 1 and a lord this save has met). If the
   * pick collides with the stored partner, the partner resets to the default for
   * that commander.
   */
  setCommander(name) {
    if (typeof name !== 'string' || name.length === 0) return false;
    if (this.getCommanderChoiceTier() < 1) return false;
    if (!this.hasMetLord(name)) return false;
    const partner =
      this.lordSelection?.partner === name ? defaultPartnerFor(name) : this.lordSelection?.partner;
    this.lordSelection = normalizeLordSelection({ commander: name, partner });
    this._save();
    return true;
  }

  /** Pick the partner (requires tier >= 2 and a met lord; must differ from the commander). */
  setPartner(name) {
    if (typeof name !== 'string' || name.length === 0) return false;
    if (this.getCommanderChoiceTier() < 2) return false;
    if (!this.hasMetLord(name)) return false;
    if (this.lordSelection?.commander === name) return false;
    this.lordSelection = normalizeLordSelection({
      commander: this.lordSelection?.commander,
      partner: name,
    });
    this._save();
    return true;
  }

  /**
   * Compute flat object of all active effects from purchased upgrades.
   * Returns: { statBonuses, growthBonuses, lordStatBonuses, lordGrowthBonuses,
   *            goldBonus, battleGoldMultiplier, extraVulnerary, vulneraryUses, lootWeaponQualityBonus, lootCategoryWeightBonuses,
   *            lordRecruitChanceBonus, recruitPromotionChanceBonus,
   *            deployBonus, visionChargesBonus, caravanChanceBonus, recruitRandomSkill, recruitStartingVulnerary, extraStartingUnitTier,
   *            lethalArmoryTier, recruitWeaponForge, recruitStartingAccessory, recruitXpBonus,
   *            markChance (Marked Blood: the share of recruits that bear a Mark),
   *            startingWeaponForge, deadlyArsenalTier,
   *            ironArms, steelArms, artAdept, startingAccessoryTier, startingStaffTier,
   *            startingReclassSeal,
   *            startingSkills, metaUnlockedWeaponArts,
   *            commanderChoiceTier, startingLords }
   */
  getActiveEffects(options = {}) {
    const effects = {
      statBonuses: {},
      growthBonuses: {},
      lordStatBonuses: {},
      lordGrowthBonuses: {},
      legendaryLordChanceBonus: 0,
      goldBonus: 0,
      battleGoldMultiplier: 0,
      extraVulnerary: 0,
      vulneraryUses: 0,
      // Branching Threads: rerolls a run starts with, spent on battle rewards or level-ups
      // (tier totals, not increments; repeatable past tier 4: RepeatableUpgrades.js).
      rewardRerolls: 0,
      lootCategoryWeightBonuses: {},
      lootWeaponQualityBonus: 0,
      lordRecruitChanceBonus: 0,
      recruitPromotionChanceBonus: 0,
      deployBonus: 0,
      visionChargesBonus: 0,
      caravanChanceBonus: 0,
      recruitRandomSkill: false,
      recruitStartingVulnerary: 0,
      extraStartingUnitTier: 0,
      lethalArmoryTier: 0,
      recruitWeaponForge: 0,
      recruitStartingAccessory: 0,
      recruitXpBonus: 0,
      markChance: DEFAULT_MARK_CHANCE,
      startingWeaponForge: 0,
      deadlyArsenalTier: 0,
      ironArms: 0,
      steelArms: 0,
      artAdept: 0,
      startingAccessoryTier: 0,
      startingStaffTier: 0,
      startingReclassSeal: 0,
      extraSkillSlot: 0,
      masterOfArms: false,
      thirdLordMode: null,
      commanderChoiceTier: 0,
      startingLords: null,
      startingSkills: {},
      metaUnlockedWeaponArts: this.getUnlockedWeaponArts(options.weaponArtCatalog || []),
    };

    for (const upgrade of this.upgradesData) {
      const level = this.getUpgradeLevel(upgrade.id);
      if (level === 0) continue;

      const effect = upgradeEffectAtLevel(upgrade, level);
      if (!effect) continue;

      if (Number.isFinite(effect.legendaryLordChanceBonus))
        effects.legendaryLordChanceBonus += effect.legendaryLordChanceBonus;

      // Recruit flat stat bonuses
      if (effect.stat !== undefined) {
        effects.statBonuses[effect.stat] = (effects.statBonuses[effect.stat] || 0) + effect.value;
      }
      // Recruit growth bonuses
      if (effect.recruitGrowth !== undefined) {
        effects.growthBonuses[effect.recruitGrowth] =
          (effects.growthBonuses[effect.recruitGrowth] || 0) + effect.growthValue;
      }
      // Lord flat stat bonuses
      if (effect.lordStat !== undefined) {
        effects.lordStatBonuses[effect.lordStat] =
          (effects.lordStatBonuses[effect.lordStat] || 0) + effect.value;
      }
      // Lord growth bonuses
      if (effect.lordGrowth !== undefined) {
        effects.lordGrowthBonuses[effect.lordGrowth] =
          (effects.lordGrowthBonuses[effect.lordGrowth] || 0) + effect.growthValue;
      }
      if (effect.goldBonus !== undefined) effects.goldBonus = effect.goldBonus;
      if (effect.battleGoldMultiplier !== undefined)
        effects.battleGoldMultiplier = effect.battleGoldMultiplier;
      if (effect.extraVulnerary !== undefined) effects.extraVulnerary = effect.extraVulnerary;
      if (effect.vulneraryUses !== undefined)
        effects.vulneraryUses = Math.max(effects.vulneraryUses, Number(effect.vulneraryUses) || 0);
      if (effect.rewardRerolls !== undefined)
        effects.rewardRerolls = Math.max(
          effects.rewardRerolls,
          Math.max(0, Math.trunc(Number(effect.rewardRerolls) || 0)),
        );
      if (effect.lootCategoryWeightBonuses) {
        const mapped = normalizeLootCategoryWeightBonuses(effect.lootCategoryWeightBonuses);
        if (mapped) {
          for (const [category, delta] of Object.entries(mapped)) {
            effects.lootCategoryWeightBonuses[category] =
              normalizeLootCategoryWeight(effects.lootCategoryWeightBonuses[category]) + delta;
          }
        }
      }
      if (
        effect.lootWeaponWeightBonus !== undefined ||
        effect.lootWeaponQualityBonus !== undefined
      ) {
        const bonus = normalizeLootCategoryWeight(
          effect.lootWeaponQualityBonus ?? effect.lootWeaponWeightBonus,
        );
        if (bonus !== 0) {
          effects.lootWeaponQualityBonus = bonus;
          effects.lootCategoryWeightBonuses.weapon =
            normalizeLootCategoryWeight(effects.lootCategoryWeightBonuses.weapon) + bonus;
        }
      }
      if (effect.lordRecruitChanceBonus !== undefined)
        effects.lordRecruitChanceBonus = effect.lordRecruitChanceBonus;
      if (effect.recruitPromotionChanceBonus !== undefined)
        effects.recruitPromotionChanceBonus = effect.recruitPromotionChanceBonus;
      if (effect.deployBonus !== undefined) effects.deployBonus = effect.deployBonus;
      if (effect.visionChargesBonus !== undefined)
        effects.visionChargesBonus = effect.visionChargesBonus;
      if (effect.caravanChanceBonus !== undefined)
        effects.caravanChanceBonus = effect.caravanChanceBonus;
      if (effect.recruitRandomSkill) effects.recruitRandomSkill = true;
      if (effect.recruitStartingVulnerary !== undefined)
        effects.recruitStartingVulnerary = effect.recruitStartingVulnerary;
      if (effect.extraStartingUnitTier !== undefined)
        effects.extraStartingUnitTier = effect.extraStartingUnitTier;
      if (effect.lethalArmoryTier !== undefined) {
        effects.lethalArmoryTier = Math.max(
          effects.lethalArmoryTier,
          Number(effect.lethalArmoryTier) || 0,
        );
      }
      if (effect.recruitWeaponForge !== undefined) {
        effects.recruitWeaponForge = Math.max(
          effects.recruitWeaponForge,
          Number(effect.recruitWeaponForge) || 0,
        );
      }
      if (effect.recruitStartingAccessory !== undefined) {
        effects.recruitStartingAccessory = Math.max(
          effects.recruitStartingAccessory,
          Number(effect.recruitStartingAccessory) || 0,
        );
      }
      if (effect.recruitXpBonus !== undefined) {
        effects.recruitXpBonus = Math.max(
          effects.recruitXpBonus,
          Number(effect.recruitXpBonus) || 0,
        );
      }
      if (effect.markChance !== undefined) {
        effects.markChance = Math.max(effects.markChance, Number(effect.markChance) || 0);
      }
      // Starting equipment effects
      if (effect.startingWeaponForge !== undefined)
        effects.startingWeaponForge = effect.startingWeaponForge;
      if (effect.deadlyArsenalTier !== undefined) {
        effects.deadlyArsenalTier = Math.max(
          effects.deadlyArsenalTier,
          Number(effect.deadlyArsenalTier) || 0,
        );
      }
      if (effect.deadlyArsenal !== undefined && Number(effect.deadlyArsenal) > 0) {
        effects.deadlyArsenalTier = Math.max(effects.deadlyArsenalTier, 2);
      }
      if (effect.ironArms !== undefined)
        effects.ironArms = Math.max(effects.ironArms, Number(effect.ironArms) || 0);
      if (effect.steelArms !== undefined)
        effects.steelArms = Math.max(effects.steelArms, Number(effect.steelArms) || 0);
      if (effect.artAdept !== undefined)
        effects.artAdept = Math.max(effects.artAdept, Number(effect.artAdept) || 0);
      if (effect.startingAccessoryTier !== undefined)
        effects.startingAccessoryTier = effect.startingAccessoryTier;
      if (effect.startingStaffTier !== undefined)
        effects.startingStaffTier = effect.startingStaffTier;
      if (effect.startingReclassSeal !== undefined)
        effects.startingReclassSeal = effect.startingReclassSeal;
      if (effect.extraSkillSlot !== undefined) effects.extraSkillSlot = effect.extraSkillSlot;
      if (effect.masterOfArms) effects.masterOfArms = true;
      if (effect.thirdLordMode !== undefined) effects.thirdLordMode = effect.thirdLordMode;
      if (effect.commanderChoiceTier !== undefined) {
        effects.commanderChoiceTier = Math.max(
          effects.commanderChoiceTier,
          Number(effect.commanderChoiceTier) || 0,
        );
      }
    }

    // Starting pair from the commander-choice selection (tier-gated; null when unpurchased)
    if (effects.commanderChoiceTier > 0) {
      effects.startingLords = this.getLordSelection();
    }

    // Trim startingSkills per lord to available slot count (each skill on one lord)
    const maxSlots = this.getStartingSkillSlots();
    const rawAssignments = exclusiveSkillAssignments(this.getSkillAssignments());
    for (const [lord, skills] of Object.entries(rawAssignments)) {
      if (Array.isArray(skills) && skills.length > 0) {
        effects.startingSkills[lord] = skills.slice(0, maxSlots);
      }
    }

    return effects;
  }

  /**
   * Find upgrades that directly depend on `id` via their requires.upgrades[] field.
   * Checks direct edges only — does not perform transitive graph traversal.
   * This is intentional; the prerequisite graph is shallow (max depth 1).
   * @param {string} id - upgrade ID
   * @returns {Array<{ id: string, name: string, requiredLevel: number }>}
   */
  getDependentUpgrades(id) {
    const dependents = [];
    for (const upgrade of this.upgradesData) {
      if (!upgrade.requires?.upgrades) continue;
      for (const req of upgrade.requires.upgrades) {
        if (req.id === id) {
          dependents.push({ id: upgrade.id, name: upgrade.name, requiredLevel: req.level });
        }
      }
    }
    return dependents;
  }

  /**
   * Check whether an upgrade tier can be refunded.
   * @param {string} id - upgrade ID
   * @returns {{ success: boolean, reason?: string, detail?: string, refundAmount?: number, refundFee?: number }}
   */
  canRefund(id) {
    const upgrade = this.upgradesData.find((u) => u.id === id);
    if (!upgrade) return { success: false, reason: 'unknown_upgrade' };

    const level = this.getUpgradeLevel(id);
    if (level <= 0) return { success: false, reason: 'not_purchased' };

    const currency = this.getCurrencyForUpgrade(id);
    const balance = currency === 'valor' ? this.totalValor : this.totalSupply;
    if (balance < REFUND_FEE) return { success: false, reason: 'insufficient_fee' };

    // Check if any purchased dependent would break
    const newLevel = level - 1;
    const dependents = this.getDependentUpgrades(id);
    for (const dep of dependents) {
      if (this.getUpgradeLevel(dep.id) > 0 && newLevel < dep.requiredLevel) {
        return {
          success: false,
          reason: 'blocked_by_dependent',
          detail: `${dep.name} requires this at Lv${dep.requiredLevel}`,
        };
      }
    }

    // The top tier at its price: a repeat tier past the list returns its repeat price.
    const refundAmount = this._refundAmount(upgrade, level);
    return { success: true, refundAmount, refundFee: REFUND_FEE };
  }

  /**
   * Refund one tier of an upgrade. Deducts REFUND_FEE, refunds tier cost, decrements level.
   * If a skill-unlock is refunded to 0, auto-unassigns that skill from all lords.
   * @param {string} id - upgrade ID
   * @returns {{ success: boolean, reason?: string, detail?: string, refundAmount?: number, refundFee?: number }}
   */
  refundUpgrade(id) {
    const check = this.canRefund(id);
    if (!check.success) return check;

    const upgrade = this.upgradesData.find((u) => u.id === id);
    const level = this.getUpgradeLevel(id);
    const currency = this.getCurrencyForUpgrade(id);
    const refundAmount = this._refundAmount(upgrade, level);

    // Deduct fee + refund tier cost
    if (currency === 'valor') {
      this.totalValor = this.totalValor - REFUND_FEE + refundAmount;
    } else {
      this.totalSupply = this.totalSupply - REFUND_FEE + refundAmount;
    }

    // Decrement level
    this._setUpgradeLevel(id, level - 1);
    if (this.legacyTierCosts[id]) {
      delete this.legacyTierCosts[id][level];
      if (Object.keys(this.legacyTierCosts[id]).length === 0) delete this.legacyTierCosts[id];
    }

    // If skill unlock refunded to 0, auto-unassign from all lords
    if (level === 1) {
      const effect = upgrade.effects[0];
      const skillId = effect?.unlockSkill;
      if (skillId) {
        for (const lordName of Object.keys(this.skillAssignments)) {
          const slots = this.skillAssignments[lordName];
          const idx = slots.indexOf(skillId);
          if (idx !== -1) {
            slots.splice(idx, 1);
            if (slots.length === 0) delete this.skillAssignments[lordName];
          }
        }
      }
      // Commander-choice refund: snap the stored selection back to what the
      // remaining tier supports (tier 1 -> default partner, tier 0 -> default pair).
      if (Number(effect?.commanderChoiceTier) > 0) {
        this.lordSelection = this.getLordSelection();
      }
    }

    this._save();
    return { success: true, refundAmount, refundFee: REFUND_FEE };
  }

  reset() {
    this.totalValor = 0;
    this.totalSupply = 0;
    this.purchasedUpgrades = {};
    this.legacyTierCosts = {};
    this.runsCompleted = 0;
    this.runsStarted = 0;
    this.skillAssignments = {};
    this.lordSelection = { ...DEFAULT_LORD_SELECTION };
    this.lordsMet = [...ALWAYS_MET_LORD_NAMES];
    this.itemsSeen = [];
    this.skillsSeen = [];
    this.milestones = new Set();
    this.storyFlags = defaultStoryFlags();
    this.prologue = defaultPrologueState();
    this.ngPlus = defaultNgPlusState();
    this.runRecords = [];
    this.settledRunIds = [];
    this.seenDialogueKeys = [];
    this._save();
  }

  /**
   * Read the per-slot clock floor CloudSync records on remote-newer conflicts.
   * Key derivation must match SlotManager.getMetaClockFloorKey(slot), which is
   * getMetaKey(slot) + '_clock_floor'; storageKey IS getMetaKey(slot) for slot
   * saves, so appending the suffix here stays in sync.
   */
  _readClockFloorSavedAt() {
    try {
      const raw = localStorage.getItem(`${this.storageKey}_clock_floor`);
      if (raw == null) return null;
      const value = Number(raw);
      return Number.isFinite(value) ? value : null;
    } catch (_) {
      return null;
    }
  }

  /**
   * If another writer (cloud fetch merge, fresh-local heal) has put a newer
   * payload on disk since this manager last read/wrote it, our in-memory state
   * is a stale lineage. Adopt the disk state via a conservative max-merge so a
   * fresh session can never erase restored progression by saving over it.
   */
  _adoptForeignDiskStateIfNewer() {
    let disk = null;
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (raw) disk = JSON.parse(raw);
    } catch (_) {
      return;
    }
    const diskSavedAt = Number(disk?.savedAt);
    if (!Number.isFinite(diskSavedAt) || diskSavedAt <= this.savedAt) return;

    this.totalValor = Math.max(this.totalValor, Math.floor(Number(disk.totalValor) || 0));
    this.totalSupply = Math.max(this.totalSupply, Math.floor(Number(disk.totalSupply) || 0));
    this.runsCompleted = Math.max(this.runsCompleted, Number(disk.runsCompleted) || 0);
    this.runsStarted = Math.max(
      this.runsStarted,
      Number(disk.runsStarted) || 0,
      this.runsCompleted,
    );
    // The tiers this copy did not hold: a disk payload from before a price rise bought them
    // at the old price (a copy at or past the revision priced its own).
    const ownedBefore = {};
    for (const { from } of BALANCE_REVISIONS)
      for (const id of Object.keys(from)) ownedBefore[id] = this.getUpgradeLevel(id);
    if (disk.purchasedUpgrades && typeof disk.purchasedUpgrades === 'object') {
      for (const [id, level] of Object.entries(disk.purchasedUpgrades)) {
        // The markers are read on their own; discoveries are unioned below, with the lists.
        if (isBalanceRevisionMarker(id) || isDiscoveryKey(id)) continue;
        const diskLevel = Number(level) || 0;
        const localLevel = Number(this.purchasedUpgrades[id]) || 0;
        this.purchasedUpgrades[id] = Math.max(localLevel, diskLevel);
      }
    }
    this.balanceRevision = Math.max(this.balanceRevision, settledBalanceRevision(disk));
    this._recordLegacyTierCosts(settledBalanceRevision(disk), (id) => {
      const part = (key) => Math.max(0, Math.floor(Number(disk.purchasedUpgrades?.[key]) || 0));
      return [(ownedBefore[id] || 0) + 1, part(id) + part(repeatTiersKey(id))];
    });
    // A tier bought before a price rise keeps its price, whichever copy recorded it; a tier
    // the merged levels no longer hold has no record.
    const diskLegacy = normalizeLegacyTierCosts(disk.legacyTierCosts);
    for (const [id, tiers] of Object.entries(diskLegacy))
      this.legacyTierCosts[id] = { ...tiers, ...this.legacyTierCosts[id] };
    for (const id of Object.keys(this.legacyTierCosts)) {
      for (const tier of Object.keys(this.legacyTierCosts[id]))
        if (Number(tier) > this.getUpgradeLevel(id)) delete this.legacyTierCosts[id][tier];
      if (Object.keys(this.legacyTierCosts[id]).length === 0) delete this.legacyTierCosts[id];
    }
    // A refund either copy paid stays paid; a retired key the merge brought back from
    // a stale copy is dropped again (and paid only if neither copy has refunded it).
    const diskRefunds = normalizeRetiredUpgradeRefunds(disk.retiredUpgradeRefunds);
    for (const [id, levels] of Object.entries(diskRefunds))
      this.retiredUpgradeRefunds[id] = Math.max(this.retiredUpgradeRefunds[id] || 0, levels);
    this._settleRetiredUpgrades();
    if (Array.isArray(disk.milestones)) {
      for (const m of disk.milestones) this.milestones.add(m);
    }
    if (disk.skillAssignments && typeof disk.skillAssignments === 'object') {
      for (const [lord, slots] of Object.entries(disk.skillAssignments)) {
        if (this.skillAssignments[lord] === undefined) this.skillAssignments[lord] = slots;
      }
      this.skillAssignments = exclusiveSkillAssignments(this.skillAssignments);
    }
    // Adopt-if-default: a still-default local selection takes the disk's picks.
    if (
      disk.lordSelection &&
      this.lordSelection.commander === DEFAULT_LORD_SELECTION.commander &&
      this.lordSelection.partner === DEFAULT_LORD_SELECTION.partner
    ) {
      this.lordSelection = normalizeLordSelection(disk.lordSelection);
    }
    if (Number(disk.hintState?.updatedAt) > Number(this.hintState?.updatedAt || 0))
      this.hintState = disk.hintState;
    this.runRecords = mergeRunRecords(this.runRecords, disk.runRecords || []);
    this.settledRunIds = mergeSettledRunIds(this.settledRunIds, disk.settledRunIds);
    this.seenDialogueKeys = mergeSeenDialogueKeys(
      this.seenDialogueKeys,
      disk.seenDialogueKeys || [],
    );
    this.deedsEarned = mergeDeedIds(this.deedsEarned, disk.deedsEarned);
    this.lordsMet = mergeLordNames(this.lordsMet, lordsMetOfMetaSave(disk));
    const seen = mergeDiscoveries(
      { items: this.itemsSeen, skills: this.skillsSeen },
      discoveriesOfMetaSave(disk),
    );
    this.itemsSeen = seen.items;
    this.skillsSeen = seen.skills;
    if (disk.storyFlags && typeof disk.storyFlags === 'object') {
      const diskFlags = normalizeStoryFlags(disk.storyFlags);
      // Counters are monotonic, so per-name max can only over-remember —
      // it can never resurrect a reverted event.
      for (const mapKey of ['bossSlain', 'defeatedBy', 'lordFalls']) {
        for (const [name, count] of Object.entries(diskFlags[mapKey])) {
          const local = Math.max(0, Math.floor(Number(this.storyFlags[mapKey][name]) || 0));
          this.storyFlags[mapKey][name] = Math.max(local, count);
        }
      }
      // Either copy may hold lines the other has not played yet; local is the newer.
      this.storyFlags.linesPlayed = mergeLinesPlayed(
        diskFlags.linesPlayed,
        this.storyFlags.linesPlayed,
      );
      const diskEndedAt = Number(diskFlags.lastRun?.endedAt) || 0;
      const localEndedAt = Number(this.storyFlags.lastRun?.endedAt) || 0;
      if (diskFlags.lastRun && diskEndedAt > localEndedAt) {
        this.storyFlags.lastRun = diskFlags.lastRun;
        this.storyFlags.lossStreak = diskFlags.lossStreak;
      }
      // A bag only the other copy has walked is kept; where both have one, local is newer.
      this.storyFlags.narrativeSeen = normalizeNarrativeSeen({
        ...diskFlags.narrativeSeen,
        ...this.storyFlags.narrativeSeen,
      });
    }
    if (isDifficultyId(disk.lastDifficulty)) this.lastDifficulty = disk.lastDifficulty;
    // The prologue: the further state wins and a paid grant stays paid, so the grant
    // can never be paid twice across devices or a cloud heal. A receipt is OR-ed here,
    // unlike the cloud fetch's whole-payload pick (reconcilePickedPrologue), because
    // this merge keeps both copies' economies (each currency and upgrade at its max):
    // a paid copy's grant is in the result, and an unpaid newer copy must not pay again.
    this.prologue = mergePrologueState(this.prologue, disk.prologue);
    // NG+: the copy changed more recently by its own count wins whole (NgPlusState.js).
    this.ngPlus = mergeNgPlusState(this.ngPlus, disk.ngPlus);
    // A newer build's keys: the newer disk copy's values win, ours stay where it has none.
    this.unknownFields = { ...this.unknownFields, ...unknownMetaFields(disk) };
    this.savedAt = diskSavedAt;
  }

  rememberDifficulty(id) {
    if (!isDifficultyId(id)) return { ok: false };
    return this._save({ lastDifficulty: id });
  }

  /**
   * Apply a finished run's payout as one write: currencies, completion
   * counters, milestones, narrative memory and the paid-run marker land on
   * disk together or not at all. The individual mutators' saves are deferred
   * while `apply` runs; if the single write fails, the in-memory state rolls
   * back so nothing reads as paid that is not on disk (the caller keeps the
   * run save and retries later).
   * @param {(meta: MetaProgressionManager) => void} apply
   * @returns {{ ok: boolean }}
   */
  applyRunPayout(apply) {
    const before = this._captureState();
    this._deferSaves = (this._deferSaves || 0) + 1;
    try {
      apply(this);
    } catch (err) {
      this._deferSaves -= 1;
      this._restoreState(before);
      throw err;
    }
    this._deferSaves -= 1;
    const result = this._save();
    if (!result.ok) this._restoreState(before);
    return result;
  }

  /**
   * Retry a quota-failed meta write with smaller victory archives (runRecordsUnderPressure);
   * the first that fits becomes the archive in memory too. False when none fits.
   */
  _writeWithLeanerRecords(payload, slot) {
    for (const records of runRecordsUnderPressure(this.runRecords)) {
      try {
        setItemFreeingSpace(this.storageKey, JSON.stringify({ ...payload, runRecords: records }), slot); // prettier-ignore
      } catch (err) {
        if (isQuotaExceededError(err)) continue;
        return false;
      }
      payload.runRecords = records;
      this.runRecords = records;
      console.warn(`[MetaProgression] storage full: victory records kept lean (${records.length})`);
      return true;
    }
    return false;
  }

  _captureState() {
    return structuredClone({
      totalValor: this.totalValor,
      totalSupply: this.totalSupply,
      purchasedUpgrades: this.purchasedUpgrades,
      retiredUpgradeRefunds: this.retiredUpgradeRefunds,
      legacyTierCosts: this.legacyTierCosts,
      runsCompleted: this.runsCompleted,
      runsStarted: this.runsStarted,
      lastDifficulty: this.lastDifficulty,
      skillAssignments: this.skillAssignments,
      lordSelection: this.lordSelection,
      milestones: [...this.milestones],
      storyFlags: this.storyFlags,
      runRecords: this.runRecords,
      settledRunIds: this.settledRunIds,
      seenDialogueKeys: this.seenDialogueKeys,
      deedsEarned: this.deedsEarned,
      lordsMet: this.lordsMet,
      itemsSeen: this.itemsSeen,
      skillsSeen: this.skillsSeen,
      hintState: this.hintState,
      prologue: this.prologue,
      ngPlus: this.ngPlus,
      savedAt: this.savedAt,
    });
  }

  _restoreState(state) {
    Object.assign(this, { ...state, milestones: new Set(state.milestones) });
  }

  _save({ lastDifficulty } = {}) {
    // Inside applyRunPayout: the payout's one write happens when it finishes.
    if (this._deferSaves > 0) return { ok: true, deferred: true };
    this._adoptForeignDiskStateIfNewer();
    if (isDifficultyId(lastDifficulty)) this.lastDifficulty = lastDifficulty;
    const floor = this._readClockFloorSavedAt();
    this.savedAt = Math.max(Date.now(), this.savedAt + 1, Number.isFinite(floor) ? floor + 1 : 0);
    const payload = {
      // First, so a key this build writes always wins over a stale copy of it.
      ...this.unknownFields,
      balanceRevision: this.balanceRevision,
      solRefundBasis: this.solRefundBasis,
      totalValor: this.totalValor,
      totalSupply: this.totalSupply,
      purchasedUpgrades: withBalanceRevisionMarker(
        withDiscoveryKeys(this.purchasedUpgrades, {
          items: this.itemsSeen,
          skills: this.skillsSeen,
        }),
        this.balanceRevision,
      ),
      retiredUpgradeRefunds: this.retiredUpgradeRefunds,
      legacyTierCosts: this.legacyTierCosts,
      runsCompleted: this.runsCompleted,
      runsStarted: this.runsStarted,
      lastDifficulty: this.lastDifficulty,
      skillAssignments: this.skillAssignments,
      lordSelection: this.lordSelection,
      milestones: [...this.milestones],
      storyFlags: this.storyFlags,
      runRecords: this.runRecords,
      settledRunIds: this.settledRunIds,
      seenDialogueKeys: this.seenDialogueKeys,
      deedsEarned: this.deedsEarned,
      lordsMet: this.lordsMet,
      hintState: this.hintState,
      prologue: normalizePrologueState(this.prologue),
      ngPlus: this.ngPlus,
      savedAt: this.savedAt,
    };
    let localOk = false;
    // On a full store, other slots' optional battle history makes room first.
    const slot = Number(/^emblem_rogue_slot_(\d+)_meta$/.exec(this.storageKey)?.[1]) || null;
    try {
      setItemFreeingSpace(this.storageKey, JSON.stringify(payload), slot);
      localOk = true;
    } catch (err) {
      // Still full: the victory records give way (lean, then oldest first) before the
      // save does, so a payout or an upgrade never waits on the archive's detail.
      if (isQuotaExceededError(err)) localOk = this._writeWithLeanerRecords(payload, slot);
      if (!localOk)
        console.warn('[MetaProgression] localStorage write failed:', err?.message || err);
    }

    if (localOk && this.onSave) {
      try {
        this.onSave(payload);
      } catch (err) {
        console.warn('[MetaProgression] onSave callback error:', err?.message || err);
      }
    }

    return { ok: localOk };
  }
}

/**
 * Calculate currencies earned from a run.
 * Both currencies earn at the same rate (intentionally doubles effective spending power).
 * @param {number} actIndex - 0-based act reached
 * @param {number} completedBattles - total battles won
 * @param {boolean} isVictory - whether the run was won
 * @param {number} [currencyMultiplier=1] - run difficulty currency multiplier
 * @returns {{ valor: number, supply: number }}
 */
export function calculateCurrencies(actIndex, completedBattles, isVictory, currencyMultiplier = 1) {
  const multiplier = Number.isFinite(currencyMultiplier) ? currencyMultiplier : 1;
  const valorBase =
    actIndex * VALOR_PER_ACT +
    completedBattles * VALOR_PER_BATTLE +
    (isVictory ? VALOR_VICTORY_BONUS : 0);
  const supplyBase =
    actIndex * SUPPLY_PER_ACT +
    completedBattles * SUPPLY_PER_BATTLE +
    (isVictory ? SUPPLY_VICTORY_BONUS : 0);
  const valor = Math.floor(valorBase * multiplier);
  const supply = Math.floor(supplyBase * multiplier);
  return { valor, supply };
}
