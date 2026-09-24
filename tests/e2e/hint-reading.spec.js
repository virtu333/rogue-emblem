import { test, expect, devices } from '@playwright/test';
import { waitForScene } from './helpers.js';
test.use({ ...devices['iPhone SE'], viewport: { width: 667, height: 375 } });
test('long rewind note waits for acknowledgement on a small phone', async ({ page }) => {
  await page.goto('/?devScene=battle&preset=combat_actions&seed=42&mobilePreview=1&battleLab=1');
  await waitForScene(page, 'Battle');
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'PLAYER_IDLE',
  );
  await page.evaluate(async () => {
    const { showContextualHint } = await import('/src/ui/HintDisplay.js');
    const scene = window.__emblemRogueGame.scene.getScene('Battle');
    scene._contextualHintBattle = null;
    const { HintManager } = await import('/src/engine/HintManager.js');
    scene.registry.set('hints', new HintManager(1));
    scene.registry.get('hints').seen.delete('reading_test');
    showContextualHint(
      scene,
      'reading_test',
      'Rewinds last the whole run, not one battle. Each act boss grants one additional charge. Unused charges carry forward.',
    );
  });
  const panel = page.getByRole('dialog', { name: 'Field notes' });
  await expect(panel).toBeVisible();
  await page.waitForTimeout(4500);
  await expect(panel).toBeVisible();
  expect(
    await page.evaluate(() =>
      window.__emblemRogueGame.scene
        .getScene('Battle')
        .registry.get('hints')
        .hasSeen('reading_test'),
    ),
  ).toBe(false);
  await panel.getByRole('button', { name: 'Continue' }).tap();
  await expect(panel).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      window.__emblemRogueGame.scene
        .getScene('Battle')
        .registry.get('hints')
        .hasSeen('reading_test'),
    ),
  ).toBe(true);
});

test('item-menu teaching hint waits for idle and remains unread until dismissed', async ({
  page,
}) => {
  await page.goto('/?devScene=battle&preset=combat_actions&seed=42&mobilePreview=1&battleLab=1');
  await waitForScene(page, 'Battle');
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'PLAYER_IDLE',
  );
  await page.evaluate(async () => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const { HintManager } = await import('/src/engine/HintManager.js');
    const hints = new HintManager(1);
    hints.seen.delete('battle_consumable_supply');
    s.registry.set('hints', hints);
    s.registry.get('settings').setHints(true);
    s._contextualHintBattle = null;
    const unit = s.playerUnits[0];
    unit.consumables = [
      { ...s.gameData.consumables.find((item) => item.name === 'Vulnerary'), uses: 3 },
    ];
    s.selectUnit(unit);
    s.showItemMenu(unit);
  });
  const notes = page.getByRole('dialog', { name: 'Field notes', exact: true });
  await expect(notes).toHaveCount(0);
  const hud = page.getByRole('complementary', { name: 'Battle commands' });
  for (let i = 0; i < 3 && !(await notes.isVisible()); i++) {
    await hud.getByRole('button', { name: 'Back', exact: true }).last().tap();
    await page.waitForTimeout(100);
  }
  await expect(notes).toBeVisible();
  await expect(notes).toContainText('Consumable uses do not refill');
  expect(
    await page.evaluate(() =>
      window.__emblemRogueGame.scene
        .getScene('Battle')
        .registry.get('hints')
        .hasSeen('battle_consumable_supply'),
    ),
  ).toBe(false);
  await page.waitForTimeout(550);
  await notes.getByRole('button', { name: 'Continue', exact: true }).tap();
  await expect(notes).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      window.__emblemRogueGame.scene
        .getScene('Battle')
        .registry.get('hints')
        .hasSeen('battle_consumable_supply'),
    ),
  ).toBe(true);
});
