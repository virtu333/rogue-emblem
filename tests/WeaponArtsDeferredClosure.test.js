// Closure suite for the final deferred weapon-art mechanics:
// Tier 3 on-hit status (Encloser/Ward Arrow/Silence Strike) and the bespoke
// trio (All or Nothing, Annihilate, Divine Flare). See
// docs/reports/weapon_arts_deferred_closure_spec_2026-06-11.md
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
  },
}));

import { loadGameData } from './testData.js';
import { BattleScene } from '../src/scenes/BattleScene.js';
import { HeadlessBattle } from './harness/HeadlessBattle.js';
import {
  getWeaponArtCombatMods,
  getWeaponArtTier2Effects,
  getWeaponArtMissEffects,
  getWeaponArtKillEffects,
} from '../src/engine/WeaponArtSystem.js';
import {
  getMissedStrikeCount,
  getPostCombatPipelineSteps,
  resolvePostCombatMove,
} from '../src/engine/WeaponArtPostCombat.js';
import {
  getCombatForecast,
  getEffectivenessMultiplier,
  mergeCombatMods,
} from '../src/engine/Combat.js';
import {
  applyCondition,
  hasCondition,
  isRooted,
  isSilenced,
  processConditionRecovery,
  willRemainRootedNextPhase,
} from '../src/engine/StatusConditionSystem.js';
import { summarizeWeaponArtEffect } from '../src/ui/WeaponArtVisibility.js';

const gameData = loadGameData();
const artById = new Map(gameData.weaponArts.arts.map((art) => [art.id, art]));

function makeUnit(overrides = {}) {
  const stats = overrides.stats || {
    HP: 30,
    STR: 10,
    MAG: 8,
    SKL: 8,
    SPD: 8,
    DEF: 8,
    RES: 8,
    LCK: 8,
    MOV: 5,
  };
  return {
    name: 'Unit',
    faction: 'player',
    col: 0,
    row: 0,
    currentHP: stats.HP,
    stats: { ...stats },
    mov: stats.MOV,
    ...overrides,
  };
}

function createSceneHarness() {
  const scene = new BattleScene();
  scene.turnManager = { turnNumber: 1 };
  scene.playerUnits = [];
  scene.enemyUnits = [];
  scene.npcUnits = [];
  scene.grid = {
    gridToPixel: (col, row) => ({ x: col * 16, y: row * 16 }),
  };
  scene.updateHPBar = vi.fn();
  scene.showMinorHintAt = vi.fn();
  scene.showPoisonDamage = vi.fn(async () => {});
  scene.removeUnit = vi.fn(async () => {});
  return scene;
}

function createHeadlessHarness() {
  const battle = new HeadlessBattle(gameData, { act: 'act1', objective: 'rout' });
  battle.turnManager = { turnNumber: 1 };
  battle.battleConfig = { objective: 'rout' };
  battle.grid = {
    cols: 10,
    rows: 10,
    getTerrainAt: () => null,
    getMoveCost: () => 1,
    fogEnabled: false,
  };
  battle.playerUnits = [];
  battle.enemyUnits = [];
  battle.npcUnits = [];
  return battle;
}

describe('deferred closure: catalog state', () => {
  it('no art carries a _deferredMechanic placeholder anymore', () => {
    const marked = gameData.weaponArts.arts.filter((art) => '_deferredMechanic' in art);
    expect(marked.map((art) => art.id)).toEqual([]);
  });

  it('status arts normalize to inflictStatus effects', () => {
    const cases = [
      { id: 'bow_encloser', status: 'root', durationPhases: 1 },
      { id: 'bow_ward_arrow', status: 'silence', durationPhases: 1 },
      { id: 'magic_silence_strike', status: 'silence', durationPhases: 2 },
    ];
    for (const expected of cases) {
      const art = artById.get(expected.id);
      expect(art).toBeTruthy();
      const effects = getWeaponArtTier2Effects(art).inflictStatus;
      expect(effects).toEqual([
        {
          target: 'defender',
          status: expected.status,
          durationPhases: expected.durationPhases,
        },
      ]);
    }
  });

  it('All or Nothing carries a 2x damage multiplier and 5 self-damage on miss', () => {
    const art = artById.get('bow_all_or_nothing');
    expect(getWeaponArtCombatMods(art).damageMultiplier).toBe(2);
    expect(getWeaponArtMissEffects(art).selfDamageOnMiss).toBe(5);
  });

  it('Annihilate ignores the weapon triangle and grants a kill buff', () => {
    const art = artById.get('legend_annihilate');
    expect(getWeaponArtCombatMods(art).ignoreWeaponTriangle).toBe(true);
    expect(getWeaponArtKillEffects(art).killBuff).toEqual({
      durationPhases: 1,
      stats: { STR: 4, SPD: 4 },
    });
  });

  it('Divine Flare ignores RES and is effective vs dark classes', () => {
    const mods = getWeaponArtCombatMods(artById.get('legend_divine_flare'));
    expect(mods.ignoreRES).toBe(true);
    expect(mods.effectiveness?.multiplier).toBe(3);
    expect(mods.effectiveness?.classNames).toContain('Warlock');
    expect(mods.effectiveness?.classNames).toContain('Entity');
  });
});

