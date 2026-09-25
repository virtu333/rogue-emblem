// E2E: playtest-3 polish (docs/specs/playtest-polish.md).
// - Phone: after moving and backing out, the rail reads as "choosing a tile" for the
//   still-selected unit, with an explicit Cancel; another highlighted tile still moves.
// - Desktop: with a unit selected, clicking an enemy it can reach opens the attack
//   forecast (moving to the chosen attack tile first); unreachable enemies keep the
//   old deselect behaviour and idle inspection is unchanged.
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
  // Fixture: Edric (Iron Sword) at (4,4) on plain ground; one enemy two tiles east at
  // (6,4) (reachable only by moving), one far away (unreachable this turn).
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    s.registry.get('settings')?.setHints?.(false);
    const unit = s.playerUnits.find((u) => u.name === 'Edric');
    const [near, far] = s.enemyUnits.filter((u) => u.currentHP > 0);
    const place = (u, col, row) => {
      u.col = col;
      u.row = row;
      const p = s.grid.gridToPixel(col, row);
      if (u.graphic) {
        u.graphic.x = p.x;
        u.graphic.y = p.y;
      }
    };
    for (const other of s.playerUnits.filter((u) => u !== unit)) place(other, 0, 0);
    for (let col = 2; col <= 8; col++)
      for (let row = 2; row <= 6; row++) s.grid.setTerrainAt?.(col, row, 0);
    place(unit, 4, 4);
    place(near, 6, 4);
    place(far, s.grid.cols - 1, s.grid.rows - 1);
    for (const extra of s.enemyUnits.filter((u) => u !== near && u !== far))
      place(extra, s.grid.cols - 1, 0);
    for (const u of [unit, near, far]) u.currentHP = u.stats.HP;
    unit.mov = 5;
    window.__pp = { unit, near, far };
  });
  return errors;
}

async function tilePoint(page, col, row) {
  return page.evaluate(
    ({ col, row }) => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      const w = s.grid.gridToPixel(col, row);
      const p = s._worldToScreen(w.x, w.y);
      const r = s.game.canvas.getBoundingClientRect();
      return {
        x: r.x + (p.x * r.width) / s.scale.width,
        y: r.y + (p.y * r.height) / s.scale.height,
      };
    },
    { col, row },
  );
}

const battle = (page, fn) =>
  page.evaluate(`(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const { unit, near, far } = window.__pp;
    return (${fn})(s, unit, near, far);
  })()`);

