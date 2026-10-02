import { test, expect } from '@playwright/test';
import { waitForScene } from './helpers.js';
async function boot(page, query = '') {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(
    `/?devScene=battle&preset=battle_smoke&seed=42&mobilePreview=1&battleLab=1${query}`,
  );
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
  await expect(hud).toContainText('Purple outline: status staff');
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

test('Canto Danger works through mobile events, keyboard and hold, with Back and Wait intact', async ({
  page,
}) => {
  const errors = await boot(page);
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const u = s.playerUnits[0];
    // Observe the rail's post-hold click guard. A rail rebuild may detach the
    // pressed button, so Chrome can omit the lifting pointer's synthetic click.
    const rail = s._mobileBattleHud.root;
    const heldClicks = new Set();
    window.__cantoHeldClicks = heldClicks;
    const add = rail.addEventListener.bind(rail),
      remove = rail.removeEventListener.bind(rail);
    rail.addEventListener = (type, listener, options) => {
      if (type === 'click' && options === true) heldClicks.add(listener);
      return add(type, listener, options);
    };
    rail.removeEventListener = (type, listener, options) => {
      if (type === 'click' && options === true) heldClicks.delete(listener);
      return remove(type, listener, options);
    };
    window.cantoUnit = u;
    window.cantoOrigin = { col: u.col, row: u.row };
    u.skills = [...new Set([...(u.skills || []), 'canto'])];
    u.hasActed = true;
    s.selectedUnit = u;
    s.startCantoMove(u, 3);
    s._mobileBattleHud.sync();
    s.game.events.emit('mobile:danger');
  });
  const danger = page.getByRole('button', { name: 'Danger', exact: true });
  await expect(danger).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('d');
  await expect(danger).toHaveAttribute('aria-pressed', 'false');
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const occupied = [...s.playerUnits, ...s.enemyUnits, ...s.npcUnits];
    const tile = [...s.cantoRange.entries()]
      .map(([key]) => {
        const [col, row] = key.split(',').map(Number);
        return { col, row };
      })
      .find((t) => !occupied.some((u) => u.col === t.col && u.row === t.row));
    if (!tile) throw new Error('No free Canto tile');
    window.cantoTile = tile;
    s.handleCantoClick(tile);
  });
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'CANTO_CONFIRM',
  );
  await expect(page.getByRole('button', { name: 'Wait', exact: true })).toBeVisible();
  await danger.click();
  await expect(danger).toHaveAttribute('aria-pressed', 'true');
  const pinned = await danger.boundingBox();
  await page.mouse.move(pinned.x + pinned.width / 2, pinned.y + pinned.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(650);
  await page.mouse.up();
  await expect(page.getByRole('button', { name: 'Danger · pinned' })).toBeVisible();
  expect(
    await page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      return {
        state: s.battleState,
        col: window.cantoUnit.col,
        row: window.cantoUnit.row,
        pending: Boolean(s._cantoPending),
        sameTile:
          window.cantoUnit.col === window.cantoTile.col &&
          window.cantoUnit.row === window.cantoTile.row,
      };
    }),
  ).toMatchObject({ state: 'CANTO_CONFIRM', pending: true, sameTile: true });
  await page.keyboard.press('Escape');
  expect(
    await page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      return {
        state: s.battleState,
        pinned: s.keepDangerVisible,
        origin:
          window.cantoUnit.col === window.cantoOrigin.col &&
          window.cantoUnit.row === window.cantoOrigin.row,
      };
    }),
  ).toEqual({ state: 'CANTO_MOVING', pinned: true, origin: true });
  await page.evaluate(() =>
    window.__emblemRogueGame.scene.getScene('Battle').handleCantoClick(window.cantoTile),
  );
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'CANTO_CONFIRM',
  );
  // The fixture directly begins a new Canto move. Wait must target that menu,
  // after the completed hold's release-click guard has cleared.
  await page.waitForFunction(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    return (
      window.__cantoHeldClicks.size === 0 &&
      s._mobileBattleHud.menu?.objects === s.actionMenu &&
      s._mobileBattleHud.menu?.unit === s.selectedUnit
    );
  });
  await page.getByRole('button', { name: 'Wait', exact: true }).click();
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'PLAYER_IDLE',
  );
  expect(
    await page.evaluate(() => window.__emblemRogueGame.scene.getScene('Battle').keepDangerVisible),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test('all exchange affixes are readable in a phone forecast and enemy inspection', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = await boot(page, '&portrait=1');
  await page.evaluate(async () => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const attacker = s.playerUnits[0],
      enemy = s.enemyUnits[0];
    const { HintManager } = await import('/src/engine/HintManager.js');
    s.registry.set('hints', new HintManager(1));
    s.registry.get('hints').reset();
    enemy.affixes = ['venomous', 'corrosive', 'deathburst'];
    enemy.currentHP = 1;
    enemy.weapon = structuredClone(s.gameData.weapons.find((w) => w.name === 'Iron Sword'));
    attacker.weapon = attacker.inventory.find((w) => w.type === 'Sword') || attacker.weapon;
    enemy.col = attacker.col + (attacker.col < s.grid.cols - 1 ? 1 : -1);
    enemy.row = attacker.row;
    s.updateUnitPosition(enemy);
    await s._attackFlow().showForecast(attacker, enemy);
  });
  const forecast = page.getByRole('dialog', { name: /Combat forecast/i });
  await expect(forecast).toContainText('Venomous · +5 after combat if it hits; cannot kill');
  await expect(forecast).toContainText(
    'Corrosive · -2 DEF after combat if it hits; stacks across combats',
  );
  await expect(forecast).toContainText(
    'Deathburst · On death: 5 damage to adjacent units; can kill',
  );
  await expect(forecast.locator('.mb-affix[open]')).toHaveCount(3);
  await expect(forecast.locator('.mb-affix[open]')).toContainText([
    'Cannot kill: leaves at least 1 HP.',
    'Stacks across combats.',
    'allies and enemies alike. Can kill.',
  ]);
  expect(
    await page.evaluate(() =>
      window.__emblemRogueGame.scene
        .getScene('Battle')
        .registry.get('hints')
        .hasSeen('affix_deathburst'),
    ),
  ).toBe(false);
  await page.screenshot({ path: info.outputPath('affix-forecast.png') });
  await page.keyboard.press('Escape');
  expect(
    await page.evaluate(() =>
      window.__emblemRogueGame.scene
        .getScene('Battle')
        .registry.get('hints')
        .hasSeen('affix_deathburst'),
    ),
  ).toBe(true);
  await page.evaluate(async () => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    await s.showForecast(s.playerUnits[0], s.enemyUnits[0]);
  });
  await expect(forecast.locator('.mb-affix')).toHaveCount(3);
  await expect(forecast.locator('.mb-affix[open]')).toHaveCount(0);
  await forecast.locator('.mb-affix').last().locator('summary').click();
  await expect(forecast.locator('.mb-affix').last().locator('p')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const enemy = s.enemyUnits[0];
    s.unitDetailOverlay.show(enemy, s.grid.getTerrainAt(enemy.col, enemy.row), s.gameData);
  });
  const roster = page.getByRole('dialog', { name: /Roster|Unit/i });
  await expect(roster).toContainText('Can kill.');
  await expect(roster).toContainText('Cannot kill: leaves at least 1 HP.');
  await page.getByRole('button', { name: 'Equipment', exact: true }).click();
  await expect(roster).toContainText('Stacks across combats.');
  await page.screenshot({ path: info.outputPath('affix-inspection.png') });
  expect(errors).toEqual([]);
});

