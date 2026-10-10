// Cavalier's Hour, Saint's Reserve, Watcher's Grace, Patient Dawn and Lone Banner
// (docs/specs/blessings-v3.md §5, PR D4): the §5 cards that act in a battle. Battle-start effects
// are shared engine code BattleScene and the headless harness both call; the parity tests read
// both. Each test is named after a realistic way the rule breaks.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RunManager, clearBattleInProgressInSave } from '../src/engine/RunManager.js';
import {
  applyBattleStartDebuffs,
  clearBattleScopedDeltas,
} from '../src/engine/BattleStatDeltas.js';
import { moveTypeBattleDeltas } from '../src/engine/ShrineBoons.js';
import { staffRunOptions } from '../src/engine/StaffBlessings.js';
import { getStaffMaxUses, getStaffRemainingUses } from '../src/engine/Combat.js';
import { validateStaffAction } from '../src/engine/StaffSettlement.js';
import {
  battleParMapParams,
  calculatePar,
  getBossEnrageTurn,
} from '../src/engine/TurnBonusCalculator.js';
import { resolveDeployLimits } from '../src/engine/BattleDeployCount.js';
import { resolveRecruitNodeLevel } from '../src/engine/RecruitNodeSystem.js';
import { battleItemBrief, battleItemSummary } from '../src/ui/battleItemSummary.js';
import { equipmentComparison } from '../src/ui/equipmentComparison.js';
import { rewardForWhom } from '../src/ui/choiceContent.js';
import { createLordUnit, createUnit, equipAccessory } from '../src/engine/UnitManager.js';
import { addBurden } from '../src/engine/Burdens.js';
import { DEPLOY_LIMITS } from '../src/utils/constants.js';
import { HeadlessBattle } from './harness/HeadlessBattle.js';
import { loadFixture } from './fixtures/battles/index.js';
import { installSeed, restoreMathRandom } from '../sim/lib/SeededRNG.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const ROOT = join(import.meta.dirname, '..');
const sceneSource = readFileSync(join(ROOT, 'src/scenes/BattleScene.js'), 'utf8');
const harnessSource = readFileSync(join(ROOT, 'tests/harness/HeadlessBattle.js'), 'utf8');

let store;
beforeEach(() => {
  store = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  restoreMathRandom();
});

function startRun({ seed = 515, difficultyId = 'dusk' } = {}) {
  const rm = new RunManager(data);
  rm.startRun({ runSeed: seed, difficultyId, applyBlessingsAtStart: false });
  return rm;
}
function hold(rm, ...ids) {
  rm.activeBlessings = ids.map((id) => ({ id, rolledCost: null }));
  rm._runStartBlessingsApplied = false;
  rm.applyRunStartBlessingEffects();
  return rm;
}
const classOf = (name) => data.classes.find((c) => c.name === name);
function unitOf(rm, className, name) {
  const unit = createUnit(classOf(className), 5, data.weapons, { name });
  rm.assignUnitUid(unit);
  rm.roster.push(unit);
  return unit;
}
const firstBattle = (rm) => rm.nodeMap.nodes.find((n) => n.type === 'battle');

/** The statement block that holds `needle` in `source` opens with `opener` (nearest `if (`). */
function guardOf(source, needle) {
  const at = source.indexOf(needle);
  expect(at, needle).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = at; i >= 0; i--) {
    if (source[i] === '}') depth++;
    else if (source[i] === '{') {
      if (depth === 0) return source.slice(source.lastIndexOf('\n', i - 1) + 1, i + 1).trim();
      depth--;
    }
  }
  return '';
}

// ── Cavalier's Hour ───────────────────────────────────────────────────────

