// Branching Threads' level-up reroll (engine/LevelUpReroll.js): the gains of a level shown on
// a card rolled again by the same levelUp(), swapped onto the unit exactly, paid from the one
// pool the battle-reward reroll spends (engine/RerollPool.js).
//
// Ways this can fail, one test (or more) each:
//   - the swap leaves a stat, max HP or current HP off by the old or new gain (HP at 1, at
//     max, a unit down; an extended level; the first of two levels from one gain)
//   - the new roll drawn from Math.random (the battle stream), or not keyed (a rewind that
//     refunds the charge rerolls to something else), or rolled by a rule other than levelUp's
//   - the count spent from a second pool, or a reroll offered in the prologue / to a foe
//   - a failed save leaving the new stats, record, flag or charge in memory
//   - the button shown without the upgrade, or enabled with nothing left
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  battleLevelUpRerollRng,
  levelUpRerollBlock,
  levelUpRerollKey,
  levelUpRerollStatus,
  rerollLevelUp,
  rollLevelUpReplacement,
  runLevelUpRerollRng,
  swapLevelUpGains,
} from '../src/engine/LevelUpReroll.js';
import { rerollsLeft, rerollsSpent } from '../src/engine/RerollPool.js';
import { createBattleRng } from '../src/engine/BattleRng.js';
import { gainExperience, levelUp } from '../src/engine/UnitManager.js';
import { levelUpRerollButtonState } from '../src/ui/rewardRerollButton.js';
import { RunManager } from '../src/engine/RunManager.js';
import { MetaProgressionManager } from '../src/engine/MetaProgressionManager.js';
import { prepareBattleRewards, rerollBattleReward } from '../src/engine/PendingBattleRewards.js';
import { levelUpDisplayResults } from '../src/ui/progressionDisplay.js';
import { loadGameData } from './testData.js';

const STATS = ['HP', 'STR', 'MAG', 'SKL', 'SPD', 'DEF', 'RES', 'LCK'];
const zero = () => Object.fromEntries(STATS.map((s) => [s, 0]));
const gainsOf = (list) => ({ ...zero(), ...Object.fromEntries(list.map((s) => [s, 1])) });

/** An rng that returns the given values in order (and counts the calls). */
function scripted(values) {
  let i = 0;
  const rng = () => {
    if (i >= values.length) throw new Error('scripted rng ran out');
    return values[i++];
  };
  rng.calls = () => i;
  return rng;
}
/** Draws that pass exactly the listed stats at growth 50 (0.1 passes, 0.9 fails). */
const drawsFor = (passing) => STATS.map((s) => (passing.includes(s) ? 0.1 : 0.9));

const run = (left = 3, extra = {}) => ({
  mode: 'standard',
  runSeed: 7,
  metaEffects: { rewardRerolls: left },
  rewardRerollsSpent: 0,
  ...extra,
});
function unitAt({ level = 6, hp = 15, maxHp = 21, gains = gainsOf(['HP', 'STR']) } = {}) {
  return {
    name: 'Kira',
    unitUid: 'ru4',
    faction: 'player',
    tier: 'base',
    level,
    battleEntityId: 'player-2',
    growths: Object.fromEntries(STATS.map((s) => [s, 50])),
    stats: { HP: maxHp, STR: 8, MAG: 1, SKL: 7, SPD: 9, DEF: 5, RES: 2, LCK: 4 },
    currentHP: hp,
    record: { gains: { ...gains }, newLevel: level },
  };
}

afterEach(() => vi.restoreAllMocks());

