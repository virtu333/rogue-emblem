// The shrine's gift reveal (ui/giftRevealModel.js, ui/GiftReveal.js): a start gift's contents are
// rolled at the take, so after the player confirms the gift the shrine shows what it held (the
// Sealed Reliquary's blessing as its tarot card) before the run begins. Real RunManager and real
// scene methods over the fake DOM (tests/helpers/fakeDom.js); only the scene hop, the cloud and
// the analytics are stubs.
//
// Each test names the realistic failure it catches.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));
vi.mock('../src/utils/SceneRouter.js', () => ({
  transitionToScene: vi.fn(() => Promise.resolve(true)),
  TRANSITION_REASONS: { BEGIN_RUN: 'begin_run', BACK: 'back' },
}));
vi.mock('../src/cloud/CloudSync.js', () => ({ deleteRunSave: vi.fn() }));
vi.mock('../src/utils/blessingAnalytics.js', () => ({ recordBlessingSelection: vi.fn() }));

import { BlessingSelectScene } from '../src/scenes/BlessingSelectScene.js';
import { transitionToScene } from '../src/utils/SceneRouter.js';
import { RunManager } from '../src/engine/RunManager.js';
import { giftRevealModel, GIFT_REVEAL_BEGIN } from '../src/ui/giftRevealModel.js';
import { InputAction } from '../src/utils/InputActions.js';
import { _resetInputFocus, dispatchInputAction } from '../src/utils/inputFocus.js';
import { installFakeDom } from './helpers/fakeDom.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();
// tests/StartGifts.test.js pins these seed -> gift pairs (First Light, no army upgrades).
const RELIQUARY_SEED = 3;
const WAGER_SEED = 4;
const HOARD_SEED = 6;

const store = {};
const flush = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

function events() {
  const handlers = new Map();
  const listeners = (name) => handlers.get(name) || handlers.set(name, new Set()).get(name);
  return {
    once: (name, fn) => listeners(name).add(fn),
    on: (name, fn) => listeners(name).add(fn),
    off: (name, fn) => listeners(name).delete(fn),
    emit: (name) => [...listeners(name)].forEach((fn) => fn()),
  };
}

function registry(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    get: (key) => (map.has(key) ? map.get(key) : null),
    set: (key, value) => map.set(key, value),
    remove: (key) => map.delete(key),
    has: (key) => map.has(key),
  };
}

function meta(runsStarted = 1) {
  return {
    runsStarted,
    getRunsStarted() {
      return this.runsStarted;
    },
    getActiveEffects: () => null,
    incrementRunsStarted: vi.fn(function () {
      this.runsStarted += 1;
    }),
  };
}

/** Open the shrine as the game does (init, then the offer) on a pinned seed. */
function openShrine(seed) {
  const reg = registry({ activeSlot: 1, meta: meta(1) });
  store['emblem_rogue_slot_1_pendingSeed'] = JSON.stringify({ seed, runsStarted: 1 });
  const scene = Object.create(BlessingSelectScene.prototype);
  scene.registry = reg;
  scene.events = events();
  scene.init({ gameData, difficultyId: 'normal' });
  BlessingSelectScene.prototype._rebuildRunManager.call(scene);
  scene.selectedIndex = 0;
  scene._draw = vi.fn(); // the shrine's own menu is not under test here
  return scene;
}

/** A run of `seed` with its offered gift taken. */
function taken(seed) {
  const rm = new RunManager(gameData);
  rm.startRun({
    runSeed: seed,
    difficultyId: 'normal',
    applyBlessingsAtStart: false,
    runsStarted: 1,
  });
  expect(rm.chooseStartGift(rm.getStartGiftOffer().id).ok).toBe(true);
  return rm;
}

const textOf = (node) =>
  [node.textContent || '', ...(node.children || []).map((child) => textOf(child))].join(' ');
const revealRoot = (doc) => doc.querySelector('.ch-gift-reveal');

