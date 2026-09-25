import { test, expect, devices } from '@playwright/test';
import { waitForGame, waitForScene } from './helpers.js';

test.use({ ...devices['iPhone 13'], viewport: { width: 844, height: 390 } });

async function bootBattle(page) {
  await page.goto('/?devScene=battle&preset=battle_smoke&seed=42');
  await waitForGame(page);
  await waitForScene(page, 'Battle');
  await page.waitForFunction(() =>
    ['DEPLOY_SELECTION', 'PLAYER_IDLE'].includes(window.__sceneState?.battle?.state),
  );
  // Reuse the deterministic deployment fixture pattern from battle-invariants.
  await page.evaluate(() => {
    const battle = window.__emblemRogueGame.scene.getScene('Battle');
    if (battle.battleState !== 'DEPLOY_SELECTION') return;
    battle.children.list
      .filter((o) => o.type === 'Rectangle' && o.input?.enabled && o.listenerCount('pointerdown'))
      .at(-1)
      ?.emit('pointerdown');
  });
  await expect(page.getByRole('complementary', { name: 'Battle commands' })).toBeVisible();
}

async function prepareMenu(page) {
  await page.evaluate(() => {
    const battle = window.__emblemRogueGame.scene.getScene('Battle');
    const unit = battle.playerUnits.find((u) => u.currentHP > 0 && !u.hasActed);
    battle.selectUnit(unit);
    battle.showActionMenu(unit);
  });
}

async function prepareForecast(page) {
  await page.evaluate(async () => {
    const battle = window.__emblemRogueGame.scene.getScene('Battle');
    const unit = battle.playerUnits.find((u) => u.weapon && u.weapon.type !== 'Staff');
    const enemy = battle.enemyUnits.find((u) => u.currentHP > 0);
    // Place the fixture in combat range; real forecast/weapon logic is retained.
    unit.col = Math.max(0, enemy.col - 1);
    unit.row = enemy.row;
    if (unit.col === enemy.col) unit.col += 1;
    battle.selectUnit(unit);
    battle.hideActionMenu();
    await battle.showForecast(unit, enemy);
  });
  await expect(page.getByRole('dialog', { name: 'Combat forecast' })).toBeVisible();
}