describe('the swap', () => {
  it('takes the old gains off and puts the new on; HP loses the old heal, takes the new', () => {
    const u = unitAt();
    const result = rerollLevelUp(run(), u, u.record, { rng: scripted(drawsFor(['SPD', 'DEF'])) });
    expect(result.ok).toBe(true);
    // Derived by hand: HP 21-1, STR 8-1, SPD 9+1, DEF 5+1; current 15-1+0.
    expect(u.stats).toEqual({ HP: 20, STR: 7, MAG: 1, SKL: 7, SPD: 10, DEF: 6, RES: 2, LCK: 4 });
    expect(u.currentHP).toBe(14);
    expect(u.record.gains).toEqual(gainsOf(['SPD', 'DEF']));
    expect(u.record.newLevel).toBe(6);
  });

  it('current HP at 1 never drops to 0; at max it stays at the new max', () => {
    const low = unitAt({ hp: 1 });
    rerollLevelUp(run(), low, low.record, { rng: scripted(drawsFor(['SPD'])) });
    expect([low.currentHP, low.stats.HP]).toEqual([1, 20]);

    const full = unitAt({ hp: 21 });
    rerollLevelUp(run(), full, full.record, { rng: scripted(drawsFor(['SPD'])) });
    expect([full.currentHP, full.stats.HP]).toEqual([20, 20]);

    // No HP gain before, one after: max and current both rise by one.
    const gaining = unitAt({ hp: 20, maxHp: 20, gains: gainsOf(['STR']) });
    rerollLevelUp(run(), gaining, gaining.record, { rng: scripted(drawsFor(['HP', 'LCK'])) });
    expect([gaining.currentHP, gaining.stats.HP]).toEqual([21, 21]);
  });

  it('a unit already down stays down', () => {
    const u = unitAt({ hp: 0 });
    swapLevelUpGains(u, gainsOf(['STR']), gainsOf(['HP']));
    expect(u.currentHP).toBe(0);
    expect(u.stats.HP).toBe(22);
  });

  it('an extended level (promoted past the cap) rerolls to one uniform stat', () => {
    const u = unitAt({ level: 20, gains: gainsOf(['LCK']) });
    Object.assign(u, { tier: 'promoted', extendedLevels: 3 });
    u.record = { gains: gainsOf(['LCK']), newLevel: 20, extendedLevel: 3, isExtended: true };
    // floor(0.5 * 8) = index 4: SPD.
    const result = rerollLevelUp(run(), u, u.record, { rng: scripted([0.5]) });
    expect(result.ok).toBe(true);
    expect(u.record).toMatchObject({ gains: gainsOf(['SPD']), extendedLevel: 3, isExtended: true });
    expect(u.stats.LCK).toBe(3);
    expect(u.stats.SPD).toBe(10);
    expect(u.extendedLevels).toBe(3);
    expect(u.level).toBe(20);
  });

  it('two levels from one gain: only the latest can be rerolled, and its swap is exact', () => {
    const u = unitAt({ level: 4, gains: zero() });
    delete u.record;
    u.xp = 0;
    const start = { ...u.stats };
    vi.spyOn(Math, 'random').mockImplementation(scripted([...drawsFor(['HP']), ...drawsFor(['MAG', 'RES'])])); // prettier-ignore
    const { levelUps } = gainExperience(u, 200);
    vi.restoreAllMocks();
    expect(levelUps.map((l) => l.newLevel)).toEqual([5, 6]);
    const cards = levelUpDisplayResults(u.stats, levelUps);
    const afterAward = { ...u.stats };
    const r = run();
    // The earlier level is refused: nothing changes, nothing is spent.
    expect(levelUpRerollBlock(r, u, cards[0])).toBe('invalid');
    const refused = rerollLevelUp(r, u, cards[0], { rng: scripted(drawsFor(['SKL', 'SPD'])) });
    expect(refused).toMatchObject({ ok: false, reason: 'invalid' });
    expect(u.stats).toEqual(afterAward);
    expect(rerollsSpent(r)).toBe(0);
    expect(levelUps[0].gains).toEqual(gainsOf(['HP']));
    // The latest level rerolls: its gains come off and the new ones go on, exactly.
    expect(levelUpRerollBlock(r, u, cards[1])).toBe('');
    const result = rerollLevelUp(r, u, cards[1], { rng: scripted(drawsFor(['SKL', 'SPD'])) });
    expect(result.ok).toBe(true);
    const expected = { ...start };
    for (const s of ['HP', 'SKL', 'SPD']) expected[s] += 1;
    expect(u.stats).toEqual(expected);
  });

  it('a guarded award cannot end in two one-stat levels by rerolling the earlier one', () => {
    // First level two stats, second one stat, both rolled with thinBefore false. Rerolling the
    // first into one stat would leave two thin levels in a row, which the guard forbids and
    // nothing reconciles the second level afterwards: so the first is not offered.
    const u = unitAt({ level: 6, gains: gainsOf(['SPD']) });
    u.lastLevelUpThin = true;
    const first = { gains: gainsOf(['HP', 'STR']), newLevel: 5, guard: true, thinBefore: false };
    const second = { gains: gainsOf(['SPD']), newLevel: 6, guard: true, thinBefore: false };
    const before = JSON.stringify([u.stats, first, second, u.lastLevelUpThin]);
    const r = run();
    const result = rerollLevelUp(r, u, first, { rng: scripted(drawsFor(['DEF'])) });
    expect(result).toMatchObject({ ok: false, reason: 'invalid' });
    expect(JSON.stringify([u.stats, first, second, u.lastLevelUpThin])).toBe(before);
    expect(rerollsSpent(r)).toBe(0);
  });
});

