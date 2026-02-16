// E2E: Mobile viewport smoke tests.
// Verifies that bottom-anchored UI elements remain within the visible
// viewport on mobile devices (iPhone Safari landscape).
//
// NOTE: These tests run in Chromium, not WebKit/iOS Safari.
// The actual 100vh vs 100dvh viewport bug is iOS Safari-specific and
// cannot be reproduced in any desktop browser engine. These tests guard
// against CSS regressions and y-coordinate violations, but real iOS
// device testing is required for full validation of the viewport fixes.

import { test, expect, devices } from '@playwright/test';
import {
  waitForGame,
  waitForScene,
  collectErrors,
  attachSceneCrashArtifacts,
} from './helpers.js';

// iPhone 13 landscape: 844×390 viewport, touch events
const iPhone = devices['iPhone 13'];
const landscape = {
  ...iPhone,
  viewport: { width: 844, height: 390 },
  isMobile: true,
  hasTouch: true,
};

test.use(landscape);

test.afterEach(async ({ page }, testInfo) => {
  await attachSceneCrashArtifacts(page, testInfo);
});

// --- Helpers ---

/**
 * Scan all interactive game objects in a Phaser scene for bound violations.
 * Three-tier check (all use world-space getBounds()):
 *   Tier 1 (anchor): center-y must be <= safeAnchorY
 *   Tier 2 (y-overflow): bottom edge must be <= canvasH
 *   Tier 3 (x-bounds): left >= 0 and right <= canvasW
 *
 * Walks containers recursively, respects inherited visibility, uses a
 * seen-set to prevent infinite loops on circular references.
 *
 * Only checks objects with pointerdown listeners (actual buttons/links),
 * skipping hover-only targets like tooltip triggers.
 */
async function scanInteractiveViolations(page, sceneKey, safeAnchorY, canvasW = 640, canvasH = 480) {
  return page.evaluate(({ sceneKey, safeAnchorY, canvasW, canvasH }) => {
    const game = window.__emblemRogueGame;
    const scene = game?.scene?.getScene?.(sceneKey);
    if (!scene) return [`Scene "${sceneKey}" not found`];

    const violations = [];
    const seen = new Set();

    function walk(obj, parentVisible) {
      if (!obj || seen.has(obj)) return;
      seen.add(obj);

      const isVisible = parentVisible && obj.visible !== false;

      // Check clickable interactive objects (with pointerdown listeners).
      // This skips hover-only tooltip targets (progress bars, etc.)
      if (isVisible && obj.input?.enabled && obj.listenerCount?.('pointerdown') > 0) {
        const name = obj.name || obj.text?.substring?.(0, 20) || obj.type || '?';
        try {
          const b = obj.getBounds();
          if (b) {
            const centerY = b.y + b.height / 2;
            const bottom = b.bottom ?? (b.y + b.height);
            const left = b.x ?? b.left ?? 0;
            const right = b.right ?? (b.x + b.width);

            // Tier 1: world-space center must be in safe zone
            if (centerY > safeAnchorY) {
              violations.push(`anchor: ${name} (centerY=${Math.round(centerY)}, limit=${safeAnchorY})`);
            }
            // Tier 2: nothing overflows the canvas vertically
            if (bottom > canvasH) {
              violations.push(`y-overflow: ${name} (bottom=${Math.round(bottom)}, limit=${canvasH})`);
            }
            // Tier 3: nothing cut off or overflows horizontally
            if (left < 0) {
              violations.push(`x-cutoff: ${name} (left=${Math.round(left)})`);
            }
            if (right > canvasW) {
              violations.push(`x-overflow: ${name} (right=${Math.round(right)}, limit=${canvasW})`);
            }
          }
        } catch (_) { /* destroyed or no getBounds */ }
      }

      // Recurse into container children
      if (Array.isArray(obj.list)) {
        for (const child of obj.list) walk(child, isVisible);
      }
    }

    for (const obj of scene.children.list) walk(obj, true);
    return violations;
  }, { sceneKey, safeAnchorY, canvasW, canvasH });
}

