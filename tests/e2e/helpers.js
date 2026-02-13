// Shared helpers for Playwright E2E tests.
// All tests rely on SceneGuard exposing window.__sceneState.

/**
 * Skip the auth gate if it's visible (click "Play offline").
 * No-op if auth overlay is already hidden (no Supabase configured).
 */
export async function skipAuth(page) {
  const skip = page.locator('#auth-skip');
  try {
    await skip.waitFor({ state: 'visible', timeout: 5_000 });
    await skip.click();
  } catch (_) {
    // Auth overlay not present or already dismissed — continue
  }
}

/**
 * Wait for the Phaser game to boot and SceneGuard to be installed.
 * Automatically skips the auth gate if present.
 * Review point #6: tolerates missing injection window with bounded retry.
 */
export async function waitForGame(page) {
  await skipAuth(page);
  await page.waitForFunction(
    () => window.__sceneState?.ready === true,
    null,
    { timeout: 20_000 },
  );
}

/**
 * Wait for a specific scene to become the active scene.
 */
export async function waitForScene(page, sceneKey) {
  await page.waitForFunction(
    (key) => window.__sceneState?.activeScene === key,
    sceneKey,
    { timeout: 15_000 },
  );
}

/**
 * Get current SceneGuard state snapshot.
 */
export async function getSceneState(page) {
  return page.evaluate(() => window.__sceneState);
}

/**
 * Wait for a specific battle state.
 * Tolerates missing __sceneState during early boot (review point #6).
 */
export async function waitForBattleState(page, battleState, timeout = 10_000) {
  await page.waitForFunction(
    (expected) => window.__sceneState?.battle?.state === expected,
    battleState,
    { timeout },
  );
}

/**
 * Wait for a specific NodeMap composite state.
 */
export async function waitForNodeMapState(page, nodeMapState, timeout = 10_000) {
  await page.waitForFunction(
    (expected) => window.__sceneState?.nodeMap?.state === expected,
    nodeMapState,
    { timeout },
  );
}

/**
 * Get current overlay visibility snapshot.
 */
export async function getOverlays(page) {
  return page.evaluate(() => window.__sceneState?.overlays || {});
}

/**
 * Assert no SceneGuard invariant errors have been recorded.
 * Throws with the full error list if any exist.
 */
export async function assertNoInvariantErrors(page) {
  const errors = await page.evaluate(() => window.__sceneState?.errors || []);
  if (errors.length > 0) {
    throw new Error(`SceneGuard invariant errors:\n${errors.join('\n')}`);
  }
}

// Error patterns expected from Phaser / browser internals — not real bugs.
const IGNORE_PATTERNS = [
  /Unable to decode audio data/i,
  /The AudioContext was not allowed to start/i,
  /Autoplaying audio/i,
  /ERR_CONNECTION_REFUSED/i,
  /supabase/i,
  /net::ERR/i,
  /Failed to load resource/i,
];

/**
 * Collect page errors and console.error messages during a test.
 * Returns an array reference that accumulates over time.
 * Ignores known benign browser/Phaser warnings.
 */
export function collectErrors(page) {
  const errors = [];

  page.on('pageerror', (err) => {
    const msg = err.message || String(err);
    if (IGNORE_PATTERNS.some((re) => re.test(msg))) return;
    errors.push(msg);
  });

  page.on('console', (consoleMsg) => {
    if (consoleMsg.type() !== 'error') return;
    const text = consoleMsg.text();
    if (IGNORE_PATTERNS.some((re) => re.test(text))) return;
    errors.push(text);
  });

  return errors;
}
