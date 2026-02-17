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

async function readStartupViewportGuardStats(page) {
  return page.evaluate(() => {
    const telemetry = window.__emblemRogueStartupTelemetry || null;
    const markers = Array.isArray(telemetry?.markers) ? telemetry.markers : [];
    const guardMarkers = markers.filter((m) => String(m?.name || '').startsWith('startup_viewport_guard_'));
    const stopMarkers = markers.filter((m) => m?.name === 'startup_viewport_guard_stop');
    const maxListenerAttachCount = stopMarkers.reduce(
      (max, marker) => Math.max(max, Number(marker?.data?.listenerAttachCount || 0)),
      0,
    );
    const maxScaleRefreshCount = stopMarkers.reduce(
      (max, marker) => Math.max(max, Number(marker?.data?.scaleRefreshCount || 0)),
      0,
    );
    const cloudModes = markers
      .filter((m) => m?.name === 'cloud_sync_gate_start')
      .map((m) => String(m?.data?.mode || ''))
      .filter(Boolean);
    return {
      enabled: telemetry?.meta?.startupViewportGuard === true,
      markerCount: guardMarkers.length,
      maxListenerAttachCount,
      maxScaleRefreshCount,
      cloudModes,
    };
  });
}

async function installMockSupabaseRoutes(page, username = 'desktop_guard') {
  const userId = '00000000-0000-4000-8000-000000000001';
  const nowSec = Math.floor(Date.now() / 1000);
  const tokenPayload = {
    sub: userId,
    exp: nowSec + 3600,
    role: 'authenticated',
    email: `${username.toLowerCase()}@emblem-rogue.local`,
  };
  const base64Url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const accessToken = `${base64Url({ alg: 'HS256', typ: 'JWT' })}.${base64Url(tokenPayload)}.sig`;
  const user = {
    id: userId,
    aud: 'authenticated',
    role: 'authenticated',
    email: `${username.toLowerCase()}@emblem-rogue.local`,
    user_metadata: {
      display_name: username,
    },
  };
  const tokenResponse = {
    access_token: accessToken,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: nowSec + 3600,
    refresh_token: 'mock-refresh-token',
    user,
  };

  await page.route('**/auth/v1/**', async (route, request) => {
    const url = new URL(request.url());
    if (url.pathname.endsWith('/auth/v1/token')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(tokenResponse),
      });
      return;
    }
    if (url.pathname.endsWith('/auth/v1/user')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(user),
      });
      return;
    }
    if (url.pathname.endsWith('/auth/v1/logout')) {
      await route.fulfill({ status: 204, body: '' });
      return;
    }
    await route.continue();
  });

  await page.route('**/rest/v1/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: 'null',
    });
  });
}

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

  test('desktop startup viewport guard remains inactive', async ({ page }) => {
    await page.goto('/');
    await waitForGame(page);
    await waitForScene(page, 'Title');

    const startupViewportGuard = await readStartupViewportGuardStats(page);

    expect(startupViewportGuard.enabled).toBe(false);
    expect(startupViewportGuard.markerCount).toBe(0);
    expect(startupViewportGuard.maxListenerAttachCount).toBe(0);
    expect(startupViewportGuard.maxScaleRefreshCount).toBe(0);
  });

  test('desktop login and auto-login paths keep viewport guard inactive', async ({ page }) => {
    const errors = collectErrors(page);
    const username = 'desktop_guard';
    const password = 'irrelevant_password';

    await installMockSupabaseRoutes(page, username);
    await page.goto('/');

    const authVisible = await page.locator('#auth-submit').isVisible();
    test.skip(!authVisible, 'Supabase auth overlay is unavailable in this runtime.');

    await page.fill('#auth-username', username);
    await page.fill('#auth-password', password);
    await page.click('#auth-submit');

    await page.waitForFunction(
      () => window.__sceneState?.ready === true,
      null,
      { timeout: 20_000 },
    );
    await waitForScene(page, 'Title');

    const loginPathGuard = await readStartupViewportGuardStats(page);
    expect(loginPathGuard.enabled).toBe(false);
    expect(loginPathGuard.markerCount).toBe(0);
    expect(loginPathGuard.maxListenerAttachCount).toBe(0);
    expect(loginPathGuard.maxScaleRefreshCount).toBe(0);
    expect(loginPathGuard.cloudModes).toContain('login');

    await page.reload();
    await page.waitForFunction(
      () => window.__sceneState?.ready === true,
      null,
      { timeout: 20_000 },
    );
    await waitForScene(page, 'Title');

    const autoLoginPathGuard = await readStartupViewportGuardStats(page);
    expect(autoLoginPathGuard.enabled).toBe(false);
    expect(autoLoginPathGuard.markerCount).toBe(0);
    expect(autoLoginPathGuard.maxListenerAttachCount).toBe(0);
    expect(autoLoginPathGuard.maxScaleRefreshCount).toBe(0);
    expect(autoLoginPathGuard.cloudModes).toContain('session');
    expect(errors).toEqual([]);
  });
});
