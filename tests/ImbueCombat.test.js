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
    expect(keenForecast.attacker.skills).toContainEqual({ id: 'imbue_keen', name: 'Keen' });
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
    expect(forecast.defender.skills).toContainEqual({ id: 'imbue_keen', name: 'Keen' });
  });

  it('warded: +2 DEF/RES reduces damage taken both attacking and defending', () => {
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
    // Warded on the DEFENDER's weapon reduces attacker damage by 2
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
    expect(defForecast.attacker.damage).toBe(Math.max(0, baseForecast.attacker.damage - 2));
    // Warded on the ATTACKER's weapon reduces counter damage by 2
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
    expect(atkForecast.defender.damage).toBe(Math.max(0, baseForecast.defender.damage - 2));
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

describe('Imbue combat — vampiric lifesteal', () => {
  it('heals 30% of damage dealt per strike via drainPercent', () => {
    forceHitsNoCrits();
    const { attacker, defender } = setupCombat({
      atkImbue: 'vampiric',
      atkOverrides: { currentHP: 10 },
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
    expect(forecast.attacker.drainPercent).toBeCloseTo(0.3);
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
    const firstStrike = result.events.find(
      (e) => e.type === 'strike' && e.attackerSide === 'attacker' && !e.miss,
    );
    expect(firstStrike.damage).toBeGreaterThan(0);
    expect(firstStrike.heal).toBe(Math.floor(firstStrike.damage * 0.3));
  });
});

describe('Imbue combat — venom post-combat poison', () => {
  it('emits 5 poison via the poisonEffects path and floors HP at 1', () => {
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
    expect(result.poisonEffects).toContainEqual({ target: 'defender', damage: 5 });
    expect(result.defenderHP).toBeGreaterThanOrEqual(1);
    // Pipeline turns it into a poison step
    const steps = getPostCombatPipelineSteps({ attacker, defender, result });
    expect(steps).toContainEqual({ type: 'poison', targetSide: 'defender', damage: 5 });
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
    expect(result.poisonEffects).toContainEqual({ target: 'attacker', damage: 5 });
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
  it('procs at 30%: emits imbueStatusEffects on a low roll', () => {
    // Roll order per strike: hitRoll, critRoll (both 0.2*100=20 → hit, crit vs
    // clamped crit)… final call is the binding proc roll. Use a low constant so
    // the proc roll (0.2*100=20 < 30) succeeds. Crit rolls also land (20 < crit
    // only if crit > 20 — crit here is 0 after LCK, so no crit).
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
    expect(result.imbueStatusEffects).toEqual([
      { target: 'defender', sourceSide: 'attacker', status: 'root', durationPhases: 1 },
    ]);
  });

  it('does not proc on a high roll', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // proc roll 50 >= 30
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
