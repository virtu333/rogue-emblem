import { contributesToTeamLevel } from './SpecialCharacterPolicy.js';
import { VULNERARY_NAME, consumableTemplateFor } from './VulneraryRecipe.js';
// RecruitNodeSystem.js — who waits at a recruit node, known before you choose the road.
//
// docs/specs/strategy-layer.md. Pure (no Phaser). Two halves:
//
// 1. The preview's fixed part. When an act's map exists, every recruit node gets
//    `node.recruitPreview = { v, className, name }`, drawn from the act's recruit pool
//    on its own seeded stream (`recruit-preview:${runSeed}:${nodeId}`). Node-map
//    generation's Math.random is never touched, and legacy saves are filled in on load.
//
// 2. The unit. `buildRecruitNodeUnit` turns a preview into the NPC the battle spawns:
//    level, lord roll, promotion roll, growths, traits and gear all come from the
//    stream `recruit-unit:${runSeed}:${nodeId}` plus the run's current state (roster,
//    fallen, meta). The Loom calls it to show the recruit; BattleScene and the harness
//    call it to spawn them; with the same run state both get the same unit. The build
//    runs under a temporarily installed seeded Math.random and restores the caller's
//    generator (a battle's RNG stream is never consumed). The stream's first draws
//    decide who spawns (the lord roll can replace the preview's class);
//    `resolveRecruitNodeSpawnClass` replays just those, so the map generator can
//    seat the recruit on a tile the unit that actually spawns can stand on.
//
// Recruit-node recruits are "seasoned": growths roll in the upper half of each class
// range (as every recruit source's do: UnitManager.seasonedGrowthRanges) and they
// always carry at least one trait (the node is an elite-like fight).

import {
  BASE_CLASS_LEVEL_CAP,
  DEPLOY_LIMITS,
  RECRUIT_NODE_LORD_CHANCE,
  RECRUIT_SKILL_POOL,
} from '../utils/constants.js';
import { createSeededRng } from './BlessingEngine.js';
import {
  createBossLordUnit,
  getAvailableLords,
  getRecruitPoolEntries,
} from './BossRecruitSystem.js';
import {
  RECRUIT_PROMOTION_CONTEXT,
  getFailBaseLevel,
  getPromotionBaseLevel,
  isPromotedRecruitSource,
  rollRecruitPromotion,
} from './RecruitPromotion.js';
import { applyRecruitJoinBonus, resolveRecruitScalingTargets } from './RecruitScaling.js';
import { applyTraitCreationMods, rollTraits } from './TraitSystem.js';
import {
  addToConsumables,
  applyRecruitWeaponForge,
  checkLevelUpSkills,
  createRecruitUnit,
  getClassInnateSkills,
  grantLethalArmoryWeapon,
  grantRecruitStartingAccessory,
  grantMasterOfArmsWeapons,
  learnSkill,
  levelUp,
  promoteUnit,
  seasonedGrowthRanges,
  traitProfileForClass,
} from './UnitManager.js';

// Seasoned growths live in UnitManager now (every recruit source rolls them).
export { seasonedGrowthRanges };

export const RECRUIT_PREVIEW_VERSION = 1;
const XP_STAT_NAMES = ['HP', 'STR', 'MAG', 'SKL', 'SPD', 'DEF', 'RES', 'LCK'];

