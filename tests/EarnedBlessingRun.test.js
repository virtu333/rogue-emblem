// Earned blessings, the run side: the mid-run sources refuse them, their boons are handled and
// saved, Second Dawn pays at each act's start (never on the take, never twice), and the held
// list, the card and the Compendium say "Earned" in place of a tier.
import { describe, expect, it, vi } from 'vitest';
import { RunManager } from '../src/engine/RunManager.js';
import { describeActStartGrants } from '../src/engine/ActStartNotice.js';
import { churchBlessingOffers, takeChurchBlessing } from '../src/engine/ChurchVow.js';
import { availableEventBlessings, isSafeEventBlessing } from '../src/engine/EventSystem.js';
import { heldBlessingEntries } from '../src/ui/heldBlessingsModel.js';
import { blessingCardContent } from '../src/ui/choiceContent.js';
import { CompendiumOverlay, TAB_DEFS } from '../src/ui/CompendiumOverlay.js';
import { compendiumEntries } from '../src/ui/ReferenceMenu.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const EARNED_IDS = ['unbroken_banner', 'second_dawn', 'ember_lantern', 'captains_whistle'];

function freshRun(seed = 21, difficultyId = 'normal') {
  const rm = new RunManager(data);
  rm.startRun({ runSeed: seed, difficultyId, applyBlessingsAtStart: false });
  rm.blessingHistory = [];
  return rm;
}
const roundTrip = (rm) => RunManager.fromJSON(JSON.parse(JSON.stringify(rm.toJSON())), data);

describe('the mid-run sources never hand out an earned blessing', () => {
  it('a church altar never offers one, across 300 nodes', () => {
    const rm = freshRun();
    for (let i = 0; i < 300; i++)
      for (const b of churchBlessingOffers(rm, `act1_r${i}_0`, data)) {
        expect(EARNED_IDS, `${b.id} at node ${i}`).not.toContain(b.id);
      }
  });

  it('even a catalog that gave an earned row a tier 1 is filtered by the flag itself', () => {
    const rm = freshRun();
    const hacked = structuredClone(data);
    for (const b of hacked.blessings.blessings) if (b.earned) b.tier = 1;
    const ids = new Set();
    for (let i = 0; i < 100; i++)
      for (const b of churchBlessingOffers(rm, `n${i}`, hacked)) ids.add(b.id);
    expect(ids.size).toBeGreaterThan(0);
    for (const id of EARNED_IDS) expect(ids.has(id), id).toBe(false);
  });

  it('a church refuses to take one by id', () => {
    const rm = freshRun();
    const result = takeChurchBlessing(rm, 'act1_r3_0', 'unbroken_banner', data);
    expect(result.ok).toBe(false);
    expect(rm.getActiveBlessingIds()).not.toContain('unbroken_banner');
  });

  it('an event never grants one, even when its boon type and a tier would pass the safe list', () => {
    const rm = freshRun();
    const hacked = structuredClone(data);
    for (const b of hacked.blessings.blessings)
      if (b.earned) {
        b.tier = 1;
        b.boons = [{ type: 'all_act_hit_bonus', params: { value: 3 } }];
      }
    expect(isSafeEventBlessing(hacked.blessings.blessings.at(-1))).toBe(false);
    rm.gameData = hacked;
    for (const tier of [1, 2, 3, 4])
      for (const b of availableEventBlessings(rm, tier)) expect(EARNED_IDS).not.toContain(b.id);
  });

  it('addBlessingMidRun refuses an earned id unless the caller says it is the earned source', () => {
    const rm = freshRun();
    for (const id of EARNED_IDS) {
      expect(rm.addBlessingMidRun(id), id).toBe(false);
      expect(rm.addBlessingMidRun(id, {}), id).toBe(false);
      expect(rm.addBlessingMidRun(id, { earned: false }), id).toBe(false);
    }
    expect(rm.activeBlessings).toEqual([]);
    expect(rm.addBlessingMidRun('unbroken_banner', { earned: true })).toBe(true);
    expect(rm.getActiveBlessingIds()).toEqual(['unbroken_banner']);
    expect(rm.activeBlessings[0]).toMatchObject({ id: 'unbroken_banner', midRun: true });
    // Not twice.
    expect(rm.addBlessingMidRun('unbroken_banner', { earned: true })).toBe(false);
  });

  it("the earned source does not open the pact and intrinsic-price cards' back door", () => {
    const rm = freshRun();
    expect(rm.addBlessingMidRun('slow_fuse', { earned: true })).toBe(false);
    expect(rm.addBlessingMidRun('scholar_vow', { earned: true })).toBe(false);
    expect(rm.activeBlessings).toEqual([]);
  });
});

