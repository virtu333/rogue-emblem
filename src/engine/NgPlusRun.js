// NgPlusRun.js - the run side of NG+ (docs/specs/ng-plus.md): an NG+ run's start (the
// veterans brought back at a fresh level, every Barracks lord's kept kit), who can ride
// again after a win, and what a run's end does to the Barracks.
//
// Pure apart from the RunManager it is handed (its roster, convoy and ledgers). No Phaser,
// no Math.random: a veteran is rebuilt from its saved growths and traits, never rolled.
//
//   run.ngPlus = { v: 1, members: [{ id, uid, keptUids }], lordKits: [record], echo } | null
//
// `members` are the Barracks records playing this run (a brought veteran, or a lord whose
// kit came back), by the record id and the unit's run uid; `keptUids` the kept items that
// rode with it (not one left home, nor a one-per-run weapon the run already had), so the
// run's end can read each one as it is then (forged, worn, used) or find it gone; `lordKits` the Barracks lords not in the starting roster, kept for a third lord who
// joins later; `echo` the run's Echo, the rides of every member counted as it joins
// (engine/NgPlusEcho.js: the enemies' scaling). A kept weapon's forges above the act's limit
// sleep and wake act by act (engine/KeptForges.js); the Barracks always stores them awake.
// A run without the record (null) is an ordinary run.
import {
  addToConsumables,
  addToInventory,
  createRecruitUnit,
  equipAccessory,
  equipIfUnarmed,
  equipWeapon,
  learnSkill,
} from './UnitManager.js';
import { applyTraitCreationMods, reapplyTraitGrowthMods } from './TraitSystem.js';
import { applyRecruitJoinBonus } from './RecruitScaling.js';
import { unitBaseClassName } from './ClassLineage.js';
import { lockedSkillIds } from './SkillLoadout.js';
import { slotKindOf, swornOathSkillId } from './SkillSlots.js';
import { everFallenUnits } from './LaidToRest.js';
import { isDuplicateLegendary, recordLegendaryGrant } from './LegendaryOwnership.js';
import { isSignatureWeapon } from './SignatureWeapons.js';
import { findCommander } from './Commander.js';
import { serializeUnit } from './UnitSerialization.js';
import { isPrologueRun } from './ScriptedBattle.js';
import { carriedCopy, keptForgeAwakeLimit, lullForges } from './KeptForges.js';
import { keptForgeAwakeTable, keptForgeCarry, recordEcho } from './NgPlusEcho.js';
import {
  INNATE_GROWTHS,
  isNgPlusRung,
  keptItemKind,
  lordRecordId,
  ridingKeptItems,
  sanitizeRecord,
} from './NgPlusState.js';

export const NG_PLUS_RUN_VERSION = 1;

const isRecord = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const isId = (v) => typeof v === 'string' && v.length > 0 && v.length <= 160;

/** A saved `run.ngPlus`, or null for anything that is not a whole v1 record. */
export function sanitizeNgPlusRun(raw) {
  if (!isRecord(raw) || raw.v !== NG_PLUS_RUN_VERSION) return null;
  const members = [];
  const seen = new Set();
  for (const entry of Array.isArray(raw.members) ? raw.members : []) {
    if (!isRecord(entry) || !isId(entry.id) || !isId(entry.uid) || seen.has(entry.id)) continue;
    seen.add(entry.id);
    members.push({
      id: entry.id,
      uid: entry.uid,
      keptUids: [...new Set((Array.isArray(entry.keptUids) ? entry.keptUids : []).filter(isId))],
    });
  }
  const lordKits = (Array.isArray(raw.lordKits) ? raw.lordKits : [])
    .map(sanitizeRecord)
    .filter((record) => record?.kind === 'lord');
  const echo = Math.max(0, Math.floor(Number(raw.echo) || 0));
  return { v: NG_PLUS_RUN_VERSION, members, lordKits, echo };
}

/** True when the run is an NG+ run. */
export function isNgPlusRun(run) {
  return Boolean(run?.ngPlus && run.ngPlus.v === NG_PLUS_RUN_VERSION);
}

/** Drop a fresh copy of the lord's signature weapon when the kit brings the kept one. */
function makeRoomForSignature(unit, kept) {
  if (!isSignatureWeapon(kept)) return;
  const fresh = (unit.inventory || []).find(
    (item) => item !== kept && item?.signatureOf === kept.signatureOf,
  );
  if (!fresh) return;
  const wasEquipped = unit.weapon === fresh || unit.weapon?.uid === fresh.uid;
  unit.inventory = unit.inventory.filter((item) => item !== fresh);
  if (wasEquipped) unit.weapon = null;
}

