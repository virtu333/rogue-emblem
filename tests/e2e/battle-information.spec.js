import { test, expect } from '@playwright/test';
import { waitForScene } from './helpers.js';
async function boot(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?devScene=battle&preset=battle_smoke&seed=42&mobilePreview=1&battleLab=1');
  await waitForScene(page, 'Battle');
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'PLAYER_IDLE',
  );
  return errors;
}
test('sleep tap explains recovery; silence leaves disabled magic, arts and staff discoverable', async ({
  page,
}, info) => {
  const errors = await boot(page);
  const hud = page.getByRole('complementary', { name: 'Battle commands' });
  await page.evaluate(async () => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const { applyCondition } = await import('/src/engine/StatusConditionSystem.js');
    const u = s.playerUnits.find((u) => u.name === 'Sera');
    window.infoUnit = u;
    applyCondition(u, 'sleep', 3);
    s._inputController.handleIdleClick({ col: u.col, row: u.row });
    s._mobileBattleHud.sync();
  });
  await expect(hud).toContainText('Asleep · up to 3 turns');
  await expect(hud).toContainText('Cannot act');
  expect(
    await page.evaluate(() => window.__emblemRogueGame.scene.getScene('Battle').battleState),
  ).toBe('PLAYER_IDLE');
  await page.screenshot({ path: info.outputPath('sleep-explanation.png') });
  await page.evaluate(async () => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const u = window.infoUnit;
    const { clearAllConditions, applyCondition } =
      await import('/src/engine/StatusConditionSystem.js');
    clearAllConditions(u);
    applyCondition(u, 'silence', 2, { recoveryChance: 0 });
    u.weapon.weaponArtIds = ['light_radiant_burst'];
    s.inspectionPanel.hide();
    s.selectUnit(u);
    s.showActionMenu(u);
    s._mobileBattleHud.sync();
  });
  await expect(hud.getByRole('button', { name: /Attack.*Silenced/ })).toBeDisabled();
  await expect(hud.getByRole('button', { name: /Staff.*Silenced/ })).toBeDisabled();
  await expect(hud.getByRole('button', { name: /Weapon Art.*Silenced/ })).toBeDisabled();
  await page.screenshot({ path: info.outputPath('silence-actions.png') });
  expect(errors).toEqual([]);
});
test('hidden inspection cannot open or cycle to enemies; status staff reach refreshes visibly', async ({
  page,
}, info) => {
  const errors = await boot(page);
  const result = await page.evaluate(async () => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const hidden = s.enemyUnits[0],
      visible = s.enemyUnits[1];
    s.grid.fogEnabled = true;
    window.savedVisible = s.grid.isVisible.bind(s.grid);
    s.grid.isVisible = (c, r) => c === visible.col && r === visible.row;
    const p = s.grid.gridToPixel(hidden.col, hidden.row);
    const refused = s._inputController._showInspectionAtPixel(p.x, p.y) === false;
    s.unitDetailOverlay.show(hidden, s.grid.getTerrainAt(hidden.col, hidden.row), s.gameData);
    const directRefused = !s.unitDetailOverlay.visible;
    s.inspectionPanel.show(visible, s.grid.getTerrainAt(visible.col, visible.row), s.gameData);
    s.openUnitDetailOverlay();
    return {
      refused,
      directRefused,
      names: s.unitDetailOverlay._mobileSheet.units.map((u) => u.name),
      hidden: hidden.name,
      visible: visible.name,
    };
  });
  expect(result.refused).toBe(true);
  expect(result.directRefused).toBe(true);
  expect(result.names).toEqual([result.visible]);
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    s.grid.fogEnabled = false;
    s.grid.isVisible = window.savedVisible;
    const u = s.enemyUnits[0];
    u.statusStaff = { name: 'Sleep', type: 'Staff', range: '3-5', uses: 3, statusEffect: 'sleep' };
    s.dangerZone.show(s.calculateDangerZone());
    s.refreshVisibleDangerZone();
    s.inspectionPanel.show(u, s.grid.getTerrainAt(u.col, u.row), s.gameData);
    s._mobileBattleHud.sync();
  });
  const hud = page.getByRole('complementary', { name: 'Battle commands' });
  await expect(hud).toContainText('Sleep · Range 3-5 · 3/3 uses');
  await expect(hud).toContainText('Outlined: status staff');
  expect(
    await page.evaluate(() =>
      window.__emblemRogueGame.scene.getScene('Battle').dangerZoneCache.some((t) => t.statusThreat),
    ),
  ).toBe(true);
  await page.screenshot({ path: info.outputPath('status-danger.png') });
  const moved = await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const unit = s.enemyUnits[0];
    const before = JSON.stringify(s.dangerZoneCache);
    unit.col = unit.col > 0 ? unit.col - 1 : unit.col + 1;
    s.updateUnitPosition(unit);
    return {
      changed: before !== JSON.stringify(s.dangerZoneCache),
      current: JSON.stringify(s.dangerZoneCache) === JSON.stringify(s.calculateDangerZone()),
      visible: s.dangerZone.visible,
    };
  });
  expect(moved).toEqual({ changed: true, current: true, visible: true });
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    s.enemyUnits[0].statusStaff._usesSpent = 3;
    s.dangerZoneStale = true;
  });
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__emblemRogueGame.scene
          .getScene('Battle')
          .dangerZoneCache.some((t) => t.statusThreat),
      ),
    )
    .toBe(false);
  expect(errors).toEqual([]);
});
test('boss pressure is visible before enrage and remains while active', async ({ page }) => {
  await boot(page);
  const hud = page.getByRole('complementary', { name: 'Battle commands' });
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    s.enemyUnits[0].isBoss = true;
    s.turnBonusConfig = { latePressure: { bossEnrageTurn: 10 } };
    s.turnManager.turnNumber = 9;
    s._mobileBattleHud.sync();
  });
  await expect(hud).toContainText('Boss enrages next turn (turn 10)');
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    s.antiTurtleState.turnEnrageActive = true;
    s._mobileBattleHud.sync();
  });
  await expect(hud).toContainText('Boss enraged');
});
