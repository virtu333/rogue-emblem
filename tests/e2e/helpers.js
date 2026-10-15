// Shared helpers for Playwright E2E tests.
// All tests rely on SceneGuard exposing window.__sceneState.
import { expect } from '@playwright/test';

/**
 * Skip the auth gate if it's shown (click "Play offline").
 * The gate shows only on a cloud build; a local build (CI's, with no Supabase
 * configured) boots straight past it. Wait for whichever comes first, the gate or the
 * game, so a local build never sits out a timeout waiting for a gate that never shows.
 */
export async function skipAuth(page) {
  const gate = await page
    .waitForFunction(
      () => {
        if (window.__sceneState?.ready === true) return 'game';
        const skip = document.getElementById('auth-skip');
        return skip && skip.getClientRects().length > 0 ? 'gate' : false;
      },
      null,
      { timeout: 20_000 },
    )
    .then((handle) => handle.jsonValue())
    .catch(() => null);
  if (gate === 'gate') await page.locator('#auth-skip').click();
}

/**
 * Wait for the Phaser game to boot and SceneGuard to be installed.
 * Automatically skips the auth gate if present.
 * Review point #6: tolerates missing injection window with bounded retry.
 */
export async function waitForGame(page) {
  await skipAuth(page);
  await page.waitForFunction(() => window.__sceneState?.ready === true, null, { timeout: 20_000 });
}

/**
 * Wait for a specific scene to become the active scene.
 */
export async function waitForScene(page, sceneKey) {
  await page.waitForFunction((key) => window.__sceneState?.activeScene === key, sceneKey, {
    timeout: 15_000,
  });
}

/**
 * Wait until the route map is ready for input, skipping the run's opening lines if they
 * play. `waitForScene` returns as soon as the scene is active, while the run-start lines
 * open a moment later (after the audio unlock): a sheet opened in that gap ends up
 * under the lines' dialogue, which then takes every press. Waits on state.
 */
