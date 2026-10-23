// AchievementFacts — what a durable point of a run knows, as plain facts for the achievement
// rules (engine/Achievements.js, docs/specs/achievements.md).
//
//   achievementTotals(gameData)            what "every" means: bosses, events, Marks, epic
//                                          weapons, deeds, lords and rungs in this build's data
//   runAchievementFacts(run, gameData)     the run as saved on the route map (null in the
//                                          prologue, outside a run, or while a battle is open)
//   runEndAchievementFacts(run, summary)   a finished standard run (its payout's summary)
//   recordRunAchievements(meta, run, gameData)  the route map's call, beside each run save
//   reconcileSlotAchievements(meta, gameData)   a slot opened: what its older records prove,
//                                          told once as a summary
//
// Pure: no Phaser, no DOM, never the RNG.

import { DIFFICULTY_IDS } from './DifficultyEngine.js';
import { isEpicWeapon } from './EpicWeapons.js';
import { findCommander } from './Commander.js';
import { everFallenUnits } from './LaidToRest.js';
import { isPrologueRun } from './ScriptedBattle.js';
import { runFeat, runFeatsFromStart } from './RunFeats.js';
import { stripItemNameSuffix, weaponCatalogNames } from '../utils/itemNames.js';
import { announceAchievements } from './AchievementStore.js';

const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const list = (v) => (Array.isArray(v) ? v : []);
const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const unique = (values) => [...new Set(values.filter(Boolean))];

/** The act bosses' names, in act order (elite captains are no act's boss). */
function bossNames(enemies) {
  const out = [];
  for (const pool of Object.values(isObject(enemies?.bosses) ? enemies.bosses : {}))
    for (const boss of list(pool)) out.push(text(boss?.name));
  return unique(out);
}

/** What each set-completing achievement asks for, from this build's game data. */
export function achievementTotals(gameData) {
  const events = isObject(gameData?.events) ? gameData.events.events : gameData?.events;
  const deeds = isObject(gameData?.deeds) ? gameData.deeds.deeds : gameData?.deeds;
  return {
    bosses: bossNames(gameData?.enemies),
    // The fallback event is met only when a node has nothing else left to offer, never by weight.
    events: unique(
      list(events)
        .filter((e) => e?.fallback !== true)
        .map((e) => text(e?.id)),
    ),
    marks: unique(list(gameData?.marks).map((m) => text(m?.id))),
    epics: unique(
      list(gameData?.weapons)
        .filter(isEpicWeapon)
        .map((w) => text(w?.name)),
    ),
    deeds: unique(list(deeds).map((d) => text(d?.id))),
    lords: unique(list(gameData?.lords).map((l) => text(l?.name))),
    // Seven Banners: a won run under each lord.
    commanders: unique(list(gameData?.lords).map((l) => text(l?.name))),
    rungs: [...DIFFICULTY_IDS],
  };
}

/** Every weapon the army holds: each unit's bag and the convoy. */
function heldWeapons(run) {
  const out = [];
  for (const unit of list(run?.roster)) out.push(...list(unit?.inventory));
  out.push(...list(run?.convoy?.weapons));
  return out.filter(isObject);
}

/** The catalog name of an epic weapon instance (its forge suffix and imbue word dropped). */
function epicName(weapon, epics) {
  const names = weaponCatalogNames(weapon);
  const known = new Set(list(epics));
  return names.find((name) => known.has(name)) || stripItemNameSuffix(names[0] || '') || null;
}

/** How many church vows of a kind this run has made. */
function churchVowCount(run, vow) {
  let count = 0;
  for (const made of Object.values(isObject(run?.churchVowByNodeId) ? run.churchVowByNodeId : {}))
    if ((Array.isArray(made) ? made : [made]).includes(vow)) count++;
  return count;
}

/**
 * The run as saved on the route map. Null when there is nothing a standard run's map can
 * count: no run, the prologue, or a battle still open (its gold and roster may yet revert).
 */
