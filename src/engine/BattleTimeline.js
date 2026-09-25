import {
  retainHistoryPresentation,
  hydrateHistoryPresentation,
  branchHistoryPresentation,
} from './BattleHistoryPresentation.js';
import { serializedBytes, validateBattleState } from './BattleStateSnapshot.js';
import {
  applyBattleStatePatch,
  peekBattleStatePatch,
  diffBattleState,
  jsonEqual,
  toJsonValue,
  validBattleStatePatch,
} from './BattleStateDelta.js';

// v3: destination snapshots after a turn's first full state may be stored as
// structural patches against it (see BattleStateDelta). v1/v2 payloads only
// hold full states and hydrate unchanged.
export const BATTLE_TIMELINE_VERSION = 3;
export const DEFAULT_TIMELINE_LIMITS = Object.freeze({
  previousTurns: 3,
  maxEntries: 500,
  maxBytes: 512 * 1024,
});
/** Rewind granularities a difficulty can grant (difficulty.json rewindGranularity). */
export const REWIND_GRANULARITIES = Object.freeze(['action', 'turn']);
const POLICIES = ['fixed-v1', 'legacy-v1'];
const KINDS = ['turn_start', 'player_action', 'enemy_action', 'event', 'recovery', 'rewind'];
// A patch is only worth keeping when it is clearly smaller than the state.
const MAX_PATCH_RATIO = 0.6;
const integer = (v, minimum = 0) => Number.isSafeInteger(v) && v >= minimum;
const record = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const clone = (v) => structuredClone(v);
const ENTRY_FIELDS = [
  'id',
  'revision',
  'kind',
  'turnNumber',
  'phase',
  'facts',
  'preview',
  'snapshotId',
  'destination',
];

function limitsOf(limits = {}) {
  if (!record(limits) || Object.keys(limits).some((key) => !(key in DEFAULT_TIMELINE_LIMITS)))
    throw new TypeError('Invalid timeline retention limits');
  const result = { ...DEFAULT_TIMELINE_LIMITS, ...limits };
  if (
    !integer(result.previousTurns) ||
    result.previousTurns > 100 ||
    !integer(result.maxEntries, 1) ||
    result.maxEntries > 500 ||
    !integer(result.maxBytes, 512) ||
    result.maxBytes > DEFAULT_TIMELINE_LIMITS.maxBytes
  )
    throw new TypeError('Invalid timeline retention limits');
  return result;
}

