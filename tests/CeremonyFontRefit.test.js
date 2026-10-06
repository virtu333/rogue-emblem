// A ceremony fits its text to the face on hand and measures again when a face lands.
// CeremonyLayer.addFitter refits once the display face's 700 weight resolves, but a boss's
// epithet is set in the 500 weight, which can arrive after that and be wider: the line
// then overflowed its card (found when a seed drew the longest epithet, "First Lance of the
// Second Push", on an Act II boss). Layout is proven in tests/e2e/ceremonies.spec.js.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFakeDom } from './helpers/fakeDom.js';
import { CeremonyLayer } from '../src/ui/ceremonyDom.js';

let dom;
let fonts;
beforeEach(() => {
  dom = installFakeDom(vi);
  // The probe's own load never settles here, so only the font-set event can refit.
  const listeners = new Set();
  fonts = {
    load: () => new Promise(() => {}),
    addEventListener: (type, fn) => type === 'loadingdone' && listeners.add(fn),
    removeEventListener: (type, fn) => type === 'loadingdone' && listeners.delete(fn),
    loadingdone: () => [...listeners].forEach((fn) => fn()),
    count: () => listeners.size,
  };
  dom.doc.fonts = fonts;
});
afterEach(() => vi.unstubAllGlobals());

const scene = () => ({ game: { canvas: dom.canvas } });

describe('a layer refits its text when a font face lands', () => {
  it('runs every fitter again on loadingdone, and stops once destroyed', () => {
    const layer = new CeremonyLayer(scene(), { frame: 'map' });
    const fit = vi.fn();
    layer.addFitter(fit);
    expect(fit).toHaveBeenCalledTimes(1);
    fonts.loadingdone();
    expect(fit).toHaveBeenCalledTimes(2);
    fonts.loadingdone();
    expect(fit).toHaveBeenCalledTimes(3);
    layer.destroy();
    expect(fonts.count()).toBe(0);
    fonts.loadingdone();
    expect(fit).toHaveBeenCalledTimes(3);
  });

  it('leaves no listener behind when a layer never fitted anything', () => {
    const layer = new CeremonyLayer(scene(), { frame: 'map' });
    expect(fonts.count()).toBe(1);
    layer.destroy();
    expect(fonts.count()).toBe(0);
  });
});
