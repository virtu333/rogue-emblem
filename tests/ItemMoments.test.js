// The moments around items: service vignettes, blessing card paintings, the reward
// reveal. Presentation only — these tests pin which painting a screen shows, that every
// blessing and service has one, the budget, and the reveal's timing and skip rules.
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import manifest from '../src/ui/momentArtManifest.json';
import {
  SERVICE_VIGNETTES,
  serviceVignetteFor,
  vignetteMotion,
  vignetteUrl,
  blessingCardUrl,
  hasBlessingPainting,
  prefersStill,
} from '../src/ui/itemMoments.js';
import {
  playRewardReveal,
  rarestIndex,
  revealDuration,
  REVEAL_TURN_MS,
  REVEAL_STAGGER_MS,
} from '../src/ui/rewardReveal.js';
import { decodePng } from '../tools/art/icons/lib/png.mjs';
import { loadGameData } from './testData.js';

const data = loadGameData();

describe('moment art coverage and budget', () => {
  it('every blessing has a card painting and every service a vignette', () => {
    for (const b of data.blessings.blessings) {
      expect(hasBlessingPainting(b.id), b.id).toBe(true);
      expect(blessingCardUrl(b.id)).toMatch(new RegExp(`moments/cards/${b.id}\\.png\\?v=`));
    }
    expect([...SERVICE_VIGNETTES].sort()).toEqual(
      ['arena', 'caravan', 'church', 'forge', 'ruins', 'shop'].sort(),
    );
  });

  it('paintings ship at display size as small palette PNGs (lazy, never at boot)', () => {
    const check = (dir, [w, h], maxKB) => {
      for (const f of fs.readdirSync(`assets/ui/moments/${dir}`)) {
        const buf = fs.readFileSync(`assets/ui/moments/${dir}/${f}`);
        const png = decodePng(buf);
        expect([png.width, png.height], f).toEqual([w, h]);
        expect(buf.length, f).toBeLessThanOrEqual(maxKB * 1024);
        expect(fs.readFileSync(`public/assets/ui/moments/${dir}/${f}`).equals(buf)).toBe(true);
      }
    };
    check('cards', manifest.card, 24);
    check('vignettes', manifest.vignette, 64);
    // One vignette decoded at a time (640x360x4) and at most four cards on screen.
    expect(manifest.vignette[0] * manifest.vignette[1] * 4).toBeLessThanOrEqual(1024 * 1024);
    expect(4 * manifest.card[0] * manifest.card[1] * 4).toBeLessThanOrEqual(1024 * 1024);
    const boot = fs.readFileSync('src/scenes/BootScene.js', 'utf8');
    expect(boot).not.toMatch(/assets\/ui\/(items|moments)/);
    expect(boot).not.toMatch(/icon_\$\{name\}/);
  });
});

describe('service vignettes', () => {
  it('picks the place from the screen', () => {
    expect(serviceVignetteFor({})).toBe('shop');
    expect(serviceVignetteFor({ tab: 'forge' })).toBe('forge');
    expect(serviceVignetteFor({ caravan: true, tab: 'forge' })).toBe('caravan');
    expect(serviceVignetteFor({ ruins: true })).toBe('ruins');
    expect(serviceVignetteFor({ service: 'arena' })).toBe('arena');
    expect(serviceVignetteFor({ service: 'nowhere' })).toBe('shop');
    expect(vignetteMotion('forge')).toBe('sparks');
    expect(vignetteMotion('church')).toBe('candles');
    expect(vignetteMotion('shop')).toBeNull();
    expect(vignetteUrl('forge')).toMatch(/moments\/vignettes\/forge\.png\?v=[0-9a-f]{8}$/);
    expect(vignetteUrl('nowhere')).toBeNull();
  });

  it('reduce motion follows the game setting', () => {
    const scene = (on) => ({ registry: { get: () => ({ getReduceMotion: () => on }) } });
    expect(prefersStill(scene(true))).toBe(true);
    expect(typeof prefersStill(scene(false))).toBe('boolean');
  });
});