describe("Cavalier's Hour: mounted +1 Move, infantry +1 DEF, in battle", () => {
  it('writes one uid-keyed delta per unit by its move type now; Armored gets nothing', () => {
    const rm = hold(startRun(), 'cavaliers_hour');
    const knight = unitOf(rm, 'Cavalier', 'Rider');
    const flier = unitOf(rm, 'Pegasus Knight', 'Wing');
    const foot = unitOf(rm, 'Fighter', 'Foot');
    const armor = unitOf(rm, 'Knight', 'Wall');
    const params = rm.getBattleParams(firstBattle(rm));
    const of = (u) => params.battleDebuffs.filter((d) => d.unitUid === u.unitUid);
    expect(of(knight)).toEqual([
      { unitUid: knight.unitUid, stat: 'MOV', value: 1, source: 'cavaliers_hour' },
    ]);
    expect(of(flier)).toEqual([
      { unitUid: flier.unitUid, stat: 'MOV', value: 1, source: 'cavaliers_hour' },
    ]);
    expect(of(foot)).toEqual([
      { unitUid: foot.unitUid, stat: 'DEF', value: 1, source: 'cavaliers_hour' },
    ]);
    expect(of(armor)).toEqual([]);
  });

  it('reads the move type after a promotion: an infantry unit put on a horse takes Move, not DEF', () => {
    const rm = hold(startRun(), 'cavaliers_hour');
    const unit = unitOf(rm, 'Fighter', 'Promoted');
    expect(moveTypeBattleDeltas(rm).find((d) => d.unitUid === unit.unitUid).stat).toBe('DEF');
    unit.className = 'Cavalier';
    unit.moveType = 'Cavalry';
    expect(moveTypeBattleDeltas(rm).filter((d) => d.unitUid === unit.unitUid)).toEqual([
      { unitUid: unit.unitUid, stat: 'MOV', value: 1, source: 'cavaliers_hour' },
    ]);
  });

  it("reads the unit's move type now: Mercury Sandals put an Infantry unit in the air", () => {
    const rm = hold(startRun(), 'cavaliers_hour');
    const unit = unitOf(rm, 'Fighter', 'Shod');
    const sandals = structuredClone(data.accessories.find((a) => a.name === 'Mercury Sandals'));
    expect(sandals.combatEffects.moveTypeOverride).toBe('Flying');
    equipAccessory(unit, sandals);
    expect(unit.moveType).toBe('Flying');
    expect(classOf('Fighter').moveType).toBe('Infantry');
    expect(moveTypeBattleDeltas(rm).filter((d) => d.unitUid === unit.unitUid)).toEqual([
      { unitUid: unit.unitUid, stat: 'MOV', value: 1, source: 'cavaliers_hour' },
    ]);
  });

  it('rides beside a Lingering Injury: both deltas reach the battle and both land', () => {
    const rm = hold(startRun(), 'cavaliers_hour');
    const foot = unitOf(rm, 'Fighter', 'Hurt');
    expect(
      addBurden(rm, 'wounded', { unitUid: foot.unitUid, unitName: foot.name, stat: 'STR' }).ok,
    ).toBe(true);
    const debuffs = rm.getBattleParams(firstBattle(rm)).battleDebuffs;
    const of = debuffs.filter((d) => d.unitUid === foot.unitUid);
    expect(of).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stat: 'STR', source: 'wounded' }),
        { unitUid: foot.unitUid, stat: 'DEF', value: 1, source: 'cavaliers_hour' },
      ]),
    );
    expect(of).toHaveLength(2);
    const fielded = rm.getRoster().find((u) => u.unitUid === foot.unitUid);
    const { STR, DEF } = fielded.stats;
    applyBattleStartDebuffs([fielded], debuffs);
    const injury = of.find((d) => d.source === 'wounded').value;
    expect(injury).toBeLessThan(0);
    expect(fielded.stats.STR).toBe(STR + injury);
    expect(fielded.stats.DEF).toBe(DEF + 1);
  });

  it('a run without it writes no battleDebuffs key (other runs keep their params as they were)', () => {
    const rm = startRun();
    expect('battleDebuffs' in rm.getBattleParams(firstBattle(rm))).toBe(false);
  });

  it('never survives the battle as a permanent stat (the end of the battle takes it back)', () => {
    const rm = hold(startRun(), 'cavaliers_hour');
    const before = rm.getRoster().map((u) => ({ ...u.stats, mov: u.mov }));
    const node = firstBattle(rm);
    const units = rm.getRoster();
    applyBattleStartDebuffs(units, rm.getBattleParams(node).battleDebuffs);
    expect(
      units.some((u, i) => u.stats.MOV !== before[i].MOV || u.stats.DEF !== before[i].DEF),
    ).toBe(true);
    clearBattleScopedDeltas(units); // PostCombatController does this before the commit
    rm.completeBattle(units, node.id, 0, { turnCount: 3, turnPar: 8 });
    expect(rm.roster.map((u) => ({ ...u.stats, mov: u.mov }))).toEqual(before);
  });

  it('is applied once, at a fresh start: the scene applies it only without a resume checkpoint', () => {
    // A resume's units come from the checkpoint with their battle deltas (serializeBattleUnit keeps
    // `_battleDeltas`), so applying the params again would give mounted units +2 Move.
    expect(guardOf(sceneSource, 'applyBattleStartDebuffs(this.playerUnits')).toBe(
      'if (!this._resumeCheckpoint) {',
    );
  });

  it('the harness lands it on the fielded units exactly as the scene does', () => {
    const rm = hold(startRun(), 'cavaliers_hour');
    const fixture = loadFixture('act1_village_race');
    const lord = data.lords.find((l) => l.name === 'Edric');
    const edric = createLordUnit(lord, classOf(lord.class), data.weapons);
    rm.assignUnitUid(edric);
    rm.roster = [edric];
    const debuffs = moveTypeBattleDeltas(rm);
    const movBefore = edric.stats.MOV;
    const defBefore = edric.stats.DEF;
    installSeed(9);
    const battle = new HeadlessBattle(data, { ...fixture.battleParams, battleDebuffs: debuffs }, [
      structuredClone(edric),
    ]);
    battle.init();
    const fielded = battle.playerUnits.find((u) => u.unitUid === edric.unitUid);
    const mounted = ['Cavalry', 'Flying'].includes(edric.moveType);
    expect(fielded.stats.MOV).toBe(movBefore + (mounted ? 1 : 0));
    expect(fielded.stats.DEF).toBe(defBefore + (mounted ? 0 : 1));
    expect(harnessSource).toMatch(
      /applyBattleStartDebuffs\(this\.playerUnits, this\.battleParams\?\.battleDebuffs\)/,
    );
  });
});

