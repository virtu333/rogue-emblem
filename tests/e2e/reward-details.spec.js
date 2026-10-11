// Battle rewards: a reward's item reads in full (special, weapon arts, who can use it)
// from a press and hold on touch, a right-click, the Details button and the pad's L2,
// and reading it never selects or claims the reward.
import { test, expect } from '@playwright/test';
import { waitForScene } from './helpers.js';

const VIEWS = [
  { name: 'phone', width: 844, height: 390, query: '&mobilePreview=1', touch: true },
  { name: 'portrait', width: 390, height: 844, query: '&mobilePreview=1', touch: true },
  { name: 'desktop', width: 1280, height: 800, query: '', touch: false },
];

async function openRewards(page, query) {
  await page.goto(`/?devScene=battle&preset=battle_smoke&seed=42&battleLab=1${query}`);
  await waitForScene(page, 'Battle');
  await page.evaluate(() => window.__emblemRogueGame.scene.getScene('Battle').onVictory());
  const dialog = page.getByRole('dialog', { name: 'Battle rewards', exact: true });
  await expect(dialog).toBeVisible();
  // Two legendary bows Dave was handed (no one in the smoke army can wield them).
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const rewards = s._lootController.mobileRewards;
    const weapon = (name) => structuredClone(s.gameData.weapons.find((w) => w.name === name));
    rewards.choices[0] = { type: 'legendaryWeapon', item: weapon('Starfall') };
    rewards.choices[1] = { type: 'legendaryWeapon', item: weapon("Hermit's Bow") };
    rewards.selected = 0;
    rewards.reveal?.skip();
    rewards.render();
  });
  return dialog;
}

/** What a claim would change: the reward record, the army's bags and the gold. */
const claimState = (page) =>
  page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const run = s.runManager;
    return JSON.stringify({
      claimed: [...(s._lootController.claimed || [])],
      record: run.pendingBattleReward?.claimed || null,
      gold: run.gold,
      bags: run.roster.map((u) => (u.inventory || []).map((i) => i.name)),
      convoy: (run.convoy?.weapons || []).map((i) => i.name),
    });
  });

for (const view of VIEWS) {
  test.describe(`reward details ${view.name}`, () => {
    test.use({ viewport: { width: view.width, height: view.height }, hasTouch: view.touch });

    test('Details opens the chosen reward in full and Close returns to the cards', async ({
      page,
    }) => {
      const dialog = await openRewards(page, view.query);
      const before = await claimState(page);
      const details = dialog.getByRole('button', { name: 'Details: Starfall', exact: true });
      await details.click();
      const sheet = page.getByRole('dialog', { name: 'Starfall', exact: true });
      await expect(sheet).toBeVisible();
      // The weapon art reads open: its cost and effect, not just its name.
      await expect(sheet.locator('details.item-art-details[open] > summary')).toHaveText(
        'Weapon art: Starfall Volley',
      );
      await expect(sheet).toContainText('Cost 5 HP');
      await expect(sheet).toContainText('Special: Extended range');
      await expect(sheet).toContainText('No one in your army can wield it yet.');
      await expect(sheet).toContainText('Strung the night the stars came down');
      // The sheet fits the screen: nothing spills sideways.
      const spill = await sheet.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
      expect(spill).toBe(false);
      await page.screenshot({ path: `test-results/reward-details-${view.name}.png` });
      await sheet.getByRole('button', { name: 'Close', exact: true }).click();
      await expect(sheet).toHaveCount(0);
      await expect(dialog).toBeVisible();
      await expect(details).toBeFocused();
      expect(await claimState(page)).toBe(before);
    });

    if (view.touch) {
      test('press and hold reads a card without selecting or claiming it', async ({ page }) => {
        const dialog = await openRewards(page, view.query);
        const before = await claimState(page);
        const other = dialog.locator('[data-focus="reward-1"]');
        await other.scrollIntoViewIfNeeded();
        const box = await other.boundingBox();
        const at = { clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 };
        const pointer = { pointerType: 'touch', pointerId: 7, isPrimary: true, button: 0, ...at };
        // The sheet makes the rewards inert (hidden from role queries): keep the card itself.
        const card = await other.elementHandle();
        await card.dispatchEvent('pointerdown', pointer);
        const sheet = page.getByRole('dialog', { name: "Hermit's Bow", exact: true });
        await expect(sheet).toBeVisible();
        // The finger lifts: the tap a hold ends is swallowed.
        await card.dispatchEvent('pointerup', pointer);
        await card.dispatchEvent('click', at);
        await expect(sheet).toContainText('+4 STR, +4 SPD if no adjacent allies');
        await expect(sheet).toContainText('Weapon art: Starfall Volley');
        await sheet.getByRole('button', { name: 'Close', exact: true }).tap();
        await expect(sheet).toHaveCount(0);
        await expect(other).toHaveAttribute('aria-pressed', 'false');
        await expect(dialog.locator('[data-focus="reward-0"]')).toHaveAttribute(
          'aria-pressed',
          'true',
        );
        expect(await claimState(page)).toBe(before);
        // A short tap still only selects the card.
        await other.tap();
        await expect(other).toHaveAttribute('aria-pressed', 'true');
        await expect(sheet).toHaveCount(0);
        expect(await claimState(page)).toBe(before);
      });
    } else {
      test('right-click reads a card; Escape closes the sheet, not the rewards', async ({
        page,
      }) => {
        const dialog = await openRewards(page, view.query);
        const before = await claimState(page);
        const other = dialog.locator('[data-focus="reward-1"]');
        await other.click({ button: 'right' });
        const sheet = page.getByRole('dialog', { name: "Hermit's Bow", exact: true });
        await expect(sheet).toBeVisible();
        await expect(sheet).toContainText('+4 STR, +4 SPD if no adjacent allies');
        await page.keyboard.press('Escape');
        await expect(sheet).toHaveCount(0);
        await expect(dialog).toBeVisible();
        await expect(other).toHaveAttribute('aria-pressed', 'false');
        expect(await claimState(page)).toBe(before);
        // Keyboard: the Details button is in the focus order, Enter opens it.
        await dialog.locator('[data-focus="details"]').focus();
        await page.keyboard.press('Enter');
        await expect(page.getByRole('dialog', { name: 'Starfall', exact: true })).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(dialog).toBeVisible();
        // A gold card has no item: no Details.
        await dialog.getByRole('button', { name: /Take .* gold instead/ }).click();
        await expect(dialog.locator('[data-focus="details"]')).toHaveCount(0);
        expect(await claimState(page)).toBe(before);
      });
    }
  });
}