/** FNV-1a 32-bit (the same family as the Eclipse and node-map seeds). */
export function recruitHash(input) {
  let h = 2166136261 >>> 0;
  const text = String(input ?? '');
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seedBase(runSeed) {
  return Number.isFinite(Number(runSeed)) ? Number(runSeed) >>> 0 : 0;
}

/**
 * Run `fn` with Math.random replaced by a seeded stream (or `rngOverride`, for tests),
 * restoring the caller's generator afterwards.
 */
export function withRecruitSeed(key, fn, rngOverride = null) {
  const prev = Math.random;
  Math.random = typeof rngOverride === 'function' ? rngOverride : createSeededRng(recruitHash(key));
  try {
    return fn(Math.random);
  } finally {
    Math.random = prev;
  }
}

function isValidPreview(preview) {
  return Boolean(
    preview &&
    typeof preview === 'object' &&
    typeof preview.className === 'string' &&
    preview.className.trim() &&
    typeof preview.name === 'string' &&
    preview.name.trim(),
  );
}

/**
 * True for a node whose battle has a recruit's green unit: a recruit node, or an event whose
 * fight was started with a `recruit` (engine/EventEffects.js `battle.recruit`: the Old Faces).
 * Every reader of "a recruit battle" (the promised names, the spawn class, the unit, the
 * battle params' preview) asks this rather than the node's type.
 */
export function isRecruitBattleNode(node) {
  if (node?.type === 'recruit') return true;
  return (
    node?.type === 'event' &&
    node.eventBattle === true &&
    node.battleParams?.isRecruitBattle === true &&
    isValidPreview(node.recruitPreview)
  );
}

function namesInUse({ usedRecruitNames = {}, roster = [], fallenUnits = [] } = {}) {
  const used = new Set();
  for (const list of Object.values(usedRecruitNames || {}))
    if (Array.isArray(list)) for (const name of list) if (typeof name === 'string') used.add(name);
  for (const unit of [...(roster || []), ...(fallenUnits || [])])
    if (typeof unit?.name === 'string') used.add(unit.name);
  return used;
}

function uniqueName(base, taken) {
  const safe = typeof base === 'string' && base.trim() ? base.trim() : 'Recruit';
  if (!taken.has(safe)) return safe;
  const roman = ['II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
  for (const r of roman) if (!taken.has(`${safe} ${r}`)) return `${safe} ${r}`;
  for (let i = 11; ; i++) if (!taken.has(`${safe} ${i}`)) return `${safe} ${i}`;
}

/**
 * Give every recruit node in `nodeMap` its fixed preview (class + name) when it has
 * none. Completed and eclipsed nodes are left alone. Idempotent.
 * @returns {number} how many previews were created
 */
export function ensureRecruitPreviews(
  nodeMap,
  { runSeed, recruits, usedRecruitNames = {}, roster = [], fallenUnits = [] } = {},
) {
  const nodes = Array.isArray(nodeMap?.nodes) ? nodeMap.nodes : [];
  const actId = nodeMap?.actId || null;
  const pool = recruits?.[actId]?.classPool;
  if (!Array.isArray(pool) || pool.length === 0) return 0;
  const namePool = recruits?.namePool || {};
  const taken = namesInUse({ usedRecruitNames, roster, fallenUnits });
  for (const node of nodes) {
    if (isValidPreview(node?.recruitPreview)) taken.add(node.recruitPreview.name);
    // An Open Roll alternate is promised too (none exist without the blessing, so this changes
    // nothing for a run that does not hold it).
    if (isValidPreview(node?.recruitAlternate)) taken.add(node.recruitAlternate.name);
  }
  let created = 0;
  for (const node of nodes) {
    if (node?.type !== 'recruit' || node.completed) continue;
    if (isValidPreview(node.recruitPreview)) continue;
    const rng = createSeededRng(recruitHash(`recruit-preview:${seedBase(runSeed)}:${node.id}`));
    const className = pool[Math.floor(rng() * pool.length)];
    const names = Array.isArray(namePool[className]) ? namePool[className] : [];
    const free = names.filter((n) => !taken.has(n));
    const name = free.length
      ? free[Math.floor(rng() * free.length)]
      : uniqueName(names.length ? names[Math.floor(rng() * names.length)] : className, taken);
    taken.add(name);
    node.recruitPreview = { v: RECRUIT_PREVIEW_VERSION, className, name };
    created++;
  }
  return created;
}

/**
 * Open Roll (docs/specs/blessings-v3.md §5.3): give every open recruit node a second candidate,
 * `node.recruitAlternate = { v, className, name }`, when it has none. Drawn on its own stream
 * (`recruit-preview-alt:${runSeed}:${nodeId}`), so the node's preview, the node-map stream and
 * the unit stream (`recruit-unit:…`, which builds whichever candidate the player meets) never
 * move. It prefers a class other than the preview's, and a name no unit, preview or alternate on
 * the map holds. Completed, eclipsed and locked nodes are left alone (their encounter is set).
 * Idempotent.
 * @returns {number} how many alternates were created
 */
export function ensureRecruitAlternates(
  nodeMap,
  { runSeed, recruits, usedRecruitNames = {}, roster = [], fallenUnits = [] } = {},
) {
  const nodes = Array.isArray(nodeMap?.nodes) ? nodeMap.nodes : [];
  const actId = nodeMap?.actId || null;
  const pool = recruits?.[actId]?.classPool;
  if (!Array.isArray(pool) || pool.length === 0) return 0;
  const namePool = recruits?.namePool || {};
  const taken = namesInUse({ usedRecruitNames, roster, fallenUnits });
  for (const node of nodes) {
    if (isValidPreview(node?.recruitPreview)) taken.add(node.recruitPreview.name);
    if (isValidPreview(node?.recruitAlternate)) taken.add(node.recruitAlternate.name);
  }
  let created = 0;
  for (const node of nodes) {
    if (node?.type !== 'recruit' || node.completed || node.eclipse || node.encounterLocked)
      continue;
    if (!isValidPreview(node.recruitPreview) || isValidPreview(node.recruitAlternate)) continue;
    const rng = createSeededRng(recruitHash(`recruit-preview-alt:${seedBase(runSeed)}:${node.id}`));
    const others = pool.filter((c) => c !== node.recruitPreview.className);
    const classes = others.length ? others : pool;
    const className = classes[Math.floor(rng() * classes.length)];
    const names = Array.isArray(namePool[className]) ? namePool[className] : [];
    const free = names.filter((n) => !taken.has(n));
    const name = free.length
      ? free[Math.floor(rng() * free.length)]
      : uniqueName(names.length ? names[Math.floor(rng() * names.length)] : className, taken);
    taken.add(name);
    node.recruitAlternate = { v: RECRUIT_PREVIEW_VERSION, className, name };
    created++;
  }
  return created;
}

/**
 * Open Roll: meet the node's other candidate instead. Swaps `recruitPreview` and
 * `recruitAlternate` in place (the unit stream is the node's, so each candidate is built the
 * same whichever way round). Refused once the encounter is locked, the node is done or fallen,
 * or there is no alternate.
 * @returns {{ ok: true, preview: object } | { ok: false, reason: string }}
 */
export function swapRecruitAlternate(node) {
  if (node?.type !== 'recruit') return { ok: false, reason: 'not_recruit' };
  if (node.completed || node.eclipse) return { ok: false, reason: 'closed' };
  if (node.encounterLocked) return { ok: false, reason: 'locked' };
  if (!isValidPreview(node.recruitPreview) || !isValidPreview(node.recruitAlternate))
    return { ok: false, reason: 'no_alternate' };
  const preview = node.recruitAlternate;
  node.recruitAlternate = node.recruitPreview;
  node.recruitPreview = preview;
  return { ok: true, preview };
}

/**
 * Which spawn tile each deployed unit takes. In a recruit battle the spawns arrive
 * ordered nearest-first to the recruit (MapGenerator.orderSpawnsTowardTarget) and the
 * lords — the only units who can Talk — take the first ones; everyone else keeps the
 * deployment order. Returns one tile (or null) per unit, aligned with `units`.
 */
export function spawnTilesForDeployment(units, spawns, { lordsFirst = false } = {}) {
  const list = Array.isArray(units) ? units : [];
  const tiles = Array.isArray(spawns) ? spawns : [];
  const order = list.map((_, i) => i);
  if (lordsFirst)
    order.sort(
      (a, b) => Number(Boolean(list[b]?.isLord)) - Number(Boolean(list[a]?.isLord)) || a - b,
    );
  const result = new Array(list.length).fill(null);
  order.forEach((unitIndex, k) => {
    if (k < tiles.length) result[unitIndex] = tiles[k];
  });
  return result;
}

/** Effective level (promoted units count as 10 + level), as RecruitScaling does. */
function effectiveLevel(unit) {
  const lvl = Math.max(1, Math.trunc(Number(unit?.level) || 1));
  return unit?.tier === 'promoted' ? 10 + lvl : lvl;
}

/**
 * The most units the recruit-node join level averages over. Act 3+ deploy caps grew
 * to 7-8 (+2 with bonuses); averaging that many would pull the deepest benchwarmer in
 * and lower join levels, so the squad stays at the six it was.
 */
export const RECRUIT_NODE_LEVEL_SQUAD_MAX = 6;

/**
 * The level a recruit-node recruit joins at: the average effective level of the
 * strongest squad you can field this act (the top deploy-cap units, at most
 * RECRUIT_NODE_LEVEL_SQUAD_MAX), plus blessing / meta recruit-level bonuses, never
 * below the act pool's minimum.
 */
export function resolveRecruitNodeLevel({
  roster = [],
  act = 'act1',
  enemies = null,
  deployBonus = 0,
  recruitLevelBonus = 0,
} = {}) {
  const deployCap = (DEPLOY_LIMITS[act]?.max || 4) + Math.trunc(Number(deployBonus) || 0);
  const cap = Math.max(1, Math.min(RECRUIT_NODE_LEVEL_SQUAD_MAX, deployCap));
  const levels = (Array.isArray(roster) ? roster : [])
    .filter(contributesToTeamLevel)
    .map(effectiveLevel)
    .sort((a, b) => b - a)
    .slice(0, cap);
  const avg = levels.length
    ? Math.max(1, Math.floor(levels.reduce((s, v) => s + v, 0) / levels.length))
    : 1;
  const actMin = enemies?.pools?.[act]?.levelRange?.[0] || 1;
  return Math.max(actMin, avg + Math.trunc(Number(recruitLevelBonus) || 0));
}

function ensureOneTrait(unit, traitsData, rng, profile) {
  if (!Array.isArray(traitsData) || !traitsData.length) return;
  if (Array.isArray(unit.traits) && unit.traits.length > 0) return;
  const pool = traitsData.filter((t) => t.rarity !== 'legendary');
  const [id] = rollTraits(pool, 1, rng, profile || unit);
  const trait = traitsData.find((t) => t.id === id);
  if (!trait) return;
  unit.traits = [id];
  applyTraitCreationMods(unit, trait, { profile: profile || unit });
}

function levelBy(unit, count) {
  for (let i = 0; i < count; i++) {
    const result = levelUp(unit);
    if (!result) break;
    unit.level = result.newLevel;
    for (const stat of XP_STAT_NAMES) unit.stats[stat] += result.gains[stat];
    unit.currentHP += result.gains.HP;
  }
}

/**
 * The first draws of a recruit node's unit stream decide WHO spawns: the lord roll
 * (roll, pick, promotion) and, for a promoted preview class, the promotion roll that
 * picks the promoted class or its base. `buildRecruitNodeUnit` and
 * `resolveRecruitNodeSpawnClass` both call this first on the same stream, so the
 * class the map generator seats and the unit the battle spawns can never disagree.
 */
function planRecruitNodeSpawn(
  { preview, act, roster, fallenUnits, gameData, metaEffects, startingLordNames },
  rng,
) {
  const classes = gameData.classes || [];
  const promotionContext = {
    type: RECRUIT_PROMOTION_CONTEXT.RECRUIT_NODE,
    classesData: classes,
  };

  // Lord roll: the same 15% (+ meta) as before; which lord is drawn from those still free.
  const lordChance = Math.min(
    1,
    Math.max(0, RECRUIT_NODE_LORD_CHANCE + (Number(metaEffects?.lordRecruitChanceBonus) || 0)),
  );
  const lordRoll = rng();
  const lordPick = rng();
  const promoteRoll = rng();
  const available = getAvailableLords(roster, gameData.lords || [], fallenUnits, startingLordNames);
  if (available.length > 0 && lordRoll < lordChance) {
    const lordDef = available[Math.floor(lordPick * available.length)];
    const lordClassData = classes.find((c) => c.name === lordDef.class);
    if (lordClassData) {
      const poolClass = getRecruitPoolEntries(gameData.recruits, act, classes)
        .map((entry) => classes.find((c) => c.name === entry.className))
        .find((c) => isPromotedRecruitSource(c, classes));
      const promotedClass =
        typeof lordDef?.promotedClass === 'string'
          ? classes.find((c) => c.name === lordDef.promotedClass)
          : null;
      const canPromote = Boolean(
        promotedClass && (lordDef?.promotionBonuses || promotedClass?.promotionBonuses),
      );
      const roll =
        canPromote && poolClass
          ? rollRecruitPromotion(promotionContext, poolClass, metaEffects, () => promoteRoll)
          : { promote: false };
      const promoteLord = canPromote && roll.promote;
      return {
        isLord: true,
        lordDef,
        lordClassData,
        promoteLord,
        className: promoteLord ? promotedClass.name : lordClassData.name,
      };
    }
  }

  const npcClassData = classes.find((c) => c.name === preview.className);
  if (!npcClassData) return null;
  if (npcClassData.tier !== 'promoted')
    return { isLord: false, npcClassData, className: npcClassData.name };
  const roll = rollRecruitPromotion(promotionContext, npcClassData, metaEffects, () => rng());
  const baseName = roll.eligible ? npcClassData.promotesFrom : null;
  const baseClass = baseName ? classes.find((c) => c.name === baseName) : null;
  return {
    isLord: false,
    npcClassData,
    roll,
    baseClass,
    className: roll.eligible && baseClass && !roll.promote ? baseClass.name : npcClassData.name,
  };
}

/**
 * The class (and move type) of the unit `buildRecruitNodeUnit` would spawn for the
 * same options, without building it: the map generator seats the recruit on a tile
 * that unit can stand on (a Myrmidon preview can resolve to Rowan, a Cavalry lord).
 * Pure; consumes no caller RNG.
 * @returns {{ className: string, moveType: string, isLord: boolean } | null}
 */
export function resolveRecruitNodeSpawnClass(opts = {}) {
  const {
    preview,
    nodeId,
    runSeed,
    act = 'act1',
    roster = [],
    fallenUnits = [],
    gameData = {},
    metaEffects = null,
    startingLordNames,
    rng: rngOverride = null,
  } = opts;
  if (!isValidPreview(preview)) return null;
  const rng =
    typeof rngOverride === 'function'
      ? rngOverride
      : createSeededRng(recruitHash(`recruit-unit:${seedBase(runSeed)}:${nodeId}`));
  const plan = planRecruitNodeSpawn(
    { preview, act, roster, fallenUnits, gameData, metaEffects, startingLordNames },
    rng,
  );
  if (!plan) return null;
  const classData = (gameData.classes || []).find((c) => c.name === plan.className);
  return {
    className: plan.className,
    moveType: classData?.moveType || 'Infantry',
    isLord: plan.isLord,
  };
}

/**
 * Build the NPC a recruit node spawns. Deterministic for a given preview, node, run
 * seed and run state; never consumes the caller's Math.random.
 *
 * @param {object} opts
 * @param {{className:string,name:string}} opts.preview
 * @param {string} opts.nodeId
 * @param {number} opts.runSeed
 * @param {string} opts.act
 * @param {Array} opts.roster       the run roster (serialized units)
 * @param {Array} [opts.fallenUnits]
 * @param {object} opts.gameData    { classes, weapons, skills, traits, lords, recruits, enemies, accessories, consumables }
 * @param {object} [opts.metaEffects] effective meta effects (RunManager.getEffectiveMetaEffects)
 * @param {Array<string>} [opts.startingLordNames]
 * @param {number} [opts.recruitLevelBonus]
 * @param {number} [opts.deployBonus]
 * @param {boolean} [opts.seasoned=true]
 * @param {() => number} [opts.rng]  test override for the seeded stream
 * @returns {{ unit: object, isLord: boolean, level: number } | null}
 */
export function buildRecruitNodeUnit(opts = {}) {
  const {
    preview,
    nodeId,
    runSeed,
    act = 'act1',
    roster = [],
    fallenUnits = [],
    gameData = {},
    metaEffects = null,
    startingLordNames,
    recruitLevelBonus = 0,
    deployBonus = 0,
    seasoned = true,
    rng: rngOverride = null,
  } = opts;
  if (!isValidPreview(preview)) return null;
  const classes = gameData.classes || [];
  const key = `recruit-unit:${seedBase(runSeed)}:${nodeId}`;
  return withRecruitSeed(
    key,
    (rng) => {
      const level = resolveRecruitNodeLevel({
        roster,
        act,
        enemies: gameData.enemies,
        deployBonus,
        recruitLevelBonus,
      });
      const { dynamicPromotionLevel, promotedLevelTarget, failBaseLevelCap } =
        resolveRecruitScalingTargets(roster);
      const plan = planRecruitNodeSpawn(
        { preview, act, roster, fallenUnits, gameData, metaEffects, startingLordNames },
        rng,
      );
      if (!plan) return null;

      if (plan.isLord) {
        const unit = createBossLordUnit(
          plan.lordDef,
          plan.lordClassData,
          gameData.weapons,
          level,
          metaEffects,
          {
            act,
            promoteLord: plan.promoteLord,
            classes,
            skills: gameData.skills || [],
            consumables: gameData.consumables,
            dynamicPromotionLevel,
            promotedLevelTarget,
            baseLevelOverride: null,
          },
        );
        applyRecruitJoinBonus(unit, act);
        unit.faction = 'npc';
        return { unit, isLord: true, level: unit.level };
      }

      const { npcClassData } = plan;
      const statBonuses = metaEffects?.statBonuses || null;
      const growthBonuses = metaEffects?.growthBonuses || null;
      const skillPool = metaEffects?.recruitRandomSkill ? RECRUIT_SKILL_POOL : null;
      const traitOptions = {
        traitsData: gameData.traits || null,
        skillsData: gameData.skills,
        rng,
        // The Mark roll (UnitManager.createRecruitUnit): its own stream, never `rng`.
        runSeed: seedBase(runSeed),
        metaEffects,
        marksData: gameData.marks || null,
      };
      const def = { name: preview.name, className: preview.className, level };
      let unit;
      let profile = null;
      const make = (d, cls, extra = {}) =>
        createRecruitUnit(
          d,
          cls,
          gameData.weapons,
          statBonuses,
          growthBonuses,
          skillPool,
          classes,
          { ...traitOptions, seasoned, ...extra },
        );
      if (npcClassData.tier === 'promoted') {
        const { roll, baseClass } = plan;
        if (roll.eligible && roll.promote && baseClass) {
          unit = make(
            {
              ...def,
              className: baseClass.name,
              level: getPromotionBaseLevel(level),
            },
            baseClass,
            { traitClassData: npcClassData },
          );
          for (const sid of getClassInnateSkills(baseClass.name, gameData.skills))
            learnSkill(unit, sid);
          promoteUnit(unit, npcClassData, npcClassData.promotionBonuses, gameData.skills);
          levelBy(unit, Math.max(0, promotedLevelTarget - 1));
          checkLevelUpSkills(unit, classes);
          profile = traitProfileForClass(unit, npcClassData);
        } else if (roll.eligible && baseClass) {
          unit = make(
            {
              ...def,
              className: baseClass.name,
              level: getFailBaseLevel(level, failBaseLevelCap),
            },
            baseClass,
          );
          for (const sid of getClassInnateSkills(baseClass.name, gameData.skills))
            learnSkill(unit, sid);
        } else {
          unit = make({ ...def, level: Math.min(level, BASE_CLASS_LEVEL_CAP) }, npcClassData);
        }
      } else {
        unit = make(def, npcClassData);
        for (const sid of getClassInnateSkills(npcClassData.name, gameData.skills))
          learnSkill(unit, sid);
      }
      if (seasoned) ensureOneTrait(unit, gameData.traits, rng, profile);

      applyRecruitJoinBonus(unit, act);
      if (metaEffects?.lethalArmoryTier)
        grantLethalArmoryWeapon(unit, gameData.weapons, metaEffects.lethalArmoryTier);
      if (metaEffects?.recruitWeaponForge)
        applyRecruitWeaponForge(unit, metaEffects.recruitWeaponForge);
      // After the forge: Master of Arms extras arrive plain (grantMasterOfArmsWeapons).
      if (metaEffects?.masterOfArms) grantMasterOfArmsWeapons(unit, gameData.weapons);
      if (metaEffects?.recruitStartingAccessory)
        grantRecruitStartingAccessory(
          unit,
          gameData.accessories,
          metaEffects.recruitStartingAccessory,
        );
      if (metaEffects?.recruitStartingVulnerary) {
        const vulnerary = consumableTemplateFor(gameData.consumables, VULNERARY_NAME, metaEffects);
        if (vulnerary) addToConsumables(unit, vulnerary);
      }
      unit.faction = 'npc';
      return { unit, isLord: false, level: unit.level };
    },
    rngOverride,
  );
}