describe('deferred closure: status condition framework', () => {
  it('per-instance recoveryChance override defeats the config early-recovery roll', () => {
    const staffed = makeUnit({ name: 'Staffed' });
    const arted = makeUnit({ name: 'Arted' });
    applyCondition(staffed, 'silence', 3);
    applyCondition(arted, 'silence', 3, { recoveryChance: 0 });

    // rng always under the 0.5 config chance: config-based silence recovers early
    const events = processConditionRecovery([staffed, arted], () => 0.01);
    expect(events.map((evt) => evt.unit.name)).toEqual(['Staffed']);
    expect(isSilenced(staffed)).toBe(false);
    expect(isSilenced(arted)).toBe(true);
  });

  it('duration N+1 yields exactly N phases of effect under phase-start ticking', () => {
    const target = makeUnit();
    // duration 1 phase -> stored as 2 turns
    applyCondition(target, 'root', 2, { recoveryChance: 0 });
    expect(isRooted(target)).toBe(true);
    // Phase start of the rooted side: decrement 2 -> 1, still rooted for this phase
    processConditionRecovery([target], () => 0.99);
    expect(isRooted(target)).toBe(true);
    // Next phase start: 1 -> 0, recovered before acting
    processConditionRecovery([target], () => 0.99);
    expect(isRooted(target)).toBe(false);
  });
});

describe('deferred closure: review-pass hardening', () => {
  it('willRemainRootedNextPhase predicts post-recovery state for threat previews', () => {
    const freshlyRooted = makeUnit();
    applyCondition(freshlyRooted, 'root', 2, { recoveryChance: 0 });
    expect(willRemainRootedNextPhase(freshlyRooted)).toBe(true);

    // After its own phase-start tick the root sits at 1 turn remaining: the
    // unit recovers at its NEXT phase start, so previews must show full range.
    const expiringRoot = makeUnit();
    applyCondition(expiringRoot, 'root', 1, { recoveryChance: 0 });
    expect(isRooted(expiringRoot)).toBe(true);
    expect(willRemainRootedNextPhase(expiringRoot)).toBe(false);

    expect(willRemainRootedNextPhase(makeUnit())).toBe(false);
  });

  it('headless harness ticks condition recovery at each phase start', () => {
    const battle = createHeadlessHarness();
    const enemy = makeUnit({ name: 'Pinned', faction: 'enemy' });
    const player = makeUnit({ name: 'Hushed', faction: 'player' });
    battle.enemyUnits = [enemy];
    battle.playerUnits = [player];
    applyCondition(enemy, 'root', 2, { recoveryChance: 0 });
    applyCondition(player, 'silence', 2, { recoveryChance: 0 });

    battle._onPhaseChange('enemy', 1);
    expect(isRooted(enemy)).toBe(true);
    battle._onPhaseChange('player', 2);
    expect(isSilenced(player)).toBe(true);

    battle._onPhaseChange('enemy', 2);
    expect(isRooted(enemy)).toBe(false);
    battle._onPhaseChange('player', 3);
    expect(isSilenced(player)).toBe(false);
  });

  it('root pins units against art-driven post-combat displacement', () => {
    const gridArgs = {
      cols: 10,
      rows: 10,
      getMoveCost: () => 1,
      getUnitAt: () => null,
    };
    const makePair = () => {
      const source = makeUnit({ name: 'Src', col: 1, row: 1 });
      const target = makeUnit({ name: 'Tgt', faction: 'enemy', col: 2, row: 1 });
      const getUnitAt = (col, row) =>
        [source, target].find((u) => u.col === col && u.row === row) || null;
      return { source, target, args: { ...gridArgs, getUnitAt } };
    };

    // Rooted source cannot advance (no self-escape via movement arts)
    const advance = makePair();
    applyCondition(advance.source, 'root', 2, { recoveryChance: 0 });
    expect(
      resolvePostCombatMove({
        sourceUnit: advance.source,
        targetUnit: advance.target,
        mode: 'advance',
        ...advance.args,
      }),
    ).toEqual({ ok: false, reason: 'rooted' });

    // Rooted defender cannot be swapped or pushed off its tile
    const swap = makePair();
    applyCondition(swap.target, 'root', 2, { recoveryChance: 0 });
    expect(
      resolvePostCombatMove({
        sourceUnit: swap.source,
        targetUnit: swap.target,
        mode: 'swap',
        ...swap.args,
      }),
    ).toEqual({ ok: false, reason: 'rooted' });
    expect(
      resolvePostCombatMove({
        sourceUnit: swap.source,
        targetUnit: swap.target,
        mode: 'push',
        ...swap.args,
      }),
    ).toEqual({ ok: false, reason: 'rooted' });

    // Push only moves the defender: a rooted source may still push
    const push = makePair();
    applyCondition(push.source, 'root', 2, { recoveryChance: 0 });
    const pushResult = resolvePostCombatMove({
      sourceUnit: push.source,
      targetUnit: push.target,
      mode: 'push',
      ...push.args,
    });
    expect(pushResult.ok).toBe(true);
    expect(pushResult.assignments).toEqual([{ unit: push.target, col: 3, row: 1 }]);
  });
});

