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
// format number. This build writes none of them: CLIENT_CAPABILITIES is empty, and the PR that
// adds a writer adds its id there in the same change (a client never writes what it cannot
// read; tests/RunFormatRegistry.test.js holds it).
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
});

export const CAPABILITY_IDS = Object.freeze(Object.keys(RUN_CAPABILITIES));

/**
 * The capabilities this build plays. Empty: the guard ships before any writer, and each
 * writer's PR adds its id here.
 */
export const CLIENT_CAPABILITIES = Object.freeze([]);

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
 * Every key the large-maps specs add to a saved run, by where it lives, and what it is (§12.1
 * step 8): `inert` (data no old reader looks at), `legacy` (an older client already plays it
 * right: the shipped event set pieces, §16.5), `marker` (the guard's own fields), or the
 * capability id(s) that hold a run carrying it. Detection above decides when a value really
 * holds one (a `hold:` group is legacy whatever its key). A PR that writes a new key into one of
 * these places lists it here; tests/harness/RunFormatRegistry.test.js takes a key census over
 * generated runs, maps and checkpoints and fails on a key that is neither here nor in the
 * frozen baseline of keys that existed before the guard.
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
  }),
  // A locked battle config.
  battleConfig: Object.freeze({
    setPieceId: 'legacy',
    setPieceVariant: 'legacy',
    mirrored: 'legacy',
    formationSpares: 'legacy',
    encounterGroups: 'encounters',
    triggeredWaves: 'encounters',
    parModel: 'parModel',
    objectives: 'objectives',
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
  }),
  // A locked config's enemy spawn.
  enemySpawn: Object.freeze({
    holdWakeTurn: 'legacy',
    patrolIndex: 'encounters',
    encounterGroupId: 'encounters',
    clampTile: 'objectives',
    objectiveRef: 'objectives',
    bossKit: 'bossKit',
  }),
  // A battle checkpoint's top level (and a Vision snapshot's, a timeline destination's).
  checkpoint: Object.freeze({
    encounterState: 'encounters',
    objectiveState: 'objectives',
    bossState: 'bossKit',
  }),
  // The serialized run's top level.
  run: Object.freeze({
    requiresClient: 'marker',
    requiresCapabilities: 'marker',
    bonusVisionActs: 'objectives',
    setPiecesOffered: 'setPiece',
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
// The four places a run holds mechanics.

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
  if (objectivesBeyondLegacy(config.objectives) || present(config, 'npcAllies'))
    found.add('objectives');
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
 * marker). Reads the node map's not-yet-complete nodes, the locked configs, the battle in
 * progress (its params, checkpoint, Vision snapshots and rewind timeline) and the run fields.
 * @param {object} saved - a serialized run (RunManager.toJSON's shape)
 * @returns {{ format: number, capabilities: string[] }}
 */
export function requiredRunFormat(saved) {
  const found = new Set();
  if (!isRecord(saved)) return { format: LEGACY_RUN_FORMAT, capabilities: [] };
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