describe('reward reveal', () => {
  const original = globalThis.document;
  afterEach(() => {
    globalThis.document = original;
  });
  const fakeDom = () => {
    const make = () => {
      const node = {
        classes: new Set(),
        children: [],
        props: {},
        listeners: {},
        classList: {
          add: (...c) => c.forEach((x) => node.classes.add(x)),
          remove: (...c) => c.forEach((x) => node.classes.delete(x)),
        },
        style: { setProperty: (k, v) => (node.props[k] = v) },
        setAttribute() {},
        append: (c) => {
          c.parent = node;
          node.children.push(c);
        },
        remove() {
          if (node.parent) node.parent.children = node.parent.children.filter((c) => c !== node);
        },
        addEventListener: (t, fn) => (node.listeners[t] = fn),
        removeEventListener: (t) => delete node.listeners[t],
      };
      return node;
    };
    globalThis.document = { createElement: make };
    return make;
  };
  const clock = () => {
    const timers = [];
    return {
      setTimeout: (fn, ms) => timers.push({ fn, ms }) && timers.length,
      clearTimeout: (id) => (timers[id - 1] = null),
      run: () => {
        for (const t of [...timers].sort((a, b) => (a?.ms ?? 0) - (b?.ms ?? 0))) t?.fn();
      },
      timers,
    };
  };

  it('ranks the rarest card and times the turns', () => {
    expect(rarestIndex(['Iron', 'Legend', 'Rare'])).toBe(1);
    expect(rarestIndex(['Iron', 'Steel', null])).toBe(-1);
    expect(rarestIndex(['Silver', 'Silver'])).toBe(0);
    expect(revealDuration(0)).toBe(0);
    expect(revealDuration(4, false)).toBe(120 + 3 * REVEAL_STAGGER_MS + REVEAL_TURN_MS);
  });

  it('turns cards face up in order and ends on its own', () => {
    const make = fakeDom();
    const container = make();
    const cards = [make(), make(), make()];
    const c = clock();
    let done = 0;
    const state = playRewardReveal(container, cards, {
      tiers: ['Iron', 'Legend', 'Steel'],
      setTimeout: c.setTimeout,
      clearTimeout: c.clearTimeout,
      onDone: () => (done += 1),
    });
    expect(container.classes.has('ia-revealing')).toBe(true);
    expect(cards.every((card) => card.classes.has('ia-face-down'))).toBe(true);
    expect(cards.map((card) => card.props['--ia-i'])).toEqual(['0', '1', '2']);
    expect(cards.every((card) => card.children.length === 1)).toBe(true);
    c.run();
    expect(state.done).toBe(true);
    expect(done).toBe(1);
    expect(cards.some((card) => card.classes.has('ia-face-down'))).toBe(false);
    expect(cards.every((card) => card.children.length === 0)).toBe(true);
    expect(container.listeners.pointerdown).toBeUndefined();
  });

  it('a tap skips to the end state without reaching the cards', () => {
    const make = fakeDom();
    const container = make();
    const cards = [make(), make()];
    const c = clock();
    const state = playRewardReveal(container, cards, {
      setTimeout: c.setTimeout,
      clearTimeout: c.clearTimeout,
    });
    let stopped = false;
    container.listeners.pointerdown({
      preventDefault() {},
      stopPropagation() {
        stopped = true;
      },
    });
    expect(stopped).toBe(true);
    expect(state.done).toBe(true);
    expect(cards.some((card) => card.classes.has('ia-face-down'))).toBe(false);
  });

  it('reduce motion and instant speed show the end state at once', () => {
    const make = fakeDom();
    const container = make();
    const cards = [make()];
    let done = false;
    const state = playRewardReveal(container, cards, { still: true, onDone: () => (done = true) });
    expect(state.done).toBe(true);
    expect(done).toBe(true);
    expect(cards[0].classes.size).toBe(0);
  });
});
