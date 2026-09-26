import { test, expect, devices } from '@playwright/test';
import { waitForGame, waitForScene } from './helpers.js';
test.use({ ...devices['iPhone 13'], viewport: { width: 667, height: 375 } });
async function roster(page) {
  await page.goto('/?devScene=nodemap&preset=battle_smoke&seed=42');
  await waitForGame(page);
  await waitForScene(page, 'NodeMap');
  await page.evaluate(() => window.__emblemRogueGame.scene.getScene('NodeMap')._openRoster());
  return page.getByRole('dialog', { name: 'Manage roster' });
}
test('equipment and convoy use real rules and keep the selected recipient', async ({ page }) => {
  const sheet = await roster(page);
  await sheet.getByRole('button', { name: 'Equipment', exact: true }).tap();
  await expect(sheet.getByText('Equipped', { exact: true }).first()).toBeVisible();
  await sheet.getByRole('button', { name: 'Convoy', exact: true }).tap();
  await expect(sheet.getByRole('heading', { name: /^Shared convoy/ })).toBeVisible();
  const names = await sheet.getByRole('navigation', { name: 'Units' }).getByRole('button').count();
  if (names > 1) {
    await sheet.getByRole('navigation', { name: 'Units' }).getByRole('button').nth(1).tap();
    await expect(sheet.getByRole('heading', { name: /^Shared convoy/ })).toBeVisible();
  }
  await page.screenshot({ path: 'test-results/mobile-roster-convoy.png' });
  await sheet.getByRole('button', { name: 'Close', exact: true }).tap();
  await expect(sheet).toHaveCount(0);
  expect(
    await page.evaluate(() => window.__emblemRogueGame.scene.getScene('NodeMap').rosterOverlay),
  ).toBeNull();
});
test('long roster and gear stay scrollable without covering Close', async ({ page }) => {
  const sheet = await roster(page);
  await page.evaluate(() => {
    const overlay = window.__emblemRogueGame.scene.getScene('NodeMap').rosterOverlay;
    const units = overlay.runManager.roster;
    const first = units[0];
    for (let i = 0; i < 16; i++)
      units.push({ ...first, name: `A very long traveling companion name ${i}` });
    first.inventory.forEach(
      (item) => (item.name = 'An exceptionally long legendary weapon name with descriptive suffix'),
    );
    overlay._mobileSheet.render();
  });
  await sheet.getByRole('button', { name: 'Equipment', exact: true }).tap();
  expect(await sheet.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
  const close = sheet.getByRole('button', { name: 'Close', exact: true });
  expect((await close.boundingBox()).height).toBeGreaterThanOrEqual(44);
  expect(await sheet.locator('.mr-units').evaluate((e) => e.scrollHeight > e.clientHeight)).toBe(
    true,
  );
  await page.screenshot({ path: 'test-results/mobile-roster-equipment.png' });
  await close.tap();
  await expect(sheet).toHaveCount(0);
});
test('battle roster is read-only and releases focus when closed', async ({ page }) => {
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
  await page
    .getByRole('complementary', { name: 'Battle commands' })
    .getByRole('button', { name: 'Roster', exact: true })
    .tap();
  const sheet = page.getByRole('dialog', { name: 'Inspect roster' });
  await sheet.getByRole('button', { name: 'Equipment', exact: true }).tap();
  await expect(sheet.getByRole('button', { name: 'Equip', exact: true })).toHaveCount(0);
  await expect(sheet.getByRole('button', { name: 'Store', exact: true })).toHaveCount(0);
  await sheet.getByRole('button', { name: 'Close', exact: true }).tap();
  await expect(page.getByRole('complementary', { name: 'Battle commands' })).toBeVisible();
});

test('store and withdraw preserve the item through touch actions', async ({ page }) => {
  const sheet = await roster(page);
  await page.evaluate(async () => {
    const overlay = window.__emblemRogueGame.scene.getScene('NodeMap').rosterOverlay;
    const { addToInventory } = await import('/src/engine/UnitManager.js');
    const unit = overlay.runManager.roster[0];
    unit.inventory = [unit.weapon];
    addToInventory(unit, { ...unit.weapon, name: 'Mobile transfer test blade' });
    overlay._mobileSheet.index = 0;
    overlay._mobileSheet.render();
  });
  await sheet.getByRole('button', { name: 'Equipment', exact: true }).tap();
  // The equipped item's heading carries the "E" badge (#77), whose accessible name
  // is "Equipped", so the card's heading reads "<name> Equipped" once it is equipped.
  let card = sheet.getByRole('article').filter({
    has: page.getByRole('heading', { name: /^Mobile transfer test blade( Equipped)?$/ }),
  });
  await card.getByRole('button', { name: 'Equip', exact: true }).tap();
  await expect(
    card.getByRole('heading', { name: 'Mobile transfer test blade Equipped', exact: true }),
  ).toBeVisible();
  await expect(card.getByText('Equipped', { exact: true })).toBeVisible();
  await card.getByRole('button', { name: 'Store', exact: true }).tap();
  await expect(card).toHaveCount(0);
  await sheet.getByRole('button', { name: 'Convoy', exact: true }).tap();
  card = sheet.getByRole('article').filter({
    has: page.getByRole('heading', { name: 'Mobile transfer test blade', exact: true }),
  });
  await card.getByRole('button', { name: 'Withdraw', exact: true }).tap();
  await expect(card).toHaveCount(0);
  await sheet.getByRole('button', { name: 'Equipment', exact: true }).tap();
  await expect(
    sheet.getByRole('heading', { name: 'Mobile transfer test blade', exact: true }),
  ).toBeVisible();
});
test('empty roster and shutdown clean up the sheet', async ({ page }) => {
  const sheet = await roster(page);
  await page.evaluate(() => {
    const o = window.__emblemRogueGame.scene.getScene('NodeMap').rosterOverlay;
    o.runManager.roster.length = 0;
    o._mobileSheet.render();
  });
  await expect(sheet.getByText('No units in the roster.')).toBeVisible();
  await sheet.getByRole('button', { name: 'Convoy', exact: true }).tap();
  await expect(sheet.getByText('No recipient', { exact: true })).toBeVisible();
  await page.evaluate(() =>
    window.__emblemRogueGame.scene.getScene('NodeMap').scene.start('Title'),
  );
  await expect(sheet).toHaveCount(0);
});

test('DOM portraits remain usable after the game loader revokes its image URL', async ({
  page,
}) => {
  await roster(page);
  const result = await page.evaluate(async () => {
    const { textureImageSource } = await import('/src/ui/textureImageSource.js');
    const canvas = document.createElement('canvas');
    canvas.width = 8;
    canvas.height = 8;
    canvas.getContext('2d').fillRect(0, 0, 8, 8);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve));
    const url = URL.createObjectURL(blob);
    const decoded = new Image();
    decoded.src = url;
    await decoded.decode();
    URL.revokeObjectURL(url);
    const img = new Image();
    img.src = textureImageSource({ getSourceImage: () => decoded });
    await img.decode();
    return img.naturalWidth;
  });
  expect(result).toBe(8);
});

