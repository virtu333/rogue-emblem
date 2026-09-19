import { test, expect } from '@playwright/test';
import { waitForScene } from './helpers.js';

test('desktop native roster supports keyboard and gamepad actions without stale battle readiness', async ({
  page,
}) => {
  await page.goto('/?devScene=nodemap&preset=battle_smoke&seed=42');
  await waitForScene(page, 'NodeMap');
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('NodeMap').dialogueOverlay?.visible,
  );
  await page.evaluate(() => {
    const dialogue = window.__emblemRogueGame.scene.getScene('NodeMap').dialogueOverlay;
    dialogue.objects.find((object) => object.text === '[Skip]').emit('pointerdown');
  });
  await page.waitForFunction(
    () => !window.__emblemRogueGame.scene.getScene('NodeMap').dialogueOverlay?.visible,
  );
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('NodeMap');
    const unit = s.runManager.roster[0];
    unit.inventory[0].weaponArtIds = ['sword_precise_cut'];
    unit._battleWeaponArtUsage = { map: { sword_precise_cut: 999 }, turn: {}, turnKey: '1' };
    s._openRoster();
  });
  const roster = page.getByRole('dialog', { name: 'Manage roster', exact: true });
  await expect(roster).toBeVisible();
  await expect(roster.getByRole('button', { name: 'Stats', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(roster.getByRole('button', { name: 'Skills', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(roster).toContainText('Meets Sword Prof');
  await expect(roster).not.toContainText('per map limit');
  await expect(roster).not.toContainText('Ready');
  const action = async (action, payload) =>
    page.evaluate(
      async ({ action, payload }) => {
        const { dispatchInputAction } = await import('/src/utils/inputFocus.js');
        dispatchInputAction(action, payload);
      },
      { action, payload },
    );
  await action('input:navigate', { dx: 1 });
  await expect(roster.getByRole('button', { name: 'Equipment', exact: true })).toBeFocused();
  await action('input:confirm');
  await expect(roster.getByRole('heading', { name: /Equipment ·/ })).toBeVisible();
  await action('input:nextUnit');
  await expect(roster.locator('.mr-summary')).toContainText('Sera');
  await action('input:cancel');
  await expect(roster).toHaveCount(0);
});
