import { skipsClassProgression, normalizeSpecialCharacter } from './SpecialCharacterPolicy.js';
import { createVeteranKnight } from './SpecialCharacters.js';
import { validateBattleState } from './BattleStateSnapshot.js';
import { migrateSavedItemNames, ITEM_NAMES_REVISION } from './ItemNameMigration.js';
import { migrateSavedGamblerCoins } from './AccessoryCatalogMigration.js';
import { migrateSavedPerBattleWeapons } from './WeaponCatalogMigration.js';
import { hydrateBattleTimeline } from './BattleTimeline.js';
import { pickFresh } from '../utils/pickFresh.js';
import { applyRevivalCatchUp } from './RevivalCatchUp.js';
import { migrateUnitTraits, rollAndApplyLordTrait } from './TraitSystem.js';
import {
  applyFallenBattleRecord,
  findFallenBattleRecord,
  normalizeUnitDeeds,
} from './DeedSystem.js';
import { RUN_RECORD_VERSION, fallenForRecord, fallenRecord, survivorRecord } from './RunRecords.js';
import { migrateWaitingOath } from './SkillLoadout.js';
import { normalizeDeploymentNames } from './DeploymentSelection.js';
import { restrictOpeningCavaliers } from './EarlyEnemyRules.js';
// RunManager.js — Pure class: run state (roster, node map, act progression, unit serialization)
// No Phaser deps.

import {
  ACT_SEQUENCE,
  ACT_CONFIG,
  STARTING_GOLD,
  MAX_SKILLS,
  STARTING_ACCESSORY_TIERS,
  STARTING_STAFF_TIERS,
  DEADLY_ARSENAL_SIGNATURE_WEAPONS,
  ELITE_GOLD_MULTIPLIER,
  XP_STAT_NAMES,
  CONVOY_WEAPON_CAPACITY,
  CONVOY_CONSUMABLE_CAPACITY,
  CONVOY_WEAPON_TYPES,
  RECRUIT_SKILL_POOL,
  REVIVE_BASE_COST,
  REVIVE_COST_PER_LEVEL,
  REVIVE_PROMOTION_MULTIPLIER,
  RUINS_PATHS,
  INVENTORY_MAX,
} from '../utils/constants.js';
import { calculateBattleGold } from './LootSystem.js';
import { reconcileRecruitSpawnTile, sanitizeEscapeTilePassability } from './MapGenerator.js';
import { calculateCurrencies } from './MetaProgressionManager.js';
import { lordNamesInRun } from './LordsMet.js';
import { generateNodeMap } from './NodeMapGenerator.js';
import {
  createLordUnit,
  createRecruitUnit,
  promoteUnit,
  addToInventory,
  addToConsumables,
  equipAccessory,
  unequipAccessory,
  settleAccessoryHpOwed,
  canEquip,
  getClassInnateSkills,
  normalizeUnitClassState,
  grantLethalArmoryWeapon,
  grantMasterOfArmsWeapons,
  applyRecruitWeaponForge,
  grantRecruitStartingAccessory,
  learnSkill,
  benchedSkillsOf,
  knowsSkill,
  LETHAL_ARMORY_WEAPONS,
  equipWeapon,
  normalizeEquippedFirst,
  grantReviveStarterWeapon,
} from './UnitManager.js';
import { applyForge, canForge, canForgeStat, deforgeWeapon } from './ForgeSystem.js';
import { signatureWeaponFor } from './SignatureWeapons.js';
import { generateRandomLegendary } from './LootSystem.js';
import { getActiveSlot, getRunClockFloorKey, getRunKey, MAX_SLOTS } from './SlotManager.js';
import { isQuotaExceededError, setItemFreeingSpace } from './SaveSpace.js';
import { markStartup } from '../utils/startupTelemetry.js';
import {
  buildBlessingIndex,
  createSeededRng,
  rollCostForBlessing,
  rollPriceForBlessing,
  selectBlessingOptionsWithTelemetry,
  usesPriceCatalog,
} from './BlessingEngine.js';
import {
  resolveDifficultyMode,
  DIFFICULTY_DEFAULTS,
  ENEMY_ACT_GATE_ORDER,
  difficultyVictoryMilestone,
  recruitAffixesAllowed,
} from './DifficultyEngine.js';
import { hasRevivalStones } from './RevivalStones.js';
import { assignPortraitVariants, backfillPortraitVariants } from './PortraitVariants.js';
import {
  normalizeWeaponArtBinding,
  getWeaponArtBindings,
  getWeaponArtAllowedTypes,
  parsePlayerWeaponArtBoon,
} from './WeaponArtSystem.js';
import { ensureItemUid } from '../utils/itemUid.js';
import { restorePendingBossRecruit } from './PendingBossRecruit.js';
import { restorePendingThirdLord } from './PendingThirdLord.js';
import { UNIT_PRESENTATION_FIELDS } from './BattleUnitState.js';
import {
  RECRUIT_PREVIEW_VERSION,
  isRecruitBattleNode,
  buildRecruitNodeUnit,
  ensureRecruitAlternates,
  ensureRecruitPreviews,
  resolveRecruitNodeSpawnClass,
  swapRecruitAlternate,
} from './RecruitNodeSystem.js';
import {
  applyArcsOnActEntry,
  revertArcDipsForExpiredAct,
  sanitizeLordStatArcs,
  startLordStatArc,
} from './LordStatArc.js';
import { parseBattleGoldGamble, settleBattleGoldGamble } from './BattleGoldGamble.js';
import {
  actBossPickDue,
  earnedBlessingsOf,
  isActBossVictory,
  prepareEarnedBlessingPick,
  sanitizeEarnedBlessingPicks,
} from './EarnedBlessings.js';
import {
  parseAdjacentAllyDefBonus,
  parseIsolatedCombatBonus,
  sanitizeAdjacentAllyDefBonuses,
  sanitizeIsolatedCombatBonuses,
} from './FormationBlessings.js';
import {
  formatUnitUid,
  resolveBattleCasualties,
  unitUidNumber,
  unitUidOf,
} from './UnitIdentity.js';
import {
  applyEclipse,
  beginActShadow,
  buildEclipseView,
  commitShadow,
  computeShadowGain,
  createEclipseState,
  eclipseBattleMods,
  eclipseHash,
  isEclipseActive,
  kindleResult,
  normalizeEclipseState,
} from './EclipseSystem.js';
import {
  findCommander,
  stampCommanderFlag,
  resolveStartingLordNames,
  resolveStartingLordDefs,
  DEFAULT_STARTING_LORD_NAMES,
} from './Commander.js';
import { unitBaseClassName } from './ClassLineage.js';
import { applyRecruitJoinBonus } from './RecruitScaling.js';
import { healUnitFully, setUnitHP } from './UnitHealth.js';
import { PROLOGUE_RUN_MODE, STANDARD_RUN_MODE, isPrologueRun } from './ScriptedBattle.js';
import { VULNERARY_NAME, consumableCatalogFor, consumableTemplateFor } from './VulneraryRecipe.js';
import {
  PROLOGUE_ACT_ID,
  buildPrologueBattleConfig,
  buildPrologueNodeMap,
  buildPrologueUnits,
  isSpecialRosterKey,
  prologueChapterForNode,
  prologueJoinsAtNode,
} from './Prologue.js';
import { normalizeRosterLesson } from './PrologueRosterLesson.js';
import {
  hasDarkOmen,
  eventSpoilsOwedAt,
  sanitizeEventLog,
  sanitizeEventStates,
  sanitizeLaidToRest,
  sanitizeStoryFlags,
} from './EventSystem.js';
import {
  addBurden,
  battleDebuffsFor,
  burdenEffectsOnVictory,
  WOUND_STATS,
  huntedWaveFor,
  isSwornEnemy,
  normalizeBurdens,
  pruneGoneWounds,
} from './Burdens.js';
import { isHuntedBattle } from './HuntedWave.js';
import { contractRewardOwedAt, normalizeContract, normalizeContractOwed } from './Contracts.js';
import { settleContract } from './ContractSettlement.js';
import { everFallenUnits } from './LaidToRest.js';
import { stampExtraShops } from './ExtraShopPass.js';
import { BLESSING_BOON_REVISION, migrateHeldBlessingBoons } from './BlessingBoonMigration.js';
import { normalizeChurchVows } from './ChurchVow.js';
import {
  applyShrineBoon,
  createShrineBoonModifiers,
  lateBloomStats,
  moveTypeBattleDeltas,
  sanitizeShrineBoonModifiers,
  shrineBoonsOf,
} from './ShrineBoons.js';
import { createSpecialCharacter } from './SpecialCharacters.js';

// Phaser-specific fields that must be stripped for serialization
const PHASER_FIELDS = UNIT_PRESENTATION_FIELDS;
const WEAPON_ART_SPAWN_TIERS = new Set(['Iron', 'Steel', 'Silver']);
const WEAPON_ART_SPAWN_WEAPON_TYPES = new Set(['Sword', 'Lance', 'Axe', 'Bow', 'Tome', 'Light']);
const KNOWN_ACT_IDS = new Set(Object.keys(ACT_CONFIG));
const EXTRA_STARTER_CLASS_POOLS = {
  1: ['Archer'],
  2: ['Archer', 'Knight'],
  3: ['Archer', 'Knight', 'Cavalier'],
  4: ['Archer', 'Knight', 'Cavalier', 'Paladin'],
};

/**
 * The locked battle maps a run still needs: those of nodes on its route map (and of the
 * battle in progress). A locked map is read only for a node of the current map or the
 * battle in progress (getLockedBattleConfig, getLockedSpawnCount, completeBattle's Hunted
 * check, the recruit previews, the caravan tag, RouteEdit.isRedrawable, the slot card's
 * template); node ids carry the act (NodeMapGenerator: `${actId}_${row}_${col}`, and a
 * run's act list holds each act once), so an earlier act's maps are dead weight in every
 * save after it. Pure: returns a new object, never mutates `configs`. With no route map
 * to judge by (a damaged save) everything is kept.
 * @param {Record<string, object>|null|undefined} configs
 * @param {{ nodes?: Array<{ id?: string }> }|null|undefined} nodeMap
 * @param {{ keepNodeId?: string|null }} [options]
 * @returns {Record<string, object>}
 */
export function pruneLockedBattleConfigs(configs, nodeMap, { keepNodeId = null } = {}) {
  if (!configs || typeof configs !== 'object' || Array.isArray(configs)) return {};
  const nodes = nodeMap?.nodes;
  if (!Array.isArray(nodes) || nodes.length === 0) return configs;
  const live = new Set(nodes.map((node) => node?.id).filter((id) => typeof id === 'string'));
  if (typeof keepNodeId === 'string') live.add(keepNodeId);
  const kept = {};
  for (const [nodeId, config] of Object.entries(configs)) {
    if (live.has(nodeId)) kept[nodeId] = config;
  }
  return kept;
}

function sanitizeActSequence(sequence, fallback = ACT_SEQUENCE) {
  const source = Array.isArray(sequence) ? sequence : fallback;
  const normalized = source.filter(
    (actId) => typeof actId === 'string' && KNOWN_ACT_IDS.has(actId),
  );
  if (normalized.length > 0) return [...new Set(normalized)];
  return [...fallback.filter((actId) => KNOWN_ACT_IDS.has(actId))];
}

export function getActTransitionKey(fromAct, toAct) {
  if (fromAct === 'act3' && toAct === 'finalBoss') return 'act3_to_finalBoss_normal';
  // After the Emperor falls, the ground wakes: the descent to the Entity.
  if (fromAct === 'act4' && toAct === 'finalBoss') return 'finalBoss_to_secretAct';
  return `${fromAct}_to_${toAct}`;
}

/** Transition scenes that play straight after another, in order (under its once-gate). */
export function getActTransitionFollowUps(transKey) {
  return transKey === 'finalBoss_to_secretAct' ? ['secretAct_start'] : [];
}

function getConvoyBucket(item) {
  if (!item || typeof item !== 'object') return null;
  if (item.type === 'Consumable') return 'consumables';
  if (CONVOY_WEAPON_TYPES.has(item.type)) return 'weapons';
  return null;
}

/**
 * Every item a unit holds in its bags, plus an equipped weapon a corrupt legacy save
 * left outside its inventory (matched by identity, then uid), each once.
 */
