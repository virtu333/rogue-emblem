// Portrait mode: the screens around the run on an upright phone (title, save slots,
// auth gate, boot loader, Army upgrades, Home base after a run, Compendium / Help /
// How to play, Settings, Pause, Run records). Real default path: a touch phone whose
// screen matches the viewport, so portrait mode is on by default (portraitHelpers).
//
// Ways these screens can fail upright, one test (or assertion group) each:
//   1. the title keeps its landscape layout squeezed: a 184px column top-left, the
//      guides in a corner, the lockup under the corner buttons or the notch;
//   2. the title art is cover-cropped to a sliver (~135 plate px), or its Hollow Sun
//      lands under the lockup, or the figure is hidden behind the menu;
//   3. focus order stops following what the player sees;
//   4. three save slots do not fit a short phone, or, when they cannot, the list is
//      cut with no cue and a slot's action cannot be reached;
//   5. the auth gate's sun sits under the subtitle (a narrow cover crop);
//   6. boot loading / failure text or actions run off the side of an upright phone;
//   7. Army upgrades leave the list one or two rows (the detail takes the screen), the
//      effect's Next value is cut, or Buy / Refund are out of reach;
//   8. an upgrade that waits on another looks buyable in the list (#139 backlog);
//   9. Home base after a finished run is not usable upright;
//  10. Compendium filters and categories take half the screen; a tab past the edge
//      cannot be reached or gives no cue; the chosen tab drops out of view;
//  11. a Help category with one page costs an extra tap; How to play shows a
//      pointless one-tab strip;
//  12. an item entry loses its picture float or keyword chips upright;
//  13. Settings keeps an inset frame under the notch, its long list is cut with no
//      cue, or the Portrait mode note is long;
//  14. Pause actions scroll or fall under the notch / home bar; Settings from Pause
//      does not return to it;
//  15. many run records strand Close or Back;
//  16. any of it leaks into landscape phones or desktop.
import { test, expect } from '@playwright/test';
import { waitForGame, waitForScene } from './helpers.js';
import {
  PORTRAIT_PHONES,
  phone,
  quietSettings,
  emulateSafeArea,
  expectPortraitUi,
  expectNoSidewaysScroll,
  expectTappable,
  expectSingleLine,
  clippedText,
  expectInsideSafeArea,
  pageErrors,
} from './portraitHelpers.js';

/** phone() for a describe group (a group cannot switch the browser type). */
function upright(viewport) {
  // eslint-disable-next-line no-unused-vars
  const { defaultBrowserType, ...context } = phone(viewport);
  return context;
}

const sizeOf = (vp) => `${vp.width}x${vp.height}`;
const SE = PORTRAIT_PHONES[0];
const PORTRAIT_MODE_NOTE = 'Hold the phone upright to play. Off: the game stays sideways.';

/** Rect helpers evaluated in the page. */
function boxes(page, selector) {
  return page.evaluate(
    (sel) =>
      [...document.querySelectorAll(sel)]
        .filter((el) => el.getClientRects().length)
        .map((el) => {
          const r = el.getBoundingClientRect();
          return {
            label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40),
            left: r.left,
            right: r.right,
            top: r.top,
            bottom: r.bottom,
            width: r.width,
            height: r.height,
          };
        }),
    selector,
  );
}

const overlaps = (a, b, slack = 0.5) =>
  a.left < b.right - slack &&
  b.left < a.right - slack &&
  a.top < b.bottom - slack &&
  b.top < a.bottom - slack;

async function openTitle(page, store = { emblem_rogue_slot_1_meta: '{}' }) {
  await quietSettings(page);
  await page.addInitScript((entries) => {
    for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, value);
  }, store);
  await page.goto('/?devScene=title');
  await waitForScene(page, 'Title');
  await expect(page.locator('.re-title-art.re-keyart-ready canvas')).toHaveCount(1);
  await page.evaluate(() => document.fonts.ready);
}

/**
 * The title art as drawn: the visible plate width, the Hollow Sun's disc and the
 * figure's feet in viewport px (from the art module's own anchors for this variant).
 */
function titleArt(page) {
  return page.evaluate(async () => {
    const { plateToView } = await import('/src/art/keyart/keyArtBackdrop.js');
    const { createHollowSunScene } = await import('/src/art/keyart/hollowSun.js');
    const { TITLE_ART_ANCHORS } = await import('/src/ui/TitleScreen.js');
    const view = window.__emblemRogueGame.scene.getScene('Title').titleView;
    const variant = view.root.dataset.variant;
    const scene = createHollowSunScene({ seed: 7, variant, reducedMotion: true });
    const { sun, figure } = scene.anchors;
    scene.destroy();
    const { frame, dpr } = view.backdrop;
    const art = view.art.getBoundingClientRect();
    const at = (x, y) => {
      const p = plateToView(frame, x, y, dpr);
      return { x: art.left + p.x, y: art.top + p.y };
    };
    const c = at(sun.x, sun.y);
    const r = (sun.r * frame.scale) / dpr;
    const lockup = view.lockup.getBoundingClientRect();
    const run = view.root.querySelector('.re-title-run').getBoundingClientRect();
    return {
      variant,
      integer: frame.integer,
      visibleWidth: (art.width * dpr) / frame.scale,
      art: { left: art.left, right: art.right, top: art.top, bottom: art.bottom },
      sun: { left: c.x - r, right: c.x + r, top: c.y - r, bottom: c.y + r },
      feet: at(figure.x, figure.y),
      lockup: { left: lockup.left, right: lockup.right, top: lockup.top, bottom: lockup.bottom },
      runTop: run.top,
      table: { sun: TITLE_ART_ANCHORS.sun[variant], figure: TITLE_ART_ANCHORS.figure },
      module: { sun, figure },
      vw: innerWidth,
    };
  });
}

