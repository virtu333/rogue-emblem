// RunFormat.js - the run-format guard (docs/specs/large-maps/04-set-pieces.md §12.1, §16.5).
// Pure: no Phaser, no storage, no RNG (a memo of timeline scans by record identity aside).
//
// A client from before a mechanic reads a run save without knowing what that mechanic added,
// and would misplay or drop it. So a run that holds any such mechanic (a capability) carries
// a marker, and the format it needs is derived from the mechanics the save holds, never from
// one feature's field:
//
//   requiredRunFormat(saved)   what the serialized run holds: { format, capabilities }
//   storedRunFormat(saved)     what its marker says (requiresClient, requiresCapabilities)
//   effectiveRunFormat(saved)  the larger of the two (what the cloud hold-back reads)
//   runFormatBlock(saved)      null when this client may load it, else why not
//   runFormatMarker(saved, floor)  the marker toJSON writes: floor ∪ derived, or nothing
//
// Both sides are read on load: a save whose writer left the marker out is still caught by a
// client that knows the capability (derived), and an id this client has never heard of is
// caught by id (stored). Every function reads the SERIALIZED run (what RunManager.toJSON writes
// and the cloud sees), never a RunManager, so the loader, the slot summary and the cloud
// hold-back can call it on the raw payload before fromJSON's migrations touch it.
//
// Every capability maps to format 2, the first format whose clients honour the list. A client
// refuses an id it does not play (CLIENT_CAPABILITIES), so a later capability needs no new
// format number. The PR that adds a writer adds its id there in the same change (a client never
// writes what it cannot read; tests/harness/RunFormatRegistry.test.js holds it). This build
// writes the Descent's four (act-v-descent; shipped dark, so a run gains them only once
// data/descent.json is switched on, or the defeat model on an event set piece that names one).
//
// Detection errs toward holding: a false positive keeps one run on its device until the
// cloud lift (CloudSync.CLOUD_SAFE_RUN_FORMAT); a miss lets an older client corrupt a run.

import { peekBattleStatePatch } from './BattleStateDelta.js';

/** The format of a save that holds no capability: every client reads it. */
export const LEGACY_RUN_FORMAT = 1;
/** The newest format this build honours (the capability list). */
export const RUN_FORMAT = 2;

/**
 * Every capability the guard knows, and what an older client would do with it. Detection for
 * each lives below; each maps to format 2.
 */
export const RUN_CAPABILITIES = Object.freeze({
  // Groups beyond today's hold packs, wakes, patrols, triggered waves (spec 02).
  encounters: 2,
  // A locked par model (02 §5.2): an older client would price par, and enrage, differently.
  parModel: 2,
  // Objectives the legacy `objective` string cannot say, phases, bonuses (spec 03).
  objectives: 2,
  // The Gate terrain and its structure HP (03 PR 7).
  gateTerrain: 2,
  // Boss kits and signatures (spec 05), First Light's signature-only kits included.
  bossKit: 2,
  // Boss arena variants written by a post-pass (05 K0).
  arena: 2,
  // Assembled set pieces (04). The shipped event set pieces are not one (04 §16.5).
  setPiece: 2,
  // The Descent's authored Act V route (act-v-descent §2, §9.1, §9.3): `nodeMap.descent` and its
  // stamped nodes. An older client would build template rout maps for its set pieces (no
  // Lieutenant seated at the gate), give a boss recruit and no Vision at the gate, let the
  // Eclipse take the Stair, the Vigil or the Landing, and pay `finalBoss`'s gold-only loot.
  // RunManager._buildActNodeMap holds a run to it the moment it builds the route (the floor).
  descent: 2,
  // The Rite (§4, §9.5): `run.rite` and what it writes into battles (tiers, mods, the Hollowed
  // level rule). An older client would drop it on load and seat every boss untiered.
  rite: 2,
  // The Vigil (§3.1, §5.2): a locked config's `vigil` and a checkpoint's `vigilState`. An older
  // client would fight the Voices as plain foes: no words, no summons, the count lost on resume.
  vigil: 2,
  // BattleObjectives' version-1 model of `defeat` primaries (act-v-descent §9.4), on any act (a
  // v2 set piece may name one). An older client would play the map as its legacy rout. Any other
  // model beyond the legacy derivation is `objectives` (spec 03), which this build does not play.
  defeatObjective: 2,
  // The Entity's anti-kiting kit (engine/EntityKit.js): a locked config's `entityKit` and a
  // checkpoint's `entityKitState`. An older client would fight the Entity without its limbs or
  // its undertow, and a resumed battle would hold Grasping Limbs it has no class for.
  entityKit: 2,
  // NG+ (docs/specs/ng-plus.md): `run.ngPlus`, the Barracks members playing the run. An older
  // client would drop it on load, so the run's end would never settle the Barracks (a fallen
  // veteran kept, a win's items and ride never recorded).
  ngPlus: 2,
  // NG+ Echo and kept forges (docs/specs/ng-plus.md §13): `run.ngPlus.echo` and a kept weapon's
  // `_dormantForges`. An older NG+ client would drop the Echo on load (enemies back at Echo 0)
  // and never wake the sleeping forges at an act's start. Every NG+ run this build writes holds
  // it (its record always carries `echo`); an NG+ save from before has no `echo` and is read as
  // Echo 0 with every kept forge awake (NgPlusRun.sanitizeNgPlusRun), the rules it was made under.
  ngPlusEcho: 2,
  // Omens (engine/Omens.js): `run.omens`. An older client keeps the levers laid on the run's
  // difficulty modifiers but drops the rest (Grave Road, Hunting Party, Marked Foes' extra affix).
  omens: 2,
});