export async function waitForRouteMapReady(page) {
  const skip = page.getByRole('button', { name: 'Skip conversation', exact: true });
  const mapReady = () =>
    page.waitForFunction(
      () => window.__emblemRogueGame.scene.getScene('NodeMap')?.isSceneReady === true,
    );
  await Promise.race([skip.waitFor({ state: 'visible' }), mapReady()]);
  if (await skip.isVisible().catch(() => false)) await skip.click();
  await mapReady();
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

/**
 * Assert the latest transition audit is inside SceneGuard's leak budgets.
 * Optionally filter to transitions ending at a specific scene key.
 */
export async function assertLatestTransitionWithinBudget(page, toScene = null) {
  const audit = await page.evaluate((targetScene) => {
    const audits = window.__sceneState?.transitionAudits || [];
    if (!targetScene) return audits[audits.length - 1] || null;
    for (let i = audits.length - 1; i >= 0; i--) {
      if (audits[i]?.to === targetScene) return audits[i];
    }
    return null;
  }, toScene);

  if (!audit) {
    throw new Error(`No transition audit found${toScene ? ` for to=${toScene}` : ''}.`);
  }

  const breaches = Array.isArray(audit.breaches) ? audit.breaches : [];
  if (breaches.length > 0) {
    throw new Error(
      `Transition leak budget exceeded${toScene ? ` for to=${toScene}` : ''}: ` +
        `${breaches.join(', ')}\n` +
        `${JSON.stringify(audit, null, 2)}`,
    );
  }
}

/**
 * Assert the latest shutdown cleanup audit is inside SceneGuard budgets.
 */
export async function assertLatestCleanupWithinBudget(page, sceneKey = null) {
  const audit = await page.evaluate((targetScene) => {
    const audits = window.__sceneState?.cleanupAudits || [];
    if (!targetScene) return audits[audits.length - 1] || null;
    for (let i = audits.length - 1; i >= 0; i--) {
      if (audits[i]?.scene === targetScene) return audits[i];
    }
    return null;
  }, sceneKey);

  if (!audit) {
    throw new Error(`No cleanup audit found${sceneKey ? ` for scene=${sceneKey}` : ''}.`);
  }

  const breaches = Array.isArray(audit.breaches) ? audit.breaches : [];
  if (breaches.length > 0) {
    throw new Error(
      `Shutdown cleanup budget exceeded${sceneKey ? ` for scene=${sceneKey}` : ''}: ` +
        `${breaches.join(', ')}\n` +
        `${JSON.stringify(audit, null, 2)}`,
    );
  }
}

/**
 * Attach SceneGuard crash bundle data when a Playwright test fails.
 * Includes scene state, transition/cleanup audits, and crash trace ring buffer.
 */
export async function attachSceneCrashArtifacts(page, testInfo) {
  if (testInfo.status === testInfo.expectedStatus) return;

  let payload;
  try {
    payload = await page.evaluate(() => ({
      url: window.location.href,
      sceneState: window.__sceneState || null,
      sceneTrace: window.__sceneTrace || null,
      sceneTraceTail: window.__sceneTraceTail || null,
      capturedAt: Date.now(),
    }));
  } catch (err) {
    payload = {
      captureError: err?.message || String(err),
      capturedAt: Date.now(),
    };
  }

  await testInfo.attach('scene-crash-bundle.json', {
    body: Buffer.from(JSON.stringify(payload, null, 2)),
    contentType: 'application/json',
  });
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

/**
 * Install one connected, standard-mapped fake gamepad. The global GamepadReader
 * reads it only when the page URL carries `?gamepadSim`.
 */
export async function installSimPad(page) {
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

/**
 * One discrete press of sim-pad button `index`, held for exactly one GamepadReader
 * poll. The reader polls on the game's 'step' event, so the press is set between
 * frames, released on that frame's 'poststep', and the call resolves after the next
 * frame's poll has seen the release. A press can therefore never be missed (both
 * edges between two polls) nor read as a held direction (auto-repeat after 250 ms),
 * however slowly the page runs. Timed holds (press, sleep, release) raced both.
 */
export async function padTap(page, index) {
  await page.evaluate(
    (i) =>
      new Promise((resolve, reject) => {
        const game = window.__emblemRogueGame;
        const pad = window.__gamepadSim?.pads?.[0];
        if (!game?.events || !pad) {
          reject(new Error('padTap: no game or sim pad (installSimPad, ?gamepadSim)'));
          return;
        }
        pad.buttons[i] = { pressed: true, value: 1 };
        game.events.once('poststep', () => {
          pad.buttons[i] = { pressed: false, value: 0 };
          game.events.once('poststep', () => resolve());
        });
      }),
    index,
  );
}

/**
 * A real run that fields 3+ units opens Formation before turn 1 (dev routes skip it
 * unless formation=1). Take the default placement and start, so a spec about
 * something else reaches turn 1; no-op when the battle starts without it.
 */
export async function finishFormation(page) {
  await page.waitForFunction(
    () => {
      const s = window.__emblemRogueGame?.scene?.getScene('Battle');
      return (
        s?.battleState === 'PLAYER_IDLE' ||
        (s?.battleState === 'DEPLOY_POSITIONING' && s._formation?.ready === true)
      );
    },
    null,
    { timeout: 20_000 },
  );
  await page.evaluate(() => {
    const f = window.__emblemRogueGame.scene.getScene('Battle')._formation;
    if (!f?.ready) return;
    f.autoPlace();
    if (!f.start()) throw new Error('Formation could not start after Auto-place');
  });
}

/**
 * An arena bout after Fight: press Next round in each round's dialog until the bout
 * ends, then return the result dialog. Waits on each round's own dialog, never on
 * time, so a stale Next round is never pressed twice.
 */
export async function fightArenaBout(page) {
  const log = page.getByRole('dialog', { name: 'Arena · Combat result', exact: true });
  for (let n = 1; ; n++) {
    const round = page.getByRole('dialog', { name: `Arena · Round ${n}`, exact: true });
    await expect(log.or(round)).toBeVisible();
    if (await log.isVisible()) return log;
    await round.getByRole('button', { name: 'Next round', exact: true }).tap();
  }
}

/**
 * The Roster sheet opens on an overview (a grid of unit cards, `nav.mr-grid`) and a
 * card opens that unit's detail (tabs, the unit strip, the summary). Open one unit's
 * detail from the grid: the named unit's card (name or RegExp, matched on the card's
 * label), else the first. A sheet already showing a detail is left as it is when no
 * name is asked for, and switched to the named unit through the strip otherwise.
 * `tap` drives touch contexts (tap) and the rest click. Waits on state.
 * @param {import('@playwright/test').Locator} sheet the `dialog` (Manage roster / Inspect roster)
 */
export async function openRosterUnit(sheet, name = null, { tap = false } = {}) {
  const act = (locator) => (tap ? locator.tap() : locator.click());
  const grid = sheet.locator('nav.mr-grid');
  const strip = sheet.locator('.mr-units');
  await expect(grid.or(strip).first()).toBeVisible();
  if (await grid.isVisible()) {
    const cards = grid.locator('button.mr-ov-card');
    const label = typeof name === 'string' ? new RegExp(`^${escapeRegExp(name)}\\b`) : name;
    await act(label ? grid.getByRole('button', { name: label }).first() : cards.first());
    await expect(strip).toBeVisible();
    return;
  }
  if (name) {
    const label = typeof name === 'string' ? new RegExp(`^${escapeRegExp(name)}\\b`) : name;
    await act(strip.getByRole('button', { name: label }).first());
  }
}

/**
 * Leave a Roster sheet that has an overview: from a unit's detail "Back" returns to
 * the grid (when the detail is showing), then the header's close button (`Close`, or
 * the caller's label such as "Back to formation") closes it.
 */
export async function closeRoster(sheet, label = 'Close', { tap = false } = {}) {
  const act = (locator) => (tap ? locator.tap() : locator.click());
  const back = sheet.locator('button.mr-back');
  if (await back.isVisible()) {
    await act(back);
    await expect(sheet.locator('nav.mr-grid')).toBeVisible();
  }
  await act(sheet.getByRole('button', { name: label, exact: true }));
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Brings a route node one step ahead: the party stands on a node just before it (marked walked),
 * and the route map redraws. A recruit card names who waits there only once it is a next step
 * (`loomModel.recruitShownAt`, docs/specs/lord-recruit-odds.md), so a spec that reads one moves
 * the party beside it first. Returns false if no such node exists.
 */
export async function stepBeside(page, nodeId) {
  return page.evaluate((id) => {
    const scene = window.__emblemRogueGame.scene.getScene('NodeMap');
    const rm = scene.runManager;
    const nodes = rm.nodeMap.nodes;
    if (rm.getAvailableNodes().some((n) => n.id === id)) return true;
    if (rm.nodeMap.startNodeId === id) {
      rm.currentNodeId = null;
    } else {
      const parent = nodes.find((n) => (n.edges || []).includes(id));
      if (!parent) return false;
      parent.completed = true;
      rm.currentNodeId = parent.id;
    }
    scene.nodeView.render();
    return rm.getAvailableNodes().some((n) => n.id === id);
  }, nodeId);
}
