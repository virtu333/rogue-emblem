// Gifts with a catch at the run's start (docs/specs/blessings-v3.md §7, PR D5; engine/StartGifts.js):
// the offer (from the second run on, about half the runs, its own seeded streams), the take (once,
// on the gift's own stream, recorded in `run.startGift`), each of the six gifts and its catch, the
// save, the validator and the surfaces that read a gift (the shrine's card, the pause list).
// Real runs on the shipped data; a patched copy of the catalog where a test needs a bad one.
//
// Each test names the realistic failure it catches.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RunManager } from '../src/engine/RunManager.js';
import {
  giftBlessingPool,
  giftCatchOf,
  giftFallableNodes,
  giftsConfigOf,
  isGiftEligible,
  rollStartGiftOffer,
  sanitizeStartGift,
  startGiftEntry,
} from '../src/engine/StartGifts.js';
import {
  GIFT_CATCH_EFFECT_TYPES,
  GIFT_WEAPON_TIERS,
  createSeededRng,
  validateBlessingsConfig,
} from '../src/engine/BlessingEngine.js';
import { eclipseHash, eclipseNode, nodeFallExemption } from '../src/engine/EclipseSystem.js';
import { blessingTerms } from '../src/engine/BlessingTerms.js';
import { canEquip } from '../src/engine/UnitManager.js';
import { findCommander } from '../src/engine/Commander.js';
import { heldBlessingEntries } from '../src/ui/heldBlessingsModel.js';
import { blessingCardContent, giftCardContent } from '../src/ui/choiceContent.js';
import { blessingTarotCard } from '../src/ui/choiceCards.js';
import { ITEM_ICON_MANIFEST } from '../src/ui/itemIcons.js';
import { RunSimulationDriver } from './sim/RunSimulationDriver.js';
import { installFakeDom } from './helpers/fakeDom.js';
import { installSeed, restoreMathRandom } from '../sim/lib/SeededRNG.js';
import { stripItemNameSuffix } from '../src/utils/itemNames.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  restoreMathRandom();
});

// The pinned seed -> gift mapping (First Light and Dusk, no army upgrades): the browser spec
// (tests/e2e/start-gift.spec.js) opens the shrine on seed 6 and expects the Fallen Hoard.
const PINNED = Object.freeze({
  sealed_reliquary: 3,
  pilgrims_wager: 4,
  strangers_scroll: 5,
  fallen_hoard: 6,
  armory_stash: 7,
  marked_blade: 14,
});

function startRun(
  seed,
  { runsStarted = 1, difficultyId = 'normal', gameData = data, ...rest } = {},
) {
  const rm = new RunManager(gameData);
  rm.startRun({ runSeed: seed, difficultyId, applyBlessingsAtStart: false, runsStarted, ...rest });
  return rm;
}
const roundTrip = (rm) => RunManager.fromJSON(JSON.parse(JSON.stringify(rm.toJSON())), rm.gameData);
const giftById = (id) => data.blessings.gifts.list.find((gift) => gift.id === id);
/** Seeds (1..n) whose run offers this gift. */
function seedsOffering(giftId, n = 400, options = {}) {
  const out = [];
  for (let seed = 1; seed <= n; seed++)
    if (startRun(seed, options).getStartGiftOffer()?.id === giftId) out.push(seed);
  return out;
}
/** A run of `seed` with its gift taken. */
function taken(seed, options = {}) {
  const rm = startRun(seed, options);
  const gift = rm.getStartGiftOffer();
  const result = rm.chooseStartGift(gift.id);
  expect(result.ok).toBe(true);
  return rm;
}
/** The catalog with its gifts patched (`edit` mutates the copy's blessings catalog). */
function patched(edit) {
  const copy = structuredClone(data);
  edit(copy.blessings);
  return copy;
}
/** Everything a gift could touch, as plain data. */
function runState(rm) {
  return JSON.parse(
    JSON.stringify({
      roster: rm.roster,
      accessories: rm.accessories,
      scrolls: rm.scrolls,
      convoy: rm.convoy,
      burdens: rm.burdens,
      vision: rm.visionChargesRemaining,
      eclipse: rm.eclipse,
      nodeMap: rm.nodeMap,
      activeBlessings: rm.activeBlessings,
      modifiers: rm.blessingRuntimeModifiers,
      gold: rm.gold,
    }),
  );
}

