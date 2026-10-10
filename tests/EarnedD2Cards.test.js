// PR D2's earned blessings at work (docs/specs/blessings-v3.md §6.6): Saint's Reliquary, Smith's
// Covenant, Thief's Lantern and Seer's Eye (the Mercenary Ledger: tests/MercenaryLedger.test.js;
// the route preview's scout: tests/BattleScout.test.js). Each card reaches its system through one
// shared engine path (StaffBlessings.staffRunOptions, EventEffects.planWear, ShrineBoons
// .stealRunOptions, BattleInformation.canInspectUnit), so the scene and the harness cannot
// disagree.
//
// Each test names the realistic failure it catches.
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));
vi.mock('../src/ui/HintDisplay.js', () => ({
  showImportantHint: vi.fn(async () => {}),
  showMinorHint: vi.fn(),
  showContextualHint: vi.fn(),
}));

import fs from 'node:fs';
import { RunManager } from '../src/engine/RunManager.js';
import {
  calculateStaffHealOutput,
  getEffectiveStaffRange,
  getStaffMaxUses,
  resolveHeal,
} from '../src/engine/Combat.js';
import { staffRunOptions } from '../src/engine/StaffBlessings.js';
import { settleStaffHeal } from '../src/engine/StaffSettlement.js';
import { findRelocateTargets, getRelocationDestinations } from '../src/engine/StaffRelocation.js';
import { sceneHealPreview } from '../src/ui/healTargetPreview.js';
import { battleItemSummary } from '../src/ui/battleItemSummary.js';
import { HealController } from '../src/ui/HealController.js';
import { HeadlessBattle } from './harness/HeadlessBattle.js';
import { HeadlessGrid } from './harness/HeadlessGrid.js';
import { freeForgeAvailable } from '../src/engine/ShopCommands.js';
import { chooseEventOption, completeEventBattle, eventView } from '../src/engine/EventCommands.js';
import { describeResult } from '../src/engine/EventResultWords.js';
import { stealRunOptions } from '../src/engine/ShrineBoons.js';
import { settleSteal, stealBlockReason, STEAL_REASONS } from '../src/engine/Steal.js';
import { stealStatus } from '../src/engine/ActionAbilitySystem.js';
import { canInspectUnit, markFoesShown } from '../src/engine/BattleInformation.js';
import { createPlayerKnowledge } from '../src/engine/PlayerKnowledge.js';
import { isFoeStepSeen } from '../src/ui/EnemyPhasePacing.js';
import { historyUnitVisible } from '../src/ui/BattleHistoryRecorder.js';
import { combatTimelineFacts } from '../src/engine/BattleTimelineFacts.js';
import { foesShownOf, routeScoutOf, staffHealRangeOf } from '../src/engine/EarnedBoons.js';
import { chooseEventPlan, choiceGrantsEarned } from './sim/RunPolicies.js';
import { findEvent } from '../src/engine/EventSystem.js';
import { arriveAs, newRun } from './eventKit.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const realRandom = Math.random;
afterEach(() => {
  Math.random = realRandom;
  vi.restoreAllMocks();
});

function runHolding(ids, { seed = 7, difficultyId = 'normal' } = {}) {
  const rm = new RunManager(data);
  rm.startRun({ runSeed: seed, difficultyId, applyBlessingsAtStart: false });
  for (const id of ids) expect(rm.addBlessingMidRun(id, { earned: true }), id).toBe(true);
  return rm;
}
const roundTrip = (rm) => RunManager.fromJSON(JSON.parse(JSON.stringify(rm.toJSON())), rm.gameData);
const staff = (name) => structuredClone(data.weapons.find((w) => w.name === name));
const unit = (name, faction, col, row, extra = {}) => ({
  name,
  faction,
  col,
  row,
  currentHP: 10,
  stats: { HP: 40, STR: 5, MAG: 6, SKL: 5, SPD: 5, DEF: 5, RES: 5, LCK: 5, MOV: 5 },
  moveType: 'Infantry',
  proficiencies: [{ type: 'Staff', rank: 'Prof' }],
  inventory: [],
  skills: [],
  ...extra,
});

