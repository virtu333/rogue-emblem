import { test, expect } from '@playwright/test';
import { waitForScene } from './helpers.js';

async function nodeMap(page) {
  await page.goto('/?devScene=nodemap&preset=battle_smoke&seed=42&mobilePreview=1');
  await waitForScene(page, 'NodeMap');
  await page.getByRole('button', { name: 'Skip conversation', exact: true }).click();
  await expect(page.locator('.re-node-map')).toBeVisible();
}

test('reclass previews consequences, cancels safely, then equips the granted weapon once', async ({
  page,
}, testInfo) => {
  await nodeMap(page);
  await page.evaluate(async () => {
    const scene = window.__emblemRogueGame.scene.getScene('NodeMap');
    const { createUnit } = await import('/src/engine/UnitManager.js');
    const unit = createUnit(
      scene.gameData.classes.find((c) => c.name === 'Fighter'),
      10,
      scene.gameData.weapons,
      { name: 'Veteran of the Western Mercenary Company' },
    );
    unit.consumables = [
      {
        name: 'Second Seal',
        type: 'Consumable',
        effect: 'reclass',
        subEffect: 'infantry',
        uses: 1,
      },
    ];
    scene.runManager.roster.unshift(unit);
    window.managementBefore = JSON.stringify(unit);
  });
  await page.locator('.re-node-map').getByRole('button', { name: 'Roster', exact: true }).click();
  const roster = page.locator('.mr-sheet');
  await roster.getByRole('button', { name: 'Equipment', exact: true }).click();
  await roster.getByRole('button', { name: 'Reclass', exact: true }).click();
  const picker = page.getByRole('dialog', {
    name: 'Reclass Veteran of the Western Mercenary Company',
    exact: true,
  });
  await picker.getByRole('button', { name: /^Myrmidon/ }).click();
  const preview = picker.locator('.re-choice-preview');
  await expect(preview).toContainText('Uses 1 Second Seal charge');
  await expect(preview).toContainText('Growth rates reroll on Confirm');
  await expect(preview).toContainText('Iron Axe → Iron Sword');
  expect(await picker.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  expect(
    await picker
      .getByRole('button', { name: 'Close', exact: true })
      .evaluate((el) => getComputedStyle(el).whiteSpace),
  ).toBe('nowrap');
  const confirm = picker.getByRole('button', { name: 'Confirm', exact: true });
  const box = await confirm.boundingBox();
  expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize().height);
  await page.keyboard.press('PageDown');
  expect(await preview.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  await page.screenshot({ path: testInfo.outputPath('class-preview.png') });
  await page.keyboard.press('Escape');
  expect(
    await page.evaluate(
      () =>
        JSON.stringify(window.__emblemRogueGame.scene.getScene('NodeMap').runManager.roster[0]) ===
        window.managementBefore,
    ),
  ).toBe(true);
  await roster.getByRole('button', { name: 'Reclass', exact: true }).click();
  await picker.getByRole('button', { name: /^Myrmidon/ }).click();
  await confirm.evaluate((button) => {
    button.click();
    button.click();
  });
  await expect(picker).toHaveCount(0);
  expect(
    await page.evaluate(() => {
      const unit = window.__emblemRogueGame.scene.getScene('NodeMap').runManager.roster[0];
      return {
        cls: unit.className,
        equipped: unit.weapon?.name,
        carried: unit.inventory.includes(unit.weapon),
        seals: unit.consumables.length,
      };
    }),
  ).toEqual({ cls: 'Myrmidon', equipped: 'Iron Sword', carried: true, seals: 0 });
});

test('art replacement Back preserves weapon and slot, shows effects, and consumes once', async ({
  page,
}, testInfo) => {
  await nodeMap(page);
  const names = await page.evaluate(() => {
    const scene = window.__emblemRogueGame.scene.getScene('NodeMap');
    const unit = scene.runManager.roster[0];
    const arts = scene.gameData.weaponArts.arts
      .filter((a) => a.weaponType === 'Sword' && a.requiredRank === 'Prof')
      .slice(0, 4);
    const weapon = unit.inventory.find((w) => w.type === 'Sword');
    weapon.weaponArtIds = arts.slice(0, 3).map((a) => a.id);
    weapon.weaponArtSources = ['innate', 'scroll', 'meta_innate'];
    scene.runManager.scrolls = [{ name: 'Contract art scroll', teachesWeaponArtId: arts[3].id }];
    window.artBefore = JSON.stringify({ weapon, scrolls: scene.runManager.scrolls });
    return {
      weapon: weapon.name,
      old: arts[1].name,
      next: arts[3].id,
      description: arts[1].description,
    };
  });
  await page.locator('.re-node-map').getByRole('button', { name: 'Roster', exact: true }).click();
  await page.locator('.mr-sheet').getByRole('button', { name: 'Skills', exact: true }).click();
  await page.getByRole('button', { name: 'Bind to weapon…' }).click();
  const weapons = page.getByRole('dialog', {
    name: 'Choose weapon for Contract art scroll',
    exact: true,
  });
  await weapons.getByRole('button', { name: 'Confirm', exact: true }).click();
  const slots = page.getByRole('dialog', { name: 'Choose art to replace', exact: true });
  await slots.getByRole('button', { name: new RegExp(`^${names.old}`) }).click();
  await expect(slots.locator('.re-choice-preview')).toContainText(names.description);
  await page.addStyleTag({ content: '.re-choice-list, .re-choice-preview { max-height: 90px; }' });
  const listOffset = await slots.locator('.re-choice-list').evaluate((el) => {
    el.scrollTop = 10;
    el.dispatchEvent(new Event('scroll'));
    return el.scrollTop;
  });
  expect(listOffset).toBeGreaterThan(0);
  await slots
    .getByRole('button', { name: new RegExp(`^${names.old}`) })
    .evaluate((el) => el.click());
  expect(await slots.locator('.re-choice-list').evaluate((el) => el.scrollTop)).toBe(listOffset);
  await slots.locator('.re-choice-preview').evaluate((el) => {
    el.scrollTop = 80;
    el.dispatchEvent(new Event('scroll'));
  });
  await slots.getByRole('button', { name: 'Confirm', exact: true }).click();
  const final = page.getByRole('dialog', { name: `Replace ${names.old}?`, exact: true });
  await expect(final).toContainText('Uses one Contract art scroll');
  await expect(final.locator('.re-choice-preview')).toContainText('REMOVE');
  await expect(final.locator('.re-choice-preview')).toContainText('ADD');
  await page.screenshot({ path: testInfo.outputPath('art-replacement.png') });
  await page.keyboard.press('Escape');
  expect(await slots.locator('.re-choice-list').evaluate((el) => el.scrollTop)).toBe(listOffset);
  await expect(slots.getByRole('button', { name: new RegExp(`^${names.old}`) })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await slots.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(weapons.locator('[aria-pressed="true"]')).toContainText(names.weapon);
  expect(
    await page.evaluate(() => {
      const run = window.__emblemRogueGame.scene.getScene('NodeMap').runManager;
      return (
        JSON.stringify({
          weapon: run.roster[0].inventory.find((w) => w.type === 'Sword'),
          scrolls: run.scrolls,
        }) === window.artBefore
      );
    }),
  ).toBe(true);
  await weapons.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(slots.getByRole('button', { name: new RegExp(`^${names.old}`) })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await slots.getByRole('button', { name: 'Confirm', exact: true }).click();
  await final.getByRole('button', { name: 'Confirm', exact: true }).evaluate((button) => {
    button.click();
    button.click();
  });
  await expect(final).toHaveCount(0);
  expect(
    await page.evaluate(() => {
      const run = window.__emblemRogueGame.scene.getScene('NodeMap').runManager;
      return {
        replaced: run.roster[0].inventory.find((w) => w.type === 'Sword').weaponArtIds[1],
        scrolls: run.scrolls.length,
      };
    }),
  ).toEqual({ replaced: names.next, scrolls: 0 });
});

test('zero-weight reward is blocked without claiming, and a useful stat remains selectable', async ({
  page,
}) => {
  await page.goto('/?devScene=battle&preset=battle_smoke&seed=42&mobilePreview=1&battleLab=1');
  await waitForScene(page, 'Battle');
  await page.evaluate(() => window.__emblemRogueGame.scene.getScene('Battle').onVictory());
  const dialog = page.getByRole('dialog', { name: 'Battle rewards', exact: true });
  await expect(dialog).toBeVisible();
  await page.evaluate(() => {
    const scene = window.__emblemRogueGame.scene.getScene('Battle');
    const c = scene._lootController;
    // Elite picks live on the durable pending-reward record since 33e3cca.
    c.record.picksRemaining = 2;
    c.scene._elitePicksRemaining = 2;
    const weapon = scene.runManager.roster[0].inventory[0];
    weapon.weight = 0;
    c.mobileRewards.choices[0] = {
      type: 'forge',
      item: { name: 'Test Whetstone', type: 'Whetstone', forgeStat: 'choice' },
    };
    c.mobileRewards.selected = 0;
    c.mobileRewards.render();
    window.rewardWeaponBefore = JSON.stringify(weapon);
  });
  await dialog.getByRole('button', { name: 'Choose reward', exact: true }).click();
  await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
  await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
  await dialog.getByRole('button', { name: /-1 Weight/ }).click();
  await expect(dialog).toContainText('Already at minimum weight');
  await expect(dialog.getByRole('button', { name: 'Apply reward', exact: true })).toBeDisabled();
  expect(
    await page.evaluate(() => {
      const scene = window.__emblemRogueGame.scene.getScene('Battle');
      return {
        changed:
          JSON.stringify(scene.runManager.roster[0].inventory[0]) !== window.rewardWeaponBefore,
        claimed: scene._lootController.claimed.size,
        picks: scene._lootController.record.picksRemaining,
      };
    }),
  ).toEqual({ changed: false, claimed: 0, picks: 2 });
  await dialog.getByRole('button', { name: /\+1 Might/ }).click();
  await dialog.getByRole('button', { name: 'Apply reward', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Choose reward', exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => window.__emblemRogueGame.scene.getScene('Battle')._lootController.claimed.size,
    ),
  ).toBe(1);
});
