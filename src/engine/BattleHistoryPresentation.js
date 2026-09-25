// Plain, visibility-filtered display data. This module never restores gameplay.
import { serializedBytes } from './BattleStateSnapshot.js';
import { previewTiles } from './BattleTimelineFacts.js';

export const HISTORY_BYTES = 128 * 1024;
export const HISTORY_RECORDS = 4096;
const clone = (value) => structuredClone(value);
const equal = (a, b) => {
  if (a === b) return true;
  if (
    !a ||
    !b ||
    typeof a !== 'object' ||
    typeof b !== 'object' ||
    Array.isArray(a) !== Array.isArray(b)
  )
    return false;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((k) => Object.hasOwn(b, k) && equal(a[k], b[k]))
  );
};
const integer = (n, min = 0) => Number.isSafeInteger(n) && n >= min;
const object = (v) => v && typeof v === 'object' && !Array.isArray(v);
const safeText = (s, max = 256) => typeof s === 'string' && s.length <= max;
const coord = (p, frame) =>
  integer(p?.col) && integer(p?.row) && p.col < frame.cols && p.row < frame.rows;

const only = (v, fields) => object(v) && Object.keys(v).every((k) => fields.includes(k));
const textList = (v, max = 64, length = 256) =>
  Array.isArray(v) && v.length <= max && v.every((x) => safeText(x, length));
const unitId = (id) => typeof id === 'string' && /^u[1-9]\d*$/.test(id);
// Texture keys are only looked up (never parsed); traced variants use `~`
// (`traced-enemy_fighter~corrupt`), which used to invalidate the whole frame.
export const SPRITE_KEY = /^[a-zA-Z0-9_~.-]*$/;
// hydrateHistoryPresentation rejects a record more than this many deltas away
// from its keyframe; historyFrameAt cannot reach further back either.
export const MAX_DELTA_CHAIN = 31;

/** Deltas since the archive's last keyframe (0 when the last record is one). */
function trailingDeltas(records) {
  let chain = 0;
  for (let i = records.length - 1; i >= 0 && !records[i].frame; i--) chain++;
  return chain;
}

export function validHistoryFrame(frame) {
  return Boolean(
    only(frame, [
      'version',
      'cols',
      'rows',
      'biome',
      'tiles',
      'units',
      'summary',
      'enemiesActNext',
    ]) &&
    frame.version === 2 &&
    integer(frame.cols, 1) &&
    frame.cols <= 128 &&
    integer(frame.rows, 1) &&
    frame.rows <= 128 &&
    safeText(frame.biome, 64) &&
    Array.isArray(frame.tiles) &&
    frame.tiles.length === frame.cols * frame.rows &&
    frame.tiles.every(
      (t, i) =>
        only(t, ['col', 'row', 'label', 'known', 'fog', 'details']) &&
        (t.details === undefined || textList(t.details, 16)) &&
        coord(t, frame) &&
        t.row * frame.cols + t.col === i &&
        safeText(t.label) &&
        ['unseen', 'explored', 'visible'].includes(t.fog) &&
        typeof t.known === 'boolean' &&
        (!t.known ? t.label === 'Unknown' : t.fog !== 'unseen'),
    ) &&
    Array.isArray(frame.units) &&
    frame.units.length <= 512 &&
    new Set(frame.units.map((u) => u.id)).size === frame.units.length &&
    frame.units.every(
      (u) =>
        only(u, [
          'id',
          'name',
          'className',
          'spriteKey',
          'faction',
          'col',
          'row',
          'hp',
          'maxHP',
          'level',
          'acted',
          'weapon',
          'items',
          'conditions',
          'affixes',
          'buffs',
          'size',
          'width',
          'height',
        ]) &&
        coord(u, frame) &&
        /^u[1-9]\d*$/.test(u.id) &&
        safeText(u.name) &&
        safeText(u.className) &&
        safeText(u.spriteKey, 128) &&
        SPRITE_KEY.test(u.spriteKey) &&
        ['player', 'enemy', 'npc'].includes(u.faction) &&
        Number.isFinite(u.hp) &&
        u.hp >= 0 &&
        Number.isFinite(u.maxHP) &&
        u.maxHP > 0 &&
        integer(u.size, 1) &&
        u.size <= 3 &&
        Array.isArray(u.conditions) &&
        u.conditions.length <= 64 &&
        u.conditions.every((c) => safeText(c, 64)) &&
        (u.width === undefined || (Number.isFinite(u.width) && u.width > 0 && u.width <= 256)) &&
        (u.height === undefined ||
          (Number.isFinite(u.height) && u.height > 0 && u.height <= 256)) &&
        (u.weapon === undefined || safeText(u.weapon)) &&
        (u.items === undefined || textList(u.items, 128)) &&
        (u.affixes === undefined || textList(u.affixes, 16, 64)) &&
        (u.buffs === undefined || textList(u.buffs, 32, 64)) &&
        (u.acted === undefined || typeof u.acted === 'boolean') &&
        (u.level === undefined || integer(u.level)),
    ) &&
    Array.isArray(frame.summary) &&
    frame.summary.length <= 64 &&
    frame.summary.every((s) => safeText(s, 1024)),
  );
}