test('commands have readable targets, toggle feedback and reversible end-turn confirmation', async ({
  page,
}) => {
  await bootBattle(page);
  const hud = page.getByRole('complementary', { name: 'Battle commands' });
  await hud.getByRole('button', { name: 'Danger', exact: true }).tap();
  await expect(hud.getByRole('button', { name: 'Danger', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await hud.getByRole('button', { name: 'End turn…', exact: true }).tap();
  await expect(hud.getByRole('button', { name: 'End turn now' })).toBeVisible();
  expect(await page.evaluate(() => window.__sceneState.battle.state)).toBe('PLAYER_IDLE');
  await hud.getByRole('button', { name: 'Keep playing' }).tap();
  await expect(hud.getByRole('button', { name: 'End turn…', exact: true })).toBeVisible();
  // Compact sidebar contract (docs/battle-sidebar-2026-09-22.md): main commands keep a 38px
  // minimum so End turn stays visible at 667x375; bottom navigation keeps 44px.
  const heights = (loc) =>
    loc.evaluateAll((buttons) => buttons.map((b) => b.getBoundingClientRect().height));
  const commandHeights = await heights(hud.locator('.mb-body button'));
  expect(commandHeights.length).toBeGreaterThan(0);
  expect(commandHeights.every((h) => h >= 38)).toBe(true);
  const navHeights = await heights(hud.locator('.bl-tools button'));
  expect(navHeights.length).toBe(4);
  expect(navHeights.every((h) => h >= 44)).toBe(true);
  const commandFonts = await hud
    .locator('.mb-body button')
    .evaluateAll((buttons) => buttons.map((b) => parseFloat(getComputedStyle(b).fontSize)));
  expect(commandFonts.every((font) => font >= 13)).toBe(true);
  await page.screenshot({ path: 'test-results/mobile-battle-commands.png' });
});

test('action list invokes the existing Wait action and releases it afterward', async ({ page }) => {
  await bootBattle(page);
  await prepareMenu(page);
  const hud = page.getByRole('complementary', { name: 'Battle commands' });
  await expect(hud.getByRole('button', { name: 'Wait', exact: true })).toBeVisible();
  const name = await page.evaluate(
    () => window.__emblemRogueGame.scene.getScene('Battle').selectedUnit.name,
  );
  await page.screenshot({ path: 'test-results/mobile-battle-actions.png' });
  await hud.getByRole('button', { name: 'Wait', exact: true }).tap();
  await expect
    .poll(() =>
      page.evaluate(
        (name) =>
          window.__emblemRogueGame.scene.getScene('Battle').playerUnits.find((u) => u.name === name)
            .hasActed,
        name,
      ),
    )
    .toBe(true);
  await expect(hud.getByRole('button', { name: 'Wait', exact: true })).toHaveCount(0);
});

test('forecast requires explicit confirmation, keeps engine numbers and cancels back to actions', async ({
  page,
}) => {
  await bootBattle(page);
  await prepareForecast(page);
  const dialog = page.getByRole('dialog', { name: 'Combat forecast' });
  await expect(dialog).toHaveCSS('display', 'flex');
  await expect(dialog).toHaveCSS('flex-direction', 'column');
  await expect(dialog).toHaveCSS('padding', '14px');
  await expect(dialog).toHaveCSS('border-top-width', '1px');
  expect(await dialog.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(
    'rgba(0, 0, 0, 0)',
  );
  const portrait = dialog.locator('.mb-portrait').first();
  await expect(portrait).toBeVisible();
  await expect(portrait).toHaveCSS('width', '48px');
  await expect(portrait).toHaveCSS('height', '48px');
  await expect(portrait).toHaveCSS('image-rendering', 'pixelated');
  const expected = await page.evaluate(() => {
    const battle = window.__emblemRogueGame.scene.getScene('Battle');
    const f = battle._mobileBattleHud.forecast.forecast.attacker;
    battle.handleForecastClick({ col: battle.forecastTarget.col, row: battle.forecastTarget.row });
    return {
      damage: String(f.damage),
      hits: String(f.attackCount || 1),
      state: battle.battleState,
    };
  });
  expect(expected.state).toBe('SHOWING_FORECAST');
  const ally = dialog.locator('.mb-ally');
  await expect(
    ally
      .locator('dl > div')
      .filter({ has: page.getByText('Damage per hit', { exact: true }) })
      .locator('dd'),
  ).toHaveText(expected.damage);
  await expect(
    ally
      .locator('dl > div')
      .filter({ has: page.getByText('Planned hits', { exact: true }) })
      .locator('dd'),
  ).toHaveText(`${expected.hits}x`);
  await page.screenshot({ path: 'test-results/mobile-battle-forecast.png' });
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).tap();
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => window.__sceneState.battle.state))
    .toBe('SELECTING_TARGET');
  await page
    .getByRole('navigation', { name: 'Battle utilities' })
    .getByRole('button', { name: 'Back', exact: true })
    .tap();
  await expect
    .poll(() => page.evaluate(() => window.__sceneState.battle.state))
    .toBe('UNIT_ACTION_MENU');
});

test('small phones keep long forecasts scrollable with confirmation visible', async ({ page }) => {
  await page.setViewportSize({ width: 667, height: 375 });
  await bootBattle(page);
  await prepareForecast(page);
  await page.evaluate(() => {
    const hud = window.__emblemRogueGame.scene.getScene('Battle')._mobileBattleHud;
    const config = hud.forecast;
    const attacker = { ...config.attacker, name: 'A very long commander name' };
    const forecast = {
      ...config.forecast,
      attacker: { ...config.forecast.attacker, warnings: Array(10).fill('Extra combat warning') },
    };
    hud.showForecast({ ...config, attacker, forecast });
  });
  const dialog = page.getByRole('dialog', { name: 'Combat forecast' });
  const button = dialog.getByRole('button', { name: 'Confirm attack' });
  const box = await button.boundingBox();
  expect(box.y + box.height).toBeLessThanOrEqual(375);
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(
    await dialog.locator('.mb-forecast-sides').evaluate((el) => el.scrollHeight > el.clientHeight),
  ).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/mobile-battle-small-phone.png' });
});

test('higher overlays own input and scene shutdown removes the mobile layer', async ({ page }) => {
  await bootBattle(page);
  const hud = page.getByRole('complementary', { name: 'Battle commands' });
  await hud.getByRole('button', { name: 'Roster', exact: true }).tap();
  // Keep the map viewport stable while a higher sheet owns input.
  // Covered controls are deliberately hidden from the accessibility tree.
  await expect(
    page.getByRole('complementary', { name: 'Battle commands', includeHidden: true }),
  ).toHaveClass(/bl-inactive/);
  await expect(hud).toHaveCount(0);
  const roster = page.getByRole('dialog', { name: 'Inspect roster', exact: true });
  await expect(roster).toBeVisible();
  await roster.getByRole('button', { name: 'Close', exact: true }).tap();
  await expect(hud).not.toHaveClass(/bl-inactive/);
  await expect(hud).toBeVisible();
  await page.evaluate(async () => {
    const { startSceneLazy } = await import('/src/utils/sceneLoader.js');
    await startSceneLazy(window.__emblemRogueGame.scene.getScene('Battle'), 'Title');
  });
  await waitForScene(page, 'Title');
  await expect(hud).toHaveCount(0);
  await expect(page.locator('.mb-forecast-backdrop')).toHaveCount(0);
  await expect(page.locator('#game-wrapper')).not.toHaveClass(/mobile-battle-layout/);
});

test('confirming the forecast commits combat once and removes the dialog', async ({ page }) => {
  await bootBattle(page);
  await prepareForecast(page);
  await page.evaluate(() => {
    const battle = window.__emblemRogueGame.scene.getScene('Battle');
    const original = battle.executeCombat.bind(battle);
    window.__mobileCombatCommits = 0;
    battle.executeCombat = (...args) => {
      window.__mobileCombatCommits += 1;
      return original(...args);
    };
  });
  await page
    .getByRole('dialog', { name: 'Combat forecast' })
    .getByRole('button', { name: 'Confirm attack' })
    .tap();
  await expect(page.getByRole('dialog', { name: 'Combat forecast' })).toHaveCount(0);
  expect(await page.evaluate(() => window.__mobileCombatCommits)).toBe(1);
});

test('forecast weapon cycling updates the preview without committing combat', async ({ page }) => {
  await bootBattle(page);
  await prepareForecast(page);
  // The weapon stepper lives beside the attacker's name (◀ Iron Sword [E] 1/2 ▶).
  const before = await page.locator('.mb-ally .mb-step-name').innerText();
  await page
    .getByRole('dialog', { name: 'Combat forecast' })
    .getByRole('button', { name: 'Next weapon', exact: true })
    .tap();
  await expect(page.locator('.mb-ally .mb-step-name')).not.toHaveText(before);
  expect(await page.evaluate(() => window.__sceneState.battle.state)).toBe('SHOWING_FORECAST');
});

test('real map taps select a unit and open its touch action list', async ({ page }) => {
  await bootBattle(page);
  const position = await page.evaluate(() => {
    const battle = window.__emblemRogueGame.scene.getScene('Battle');
    const unit = battle.playerUnits.find((u) => u.currentHP > 0 && !u.hasActed);
    const world = battle.grid.gridToPixel(unit.col, unit.row);
    const screen = battle._worldToScreen(world.x, world.y);
    const canvas = battle.game.canvas.getBoundingClientRect();
    return {
      name: unit.name,
      x: canvas.x + (screen.x * canvas.width) / battle.scale.width,
      y: canvas.y + (screen.y * canvas.height) / battle.scale.height,
    };
  });
  await page.touchscreen.tap(position.x, position.y);
  await expect
    .poll(() => page.evaluate(() => window.__sceneState.battle.state))
    .toBe('UNIT_ACTION_MENU');
  await expect(page.locator('.mb-summary h2')).toHaveText(position.name);
  await expect(
    page
      .getByRole('complementary', { name: 'Battle commands' })
      .getByRole('button', { name: 'Wait', exact: true }),
  ).toBeVisible();
});

test('small landscape canvas fits its container when touch panels are present', async ({
  page,
}) => {
  await page.setViewportSize({ width: 667, height: 375 });
  await bootBattle(page);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const parent = document.getElementById('game-container').getBoundingClientRect();
        const canvas = document.querySelector('#game-container canvas').getBoundingClientRect();
        return (
          canvas.left >= parent.left - 1 &&
          canvas.right <= parent.right + 1 &&
          canvas.top >= parent.top - 1 &&
          canvas.bottom <= parent.bottom + 1
        );
      }),
    )
    .toBe(true);
});

