// E2E: Weapon selection smoke tests.
// Verifies weapon picker and equip menu use pointerdown (not pointerup)
// to prevent bleed-through selection when submenus spawn under the cursor.
// Tests 1-2 dispatch native MouseEvents on canvas to exercise Phaser's
// full InputManager pipeline. Tests 3-5 use synthetic emits for targeted checks.

import { test, expect } from '@playwright/test';
import { waitForGame, waitForScene, attachSceneCrashArtifacts } from './helpers.js';

// --- Canvas pointer event helpers ---

/**
 * Dispatch a native MouseEvent on the Phaser canvas at world coords.
 * This runs through Phaser input hit-testing and handlers.
 */
async function dispatchCanvasMouseEvent(page, eventType, worldX, worldY) {
  await page.evaluate(
    ({ type, wx, wy }) => {
      const game = window.__emblemRogueGame;
      const canvas = game?.canvas;
      if (!game || !canvas) return;

      const toPositiveNumber = (value) => {
        const n = Number(value);
        return Number.isFinite(n) && n > 0 ? n : null;
      };

      const gameW =
        toPositiveNumber(game?.scale?.gameSize?.width) ??
        toPositiveNumber(game?.config?.width) ??
        toPositiveNumber(canvas?.width) ??
        640;
      const gameH =
        toPositiveNumber(game?.scale?.gameSize?.height) ??
        toPositiveNumber(game?.config?.height) ??
        toPositiveNumber(canvas?.height) ??
        480;

      // In headless mode canvas layout can be 0x0; patch rect so Phaser maps
      // client coords to game coords correctly for this single event dispatch.
      const originalGetBounds = canvas.getBoundingClientRect;
      try {
        canvas.getBoundingClientRect = () => ({
          left: 0,
          top: 0,
          right: gameW,
          bottom: gameH,
          width: gameW,
          height: gameH,
          x: 0,
          y: 0,
        });

        canvas.dispatchEvent(
          new MouseEvent(type, {
            clientX: wx,
            clientY: wy,
            bubbles: true,
            button: 0,
            buttons: type === 'mouseup' ? 0 : 1,
          }),
        );
      } finally {
        canvas.getBoundingClientRect = originalGetBounds;
      }
    },
    { type: eventType, wx: worldX, wy: worldY },
  );
}

/**
 * Find the center of an action menu button by exact label.
 * Returns world-space {x, y} or null.
 */
async function getActionMenuButtonCenter(page, label) {
  return page.evaluate((lbl) => {
    const battle = window.__emblemRogueGame?.scene?.getScene?.('Battle');
    if (!battle?.actionMenu) return null;
    const btn = battle.actionMenu.find((o) => o.type === 'Text' && o.text === lbl);
    if (!btn) return null;
    const b = btn.getBounds();
    return { x: b.centerX, y: b.centerY };
  }, label);
}

/**
 * Return interactive action menu rows hit at a world-space point.
 * Uses row hitAreaCallback + inverse world transform to mirror Phaser hit tests.
 */
async function getInteractiveRowsHitAtWorldPoint(page, worldX, worldY) {
  return page.evaluate(
    ({ wx, wy }) => {
      const battle = window.__emblemRogueGame?.scene?.getScene?.('Battle');
      const rows = (battle?.actionMenu || []).filter((o) => o?.type === 'Text' && o.input?.enabled);

      const hitLabels = [];
      rows.forEach((row) => {
        const input = row.input;
        if (
          !input?.hitArea ||
          typeof input.hitAreaCallback !== 'function' ||
          typeof row.getWorldTransformMatrix !== 'function'
        ) {
          return;
        }

        try {
          const matrix = row.getWorldTransformMatrix();
          const local = matrix.applyInverse(wx, wy, { x: 0, y: 0 });
          const hit = input.hitAreaCallback(input.hitArea, local.x, local.y, row);
          if (hit) hitLabels.push(String(row.text || ''));
        } catch {
          // Ignore transient/destroyed rows during menu transitions.
        }
      });

      return { hitCount: hitLabels.length, hitLabels };
    },
    { wx: worldX, wy: worldY },
  );
}

