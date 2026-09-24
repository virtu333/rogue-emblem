import { test, expect, devices } from '@playwright/test';
import { waitForScene } from './helpers.js';
test.use({ ...devices['iPhone 13'], viewport: { width: 844, height: 390 } });
test('named boss art, promoted lord portraits and roster use the same identity', async ({
  page,
}) => {
  await page.goto('/?devScene=battle&preset=battle_smoke&seed=42&battleLab=1&characterReview=1');
  await waitForScene(page, 'Battle');
  await page.waitForFunction(() =>
    window.__emblemRogueGame.scene.getScene('Battle').enemyUnits?.some((u) => u.isBoss),
  );
  const before = await page.evaluate(() => {
    const b = window.__emblemRogueGame.scene.getScene('Battle');
    const boss = b.enemyUnits.find((u) => u.isBoss);
    return {
      name: boss.name,
      sprite: boss.graphic.texture.key,
      portrait: b._getPortraitKey(boss),
      pos: b.grid.gridToPixel(boss.col, boss.row),
      x: boss.graphic.x,
      y: boss.graphic.y,
    };
  });
  expect(before.name).toBe('Warchief');
  expect(before.sprite).toBe('contrast-rebuilt-boss_warchief');
  expect(before.portrait).toBe('rebuilt-portrait-boss_warchief');
  expect(before.x).toBe(before.pos.x);
  expect(before.y).toBe(before.pos.y);
  const promoted = await page.evaluate(async () => {
    const b = window.__emblemRogueGame.scene.getScene('Battle');
    const u = b.playerUnits.find((u) => u.name === 'Edric');
    const { promoteUnit } = await import('/src/engine/UnitManager.js');
    const lord = b.gameData.lords.find((l) => l.name === 'Edric');
    promoteUnit(
      u,
      b.gameData.classes.find((c) => c.name === lord.promotedClass),
      lord.promotionBonuses,
      b.gameData.skills,
    );
    return { sprite: b.getSpriteKey(u), portrait: b._getPortraitKey(u), tier: u.tier };
  });
  expect(promoted).toEqual({
    sprite: 'rebuilt-lord_edric_promoted',
    portrait: 'rebuilt-portrait-lord_edric_promoted',
    tier: 'promoted',
  });
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
  await expect(sheet.locator('.mr-portrait')).toBeVisible();
  expect(
    await page.evaluate(async () => {
      const { textureImageSource } = await import('/src/ui/textureImageSource.js');
      const b = window.__emblemRogueGame.scene.getScene('Battle');
      return (
        document.querySelector('.mr-portrait').src ===
        textureImageSource(b.textures.get('rebuilt-portrait-lord_edric_promoted'))
      );
    }),
  ).toBe(true);
  // The DOM portrait reuses the downloaded file rather than a re-encoded PNG.
  const portrait = await sheet.locator('.mr-portrait').evaluate(async (img) => {
    await img.decode();
    return { blob: img.src.startsWith('blob:'), width: img.naturalWidth };
  });
  expect(portrait).toEqual({ blob: true, width: 512 });
  await sheet.getByRole('button', { name: 'Close', exact: true }).tap();
  await expect(sheet).toHaveCount(0);
});
