// The canonical state of a headless play session (tools/play), for its replay digests.
//
// A digest must change whenever anything that can shape a later command changes: a
// unit's stats or kit, a condition, a temporary wall, the fog, an unclaimed reward's
// contents, a pooled scroll, a shop's stock, the tactician's memory. A hand-picked
// summary misses whatever its author did not think of, so this walks the whole game
// object graph instead and leaves out only what is listed below, each with its reason:
//
//   - functions (behaviour, not state; the random streams' draw counts are added
//     explicitly, since a stream's position lives in its closure);
//   - the game data (static: an object reachable from it is written as its path in
//     the data, so a unit holding a catalog object still names which one);
//   - SKIPPED_KEYS: the adapter's per-command output buffers (event lists and the
//     lines rendered from them).
//
// Shared references are part of the state (an equipped weapon is one of the bag's
// items, not a copy), so an object met a second time is written as a reference to
// its first visit. Map and Set keep their insertion order; object keys are sorted.
// Wall-clock time and UUIDs never reach the state: Game.run gives the engine a fixed
// clock and seeded UUIDs (game.js).

import { createHash } from 'node:crypto';

/** Bump when the snapshot's encoding changes (a session records the version it used). */
export const SNAPSHOT_VERSION = 2;

/** Output buffers, rebuilt by every command (Game, PlayBattle): never input to a later one. */
const SKIPPED_KEYS = new Set(['events', '_hpBefore', 'diagnostics']);

const staticIndexes = new WeakMap();

/** Every object reachable from the game data, by its path (built once per data object). */
function staticIndexOf(gameData) {
  let index = staticIndexes.get(gameData);
  if (index) return index;
  index = new Map();
  const stack = [[gameData, '']];
  while (stack.length) {
    const [value, path] = stack.pop();
    if (!value || typeof value !== 'object' || index.has(value)) continue;
    index.set(value, path);
    for (const key of Object.keys(value)) stack.push([value[key], `${path}/${key}`]);
  }
  staticIndexes.set(gameData, index);
  return index;
}

/**
 * The canonical form of `root`: plain JSON values, deterministic for a given state.
 * Object identity is kept as { $ref: n } (n = order of first visit), catalog objects
 * as { $data: path }, Maps as { $map: [[k, v], ...] }, Sets as { $set: [...] }.
 */
export function canonicalForm(root, { gameData = null } = {}) {
  const statics = gameData ? staticIndexOf(gameData) : new Map();
  const visited = new Map();
  const walk = (value) => {
    switch (typeof value) {
      case 'number':
        return Number.isFinite(value) ? value : { $num: String(value) };
      case 'string':
      case 'boolean':
        return value;
      case 'bigint':
        return { $big: String(value) };
      case 'undefined':
        // A property holding undefined reads as one never set (as JSON has it); in
        // an array it holds a place, so it is kept there.
        return undefined;
      case 'function':
      case 'symbol':
        return undefined;
      default:
        break;
    }
    if (value === null) return null;
    const known = statics.get(value);
    if (known !== undefined) return { $data: known };
    if (visited.has(value)) return { $ref: visited.get(value) };
    visited.set(value, visited.size);
    if (Array.isArray(value))
      return value.map((v) => (v === undefined ? { $undef: 1 } : (walk(v) ?? null)));
    if (value instanceof Map) return { $map: [...value].map(([k, v]) => [walk(k), walk(v)]) };
    if (value instanceof Set) return { $set: [...value].map((v) => walk(v)) };
    if (value instanceof Date) return { $date: value.getTime() };
    if (ArrayBuffer.isView(value)) return { $bytes: Array.from(value) };
    if (value instanceof WeakMap || value instanceof WeakSet || value instanceof Promise)
      return undefined;
    const out = {};
    const name = value.constructor?.name;
    if (name && name !== 'Object') out.$class = name;
    for (const key of Object.keys(value).sort()) {
      if (SKIPPED_KEYS.has(key)) continue;
      const v = walk(value[key]);
      if (v !== undefined) out[key] = v;
    }
    return out;
  };
  return walk(root);
}

/** The session state a digest covers: the whole game, and where its random streams stand. */
export function snapshotOf(game) {
  return {
    version: SNAPSHOT_VERSION,
    rng: game.rngState(),
    game: canonicalForm(game, { gameData: game.gameData }),
  };
}

/** SHA-256 of the canonical snapshot, first 16 hex digits. */
export function snapshotDigest(game) {
  return createHash('sha256')
    .update(JSON.stringify(snapshotOf(game)))
    .digest('hex')
    .slice(0, 16);
}

/**
 * Where two snapshots differ, as paths (for a divergence report): at most `limit`.
 * Paths are keys from the root, e.g. game.rm.roster.0.stats.DEF.
 */
export function snapshotDiff(a, b, limit = 12) {
  const out = [];
  const rec = (x, y, path) => {
    if (out.length >= limit) return;
    if (x === y) return;
    if (typeof x !== 'object' || typeof y !== 'object' || x === null || y === null) {
      out.push(`${path}: ${short(x)} -> ${short(y)}`);
      return;
    }
    if (Array.isArray(x) !== Array.isArray(y)) {
      out.push(`${path}: ${short(x)} -> ${short(y)}`);
      return;
    }
    const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
    for (const k of keys) rec(x[k], y[k], path ? `${path}.${k}` : k);
  };
  rec(a, b, '');
  return out;
}

function short(v) {
  const s = JSON.stringify(v);
  return s === undefined ? 'undefined' : s.length > 60 ? `${s.slice(0, 57)}...` : s;
}