// ── 1-3. Title ──────────────────────────────────────────────────────────────
for (const vp of PORTRAIT_PHONES) {
  test.describe(`title upright ${sizeOf(vp)}`, () => {
    test.use(upright(vp));

    test('one column: lockup, full-width run plates, guides, Settings, clear of the notch', async ({
      page,
    }, info) => {
      const errors = pageErrors(page);
      await openTitle(page);
      await emulateSafeArea(page);
      await expectPortraitUi(page);
      await expectNoSidewaysScroll(page, '.re-title');
      await expectInsideSafeArea(page, '.re-title button, .re-keyart-lockup, .re-title-foot');
      const content = vp.width - 32;
      const run = page.getByRole('group', { name: 'Play' }).getByRole('button');
      await expect(run).toHaveText([/New Game/, /Save Slots/, /Tutorial/]);
      for (const b of await run.all()) {
        await expectTappable(b);
        expect((await b.boundingBox()).width, 'a full-width run plate').toBeGreaterThan(
          content * 0.95,
        );
      }
      const guides = page.getByRole('group', { name: 'Guides and records' }).getByRole('button');
      const guideBoxes = [];
      for (const b of await guides.all()) {
        await expectTappable(b);
        guideBoxes.push(await b.boundingBox());
      }
      // Two by two under the run plates.
      expect(new Set(guideBoxes.map((b) => Math.round(b.x))).size).toBe(2);
      expect(new Set(guideBoxes.map((b) => Math.round(b.y))).size).toBe(2);
      const lastRun = await run.last().boundingBox();
      for (const b of guideBoxes) expect(b.y).toBeGreaterThan(lastRun.y + lastRun.height - 0.5);
      await expectTappable(page.getByRole('button', { name: 'Settings', exact: true }));
      await expectSingleLine(page.locator('.re-title-label'));
      // Nothing overlaps the lockup or another control.
      const all = [
        ...(await boxes(page, '.re-keyart-lockup')),
        ...(await boxes(page, '.re-title button')),
      ];
      for (let i = 0; i < all.length; i++)
        for (let j = i + 1; j < all.length; j++)
          expect(overlaps(all[i], all[j]), `${all[i].label} / ${all[j].label}`).toBe(false);
      await page.screenshot({ path: info.outputPath(`title-${sizeOf(vp)}.png`) });
      expect(errors).toEqual([]);
    });

    for (const [variant, store] of [
      ['dusk', { emblem_rogue_slot_1_meta: '{}' }],
      ['rising', { emblem_rogue_slot_2_meta: JSON.stringify({ milestones: ['beatGame'] }) }],
      [
        'ashfall',
        { emblem_rogue_slot_2_meta: JSON.stringify({ milestones: ['beatGame', 'beatHard'] }) },
      ],
    ])
      test(`${variant}: the art band reads, the sun clear of the lockup, the figure above the menu`, async ({
        page,
      }) => {
        await openTitle(page, store);
        await emulateSafeArea(page);
        const art = await titleArt(page);
        expect(art.variant).toBe(variant);
        // The layout's plate anchors are the art module's own.
        expect(art.table).toEqual({
          sun: { x: art.module.sun.x, y: art.module.sun.y, r: art.module.sun.r },
          figure: { x: art.module.figure.x, y: art.module.figure.y },
        });
        expect(art.integer).toBe(true);
        // Covering the screen showed ~135 plate px; the band shows far more of the plate.
        expect(art.visibleWidth).toBeGreaterThanOrEqual(214);
        // The disc: whole on screen, never under the lockup.
        expect(art.sun.left).toBeGreaterThanOrEqual(-0.5);
        expect(art.sun.right).toBeLessThanOrEqual(art.vw + 0.5);
        expect(art.sun.top).toBeGreaterThanOrEqual(-0.5);
        expect(overlaps(art.sun, art.lockup, 0), 'the sun clears the lockup').toBe(false);
        // The lone figure stands in view, above the first run plate.
        expect(art.feet.x).toBeGreaterThan(0);
        expect(art.feet.x).toBeLessThan(art.vw);
        expect(art.feet.y).toBeLessThan(art.runTop);
        // The band rests on the menu (no gap of bare ink between them).
        expect(art.art.bottom).toBeGreaterThanOrEqual(art.runTop);
      });

    test('focus follows the column top to bottom', async ({ page }) => {
      await openTitle(page);
      const order = await page.evaluate(() =>
        [...document.querySelectorAll('.re-title button')]
          .filter((b) => b.getClientRects().length)
          .map((b) => {
            const r = b.getBoundingClientRect();
            return { label: b.textContent.trim(), top: Math.round(r.top), left: r.left };
          }),
      );
      for (let i = 1; i < order.length; i++) {
        const [a, b] = [order[i - 1], order[i]];
        const reads = b.top > a.top || (b.top === a.top && b.left > a.left);
        expect(reads, `${a.label} before ${b.label}`).toBe(true);
      }
      await expect(page.getByRole('button', { name: 'New Game', exact: true })).toBeFocused();
      await page.keyboard.press('ArrowDown');
      await expect(page.getByRole('button', { name: 'Save Slots', exact: true })).toBeFocused();
    });
  });
}

// ── 4. Save slots ───────────────────────────────────────────────────────────
/**
 * Save slots through the real scene, one card per entry of `kinds`: 'battle' (a run
 * suspended mid-battle in Act II), 'home' (between runs) or 'empty'.
 */
