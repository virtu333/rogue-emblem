// E2E: target-first attack flow (docs/specs/attack-flow.md).
// Attack → every enemy reachable with ANY usable weapon → pick a target → the
// forecast opens on the equipped weapon (or the first that can hit) → switch
// weapons/targets in the forecast with live numbers → Cancel/Back paths →
// confirming with another weapon equips it and moves it to the top. Until then
// the forecast only plans the weapon (scene._forecastWeapon): nothing is equipped.
import { test, expect, devices } from '@playwright/test';
import { waitForGame, waitForScene } from './helpers.js';

const phone = { ...devices['iPhone 13'], viewport: { width: 844, height: 390 } };
delete phone.defaultBrowserType;

async function bootBattle(page, { mobile }) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(
    `/?devScene=battle&preset=battle_smoke&seed=42${mobile ? '&mobilePreview=1&battleLab=1' : ''}`,
  );
  await waitForGame(page);
  await waitForScene(page, 'Battle');
  await page.waitForFunction(() =>
    ['DEPLOY_SELECTION', 'PLAYER_IDLE'].includes(window.__sceneState?.battle?.state),
  );
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    if (s.battleState === 'DEPLOY_SELECTION')
      s.children.list
        .filter((o) => o.type === 'Rectangle' && o.input?.enabled && o.listenerCount('pointerdown'))
        .at(-1)
        ?.emit('pointerdown');
  });
  await page.waitForFunction(() => window.__sceneState?.battle?.state === 'PLAYER_IDLE');
  // Fixture: Edric carries Iron Sword (equipped), Steel Sword and Iron Bow; a
  // Fighter stands adjacent and a second enemy two tiles away (bow only).
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    s.registry.get('settings')?.setHints?.(false);
    const unit = s.playerUnits.find((u) => u.name === 'Edric');
    const [near, far] = s.enemyUnits.filter((u) => u.currentHP > 0);
    const item = (name, uid) => ({
      ...structuredClone(s.gameData.weapons.find((w) => w.name === name)),
      uid,
    });
    unit.proficiencies = [
      { type: 'Sword', rank: 'Prof' },
      { type: 'Bow', rank: 'Prof' },
    ];
    unit.inventory = [item('Iron Sword', 'e2e-iron'), item('Steel Sword', 'e2e-steel')];
    unit.inventory.push(item('Iron Bow', 'e2e-bow'));
    unit.weapon = unit.inventory[0];
    const place = (u, col, row) => {
      u.col = col;
      u.row = row;
      const p = s.grid.gridToPixel(col, row);
      if (u.graphic) {
        u.graphic.x = p.x;
        u.graphic.y = p.y;
      }
    };
    // Keep every other unit clear of the test tiles.
    for (const other of s.playerUnits.filter((u) => u !== unit)) place(other, 0, 0);
    place(unit, 4, 4);
    place(near, 5, 4);
    place(far, 4, 6);
    for (const extra of s.enemyUnits.filter((u) => u !== near && u !== far))
      place(extra, s.grid.cols - 1, s.grid.rows - 1);
    for (const u of [unit, near, far]) {
      s.grid.setTerrainAt?.(u.col, u.row, 0);
      u.currentHP = u.stats.HP;
    }
    s.grid.setTerrainAt?.(4, 5, 0);
    window.__af = { unit, near, far };
  });
  return errors;
}

const state = (page) => page.evaluate(() => window.__sceneState.battle.state);
const weaponName = (page) => page.evaluate(() => window.__af.unit.weapon.name);
const plannedName = (page) =>
  page.evaluate(() => window.__emblemRogueGame.scene.getScene('Battle')._forecastWeapon?.name);
const bagOrder = (page) => page.evaluate(() => window.__af.unit.inventory.map((w) => w.name));
const rngCursor = (page) =>
  page.evaluate(
    () => window.__emblemRogueGame.scene.getScene('Battle')._battleRng?.getState?.().cursor ?? null,
  );

async function openActionMenu(page) {
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    s.selectUnit(window.__af.unit);
    s.preMoveLoc = { col: 4, row: 4 };
    s.showActionMenu(window.__af.unit);
  });
}