describe('deferred closure: post-combat steps', () => {
  const attacker = makeUnit({ name: 'Atk', faction: 'player' });
  const defender = makeUnit({ name: 'Def', faction: 'enemy', col: 1 });

  it('emits hit-gated tier2_status steps', () => {
    const art = artById.get('bow_encloser');
    const landed = getPostCombatPipelineSteps({
      attacker,
      defender,
      attackerWeaponArt: art,
      result: { events: [{ type: 'strike', attackerSide: 'attacker', miss: false, damage: 6 }] },
    });
    expect(landed.find((step) => step.type === 'tier2_status')).toEqual({
      type: 'tier2_status',
      sourceSide: 'attacker',
      targetSide: 'defender',
      status: 'root',
      durationPhases: 1,
    });

    const missed = getPostCombatPipelineSteps({
      attacker,
      defender,
      attackerWeaponArt: art,
      result: { events: [{ type: 'strike', attackerSide: 'attacker', miss: true, damage: 6 }] },
    });
    expect(missed.some((step) => step.type === 'tier2_status')).toBe(false);
  });

  it('emits miss self-damage per missed strike and never on hits', () => {
    const art = artById.get('bow_all_or_nothing');
    const events = [
      { type: 'strike', attackerSide: 'attacker', miss: true, damage: 9 },
      { type: 'strike', attackerSide: 'attacker', miss: true, damage: 9 },
      { type: 'strike', attackerSide: 'defender', miss: true, damage: 4 },
    ];
    expect(getMissedStrikeCount(events, 'attacker')).toBe(2);

    const steps = getPostCombatPipelineSteps({
      attacker,
      defender,
      attackerWeaponArt: art,
      result: { events },
    });
    expect(steps.find((step) => step.type === 'art_miss_self_damage')).toEqual({
      type: 'art_miss_self_damage',
      sourceSide: 'attacker',
      targetSide: 'attacker',
      amount: 10,
      nonLethal: true,
    });

    const landed = getPostCombatPipelineSteps({
      attacker,
      defender,
      attackerWeaponArt: art,
      result: { events: [{ type: 'strike', attackerSide: 'attacker', miss: false, damage: 9 }] },
    });
    expect(landed.some((step) => step.type === 'art_miss_self_damage')).toBe(false);
  });

  it('emits a hit-gated kill buff step', () => {
    const art = artById.get('legend_annihilate');
    const landed = getPostCombatPipelineSteps({
      attacker,
      defender,
      attackerWeaponArt: art,
      result: { events: [{ type: 'strike', attackerSide: 'attacker', miss: false, damage: 30 }] },
    });
    expect(landed.find((step) => step.type === 'art_kill_buff')).toEqual({
      type: 'art_kill_buff',
      sourceSide: 'attacker',
      targetSide: 'defender',
      artId: 'legend_annihilate',
      durationPhases: 1,
      stats: { STR: 4, SPD: 4 },
    });

    const missed = getPostCombatPipelineSteps({
      attacker,
      defender,
      attackerWeaponArt: art,
      result: { events: [{ type: 'strike', attackerSide: 'attacker', miss: true, damage: 30 }] },
    });
    expect(missed.some((step) => step.type === 'art_kill_buff')).toBe(false);
  });
});

