import { test, expect, devices } from '@playwright/test';
import { waitForScene } from './helpers.js';

test.use({
  ...devices['iPhone SE'],
  viewport: { width: 667, height: 375 },
});
test.setTimeout(90000);
test.beforeEach(async ({ page }) => {
  page.setDefaultTimeout(10000);
  // Concurrent source edits must not make Vite refresh an in-progress save test.
  await page.routeWebSocket(/^ws:\/\/(?:127\.0\.0\.1|localhost):3000/, (socket) => socket.close());
});

// Fixtures attach only this test's isolated browser profile to a real slot.
// Outcomes are saved by the shipping roster-close/action-completion handlers.
async function attachSlot(page) {
  await page.evaluate(async () => {
    const game = window.__emblemRogueGame;
    const { getMetaKey, setActiveSlot } = await import('/src/engine/SlotManager.js');
    const meta = game.registry.get('meta');
    meta.storageKey = getMetaKey(1);
    meta._save();
    game.registry.set('activeSlot', 1);
    setActiveSlot(1);
  });
}

async function resumeSavedRun(page, battle = false) {
  await page.evaluate(() => history.replaceState(null, '', '/'));
  await page.reload();
  await waitForScene(page, 'Title');
  // Let the boot-to-title router cooldown finish before the next scene transition.
  await page.waitForTimeout(1300);
  // Title remains canvas-based: locate the rendered label, then tap its bounds.
  await page.waitForFunction(() => {
    const s = window.__emblemRogueGame.scene.getScene('Title');
    const walk = (nodes) =>
      nodes.flatMap((o) => [o, ...(Array.isArray(o.list) ? walk(o.list) : [])]);
    return (
      s.input.enabled &&
      walk(s.children.list).some((o) => ['CONTINUE', 'SAVE SLOTS'].includes(o.text) && o.visible)
    );
  });
  const point = await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Title');
    const walk = (nodes) =>
      nodes.flatMap((o) => [o, ...(Array.isArray(o.list) ? walk(o.list) : [])]);
    const o = walk(s.children.list).find(
      (o) => ['CONTINUE', 'SAVE SLOTS'].includes(o.text) && o.visible,
    );
    const b = o.getBounds(),
      r = s.game.canvas.getBoundingClientRect();
    return {
      x: r.x + (b.centerX * r.width) / s.scale.width,
      y: r.y + (b.centerY * r.height) / s.scale.height,
    };
  });
  await page.touchscreen.tap(point.x, point.y);
  await waitForScene(page, 'SlotPicker');
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Select Slot 1', exact: true }).tap();
  if (battle) await page.getByRole('button', { name: 'Resume Battle', exact: true }).tap();
  await waitForScene(page, battle ? 'Battle' : 'NodeMap');
}

async function battleIdle(page) {
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'PLAYER_IDLE',
  );
}

async function tapUnit(page, name, group = 'playerUnits') {
  const p = await page.evaluate(
    ({ name, group }) => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      const u = s[group].find((u) => u.name === name);
      const w = s.grid.gridToPixel(u.col, u.row),
        p = s._worldToScreen(w.x, w.y);
      const r = s.game.canvas.getBoundingClientRect();
      return {
        x: r.x + (p.x * r.width) / s.scale.width,
        y: r.y + (p.y * r.height) / s.scale.height,
      };
    },
    { name, group },
  );
  await page.touchscreen.tap(p.x, p.y);
}