export const CAPABILITY_IDS = Object.freeze(Object.keys(RUN_CAPABILITIES));

/** The id RunManager._buildActNodeMap holds a run to as it builds the Descent's route. */
export const DESCENT_CAPABILITY = 'descent';

/**
 * The capabilities this build plays: each writer's PR adds its id here. The guard shipped
 * before any; the Descent added its four, the Entity kit its one, NG+ its two (the run, then Echo and kept forges), Omens
 * theirs.
 */
export const CLIENT_CAPABILITIES = Object.freeze([
  'descent',
  'rite',
  'vigil',
  'defeatObjective',
  'entityKit',
  'ngPlus',
  'ngPlusEcho',
  'omens',
]);

/** The terrain index the Gate takes (03 §5.7): terrain.json holds 0..18 today. */
export const GATE_TERRAIN_INDEX = 19;

/** A run that cannot be loaded by this client (thrown by RunManager.fromJSON). */
export class RunFormatError extends Error {
  constructor(block) {
    super(
      `Run needs a newer client (format ${block?.format ?? '?'}` +
        `${block?.missing?.length ? `; ${block.missing.join(', ')}` : ''})`,
    );
    this.name = 'RunFormatError';
    this.block = block || null;
  }
}

/**
 * Every key the large-maps specs and the Descent add to a saved run, by where it lives, and
 * what it is (§12.1 step 8): `inert` (data no old reader looks at), `legacy` (an older client
 * already plays it right: the shipped event set pieces, §16.5), `marker` (the guard's own
 * fields), or the capability id(s) that hold a run carrying it. Detection above decides when a
 * value really holds one (a `hold:` group is legacy whatever its key). A PR that writes a new key
 * into one of these places lists it here; tests/harness/RunFormatRegistry.test.js takes a key
 * census over generated runs, maps and checkpoints and fails on a key that is neither here nor
 * in the frozen baseline of keys that existed before the guard.
 */