async function openSlots(page, kinds) {
  await quietSettings(page);
  await page.goto('/?devScene=battle&preset=battle_smoke&seed=42');
  await waitForScene(page, 'Battle');
  await page.evaluate(async (kinds) => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const { getMetaKey, getRunKey } = await import('/src/engine/SlotManager.js');
    const run = s.runManager.toJSON();
    kinds.forEach((kind, i) => {
      const slot = i + 1;
      localStorage.removeItem(getMetaKey(slot));
      localStorage.removeItem(getRunKey(slot));
      if (kind === 'empty') return;
      localStorage.setItem(
        getMetaKey(slot),
        JSON.stringify({ runsStarted: 5, runsCompleted: 4, milestones: ['beatAct1'] }),
      );
      if (kind === 'battle')
        localStorage.setItem(
          getRunKey(slot),
          JSON.stringify({
            ...run,
            actIndex: 1,
            completedBattles: 9,
            savedAt: Date.now() - 42 * 60 * 1000,
            battleInProgress: {
              nodeId: null,
              isBoss: false,
              battleParams: { templateId: 'river_crossing' },
              checkpoint: { turn: 3 },
            },
          }),
        );
    });
    const { ensureSceneLoaded } = await import('/src/utils/sceneLoader.js');
    await ensureSceneLoaded(s, 'SlotPicker');
    s.scene.start('SlotPicker', { gameData: s.gameData });
  }, kinds);
  await waitForScene(page, 'SlotPicker');
  const menu = page.getByRole('dialog', { name: 'Select save', exact: true });
  await expect(menu.locator('.sp-card')).toHaveCount(3);
  await page.evaluate(() => document.fonts.ready);
  return menu;
}

for (const vp of PORTRAIT_PHONES) {
  test.describe(`save slots upright ${sizeOf(vp)}`, () => {
    test.use(upright(vp));

    test('a run, a slot between runs and an empty slot fit without scrolling', async ({
      page,
    }, info) => {
      test.setTimeout(90_000);
      const errors = pageErrors(page);
      await emulateSafeArea(page);
      const menu = await openSlots(page, ['battle', 'home', 'empty']);
      await expect(menu).toContainText('An unlit candle');
      const body = menu.locator('.re-menu-body');
      expect(await body.evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
      await expect(body).not.toHaveClass(/is-more-(above|below)/);
      for (const b of await menu.locator('.sp-primary').all()) await expectTappable(b);
      for (const b of await menu.locator('.sp-delete').all()) await expectTappable(b);
      await expectInsideSafeArea(page, '.sp-card, .sp-shrine > .re-header button');
      await expectNoSidewaysScroll(page, '.sp-shrine .re-menu-body');
      await page.screenshot({ path: info.outputPath(`slots-${sizeOf(vp)}.png`) });
      expect(errors).toEqual([]);
    });
  });
}

test.describe('save slots upright, three runs on a short phone', () => {
  test.use(upright(SE));

  test('the list scrolls with a fade on the edge that has more; every slot is reachable', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await emulateSafeArea(page);
    const menu = await openSlots(page, ['battle', 'battle', 'battle']);
    const body = menu.locator('.re-menu-body');
    await expect(body).toHaveClass(/is-more-below/);
    await expect(body).not.toHaveClass(/is-more-above/);
    const mask = () => body.evaluate((el) => getComputedStyle(el).maskImage || '');
    expect(await mask()).toContain('gradient');
    await body.evaluate((el) => (el.scrollTop = el.scrollHeight));
    await expect(body).toHaveClass(/is-more-above/);
    await expect(body).not.toHaveClass(/is-more-below/);
    for (const slot of [1, 2, 3])
      await expectTappable(menu.getByRole('button', { name: `Select Slot ${slot}`, exact: true }));
  });
});

// ── 5. Auth gate ────────────────────────────────────────────────────────────
/**
 * The cloud build's login gate over this page: shown and mounted the way main.js does
 * (the same backdrop helper and portrait anchor), since the dev server has no Supabase.
 */
async function showAuthGate(page) {
  await page.evaluate(async () => {
    const overlay = document.getElementById('auth-overlay');
    overlay.style.display = 'flex';
    overlay.style.zIndex = '100000';
    const { mountKeyArtBackdrop } = await import('/src/art/keyart/keyArtBackdrop.js');
    const canvas = document.createElement('canvas');
    document.getElementById('auth-wrapper').append(canvas);
    window.__authArt = mountKeyArtBackdrop(document.getElementById('auth-wrapper'), {
      canvas,
      variant: 'dusk',
      maxCrop: 1.3,
      anchor: ({ width, height }) => (height > width ? { anchorX: 0.72 } : {}),
    });
  });
  await page.waitForFunction(() => window.__authArt?.ready && window.__authArt.frame);
}

function authLayout(page) {
  return page.evaluate(async () => {
    const { plateToView } = await import('/src/art/keyart/keyArtBackdrop.js');
    const host = document.getElementById('auth-wrapper').getBoundingClientRect();
    const { frame, dpr } = window.__authArt;
    const c = plateToView(frame, 292, 68, dpr);
    const r = (22 * frame.scale) / dpr;
    const lockup = document
      .querySelector('#auth-content .re-keyart-lockup')
      .getBoundingClientRect();
    return {
      host: { width: host.width, height: host.height, top: host.top, bottom: host.bottom },
      sun: {
        left: host.left + c.x - r,
        right: host.left + c.x + r,
        top: host.top + c.y - r,
        bottom: host.top + c.y + r,
      },
      lockup: { left: lockup.left, right: lockup.right, top: lockup.top, bottom: lockup.bottom },
      vw: innerWidth,
      vh: innerHeight,
    };
  });
}

