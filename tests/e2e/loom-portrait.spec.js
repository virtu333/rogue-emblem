import { test, expect, devices } from '@playwright/test';
import { waitForScene, collectErrors } from './helpers.js';
import {
  PORTRAIT_PHONES,
  DESKTOPS,
  LANDSCAPE_PHONES,
  NOTCH_PORTRAIT,
  clippedText,
  emulateSafeArea,
  expectInsideSafeArea,
  expectNoSidewaysScroll,
  expectPortraitUi,
  expectSingleLine,
  expectTappable,
  phone,
  quietSettings,
} from './portraitHelpers.js';

// The upright Loom (html.portrait-ui on an upright phone): the act climbs from the
// party's first knot at the bottom to the Hollow Sun at the top, scrolls vertically,
// and the side pane becomes a bottom sheet (card, Travel, Menu/Roster, lord chips).
// The portrait shell sets the class for a real opt-in (the stored preference, a touch
// screen, upright), so the spec opts in; it also sets the class itself and hides the
// legacy rotate prompt for a build without the shell.
test.use({ ...devices['iPhone 13'] });

const PORTRAIT_UI_EVENT = 'emblem-rogue:portrait-ui';

async function openRoute(page, viewport, { portraitUi = true } = {}) {
  await page.setViewportSize(viewport);
  await page.addInitScript((on) => {
    // Portrait mode is on by default on a phone: "without it" means turned off.
    localStorage.setItem('emblem_rogue_portrait_battles', on ? 'on' : 'off');
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

// Whether a whole act fits above the sheet depends on the header's height (the act
// title may take a line of its own): a tall phone fits it, a short one scrolls, and in
// between either is right as long as the loom says which it is doing.
for (const { fit, ...viewport } of [
  { width: 430, height: 932, fit: 'fits' },
  { width: 390, height: 844, fit: 'either' },
  { width: 375, height: 667, fit: 'scrolls' },
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

    const fits = g.scrollH <= g.clientH + 1;
    if (fit !== 'either')
      expect(fits, `${fit} at ${viewport.width}x${viewport.height}`).toBe(fit === 'fits');
    if (fits) {
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

// ── The upright sheet at its fullest (portrait mode's real default path) ─────────
// A touch phone held upright, no opt-in, no forced class; the phone's notch and home
// bar emulated. Ways the upright route map can fail, one test (or group) each:
//   1. the header's Eclipse (a 44 px target) covers the subline or the gold, or the
//      header runs under the notch;
//   2. Travel (or Menu, Roster, a lord) is under the home bar, covered, under 44 px or
//      inside the card's scroll; the page scrolls sideways; a lord's name or HP is cut;
//   3. a card longer than its height is cut with no sign of more (the recruit's
//      stats, the state line), or cannot be scrolled to its last line;
//   4. another knot's card opens scrolled down (its Talk line hidden), or an opened
//      captain's note stays below the fold;
//   5. Tab visits the sheet out of the order it reads (upright and sideways);
//   6. a lord row does not open the roster on that lord;
//   7. the Eclipse's fall line covers the header or the sheet;
//   8. the Campaign Map's Close leaves the title's row, or its subline overlaps itself
//      or cuts "ROW 2 OF 9";
//   9. the ruins' chosen line or "Return to ruins" does not fit;
//  10. any of it moves a box on a landscape phone or a desktop.

/** phone() for a describe group (a device's browser type may only be set per file). */
function uprightPhone(viewport) {
  // eslint-disable-next-line no-unused-vars
  const { defaultBrowserType, ...context } = phone(viewport);
  return context;
}

/** The real route map on an upright phone, with the notch and home bar emulated. */
async function openUprightRoute(page, { preset = 'battle_smoke', notch = true } = {}) {
  await quietSettings(page);
  await page.goto(`/?devScene=nodemap&preset=${preset}&seed=42`);
  await waitForScene(page, 'NodeMap');
  if (notch) expect(await emulateSafeArea(page, NOTCH_PORTRAIT)).toBe(true);
  await expectPortraitUi(page);
  const skip = page.getByRole('button', { name: 'Skip conversation', exact: true });
  await skip.tap();
  await expect(skip).toHaveCount(0);
  const route = page.locator('.re-node-map');
  await expect(route.locator('.re-loom--vertical .re-node').first()).toBeVisible();
  return route;
}

/**
 * The fullest route sheet in the data: the recruit knot of seed 42's act II (Talk
 * line, Hunters and Captain chips, the recruit's stats, growths and traits) waiting
 * for the longest recruit name, and the two longest lord names at 99/99 HP.
 */
async function fullestSheet(page) {
  const id = await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('NodeMap');
    const rm = s.runManager;
    const node = rm.nodeMap.nodes.find((n) => n.type === 'recruit' && !n.completed && !n.eclipse);
    const build = rm.getRecruitNodeUnit.bind(rm);
    rm.getRecruitNodeUnit = (n) => {
      const built = build(n);
      if (built?.unit) built.unit.name = 'Constance';
      return built;
    };
    const lords = rm.roster.filter((u) => u.isLord);
    ['Astrid', 'Rowan'].forEach((name, i) => {
      if (!lords[i]) return;
      lords[i].name = name;
      lords[i].stats.HP = 99;
      lords[i].currentHP = 99;
    });
    s.nodeView.render();
    return node.id;
  });
  const knot = page.locator(`.re-node[data-node="${id}"]`);
  await knot.scrollIntoViewIfNeeded();
  await knot.tap();
  await expect(knot).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.re-node-map .re-loom-recruit')).toHaveAttribute(
    'data-recruit',
    'Constance',
  );
  return id;
}

/**
 * Cut text in the sheet. A phone's lord chip keeps " HP" for screen readers only
 * (visually hidden in a 1 px box, loom.css): that is intended, not clipped.
 */
async function sheetClippedText(page) {
  return (await clippedText(page, '.re-node-map .re-node-side')).filter((c) => c.text !== 'HP');
}

/** Text boxes (a range's rect, so a wide box's empty end does not count). */
function textBox(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const range = document.createRange();
    range.selectNodeContents(el);
    return range.getBoundingClientRect().toJSON();
  }, selector);
}

const intersects = (a, b) =>
  Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 &&
  Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;

for (const viewport of PORTRAIT_PHONES) {
  const size = `${viewport.width}x${viewport.height}`;
  test.describe(`upright ${size}, notch and home bar`, () => {
    test.use(uprightPhone(viewport));

    test('the fullest sheet fits: header clear, controls whole, the card scrolls with a cue', async ({
      page,
    }, info) => {
      const errors = collectErrors(page);
      const route = await openUprightRoute(page);
      await fullestSheet(page);

      // 1. The header: every line clears the notch and none sits under the Eclipse.
      await expectInsideSafeArea(
        page,
        '.re-node-map :is(.re-loom-title, .re-loom-sub, .re-loom-gold, .re-loom-diff, .re-eclipse-medal)',
      );
      const medal = (await route.locator('.re-eclipse-medal').boundingBox()) || null;
      expect(medal, 'the Eclipse is in the header').not.toBeNull();
      const medalBox = {
        left: medal.x,
        right: medal.x + medal.width,
        top: medal.y,
        bottom: medal.y + medal.height,
      };
      for (const sel of ['.re-loom-title', '.re-loom-sub', '.re-loom-gold', '.re-loom-diff']) {
        const box = await textBox(page, `.re-node-map ${sel}`);
        expect(intersects(box, medalBox), `the Eclipse covers ${sel}`).toBe(false);
      }
      await expect(route.locator('.re-loom-title')).toHaveAttribute(
        'aria-label',
        'Act II · Old Kingdom Roads',
      );
      await expectSingleLine(route.locator('.re-loom-sub-part'));
      await expectTappable(route.locator('.re-eclipse-medal'));
      expect(await clippedText(page, '.re-node-map .re-loom-header')).toEqual([]);

      // 2. The sheet's controls: whole, uncovered, thumb-sized, above the home bar;
      //    Travel never inside a scrolling body.
      await expectInsideSafeArea(page, '.re-node-map .re-node-side > *');
      const sheet = route.getByRole('complementary', { name: 'Route actions' });
      for (const name of ['Travel', 'Menu', 'Roster'])
        await expectTappable(sheet.getByRole('button', { name, exact: true }));
      for (const lord of await sheet.locator('.re-node-unit').all()) await expectTappable(lord);
      await expect(sheet.locator('.re-node-unit strong > span')).toHaveText(['Astrid', 'Rowan']);
      await expect(sheet.locator('.re-node-unit > span > small')).toHaveText([
        /^99\/99/,
        /^99\/99/,
      ]);
      expect(await sheetClippedText(page)).toEqual([]);
      expect(
        await route
          .locator('.re-loom-travel')
          .evaluate((el) => !el.closest('.re-scroll, .re-node-scroll')),
        'Travel is outside every scrolling body',
      ).toBe(true);
      await expectNoSidewaysScroll(page, '.re-node-map');
      await expectNoSidewaysScroll(page, '.re-node-map .re-loom-card');

      // 3. The recruit's card is longer than the sheet allows: it leads with the Talk
      //    line, says there is more, scrolls to its last line, then says so no more.
      const card = route.locator('.re-loom-card');
      const facts = () =>
        card.evaluate((el) => {
          const box = el.getBoundingClientRect();
          const inside = (child) => {
            const r = child.getBoundingClientRect();
            return r.top >= box.top - 0.5 && r.bottom <= box.bottom + 0.5;
          };
          // The last line the card shows (flex order puts the flavour after the state).
          const lines = [...el.children].filter((c) => getComputedStyle(c).display !== 'none');
          const last = lines.reduce((a, b) =>
            b.getBoundingClientRect().bottom > a.getBoundingClientRect().bottom ? b : a,
          );
          return {
            scrolls: getComputedStyle(el).overflowY === 'auto',
            more: el.scrollHeight - el.clientHeight,
            below: el.classList.contains('is-more-below'),
            above: el.classList.contains('is-more-above'),
            talkInView: inside(el.querySelector('.re-loom-text')),
            lastInView: inside(last),
            height: box.height,
          };
        });
      const top = await facts();
      expect(top.scrolls).toBe(true);
      expect(top.more, 'the fullest card is taller than its box').toBeGreaterThan(20);
      expect(top).toMatchObject({ below: true, above: false, talkInView: true });
      await card.evaluate((el) => (el.scrollTop = el.scrollHeight));
      await expect(card).not.toHaveClass(/is-more-below/);
      await expect(card).toHaveClass(/is-more-above/);
      expect((await facts()).lastInView, 'the last line reads whole at the bottom').toBe(true);
      await page.screenshot({ path: info.outputPath(`route-fullest-${size}.png`) });

      // Selecting a shorter card never resizes the loom above it.
      const loomHeight = () => route.locator('.re-node-scroll').evaluate((el) => el.clientHeight);
      const before = await loomHeight();
      const live = route.locator('.re-node.is-live').first();
      await live.tap();
      await expect(route.locator('.re-loom-state')).toHaveText('Within reach · the next knot');
      expect(await loomHeight()).toBe(before);
      expect((await facts()).height).toBe(top.height);
      await expectTappable(route.getByRole('button', { name: 'Travel', exact: true }));
      await page.screenshot({ path: info.outputPath(`route-battle-${size}.png`) });
      expect(errors).toEqual([]);
    });
  });
}

test.describe('upright 375x667: the card follows the knot', () => {
  test.use(uprightPhone(PORTRAIT_PHONES[0]));

  test('another knot opens at its top; an opened captain note scrolls into view', async ({
    page,
  }) => {
    const errors = collectErrors(page);
    const route = await openUprightRoute(page);
    const id = await fullestSheet(page);
    const card = route.locator('.re-loom-card');
    const inCard = (sel) =>
      card.evaluate((el, s) => {
        const box = el.getBoundingClientRect();
        const r = el.querySelector(s).getBoundingClientRect();
        return r.top >= box.top - 0.5 && r.bottom <= box.bottom + 0.5;
      }, sel);

    // 4a. Read one recruit's card to the bottom, then look at the act's other recruit
    //     (as long a card): it opens at its top, on its Talk line.
    const other = await page.evaluate((first) => {
      const rm = window.__emblemRogueGame.scene.getScene('NodeMap').runManager;
      return rm.nodeMap.nodes.find(
        (n) => n.type === 'recruit' && !n.completed && !n.eclipse && n.id !== first,
      )?.id;
    }, id);
    expect(other, "seed 42's act II has a second recruit knot").toBeTruthy();
    await card.evaluate((el) => (el.scrollTop = el.scrollHeight));
    expect(await card.evaluate((el) => el.scrollTop)).toBeGreaterThan(20);
    const knot = route.locator(`.re-node[data-node="${other}"]`);
    await knot.scrollIntoViewIfNeeded();
    await knot.tap();
    await expect(knot).toHaveAttribute('aria-pressed', 'true');
    expect(await card.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeGreaterThan(20);
    expect(await card.evaluate((el) => el.scrollTop)).toBe(0);
    expect(await inCard('.re-loom-text'), 'the Talk line leads the card').toBe(true);
    // Back on the first recruit, at its top too.
    await route.locator(`.re-node[data-node="${id}"]`).scrollIntoViewIfNeeded();
    await route.locator(`.re-node[data-node="${id}"]`).tap();
    expect(await card.evaluate((el) => el.scrollTop)).toBe(0);

    // 4b. The captain's note opens below the fold: the card brings it into view, and
    //     the chip that opened it stays in view. The chip answers a whole thumb.
    const captain = card.locator('.re-loom-tag', { hasText: 'Captain' });
    const summary = captain.locator('summary');
    const hit = await summary.boundingBox();
    expect(hit.height, 'the chip is a 44 px target').toBeGreaterThanOrEqual(43.5);
    await summary.tap();
    await expect(captain.locator('p')).toContainText('an affix');
    await expect.poll(() => inCard('.re-loom-tag details[open] p')).toBe(true);
    expect(await inCard('.re-loom-tag details[open] summary')).toBe(true);
    // Clear of the faded foot too: the note's bottom is above the fade (40 px).
    const clear = await card.evaluate((el) => {
      const box = el.getBoundingClientRect();
      const note = el.querySelector('.re-loom-tag details[open] p').getBoundingClientRect();
      return el.classList.contains('is-more-below') ? box.bottom - note.bottom : 40;
    });
    expect(clear).toBeGreaterThanOrEqual(39);
    expect(errors).toEqual([]);
  });
});

/**
 * Tab from the loom's last knot through the sheet: the order focus takes, and the
 * same controls in reading order (row by row, top to bottom, left to right).
 */
async function sheetTabOrder(page) {
  await page.locator('.re-node-map .re-node').last().focus();
  const visited = [];
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    const inSheet = await page.evaluate(() => {
      const el = document.activeElement;
      const side = document.querySelector('.re-node-map .re-node-side');
      if (!side?.contains(el)) return null;
      el.dataset.tabProbe ||= String(Math.random()).slice(2);
      return el.dataset.tabProbe;
    });
    if (!inSheet) break;
    visited.push(inSheet);
  }
  const reading = await page.evaluate((ids) => {
    const els = ids.map((id) => document.querySelector(`[data-tab-probe="${id}"]`));
    const boxes = els.map((el, i) => ({ id: ids[i], r: el.getBoundingClientRect() }));
    // Rows: two controls share a row when each one's middle lies within the other's
    // height (a tall card below a short button is a row of its own, whatever the
    // platform's font metrics). Rows run top to bottom, controls left to right.
    const mid = (b) => (b.r.top + b.r.bottom) / 2;
    const within = (b, of) => mid(b) > of.r.top && mid(b) < of.r.bottom;
    const rows = [];
    for (const b of [...boxes].sort((x, y) => x.r.top - y.r.top)) {
      const row = rows.find((r) => r.every((o) => within(b, o) && within(o, b)));
      if (row) row.push(b);
      else rows.push([b]);
    }
    return rows.flatMap((r) => r.sort((x, y) => x.r.left - y.r.left)).map((b) => b.id);
  }, visited);
  const labels = await page.evaluate(
    (ids) =>
      ids.map((id) => {
        const el = document.querySelector(`[data-tab-probe="${id}"]`);
        const name = el.matches('.re-node-unit')
          ? el.querySelector('strong > span')?.textContent
          : el.getAttribute('aria-label') || el.textContent;
        return (name || el.className).trim();
      }),
    visited,
  );
  return { visited, reading, labels };
}

test.describe('upright 390x844: keyboard order and lords', () => {
  test.use(uprightPhone(PORTRAIT_PHONES[1]));

  test('Tab walks the sheet in the order it reads, upright and sideways', async ({ page }) => {
    const errors = collectErrors(page);
    const route = await openUprightRoute(page, { notch: false });
    await route.locator('.re-node.is-live').first().tap();
    const travel = route.getByRole('button', { name: 'Travel', exact: true });
    await expect(travel).toBeEnabled();

    // 5. Upright: the card, Travel, then Menu, Roster and the lords.
    let order = await sheetTabOrder(page);
    expect(order.labels.slice(-5)).toEqual(['Travel', 'Menu', 'Roster', 'Edric', 'Sera']);
    expect(order.visited).toEqual(order.reading);

    // Sideways (the shell drops portrait-ui on the turn): Menu and Roster lead again.
    await travel.focus();
    await page.setViewportSize({ width: 844, height: 390 });
    await expectPortraitUi(page, false);
    await expect(travel).toBeFocused();
    order = await sheetTabOrder(page);
    expect(order.labels.slice(0, 2)).toEqual(['Menu', 'Roster']);
    expect(order.labels.slice(-3)).toEqual(['Travel', 'Edric', 'Sera']);
    expect(order.visited).toEqual(order.reading);

    // And upright again, focus kept on a control that moved.
    const menu = route.getByRole('button', { name: 'Menu', exact: true });
    await menu.focus();
    await page.setViewportSize(PORTRAIT_PHONES[1]);
    await expectPortraitUi(page);
    await expect(menu).toBeFocused();
    order = await sheetTabOrder(page);
    expect(order.labels.slice(-5)).toEqual(['Travel', 'Menu', 'Roster', 'Edric', 'Sera']);
    expect(errors).toEqual([]);
  });

  test('a lord row opens the roster on that lord', async ({ page }) => {
    const errors = collectErrors(page);
    const route = await openUprightRoute(page);
    const lords = route.locator('.re-node-unit');
    await expect(lords).toHaveCount(2);
    const second = (await lords.nth(1).locator('strong > span').innerText()).trim();
    await expectTappable(lords.nth(1));
    await lords.nth(1).tap();
    const sheet = page.getByRole('dialog', { name: 'Manage roster' });
    await expect(sheet).toBeVisible();
    await expect(sheet.locator('.mr-unit-card[aria-pressed="true"]')).toContainText(second);
    await sheet.getByRole('button', { name: 'Close', exact: true }).tap();
    await expect(sheet).toHaveCount(0);
    await expect(route).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test.describe('upright 375x667: the Eclipse, the Campaign Map and the ruins', () => {
  test.use(uprightPhone(PORTRAIT_PHONES[0]));

  test("the Eclipse's fall line reads over the loom's head, and its card opens and closes", async ({
    page,
  }) => {
    const errors = collectErrors(page);
    const route = await openUprightRoute(page, { preset: 'eclipse' });
    // 7. The fall ceremony plays once the loom is visible; its line names the loss.
    const toast = page.locator('.re-eclipse-toast');
    await expect(toast).toContainText(/^The dark takes the /, { timeout: 10_000 });
    const boxes = await page.evaluate(() => {
      const r = (sel) => document.querySelector(sel).getBoundingClientRect().toJSON();
      return {
        toast: r('.re-eclipse-toast'),
        loom: r('.re-node-map .re-node-scroll'),
        header: r('.re-node-map .re-loom-header'),
        sheet: r('.re-node-map .re-node-side'),
      };
    });
    const inside = (a, b) =>
      a.left >= b.left - 0.5 &&
      a.right <= b.right + 0.5 &&
      a.top >= b.top - 0.5 &&
      a.bottom <= b.bottom + 0.5;
    expect(inside(boxes.toast, boxes.loom), 'the fall line lies over the loom').toBe(true);
    expect(intersects(boxes.toast, boxes.header)).toBe(false);
    expect(intersects(boxes.toast, boxes.sheet)).toBe(false);
    // Near the loom's head, where the fallen knots are.
    expect(boxes.toast.top - boxes.loom.top).toBeLessThan(boxes.loom.height / 3);
    await expect(toast).toHaveCSS('white-space', 'normal');

    const medal = route.locator('.re-eclipse-medal');
    await medal.tap();
    const card = page.getByRole('dialog', { name: 'The Eclipse', exact: true });
    await expect(card).toBeVisible();
    await expectInsideSafeArea(page, '.re-eclipse-card .re-header > *');
    await expectTappable(card.getByRole('button', { name: 'Close', exact: true }));
    await expectNoSidewaysScroll(page, '.re-eclipse-card');
    await card.getByRole('button', { name: 'Close', exact: true }).tap();
    await expect(card).toHaveCount(0);
    await expect(medal).toBeFocused();
    expect(errors).toEqual([]);
  });

  test('the Campaign Map keeps Close beside the act title and its subline whole', async ({
    page,
  }, info) => {
    const errors = collectErrors(page);
    await openUprightRoute(page);
    await page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('NodeMap');
      s.registry.set('activeSlot', 1);
      s.showChurchOverlay(s.runManager.nodeMap.nodes[0]);
    });
    const church = page.getByRole('dialog', { name: 'Church', exact: true });
    await church.getByRole('button', { name: 'View map', exact: true }).tap();
    const map = page.getByRole('dialog', { name: 'Campaign map', exact: true });
    await expect(map.locator('.re-loom--vertical .re-node').first()).toBeVisible();

    // 8. Close shares the title's row; the subline wraps between its parts only.
    const close = map.getByRole('button', { name: 'Close', exact: true });
    await expectTappable(close);
    const title = await textBox(page, '.re-campaign-map .re-loom-title');
    const closeBox = await close.boundingBox();
    expect(closeBox.y, 'Close sits on the title row').toBeLessThan(title.bottom);
    expect(closeBox.x).toBeGreaterThanOrEqual(title.right);
    await expect(map.locator('.re-loom-sub')).toHaveText(
      'CAMPAIGN MAP · OCCUPIED TERRITORY · ROW 2 OF 9',
    );
    await expectSingleLine(map.locator('.re-loom-sub-part'));
    const parts = await map
      .locator('.re-loom-sub-part')
      .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON()));
    // The pixel font fills its whole line box: wrapped lines need a visible gap.
    const lineTops = [...new Set(parts.map((r) => Math.round(r.top)))].sort((a, b) => a - b);
    expect(lineTops.length, 'the long subline wraps at 375 px').toBeGreaterThan(1);
    for (let i = 0; i < parts.length; i++)
      for (let j = i + 1; j < parts.length; j++) {
        const [a, b] = parts[i].top <= parts[j].top ? [parts[i], parts[j]] : [parts[j], parts[i]];
        if (Math.round(a.top) === Math.round(b.top)) continue;
        expect(b.top - a.bottom, `subline lines ${i} and ${j} touch`).toBeGreaterThanOrEqual(2);
      }
    expect(await clippedText(page, '.re-campaign-map .re-loom-header')).toEqual([]);

    // The party's knot says where the party is; the card and the note clear the home bar.
    await expect(map.locator('.re-node.is-current')).toHaveAttribute('aria-label', /You are here/);
    await expectInsideSafeArea(
      page,
      '.re-campaign-map :is(.re-loom-header, .re-campaign-side > *)',
    );
    await expectNoSidewaysScroll(page, '.re-campaign-map');
    await page.screenshot({ path: info.outputPath('campaign-map-375x667.png') });
    await close.tap();
    await expect(map).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("the ruins' chosen line and Return to ruins fit the sheet", async ({ page }) => {
    const errors = collectErrors(page);
    const route = await openUprightRoute(page);
    // The party stands on the ruins after choosing to scavenge there.
    await page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('NodeMap');
      const rm = s.runManager;
      const ruins = rm.nodeMap.nodes.find((n) => n.type === 'ruins');
      rm.ruinsChoiceByNodeId = { ...(rm.ruinsChoiceByNodeId || {}), [ruins.id]: 'scavenge' };
      ruins.completed = true;
      rm.currentNodeId = ruins.id;
      s.nodeView.selected = ruins.id;
      s.nodeView.render();
    });
    const card = route.locator('.re-loom-card');
    const chosen = card.locator('.re-loom-text');
    // 9. The chosen path reads whole without scrolling, the way back is a thumb away.
    await expect(chosen).toHaveText('You chose to scavenge here. No rest tonight.');
    expect(
      await card.evaluate((el) => {
        const box = el.getBoundingClientRect();
        const r = el.querySelector('.re-loom-text').getBoundingClientRect();
        return el.scrollTop === 0 && r.top >= box.top && r.bottom <= box.bottom;
      }),
    ).toBe(true);
    const back = route.getByRole('button', { name: 'Return to ruins', exact: true });
    await expectTappable(back);
    await expectSingleLine(back.locator('span'));
    expect(await sheetClippedText(page)).toEqual([]);
    expect(errors).toEqual([]);
  });
});

// ── Landscape phones and desktops: unchanged ─────────────────────────────────────
// Boxes (x, y, width, height) measured before this change on the same flows; each
// must sit exactly there (±1 px). Heights that follow body text (the lord chips on a
// desktop, the campaign card above its note) are left out, so a system font cannot
// move them. The sideways pane keeps its reading order: Menu/Roster, card, Travel, lords.
const SIDEWAYS_PINS = {
  '568x320': {
    header: [12, 10, 544, 36],
    loom: [12, 52, 350, 258],
    side: [372, 52, 184, 258],
    actions: [372, 52, 184, 44],
    card: [372, 102, 184, 106],
    travel: [372, 214, 184, 46],
    map: [12, 58, 350, 252],
    mapSide: [372, 58, 184, 252],
    mapCard: [372, 58, 184],
  },
  '667x375': {
    header: [12, 10, 643, 36],
    loom: [12, 52, 449, 313],
    side: [471, 52, 184, 313],
    actions: [471, 52, 184, 44],
    card: [471, 102, 184, 161],
    travel: [471, 269, 184, 46],
    map: [12, 58, 449, 307],
    mapSide: [471, 58, 184, 307],
    mapCard: [471, 58, 184],
  },
  '844x390': {
    header: [12, 10, 820, 36],
    loom: [12, 52, 606, 328],
    side: [628, 52, 204, 328],
    actions: [628, 52, 204, 44],
    card: [628, 102, 204, 176],
    travel: [628, 284, 204, 46],
    map: [12, 62, 606, 318],
    mapSide: [628, 62, 204, 318],
    mapCard: [628, 62, 204],
  },
  '640x480': {
    header: [12, 10, 616, 36],
    loom: [12, 52, 422, 418],
    side: [444, 52, 184, 418],
    actions: [444, 52, 184, 44],
    card: [444, 102, 184],
    travel: [444, null, 184, 46],
    map: [12, 62, 422, 408],
    mapSide: [444, 62, 184, 408],
    mapCard: [444, 62, 184],
  },
  '1280x800': {
    header: [12, 10, 1256, 36],
    loom: [12, 52, 1015.6, 738],
    side: [1037.6, 52, 230.4, 738],
    actions: [1037.6, 52, 230.4, 44],
    card: [1037.6, 102, 230.4],
    travel: [1037.6, null, 230.4, 46],
    map: [90, 62, 859.6, 728],
    mapSide: [959.6, 62, 230.4, 728],
    mapCard: [959.6, 62, 230.4],
  },
};
const PIN_SELECTORS = {
  header: '.re-node-map .re-loom-header',
  loom: '.re-node-map .re-node-scroll',
  side: '.re-node-map .re-node-side',
  actions: '.re-node-map .re-node-actions',
  card: '.re-node-map .re-loom-card',
  travel: '.re-node-map .re-loom-travel',
  map: '.re-campaign-map .re-node-scroll',
  mapSide: '.re-campaign-map .re-campaign-side',
  mapCard: '.re-campaign-map .re-loom-card',
};

async function expectPinned(page, size, keys) {
  await page.evaluate(() => document.fonts.ready);
  for (const key of keys) {
    const box = await page.locator(PIN_SELECTORS[key]).boundingBox();
    const got = [box.x, box.y, box.width, box.height];
    SIDEWAYS_PINS[size][key].forEach((want, i) => {
      if (want == null) return;
      expect(
        Math.abs(got[i] - want),
        `${size} ${key}[${i}] ${got[i]} vs ${want}`,
      ).toBeLessThanOrEqual(1);
    });
  }
}

for (const viewport of [...LANDSCAPE_PHONES, ...DESKTOPS]) {
  const size = `${viewport.width}x${viewport.height}`;
  const touch = LANDSCAPE_PHONES.includes(viewport);
  test.describe(`sideways ${size} unchanged`, () => {
    if (touch) test.use(uprightPhone(viewport));
    else
      test.use({
        viewport,
        hasTouch: false,
        isMobile: false,
        deviceScaleFactor: 1,
        userAgent: undefined,
      });

    test('route pane and Campaign Map sit where they did', async ({ page }) => {
      const errors = collectErrors(page);
      await quietSettings(page);
      await page.goto('/?devScene=nodemap&preset=battle_smoke&seed=42');
      await waitForScene(page, 'NodeMap');
      await expectPortraitUi(page, false);
      await page.getByRole('button', { name: 'Skip conversation', exact: true }).click();
      const route = page.locator('.re-node-map');
      await expect(route.locator('.re-node').first()).toBeVisible();
      await expectPinned(page, size, ['header', 'loom', 'side', 'actions', 'card', 'travel']);
      // The fullest card changes nothing around it, and the pane keeps its order.
      const id = await page.evaluate(
        () =>
          window.__emblemRogueGame.scene
            .getScene('NodeMap')
            .runManager.nodeMap.nodes.find((n) => n.type === 'recruit' && !n.completed).id,
      );
      await route.locator(`.re-node[data-node="${id}"]`).click();
      await expect(route.locator('.re-loom-recruit')).toBeVisible();
      await expectPinned(page, size, ['side', 'actions', 'card', 'travel']);
      expect(
        await route
          .locator('.re-node-side')
          .evaluate((el) =>
            [...el.children].map((c) =>
              ['re-node-actions', 're-loom-card', 're-loom-travel', 're-loom-party'].find((k) =>
                c.classList.contains(k),
              ),
            ),
          ),
      ).toEqual(['re-node-actions', 're-loom-card', 're-loom-travel', 're-loom-party']);
      // The sideways card keeps its authored order (flavour before the state line).
      expect(
        await route.locator('.re-loom-card').evaluate((el) => getComputedStyle(el).display),
      ).toBe('block');

      await page.evaluate(() => {
        const s = window.__emblemRogueGame.scene.getScene('NodeMap');
        s.registry.set('activeSlot', 1);
        s.showChurchOverlay(s.runManager.nodeMap.nodes[0]);
      });
      await page
        .getByRole('dialog', { name: 'Church', exact: true })
        .getByRole('button', { name: 'View map', exact: true })
        .click();
      await expect(page.locator('.re-campaign-map .re-node').first()).toBeVisible();
      await expectPinned(page, size, ['map', 'mapSide', 'mapCard']);
      expect(errors).toEqual([]);
    });
  });
}
