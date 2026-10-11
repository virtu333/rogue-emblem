// The Mercenary Ledger (docs/specs/blessings-v3.md §6.7, decision D-8): the Colosseum's earned
// blessing. The first win in a gold or platinum bout rolls its offer with that bout's save; the
// colosseum's menu opens it; held, every entry fee is halved and each visit allows one more bout.
//
// Each test names the realistic failure it catches.
import './harness/JourneyTestSetup.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The challenger is the only random part of a bout: tests choose it.
vi.mock('../src/engine/ColosseumEngine.js', async (importOriginal) => {
  const mod = await importOriginal();
  return { ...mod, generateChallenger: vi.fn(mod.generateChallenger) };
});
import { RunManager, loadRun } from '../src/engine/RunManager.js';
import { NodeMapScene } from '../src/scenes/NodeMapScene.js';
import { ColosseumOverlay } from '../src/ui/ColosseumOverlay.js';
import {
  arenaEntryFee,
  arenaVisitCap,
  calculateArenaReward,
  generateChallenger,
} from '../src/engine/ColosseumEngine.js';
import {
  COLOSSEUM_LEDGER_KEY,
  colosseumOfferDue,
  earnedPickOwed,
  prepareColosseumOffer,
  skipEarnedBlessing,
} from '../src/engine/EarnedBlessings.js';
import { createUnit } from '../src/engine/UnitManager.js';
import { installFakeDom } from './helpers/fakeDom.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const storage = new Map();
beforeEach(() => {
  // The pick's tarot card draws a little real DOM (its art); the menus are the journey's.
  installFakeDom(vi);
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  storage.clear();
  vi.stubGlobal('localStorage', {
    getItem: (k) => storage.get(k) ?? null,
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k),
  });
});

afterEach(() => vi.unstubAllGlobals());

const TIERS = data.colosseum.arena.tiers;

function runFixture({ act = 1, ledger = false } = {}) {
  const run = new RunManager(data);
  run.startRun({ runSeed: 42, difficultyId: 'normal', applyBlessingsAtStart: false });
  run.actIndex = act; // Act II: the gold tier is open
  run.gold = 10000;
  if (ledger) expect(run.addBlessingMidRun('mercenary_ledger', { earned: true })).toBe(true);
  const scene = {
    gameData: data,
    runManager: run,
    registry: { get: (key) => (key === 'activeSlot' ? 1 : null) },
    events: { once: vi.fn(), off: vi.fn() },
    checkActComplete: vi.fn(),
    drawMap: vi.fn(),
    persistRunSave() {
      return NodeMapScene.prototype.persistRunSave.call(this);
    },
  };
  for (const unit of run.roster.slice(0, 2)) {
    unit.stats.STR = 999;
    unit.stats.SPD = 99;
    unit.weapon.hit = 999;
    unit.currentHP = unit.stats.HP;
  }
  return { run, scene, node: run.nodeMap.nodes[0], a: run.roster[0] };
}

function texts(scene) {
  const s = scene._journeySurface;
  return !s || s.destroyed ? [] : [s.title, ...s.root.all().map((n) => n.textContent)].map(String);
}
function buttons(scene) {
  return scene._journeySurface.root.all().filter((n) => n.tag === 'button');
}
function press(scene, match) {
  const test = typeof match === 'string' ? (t) => t === match : match;
  const node = buttons(scene).find((n) => test(String(n.textContent)));
  if (!node || node.disabled) throw new Error(`No enabled button ${match} in ${texts(scene)[0]}`);
  node.onclick();
}
const startsWith = (prefix) => (t) => t.startsWith(prefix);

function challenger(hp) {
  const foe = createUnit(
    data.classes.find((c) => c.name === 'Fighter'),
    1,
    data.weapons,
  );
  foe.currentHP = hp;
  if (hp > 1) {
    // Never falls, always lands: the fighter loses.
    foe.stats.HP = foe.currentHP = 99999;
    foe.stats.DEF = 99999;
    foe.stats.RES = 99999;
    foe.stats.STR = 999;
    foe.stats.SPD = 999;
    foe.weapon.hit = 999;
  }
  return { unit: foe };
}

function open(scene, run, node, { win = true } = {}) {
  generateChallenger.mockImplementation(() => challenger(win ? 1 : 99999));
  const overlay = new ColosseumOverlay(scene, run, data);
  overlay.show(node, vi.fn());
  return overlay;
}

