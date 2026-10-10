// The shrine's fourth card (docs/specs/blessings-v3.md §7, PR D5): BlessingSelectScene offers the
// run's gift after its blessings and before No blessing, takes it in place of a blessing, keeps it
// through a back-out (the pending seed per slot) and rolls a failed start back to a fresh run.
// The real scene methods and RunManager; only the scene hop, the cloud and the analytics are stubs.
//
// Each test names the realistic failure it catches.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));
vi.mock('../src/utils/SceneRouter.js', () => ({
  transitionToScene: vi.fn(() => Promise.resolve(true)),
  TRANSITION_REASONS: { BEGIN_RUN: 'begin_run', BACK: 'back' },
}));
vi.mock('../src/cloud/CloudSync.js', () => ({ deleteRunSave: vi.fn() }));
vi.mock('../src/utils/blessingAnalytics.js', () => ({ recordBlessingSelection: vi.fn() }));

const store = {};
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (key) => store[key] ?? null,
    setItem: (key, value) => {
      store[key] = String(value);
    },
    removeItem: (key) => {
      delete store[key];
    },
  },
  writable: true,
});

import { BlessingSelectScene } from '../src/scenes/BlessingSelectScene.js';
import { transitionToScene } from '../src/utils/SceneRouter.js';
import { recordBlessingSelection } from '../src/utils/blessingAnalytics.js';
import { InputAction } from '../src/utils/InputActions.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();
// tests/StartGifts.test.js pins these: seed 6 offers the Fallen Hoard, seed 3 the Sealed
// Reliquary, seed 1 no gift.
const HOARD_SEED = 6;
const NO_GIFT_SEED = 1;
const RELIQUARY_SEED = 3;

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

function registry(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    get: (key) => (map.has(key) ? map.get(key) : null),
    set: (key, value) => map.set(key, value),
    remove: (key) => map.delete(key),
    has: (key) => map.has(key),
  };
}

/** Open the shrine as the game does (init, then the offer) on a pinned seed. */
function openShrine(reg, seed) {
  if (seed !== undefined)
    store[`emblem_rogue_slot_${reg.get('activeSlot')}_pendingSeed`] = JSON.stringify({
      seed,
      runsStarted: reg.get('meta')?.getRunsStarted?.() ?? 0,
    });
  const scene = Object.create(BlessingSelectScene.prototype);
  scene.registry = reg;
  scene.init({ gameData, difficultyId: 'normal' });
  BlessingSelectScene.prototype._rebuildRunManager.call(scene);
  scene.selectedIndex = 0;
  scene._draw = vi.fn(); // no renderer in a unit test: the DOM menu has its own browser spec
  return scene;
}
const flush = async () => {
  for (let i = 0; i < 4; i++) await Promise.resolve();
};

