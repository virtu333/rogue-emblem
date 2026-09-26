// Characterization of the player attack's gameplay draws (compression plan
// step 3). These pass on main before the attack path takes the battle RNG
// explicitly and must pass unchanged after: the same saved RNG state and the
// same commands give the same outcome, draw for draw.
//
// - The ledgers derive outcomes by hand from a scripted stream, which pins the
//   draw order: 2RN hit, crit (only on a hit), on-attack skills in the unit's
//   skill order, on-defend skills, Astra before its phase, imbue status last.
// - The fixtures under tests/fixtures/attack-rng/ were recorded from main at
//   b8e13bf (before the change) and are never regenerated from the code under
//   test. A diff there is a change in how the game plays.
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));
vi.mock('../src/ui/HintDisplay.js', () => ({
  showImportantHint: vi.fn(async () => {}),
  showMinorHint: vi.fn(),
  showContextualHint: vi.fn(),
}));

import { readFileSync } from 'fs';
import { resolveCombat } from '../src/engine/Combat.js';
import { createBattleRng } from '../src/engine/BattleRng.js';
import { applyImbue, getImbueById } from '../src/engine/ImbueSystem.js';
import {
  SCENARIOS,
  SEEDS,
  buildScenario,
  data,
  skillCtxFor,
  summarizeResult,
} from './helpers/attackRngScenarios.js';
import { ATTACKS, attackScene, confirmAttack, openForecast } from './helpers/attackScene.js';

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`./fixtures/attack-rng/${name}`, import.meta.url), 'utf-8'));
const RESOLVE_GOLDEN = fixture('resolve-combat.json');
const ATTACK_GOLDEN = fixture('player-attack.json');

const original = Math.random;
afterEach(() => {
  Math.random = original;
});

/** A scripted stream: fails the test if resolution draws more than scripted. */
function scripted(values) {
  let i = 0;
  const next = () => {
    if (i >= values.length) throw new Error(`draw ${i + 1} was not scripted`);
    return values[i++];
  };
  next.used = () => i;
  return next;
}

const plain = data.terrain.find((t) => t.name === 'Plain');
const weaponNamed = (name) => structuredClone(data.weapons.find((w) => w.name === name));

// Twin units: STR 10, SKL 12, SPD 10, LCK 6, DEF 6, HP 30.
// Iron Sword (5 Mt, 95 Hit, 0 Crit, Wt 3) vs Iron Axe (7 Mt, 80 Hit, Wt 6):
//   attacker Hit 95+24+6+10(triangle) - (20+6) = 109 → 100; Crit 6-6 = 0;
//            damage 10+5+1-6 = 10; AS 10-(3-2) = 9.
//   defender Hit 80+24+6-10 - 26 = 74; Crit 0; damage 10+7-1-6 = 10; AS 10-(6-2) = 6.
//   Nobody doubles (9 < 6+5).
function twins({ attacker = {}, defender = {} } = {}) {
  const stats = { HP: 30, STR: 10, MAG: 0, SKL: 12, SPD: 10, DEF: 6, RES: 3, LCK: 6 };
  const make = (name, faction, weapon, extra) => ({
    name,
    faction,
    className: 'Myrmidon',
    moveType: 'Infantry',
    skills: [],
    affixes: [],
    col: faction === 'player' ? 0 : 1,
    row: 0,
    weapon,
    ...extra,
    stats: { ...stats, ...(extra.stats || {}) },
    currentHP: extra.stats?.HP ?? stats.HP,
  });
  const a = make('Edric', 'player', attacker.weapon || weaponNamed('Iron Sword'), attacker);
  const d = make('Brigand', 'enemy', defender.weapon || weaponNamed('Iron Axe'), defender);
  return { a, d };
}

function resolveWithStream(a, d, stream) {
  Math.random = stream;
  const result = resolveCombat(a, a.weapon, d, d.weapon, 1, plain, plain, skillCtxFor(a, d));
  Math.random = original;
  return summarizeResult(result);
}

