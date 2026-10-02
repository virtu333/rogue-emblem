// Per-battle status staves and siege tomes (docs/specs/dusk-pressure.md §2c,
// engine/CasterGear.js). Ways it can go wrong, one test each:
//   - the chance is still per spawn (a map with more casters gets more), or rolls on a
//     map with no eligible caster;
//   - Dusk gets Sleep, or staves before Act III, or siege before Act IV;
//   - a rung is not above the one below it, or Dusk sits next to Nightfall;
//   - the rolls move the map generator's Math.random draws (the map changes), or differ
//     between two generations of the same seed;
//   - more than maxPerBattle carry it, or one caster carries both;
//   - the harness or scene drops the gear (EnemySpawnGear);
//   - a saved run's old per-spawn config changes meaning;
//   - bad data validates.
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));

import { generateBattle } from '../src/engine/MapGenerator.js';
import {
  resolveDifficultyMode,
  validateDifficultyConfig,
  generateModifierSummary,
} from '../src/engine/DifficultyEngine.js';
import { assignCasterGear } from '../src/engine/CasterGear.js';
import { HeadlessBattle } from './harness/HeadlessBattle.js';
import { installSeed, restoreMathRandom } from '../sim/lib/SeededRNG.js';
import { loadGameData } from './testData.js';
import { HELP_TABS } from '../src/data/helpContent.js';

const data = loadGameData();
afterEach(() => restoreMathRandom());

const STAFF_CLASSES = ['Mage', 'Sage', 'Bishop'];
const SIEGE_CLASSES = ['Sage', 'Warlock', 'Dark Knight', 'Grandmaster'];
const modifiers = (rung) => resolveDifficultyMode(data.difficulty, rung).modifiers;

function gen(params, seed, gameData = data) {
  installSeed(seed);
  try {
    return generateBattle({ deployCount: 6, row: 3, ...params }, gameData);
  } finally {
    restoreMathRandom();
  }
}

// The data as main had it when MAIN below was captured: Act IV drew 30% promoted.
const dataAtCapture = (() => {
  const pools = structuredClone(data.enemies.pools);
  pools.act4.promotedShare = 0.3;
  return { ...data, enemies: { ...data.enemies, pools } };
})();

/** A synthetic garrison: `casters` of a class among fighters, at distinct tiles. */
function garrison(seed, casters, className = 'Mage', fighters = 4) {
  const spawns = [];
  for (let i = 0; i < fighters; i++) spawns.push({ className: 'Fighter', col: i, row: seed, level: 5 }); // prettier-ignore
  for (let i = 0; i < casters; i++) spawns.push({ className, col: 10 + i, row: seed, level: 5 }); // prettier-ignore
  return spawns;
}

const STAFF = (chance, extra = {}) => ({ perBattle: true, act3: chance, maxPerBattle: 1, ...extra }); // prettier-ignore

