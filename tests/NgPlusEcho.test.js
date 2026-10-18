// NG+ Echo and kept forges (docs/specs/ng-plus.md §13): the enemy scaling an NG+ run takes from
// its Barracks members' rides, and kept weapons whose forges wake act by act. Real RunManager on
// the shipped data; each test names the realistic failure it catches.
import { describe, expect, it } from 'vitest';
import { loadGameData } from './testData.js';
import { RunManager } from '../src/engine/RunManager.js';
import { applyForge, canForge, forgeStatBlock, getForgeCost } from '../src/engine/ForgeSystem.js';
import {
  dormantForgeCount,
  keptForgeAwakeLimit,
  lullForges,
  wakeForges,
} from '../src/engine/KeptForges.js';
import {
  echoModsFor,
  echoStepFor,
  validateNgPlusConfig,
  withEchoBossStones,
} from '../src/engine/NgPlusEcho.js';
import { defaultNgPlusState, lordRecordId, runStartOf } from '../src/engine/NgPlusState.js';
import { ngPlusRunEnd, rideCandidates, sanitizeNgPlusRun } from '../src/engine/NgPlusRun.js';
import { FORGE_BONUSES } from '../src/utils/constants.js';
import { CLIENT_CAPABILITIES, requiredRunFormat, runFormatBlock } from '../src/engine/RunFormat.js';

const data = loadGameData();
const catalog = (name) => structuredClone(data.weapons.find((w) => w.name === name));

/** A Silver Sword forged +7: might ×3, hit ×2, crit ×2, in that order. */
function forgedSword(uid = 'itm_kept_sword') {
  const sword = { ...catalog('Silver Sword'), uid };
  for (const stat of ['might', 'hit', 'crit', 'might', 'hit', 'crit', 'might'])
    expect(applyForge(sword, stat, 0, { free: true }).success).toBe(true);
  return sword;
}

/** The sword's catalog stats plus `n` forges, counted from the order above. */
function expectedAt(n) {
  const base = catalog('Silver Sword');
  const order = ['might', 'hit', 'crit', 'might', 'hit', 'crit', 'might'].slice(0, n);
  const plus = (stat) => order.filter((s) => s === stat).length * FORGE_BONUSES[stat];
  return {
    name: n ? `Silver Sword +${n}` : 'Silver Sword',
    might: base.might + plus('might'),
    hit: base.hit + plus('hit'),
    crit: base.crit + plus('crit'),
  };
}

const read = (w) => ({ name: w.name, might: w.might, hit: w.hit, crit: w.crit });

function lordState({ rides = 1, items = [], skills = [] } = {}) {
  const state = defaultNgPlusState();
  state.barracks.push({
    id: lordRecordId('Edric'),
    kind: 'lord',
    name: 'Edric',
    keptSkills: skills,
    skillKinds: {},
    keptItems: items,
    rides,
  });
  return state;
}

function vetRecord(id, rides) {
  return {
    id,
    kind: 'recruit',
    name: `Vet${rides}`,
    keptSkills: [],
    skillKinds: {},
    keptItems: [],
    rides,
    className: 'Fighter',
    growths: { HP: 70, STR: 50, MAG: 0, SKL: 40, SPD: 40, DEF: 30, RES: 10, LCK: 30 },
    traits: [],
  };
}

function ngPlusRun(state, { difficultyId = 'lunatic', seed = 7 } = {}) {
  const rm = new RunManager(data);
  rm.startRun({
    runSeed: seed,
    applyBlessingsAtStart: false,
    difficultyId,
    ngPlus: runStartOf(state),
  });
  return rm;
}

const edricOf = (rm) => rm.roster.find((u) => u.name === 'Edric');
const findKept = (rm, uid) =>
  [...rm.roster.flatMap((u) => u.inventory || []), ...(rm.convoy?.weapons || [])].find(
    (i) => i.uid === uid,
  );