/** Put one kept item on the unit (bag, belt, worn) or, with no room, in the army's stores. */
function placeKeptItem(run, unit, item) {
  const copy = structuredClone(item);
  const kind = keptItemKind(copy);
  if (kind === 'accessory') {
    if (!unit.accessory) equipAccessory(unit, copy);
    else run.accessories.push(copy);
  } else if (kind === 'consumable') {
    if (!addToConsumables(unit, copy)) run._keepMigratedItem(copy);
  } else if (kind === 'weapon') {
    // Its forges above the act's limit sleep until a later act (engine/KeptForges.js).
    lullForges(
      copy,
      keptForgeAwakeLimit(run.currentAct || 'act1', keptForgeAwakeTable(run.gameData)),
    );
    makeRoomForSignature(unit, copy);
    if (addToInventory(unit, copy)) {
      const placed = unit.inventory.at(-1);
      if (isSignatureWeapon(placed) && !unit.weapon) equipWeapon(unit, placed);
      else equipIfUnarmed(unit, placed);
    } else run._keepMigratedItem(copy);
  } else return;
  recordLegendaryGrant(run, copy);
}

/**
 * A record's kept skills and items put on the unit (never a second copy of an item held).
 * An item left home stays in the Barracks, and so does a one-per-run weapon the run already
 * has (another member's kept copy, or one found before this lord joined): the run holds one.
 * Returns the uids of the kept items riding with the unit, the ones the run's end reads again.
 */
function applyKit(run, unit, record) {
  const skillsData = run.gameData?.skills;
  for (const skillId of record.keptSkills || []) learnSkill(unit, skillId, { skillsData });
  if (!Array.isArray(run.accessories)) run.accessories = [];
  const held = heldItemsByUid(run);
  const riding = [];
  for (const item of ridingKeptItems(record)) {
    if (!isId(item?.uid)) continue;
    if (!held.has(item.uid)) {
      if (isDuplicateLegendary(run, item)) continue;
      placeKeptItem(run, unit, item);
    }
    riding.push(item.uid);
  }
  return riding;
}

/** What a unit's traits add to its growths (the growth half of their creation mods). */
function traitGrowthDeltas(run, unit) {
  const probe = { ...unit, growths: {} };
  reapplyTraitGrowthMods(probe, run.gameData?.traits || null);
  return probe.growths;
}

const addGrowths = (growths, deltas, sign = 1) => {
  const out = { ...growths };
  for (const [stat, delta] of Object.entries(deltas || {}))
    if (Number.isFinite(delta) && delta !== 0) out[stat] = (out[stat] || 0) + sign * delta;
  return out;
};

/**
 * A recruit veteran as it comes back: its base class at level 1, its own growths and
 * traits (their stat changes, never a second helping of their growth changes), its Mark and
 * face, the run's recruit stat upgrades and the act's join bonus. Null when its class is gone.
 *
 * A record whose growths are innate (`growthsBasis: 'innate'`: the roll and its traits'
 * growth changes, nothing else) takes this run's recruit growth upgrades, scaled by this
 * run's rung, as any recruit who joins at the start does; the run's blessings reach it with
 * the rest of the roster. A legacy record (saved before identities were innate: its growths
 * are the unit's as it ended that run, the run's upgrades and blessings in them, and what
 * they were cannot be told apart) comes back with exactly those growths and nothing added.
 */