function caravanCarriedItems(unit) {
  const inventory = Array.isArray(unit?.inventory) ? unit.inventory.filter(Boolean) : [];
  const consumables = Array.isArray(unit?.consumables) ? unit.consumables.filter(Boolean) : [];
  const items = [...inventory, ...consumables];
  const equipped = unit?.weapon;
  if (equipped && typeof equipped === 'object' && !items.includes(equipped)) {
    const uid = typeof equipped.uid === 'string' ? equipped.uid : '';
    if (!uid || !items.some((item) => item?.uid === uid)) items.push(equipped);
  }
  return items;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// The Ruins' chosen paths from a save: keep only known paths on string node ids.
function sanitizeRuinsChoices(raw) {
  const out = {};
  if (!isPlainObject(raw)) return out;
  for (const [nodeId, path] of Object.entries(raw))
    if (nodeId && RUINS_PATHS.includes(path)) out[nodeId] = path;
  return out;
}

// A church's vow: one vow (a string, as every save before Twin Chapel), or the distinct vows
// made there (an array, once Twin Chapel's second vow is made). A one-vow list is kept a string.
function sanitizeChurchVows(raw) {
  const out = {};
  if (!isPlainObject(raw)) return out;
  for (const [nodeId, entry] of Object.entries(raw)) {
    if (!nodeId) continue;
    const vows = normalizeChurchVows(entry);
    if (vows.length === 1) out[nodeId] = vows[0];
    else if (vows.length > 1) out[nodeId] = vows;
  }
  return out;
}

function createBlessingRuntimeModifiers() {
  return {
    battleGoldMultiplierDelta: 0,
    deployCapDelta: 0,
    actHitBonusByAct: {},
    actStatDeltaAllUnits: [],
    skipFirstShop: false,
    shopItemCountDelta: 0,
    allGrowthsDelta: 0,
    allGrowthsDeltas: [],
    targetedGrowthsDeltas: [],
    disablePersonalSkillsUntilAct: null,
    blockedPersonalSkillsByUnit: {},
    xpMultiplierDelta: 0,
    forgeCostDiscount: 0,
    forgeLimitDelta: 0,
    shopPriceDiscount: 0,
    recruitLevelBonus: 0,
    // Keen Eye: Hit on the first strike of every combat a unit starts. Hold the Line: DEF and
    // Avoid for a unit that has not moved this turn (engine/BlessingCombatMods.js).
    firstStrikeHitBonus: 0,
    stationaryCombatBonus: { defBonus: 0, avoidBonus: 0 },
    // Phalanx Rite: `[{ perAlly, max }]`, DEF per ally on a cardinal neighbour tile. Duelist's
    // Creed: `[{ radius, avoidBonus, critBonus }]`, while no ally is within the radius. One
    // entry per grant; both read through engine/FormationBlessings.js.
    adjacentAllyDefBonuses: [],
    isolatedCombatBonuses: [],
    healingEffectivenessMultiplier: 1,
    weaponArtHpCostDelta: 0,
    // Bloodless Art (`player_weapon_art_boon`): player units' weapon arts cost this much HP
    // more (negative = less, floor 1) and get this many extra uses per map. Player units only,
    // unlike the price delta above; read through WeaponArtSystem.weaponArtRunOptions.
    playerArtHpCostDelta: 0,
    playerArtMapUsesBonus: 0,
    enemyLevelDeltas: [],
    // v3 prices (docs/specs/blessings-v3.md §3): a deploy cap change in one act, and no
    // church revives for the run.
    deployCapDeltaByAct: {},
    churchReviveDisabled: false,
    // Grants a blessing pays as each act begins (Advance Pay's gold, Quartermaster Cache's
    // Elixir, Second Dawn's Vision, Late Bloom's stats): `{ blessingId, kind: 'gold'|'vision'|'army_stats'|'item', value?, stats?, itemName?, count?, paidActs }`.
    // `paidActs` is what makes a grant pay once per act, however often a save is loaded.
    actStartGrants: [],
    // Smith's Mark: how many forge uses (a forge or a repair) a shop gives free, counted from
    // each shop's first. Pilgrim's Road: shops each act's route gains (engine/ExtraShopPass.js).
    freeForgesPerShop: 0,
    extraShopsPerAct: 0,
    // Slow Fuse: the starting lords' dip-then-rise stat arcs (engine/LordStatArc.js).
    lordStatArcs: [],
    // Gambler's Toss: `{ chance, win, lose }` while held (engine/BattleGoldGamble.js).
    battleGoldGamble: null,
    // The rest of the §5 starting blessings (Dawn Tithe, Cavalier's Hour, Saint's Reserve,
    // Cutpurse's Luck, Open Roll, Watcher's Grace, Patient Dawn, Twin Chapel, Omen Reader,
    // Lottery Loot): engine/ShrineBoons.js owns their fields and their load defaults.
    ...createShrineBoonModifiers(),
    // Earned blessings (docs/specs/blessings-v3.md §6): how many allies the Unbroken Banner
    // saves per battle, the HP the Ember Lantern's first kill heals and the MOV the Captain's
    // Whistle gives on turn 1. Read through getBattleBlessingEffects; the battle reads them
    // once. Second Dawn's Vision is an act-start grant (`kind: 'vision'`), not a modifier.
    battleLastStand: 0,
    firstKillHeal: 0,
    firstTurnMovDelta: 0,
  };
}

// Earned boon type -> the runtime modifier it raises (each takes a positive integer `value`).
const EARNED_BOON_MODIFIERS = Object.freeze({
  battle_last_stand: 'battleLastStand',
  first_kill_heal: 'firstKillHeal',
  first_turn_mov_delta: 'firstTurnMovDelta',
});

/**
 * A saved act-start grants list, field by field: a grant is gold, Vision or an item, with a
 * whole positive amount, and a list of the acts it has already paid. Anything else is dropped.
 */
function sanitizeActStartGrants(list) {
  if (!Array.isArray(list)) return [];
  const grants = [];
  for (const entry of list) {
    if (!isPlainObject(entry) || typeof entry.blessingId !== 'string' || !entry.blessingId)
      continue;
    const paidActs = Array.isArray(entry.paidActs)
      ? [...new Set(entry.paidActs.filter((act) => typeof act === 'string' && act))]
      : [];
    if (entry.kind === 'gold' || entry.kind === 'vision') {
      // Gold (Advance Pay) or Vision (Second Dawn).
      const value = Math.trunc(Number(entry.value));
      if (value > 0)
        grants.push({ blessingId: entry.blessingId, kind: entry.kind, value, paidActs });
    } else if (entry.kind === 'army_stats') {
      // Late Bloom: +value in each unit's `stats` strongest growths (a grant saved without the
      // count gave every stat but Move, so it reads as all eight).
      const value = Math.trunc(Number(entry.value));
      const count = Math.trunc(Number(entry.stats));
      const stats = count >= 1 && count <= XP_STAT_NAMES.length ? count : XP_STAT_NAMES.length;
      if (value > 0)
        grants.push({ blessingId: entry.blessingId, kind: 'army_stats', value, stats, paidActs });
    } else if (entry.kind === 'item') {
      const count = Math.trunc(Number(entry.count));
      if (typeof entry.itemName === 'string' && entry.itemName && count > 0)
        grants.push({
          blessingId: entry.blessingId,
          kind: 'item',
          itemName: entry.itemName,
          count,
          paidActs,
        });
    }
  }
  return grants;
}

function getBlessingEntryId(entry) {
  if (typeof entry === 'string') {
    const id = entry.trim();
    return id.length > 0 ? id : null;
  }
  if (!isPlainObject(entry) || typeof entry.id !== 'string') return null;
  const id = entry.id.trim();
  return id.length > 0 ? id : null;
}

function normalizeBlessingCostEntry(costEntry) {
  if (!isPlainObject(costEntry)) return null;
  const label = typeof costEntry.label === 'string' ? costEntry.label.trim() : '';
  if (!label) return null;
  // A v3 price says whether it was the blessing's pact (the held list names it so), or its
  // intrinsic price (the boon carries the cost: no effects of its own to apply).
  if (costEntry.kind === 'intrinsic') return { label, effects: [], kind: 'intrinsic' };
  const kind = costEntry.kind === 'pact' ? 'pact' : null;
  if (!Array.isArray(costEntry.effects) || costEntry.effects.length <= 0) return null;
  const effects = [];
  for (const effect of costEntry.effects) {
    if (!isPlainObject(effect)) continue;
    const type = typeof effect.type === 'string' ? effect.type.trim() : '';
    if (!type) continue;
    if (!isPlainObject(effect.params)) continue;
    effects.push({ type, params: { ...effect.params } });
  }
  if (effects.length <= 0) return null;
  return kind ? { label, effects, kind } : { label, effects };
}

/** A blessing's intrinsic price as a stored price entry (no effects: the boon carries it). */
function intrinsicCostOf(blessing) {
  return normalizeBlessingCostEntry(
    isPlainObject(blessing?.intrinsicPrice)
      ? { label: blessing.intrinsicPrice.label, effects: [], kind: 'intrinsic' }
      : null,
  );
}

/**
 * One held blessing: `{ id, rolledCost }`, plus `midRun: true` for one taken after the run
 * began (a church vow, an event). A mid-run blessing never carries a price: its boons apply
 * and nothing is charged, so a load must not invent one for it.
 */
function createActiveBlessingEntry(id, rolledCost = null, { midRun = false } = {}) {
  const blessingId = typeof id === 'string' ? id.trim() : '';
  if (!blessingId) return null;
  if (midRun) return { id: blessingId, rolledCost: null, midRun: true };
  return {
    id: blessingId,
    rolledCost: normalizeBlessingCostEntry(rolledCost),
  };
}

function legacyItemSignature(item) {
  if (!item || typeof item !== 'object') return JSON.stringify(item);
  const clone = structuredClone(item);
  delete clone.uid;
  return JSON.stringify(clone);
}

/** After JSON round-trip, re-link unit.weapon to matching inventory reference.
 *  Enforces proficiency: drops non-proficient equipped weapons to first valid or null. */
export function relinkWeapon(unit) {
  if (!unit.weapon || !unit.inventory?.length) {
    if (!unit.inventory?.length) unit.weapon = null;
    return;
  }
  // If weapon is already in inventory AND proficient, keep it
  if (unit.inventory.includes(unit.weapon) && canEquip(unit, unit.weapon)) return;
  // Prefer stable UID matching for modern saves.
  const uid = typeof unit.weapon.uid === 'string' ? unit.weapon.uid : '';
  if (uid) {
    const uidMatch = unit.inventory.find((w) => w?.uid === uid && canEquip(unit, w));
    if (uidMatch) {
      unit.weapon = uidMatch;
      return;
    }
  }
  // Legacy fallback for old saves without UIDs.
  const weaponSig = legacyItemSignature(unit.weapon);
  const match = unit.inventory.find(
    (w) => legacyItemSignature(w) === weaponSig && canEquip(unit, w),
  );
  // Fallback: first proficient weapon in inventory
  unit.weapon = match || unit.inventory.find((w) => canEquip(unit, w)) || null;
}

function stampUnitItemUids(unit) {
  if (!unit || typeof unit !== 'object') return;
  if (Array.isArray(unit.inventory)) unit.inventory.forEach(ensureItemUid);
  if (Array.isArray(unit.consumables)) unit.consumables.forEach(ensureItemUid);
  if (unit.weapon && typeof unit.weapon === 'object') ensureItemUid(unit.weapon);
  if (unit.accessory && typeof unit.accessory === 'object') ensureItemUid(unit.accessory);
}

function parsePersonalSkillId(personalSkillStr) {
  if (!personalSkillStr) return null;
  const colonIdx = personalSkillStr.indexOf(':');
  const name = colonIdx > 0 ? personalSkillStr.slice(0, colonIdx).trim() : personalSkillStr.trim();
  return name.toLowerCase().replace(/\s+/g, '_');
}

/**
 * Strip Phaser display objects from a unit, reset per-battle flags.
 */
export function serializeUnit(unit) {
  const data = { ...unit };
  delete data.battleEntityId;
  delete data.equippedInventoryIndex;
  delete data._lastAiDecision; // transient target references can contain Phaser objects
  if (unit?.stats && typeof unit.stats === 'object') {
    data.stats = { ...unit.stats };
  }
  // Deep-clone mutable collection fields to prevent shared-reference mutations
  if (Array.isArray(data.inventory))
    data.inventory = data.inventory.map((i) => ensureItemUid(structuredClone(i)));
  if (Array.isArray(data.skills)) data.skills = [...data.skills];
  if (Array.isArray(data.consumables))
    data.consumables = data.consumables.map((c) => ensureItemUid(structuredClone(c)));
  if (Array.isArray(data.proficiencies))
    data.proficiencies = data.proficiencies.map((p) => ({ ...p }));
  if (data.accessory) data.accessory = ensureItemUid(structuredClone(data.accessory));
  if (data.deeds && typeof data.deeds === 'object') data.deeds = structuredClone(data.deeds);
  // Relink weapon to cloned inventory item (preserves identity invariant)
  if (data.weapon && Array.isArray(data.inventory) && Array.isArray(unit.inventory)) {
    const weaponUid = typeof unit.weapon?.uid === 'string' ? unit.weapon.uid : '';
    let origIdx = weaponUid ? data.inventory.findIndex((w) => w?.uid === weaponUid) : -1;
    if (origIdx < 0) origIdx = unit.inventory.indexOf(unit.weapon);
    if (origIdx < 0) {
      const weaponSig = legacyItemSignature(unit.weapon);
      origIdx = unit.inventory.findIndex((w) => legacyItemSignature(w) === weaponSig);
    }
    if (origIdx >= 0 && origIdx < data.inventory.length) {
      data.weapon = data.inventory[origIdx];
      // Run-level saves keep the FE invariant: equipped weapon first.
      normalizeEquippedFirst(data);
    } else {
      // Weapon not in inventory (legacy/edge case) — deep-clone independently
      data.weapon = ensureItemUid(structuredClone(unit.weapon));
    }
  } else if (data.weapon) {
    data.weapon = ensureItemUid(structuredClone(unit.weapon));
  }
  for (const key of PHASER_FIELDS) data[key] = null;
  data.hasMoved = false;
  data.hasActed = false;
  data._miracleUsed = false;
  data._phoenixBroochUsed = false;
  const timedBuffStats = unit?._battleTimedWeaponArtAppliedStats;
  if (timedBuffStats && data.stats && typeof data.stats === 'object') {
    for (const [rawStat, rawValue] of Object.entries(timedBuffStats)) {
      const stat = typeof rawStat === 'string' ? rawStat.trim().toUpperCase() : '';
      if (!stat) continue;
      const value = Math.trunc(Number(rawValue) || 0);
      if (value === 0) continue;
      data.stats[stat] = (data.stats[stat] || 0) - value;
      if (stat === 'MOV') data.stats[stat] = Math.max(1, data.stats[stat] || 1);
      else data.stats[stat] = Math.max(0, data.stats[stat] || 0);
    }
    if (Object.prototype.hasOwnProperty.call(data.stats, 'MOV')) {
      data.mov = data.stats.MOV;
    }
  }
  delete data._battleDeltas;
  delete data._battleWeaponArtUsage;
  delete data._battleAbilityUsage;
  delete data._speedtakerStacks;
  delete data._battleTimedWeaponArtBuffs;
  delete data._battleTimedWeaponArtAppliedStats;
  delete data._battleTimedWeaponArtAppliedCombatMods;
  delete data._movementSpent;
  delete data._turnAnchor;
  delete data._legendaryGraceTurn;
  delete data._fortHealStreak;
  // Deed progress commits at victory (commitBattleDeeds) or not at all.
  delete data._battleDeeds;
  delete data._slewAllies;
  return data;
}

function ensureSeraBaseStaffProficiency(unit) {
  if (!unit || unit.name !== 'Sera' || unit.className !== 'Light Sage') return;
  if (!Array.isArray(unit.proficiencies)) unit.proficiencies = [];
  if (unit.proficiencies.some((p) => p.type === 'Staff')) return;
  unit.proficiencies.push({ type: 'Staff', rank: 'Prof' });
}

/** Vision charges a run starts with, given the meta `visionChargesBonus` (base 1). */
export function baseVisionChargesFor(visionChargesBonus = 0) {
  return Math.max(1, 1 + Math.trunc(Number(visionChargesBonus) || 0));
}

/** Legendary lord trait chance for a new run, given the meta bonus (5% base, 15% cap). */
export function legendaryLordChanceFor(legendaryLordChanceBonus = 0) {
  return Math.min(0.15, 0.05 + Math.max(0, Number(legendaryLordChanceBonus) || 0));
}

/** Calculate level-scaled revive cost for a fallen unit. */
export function getReviveCost(unit) {
  const raw = Number(unit?.level);
  const level = Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 1;
  const base = REVIVE_BASE_COST + level * REVIVE_COST_PER_LEVEL;
  return Math.round(unit?.tier === 'promoted' ? base * REVIVE_PROMOTION_MULTIPLIER : base);
}

/**
 * Restore a run's entry-time state from its battle flag (Continue from Map, and the
 * prologue's restart): convoy, accessories, gold, Vision, RNG, then the flag cleared.
 * A function of the run, not a method, so a borrowed `revertBattleInProgressToEntry`
 * works on any run-shaped object.
 */
function applyBattleEntryRevert(run, flag) {
  const patch = battleEntryRevertPatch(flag);
  if (patch.convoy) run.convoy = patch.convoy;
  if (patch.accessories) run.accessories = patch.accessories;
  if (patch.gold !== undefined) run.gold = patch.gold;
  if (patch.visionChargesRemaining !== undefined)
    run.visionChargesRemaining = patch.visionChargesRemaining;
  if (patch.visionCount !== undefined) run.visionCount = patch.visionCount;
  if (patch.rngSeed !== undefined) run.rngSeed = patch.rngSeed;
  if (patch.prologueVisionGranted !== undefined)
    run.prologueVisionGranted = patch.prologueVisionGranted;
  if (patch.removeConvoyUid) run.removeFromConvoyByUid(patch.removeConvoyUid);
  run.battleInProgress = null;
  return true;
}

export class RunManager {
  /**
   * @param {{ lords, classes, weapons, skills, terrain, mapSizes, mapTemplates, enemies }} gameData
   * @param {object|null} metaEffects - active effects from MetaProgressionManager
   */
  constructor(gameData, metaEffects = null) {
    this.gameData = gameData;
    this.metaEffects = metaEffects;
    this.legendaryLordChance = 0; // Legacy runs retain their original rules.
    // 'standard' | 'prologue': the prologue (the first thread) is a run that never
    // counts (docs/specs/prologue-chapter.md §9); saves from before it are standard.
    this.mode = STANDARD_RUN_MODE;
    // The prologue's one Vision charge (P3's exercise) was granted (grantPrologueVision).
    this.prologueVisionGranted = false;
    // The row-2 roster lesson's ledger (engine/PrologueRosterLesson.js).
    this.prologueRosterLesson = null;
    this.status = 'active'; // 'active' | 'victory' | 'defeat'
    this.actIndex = 0;
    this.roster = [];
    this.lastDeployment = [];
    this.fallenUnits = []; // Serialized units that died in battle
    // Run-scoped unit identity counter (UnitIdentity.js): the next `unitUid` is
    // `ru${nextUnitUid}`. Saved with the run; never drawn from Math.random.
    this.nextUnitUid = 1;
    this.nodeMap = null;
    this.currentNodeId = null; // last completed node (null = start of act)
    this.completedBattles = 0;
    this.gold = STARTING_GOLD + (metaEffects?.goldBonus || 0);
    this.accessories = []; // team accessory pool (unequipped accessories)
    this.scrolls = []; // team scroll pool (skill teaching items)
    this.convoy = { weapons: [], consumables: [] };
    this.activeBlessings = [];
    this.blessingHistory = [];
    this.blessingSelectionTelemetry = null;
    this.blessingRuntimeModifiers = createBlessingRuntimeModifiers();
    // Which blessing-boon rules this run's saved numbers follow (BlessingBoonMigration.js):
    // a new run is current, fromJSON reads the save's own.
    this.blessingBoonRevision = BLESSING_BOON_REVISION;
    this._runStartBlessingsApplied = false;
    this.runSeed = null;
    this.narrativeSeen = {};
    this.runRecordId = null;
    this.totalTurns = 0;
    this.rngSeed = null;
    this.visionChargesRemaining = 1;
    this.visionCount = 0;
    this.usedRecruitNames = {}; // Track used names per class: { Fighter: ['Galvin', 'Bjorn'] }
    this.battleConfigsByNodeId = {};
    this.shopStateByNodeId = {};
    // The Ruins' one path per node ('rest' | 'scavenge'); see RuinsCommands.js.
    this.ruinsChoiceByNodeId = {};
    // Each church's one vow ('promote' | 'blessing'); see ChurchVow.js.
    this.churchVowByNodeId = {};
    // Story Events (engine/EventCommands.js, docs/specs/event-nodes.md §4): the event each
    // node holds and what was chosen there (reset per act), the run-long log, the story
    // flags events write, the burdens they leave (engine/Burdens.js), the event node whose
    // won battle still owes its spoils, and the allies laid to rest (never revivable).
    this.eventStateByNodeId = {};
    this.eventLog = [];
    this.storyFlags = {};
    this.burdens = [];
    this.pendingEventNodeId = null;
    this.laidToRest = [];
    this.lastBurdenSettlement = null;
    // Gambler's Toss: the last victory's toss, for the victory band (not saved).
    this.lastBattleGoldGamble = null;
    // Earned blessings: the per-act pick ledger (engine/EarnedBlessings.js), and Second Dawn's
    // act-start line for the route map, read once (not saved).
    this.earnedBlessingPicks = {};
    // The open contract (engine/Contracts.js: a goal for the next battle), the settlement it
    // earned and has not yet delivered (`contractOwed`, saved: judged once, owed until paid or
    // a reward is given up) and what the last settlement said, for the victory band (not saved,
    // like lastBurdenSettlement).
    this.contract = null;
    this.contractOwed = null;
    this.lastContractSettlement = null;
    this.difficultyId = 'normal';
    this.difficultyModifiers = {
      ...DIFFICULTY_DEFAULTS,
      actsIncluded: [...DIFFICULTY_DEFAULTS.actsIncluded],
    };
    this.actSequence = [...ACT_SEQUENCE];
    this.pendingAmbushNodeId = null;
    this.pendingCaravanShop = null;
    this.pendingBattleReward = null;
    // Branching Threads: battle-reward rerolls spent this run (granted: metaEffects.rewardRerolls).
    this.rewardRerollsSpent = 0;
    this.pendingBossRecruit = null;
    this.pendingThirdLord = null;
    this.reachedFirstActBoss = false;
    this.activeCaravanShop = null;
    this.lastBattleCasualtyNotices = [];
    this.endRunRewards = null;
    this.metaUnlockedWeaponArts = [];
    this.actUnlockedWeaponArts = [];
    this.unlockedWeaponArts = [];
    this.winStreak = 0;
    this.maxWinStreak = 0;
    this.noMetaMode = false;
    this.shownDialogueKeys = [];
    // Run-aware narrative capture: how this run ended (set by failRun) and
    // which non-commander lords fell in completed battles. Flushed to meta
    // story flags exactly once at settle time — never written mid-battle, so
    // a battle reverted via Continue-from-Map leaves no phantom memory.
    this.defeatContext = null; // { defeatedBy: string|null, wasBoss: boolean }
    this.runLordFalls = [];
    this._churchPromotionTracker = null; // { nodeId: string, count: number }
    this.thirdLordJoined = false;
    this.thirdLordRerolled = false;
    // Suspended battle (anti-refresh): set on battle entry, updated with a
    // resume checkpoint after every action, cleared by completeBattle. A save
    // carrying this flag offers Resume-or-Revert on continue, so a refresh
    // can never undo an action that already resolved.
    this.battleInProgress = null;
    // The Eclipse (visible run clock): shadow is committed only at battle victory,
    // boss relief and church Kindle. See EclipseSystem.js / docs/specs/eclipse.md.
    this.eclipse = createEclipseState();
    this.lastEclipseCommit = null;
  }

  /** A fresh run's event state: nothing chosen, no flags, no burdens, no one laid to rest. */
  _resetEventState() {
    this.eventStateByNodeId = {};
    this.eventLog = [];
    this.storyFlags = {};
    this.burdens = [];
    this.pendingEventNodeId = null;
    this.laidToRest = [];
    this.lastBurdenSettlement = null;
    this.lastBattleGoldGamble = null;
    this.contract = null;
    this.contractOwed = null;
    this.lastContractSettlement = null;
  }

  _isValidSerializedUnit(unit) {
    return !!(
      unit &&
      typeof unit === 'object' &&
      unit.name &&
      unit.stats &&
      typeof unit.stats === 'object'
    );
  }

  _sanitizeUnitPools() {
    if (!Array.isArray(this.roster)) this.roster = [];
    if (!Array.isArray(this.fallenUnits)) this.fallenUnits = [];
    this.roster = this.roster.filter((u) => this._isValidSerializedUnit(u));
    this.fallenUnits = this.fallenUnits.filter((u) => this._isValidSerializedUnit(u));
    if (!this.convoy || typeof this.convoy !== 'object')
      this.convoy = { weapons: [], consumables: [] };
    if (!Array.isArray(this.convoy.weapons)) this.convoy.weapons = [];
    if (!Array.isArray(this.convoy.consumables)) this.convoy.consumables = [];
  }

  get currentAct() {
    const raw = Number(this.actIndex);
    const idx = Number.isFinite(raw)
      ? Math.max(0, Math.min(Math.floor(raw), this.actSequence.length - 1))
      : 0;
    return this.actSequence[idx];
  }

  get currentActConfig() {
    return ACT_CONFIG[this.currentAct];
  }

  getBaseVisionCharges() {
    return baseVisionChargesFor(this.metaEffects?.visionChargesBonus);
  }

  /** The commander is the permadeath anchor — the unit whose death ends the run. */
  getCommander() {
    return findCommander(this.roster);
  }

  getCommanderName() {
    return this.getCommander()?.name || DEFAULT_STARTING_LORD_NAMES[0];
  }

  /**
   * Names of the lords the run started with (commander choice via
   * metaEffects), healed against lords data exactly as createInitialRoster
   * heals them — so presentation consumers always match the built roster.
   */
  getStartingLordNames() {
    const [commanderDef, partnerDef] = resolveStartingLordDefs(
      this.metaEffects,
      this.gameData?.lords,
    );
    if (commanderDef && partnerDef) return [commanderDef.name, partnerDef.name];
    return resolveStartingLordNames(this.metaEffects);
  }

  hasShownDialogue(key) {
    return typeof key === 'string' && this.shownDialogueKeys.includes(key);
  }

  markDialogueShown(key) {
    if (typeof key !== 'string' || !key) return;
    if (!this.shownDialogueKeys.includes(key)) this.shownDialogueKeys.push(key);
  }

  /** Initialize a new run: create starting roster + first act node map. */
  startRun(options = {}) {
    const {
      runSeed = null,
      applyBlessingsAtStart = true,
      difficultyId = this.difficultyId || 'normal',
      eclipseEnabled = true,
    } = options;
    this.mode = STANDARD_RUN_MODE;
    this.applyDifficultySelection(difficultyId);
    this.eclipse = createEclipseState({ enabled: eclipseEnabled !== false });
    this.lastEclipseCommit = null;
    this.usedRecruitNames = {};
    this.lastDeployment = [];
    this.legendaryLordChance = legendaryLordChanceFor(this.metaEffects?.legendaryLordChanceBonus);
    // Seed first: starting lords roll their traits from the run seed.
    if (!Number.isFinite(this.runSeed)) {
      const initialSeed = runSeed ?? Date.now();
      this.runSeed = Number(initialSeed);
    }
    this.nextUnitUid = 1;
    this.roster = this.createInitialRoster();
    this.ensureUnitUids();
    this.ensurePortraitVariants();
    this.runRecordId ||= globalThis.crypto?.randomUUID?.() || `run-${this.runSeed}-${Date.now()}`;
    this.rngSeed = this.runSeed >>> 0;
    this.visionChargesRemaining = this.getBaseVisionCharges();
    this.visionCount = 0;
    this.randomLegendary = generateRandomLegendary(this.gameData.weapons);
    this.nodeMap = this._withNodeMapSeed(() =>
      generateNodeMap(this.currentAct, this.currentActConfig, this.gameData.mapTemplates, {
        fogChanceBonus: this.getDifficultyModifier('fogChanceBonus', 0),
        halfFogChance: this.difficultyId === 'normal',
        villageAmbushChance: this.getDifficultyModifier('villageAmbushChance', 0),
        // an object — read directly (getDifficultyModifier coerces objects)
        villageMinRow: this.difficultyModifiers?.villageMinRow ?? null,
        colosseumConfig: this.gameData.colosseum?.nodeGeneration ?? null,
        caravanChanceBonus: this.metaEffects?.caravanChanceBonus || 0,
      }),
    );
    this.currentNodeId = null;
    this.pendingAmbushNodeId = null;
    this.pendingCaravanShop = null;
    this.pendingBattleReward = null;
    this.rewardRerollsSpent = 0;
    this.pendingBossRecruit = null;
    this.pendingThirdLord = null;
    this.reachedFirstActBoss = false;
    this.activeCaravanShop = null;
    this.lastBattleCasualtyNotices = [];
    this.battleInProgress = null;
    this.blessingRuntimeModifiers = createBlessingRuntimeModifiers();
    this.earnedBlessingPicks = {};
    this.blessingBoonRevision = BLESSING_BOON_REVISION; // a new run follows the current rules
    this.battleConfigsByNodeId = {};
    this.ensureRecruitPreviews();
    this.shopStateByNodeId = {};
    this.ruinsChoiceByNodeId = {};
    this.churchVowByNodeId = {};
    this._resetEventState();
    this.metaUnlockedWeaponArts = [];
    this.actUnlockedWeaponArts = [];
    this.unlockedWeaponArts = [];
    this.shownDialogueKeys = [];
    this.defeatContext = null;
    this.runLordFalls = [];
    this._syncMetaWeaponArtUnlocks();
    this._syncActWeaponArtUnlocksForCurrentAct();
    this.blessingHistory = [];
    this._runStartBlessingsApplied = false;
    this._blessingChosen = false;
    this.initializeBlessingsAtRunStart(options);
    if (applyBlessingsAtStart && this.activeBlessings.length > 0) {
      this.applyRunStartBlessingEffects();
    }
  }

  /**
   * Start the prologue run (docs/specs/prologue-chapter.md §9): the prologue seed, the
   * authored roster (the first chapter's), no Vision charge (a P1 fall would otherwise
   * offer a rewind and spend the charge P3's exercise grants), the Eclipse off, the
   * literal route map with every chapter's config pre-locked on its node, Act 1's
   * tables on Normal, no blessing and no meta effects (prologue units are authored).
   * Nothing here counts as a run started: the caller never increments runsStarted.
   * @param {object} gameData
   * @param {object} prologue - data/prologue.json (gameData.prologue)
   */
  startPrologue(gameData, prologue = gameData?.prologue) {
    if (!prologue?.route) throw new Error('startPrologue needs an authored prologue route');
    this.gameData = gameData;
    this.metaEffects = null;
    this.mode = PROLOGUE_RUN_MODE;
    this.applyDifficultySelection('normal');
    this.actSequence = [PROLOGUE_ACT_ID];
    this.actIndex = 0;
    this.eclipse = createEclipseState({ enabled: false });
    this.lastEclipseCommit = null;
    this.usedRecruitNames = {};
    this.lastDeployment = [];
    this.legendaryLordChance = 0;
    this.runSeed = Math.trunc(Number(prologue.seed) || 0);
    this.nextUnitUid = 1;
    const first = this.getPrologueChapter(prologue.route.nodes.find((n) => n?.row === 0)?.id);
    this.roster = this._buildPrologueJoinUnits(first?.roster || [], prologue);
    stampCommanderFlag(this.roster); // Edric commands the first thread (the lord by name)
    this.ensureUnitUids();
    this.ensurePortraitVariants();
    this.runRecordId ||= globalThis.crypto?.randomUUID?.() || `run-${this.runSeed}-${Date.now()}`;
    this.rngSeed = this.runSeed >>> 0;
    this.visionChargesRemaining = 0;
    this.visionCount = 0;
    this.prologueVisionGranted = false;
    this.prologueRosterLesson = null;
    this.gold = Math.max(0, Math.trunc(Number(prologue.startingGold) || 0));
    this.randomLegendary = null;
    this.nodeMap = buildPrologueNodeMap(prologue, gameData);
    this.currentNodeId = null;
    this.completedBattles = 0;
    this.fallenUnits = [];
    this.pendingAmbushNodeId = null;
    this.pendingCaravanShop = null;
    this.pendingBattleReward = null;
    this.rewardRerollsSpent = 0;
    this.pendingBossRecruit = null;
    this.pendingThirdLord = null;
    this.reachedFirstActBoss = false;
    this.activeCaravanShop = null;
    this.lastBattleCasualtyNotices = [];
    this.battleInProgress = null;
    this.blessingRuntimeModifiers = createBlessingRuntimeModifiers();
    this.earnedBlessingPicks = {};
    this.blessingBoonRevision = BLESSING_BOON_REVISION; // a new run follows the current rules
    this.battleConfigsByNodeId = {};
    for (const node of this.nodeMap.nodes) {
      const chapter = this.getPrologueChapter(node.id);
      if (!chapter) continue;
      this.battleConfigsByNodeId[node.id] = buildPrologueBattleConfig(chapter, gameData.terrain);
    }
    this.shopStateByNodeId = {};
    this.ruinsChoiceByNodeId = {};
    this.churchVowByNodeId = {};
    this._resetEventState(); // the prologue has no events: it starts empty and stays empty
    this.metaUnlockedWeaponArts = [];
    this.actUnlockedWeaponArts = [];
    this.unlockedWeaponArts = [];
    // The cold open belongs to the real first run: the route map never plays it here.
    this.shownDialogueKeys = ['runStart'];
    this.defeatContext = null;
    this.runLordFalls = [];
    this.blessingHistory = [];
    this._runStartBlessingsApplied = false;
    this._blessingChosen = false;
    this.initializeBlessingsAtRunStart({ blessingSeed: this.runSeed });
    this.chooseBlessing(null);
  }

  /** The authored chapter a prologue node fights, or null. */
  getPrologueChapter(nodeId) {
    if (!isPrologueRun(this)) return null;
    return prologueChapterForNode(this.gameData?.prologue, nodeId);
  }

  /** The chapter the prologue run is fighting (the suspended battle's node), or null. */
  getActivePrologueChapter() {
    return this.getPrologueChapter(this.battleInProgress?.nodeId);
  }

  /** Serialized units for prologue roster keys: authored units, or the standard veteran. */
  _buildPrologueJoinUnits(keys, prologue = this.gameData?.prologue) {
    return keys.map((key) => {
      let unit;
      if (isSpecialRosterKey(key, this.gameData)) {
        unit = createSpecialCharacter(key, this.gameData, { difficultyId: this.difficultyId });
        if (!unit) throw new Error(`Unknown prologue special character "${key}"`);
        this._trackRecruitNameUse(unit.className, unit.name);
      } else {
        unit = buildPrologueUnits(prologue, this.gameData, [key])[0];
      }
      return serializeUnit(unit);
    });
  }

  /**
   * The authored joins committed with a chapter's victory (`joins.afterChapter`):
   * each unit joins once, at the same commit as the battle, so a refresh after the
   * victory save already has them. Returns the names that joined.
   */
  _applyPrologueJoins(node) {
    const chapter = this.getPrologueChapter(node?.id);
    const keys = this.gameData?.prologue?.joins?.afterChapter?.[chapter?.id];
    if (!Array.isArray(keys) || !keys.length) return [];
    const present = new Set([...this.roster, ...this.fallenUnits].map((u) => u?.name));
    const joined = [];
    for (const unit of this._buildPrologueJoinUnits(keys)) {
      if (present.has(unit.name)) continue;
      this.assignUnitUid(unit);
      this.roster.push(unit);
      joined.push(unit.name);
    }
    if (joined.length) this.ensurePortraitVariants();
    return joined;
  }

  /**
   * P3's exercise: the prologue's one Vision charge, saved like any charge. Once per
   * prologue run (`prologueVisionGranted`, saved): a resumed or re-shown beat never
   * grants twice. A chapter restart or Continue from Map reverts the grant with the
   * battle (the flag is part of the battle's entry state). Returns true when granted.
   */
  grantPrologueVision() {
    if (!isPrologueRun(this) || this.prologueVisionGranted) return false;
    const current = Number.isFinite(this.visionChargesRemaining)
      ? Math.max(0, Math.trunc(this.visionChargesRemaining))
      : 0;
    this.visionChargesRemaining = current + 1;
    this.prologueVisionGranted = true;
    return true;
  }

  /**
   * Arrival at a prologue service node (`joins.atNode`): the units that join there
   * do, once, with their recruit card line; a unit's `join.needs` item (Tamsin's
   * bow) is granted to the convoy when nobody in the army holds one and the convoy
   * has none, and the card then reads `lineIfGranted`. Idempotent: a unit already in
   * the army (a reload at the node) joins nothing and grants nothing.
   * @returns {{ joined: { name: string, line: string|null }[], granted: string[] }}
   */
  arriveAtPrologueNode(nodeId) {
    const out = { joined: [], granted: [] };
    if (!isPrologueRun(this)) return out;
    const prologue = this.gameData?.prologue;
    const keys = prologueJoinsAtNode(prologue, nodeId);
    if (!keys.length) return out;
    const present = new Set([...this.roster, ...this.fallenUnits].map((u) => u?.name));
    for (const unit of this._buildPrologueJoinUnits(keys.filter((k) => !present.has(k)))) {
      const join = prologue?.units?.[unit.name]?.join || null;
      let lineKey = join?.line || null;
      if (join?.needs && !this._armyHolds(join.needs)) {
        const item =
          (this.gameData?.weapons || []).find((w) => w.name === join.needs) ||
          this.getConsumableTemplate(join.needs);
        if (item && this.addToConvoy(structuredClone(item))) {
          out.granted.push(item.name);
          lineKey = join.lineIfGranted || lineKey;
        }
      }
      this.assignUnitUid(unit);
      this.roster.push(unit);
      present.add(unit.name);
      out.joined.push({ name: unit.name, line: lineKey });
    }
    if (out.joined.length) this.ensurePortraitVariants();
    return out;
  }

  /** True when a roster unit carries an item of this name or the convoy holds one. */
  _armyHolds(name) {
    const carried = this.roster.some((u) =>
      [...(u.inventory || []), ...(u.consumables || [])].some((i) => i?.name === name),
    );
    const stored = [...(this.convoy?.weapons || []), ...(this.convoy?.consumables || [])].some(
      (i) => i?.name === name,
    );
    return carried || stored;
  }

  /** True once the prologue's last chapter is won (its node is the map's "boss"). */
  isPrologueComplete() {
    return isPrologueRun(this) && this.isActComplete();
  }

  initializeBlessingsAtRunStart(options = {}) {
    const {
      blessingSeed = null,
      blessingOptionCount = 3,
      autoSelectBlessing = false,
      debugBlessingSelection = false,
    } = options;
    const catalog = this.gameData?.blessings;
    if (!catalog || !Array.isArray(catalog.blessings)) {
      this.activeBlessings = [];
      this.blessingSelectionTelemetry = {
        seed: blessingSeed ?? this.runSeed,
        candidatePoolIds: [],
        offeredIds: [],
        offeredBlessings: [],
        chosenIds: [],
        chosenBlessings: [],
        rejectionReasons: [{ blessingId: null, reason: 'missing_catalog' }],
      };
      return;
    }

    const resolvedSeed = Number(blessingSeed ?? this.runSeed);
    const rng = createSeededRng(resolvedSeed);
    const { selected, telemetry } = selectBlessingOptionsWithTelemetry(catalog, rng, {
      count: blessingOptionCount,
      forceTier1: true,
      allowTier4: true,
      difficultyId: this.difficultyId,
      isCostApplicable: (entry) => this.isBlessingCostApplicable(entry),
    });

    const offeredBlessings = selected.map((blessing) => structuredClone(blessing));
    const chosenBlessings = autoSelectBlessing
      ? offeredBlessings
          .slice(0, 1)
          .map((blessing) => this._buildActiveBlessingEntryFromOffer(blessing))
          .filter(Boolean)
      : [];
    const chosenIds = chosenBlessings.map((entry) => entry.id);
    this.activeBlessings = chosenBlessings;
    this.blessingSelectionTelemetry = {
      seed: resolvedSeed,
      candidatePoolIds: telemetry.candidatePoolIds,
      offeredIds: offeredBlessings.map((blessing) => blessing.id),
      offeredBlessings,
      chosenIds,
      chosenBlessings,
      rejectionReasons: telemetry.rejectionReasons,
      options: telemetry.options,
    };

    if (debugBlessingSelection && this.blessingSelectionTelemetry) {
      console.debug('BlessingSelection', this.blessingSelectionTelemetry);
    }
  }

  getBlessingOptions() {
    const offeredBlessings = this.blessingSelectionTelemetry?.offeredBlessings;
    if (Array.isArray(offeredBlessings)) {
      return offeredBlessings
        .map((blessing, index) =>
          this._resolveBlessingOfferForSelection(blessing, index, 'telemetry'),
        )
        .filter(Boolean);
    }

    const offeredIds = this.blessingSelectionTelemetry?.offeredIds || [];
    const catalog = this.gameData?.blessings;
    if (!catalog || !Array.isArray(catalog.blessings)) return [];
    const index = buildBlessingIndex(catalog);
    return offeredIds
      .map((id) => index.get(id))
      .filter(Boolean)
      .map((blessing, offerIndex) =>
        this._resolveBlessingOfferForSelection(blessing, offerIndex, 'legacy_ids'),
      )
      .filter(Boolean);
  }

  chooseBlessing(blessingId = null) {
    if (this._blessingChosen) return true; // idempotent — already committed
    const offeredBlessings = this.getBlessingOptions();
    const offeredIds = offeredBlessings.map((blessing) => blessing.id);
    if (blessingId !== null && !offeredIds.includes(blessingId)) return false;

    const selectedIndex = blessingId
      ? offeredBlessings.findIndex((blessing) => blessing.id === blessingId)
      : -1;
    const selectedBlessing = selectedIndex >= 0 ? offeredBlessings[selectedIndex] : null;
    const chosenBlessings = selectedBlessing
      ? [this._buildActiveBlessingEntryFromOffer(selectedBlessing, selectedIndex)].filter(Boolean)
      : [];
    const chosenIds = chosenBlessings.map((entry) => entry.id);
    this.activeBlessings = chosenBlessings;

    this.blessingHistory.push({
      timestamp: Date.now(),
      stage: 'run_start',
      eventType: 'selection',
      blessingId: blessingId ?? null,
      effectType: null,
      details: {
        offeredIds: [...offeredIds],
        chosenIds: [...chosenIds],
        skipped: chosenIds.length === 0,
      },
    });
    if (this.blessingSelectionTelemetry) {
      this.blessingSelectionTelemetry.chosenIds = chosenIds;
      this.blessingSelectionTelemetry.chosenBlessings = chosenBlessings.map((entry) =>
        structuredClone(entry),
      );
    }
    if (chosenIds.length === 0) {
      this._runStartBlessingsApplied = true;
      this._blessingChosen = true;
      return true;
    }
    this._runStartBlessingsApplied = false;
    this.applyRunStartBlessingEffects();
    this._blessingChosen = true;
    return true;
  }

  applyRunStartBlessingEffects() {
    if (this._runStartBlessingsApplied) return;
    if (!this.activeBlessings?.length) {
      this._runStartBlessingsApplied = true;
      return;
    }
    const catalog = this.gameData?.blessings;
    if (!catalog?.blessings?.length) {
      this._runStartBlessingsApplied = true;
      return;
    }

    const blessingIndex = buildBlessingIndex(catalog);
    for (const activeBlessing of this.activeBlessings) {
      const blessingId = getBlessingEntryId(activeBlessing);
      if (!blessingId) continue;
      const blessing = blessingIndex.get(blessingId);
      if (!blessing) {
        this._recordBlessingEvent('run_start', blessingId, null, { reason: 'unknown_blessing_id' });
        continue;
      }
      const rolledCost = normalizeBlessingCostEntry(activeBlessing?.rolledCost);
      const costEffects = rolledCost?.effects?.length ? rolledCost.effects : blessing.costs || [];
      const effects = [...(blessing.boons || []), ...costEffects];
      for (const effect of effects) {
        this._applySingleRunStartBlessingEffect(blessingId, effect);
      }
    }
    this._runStartBlessingsApplied = true;
  }

  /**
   * Take a blessing mid-run (a church's vow): it joins the active list and its boons
   * apply now, as they would have at the run's start. Tier-1 blessings only carry
   * boons. Returns false for an unknown or already active blessing, and for a card that
   * carries an intrinsic price or a pact (its cost would never be paid). An earned blessing is
   * handed out only by the run's own sources (engine/EarnedBlessings.js passes `earned: true`):
   * a church, an event or any other caller is refused it.
   */
  addBlessingMidRun(blessingId, { earned = false } = {}) {
    const blessing = buildBlessingIndex(this.gameData?.blessings || {}).get(blessingId);
    if (!blessing || this.getActiveBlessingIds().includes(blessingId)) return false;
    if (blessing.earned === true && earned !== true) return false;
    // A card whose cost is part of what it is (an intrinsic price, a tier IV pact) is only ever
    // taken at the shrine, where the price is shown and paid; a mid-run grant carries none.
    if (blessing.intrinsicPrice || blessing.pact) return false;
    this.activeBlessings = [
      ...(this.activeBlessings || []),
      createActiveBlessingEntry(blessingId, null, { midRun: true }),
    ];
    // Every handler records its event as 'run_start'; while a mid-run grant applies, the
    // record says 'mid_run' instead (see _recordBlessingEvent). Transient: never saved.
    const outerStage = this._blessingEventStage;
    this._blessingEventStage = 'mid_run';
    try {
      for (const effect of blessing.boons || [])
        this._applySingleRunStartBlessingEffect(blessingId, effect);
    } finally {
      if (outerStage === undefined) delete this._blessingEventStage;
      else this._blessingEventStage = outerStage;
    }
    return true;
  }

  getActiveBlessingIds() {
    const ids = [];
    for (const entry of this.activeBlessings || []) {
      const id = getBlessingEntryId(entry);
      if (!id || ids.includes(id)) continue;
      ids.push(id);
    }
    return ids;
  }

  /**
   * A burden as a blessing's price (Debt, Hunted, Sworn Enemy, Ill Omen, or a Lingering
   * Injury on the commander), through the same Burdens.addBurden an event uses. A Debt's
   * amount is already the rung's (BlessingEngine.resolvePriceOption scaled it). An injury's
   * stat is drawn from the run seed, never Math.random.
   */
  _applyBurdenPrice(blessingId, effect) {
    const { id, ...raw } = effect.params || {};
    const params = { ...raw };
    if (id === 'wounded') {
      const commander = params.target === 'commander' ? findCommander(this.roster || []) : null;
      delete params.target;
      if (!commander) {
        this._recordBlessingEvent('run_start', blessingId, effect, {
          skipped: true,
          reason: 'no_commander',
        });
        return;
      }
      params.unitUid = commander.unitUid;
      params.unitName = commander.name;
      if (!WOUND_STATS.includes(params.stat)) {
        const rand = this._createBlessingRng(blessingId, 'price:wounded');
        params.stat = WOUND_STATS[Math.floor(rand() * WOUND_STATS.length)];
      }
    }
    const result = addBurden(this, id, params);
    this._recordBlessingEvent('run_start', blessingId, effect, {
      burden: id,
      applied: result?.ok !== false,
      ...(result?.ok === false ? { reason: result.reason } : {}),
    });
  }

  _recordBlessingEvent(stage, blessingId, effect, details = {}) {
    this.blessingHistory.push({
      timestamp: Date.now(),
      // The run-start handlers all say 'run_start'; a mid-run grant (addBlessingMidRun) is
      // recorded as 'mid_run', whichever handler wrote it.
      stage: stage === 'run_start' && this._blessingEventStage ? this._blessingEventStage : stage,
      eventType: 'effect_applied',
      blessingId,
      effectType: effect?.type || null,
      details,
    });
  }

  /**
   * The history record of an earned pick being taken (engine/EarnedBlessings.js): its own
   * event type, not an applied effect (the boons the blessing then applies are recorded by
   * their handlers, stage 'mid_run', as any mid-run grant's).
   */
  _recordEarnedPick(blessingId, details = {}) {
    this.blessingHistory.push({
      timestamp: Date.now(),
      stage: 'mid_run',
      eventType: 'earned_pick',
      blessingId,
      effectType: null,
      details,
    });
  }

  _applyStatDeltaToUnits(units, stat, value) {
    if (!Array.isArray(units) || !stat || !Number.isFinite(value) || value === 0) return;
    for (const unit of units) {
      unit.stats[stat] = (unit.stats[stat] || 0) + value;
      if (stat === 'HP') {
        if (value > 0) {
          unit.currentHP = (unit.currentHP || 0) + value;
        } else {
          unit.currentHP = Math.min(unit.currentHP || 0, unit.stats.HP || 0);
        }
      }
      if (stat === 'MOV') {
        unit.mov = (unit.mov || unit.stats.MOV || 0) + value;
      }
    }
  }

  _getPersonalSkillIdSet() {
    const lords = Array.isArray(this.gameData?.lords) ? this.gameData.lords : [];
    const ids = new Set();
    for (const lord of lords) {
      const id = parsePersonalSkillId(lord?.personalSkill || '');
      if (id) ids.add(id);
    }
    return ids;
  }

  _applyGrowthDeltaToUnits(units, value) {
    if (!Array.isArray(units) || !Number.isFinite(value) || value === 0) return;
    const scaled = Math.round(value * this._getGrowthBonusMultiplier());
    if (scaled === 0) return;
    for (const unit of units) {
      if (!unit.growths) unit.growths = {};
      for (const stat of XP_STAT_NAMES) {
        unit.growths[stat] = (unit.growths[stat] || 0) + scaled;
      }
    }
  }

  _applyTargetedGrowthDeltaToUnits(units, stats, value) {
    if (!Array.isArray(units) || !Array.isArray(stats) || !Number.isFinite(value) || value === 0)
      return;
    const scaled = Math.round(value * this._getGrowthBonusMultiplier());
    if (scaled === 0) return;
    for (const unit of units) {
      if (!unit.growths) unit.growths = {};
      for (const stat of stats) {
        unit.growths[stat] = (unit.growths[stat] || 0) + scaled;
      }
    }
  }

  _createBlessingRng(blessingId, contextKey = '') {
    const baseSeed = Number.isFinite(this.runSeed) ? Number(this.runSeed) : 0;
    const seed = eclipseHash(`${baseSeed}|${blessingId || 'none'}|${contextKey}`);
    return createSeededRng(seed);
  }

  /**
   * Whether a shrine price would actually cost this run something. Deforging the
   * lords' weapons is void when none of them carries a forge (a starting weapon is
   * unforged unless Honed Blades forged it), so that price is never offered then.
   */
  isBlessingCostApplicable(entry) {
    const effects = Array.isArray(entry?.effects) ? entry.effects : [];
    for (const effect of effects) {
      if (
        effect?.type === 'starting_weapon_forge_delta' &&
        Number(effect.params?.value) < 0 &&
        this._countForgedLordWeapons() === 0
      )
        return false;
      // Shadow costs nothing with the Eclipse off; a Vision price nothing with no charge to lose.
      if (effect?.type === 'eclipse_shadow_delta' && this.eclipse?.enabled === false) return false;
      if (
        effect?.type === 'vision_delta' &&
        Number(effect.params?.value) < 0 &&
        !(Number(this.visionChargesRemaining) > 0)
      )
        return false;
      if (
        effect?.type === 'burden' &&
        effect.params?.id === 'wounded' &&
        effect.params?.target === 'commander' &&
        !findCommander(this.roster || [])
      )
        return false;
    }
    return true;
  }

  /** Forged combat weapons carried by lords (the targets of a deforge price). */
  _countForgedLordWeapons() {
    let count = 0;
    for (const unit of this.roster || []) {
      if (!unit?.isLord) continue;
      const seen = new Set();
      for (const weapon of [...(unit.inventory || []), unit.weapon]) {
        if (!weapon || seen.has(weapon)) continue;
        seen.add(weapon);
        if (['Staff', 'Consumable', 'Scroll'].includes(weapon.type)) continue;
        if ((weapon._forgeLevel || 0) > 0) count++;
      }
    }
    return count;
  }

  _rollCostForBlessingWithSeed(blessing, blessingId, contextKey = 'run_start', options = {}) {
    if (!blessing || blessing.tier < 2) return null;
    // v3: the blessing's own prices (or pact). A legacy save's migration (`ignorePact`) keeps
    // the old pool rules below.
    if (!options.ignorePact && usesPriceCatalog(this.gameData?.blessings)) {
      return normalizeBlessingCostEntry(
        rollPriceForBlessing(
          this.gameData.blessings,
          blessing,
          this._createBlessingRng(blessingId, `cost_roll:${contextKey}`),
          {
            difficultyId: this.difficultyId,
            isApplicable: (entry) => this.isBlessingCostApplicable(entry),
          },
        ),
      );
    }
    // A pact is the price of a blessing taken now. A legacy save that never stored a
    // price (see _normalizeActiveBlessingsForLoad) keeps the old rolled-pool rules.
    if (isPlainObject(blessing.pact) && !options.ignorePact)
      return normalizeBlessingCostEntry(blessing.pact);
    const pool = this.gameData?.blessings?.costPools?.[String(blessing.tier)];
    if (!Array.isArray(pool) || pool.length <= 0) return null;
    const rand = this._createBlessingRng(blessingId, `cost_roll:${contextKey}`);
    const rollAs =
      options.ignorePact && blessing.pact ? { ...blessing, pact: undefined } : blessing;
    return rollCostForBlessing(pool, rollAs, rand, {
      isApplicable: (entry) => this.isBlessingCostApplicable(entry),
    });
  }

  _resolveBlessingOfferForSelection(blessing, offerIndex = 0, contextKey = 'selection') {
    const blessingId = typeof blessing?.id === 'string' ? blessing.id.trim() : '';
    if (!blessingId) return null;
    const catalogBlessing =
      this.gameData?.blessings?.blessings?.find((entry) => entry.id === blessingId) || null;
    const resolved = catalogBlessing
      ? { ...structuredClone(catalogBlessing), ...structuredClone(blessing), id: blessingId }
      : { ...structuredClone(blessing), id: blessingId };
    resolved.rolledCost =
      normalizeBlessingCostEntry(blessing?.rolledCost) || intrinsicCostOf(resolved);
    const needsV2Cost =
      resolved.tier >= 2 &&
      !resolved.intrinsicPrice &&
      !resolved.rolledCost &&
      Array.isArray(resolved.costs) &&
      resolved.costs.length === 0;
    if (needsV2Cost) {
      resolved.rolledCost = this._rollCostForBlessingWithSeed(
        resolved,
        blessingId,
        `${contextKey}:${offerIndex}`,
      );
    }
    return resolved;
  }

  _buildActiveBlessingEntryFromOffer(blessing, offerIndex = 0) {
    const resolved = this._resolveBlessingOfferForSelection(blessing, offerIndex, 'choose');
    if (!resolved?.id) return null;
    return createActiveBlessingEntry(resolved.id, resolved.rolledCost || null);
  }

  _normalizeActiveBlessingsForLoad(entries = []) {
    if (!Array.isArray(entries)) return [];
    const catalog = this.gameData?.blessings;
    const blessingIndex = catalog?.blessings?.length ? buildBlessingIndex(catalog) : new Map();
    const normalized = [];
    // A save from before `midRun` was kept: the run-start selection record (chooseBlessing)
    // names what was picked at the start, so any other held blessing came from a church or an
    // event. Its display-only price (rolled here on an earlier load, never applied) is dropped.
    const selection = [...(this.blessingHistory || [])]
      .reverse()
      .find(
        (record) =>
          record?.stage === 'run_start' &&
          record?.eventType === 'selection' &&
          Array.isArray(record?.details?.chosenIds),
      );
    const startPicks = selection ? selection.details.chosenIds : null;

    entries.forEach((entry, index) => {
      const id = getBlessingEntryId(entry);
      if (!id) return;
      if (entry?.midRun === true || (startPicks && !startPicks.includes(id))) {
        normalized.push(createActiveBlessingEntry(id, null, { midRun: true }));
        return;
      }
      const blessing = blessingIndex.get(id);
      if (!blessing) {
        normalized.push(createActiveBlessingEntry(id, null));
        return;
      }

      let rolledCost = normalizeBlessingCostEntry(entry?.rolledCost) || intrinsicCostOf(blessing);
      const needsV2Cost =
        id !== 'swift_instinct' &&
        blessing.tier >= 2 &&
        !blessing.intrinsicPrice &&
        !rolledCost &&
        Array.isArray(blessing.costs) &&
        blessing.costs.length === 0;
      if (needsV2Cost) {
        rolledCost = this._rollCostForBlessingWithSeed(blessing, id, `migrate:${index}`, {
          ignorePact: true,
        });
      }
      normalized.push(createActiveBlessingEntry(id, rolledCost));
    });

    return normalized.filter(Boolean);
  }

  _suppressPersonalSkillsForCurrentRosterIfNeeded() {
    const targetAct = this.blessingRuntimeModifiers?.disablePersonalSkillsUntilAct;
    if (!targetAct) return { applied: false, removedByUnit: {} };
    const targetIndex = this.actSequence.indexOf(targetAct);
    if (targetIndex === -1 || this.actIndex >= targetIndex) {
      return { applied: false, removedByUnit: {} };
    }
    const personalSkillIds = this._getPersonalSkillIdSet();
    if (personalSkillIds.size === 0) return { applied: false, removedByUnit: {} };
    if (
      !this.blessingRuntimeModifiers.blockedPersonalSkillsByUnit ||
      typeof this.blessingRuntimeModifiers.blockedPersonalSkillsByUnit !== 'object'
    ) {
      this.blessingRuntimeModifiers.blockedPersonalSkillsByUnit = {};
    }
    const blockedByUnit = this.blessingRuntimeModifiers.blockedPersonalSkillsByUnit;
    const removedByUnit = {};
    for (const unit of this.roster) {
      if (!Array.isArray(unit?.skills) || unit.skills.length === 0) continue;
      const blocked = new Set(
        Array.isArray(blockedByUnit[unit.name]) ? blockedByUnit[unit.name] : [],
      );
      const nextSkills = [];
      const removed = [];
      for (const skillId of unit.skills) {
        if (personalSkillIds.has(skillId)) {
          blocked.add(skillId);
          removed.push(skillId);
        } else {
          nextSkills.push(skillId);
        }
      }
      if (removed.length > 0) {
        unit.skills = nextSkills;
        blockedByUnit[unit.name] = [...blocked];
        removedByUnit[unit.name] = removed;
      }
    }
    return { applied: Object.keys(removedByUnit).length > 0, removedByUnit };
  }

  _restoreDisabledPersonalSkillsIfReady(stage = 'act_transition') {
    const targetAct = this.blessingRuntimeModifiers?.disablePersonalSkillsUntilAct;
    if (!targetAct) return;
    const targetIndex = this.actSequence.indexOf(targetAct);
    if (targetIndex === -1 || this.actIndex < targetIndex) return;
    const blockedByUnit = this.blessingRuntimeModifiers?.blockedPersonalSkillsByUnit || {};
    const restoredByUnit = {};
    const displacedByUnit = {};

    // Build protection sets for displacement logic
    const personalSkillIds = this._getPersonalSkillIdSet();

    for (const unit of this.roster) {
      const blocked = Array.isArray(blockedByUnit[unit.name]) ? blockedByUnit[unit.name] : [];
      if (blocked.length === 0) continue;
      const restored = [];
      const pending = [];

      // Per-unit innate set: only this unit's class chain is protected
      const unitInnateIds = new Set();
      for (const sid of getClassInnateSkills(unit.className, this.gameData?.skills || [])) {
        unitInnateIds.add(sid);
      }
      const lineBase =
        unit.tier === 'promoted' ? unitBaseClassName(unit, this.gameData?.classes) : null;
      if (lineBase) {
        for (const sid of getClassInnateSkills(lineBase, this.gameData?.skills || [])) {
          unitInnateIds.add(sid);
        }
      }

      for (const skillId of blocked) {
        if (!Array.isArray(unit.skills)) {
          pending.push(skillId);
          continue;
        }
        if (unit.skills.includes(skillId)) {
          restored.push(skillId);
          continue;
        }
        // A lord's own skill is restored to the equipped list, never left benched.
        if (benchedSkillsOf(unit).includes(skillId))
          unit.benchedSkills = benchedSkillsOf(unit).filter((id) => id !== skillId);

        const result = learnSkill(unit, skillId, { bench: false });
        if (result.learned) {
          restored.push(skillId);
          continue;
        }
        if (result.reason !== 'at_cap') {
          pending.push(skillId);
          continue;
        }

        // First pass: displace non-personal, non-innate skill
        let restoredWithDisplacement = false;
        for (let i = unit.skills.length - 1; i >= 0; i--) {
          const sid = unit.skills[i];
          if (!personalSkillIds.has(sid) && !unitInnateIds.has(sid)) {
            const displaced = unit.skills.splice(i, 1)[0];
            unit.skills.push(skillId);
            unit.benchedSkills = [...benchedSkillsOf(unit), displaced]; // kept, not lost
            restored.push(skillId);
            displacedByUnit[unit.name] = { displaced, replacedBy: skillId };
            restoredWithDisplacement = true;
            break;
          }
        }
        // Fallback: displace class innate (recoverable) over personal (identity)
        if (!restoredWithDisplacement) {
          for (let i = unit.skills.length - 1; i >= 0; i--) {
            const sid = unit.skills[i];
            if (!personalSkillIds.has(sid)) {
              const displaced = unit.skills.splice(i, 1)[0];
              unit.skills.push(skillId);
              unit.benchedSkills = [...benchedSkillsOf(unit), displaced]; // kept, not lost
              restored.push(skillId);
              displacedByUnit[unit.name] = { displaced, replacedBy: skillId };
              restoredWithDisplacement = true;
              break;
            }
          }
        }
        if (!restoredWithDisplacement) {
          pending.push(skillId);
        }
      }
      if (restored.length > 0) restoredByUnit[unit.name] = restored;
      if (pending.length > 0) {
        blockedByUnit[unit.name] = pending;
      } else {
        delete blockedByUnit[unit.name];
      }
    }
    this.blessingRuntimeModifiers.blockedPersonalSkillsByUnit = blockedByUnit;
    const hasPendingBlocked = Object.values(blockedByUnit).some(
      (entries) => Array.isArray(entries) && entries.length > 0,
    );
    this.blessingRuntimeModifiers.disablePersonalSkillsUntilAct = hasPendingBlocked
      ? targetAct
      : null;
    this._lastRestorationDisplacements = displacedByUnit;
    this._recordBlessingEvent(
      stage,
      null,
      { type: 'disable_personal_skills_until_act', params: { act: targetAct } },
      { restoredInAct: this.currentAct, restoredByUnit, displacedByUnit },
    );
  }

  _resolveBlessingUnitScope(scope = 'all') {
    if (scope === 'lords') return this.roster.filter((unit) => unit.isLord);
    if (scope === 'recruits') return this.roster.filter((unit) => !unit.isLord);
    return this.roster;
  }

  _pickDeterministicBlessingItem(items, blessingId, contextKey) {
    if (!Array.isArray(items) || items.length <= 0) return null;
    const rng = this._createBlessingRng(blessingId, contextKey);
    return items[Math.floor(rng() * items.length)] || null;
  }

  _isScrollValidForCurrentLords(scroll, artById) {
    const lords = this.roster.filter((unit) => unit.isLord);
    if (lords.length <= 0) return false;

    const explicitAllowed = Array.isArray(scroll?.allowedWeaponTypes)
      ? scroll.allowedWeaponTypes.filter((type) => typeof type === 'string' && type.trim())
      : [];
    let allowedTypes = explicitAllowed;
    if (allowedTypes.length <= 0 && typeof scroll?.teachesWeaponArtId === 'string') {
      const art = artById.get(scroll.teachesWeaponArtId);
      if (art) {
        allowedTypes = getWeaponArtAllowedTypes(art);
      }
    }
    if (allowedTypes.length <= 0) return true;

    return lords.some((unit) => {
      const profs = Array.isArray(unit.proficiencies) ? unit.proficiencies : [];
      return profs.some((prof) => allowedTypes.includes(prof.type));
    });
  }

  _applySingleRunStartBlessingEffect(blessingId, effect) {
    if (!effect || !effect.type || !effect.params) return;
    const value = Number(effect.params.value || 0);
    if (!Number.isFinite(value)) return;

    if (effect.type === 'run_start_max_hp_bonus') {
      if (value === 0) return;
      const scope = effect.params.scope || 'all';
      const targetUnits = this._resolveBlessingUnitScope(scope);
      this._applyStatDeltaToUnits(targetUnits, 'HP', value);
      this._recordBlessingEvent('run_start', blessingId, effect, { appliedValue: value, scope });
      return;
    }

    if (effect.type === 'gold_delta') {
      if (value !== 0) this.addGold(value);
      this._recordBlessingEvent('run_start', blessingId, effect, { appliedValue: value });
      return;
    }

    if (effect.type === 'battle_gold_multiplier_delta') {
      this.blessingRuntimeModifiers.battleGoldMultiplierDelta += value;
      this._recordBlessingEvent('run_start', blessingId, effect, {
        appliedValue: value,
        total: this.blessingRuntimeModifiers.battleGoldMultiplierDelta,
      });
      return;
    }

    if (effect.type === 'deploy_cap_delta') {
      this.blessingRuntimeModifiers.deployCapDelta += Math.trunc(value);
      this._recordBlessingEvent('run_start', blessingId, effect, {
        appliedValue: Math.trunc(value),
        total: this.blessingRuntimeModifiers.deployCapDelta,
      });
      return;
    }

    if (effect.type === 'starting_weapon_tier') {
      const requestedTier = String(effect.params.tier || '').trim();
      const count = Math.max(0, Math.trunc(Number(effect.params.count ?? 1)));
      if (!requestedTier || count <= 0) {
        this._recordBlessingEvent('run_start', blessingId, effect, {
          skipped: true,
          reason: 'invalid_starting_weapon_tier_params',
        });
        return;
      }

      let granted = 0;
      const grantedWeapons = [];
      const allWeapons = Array.isArray(this.gameData?.weapons) ? this.gameData.weapons : [];
      for (const unit of this.roster) {
        if (granted >= count) break;
        const profTypes = new Set((unit.proficiencies || []).map((p) => p.type));
        const candidate = allWeapons.find(
          (w) =>
            w?.tier === requestedTier &&
            profTypes.has(w.type) &&
            w.type !== 'Staff' &&
            w.type !== 'Consumable' &&
            w.type !== 'Scroll' &&
            canEquip(unit, w),
        );
        if (!candidate) continue;
        if (!addToInventory(unit, candidate)) continue;
        const addedWeapon = unit.inventory[unit.inventory.length - 1];
        if (addedWeapon && canEquip(unit, addedWeapon)) equipWeapon(unit, addedWeapon);
        granted++;
        grantedWeapons.push({ unit: unit.name, weapon: addedWeapon?.name || candidate.name });
      }

      this._recordBlessingEvent('run_start', blessingId, effect, {
        requestedTier,
        requestedCount: count,
        grantedCount: granted,
        grantedWeapons,
      });
      return;
    }

    if (effect.type === 'act_stat_delta_all_units') {
      const targetAct = String(effect.params.act || '').trim();
      const stat = String(effect.params.stat || '').trim();
      if (!targetAct || !stat || value === 0) {
        this._recordBlessingEvent('run_start', blessingId, effect, {
          skipped: true,
          reason: 'invalid_act_stat_delta_all_units_params',
        });
        return;
      }

      if (!Array.isArray(this.blessingRuntimeModifiers.actStatDeltaAllUnits)) {
        this.blessingRuntimeModifiers.actStatDeltaAllUnits = [];
      }
      // unitUids: who holds the delta, so the act's end takes it back from them only
      // (a recruit who joined later gets it on joining: grantRecruitBlessingConsumables).
      const tracker = {
        blessingId,
        act: targetAct,
        stat,
        value,
        applied: false,
        reverted: false,
        unitUids: [],
      };
      if (targetAct === this.currentAct) {
        this._applyStatDeltaToUnits(this.roster, stat, value);
        tracker.unitUids = this.roster.map((unit) => this.assignUnitUid(unit));
        tracker.applied = true;
      }
      this.blessingRuntimeModifiers.actStatDeltaAllUnits.push(tracker);
      this._recordBlessingEvent('run_start', blessingId, effect, {
        act: targetAct,
        stat,
        appliedValue: value,
        appliedNow: tracker.applied,
      });
      return;
    }

    if (effect.type === 'act_hit_bonus') {
      const targetAct = String(effect.params.act || '').trim();
      const delta = Math.trunc(value);
      if (!targetAct || delta === 0) {
        this._recordBlessingEvent('run_start', blessingId, effect, {
          skipped: true,
          reason: 'invalid_act_hit_bonus_params',
        });
        return;
      }
      if (
        !this.blessingRuntimeModifiers.actHitBonusByAct ||
        typeof this.blessingRuntimeModifiers.actHitBonusByAct !== 'object'
      ) {
        this.blessingRuntimeModifiers.actHitBonusByAct = {};
      }
      this.blessingRuntimeModifiers.actHitBonusByAct[targetAct] =
        Math.trunc(this.blessingRuntimeModifiers.actHitBonusByAct[targetAct] || 0) + delta;
      this._recordBlessingEvent('run_start', blessingId, effect, {
        act: targetAct,
        appliedValue: delta,
        total: this.blessingRuntimeModifiers.actHitBonusByAct[targetAct],
      });
      return;
    }

    if (effect.type === 'all_act_hit_bonus') {
      const delta = Math.trunc(value);
      if (delta === 0) {
        this._recordBlessingEvent('run_start', blessingId, effect, {
          skipped: true,
          reason: 'zero_all_act_hit_bonus',
        });
        return;
      }
      if (
        !this.blessingRuntimeModifiers.actHitBonusByAct ||
        typeof this.blessingRuntimeModifiers.actHitBonusByAct !== 'object'
      ) {
        this.blessingRuntimeModifiers.actHitBonusByAct = {};
      }
      const acts = ACT_SEQUENCE;
      for (const act of acts) {
        this.blessingRuntimeModifiers.actHitBonusByAct[act] =
          Math.trunc(this.blessingRuntimeModifiers.actHitBonusByAct[act] || 0) + delta;
      }
      this._recordBlessingEvent('run_start', blessingId, effect, {
        appliedValue: delta,
        acts,
        totals: { ...this.blessingRuntimeModifiers.actHitBonusByAct },
      });
      return;
    }

    if (effect.type === 'lord_stat_bonus') {
      const stat = String(effect.params.stat || '').trim();
      if (!stat || value === 0) {
        this._recordBlessingEvent('run_start', blessingId, effect, {
          skipped: true,
          reason: 'invalid_lord_stat_bonus_params',
        });
        return;
      }
      const lords = this.roster.filter((unit) => unit.isLord);
      this._applyStatDeltaToUnits(lords, stat, value);
      this._recordBlessingEvent('run_start', blessingId, effect, {
        stat,
        appliedValue: value,
        appliedUnits: lords.map((u) => u.name),
      });
      return;
    }

    if (effect.type === 'all_units_stat_delta') {
      const stat = String(effect.params.stat || '').trim();
      if (!stat || value === 0) {
        this._recordBlessingEvent('run_start', blessingId, effect, {
          skipped: true,
          reason: 'invalid_all_units_stat_delta_params',
        });
        return;
      }
      this._applyStatDeltaToUnits(this.roster, stat, value);
      this._recordBlessingEvent('run_start', blessingId, effect, {
        stat,
        appliedValue: value,
        appliedUnits: this.roster.map((u) => u.name),
      });
      return;
    }

    if (effect.type === 'skip_first_shop') {
      const enabled = effect.params.enabled !== false;
      this.blessingRuntimeModifiers.skipFirstShop = Boolean(enabled);
      this._recordBlessingEvent('run_start', blessingId, effect, {
        enabled: this.blessingRuntimeModifiers.skipFirstShop,
      });
      return;
    }

    if (effect.type === 'shop_item_count_delta') {
      const delta = Math.trunc(value);
      this.blessingRuntimeModifiers.shopItemCountDelta += delta;
      this._recordBlessingEvent('run_start', blessingId, effect, {
        appliedValue: delta,
        total: this.blessingRuntimeModifiers.shopItemCountDelta,
      });
      return;
    }

    if (effect.type === 'all_growths_delta') {
      const delta = Math.trunc(value);
      if (delta === 0) {
        this._recordBlessingEvent('run_start', blessingId, effect, {
          skipped: true,
          reason: 'zero_all_growths_delta',
        });
        return;
      }
      this.blessingRuntimeModifiers.allGrowthsDelta += delta;
      if (!Array.isArray(this.blessingRuntimeModifiers.allGrowthsDeltas)) {
        this.blessingRuntimeModifiers.allGrowthsDeltas = [];
      }
      this.blessingRuntimeModifiers.allGrowthsDeltas.push(delta);
      this._applyGrowthDeltaToUnits(this.roster, delta);
      this._recordBlessingEvent('run_start', blessingId, effect, {
        appliedValue: delta,
        total: this.blessingRuntimeModifiers.allGrowthsDelta,
        appliedUnits: this.roster.map((u) => u.name),
      });
      return;
    }

    if (effect.type === 'targeted_growths_delta') {
      const delta = Math.trunc(value);
      const scope =
        typeof effect.params.scope === 'string' ? effect.params.scope.trim().toLowerCase() : 'all';
      const stats = [
        ...new Set(
          (Array.isArray(effect.params.stats) ? effect.params.stats : [])
            .filter((stat) => typeof stat === 'string')
            .map((stat) => stat.trim())
            .filter((stat) => XP_STAT_NAMES.includes(stat)),
        ),
      ];
      if (delta === 0 || stats.length <= 0) {
        this._recordBlessingEvent('run_start', blessingId, effect, {
          skipped: true,
          reason: 'invalid_targeted_growths_delta_params',
        });
        return;
      }
      if (!Array.isArray(this.blessingRuntimeModifiers.targetedGrowthsDeltas)) {
        this.blessingRuntimeModifiers.targetedGrowthsDeltas = [];
      }
      this.blessingRuntimeModifiers.targetedGrowthsDeltas.push({ stats, value: delta, scope });
      const units = this._resolveBlessingUnitScope(scope);
      this._applyTargetedGrowthDeltaToUnits(units, stats, delta);
      this._recordBlessingEvent('run_start', blessingId, effect, {
        stats,
        scope,
        appliedValue: delta,
        appliedUnits: units.map((unit) => unit.name),
      });
      return;
    }

    if (effect.type === 'disable_personal_skills_until_act') {
      const targetAct = String(effect.params.act || '').trim();
      const targetIndex = this.actSequence.indexOf(targetAct);
      if (!targetAct || targetIndex === -1) {
        this._recordBlessingEvent('run_start', blessingId, effect, {
          skipped: true,
          reason: 'invalid_disable_personal_skills_until_act_params',
        });
        return;
      }
      const existingAct = this.blessingRuntimeModifiers.disablePersonalSkillsUntilAct;
      if (!existingAct || this.actSequence.indexOf(existingAct) < targetIndex) {
        this.blessingRuntimeModifiers.disablePersonalSkillsUntilAct = targetAct;
      }
      const suppression = this._suppressPersonalSkillsForCurrentRosterIfNeeded();
      this._recordBlessingEvent('run_start', blessingId, effect, {
        targetAct: this.blessingRuntimeModifiers.disablePersonalSkillsUntilAct,
        appliedNow: suppression.applied,
        removedByUnit: suppression.removedByUnit,
      });
      return;
    }

    if (effect.type === 'starting_consumable_all') {
      const itemName = String(effect.params.name || '').trim();
      const template = this.getConsumableTemplate(itemName);
      if (!template) {
        this._recordBlessingEvent('run_start', blessingId, effect, {
          skipped: true,
          reason: 'consumable_not_found',
          requestedName: itemName,
        });
        return;
      }
      let granted = 0;
      for (const unit of this.roster) {
        if (addToConsumables(unit, template)) granted++;
      }
      this._recordBlessingEvent('run_start', blessingId, effect, {
        itemName,
        grantedCount: granted,
        rosterSize: this.roster.length,
      });
      return;
    }

    if (effect.type === 'extra_consumable' || effect.type === 'extra_vulnerary') {
      const itemName =
        typeof effect.params.itemName === 'string' ? effect.params.itemName : 'Vulnerary';
      const configuredCount = effect.params.count ?? effect.params.value ?? value;
      const count = Math.max(0, Math.trunc(Number(configuredCount || 0)));
      if (count <= 0) {
        this._recordBlessingEvent('run_start', blessingId, effect, {
          skipped: true,
          reason: 'invalid_extra_consumable_params',
        });
        return;
      }
      const found = this.getConsumableTemplate(itemName);
      const template = found?.type === 'Consumable' ? found : null;
      if (!template) {
        this._recordBlessingEvent('run_start', blessingId, effect, {
          skipped: true,
          reason: 'missing_consumable_template',
          itemName,
        });
        return;
      }
      let grantedToUnits = 0;
      let grantedToConvoy = 0;
      let overflow = 0;
      const lords = this.roster.filter((unit) => unit.isLord);
      for (const unit of lords) {
        for (let i = 0; i < count; i++) {
          if (addToConsumables(unit, template)) {
            grantedToUnits++;
            continue;
          }
          if (this.addToConvoy(template)) {
            grantedToConvoy++;
          } else {
            overflow++;
          }
        }
      }
      this._recordBlessingEvent('run_start', blessingId, effect, {
        requestedCount: count,
        lordCount: lords.length,
        grantedToUnits,
        grantedToConvoy,
        overflow,
      });
      return;
    }

    if (effect.type === 'starting_random_skill') {
      const count = Math.max(0, Math.trunc(Number(effect.params.count ?? 1)));
      const scope =
        typeof effect.params.scope === 'string'
          ? effect.params.scope.trim().toLowerCase()
          : 'lords';
      if (count <= 0) {
        this._recordBlessingEvent('run_start', blessingId, effect, {
          skipped: true,
          reason: 'invalid_starting_random_skill_count',
        });
        return;
      }

      const validSkills = new Set(
        (this.gameData?.skills || []).map((skill) => skill?.id).filter(Boolean),
      );
      const skillPool = RECRUIT_SKILL_POOL.filter((skillId) => validSkills.has(skillId));
      if (skillPool.length <= 0) {
        this._recordBlessingEvent('run_start', blessingId, effect, {
          skipped: true,
          reason: 'empty_starting_random_skill_pool',
        });
        return;
      }

      const targets = this._resolveBlessingUnitScope(scope);
      const grantedByUnit = {};
      for (const unit of targets) {
        if (!Array.isArray(unit.skills)) unit.skills = [];
        for (let i = 0; i < count; i++) {
          if (unit.skills.length >= MAX_SKILLS) break;
          const candidates = skillPool.filter((skillId) => !unit.skills.includes(skillId));
          if (candidates.length <= 0) break;
          const picked = this._pickDeterministicBlessingItem(
            candidates,
            blessingId,
            `starting_random_skill:${unit.name}:${i}`,
          );
          if (!picked) break;
          unit.skills.push(picked);
          if (!grantedByUnit[unit.name]) grantedByUnit[unit.name] = [];
          grantedByUnit[unit.name].push(picked);
        }
      }
      this._recordBlessingEvent('run_start', blessingId, effect, {
        scope,
        requestedCount: count,
        grantedByUnit,
      });
      return;
    }

    if (effect.type === 'starting_whetstones') {
      const count = Math.max(0, Math.trunc(Number(effect.params.count ?? 1)));
      if (count <= 0) {
        this._recordBlessingEvent('run_start', blessingId, effect, {
          skipped: true,
          reason: 'invalid_starting_whetstones_count',
        });
        return;
      }
      const whetstones = Array.isArray(this.gameData?.whetstones) ? this.gameData.whetstones : [];
      if (whetstones.length <= 0) {
        this._recordBlessingEvent('run_start', blessingId, effect, {
          skipped: true,
          reason: 'missing_whetstone_catalog',
        });
        return;
      }

      const applied = [];
      const forgeStats = ['might', 'crit', 'hit', 'weight'];
      for (let rollIndex = 0; rollIndex < count; rollIndex++) {
        const options = [];
        for (const unit of this.roster) {
          if (!unit.isLord) continue;
          const weapons = [];
          for (const weapon of unit.inventory || []) {
            if (!weapon || ['Staff', 'Consumable', 'Scroll', 'Whetstone'].includes(weapon.type))
              continue;
            if (!weapons.includes(weapon)) weapons.push(weapon);
          }
          if (
            unit.weapon &&
            !['Staff', 'Consumable', 'Scroll', 'Whetstone'].includes(unit.weapon.type) &&
            !weapons.includes(unit.weapon)
          ) {
            weapons.push(unit.weapon);
          }

          for (const weapon of weapons) {
            if (!canForge(weapon)) continue;
            for (const whetstone of whetstones) {
              if (whetstone?.forgeStat === 'choice') {
                for (const stat of forgeStats) {
                  if (canForgeStat(weapon, stat)) {
                    options.push({ unit, weapon, whetstone, stat });
                  }
                }
                continue;
              }
              if (canForgeStat(weapon, whetstone?.forgeStat)) {
                options.push({ unit, weapon, whetstone, stat: whetstone.forgeStat });
              }
            }
          }
        }

        if (options.length <= 0) break;
        const choice = this._pickDeterministicBlessingItem(
          options,
          blessingId,
          `starting_whetstones:${rollIndex}`,
        );
        if (!choice) break;
        const result = applyForge(choice.weapon, choice.stat);
        if (!result.success) continue;
        applied.push({
          unit: choice.unit.name,
          weapon: choice.weapon.name,
          whetstone: choice.whetstone?.name || 'Unknown Whetstone',
          stat: choice.stat,
        });
      }

      this._recordBlessingEvent('run_start', blessingId, effect, {
        requestedCount: count,
        appliedCount: applied.length,
        applied,
      });
      return;
    }

    if (effect.type === 'starting_scroll') {
      const count = Math.max(0, Math.trunc(Number(effect.params.count ?? 1)));
      if (count <= 0) {
        this._recordBlessingEvent('run_start', blessingId, effect, {
          skipped: true,
          reason: 'invalid_starting_scroll_count',
        });
        return;
      }

      const allScrolls = (this.gameData?.weapons || []).filter(
        (item) => item?.type === 'Scroll' && typeof item.teachesWeaponArtId === 'string',
      );
      if (allScrolls.length <= 0) {
        this._recordBlessingEvent('run_start', blessingId, effect, {
          skipped: true,
          reason: 'missing_scroll_catalog',
        });
        return;
      }
      const artById = new Map((this.gameData?.weaponArts?.arts || []).map((art) => [art?.id, art]));
      // `maxUnlockAct` keeps late-act arts out of a day-one grant (Scroll Archive draws
      // only arts that unlock by Act II).
      const actOrder = ['act1', 'act2', 'act3', 'act4'];
      const maxUnlock = actOrder.indexOf(String(effect.params.maxUnlockAct || ''));
      const unlocksInTime = (scroll) => {
        if (maxUnlock < 0) return true;
        const art = artById.get(scroll?.teachesWeaponArtId);
        const idx = actOrder.indexOf(String(art?.unlockAct || 'act1'));
        return idx >= 0 && idx <= maxUnlock;
      };
      const validScrolls = allScrolls.filter(
        (scroll) => unlocksInTime(scroll) && this._isScrollValidForCurrentLords(scroll, artById),
      );
      if (validScrolls.length <= 0) {
        this._recordBlessingEvent('run_start', blessingId, effect, {
          skipped: true,
          reason: 'no_valid_scroll_for_roster',
        });
        return;
      }
      if (!Array.isArray(this.scrolls)) this.scrolls = [];
      const granted = [];
      for (let i = 0; i < count; i++) {
        const picked = this._pickDeterministicBlessingItem(
          validScrolls,
          blessingId,
          `starting_scroll:${i}`,
        );
        if (!picked) break;
        this.scrolls.push(structuredClone(picked));
        granted.push(picked.name);
      }
      this._recordBlessingEvent('run_start', blessingId, effect, {
        requestedCount: count,
        grantedCount: granted.length,
        granted,
      });
      return;
    }

    if (effect.type === 'starting_forge_lords' || effect.type === 'starting_weapon_forge_delta') {
      const forgeStat = String(effect.params.stat || 'might')
        .trim()
        .toLowerCase();
      const resolvedForgeStat = ['might', 'crit', 'hit', 'weight'].includes(forgeStat)
        ? forgeStat
        : 'might';
      const requestedDelta =
        effect.type === 'starting_forge_lords'
          ? Math.max(0, Math.trunc(Number(effect.params.count ?? 1)))
          : Math.trunc(value);
      if (!Number.isFinite(requestedDelta) || requestedDelta === 0) {
        this._recordBlessingEvent('run_start', blessingId, effect, {
          skipped: true,
          reason: 'zero_starting_weapon_forge_delta',
        });
        return;
      }
      const changedWeapons = [];
      const steps = Math.abs(requestedDelta);
      for (const unit of this.roster) {
        if (!unit.isLord) continue;
        const candidates = [];
        for (const weapon of unit.inventory || []) {
          if (!weapon || ['Staff', 'Consumable', 'Scroll'].includes(weapon.type)) continue;
          if (!candidates.includes(weapon)) candidates.push(weapon);
        }
        if (
          unit.weapon &&
          !['Staff', 'Consumable', 'Scroll'].includes(unit.weapon.type) &&
          !candidates.includes(unit.weapon)
        ) {
          candidates.push(unit.weapon);
        }
        for (const weapon of candidates) {
          for (let i = 0; i < steps; i++) {
            if (requestedDelta > 0) {
              const targetStat = resolvedForgeStat;
              if (!canForgeStat(weapon, targetStat)) break;
              const result = applyForge(weapon, targetStat);
              if (!result.success) break;
              changedWeapons.push({
                unit: unit.name,
                weapon: weapon.name,
                stat: targetStat,
                direction: 'forge',
              });
            } else {
              const result = deforgeWeapon(weapon);
              if (!result.success) break;
              changedWeapons.push({
                unit: unit.name,
                weapon: weapon.name,
                stat: result.stat || null,
                direction: 'deforge',
              });
            }
          }
        }
      }
      this._recordBlessingEvent('run_start', blessingId, effect, {
        requestedDelta,
        forgeStat: resolvedForgeStat,
        changedWeapons,
        // A deforge never goes below an unforged weapon; with nothing forged it is void
        // (the shrine does not offer it then — see isBlessingCostApplicable).
        void: changedWeapons.length === 0,
      });
      return;
    }

    if (effect.type === 'starting_best_weapon_forge') {
      // Blood Forge: each starting lord's strongest weapon gains `value` forge steps.
      const forgeStat = String(effect.params.stat || 'might')
        .trim()
        .toLowerCase();
      const targetStat = ['might', 'crit', 'hit', 'weight'].includes(forgeStat)
        ? forgeStat
        : 'might';
      const steps = Math.max(0, Math.trunc(value));
      if (steps <= 0) {
        this._recordBlessingEvent('run_start', blessingId, effect, {
          skipped: true,
          reason: 'zero_starting_best_weapon_forge',
        });
        return;
      }
      const changedWeapons = [];
      for (const unit of this.roster) {
        if (!unit.isLord) continue;
        const weapon = this._bestForgeableWeapon(unit, targetStat);
        if (!weapon) continue;
        const before = weapon.name;
        let applied = 0;
        for (let i = 0; i < steps; i++) {
          // A gift of the shrine, not a purchase: free, so resale value does not grow.
          if (!applyForge(weapon, targetStat, 0, { free: true }).success) break; // the forge limits
          applied++;
        }
        if (applied > 0)
          changedWeapons.push({
            unit: unit.name,
            weapon: before,
            stat: targetStat,
            steps: applied,
          });
      }
      this._recordBlessingEvent('run_start', blessingId, effect, {
        forgeStat: targetStat,
        requestedSteps: steps,
        changedWeapons,
      });
      return;
    }

    if (effect.type === 'act_start_gold') {
      // Advance Pay: the shrine's gold covers the act it is taken in (paid by `gold_delta`),
      // so the first recurring payment is the next act's.
      const amount = Math.max(0, Math.trunc(value));
      if (amount <= 0) {
        this._recordBlessingEvent('run_start', blessingId, effect, {
          skipped: true,
          reason: 'invalid_act_start_gold',
        });
        return;
      }
      this._actStartGrantList().push({
        blessingId,
        kind: 'gold',
        value: amount,
        paidActs: [this.currentAct],
      });
      // Nothing is paid now (the shrine's `gold_delta` covers this act): the record carries
      // the recurring amount, not an applied one.
      this._recordBlessingEvent('run_start', blessingId, effect, {
        recurringValue: amount,
        firstPayment: 'next_act',
      });
      return;
    }

    if (effect.type === 'act_start_convoy_item') {
      // Quartermaster Cache: one item at the start of every act, this one included.
      const itemName = typeof effect.params.itemName === 'string' ? effect.params.itemName : '';
      const count = Math.max(
        0,
        Math.trunc(Number(effect.params.count ?? effect.params.value ?? 1)),
      );
      const template = itemName ? this.getConsumableTemplate(itemName) : null;
      if (count <= 0 || template?.type !== 'Consumable') {
        this._recordBlessingEvent('run_start', blessingId, effect, {
          skipped: true,
          reason: count <= 0 ? 'invalid_act_start_item_count' : 'missing_consumable_template',
          itemName,
        });
        return;
      }
      this._actStartGrantList().push({ blessingId, kind: 'item', itemName, count, paidActs: [] });
      this._recordBlessingEvent('run_start', blessingId, effect, { itemName, count });
      // The current act's delivery is owed now (a church vow in Act 2 pays Act 2 now); the
      // record says whether it came with the shrine or from a church or an event.
      const takenMidRun = (this.activeBlessings || []).some(
        (entry) => getBlessingEntryId(entry) === blessingId && entry?.midRun === true,
      );
      this._payActStartGrants(takenMidRun ? 'mid_run' : 'run_start');
      return;
    }

    if (effect.type === 'eclipse_shadow_delta') {
      // The run's sun starts darker (a pact price). The act's own clock is unmoved:
      // act shadow counts from here, so no node falls because of it; only the
      // Eclipse's phase (enemy levels, affixes) arrives sooner.
      const delta = Math.trunc(value);
      if (!this.eclipse || delta === 0) {
        this._recordBlessingEvent('run_start', blessingId, effect, {
          skipped: true,
          reason: !this.eclipse ? 'no_eclipse' : 'zero_eclipse_shadow_delta',
        });
        return;
      }
      const cap = Math.max(0, Math.trunc(Number(this.getEclipseConfig()?.cap) || 100));
      const before = Math.max(0, Math.trunc(Number(this.eclipse.shadow) || 0));
      const after = Math.max(0, Math.min(cap, before + delta));
      const shift = after - before;
      this.eclipse = {
        ...this.eclipse,
        shadow: after,
        actStartShadow: Math.max(0, Math.trunc(Number(this.eclipse.actStartShadow) || 0) + shift),
      };
      this._recordBlessingEvent('run_start', blessingId, effect, { before, after });
      return;
    }

    if (effect.type === 'xp_multiplier_delta') {
      this.blessingRuntimeModifiers.xpMultiplierDelta += value;
      this._recordBlessingEvent('run_start', blessingId, effect, {
        appliedValue: value,
        total: this.blessingRuntimeModifiers.xpMultiplierDelta,
      });
      return;
    }

    if (effect.type === 'forge_cost_discount' || effect.type === 'forge_cost_multiplier') {
      const discountDelta = effect.type === 'forge_cost_multiplier' ? -value : value;
      this.blessingRuntimeModifiers.forgeCostDiscount += discountDelta;
      this._recordBlessingEvent('run_start', blessingId, effect, {
        appliedValue: discountDelta,
        total: this.blessingRuntimeModifiers.forgeCostDiscount,
      });
      return;
    }

    if (effect.type === 'forge_limit_delta') {
      const delta = Math.trunc(value);
      this.blessingRuntimeModifiers.forgeLimitDelta =
        (this.blessingRuntimeModifiers.forgeLimitDelta || 0) + delta;
      this._recordBlessingEvent('run_start', blessingId, effect, {
        appliedValue: delta,
        total: this.blessingRuntimeModifiers.forgeLimitDelta,
      });
      return;
    }

    if (effect.type === 'shop_first_forge_free') {
      // Smith's Mark: the shop's first forge use is free; the engine decides it per shop from
      // the shop's saved count of uses (ShopCommands.freeForgeAvailable).
      const delta = Math.max(0, Math.trunc(value));
      this.blessingRuntimeModifiers.freeForgesPerShop =
        (this.blessingRuntimeModifiers.freeForgesPerShop || 0) + delta;
      this._recordBlessingEvent('run_start', blessingId, effect, {
        appliedValue: delta,
        total: this.blessingRuntimeModifiers.freeForgesPerShop,
      });
      return;
    }

    if (effect.type === 'extra_shop_per_act') {
      // Pilgrim's Road: this act's map gains its shop now (a grant taken mid-run converts only
      // a node the party can still reach from where it stands), and every later act's map in
      // advanceAct.
      const delta = Math.max(0, Math.trunc(value));
      this.blessingRuntimeModifiers.extraShopsPerAct =
        (this.blessingRuntimeModifiers.extraShopsPerAct || 0) + delta;
      const here = this.nodeMap?.nodes?.find((node) => node.id === this.currentNodeId);
      const converted = this._stampExtraShops({
        fromRow: here ? here.row + 1 : 0,
        currentNodeId: this.currentNodeId,
      });
      this._recordBlessingEvent('run_start', blessingId, effect, {
        appliedValue: delta,
        total: this.blessingRuntimeModifiers.extraShopsPerAct,
        converted,
      });
      return;
    }

    if (effect.type === 'shop_price_discount') {
      const delta = Number(value) || 0;
      this.blessingRuntimeModifiers.shopPriceDiscount += delta;
      this._recordBlessingEvent('run_start', blessingId, effect, {
        appliedValue: delta,
        total: this.blessingRuntimeModifiers.shopPriceDiscount,
      });
      return;
    }

    if (effect.type === 'recruit_level_bonus') {
      this.blessingRuntimeModifiers.recruitLevelBonus += Math.trunc(value);
      this._recordBlessingEvent('run_start', blessingId, effect, {
        appliedValue: Math.trunc(value),
        total: this.blessingRuntimeModifiers.recruitLevelBonus,
      });
      return;
    }

    if (effect.type === 'first_strike_hit_bonus') {
      const delta = Math.trunc(value);
      if (delta === 0) {
        this._recordBlessingEvent('run_start', blessingId, effect, {
          skipped: true,
          reason: 'zero_first_strike_hit_bonus',
        });
        return;
      }
      this.blessingRuntimeModifiers.firstStrikeHitBonus =
        Math.trunc(this.blessingRuntimeModifiers.firstStrikeHitBonus || 0) + delta;
      this._recordBlessingEvent('run_start', blessingId, effect, {
        appliedValue: delta,
        total: this.blessingRuntimeModifiers.firstStrikeHitBonus,
      });
      return;
    }

    if (effect.type === 'stationary_combat_bonus') {
      const defBonus = Math.trunc(Number(effect.params.defBonus) || 0);
      const avoidBonus = Math.trunc(Number(effect.params.avoidBonus) || 0);
      if (defBonus === 0 && avoidBonus === 0) {
        this._recordBlessingEvent('run_start', blessingId, effect, {
          skipped: true,
          reason: 'invalid_stationary_combat_bonus_params',
        });
        return;
      }
      const held = this.blessingRuntimeModifiers.stationaryCombatBonus;
      this.blessingRuntimeModifiers.stationaryCombatBonus = {
        defBonus: Math.trunc(held?.defBonus || 0) + defBonus,
        avoidBonus: Math.trunc(held?.avoidBonus || 0) + avoidBonus,
      };
      this._recordBlessingEvent('run_start', blessingId, effect, {
        defBonus,
        avoidBonus,
        total: { ...this.blessingRuntimeModifiers.stationaryCombatBonus },
      });
      return;
    }

    if (effect.type === 'adjacent_ally_def_bonus') {
      const bonus = parseAdjacentAllyDefBonus(effect.params);
      if (!bonus) {
        this._recordBlessingEvent('run_start', blessingId, effect, {
          skipped: true,
          reason: 'invalid_adjacent_ally_def_bonus_params',
        });
        return;
      }
      this.blessingRuntimeModifiers.adjacentAllyDefBonuses = [
        ...sanitizeAdjacentAllyDefBonuses(this.blessingRuntimeModifiers.adjacentAllyDefBonuses),
        bonus,
      ];
      this._recordBlessingEvent('run_start', blessingId, effect, {
        ...bonus,
        held: this.blessingRuntimeModifiers.adjacentAllyDefBonuses.length,
      });
      return;
    }

    if (effect.type === 'isolated_combat_bonus') {
      const bonus = parseIsolatedCombatBonus(effect.params);
      if (!bonus) {
        this._recordBlessingEvent('run_start', blessingId, effect, {
          skipped: true,
          reason: 'invalid_isolated_combat_bonus_params',
        });
        return;
      }
      this.blessingRuntimeModifiers.isolatedCombatBonuses = [
        ...sanitizeIsolatedCombatBonuses(this.blessingRuntimeModifiers.isolatedCombatBonuses),
        bonus,
      ];
      this._recordBlessingEvent('run_start', blessingId, effect, {
        ...bonus,
        held: this.blessingRuntimeModifiers.isolatedCombatBonuses.length,
      });
      return;
    }

    if (effect.type === 'healing_effectiveness_delta') {
      this.blessingRuntimeModifiers.healingEffectivenessMultiplier += value;
      this._recordBlessingEvent('run_start', blessingId, effect, {
        appliedValue: value,
        total: this.blessingRuntimeModifiers.healingEffectivenessMultiplier,
      });
      return;
    }

    if (effect.type === 'weapon_art_hp_cost_delta') {
      this.blessingRuntimeModifiers.weaponArtHpCostDelta += Math.trunc(value);
      this._recordBlessingEvent('run_start', blessingId, effect, {
        appliedValue: Math.trunc(value),
        total: this.blessingRuntimeModifiers.weaponArtHpCostDelta,
      });
      return;
    }

    if (effect.type === 'player_weapon_art_boon') {
      const boon = parsePlayerWeaponArtBoon(effect.params);
      if (!boon) {
        this._recordBlessingEvent('run_start', blessingId, effect, {
          skipped: true,
          reason: 'invalid_player_weapon_art_boon_params',
        });
        return;
      }
      const { hpCostDelta, mapUsesBonus } = boon;
      this.blessingRuntimeModifiers.playerArtHpCostDelta += hpCostDelta;
      this.blessingRuntimeModifiers.playerArtMapUsesBonus += mapUsesBonus;
      this._recordBlessingEvent('run_start', blessingId, effect, {
        hpCostDelta,
        mapUsesBonus,
        totalHpCostDelta: this.blessingRuntimeModifiers.playerArtHpCostDelta,
        totalMapUsesBonus: this.blessingRuntimeModifiers.playerArtMapUsesBonus,
      });
      return;
    }

    if (effect.type === 'enemy_level_delta') {
      // A pact price on the world, not on a unit: every foe (optionally only in one
      // act) is this many levels higher. Read by getBattleParams.
      const delta = Math.trunc(value);
      const act = typeof effect.params.act === 'string' ? effect.params.act.trim() : null;
      if (delta === 0) {
        this._recordBlessingEvent('run_start', blessingId, effect, {
          skipped: true,
          reason: 'zero_enemy_level_delta',
        });
        return;
      }
      if (!Array.isArray(this.blessingRuntimeModifiers.enemyLevelDeltas))
        this.blessingRuntimeModifiers.enemyLevelDeltas = [];
      this.blessingRuntimeModifiers.enemyLevelDeltas.push({ value: delta, act: act || null });
      this._recordBlessingEvent('run_start', blessingId, effect, { appliedValue: delta, act });
      return;
    }

    if (effect.type === 'burden') {
      this._applyBurdenPrice(blessingId, effect);
      return;
    }

    if (effect.type === 'vision_delta') {
      const before = Number.isFinite(this.visionChargesRemaining)
        ? Math.max(0, Math.trunc(this.visionChargesRemaining))
        : 0;
      this.visionChargesRemaining = Math.max(0, before + Math.trunc(value));
      this._recordBlessingEvent('run_start', blessingId, effect, {
        before,
        after: this.visionChargesRemaining,
      });
      return;
    }

    if (effect.type === 'act_deploy_cap_delta') {
      const act = typeof effect.params.act === 'string' ? effect.params.act : null;
      const delta = Math.trunc(value);
      if (act && delta !== 0) {
        const byAct = (this.blessingRuntimeModifiers.deployCapDeltaByAct ||= {});
        byAct[act] = (byAct[act] || 0) + delta;
      }
      this._recordBlessingEvent('run_start', blessingId, effect, { act, appliedValue: delta });
      return;
    }

    if (effect.type === 'church_revive_disabled') {
      this.blessingRuntimeModifiers.churchReviveDisabled = true;
      this._recordBlessingEvent('run_start', blessingId, effect, {});
      return;
    }

    if (effect.type === 'lord_stat_arc') {
      const tracker = startLordStatArc(this, blessingId, effect.params);
      this._recordBlessingEvent(
        'run_start',
        blessingId,
        effect,
        tracker
          ? {
              dipAct: tracker.dipAct,
              dip: tracker.dip,
              riseAct: tracker.riseAct,
              rise: tracker.rise,
              appliedUnits: tracker.unitUids,
              dipTaken: tracker.dipTaken,
              riseApplied: tracker.riseApplied,
            }
          : { skipped: true, reason: 'invalid_lord_stat_arc_params' },
      );
      return;
    }

    if (effect.type === 'battle_gold_gamble') {
      const gamble = parseBattleGoldGamble(effect.params);
      if (gamble) this.blessingRuntimeModifiers.battleGoldGamble = gamble;
      this._recordBlessingEvent(
        'run_start',
        blessingId,
        effect,
        gamble ? { ...gamble } : { skipped: true, reason: 'invalid_battle_gold_gamble_params' },
      );
      return;
    }

    // The rest of the §5 starting blessings (engine/ShrineBoons.js): null when not one of them.
    const shrine = applyShrineBoon(this, blessingId, effect);
    if (shrine) {
      this._recordBlessingEvent('run_start', blessingId, effect, shrine);
      return;
    }

    if (effect.type === 'act_start_vision_delta') {
      // Second Dawn: +value Vision as each act begins (an act-start grant, paid by
      // _payActStartGrants). The take happens at an act boss, before advanceAct, so the act it
      // is taken in counts as paid: the first payment is the next act's, never the take's.
      const amount = Math.trunc(value);
      if (!(amount > 0)) {
        this._recordBlessingEvent('run_start', blessingId, effect, {
          skipped: true,
          reason: 'invalid_act_start_vision_delta_params',
        });
        return;
      }
      this._actStartGrantList().push({
        blessingId,
        kind: 'vision',
        value: amount,
        paidActs: this.currentAct ? [this.currentAct] : [],
      });
      this._recordBlessingEvent('run_start', blessingId, effect, {
        recurringValue: amount,
        firstPayment: 'next_act',
      });
      return;
    }

    // Earned blessings: only a field is raised here; the battle reads it.
    const earnedModifier = EARNED_BOON_MODIFIERS[effect.type];
    if (earnedModifier) {
      const amount = Math.trunc(value);
      if (!(amount > 0)) {
        this._recordBlessingEvent('run_start', blessingId, effect, {
          skipped: true,
          reason: `invalid_${effect.type}_params`,
        });
        return;
      }
      this.blessingRuntimeModifiers[earnedModifier] =
        Math.max(0, Math.trunc(Number(this.blessingRuntimeModifiers[earnedModifier]) || 0)) +
        amount;
      this._recordBlessingEvent('run_start', blessingId, effect, {
        appliedValue: amount,
        total: this.blessingRuntimeModifiers[earnedModifier],
      });
      return;
    }

    this._recordBlessingEvent('run_start', blessingId, effect, {
      skipped: true,
      reason: 'unhandled_effect_type',
    });
  }

  /**
   * The held earned blessings' battle numbers: `{ lastStand, firstKillHeal, firstTurnMov }`,
   * all 0 when none is held. A battle reads this once, at its start.
   */
  getBattleBlessingEffects() {
    const mods = this.blessingRuntimeModifiers || {};
    const count = (value) => Math.max(0, Math.trunc(Number(value)) || 0);
    return {
      lastStand: count(mods.battleLastStand),
      firstKillHeal: count(mods.firstKillHeal),
      firstTurnMov: count(mods.firstTurnMovDelta),
    };
  }

  /** The held Gambler's Toss (`{ chance, win, lose }`), or null. */
  getBattleGoldGamble() {
    return parseBattleGoldGamble(this.blessingRuntimeModifiers?.battleGoldGamble);
  }

  getBattleGoldMultiplier() {
    const metaDelta = this.metaEffects?.battleGoldMultiplier || 0;
    const blessingDelta = this.blessingRuntimeModifiers?.battleGoldMultiplierDelta || 0;
    return Math.max(0, 1 + metaDelta + blessingDelta);
  }

  getDeployBonus(actId = this.currentAct) {
    const metaDelta = this.metaEffects?.deployBonus || 0;
    const blessingDelta = this.blessingRuntimeModifiers?.deployCapDelta || 0;
    // A price that narrows one act's deploys (resolveDeployLimits keeps max >= the act's min).
    const actDelta = Math.trunc(
      Number(this.blessingRuntimeModifiers?.deployCapDeltaByAct?.[actId]) || 0,
    );
    return metaDelta + blessingDelta + actDelta;
  }

  /** True when a blessing's price closed church revives for this run. */
  isChurchReviveDisabled() {
    return this.blessingRuntimeModifiers?.churchReviveDisabled === true;
  }

  getActHitBonusForUnit(unit, actId = this.currentAct) {
    if (!unit || unit.faction !== 'player') return 0;
    const bonuses = this.blessingRuntimeModifiers?.actHitBonusByAct;
    if (!bonuses || typeof bonuses !== 'object') return 0;
    return Math.trunc(bonuses[actId] || 0);
  }

  getShopItemCountDelta() {
    return Math.trunc(this.blessingRuntimeModifiers?.shopItemCountDelta || 0);
  }

  getXpMultiplierDelta() {
    return this.blessingRuntimeModifiers?.xpMultiplierDelta || 0;
  }

  getForgeCostDiscount() {
    return this.blessingRuntimeModifiers?.forgeCostDiscount || 0;
  }

  getShopPriceDiscount() {
    return this.blessingRuntimeModifiers?.shopPriceDiscount || 0;
  }

  /** Smith's Mark: how many of a shop's first forge uses cost nothing (0 without it). */
  getFreeForgesPerShop() {
    return Math.max(0, Math.trunc(this.blessingRuntimeModifiers?.freeForgesPerShop || 0));
  }

  /** Pilgrim's Road: the shops each act's route gains (0 without it). */
  getExtraShopsPerAct() {
    return Math.max(0, Math.trunc(this.blessingRuntimeModifiers?.extraShopsPerAct || 0));
  }

  /**
   * Pilgrim's Road: make the current map hold its extra shops (an event or church becomes a
   * shop; engine/ExtraShopPass.js, its own seeded stream). Idempotent, so a reload or a second
   * call never adds one; the prologue never has any. Returns the ids converted by this call.
   */
  _stampExtraShops({ fromRow = 0, currentNodeId = null } = {}) {
    const count = this.getExtraShopsPerAct();
    if (count <= 0 || isPrologueRun(this) || !this.nodeMap) return [];
    return stampExtraShops(this.nodeMap, {
      runSeed: this.runSeed,
      count,
      fromRow,
      currentNodeId,
    });
  }

  /** The grants list on the runtime modifiers (made when an older object lacks it). */
  _actStartGrantList() {
    const modifiers = this.blessingRuntimeModifiers;
    if (!Array.isArray(modifiers.actStartGrants)) modifiers.actStartGrants = [];
    return modifiers.actStartGrants;
  }

  /**
   * A lord's strongest weapon that the forge can still improve in `stat` (Blood Forge):
   * the unit's own (equipped or in the bag) combat weapons it can wield, highest current
   * Might first; a tie goes to the equipped weapon, then the earlier bag slot. A weapon at
   * its forge limit, a staff, a scroll and a worn weapon are not candidates, so the next
   * best is chosen instead.
   */
  _bestForgeableWeapon(unit, stat) {
    const ordered = [];
    for (const weapon of [unit.weapon, ...(unit.inventory || [])]) {
      if (weapon && !ordered.includes(weapon)) ordered.push(weapon);
    }
    let best = null;
    for (const weapon of ordered) {
      if (['Staff', 'Consumable', 'Scroll'].includes(weapon.type)) continue;
      if (!canEquip(unit, weapon) || !canForgeStat(weapon, stat)) continue;
      // `ordered` lists the equipped weapon first, then the bag in slot order, so a strict
      // comparison keeps the tie-break.
      if (!best || (Number(weapon.might) || 0) > (Number(best.might) || 0)) best = weapon;
    }
    return best;
  }

  /**
   * Pay the blessings' act-start grants for the act the run is in (docs/specs/blessings-v3.md
   * §4): Advance Pay's gold, Quartermaster Cache's item. A grant pays once per act, however
   * often a save is loaded (`paidActs` is saved). Never in the prologue. Gold goes straight
   * to the purse (Debt garnishes battle gold only). An item goes to the convoy, then to the
   * commander's bag, the other lords', then anyone's; with no room anywhere it is lost, and
   * the act still counts as paid (the shrine's first Elixir did the same).
   * @param {'run_start'|'mid_run'|'act_transition'} stage
   * @returns {Array<object>} what was paid, for the route map's notice
   */
  _payActStartGrants(stage = 'act_transition') {
    if (isPrologueRun(this)) return [];
    const act = this.currentAct;
    if (!act) return [];
    const catalog = this.gameData?.blessings;
    const names = new Map(
      (Array.isArray(catalog?.blessings) ? catalog.blessings : []).map((b) => [b.id, b.name]),
    );
    const paid = [];
    for (const grant of this._actStartGrantList()) {
      if (!grant || !Array.isArray(grant.paidActs) || grant.paidActs.includes(act)) continue;
      grant.paidActs.push(act);
      const blessingName = names.get(grant.blessingId) || grant.blessingId;
      if (grant.kind === 'gold') {
        this.addGold(grant.value);
        this._recordBlessingEvent(
          stage,
          grant.blessingId,
          { type: 'act_start_gold', params: { value: grant.value } },
          { appliedValue: grant.value, act },
        );
        paid.push({
          blessingId: grant.blessingId,
          blessingName,
          kind: 'gold',
          value: grant.value,
        });
        continue;
      }
      if (grant.kind === 'army_stats') {
        // Late Bloom: every unit, the fallen included (a revived ally has kept pace), gains the
        // value in the stats its growths favour (ShrineBoons.lateBloomStats: never Move, no
        // randomness). A living unit's HP gain raises its current HP with it (UnitHealth); the
        // fallen gain none (a revival sets it).
        const count = grant.stats ?? XP_STAT_NAMES.length;
        const classes = this.gameData?.classes || [];
        const living = (this.roster || []).filter((unit) => unit?.stats);
        const fallen = (this.fallenUnits || []).filter((unit) => unit?.stats);
        for (const unit of [...living, ...fallen]) {
          for (const stat of lateBloomStats(unit, count, classes)) {
            unit.stats[stat] = (Number(unit.stats[stat]) || 0) + grant.value;
            if (stat === 'HP' && !fallen.includes(unit))
              setUnitHP(unit, (Number(unit.currentHP) || 0) + grant.value);
          }
        }
        this._recordBlessingEvent(
          stage,
          grant.blessingId,
          { type: 'act_clear_army_stats', params: { value: grant.value, stats: count } },
          {
            appliedValue: grant.value,
            act,
            units: [...living, ...fallen].map((unit) => unitUidOf(unit)),
          },
        );
        paid.push({
          blessingId: grant.blessingId,
          blessingName,
          kind: 'army_stats',
          value: grant.value,
          stats: count,
          units: living.length + fallen.length,
        });
        continue;
      }
      if (grant.kind === 'vision') {
        const before = Number.isFinite(this.visionChargesRemaining)
          ? Math.max(0, Math.trunc(this.visionChargesRemaining))
          : 0;
        this.visionChargesRemaining = before + grant.value;
        this._recordBlessingEvent(
          stage,
          grant.blessingId,
          { type: 'act_start_vision_delta', params: { value: grant.value } },
          { appliedValue: grant.value, act, before, after: this.visionChargesRemaining },
        );
        paid.push({
          blessingId: grant.blessingId,
          blessingName,
          kind: 'vision',
          value: grant.value,
        });
        continue;
      }
      if (grant.kind === 'item') {
        const template = this.getConsumableTemplate(grant.itemName);
        if (template?.type !== 'Consumable') {
          this._recordBlessingEvent(
            stage,
            grant.blessingId,
            { type: 'act_start_convoy_item', params: { itemName: grant.itemName } },
            { skipped: true, reason: 'missing_consumable_template', act },
          );
          continue;
        }
        let toConvoy = 0;
        let toUnits = 0;
        let overflow = 0;
        const holders = [
          this.getCommander(),
          ...this.roster.filter((unit) => unit.isLord),
          ...this.roster,
        ].filter((unit, index, list) => unit && list.indexOf(unit) === index);
        for (let i = 0; i < grant.count; i++) {
          if (this.addToConvoy(template)) toConvoy++;
          else if (holders.some((unit) => addToConsumables(unit, template))) toUnits++;
          else overflow++;
        }
        this._recordBlessingEvent(
          stage,
          grant.blessingId,
          { type: 'act_start_convoy_item', params: { itemName: grant.itemName } },
          { itemName: grant.itemName, count: grant.count, act, toConvoy, toUnits, overflow },
        );
        paid.push({
          blessingId: grant.blessingId,
          blessingName,
          kind: 'item',
          itemName: grant.itemName,
          count: grant.count,
          toConvoy,
          toUnits,
          overflow,
        });
      }
    }
    return paid;
  }

  /** The act-start grants paid since the route map last showed them (not saved). */
  takeActStartNotice() {
    const notice = this._actStartNotice || [];
    this._actStartNotice = null;
    return notice;
  }

  getRecruitLevelBonus() {
    return Math.trunc(this.blessingRuntimeModifiers?.recruitLevelBonus || 0);
  }

  /** Extra enemy levels from blessing pacts for an act (enemy_level_delta). */
  getBlessingEnemyLevelDelta(actId = this.currentAct) {
    const list = this.blessingRuntimeModifiers?.enemyLevelDeltas;
    if (!Array.isArray(list)) return 0;
    return list.reduce(
      (sum, entry) =>
        !entry?.act || entry.act === actId ? sum + Math.trunc(Number(entry?.value) || 0) : sum,
      0,
    );
  }

  /**
   * What the run's blessings add to a combat, for `engine/BlessingCombatMods.js`: the one
   * read BattleScene and the harness make. The act's Hit (Act 1 price included), Keen
   * Eye's first-strike Hit, Hold the Line's stationary bonus, Phalanx Rite's DEF per adjacent
   * ally and Duelist's Creed's isolation bonus.
   */
  getBlessingCombatProfile(actId = this.currentAct) {
    const modifiers = this.blessingRuntimeModifiers;
    const stationary = modifiers?.stationaryCombatBonus;
    return {
      actHitBonus: this.getActHitBonusForUnit({ faction: 'player' }, actId),
      firstStrikeHitBonus: Math.trunc(modifiers?.firstStrikeHitBonus || 0),
      stationary: {
        defBonus: Math.trunc(stationary?.defBonus || 0),
        avoidBonus: Math.trunc(stationary?.avoidBonus || 0),
      },
      adjacentAllyDef: sanitizeAdjacentAllyDefBonuses(modifiers?.adjacentAllyDefBonuses),
      isolated: sanitizeIsolatedCombatBonuses(modifiers?.isolatedCombatBonuses),
    };
  }

  _buildBlessingAllGrowthBonus() {
    const delta = Math.trunc(this.blessingRuntimeModifiers?.allGrowthsDelta || 0);
    if (delta === 0) return null;
    const bonus = {};
    for (const stat of XP_STAT_NAMES) bonus[stat] = delta;
    return bonus;
  }

  _buildScaledBlessingAllGrowthBonus(multiplier) {
    const merged = {};
    const entriesRaw = this.blessingRuntimeModifiers?.allGrowthsDeltas;
    const hasEntryArray = Array.isArray(entriesRaw) && entriesRaw.length > 0;
    const entries = hasEntryArray
      ? entriesRaw
      : Number.isFinite(this.blessingRuntimeModifiers?.allGrowthsDelta) &&
          Math.trunc(this.blessingRuntimeModifiers.allGrowthsDelta) !== 0
        ? [Math.trunc(this.blessingRuntimeModifiers.allGrowthsDelta)]
        : [];
    for (const rawDelta of entries) {
      const delta = Math.trunc(Number(rawDelta) || 0);
      if (delta === 0) continue;
      const scaled = Math.round(delta * multiplier);
      if (scaled === 0) continue;
      for (const stat of XP_STAT_NAMES) {
        merged[stat] = (merged[stat] || 0) + scaled;
      }
    }
    return Object.keys(merged).length > 0 ? merged : null;
  }

  _buildBlessingTargetedGrowthBonus(scope = 'all') {
    const entries = this.blessingRuntimeModifiers?.targetedGrowthsDeltas;
    if (!Array.isArray(entries) || entries.length <= 0) return null;
    const bonus = {};
    const allowScope = new Set(scope === 'lords' ? ['all', 'lords'] : ['all', 'recruits']);
    for (const entry of entries) {
      if (!entry || !allowScope.has(entry.scope || 'all')) continue;
      for (const stat of entry.stats || []) {
        if (!XP_STAT_NAMES.includes(stat)) continue;
        bonus[stat] = (bonus[stat] || 0) + Math.trunc(entry.value || 0);
      }
    }
    return Object.keys(bonus).length > 0 ? bonus : null;
  }

  _buildScaledBlessingTargetedGrowthBonus(scope = 'all', multiplier = 1) {
    const entries = this.blessingRuntimeModifiers?.targetedGrowthsDeltas;
    if (!Array.isArray(entries) || entries.length <= 0) return null;
    const bonus = {};
    const allowScope = new Set(scope === 'lords' ? ['all', 'lords'] : ['all', 'recruits']);
    for (const entry of entries) {
      if (!entry || !allowScope.has(entry.scope || 'all')) continue;
      const delta = Math.trunc(Number(entry.value) || 0);
      if (delta === 0) continue;
      const scaled = Math.round(delta * multiplier);
      if (scaled === 0) continue;
      for (const stat of entry.stats || []) {
        if (!XP_STAT_NAMES.includes(stat)) continue;
        bonus[stat] = (bonus[stat] || 0) + scaled;
      }
    }
    return Object.keys(bonus).length > 0 ? bonus : null;
  }

  _mergeGrowthBonuses(baseBonuses, blessingBonuses) {
    const merged = {};
    for (const stat of XP_STAT_NAMES) {
      const total = (baseBonuses?.[stat] || 0) + (blessingBonuses?.[stat] || 0);
      if (total !== 0) merged[stat] = total;
    }
    return Object.keys(merged).length > 0 ? merged : null;
  }

  getEffectiveRecruitGrowthBonuses() {
    // Scale each source independently before merging. For blessings, scale each effect entry
    // before accumulation to match run-start application order.
    const mult = this._getGrowthBonusMultiplier();
    const scaledMeta = this._scaleGrowthBonuses(this.metaEffects?.growthBonuses || null, mult);
    const scaledAll = this._buildScaledBlessingAllGrowthBonus(mult);
    const scaledTargeted = this._buildScaledBlessingTargetedGrowthBonus('recruits', mult);
    return this._mergeGrowthBonuses(
      this._mergeGrowthBonuses(scaledMeta, scaledAll),
      scaledTargeted,
    );
  }

  getEffectiveLordGrowthBonuses() {
    // Scale each source independently before merging. For blessings, scale each effect entry
    // before accumulation to match run-start application order.
    const mult = this._getGrowthBonusMultiplier();
    const scaledMeta = this._scaleGrowthBonuses(this.metaEffects?.lordGrowthBonuses || null, mult);
    const scaledAll = this._buildScaledBlessingAllGrowthBonus(mult);
    const scaledTargeted = this._buildScaledBlessingTargetedGrowthBonus('lords', mult);
    return this._mergeGrowthBonuses(
      this._mergeGrowthBonuses(scaledMeta, scaledAll),
      scaledTargeted,
    );
  }

  getEffectiveMetaEffects() {
    const base = this.metaEffects ? { ...this.metaEffects } : {};
    const recruitGrowthBonuses = this.getEffectiveRecruitGrowthBonuses();
    const lordGrowthBonuses = this.getEffectiveLordGrowthBonuses();
    base.growthBonuses = recruitGrowthBonuses || {};
    base.lordGrowthBonuses = lordGrowthBonuses || {};
    return base;
  }

  pickNarrativeLine(pool, key) {
    return pickFresh(pool, key, this.narrativeSeen, this.runSeed);
  }

  // ── Third Lord (Power of Friendship meta upgrade) ──────────────

  shouldTriggerThirdLord() {
    if (this.thirdLordJoined) return false;
    if (isPrologueRun(this)) return false; // the prologue's army is authored (§8)
    if (!this.metaEffects?.thirdLordMode) return false;
    if (this.completedBattles !== 3) return false;
    return true;
  }

  canRerollThirdLord() {
    return !this.thirdLordRerolled && this.metaEffects?.thirdLordMode === 'pick3_reroll';
  }

  consumeThirdLordReroll() {
    this.thirdLordRerolled = true;
  }

  // Called only at recruitment, never on resume or revival. Active blessings
  // already persist, including in older saves; no new migration flag is needed.
  /**
   * Portrait variety (src/engine/PortraitVariants.js): give units offered or
   * joining together a stable face, avoiding people the roster already has.
   * Hash-based on the run seed; never draws from Math.random.
   */
  assignPortraitVariants(units) {
    return assignPortraitVariants(units, {
      roster: this.roster,
      fallen: this.fallenUnits,
      seed: this.runSeed,
    });
  }

  /** Every roster/fallen unit has its face (idempotent; legacy units get one). */
  ensurePortraitVariants(seed = this.runSeed) {
    return backfillPortraitVariants(this.roster, { fallen: this.fallenUnits, seed });
  }

  grantRecruitBlessingConsumables(unit) {
    if (!unit) return;
    this._applyActStatDeltasToRecruit(unit);
    if (!this.activeBlessings?.length || !this.gameData?.blessings?.blessings) return;
    const catalog = buildBlessingIndex(this.gameData.blessings);
    for (const active of this.activeBlessings || []) {
      const id = getBlessingEntryId(active);
      const blessing = catalog.get(id);
      for (const effect of blessing?.boons || []) {
        if (effect.type !== 'starting_consumable_all') continue;
        const name = effect.params?.name;
        const key = `${id}:${name}`;
        if (unit.recruitBlessingGrants?.includes(key)) continue;
        const template = this.getConsumableTemplate(name);
        if (!template) continue;
        const granted = addToConsumables(unit, template) || this.addToConvoy(template);
        if (granted) unit.recruitBlessingGrants = [...(unit.recruitBlessingGrants || []), key];
      }
    }
  }

  /**
   * A unit joining mid-act takes the act's running stat blessings and costs ("+2 STR
   * to all units in Act 1"), and is recorded so the act's end takes them back.
   */
  _applyActStatDeltasToRecruit(unit) {
    for (const tracker of this.blessingRuntimeModifiers?.actStatDeltaAllUnits || []) {
      if (!tracker?.applied || tracker.reverted || tracker.act !== this.currentAct) continue;
      if (!Array.isArray(tracker.unitUids)) continue; // legacy tracker: reverts the roster
      const uid = this.assignUnitUid(unit);
      if (!uid || tracker.unitUids.includes(uid)) continue;
      this._applyStatDeltaToUnits([unit], tracker.stat, tracker.value);
      tracker.unitUids.push(uid);
    }
  }

  /**
   * Lord traits come from their own stream keyed by run seed and lord name, so
   * a seeded run is reproducible without shifting any other random stream.
   */
  _lordTraitRng(unit) {
    if (!Number.isFinite(this.runSeed)) return Math.random;
    return createSeededRng(eclipseHash(`lord-trait:${this.runSeed >>> 0}:${unit?.name}`));
  }

  resolveThirdLord(unit) {
    this.thirdLordJoined = true;
    if (unit) {
      rollAndApplyLordTrait(
        unit,
        this.gameData.traits,
        this._lordTraitRng(unit),
        this.legendaryLordChance,
      );
      this.grantRecruitBlessingConsumables(unit);
      this.assignUnitUid(unit);
      this.roster.push(unit);
    }
  }

  /** Names of the lords who have joined this run (roster and fallen). */
  lordNamesInRun() {
    return lordNamesInRun(this);
  }

  consumeSkipFirstShop() {
    if (!this.blessingRuntimeModifiers?.skipFirstShop) return false;
    this.blessingRuntimeModifiers.skipFirstShop = false;
    this._recordBlessingEvent(
      'node_shop',
      null,
      { type: 'skip_first_shop', params: { enabled: true } },
      {
        consumed: true,
      },
    );
    return true;
  }

  getChurchPromotionCount(nodeId) {
    if (this._churchPromotionTracker?.nodeId === nodeId) {
      return this._churchPromotionTracker.count;
    }
    return 0;
  }

  setChurchPromotionCount(nodeId, count) {
    this._churchPromotionTracker = { nodeId, count };
  }

  getWeaponArtSpawnConfig() {
    return {
      weaponArtCatalog: this.gameData?.weaponArts?.arts || [],
      ironArms: Boolean(this.metaEffects?.ironArms),
      steelArms: Boolean(this.metaEffects?.steelArms),
      enableSilver: true,
    };
  }

  _resolveWeaponArtSpawnTier(art) {
    if (!art) return null;
    const explicitTier =
      typeof art.spawnTier === 'string'
        ? art.spawnTier.trim().toLowerCase()
        : typeof art.tierAffinity === 'string'
          ? art.tierAffinity.trim().toLowerCase()
          : '';
    if (explicitTier === 'iron') return 'Iron';
    if (explicitTier === 'steel') return 'Steel';
    if (explicitTier === 'silver') return 'Silver';

    const unlockAct = typeof art.unlockAct === 'string' ? art.unlockAct.trim().toLowerCase() : '';
    if (unlockAct === 'act1') return 'Iron';
    if (unlockAct === 'act2') return 'Steel';
    if (unlockAct === 'act3') return 'Silver';
    return null;
  }

  /** The weapon tiers an art spawns on: its `spawnTiers` list, else its one tier. */
  _resolveWeaponArtSpawnTiers(art) {
    if (Array.isArray(art?.spawnTiers) && art.spawnTiers.length > 0) {
      const tiers = art.spawnTiers.map((tier) =>
        this._resolveWeaponArtSpawnTier({ spawnTier: tier }),
      );
      return [...new Set(tiers.filter(Boolean))];
    }
    const tier = this._resolveWeaponArtSpawnTier(art);
    return tier ? [tier] : [];
  }

  _buildWeaponArtSpawnPools({
    includeIron = false,
    includeSteel = false,
    includeSilver = false,
  } = {}) {
    const enabledTiers = new Set();
    if (includeIron) enabledTiers.add('Iron');
    if (includeSteel) enabledTiers.add('Steel');
    if (includeSilver) enabledTiers.add('Silver');
    if (enabledTiers.size <= 0) return null;

    const catalog = this.gameData?.weaponArts?.arts;
    if (!Array.isArray(catalog) || catalog.length <= 0) return null;

    const poolsByTier = new Map();
    for (const art of catalog) {
      if (!art?.id || art.scrollOnly) continue;
      if (art.legacy === true) continue;
      if (Array.isArray(art.legendaryWeaponIds) && art.legendaryWeaponIds.length > 0) continue;
      const weaponTypes = getWeaponArtAllowedTypes(art).filter((weaponType) =>
        WEAPON_ART_SPAWN_WEAPON_TYPES.has(weaponType),
      );
      if (weaponTypes.length <= 0) continue;
      for (const tier of this._resolveWeaponArtSpawnTiers(art)) {
        if (!enabledTiers.has(tier)) continue;
        if (!poolsByTier.has(tier)) poolsByTier.set(tier, new Map());
        const byType = poolsByTier.get(tier);
        for (const weaponType of weaponTypes) {
          if (!byType.has(weaponType)) byType.set(weaponType, []);
          byType.get(weaponType).push(art.id);
        }
      }
    }

    return poolsByTier.size > 0 ? poolsByTier : null;
  }

  _appendWeaponArtBinding(weapon, artId, source = 'meta_innate') {
    if (!weapon || typeof artId !== 'string' || artId.trim().length <= 0) return false;

    const bindings = getWeaponArtBindings(weapon, { maxSlots: 3 });
    if (bindings.some((binding) => binding.id === artId)) return false;
    if (bindings.length >= 3) return false;

    bindings.push({ id: artId, source });
    weapon.weaponArtIds = bindings.map((binding) => binding.id);
    weapon.weaponArtSources = bindings.map((binding) => binding.source || 'innate');
    weapon.weaponArtId = weapon.weaponArtIds[0];
    weapon.weaponArtSource = weapon.weaponArtSources[0] || 'innate';
    return true;
  }

  _assignMetaWeaponArtsToStartingWeapons(lords) {
    const includeIron = Boolean(this.metaEffects?.ironArms);
    const includeSteel = Boolean(this.metaEffects?.steelArms);
    const addExtraArt = Boolean(this.metaEffects?.artAdept);

    const poolsByTier = this._buildWeaponArtSpawnPools({
      includeIron,
      includeSteel,
      includeSilver: true,
    });
    if (!poolsByTier) return;

    const rollFromPool = (pool) => {
      if (!Array.isArray(pool) || pool.length <= 0) return null;
      return pool[Math.floor(Math.random() * pool.length)] || null;
    };

    const candidatesForAdept = [];

    for (const unit of lords) {
      const inventory = Array.isArray(unit?.inventory) ? unit.inventory : [];
      for (const weapon of inventory) {
        if (!weapon || !WEAPON_ART_SPAWN_WEAPON_TYPES.has(weapon.type)) continue;
        const tier = typeof weapon.tier === 'string' ? weapon.tier : null;
        if (!WEAPON_ART_SPAWN_TIERS.has(tier)) continue;
        if (tier === 'Iron' && !includeIron) continue;
        if (tier === 'Steel' && !includeSteel) continue;

        const pool = poolsByTier.get(tier)?.get(weapon.type) || [];
        if (pool.length <= 0) continue;

        const firstArtId = rollFromPool(pool);
        if (firstArtId) {
          this._appendWeaponArtBinding(weapon, firstArtId, 'meta_innate');
        }

        if (addExtraArt) {
          candidatesForAdept.push({ weapon, pool });
        }
      }
    }

    if (!addExtraArt || candidatesForAdept.length <= 0) return;

    const picked = candidatesForAdept[Math.floor(Math.random() * candidatesForAdept.length)];
    if (!picked?.weapon || !Array.isArray(picked.pool) || picked.pool.length <= 0) return;

    const existingIds = new Set(
      getWeaponArtBindings(picked.weapon, { maxSlots: 3 }).map((binding) => binding.id),
    );
    const available = picked.pool.filter((id) => !existingIds.has(id));
    const extraArtId = rollFromPool(available);
    if (!extraArtId) return;
    this._appendWeaponArtBinding(picked.weapon, extraArtId, 'meta_innate');
  }

  _resolveExtraStarterClassPoolByTier(tier) {
    const numericTier = Math.max(0, Math.trunc(Number(tier) || 0));
    const clampedTier = Math.min(4, numericTier);
    const requestedPool = EXTRA_STARTER_CLASS_POOLS[clampedTier] || [];
    const validClasses = new Set(
      (this.gameData?.classes || []).map((c) => c?.name).filter(Boolean),
    );
    return requestedPool.filter((className) => validClasses.has(className));
  }

  _toRomanNumeral(value) {
    let n = Math.max(1, Math.trunc(Number(value) || 1));
    const map = [
      [1000, 'M'],
      [900, 'CM'],
      [500, 'D'],
      [400, 'CD'],
      [100, 'C'],
      [90, 'XC'],
      [50, 'L'],
      [40, 'XL'],
      [10, 'X'],
      [9, 'IX'],
      [5, 'V'],
      [4, 'IV'],
      [1, 'I'],
    ];
    let out = '';
    for (const [amount, glyph] of map) {
      while (n >= amount) {
        out += glyph;
        n -= amount;
      }
    }
    return out;
  }

  _getTrackedRecruitNames() {
    const tracked = new Set();
    const tracker =
      this.usedRecruitNames && typeof this.usedRecruitNames === 'object'
        ? this.usedRecruitNames
        : {};

    for (const value of Object.values(tracker)) {
      if (!Array.isArray(value)) continue;
      for (const name of value) {
        if (typeof name === 'string' && name.trim().length > 0) tracked.add(name);
      }
    }

    for (const unit of this.roster || []) {
      const name = typeof unit?.name === 'string' ? unit.name.trim() : '';
      if (name) tracked.add(name);
    }

    return tracked;
  }

  _makeUniqueRecruitName(baseName, takenNames) {
    const safeBase =
      typeof baseName === 'string' && baseName.trim().length > 0 ? baseName.trim() : 'Recruit';
    if (!takenNames.has(safeBase)) return safeBase;

    for (let i = 2; i <= 99; i++) {
      const candidate = `${safeBase} ${this._toRomanNumeral(i)}`;
      if (!takenNames.has(candidate)) return candidate;
    }

    const MAX_NAME_ATTEMPTS = 10000;
    for (let i = 2; i < MAX_NAME_ATTEMPTS; i++) {
      const candidate = `${safeBase} ${i}`;
      if (!takenNames.has(candidate)) return candidate;
    }
    console.warn(
      `[RunManager] Name exhaustion for "${safeBase}" after ${MAX_NAME_ATTEMPTS} attempts`,
    );
    return `${safeBase} ${Date.now()}`;
  }

  _trackRecruitNameUse(className, name) {
    if (!this.usedRecruitNames || typeof this.usedRecruitNames !== 'object') {
      this.usedRecruitNames = {};
    }

    const classKey =
      typeof className === 'string' && className.trim().length > 0 ? className.trim() : 'Recruit';

    if (!Array.isArray(this.usedRecruitNames[classKey])) this.usedRecruitNames[classKey] = [];
    if (!this.usedRecruitNames[classKey].includes(name)) {
      this.usedRecruitNames[classKey].push(name);
    }

    if (!Array.isArray(this.usedRecruitNames.__all__)) this.usedRecruitNames.__all__ = [];
    if (!this.usedRecruitNames.__all__.includes(name)) {
      this.usedRecruitNames.__all__.push(name);
    }
  }

  /**
   * Give `unit` a run identity (`unitUid`, UnitIdentity.js) when it has none; a unit
   * that already carries one keeps it and moves the counter past it. Counter-based:
   * never consumes Math.random. Returns the uid.
   */
  assignUnitUid(unit) {
    if (!unit || typeof unit !== 'object') return null;
    if (!Number.isSafeInteger(this.nextUnitUid) || this.nextUnitUid < 1) this.nextUnitUid = 1;
    const existing = unitUidOf(unit);
    if (existing) {
      this.nextUnitUid = Math.max(this.nextUnitUid, unitUidNumber(existing) + 1);
      return existing;
    }
    unit.unitUid = formatUnitUid(this.nextUnitUid++);
    return unit.unitUid;
  }

  /**
   * Every roster and fallen unit carries a distinct uid. Missing ones (legacy saves,
   * units added by a path that did not stamp them) are allocated after the highest
   * uid in use; a uid seen twice keeps its first holder (roster before fallen) and
   * the later copy gets a fresh one. Idempotent.
   */
  ensureUnitUids() {
    const units = [
      ...(Array.isArray(this.roster) ? this.roster : []),
      ...(Array.isArray(this.fallenUnits) ? this.fallenUnits : []),
    ].filter((u) => u && typeof u === 'object');
    if (!Number.isSafeInteger(this.nextUnitUid) || this.nextUnitUid < 1) this.nextUnitUid = 1;
    for (const unit of units)
      this.nextUnitUid = Math.max(this.nextUnitUid, unitUidNumber(unitUidOf(unit)) + 1);
    const seen = new Set();
    for (const unit of units) {
      const uid = unitUidOf(unit);
      if (uid && !seen.has(uid)) {
        seen.add(uid);
        continue;
      }
      delete unit.unitUid;
      seen.add(this.assignUnitUid(unit));
    }
  }

  /**
   * Names promised to the player by recruit nodes not yet walked: the Loom card
   * already shows who waits there (RecruitNodeSystem previews; a locked encounter's
   * NPC counts too). No other unit source may take them.
   * @param {{ excludeNodeId?: string|null }} [options]
   * @returns {Set<string>}
   */
  getPromisedRecruitNames({ excludeNodeId = null } = {}) {
    const promised = new Set();
    for (const node of Array.isArray(this.nodeMap?.nodes) ? this.nodeMap.nodes : []) {
      if (!isRecruitBattleNode(node) || node.completed || node.id === excludeNodeId) continue;
      const names = [
        node.recruitPreview?.name,
        // Open Roll: the candidate not (yet) chosen is promised too, until the node is done.
        node.recruitAlternate?.name,
        this.battleConfigsByNodeId?.[node.id]?.npcSpawn?.name,
      ];
      for (const name of names)
        if (typeof name === 'string' && name.trim()) promised.add(name.trim());
    }
    return promised;
  }

  /**
   * Every name a new unit must not take: the roster, the fallen, names already used
   * this run, and names promised by pending recruit nodes.
   * @param {{ excludeNodeId?: string|null }} [options]
   * @returns {Set<string>}
   */
  getTakenUnitNames(options = {}) {
    const taken = this._getTrackedRecruitNames();
    for (const unit of everFallenUnits(this)) {
      const name = typeof unit?.name === 'string' ? unit.name.trim() : '';
      if (name) taken.add(name);
    }
    for (const name of this.getPromisedRecruitNames(options)) taken.add(name);
    return taken;
  }

  _repairDuplicateRosterNames() {
    if (!Array.isArray(this.roster) || this.roster.length <= 1) return;

    const seen = new Set();
    for (const unit of this.roster) {
      if (!unit || typeof unit !== 'object') continue;

      const rawName = typeof unit.name === 'string' ? unit.name.trim() : '';
      const fallbackBase = typeof unit.className === 'string' ? unit.className.trim() : '';
      const baseName = rawName || fallbackBase || 'Recruit';
      const uniqueName = this._makeUniqueRecruitName(baseName, seen);
      unit.name = uniqueName;
      seen.add(uniqueName);
    }

    for (const unit of this.roster) {
      const name = typeof unit?.name === 'string' ? unit.name.trim() : '';
      if (!name) continue;
      this._trackRecruitNameUse(unit.className, name);
    }
  }

  _pickRecruitNameForClass(className) {
    const namePool = this.gameData?.recruits?.namePool || {};
    const classNames = Array.isArray(namePool[className]) ? namePool[className] : [];
    const usedByClass = Array.isArray(this.usedRecruitNames?.[className])
      ? this.usedRecruitNames[className]
      : [];
    const usedGlobal = this.getTakenUnitNames();

    let name = className;
    if (classNames.length > 0) {
      const available = classNames.filter((n) => !usedByClass.includes(n) && !usedGlobal.has(n));
      if (available.length > 0) {
        name = available[Math.floor(Math.random() * available.length)];
      } else {
        const globallyAvailable = classNames.filter((n) => !usedGlobal.has(n));
        if (globallyAvailable.length > 0) {
          name = globallyAvailable[Math.floor(Math.random() * globallyAvailable.length)];
        } else {
          const baseName = classNames[Math.floor(Math.random() * classNames.length)] || className;
          name = this._makeUniqueRecruitName(baseName, usedGlobal);
        }
      }
    } else {
      name = this._makeUniqueRecruitName(className, usedGlobal);
    }

    this._trackRecruitNameUse(className, name);
    return name;
  }

  _applyExtraStarterPaladinLoadout(unit) {
    const allWeapons = this.gameData?.weapons || [];
    const ironSword = allWeapons.find((w) => w.name === 'Iron Sword');
    const steelLance = allWeapons.find((w) => w.name === 'Steel Lance');

    unit.inventory = [];
    unit.weapon = null;
    if (ironSword) addToInventory(unit, ironSword);
    if (steelLance) addToInventory(unit, steelLance);

    unit.weapon =
      unit.inventory.find((w) => w.name === 'Steel Lance' && canEquip(unit, w)) ||
      unit.inventory.find((w) => canEquip(unit, w)) ||
      null;
    normalizeEquippedFirst(unit);
  }

  _removeWeaponByName(unit, weaponName) {
    const idx = unit.inventory.findIndex((weapon) => weapon?.name === weaponName);
    if (idx === -1) return false;
    const [removed] = unit.inventory.splice(idx, 1);
    if (unit.weapon === removed || unit.weapon?.name === weaponName) {
      unit.weapon = unit.inventory.find((weapon) => canEquip(unit, weapon)) || null;
      normalizeEquippedFirst(unit);
    }
    return true;
  }

  /** First non-Staff proficiency type — the lord's primary weapon type. */
  _getPrimaryWeaponType(unit) {
    const primary = (unit?.proficiencies || []).find((p) => p?.type && p.type !== 'Staff');
    return primary?.type || null;
  }

  /**
   * Build one starting lord. The commander slot carries the extra Steel-tier
   * weapon, Deadly Arsenal loadout, Battle Trinket, and extra Vulnerary;
   * Sera's healer kit (Staff proficiency + staff) travels with Sera herself,
   * whichever slot she occupies.
   */
  _buildStartingLord(lordDef, { isCommander }) {
    const { classes, weapons, accessories } = this.gameData;
    const me = this.metaEffects;
    const classData = classes.find((c) => c.name === lordDef.class);
    const unit = createLordUnit(lordDef, classData, weapons);
    if (isCommander) unit.isCommander = true;
    this._applyLordMetaBonuses(unit);

    if (lordDef.name === 'Sera') {
      if (!unit.proficiencies.some((p) => p.type === 'Staff')) {
        unit.proficiencies.push({ type: 'Staff', rank: 'Prof' });
      }
      // Sera's staff — tier upgrade
      const staffTier = me?.startingStaffTier || 0;
      const staffName = STARTING_STAFF_TIERS[staffTier] || 'Heal';
      const staff = weapons.find((w) => w.name === staffName);
      if (staff) addToInventory(unit, staff);
    }

    // Traits stack after meta bonuses, and after Sera gains her Staff proficiency.
    rollAndApplyLordTrait(
      unit,
      this.gameData.traits,
      this._lordTraitRng(unit),
      this.legendaryLordChance,
    );

    if (isCommander) {
      // Commander's extra combat weapon defaults to the Steel-tier weapon of
      // their primary proficiency, then Deadly Arsenal tiers adjust this loadout.
      const primaryType = this._getPrimaryWeaponType(unit);
      const steelName = LETHAL_ARMORY_WEAPONS[primaryType]?.steel || null;
      const steelWeapon = steelName ? weapons.find((w) => w.name === steelName) : null;
      if (steelWeapon) addToInventory(unit, steelWeapon);
      this._applyDeadlyArsenalLoadout(unit, primaryType);
    }

    // The Vulnerary comes from the catalog, with the uses this run's Vulneraries have.
    const vulnerary = this.getConsumableTemplate(VULNERARY_NAME);
    if (vulnerary) {
      addToConsumables(unit, vulnerary);
      if (isCommander && me?.extraVulnerary) addToConsumables(unit, vulnerary);
    }

    // Starting accessory (Battle Trinket) for the commander
    if (isCommander) {
      const accTier = me?.startingAccessoryTier || 0;
      if (accTier > 0 && accessories) {
        const accName = STARTING_ACCESSORY_TIERS[accTier];
        const acc = accessories.find((a) => a.name === accName);
        if (acc) equipAccessory(unit, ensureItemUid(structuredClone(acc)));
      }
    }

    return unit;
  }

  _applyDeadlyArsenalLoadout(unit, primaryType) {
    const tierFromNewEffect = Math.max(
      0,
      Math.trunc(Number(this.metaEffects?.deadlyArsenalTier) || 0),
    );
    const legacyDeadlyArsenal = Number(this.metaEffects?.deadlyArsenal) > 0;
    const deadlyArsenalTier = Math.max(tierFromNewEffect, legacyDeadlyArsenal ? 2 : 0);
    if (deadlyArsenalTier <= 0) return;

    const byType = LETHAL_ARMORY_WEAPONS[primaryType] || null;
    if (!byType) return;

    // The lord's own personal weapon (weapons.json `signatureOf`); a lord without
    // one falls back to the signature weapon of their primary weapon type.
    const allWeapons = this.gameData?.weapons || [];
    const personal = signatureWeaponFor(unit?.name, allWeapons);
    const byTypeName = DEADLY_ARSENAL_SIGNATURE_WEAPONS[primaryType] || null;
    const signature =
      personal && canEquip(unit, personal)
        ? personal
        : allWeapons.find((weapon) => weapon.name === byTypeName) || null;
    if (!signature) return;
    const silver = byType.silver
      ? allWeapons.find((weapon) => weapon.name === byType.silver)
      : null;

    // Tier 1: replace the Steel slot with the signature weapon.
    if (byType.steel) this._removeWeaponByName(unit, byType.steel);
    addToInventory(unit, signature);

    // Tier 2: add the silver weapon and auto-equip it.
    if (deadlyArsenalTier >= 2 && silver && addToInventory(unit, silver)) {
      const addedSilver = unit.inventory.find((weapon) => weapon?.name === byType.silver);
      if (addedSilver && canEquip(unit, addedSilver)) equipWeapon(unit, addedSilver);
    }
  }

  _createExtraStartingUnit(className) {
    const classes = this.gameData?.classes || [];
    const classData = classes.find((c) => c.name === className);
    if (!classData) return null;

    const recruitDef = {
      name: this._pickRecruitNameForClass(className),
      level: 1,
    };
    const statBonuses = this.metaEffects?.statBonuses || null;
    const growthBonuses = this._scaleGrowthBonuses(
      this.metaEffects?.growthBonuses || null,
      this._getGrowthBonusMultiplier(),
    );
    const randomSkillPool = this.metaEffects?.recruitRandomSkill ? RECRUIT_SKILL_POOL : null;

    const hasRecruitTemplate = classData?.baseStats && classData?.growthRanges;
    const recruitClassData = hasRecruitTemplate
      ? classData
      : classes.find((c) => c.name === classData.promotesFrom);
    if (!recruitClassData?.baseStats || !recruitClassData?.growthRanges) return null;

    const unit = createRecruitUnit(
      recruitDef,
      recruitClassData,
      this.gameData?.weapons || [],
      statBonuses,
      growthBonuses,
      randomSkillPool,
      classes,
      {
        traitsData: this.gameData?.traits || null,
        skillsData: this.gameData?.skills,
        rng: Math.random,
        // The Mark roll: own stream keyed by run seed and the name picked above.
        runSeed: this.runSeed,
        metaEffects: this.metaEffects,
        marksData: this.gameData?.marks || null,
        traitClassData: hasRecruitTemplate ? null : classData,
        // The Cadre is a recruit like any other: seasoned growths and the join bonus.
        seasoned: true,
      },
    );
    if (!hasRecruitTemplate) {
      promoteUnit(unit, classData, classData.promotionBonuses || {}, this.gameData?.skills || []);
    }
    unit.faction = 'player';
    applyRecruitJoinBonus(unit, this.currentAct || 'act1');

    if (className === 'Paladin') {
      this._applyExtraStarterPaladinLoadout(unit);
    }
    grantLethalArmoryWeapon(unit, this.gameData?.weapons || [], this.metaEffects?.lethalArmoryTier);
    if (this.metaEffects?.recruitWeaponForge) {
      applyRecruitWeaponForge(unit, this.metaEffects.recruitWeaponForge);
    }
    // After the forge: Master of Arms extras arrive plain (grantMasterOfArmsWeapons).
    if (this.metaEffects?.masterOfArms) {
      grantMasterOfArmsWeapons(unit, this.gameData?.weapons || []);
    }
    if (this.metaEffects?.recruitStartingAccessory) {
      grantRecruitStartingAccessory(
        unit,
        this.gameData?.accessories || [],
        this.metaEffects.recruitStartingAccessory,
      );
    }
    if (this.metaEffects?.recruitStartingVulnerary) {
      const vulnerary = this.getConsumableTemplate(VULNERARY_NAME);
      if (vulnerary) addToConsumables(unit, vulnerary);
    }
    if (unit.weapon && !canEquip(unit, unit.weapon)) {
      unit.weapon = unit.inventory.find((w) => canEquip(unit, w)) || null;
    }
    return serializeUnit(unit);
  }

  /** Create the two starting lords: the chosen commander + partner (default Edric + Sera). */
  createInitialRoster({ includeVeteran = true } = {}) {
    const { lords } = this.gameData;
    const me = this.metaEffects;
    if (includeVeteran) this._trackRecruitNameUse('Paladin', 'Gaspar');

    // Resolve the starting pair; unknown lord names heal to the default pair.
    const [commanderDef, partnerDef] = resolveStartingLordDefs(me, lords);

    const commanderUnit = this._buildStartingLord(commanderDef, { isCommander: true });
    const partnerUnit = this._buildStartingLord(partnerDef, { isCommander: false });
    const startingLordUnits = [commanderUnit, partnerUnit];

    // Meta weapon-art spawns for starting weapons (Iron/Steel + Art Adept extra slot).
    this._assignMetaWeaponArtsToStartingWeapons(startingLordUnits);

    // Apply weapon forges (unique stats via shuffle) to all lords' combat weapons
    const forgeLevels = me?.startingWeaponForge || 0;
    if (forgeLevels > 0) {
      const FORGE_STATS = ['might', 'crit', 'hit', 'weight'];
      // Honed Blades rolls from the run seed: the same run always gets the same forges.
      const forgeRng = Number.isFinite(this.runSeed)
        ? createSeededRng(eclipseHash(`honed-blades:${this.runSeed >>> 0}`))
        : Math.random;
      for (const unit of startingLordUnits) {
        for (const w of unit.inventory) {
          if (w.type === 'Staff') continue;
          // Fisher-Yates shuffle to pick unique stats (max forgeLevels is 3, FORGE_STATS has 4)
          const shuffled = [...FORGE_STATS];
          for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(forgeRng() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
          }
          const forgeCount = Math.min(forgeLevels, shuffled.length);
          let completed = 0;
          for (const stat of shuffled) {
            if (completed >= forgeCount) break;
            if (applyForge(w, stat)?.success) completed++;
          }
        }
      }
    }

    // Starting reclass seal from meta upgrade
    if (me?.startingReclassSeal) {
      const reclassSeal = this.gameData?.consumables?.find((c) => c.name === 'Infantry Seal');
      if (reclassSeal) this.addToConvoy(reclassSeal);
    }

    // Starting skills from meta skill assignments (keyed by lord name, so
    // assignments for non-selected lords persist harmlessly)
    const skillAssignments = me?.startingSkills || {};
    for (const unit of startingLordUnits) {
      const assigned = skillAssignments[unit.name] || [];
      for (const skillId of assigned) {
        if (!unit.skills.includes(skillId) && unit.skills.length < MAX_SKILLS) {
          unit.skills.push(skillId);
        }
      }
    }

    const roster = startingLordUnits.map((unit) => serializeUnit(unit));
    if (includeVeteran) {
      const veteran = createVeteranKnight(this.gameData, {
        difficultyId: this.difficultyId,
        metaGrowthBonuses: me?.growthBonuses,
        growthMultiplier: this._getGrowthBonusMultiplier(),
      });
      if (veteran) roster.push(serializeUnit(veteran));
    }
    const extraStarterTier = Math.max(0, Math.trunc(Number(me?.extraStartingUnitTier) || 0));
    if (extraStarterTier > 0) {
      const classPool = this._resolveExtraStarterClassPoolByTier(extraStarterTier);
      if (classPool.length > 0) {
        const className = classPool[Math.floor(Math.random() * classPool.length)];
        const extraStarter = this._createExtraStartingUnit(className);
        if (extraStarter) roster.push(extraStarter);
      }
    }

    return roster;
  }

  /** Apply lord meta-progression bonuses (stat + growth) to a lord unit. */
  _applyLordMetaBonuses(unit) {
    if (this.metaEffects?.lordStatBonuses) {
      for (const [stat, bonus] of Object.entries(this.metaEffects.lordStatBonuses)) {
        unit.stats[stat] = (unit.stats[stat] || 0) + bonus;
        if (stat === 'HP') unit.currentHP += bonus;
      }
    }
    if (this.metaEffects?.lordGrowthBonuses) {
      const mult = this._getGrowthBonusMultiplier();
      for (const [stat, bonus] of Object.entries(this.metaEffects.lordGrowthBonuses)) {
        unit.growths[stat] = (unit.growths[stat] || 0) + Math.round(bonus * mult);
      }
    }
  }

  /** Return nodes the player can select next. */
  getAvailableNodes() {
    if (!this.nodeMap) return [];

    // If no node completed yet, only the start node is available
    if (this.currentNodeId === null) {
      const start = this.nodeMap.nodes.find((n) => n.id === this.nodeMap.startNodeId);
      return start ? [start] : [];
    }

    const current = this.nodeMap.nodes.find((n) => n.id === this.currentNodeId);
    if (!current) return [];
    // If current node isn't completed yet, only it is available (re-entry)
    if (!current.completed) return [current];
    // A won event fight whose spoils are still owed holds the party there too: moving on
    // would leave them behind for good, and its page offers Try again and Give up.
    if (eventSpoilsOwedAt(this, current)) return [current];
    // Likewise a kept contract's reward earned here and not yet delivered or given up: the
    // settlement page offers Claim, Roster and a confirmed Give up (engine/ContractSettlement.js).
    if (contractRewardOwedAt(this, current)) return [current];
    // Otherwise, forward edges from the completed node
    return current.edges.map((id) => this.nodeMap.nodes.find((n) => n.id === id)).filter(Boolean);
  }

  /** Mark a node as the current destination. Returns the node. */
  selectNode(nodeId) {
    const node = this.nodeMap.nodes.find((n) => n.id === nodeId);
    if (!node) return null;
    return node;
  }

  /**
   * Recruit nodes carry a fixed preview (class + name) so the Loom can show who waits
   * there. Fills any recruit node that has none (idempotent, own seeded stream). A
   * node whose encounter is already locked shows the recruit that battle spawns.
   */
  ensureRecruitPreviews() {
    if (!Array.isArray(this.nodeMap?.nodes)) return 0;
    for (const node of this.nodeMap.nodes) {
      if (node?.type !== 'recruit') continue;
      const locked = this.battleConfigsByNodeId?.[node.id]?.npcSpawn;
      if (
        typeof locked?.className === 'string' &&
        typeof locked?.name === 'string' &&
        (node.recruitPreview?.className !== locked.className ||
          node.recruitPreview?.name !== locked.name)
      ) {
        node.recruitPreview = {
          v: RECRUIT_PREVIEW_VERSION,
          className: locked.className,
          name: locked.name,
        };
      }
    }
    const context = {
      runSeed: this.runSeed,
      recruits: this.gameData?.recruits,
      usedRecruitNames: this.usedRecruitNames,
      roster: this.roster,
      fallenUnits: everFallenUnits(this),
    };
    const created = ensureRecruitPreviews(this.nodeMap, context);
    // Open Roll: every open recruit node also shows a second candidate (its own stream).
    if (shrineBoonsOf(this).recruitAlternates > 0 && !isPrologueRun(this))
      return created + ensureRecruitAlternates(this.nodeMap, context);
    return created;
  }

  /**
   * Open Roll: meet the other candidate at a recruit node (the loom's "Meet X instead"). The
   * node's preview and alternate change places; refused without the blessing, or once the
   * encounter is locked. The caller saves the run.
   * @returns {{ ok: true, preview: object } | { ok: false, reason: string }}
   */
  swapRecruitCandidate(nodeId) {
    if (shrineBoonsOf(this).recruitAlternates <= 0 || isPrologueRun(this))
      return { ok: false, reason: 'no_blessing' };
    if (this.battleConfigsByNodeId?.[nodeId]) return { ok: false, reason: 'locked' };
    return swapRecruitAlternate(this.nodeMap?.nodes?.find((n) => n.id === nodeId));
  }

  /**
   * Open Roll: the other candidate a recruit node could swap in now (`{ className, name }`), or
   * null (no blessing, no alternate, a locked, done or fallen node).
   */
  getRecruitAlternate(nodeId) {
    if (shrineBoonsOf(this).recruitAlternates <= 0 || isPrologueRun(this)) return null;
    const node = this.nodeMap?.nodes?.find((n) => n.id === nodeId);
    if (node?.type !== 'recruit' || node.completed || node.eclipse || node.encounterLocked)
      return null;
    if (this.battleConfigsByNodeId?.[nodeId]) return null;
    const alt = node.recruitAlternate;
    return typeof alt?.className === 'string' && typeof alt?.name === 'string' ? alt : null;
  }

  /**
   * What a recruit node's elite-like fight adds (difficulty data): extra hunters
   * (`recruitEnemyCountBonus`, applied by MapGenerator) and how many of them carry an
   * affix (`recruitAffixCount`, the hunting party's captain).
   */
  getRecruitNodeBattleMods(node) {
    if (node?.type !== 'recruit') return { enemyCountBonus: 0, affixCount: 0 };
    const int = (key) => Math.max(0, Math.trunc(Number(this.getDifficultyModifier(key, 0)) || 0));
    const nodeAct = node.battleParams?.act || node.act || node.id?.split('_')[0];
    return {
      enemyCountBonus: int('recruitEnemyCountBonus'),
      affixCount: recruitAffixesAllowed(
        {
          isRecruitBattle: true,
          difficultyId: this.difficultyId,
          act: ENEMY_ACT_GATE_ORDER.includes(nodeAct) ? nodeAct : this.currentAct,
        },
        this.gameData?.difficulty,
      )
        ? int('recruitAffixCount')
        : 0,
    };
  }

  /**
   * The game data a recruit battle's unit is built from. A recruit node may roll a lord (the
   * 15% roll in RecruitNodeSystem); an event's green recruit (Old Faces' deserter) never does,
   * so it is built with the lords taken out, exactly as an event `join` is.
   */
  _recruitGameData(node) {
    return node?.type === 'recruit' ? this.gameData : { ...this.gameData, lords: [] };
  }

  /**
   * The class of the unit a recruit node would spawn right now (the lord roll can
   * replace the preview's class), without building it. Same stream and run state as
   * getRecruitNodeUnit, so the two always agree.
   * @returns {string|null}
   */
  getRecruitNodeSpawnClass(node, options = {}) {
    const preview = options.preview || node?.recruitPreview;
    if (!isRecruitBattleNode(node) || !preview) return null;
    return (
      resolveRecruitNodeSpawnClass({
        preview,
        gameData: this._recruitGameData(node),
        ...this.getRecruitBattleContext(node),
        roster: Array.isArray(options.roster) ? options.roster : this.roster,
      })?.className || null
    );
  }

  /**
   * The recruit a recruit node would spawn right now (deterministic for the run's
   * current state; the Loom preview and the battle both come from here).
   * @param {object} node
   * @param {{ roster?: Array }} [options]
   * @returns {{ unit: object, isLord: boolean, level: number } | null}
   */
  getRecruitNodeUnit(node, options = {}) {
    const preview = options.preview || node?.recruitPreview;
    if (!isRecruitBattleNode(node) || !preview) return null;
    return buildRecruitNodeUnit({
      preview,
      gameData: this._recruitGameData(node),
      ...this.getRecruitBattleContext(node),
      roster: Array.isArray(options.roster) ? options.roster : this.roster,
    });
  }

  /**
   * Everything besides the preview that decides a recruit node's unit. Headless
   * drivers copy it into battleParams (recruitRoster, recruitRunSeed, …) so the harness
   * spawns the same recruit the Loom shows.
   */
  getRecruitBattleContext(node) {
    return {
      nodeId: node?.id,
      runSeed: this.runSeed,
      act: node?.battleParams?.act || this.currentAct,
      roster: this.roster,
      fallenUnits: everFallenUnits(this),
      metaEffects: this.getEffectiveMetaEffects(),
      startingLordNames: this.getStartingLordNames(),
      recruitLevelBonus: this.getRecruitLevelBonus(),
      deployBonus: this.getDeployBonus(),
    };
  }

  /** Get battleParams for a battle node. */
  getBattleParams(node) {
    if (!node?.battleParams) return null;
    const battleParams = structuredClone(node.battleParams);
    const isFirstBattle = this.completedBattles === 0;
    battleParams.fogEnabled = !isFirstBattle && Boolean(node.fogEnabled);
    battleParams.firstBattleFightersOnly = isFirstBattle;
    battleParams.excludeOpeningCavaliers = restrictOpeningCavaliers(this);
    battleParams.enemyStatBonus = this.getDifficultyModifier('enemyStatBonus', 0);
    battleParams.classStatBonuses = this.getDifficultyModifier('classStatBonuses', {});
    battleParams.enemyCountBonus = this.getDifficultyModifier('enemyCountBonus', 0);
    battleParams.enemyLevelBonus =
      this.getDifficultyModifier('enemyLevelBonus', 0) +
      this.getBlessingEnemyLevelDelta(battleParams.act || this.currentAct);
    // An event's fight (engine/EventEffects.js `battle`) may be harder by the effect's levels.
    if (Number.isFinite(battleParams.eventEnemyLevelBonus))
      battleParams.enemyLevelBonus += Math.trunc(battleParams.eventEnemyLevelBonus);
    battleParams.bossLevelBonus = this.getDifficultyModifier('bossLevelBonus', 0);
    battleParams.enemySkillChance = this.getDifficultyModifier('enemySkillChance', 0);
    battleParams.enemyCountBase = this.getDifficultyModifier('enemyCountBase', 0);
    battleParams.recruitEnemyCountBonus = this.getDifficultyModifier('recruitEnemyCountBonus', 0);
    battleParams.act1EnemyCountDeployCap = this.getDifficultyModifier('act1EnemyCountDeployCap', 3);
    battleParams.enemyEquipTierShift = this.getDifficultyModifier('enemyEquipTierShift', 0);
    battleParams.xpMultiplier = this.getDifficultyModifier('xpMultiplier', 1);
    battleParams.goldMultiplier = this.getDifficultyModifier('goldMultiplier', 1);
    battleParams.enemyPoisonChance = this.getDifficultyModifier('enemyPoisonChance', 0);
    battleParams.reinforcementTurnOffset = this.getDifficultyModifier('reinforcementTurnOffset', 0);
    battleParams.recruitGuardianChance = this.getDifficultyModifier(
      'recruitGuardianChance',
      Number.isFinite(battleParams.recruitGuardianChance) ? battleParams.recruitGuardianChance : 0,
    );
    battleParams.difficultyId = this.difficultyId || 'normal';
    battleParams.allowEnemyAffixes = recruitAffixesAllowed(battleParams, this.gameData?.difficulty);
    // The Eclipse: phase + eclipsed-node enemy levels and affix overrides. Keys are
    // only added when they change something, so a Pale run's params are unchanged.
    const eclipseMods = eclipseBattleMods({
      state: this.eclipse,
      config: this.getEclipseConfig(),
      difficultyId: battleParams.difficultyId,
      isEclipsed: battleParams.isEclipsed === true,
    });
    if (eclipseMods.enemyLevelBonus) battleParams.enemyLevelBonus += eclipseMods.enemyLevelBonus;
    if (eclipseMods.phaseIndex > 0) battleParams.eclipsePhaseIndex = eclipseMods.phaseIndex;
    if (eclipseMods.affix) battleParams.eclipseAffix = eclipseMods.affix;
    // Recruit nodes are elite-like fights for a known recruit (strategy-layer spec).
    if (isRecruitBattleNode(node) && battleParams.isRecruitBattle) {
      const recruitMods = this.getRecruitNodeBattleMods(node);
      if (recruitMods.affixCount > 0) {
        const affix = battleParams.eclipseAffix || {
          gatingDifficultyId: null,
          extraMaxAffixes: 0,
          guaranteedCount: 0,
          guaranteedTier: 1,
        };
        battleParams.eclipseAffix = {
          ...affix,
          guaranteedCount: Math.max(Number(affix.guaranteedCount) || 0, recruitMods.affixCount),
          guaranteedTier: Math.max(1, Number(affix.guaranteedTier) || 1),
        };
      }
      if (node.recruitPreview?.className && node.recruitPreview?.name) {
        battleParams.recruitPreview = {
          className: node.recruitPreview.className,
          name: node.recruitPreview.name,
        };
        // The unit that actually spawns can differ from the preview's class (a lord
        // roll: a Myrmidon preview can resolve to Rowan, a Chevalier). MapGenerator
        // seats the recruit on a tile that unit can stand on.
        const spawnClassName = this.getRecruitNodeSpawnClass(node);
        if (spawnClassName && spawnClassName !== node.recruitPreview.className)
          battleParams.recruitPreview.spawnClassName = spawnClassName;
      }
      // A recruit battle without a preview (legacy fallback) must not draw a name
      // another recruit node has promised.
      const promised = [...this.getPromisedRecruitNames({ excludeNodeId: node.id })];
      if (promised.length) battleParams.reservedRecruitNames = promised;
    }
    // statusStaffConfig is an object — read directly (getDifficultyModifier coerces objects)
    battleParams.statusStaffConfig = this.difficultyModifiers?.statusStaffConfig ?? null;
    battleParams.siegeWeaponConfig = this.difficultyModifiers?.siegeWeaponConfig ?? null;
    // Carried items (EnemyCarry.js): a run saved before the table existed has none.
    battleParams.carryConfig = this.difficultyModifiers?.carryConfig ?? null;
    // Cutpurse's Luck: the map makes this many carry rolls (EnemyCarry's second pass rolls on
    // its own stream, so the first pass's carriers are the same with or without it). Only
    // written when it changes something, so other runs' params are as they were.
    const shrine = shrineBoonsOf(this);
    if (shrine.carryMultiplier > 1 && battleParams.carryConfig)
      battleParams.carryPasses = shrine.carryMultiplier;
    else delete battleParams.carryPasses;
    // Patient Dawn: turns TurnBonusCalculator.calculatePar adds to the map's par, last.
    if (shrine.parTurnDelta > 0) battleParams.blessingParTurns = shrine.parTurnDelta;
    else delete battleParams.blessingParTurns;
    // Battle pacing (docs/specs/dusk-pressure.md), written into the map when it is
    // generated: the rout ladder, the rung's par inflation, and whether template waves
    // raise par. A run saved before these existed keeps none of them (DIFFICULTY_DEFAULTS).
    battleParams.routLadder = this.difficultyModifiers?.routLadder ?? null;
    const parInflation = this.difficultyModifiers?.parInflation;
    if (Number.isFinite(parInflation)) battleParams.parInflation = parInflation;
    else delete battleParams.parInflation;
    battleParams.templateWavesRaisePar = this.getDifficultyModifier('templateWavesRaisePar', true);
    battleParams.holdShare = this.difficultyModifiers?.holdShare ?? null;
    // Revival Stones (engine/RevivalStones.js): the rung's table, written into the boss spawn
    // when the map is generated. Added only when a kind carries one, so a rung (or a run saved
    // before stones) without them leaves the params exactly as they were.
    if (hasRevivalStones(this.difficultyModifiers?.revivalStones))
      battleParams.revivalStones = { ...this.difficultyModifiers.revivalStones };
    else delete battleParams.revivalStones;
    battleParams.objectiveParOffset = this.difficultyModifiers?.objectiveParOffset ?? null;
    this._repairDuplicateRosterNames();
    // Units enter the battle (RunManager.getRoster clones) with their run identity.
    this.ensureUnitUids();
    this.ensurePortraitVariants();
    battleParams.usedRecruitNames = this.usedRecruitNames || {};
    // The run's burdens (engine/Burdens.js) ride the params, so the map generator, the scene's
    // previews and the headless harness all read one list. Keys are added only when a burden
    // changes the battle, so an unburdened run's params are exactly as they were.
    const bossBattle = node.type === 'boss' || battleParams.isBoss === true;
    const hunted = huntedWaveFor(this, { isBoss: bossBattle });
    if (hunted) battleParams.huntedWave = hunted;
    else delete battleParams.huntedWave;
    if (bossBattle && isSwornEnemy(this))
      battleParams.swornEnemy = { seed: eclipseHash(`sworn:${this.runSeed}:${node.id}`) };
    else delete battleParams.swornEnemy;
    // Battle-start stat deltas: the Lingering Injury burden's, and Cavalier's Hour's by move
    // type (engine/ShrineBoons.js). Applied at a fresh start only; taken back at the battle's end.
    const debuffs = [...battleDebuffsFor(this), ...moveTypeBattleDeltas(this)];
    if (debuffs.length) battleParams.battleDebuffs = debuffs;
    else delete battleParams.battleDebuffs;
    return battleParams;
  }

  /** Merchant Caravan reward: set when a caravan survives a battle; consumed on next NodeMap entry. */
  getPendingCaravanShop() {
    if (this.activeCaravanShop) return this.activeCaravanShop;
    return this.pendingCaravanShop && typeof this.pendingCaravanShop === 'object'
      ? this.pendingCaravanShop
      : null;
  }

  clearPendingCaravanShop() {
    if (!this.pendingCaravanShop && !this.activeCaravanShop) return false;
    this.pendingCaravanShop = null;
    this.activeCaravanShop = null;
    return true;
  }

  getAmbushPendingNode() {
    const pendingNodeId =
      typeof this.pendingAmbushNodeId === 'string' ? this.pendingAmbushNodeId : null;
    if (!pendingNodeId) return null;
    if (!Array.isArray(this.nodeMap?.nodes)) return null;
    return this.nodeMap.nodes.find((node) => node?.id === pendingNodeId) || null;
  }

  /** The event node whose won battle still owes its spoils (EventCommands), or null. */
  getEventPendingNode() {
    const pendingNodeId =
      typeof this.pendingEventNodeId === 'string' ? this.pendingEventNodeId : null;
    if (!pendingNodeId || !Array.isArray(this.nodeMap?.nodes)) return null;
    return this.nodeMap.nodes.find((node) => node?.id === pendingNodeId) || null;
  }

  clearAmbushPendingNode(nodeId = null) {
    if (!this.pendingAmbushNodeId) return false;
    if (nodeId === null || nodeId === undefined) {
      this.pendingAmbushNodeId = null;
      return true;
    }
    if (this.pendingAmbushNodeId !== nodeId) return false;
    this.pendingAmbushNodeId = null;
    return true;
  }

  getLockedBattleConfig(nodeId) {
    const cfg = this.battleConfigsByNodeId?.[nodeId];
    if (!cfg) return null;
    // Recruit encounters locked by older builds seated the recruit by the preview's
    // class; a lord roll can spawn a Cavalry unit there (Rowan on a Mountain). Re-seat
    // it for the unit that spawns (deterministic; the stored lock keeps the fix).
    this._reconcileLockedRecruitTile(nodeId, cfg);
    // Heal exits locked by older builds that only forced Infantry passability
    // (a Mountain exit would soft-lock Cavalry lords on resume).
    return sanitizeEscapeTilePassability(structuredClone(cfg), this.gameData?.terrain);
  }

  _reconcileLockedRecruitTile(nodeId, cfg) {
    if (!cfg?.npcSpawn) return false;
    const node = this.nodeMap?.nodes?.find((n) => n.id === nodeId);
    if (!isRecruitBattleNode(node)) return false;
    const preview = { className: cfg.npcSpawn.className, name: cfg.npcSpawn.name };
    const spawnClassName = this.getRecruitNodeSpawnClass(node, { preview });
    if (!spawnClassName) return false;
    const moveType =
      (this.gameData?.classes || []).find((c) => c.name === spawnClassName)?.moveType || 'Infantry';
    return reconcileRecruitSpawnTile(cfg, {
      moveType,
      terrainData: this.gameData?.terrain,
      classesData: this.gameData?.classes,
      weaponsData: this.gameData?.weapons,
    });
  }

  /** Player spawns on the node's locked map (the deploy cap on re-entry), or null. */
  getLockedSpawnCount(nodeId) {
    const spawns = this.battleConfigsByNodeId?.[nodeId]?.playerSpawns;
    return Array.isArray(spawns) ? spawns.length : null;
  }

  lockBattleConfig(nodeId, battleConfig) {
    if (!nodeId || !battleConfig) return;
    if (!this.battleConfigsByNodeId) this.battleConfigsByNodeId = {};
    if (!this.battleConfigsByNodeId[nodeId]) {
      this.battleConfigsByNodeId[nodeId] = structuredClone(battleConfig);
    }
    const node = this.nodeMap?.nodes?.find((n) => n.id === nodeId);
    if (node) node.encounterLocked = true;
    this._settleCaravanPromise(node);
  }

  /**
   * The route map's "Caravan" tag reads `battleParams.hasCaravan`. Once the node's map is
   * locked the tag follows the result: a map that found no room for the merchant (a rare
   * miss, or a save from before placement had rules) drops the flag, so nothing promised
   * is missing. A placed caravan leaves it set.
   */
  _settleCaravanPromise(node) {
    if (!node?.battleParams?.hasCaravan) return;
    const locked = this.battleConfigsByNodeId?.[node.id];
    if (locked && !locked.caravanSpawn) node.battleParams.hasCaravan = false;
  }

  canReenterService(nodeId) {
    const node = this.nodeMap?.nodes?.find((n) => n.id === nodeId);
    // A won event battle whose spoils are not yet settled, or whose victory page was not
    // closed with Continue, reopens its page (the route map normally opens it on arrival;
    // this is the way back when something stood in front).
    if (
      node?.type === 'event' &&
      node.id === this.currentNodeId &&
      node.completed &&
      !this.battleInProgress &&
      (eventSpoilsOwedAt(this, node) ||
        (this.eventStateByNodeId?.[nodeId]?.battle === 'won' &&
          !this.eventStateByNodeId[nodeId].left))
    )
      return true;
    // A battle node that holds the party for an owed contract reward reopens its settlement page.
    if (node && !this.battleInProgress && contractRewardOwedAt(this, node)) return true;
    return Boolean(
      node &&
      node.id === this.currentNodeId &&
      ['shop', 'church', 'ruins'].includes(node.type) &&
      node.completed &&
      !this.battleInProgress &&
      (node.type !== 'shop' || this.shopStateByNodeId?.[nodeId]),
    );
  }

  // Compatibility for callers explicitly asking about a shop.
  canReenterShop(nodeId) {
    return (
      this.nodeMap?.nodes?.find((n) => n.id === nodeId)?.type === 'shop' &&
      this.canReenterService(nodeId)
    );
  }

  getShopState(nodeId) {
    const state = this.shopStateByNodeId?.[nodeId];
    return state ? structuredClone(state) : null;
  }

  saveShopState(nodeId, state) {
    if (!nodeId || !state) return;
    if (!this.shopStateByNodeId) this.shopStateByNodeId = {};
    this.shopStateByNodeId[nodeId] = structuredClone(state);
  }

  clearShopState(nodeId) {
    if (this.shopStateByNodeId) delete this.shopStateByNodeId[nodeId];
  }

  /** Get a deep copy of the roster for deployment. */
  getRoster() {
    this._sanitizeUnitPools();
    const cloned = JSON.parse(JSON.stringify(this.roster));
    cloned.forEach((u) => {
      relinkWeapon(u);
      normalizeEquippedFirst(u);
    });
    return cloned;
  }

  addGold(amount) {
    this.gold += amount;
  }

  awardGold(amount) {
    const normalizedAmount = Math.trunc(Number(amount) || 0);
    if (normalizedAmount <= 0) return 0;
    this.addGold(normalizedAmount);
    return normalizedAmount;
  }

  getConvoyCapacities() {
    const bonus = Math.max(0, Math.trunc(this.metaEffects?.convoyCapacityBonus || 0));
    return {
      weapons: CONVOY_WEAPON_CAPACITY + bonus,
      consumables: CONVOY_CONSUMABLE_CAPACITY + bonus,
    };
  }

  getConvoyCounts() {
    this._sanitizeUnitPools();
    return {
      weapons: this.convoy.weapons.length,
      consumables: this.convoy.consumables.length,
    };
  }

  getConvoyItems() {
    this._sanitizeUnitPools();
    return {
      weapons: this.convoy.weapons.map((item) => structuredClone(item)),
      consumables: this.convoy.consumables.map((item) => structuredClone(item)),
    };
  }

  canAddToConvoy(item) {
    const bucket = getConvoyBucket(item);
    if (!bucket) return false;
    this._sanitizeUnitPools();
    const caps = this.getConvoyCapacities();
    if (bucket === 'consumables') return this.convoy.consumables.length < caps.consumables;
    return this.convoy.weapons.length < caps.weapons;
  }

  /**
   * The effects a Vulnerary is made under: the run's meta effects (snapshotted when the
   * run started, saved with it), or a prologue run's authored `consumableEffects`
   * (the prologue applies no meta effects). One rule for every item the army acquires.
   */
  _consumableEffects() {
    return isPrologueRun(this)
      ? this.gameData?.prologue?.consumableEffects || null
      : this.metaEffects;
  }

  /**
   * gameData.consumables as this run acquires them: shops, loot and villages draw from
   * this, never from the raw catalog. Items already owned are not touched.
   */
  getConsumableCatalog() {
    return consumableCatalogFor(this.gameData?.consumables, this._consumableEffects());
  }

  /** One catalog consumable by name as this run acquires it (a clone source), or null. */
  getConsumableTemplate(name) {
    return consumableTemplateFor(this.gameData?.consumables, name, this._consumableEffects());
  }

  addToConvoy(item) {
    const bucket = getConvoyBucket(item);
    if (!bucket || !this.canAddToConvoy(item)) return false;
    const clone = ensureItemUid(structuredClone(item));
    if (bucket === 'consumables') {
      this.convoy.consumables.push(clone);
    } else {
      this.convoy.weapons.push(clone);
    }
    return true;
  }

  /**
   * Remove a specific convoy item by uid (both buckets searched). Used by
   * reward-reverting flows (Vision rewind of a village visit) that must undo
   * exactly the item they granted.
   * @returns {object|null} the removed item, or null when no match
   */
  removeFromConvoyByUid(uid) {
    if (typeof uid !== 'string' || !uid) return null;
    this._sanitizeUnitPools();
    for (const bucket of [this.convoy.consumables, this.convoy.weapons]) {
      const idx = (bucket || []).findIndex((item) => item?.uid === uid);
      if (idx !== -1) return bucket.splice(idx, 1)[0];
    }
    return null;
  }

  /**
   * Move eligible fallen-unit items into team storage.
   * Weapons/staves + consumables route to convoy if capacity allows.
   * Accessories route to the team accessory pool.
   * Items that cannot be transferred remain on the fallen unit.
   */
  /**
   * The caravan Merchant (CaravanSystem, `isCaravan`) is an escort NPC, never an army
   * unit. Before Talk learned to ignore it (#139), a lord could recruit it; old saves
   * can hold it on the roster or awaiting revival. Drop it from both, keeping every
   * item it carried: weapons and consumables go to the convoy (past its capacity if
   * need be, so a full convoy never destroys gear; the player can take them out),
   * scrolls to the scroll pool and its accessory to the accessory pool.
   */
  _dropCaravanUnits() {
    if (!Array.isArray(this.roster) || !Array.isArray(this.fallenUnits)) return;
    const caravans = [...this.roster, ...this.fallenUnits].filter((u) => u?.isCaravan);
    if (!caravans.length) return;
    if (!this.convoy || typeof this.convoy !== 'object')
      this.convoy = { weapons: [], consumables: [] };
    if (!Array.isArray(this.convoy.weapons)) this.convoy.weapons = [];
    if (!Array.isArray(this.convoy.consumables)) this.convoy.consumables = [];
    if (!Array.isArray(this.accessories)) this.accessories = [];
    if (!Array.isArray(this.scrolls)) this.scrolls = [];
    for (const unit of caravans) {
      for (const item of caravanCarriedItems(unit)) this._keepMigratedItem(item);
      const accessory = unit.accessory ? unequipAccessory(unit) : null;
      if (accessory) this.accessories.push(ensureItemUid(accessory));
      unit.inventory = [];
      unit.consumables = [];
      unit.weapon = null;
    }
    this.roster = this.roster.filter((u) => !u?.isCaravan);
    this.fallenUnits = this.fallenUnits.filter((u) => !u?.isCaravan);
  }

  /** Store an item taken off a unit that is leaving the run; never refuses it. */
  _keepMigratedItem(item) {
    if (!item || typeof item !== 'object') return;
    if (this.addToConvoy(item)) return;
    const kept = ensureItemUid(item);
    if (kept.type === 'Accessory') this.accessories.push(kept);
    else if (kept.type === 'Scroll') this.scrolls.push(kept);
    else if (kept.type === 'Consumable') this.convoy.consumables.push(kept);
    else this.convoy.weapons.push(kept);
  }

  _transferFallenUnitItems(fallenUnit) {
    if (!fallenUnit || typeof fallenUnit !== 'object') return;
    this._sanitizeUnitPools();
    if (!Array.isArray(this.accessories)) this.accessories = [];

    const inventory = Array.isArray(fallenUnit.inventory) ? fallenUnit.inventory : [];
    const consumables = Array.isArray(fallenUnit.consumables) ? fallenUnit.consumables : [];
    const carriedCount = inventory.length + consumables.length;
    const hadAccessory = Boolean(fallenUnit.accessory);

    // Handle corrupted legacy data where equipped weapon is absent from inventory
    // or represented by a deep-equal-but-different object reference.
    const equipped = fallenUnit.weapon;
    if (equipped) {
      let equippedInInventory = inventory.includes(equipped);
      if (!equippedInInventory && inventory.length > 0) {
        const equippedUid = typeof equipped.uid === 'string' ? equipped.uid : '';
        let equivalent = null;
        if (equippedUid) {
          equivalent = inventory.find((item) => item?.uid === equippedUid) || null;
        }
        if (!equivalent) {
          const equippedSig = legacyItemSignature(equipped);
          equivalent = inventory.find((item) => legacyItemSignature(item) === equippedSig) || null;
        }
        if (equivalent) {
          fallenUnit.weapon = equivalent;
          equippedInInventory = true;
        }
      }

      if (!equippedInInventory) {
        if (this.addToConvoy(equipped)) {
          fallenUnit.weapon = null;
        } else {
          // Keep blocked equipped item recoverable on revive.
          inventory.push(equipped);
        }
      }
    }

    const keptInventory = [];
    for (const item of inventory) {
      if (!this.addToConvoy(item)) keptInventory.push(item);
    }
    fallenUnit.inventory = keptInventory;

    const keptConsumables = [];
    for (const item of consumables) {
      if (!this.addToConvoy(item)) keptConsumables.push(item);
    }
    fallenUnit.consumables = keptConsumables;

    if (fallenUnit.accessory) {
      // Unequip (reversing its stats and move type) before pooling, so the fallen
      // unit keeps its base stats: a revived unit never carries a phantom bonus.
      const accessory = unequipAccessory(fallenUnit);
      this.accessories.push(ensureItemUid(structuredClone(accessory)));
    }

    relinkWeapon(fallenUnit);
    normalizeEquippedFirst(fallenUnit);
    const retained = [...fallenUnit.inventory, ...fallenUnit.consumables];
    const moved = Math.max(0, carriedCount - retained.length);
    fallenUnit._fallenItemsNotice = `${fallenUnit.name}: ${moved} item${moved === 1 ? '' : 's'} moved to convoy.${hadAccessory ? ' Accessory returned to the team pool.' : ''}${retained.length ? ` Convoy full: ${retained.map((item) => item.name).join(', ')} remain with this ally until revival.` : ''}`;
  }

  takeFromConvoy(type, index) {
    this._sanitizeUnitPools();
    if (!Number.isInteger(index) || index < 0) return null;
    if (type === 'consumable') {
      if (index >= this.convoy.consumables.length) return null;
      return this.convoy.consumables.splice(index, 1)[0];
    }
    if (type === 'weapon') {
      if (index >= this.convoy.weapons.length) return null;
      return this.convoy.weapons.splice(index, 1)[0];
    }
    return null;
  }

  spendGold(amount) {
    if (amount > this.gold) return false;
    this.gold -= amount;
    return true;
  }

  /**
   * Mark a battle as suspended-in-progress. The flag carries the entry
   * snapshot needed to (a) resume the battle later ("Continue from battle")
   * and (b) cleanly revert it ("Continue from map" — the sanctioned FE-reset
   * full revert, which restores the entry-time Vision/RNG values below).
   * The suspend checkpoint itself is attached via setBattleCheckpoint as the
   * battle progresses.
   */
  beginBattleInProgress(nodeId, entryInfo = {}) {
    // A battle that never reached its first checkpoint (beginBattle threw and sent the player
    // back to the route map) leaves its flag in memory. A Watcher's Grace it granted goes back
    // before the new entry snapshot, or the granted charge would become the entry and be
    // granted again.
    if (this.battleInProgress && !this.battleInProgress.checkpoint)
      restoreUncheckpointedBossVision(this, this.battleInProgress);
    // Healed to full since taking off an HP accessory: the debt is gone before battle.
    for (const unit of this.roster || []) settleAccessoryHpOwed(unit);
    if (this.currentAct === 'act1' && entryInfo.isBoss === true) this.reachedFirstActBoss = true;
    this.battleInProgress = {
      rewindPolicy: 'fixed-v1',
      entryBattleState: structuredClone({
        convoy: this.convoy,
        accessories: this.accessories,
        gold: this.gold,
      }),
      nodeId: typeof nodeId === 'string' ? nodeId : null,
      startedAt: Date.now(),
      battleParams:
        entryInfo.battleParams && typeof entryInfo.battleParams === 'object'
          ? structuredClone(entryInfo.battleParams)
          : null,
      isBoss: entryInfo.isBoss === true,
      isElite: entryInfo.isElite === true,
      visionChargesAtEntry: Number.isFinite(this.visionChargesRemaining)
        ? this.visionChargesRemaining
        : null,
      visionCountAtEntry: Number.isFinite(this.visionCount) ? this.visionCount : null,
      rngSeedAtEntry: Number.isFinite(this.rngSeed) ? this.rngSeed : null,
      // The prologue's Vision grant reverts with the battle (a restart re-teaches it).
      ...(isPrologueRun(this)
        ? { prologueVisionGrantedAtEntry: this.prologueVisionGranted === true }
        : {}),
      checkpoint: null,
    };
    // Watcher's Grace: a boss map's extra Vision charge, granted AFTER the entry snapshot above,
    // so Continue from Map (which restores the entry's charges) takes it back, and recorded on
    // the flag so the victory commit can take back what was not spent. Called at a fresh start
    // only (a resume keeps the flag it had), so a resume never grants twice.
    const grace = entryInfo.isBoss === true && !isPrologueRun(this) ? this._bossBattleVision() : 0;
    if (grace > 0) {
      const before = Number.isFinite(this.visionChargesRemaining)
        ? Math.max(0, Math.trunc(this.visionChargesRemaining))
        : 0;
      this.visionChargesRemaining = before + grace;
      this.battleInProgress.bossVisionGranted = grace;
    }
  }

  /** Watcher's Grace: Vision charges a boss map grants (0 without it). */
  _bossBattleVision() {
    return shrineBoonsOf(this).bossBattleVision;
  }

  /**
   * Take back a Watcher's Grace charge the battle did not spend (at its victory). Charges spent
   * this battle are counted by the rewinds made since entry (`visionCount`); a grace spent is
   * gone, an unspent one fades with the battle. Never below 0.
   * @returns {number} the charges taken back
   */
  _settleBossBattleVision(flag) {
    const granted = Math.max(0, Math.trunc(Number(flag?.bossVisionGranted) || 0));
    if (granted <= 0) return 0;
    const spent = Number.isFinite(flag.visionCountAtEntry)
      ? Math.max(0, (Number(this.visionCount) || 0) - flag.visionCountAtEntry)
      : 0;
    const before = Math.max(0, Math.trunc(Number(this.visionChargesRemaining) || 0));
    const takeBack = Math.min(before, Math.max(0, granted - spent));
    this.visionChargesRemaining = before - takeBack;
    return takeBack;
  }

  /** Attach/replace the suspend checkpoint for the in-progress battle. */
  setBattleCheckpoint(checkpoint) {
    if (!this.battleInProgress) return;
    this.battleInProgress.checkpoint =
      checkpoint && typeof checkpoint === 'object' ? checkpoint : null;
  }

  clearBattleInProgress() {
    this.battleInProgress = null;
  }

  /**
   * Sanctioned full revert ("Continue from Map") applied to live memory:
   * restore the entry-time convoy/accessories/gold, refund entry Vision and
   * RNG, then drop the suspend flag. Mirrors clearBattleInProgressInSave so
   * the in-memory run and the raw save agree. Refuses a fatal-pending
   * checkpoint: that outcome must be decided, never reverted for free.
   * @returns {boolean} true when a suspended battle was reverted
   */
  revertBattleInProgressToEntry() {
    const flag = this.battleInProgress;
    if (!flag || typeof flag !== 'object') return false;
    if (flag.checkpoint?.recoveryKind === 'fatal_pending') return false;
    return applyBattleEntryRevert(this, flag);
  }

  /**
   * The prologue's restart ("Not this thread", §9): a named unit fell, so the chapter
   * starts again from its entry. The same revert as Continue from Map, but a fatal
   * checkpoint is no bar: the prologue never settles a defeat, and the standard run's
   * guard (revertBattleInProgressToEntry) is untouched. The roster is never written
   * mid-battle, so the units re-enter as they entered. Returns false outside the
   * prologue or with no battle in progress.
   */
  restartPrologueBattle() {
    const flag = this.battleInProgress;
    if (!isPrologueRun(this) || !flag || typeof flag !== 'object') return false;
    this.lastBattleReport = null;
    return applyBattleEntryRevert(this, flag);
  }

  /**
   * The route-map node a victory would still complete, or null: it exists and is not done.
   * `completeBattle` applies a victory only for such a node, so this is also the rule for
   * "will this battle settle anything" (engine/ContractStanding.js).
   */
  openBattleNode(nodeId) {
    const node = this.nodeMap?.nodes?.find((n) => n.id === nodeId);
    return node && !node.completed ? node : null;
  }

  /**
   * Called after a battle victory. Serializes surviving units back to roster.
   * @param {Array} survivingUnits - units from BattleScene (with Phaser fields)
   * @param {string} nodeId - the node that was just completed
   * @param {number} goldEarned - accumulated kill gold from battle
   * @param {{ completionGoldOverride?: number, caravanSurvived?: boolean, fallenRecruits?: object[], fallenBattleRecords?: object[] }} [options]
   *   fallenRecruits: serialized units that joined mid-battle (Talk) and fell
   *   before victory — recorded as fallen allies like roster casualties.
   *   fallenBattleRecords: each casualty's death record (DeedSystem
   *   `fallenBattleRecord`, deeds committed at victory): its deeds and its bags.
   * @returns {boolean} true when completion was applied; false for invalid/duplicate node
   */
  completeBattle(survivingUnits, nodeId, goldEarned = 0, options = {}) {
    // Battle is over either way — never leave a stale suspend flag that
    // would offer to resume a finished fight on the next load. A Watcher's Grace charge the
    // battle did not spend fades with it (before the act boss's own +1 below).
    this._settleBossBattleVision(this.battleInProgress);
    this.battleInProgress = null;
    const node = this.openBattleNode(nodeId);
    if (!node) return false;
    if (this.totalTurns !== null)
      this.totalTurns += Math.max(0, Math.trunc(options.turnCount) || 0);
    // The battle's gold is known before anything is committed, so burdens settle in one
    // place (Burdens.burdenEffectsOnVictory: pure; assigned below, at the victory commit
    // and nowhere else, so a reverted or suspended battle never touches them).
    const completionGold = Number.isFinite(options?.completionGoldOverride)
      ? Math.max(0, Math.floor(options.completionGoldOverride))
      : undefined;
    const effectiveNodeType = node?.isAmbush ? 'battle' : node?.type;
    const baseGold = calculateBattleGold(goldEarned, effectiveNodeType, completionGold);
    const eliteMult = node?.battleParams?.isElite ? ELITE_GOLD_MULTIPLIER : 1;
    const goldMult = this.getBattleGoldMultiplier();
    const difficultyGoldMult = this.getDifficultyModifier('goldMultiplier', 1);
    const wholeGold = Math.floor(baseGold * eliteMult * goldMult * difficultyGoldMult);
    // Gambler's Toss: doubled or cut to a third on the node's own seeded toss, after the elite, Merchant
    // Bane and rung multipliers and before a Debt garnishes what is left.
    const heldGamble = this.getBattleGoldGamble();
    const gambleRecord = heldGamble
      ? settleBattleGoldGamble({
          runSeed: this.runSeed,
          nodeId,
          gamble: heldGamble,
          gold: wholeGold,
        })
      : null;
    const finalGold = gambleRecord ? gambleRecord.goldAfter : wholeGold;
    // Which burdens this battle touches: a boss node ends a Sworn Enemy and was never hunted;
    // a battle whose locked map carries the Hunted wave counts one down (no locked map: the
    // headless sims and tests, where every non-boss battle was generated with it).
    const bossNode = node.type === 'boss' || node.battleParams?.isBoss === true;
    const lockedConfig = this.battleConfigsByNodeId?.[nodeId];
    const settlement = burdenEffectsOnVictory(this, {
      gold: finalGold,
      battle: {
        boss: bossNode,
        hunted: !bossNode && (lockedConfig ? isHuntedBattle(lockedConfig) : true),
      },
    });
    const eclipseCommit = this._commitBattleShadow(node, options, settlement.extraShadow);

    this._sanitizeUnitPools();
    this.ensureUnitUids();
    // Who fell: every unit that entered the battle — the roster as it entered, then
    // recruits who joined mid-battle (Talk) and fell before it ended (they never
    // reached the roster) — that no survivor accounts for. Matched by unit identity,
    // one survivor per unit, so a living namesake (a mercenary hired under the name a
    // recruit node promised, a legacy save) can never hide a casualty.
    const { newlyFallen, survivorOf } = resolveBattleCasualties({
      roster: this.roster,
      survivors: survivingUnits,
      fallenRecruits: options?.fallenRecruits,
      isValidUnit: (unit) => this._isValidSerializedUnit(unit),
    });
    const entrantOf = new Map([...survivorOf].map(([entrant, survivor]) => [survivor, entrant]));
    this.lastBattleCasualtyNotices = [];
    for (const fallen of newlyFallen) {
      const fallenUid = unitUidOf(fallen);
      if (!fallenUid || !this.fallenUnits.some((f) => unitUidOf(f) === fallenUid)) {
        const serializedFallen = serializeUnit(fallen);
        this.assignUnitUid(serializedFallen);
        // The casualty is the unit as it entered the battle; its death record
        // adds what it did there (kills, deeds) and swaps in the bags it carried
        // as it fell, so a traded, given or drunk item is neither duplicated,
        // lost nor refunded. No record (an older checkpoint): the entry bags.
        applyFallenBattleRecord(
          serializedFallen,
          findFallenBattleRecord(options?.fallenBattleRecords, serializedFallen),
        );
        this._transferFallenUnitItems(serializedFallen);
        // Where they fell, for the victory record (the battle's number as deeds count it).
        serializedFallen.fellAt = {
          act: this.currentAct || null,
          battle: (Number(this.completedBattles) || 0) + 1,
        };
        this.lastBattleCasualtyNotices.push(serializedFallen._fallenItemsNotice);
        this.fallenUnits.push(serializedFallen);
        // Narrative memory: lords who fell in a battle that actually
        // completed (a reverted battle never reaches this point).
        if (fallen.isLord && !fallen.isCommander) {
          if (!Array.isArray(this.runLordFalls)) this.runLordFalls = [];
          this.runLordFalls.push(fallen.name);
        }
      }
    }

    this.roster = survivingUnits.map((u) => {
      const data = serializeUnit(u);
      // Statuses (sleep, acid, Wounded…) are the battle's: they end with it, so a
      // Wounded unit can still be healed on the route map.
      delete data._conditions;
      // Legacy battle units (a checkpoint from before unit identity) inherit the
      // identity of the roster unit they account for; new recruits get one below.
      const entrantUid = unitUidOf(entrantOf.get(u));
      if (!unitUidOf(data) && entrantUid) data.unitUid = entrantUid;
      return data;
    });
    this.ensureUnitUids();
    // Refill at the completed-battle boundary so rewards and the node-map
    // roster show ready staves. Never do this during serialization/resume.
    // Include stored and casualty-retained equipment, not consumables.
    for (const unit of [...this.roster, ...this.fallenUnits]) {
      for (const item of [...(unit.inventory || []), unit.weapon]) {
        if (item?.perBattleUses) item._usesSpent = 0;
      }
    }
    for (const item of this.convoy.weapons || []) {
      if (item?.perBattleUses) item._usesSpent = 0;
    }
    this._suppressPersonalSkillsForCurrentRosterIfNeeded();
    this.completedBattles++;
    this.winStreak++;
    if (this.winStreak > this.maxWinStreak) this.maxWinStreak = this.winStreak;
    this.awardGold(settlement.gold);
    // A wound whose unit fell (or left) in this battle ends with it: nobody carries it on.
    this.burdens = pruneGoneWounds(settlement.burdens, this.roster);
    this.lastBattleGoldGamble = gambleRecord;
    this.lastBurdenSettlement = settlement.record
      ? {
          nodeId,
          ...settlement.record,
          goldBefore: finalGold,
          goldAfter: settlement.gold,
          garnished: settlement.garnished,
          extraShadow: settlement.extraShadow,
        }
      : null;
    // An open contract settles here too (engine/ContractSettlement.js), once, for this victory
    // and no other: after the roster, gold and burdens are committed, so a reward lands on
    // the army as it now is and a penalty Debt starts with the NEXT victory. Never mid-battle,
    // so a revert or a resume never touches it. `newlyFallen` is who fell in THIS battle.
    this.lastContractSettlement = settleContract(this, {
      nodeId,
      turnCount: options.turnCount,
      turnPar: options.turnPar,
      losses: newlyFallen.length,
    });

    const isRewardBossNode = isActBossVictory(this, node);
    const isRewardAct =
      this.nodeMap?.actId === 'act1' ||
      this.nodeMap?.actId === 'act2' ||
      this.nodeMap?.actId === 'act3' ||
      this.nodeMap?.actId === 'act4';
    // The prologue's last chapter grants no Vision (§8): P3's exercise is its only charge.
    if (isRewardBossNode && isRewardAct && !isPrologueRun(this)) {
      const currentVision = Number.isFinite(this.visionChargesRemaining)
        ? Math.max(0, Math.trunc(this.visionChargesRemaining))
        : 0;
      this.visionChargesRemaining = currentVision + 1;
    }
    // An act boss (never the final act's, the prologue's, an elite's or an event's) owes an
    // earned-blessing pick: rolled here, on its own seeded stream, so it is in this victory's
    // save and a reload offers the same pair (engine/EarnedBlessings.js). The pick is shown
    // after the boss's reward, recruit and lord, before the act advances.
    if (actBossPickDue(this, node)) prepareEarnedBlessingPick(this, node);

    if (node?.isAmbush && node.ambushCleared !== true) {
      node.ambushCleared = true;
      this.pendingAmbushNodeId = nodeId;
    }
    // A won event battle: its spoils apply when the route map takes over (EventCommands).
    if (node?.eventBattle === true) this.pendingEventNodeId = nodeId;
    if (options?.caravanSurvived === true) {
      this.pendingCaravanShop = { actId: this.currentAct };
    }
    this.markNodeComplete(nodeId);
    // The prologue's authored joins commit with the victory (the same save).
    if (isPrologueRun(this)) this._applyPrologueJoins(node);
    if (eclipseCommit) eclipseCommit.fell = this.applyEclipseNow().map((n) => n.id);
    this.lastEclipseCommit = eclipseCommit;
    return true;
  }

  // ── The Eclipse ────────────────────────────────────────────────────────

  /** data/eclipse.json, or null (the Eclipse is inert without it). */
  getEclipseConfig() {
    const config = this.gameData?.eclipse;
    return config && typeof config === 'object' ? config : null;
  }

  isEclipseActive() {
    return isEclipseActive(this.eclipse, this.getEclipseConfig());
  }

  /**
   * Shadow a victory at `turnsTaken` against `par` would gather (HUD projection): the
   * act pressure gains all of it; the global meter up to its cap (projectedMeterGain).
   */
  projectShadowGain(turnsTaken, par) {
    if (!this.isEclipseActive()) return 0;
    return computeShadowGain(
      { turnsTaken, par: Number.isFinite(par) ? par : null, difficultyId: this.difficultyId },
      this.getEclipseConfig(),
    );
  }

  /**
   * Victory commit: add the battle's shadow and, for the act boss, the flare.
   * Returns the commit record (null when the Eclipse is off or nothing is known).
   */
  _commitBattleShadow(node, options = {}, burdenShadow = 0) {
    if (!this.isEclipseActive()) return null;
    const config = this.getEclipseConfig();
    const before = this.eclipse.shadow;
    const gain = computeShadowGain(
      {
        turnsTaken: options.turnCount,
        par: Number.isFinite(options.turnPar) ? options.turnPar : null,
        difficultyId: this.difficultyId,
      },
      config,
    );
    const isBoss = node.id === this.nodeMap?.bossNodeId && node.type === 'boss';
    const relief = isBoss ? Math.max(0, Math.trunc(Number(config.bossRelief) || 0)) : 0;
    // An Ill Omen (engine/Burdens.js) adds its shadow to the battle's gain, before the cap.
    const burden = Math.max(0, Math.trunc(Number(burdenShadow) || 0));
    // The global meter stops at the cap; the act's pressure takes the whole gain.
    const commit = commitShadow(this.eclipse, { gain: gain + burden, relief }, config);
    this.eclipse = commit.state;
    return {
      nodeId: node.id,
      before,
      gain: gain + burden,
      burdenShadow: burden,
      relief,
      after: commit.after,
      meterGain: commit.meterGain,
      actBefore: commit.actBefore,
      actAfter: commit.actAfter,
      fell: [],
    };
  }

  /**
   * Let the dark take this act's map at the current act shadow (idempotent). The one place a fall
   * is decided, in play and on load (`fromJSON` calls it too), so both choose a Dark Omen or a
   * battle for an event node the same way. `activeNodeId` is the battle being fought, exempt like
   * the current node; a load passes the saved one, as `battleInProgress` is not restored yet.
   */
  applyEclipseNow({ activeNodeId = this.battleInProgress?.nodeId || null } = {}) {
    if (!this.isEclipseActive() || !this.nodeMap) return [];
    return applyEclipse({
      state: this.eclipse,
      config: this.getEclipseConfig(),
      nodeMap: this.nodeMap,
      runSeed: this.runSeed,
      currentNodeId: this.currentNodeId,
      activeNodeId,
      mapTemplates: this.gameData?.mapTemplates || null,
      fogChanceBonus: this.getDifficultyModifier('fogChanceBonus', 0),
      halfFogChance: this.difficultyId === 'normal',
      // A fallen event that has a dark face to offer stays an event (a Dark Omen).
      darkOmen: (node) => hasDarkOmen(this, node),
      // Omen Reader: the node types the dark spares (here and on load alike).
      spareTypes: shrineBoonsOf(this).eclipseSpareTypes,
    });
  }

  /** Presentation view of the Eclipse for this act (see EclipseSystem.buildEclipseView). */
  getEclipseView({ reachableIds = null, activeNodeId = null } = {}) {
    if (!this.nodeMap) return null;
    return buildEclipseView({
      state: this.eclipse,
      config: this.getEclipseConfig(),
      nodeMap: this.nodeMap,
      runSeed: this.runSeed,
      currentNodeId: this.currentNodeId,
      activeNodeId: activeNodeId || this.battleInProgress?.nodeId || null,
      reachableIds,
      // Omen Reader: spared types never show a fall; the next falls are marked `foretold`.
      spareTypes: shrineBoonsOf(this).eclipseSpareTypes,
      foretell: shrineBoonsOf(this).eclipseForetell,
    });
  }

  /** Enemy levels the Eclipse adds to a node's battle (phase + eclipsed node). */
  getEclipseLevelBonus(node) {
    if (!node?.battleParams) return 0;
    return eclipseBattleMods({
      state: this.eclipse,
      config: this.getEclipseConfig(),
      difficultyId: this.difficultyId || 'normal',
      isEclipsed: node.battleParams.isEclipsed === true,
    }).enemyLevelBonus;
  }

  /** Church Kindle: pay gold to lift shadow, once per church node. */
  kindleSun(nodeId) {
    const result = kindleResult({
      state: this.eclipse,
      config: this.getEclipseConfig(),
      nodeId,
      actId: this.currentAct,
      gold: this.gold,
    });
    if (!result.ok) return result;
    if (!this.spendGold(result.price)) return { ok: false, reason: 'Not enough gold.' };
    this.eclipse = result.state;
    return {
      ok: true,
      price: result.price,
      removed: result.removed,
      actRemoved: result.actRemoved,
      shadow: this.eclipse.shadow,
      actShadow: this.eclipse.actShadow,
    };
  }

  /** The Loom played these nodes' fall; never play it again (persisted by the caller). */
  markEclipseSeen(nodeIds) {
    const ids = new Set(Array.isArray(nodeIds) ? nodeIds : []);
    let changed = false;
    for (const node of this.nodeMap?.nodes || []) {
      if (!ids.has(node.id) || !node.eclipse || node.eclipse.seen === true) continue;
      node.eclipse.seen = true;
      changed = true;
    }
    return changed;
  }

  /**
   * Rest: heal all roster units to full HP, mark node complete.
   * @param {string} nodeId - the rest node
   */
  rest(nodeId) {
    for (const unit of this.roster) healUnitFully(unit);
    this.markNodeComplete(nodeId);
  }

  /**
   * Revive a fallen unit, restore to roster at 1 HP.
   * @param {object|string} unitRef - the fallen unit (preferred: two fallen allies may
   *   share a name), its `unitUid`, or — legacy callers — its name (first match)
   * @param {number} cost - gold cost (scales with level/promotion)
   * @returns {boolean} true if revived, false if the unit is not fallen or gold is short
   *   (the roster has no cap)
   */
  reviveFallenUnit(unitRef, cost) {
    // Verify unit exists before spending gold (prevents burning currency on stale names)
    const idx = this._findFallenIndex(unitRef);
    if (idx === -1) return false;

    if (!this.spendGold(cost)) return false;

    const unit = this.fallenUnits.splice(idx, 1)[0];
    delete unit.fellAt; // Back among the living: the record's Fallen list is for the dead.

    // Normalize class state after serialization round-trip (fixes promotion eligibility)
    const classData = (this.gameData?.classes || []).find((c) => c.name === unit.className);
    if (classData) normalizeUnitClassState(unit, classData);
    ensureSeraBaseStaffProficiency(unit);
    relinkWeapon(unit);
    normalizeEquippedFirst(unit);
    // Stable catch-up rolls on retry/reload; the action chooser does not consume this stream.
    let seed = Number(this.runSeed) >>> 0;
    for (const ch of `revive:${unit.name}:${unit.className}:${unit.level}`)
      seed = Math.imul(seed ^ ch.charCodeAt(0), 16777619) >>> 0;
    this.lastRevivalResult = applyRevivalCatchUp(
      unit,
      this.roster,
      this.gameData?.classes || [],
      createSeededRng(seed),
    );
    setUnitHP(unit, 1); // Catch-up HP gains do not turn revival into a full heal.
    delete unit._accessoryHpOwed; // A revived unit owes nothing from its last life.
    // Death sent its gear to the convoy: an unarmed unit comes back with an Iron weapon.
    const starter = grantReviveStarterWeapon(unit, this.gameData?.weapons || [], INVENTORY_MAX);
    this.lastRevivalResult = {
      ...(this.lastRevivalResult || {}),
      starterWeapon: starter?.name || null,
    };

    this.roster.push(unit);
    return true;
  }

  _findFallenIndex(unitRef) {
    const fallen = Array.isArray(this.fallenUnits) ? this.fallenUnits : [];
    if (unitRef && typeof unitRef === 'object') {
      const exact = fallen.indexOf(unitRef);
      if (exact !== -1) return exact;
      const uid = unitUidOf(unitRef);
      if (uid) return fallen.findIndex((u) => unitUidOf(u) === uid);
      return fallen.findIndex((u) => u?.name === unitRef.name);
    }
    if (typeof unitRef !== 'string' || !unitRef) return -1;
    const byUid = fallen.findIndex((u) => unitUidOf(u) === unitRef);
    return byUid !== -1 ? byUid : fallen.findIndex((u) => u?.name === unitRef);
  }

  /** Mark a node as completed and update currentNodeId. */
  markNodeComplete(nodeId) {
    // A unit that rested or healed to full since taking off an HP accessory owes nothing.
    for (const unit of this.roster || []) settleAccessoryHpOwed(unit);
    const node = this.nodeMap.nodes.find((n) => n.id === nodeId);
    if (node) node.completed = true;
    this.currentNodeId = nodeId;
  }

  /** True if the boss node of the current act is completed. */
  isActComplete() {
    if (!this.nodeMap) return false;
    const boss = this.nodeMap.nodes.find((n) => n.id === this.nodeMap.bossNodeId);
    return boss ? boss.completed : false;
  }

  /**
   * Run node-map generation under a seeded Math.random derived from runSeed + the
   * current act, so a given (runSeed, act) always yields the same graph.
   * NodeMapGenerator uses ambient Math.random; this scopes it with the same
   * install/restore pattern as BattleScene.withBattleSeed. No player-visible change
   * today (runSeed defaults to Date.now()); this unblocks seeded/daily runs.
   */
  _withNodeMapSeed(fn) {
    const base = Number.isFinite(this.runSeed) ? this.runSeed >>> 0 : 0;
    let h = 2166136261 >>> 0;
    const input = `nodemap:${base}:${this.currentAct}`;
    for (let i = 0; i < input.length; i++) {
      h ^= input.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const prevRandom = Math.random;
    Math.random = createSeededRng(h >>> 0);
    try {
      return fn();
    } finally {
      Math.random = prevRandom;
    }
  }

  /**
   * Advance to the next act. Generates a new node map and pays the blessings' act-start
   * grants. Returns { unlockedArtIds, displacedSkills, actStartGrants }.
   */
  advanceAct() {
    this._revertActScopedBlessingEffects(this.currentAct);
    if (this.actIndex >= this.actSequence.length - 1)
      return { unlockedArtIds: [], displacedSkills: {}, actStartGrants: [] };
    this.actIndex++;
    this._restoreDisabledPersonalSkillsIfReady('act_transition');
    // Act-entry blessing effects (Slow Fuse's rise) land before the rest, so the army starts
    // the act whole at its new maximum.
    applyArcsOnActEntry(this);
    // The act boss has fallen: the army rests before the next act and starts it whole.
    for (const unit of this.roster) if (unit?.stats) healUnitFully(unit);
    this.nodeMap = this._withNodeMapSeed(() =>
      generateNodeMap(this.currentAct, this.currentActConfig, this.gameData.mapTemplates, {
        fogChanceBonus: this.getDifficultyModifier('fogChanceBonus', 0),
        halfFogChance: this.difficultyId === 'normal',
        villageAmbushChance: this.getDifficultyModifier('villageAmbushChance', 0),
        // an object — read directly (getDifficultyModifier coerces objects)
        villageMinRow: this.difficultyModifiers?.villageMinRow ?? null,
        colosseumConfig: this.gameData.colosseum?.nodeGeneration ?? null,
        caravanChanceBonus: this.metaEffects?.caravanChanceBonus || 0,
      }),
    );
    // Pilgrim's Road: the new map gains its extra shop before anything else reads it.
    this._stampExtraShops();
    // The finished act's locked maps go with its route map: nothing reads a node that is
    // no longer on the map (pruneLockedBattleConfigs), and no node of the new map has been
    // entered, so none of it is locked yet. Saved by the same write as the act advance.
    this.battleConfigsByNodeId = {};
    this.shopStateByNodeId = {};
    this.ruinsChoiceByNodeId = {};
    this.churchVowByNodeId = {};
    // Each act's events are its own (the log, flags and burdens run on).
    this.eventStateByNodeId = {};
    this.pendingEventNodeId = null;
    this.ensureRecruitPreviews();
    // Every act opens on a fresh land: act pressure restarts at 0 (the global meter,
    // after any boss relief, carries on).
    this.eclipse = beginActShadow(this.eclipse);
    const unlockedNow = this._syncActWeaponArtUnlocksForCurrentAct();
    const displacedSkills = this._lastRestorationDisplacements || {};
    this._lastRestorationDisplacements = null;
    this.currentNodeId = null;
    this.pendingAmbushNodeId = null;
    this.pendingCaravanShop = null;
    this.activeCaravanShop = null;
    this.applyEclipseNow();
    // Advance Pay, Quartermaster Cache: paid once the new act's map stands.
    const actStartGrants = this._payActStartGrants('act_transition');
    this._actStartNotice = actStartGrants.length > 0 ? actStartGrants : null;
    return { unlockedArtIds: unlockedNow, displacedSkills, actStartGrants };
  }

  _revertActScopedBlessingEffects(expiredAct) {
    revertArcDipsForExpiredAct(this, expiredAct);
    const trackers = this.blessingRuntimeModifiers?.actStatDeltaAllUnits;
    if (!Array.isArray(trackers) || !expiredAct) return;
    for (const tracker of trackers) {
      if (!tracker || tracker.reverted || !tracker.applied || tracker.act !== expiredAct) continue;
      // Only the units that received it (a save from before holders were tracked
      // reverts the whole roster, as it always did).
      const holders = Array.isArray(tracker.unitUids)
        ? [...this.roster, ...(this.fallenUnits || [])].filter((unit) =>
            tracker.unitUids.includes(unitUidOf(unit)),
          )
        : this.roster;
      for (const unit of holders) {
        unit.stats[tracker.stat] = (unit.stats[tracker.stat] || 0) - tracker.value;
        if (tracker.stat === 'HP') {
          unit.currentHP = Math.min(unit.currentHP || 0, unit.stats.HP || 0);
        }
      }
      tracker.reverted = true;
      this._recordBlessingEvent(
        'act_transition',
        tracker.blessingId,
        {
          type: 'act_stat_delta_all_units',
          params: { act: tracker.act, stat: tracker.stat, value: tracker.value },
        },
        { revertedInAct: expiredAct, stat: tracker.stat, revertedValue: -tracker.value },
      );
    }
  }

  /** True if the final boss has been defeated. */
  isRunComplete() {
    return this.actIndex >= this.actSequence.length - 1 && this.isActComplete();
  }

  _getActOrderIndex(actId) {
    if (!actId) return -1;
    return this.actSequence.indexOf(String(actId));
  }

  _isWeaponArtEligibleForCurrentAct(art) {
    if (!art || !art.id) return false;
    const unlockAct = art.unlockAct || this.actSequence[0] || 'act1';
    const requiredIndex = this._getActOrderIndex(unlockAct);
    if (requiredIndex === -1) return false;
    return this.actIndex >= requiredIndex;
  }

  _getWeaponArtCatalogIds() {
    const arts = this.gameData?.weaponArts?.arts;
    if (!Array.isArray(arts) || arts.length === 0) return new Set();
    const ids = new Set();
    for (const art of arts) {
      if (typeof art?.id === 'string' && art.id.length > 0) ids.add(art.id);
    }
    return ids;
  }

  _normalizeUnlockedWeaponArtIds(ids) {
    if (!Array.isArray(ids)) return [];
    const validIds = this._getWeaponArtCatalogIds();
    const seen = new Set();
    const normalized = [];
    for (const id of ids) {
      if (typeof id !== 'string' || id.length <= 0) continue;
      if (!validIds.has(id)) continue;
      if (seen.has(id)) continue;
      seen.add(id);
      normalized.push(id);
    }
    return normalized;
  }

  _rebuildUnlockedWeaponArts() {
    const merged = [];
    const seen = new Set();
    const pushAll = (ids) => {
      for (const id of this._normalizeUnlockedWeaponArtIds(ids)) {
        if (seen.has(id)) continue;
        seen.add(id);
        merged.push(id);
      }
    };
    pushAll(this.metaUnlockedWeaponArts);
    pushAll(this.actUnlockedWeaponArts);
    this.metaUnlockedWeaponArts = this._normalizeUnlockedWeaponArtIds(this.metaUnlockedWeaponArts);
    this.actUnlockedWeaponArts = this._normalizeUnlockedWeaponArtIds(this.actUnlockedWeaponArts);
    this.unlockedWeaponArts = merged;
    return [...this.unlockedWeaponArts];
  }

  _syncMetaWeaponArtUnlocks() {
    const ids = this.metaEffects?.metaUnlockedWeaponArts;
    this.metaUnlockedWeaponArts = this._normalizeUnlockedWeaponArtIds(ids);
    return this._rebuildUnlockedWeaponArts();
  }

  _syncActWeaponArtUnlocksForCurrentAct() {
    const arts = this.gameData?.weaponArts?.arts;
    if (!Array.isArray(arts)) return [];
    const before = new Set(this.unlockedWeaponArts || []);
    const unlocked = new Set(this._normalizeUnlockedWeaponArtIds(this.actUnlockedWeaponArts));
    const addedIds = [];
    for (const art of arts) {
      if (!art?.id) continue;
      if (!this._isWeaponArtEligibleForCurrentAct(art)) continue;
      if (unlocked.has(art.id)) continue;
      unlocked.add(art.id);
      addedIds.push(art.id);
    }
    this.actUnlockedWeaponArts = [...unlocked];
    this._rebuildUnlockedWeaponArts();
    return addedIds.filter((id) => !before.has(id));
  }

  isWeaponArtUnlocked(artId) {
    if (!artId) return false;
    if (!Array.isArray(this.unlockedWeaponArts)) return false;
    return this.unlockedWeaponArts.includes(artId);
  }

  unlockWeaponArt(artId) {
    if (!artId) return false;
    const validIds = this._getWeaponArtCatalogIds();
    if (!validIds.has(artId)) return false;
    if (!Array.isArray(this.actUnlockedWeaponArts)) this.actUnlockedWeaponArts = [];
    if (this.isWeaponArtUnlocked(artId)) return false;
    this.actUnlockedWeaponArts.push(artId);
    this._rebuildUnlockedWeaponArts();
    return true;
  }

  getUnlockedWeaponArtIds() {
    return Array.isArray(this.unlockedWeaponArts) ? [...this.unlockedWeaponArts] : [];
  }

  getMetaUnlockedWeaponArtIds() {
    return Array.isArray(this.metaUnlockedWeaponArts) ? [...this.metaUnlockedWeaponArts] : [];
  }

  getActUnlockedWeaponArtIds() {
    return Array.isArray(this.actUnlockedWeaponArts) ? [...this.actUnlockedWeaponArts] : [];
  }

  getUnlockedWeaponArts(catalog = null) {
    const source = Array.isArray(catalog)
      ? catalog
      : Array.isArray(this.gameData?.weaponArts?.arts)
        ? this.gameData.weaponArts.arts
        : [];
    if (!Array.isArray(source) || source.length === 0) return [];
    const unlocked = new Set(this.getUnlockedWeaponArtIds());
    return source.filter((art) => art?.id && unlocked.has(art.id));
  }

  applyDifficultySelection(difficultyId = 'normal') {
    const resolved = resolveDifficultyMode(this.gameData?.difficulty, difficultyId);
    this.difficultyId = resolved.id;
    this.difficultyModifiers = {
      ...resolved.modifiers,
      actsIncluded: sanitizeActSequence(
        resolved.modifiers.actsIncluded || DIFFICULTY_DEFAULTS.actsIncluded,
        DIFFICULTY_DEFAULTS.actsIncluded,
      ),
    };
    this.actSequence = sanitizeActSequence(this.difficultyModifiers.actsIncluded, ACT_SEQUENCE);
    if (this.actIndex >= this.actSequence.length) {
      this.actIndex = Math.max(0, this.actSequence.length - 1);
    }
  }

  getDifficultyModifier(key, fallback = 0) {
    const value = this.difficultyModifiers?.[key];
    if (typeof fallback === 'boolean') return typeof value === 'boolean' ? value : fallback;
    if (Array.isArray(fallback)) return Array.isArray(value) ? value : fallback;
    return Number.isFinite(value) ? value : fallback;
  }

  _getGrowthBonusMultiplier() {
    return this.getDifficultyModifier('growthBonusMultiplier', 1);
  }

  _scaleGrowthBonuses(bonuses, multiplier) {
    if (!bonuses || multiplier === 1) return bonuses;
    const scaled = {};
    for (const [stat, val] of Object.entries(bonuses)) {
      if (!Number.isFinite(val) || val === 0) continue;
      const sv = Math.round(val * multiplier);
      if (sv !== 0) scaled[stat] = sv;
    }
    return Object.keys(scaled).length > 0 ? scaled : null;
  }

  /**
   * Mark the run as a defeat.
   * @param {{defeatedBy?: string|null, wasBoss?: boolean}|null} context - who
   *   ended the run (for narrative memory). Abandon/retreat callers pass
   *   nothing: retreating is not "slain by".
   */
  failRun(context = null) {
    // The prologue never settles a defeat (§8): its falls restart the chapter. A
    // caller that gets here in prologue mode is a bug; nothing is recorded.
    if (isPrologueRun(this)) {
      console.warn('[RunManager] failRun refused: the prologue restarts, never fails');
      return false;
    }
    this.status = 'defeat';
    this.winStreak = 0;
    this.battleInProgress = null;
    this.defeatContext =
      context && typeof context === 'object'
        ? {
            defeatedBy: typeof context.defeatedBy === 'string' ? context.defeatedBy : null,
            wasBoss: context.wasBoss === true,
          }
        : null;
  }

  _applySettledRewardsToMeta(meta, summary) {
    if (!meta || !summary || summary.appliedToMeta) return;
    // The run save can fail right after a payout, leaving appliedToMeta unset
    // on disk; meta remembers paid runs so a reload never pays twice. Legacy
    // ids are derived from the seed and may collide, so they are not tracked.
    const runId =
      typeof this.runRecordId === 'string' && !this.runRecordId.startsWith('legacy-')
        ? this.runRecordId
        : null;
    if (runId && meta.hasSettledRun?.(runId)) {
      summary.appliedToMeta = true;
      return;
    }
    // One write carries the currencies, records and paid marker; only mark the
    // summary applied once it is on disk, so a failed meta write leaves the
    // payout to retry instead of recording it as paid.
    const pay = (m) => {
      if (runId) m.markRunSettled?.(runId);
      m.addValor(summary.valor);
      m.addSupply(summary.supply);
      m.incrementRunsCompleted();
      // Stamp first-clear BEFORE beatGame is recorded — RunComplete dialogue
      // reads it off endRunRewards after the milestone already exists.
      summary.firstClear =
        summary.result === 'victory' &&
        this.actIndex >= 3 &&
        (typeof m.hasMilestone === 'function' ? !m.hasMilestone('beatGame') : false);
      if (this.actIndex >= 1) m.recordMilestone('beatAct1');
      if (this.actIndex >= 2) m.recordMilestone('beatAct2');
      if (this.actIndex >= 3) m.recordMilestone('beatAct3');
      if (summary.result === 'victory' && this.actIndex >= 3) m.recordMilestone('beatGame');
      const ladderMilestone = difficultyVictoryMilestone(this.difficultyId);
      if (summary.result === 'victory' && ladderMilestone) m.recordMilestone(ladderMilestone);
      // Narrative memory flush — exactly-once under this guard, like currencies.
      m.recordRunEnd?.({
        result: summary.result,
        victoryRecord:
          summary.result === 'victory'
            ? {
                v: RUN_RECORD_VERSION,
                id: this.runRecordId || `legacy-${this.runSeed}`,
                endedAt: Date.now(),
                difficulty: this.difficultyId,
                noMetaMode: this.noMetaMode === true,
                seed: this.runSeed,
                actsCleared: this.actIndex + 1,
                totalTurns: this.totalTurns,
                shadow: this.isEclipseActive() ? this.eclipse.shadow : null,
                roster: this.roster.map(survivorRecord),
                fallen: fallenForRecord(everFallenUnits(this)).map(fallenRecord),
              }
            : null,
        act: this.currentAct,
        difficultyId: this.difficultyId || 'normal',
        defeatedBy: this.defeatContext?.defeatedBy || null,
        wasBossDefeat: this.defeatContext?.wasBoss === true,
        lordFalls: Array.isArray(this.runLordFalls) ? this.runLordFalls : [],
      });
    };
    if (typeof meta.applyRunPayout === 'function') {
      const saved = meta.applyRunPayout(pay);
      if (!saved?.ok) {
        console.warn('[RunManager] end-of-run payout not saved; will retry');
        return;
      }
    } else pay(meta);
    summary.appliedToMeta = true;
  }

  /**
   * Compute and apply end-of-run rewards exactly once.
   * Safe to call repeatedly and from multiple scenes.
   */
  settleEndRunRewards(meta = null, result = this.status) {
    if (this.endRunRewards) {
      this._applySettledRewardsToMeta(meta, this.endRunRewards);
      return { ...this.endRunRewards };
    }

    const normalizedResult = result === 'victory' ? 'victory' : 'defeat';
    const currencyMultiplier = this.getDifficultyModifier('currencyMultiplier', 1) || 1;
    const { valor, supply } = this.previewEndRunRewards(normalizedResult);

    this.endRunRewards = {
      result: normalizedResult,
      valor,
      supply,
      currencyMultiplier,
      appliedToMeta: false,
      settledAt: Date.now(),
    };
    this._applySettledRewardsToMeta(meta, this.endRunRewards);
    return { ...this.endRunRewards };
  }

  previewEndRunRewards(result = 'defeat') {
    if (this.endRunRewards) return { ...this.endRunRewards };
    const multiplier = this.getDifficultyModifier('currencyMultiplier', 1) || 1;
    const reward = calculateCurrencies(
      this.actIndex,
      this.completedBattles,
      result === 'victory',
      multiplier,
    );
    // One milestone per run, settled through the same defeat/abandon/victory path.
    const milestone = this.reachedFirstActBoss ? Math.floor(15 * multiplier) : 0;
    return { valor: reward.valor + milestone, supply: reward.supply + milestone };
  }

  /** Serialize run state to a plain object for localStorage. */
  toJSON() {
    return {
      version: 1,
      mode: this.mode === PROLOGUE_RUN_MODE ? PROLOGUE_RUN_MODE : STANDARD_RUN_MODE,
      ...(this.mode === PROLOGUE_RUN_MODE
        ? {
            prologueVisionGranted: this.prologueVisionGranted === true,
            prologueRosterLesson: this.prologueRosterLesson
              ? structuredClone(this.prologueRosterLesson)
              : null,
          }
        : {}),
      status: this.status,
      actIndex: this.actIndex,
      roster: this.roster,
      lastDeployment: normalizeDeploymentNames(this.lastDeployment),
      fallenUnits: this.fallenUnits,
      nextUnitUid: this.nextUnitUid,
      lastBattleCasualtyNotices: this.lastBattleCasualtyNotices || [],
      nodeMap: this.nodeMap,
      currentNodeId: this.currentNodeId,
      completedBattles: this.completedBattles,
      winStreak: this.winStreak || 0,
      maxWinStreak: this.maxWinStreak || 0,
      gold: this.gold,
      metaEffects: this.metaEffects,
      accessories: this.accessories,
      scrolls: this.scrolls,
      convoy: this.convoy,
      randomLegendary: this.randomLegendary || null,
      activeBlessings: (this.activeBlessings || [])
        .map((entry) => {
          const id = getBlessingEntryId(entry);
          if (!id) return null;
          return createActiveBlessingEntry(id, entry?.rolledCost || null, {
            midRun: entry?.midRun === true,
          });
        })
        .filter(Boolean),
      blessingHistory: this.blessingHistory || [],
      blessingSelectionTelemetry: this.blessingSelectionTelemetry || null,
      blessingRuntimeModifiers: this.blessingRuntimeModifiers || createBlessingRuntimeModifiers(),
      runSeed: this.runSeed,
      legendaryLordChance: this.legendaryLordChance,
      runRecordId: this.runRecordId,
      narrativeSeen: this.narrativeSeen,
      totalTurns: this.totalTurns,
      rngSeed: this.rngSeed,
      visionChargesRemaining: this.visionChargesRemaining,
      visionCount: this.visionCount,
      usedRecruitNames: this.usedRecruitNames || {},
      battleConfigsByNodeId: this.battleConfigsByNodeId || {},
      shopStateByNodeId: this.shopStateByNodeId || {},
      ruinsChoiceByNodeId: this.ruinsChoiceByNodeId || {},
      churchVowByNodeId: this.churchVowByNodeId || {},
      eventStateByNodeId: this.eventStateByNodeId || {},
      eventLog: this.eventLog || [],
      storyFlags: this.storyFlags || {},
      burdens: this.burdens || [],
      contract: this.contract || null,
      contractOwed: this.contractOwed || null,
      laidToRest: this.laidToRest || [],
      earnedBlessingPicks: this.earnedBlessingPicks || {},
      difficultyId: this.difficultyId || 'normal',
      difficultyModifiers: this.difficultyModifiers || {
        ...DIFFICULTY_DEFAULTS,
        actsIncluded: [...DIFFICULTY_DEFAULTS.actsIncluded],
      },
      actSequence: this.actSequence || [...ACT_SEQUENCE],
      pendingAmbushNodeId: this.pendingAmbushNodeId || null,
      pendingEventNodeId: this.pendingEventNodeId || null,
      pendingCaravanShop: this.pendingCaravanShop || null,
      pendingBattleReward: this.pendingBattleReward || null,
      rewardRerollsSpent: Math.max(0, Math.trunc(Number(this.rewardRerollsSpent) || 0)),
      pendingBossRecruit: this.pendingBossRecruit || null,
      pendingThirdLord: this.pendingThirdLord || null,
      reachedFirstActBoss: this.reachedFirstActBoss === true,
      activeCaravanShop: this.activeCaravanShop || null,
      endRunRewards: this.endRunRewards || null,
      metaUnlockedWeaponArts: this.metaUnlockedWeaponArts || [],
      actUnlockedWeaponArts: this.actUnlockedWeaponArts || [],
      unlockedWeaponArts: this.unlockedWeaponArts || [],
      shownDialogueKeys: this.shownDialogueKeys || [],
      defeatContext: this.defeatContext || null,
      runLordFalls: this.runLordFalls || [],
      churchPromotionTracker: this._churchPromotionTracker || null,
      noMetaMode: this.noMetaMode || false,
      thirdLordJoined: this.thirdLordJoined || false,
      thirdLordRerolled: this.thirdLordRerolled || false,
      battleInProgress: this.battleInProgress || null,
      lastBattleReport: this.lastBattleReport || null,
      eclipse: this.eclipse || createEclipseState(),
      itemNamesRevision: ITEM_NAMES_REVISION,
      blessingBoonRevision: this.blessingBoonRevision,
    };
  }

  /**
   * Migrate old save format (mixed inventory) to new format (split inventory).
   * Moves consumables to unit.consumables[], scrolls to runManager.scrolls[].
   */
  static migrateInventorySplit(runManager) {
    for (const unit of runManager.roster) {
      // Skip if already migrated
      if (unit.consumables !== undefined) continue;

      // Create consumables array
      unit.consumables = [];

      // Scan inventory for items to migrate
      const toRemove = [];
      for (const item of unit.inventory) {
        if (item.type === 'Consumable') {
          unit.consumables.push(item);
          toRemove.push(item);
        } else if (item.type === 'Scroll') {
          if (!runManager.scrolls) runManager.scrolls = [];
          runManager.scrolls.push(item);
          toRemove.push(item);
        }
      }

      // Remove migrated items from old inventory
      for (const item of toRemove) {
        const idx = unit.inventory.indexOf(item);
        if (idx !== -1) unit.inventory.splice(idx, 1);
      }
    }
  }

  /**
   * Ensure units loaded from older saves have all class-innate skills.
   * Promoted units receive both promoted and base-class innates.
   */
  static migrateClassInnateSkills(runManager) {
    const classes = runManager.gameData?.classes || [];
    const skillsData = runManager.gameData?.skills || [];
    if (!classes.length || !skillsData.length) return;
    const applyInnates = (unit) => {
      if (!unit || skipsClassProgression(unit)) return;
      if (!Array.isArray(unit.skills)) unit.skills = [];
      const addInnatesFor = (className) => {
        for (const sid of getClassInnateSkills(className, skillsData)) {
          learnSkill(unit, sid);
        }
      };
      if (unit.className) addInnatesFor(unit.className);
      const lineBase = unit.tier === 'promoted' ? unitBaseClassName(unit, classes) : null;
      if (lineBase) addInnatesFor(lineBase);
    };
    runManager.roster.forEach(applyInnates);
    runManager.fallenUnits.forEach(applyInnates);
  }

  /**
   * Ensure units loaded from older saves get class-learned skills under current thresholds:
   * - base classes: class learnables at their configured level
   * - promoted classes: own learnables at configured level + base-class learnables at promoted level 10+
   */
  static migrateClassLearnableSkills(runManager) {
    const classes = runManager.gameData?.classes || [];
    if (!classes.length) return;
    const classByName = new Map(classes.map((c) => [c.name, c]));

    const applyLearnables = (unit) => {
      if (!unit || skipsClassProgression(unit)) return;
      if (!Array.isArray(unit.skills)) unit.skills = [];
      if (!Number.isFinite(unit.level)) return;

      const currentClass = classByName.get(unit.className);
      if (!currentClass) return;

      // A class skill once lost to a full list (before the bench) comes back benched.
      const tryLearn = (skillId) => {
        if (!skillId || knowsSkill(unit, skillId)) return;
        learnSkill(unit, skillId);
      };

      for (const entry of currentClass.learnableSkills || []) {
        if (unit.level >= entry.level) {
          tryLearn(entry.skillId);
        }
      }

      const lineBase = unit.tier === 'promoted' ? unitBaseClassName(unit, classes) : null;
      if (unit.tier === 'promoted' && unit.level >= 10 && lineBase) {
        const baseClass = classByName.get(lineBase);
        for (const entry of baseClass?.learnableSkills || []) {
          tryLearn(entry.skillId);
        }
      }
    };

    runManager.roster.forEach(applyLearnables);
    runManager.fallenUnits.forEach(applyLearnables);
  }

  /**
   * Normalize loaded units against current class schema to prevent stale class-state drift.
   */
  static migrateUnitClassState(runManager) {
    const classByName = new Map((runManager.gameData?.classes || []).map((c) => [c.name, c]));
    if (classByName.size <= 0) return;
    const normalize = (unit) => {
      if (!unit || !unit.className) return;
      const classData = classByName.get(unit.className);
      if (!classData) return;
      normalizeUnitClassState(unit, classData);
      ensureSeraBaseStaffProficiency(unit);
    };
    runManager.roster.forEach(normalize);
    runManager.fallenUnits.forEach(normalize);
  }

  /**
   * Normalize weapon-art metadata on item instances loaded from save data.
   * Supports legacy fields and strips malformed metadata fail-closed.
   */
  static migrateWeaponArtItemState(runManager) {
    const validArtIds = new Set(
      Array.isArray(runManager.gameData?.weaponArts?.arts)
        ? runManager.gameData.weaponArts.arts.map((art) => art?.id).filter(Boolean)
        : [],
    );
    const canonicalWeaponTypeByLower = new Map(
      [...CONVOY_WEAPON_TYPES].map((type) => [type.toLowerCase(), type]),
    );

    const normalizeScrollMetadata = (item) => {
      if (!item || typeof item !== 'object') return;
      if (item.type !== 'Scroll') return;
      const teachesId =
        typeof item.teachesWeaponArtId === 'string' ? item.teachesWeaponArtId.trim() : '';
      if (!teachesId || !validArtIds.has(teachesId)) {
        delete item.teachesWeaponArtId;
      } else {
        item.teachesWeaponArtId = teachesId;
      }

      if (Array.isArray(item.allowedWeaponTypes)) {
        const clean = [
          ...new Set(
            item.allowedWeaponTypes
              .filter((type) => typeof type === 'string')
              .map((type) => type.trim())
              .filter(Boolean)
              .map((type) => canonicalWeaponTypeByLower.get(type.toLowerCase()))
              .filter(Boolean),
          ),
        ];
        if (clean.length > 0) item.allowedWeaponTypes = clean;
        else delete item.allowedWeaponTypes;
      } else {
        delete item.allowedWeaponTypes;
      }
    };

    const normalizeWeaponList = (items) => {
      if (!Array.isArray(items)) return;
      for (const item of items) {
        normalizeWeaponArtBinding(item, { validArtIds });
        normalizeScrollMetadata(item);
      }
    };

    const normalizeUnit = (unit) => {
      if (!unit || typeof unit !== 'object') return;
      normalizeWeaponArtBinding(unit.weapon, { validArtIds });
      normalizeWeaponList(unit.inventory);
      normalizeWeaponList(unit.consumables);
    };

    runManager.roster.forEach(normalizeUnit);
    runManager.fallenUnits.forEach(normalizeUnit);
    normalizeWeaponList(runManager.convoy?.weapons);
    normalizeWeaponList(runManager.convoy?.consumables);
    normalizeWeaponList(runManager.scrolls);
  }

  /**
   * Normalize legacy skill strings (e.g. "Renewal Aura") to canonical skill IDs
   * so on-turn-start and passive skill logic remains reliable across old saves.
   */
  static migrateSkillIds(runManager) {
    const skillsData = runManager.gameData?.skills || [];
    const validSkillIds = new Set(skillsData.map((s) => s.id).filter(Boolean));
    if (!validSkillIds.size) return;

    const toCanonicalSkillId = (raw) => {
      if (typeof raw !== 'string') return raw;
      const value = raw.trim();
      if (!value) return value;
      if (validSkillIds.has(value)) return value;

      const toSnake = (input) =>
        input
          .toLowerCase()
          .replace(/[:].*$/, '')
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_+|_+$/g, '');

      const normalized = toSnake(value);
      if (validSkillIds.has(normalized)) return normalized;
      return value;
    };

    const normalizeUnit = (unit) => {
      if (!unit || !Array.isArray(unit.skills)) return;
      const seen = new Set();
      const normalized = [];
      for (const skillId of unit.skills) {
        const canonical = toCanonicalSkillId(skillId);
        if (seen.has(canonical)) continue;
        seen.add(canonical);
        normalized.push(canonical);
      }
      unit.skills = normalized;
      // The bench: canonical ids, never one that is also equipped.
      if (Array.isArray(unit.benchedSkills)) {
        const bench = [];
        for (const skillId of unit.benchedSkills) {
          const canonical = toCanonicalSkillId(skillId);
          if (seen.has(canonical)) continue;
          seen.add(canonical);
          bench.push(canonical);
        }
        unit.benchedSkills = bench;
      }
    };

    runManager.roster.forEach(normalizeUnit);
    runManager.fallenUnits.forEach(normalizeUnit);
  }

  /** Restore a RunManager from saved data. */
  static fromJSON(saved, gameData) {
    // Items renamed since this save was written get their new names everywhere in
    // it (units, convoy, shops, rewards, battle checkpoint and rewind timeline).
    migrateSavedItemNames(saved, gameData);
    // Gambler's Coins saved with the legacy flag take the catalog's odds (same places).
    migrateSavedGamblerCoins(saved, gameData);
    // Per-battle weapons (Breachbolt) take the catalog's shot counts (same places).
    migrateSavedPerBattleWeapons(saved, gameData);
    const rm = new RunManager(gameData, saved.metaEffects || null);
    // Saves from before the prologue carry no mode: they are standard runs.
    rm.mode = saved.mode === PROLOGUE_RUN_MODE ? PROLOGUE_RUN_MODE : STANDARD_RUN_MODE;
    if (rm.mode === PROLOGUE_RUN_MODE) {
      rm.prologueVisionGranted = saved.prologueVisionGranted === true;
      rm.prologueRosterLesson = normalizeRosterLesson(saved.prologueRosterLesson);
    }
    rm.legendaryLordChance = Math.min(0.15, Math.max(0, Number(saved.legendaryLordChance) || 0));
    rm.lastDeployment = normalizeDeploymentNames(saved.lastDeployment);
    if (
      rm.metaEffects &&
      rm.metaEffects.lootWeaponQualityBonus === undefined &&
      rm.metaEffects.lootWeaponWeightBonus !== undefined
    ) {
      const legacyLootBonus = Number(rm.metaEffects.lootWeaponWeightBonus);
      if (Number.isFinite(legacyLootBonus)) {
        rm.metaEffects.lootWeaponQualityBonus = legacyLootBonus;
        const existingCategoryBonuses =
          rm.metaEffects.lootCategoryWeightBonuses &&
          typeof rm.metaEffects.lootCategoryWeightBonuses === 'object'
            ? rm.metaEffects.lootCategoryWeightBonuses
            : {};
        const currentWeaponBonus = Number(existingCategoryBonuses.weapon);
        existingCategoryBonuses.weapon =
          (Number.isFinite(currentWeaponBonus) ? currentWeaponBonus : 0) + legacyLootBonus;
        rm.metaEffects.lootCategoryWeightBonuses = existingCategoryBonuses;
      }
    }
    rm.status = saved.status;
    rm.lastBattleReport = hydrateBattleTimeline(saved.lastBattleReport);
    rm.actIndex = saved.actIndex;
    rm.roster = Array.isArray(saved.roster)
      ? saved.roster.filter((u) => rm._isValidSerializedUnit(u))
      : [];
    rm.fallenUnits = Array.isArray(saved.fallenUnits)
      ? saved.fallenUnits.filter((u) => rm._isValidSerializedUnit(u))
      : [];

    rm.roster = rm.roster.map((u) =>
      normalizeUnitDeeds(
        migrateUnitTraits(normalizeSpecialCharacter({ ...u }, gameData.specialChars)),
      ),
    );
    rm.fallenUnits = rm.fallenUnits.map((u) =>
      normalizeUnitDeeds(
        migrateUnitTraits(normalizeSpecialCharacter({ ...u }, gameData.specialChars)),
      ),
    );
    // Unit identity: legacy saves stamp every roster/fallen unit now (roster order,
    // then fallen), counter-based and RNG-free, so a reload stamps the same way.
    rm.nextUnitUid =
      Number.isSafeInteger(saved.nextUnitUid) && saved.nextUnitUid > 0 ? saved.nextUnitUid : 1;
    rm.ensureUnitUids();

    // --- lord presence validation (only for non-empty rosters) ---
    if (rm.roster.length > 0) {
      const lordNames = new Set((gameData.lords || []).map((l) => l.name));
      const unflagged = rm.roster.filter((u) => lordNames.has(u.name) && !u.isLord);
      for (const lord of unflagged) {
        lord.isLord = true;
        console.warn('[RunManager] fromJSON: repaired missing isLord flag on', lord.name);
      }
      if (!rm.roster.some((u) => u.isLord)) {
        throw new Error(
          '[RunManager] fromJSON: no lord found in roster after filtering — save is corrupt',
        );
      }
      // Commander flag: legacy saves predate it — heal via flag -> Edric -> first lord.
      stampCommanderFlag(rm.roster);
    }

    rm.nodeMap = saved.nodeMap;
    rm.currentNodeId = saved.currentNodeId;
    rm.completedBattles = saved.completedBattles;
    const ws = saved.winStreak;
    rm.winStreak = Number.isFinite(ws) && ws >= 0 ? Math.trunc(ws) : 0;
    const mws = saved.maxWinStreak;
    rm.maxWinStreak = Number.isFinite(mws) && mws >= 0 ? Math.trunc(mws) : 0;
    rm.gold = Number.isFinite(saved.gold) && saved.gold >= 0 ? Math.floor(saved.gold) : 0;
    rm.accessories = saved.accessories || [];
    rm.scrolls = saved.scrolls || [];
    rm.convoy = saved.convoy || { weapons: [], consumables: [] };
    rm._dropCaravanUnits();
    rm.randomLegendary = saved.randomLegendary || null;
    const rawActiveBlessings = Array.isArray(saved.activeBlessings) ? saved.activeBlessings : [];
    rm.blessingHistory = saved.blessingHistory || [];
    rm.blessingSelectionTelemetry = saved.blessingSelectionTelemetry || null;
    if (rm.blessingSelectionTelemetry && !Array.isArray(rm.blessingSelectionTelemetry.offeredIds)) {
      rm.blessingSelectionTelemetry.offeredIds = Array.isArray(
        rm.blessingSelectionTelemetry.chosenIds,
      )
        ? [...rm.blessingSelectionTelemetry.chosenIds]
        : [];
      rm.blessingSelectionTelemetry.chosenIds = [];
    }
    if (
      rm.blessingSelectionTelemetry &&
      !Array.isArray(rm.blessingSelectionTelemetry.offeredBlessings)
    ) {
      const catalog = gameData?.blessings;
      if (catalog?.blessings?.length && Array.isArray(rm.blessingSelectionTelemetry.offeredIds)) {
        const index = buildBlessingIndex(catalog);
        rm.blessingSelectionTelemetry.offeredBlessings = rm.blessingSelectionTelemetry.offeredIds
          .map((id) => index.get(id))
          .filter(Boolean)
          .map((blessing) => ({ ...structuredClone(blessing), rolledCost: null }));
      } else {
        rm.blessingSelectionTelemetry.offeredBlessings = [];
      }
    }
    if (
      rm.blessingSelectionTelemetry &&
      Array.isArray(rm.blessingSelectionTelemetry.offeredBlessings)
    ) {
      rm.blessingSelectionTelemetry.offeredBlessings =
        rm.blessingSelectionTelemetry.offeredBlessings
          .filter((blessing) => isPlainObject(blessing) && typeof blessing.id === 'string')
          .map((blessing) => ({
            ...structuredClone(blessing),
            rolledCost: normalizeBlessingCostEntry(blessing.rolledCost),
          }));
    }
    if (rm.blessingSelectionTelemetry) {
      const rawChosenBlessings = Array.isArray(rm.blessingSelectionTelemetry.chosenBlessings)
        ? rm.blessingSelectionTelemetry.chosenBlessings
        : Array.isArray(rm.blessingSelectionTelemetry.chosenIds)
          ? rm.blessingSelectionTelemetry.chosenIds
          : [];
      rm.blessingSelectionTelemetry.chosenBlessings = rawChosenBlessings
        .map((entry) => {
          const id = getBlessingEntryId(entry);
          if (!id) return null;
          return createActiveBlessingEntry(id, entry?.rolledCost || null);
        })
        .filter(Boolean);
    }
    rm.blessingRuntimeModifiers =
      saved.blessingRuntimeModifiers || createBlessingRuntimeModifiers();
    if (
      !rm.blessingRuntimeModifiers.actHitBonusByAct ||
      typeof rm.blessingRuntimeModifiers.actHitBonusByAct !== 'object'
    ) {
      rm.blessingRuntimeModifiers.actHitBonusByAct = {};
    }
    if (!Array.isArray(rm.blessingRuntimeModifiers.actStatDeltaAllUnits)) {
      rm.blessingRuntimeModifiers.actStatDeltaAllUnits = [];
    }
    rm.blessingRuntimeModifiers.skipFirstShop = Boolean(rm.blessingRuntimeModifiers.skipFirstShop);
    rm.blessingRuntimeModifiers.shopItemCountDelta = Math.trunc(
      rm.blessingRuntimeModifiers.shopItemCountDelta || 0,
    );
    rm.blessingRuntimeModifiers.allGrowthsDelta = Math.trunc(
      rm.blessingRuntimeModifiers.allGrowthsDelta || 0,
    );
    if (!Array.isArray(rm.blessingRuntimeModifiers.allGrowthsDeltas)) {
      rm.blessingRuntimeModifiers.allGrowthsDeltas =
        rm.blessingRuntimeModifiers.allGrowthsDelta !== 0
          ? [rm.blessingRuntimeModifiers.allGrowthsDelta]
          : [];
    } else {
      rm.blessingRuntimeModifiers.allGrowthsDeltas = rm.blessingRuntimeModifiers.allGrowthsDeltas
        .map((entry) => Math.trunc(Number(entry) || 0))
        .filter((entry) => entry !== 0);
    }
    if (!Array.isArray(rm.blessingRuntimeModifiers.targetedGrowthsDeltas)) {
      rm.blessingRuntimeModifiers.targetedGrowthsDeltas = [];
    } else {
      rm.blessingRuntimeModifiers.targetedGrowthsDeltas =
        rm.blessingRuntimeModifiers.targetedGrowthsDeltas
          .map((entry) => {
            if (!isPlainObject(entry)) return null;
            const stats = [
              ...new Set(
                (Array.isArray(entry.stats) ? entry.stats : [])
                  .filter((stat) => typeof stat === 'string')
                  .map((stat) => stat.trim())
                  .filter((stat) => XP_STAT_NAMES.includes(stat)),
              ),
            ];
            const delta = Math.trunc(Number(entry.value) || 0);
            if (stats.length <= 0 || delta === 0) return null;
            const scope = typeof entry.scope === 'string' ? entry.scope : 'all';
            return { stats, value: delta, scope };
          })
          .filter(Boolean);
    }
    if (
      !rm.blessingRuntimeModifiers.blockedPersonalSkillsByUnit ||
      typeof rm.blessingRuntimeModifiers.blockedPersonalSkillsByUnit !== 'object'
    ) {
      rm.blessingRuntimeModifiers.blockedPersonalSkillsByUnit = {};
    }
    rm.blessingRuntimeModifiers.xpMultiplierDelta =
      Number(rm.blessingRuntimeModifiers.xpMultiplierDelta) || 0;
    rm.blessingRuntimeModifiers.forgeCostDiscount =
      Number(rm.blessingRuntimeModifiers.forgeCostDiscount) || 0;
    rm.blessingRuntimeModifiers.shopPriceDiscount =
      Number(rm.blessingRuntimeModifiers.shopPriceDiscount) || 0;
    rm.blessingRuntimeModifiers.recruitLevelBonus = Math.trunc(
      Number(rm.blessingRuntimeModifiers.recruitLevelBonus) || 0,
    );
    rm.blessingRuntimeModifiers.forgeLimitDelta = Math.trunc(
      Number(rm.blessingRuntimeModifiers.forgeLimitDelta) || 0,
    );
    rm.blessingRuntimeModifiers.firstStrikeHitBonus = Math.trunc(
      Number(rm.blessingRuntimeModifiers.firstStrikeHitBonus) || 0,
    );
    {
      const held = rm.blessingRuntimeModifiers.stationaryCombatBonus;
      rm.blessingRuntimeModifiers.stationaryCombatBonus = {
        defBonus: Math.trunc(Number(held?.defBonus) || 0),
        avoidBonus: Math.trunc(Number(held?.avoidBonus) || 0),
      };
    }
    // Phalanx Rite and Duelist's Creed: saves from before have neither.
    rm.blessingRuntimeModifiers.adjacentAllyDefBonuses = sanitizeAdjacentAllyDefBonuses(
      rm.blessingRuntimeModifiers.adjacentAllyDefBonuses,
    );
    rm.blessingRuntimeModifiers.isolatedCombatBonuses = sanitizeIsolatedCombatBonuses(
      rm.blessingRuntimeModifiers.isolatedCombatBonuses,
    );
    rm.blessingRuntimeModifiers.freeForgesPerShop = Math.max(
      0,
      Math.trunc(Number(rm.blessingRuntimeModifiers.freeForgesPerShop) || 0),
    );
    rm.blessingRuntimeModifiers.extraShopsPerAct = Math.max(
      0,
      Math.trunc(Number(rm.blessingRuntimeModifiers.extraShopsPerAct) || 0),
    );
    rm.blessingRuntimeModifiers.actStartGrants = sanitizeActStartGrants(
      rm.blessingRuntimeModifiers.actStartGrants,
    );
    rm.blessingRuntimeModifiers.healingEffectivenessMultiplier = Number.isFinite(
      rm.blessingRuntimeModifiers.healingEffectivenessMultiplier,
    )
      ? rm.blessingRuntimeModifiers.healingEffectivenessMultiplier
      : 1;
    rm.blessingRuntimeModifiers.weaponArtHpCostDelta = Math.trunc(
      Number(rm.blessingRuntimeModifiers.weaponArtHpCostDelta) || 0,
    );
    // Bloodless Art: saves from before have neither (the bonus is never negative).
    rm.blessingRuntimeModifiers.playerArtHpCostDelta = Math.trunc(
      Number(rm.blessingRuntimeModifiers.playerArtHpCostDelta) || 0,
    );
    rm.blessingRuntimeModifiers.playerArtMapUsesBonus = Math.max(
      0,
      Math.trunc(Number(rm.blessingRuntimeModifiers.playerArtMapUsesBonus) || 0),
    );
    // v3 prices: saves from before have neither.
    const deployByAct = rm.blessingRuntimeModifiers.deployCapDeltaByAct;
    rm.blessingRuntimeModifiers.deployCapDeltaByAct = Object.fromEntries(
      Object.entries(isPlainObject(deployByAct) ? deployByAct : {})
        .map(([act, delta]) => [act, Math.trunc(Number(delta) || 0)])
        .filter(([, delta]) => delta !== 0),
    );
    rm.blessingRuntimeModifiers.churchReviveDisabled =
      rm.blessingRuntimeModifiers.churchReviveDisabled === true;
    rm.blessingRuntimeModifiers.lordStatArcs = sanitizeLordStatArcs(
      rm.blessingRuntimeModifiers.lordStatArcs,
    );
    rm.blessingRuntimeModifiers.battleGoldGamble = parseBattleGoldGamble(
      rm.blessingRuntimeModifiers.battleGoldGamble,
    );
    // The rest of the §5 starting blessings: a save from before them reads the defaults.
    sanitizeShrineBoonModifiers(rm.blessingRuntimeModifiers);
    // Earned blessings: a save from before them holds none.
    for (const field of Object.values(EARNED_BOON_MODIFIERS))
      rm.blessingRuntimeModifiers[field] = Math.max(
        0,
        Math.trunc(Number(rm.blessingRuntimeModifiers[field]) || 0),
      );
    // Pact enemy levels (strategy-layer): legacy saves have none.
    rm.blessingRuntimeModifiers.enemyLevelDeltas = (
      Array.isArray(rm.blessingRuntimeModifiers.enemyLevelDeltas)
        ? rm.blessingRuntimeModifiers.enemyLevelDeltas
        : []
    )
      .map((entry) => ({
        value: Math.trunc(Number(entry?.value) || 0),
        act: typeof entry?.act === 'string' && entry.act ? entry.act : null,
      }))
      .filter((entry) => entry.value !== 0);
    // Legacy saves predate runSeed and store it as null/undefined. Falling back to
    // 0 here (via the general Number.isFinite guard elsewhere) would make every
    // legacy player's node-map generation seed from the same base — fall back to
    // Date.now() instead so each legacy load gets a distinct seed.
    rm.narrativeSeen =
      saved.narrativeSeen &&
      typeof saved.narrativeSeen === 'object' &&
      !Array.isArray(saved.narrativeSeen)
        ? structuredClone(saved.narrativeSeen)
        : {};
    rm.runRecordId =
      typeof saved.runRecordId === 'string' ? saved.runRecordId : `legacy-${saved.runSeed}`;
    rm.totalTurns = Number.isFinite(saved.totalTurns)
      ? Math.max(0, Math.trunc(saved.totalTurns))
      : null;
    rm.runSeed = Number.isFinite(saved.runSeed) ? Number(saved.runSeed) : Date.now();
    rm.rngSeed = Number.isFinite(saved.rngSeed)
      ? Number(saved.rngSeed) >>> 0
      : Number.isFinite(rm.runSeed)
        ? Number(rm.runSeed) >>> 0
        : null;
    rm.activeBlessings = rm._normalizeActiveBlessingsForLoad(rawActiveBlessings);
    const defaultVisionCharges = rm.getBaseVisionCharges();
    rm.visionChargesRemaining = Number.isFinite(saved.visionChargesRemaining)
      ? Math.max(0, Math.trunc(saved.visionChargesRemaining))
      : defaultVisionCharges;
    rm.visionCount = Number.isFinite(saved.visionCount)
      ? Math.max(0, Math.trunc(saved.visionCount))
      : 0;
    rm.usedRecruitNames = saved.usedRecruitNames || {};
    rm._repairDuplicateRosterNames();
    // Portrait variety: saves from before it get stable, de-duplicated faces.
    // A legacy save without a seed hashes with 0, never the Date.now fallback,
    // so reloading it without saving shows the same faces.
    rm.ensurePortraitVariants(Number.isFinite(saved.runSeed) ? Number(saved.runSeed) : 0);
    // A save from before advanceAct pruned still carries every earlier act's maps.
    rm.battleConfigsByNodeId = pruneLockedBattleConfigs(saved.battleConfigsByNodeId, rm.nodeMap, {
      keepNodeId: saved.battleInProgress?.nodeId,
    });
    rm.shopStateByNodeId = saved.shopStateByNodeId || {};
    // Saves from before the Ruins' choice carry none: no path chosen yet.
    rm.ruinsChoiceByNodeId = sanitizeRuinsChoices(saved.ruinsChoiceByNodeId);
    rm.churchVowByNodeId = sanitizeChurchVows(saved.churchVowByNodeId);
    // Saves from before Events carry none of these: nothing chosen, no flags, no burdens.
    rm.eventStateByNodeId = sanitizeEventStates(saved.eventStateByNodeId);
    rm.eventLog = sanitizeEventLog(saved.eventLog);
    rm.storyFlags = sanitizeStoryFlags(saved.storyFlags);
    rm.burdens = normalizeBurdens(saved.burdens);
    rm.contract = normalizeContract(saved.contract);
    // Saves from before contract recovery carry none (their contracts closed at the victory).
    rm.contractOwed = normalizeContractOwed(saved.contractOwed);
    rm.laidToRest = sanitizeLaidToRest(saved.laidToRest);
    rm.applyDifficultySelection(saved.difficultyId || 'normal');
    if (saved.difficultyModifiers && typeof saved.difficultyModifiers === 'object') {
      rm.difficultyModifiers = {
        ...DIFFICULTY_DEFAULTS,
        ...saved.difficultyModifiers,
        actsIncluded: sanitizeActSequence(
          Array.isArray(saved.difficultyModifiers.actsIncluded)
            ? saved.difficultyModifiers.actsIncluded
            : rm.difficultyModifiers.actsIncluded,
          rm.difficultyModifiers.actsIncluded,
        ),
      };
    }
    const hasSavedActSequence = Array.isArray(saved.actSequence) && saved.actSequence.length > 0;
    const hasSavedActsIncluded =
      Array.isArray(saved?.difficultyModifiers?.actsIncluded) &&
      saved.difficultyModifiers.actsIncluded.length > 0;
    const legacySafeFallback =
      hasSavedActSequence || hasSavedActsIncluded
        ? rm.difficultyModifiers?.actsIncluded || ACT_SEQUENCE
        : DIFFICULTY_DEFAULTS.actsIncluded;
    const sequenceSource = hasSavedActSequence
      ? saved.actSequence
      : hasSavedActsIncluded
        ? saved.difficultyModifiers.actsIncluded
        : legacySafeFallback;
    rm.actSequence = sanitizeActSequence(sequenceSource, legacySafeFallback);
    // Migrate stale Lunatic saves that are missing act4
    if (
      saved.difficultyId === 'lunatic' &&
      !rm.actSequence.includes('act4') &&
      gameData?.difficulty
    ) {
      const currentActId = rm.actSequence[rm.actIndex];
      const canonical = sanitizeActSequence(
        resolveDifficultyMode(gameData.difficulty, 'lunatic').modifiers.actsIncluded,
        ACT_SEQUENCE,
      );
      if (canonical.includes('act4')) {
        rm.actSequence = canonical;
        rm.difficultyModifiers = { ...rm.difficultyModifiers, actsIncluded: [...canonical] };
        const newIndex = canonical.indexOf(currentActId);
        if (newIndex >= 0) rm.actIndex = newIndex;
      }
    }
    if (rm.actIndex >= rm.actSequence.length) {
      rm.actIndex = Math.max(0, rm.actSequence.length - 1);
    }
    // Read against the catalog and the run's acts (after the act sequence is final).
    rm.earnedBlessingPicks = sanitizeEarnedBlessingPicks(saved.earnedBlessingPicks, {
      earnedIds: earnedBlessingsOf(gameData).map((b) => b.id),
      actSequence: rm.actSequence,
    });
    rm.pendingAmbushNodeId =
      typeof saved.pendingAmbushNodeId === 'string' ? saved.pendingAmbushNodeId : null;
    rm.pendingEventNodeId =
      typeof saved.pendingEventNodeId === 'string' ? saved.pendingEventNodeId : null;
    rm.reachedFirstActBoss = saved.reachedFirstActBoss === true;
    rm.pendingBattleReward =
      saved.pendingBattleReward?.version === 1 && Array.isArray(saved.pendingBattleReward.choices)
        ? {
            ...JSON.parse(JSON.stringify(saved.pendingBattleReward)),
            claimed: (Array.isArray(saved.pendingBattleReward.claimed)
              ? saved.pendingBattleReward.claimed
              : []
            ).filter(
              (i) => Number.isInteger(i) && i >= 0 && i < saved.pendingBattleReward.choices.length,
            ),
            picksRemaining: saved.pendingBattleReward.picksRemaining === 2 ? 2 : 1,
            skipGold: Math.max(0, Math.trunc(Number(saved.pendingBattleReward.skipGold) || 0)),
          }
        : null;
    // Saves from before Branching Threads have spent none.
    rm.rewardRerollsSpent = Math.max(0, Math.trunc(Number(saved.rewardRerollsSpent) || 0));
    rm.pendingBossRecruit = restorePendingBossRecruit(saved.pendingBossRecruit, {
      actId: rm.currentAct,
      hasPendingReward: Boolean(rm.pendingBattleReward),
    });
    rm.pendingCaravanShop =
      saved.pendingCaravanShop && typeof saved.pendingCaravanShop === 'object'
        ? { actId: saved.pendingCaravanShop.actId || rm.currentAct }
        : null;
    rm.activeCaravanShop = saved.activeCaravanShop?.shopState
      ? structuredClone(saved.activeCaravanShop)
      : null;
    rm.endRunRewards = saved.endRunRewards || null;
    rm.lastBattleCasualtyNotices = Array.isArray(saved.lastBattleCasualtyNotices)
      ? saved.lastBattleCasualtyNotices
      : [];
    rm.metaUnlockedWeaponArts = Array.isArray(saved.metaUnlockedWeaponArts)
      ? rm._normalizeUnlockedWeaponArtIds(saved.metaUnlockedWeaponArts)
      : [];
    rm.actUnlockedWeaponArts = Array.isArray(saved.actUnlockedWeaponArts)
      ? rm._normalizeUnlockedWeaponArtIds(saved.actUnlockedWeaponArts)
      : [];
    if (!Array.isArray(saved.actUnlockedWeaponArts) && Array.isArray(saved.unlockedWeaponArts)) {
      rm.actUnlockedWeaponArts = rm._normalizeUnlockedWeaponArtIds(saved.unlockedWeaponArts);
    }
    rm.shownDialogueKeys = Array.isArray(saved.shownDialogueKeys)
      ? [...new Set(saved.shownDialogueKeys.filter((key) => typeof key === 'string' && key))]
      : [];
    rm.defeatContext =
      saved.defeatContext && typeof saved.defeatContext === 'object'
        ? {
            defeatedBy:
              typeof saved.defeatContext.defeatedBy === 'string'
                ? saved.defeatContext.defeatedBy
                : null,
            wasBoss: saved.defeatContext.wasBoss === true,
          }
        : null;
    rm.runLordFalls = Array.isArray(saved.runLordFalls)
      ? saved.runLordFalls.filter((name) => typeof name === 'string' && name)
      : [];
    const rawTracker = saved.churchPromotionTracker;
    rm._churchPromotionTracker =
      rawTracker && typeof rawTracker.nodeId === 'string' && Number.isFinite(rawTracker.count)
        ? { nodeId: rawTracker.nodeId, count: Math.max(0, Math.trunc(rawTracker.count)) }
        : null;
    rm.noMetaMode = saved.noMetaMode === true;
    // Legacy saves without thirdLordJoined that are past battle 3
    // default to true (already resolved) to prevent unexpected triggers
    rm.thirdLordJoined =
      saved.thirdLordJoined === true ||
      (saved.thirdLordJoined === undefined && Number(saved.completedBattles || 0) >= 3);
    rm.thirdLordRerolled = saved.thirdLordRerolled === true;
    rm.pendingThirdLord = restorePendingThirdLord(saved.pendingThirdLord, {
      actId: rm.currentAct,
      hasPendingReward: Boolean(rm.pendingBattleReward),
      joined: rm.thirdLordJoined,
      takenNames: [...(rm.roster || []), ...everFallenUnits(rm)].map((u) => u?.name),
    });
    if (!Array.isArray(saved.shownDialogueKeys)) {
      const isInProgress = Boolean(
        saved.currentNodeId ||
        Number(saved.completedBattles || 0) > 0 ||
        Number(saved.actIndex || 0) > 0 ||
        (typeof saved.status === 'string' && saved.status !== 'active'),
      );
      if (isInProgress) rm.markDialogueShown('runStart');
    }
    rm._syncMetaWeaponArtUnlocks();
    rm.blessingRuntimeModifiers.disablePersonalSkillsUntilAct = rm.actSequence.includes(
      rm.blessingRuntimeModifiers.disablePersonalSkillsUntilAct,
    )
      ? rm.blessingRuntimeModifiers.disablePersonalSkillsUntilAct
      : null;
    // Blessings held across the v3 reworks (BlessingBoonMigration.js): handlers never re-run
    // on load, so an old boon's saved numbers are converted once and the save stamped. It runs
    // LAST in this function (every other load step has settled the map, the Eclipse and the
    // roster it reads, so Pilgrim's Road converts only a node still standing), and before the
    // early return below that skips a rejected checkpoint. The prologue holds no blessings and
    // is never migrated. The runtime modifiers, history and map are shared with the parsed
    // save, so the migration works on copies: loading the same object twice cannot migrate
    // twice.
    const settleBlessingBoons = () => {
      const savedRevision = Number(saved.blessingBoonRevision);
      rm.blessingBoonRevision = Number.isFinite(savedRevision)
        ? Math.max(0, Math.trunc(savedRevision))
        : 0;
      if (rm.blessingBoonRevision < BLESSING_BOON_REVISION) {
        rm.blessingRuntimeModifiers = structuredClone(rm.blessingRuntimeModifiers);
        rm.blessingHistory = structuredClone(rm.blessingHistory);
        delete rm.blessingRuntimeModifiers.terrainCombatBonuses; // retired with its blessing
        if (rm.mode !== PROLOGUE_RUN_MODE) migrateHeldBlessingBoons(rm);
        rm.blessingBoonRevision = BLESSING_BOON_REVISION;
      }
    };

    rm._runStartBlessingsApplied = true;
    if (rm.nodeMap?.nodes && rm.battleConfigsByNodeId) {
      for (const node of rm.nodeMap.nodes) {
        if (rm.battleConfigsByNodeId[node.id]) node.encounterLocked = true;
        rm._settleCaravanPromise(node);
      }
    }

    // Migrate old save format BEFORE relinking weapons
    // (migration may remove Consumables/Scrolls from inventory that relinkWeapon could pick as fallback)
    RunManager.migrateInventorySplit(rm);
    RunManager.migrateSkillIds(rm);
    RunManager.migrateClassInnateSkills(rm);
    // Normalize stale tier/proficiency/move state before class-learnable migration;
    // promoted learnables depend on unit.tier.
    RunManager.migrateUnitClassState(rm);
    RunManager.migrateWeaponArtItemState(rm);
    RunManager.migrateClassLearnableSkills(rm);
    // Before the bench, an Oath at the cap waited for a free slot: it is sworn now.
    rm.roster.forEach(migrateWaitingOath);
    rm.fallenUnits.forEach(migrateWaitingOath);

    // Stamp missing item UIDs from legacy saves before relinking/equipment migration.
    rm.roster.forEach(stampUnitItemUids);
    rm.fallenUnits.forEach(stampUnitItemUids);
    if (Array.isArray(rm.convoy?.weapons)) rm.convoy.weapons.forEach(ensureItemUid);
    if (Array.isArray(rm.convoy?.consumables)) rm.convoy.consumables.forEach(ensureItemUid);
    if (Array.isArray(rm.accessories)) rm.accessories.forEach(ensureItemUid);
    if (rm.randomLegendary && typeof rm.randomLegendary === 'object') {
      ensureItemUid(rm.randomLegendary);
    }

    rm.roster.forEach((u) => relinkWeapon(u));
    rm.fallenUnits.forEach((u) => relinkWeapon(u));
    // Legacy saves may carry the equipped weapon anywhere in the bag. Moving it
    // to the top on load is deterministic, RNG-free and idempotent; it runs only
    // at this run-level boundary, never on a battle checkpoint (those restore
    // exactly — see BattleSuspendController.applyUnits).
    rm.roster.forEach((u) => normalizeEquippedFirst(u));
    rm.fallenUnits.forEach((u) => normalizeEquippedFirst(u));
    rm._restoreDisabledPersonalSkillsIfReady('load');
    rm._suppressPersonalSkillsForCurrentRosterIfNeeded();
    rm._syncActWeaponArtUnlocksForCurrentAct();

    // Recruit previews: legacy maps get theirs now (their own seeded stream; locked
    // encounters keep the recruit their battle already rolled).
    rm.ensureRecruitPreviews();

    // The Eclipse: legacy saves start their clock now (enabled, shadow 0). Falls are
    // re-applied idempotently; a consistent save changes nothing. The battle being
    // fought (if any) is exempt like the current node.
    rm.eclipse = normalizeEclipseState(saved.eclipse, rm.getEclipseConfig());
    // The same fall as in play (applyEclipseNow), Dark Omen included.
    rm.applyEclipseNow({
      activeNodeId:
        typeof saved.battleInProgress?.nodeId === 'string' ? saved.battleInProgress.nodeId : null,
    });

    // Suspended battle (anti-refresh): only a flag carrying a usable resume
    // checkpoint survives the load — a battle interrupted before its first
    // checkpoint (or a legacy casualty-list flag) reverts to the pre-battle
    // save, which is all the raw data contains anyway.
    const rawBattleInProgress = saved.battleInProgress;
    rm.battleInProgress =
      rawBattleInProgress &&
      typeof rawBattleInProgress === 'object' &&
      typeof rawBattleInProgress.nodeId === 'string' &&
      rawBattleInProgress.checkpoint &&
      typeof rawBattleInProgress.checkpoint === 'object'
        ? rawBattleInProgress
        : null;
    // The raw data is the pre-battle save except for one write: a Watcher's Grace charge
    // granted at the fresh start. A flag dropped here takes it back, or a refresh on the boss
    // card would keep the charge (and a repeat would farm them).
    if (!rm.battleInProgress && rawBattleInProgress && typeof rawBattleInProgress === 'object')
      restoreUncheckpointedBossVision(rm, rawBattleInProgress);

    // The checkpoint stores its own unit arrays (restored directly into the
    // scene, never through the roster), so legacy ones are healed here too.
    // One combined pool: the commander may be among the escaped units.
    if (rm.battleInProgress) {
      const checkpoint = rm.battleInProgress.checkpoint;
      // A resume of this checkpoint already threw once. The failure may have
      // been transient, so it stays resumable, but the slot screen also
      // offers to settle the recorded defeat instead of forcing more retries.
      rm._battleRecoveryRestoreFailed = checkpoint.restoreFailed === true;
      if (checkpoint.version !== 2) {
        // Written by an older build (v1 before the canonical battle state,
        // or unversioned). It cannot be resumed, but it predates fatal
        // decisions, so the sanctioned map revert is always safe for it.
        rm._battleRecoveryInvalid = true;
        rm._battleRecoveryLegacy =
          checkpoint.version === undefined ||
          (Number.isFinite(checkpoint.version) && checkpoint.version < 2);
      } else {
        const { visionSnapshot, pendingVisionSnapshot, ...state } = checkpoint;
        // Keep the raw save and battle flag intact for recovery; the slot UI
        // must not turn a malformed fatal record into a free map restart.
        rm._battleRecoveryInvalid = !validateBattleState(state);
      }
      rm.battleInProgress.timeline = hydrateBattleTimeline(rm.battleInProgress.timeline);
      // Never migrate a rejected checkpoint: even walking its unit arrays may
      // throw, hiding the raw save from the recovery UI.
      if (rm._battleRecoveryInvalid) {
        settleBlessingBoons();
        return rm;
      }
      for (const key of ['visionSnapshot', 'pendingVisionSnapshot']) {
        if (checkpoint[key]?.version === 2 && !validateBattleState(checkpoint[key]))
          checkpoint[key] = null;
      }
      const pool = [
        ...(Array.isArray(checkpoint.playerUnits) ? checkpoint.playerUnits : []),
        ...(Array.isArray(checkpoint.escapedUnits) ? checkpoint.escapedUnits : []),
      ];
      if (checkpoint.commanderEntityId) {
        for (const unit of pool)
          unit.isCommander = unit.battleEntityId === checkpoint.commanderEntityId;
      } else stampCommanderFlag(pool);
    }

    settleBlessingBoons();
    return rm;
  }
}

/** Resolve the storage key for a slot. Returns null if slotNumber is missing (callers must handle). */
function isValidSlotNumber(slotNumber) {
  return Number.isInteger(slotNumber) && slotNumber >= 1 && slotNumber <= MAX_SLOTS;
}

function resolveRunKey(slotNumber) {
  if (!isValidSlotNumber(slotNumber)) {
    console.warn('[RunManager] resolveRunKey called with invalid slotNumber — this is a bug');
    return null;
  }
  return getRunKey(slotNumber);
}

function getSavedAt(value) {
  return Number.isFinite(value) ? value : null;
}

function readLocalRunSavedAt(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return getSavedAt(parsed?.savedAt);
  } catch (_) {
    return null;
  }
}