// --- Battle setup helpers ---

/**
 * Advance past DEPLOY_SELECTION to PLAYER_IDLE via deploy confirm button.
 */
async function advancePastDeploy(page) {
  await page.evaluate(() => {
    const battle = window.__emblemRogueGame?.scene?.getScene?.('Battle');
    if (!battle || battle.battleState !== 'DEPLOY_SELECTION') return;
    const objects = battle.children?.list || [];
    const rects = objects.filter(
      (o) =>
        o?.type === 'Rectangle' &&
        o.input?.enabled === true &&
        o.listenerCount?.('pointerdown') > 0,
    );
    const confirmBtn = rects[rects.length - 1];
    if (confirmBtn) confirmBtn.emit('pointerdown');
  });
}

/**
 * Wait for battle to reach PLAYER_IDLE, auto-advancing DEPLOY_SELECTION if needed.
 */
async function ensurePlayerIdle(page) {
  await page.waitForFunction(
    (allowed) => allowed.includes(window.__sceneState?.battle?.state),
    ['PLAYER_IDLE', 'DEPLOY_SELECTION'],
    { timeout: 15_000 },
  );
  const state = await page.evaluate(() => window.__sceneState?.battle?.state);
  if (state === 'DEPLOY_SELECTION') {
    await advancePastDeploy(page);
    await page.waitForFunction(() => window.__sceneState?.battle?.state === 'PLAYER_IDLE', null, {
      timeout: 12_000,
    });
  }
}

/**
 * Navigate to battle scene and wait until battle is idle.
 */
async function setupBattle(page) {
  await page.goto('/?devScene=battle&preset=battle_smoke');
  await waitForGame(page);
  await waitForScene(page, 'Battle');
  await ensurePlayerIdle(page);
}

/**
 * Open action menu for first unmoved player unit.
 */
async function openActionMenuForFirstUnit(page) {
  await page.evaluate(() => {
    const battle = window.__emblemRogueGame.scene.getScene('Battle');
    const unit = battle.playerUnits.find((u) => !u.hasMoved);
    if (unit) battle.showActionMenu(unit);
  });
}

/**
 * Force one enemy adjacent to first unmoved unit so Attack becomes available.
 * If needed, equip melee weapon first.
 */
async function forceAttackableEnemy(page) {
  await page.evaluate(() => {
    const battle = window.__emblemRogueGame.scene.getScene('Battle');
    const unit = battle.playerUnits.find((u) => !u.hasMoved);
    if (!unit || !battle.enemyUnits?.length) return;

    const rangeStr = String(unit.weapon?.range || '1');
    const minRange = parseInt(rangeStr.split('-')[0], 10) || 1;

    if (minRange > 1) {
      const ironSword = {
        name: 'Iron Sword',
        type: 'Sword',
        tier: 'Iron',
        rankRequired: 'Prof',
        might: 5,
        hit: 90,
        crit: 0,
        weight: 5,
        range: '1',
        special: '',
        price: 500,
      };
      unit.inventory.unshift(ironSword);
      unit.weapon = ironSword;
    }

    const enemy = battle.enemyUnits[0];
    enemy.col = unit.col + 1;
    enemy.row = unit.row;
    if (enemy.graphic && battle.grid) {
      const pos = battle.grid.gridToPixel(enemy.col, enemy.row);
      enemy.graphic.x = pos.x;
      enemy.graphic.y = pos.y;
    }
  });
}

/**
 * Ensure first unmoved unit has at least 2 combat weapons.
 */
