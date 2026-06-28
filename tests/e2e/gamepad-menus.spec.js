// E2E: gamepad-driven out-of-battle menu navigation (Phase 2 slice 2A).
//
// Proves the device-independent action bus reaches a NON-battle scene through the
// LIFO input-focus stack and drives the SAME _navigate/_confirm/_back the keyboard
// uses: DifficultySelect (horizontal cards) -> CONFIRM -> BlessingSelect (vertical
// list) -> CANCEL -> back to DifficultySelect.

import { test, expect } from '@playwright/test';
import { waitForGame, waitForScene, attachSceneCrashArtifacts } from './helpers.js';

const BTN = { CONFIRM: 0, CANCEL: 1, L1: 4, R1: 5, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };

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

// Hold long enough for the global reader (which polls on the game step) to
// edge-detect the press even when a heavy menu redraw is sharing the frame budget.
async function tap(page, index) {
  await setButton(page, index, true);
  await page.waitForTimeout(100);
  await setButton(page, index, false);
  await page.waitForTimeout(80);
}

const sceneSelectedIndex = (page, key) =>
  page.evaluate((k) => window.__emblemRogueGame?.scene?.getScene?.(k)?.selectedIndex, key);

test.afterEach(async ({ page }, testInfo) => {
  await attachSceneCrashArtifacts(page, testInfo);
});

