// Unarmed units in a real battle (docs/specs/item-trade.md, "Unarmed units").
//
// A Fighter carrying nothing at all is fielded through Formation, selected, offered
// no working Attack (Full Guidance greys it with the reason), Waits, is struck by an
// enemy through the real combat presentation without countering, is inspected, and
// sits through a whole enemy phase — on a phone and on a desktop, with no page error.
import { test, expect, devices } from '@playwright/test';
import { waitForScene, finishFormation } from './helpers.js';

const phone = { ...devices['iPhone SE'], viewport: { width: 667, height: 375 } };
delete phone.defaultBrowserType;
const SETTINGS = JSON.stringify({ musicVolume: 0, sfxVolume: 0, guidance: 'full' });

const battle = (page, fn, arg) =>
  page.evaluate(
    ([source, a]) => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      return new Function('s', 'a', source)(s, a);
    },
    [fn, arg],
  );

async function tile(page, col, row, mobile) {
  const p = await page.evaluate(
    ({ col, row }) => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      const w = s.grid.gridToPixel(col, row),
        p = s._worldToScreen(w.x, w.y),
        r = s.game.canvas.getBoundingClientRect();
      return {
        x: r.x + (p.x * r.width) / s.scale.width,
        y: r.y + (p.y * r.height) / s.scale.height,
      };
    },
    { col, row },
  );
  if (mobile) await page.touchscreen.tap(p.x, p.y);
  else await page.mouse.click(p.x, p.y);
}

const state = (page) => battle(page, 'return s.battleState;');
async function waitState(page, value, timeout = 20_000) {
  await page.waitForFunction(
    (v) => window.__emblemRogueGame.scene.getScene('Battle')?.battleState === v,
    value,
    { timeout },
  );
}

for (const mobile of [true, false]) {
  test.describe(mobile ? 'phone' : 'desktop', () => {
    test.use(mobile ? phone : { viewport: { width: 1280, height: 800 } });

    test('an unarmed Fighter deploys, cannot attack or counter, waits and survives the enemy phase', async ({
      page,
    }, testInfo) => {
      test.slow(); // formation, a menu, a scripted strike and a full enemy phase
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.addInitScript((s) => localStorage.setItem('emblem_rogue_settings', s), SETTINGS);
      await page.goto(
        `/?devScene=battle&preset=combat_actions&seed=42&formation=1${mobile ? '&mobilePreview=1' : ''}`,
      );
      await waitForScene(page, 'Battle');
      await page.waitForFunction(
        () => window.__emblemRogueGame.scene.getScene('Battle')._formation?.ready === true,
        null,
        { timeout: 30_000 },
      );

      // Patient (a Fighter) leaves everything behind before the battle starts.
      await battle(
        page,
        `const u = s._formation.units.find((x) => x.name === 'Patient');
         u.inventory = []; u.weapon = null; u.consumables = [];
         s.registry.get('settings')?.setGuidance?.('full');
         s._formation.touch();`,
      );
      // The bench marks it before it is placed.
      const bench = mobile
        ? page.getByRole('complementary', { name: 'Battle commands' })
        : page.locator('.fm-dock');
      await expect(
        bench.getByRole('button', { name: /^Patient, Lv \d+ Fighter · Unarmed$/ }),
      ).toBeVisible();
      await expect(bench.locator('.fm-chip').filter({ hasText: 'Patient' })).toContainText(
        'Fighter · Unarmed',
      );
      // The waiting card reads left-aligned (a .re-btn centres its content by default).
      await expect(bench.locator('.fm-chip').first()).toHaveCSS('justify-content', 'flex-start');
      await finishFormation(page);
      await waitState(page, 'PLAYER_IDLE');
      const at = await battle(
        page,
        `const u = s.playerUnits.find((x) => x.name === 'Patient');
         return { col: u.col, row: u.row, deployed: Boolean(u.graphic) };`,
      );
      expect(at.deployed).toBe(true);

      // Select it and open its menu in place: Attack is greyed with the reason.
      await tile(page, at.col, at.row, mobile);
      await tile(page, at.col, at.row, mobile);
      await waitState(page, 'UNIT_ACTION_MENU');
      const menu = await battle(
        page,
        `return s._actionMenuPublished.items
           .map((item) => ({ label: item.label, disabled: item.disabled, why: item.description || null }));`,
      );
      expect(menu.find((m) => m.label === 'Attack')).toEqual({
        label: 'Attack',
        disabled: true,
        why: 'Unarmed: no weapon to attack with',
      });
      expect(menu.map((m) => m.label)).toContain('Wait');
      expect(menu.map((m) => m.label)).not.toContain('Equip');
      if (mobile) {
        const rail = page.getByRole('complementary', { name: 'Battle commands' });
        const attack = rail.getByRole('button', { name: /^Attack/ });
        await expect(attack).toBeDisabled();
        await expect(attack).toContainText('Unarmed: no weapon to attack with');
        await expect(rail).toContainText('Fighter · Unarmed');
      }
      await page.screenshot({ path: testInfo.outputPath('unarmed-menu.png') });
      // Choosing the greyed command does nothing.
      await battle(
        page,
        `s._actionMenuPublished.items.find((item) => item.id === 'attack').onActivate();`,
      );
      expect(await state(page)).toBe('UNIT_ACTION_MENU');

      // Wait acts.
      if (mobile)
        await page
          .getByRole('complementary', { name: 'Battle commands' })
          .getByRole('button', { name: 'Wait', exact: true })
          .tap();
      else await battle(page, `s.actionMenu.find((o) => o.text === 'Wait')._action();`);
      await page.waitForFunction(
        () =>
          window.__emblemRogueGame.scene
            .getScene('Battle')
            .playerUnits.find((u) => u.name === 'Patient').hasActed === true,
      );
      await waitState(page, 'PLAYER_IDLE');

      // The detail view of an unarmed unit opens.
      await battle(
        page,
        `const u = s.playerUnits.find((x) => x.name === 'Patient');
         s.unitDetailOverlay.show(u, s.grid.getTerrainAt(u.col, u.row), s.gameData);`,
      );
      await page.screenshot({ path: testInfo.outputPath('unarmed-detail.png') });
      await battle(page, `s.unitDetailOverlay.hide?.(); s._mobileBattleHud?.sync?.();`);

      // An enemy steps beside it and strikes, through the real combat presentation.
      const exchange = await page.evaluate(async () => {
        const s = window.__emblemRogueGame.scene.getScene('Battle');
        const u = s.playerUnits.find((x) => x.name === 'Patient');
        const enemy = s.enemyUnits.find((e) => e.weapon && !e.isBoss && e.currentHP > 0);
        const free = [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]
          .map(([dc, dr]) => ({ col: u.col + dc, row: u.row + dr }))
          .find(
            (t) =>
              t.col >= 0 &&
              t.row >= 0 &&
              t.col < s.grid.cols &&
              t.row < s.grid.rows &&
              !s.getUnitAt(t.col, t.row),
          );
        enemy.col = free.col;
        enemy.row = free.row;
        const p = s.grid.gridToPixel(free.col, free.row);
        enemy.graphic?.setPosition?.(p.x, p.y);
        u.currentHP = u.stats.HP;
        const before = { unit: u.currentHP, enemy: enemy.currentHP };
        s.battleState = 'ENEMY_PHASE';
        await s.executeEnemyCombat(enemy, u);
        s.battleState = 'PLAYER_IDLE';
        return { before, after: { unit: u.currentHP, enemy: enemy.currentHP }, xp: u.xp };
      });
      // No counter: the enemy's HP is untouched; the strike hit or missed.
      expect(exchange.after.enemy).toBe(exchange.before.enemy);
      expect(exchange.after.unit).toBeLessThanOrEqual(exchange.before.unit);

      // End the turn: a whole enemy phase with an unarmed unit on the field.
      await battle(page, `s.turnManager.endPlayerPhase();`);
      await page.waitForFunction(
        () => {
          const s = window.__emblemRogueGame.scene.getScene('Battle');
          return (
            (s.battleState === 'PLAYER_IDLE' && s.turnManager.turnNumber === 2) ||
            s.battleState === 'BATTLE_END'
          );
        },
        null,
        { timeout: 90_000 },
      );
      const patient = await battle(
        page,
        `const u = s.playerUnits.find((x) => x.name === 'Patient');
         return u ? { inventory: u.inventory.length, weapon: u.weapon } : null;`,
      );
      if (patient) expect(patient).toEqual({ inventory: 0, weapon: null });
      await page.screenshot({ path: testInfo.outputPath('unarmed-turn-2.png') });
      expect(errors).toEqual([]);
    });
  });
}

