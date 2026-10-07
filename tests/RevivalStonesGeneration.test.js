// Who carries Revival Stones (docs/specs/phase3.md 3D): difficulty.json `revivalStones` per
// rung, written into the boss spawn at map generation (so a locked map keeps it), put on
// the unit by the shared spawn gear, never on the Entity, and 0 for anything older.
import { describe, expect, it } from 'vitest';
import { generateBattle } from '../src/engine/MapGenerator.js';
import {
  generateModifierSummary,
  resolveDifficultyMode,
  validateDifficultyConfig,
} from '../src/engine/DifficultyEngine.js';
import { RunManager } from '../src/engine/RunManager.js';
import { applyEnemySpawnGear } from '../src/engine/EnemySpawnGear.js';
import {
  REVIVAL_STONE_KINDS,
  applyRevivalStones,
  hasRevivalStones,
  revivalStoneCount,
  revivalStoneKind,
  revivalStonesFor,
} from '../src/engine/RevivalStones.js';
import { installSeed, restoreMathRandom } from '../sim/lib/SeededRNG.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const RUNGS = ['normal', 'dusk', 'hard', 'lunatic'];

// The spec's table (docs/specs/phase3.md "Who has stones"), written out by hand.
const EXPECTED = {
  normal: { actBoss: 0, emperor: 0, lieutenant: 0, eliteCaptain: 0 },
  dusk: { actBoss: 0, emperor: 1, lieutenant: 0, eliteCaptain: 0 },
  hard: { actBoss: 1, emperor: 1, lieutenant: 0, eliteCaptain: 0 },
  lunatic: { actBoss: 1, emperor: 2, lieutenant: 0, eliteCaptain: 1 },
};

// Distinct numbers, so a mapping mix-up between kinds shows.
const TABLE = { actBoss: 3, emperor: 5, lieutenant: 7, eliteCaptain: 2 };

function withSeed(seed, fn) {
  installSeed(seed);
  try {
    return fn();
  } finally {
    restoreMathRandom();
  }
}

const bossOf = (config) => config.enemySpawns.find((s) => s.isBoss);
const generate = (params, seed = 1) =>
  withSeed(seed, () => generateBattle({ objective: 'seize', deployCount: 6, ...params }, data));

describe('difficulty.json revivalStones', () => {
  it('every rung names the four kinds, and the numbers are the spec’s table', () => {
    for (const id of RUNGS) {
      const table = resolveDifficultyMode(data.difficulty, id).modifiers.revivalStones;
      expect(Object.keys(table).sort(), id).toEqual([...REVIVAL_STONE_KINDS].sort());
      expect(table, id).toEqual(EXPECTED[id]);
    }
  });

  it('validates, and refuses a rung that forgets the key or writes a bad count', () => {
    expect(validateDifficultyConfig(data.difficulty)).toEqual({ valid: true, errors: [] });
    const broken = (patch) => {
      const config = structuredClone(data.difficulty);
      patch(config.modes.hard);
      return validateDifficultyConfig(config);
    };
    expect(broken((m) => delete m.revivalStones).errors).toContain(
      'modes.hard.revivalStones must be an object of stone counts',
    );
    expect(broken((m) => delete m.revivalStones.emperor).errors).toContain(
      'modes.hard.revivalStones.emperor must be a non-negative integer',
    );
    expect(broken((m) => (m.revivalStones.actBoss = -1)).errors).toContain(
      'modes.hard.revivalStones.actBoss must be a non-negative integer',
    );
    expect(broken((m) => (m.revivalStones.lieutenant = 1.5)).errors).toContain(
      'modes.hard.revivalStones.lieutenant must be a non-negative integer',
    );
    expect(broken((m) => (m.revivalStones.entity = 1)).errors).toContain(
      'modes.hard.revivalStones.entity is not a stone kind',
    );
  });

  it('the difficulty screen says what a rung’s bosses carry, and says nothing on First Light', () => {
    const lines = (id) =>
      generateModifierSummary(resolveDifficultyMode(data.difficulty, id).modifiers).filter((l) =>
        l.startsWith('Revival Stones'),
      );
    expect(lines('normal')).toEqual([]);
    expect(lines('dusk')).toEqual(['Revival Stones (a boss refills when felled): the Emperor 1']);
    expect(lines('lunatic')).toEqual([
      'Revival Stones (a boss refills when felled): act bosses 1, the Emperor 2, elite captains 1',
    ]);
  });

  it('the battle params carry the rung’s table, and a run saved before them carries none', () => {
    const node = { id: 'n1', type: 'boss', battleParams: { act: 'act4', objective: 'seize' } };
    for (const id of RUNGS) {
      const rm = new RunManager(data);
      rm.startRun({ difficultyId: id });
      const params = rm.getBattleParams(node);
      if (hasRevivalStones(EXPECTED[id])) expect(params.revivalStones, id).toEqual(EXPECTED[id]);
      else expect(params.revivalStones, id).toBeUndefined();
    }
    const rm = new RunManager(data);
    rm.startRun({ difficultyId: 'lunatic' });
    const saved = JSON.parse(JSON.stringify(rm.toJSON()));
    delete saved.difficultyModifiers.revivalStones;
    const restored = RunManager.fromJSON(saved, data);
    expect(restored.getBattleParams(node).revivalStones).toBeUndefined();
  });
});