describe('kept forges sleep and wake', () => {
  it('a lulled weapon reads exactly as if forged only to the limit, and wakes back whole', () => {
    // Failure: dormant forges still add might (an Act I +15 sword), or waking loses a step.
    const sword = forgedSword();
    const price = sword.price;
    expect(lullForges(sword, 2)).toBe(5);
    expect(read(sword)).toEqual(expectedAt(2));
    expect(sword.price).toBe(price);
    expect(wakeForges(sword, 4)).toBe(2);
    expect(read(sword)).toEqual(expectedAt(4));
    expect(dormantForgeCount(sword)).toBe(3);
    wakeForges(sword, Infinity);
    expect(read(sword)).toEqual(expectedAt(7));
    expect(sword._dormantForges).toBeUndefined();
  });

  it('a forge lands on a kept weapon while its old forges sleep, and waking keeps it', () => {
    // Failure (the owner's report): a kept weapon with sleeping forges refuses every forge
    // (shop, whetstone reward, event) until they all wake, in practice until Act V.
    const sword = forgedSword();
    lullForges(sword, 2);
    expect(canForge(sword)).toBe(true);
    expect(forgeStatBlock(sword, 'weight')).toBe('');
    expect(applyForge(sword, 'weight', 0, { free: true }).success).toBe(true);
    const weight = catalog('Silver Sword').weight + FORGE_BONUSES.weight;
    expect({ ...read(sword), weight: sword.weight }).toEqual({
      ...expectedAt(2),
      name: 'Silver Sword +3',
      weight,
    });
    wakeForges(sword, Infinity);
    expect({ ...read(sword), weight: sword.weight }).toEqual({
      ...expectedAt(7),
      name: 'Silver Sword +8',
      weight,
    });
    // The history stays kept forges first, then the run's: the run's forge is the one on top.
    expect(sword._forgeHistory.map((s) => s.stat)).toEqual([
      'might',
      'hit',
      'crit',
      'might',
      'hit',
      'crit',
      'might',
      'weight',
    ]);
  });

  it('the awake limit counts kept forges only, never the run’s own', () => {
    // Failure: forging a kept weapon in Act I keeps its old forges asleep in Act II.
    const sword = forgedSword();
    lullForges(sword, 2);
    applyForge(sword, 'weight', 0, { free: true });
    applyForge(sword, 'hit', 0, { free: true });
    expect(wakeForges(sword, 4)).toBe(2);
    expect(dormantForgeCount(sword)).toBe(3);
    expect(sword._forgeLevel).toBe(6);
  });

  it('sleeping forges count toward the forge caps, so waking never fails', () => {
    // Failure: a stat forged to its cap on top of sleeping forges of that stat is lost (or
    // overflows the cap) when they wake.
    const sword = forgedSword(); // might x3
    lullForges(sword, 2); // awake might, hit; asleep crit, might, hit, crit, might
    expect(applyForge(sword, 'might', 0, { free: true }).success).toBe(true);
    expect(applyForge(sword, 'might', 0, { free: true }).success).toBe(true);
    expect(forgeStatBlock(sword, 'might')).toBe('This stat is at its forge limit.');
    expect(getForgeCost(sword, 'might')).toBe(-1);
    wakeForges(sword, Infinity);
    expect(sword._forgeLevel).toBe(9);
    expect(sword.might).toBe(catalog('Silver Sword').might + 5 * FORGE_BONUSES.might);
    // The total cap: a weapon near +15 counting its sleeping forges takes no more.
    const full = forgedSword('itm_full');
    for (const stat of ['weight', 'weight', 'hit', 'hit', 'crit', 'crit', 'crit'])
      applyForge(full, stat, 0, { free: true });
    lullForges(full, 2);
    applyForge(full, 'might', 0, { free: true });
    expect(full._forgeLevel + dormantForgeCount(full)).toBe(15);
    expect(canForge(full)).toBe(false);
  });

  it('lulling again measures the full history, not the awake part', () => {
    // Failure: a weapon kept twice sleeps its sleeping forges a second time and loses them.
    const sword = forgedSword();
    lullForges(sword, 2);
    lullForges(sword, 4);
    expect(read(sword)).toEqual(expectedAt(4));
    expect(dormantForgeCount(sword)).toBe(3);
  });

  it('the act table: Act I 2 up to Act IV 8, then no limit', () => {
    expect(keptForgeAwakeLimit('act1', data.difficulty.ngPlus.keptForgeAwake)).toBe(2);
    expect(keptForgeAwakeLimit('act4', data.difficulty.ngPlus.keptForgeAwake)).toBe(8);
    expect(keptForgeAwakeLimit('finalBoss', data.difficulty.ngPlus.keptForgeAwake)).toBe(Infinity);
  });

  it('an NG+ run starts the kept sword at Act I’s limit and wakes it each act', () => {
    // Failure: the kit arrives fully forged, or advancing an act never wakes it.
    const rm = ngPlusRun(lordState({ items: [forgedSword()] }));
    const limits = data.difficulty.ngPlus.keptForgeAwake;
    expect(read(findKept(rm, 'itm_kept_sword'))).toEqual(expectedAt(limits.act1));
    rm.advanceAct();
    expect(rm.currentAct).toBe('act2');
    expect(read(findKept(rm, 'itm_kept_sword'))).toEqual(expectedAt(limits.act2));
    rm.advanceAct();
    rm.advanceAct();
    rm.advanceAct();
    expect(rm.currentAct).toBe('finalBoss');
    expect(read(findKept(rm, 'itm_kept_sword'))).toEqual(expectedAt(7));
  });

  it('a Barracks lord who joins mid-run brings the kept sword at that act’s limit, then wakes it', () => {
    // Failure: a kit that arrives late (Power of Friendship, a boss draft, a Talk: one rule,
    // NgPlusRun.applyPendingNgPlusLordKits) comes fully forged, or sleeps for good.
    const state = defaultNgPlusState();
    state.barracks.push({
      id: lordRecordId('Kira'),
      kind: 'lord',
      name: 'Kira',
      keptSkills: [],
      skillKinds: {},
      keptItems: [forgedSword('itm_kira_sword')],
      rides: 1,
    });
    const rm = ngPlusRun(state);
    expect(findKept(rm, 'itm_kira_sword')).toBeUndefined();
    rm.advanceAct();
    rm.advanceAct();
    expect(rm.currentAct).toBe('act3');
    const lordDef = data.lords.find((l) => l.name === 'Kira');
    rm.resolveThirdLord(rm._buildStartingLord(lordDef, { isCommander: false }));
    const limits = data.difficulty.ngPlus.keptForgeAwake;
    expect(read(findKept(rm, 'itm_kira_sword'))).toEqual(expectedAt(limits.act3));
    rm.advanceAct();
    expect(read(findKept(rm, 'itm_kira_sword'))).toEqual(expectedAt(Math.min(7, limits.act4)));
  });

  it('a weapon moved to the convoy still wakes', () => {
    // Failure: only bags are woken, so a stored kept weapon sleeps for good.
    const rm = ngPlusRun(lordState({ items: [forgedSword()] }));
    const edric = edricOf(rm);
    const sword = edric.inventory.find((i) => i.uid === 'itm_kept_sword');
    edric.inventory = edric.inventory.filter((i) => i !== sword);
    if (edric.weapon === sword) edric.weapon = null;
    rm.convoy.weapons = [...(rm.convoy.weapons || []), sword];
    rm.advanceAct();
    expect(read(findKept(rm, 'itm_kept_sword'))).toEqual(
      expectedAt(data.difficulty.ngPlus.keptForgeAwake.act2),
    );
  });

  it('a kept weapon left with a fallen ally (convoy full) still wakes', () => {
    // Failure: only the living army's bags and the convoy wake, so a weapon a full convoy
    // left with a fallen veteran stays asleep after a revival.
    const rm = ngPlusRun(lordState({ items: [forgedSword()] }));
    const edric = edricOf(rm);
    const sword = edric.inventory.find((i) => i.uid === 'itm_kept_sword');
    edric.inventory = edric.inventory.filter((i) => i !== sword);
    if (edric.weapon === sword) edric.weapon = null;
    const sera = rm.roster.find((u) => u.name === 'Sera');
    rm.roster = rm.roster.filter((u) => u !== sera);
    sera.inventory = [...(sera.inventory || []), sword];
    rm.fallenUnits.push(sera);
    rm.advanceAct();
    const fallen = rm.fallenUnits.find((u) => u.name === 'Sera');
    expect(read(fallen.inventory.find((i) => i.uid === 'itm_kept_sword'))).toEqual(
      expectedAt(data.difficulty.ngPlus.keptForgeAwake.act2),
    );
  });

  it('the Barracks always stores a kept weapon awake', () => {
    // Failure: a run ended before the last act writes the sleeping forges off the record.
    const rm = ngPlusRun(lordState({ items: [forgedSword()] }));
    const candidate = rideCandidates(rm).find((c) => c.name === 'Edric');
    expect(read(candidate.items.find((i) => i.uid === 'itm_kept_sword'))).toEqual(expectedAt(7));
    rm.status = 'victory';
    const end = ngPlusRunEnd(rm, { result: 'victory' });
    const refreshed = end.refresh.find((r) => r.id === lordRecordId('Edric'));
    expect(read(refreshed.keptItems[0])).toEqual(expectedAt(7));
    // ...while the run's own copy still sleeps.
    expect(read(findKept(rm, 'itm_kept_sword'))).toEqual(expectedAt(2));
    expect(refreshed.keptItems[0]._keptForgeBase).toBeUndefined();
  });

  it('a ride carries the kept forges plus the run’s first four, at their price', () => {
    // Failure (the owner's ask): every forge of every run carries, so a kept weapon maxes out
    // in a loop or two; or the cap trims the forges the weapon rode in with.
    const carry = data.difficulty.ngPlus.keptForgeCarry;
    expect(carry).toBe(4);
    const rm = ngPlusRun(lordState({ items: [forgedSword()] }));
    const sword = findKept(rm, 'itm_kept_sword');
    const price = sword.price;
    const paid = [];
    for (const stat of ['weight', 'hit', 'crit', 'weight', 'hit']) {
      const result = applyForge(sword, stat);
      expect(result.success).toBe(true);
      paid.push(result.cost);
    }
    // A weapon this run found and forged +6 rides with 4 of them.
    const edric = edricOf(rm);
    const found = { ...catalog('Iron Sword'), uid: 'itm_found_sword' };
    for (const stat of ['might', 'hit', 'crit', 'weight', 'might', 'hit'])
      applyForge(found, stat, 0, { free: true });
    edric.inventory.push(found);
    const candidate = rideCandidates(rm).find((c) => c.name === 'Edric');
    const kept = candidate.items.find((i) => i.uid === 'itm_kept_sword');
    expect(kept._forgeLevel).toBe(7 + carry);
    expect(kept._forgeHistory.slice(7).map((s) => s.stat)).toEqual([
      'weight',
      'hit',
      'crit',
      'weight',
    ]);
    expect(kept.price).toBe(price + paid[0] + paid[1] + paid[2] + paid[3]);
    expect(kept._keptForgeBase).toBeUndefined();
    expect(candidate.items.find((i) => i.uid === 'itm_found_sword')._forgeLevel).toBe(carry);
    rm.status = 'victory';
    const end = ngPlusRunEnd(rm, { result: 'victory' });
    const refreshed = end.refresh.find((r) => r.id === lordRecordId('Edric')).keptItems[0];
    expect(refreshed._forgeLevel).toBe(7 + carry);
    // The run's own copy is untouched.
    expect(sword._forgeLevel + dormantForgeCount(sword)).toBe(12);
  });

  it('a kept weapon from a save before the cap keeps every forge (grandfathered)', () => {
    // Failure: a live NG+ run's kept weapon, placed before the cap stamped what it rode in
    // with, is read as a fresh find and trimmed to +2 at the run's end.
    const rm = ngPlusRun(lordState({ items: [forgedSword()] }));
    const sword = findKept(rm, 'itm_kept_sword');
    wakeForges(sword, Infinity);
    delete sword._keptForgeBase;
    applyForge(sword, 'weight', 0, { free: true });
    const candidate = rideCandidates(rm).find((c) => c.name === 'Edric');
    expect(candidate.items.find((i) => i.uid === 'itm_kept_sword')._forgeLevel).toBe(8);
  });
});