// Compact repeated terrain descriptors; no screenshots or hidden map dictionary.
function packFrame(frame) {
  const { tiles, ...rest } = clone(frame),
    palette = [],
    runs = [],
    lookup = new Map();
  for (const tile of tiles) {
    const descriptor = [tile.label, tile.known, tile.fog, tile.details ?? null];
    const key = JSON.stringify(descriptor);
    if (!lookup.has(key)) {
      lookup.set(key, palette.length);
      palette.push(descriptor);
    }
    const id = lookup.get(key),
      last = runs.at(-1);
    if (last?.[1] === id) last[0]++;
    else runs.push([1, id]);
  }
  return { ...rest, packing: 1, palette, runs };
}
function unpackFrame(frame) {
  if (!frame?.packing) return clone(frame);
  if (
    !only(frame, [
      'version',
      'cols',
      'rows',
      'biome',
      'units',
      'summary',
      'enemiesActNext',
      'packing',
      'palette',
      'runs',
    ]) ||
    frame.packing !== 1 ||
    !integer(frame.cols, 1) ||
    frame.cols > 128 ||
    !integer(frame.rows, 1) ||
    frame.rows > 128 ||
    !Array.isArray(frame.palette) ||
    frame.palette.length > 16384 ||
    !Array.isArray(frame.runs) ||
    frame.runs.length > 16384
  )
    throw Error('Invalid packed frame');
  const { packing: _packing, palette, runs, ...rest } = clone(frame),
    tiles = [];
  for (const run of runs) {
    if (
      !Array.isArray(run) ||
      run.length !== 2 ||
      !integer(run[0], 1) ||
      !integer(run[1]) ||
      run[1] >= palette.length ||
      tiles.length + run[0] > frame.cols * frame.rows
    )
      throw Error('Invalid terrain run');
    const d = palette[run[1]];
    if (!Array.isArray(d) || d.length !== 4) throw Error('Invalid terrain descriptor');
    for (let n = 0; n < run[0]; n++)
      tiles.push({
        col: tiles.length % frame.cols,
        row: Math.floor(tiles.length / frame.cols),
        label: d[0],
        known: d[1],
        fog: d[2],
        ...(d[3] === null ? {} : { details: d[3] }),
      });
  }
  return { ...rest, tiles };
}

export function createHistoryPresentation(nextId = 1) {
  return { version: 1, nextId, records: [], earlierUnavailable: false };
}

function deltaBetween(before, after) {
  const beforeUnits = new Map(before.units.map((u) => [u.id, u]));
  const afterUnits = new Map(after.units.map((u) => [u.id, u]));
  return {
    units: [...new Set([...beforeUnits.keys(), ...afterUnits.keys()])]
      .filter((id) => !beforeUnits.has(id) || !afterUnits.has(id))
      .map((id) => [id, beforeUnits.get(id) || null, afterUnits.get(id) || null]),
    patches: after.units.flatMap((unit) => {
      const old = beforeUnits.get(unit.id);
      return old
        ? [...new Set([...Object.keys(old), ...Object.keys(unit)])]
            .filter((key) => !equal(old[key], unit[key]))
            .map((key) => [unit.id, key, old[key] ?? null, unit[key] ?? null])
        : [];
    }),
    order: equal(
      before.units.map((u) => u.id),
      after.units.map((u) => u.id),
    )
      ? null
      : [before.units.map((u) => u.id), after.units.map((u) => u.id)],
    tiles: after.tiles.flatMap((tile, i) =>
      equal(tile, before.tiles[i]) ? [] : [[i, before.tiles[i], tile]],
    ),
    summary: [before.summary, after.summary],
    enemiesActNext: [Boolean(before.enemiesActNext), Boolean(after.enemiesActNext)],
  };
}