describe('the four boons have handlers and are saved', () => {
  const BOONS = [
    ['unbroken_banner', 'battle_last_stand', 'battleLastStand', { lastStand: 1 }],
    ['second_dawn', 'act_start_vision_delta', null, {}],
    ['ember_lantern', 'first_kill_heal', 'firstKillHeal', { firstKillHeal: 10 }],
    ['captains_whistle', 'first_turn_mov_delta', 'firstTurnMovDelta', { firstTurnMov: 1 }],
  ];

  it.each(BOONS)('%s: %s raises %s and leaves the others at 0', (id, type, field) => {
    const rm = freshRun();
    expect(rm.addBlessingMidRun(id, { earned: true })).toBe(true);
    const mods = rm.blessingRuntimeModifiers;
    const fields = ['battleLastStand', 'firstKillHeal', 'firstTurnMovDelta'];
    for (const f of fields) expect(mods[f] > 0, f).toBe(f === field);
    // Second Dawn raises no field: it registers an act-start grant (kind 'vision').
    expect(mods.actStartGrants.length > 0).toBe(field === null);
    const event = rm.blessingHistory.find((r) => r.effectType === type);
    expect(event?.details?.skipped).toBeUndefined();
  });

  it('getBattleBlessingEffects reads the held numbers, all 0 when none is held', () => {
    const rm = freshRun();
    expect(rm.getBattleBlessingEffects()).toEqual({
      lastStand: 0,
      firstKillHeal: 0,
      firstTurnMov: 0,
    });
    for (const id of EARNED_IDS) rm.addBlessingMidRun(id, { earned: true });
    expect(rm.getBattleBlessingEffects()).toEqual({
      lastStand: 1,
      firstKillHeal: 10,
      firstTurnMov: 1,
    });
    expect(rm.blessingRuntimeModifiers.actStartGrants).toEqual([
      { blessingId: 'second_dawn', kind: 'vision', value: 1, paidActs: ['act1'] },
    ]);
  });

  it('a malformed value is skipped as invalid (the validator refuses it first)', () => {
    const rm = freshRun();
    for (const type of BOONS.map((b) => b[1]))
      rm._applySingleRunStartBlessingEffect('x', { type, params: { value: 0 } });
    expect(rm.blessingHistory.map((r) => r.details.reason)).toEqual(
      BOONS.map((b) => `invalid_${b[1]}_params`),
    );
    expect(rm.getBattleBlessingEffects()).toEqual({
      lastStand: 0,
      firstKillHeal: 0,
      firstTurnMov: 0,
    });
  });

  it('survive a save and load, and a save from before them loads with the defaults', () => {
    const rm = freshRun();
    for (const id of EARNED_IDS) rm.addBlessingMidRun(id, { earned: true });
    const back = roundTrip(rm);
    expect(back.getBattleBlessingEffects()).toEqual(rm.getBattleBlessingEffects());
    expect(back.blessingRuntimeModifiers.actStartGrants).toEqual(
      rm.blessingRuntimeModifiers.actStartGrants,
    );
    expect(back.getActiveBlessingIds()).toEqual(EARNED_IDS);

    const old = JSON.parse(JSON.stringify(freshRun().toJSON()));
    for (const f of ['battleLastStand', 'firstKillHeal', 'firstTurnMovDelta'])
      delete old.blessingRuntimeModifiers[f];
    delete old.earnedBlessingPicks;
    const loaded = RunManager.fromJSON(old, data);
    expect(loaded.getBattleBlessingEffects()).toEqual({
      lastStand: 0,
      firstKillHeal: 0,
      firstTurnMov: 0,
    });
    expect(loaded.earnedBlessingPicks).toEqual({});
    // And a corrupt number is read as 0, never NaN.
    old.blessingRuntimeModifiers.firstKillHeal = 'lots';
    expect(RunManager.fromJSON(old, data).getBattleBlessingEffects().firstKillHeal).toBe(0);
  });
});