export const RUN_FORMAT_FIELDS = Object.freeze({
  // A node's battleParams (and the battle in progress's).
  battleParams: Object.freeze({
    setPiece: 'legacy',
    deployCap: 'legacy',
    objectivePreview: Object.freeze(['objectives', 'setPiece']),
    setPieceFallback: 'setPiece',
    arenaVariant: 'arena',
    parModel: 'parModel',
    // The Descent: a route node's boss seated by name and its role (gate | finale).
    bossName: 'descent',
    bossRole: 'descent',
    // A Descent defeat node's model over its seize set piece (Descent.DEFEAT_BOSS_OBJECTIVES).
    objectives: Object.freeze(['defeatObjective', 'objectives']),
    // RunManager.getBattleParams, only while a Rite exists.
    riteAtEntry: 'rite',
    riteBand: 'rite',
    riteLevel: 'rite',
    riteMods: 'rite',
    // The act boss's trade cards (engine/TradeBoons.js), only while one is held: Gambler's
    // Edge's affix odds and Chronicle's XP roles. An older client plays the battle without them.
    affixChanceMultiplier: 'inert',
    xpRoleMultipliers: 'inert',
    // Wave 2: Standard of the Sun's cost (foes go for the commander), Oathbound Steel's weapon
    // lock and Siegebreaker's reach. An older client plays the battle without them.
    foesTargetCommander: 'inert',
    weaponSwapLocked: 'inert',
    rangedRangeBonus: 'inert',
    // The rung's Entity kit (RunManager.getBattleParams, final act only): read by the map
    // generator, which locks it into the config of a map that seats the Entity (below).
    entityKit: 'inert',
  }),
  // A locked battle config.
  battleConfig: Object.freeze({
    setPieceId: 'legacy',
    setPieceVariant: 'legacy',
    mirrored: 'legacy',
    // A procedural template's per-battle choices (TemplateLayout.js): a record, read by no rule.
    templateChoices: 'inert',
    formationSpares: 'legacy',
    encounterGroups: 'encounters',
    triggeredWaves: 'encounters',
    parModel: 'parModel',
    objectives: Object.freeze(['defeatObjective', 'objectives']),
    npcAllies: 'objectives',
    structures: 'gateTerrain',
    bossKit: 'bossKit',
    bossSignature: 'bossKit',
    arenaVariant: 'arena',
    setPieceVersion: 'setPiece',
    setPieceChoices: 'setPiece',
    setPieceChunks: 'setPiece',
    anchors: 'inert',
    encounterVersion: 'inert',
    parRoute: 'inert',
    vigil: 'vigil',
    // What the Rite did to the map (RiteBattleMods): its record, and the Entity's splash count.
    riteMods: 'rite',
    entitySplashCount: 'rite',
    entityKit: 'entityKit',
  }),
  // A locked config's enemy spawn.
  enemySpawn: Object.freeze({
    holdWakeTurn: 'legacy',
    // A procedural template's enemy group (TemplateLayout.js); its orders are legacy fields.
    templateGroup: 'inert',
    patrolIndex: 'encounters',
    encounterGroupId: 'encounters',
    clampTile: 'objectives',
    objectiveRef: 'objectives',
    bossKit: 'bossKit',
    // A set piece slot's id: read only by a defeat target and a Voice, which hold their own.
    authoredId: 'inert',
  }),
  // A battle checkpoint's top level (and a Vision snapshot's, a timeline destination's).
  checkpoint: Object.freeze({
    encounterState: 'encounters',
    objectiveState: 'objectives',
    bossState: 'bossKit',
    vigilState: 'vigil',
    entityKitState: 'entityKit',
  }),
  // The serialized run's top level.
  run: Object.freeze({
    requiresClient: 'marker',
    requiresCapabilities: 'marker',
    bonusVisionActs: 'objectives',
    setPiecesOffered: 'setPiece',
    rite: 'rite',
    ngPlus: Object.freeze(['ngPlus', 'ngPlusEcho']),
    omens: 'omens',
    // The Ruins' one revival per node (RuinsCommands): an older client allows a second.
    ruinsRevivedByNodeId: 'inert',
    // Each church's revivals (ChurchCommands): an older client has no church limit.
    churchRevivesByNodeId: 'inert',
    // The won battles' worth toward the run-end payout: an older client pays its own
    // flat per-battle rate instead.
    metaBattlePoints: 'inert',
    // Lord recruit odds v2 (engine/LordRecruitChance.js): an older client rolls the flat chance.
    lordRecruitOdds: 'inert',
  }),
  // The route map's top level.
  nodeMap: Object.freeze({
    descent: 'descent',
  }),
  // A route node (any node, done or not: the route is the run's, not one battle's).
  node: Object.freeze({
    authored: 'descent',
    descentKey: 'descent',
    eventPool: 'descent',
    fallable: 'descent',
    riteTarget: 'descent',
  }),
});

