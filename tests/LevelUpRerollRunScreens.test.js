// Level-up rerolls between battles (Branching Threads): the reward screen's Team XP lines and
// the arena's level-up cards. Each commits through the screen's own run save, atomically.
//
// Ways this can fail, one test (or more) each:
//   - a Team XP reroll that is not saved (a reload brings the old gains back, or keeps the
//     charge spent with the old gains), or whose line still shows the old gains
//   - a failed save leaving the new gains or the spent charge in memory, or the screen stuck
//     behind a save error although nothing is unsaved
//   - the notice's Reroll rerolling the wrong line, or shown without rerolls
//   - the arena card's reroll unsaved, or the result card left showing the old gains
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFakeDom } from './helpers/fakeDom.js';
import { RunManager, loadRun } from '../src/engine/RunManager.js';
import { awardTeamXp, teamXpLines } from '../src/engine/TeamXp.js';
import { PendingRewardController } from '../src/ui/PendingRewardController.js';
import { MobileRewards } from '../src/ui/MobileRewards.js';
import { ColosseumOverlay } from '../src/ui/ColosseumOverlay.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
let failWrites;
let store;
beforeEach(() => {
  failWrites = false;
  store = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => {
      if (failWrites) throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
      store.set(k, String(v));
    },
    removeItem: (k) => store.delete(k),
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const STATS = ['HP', 'STR', 'MAG', 'SKL', 'SPD', 'DEF', 'RES', 'LCK'];
const host = (run) => ({
  runManager: run,
  gameData: data,
  registry: { get: (k) => (k === 'activeSlot' ? 1 : null) },
});
function runWith(rerolls) {
  const run = new RunManager(data, { rewardRerolls: rerolls });
  run.startRun({ runSeed: 31, applyBlessingsAtStart: false });
  return run;
}
/** The roster after a Team XP card that levelled its first unit (Math.random fixed). */
function teamXp(run) {
  const unit = run.roster[0];
  unit.xp = 90;
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  const report = awardTeamXp([unit], 25, data.classes);
  vi.restoreAllMocks();
  expect(report[0].levelUps).toHaveLength(1);
  return { unit, entry: report[0] };
}
/** A PendingRewardController with only what Team XP rerolls use. */
function rewardScreen(run) {
  const c = Object.create(PendingRewardController.prototype);
  Object.assign(c, { host: host(run), saveError: '' });
  return c;
}
const statsOf = (u) => ({ ...Object.fromEntries(STATS.map((s) => [s, u.stats[s]])), hp: u.currentHP }); // prettier-ignore

describe('Team XP', () => {
  it('a line’s reroll is saved with its charge, and the line shows the new gains', () => {
    const run = runWith(2);
    const { unit, entry } = teamXp(run);
    const screen = rewardScreen(run);
    const reroll = screen.teamXpReroll(entry);
    expect(reroll.state()).toMatchObject({ hidden: false, label: 'Reroll (2)' });
    const out = reroll.run();
    expect(out.ok).toBe(true);
    expect(out.line).toBe(teamXpLines([entry], data.skills)[0]);
    expect(entry.gains).toEqual(entry.levelUps[0].gains);
    const saved = loadRun(data, 1);
    expect(saved.rewardRerollsSpent).toBe(1);
    expect(statsOf(saved.roster[0])).toEqual(statsOf(unit));
    expect(reroll.state().label).toBe('Reroll (1)');
  });

  it('a failed save changes nothing and leaves the screen usable (nothing is unsaved)', () => {
    const run = runWith(2);
    const { unit, entry } = teamXp(run);
    const screen = rewardScreen(run);
    const before = { stats: statsOf(unit), gains: { ...entry.levelUps[0].gains } };
    failWrites = true;
    const out = screen.teamXpReroll(entry).run();
    expect(out).toMatchObject({ ok: false, message: 'Could not save the reroll: nothing changed.' }); // prettier-ignore
    expect(statsOf(unit)).toEqual(before.stats);
    expect(entry.levelUps[0].gains).toEqual(before.gains);
    expect(run.rewardRerollsSpent).toBe(0);
    expect(screen.saveError).toBe('');
  });

  it('no rerolls: no handle (no button); the prologue run: none either', () => {
    const run = runWith(0);
    expect(rewardScreen(run).teamXpReroll(teamXp(run).entry)).toBeNull();
    const prologue = runWith(3);
    prologue.mode = 'prologue';
    expect(rewardScreen(prologue).teamXpReroll(teamXp(prologue).entry)).toBeNull();
  });

  it('the notice shows a Reroll under each levelled line and rerolls that line', () => {
    const dom = installFakeDom(vi);
    const view = Object.create(MobileRewards.prototype);
    const audio = { playSFX: vi.fn() };
    const handle = (i) => ({
      left: 2,
      state() {
        return { hidden: false, disabled: false, label: `Reroll (${this.left})`, reason: '' };
      },
      run: vi.fn(function () {
        this.left--;
        return { ok: true, line: `line ${i} rerolled` };
      }),
    });
    const rerolls = [handle(0), null, handle(2)];
    Object.assign(view, {
      root: dom.doc.createElement('div'),
      busy: false,
      visible: true,
      scene: { registry: { get: () => audio } },
      controller: { saveError: '' },
      steps: [],
      notice: {
        title: 'Team XP',
        lines: ['a', 'b', 'c'],
        bars: null,
        rerolls,
        message: '',
      },
    });
    dom.doc.body.append(view.root);
    view.render();
    const buttons = () => view.root.querySelectorAll('.reward-notice-reroll');
    expect(buttons()).toHaveLength(2);
    buttons()[1].click();
    expect(rerolls[2].run).toHaveBeenCalledTimes(1);
    expect(rerolls[0].run).not.toHaveBeenCalled();
    expect(view.notice.lines).toEqual(['a', 'b', 'line 2 rerolled']);
    expect(view.root.querySelector('.reward-notice-status').textContent).toBe('New gains rolled.');
    expect(audio.playSFX).toHaveBeenCalledWith('sfx_confirm');
  });
});

describe('the arena', () => {
  it('a card’s reroll is saved; the result card is redrawn with the new gains', async () => {
    const run = runWith(1);
    const unit = run.roster[0];
    unit.xp = 90;
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const { levelUps } = (await import('../src/engine/UnitManager.js')).gainExperience(unit, 20, {
      guard: true,
    });
    vi.restoreAllMocks();
    const levelUpInfo = { from: '1', to: '2', ups: levelUps, learnedSkills: [] };
    const overlay = Object.create(ColosseumOverlay.prototype);
    Object.assign(overlay, {
      scene: host(run),
      runManager: run,
      gameData: data,
      visible: true,
      _selectedUnit: unit,
      _showResult: vi.fn(),
    });
    let shownGains = null;
    const growth = {
      destroyed: false,
      showLevelUp: vi.fn(async ({ reroll, result }) => {
        expect(reroll.state().label).toBe('Reroll (1)');
        expect(reroll.run().ok).toBe(true);
        shownGains = { ...result.gains };
        expect(reroll.state().label).toBe('No rerolls left');
      }),
    };
    await overlay._playArenaLevelUps(growth, levelUpInfo, { outcome: 'win', tier: { name: 'Bronze' } }); // prettier-ignore
    // The level's own record changed (the result card lists levelUpInfo.ups' gains).
    expect(levelUps[0].gains).toEqual(shownGains);
    expect(overlay._showResult).toHaveBeenCalledWith('win', { name: 'Bronze' });
    const saved = loadRun(data, 1);
    expect(saved.rewardRerollsSpent).toBe(1);
    expect(statsOf(saved.roster[0])).toEqual(statsOf(unit));
  });
});
