// Portrait mode: the list-and-detail screens on an upright phone.
//
// The portrait shell sets `portrait-ui` on <html> while an opted-in phone is held
// upright; these tests opt in, and also set the class themselves and hide the rotate
// prompt for a build without the shell.
// Ways this can fail, one test (or assertion group) each:
//   - a screen still lays out as two ~170px columns, or scrolls the page sideways;
//   - the attribute grid packs three label/value pairs into a narrow pane, so a label
//     runs into its value ("Stre6gMa2c");
//   - tabs break mid-word ("STA / TS") or sit past the right edge with no way to them;
//   - the primary action (Begin Run, Buy, Close, Back) is under 44px or off-screen;
//   - the master -> detail flow strands the player (no Back, Escape closes the whole
//     Compendium, the list forgets where it was) or loses the entry on rotation;
//   - the unit strip loses the selected card off its edge;
//   - any of it leaks into landscape: boxes move at 844x390 or 640x480.
import { test, expect, devices } from '@playwright/test';
import { waitForGame, waitForScene } from './helpers.js';

// A phone: touch, coarse pointer, mobile layout. Each group sets its own viewport.
test.use({ ...devices['iPhone 13'] });

const PORTRAIT_VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 375, height: 667 },
];

/** Upright phone: the shell's class, and no rotate prompt over the menus. */
async function portraitMode(page) {
  await page.addInitScript(() => {
    localStorage.setItem('emblem_rogue_portrait_battles', 'on');
    document.addEventListener('DOMContentLoaded', () => {
      document.documentElement.classList.add('portrait-ui');
      const style = document.createElement('style');
      style.textContent = '#rotate-prompt{display:none!important}';
      document.head.append(style);
    });
  });
}

/** Layout facts measured in the page (fonts settled first). */
async function measure(page, fn, arg) {
  await page.evaluate(() => document.fonts.ready);
  return page.evaluate(fn, arg);
}

async function expectNoSidewaysScroll(page, rootSelector) {
  const fit = await measure(
    page,
    (sel) => {
      const root = document.querySelector(sel);
      return {
        page: document.documentElement.scrollWidth - innerWidth,
        body: document.body.scrollWidth - innerWidth,
        root: root ? root.scrollWidth - root.clientWidth : 0,
        right: root ? root.getBoundingClientRect().right - innerWidth : 0,
      };
    },
    rootSelector,
  );
  expect(fit.page).toBeLessThanOrEqual(0);
  expect(fit.body).toBeLessThanOrEqual(0);
  expect(fit.root).toBeLessThanOrEqual(1);
  expect(fit.right).toBeLessThanOrEqual(0.5);
}

/** Every button in `selector`: one text line, whole label visible, inside the viewport. */
async function expectTabsOnOneLineAndVisible(page, selector, expectedCount) {
  const tabs = await measure(
    page,
    (sel) =>
      [...document.querySelectorAll(sel)].map((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        const lineTops = new Set(
          [...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top)),
        );
        const r = el.getBoundingClientRect();
        return {
          label: el.textContent,
          lines: lineTops.size,
          clipped: el.scrollWidth > el.clientWidth + 1,
          left: r.left,
          right: r.right,
          top: r.top,
          bottom: r.bottom,
          vw: innerWidth,
          vh: innerHeight,
        };
      }),
    selector,
  );
  expect(tabs.length).toBe(expectedCount);
  for (const tab of tabs) {
    expect(tab.lines, `${tab.label} wraps`).toBe(1);
    expect(tab.clipped, `${tab.label} is clipped`).toBe(false);
    expect(tab.left, `${tab.label} starts off-screen`).toBeGreaterThanOrEqual(0);
    expect(tab.right, `${tab.label} ends off-screen`).toBeLessThanOrEqual(tab.vw + 0.5);
    expect(tab.bottom, `${tab.label} below the fold`).toBeLessThanOrEqual(tab.vh);
  }
}

/** A thumb-sized control fully on screen. */
async function expectReachable(locator) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  const vp = locator.page().viewportSize();
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(vp.width + 0.5);
  expect(box.y + box.height).toBeLessThanOrEqual(vp.height + 0.5);
}

