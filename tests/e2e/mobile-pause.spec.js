import { test, expect, devices } from '@playwright/test';
import { waitForGame, waitForScene } from './helpers.js';
test.use({ ...devices['iPhone 13'], viewport: { width: 667, height: 375 } });
async function battle(page) {
  await page.goto('/?devScene=battle&preset=battle_smoke&seed=42');
  await waitForGame(page);
  await waitForScene(page, 'Battle');
  await page.waitForFunction(() =>
    ['DEPLOY_SELECTION', 'PLAYER_IDLE'].includes(window.__sceneState?.battle?.state),
  );
  await page.evaluate(() => {
    const b = window.__emblemRogueGame.scene.getScene('Battle');
    if (b.battleState === 'DEPLOY_SELECTION')
      b.children.list
        .filter((o) => o.type === 'Rectangle' && o.input?.enabled && o.listenerCount('pointerdown'))
        .at(-1)
        ?.emit('pointerdown');
  });
  await expect(page.getByRole('complementary', { name: 'Battle commands' })).toBeVisible();
}
test('battle information replaces canvas labels and preserves terrain, par and rewind details', async ({
  page,
}) => {
  await battle(page);
  const hud = page.getByRole('complementary', { name: 'Battle commands' });
  const terrainName = await page.evaluate(() => {
    const b = window.__emblemRogueGame.scene.getScene('Battle');
    b._mobileTerrainFocus = { col: b.playerUnits[0].col, row: b.playerUnits[0].row };
    return b.grid.getTerrainAt(b._mobileTerrainFocus.col, b._mobileTerrainFocus.row).name;
  });
  await expect(hud.locator('.mb-terrain')).toContainText(terrainName);
  await expect(hud.locator('.mb-terrain')).toContainText('Avoid');
  await hud.locator('summary').filter({ hasText: 'Battle details' }).tap();
  await expect(hud.locator('.mb-objective')).not.toBeEmpty();
  expect(
    await page.evaluate(() => {
      const b = window.__emblemRogueGame.scene.getScene('Battle');
      return [b.infoText, b.objectiveText, b.turnCounterText, b.visionHudText]
        .filter(Boolean)
        .every((o) => !o.visible);
    }),
  ).toBe(true);
  await page.screenshot({ path: 'test-results/mobile-battle-info.png' });
  await hud.locator('summary').filter({ hasText: 'Battle details' }).tap();
  expect(
    await hud.locator('.mb-command-grid .mb-button').evaluateAll((buttons) =>
      buttons.every((button) => {
        const range = document.createRange();
        range.selectNodeContents(button);
        return range.getClientRects().length === 1;
      }),
    ),
  ).toBe(true);
});
test('every pause action fits in landscape, child settings return correctly, and resume releases input', async ({
  page,
}) => {
  await battle(page);
  await page
    .getByRole('complementary', { name: 'Battle commands' })
    .getByRole('button', { name: 'Menu', exact: true })
    .tap();
  const pause = page.getByRole('dialog', { name: 'Paused' });
  await expect(pause).toBeVisible();
  expect(
    await pause
      .locator('button')
      .evaluateAll((bs) => bs.every((b) => b.getBoundingClientRect().height >= 44)),
  ).toBe(true);
  // Landscape phones lay the actions out in two columns: all of them in view, no scrolling.
  expect(
    await pause.locator('.mp-actions').evaluate((e) => ({
      scrolls: e.scrollHeight > e.clientHeight + 1,
      allInView: [...e.querySelectorAll('button')].every((b) => {
        const r = b.getBoundingClientRect();
        return r.top >= 0 && r.bottom <= window.innerHeight;
      }),
    })),
  ).toEqual({ scrolls: false, allInView: true });
  await page.screenshot({ path: 'test-results/mobile-pause.png' });
  await pause.getByRole('button', { name: 'Settings', exact: true }).tap();
  await expect(pause).toBeHidden();
  await page.evaluate(() =>
    window.__emblemRogueGame.scene.getScene('Battle').pauseOverlay.closeActiveSubOverlay(),
  );
  await expect(pause).toBeVisible();
  await pause.getByRole('button', { name: 'Resume', exact: true }).tap();
  await expect(pause).toHaveCount(0);
  await expect(page.getByRole('complementary', { name: 'Battle commands' })).toBeVisible();
});
test('held blessings and burdens list under the note and never push an action out of view', async ({
  page,
}) => {
  await battle(page);
  // A run holding a pact blessing, two mid-run ones and two burdens: both lists at once.
  // (A mid-run grant is never a pact or intrinsic card: addBlessingMidRun refuses those.)
  await page.evaluate(() => {
    const rm = window.__emblemRogueGame.scene.getScene('Battle').runManager;
    const tome = rm.gameData.blessings.blessings.find((b) => b.id === 'forbidden_tome');
    const catalog = rm.gameData.blessings.priceCatalog;
    const parts = tome.pact.map((id) => catalog[id]);
    rm.activeBlessings = [
      {
        id: 'forbidden_tome',
        rolledCost: {
          label: parts.map((p) => p.label).join(' · '),
          effects: parts.flatMap((p) => p.effects),
          kind: 'pact',
        },
      },
    ];
    rm.addBlessingMidRun('field_medic');
    rm.addBlessingMidRun('iron_oath');
    rm.burdens = [
      { id: 'ill_omen', battles: 3, extraShadow: 1 },
      { id: 'debt', owed: 450, garnish: 0.5 },
    ];
  });
  await page
    .getByRole('complementary', { name: 'Battle commands' })
    .getByRole('button', { name: 'Menu', exact: true })
    .tap();
  const pause = page.getByRole('dialog', { name: 'Paused' });
  const blessings = pause.getByRole('list', { name: 'Blessings' });
  await expect(blessings.locator('li')).toHaveCount(3);
  await expect(blessings.locator('li').first()).toContainText('Forbidden Tome · IV');
  await expect(blessings.locator('li').first()).toContainText(
    'Pact: Churches cannot revive the fallen this run',
  );
  await expect(blessings.locator('li').nth(2)).not.toContainText('Cost:');
  await expect(pause.getByRole('list', { name: 'Burdens' }).locator('li')).toHaveCount(2);
  // The lists give way: every action stays in view, unscrolled; the lists scroll instead.
  expect(
    await pause.locator('.mp-actions').evaluate((e) => ({
      scrolls: e.scrollHeight > e.clientHeight + 1,
      allInView: [...e.querySelectorAll('button')].every((b) => {
        const r = b.getBoundingClientRect();
        return r.top >= 0 && r.bottom <= window.innerHeight;
      }),
    })),
  ).toEqual({ scrolls: false, allInView: true });
  // A price's words open on a tap (touch has no hover), and the actions still fit.
  const price = blessings.locator('li').first().locator('summary');
  const terms = blessings.locator('li').first().locator('.mp-blessing-terms');
  await expect(terms).toBeHidden();
  await price.tap();
  await expect(terms).toBeVisible();
  await expect(terms).toContainText('A pact is a fixed price');
  expect(
    await pause
      .locator('.mp-actions button')
      .evaluateAll((all) =>
        all.every(
          (b) =>
            b.getBoundingClientRect().top >= 0 &&
            b.getBoundingClientRect().bottom <= window.innerHeight,
        ),
      ),
  ).toBe(true);
  const last = blessings.locator('li').last();
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeInViewport();
  await page.screenshot({ path: 'test-results/mobile-pause-blessings.png' });
});
test('abandon retains confirmation and invokes the existing callback only once', async ({
  page,
}) => {
  await battle(page);
  await page
    .getByRole('complementary', { name: 'Battle commands' })
    .getByRole('button', { name: 'Menu', exact: true })
    .tap();
  await page.evaluate(() => {
    const b = window.__emblemRogueGame.scene.getScene('Battle');
    window.__testAbandons = 0;
    b.pauseOverlay.onAbandon = () => {
      window.__testAbandons++;
    };
  });
  const pause = page.getByRole('dialog', { name: 'Paused' });
  await pause.getByRole('button', { name: 'Abandon Run', exact: true }).tap();
  await expect(pause.getByText('Abandon this run?', { exact: false })).toBeVisible();
  await expect(pause.getByRole('button').first()).toHaveText('Cancel');
  await expect(pause.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await pause.getByRole('button', { name: 'Cancel', exact: true }).tap();
  expect(await page.evaluate(() => window.__testAbandons)).toBe(0);
  await pause.getByRole('button', { name: 'Abandon Run', exact: true }).tap();
  await pause.getByRole('button', { name: 'Abandon run', exact: true }).tap();
  await expect(pause).toHaveCount(0);
  expect(await page.evaluate(() => window.__testAbandons)).toBe(1);
});

test('save-exit confirmation cancels safely and hands off once without resuming', async ({
  page,
}) => {
  await battle(page);
  await page
    .getByRole('complementary', { name: 'Battle commands' })
    .getByRole('button', { name: 'Menu', exact: true })
    .tap();
  await page.evaluate(() => {
    const o = window.__emblemRogueGame.scene.getScene('Battle').pauseOverlay;
    window.__testExit = { saved: 0, resumed: 0 };
    o.onSaveAndExitWarning = 'Return to title with this saved run?';
    o.onSaveAndExit = () => {
      window.__testExit.saved++;
    };
    o.onResume = () => {
      window.__testExit.resumed++;
    };
  });
  const pause = page.getByRole('dialog', { name: 'Paused' });
  await pause.getByRole('button', { name: 'Save & Return to Title', exact: true }).tap();
  await expect(pause).toContainText('Save and return to Title?');
  await expect(pause.getByRole('button').first()).toHaveText('Cancel');
  await expect(pause.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await pause.getByRole('button', { name: 'Cancel', exact: true }).tap();
  expect(await page.evaluate(() => window.__testExit)).toEqual({ saved: 0, resumed: 0 });
  await pause.getByRole('button', { name: 'Save & Return to Title', exact: true }).tap();
  await pause.getByRole('button', { name: 'Save & return', exact: true }).tap();
  await expect(pause).toHaveCount(0);
  expect(await page.evaluate(() => window.__testExit)).toEqual({ saved: 1, resumed: 0 });
});