async function ensureTwoCombatWeapons(page) {
  await page.evaluate(() => {
    const battle = window.__emblemRogueGame.scene.getScene('Battle');
    const unit = battle.playerUnits.find((u) => !u.hasMoved);
    if (!unit?.weapon) return;
    const combatWeapons = unit.inventory.filter(
      (w) => w.type !== 'Consumable' && w.type !== 'Staff' && w.type !== 'Scroll',
    );
    if (combatWeapons.length < 2) {
      const clone = structuredClone(unit.weapon);
      clone.name = clone.name + ' (2)';
      unit.inventory.push(clone);
    }
  });
}

/**
 * Open weapon picker directly for first unmoved player unit.
 */
async function openWeaponPickerForFirstUnit(page) {
  await ensureTwoCombatWeapons(page);
  await page.evaluate(() => {
    const battle = window.__emblemRogueGame.scene.getScene('Battle');
    const unit = battle.playerUnits.find((u) => !u.hasMoved);
    if (!unit || !unit.weapon) return;
    battle.showWeaponPicker(unit, battle.enemyUnits);
  });
}

test.afterEach(async ({ page }, testInfo) => {
  await attachSceneCrashArtifacts(page, testInfo);
});

test.describe('Weapon selection smoke', () => {
  test('Equip real click does not auto-select spawned weapon row', async ({ page }) => {
    await setupBattle(page);
    await ensureTwoCombatWeapons(page);
    await openActionMenuForFirstUnit(page);

    const originalWeapon = await page.evaluate(() => {
      const battle = window.__emblemRogueGame?.scene?.getScene?.('Battle');
      const unit = battle?.playerUnits?.find((u) => !u.hasMoved);
      return unit?.weapon?.name || null;
    });

    const center = await getActionMenuButtonCenter(page, 'Equip');
    expect(center, 'Equip button not found in action menu').not.toBeNull();
    expect(originalWeapon, 'No initial weapon found for first unmoved unit').toBeTruthy();

    await dispatchCanvasMouseEvent(page, 'mousedown', center.x, center.y);

    await page.waitForFunction(
      () => {
        const b = window.__emblemRogueGame?.scene?.getScene?.('Battle');
        return b?.inEquipMenu === true;
      },
      null,
      { timeout: 5_000 },
    );

    const hitRows = await getInteractiveRowsHitAtWorldPoint(page, center.x, center.y);
    expect(
      hitRows.hitCount,
      `Expected pointer to overlap spawned equip rows; got [${hitRows.hitLabels.join(', ')}]`,
    ).toBeGreaterThan(0);

    await dispatchCanvasMouseEvent(page, 'mouseup', center.x, center.y);

    const result = await page.evaluate(() => {
      const battle = window.__emblemRogueGame.scene.getScene('Battle');
      const unit = battle.playerUnits.find((u) => !u.hasMoved);
      return {
        battleState: battle.battleState,
        inEquipMenu: battle.inEquipMenu,
        weaponName: unit?.weapon?.name || null,
      };
    });

    expect(result.battleState).toBe('UNIT_ACTION_MENU');
    expect(result.inEquipMenu).toBe(true);
    expect(result.weaponName).toBe(originalWeapon);
  });

  test('Attack real click does not auto-select spawned weapon row', async ({ page }) => {
    await setupBattle(page);
    await forceAttackableEnemy(page);
    await ensureTwoCombatWeapons(page);
    await openActionMenuForFirstUnit(page);

    const center = await getActionMenuButtonCenter(page, 'Attack');
    expect(center, 'Attack button not found - no enemy in range?').not.toBeNull();

    await dispatchCanvasMouseEvent(page, 'mousedown', center.x, center.y);

    await page.waitForFunction(
      () => {
        const b = window.__emblemRogueGame?.scene?.getScene?.('Battle');
        return b?.inEquipMenu === true;
      },
      null,
      { timeout: 5_000 },
    );

    const hitRows = await getInteractiveRowsHitAtWorldPoint(page, center.x, center.y);
    expect(
      hitRows.hitCount,
      `Expected pointer to overlap spawned attack rows; got [${hitRows.hitLabels.join(', ')}]`,
    ).toBeGreaterThan(0);

    await dispatchCanvasMouseEvent(page, 'mouseup', center.x, center.y);

    const result = await page.evaluate(() => {
      const battle = window.__emblemRogueGame.scene.getScene('Battle');
      return {
        battleState: battle.battleState,
        inEquipMenu: battle.inEquipMenu,
      };
    });

    expect(result.battleState).toBe('UNIT_ACTION_MENU');
    expect(result.inEquipMenu).toBe(true);
  });

  test('weapon picker - pointerdown selects weapon and enters target selection', async ({
    page,
  }) => {
    await setupBattle(page);
    await openWeaponPickerForFirstUnit(page);

    const result = await page.evaluate(() => {
      const battle = window.__emblemRogueGame.scene.getScene('Battle');
      const weaponRows = (battle.actionMenu || []).filter(
        (o) => o.type === 'Text' && o.input?.enabled && /^(\u25b6 | {2})/.test(o.text),
      );
      const weaponRowCount = weaponRows.length;
      if (weaponRows[0]) weaponRows[0].emit('pointerdown');
      return {
        weaponRowCount,
        battleState: battle.battleState,
        inEquipMenu: battle.inEquipMenu,
      };
    });

    expect(result.weaponRowCount).toBeGreaterThan(0);
    expect(result.battleState).toBe('SELECTING_TARGET');
    expect(result.inEquipMenu).toBe(false);
  });

  test('equip menu - pointerdown selects weapon and returns to action menu', async ({ page }) => {
    await setupBattle(page);
    await ensureTwoCombatWeapons(page);
    await openActionMenuForFirstUnit(page);

    const result = await page.evaluate(() => {
      const battle = window.__emblemRogueGame.scene.getScene('Battle');
      const unit = battle.playerUnits.find((u) => !u.hasMoved);
      const originalWeapon = unit?.weapon?.name;

      const actionItems = (battle.actionMenu || []).filter((o) => o.type === 'Text');
      const equipBtn = actionItems.find((o) => o.text === 'Equip');
      if (equipBtn) equipBtn.emit('pointerdown');

      const weaponRows = (battle.actionMenu || []).filter(
        (o) => o.type === 'Text' && o.input?.enabled && o.text.startsWith('  '),
      );
      const weaponRowCount = weaponRows.length;
      if (weaponRows[0]) weaponRows[0].emit('pointerdown');

      return {
        weaponRowCount,
        battleState: battle.battleState,
        inEquipMenu: battle.inEquipMenu,
        weaponChanged: unit?.weapon?.name !== originalWeapon,
      };
    });

    expect(result.weaponRowCount).toBeGreaterThan(0);
    expect(result.battleState).toBe('UNIT_ACTION_MENU');
    expect(result.inEquipMenu).toBe(false);
    expect(result.weaponChanged).toBe(true);
  });

  test('weapon picker - pointerup does not trigger selection (synthetic emit regression)', async ({
    page,
  }) => {
    await setupBattle(page);
    await openWeaponPickerForFirstUnit(page);

    const result = await page.evaluate(() => {
      const battle = window.__emblemRogueGame.scene.getScene('Battle');
      const weaponRows = (battle.actionMenu || []).filter(
        (o) => o.type === 'Text' && o.input?.enabled && /^(\u25b6 | {2})/.test(o.text),
      );
      const weaponRowCount = weaponRows.length;
      if (weaponRows[0]) weaponRows[0].emit('pointerup');
      return {
        weaponRowCount,
        battleState: battle.battleState,
        inEquipMenu: battle.inEquipMenu,
      };
    });

    expect(result.weaponRowCount).toBeGreaterThan(0);
    expect(result.battleState).toBe('UNIT_ACTION_MENU');
    expect(result.inEquipMenu).toBe(true);
  });
});