test('canvas fallback keeps long affixes and full Gear above the footer at 640 by 480', async ({
  page,
}, info) => {
  await page.goto('/?devScene=battle&preset=battle_smoke&seed=42&battleLab=1');
  await waitForScene(page, 'Battle');
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'PLAYER_IDLE',
  );
  const bounds = await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const u = s.enemyUnits[0];
    u.affixes = ['thorns', 'deathburst'];
    u.inventory = Array.from({ length: 5 }, () =>
      structuredClone(s.gameData.weapons.find((w) => w.name === 'Iron Lance')),
    );
    u.consumables = [
      { name: 'Vulnerary', uses: 3 },
      { name: 'Antidote', uses: 3 },
    ];
    u.skills = ['vantage', 'luna', 'sol'];
    // Normal desktop uses the DOM sheet; force its supported canvas fallback.
    document.getElementById('game-wrapper').id = 'canvas-fallback-test';
    s.unitDetailOverlay.show(u, s.grid.getTerrainAt(u.col, u.row), s.gameData);
    const o = s.unitDetailOverlay;
    const measure = () => ({
      footer: o._unitObjects.find((t) => t.text?.includes('[ESC]')).getBounds().top,
      contentBottom: Math.max(...o._tabObjects.map((t) => t.getBounds().bottom)),
      panelBottom: o._panel.getBounds().bottom,
    });
    const stats = measure();
    o._activeTab = 'gear';
    o._refreshTabs();
    const gear = measure();
    const thorns = o._unitObjects.find((t) => t.text?.startsWith('Thorns ·'));
    o._showSkillTooltip(
      thorns,
      s.gameData.affixes.affixes.find((a) => a.id === 'thorns').description,
    );
    return { stats, gear, tooltip: o._skillTooltip[1].text };
  });
  for (const b of [bounds.stats, bounds.gear]) {
    expect(b.contentBottom).toBeLessThan(b.footer);
    expect(b.panelBottom).toBeLessThanOrEqual(480);
  }
  expect(bounds.tooltip).toContain('crits and overkill count');
  await page.screenshot({ path: info.outputPath('canvas-affix-details.png') });
});

