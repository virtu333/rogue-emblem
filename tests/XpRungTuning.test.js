// Boss/elite XP bonus and the underdog cap are per difficulty rung (difficulty.json
// `specialXpMultiplier`, `xpUnderdogCap`). Expected values are worked by hand from
// XP_BASE_COMBAT 25, XP_KILL_BONUS 15, XP_LEVEL_DIFF_SCALE 5 and the +12 promoted offset.
import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ default: { Scene: class {} } }));
import { combatXpAwards, actionXpAwards, scaledXp } from '../src/engine/BattleXp.js';
import { calculateCombatXP } from '../src/engine/UnitManager.js';
import { calculateSharedXp } from '../src/engine/XpShare.js';
import { enemyXpMultiplier } from '../src/engine/ReinforcementSpawns.js';
import { BattleScene } from '../src/scenes/BattleScene.js';
import { HeadlessBattle } from './harness/HeadlessBattle.js';
import { validateDifficultyConfig } from '../src/engine/DifficultyEngine.js';
import { RunManager } from '../src/engine/RunManager.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const player = { name: 'P', level: 1, tier: 'promoted', faction: 'player', currentHP: 20, xp: 0 };
// An Act III boss on Nightfall: promoted, visible level 9 (spawn 20), so effective 21.
const boss = {
  name: 'B',
  level: 9,
  tier: 'promoted',
  faction: 'enemy',
  isBoss: true,
  currentHP: 0,
};

describe('underdog cap', () => {
  it('limits the level bonus a stronger foe adds', () => {
    // effective 21 vs 13: eight levels up, so the cap decides the bonus.
    expect(calculateCombatXP(player, boss, true)).toBe(25 + 6 * 5 + 15);
    expect(calculateCombatXP(player, boss, true, { underdogCap: 4 })).toBe(25 + 4 * 5 + 15);
    expect(calculateCombatXP(player, boss, false, { underdogCap: 0 })).toBe(25);
  });

  it('does not touch a foe within the cap', () => {
    const near = { ...boss, level: 3, isBoss: false }; // effective 15, two above
    expect(calculateCombatXP(player, near, true, { underdogCap: 4 })).toBe(25 + 2 * 5 + 15);
  });

  it('reaches Mentor’s Band shares', () => {
    expect(calculateSharedXp(player, boss, true, 0.5)).toBe(35);
    expect(calculateSharedXp(player, boss, true, 0.5, 1, { underdogCap: 4 })).toBe(30);
  });

  it('reaches combat awards and area credits', () => {
    const own = (cap) =>
      combatXpAwards({ unit: player, opponent: boss, opponentDied: true, underdogCap: cap })[0]
        .baseXp;
    expect(own(undefined)).toBe(70);
    expect(own(4)).toBe(60);
    const area = (cap) =>
      actionXpAwards({
        unit: player,
        opponent: null,
        credits: [{ victim: boss, damage: 10, hpBefore: 10, killed: true }],
        underdogCap: cap,
      })[0].baseXp;
    expect(area(4)).toBeLessThan(area(undefined));
  });
});

describe('boss and elite bonus', () => {
  it('uses the rung value and leaves ordinary foes alone', () => {
    expect(enemyXpMultiplier(boss, 1.1)).toBeCloseTo(1.1);
    expect(enemyXpMultiplier({ ...boss, isBoss: false, isElite: true }, 1)).toBe(1);
    expect(enemyXpMultiplier({ ...boss, isBoss: false }, 1.1)).toBe(1);
    expect(enemyXpMultiplier(boss)).toBeCloseTo(1.3);
  });

  it('stacks with a reinforcement multiplier', () => {
    const wave = { ...boss, _isReinforcement: true, _reinforcementRewardMultiplier: 0.5 };
    expect(enemyXpMultiplier(wave, 1.1)).toBeCloseTo(0.55);
  });
});

