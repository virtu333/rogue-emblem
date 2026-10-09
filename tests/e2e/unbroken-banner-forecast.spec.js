// The Unbroken Banner in the forecast (an earned blessing, engine/BattleBlessings.js): a counter
// that would fell the attacker reads "1 HP (Unbroken Banner)", never KO, on the canvas forecast
// and on the phone's combat sheet, and the counter-risk line says the banner would hold. The
// long label must not push the phone sheet sideways.
import { test, expect, devices } from '@playwright/test';
import { waitForScene } from './helpers.js';
const phone = { ...devices['iPhone SE'] };
delete phone.defaultBrowserType;

const HOLD = '1 HP (Unbroken Banner)';
const RISK = 'could fell';

for (const mobile of [false, true])
  test.describe(mobile ? 'phone forecast' : 'desktop forecast', () => {
    test.use(
      mobile
        ? { ...phone, viewport: { width: 667, height: 375 } }
        : { viewport: { width: 1280, height: 800 } },
    );
    test('a counter the banner would hold reads 1 HP (Unbroken Banner)', async ({ page }) => {
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(
        `/?devScene=battle&preset=battle_smoke&seed=42${mobile ? '&mobilePreview=1&battleLab=1' : ''}`,
      );
      await waitForScene(page, 'Battle');
      await page.waitForFunction(
        () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'PLAYER_IDLE',
      );
      const notes = await page.evaluate(async () => {
        const s = window.__emblemRogueGame.scene.getScene('Battle');
        s.registry.get('settings').setHints(false);
        const { createBattleBlessings } = await import('/src/engine/BattleBlessings.js');
        s._battleBlessings = createBattleBlessings({ lastStand: 1 });
        const a = s.playerUnits[0],
          d = s.enemyUnits[0];
        for (const [u, weaponName, hp] of [
          [a, 'Iron Sword', 3],
          [d, 'Iron Axe', 30],
        ]) {
          u.weapon = { ...s.gameData.weapons.find((w) => w.name === weaponName) };
          u.inventory = [u.weapon];
          u.skills = [];
          u.accessory = null;
          u.affixes = [];
          u._conditions = [];
          u.stats = { HP: 30, STR: 10, MAG: 0, SKL: 50, SPD: 5, DEF: 5, RES: 5, LCK: 100, MOV: 5 };
          u.currentHP = hp;
        }
        d.col = a.col + 1;
        d.row = a.row;
        s.grid.setTerrainAt(a.col, a.row, 0);
        s.grid.setTerrainAt(d.col, d.row, 0);
        s.selectUnit(a);
        s.hideActionMenu();
        await s.showForecast(a, d);
        const { getCombatForecast } = await import('/src/engine/Combat.js');
        const { forecastNotes } = await import('/src/ui/forecastDisplay.js');
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
        return forecastNotes(forecast, true, a.currentHP);
      });
      // The engine's own words, before the screens are read.
      expect(notes).toContain(`If all hits land: ${HOLD} (no crits/procs)`);
      expect(notes.some((n) => n.includes(RISK) && n.includes('Unbroken Banner'))).toBe(true);
      if (mobile) {
        const dialog = page.getByRole('dialog', { name: 'Combat forecast', exact: true });
        await expect(dialog.locator('.mb-ally .mb-hp')).toContainText(HOLD);
        await expect(dialog.locator('.mb-ally .mb-hp')).not.toContainText('KO');
        await expect(dialog).toContainText(RISK);
        for (const width of [375, 667]) {
          await page.setViewportSize(
            width === 375 ? { width: 375, height: 667 } : { width: 667, height: 375 },
          );
          expect(await dialog.evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
        }
      } else {
        const contents = await page.evaluate(() =>
          window.__emblemRogueGame.scene
            .getScene('Battle')
            ._forecastOverlay.displayObjects.filter((o) => o.text)
            .map((o) => o.text),
        );
        for (const note of notes) expect(contents).toContain(note);
        expect(contents.join('\n')).not.toMatch(/\bKO\b/);
      }
      expect(errors).toEqual([]);
    });
  });