describe("the shrine's gift card", () => {
  beforeEach(() => {
    for (const key of Object.keys(store)) delete store[key];
    vi.mocked(transitionToScene).mockReset();
    vi.mocked(transitionToScene).mockImplementation(() => Promise.resolve(true));
  });
  afterEach(() => vi.restoreAllMocks());

  it('is offered after the blessings, with No blessing still last', () => {
    // Failure: the gift takes skip's index (so "No blessing" takes the gift), or is never drawn.
    const scene = openShrine(registry({ activeSlot: 1, meta: meta(1) }), HOARD_SEED);
    expect(scene.gift?.id).toBe('fallen_hoard');
    expect(scene._skipIndex()).toBe(scene.options.length + 1);
    const none = openShrine(registry({ activeSlot: 1, meta: meta(0) }), HOARD_SEED);
    expect(none.gift).toBeNull();
    expect(none._skipIndex()).toBe(none.options.length);
    const unlucky = openShrine(registry({ activeSlot: 1, meta: meta(4) }), NO_GIFT_SEED);
    expect(unlucky.gift).toBeNull();
  });

  it('is reached by the keyboard and the controller, between the blessings and No blessing', () => {
    // Failure: navigation stops at the last blessing (the gift is unreachable without touch), or
    // runs past skip.
    const scene = openShrine(registry({ activeSlot: 1, meta: meta(1) }), HOARD_SEED);
    for (let i = 0; i < scene.options.length; i++) scene._navigate(1);
    expect(scene.selectedIndex).toBe(scene.options.length);
    expect(scene._giftSelected()).toBe(true);
    scene._onInputAction(InputAction.NAVIGATE, { dy: 1 });
    expect(scene.selectedIndex).toBe(scene._skipIndex());
    scene._navigate(1); // skip is the end
    expect(scene.selectedIndex).toBe(scene._skipIndex());
    scene._onInputAction(InputAction.NAVIGATE, { dy: -1 });
    expect(scene._giftSelected()).toBe(true);
  });

  it('backing out and returning offers the same gift', () => {
    // Failure: the gift is rolled afresh on every visit, so backing out rerolls it for free.
    const reg = registry({ activeSlot: 1, meta: meta(2) });
    vi.spyOn(Date, 'now').mockReturnValue(HOARD_SEED);
    const first = openShrine(reg);
    vi.mocked(Date.now).mockReturnValue(999_999);
    const again = openShrine(reg);
    expect(again.runManager.runSeed).toBe(first.runManager.runSeed);
    expect(again.gift?.id ?? null).toBe(first.gift?.id ?? null);
    expect(first.gift?.id).toBe('fallen_hoard');
  });

  it('confirming the gift takes it once, in place of a blessing, even on a double confirm', async () => {
    // Failure: a double tap starts two transitions or grants the hoard twice; or the gift is
    // taken beside a blessing.
    const m = meta(1);
    const scene = openShrine(registry({ activeSlot: 1, meta: m }), HOARD_SEED);
    scene.selectedIndex = scene.options.length;
    scene._confirm();
    scene._confirm();
    await flush();
    expect(transitionToScene).toHaveBeenCalledTimes(1);
    const run = scene.runManager;
    expect(run.startGift?.id).toBe('fallen_hoard');
    expect(run.accessories).toHaveLength(2);
    expect(run.activeBlessings).toEqual([]);
    expect(run.burdens.map((b) => b.id)).toEqual(['hunted']);
    expect(m.incrementRunsStarted).toHaveBeenCalledTimes(1);
  });

  it('a failed start rebuilds a fresh run: nothing leaks, the count does not move, the gift stays', async () => {
    // Failure: the rolled-back run keeps the gift's accessories and catch (taken again on the
    // retry: twice), or the failed start counts as a run started (changing the next offer).
    vi.mocked(transitionToScene).mockImplementation(() => Promise.resolve(false));
    const m = meta(1);
    const scene = openShrine(registry({ activeSlot: 1, meta: m }), HOARD_SEED);
    scene.selectedIndex = scene.options.length;
    const before = scene.runManager;
    scene._confirm();
    await flush();
    expect(before.startGift?.id).toBe('fallen_hoard');
    expect(scene.runManager).not.toBe(before);
    expect(scene.runManager.startGift).toBeNull();
    expect(scene.runManager.accessories).toEqual([]);
    expect(scene.runManager.burdens).toEqual([]);
    expect(scene.gift?.id).toBe('fallen_hoard');
    expect(scene._giftSelected()).toBe(true);
    expect(m.incrementRunsStarted).not.toHaveBeenCalled();
    // The retry succeeds and grants exactly once.
    vi.mocked(transitionToScene).mockImplementation(() => Promise.resolve(true));
    scene._confirm();
    await flush();
    expect(scene.runManager.accessories).toHaveLength(2);
    expect(scene.runManager.burdens).toEqual([
      expect.objectContaining({ id: 'hunted', battles: 3 }),
    ]);
    expect(m.incrementRunsStarted).toHaveBeenCalledTimes(1);
  });

  for (const [label, failure] of [
    [
      'returns { ok: false }',
      (run) => {
        // Part-way: the selection made and part of a grant, then a failure.
        run.chooseBlessing(null);
        run.accessories.push({ name: 'Leaked Ring', type: 'Accessory' });
        return { ok: false, reason: 'grant_failed', dirty: true };
      },
    ],
    [
      'throws',
      (run) => {
        run.chooseBlessing(null);
        run.accessories.push({ name: 'Leaked Ring', type: 'Accessory' });
        throw new Error('the grant broke');
      },
    ],
  ]) {
    it(`a take that ${label} rolls the shrine back: no start, nothing leaks, the gift can be taken again`, async () => {
      // Failure: the shrine keeps the half-changed run (the selection already made, so every
      // retry is refused and the player is stuck), begins a run with nothing granted, or lets
      // the partial grant leak into the retried run.
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const m = meta(1);
      const scene = openShrine(registry({ activeSlot: 1, meta: m }), HOARD_SEED);
      scene.selectedIndex = scene.options.length;
      const failing = scene.runManager;
      vi.spyOn(failing, 'chooseStartGift').mockImplementation(() => failure(failing));
      scene._confirm();
      await flush();
      expect(transitionToScene).not.toHaveBeenCalled();
      expect(scene._blessingCommitted).toBe(false);
      expect(scene.isTransitioning).toBe(false);
      expect(scene.runManager).not.toBe(failing);
      expect(scene.runManager.accessories).toEqual([]);
      expect(scene.runManager._blessingChosen).toBe(false);
      expect(scene.gift?.id).toBe('fallen_hoard');
      expect(scene._giftSelected()).toBe(true);
      expect(m.incrementRunsStarted).not.toHaveBeenCalled();
      // The player chooses again: the gift is taken once and the run begins.
      scene._confirm();
      await flush();
      expect(transitionToScene).toHaveBeenCalledTimes(1);
      expect(scene.runManager.startGift?.id).toBe('fallen_hoard');
      expect(scene.runManager.accessories.map((a) => a.name)).not.toContain('Leaked Ring');
      expect(scene.runManager.accessories).toHaveLength(2);
      expect(m.incrementRunsStarted).toHaveBeenCalledTimes(1);
    });
  }

  it("records a gift run as a gift, and a gift's card as granted, never as a pick", async () => {
    // Failure: the selection record reads as "skipped the blessing", or the Reliquary's card is
    // attributed to the shrine's pick.
    vi.mocked(recordBlessingSelection).mockClear();
    const hoard = openShrine(registry({ activeSlot: 1, meta: meta(1) }), HOARD_SEED);
    hoard.selectedIndex = hoard.options.length;
    hoard._confirm();
    await flush();
    expect(recordBlessingSelection).toHaveBeenLastCalledWith(
      expect.objectContaining({
        chosenId: null,
        giftOfferedId: 'fallen_hoard',
        giftId: 'fallen_hoard',
        grantedBlessingId: null,
      }),
    );
    const reliquary = openShrine(registry({ activeSlot: 2, meta: meta(1) }), RELIQUARY_SEED);
    expect(reliquary.gift?.id).toBe('sealed_reliquary');
    reliquary.selectedIndex = reliquary.options.length;
    reliquary._confirm();
    await flush();
    const card = reliquary.runManager.startGift.granted.find((g) => g.kind === 'blessing');
    expect(card?.id).toBeTruthy();
    expect(recordBlessingSelection).toHaveBeenLastCalledWith(
      expect.objectContaining({
        chosenId: null,
        giftId: 'sealed_reliquary',
        grantedBlessingId: card.id,
      }),
    );
    // A blessing chosen beside an offered gift: the gift's offer only.
    const blessing = openShrine(registry({ activeSlot: 3, meta: meta(1) }), HOARD_SEED);
    blessing.selectedIndex = 0;
    blessing._confirm();
    await flush();
    expect(recordBlessingSelection).toHaveBeenLastCalledWith(
      expect.objectContaining({
        chosenId: blessing.options[0].id,
        giftOfferedId: 'fallen_hoard',
        giftId: null,
      }),
    );
  });

  it('No blessing after a gift is offered still begins with no blessing and no gift', async () => {
    // Failure: skip's old index (options.length) now takes the gift.
    const scene = openShrine(registry({ activeSlot: 1, meta: meta(1) }), HOARD_SEED);
    scene.selectedIndex = scene._skipIndex();
    scene._confirm();
    await flush();
    expect(scene.runManager.startGift).toBeNull();
    expect(scene.runManager.activeBlessings).toEqual([]);
    expect(scene.runManager.accessories).toEqual([]);
  });

  it('the canvas fallback (no DOM host) fits four cards above Skip, each cost line on its card', () => {
    // Failure: four cards keep the three-card minimum height (68), so the last overlaps the
    // Skip button, or a card's cost line is drawn over the next card.
    const scene = openShrine(registry({ activeSlot: 1, meta: meta(1) }), HOARD_SEED);
    expect(scene.gift?.id).toBe('fallen_hoard');
    const rects = [];
    const texts = [];
    const chain = (extra) => {
      const obj = {
        setStrokeStyle: () => obj,
        setInteractive: () => obj,
        setOrigin: () => obj,
        setColor: () => obj,
        setText(text) {
          obj.text = text;
          return obj;
        },
        on: () => obj,
        ...extra,
      };
      return obj;
    };
    scene.children = { removeAll: () => {} };
    scene.cameras = { main: { width: 640, height: 480 } };
    scene.add = {
      rectangle: (x, y, w, h) => {
        const r = chain({ x, y, w, h });
        rects.push(r);
        return r;
      },
      text: (x, y, text, style) => {
        // One line per ~6px of 9-10px text on a wrap: enough to drive the truncation.
        const width = style?.wordWrap?.width || 1e9;
        const t = chain({ x, y, text, style });
        Object.defineProperty(t, 'height', {
          get: () => Math.ceil((t.text.length * 5.5) / width) * 12,
        });
        texts.push(t);
        return t;
      },
    };
    BlessingSelectScene.prototype._draw.call(scene);
    const cardW = Math.min(600, 640 - 40) - 28;
    const cards = rects.filter((r) => r.w === cardW && r.h > 10);
    expect(cards).toHaveLength(4);
    const skip = texts.find((t) => /Skip Blessing/.test(t.text));
    for (let i = 0; i < cards.length; i++) {
      const top = cards[i].y - cards[i].h / 2;
      const bottom = cards[i].y + cards[i].h / 2;
      if (i > 0) expect(top).toBeGreaterThanOrEqual(cards[i - 1].y + cards[i - 1].h / 2);
      expect(bottom).toBeLessThan(skip.y - 10);
      const cost = texts.find(
        (t) => /^(Cost|Price|Pact|Catch|Twist): /.test(t.text) && t.y >= top && t.y < bottom,
      );
      if (cost) expect(cost.y + 11).toBeLessThanOrEqual(bottom);
    }
    // Every priced card's cost line sits on its own card (the gift's catch included).
    const costs = texts.filter((t) => /^(Cost|Price|Pact|Catch|Twist): /.test(t.text));
    expect(costs.some((t) => t.text.includes('Hunted for the next 3 battles'))).toBe(true);
    for (const cost of costs)
      expect(
        cards.some((c) => cost.y >= c.y - c.h / 2 && cost.y + 11 <= c.y + c.h / 2),
        cost.text,
      ).toBe(true);
  });
});
