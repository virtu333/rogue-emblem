// Seize par on Dusk and harder (docs/specs/dusk-pressure.md §2b): the rung's offset and
// the floor that keeps an S reachable. Ways it can go wrong, one test each:
//   - a harder rung gets a looser seize par than an easier one on the same map (so its
//     boss enrages later);
//   - par − 3 (an S) falls below the turns a lord needs to walk to the throne;
//   - the floor lifts a rung above First Light, or reaches maps without an offset;
//   - the floor is not locked with the map.
import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));

import { generateBattle } from '../src/engine/MapGenerator.js';
import { resolveDifficultyMode } from '../src/engine/DifficultyEngine.js';
import { calculatePar } from '../src/engine/TurnBonusCalculator.js';
import { installSeed, restoreMathRandom } from '../sim/lib/SeededRNG.js';
import { loadGameData } from './testData.js';
import { HeadlessBattle } from './harness/HeadlessBattle.js';

const data = loadGameData();
const RUNGS = ['normal', 'dusk', 'hard', 'lunatic']; // easiest first
const LORD_MOV = 4; // Edric, Kira, Voss, Sera and Cael: the slowest lords (lords.json)

const modifiers = (rung) => resolveDifficultyMode(data.difficulty, rung).modifiers;

function gen(rung, act, seed, isBoss) {
  installSeed(seed);
  try {
    return generateBattle(
      {
        ...modifiers(rung),
        difficultyId: rung,
        act,
        objective: 'seize',
        isBoss,
        deployCount: 6,
        row: 5,
      },
      data,
    );
  } finally {
    restoreMathRandom();
  }
}

/** Par of map `bc` as rung `rung` would lock it (its inflation and offset). */
function parAs(bc, rung) {
  const m = modifiers(rung);
  const offset = m.objectiveParOffset?.seize;
  return calculatePar(
    {
      cols: bc.cols,
      rows: bc.rows,
      enemyCount: bc.enemySpawns.length,
      objective: 'seize',
      mapLayout: bc.mapLayout,
      terrainData: data.terrain,
      parBonus: bc.parBonus || 0,
      parInflation: m.parInflation,
      parOffset: offset || 0,
      // The floor depends on the layout alone; only a rung with an offset locks it.
      parFloor: offset ? bc.parFloor : undefined,
    },
    data.turnBonus,
    rung,
  );
}

const lockedPar = (bc, rung) =>
  calculatePar(
    {
      cols: bc.cols,
      rows: bc.rows,
      enemyCount: bc.enemySpawns.length,
      objective: 'seize',
      mapLayout: bc.mapLayout,
      terrainData: data.terrain,
      parBonus: bc.parBonus || 0,
      parInflation: bc.parInflation,
      parOffset: bc.parOffset,
      parFloor: bc.parFloor,
    },
    data.turnBonus,
    rung,
  );

/**
 * Turns an Infantry lord with MOV 4 needs to stand on the throne from the nearest
 * deploy tile, ignoring units: one bounded flood per turn from every tile reachable so
 * far (written independently of SeizeParFloor's search).
 */
function walkTurns(bc) {
  const cost = (c, r) => {
    const raw = data.terrain[bc.mapLayout[r][c]]?.moveCost?.Infantry;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : Infinity;
  };
  const key = (c, r) => `${c},${r}`;
  let frontier = new Set(bc.playerSpawns.map((s) => key(s.col, s.row)));
  const goal = key(bc.thronePos.col, bc.thronePos.row);
  for (let turn = 1; turn <= 60; turn++) {
    const spent = new Map([...frontier].map((k) => [k, 0]));
    const open = [...frontier];
    while (open.length) {
      const k = open.shift();
      const [c, r] = k.split(',').map(Number);
      for (const [dc, dr] of [
        [0, 1],
        [0, -1],
        [1, 0],
        [-1, 0],
      ]) {
        // prettier-ignore
        const nc = c + dc;
        const nr = r + dr;
        if (nc < 0 || nr < 0 || nc >= bc.cols || nr >= bc.rows) continue;
        const total = spent.get(k) + cost(nc, nr);
        const nk = key(nc, nr);
        if (total > LORD_MOV || total >= (spent.get(nk) ?? Infinity)) continue;
        spent.set(nk, total);
        open.push(nk);
      }
    }
    if (spent.has(goal)) return turn;
    frontier = new Set(spent.keys());
  }
  return null;
}

const MAPS = [];
for (const act of ['act1', 'act2', 'act3', 'act4']) {
  for (const isBoss of [false, true]) for (let seed = 1; seed <= 10; seed++) MAPS.push({ act, isBoss, seed }); // prettier-ignore
}
MAPS.push(
  ...Array.from({ length: 6 }, (_, i) => ({ act: 'finalBoss', isBoss: true, seed: i + 1 })),
);