for (const vp of PORTRAIT_PHONES) {
  test.describe(`auth gate upright ${sizeOf(vp)}`, () => {
    test.use(upright(vp));

    test('the key art is a band between the lockup and the form, the sun clear of both', async ({
      page,
    }, info) => {
      await openTitle(page);
      await emulateSafeArea(page);
      await showAuthGate(page);
      const layout = await authLayout(page);
      // A band as wide as the screen, shorter than it is wide.
      expect(layout.host.width).toBe(vp.width);
      expect(layout.host.height).toBeLessThan(layout.host.width);
      expect(overlaps(layout.sun, layout.lockup, 0), 'the sun clears the lockup').toBe(false);
      expect(layout.sun.left).toBeGreaterThanOrEqual(-0.5);
      expect(layout.sun.right).toBeLessThanOrEqual(layout.vw + 0.5);
      for (const name of ['Log In', 'Play offline'])
        await expectTappable(page.getByRole('button', { name, exact: true }));
      await expectInsideSafeArea(
        page,
        '#auth-content .re-keyart-lockup, .auth-panel, .auth-panel button, .auth-panel input',
      );
      await expectNoSidewaysScroll(page);
      await page.screenshot({ path: info.outputPath(`auth-${sizeOf(vp)}.png`) });
    });
  });
}

// ── 6. Boot loader ──────────────────────────────────────────────────────────
test.describe('boot loader upright', () => {
  test.use(upright(SE));

  for (const state of ['stall', 'failure'])
    test(`${state}: text wraps and the actions are whole, clear of the notch`, async ({ page }) => {
      await openTitle(page);
      await emulateSafeArea(page);
      await page.evaluate(async (state) => {
        const { BootLoader } = await import('/src/ui/BootLoader.js');
        const loader = new BootLoader().create();
        loader.setProgress('1,204 of 1,390 files (86%) · 41.2 MB of 48.9 MB');
        loader.warn(
          '3 sounds and 2 portraits could not download; the game continues without them.',
        );
        if (state === 'stall') loader.showStall({ onReload() {}, onSafeReload() {} });
        else
          loader.showFailure({
            message:
              'TypeError: Failed to fetch dynamically imported module: /data/metaUpgrades.json (network changed)',
            onRetry() {},
            onSafeReload() {},
          });
      }, state);
      const loader = page.locator('#boot-loader');
      await expect(loader.locator('.re-boot-panel')).toBeVisible();
      for (const b of await loader.getByRole('button').all()) await expectTappable(b);
      expect(await clippedText(page, '#boot-loader')).toEqual([]);
      await expectInsideSafeArea(page, '#boot-loader p, #boot-loader button');
      await expectNoSidewaysScroll(page, '#boot-loader');
    });
});

// ── 7-9. Army upgrades, Home base ───────────────────────────────────────────
async function openUpgrades(page) {
  await quietSettings(page);
  await page.goto('/?devScene=homebase&preset=weapon_arts');
  await waitForGame(page);
  await waitForScene(page, 'HomeBase');
  await page.getByRole('button', { name: 'Upgrades', exact: true }).tap();
  const menu = page.getByRole('dialog', { name: 'Army upgrades', exact: true });
  await expect(menu).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  return menu;
}

/** Rows whose whole box shows inside the list's scroll box. */
function wholeRows(page) {
  return page.evaluate(() => {
    const list = document.querySelector('.mu-upgrades .mu-list').getBoundingClientRect();
    return [...document.querySelectorAll('.mu-upgrades .mu-row')].filter((row) => {
      const r = row.getBoundingClientRect();
      return r.top >= list.top - 0.5 && r.bottom <= list.bottom + 0.5;
    }).length;
  });
}

for (const vp of PORTRAIT_PHONES) {
  test.describe(`army upgrades upright ${sizeOf(vp)}`, () => {
    test.use(upright(vp));

    test('the list keeps three rows over a compact detail; Next and Buy stay in view', async ({
      page,
    }, info) => {
      const errors = pageErrors(page);
      await emulateSafeArea(page);
      const menu = await openUpgrades(page);
      await expectPortraitUi(page);
      expect(await wholeRows(page)).toBeGreaterThanOrEqual(3);
      // Current and Next both show, on the detail's visible lines.
      const effects = await menu.locator('.mu-effects').evaluate((p) => {
        const copy = p.closest('.mu-copy').getBoundingClientRect();
        return [...p.children].map((span) => {
          const r = span.getBoundingClientRect();
          return {
            text: span.textContent,
            whole: r.top >= copy.top - 0.5 && r.bottom <= copy.bottom + 0.5,
          };
        });
      });
      expect(effects.map((e) => e.text)).toEqual(['Current: None', 'Next: +5%']);
      expect(
        effects.every((e) => e.whole),
        'Current and Next in view',
      ).toBe(true);
      const buy = menu.locator('.mu-buy');
      await expectTappable(buy);
      expect(await buy.evaluate((b) => !!b.closest('.mu-list, .mu-copy'))).toBe(false);
      await expectInsideSafeArea(
        page,
        '.mu-upgrades :is(.mu-header, .mu-tabs, .mu-actions) button, .mu-upgrades .mu-currency',
      );
      await expectNoSidewaysScroll(page, '.mu-upgrades');
      // Buying keeps the row chosen and puts Refund beside Buy, both in reach.
      await buy.tap();
      await expect(menu.getByRole('status')).toContainText('Hardy Recruits: tier 1 purchased.');
      const refund = menu.getByRole('button', { name: 'Refund one tier', exact: true });
      await expectTappable(refund);
      await expectTappable(buy);
      expect(Math.abs((await refund.boundingBox()).y - (await buy.boundingBox()).y)).toBeLessThan(
        1,
      );
      await refund.tap();
      for (const name of ['Confirm refund', 'Keep upgrade'])
        await expectTappable(menu.getByRole('button', { name, exact: true }));
      await page.screenshot({ path: info.outputPath(`upgrades-${sizeOf(vp)}.png`) });
      await menu.getByRole('button', { name: 'Keep upgrade', exact: true }).tap();
      expect(errors).toEqual([]);
    });
  });
}