// Known non-critical elements that intentionally live below SAFE_BOTTOM_Y.
// These are decorative/informational, not primary action buttons.
const KNOWN_ANCHOR_EXCEPTIONS = [
  'GITHUB', // Title scene footer link (y≈464)
];

/**
 * Filter out known non-critical anchor violations.
 * Only anchor: violations can be filtered; y-overflow, x-cutoff, and
 * x-overflow violations are always preserved.
 */
function filterKnownExceptions(violations) {
  return violations.filter((v) => {
    if (!v.startsWith('anchor:')) return true; // only filter anchor violations
    return !KNOWN_ANCHOR_EXCEPTIONS.some((name) => v.includes(name));
  });
}

/**
 * Advance past DEPLOY_SELECTION to PLAYER_IDLE using scene-level API.
 * (Adapted from battle-invariants.spec.js)
 */
async function advancePastDeploy(page) {
  await page.evaluate(() => {
    const game = window.__emblemRogueGame;
    const battle = game?.scene?.getScene?.('Battle');
    if (!battle || battle.battleState !== 'DEPLOY_SELECTION') return;

    const objects = battle.children?.list || [];
    const interactiveRects = objects.filter(
      (obj) =>
        obj?.type === 'Rectangle' &&
        obj.input?.enabled === true &&
        obj.listenerCount?.('pointerdown') > 0,
    );
    const confirmBtn = interactiveRects[interactiveRects.length - 1];
    if (confirmBtn) confirmBtn.emit('pointerdown');
  });
}

/**
 * Wait for battle to reach PLAYER_IDLE, advancing through deploy if needed.
 */
async function ensurePlayerIdle(page) {
  const PAUSE_OPENABLE = ['PLAYER_IDLE', 'DEPLOY_SELECTION'];
  await page.waitForFunction(
    (allowed) => allowed.includes(window.__sceneState?.battle?.state),
    PAUSE_OPENABLE,
    { timeout: 15_000 },
  );

  const state = await page.evaluate(() => window.__sceneState?.battle?.state);
  if (state === 'DEPLOY_SELECTION') {
    await advancePastDeploy(page);
    await page.waitForFunction(
      () => window.__sceneState?.battle?.state === 'PLAYER_IDLE',
      null,
      { timeout: 12_000 },
    );
  }
}

// --- Tests ---

