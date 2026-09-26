import { test, expect, devices } from '@playwright/test';
import { waitForScene, collectErrors } from './helpers.js';

// The upright Loom (html.portrait-ui on an upright phone): the act climbs from the
// party's first knot at the bottom to the Hollow Sun at the top, scrolls vertically,
// and the side pane becomes a bottom sheet (card, Travel, Menu/Roster, lord chips).
// The portrait shell sets the class; here the spec sets it itself, and hides the
// legacy rotate prompt the shell retires.
test.use({ ...devices['iPhone 13'] });

const PORTRAIT_UI_EVENT = 'emblem-rogue:portrait-ui';

async function openRoute(page, viewport, { portraitUi = true } = {}) {
  await page.setViewportSize(viewport);
  await page.addInitScript((on) => {
    document.addEventListener('DOMContentLoaded', () => {
      if (on) document.documentElement.classList.add('portrait-ui');
      const style = document.createElement('style');
      style.textContent = '#rotate-prompt{display:none!important}';
      document.head.append(style);
    });
  }, portraitUi);
  await page.goto('/?devScene=nodemap&preset=battle_smoke&seed=42');
  await waitForScene(page, 'NodeMap');
  await page.getByRole('button', { name: 'Skip conversation', exact: true }).tap();
  const route = page.locator('.re-node-map');
  await expect(route).toBeVisible();
  await expect(route.locator('.re-node').first()).toBeVisible();
  return route;
}

/** Where everything is, in viewport px, plus the run's own graph facts. */
function geometry(page, scope = '.re-node-map') {
  return page.evaluate((scope) => {
    const root = document.querySelector(scope);
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, h: r.height };
    };
    const scroll = root.querySelector('.re-node-scroll');
    const rm =
      window.__emblemRogueGame.scene.getScene('NodeMap').runManager ||
      window.__emblemRogueGame.scene.getScene('Battle').runManager;
    const nodes = rm.nodeMap.nodes;
    return {
      view: box(scroll),
      scrollTop: scroll.scrollTop,
      scrollLeft: scroll.scrollLeft,
      clientW: scroll.clientWidth,
      clientH: scroll.clientHeight,
      scrollW: scroll.scrollWidth,
      scrollH: scroll.scrollHeight,
      startId: rm.nodeMap.startNodeId,
      bossId: rm.nodeMap.bossNodeId,
      rows: Math.max(...nodes.map((n) => n.row)) + 1,
      nodes: [...root.querySelectorAll('.re-node')].map((b) => {
        const n = nodes.find((x) => x.id === b.dataset.node);
        // Position inside the scrolled weave (independent of the scroll offset).
        return {
          id: b.dataset.node,
          row: n.row,
          col: n.col,
          live: b.classList.contains('is-live'),
          future: b.classList.contains('is-future'),
          box: box(b),
          x: b.offsetLeft + b.offsetWidth / 2,
          y: b.offsetTop + b.offsetHeight / 2,
        };
      }),
      pageW: document.documentElement.scrollWidth,
      innerW: window.innerWidth,
      innerH: window.innerHeight,
    };
  }, scope);
}

const inside = (b, v, slack = 0.5) =>
  b.left >= v.left - slack &&
  b.right <= v.right + slack &&
  b.top >= v.top - slack &&
  b.bottom <= v.bottom + slack;

function expectVertical(g) {
  const start = g.nodes.find((n) => n.id === g.startId);
  const boss = g.nodes.find((n) => n.id === g.bossId);
  // Row I at the bottom, the boss on top; within a row, lanes run left to right.
  expect(start.y).toBeGreaterThan(boss.y);
  for (const a of g.nodes)
    for (const b of g.nodes) {
      if (a.row < b.row) expect(a.y, `${a.id} below ${b.id}`).toBeGreaterThan(b.y);
      if (a.row === b.row && a.col < b.col) expect(a.x).toBeLessThan(b.x);
    }
}

