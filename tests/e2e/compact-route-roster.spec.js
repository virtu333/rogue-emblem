import { test, expect } from '@playwright/test';
import { waitForScene } from './helpers.js';

test('horizontal route retains selection and scroll through roster on landscape phones', async ({
  page,
}, testInfo) => {
  await page.goto('/?devScene=nodemap&preset=battle_smoke&seed=42&mobilePreview=1');
  await waitForScene(page, 'NodeMap');
  await page.getByRole('button', { name: 'Skip conversation', exact: true }).tap();
  const route = page.locator('.re-node-map');
  await expect(route).toBeVisible();
  const scroll = page.locator('.re-node-scroll');
  expect(await scroll.evaluate((e) => e.scrollHeight - e.clientHeight)).toBeLessThanOrEqual(1);
  const future = route.locator('.re-node.is-future').first();
  expect(await future.evaluate((e) => Number(getComputedStyle(e).opacity))).toBeLessThan(0.7);
  const nodes = route.locator('.re-node');
  expect(
    await nodes.first().evaluate((e) => e.getBoundingClientRect().width),
  ).toBeGreaterThanOrEqual(44);
  expect(await route.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
  if (page.viewportSize().width < 700) {
    const graphBox = await scroll.boundingBox();
    const panelBox = await page.locator('.re-node-side').boundingBox();
    expect(panelBox.y).toBeGreaterThanOrEqual(graphBox.y + graphBox.height);
  }
  const boss = route.locator('.re-node[aria-label^="Boss battle"]').last();
  await boss.tap();
  await expect(boss).toHaveAttribute('aria-pressed', 'true');
  const left = await scroll.evaluate((e) => e.scrollLeft);
  await route.getByRole('button', { name: 'Roster', exact: true }).tap();
  const roster = page.locator('.mr-sheet');
  await expect(roster).toBeVisible();
  expect(await roster.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
  await expect(
    roster.locator('header').getByRole('button', { name: 'Equipment', exact: true }),
  ).toBeVisible();
  for (const b of await roster.locator('header button').all()) {
    expect((await b.boundingBox()).height).toBeGreaterThanOrEqual(44);
  }
  await page.screenshot({ path: `test-results/compact-roster-${testInfo.project.name}.png` });
  await roster.getByRole('button', { name: 'Close', exact: true }).tap();
  await expect(route).toBeVisible();
  await expect(boss).toHaveAttribute('aria-pressed', 'true');
  expect(await scroll.evaluate((e) => e.scrollLeft)).toBeCloseTo(left, 0);
  await page.screenshot({ path: `test-results/compact-route-${testInfo.project.name}.png` });
});