// ── Saint's Reserve ───────────────────────────────────────────────────────

describe("Saint's Reserve: +1 use for every staff in each battle", () => {
  const heal = () => structuredClone(data.weapons.find((w) => w.name === 'Heal'));

  it('a player healer gets +1; a foe and a green ally get nothing', () => {
    const rm = hold(startRun(), 'saints_reserve');
    const cleric = createUnit(classOf('Cleric'), 1, data.weapons, { name: 'Ana' });
    const staff = heal();
    const base = getStaffMaxUses(staff, cleric);
    expect(getStaffMaxUses(staff, cleric, staffRunOptions(rm, cleric))).toBe(base + 1);
    const foe = { ...cleric, faction: 'enemy' };
    expect(staffRunOptions(rm, foe)).toEqual({});
    expect(getStaffMaxUses(staff, foe, staffRunOptions(rm, foe))).toBe(base);
    expect(staffRunOptions(rm, { ...cleric, faction: 'npc' })).toEqual({});
    expect(staffRunOptions(startRun(), cleric)).toEqual({});
    expect(staffRunOptions(null, cleric)).toEqual({});
  });

  it('the extra use is really usable: a staff spent to its base still heals', () => {
    const rm = hold(startRun(), 'saints_reserve');
    const cleric = createUnit(classOf('Cleric'), 1, data.weapons, { name: 'Ana' });
    const staff = heal();
    cleric.inventory = [staff];
    staff._usesSpent = getStaffMaxUses(staff, cleric);
    const ally = createUnit(classOf('Fighter'), 1, data.weapons, { name: 'Hurt' });
    ally.currentHP = 1;
    const action = (staffOptions) =>
      validateStaffAction({
        staff,
        healer: cleric,
        targets: [ally],
        usable: [ally],
        staffOptions,
      });
    expect(action({})).toBeNull();
    expect(action(staffRunOptions(rm, cleric))).toBe(true);
    expect(getStaffRemainingUses(staff, cleric, staffRunOptions(rm, cleric))).toBe(1);
  });

  it('the roster, the battle menu, the reward card and the shop all show the same max', () => {
    const rm = hold(startRun(), 'saints_reserve');
    const cleric = createUnit(classOf('Cleric'), 1, data.weapons, { name: 'Ana' });
    rm.assignUnitUid(cleric);
    rm.roster.push(cleric);
    const staff = heal();
    const max = getStaffMaxUses(staff, cleric) + 1;
    expect(battleItemBrief(staff, cleric, { run: rm })).toContain(`${max}/${max} uses`);
    expect(battleItemSummary(staff, cleric, { run: rm })).toContain(`Uses ${max}/${max}`);
    expect(equipmentComparison(cleric, staff, cleric.weapon, { run: rm })).toBe(
      `${max} uses per map for Ana · Uses refresh each battle`,
    );
    const whom = rewardForWhom({ type: 'item', item: staff }, rm);
    expect(whom.detail).toMatch(new RegExp(`^${max} uses per map`));
  });

  it('the harness counts the extra use from the run, as the scene does', () => {
    const rm = hold(startRun(), 'saints_reserve');
    const battle = new HeadlessBattle(data, loadFixture('act1_village_race').battleParams, [], {
      runManager: rm,
    });
    const cleric = createUnit(classOf('Cleric'), 1, data.weapons, { name: 'Ana' });
    const staff = heal();
    cleric.inventory = [staff];
    staff._usesSpent = getStaffMaxUses(staff, cleric);
    expect(battle._getUsableStaves(cleric)).toEqual([staff]);
    battle.runManager = null;
    expect(battle._getUsableStaves(cleric)).toEqual([]);
  });
});