describe('the offer', () => {
  it("is never made on the save's first run, in the prologue or to a sim", async () => {
    // Failure: a first-time player (or the prologue) sees a gift with a catch before the shrine's
    // own cards are learnt; or the sims take one and sim:fullrun moves.
    for (let seed = 1; seed <= 200; seed++)
      expect(startRun(seed, { runsStarted: 0 }).getStartGiftOffer()).toBeNull();
    const prologue = new RunManager(data);
    prologue.startPrologue(data);
    expect(prologue.getStartGiftOffer()).toBeNull();
    expect(rollStartGiftOffer(prologue, { runsStarted: 5 })).toBeNull();
    // The sims' driver starts its runs with no count: never a gift.
    const driver = new RunSimulationDriver(data, { runOptions: { runSeed: PINNED.fallen_hoard } });
    driver.init();
    expect(driver.runManager.getStartGiftOffer()).toBeNull();
    expect(driver.runManager.startGift).toBeNull();
  });

  it('is made on about half the later runs, exactly when its own draw says so', () => {
    // Failure: the rate drifts from the owner's ~50% (a wrong comparison, a draw on another
    // stream, an eligibility check that silently drops most runs).
    let offered = 0;
    const N = 1500;
    for (let seed = 1; seed <= N; seed++) {
      const draw = createSeededRng(eclipseHash(`gift-offer:${seed}`))();
      const gift = startRun(seed).getStartGiftOffer();
      expect(Boolean(gift), `seed ${seed}`).toBe(draw < 0.5);
      if (gift) offered++;
    }
    expect(offered / N).toBeGreaterThan(0.46);
    expect(offered / N).toBeLessThan(0.54);
  });

  it('is the same for the same seed, so backing out of the shrine cannot reroll it', () => {
    // Failure: the gift is drawn on Math.random or Date.now, so returning to the shrine (which
    // rebuilds the run from its kept seed) shows another gift.
    for (const seed of [3, 6, 14, 101, 977]) {
      const a = startRun(seed);
      const b = startRun(seed);
      expect(b.getStartGiftOffer()?.id ?? null).toBe(a.getStartGiftOffer()?.id ?? null);
    }
  });

  it('keeps the pinned seed -> gift mapping the browser spec reads', () => {
    // Failure: a data or stream change silently re-maps the e2e's seed, which then tests nothing.
    for (const [giftId, seed] of Object.entries(PINNED)) {
      expect(startRun(seed).getStartGiftOffer()?.id, giftId).toBe(giftId);
      expect(startRun(seed, { difficultyId: 'dusk' }).getStartGiftOffer()?.id, giftId).toBe(giftId);
    }
  });

  it('draws every gift, by weight, and none at weight 0', () => {
    // Failure: one gift is never drawn (a sort or weight bug), or a weight-0 gift still is.
    const counts = {};
    for (let seed = 1; seed <= 600; seed++) {
      const id = startRun(seed).getStartGiftOffer()?.id;
      if (id) counts[id] = (counts[id] || 0) + 1;
    }
    for (const gift of data.blessings.gifts.list)
      expect(counts[gift.id], gift.id).toBeGreaterThan(20);
    const muted = patched((b) => {
      b.gifts.list.find((g) => g.id === 'fallen_hoard').weight = 0;
    });
    for (let seed = 1; seed <= 200; seed++)
      expect(startRun(seed, { gameData: muted }).getStartGiftOffer()?.id).not.toBe('fallen_hoard');
  });

  it("moves no other stream: the shrine's offer, the map, the roster, the battle seed", () => {
    // Failure: the offer draws on the blessing stream or Math.random, so a run offered a gift
    // shows other blessings (or another map) than the same seed offered none.
    for (let seed = 1; seed <= 60; seed++) {
      installSeed(seed * 7);
      const without = startRun(seed, { runsStarted: 0 });
      const afterWithout = Math.random();
      restoreMathRandom();
      installSeed(seed * 7);
      const withGift = startRun(seed, { runsStarted: 3 });
      const afterWith = Math.random();
      restoreMathRandom();
      expect(afterWith).toBe(afterWithout);
      const offer = (rm) => rm.getBlessingOptions().map((o) => [o.id, o.rolledCost?.label ?? null]);
      expect(offer(withGift)).toEqual(offer(without));
      expect(JSON.stringify(withGift.nodeMap)).toBe(JSON.stringify(without.nodeMap));
      // Item uids carry a process-wide counter: compare the roster without them.
      const roster = (rm) =>
        JSON.stringify(rm.roster, (key, value) => (key === 'uid' ? undefined : value));
      expect(roster(withGift)).toBe(roster(without));
      expect(withGift.rngSeed).toBe(without.rngSeed);
    }
  });
});

describe('the take', () => {
  it("never moves Math.random: the gift's draws are inside its own seeded swap", () => {
    // Failure: a grant draws on the live Math.random (an item uid, an accessory pick), so the
    // first battle after a gift plays out differently from the same seed without one.
    for (const seed of Object.values(PINNED)) {
      const rm = startRun(seed);
      installSeed(4242);
      const expected = Math.random();
      restoreMathRandom();
      installSeed(4242);
      expect(rm.chooseStartGift(rm.getStartGiftOffer().id).ok).toBe(true);
      expect(Math.random()).toBe(expected);
    }
  });

  it('grants once on a double confirm, and refuses any other card after it', () => {
    // Failure: a second tap (or a second call) grants the accessories twice or stacks the catch.
    const rm = startRun(PINNED.fallen_hoard);
    expect(rm.chooseStartGift('fallen_hoard').ok).toBe(true);
    const once = runState(rm);
    const again = rm.chooseStartGift('fallen_hoard');
    expect(again).toMatchObject({ ok: true, already: true });
    expect(runState(rm)).toEqual(once);
    expect(rm.chooseStartGift('marked_blade').ok).toBe(false);
    expect(rm.chooseBlessing(rm.getBlessingOptions()[0].id)).toBe(true); // idempotent no-op
    expect(rm.activeBlessings).toEqual([]);
    expect(runState(rm)).toEqual(once);
  });

  it('is refused when not offered, or once a blessing (or none) was chosen, even after a load', () => {
    // Failure: the gift can be taken beside a blessing, or a loaded run that took a blessing can
    // still take its offered gift.
    const rm = startRun(PINNED.marked_blade);
    expect(rm.chooseStartGift('fallen_hoard').ok).toBe(false); // offered: marked_blade
    expect(rm.chooseBlessing(null)).toBe(true);
    expect(rm.chooseStartGift('marked_blade').ok).toBe(false);
    const other = startRun(PINNED.marked_blade);
    other.chooseBlessing(other.getBlessingOptions()[0].id);
    const loaded = roundTrip(other);
    expect(loaded.chooseStartGift('marked_blade').ok).toBe(false);
    expect(loaded.startGift).toBeNull();
    expect(
      startRun(PINNED.marked_blade, { runsStarted: 0 }).chooseStartGift('marked_blade').ok,
    ).toBe(false);
  });

  it('records the selection as skipped and the gift in the history and telemetry', () => {
    // Failure: a gift run reads as a run that took a blessing (analytics, the load's "what was
    // picked at the start" read), or leaves no trace of the gift.
    const rm = taken(PINNED.armory_stash);
    const selection = rm.blessingHistory.find((r) => r.eventType === 'selection');
    expect(selection.details).toMatchObject({ chosenIds: [], skipped: true });
    const gift = rm.blessingHistory.find((r) => r.eventType === 'gift');
    expect(gift.details).toMatchObject({
      giftId: 'armory_stash',
      catch: '-2 DEF to all units in Act 1',
    });
    expect(rm.blessingSelectionTelemetry.gift).toEqual({ offeredId: 'armory_stash', chosen: true });
    expect(rm.startGift).toMatchObject({
      id: 'armory_stash',
      catchLabel: '-2 DEF to all units in Act 1',
    });
  });

  it('applies its catch once and never again on reload', () => {
    // Failure: a load re-runs the catch (a second -2 DEF, a second Vision lost, a longer Hunt),
    // or the saved gift is dropped so the pause list forgets it.
    for (const seed of Object.values(PINNED)) {
      const rm = taken(seed);
      const before = runState(rm);
      const loaded = roundTrip(roundTrip(rm));
      expect(runState(loaded)).toEqual(before);
      expect(loaded.startGift).toEqual(rm.startGift);
      loaded.applyRunStartBlessingEffects();
      expect(loaded.chooseStartGift(rm.startGift.id)).toMatchObject({ ok: true, already: true });
      expect(runState(loaded)).toEqual(before);
    }
  });
});