function readRunClockFloorSavedAt(slotNumber) {
  try {
    const raw = localStorage.getItem(getRunClockFloorKey(slotNumber));
    if (raw == null) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  } catch (_) {
    return null;
  }
}

function computeNextRunSavedAt(slotNumber, key) {
  const now = Date.now();
  const previousLocalSavedAt = readLocalRunSavedAt(key);
  const remoteFloorSavedAt = readRunClockFloorSavedAt(slotNumber);

  let nextSavedAt = now;
  if (Number.isFinite(previousLocalSavedAt)) {
    nextSavedAt = Math.max(nextSavedAt, previousLocalSavedAt + 1);
  }
  if (Number.isFinite(remoteFloorSavedAt)) {
    nextSavedAt = Math.max(nextSavedAt, remoteFloorSavedAt + 1);
  }
  return nextSavedAt;
}

function resolveSlotNumberForClear(slotNumber) {
  if (isValidSlotNumber(slotNumber)) {
    return {
      slot: slotNumber,
      usedFallback: false,
      persistedActiveSlot: null,
    };
  }
  const persistedActiveSlot = getActiveSlot();
  if (isValidSlotNumber(persistedActiveSlot)) {
    return {
      slot: persistedActiveSlot,
      usedFallback: true,
      persistedActiveSlot,
    };
  }
  return {
    slot: null,
    usedFallback: false,
    persistedActiveSlot: Number.isFinite(persistedActiveSlot) ? persistedActiveSlot : null,
  };
}