describe('deferred closure: scene/headless parity', () => {
  let scene;
  let headless;

  beforeEach(() => {
    scene = createSceneHarness();
    headless = createHeadlessHarness();
  });

  async function applyStepsBoth({ attackerWeaponArt, result, sceneUnits, headlessUnits }) {
    scene.playerUnits = [sceneUnits.attacker];
    scene.enemyUnits = [sceneUnits.defender];
    headless.playerUnits = [headlessUnits.attacker];
    headless.enemyUnits = [headlessUnits.defender];
    await scene._applyResolvedCombatPostEffects({
      attacker: sceneUnits.attacker,
      defender: sceneUnits.defender,
      result,
      attackerWeaponArt,
    });
    headless._applyResolvedCombatPostEffects({
      attacker: headlessUnits.attacker,
      defender: headlessUnits.defender,
      result,
      attackerWeaponArt,
    });
  }

  it('applies root deterministically with the phase-aware duration', async () => {
    const result = {
      events: [{ type: 'strike', attackerSide: 'attacker', miss: false, damage: 6 }],
    };
    const sceneUnits = {
      attacker: makeUnit({ name: 'Atk', faction: 'player' }),
      defender: makeUnit({ name: 'Def', faction: 'enemy', col: 1 }),
    };
    const headlessUnits = {
      attacker: makeUnit({ name: 'Atk', faction: 'player' }),
      defender: makeUnit({ name: 'Def', faction: 'enemy', col: 1 }),
    };
    await applyStepsBoth({
      attackerWeaponArt: artById.get('bow_encloser'),
      result,
      sceneUnits,
      headlessUnits,
    });

    for (const defender of [sceneUnits.defender, headlessUnits.defender]) {
      expect(isRooted(defender)).toBe(true);
      const condition = defender._conditions.find((c) => c.id === 'root');
      expect(condition.turnsRemaining).toBe(2);
      expect(condition.recoveryChance).toBe(0);
    }
  });

  it('does not apply status to a defender that died in combat', async () => {
    const result = {
      events: [{ type: 'strike', attackerSide: 'attacker', miss: false, damage: 30 }],
    };
    const sceneUnits = {
      attacker: makeUnit({ name: 'Atk', faction: 'player' }),
      defender: makeUnit({ name: 'Def', faction: 'enemy', col: 1, currentHP: 0 }),
    };
    const headlessUnits = {
      attacker: makeUnit({ name: 'Atk', faction: 'player' }),
      defender: makeUnit({ name: 'Def', faction: 'enemy', col: 1, currentHP: 0 }),
    };
    await applyStepsBoth({
      attackerWeaponArt: artById.get('bow_encloser'),
      result,
      sceneUnits,
      headlessUnits,
    });
    expect(hasCondition(sceneUnits.defender, 'root')).toBe(false);
    expect(hasCondition(headlessUnits.defender, 'root')).toBe(false);
  });

  it('miss self-damage floors at 1 HP in both runtimes', async () => {
    const result = {
      events: [{ type: 'strike', attackerSide: 'attacker', miss: true, damage: 9 }],
    };
    const sceneUnits = {
      attacker: makeUnit({ name: 'Atk', faction: 'player', currentHP: 3 }),
      defender: makeUnit({ name: 'Def', faction: 'enemy', col: 1 }),
    };
    const headlessUnits = {
      attacker: makeUnit({ name: 'Atk', faction: 'player', currentHP: 3 }),
      defender: makeUnit({ name: 'Def', faction: 'enemy', col: 1 }),
    };
    await applyStepsBoth({
      attackerWeaponArt: artById.get('bow_all_or_nothing'),
      result,
      sceneUnits,
      headlessUnits,
    });
    expect(sceneUnits.attacker.currentHP).toBe(1);
    expect(headlessUnits.attacker.currentHP).toBe(1);
  });

  it('kill buff applies only when the opponent died, and expires next phase', async () => {
    const killResult = {
      events: [{ type: 'strike', attackerSide: 'attacker', miss: false, damage: 30 }],
    };
    const sceneUnits = {
      attacker: makeUnit({ name: 'Atk', faction: 'player', stats: { HP: 30, STR: 12, SPD: 9 } }),
      defender: makeUnit({ name: 'Def', faction: 'enemy', col: 1, currentHP: 0 }),
    };
    const headlessUnits = {
      attacker: makeUnit({ name: 'Atk', faction: 'player', stats: { HP: 30, STR: 12, SPD: 9 } }),
      defender: makeUnit({ name: 'Def', faction: 'enemy', col: 1, currentHP: 0 }),
    };
    await applyStepsBoth({
      attackerWeaponArt: artById.get('legend_annihilate'),
      result: killResult,
      sceneUnits,
      headlessUnits,
    });
    expect(sceneUnits.attacker.stats.STR).toBe(16);
    expect(sceneUnits.attacker.stats.SPD).toBe(13);
    expect(headlessUnits.attacker.stats.STR).toBe(16);
    expect(headlessUnits.attacker.stats.SPD).toBe(13);

    scene._expireTimedWeaponArtBuffs('player', 2);
    headless._expireTimedWeaponArtBuffs('player', 2);
    expect(sceneUnits.attacker.stats.STR).toBe(12);
    expect(headlessUnits.attacker.stats.STR).toBe(12);

    // Survivor: no buff
    const surviveResult = {
      events: [{ type: 'strike', attackerSide: 'attacker', miss: false, damage: 5 }],
    };
    const sceneUnits2 = {
      attacker: makeUnit({ name: 'Atk2', faction: 'player', stats: { HP: 30, STR: 12, SPD: 9 } }),
      defender: makeUnit({ name: 'Def2', faction: 'enemy', col: 1, currentHP: 10 }),
    };
    const headlessUnits2 = {
      attacker: makeUnit({ name: 'Atk2', faction: 'player', stats: { HP: 30, STR: 12, SPD: 9 } }),
      defender: makeUnit({ name: 'Def2', faction: 'enemy', col: 1, currentHP: 10 }),
    };
    await applyStepsBoth({
      attackerWeaponArt: artById.get('legend_annihilate'),
      result: surviveResult,
      sceneUnits: sceneUnits2,
      headlessUnits: headlessUnits2,
    });
    expect(sceneUnits2.attacker.stats.STR).toBe(12);
    expect(headlessUnits2.attacker.stats.STR).toBe(12);
  });
});

