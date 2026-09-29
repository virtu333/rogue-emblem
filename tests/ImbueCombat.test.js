// Imbue combat effects — driven through resolveCombat/getCombatForecast so the
// full imbue seam (skillCtx.imbuesData → mod merge → post-combat emission →
// pipeline steps) is exercised, forecast/resolution parity included.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { getCombatForecast, resolveCombat } from '../src/engine/Combat.js';
import { getPostCombatPipelineSteps } from '../src/engine/WeaponArtPostCombat.js';
import { applyCondition, isRooted, isStatusImmune } from '../src/engine/StatusConditionSystem.js';
import { applyImbue, getImbueById } from '../src/engine/ImbueSystem.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const imbuesData = data.imbues;
const plain = data.terrain.find((t) => t.name === 'Plain');

afterEach(() => {
  vi.restoreAllMocks();
});

function makeUnit(overrides = {}) {
  return {
    name: 'TestUnit',
    className: 'Myrmidon',
    tier: 'base',
    level: 5,
    stats: { HP: 30, STR: 8, MAG: 0, SKL: 10, SPD: 10, DEF: 5, RES: 3, LCK: 5 },
    currentHP: 30,
    faction: 'player',
    weapon: null,
    inventory: [],
    proficiencies: [{ type: 'Sword', rank: 'Prof' }],
    skills: [],
    moveType: 'Infantry',
    col: 0,
    row: 0,
    ...overrides,
  };
}

function ironSword(imbueId = null) {
  const weapon = structuredClone(data.weapons.find((w) => w.name === 'Iron Sword'));
  if (imbueId) applyImbue(weapon, getImbueById(imbuesData, imbueId));
  return weapon;
}

/** Force deterministic strike rolls: always hit, never crit, no proc rolls. */
function forceHitsNoCrits() {
  // rollStrike: hitRoll (<hit → hit), critRoll (<crit → crit). hit is 100-capped
  // and crit ≥ 0, so 0.5*100=50 guarantees a hit vs 100 hit and no crit vs 0 crit
  // only if crit < 50 — our test units have 0 weapon crit and defender LCK 5.
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
}

function setupCombat({ atkImbue = null, defImbue = null, defOverrides = {}, atkOverrides = {} }) {
  const attacker = makeUnit({ name: 'Attacker', weapon: ironSword(atkImbue), ...atkOverrides });
  const defender = makeUnit({
    name: 'Defender',
    faction: 'enemy',
    weapon: ironSword(defImbue),
    ...defOverrides,
  });
  return { attacker, defender };
}

const baseSkillCtx = { imbuesData };

