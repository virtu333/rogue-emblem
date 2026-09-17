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
  await page.waitForTimeout(1300);
  const p = await page.evaluate(() => {
    const g = window.__emblemRogueGame,
      s = g.scene.getScene('Title');
    const walk = (nodes) =>
      nodes.flatMap((o) => [o, ...(Array.isArray(o.list) ? walk(o.list) : [])]);
    const b = walk(s.children.list)
        .find((o) => o.text === 'NEW GAME')
        .getBounds(),
      r = g.canvas.getBoundingClientRect();
    return {
      x: r.x + (b.centerX * r.width) / s.scale.width,
      y: r.y + (b.centerY * r.height) / s.scale.height,
    };
  });
  await page.touchscreen.tap(p.x, p.y);
  await page.waitForFunction(() => window.__emblemRogueGame.scene.isActive('NodeMap'));
  // The first-run fast path intentionally starts here; advance narrative using touch Cancel.
  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(200);
    if (await page.evaluate(() => window.__emblemRogueGame.scene.getScene('NodeMap').isSceneReady))
      break;
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
    else await page.locator('#mobile-left-panel [data-action=cancel]').tap();
  }
  const battlePoint = await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('NodeMap'),
      rm = s.runManager;
    const n = rm.getAvailableNodes().find((n) => n.type === 'battle');
    const max = Math.max(...rm.nodeMap.nodes.map((n) => n.row));
    const r = s.game.canvas.getBoundingClientRect();
    return {
      x: r.x + ((80 + n.col * 120) * r.width) / 640,
      y: r.y + ((60 + (1 - n.row / Math.max(1, max)) * 322) * r.height) / 480,
    };
  });
  await page.touchscreen.tap(battlePoint.x, battlePoint.y);
  await page.touchscreen.tap(battlePoint.x, battlePoint.y);
  await page.waitForFunction(() => window.__emblemRogueGame.scene.isActive('Battle'));
  await expect(page.locator('#game-wrapper')).toHaveAttribute('data-terrain-art', 'weathered');
  await expect
    .poll(() =>
      page.evaluate(() => {
        const s = window.__emblemRogueGame.scene.getScene('Battle');
        return s.playerUnits?.some((u) => u.graphic?.texture?.key?.startsWith('rebuilt-'));
      }),
    )
    .toBe(true);
  expect(
    await page.evaluate(() => window.__emblemRogueGame.registry.get('cloud') || null),
  ).toBeNull();
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
  await page.screenshot({ path: 'test-results-release/production-battle.png' });
});