// savedAt of the run save each live RunManager last wrote, per slot (memory only).
const lastRunSaveStamps = new WeakMap();

/**
 * True when the stored run save for `slotNumber` is still the one this
 * RunManager last wrote — no other tab, cloud pull or run end has replaced or
 * removed it since. Background saves (page hidden / app paused) check this so
 * a stale in-memory run never overwrites a newer save or resurrects an ended run.
 */
export function isRunSaveCurrent(runManager, slotNumber) {
  const key = resolveRunKey(slotNumber);
  const stamp = key && runManager ? lastRunSaveStamps.get(runManager)?.get(slotNumber) : null;
  return Number.isFinite(stamp) && readLocalRunSavedAt(key) === stamp;
}

export function saveRun(runManager, onSave, slotNumber, { candidate = null } = {}) {
  const key = resolveRunKey(slotNumber);
  if (!key) return { ok: false, reason: 'missing_slot' };
  const json = {
    ...(candidate ?? runManager.toJSON()),
    savedAt: computeNextRunSavedAt(slotNumber, key),
  };
  let localOk = false;
  try {
    // On a full store, other slots' optional battle history makes room first.
    setItemFreeingSpace(key, JSON.stringify(json), slotNumber);
    localOk = true;
    if (runManager && typeof runManager === 'object') {
      if (!lastRunSaveStamps.has(runManager)) lastRunSaveStamps.set(runManager, new Map());
      lastRunSaveStamps.get(runManager).set(slotNumber, json.savedAt);
    }
  } catch (err) {
    const isQuota = isQuotaExceededError(err);
    console.warn('[RunManager] localStorage write failed:', err?.message || err);
    return { ok: false, reason: isQuota ? 'quota' : 'write_error', isQuotaError: isQuota };
  }

  let cloud = { queued: false, reason: 'offline' };
  if (localOk && onSave) {
    try {
      cloud = onSave(json) ?? { queued: true };
    } catch (err) {
      console.warn('[RunManager] onSave callback error:', err?.message || err);
      cloud = { queued: false, reason: 'callback_error' };
    }
  }

  return { ok: true, cloud };
}