/** The classes a RUN_FORMAT_FIELDS entry may take besides a capability id. */
export const RUN_FORMAT_FIELD_CLASSES = Object.freeze(['inert', 'legacy', 'marker']);

const isRecord = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const nonEmptyArray = (v) => Array.isArray(v) && v.length > 0;
const hasEntries = (v) => isRecord(v) && Object.keys(v).length > 0;
const isHoldKey = (v) => typeof v === 'string' && v.startsWith('hold:');
const present = (obj, key) => isRecord(obj) && obj[key] !== undefined && obj[key] !== null;

// ---------------------------------------------------------------------------------------------
// Encounter groups (02 §3.2, §3.6). A group is legacy-equivalent when an older client plays it
// as today's hold pack: a `hold:<pack>` group that wakes on `danger` / `hurt` (plus the
// absolute `turn` an authored set piece's `wake: N` derives, 04 §16.3) and hunts once awake.

function isLegacyWake(wake) {
  if (!isRecord(wake)) return false;
  // Today's hold rules wake at once: no delay but 0.
  if (wake.delay !== undefined && wake.delay !== 0) return false;
  if (wake.kind === 'danger' || wake.kind === 'hurt')
    return Object.keys(wake).every((key) => key === 'kind' || key === 'delay');
  // The event set pieces' `holdWakeTurn`: an absolute turn, nothing relative (04 §16.5).
  if (wake.kind === 'turn')
    return (
      Number.isInteger(wake.turn) &&
      Object.keys(wake).every((key) => key === 'kind' || key === 'delay' || key === 'turn')
    );
  return false;
}

// The fields a legacy hold group carries (02 §3.6's adapter writes no other).
const LEGACY_GROUP_KEYS = new Set(['id', 'members', 'state', 'wake', 'onWake']);

function isLegacyGroup(group) {
  if (!isRecord(group) || !isHoldKey(group.id)) return false;
  if (Object.keys(group).some((key) => !LEGACY_GROUP_KEYS.has(key))) return false;
  const wakes = group.wake === undefined ? [] : group.wake;
  if (!Array.isArray(wakes) || !wakes.every(isLegacyWake)) return false;
  if (group.onWake !== undefined && group.onWake !== null) {
    if (!isRecord(group.onWake)) return false;
    if (Object.keys(group.onWake).some((key) => key !== 'mode')) return false;
    if ((group.onWake.mode ?? 'hunt') !== 'hunt') return false;
  }
  if (group.state !== undefined && group.state !== 'dormant') return false;
  return true;
}

function unitHoldsEncounter(unit) {
  if (!isRecord(unit)) return false;
  if (unit.patrolIndex !== undefined && unit.patrolIndex !== null) return true;
  const id = unit.encounterGroupId;
  return id !== undefined && id !== null && !isHoldKey(id);
}

// ---------------------------------------------------------------------------------------------
// Objectives (03 §3.1, §3.2): written objectives that say more than the legacy derivation.

const DERIVED_PRIMARY_KINDS = new Set(['rout', 'seize', 'escape']);
const DERIVED_BONUS_IDS = new Set(['village', 'caravan']);
const DERIVED_OBJECTIVE_IDS = new Set(['rout', 'seize', 'escape', 'village', 'caravan']);