export function runAchievementFacts(run, gameData = null) {
  if (!run || isPrologueRun(run) || run.battleInProgress) return null;
  const totals = achievementTotals(gameData || run.gameData);
  const roster = list(run.roster).filter(isObject);
  const everyone = [...roster, ...everFallenUnits(run).filter(isObject)];
  const weapons = heldWeapons(run);
  const epics = weapons.filter(isEpicWeapon);
  const picks = isObject(run.earnedBlessingPicks) ? run.earnedBlessingPicks : {};
  const events = Object.values(isObject(run.eventStateByNodeId) ? run.eventStateByNodeId : {});
  return {
    playerPromotion: everyone.some((u) => u.promotedByPlayer === true),
    epithet: everyone.some((u) => list(u.deeds?.earned).length > 0),
    oath: everyone.some((u) => isObject(u.deeds?.oath)),
    bossRecruits: runFeat(run, 'bossRecruits'),
    markIds: unique(everyone.map((u) => text(u.markId))),
    maxDeeds: Math.max(0, ...roster.map((u) => list(u.deeds?.earned).length)),
    lordCount: unique(roster.filter((u) => u.isLord).map((u) => text(u.name))).length,
    blessingVows: churchVowCount(run, 'blessing'),
    cleanses: churchVowCount(run, 'cleanse'),
    actBossCards: Object.values(picks).filter(
      (p) => p?.source === 'act_boss' && p.status === 'taken',
    ).length,
    visionUses: Math.max(0, Math.trunc(Number(run.visionCount) || 0)),
    contractsPaid: runFeat(run, 'contractsPaid'),
    darkOmens: events.filter((s) => s?.dark === true && (s.choiceId || s.left)).length,
    sanctums: Object.keys(picks).filter((key) => key.startsWith('sanctum:')).length,
    arenaGoldWins: runFeat(run, 'arenaGoldWins'),
    arenaPlatinumWins: runFeat(run, 'arenaPlatinumWins'),
    gold: Math.max(0, Math.trunc(Number(run.gold) || 0)),
    maxForge: Math.max(0, ...weapons.map((w) => Math.trunc(Number(w._forgeLevel) || 0))),
    epicNames: unique(epics.map((w) => epicName(w, totals.epics))),
    trophy: weapons.some((w) => text(w.trophyOf)),
    eventIds: unique(events.map((s) => text(s?.eventId))),
  };
}

/**
 * A finished standard run, from its payout's summary (`{ result }`). Null for the prologue.
 */
export function runEndAchievementFacts(run, summary) {
  if (!run || isPrologueRun(run)) return null;
  const victory = summary?.result === 'victory';
  const telemetry = run.blessingSelectionTelemetry;
  const offered = list(telemetry?.offeredIds).length > 0;
  return {
    victory,
    difficulty: text(run.difficultyId) || 'normal',
    commander: text(findCommander(list(run.roster))?.name),
    // A fall a revival undid still fell: the counter, with the fallen list as its floor.
    allyFalls: Math.max(runFeat(run, 'allyFalls'), everFallenUnits(run).length),
    visionUses: Math.max(0, Math.trunc(Number(run.visionCount) || 0)),
    shopBuys: runFeat(run, 'shopBuys'),
    battlesWon: runFeat(run, 'battlesWon'),
    overPar: runFeat(run, 'overPar'),
    // The zero counts above mean "never" only for a run counted from its start.
    fromStart: runFeatsFromStart(run),
    blessingIds: unique(list(run.activeBlessings).map((b) => text(b?.id))),
    shrineSkipped: offered && list(telemetry.chosenIds).length === 0 && !run.startGift,
  };
}

/**
 * The route map's call beside each run save: what the run now shows, for the achievements.
 * Idempotent; writes the meta save only when something changed. Never throws.
 */
export function recordRunAchievements(meta, run, gameData = null) {
  if (typeof meta?.recordAchievementFacts !== 'function') return [];
  try {
    const facts = runAchievementFacts(run, gameData);
    if (!facts) return [];
    return meta.recordAchievementFacts({
      run: facts,
      totals: achievementTotals(gameData || run.gameData),
    });
  } catch (err) {
    console.warn('[Achievements] run facts skipped:', err?.message || err);
    return [];
  }
}

/**
 * A slot was opened (Slot Picker, Title): the retroactive pass over its older records, told
 * as one summary notice (`retro: true`) when it found any. Never throws.
 */
export function reconcileSlotAchievements(meta, gameData) {
  if (typeof meta?.reconcileAchievements !== 'function') return [];
  try {
    const ids = meta.reconcileAchievements(achievementTotals(gameData));
    if (ids.length) announceAchievements(ids, { retro: true });
    return ids;
  } catch (err) {
    console.warn('[Achievements] retroactive pass skipped:', err?.message || err);
    return [];
  }
}
