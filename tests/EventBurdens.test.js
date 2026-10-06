// Burdens (docs/specs/event-nodes.md §7): Ill Omen and Debt settle at the victory commit.
//
// Ways this goes wrong:
//   - Ill Omen adds its shadow after the cap, or not before it (the act's pressure and the
//     meter disagree), or runs past its battles, or ticks on a battle that was not won;
//   - Debt takes the wrong share (First Light's quarter vs a half), more than is owed, or never
//     ends; a zero-gold victory eats a debt it paid nothing on;
//   - a reverted or suspended battle changes a burden (the revert must leave both exactly as
//     they were at entry), or a replayed battle after a revert ticks twice;
//   - the settlement the victory band shows is missing or wrong.
// Numbers by hand: first-light kill gold 100 on a battle node = 234 gold (see EventBattles);
// eclipse.json: grace 3, cap 100, max gain 6.
import { describe, expect, it } from 'vitest';
import {
  addBurden,
  burdenEffectsOnVictory,
  describeBurdens,
  normalizeBurdens,
  settlementLines,
} from '../src/engine/Burdens.js';
import {
  RunManager,
  clearBattleInProgressInSave,
  loadRun,
  saveRun,
} from '../src/engine/RunManager.js';
import { newRun } from './eventKit.js';

const BATTLE_GOLD = 234; // First Light, kill gold 100, no elite

function nextBattle(run) {
  const available = run.getAvailableNodes();
  const node = available.find((n) => n.type === 'battle') || available[0];
  return node;
}

/** Win the next battle node: `turns` against `par` (par - grace = free turns). */
function win(run, { turns = 1, par = 10, gold = 100 } = {}) {
  const node = nextBattle(run);
  expect(
    run.completeBattle(run.getRoster(), node.id, gold, { turnCount: turns, turnPar: par }),
  ).toBe(true);
  return node;
}

describe('Ill Omen', () => {
  it('adds its shadow to each victory for its battles, then ends', () => {
    const run = newRun();
    run.burdens = [{ id: 'ill_omen', battles: 2, extraShadow: 1 }];
    win(run); // turns 1: base gain 0
    expect(run.eclipse.shadow).toBe(1);
    expect(run.eclipse.actShadow).toBe(1);
    expect(run.burdens).toEqual([{ id: 'ill_omen', battles: 1, extraShadow: 1 }]);
    win(run);
    expect(run.eclipse.shadow).toBe(2);
    expect(run.burdens).toEqual([]);
    win(run);
    expect(run.eclipse.shadow).toBe(2); // gone: nothing more
  });

  it('is added to the gain before the cap: base 3 + 1 = 4 on both meters', () => {
    const run = newRun();
    run.burdens = [{ id: 'ill_omen', battles: 3, extraShadow: 1 }];
    win(run, { turns: 10, par: 10 }); // free = 10 - 3 = 7: gain 3
    expect(run.lastEclipseCommit).toMatchObject({ gain: 4, burdenShadow: 1 });
    expect(run.eclipse.shadow).toBe(4);
    expect(run.eclipse.actShadow).toBe(4);
  });

  it('at the cap the meter takes what fits and the act pressure takes it all', () => {
    const run = newRun();
    run.eclipse = { ...run.eclipse, shadow: 99, actShadow: 20 };
    run.burdens = [{ id: 'ill_omen', battles: 3, extraShadow: 2 }];
    win(run, { turns: 10, par: 10 }); // gain 3 + 2 = 5
    expect(run.eclipse.shadow).toBe(100);
    expect(run.eclipse.actShadow).toBe(25);
    expect(run.lastEclipseCommit.meterGain).toBe(1);
  });

  it('ticks only on a victory that is committed (a completion of a finished node does nothing)', () => {
    const run = newRun();
    run.burdens = [{ id: 'ill_omen', battles: 2, extraShadow: 1 }];
    const node = win(run);
    const again = run.completeBattle(run.getRoster(), node.id, 100, { turnCount: 1, turnPar: 10 });
    expect(again).toBe(false);
    expect(run.burdens).toEqual([{ id: 'ill_omen', battles: 1, extraShadow: 1 }]);
    expect(run.eclipse.shadow).toBe(1);
  });

  it('with the Eclipse off it still counts down, and adds no shadow', () => {
    const run = newRun();
    run.eclipse = { ...run.eclipse, enabled: false };
    run.burdens = [{ id: 'ill_omen', battles: 1, extraShadow: 1 }];
    win(run);
    expect(run.eclipse.shadow).toBe(0);
    expect(run.burdens).toEqual([]);
  });
});

