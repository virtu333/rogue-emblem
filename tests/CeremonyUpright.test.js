// Ceremonies on an upright phone (portrait mode): the upright test, the rite's switch
// to the whole screen, its stacked figure size, and the part-by-part lines. Browser
// layout is covered by tests/e2e/portrait-ceremonies.spec.js.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFakeDom } from './helpers/fakeDom.js';
import { CeremonyLayer, partedLine, uprightPage } from '../src/ui/ceremonyDom.js';
import { figureSize, stackedFigureSize } from '../src/ui/GrowthCeremonyController.js';
import { PORTRAIT_UI_CHANGE_EVENT } from '../src/utils/portraitBattle.js';

function env({ classes = [], portrait = true } = {}) {
  const list = new Set(classes);
  return {
    document: { documentElement: { classList: { contains: (c) => list.has(c) } } },
    matchMedia: (query) => ({ matches: query === '(orientation: portrait)' && portrait }),
  };
}

describe('uprightPage', () => {
  it('needs a portrait class and a portrait viewport', () => {
    expect(uprightPage(env({ classes: ['portrait-ui'] }))).toBe(true);
    expect(uprightPage(env({ classes: ['portrait-battle-capable'] }))).toBe(true);
    // A landscape battle keeps portrait-battle-capable; a stale class during a turn.
    expect(uprightPage(env({ classes: ['portrait-battle-capable'], portrait: false }))).toBe(false);
    expect(uprightPage(env({ classes: ['portrait-ui'], portrait: false }))).toBe(false);
    expect(uprightPage(env({ classes: [] }))).toBe(false);
    expect(uprightPage({})).toBe(false);
  });
});

describe('the rite stands its figure over the words', () => {
  it('keeps the integer scales, capped by 30% of the height and 60% of the width', () => {
    expect(stackedFigureSize(390, 844)).toBe(192); // room for the 1x figure
    expect(stackedFigureSize(430, 932)).toBe(192);
    expect(stackedFigureSize(375, 560)).toBe(168); // a short screen: fit, never overlap
    expect(stackedFigureSize(200, 900)).toBe(120); // narrow: 60% of the width
    expect(stackedFigureSize(375, 200)).toBe(96); // never below the least readable size
    // Beside the words (landscape) the sizes are unchanged.
    expect(figureSize(620, 390)).toBe(192);
  });
});

describe('part-by-part lines', () => {
  it('wraps each part in its own span and keeps the text', () => {
    installFakeDom(vi);
    const line = partedLine('ce-runend-meta', 'Old Kingdom Roads · Act II · Turn 12');
    expect(line.textContent).toBe('Old Kingdom Roads · Act II · Turn 12');
    expect(line.children.filter((n) => n.tagName === 'SPAN').map((n) => n.textContent)).toEqual([
      'Old Kingdom Roads',
      'Act II',
      'Turn 12',
    ]);
    expect(partedLine('ce-band-sub', 'Edric has fallen').textContent).toBe('Edric has fallen');
    vi.unstubAllGlobals();
  });
});

describe('a layer with an upright frame', () => {
  let dom;
  let portrait;
  beforeEach(() => {
    dom = installFakeDom(vi);
    dom.doc.documentElement = dom.doc.createElement('html');
    portrait = true;
    vi.stubGlobal('matchMedia', (q) => ({ matches: q === '(orientation: portrait)' && portrait }));
  });
  afterEach(() => vi.unstubAllGlobals());

  const scene = () => ({ game: { canvas: dom.canvas } });

  it('covers the map until the page is upright, then the screen, and follows a turn', () => {
    const layer = new CeremonyLayer(scene(), { frame: 'map', upright: 'screen' });
    // Map frame: the canvas beside the rail (622 px of the 844 px wrapper).
    expect(layer.root.dataset.frame).toBe('map');
    expect(layer.root.style.width).toBe('622px');
    dom.doc.documentElement.classList.add('portrait-ui');
    dom.win._fire(new dom.FakeEvent(PORTRAIT_UI_CHANGE_EVENT), false);
    expect(layer.root.dataset.frame).toBe('screen');
    expect(layer.root.style.width).toBe('844px');
    // Turned sideways with the class still on: back to the map.
    portrait = false;
    dom.win._fire(new dom.FakeEvent('resize'), false);
    expect(layer.root.dataset.frame).toBe('map');
    expect(layer.root.style.width).toBe('622px');
    layer.destroy();
    expect(dom.win.listenerCount(PORTRAIT_UI_CHANGE_EVENT)).toBe(0);
  });

  it('a layer without an upright frame keeps its own', () => {
    dom.doc.documentElement.classList.add('portrait-ui');
    const layer = new CeremonyLayer(scene(), { frame: 'map' });
    expect(layer.root.dataset.frame).toBe('map');
    expect(layer.root.style.width).toBe('622px');
    layer.destroy();
  });
});