describe('Second Dawn pays +1 Vision at the start of each act (an act-start grant)', () => {
  it('not when it is taken', () => {
    const rm = freshRun();
    const before = rm.visionChargesRemaining;
    rm.addBlessingMidRun('second_dawn', { earned: true });
    expect(rm.visionChargesRemaining).toBe(before);
  });

  it('not when another act-start grant pays the current act at the take', () => {
    // Taking Quartermaster Cache pays the current act's Elixir; that sweep must not reach
    // Second Dawn's grant, which is stamped as paid for the act it is taken in.
    const rm = freshRun();
    rm.addBlessingMidRun('second_dawn', { earned: true });
    const before = rm.visionChargesRemaining;
    expect(rm._payActStartGrants('mid_run')).toEqual([]);
    expect(rm.visionChargesRemaining).toBe(before);
  });

  it('on entering the next act, written by the shared act-start notice', () => {
    const rm = freshRun();
    rm.addBlessingMidRun('second_dawn', { earned: true });
    const before = rm.visionChargesRemaining;
    const result = rm.advanceAct();
    expect(rm.visionChargesRemaining).toBe(before + 1);
    expect(describeActStartGrants(result.actStartGrants)).toBe('Second Dawn: +1 Vision');
    expect(describeActStartGrants(rm.takeActStartNotice())).toBe('Second Dawn: +1 Vision');
    expect(rm.takeActStartNotice()).toEqual([]);
    const event = rm.blessingHistory.find((r) => r.stage === 'act_transition');
    expect(event).toMatchObject({
      blessingId: 'second_dawn',
      effectType: 'act_start_vision_delta',
    });
  });

  it('the notice takes its name from the catalog', () => {
    const renamed = structuredClone(data);
    renamed.blessings.blessings.find((b) => b.id === 'second_dawn').name = 'Late Sunrise';
    const rm = new RunManager(renamed);
    rm.startRun({ runSeed: 21, applyBlessingsAtStart: false });
    rm.addBlessingMidRun('second_dawn', { earned: true });
    rm.advanceAct();
    expect(describeActStartGrants(rm.takeActStartNotice())).toBe('Late Sunrise: +1 Vision');
  });

  it('at every act, not just the first', () => {
    const rm = freshRun();
    rm.addBlessingMidRun('second_dawn', { earned: true });
    const before = rm.visionChargesRemaining;
    rm.advanceAct();
    rm.advanceAct();
    rm.advanceAct();
    expect(rm.visionChargesRemaining).toBe(before + 3);
  });

  it('once per act across a save and load (the act index, the charge and the ledger are saved together)', () => {
    const rm = freshRun();
    rm.addBlessingMidRun('second_dawn', { earned: true });
    const before = rm.visionChargesRemaining;
    rm.advanceAct();
    const back = roundTrip(rm);
    expect(back.actIndex).toBe(1);
    expect(back.visionChargesRemaining).toBe(before + 1);
    expect(back.blessingRuntimeModifiers.actStartGrants[0].paidActs).toEqual(['act1', 'act2']);
    // Loading pays nothing, and re-asking for the act's grants pays nothing twice.
    expect(back.takeActStartNotice()).toEqual([]);
    expect(back._payActStartGrants('act_transition')).toEqual([]);
    expect(back.visionChargesRemaining).toBe(before + 1);
    back.advanceAct();
    expect(back.visionChargesRemaining).toBe(before + 2);
  });

  it('a damaged vision grant is dropped field by field on load', () => {
    const rm = freshRun();
    rm.addBlessingMidRun('second_dawn', { earned: true });
    const json = JSON.parse(JSON.stringify(rm.toJSON()));
    json.blessingRuntimeModifiers.actStartGrants.push(
      { blessingId: 'second_dawn', kind: 'vision', value: -1, paidActs: [] },
      { blessingId: 'second_dawn', kind: 'vision', value: 'x', paidActs: [] },
    );
    const back = RunManager.fromJSON(json, data);
    expect(back.blessingRuntimeModifiers.actStartGrants).toHaveLength(1);
  });

  it('nothing without it, and nothing past the last act', () => {
    const rm = freshRun();
    const before = rm.visionChargesRemaining;
    expect(rm.advanceAct().actStartGrants).toEqual([]);
    expect(rm.visionChargesRemaining).toBe(before);
    expect(rm.takeActStartNotice()).toEqual([]);

    const held = freshRun();
    held.addBlessingMidRun('second_dawn', { earned: true });
    held.actIndex = held.actSequence.length - 1;
    const vision = held.visionChargesRemaining;
    expect(held.advanceAct().actStartGrants).toEqual([]);
    expect(held.visionChargesRemaining).toBe(vision);
  });

  it('never in the prologue', () => {
    const rm = new RunManager(data);
    rm.startPrologue(data, data.prologue);
    rm.blessingRuntimeModifiers.actStartGrants.push({
      blessingId: 'second_dawn',
      kind: 'vision',
      value: 1,
      paidActs: [],
    });
    const before = rm.visionChargesRemaining;
    expect(rm._payActStartGrants('act_transition')).toEqual([]);
    expect(rm.visionChargesRemaining).toBe(before);
  });
});