// ── Saint's Reliquary ──────────────────────────────────────────────────────

describe("Saint's Reliquary: staves heal 5 more and reach a tile further", () => {
  it("a player's staves only: the enemy healer and a green ally get nothing", () => {
    // Failure: the bonus rides every healer (a foe's Heal mends 5 more against you).
    const rm = runHolding(['saints_reliquary']);
    expect(staffHealRangeOf(rm)).toEqual({ heal: 5, range: 1 });
    expect(staffRunOptions(rm, { faction: 'player' })).toEqual({ healBonus: 5, rangeBonus: 1 });
    expect(staffRunOptions(rm, { faction: 'enemy' })).toEqual({});
    expect(staffRunOptions(rm, { faction: 'npc' })).toEqual({});
    expect(staffRunOptions(runHolding([]), { faction: 'player' })).toEqual({});
    // The enemy AI resolves its heal with no options (AIController), so its staff is the catalog's.
    const foe = unit('Foe', 'enemy', 0, 0);
    const hurt = unit('Hurt', 'enemy', 0, 1, { currentHP: 1 });
    expect(resolveHeal(staff('Heal'), foe, hurt, staffRunOptions(rm, foe)).healAmount).toBe(
      foe.stats.MAG + 5,
    );
  });

  it('adds the 5 HP before the heal multiplier, and the missing-HP cap still holds', () => {
    // Failure: the bonus is added after the multiplier (a cut price takes nothing off it), or
    // pushes a target past its max HP.
    const rm = runHolding(['saints_reliquary']);
    rm.blessingRuntimeModifiers.healingEffectivenessMultiplier = 0.5;
    const healer = unit('Cleric', 'player', 0, 0);
    const options = staffRunOptions(rm, healer);
    expect(options).toEqual({ healBonus: 5, rangeBonus: 1, healingMultiplier: 0.5 });
    // floor((MAG 6 + healBase 5 + 5) × 0.5) = 8.
    expect(calculateStaffHealOutput(staff('Heal'), healer, options)).toBe(8);
    const nearlyFull = unit('Ally', 'player', 0, 1, { currentHP: 38 });
    expect(resolveHeal(staff('Heal'), healer, nearlyFull, options).healAmount).toBe(2);
  });

  it('the preview says what the heal does (the scene, the settlement and the harness agree)', () => {
    // Failure: the preview is built from its own options (the multiplier alone), so it reads
    // "+11" for a heal that restores 16.
    const rm = runHolding(['saints_reliquary']);
    const healer = unit('Cleric', 'player', 0, 0);
    healer.weapon = staff('Heal');
    healer.inventory = [healer.weapon];
    const target = unit('Ally', 'player', 0, 1, { currentHP: 5 });
    const preview = sceneHealPreview({ selectedUnit: healer, runManager: rm }, target);
    expect(preview.amount).toBe(6 + 5 + 5);
    const settled = settleStaffHeal({
      staff: healer.weapon,
      healer,
      targets: [target],
      healOpts: staffRunOptions(rm, healer),
    });
    expect(settled.targets[0].healAmount).toBe(preview.amount);
    expect(target.currentHP).toBe(preview.to);
    // The harness heals through the same options (HeadlessBattle._healOptions).
    expect(HeadlessBattle.prototype._healOptions.call({ runManager: rm }, healer)).toEqual(
      staffRunOptions(rm, healer),
    );
  });

  it('reaches one tile further: the battle menu and the harness offer the ally there', () => {
    // Failure: the range is read without the run's options somewhere (the heal is offered by
    // the harness and not the scene, or shown in the sheet and refused in battle).
    const rm = runHolding(['saints_reliquary']);
    const heal = staff('Heal'); // range 1
    const healer = unit('Cleric', 'player', 0, 0, { inventory: [heal], weapon: heal });
    const far = unit('Far', 'player', 0, 2, { currentHP: 5 });
    const scene = {
      runManager: rm,
      playerUnits: [healer, far],
      npcUnits: [],
      grid: { fogEnabled: false },
    };
    const reach = (run) =>
      new HealController({ ...scene, runManager: run }).findHealTargets(healer, heal);
    expect(reach(rm)).toEqual([far]);
    expect(reach(runHolding([]))).toEqual([]);
    const harness = {
      runManager: rm,
      grid: { fogEnabled: false },
      playerUnits: [healer, far],
      npcUnits: [],
      _getActiveHealStaff: () => heal,
      _healOptions: HeadlessBattle.prototype._healOptions,
    };
    expect(HeadlessBattle.prototype._findHealTargets.call(harness, healer)).toEqual([far]);
    // The sheets read the same reach.
    expect(getEffectiveStaffRange(heal, healer, staffRunOptions(rm, healer))).toEqual({
      min: 1,
      max: 2,
    });
    expect(battleItemSummary(heal, healer, { run: rm })).toContain('Range 1-2');
    expect(battleItemSummary(heal, healer, { run: runHolding([]) })).toContain('Range 1 ');
  });

  it("a Warp's radius and a Rescue's pull reach further too; the uses are untouched", () => {
    const rm = runHolding(['saints_reliquary']);
    const options = staffRunOptions(rm, { faction: 'player' });
    const grid = { cols: 12, rows: 12, getMoveCost: () => 1 };
    const empty = () => null;
    const warp = staff('Warp Staff');
    const caster = unit('Mage', 'player', 6, 6);
    const ally = unit('Ally', 'player', 6, 7);
    const far = (tiles) => Math.max(...tiles.map((t) => Math.abs(t.col - 6) + Math.abs(t.row - 6)));
    expect(far(getRelocationDestinations(warp, caster, ally, grid, empty))).toBe(4);
    expect(far(getRelocationDestinations(warp, caster, ally, grid, empty, options))).toBe(5);
    const rescue = staff('Rescue Staff');
    const distant = unit('Distant', 'player', 6, 10);
    expect(findRelocateTargets(rescue, caster, [caster, distant], grid, empty)).toEqual([]);
    expect(findRelocateTargets(rescue, caster, [caster, distant], grid, empty, options)).toEqual([
      distant,
    ]);
    expect(getStaffMaxUses(warp, caster, options)).toBe(getStaffMaxUses(warp, caster));
  });

  it('every reader of a staff passes the options (tests/StaffBlessingBoundary.test.js scans)', () => {
    const boundary = fs.readFileSync('tests/StaffBlessingBoundary.test.js', 'utf8');
    for (const name of ['resolveHeal', 'getEffectiveStaffRange', 'settleStaffHeal'])
      expect(boundary).toContain(name);
  });
});

