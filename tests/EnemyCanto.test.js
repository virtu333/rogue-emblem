// Enemy Canto (Dave, Oct 2026): an enemy with Canto or Parting Step steps away after it
// acts, on the player's budget (CantoRule.cantoAllowance), to the tile the fewest of the
// army could strike next turn (EnemyCanto.js). Real Grid, real AIController.
import { describe, expect, it } from 'vitest';
import { Grid } from '../src/engine/Grid.js';
import { AIController } from '../src/engine/AIController.js';
import { planEnemyCanto } from '../src/engine/EnemyCanto.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();
const T = Object.fromEntries(gameData.terrain.map((t, i) => [t.name, i]));
const SWORD = { name: 'Iron Sword', range: '1', type: 'Sword', might: 5, hit: 90, weight: 5 };

const stub = new Proxy({}, { get: (t, p) => (p in t ? t[p] : () => stub) });
function grid(rows) {
  const layout = rows.map((r) =>
    r.split('').map((ch) => (ch === 'L' ? T['Lava Crack'] : ch === 'F' ? T.Forest : T.Plain)),
  );
  return new Grid(
    {
      cameras: { main: { width: 640, height: 480 } },
      add: { rectangle: () => stub, image: () => stub, text: () => stub, container: () => stub },
      textures: { exists: () => false },
    },
    layout[0].length,
    layout.length,
    gameData.terrain,
    layout,
    false,
  );
}
const STRIP = ['............', '............', '............'];
const STATS = { HP: 30, STR: 10, MAG: 0, SKL: 8, SPD: 8, LCK: 5, DEF: 6, RES: 4, MOV: 7 };

function rider(o = {}) {
  return {
    name: 'Rider',
    faction: 'enemy',
    col: 1,
    row: 1,
    mov: 7,
    moveType: 'Infantry',
    stats: { ...STATS },
    currentHP: 30,
    weapon: SWORD,
    inventory: [SWORD],
    skills: ['canto'],
    ...o,
  };
}
function soldier(o = {}) {
  return {
    name: 'Edric',
    faction: 'player',
    col: 0,
    row: 1,
    mov: 2,
    moveType: 'Infantry',
    stats: { ...STATS, MOV: 2 },
    currentHP: 30,
    weapon: SWORD,
    inventory: [SWORD],
    skills: [],
    ...o,
  };
}
const plan = (g, enemy, players, origin, extra = {}) =>
  planEnemyCanto({
    enemy,
    origin,
    afterCombat: true,
    grid: g,
    units: [enemy, ...players],
    playerUnits: players,
    skillsData: gameData.skills,
    ...extra,
  });
const end = (p) => p && p.path[p.path.length - 1];

describe('planEnemyCanto', () => {
  // Edric (0,1) walks 2 and strikes 1: he reaches every tile within 3 of him.
  it('Canto: steps out of reach by the shortest step, first in reading order', () => {
    const g = grid(STRIP);
    const e = rider();
    // Walked 2 of 7 (from (3,1)): 5 left. (3,0) is 4 from Edric, 3 steps away.
    const p = plan(g, e, [soldier()], { col: 3, row: 1 });
    expect(p.allowance).toBe(5);
    expect(end(p)).toEqual({ col: 3, row: 0 });
  });

  it('Parting Step: half of what is left, rounded down', () => {
    const g = grid(STRIP);
    // Edric now walks 1: he reaches tiles within 2.
    const players = [soldier({ mov: 1, stats: { ...STATS, MOV: 1 } })];
    const p = plan(g, rider({ skills: ['half_canto'] }), players, { col: 3, row: 1 });
    expect(p.allowance).toBe(2);
    expect(end(p)).toEqual({ col: 2, row: 0 });
    // 3 left halves to 1: every tile in one step is still in his reach, so it stays.
    expect(plan(g, rider({ skills: ['half_canto'] }), players, { col: 5, row: 1 })).toBe(null);
  });

  it('no Canto skill, a boss, a guard or a holder never steps', () => {
    const g = grid(STRIP);
    const origin = { col: 3, row: 1 };
    expect(plan(g, rider({ skills: [] }), [soldier()], origin)).toBe(null);
    expect(plan(g, rider({ isBoss: true }), [soldier()], origin)).toBe(null);
    expect(plan(g, rider({ aiMode: 'guard' }), [soldier()], origin)).toBe(null);
    expect(plan(g, rider({ aiMode: 'hold' }), [soldier()], origin)).toBe(null);
  });

  it('a unit that spent its whole move has nothing left', () => {
    const g = grid(STRIP);
    expect(plan(g, rider(), [soldier()], { col: 8, row: 1 })).toBe(null);
  });

  it('never stops on lava, and prefers cover when the reach is the same', () => {
    const g = grid(['...L........', '............', '............']);
    expect(end(plan(g, rider(), [soldier()], { col: 3, row: 1 }))).toEqual({ col: 4, row: 1 });
    // Out of reach everywhere it can go: a forest beats open ground at the same reach.
    const far = grid(['............', '.....F......', '............']);
    const e = rider({ col: 4, row: 1 });
    const p = plan(far, e, [soldier({ col: 0, row: 1, mov: 0, stats: { ...STATS, MOV: 0 } })], {
      col: 4,
      row: 1,
    });
    expect(end(p)).toEqual({ col: 5, row: 1 });
  });
});

describe('enemy phase', () => {
  async function runPhase(skills) {
    const g = grid(STRIP);
    const e = rider({ col: 6, row: 1, skills });
    const edric = soldier({ col: 2, row: 1 });
    const ai = new AIController(g, gameData);
    const moves = [];
    await ai.processEnemyPhase([e], [edric], [], {
      afterUnit: () => Promise.resolve(),
      onMoveUnit: (unit, path) => {
        moves.push(path[path.length - 1]);
        unit.col = path[path.length - 1].col;
        unit.row = path[path.length - 1].row;
        return Promise.resolve();
      },
      onAttack: () => Promise.resolve(),
      onUnitDone: (unit) => {
        unit.hasActed = true;
      },
    });
    return { e, edric, moves };
  }

  it('a Canto rider strikes, then steps out of reach in the same turn', async () => {
    const { e, edric, moves } = await runPhase(['canto']);
    expect(moves).toHaveLength(2);
    const dist = Math.abs(e.col - edric.col) + Math.abs(e.row - edric.row);
    expect(dist).toBeGreaterThan(3);
    expect(e._lastAiDecision.cantoPath.at(-1)).toEqual({ col: e.col, row: e.row });
  });

  it('without Canto it stays beside its target', async () => {
    const { e, edric, moves } = await runPhase([]);
    expect(moves).toHaveLength(1);
    expect(Math.abs(e.col - edric.col) + Math.abs(e.row - edric.row)).toBe(1);
  });
});