export function applyHistoryDelta(frame, delta, reverse = false) {
  const next = clone(frame),
    side = reverse ? 1 : 2;
  const units = new Map(next.units.map((u) => [u.id, u]));
  for (const [id, before, after] of delta.units) {
    const value = reverse ? before : after;
    if (value) units.set(id, clone(value));
    else units.delete(id);
  }
  for (const [id, key, before, after] of delta.patches || []) {
    const unit = units.get(id),
      value = reverse ? before : after;
    if (!unit) throw Error('Unknown patched unit');
    if (value === null) delete unit[key];
    else unit[key] = clone(value);
  }
  next.units = delta.order
    ? delta.order[reverse ? 0 : 1].map((id) => units.get(id))
    : [...units.values()];
  for (const change of delta.tiles) next.tiles[change[0]] = clone(change[side]);
  next.summary = clone(delta.summary[reverse ? 0 : 1]);
  next.enemiesActNext = delta.enemiesActNext[reverse ? 0 : 1];
  return next;
}

export function historyFrameAt(archive, index) {
  if (!archive || index < 0 || index >= archive.records.length) return null;
  let start = index;
  while (start >= 0 && !archive.records[start].frame && index - start <= MAX_DELTA_CHAIN) start--;
  if (start < 0 || !archive.records[start].frame) return null;
  let frame = unpackFrame(archive.records[start].frame);
  for (let i = start + 1; i <= index; i++)
    frame = archive.records[i].frame
      ? unpackFrame(archive.records[i].frame)
      : applyHistoryDelta(frame, archive.records[i].delta);
  return frame;
}

export function appendHistoryPresentation(archive, frame, info) {
  if (!validHistoryFrame(frame)) return archive || createHistoryPresentation();
  const next = clone(archive || createHistoryPresentation());
  const previous = historyFrameAt(next, next.records.length - 1);
  const last = next.records.at(-1);
  // A canonical continuation can reuse its core row, but earlier visual edges
  // retain their chronology and can no longer point at the completed target.
  if (last?.entryId === info.entryId) last.entryId = null;
  // Keyframes follow the actual chain, not the record id: a rewind branch
  // keeps an id-aligned prefix, and the records appended after it used to
  // extend that chain past what hydration accepts — one reload then dropped
  // the whole archive and history fell back to the text board.
  const keyframe =
    !previous ||
    info.gap ||
    info.kind === 'turn_start' ||
    trailingDeltas(next.records) >= MAX_DELTA_CHAIN ||
    previous.cols !== frame.cols ||
    previous.rows !== frame.rows ||
    previous.biome !== frame.biome;
  next.records.push({
    id: next.nextId++,
    ...clone(info),
    ...(keyframe ? { frame: packFrame(frame) } : { delta: deltaBetween(previous, frame) }),
  });
  return retainHistoryPresentation(next, HISTORY_BYTES);
}

export function retainHistoryPresentation(archive, budget) {
  if (!archive) return null;
  const next = clone(archive);
  // Cosmetic cues are optional; endpoint deltas must remain exact.
  if (serializedBytes(next) > budget) {
    for (const record of next.records) {
      record.beats = [];
      record.endpointOnly = true;
    }
  }
  while (
    next.records.length &&
    (serializedBytes(next) > budget || next.records.length > HISTORY_RECORDS)
  ) {
    const frame = historyFrameAt(next, 1);
    next.records.shift();
    if (next.records.length && frame) {
      next.records[0].frame = packFrame(frame);
      delete next.records[0].delta;
      next.records[0].gap = true;
    }
    next.earlierUnavailable = true;
  }
  return serializedBytes(next) <= budget ? next : null;
}

export function branchHistoryPresentation(archive, entryId) {
  if (!archive) return null;
  const index = archive.records.findLastIndex((r) => r.entryId === entryId);
  const next = clone(archive);
  next.records = index < 0 ? [] : next.records.slice(0, index + 1);
  if (index < 0) next.earlierUnavailable = true;
  return next;
}