// ── Smith's Covenant ───────────────────────────────────────────────────────

const smithWeapons = (run) => {
  for (const u of run.roster) for (const w of u.inventory || []) delete w._wear;
};

describe("Smith's Covenant: the Wandering Smith's word", () => {
  it('his covenant is a choice before Leave, for gold, and grants the card once', () => {
    // Failure: the choice grants nothing (the effect unknown), charges nothing, or can be bought
    // twice (no `earnedAvailable` gate: the second purchase is refused after the gold is gone).
    const run = newRun({ seed: 401, gold: 5000 });
    const node = arriveAs(run, 'wandering_smith');
    const ids = eventView(run, node.id).choices.map((c) => c.id);
    expect(ids.slice(-2)).toEqual(['covenant', 'leave']);
    const cost = eventView(run, node.id).choices.find((c) => c.id === 'covenant').cost;
    expect(cost).toBeGreaterThan(0);
    const chosen = chooseEventOption(run, node.id, 'covenant');
    expect(chosen.ok, chosen.reason).toBe(true);
    expect(run.gold).toBe(5000 - cost);
    expect(run.getActiveBlessingIds()).toContain('smiths_covenant');
    const record = chosen.results.find((r) => r.kind === 'earnedBlessing');
    expect(describeResult(record, data).text).toBe("Earned blessing: Smith's Covenant");
    // Another smith on the road: the covenant is greyed, and says why.
    const again = arriveAs(
      run,
      'wandering_smith',
      run.nodeMap.nodes.find((n) => n !== node && !n.completed && n.type !== 'boss'),
    );
    const choice = eventView(run, again.id).choices.find((c) => c.id === 'covenant');
    expect(choice.block).toBe('You already carry it.');
  });

  it("the new choice moves no other choice's outcome (each choice rolls its own key)", () => {
    // Failure: outcomes are drawn from one stream per node (or by choice index), so adding the
    // covenant changes what tempering does for the same seed.
    const without = structuredClone(data);
    const smith = without.events.events.find((e) => e.id === 'wandering_smith');
    smith.choices = smith.choices.filter((c) => c.id !== 'covenant');
    const outcomes = (gameData) =>
      Array.from({ length: 40 }, (_, i) => {
        const run = newRun({ seed: 900 + i, data: gameData, gold: 5000 });
        const node = arriveAs(run, 'wandering_smith');
        const target = eventView(run, node.id)
          .choices.find((c) => c.id === 'temper')
          .target.candidates.find((c) => c.ok)?.uid;
        return chooseEventOption(run, node.id, 'temper', { targetUid: target }).outcomeId;
      });
    const withCovenant = outcomes(data);
    expect(withCovenant).toEqual(outcomes(without));
    expect(new Set(withCovenant)).toEqual(new Set(['tempered', 'too_hot']));
  });

  it("held, a botched temper never marks the steel: the outcome's fallback stands in", () => {
    // Failure: the covenant protects nothing (the wear lands), or the fallback does not fire
    // (the outcome is refused, so the player loses the event's page).
    let seen = 0;
    for (let seed = 1; seed <= 200 && seen < 3; seed++) {
      const run = newRun({ seed, gold: 5000 });
      expect(run.addBlessingMidRun('smiths_covenant', { earned: true })).toBe(true);
      smithWeapons(run);
      const node = arriveAs(run, 'wandering_smith');
      const candidate = eventView(run, node.id)
        .choices.find((c) => c.id === 'temper')
        .target.candidates.find((c) => c.ok);
      const target = run.roster.find((u) => u.unitUid === candidate.uid);
      const weapon = target.weapon;
      const name = weapon.name;
      const hp = target.currentHP;
      const chosen = chooseEventOption(run, node.id, 'temper', { targetUid: candidate.uid });
      expect(chosen.ok, chosen.reason).toBe(true);
      if (chosen.outcomeId !== 'too_hot') continue;
      seen += 1;
      expect(weapon.name).toBe(name); // an unforged weapon, unmarked
      expect(weapon._wear).toBeUndefined();
      expect(target.currentHP).toBeLessThan(hp); // the fallback: the sparks find the hand
      expect(chosen.results.some((r) => r.kind === 'wear')).toBe(false);
    }
    expect(seen).toBe(3);
  });

  it('without it, the same botched temper still wears the weapon', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const run = newRun({ seed, gold: 5000 });
      smithWeapons(run);
      const node = arriveAs(run, 'wandering_smith');
      const candidate = eventView(run, node.id)
        .choices.find((c) => c.id === 'temper')
        .target.candidates.find((c) => c.ok);
      const chosen = chooseEventOption(run, node.id, 'temper', { targetUid: candidate.uid });
      if (chosen.outcomeId !== 'too_hot') continue;
      expect(chosen.results.some((r) => r.kind === 'wear')).toBe(true);
      return;
    }
    throw new Error('no botched temper in 200 seeds');
  });

  it("stacks with Smith's Mark: each shop's first two forges are free", () => {
    // Failure: the second free-forge boon overwrites the first (one free forge for two cards).
    const rm = runHolding(['smiths_covenant']);
    expect(rm.getFreeForgesPerShop()).toBe(1);
    expect(rm.addBlessingMidRun('frugal_smith')).toBe(true);
    expect(rm.getFreeForgesPerShop()).toBe(2);
    expect(freeForgeAvailable(rm, 1)).toBe(true);
    expect(freeForgeAvailable(rm, 2)).toBe(false);
    expect(roundTrip(rm).getFreeForgesPerShop()).toBe(2);
  });

  it('the sims leave the covenant alone unless told to take earned blessings (D-25)', () => {
    // Failure: a default sim buys the covenant (the fullrun numbers move).
    const run = newRun({ seed: 402, gold: 5000 });
    for (const u of run.roster) {
      u.inventory = [];
      u.weapon = null;
    }
    const node = arriveAs(run, 'wandering_smith');
    const event = findEvent(run.gameData.events, 'wandering_smith');
    expect(choiceGrantsEarned(event, 'covenant')).toBe(true);
    expect(chooseEventPlan(run, node.id).choiceId).toBe('leave');
    expect(chooseEventPlan(run, node.id, { earned: true }).choiceId).toBe('covenant');
  });
});