function objectivesBeyondLegacy(objectives) {
  if (objectives === undefined || objectives === null) return false;
  if (!isRecord(objectives)) return true;
  const primary = Array.isArray(objectives.primary) ? objectives.primary : [];
  if (primary.length > 1) return true;
  if (primary.some((p) => !isRecord(p) || !DERIVED_PRIMARY_KINDS.has(p.kind))) return true;
  if (nonEmptyArray(objectives.phases)) return true;
  const bonus = Array.isArray(objectives.bonus) ? objectives.bonus : [];
  if (bonus.some((b) => !isRecord(b) || !DERIVED_BONUS_IDS.has(b.id))) return true;
  if (objectives.parAdjust !== undefined && objectives.parAdjust !== 0) return true;
  // A seize with more than one throne is not today's seize.
  if (primary.some((p) => Array.isArray(p.thrones) && p.thrones.length > 1)) return true;
  return false;
}

// The model this build plays (BattleObjectives.js, act-v-descent §9.4): version 1, `defeat`
// primaries and nothing else. Read here by its own keys, never through BattleObjectives'
// validator, so a later build that teaches that module more kinds (large-maps PR 1) cannot widen
// what `defeatObjective` means: any other written model stays `objectives`.
const DEFEAT_MODEL_KEYS = new Set(['version', 'primary']);
const DEFEAT_PRIMARY_KEYS = new Set(['id', 'kind', 'targets', 'need', 'label']);

function isDefeatModel(objectives) {
  if (!isRecord(objectives) || objectives.version !== 1) return false;
  if (Object.keys(objectives).some((key) => !DEFEAT_MODEL_KEYS.has(key))) return false;
  if (!nonEmptyArray(objectives.primary)) return false;
  return objectives.primary.every(
    (p) =>
      isRecord(p) &&
      p.kind === 'defeat' &&
      typeof p.id === 'string' &&
      Object.keys(p).every((key) => DEFEAT_PRIMARY_KEYS.has(key)) &&
      nonEmptyArray(p.targets) &&
      p.targets.every((ref) => typeof ref === 'string' && ref.length > 0),
  );
}

/** The capability a written objectives model holds, or null for the legacy derivation's. */
function objectivesCapability(objectives) {
  if (isDefeatModel(objectives)) return 'defeatObjective';
  return objectivesBeyondLegacy(objectives) ? 'objectives' : null;
}

function objectiveStateBeyondLegacy(state) {
  if (state === undefined || state === null) return false;
  if (!isRecord(state)) return true;
  if (Number(state.phase) > 0) return true;
  if (hasEntries(state.points) || hasEntries(state.structures) || hasEntries(state.floors))
    return true;
  if (nonEmptyArray(state.escorted) || nonEmptyArray(state.fled)) return true;
  if (
    isRecord(state.status) &&
    Object.keys(state.status).some((id) => !DERIVED_OBJECTIVE_IDS.has(id))
  )
    return true;
  if (isRecord(state.thrones) && Object.keys(state.thrones).some((id) => id !== 'throne'))
    return true;
  return false;
}

function unitHoldsObjective(unit) {
  return isRecord(unit) && (present(unit, 'clampTile') || present(unit, 'objectiveRef'));
}

// ---------------------------------------------------------------------------------------------
// The Descent (act-v-descent): its route, the Rite's battle fields.

// A route node's Descent stamps (Descent.buildNode). Title, preview and bossLine are not among
// them: the prologue's route carried them first, and an older client shows them as meant.
const DESCENT_NODE_KEYS = ['authored', 'descentKey', 'eventPool', 'fallable', 'riteTarget'];
// What RunManager.getBattleParams adds while a Rite exists.
const RITE_PARAM_KEYS = ['riteAtEntry', 'riteBand', 'riteLevel', 'riteMods'];

/** The route map: the Descent's, or any node it stamped (done or not). */
function scanRouteMap(nodeMap, found) {
  if (!isRecord(nodeMap)) return;
  if (present(nodeMap, 'descent')) found.add('descent');
  for (const node of Array.isArray(nodeMap.nodes) ? nodeMap.nodes : []) {
    if (DESCENT_NODE_KEYS.some((key) => present(node, key))) found.add('descent');
  }
}

// ---------------------------------------------------------------------------------------------
// The places a run holds mechanics.

function mapLayoutHasGate(layout) {
  if (!Array.isArray(layout)) return false;
  for (const row of layout) {
    if (!Array.isArray(row)) continue;
    for (const tile of row) if (tile === GATE_TERRAIN_INDEX) return true;
  }
  return false;
}

