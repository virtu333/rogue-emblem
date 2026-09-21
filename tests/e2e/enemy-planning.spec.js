import { test, expect, devices } from '@playwright/test';
import { waitForScene } from './helpers.js';
test.use({ ...devices['iPhone SE'], viewport: { width: 667, height: 375 } });
for (const [act, level] of [
  ['act1', 3],
  ['act3', 12],
]) {
  test(`${act} guard returns to its post through a real phone enemy phase`, async ({
    page,
  }, info) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/?devScene=battle&preset=combat_actions&seed=42&mobilePreview=1&battleLab=1');
    await waitForScene(page, 'Battle');
    await page.waitForFunction(
      () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'PLAYER_IDLE',
    );
    await page.evaluate(
      ({ act, level }) => {
        const scene = window.__emblemRogueGame.scene.getScene('Battle');
        scene.battleParams.act = act;
        scene.registry.get('settings').setBattleSpeed('fast');
        for (const enemy of scene.enemyUnits) scene.removeUnitGraphic(enemy);
        scene.enemyUnits = [];
        const guard = scene.addEnemyFromSpawn({
          className: 'Fighter',
          level,
          col: 6,
          row: 3,
          aiMode: 'guard',
        });
        guard.guardPost = { col: 8, row: 3 };
        guard.mov = guard.stats.MOV = 3;
        scene.aiController.setAggressiveMode(false);
        window.guardFixture = guard;
        window.guardPhaseDone = false;
        scene.turnManager.currentPhase = 'enemy';
        scene.battleState = 'ENEMY_PHASE';
        scene.startEnemyPhase().then(() => {
          window.guardPhaseDone = true;
        });
      },
      { act, level },
    );
    await page.waitForFunction(() => window.guardPhaseDone);
    await page.waitForFunction(
      () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'PLAYER_IDLE',
    );
    const state = await page.evaluate(() => ({
      mode: window.guardFixture.aiMode,
      reason: window.guardFixture._lastAiDecision.reason,
      col: window.guardFixture.col,
      row: window.guardFixture.row,
    }));
    expect(state.mode).toBe('guard');
    expect(state.reason).toBe('guard_return');
    expect(Math.abs(state.col - 8) + Math.abs(state.row - 3)).toBeLessThan(2);
    const hud = page.getByRole('complementary', { name: 'Battle commands' });
    await expect(hud).toBeVisible();
    await hud.getByRole('button', { name: 'Menu', exact: true }).tap();
    await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Resume', exact: true }).tap();
    await expect(hud).toBeVisible();
    await page.screenshot({ path: info.outputPath(`${act}-guard-return.png`) });
    expect(errors).toEqual([]);
  });
}
