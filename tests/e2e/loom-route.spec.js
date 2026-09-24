import { test, expect, devices } from '@playwright/test';
import { waitForScene, collectErrors } from './helpers.js';

// The route map is drawn as the Loom (RouteGraph + loomThreads). These checks cover the
// presentation contracts the approved study adds: state classes from real run data,
// the act header, compact medals with full hit areas, the inspect card, and an fx loop
// that only runs while the route can be seen and motion is allowed.
test.use({ ...devices['iPhone 13'], viewport: { width: 844, height: 390 } });

async function openRoute(page, width = 844) {
  await page.setViewportSize({ width, height: 390 });
  await page.goto('/?devScene=nodemap&preset=battle_smoke&seed=42&mobilePreview=1');
  await waitForScene(page, 'NodeMap');
  await page.getByRole('button', { name: 'Skip conversation', exact: true }).tap();
  const route = page.locator('.re-node-map');
  await expect(route).toBeVisible();
  return route;
}

const animating = (page) =>
  page.evaluate(
    () => window.__emblemRogueGame.scene.getScene('NodeMap').nodeView.routeGraph.animating,
  );

test('the loom reflects run state, header and inspect card', async ({ page }) => {
  const errors = collectErrors(page);
  const route = await openRoute(page);
  const counts = await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('NodeMap');
    const rm = s.runManager;
    return {
      available: rm.getAvailableNodes().length,
      completed: rm.nodeMap.nodes.filter((n) => n.completed).length,
      current: rm.currentNodeId,
    };
  });
  await expect(route.locator('.re-node.is-live')).toHaveCount(counts.available);
  await expect(route.locator('.re-node.is-current')).toHaveCount(1);
  await expect(route.locator(`.re-node.is-current[data-node="${counts.current}"]`)).toHaveCount(1);
  await expect(route.locator('.re-node.is-live .re-loom-label').first()).toBeVisible();
  // Header: Cinzel act title + pixel subline with the act name and row.
  await expect(route.getByRole('heading', { level: 2 })).toHaveAccessibleName(
    'Act II · Old Kingdom Roads',
  );
  await expect(route.locator('.re-loom-sub')).toHaveText(/OCCUPIED TERRITORY · ROW 2 OF 9/);
  // Pane order: Menu/Roster, inspect card, Travel, lord chips.
  const order = await route
    .locator('.re-node-side > *')
    .evaluateAll((els) => els.map((e) => e.className));
  expect(order[0]).toContain('re-node-actions');
  expect(order[1]).toContain('re-loom-card');
  expect(order[2]).toContain('re-loom-travel');
  expect(order[3]).toContain('re-loom-party');
  // A live choice reads as within reach and enables Travel.
  await route.locator('.re-node.is-live').first().tap();
  await expect(route.locator('.re-loom-state')).toHaveText('Within reach · the next knot');
  await expect(route.getByRole('button', { name: 'Travel', exact: true })).toBeEnabled();
  // A future knot is inspectable but not travelable.
  await route.locator('.re-node.is-future').last().tap();
  await expect(route.locator('.re-loom-state')).toHaveText(/^Possible future/);
  await expect(route.getByRole('button', { name: 'Travel', exact: true })).toBeDisabled();
  // Canvases are sized to the weave.
  const canvas = await route
    .locator('.re-loom-weave')
    .evaluate((c) => ({ w: c.width, h: c.height }));
  expect(canvas.w).toBeGreaterThan(0);
  expect(canvas.h).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('narrow looms use 36px medals inside 48px targets', async ({ page }) => {
  const route = await openRoute(page, 667);
  const sizes = await route.locator('.re-node:not(.is-boss)').evaluateAll((els) =>
    els.map((b) => ({
      button: b.getBoundingClientRect().width,
      // Layout width: the selected medal is additionally scaled by a transform.
      medal: b.querySelector('.re-loom-medal').offsetWidth,
    })),
  );
  for (const s of sizes) {
    expect(s.button).toBeGreaterThanOrEqual(44);
    expect(Math.round(s.medal)).toBe(36);
  }
});

test('fx run only while the route is visible and motion is allowed', async ({ page }) => {
  const route = await openRoute(page);
  await expect.poll(() => animating(page)).toBe(true);
  await route.getByRole('button', { name: 'Roster', exact: true }).tap();
  await expect(page.locator('.mr-sheet')).toBeVisible();
  await expect.poll(() => animating(page)).toBe(false);
  await page.locator('.mr-sheet').getByRole('button', { name: 'Close', exact: true }).tap();
  await expect(route).toBeVisible();
  await expect.poll(() => animating(page)).toBe(true);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => animating(page)).toBe(false);
  await page.evaluate(() => {
    delete document.hidden;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => animating(page)).toBe(true);
  await page.evaluate(() =>
    window.__emblemRogueGame.registry.get('settings').setReduceMotion(true),
  );
  // Reduced motion: one static frame, no loop (the setting is re-read within 500ms).
  await expect.poll(() => animating(page)).toBe(false);
});
