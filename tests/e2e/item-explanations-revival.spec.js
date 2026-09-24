import { test, expect, devices } from '@playwright/test';
import { waitForGame, waitForScene, collectErrors } from './helpers.js';
test.use({ ...devices['iPhone SE'], viewport: { width: 667, height: 375 } });
test('Mire details are tappable in shop and roster; revival previews and saves catch-up', async ({
  page,
}, info) => {
  const errors = collectErrors(page);
  await page.goto('/?devScene=nodemap&mobilePreview=1');
  await waitForGame(page);
  await waitForScene(page, 'NodeMap');
  const skip = page.getByRole('button', { name: 'Skip conversation', exact: true });
  if (await skip.isVisible()) await skip.tap();
  await page.evaluate(async () => {
    const s = window.__emblemRogueGame.scene.getScene('NodeMap');
    s.dialogueOverlay?.hide();
    s._storyDialogueActive = false;
    s.registry.set('activeSlot', 1);
    s.runManager.gold = 10000;
    const item = structuredClone(s.gameData.weapons.find((w) => w.name === 'Sunflare'));
    item.weaponArtIds = ['magic_mire'];
    s.runManager.roster[0].inventory = [item];
    const n = s.runManager.getAvailableNodes()[0];
    n.type = 'shop';
    s.showShopOverlay(n, [
      { type: 'weapon', item, price: 2300 },
      {
        type: 'accessory',
        item: structuredClone(s.gameData.accessories.find((a) => a.name === 'Vanguard Crest')),
        price: 2000,
      },
    ]);
  });
  const shop = page.locator('.shop-menu');
  await shop.getByText('Weapon art: Mire · Details', { exact: true }).tap();
  const details = shop.locator('.item-art-details');
  await expect(details).toHaveAttribute('open', '');
  await expect(details).toContainText('Base HP cost:');
  await expect(details).toContainText('uses per battle');
  await expect(details).toContainText('Active attack');
  expect(await details.evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath('mire-details.png') });
  await shop.getByRole('button', { name: /Vanguard Crest/ }).tap();
  await expect(shop).toContainText('+4 Atk when no ally is within 2 tiles');
  await page.screenshot({ path: info.outputPath('vanguard-description.png') });
  await shop.getByRole('button', { name: 'Roster', exact: true }).tap();
  const roster = page.getByRole('dialog', { name: 'Manage roster', exact: true });
  await roster.getByRole('button', { name: 'Equipment', exact: true }).tap();
  await roster.getByText('Weapon art: Mire · Details', { exact: true }).tap();
  await expect(roster.locator('.item-art-details')).toContainText('Active attack');
  await roster.getByRole('button', { name: 'Close', exact: true }).tap();
  await shop.getByRole('button', { name: 'Leave', exact: true }).tap();
  await page.evaluate(async () => {
    const s = window.__emblemRogueGame.scene.getScene('NodeMap');
    const { createUnit } = await import('/src/engine/UnitManager.js');
    for (const u of s.runManager.roster) u.level = 10;
    const u = createUnit(
      s.gameData.classes.find((c) => c.name === 'Mage'),
      2,
      s.gameData.weapons,
      { name: 'Fallen Mage' },
    );
    u.currentHP = 0;
    s.runManager.fallenUnits = [u];
    window.preReviveGrowths = structuredClone(u.growths);
    s.handleChurch(s.runManager.getAvailableNodes()[0]);
  });
  const church = page.getByRole('dialog', { name: 'Church', exact: true });
  await church.getByRole('button', { name: /Fallen Mage.*Revive/ }).tap();
  const confirm = page.getByRole('dialog', { name: 'Revive Fallen Mage?', exact: true });
  await expect(confirm).toContainText('Returns at level 10 with 1 HP');
  await expect(confirm).toContainText('10 percentage points');
  await expect(confirm).toContainText('future growths are unchanged');
  await page.screenshot({ path: info.outputPath('revive-catch-up.png') });
  await confirm.getByRole('button', { name: 'Confirm', exact: true }).tap();
  await expect(church.getByRole('status')).toContainText('revived at level 10');
  const result = await page.evaluate(async () => {
    const s = window.__emblemRogueGame.scene.getScene('NodeMap');
    const { loadRun } = await import('/src/engine/RunManager.js');
    const saved = loadRun(s.gameData, 1).roster.find((u) => u.name === 'Fallen Mage');
    return {
      level: saved.level,
      hp: saved.currentHP,
      unchanged: JSON.stringify(saved.growths) === JSON.stringify(window.preReviveGrowths),
    };
  });
  expect(result).toEqual({ level: 10, hp: 1, unchanged: true });
  expect(errors).toEqual([]);
});
test('Seraphim reward explains the scroll before claiming', async ({ page }, info) => {
  const errors = collectErrors(page);
  await page.goto('/?devScene=battle&preset=battle_smoke&seed=42&mobilePreview=1');
  await waitForScene(page, 'Battle');
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'PLAYER_IDLE',
  );
  await page.evaluate(() => window.__emblemRogueGame.scene.getScene('Battle').onVictory());
  const rewards = page.getByRole('dialog', { name: 'Battle rewards', exact: true });
  await expect(rewards).toBeVisible();
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const r = s._lootController.mobileRewards;
    r.choices[0] = {
      type: 'rare',
      item: structuredClone(
        s.gameData.weapons.find((w) => w.teachesWeaponArtId === 'magic_seraphim'),
      ),
    };
    r.selected = 0;
    r.render();
  });
  await expect(rewards).toContainText('Rare · Weapon Art Scroll');
  await expect(rewards).toContainText('Roster → Skills → Bind to weapon');
  await expect(rewards).toContainText('Base HP cost: 6');
  await expect(rewards).toContainText('2 uses per battle');
  expect(await rewards.evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
  await expect(
    rewards.getByRole('button', { name: 'Choose reward', exact: true }),
  ).toBeInViewport();
  await page.screenshot({ path: info.outputPath('seraphim-scroll.png') });
  expect(errors).toEqual([]);
});

