// Shared checks for portrait mode (docs/portrait-battles.md): an upright phone, the
// real shell (html.portrait-ui is set by utils/portraitBattle.js installPortraitUi,
// on by default on a phone), and the measurements every upright surface must meet.
//
// Every upright spec asserts outcomes a player would see:
//   - nothing scrolls the page (or its own root) sideways;
//   - key controls are whole on screen, at least 44 CSS px, and not covered;
//   - labels do not break mid-word or clip;
//   - content clears the notch and the home bar (emulated safe areas).
import { expect, devices } from '@playwright/test';

export const TAP = 44;

/** The three upright phones portrait mode is built for. */
export const PORTRAIT_PHONES = [
  { width: 375, height: 667 }, // iPhone SE / 8
  { width: 390, height: 844 }, // iPhone 13 / 14
  { width: 430, height: 932 }, // iPhone Pro Max
];

/** Landscape phones and desktops that must not regress. */
export const LANDSCAPE_PHONES = [
  { width: 568, height: 320 },
  { width: 667, height: 375 },
  { width: 844, height: 390 },
];
export const DESKTOPS = [
  { width: 640, height: 480 },
  { width: 1280, height: 800 },
];

// iPhone safe areas (CSS px): upright, the notch / Dynamic Island on top and the home
// bar below; sideways, the notch on one side and a thinner home bar.
export const NOTCH_PORTRAIT = { top: 47, bottom: 34, left: 0, right: 0 };
export const NOTCH_LANDSCAPE = { top: 0, bottom: 21, left: 47, right: 47 };

/**
 * A touch phone context (coarse pointer, mobile UA, touch). Spread into test.use()
 * with a viewport: `test.use(phone(PORTRAIT_PHONES[1]))`. The device screen matches
 * the viewport's phone, so portrait mode is on by default (no opt-in needed).
 */
export function phone(viewport) {
  const short = Math.min(viewport.width, viewport.height);
  const long = Math.max(viewport.width, viewport.height);
  return {
    ...devices['iPhone 13'],
    viewport,
    screen: { width: short, height: long },
  };
}

/** Quiet boot: no music or sfx, no teaching hints (the same settings other specs use). */
export async function quietSettings(page, extra = {}) {
  await page.addInitScript(
    (settings) => localStorage.setItem('emblem_rogue_settings', JSON.stringify(settings)),
    { musicVolume: 0, sfxVolume: 0, hints: false, ...extra },
  );
}

/**
 * Emulate the phone's safe areas (env(safe-area-inset-*)) through the DevTools
 * protocol. Returns false where the browser cannot (the check is then skipped).
 */
export async function emulateSafeArea(page, insets = NOTCH_PORTRAIT) {
  try {
    const cdp = await page.context().newCDPSession(page);
    const full = {};
    for (const side of ['top', 'bottom', 'left', 'right']) {
      full[side] = insets[side] || 0;
      full[`${side}Max`] = insets[side] || 0;
    }
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: full });
    return true;
  } catch {
    return false;
  }
}

/** Portrait mode is live on the page: the class is set and the rotate prompt hidden. */
export async function expectPortraitUi(page, on = true) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.classList.contains('portrait-ui')))
    .toBe(on);
  if (on) await expect(page.locator('#rotate-prompt')).toBeHidden();
}

/** Nothing scrolls sideways: the page, the body, and (optionally) one root element. */
export async function expectNoSidewaysScroll(page, rootSelector = null) {
  await page.evaluate(() => document.fonts.ready);
  const fit = await page.evaluate((sel) => {
    const root = sel ? document.querySelector(sel) : null;
    return {
      page: Math.max(0, document.documentElement.scrollWidth - innerWidth),
      body: Math.max(0, document.body.scrollWidth - innerWidth),
      root: root ? Math.max(0, root.scrollWidth - root.clientWidth - 1) : 0,
      right: root ? Math.max(0, root.getBoundingClientRect().right - innerWidth - 0.5) : 0,
    };
  }, rootSelector);
  expect(fit, `sideways overflow${rootSelector ? ` in ${rootSelector}` : ''}`).toEqual({
    page: 0,
    body: 0,
    root: 0,
    right: 0,
  });
}