test.describe('desktop attack flow', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('Attack goes target-first; keys cycle targets/weapons; Cancel and Back unwind', async ({
    page,
  }, info) => {
    const errors = await bootBattle(page, { mobile: false });
    await openActionMenu(page);
    const cursorBefore = await rngCursor(page);
    await page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      s.actionMenu.find((o) => o.text === 'Attack').emit('pointerdown', { button: 0 });
    });
    expect(await state(page)).toBe('SELECTING_TARGET');
    const targets = await page.evaluate(() =>
      window.__emblemRogueGame.scene
        .getScene('Battle')
        .attackTargets.map((t) => (t === window.__af.near ? 'near' : 'far')),
    );
    // Range union: the far enemy is reachable only with the bow.
    expect(targets).toEqual(['near', 'far']);
    await page.screenshot({ path: info.outputPath('targets.png') });

    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await expect.poll(() => state(page)).toBe('SHOWING_FORECAST');
    // The equipped sword cannot reach: default is the first weapon that can.
    expect(await plannedName(page)).toBe('Iron Bow');
    expect(await weaponName(page)).toBe('Iron Sword');

    await page.keyboard.press('ArrowUp');
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            window.__emblemRogueGame.scene.getScene('Battle').forecastTarget === window.__af.near,
        ),
      )
      .toBe(true);
    // A new target starts from the equipped weapon.
    expect(await plannedName(page)).toBe('Iron Sword');
    const texts = () =>
      page.evaluate(() =>
        window.__emblemRogueGame.scene
          .getScene('Battle')
          ._forecastOverlay.displayObjects.filter((o) => o.text)
          .map((o) => o.text),
      );
    const before = await texts();
    expect(before).toContain('E');
    expect(before).toContain('1/2');
    await page.keyboard.press('ArrowRight');
    expect(await plannedName(page)).toBe('Steel Sword');
    expect(await weaponName(page)).toBe('Iron Sword');
    const after = await texts();
    expect(after).toContain('2/2');
    expect(after.join('|')).not.toBe(before.join('|'));
    expect(after).not.toContain('E');
    // Planning only: the bag does not move while cycling.
    expect(await bagOrder(page)).toEqual(['Iron Sword', 'Steel Sword', 'Iron Bow']);
    await page.screenshot({ path: info.outputPath('forecast-steel.png') });

    await page.keyboard.press('Escape');
    expect(await state(page)).toBe('SELECTING_TARGET');
    expect(
      await page.evaluate(
        () =>
          window.__emblemRogueGame.scene.getScene('Battle')._attackFlowController.focusedTarget ===
          window.__af.near,
      ),
    ).toBe(true);
    expect(await weaponName(page)).toBe('Iron Sword');
    await page.keyboard.press('Escape');
    expect(await state(page)).toBe('UNIT_ACTION_MENU');
    expect(await weaponName(page)).toBe('Iron Sword');
    // Planning never advanced the battle RNG.
    expect(await rngCursor(page)).toBe(cursorBefore);
    expect(errors).toEqual([]);
  });

  test('confirming with another weapon equips it at the top of the inventory', async ({ page }) => {
    const errors = await bootBattle(page, { mobile: false });
    await openActionMenu(page);
    await page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      s.actionMenu.find((o) => o.text === 'Attack').emit('pointerdown', { button: 0 });
    });
    // Click the near enemy on the map (real pointer path) to open its forecast.
    await page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      s._inputController.handleTargetClick({
        col: window.__af.near.col,
        row: window.__af.near.row,
      });
    });
    await expect.poll(() => state(page)).toBe('SHOWING_FORECAST');
    await page.keyboard.press('ArrowRight');
    expect(await plannedName(page)).toBe('Steel Sword');
    expect(await weaponName(page)).toBe('Iron Sword');
    await page.keyboard.press('Enter');
    await expect
      .poll(() => state(page), { timeout: 20_000 })
      .not.toMatch(/SHOWING_FORECAST|COMBAT_RESOLVING/);
    expect(await bagOrder(page)).toEqual(['Steel Sword', 'Iron Sword', 'Iron Bow']);
    expect(await weaponName(page)).toBe('Steel Sword');
    expect(errors).toEqual([]);
  });
});

