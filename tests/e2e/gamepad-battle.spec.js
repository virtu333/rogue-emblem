// E2E: gamepad-driven battle loop.
// Drives the game with a simulated standard-mapping pad (injected via the
// `?gamepadSim` hook -> window.__gamepadSim, polled by the global GamepadReader)
// and proves the controller path works end to end through the SAME code the mouse
// uses: cursor navigation, unit select, unit move, action-menu focus + activate,
// target selection, forecast, and combat resolution.

import { test, expect } from '@playwright/test';
import { waitForGame, waitForScene, attachSceneCrashArtifacts } from './helpers.js';

const BTN = {
  CONFIRM: 0,
  CANCEL: 1,
  L1: 4,
  R1: 5,
  INSPECT: 6,
  PAUSE: 9,
  UP: 12,
  DOWN: 13,
  LEFT: 14,
  RIGHT: 15,
};

// Install a single connected, standard-mapped fake pad. The reader only reads it
// because the URL carries ?gamepadSim.
async function installSimPad(page) {
  await page.evaluate(() => {
    window.__gamepadSim = {
      pads: [
        {
          connected: true,
          mapping: 'standard',
          buttons: Array.from({ length: 16 }, () => ({ pressed: false, value: 0 })),
          axes: [0, 0, 0, 0],
        },
      ],
    };
  });
}

async function setButton(page, index, pressed) {
  await page.evaluate(
    ({ i, p }) => {
      const pad = window.__gamepadSim?.pads?.[0];
      if (pad) pad.buttons[i] = { pressed: p, value: p ? 1 : 0 };
    },
    { i: index, p: pressed },
  );
}

// One discrete press: hold long enough for the reader to edge-detect, then release.
async function tap(page, index) {
  await setButton(page, index, true);
  await page.waitForTimeout(60);
  await setButton(page, index, false);
  await page.waitForTimeout(60);
}

const getBattleState = (page) => page.evaluate(() => window.__sceneState?.battle?.state);

const getCursor = (page) =>
  page.evaluate(() => {
    const b = window.__emblemRogueGame?.scene?.getScene?.('Battle');
    return b?._gridCursor ? { col: b._gridCursor.cursorCol, row: b._gridCursor.cursorRow } : null;
  });

// Step the cursor tile-by-tile to (col,row) via d-pad taps, re-reading each time
// so grid clamping can't desync us.
async function moveCursorTo(page, col, row, maxSteps = 80) {
  for (let i = 0; i < maxSteps; i++) {
    const cur = await getCursor(page);
    if (!cur) throw new Error('grid cursor not available');
    if (cur.col === col && cur.row === row) return;
    if (cur.col < col) await tap(page, BTN.RIGHT);
    else if (cur.col > col) await tap(page, BTN.LEFT);
    else if (cur.row < row) await tap(page, BTN.DOWN);
    else await tap(page, BTN.UP);
  }
  throw new Error(`cursor did not reach (${col},${row})`);
}

// --- battle setup (mirrors weapon-selection.spec helpers) ---

async function advancePastDeploy(page) {
  await page.evaluate(() => {
    const battle = window.__emblemRogueGame?.scene?.getScene?.('Battle');
    if (!battle || battle.battleState !== 'DEPLOY_SELECTION') return;
    const rects = (battle.children?.list || []).filter(
      (o) => o?.type === 'Rectangle' && o.input?.enabled && o.listenerCount?.('pointerdown') > 0,
    );
    const confirmBtn = rects[rects.length - 1];
    if (confirmBtn) confirmBtn.emit('pointerdown');
  });
}

async function setupBattle(page) {
  await page.goto('/?devScene=battle&preset=battle_smoke&gamepadSim=1');
  await waitForGame(page);
  await waitForScene(page, 'Battle');
  await page.waitForFunction(
    (allowed) => allowed.includes(window.__sceneState?.battle?.state),
    ['PLAYER_IDLE', 'DEPLOY_SELECTION'],
    { timeout: 15_000 },
  );
  if ((await getBattleState(page)) === 'DEPLOY_SELECTION') {
    await advancePastDeploy(page);
    await page.waitForFunction(() => window.__sceneState?.battle?.state === 'PLAYER_IDLE', null, {
      timeout: 12_000,
    });
  }
  await installSimPad(page);
}

function firstUnitPos(page) {
  return page.evaluate(() => {
    const b = window.__emblemRogueGame.scene.getScene('Battle');
    const u = b.playerUnits.find((x) => !x.hasMoved);
    return u ? { col: u.col, row: u.row } : null;
  });
}

test.afterEach(async ({ page }, testInfo) => {
  await attachSceneCrashArtifacts(page, testInfo);
});