/**
 * A control a thumb can hit: whole in the viewport, at least 44 px each way (or
 * `min`), and the topmost element at its centre (nothing covers it).
 */
export async function expectTappable(locator, { min = TAP } = {}) {
  await expect(locator).toBeVisible();
  await locator.scrollIntoViewIfNeeded();
  await expect(locator).toBeInViewport({ ratio: 1 });
  const box = await locator.boundingBox();
  const label = (await locator.getAttribute('aria-label')) || (await locator.innerText());
  expect(box.height, `"${label}" height`).toBeGreaterThanOrEqual(min - 0.5);
  expect(box.width, `"${label}" width`).toBeGreaterThanOrEqual(min - 0.5);
  const onTop = await locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return el === hit || el.contains(hit);
  });
  expect(onTop, `nothing covers "${label}"`).toBe(true);
}

/** Every element matched is on one text line (no mid-word or mid-label breaks). */
export async function expectSingleLine(locator) {
  const n = await locator.count();
  expect(n).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    const info = await locator.nth(i).evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const tops = new Set(
        [...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top)),
      );
      return { lines: tops.size, text: el.textContent.trim() };
    });
    expect(info.lines, `"${info.text}" on one line`).toBeLessThanOrEqual(1);
  }
}

/**
 * Text that is cut off inside `rootSelector`: elements whose content is wider than
 * their box while they hide the overflow (ellipsis counts as intended when the
 * element sets text-overflow: ellipsis and carries a title/aria-label with the
 * full text). Returns [{ text, overflow }] for the caller to assert empty.
 */
export async function clippedText(page, rootSelector) {
  await page.evaluate(() => document.fonts.ready);
  return page.evaluate((sel) => {
    const out = [];
    for (const root of document.querySelectorAll(sel)) {
      for (const el of root.querySelectorAll('*')) {
        if (!el.childNodes.length) continue;
        const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
        if (!hasText) continue;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        const hides = /hidden|clip/.test(cs.overflowX) || /hidden|clip/.test(cs.overflow);
        const over = el.scrollWidth - el.clientWidth;
        if (!hides || over <= 1) continue;
        const labelled = el.title || el.getAttribute('aria-label');
        if (cs.textOverflow === 'ellipsis' && labelled) continue;
        out.push({ text: el.textContent.trim().slice(0, 60), overflow: over });
      }
    }
    return out;
  }, rootSelector);
}

/**
 * Whole boxes of `selector` (visible ones) stay inside the safe area: below the top
 * inset and above the bottom inset. Pass the insets emulated with emulateSafeArea.
 */
export async function expectInsideSafeArea(page, selector, insets = NOTCH_PORTRAIT) {
  const boxes = await page.evaluate((sel) => {
    return [...document.querySelectorAll(sel)]
      .filter((el) => {
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return cs.visibility !== 'hidden' && cs.display !== 'none' && r.width > 0 && r.height > 0;
      })
      .map((el) => {
        const r = el.getBoundingClientRect();
        return {
          label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40),
          top: r.top,
          bottom: r.bottom,
          left: r.left,
          right: r.right,
          vw: innerWidth,
          vh: innerHeight,
        };
      });
  }, selector);
  expect(boxes.length, `${selector} is on screen`).toBeGreaterThan(0);
  for (const b of boxes) {
    expect(b.top, `"${b.label}" clears the notch`).toBeGreaterThanOrEqual(insets.top - 0.5);
    expect(b.bottom, `"${b.label}" clears the home bar`).toBeLessThanOrEqual(
      b.vh - insets.bottom + 0.5,
    );
    expect(b.left, `"${b.label}" clears the left inset`).toBeGreaterThanOrEqual(
      (insets.left || 0) - 0.5,
    );
    expect(b.right, `"${b.label}" clears the right inset`).toBeLessThanOrEqual(
      b.vw - (insets.right || 0) + 0.5,
    );
  }
}

/** Page errors during a test: `const errors = pageErrors(page); … expect(errors).toEqual([])`. */
export function pageErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}