describe('the roll', () => {
  it('is levelUp’s own rule: a level with every roll failing still gives its guaranteed stat', () => {
    const u = unitAt();
    u.growths = { ...zero(), DEF: 30 };
    const next = rollLevelUpReplacement(u, u.record, scripted(STATS.map(() => 0.99)));
    expect(next.gains).toEqual(gainsOf(['DEF']));
    expect(next.newLevel).toBe(6);
    // The probe is the unit before the level: levelUp sees level 5, not the cap.
    const capped = unitAt({ level: 20 });
    capped.record.newLevel = 20;
    expect(rollLevelUpReplacement(capped, capped.record, scripted(drawsFor(['HP'])))).toMatchObject({ newLevel: 20 }); // prettier-ignore
  });

  it('is keyed: the same unit, level and ordinal give the same gains (a refund rerolls the same)', () => {
    const a = unitAt();
    const b = unitAt();
    const r = run();
    rerollLevelUp(r, a, a.record, { rng: battleLevelUpRerollRng(99, a, a.record, 0) });
    rerollLevelUp(run(), b, b.record, { rng: battleLevelUpRerollRng(99, b, b.record, 0) });
    expect(a.stats).toEqual(b.stats);
    expect(levelUpRerollKey('player-2', a.record, 3)).toBe('levelup-reroll:player-2:6:3');
    expect(levelUpRerollKey('ru4', { gains: {}, newLevel: 20, extendedLevel: 2, isExtended: true }, 0)).toBe('levelup-reroll:ru4:20+2:0'); // prettier-ignore
    // The streams differ by unit, level and ordinal (the next reroll is a fresh roll).
    const draw = (rng) => [rng(), rng(), rng()];
    const base = draw(battleLevelUpRerollRng(99, a, a.record, 0));
    expect(draw(battleLevelUpRerollRng(99, a, a.record, 0))).toEqual(base);
    expect(draw(battleLevelUpRerollRng(99, a, a.record, 1))).not.toEqual(base);
    expect(draw(battleLevelUpRerollRng(98, a, a.record, 0))).not.toEqual(base);
    expect(draw(runLevelUpRerollRng(r, a, a.record, 0))).toEqual(draw(runLevelUpRerollRng({ runSeed: 7 }, a, a.record, 0))); // prettier-ignore
  });

  it('never draws from Math.random: the battle stream’s cursor is where it was', () => {
    const battle = createBattleRng(4242);
    const spy = vi.spyOn(Math, 'random').mockImplementation(battle);
    battle();
    battle();
    const cursor = battle.getState();
    const u = unitAt();
    const r = run();
    for (let n = 0; n < 3; n++)
      expect(
        rerollLevelUp(r, u, u.record, {
          rng: battleLevelUpRerollRng(17, u, u.record, rerollsSpent(r)),
        }).ok,
      ).toBe(true);
    expect(spy).not.toHaveBeenCalled();
    expect(battle.getState()).toEqual(cursor);
  });
});

