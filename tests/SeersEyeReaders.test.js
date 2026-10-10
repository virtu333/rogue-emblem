// Seer's Eye (docs/specs/blessings-v3.md §6.7): fog never hides a foe. Every reader of "does the
// player see this foe" asks one rule (BattleInformation.isUnitSeenAt / isUnitTileSeen /
// canInspectUnit), so the Eye reaches all of them or none.
//
// Each behavioural test pairs two worlds with the same fog and the same fogged foe; only the Eye
// differs. The Eye-off world pins today's behaviour (the fog hides the foe from the reader); the
// Eye-on world requires the reader to know the foe. Ways this can fail, a test each:
//   - Danger, Threat Sight or the blue range ignore a foe the Eye shows (or count one without it);
//   - the history keeps no walk, or no name, for a foe the Eye showed walking;
//   - the timeline's frames (the history viewer's board) drop a foe the Eye showed;
//   - a new reader in src/ui or src/scenes decides a foe's visibility from a tile's sight alone,
//     or reads `grid.foesShown` by hand (the static boundary below).
// The boss bar, the enemy's walk, the Necromancer's raise, the Zombie's remains and the area aim
// have their paired tests beside their other fog tests (BossPresenceController, EnemyPhasePacing,
// NecromancyBattle, ZombieRemainsBattle, AreaTargeting).
import { describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
vi.mock('phaser', () => ({ default: { Scene: class {} } }));
import { BattleScene } from '../src/scenes/BattleScene.js';
import { Grid } from '../src/engine/Grid.js';
import { threatSummaryText } from '../src/engine/ThreatForecast.js';
import { markFoesShown } from '../src/engine/BattleInformation.js';
import { ThreatSightController } from '../src/ui/ThreatSightController.js';
import { rememberHistoryPath } from '../src/ui/BattleHistoryRecorder.js';
import { battleTimelinePreview } from '../src/engine/BattleTimelineFacts.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();
const T = Object.fromEntries(gameData.terrain.map((t, i) => [t.name, i]));

function mockScene() {
  const stub = new Proxy({}, { get: (t, p) => (p === 'destroy' ? () => {} : () => stub) });
  return {
    cameras: { main: { width: 640, height: 480 } },
    add: { rectangle: () => stub, image: () => stub, text: () => stub, container: () => stub },
    textures: { exists: () => false },
  };
}

/** A plain corridor; `hidden` = fogged tiles ("col,row"); `eye`: Seer's Eye on the grid. */
function makeGrid(line, hidden, eye) {
  const map = [[...line].map(() => T.Plain)];
  const grid = new Grid(mockScene(), map[0].length, 1, gameData.terrain, map, true);
  grid.isVisible = (col, row) => !hidden.has(`${col},${row}`);
  markFoesShown(grid, eye ? { foesShown: true } : {});
  return grid;
}

const foe = (col, row) => ({
  name: 'Fighter',
  faction: 'enemy',
  battleEntityId: 'e1',
  col,
  row,
  currentHP: 20,
  mov: 3,
  stats: { MOV: 3, HP: 20 },
  moveType: 'Infantry',
  weapon: { name: 'Iron Axe', type: 'Axe', range: '1' },
});
const hero = (col, row) => ({
  name: 'Edric',
  faction: 'player',
  battleEntityId: 'p1',
  col,
  row,
  currentHP: 20,
  mov: 5,
  stats: { MOV: 5, HP: 20 },
  moveType: 'Infantry',
  weapon: { name: 'Iron Sword', type: 'Sword', range: '1' },
});

/**
 * A 1×10 corridor: the player at (0,0), a Fighter (MOV 3, range 1) at (6,0); the party sees only
 * (0,0)..(2,0), so the Fighter and every tile it reaches are fogged.
 */
function corridor(eye) {
  const hidden = new Set(['3,0', '4,0', '5,0', '6,0', '7,0', '8,0', '9,0']);
  const grid = makeGrid('..........', hidden, eye);
  const scene = new BattleScene();
  const player = hero(0, 0);
  Object.assign(scene, {
    _battleSession: 1,
    grid,
    enemyUnits: [foe(6, 0)],
    playerUnits: [player],
    npcUnits: [],
    ballistas: [],
    gameData: { skills: [] },
  });
  return { scene, grid, player };
}
const keys = (tiles) => tiles.map((t) => `${t.col},${t.row}`).sort();

describe('previews know the foes the Eye shows (Danger, Threat Sight, the blue range)', () => {
  it('Danger draws the fogged foe’s reach only under the Eye', () => {
    expect(corridor(false).scene.calculateDangerZone()).toEqual([]);
    // MOV 3 from (6,0): it stops on 3..9 and strikes one tile on, 2..9 (its own tile included).
    expect(keys(corridor(true).scene.calculateDangerZone())).toEqual(
      ['2,0', '3,0', '4,0', '5,0', '6,0', '7,0', '8,0', '9,0'].sort(),
    );
  });

  it('Threat Sight at a destination counts the fogged foe only under the Eye', () => {
    const text = ({ scene, player }) =>
      threatSummaryText(new ThreatSightController(scene).query(player, 2, 0));
    expect(text(corridor(false))).not.toMatch(/^1 foe can reach/);
    expect(text(corridor(true))).toMatch(/^1 foe can reach/);
  });

  it('the blue range stops at a foe the Eye shows, and runs past one the fog hides', () => {
    const range = ({ scene, grid }) =>
      [...grid.getMovementRange(0, 0, 8, 'Infantry', scene.buildUnitPositionMap(), 'player').keys()]
        .filter((k) => k !== '0,0')
        .sort();
    expect(range(corridor(false))).toEqual(
      ['1,0', '2,0', '3,0', '4,0', '5,0', '6,0', '7,0', '8,0'].sort(),
    );
    // The Fighter's tile blocks: the range ends before it.
    expect(range(corridor(true))).toEqual(['1,0', '2,0', '3,0', '4,0', '5,0'].sort());
  });
});

describe('the history and the timeline keep what the Eye showed', () => {
  const walk = [5, 6, 7, 8].map((col) => ({ col, row: 0 }));
  const historyScene = (eye) => ({
    grid: makeGrid('..........', new Set(['5,0', '6,0', '7,0']), eye),
    runManager: { battleInProgress: {} },
  });

  it('a walk through the fog is kept whole and named under the Eye; clipped and unnamed without', () => {
    const plain = historyScene(false);
    rememberHistoryPath(plain, foe(8, 0), walk, false);
    expect(plain._historyBeats).toEqual([
      expect.objectContaining({
        actorId: 'e1',
        label: 'Fighter moved.',
        path: [null, null, null, { col: 8, row: 0 }],
      }),
    ]);
    const hidden = historyScene(false);
    rememberHistoryPath(hidden, { ...foe(7, 0) }, walk.slice(0, 3), false);
    expect(hidden._historyBeats || []).toEqual([]);

    const eye = historyScene(true);
    rememberHistoryPath(eye, foe(7, 0), walk.slice(0, 3), false);
    expect(eye._historyBeats).toEqual([
      expect.objectContaining({ actorId: 'e1', label: 'Fighter moved.', path: walk.slice(0, 3) }),
    ]);
  });

  it("the timeline's board keeps a foe the Eye showed (the fog is the saved one)", () => {
    const state = {
      fog: { visible: ['0,0'], everSeen: ['0,0'] },
      mapLayout: [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
      playerUnits: [{ ...hero(0, 0), stats: { HP: 20 } }],
      enemyUnits: [{ ...foe(6, 0), stats: { HP: 20 } }],
      npcUnits: [],
    };
    const names = (grid) =>
      battleTimelinePreview(state, gameData.terrain, { grid }).units.map((u) => u.name);
    expect(names(makeGrid('..........', new Set(), false))).toEqual(['Edric']);
    expect(names(null)).toEqual(['Edric']);
    expect(names(makeGrid('..........', new Set(), true))).toEqual(['Edric', 'Fighter']);
  });
});

// ── The boundary ──────────────────────────────────────────────────────────

const ROOT = join(import.meta.dirname, '..');
function sourceFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.(js|mjs)$/.test(name)) out.push(path);
  }
  return out;
}
const rel = (path) => relative(ROOT, path).replaceAll('\\', '/');
/** Blank out comments so prose never counts. */
const code = (text) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:\\'"`])\/\/[^\n]*/g, (m, lead) => lead + ' '.repeat(m.length - lead.length));