test.describe('phone: undoing a move keeps the tile choice readable', () => {
  test.use(phone);

  test('select → move → Back shows "Choose a tile" with Cancel; tiles still move', async ({
    page,
  }, info) => {
    const errors = await bootBattle(page, { mobile: true });
    const hud = page.getByRole('complementary', { name: 'Battle commands' });
    const tap = async (col, row) => {
      const p = await tilePoint(page, col, row);
      await page.touchscreen.tap(p.x, p.y);
    };
    await tap(4, 4);
    await expect.poll(() => battle(page, (s) => s.battleState)).toBe('UNIT_ACTION_MENU');
    await tap(4, 5);
    await expect.poll(() => battle(page, (s) => s.battleState)).toBe('UNIT_ACTION_MENU');
    expect(await battle(page, (s, u) => [u.col, u.row, u.hasMoved])).toEqual([4, 5, true]);

    await page
      .getByRole('navigation', { name: 'Battle utilities' })
      .getByRole('button', { name: 'Back', exact: true })
      .tap();
    await expect.poll(() => battle(page, (s) => s.battleState)).toBe('UNIT_SELECTED');
    expect(await battle(page, (s, u) => [u.col, u.row, u.hasMoved])).toEqual([4, 4, false]);
    // The rail names the unit and the task, and offers an explicit Cancel.
    await expect(hud.locator('.mb-choose-tile')).toHaveText('Choose a tile · Edric');
    const cancel = hud.getByRole('button', { name: 'Cancel selection', exact: true });
    await expect(cancel).toBeVisible();
    await expect(cancel).toHaveText('Cancel');
    // Existing commands stay reachable.
    for (const name of ['Inspect', 'Roster', 'Rewind', 'End turn…'])
      await expect(hud.getByRole('button', { name, exact: true })).toHaveCount(1);
    // Nothing in the rail overflows sideways at 844x390.
    expect(
      await hud.evaluate((root) =>
        [...root.querySelectorAll('.mb-body > *')].every(
          (el) => el.getBoundingClientRect().right <= root.getBoundingClientRect().right + 1,
        ),
      ),
    ).toBe(true);
    // Cancel shares End turn's row, so both stay in view without scrolling.
    expect(
      await hud.evaluate((root) => {
        const body = root.querySelector('.mb-body').getBoundingClientRect();
        return ['.mb-cancel-selection', '.mb-end-turn'].map((sel) => {
          const r = root.querySelector(sel).getBoundingClientRect();
          return r.top >= body.top - 1 && r.bottom <= body.bottom + 1 && r.height >= 44;
        });
      }),
    ).toEqual([true, true]);
    await page.screenshot({ path: info.outputPath('choose-tile-rail.png') });

    // Another highlighted tile still moves her.
    await tap(5, 5);
    await expect.poll(() => battle(page, (s) => s.battleState)).toBe('UNIT_ACTION_MENU');
    expect(await battle(page, (s, u) => [u.col, u.row, u.hasMoved])).toEqual([5, 5, true]);
    await expect(hud.locator('.mb-choose-tile')).toHaveCount(0);

    // Back again, then Cancel deselects.
    await page
      .getByRole('navigation', { name: 'Battle utilities' })
      .getByRole('button', { name: 'Back', exact: true })
      .tap();
    await expect.poll(() => battle(page, (s) => s.battleState)).toBe('UNIT_SELECTED');
    await hud.getByRole('button', { name: 'Cancel selection', exact: true }).tap();
    await expect.poll(() => battle(page, (s) => s.battleState)).toBe('PLAYER_IDLE');
    expect(await battle(page, (s, u) => [s.selectedUnit, u.col, u.row, u.hasMoved])).toEqual([
      null,
      4,
      4,
      false,
    ]);
    await expect(hud.locator('.mb-choose-tile')).toHaveCount(0);
    await expect(hud.getByRole('button', { name: 'Cancel selection' })).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});

test.describe('desktop: clicking an enemy while a unit is selected attacks it', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  const click = async (page, col, row, options) => {
    const p = await tilePoint(page, col, row);
    await page.mouse.click(p.x, p.y, options);
  };
  const state = (page) => battle(page, (s) => s.battleState);

  test('reachable by moving: walks to the attack tile, opens the forecast, unwinds', async ({
    page,
  }, info) => {
    const errors = await bootBattle(page, { mobile: false });
    await click(page, 4, 4);
    await expect.poll(() => state(page)).toBe('UNIT_SELECTED');
    await expect
      .poll(() => battle(page, (s) => s.instructionText2?.text))
      .toContain('enemy in reach: attack');
    // The guide and [X] Cancel fit and show in the footer from the first click.
    await expect
      .poll(() => battle(page, (s) => [s.instructionText2.visible, s.cancelButton.visible]))
      .toEqual([true, true]);
    // Hover previews the walk to the chosen attack tile (the closest: 5,4).
    const p = await tilePoint(page, 6, 4);
    await page.mouse.move(p.x, p.y);
    await expect.poll(() => battle(page, (s) => s._lastPathPreviewKey)).toBe('attack:6,4');
    await page.screenshot({ path: info.outputPath('desktop-attack-preview.png') });

    await click(page, 6, 4);
    await expect.poll(() => state(page)).toBe('SHOWING_FORECAST');
    expect(
      await battle(page, (s, u, near) => [u.col, u.row, u.hasMoved, s.forecastTarget === near]),
    ).toEqual([5, 4, true, true]);
    await page.screenshot({ path: info.outputPath('desktop-attack-forecast.png') });

    // Cancel → targets → action menu → undo the move, exactly as after a manual move.
    await page.keyboard.press('Escape');
    await expect.poll(() => state(page)).toBe('SELECTING_TARGET');
    await page.keyboard.press('Escape');
    await expect.poll(() => state(page)).toBe('UNIT_ACTION_MENU');
    await page.keyboard.press('Escape');
    await expect.poll(() => state(page)).toBe('UNIT_SELECTED');
    expect(await battle(page, (s, u) => [u.col, u.row, u.hasMoved, u.hasActed])).toEqual([
      4,
      4,
      false,
      false,
    ]);
    expect(errors).toEqual([]);
  });

  test('in reach from the current tile: forecast without moving; out of reach: deselect', async ({
    page,
  }) => {
    const errors = await bootBattle(page, { mobile: false });
    await battle(page, (s, u, near) => {
      near.col = 5;
      const p = s.grid.gridToPixel(5, 4);
      near.graphic.x = p.x;
      near.graphic.y = p.y;
    });
    await click(page, 4, 4);
    await expect.poll(() => state(page)).toBe('UNIT_SELECTED');
    await click(page, 5, 4);
    await expect.poll(() => state(page)).toBe('SHOWING_FORECAST');
    expect(await battle(page, (s, u, near) => [u.col, u.row, s.forecastTarget === near])).toEqual([
      4,
      4,
      true,
    ]);
    for (const expected of ['SELECTING_TARGET', 'UNIT_ACTION_MENU', 'UNIT_SELECTED']) {
      await page.keyboard.press('Escape');
      await expect.poll(() => state(page)).toBe(expected);
    }

    // The far enemy cannot be reached this turn: the old behaviour (deselect) stays.
    const far = await battle(page, (s, u, near, far) => [far.col, far.row]);
    await click(page, far[0], far[1]);
    await expect.poll(() => state(page)).toBe('PLAYER_IDLE');
    expect(await battle(page, (s) => s.selectedUnit)).toBeNull();

    // Idle enemy inspection (right-click) is unchanged.
    await click(page, 5, 4, { button: 'right' });
    await expect
      .poll(() =>
        battle(
          page,
          (s, u, near) => s.inspectionPanel?.visible && s.inspectionPanel._unit === near,
        ),
      )
      .toBe(true);
    expect(await state(page)).toBe('PLAYER_IDLE');
    expect(errors).toEqual([]);
  });
});

test.describe('desktop route rail widens with the window', () => {
  // [viewport width, height, expected pane width, expected body text size]
  for (const [width, height, pane, text] of [
    [640, 480, 184, 12],
    [1280, 800, 230, 13.5],
    [1676, 858, 300, 13.5],
    [1920, 1080, 300, 13.5],
  ]) {
    test(`${width}x${height}: pane ${pane}px, text ${text}px, nothing clipped`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width, height });
      await page.goto('/?devScene=nodemap&preset=battle_smoke&seed=42');
      await waitForScene(page, 'NodeMap');
      await page.getByRole('button', { name: 'Skip conversation', exact: true }).click();
      const route = page.locator('.re-node-map');
      await expect(route).toBeVisible();
      await route.locator('.re-node.is-live').first().click();
      await expect(route.locator('.re-loom-state')).toBeVisible();
      const m = await route.evaluate((root) => {
        const side = root.querySelector('.re-node-side');
        const overflowing = [...side.querySelectorAll('*')].filter((el) => {
          const style = getComputedStyle(el);
          if (style.overflowX === 'hidden' && style.textOverflow === 'ellipsis') return false;
          const r = el.getBoundingClientRect();
          const s = side.getBoundingClientRect();
          return r.width > 0 && (r.left < s.left - 1 || r.right > s.right + 1);
        });
        return {
          pane: Math.round(side.getBoundingClientRect().width),
          text: parseFloat(getComputedStyle(root.querySelector('.re-loom-text')).fontSize),
          overflowing: overflowing.map((el) => el.className),
          pageScroll: document.documentElement.scrollWidth > innerWidth,
          cardScroll: (() => {
            const card = root.querySelector('.re-loom-card');
            return card.scrollWidth > card.clientWidth;
          })(),
        };
      });
      expect(Math.abs(m.pane - pane)).toBeLessThanOrEqual(1);
      expect(m.text).toBe(text);
      expect(m.overflowing).toEqual([]);
      expect(m.pageScroll).toBe(false);
      expect(m.cardScroll).toBe(false);
      await page.screenshot({ path: info.outputPath(`route-${width}x${height}.png`) });
    });
  }
});