describe('the pool and the commit', () => {
  it('spends one charge per reroll; the same level rerolls again while charges last', () => {
    const r = run(2);
    const u = unitAt();
    const roll = () =>
      rerollLevelUp(r, u, u.record, { rng: runLevelUpRerollRng(r, u, u.record, rerollsSpent(r)) });
    expect(roll().ok).toBe(true);
    expect(roll().ok).toBe(true);
    expect([r.rewardRerollsSpent, rerollsLeft(r)]).toEqual([2, 0]);
    const before = structuredClone(u);
    expect(roll()).toEqual({ ok: false, reason: 'spent' });
    expect(u).toEqual(before);
  });

  it('a failed save puts the stats, HP, record, streak flag and charge back', () => {
    const r = run(2, { rewardRerollsSpent: 1 });
    const u = unitAt({ hp: 9 });
    u.lastLevelUpThin = false;
    u.record.guard = true;
    u.record.thinBefore = false;
    const before = structuredClone({ stats: u.stats, hp: u.currentHP, record: u.record });
    const persist = vi.fn(() => false);
    const result = rerollLevelUp(r, u, u.record, { rng: scripted(drawsFor(['SPD'])), persist });
    expect(result).toEqual({ ok: false, reason: 'save', saveFailed: true });
    expect(persist).toHaveBeenCalledTimes(1);
    expect({ stats: u.stats, hp: u.currentHP, record: u.record }).toEqual(before);
    expect(u.lastLevelUpThin).toBe(false);
    expect(r.rewardRerollsSpent).toBe(1);
  });

  it('persist sees the new state (what is saved is what is shown)', () => {
    const r = run();
    const u = unitAt();
    let seen = null;
    rerollLevelUp(r, u, u.record, {
      rng: scripted(drawsFor(['RES'])),
      persist: () => ((seen = { res: u.stats.RES, spent: r.rewardRerollsSpent }), true),
    });
    expect(seen).toEqual({ res: 3, spent: 1 });
  });

  it('a mirror (the roster copy after a victory) takes the same swap', () => {
    const u = unitAt();
    const twin = structuredClone(u);
    rerollLevelUp(run(), u, u.record, { rng: scripted(drawsFor(['LCK'])), mirrors: [twin] });
    expect(twin.stats).toEqual(u.stats);
    expect(twin.currentHP).toBe(u.currentHP);
  });

  it('refuses what is not a level the unit holds, a foe, or a run without rerolls', () => {
    const u = unitAt();
    expect(levelUpRerollBlock(run(), u, { gains: gainsOf(['HP']), newLevel: 9 })).toBe('invalid');
    expect(levelUpRerollBlock(run(), { ...u, faction: 'enemy' }, u.record)).toBe('invalid');
    expect(levelUpRerollBlock(run(), u, { newLevel: 6 })).toBe('invalid');
    expect(levelUpRerollBlock(run(0), u, u.record)).toBe('none');
    expect(levelUpRerollBlock(run(3, { mode: 'prologue' }), u, u.record)).toBe('none');
    expect(levelUpRerollBlock(run(), u, u.record)).toBe('');
  });

  it('one pool with the battle-reward reroll (a real run with Branching Threads II)', () => {
    const data = loadGameData();
    const meta = new MetaProgressionManager(data.metaUpgrades, 'lur-pool');
    meta.purchasedUpgrades.branching_threads = 2;
    const rm = new RunManager(data, meta.getActiveEffects());
    rm.startRun({ runSeed: 21, applyBlessingsAtStart: false });
    prepareBattleRewards(rm, data, { goldEarned: 50, metaEffects: rm.metaEffects });
    expect(rerollBattleReward(rm, data).ok).toBe(true);
    const lord = rm.roster[0];
    lord.level = 5; // as if level 5 was just reached with +1 HP
    const record = { gains: gainsOf(['HP']), newLevel: lord.level };
    expect(levelUpRerollStatus(rm, lord, record)).toEqual({ granted: 2, left: 1, block: '' });
    expect(rerollLevelUp(rm, lord, record, { rng: runLevelUpRerollRng(rm, lord, record, 1) }).ok).toBe(true); // prettier-ignore
    expect(rm.rewardRerollsSpent).toBe(2);
    expect(levelUpRerollStatus(rm, lord, record).block).toBe('spent');
    expect(rerollBattleReward(rm, data)).toMatchObject({ ok: false, reason: 'spent' });
    // The prologue run has none.
    const prologue = new RunManager(data, meta.getActiveEffects());
    prologue.startRun({ runSeed: 21, applyBlessingsAtStart: false });
    prologue.mode = 'prologue';
    expect(levelUpRerollStatus(prologue, prologue.roster[0], record).granted).toBe(0);
  });
});

