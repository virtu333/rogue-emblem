import { test, expect, devices } from '@playwright/test';
import { finishFormation, waitForScene } from './helpers.js';

test.use({
  ...devices['iPhone SE'],
  viewport: { width: 667, height: 375 },
});
test.setTimeout(90000);
test.beforeEach(async ({ page }) => {
  page.setDefaultTimeout(10000);
  // Concurrent source edits must not make Vite refresh an in-progress save test.
  await page.routeWebSocket(/^ws:\/\/(?:127\.0\.0\.1|localhost):\d+/, (socket) => socket.close());
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
  // The DOM title offers Save Slots once a slot exists.
  const slots = page.getByRole('button', { name: 'Save Slots', exact: true });
  await expect(slots).toBeEnabled();
  await slots.tap();
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
  await page.getByRole('button', { name: 'Travel', exact: true }).tap();
  await waitForScene(page, 'Battle');
  // Three units: the run opens Formation first; take the default placement.
  await finishFormation(page);
  await battleIdle(page);
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
      s._captureSuspendCheckpoint({ session: s._battleSession });
      return u.name;
    }, action);
    await tapUnit(page, name);
    const hud = page.getByRole('complementary', { name: 'Battle commands' });
    if (action === 'promotion') {
      await hud.getByRole('button', { name: 'Item', exact: true }).tap();
      await hud.getByRole('button', { name: /^Master Seal/ }).tap();
    } else {
      // Target first: Attack goes straight to target selection.
      await hud.getByRole('button', { name: 'Attack', exact: true }).tap();
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
    // A 3-use Vulnerary pinned by the fixture (the catalog's uses follow the meta upgrade):
    // the item cost is checked as exactly one use, 3 -> 2.
    u.consumables = [
      { ...structuredClone(s.gameData.consumables.find((i) => i.name === 'Vulnerary')), uses: 3 },
    ];
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

// Playtest 2026-09-26 follow-up ("The Last": the only non-lord standing at victory with
// four or more deployed and two or more allies fallen). A resumed battle rebuilt its
// deployment count as 2, so a battle that was ever refreshed, saved and exited, or
// closed by iOS could never award the deed; the fallen count must survive as well.
test('a resumed battle keeps its deployment and fallen counts for the Last', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/?devScene=battle&preset=combat_actions&seed=42&mobilePreview=1');
  await waitForScene(page, 'Battle');
  await battleIdle(page);
  await attachSlot(page);
  // Edric and Sera (lords) with three recruits: Utility and Support fall through the
  // shipping removal path (the counted one); Patient is the last recruit standing.
  const before = await page.evaluate(async () => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const deployed = s.playerUnits.map((u) => ({ name: u.name, lord: Boolean(u.isLord) }));
    s.dialogueOverlay = { show: async () => {} }; // a recruit's last words wait for a tap
    for (const name of ['Utility', 'Support']) {
      const unit = s.playerUnits.find((u) => u.name === name);
      unit.currentHP = 0;
      await s.removeUnit(unit);
    }
    s._captureSuspendCheckpoint({ session: s._battleSession });
    return { deployed, deployCount: s.battleParams.deployCount };
  });
  expect(before.deployed).toEqual([
    { name: 'Edric', lord: true },
    { name: 'Sera', lord: true },
    { name: 'Utility', lord: false },
    { name: 'Support', lord: false },
    { name: 'Patient', lord: false },
  ]);
  expect(before.deployCount).toBe(5);

  await resumeSavedRun(page, true);
  await battleIdle(page);
  const resumed = await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    return {
      living: s.playerUnits.map((u) => u.name),
      deployCount: s.battleParams.deployCount,
      saved: s.runManager.battleInProgress.battleParams.deployCount,
      fallen: s._playerDeathsThisBattle,
    };
  });
  expect(resumed).toEqual({
    living: ['Edric', 'Sera', 'Patient'],
    deployCount: 5,
    saved: 5,
    fallen: 2,
  });

  // Win: Patient, the only recruit left of five deployed with two fallen, is the Last.
  await page.evaluate(() => window.__emblemRogueGame.scene.getScene('Battle').onVictory());
  await expect
    .poll(() =>
      page.evaluate(() => {
        const run = JSON.parse(localStorage.getItem('emblem_rogue_slot_1_run'));
        const ids = (name) =>
          (run.roster.find((u) => u.name === name)?.deeds?.earned || []).map((e) => e.id);
        return {
          patient: ids('Patient').includes('last_of_them'),
          lords: ids('Edric').includes('last_of_them') || ids('Sera').includes('last_of_them'),
        };
      }),
    )
    .toEqual({ patient: true, lords: false });
  expect(errors).toEqual([]);
});