// A tile's sight read directly (`grid.isVisible(col, row)`, `isVisible?.(c, r)`, a wrapper such
// as `this.isVisible(c, r)`, or the pacing's `isTileSeen(grid, c, r)`): a call WITH arguments (a
// scene's or a page's own `isVisible()` takes none). Each file that may still read one, with how
// many and why: none of them decides whether the player sees a foe.
const TILE_SIGHT = /(?<![\w$])(?:isVisible|isTileSeen)\s*(?:\?\.)?\s*\(\s*[^)\s]/g;
const DEFINITION = /^\s*(?:export\s+)?(?:function\s+)?(?:isVisible|isTileSeen)\s*\([^)]*\)\s*\{/;
const ALLOWED = {
  'src/scenes/BattleScene.js': [2, 'terrain: a wall a foe made or broke, told only where seen'],
  'src/ui/CombatFxController.js': [1, "ballista: the engine's tile, not a unit"],
  'src/ui/InputController.js': [1, "ballista: an enemy ballista's range, shown only when seen"],
  'src/ui/PrologueController.js': [1, 'prologue: never under the Eye (no blessings)'],
  'src/ui/PrologueCoach.js': [1, 'prologue: never under the Eye (no blessings)'],
  'src/ui/battleSidebarDisplay.js': [1, "the caravan's last tile (a green unit, never a foe)"],
  'src/ui/RemainsMarkerController.js': [1, 'zombie remains: a record on the ground, not a unit'],
  'src/ui/ZombieRemainsController.js': [
    5,
    'zombie remains: a record on the ground (isVisible and its four ground reads), not a unit',
  ],
  'src/ui/EnemyPhasePacing.js': [2, "terrain: a broken wall's tile (noteTile); isTileSeen's body"],
};

describe('one rule for a foe’s visibility (a static boundary)', () => {
  const files = [...sourceFiles(join(ROOT, 'src/ui')), ...sourceFiles(join(ROOT, 'src/scenes'))];

  it('no reader in src/ui or src/scenes reads a tile’s sight outside the allowlist', () => {
    const found = {};
    for (const file of files) {
      const lines = code(readFileSync(file, 'utf8')).split('\n');
      const n = lines
        .filter((line) => !DEFINITION.test(line))
        .join('\n')
        .match(TILE_SIGHT);
      if (n?.length) found[rel(file)] = n.length;
    }
    const expected = Object.fromEntries(Object.entries(ALLOWED).map(([f, [n]]) => [f, n]));
    expect(found).toEqual(expected);
  });

  it('no file outside BattleInformation reads the Eye by hand (`foesShown`)', () => {
    const readers = [];
    for (const file of [...files, ...sourceFiles(join(ROOT, 'src/engine'))]) {
      if (!/\bfoesShown\b/.test(code(readFileSync(file, 'utf8')))) continue;
      readers.push(rel(file));
    }
    // BattleInformation keeps the rule; RunManager writes the battle's key; EarnedBoons holds
    // the card's runtime field.
    expect(readers.sort()).toEqual([
      'src/engine/BattleInformation.js',
      'src/engine/EarnedBoons.js',
      'src/engine/RunManager.js',
    ]);
  });

  it('the scan is not blind: it finds a planted tile read and a planted Eye read', () => {
    expect('if (grid.isVisible(c, r)) show();'.match(TILE_SIGHT)).toHaveLength(1);
    expect('scene.grid.isVisible?.(c, r)'.match(TILE_SIGHT)).toHaveLength(1);
    expect('isTileSeen(grid, c, r)'.match(TILE_SIGHT)).toHaveLength(1);
    expect('unit.setVisible(true)'.match(TILE_SIGHT)).toBeNull();
    expect('scene.isVisible?.() !== false'.match(TILE_SIGHT)).toBeNull();
    expect(/\bfoesShown\b/.test(code('const a = grid.foesShown;'))).toBe(true);
    expect(/\bfoesShown\b/.test(code('// grid.foesShown in prose'))).toBe(false);
  });
});
