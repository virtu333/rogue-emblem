// PR D3's twisted earned blessings at work (docs/specs/blessings-v3.md §6.2, "6.6 As built"):
// Darkened Dawn, Blood Covenant, Kingmaker's Oath and Hollow Sun's Favor. Each is an act boss's
// card only, taken with its twist (`addBlessingMidRun`'s `price`, applied after the boons); its
// effects ride one shared engine path (engine/TwistedBoons.js, engine/Burdens.js), real runs and
// real data throughout.
//
// Each test names the realistic failure it catches.
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RunManager } from '../src/engine/RunManager.js';
import {
  earnedPoolFor,
  prepareEarnedBlessingPick,
  pruneHeldOffers,
  rollActBossEarnedOffer,
  takeableOffered,
  takeEarnedBlessing,
  twistPriceOf,
} from '../src/engine/EarnedBlessings.js';
import {
  addBurden,
  burdenEffectsOnVictory,
  describeBurdens,
  expireActBurdens,
  huntedWaveFor,
  isCleansable,
  isTwistBurden,
  normalizeBurdens,
} from '../src/engine/Burdens.js';
import {
  churchCleanseBlock,
  churchOffersCleanse,
  cleanseAtChurch,
  churchVow,
} from '../src/engine/ChurchVow.js';
import {
  churchPromoteCost,
  churchPromotionBlock,
  promoteAtChurch,
} from '../src/engine/ChurchCommands.js';
import { applyRosterClassChange, rosterClassChangeBlock } from '../src/engine/RosterCommands.js';
import {
  MASTER_SEAL_BANNED,
  MASTER_SEAL_BANNED_TAG,
  armyStatBonusKey,
  classChangeItemBlock,
  classChangeItemTag,
  kingmakerBonusStats,
  scaledShadowGain,
} from '../src/engine/TwistedBoons.js';
import { rewardDrawParams, rollBattleRewardChoices } from '../src/engine/PendingBattleRewards.js';
import { blessingTerms } from '../src/engine/BlessingTerms.js';
import { arriveAtEvent, chooseEventOption } from '../src/engine/EventCommands.js';
import { heldBlessingEntries } from '../src/ui/heldBlessingsModel.js';
import { promotionPathContent } from '../src/ui/growthContent.js';
import { PromotionPathChooser } from '../src/ui/PromotionPathChooser.js';
import { rewardForWhom } from '../src/ui/choiceContent.js';
import { actLabel } from '../src/utils/actNames.js';
import { installFakeDom } from './helpers/fakeDom.js';
import { earnedPickModel } from '../src/ui/earnedBlessingPickModel.js';
import { churchPromoteHeading, churchPromoteNote } from '../src/ui/ChurchMenu.js';
import { createUnit, resolvePromotionTargets } from '../src/engine/UnitManager.js';
import { createSeededRng, validateBlessingsConfig } from '../src/engine/BlessingEngine.js';
import { validateEventsConfig } from '../src/engine/EventValidation.js';
import { XP_STAT_NAMES } from '../src/utils/constants.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const realRandom = Math.random;
afterEach(() => {
  Math.random = realRandom;
});

const TWISTED = ['darkened_dawn', 'blood_covenant', 'kingmakers_oath', 'hollow_sun_favor'];
const card = (id) => data.blessings.blessings.find((b) => b.id === id);

function freshRun({ seed = 31, difficultyId = 'dusk', eclipse = true, gameData = data } = {}) {
  const rm = new RunManager(gameData);
  rm.startRun({
    runSeed: seed,
    difficultyId,
    applyBlessingsAtStart: false,
    ...(eclipse ? {} : { eclipseEnabled: false }),
  });
  rm.blessingHistory = [];
  return rm;
}
/** Take a twisted card the way a pick does: its boons, then its twist as its held price. */
function take(rm, id) {
  expect(
    rm.addBlessingMidRun(id, { earned: true, price: twistPriceOf(card(id)), source: 'act_boss' }),
    id,
  ).toBe(true);
  return rm;
}
const roundTrip = (rm) => RunManager.fromJSON(JSON.parse(JSON.stringify(rm.toJSON())), rm.gameData);
const bossNode = (rm) => rm.nodeMap.nodes.find((n) => n.id === rm.nodeMap.bossNodeId);
const battleNodes = (rm) =>
  rm.nodeMap.nodes.filter((n) => n.type === 'battle' && !n.completed && n.battleParams);

/** Walk the act to its boss and beat it (service nodes completed as visited). */
function clearAct(rm) {
  for (let guard = 0; guard < 60 && !rm.isActComplete(); guard++) {
    const node = rm.getAvailableNodes()[0];
    if (['battle', 'boss', 'recruit'].includes(node.type))
      rm.completeBattle(rm.getRoster(), node.id, 0, { turnCount: 1, turnPar: 9 });
    else rm.markNodeComplete(node.id);
  }
  expect(rm.isActComplete()).toBe(true);
}
/** Win the next fight on the route (service nodes on the way completed as visited). */
function winNextFight(rm, options) {
  for (let guard = 0; guard < 20; guard++) {
    const node = rm.getAvailableNodes()[0];
    if (!node) break;
    if (['battle', 'recruit'].includes(node.type)) {
      expect(rm.completeBattle(rm.getRoster(), node.id, 0, options)).toBe(true);
      return node;
    }
    rm.markNodeComplete(node.id);
  }
  throw new Error('no fight left on the route');
}
function addRecruit(rm, className = 'Fighter', level = 10) {
  const unit = createUnit(
    rm.gameData.classes.find((c) => c.name === className),
    level,
    rm.gameData.weapons,
    { name: `Test ${className}`, rng: createSeededRng(className.length * 31 + level) },
  );
  unit.level = level;
  rm.assignUnitUid(unit);
  return unit;
}

// ── The cards themselves ──────────────────────────────────────────────────

describe('the four twisted cards', () => {
  it('are earned, act-boss-only cards with a twist, text in budget, names nobody else uses', () => {
    // Failure: a twisted card reaches an elite or a sanctum, ships without its twist, or its
    // name collides with an item or skill (names are identity).
    const names = new Set([
      ...data.weapons.map((w) => w.name),
      ...data.consumables.map((c) => c.name),
      ...data.accessories.map((a) => a.name),
      ...data.whetstones.map((w) => w.name),
      ...data.skills.map((s) => s.name),
    ]);
    const blessingNames = data.blessings.blessings.map((b) => b.name);
    for (const id of TWISTED) {
      const b = card(id);
      expect(b.earned, id).toBe(true);
      expect(b.sources, id).toEqual([{ kind: 'act_boss' }]);
      expect(b.twist?.effects?.length, id).toBeGreaterThan(0);
      expect(b.weight, id).toBe(0.6);
      expect(b.description.length, id).toBeLessThanOrEqual(90);
      expect(b.lore.length, id).toBeLessThanOrEqual(85);
      expect(b.lore.toLowerCase(), id).not.toBe(b.description.toLowerCase());
      expect(names.has(b.name), id).toBe(false);
      expect(
        blessingNames.filter((n) => n === b.name),
        id,
      ).toHaveLength(1);
    }
    expect(card('darkened_dawn')).toMatchObject({
      excludes: ['second_dawn'],
      requires: { eclipse: true },
    });
    expect(card('blood_covenant').requires).toEqual({ eclipse: true });
    for (const id of ['kingmakers_oath', 'hollow_sun_favor'])
      expect(card(id).requires, id).toBeUndefined();
  });

  it('never reach a sanctum, an elite or an event, however heavy', () => {
    // Failure: a twisted card is drawn by a source the player cannot see it coming from.
    const rm = freshRun();
    for (const kind of ['eclipsed_elite', 'sanctum', 'colosseum', 'event'])
      for (const b of earnedPoolFor(rm, kind)) expect(TWISTED, kind).not.toContain(b.id);
    expect(
      earnedPoolFor(rm, 'act_boss')
        .map((b) => b.id)
        .filter((id) => TWISTED.includes(id)),
    ).toEqual(TWISTED);
  });

  it('an act boss pair over 400 seeds holds one twisted card at most, and offers each', () => {
    // Failure: a pair of two curses (D-3), or a twisted card that can never be drawn.
    const rm = freshRun();
    const seen = new Set();
    for (let seed = 1; seed <= 400; seed++) {
      rm.runSeed = seed;
      const roll = rollActBossEarnedOffer(rm);
      const twisted = roll.offered.filter((id) => TWISTED.includes(id));
      expect(twisted.length, `seed ${seed}`).toBeLessThanOrEqual(1);
      for (const id of twisted) seen.add(id);
    }
    expect([...seen].sort()).toEqual([...TWISTED].sort());
  });

  it('taking one from the pick charges its twist once: held as a Twist, never again on a load', () => {
    // Failure: the pick's take forgets the twist, or a load re-applies it (+8 shadow twice).
    const rm = freshRun();
    rm.earnedBlessingPicks = {
      act1: {
        version: 2,
        source: 'act_boss',
        actId: 'act1',
        nodeId: rm.nodeMap.bossNodeId,
        offered: ['darkened_dawn', 'unbroken_banner'],
        status: 'owed',
        chosen: null,
      },
    };
    const shadow = rm.eclipse.shadow;
    expect(takeEarnedBlessing(rm, 'act1', 'darkened_dawn').ok).toBe(true);
    expect(rm.eclipse.shadow).toBe(shadow + 8);
    const loaded = roundTrip(rm);
    expect(loaded.eclipse.shadow).toBe(shadow + 8);
    expect(loaded.activeBlessings).toEqual([
      expect.objectContaining({
        id: 'darkened_dawn',
        midRun: true,
        rolledCost: expect.objectContaining({
          kind: 'twist',
          label: card('darkened_dawn').twist.label,
        }),
      }),
    ]);
    const held = heldBlessingEntries(loaded);
    expect(held[0]).toMatchObject({ priceKind: 'Twist', price: card('darkened_dawn').twist.label });
  });
});

