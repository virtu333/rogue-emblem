// Menu titles (MenuSurface headers and the roster sheet) share --re-menu-title-size.
// On a DPR 1 desktop the pixel-font grid moves a pixel-font size to the nearest crisp
// one (8, 16 or 24px); the titles once asked for 11px (roster 10px) and landed on 8px,
// smaller than the 13px body copy under them.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isCrispPixelFontSize, snapPixelFontSize } from '../src/utils/pixelFontGrid.js';

const ui = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'ui');
const css = (name) => readFileSync(join(ui, name), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const BODY_PX = 13; // --re-t-body

/** The design size a declaration of --re-menu-title-size asks for. */
function titleSizes(text) {
  return [...text.matchAll(/--re-menu-title-size:\s*var\(--re-pf-(\d+),\s*(\d+)px\)/g)].map(
    ([, size, fallback]) => ({ size: Number(size), fallback: Number(fallback) }),
  );
}

/** Font size of the first rule whose selector is exactly `selector`. */
function ruleFontSize(text, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rule = text.match(new RegExp(`(^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`));
  return rule?.[2].match(/font-size:\s*([^;]+);/)?.[1].trim();
}

describe('menu title size', () => {
  const [desktop] = titleSizes(css('mobileTheme.css'));

  it('is crisp and larger than the body copy on a DPR 1 desktop, and holds elsewhere', () => {
    expect(desktop.fallback).toBe(desktop.size); // touch builds use the design size
    const dpr1 = snapPixelFontSize(desktop.size, { dpr: 1 });
    expect(isCrispPixelFontSize(dpr1, 1)).toBe(true);
    expect(dpr1).toBeGreaterThan(BODY_PX);
    // Windows 125% / 150%, Retina, browser zoom: never under 12px, never past 16px.
    for (const dpr of [1.25, 1.5, 1.8, 2, 2.2, 3]) {
      const px = snapPixelFontSize(desktop.size, { dpr });
      expect(px, `DPR ${dpr}`).toBeGreaterThanOrEqual(12);
      expect(px, `DPR ${dpr}`).toBeLessThanOrEqual(16);
    }
  });

  it('is what the menu surface and the roster sheet title themselves with', () => {
    expect(ruleFontSize(css('cohesion.css'), '.re-live-menu .re-header h2')).toBe(
      'var(--re-menu-title-size)',
    );
    expect(ruleFontSize(css('mobileRoster.css'), '.mr-sheet header h2')).toBe(
      'var(--re-menu-title-size)',
    );
  });

  it('upright, stays a pixel-font size that fits two lines of the longest title', () => {
    const [upright] = titleSizes(css('portraitMode.css'));
    expect(upright.size).toBeGreaterThanOrEqual(11);
    expect(upright.size).toBeLessThanOrEqual(desktop.size);
  });
});