describe('Imbue combat mods — forecast/resolution parity', () => {
  it('keen: +10 crit and +5 hit appear in the forecast (attacker side)', () => {
    const { attacker, defender } = setupCombat({});
    const plainForecast = getCombatForecast(
      attacker,
      attacker.weapon,
      defender,
      defender.weapon,
      1,
      plain,
      plain,
      baseSkillCtx,
    );
    const { attacker: keenAttacker, defender: keenDefender } = setupCombat({ atkImbue: 'keen' });
    const keenForecast = getCombatForecast(
      keenAttacker,
      keenAttacker.weapon,
      keenDefender,
      keenDefender.weapon,
      1,
      plain,
      plain,
      baseSkillCtx,
    );
    expect(keenForecast.attacker.crit).toBe(Math.min(100, plainForecast.attacker.crit + 10));
    expect(keenForecast.attacker.hit).toBe(Math.min(100, plainForecast.attacker.hit + 5));
    // Imbue surfaces as an activation for the forecast UI
    expect(keenForecast.attacker.skills).toContainEqual({ id: 'imbue_keen', name: 'Cruel' });
    // Defender numbers untouched
    expect(keenForecast.defender.damage).toBe(plainForecast.defender.damage);
  });

  it('keen also applies when the imbued weapon is on the defending side', () => {
    const { attacker, defender } = setupCombat({ defImbue: 'keen' });
    const forecast = getCombatForecast(
      attacker,
      attacker.weapon,
      defender,
      defender.weapon,
      1,
      plain,
      plain,
      baseSkillCtx,
    );
    expect(forecast.defender.skills).toContainEqual({ id: 'imbue_keen', name: 'Cruel' });
  });

  it('warded: +1 DEF cuts physical damage taken by 1, attacking and defending', () => {
    const base = setupCombat({});
    const baseForecast = getCombatForecast(
      base.attacker,
      base.attacker.weapon,
      base.defender,
      base.defender.weapon,
      1,
      plain,
      plain,
      baseSkillCtx,
    );
    // Warded on the DEFENDER's weapon reduces the attacker's sword damage by 1 (DEF +1)
    const defWarded = setupCombat({ defImbue: 'warded' });
    const defForecast = getCombatForecast(
      defWarded.attacker,
      defWarded.attacker.weapon,
      defWarded.defender,
      defWarded.defender.weapon,
      1,
      plain,
      plain,
      baseSkillCtx,
    );
    expect(defForecast.attacker.damage).toBe(Math.max(0, baseForecast.attacker.damage - 1));
    // Warded on the ATTACKER's weapon reduces the sword counter by 1
    const atkWarded = setupCombat({ atkImbue: 'warded' });
    const atkForecast = getCombatForecast(
      atkWarded.attacker,
      atkWarded.attacker.weapon,
      atkWarded.defender,
      atkWarded.defender.weapon,
      1,
      plain,
      plain,
      baseSkillCtx,
    );
    expect(atkForecast.defender.damage).toBe(Math.max(0, baseForecast.defender.damage - 1));
  });

  it('armorbane: 2x effectiveness vs Armored, neutral vs Infantry', () => {
    const armoredDef = { moveType: 'Armored' };
    const base = setupCombat({ defOverrides: armoredDef });
    const baseForecast = getCombatForecast(
      base.attacker,
      base.attacker.weapon,
      base.defender,
      base.defender.weapon,
      1,
      plain,
      plain,
      baseSkillCtx,
    );
    const bane = setupCombat({ atkImbue: 'armorbane', defOverrides: armoredDef });
    const baneForecast = getCombatForecast(
      bane.attacker,
      bane.attacker.weapon,
      bane.defender,
      bane.defender.weapon,
      1,
      plain,
      plain,
      baseSkillCtx,
    );
    // Attack = STR + might*mult; base dmg = STR + might - DEF. Doubling might adds +might.
    const might = bane.attacker.weapon.might;
    expect(baneForecast.attacker.damage).toBe(baseForecast.attacker.damage + might);

    // Neutral vs Infantry
    const vsInfantry = setupCombat({ atkImbue: 'armorbane' });
    const infantryForecast = getCombatForecast(
      vsInfantry.attacker,
      vsInfantry.attacker.weapon,
      vsInfantry.defender,
      vsInfantry.defender.weapon,
      1,
      plain,
      plain,
      baseSkillCtx,
    );
    const infantryBase = setupCombat({});
    const infantryBaseForecast = getCombatForecast(
      infantryBase.attacker,
      infantryBase.attacker.weapon,
      infantryBase.defender,
      infantryBase.defender.weapon,
      1,
      plain,
      plain,
      baseSkillCtx,
    );
    expect(infantryForecast.attacker.damage).toBe(infantryBaseForecast.attacker.damage);
  });

  it('resolveCombat strike damage matches the forecast (armorbane + warded)', () => {
    forceHitsNoCrits();
    const { attacker, defender } = setupCombat({
      atkImbue: 'armorbane',
      defImbue: 'warded',
      defOverrides: { moveType: 'Armored' },
    });
    const forecast = getCombatForecast(
      attacker,
      attacker.weapon,
      defender,
      defender.weapon,
      1,
      plain,
      plain,
      baseSkillCtx,
    );
    const result = resolveCombat(
      attacker,
      attacker.weapon,
      defender,
      defender.weapon,
      1,
      plain,
      plain,
      baseSkillCtx,
    );
    const atkStrikes = result.events.filter(
      (e) => e.type === 'strike' && e.attackerSide === 'attacker' && !e.miss,
    );
    expect(atkStrikes.length).toBeGreaterThan(0);
    expect(atkStrikes[0].damage).toBe(forecast.attacker.damage);
    const defStrikes = result.events.filter(
      (e) => e.type === 'strike' && e.attackerSide === 'defender' && !e.miss,
    );
    expect(defStrikes.length).toBeGreaterThan(0);
    expect(defStrikes[0].damage).toBe(forecast.defender.damage);
  });

  it('no imbuesData in skillCtx → no imbue effects (defensive)', () => {
    const { attacker, defender } = setupCombat({ atkImbue: 'keen' });
    const noCatalog = getCombatForecast(
      attacker,
      attacker.weapon,
      defender,
      defender.weapon,
      1,
      plain,
      plain,
      null,
    );
    expect(noCatalog.attacker.skills).toEqual([]);
  });
});