describe('the per-battle chance', () => {
  it('is the share of battles with a caster, however many casters stand there', () => {
    const N = 2000;
    for (const casters of [1, 4]) {
      let hit = 0;
      for (let seed = 0; seed < N; seed++) {
        const spawns = garrison(seed, casters);
        assignCasterGear(spawns, { act: 'act3', statusStaffConfig: STAFF(0.25) });
        const n = spawns.filter((s) => s.statusStaff).length;
        expect(n).toBeLessThanOrEqual(1);
        if (n) hit++;
      }
      // 0.25 ± 4 standard errors (sqrt(.25 × .75 / 2000) ≈ 0.0097).
      expect(Math.abs(hit / N - 0.25), `${casters} casters`).toBeLessThan(0.04);
    }
  });

  it('never rolls without an eligible caster, and a boss never carries it', () => {
    for (let seed = 0; seed < 200; seed++) {
      const spawns = garrison(seed, 0);
      spawns.push({ className: 'Sage', col: 20, row: seed, level: 9, isBoss: true });
      assignCasterGear(spawns, {
        act: 'act3',
        statusStaffConfig: STAFF(1),
        siegeWeaponConfig: { perBattle: true, act3: 1, maxPerBattle: 1, weaponName: 'Breachbolt' },
      });
      expect(spawns.some((s) => s.statusStaff || s.siegeWeapon)).toBe(false);
    }
  });

  it('gives each extra slot its own roll, up to maxPerBattle, never one caster twice', () => {
    let two = 0;
    let any = 0;
    for (let seed = 0; seed < 400; seed++) {
      const spawns = garrison(seed, 3, 'Sage');
      assignCasterGear(spawns, {
        act: 'act3',
        statusStaffConfig: STAFF(0.5, { maxPerBattle: 2 }),
        siegeWeaponConfig: { perBattle: true, act3: 1, maxPerBattle: 1, weaponName: 'Breachbolt' },
      });
      const siege = spawns.filter((s) => s.siegeWeapon);
      const staves = spawns.filter((s) => s.statusStaff);
      expect(siege).toHaveLength(1); // chance 1, max 1
      expect(staves.length).toBeLessThanOrEqual(2);
      expect(staves.some((s) => s.siegeWeapon)).toBe(false);
      if (staves.length === 2) two++;
      if (staves.length >= 1) any++;
    }
    // One or more at the chance (a miss ends the rolls); two at 0.5 × 0.5.
    expect(any / 400).toBeGreaterThan(0.4);
    expect(any / 400).toBeLessThan(0.6);
    expect(two / 400).toBeGreaterThan(0.15);
    expect(two / 400).toBeLessThan(0.35);
  });

  it('only rolls the kinds the rung allows', () => {
    const kinds = new Set();
    for (let seed = 0; seed < 300; seed++) {
      const spawns = garrison(seed, 2);
      assignCasterGear(spawns, { act: 'act3', statusStaffConfig: STAFF(1, { kinds: ['silence'] }) }); // prettier-ignore
      for (const s of spawns) if (s.statusStaff) kinds.add(s.statusStaff);
    }
    expect([...kinds]).toEqual(['silence']);
  });
});

describe('the rung ladder in difficulty.json', () => {
  const ACTS = ['act1', 'act2', 'act3', 'act4', 'finalBoss'];
  const chance = (rung, key, act) => Number(modifiers(rung)[key]?.[act] || 0);
  const firstAct = (rung, key) => ACTS.find((a) => chance(rung, key, a) > 0);

  it('Dusk: Silence only, from Act III; siege from Act IV', () => {
    const staff = modifiers('dusk').statusStaffConfig;
    expect(staff).toMatchObject({ perBattle: true, kinds: ['silence'] });
    expect(firstAct('dusk', 'statusStaffConfig')).toBe('act3');
    expect(firstAct('dusk', 'siegeWeaponConfig')).toBe('act4');
    expect(modifiers('normal').statusStaffConfig).toBeNull();
    expect(modifiers('normal').siegeWeaponConfig ?? null).toBeNull();
  });

  it('Dusk < Nightfall < Black Sun on every act, with a clear gap at Dusk', () => {
    for (const key of ['statusStaffConfig', 'siegeWeaponConfig']) {
      for (const act of ACTS) {
        const [d, h, l] = ['dusk', 'hard', 'lunatic'].map((r) => chance(r, key, act));
        expect(d, `${key} ${act}`).toBeLessThanOrEqual(h);
        expect(h, `${key} ${act}`).toBeLessThanOrEqual(l);
        if (h > 0) expect(h - d, `${key} ${act} gap`).toBeGreaterThanOrEqual(0.1 - 1e-9);
        if (l > 0) expect(l, `${key} ${act}`).toBeGreaterThan(h);
      }
      const order = ['dusk', 'hard', 'lunatic'].map((r) => ACTS.indexOf(firstAct(r, key)));
      expect(order[0], key).toBeGreaterThan(order[1]); // Dusk starts later
      expect(order[1], key).toBeGreaterThanOrEqual(order[2]);
    }
    expect(modifiers('dusk').statusStaffConfig.maxPerBattle).toBeLessThanOrEqual(
      modifiers('hard').statusStaffConfig.maxPerBattle,
    );
    expect(modifiers('lunatic').statusStaffConfig.maxPerBattle).toBe(2);
  });
});

describe('cures where staves appear', () => {
  it('every rung and act that fields status staves stocks cures in its shops', () => {
    for (const rung of ['normal', 'dusk', 'hard', 'lunatic']) {
      const m = modifiers(rung);
      for (const act of ['act1', 'act2', 'act3', 'act4', 'finalBoss']) {
        if (!(Number(m.statusStaffConfig?.[act]) > 0)) continue;
        expect(m.shopCureGating?.[act], `${rung} ${act}`).toBe(true);
      }
    }
  });
});