describe('the streak guard and the reroll', () => {
  it('a guarded level rerolls with the flag it was rolled with, and sets it from the new gains', () => {
    const u = unitAt({ gains: gainsOf(['HP', 'STR']) });
    // The level was rolled after a thin level (flag true), and was itself not thin.
    u.record.guard = true;
    u.record.thinBefore = true;
    u.lastLevelUpThin = false;
    // New draws: only SPD passes; the closest miss of the rest at growth 50 is LCK (0.55).
    const draws = drawsFor(['SPD']);
    draws[7] = 0.55;
    const result = rerollLevelUp(run(), u, u.record, { rng: scripted(draws) });
    expect(result.ok).toBe(true);
    // The guard (thin before, one stat) added the closest miss: two stats, not thin.
    expect(u.record.gains).toEqual(gainsOf(['SPD', 'LCK']));
    expect(u.lastLevelUpThin).toBe(false);
    // Unguarded the same draws give one stat: the flag would read thin.
    expect(levelUp({ ...u, level: 5, lastLevelUpThin: true }, scripted(draws)).gains).toEqual(gainsOf(['SPD'])); // prettier-ignore
  });

  it('a guarded level not thin before stays one stat, and the flag reads thin', () => {
    const u = unitAt({ gains: gainsOf(['HP', 'STR']) });
    Object.assign(u.record, { guard: true, thinBefore: false });
    u.lastLevelUpThin = false;
    rerollLevelUp(run(), u, u.record, { rng: scripted(drawsFor(['SPD'])) });
    expect(u.record.gains).toEqual(gainsOf(['SPD']));
    expect(u.lastLevelUpThin).toBe(true);
  });
});

describe('the button', () => {
  it('hidden without rerolls; counts the shared pool; disabled when spent or not offered', () => {
    expect(levelUpRerollButtonState(null)).toEqual({ hidden: true });
    expect(levelUpRerollButtonState({ granted: 0, left: 0, block: 'none' })).toEqual({ hidden: true }); // prettier-ignore
    expect(levelUpRerollButtonState({ granted: 3, left: 2, block: '' })).toMatchObject({
      hidden: false,
      disabled: false,
      label: 'Reroll (2)',
    });
    expect(levelUpRerollButtonState({ granted: 3, left: 0, block: 'spent' })).toMatchObject({
      hidden: false,
      disabled: true,
      label: 'No rerolls left',
    });
    expect(levelUpRerollButtonState({ granted: 3, left: 2, block: 'invalid' })).toMatchObject({
      hidden: false,
      disabled: true,
      label: 'Reroll (2)',
      reason: 'Only your latest level can be rerolled.',
    });
  });
});