describe('Imbue combat — vampiric: 1 HP on each hit that deals damage', () => {
  const attackerStrikes = (result) =>
    result.events.filter((e) => e.type === 'strike' && e.attackerSide === 'attacker' && !e.miss);

  function vampFight({ atkOverrides = {}, defOverrides = {}, ctx = baseSkillCtx } = {}) {
    forceHitsNoCrits();
    const { attacker, defender } = setupCombat({
      atkImbue: 'vampiric',
      atkOverrides: { currentHP: 10, ...atkOverrides },
      defOverrides,
    });
    const args = [attacker, attacker.weapon, defender, defender.weapon, 1, plain, plain, ctx];
    return { forecast: getCombatForecast(...args), result: resolveCombat(...args) };
  }

  it('heals exactly 1 per damaging hit, and the forecast says so', () => {
    const { forecast, result } = vampFight();
    expect(forecast.attacker.drainPerHit).toBe(1);
    expect(forecast.attacker.drainPercent).toBe(0);
    const strikes = attackerStrikes(result);
    expect(strikes.length).toBeGreaterThan(0);
    for (const strike of strikes) {
      expect(strike.damage).toBeGreaterThan(0);
      expect([strike.heal, strike.healed]).toEqual([1, 1]);
    }
  });

  it('heals 1, not more, on a big hit', () => {
    // STR 40 + Iron Sword vs DEF 0: 45 damage a hit, still 1 HP back.
    const { result } = vampFight({
      atkOverrides: { currentHP: 5, stats: { ...makeUnit().stats, HP: 60, STR: 40 } },
      defOverrides: { currentHP: 200, stats: { ...makeUnit().stats, HP: 200, DEF: 0 } },
    });
    const strikes = attackerStrikes(result);
    expect(strikes.length).toBeGreaterThan(0);
    for (const strike of strikes) {
      expect(strike.damage).toBeGreaterThan(20);
      expect(strike.heal).toBe(1);
    }
  });

  it('a hit that deals no damage heals nothing', () => {
    // STR 0 + Iron Sword (5) vs DEF 20: 0 damage.
    const { result } = vampFight({
      atkOverrides: { stats: { ...makeUnit().stats, STR: 0 } },
      defOverrides: { stats: { ...makeUnit().stats, DEF: 20 } },
    });
    const strikes = attackerStrikes(result);
    expect(strikes.length).toBeGreaterThan(0);
    for (const strike of strikes) expect([strike.damage, strike.heal]).toEqual([0, 0]);
    expect(result.attackerHP).toBeLessThanOrEqual(10);
  });

  it('heals on the counter too (imbue on the defending weapon)', () => {
    forceHitsNoCrits();
    const { attacker, defender } = setupCombat({
      defImbue: 'vampiric',
      defOverrides: { currentHP: 10 },
    });
    const result = resolveCombat(
      attacker,
      attacker.weapon,
      defender,
      defender.weapon,
      1,
      plain,
      plain,
      baseSkillCtx,
    );
    const counters = result.events.filter(
      (e) => e.type === 'strike' && e.attackerSide === 'defender' && !e.miss,
    );
    expect(counters.length).toBeGreaterThan(0);
    for (const strike of counters) expect(strike.heal).toBe(1);
  });

  it('a stronger drain wins (max), it does not add', () => {
    const ctx = { ...baseSkillCtx, atkWeaponArtMods: { drainPercent: 0.5 } };
    const { forecast, result } = vampFight({
      atkOverrides: { currentHP: 5, stats: { ...makeUnit().stats, HP: 60, STR: 40 } },
      defOverrides: { currentHP: 200, stats: { ...makeUnit().stats, HP: 200, DEF: 0 } },
      ctx,
    });
    expect(forecast.attacker.drainPercent).toBeCloseTo(0.5);
    const strikes = attackerStrikes(result);
    expect(strikes.length).toBeGreaterThan(0);
    for (const strike of strikes) expect(strike.heal).toBe(Math.floor(strike.damage * 0.5));
  });

  it("Vampire's Bloodshard stacks on top: 1 + 2 a hit", () => {
    const bloodshard = structuredClone(
      data.accessories.find((a) => a.name === "Vampire's Bloodshard"),
    );
    expect(bloodshard.combatEffects.perHitHeal).toBe(2);
    const { result } = vampFight({ atkOverrides: { accessory: bloodshard } });
    const strikes = attackerStrikes(result);
    expect(strikes.length).toBeGreaterThan(0);
    for (const strike of strikes) expect(strike.heal).toBe(3);
  });
});