describe('rung data', () => {
  const modes = data.difficulty.modes;
  it('eases the bonus and the cap up the ladder', () => {
    expect(
      ['normal', 'dusk', 'hard', 'lunatic'].map((id) => modes[id].specialXpMultiplier),
    ).toEqual([1.3, 1.2, 1.1, 1.0]);
    expect(['normal', 'dusk', 'hard', 'lunatic'].map((id) => modes[id].xpUnderdogCap)).toEqual([
      6, 6, 4, 4,
    ]);
  });

  it('a Nightfall promoted L1 earns 52 XP from an Act III boss, First Light 91', () => {
    const kill = (id) => {
      const m = modes[id];
      const base = combatXpAwards({
        unit: player,
        opponent: boss,
        opponentDied: true,
        rewardMultiplier: enemyXpMultiplier(boss, m.specialXpMultiplier),
        underdogCap: m.xpUnderdogCap,
      })[0].baseXp;
      return scaledXp(base, { xpMultiplier: m.xpMultiplier });
    };
    expect(kill('hard')).toBe(52); // floor(60 * 1.1) = 66; floor(66 * 0.8) = 52
    expect(kill('normal')).toBe(91); // 70 * 1.3
  });

  it('battle params carry the rung values, and fall back to the old rules without them', () => {
    const rm = new RunManager(data);
    rm.startRun({ runSeed: 3, difficultyId: 'hard', applyBlessingsAtStart: false });
    const node = rm.nodeMap.nodes.find((n) => n.type === 'battle' && n.battleParams);
    const params = rm.getBattleParams(node);
    expect(params.specialXpMultiplier).toBe(1.1);
    expect(params.xpUnderdogCap).toBe(4);
    delete rm.difficultyModifiers.specialXpMultiplier;
    delete rm.difficultyModifiers.xpUnderdogCap;
    const old = rm.getBattleParams(node);
    expect(old.specialXpMultiplier).toBe(1.3);
    expect(old.xpUnderdogCap).toBe(6);
  });
});

describe('validation', () => {
  it('real difficulty data passes, and a rung missing either key is refused', () => {
    expect(validateDifficultyConfig(data.difficulty).errors).toEqual([]);
    for (const key of ['specialXpMultiplier', 'xpUnderdogCap']) {
      const broken = structuredClone(data.difficulty);
      delete broken.modes.hard[key];
      expect(validateDifficultyConfig(broken).errors).toContain(
        `modes.hard missing required key: ${key}`,
      );
    }
  });

  it('refuses a bonus below 1 and a fractional cap', () => {
    const broken = structuredClone(data.difficulty);
    broken.modes.hard.specialXpMultiplier = 0.9;
    broken.modes.hard.xpUnderdogCap = 2.5;
    const errors = validateDifficultyConfig(broken).errors.join('\n');
    expect(errors).toContain('specialXpMultiplier must be a number >= 1');
    expect(errors).toContain('xpUnderdogCap must be a non-negative integer');
  });

  it('a null or empty value falls back to the old rule instead of reading as 0', () => {
    expect(enemyXpMultiplier(boss, null)).toBeCloseTo(1.3);
    expect(enemyXpMultiplier(boss, '')).toBeCloseTo(1.3);
    expect(calculateCombatXP(player, boss, true, { underdogCap: null })).toBe(70);
  });
});

describe('the scene and the harness read the rung from battleParams', () => {
  // Promoted L1 killing the Act III boss: 60 base at cap 4, x1.1 -> floor(66).
  const params = { specialXpMultiplier: 1.1, xpUnderdogCap: 4 };

  it('BattleScene.awardXP pays the rung’s bonus and cap', async () => {
    const scene = new BattleScene();
    scene.awardScaledXP = vi.fn(async () => {});
    scene.battleParams = params;
    await BattleScene.prototype.awardXP.call(scene, player, boss, true);
    expect(scene.awardScaledXP).toHaveBeenCalledWith(player, 66);
  });

  it('BattleScene.awardXP without the params pays the old 70 x 1.3', async () => {
    const scene = new BattleScene();
    scene.awardScaledXP = vi.fn(async () => {});
    await BattleScene.prototype.awardXP.call(scene, player, boss, true);
    expect(scene.awardScaledXP).toHaveBeenCalledWith(player, 91);
  });

  it('the headless harness awards the same', () => {
    const battle = Object.create(HeadlessBattle.prototype);
    const granted = [];
    Object.assign(battle, {
      gameData: { ...data, deeds: null },
      turnManager: { turnNumber: 1 },
      turnPar: 8,
      battleParams: params,
      playerUnits: [],
      _grantScaledXP: (unit, xp) => granted.push([unit, xp]),
    });
    battle._awardCombatXP(player, boss, true, null, null);
    expect(granted).toEqual([[player, 66]]);
    battle.battleParams = {};
    granted.length = 0;
    battle._awardCombatXP(player, boss, true, null, null);
    expect(granted).toEqual([[player, 91]]);
  });
});
