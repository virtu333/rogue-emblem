import { test, expect } from '@playwright/test';
import { waitForScene } from './helpers.js';
test.use({
  viewport: { width: 667, height: 375 },
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
  reducedMotion: 'reduce',
});
test('phone settings persist independently and cut-ins remain readable across quality modes', async ({
  page,
}, info) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?devScene=battle&preset=combat_actions&seed=42&mobilePreview=1&battleLab=1');
  await waitForScene(page, 'Battle');
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'PLAYER_IDLE',
  );
  expect(
    await page.evaluate(() => {
      const settings = window.__emblemRogueGame.registry.get('settings');
      return [settings.getReduceMotion(), settings.getEffectsQuality()];
    }),
  ).toEqual([true, 'high']);
  await page.evaluate(async () => {
    const { SettingsOverlay } = await import('/src/ui/SettingsOverlay.js');
    window.testSettings = new SettingsOverlay(window.__emblemRogueGame.scene.getScene('Battle'));
    window.testSettings.show();
  });
  await expect(page.getByRole('button', { name: 'Reduce motion · On', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Effects quality · High', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reduce motion · On', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Reduce motion · On', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Effects quality · Low', exact: true }),
  ).toBeVisible();
  await page.getByText('Low simplifies visual effects.', { exact: false }).scrollIntoViewIfNeeded();
  await expect(page.getByText('Low simplifies visual effects.', { exact: false })).toBeVisible();
  await page.screenshot({ path: info.outputPath('effects-settings-small-phone.png') });
  await page.keyboard.press('Escape');
  await page.reload();
  await waitForScene(page, 'Battle');
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'PLAYER_IDLE',
  );
  expect(
    await page.evaluate(() => {
      const settings = window.__emblemRogueGame.registry.get('settings');
      return [settings.getReduceMotion(), settings.getEffectsQuality()];
    }),
  ).toEqual([false, 'low']);
  for (const [motion, quality] of [
    [false, 'high'],
    [true, 'high'],
    [false, 'low'],
  ]) {
    await page.evaluate(
      async ({ motion, quality }) => {
        const s = window.__emblemRogueGame.scene.getScene('Battle');
        s.registry.get('settings').setReduceMotion(motion);
        s.registry.get('settings').setEffectsQuality(quality);
        const { ProcBannerController } = await import('/src/ui/ProcBannerController.js');
        const c = new ProcBannerController(s);
        // Hold the actual rendered strip for a screenshot, without changing its rendering.
        const delay = s._awaitSceneDelay;
        s._awaitSceneDelay = (ms, opts) =>
          delay.call(s, opts?.label === 'proc_cutin_hold' ? 1200 : ms, opts);
        window.cutinFinished = false;
        c.showCutIn({
          unit: s.playerUnits[0],
          unitName: 'Edric',
          weaponName: s.playerUnits[0].weapon?.name,
          portraitKey: s._getPortraitKey(s.playerUnits[0]),
          label: 'CRITICAL HIT',
          category: 'offense',
          side: 'left',
        }).finally(() => {
          s._awaitSceneDelay = delay;
          c.destroy();
          window.cutinFinished = true;
        });
      },
      { motion, quality },
    );
    // The DOM cut-in: readable word, fully in, and static when motion is reduced.
    const cutIn = page.locator('.ce-cutin-layer');
    await expect(cutIn.locator('.ce-cutin-big')).toHaveText('CRITICAL');
    await page.waitForFunction(() => {
      const layer = document.querySelector('.ce-cutin-layer');
      return Number(layer?.style.getPropertyValue('--ce-in')) === 1;
    });
    expect(await cutIn.evaluate((el) => el.classList.contains('is-static'))).toBe(
      motion || quality === 'low',
    );
    const box = await cutIn.locator('.ce-cutin-big').boundingBox();
    expect(box.width).toBeGreaterThan(80);
    await page.screenshot({ path: info.outputPath(`cutin-${motion}-${quality}.png`) });
    await page.waitForFunction(() => window.cutinFinished);
    await expect(cutIn).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});
