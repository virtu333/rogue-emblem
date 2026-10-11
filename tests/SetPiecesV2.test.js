// Set pieces v2 (docs/specs/act-v-descent.md §9.2): set pieces on battle, elite and boss nodes,
// with a boss slot, named units, `defeat` targets, authored posts and the Vigil's sigils.
//
// Ways this goes wrong:
//   - a boss slot takes other than two draws (every later slot and wave moves), or seats a
//     boss by a rule the template path does not use (filter, level, stones, name);
//   - a seize set piece's throne is not where its boss stands (or not mirrored with it), or the
//     map carries no thronePos, so the Seize command and the throne clamp read nothing;
//   - a boss node's set piece takes a Hunted wave;
//   - the objectives model or the Vigil never reaches the config, or the mirror flips the map
//     and units but not the sigils and circles;
//   - a named or targeted unit loses its name or authored id between spawn and unit;
//   - the validator lets a broken seize, defeat, target, sigil, circle, act or map size ship;
//   - an event's set piece conversion changes (its draws, its fog), or the Descent's options
//     still touch Math.random;
//   - an unknown set piece falls back to a template objective that does not exist.
import { describe, expect, it, vi } from 'vitest';
import {
  buildSetPieceBattle,
  validateSetPieceAt,
  validateSetPiecesConfig,
} from '../src/engine/SetPieces.js';
import { validateEventsConfig } from '../src/engine/EventValidation.js';
import { DIFFICULTY_IDS } from '../src/engine/DifficultyEngine.js';
import { generateSeededBattle } from '../src/engine/BattleScout.js';
import { validateBattleConfig } from '../src/engine/MapGenerator.js';
import { convertNodeToSetPieceBattle } from '../src/engine/NodeMapGenerator.js';
import { applySpawnLoadout } from '../src/engine/EnemySpawnGear.js';
import { holdsPost } from '../src/engine/SiegeArtillery.js';
import { createSeededRng } from '../src/engine/ReinforcementScheduler.js';
import { loadGameData } from './testData.js';
import { DEFEAT_FIXTURE, GATE_FIXTURE, SEIZE_FIXTURE, withSetPieces } from './setPieceFixtures.js';

const base = loadGameData();
const data = withSetPieces(base, SEIZE_FIXTURE, DEFEAT_FIXTURE, GATE_FIXTURE);
const THRONE = base.terrain.findIndex((t) => t.name === 'Throne');

/** A random that hands out the given values in order and fails loudly past the end. */
function scripted(values) {
  const queue = [...values];
  const random = () => {
    if (queue.length === 0) throw new Error('random drawn more often than the test expects');
    return queue.shift();
  };
  random.left = () => queue.length;
  return random;
}

