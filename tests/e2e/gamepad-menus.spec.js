// E2E: gamepad-driven out-of-battle menu navigation (Phase 2 slice 2A).
//
// Proves the real simulated gamepad reader drives the shipping DOM menus and
// scene transitions through the LIFO input-focus stack.

import { test, expect } from '@playwright/test';
import { waitForGame, waitForScene, attachSceneCrashArtifacts } from './helpers.js';

const BTN = {
  CONFIRM: 0,
  CANCEL: 1,
  ROSTER: 3,
  L1: 4,
  R1: 5,
  UP: 12,
  DOWN: 13,
  LEFT: 14,
  RIGHT: 15,
};

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

async function focusWithPad(page, control) {
  for (let i = 0; i < 90; i++) {
    if (await control.evaluate((el) => el === document.activeElement)) return;
    await tap(page, BTN.DOWN);
  }
  throw new Error('Controller could not reach requested DOM control');
}
async function readyRoute(page) {
  // Drive the real intro dialogue; force-hiding one line races its awaited next line.
  for (let i = 0; i < 30; i++) {
    if (await page.locator('.re-node-map').isVisible()) return;
    await tap(page, BTN.CONFIRM);
  }
  await expect(page.locator('.re-node-map')).toBeVisible();
}

test.afterEach(async ({ page }, testInfo) => {
  await attachSceneCrashArtifacts(page, testInfo);
});

test.describe('Gamepad menu navigation', () => {
  test('DifficultySelect <-> BlessingSelect via pad NAVIGATE/CONFIRM/CANCEL', async ({ page }) => {
    await page.goto('/?devScene=difficulty&gamepadSim=1');
    await waitForGame(page);
    await waitForScene(page, 'DifficultySelect');
    await installSimPad(page);

    const difficulty = page.getByRole('dialog', { name: 'Choose difficulty' });
    const first = difficulty.locator('[data-focus="choice-0"]');
    const second = difficulty.locator('[data-focus="choice-1"]');
    await expect(first).toHaveAttribute('aria-pressed', 'true');
    await focusWithPad(page, second);
    await tap(page, BTN.CONFIRM);
    await expect(second).toHaveAttribute('aria-pressed', 'true');
    await focusWithPad(page, first);
    await tap(page, BTN.CONFIRM);
    await expect(first).toHaveAttribute('aria-pressed', 'true');
    await focusWithPad(page, difficulty.getByRole('button', { name: 'Confirm', exact: true }));
    await tap(page, BTN.CONFIRM);
    await waitForScene(page, 'BlessingSelect');
    const blessing = page.getByRole('dialog', { name: 'Choose a blessing' });
    await focusWithPad(page, blessing.locator('[data-focus="choice-1"]'));
    await tap(page, BTN.CONFIRM);
    await expect(blessing.locator('[data-focus="choice-1"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await tap(page, BTN.CANCEL);
    await waitForScene(page, 'DifficultySelect');
    await expect(difficulty).toBeVisible();
  });

  test('Title menu focus moves with the pad and CONFIRM activates a button', async ({ page }) => {
    await page.goto('/?devScene=title&gamepadSim=1');
    await waitForGame(page);
    await waitForScene(page, 'Title');
    // The key art plate builds once, just after the title's first paint. The sim pad's
    // release is a page task queued behind that build, so a tap during it reads as a
    // held direction (DAS repeat); a real pad is read live on the next step.
    await expect(page.locator('.re-title-art.re-keyart-ready')).toHaveCount(1);
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

  test('NodeMap: pad selects a DOM route node and Travel uses onNodeClick', async ({ page }) => {
    await page.goto('/?devScene=nodemap&preset=fresh&gamepadSim=1');
    await waitForGame(page);
    await waitForScene(page, 'NodeMap');
    await installSimPad(page);
    await readyRoute(page);
    await page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('NodeMap');
      window.__nodeClicks = [];
      s.onNodeClick = (node) => window.__nodeClicks.push(node.id);
    });
    const route = page.locator('.re-node-map');
    const choices = route.locator('button.re-node.is-available');
    const target = choices.nth((await choices.count()) > 1 ? 1 : 0);
    await focusWithPad(page, target);
    await tap(page, BTN.CONFIRM);
    await expect(target).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => window.__nodeClicks)).toEqual([]);
    const selected = await target.getAttribute('data-node');
    await focusWithPad(page, route.getByRole('button', { name: 'Travel', exact: true }));
    await tap(page, BTN.CONFIRM);
    expect(await page.evaluate(() => window.__nodeClicks)).toEqual([selected]);
  });

  test('HomeBase: pad changes loadout tabs, visits upgrades and returns with B', async ({
    page,
  }) => {
    await page.goto('/?devScene=homebase&gamepadSim=1');
    await waitForGame(page);
    await waitForScene(page, 'HomeBase');
    await installSimPad(page);
    const home = page.getByRole('dialog', { name: 'Home base', exact: true });
    await expect(home.getByRole('button', { name: 'Upgrades', exact: true })).toBeFocused();
    const skills = home.getByRole('button', { name: 'Starting skills', exact: true });
    await focusWithPad(page, skills);
    await tap(page, BTN.CONFIRM);
    await expect(skills).toHaveAttribute('aria-pressed', 'true');
    await tap(page, BTN.CANCEL);
    await expect(home.getByRole('button', { name: 'Starting lords', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await focusWithPad(page, home.getByRole('button', { name: 'Upgrades', exact: true }));
    await tap(page, BTN.CONFIRM);
    const upgrades = page.getByRole('dialog', { name: 'Army upgrades', exact: true });
    const category = upgrades
      .getByRole('navigation', { name: 'Upgrade categories' })
      .getByRole('button', { name: 'Lords', exact: true });
    await focusWithPad(page, category);
    await tap(page, BTN.CONFIRM);
    await expect(category).toHaveAttribute('aria-pressed', 'true');
    await tap(page, BTN.CANCEL);
    await expect(upgrades).toHaveCount(0);
    await expect(home).toBeVisible();
  });

  test('NodeMap: ROSTER owns pad tabs and unit cycling, B restores route', async ({ page }) => {
    await page.goto('/?devScene=nodemap&preset=fresh&gamepadSim=1');
    await waitForGame(page);
    await waitForScene(page, 'NodeMap');
    await installSimPad(page);
    await readyRoute(page);
    const routeSelection = await page
      .locator('.re-node-map .re-node[aria-pressed="true"]')
      .getAttribute('data-node');
    await tap(page, BTN.ROSTER);
    const roster = page.getByRole('dialog', { name: 'Manage roster', exact: true });
    await expect(roster).toBeVisible();
    const views = roster.getByRole('navigation', { name: 'Roster views' });
    await expect(views.getByRole('button', { name: 'Stats', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await tap(page, BTN.RIGHT);
    await expect(views.getByRole('button', { name: 'Skills', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const units = roster.getByRole('navigation', { name: 'Units' }).getByRole('button');
    await tap(page, BTN.R1);
    await expect(units.nth((await units.count()) > 1 ? 1 : 0)).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(views.getByRole('button', { name: 'Stats', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await tap(page, BTN.CANCEL);
    await expect(roster).toHaveCount(0);
    await expect(page.locator('.re-node-map')).toBeVisible();
    expect(
      await page.locator('.re-node-map .re-node[aria-pressed="true"]').getAttribute('data-node'),
    ).toBe(routeSelection);
  });
});
