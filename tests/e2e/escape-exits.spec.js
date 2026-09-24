import { test, expect } from '@playwright/test';
import { waitForScene } from './helpers.js';

test.use({ hasTouch: true, isMobile: true });
for (const width of [667, 844]) {
  test(`escape exits remain discoverable and usable at ${width}px, fresh and resumed`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 390 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/?devScene=battle&preset=battle_smoke&seed=42&mobilePreview=1');
    await waitForScene(page, 'Battle');
    await page.waitForFunction(
      () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'PLAYER_IDLE',
    );
    // Real generated encounter, no battleLab map replacement. Each browser has an isolated profile.
    await page.evaluate((fogEnabled) => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      s.scene.restart({
        gameData: s.gameData,
        battleParams: {
          act: 'act2',
          objective: 'escape',
          templateId: 'hunters_woods',
          battleSeed: 42,
          fogEnabled,
        },
      });
    }, width === 667);
    await page.waitForFunction(() => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      return (
        s.battleConfig?.objective === 'escape' &&
        s.battleState === 'PLAYER_IDLE' &&
        !s.isStoryInputLocked()
      );
    });
    const hud = page.getByRole('complementary', { name: 'Battle commands' });
    await hud.getByRole('button', { name: /^Objective details:/ }).tap();
    await expect(page.getByRole('dialog', { name: 'Battle objective', exact: true })).toContainText(
      'Move onto an EXIT tile, then choose Escape.',
    );
    await page.keyboard.press('Escape');
    await page.evaluate(async () => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      await s._mobileBattleHud.lab.artReady;
      // Reproduce a tactical view that crops the destination column.
      s.cameras.main.setZoom(2);
      const p = s.grid.gridToPixel(2, 4);
      s.cameras.main.centerOn(p.x, p.y);
      s._battleCamera.clampToBounds();
      window.escapeConfig = structuredClone(s.battleConfig);
    });
    const markersInView = () =>
      page.evaluate(() => {
        const s = window.__emblemRogueGame.scene.getScene('Battle');
        return s._escapeController.markers.every((m) => {
          const bounds = m.getBounds();
          const tl = s._battleCamera.worldToScreen(bounds.left, bounds.top);
          const br = s._battleCamera.worldToScreen(bounds.right, bounds.bottom);
          return (
            m.visible &&
            tl.x >= 0 &&
            br.x <= s.cameras.main.width &&
            tl.y >= 0 &&
            br.y <= s.cameras.main.height
          );
        });
      });
    expect(await markersInView()).toBe(false);
    const commandOrder = await hud.locator('button').allTextContents();
    expect(commandOrder.indexOf('Show exits')).toBeGreaterThan(commandOrder.indexOf('End turn…'));
    await hud.getByRole('button', { name: 'Show exits', exact: true }).tap();
    await expect.poll(markersInView).toBe(true);
    await page.screenshot({ path: info.outputPath('escape-overview.png') });
    await hud.getByRole('button', { name: 'End turn…', exact: true }).tap();
    await expect(hud.getByRole('button', { name: 'Keep playing', exact: true })).toBeFocused();
    await expect(hud.getByRole('button', { name: 'Show exits', exact: true })).toHaveCount(0);
    await hud.getByRole('button', { name: 'Keep playing', exact: true }).tap();
    // Reconstruct from the shipping checkpoint serializer and resume path.
    await page.evaluate(async () => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      const { BattleSuspendController } = await import('/src/ui/BattleSuspendController.js');
      const cp = new BattleSuspendController(s)._buildCheckpoint(1, 42);
      cp.turnNumber = 8;
      s.scene.restart({
        gameData: s.gameData,
        battleParams: { ...s.battleParams },
        resumeCheckpoint: cp,
      });
    });
    await page.waitForFunction(() => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      return (
        s.turnManager?.turnNumber === 8 &&
        s.battleState === 'PLAYER_IDLE' &&
        !s.isStoryInputLocked()
      );
    });
    expect(
      await page.evaluate(() => {
        const s = window.__emblemRogueGame.scene.getScene('Battle');
        return (
          JSON.stringify(s.battleConfig.escapeTiles) ===
          JSON.stringify(window.escapeConfig.escapeTiles)
        );
      }),
    ).toBe(true);
    for (let i = 0; i < 2; i++) {
      // Place each lord at the destination to test the actual mobile Escape action.
      await page.evaluate(() => {
        const s = window.__emblemRogueGame.scene.getScene('Battle');
        const u = s.playerUnits.find((u) => u.isLord);
        Object.assign(u, s.battleConfig.escapeTiles[0], { hasActed: false, hasMoved: false });
        s.updateUnitPosition(u);
        s.selectUnit(u);
        s.showActionMenu(u);
        s._mobileBattleHud.sync();
      });
      const before = await page.evaluate(() => {
        const s = window.__emblemRogueGame.scene.getScene('Battle');
        return {
          name: s.selectedUnit.name,
          state: s.battleState,
          col: s.selectedUnit.col,
          row: s.selectedUnit.row,
        };
      });
      await hud.getByRole('button', { name: 'Show exits', exact: true }).tap();
      expect(
        await page.evaluate(() => {
          const s = window.__emblemRogueGame.scene.getScene('Battle');
          return {
            name: s.selectedUnit.name,
            state: s.battleState,
            col: s.selectedUnit.col,
            row: s.selectedUnit.row,
          };
        }),
      ).toEqual(before);
      expect(await markersInView()).toBe(true);
      await hud.getByRole('button', { name: 'Escape', exact: true }).tap();
      await expect
        .poll(() =>
          page.evaluate(
            () => window.__emblemRogueGame.scene.getScene('Battle').escapedUnits.length,
          ),
        )
        .toBe(i + 1);
    }
    expect(
      await page.evaluate(() => window.__emblemRogueGame.scene.getScene('Battle').battleState),
    ).toBe('BATTLE_END');
    expect(errors).toEqual([]);
  });
}