/**
 * Watcher's Grace on a battle flag that never reached its first checkpoint: restore the entry
 * Vision the flag recorded (the grant is the only Vision write before that checkpoint). Does
 * nothing for a flag that granted nothing or recorded no entry.
 */
function restoreUncheckpointedBossVision(run, flag) {
  if (!(Number(flag?.bossVisionGranted) > 0)) return;
  if (!Number.isFinite(flag.visionChargesAtEntry)) return;
  run.visionChargesRemaining = Math.max(0, Math.trunc(flag.visionChargesAtEntry));
  if (Number.isFinite(flag.visionCountAtEntry)) run.visionCount = flag.visionCountAtEntry;
}

/**
 * Fields a "Continue from Map" revert restores from a battle-in-progress flag.
 * Pure: reads the flag, returns clones. Pre-v2 flags carry no entry snapshot;
 * the only mid-battle run write that era made was the village reward item,
 * whose uid the legacy checkpoint recorded, so it is scrubbed by uid instead.
 */
export function battleEntryRevertPatch(flag) {
  const patch = {};
  if (!flag || typeof flag !== 'object') return patch;
  const entry = flag.entryBattleState;
  if (entry && typeof entry === 'object') {
    if (entry.convoy && typeof entry.convoy === 'object')
      patch.convoy = structuredClone(entry.convoy);
    if (Array.isArray(entry.accessories)) patch.accessories = structuredClone(entry.accessories);
    if (Number.isFinite(entry.gold)) patch.gold = entry.gold;
  } else {
    const uid = flag.checkpoint?.villageState?.rewardItemUid;
    if (typeof uid === 'string' && uid) patch.removeConvoyUid = uid;
  }
  if (Number.isFinite(flag.visionChargesAtEntry))
    patch.visionChargesRemaining = flag.visionChargesAtEntry;
  if (Number.isFinite(flag.visionCountAtEntry)) patch.visionCount = flag.visionCountAtEntry;
  if (Number.isFinite(flag.rngSeedAtEntry)) patch.rngSeed = flag.rngSeedAtEntry;
  if (typeof flag.prologueVisionGrantedAtEntry === 'boolean')
    patch.prologueVisionGranted = flag.prologueVisionGrantedAtEntry;
  return patch;
}