describe('the take is planned before anything is chosen', () => {
  /** A Marked Blade run with the commander's bag filled with Iron copies. */
  function bladeRunWithFullBag() {
    const rm = startRun(PINNED.marked_blade);
    expect(rm.getStartGiftOffer()?.id).toBe('marked_blade');
    const commander = findCommander(rm.roster);
    const iron = data.weapons.find((w) => w.tier === 'Iron' && canEquip(commander, w));
    while (commander.inventory.length < 5) commander.inventory.push(structuredClone(iron));
    return { rm, commander };
  }
  const selectionRecords = (rm) =>
    rm.blessingHistory.filter((r) => r.stage === 'run_start' && r.eventType === 'selection');

  it("Marked Blade with the commander's bag full goes to the convoy", () => {
    // Failure: the weapon is lost (granted to nobody), or the take is refused with room left.
    const { rm, commander } = bladeRunWithFullBag();
    const convoyBefore = rm.convoy.weapons.length;
    const result = rm.chooseStartGift('marked_blade');
    expect(result.ok).toBe(true);
    const [entry] = result.startGift.granted;
    expect(entry).toMatchObject({ kind: 'weapon', unit: commander.name, to: 'convoy' });
    expect(commander.inventory).toHaveLength(5);
    expect(rm.convoy.weapons).toHaveLength(convoyBefore + 1);
    expect(rm.convoy.weapons.at(-1).name).toBe(entry.name);
  });

  it('with no room anywhere it is refused before anything is chosen, and the run is untouched', () => {
    // Failure: the take chooses "no blessing" first and then finds no room: the run is left with
    // the selection made, the catch maybe paid, and nothing granted.
    const { rm } = bladeRunWithFullBag();
    const caps = rm.getConvoyCapacities();
    const iron = data.weapons.find((w) => w.tier === 'Iron' && w.type === 'Sword');
    while (rm.convoy.weapons.length < caps.weapons) rm.convoy.weapons.push(structuredClone(iron));
    const before = runState(rm);
    const result = rm.chooseStartGift('marked_blade');
    expect(result).toMatchObject({ ok: false, reason: 'unavailable' });
    expect(result.dirty).toBeUndefined();
    expect(runState(rm)).toEqual(before);
    expect(rm.startGift).toBeNull();
    expect(rm._blessingChosen).toBe(false);
    expect(selectionRecords(rm)).toEqual([]);
    // A blessing can still be chosen at this shrine.
    expect(rm.chooseBlessing(null)).toBe(true);
  });

  it('a blessing gift whose cards cannot be added is refused before anything is chosen', () => {
    // Failure: the Reliquary chooses "no blessing", then addBlessingMidRun refuses its card.
    const rm = startRun(PINNED.sealed_reliquary);
    vi.spyOn(rm, 'canAddBlessingMidRun').mockReturnValue(false);
    const before = runState(rm);
    expect(rm.chooseStartGift('sealed_reliquary')).toMatchObject({
      ok: false,
      reason: 'unavailable',
    });
    expect(runState(rm)).toEqual(before);
    expect(selectionRecords(rm)).toEqual([]);
  });

  it('a grant that still comes up empty is reported dirty and records no gift', () => {
    // Failure: an empty grant is saved as a taken gift (a pause entry for nothing, its catch
    // paid for nothing), or reported clean so the shrine keeps the half-changed run.
    const rm = startRun(PINNED.sealed_reliquary);
    vi.spyOn(rm, 'addBlessingMidRun').mockReturnValue(false);
    const result = rm.chooseStartGift('sealed_reliquary');
    expect(result).toMatchObject({ ok: false, reason: 'grant_failed', dirty: true });
    expect(rm.startGift).toBeNull();
    expect(rm.blessingHistory.some((r) => r.eventType === 'gift')).toBe(false);
  });

  it('a gift record with nothing granted has no pause entry', () => {
    // Failure: an old or hand-made save with an empty grant shows "Fallen Hoard · Gift" for
    // nothing.
    const rm = taken(PINNED.fallen_hoard);
    expect(startGiftEntry(rm)).not.toBeNull();
    rm.startGift = { ...rm.startGift, granted: [] };
    expect(startGiftEntry(rm)).toBeNull();
    expect(heldBlessingEntries(rm).some((entry) => entry.gift)).toBe(false);
  });
});

