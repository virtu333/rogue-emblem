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
  createSeededRng,
  validateBlessingsConfig,
} from '../src/engine/BlessingEngine.js';
import { eclipseHash, nodeFallExemption } from '../src/engine/EclipseSystem.js';
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
      expect(rm.accessories[1]._boundSkill).toBeUndefined();
      if (rm.accessories[0]._boundSkill) skilled++;
      total++;
      expect(rm.burdens).toEqual([expect.objectContaining({ id: 'hunted', battles: 3 })]);
    }
    expect(total).toBeGreaterThan(50);
    expect(skilled / total).toBeGreaterThan(0.3);
    expect(skilled / total).toBeLessThan(0.7);
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
      price: 'Hunted for the next 3 battles',
      priceKind: 'Catch',
    });
    expect(entry.terms.map((t) => t.term)).toEqual(['Hunted']);
    expect(heldBlessingEntries(roundTrip(hoard))).toEqual(heldBlessingEntries(hoard));
    const reliquary = taken(PINNED.sealed_reliquary);
    expect(startGiftEntry(reliquary)).toBeNull();
    const entries = heldBlessingEntries(reliquary);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ priceKind: 'Catch', price: '-1 Vision charge now' });
    expect(heldBlessingEntries(startRun(PINNED.fallen_hoard))).toEqual([]);
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
