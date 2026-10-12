// Settings' "This build" card (ui/BuildInfoSection.js): reached from Pause in a battle on a
// phone, it names the commit, the platform and the battle, and Copy hands that text over.
import { test, expect, devices } from '@playwright/test';
import { waitForGame, waitForScene } from './helpers.js';

test.use({ ...devices['iPhone 13'], viewport: { width: 667, height: 375 } });

test('Pause → Settings shows the build and the battle, and Copy copies it', async ({ page }) => {
  // Record what the game copies (the real clipboard needs a permission WebKit lacks).
  await page.addInitScript(() => {
    window.__copied = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (text) => void window.__copied.push(text) },
    });
  });
  await page.goto('/?devScene=battle&preset=battle_smoke&seed=42');
  await waitForGame(page);
  await waitForScene(page, 'Battle');
  await page.waitForFunction(() =>
    ['DEPLOY_SELECTION', 'PLAYER_IDLE'].includes(window.__sceneState?.battle?.state),
  );
  await page.evaluate(() => {
    const b = window.__emblemRogueGame.scene.getScene('Battle');
    if (b.battleState === 'DEPLOY_SELECTION')
      b.children.list
        .filter((o) => o.type === 'Rectangle' && o.input?.enabled && o.listenerCount('pointerdown'))
        .at(-1)
        ?.emit('pointerdown');
  });
  const hud = page.getByRole('complementary', { name: 'Battle commands' });
  await hud.getByRole('button', { name: 'Menu', exact: true }).tap();
  const pause = page.getByRole('dialog', { name: 'Paused' });
  await pause.getByRole('button', { name: 'Settings', exact: true }).tap();
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
  const card = settings.locator('[data-setting="build-info"]');
  await card.scrollIntoViewIfNeeded();
  await expect(card).toBeVisible();
  const text = card.locator('.re-build-info-text');
  await expect(text).toContainText('Rogue Dawn · web (phone)');
  await expect(text).toContainText(/Commit: [0-9a-f]{7} \(built \d{4}-\d{2}-\d{2}\)/);
  await expect(text).toContainText(/Run: First Light · Act [IVX]+\n/);
  await expect(text).toContainText(/turn 1\b/);
  await page.screenshot({ path: test.info().outputPath('build-info.png') });

  await card.getByRole('button', { name: 'Copy build info', exact: true }).tap();
  await expect(card.getByRole('status')).toHaveText('Copied. Paste it into your bug report.');
  const copied = await page.evaluate(() => window.__copied);
  expect(copied).toEqual([await text.textContent()]);
});