/**
 * Scrub the suspended battle from the persisted save without re-serializing
 * live state ("Continue from map" — the sanctioned FE-reset full revert).
 * Entry-time Vision charges and RNG seed recorded on the flag are restored so
 * the revert is complete: mid-battle Vision spends and reseeds are refunded;
 * everything else stays byte-for-byte.
 */
export function clearBattleInProgressInSave(onSave, slotNumber) {
  const key = resolveRunKey(slotNumber);
  if (!key) return { ok: false, reason: 'missing_slot' };
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return { ok: true, reason: 'no_save' };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { ok: false, reason: 'corrupt' };
    if (parsed.battleInProgress == null) return { ok: true, reason: 'already_clear' };
    const flag = parsed.battleInProgress;
    if (flag?.checkpoint?.recoveryKind === 'fatal_pending')
      return { ok: false, reason: 'fatal_pending' };
    const patch = battleEntryRevertPatch(flag);
    if (patch.convoy) parsed.convoy = patch.convoy;
    if (patch.accessories) parsed.accessories = patch.accessories;
    if (patch.gold !== undefined) parsed.gold = patch.gold;
    if (patch.visionChargesRemaining !== undefined)
      parsed.visionChargesRemaining = patch.visionChargesRemaining;
    if (patch.visionCount !== undefined) parsed.visionCount = patch.visionCount;
    if (patch.rngSeed !== undefined) parsed.rngSeed = patch.rngSeed;
    if (patch.prologueVisionGranted !== undefined)
      parsed.prologueVisionGranted = patch.prologueVisionGranted;
    if (patch.removeConvoyUid && parsed.convoy && typeof parsed.convoy === 'object') {
      for (const bucket of ['consumables', 'weapons']) {
        if (Array.isArray(parsed.convoy[bucket]))
          parsed.convoy[bucket] = parsed.convoy[bucket].filter(
            (item) => item?.uid !== patch.removeConvoyUid,
          );
      }
    }
    parsed.battleInProgress = null;
    parsed.savedAt = computeNextRunSavedAt(slotNumber, key);
    setItemFreeingSpace(key, JSON.stringify(parsed), slotNumber);
    if (onSave) {
      try {
        onSave(parsed);
      } catch (err) {
        console.warn('[RunManager] onSave callback error:', err?.message || err);
      }
    }
    return { ok: true };
  } catch (err) {
    const isQuota = isQuotaExceededError(err);
    console.warn('[RunManager] clearBattleInProgressInSave failed:', err?.message || err);
    return { ok: false, reason: isQuota ? 'quota' : 'write_error', isQuotaError: isQuota };
  }
}