describe('Echo', () => {
  it('counts every member’s rides: lords with a kit and brought veterans', () => {
    // Failure: only veterans count, so the lord's kit (most of the power) is free.
    const state = lordState({ rides: 5, skills: ['vantage'] });
    state.barracks.push(vetRecord('vet:a', 3), vetRecord('vet:b', 1), vetRecord('vet:c', 4));
    state.bring = ['vet:a', 'vet:b'];
    const rm = ngPlusRun(state);
    expect(rm.ngPlus.echo).toBe(5 + 3 + 1);
  });

  it('a Barracks lord who does not start the run adds nothing until they join', () => {
    // Failure: a kit that never comes into the run raises the enemies anyway.
    const state = defaultNgPlusState();
    state.barracks.push({
      id: lordRecordId('Kira'),
      kind: 'lord',
      name: 'Kira',
      keptSkills: ['vantage'],
      skillKinds: {},
      keptItems: [],
      rides: 4,
    });
    const rm = ngPlusRun(state);
    expect(rm.ngPlus.echo).toBe(0);
    const lordDef = data.lords.find((l) => l.name === 'Kira');
    rm.resolveThirdLord(rm._buildStartingLord(lordDef, { isCommander: false }));
    expect(rm.ngPlus.echo).toBe(4);
  });

  it('is saved and loads back', () => {
    // Failure: a reload drops the Echo and the rest of the run plays unscaled.
    const state = lordState({ rides: 12 });
    const rm = ngPlusRun(state);
    const back = RunManager.fromJSON(rm.toJSON(), data);
    expect(back.ngPlus.echo).toBe(12);
    expect(sanitizeNgPlusRun({ v: 1, members: [], lordKits: [] }).echo).toBe(0);
  });

  it('an older NG+ client refuses this build’s NG+ run, Echo 0 included', () => {
    // Failure: a client that plays NG+ but not Echo loads the run, drops the Echo and never
    // wakes the sleeping forges (the review's Echo 12, +7 sword: forge 2 where it should be 4).
    const olderClient = CLIENT_CAPABILITIES.filter((id) => id !== 'ngPlusEcho');
    for (const rides of [12, 0]) {
      const rm = ngPlusRun(lordState({ rides, items: [forgedSword()] }));
      const saved = rm.toJSON();
      expect(saved.requiresCapabilities).toContain('ngPlusEcho');
      expect(runFormatBlock(saved, { clientCapabilities: olderClient })?.missing).toEqual([
        'ngPlusEcho',
      ]);
      // This build still plays it.
      expect(runFormatBlock(saved)).toBeNull();
    }
    // An ordinary run is never held to it.
    const plain = new RunManager(data);
    plain.startRun({ runSeed: 7, applyBlessingsAtStart: false, difficultyId: 'lunatic' });
    expect(requiredRunFormat(plain.toJSON()).capabilities).not.toContain('ngPlusEcho');
  });

  it('an NG+ save from before Echo reads as Echo 0 with its kept forges awake', () => {
    // Failure: an older save is refused, or this build puts its kept forges to sleep (or scales
    // it) mid-run under rules it was never made with.
    const rm = ngPlusRun(lordState({ rides: 3, items: [forgedSword()] }));
    const saved = rm.toJSON();
    // What the older writer saved: no Echo, the kept sword whole, no marker for Echo.
    delete saved.ngPlus.echo;
    saved.requiresCapabilities = saved.requiresCapabilities.filter((id) => id !== 'ngPlusEcho');
    const whole = forgedSword();
    for (const unit of saved.roster)
      unit.inventory = (unit.inventory || []).map((i) => (i.uid === whole.uid ? whole : i));
    expect(requiredRunFormat(saved).capabilities).not.toContain('ngPlusEcho');
    expect(runFormatBlock(saved)).toBeNull();
    const back = RunManager.fromJSON(saved, data);
    expect(back.ngPlus.echo).toBe(0);
    expect(read(findKept(back, whole.uid))).toEqual(expectedAt(7));
    back.advanceAct();
    expect(read(findKept(back, whole.uid))).toEqual(expectedAt(7));
    expect(dormantForgeCount(findKept(back, whole.uid))).toBe(0);
    // Saved again by this build, it is held to Echo from now on.
    expect(back.toJSON().requiresCapabilities).toContain('ngPlusEcho');
  });

  it('the table: each step from data, and a higher Echo is never easier', () => {
    expect(validateNgPlusConfig(data.difficulty.ngPlus)).toEqual({ valid: true, errors: [] });
    const below = data.difficulty.ngPlus.echo[0].minEcho - 1;
    expect(echoStepFor(below, data)).toBeNull();
    expect(echoModsFor(below, data)).toEqual({
      enemyLevelBonus: 0,
      enemyStatBonus: 0,
      enemyCountBonus: 0,
      bossStones: 0,
    });
    for (const step of data.difficulty.ngPlus.echo) {
      expect(echoStepFor(step.minEcho, data)).toBe(step);
      expect(echoStepFor(step.minEcho + 0.5, data)).toBe(step);
    }
    const bad = {
      echo: [
        { minEcho: 5, enemyLevelBonus: 2 },
        { minEcho: 10, enemyLevelBonus: 1 },
      ],
    };
    expect(validateNgPlusConfig(bad).valid).toBe(false);
    expect(validateNgPlusConfig({ echo: [{ minEcho: 5, enemyHp: 3 }] }).valid).toBe(false);
    expect(validateNgPlusConfig({ keptForgeCarry: -1 }).valid).toBe(false);
    expect(validateNgPlusConfig({ keptForgeCarry: 1.5 }).valid).toBe(false);
  });

  it('the table climbs gently: each step raises one lever by one', () => {
    // Failure: a spike (several levers at once) where a loop should only feel a little harder.
    const levers = ['enemyLevelBonus', 'enemyStatBonus', 'enemyCountBonus', 'bossStones'];
    const steps = [...data.difficulty.ngPlus.echo].sort((a, b) => a.minEcho - b.minEcho);
    let prev = Object.fromEntries(levers.map((k) => [k, 0]));
    for (const step of steps) {
      const rises = levers.map((k) => (step[k] || 0) - prev[k]);
      expect(rises.filter((r) => r !== 0)).toEqual([1]);
      prev = Object.fromEntries(levers.map((k) => [k, step[k] || 0]));
    }
  });

  it('a battle’s params add the Echo step to the rung’s own levers, bosses included', () => {
    // Failure: Echo is counted but never reaches the map, or only reaches filler foes.
    const top = data.difficulty.ngPlus.echo.at(-1);
    const plain = new RunManager(data);
    plain.startRun({ runSeed: 7, applyBlessingsAtStart: false, difficultyId: 'lunatic' });
    const rm = ngPlusRun(lordState({ rides: top.minEcho }));
    const nodeOf = (run) =>
      run.nodeMap.nodes.find((n) => n.battleParams && n.row === 1) ||
      run.nodeMap.nodes.find((n) => n.battleParams);
    const a = plain.getBattleParams(nodeOf(plain));
    const b = rm.getBattleParams(nodeOf(rm));
    expect(b.enemyLevelBonus - a.enemyLevelBonus).toBe(top.enemyLevelBonus);
    expect(b.bossLevelBonus - a.bossLevelBonus).toBe(top.enemyLevelBonus);
    expect(b.enemyStatBonus - a.enemyStatBonus).toBe(top.enemyStatBonus);
    expect(b.enemyCountBonus - a.enemyCountBonus).toBe(top.enemyCountBonus);
    expect(b.revivalStones.actBoss - a.revivalStones.actBoss).toBe(top.bossStones);
    expect(b.revivalStones.eliteCaptain).toBe(a.revivalStones.eliteCaptain);
  });

  it('an ordinary run’s params are untouched', () => {
    // Failure: a run with no NG+ record picks up a step (an Echo of NaN or a default).
    const rm = new RunManager(data);
    rm.startRun({ runSeed: 7, applyBlessingsAtStart: false, difficultyId: 'lunatic' });
    const node = rm.nodeMap.nodes.find((n) => n.battleParams);
    const params = rm.getBattleParams(node);
    const mode = data.difficulty.modes.lunatic;
    expect(params.revivalStones).toEqual(mode.revivalStones);
    expect(params.enemyStatBonus).toBe(mode.actOverrides.act1.enemyStatBonus);
  });

  it('boss stones add to bosses only, and a table without stones gains them', () => {
    expect(
      withEchoBossStones({ actBoss: 1, emperor: 2, lieutenant: 2, eliteCaptain: 1 }, 1),
    ).toEqual({ actBoss: 2, emperor: 3, lieutenant: 3, eliteCaptain: 1 });
    expect(withEchoBossStones(null, 1)).toEqual({
      actBoss: 1,
      emperor: 1,
      lieutenant: 1,
      eliteCaptain: 0,
    });
    expect(withEchoBossStones(null, 0)).toBeNull();
  });
});

