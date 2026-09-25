import { test, expect } from '@playwright/test';
import { waitForScene } from './helpers.js';
for (const viewport of [
  { width: 844, height: 390 },
  { width: 667, height: 375 },
  { width: 640, height: 480 },
]) {
  test(`compact sidebar preserves commands and terrain at ${viewport.width}x${viewport.height}`, async ({
    page,
  }, info) => {
    await page.setViewportSize(viewport);
    await page.addInitScript(() =>
      localStorage.setItem(
        'emblem_rogue_settings',
        JSON.stringify({ musicVolume: 0, sfxVolume: 0, hints: false }),
      ),
    );
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/?devScene=battle&preset=combat_actions&seed=42&mobilePreview=1&battleLab=1');
    await waitForScene(page, 'Battle');
    await page.waitForFunction(
      () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'PLAYER_IDLE',
    );
    await page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      s._mobileTerrainFocus = { col: s.playerUnits[0].col, row: s.playerUnits[0].row };
    });
    const hud = page.getByRole('complementary', { name: 'Battle commands' });
    await expect(hud.locator('.mb-terrain')).toContainText('Avoid');
    await expect(hud.locator('.mb-counters')).toContainText('Rewinds');
    // region: the scroll box, or the fixed dock that pins Wait beside Danger (playtest 4).
    const visibleWithoutScroll = async (label, region = '.mb-body') => {
      const b = hud.getByRole('button', { name: label, exact: true });
      await expect
        .poll(async () => {
          const bb = await b.boundingBox(),
            body = await hud.locator(region).boundingBox();
          return (
            !!bb &&
            !!body &&
            bb.y >= body.y &&
            bb.y + bb.height <= body.y + body.height + 1 &&
            bb.y + bb.height <= viewport.height + 1
          );
        })
        .toBe(true);
    };
    await visibleWithoutScroll('End turn…');
    await page.screenshot({ path: info.outputPath('idle.png') });
    await hud.getByRole('button', { name: /^Objective details:/ }).click();
    const help = page.getByRole('dialog', { name: 'Battle objective', exact: true });
    await expect(help).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(help).toHaveCount(0);
    await page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('Battle'),
        u = s.enemyUnits[0];
      s.inspectionPanel.show(u, s.grid.getTerrainAt(u.col, u.row), s.gameData);
      s._mobileTerrainFocus = { col: u.col, row: u.row };
    });
    await expect(hud.getByRole('button', { name: 'View unit details', exact: true })).toBeVisible();
    await visibleWithoutScroll('End turn…');
    await page.screenshot({ path: info.outputPath('enemy.png') });
    await page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      s.inspectionPanel.hide();
      s.selectUnit(s.playerUnits[0]);
      s.showActionMenu(s.playerUnits[0]);
    });
    await expect(hud.getByRole('button', { name: 'Wait', exact: true })).toBeVisible();
    await visibleWithoutScroll('Wait', '.mb-dock');
    await expect(hud.locator('.mb-terrain')).toContainText('Def');
    await page.screenshot({ path: info.outputPath('selected.png') });
    const danger = hud.getByRole('button', { name: 'Danger', exact: true });
    await danger.click();
    await expect
      .poll(() =>
        page.evaluate(() => window.__emblemRogueGame.scene.getScene('Battle').dangerZone.visible),
      )
      .toBe(true);
    const box = await danger.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(650);
    await page.mouse.up();
    await expect
      .poll(() =>
        page.evaluate(() => window.__emblemRogueGame.scene.getScene('Battle').keepDangerVisible),
      )
      .toBe(true);
    expect(
      await page.evaluate(() => window.__emblemRogueGame.scene.getScene('Battle').battleState),
    ).toBe('UNIT_ACTION_MENU');
    await expect(hud.getByRole('button', { name: 'Wait', exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  });
}
