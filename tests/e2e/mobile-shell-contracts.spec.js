import { test, expect, devices } from '@playwright/test';
import { waitForGame, waitForScene } from './helpers.js';

test.use({ ...devices['iPhone SE'], viewport: { width: 667, height: 375 } });
const url = '/?devScene=battle&preset=battle_smoke&seed=42&mobilePreview=1';
async function boot(page) {
  await page.goto(url);
  await waitForGame(page);
  await waitForScene(page, 'Battle');
  await page.waitForFunction(() =>
    ['DEPLOY_SELECTION', 'PLAYER_IDLE'].includes(window.__sceneState?.battle?.state),
  );
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    if (s.battleState === 'DEPLOY_SELECTION')
      s.children.list
        .filter((o) => o.type === 'Rectangle' && o.input?.enabled && o.listenerCount('pointerdown'))
        .at(-1)
        ?.emit('pointerdown');
  });
}
async function drag(page, x, y, dx, dy) {
  const session = await page.context().newCDPSession(page);
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let i = 1; i <= 4; i++)
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: x + (dx * i) / 4, y: y + (dy * i) / 4 }],
    });
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await session.detach();
}

test('HUD drag cancels; rail End turn shares the safe two-step prompt and singular copy', async ({
  page,
}) => {
  await boot(page);
  const danger = page.getByRole('button', { name: 'Danger', exact: true });
  const box = await danger.boundingBox();
  await drag(page, box.x + box.width / 2, box.y + box.height / 2, -70, 0);
  await expect(danger).toHaveAttribute('aria-pressed', 'false');
  await danger.tap();
  await expect(danger).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    s.playerUnits.forEach((u, i) => (u.hasActed = i > 0));
    window.__ended = 0;
    s.forceEndTurn = () => window.__ended++;
    s.game.events.emit('mobile:endTurn');
  });
  const hud = page.getByRole('complementary', { name: 'Battle commands' });
  await expect(hud).toContainText('1 unit still has actions.');
  await expect(hud.getByRole('button', { name: 'Keep playing' })).toBeFocused();
  expect(await page.evaluate(() => window.__ended)).toBe(0);
  await hud.getByRole('button', { name: 'Keep playing' }).tap();
  await hud.getByRole('button', { name: 'End turn…', exact: true }).tap();
  await hud.getByRole('button', { name: 'End turn now', exact: true }).tap();
  expect(await page.evaluate(() => window.__ended)).toBe(1);
});

test('shared press guard rejects detached, hidden, canceled and changed-context releases but accepts keyboard', async ({
  page,
}) => {
  await boot(page);
  await page.evaluate(async () => {
    const { bindCancelablePress } = await import('/src/utils/cancelablePress.js');
    const b = document.createElement('button');
    b.id = 'press-fixture';
    b.textContent = 'Press fixture';
    Object.assign(b.style, {
      position: 'fixed',
      left: '20px',
      top: '20px',
      width: '120px',
      height: '48px',
      zIndex: '2000',
    });
    document.body.append(b);
    window.__pressCount = 0;
    window.__pressEpoch = 0;
    bindCancelablePress(b, () => window.__pressCount++, { context: () => window.__pressEpoch });
  });
  const button = page.getByRole('button', { name: 'Press fixture' });
  await button.tap();
  expect(await page.evaluate(() => window.__pressCount)).toBe(1);
  for (const reason of ['context', 'hidden', 'detached', 'cancel']) {
    await page.evaluate((reason) => {
      const b = document.getElementById('press-fixture');
      const e = (type) =>
        new PointerEvent(type, {
          bubbles: true,
          pointerId: 7,
          isPrimary: true,
          clientX: 40,
          clientY: 40,
        });
      b.dispatchEvent(e('pointerdown'));
      if (reason === 'context') window.__pressEpoch++;
      if (reason === 'hidden') b.hidden = true;
      if (reason === 'detached') b.remove();
      b.dispatchEvent(e(reason === 'cancel' ? 'pointercancel' : 'pointerup'));
      b.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
      b.hidden = false;
      if (!b.isConnected) document.body.append(b);
    }, reason);
  }
  expect(await page.evaluate(() => window.__pressCount)).toBe(1);
  await button.focus();
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => window.__pressCount)).toBe(2);
});

