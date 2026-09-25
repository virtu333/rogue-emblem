import { test, expect } from '@playwright/test';
import { waitForScene, collectErrors } from './helpers.js';

// The Eclipse (docs/specs/eclipse.md): the Loom's medallion and eclipsed knots, the
// fall ceremony (plays once, then is saved as seen), the explainer card, and the
// battle HUD projection on desktop and phone. `preset=eclipse` builds an Umbral run
// (shadow 58, act shadow 14) whose falls have not played yet.

const VIEWPORTS = [
  { label: 'desktop', width: 1280, height: 800, mobile: false },
  { label: 'phone', width: 844, height: 390, mobile: true },
];

async function openEclipseRoute(page, { width, height, mobile }, extra = '') {
  await page.setViewportSize({ width, height });
  await page.goto(
    `/?devScene=nodemap&preset=eclipse&seed=42${mobile ? '&mobilePreview=1' : ''}${extra}`,
  );
  await waitForScene(page, 'NodeMap');
  await page.getByRole('button', { name: 'Skip conversation', exact: true }).click();
  const route = page.locator('.re-node-map');
  await expect(route).toBeVisible();
  return route;
}

const runState = (page) =>
  page.evaluate(() => {
    const rm = window.__emblemRogueGame.scene.getScene('NodeMap').runManager;
    const eclipsed = rm.nodeMap.nodes.filter((n) => n.eclipse);
    return {
      shadow: rm.eclipse.shadow,
      eclipsed: eclipsed.length,
      unseen: eclipsed.filter((n) => !n.eclipse.seen).length,
    };
  });

for (const vp of VIEWPORTS) {
  test(`loom shows the Eclipse and plays the fall once (${vp.label})`, async ({ page }) => {
    const errors = collectErrors(page);
    const route = await openEclipseRoute(page, vp);
    const before = await runState(page);
    expect(before.shadow).toBe(58);
    expect(before.eclipsed).toBeGreaterThan(0);

    // Medallion: phase + number (the phase kicker collapses on narrow screens).
    const medal = route.locator('.re-eclipse-medal');
    await expect(medal).toBeVisible();
    await expect(medal).toHaveAttribute('aria-label', /Umbral, 58 shadow/);
    await expect(medal.locator('.re-eclipse-num')).toHaveText('58');
    const box = await medal.locator('canvas').boundingBox();
    expect(Math.round(box.width)).toBe(28);
    await expect(medal.locator('.re-eclipse-phase')).toBeVisible({ visible: !vp.mobile });

    // The ceremony: every fallen knot ends eclipsed, the loss is named once, saved seen.
    await expect(route.locator('.re-node.is-eclipsed')).toHaveCount(before.eclipsed);
    await expect(route.locator('.re-node.is-eclipse-pending')).toHaveCount(0, {
      timeout: 15_000,
    });
    await expect(route.locator('.re-eclipse-toast')).toContainText(/^The dark takes the /);
    await expect.poll(async () => (await runState(page)).unseen).toBe(0);

    // Inspecting an eclipsed knot.
    await route.locator('.re-node.is-eclipsed').first().click();
    await expect(route.locator('.re-loom-card')).toHaveAttribute('data-tone', 'eclipsed');
    await expect(route.locator('.re-loom-kind')).toContainText('ECLIPSED');
    await expect(route.locator('.re-loom-tag').first()).toHaveText('Eclipsed');

    // A knot the dark will take soon carries a bite and a countdown.
    const waning = route.locator('.re-node.is-waning');
    if ((await waning.count()) > 0) {
      await expect(waning.first().locator('.re-eclipse-bite-disc')).toHaveCount(1);
      await waning.first().click();
      await expect(route.locator('.re-loom-eclipse-warn')).toHaveText(
        /^The dark takes this in [1-3] more shadow$/,
      );
    }

    // The explainer card reads over the loom it explains.
    await medal.click();
    const card = page.getByRole('dialog', { name: 'The Eclipse', exact: true });
    await expect(card).toBeVisible();
    await expect(card).toContainText('UMBRAL');
    await expect(card).toContainText('58 shadow');
    await expect(card).toContainText('What darkens it');
    await expect(route).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(card).toHaveCount(0);

    // A reload of the same run never replays the fall.
    const rendered = await page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('NodeMap');
      s.drawMap();
      return s.nodeView.routeGraph.pendingFalls.length;
    });
    expect(rendered).toBe(0);
    expect(errors).toEqual([]);
  });
}

test('reduced motion swaps fallen knots at once', async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem('emblem_rogue_settings', JSON.stringify({ reduceMotion: true })),
  );
  const route = await openEclipseRoute(page, VIEWPORTS[1]);
  await expect(route.locator('.re-node.is-eclipse-pending')).toHaveCount(0, { timeout: 3000 });
  await expect(route.locator('.re-node.is-falling')).toHaveCount(0);
  await expect.poll(async () => (await runState(page)).unseen).toBe(0);
});