describe("a gift's history stage", () => {
  it("records its effects as stage 'gift' and restores the outer stage, even when a handler throws", () => {
    // Failure: a throwing handler leaves the run stuck in stage 'gift' (every later record,
    // a church vow's included, is filed under the gift), or a nested call loses 'mid_run'.
    const rm = startRun(PINNED.fallen_hoard);
    rm.applyStartGiftEffects('gift:test', [{ type: 'vision_delta', params: { value: -1 } }]);
    expect(rm.blessingHistory.at(-1)).toMatchObject({ stage: 'gift', blessingId: 'gift:test' });
    expect('_blessingEventStage' in rm).toBe(false);

    const spy = vi.spyOn(rm, '_applySingleRunStartBlessingEffect').mockImplementation(() => {
      throw new Error('handler broke');
    });
    expect(() =>
      rm.applyStartGiftEffects('gift:test', [{ type: 'vision_delta', params: { value: -1 } }]),
    ).toThrow('handler broke');
    expect('_blessingEventStage' in rm).toBe(false);
    rm._blessingEventStage = 'mid_run';
    expect(() =>
      rm.applyStartGiftEffects('gift:test', [{ type: 'vision_delta', params: { value: -1 } }]),
    ).toThrow('handler broke');
    expect(rm._blessingEventStage).toBe('mid_run');
    spy.mockRestore();
  });
});

