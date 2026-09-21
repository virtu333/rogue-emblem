import { test, expect, devices } from '@playwright/test';
import { waitForScene } from './helpers.js';
test.use({ ...devices['iPhone SE'], viewport: { width: 667, height: 375 } });

for (const kind of ['weapon', 'forge', 'imbue', 'booster', 'consumable', 'convoy']) {
  test(`native ${kind} reward supports Back, guarded apply and elite continuation`, async ({
    page,
  }) => {
    await page.goto('/?devScene=battle&preset=battle_smoke&seed=42&mobilePreview=1&battleLab=1');
    await waitForScene(page, 'Battle');
    await page.evaluate(() => window.__emblemRogueGame.scene.getScene('Battle').onVictory());
    const dialog = page.getByRole('dialog', { name: 'Battle rewards', exact: true });
    await expect(dialog).toBeVisible();
    await page.evaluate((kind) => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      const c = s._lootController;
      s.isElite = true;
      s._elitePicksRemaining = 2;
      const item = ['weapon', 'convoy'].includes(kind)
        ? structuredClone(s.runManager.roster[0].inventory[0])
        : kind === 'booster'
          ? { name: 'Test Booster', type: 'Consumable', effect: 'statBoost', stat: 'STR', value: 2 }
          : kind === 'consumable'
            ? { name: 'Test Supplies', type: 'Consumable', effect: 'heal', value: 10, uses: 3 }
            : kind === 'forge'
              ? { name: 'Test Whetstone', type: 'Whetstone', forgeStat: 'choice' }
              : { name: 'Test Imbue', type: 'Whetstone', imbueId: 'choice' };
      c.mobileRewards.choices[0] = {
        type: ['forge', 'imbue'].includes(kind) ? 'forge' : 'weapon',
        item,
      };
      c.mobileRewards.selected = 0;
      c.mobileRewards.render();
      window.rewardBefore = structuredClone(s.runManager.roster[0].inventory);
      window.rewardBeforeStr = s.runManager.roster[0].stats.STR;
      s.runManager.roster[0].consumables = [];
      s.runManager.convoy = { weapons: [], consumables: [] };
    }, kind);
    await dialog.getByRole('button', { name: 'Choose reward', exact: true }).tap();
    await dialog.getByRole('button', { name: 'Back', exact: true }).tap();
    await dialog.getByRole('button', { name: 'Choose reward', exact: true }).tap();
    if (['forge', 'imbue'].includes(kind)) {
      await dialog.getByRole('button', { name: 'Continue', exact: true }).tap();
      await dialog.getByRole('button', { name: 'Continue', exact: true }).tap();
    }
    if (kind === 'convoy') await dialog.getByRole('button', { name: /Send to Convoy/ }).tap();
    await expect(dialog.getByRole('button', { name: 'Apply reward', exact: true })).toBeEnabled();
    await page.screenshot({ path: `test-results/native-reward-${kind}.png` });
    const overflow = await dialog.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    expect(overflow).toBe(false);
    await page.evaluate(() => {
      const c = window.__emblemRogueGame.scene.getScene('Battle')._lootController;
      const original = c.applyNativeReward.bind(c);
      c.applyNativeReward = (...args) =>
        new Promise((resolve) => {
          window.finishReward = () => resolve(original(...args));
        });
    });
    await dialog.getByRole('button', { name: 'Apply reward', exact: true }).tap();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveAttribute('aria-busy', 'true');
    await expect(dialog.getByRole('button', { name: 'Back', exact: true })).toBeDisabled();
    await page.evaluate(() => window.finishReward());
    await expect(dialog.getByRole('button', { name: 'Choose reward', exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Choose reward', exact: true })).toBeEnabled();
    await expect(dialog.locator('button[aria-pressed="true"]')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    const result = await page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      const inventory = s.runManager.roster[0].inventory;
      return {
        picks: s._elitePicksRemaining,
        claimed: s._lootController.claimed.size,
        length: inventory.length,
        before: window.rewardBefore.length,
        level: inventory[0]._forgeLevel,
        imbue: inventory[0]._imbueId,
        str: s.runManager.roster[0].stats.STR,
        beforeStr: window.rewardBeforeStr,
        supplies: s.runManager.roster[0].consumables.length,
        convoy: s.runManager.convoy.weapons.length,
      };
    });
    expect(result.picks).toBe(1);
    expect(result.claimed).toBe(1);
    if (kind === 'weapon') expect(result.length).toBe(result.before + 1);
    if (kind === 'forge') expect(result.level).toBe(1);
    if (kind === 'imbue') expect(result.imbue).toBeTruthy();
    if (kind === 'booster') expect(result.str).toBe(result.beforeStr + 2);
    if (kind === 'consumable') expect(result.supplies).toBe(1);
    if (kind === 'convoy') expect(result.convoy).toBe(1);
  });
}
