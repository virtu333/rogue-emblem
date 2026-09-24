import { test, expect } from '@playwright/test';
test('production mobile bundle boots offline and uses rebuilt battle art without lab flags', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const external = [];
  await page.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (
      ['http:', 'https:'].includes(u.protocol) &&
      !['127.0.0.1', 'localhost'].includes(u.hostname)
    ) {
      external.push(u.hostname);
      return route.abort();
    }
    return route.continue();
  });
  await page.goto('/');
  await page.waitForFunction(() => window.__emblemRogueGame?.scene?.isActive('Title'));
  // The production title is the DOM key-art screen: the art must mount from the
  // bundle (no network), then New Game is a real 44px button.
  await expect(page.locator('.re-title-art.re-keyart-ready canvas')).toHaveCount(1);
  const newGame = page.getByRole('button', { name: 'New Game', exact: true });
  await expect(newGame).toBeVisible();
  await newGame.tap();
  await page.waitForFunction(() => window.__emblemRogueGame.scene.isActive('NodeMap'));
  // The first-run fast path intentionally starts here; advance the visible narrative.
  for (let i = 0; i < 24; i++) {
    await page.waitForTimeout(200);
    if (await page.locator('.re-node-map').isVisible()) break;
    const hintContinue = page
      .getByRole('dialog', { name: 'Field notes', exact: true })
      .locator('.re-menu-body')
      .getByRole('button', { name: 'Continue', exact: true });
    if (await hintContinue.isVisible()) {
      await page.waitForTimeout(550);
      await hintContinue.tap();
      continue;
    }
    const next = page.getByRole('button', { name: 'Continue', exact: true });
    if (await next.isVisible()) {
      await next.tap();
      continue;
    }
    const hint = await page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('NodeMap');
      const target = s.children.list.find((o) => o.depth === 965 && o.input?.enabled);
      if (!target) return null;
      const b = target.getBounds(),
        r = s.game.canvas.getBoundingClientRect();
      return {
        x: r.x + (b.centerX * r.width) / s.scale.width,
        y: r.y + (b.centerY * r.height) / s.scale.height,
      };
    });
    if (hint) await page.touchscreen.tap(hint.x, hint.y);
  }
  await expect(page.locator('.re-node-map')).toBeVisible();
  const nodeId = await page.evaluate(
    () =>
      window.__emblemRogueGame.scene
        .getScene('NodeMap')
        .runManager.getAvailableNodes()
        .find((n) => n.type === 'battle').id,
  );
  await page.locator(`[data-node="${nodeId}"]`).tap();
  await page.getByRole('button', { name: 'Travel', exact: true }).tap();
  await page.waitForFunction(() => window.__emblemRogueGame.scene.isActive('Battle'));
  await expect(page.locator('#game-wrapper')).toHaveAttribute('data-terrain-art', 'procedural');
  await expect
    .poll(() =>
      page.evaluate(() => {
        const s = window.__emblemRogueGame.scene.getScene('Battle');
        return s.playerUnits?.some((u) => u.graphic?.texture?.key?.startsWith('contrast-rebuilt-'));
      }),
    )
    .toBe(true);
  expect(
    await page.evaluate(() => window.__emblemRogueGame.registry.get('cloud') || null),
  ).toBeNull();
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
  await page.screenshot({ path: 'test-results-release/production-battle.png' });
  // Exercise the actual production CSS after the battle/menu chunks have loaded.
  await page.setViewportSize({ width: 667, height: 390 });
  expect(
    await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--re-t-display').trim(),
    ),
  ).toMatch(/^13px/);
  // First-turn Field notes are scheduled after the turn banner and can queue
  // more than one. A single isVisible() check raced them: a note opened just
  // after it and its modal shield swallowed the Compendium tap below. Dismiss
  // notes until none has appeared for a quiet window, then open pause.
  const battleHint = page
    .getByRole('dialog', { name: 'Field notes', exact: true })
    .locator('.re-menu-body')
    .getByRole('button', { name: 'Continue', exact: true });
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Battle')?.battleState === 'PLAYER_IDLE',
  );
  let quietSince = Date.now();
  while (Date.now() - quietSince < 2500) {
    if (await battleHint.isVisible()) {
      await page.waitForTimeout(550);
      // The next queued note may open in the same dialog immediately.
      await battleHint.tap();
      quietSince = Date.now();
    }
    await page.waitForTimeout(150);
  }
  await page.evaluate(() => window.__emblemRogueGame.scene.getScene('Battle').showPauseMenu());
  const resume = page.getByRole('button', { name: 'Resume', exact: true });
  await expect(resume).toBeVisible();
  const contrast = await resume.evaluate((el) => {
    const style = getComputedStyle(el);
    const luminance = (color) => {
      const rgb = color
        .match(/[\d.]+/g)
        .slice(0, 3)
        .map(Number)
        .map((v) => {
          const c = v / 255;
          return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        });
      return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
    };
    const a = luminance(style.color),
      b = luminance(style.backgroundColor);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  });
  expect(contrast).toBeGreaterThanOrEqual(4.5);
  await page.getByRole('button', { name: 'Compendium', exact: true }).tap();
  await page.getByRole('searchbox').fill('Iron Sword');
  await expect(page.locator('.re-reference-detail')).toContainText('Iron Sword');
  // Tokens survive opening a second lazy scene/overlay in the built bundle.
  expect(
    await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--re-t-display').trim(),
    ),
  ).toMatch(/^13px/);
});
