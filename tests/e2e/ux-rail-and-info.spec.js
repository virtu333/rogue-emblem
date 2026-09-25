// Battle rail and explain affordance at phone and desktop sizes:
// - Danger lives in a fixed dock: reachable without scrolling, even with the largest
//   action menu; the menu's primary action shows first; overflow is cued, never sliced.
// - Danger paints a readable threat overlay (fill + edges) and pins on hold.
// - [N] / the end-turn prompt locate the next ready unit (desktop).
// - ⓘ + press-and-hold explain roster cards; the hold gesture is taught once.
import { test, expect } from '@playwright/test';
import { waitForScene as waitForSceneQuick } from './helpers.js';

test.setTimeout(150000);

async function waitForScene(page, key) {
  try {
    await waitForSceneQuick(page, key);
  } catch {
    await page.waitForFunction((k) => window.__sceneState?.activeScene === k, key, {
      timeout: 60000,
    });
  }
}

const PHONES = [
  { width: 844, height: 390 },
  { width: 667, height: 375 },
  { width: 1000, height: 460 },
];

async function phoneContext(browser, viewport) {
  return browser.newContext({
    viewport,
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
  });
}

async function bootBattle(page, { phone = true } = {}) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() =>
    localStorage.setItem(
      'emblem_rogue_settings',
      JSON.stringify({ musicVolume: 0, sfxVolume: 0, hints: false }),
    ),
  );
  await page.goto(
    `/?devScene=battle&preset=combat_actions&seed=42${phone ? '&mobilePreview=1&battleLab=1' : ''}`,
  );
  await waitForScene(page, 'Battle');
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'PLAYER_IDLE',
  );
  return errors;
}

for (const viewport of PHONES) {
  test(`rail: Danger is docked and the largest menu reads first-action-first at ${viewport.width}x${viewport.height}`, async ({
    browser,
  }) => {
    const context = await phoneContext(browser, viewport);
    const page = await context.newPage();
    const errors = await bootBattle(page);
    const hud = page.getByRole('complementary', { name: 'Battle commands' });
    const danger = hud.getByRole('button', { name: 'Danger', exact: true });
    const docked = () =>
      page.evaluate(() => {
        const b = document.querySelector('.mb-dock .mb-danger-toggle');
        if (!b) return { present: false };
        const r = b.getBoundingClientRect();
        return {
          present: true,
          inBody: Boolean(b.closest('.mb-body')),
          inView: r.top >= 0 && r.bottom <= innerHeight + 0.5 && r.height >= 44,
        };
      });
    await expect.poll(() => docked()).toEqual({ present: true, inBody: false, inView: true });

    // The unit with the most actions opens its menu.
    const actions = await page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      let best = null;
      for (const u of s.playerUnits.filter((p) => p.currentHP > 0 && !p.hasActed)) {
        s.selectUnit(u);
        s.showActionMenu(u);
        const n = document.querySelectorAll('.mb-body .mb-actions button').length;
        if (!best || n > best.n) best = { name: u.name, n };
        s.hideActionMenu?.();
        s.deselectUnit?.();
        s.battleState = 'PLAYER_IDLE';
      }
      const u = s.playerUnits.find((p) => p.name === best.name);
      s.selectUnit(u);
      s.showActionMenu(u);
      return best;
    });
    expect(actions.n).toBeGreaterThan(1);
    await expect.poll(() => docked()).toEqual({ present: true, inBody: false, inView: true });
    const rail = await page.evaluate(() => {
      const body = document.querySelector('.mobile-battle-hud .mb-body');
      const first = body.querySelector('button');
      const f = first.getBoundingClientRect();
      const b = body.getBoundingClientRect();
      const cue = document.querySelector('.mb-scroll-cue');
      return {
        scrollTop: body.scrollTop,
        firstVisible: f.top >= b.top - 0.5 && f.bottom <= b.bottom + 0.5,
        overflows: body.scrollHeight > body.clientHeight + 2,
        cue: cue && !cue.hidden ? cue.textContent : null,
        bottomFade: !document.querySelector('.mb-scroll-fade.is-bottom')?.hidden,
      };
    });
    expect(rail.scrollTop).toBe(0);
    expect(rail.firstVisible).toBe(true);
    if (rail.overflows) {
      // Overflow is cued, not sliced: a soft fade and "more ▾", then "more ▴" at the end.
      expect(rail.cue).toBe('more ▾');
      expect(rail.bottomFade).toBe(true);
      await page.evaluate(() => {
        const body = document.querySelector('.mobile-battle-hud .mb-body');
        body.scrollTop = body.scrollHeight;
        body.dispatchEvent(new Event('scroll'));
      });
      await expect
        .poll(() =>
          page.evaluate(() => {
            const cue = document.querySelector('.mb-scroll-cue');
            return cue && !cue.hidden ? cue.textContent : null;
          }),
        )
        .toBe('more ▴');
    }

    // Danger from the dock: overlay drawn with a real fill, pressed state exposed.
    await danger.tap();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const z = window.__emblemRogueGame.scene.getScene('Battle').dangerZone;
          const reach = (z?.tiles || []).filter((t) => t.tier > 0);
          return {
            visible: Boolean(z?.visible),
            tiles: reach.length > 0,
            filled: reach.every((t) => t.fillAlpha >= 0.2),
          };
        }),
      )
      .toEqual({ visible: true, tiles: true, filled: true });
    await expect(danger).toHaveAttribute('aria-pressed', 'true');
    expect(errors).toEqual([]);
    await context.close();
  });
}

