// E2E: Battle scene invariant tests.
// Verifies battle state tracking, overlay visibility, pause flow,
// and SceneGuard invariant checks.

import { test, expect } from '@playwright/test';
import {
  waitForGame,
  waitForScene,
  getSceneState,
  getOverlays,
  assertNoInvariantErrors,
  collectErrors,
} from './helpers.js';

// States from which ESC opens the pause menu
const PAUSE_OPENABLE = ['PLAYER_IDLE', 'DEPLOY_SELECTION'];

/**
 * Advance past DEPLOY_SELECTION to PLAYER_IDLE using scene-level API.
 * Calls the deploy confirm callback directly rather than hunting for
 * geometry-based UI objects.
 */
async function advancePastDeploy(page) {
  await page.evaluate(() => {
    const game = window.__emblemRogueGame;
    const battle = game?.scene?.getScene?.('Battle');
    if (!battle || battle.battleState !== 'DEPLOY_SELECTION') return;

    // The deploy screen stores its objects in the scene children list.
    // Find the confirm callback by locating the confirm button (Rectangle
    // with pointerdown listeners near the bottom of the deploy overlay).
    // This is more robust than geometry matching — we look for the actual
    // interactive rectangle that has a pointerdown listener bound.
    const objects = battle.children?.list || [];
    const interactiveRects = objects.filter(
      (obj) =>
        obj?.type === 'Rectangle' &&
        obj.input?.enabled === true &&
        obj.listenerCount?.('pointerdown') > 0,
    );

    // The confirm button is the last interactive rectangle added
    // (deploy rows are added first, confirm button last)
    const confirmBtn = interactiveRects[interactiveRects.length - 1];
    if (confirmBtn) {
      confirmBtn.emit('pointerdown');
    }
  });
}

/**
 * Wait for battle to reach PLAYER_IDLE, advancing through DEPLOY_SELECTION
 * if needed.
 */
async function ensurePlayerIdle(page) {
  await page.waitForFunction(
    (allowed) => allowed.includes(window.__sceneState?.battle?.state),
    PAUSE_OPENABLE,
    { timeout: 15_000 },
  );

  const state = await page.evaluate(() => window.__sceneState?.battle?.state);
  if (state === 'DEPLOY_SELECTION') {
    await advancePastDeploy(page);
    await page.waitForFunction(
      () => window.__sceneState?.battle?.state === 'PLAYER_IDLE',
      null,
      { timeout: 12_000 },
    );
  }
}

/**
 * Clear any transient UI blockers (inspection panel, detail overlay, etc.)
 * so ESC will reach the pause menu rather than dismiss a sub-overlay.
 */
async function clearUIBlockers(page) {
  await page.evaluate(() => {
    const game = window.__emblemRogueGame;
    const battle = game?.scene?.getScene?.('Battle');
    if (!battle) return;
    if (battle.inspectionPanel?.visible) battle.clearInspectionVisuals();
    if (battle.unitDetailOverlay?.visible) battle.unitDetailOverlay.hide();
    if (battle.debugOverlay?.visible) battle.debugOverlay.hide();
  });
  // Give one frame for cleanup
  await page.waitForTimeout(50);
}

/**
 * Dispatch ESC through Phaser's keyboard input system.
 * This validates the real input → requestCancel → state machine wiring.
 */
async function pressEscape(page) {
  await page.evaluate(() => {
    const game = window.__emblemRogueGame;
    const battle = game?.scene?.getScene?.('Battle');
    if (!battle?.input?.keyboard) return;
    battle.input.keyboard.emit('keydown-ESC', { key: 'Escape' });
  });
}