test('end-turn prompt locates a ready unit without spending its action, then the next', async ({
  page,
}) => {
  await bootBattle(page);
  await page.waitForFunction(() => window.__sceneState?.battle?.state === 'PLAYER_IDLE');
  // Ready units are walked in reading order (row, then column).
  const names = await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const ready = s.playerUnits
      .filter((u) => u.currentHP > 0 && !u.hasActed)
      .sort((a, b) => a.row - b.row || a.col - b.col);
    const unit = ready[0];
    const opposite = s.grid.gridToPixel(
      unit.col < s.grid.cols / 2 ? s.grid.cols - 1 : 0,
      unit.row < s.grid.rows / 2 ? s.grid.rows - 1 : 0,
    );
    s.cameras.main.setZoom(s._battleCamera?.maxZoom || 3);
    s.cameras.main.centerOn(opposite.x, opposite.y);
    s._battleCamera?.clampToBounds();
    return ready.map((u) => u.name);
  });
  const [name] = names;
  await page.waitForFunction((name) => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const unit = s.playerUnits.find((u) => u.name === name);
    const point = s.grid.gridToPixel(unit.col, unit.row);
    return !s.cameras.main.worldView.contains(point.x, point.y);
  }, name);
  const hud = page.getByRole('complementary', { name: 'Battle commands' });
  await hud.getByRole('button', { name: 'End turn…', exact: true }).tap();
  const count = names.length > 1 ? ` · 1 of ${names.length}` : '';
  await hud.getByRole('button', { name: `Show ${name}${count}`, exact: true }).tap();
  await expect(hud.getByRole('button', { name: 'End turn now' })).toHaveCount(0);
  // Brought into view, selected (move range and unit panel live), action unspent,
  // and marked by the locator brackets.
  await expect
    .poll(() =>
      page.evaluate((name) => {
        const s = window.__emblemRogueGame.scene.getScene('Battle');
        const unit = s.playerUnits.find((u) => u.name === name);
        const point = s.grid.gridToPixel(unit.col, unit.row);
        const view = s.cameras.main.worldView;
        return {
          ready: !unit.hasActed,
          visible: view.contains(point.x, point.y),
          state: s.battleState,
          selected: s.selectedUnit === unit,
          locator: Boolean(s._unitLocator),
        };
      }, name),
    )
    .toEqual({ ready: true, visible: true, state: 'UNIT_SELECTED', selected: true, locator: true });
  if (names.length < 2) return;
  // Cancel the selection; the prompt now offers the next ready unit.
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__sceneState?.battle?.state === 'PLAYER_IDLE');
  await hud.getByRole('button', { name: 'End turn…', exact: true }).tap();
  await hud
    .getByRole('button', { name: `Show ${names[1]} · 2 of ${names.length}`, exact: true })
    .tap();
  await expect
    .poll(() =>
      page.evaluate(
        (name) => window.__emblemRogueGame.scene.getScene('Battle').selectedUnit?.name === name,
        names[1],
      ),
    )
    .toBe(true);
});