test.describe('phone attack flow (844×390)', () => {
  test.use(phone);

  test('tap Attack → target list → forecast; weapon stepper/swipe; Cancel/Back', async ({
    page,
  }, info) => {
    const errors = await bootBattle(page, { mobile: true });
    await openActionMenu(page);
    const hud = page.getByRole('complementary', { name: 'Battle commands' });
    await hud.getByRole('button', { name: 'Attack', exact: true }).tap();
    expect(await state(page)).toBe('SELECTING_TARGET');
    const targets = hud.getByRole('group', { name: 'Attack targets' });
    await expect(targets.getByRole('button')).toHaveCount(2);
    await page.screenshot({ path: info.outputPath('phone-targets.png') });

    await targets.getByRole('button').first().tap();
    const dialog = page.getByRole('dialog', { name: 'Combat forecast' });
    await expect(dialog).toBeVisible();
    const stepper = dialog.getByRole('group', { name: 'Weapon' });
    await expect(stepper).toContainText('Iron Sword');
    await expect(stepper).toContainText('1/2');
    await expect(stepper.getByRole('img', { name: 'Equipped' })).toBeVisible();
    const damage = () =>
      dialog
        .locator('.mb-ally .mb-stats div')
        .filter({ has: page.locator('dt', { hasText: /^Damage per hit$/ }) })
        .locator('dd')
        .innerText();
    const ironDamage = await damage();
    await page.screenshot({ path: info.outputPath('phone-forecast.png') });

    await stepper.getByRole('button', { name: 'Next weapon' }).tap();
    await expect(stepper).toContainText('Steel Sword');
    await expect(stepper.getByRole('img', { name: 'Equipped' })).toHaveCount(0);
    expect(await damage()).not.toBe(ironDamage);
    expect(await bagOrder(page)).toEqual(['Iron Sword', 'Steel Sword', 'Iron Bow']);
    // Focus stays on the stepper across the rebuild.
    await expect(stepper.getByRole('button', { name: 'Next weapon' })).toBeFocused();

    // Swipe right on the forecast = previous weapon.
    const box = await dialog.locator('.mb-forecast-sides').boundingBox();
    await page.evaluate(
      ({ x, y }) => {
        const el = document.querySelector('.mb-forecast-sides');
        const fire = (type, cx) =>
          el.dispatchEvent(
            new PointerEvent(type, {
              clientX: cx,
              clientY: y,
              pointerId: 7,
              isPrimary: true,
              pointerType: 'touch',
              bubbles: true,
            }),
          );
        fire('pointerdown', x);
        fire('pointerup', x + 120);
      },
      { x: box.x + 40, y: box.y + box.height / 2 },
    );
    await expect(dialog.getByRole('group', { name: 'Weapon' })).toContainText('Iron Sword');

    // Target stepper on the enemy side switches to the bow-only target.
    await dialog
      .getByRole('group', { name: 'Target' })
      .getByRole('button', { name: 'Next target' })
      .tap();
    await expect(dialog.getByRole('group', { name: 'Target' })).toContainText('Target 2 of 2');
    expect(await plannedName(page)).toBe('Iron Bow');
    expect(await weaponName(page)).toBe('Iron Sword');
    await expect(dialog.locator('.mb-ally .mb-weapon')).toContainText('Iron Bow');
    await page.screenshot({ path: info.outputPath('phone-forecast-bow.png') });

    await dialog.getByRole('button', { name: 'Cancel', exact: true }).tap();
    await expect(dialog).toHaveCount(0);
    expect(await state(page)).toBe('SELECTING_TARGET');
    await expect(targets.locator('.mb-target-focused')).toContainText(
      await page.evaluate(() => window.__af.far.name),
    );
    expect(await weaponName(page)).toBe('Iron Sword');
    await hud
      .page()
      .evaluate(() =>
        window.__emblemRogueGame.scene.getScene('Battle').requestCancel({ allowPause: false }),
      );
    expect(await state(page)).toBe('UNIT_ACTION_MENU');
    await expect(hud.getByRole('button', { name: 'Attack', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(errors).toEqual([]);
  });

  test('after moving, tapping an enemy in reach opens its forecast directly', async ({ page }) => {
    const errors = await bootBattle(page, { mobile: true });
    await page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      const unit = window.__af.unit;
      s.selectUnit(unit);
      unit.hasMoved = true;
      unit._movementCommitted = true;
      s.showActionMenu(unit);
    });
    const point = await page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      const t = window.__af.near;
      const world = s.grid.gridToPixel(t.col, t.row);
      const screen = s._worldToScreen(world.x, world.y);
      const canvas = s.game.canvas.getBoundingClientRect();
      return {
        x: canvas.x + (screen.x * canvas.width) / s.scale.width,
        y: canvas.y + (screen.y * canvas.height) / s.scale.height,
      };
    });
    await page.touchscreen.tap(point.x, point.y);
    await expect.poll(() => state(page)).toBe('SHOWING_FORECAST');
    const dialog = page.getByRole('dialog', { name: 'Combat forecast' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('group', { name: 'Weapon' })).toContainText('Iron Sword');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).tap();
    expect(await state(page)).toBe('SELECTING_TARGET');
    expect(errors).toEqual([]);
  });

  test('confirming a switched weapon puts it first everywhere it is listed', async ({ page }) => {
    const errors = await bootBattle(page, { mobile: true });
    await openActionMenu(page);
    const hud = page.getByRole('complementary', { name: 'Battle commands' });
    await hud.getByRole('button', { name: 'Attack', exact: true }).tap();
    await hud.getByRole('group', { name: 'Attack targets' }).getByRole('button').first().tap();
    const dialog = page.getByRole('dialog', { name: 'Combat forecast' });
    await dialog.getByRole('button', { name: 'Next weapon' }).tap();
    await dialog.getByRole('button', { name: 'Confirm attack' }).tap();
    await expect
      .poll(() => state(page), { timeout: 20_000 })
      .not.toMatch(/SHOWING_FORECAST|COMBAT_RESOLVING/);
    expect(await bagOrder(page)).toEqual(['Steel Sword', 'Iron Sword', 'Iron Bow']);
    expect(errors).toEqual([]);
  });
});
