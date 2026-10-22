import { test, expect, devices } from '@playwright/test';
import { waitForGame, waitForScene } from './helpers.js';

// Redraw road (docs/specs/route-redraw.md) lives in the route map's pause menu: the entry says
// its price and what is left, every pause action still fits a landscape phone, and a redraw
// spends the Valor, counts against the run's five and says so.
test.use({ ...devices['iPhone 13'], viewport: { width: 667, height: 375 } });

async function routeMap(page, valor) {
  await page.goto('/?devScene=nodemap&preset=fresh&seed=42');
  await waitForGame(page);
  await waitForScene(page, 'NodeMap');
  await page.getByRole('button', { name: 'Skip conversation', exact: true }).tap();
  await expect(page.locator('.re-node-map')).toBeVisible();
  await page.waitForFunction(() => {
    const s = window.__emblemRogueGame.scene.getScene('NodeMap');
    return Boolean(s?.nodeView && s.registry.get('meta'));
  });
  await page.evaluate((amount) => {
    const meta = window.__emblemRogueGame.scene.getScene('NodeMap').registry.get('meta');
    meta.addValor(amount - meta.getTotalValor());
  }, valor);
  await page.getByRole('button', { name: 'Menu', exact: true }).tap();
  const pause = page.getByRole('dialog', { name: 'Paused' });
  await expect(pause).toBeVisible();
  return pause;
}

test('Redraw road is a pause menu entry that pays, counts and says what is left', async ({
  page,
}) => {
  const pause = await routeMap(page, 1000);
  const entry = pause.getByRole('button', { name: /Redraw road/ });
  await expect(entry).toContainText('300 Valor · 5 left');
  await expect(entry).not.toHaveAttribute('aria-disabled', 'true');
  // The route map's rail keeps Menu and Roster alone.
  expect(await page.locator('.re-node-actions .re-btn').count()).toBe(2);
  expect(
    await pause.locator('.mp-actions').evaluate((e) => ({
      scrolls: e.scrollHeight > e.clientHeight + 1,
      allInView: [...e.querySelectorAll('button')].every((b) => {
        const r = b.getBoundingClientRect();
        return r.top >= 0 && r.bottom <= window.innerHeight;
      }),
    })),
  ).toEqual({ scrolls: false, allInView: true });
  await page.screenshot({ path: 'test-results/route-redraw-pause.png' });

  const ahead = () =>
    page.evaluate(() => {
      const rm = window.__emblemRogueGame.scene.getScene('NodeMap').runManager;
      return JSON.stringify(rm.nodeMap.nodes.map((n) => [n.id, n.type]));
    });
  const before = await ahead();
  await entry.tap();
  await expect(pause).toBeHidden();
  const confirm = page.getByRole('button', { name: 'Redraw · 300 Valor' });
  await expect(confirm).toBeVisible();
  await page.screenshot({ path: 'test-results/route-redraw-confirm.png' });
  await confirm.tap();
  await expect(
    page.getByRole('status').filter({ hasText: 'The road ahead is redrawn.' }),
  ).toContainText('4 redraws left.');
  const after = await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('NodeMap');
    return { valor: s.registry.get('meta').getTotalValor(), redraws: s.runManager.routeRedraws };
  });
  expect(after).toEqual({ valor: 700, redraws: 1 });
  expect(await ahead()).not.toBe(before);

  await page.getByRole('button', { name: 'Menu', exact: true }).tap();
  await expect(
    page.getByRole('dialog', { name: 'Paused' }).getByRole('button', { name: /Redraw road/ }),
  ).toContainText('400 Valor · 4 left');
});

test('Short of Valor, the entry is greyed with the reason and opens nothing', async ({ page }) => {
  const pause = await routeMap(page, 120);
  const entry = pause.getByRole('button', { name: /Redraw road/ });
  await expect(entry).toContainText('Need 300 Valor (you have 120).');
  await expect(entry).toHaveAttribute('aria-disabled', 'true');
  // aria-disabled keeps it focusable (its reason is read), so a tap still lands on it.
  await entry.tap({ force: true });
  await expect(pause).toBeVisible();
  await expect(page.getByRole('button', { name: /Redraw · / })).toHaveCount(0);
  expect(
    await page.evaluate(
      () => window.__emblemRogueGame.scene.getScene('NodeMap').runManager.routeRedraws,
    ),
  ).toBe(0);
});