// Validate before rendering or allocating display objects. Invalid optional data
// is discarded independently of the authoritative timeline/snapshots.
export function hydrateHistoryPresentation(value, entries = []) {
  try {
    if (
      !only(value, ['version', 'nextId', 'records', 'earlierUnavailable']) ||
      value.version !== 1 ||
      !integer(value.nextId, 1) ||
      typeof value.earlierUnavailable !== 'boolean' ||
      !Array.isArray(value.records) ||
      value.records.length > HISTORY_RECORDS ||
      serializedBytes(value) > HISTORY_BYTES
    )
      return null;
    const anchors = new Map(entries.map((e) => [e.id, e])),
      seenAnchors = new Set();
    let previousId = 0,
      previousFrame = null,
      chain = 0;
    for (const r of value.records) {
      if (
        !only(r, [
          'id',
          'entryId',
          'anchorId',
          'revision',
          'generation',
          'turnNumber',
          'phase',
          'kind',
          'facts',
          'beats',
          'parents',
          'parentId',
          'actorId',
          'gap',
          'endpointOnly',
          'enemiesActNext',
          'frame',
          'delta',
        ]) ||
        !integer(r.id, 1) ||
        r.id <= previousId ||
        r.id >= value.nextId ||
        !integer(r.anchorId, 1) ||
        (r.parentId != null && (!integer(r.parentId, 1) || r.parentId > r.id)) ||
        (r.actorId != null && !unitId(r.actorId)) ||
        !(r.entryId === null || integer(r.entryId, 1)) ||
        !integer(r.turnNumber, 1) ||
        !integer(r.revision) ||
        !['player', 'enemy'].includes(r.phase) ||
        !['turn_start', 'player_action', 'enemy_action', 'event', 'recovery', 'rewind'].includes(
          r.kind,
        ) ||
        !Array.isArray(r.facts) ||
        r.facts.length > 256 ||
        !r.facts.every((s) => safeText(s, 8192)) ||
        !Array.isArray(r.beats) ||
        r.beats.length > 256 ||
        !object(r.parents) ||
        Object.keys(r.parents).length > 512 ||
        Object.entries(r.parents).some(
          ([id, p]) => !/^u[1-9]\d*$/.test(id) || !integer(p, 1) || p > r.id,
        )
      )
        return null;
      if (r.frame && r.delta) return null;
      if (r.frame) {
        previousFrame = unpackFrame(r.frame);
        chain = 0;
      } else {
        if (
          !previousFrame ||
          ++chain > MAX_DELTA_CHAIN ||
          !only(r.delta, ['units', 'patches', 'order', 'tiles', 'summary', 'enemiesActNext']) ||
          (r.delta.patches !== undefined &&
            (!Array.isArray(r.delta.patches) ||
              r.delta.patches.length > 8192 ||
              r.delta.patches.some(
                (p) =>
                  !Array.isArray(p) ||
                  p.length !== 4 ||
                  !unitId(p[0]) ||
                  ![
                    'name',
                    'className',
                    'spriteKey',
                    'faction',
                    'col',
                    'row',
                    'hp',
                    'maxHP',
                    'level',
                    'acted',
                    'weapon',
                    'items',
                    'conditions',
                    'affixes',
                    'buffs',
                    'size',
                    'width',
                    'height',
                  ].includes(p[1]),
              ))) ||
          !Array.isArray(r.delta.units) ||
          r.delta.units.length > 1024 ||
          !Array.isArray(r.delta.tiles) ||
          r.delta.tiles.length > 16384 ||
          r.delta.units.some(
            (c) => !Array.isArray(c) || c.length !== 3 || !/^u[1-9]\d*$/.test(c[0]),
          ) ||
          r.delta.tiles.some(
            (c) =>
              !Array.isArray(c) ||
              c.length !== 3 ||
              !integer(c[0]) ||
              c[0] >= previousFrame.tiles.length,
          )
        )
          return null;
        const after = applyHistoryDelta(previousFrame, r.delta);
        if (!equal(applyHistoryDelta(after, r.delta, true), previousFrame)) return null;
        previousFrame = after;
      }
      if (
        !validHistoryFrame(previousFrame) ||
        !r.beats.every((b) => validHistoryBeat(b, previousFrame))
      )
        return null;
      if (r.entryId !== null) {
        if (seenAnchors.has(r.entryId)) return null;
        seenAnchors.add(r.entryId);
        const entry = anchors.get(r.entryId);
        if (entry) {
          if (['revision', 'kind', 'turnNumber', 'phase'].some((k) => r[k] !== entry[k]))
            return null;
          // Under byte pressure the timeline drops review-only board previews
          // (this archive keeps their frames); a present preview must match.
          const preview = entry.preview;
          const units = new Map(previousFrame.units.map((u) => [u.id, u]));
          if (
            preview &&
            (!Array.isArray(preview.units) ||
              preview.units.length !== units.size ||
              preview.units.some(
                (u) =>
                  !units.has(u.id) ||
                  Object.entries(u).some(([k, v]) => !equal(v, units.get(u.id)[k])),
              ))
          )
            return null;
          if (
            preview &&
            previewTiles(preview).some(
              (t) => previousFrame.tiles[t.row * previousFrame.cols + t.col]?.label !== t.label,
            )
          )
            return null;
        }
      }
      previousId = r.id;
    }
    return clone(value);
  } catch {
    return null;
  }
}

