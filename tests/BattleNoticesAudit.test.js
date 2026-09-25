// Mechanics-audit fixes: battle notices, reinforcement arrival, status
// badges, and the legendary trait on a lord's join card.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFakeDom } from './helpers/fakeDom.js';
import { loadGameData } from './testData.js';
import traits from '../data/traits.json';
import { CeremonyController } from '../src/ui/CeremonyController.js';
import { arrivalContent, noticeTone } from '../src/ui/ceremonyContent.js';
import { ReinforcementPresenter } from '../src/ui/ReinforcementPresenter.js';
import {
  STATUS_BADGE_SIZE,
  statusBadgeKey,
  statusBadgePixels,
  createStatusBadge,
} from '../src/ui/StatusBadges.js';
import { CREST_PALETTE } from '../src/ui/crestArt.js';
import { legendaryTrait, recruitCardContent } from '../src/ui/growthContent.js';
import { UI_PALETTE } from '../src/utils/uiStyles.js';
import { _resetInputFocus, activeInputOwner } from '../src/utils/inputFocus.js';
import { hasOpenOverlay } from '../src/utils/overlayStack.js';

const gameData = loadGameData();
const traitList = Array.isArray(traits) ? traits : traits.traits;

function makeScene({ reduceMotion = false, speed = 'normal' } = {}) {
  const handlers = new Map();
  const listeners = (name) => handlers.get(name) || handlers.set(name, new Set()).get(name);
  return {
    gameData,
    textures: { exists: () => false },
    registry: {
      get: (key) =>
        key === 'settings'
          ? { getReduceMotion: () => reduceMotion, getBattleSpeed: () => speed }
          : null,
    },
    events: {
      once: (name, fn) => listeners(name).add(fn),
      off: (name, fn) => listeners(name).delete(fn),
      emit: (name) => {
        const fns = [...listeners(name)];
        listeners(name).clear();
        for (const fn of fns) fn();
      },
    },
  };
}

let dom;
beforeEach(() => {
  vi.useFakeTimers();
  dom = installFakeDom(vi);
  _resetInputFocus();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  _resetInputFocus();
});
const layers = () => dom.doc.querySelectorAll('.ce-layer');

describe('battle notices', () => {
  it('maps the canvas banner colours to tones', () => {
    expect(noticeTone(UI_PALETTE.good, UI_PALETTE)).toBe('good');
    expect(noticeTone(UI_PALETTE.bad, UI_PALETTE)).toBe('bad');
    expect(noticeTone(UI_PALETTE.muted, UI_PALETTE)).toBe('muted');
    expect(noticeTone(UI_PALETTE.info, UI_PALETTE)).toBe('info');
    expect(noticeTone(UI_PALETTE.accentText, UI_PALETTE)).toBe('gold');
    expect(noticeTone(undefined, UI_PALETTE)).toBe('gold');
  });

  it('never blocks, keeps its full reading window even at Instant, stacks, then leaves', async () => {
    const scene = makeScene({ speed: 'instant' });
    const c = new CeremonyController(scene);
    const a = c.showNotice({ message: 'Village saved! +300g', tone: 'good' });
    const b = c.showNotice({ message: 'Bandits! They head for the village!', tone: 'bad' });
    expect(layers()).toHaveLength(2);
    expect(layers()[0].classList.contains('is-blocking')).toBe(false);
    expect(layers()[0].querySelector('.ce-notice-text').textContent).toBe('Village saved! +300g');
    expect(layers()[0].style.getPropertyValue('--ce-notice-slot')).toBe('0');
    expect(layers()[1].style.getPropertyValue('--ce-notice-slot')).toBe('1');
    expect(c.isBlocking()).toBe(false);
    expect(hasOpenOverlay(scene)).toBe(false);
    expect(activeInputOwner()).toBeNull();
    let settled = false;
    void a.done.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(900);
    expect(settled).toBe(false); // 1.1s reading window, not halved by Instant
    await vi.advanceTimersByTimeAsync(700);
    expect(settled).toBe(true);
    await b.done;
    expect(layers()).toHaveLength(0);
  });

  it('shutdown removes notices and settles their waiters', async () => {
    const scene = makeScene();
    const c = new CeremonyController(scene);
    const n = c.showNotice({ message: 'Protected!', tone: 'good' });
    scene.events.emit('shutdown');
    await expect(n.done).resolves.toBeUndefined();
    expect(layers()).toHaveLength(0);
  });
});