describe('in generated maps', () => {
  it('the rolls never move the map: the same garrison with or without them', () => {
    for (const rung of ['dusk', 'hard', 'lunatic']) {
      for (let seed = 1; seed <= 12; seed++) {
        const params = { ...modifiers(rung), difficultyId: rung, act: 'act4', objective: 'rout' };
        const withGear = gen(params, seed);
        const without = gen({ ...params, statusStaffConfig: null, siegeWeaponConfig: null }, seed);
        const strip = (bc) =>
          bc.enemySpawns.map(({ statusStaff: _a, siegeWeapon: _b, ...rest }) => rest);
        // Siege carriers never hold (HoldActivation), so compare off rout maps' layout too.
        expect(withGear.mapLayout).toEqual(without.mapLayout);
        expect(strip(withGear)).toEqual(strip(without));
        expect(gen(params, seed)).toEqual(withGear); // deterministic
      }
    }
  });

  it('gear goes only to eligible casters, at most the rung max, within its acts', () => {
    let staves = 0;
    let sieges = 0;
    for (const rung of ['dusk', 'hard', 'lunatic']) {
      const m = modifiers(rung);
      for (const act of ['act2', 'act3', 'act4']) {
        for (let seed = 1; seed <= 40; seed++) {
          const bc = gen({ ...m, difficultyId: rung, act, objective: 'rout' }, seed);
          const st = bc.enemySpawns.filter((s) => s.statusStaff);
          const sg = bc.enemySpawns.filter((s) => s.siegeWeapon);
          staves += st.length;
          sieges += sg.length;
          expect(st.every((s) => STAFF_CLASSES.includes(s.className) && !s.isBoss)).toBe(true);
          expect(sg.every((s) => SIEGE_CLASSES.includes(s.className) && !s.isBoss)).toBe(true);
          expect(st.length).toBeLessThanOrEqual(m.statusStaffConfig.maxPerBattle);
          expect(sg.length).toBeLessThanOrEqual(m.siegeWeaponConfig.maxPerBattle);
          if (!(m.statusStaffConfig[act] > 0)) expect(st, `${rung} ${act}`).toEqual([]);
          if (!(m.siegeWeaponConfig[act] > 0)) expect(sg, `${rung} ${act}`).toEqual([]);
          if (rung === 'dusk') expect(st.every((s) => s.statusStaff === 'silence')).toBe(true);
        }
      }
    }
    expect(staves).toBeGreaterThan(0);
    expect(sieges).toBeGreaterThan(0);
  });

  it('a saved run keeps its old per-spawn config and its old maps', () => {
    // The pre-ladder Black Sun config, as a run saved before PR 4 holds it.
    const legacy = {
      statusStaffConfig: { act1: 0, act2: 0.08, act3: 0.15, act4: 0.15, finalBoss: 0.25, maxPerBattle: 2 }, // prettier-ignore
      siegeWeaponConfig: { act1: 0, act2: 0, act3: 0.1, act4: 0.12, finalBoss: 0.15, maxPerBattle: 1, weaponName: 'Breachbolt' }, // prettier-ignore
    };
    // [spawn index, class, staff, siege] as origin/main (6dad6929, before PR 4) generates
    // them for these seeds (Act IV rout, deployCount 6, row 3): captured from main's code,
    // not this branch's. The old roll allows a Sage both (seed 40).
    const MAIN = {
      1: [],
      6: [[5, 'Mage', 'silence', null]],
      27: [[5, 'Sage', null, 'Breachbolt']],
      37: [[4, 'Mage', 'sleep', null], [7, 'Mage', 'sleep', null]],
      40: [[3, 'Sage', 'sleep', 'Breachbolt'], [4, 'Mage', 'sleep', null]],
      56: [[0, 'Dark Knight', null, 'Breachbolt']],
      88: [[3, 'Mage', 'silence', null], [6, 'Sage', null, 'Breachbolt']],
    }; // prettier-ignore
    for (const [seed, expected] of Object.entries(MAIN)) {
      const bc = gen({ act: 'act4', objective: 'rout', difficultyId: 'lunatic', ...legacy }, Number(seed), dataAtCapture); // prettier-ignore
      const flags = bc.enemySpawns
        .map((sp, i) => [i, sp.className, sp.statusStaff || null, sp.siegeWeapon || null])
        .filter((f) => f[2] || f[3]);
      expect(flags, `seed ${seed}`).toEqual(expected);
      // And nothing else about the garrison moves.
      const bare = gen({ act: 'act4', objective: 'rout', difficultyId: 'lunatic' }, Number(seed), dataAtCapture); // prettier-ignore
      const strip = (b) => b.enemySpawns.map(({ statusStaff: _a, siegeWeapon: _b, ...r }) => r);
      expect(strip(bc)).toEqual(strip(bare));
    }
  });
});