describe('player attack draw order (ledgers derived by hand)', () => {
  it('2RN hit, then crit only on a hit, then the counter', () => {
    const { a, d } = twins();
    // Hit (0.5+0.5)/2 = 50 < 100; crit 0 < 0 is false → 10 damage. The counter
    // misses: (0.9+0.8)/2 = 85 ≥ 74, so it draws no crit.
    const stream = scripted([0.5, 0.5, 0.0, 0.9, 0.8]);
    const out = resolveWithStream(a, d, stream);
    expect(out.events).toEqual([
      ['attacker', 'hit', 10, 20, 0, '', 0, 0, 0, 0],
      ['defender', 'miss', 0, 30, 0, '', 0, 0, 0, 0],
    ]);
    expect([out.attackerHP, out.defenderHP]).toEqual([30, 20]);
    expect(stream.used()).toBe(5);
  });

  it('on-attack skills roll in the unit skill order after crit, then on-defend skills', () => {
    // SKL 30: Luna (SKL) 30%, Sol (SKL_HALF) 15%, crit 15-6 = 9. Pavise 12%.
    // Luna's 25 < 30 procs; Sol's 50 does not; Pavise's 99 does not. Luna
    // halves DEF: 16 - 3 = 13. Rolled in the other order, neither would proc.
    const { a, d } = twins({
      attacker: { stats: { SKL: 30 }, skills: ['luna', 'sol'] },
      defender: { skills: ['pavise'] },
    });
    const stream = scripted([0.2, 0.2, 0.5, 0.25, 0.5, 0.99, 0.1, 0.1, 0.5]);
    const out = resolveWithStream(a, d, stream);
    expect(out.events).toEqual([
      ['attacker', 'hit', 13, 17, 0, 'luna', 0, 0, 0, 0],
      ['defender', 'hit', 10, 20, 0, '', 0, 0, 0, 0],
    ]);
    expect(stream.used()).toBe(9);
  });

  it('a crit multiplies the proc damage and a kill ends the exchange', () => {
    const { a, d } = twins({
      attacker: { stats: { SKL: 30 }, skills: ['luna', 'sol'] },
      defender: { skills: ['pavise'] },
    });
    // Crit 5 < 9: Luna's 13 × 3 = 39 ≥ 30 HP. No counter, nothing after.
    const stream = scripted([0.2, 0.2, 0.05, 0.25, 0.5, 0.99]);
    const out = resolveWithStream(a, d, stream);
    expect(out.events).toEqual([['attacker', 'crit', 39, 0, 0, 'luna', 0, 0, 0, 0]]);
    expect(out.defenderHP).toBe(0);
    expect(stream.used()).toBe(6);
  });

  it('Astra rolls once before its phase; each Astra strike still rolls the skill', () => {
    // SKL 40: Astra 20%, crit 20-6 = 14. Triggered (10 < 20): 5 strikes of
    // floor(10 × 0.5) = 5. Each: hit, crit (90: none), Astra's on-attack roll.
    // A 10 HP defender falls on the second strike.
    const { a, d } = twins({
      attacker: { stats: { SKL: 40 }, skills: ['astra'] },
      defender: { stats: { HP: 10 } },
    });
    const strike = [0.3, 0.3, 0.9, 0.9];
    const stream = scripted([0.1, ...strike, ...strike]);
    const out = resolveWithStream(a, d, stream);
    expect(out.events).toEqual([
      ['skill', 'Astra', 'Edric'],
      ['attacker', 'hit', 5, 5, 0, '', 0, 0, 0, 0],
      ['attacker', 'hit', 5, 0, 0, '', 0, 0, 0, 0],
    ]);
    expect(stream.used()).toBe(9);
  });

  it('a Binding imbue rolls its status chance after every strike, only if its side hit', () => {
    const sword = weaponNamed('Iron Sword');
    applyImbue(sword, getImbueById(data.imbues, 'binding'));
    const { a, d } = twins({ attacker: { weapon: sword } });
    // Hit, no crit, counter misses, then Binding's 30%: 20 < 30 → root.
    const stream = scripted([0.5, 0.5, 0.0, 0.9, 0.8, 0.2]);
    const out = resolveWithStream(a, d, stream);
    expect(out.imbueStatus).toEqual([
      { target: 'defender', sourceSide: 'attacker', status: 'root', durationPhases: 1 },
    ]);
    expect(stream.used()).toBe(6);
  });
});

