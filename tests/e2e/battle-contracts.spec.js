import { test, expect, devices } from '@playwright/test';
const phone = { ...devices['iPhone SE'], viewport: { width: 667, height: 375 } };
delete phone.defaultBrowserType;

async function boot(page, mobile) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(
    `/?devScene=battle&preset=combat_actions&seed=42&battleLab=1${mobile ? '&mobilePreview=1' : ''}`,
  );
  await page.waitForFunction(
    () => window.__emblemRogueGame?.scene.getScene('Battle')?.battleState === 'PLAYER_IDLE',
  );
  return errors;
}
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
async function action(page, name, mobile) {
  if (mobile) {
    await page
      .getByRole('complementary', { name: 'Battle commands' })
      .getByRole('button', { name, exact: true })
      .tap();
    return;
  }
  // Read the rendered canvas labels, then use the shipping keyboard navigation.
  const steps = await page.evaluate((name) => {
    const menu = window.__emblemRogueGame.scene.getScene('Battle')._menuFocus;
    const index = menu.items.findIndex((item) => item.button.text === name);
    if (index < 0) throw new Error(`Missing canvas action: ${name}`);
    return (index - menu.index + menu.items.length) % menu.items.length;
  }, name);
  for (let i = 0; i < steps; i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
}
async function back(page, mobile) {
  if (mobile)
    await page
      .getByRole('navigation', { name: 'Battle utilities' })
      .getByRole('button', { name: 'Back', exact: true })
      .tap();
  else await page.keyboard.press('Escape');
}
async function idle(page) {
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'PLAYER_IDLE',
  );
}
async function summary(page) {
  return page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    return {
      state: s.battleState,
      turn: s.turnManager.turnNumber,
      village: s._villageState,
      gold: s.goldEarned,
      checkpoint: s.runManager.battleInProgress.checkpoint,
      units: s.playerUnits.map((u) => ({
        name: u.name,
        col: u.col,
        row: u.row,
        hp: u.currentHP,
        moved: u.hasMoved,
        acted: u.hasActed,
        spent: u._movementSpent,
        committed: u._movementCommitted,
        consumables: u.consumables,
      })),
    };
  });
}

for (const mobile of [true, false]) {
  test.describe(mobile ? 'phone action contracts' : 'desktop action contracts', () => {
    test.use(mobile ? phone : { viewport: { width: 1280, height: 800 } });
    test('committed trade survives submenu Back, reselection and another Back', async ({
      page,
    }, testInfo) => {
      const errors = await boot(page, mobile);
      await page.evaluate(() => {
        const s = window.__emblemRogueGame.scene.getScene('Battle');
        s.playerUnits.find((u) => u.name === 'Edric').consumables = [
          structuredClone(s.gameData.consumables.find((i) => i.name === 'Vulnerary')),
        ];
        s.playerUnits.find((u) => u.name === 'Sera').consumables = [];
      });
      await tile(page, 3, 3, mobile);
      await tile(page, 2, 2, mobile);
      await page.waitForFunction(
        () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'UNIT_ACTION_MENU',
      );
      await action(page, 'Trade', mobile);
      await tile(page, 2, 3, mobile);
      await page.getByRole('button', { name: /^Vulnerary/ }).click();
      await page.getByRole('button', { name: 'Give Vulnerary to Sera', exact: true }).click();
      await page.getByRole('button', { name: 'Done', exact: true }).click();
      await action(page, 'Trade', mobile);
      await back(page, mobile);
      await back(page, mobile);
      await idle(page);
      await tile(page, 2, 2, mobile);
      await back(page, mobile);
      await tile(page, 6, 2, mobile);
      const result = await summary(page);
      expect(result.units.find((u) => u.name === 'Edric')).toMatchObject({
        col: 2,
        row: 2,
        moved: true,
        spent: 2,
        acted: false,
        committed: true,
        consumables: [],
      });
      expect(result.units.find((u) => u.name === 'Sera').consumables).toHaveLength(1);
      expect(result.checkpoint.playerUnits.find((u) => u.name === 'Edric')).toMatchObject({
        col: 2,
        row: 2,
        _movementCommitted: true,
        hasActed: false,
      });
      expect(result.state).toBe('PLAYER_IDLE');
      await page.screenshot({ path: testInfo.outputPath('trade-movement-committed.png') });
      expect(errors).toEqual([]);
    });
  });
}