describe('reinforcements', () => {
  it('names arrivals and bandits', () => {
    expect(arrivalContent({ count: 1 })).toEqual({
      word: 'REINFORCEMENTS',
      sub: 'An enemy arrives',
    });
    expect(arrivalContent({ count: 3, bandits: 2 }).sub).toBe(
      '3 enemies arrive · 2 bandits make for the village',
    );
    expect(arrivalContent({ bandits: 1 }).sub).toBe('A bandit makes for the village');
    expect(arrivalContent({})).toBeNull();
  });

  it('one crimson band, visible arrivals marked, fogged arrivals never leaked', () => {
    const scene = makeScene();
    const made = [];
    const tweens = [];
    scene._getCeremonies = () => (scene._c ||= new CeremonyController(scene));
    scene.grid = { gridToPixel: (c, r) => ({ x: c * 32, y: r * 32 }) };
    scene.add = {
      graphics: () => {
        const g = {
          destroyed: false,
          setDepth() {
            return g;
          },
          lineStyle() {},
          lineBetween() {},
          strokePoints() {},
          setPosition() {},
          setScale() {},
          setAlpha() {},
          destroy() {
            g.destroyed = true;
          },
        };
        made.push(g);
        return g;
      },
    };
    scene.tweens = { add: (cfg) => tweens.push(cfg) };
    scene.showReinforcementBanner = vi.fn();
    const seen = { col: 1, row: 1, graphic: { visible: true } };
    const fogged = { col: 5, row: 5, graphic: { visible: false } };
    const p = new ReinforcementPresenter(scene);
    p.present([seen, fogged], { bandits: 0 });
    expect(layers()).toHaveLength(1);
    expect(layers()[0].querySelector('.ce-arrival-sub').textContent).toBe('2 enemies arrive');
    expect(scene.showReinforcementBanner).not.toHaveBeenCalled();
    expect(made).toHaveLength(2); // one thread + one ring, for the visible arrival only
    scene.events.emit('shutdown');
    expect(made.every((g) => g.destroyed)).toBe(true);
    expect(p.destroyed).toBe(true);
  });

  it('without a DOM host the scene keeps its canvas banners', () => {
    vi.unstubAllGlobals();
    installFakeDom(vi, { wrapper: false });
    const scene = makeScene();
    scene._getCeremonies = () => new CeremonyController(scene);
    scene.showReinforcementBanner = vi.fn();
    scene._villageController = { showBanditArrivalBanner: vi.fn() };
    new ReinforcementPresenter(scene).present([{ col: 0, row: 0 }, { col: 1, row: 0 }], { bandits: 1 }); // prettier-ignore
    expect(scene.showReinforcementBanner).toHaveBeenCalledWith(1);
    expect(scene._villageController.showBanditArrivalBanner).toHaveBeenCalledTimes(1);
  });
});

describe('status badges', () => {
  const palette = new Set(Object.values(CREST_PALETTE).flat());
  it('each condition is a distinct 11×11 seal in the art palette', () => {
    const seen = new Set();
    for (const id of ['sleep', 'silence', 'acid', 'root']) {
      const px = statusBadgePixels(id);
      expect(px).toHaveLength(STATUS_BADGE_SIZE);
      for (const row of px) {
        expect(row).toHaveLength(STATUS_BADGE_SIZE);
        for (const c of row) if (c) expect(palette.has(c), `${id} ${c}`).toBe(true);
      }
      expect(px[0][0]).toBeNull(); // diamond: transparent corners
      seen.add(JSON.stringify(px));
      expect(statusBadgeKey(id)).toBe(`status-badge-${id}`);
    }
    expect(seen.size).toBe(4);
    expect(statusBadgeKey('mystery')).toBe('status-badge-unknown');
  });

  it('bakes each texture once and falls back to null without a canvas', () => {
    const added = [];
    const ctx = { fillRect: vi.fn(), set fillStyle(v) {} };
    const origCreate = dom.doc.createElement.bind(dom.doc);
    dom.doc.createElement = (tag) => {
      const node = origCreate(tag);
      if (tag === 'canvas') node.getContext = () => ctx;
      return node;
    };
    const keys = new Set();
    const scene = {
      textures: {
        exists: (k) => keys.has(k),
        addCanvas: (k) => {
          keys.add(k);
          added.push(k);
        },
      },
      add: {
        image: (x, y, key) => {
          const img = { x, y, key, setDepth: () => img, setOrigin: () => img };
          return img;
        },
      },
    };
    const a = createStatusBadge(scene, 'sleep', 10, 20);
    const b = createStatusBadge(scene, 'sleep', 30, 20);
    expect(a.key).toBe('status-badge-sleep');
    expect(b.conditionId).toBe('sleep');
    expect(added).toEqual(['status-badge-sleep']);
    expect(createStatusBadge({ textures: null, add: {} }, 'acid', 0, 0)).toBeNull();
  });
});

describe('legendary lord traits on the join card', () => {
  it('surfaces a rolled legendary trait, ignores common ones', () => {
    const legendary = traitList.find((t) => t.rarity === 'legendary');
    const common = traitList.find((t) => t.rarity !== 'legendary');
    const unit = { name: legendary.lordName, className: 'Lord', traits: [common.id, legendary.id] };
    expect(legendaryTrait(unit, traitList)).toMatchObject({ id: legendary.id, name: legendary.name }); // prettier-ignore
    expect(legendaryTrait({ traits: [common.id] }, traitList)).toBeNull();
    expect(recruitCardContent(unit, { traits: traitList, kind: 'lord' }).legendary.name).toBe(
      legendary.name,
    );
  });
});