for (const vp of VIEWPORTS) {
  test(`battle HUD projects the shadow a victory would commit (${vp.label})`, async ({ page }) => {
    const errors = collectErrors(page);
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto(
      `/?devScene=battle&preset=eclipse&seed=42${vp.mobile ? '&mobilePreview=1' : ''}`,
    );
    await waitForScene(page, 'Battle');
    await page.waitForFunction(
      () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'PLAYER_IDLE',
      null,
      { timeout: 30_000 },
    );
    const held = await page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      return { label: s._eclipseHud.label(), par: s.turnPar };
    });
    expect(held.label).toBe('Sun holds');
    // Two turns past par: grace 3 → a victory now would add 5 shadow.
    await page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      s.turnManager.turnNumber = s.turnPar + 2;
    });
    if (vp.mobile) {
      const hud = page.getByRole('complementary', { name: 'Battle commands' });
      await expect(hud.locator('.mb-shadow')).toHaveText('Shadow +5');
      await expect(hud.locator('.mb-counters')).toContainText(/Par \d+ · [SABC] \| Rewinds/);
    } else {
      await expect
        .poll(() =>
          page.evaluate(() => {
            const t = window.__emblemRogueGame.scene.getScene('Battle').eclipseHudText;
            return t?.visible ? t.text : null;
          }),
        )
        .toBe('Shadow +5');
    }
    // The turn label keeps its parsed format and carries no silent-decay line.
    const label = await page.evaluate(
      () => window.__emblemRogueGame.scene.getScene('Battle').turnCounterText.text,
    );
    expect(label).toMatch(/^Turn: \d+ \/ Par: \d+ \([SABC]\)/);
    expect(label).not.toMatch(/Pressure/);
    expect(errors).toEqual([]);
  });
}

// Review R2: the global meter stops at the cap, the act's own shadow does not. A
// Hollow run whose act has gathered 3 shadow still counts down to its next fall, and a
// slow victory still darkens the land.
const SHOTS = process.env.ECLIPSE_SHOTS || '';
for (const vp of VIEWPORTS) {
  test(`at the cap the land still darkens: Loom and battle HUD (${vp.label})`, async ({ page }) => {
    const errors = collectErrors(page);
    const route = await openEclipseRoute(page, vp, '&shadow=100&actShadow=3');
    const state = await page.evaluate(() => {
      const rm = window.__emblemRogueGame.scene.getScene('NodeMap').runManager;
      const view = rm.getEclipseView();
      return {
        shadow: rm.eclipse.shadow,
        actShadow: rm.eclipse.actShadow,
        nextFallAnywhere: view.nextFallAnywhere,
      };
    });
    expect(state).toMatchObject({ shadow: 100, actShadow: 3 });
    // Every threshold is at least 5, so some fall is still ahead and attainable.
    expect(state.nextFallAnywhere).toBeGreaterThan(0);
    const medal = route.locator('.re-eclipse-medal');
    await expect(medal).toHaveAttribute('aria-label', /Hollow, 100 shadow/);
    await medal.click();
    const card = page.getByRole('dialog', { name: 'The Eclipse', exact: true });
    await expect(card).toContainText('100 shadow');
    await expect(card).toContainText('This act has gathered 3 shadow.');
    await expect(card).toContainText('The sun can darken no further, but the land still can');
    await expect(card.locator('.re-eclipse-card-next')).toHaveText(
      /^(Next fall in \d+ shadow|The land within reach is safe this act\.)$/,
    );
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/eclipse_card_cap_${vp.label}.png` });
    await page.keyboard.press('Escape');
    await expect(card).toHaveCount(0);

    // A slow victory at the cap: the meter holds at 100, the act takes the whole gain.
    const committed = await page.evaluate(() => {
      const rm = window.__emblemRogueGame.scene.getScene('NodeMap').runManager;
      const node = rm.getAvailableNodes().find((n) => n.type === 'battle');
      rm.completeBattle(rm.getRoster(), node.id, 0, { turnCount: 30, turnPar: 5 });
      return { shadow: rm.eclipse.shadow, actShadow: rm.eclipse.actShadow };
    });
    expect(committed).toEqual({ shadow: 100, actShadow: 9 });
    expect(errors).toEqual([]);
  });

  test(`battle HUD at the cap shows the land-only gain (${vp.label})`, async ({ page }) => {
    const errors = collectErrors(page);
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto(
      `/?devScene=battle&preset=eclipse&seed=42&shadow=100&actShadow=3${vp.mobile ? '&mobilePreview=1' : ''}`,
    );
    await waitForScene(page, 'Battle');
    await page.waitForFunction(
      () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'PLAYER_IDLE',
      null,
      { timeout: 30_000 },
    );
    await page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      s.turnManager.turnNumber = s.turnPar + 2;
    });
    if (vp.mobile) {
      const hud = page.getByRole('complementary', { name: 'Battle commands' });
      await expect(hud.locator('.mb-shadow')).toHaveText('Shadow +5 (land only)');
      await expect(hud.locator('.mb-counters')).toContainText(/Par \d+ · [SABC] \| Rewinds/);
      // One line, inside the rail.
      const [shadowBox, railBox] = await Promise.all([
        hud.locator('.mb-shadow').boundingBox(),
        hud.boundingBox(),
      ]);
      expect(shadowBox.height).toBeLessThan(20);
      expect(shadowBox.x + shadowBox.width).toBeLessThanOrEqual(railBox.x + railBox.width);
    } else {
      await expect
        .poll(() =>
          page.evaluate(() => {
            const t = window.__emblemRogueGame.scene.getScene('Battle').eclipseHudText;
            return t?.visible ? t.text : null;
          }),
        )
        .toBe('Shadow +5 (land only)');
    }
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/battle_hud_cap_${vp.label}.png` });
    expect(errors).toEqual([]);
  });
}