describe('Debt', () => {
  it('garnishes a quarter of the battle gold on First Light until it is paid, then ends', () => {
    const run = newRun();
    run.burdens = [{ id: 'debt', owed: 100, garnish: 0.25 }];
    const before = run.gold;
    win(run);
    // share = floor(234 x .25) = 58
    expect(run.gold - before).toBe(BATTLE_GOLD - 58);
    expect(run.burdens).toEqual([{ id: 'debt', owed: 42, garnish: 0.25 }]);
    expect(run.lastBurdenSettlement).toMatchObject({
      debt: { paid: 58, remaining: 42, cleared: false },
      goldBefore: BATTLE_GOLD,
      goldAfter: BATTLE_GOLD - 58,
    });
    const mid = run.gold;
    win(run);
    // only 42 left to pay
    expect(run.gold - mid).toBe(BATTLE_GOLD - 42);
    expect(run.burdens).toEqual([]);
    expect(run.lastBurdenSettlement.debt).toEqual({ paid: 42, remaining: 0, cleared: true });
    const done = run.gold;
    win(run);
    expect(run.gold - done).toBe(BATTLE_GOLD);
    expect(run.lastBurdenSettlement).toBeNull();
  });

  it('takes half above First Light (Nightfall pays 210 for the same fight: 234 x .9)', () => {
    const run = newRun({ difficulty: 'hard' });
    run.burdens = [{ id: 'debt', owed: 1000, garnish: 0.5 }];
    const before = run.gold;
    win(run);
    expect(run.gold - before).toBe(210 - 105);
    expect(run.burdens[0].owed).toBe(895);
  });

  it('a victory that earns no gold pays nothing and the debt stays', () => {
    const run = newRun();
    run.burdens = [{ id: 'debt', owed: 100, garnish: 0.25 }];
    const node = nextBattle(run);
    run.completeBattle(run.getRoster(), node.id, 0, {
      turnCount: 1,
      turnPar: 10,
      completionGoldOverride: 0,
    });
    expect(run.burdens).toEqual([{ id: 'debt', owed: 100, garnish: 0.25 }]);
  });

  it('together with an Ill Omen both settle in one commit', () => {
    const run = newRun();
    run.burdens = [
      { id: 'ill_omen', battles: 1, extraShadow: 1 },
      { id: 'debt', owed: 500, garnish: 0.25 },
    ];
    const before = run.gold;
    win(run);
    expect(run.gold - before).toBe(BATTLE_GOLD - 58);
    expect(run.eclipse.shadow).toBe(1);
    expect(run.burdens).toEqual([{ id: 'debt', owed: 442, garnish: 0.25 }]);
    expect(run.lastBurdenSettlement).toMatchObject({
      debt: { paid: 58 },
      illOmen: { extraShadow: 1, remaining: 0, ended: true },
    });
  });
});

describe('a reverted battle leaves both burdens exactly as they were', () => {
  it('Continue from Map restores the entry state: burdens, gold, shadow', () => {
    const run = newRun();
    run.burdens = [
      { id: 'ill_omen', battles: 3, extraShadow: 1 },
      { id: 'debt', owed: 300, garnish: 0.25 },
    ];
    const node = nextBattle(run);
    const burdens = structuredClone(run.burdens);
    const gold = run.gold;
    const shadow = structuredClone(run.eclipse);
    run.beginBattleInProgress(node.id, { battleParams: run.getBattleParams(node) });
    run.setBattleCheckpoint({ turn: 4 });
    expect(run.revertBattleInProgressToEntry()).toBe(true);
    expect(run.burdens).toEqual(burdens);
    expect(run.gold).toBe(gold);
    expect(run.eclipse).toEqual(shadow);
    expect(run.lastBurdenSettlement).toBeNull();
    // Replaying the node settles exactly once.
    win(run);
    expect(run.burdens).toEqual([
      { id: 'ill_omen', battles: 2, extraShadow: 1 },
      { id: 'debt', owed: 242, garnish: 0.25 },
    ]);
  });

  it('a suspended battle saved to the slot and sent back to the map (the raw-save revert) keeps them', () => {
    const store = {};
    const original = globalThis.localStorage;
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: (key) => store[key] ?? null,
        setItem: (key, value) => {
          store[key] = value;
        },
        removeItem: (key) => {
          delete store[key];
        },
      },
      writable: true,
      configurable: true,
    });
    try {
      const run = newRun();
      run.burdens = [
        { id: 'ill_omen', battles: 3, extraShadow: 1 },
        { id: 'debt', owed: 300, garnish: 0.25 },
      ];
      const node = nextBattle(run);
      run.beginBattleInProgress(node.id, { battleParams: run.getBattleParams(node) });
      run.setBattleCheckpoint({ version: 1, turnNumber: 4 });
      expect(saveRun(run, null, 1).ok).toBe(true);
      const result = clearBattleInProgressInSave(null, 1);
      expect(result.ok).toBe(true);
      const loaded = loadRun(run.gameData, 1);
      expect(loaded.battleInProgress).toBeNull();
      expect(loaded.burdens).toEqual([
        { id: 'ill_omen', battles: 3, extraShadow: 1 },
        { id: 'debt', owed: 300, garnish: 0.25 },
      ]);
      expect(loaded.eclipse.shadow).toBe(0);
    } finally {
      Object.defineProperty(globalThis, 'localStorage', {
        value: original,
        writable: true,
        configurable: true,
      });
    }
  });

  it('a burden is saved with the run and survives a reload untouched until the commit', () => {
    const run = newRun();
    run.burdens = [{ id: 'ill_omen', battles: 3, extraShadow: 1 }];
    const loaded = RunManager.fromJSON(JSON.parse(JSON.stringify(run.toJSON())), run.gameData);
    expect(loaded.burdens).toEqual([{ id: 'ill_omen', battles: 3, extraShadow: 1 }]);
  });
});