/** List above a full-width detail (not two narrow columns side by side). */
async function expectStacked(page, listSel, detailSel) {
  const [list, detail] = await measure(
    page,
    (sels) =>
      sels.map((s) => {
        const r = document.querySelector(s).getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width };
      }),
    [listSel, detailSel],
  );
  const vw = page.viewportSize().width;
  expect(list.bottom).toBeLessThanOrEqual(detail.top + 0.5);
  expect(list.width).toBeGreaterThanOrEqual(vw * 0.88);
  expect(detail.width).toBeGreaterThanOrEqual(vw * 0.88);
}

/**
 * The attribute grid: no label or value text runs into another's, and each label's
 * text stays left of its own value.
 */
async function expectStatGridReadable(page) {
  const grid = await measure(page, () => {
    const g = document.querySelector('.mr-stats');
    const text = (el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const r = range.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, label: el.textContent };
    };
    const dts = [...g.querySelectorAll('dt')].map(text);
    const dds = [...g.querySelectorAll('dd')].map(text);
    const box = g.getBoundingClientRect();
    return { dts, dds, box: { left: box.left, right: box.right } };
  });
  expect(grid.dts.length).toBe(9);
  expect(grid.dds.length).toBe(9);
  const all = [...grid.dts, ...grid.dds];
  for (let i = 0; i < all.length; i++)
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i];
      const b = all[j];
      const overlap =
        Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 &&
        Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;
      expect(overlap, `"${a.label}" overlaps "${b.label}"`).toBe(false);
    }
  grid.dts.forEach((dt, i) => {
    expect(dt.right, `${dt.label} runs into its value`).toBeLessThanOrEqual(grid.dds[i].left);
    expect(dt.left).toBeGreaterThanOrEqual(grid.box.left);
    expect(grid.dds[i].right).toBeLessThanOrEqual(grid.box.right);
  });
  // Two label/value pairs per row: the first and third labels share a left edge.
  expect(Math.abs(grid.dts[0].left - grid.dts[2].left)).toBeLessThanOrEqual(1);
  expect(grid.dts[2].top).toBeGreaterThan(grid.dts[0].top);
}

async function openHome(page) {
  await page.goto('/?devScene=homebase&preset=weapon_arts');
  await waitForGame(page);
  await waitForScene(page, 'HomeBase');
  await expect(page.getByRole('dialog', { name: 'Home base', exact: true })).toBeVisible();
}

async function openRoster(page) {
  await page.goto('/?devScene=nodemap&preset=weapon_arts&seed=42');
  await waitForGame(page);
  await waitForScene(page, 'NodeMap');
  await page.evaluate(() => window.__emblemRogueGame.scene.getScene('NodeMap')._openRoster());
  const sheet = page.getByRole('dialog', { name: 'Manage roster' });
  await expect(sheet).toBeVisible();
  return sheet;
}

async function openRouteMap(page) {
  await page.goto('/?devScene=nodemap&preset=battle_smoke&seed=42');
  await waitForGame(page);
  await waitForScene(page, 'NodeMap');
  await page.getByRole('button', { name: 'Skip conversation', exact: true }).tap();
  await expect(page.locator('.re-node-map')).toBeVisible();
}

async function openTitleReference(page, action) {
  await page.goto('/');
  await waitForGame(page);
  await waitForScene(page, 'Title');
  await page.evaluate(
    (id) => window.__emblemRogueGame.scene.getScene('Title')._runAction(id),
    action,
  );
}