for (const [label, context] of [
  ['upright 390x844', upright(PORTRAIT_PHONES[1])],
  ['landscape 844x390', upright({ width: 844, height: 390 })],
])
  test.describe(`upgrade prerequisites in the list, ${label}`, () => {
    test.use(context);

    test('a row waiting on another names it before it is opened', async ({ page }) => {
      const menu = await openUpgrades(page);
      const agility = menu.locator('[data-upgrade="recruit_spd_flat"]');
      await agility.scrollIntoViewIfNeeded();
      await expect(agility.locator('.mu-row-needs')).toHaveText('Needs Quick Feet Lv3');
      // The note fits the row: its height matches an ordinary row's.
      const hardy = menu.locator('[data-upgrade="recruit_hp_growth"]');
      const [a, h] = [await agility.boundingBox(), await hardy.boundingBox()];
      expect(Math.abs(a.height - h.height)).toBeLessThanOrEqual(1);
      // Three real purchases of Quick Feet meet the requirement: the note gives way.
      await menu.locator('[data-upgrade="recruit_spd_growth"]').tap();
      for (let tier = 1; tier <= 3; tier++) {
        await menu.locator('.mu-buy').tap();
        await expect(menu.getByRole('status')).toContainText(`Quick Feet: tier ${tier} purchased.`);
      }
      await expect(agility.locator('.mu-row-needs')).toHaveCount(0);
      await expect(agility).toContainText(/Tier 0 \/ \d/);
      await agility.tap();
      await expect(menu.locator('.mu-buy')).toBeEnabled();
    });
  });

test.describe('home base after a finished run, upright', () => {
  test.use(upright(SE));

  test('Run complete → Home Base: the loadout and Begin Run work upright', async ({ page }) => {
    test.setTimeout(90_000);
    const errors = pageErrors(page);
    await quietSettings(page);
    await page.goto('/?devScene=battle&preset=battle_smoke&seed=42');
    await waitForGame(page);
    await waitForScene(page, 'Battle');
    await emulateSafeArea(page);
    await page.evaluate(async () => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      s.registry.set('activeSlot', 1);
      const data = { ...s.gameData, dialogue: { ...s.gameData.dialogue, runComplete: null } };
      const { ensureSceneLoaded } = await import('/src/utils/sceneLoader.js');
      await ensureSceneLoaded(s, 'RunComplete');
      s.scene.start('RunComplete', { gameData: data, runManager: s.runManager, result: 'victory' });
    });
    await waitForScene(page, 'RunComplete');
    const home = page.getByRole('button', { name: 'Home Base', exact: true }).last();
    await expect(home).toBeVisible({ timeout: 15_000 });
    await home.tap();
    await waitForScene(page, 'HomeBase');
    const base = page.getByRole('dialog', { name: 'Home base', exact: true });
    await expect(base).toBeVisible();
    await expectPortraitUi(page);
    await expectNoSidewaysScroll(page, '.mh-screen');
    await expectInsideSafeArea(page, '.mh-screen button:not(.mh-lord)');
    // The upright layout: the lords over a full-width detail, not two narrow columns.
    const [lords, detail] = await Promise.all(
      ['.mh-screen .mu-list', '.mh-screen .mu-detail'].map((s) => page.locator(s).boundingBox()),
    );
    expect(lords.y + lords.height).toBeLessThanOrEqual(detail.y + 0.5);
    expect(detail.width).toBeGreaterThan(SE.width * 0.9);
    const begin = base.getByRole('button', { name: 'Begin Run', exact: true });
    await expectTappable(begin);
    await base.getByRole('button', { name: 'Upgrades', exact: true }).tap();
    await page.getByRole('button', { name: 'Home base', exact: true }).tap();
    await begin.tap();
    await waitForScene(page, 'DifficultySelect');
    expect(errors).toEqual([]);
  });
});

// ── 10-12. Compendium / Help / How to play ──────────────────────────────────
async function openReference(page, action) {
  await openTitle(page);
  await page.evaluate(
    (id) => window.__emblemRogueGame.scene.getScene('Title')._runAction(id),
    action,
  );
  await page.evaluate(() => document.fonts.ready);
}

