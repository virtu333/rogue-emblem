// E2E: Scene transition smoke tests using devScene URL params.
// Each test navigates directly to a scene via ?devScene=&preset= and verifies
// the scene loads without errors.

import { test, expect } from '@playwright/test';
import { waitForGame, waitForScene, getSceneState, collectErrors } from './helpers.js';

test.describe('Scene transitions via devScene', () => {
  test('HomeBase loads via devScene', async ({ page }) => {
    const errors = collectErrors(page);

    await page.goto('/?devScene=homebase&preset=weapon_arts');
    await waitForGame(page);
    await waitForScene(page, 'HomeBase');

    const state = await getSceneState(page);
    expect(state.activeScene).toBe('HomeBase');
    expect(state.ready).toBe(true);
    expect(errors).toEqual([]);
  });

  test('NodeMap loads via devScene', async ({ page }) => {
    const errors = collectErrors(page);

    await page.goto('/?devScene=nodemap&preset=weapon_arts');
    await waitForGame(page);
    await waitForScene(page, 'NodeMap');

    const state = await getSceneState(page);
    expect(state.activeScene).toBe('NodeMap');
    expect(state.ready).toBe(true);
    expect(errors).toEqual([]);
  });

  test('Battle loads via devScene', async ({ page }) => {
    const errors = collectErrors(page);

    await page.goto('/?devScene=battle&preset=battle_smoke');
    await waitForGame(page);
    await waitForScene(page, 'Battle');

    const state = await getSceneState(page);
    expect(state.activeScene).toBe('Battle');
    expect(state.ready).toBe(true);
    expect(errors).toEqual([]);
  });
});