for (const viewport of PORTRAIT_VIEWPORTS) {
  const size = `${viewport.width}x${viewport.height}`;
  test.describe(`portrait ${size}`, () => {
    test.use({ viewport });
    test.beforeEach(async ({ page }) => portraitMode(page));

    test('home base: stacked lords over a detail with Begin Run in reach', async ({ page }) => {
      await openHome(page);
      await expectNoSidewaysScroll(page, '.mh-screen');
      await expectTabsOnOneLineAndVisible(page, '.mh-screen .mu-tabs button', 4);
      await expectStacked(page, '.mh-screen .mu-list', '.mh-screen .mu-detail');
      // The court (7 lords) sits two to a row; any card the list scrolls to is whole,
      // and scrolling the list never pushes Begin Run off screen.
      const lords = page.locator('.mh-lord');
      await expect(lords).toHaveCount(7);
      expect(await lords.evaluateAll((cards) => new Set(cards.map((c) => c.offsetTop)).size)).toBe(
        4,
      );
      for (const card of await lords.all()) {
        await card.scrollIntoViewIfNeeded();
        // (0.95: sub-pixel rounding at the list's scrolled edge)
        await expect(card).toBeInViewport({ ratio: 0.95 });
      }
      await expectReachable(page.getByRole('button', { name: 'Begin Run', exact: true }));
      await expectReachable(page.getByRole('button', { name: 'Upgrades', exact: true }));

      // Skills tab keeps the same frame and the same reachable action.
      await page.locator('[data-focus="skills"]').tap();
      await expect(page.locator('[data-focus="skills"]')).toHaveAttribute('aria-pressed', 'true');
      await expectNoSidewaysScroll(page, '.mh-screen');
      await expectReachable(page.getByRole('button', { name: 'Begin Run', exact: true }));
      await page.screenshot({ path: test.info().outputPath(`home-${size}.png`) });

      await page.getByRole('button', { name: 'Begin Run', exact: true }).tap();
      await waitForScene(page, 'DifficultySelect');
    });

    test('army upgrades: every category visible, Buy in reach and working', async ({ page }) => {
      await openHome(page);
      await page.getByRole('button', { name: 'Upgrades', exact: true }).tap();
      const menu = page.getByRole('dialog', { name: 'Army upgrades', exact: true });
      await expect(menu).toBeVisible();
      await expectNoSidewaysScroll(page, '.mu-upgrades');
      await expectTabsOnOneLineAndVisible(page, '.mu-upgrades .mu-tabs button', 6);
      await expectTabsOnOneLineAndVisible(page, '.mu-upgrades .mu-header button', 1);
      await expectStacked(page, '.mu-upgrades .mu-list', '.mu-upgrades .mu-detail');

      const row = menu.locator('.mu-row').nth(1);
      const name = await row.locator('strong').innerText();
      await row.tap();
      await expect(menu.locator('.mu-detail h2')).toHaveText(name);
      const buy = menu.locator('.mu-buy');
      await expectReachable(buy);
      await buy.tap();
      await expect(menu.getByRole('status')).toContainText(`${name}: tier 1 purchased.`);
      await page.screenshot({ path: test.info().outputPath(`upgrades-${size}.png`) });
      await menu.getByRole('button', { name: 'Home base', exact: true }).tap();
      await expect(page.getByRole('dialog', { name: 'Home base', exact: true })).toBeVisible();
    });

    test('roster: unit strip over a full-width detail, readable stats', async ({ page }) => {
      const sheet = await openRoster(page);
      await expectNoSidewaysScroll(page, '.mr-sheet');
      await expectTabsOnOneLineAndVisible(page, '.mr-tabs button', 4);
      await expectReachable(sheet.getByRole('button', { name: 'Close', exact: true }));
      await expectStacked(page, '.mr-units', '.mr-content');
      await expectStatGridReadable(page);

      // A real tap opens the other unit's details.
      const cards = sheet.getByRole('navigation', { name: 'Units' }).getByRole('button');
      await expect(cards).toHaveCount(2);
      const second = await cards.nth(1).locator('strong').innerText();
      await cards.nth(1).tap();
      await expect(cards.nth(1)).toHaveAttribute('aria-pressed', 'true');
      await expect(sheet.locator('.mr-summary h3')).toContainText(second);
      await expectStatGridReadable(page);
      await sheet.getByRole('button', { name: 'Equipment', exact: true }).tap();
      await expect(sheet.getByRole('heading', { name: /^Equipment/ })).toBeVisible();
      await expectNoSidewaysScroll(page, '.mr-sheet');
      await page.screenshot({ path: test.info().outputPath(`roster-${size}.png`) });
      await sheet.getByRole('button', { name: 'Close', exact: true }).tap();
      await expect(sheet).toHaveCount(0);
    });

    test('roster strip scrolls sideways and keeps the chosen unit in view', async ({ page }) => {
      const sheet = await openRoster(page);
      await page.evaluate(() => {
        const overlay = window.__emblemRogueGame.scene.getScene('NodeMap').rosterOverlay;
        const units = overlay.runManager.roster;
        const first = units[0];
        for (let i = 0; i < 14; i++)
          units.push({ ...first, name: `A very long traveling companion name ${i}` });
        overlay._mobileSheet.index = 12;
        overlay._mobileSheet.render();
      });
      const strip = sheet.locator('.mr-units');
      const layout = await measure(page, () => {
        const s = document.querySelector('.mr-units');
        const sel = s.querySelector('[aria-pressed="true"]').getBoundingClientRect();
        const box = s.getBoundingClientRect();
        return {
          scrolls: s.scrollWidth > s.clientWidth,
          scrollLeft: s.scrollLeft,
          selLeft: sel.left,
          selRight: sel.right,
          left: box.left,
          right: box.right,
          height: box.height,
        };
      });
      expect(layout.scrolls).toBe(true);
      expect(layout.scrollLeft).toBeGreaterThan(0);
      expect(layout.selLeft).toBeGreaterThanOrEqual(layout.left - 0.5);
      expect(layout.selRight).toBeLessThanOrEqual(layout.right + 0.5);
      // A strip, not a column: it leaves the detail most of the screen.
      expect(layout.height).toBeLessThan(page.viewportSize().height * 0.2);
      await expect(sheet.locator('.mr-summary h3')).toContainText('companion name 10');
      await expectNoSidewaysScroll(page, '.mr-sheet');
      // A tap on another card already in view re-renders without moving the strip.
      const before = await strip.evaluate((s) => s.scrollLeft);
      const other = await strip.evaluate((s) => {
        const box = s.getBoundingClientRect();
        return [...s.querySelectorAll('.mr-unit-card[aria-pressed="false"]')].findIndex((c) => {
          const r = c.getBoundingClientRect();
          return r.left >= box.left && r.right <= box.right - 24;
        });
      });
      expect(other).toBeGreaterThanOrEqual(0);
      const neighbour = sheet.locator('.mr-unit-card[aria-pressed="false"]').nth(other);
      const name = await neighbour.locator('strong').innerText();
      await neighbour.tap();
      await expect(sheet.locator('.mr-summary h3')).toContainText(name);
      await expect(sheet.locator('.mr-unit-card[aria-pressed="true"]')).toContainText(name);
      expect(Math.abs((await strip.evaluate((s) => s.scrollLeft)) - before)).toBeLessThanOrEqual(1);
    });

    test('compendium: list, then a full-width entry with Back', async ({ page }) => {
      await openTitleReference(page, 'compendium');
      const dialog = page.getByRole('dialog', { name: 'Compendium', exact: true });
      await expect(dialog).toBeVisible();
      await expectNoSidewaysScroll(page, '.re-reference');
      const search = dialog.getByRole('searchbox');
      await expectReachable(search);
      expect((await search.boundingBox()).width).toBeGreaterThanOrEqual(
        page.viewportSize().width * 0.8,
      );
      const tabCount = await dialog.locator('nav[aria-label="Categories"] .re-btn').count();
      await expectTabsOnOneLineAndVisible(page, 'nav[aria-label="Categories"] .re-btn', tabCount);
      const filterCount = await dialog.locator('nav[aria-label="Filters"] .re-btn').count();
      await expectTabsOnOneLineAndVisible(page, 'nav[aria-label="Filters"] .re-btn', filterCount);
      // The list has the screen; the detail waits for a tap.
      await expect(dialog.locator('.re-reference-detail')).toHaveCount(0);
      const list = dialog.locator('[aria-label="Entries"]');
      expect((await list.boundingBox()).width).toBeGreaterThanOrEqual(
        page.viewportSize().width * 0.88,
      );

      // Scroll the list, open an entry low in it.
      await list.evaluate((el) => (el.scrollTop = 200));
      const entry = dialog.locator('[data-focus="entry-6"]');
      const name = await entry.locator('strong').innerText();
      await entry.tap();
      const detail = dialog.locator('.re-reference-detail');
      await expect(detail.getByRole('heading', { name, exact: true })).toBeVisible();
      await expect(list).toHaveCount(0);
      expect((await detail.boundingBox()).width).toBeGreaterThanOrEqual(
        page.viewportSize().width * 0.88,
      );
      const back = dialog.getByRole('button', { name: 'Back to list', exact: true });
      await expectReachable(back);
      await expect(back).toBeFocused();
      await expectReachable(dialog.getByRole('button', { name: 'Scroll details down' }));
      await expectNoSidewaysScroll(page, '.re-reference');
      await page.screenshot({ path: test.info().outputPath(`compendium-entry-${size}.png`) });

      // Back returns to the list where it was, on the entry that was open.
      await back.tap();
      await expect(dialog.locator('.re-reference-detail')).toHaveCount(0);
      await expect(entry).toBeFocused();
      await expect(entry).toHaveAttribute('aria-pressed', 'true');
      expect(await list.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);

      // Escape from an entry goes back a step; from the list it closes.
      await entry.tap();
      await expect(back).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(dialog).toBeVisible();
      await expect(entry).toBeFocused();
      // Searching over an open entry shows the results list.
      await entry.tap();
      await dialog.getByRole('searchbox').fill('Silver');
      await expect(dialog.locator('.re-reference-detail')).toHaveCount(0);
      await expect(dialog.getByRole('button', { name: /Silver Sword/ })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
    });

    test('how to play and help read as paragraphs with a reachable Back', async ({ page }) => {
      await openTitleReference(page, 'howToPlay');
      const guide = page.getByRole('dialog', { name: 'How to play', exact: true });
      await guide.getByRole('button', { name: 'Combat Basics' }).tap();
      // The canvas-era line breaks are rejoined: one sentence, one paragraph.
      await expect(
        guide.locator('.re-reference-detail p', {
          hasText: /^Battles are fought on a grid\. Your turn: move units, then attack or wait\.$/,
        }),
      ).toHaveCount(1);
      // List rows (indented) keep their own lines.
      await expect(
        guide.locator('.re-reference-detail p', { hasText: /^\s*Sword > Axe > Lance > Sword$/ }),
      ).toHaveCount(1);
      await expectReachable(guide.getByRole('button', { name: 'Back to list', exact: true }));
      await expectNoSidewaysScroll(page, '.re-reference');
      await page.screenshot({ path: test.info().outputPath(`how-to-play-${size}.png`) });
      await guide.getByRole('button', { name: 'Close', exact: true }).tap();
      await expect(guide).toHaveCount(0);

      await page.evaluate(() =>
        window.__emblemRogueGame.scene.getScene('Title')._runAction('moreInfo'),
      );
      const help = page.getByRole('dialog', { name: 'Help', exact: true });
      const count = await help.locator('nav[aria-label="Categories"] .re-btn').count();
      expect(count).toBeGreaterThan(6);
      await expectTabsOnOneLineAndVisible(page, 'nav[aria-label="Categories"] .re-btn', count);
      // The last category is on screen and a tap away.
      await help.locator('nav[aria-label="Categories"] .re-btn').last().tap();
      await expect(help.locator('nav[aria-label="Categories"] .re-btn').last()).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await help.locator('[data-focus="entry-0"]').tap();
      await expectReachable(help.getByRole('button', { name: 'Back to list', exact: true }));
      await expectNoSidewaysScroll(page, '.re-reference');
    });

    test('battle: enemy details and the rewards roster use the upright sheet', async ({ page }) => {
      await page.goto('/?devScene=battle&preset=battle_smoke&seed=42');
      await waitForGame(page);
      await waitForScene(page, 'Battle');
      await page.waitForFunction(() => window.__sceneState?.battle?.state === 'PLAYER_IDLE');
      await page.evaluate(() => {
        const s = window.__emblemRogueGame.scene.getScene('Battle');
        const e = s.enemyUnits[0];
        s.unitDetailOverlay.show(e, s.gameData.terrain[s.grid.mapLayout[e.row][e.col]], s.gameData);
      });
      const inspect = page.getByRole('dialog', { name: 'Inspect roster' });
      await expect(inspect).toBeVisible();
      await expectTabsOnOneLineAndVisible(page, '.mr-tabs button', 3);
      await expectStatGridReadable(page);
      await expectNoSidewaysScroll(page, '.mr-sheet');
      await page.screenshot({ path: test.info().outputPath(`enemy-${size}.png`) });
      await inspect.getByRole('button', { name: 'Close', exact: true }).tap();
      await expect(inspect).toHaveCount(0);

      await page.evaluate(() => window.__emblemRogueGame.scene.getScene('Battle').onVictory());
      const rewards = page.getByRole('dialog', { name: 'Battle rewards', exact: true });
      await expect(rewards).toBeVisible();
      await rewards.locator('[data-focus="Roster"]').tap();
      const sheet = page.getByRole('dialog', { name: 'Manage roster' });
      await expect(sheet).toBeVisible();
      await expectTabsOnOneLineAndVisible(page, '.mr-tabs button', 4);
      await expectStatGridReadable(page);
      await expectNoSidewaysScroll(page, '.mr-sheet');
      await sheet.getByRole('button', { name: 'Close', exact: true }).tap();
      await expect(sheet).toHaveCount(0);
      await expect(rewards).toBeVisible();
    });

    test('route map header keeps the whole act title', async ({ page }) => {
      await openRouteMap(page);
      const title = page.locator('.re-loom-title');
      await expect(title).toHaveAttribute('aria-label', 'Act II · Old Kingdom Roads');
      const fit = await title.evaluate((el) => ({
        overflow: el.scrollWidth - el.clientWidth,
        right: el.getBoundingClientRect().right,
        vw: innerWidth,
      }));
      expect(fit.overflow).toBeLessThanOrEqual(0);
      expect(fit.right).toBeLessThanOrEqual(fit.vw);
      await expect(page.locator('.re-loom-gold')).toBeInViewport({ ratio: 1 });
    });
  });
}

test.describe('portrait rotation', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test.beforeEach(async ({ page }) => portraitMode(page));

  test('turning a Compendium entry sideways keeps it open beside its list', async ({ page }) => {
    await openTitleReference(page, 'compendium');
    const dialog = page.getByRole('dialog', { name: 'Compendium', exact: true });
    const entry = dialog.locator('[data-focus="entry-3"]');
    const name = await entry.locator('strong').innerText();
    await entry.tap();
    await expect(dialog.getByRole('button', { name: 'Back to list' })).toBeVisible();
    // The shell drops the class and announces it when the phone turns.
    await page.setViewportSize({ width: 844, height: 390 });
    await page.evaluate(() => {
      document.documentElement.classList.remove('portrait-ui');
      window.dispatchEvent(
        new CustomEvent('emblem-rogue:portrait-ui', { detail: { active: false } }),
      );
    });
    await expect(dialog.getByRole('button', { name: 'Back to list' })).toHaveCount(0);
    await expect(dialog.locator('[aria-label="Entries"]')).toBeVisible();
    await expect(entry).toHaveAttribute('aria-pressed', 'true');
    await expect(
      dialog.locator('.re-reference-detail').getByRole('heading', { name, exact: true }),
    ).toBeVisible();
  });
});