/** One bout through the real screens; stops on the rewards screen. */
function boutToRewards(scene, unit, tier) {
  press(scene, 'Arena');
  press(scene, startsWith(`${unit.name} ·`));
  press(scene, startsWith(tier));
  press(scene, 'Fight');
  while (texts(scene)[0].startsWith('Arena · Round')) press(scene, 'Next round');
  expect(texts(scene)[0]).toBe('Arena · Combat result');
  press(scene, 'Continue');
  expect(texts(scene)[0]).toBe('Arena · Rewards');
}

describe('the fee and the visit, held', () => {
  it('halves every tier’s fee; without the Ledger (or a run) the tier’s own', () => {
    const { run } = runFixture({ ledger: true });
    for (const tier of Object.values(TIERS))
      expect(arenaEntryFee(tier, run)).toBe(Math.round(tier.entryFee / 2));
    const plain = runFixture().run;
    for (const tier of Object.values(TIERS)) {
      expect(arenaEntryFee(tier, plain)).toBe(tier.entryFee);
      expect(arenaEntryFee(tier)).toBe(tier.entryFee);
    }
    expect(arenaVisitCap(5, run)).toBe(6);
    expect(arenaVisitCap(5, plain)).toBe(5);
  });

  it('the tier list and the forecast name the halved fee, and the payment takes it', () => {
    // Failure: the screens say 200 while 100 is taken (or the reverse).
    const { run, scene, node, a } = runFixture({ ledger: true });
    open(scene, run, node);
    press(scene, 'Arena');
    press(scene, startsWith(`${a.name} ·`));
    expect(texts(scene)).toContain('Mercenary Ledger: entry fees are halved.');
    expect(texts(scene).some((t) => t.startsWith('Gold · ') && t.includes('Loss −100 G'))).toBe(
      true,
    );
    press(scene, startsWith('Gold'));
    expect(texts(scene).some((t) => t.includes('Entry 100 G, paid now.'))).toBe(true);
    const before = run.gold;
    press(scene, 'Fight');
    // Won at once: the prize and the fee PAID come back, never the full fee.
    expect(run.gold).toBe(before - 100 + 100 + TIERS.gold.goldReward);
  });

  it('a tier the purse cannot pay says the halved fee it needs', () => {
    // Failure: the refusal names the tier's full fee ("Requires 200 gold.") while the Ledger
    // asks 100, so a player with 150 is told they are 50 short of a bout they can pay.
    const { run, scene, node, a } = runFixture({ ledger: true });
    run.gold = 60; // bronze 25 and silver 50 are open; gold's halved 100 is not
    open(scene, run, node);
    press(scene, 'Arena');
    press(scene, startsWith(`${a.name} ·`));
    expect(texts(scene)).toContain('Requires 100 gold.');
    expect(texts(scene)).not.toContain('Requires 200 gold.');
    expect(buttons(scene).find((b) => String(b.textContent).startsWith('Gold')).disabled).toBe(
      true,
    );
    expect(buttons(scene).find((b) => String(b.textContent).startsWith('Silver')).disabled).toBe(
      false,
    );
  });

  it('a lost bout forfeits only the fee paid', () => {
    // Failure: the loss is booked at the tier's full fee (the rewards say −200 for a −100 loss).
    const { run, scene, node, a } = runFixture({ ledger: true });
    open(scene, run, node, { win: false });
    const before = run.gold;
    boutToRewards(scene, a, 'Gold');
    expect(run.gold).toBe(before - 100);
    expect(texts(scene)).toContain('Gold -100 · XP +0');
    expect(
      calculateArenaReward(TIERS.gold, 'lose', 40, 0, data.colosseum, { entryFee: 100 }),
    ).toEqual({ goldDelta: -100, xpGained: 0 });
    expect(calculateArenaReward(TIERS.gold, 'lose', 40, 0, data.colosseum).goldDelta).toBe(-200);
  });

  it("a visit's cap gains one bout, read live (a Ledger taken mid-visit counts at once)", () => {
    // Failure: the cap is read once when the colosseum opens, so the bout the Ledger promises
    // waits for the next colosseum.
    const { run, scene, node } = runFixture();
    const overlay = open(scene, run, node);
    expect(texts(scene)).toContain('Bouts left here: 5');
    expect(run.addBlessingMidRun('mercenary_ledger', { earned: true })).toBe(true);
    expect(overlay._maxVisitBouts).toBe(6);
    overlay._showMenu();
    expect(texts(scene)).toContain('Bouts left here: 6');
  });
});