export function buildVeteranUnit(run, record) {
  const classes = run.gameData?.classes || [];
  const classData = classes.find((c) => c.name === record.className && c.tier !== 'promoted');
  if (!classData?.baseStats) return null;
  const takenNames = run._getTrackedRecruitNames();
  const name = run._makeUniqueRecruitName(record.name, takenNames);
  // No growth ranges and no traits data: nothing is rolled (no Math.random draw).
  const template = { ...classData, growthRanges: null, growthBonuses: null };
  const unit = createRecruitUnit(
    { name, level: 1 },
    template,
    run.gameData?.weapons || [],
    run.metaEffects?.statBonuses || null,
    null,
    null,
    classes,
    { skillsData: run.gameData?.skills },
  );
  unit.growths = structuredClone(record.growths);
  unit.traits = [...(record.traits || [])];
  if (record.traitAttackStat) unit.traitAttackStat = record.traitAttackStat;
  const growths = unit.growths;
  for (const id of unit.traits) {
    const trait = (run.gameData?.traits || []).find((t) => t?.id === id);
    if (!trait) continue;
    unit.growths = { ...growths };
    applyTraitCreationMods(unit, trait);
  }
  if (record.growthsBasis === INNATE_GROWTHS) {
    // Its own roll again (so a later identity reads it), then this run's upgrades on top.
    unit.rolledGrowths = addGrowths(growths, traitGrowthDeltas(run, unit), -1);
    const meta = run._scaleGrowthBonuses(
      run.metaEffects?.growthBonuses || null,
      run._getGrowthBonusMultiplier(),
    );
    unit.growths = addGrowths(growths, meta);
  } else {
    delete unit.rolledGrowths;
    unit.growths = growths;
  }
  if (record.markId) unit.markId = record.markId;
  if (record.portraitVariant != null) unit.portraitVariant = record.portraitVariant;
  unit.faction = 'player';
  applyRecruitJoinBonus(unit, run.currentAct || 'act1');
  run._trackRecruitNameUse(classData.name, name);
  return unit;
}

/**
 * Start an NG+ run on a fresh roster (RunManager.startRun, after the starting roster and the
 * run's ledgers are made): every starting lord with a Barracks record takes its kit back and
 * the brought veterans join. Returns the run's `ngPlus` record, or null for no NG+ start.
 * @param {object} start - NgPlusState.runStartOf: { veterans, lordKits }
 */
export function startNgPlusRun(run, start) {
  if (!isRecord(start) || isPrologueRun(run)) return null;
  const ngPlus = { v: NG_PLUS_RUN_VERSION, members: [], lordKits: [], echo: 0 };
  const kits = new Map(
    (start.lordKits || [])
      .map(sanitizeRecord)
      .filter((record) => record?.kind === 'lord')
      .map((record) => [record.name, record]),
  );
  for (const unit of run.roster || []) {
    const record = unit?.isLord ? kits.get(unit.name) : null;
    if (!record) continue;
    kits.delete(unit.name);
    const keptUids = applyKit(run, unit, record);
    ngPlus.echo += recordEcho(record);
    ngPlus.members.push({ id: record.id, uid: run.assignUnitUid(unit), keptUids });
  }
  ngPlus.lordKits = [...kits.values()];
  for (const raw of start.veterans || []) {
    const record = sanitizeRecord(raw);
    if (record?.kind !== 'recruit') continue;
    const unit = buildVeteranUnit(run, record);
    if (!unit) continue;
    const keptUids = applyKit(run, unit, record);
    ngPlus.echo += recordEcho(record);
    const saved = serializeUnit(unit);
    run.roster.push(saved);
    ngPlus.members.push({ id: record.id, uid: run.assignUnitUid(saved), keptUids });
  }
  run.ensurePortraitVariants?.();
  return ngPlus;
}

/** The third lord joins an NG+ run: their kit comes back (RunManager.resolveThirdLord). */
export function applyNgPlusThirdLord(run, unit) {
  if (!isNgPlusRun(run) || !unit?.isLord) return false;
  const kits = run.ngPlus.lordKits || [];
  const record = kits.find((r) => r?.id === lordRecordId(unit.name));
  if (!record || run.ngPlus.members.some((m) => m.id === record.id)) return false;
  run.ngPlus.lordKits = kits.filter((r) => r !== record);
  const keptUids = applyKit(run, unit, record);
  // The third lord's Echo counts from their arrival (the maps made from then on).
  run.ngPlus.echo = (run.ngPlus.echo || 0) + recordEcho(record);
  run.ngPlus.members.push({ id: record.id, uid: run.assignUnitUid(unit), keptUids });
  return true;
}

/**
 * Every lord on the roster whose Barracks kit still waits takes it, once (the kit leaves
 * `lordKits` as it is applied). Every way a lord joins after the run's start reaches it:
 * Power of Friendship (RunManager.resolveThirdLord), a boss draft
 * (PendingBossRecruit.resolveBossRecruit), a recruit node's Talk (the victory commit,
 * RunManager.completeBattle), and a save where one joined before this was so (fromJSON,
 * restoreNgPlusRun). Returns the names that took a kit.
 */