// ── Watcher's Grace ───────────────────────────────────────────────────────

describe("Watcher's Grace: +1 Vision on every boss map, unspent it fades", () => {
  const bossOf = (rm) => rm.nodeMap.nodes.find((n) => n.type === 'boss');

  it('grants on a boss map only, after the entry snapshot', () => {
    const rm = hold(startRun(), 'watchers_grace');
    const charges = rm.visionChargesRemaining;
    rm.beginBattleInProgress(firstBattle(rm).id, { isBoss: false });
    expect(rm.visionChargesRemaining).toBe(charges);
    rm.battleInProgress = null;
    rm.beginBattleInProgress(bossOf(rm).id, { isBoss: true });
    expect(rm.visionChargesRemaining).toBe(charges + 1);
    expect(rm.battleInProgress.visionChargesAtEntry).toBe(charges);
    expect(rm.battleInProgress.bossVisionGranted).toBe(1);
    // Without the card: nothing.
    const plain = startRun();
    plain.beginBattleInProgress(bossOf(plain).id, { isBoss: true });
    expect(plain.visionChargesRemaining).toBe(charges);
    expect(plain.battleInProgress.bossVisionGranted).toBeUndefined();
  });

  it('Continue from Map takes the charge back (live revert and the raw save alike)', () => {
    const rm = hold(startRun(), 'watchers_grace');
    const charges = rm.visionChargesRemaining;
    rm.beginBattleInProgress(bossOf(rm).id, { isBoss: true });
    store.set('emblem_rogue_slot_1_run', JSON.stringify(rm.toJSON()));
    expect(rm.revertBattleInProgressToEntry()).toBe(true);
    expect(rm.visionChargesRemaining).toBe(charges);
    expect(clearBattleInProgressInSave(null, 1).ok).toBe(true);
    expect(JSON.parse(store.get('emblem_rogue_slot_1_run')).visionChargesRemaining).toBe(charges);
  });

  it('a resume never grants twice: the flag rides the save, the scene begins only fresh', () => {
    const rm = hold(startRun(), 'watchers_grace');
    const charges = rm.visionChargesRemaining;
    rm.beginBattleInProgress(bossOf(rm).id, { isBoss: true });
    // The suspend save holds the granted charge and the flag that says so: a resume restores both
    // as they were (BattleScene never calls beginBattleInProgress again on a resume).
    const saved = JSON.parse(JSON.stringify(rm.toJSON()));
    expect(saved.visionChargesRemaining).toBe(charges + 1);
    expect(saved.battleInProgress.bossVisionGranted).toBe(1);
    expect(saved.battleInProgress.visionChargesAtEntry).toBe(charges);
    expect(guardOf(sceneSource, 'this.runManager.beginBattleInProgress?.(this.nodeId')).toBe(
      'if (this.runManager && !this._resumeCheckpoint) {',
    );
  });

  it('a refresh before the first checkpoint gives the grace back, however often it repeats', () => {
    // The boss card, dialogue or formation is on screen: the battle-in-progress save holds the
    // granted charge and a flag with no checkpoint yet. Continue drops that flag on load.
    const rm = hold(startRun(), 'watchers_grace');
    const charges = rm.visionChargesRemaining;
    const count = rm.visionCount;
    const boss = bossOf(rm);
    let run = rm;
    for (let i = 0; i < 3; i++) {
      run.beginBattleInProgress(boss.id, { isBoss: true });
      expect(run.visionChargesRemaining).toBe(charges + 1);
      run = RunManager.fromJSON(JSON.parse(JSON.stringify(run.toJSON())), data);
      expect(run.battleInProgress).toBeNull();
      expect(run.visionChargesRemaining).toBe(charges);
      expect(run.visionCount).toBe(count);
    }
  });

  it('a battle that failed to start and starts again never grants twice', () => {
    // beginBattle threw after the flag was written: the player is back on the route map with the
    // flag still in memory (no checkpoint). The next fresh start must not snapshot the granted
    // charge as its entry.
    const rm = hold(startRun(), 'watchers_grace');
    const charges = rm.visionChargesRemaining;
    const boss = bossOf(rm);
    rm.beginBattleInProgress(boss.id, { isBoss: true });
    rm.beginBattleInProgress(boss.id, { isBoss: true });
    expect(rm.visionChargesRemaining).toBe(charges + 1);
    expect(rm.battleInProgress.visionChargesAtEntry).toBe(charges);
    // The same from a plain battle's flag (nothing granted): nothing is restored.
    const plain = hold(startRun(), 'watchers_grace');
    plain.beginBattleInProgress(firstBattle(plain).id, { isBoss: false });
    plain.visionChargesRemaining += 2; // e.g. a mid-run grant elsewhere
    plain.beginBattleInProgress(bossOf(plain).id, { isBoss: true });
    expect(plain.visionChargesRemaining).toBe(charges + 3);
  });

  it('a suspended boss battle keeps its grant through a load, and the victory takes it back', () => {
    const rm = hold(startRun(), 'watchers_grace');
    const charges = rm.visionChargesRemaining;
    const boss = bossOf(rm);
    rm.beginBattleInProgress(boss.id, { isBoss: true });
    rm.setBattleCheckpoint({ version: 2, checkpointIndex: 3 });
    const back = RunManager.fromJSON(JSON.parse(JSON.stringify(rm.toJSON())), data);
    expect(back.visionChargesRemaining).toBe(charges + 1);
    expect(back.battleInProgress?.bossVisionGranted).toBe(1);
    back.completeBattle(back.getRoster(), boss.id, 0, { turnCount: 4, turnPar: 8 });
    // The unspent grace faded; only the act boss's own +1 remains.
    expect(back.visionChargesRemaining).toBe(charges + 1);
  });

  it('an unspent charge fades at the victory; a spent one is gone (the act boss still pays its own)', () => {
    const unspent = hold(startRun(), 'watchers_grace');
    const charges = unspent.visionChargesRemaining;
    const boss = bossOf(unspent);
    unspent.beginBattleInProgress(boss.id, { isBoss: true });
    unspent.completeBattle(unspent.getRoster(), boss.id, 0, { turnCount: 4, turnPar: 8 });
    // The grace faded; the act boss's own +1 Vision (completeBattle) still lands.
    expect(unspent.visionChargesRemaining).toBe(charges + 1);

    const spent = hold(startRun(), 'watchers_grace');
    spent.beginBattleInProgress(boss.id, { isBoss: true });
    // A rewind spends a charge (BattleRewindTransaction: charges - 1, count + 1).
    spent.visionChargesRemaining -= 1;
    spent.visionCount += 1;
    spent.completeBattle(spent.getRoster(), boss.id, 0, { turnCount: 4, turnPar: 8 });
    expect(spent.visionChargesRemaining).toBe(charges + 1);
  });

  it('the final act boss and the Entity are boss maps too', () => {
    const rm = hold(startRun({ difficultyId: 'hard' }), 'watchers_grace');
    while (rm.actIndex < rm.actSequence.length - 1) rm.advanceAct();
    const boss = bossOf(rm);
    expect(boss?.type).toBe('boss'); // NodeMapScene passes isBoss: node.type === 'boss'
    const charges = rm.visionChargesRemaining;
    rm.beginBattleInProgress(boss.id, { isBoss: true });
    expect(rm.visionChargesRemaining).toBe(charges + 1);
  });

  it('the prologue never grants it', () => {
    const rm = new RunManager(data);
    rm.startPrologue(data);
    rm.blessingRuntimeModifiers.bossBattleVision = 1; // as if held
    const charges = rm.visionChargesRemaining;
    rm.beginBattleInProgress('p4', { isBoss: true });
    expect(rm.visionChargesRemaining).toBe(charges);
  });
});