describe('resolveCombat outcomes recorded on main', () => {
  for (const name of Object.keys(SCENARIOS)) {
    it(`${name}: same events, HP, effects and RNG cursor for every seed`, () => {
      for (const seed of SEEDS) {
        const s = buildScenario(name);
        // As in a battle today: the battle RNG is installed as Math.random.
        const rng = createBattleRng(seed);
        let draws = 0;
        Math.random = () => {
          draws++;
          return rng();
        };
        const result = resolveCombat(
          s.attacker,
          s.attacker.weapon,
          s.defender,
          s.defender.weapon,
          s.distance,
          s.atkTerrain,
          s.defTerrain,
          s.skillCtx,
        );
        Math.random = original;
        expect(
          { ...summarizeResult(result), draws, cursor: rng.getState().cursor },
          `${name} seed ${seed}`,
        ).toEqual(RESOLVE_GOLDEN[name][seed]);
      }
    });
  }

  it('the recorded scenarios are not vacuous', () => {
    const all = Object.values(RESOLVE_GOLDEN).flatMap((bySeed) => Object.values(bySeed));
    const activations = new Set(
      all.flatMap((r) => r.events.flatMap((e) => (e[0] === 'skill' ? [e[1]] : e[5].split('+')))),
    );
    for (const id of [
      'Astra',
      'Vantage',
      'Desperation',
      'sol',
      'luna',
      'aether',
      'flare',
      'lethality',
      'adept',
      'commanders_gambit',
      'divine_charge',
      'seraph_strike',
      'pavise',
      'aegis',
      'miracle',
      'cancel',
      'intimidate',
      'dragon_scale',
      'shielded',
      'thorns',
      'teleporter',
    ])
      expect(activations, id).toContain(id);
    expect(all.some((r) => r.events.some((e) => e[1] === 'crit'))).toBe(true);
    expect(all.some((r) => r.imbueStatus.length > 0)).toBe(true);
    expect(all.some((r) => r.divine.length > 0)).toBe(true);
    expect(all.some((r) => r.debuffs.length > 0)).toBe(true);
  });
});

describe('a player attack from Confirm, recorded on main', () => {
  // ATTACK_GOLDEN keys: `${attack}/${policy}/${seed}`. The forecast is opened
  // once first, as the player must to reach Confirm.
  for (const key of Object.keys(ATTACK_GOLDEN)) {
    it(key, async () => {
      const [name, policy, seed] = key.split('/');
      const ctx = attackScene(name, { policy, seed: Number(seed) });
      openForecast(ctx, 1);
      const afterForecast = ctx.scene._battleRng.getState().cursor;
      const outcome = await confirmAttack(ctx);
      expect({ ...outcome, afterForecast }).toEqual(ATTACK_GOLDEN[key]);
    });
  }

  it('covers each attack under both rewind policies, with a warp and a kill', () => {
    for (const name of Object.keys(ATTACKS))
      for (const policy of ['fixed-v1', 'legacy-v1'])
        expect(Object.keys(ATTACK_GOLDEN).some((k) => k.startsWith(`${name}/${policy}/`))).toBe(
          true,
        );
    const warped = Object.entries(ATTACK_GOLDEN).filter(
      ([k, v]) => k.startsWith('teleporter/') && v.defender.at.join() !== '5,4',
    );
    expect(warped.length).toBeGreaterThan(0);
    expect(Object.values(ATTACK_GOLDEN).some((v) => v.defender.hp === 0)).toBe(true);
    // Legacy battles roll Gambler's Coin in the forecast from the battle stream.
    expect(ATTACK_GOLDEN['procs/legacy-v1/42'].afterForecast).not.toBe(42);
    expect(ATTACK_GOLDEN['procs/fixed-v1/42'].afterForecast).toBe(42);
  });
});

describe('the same saved state and commands give the same attack (fixed-v1)', () => {
  // Presentation and reading must not change what the attack rolls.
  const variants = {
    control: {},
    'forecast opened four times': { forecasts: 4 },
    'forecast opened on another target first': { otherTarget: true },
    'reduced motion': { reduceMotion: true },
    'instant battle speed': { speed: 'instant' },
    'fast battle speed with reduced motion': { speed: 'fast', reduceMotion: true },
  };
  for (const name of Object.keys(ATTACKS)) {
    it(`${name}: every variant matches the control`, async () => {
      const outcomes = {};
      for (const [label, v] of Object.entries(variants)) {
        const ctx = attackScene(name, {
          policy: 'fixed-v1',
          seed: 2024,
          cursor: 987654321,
          reduceMotion: v.reduceMotion,
          speed: v.speed,
        });
        if (v.otherTarget) {
          // Another enemy is forecast (and its roll session dropped, as switching
          // target does) before the real target; it then leaves the map.
          const decoy = { ...ctx.defender, battleEntityId: 'u3', col: 4, row: 5 };
          ctx.scene.enemyUnits.push(decoy);
          const target = ctx.defender;
          ctx.defender = decoy;
          openForecast(ctx, 2);
          ctx.scene._clearCombatRollSession();
          ctx.scene.enemyUnits.pop();
          ctx.defender = target;
        }
        openForecast(ctx, v.forecasts || 1);
        const { commits, hits, ...rest } = await confirmAttack(ctx);
        void hits;
        outcomes[label] = { ...rest, committedAt: commits.map((c) => c.rngState) };
      }
      // The attack drew from the stream: the comparison is not vacuous.
      expect(outcomes.control.cursor).not.toBe(987654321);
      for (const label of Object.keys(variants))
        expect(outcomes[label], label).toEqual(outcomes.control);
    });
  }
});