export function applyPendingNgPlusLordKits(run) {
  if (!isNgPlusRun(run) || !run.ngPlus.lordKits?.length) return [];
  const applied = [];
  for (const unit of run.roster || []) if (applyNgPlusThirdLord(run, unit)) applied.push(unit.name);
  return applied;
}

/**
 * A loaded run's `ngPlus` (RunManager.fromJSON, after the roster and stores): sanitized, and a
 * lord who joined before every join path applied the kit (a boss draft, a recruit node) takes
 * it now. Never over a suspended battle: its checkpoint holds the army's own copies, and the
 * victory commit hands the kit over instead.
 */
export function restoreNgPlusRun(run, saved) {
  run.ngPlus = sanitizeNgPlusRun(saved?.ngPlus);
  if (!saved?.battleInProgress) applyPendingNgPlusLordKits(run);
  return run.ngPlus;
}

/** Skills a class line teaches by level (relearned by levelling, never kept). */
function curriculumSkillIds(unit, classes) {
  const ids = new Set();
  for (const name of [unit?.className, unitBaseClassName(unit, classes)]) {
    const cls = classes.find((c) => c?.name === name);
    for (const entry of cls?.learnableSkills || []) if (entry?.skillId) ids.add(entry.skillId);
  }
  return ids;
}

/** What a unit could keep: skills it learned (not its lord, class or curriculum skills). */
function keepableSkills(run, unit) {
  const gameData = run.gameData || {};
  const locked = lockedSkillIds(unit, gameData);
  const oath = swornOathSkillId(unit);
  if (oath) locked.delete(oath);
  const curriculum = curriculumSkillIds(unit, gameData.classes || []);
  const known = [...(unit.skills || []), ...(unit.benchedSkills || [])];
  return [...new Set(known)].filter(
    (id) => typeof id === 'string' && !locked.has(id) && (id === oath || !curriculum.has(id)),
  );
}

/** Uids of the items the run's Barracks members brought (kept before this run). */
function memberKeptUids(run) {
  return new Set((run.ngPlus?.members || []).flatMap((m) => m?.keptUids || []));
}

/**
 * What the Barracks stores of an item: every kept forge awake, and only `ngPlus.keptForgeCarry`
 * of this run's forges (engine/KeptForges.js `carriedCopy`).
 */
function carriedItem(run, item, keptUids = memberKeptUids(run)) {
  return carriedCopy(item, keptForgeCarry(run.gameData), { kept: keptUids.has(item?.uid) });
}

/** Items a unit could keep: its bag, belt and worn accessory (no other lord's weapon). */
function keepableItems(run, unit) {
  const keptUids = memberKeptUids(run);
  return [...(unit.inventory || []), ...(unit.consumables || []), unit.accessory]
    .filter((item) => keptItemKind(item) && isId(item.uid))
    .filter((item) => !isSignatureWeapon(item) || item.signatureOf === unit.name)
    .map((item) => carriedItem(run, item, keptUids));
}

const hasGrowthTable = (value) =>
  isRecord(value) && Object.values(value).some((v) => Number.isFinite(v));

/**
 * A recruit's identity, read off the unit as it ends the run. Its growths are innate: the
 * roll it was made with (`rolledGrowths`, before promotion, meta upgrades or blessings) plus
 * what its traits add, so the next run lays its own upgrades and blessings on top. A unit
 * made before the roll was kept (no `rolledGrowths`) is a legacy identity: its base line's
 * growths as they are now, the promotion's bonus taken off.
 */
function identityOf(run, unit) {
  const classes = run.gameData?.classes || [];
  const className = unitBaseClassName(unit, classes);
  if (!className || !unit.growths) return null;
  let growths;
  let growthsBasis = null;
  if (hasGrowthTable(unit.rolledGrowths)) {
    growths = addGrowths(unit.rolledGrowths, traitGrowthDeltas(run, unit));
    growthsBasis = INNATE_GROWTHS;
  } else {
    growths = { ...unit.growths };
    if (unit.tier === 'promoted') {
      const promoted = classes.find((c) => c?.name === unit.className);
      for (const [stat, bonus] of Object.entries(promoted?.growthBonuses || {}))
        if (Number.isFinite(growths[stat])) growths[stat] -= bonus;
    }
  }
  return {
    className,
    growths,
    ...(growthsBasis ? { growthsBasis } : {}),
    traits: [...(unit.traits || [])],
    traitAttackStat: unit.traitAttackStat ?? null,
    markId: unit.markId ?? null,
    portraitVariant: unit.portraitVariant ?? null,
  };
}