describe('Wounded: no drain heals', () => {
  it('a Wounded striker drains nothing (its strikes still land in full)', () => {
    forceHitsNoCrits();
    const { attacker, defender } = setupCombat({
      atkImbue: 'vampiric',
      atkOverrides: { currentHP: 5, stats: { ...makeUnit().stats, HP: 60, STR: 40 } },
      defOverrides: { currentHP: 200, stats: { ...makeUnit().stats, HP: 200, DEF: 0 } },
    });
    const ctx = { ...baseSkillCtx, atkWeaponArtMods: { drainPercent: 0.5 } };
    const args = [attacker, attacker.weapon, defender, defender.weapon, 1, plain, plain, ctx];
    const healthy = resolveCombat(...args);
    attacker._conditions = [{ id: 'wounded', turnsRemaining: 2 }];
    expect(getCombatForecast(...args).attacker.drainPercent).toBe(0);
    expect(getCombatForecast(...args).attacker.drainPerHit).toBe(0);
    const wounded = resolveCombat(...args);
    const strikes = (r) =>
      r.events.filter((e) => e.type === 'strike' && e.attackerSide === 'attacker' && !e.miss);
    expect(strikes(healthy).some((e) => e.heal > 0)).toBe(true);
    expect(strikes(wounded).length).toBe(strikes(healthy).length);
    for (const strike of strikes(wounded)) {
      expect(strike.heal).toBe(0);
      expect(strike.strikerHealTo).toBeUndefined();
    }
    expect(strikes(wounded).map((e) => e.damage)).toEqual(strikes(healthy).map((e) => e.damage));
    expect(wounded.attackerHP).toBeLessThanOrEqual(5);
  });
});

describe('Imbue combat — venom post-combat poison', () => {
  it('emits 7 poison via the poisonEffects path and floors HP at 1', () => {
    forceHitsNoCrits();
    const { attacker, defender } = setupCombat({ atkImbue: 'venom' });
    const result = resolveCombat(
      attacker,
      attacker.weapon,
      defender,
      defender.weapon,
      1,
      plain,
      plain,
      baseSkillCtx,
    );
    expect(result.poisonEffects).toContainEqual({ target: 'defender', damage: 7 });
    expect(result.defenderHP).toBeGreaterThanOrEqual(1);
    // Pipeline turns it into a poison step
    const steps = getPostCombatPipelineSteps({ attacker, defender, result });
    expect(steps).toContainEqual({ type: 'poison', targetSide: 'defender', damage: 7 });
  });

  it('venom on the defender weapon poisons the attacker on counter', () => {
    forceHitsNoCrits();
    const { attacker, defender } = setupCombat({ defImbue: 'venom' });
    const result = resolveCombat(
      attacker,
      attacker.weapon,
      defender,
      defender.weapon,
      1,
      plain,
      plain,
      baseSkillCtx,
    );
    expect(result.poisonEffects).toContainEqual({ target: 'attacker', damage: 7 });
  });

  it('venom does not fire without the imbue catalog or when a side died', () => {
    forceHitsNoCrits();
    const { attacker, defender } = setupCombat({ atkImbue: 'venom' });
    const noCatalog = resolveCombat(
      attacker,
      attacker.weapon,
      defender,
      defender.weapon,
      1,
      plain,
      plain,
      null,
    );
    expect(noCatalog.poisonEffects).toEqual([]);

    const kill = setupCombat({ atkImbue: 'venom', defOverrides: { currentHP: 1 } });
    const killResult = resolveCombat(
      kill.attacker,
      kill.attacker.weapon,
      kill.defender,
      kill.defender.weapon,
      1,
      plain,
      plain,
      baseSkillCtx,
    );
    expect(killResult.defenderDied).toBe(true);
    expect(killResult.poisonEffects).toEqual([]);
  });
});

