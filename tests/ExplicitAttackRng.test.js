// Contract of compression plan step 3 for the player attack: its gameplay
// draws come only from the battle RNG it is handed, from Confirm through
// resolveCombat and every nested skill, affix, weapon-art and imbue roll.
// Ambient Math.random is never read on that path in a fixed-v1 battle, so
// rendering (which can still reach Math.random) cannot advance it. legacy-v1
// battles keep drawing ambient Math.random: an explicit compatibility branch.
//
// Expected outcomes are the characterization fixtures recorded on main before
// the change (see AttackRngCharacterization.test.js).
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));
vi.mock('../src/ui/HintDisplay.js', () => ({
  showImportantHint: vi.fn(async () => {}),
  showMinorHint: vi.fn(),
  showContextualHint: vi.fn(),
}));

import { readFileSync } from 'fs';
import { resolveCombat } from '../src/engine/Combat.js';
import {
  checkAstra,
  resolveGamblerDelta,
  rollDefenseSkills,
  rollStrikeSkills,
} from '../src/engine/SkillSystem.js';
import { ambientRandom, createBattleRng, playerAttackRandom } from '../src/engine/BattleRng.js';
import {
  SCENARIOS,
  SEEDS,
  buildScenario,
  data,
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

/** Math.random that fails the test on use (and says who used it). */
function trapAmbient() {
  const calls = [];
  Math.random = () => {
    calls.push(new Error('ambient draw').stack.split('\n').slice(2, 5).join(' <- '));
    throw new Error('ambient Math.random drawn on an explicit-RNG path');
  };
  return calls;
}

function counted(rng) {
  let draws = 0;
  const fn = () => {
    draws++;
    return rng();
  };
  fn.draws = () => draws;
  return fn;
}

describe('resolveCombat draws only from the generator it is given', () => {
  for (const name of Object.keys(SCENARIOS)) {
    it(`${name}: same outcome and cursor as the recorded ambient run, no ambient draw`, () => {
      for (const seed of SEEDS) {
        const s = buildScenario(name);
        const battle = createBattleRng(seed);
        const rng = counted(battle);
        const calls = trapAmbient();
        let result;
        try {
          result = resolveCombat(
            s.attacker,
            s.attacker.weapon,
            s.defender,
            s.defender.weapon,
            s.distance,
            s.atkTerrain,
            s.defTerrain,
            s.skillCtx,
            rng,
          );
        } finally {
          Math.random = original;
        }
        expect(calls, `${name} seed ${seed}`).toEqual([]);
        expect(
          { ...summarizeResult(result), draws: rng.draws(), cursor: battle.getState().cursor },
          `${name} seed ${seed}`,
        ).toEqual(RESOLVE_GOLDEN[name][seed]);
      }
    });
  }
});

describe('nested skill rolls take the generator explicitly', () => {
  const skills = data.skills;
  const unit = (extra = {}) => ({
    name: 'U',
    stats: { HP: 30, STR: 10, MAG: 0, SKL: 40, SPD: 30, DEF: 5, RES: 5, LCK: 30 },
    currentHP: 30,
    skills: [],
    ...extra,
  });

  it('on-attack, on-defend and Astra rolls read only the passed generator', () => {
    const calls = trapAmbient();
    const low = counted(() => 0.01); // every proc
    const high = counted(() => 0.99); // no proc
    const sol = unit({ skills: ['sol'] });
    expect(rollStrikeSkills(sol, 10, unit(), skills, null, low).activated).toEqual([
      { id: 'sol', name: 'Sol' },
    ]);
    expect(rollStrikeSkills(sol, 10, unit(), skills, null, high).activated).toEqual([]);
    const pavise = unit({ skills: ['pavise'] });
    expect(rollDefenseSkills(pavise, 10, true, skills, null, low).modifiedDamage).toBe(5);
    expect(rollDefenseSkills(pavise, 10, true, skills, null, high).modifiedDamage).toBe(10);
    const astra = unit({ skills: ['astra'] });
    expect(checkAstra(astra, skills, low).triggered).toBe(true);
    expect(checkAstra(astra, skills, high).triggered).toBe(false);
    expect([low.draws(), high.draws()]).toEqual([3, 3]);
    Math.random = original;
    expect(calls).toEqual([]);
  });

  it("Gambler's Coin rolls from the generator it is given", () => {
    const coin = unit({ accessory: { combatEffects: { gamblerCoin: true } } });
    const calls = trapAmbient();
    expect(resolveGamblerDelta(coin, null, () => 0.1)).toBe(5);
    expect(resolveGamblerDelta(coin, null, () => 0.9)).toBe(-3);
    Math.random = original;
    expect(calls).toEqual([]);
  });
});

describe('the rewind policy picks the attack generator', () => {
  it('fixed-v1: the battle RNG itself; legacy-v1 or no battle RNG: ambient Math.random', () => {
    const battle = createBattleRng(5);
    expect(playerAttackRandom('fixed-v1', battle)).toBe(battle);
    expect(playerAttackRandom('legacy-v1', battle)).toBe(ambientRandom);
    expect(playerAttackRandom(undefined, battle)).toBe(ambientRandom);
    expect(playerAttackRandom('fixed-v1', null)).toBe(ambientRandom);
    // Ambient means Math.random at the moment of the draw, not when picked.
    const picked = playerAttackRandom('legacy-v1', battle);
    Math.random = () => 0.25;
    expect(picked()).toBe(0.25);
  });
});

describe('a fixed-v1 player attack from Confirm never reads Math.random', () => {
  for (const name of Object.keys(ATTACKS)) {
    it(`${name}: the recorded outcome, whatever Math.random returns`, async () => {
      for (const seed of [42, 7, 1234, 2024]) {
        const key = `${name}/fixed-v1/${seed}`;
        const ctx = attackScene(name, { policy: 'fixed-v1', seed });
        // Rendering could still draw Math.random. On this path it must not
        // matter: point it at a different stream and count every use.
        const other = createBattleRng(0x5eed);
        let ambient = 0;
        Math.random = () => {
          ambient++;
          return other();
        };
        let outcome;
        let afterForecast;
        try {
          openForecast(ctx, 1);
          afterForecast = ctx.scene._battleRng.getState().cursor;
          outcome = await confirmAttack(ctx);
        } finally {
          Math.random = original;
        }
        expect(ambient, key).toBe(0);
        expect({ ...outcome, afterForecast }, key).toEqual(ATTACK_GOLDEN[key]);
      }
    });
  }
});

describe('legacy-v1 compatibility: the attack keeps drawing ambient Math.random', () => {
  for (const name of Object.keys(ATTACKS)) {
    it(`${name}: draws follow Math.random, not the battle generator object`, async () => {
      const ctx = attackScene(name, { policy: 'legacy-v1', seed: 42 });
      const before = ctx.scene._battleRng.getState();
      // Replay the recorded legacy run's stream through Math.random while the
      // scene's own generator object is left untouched.
      const replay = createBattleRng(42);
      Math.random = replay;
      let outcome;
      let afterForecast;
      try {
        openForecast(ctx, 1);
        afterForecast = replay.getState().cursor;
        outcome = await confirmAttack(ctx);
      } finally {
        Math.random = original;
      }
      expect(ctx.scene._battleRng.getState()).toEqual(before);
      const golden = ATTACK_GOLDEN[`${name}/legacy-v1/42`];
      expect(replay.getState().cursor).toBe(golden.cursor);
      expect(afterForecast).toBe(golden.afterForecast);
      const strip = ({ cursor, commits, afterForecast: _a, ...rest }) => {
        void cursor;
        void commits;
        return rest;
      };
      expect(strip(outcome)).toEqual(strip(golden));
    });
  }
});