describe('Echo on screen', () => {
  it('the pause list names the run’s Echo and what it does; an ordinary run has no entry', async () => {
    // Failure: the player meets stronger enemies with nothing saying why.
    const { pauseBurdenEntries } = await import('../src/ui/eventMenuModel.js');
    const rm = ngPlusRun(lordState({ rides: 12 }));
    const entry = pauseBurdenEntries(rm, data.events).find((e) => e.id === 'ngplus-echo');
    // The pause menu shows `${label} · ${short}`: the Echo is named once.
    expect(`${entry.label} · ${entry.short}`).toBe('NG+ · Echo 12');
    expect(entry.text).toMatch(/^Enemies \+2 levels, enemy stats \+1\./);
    const plain = new RunManager(data);
    plain.startRun({ runSeed: 7, applyBlessingsAtStart: false, difficultyId: 'lunatic' });
    expect(pauseBurdenEntries(plain, data.events).some((e) => e.id === 'ngplus-echo')).toBe(false);
  });

  it('the difficulty screen previews the Echo of the brought veterans and the starting pair', async () => {
    // Failure: the preview counts a Barracks lord who is not starting, or a veteran left home.
    const { echoPreview, ngPlusRunNote, ngPlusToggleLabel, barracksView } =
      await import('../src/ui/ngPlusModel.js');
    const state = lordState({ rides: 3 });
    state.barracks.push(
      {
        id: lordRecordId('Kira'),
        kind: 'lord',
        name: 'Kira',
        keptSkills: [],
        skillKinds: {},
        keptItems: [],
        rides: 9,
      },
      vetRecord('vet:a', 2),
      vetRecord('vet:b', 7),
    );
    state.bring = ['vet:a'];
    const meta = {
      getNgPlus: () => state,
      getLordSelection: () => ({ commander: 'Edric', partner: 'Sera' }),
    };
    expect(echoPreview(meta)).toBe(3 + 2);
    expect(ngPlusRunNote(meta, data)).toMatch(/Echo 5: enemies \+1 level\.$/);
    // Seen where it is chosen: the NG+ switch and each Barracks row name their Echo.
    expect(ngPlusToggleLabel(true, meta)).toBe('New Game+: On · Echo 5');
    expect(ngPlusToggleLabel(false, meta)).toBe('New Game+: Off');
    const rows = barracksView(state, data).records;
    expect(rows.find((r) => r.id === 'vet:b').line).toMatch(/ · Echo 7$/);
  });
});