/** True for a unit that can ride again (an army unit of its own: no Gaspar, no merchant). */
function canRide(unit) {
  return (
    isRecord(unit) &&
    unit.faction === 'player' &&
    !unit.isCaravan &&
    !unit.specialCharId &&
    isId(unit.unitUid) &&
    typeof unit.name === 'string' &&
    unit.name.length > 0
  );
}

/** The survivors of a won run, as "Who rides again?" offers them. */
export function rideCandidates(run) {
  const skillsData = run.gameData?.skills;
  const members = new Map((run.ngPlus?.members || []).map((m) => [m.uid, m.id]));
  return (run.roster || []).filter(canRide).map((unit) => {
    const skills = keepableSkills(run, unit);
    const skillKinds = {};
    for (const id of skills) skillKinds[id] = slotKindOf(id, skillsData);
    const kind = unit.isLord ? 'lord' : 'recruit';
    return {
      ref: unit.unitUid,
      kind,
      name: unit.name,
      className: unit.className || '',
      level: unit.level || 1,
      tier: unit.tier === 'promoted' ? 'promoted' : 'base',
      recordId: members.get(unit.unitUid) || null,
      identity: kind === 'recruit' ? identityOf(run, unit) : null,
      items: keepableItems(run, unit),
      skills,
      skillKinds,
    };
  });
}

/** Every item the army holds, by uid: the roster's bags, belts and accessories, the stores. */
function heldItemsByUid(run) {
  const byUid = new Map();
  const add = (item) => {
    if (isRecord(item) && isId(item.uid) && !byUid.has(item.uid)) byUid.set(item.uid, item);
  };
  for (const unit of run.roster || []) {
    for (const item of unit?.inventory || []) add(item);
    for (const item of unit?.consumables || []) add(item);
    add(unit?.accessory);
  }
  for (const item of run.convoy?.weapons || []) add(item);
  for (const item of run.convoy?.consumables || []) add(item);
  for (const item of run.accessories || []) add(item);
  return byUid;
}

/**
 * What a run's end does to the Barracks (NgPlusState.applyRunEnd's record), or null when
 * nothing does: a member that fell leaves, the commander a defeat took loses their latest ride
 * (`setBackIds`); on a win each
 * member still standing keeps its items as they are now; a win on an NG+ rung leaves its
 * survivors to pick from, whether or not NG+ is bought yet.
 * @param {{ result: 'victory'|'defeat' }} summary - the run's settled rewards
 */
export function ngPlusRunEnd(run, summary) {
  if (!run || isPrologueRun(run)) return null;
  const victory = summary?.result === 'victory';
  const members = run.ngPlus?.members || [];
  const fallenUids = new Set(
    everFallenUnits(run)
      .map((u) => u?.unitUid)
      .filter(Boolean),
  );
  // The commander a defeat took is set back one ride, never wiped (the owner's call): every
  // lost run ends with the commander down, so wiping would cost a built-up lord everything.
  const commanderUid =
    !victory && run.defeatContext ? findCommander(run.roster || [])?.unitUid || null : null;
  const setBackIds = members.filter((m) => m.uid === commanderUid).map((m) => m.id);
  const fallenIds = members
    .filter((m) => m.uid !== commanderUid && fallenUids.has(m.uid))
    .map((m) => m.id);
  const refresh = [];
  if (victory) {
    const held = heldItemsByUid(run);
    const standing = new Set((run.roster || []).map((u) => u?.unitUid).filter(Boolean));
    for (const member of members) {
      if (fallenUids.has(member.uid) || !standing.has(member.uid)) continue;
      refresh.push({
        id: member.id,
        keptUids: [...member.keptUids],
        keptItems: member.keptUids
          .map((uid) => held.get(uid))
          .filter(Boolean)
          .map((item) => carriedItem(run, item)),
      });
    }
  }
  const pendingRide =
    victory && isNgPlusRung(run.difficultyId)
      ? {
          runId: run.runRecordId || `run-${run.runSeed}`,
          difficultyId: run.difficultyId,
          endedAt: Date.now(),
          candidates: rideCandidates(run),
        }
      : null;
  const ngPlusWin = victory && isNgPlusRun(run);
  if (!fallenIds.length && !setBackIds.length && !refresh.length && !pendingRide && !ngPlusWin)
    return null;
  return { fallenIds, setBackIds, refresh, pendingRide, ngPlusWin };
}