// ── Thief's Lantern ────────────────────────────────────────────────────────

describe("Thief's Lantern: the Collectors' lamp", () => {
  const fightAndWin = (run) => {
    const node = arriveAs(run, 'collectors');
    const chosen = chooseEventOption(run, node.id, 'fight');
    expect(chosen.ok, chosen.reason).toBe(true);
    run.completeBattle(run.getRoster(), node.id, 0, { turnCount: 5, turnPar: 5 });
    return { node, done: completeEventBattle(run, node.id) };
  };

  it("the won fight's spoils grant it with the strongbox, once", () => {
    // Failure: the afterVictory grant is missing or replaces the gold.
    const run = newRun({ seed: 411 });
    const gold = run.gold;
    const { node, done } = fightAndWin(run);
    expect(done.ok, done.reason).toBe(true);
    expect(run.gold).toBeGreaterThan(gold);
    expect(run.getActiveBlessingIds()).toContain('thiefs_lantern');
    expect(run.earnedBlessingPicks[`event:${node.id}`]).toMatchObject({
      status: 'taken',
      chosen: 'thiefs_lantern',
    });
    expect(routeScoutOf(run)).toBe(1);
  });

  it('a player thief skips the speed check; a foe never does', () => {
    // Failure: the waiver reaches enemy thieves, or the row still says "Too slow" for a holder.
    const rm = runHolding(['thiefs_lantern']);
    const slow = { faction: 'player', col: 0, row: 0, currentHP: 10, stats: { SPD: 1, STR: 5 }, inventory: [], consumables: [] }; // prettier-ignore
    const quick = { faction: 'enemy', col: 1, row: 0, currentHP: 10, stats: { SPD: 20, STR: 5 }, carriedItem: { name: 'Vulnerary', type: 'Consumable', uses: 2 } }; // prettier-ignore
    expect(stealRunOptions(rm, slow)).toEqual({ ignoreSpeed: true });
    expect(stealRunOptions(rm, { ...slow, faction: 'enemy' })).toEqual({});
    expect(stealBlockReason(slow, quick, stealRunOptions(runHolding([]), slow))).toBe(
      STEAL_REASONS.tooSlow,
    );
    expect(stealBlockReason(slow, quick, stealRunOptions(rm, slow))).toBeNull();
    const status = stealStatus(slow, {}, { enemies: [quick], ...stealRunOptions(rm, slow) });
    expect(status.reason).toBeNull();
    expect(status.targets.map((t) => t.unit)).toEqual([quick]);
    // The settlement reads the run itself (the scene and the harness both call it).
    const done = settleSteal(slow, quick, { run: rm });
    expect(done?.destination).toBe('bag');
    expect(quick.carriedItem).toBeUndefined();
  });
});