export function validHistoryBeat(b, frame) {
  return Boolean(
    only(b, [
      'type',
      'label',
      'actorId',
      'targetId',
      'actorPosition',
      'targetPosition',
      'path',
      'outcome',
    ]) &&
    (b.outcome == null ||
      (only(b.outcome, ['damage', 'amount', 'miss', 'critical']) &&
        Object.entries(b.outcome).every(([k, v]) =>
          ['miss', 'critical'].includes(k) ? typeof v === 'boolean' : Number.isFinite(v) && v >= 0,
        ))) &&
    [b.actorPosition, b.targetPosition].every(
      (p) =>
        p == null ||
        (only(p, ['col', 'row', 'size']) && coord(p, frame) && integer(p.size, 1) && p.size <= 3),
    ) &&
    safeText(b.type, 40) &&
    safeText(b.label, 1024) &&
    (b.actorId == null || /^u[1-9]\d*$/.test(b.actorId)) &&
    (b.targetId == null || /^u[1-9]\d*$/.test(b.targetId)) &&
    (b.path == null ||
      (Array.isArray(b.path) &&
        b.path.length <= 1024 &&
        b.path.every((p) => p === null || coord(p, frame)))),
  );
}

/**
 * A renderable board (version 2 frame) rebuilt from a row's compact preview,
 * for rows whose archived frame is gone (budget pressure, a frame that could
 * not be captured, an archive a reload could not verify). Coarse by design:
 * tiles the event never saw stay Unknown and everything else is shown as
 * visible; class and sprite come from `unitLook(id)` when the caller knows
 * the unit, otherwise the renderer draws its faction marker. Null when the
 * preview cannot describe a board.
 */
export function frameFromCompactPreview(preview, { biome = '', unitLook = () => null } = {}) {
  if (!object(preview)) return null;
  if (preview.version === 2) return validHistoryFrame(preview) ? preview : null;
  const { cols, rows } = preview;
  if (!integer(cols, 1) || !integer(rows, 1) || cols > 128 || rows > 128) return null;
  const labels = new Map();
  for (const tile of previewTiles(preview))
    if (coord(tile, { cols, rows }) && safeText(tile.label))
      labels.set(tile.row * cols + tile.col, tile.label);
  if (!labels.size) return null;
  const tiles = [];
  for (let i = 0; i < cols * rows; i++) {
    const label = labels.get(i);
    const known = typeof label === 'string' && label !== 'Unknown';
    tiles.push({
      col: i % cols,
      row: Math.floor(i / cols),
      label: known ? label : 'Unknown',
      known,
      fog: known ? 'visible' : 'unseen',
    });
  }
  const units = [];
  const ids = new Set();
  for (const u of Array.isArray(preview.units) ? preview.units.slice(0, 512) : []) {
    if (!object(u) || !unitId(u.id) || ids.has(u.id) || !coord(u, { cols, rows })) continue;
    if (!['player', 'enemy', 'npc'].includes(u.faction)) continue;
    let look;
    try {
      look = unitLook(u.id, u);
    } catch {
      look = null;
    }
    const spriteKey = typeof look?.spriteKey === 'string' ? look.spriteKey : '';
    const hp = Number.isFinite(u.hp) ? Math.max(0, u.hp) : 0;
    const maxHP = Number.isFinite(u.maxHP) && u.maxHP > 0 ? u.maxHP : Math.max(1, hp);
    ids.add(u.id);
    units.push({
      id: u.id,
      name: safeText(u.name) ? u.name : 'Unit',
      className: safeText(look?.className) ? look.className : '',
      spriteKey: spriteKey.length <= 128 && SPRITE_KEY.test(spriteKey) ? spriteKey : '',
      faction: u.faction,
      col: u.col,
      row: u.row,
      hp,
      maxHP,
      ...(integer(u.level) ? { level: u.level } : {}),
      ...(typeof u.acted === 'boolean' ? { acted: u.acted } : {}),
      ...(safeText(u.weapon) ? { weapon: u.weapon } : {}),
      ...(textList(u.items, 128) ? { items: [...u.items] } : {}),
      conditions: textList(u.conditions, 64, 64) ? [...u.conditions] : [],
      size: integer(look?.size, 1) && look.size <= 3 ? look.size : 1,
    });
  }
  const frame = {
    version: 2,
    cols,
    rows,
    biome: safeText(biome, 64) ? biome : '',
    tiles,
    units,
    summary: Array.isArray(preview.summary)
      ? preview.summary.filter((line) => safeText(line, 1024)).slice(0, 64)
      : [],
    enemiesActNext: Boolean(preview.enemiesActNext),
  };
  return validHistoryFrame(frame) ? frame : null;
}