/** A not-yet-complete node's battle params. */
function scanNodeParams(params, found) {
  if (!isRecord(params)) return;
  if (present(params, 'objectivePreview')) {
    found.add('objectives');
    found.add('setPiece');
  }
  if (present(params, 'setPieceFallback')) found.add('setPiece');
  if (present(params, 'arenaVariant')) found.add('arena');
  if (present(params, 'parModel')) found.add('parModel');
  if (present(params, 'bossName') || present(params, 'bossRole')) found.add('descent');
  const objectives = objectivesCapability(params.objectives);
  if (objectives) found.add(objectives);
  if (RITE_PARAM_KEYS.some((key) => present(params, key))) found.add('rite');
}

/** A locked battle config (or one a checkpoint carries). */
function scanBattleConfig(config, found) {
  if (!isRecord(config)) return;
  const groups = config.encounterGroups;
  if (groups !== undefined && groups !== null) {
    if (!Array.isArray(groups) || groups.some((g) => !isLegacyGroup(g))) found.add('encounters');
  }
  if (nonEmptyArray(config.triggeredWaves) || nonEmptyArray(config.reinforcements?.triggeredWaves))
    found.add('encounters');
  if (present(config, 'parModel')) found.add('parModel');
  const objectives = objectivesCapability(config.objectives);
  if (objectives) found.add(objectives);
  if (present(config, 'npcAllies')) found.add('objectives');
  if (present(config, 'vigil')) found.add('vigil');
  if (present(config, 'entityKit')) found.add('entityKit');
  if (present(config, 'riteMods') || present(config, 'entitySplashCount')) found.add('rite');
  if (nonEmptyArray(config.structures)) found.add('gateTerrain');
  if (mapLayoutHasGate(config.mapLayout)) found.add('gateTerrain');
  if (present(config, 'bossKit') || present(config, 'bossSignature')) found.add('bossKit');
  if (present(config, 'arenaVariant')) found.add('arena');
  if (['setPieceVersion', 'setPieceChoices', 'setPieceChunks'].some((k) => present(config, k)))
    found.add('setPiece');
  for (const spawn of Array.isArray(config.enemySpawns) ? config.enemySpawns : []) {
    if (unitHoldsEncounter(spawn)) found.add('encounters');
    if (unitHoldsObjective(spawn)) found.add('objectives');
    if (present(spawn, 'bossKit')) found.add('bossKit');
  }
}

const STATE_UNIT_LISTS = [
  'playerUnits',
  'enemyUnits',
  'npcUnits',
  'escapedUnits',
  'nonDeployedUnits',
];

/** A battle state: a checkpoint, a Vision snapshot or a timeline destination. */
function scanBattleState(state, found) {
  if (!isRecord(state)) return;
  const encounter = state.encounterState;
  if (isRecord(encounter)) {
    for (const bucket of ['groups', 'fired']) {
      const entries = encounter[bucket];
      if (isRecord(entries) && Object.keys(entries).some((key) => !isHoldKey(key)))
        found.add('encounters');
    }
  } else if (encounter !== undefined && encounter !== null) {
    found.add('encounters');
  }
  if (objectiveStateBeyondLegacy(state.objectiveState)) found.add('objectives');
  if (hasEntries(state.bossState) || (state.bossState != null && !isRecord(state.bossState)))
    found.add('bossKit');
  if (mapLayoutHasGate(state.mapLayout)) found.add('gateTerrain');
  if (present(state, 'vigilState')) found.add('vigil');
  if (present(state, 'entityKitState')) found.add('entityKit');
  for (const list of STATE_UNIT_LISTS) {
    for (const unit of Array.isArray(state[list]) ? state[list] : []) {
      if (unitHoldsEncounter(unit)) found.add('encounters');
      if (unitHoldsObjective(unit)) found.add('objectives');
      if (present(unit, 'bossKit')) found.add('bossKit');
    }
  }
  if (isRecord(state.battleConfig)) scanBattleConfig(state.battleConfig, found);
}