for (const viewport of [
  { width: 390, height: 844 },
  { width: 375, height: 667 },
]) {
  test(`${viewport.width}x${viewport.height}: the upright loom and its bottom sheet`, async ({
    page,
  }) => {
    const errors = collectErrors(page);
    const route = await openRoute(page, viewport);
    const g = await geometry(page);
    expectVertical(g);

    // Every knot of the act lies within the loom's width, and within its scroll range.
    expect(g.scrollW).toBeLessThanOrEqual(g.clientW);
    for (const n of g.nodes) {
      expect(n.box.left, n.id).toBeGreaterThanOrEqual(g.view.left - 0.5);
      expect(n.box.right, n.id).toBeLessThanOrEqual(g.view.right + 0.5);
      expect(n.y - n.box.h / 2, n.id).toBeGreaterThanOrEqual(-0.5);
      expect(n.y + n.box.h / 2, n.id).toBeLessThanOrEqual(g.scrollH + 0.5);
    }
    // No sideways page scroll.
    expect(g.pageW).toBeLessThanOrEqual(g.innerW);

    // The choices are in view when the loom opens.
    const live = g.nodes.filter((n) => n.live);
    expect(live.length).toBeGreaterThan(0);
    for (const n of live) expect(inside(n.box, g.view), n.id).toBe(true);

    if (viewport.height >= 844) {
      // A whole act fits above the sheet: nothing to scroll, every knot on screen.
      expect(g.scrollH).toBeLessThanOrEqual(g.clientH + 1);
      for (const n of g.nodes) expect(inside(n.box, g.view), n.id).toBe(true);
      await expect(page.locator('.re-loom-wrap')).not.toHaveClass(/more-(up|down)/);
    } else {
      // A short phone scrolls up the act; the frame says there is more above.
      expect(g.scrollH).toBeGreaterThan(g.clientH);
      await expect(page.locator('.re-loom-wrap')).toHaveClass(/more-up/);
      await page.locator('.re-node-scroll').evaluate((el) => (el.scrollTop = 0));
      await expect(page.locator('.re-loom-wrap')).toHaveClass(/more-down/);
      const top = await geometry(page);
      const boss = top.nodes.find((n) => n.id === top.bossId);
      expect(inside(boss.box, top.view)).toBe(true);
      await expect(route.locator(`.re-node[data-node="${g.bossId}"]`)).toBeInViewport();
    }

    // The sheet: card, Travel, then Menu/Roster and the lord chips, all under the loom
    // and on screen without scrolling the page.
    const sheet = await page.evaluate(() => {
      const r = (sel) => {
        const b = document.querySelector(sel).getBoundingClientRect();
        return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, h: b.height };
      };
      return {
        card: r('.re-node-map .re-loom-card'),
        travel: r('.re-node-map .re-loom-travel'),
        actions: r('.re-node-map .re-node-actions'),
        party: r('.re-node-map .re-loom-party'),
        loom: r('.re-node-map .re-node-scroll'),
      };
    });
    expect(sheet.card.top).toBeGreaterThanOrEqual(sheet.loom.bottom);
    expect(sheet.travel.top).toBeGreaterThanOrEqual(sheet.card.bottom);
    expect(sheet.actions.top).toBeGreaterThanOrEqual(sheet.travel.bottom);
    expect(Math.abs(sheet.party.top - sheet.actions.top)).toBeLessThan(1);
    expect(sheet.travel.h).toBeGreaterThanOrEqual(44);
    expect(sheet.travel.bottom).toBeLessThanOrEqual(g.innerH);
    expect(sheet.party.bottom).toBeLessThanOrEqual(g.innerH);
    // Thumb reach: Travel sits in the lower third of the screen.
    expect(sheet.travel.top).toBeGreaterThan(g.innerH * 0.66);

    // Tapping a knot shows its card in the sheet (and does not move the loom).
    const future = route.locator('.re-node.is-future').last();
    await future.scrollIntoViewIfNeeded();
    await future.tap();
    await expect(route.locator('.re-loom-card .re-loom-state')).toHaveText(/^Possible future/);
    const travel = route.getByRole('button', { name: 'Travel', exact: true });
    await expect(travel).toBeDisabled();
    await expect(travel).toBeInViewport({ ratio: 1 });
    await route.locator('.re-node.is-live').first().tap();
    await expect(route.locator('.re-loom-card .re-loom-state')).toHaveText(
      'Within reach · the next knot',
    );
    await expect(travel).toBeEnabled();
    await expect(travel).toBeInViewport({ ratio: 1 });
    const after = await geometry(page);
    expect(after.clientH).toBe(g.clientH);
    expect(after.pageW).toBeLessThanOrEqual(after.innerW);
    expect(errors).toEqual([]);
  });
}

