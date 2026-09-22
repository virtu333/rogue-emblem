import { test, expect, devices } from '@playwright/test';
import { waitForScene } from './helpers.js';
const phone = { ...devices['iPhone SE'] };
delete phone.defaultBrowserType;

for (const mobile of [false, true])
  test.describe(mobile ? 'phone forecast' : 'desktop forecast', () => {
    test.use(
      mobile
        ? { ...phone, viewport: { width: 667, height: 375 } }
        : { viewport: { width: 1280, height: 800 } },
    );
    test('shares honest estimates, projected HP and per-hit labels', async ({ page }, info) => {
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(
        `/?devScene=battle&preset=battle_smoke&seed=42${mobile ? '&mobilePreview=1&battleLab=1' : ''}`,
      );
      await waitForScene(page, 'Battle');
      await page.waitForFunction(
        () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'PLAYER_IDLE',
      );
      await page.evaluate(async () => {
        const s = window.__emblemRogueGame.scene.getScene('Battle');
        s.registry.get('settings').setHints(false);
        const a = s.playerUnits[0],
          d = s.enemyUnits[0];
        for (const [u, weaponName, spd] of [
          [a, 'Iron Sword', 15],
          [d, 'Iron Axe', 5],
        ]) {
          u.weapon = { ...s.gameData.weapons.find((w) => w.name === weaponName) };
          u.inventory = [u.weapon];
          u.skills = [];
          u.accessory = null;
          u.affixes = [];
          u._conditions = [];
          u.stats = {
            HP: 30,
            STR: 10,
            MAG: 0,
            SKL: 50,
            SPD: spd,
            DEF: 5,
            RES: 5,
            LCK: 100,
            MOV: 5,
          };
          u.currentHP = 30;
        }
        d.col = a.col + 1;
        d.row = a.row;
        s.grid.setTerrainAt(a.col, a.row, 0);
        s.grid.setTerrainAt(d.col, d.row, 0);
        s.selectUnit(a);
        s.hideActionMenu();
        await s.showForecast(a, d);
        const { getCombatForecast } = await import('/src/engine/Combat.js');
        const { forecastProjection, forecastNotes } = await import('/src/ui/forecastDisplay.js');
        const ctx = s._prepareCombatContext(a, d, { isPlayerInitiator: true });
        const forecast = getCombatForecast(
          a,
          a.weapon,
          d,
          d.weapon,
          ctx.dist,
          ctx.atkTerrain,
          ctx.defTerrain,
          s._buildForecastSkillCtx(a, d, null),
        );
        window.expected = {
          projection: forecastProjection(forecast),
          notes: forecastNotes(forecast, true),
        };
        window.unitsBefore = JSON.stringify([a.stats, a.currentHP, d.stats, d.currentHP]);
      });
      const expected = await page.evaluate(() => window.expected);
      expect(expected.projection).not.toBeNull();
      if (mobile) {
        const dialog = page.getByRole('dialog', { name: 'Combat forecast', exact: true });
        await expect(dialog).toContainText('Damage per hit');
        await expect(dialog).toContainText('Planned hits');
        await expect(dialog).toContainText('Hit rating');
        const hitValues = dialog
          .locator('.mb-stats div')
          .filter({ has: page.locator('dt', { hasText: /^Hit rating$/ }) })
          .locator('dd');
        expect(await hitValues.allTextContents()).toEqual(['100', '100']);
        for (const note of expected.notes) await expect(dialog).toContainText(note);
        await expect(dialog.locator('.re-health-projection')).toHaveCount(2);
        expect(await dialog.locator('[role="meter"]').first().getAttribute('aria-valuenow')).toBe(
          '30',
        );
        await expect(dialog.locator('[role="meter"]').first()).toHaveAttribute(
          'aria-valuetext',
          /estimated/,
        );
        await page.setViewportSize({ width: 375, height: 667 });
        expect(await dialog.evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
        await page.setViewportSize({ width: 667, height: 375 });
      } else {
        const contents = await page.evaluate(() =>
          window.__emblemRogueGame.scene
            .getScene('Battle')
            ._forecastOverlay.displayObjects.filter((o) => o.text)
            .map((o) => o.text),
        );
        for (const note of expected.notes) expect(contents).toContain(note);
        expect(contents).toContain('Damage/hit');
        expect(contents).toContain('Hit rating');
        expect(contents).toContain('100');
        expect(contents).not.toContain('100%');
        expect(contents).toContain('Planned hits: 2x');
        const bounds = await page.evaluate(() => {
          const s = window.__emblemRogueGame.scene.getScene('Battle');
          return s._forecastOverlay.displayObjects
            .filter((o) => o.text && o.active)
            .map((o) => {
              const b = o.getBounds();
              return {
                top: b.top,
                bottom: b.bottom,
                left: b.left,
                right: b.right,
                w: s.scale.width,
                h: s.scale.height,
              };
            });
        });
        for (const b of bounds) {
          expect(b.top).toBeGreaterThanOrEqual(0);
          expect(b.bottom).toBeLessThanOrEqual(b.h);
          expect(b.left).toBeGreaterThanOrEqual(0);
          expect(b.right).toBeLessThanOrEqual(b.w);
        }
      }
      await page.screenshot({ path: info.outputPath('forecast.png') });
      await page.keyboard.press('Escape');
      expect(
        await page.evaluate(() => {
          const s = window.__emblemRogueGame.scene.getScene('Battle'),
            a = s.playerUnits[0],
            d = s.enemyUnits[0];
          return JSON.stringify([a.stats, a.currentHP, d.stats, d.currentHP]);
        }),
      ).toBe(await page.evaluate(() => window.unitsBefore));
      expect(errors).toEqual([]);
    });
  });