test('roster tolerates thumb drift but rejects scroll and slide-off releases', async ({ page }) => {
  const sheet = await roster(page);
  const cards = sheet.locator('.mr-unit-card');
  await expect(cards.first()).toContainText('Lv');
  const gesture = async (pointerType, drift, cancel) =>
    cards.nth(1).evaluate(
      (b, args) => {
        const r = b.getBoundingClientRect();
        const send = (type, dx = 0) =>
          b.dispatchEvent(
            new PointerEvent(type, {
              bubbles: true,
              pointerId: 7,
              isPrimary: true,
              pointerType: args.pointerType,
              clientX: r.left + 30 + dx,
              clientY: r.top + 25,
            }),
          );
        send('pointerdown');
        send('pointermove', args.drift);
        if (args.cancel) send(args.cancel, args.drift);
        send('pointerup', args.drift);
        b.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
      },
      { pointerType, drift, cancel },
    );
  for (const [type, drift, cancel] of [
    ['touch', 30, null],
    ['touch', 5, 'pointercancel'],
    ['touch', 5, 'pointerleave'],
    ['mouse', 16, null],
  ]) {
    await gesture(type, drift, cancel);
    await expect(cards.first()).toHaveAttribute('aria-pressed', 'true');
  }
  await gesture('touch', 16, null);
  await expect(cards.nth(1)).toHaveAttribute('aria-pressed', 'true');
  await expect(sheet.locator('.mr-unit-card[aria-pressed="true"]')).toHaveCount(1);
  await cards.first().tap();
  await expect(cards.first()).toHaveAttribute('aria-pressed', 'true');
  await expect(cards.nth(1)).toHaveAttribute('aria-pressed', 'false');
  expect(await cards.first().evaluate((b) => getComputedStyle(b).backgroundColor)).not.toBe(
    await cards.nth(1).evaluate((b) => getComputedStyle(b).backgroundColor),
  );
});