// Recorder supplies event-time visibility. This only verifies bounded plain JSON.
function plainData(value, budget = { nodes: 20000 }, depth = 0) {
  if (--budget.nodes < 0 || depth > 20) return false;
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string') return value.length <= 8192;
  if (Array.isArray(value))
    return value.length <= 1024 && value.every((v) => plainData(v, budget, depth + 1));
  if (!record(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
    return false;
  const keys = Object.keys(value);
  return (
    keys.length <= 256 &&
    keys.every(
      (key) =>
        key.length <= 128 &&
        !['__proto__', 'constructor', 'prototype'].includes(key) &&
        plainData(value[key], budget, depth + 1),
    )
  );
}

function validDestination(entry, snapshot) {
  return (
    snapshot &&
    snapshot.phase === 'player' &&
    !snapshot.pendingActionCompletion &&
    ['turn_start', 'player_action'].includes(entry.kind) &&
    entry.phase === 'player'
  );
}

// ── Snapshot storage (full keyframes + patches) ───────────────────────────

/** A stored patch record: { base: 'sN', patch }. Full states never carry `base`. */
function isPatchRecord(value) {
  return (
    record(value) &&
    Object.keys(value).length === 2 &&
    typeof value.base === 'string' &&
    Object.hasOwn(value, 'patch')
  );
}
const snapshotNumber = (id) => Number(String(id).slice(1));

/** Detached full state for a stored snapshot id, or null. Never mutates history. */
function materialize(history, snapshotId) {
  const stored = snapshotId ? history.snapshots[snapshotId] : null;
  if (!stored) return null;
  if (!isPatchRecord(stored)) return clone(stored);
  const base = history.snapshots[stored.base];
  if (!base || isPatchRecord(base)) return null;
  try {
    return applyBattleStatePatch(base, stored.patch);
  } catch {
    return null;
  }
}

// Destination checks only read phase/continuation, so avoid detached copies and
// remember the answer per stored record (records are replaced, never mutated).
const settledCache = new WeakMap();
function settledSnapshot(history, entry) {
  const stored = entry?.snapshotId ? history.snapshots[entry.snapshotId] : null;
  if (!stored) return null;
  if (!isPatchRecord(stored)) return stored;
  const base = history.snapshots[stored.base];
  if (!base || isPatchRecord(base)) return null;
  const cached = settledCache.get(stored);
  if (cached?.base === base) return cached.view;
  let view;
  try {
    const state = peekBattleStatePatch(base, stored.patch);
    view = { phase: state.phase, pendingActionCompletion: state.pendingActionCompletion || null };
  } catch {
    view = null;
  }
  settledCache.set(stored, { base, view });
  return view;
}

// Patches are taken against the most recent full state (a keyframe). A state
// that differs too much from it becomes the next keyframe, so a long battle
// holds a few full states and many small patches.
function keyframeFor(history, entry) {
  for (let i = history.entries.length - 1; i >= 0; i--) {
    const other = history.entries[i];
    if (other.id >= entry.id || !other.snapshotId) continue;
    const stored = history.snapshots[other.snapshotId];
    if (stored && !isPatchRecord(stored)) return other.snapshotId;
  }
  return null;
}

function encodeAgainst(base, state) {
  try {
    const patch = diffBattleState(base, state);
    if (serializedBytes(patch) > serializedBytes(state) * MAX_PATCH_RATIO) return null;
    // Keep a patch only when it reproduces the destination exactly.
    return jsonEqual(applyBattleStatePatch(base, patch), state) ? patch : null;
  } catch {
    return null;
  }
}

function storeSnapshot(history, entry, snapshot) {
  const state = toJsonValue(snapshot);
  const baseId = keyframeFor(history, entry);
  const patch = baseId ? encodeAgainst(history.snapshots[baseId], state) : null;
  history.snapshots[entry.snapshotId] = patch ? { base: baseId, patch } : state;
}

/** Remove one stored state, re-basing any patches that depended on it. */
function dropSnapshotData(history, snapshotId) {
  const stored = history.snapshots[snapshotId];
  if (!stored) return;
  if (!isPatchRecord(stored)) {
    const dependents = Object.keys(history.snapshots)
      .filter((id) => history.snapshots[id]?.base === snapshotId)
      .sort((a, b) => snapshotNumber(a) - snapshotNumber(b));
    if (dependents.length) {
      const states = new Map(dependents.map((id) => [id, materialize(history, id)]));
      const [first, ...rest] = dependents;
      history.snapshots[first] = states.get(first);
      for (const id of rest) {
        const patch = encodeAgainst(states.get(first), states.get(id));
        history.snapshots[id] = patch ? { base: first, patch } : states.get(id);
      }
    }
  }
  delete history.snapshots[snapshotId];
}

/** Optional history owns no latest recovery state or charge ledger. */
export function createBattleTimeline({ policy = 'fixed-v1', limits } = {}) {
  if (!POLICIES.includes(policy)) throw new TypeError('Unknown timeline policy');
  return {
    version: BATTLE_TIMELINE_VERSION,
    policy,
    revision: 0,
    nextEntryId: 1,
    currentTurn: 1,
    earlierHistoryUnavailable: false,
    limits: limitsOf(limits),
    entries: [],
    snapshots: {},
    presentation: null,
    presentationNextId: 1,
    presentationGeneration: 0,
  };
}

function removeSnapshot(history, id) {
  dropSnapshotData(history, id);
  for (const entry of history.entries) {
    if (entry.snapshotId === id) {
      entry.snapshotId = null;
      entry.destination = false;
    }
  }
  history.earlierHistoryUnavailable = true;
}
function pruneUnreferenced(history) {
  const refs = new Set(history.entries.map((entry) => entry.snapshotId).filter(Boolean));
  // Drop patches before keyframes so a keyframe only re-bases retained states.
  const unreferenced = Object.keys(history.snapshots)
    .filter((key) => !refs.has(key))
    .sort(
      (a, b) =>
        Number(isPatchRecord(history.snapshots[b])) - Number(isPatchRecord(history.snapshots[a])),
    );
  for (const key of unreferenced) dropSnapshotData(history, key);
}

// Least valuable first: earlier turns' action points (oldest turn first), then
// earlier turns' starts, then this turn's action points, then its start.
function evictionOrder(history, protectedSnapshotId) {
  const current = history.currentTurn;
  const rank = (entry) =>
    entry.turnNumber < current
      ? entry.kind === 'turn_start'
        ? 1
        : 0
      : entry.kind === 'turn_start'
        ? 3
        : 2;
  return history.entries
    .filter((entry) => entry.snapshotId && entry.snapshotId !== protectedSnapshotId)
    .sort(
      (a, b) => rank(a) - rank(b) || (rank(a) < 2 ? a.turnNumber - b.turnNumber : 0) || a.id - b.id,
    );
}

const PRESENTATION_RESERVE = 64 * 1024;
// Drop board previews of review-only rows (never destinations or the latest
// row, which the recorder compares against) until `bytes` fits `target`.
function slimPreviews(history, bytes, target) {
  if (bytes <= target) return bytes;
  const last = history.entries.at(-1);
  const current = history.currentTurn;
  const candidates = history.entries
    .filter((entry) => entry.preview !== null && !entry.destination && entry !== last)
    .sort(
      (a, b) => Number(a.turnNumber >= current) - Number(b.turnNumber >= current) || a.id - b.id,
    );
  for (const entry of candidates) {
    if (bytes <= target) break;
    bytes -= serializedBytes(entry.preview) - serializedBytes(null);
    entry.preview = null;
  }
  return bytes;
}

function retain(history, protectedSnapshotId = null) {
  const { previousTurns, maxEntries, maxBytes } = history.limits;
  history.presentationNextId = Math.max(
    history.presentationNextId || 1,
    history.presentation?.nextId || 1,
  );
  const before = history.entries.length;
  history.entries = history.entries.filter(
    (entry) => entry.turnNumber >= history.currentTurn - previousTurns,
  );
  while (history.entries.length > maxEntries) {
    const index = history.entries.findIndex(
      (entry) => !protectedSnapshotId || entry.snapshotId !== protectedSnapshotId,
    );
    if (index === -1) break;
    history.entries.splice(index, 1);
  }
  if (history.entries.length !== before) history.earlierHistoryUnavailable = true;
  pruneUnreferenced(history);
  // Review-only board previews go first: the visual archive keeps those frames
  // and the rewind picker restores from snapshots. Leave room for the archive.
  const core = slimPreviews(
    history,
    serializedBytes({ ...history, presentation: null }),
    maxBytes - PRESENTATION_RESERVE,
  );
  // Optional artwork/animation can never evict an otherwise retained target.
  const hadPresentation = Boolean(history.presentation);
  history.presentation = retainHistoryPresentation(
    history.presentation,
    Math.max(0, Math.min(128 * 1024, maxBytes - core)),
  );
  if (hadPresentation && !history.presentation)
    history.presentationGeneration = (history.presentationGeneration || 0) + 1;
  // Byte pressure sheds rewind points by value (see evictionOrder). Sizes are
  // tracked per stored state so this stays linear in the number of states.
  let bytes = slimPreviews(history, serializedBytes(history), maxBytes);
  if (bytes > maxBytes) {
    for (const entry of evictionOrder(history, protectedSnapshotId)) {
      if (bytes <= maxBytes) break;
      if (!entry.snapshotId || !history.snapshots[entry.snapshotId]) continue;
      const rebases = !isPatchRecord(history.snapshots[entry.snapshotId]);
      const size = serializedBytes(history.snapshots[entry.snapshotId]) + entry.snapshotId.length;
      removeSnapshot(history, entry.snapshotId);
      bytes = rebases ? serializedBytes(history) : bytes - size;
    }
    bytes = serializedBytes(history);
  }
  while (bytes > maxBytes && history.entries.length) {
    const index = history.entries.findIndex(
      (e) => !protectedSnapshotId || e.snapshotId !== protectedSnapshotId,
    );
    if (index === -1) throw new RangeError('Selected rewind destination exceeds history budget');
    history.entries.splice(index, 1);
    history.earlierHistoryUnavailable = true;
    pruneUnreferenced(history);
    bytes = serializedBytes(history);
  }
  return history;
}

/** destination asserts that Canto/Gambit/modal/automatic effects have settled.
 * Recovery continuations and enemy states can never qualify. Preview is a
 * separately filtered projection; never expose the restore snapshot to UI. */
export function appendBattleTimeline(
  history,
  {
    kind = 'event',
    turnNumber,
    phase,
    facts = [],
    preview = null,
    snapshot = null,
    destination = false,
  },
) {
  if (
    !KINDS.includes(kind) ||
    !integer(turnNumber, 1) ||
    turnNumber < history.currentTurn ||
    !['player', 'enemy'].includes(phase) ||
    !Array.isArray(facts) ||
    facts.length > 256 ||
    !plainData(facts) ||
    !plainData(preview) ||
    typeof destination !== 'boolean'
  )
    throw new TypeError('Invalid timeline entry');
  if (
    snapshot &&
    (!validateBattleState(snapshot) ||
      snapshot.turnNumber !== turnNumber ||
      snapshot.phase !== phase ||
      (snapshot.rewindPolicy !== undefined && snapshot.rewindPolicy !== history.policy))
  )
    throw new TypeError('Invalid timeline snapshot');
  const next = clone(history);
  const id = next.nextEntryId++;
  if (!integer(next.nextEntryId, 1)) throw new RangeError('Timeline ID exhausted');
  const entry = {
    id,
    revision: next.revision,
    kind,
    turnNumber,
    phase,
    facts: clone(facts),
    preview: clone(preview),
    snapshotId: snapshot ? `s${id}` : null,
    destination,
  };
  if (destination && !validDestination(entry, snapshot))
    throw new TypeError('Unsettled rewind destination');
  next.currentTurn = turnNumber;
  next.entries.push(entry);
  if (snapshot) storeSnapshot(next, entry, snapshot);
  return retain(next);
}

/** Finish the latest durable action fragment in place. Its stable row ID is
 * the merge key across reload; no second damage/XP row is invented on resume. */
export function finishBattleTimelineAction(history, entry) {
  const previous = history.entries.at(-1);
  if (
    !previous ||
    previous.kind !== 'recovery' ||
    previous.phase !== entry.phase ||
    previous.turnNumber !== entry.turnNumber
  )
    return appendBattleTimeline(history, entry);
  const base = clone(history);
  base.entries.pop();
  if (previous.snapshotId) dropSnapshotData(base, previous.snapshotId);
  base.nextEntryId = previous.id;
  const next = appendBattleTimeline(base, {
    ...entry,
    facts: [
      ...new Set([...previous.facts.filter((fact) => fact !== 'Action resolved.'), ...entry.facts]),
    ].slice(0, 256),
  });
  next.nextEntryId = Math.max(next.nextEntryId, history.nextEntryId);
  return next;
}

/** Detached return value protects historical state from callers. */
export function getEntryState(history, entryId) {
  const entry = history.entries.find((e) => e.id === entryId);
  return entry ? materialize(history, entry.snapshotId) : null;
}

/** Stored representation of one destination ('full' | 'patch' | null) and its bytes. */
export function describeEntrySnapshot(history, entryId) {
  const entry = history.entries.find((e) => e.id === entryId);
  const stored = entry?.snapshotId ? history.snapshots[entry.snapshotId] : null;
  if (!stored) return null;
  return { form: isPatchRecord(stored) ? 'patch' : 'full', bytes: serializedBytes(stored) };
}

/** 'action' unless the difficulty (or an explicit rule) limits rewinds to turn starts. */
export function resolveRewindGranularity(difficulty = 'normal', granularity = undefined) {
  if (REWIND_GRANULARITIES.includes(granularity)) return granularity;
  return String(difficulty).toLowerCase() === 'lunatic' ? 'turn' : 'action';
}

/** Eligibility only: charges/current-state equality/input locks belong to commit. */
export function canRewindToEntry(
  history,
  entryId,
  { difficulty = 'normal', allowPlayerActions = false, granularity = undefined } = {},
) {
  const entry = history.entries.find((e) => e.id === entryId);
  if (!entry?.destination || !validDestination(entry, settledSnapshot(history, entry)))
    return false;
  if (!['normal', 'hard', 'lunatic'].includes(String(difficulty).toLowerCase())) return false;
  return (
    entry.kind === 'turn_start' ||
    (allowPlayerActions && resolveRewindGranularity(difficulty, granularity) === 'action')
  );
}

/** Detached candidate only. Publish after durable commit. IDs never rewind. */
export function branchBattleTimeline(history, targetId) {
  const target = history.entries.find((entry) => entry.id === targetId);
  if (!target?.destination || !validDestination(target, settledSnapshot(history, target)))
    throw new TypeError('Unavailable rewind destination');
  const next = clone(history);
  next.entries = next.entries.filter((entry) => entry.id <= targetId);
  next.presentation = branchHistoryPresentation(next.presentation, targetId);
  next.currentTurn = target.turnNumber;
  next.revision++;
  const markerId = next.nextEntryId++;
  if (!integer(next.revision) || !integer(next.nextEntryId, 1))
    throw new RangeError('Timeline ID exhausted');
  next.entries.push({
    id: markerId,
    revision: next.revision,
    kind: 'rewind',
    turnNumber: target.turnNumber,
    phase: target.phase,
    facts: [{ type: 'rewind', targetId }],
    preview: clone(target.preview),
    snapshotId: null,
    destination: false,
  });
  pruneUnreferenced(next);
  return retain(next, target.snapshotId);
}

/** Under storage pressure keep only the current turn's points (limits unchanged). */
export function trimBattleTimelineToCurrentTurn(history) {
  const next = clone(history);
  const before = next.entries.length;
  next.entries = next.entries.filter((entry) => entry.turnNumber >= next.currentTurn);
  if (next.entries.length !== before) next.earlierHistoryUnavailable = true;
  pruneUnreferenced(next);
  if (next.presentation) {
    next.presentationNextId = Math.max(next.presentationNextId || 1, next.presentation.nextId);
    next.presentation = null;
    next.presentationGeneration = (next.presentationGeneration || 0) + 1;
  }
  return next;
}

/** Invalid optional history is discarded without touching recovery. Persisted
 * limits guarantee identical retention on reload; overrides may only tighten. */
export function hydrateBattleTimeline(payload, { limits } = {}) {
  try {
    if (
      !record(payload) ||
      ![1, 2, BATTLE_TIMELINE_VERSION].includes(payload.version) ||
      !POLICIES.includes(payload.policy) ||
      !integer(payload.revision) ||
      !integer(payload.nextEntryId, 1) ||
      !integer(payload.currentTurn, 1) ||
      typeof payload.earlierHistoryUnavailable !== 'boolean' ||
      !Array.isArray(payload.entries) ||
      payload.entries.length > 500 ||
      !record(payload.snapshots) ||
      Object.keys(payload.snapshots).length > 500
    )
      return null;
    const patched = payload.version === BATTLE_TIMELINE_VERSION;
    // Invalid optional animation must not discard valid authoritative history.
    payload = {
      ...payload,
      version: BATTLE_TIMELINE_VERSION,
      presentation: hydrateHistoryPresentation(payload.presentation, payload.entries),
      presentationNextId: integer(payload.presentationNextId, 1) ? payload.presentationNextId : 1,
      presentationGeneration: integer(payload.presentationGeneration)
        ? payload.presentationGeneration
        : 0,
    };
    if (
      payload.presentation?.records.some(
        (r) =>
          r.revision > payload.revision ||
          r.anchorId >= payload.nextEntryId ||
          (r.entryId !== null && r.entryId >= payload.nextEntryId),
      )
    )
      payload.presentation = null;
    const storedLimits = limitsOf(payload.limits);
    if (serializedBytes({ ...payload, presentation: null }) > DEFAULT_TIMELINE_LIMITS.maxBytes)
      return null;
    // Patches may only reference an earlier, retained full state.
    for (const [id, stored] of Object.entries(payload.snapshots)) {
      if (!/^s[1-9]\d*$/.test(id)) return null;
      if (!isPatchRecord(stored)) continue;
      const base = payload.snapshots[stored.base];
      if (
        !patched ||
        !base ||
        isPatchRecord(base) ||
        snapshotNumber(stored.base) >= snapshotNumber(id) ||
        (stored.patch !== null && !validBattleStatePatch(stored.patch))
      )
        return null;
    }
    let previousId = 0;
    let previousRevision = 0;
    let previousTurn = 1;
    const refs = new Set();
    for (const entry of payload.entries) {
      if (
        !record(entry) ||
        Object.keys(entry).some((key) => !ENTRY_FIELDS.includes(key)) ||
        !integer(entry.id, 1) ||
        entry.id <= previousId ||
        entry.id >= payload.nextEntryId ||
        !integer(entry.revision) ||
        entry.revision < previousRevision ||
        entry.revision > payload.revision ||
        !KINDS.includes(entry.kind) ||
        !integer(entry.turnNumber, 1) ||
        entry.turnNumber < previousTurn ||
        entry.turnNumber > payload.currentTurn ||
        !['player', 'enemy'].includes(entry.phase) ||
        !Array.isArray(entry.facts) ||
        entry.facts.length > 256 ||
        !plainData(entry.facts) ||
        !plainData(entry.preview) ||
        typeof entry.destination !== 'boolean'
      )
        return null;
      previousId = entry.id;
      previousRevision = entry.revision;
      previousTurn = entry.turnNumber;
      let snapshot = null;
      if (entry.snapshotId !== null) {
        if (entry.snapshotId !== `s${entry.id}` || refs.has(entry.snapshotId)) return null;
        snapshot = materialize(payload, entry.snapshotId);
        if (
          !validateBattleState(snapshot) ||
          snapshot.turnNumber !== entry.turnNumber ||
          snapshot.phase !== entry.phase ||
          (snapshot.rewindPolicy !== undefined && snapshot.rewindPolicy !== payload.policy)
        )
          return null;
        refs.add(entry.snapshotId);
      }
      if (entry.destination && !validDestination(entry, snapshot)) return null;
    }
    if (Object.keys(payload.snapshots).some((id) => !refs.has(id))) return null;
    if (Object.keys(payload).some((key) => !Object.keys(createBattleTimeline()).includes(key)))
      return null;
    const result = clone(payload);
    result.limits = limits
      ? Object.fromEntries(
          Object.entries(limitsOf(limits)).map(([key, value]) => [
            key,
            Math.min(value, storedLimits[key]),
          ]),
        )
      : storedLimits;
    return retain(result);
  } catch {
    return null;
  }
}