test.describe('shop', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('selling the last weapon warns first, then leaves the unit unarmed (saved)', async ({
    page,
  }, testInfo) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript((s) => localStorage.setItem('emblem_rogue_settings', s), SETTINGS);
    await page.goto('/?devScene=nodemap&preset=battle_smoke&seed=42');
    await waitForScene(page, 'NodeMap');
    const skip = page.getByRole('button', { name: 'Skip conversation', exact: true });
    await expect(skip).toBeVisible();
    await skip.click();
    const weapon = await page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('NodeMap');
      s.registry.set('activeSlot', 1);
      const edric = s.runManager.roster.find((u) => u.name === 'Edric');
      edric.inventory = edric.inventory.slice(0, 1);
      edric.weapon = edric.inventory[0];
      const n = s.runManager.getAvailableNodes()[0];
      n.type = 'shop';
      s.showShopOverlay(n, []);
      return edric.weapon.name;
    });
    const shop = page.locator('.shop-menu');
    await expect(shop).toBeVisible();
    await shop.getByRole('button', { name: 'Sell', exact: true }).click();
    await shop
      .locator('.shop-row')
      .filter({ hasText: weapon })
      .filter({ hasText: 'Edric' })
      .click();
    await expect(shop.locator('.shop-warning')).toHaveText('Leaves Edric unarmed.');
    const sell = shop.locator('.shop-commit button');
    await expect(sell).toBeEnabled();
    await expect(sell).toHaveAttribute('aria-description', 'Leaves Edric unarmed.');
    await page.screenshot({ path: testInfo.outputPath('shop-sell-last-weapon.png') });
    await sell.click();
    const sale = page.getByRole('dialog', { name: `Sell ${weapon}?`, exact: true });
    await expect(sale).toContainText('Edric loses this item. Leaves Edric unarmed.');
    await sale.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(shop.locator('.shop-status')).toContainText(`Sold ${weapon} for`);
    await expect(shop.locator('.shop-status')).toContainText('Edric is now unarmed.');
    const saved = await page.evaluate(async () => {
      const s = window.__emblemRogueGame.scene.getScene('NodeMap');
      const { loadRun } = await import('/src/engine/RunManager.js');
      const edric = loadRun(s.gameData, 1).roster.find((u) => u.name === 'Edric');
      return { inventory: edric.inventory.length, weapon: edric.weapon };
    });
    expect(saved).toEqual({ inventory: 0, weapon: null });
    expect(errors).toEqual([]);
  });
});
