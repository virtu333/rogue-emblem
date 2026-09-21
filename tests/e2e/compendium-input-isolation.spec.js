import { test, expect, devices } from '@playwright/test';
import { waitForScene } from './helpers.js';

test.use({ ...devices['iPhone 13'] });

async function titlePoint(page, index) {
  return page.evaluate((index) => {
    const s = window.__emblemRogueGame.scene.getScene('Title');
    const button = s._menuButtons.at(index);
    const r = s.game.canvas.getBoundingClientRect();
    return {
      x: r.x + (button.x * r.width) / s.scale.width,
      y: r.y + (button.y * r.height) / s.scale.height,
    };
  }, index);
}

for (const width of [667, 844]) {
  for (const input of ['touch', 'mouse']) {
    test(`Compendium isolates ${input} from the title at ${width}px and restores controls`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 375 });
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.addInitScript(() => localStorage.setItem('emblem_rogue_slot_1_meta', '{}'));
      await page.goto('/?devScene=title&mobilePreview=1');
      await waitForScene(page, 'Title');
      const press = async (target, options) =>
        input === 'touch' ? target.tap(options) : target.click(options);
      const pressPoint = async (p) =>
        input === 'touch' ? page.touchscreen.tap(p.x, p.y) : page.mouse.click(p.x, p.y);
      await pressPoint(await titlePoint(page, -1));
      const dialog = page.getByRole('dialog', { name: 'Compendium', exact: true });
      await expect(dialog).toBeVisible();
      // Observe Phaser input itself: a title-only guard must not mask an event leak.
      await page.evaluate(() => {
        const s = window.__emblemRogueGame.scene.getScene('Title');
        s._testCoveredDowns = 0;
        s.input.on('pointerdown', () => s._testCoveredDowns++);
      });
      await press(dialog.getByRole('button', { name: 'Lords', exact: true }));
      for (const name of ['Edric', 'Kira', 'Voss', 'Sera', 'Rowan', 'Astrid', 'Cael']) {
        const row = dialog
          .locator('[aria-label="Entries"]')
          .getByRole('button', { name, exact: true });
        await expect(row).toBeVisible();
        const box = await row.boundingBox();
        await press(row, { position: { x: box.width - 8, y: box.height / 2 } });
        await expect(dialog.locator('.re-reference-detail h3')).toHaveText(name);
        expect(
          await page.evaluate(() => {
            const s = window.__emblemRogueGame.scene.getScene('Title');
            return {
              scene: window.__sceneState.activeScene,
              transitioning: s.isTransitioning,
              coveredDowns: s._testCoveredDowns,
            };
          }),
        ).toEqual({ scene: 'Title', transitioning: false, coveredDowns: 0 });
      }
      await dialog.getByRole('searchbox').fill('Sera');
      await expect(dialog.locator('.re-reference-detail h3')).toHaveText('Sera');
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await pressPoint(await titlePoint(page, 1));
      await waitForScene(page, 'SlotPicker');
      expect(errors).toEqual([]);
    });
  }
}
