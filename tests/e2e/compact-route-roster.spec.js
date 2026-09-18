import { test, expect } from '@playwright/test';
import { waitForScene } from './helpers.js';

test('horizontal route retains selection and scroll through roster on landscape phones', async ({
  page,
}, testInfo) => {
  await page.goto('/?devScene=nodemap&preset=battle_smoke&seed=42&mobilePreview=1');
  await waitForScene(page, 'NodeMap');
  await page.getByRole('button', { name: 'Skip conversation', exact: true }).tap();
  const route = page.locator('.re-node-map');
  await expect(route).toBeVisible();
  const scroll = page.locator('.re-node-scroll');
  expect(await scroll.evaluate((e) => e.scrollHeight - e.clientHeight)).toBeLessThanOrEqual(1);
  const future = route.locator('.re-node.is-future').first();
  expect(await future.evaluate((e) => Number(getComputedStyle(e).opacity))).toBeLessThan(0.7);
  const nodes = route.locator('.re-node');
  expect(
    await nodes.first().evaluate((e) => e.getBoundingClientRect().width),
  ).toBeGreaterThanOrEqual(44);
  expect(await route.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
  if (page.viewportSize().width < 700) {
    const graphBox = await scroll.boundingBox();
    const panelBox = await page.locator('.re-node-side').boundingBox();
    expect(panelBox.y).toBeGreaterThanOrEqual(graphBox.y + graphBox.height);
  }
  const boss = route.locator('.re-node[aria-label^="Boss battle"]').last();
  await boss.tap();
  await expect(boss).toHaveAttribute('aria-pressed', 'true');
  const left = await scroll.evaluate((e) => e.scrollLeft);
  await route.getByRole('button', { name: 'Roster', exact: true }).tap();
  const roster = page.locator('.mr-sheet');
  await expect(roster).toBeVisible();
  expect(await roster.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
  await expect(
    roster.locator('header').getByRole('button', { name: 'Equipment', exact: true }),
  ).toBeVisible();
  for (const b of await roster.locator('header button').all()) {
    expect((await b.boundingBox()).height).toBeGreaterThanOrEqual(44);
  }
  await page.screenshot({ path: `test-results/compact-roster-${testInfo.project.name}.png` });
  await roster.getByRole('button', { name: 'Close', exact: true }).tap();
  await expect(route).toBeVisible();
  await expect(boss).toHaveAttribute('aria-pressed', 'true');
  expect(await scroll.evaluate((e) => e.scrollLeft)).toBeCloseTo(left, 0);
  await page.screenshot({ path: `test-results/compact-route-${testInfo.project.name}.png` });
});

test('DOM promotion can cancel, then apply once without the legacy roster', async ({ page }) => {
  await page.goto('/?devScene=nodemap&preset=battle_smoke&seed=42&mobilePreview=1');
  await waitForScene(page, 'NodeMap');
  await page.getByRole('button', { name: 'Skip conversation', exact: true }).tap();
  await page.evaluate(async () => {
    const scene = window.__emblemRogueGame.scene.getScene('NodeMap');
    const { createUnit } = await import('/src/engine/UnitManager.js');
    const fighter = createUnit(
      scene.gameData.classes.find((c) => c.name === 'Fighter'),
      10,
      scene.gameData.weapons,
      { name: 'Test fighter' },
    );
    fighter.consumables = [{ name: 'Master Seal', type: 'Consumable', effect: 'promote', uses: 1 }];
    scene.runManager.roster.unshift(fighter);
  });
  await page.locator('.re-node-map').getByRole('button', { name: 'Roster', exact: true }).tap();
  const roster = page.locator('.mr-sheet');
  await roster.getByRole('button', { name: 'Equipment', exact: true }).tap();
  await roster.getByRole('button', { name: 'Promote', exact: true }).tap();
  let picker = page.getByRole('dialog', { name: 'Promote Test fighter', exact: true });
  await expect(picker).toBeVisible();
  await picker.getByRole('button', { name: 'Close', exact: true }).tap();
  await expect(picker).toHaveCount(0);
  await roster.getByRole('button', { name: 'Promote', exact: true }).tap();
  picker = page.getByRole('dialog', { name: 'Promote Test fighter', exact: true });
  await picker.getByRole('button', { name: /^Warrior/ }).tap();
  await page.evaluate(() => {
    const picker =
      window.__emblemRogueGame.scene.getScene('NodeMap').rosterOverlay._mobileSheet.picker;
    const apply = picker.apply;
    window.__pickerApplyCount = 0;
    picker.apply = (choice) =>
      new Promise((resolve) => {
        window.__pickerApplyCount++;
        window.__finishPickerApply = () => resolve(apply(choice));
      });
  });
  await picker.getByRole('button', { name: 'Confirm', exact: true }).tap();
  await page.keyboard.press('Escape');
  await expect(picker).toBeVisible();
  await page.evaluate(() => {
    const picker =
      window.__emblemRogueGame.scene.getScene('NodeMap').rosterOverlay._mobileSheet.picker;
    picker.confirm();
    window.__finishPickerApply();
  });
  expect(await page.evaluate(() => window.__pickerApplyCount)).toBe(1);

  await expect(picker).toHaveCount(0);
  await expect(roster.getByRole('status')).toContainText('is now Warrior');
  const result = await page.evaluate(() => {
    const unit = window.__emblemRogueGame.scene.getScene('NodeMap').runManager.roster[0];
    return {
      className: unit.className,
      seals: unit.consumables.length,
      bows: unit.inventory.filter((w) => w.type === 'Bow').length,
    };
  });
  expect(result).toEqual({ className: 'Warrior', seals: 0, bows: 1 });
});

test('Skills teaching, giving and convoy recipient work without leaving DOM roster', async ({
  page,
}) => {
  await page.goto('/?devScene=nodemap&preset=battle_smoke&seed=42&mobilePreview=1');
  await waitForScene(page, 'NodeMap');
  await page.getByRole('button', { name: 'Skip conversation', exact: true }).tap();
  const skillName = await page.evaluate(() => {
    const scene = window.__emblemRogueGame.scene.getScene('NodeMap');
    const unit = scene.runManager.roster[0];
    unit.skills = [];
    const skill = scene.gameData.skills.find((s) => s.id === 'wrath') || scene.gameData.skills[0];
    scene.runManager.scrolls = [{ name: 'Test scroll', type: 'Scroll', skillId: skill.id }];
    unit.inventory.push({
      ...scene.gameData.weapons.find((w) => w.name === 'Iron Sword'),
      name: 'Test blade',
    });
    return skill.name;
  });
  await page.locator('.re-node-map').getByRole('button', { name: 'Roster', exact: true }).tap();
  const roster = page.locator('.mr-sheet');
  await roster.getByRole('button', { name: 'Skills', exact: true }).tap();
  await roster.getByRole('button', { name: 'Teach…', exact: true }).tap();
  const teach = page.getByRole('dialog', { name: 'Teach Test scroll' });
  await teach.getByRole('button', { name: 'Confirm', exact: true }).tap();
  await expect(roster.getByRole('status')).toContainText(skillName);
  await roster.getByRole('button', { name: 'Equipment', exact: true }).tap();
  await roster
    .locator('article')
    .filter({ has: page.getByRole('heading', { name: 'Test blade', exact: true }) })
    .getByRole('button', { name: 'Give…' })
    .tap();
  const give = page.getByRole('dialog', { name: 'Give Test blade' });
  await give.getByRole('button', { name: /^Sera/ }).tap();
  await give.getByRole('button', { name: 'Confirm', exact: true }).tap();
  await expect(roster.getByRole('status')).toContainText('given to Sera');
  await roster.getByRole('button', { name: 'Convoy', exact: true }).tap();
  await roster.getByRole('button', { name: /^Withdraw to:/ }).tap();
  const convoy = page.getByRole('dialog', { name: 'Convoy recipient' });
  await convoy.getByRole('button', { name: /^Sera/ }).tap();
  await convoy.getByRole('button', { name: 'Confirm', exact: true }).tap();
  await expect(roster.getByRole('button', { name: 'Withdraw to: Sera' })).toBeVisible();
  expect(await roster.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
});
