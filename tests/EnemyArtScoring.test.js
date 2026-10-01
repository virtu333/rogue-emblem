// EnemyArtScoring: the one enemy-art rule BattleScene and the harness share
// (docs/specs/aoe-weapon-arts.md §7). Scores are worked by hand from the weights:
// atk ×3, hit ×0.35, crit ×0.25, effectiveness (mult − 1) ×4, status ×3, ×2 damage +6,
// ignore RES +3, self-damage on miss −0.3 each, HP cost −0.75 each.
import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ default: { Scene: class {} } }));
import { loadGameData } from './testData.js';
import {
  enemyWeaponArtTuning,
  scoreAreaBonus,
  scoreEnemyWeaponArt,
  selectEnemyWeaponArt,
} from '../src/engine/EnemyArtScoring.js';
import { HeadlessBattle } from './harness/HeadlessBattle.js';

const data = loadGameData();
const art = (id) => data.weaponArts.arts.find((a) => a.id === id);
const weapon = (name) => structuredClone(data.weapons.find((w) => w.name === name));

const unit = (name, faction, col, row, stats = {}, extra = {}) => ({
  name,
  faction,
  col,
  row,
  level: 5,
  moveType: 'Infantry',
  currentHP: stats.HP ?? 30,
  stats: { HP: 30, STR: 0, MAG: 0, SKL: 0, SPD: 0, DEF: 0, RES: 0, LCK: 0, MOV: 5, ...stats },
  ...extra,
});

describe('scoreEnemyWeaponArt (the scene rule, pinned)', () => {
  const brute = unit('Brute', 'enemy', 0, 0);
  it.each([
    ['axe_smash', 20 * 0.35 + 20 * 0.25 - 3 * 0.75],
    ['legend_divine_flare', 10 * 3 + 10 * 0.35 + 2 * 4 + 3 - 8 * 0.75],
    ['bow_ward_arrow', 10 * 0.35 + 3 - 4 * 0.75],
    ['bow_all_or_nothing', 6 - 5 * 0.3 - 7 * 0.75],
  ])('%s', (id, expected) => {
    expect(scoreEnemyWeaponArt(brute, art(id))).toBeCloseTo(expected, 10);
  });
});

describe('tuning', () => {
  it('the harness picks by the same ladder as the scene, Dusk included', () => {
    expect(enemyWeaponArtTuning('dusk')).toEqual({ minScore: 1.5, useChance: 0.75 });
    // +4 Hit scores 1.4: under Dusk's 1.5 floor, over Nightfall's 0.75.
    const modest = { id: 'fixture_modest', combatMods: { hitBonus: 4 }, hpCost: 0 };
    const pick = (difficultyId) => {
      const battle = new HeadlessBattle(data, { act: 'act1', objective: 'rout' });
      battle.battleParams = { difficultyId };
      battle._enemyWeaponArtRandom = () => 0;
      battle._getWeaponArtChoices = () => [{ art: modest, canUse: true }];
      const brute = unit('Brute', 'enemy', 2, 2, {}, { weapon: weapon('Iron Axe') });
      return battle._selectEnemyWeaponArt(brute, unit('Target', 'player', 3, 2))?.id ?? null;
    };
    expect(pick('dusk')).toBeNull();
    expect(pick('hard')).toBe('fixture_modest');
  });
});

describe('area bonus', () => {
  // A fixture Sweeping Cleave: around the attacker, ×0.5.
  const cleave = {
    id: 'fixture_cleave',
    targeting: 'normal_attack',
    area: { shape: 'around_attacker', radius: 1, damage: { kind: 'scaled', multiplier: 0.5 } },
    combatMods: {},
    hpCost: 0,
  };
  const world = (units) => ({
    cols: 8,
    rows: 8,
    getMoveCost: () => 1,
    getTerrainAt: () => null,
    hostilesOf: (u) => units.filter((o) => o.faction !== u.faction && o.faction !== 'npc'),
  });

  it('values each victim by the share of HP taken, and a kill by 6 more', () => {
    // Iron Axe 7 + STR 12 − DEF 4 = 15, × 0.5 = 7.
    const brute = unit('Brute', 'enemy', 2, 2, { STR: 12 }, { weapon: weapon('Iron Axe') });
    const target = unit('Target', 'player', 3, 2, { DEF: 4 });
    const sturdy = unit('Sturdy', 'player', 2, 1, { DEF: 4 });
    const frail = unit('Frail', 'player', 1, 2, { DEF: 4, HP: 5 });
    const units = [brute, target, sturdy, frail];
    // Sturdy: 7/30 × 4; Frail: 5/5 × 4 + 6. All × 0.8.
    expect(scoreAreaBonus(brute, cleave, target, world(units))).toBeCloseTo(
      0.8 * ((7 / 30) * 4 + 10),
      10,
    );
    // Its own side is never hit, and nobody else in reach is worth nothing.
    const alone = [brute, target, unit('Ally', 'enemy', 2, 1)];
    expect(scoreAreaBonus(brute, cleave, target, world(alone))).toBe(0);
  });

  it('picks the area art over an equal single-target art when it reaches someone', () => {
    const plain = { id: 'a_plain', targeting: 'normal_attack', combatMods: {}, hpCost: 0 };
    const brute = unit('Brute', 'enemy', 2, 2, { STR: 12 }, { weapon: weapon('Iron Axe') });
    const target = unit('Target', 'player', 3, 2, { DEF: 4 });
    const frail = unit('Frail', 'player', 1, 2, { DEF: 4, HP: 5 });
    const units = [brute, target, frail];
    const choices = [{ art: plain }, { art: cleave }];
    expect(
      selectEnemyWeaponArt({
        unit: brute,
        target,
        choices,
        world: () => world(units),
        difficultyId: 'lunatic',
      })?.id,
    ).toBe('fixture_cleave');
  });

  it('never picks a chosen-center art, which the AI cannot aim', () => {
    const brute = unit('Brute', 'enemy', 2, 2);
    const center = {
      id: 'fixture_center',
      targeting: 'chosen_center',
      area: {
        shape: 'radius',
        radius: 1,
        damage: { kind: 'fixed', amount: 9 },
        centerRange: { min: 1, max: 5 },
      },
      combatMods: { atkBonus: 20 },
      hpCost: 0,
    };
    expect(
      selectEnemyWeaponArt({
        unit: brute,
        target: null,
        choices: [{ art: center }],
        difficultyId: 'lunatic',
      }),
    ).toBeNull();
  });
});