for (const vp of PORTRAIT_PHONES.slice(0, 2)) {
  test.describe(`compendium upright ${sizeOf(vp)}`, () => {
    test.use(upright(vp));

    test('search, one category strip and one filter strip leave the list most of the screen', async ({
      page,
    }, info) => {
      const errors = pageErrors(page);
      await emulateSafeArea(page);
      await openReference(page, 'compendium');
      const dialog = page.getByRole('dialog', { name: 'Compendium', exact: true });
      const list = dialog.locator('[aria-label="Entries"]');
      await expect(list).toBeVisible();
      const top = (await list.boundingBox()).y;
      expect(top, 'the controls end in the upper half').toBeLessThan(vp.height * 0.45);
      const shown = await list.evaluate((el) => {
        const box = el.getBoundingClientRect();
        return [...el.children].filter((row) => {
          const r = row.getBoundingClientRect();
          return r.top >= box.top - 0.5 && r.bottom <= box.bottom + 0.5;
        }).length;
      });
      expect(shown).toBeGreaterThanOrEqual(5);
      for (const nav of ['Categories', 'Filters']) {
        const rows = await dialog
          .locator(`nav[aria-label="${nav}"] .re-btn`)
          .evaluateAll(
            (els) => new Set(els.map((b) => Math.round(b.getBoundingClientRect().top))).size,
          );
        expect(rows, `${nav}: one row`).toBe(1);
      }
      const search = dialog.getByRole('searchbox');
      await expectTappable(search);
      await expectInsideSafeArea(page, '.re-reference .re-header > *, .re-reference nav');
      await expectNoSidewaysScroll(page, '.re-reference');
      await page.screenshot({ path: info.outputPath(`compendium-${sizeOf(vp)}.png`) });
      await search.fill('Rapier');
      await expect(list.locator('.re-row')).toHaveCount(1);
      expect(errors).toEqual([]);
    });

    test('a strip fades the edge with more, and the chosen tab stays in view', async ({ page }) => {
      await openReference(page, 'compendium');
      const dialog = page.getByRole('dialog', { name: 'Compendium', exact: true });
      const categories = dialog.locator('nav[aria-label="Categories"]');
      await expect(categories).toHaveClass(/is-more-right/);
      await expect(categories).not.toHaveClass(/is-more-left/);
      expect(await categories.evaluate((el) => getComputedStyle(el).maskImage)).toContain(
        'gradient',
      );
      // The last category, past the edge: a swipe away, then chosen and kept in view.
      const last = categories.locator('.re-btn').last();
      await expect(last).toHaveText('Run');
      await last.tap();
      await expect(categories.locator('.re-btn').last()).toHaveAttribute('aria-pressed', 'true');
      await expect(dialog.locator('nav[aria-label="Categories"] .re-btn').last()).toBeInViewport({
        ratio: 1,
      });
      await expect(dialog.locator('nav[aria-label="Categories"]')).toHaveClass(/is-more-left/);
      // The widest filter strip (Arms): its last filter is reachable and stays in view.
      await dialog.locator('nav[aria-label="Categories"] .re-btn', { hasText: 'Arms' }).tap();
      const filters = dialog.locator('nav[aria-label="Filters"]');
      await expect(filters).toHaveClass(/is-more-right/);
      await filters.locator('.re-btn').last().tap();
      await expect(filters.locator('.re-btn').last()).toHaveAttribute('aria-pressed', 'true');
      await expect(dialog.locator('nav[aria-label="Filters"] .re-btn').last()).toBeInViewport({
        ratio: 1,
      });
      await expect(dialog.locator('[aria-label="Entries"] .re-row').first()).toBeVisible();
    });

    test('Back returns to the list with the far category still in view', async ({ page }) => {
      await openReference(page, 'compendium');
      const dialog = page.getByRole('dialog', { name: 'Compendium', exact: true });
      const foes = dialog.locator('nav[aria-label="Categories"] .re-btn', { hasText: 'Foes' });
      await foes.tap();
      const entry = dialog.locator('[data-focus="entry-2"]');
      await entry.tap();
      await expectTappable(dialog.getByRole('button', { name: 'Back to list', exact: true }));
      await page.keyboard.press('Escape');
      await expect(entry).toBeFocused();
      await expect(
        dialog.locator('nav[aria-label="Categories"] .re-btn', { hasText: 'Foes' }),
      ).toBeInViewport({ ratio: 1 });
      await expect(
        dialog.locator('nav[aria-label="Categories"] .re-btn', { hasText: 'Foes' }),
      ).toHaveAttribute('aria-pressed', 'true');
    });

    test('an item entry leads with its picture beside the name, with its rule chips', async ({
      page,
    }) => {
      await openReference(page, 'compendium');
      const dialog = page.getByRole('dialog', { name: 'Compendium', exact: true });
      // Rows carry the item's 32px icon.
      const icon = await dialog.locator('.re-row .ia-icon').first().boundingBox();
      expect(icon.width).toBeGreaterThanOrEqual(32);
      await dialog.getByRole('searchbox').fill('Rapier');
      await dialog.getByRole('button', { name: /^Rapier/ }).tap();
      const detail = dialog.locator('.re-reference-detail');
      const art = await detail.locator('.re-reference-art').boundingBox();
      // The name's text (not its block box, which spans under the float).
      const name = await detail.getByRole('heading', { name: 'Rapier' }).evaluate((h) => {
        const range = document.createRange();
        range.selectNodeContents(h);
        const r = range.getBoundingClientRect();
        return { x: r.left, y: r.top };
      });
      expect(art.width).toBeGreaterThanOrEqual(96);
      expect(name.x, 'the name beside the picture').toBeGreaterThan(art.x + art.width - 0.5);
      expect(name.y).toBeLessThan(art.y + art.height);
      await expect(detail.locator('.re-item-keys .re-item-tag').first()).toBeVisible();
      expect(await clippedText(page, '.re-reference-detail')).toEqual([]);
      await expectNoSidewaysScroll(page, '.re-reference');
    });
  });
}

test.describe('help and how to play upright', () => {
  test.use(upright(SE));

  test('a one-page Help category opens its page in place; longer ones list', async ({ page }) => {
    await openReference(page, 'moreInfo');
    const help = page.getByRole('dialog', { name: 'Help', exact: true });
    const detail = help.locator('.re-reference-detail');
    await expect(detail.getByRole('heading', { name: 'Unit Stats', exact: true })).toBeVisible();
    await expect(help.locator('[aria-label="Entries"]')).toHaveCount(0);
    await expect(help.getByRole('button', { name: 'Back to list' })).toHaveCount(0);
    const tab = (label) => help.locator('nav[aria-label="Categories"] .re-btn', { hasText: label });
    await tab('Combat').tap();
    await expect(help.locator('[aria-label="Entries"] .re-row')).toHaveCount(4);
    await tab('Terrain').tap();
    await expect(
      detail.getByRole('heading', { name: 'Terrain Effects', exact: true }),
    ).toBeVisible();
    await expect(help.locator('[aria-label="Entries"]')).toHaveCount(0);
    // A search still lists its results, even a single one.
    await help.getByRole('searchbox').fill('Promotion');
    await expect(help.locator('[aria-label="Entries"] .re-row').first()).toBeVisible();
    await help.getByRole('searchbox').fill('');
    await page.keyboard.press('Escape');
    await expect(help).toHaveCount(0);
  });

  test('How to play has one category, so no category strip', async ({ page }) => {
    await openReference(page, 'howToPlay');
    const guide = page.getByRole('dialog', { name: 'How to play', exact: true });
    await expect(guide.locator('[aria-label="Entries"] .re-row')).toHaveCount(4);
    await expect(guide.locator('nav[aria-label="Categories"]')).toHaveCount(0);
  });
});