describe('carried into battle (EnemySpawnGear, harness as the scene)', () => {
  it('a staff caster holds its staff, a siege caster its Breachbolt with its own tome behind', () => {
    let staff = null;
    let siege = null;
    for (let seed = 1; seed <= 80 && !(staff && siege); seed++) {
      installSeed(seed);
      const battle = new HeadlessBattle(data, {
        ...modifiers('lunatic'),
        difficultyId: 'lunatic',
        act: 'act4',
        objective: 'rout',
        battleSeed: 300 + seed,
        deployCount: 6,
      });
      battle.init();
      restoreMathRandom();
      const spawns = battle.battleConfig.enemySpawns;
      for (const e of battle.enemyUnits) {
        const spawn = spawns.find((s) => s.col === e.col && s.row === e.row);
        if (!staff && spawn?.statusStaff) staff = { e, spawn };
        if (!siege && spawn?.siegeWeapon) siege = { e, spawn };
      }
    }
    expect(staff).not.toBeNull();
    expect(siege).not.toBeNull();
    const staffName = staff.spawn.statusStaff === 'sleep' ? 'Sleep Staff' : 'Silence Staff';
    expect(staff.e.statusStaff?.name).toBe(staffName);
    expect(siege.e.weapon?.name).toBe('Breachbolt');
    expect(siege.e.inventory.length).toBeGreaterThan(1); // its own weapon kept behind
  });
});

describe('data and summary', () => {
  it('the shipped data validates; bad per-battle configs do not', () => {
    expect(validateDifficultyConfig(data.difficulty).errors).toEqual([]);
    const bad = structuredClone(data.difficulty);
    bad.modes.dusk.statusStaffConfig.kinds = ['charm'];
    bad.modes.hard.statusStaffConfig.act3 = 1.5;
    bad.modes.lunatic.siegeWeaponConfig.maxPerBattle = -1;
    bad.modes.hard.siegeWeaponConfig.weaponName = '';
    const errors = validateDifficultyConfig(bad).errors.join('\n');
    expect(errors).toMatch(/dusk\.statusStaffConfig\.kinds/);
    expect(errors).toMatch(/hard\.statusStaffConfig\.act3/);
    expect(errors).toMatch(/lunatic\.siegeWeaponConfig\.maxPerBattle/);
    expect(errors).toMatch(/hard\.siegeWeaponConfig\.weaponName/);
  });

  it('the help page names the first rung that fields each staff', () => {
    const RUNG_LABEL = { dusk: 'Dusk and harder', hard: 'Nightfall/Black Sun only' };
    const firstRung = (kind) =>
      ['normal', 'dusk', 'hard', 'lunatic'].find((r) => {
        const cfg = modifiers(r).statusStaffConfig;
        return cfg && (cfg.kinds || ['sleep', 'silence']).includes(kind);
      });
    const texts = HELP_TABS.flatMap((tab) => tab.pages || [tab]).flatMap((page) =>
      (page.lines || []).map((l) => l.text),
    );
    expect(texts).toContain(`Sleep (${RUNG_LABEL[firstRung('sleep')]}):`);
    expect(texts).toContain(`Silence (${RUNG_LABEL[firstRung('silence')]}):`);
  });

  it('the summary names the staff kinds and the first act', () => {
    const lines = (id) => generateModifierSummary(data.difficulty.modes[id]);
    expect(lines('dusk')).toContain('Silence staves from Act 3+ (max 1/battle)');
    expect(lines('dusk')).toContain('Siege magic from Act 4+ (max 1/battle)');
    expect(lines('hard')).toContain('Status staves from Act 2+ (max 1/battle)');
    expect(lines('hard')).toContain('Siege magic from Act 3+ (max 1/battle)');
    expect(lines('lunatic')).toContain('Status staves from Act 2+ (max 2/battle)');
    expect(lines('normal').some((l) => /staves|Siege/.test(l))).toBe(false);
  });
});