// ── Landscape stays as it was ──
// Column geometry measured on main before this change (x, width; font-independent).
const LANDSCAPE_PINS = {
  '844x390': {
    home: { '.mu-list': [12, 405], '.mu-detail': [427, 405] },
    upgrades: { '.mu-list': [12, 405], '.mu-detail': [427, 405] },
    roster: { '.mr-units': [12, 188.6], '.mr-pane': [212.6, 619.4] },
    compendium: { '.re-menu': [12, 405], '.re-reference-detail': [427, 405] },
  },
  '640x480': {
    home: { '.mu-list': [12, 295.6], '.mu-detail': [317.6, 310.4] },
    upgrades: { '.mu-list': [12, 295.6], '.mu-detail': [317.6, 310.4] },
    roster: { '.mr-units': [12, 170], '.mr-pane': [190, 438] },
    compendium: { '.re-menu': [12, 303], '.re-reference-detail': [325, 303] },
  },
};
const KEY_BOXES = {
  home: [
    '.mu-header',
    '.mu-tabs',
    '.mu-tabs button',
    '.mu-list',
    '.mu-detail',
    '.mh-lord',
    '.mu-buy',
  ],
  upgrades: ['.mu-header', '.mu-currency', '.mu-tabs button', '.mu-list', '.mu-detail', '.mu-buy'],
  roster: [
    '.mr-sheet > header',
    '.mr-tabs button',
    '.mr-units',
    '.mr-unit-card',
    '.mr-pane',
    '.mr-stats dt',
    '.mr-stats dd',
  ],
  compendium: [
    '.re-header',
    '.re-search',
    '.re-tabs .re-btn',
    '.re-menu',
    '.re-row',
    '.re-reference-detail',
    '.re-footer .re-btn',
  ],
  map: ['.re-loom-header', '.re-loom-heading', '.re-loom-meta'],
};

