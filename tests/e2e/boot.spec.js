// E2E: Game boot and title screen smoke test.
// Verifies the game loads, SceneGuard is active, and the Title scene renders
// without errors.

import { test, expect } from '@playwright/test';
import {
  waitForGame,
  waitForScene,
  getSceneState,
  collectErrors,
  attachSceneCrashArtifacts,
} from './helpers.js';

test.afterEach(async ({ page }, testInfo) => {
  await attachSceneCrashArtifacts(page, testInfo);
});

test.describe('Boot & Title', () => {
  test('game boots to Title scene without errors', async ({ page }) => {
    const errors = collectErrors(page);

    await page.goto('/');
    await waitForGame(page);
    await waitForScene(page, 'Title');

    const state = await getSceneState(page);
    expect(state.activeScene).toBe('Title');
    expect(state.ready).toBe(true);
    expect(state.errors).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('SceneGuard tracks Boot -> Title transition', async ({ page }) => {
    await page.goto('/');
    await waitForGame(page);
    await waitForScene(page, 'Title');

    const state = await getSceneState(page);
    expect(state.history.length).toBeGreaterThanOrEqual(1);

    const titleTransition = state.history.find((h) => h.to === 'Title');
    expect(titleTransition).toBeDefined();
  });
});