describe('buildSetPieceBattle: the boss slot', () => {
  it('takes its two draws; the class draw is the seat roll; the boss stands on its slot', () => {
    const rolls = [];
    // mirror, boss (class, level), guard (class, level), archer (class, level)
    const random = scripted([0.9, 0.37, 0.8, 0.5, 0.5, 0.1, 0.1]);
    const built = buildSetPieceBattle({
      setPiece: SEIZE_FIXTURE,
      act: 'act1',
      levelRange: [2, 3],
      deployCount: 2,
      classes: base.classes,
      terrain: base.terrain,
      random,
      seatBoss: (roll) => {
        rolls.push(roll);
        return { className: 'Cavalier', level: 3, name: 'Iron Captain', isBoss: true };
      },
    });
    expect(random.left()).toBe(0);
    expect(rolls).toEqual([0.37]);
    expect(built.enemySpawns[0]).toEqual({
      className: 'Cavalier',
      level: 3,
      name: 'Iron Captain',
      isBoss: true,
      col: 5,
      row: 3,
    });
    // The named guard: its name and authored id ride the spawn; the Nightfall archer is out.
    expect(built.enemySpawns[1]).toMatchObject({
      className: 'Fighter',
      name: 'Gate Guard',
      authoredId: 'gate_guard',
      isBoss: false,
    });
    expect(built.enemySpawns).toHaveLength(2);
    expect(built.thronePos).toEqual({ col: 5, row: 3 });
  });

  it('without a seat the boss slot seats nobody, and still takes its draws', () => {
    const random = scripted([0.9, 0.1, 0.1, 0.5, 0.5, 0.1, 0.1]);
    const built = buildSetPieceBattle({
      setPiece: SEIZE_FIXTURE,
      levelRange: [2, 3],
      classes: base.classes,
      terrain: base.terrain,
      random,
    });
    expect(random.left()).toBe(0);
    expect(built.enemySpawns.some((s) => s.isBoss)).toBe(false);
  });

  it('the mirror flips the throne, the boss, the sigils and the circles with the map', () => {
    const build = (mirrorRoll, piece) =>
      buildSetPieceBattle({
        setPiece: piece,
        levelRange: [2, 3],
        classes: base.classes,
        terrain: base.terrain,
        random: scripted([mirrorRoll, ...Array(20).fill(0.5)]),
        seatBoss: () => ({ className: 'Fighter', level: 3, name: 'B', isBoss: true }),
      });
    const flat = build(0.9, SEIZE_FIXTURE);
    const flipped = build(0.1, SEIZE_FIXTURE);
    expect(flipped.mirrored).toBe(true);
    expect(flipped.thronePos).toEqual({ col: 8 - 1 - 5, row: 3 });
    expect(flipped.mapLayout[3][2]).toBe(THRONE);
    expect(flipped.enemySpawns[0]).toMatchObject({ col: 2, row: 3, isBoss: true });
    expect(flat.thronePos).toEqual({ col: 5, row: 3 });

    const vigil = build(0.9, DEFEAT_FIXTURE).vigil;
    const mirrored = build(0.1, DEFEAT_FIXTURE);
    expect(vigil).toEqual({
      sigils: [
        { id: 'sigil_a', target: 'voice_a', col: 6, row: 1 },
        { id: 'sigil_b', target: 'voice_b', col: 6, row: 5 },
      ],
      circles: [
        { id: 'circle_a', voice: 'voice_a', col: 4, row: 0 },
        { id: 'circle_b', voice: 'voice_b', col: 4, row: 6 },
      ],
    });
    expect(mirrored.vigil).toEqual({
      sigils: [
        { id: 'sigil_a', target: 'voice_a', col: 1, row: 1 },
        { id: 'sigil_b', target: 'voice_b', col: 1, row: 5 },
      ],
      circles: [
        { id: 'circle_a', voice: 'voice_a', col: 3, row: 0 },
        { id: 'circle_b', voice: 'voice_b', col: 3, row: 6 },
      ],
    });
    // Each Voice still stands on its own sigil, mirrored or not.
    for (const built of [build(0.9, DEFEAT_FIXTURE), mirrored])
      for (const sigil of built.vigil.sigils) {
        const voice = built.enemySpawns.find((s) => s.authoredId === sigil.target);
        expect({ col: voice.col, row: voice.row }).toEqual({ col: sigil.col, row: sigil.row });
      }
  });
});