function boxesOf(page, selectors) {
  return page.evaluate(
    (sels) =>
      Object.fromEntries(
        sels.map((s) => [
          s,
          [...document.querySelectorAll(s)].slice(0, 16).map((el) => {
            const r = el.getBoundingClientRect();
            return [r.x, r.y, r.width, r.height];
          }),
        ]),
      ),
    selectors,
  );
}

/** The portrait class alone (announced, as the shell would) must not move anything here. */
async function expectClassInert(page, screen) {
  await page.evaluate(() => document.fonts.ready);
  const without = await boxesOf(page, KEY_BOXES[screen]);
  const buttonsWithout = await page.locator('button:visible').count();
  await page.evaluate(() => {
    document.documentElement.classList.add('portrait-ui');
    window.dispatchEvent(new CustomEvent('emblem-rogue:portrait-ui', { detail: { active: true } }));
  });
  const withClass = await boxesOf(page, KEY_BOXES[screen]);
  expect(await page.locator('button:visible').count()).toBe(buttonsWithout);
  for (const sel of KEY_BOXES[screen]) {
    expect(withClass[sel].length, `${screen} ${sel} count`).toBe(without[sel].length);
    withClass[sel].forEach((box, i) =>
      box.forEach((v, k) =>
        expect(Math.abs(v - without[sel][i][k]), `${screen} ${sel}[${i}]`).toBeLessThanOrEqual(1),
      ),
    );
  }
  await page.evaluate(() => {
    document.documentElement.classList.remove('portrait-ui');
    window.dispatchEvent(
      new CustomEvent('emblem-rogue:portrait-ui', { detail: { active: false } }),
    );
  });
}