describe('seize par by rung', () => {
  it('never loosens on a harder rung: First Light ≥ Dusk ≥ Nightfall ≥ Black Sun', () => {
    let checked = 0;
    let tighter = 0;
    for (const { act, isBoss, seed } of MAPS) {
      const bc = gen('dusk', act, seed, isBoss);
      if (bc.objective !== 'seize') continue;
      const pars = RUNGS.map((rung) => parAs(bc, rung));
      const label = `${act}${isBoss ? ' boss' : ''} seed ${seed}: ${pars.join(' / ')}`;
      for (let i = 1; i < pars.length; i++) expect(pars[i], label).toBeLessThanOrEqual(pars[i - 1]);
      // The boss enrages at min(12, par + 2): never later on a harder rung.
      const enrage = pars.map((p) => Math.min(12, p + 2));
      for (let i = 1; i < enrage.length; i++)
        expect(enrage[i], label).toBeLessThanOrEqual(enrage[i - 1]);
      if (pars[3] < pars[0]) tighter++;
      checked++;
    }
    expect(checked).toBeGreaterThan(60);
    expect(tighter).toBeGreaterThan(0); // the offsets still bite
  });

  it('holds for any raw par: every rung offset keeps the order (small and large maps)', () => {
    // A one-row strip of plains, sized to sweep the raw par; no floor.
    for (let cols = 4; cols <= 40; cols++) {
      for (const enemies of [1, 4, 9, 16]) {
        const bc = {
          cols,
          rows: 4,
          enemySpawns: Array(enemies).fill({}),
          mapLayout: Array.from({ length: 4 }, () => Array(cols).fill(0)),
          parBonus: 0,
        };
        const pars = RUNGS.map((rung) => parAs(bc, rung));
        for (let i = 1; i < pars.length; i++)
          expect(pars[i], `${cols}x4, ${enemies}: ${pars}`).toBeLessThanOrEqual(pars[i - 1]);
      }
    }
  });
});

describe('the seize par floor', () => {
  it('keeps an S within reach of a lord who walks straight to the throne', () => {
    let floored = 0;
    let maps = 0;
    for (const rung of ['dusk', 'hard', 'lunatic']) {
      for (const { act, isBoss, seed } of MAPS) {
        const bc = gen(rung, act, seed, isBoss);
        if (bc.objective !== 'seize') continue;
        maps++;
        const label = `${rung} ${act}${isBoss ? ' boss' : ''} seed ${seed}`;
        const walk = walkTurns(bc);
        expect(walk, label).not.toBeNull();
        // Locked with the map: the walk, 3 turns for an S, 1 for the boss.
        expect(bc.parFloor, label).toBe(walk + 4);
        const par = lockedPar(bc, rung);
        const firstLight = parAs(bc, 'normal');
        expect(par, label).toBeGreaterThanOrEqual(Math.min(walk + 4, firstLight));
        expect(par, label).toBeLessThanOrEqual(firstLight);
        // An S (par − 3) leaves the walk plus a turn for the boss, unless First Light's
        // own par does not.
        if (firstLight - 3 >= walk + 1) expect(par - 3, label).toBeGreaterThanOrEqual(walk + 1);
        const unfloored = calculatePar(
          { ...bcParams(bc), parFloor: undefined },
          data.turnBonus,
          rung,
        );
        if (par > unfloored) floored++;
      }
    }
    expect(maps).toBeGreaterThan(150);
    expect(floored).toBeGreaterThan(0); // some maps needed it
  });

  it('only a rung with a seize offset locks a floor; it never reaches rout or First Light', () => {
    for (let seed = 1; seed <= 6; seed++) {
      expect(gen('normal', 'act2', seed, true).parFloor).toBeUndefined();
      installSeed(seed);
      const rout = generateBattle(
        {
          ...modifiers('hard'),
          difficultyId: 'hard',
          act: 'act2',
          objective: 'rout',
          deployCount: 6,
        },
        data,
      );
      restoreMathRandom();
      expect(rout.parFloor).toBeUndefined();
    }
  });

  it('the harness (as BattleScene) rates against the locked floor', () => {
    let floored = 0;
    for (let seed = 1; seed <= 40 && floored < 2; seed++) {
      installSeed(seed);
      const battle = new HeadlessBattle(data, {
        ...modifiers('lunatic'),
        difficultyId: 'lunatic',
        act: 'act1',
        objective: 'seize',
        battleSeed: 700 + seed,
        deployCount: 6,
      });
      battle.init();
      restoreMathRandom();
      const bc = { ...battle.battleConfig, enemySpawns: battle.enemyUnits };
      expect(battle.turnPar).toBe(lockedPar(bc, 'lunatic'));
      const unfloored = calculatePar({ ...bcParams(bc), parFloor: undefined }, data.turnBonus, 'lunatic'); // prettier-ignore
      if (battle.turnPar > unfloored) floored++;
    }
    expect(floored).toBeGreaterThan(0);
  });

  it('a floor above the First Light par stops there', () => {
    const bc = {
      cols: 8,
      rows: 8,
      enemySpawns: Array(4).fill({}),
      mapLayout: Array.from({ length: 8 }, () => Array(8).fill(0)),
      parBonus: 0,
    };
    const firstLight = parAs(bc, 'normal');
    const dusk = calculatePar({ ...bcParams(bc), parOffset: -3, parFloor: 99, parInflation: 2 }, data.turnBonus, 'dusk'); // prettier-ignore
    expect(dusk).toBe(firstLight);
  });
});

function bcParams(bc) {
  return {
    cols: bc.cols,
    rows: bc.rows,
    enemyCount: bc.enemySpawns.length,
    objective: 'seize',
    mapLayout: bc.mapLayout,
    terrainData: data.terrain,
    parBonus: bc.parBonus || 0,
    parInflation: bc.parInflation,
    parOffset: bc.parOffset,
    parFloor: bc.parFloor,
  };
}