test('reclass UI save reload deploy preserves learned skill, spent seal and usable equipment identity', async ({
  page,
}, testInfo) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/?devScene=nodemap&preset=battle_smoke&seed=42&mobilePreview=1');
  await waitForScene(page, 'NodeMap');
  await page.getByRole('button', { name: 'Skip conversation', exact: true }).tap();
  await attachSlot(page);
  const nodeId = await page.evaluate(async () => {
    const s = window.__emblemRogueGame.scene.getScene('NodeMap');
    const { createUnit } = await import('/src/engine/UnitManager.js');
    const u = createUnit(
      s.gameData.classes.find((c) => c.name === 'Fighter'),
      15,
      s.gameData.weapons,
      { name: 'Reload Veteran' },
    );
    u.skills = ['wrath'];
    u.consumables = [
      {
        name: 'Second Seal',
        type: 'Consumable',
        effect: 'reclass',
        subEffect: 'infantry',
        uses: 1,
      },
    ];
    s.runManager.roster.unshift(u);
    const node = s.runManager.getAvailableNodes().find((n) => n.type === 'battle');
    if (!node) throw new Error('Fixture requires a reachable battle');
    return node.id;
  });
  await page.locator('.re-node-map').getByRole('button', { name: 'Roster', exact: true }).tap();
  const roster = page.locator('.mr-sheet');
  await roster.getByRole('button', { name: 'Equipment', exact: true }).tap();
  await roster.getByRole('button', { name: 'Reclass', exact: true }).tap();
  const picker = page.getByRole('dialog', { name: 'Reclass Reload Veteran', exact: true });
  await picker.getByRole('button', { name: /^Myrmidon/ }).tap();
  await expect(picker.locator('.re-choice-preview')).toContainText('Learn: Vantage');
  await picker.getByRole('button', { name: 'Confirm', exact: true }).tap();
  await expect(picker).toHaveCount(0);
  await roster.getByRole('button', { name: 'Close', exact: true }).tap();
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('emblem_rogue_slot_1_run')),
  );
  expect(saved.roster.find((u) => u.name === 'Reload Veteran')).toMatchObject({
    className: 'Myrmidon',
    skills: ['wrath', 'vantage'],
    consumables: [],
    weapon: { name: 'Iron Sword' },
  });
  await resumeSavedRun(page);
  const notes = page.getByRole('dialog', { name: 'Field notes', exact: true });
  await expect(notes).toBeVisible();
  await page.waitForTimeout(550);
  await notes.getByRole('button', { name: 'Continue', exact: true }).last().tap();
  await expect(notes).toHaveCount(0);
  await page.locator(`[data-node="${nodeId}"]`).tap();
  await page.getByRole('button', { name: 'Advance', exact: true }).tap();
  await waitForScene(page, 'Battle');
  await battleIdle(page); // This small roster follows the normal automatic deployment path.
  // A resumed slot with no seen hints shows the first-battle camera Field notes
  // shortly after controls unlock; it owns map input until dismissed.
  await expect(notes).toBeVisible();
  await page.waitForTimeout(550);
  await notes.getByRole('button', { name: 'Continue', exact: true }).last().tap();
  await expect(notes).toHaveCount(0);
  const deployed = await page.evaluate(async () => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const { canEquip } = await import('/src/engine/UnitManager.js');
    const u = s.playerUnits.find((u) => u.name === 'Reload Veteran');
    return {
      className: u.className,
      skills: u.skills,
      seals: u.consumables.length,
      weapon: u.weapon?.name,
      identity: u.inventory.includes(u.weapon),
      usable: canEquip(u, u.weapon),
    };
  });
  expect(deployed).toEqual({
    className: 'Myrmidon',
    skills: ['wrath', 'vantage'],
    seals: 0,
    weapon: 'Iron Sword',
    identity: true,
    usable: true,
  });
  await tapUnit(page, 'Reload Veteran');
  await expect(page.getByRole('complementary', { name: 'Battle commands' })).toContainText('Wait');
  await page.screenshot({ path: testInfo.outputPath('reclass-reloaded-deployed.png') });
  expect(errors).toEqual([]);
});

for (const action of ['level up', 'promotion']) {
  test(`refresh during ${action} popup preserves resolved action and costs`, async ({
    page,
  }, testInfo) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/?devScene=battle&preset=battle_smoke&seed=42&mobilePreview=1');
    await waitForScene(page, 'Battle');
    await battleIdle(page);
    await attachSlot(page);
    const name = await page.evaluate((action) => {
      const s = window.__emblemRogueGame.scene.getScene('Battle'),
        u = s.playerUnits[0];
      u.skills = [];
      if (action === 'promotion') {
        u.level = 10;
        u.consumables = [
          structuredClone(s.gameData.consumables.find((i) => i.effect === 'promote')),
        ];
      } else {
        u.xp = 99;
        u.stats.STR = 999;
        u.weapon.hit = 999;
        const enemy = s.enemyUnits[0];
        const tile = [
          [u.col + 1, u.row],
          [u.col - 1, u.row],
          [u.col, u.row + 1],
          [u.col, u.row - 1],
        ].find(
          ([col, row]) =>
            col >= 0 &&
            row >= 0 &&
            col < s.grid.cols &&
            row < s.grid.rows &&
            !s.getUnitAt(col, row),
        );
        if (!tile) throw new Error('Fixture requires an adjacent open tile');
        [enemy.col, enemy.row] = tile;
        enemy.name = 'Reload Target';
        enemy.currentHP = 1;
        enemy.skills = [];
        s.grid.setTerrainAt(enemy.col, enemy.row, 0);
        s.updateUnitPosition(enemy);
        s.updateHPBar(enemy);
      }
      s._captureSuspendCheckpoint();
      return u.name;
    }, action);
    await tapUnit(page, name);
    const hud = page.getByRole('complementary', { name: 'Battle commands' });
    if (action === 'promotion') {
      await hud.getByRole('button', { name: 'Item', exact: true }).tap();
      await hud.getByRole('button', { name: /^Master Seal/ }).tap();
    } else {
      await hud.getByRole('button', { name: 'Attack', exact: true }).tap();
      await hud.getByRole('button', { name: /Iron Sword/ }).tap();
      await tapUnit(page, 'Reload Target', 'enemyUnits');
      await page.getByRole('button', { name: 'Confirm attack', exact: true }).tap();
    }
    const popup = page.getByRole('dialog', {
      name: action === 'promotion' ? 'Promotion' : 'Level up',
      exact: true,
    });
    await expect(popup).toBeVisible({ timeout: 20000 });
    const before = await page.evaluate((name) => {
      const s = window.__emblemRogueGame.scene.getScene('Battle'),
        u = s.playerUnits.find((u) => u.name === name);
      const cp = JSON.parse(localStorage.getItem('emblem_rogue_slot_1_run')).battleInProgress
        .checkpoint;
      return {
        unit: {
          className: u.className,
          level: u.level,
          xp: u.xp,
          stats: u.stats,
          skills: u.skills,
          consumables: u.consumables,
        },
        stored: cp.playerUnits.find((u) => u.name === name),
        pending: cp.pendingActionCompletion,
        targetPresent: cp.enemyUnits.some((u) => u.name === 'Reload Target'),
        gold: s.goldEarned,
      };
    }, name);
    expect(before.stored).toMatchObject(before.unit);
    expect(before.pending.unitName).toBe(name);
    if (action === 'level up') expect(before.targetPresent).toBe(false);
    else expect(before.unit.consumables).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath(`${action.replace(' ', '-')}-before-reload.png`),
    });
    await resumeSavedRun(page, true);
    await battleIdle(page);
    const after = await page.evaluate((name) => {
      const s = window.__emblemRogueGame.scene.getScene('Battle'),
        u = s.playerUnits.find((u) => u.name === name);
      return {
        unit: {
          className: u.className,
          level: u.level,
          xp: u.xp,
          stats: u.stats,
          skills: u.skills,
          consumables: u.consumables,
        },
        acted: u.hasActed,
        equipped: u.inventory.includes(u.weapon),
        gold: s.goldEarned,
        targetPresent: s.enemyUnits.some((u) => u.name === 'Reload Target'),
      };
    }, name);
    expect(after.unit).toEqual(before.unit);
    expect(after).toMatchObject({ acted: true, equipped: true, gold: before.gold });
    if (action === 'level up') expect(after.targetPresent).toBe(false);
    await expect(popup).toHaveCount(0);
    await page.screenshot({
      path: testInfo.outputPath(`${action.replace(' ', '-')}-after-reload.png`),
    });
    expect(errors).toEqual([]);
  });
}