// ── 13-15. Settings, Pause, Run records ─────────────────────────────────────
for (const vp of PORTRAIT_PHONES) {
  test.describe(`settings upright ${sizeOf(vp)}`, () => {
    test.use(upright(vp));

    test('a full-screen sheet: Close in reach, the list fades where it continues', async ({
      page,
    }, info) => {
      await openTitle(page);
      await emulateSafeArea(page);
      await page.getByRole('button', { name: 'Settings', exact: true }).tap();
      const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
      await expect(settings).toBeVisible();
      const box = await settings.boundingBox();
      expect(box).toEqual({ x: 0, y: 0, width: vp.width, height: vp.height });
      await expectTappable(settings.getByRole('button', { name: 'Close', exact: true }));
      await expectInsideSafeArea(page, '.re-settings .re-header > *');
      const list = settings.locator('.re-scroll');
      await expect(list).toHaveClass(/is-more-below/);
      expect(await list.evaluate((el) => getComputedStyle(el).maskImage)).toContain('gradient');
      const toggle = settings.getByRole('button', { name: /^Portrait mode · On$/ });
      await expectTappable(toggle);
      await expect(list).not.toHaveClass(/is-more-below/);
      await expect(toggle.locator('xpath=following-sibling::p[1]')).toHaveText(PORTRAIT_MODE_NOTE);
      await expectNoSidewaysScroll(page, '.re-settings .re-scroll');
      await page.screenshot({ path: info.outputPath(`settings-${sizeOf(vp)}.png`) });
      await settings.getByRole('button', { name: 'Close', exact: true }).tap();
      await expect(settings).toHaveCount(0);
    });
  });
}

async function openBattle(page) {
  await quietSettings(page);
  await page.goto('/?devScene=battle&preset=battle_smoke&seed=42');
  await waitForGame(page);
  await waitForScene(page, 'Battle');
  await page.waitForFunction(() => window.__sceneState?.battle?.state === 'PLAYER_IDLE');
}

for (const vp of PORTRAIT_PHONES.slice(0, 2)) {
  test.describe(`pause upright ${sizeOf(vp)}`, () => {
    test.use(upright(vp));

    test('every action whole without scrolling; Settings returns to Pause; Resume', async ({
      page,
    }) => {
      const errors = pageErrors(page);
      await openBattle(page);
      await emulateSafeArea(page);
      await page.getByRole('button', { name: 'Menu', exact: true }).first().tap();
      const pause = page.getByRole('dialog', { name: 'Paused' });
      await expect(pause).toBeVisible();
      expect(
        await pause.locator('.mp-actions').evaluate((e) => e.scrollHeight <= e.clientHeight + 1),
      ).toBe(true);
      for (const b of await pause.locator('.mp-actions button').all()) await expectTappable(b);
      await expectInsideSafeArea(page, '.mp-panel');
      await pause.getByRole('button', { name: 'Settings', exact: true }).tap();
      const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
      await expect(settings).toBeVisible();
      await settings.getByRole('button', { name: 'Close', exact: true }).tap();
      await expect(settings).toHaveCount(0);
      await expect(pause).toBeVisible();
      await pause.getByRole('button', { name: 'Resume', exact: true }).tap();
      await expect(pause).toBeHidden();
      expect(errors).toEqual([]);
    });
  });
}

test.describe('run records upright', () => {
  test.use(upright(SE));

  test('a full archive scrolls under a fixed Close; a record opens and Back returns', async ({
    page,
  }) => {
    await quietSettings(page);
    await page.addInitScript(() => {
      const runRecords = Array.from({ length: 60 }, (_, i) => ({
        id: `win-${i}`,
        endedAt: Date.UTC(2026, 8, 1) + i * 86_400_000,
        difficulty: i % 2 ? 'hard' : 'normal',
        actsCleared: 4,
        totalTurns: 70 + i,
        seed: 1000 + i,
        roster: [
          { name: 'Benedetta', className: 'Falcon Knight', level: 20, isLord: false },
          { name: 'Sera', className: 'Light Priestess', level: 15, isLord: true },
          { name: 'Edric', className: 'Great Lord', level: 17, isLord: true },
        ],
      }));
      localStorage.setItem('emblem_rogue_slot_1_meta', JSON.stringify({ runRecords }));
    });
    await page.goto('/?devScene=title');
    await waitForScene(page, 'Title');
    await emulateSafeArea(page);
    await page.getByRole('button', { name: 'Records', exact: true }).tap();
    const records = page.getByRole('dialog', { name: 'Victory records' });
    await expect(records).toBeVisible();
    // The body is the scroll owner: bounded by the screen and scrollable by touch.
    const body = records.locator('.re-menu-body');
    expect(
      await body.evaluate((el) => ({
        scrolls: el.scrollHeight > el.clientHeight,
        touch: /auto|scroll/.test(getComputedStyle(el).overflowY),
      })),
    ).toEqual({ scrolls: true, touch: true });
    const close = records.getByRole('button', { name: 'Close', exact: true });
    const oldest = records.getByRole('button', { name: /Slot 1/ }).last();
    await oldest.scrollIntoViewIfNeeded();
    await expectTappable(close);
    await expectTappable(oldest);
    await oldest.tap();
    await expect(
      records.getByText('Benedetta · Falcon Knight · Lv 20', { exact: true }),
    ).toBeVisible();
    const back = records.getByRole('button', { name: 'Back to victories', exact: true });
    await expectTappable(back);
    await expectNoSidewaysScroll(page, '.re-run-flow .re-menu-body');
    await back.tap();
    // Sixty saved, the latest fifty kept (the archive's own cap).
    await expect(records.getByRole('button', { name: /Slot 1/ })).toHaveCount(50);
    await close.tap();
    await expect(records).toHaveCount(0);
  });
});