describe('the burden helpers', () => {
  it('addBurden resolves the numbers for the rung and never stacks', () => {
    const run = newRun({ difficulty: 'dusk' });
    expect(addBurden(run, 'ill_omen').burden).toEqual({
      id: 'ill_omen',
      battles: 3,
      extraShadow: 1,
    });
    expect(addBurden(run, 'debt', { owed: 200 }).burden).toEqual({
      id: 'debt',
      owed: 200,
      garnish: 0.5,
    });
    addBurden(run, 'debt', { owed: 100 });
    expect(run.burdens.filter((b) => b.id === 'debt')).toHaveLength(1);
    expect(run.burdens.find((b) => b.id === 'debt').owed).toBe(300);
    expect(addBurden(run, 'curse')).toMatchObject({ ok: false });
  });

  it('burdenEffectsOnVictory is pure: it returns the next state and changes nothing', () => {
    const run = newRun();
    run.burdens = [{ id: 'debt', owed: 100, garnish: 0.25 }];
    const plan = burdenEffectsOnVictory(run, { gold: 200, shadowGain: 2 });
    expect(plan).toMatchObject({ gold: 150, garnished: 50, shadowGain: 2, extraShadow: 0 });
    expect(plan.burdens).toEqual([{ id: 'debt', owed: 50, garnish: 0.25 }]);
    expect(run.burdens).toEqual([{ id: 'debt', owed: 100, garnish: 0.25 }]);
  });

  it('normalizeBurdens drops what is spent, unknown or malformed', () => {
    expect(
      normalizeBurdens([
        { id: 'ill_omen', battles: 0, extraShadow: 1 },
        { id: 'debt', owed: -5 },
        { id: 'curse', owed: 5 },
        null,
        'debt',
        { id: 'debt', owed: 10.9, garnish: 7 },
        { id: 'debt', owed: 99 },
        { id: 'ill_omen', battles: 2 },
      ]),
    ).toEqual([
      { id: 'debt', owed: 10, garnish: 0.5 },
      { id: 'ill_omen', battles: 2, extraShadow: 1 },
    ]);
  });

  it('describes burdens for the route map and words the victory band', () => {
    const run = newRun();
    run.burdens = [
      { id: 'ill_omen', battles: 2, extraShadow: 1 },
      { id: 'debt', owed: 450, garnish: 0.25 },
    ];
    const chips = describeBurdens(run);
    expect(chips.map((c) => c.label)).toEqual(['Ill Omen', 'Debt']);
    expect(chips[0].detail).toBe('2 battles left, +1 shadow each');
    expect(chips[1].detail).toBe("450 G owed, 25% of each victory's gold");
    expect(
      settlementLines({
        debt: { paid: 58, remaining: 0, cleared: true },
        illOmen: { extraShadow: 1, remaining: 1, ended: false },
      }),
    ).toEqual(['Debt −58 G (paid off)', 'Ill Omen +1']);
    expect(settlementLines(null)).toEqual([]);
  });
});