describe('the offer', () => {
  it('a gold win rolls it with the bout’s save; the menu then opens the one card', () => {
    // Failure: the offer is rolled after the save (a reload loses it), or never shown.
    const { run, scene, node, a } = runFixture();
    open(scene, run, node);
    boutToRewards(scene, a, 'Gold');
    const entry = run.earnedBlessingPicks[COLOSSEUM_LEDGER_KEY];
    expect(entry).toMatchObject({
      source: 'colosseum',
      status: 'owed',
      offered: ['mercenary_ledger'],
    });
    const saved = loadRun(data, 1);
    expect(saved.earnedBlessingPicks[COLOSSEUM_LEDGER_KEY]).toMatchObject({ status: 'owed' });
    press(scene, 'Back to colosseum');
    expect(texts(scene)[0]).toBe('An earned blessing');
  });

  it('only a gold or platinum win, once a run, never in the prologue', () => {
    // Failure: a bronze or silver win offers it (an Act I card), a loss offers it, or every gold
    // win rolls it again.
    const { run } = runFixture();
    for (const tier of ['bronze', 'silver'])
      expect(colosseumOfferDue(run, { tier, outcome: 'win' })).toBe(false);
    expect(colosseumOfferDue(run, { tier: 'gold', outcome: 'lose' })).toBe(false);
    expect(colosseumOfferDue(run, { tier: 'gold', outcome: 'draw' })).toBe(false);
    expect(colosseumOfferDue(run, { tier: 'gold', outcome: 'win' })).toBe(true);
    expect(colosseumOfferDue(run, { tier: 'platinum', outcome: 'win' })).toBe(true);
    prepareColosseumOffer(run, 'n');
    expect(colosseumOfferDue(run, { tier: 'platinum', outcome: 'win' })).toBe(false);
    const prologue = runFixture().run;
    prologue.mode = 'prologue';
    expect(colosseumOfferDue(prologue, { tier: 'gold', outcome: 'win' })).toBe(false);
  });

  it('a silver win offers nothing; a left offer is never offered again', () => {
    const { run, scene, node, a } = runFixture();
    open(scene, run, node);
    boutToRewards(scene, a, 'Silver');
    expect(run.earnedBlessingPicks[COLOSSEUM_LEDGER_KEY]).toBeUndefined();
    press(scene, 'Back to colosseum');
    expect(texts(scene)[0]).toBe('Colosseum');
    prepareColosseumOffer(run, node.id);
    expect(skipEarnedBlessing(run, COLOSSEUM_LEDGER_KEY).ok).toBe(true);
    const second = runFixture();
    second.run.earnedBlessingPicks = structuredClone(run.earnedBlessingPicks);
    open(second.scene, second.run, second.node);
    boutToRewards(second.scene, second.a, 'Gold');
    expect(second.run.earnedBlessingPicks[COLOSSEUM_LEDGER_KEY].status).toBe('skipped');
    press(second.scene, 'Back to colosseum');
    expect(texts(second.scene)[0]).toBe('Colosseum');
  });

  it('a reload offers the same card again (never rolled anew); taken, the menu comes back with its bout', () => {
    // Failure: an owed offer is lost on reload, or the take leaves the menu closed or the cap
    // unchanged.
    const { run, scene, node, a } = runFixture();
    const overlay = open(scene, run, node);
    boutToRewards(scene, a, 'Gold');
    const owed = structuredClone(run.earnedBlessingPicks[COLOSSEUM_LEDGER_KEY]);
    overlay.hide();
    const back = RunManager.fromJSON(JSON.parse(JSON.stringify(run.toJSON())), data);
    expect(back.earnedBlessingPicks[COLOSSEUM_LEDGER_KEY]).toEqual(owed);
    expect(prepareColosseumOffer(back, 'elsewhere')).toEqual(owed);
    expect(earnedPickOwed(back)).toEqual(owed);
    // The colosseum opens on the pick; taking it returns to the menu with one bout more.
    scene.runManager = back;
    const reopened = new ColosseumOverlay(scene, back, data);
    reopened.show(back.nodeMap.nodes[0], vi.fn());
    expect(texts(scene)[0]).toBe('An earned blessing');
    const pick = reopened._earnedPick;
    pick.select('mercenary_ledger');
    pick.take();
    expect(back.getActiveBlessingIds()).toContain('mercenary_ledger');
    expect(back.earnedBlessingPicks[COLOSSEUM_LEDGER_KEY].status).toBe('taken');
    expect(texts(scene)[0]).toBe('Colosseum');
    expect(texts(scene)).toContain(`Bouts left here: ${reopened._maxVisitBouts - 1}`);
    expect(reopened._maxVisitBouts).toBe(6);
  });
});