test('desktop: [N] locates and selects the next ready unit', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors = await bootBattle(page, { phone: false });
  const names = await page.evaluate(() =>
    window.__emblemRogueGame.scene
      .getScene('Battle')
      .playerUnits.filter((u) => u.currentHP > 0 && !u.hasActed)
      .sort((a, b) => a.row - b.row || a.col - b.col)
      .map((u) => u.name),
  );
  await page.locator('canvas').first().hover();
  await page.keyboard.press('n');
  await expect
    .poll(() =>
      page.evaluate(() => {
        const s = window.__emblemRogueGame.scene.getScene('Battle');
        return {
          state: s.battleState,
          selected: s.selectedUnit?.name,
          locator: Boolean(s._unitLocator),
        };
      }),
    )
    .toEqual({ state: 'UNIT_SELECTED', selected: names[0], locator: true });
  if (names.length > 1) {
    await page.keyboard.press('Escape');
    await page.waitForFunction(
      () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'PLAYER_IDLE',
    );
    await page.keyboard.press('n');
    await expect
      .poll(() =>
        page.evaluate(() => window.__emblemRogueGame.scene.getScene('Battle').selectedUnit?.name),
      )
      .toBe(names[1]);
  }
  expect(errors).toEqual([]);
  await context.close();
});

async function openRoster(page, phone) {
  await page.goto(
    `/?devScene=nodemap&preset=battle_smoke&seed=42${phone ? '&mobilePreview=1' : ''}`,
  );
  await waitForScene(page, 'NodeMap');
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('NodeMap').dialogueOverlay?.visible,
  );
  await page.getByRole('button', { name: 'Skip conversation', exact: true }).click();
  await page.evaluate(() => window.__emblemRogueGame.scene.getScene('NodeMap')._openRoster());
  const roster = page.getByRole('dialog', { name: /roster/i }).first();
  await expect(roster).toBeVisible();
  return roster;
}

test('phone: ⓘ is a 44px target, press-and-hold explains a card, and the tip shows once', async ({
  browser,
}) => {
  const context = await phoneContext(browser, { width: 844, height: 390 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    if (sessionStorage.getItem('__seeded')) return;
    sessionStorage.setItem('__seeded', '1');
    localStorage.removeItem('emblem_rogue_tip_hold_info');
  });
  const roster = await openRoster(page, true);
  await expect(page.locator('.re-hold-tip')).toContainText('press and hold');
  const info = roster.getByRole('button', { name: 'About class mastery', exact: true });
  await info.scrollIntoViewIfNeeded();
  const box = await info.boundingBox();
  expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44);
  // Press and hold the card body (not the ⓘ).
  const card = info.locator('xpath=ancestor::*[contains(@class, "mr-card")][1]');
  const cardBox = await card.boundingBox();
  const cdp = await context.newCDPSession(page);
  const point = { x: cardBox.x + 24, y: cardBox.y + cardBox.height - 12 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
  await page.waitForTimeout(800);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const help = page.getByRole('dialog', { name: 'Class mastery', exact: true });
  await expect(help).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(help).toHaveCount(0);
  // Taught once: reopening the roster does not repeat the tip.
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__emblemRogueGame.scene.getScene('NodeMap')._openRoster());
  await expect(page.getByRole('dialog', { name: /roster/i }).first()).toBeVisible();
  await expect(page.locator('.re-hold-tip')).toHaveCount(0);
  expect(errors).toEqual([]);
  await context.close();
});

test('desktop: ⓘ previews on hover and opens with the keyboard', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const roster = await openRoster(page, false);
  const info = roster.getByRole('button', { name: 'About class mastery', exact: true });
  await info.scrollIntoViewIfNeeded();
  await info.hover();
  await expect(page.locator('.re-info-tip:popover-open')).toBeVisible();
  await info.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Class mastery', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(info).toBeFocused();
  expect(errors).toEqual([]);
  await context.close();
});