// ── Darkened Dawn ─────────────────────────────────────────────────────────

describe('Darkened Dawn: +1 Vision now and each act; +8 shadow, the Eclipse 25% faster', () => {
  it('is never offered with the Eclipse off, nor beside Second Dawn (either way)', () => {
    // Failure: offered where its twist costs nothing, or held with the card it darkens.
    const off = freshRun({ eclipse: false });
    expect(earnedPoolFor(off, 'act_boss').map((b) => b.id)).not.toContain('darkened_dawn');
    expect(earnedPoolFor(off, 'act_boss').map((b) => b.id)).not.toContain('blood_covenant');
    const dawn = freshRun();
    expect(dawn.addBlessingMidRun('second_dawn', { earned: true })).toBe(true);
    expect(earnedPoolFor(dawn, 'act_boss').map((b) => b.id)).not.toContain('darkened_dawn');
    const dark = take(freshRun(), 'darkened_dawn');
    expect(earnedPoolFor(dark, 'eclipsed_elite').map((b) => b.id)).not.toContain('second_dawn');
  });

  it('+1 Vision on the take and +1 at each later act start, never twice for one act', () => {
    // Failure: the take pays the act-start grant too (+2 now), or a reload pays an act again.
    const rm = freshRun();
    const vision = rm.visionChargesRemaining;
    take(rm, 'darkened_dawn');
    expect(rm.visionChargesRemaining).toBe(vision + 1);
    clearAct(rm);
    const atBoss = rm.visionChargesRemaining;
    rm.advanceAct();
    expect(rm.visionChargesRemaining).toBe(atBoss + 1);
    expect(roundTrip(rm).visionChargesRemaining).toBe(atBoss + 1);
  });

  it('scales a gain by exact quarters: four victories of 1 gather 5, never 4 or 8', () => {
    // Failure: rounding per victory (25% of 1 rounds to 0, or up to 1 each time).
    let carry = 0;
    let total = 0;
    for (let i = 0; i < 4; i++) {
      const step = scaledShadowGain(1, { delta: 0.25, carry });
      total += step.gain;
      carry = step.carry;
    }
    expect(total).toBe(5);
    expect(carry).toBe(0);
    expect(scaledShadowGain(6, { delta: 0.25, carry: 0 })).toEqual({ gain: 7, carry: 2 });
    expect(scaledShadowGain(6, { delta: 0, carry: 3 })).toEqual({ gain: 6, carry: 0 });
    expect(scaledShadowGain(0, { delta: 0.25, carry: 3 })).toEqual({ gain: 0, carry: 3 });
  });

  it("the HUD's projection is the victory's commit, victory after victory", () => {
    // Failure: the projection reads the plain gain (or a stale carry) while the commit scales it.
    const rm = take(freshRun({ seed: 41 }), 'darkened_dawn');
    let checked = 0;
    for (const [turnCount, turnPar] of [
      [9, 8],
      [7, 5],
      [10, 9],
      [8, 6],
      [12, 8],
    ]) {
      const node = rm.getAvailableNodes().find((n) => n.type === 'battle');
      if (!node) break;
      const projected = rm.projectShadowGain(turnCount, turnPar);
      const before = rm.eclipse.shadow;
      rm.completeBattle(rm.getRoster(), node.id, 0, { turnCount, turnPar });
      expect(rm.eclipse.shadow - before, `${turnCount}/${turnPar}`).toBe(projected);
      checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(3);
  });

  it('keeps its carry across a save: the run gathers exactly 25% more over every victory', () => {
    // Failure: the carry is not saved (a reload between victories loses the quarters).
    // A battle whose gain is no multiple of 4, so quarters carry between victories.
    const probe = freshRun({ seed: 43 });
    const turnCount = [7, 8, 9, 10, 11, 12].find((t) => probe.projectShadowGain(t, 6) % 4 !== 0);
    expect(turnCount).toBeDefined();
    const base = probe.projectShadowGain(turnCount, 6);
    const play = (reload) => {
      let rm = take(freshRun({ seed: 43 }), 'darkened_dawn');
      const start = rm.eclipse.shadow;
      for (let i = 0; i < 4; i++) {
        winNextFight(rm, { turnCount, turnPar: 6 });
        if (reload) rm = roundTrip(rm);
      }
      return rm.eclipse.shadow - start;
    };
    // 4 victories of `base` each, 25% faster: exactly base × 5.
    expect(play(false)).toBe(base * 5);
    expect(play(true)).toBe(base * 5);
  });

  it('the carry returns to 0 when its quarters are spent, and stays exact past it (8 victories)', () => {
    // Failure: a carry spent to 0 is never written, so the stale remainder pays again at the next
    // victory (the Eclipse then gathers more than 25% faster).
    const probe = freshRun({ seed: 47 });
    const turnCount = [7, 8, 9, 10, 11, 12].find((t) => probe.projectShadowGain(t, 6) % 4 !== 0);
    const base = probe.projectShadowGain(turnCount, 6);
    expect(base % 4).not.toBe(0);
    const rm = take(freshRun({ seed: 47 }), 'darkened_dawn');
    let carry = 0;
    let crossed = 0;
    for (let i = 0; i < 8; i++) {
      // Expected by hand: a quarter of the gain, in quarter units, plus what was carried.
      const quarters = base + carry;
      const gain = base + Math.floor(quarters / 4);
      carry = quarters % 4;
      if (carry === 0) crossed++;
      for (let guard = 0; guard < 40; guard++) {
        if (rm.isActComplete()) rm.advanceAct();
        const node = rm.getAvailableNodes()[0];
        if (['battle', 'recruit'].includes(node.type)) {
          rm.completeBattle(rm.getRoster(), node.id, 0, { turnCount, turnPar: 6 });
          break;
        }
        if (node.type === 'boss') {
          rm.completeBattle(rm.getRoster(), node.id, 0, { turnCount, turnPar: 6 });
          break;
        }
        rm.markNodeComplete(node.id);
      }
      expect(rm.lastEclipseCommit.gain, `victory ${i + 1}`).toBe(gain);
      expect(rm.blessingRuntimeModifiers.eclipseGainCarry, `victory ${i + 1}`).toBe(carry);
    }
    expect(crossed).toBeGreaterThan(0);
  });

  it("an Ill Omen's shadow is not scaled; a run without it gathers what it always did", () => {
    // Failure: the multiplier reaches the burden's +1, or leaks into a run that never took it.
    const plain = freshRun({ seed: 44 });
    const dark = take(freshRun({ seed: 44 }), 'darkened_dawn');
    for (const rm of [plain, dark]) addBurden(rm, 'ill_omen', { battles: 3, extraShadow: 1 });
    const gain = plain.projectShadowGain(9, 8);
    for (const rm of [plain, dark]) {
      const node = rm.getAvailableNodes().find((n) => n.type === 'battle');
      rm.completeBattle(rm.getRoster(), node.id, 0, { turnCount: 9, turnPar: 8 });
    }
    expect(plain.lastEclipseCommit).toMatchObject({ gain: gain + 1, burdenShadow: 1 });
    expect(plain.lastEclipseCommit.blessingShadow).toBeUndefined();
    const scaled = scaledShadowGain(gain, { delta: 0.25 }).gain;
    expect(dark.lastEclipseCommit).toMatchObject({ gain: scaled + 1, burdenShadow: 1 });
  });
});

// ── Blood Covenant ────────────────────────────────────────────────────────

describe('Blood Covenant: +1 to every stat but Move for every unit; an Ill Omen that never ends', () => {
  it('reaches the roster and the fallen at the take, never Move; a living unit heals the HP', () => {
    // Failure: Move rises, the fallen are skipped (a revived ally lags), or current HP is left
    // a point under the new maximum.
    const rm = freshRun();
    const fallen = addRecruit(rm, 'Fighter', 3);
    rm.fallenUnits.push(fallen);
    fallen.currentHP = 0;
    const living = rm.roster.map((u) => ({ stats: { ...u.stats }, hp: u.currentHP }));
    const fallenStats = { ...fallen.stats };
    take(rm, 'blood_covenant');
    rm.roster.forEach((unit, i) => {
      for (const stat of XP_STAT_NAMES) expect(unit.stats[stat]).toBe(living[i].stats[stat] + 1);
      expect(unit.stats.MOV).toBe(living[i].stats.MOV);
      expect(unit.currentHP).toBe(living[i].hp + 1);
    });
    for (const stat of XP_STAT_NAMES) expect(fallen.stats[stat]).toBe(fallenStats[stat] + 1);
    expect(fallen.currentHP).toBe(0);
  });

  it('a joiner gets it once: never twice on a reload, a second grant or a revival', () => {
    // Failure: grantRecruitBlessingConsumables re-applies it to a unit that already has it.
    const rm = take(freshRun(), 'blood_covenant');
    const unit = addRecruit(rm, 'Mage', 4);
    const base = { ...unit.stats };
    expect(unit.currentHP).toBe(unit.stats.HP);
    rm.grantRecruitBlessingConsumables(unit);
    rm.roster.push(unit);
    expect(unit.recruitBlessingGrants).toContain(armyStatBonusKey('blood_covenant'));
    for (const stat of XP_STAT_NAMES) expect(unit.stats[stat]).toBe(base[stat] + 1);
    // A joiner arrives whole: its current HP rises with the +1 (never left a point short, as a
    // fallen unit's is).
    expect(unit.currentHP).toBe(unit.stats.HP);
    rm.grantRecruitBlessingConsumables(unit);
    const loaded = roundTrip(rm);
    const again = loaded.roster.find((u) => u.unitUid === unit.unitUid);
    loaded.grantRecruitBlessingConsumables(again);
    for (const stat of XP_STAT_NAMES) expect(again.stats[stat]).toBe(base[stat] + 1);
    expect(again.stats.MOV).toBe(base.MOV);
  });

  it('a revived unit has it, once (fallen before the take, revived after)', () => {
    // Failure: the fallen are left out and a revival comes back a point behind the army.
    const rm = freshRun();
    rm.gold = 99999;
    const unit = addRecruit(rm, 'Fighter', 5);
    unit.currentHP = 0;
    rm.fallenUnits.push(unit);
    const base = { ...unit.stats };
    take(rm, 'blood_covenant');
    expect(rm.reviveFallenUnit(unit, 0)).toBe(true);
    const back = rm.roster.find((u) => u.unitUid === unit.unitUid);
    // Catch-up levels may add their own; the covenant adds exactly 1, never 2.
    expect(
      back.recruitBlessingGrants.filter((k) => k === armyStatBonusKey('blood_covenant')),
    ).toHaveLength(1);
    expect(back.stats.MOV).toBe(base.MOV);
    expect(back.stats.LCK).toBeGreaterThanOrEqual(base.LCK + 1);
    // A revival with no catch-up (a lone survivor's level) shows the +1 alone.
    const solo = freshRun({ seed: 5 });
    solo.gold = 99999;
    const ghost = addRecruit(solo, 'Fighter', 1);
    ghost.currentHP = 0;
    solo.fallenUnits.push(ghost);
    const ghostBase = { ...ghost.stats };
    take(solo, 'blood_covenant');
    const before = { ...ghost.stats };
    solo.reviveFallenUnit(ghost, 0);
    for (const stat of XP_STAT_NAMES) expect(before[stat], stat).toBe(ghostBase[stat] + 1);
  });

  it('its Ill Omen never counts down: +1 shadow every victory, still there after many', () => {
    // Failure: the omen counts down like an event's and passes after two battles.
    const rm = take(freshRun(), 'blood_covenant');
    expect(rm.burdens).toEqual([{ id: 'ill_omen', battles: 0, extraShadow: 1, permanent: true }]);
    let burdens = rm.burdens;
    for (let i = 0; i < 6; i++) {
      const settled = burdenEffectsOnVictory({ ...rm, burdens }, { gold: 100 });
      expect(settled.extraShadow).toBe(1);
      expect(settled.record.illOmen.ended).toBe(false);
      burdens = settled.burdens;
    }
    expect(burdens).toEqual(rm.burdens);
    // And at the real commit, across a save.
    const node = rm.getAvailableNodes().find((n) => n.type === 'battle');
    rm.completeBattle(rm.getRoster(), node.id, 0, { turnCount: 1, turnPar: 9 });
    expect(rm.lastEclipseCommit.burdenShadow).toBe(1);
    expect(roundTrip(rm).burdens).toEqual([
      { id: 'ill_omen', battles: 0, extraShadow: 1, permanent: true },
    ]);
  });
});

// ── The cleansing decision ────────────────────────────────────────────────

describe('a twist burden is never cleansable (one rule: Burdens.isCleansable)', () => {
  function atChurch(rm) {
    const node = battleNodes(rm)[0];
    node.type = 'church';
    node.battleParams = null;
    return node.id;
  }

  it("Blood Covenant's omen: no Cleanse offer, a refusal that says why, no vow spent", () => {
    // Failure: the Cleanse vow lifts the endless omen and the card's price is free.
    const rm = take(freshRun(), 'blood_covenant');
    const church = atChurch(rm);
    expect(isCleansable(rm.burdens[0])).toBe(false);
    expect(churchOffersCleanse(rm, church)).toBe(false);
    expect(churchCleanseBlock(rm, church, 'ill_omen')).toMatch(/twisted blessing's price/);
    expect(cleanseAtChurch(rm, church, 'ill_omen').ok).toBe(false);
    expect(rm.burdens).toHaveLength(1);
    expect(churchVow(rm, church)).toBeNull();
  });

  it("Hollow Sun's Hunted: no Cleanse either; an event's own Hunted stays cleansable", () => {
    // Failure: Cleanse lifts the twist's Hunted, or the rule spreads to every Hunted.
    const rm = take(freshRun(), 'hollow_sun_favor');
    const church = atChurch(rm);
    expect(isTwistBurden(rm.burdens[0])).toBe(true);
    expect(churchOffersCleanse(rm, church)).toBe(false);
    expect(cleanseAtChurch(rm, church, 'hunted').ok).toBe(false);
    const plain = freshRun();
    const other = atChurch(plain);
    addBurden(plain, 'hunted', { battles: 2 });
    expect(isCleansable(plain.burdens[0])).toBe(true);
    expect(cleanseAtChurch(plain, other, 'hunted').ok).toBe(true);
    // The described burden carries the same verdict (the church menu reads it).
    expect(describeBurdens(rm)[0]).toMatchObject({ cleansable: false });
  });

  it('only a twist may name a burden with no countdown: events and shrine prices are refused', () => {
    // Failure: data gives an event or a shrine price an endless burden, which no altar could lift.
    const copy = structuredClone(data.blessings);
    copy.priceCatalog.ill_omen.effects[0].params.permanent = true;
    expect(validateBlessingsConfig(copy).errors.join('\n')).toMatch(/twist's price only/);
    const twist = structuredClone(data.blessings);
    const row = twist.blessings.find((b) => b.id === 'hollow_sun_favor');
    row.twist.effects[0].params.actsAhead = 0;
    expect(validateBlessingsConfig(twist).errors.join('\n')).toMatch(/actsAhead/);
    row.twist.effects[0].params = { id: 'debt', owed: 10, permanent: true };
    expect(validateBlessingsConfig(twist).errors.join('\n')).toMatch(/may outlast its battles/);
    // An event's burden: found anywhere in the catalog (a plain or a dark face).
    const events = structuredClone(data.events);
    const find = (o) => {
      if (Array.isArray(o)) return o.map(find).find(Boolean);
      if (!o || typeof o !== 'object') return null;
      if (o.type === 'burden' && o.id === 'ill_omen') return o;
      return Object.values(o).map(find).find(Boolean);
    };
    const effect = find(events.events);
    expect(effect).toBeTruthy();
    expect(validateEventsConfig(events, { ...data }).errors).toEqual([]);
    effect.params = { ...(effect.params || {}), permanent: true };
    expect(validateEventsConfig(events, { ...data }).errors.join('\n')).toMatch(
      /twisted blessing's price only/,
    );
  });
});

// ── Kingmaker's Oath ──────────────────────────────────────────────────────

describe("Kingmaker's Oath: free church promotions +2 to the class's best two; no Master Seal", () => {
  const seal = (effect = 'promote', name = 'Master Seal') => ({
    name,
    type: 'Consumable',
    effect,
    uses: 1,
    ...(effect === 'reclass' ? { subEffect: 'infantry' } : {}),
  });

  it('picks the two highest canonical promotion bonuses, ties by HP STR MAG SKL SPD DEF RES LCK, never MOV', () => {
    // Failure: the bonus lands on Move, or a tie breaks by object key order.
    expect(kingmakerBonusStats({ HP: 3, STR: 2, DEF: 2, MOV: 9 }, 2)).toEqual(['HP', 'STR']);
    expect(kingmakerBonusStats({ SPD: 2, STR: 2, LCK: 2 }, 2)).toEqual(['STR', 'SPD']);
    expect(kingmakerBonusStats({ MOV: 3, RES: 1 }, 2)).toEqual(['RES']);
    expect(kingmakerBonusStats({}, 2)).toEqual([]);
  });

  it('a church promotion is free and adds +2 to those stats: gold, MOV and the rest untouched', () => {
    // Failure: the church still charges, the bonus misses or doubles, or it lands on MOV.
    const rm = take(freshRun(), 'kingmakers_oath');
    rm.gold = 0;
    const unit = addRecruit(rm, 'Fighter', 10);
    rm.roster = [unit];
    const target = resolvePromotionTargets(unit, data.classes, data.lords)[0];
    const before = { ...unit.stats };
    const hp = unit.currentHP;
    expect(churchPromoteCost(unit, rm)).toBe(0);
    expect(churchPromotionBlock(rm, unit, 'church-x', data)).toBe('');
    const result = promoteAtChurch(rm, unit, 'church-x', target, data);
    expect(result.ok).toBe(true);
    expect(rm.gold).toBe(0);
    const best = kingmakerBonusStats(target.promotionBonuses, 2);
    expect(best).toHaveLength(2);
    expect(best).not.toContain('MOV');
    for (const stat of [...XP_STAT_NAMES, 'MOV']) {
      const extra = best.includes(stat) ? 2 : 0;
      expect(unit.stats[stat], stat).toBe(
        before[stat] + (target.promotionBonuses[stat] || 0) + extra,
      );
    }
    const hpExtra = best.includes('HP') ? 2 : 0;
    expect(unit.currentHP).toBe(hp + (target.promotionBonuses.HP || 0) + hpExtra);
    expect(result.message).toContain("Kingmaker's Oath");
    // Without the oath: the full price, no bonus.
    const plain = freshRun();
    plain.gold = 5000;
    const other = addRecruit(plain, 'Fighter', 10);
    plain.roster = [other];
    const otherBefore = { ...other.stats };
    expect(churchPromoteCost(other, plain)).toBe(2000);
    expect(promoteAtChurch(plain, other, 'church-y', target, data).ok).toBe(true);
    expect(plain.gold).toBe(3000);
    for (const stat of XP_STAT_NAMES)
      expect(other.stats[stat]).toBe(otherBefore[stat] + (target.promotionBonuses[stat] || 0));
  });

  it('the church shows the promotion as free while it is held (heading, note, price)', () => {
    // Failure: the heading still reads "2000 G" over a promotion that costs nothing.
    const rm = take(freshRun(), 'kingmakers_oath');
    expect(churchPromoteHeading(rm)).toBe("Promote · Free (Kingmaker's Oath)");
    expect(churchPromoteNote(addRecruit(rm), rm)).toMatch(/^Free \(Kingmaker's Oath\): \+2/);
    expect(churchPromoteHeading(freshRun())).toMatch(/2000 G · lords 3500 G/);
  });

  it('a Master Seal is refused from the bag and from the convoy; the reclass seals still work', () => {
    // Failure: the roster sheet or the convoy's Use promotes with a seal; the reclass seal is
    // caught by the ban too.
    const rm = take(freshRun(), 'kingmakers_oath');
    const unit = addRecruit(rm, 'Fighter', 10);
    rm.roster.push(unit);
    const bagSeal = seal();
    unit.consumables = [bagSeal];
    expect(classChangeItemBlock(rm, bagSeal)).toBe(MASTER_SEAL_BANNED);
    expect(rosterClassChangeBlock(rm, unit, bagSeal, data)).toBe(MASTER_SEAL_BANNED);
    const target = resolvePromotionTargets(unit, data.classes, data.lords)[0];
    const className = unit.className;
    expect(applyRosterClassChange(rm, unit, bagSeal, target, data)).toEqual({
      ok: false,
      reason: MASTER_SEAL_BANNED,
    });
    expect(unit.className).toBe(className);
    expect(bagSeal.uses).toBe(1);
    // The convoy's copy.
    unit.consumables = [];
    expect(rm.addToConvoy(seal())).toBeTruthy();
    const convoySeal = rm.convoy.consumables.find((c) => c.effect === 'promote');
    expect(rosterClassChangeBlock(rm, unit, convoySeal, data)).toBe(MASTER_SEAL_BANNED);
    // A reclass seal is not a Master Seal.
    for (const name of ['Infantry Seal', 'Mounted Seal']) {
      const template = data.consumables.find((c) => c.name === name);
      expect(template?.effect, name).toBe('reclass');
      expect(classChangeItemBlock(rm, template)).toBe('');
      unit.consumables = [structuredClone(template)];
      expect(rosterClassChangeBlock(rm, unit, unit.consumables[0], data)).not.toBe(
        MASTER_SEAL_BANNED,
      );
    }
    // Without the oath the seal works as ever.
    const plain = freshRun();
    const free = addRecruit(plain, 'Fighter', 10);
    plain.roster.push(free);
    free.consumables = [seal()];
    expect(rosterClassChangeBlock(plain, free, free.consumables[0], data)).toBe('');
    // And across a save the ban holds.
    expect(classChangeItemBlock(roundTrip(rm), seal())).toBe(MASTER_SEAL_BANNED);
  });
});

describe("Kingmaker's Oath: what the player is shown is what the altar does", () => {
  it('across a save the oath still promotes for nothing and still bans the Master Seal', () => {
    // Failure: the save drops `kingmakerPromotion` (the church charges again after a reload)
    // while the ban survives, or the other way round.
    const loaded = roundTrip(take(freshRun(), 'kingmakers_oath'));
    loaded.gold = 0;
    const unit = addRecruit(loaded, 'Fighter', 10);
    loaded.roster = [unit];
    expect(churchPromoteCost(unit, loaded)).toBe(0);
    expect(churchPromotionBlock(loaded, unit, 'church-x', data)).toBe('');
    const target = resolvePromotionTargets(unit, data.classes, data.lords)[0];
    const before = { ...unit.stats };
    expect(promoteAtChurch(loaded, unit, 'church-x', target, data).ok).toBe(true);
    const best = kingmakerBonusStats(target.promotionBonuses, 2);
    for (const stat of best)
      expect(unit.stats[stat], stat).toBe(before[stat] + (target.promotionBonuses[stat] || 0) + 2);
    expect(
      classChangeItemBlock(
        loaded,
        data.consumables.find((c) => c.name === 'Master Seal'),
      ),
    ).toBe(MASTER_SEAL_BANNED);
  });

  it("the church's promotion preview (and its rite) equals the promotion, +2 included", () => {
    // Failure: the paths and the rite show the class's bonuses without the oath's +2, so the
    // player is shown one set of stats and gets another.
    const rm = take(freshRun(), 'kingmakers_oath');
    for (const className of ['Fighter', 'Mage', 'Archer']) {
      const unit = addRecruit(rm, className, 10);
      rm.roster = [unit];
      for (const target of resolvePromotionTargets(unit, data.classes, data.lords)) {
        const subject = structuredClone(unit);
        rm.roster = [subject];
        const preview = promotionPathContent(subject, target, data, { churchRun: rm });
        expect(promoteAtChurch(rm, subject, `church-${className}`, target, data).ok).toBe(true);
        for (const stat of [...XP_STAT_NAMES, 'MOV']) {
          const row = preview.stats.find((r) => r.stat === stat);
          expect(row ? row.after : unit.stats[stat], `${target.name} ${stat}`).toBe(
            subject.stats[stat],
          );
        }
        // Without the church's run (a Master Seal's path), no oath bonus is shown.
        const sealed = promotionPathContent(unit, target, data);
        const best = kingmakerBonusStats(target.promotionBonuses, 2);
        for (const stat of best)
          expect(sealed.stats.find((r) => r.stat === stat)?.after).toBe(
            preview.stats.find((r) => r.stat === stat).after - 2,
          );
      }
    }
  });

  it('the path chooser a church opens shows the oath in every path', () => {
    // Failure: ChurchMenu hands the chooser no run, so its path cards read the plain bonuses.
    installFakeDom(vi);
    try {
      const rm = take(freshRun(), 'kingmakers_oath');
      const unit = addRecruit(rm, 'Fighter', 10);
      const targets = resolvePromotionTargets(unit, data.classes, data.lords);
      const scene = {
        events: { once() {}, off() {} },
        textures: { exists: () => false, get: () => null },
        registry: { get: () => null },
      };
      const chooser = new PromotionPathChooser({
        scene,
        unit,
        targets,
        gameData: data,
        churchRun: rm,
      });
      for (const target of targets)
        expect(chooser.contents.get(target)).toEqual(
          promotionPathContent(unit, target, data, { churchRun: rm }),
        );
      const plain = new PromotionPathChooser({ scene, unit, targets, gameData: data });
      expect(plain.contents.get(targets[0])).not.toEqual(chooser.contents.get(targets[0]));
      chooser.destroy();
      plain.destroy();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("a Master Seal stays in shops and loot, marked: the card says it can't be used", () => {
    // Failure: the seal is filtered out of the loot draw (moving the loot stream), or offered
    // with no word that it is useless under the oath.
    const rm = take(freshRun(), 'kingmakers_oath');
    const seal = structuredClone(data.consumables.find((c) => c.name === 'Master Seal'));
    expect(classChangeItemTag(rm, seal)).toBe(MASTER_SEAL_BANNED_TAG);
    expect(MASTER_SEAL_BANNED_TAG).toBe("Can't be used: Kingmaker's Oath");
    expect(rewardForWhom({ type: 'item', item: seal }, rm)).toMatchObject({
      who: MASTER_SEAL_BANNED_TAG,
      tone: 'bad',
    });
    // Without the oath (and for a reclass seal) the card reads as ever.
    expect(rewardForWhom({ type: 'item', item: seal }, freshRun()).who).toBe('Any unit');
    const reclass = data.consumables.find((c) => c.name === 'Infantry Seal');
    expect(rewardForWhom({ type: 'item', item: reclass }, rm).who).toBe('Any unit');
    // The draw is the same with the oath held as without it, card for card.
    const plain = freshRun();
    const names = () => (c) => [c.type, c.goldAmount ?? null, c.item?.name ?? null];
    let seals = 0;
    for (const actId of ['act1', 'act3', 'act4'])
      for (let seed = 1; seed <= 60; seed++) {
        const draw = { actId, isElite: seed % 3 === 0, isBoss: seed % 5 === 0 };
        Math.random = createSeededRng(seed);
        const a = rollBattleRewardChoices(rm, rm.gameData, draw).map(names());
        Math.random = createSeededRng(seed);
        const b = rollBattleRewardChoices(plain, plain.gameData, draw).map(names());
        expect(a, `${actId} ${seed}`).toEqual(b);
        seals += a.filter((card) => card[2] === 'Master Seal').length;
      }
    // The draws compared do hold Master Seals (the comparison is not empty).
    expect(seals).toBeGreaterThan(0);
  });

  it("the run's ban is read before a special character's own refusal", () => {
    // Failure: a unit with its own refusal line (the old knight) hides the oath's reason.
    // The old knight's own refusal lines (data/dialogue.json `specialChars`).
    const withVoices = {
      ...data,
      dialogue: JSON.parse(readFileSync(new URL('../data/dialogue.json', import.meta.url))),
    };
    const rm = take(freshRun(), 'kingmakers_oath');
    const knight = addRecruit(rm, 'Fighter', 10);
    knight.specialCharId = 'old_knight';
    rm.roster.push(knight);
    const seal = structuredClone(data.consumables.find((c) => c.name === 'Master Seal'));
    knight.consumables = [seal];
    expect(rosterClassChangeBlock(rm, knight, seal, withVoices)).toBe(MASTER_SEAL_BANNED);
    // Without the oath the knight still refuses in his own words.
    const plain = freshRun();
    const other = addRecruit(plain, 'Fighter', 10);
    other.specialCharId = 'old_knight';
    plain.roster.push(other);
    other.consumables = [structuredClone(seal)];
    expect(rosterClassChangeBlock(plain, other, other.consumables[0], withVoices)).toMatch(
      /^Test Fighter: /,
    );
  });
});

// ── Hollow Sun's Favor ────────────────────────────────────────────────────

describe("Hollow Sun's Favor: +50% battle and loot gold; Hunted through the next act", () => {
  it('+50% battle gold, added to the other multipliers, and taken before a Debt garnishes', () => {
    // Failure: the boon multiplies after the garnish, or replaces Merchant Bane's share.
    const rm = take(freshRun(), 'hollow_sun_favor');
    expect(rm.getBattleGoldMultiplier()).toBe(1.5);
    rm.blessingRuntimeModifiers.battleGoldMultiplierDelta += 0.25; // another gold boon held
    expect(rm.getBattleGoldMultiplier()).toBe(1.75);
    rm.blessingRuntimeModifiers.battleGoldMultiplierDelta -= 0.25;
    addBurden(rm, 'debt', { owed: 10000 });
    const plain = freshRun();
    addBurden(plain, 'debt', { owed: 10000 });
    const win = (run) => {
      const node = run.getAvailableNodes().find((n) => n.type === 'battle');
      const gold = run.gold;
      run.completeBattle(run.getRoster(), node.id, 400, { turnCount: 1, turnPar: 9 });
      return { kept: run.gold - gold, owed: run.burdens.find((b) => b.id === 'debt').owed };
    };
    const blessed = win(rm);
    const unblessed = win(plain);
    // The garnish is a share of the larger figure: the battle's gold, half again, before it.
    const total = (r) => r.kept + (10000 - r.owed);
    expect(10000 - blessed.owed).toBeGreaterThan(10000 - unblessed.owed);
    expect(total(blessed)).toBeGreaterThanOrEqual(Math.floor(1.5 * total(unblessed)));
    expect(total(blessed)).toBeLessThanOrEqual(Math.floor(1.5 * (total(unblessed) + 1)));
    const garnish = rm.gameData.events.burdens.debt.garnish;
    expect(10000 - blessed.owed).toBe(Math.floor(total(blessed) * garnish));
  });

  it('a gold loot card is worth half again, saved in the draw, so a reroll keeps it', () => {
    // Failure: the multiplier is read from the run at the reroll (or not saved), or touches
    // a run that never took it.
    const rm = take(freshRun(), 'hollow_sun_favor');
    const draw = rewardDrawParams(rm, { nodeId: 'n', isElite: false, isBoss: false });
    expect(draw.lootGoldMultiplier).toBe(1.5);
    const plainDraw = rewardDrawParams(freshRun(), { nodeId: 'n' });
    expect('lootGoldMultiplier' in plainDraw).toBe(false);
    // A reload keeps the share (the runtime field is saved and sanitized, not reset).
    expect(
      rewardDrawParams(roundTrip(rm), { nodeId: 'n', isElite: false, isBoss: false })
        .lootGoldMultiplier,
    ).toBe(1.5);
    const gameData = rm.gameData;
    // Item uids are minted fresh on every roll: compare what the cards are.
    const roll = (d) => {
      Math.random = createSeededRng(99);
      return rollBattleRewardChoices(rm, gameData, d).map((c) => [
        c.type,
        c.goldAmount ?? null,
        c.item?.name ?? null,
      ]);
    };
    // Find a seed's gold card: compare the same draw with and without the multiplier.
    let compared = 0;
    for (let seed = 1; seed <= 60 && compared < 3; seed++) {
      Math.random = createSeededRng(seed);
      const plainChoices = rollBattleRewardChoices(rm, gameData, plainDraw);
      Math.random = createSeededRng(seed);
      const favored = rollBattleRewardChoices(rm, gameData, draw);
      expect(favored.map((c) => c.type)).toEqual(plainChoices.map((c) => c.type));
      plainChoices.forEach((choice, i) => {
        if (choice.type !== 'gold') return;
        expect(favored[i].goldAmount).toBe(Math.floor(choice.goldAmount * 1.5));
        compared++;
      });
    }
    expect(compared).toBeGreaterThan(0);
    // The saved draw survives a JSON round trip (the record's save) and pays the same.
    const saved = JSON.parse(JSON.stringify(draw));
    expect(roll(saved)).toEqual(roll(draw));
  });

  it('its Hunted runs through the next act: every battle of Act II, gone as Act III begins', () => {
    // Failure: the Hunted counts down and ends early, or never ends.
    const rm = freshRun();
    clearAct(rm);
    take(rm, 'hollow_sun_favor');
    expect(rm.burdens).toEqual([
      {
        id: 'hunted',
        battles: 0,
        wave: { turn: 3, count: [2, 2], xpMultiplier: 0.5 },
        untilAct: 'act3',
      },
    ]);
    rm.advanceAct();
    expect(rm.currentAct).toBe('act2');
    const wave = { turn: 3, count: [2, 2], xpMultiplier: 0.5 };
    let fought = 0;
    for (let guard = 0; guard < 60 && !rm.isActComplete(); guard++) {
      const node = rm.getAvailableNodes()[0];
      if (node.type === 'battle') {
        expect(rm.getBattleParams(node).huntedWave, node.id).toEqual(wave);
        fought++;
      }
      if (['battle', 'boss', 'recruit'].includes(node.type))
        rm.completeBattle(rm.getRoster(), node.id, 0, { turnCount: 1, turnPar: 9 });
      else rm.markNodeComplete(node.id);
      expect(rm.burdens.some((b) => b.id === 'hunted')).toBe(true);
    }
    expect(fought).toBeGreaterThan(2);
    expect(huntedWaveFor(rm, { isBoss: true })).toBeNull();
    // A reload in Act II keeps it; Act III begins and it is gone (the save agrees).
    expect(roundTrip(rm).burdens.map((b) => b.id)).toEqual(['hunted']);
    // A save whose act has moved on past the span (an older build's advance) loads without it.
    const later = JSON.parse(JSON.stringify(rm.toJSON()));
    later.actIndex = rm.actSequence.indexOf('act3');
    expect(RunManager.fromJSON(later, data).burdens).toEqual([]);
    rm.advanceAct();
    expect(rm.currentAct).toBe('act3');
    expect(rm.burdens).toEqual([]);
    expect(huntedWaveFor(rm)).toBeNull();
  });

  it('taken at the last act boss that offers a pick, it lasts the rest of the run', () => {
    // Failure: an act index past the sequence makes the span undefined (never hunted, or crash).
    const rm = freshRun({ difficultyId: 'lunatic' });
    rm.actIndex = rm.actSequence.indexOf('act4');
    take(rm, 'hollow_sun_favor');
    expect(rm.burdens[0]).toMatchObject({ id: 'hunted', permanent: true });
    expect(rm.burdens[0].untilAct).toBeUndefined();
    expect(isCleansable(rm.burdens[0])).toBe(false);
    rm.actIndex = rm.actSequence.length - 1;
    expect(expireActBurdens(rm.burdens, rm).burdens).toEqual(rm.burdens);
  });
});

// ── A twist's burden and a passing one: one record, two parts ─────────────

describe("a twist's burden and a passing one share a record: the twist's part and the event's", () => {
  const omenDef = data.events.burdens.ill_omen;
  const huntDef = data.events.burdens.hunted;
  /** A burden field on a rung, read from the catalog (the onRung override over the base). */
  const onRung = (def, rung, key) => def.onRung?.[rung]?.[key] ?? def[key];
  const altar = data.events.events.find((e) => e.id === 'twin_altar');
  const kneelOmen = altar.dark.choices
    .find((c) => c.id === 'kneel')
    .outcomes[0].effects.find((e) => e.type === 'burden');
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  /** A run whose route holds the Twin Altar, fallen to its dark face, at a node ready to enter. */
  function altarRun(seed = 3) {
    const rm = freshRun({ seed });
    rm.gameData = {
      ...rm.gameData,
      events: {
        ...structuredClone(data.events),
        events: [
          structuredClone(altar),
          ...structuredClone(data.events.events.filter((e) => e.fallback)),
        ],
      },
    };
    const node = rm.nodeMap.nodes.find((n) => n.type === 'battle' && !n.completed && n.row >= 3);
    node.type = 'event';
    node.battleParams = null;
    node.darkOmen = true;
    node.eclipse = { fromType: 'event', label: 'Dark Omen', seen: false, fellAtShadow: 0 };
    return { rm, node };
  }
  /** Kneel to the dark face (the event's own Ill Omen: +2 shadow a victory). */
  function kneel(rm, node) {
    expect(arriveAtEvent(rm, node.id)).toMatchObject({ eventId: 'twin_altar', dark: true });
    const result = chooseEventOption(rm, node.id, 'kneel');
    expect(result.ok, result.reason).toBe(true);
    return result;
  }
  /** Win the next fight, a boss's included (the act advances when it is done). */
  function winAny(rm) {
    for (let guard = 0; guard < 40; guard++) {
      if (rm.isActComplete()) rm.advanceAct();
      const node = rm.getAvailableNodes()[0];
      if (['battle', 'boss', 'recruit'].includes(node.type)) {
        expect(rm.completeBattle(rm.getRoster(), node.id, 0, { turnCount: 1, turnPar: 9 })).toBe(
          true,
        );
        return node;
      }
      rm.markNodeComplete(node.id);
    }
    throw new Error('no fight on the route');
  }

  it("the Twin Altar's dark face with Blood Covenant held: one record, the same in either order", () => {
    // Failure: the event's +2 is folded into the twist's record for good (the endless omen then
    // gathers +2 forever), or the order of taking them changes what the run carries.
    const battles = onRung(omenDef, 'dusk', 'battles');
    expect(kneelOmen.params.extraShadow).toBe(2);
    const expected = [
      {
        id: 'ill_omen',
        battles: 0,
        extraShadow: 1,
        permanent: true,
        event: { battles, extraShadow: kneelOmen.params.extraShadow },
      },
    ];
    // The twist first, then the altar.
    const first = altarRun();
    take(first.rm, 'blood_covenant');
    const result = kneel(first.rm, first.node);
    expect(first.rm.burdens).toEqual(expected);
    // The altar first, then the twist.
    const second = altarRun();
    kneel(second.rm, second.node);
    expect(second.rm.burdens).toEqual([{ id: 'ill_omen', battles, extraShadow: 2 }]);
    take(second.rm, 'blood_covenant');
    expect(second.rm.burdens).toEqual(expected);
    // The event's result says what now stands: an omen that never ends, +2 while the event's lasts.
    const line = result.results.find((r) => r.kind === 'burden');
    expect(line.detail).toMatch(/^never ends: \+1 shadow each victory, \+2 for 3 more battles/);
    expect(line.line).not.toMatch(/passes/);
    // The save keeps both parts.
    expect(roundTrip(first.rm).burdens).toEqual(expected);
  });

  it("6 victories: the larger shadow while the passing omen lasts, then the twist's +1 alone", () => {
    // Failure: the merged record keeps the event's +2 forever, or drops it at once.
    const battles = onRung(omenDef, 'dusk', 'battles');
    for (const order of ['twist first', 'event first']) {
      let { rm, node } = altarRun();
      if (order === 'twist first') take(rm, 'blood_covenant');
      kneel(rm, node);
      if (order === 'event first') take(rm, 'blood_covenant');
      const shadows = [];
      for (let i = 0; i < 6; i++) {
        winAny(rm);
        shadows.push(rm.lastEclipseCommit.burdenShadow);
        if (i === 1) rm = roundTrip(rm); // a reload mid-countdown keeps the event part
      }
      const expected = Array.from({ length: 6 }, (_, i) => (i < battles ? 2 : 1));
      expect(shadows, order).toEqual(expected);
      expect(rm.burdens, order).toEqual([
        { id: 'ill_omen', battles: 0, extraShadow: 1, permanent: true },
      ]);
    }
  });

  it("Cleanse lifts only the event's omen; the twist's stays, and is then refused", () => {
    // Failure: Cleanse lifts the whole record (the twist's price made free), or refuses the
    // event's part it would lift on its own.
    const { rm, node } = altarRun();
    take(rm, 'blood_covenant');
    kneel(rm, node);
    const churches = battleNodes(rm).slice(0, 2);
    for (const church of churches) {
      church.type = 'church';
      church.battleParams = null;
    }
    expect(isCleansable(rm.burdens[0])).toBe(true);
    expect(churchOffersCleanse(rm, churches[0].id)).toBe(true);
    const lifted = cleanseAtChurch(rm, churches[0].id, 'ill_omen');
    expect(lifted.ok, lifted.reason).toBe(true);
    expect(lifted.message).toMatch(/all but a twisted blessing's price/);
    expect(rm.burdens).toEqual([{ id: 'ill_omen', battles: 0, extraShadow: 1, permanent: true }]);
    // Another altar: nothing left it may lift.
    expect(churchOffersCleanse(rm, churches[1].id)).toBe(false);
    expect(cleanseAtChurch(rm, churches[1].id, 'ill_omen').ok).toBe(false);
    expect(churchCleanseBlock(rm, churches[1].id, 'ill_omen')).toBe(
      "A twisted blessing's price: no altar lifts it.",
    );
  });

  it("Hollow Sun's Hunted and an event's: one record in either order, the bigger wave while it lasts", () => {
    // Failure: the event's bigger wave rides the twist's span for the whole act, or the order of
    // taking them changes the record.
    const rung = 'lunatic';
    const twistWave = { turn: 3, count: [2, 2], xpMultiplier: 0.5 };
    const eventWave = onRung(huntDef, rung, 'wave');
    expect(eventWave.count[1]).toBeGreaterThan(twistWave.count[1]);
    const battles = onRung(huntDef, rung, 'battles');
    const expected = [
      {
        id: 'hunted',
        battles: 0,
        wave: twistWave,
        untilAct: 'act3',
        event: { battles, wave: eventWave },
      },
    ];
    const first = take(freshRun({ difficultyId: rung }), 'hollow_sun_favor');
    expect(addBurden(first, 'hunted').ok).toBe(true);
    const second = freshRun({ difficultyId: rung });
    expect(addBurden(second, 'hunted').ok).toBe(true);
    take(second, 'hollow_sun_favor');
    expect(first.burdens).toEqual(expected);
    expect(second.burdens).toEqual(expected);
    expect(roundTrip(first).burdens).toEqual(expected);
    expect(huntedWaveFor(first)).toEqual(eventWave);
  });

  it("victories on a merged Hunted count the passing hunt down, then the twist's wave alone (both orders)", () => {
    // Failure: a victory counts nothing down on a merged record (the bigger wave rides the act),
    // or spends the twist's span with the event's battles.
    const rung = 'lunatic';
    const battles = onRung(huntDef, rung, 'battles');
    const eventWave = onRung(huntDef, rung, 'wave');
    const twistWave = { turn: 3, count: [2, 2], xpMultiplier: 0.5 };
    for (const order of ['twist first', 'event first']) {
      const rm = freshRun({ seed: 43, difficultyId: rung });
      if (order === 'twist first') take(rm, 'hollow_sun_favor');
      addBurden(rm, 'hunted');
      if (order === 'event first') take(rm, 'hollow_sun_favor');
      const waves = [];
      for (let i = 0; i < battles + 2; i++) {
        // The next fight on the route (service nodes on the way completed as visited).
        let node = rm.getAvailableNodes()[0];
        while (node && !['battle', 'recruit'].includes(node.type)) {
          rm.markNodeComplete(node.id);
          node = rm.getAvailableNodes()[0];
        }
        waves.push(rm.getBattleParams(node).huntedWave);
        expect(
          rm.completeBattle(rm.getRoster(), node.id, 0, { turnCount: 1, turnPar: 9 }),
          order,
        ).toBe(true);
      }
      const expected = Array.from({ length: battles + 2 }, (_, i) =>
        i < battles ? eventWave : twistWave,
      );
      expect(waves, order).toEqual(expected);
      expect(rm.burdens, order).toEqual([
        { id: 'hunted', battles: 0, wave: twistWave, untilAct: 'act3' },
      ]);
    }
  });

  it("Cleanse lifts only the event's hunt; the twist's span stays", () => {
    // Failure: Cleanse lifts Hollow Sun's Hunted along with the event's.
    const rm = take(freshRun({ difficultyId: 'lunatic' }), 'hollow_sun_favor');
    addBurden(rm, 'hunted');
    const church = battleNodes(rm)[0];
    church.type = 'church';
    church.battleParams = null;
    expect(cleanseAtChurch(rm, church.id, 'hunted').ok).toBe(true);
    expect(rm.burdens).toEqual([
      {
        id: 'hunted',
        battles: 0,
        wave: { turn: 3, count: [2, 2], xpMultiplier: 0.5 },
        untilAct: 'act3',
      },
    ]);
    expect(isCleansable(rm.burdens[0])).toBe(false);
  });

  it('an event part outlives the span as a plain hunt; a spent part leaves the twist alone', () => {
    // Failure: the act's start ends the event's battles with the twist's span, or a load drops
    // the part (or keeps a spent one).
    const rm = freshRun();
    clearAct(rm);
    take(rm, 'hollow_sun_favor');
    rm.advanceAct();
    addBurden(rm, 'hunted', { battles: 2 });
    const wave = onRung(huntDef, 'dusk', 'wave');
    expect(rm.burdens[0]).toMatchObject({ untilAct: 'act3', event: { battles: 2, wave } });
    // Act III begins with the event's battles unspent: they stand alone, and an altar lifts them.
    const later = expireActBurdens(rm.burdens, { actSequence: rm.actSequence, actIndex: 2 });
    expect(later.burdens).toEqual([{ id: 'hunted', battles: 2, wave }]);
    expect(isCleansable(later.burdens[0])).toBe(true);
    // The sanitizer: a spent or malformed part is dropped, an old save without one is unchanged.
    const twist = { id: 'hunted', battles: 0, wave, untilAct: 'act3' };
    expect(normalizeBurdens([{ ...twist, event: { battles: 0, wave } }])).toEqual([twist]);
    expect(normalizeBurdens([{ ...twist, event: 'nonsense' }])).toEqual([twist]);
    expect(normalizeBurdens([twist])).toEqual([twist]);
    const omen = { id: 'ill_omen', battles: 0, extraShadow: 1, permanent: true };
    expect(normalizeBurdens([omen])).toEqual([omen]);
    expect(normalizeBurdens([{ ...omen, event: { battles: 2, extraShadow: 3 } }])).toEqual([
      { ...omen, event: { battles: 2, extraShadow: 3 } },
    ]);
    // A plain record never carries an event part.
    expect(normalizeBurdens([{ id: 'ill_omen', battles: 2, extraShadow: 1, event: {} }])).toEqual([
      { id: 'ill_omen', battles: 2, extraShadow: 1 },
    ]);
  });

  it('the chips, the church and the pick say both parts', () => {
    // Failure: a merged chip reads only "Never ends" (the +2 hidden), the church offers to lift
    // the whole record, or the pick hides that the twist merges with a burden already carried.
    const { rm, node } = altarRun();
    take(rm, 'blood_covenant');
    kneel(rm, node);
    addBurden(rm, 'hunted', { battles: 2 });
    take(rm, 'hollow_sun_favor');
    const battles = onRung(omenDef, 'dusk', 'battles');
    const [omen, hunt] = describeBurdens(rm);
    expect(omen.short).toBe(`Never ends; +2 for ${plural(battles, 'more battle')}`);
    expect(omen).toMatchObject({ cleansable: true, twist: true, twistShort: 'Never ends' });
    expect(omen.lift.short).toBe(`${battles} left`);
    expect(hunt.short).toBe('Until Act III; 2 more battles');
    expect(hunt.detail).toMatch(/until Act III begins: an extra wave of 2 foes on turn 3/);
    expect(hunt.lift.short).toBe('2 left');
    // The pick, with an event's omen already carried: its Ill Omen term says how they merge.
    const picker = altarRun();
    kneel(picker.rm, picker.node);
    picker.rm.earnedBlessingPicks = {
      act1: {
        version: 2,
        source: 'act_boss',
        actId: 'act1',
        nodeId: picker.rm.nodeMap.bossNodeId,
        offered: ['blood_covenant'],
        status: 'owed',
        chosen: null,
      },
    };
    const term = earnedPickModel(picker.rm).cards[0].terms.find((t) => t.term === 'Ill Omen').text;
    expect(term).toMatch(
      new RegExp(`passing Ill Omen \\(\\+2, ${battles} more battles\\): it keeps its own count`),
    );
    expect(term).toMatch(/A twisted blessing's price: no altar lifts it\./);
  });
});

// ── What the player reads ─────────────────────────────────────────────────

describe('what the pick, the pause list and the chips say', () => {
  it('the pick explains the twist\'s terms; the endless omen is never "until it passes"', () => {
    // Failure: the footer explains Vision but not the Hunted or the omen the player is taking,
    // or explains the endless omen with the rung's countdown.
    const rm = freshRun();
    rm.earnedBlessingPicks = {
      act1: {
        version: 2,
        source: 'act_boss',
        actId: 'act1',
        nodeId: rm.nodeMap.bossNodeId,
        offered: ['blood_covenant', 'hollow_sun_favor'],
        status: 'owed',
        chosen: null,
      },
    };
    const model = earnedPickModel(rm);
    const omen = model.cards.find((c) => c.id === 'blood_covenant');
    expect(omen.content.costLabel).toBe('Twist');
    const omenTerm = omen.terms.find((t) => t.term === 'Ill Omen');
    expect(omenTerm.text).toMatch(/rest of the run/);
    expect(omenTerm.text).not.toMatch(/victories,/);
    const hunted = model.cards.find((c) => c.id === 'hollow_sun_favor');
    expect(hunted.terms.find((t) => t.term === 'Hunted').text).toMatch(/through the next act/);
    // The catalog's own sentence stands for an ordinary price.
    expect(
      blessingTerms(['Ill Omen'], { burdens: data.events.burdens, difficultyId: 'dusk' })[0].text,
    ).toMatch(/3 victories/);
  });

  it('the chips name the span: an omen that never ends, a Hunt until Act III', () => {
    // Failure: a chip reads "0 left" for a burden that has no countdown.
    const rm = take(take(freshRun(), 'blood_covenant'), 'hollow_sun_favor');
    const chips = describeBurdens(rm);
    expect(chips.map((c) => c.short)).toEqual(['Never ends', 'Until Act III']);
    for (const chip of chips)
      expect(`${chip.short} ${chip.detail}`).not.toMatch(/\b0 (left|battles)/);
    expect(heldBlessingEntries(rm).map((e) => e.priceKind)).toEqual(['Twist', 'Twist']);
  });
});

describe('review: offers, the held list and the words', () => {
  const owedPick = (rm, offered) => ({
    act1: {
      version: 2,
      source: 'act_boss',
      actId: 'act1',
      nodeId: rm.nodeMap.bossNodeId,
      offered,
      status: 'owed',
      chosen: null,
    },
  });

  it('a held Darkened Dawn drops an offered Second Dawn, and the other way round', () => {
    // Failure: an offer already drawn shows a card the held one excludes (its Take is refused).
    for (const [held, shut] of [
      ['darkened_dawn', 'second_dawn'],
      ['second_dawn', 'darkened_dawn'],
    ]) {
      const rm = freshRun();
      if (held === 'darkened_dawn') take(rm, held);
      else expect(rm.addBlessingMidRun(held, { earned: true })).toBe(true);
      rm.earnedBlessingPicks = owedPick(rm, [shut, 'kingmakers_oath']);
      expect(takeableOffered(rm, rm.earnedBlessingPicks.act1), held).toEqual(['kingmakers_oath']);
      expect(earnedPickModel(rm).cards.map((c) => c.id)).toEqual(['kingmakers_oath']);
      // A load prunes the saved offer the same way.
      expect(roundTrip(rm).earnedBlessingPicks.act1.offered, held).toEqual(['kingmakers_oath']);
      pruneHeldOffers(rm);
      expect(rm.earnedBlessingPicks.act1.offered).toEqual(['kingmakers_oath']);
      // An offer left with nothing it may take asks nothing.
      rm.earnedBlessingPicks = owedPick(rm, [shut]);
      pruneHeldOffers(rm);
      expect(rm.earnedBlessingPicks.act1.status).toBe('none');
    }
  });

  it("the held list's Hunted reads the live record: once its act has begun, the hunt has ended", () => {
    // Failure: the pause list still says "It lasts through the next act" long after it ended.
    const rm = freshRun();
    clearAct(rm);
    take(rm, 'hollow_sun_favor');
    rm.advanceAct();
    const hunted = () =>
      heldBlessingEntries(rm)
        .find((e) => e.id === 'hollow_sun_favor')
        .terms.find((t) => t.term === 'Hunted').text;
    expect(hunted()).toMatch(/It lasts through the next act\./);
    clearAct(rm);
    rm.advanceAct();
    expect(rm.currentAct).toBe('act3');
    expect(hunted()).toMatch(/hunt has ended/);
    expect(hunted()).not.toMatch(/It lasts through/);
  });

  it('a span ending as the final act begins is named as the act card names it; ranges use en dashes', () => {
    // Failure: the chip reads "Until the final act" beside an act card that says "Final Act",
    // or a wave reads "1-2" where every other range reads "1–2".
    const wave = { turn: 3, count: [1, 2], xpMultiplier: 0.5 };
    const words = describeBurdens({
      burdens: [{ id: 'hunted', battles: 0, wave, untilAct: 'finalBoss' }],
      gameData: data,
    })[0];
    expect(words.short).toBe(`Until ${actLabel('finalBoss')}`);
    expect(words.detail).toMatch(/^until the Final Act begins: an extra wave of 1–2 foes/);
    expect(
      describeBurdens({ burdens: [{ id: 'hunted', battles: 0, wave, untilAct: 'act3' }] })[0].short,
    ).toBe(`Until ${actLabel('act3')}`);
    const terms = blessingTerms(['Hunted'], {
      burdens: data.events.burdens,
      effects: [{ type: 'burden', params: { id: 'hunted', actsAhead: 1, wave } }],
    });
    expect(terms[0].text).toMatch(/a wave of 1–2 foes on turn 3/);
    expect(terms[0].text).toMatch(/A twisted blessing's price: no altar lifts it\.$/);
  });

  it('the validator refuses a burden with no countdown in a v2 rolled cost and an object pact', () => {
    // Failure: an endless burden slips into a shrine price through the legacy shapes, and no
    // altar could ever lift it.
    const pooled = structuredClone(data.blessings);
    pooled.costPools['2'][0].effects.push({
      type: 'burden',
      params: { id: 'ill_omen', permanent: true },
    });
    expect(validateBlessingsConfig(pooled).errors.join('\n')).toMatch(
      /costPools\.2\[0\]\.effects\[1\]\.params\.permanent: a burden with no countdown is a twist's price only/,
    );
    const pacted = structuredClone(data.blessings);
    const tier2 = pacted.blessings.find((b) => b.tier === 2 && !b.earned);
    tier2.pact = {
      label: 'Hunted',
      effects: [{ type: 'burden', params: { id: 'hunted', actsAhead: 1 } }],
    };
    expect(validateBlessingsConfig(pacted).errors.join('\n')).toMatch(
      /pact\.effects\[0\]\.params\.actsAhead: a burden with no countdown is a twist's price only/,
    );
    expect(validateBlessingsConfig(data.blessings).errors).toEqual([]);
  });
});

// ── Saves and the sims ────────────────────────────────────────────────────

describe('old saves and the sims', () => {
  it('a save from before PR D3 loads with none of it: no carry, no ban, no loot share', () => {
    // Failure: a missing field reads as NaN (a broken shadow gain) or as a ban.
    const rm = freshRun();
    const saved = JSON.parse(JSON.stringify(rm.toJSON()));
    for (const key of [
      'eclipseGainDelta',
      'eclipseGainCarry',
      'kingmakerPromotion',
      'masterSealsForbidden',
      'lootGoldMultiplierDelta',
    ])
      delete saved.blessingRuntimeModifiers[key];
    const loaded = RunManager.fromJSON(saved, data);
    expect(loaded.blessingRuntimeModifiers).toMatchObject({
      eclipseGainDelta: 0,
      eclipseGainCarry: 0,
      kingmakerPromotion: null,
      masterSealsForbidden: false,
      lootGoldMultiplierDelta: 0,
    });
    expect(loaded.projectShadowGain(9, 8)).toBe(rm.projectShadowGain(9, 8));
    // A hand-edited carry is clamped; a share off the quarter grid rounds onto it.
    saved.blessingRuntimeModifiers.eclipseGainDelta = 0.3;
    saved.blessingRuntimeModifiers.eclipseGainCarry = 9;
    const odd = RunManager.fromJSON(saved, data);
    expect(odd.blessingRuntimeModifiers.eclipseGainDelta).toBe(0.25);
    expect(odd.blessingRuntimeModifiers.eclipseGainCarry).toBe(3);
  });

  it('the act boss pick is prepared on its own stream: Math.random never moves', () => {
    // Failure: rolling a pair with twisted cards in the pool draws from the battle stream.
    const rm = freshRun();
    clearAct(rm);
    let calls = 0;
    Math.random = () => {
      calls++;
      return 0.5;
    };
    rm.earnedBlessingPicks = {};
    prepareEarnedBlessingPick(rm, bossNode(rm));
    expect(calls).toBe(0);
  });
});