test('Canto completion survives normal saved-battle resume with village reward and item cost exactly once', async ({
  page,
}, testInfo) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // Use a real generated/locked encounter so resume does not depend on lab URL parameters.
  await page.goto('/?devScene=battle&preset=battle_smoke&seed=42&mobilePreview=1');
  await waitForScene(page, 'Battle');
  await battleIdle(page);
  await attachSlot(page);
  const name = await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle'),
      u = s.playerUnits[0];
    if (!u.skills.includes('canto')) u.skills.push('canto');
    u.currentHP = Math.max(1, u.stats.HP - 10);
    u.consumables = [structuredClone(s.gameData.consumables.find((i) => i.name === 'Vulnerary'))];
    s.updateHPBar(u);
    const tile = { col: u.col, row: u.row };
    s.battleConfig.villageTile = tile;
    s.runManager.battleConfigsByNodeId[s.nodeId].villageTile = tile;
    s._villageState = { ...tile, status: 'intact' };
    s.grid.setTerrainAt(
      tile.col,
      tile.row,
      s.gameData.terrain.findIndex((t) => t.name === 'Village'),
    );
    s._villageController._renderMarker();
    return u.name;
  });
  await tapUnit(page, name);
  const hud = page.getByRole('complementary', { name: 'Battle commands' });
  await hud.getByRole('button', { name: 'Item', exact: true }).tap();
  await hud.getByRole('button', { name: /^Vulnerary/ }).tap();
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'CANTO_MOVING',
  );
  await page
    .getByRole('navigation', { name: 'Battle utilities' })
    .getByRole('button', { name: 'Back', exact: true })
    .tap();
  await battleIdle(page);
  const summary = () =>
    page.evaluate((name) => {
      const s = window.__emblemRogueGame.scene.getScene('Battle'),
        u = s.playerUnits.find((u) => u.name === name);
      return {
        col: u.col,
        row: u.row,
        hp: u.currentHP,
        acted: u.hasActed,
        uses: u.consumables[0].uses,
        gold: s.goldEarned,
        village: s._villageState,
        checkpointIndex: s.runManager.battleInProgress.checkpoint.checkpointIndex,
      };
    }, name);
  const before = await summary();
  expect(before).toMatchObject({ acted: true, uses: 2, village: { status: 'visited' } });
  expect(before.gold).toBeGreaterThan(0);
  const stored = await page.evaluate(
    () => JSON.parse(localStorage.getItem('emblem_rogue_slot_1_run')).battleInProgress.checkpoint,
  );
  expect(stored.villageState.status).toBe('visited');
  expect(stored.goldEarned).toBe(before.gold);
  await resumeSavedRun(page, true);
  await battleIdle(page);
  expect(await summary()).toEqual(before);
  await page.screenshot({ path: testInfo.outputPath('canto-village-reloaded.png') });
  expect(errors).toEqual([]);
});