// ── Patient Dawn ──────────────────────────────────────────────────────────

describe("Patient Dawn: every battle's par is 2 turns higher", () => {
  const map = {
    cols: 12,
    rows: 10,
    enemyCount: 6,
    objective: 'rout',
    mapLayout: null,
    terrainData: data.terrain,
  };

  it('adds its turns last, after the rung, offset and seize floor', () => {
    const base = calculatePar(map, data.turnBonus, 'dusk');
    expect(calculatePar({ ...map, blessingParTurns: 2 }, data.turnBonus, 'dusk')).toBe(base + 2);
    const floored = { ...map, objective: 'seize', parFloor: 40 };
    const floorPar = calculatePar(floored, data.turnBonus, 'dusk');
    expect(calculatePar({ ...floored, blessingParTurns: 2 }, data.turnBonus, 'dusk')).toBe(
      floorPar + 2,
    );
  });

  it('rides the battle params only while held', () => {
    const plain = startRun();
    expect('blessingParTurns' in plain.getBattleParams(firstBattle(plain))).toBe(false);
    const rm = hold(startRun(), 'patient_dawn');
    expect(rm.getBattleParams(firstBattle(rm)).blessingParTurns).toBe(2);
  });

  it('the boss enrage turn follows the raised par (it never comes as early as before)', () => {
    // par 6: enrage at min(12, 6 + 2) = 8; with Patient Dawn's par 8: min(12, 10) = 10.
    expect(getBossEnrageTurn(6, data.turnBonus)).toBe(8);
    expect(getBossEnrageTurn(8, data.turnBonus)).toBe(10);
    expect(sceneSource).toMatch(/getBossEnrageTurn\(this\.turnPar, this\.turnBonusConfig\)/);
  });

  it('the scene and the harness build their par from the same function', () => {
    const builderCall =
      /calculatePar\(\s*battleParMapParams\(|const mapParams = battleParMapParams\(/;
    expect(sceneSource).toMatch(builderCall);
    expect(harnessSource).toMatch(builderCall);
    // Neither builds the inputs by hand any more (a field one learns and the other forgets).
    expect(sceneSource).not.toMatch(/parFloor: this\.battleConfig\.parFloor/);
    expect(harnessSource).not.toMatch(/parFloor: bc\.parFloor/);
  });

  it('the harness par is the map par + 2 with it, and the same without', () => {
    const fixture = loadFixture('act1_village_race');
    const lord = data.lords.find((l) => l.name === 'Edric');
    const make = (params) => {
      installSeed(11);
      const battle = new HeadlessBattle(data, params, [
        createLordUnit(lord, classOf(lord.class), data.weapons),
      ]);
      battle.init();
      return battle;
    };
    const plain = make({ ...fixture.battleParams });
    const patient = make({ ...fixture.battleParams, blessingParTurns: 2 });
    expect(plain.turnPar).not.toBeNull();
    expect(patient.turnPar).toBe(plain.turnPar + 2);
    expect(
      calculatePar(
        battleParMapParams(plain.battleConfig, {
          enemyCount: plain.enemyUnits.length,
          terrainData: data.terrain,
          battleParams: { blessingParTurns: 2 },
        }),
        data.turnBonus,
        plain.battleParams.difficultyId,
      ),
    ).toBe(patient.turnPar);
  });
});

// ── Lone Banner ───────────────────────────────────────────────────────────

describe('Lone Banner: one fewer deploy, +25% XP', () => {
  it('deploys one fewer, never below the act minimum, and pays +25% XP', () => {
    const rm = hold(startRun(), 'lone_banner');
    expect(rm.getDeployBonus('act1')).toBe(-1);
    expect(rm.getXpMultiplierDelta()).toBeCloseTo(0.25);
    for (const [act, base] of Object.entries(DEPLOY_LIMITS)) {
      const limits = resolveDeployLimits({ base, deployBonus: rm.getDeployBonus(act) });
      expect(limits.max, act).toBe(Math.max(base.min, base.max - 1));
      // With Act 1's deploy price on top (-2 in all), still never below the minimum.
      expect(resolveDeployLimits({ base, deployBonus: -2 }).max, act).toBeGreaterThanOrEqual(
        base.min,
      );
    }
  });

  it("a recruit joins at the level of the squad you can really field (Act 1's price on top)", () => {
    const rm = hold(startRun(), 'lone_banner');
    // Act 1's deploy price (act1_deploy_down): -2 in all on Act 1's 3-4 slots, so 3 still deploy.
    rm.blessingRuntimeModifiers.deployCapDeltaByAct = { act1: -1 };
    const deployBonus = rm.getDeployBonus('act1');
    expect(deployBonus).toBe(-2);
    const fielded = resolveDeployLimits({ base: DEPLOY_LIMITS.act1, deployBonus }).max;
    expect(fielded).toBe(3);
    // The three best units are levels 9, 7 and 2: the join level is their average, 6.
    const roster = [9, 7, 2, 1].map((level) => ({ name: `L${level}`, level, tier: 'base' }));
    expect(
      resolveRecruitNodeLevel({ roster, act: 'act1', enemies: data.enemies, deployBonus }),
    ).toBe(Math.floor((9 + 7 + 2) / 3));
  });
});