describe('Imbue combat — binding post-combat root', () => {
  it('procs at 50%: emits imbueStatusEffects on a roll just under 50', () => {
    // Roll order per strike: hitRoll, critRoll (both 0.49*100=49 → hit, no crit at
    // crit 0)… final call is the binding proc roll: 49 < 50 succeeds.
    vi.spyOn(Math, 'random').mockReturnValue(0.49);
    const { attacker, defender } = setupCombat({ atkImbue: 'binding' });
    const result = resolveCombat(
      attacker,
      attacker.weapon,
      defender,
      defender.weapon,
      1,
      plain,
      plain,
      baseSkillCtx,
    );
    expect(result.imbueStatusEffects).toEqual([
      { target: 'defender', sourceSide: 'attacker', status: 'root', durationPhases: 1 },
    ]);
  });

  it('does not proc on a roll of 50 or more', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // proc roll 50 >= 50
    const { attacker, defender } = setupCombat({ atkImbue: 'binding' });
    const result = resolveCombat(
      attacker,
      attacker.weapon,
      defender,
      defender.weapon,
      1,
      plain,
      plain,
      baseSkillCtx,
    );
    expect(result.imbueStatusEffects).toEqual([]);
  });

  it('is hit-gated: no proc when every strike missed', () => {
    // hitRoll 99.9 ≥ hit → all strikes miss; proc roll would succeed (but
    // must never be reached because no hit landed).
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    const { attacker, defender } = setupCombat({ atkImbue: 'binding' });
    const result = resolveCombat(
      attacker,
      attacker.weapon,
      defender,
      defender.weapon,
      1,
      plain,
      plain,
      baseSkillCtx,
    );
    expect(result.events.every((e) => e.type !== 'strike' || e.miss)).toBe(true);
    expect(result.imbueStatusEffects).toEqual([]);
  });

  it('pipeline maps the proc to a tier2_status step that roots the defender', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.2);
    const { attacker, defender } = setupCombat({ atkImbue: 'binding' });
    const result = resolveCombat(
      attacker,
      attacker.weapon,
      defender,
      defender.weapon,
      1,
      plain,
      plain,
      baseSkillCtx,
    );
    const steps = getPostCombatPipelineSteps({ attacker, defender, result });
    const statusStep = steps.find((s) => s.type === 'tier2_status');
    expect(statusStep).toEqual({
      type: 'tier2_status',
      sourceSide: 'attacker',
      targetSide: 'defender',
      status: 'root',
      durationPhases: 1,
    });
    // Apply like BattleScene/harness do (+1 phase for recovery decrement timing)
    const applied = applyCondition(defender, statusStep.status, statusStep.durationPhases + 1, {
      recoveryChance: 0,
    });
    expect(applied).toBe(true);
    expect(isRooted(defender)).toBe(true);
  });

  it('respects statusImmunity at application time', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.2);
    const { attacker, defender } = setupCombat({
      atkImbue: 'binding',
      defOverrides: { accessory: { combatEffects: { statusImmunity: true } } },
    });
    const result = resolveCombat(
      attacker,
      attacker.weapon,
      defender,
      defender.weapon,
      1,
      plain,
      plain,
      baseSkillCtx,
    );
    const steps = getPostCombatPipelineSteps({ attacker, defender, result });
    const statusStep = steps.find((s) => s.type === 'tier2_status');
    expect(statusStep).toBeTruthy();
    expect(isStatusImmune(defender)).toBe(true);
    const applied = applyCondition(defender, statusStep.status, statusStep.durationPhases + 1, {
      recoveryChance: 0,
    });
    expect(applied).toBe(false);
    expect(isRooted(defender)).toBe(false);
  });

  it('draws no extra RNG for unimbued combats (stream stability)', () => {
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const base = setupCombat({});
    resolveCombat(
      base.attacker,
      base.attacker.weapon,
      base.defender,
      base.defender.weapon,
      1,
      plain,
      plain,
      baseSkillCtx,
    );
    const baselineCalls = spy.mock.calls.length;
    spy.mockClear();
    const bound = setupCombat({ atkImbue: 'binding' });
    resolveCombat(
      bound.attacker,
      bound.attacker.weapon,
      bound.defender,
      bound.defender.weapon,
      1,
      plain,
      plain,
      baseSkillCtx,
    );
    // Binding adds exactly one proc roll on top of the baseline stream
    expect(spy.mock.calls.length).toBe(baselineCalls + 1);
  });
});