describe('the six gifts', () => {
  it('Sealed Reliquary: an unheld tier III card that is neither earned nor intrinsic, its catch the price', () => {
    // Failure: the pool lets in Gambler's Toss or another intrinsic card (a free boon whose price
    // is the boon), an earned card, a weight-0 card or one already held; or the card keeps a
    // shrine price on top of the catch.
    const expected = data.blessings.blessings
      .filter((b) => b.tier === 3 && !b.earned && !b.intrinsicPrice && (b.weight ?? 1) > 0)
      .map((b) => b.id);
    expect(expected).not.toContain('gamblers_toss');
    const seen = new Set();
    for (const seed of seedsOffering('sealed_reliquary', 300)) {
      const rm = startRun(seed);
      const vision = rm.visionChargesRemaining;
      rm.chooseStartGift('sealed_reliquary');
      const [entry] = rm.activeBlessings;
      expect(expected).toContain(entry.id);
      seen.add(entry.id);
      expect(entry).toMatchObject({
        midRun: true,
        rolledCost: { label: '-1 Vision charge now', kind: 'gift' },
      });
      expect(entry.rolledCost.effects).toEqual([{ type: 'vision_delta', params: { value: -1 } }]);
      expect(rm.visionChargesRemaining).toBe(vision - 1);
      expect(rm.burdens).toEqual([]);
    }
    expect(seen.size).toBeGreaterThan(3);
    // Held cards and intrinsic ones stay out of the pool.
    const rm = startRun(PINNED.sealed_reliquary);
    rm.activeBlessings = [{ id: 'iron_oath', rolledCost: null }];
    const pool = giftBlessingPool(rm, { tier: 3 }).map((b) => b.id);
    expect(pool).not.toContain('iron_oath');
    expect(pool).not.toContain('lone_banner');
    expect(pool).not.toContain('gamblers_toss');
  });

  it('Sealed Reliquary is not offered when there is no Vision charge to lose', () => {
    // Failure: the catch costs nothing (a run with no charge), so the gift is free.
    const rm = startRun(PINNED.sealed_reliquary);
    rm.visionChargesRemaining = 0;
    expect(isGiftEligible(rm, giftById('sealed_reliquary'))).toBe(false);
  });

  it("Pilgrim's Wager: a tier IV card with its pact waived, +15 shadow and one fallable node fallen", () => {
    // Failure: the pact is charged anyway (Debt, no revives, personal skills off), the fall takes
    // the start node, the boss or another exempt node, or more than one node falls.
    const pacts = new Set(
      data.blessings.blessings.filter((b) => b.tier === 4 && (b.weight ?? 1) > 0).map((b) => b.id),
    );
    let checked = 0;
    for (const seed of seedsOffering('pilgrims_wager', 300)) {
      const rm = startRun(seed);
      const fallable = new Set(giftFallableNodes(rm).map((n) => n.id));
      const shadow = rm.eclipse.shadow;
      const actShadow = rm.eclipse.shadow - rm.eclipse.actStartShadow;
      rm.chooseStartGift('pilgrims_wager');
      const [entry] = rm.activeBlessings;
      expect(pacts.has(entry.id)).toBe(true);
      expect(entry.rolledCost.kind).toBe('gift');
      expect(rm.burdens.some((b) => b.id === 'debt')).toBe(false);
      expect(rm.blessingRuntimeModifiers.churchReviveDisabled).toBe(false);
      expect(rm.blessingRuntimeModifiers.disablePersonalSkillsUntilAct ?? null).toBeNull();
      expect(rm.blessingRuntimeModifiers.recruitLevelBonus).toBe(0);
      expect(rm.eclipse.shadow).toBe(shadow + 15);
      // The act's own clock is unmoved (the pact price's rule): only the gift's one fall.
      expect(rm.eclipse.shadow - rm.eclipse.actStartShadow).toBe(actShadow);
      const fallen = rm.nodeMap.nodes.filter((n) => n.eclipse);
      expect(fallen).toHaveLength(1);
      expect(fallable.has(fallen[0].id)).toBe(true);
      expect(fallen[0].id).not.toBe(rm.nodeMap.startNodeId);
      expect(fallen[0].id).not.toBe(rm.nodeMap.bossNodeId);
      expect(fallen[0].eclipse).toMatchObject({ seen: false, fellAtShadow: shadow + 15 });
      expect(rm.startGift.fell).toEqual([fallen[0].id]);
      checked++;
    }
    expect(checked).toBeGreaterThan(20);
    // The fall's candidates are exactly the nodes the Eclipse itself could take now.
    const rm = startRun(PINNED.pilgrims_wager);
    for (const node of rm.nodeMap.nodes) {
      const exempt = nodeFallExemption(node, { nodeMap: rm.nodeMap, currentNodeId: null });
      expect(giftFallableNodes(rm).includes(node), node.id).toBe(exempt === null);
    }
    expect(giftFallableNodes(rm).some((n) => n.id === rm.nodeMap.startNodeId)).toBe(false);
  });

  it("Pilgrim's Wager's fall is the Eclipse's own: the node is what eclipseNode makes with the run's context", () => {
    // Failure: the gift builds its own copy of the Eclipse's terms (fog, the act, the Dark
    // Omen, the shadow) and drifts from it, so a node the gift lets fall differs from the same
    // node fallen to the Eclipse.
    let checked = 0;
    for (const difficultyId of ['normal', 'hard']) {
      for (const seed of seedsOffering('pilgrims_wager', 300, { difficultyId }).slice(0, 6)) {
        const fresh = startRun(seed, { difficultyId });
        const rm = taken(seed, { difficultyId });
        expect(rm.startGift.fell).toHaveLength(1);
        const [id] = rm.startGift.fell;
        const expected = structuredClone(fresh.nodeMap.nodes.find((n) => n.id === id));
        // The catch's +15 shadow is paid before the node falls.
        fresh.eclipse.shadow = rm.eclipse.shadow;
        eclipseNode(expected, fresh._eclipseNodeContext());
        expect(rm.nodeMap.nodes.find((n) => n.id === id)).toEqual(expected);
        checked++;
      }
    }
    expect(checked).toBe(12);
  });

  it("Pilgrim's Wager is never offered with the Eclipse off", () => {
    // Failure: with the Eclipse off its whole catch costs nothing.
    for (let seed = 1; seed <= 300; seed++)
      expect(startRun(seed, { eclipseEnabled: false }).getStartGiftOffer()?.id).not.toBe(
        'pilgrims_wager',
      );
    const off = startRun(PINNED.pilgrims_wager, { eclipseEnabled: false });
    expect(isGiftEligible(off, giftById('pilgrims_wager'))).toBe(false);
  });

  it("Armory Stash: three whetstone forges on the lords' combat weapons, never a staff; -2 DEF in Act 1", () => {
    // Failure: a forge lands on a staff or a non-lord's weapon, fewer than three land, or the
    // catch misses (or doubles) the Act 1 DEF dip.
    for (const seed of seedsOffering('armory_stash', 200)) {
      const rm = startRun(seed);
      const def = rm.roster.map((u) => u.stats.DEF);
      rm.chooseStartGift('armory_stash');
      const forges = rm.startGift.granted;
      expect(forges).toHaveLength(3);
      for (const forge of forges) {
        const unit = rm.roster.find((u) => u.name === forge.unit);
        expect(unit.isLord).toBe(true);
        // The record names the weapon as that forge left it ("+1"); a later forge renames it.
        const base = stripItemNameSuffix(forge.weapon);
        const weapon = unit.inventory.find((w) => stripItemNameSuffix(w.name) === base);
        expect(weapon, forge.weapon).toBeTruthy();
        expect(['Staff', 'Consumable', 'Scroll']).not.toContain(weapon.type);
        expect(weapon._forgeLevel).toBeGreaterThan(0);
      }
      expect(rm.roster.map((u) => u.stats.DEF)).toEqual(def.map((d) => d - 2));
      // The stash itself never enters the bag or the convoy (whetstones never do).
      expect(rm.convoy.weapons.concat(rm.convoy.consumables)).toEqual([]);
    }
    // A staff a lord carries beside a blade is never forged.
    for (const seed of seedsOffering('armory_stash', 100)) {
      const run = startRun(seed);
      const healStaff = structuredClone(data.weapons.find((w) => w.name === 'Heal'));
      for (const lord of run.roster.filter((u) => u.isLord))
        lord.inventory.push(structuredClone(healStaff));
      run.chooseStartGift('armory_stash');
      for (const lord of run.roster.filter((u) => u.isLord))
        for (const item of lord.inventory.filter((w) => w.type === 'Staff'))
          expect(item._forgeLevel ?? 0, `${lord.name}'s ${item.name}`).toBe(0);
    }
    // A staff in a lord's hands is never a candidate.
    const rm = startRun(PINNED.armory_stash);
    const staff = structuredClone(data.weapons.find((w) => w.type === 'Staff' && w.price > 0));
    for (const lord of rm.roster.filter((u) => u.isLord)) {
      lord.inventory = [structuredClone(staff)];
      lord.weapon = lord.inventory[0];
    }
    expect(isGiftEligible(rm, giftById('armory_stash'))).toBe(false);
  });

  it('Fallen Hoard: two accessories from the next act; only the first may bear a skill, about half the time', () => {
    // Failure: the skill rides the shop's 3-8% (the card's "may" is never real), the second
    // accessory binds one too, or the pair comes from this act's table.
    const act2 = new Set(data.lootTables.act2.accessories);
    let skilled = 0;
    let total = 0;
    for (const seed of seedsOffering('fallen_hoard', 600)) {
      const rm = startRun(seed);
      rm.chooseStartGift('fallen_hoard');
      expect(rm.accessories).toHaveLength(2);
      for (const item of rm.accessories) expect(act2.has(item.name), item.name).toBe(true);
      expect(rm.accessories[0].name).not.toBe(rm.accessories[1].name);
      // One roll, on the first that can bear a skill (a legendary first passes it on).
      const rollsOn = rm.accessories.findIndex((item) => item.legendary !== true);
      rm.accessories.forEach((item, i) => {
        if (i !== rollsOn) expect(item._boundSkill).toBeUndefined();
      });
      if (rm.accessories[rollsOn]?._boundSkill) skilled++;
      total++;
      expect(rm.burdens).toEqual([expect.objectContaining({ id: 'hunted', battles: 3 })]);
    }
    expect(total).toBeGreaterThan(50);
    expect(skilled / total).toBeGreaterThan(0.3);
    expect(skilled / total).toBeLessThan(0.7);
  });

  it('Fallen Hoard with a legendary first pick binds the skill to the second, on the gift stream', () => {
    // Failure: the roll is spent on the legendary (which never bears one), so the card's "one may
    // bear a skill" is never true; or the second binds on Math.random and a seed's gift differs.
    const legendary = data.accessories.find((a) => a.legendary === true);
    const ordinary = data.accessories.find(
      (a) => a.type === 'Accessory' && a.legendary !== true && !a.combatEffects,
    );
    const pair = patched((b) => {
      b.gifts.list.find((g) => g.id === 'fallen_hoard').grant.skillChance = 1;
    });
    pair.lootTables = structuredClone(pair.lootTables);
    pair.lootTables.act2.accessories = [legendary.name, ordinary.name];
    let legendaryFirst = 0;
    for (let seed = 1; seed <= 600 && legendaryFirst < 5; seed++) {
      const rm = startRun(seed, { gameData: pair });
      if (rm.getStartGiftOffer()?.id !== 'fallen_hoard') continue;
      expect(rm.chooseStartGift('fallen_hoard').ok).toBe(true);
      const [first, second] = rm.accessories;
      if (first.name !== legendary.name) continue;
      legendaryFirst++;
      expect(first._boundSkill).toBeUndefined();
      expect(second.name).toBe(ordinary.name);
      expect(second._boundSkill).toBeTruthy();
      expect(rm.startGift.granted[1].skill).toBeTruthy();
      // The same seed binds the same skill (the gift's stream, not Math.random).
      const again = startRun(seed, { gameData: pair });
      again.chooseStartGift('fallen_hoard');
      expect(again.accessories[1]._boundSkill).toEqual(second._boundSkill);
    }
    expect(legendaryFirst).toBe(5);
  });

  it("Stranger's Scroll: two art scrolls the lords can use and an Act II skill scroll; the commander's injury lasts 5", () => {
    // Failure: an art scroll none of the lords can learn, the skill scroll from the wrong pool,
    // or the injury takes the rung's default length instead of the catch's five battles.
    const skillPool = new Set(data.lootTables.act2.skillScroll);
    for (const seed of seedsOffering('strangers_scroll', 300).slice(0, 20)) {
      const rm = startRun(seed);
      rm.chooseStartGift('strangers_scroll');
      const arts = rm.scrolls.filter((s) => s.teachesWeaponArtId);
      const skills = rm.scrolls.filter((s) => s.skillId);
      expect(arts).toHaveLength(2);
      expect(skills).toHaveLength(1);
      expect(skillPool.has(skills[0].name)).toBe(true);
      const artById = new Map(data.weaponArts.arts.map((a) => [a.id, a]));
      for (const scroll of arts)
        expect(rm._isScrollValidForCurrentLords(scroll, artById)).toBe(true);
      const commander = findCommander(rm.roster);
      expect(rm.burdens).toEqual([
        expect.objectContaining({ id: 'wounded', unitUid: commander.unitUid, battles: 5 }),
      ]);
    }
  });

  it("Stranger's Scroll: its arts unlock by Act II and are two different scrolls", () => {
    // Failure: a day-one gift hands out an Act III or IV art (the handler's pool unfiltered, or
    // the gift's eligibility reading another pool than the grant), or the same art twice.
    const artById = new Map(data.weaponArts.arts.map((a) => [a.id, a]));
    const early = new Set(['act1', 'act2']);
    const seeds = seedsOffering('strangers_scroll', 1500);
    expect(seeds.length).toBeGreaterThan(60);
    for (const seed of seeds) {
      const rm = startRun(seed);
      expect(rm.chooseStartGift('strangers_scroll').ok).toBe(true);
      const arts = rm.scrolls.filter((s) => s.teachesWeaponArtId);
      expect(arts, `seed ${seed}`).toHaveLength(2);
      for (const scroll of arts)
        expect(early.has(artById.get(scroll.teachesWeaponArtId)?.unlockAct || 'act1')).toBe(true);
      expect(arts[0].name, `seed ${seed}`).not.toBe(arts[1].name);
    }
    // Two arts in the pool (every other art scroll cut): always both, never one twice.
    const rm0 = startRun(PINNED.strangers_scroll);
    const pool = rm0.startingArtScrollPool('act2');
    const keep = new Set(pool.slice(0, 2).map((scroll) => scroll.name));
    const narrow = structuredClone(data);
    narrow.weapons = narrow.weapons.filter(
      (item) => !(item.type === 'Scroll' && item.teachesWeaponArtId) || keep.has(item.name),
    );
    let checked = 0;
    for (let seed = 1; seed <= 400 && checked < 12; seed++) {
      const rm = startRun(seed, { gameData: narrow });
      if (rm.getStartGiftOffer()?.id !== 'strangers_scroll') continue;
      expect(rm.chooseStartGift('strangers_scroll').ok).toBe(true);
      const names = rm.scrolls.filter((s) => s.teachesWeaponArtId).map((s) => s.name);
      expect(new Set(names)).toEqual(keep);
      checked++;
    }
    expect(checked).toBe(12);
    // The gift's own act is data, validated.
    const bad = patched((catalog) => {
      delete catalog.gifts.list.find((gift) => gift.id === 'strangers_scroll').grant.artScrollAct;
    });
    expect(validateBlessingsConfig(bad.blessings).errors).toContainEqual(
      expect.stringContaining('artScrollAct'),
    );
  });

  it("Marked Blade: a Silver weapon of the commander's best proficiency, imbued, in their bag; Sworn Enemy", () => {
    // Failure: a weapon the commander cannot wield, a staff or a lord's personal weapon, no imbue,
    // or a catch that never reaches the burden list.
    for (const seed of seedsOffering('marked_blade', 300).slice(0, 20)) {
      const rm = startRun(seed);
      const commander = findCommander(rm.roster);
      const before = commander.inventory.length;
      rm.chooseStartGift('marked_blade');
      expect(commander.inventory).toHaveLength(before + 1);
      const blade = commander.inventory.at(-1);
      expect(blade.tier).toBe('Silver');
      expect(canEquip(commander, blade)).toBe(true);
      expect(blade.signatureOf).toBeUndefined();
      expect(typeof blade._imbueId).toBe('string');
      const best =
        commander.proficiencies.find((p) => p.rank === 'Mast') || commander.proficiencies[0];
      expect(blade.type).toBe(best.type);
      expect(rm.burdens).toEqual([{ id: 'sworn_enemy' }]);
      expect(rm.startGift.granted[0]).toMatchObject({
        kind: 'weapon',
        name: blade.name,
        to: 'bag',
      });
    }
  });
});