describe('generateSetPieceLayout: v2 configs', () => {
  const params = (setPiece, extra = {}) => ({
    act: 'act2',
    objective: 'rout',
    setPiece,
    difficultyId: 'normal',
    deployCount: 3,
    ...extra,
  });

  it('a seize set piece seats the act boss on its authored throne, as the template rule would', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const config = generateSeededBattle(
        params('fixture_throne', { objective: 'seize', isBoss: true, bossLevelBonus: 2 }),
        data,
        seed,
      );
      expect(config.objective).toBe('seize');
      expect(config.mapLayout[config.thronePos.row][config.thronePos.col]).toBe(THRONE);
      const boss = config.enemySpawns.find((s) => s.isBoss);
      expect({ col: boss.col, row: boss.row }).toEqual(config.thronePos);
      const def = base.enemies.bosses.act2.find((b) => b.name === boss.name);
      expect(def, boss.name).toBeTruthy();
      expect(boss).toMatchObject({ className: def.className, level: def.level + 2 });
      expect(validateBattleConfig(config, data, { expectedPlayerSpawns: 3 })).toEqual([]);
    }
  });

  it("an elite node's seize set piece seats an elite captain", () => {
    const config = generateSeededBattle(
      params('fixture_throne', { objective: 'seize', isElite: true, levelRange: [6, 9] }),
      data,
      4,
    );
    const boss = config.enemySpawns.find((s) => s.isBoss);
    expect(base.enemies.elites.act2.map((e) => e.name)).toContain(boss.name);
  });

  it('a boss map takes no Hunted wave; an event map still does', () => {
    const huntedWave = { turn: 3, count: [1, 2], xpMultiplier: 0.5 };
    const boss = generateSeededBattle(
      params('fixture_throne', { objective: 'seize', isBoss: true, huntedWave }),
      data,
      2,
    );
    expect(boss.reinforcements?.hunted).toBeUndefined();
    const event = generateSeededBattle(params('fixture_throne', { huntedWave }), data, 2);
    expect(event.reinforcements.hunted).toMatchObject({ turn: 3 });
  });

  it('a defeat set piece writes its objectives and Vigil; its legacy string stays rout', () => {
    const config = generateSeededBattle(params('fixture_vigil'), data, 6);
    expect(config.objective).toBe('rout');
    expect(config.objectives).toEqual(DEFEAT_FIXTURE.objectives);
    expect(config.objectives).not.toBe(DEFEAT_FIXTURE.objectives);
    expect(config.vigil.sigils).toHaveLength(2);
    expect(config.vigil.circles).toHaveLength(2);
    const voices = config.enemySpawns.filter((s) => s.authoredId?.startsWith('voice_'));
    expect(voices.map((v) => v.name).sort()).toEqual(['Voice of the Binding', 'Voice of the Calling']); // prettier-ignore
    expect(voices.find((v) => v.authoredId === 'voice_a').aiMode).toBe('post');
    expect(voices.every((v) => !v.isBoss)).toBe(true);
    expect(validateBattleConfig(config, data, { expectedPlayerSpawns: 3 })).toEqual([]);
    // A config whose target has no spawn is refused.
    const broken = structuredClone(config);
    broken.enemySpawns = broken.enemySpawns.filter((s) => s.authoredId !== 'voice_b');
    expect(validateBattleConfig(broken, data).join('\n')).toMatch(/target "voice_b" has no spawn/);
  });

  it("a defeat map's par offset reads the defeat key, never the rout one", () => {
    const config = generateSeededBattle(
      params('fixture_vigil', { objectiveParOffset: { rout: -2, defeat: -1 } }),
      data,
      6,
    );
    expect(config.parOffset).toBe(-1);
    const none = generateSeededBattle(
      params('fixture_vigil', { objectiveParOffset: { rout: -2 } }),
      data,
      6,
    );
    expect(none.parOffset).toBeUndefined();
  });

  it('the gate seats its boss by name with its stones, and the target ref resolves', () => {
    const config = generateSeededBattle(
      {
        act: 'finalBoss',
        objective: 'rout',
        setPiece: 'fixture_gate',
        difficultyId: 'hard',
        isBoss: true,
        bossName: 'The Lieutenant',
        bossLevelBonus: 3,
        revivalStones: { actBoss: 1, emperor: 1, lieutenant: 2, eliteCaptain: 0 },
        deployCount: 3,
      },
      data,
      9,
    );
    expect(config.enemySpawns.find((s) => s.isBoss)).toMatchObject({
      name: 'The Lieutenant',
      level: 23,
      revivalStones: 2,
      col: 7,
      row: 3,
    });
    expect(validateBattleConfig(config, data)).toEqual([]);
  });

  it('a named spawn names its unit; an authored id rides too', () => {
    const enemy = { name: 'Mage', stats: {} };
    applySpawnLoadout(enemy, { name: 'Voice of the Calling', authoredId: 'voice_a' });
    expect(enemy).toMatchObject({ name: 'Voice of the Calling', authoredId: 'voice_a' });
    const plain = { name: 'Mage' };
    applySpawnLoadout(plain, { className: 'Mage' });
    expect(plain.name).toBe('Mage');
  });

  it("an authored post never walks: the previews' rule says so too", () => {
    expect(holdsPost({ faction: 'enemy', aiMode: 'post', currentHP: 5 })).toBe(true);
    expect(holdsPost({ faction: 'enemy', aiMode: 'guard', currentHP: 5 })).toBe(false);
  });

  it("an unknown set piece falls back to a template map on the templates' objective", () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const config = generateSeededBattle(
        params('no_such_place', { objective: 'defeat' }),
        data,
        1,
      );
      expect(config.objective).toBe('rout');
      expect(config.setPieceId).toBeUndefined();
      const seize = generateSeededBattle(params('no_such_place', { objective: 'seize' }), data, 1);
      expect(seize.objective).toBe('seize');
    } finally {
      warn.mockRestore();
    }
  });
});

