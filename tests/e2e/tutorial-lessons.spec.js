import { test, expect, devices } from '@playwright/test';
import { waitForScene } from './helpers.js';
test.use({ ...devices['iPhone SE'], viewport: { width: 667, height: 375 } });
test.setTimeout(90000);
async function tapTile(page, col, row) {
  const p = await page.evaluate(
    ({ col, row }) => {
      const s = window.__emblemRogueGame.scene.getScene('Battle'),
        w = s.grid.gridToPixel(col, row),
        p = s._worldToScreen(w.x, w.y),
        r = s.game.canvas.getBoundingClientRect();
      return {
        x: r.x + (p.x * r.width) / s.scale.width,
        y: r.y + (p.y * r.height) / s.scale.height,
      };
    },
    { col, row },
  );
  await page.touchscreen.tap(p.x, p.y);
}
test('fresh tutorial teaches visible terrain, forecast and resource lessons with safe first-run handoff', async ({
  page,
}, info) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?mobilePreview=1&battleLab=1');
  await waitForScene(page, 'Title');
  await page.waitForFunction(() => {
    const s = window.__emblemRogueGame.scene.getScene('Title');
    return s._menuButtons?.length && s.input.enabled && s._menuButtons[0].alpha === 1;
  });
  const p = await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Title');
    const walk = (ns) => ns.flatMap((o) => [o, ...(Array.isArray(o.list) ? walk(o.list) : [])]);
    const t = walk(s.children.list).find((o) => o.text === 'TUTORIAL');
    if (!t) throw new Error('Fresh profile should promote tutorial');
    const b = t.getBounds(),
      hit = t.parentContainer._hitZone.getBounds(),
      subtitle = t.parentContainer.list.find((child) => child.text === 'START HERE'),
      r = s.game.canvas.getBoundingClientRect();
    if (
      !subtitle ||
      b.left < hit.left ||
      b.right > hit.right ||
      subtitle.getBounds().right > hit.right
    )
      throw new Error('Tutorial recommendation must fit its tap target');
    return {
      x: r.x + (b.centerX * r.width) / s.scale.width,
      y: r.y + (b.centerY * r.height) / s.scale.height,
    };
  });
  await page.touchscreen.tap(p.x, p.y);
  await waitForScene(page, 'Battle');
  const note = page.getByRole('dialog', { name: 'Field notes', exact: true });
  await expect(note).toContainText('Welcome to the tutorial');
  await note.getByRole('button', { name: 'Continue', exact: true }).tap();
  await expect(note).toContainText('blue unit');
  await note.getByRole('button', { name: 'Continue', exact: true }).tap();
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Battle').tutorialStep === 2,
  );
  await tapTile(page, 1, 2);
  await expect(note).toContainText('highlighted Fort');
  await note.getByRole('button', { name: 'Continue', exact: true }).tap();
  await tapTile(page, 3, 3);
  await expect(note).toContainText('Fort tile reached');
  await expect(note).toContainText('Defense +2');
  await expect(page.locator('.mobile-battle-hud')).toBeVisible();
  await expect.poll(() => page.locator('.mobile-battle-hud').evaluate((e) => e.inert)).toBe(true);
  expect(
    await page.evaluate(
      () => window.__emblemRogueGame.scene.getScene('Battle')._mobileTerrainFocus,
    ),
  ).toEqual({ col: 3, row: 3 });
  await page.screenshot({ path: info.outputPath('fort-note.png') });
  await note.getByRole('button', { name: 'Continue', exact: true }).tap();
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Battle')._tutorialStrictGateReleased,
  );

  // Controlled matchup exercises each real forecast lesson without depending on AI movement or random hits.
  for (const expected of ['Review damage per hit', 'Weapon triangle', 'Attack speed']) {
    await page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('Battle'),
        a = s.playerUnits[0],
        d = s.enemyUnits[0];
      s.hideForecast();
      s.hideActionMenu();
      a.skills = [];
      d.skills = [];
      a.accessory = null;
      d.accessory = null;
      a.stats.SPD = 20;
      d.stats.SPD = 1;
      a.stats.STR = 10;
      d.stats.HP = 100;
      d.currentHP = 100;
      d.col = a.col + 1;
      d.row = a.row;
      a.weapon = { ...s.gameData.weapons.find((w) => w.name === 'Iron Sword') };
      a.inventory = [a.weapon];
      d.weapon = { ...s.gameData.weapons.find((w) => w.name === 'Iron Axe') };
      d.inventory = [d.weapon];
      void s.showForecast(a, d);
    });
    await expect(note).toContainText(expected);
    const forecast = page.getByRole('dialog', { name: 'Combat forecast', exact: true });
    await expect(forecast).toBeVisible();
    await expect.poll(() => forecast.locator('..').evaluate((e) => e.inert)).toBe(true);
    expect(await note.getByRole('button', { name: 'Continue', exact: true }).count()).toBe(1);
    await expect(page.locator('.mb-tutorial-forecast')).toBeVisible();
    await expect
      .poll(async () => {
        const subjects = await page.locator('.mb-tutorial-subject').all();
        const noteRect = await note.boundingBox();
        if (!subjects.length || !noteRect) return false;
        for (const subject of subjects) {
          const rect = await subject.boundingBox();
          if (!rect || rect.y < 0 || rect.y + rect.height > noteRect.y - 1) return false;
        }
        return true;
      })
      .toBe(true);
    await page.screenshot({ path: info.outputPath(`forecast-${expected.split(' ')[0]}.png`) });
    await note.getByRole('button', { name: 'Continue', exact: true }).tap();
    await expect(note).toHaveCount(0);
    await expect(page.locator('.mb-tutorial-forecast')).toHaveCount(0);
    await expect.poll(() => forecast.locator('..').evaluate((e) => e.inert)).toBe(false);
    await forecast.getByRole('button', { name: 'Cancel', exact: true }).tap();
  }
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle'),
      sera = s.playerUnits.find((u) => u.name === 'Sera'),
      edric = s.playerUnits[0];
    edric.currentHP = 1;
    sera.col = edric.col;
    sera.row = edric.row + 1;
    s.selectedUnit = sera;
    s.battleState = 'UNIT_ACTION_MENU';
    s.startHealTargetSelection(sera, [edric]);
  });
  await expect(note).toContainText('Staff uses refill every battle');
  await note.getByRole('button', { name: 'Continue', exact: true }).tap();
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'SELECTING_HEAL_TARGET',
  );
  await page.evaluate(() => window.__emblemRogueGame.scene.getScene('Battle').onVictory());
  await expect(note).toContainText('completed the tutorial');
  await note.getByRole('button', { name: 'Continue', exact: true }).tap();
  await waitForScene(page, 'Title');
  await page.waitForFunction(() => {
    const s = window.__emblemRogueGame.scene.getScene('Title'),
      walk = (ns) => ns.flatMap((o) => [o, ...(Array.isArray(o.list) ? walk(o.list) : [])]);
    return walk(s.children.list).some((o) => o.text === 'START FIRST RUN');
  });
  const taught = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('emblem_rogue_tutorial_lessons')),
  );
  expect(taught).toEqual(
    expect.arrayContaining([
      'battle_terrain',
      'battle_triangle',
      'battle_doubling',
      'battle_staff_scope',
    ]),
  );
  expect(errors).toEqual([]);
});