describe('deferred closure: combat math', () => {
  const ironAxe = { name: 'Iron Axe', type: 'Axe', might: 8, hit: 70, crit: 0, weight: 8 };
  const ironSword = { name: 'Iron Sword', type: 'Sword', might: 5, hit: 90, crit: 0, weight: 5 };
  const ironBow = { name: 'Iron Bow', type: 'Bow', might: 6, hit: 75, crit: 0, weight: 6 };

  function forecastWith(atkWeapon, defWeapon, artMods, defenderOverrides = {}) {
    const attacker = makeUnit({ name: 'Atk', weaponRank: 'Prof' });
    const defender = makeUnit({
      name: 'Def',
      faction: 'enemy',
      col: 1,
      weaponRank: 'Prof',
      ...defenderOverrides,
    });
    return getCombatForecast(attacker, atkWeapon, defender, defWeapon, 1, null, null, {
      atkWeaponArtMods: artMods,
    });
  }

  it('damageMultiplier doubles the art user damage but not the counter', () => {
    const base = forecastWith(ironBow, null, null);
    const doubled = forecastWith(
      ironBow,
      null,
      getWeaponArtCombatMods(artById.get('bow_all_or_nothing')),
    );
    expect(doubled.attacker.damage).toBe(base.attacker.damage * 2);
  });

  it('ignoreWeaponTriangle removes triangle hit/damage effects on both sides', () => {
    // Axe vs sword: axe is at triangle disadvantage, sword at advantage
    const normal = forecastWith(ironAxe, ironSword, { weaponArt: true });
    const ignored = forecastWith(ironAxe, ironSword, {
      weaponArt: true,
      ignoreWeaponTriangle: true,
    });
    // Attacker loses the -10 hit / -1 dmg disadvantage
    expect(ignored.attacker.hit).toBe(normal.attacker.hit + 10);
    expect(ignored.attacker.damage).toBe(normal.attacker.damage + 1);
    // Defender loses the +10 hit / +1 dmg advantage
    expect(ignored.defender.hit).toBe(normal.defender.hit - 10);
    expect(ignored.defender.damage).toBe(normal.defender.damage - 1);
  });

  it('ignoreRES zeroes the defender RES for a magical art strike', () => {
    const luce = gameData.weapons.find((w) => w.name === 'Luce');
    const artMods = getWeaponArtCombatMods(artById.get('legend_divine_flare'));
    const plain = forecastWith(luce, null, { weaponArt: true, atkBonus: artMods.atkBonus });
    const pierced = forecastWith(luce, null, artMods);
    // Defender RES is 8; ignoring it adds exactly 8 damage
    expect(pierced.attacker.damage).toBe(plain.attacker.damage + 8);
  });

  it('Divine Flare art + Luce weapon effectiveness stack to the 5x cap vs dark classes', () => {
    const luce = gameData.weapons.find((w) => w.name === 'Luce');
    const artMods = getWeaponArtCombatMods(artById.get('legend_divine_flare'));
    const vsKnight = forecastWith(luce, null, artMods, { className: 'General' });
    const vsWarlock = forecastWith(luce, null, artMods, { className: 'Warlock' });
    // Weapon 3x and art 3x both match dark targets; combined multiplier caps at
    // 5x, multiplying Luce's 14 might: (5 - 1) * 14 = +56 damage
    expect(vsWarlock.attacker.damage).toBe(vsKnight.attacker.damage + 56);
  });

  it("Luce's weapon special alone is effective vs dark classes (no art needed)", () => {
    const luce = gameData.weapons.find((w) => w.name === 'Luce');
    expect(getEffectivenessMultiplier(luce, makeUnit({ className: 'Warlock' }))).toBe(3);
    expect(getEffectivenessMultiplier(luce, makeUnit({ className: 'Dragon Lord' }))).toBe(3);
    expect(getEffectivenessMultiplier(luce, makeUnit({ className: 'General' }))).toBe(1);
  });

  it('new mods survive mergeCombatMods', () => {
    const merged = mergeCombatMods(
      { hitBonus: 5 },
      { damageMultiplier: 2, ignoreWeaponTriangle: true, ignoreRES: true },
    );
    expect(merged.damageMultiplier).toBe(2);
    expect(merged.ignoreWeaponTriangle).toBe(true);
    expect(merged.ignoreRES).toBe(true);
  });
});

describe('deferred closure: UI summaries', () => {
  it('summarizes the six closed arts with their real mechanics', () => {
    expect(summarizeWeaponArtEffect(artById.get('bow_encloser'))).toContain('Roots target 1 turn');
    expect(summarizeWeaponArtEffect(artById.get('bow_ward_arrow'))).toContain(
      'Silences target 1 turn',
    );
    expect(summarizeWeaponArtEffect(artById.get('magic_silence_strike'))).toContain(
      'Silences target 2 turns',
    );
    const allOrNothing = summarizeWeaponArtEffect(artById.get('bow_all_or_nothing'));
    expect(allOrNothing).toContain('2x damage');
    expect(allOrNothing).toContain('5 self-dmg on miss');
    const annihilate = summarizeWeaponArtEffect(artById.get('legend_annihilate'));
    expect(annihilate).toContain('Ignores triangle');
    expect(annihilate).toContain('On kill: +4 STR/+4 SPD (1 turn)');
    const divineFlare = summarizeWeaponArtEffect(artById.get('legend_divine_flare'));
    expect(divineFlare).toContain('Ignores RES');
    expect(divineFlare).toContain('3x vs dark foes');
  });
});