// ── 16. Landscape phones and desktop: unchanged ─────────────────────────────
/**
 * Boxes of `selectors`, then the same with html.portrait-ui set (announced, as the shell
 * would): a landscape page must not move. Returns nothing; asserts.
 */
async function expectClassInert(page, selectors) {
  const read = () =>
    page.evaluate(
      (sels) =>
        Object.fromEntries(
          sels.map((s) => [
            s,
            [...document.querySelectorAll(s)]
              .filter((el) => el.getClientRects().length)
              .slice(0, 24)
              .map((el) => {
                const r = el.getBoundingClientRect();
                return [r.x, r.y, r.width, r.height].map((v) => Math.round(v * 10) / 10);
              }),
          ]),
        ),
      selectors,
    );
  await page.evaluate(() => document.fonts.ready);
  const before = await read();
  await page.evaluate(() => {
    document.documentElement.classList.add('portrait-ui');
    window.dispatchEvent(new CustomEvent('emblem-rogue:portrait-ui', { detail: { active: true } }));
  });
  const after = await read();
  for (const sel of selectors) {
    expect(after[sel].length, `${sel} count`).toBe(before[sel].length);
    after[sel].forEach((box, i) =>
      box.forEach((v, k) =>
        expect(Math.abs(v - before[sel][i][k]), `${sel}[${i}]`).toBeLessThanOrEqual(1),
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

const TITLE_BOXES = [
  '.re-title-art',
  '.re-keyart-lockup',
  '.re-title-run button',
  '.re-title-reference button',
  '.re-title-corner button',
  '.re-title-foot',
];

for (const [label, context] of [
  ['landscape 568x320', upright({ width: 568, height: 320 })],
  ['landscape 667x375', upright({ width: 667, height: 375 })],
  ['landscape 844x390', upright({ width: 844, height: 390 })],
  ['desktop 640x480', { viewport: { width: 640, height: 480 } }],
  ['desktop 1280x800', { viewport: { width: 1280, height: 800 } }],
])
  test.describe(`${label} unchanged`, () => {
    test.use(context);

    test('title: the landscape stage and its default art crop', async ({ page }) => {
      await openTitle(page);
      await expectPortraitUi(page, false);
      const frame = await page.evaluate(async () => {
        const { computeBackdropFrame } = await import('/src/art/keyart/keyArtBackdrop.js');
        const view = window.__emblemRogueGame.scene.getScene('Title').titleView;
        const { frame, dpr } = view.backdrop;
        const art = view.art.getBoundingClientRect();
        const root = view.root.getBoundingClientRect();
        // The crop main uses: the default anchors for this box (no upright band).
        const expected = computeBackdropFrame({
          width: Math.round(art.width),
          height: Math.round(art.height),
          dpr,
          maxCrop: view.phone ? 1.3 : 1.12,
        });
        return {
          frame: { sx: frame.sx, sy: frame.sy, scale: frame.scale },
          expected: { sx: expected.sx, sy: expected.sy, scale: expected.scale },
          art: [art.width, art.height],
          root: [root.width, root.height],
          band: view.root.style.getPropertyValue('--rt-art-h'),
        };
      });
      expect(frame.frame).toEqual(frame.expected);
      expect(frame.art).toEqual(frame.root);
      expect(frame.band).toBe('');
      await expectClassInert(page, TITLE_BOXES);
    });

    test('compendium, settings and upgrades keep their landscape layout', async ({ page }) => {
      await openReference(page, 'moreInfo');
      const help = page.getByRole('dialog', { name: 'Help', exact: true });
      // One-page categories still list beside their detail.
      await expect(help.locator('[aria-label="Entries"] .re-row')).toHaveCount(1);
      await expect(help.locator('.re-reference-detail')).toBeVisible();
      await expectClassInert(page, [
        '.re-header',
        '.re-search',
        'nav[aria-label="Categories"] .re-btn',
        '.re-menu',
        '.re-reference-detail',
      ]);
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toBeVisible();
      await expectClassInert(page, [
        '.re-settings',
        '.re-settings .re-header',
        '.re-settings .re-scroll',
      ]);
    });
  });

test.describe('landscape 844x390: upgrade detail as before', () => {
  test.use(upright({ width: 844, height: 390 }));

  test('two effect lines, the 64px icon, and the stamp layout', async ({ page }) => {
    const menu = await openUpgrades(page);
    await expectPortraitUi(page, false);
    await expect(menu.locator('.mu-effects')).toHaveText('Current: None\nNext: +5%', {
      useInnerText: true,
    });
    const icon = await menu.locator('.mu-head .ia-icon').boundingBox();
    expect(icon.width).toBe(80); // 64px art in its socket
    await expectClassInert(page, [
      '.mu-header',
      '.mu-tabs button',
      '.mu-list',
      '.mu-detail',
      '.mu-row',
      '.mu-buy',
    ]);
  });
});