test('safe-area rail keeps button inside its width and a context change cancels its held press', async ({
  page,
}) => {
  await boot(page);
  await page.evaluate(() => {
    const rail = document.getElementById('mobile-left-panel');
    document.body.append(rail);
    document.documentElement.style.setProperty('--re-safe-left', '59px');
    Object.assign(rail.style, {
      display: 'flex',
      position: 'fixed',
      top: '0',
      left: '0',
      height: '100%',
      zIndex: '2000',
    });
  });
  const rail = page.locator('#mobile-left-panel');
  const menu = rail.locator('[data-action="menu"]');
  const metrics = await menu.evaluate((b) => {
    const r = b.parentElement.getBoundingClientRect(),
      c = b.getBoundingClientRect();
    return { rail: r.width, left: c.left - r.left, right: c.right - r.right, width: c.width };
  });
  expect(metrics.rail).toBe(139);
  expect(metrics.left).toBeGreaterThanOrEqual(59);
  expect(metrics.right).toBeLessThanOrEqual(0);
  expect(metrics.width).toBeGreaterThanOrEqual(48);
  await page.evaluate(() => {
    const b = document.querySelector('#mobile-left-panel [data-action="menu"]');
    const r = b.getBoundingClientRect();
    const e = (type) =>
      new PointerEvent(type, {
        bubbles: true,
        pointerId: 7,
        isPrimary: true,
        clientX: r.x + 20,
        clientY: r.y + 20,
      });
    b.dispatchEvent(e('pointerdown'));
    const g = window.__emblemRogueGame;
    g.events.emit('mobile:setContext', { context: 'none' });
    g.events.emit('mobile:setContext', { context: 'battle_player_idle' });
    b.dispatchEvent(e('pointerup'));
    b.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
  });
  await expect(page.getByRole('dialog', { name: 'Paused', exact: true })).toHaveCount(0);
  await menu.tap();
  await expect(page.getByRole('dialog', { name: 'Paused', exact: true })).toBeVisible();
});

test('one-finger camera drag after selecting a unit pans without committing a move', async ({
  page,
}) => {
  await boot(page);
  const point = await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle'),
      u = s.playerUnits.find((u) => u.currentHP > 0 && !u.hasActed);
    const w = s.grid.gridToPixel(u.col, u.row),
      p = s._worldToScreen(w.x, w.y),
      c = s.game.canvas.getBoundingClientRect();
    return { x: c.x + (p.x * c.width) / s.scale.width, y: c.y + (p.y * c.height) / s.scale.height };
  });
  await page.touchscreen.tap(point.x, point.y);
  await expect
    .poll(() => page.evaluate(() => window.__sceneState.battle.state))
    .toBe('UNIT_ACTION_MENU');
  const before = await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    s.cameras.main.setZoom(2);
    const bounds = s._getBattleMapBounds();
    s.cameras.main.centerOn(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
    s._battleCamera.clampToBounds();
    window.__panUnit = {
      col: s.selectedUnit.col,
      row: s.selectedUnit.row,
      hp: s.selectedUnit.currentHP,
      moved: s.selectedUnit.hasMoved,
    };
    return { x: s.cameras.main.scrollX, y: s.cameras.main.scrollY };
  });
  const box = await page.locator('#game-container canvas').boundingBox();
  await drag(page, box.x + box.width / 2, box.y + box.height / 2, 45, 25);
  const after = await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    return {
      x: s.cameras.main.scrollX,
      y: s.cameras.main.scrollY,
      state: s.battleState,
      unit: {
        col: s.selectedUnit.col,
        row: s.selectedUnit.row,
        hp: s.selectedUnit.currentHP,
        moved: s.selectedUnit.hasMoved,
      },
      before: window.__panUnit,
      touches: s._battleCamera.getTouchCount(),
    };
  });
  expect(after.x).not.toBe(before.x);
  expect(after.y).not.toBe(before.y);
  expect(after.state).toBe('UNIT_ACTION_MENU');
  expect(after.unit).toEqual(after.before);
  expect(after.touches).toBe(0);
  await page.screenshot({ path: '/tmp/mobile-shell-contract-tests/one-finger-pan.png' });
});