export function loadRun(gameData, slotNumber) {
  const key = resolveRunKey(slotNumber);
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    return RunManager.fromJSON(saved, gameData);
  } catch (err) {
    console.error(
      `[RunManager] loadRun failed for slot ${slotNumber ?? '(legacy)'}:`,
      err?.message || err,
    );
    return null;
  }
}

export function hasSavedRun(slotNumber) {
  const key = resolveRunKey(slotNumber);
  if (!key) return false;
  try {
    return localStorage.getItem(key) !== null;
  } catch (_) {
    return false;
  }
}

/**
 * True while a settled run's payout has not reached meta on disk (the meta
 * write failed). The run save must then be kept: it is the only record the
 * payout can be retried from (RunComplete retries on the next Continue).
 */
export function endRunPayoutPending(runManager, meta) {
  const rewards = runManager?.endRunRewards;
  return Boolean(meta && rewards && rewards.appliedToMeta !== true);
}

/**
 * Retry a kept run's pending payout (its meta write failed at run end), then
 * drop the save once paid. Called where the player lands between runs, so a
 * new run never replaces a save whose rewards were not credited yet.
 * @returns {boolean} true when a pending payout was paid and the save cleared
 */
export function retryPendingEndRunPayout(gameData, meta, slot, { onClear = null } = {}) {
  if (!meta || !isValidSlotNumber(slot)) return false;
  const rm = loadRun(gameData, slot);
  if (!rm?.endRunRewards) return false;
  rm.settleEndRunRewards(meta, rm.endRunRewards.result);
  if (endRunPayoutPending(rm, meta)) return false;
  clearSavedRun(onClear, slot);
  return true;
}