// ── Seer's Eye ─────────────────────────────────────────────────────────────

describe("Seer's Eye: fog never hides a foe", () => {
  const layout = (n) => Array.from({ length: n }, () => Array(n).fill(0));
  const foggy = (foesShown) => {
    const grid = new HeadlessGrid(12, 12, data.terrain, layout(12), true);
    markFoesShown(grid, foesShown ? { foesShown: true } : {});
    grid.updateFogOfWar([{ col: 0, row: 0, moveType: 'Infantry' }]);
    return grid;
  };

  it('a foe in the fog is shown and known to the previews; the terrain and green units stay fogged', () => {
    // Failure: the Eye lifts the fog itself (terrain and a caravan show), or misses a preview
    // (the Danger zone or the blue range still treat the foe as unknown).
    const grid = foggy(true);
    const foe = { faction: 'enemy', col: 10, row: 10, currentHP: 5 };
    const caravan = { faction: 'npc', isCaravan: true, col: 9, row: 10, currentHP: 5 };
    expect(grid.isVisible(10, 10)).toBe(false);
    expect(canInspectUnit(grid, foe)).toBe(true);
    expect(canInspectUnit(grid, caravan)).toBe(false);
    expect(createPlayerKnowledge({ grid, units: [foe, caravan] }).units).toEqual([foe]);
    expect(isFoeStepSeen(grid, 10, 10)).toBe(true);
    const plain = foggy(false);
    expect(canInspectUnit(plain, foe)).toBe(false);
    expect(isFoeStepSeen(plain, 10, 10)).toBe(false);
  });

  it('the run writes `foesShown` into the params only while held; the grid reads it at build', () => {
    const rm = runHolding(['seers_eye']);
    const node = rm.nodeMap.nodes.find((n) => n.type === 'battle');
    expect(foesShownOf(rm)).toBe(true);
    expect(rm.getBattleParams(node).foesShown).toBe(true);
    expect('foesShown' in runHolding([]).getBattleParams(node)).toBe(false);
    expect(roundTrip(rm).getBattleParams(node).foesShown).toBe(true);
    const battle = new HeadlessBattle(structuredClone(data), {
      act: 'act1',
      objective: 'rout',
      fogEnabled: true,
      foesShown: true,
    });
    battle.init();
    expect(battle.grid.foesShown).toBe(true);
    expect(battle.enemyUnits.every((e) => canInspectUnit(battle.grid, e))).toBe(true);
  });

  it('BattleScene marks its grid as it builds it, and draws foes by canInspectUnit', () => {
    // Failure: the scene never reads the key (the harness shows foes the scene hides), or a
    // sprite or the attack list still asks the tile.
    const src = fs.readFileSync('src/scenes/BattleScene.js', 'utf8');
    const build = src.indexOf('this.grid = new Grid(');
    expect(src.indexOf('markFoesShown(this.grid, this.battleParams)')).toBeGreaterThan(build);
    const visibility = src.slice(src.indexOf('  updateEnemyVisibility() {'));
    const enemyLoop = visibility.slice(0, visibility.indexOf('for (const npc of'));
    expect(enemyLoop).toMatch(/canInspectUnit\(this\.grid, enemy\)/);
    expect(enemyLoop).not.toMatch(/isVisible\(/);
    const targets = src.slice(src.indexOf('In fog mode, player can only target'));
    expect(targets.slice(0, 300)).toMatch(/canInspectUnit\(this\.grid, enemy\)/);
  });

  it('the battle history and the timeline name a shown foe, and keep its walk', () => {
    // Failure: the sprite shows the foe but the history reads "Unseen enemy" (two rules for one
    // fact), or drops the walk the player watched.
    const grid = foggy(true);
    const scene = { grid, runManager: { battleInProgress: {} } };
    const foe = { name: 'Brigand', faction: 'enemy', col: 10, row: 10, currentHP: 5 };
    const ally = { name: 'Edric', faction: 'player', col: 0, row: 0, currentHP: 5 };
    expect(historyUnitVisible(scene, foe)).toBe(true);
    expect(historyUnitVisible({ ...scene, grid: foggy(false) }, foe)).toBe(false);
    const strike = { events: [{ type: 'strike', attackerSide: 'attacker', damage: 3 }] };
    expect(combatTimelineFacts(scene, foe, ally, strike)).toContain(
      'Brigand hit Edric for 3 damage.',
    );
    expect(combatTimelineFacts({ ...scene, grid: foggy(false) }, foe, ally, strike)).toContain(
      'Unseen enemy hit Edric for 3 damage.',
    );
  });

  it("the enemy AI's view never changes: it never reads the fog", () => {
    // Failure: the AI starts reading what the player sees (a foe plays differently because the
    // player holds the Eye).
    for (const file of ['src/engine/AIController.js']) {
      expect(fs.existsSync(file), file).toBe(true);
      const src = fs
        .readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '');
      expect(src, file).not.toMatch(/canInspectUnit|foesShown|isVisible\(|PlayerKnowledge/);
    }
  });
});

// ── The save ───────────────────────────────────────────────────────────────

describe("the D2 cards' run state survives a save, and an old save reads none", () => {
  it('round-trips every field and drops a malformed one to its default', () => {
    // Failure: a field is not saved (the card stops working after a reload), or a hand-edited
    // or corrupt value survives a load (a negative fee, a scout rung past the Eye).
    const rm = runHolding(['saints_reliquary', 'mercenary_ledger', 'smiths_covenant', 'seers_eye']);
    const back = roundTrip(rm);
    const mods = back.blessingRuntimeModifiers;
    expect(mods).toMatchObject({
      staffHealBonus: 5,
      staffRangeBonus: 1,
      arenaFeeMultiplier: 0.5,
      arenaVisitBonus: 1,
      weaponsNeverWear: true,
      routeScout: 2,
      foesShown: true,
    });
    const raw = JSON.parse(JSON.stringify(rm.toJSON()));
    Object.assign(raw.blessingRuntimeModifiers, {
      staffHealBonus: -3,
      staffRangeBonus: 'far',
      arenaFeeMultiplier: 0,
      arenaVisitBonus: 40,
      weaponsNeverWear: 'yes',
      routeScout: 9,
      foesShown: 1,
    });
    const bad = RunManager.fromJSON(raw, data).blessingRuntimeModifiers;
    expect(bad).toMatchObject({
      staffHealBonus: 0,
      staffRangeBonus: 0,
      arenaFeeMultiplier: 1,
      arenaVisitBonus: 5,
      weaponsNeverWear: false,
      routeScout: 2,
      foesShown: false,
    });
  });

  it('a save from before PR D2 (no fields) loads holding none of them', () => {
    const rm = runHolding([]);
    const raw = JSON.parse(JSON.stringify(rm.toJSON()));
    for (const key of [
      'staffHealBonus',
      'staffRangeBonus',
      'arenaFeeMultiplier',
      'arenaVisitBonus',
      'weaponsNeverWear',
      'routeScout',
      'foesShown',
    ])
      delete raw.blessingRuntimeModifiers[key];
    const back = RunManager.fromJSON(raw, data);
    expect(back.blessingRuntimeModifiers).toMatchObject({
      staffHealBonus: 0,
      staffRangeBonus: 0,
      arenaFeeMultiplier: 1,
      arenaVisitBonus: 0,
      weaponsNeverWear: false,
      routeScout: 0,
      foesShown: false,
    });
    expect(staffRunOptions(back, { faction: 'player' })).toEqual({});
  });
});
