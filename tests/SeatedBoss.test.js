// SeatedBoss (engine/SeatedBoss.js): one rule for who holds a battle's boss seat, shared by
// the template path's seize pick and a set piece's `boss: true` slot (act-v-descent §9.2).
//
// Ways this goes wrong:
//   - naming the boss (`bossName`) takes a different number of draws than the legacy pick, so a
//     named config drifts from today's (every later spawn, affix and wave moves);
//   - a named boss the rung's difficultyFilter would refuse is not seated (the Lieutenant on
//     Nightfall, the gate), or the name is looked up among an elite node's captains;
//   - the level drops the rung's boss level bonus, or an elite captain takes it twice;
//   - Revival Stones land on the Entity, or miss the Lieutenant's kind;
//   - an empty seat still spends a draw.
import { describe, expect, it, vi } from 'vitest';
import { resolveSeatedBoss, seatedBossCandidates } from '../src/engine/SeatedBoss.js';
import { generateSeededBattle } from '../src/engine/BattleScout.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const modes = data.difficulty.modes;

/** A random that counts its draws and hands out a fixed value. */
function counting(value = 0.25) {
  const random = () => {
    random.draws++;
    return value;
  };
  random.draws = 0;
  return random;
}

describe('resolveSeatedBoss', () => {
  it('takes exactly one draw whether or not a boss is named, and none for an empty seat', () => {
    for (const bossName of [undefined, 'The Entity', 'The Lieutenant', 'Nobody']) {
      const random = counting();
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      resolveSeatedBoss(
        { act: 'finalBoss', difficultyId: 'hard', bossName },
        { enemies: data.enemies, random },
      );
      warn.mockRestore();
      expect(random.draws, String(bossName)).toBe(1);
    }
    const random = counting();
    expect(resolveSeatedBoss({ act: 'act9' }, { enemies: data.enemies, random })).toBeNull();
    expect(random.draws).toBe(0);
  });

  it('a name seats that boss past the rung filter; the draw alone keeps the filter', () => {
    const drawn = resolveSeatedBoss(
      { act: 'finalBoss', difficultyId: 'hard' },
      { enemies: data.enemies, random: counting(0.99) },
    );
    expect(drawn.name).toBe('The Entity');
    const named = resolveSeatedBoss(
      { act: 'finalBoss', difficultyId: 'hard', bossName: 'The Lieutenant' },
      { enemies: data.enemies, random: counting(0.99) },
    );
    expect(named.name).toBe('The Lieutenant');
    expect(named.className).toBe('Hero');
  });

  it('level is the definition plus the rung bonus; stones by kind, never on the Entity', () => {
    const table = { actBoss: 1, emperor: 2, lieutenant: 3, eliteCaptain: 1 };
    const lieutenant = resolveSeatedBoss(
      {
        act: 'finalBoss',
        difficultyId: 'hard',
        bossName: 'The Lieutenant',
        bossLevelBonus: modes.hard.bossLevelBonus,
        revivalStones: table,
      },
      { enemies: data.enemies },
    );
    expect(lieutenant.level).toBe(20 + modes.hard.bossLevelBonus);
    expect(lieutenant.stones).toBe(3);
    const entity = resolveSeatedBoss(
      { act: 'finalBoss', difficultyId: 'hard', bossName: 'The Entity', revivalStones: table },
      { enemies: data.enemies },
    );
    expect(entity.isEntity).toBe(true);
    expect(entity.stones).toBe(0);
  });

  it("an elite node's seat is a captain at the node's level, with no rung bonus", () => {
    const params = { act: 'act2', isElite: true, bossLevelBonus: 4, revivalStones: { eliteCaptain: 1 } }; // prettier-ignore
    const deps = { enemies: data.enemies, classes: data.classes, levelRange: [6, 9] };
    const names = seatedBossCandidates(params, deps).map((c) => c.name);
    expect(names).toEqual(data.enemies.elites.act2.map((e) => e.name));
    const seat = resolveSeatedBoss(params, { ...deps, random: counting(0) });
    expect(seat.isEliteCaptain).toBe(true);
    expect(seat.stones).toBe(1);
    // A base captain sits at the top of the range plus the act's offset (2).
    expect(seat.level).toBe(9 + 2);
  });
});

describe('the template path seats the same boss with or without its name', () => {
  // Draw parity: when the name agrees with the draw's pick, the whole config is byte-identical.
  const finale = (difficultyId, extra = {}) => ({
    act: 'finalBoss',
    objective: 'seize',
    isBoss: true,
    templateId: 'eldritch_sanctum',
    difficultyId,
    deployCount: 6,
    bossLevelBonus: modes[difficultyId].bossLevelBonus,
    revivalStones: modes[difficultyId].revivalStones,
    ...extra,
  });

  it('the Entity on Nightfall and Black Sun', () => {
    for (const difficultyId of ['hard', 'lunatic'])
      for (let seed = 1; seed <= 12; seed++) {
        const legacy = generateSeededBattle(finale(difficultyId), data, seed);
        const named = generateSeededBattle(
          finale(difficultyId, { bossName: 'The Entity' }),
          data,
          seed,
        );
        expect(JSON.stringify(named)).toBe(JSON.stringify(legacy));
        expect(legacy.enemySpawns.find((s) => s.isBoss)).toMatchObject({ isEntity: true });
      }
  });

  it('the Lieutenant on First Light', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const legacy = generateSeededBattle(finale('normal'), data, seed);
      const named = generateSeededBattle(
        finale('normal', { bossName: 'The Lieutenant' }),
        data,
        seed,
      );
      expect(JSON.stringify(named)).toBe(JSON.stringify(legacy));
      expect(legacy.enemySpawns.find((s) => s.isBoss).name).toBe('The Lieutenant');
    }
  });

  it('a name the draw would not pick seats it at its own level and stones', () => {
    const config = generateSeededBattle(
      finale('hard', {
        bossName: 'The Lieutenant',
        revivalStones: { ...modes.hard.revivalStones, lieutenant: 2 },
      }),
      data,
      3,
    );
    const seated = config.enemySpawns.filter((s) => s.isBoss);
    expect(seated).toHaveLength(1);
    expect(seated[0]).toMatchObject({
      name: 'The Lieutenant',
      className: 'Hero',
      level: 20 + modes.hard.bossLevelBonus,
      revivalStones: 2,
      col: config.thronePos.col,
      row: config.thronePos.row,
    });
    expect(seated[0].isEntity).toBeUndefined();
  });
});