// What each stored timeline record holds, by identity. A save scans the whole timeline after every
// action, but BattleTimeline never changes a stored record: it replaces it (a rebase stores a new
// object), so a record seen before holds what it held. A patch's entry is reused only while its
// keyframe and patch are the same objects. Memory only, and never a reason to hold less: a miss
// scans.
const timelineScans = new WeakMap();

function scanStoredSnapshot(stored, snapshots, found) {
  const isPatch = Object.keys(stored).length === 2 && typeof stored.base === 'string';
  const base = isPatch ? snapshots[stored.base] : null;
  const patch = isPatch ? stored.patch : null;
  const hit = timelineScans.get(stored);
  if (hit && hit.base === base && hit.patch === patch) {
    for (const id of hit.ids) found.add(id);
    return;
  }
  const ids = new Set();
  if (!isPatch) scanBattleState(stored, ids);
  else if (isRecord(base)) {
    try {
      // Read-only view (shares structure with the keyframe): nothing is written back.
      scanBattleState(peekBattleStatePatch(base, patch), ids);
    } catch {
      /* a malformed patch is unreadable optional history: it restores nothing either */
    }
  }
  timelineScans.set(stored, { base, patch, ids });
  for (const id of ids) found.add(id);
}

/** The rewind timeline's stored destinations: full states and patches against a keyframe. */
function scanTimeline(timeline, found) {
  const snapshots = isRecord(timeline?.snapshots) ? timeline.snapshots : null;
  if (!snapshots) return;
  for (const stored of Object.values(snapshots)) {
    if (isRecord(stored)) scanStoredSnapshot(stored, snapshots, found);
  }
}

function scanBattleInProgress(flag, found) {
  if (!isRecord(flag)) return;
  scanNodeParams(flag.battleParams, found);
  const checkpoint = flag.checkpoint;
  if (isRecord(checkpoint)) {
    scanBattleState(checkpoint, found);
    scanBattleState(checkpoint.visionSnapshot, found);
    scanBattleState(checkpoint.pendingVisionSnapshot, found);
  }
  scanTimeline(flag.timeline, found);
}

function scanRunFields(saved, found) {
  const modifiers = saved.difficultyModifiers;
  if (isRecord(modifiers)) {
    const plan = modifiers.encounterPlan;
    if (isRecord(plan) && Object.values(plan).some((v) => v !== null && v !== undefined))
      found.add('encounters');
    else if (plan !== undefined && plan !== null && !isRecord(plan)) found.add('encounters');
    if (modifiers.bossKits?.enabled === true) found.add('bossKit');
  }
  if (present(saved, 'bonusVisionActs')) found.add('objectives');
  if (nonEmptyArray(saved.setPiecesOffered)) found.add('setPiece');
  if (present(saved, 'rite')) found.add('rite');
  if (present(saved, 'ngPlus')) found.add('ngPlus');
  if (isRecord(saved.ngPlus) && saved.ngPlus.echo !== undefined) found.add('ngPlusEcho');
  if (present(saved, 'omens')) found.add('omens');
}

/** Capability ids sorted in the table's order (a stable marker). */
function sortCapabilities(ids) {
  const set = new Set(ids);
  const known = CAPABILITY_IDS.filter((id) => set.has(id));
  const unknown = [...set].filter((id) => !RUN_CAPABILITIES[id]).sort();
  return [...known, ...unknown];
}

/**
 * The format a serialized run needs, derived from the mechanics it holds (never from the
 * marker). Reads the route map (the Descent's stamps), the node map's not-yet-complete nodes'
 * params, the locked configs, the battle in
 * progress (its params, checkpoint, Vision snapshots and rewind timeline) and the run fields.
 * @param {object} saved - a serialized run (RunManager.toJSON's shape)
 * @returns {{ format: number, capabilities: string[] }}
 */