// Playtest 4: Wait, the most common command, sat below the fold of a six-command menu
// (Guidance Full keeps a greyed Attack row). It is pinned in the fixed dock beside a
// compact Danger; the list keeps the canvas order, primary first, and scrolls the rest.
// 667x375 (iPhone SE 2nd gen) is the smallest supported landscape; 568x320 is a margin.
for (const viewport of [
  { width: 844, height: 390 },
  { width: 667, height: 375 },
  { width: 568, height: 320 },
]) {
  test(`Wait is pinned in view in a six-command menu at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setViewportSize(viewport);
    await page.addInitScript(() =>
      localStorage.setItem(
        'emblem_rogue_settings',
        JSON.stringify({ musicVolume: 0, sfxVolume: 0, hints: true, guidance: 'full' }),
      ),
    );
    await page.goto('/?devScene=battle&preset=combat_actions&seed=42');
    await waitForScene(page, 'Battle');
    await page.waitForFunction(
      () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'PLAYER_IDLE',
    );
    const hud = page.getByRole('complementary', { name: 'Battle commands' });
    // Idle: the dock is Danger alone, full width.
    await expect(hud.locator('.mb-dock .mb-danger-toggle')).toBeVisible();
    await expect(hud.locator('.mb-dock .mb-pinned-command')).toHaveCount(0);

    // Support has six commands on Full: greyed Attack, Shove, Pull, Trade, Swap, Wait.
    const canvas = await page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      const u = s.playerUnits.find((p) => p.name === 'Support');
      s.selectUnit(u);
      s.showActionMenu(u);
      return {
        labels: s.actionMenu.filter((o) => typeof o?._action === 'function').map((o) => o.text),
        focus: s._menuFocus.items.map((item) => item.label),
      };
    });
    // The canvas menu and the keyboard/gamepad order are unchanged: Wait last.
    expect(canvas.labels).toEqual(['Attack', 'Shove', 'Pull', 'Trade', 'Swap', 'Wait']);
    expect(canvas.focus).toEqual(['Shove', 'Pull', 'Trade', 'Swap', 'Wait']);
    const list = hud.locator('.mb-body .mb-actions > button');
    await expect(list).toHaveCount(5);
    await expect(list.first()).toContainText('No target in range 1');
    await expect(list.first()).toBeDisabled();
    const wait = hud.getByRole('button', { name: 'Wait', exact: true });
    await expect(wait).toHaveCount(1);
    await expect(hud.locator('.mb-dock .mb-pinned-command')).toHaveText('Wait');

    const layout = () =>
      page.evaluate(() => {
        const body = document.querySelector('.mobile-battle-hud .mb-body');
        const root = document.querySelector('.mobile-battle-hud').getBoundingClientRect();
        const b = body.getBoundingClientRect();
        const w = document.querySelector('.mb-dock .mb-pinned-command').getBoundingClientRect();
        const d = document.querySelector('.mb-dock .mb-danger-toggle').getBoundingClientRect();
        const hit = document.elementFromPoint(w.left + w.width / 2, w.top + w.height / 2);
        return {
          scrollTop: body.scrollTop,
          // Fully on screen, inside the rail, clear of the scroll region: no scroll needed.
          waitInView:
            w.top >= root.top &&
            w.bottom <= Math.min(root.bottom, innerHeight) + 0.5 &&
            w.left >= root.left - 0.5 &&
            w.right <= root.right + 0.5 &&
            w.top >= b.bottom - 0.5 &&
            w.height >= 44,
          waitOnTop: Boolean(hit?.closest('.mb-pinned-command')),
          sameRow: Math.abs(w.top - d.top) < 1 && d.height >= 44 && d.left >= w.right,
          dangerInView: d.bottom <= innerHeight + 0.5,
        };
      });
    await expect.poll(layout).toEqual({
      scrollTop: 0,
      waitInView: true,
      waitOnTop: true,
      sameRow: true,
      dangerInView: true,
    });
    await expect(hud.getByRole('button', { name: 'Danger', exact: true })).toBeVisible();

    // The other commands stay reachable in the scroll region ("more ▾" when they overflow).
    const overflows = await page.evaluate(() => {
      const body = document.querySelector('.mobile-battle-hud .mb-body');
      return body.scrollHeight > body.clientHeight + 2;
    });
    if (overflows) await expect(page.locator('.mb-scroll-cue')).toHaveText('more ▾');
    for (const label of ['Shove', 'Pull', 'Trade', 'Swap']) {
      const button = hud.getByRole('button', { name: label, exact: true });
      await button.scrollIntoViewIfNeeded();
      const reachable = await button.evaluate((el) => {
        const body = el.closest('.mb-body').getBoundingClientRect();
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        // Scrolled fully into view (a row taller than the 568x320 viewport: its centre).
        const inside =
          r.height > body.height || (r.top >= body.top - 0.5 && r.bottom <= body.bottom + 0.5);
        return inside && Boolean(hit && el.contains(hit));
      });
      expect(reachable, label).toBe(true);
    }
    // Scrolling the list never moves Wait.
    await expect.poll(layout).toMatchObject({ waitInView: true, waitOnTop: true });

    // Keyboard/gamepad: focus walks the list and ends on the pinned Wait.
    await hud.getByRole('button', { name: 'Shove', exact: true }).focus();
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowDown');
    await expect(wait).toBeFocused();
    await expect(wait).toHaveClass(/mb-menu-focused/);
    await page.keyboard.press('ArrowDown'); // wraps back to the first enabled command
    await expect(hud.getByRole('button', { name: 'Shove', exact: true })).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(wait).toBeFocused();

    if (viewport.width === 844)
      await page.screenshot({ path: test.info().outputPath('pinned-wait.png') });
    await wait.tap();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            window.__emblemRogueGame.scene
              .getScene('Battle')
              .playerUnits.find((u) => u.name === 'Support').hasActed,
        ),
      )
      .toBe(true);
    await expect(hud.locator('.mb-dock .mb-pinned-command')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