describe('the held list, the card and the Compendium say Earned', () => {
  it('the pause list reads "Earned" where a tiered card reads its numeral', () => {
    const rm = freshRun();
    rm.addBlessingMidRun('unbroken_banner', { earned: true });
    rm.activeBlessings.push({ id: 'steady_hands', rolledCost: null });
    const [banner, steady] = heldBlessingEntries(rm);
    expect(banner).toMatchObject({ label: 'Unbroken Banner', tier: 'Earned', earned: true });
    expect(banner.price).toBeNull();
    expect(steady).toMatchObject({ label: 'Keen Eye', tier: 'I', earned: false });
  });

  it('the tarot card reads Earned with a star in its sun, and a tiered card is unchanged', () => {
    const earned = blessingCardContent(
      data.blessings.blessings.find((b) => b.id === 'second_dawn'),
    );
    expect(earned).toMatchObject({ earned: true, tier: 0, tierLabel: 'Earned', cost: '' });
    // No numeral and no font glyph: the Hollow Sun's face is Cinzel (var(--re-display)), whose
    // Latin subset has no star, so the card draws one (choiceCards.blessingTarotCard: a CSS shape).
    expect(earned.numeral).toBe('');
    expect(earned.mark).toBe('star');
    const tiered = blessingCardContent(data.blessings.blessings.find((b) => b.id === 'iron_oath'));
    expect(tiered).toMatchObject({
      earned: false,
      numeral: 'III',
      tierLabel: 'Tier III',
      mark: null,
    });
  });

  describe('Compendium', () => {
    const view = () => {
      const overlay = Object.create(CompendiumOverlay.prototype);
      overlay.gameData = data;
      overlay.searchQuery = '';
      return overlay;
    };
    const tabIndex = TAB_DEFS.findIndex((t) => t.key === 'blessings');
    const filteredBy = (label) => {
      const overlay = view();
      overlay.activeTabIndex = tabIndex;
      overlay.activeFilterIndex = TAB_DEFS[tabIndex].filters.indexOf(label);
      return overlay._getFilteredItems().map((b) => b.id);
    };

    it('has an Earned filter that lists exactly the four', () => {
      expect(TAB_DEFS[tabIndex].filters).toContain('Earned');
      expect(filteredBy('Earned')).toEqual(EARNED_IDS);
    });

    it('T1 to T4 never list an earned blessing, and together hold every other one', () => {
      const tiered = ['T1', 'T2', 'T3', 'T4'].flatMap(filteredBy);
      for (const id of EARNED_IDS) expect(tiered).not.toContain(id);
      expect(tiered).toHaveLength(40);
    });

    it('All still lists everything', () => {
      expect(filteredBy('All')).toHaveLength(44);
    });

    it('a row reads "Earned" at its right edge, not "Tier ?", and the reference summary agrees', () => {
      const overlay = view();
      const texts = [];
      overlay._text = (_x, _y, text) => texts.push(String(text));
      overlay._matchesSearch = () => false;
      overlay._renderLoreLine = () => {};
      overlay._renderBlessing(
        data.blessings.blessings.find((b) => b.id === 'ember_lantern'),
        0,
        0,
        500,
      );
      expect(texts).toContain('Earned');
      expect(texts.some((t) => /Tier/.test(t))).toBe(false);
      const entries = compendiumEntries(
        view(),
        tabIndex,
        TAB_DEFS[tabIndex].filters.indexOf('Earned'),
        'blessings',
      );
      expect(entries.map((e) => e.summary)).toEqual(['Earned', 'Earned', 'Earned', 'Earned']);
    });
  });
});

describe('the earned rows and the rest of the run', () => {
  it('holding one never moves Math.random (a held blessing changes no stream)', () => {
    const spy = vi.spyOn(Math, 'random');
    const rm = freshRun();
    spy.mockClear();
    for (const id of EARNED_IDS) rm.addBlessingMidRun(id, { earned: true });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
