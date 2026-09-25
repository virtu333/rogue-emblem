// Playtest 2026-09-25: "Damage preview on myrmidon attack doesn't work (I'm
// guessing doesn't take disadvantage into account)". Myrmidon Daska (Iron
// Sword, 5 STR) against a Cavalier (Iron Lance, 6 DEF, 9/20 HP): the numbers
// were right (3 per hit, 6 HP left) but the projected loss on the canvas HP bar
// was drawn in the accent color, which is also the 40–70% HP fill — invisible.
// This drives the real forecast on desktop and phone, checks the numbers and
// that the loss is drawn, then confirms the attack and checks the Cavalier is
// left at exactly the forecast HP.
import { test, expect, devices } from '@playwright/test';
import { waitForScene } from './helpers.js';

// Set PLAYTEST_FIX_SHOTS=docs/art-direction/gameplay/playtest-fixes to refresh the doc screenshots.
const SHOTS = process.env.PLAYTEST_FIX_SHOTS || '';

const phone = { ...devices['iPhone 13'] };
delete phone.defaultBrowserType;

const VIEWPORTS = [
  { name: 'desktop-1280x800', use: { viewport: { width: 1280, height: 800 } } },
  { name: 'desktop-640x480', use: { viewport: { width: 640, height: 480 } } },
  { name: 'phone-844x390', mobile: true, use: { ...phone, viewport: { width: 844, height: 390 } } },
];

for (const vp of VIEWPORTS)
  test.describe(`triangle-disadvantage forecast · ${vp.name}`, () => {
    test.use(vp.use);
    test('shows the damage on the HP bar and resolves to the forecast', async ({ page }) => {
      test.setTimeout(90_000);
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(
        `/?devScene=battle&preset=battle_smoke&seed=42${vp.mobile ? '&mobilePreview=1&battleLab=1' : ''}`,
      );
      await waitForScene(page, 'Battle');
      await page.waitForFunction(
        () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'PLAYER_IDLE',
      );
      await page.evaluate(async () => {
        const s = window.__emblemRogueGame.scene.getScene('Battle');
        s.registry.get('settings').setHints(false);
        const a = s.playerUnits[0];
        const d = s.enemyUnits[0];
        const weapon = (name) => ({ ...s.gameData.weapons.find((w) => w.name === name) });
        Object.assign(a, {
          name: 'Daska',
          weapon: weapon('Iron Sword'),
          proficiencies: [{ type: 'Sword', rank: 'Prof' }],
          weaponRank: 'Prof',
          stats: { HP: 22, STR: 5, MAG: 0, SKL: 10, SPD: 8, DEF: 5, RES: 1, LCK: 5, MOV: 5 },
          currentHP: 22,
        });
        Object.assign(d, {
          name: 'Cavalier',
          weapon: weapon('Iron Lance'),
          stats: { HP: 20, STR: 8, MAG: 0, SKL: 5, SPD: 7, DEF: 6, RES: 0, LCK: 30, MOV: 7 },
          currentHP: 9,
        });
        for (const u of [a, d]) {
          u.inventory = [u.weapon];
          u.skills = [];
          u.accessory = null;
          u.affixes = [];
          u._conditions = [];
          s.updateHPBar?.(u);
        }
        d.col = a.col + 1;
        d.row = a.row;
        s.grid.setTerrainAt(a.col, a.row, 0);
        s.grid.setTerrainAt(d.col, d.row, 0);
        s.selectUnit(a);
        s.hideActionMenu();
        await s.showForecast(a, d);
      });

      const shown = await page.evaluate(() => {
        const s = window.__emblemRogueGame.scene.getScene('Battle');
        return { state: s.battleState, target: s.forecastTarget?.name };
      });
      expect(shown.state).toBe('SHOWING_FORECAST');
      expect(shown.target).toBe('Cavalier');

      if (vp.mobile) {
        const dialog = page.getByRole('dialog', { name: 'Combat forecast', exact: true });
        await expect(dialog).toBeVisible();
        await expect(dialog).toContainText(/Triangle disadvantage/);
        await expect(dialog).toContainText('If all hits land: 6 HP');
        const loss = dialog.locator('.re-health-projection');
        await expect(loss.first()).toBeVisible();
        const widths = await loss.evaluateAll((els) =>
          els.map((e) => e.getBoundingClientRect().width),
        );
        expect(Math.max(...widths)).toBeGreaterThan(0);
      } else {
        const panel = await page.evaluate(async () => {
          const { UI_HEX } = await import('/src/utils/uiStyles.js');
          const s = window.__emblemRogueGame.scene.getScene('Battle');
          const objects = s._forecastOverlay.displayObjects;
          // The hatching is drawn with the bright accent-text color, which no
          // HP fill uses; find it in the bars' draw commands.
          const hatched = objects.filter(
            (o) =>
              Array.isArray(o.commandBuffer) &&
              o.commandBuffer.includes(UI_HEX.accentText) &&
              o.commandBuffer.includes(UI_HEX.sunken),
          ).length;
          return {
            texts: objects.filter((o) => o.text).map((o) => o.text),
            hatched,
          };
        });
        expect(panel.texts.some((t) => /Triangle disadvantage/.test(t))).toBe(true);
        expect(panel.texts).toContain('If all hits land: 6 HP (no crits/procs)');
        expect(panel.texts).toContain('3');
        // Both bars show a projected loss (the Cavalier's 9 → 6, and the counter on Daska).
        expect(panel.hatched).toBe(2);
      }
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/forecast-triangle-${vp.name}.png` });

      // Confirm with every roll a hit and no crit (crit is 0 against 30 LCK):
      // the Cavalier ends at exactly the forecast HP.
      await page.evaluate(() => {
        Math.random = () => 0;
        window.__emblemRogueGame.scene.getScene('Battle').confirmForecastCombat();
      });
      await expect
        .poll(
          () =>
            page.evaluate(() => {
              const s = window.__emblemRogueGame.scene.getScene('Battle');
              return s.enemyUnits.find((u) => u.name === 'Cavalier')?.currentHP;
            }),
          { timeout: 30_000 },
        )
        .toBe(6);
      expect(errors).toEqual([]);
    });
  });