export function requiredRunFormat(saved) {
  const found = new Set();
  if (!isRecord(saved)) return { format: LEGACY_RUN_FORMAT, capabilities: [] };
  scanRouteMap(saved.nodeMap, found);
  for (const node of Array.isArray(saved.nodeMap?.nodes) ? saved.nodeMap.nodes : []) {
    if (!isRecord(node) || node.completed === true) continue;
    scanNodeParams(node.battleParams, found);
  }
  const configs = saved.battleConfigsByNodeId;
  if (isRecord(configs))
    for (const config of Object.values(configs)) scanBattleConfig(config, found);
  scanBattleInProgress(saved.battleInProgress, found);
  scanRunFields(saved, found);
  const capabilities = sortCapabilities(found);
  return { format: formatOf(capabilities), capabilities };
}

function formatOf(ids) {
  let format = LEGACY_RUN_FORMAT;
  for (const id of ids) format = Math.max(format, RUN_CAPABILITIES[id] ?? RUN_FORMAT);
  return format;
}

/** The capability ids a stored marker names (strings only, deduplicated). */
export function sanitizeCapabilityIds(ids) {
  if (!Array.isArray(ids)) return [];
  return sortCapabilities(ids.filter((id) => typeof id === 'string' && id.length > 0));
}

/**
 * What a run's marker says. A missing or malformed `requiresClient` reads as format 1 unless
 * ids are listed (an id implies format 2 at least).
 * @returns {{ format: number, capabilities: string[] }}
 */
export function storedRunFormat(saved) {
  if (!isRecord(saved)) return { format: LEGACY_RUN_FORMAT, capabilities: [] };
  const capabilities = sanitizeCapabilityIds(saved.requiresCapabilities);
  const raw = Number(saved.requiresClient);
  const stored = Number.isFinite(raw) && raw >= LEGACY_RUN_FORMAT ? Math.trunc(raw) : null;
  // A stored number this client has never heard of is kept as it is (it is above RUN_FORMAT).
  const format = Math.max(stored ?? LEGACY_RUN_FORMAT, formatOf(capabilities));
  return { format, capabilities };
}

/**
 * The format a serialized run needs: the larger of its marker's and what it holds. The cloud
 * hold-back reads this, so neither a missing marker nor a pruned config releases a run.
 * @returns {number}
 */
export function effectiveRunFormat(saved) {
  return Math.max(storedRunFormat(saved).format, requiredRunFormat(saved).format);
}

/**
 * Whether this client may load a serialized run. Null when it may; otherwise what it needs.
 * Blocks when the larger of the stored and derived formats exceeds `runFormat`, or when any
 * stored or derived id is not in `clientCapabilities`.
 * @param {object} saved
 * @param {{ runFormat?: number, clientCapabilities?: readonly string[] }} [client]
 * @returns {null | { format: number, capabilities: string[], missing: string[] }}
 */
export function runFormatBlock(
  saved,
  { runFormat = RUN_FORMAT, clientCapabilities = CLIENT_CAPABILITIES } = {},
) {
  if (!isRecord(saved)) return null;
  const stored = storedRunFormat(saved);
  const derived = requiredRunFormat(saved);
  const capabilities = sortCapabilities([...stored.capabilities, ...derived.capabilities]);
  const format = Math.max(stored.format, derived.format);
  const plays = new Set(clientCapabilities);
  const missing = capabilities.filter((id) => !plays.has(id));
  if (format <= runFormat && missing.length === 0) return null;
  return { format, capabilities, missing };
}

/**
 * The marker a serialized run carries: the floor (every id this run has ever written, so a
 * pruned config or a finished boss never lets it fall back to format 1) united with what it
 * holds now. Empty when the union is empty: such a run stays format 1, unmarked.
 * @param {object} saved - the serialized run, without a marker of its own
 * @param {string[]} [floor]
 * @returns {{ requiresClient?: number, requiresCapabilities?: string[] }}
 */
export function runFormatMarker(saved, floor = []) {
  const ids = sortCapabilities([
    ...sanitizeCapabilityIds(floor),
    ...requiredRunFormat(saved).capabilities,
  ]);
  if (ids.length === 0) return {};
  return { requiresClient: formatOf(ids), requiresCapabilities: ids };
}