describe('giftRevealModel', () => {
  it("names the Sealed Reliquary's rolled blessing, as a tier III card whose price is the catch", () => {
    // Failure: the reveal shows the gift's own "A random tier III blessing" text (what the player
    // already read) instead of the card it rolled, or drops the catch.
    const rm = taken(RELIQUARY_SEED);
    const granted = rm.startGift.granted.find((entry) => entry.kind === 'blessing');
    const blessing = gameData.blessings.blessings.find((b) => b.id === granted.id);
    const model = giftRevealModel(rm);
    expect(model.blessingId).toBe(blessing.id);
    expect(model.lead).toBe(`The Sealed Reliquary held ${blessing.name}.`);
    expect(model.content).toMatchObject({
      name: blessing.name,
      numeral: 'III',
      boon: blessing.description,
      costLabel: 'Catch',
      cost: '-1 Vision charge now',
    });
  });

  it("shows the Pilgrim's Wager's card without the pact it waived", () => {
    // Failure: the revealed tier IV card reads "Pact" with its waived pact, as if it were charged.
    const rm = taken(WAGER_SEED);
    expect(rm.startGift.id).toBe('pilgrims_wager');
    const model = giftRevealModel(rm);
    expect(model.content.numeral).toBe('IV');
    expect(model.content.pact).toBe(false);
    expect(model.content.costLabel).toBe('Catch');
    expect(model.content.cost).toBe(
      gameData.blessings.gifts.list.find((g) => g.id === 'pilgrims_wager').catch.label,
    );
  });

  it('shows what any other gift handed out', () => {
    // Failure: a gift that rolls items (the Hoard's two accessories) reveals nothing of them.
    const rm = taken(HOARD_SEED);
    const model = giftRevealModel(rm);
    expect(model.blessingId).toBeNull();
    for (const item of rm.accessories) expect(model.lead).toContain(item.name);
    expect(model.content.costLabel).toBe('Catch');
  });

  it('is null when no gift was taken', () => {
    const rm = new RunManager(gameData);
    rm.startRun({ runSeed: RELIQUARY_SEED, difficultyId: 'normal', applyBlessingsAtStart: false });
    expect(giftRevealModel(rm)).toBeNull();
  });
});

describe("the shrine's reveal", () => {
  let dom;
  beforeEach(() => {
    for (const key of Object.keys(store)) delete store[key];
    dom = installFakeDom(vi);
    vi.stubGlobal('localStorage', {
      getItem: (key) => store[key] ?? null,
      setItem: (key, value) => {
        store[key] = String(value);
      },
      removeItem: (key) => {
        delete store[key];
      },
    });
    vi.stubGlobal('requestAnimationFrame', () => 0);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    vi.mocked(transitionToScene).mockClear();
    vi.mocked(transitionToScene).mockImplementation(() => Promise.resolve(true));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    _resetInputFocus();
  });

  it('confirming the Sealed Reliquary shows its blessing first, and the run begins on Begin', async () => {
    // Failure: the run begins at once (the blessing seen only in a menu later, the bug reported),
    // or a second confirm behind the reveal begins it before the player has read the card.
    const scene = openShrine(RELIQUARY_SEED);
    expect(scene.gift?.id).toBe('sealed_reliquary');
    scene.selectedIndex = scene.options.length;
    scene._confirm();
    await flush();
    const root = revealRoot(dom.doc);
    expect(root).toBeTruthy();
    const granted = scene.runManager.startGift.granted.find((entry) => entry.kind === 'blessing');
    const blessing = gameData.blessings.blessings.find((b) => b.id === granted.id);
    const card = root.querySelector('.ch-tarot');
    expect(card.dataset.blessing).toBe(blessing.id);
    expect(textOf(root)).toContain(blessing.name);
    expect(textOf(root)).toContain('-1 Vision charge now');
    expect(transitionToScene).not.toHaveBeenCalled();
    scene._confirm();
    scene._onInputAction(InputAction.CONFIRM);
    await flush();
    expect(transitionToScene).not.toHaveBeenCalled();
    const begin = [...root.querySelectorAll('button')].find(
      (b) => b.textContent === GIFT_REVEAL_BEGIN,
    );
    begin.click();
    await flush();
    expect(revealRoot(dom.doc)).toBeFalsy();
    expect(transitionToScene).toHaveBeenCalledTimes(1);
    expect(scene.registry.get('meta').incrementRunsStarted).toHaveBeenCalledTimes(1);
  });

  it('Cancel on the reveal begins the run too: the gift is already taken', async () => {
    // Failure: Cancel or Escape closes the reveal and leaves the shrine locked (committed and
    // transitioning), so the player is stranded with no way forward.
    const scene = openShrine(RELIQUARY_SEED);
    scene.selectedIndex = scene.options.length;
    scene._confirm();
    await flush();
    expect(revealRoot(dom.doc)).toBeTruthy();
    dispatchInputAction(InputAction.CANCEL);
    await flush();
    expect(revealRoot(dom.doc)).toBeFalsy();
    expect(transitionToScene).toHaveBeenCalledTimes(1);
  });

  it('a blessing chosen at the shrine begins the run with no reveal', async () => {
    // Failure: every pick waits behind a reveal, not only a gift's.
    const scene = openShrine(RELIQUARY_SEED);
    scene.selectedIndex = 0;
    scene._confirm();
    await flush();
    expect(revealRoot(dom.doc)).toBeFalsy();
    expect(transitionToScene).toHaveBeenCalledTimes(1);
  });
});
