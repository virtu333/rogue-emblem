import { serializedBytes, validateBattleState } from './BattleStateSnapshot.js';

export const BATTLE_TIMELINE_VERSION = 1;
export const DEFAULT_TIMELINE_LIMITS = Object.freeze({
  previousTurns: 3,
  maxEntries: 500,
  maxBytes: 512 * 1024,
});
const POLICIES = ['fixed-v1', 'legacy-v1'];
const KINDS = ['turn_start', 'player_action', 'enemy_action', 'event', 'recovery', 'rewind'];
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
  };
}

function removeSnapshot(history, id) {
  delete history.snapshots[id];
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
  for (const key of Object.keys(history.snapshots))
    if (!refs.has(key)) delete history.snapshots[key];
}
function retain(history, protectedSnapshotId = null) {
  const { previousTurns, maxEntries, maxBytes } = history.limits;
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
  // Prefer turn-start anchors over action snapshots under byte pressure.
  const candidates = history.entries.filter(
    (e) => e.snapshotId && e.snapshotId !== protectedSnapshotId,
  );
  candidates.sort(
    (a, b) => Number(a.kind === 'turn_start') - Number(b.kind === 'turn_start') || a.id - b.id,
  );
  for (const entry of candidates) {
    if (serializedBytes(history) <= maxBytes) break;
    removeSnapshot(history, entry.snapshotId);
  }
  while (serializedBytes(history) > maxBytes && history.entries.length) {
    const index = history.entries.findIndex(
      (e) => !protectedSnapshotId || e.snapshotId !== protectedSnapshotId,
    );
    if (index === -1) throw new RangeError('Selected rewind destination exceeds history budget');
    history.entries.splice(index, 1);
    history.earlierHistoryUnavailable = true;
    pruneUnreferenced(history);
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
  if (destination && history.policy === 'legacy-v1' && kind !== 'turn_start')
    throw new TypeError('Legacy battles support only turn-start destinations');
  next.currentTurn = turnNumber;
  next.entries.push(entry);
  if (snapshot) next.snapshots[entry.snapshotId] = clone(snapshot);
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
  if (previous.snapshotId) delete base.snapshots[previous.snapshotId];
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
  const snapshot = entry && history.snapshots[entry.snapshotId];
  return snapshot ? clone(snapshot) : null;
}

/** Eligibility only: charges/current-state equality/input locks belong to commit. */
export function canRewindToEntry(
  history,
  entryId,
  { difficulty = 'normal', allowPlayerActions = false } = {},
) {
  const entry = history.entries.find((e) => e.id === entryId);
  if (!entry?.destination || !validDestination(entry, history.snapshots[entry.snapshotId]))
    return false;
  if (!['normal', 'hard', 'lunatic'].includes(String(difficulty).toLowerCase())) return false;
  return (
    entry.kind === 'turn_start' ||
    (history.policy === 'fixed-v1' &&
      allowPlayerActions &&
      String(difficulty).toLowerCase() !== 'lunatic')
  );
}

/** Detached candidate only. Publish after durable commit. IDs never rewind. */
export function branchBattleTimeline(history, targetId) {
  const target = history.entries.find((entry) => entry.id === targetId);
  if (!target?.destination || !validDestination(target, history.snapshots[target.snapshotId]))
    throw new TypeError('Unavailable rewind destination');
  const next = clone(history);
  next.entries = next.entries.filter((entry) => entry.id <= targetId);
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

/** Invalid optional history is discarded without touching recovery. Persisted
 * limits guarantee identical retention on reload; overrides may only tighten. */
export function hydrateBattleTimeline(payload, { limits } = {}) {
  try {
    if (
      !record(payload) ||
      payload.version !== BATTLE_TIMELINE_VERSION ||
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
    const storedLimits = limitsOf(payload.limits);
    if (serializedBytes(payload) > DEFAULT_TIMELINE_LIMITS.maxBytes) return null;
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
      if (entry.snapshotId !== null) {
        if (entry.snapshotId !== `s${entry.id}` || refs.has(entry.snapshotId)) return null;
        const snapshot = payload.snapshots[entry.snapshotId];
        if (
          !validateBattleState(snapshot) ||
          snapshot.turnNumber !== entry.turnNumber ||
          snapshot.phase !== entry.phase ||
          (snapshot.rewindPolicy !== undefined && snapshot.rewindPolicy !== payload.policy)
        )
          return null;
        refs.add(entry.snapshotId);
      }
      if (
        entry.destination &&
        (!validDestination(entry, payload.snapshots[entry.snapshotId]) ||
          (payload.policy === 'legacy-v1' && entry.kind !== 'turn_start'))
      )
        return null;
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
