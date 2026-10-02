import { describe, it, expect, vi } from 'vitest';
import {
  isCrispPixelFontSize,
  pixelFontVariables,
  snapPixelFontSize,
  applyPixelFontVariables,
  installPixelFontGrid,
  PIXEL_FONT_SIZES,
} from '../src/utils/pixelFontGrid.js';
import { installCrispCanvasText } from '../src/utils/crispCanvasText.js';

describe('pixel font grid', () => {
  it('snaps to whole device pixels on a Retina Mac (DPR 2)', () => {
    expect(snapPixelFontSize(8, { dpr: 2 })).toBe(8);
    expect(snapPixelFontSize(9, { dpr: 2 })).toBe(8);
    expect(snapPixelFontSize(10, { dpr: 2 })).toBe(8); // tie goes down
    expect(snapPixelFontSize(11, { dpr: 2 })).toBe(12);
    expect(snapPixelFontSize(7, { dpr: 2 })).toBe(8);
    expect(snapPixelFontSize(15, { dpr: 2 })).toBe(16);
  });

  it('keeps every snapped size crisp across DPRs, zoom and transforms', () => {
    for (const dpr of [1, 1.5, 1.8, 2, 2.2, 2.5, 3]) {
      for (const scale of [1, 1.5, 1.875, 2.2]) {
        for (const size of PIXEL_FONT_SIZES) {
          const snapped = snapPixelFontSize(size, { dpr, scale });
          if (snapped === size && !isCrispPixelFontSize(size, dpr, scale)) {
            // Only allowed when every crisp size is more than 25% away (e.g. 12px at DPR 1).
            const step = 8 / (dpr * scale);
            const nearest = Math.max(step, Math.round(size / step) * step);
            expect(Math.abs(nearest - size) / size).toBeGreaterThan(0.2);
          } else {
            expect(isCrispPixelFontSize(snapped, dpr, scale)).toBe(true);
            expect(Math.abs(snapped - size) / size).toBeLessThanOrEqual(0.3 + 1e-9);
          }
        }
      }
    }
  });

  it('never grows a label on a tie and leaves DPR 1 12px alone', () => {
    expect(snapPixelFontSize(12, { dpr: 1 })).toBe(12);
    expect(snapPixelFontSize(10, { dpr: 1 })).toBe(8);
    expect(snapPixelFontSize(12, { dpr: 3 })).toBeCloseTo(10.667, 3);
    expect(snapPixelFontSize(10, { dpr: 3 })).toBeCloseTo(10.667, 3);
    expect(snapPixelFontSize(0, { dpr: 2 })).toBe(0);
    expect(snapPixelFontSize(9, { dpr: 0 })).toBe(8); // bad DPR -> treated as 1
  });

  it('publishes CSS variables, scale-aware for a transformed stage', () => {
    const vars = pixelFontVariables(2);
    expect(vars['--re-pf-9']).toBe('8px');
    expect(vars['--re-pf-11']).toBe('12px');
    const stage = pixelFontVariables(2, { scale: 1.875, prefix: '--rt-pf-' });
    expect(stage['--rt-pf-8']).toBe('8.533px'); // 8.533 × 1.875 × 2 = 32 = 4 font px
    const set = vi.fn();
    applyPixelFontVariables({ style: { setProperty: set } }, 2);
    expect(set).toHaveBeenCalledWith('--re-pf-10', '8px');
  });

  it('installs on :root and follows DPR changes', () => {
    const props = {};
    const listeners = {};
    const win = {
      devicePixelRatio: 2,
      document: {
        documentElement: {
          dataset: {},
          style: { setProperty: (k, v) => (props[k] = v) },
        },
      },
      matchMedia: () => ({ addEventListener: vi.fn(), removeEventListener: vi.fn() }),
      addEventListener: (type, fn) => (listeners[type] = fn),
      removeEventListener: vi.fn(),
    };
    const uninstall = installPixelFontGrid(win);
    expect(props['--re-pf-9']).toBe('8px');
    win.devicePixelRatio = 2.2; // browser zoom 110%
    listeners.resize();
    expect(props['--re-pf-9']).toBe(`${snapPixelFontSize(9, { dpr: 2.2 })}px`);
    expect(isCrispPixelFontSize(parseFloat(props['--re-pf-9']), 2.2)).toBe(true);
    uninstall();
  });
});

describe('crisp canvas text', () => {
  it('uploads supersampled text with LINEAR filtering and restores the renderer flag', () => {
    const seen = [];
    class Text {
      updateText() {
        seen.push(this.renderer.config.antialias);
        return 'ok';
      }
    }
    const Phaser = { GameObjects: { Text } };
    expect(installCrispCanvasText(Phaser)).toBe(true);
    expect(installCrispCanvasText(Phaser)).toBe(false); // idempotent
    const config = { antialias: false };
    const hi = Object.assign(new Text(), {
      style: { resolution: 2 },
      renderer: { config },
      frame: { source: { scaleMode: 1 } },
    });
    const lo = Object.assign(new Text(), {
      style: { resolution: 1 },
      renderer: { config },
      frame: { source: { scaleMode: 1 } },
    });
    expect(hi.updateText()).toBe('ok');
    lo.updateText();
    expect(seen).toEqual([true, false]);
    expect(config.antialias).toBe(false);
    expect(hi.frame.source.scaleMode).toBe(0);
    expect(lo.frame.source.scaleMode).toBe(1);
  });
});