/** Merge optional older visual rows with current canonical rewind entries. */
export function historyDisplayEntries(history) {
  if (!history?.presentation?.records?.length) return history?.entries || [];
  const core = new Map(history.entries.map((e) => [e.id, e]));
  const cache = new Map();
  const rows = history.presentation.records.map((r, i) => {
    const entry = core.get(r.entryId);
    core.delete(r.entryId);
    const row = {
      ...(entry || {}),
      ...r,
      id: entry?.id ?? `history-${r.id}`,
      destination: entry?.destination || false,
      snapshotId: entry?.snapshotId || null,
      historyIndex: i,
      reviewOnly: !entry,
      facts: r.facts,
    };
    Object.defineProperty(row, 'preview', {
      enumerable: true,
      get() {
        if (!cache.has(i)) {
          if (cache.size >= 8) cache.delete(cache.keys().next().value);
          cache.set(i, historyFrameAt(history.presentation, i));
        }
        return cache.get(i);
      },
    });
    return row;
  });
  // Core points must remain accessible even when optional frames were pruned.
  const remaining = [...core.values()].map((entry) => {
    if (entry.kind !== 'rewind') return entry;
    const target = entry.facts.find((f) => f?.type === 'rewind')?.targetId;
    const index = history.presentation.records.findLastIndex((r) => r.entryId === target);
    return index < 0
      ? entry
      : { ...entry, preview: historyFrameAt(history.presentation, index), gap: true, beats: [] };
  });
  return [...rows, ...remaining].sort(
    (a, b) =>
      a.revision - b.revision ||
      a.turnNumber - b.turnNumber ||
      (a.anchorId ?? (typeof a.id === 'number' ? a.id : 0)) -
        (b.anchorId ?? (typeof b.id === 'number' ? b.id : 0)),
  );
}

// Only contiguous unfinished fragments can collapse into a completed action.
// Interleaved actors and legal destinations always remain separate rows.
export function groupHistoryEntries(entries) {
  const rows = [];
  for (const entry of entries) {
    const previous = rows.at(-1);
    if (
      entry.parentId &&
      previous?.parentId === entry.parentId &&
      previous.actorId === entry.actorId &&
      previous.revision === entry.revision &&
      previous.kind === 'recovery' &&
      !previous.destination &&
      !entry.gap &&
      ['recovery', 'player_action'].includes(entry.kind)
    ) {
      rows.pop();
      const grouped = Object.defineProperties({}, Object.getOwnPropertyDescriptors(entry));
      grouped.beats = [...(previous.beats || []), ...(entry.beats || [])].slice(0, 256);
      grouped.facts = [...new Set([...(previous.facts || []), ...(entry.facts || [])])].slice(
        0,
        256,
      );
      rows.push(grouped);
    } else rows.push(entry);
  }
  return rows;
}