test.describe('Gamepad menu navigation', () => {
  test('DifficultySelect <-> BlessingSelect via pad NAVIGATE/CONFIRM/CANCEL', async ({ page }) => {
    await page.goto('/?devScene=difficulty&gamepadSim=1');
    await waitForGame(page);
    await waitForScene(page, 'DifficultySelect');
    await installSimPad(page);

    // Cards are a horizontal row: RIGHT advances selection, LEFT retreats.
    expect(await sceneSelectedIndex(page, 'DifficultySelect')).toBe(0);
    await tap(page, BTN.RIGHT);
    expect(await sceneSelectedIndex(page, 'DifficultySelect')).toBe(1);
    await tap(page, BTN.LEFT);
    expect(await sceneSelectedIndex(page, 'DifficultySelect')).toBe(0); // back on Normal (unlocked)

    // CONFIRM on Normal -> BlessingSelect.
    await tap(page, BTN.CONFIRM);
    await waitForScene(page, 'BlessingSelect');

    // Blessings are a vertical list: DOWN advances selection.
    expect(await sceneSelectedIndex(page, 'BlessingSelect')).toBe(0);
    await tap(page, BTN.DOWN);
    expect(await sceneSelectedIndex(page, 'BlessingSelect')).toBe(1);

    // CANCEL (B) -> _back() returns to DifficultySelect (proves cancel routing).
    await tap(page, BTN.CANCEL);
    await waitForScene(page, 'DifficultySelect');
  });

  test('Title menu focus moves with the pad and CONFIRM activates a button', async ({ page }) => {
    await page.goto('/?devScene=title&gamepadSim=1');
    await waitForGame(page);
    await waitForScene(page, 'Title');
    await installSimPad(page);

    const focus = () =>
      page.evaluate(() => {
        const t = window.__emblemRogueGame.scene.getScene('Title');
        return { index: t?._menuFocus?.index, len: t?._menuFocus?.items?.length };
      });

    const start = await focus();
    expect(start.len).toBeGreaterThan(0);
    expect(start.index).toBe(0); // NEW GAME focused by default

    await tap(page, BTN.DOWN);
    expect((await focus()).index).toBe(1);
    await tap(page, BTN.UP);
    expect((await focus()).index).toBe(0);

    // MORE INFO is always second-to-last in the main column (COMPENDIUM is last);
    // confirming it opens the Help overlay — a contained way to prove CONFIRM acts.
    const moreInfoIndex = start.len - 2;
    for (let i = 0; i < moreInfoIndex; i++) await tap(page, BTN.DOWN);
    expect((await focus()).index).toBe(moreInfoIndex);
    await tap(page, BTN.CONFIRM);
    await page.waitForFunction(
      () => Boolean(window.__emblemRogueGame.scene.getScene('Title')?.helpOverlay),
      null,
      { timeout: 8_000 },
    );
  });

  test('NodeMap cursor navigates available nodes and CONFIRM selects via onNodeClick', async ({
    page,
  }) => {
    await page.goto('/?devScene=nodemap&preset=fresh&gamepadSim=1');
    await waitForGame(page);
    await waitForScene(page, 'NodeMap');
    // The cursor is built synchronously in create()/drawMap(); wait for it. (The
    // isSceneReady flag is gated behind an awaited act-intro dialogue that needs
    // clicks to advance — its gating is covered by unit tests, so we neutralize it
    // below rather than drive the dialogue here.)
    await page.waitForFunction(
      () =>
        (window.__emblemRogueGame.scene.getScene('NodeMap')?._nodeCursor?.nodes?.length || 0) > 0,
      null,
      { timeout: 12_000 },
    );
    await installSimPad(page);

    // Spy on onNodeClick so CONFIRM records the node WITHOUT launching a battle /
    // overlay; dismiss the intro dialogue and open the input gate so the bus reaches
    // the cursor.
    await page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('NodeMap');
      window.__nodeClicks = [];
      s.onNodeClick = (node) => window.__nodeClicks.push(node?.id);
      if (s.dialogueOverlay?.hide) s.dialogueOverlay.hide();
      s._storyDialogueActive = false;
      s.isSceneReady = true;
    });

    const cur = () =>
      page.evaluate(() => {
        const s = window.__emblemRogueGame.scene.getScene('NodeMap');
        return { id: s._nodeCursor?.current()?.id, count: s._nodeCursor?.nodes?.length || 0 };
      });

    const before = await cur();
    expect(before.count).toBeGreaterThan(0);

    // If there's more than one choice, the cursor must move between them.
    if (before.count > 1) {
      await tap(page, BTN.RIGHT);
      expect((await cur()).id).not.toBe(before.id);
    }

    const focusedId = (await cur()).id;
    await tap(page, BTN.CONFIRM);
    await page.waitForFunction(() => (window.__nodeClicks || []).length > 0, null, {
      timeout: 8_000,
    });
    expect(await page.evaluate(() => window.__nodeClicks)).toContain(focusedId);
  });

  test('HomeBase: pad navigates buttons, CONFIRM switches tab, L1/R1 cycle tabs', async ({
    page,
  }) => {
    await page.goto('/?devScene=homebase&gamepadSim=1');
    await waitForGame(page);
    await waitForScene(page, 'HomeBase');
    await page.waitForFunction(
      () =>
        (window.__emblemRogueGame.scene.getScene('HomeBase')?._homeFocus?.objects?.length || 0) > 0,
      null,
      { timeout: 12_000 },
    );
    await installSimPad(page);

    const home = () =>
      page.evaluate(() => {
        const s = window.__emblemRogueGame.scene.getScene('HomeBase');
        return { index: s._homeFocus?.index, tab: s.activeTab };
      });

    // Tabs are the first focusables (top row); index 0 = Recruits, 1 = Lords.
    expect((await home()).index).toBe(0);
    await tap(page, BTN.DOWN);
    expect((await home()).index).toBe(1);

    // CONFIRM on the Lords tab switches the active tab (proves activate->pointerdown).
    await tap(page, BTN.CONFIRM);
    await page.waitForFunction(
      () => window.__emblemRogueGame.scene.getScene('HomeBase')?.activeTab === 'lord_bonuses',
      null,
      { timeout: 6_000 },
    );

    // R1/L1 cycle tabs directly.
    await tap(page, BTN.R1);
    expect((await home()).tab).toBe('economy');
    await tap(page, BTN.L1);
    expect((await home()).tab).toBe('lord_bonuses');
  });
});