/**
 * Settle end-of-run rewards into meta, then immediately persist the run with
 * endRunRewards.appliedToMeta so a reload before RunComplete clears the save
 * re-reads the settled record instead of paying valor/supply a second time.
 * Without a slot (dev/QA routes, tutorial) there is nothing to persist.
 * @returns {object} the settled rewards summary
 */
export function settleAndPersistEndRun(runManager, meta, result, { onSave = null, slot } = {}) {
  const rewards = runManager.settleEndRunRewards(meta, result);
  if (isValidSlotNumber(slot)) {
    const saved = saveRun(runManager, onSave, slot);
    if (!saved?.ok)
      console.warn('[RunManager] settled run could not be persisted:', saved?.reason || saved);
  }
  return rewards;
}

export function clearSavedRun(onClear, slotNumber) {
  const { slot, usedFallback, persistedActiveSlot } = resolveSlotNumberForClear(slotNumber);
  if (!slot) {
    markStartup('run_clear_missing_slot_resolution_failed', {
      slot: null,
      requestedSlot: Number.isFinite(slotNumber) ? slotNumber : null,
      persistedActiveSlot,
      usedFallback: false,
    });
    return;
  }
  if (usedFallback) {
    markStartup('run_clear_slot_fallback_used', {
      slot,
      usedFallback: true,
    });
  }
  const key = getRunKey(slot);
  const floorKey = getRunClockFloorKey(slot);
  let abandonedRun = null;
  try {
    const raw = localStorage.getItem(key);
    if (raw !== null) abandonedRun = JSON.parse(raw);
  } catch {
    /* Unknown run identity cannot authorize a cloud deletion. */
  }
  try {
    localStorage.removeItem(key);
    localStorage.removeItem(floorKey);
  } catch (_) {
    /* ignore */
  }
  if (onClear) onClear(slot, abandonedRun);
}
