import { test, expect, devices } from '@playwright/test';
import { waitForScene } from './helpers.js';
test.use({ ...devices['iPhone SE'], viewport: { width: 667, height: 375 } });
const entries = [{ speaker: 'Sera', line: 'The old road leads north.' }];
async function show(page, lines = entries, category = 'actTransition') {
  await page.evaluate(
    ({ lines, category }) => {
      window.storyComplete = false;
      window.storyOverlay.showSequence(lines, { category, key: 'act1_to_act2' }).then(() => {
        window.storyComplete = true;
      });
    },
    { lines, category },
  );
}
test('seen dialogue is opt-in, variant-sensitive and safe on shutdown', async ({ page }, info) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/?devScene=battle&preset=combat_actions&seed=42&mobilePreview=1&battleLab=1');
  await waitForScene(page, 'Battle');
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'PLAYER_IDLE',
  );
  await page.evaluate(async () => {
    const scene = window.__emblemRogueGame.scene.getScene('Battle');
    const { MetaProgressionManager } = await import('/src/engine/MetaProgressionManager.js');
    const { DialogueOverlay } = await import('/src/ui/DialogueOverlay.js');
    scene.registry.set('meta', new MetaProgressionManager([], 'story_e2e_meta'));
    window.storyOverlay = new DialogueOverlay(scene);
  });
  expect(
    await page.evaluate(() =>
      window.__emblemRogueGame.scene
        .getScene('Battle')
        .registry.get('settings')
        .getSkipSeenDialogue(),
    ),
  ).toBe(false);
  const dialog = page.getByRole('dialog', { name: 'Sera', exact: true });
  await show(page);
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Continue', exact: true }).tap();
  await page.waitForFunction(() => window.storyComplete);
  await show(page);
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Continue', exact: true }).tap();
  await page.waitForFunction(() => window.storyComplete);
  // Use the actual Settings control rather than changing its backing data.
  await page.evaluate(async () => {
    const { SettingsMenu } = await import('/src/ui/SettingsMenu.js');
    const scene = window.__emblemRogueGame.scene.getScene('Battle');
    const settings = new SettingsMenu(scene, () => settings.destroy());
  });
  await page.getByRole('button', { name: 'Skip seen dialogue · Off', exact: true }).tap();
  await expect(
    page.getByRole('button', { name: 'Skip seen dialogue · On', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('dialog', { name: 'Settings', exact: true })
    .getByRole('button', { name: 'Close', exact: true })
    .tap();
  await show(page);
  await page.waitForFunction(() => window.storyComplete);
  await expect(dialog).toHaveCount(0);
  await show(page, [{ ...entries[0], line: 'A new road leads south.' }]);
  await expect(dialog).toBeVisible();
  await page.screenshot({ path: info.outputPath('new-story-variant.png') });
  await dialog.getByRole('button', { name: 'Continue', exact: true }).tap();
  await page.waitForFunction(() => window.storyComplete);
  await show(page, entries, 'boss');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Continue', exact: true }).tap();
  await page.waitForFunction(() => window.storyComplete);
  const before = await page.evaluate(
    () => JSON.parse(localStorage.getItem('story_e2e_meta')).seenDialogueKeys,
  );
  await show(page, [{ ...entries[0], line: 'An interrupted tale.' }]);
  await expect(dialog).toBeVisible();
  await page.evaluate(() => window.__emblemRogueGame.scene.stop('Battle'));
  await page.waitForFunction(() => window.storyComplete);
  await expect(dialog).toHaveCount(0);
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('story_e2e_meta')).seenDialogueKeys),
  ).toEqual(before);
  expect(errors).toEqual([]);
});