test('roster Spirit Dust previews, cancels, applies once and saves immediately', async ({
  page,
}, info) => {
  const errors = collectErrors(page);
  await page.goto('/?devScene=nodemap&mobilePreview=1');
  await waitForGame(page);
  await waitForScene(page, 'NodeMap');
  // Drive the real intro dialogue. A one-shot visibility check (then force
  // hiding the line) raced its awaited next line on slower CI runners, which
  // reopened over the route and hid the Roster button.
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('NodeMap').dialogueOverlay?.visible,
  );
  await page.getByRole('button', { name: 'Skip conversation', exact: true }).tap();
  await expect(page.getByRole('button', { name: 'Roster', exact: true })).toBeVisible();
  const before = await page.evaluate(async () => {
    const s = window.__emblemRogueGame.scene.getScene('NodeMap');
    s.registry.set('activeSlot', 1);
    const unit = s.runManager.roster[0];
    unit.consumables = [
      structuredClone(s.gameData.consumables.find((i) => i.name === 'Spirit Dust')),
    ];
    return unit.stats.MAG;
  });
  await page.getByRole('button', { name: 'Roster', exact: true }).tap();
  const roster = page.getByRole('dialog', { name: 'Manage roster', exact: true });
  await roster.getByRole('button', { name: 'Equipment', exact: true }).tap();
  const card = roster
    .locator('.mr-card')
    .filter({ has: page.getByRole('heading', { name: 'Spirit Dust', exact: true }) });
  await card.getByRole('button', { name: 'Use', exact: true }).tap();
  const confirm = page.getByRole('dialog', { name: 'Use Spirit Dust?', exact: true });
  await expect(confirm).toContainText(`MAG ${before} → ${before + 2}`);
  await expect(confirm).toContainText('Permanently increases MAG by 2');
  await page.screenshot({ path: info.outputPath('spirit-dust-confirm.png') });
  await confirm.getByRole('button', { name: 'Cancel', exact: true }).tap();
  expect(
    await page.evaluate(
      () => window.__emblemRogueGame.scene.getScene('NodeMap').runManager.roster[0].stats.MAG,
    ),
  ).toBe(before);
  await card.getByRole('button', { name: 'Use', exact: true }).tap();
  await confirm.getByRole('button', { name: 'Confirm', exact: true }).tap();
  await expect(confirm).not.toBeVisible();
  await expect(roster).toContainText('+2 MAG from Spirit Dust');
  expect(
    await page.evaluate(async () => {
      const s = window.__emblemRogueGame.scene.getScene('NodeMap');
      const { loadRun } = await import('/src/engine/RunManager.js');
      const u = loadRun(s.gameData, 1).roster[0];
      return { mag: u.stats.MAG, count: u.consumables.length };
    }),
  ).toEqual({ mag: before + 2, count: 0 });
  expect(errors).toEqual([]);
});