describe('the spawn kind', () => {
  it('an act boss, the Emperor, the Lieutenant, an elite captain; never the Entity', () => {
    expect(revivalStoneKind({ act: 'act1' })).toBe('actBoss');
    expect(revivalStoneKind({ act: 'act3' })).toBe('actBoss');
    expect(revivalStoneKind({ act: 'act4' })).toBe('emperor');
    expect(revivalStoneKind({ act: 'finalBoss' })).toBe('lieutenant');
    expect(revivalStoneKind({ act: 'act2', isEliteCaptain: true })).toBe('eliteCaptain');
    expect(revivalStoneKind({ act: 'finalBoss', bossDef: { isEntity: true } })).toBeNull();
    expect(revivalStoneKind({ act: 'postAct' })).toBeNull();
  });

  it('counts read the table, and anything missing is 0', () => {
    expect(revivalStonesFor(TABLE, 'emperor')).toBe(5);
    expect(revivalStonesFor(TABLE, null)).toBe(0);
    expect(revivalStonesFor(null, 'emperor')).toBe(0);
    expect(revivalStonesFor({ emperor: -3 }, 'emperor')).toBe(0);
    expect(revivalStonesFor({ emperor: 'x' }, 'emperor')).toBe(0);
  });
});

describe('MapGenerator writes the count into the boss spawn', () => {
  for (const [act, kind] of [
    ['act1', 'actBoss'],
    ['act2', 'actBoss'],
    ['act3', 'actBoss'],
    ['act4', 'emperor'],
  ]) {
    it(`${act}'s boss is a ${kind}`, () => {
      for (let seed = 1; seed <= 4; seed++) {
        const boss = bossOf(generate({ act, isBoss: true, revivalStones: TABLE }, seed));
        expect(boss.revivalStones, `${act} seed ${seed}`).toBe(TABLE[kind]);
      }
    });
  }

  it('the Lieutenant (First Light and Dusk’s last boss) is a lieutenant', () => {
    for (const difficultyId of ['normal', 'dusk']) {
      const boss = bossOf(
        generate({ act: 'finalBoss', isBoss: true, difficultyId, revivalStones: TABLE }),
      );
      expect(boss.name).toBe('The Lieutenant');
      expect(boss.revivalStones).toBe(TABLE.lieutenant);
    }
  });

  it('the Entity (Nightfall and Black Sun) never carries stones', () => {
    for (const difficultyId of ['hard', 'lunatic']) {
      for (let seed = 1; seed <= 4; seed++) {
        const boss = bossOf(
          generate({ act: 'finalBoss', isBoss: true, difficultyId, revivalStones: TABLE }, seed),
        );
        expect(boss.isEntity, `${difficultyId} seed ${seed}`).toBe(true);
        expect('revivalStones' in boss).toBe(false);
      }
    }
  });

  it('an elite captain on a seize map takes the elite entry, not the act boss one', () => {
    for (let seed = 1; seed <= 4; seed++) {
      const config = generate({ act: 'act2', isElite: true, revivalStones: TABLE }, seed);
      expect(bossOf(config).revivalStones, `seed ${seed}`).toBe(TABLE.eliteCaptain);
    }
  });

  it('only the boss carries it, and the rest of the map is untouched', () => {
    const plain = generate({ act: 'act3', isBoss: true }, 3);
    const stoned = generate({ act: 'act3', isBoss: true, revivalStones: TABLE }, 3);
    const strip = (spawns) => spawns.map(({ revivalStones: _s, ...rest }) => rest);
    expect(strip(stoned.enemySpawns)).toEqual(plain.enemySpawns);
    expect(stoned.enemySpawns.filter((s) => s.revivalStones > 0)).toHaveLength(1);
    expect(stoned.mapLayout).toEqual(plain.mapLayout);
  });

  it('a zero table, no table, or a rung with none leaves the spawn exactly as it was', () => {
    const plain = generate({ act: 'act2', isBoss: true }, 5);
    const zero = generate({ act: 'act2', isBoss: true, revivalStones: EXPECTED.normal }, 5);
    expect(zero.enemySpawns).toEqual(plain.enemySpawns);
    expect(bossOf(plain)).not.toHaveProperty('revivalStones');
  });

  it('a config generated for each rung carries what the spec’s table says', () => {
    for (const id of RUNGS) {
      const table = resolveDifficultyMode(data.difficulty, id).modifiers.revivalStones;
      const lastAct = id === 'dusk' ? 'act4' : 'act1';
      const boss = bossOf(
        generate({ act: lastAct, isBoss: true, difficultyId: id, revivalStones: table }),
      );
      const kind = revivalStoneKind({ act: lastAct });
      expect(boss.revivalStones ?? 0, id).toBe(EXPECTED[id][kind]);
    }
  });
});

describe('the unit built from a spawn', () => {
  const unit = () => ({ name: 'Warchief', stats: { HP: 30 }, currentHP: 30 });

  it('a boss spawn gives remaining and max stones', () => {
    const u = applyRevivalStones(unit(), { isBoss: true, revivalStones: 2 });
    expect([u.revivalStones, u.revivalStonesMax]).toEqual([2, 2]);
    expect(revivalStoneCount(u)).toEqual({ remaining: 2, max: 2 });
  });

  it('the shared spawn gear does it, so the scene and the harness agree', () => {
    const u = applyEnemySpawnGear(unit(), { isBoss: true, revivalStones: 1 }, { weapons: [] });
    expect([u.revivalStones, u.revivalStonesMax]).toEqual([1, 1]);
  });

  it('the Entity, a non-boss spawn, and a spawn from before stones carry none', () => {
    for (const spawn of [
      { isBoss: true, isEntity: true, revivalStones: 2 },
      { isBoss: false, revivalStones: 2 },
      { isBoss: true },
      { isBoss: true, revivalStones: 0 },
      { isBoss: true, revivalStones: 'many' },
    ]) {
      const u = applyRevivalStones(unit(), spawn);
      expect(u).not.toHaveProperty('revivalStones');
      expect(u).not.toHaveProperty('revivalStonesMax');
      expect(revivalStoneCount(u)).toEqual({ remaining: 0, max: 0 });
    }
  });
});