describe('convertNodeToSetPieceBattle', () => {
  const unforced = { id: 'p', objective: 'rout', deploy: { max: 4 } };
  const forced = { ...unforced, fog: true };

  /** Run with a seeded Math.random, counting draws. */
  function withSeed(seed, fn) {
    const previous = Math.random;
    const rng = createSeededRng(seed);
    let draws = 0;
    Math.random = () => {
      draws++;
      return rng();
    };
    try {
      return { result: fn(), draws };
    } finally {
      Math.random = previous;
    }
  }

  it("an event's call is unchanged: the seed draw, then one fog roll unless the set piece forces fog", () => {
    const node = { id: 'act1_3_1', row: 3 };
    const { result, draws } = withSeed(42, () =>
      convertNodeToSetPieceBattle(structuredClone(node), 'act1', unforced),
    );
    expect(draws).toBe(2);
    // The seed is the first draw, exactly as rollBattleSeed takes it.
    const first = createSeededRng(42)();
    expect(result.battleParams.battleSeed).toBe(Math.floor(first * 0xffffffff) >>> 0);
    expect(result.battleParams).toMatchObject({ act: 'act1', objective: 'rout', setPiece: 'p', deployCap: 4, row: 3 }); // prettier-ignore
    expect(withSeed(42, () => convertNodeToSetPieceBattle({ row: 3 }, 'act1', forced)).draws).toBe(
      1,
    );
  });

  it('a keyed seed takes no seed draw; with a fixed fog nothing is drawn; forced fog wins', () => {
    const keyed = withSeed(5, () =>
      convertNodeToSetPieceBattle({ row: 1 }, 'finalBoss', unforced, { battleSeed: 1234 }),
    );
    expect(keyed.draws).toBe(1);
    expect(keyed.result.battleParams.battleSeed).toBe(1234);
    const silent = withSeed(5, () =>
      convertNodeToSetPieceBattle({ row: 1 }, 'finalBoss', unforced, { battleSeed: 7, fog: false }),
    );
    expect(silent.draws).toBe(0);
    expect(silent.result.fogEnabled).toBeUndefined();
    const forcedFog = withSeed(5, () =>
      convertNodeToSetPieceBattle({ row: 1 }, 'finalBoss', forced, { battleSeed: 7, fog: false }),
    );
    expect(forcedFog.draws).toBe(0);
    expect(forcedFog.result.fogEnabled).toBe(true);
  });
});