test('late phone resize reconciles the map; decorative auth canvas is gone', async ({ page }) => {
  await boot(page);
  await page.waitForTimeout(15000);
  for (const viewport of [
    { width: 844, height: 390 },
    { width: 640, height: 480 },
    { width: 667, height: 375 },
  ]) {
    await page.setViewportSize(viewport);
    await expect
      .poll(() =>
        page.locator('#game-container').evaluate((c) => {
          const a = c.getBoundingClientRect(),
            b = c.querySelector('canvas').getBoundingClientRect();
          return Math.abs(a.width - b.width) + Math.abs(a.height - b.height);
        }),
      )
      .toBeLessThan(3);
  }
  await expect(page.locator('canvas')).toHaveCount(1);
  await expect(page.locator('#auth-bg')).toHaveCount(0);
});

test('update toast stays off battle and modals; rotate instruction covers a portrait modal', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(screen.orientation, 'lock', { value: undefined, configurable: true });
  });
  await boot(page);
  await page.evaluate(async () => {
    const { showUpdateToast } = await import('/src/ui/UpdateToast.js');
    window.__restarts = 0;
    showUpdateToast(() => window.__restarts++);
  });
  await expect(page.locator('#sw-update-toast')).toBeHidden();
  await page
    .getByRole('navigation', { name: 'Battle utilities' })
    .getByRole('button', { name: 'Menu', exact: true })
    .tap();
  await page.setViewportSize({ width: 375, height: 667 });
  await expect(page.locator('#rotate-prompt')).toBeVisible();
  await expect(page.locator('#rotate-lock')).toBeHidden();
  expect(
    await page.evaluate(() => document.elementFromPoint(100, 100)?.closest('#rotate-prompt')?.id),
  ).toBe('rotate-prompt');
  await page.setViewportSize({ width: 667, height: 375 });
  await page.evaluate(async () => {
    const { startSceneLazy } = await import('/src/utils/sceneLoader.js');
    await startSceneLazy(window.__emblemRogueGame.scene.getScene('Battle'), 'Title');
  });
  await waitForScene(page, 'Title');
  const toast = page.getByRole('complementary', { name: 'Game update' });
  await expect(toast).toBeVisible();
  expect(
    await toast
      .getByRole('button')
      .evaluateAll((bs) =>
        bs.every(
          (b) => b.getBoundingClientRect().height >= 44 && b.getBoundingClientRect().width >= 44,
        ),
      ),
  ).toBe(true);
  await toast.getByRole('button', { name: 'Dismiss update notice' }).tap();
  expect(await page.evaluate(() => window.__restarts)).toBe(0);
});

test('cloud-auth form has readable targets and offline requires an explicit safe confirmation', async ({
  page,
}) => {
  await page.route(/\/src\/cloud\/supabaseClient\.js(?:\?.*)?$/, async (route) => {
    const response = await route.fetch();
    let source = await response.text();
    source = source.replace(
      /export const supabase =[\s\S]*?null;/,
      'export const supabase = { auth: { getSession: async () => ({ data: { session: null } }) } };',
    );
    await route.fulfill({ response, body: source });
  });
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto('/');
  const form = page.locator('#auth-overlay');
  await expect(form).toBeVisible();
  const metrics = await form.locator('input').evaluateAll((inputs) =>
    inputs.map((e) => ({
      font: parseFloat(getComputedStyle(e).fontSize),
      height: e.getBoundingClientRect().height,
    })),
  );
  expect(metrics.every((m) => m.font >= 16 && m.height >= 44)).toBe(true);
  expect(
    await form
      .locator('#auth-submit,#auth-toggle,#auth-skip')
      .evaluateAll((bs) => bs.every((b) => b.getBoundingClientRect().height >= 44)),
  ).toBe(true);
  await page.screenshot({ path: '/tmp/mobile-shell-contract-tests/auth-phone.png' });
  await page.getByRole('button', { name: 'Play offline', exact: true }).tap();
  const confirm = page.getByRole('dialog', { name: 'Play without cloud saves?' });
  await expect(confirm).toBeVisible();
  await expect(confirm.getByRole('button', { name: 'Back to sign in' })).toBeFocused();
  expect(await page.evaluate(() => Boolean(window.__emblemRogueGame))).toBe(false);
  await confirm.getByRole('button', { name: 'Back to sign in' }).tap();
  await expect(confirm).not.toBeVisible();
  await page.getByRole('button', { name: 'Play offline', exact: true }).tap();
  await confirm.getByRole('button', { name: 'Play offline', exact: true }).tap();
  await waitForGame(page);
  await expect(form).toBeHidden();
  await expect(page.locator('#auth-bg')).toHaveCount(0);
});

