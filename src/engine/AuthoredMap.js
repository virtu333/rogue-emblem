// AuthoredMap.js - the ASCII map grammar authored battles share: the prologue's chapters
// (data/prologue.json) and the event set pieces (data/setPieces.json). Pure, no Phaser.
//
// A map is { legend: { <one char>: <terrain name> }, rows: [<tiles separated by spaces>] }.
// Rows must be rectangular; every tile must be in the legend and every legend entry a
// terrain.json name.

import { TERRAIN } from '../utils/constants.js';

/**
 * Parse an authored ASCII map against terrain.json. Never throws.
 * @returns {{ mapLayout: number[][]|null, cols: number, rows: number, errors: string[] }}
 */
export function parseAuthoredMap(map, terrainData) {
  const errors = [];
  const rowsIn = map?.rows;
  const legend = map?.legend;
  if (!Array.isArray(rowsIn) || rowsIn.length === 0) {
    return { mapLayout: null, cols: 0, rows: 0, errors: ['map.rows must be a non-empty array'] };
  }
  if (!legend || typeof legend !== 'object' || Array.isArray(legend)) {
    return { mapLayout: null, cols: 0, rows: 0, errors: ['map.legend must be an object'] };
  }
  const indexOf = {};
  for (const [char, name] of Object.entries(legend)) {
    if (!/^\S$/.test(char)) errors.push(`map.legend key "${char}" must be one character`);
    const index = (terrainData || []).findIndex((t) => t?.name === name);
    if (index < 0) errors.push(`map.legend "${char}" names unknown terrain "${name}"`);
    else indexOf[char] = index;
  }
  const tokens = rowsIn.map((row) => (typeof row === 'string' ? row.trim().split(/\s+/) : null));
  const cols = tokens[0]?.length || 0;
  const mapLayout = [];
  tokens.forEach((line, r) => {
    if (!line) {
      errors.push(`map row ${r} must be a string`);
      return;
    }
    if (line.length !== cols) {
      errors.push(
        `map row ${r} has ${line.length} tiles, expected ${cols} (rows must be rectangular)`,
      );
    }
    mapLayout.push(
      line.map((char, c) => {
        if (!(char in indexOf)) {
          if (!(char in legend)) errors.push(`map tile (${c},${r}) "${char}" is not in the legend`);
          return -1;
        }
        return indexOf[char];
      }),
    );
  });
  return { mapLayout: errors.length ? null : mapLayout, cols, rows: rowsIn.length, errors };
}

/**
 * Every Throne tile of a parsed map, in reading order (row by row). A seize chapter or set piece
 * has exactly one (their validators say so); its `thronePos` is that tile.
 * @param {number[][]} mapLayout
 * @returns {{ col: number, row: number }[]}
 */
export function throneTiles(mapLayout) {
  const out = [];
  (mapLayout || []).forEach((line, row) =>
    (line || []).forEach((index, col) => {
      if (index === TERRAIN.Throne) out.push({ col, row });
    }),
  );
  return out;
}