describe('validateSetPiecesConfig: v2 keys', () => {
  const deps = {
    terrain: base.terrain,
    classes: base.classes,
    weapons: base.weapons,
    difficulty: base.difficulty,
    enemies: base.enemies,
    events: { events: [] },
  };
  const validate = (fixture, mutate) => {
    const piece = structuredClone(fixture);
    mutate?.(piece);
    return validateSetPiecesConfig({ setPieces: [piece] }, deps).errors.join('\n');
  };

  it('accepts the fixtures and the shipped data', () => {
    for (const fixture of [SEIZE_FIXTURE, DEFEAT_FIXTURE, GATE_FIXTURE])
      expect(validate(fixture)).toBe('');
    expect(
      validateSetPiecesConfig(base.setPieces, { ...deps, events: base.events }).errors,
    ).toEqual([]);
  });

  it.each([
    // Seize
    ['a seize map with no throne', SEIZE_FIXTURE, (p) => (p.variants[0].map.legend.T = 'Plain'), /exactly one Throne \(has 0\)/], // prettier-ignore
    ['a seize map with two thrones', SEIZE_FIXTURE, (p) => (p.variants[0].map.rows[0] = 'T . . . . . . .'), /exactly one Throne \(has 2\)/], // prettier-ignore
    ['a boss off the throne', SEIZE_FIXTURE, (p) => (p.variants[0].enemies[0].col = 4), /must stand on the Throne/], // prettier-ignore
    ['a seize map with no boss slot', SEIZE_FIXTURE, (p) => (p.variants[0].enemies[0] = { col: 5, row: 3, classes: ['Fighter'] }), /needs a boss slot/], // prettier-ignore
    ['a seize map with a captain', SEIZE_FIXTURE, (p) => (p.variants[0].enemies[1].captain = { name: 'C' }), /no captain/], // prettier-ignore
    // Boss slot
    ['two boss slots', SEIZE_FIXTURE, (p) => p.variants[0].enemies.push({ col: 6, row: 6, boss: true }), /more than one boss slot/], // prettier-ignore
    ['a boss slot with classes', SEIZE_FIXTURE, (p) => (p.variants[0].enemies[0].classes = ['Fighter']), /boss slot takes no "classes"/], // prettier-ignore
    ['a gated boss slot', SEIZE_FIXTURE, (p) => (p.variants[0].enemies[0].minRung = 'hard'), /boss slot takes no "minRung"/], // prettier-ignore
    // Names, ids, targets
    ['a long name', SEIZE_FIXTURE, (p) => (p.variants[0].enemies[1].name = 'x'.repeat(25)), /name is over 24/], // prettier-ignore
    ['a duplicate id', SEIZE_FIXTURE, (p) => (p.variants[0].enemies[2].id = 'gate_guard'), /id "gate_guard" is used twice/], // prettier-ignore
    ['a defeat map with no target', DEFEAT_FIXTURE, (p) => (p.objectives.primary[0].targets = []), /at least one target/], // prettier-ignore
    ['a target ref with no slot', DEFEAT_FIXTURE, (p) => p.objectives.primary[0].targets.push('voice_z'), /target "voice_z" names no slot/], // prettier-ignore
    ['a target slot no objective counts', DEFEAT_FIXTURE, (p) => (p.objectives.primary[0].targets = ['voice_a']), /target "voice_b" counts for no defeat objective/], // prettier-ignore
    ['a target with no name', DEFEAT_FIXTURE, (p) => delete p.variants[0].enemies[1].name, /a target needs a name/], // prettier-ignore
    ['a target with no id', DEFEAT_FIXTURE, (p) => delete p.variants[0].enemies[1].id, /a target needs an id/], // prettier-ignore
    ['a gated target', DEFEAT_FIXTURE, (p) => (p.variants[0].enemies[1].minRung = 'hard'), /a target is always in play/], // prettier-ignore
    ['a holding target', DEFEAT_FIXTURE, (p) => (p.variants[0].enemies[1].hold = 1), /a target never holds/], // prettier-ignore
    ['a Zombie target', DEFEAT_FIXTURE, (p) => (p.variants[0].enemies[1].classes = ['Zombie']), /cannot be a Zombie/], // prettier-ignore
    ['a defeat map whose legacy string is not rout', DEFEAT_FIXTURE, (p) => (p.objective = 'seize'), /objective must be "rout"/], // prettier-ignore
    ["'@boss' with no boss here", GATE_FIXTURE, (p) => (p.variants[0].enemies[0] = { col: 7, row: 3, classes: ['Fighter'] }), /"@boss" is a target but no boss slot/], // prettier-ignore
    // Vigil
    ['a sigil off its target', DEFEAT_FIXTURE, (p) => (p.variants[0].vigil.sigils[0].row = 2), /its target "voice_a" must stand on it/], // prettier-ignore
    ['a sigil naming no target', DEFEAT_FIXTURE, (p) => (p.variants[0].vigil.sigils[0].target = 'nobody'), /target "nobody" names no slot/], // prettier-ignore
    ['a circle on a wall', DEFEAT_FIXTURE, (p) => { p.variants[0].map.legend['#'] = 'Wall'; p.variants[0].map.rows[0] = '. . . . # . . .'; }, /Infantry unit cannot stand on \(4,0\)/], // prettier-ignore
    ['a circle the army cannot reach', DEFEAT_FIXTURE, (p) => { p.variants[0].map.legend['#'] = 'Wall'; p.variants[0].map.rows[0] = '. . . # . # . .'; p.variants[0].map.rows[1] = '. . . . # . F .'; }, /\(4,0\) cannot be reached/], // prettier-ignore
    ['a circle on a spawn', DEFEAT_FIXTURE, (p) => Object.assign(p.variants[0].vigil.circles[0], { col: 7, row: 0 }), /is a spawn: a circle starts empty/], // prettier-ignore
    ['a circle with an unknown voice', DEFEAT_FIXTURE, (p) => (p.variants[0].vigil.circles[0].voice = 'nobody'), /voice "nobody" names no slot/], // prettier-ignore
    ['a duplicate vigil id', DEFEAT_FIXTURE, (p) => (p.variants[0].vigil.circles[0].id = 'sigil_a'), /id "sigil_a" is used twice/], // prettier-ignore
    // Acts and size
    ['an unknown act', GATE_FIXTURE, (p) => (p.acts = ['act9']), /"act9" is not an act/], // prettier-ignore
  ])('refuses %s', (_label, fixture, mutate, pattern) => {
    expect(validate(fixture, mutate)).toMatch(pattern);
  });

  it('a map may be 16x14 only for a set piece fought only in Act V', () => {
    const deep = (acts) =>
      validate(GATE_FIXTURE, (p) => {
        p.acts = acts;
        p.variants[0].map.rows = Array.from({ length: 14 }, () => Array(16).fill('.').join(' '));
      });
    expect(deep(['finalBoss'])).toBe('');
    expect(deep(['act4', 'finalBoss'])).toMatch(/map is 16x14; it must be 6x6 to 16x12/);
    expect(
      validate(GATE_FIXTURE, (p) => {
        p.variants[0].map.rows = Array.from({ length: 15 }, () => Array(16).fill('.').join(' '));
      }),
    ).toMatch(/map is 16x15; it must be 6x6 to 16x14/);
  });

  it('a set piece with acts is checked there with no event naming it', () => {
    // The gate's Sage is fine in Act V; a Necromancer in Act III breaks Dusk's gate.
    expect(
      validate(GATE_FIXTURE, (p) => {
        p.acts = ['act3'];
        p.variants[0].enemies[1].classes = ['Necromancer'];
      }),
    ).toMatch(/Necromancer in act3 breaks dusk's gate \(act4\)/);
  });

  it('validateSetPieceAt: one (set piece, act, rung) for a route validator', () => {
    const pinned = { bossName: 'The Lieutenant' };
    expect(validateSetPieceAt(GATE_FIXTURE, 'finalBoss', 'hard', deps, pinned)).toEqual([]);
    expect(validateSetPieceAt(GATE_FIXTURE, 'act2', 'hard', deps).join('\n')).toMatch(
      /fixture_gate is not fought in act2/,
    );
    // A boss slot needs a boss to seat in the act.
    expect(validateSetPieceAt(GATE_FIXTURE, 'postAct', 'hard', deps).join('\n')).toMatch(
      /boss slot has no boss to seat in postAct/,
    );
  });
});

// The review of #317: a boss slot is the battle's seat, so it must never seat the Entity (one
// tile holds no 3x3 form, gear or finale), and no event may fight it (a mid-act fight would seat
// the act's real boss, stones and all).
describe('the boss slot: never the Entity, never an event', () => {
  const deps = {
    terrain: base.terrain,
    classes: base.classes,
    weapons: base.weapons,
    difficulty: base.difficulty,
    enemies: base.enemies,
  };
  // The rungs whose draw for Act V's seat may be the Entity, read off enemies.json.
  const entityRungs = DIFFICULTY_IDS.filter((rung) =>
    base.enemies.bosses.finalBoss.some(
      (b) => b.isEntity === true && (!b.difficultyFilter || b.difficultyFilter.includes(rung)),
    ),
  );
  const ENTITY = /its boss slot could seat the Entity in finalBoss on (\w+)/;

  it('an unpinned seat in Act V is refused exactly where the draw could be the Entity', () => {
    expect(entityRungs).toEqual(['hard', 'lunatic']);
    for (const rung of DIFFICULTY_IDS) {
      const errors = validateSetPieceAt(GATE_FIXTURE, 'finalBoss', rung, deps).join('\n');
      if (entityRungs.includes(rung)) expect(errors, rung).toMatch(ENTITY);
      else expect(errors, rung).toBe('');
    }
    // An elite node's seat draws the act's captains, and falls back to its bosses only when the
    // act has none: refused exactly when that fallback could be the Entity.
    const eliteErrors = validateSetPieceAt(GATE_FIXTURE, 'finalBoss', 'hard', deps, {
      isElite: true,
    }).join('\n');
    const actHasCaptains = (base.enemies.elites?.finalBoss || []).length > 0;
    if (actHasCaptains) expect(eliteErrors).toBe('');
    else expect(eliteErrors).toMatch(ENTITY);
  });

  it('a name pins the seat: another boss passes on every rung, the Entity never does', () => {
    for (const rung of DIFFICULTY_IDS) {
      expect(
        validateSetPieceAt(GATE_FIXTURE, 'finalBoss', rung, deps, { bossName: 'The Lieutenant' }),
        rung,
      ).toEqual([]);
      expect(
        validateSetPieceAt(GATE_FIXTURE, 'finalBoss', rung, deps, {
          bossName: 'The Entity',
        }).join('\n'),
        rung,
      ).toMatch(ENTITY);
    }
    // A name the act does not have seats the draw's pick (SeatedBoss), so it pins nothing.
    expect(
      validateSetPieceAt(GATE_FIXTURE, 'finalBoss', 'hard', deps, { bossName: 'Nobody' }).join(
        '\n',
      ),
    ).toMatch(ENTITY);
  });

  it("the set piece's own acts leave the seat to its node; an event reaching Act V is refused", () => {
    const validate = (events) =>
      validateSetPiecesConfig({ setPieces: [GATE_FIXTURE] }, { ...deps, events }).errors.join('\n');
    expect(validate({ events: [] })).toBe('');
    const events = {
      events: [
        {
          id: 'e',
          acts: ['finalBoss'],
          choices: [{ outcomes: [{ effects: [{ type: 'battle', setPiece: 'fixture_gate' }] }] }],
        },
      ],
    };
    const errors = validate(events);
    expect(errors).toMatch(/could seat the Entity in finalBoss on hard/);
    expect(errors).toMatch(/could seat the Entity in finalBoss on lunatic/);
    expect(errors).not.toMatch(/on (normal|dusk)/);
  });

  // The shipped events, every battle that names a set piece (the Toll Bridge's) pointed at `id`.
  const eventsNaming = (id) => {
    const events = structuredClone(base.events);
    let named = 0;
    const walk = (node) => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (!node || typeof node !== 'object') return;
      if (node.type === 'battle' && node.setPiece !== undefined) {
        node.setPiece = id;
        named++;
      }
      Object.values(node).forEach(walk);
    };
    walk(events);
    expect(named).toBeGreaterThan(0);
    return events;
  };
  const tollBridgeNaming = (id, gameData = data) =>
    validateEventsConfig(eventsNaming(id), gameData).errors.join('\n');
  const BOSS_SLOT = /battle\.setPiece "(\w+)" has a boss slot/;

  it('an event battle naming a set piece with a boss slot is refused', () => {
    expect(tollBridgeNaming('toll_house')).toBe('');
    expect(tollBridgeNaming('fixture_vigil')).toBe('');
    expect(tollBridgeNaming('fixture_throne')).toMatch(BOSS_SLOT);
    expect(tollBridgeNaming('fixture_gate')).toMatch(BOSS_SLOT);
  });

  it('a boss slot in any variant counts, not only the first', () => {
    const split = structuredClone(DEFEAT_FIXTURE);
    split.id = 'fixture_split';
    split.variants.push({
      ...structuredClone(split.variants[0]),
      id: 'b',
      enemies: [...structuredClone(split.variants[0].enemies), { col: 7, row: 6, boss: true }],
    });
    expect(tollBridgeNaming('fixture_split', withSetPieces(base, split))).toMatch(
      /battle\.setPiece "fixture_split" has a boss slot/,
    );
  });
});
