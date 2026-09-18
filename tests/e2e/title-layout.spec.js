import { test, expect, devices } from '@playwright/test';
import { waitForScene } from './helpers.js';

test.use({ ...devices['iPhone 13'], viewport: { width: 844, height: 390 } });
test('title selection keeps separate menu rows and opens help by touch', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('emblem_rogue_slot_1_meta', '{}'));
  await page.goto('/?devScene=title&mobilePreview=1');
  await waitForScene(page, 'Title');
  await page.waitForFunction(() => {
    const buttons = window.__emblemRogueGame.scene.getScene('Title')._menuButtons;
    return buttons?.length === 6 && buttons.every((b) => b.alpha === 1);
  });
  for (const width of [844, 667]) {
    await page.setViewportSize({ width, height: 390 });
    expect(
      await page.evaluate(() => {
        const s = window.__emblemRogueGame.scene.getScene('Title');
        return s.children.list
          .filter((o) => o.type === 'Text')
          .every((o) => o.frame.source.resolution === o.style.resolution);
      }),
    ).toBe(true);
    const metrics = await page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('Title');
      const buttons = s._menuButtons;
      return buttons.map((b) => ({ y: b.y, height: b._hitZone.height }));
    });
    for (let i = 1; i < metrics.length; i++) {
      expect(
        metrics[i].y - metrics[i - 1].y - (metrics[i].height + metrics[i - 1].height) / 2,
      ).toBeGreaterThanOrEqual(6);
    }
    expect(metrics.at(-1).y + metrics.at(-1).height / 2).toBeLessThan(460);
    await page.screenshot({ path: `test-results/title-layout-${width}.png` });
  }
  const point = await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Title');
    const b = s._menuButtons[2];
    const r = s.game.canvas.getBoundingClientRect();
    return { x: r.x + (b.x * r.width) / s.scale.width, y: r.y + (b.y * r.height) / s.scale.height };
  });
  await page.touchscreen.tap(point.x, point.y);
  await expect(page.getByRole('dialog', { name: 'How to play', exact: false })).toBeVisible();
});