async function expectPins(page, size, screen) {
  const boxes = await boxesOf(page, Object.keys(LANDSCAPE_PINS[size][screen]));
  for (const [sel, [x, width]] of Object.entries(LANDSCAPE_PINS[size][screen])) {
    expect(Math.abs(boxes[sel][0][0] - x), `${screen} ${sel} x`).toBeLessThanOrEqual(1);
    expect(Math.abs(boxes[sel][0][2] - width), `${screen} ${sel} width`).toBeLessThanOrEqual(1);
  }
}

for (const [width, height] of [
  [844, 390],
  [640, 480],
]) {
  const size = `${width}x${height}`;
  test.describe(`landscape ${size} unchanged`, () => {
    test.use({ viewport: { width, height } });

    test('home base and upgrades', async ({ page }) => {
      await openHome(page);
      await expectPins(page, size, 'home');
      await expectClassInert(page, 'home');
      await page.getByRole('button', { name: 'Upgrades', exact: true }).tap();
      await expect(page.getByRole('dialog', { name: 'Army upgrades' })).toBeVisible();
      await expectPins(page, size, 'upgrades');
      await expectClassInert(page, 'upgrades');
    });

    test('roster', async ({ page }) => {
      await openRoster(page);
      await expectPins(page, size, 'roster');
      await expectClassInert(page, 'roster');
    });

    test('compendium keeps list and detail side by side', async ({ page }) => {
      await openTitleReference(page, 'compendium');
      const dialog = page.getByRole('dialog', { name: 'Compendium', exact: true });
      const entry = dialog.locator('[data-focus="entry-1"]');
      await entry.tap();
      // Landscape never goes master -> detail: the list stays, focus stays on it.
      await expect(entry).toBeFocused();
      await expect(dialog.getByRole('button', { name: 'Back to list' })).toHaveCount(0);
      await expectPins(page, size, 'compendium');
      await expectClassInert(page, 'compendium');
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
    });

    test('route map header', async ({ page }) => {
      await openRouteMap(page);
      await expectClassInert(page, 'map');
    });
  });
}