test.describe('Mobile viewport — bottom buttons visibility', () => {
  test('CSS includes dvh viewport units and touch-action', async ({ page }) => {
    await page.goto('/');
    await waitForGame(page);

    // Verify touch-action: manipulation on game-wrapper
    const touchAction = await page.locator('#game-wrapper').evaluate(
      (el) => getComputedStyle(el).touchAction,
    );
    expect(touchAction).toBe('manipulation');

    // Verify the stylesheet source contains 100dvh (not just 100vh)
    const hasDvh = await page.evaluate(() => {
      for (const sheet of document.styleSheets) {
        try {
          for (const rule of sheet.cssRules) {
            if (rule.cssText?.includes('100dvh')) return true;
          }
        } catch (_) { /* cross-origin sheets */ }
      }
      return false;
    });
    expect(hasDvh).toBe(true);
  });

  test('mobile landscape activates flex layout on game-wrapper', async ({ page }) => {
    await page.goto('/');
    await waitForGame(page);
    await waitForScene(page, 'Title');

    const wrapperDisplay = await page.locator('#game-wrapper').evaluate(
      (el) => getComputedStyle(el).display,
    );
    expect(wrapperDisplay).toBe('flex');

    const container = page.locator('#game-container');
    await expect(container).toBeAttached();
  });

  test('Title scene within safe y-bounds', async ({ page }) => {
    const errors = collectErrors(page);

    await page.goto('/');
    await waitForGame(page);
    await waitForScene(page, 'Title');

    // Wait for button entry animations to settle
    await page.waitForTimeout(2500);

    const violations = await scanInteractiveViolations(page, 'Title', 425);
    const critical = filterKnownExceptions(violations);
    expect(critical).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('HomeBase, NodeMap, BlessingSelect within safe y-bounds', async ({ page }) => {
    const errors = collectErrors(page);

    // --- HomeBase ---
    await page.goto('/?devScene=homebase&preset=fresh');
    await waitForGame(page);
    await waitForScene(page, 'HomeBase');
    await page.waitForTimeout(500);

    const homeViolations = await scanInteractiveViolations(page, 'HomeBase', 425);
    const homeCritical = filterKnownExceptions(homeViolations);
    expect(homeCritical).toEqual([]);

    // --- NodeMap ---
    await page.goto('/?devScene=nodemap&preset=weapon_arts');
    await waitForGame(page);
    await waitForScene(page, 'NodeMap');
    await page.waitForTimeout(500);

    const nodeViolations = await scanInteractiveViolations(page, 'NodeMap', 425);
    const nodeCritical = filterKnownExceptions(nodeViolations);
    expect(nodeCritical).toEqual([]);

    // --- BlessingSelect ---
    await page.goto('/?devScene=blessing&preset=fresh');
    await waitForGame(page);
    await waitForScene(page, 'BlessingSelect');
    await page.waitForTimeout(500);

    const blessViolations = await scanInteractiveViolations(page, 'BlessingSelect', 425);
    const blessCritical = filterKnownExceptions(blessViolations);
    expect(blessCritical).toEqual([]);

    expect(errors).toEqual([]);
  });

  test('Mobile button containment and tap routing in Battle', async ({ page }) => {
    const errors = collectErrors(page);

    // --- CSS containment checks ---
    await page.goto('/');
    await waitForGame(page);

    const overflow = await page.locator('#game-container').evaluate(
      (el) => getComputedStyle(el).overflow,
    );
    expect(overflow).toBe('hidden');

    const panelZIndex = await page.evaluate(() => {
      const panel = document.querySelector('.mobile-panel');
      return panel ? getComputedStyle(panel).zIndex : null;
    });
    if (panelZIndex !== null) {
      expect(Number(panelZIndex)).toBeGreaterThan(0);
    }

    // --- Battle scene: DOM button positions + danger toggle tap ---
    await page.goto('/?devScene=battle&preset=battle_smoke');
    await waitForGame(page);
    await waitForScene(page, 'Battle');
    await ensurePlayerIdle(page);

    // All visible mobile buttons must be within viewport height
    const btnPositions = await page.evaluate(() => {
      const btns = document.querySelectorAll('.mobile-btn');
      const results = [];
      for (const btn of btns) {
        if (btn.offsetParent === null) continue; // hidden
        const action = btn.dataset.action || btn.textContent?.trim();
        const rect = btn.getBoundingClientRect();
        if (rect.bottom > window.innerHeight) {
          results.push(`${action} bottom=${Math.round(rect.bottom)} vH=${window.innerHeight}`);
        }
        if (rect.left < 0) {
          results.push(`${action} left=${Math.round(rect.left)}`);
        }
        if (rect.right > window.innerWidth) {
          results.push(`${action} right=${Math.round(rect.right)} vW=${window.innerWidth}`);
        }
      }
      return results;
    });
    expect(btnPositions).toEqual([]);

    // Danger zone starts hidden
    const dangerBefore = await page.evaluate(
      () => window.__sceneState?.overlays?.dangerZone === true,
    );
    expect(dangerBefore).toBe(false);

    // Tap the danger button
    const dangerBtn = page.locator('button[data-action="danger"]');
    await dangerBtn.tap();

    // Danger zone should toggle on
    await page.waitForFunction(
      () => window.__sceneState?.overlays?.dangerZone === true,
      null,
      { timeout: 5_000 },
    );

    expect(errors).toEqual([]);
  });
});
