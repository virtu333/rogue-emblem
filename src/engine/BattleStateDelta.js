// Structural JSON patches between two canonical battle states.
//
// The rewind timeline keeps one full state per player turn (a keyframe) and
// stores every later destination in that turn as a patch against it. A patch
// is only ever kept when applying it reproduces the target exactly, so a
// patched destination restores the same battle as a full copy would.
//
// Node shapes (all plain JSON):
//   { $: value }                    replace with value
//   { o: { key: node }, x: [keys] }  patch object members, delete keys in x
//   { n: length, i: { index: node } } resize an array, patch/append indices
//   { k: [ids], m: { id: node } }    entity array keyed by battleEntityId: the
//                                    result is ids in order; each element is
//                                    the base element with that id (patched
//                                    by m[id]) or m[id].$ for a new element
// Pure: no RNG, no clocks, no scene access.

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_DEPTH = 32;

const isRecord = (value) =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));

/** Deep equality over JSON values (key order ignored). */
export function jsonEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!jsonEqual(a[i], b[i])) return false;
    return true;
  }
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  for (const key of keys) if (!Object.hasOwn(b, key) || !jsonEqual(a[key], b[key])) return false;
  return true;
}

/** JSON-normalized detached copy (drops undefined, maps non-finite numbers to null). */
export function toJsonValue(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function entityKeyed(list) {
  if (!Array.isArray(list)) return null;
  const ids = new Set();
  for (const item of list) {
    const id = item?.battleEntityId;
    if (!isRecord(item) || typeof id !== 'string' || !id || ids.has(id)) return null;
    ids.add(id);
  }
  return ids;
}

function diffNode(a, b, depth) {
  if (jsonEqual(a, b)) return undefined;
  if (depth >= MAX_DEPTH) return { $: b };
  if (isRecord(a) && isRecord(b)) {
    const o = {};
    const x = [];
    for (const key of Object.keys(b)) {
      if (FORBIDDEN_KEYS.has(key)) return { $: b };
      const node = Object.hasOwn(a, key) ? diffNode(a[key], b[key], depth + 1) : { $: b[key] };
      if (node !== undefined) o[key] = node;
    }
    for (const key of Object.keys(a)) if (!Object.hasOwn(b, key)) x.push(key);
    return x.length ? { o, x } : { o };
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    // Entity lists are keyed so a death does not shift every later unit.
    if (a.length && b.length && entityKeyed(a) && entityKeyed(b)) {
      const byId = new Map(a.map((item) => [item.battleEntityId, item]));
      const m = {};
      for (const item of b) {
        const id = item.battleEntityId;
        if (FORBIDDEN_KEYS.has(id)) return { $: b };
        const node = byId.has(id) ? diffNode(byId.get(id), item, depth + 1) : { $: item };
        if (node !== undefined) m[id] = node;
      }
      return { k: b.map((item) => item.battleEntityId), m };
    }
    const i = {};
    for (let index = 0; index < b.length; index++) {
      const node = index < a.length ? diffNode(a[index], b[index], depth + 1) : { $: b[index] };
      if (node !== undefined) i[index] = node;
    }
    return { n: b.length, i };
  }
  return { $: b };
}

/**
 * Patch that turns `base` into `target`, or null when the two are equal.
 * Both are treated as JSON values; callers normalize with toJsonValue first.
 */
export function diffBattleState(base, target) {
  const node = diffNode(base, target, 0);
  return node === undefined ? null : node;
}

const onlyKeys = (value, allowed) =>
  isRecord(value) && Object.keys(value).every((key) => allowed.includes(key));

/** Bounded structural check of a patch node; never trusts saved data. */
export function validBattleStatePatch(node, budget = { nodes: 200000 }, depth = 0) {
  if (--budget.nodes < 0 || depth > MAX_DEPTH + 1 || !isRecord(node)) return false;
  if (Object.hasOwn(node, '$')) return onlyKeys(node, ['$']);
  if (Object.hasOwn(node, 'o')) {
    if (!onlyKeys(node, ['o', 'x']) || !isRecord(node.o)) return false;
    if (
      node.x !== undefined &&
      (!Array.isArray(node.x) ||
        node.x.some((key) => typeof key !== 'string' || FORBIDDEN_KEYS.has(key)))
    )
      return false;
    return Object.entries(node.o).every(
      ([key, child]) =>
        !FORBIDDEN_KEYS.has(key) &&
        !node.x?.includes(key) &&
        validBattleStatePatch(child, budget, depth + 1),
    );
  }
  if (Object.hasOwn(node, 'n')) {
    if (
      !onlyKeys(node, ['n', 'i']) ||
      !Number.isSafeInteger(node.n) ||
      node.n < 0 ||
      node.n > 65536 ||
      !isRecord(node.i)
    )
      return false;
    return Object.entries(node.i).every(
      ([key, child]) =>
        /^(0|[1-9]\d*)$/.test(key) &&
        Number(key) < node.n &&
        validBattleStatePatch(child, budget, depth + 1),
    );
  }
  if (Object.hasOwn(node, 'k')) {
    if (
      !onlyKeys(node, ['k', 'm']) ||
      !Array.isArray(node.k) ||
      node.k.length > 65536 ||
      !isRecord(node.m)
    )
      return false;
    const ids = new Set(node.k);
    if (
      ids.size !== node.k.length ||
      node.k.some((id) => typeof id !== 'string' || !id || FORBIDDEN_KEYS.has(id))
    )
      return false;
    return Object.entries(node.m).every(
      ([id, child]) => ids.has(id) && validBattleStatePatch(child, budget, depth + 1),
    );
  }
  return false;
}

function applyNode(base, node) {
  if (Object.hasOwn(node, '$')) return structuredClone(node.$);
  if (Object.hasOwn(node, 'o')) {
    if (!isRecord(base)) throw new TypeError('Patch expects an object');
    const next = { ...base };
    for (const key of node.x || []) delete next[key];
    for (const [key, child] of Object.entries(node.o))
      next[key] = applyNode(Object.hasOwn(base, key) ? base[key] : undefined, child);
    return next;
  }
  if (Object.hasOwn(node, 'n')) {
    if (!Array.isArray(base)) throw new TypeError('Patch expects an array');
    const next = base.slice(0, node.n);
    for (let index = 0; index < node.n; index++) {
      const child = node.i[index];
      if (child) next[index] = applyNode(index < base.length ? base[index] : undefined, child);
      else if (index >= base.length) throw new TypeError('Patch leaves an array hole');
    }
    return next;
  }
  if (Object.hasOwn(node, 'k')) {
    const ids = entityKeyed(base);
    if (!ids) throw new TypeError('Patch expects an entity list');
    const byId = new Map(base.map((item) => [item.battleEntityId, item]));
    return node.k.map((id) => {
      const child = node.m[id];
      if (byId.has(id)) return child ? applyNode(byId.get(id), child) : byId.get(id);
      if (!child || !Object.hasOwn(child, '$')) throw new TypeError('Patch adds an unknown entity');
      return structuredClone(child.$);
    });
  }
  throw new TypeError('Unknown patch node');
}

/**
 * Detached state = base with patch applied. Shares no structure with either
 * argument. Throws on a malformed patch.
 */
export function applyBattleStatePatch(base, patch) {
  return structuredClone(peekBattleStatePatch(base, patch));
}

/**
 * Read-only view of base + patch that may share structure with `base`.
 * Callers must not mutate the result (use applyBattleStatePatch for that).
 */
export function peekBattleStatePatch(base, patch) {
  if (patch === null) return base;
  if (!validBattleStatePatch(patch)) throw new TypeError('Invalid battle state patch');
  return applyNode(base, patch);
}