test.describe('Gamepad battle loop', () => {
  test('navigates the cursor and selects a player unit', async ({ page }) => {
    await setupBattle(page);
    const unit = await firstUnitPos(page);
    expect(unit).not.toBeNull();

    await moveCursorTo(page, unit.col, unit.row);
    const cur = await getCursor(page);
    expect(cur).toEqual(unit); // NAVIGATE drove the cursor to the unit's tile

    await tap(page, BTN.CONFIRM); // confirm on the unit -> select (via scene.onClick seam)
    await page.waitForFunction(() => window.__sceneState?.battle?.state === 'UNIT_SELECTED', null, {
      timeout: 8_000,
    });
    expect(await getBattleState(page)).toBe('UNIT_SELECTED');
  });

  test('completes select -> move -> Attack -> target -> forecast -> combat with the pad', async ({
    page,
  }) => {
    await setupBattle(page);
    const unit = await firstUnitPos(page);
    expect(unit).not.toBeNull();

    // Select the unit so its movement range is computed.
    await moveCursorTo(page, unit.col, unit.row);
    await tap(page, BTN.CONFIRM);
    await page.waitForFunction(() => window.__sceneState?.battle?.state === 'UNIT_SELECTED', null, {
      timeout: 8_000,
    });

    // Pick a reachable destination with an empty neighbor, park an adjacent melee
    // enemy there, and ensure the unit has exactly one (melee) combat weapon so
    // Attack goes straight to target selection (no weapon picker).
    const plan = await page.evaluate(() => {
      const b = window.__emblemRogueGame.scene.getScene('Battle');
      const unit = b.selectedUnit;
      const cols = b.grid.cols;
      const rows = b.grid.rows;
      const units = [...b.playerUnits, ...b.enemyUnits];
      const occupied = (c, r) => units.some((u) => u !== unit && u.col === c && u.row === r);
      const inBounds = (c, r) => c >= 0 && r >= 0 && c < cols && r < rows;
      const neighbors = (c, r) => [
        [c + 1, r],
        [c - 1, r],
        [c, r + 1],
        [c, r - 1],
      ];

      let dest = { col: unit.col, row: unit.row };
      let enemyTile = null;
      for (const [key, entry] of b.movementRange.entries()) {
        if (entry?.stoppable === false) continue;
        const [c, r] = key.split(',').map(Number);
        if (occupied(c, r)) continue;
        const nb = neighbors(c, r).find(
          ([nc, nr]) =>
            inBounds(nc, nr) && !occupied(nc, nr) && !(nc === unit.col && nr === unit.row),
        );
        if (!nb) continue;
        dest = { col: c, row: r };
        enemyTile = { col: nb[0], row: nb[1] };
        if (c !== unit.col || r !== unit.row) break; // prefer an actual move
      }
      if (!enemyTile) {
        const nb = neighbors(unit.col, unit.row).find(
          ([nc, nr]) => inBounds(nc, nr) && !occupied(nc, nr),
        );
        enemyTile = nb ? { col: nb[0], row: nb[1] } : null;
      }

      // Ensure a melee weapon equipped.
      const minRange = parseInt(String(unit.weapon?.range || '1').split('-')[0], 10) || 1;
      if (minRange > 1) {
        const iron = {
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
        unit.inventory.unshift(iron);
        unit.weapon = iron;
      }
      // Drop any extra combat weapons so Attack skips the weapon picker.
      const isCombat = (w) =>
        w && w.type !== 'Consumable' && w.type !== 'Staff' && w.type !== 'Scroll';
      unit.inventory = unit.inventory.filter((w) => !isCombat(w) || w === unit.weapon);

      const enemy = b.enemyUnits[0];
      if (enemyTile && enemy) {
        enemy.col = enemyTile.col;
        enemy.row = enemyTile.row;
        if (enemy.graphic) {
          const p = b.grid.gridToPixel(enemy.col, enemy.row);
          enemy.graphic.x = p.x;
          enemy.graphic.y = p.y;
        }
        b.dangerZoneStale = true;
      }
      return {
        dest,
        enemyTile,
        moved: dest.col !== unit.col || dest.row !== unit.row,
        enemyName: enemy?.name || null,
      };
    });
    expect(plan.enemyTile, 'no free tile to place an adjacent enemy').not.toBeNull();

    // Move (or confirm in place) -> the action menu opens.
    await moveCursorTo(page, plan.dest.col, plan.dest.row);
    await tap(page, BTN.CONFIRM);
    await page.waitForFunction(
      () => window.__sceneState?.battle?.state === 'UNIT_ACTION_MENU',
      null,
      { timeout: 10_000 },
    );

    // Focus the "Attack" item and activate it.
    const attackIndex = await page.evaluate(() => {
      const b = window.__emblemRogueGame.scene.getScene('Battle');
      return (b._menuFocus?.items || []).findIndex((it) => it.label === 'Attack');
    });
    expect(attackIndex, 'Attack not present in the action menu').toBeGreaterThanOrEqual(0);
    for (let i = 0; i < attackIndex; i++) await tap(page, BTN.DOWN);
    await tap(page, BTN.CONFIRM);
    await page.waitForFunction(
      () => window.__sceneState?.battle?.state === 'SELECTING_TARGET',
      null,
      { timeout: 8_000 },
    );

    // Aim at the enemy and confirm -> forecast.
    await moveCursorTo(page, plan.enemyTile.col, plan.enemyTile.row);
    await tap(page, BTN.CONFIRM);
    await page.waitForFunction(
      () => window.__sceneState?.battle?.state === 'SHOWING_FORECAST',
      null,
      { timeout: 8_000 },
    );

    // Confirm the forecast -> combat resolves. Combat is async (animations), so
    // wait for the action to actually be consumed rather than the state merely
    // leaving SHOWING_FORECAST (which happens the instant combat begins).
    await tap(page, BTN.CONFIRM);
    await page.waitForFunction(
      () => {
        const b = window.__emblemRogueGame?.scene?.getScene?.('Battle');
        return Boolean(b && b.playerUnits.some((u) => u.hasActed));
      },
      null,
      { timeout: 20_000 },
    );

    // Combat ran: the unit acted (action consumed) and we're no longer in forecast.
    const result = await page.evaluate(() => {
      const b = window.__emblemRogueGame.scene.getScene('Battle');
      return { state: b.battleState, anyActed: b.playerUnits.some((u) => u.hasActed) };
    });
    expect(result.anyActed).toBe(true);
    expect(result.state).not.toBe('SHOWING_FORECAST');
  });

  test('L1/R1 cycle the cursor through un-acted player units', async ({ page }) => {
    await setupBattle(page);

    // The same eligibility filter + reading-order sort the scene uses.
    const order = await page.evaluate(() => {
      const b = window.__emblemRogueGame.scene.getScene('Battle');
      const sleeping = (u) =>
        Array.isArray(u._conditions) && u._conditions.some((c) => c.id === 'sleep');
      return b.playerUnits
        .filter((u) => u && u.currentHP > 0 && !u.hasActed && !sleeping(u))
        .sort((a, b) => a.row - b.row || a.col - b.col)
        .map((u) => ({ col: u.col, row: u.row }));
    });
    expect(order.length).toBeGreaterThan(1); // need >1 to prove cycling

    // NEXT from an off-unit cursor snaps to the first un-acted unit.
    await tap(page, BTN.R1);
    expect(await getCursor(page)).toEqual(order[0]);

    // NEXT again advances to the second.
    await tap(page, BTN.R1);
    expect(await getCursor(page)).toEqual(order[1]);

    // PREV steps back to the first.
    await tap(page, BTN.L1);
    expect(await getCursor(page)).toEqual(order[0]);
  });

  test('INSPECT toggles the inspection panel at the cursor', async ({ page }) => {
    await setupBattle(page);
    const unit = await firstUnitPos(page);
    expect(unit).not.toBeNull();

    const panelVisible = () =>
      page.evaluate(() =>
        Boolean(window.__emblemRogueGame.scene.getScene('Battle')?.inspectionPanel?.visible),
      );

    await moveCursorTo(page, unit.col, unit.row);
    expect(await panelVisible()).toBe(false);

    await tap(page, BTN.INSPECT); // show
    await page.waitForFunction(
      () => Boolean(window.__emblemRogueGame.scene.getScene('Battle')?.inspectionPanel?.visible),
      null,
      { timeout: 6_000 },
    );

    await tap(page, BTN.INSPECT); // hide
    await page.waitForFunction(
      () => !window.__emblemRogueGame.scene.getScene('Battle')?.inspectionPanel?.visible,
      null,
      { timeout: 6_000 },
    );
  });

  test('Start opens the pause menu, which captures the pad (no leak to the grid)', async ({
    page,
  }) => {
    await setupBattle(page);
    const before = await getCursor(page);

    await tap(page, BTN.PAUSE);
    await page.waitForFunction(
      () => Boolean(window.__emblemRogueGame.scene.getScene('Battle')?.pauseOverlay?.visible),
      null,
      { timeout: 6_000 },
    );

    const focusIndex = () =>
      page.evaluate(
        () => window.__emblemRogueGame.scene.getScene('Battle')?.pauseOverlay?._focus?.index,
      );
    expect(await focusIndex()).toBe(0); // Resume focused

    // DOWN moves the pause ring, NOT the grid cursor behind it.
    await tap(page, BTN.DOWN);
    expect(await focusIndex()).toBe(1);
    expect(await getCursor(page)).toEqual(before); // grid cursor unchanged -> no leak

    // CANCEL (B) resumes: the overlay is nulled and we return to PLAYER_IDLE.
    await tap(page, BTN.CANCEL);
    await page.waitForFunction(
      () => !window.__emblemRogueGame.scene.getScene('Battle')?.pauseOverlay,
      null,
      { timeout: 6_000 },
    );
    expect(await getBattleState(page)).toBe('PLAYER_IDLE');
  });
});
