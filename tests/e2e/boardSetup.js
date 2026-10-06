// Board staging for browser specs that open a GENERATED battlefield
// (`/?devScene=battle&preset=<p>&seed=42`, without `battleLab=1`).
//
// A generated map is a function of the run's whole random stream, so any change to what
// the route draws before the battle (node rows, node types) re-rolls the layout: the
// terrain, where the army spawns, where the foes stand. A spec that needs "Support beside
// Edric" or "a foe within Sera's reach" must therefore stage that board itself, from
// whatever open ground the map has, instead of relying on the seed's incidental spawn.
//
// These helpers run in the page against the live Battle scene, move units the way the
// existing specs do (set col/row, then `updateUnitPosition`, which refreshes the danger
// zone), and read passability from the scene's own grid. Each returns the tiles it used,
// or throws when the map has no room (a real map always has: it is a 10x8 grid or larger).
//
// Playwright serialises a function it is given, so each page function is self-contained:
// nothing here may reference a module-level binding.

/**
 * Put the named player units in a straight line, in order, on open ground, with `before`
 * free tiles ahead of the first and `after` free tiles beyond the last on the same line
 * (so a Shove has somewhere to land and a Pull somewhere to retreat to). "Open" is a tile
 * every unit type crosses at cost 1 (Plain, Floor...), with no unit and no NPC on it.
 * Among the lines that fit, the one farthest from every enemy wins, then the one nearest
 * where the first unit already stands, so the board changes as little as it can.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string[]} names player unit names, in line order
 * @param {{ before?: number, after?: number, clearOfEnemies?: number }} [options]
 *   clearOfEnemies: the line and its free ends keep at least this Manhattan distance from
 *   every enemy (default 3), so no foe stands in a placed unit's weapon range.
 * @returns {Promise<{ tiles: Array<[number, number]>, direction: [number, number] }>}
 *   the tiles of the placed units, in order
 */
export function placeInLine(page, names, { before = 1, after = 1, clearOfEnemies = 3 } = {}) {
  return page.evaluate(
    ({ names, before, after, clearOfEnemies }) => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      const grid = s.grid;
      const units = names.map((name) => {
        const u = s.playerUnits.find((p) => p.name === name);
        if (!u) throw new Error(`placeInLine: no player unit named ${name}`);
        return u;
      });
      const moving = new Set(units);
      const open = (c, r) => {
        const terrain = grid.getTerrainAt(c, r);
        if (!terrain) return false;
        if (!['Infantry', 'Armored', 'Cavalry', 'Flying'].every((t) => terrain.moveCost[t] === '1'))
          return false;
        const occupant = s.getUnitAt(c, r);
        if (occupant && !moving.has(occupant)) return false;
        return !(s.npcUnits || []).some((n) => n.col === c && n.row === r);
      };
      const foes = s.enemyUnits.filter((e) => e.currentHP > 0);
      const nearestFoe = (c, r) =>
        foes.reduce((best, e) => Math.min(best, Math.abs(e.col - c) + Math.abs(e.row - r)), 99);
      const total = before + units.length + after;
      const first = units[0];
      let best = null;
      for (const [dc, dr] of [
        [1, 0],
        [0, 1],
      ]) {
        for (let row = 0; row < grid.rows; row++) {
          for (let col = 0; col < grid.cols; col++) {
            const tiles = Array.from({ length: total }, (_, i) => [col + dc * i, row + dr * i]);
            if (!tiles.every(([c, r]) => open(c, r))) continue;
            const clear = Math.min(...tiles.map(([c, r]) => nearestFoe(c, r)));
            if (clear < clearOfEnemies) continue;
            const slot = tiles[before];
            const travel = Math.abs(slot[0] - first.col) + Math.abs(slot[1] - first.row);
            const score = [-clear, travel];
            if (
              !best ||
              score[0] < best.score[0] ||
              (score[0] === best.score[0] && score[1] < best.score[1])
            )
              best = { tiles, direction: [dc, dr], score };
          }
        }
      }
      if (!best) throw new Error(`placeInLine: no open line of ${total} tiles clear of the foes`);
      const placed = [];
      units.forEach((u, i) => {
        const [c, r] = best.tiles[before + i];
        u.col = c;
        u.row = r;
        s.updateUnitPosition(u);
        placed.push([c, r]);
      });
      return { tiles: placed, direction: best.direction };
    },
    { names, before, after, clearOfEnemies },
  );
}

/**
 * Stand enemies on open ground close to a player unit, so that some tile in that unit's
 * move range is within the enemies' reach (threat sight, danger, forecasts). Each enemy
 * takes the free open tile nearest to the unit at Manhattan distance `minDistance` or
 * more (never beside the unit unless `minDistance` is 1), spread around it. Only tiles
 * every unit type crosses at cost 1 are used, so the foe can both stand and move there.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} unitName the player unit the enemies gather around
 * @param {{ count?: number, minDistance?: number }} [options] count defaults to 4
 * @returns {Promise<Array<[number, number]>>} the tiles the enemies took
 */
export function placeEnemiesAround(page, unitName, { count = 4, minDistance = 3 } = {}) {
  return page.evaluate(
    ({ unitName, count, minDistance }) => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      const grid = s.grid;
      const anchor = s.playerUnits.find((p) => p.name === unitName);
      if (!anchor) throw new Error(`placeEnemiesAround: no player unit named ${unitName}`);
      const foes = s.enemyUnits.filter((e) => e.currentHP > 0).slice(0, count);
      const moving = new Set(foes);
      const open = (c, r) => {
        const terrain = grid.getTerrainAt(c, r);
        if (!terrain) return false;
        if (!['Infantry', 'Armored', 'Cavalry', 'Flying'].every((t) => terrain.moveCost[t] === '1'))
          return false;
        const occupant = s.getUnitAt(c, r);
        if (occupant && !moving.has(occupant)) return false;
        return !(s.npcUnits || []).some((n) => n.col === c && n.row === r);
      };
      const taken = [];
      for (const foe of foes) {
        let best = null;
        for (let row = 0; row < grid.rows; row++) {
          for (let col = 0; col < grid.cols; col++) {
            const d = Math.abs(col - anchor.col) + Math.abs(row - anchor.row);
            if (d < minDistance || !open(col, row)) continue;
            if (taken.some(([c, r]) => c === col && r === row)) continue;
            // Nearest first; among equals, the tile farthest from the foes already placed
            // (spread them round the unit rather than in a clump).
            const apart = taken.length
              ? Math.min(...taken.map(([c, r]) => Math.abs(c - col) + Math.abs(r - row)))
              : 0;
            if (!best || d < best.d || (d === best.d && apart > best.apart))
              best = { col, row, d, apart };
          }
        }
        if (!best) throw new Error('placeEnemiesAround: no open ground left for a foe');
        foe.col = best.col;
        foe.row = best.row;
        s.updateUnitPosition(foe);
        taken.push([best.col, best.row]);
      }
      return taken;
    },
    { unitName, count, minDistance },
  );
}