test.describe('reward bundle copy', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('a Vulnerary ×3 card says "3 uses each"; a single item keeps "3 uses"', async ({
    page,
  }, info) => {
    await page.goto('/?devScene=battle&preset=battle_smoke&seed=42');
    await waitForScene(page, 'Battle');
    await page.evaluate(() => window.__emblemRogueGame.scene.getScene('Battle').onVictory());
    const dialog = page.getByRole('dialog', { name: 'Battle rewards', exact: true });
    await expect(dialog).toBeVisible();
    await page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      const rewards = s._lootController.mobileRewards;
      const vulnerary = structuredClone(
        s.gameData.consumables.find((item) => item.name === 'Vulnerary'),
      );
      rewards.choices[0] = { type: 'consumable', item: vulnerary, quantity: 3 };
      rewards.choices[1] = { type: 'consumable', item: structuredClone(vulnerary) };
      rewards.selected = 0;
      rewards.render();
    });
    const bundle = dialog.locator('.reward-card').nth(0);
    const single = dialog.locator('.reward-card').nth(1);
    await expect(bundle.locator('.ch-reward-name')).toHaveText('Vulnerary ×3');
    await expect(bundle.locator('.ch-lines')).toContainText('3 uses each');
    await expect(single.locator('.ch-reward-name')).toHaveText('Vulnerary');
    await expect(single.locator('.ch-lines p')).toContainText(['3 uses']);
    await expect(single.locator('.ch-lines')).not.toContainText('each');
    await page.screenshot({ path: info.outputPath('reward-bundle.png') });
  });
});