async function hold(page, x, y, ms = 800) {
  const session = await page.context().newCDPSession(page);
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await page.waitForTimeout(ms);
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await session.detach();
}

/**
 * A unit's centre in page coordinates (map world -> canvas pixels -> page). Picks
 * a unit that is visible (not fogged) and inside the canvas; if none is, the
 * camera is centred on the first visible one so the hold lands on a real tile.
 */
async function unitOnPage(page, which) {
  return page.evaluate((which) => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const rect = s.game.canvas.getBoundingClientRect();
    const pool = (which === 'enemy' ? s.enemyUnits : s.playerUnits).filter(
      (u) => !s.grid.fogEnabled || s.grid.isVisible(u.col, u.row),
    );
    const place = (unit) => {
      const world = s.grid.gridToPixel(unit.col, unit.row);
      const screen = s._worldToScreen(world.x, world.y);
      const x = rect.left + (screen.x * rect.width) / s.scale.width;
      const y = rect.top + (screen.y * rect.height) / s.scale.height;
      const inside =
        x > rect.left + 8 && x < rect.right - 8 && y > rect.top + 8 && y < rect.bottom - 8;
      return { name: unit.name, x, y, inside };
    };
    let hit = pool.map(place).find((p) => p.inside);
    if (!hit && pool[0]) {
      const world = s.grid.gridToPixel(pool[0].col, pool[0].row);
      s.cameras.main.centerOn(world.x, world.y);
      hit = place(pool[0]);
    }
    return hit;
  }, which);
}

test('a long press on a unit opens its details (enemy or ally) without selecting it', async ({
  page,
}) => {
  await boot(page);
  await page.waitForFunction(() => window.__sceneState?.battle?.state === 'PLAYER_IDLE');
  const overlay = () =>
    page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      return {
        visible: Boolean(s.unitDetailOverlay?.visible),
        unit: s.unitDetailOverlay?._unit?.name || null,
        selected: s.selectedUnit?.name || null,
        state: s.battleState,
      };
    });
  for (const which of ['enemy', 'player']) {
    const at = await unitOnPage(page, which);
    await hold(page, at.x, at.y);
    await expect.poll(overlay).toMatchObject({ visible: true, unit: at.name, selected: null });
    await page.evaluate(() =>
      window.__emblemRogueGame.scene.getScene('Battle').unitDetailOverlay.hide(),
    );
    await expect.poll(overlay).toMatchObject({ visible: false, state: 'PLAYER_IDLE' });
  }
  // A plain tap on an ally still selects it (the hold did not steal the tap).
  const ally = await unitOnPage(page, 'player');
  await page.touchscreen.tap(ally.x, ally.y);
  await expect.poll(overlay).toMatchObject({ visible: false, selected: ally.name });
});

test('game text cannot be selected or long-press copied; real inputs still can', async ({
  page,
}) => {
  await boot(page);
  const styles = await page.evaluate(() => {
    const read = (el) => {
      const cs = getComputedStyle(el);
      return {
        select: cs.userSelect || cs.webkitUserSelect,
        callout: cs.webkitTouchCallout ?? 'none',
      };
    };
    const rail = document.querySelector('.mobile-battle-hud') || document.body;
    const input = document.querySelector('#auth-overlay input');
    return { body: read(document.body), rail: read(rail), input: input ? read(input) : null };
  });
  expect(styles.body.select).toBe('none');
  expect(styles.rail.select).toBe('none');
  if (styles.input) expect(styles.input.select).toBe('text');
  // Selecting the rail's words programmatically the way a long press would yields nothing.
  const selected = await page.evaluate(() => {
    const rail = document.querySelector('.mobile-battle-hud');
    const range = document.createRange();
    range.selectNodeContents(rail);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    return sel.toString().trim().length;
  });
  expect(selected).toBe(0);
});