test('first-time full affix rules fit the canvas forecast before confirmation', async ({
  page,
}, info) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?devScene=battle&preset=battle_smoke&seed=42&battleLab=1');
  await waitForScene(page, 'Battle');
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'PLAYER_IDLE',
  );
  const result = await page.evaluate(async () => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    s._mobileBattleHud?.destroy();
    s._mobileBattleHud = null;
    const { HintManager } = await import('/src/engine/HintManager.js');
    s.registry.set('hints', new HintManager(1));
    s.registry.get('hints').reset();
    const attacker = s.playerUnits[0],
      enemy = s.enemyUnits[0];
    enemy.affixes = ['venomous', 'corrosive', 'deathburst'];
    enemy.currentHP = 1;
    enemy.weapon = structuredClone(s.gameData.weapons.find((w) => w.name === 'Iron Sword'));
    enemy.col = attacker.col + 1;
    enemy.row = attacker.row;
    await s.showForecast(attacker, enemy);
    const o = s._forecastOverlay;
    const text = o.displayObjects.filter((t) => /^(Venomous|Corrosive|Deathburst) ·/.test(t.text));
    return {
      text: text.map((t) => t.text),
      top: o.displayObjects[0].getBounds().top,
      bottom: Math.max(...text.map((t) => t.getBounds().bottom)),
      confirmTop: o.displayObjects.find((t) => t.text === 'CONFIRM ATTACK').getBounds().top,
      confirmBottom: o.displayObjects.find((t) => t.text === 'CONFIRM ATTACK').getBounds().bottom,
      seen: s.registry.get('hints').hasSeen('affix_deathburst'),
    };
  });
  expect(result.text).toHaveLength(3);
  expect(result.text.every((t) => t.includes('\n'))).toBe(true);
  expect(result.top).toBeGreaterThanOrEqual(0);
  expect(result.bottom).toBeLessThan(result.confirmTop);
  expect(result.confirmBottom).toBeLessThanOrEqual(480);
  expect(result.seen).toBe(false);
  await page.screenshot({ path: info.outputPath('canvas-first-affixes.png') });
  expect(errors).toEqual([]);
});