test.describe('Battle invariants', () => {
  test('Battle loads to DEPLOY_SELECTION or PLAYER_IDLE with state tracking', async ({ page }) => {
    const errors = collectErrors(page);

    await page.goto('/?devScene=battle&preset=battle_smoke');
    await waitForGame(page);
    await waitForScene(page, 'Battle');

    const state = await getSceneState(page);
    expect(state.activeScene).toBe('Battle');
    expect(state.battle).toBeDefined();
    expect(state.battle.state).toBeTruthy();
    expect(PAUSE_OPENABLE).toContain(state.battle.state);
    expect(state.battle.stateChangedAt).toBeGreaterThan(0);

    await assertNoInvariantErrors(page);
    expect(errors).toEqual([]);
  });

  test('ESC opens pause menu and ESC again resumes', async ({ page }) => {
    await page.goto('/?devScene=battle&preset=battle_smoke');
    await waitForGame(page);
    await waitForScene(page, 'Battle');

    // 1. Wait for deploy-ready, advance to PLAYER_IDLE
    await ensurePlayerIdle(page);

    // 2. Clear any transient UI blockers
    await clearUIBlockers(page);

    // 3. Dispatch ESC through Phaser input — should open pause
    await pressEscape(page);

    await page.waitForFunction(
      () => window.__sceneState?.battle?.state === 'PAUSED',
      null,
      { timeout: 5_000 },
    );
    await page.waitForFunction(
      () => window.__sceneState?.overlays?.pauseOverlay === true,
      null,
      { timeout: 3_000 },
    );
    const overlaysOpen = await getOverlays(page);
    expect(overlaysOpen.pauseOverlay).toBe(true);

    // 4. Dispatch ESC again — should close pause (Resume)
    await pressEscape(page);

    await page.waitForFunction(
      () => window.__sceneState?.battle?.state !== 'PAUSED',
      null,
      { timeout: 5_000 },
    );
    await page.waitForFunction(
      () => window.__sceneState?.overlays?.pauseOverlay === false,
      null,
      { timeout: 3_000 },
    );
    const afterClose = await getOverlays(page);
    expect(afterClose.pauseOverlay).toBe(false);

    await assertNoInvariantErrors(page);
  });

  test('showPauseMenu API sets state and overlay (smoke)', async ({ page }) => {
    await page.goto('/?devScene=battle&preset=battle_smoke');
    await waitForGame(page);
    await waitForScene(page, 'Battle');

    await ensurePlayerIdle(page);

    // Call showPauseMenu directly — validates SceneGuard proxy integration
    await page.evaluate(() => {
      const game = window.__emblemRogueGame;
      const battle = game?.scene?.getScene?.('Battle');
      if (battle && battle.battleState === 'PLAYER_IDLE') {
        battle.showPauseMenu();
      }
    });

    await page.waitForFunction(
      () => window.__sceneState?.battle?.state === 'PAUSED',
      null,
      { timeout: 5_000 },
    );
    await page.waitForFunction(
      () => window.__sceneState?.overlays?.pauseOverlay === true,
      null,
      { timeout: 3_000 },
    );
    const overlays = await getOverlays(page);
    expect(overlays.pauseOverlay).toBe(true);

    await assertNoInvariantErrors(page);
  });

  test('Overlay snapshot populated after battle load', async ({ page }) => {
    await page.goto('/?devScene=battle&preset=battle_smoke');
    await waitForGame(page);
    await waitForScene(page, 'Battle');

    // Give a moment for periodic snapshot
    await page.waitForTimeout(200);

    const overlays = await getOverlays(page);
    expect(overlays).toBeDefined();
    expect(typeof overlays).toBe('object');
    // inspectionPanel should be tracked (persistent object)
    expect('inspectionPanel' in overlays).toBe(true);
    // Nothing should be open at battle start
    expect(overlays.pauseOverlay).toBe(false);
    expect(overlays.lootGroup).toBe(false);
  });

  test('No invariant errors after battle load', async ({ page }) => {
    await page.goto('/?devScene=battle&preset=battle_smoke');
    await waitForGame(page);
    await waitForScene(page, 'Battle');

    // Let periodic checks run
    await page.waitForTimeout(1000);

    await assertNoInvariantErrors(page);
  });
});

test.describe('NodeMap invariants', () => {
  test('NodeMap starts in IDLE state', async ({ page }) => {
    await page.goto('/?devScene=nodemap&preset=weapon_arts');
    await waitForGame(page);
    await waitForScene(page, 'NodeMap');

    await page.waitForTimeout(300);

    const state = await getSceneState(page);
    expect(state.nodeMap).toBeDefined();
    expect(state.nodeMap.state).toBe('IDLE');

    await assertNoInvariantErrors(page);
  });

  test('NodeMap overlay snapshot is clean on load', async ({ page }) => {
    await page.goto('/?devScene=nodemap&preset=weapon_arts');
    await waitForGame(page);
    await waitForScene(page, 'NodeMap');

    await page.waitForTimeout(300);

    const overlays = await getOverlays(page);
    expect(overlays).toBeDefined();
    for (const [key, val] of Object.entries(overlays)) {
      expect(val, `overlay ${key} should be closed`).toBe(false);
    }
  });

  test('NodeMap state reflects unitPickerState-driven override', async ({ page }) => {
    await page.goto('/?devScene=nodemap&preset=weapon_arts');
    await waitForGame(page);
    await waitForScene(page, 'NodeMap');

    await page.evaluate(() => {
      const game = window.__emblemRogueGame;
      const nodeMap = game?.scene?.getScene?.('NodeMap');
      if (!nodeMap) return;
      nodeMap.unitPicker = null;
      nodeMap.unitPickerState = { value: true };
    });

    await page.waitForFunction(
      () => window.__sceneState?.nodeMap?.state === 'UNIT_PICKER',
      null,
      { timeout: 5_000 },
    );

    await page.evaluate(() => {
      const game = window.__emblemRogueGame;
      const nodeMap = game?.scene?.getScene?.('NodeMap');
      if (!nodeMap) return;
      nodeMap.unitPickerState = null;
    });

    await page.waitForFunction(
      () => window.__sceneState?.nodeMap?.state === 'IDLE',
      null,
      { timeout: 5_000 },
    );
  });
});