describe('the data', () => {
  it('validates, and every gift reads well: short text, a real icon, a catch that names its term', () => {
    // Failure: a long line overflows the card, an icon cell that does not exist draws the
    // fallback, or a catch that is a burden, shadow or Vision says nothing of what it means.
    expect(validateBlessingsConfig(data.blessings)).toMatchObject({ valid: true, errors: [] });
    const config = giftsConfigOf(data);
    expect(config.offer).toEqual({ fromRunsStarted: 1, chance: 0.5 });
    expect(config.list.map((g) => g.id)).toEqual([
      'sealed_reliquary',
      'fallen_hoard',
      'strangers_scroll',
      'marked_blade',
      'pilgrims_wager',
      'armory_stash',
    ]);
    for (const gift of config.list) {
      expect(gift.description.length, gift.id).toBeLessThanOrEqual(90);
      expect(gift.lore.length, gift.id).toBeLessThanOrEqual(85);
      expect(gift.lore).not.toBe(gift.description);
      expect(ITEM_ICON_MANIFEST.icons[gift.icon], gift.icon).toBeTruthy();
      // A gift never wears another blessing's own icon (it would read as that card): only the
      // blessing it replaces.
      const owner = /^blessing-(.+)$/.exec(gift.icon)?.[1];
      if (owner) expect(owner, gift.id).toBe(gift.replaces);
      const price = giftCatchOf(gift, data);
      for (const effect of price.effects) expect(GIFT_CATCH_EFFECT_TYPES).toContain(effect.type);
      const terms = blessingTerms([price.label], { burdens: data.events.burdens }).map(
        (t) => t.term,
      );
      const named = new Set();
      for (const effect of price.effects) {
        if (effect.type === 'burden')
          named.add(
            { hunted: 'Hunted', wounded: 'Lingering Injury', sworn_enemy: 'Sworn Enemy' }[
              effect.params.id
            ],
          );
        if (effect.type === 'eclipse_shadow_delta') named.add('Shadow');
        if (effect.type === 'vision_delta') named.add('Vision');
      }
      for (const term of named) expect(terms, `${gift.id}: ${price.label}`).toContain(term);
    }
    // The injury's sentence follows the catch's five battles, not the rung's default.
    const injury = blessingTerms(['Lingering Injury on your commander for 5 battles'], {
      burdens: data.events.burdens,
    });
    expect(injury[0].text).toContain('for 5 battles');
    // A count in the next price of a pair ("·") is that price's, never the injury's: the
    // injury reads the rung's own length (First Light's 2 battles in events.json).
    const pair = blessingTerms(['Lingering Injury on your commander \u00b7 Hunted for 3 battles'], {
      burdens: data.events.burdens,
      difficultyId: 'normal',
    });
    const pairInjury = pair.find((t) => t.term === 'Lingering Injury');
    expect(pairInjury.text).toContain(
      `for ${data.events.burdens.wounded.onRung.normal.battles} battles`,
    );
    expect(pairInjury.text).not.toContain('for 3 battles');
  });

  it("refuses a gift named for a blessing it does not replace (the Armory Stash's exemption)", () => {
    // Failure: the name check is missing (two "Armory Stash" cards could meet), or it refuses the
    // one gift that replaces its cut blessing.
    const without = patched((b) => {
      delete b.gifts.list.find((g) => g.id === 'armory_stash').replaces;
    });
    const result = validateBlessingsConfig(without.blessings);
    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toMatch(/name "Armory Stash" is a blessing's name/);
    // Replacing a blessing that is still offered is refused too.
    const live = patched((b) => {
      b.blessings.find((x) => x.id === 'armory_stash').weight = 1;
    });
    expect(validateBlessingsConfig(live.blessings).errors.join('\n')).toMatch(/still offered/);
  });

  it('refuses a catch that is a Debt, a darkening catch without the Eclipse, and bad grants', () => {
    // Failure: a gift could be a loan, a free gift with the Eclipse off, or a grant the engine
    // cannot hand out (a tier IV card with its pact kept, an empty pool).
    const errorsOf = (edit) => validateBlessingsConfig(patched(edit).blessings).errors.join('\n');
    expect(
      errorsOf((b) => {
        b.gifts.list[0].catch = { label: 'Debt', prices: ['debt_small'] };
      }),
    ).toMatch(/never a loan/);
    expect(
      errorsOf((b) => {
        delete b.gifts.list.find((g) => g.id === 'pilgrims_wager').requires;
      }),
    ).toMatch(/requires\.eclipse must be true/);
    expect(
      errorsOf((b) => {
        delete b.gifts.list.find((g) => g.id === 'pilgrims_wager').grant.waivePact;
      }),
    ).toMatch(/waivePact must be true/);
    expect(
      errorsOf((b) => {
        b.gifts.list[0].catch = {
          label: 'x',
          effects: [{ type: 'gold_delta', params: { value: -1 } }],
        };
      }),
    ).toMatch(/not a catch/);
    expect(
      errorsOf((b) => {
        b.gifts.list[1].lore = b.gifts.list[1].description;
      }),
    ).toMatch(/lore must say something/);
    // A prices catch's label names the catalog prices it pays.
    expect(
      errorsOf((b) => {
        b.gifts.list.find((g) => g.id === 'armory_stash').catch.label =
          '-1 DEF to all units in Act 1';
      }),
    ).toMatch(/label does not name the price "act1_def_down_2"/);
    // A catch costs something: a positive Vision delta, less shadow or cheaper forging is a boon.
    for (const [type, value] of [
      ['vision_delta', 1],
      ['eclipse_shadow_delta', -5],
      ['act_stat_delta_all_units', 2],
      ['forge_cost_multiplier', -0.2],
      ['shop_price_discount', 0.1],
    ])
      expect(
        errorsOf((b) => {
          const gift = b.gifts.list.find((g) => g.id === 'pilgrims_wager');
          gift.catch = {
            label: 'x',
            effects: [{ type, params: { act: 'act1', stat: 'DEF', value } }],
          };
        }),
        type,
      ).toMatch(/must cost something/);
    // A weapon gift names a priced tier the catalog has.
    for (const tier of ['Gold', 'Legend', 'silver'])
      expect(
        errorsOf((b) => {
          b.gifts.list.find((g) => g.id === 'marked_blade').grant.tier = tier;
        }),
        tier,
      ).toMatch(/grant\.tier must be one of/);
    for (const tier of GIFT_WEAPON_TIERS)
      expect(
        data.weapons.some((w) => w.tier === tier && w.price > 0 && !w.signatureOf),
        tier,
      ).toBe(true);
    // Gifts read the v3 price catalog: a v2 config cannot carry them.
    expect(
      errorsOf((b) => {
        b.version = 2;
      }),
    ).toMatch(/gifts needs contract v3/);
  });
});

describe('the save and the surfaces', () => {
  it('saves startGift null by default and sanitizes a malformed one', () => {
    // Failure: an old save (or a hand-edited one) crashes the load or invents a gift.
    const rm = startRun(PINNED.fallen_hoard);
    expect(rm.toJSON().startGift).toBeNull();
    const saved = JSON.parse(JSON.stringify(rm.toJSON()));
    delete saved.startGift;
    expect(RunManager.fromJSON(saved, data).startGift).toBeNull();
    expect(sanitizeStartGift({ id: 7 })).toBeNull();
    expect(
      sanitizeStartGift({
        id: 'fallen_hoard',
        granted: [{ kind: 'accessory', name: 'Power Ring', hp: 9 }, 'junk', { name: 'x' }],
        catchLabel: 3,
        fell: ['act1_1_1', 4],
      }),
    ).toEqual({
      id: 'fallen_hoard',
      granted: [{ kind: 'accessory', name: 'Power Ring' }],
      catchLabel: '',
      fell: ['act1_1_1'],
    });
  });

  it('the pause list shows a gift and its catch once; a blessing gift is that blessing, with "Catch"', () => {
    // Failure: the list forgets a gift that gave no blessing (its catch then reads as a burden
    // from nowhere), or shows a blessing gift twice.
    const hoard = taken(PINNED.fallen_hoard);
    const [entry] = heldBlessingEntries(hoard);
    expect(entry).toMatchObject({
      label: 'Fallen Hoard',
      tier: 'Gift',
      gift: true,
      price: 'Hunted for the next 3 battles (Hunted: 3 battles left)',
      priceKind: 'Catch',
    });
    expect(entry.terms.map((t) => t.term)).toEqual(['Hunted']);
    // It says what it gave (the accessories by name, a bound skill beside its ring).
    for (const item of hoard.accessories) expect(entry.line).toContain(item.name);
    expect(entry.line.startsWith('Gave: ')).toBe(true);
    expect(heldBlessingEntries(roundTrip(hoard))).toEqual(heldBlessingEntries(hoard));
    const reliquary = taken(PINNED.sealed_reliquary);
    expect(startGiftEntry(reliquary)).toBeNull();
    const entries = heldBlessingEntries(reliquary);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ priceKind: 'Catch', price: '-1 Vision charge now' });
    expect(heldBlessingEntries(startRun(PINNED.fallen_hoard))).toEqual([]);
  });

  it("the pause entry reads the catch's live burden: battles left, then ended", () => {
    // Failure: the entry keeps saying "Hunted for the next 3 battles" after the hunt is over, or
    // reads a count of its own instead of the run's burden record.
    const hoard = taken(PINNED.fallen_hoard);
    hoard.burdens.find((b) => b.id === 'hunted').battles = 1;
    expect(startGiftEntry(hoard).catchState).toBe('Hunted: 1 battle left');
    hoard.burdens = hoard.burdens.filter((b) => b.id !== 'hunted');
    expect(startGiftEntry(hoard).catchState).toBe('Hunted: ended');
    expect(startGiftEntry(hoard).price).toBe('Hunted for the next 3 battles (Hunted: ended)');
    const blade = taken(PINNED.marked_blade);
    expect(startGiftEntry(blade).catchState).toBe('Sworn Enemy: until the act boss falls');
    expect(startGiftEntry(blade).line).toContain(blade.startGift.granted[0].name);
    // A catch that is no burden (Armory Stash's DEF) has no live state.
    const stash = taken(PINNED.armory_stash);
    expect(startGiftEntry(stash).catchState).toBeNull();
    expect(startGiftEntry(stash).price).toBe('-2 DEF to all units in Act 1');
  });

  it("the shrine's gift card is a tarot card marked 'gift', its foot a Catch and its sun the icon", () => {
    // Failure: the card reads as a tier card (a numeral, "Cost"), or draws no icon.
    installFakeDom(vi);
    vi.stubGlobal('requestAnimationFrame', () => 0);
    const content = giftCardContent(giftById('fallen_hoard'));
    expect(content).toMatchObject({ tier: 'gift', costLabel: 'Catch', tierLabel: 'Gift' });
    const card = blessingTarotCard(content, { selected: true });
    expect(card.dataset.tier).toBe('gift');
    expect(card.querySelector('.ch-numeral').textContent).toBe('');
    expect(card.querySelector('.ch-numeral').querySelector('.ia-icon').dataset.iconId).toBe(
      'generic-accessory',
    );
    expect(card.querySelector('.ch-cost').textContent).toBe('CatchHunted for the next 3 battles');
    expect(card.attributes['aria-label']).toContain('Fallen Hoard · Gift');
    // A blessing's card is unchanged.
    const tiered = blessingCardContent(data.blessings.blessings.find((b) => b.tier === 2));
    expect(
      blessingTarotCard(tiered).querySelector('.ch-numeral').querySelector('.ia-icon'),
    ).toBeNull();
  });
});