test.describe('phone Canto and rewind contracts', () => {
  test.use(phone);
  for (const ending of ['Back', 'same tile', 'move']) {
    test(`Canto ${ending} claims the final village and saves the action`, async ({
      page,
    }, testInfo) => {
      const errors = await boot(page, true);
      const village = ending === 'move' ? { col: 2, row: 2 } : { col: 3, row: 3 };
      const maxHP = await page.evaluate((pos) => {
        const s = window.__emblemRogueGame.scene.getScene('Battle'),
          u = s.playerUnits.find((u) => u.name === 'Edric');
        u.skills.push('canto');
        u.currentHP -= 10;
        u.consumables = [
          structuredClone(s.gameData.consumables.find((i) => i.name === 'Vulnerary')),
        ];
        s.updateHPBar(u);
        s.battleConfig.villageTile = pos;
        s._villageState = { ...pos, status: 'intact' };
        s.grid.setTerrainAt(
          pos.col,
          pos.row,
          s.gameData.terrain.findIndex((t) => t.name === 'Village'),
        );
        s._villageController._renderMarker();
        return u.stats.HP;
      }, village);
      const before = await summary(page);
      await tile(page, 3, 3, true);
      await action(page, 'Item', true);
      await page
        .getByRole('complementary', { name: 'Battle commands' })
        .getByRole('button', { name: /^Vulnerary/ })
        .tap();
      await page.waitForFunction(
        () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'CANTO_MOVING',
      );
      if (ending === 'Back') await back(page, true);
      else await tile(page, village.col, village.row, true);
      await idle(page);
      const after = await summary(page);
      expect(after.village.status).toBe('visited');
      expect(after.gold).toBeGreaterThan(before.gold);
      expect(after.checkpoint.checkpointIndex).toBe(before.checkpoint.checkpointIndex + 1);
      expect(after.checkpoint.villageState.status).toBe('visited');
      expect(after.checkpoint.playerUnits.find((u) => u.name === 'Edric')).toMatchObject({
        col: village.col,
        row: village.row,
        hasActed: true,
        currentHP: maxHP,
      });
      expect(after.units.find((u) => u.name === 'Edric').consumables[0].uses).toBe(2);
      await page.screenshot({ path: testInfo.outputPath('canto-village-saved.png') });
      expect(errors).toEqual([]);
    });
  }
  test('Vision preserves resolved turn-start healing and does not heal twice', async ({
    page,
  }, testInfo) => {
    const errors = await boot(page, true);
    // Rewind now commits an exact saved branch; give this dev fixture a real slot.
    await page.evaluate(async () => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      const { getMetaKey, setActiveSlot } = await import('/src/engine/SlotManager.js');
      const meta = s.registry.get('meta');
      meta.storageKey = getMetaKey(1);
      meta._save();
      s.registry.set('activeSlot', 1);
      setActiveSlot(1);
      s._captureSuspendCheckpoint();
    });
    await page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('Battle'),
        u = s.playerUnits.find((u) => u.name === 'Sera');
      u.skills.push('renewal');
      u.stats.HP = 50;
      u.currentHP = 10;
      s.updateHPBar(u);
      s.enemyUnits.forEach((e, i) => {
        e.col = 9;
        e.row = 5 + i;
        e.mov = 0;
        e.stats.MOV = 0;
        s.updateUnitPosition(e);
      });
    });
    const hud = page.getByRole('complementary', { name: 'Battle commands' });
    await hud.getByRole('button', { name: 'End turn…', exact: true }).tap();
    await hud.getByRole('button', { name: 'End turn now', exact: true }).tap();
    await page.waitForFunction(() => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      return s.turnManager.turnNumber === 2 && s.battleState === 'PLAYER_IDLE';
    });
    const healed = await summary(page);
    expect(healed.units.find((u) => u.name === 'Sera').hp).toBe(15);
    await tile(page, 3, 3, true);
    await action(page, 'Wait', true);
    await idle(page);
    await hud.getByRole('button', { name: 'Rewind', exact: true }).tap();
    const picker = page.getByRole('dialog', { name: 'Rewind', exact: true });
    // The newest point is the start of turn 2, just before Edric's wait.
    await expect(picker.locator('.vr-row').first().locator('.vr-title')).toHaveText(
      'Start of turn 2',
    );
    await picker.getByRole('button', { name: 'Rewind here · 1 charge', exact: true }).tap();
    await idle(page);
    const rewound = await summary(page);
    expect(rewound.turn).toBe(2);
    expect(rewound.units.map((u) => [u.name, u.hp])).toEqual(
      healed.units.map((u) => [u.name, u.hp]),
    );
    expect(rewound.units.find((u) => u.name === 'Edric').acted).toBe(false);
    await page.screenshot({ path: testInfo.outputPath('rewind-preserves-healing.png') });
    expect(errors).toEqual([]);
  });
});