test('turning the phone keeps the selection and the browsing place', async ({ page }) => {
  const errors = collectErrors(page);
  const route = await openRoute(page, { width: 375, height: 667 });
  // Inspect a far knot, then browse to the top of the act.
  const g0 = await geometry(page);
  const pick = g0.nodes
    .filter((n) => n.future && n.id !== g0.bossId)
    .sort((a, b) => b.row - a.row)[0];
  const knot = route.locator(`.re-node[data-node="${pick.id}"]`);
  await page.locator('.re-node-scroll').evaluate((el) => (el.scrollTop = 0));
  await knot.tap();
  await expect(knot).toHaveAttribute('aria-pressed', 'true');

  // Rotate to landscape: the shell drops portrait-ui and says so.
  await page.setViewportSize({ width: 667, height: 375 });
  await page.evaluate((type) => {
    document.documentElement.classList.remove('portrait-ui');
    window.dispatchEvent(new Event(type));
  }, PORTRAIT_UI_EVENT);
  await expect
    .poll(async () => {
      const g = await geometry(page);
      const s = g.nodes.find((n) => n.id === g.startId);
      const b = g.nodes.find((n) => n.id === g.bossId);
      return b.x > s.x && Math.abs(b.y - s.y) < 1;
    })
    .toBe(true);
  // Sideways: rows run left to right, the sheet is a side pane again.
  const side = await page.locator('.re-node-map .re-node-side').boundingBox();
  const loom = await page.locator('.re-node-map .re-node-scroll').boundingBox();
  expect(side.x).toBeGreaterThanOrEqual(loom.x + loom.width - 0.5);
  await expect(knot).toHaveAttribute('aria-pressed', 'true');
  await expect(knot).toBeInViewport({ ratio: 1 });
  await expect(route.locator('.re-loom-card .re-loom-state')).toHaveText(/^Possible future/);
  // The top rows the player browsed are still what the loom shows (far right).
  let g = await geometry(page);
  expect(g.scrollLeft).toBeGreaterThan(0);
  expect(g.scrollTop).toBe(0);

  // And back upright.
  await page.setViewportSize({ width: 375, height: 667 });
  await page.evaluate((type) => {
    document.documentElement.classList.add('portrait-ui');
    window.dispatchEvent(new Event(type));
  }, PORTRAIT_UI_EVENT);
  await expect
    .poll(async () => {
      const g2 = await geometry(page);
      const s = g2.nodes.find((n) => n.id === g2.startId);
      const b = g2.nodes.find((n) => n.id === g2.bossId);
      return s.y > b.y;
    })
    .toBe(true);
  g = await geometry(page);
  expectVertical(g);
  expect(g.scrollLeft).toBe(0);
  await expect(knot).toHaveAttribute('aria-pressed', 'true');
  await expect(knot).toBeInViewport({ ratio: 1 });
  // Browsing the top of the act, not snapped back to the choices at the bottom.
  expect(g.scrollTop).toBeLessThan((g.scrollH - g.clientH) / 2);
  expect(errors).toEqual([]);
});

test('portrait-ui is the key: without it (or sideways) the loom stays horizontal', async ({
  page,
}) => {
  // Upright viewport without the class: today's layout (sideways loom, side column).
  await openRoute(page, { width: 390, height: 844 }, { portraitUi: false });
  let g = await geometry(page);
  const s = g.nodes.find((n) => n.id === g.startId);
  const b = g.nodes.find((n) => n.id === g.bossId);
  expect(b.x).toBeGreaterThan(s.x);
  expect(b.y).toBeCloseTo(s.y, 0);
  expect(g.scrollW).toBeGreaterThan(g.clientW);
  const side = await page.locator('.re-node-map .re-node-side').boundingBox();
  expect(side.x).toBeGreaterThan(g.view.right - 0.5);

  // The class on a landscape viewport changes nothing either (orientation guard).
  await page.setViewportSize({ width: 844, height: 390 });
  await page.evaluate((type) => {
    document.documentElement.classList.add('portrait-ui');
    window.dispatchEvent(new Event(type));
  }, PORTRAIT_UI_EVENT);
  await expect.poll(async () => (await geometry(page)).clientH).toBeLessThan(390);
  g = await geometry(page);
  const s2 = g.nodes.find((n) => n.id === g.startId);
  const b2 = g.nodes.find((n) => n.id === g.bossId);
  expect(b2.x).toBeGreaterThan(s2.x);
  expect(b2.y).toBeCloseTo(s2.y, 0);
  await expect(page.locator('.re-loom-wrap')).not.toHaveClass(/more-(up|down)/);
});

test('the read-only Campaign Map turns upright too', async ({ page }) => {
  const errors = collectErrors(page);
  await openRoute(page, { width: 390, height: 844 });
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('NodeMap');
    s.registry.set('activeSlot', 1);
    s.showChurchOverlay(s.runManager.nodeMap.nodes[0]);
  });
  const church = page.getByRole('dialog', { name: 'Church', exact: true });
  await church.getByRole('button', { name: 'View map', exact: true }).tap();
  const map = page.getByRole('dialog', { name: 'Campaign map', exact: true });
  await expect(map).toBeVisible();
  await expect(map.locator('.re-node').first()).toBeVisible();
  const g = await geometry(page, '.re-campaign-map');
  expectVertical(g);
  expect(g.scrollW).toBeLessThanOrEqual(g.clientW);
  expect(g.pageW).toBeLessThanOrEqual(g.innerW);
  // Its card sits under the loom, and the map still only inspects.
  const card = await map.locator('.re-loom-card').boundingBox();
  expect(card.y).toBeGreaterThanOrEqual(g.view.bottom - 0.5);
  await map.locator('.re-node.is-future').last().tap();
  await expect(map.locator('.re-loom-state')).toHaveText(/^Possible future/);
  await expect(map.getByRole('button', { name: 'Travel', exact: true })).toHaveCount(0);
  await map.getByRole('button', { name: 'Close', exact: true }).tap();
  await expect(map).toHaveCount(0);
  expect(errors).toEqual([]);
});
