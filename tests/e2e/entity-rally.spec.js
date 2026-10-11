// The Entity finale's rally as portrait cards (src/ui/EntityRallyController.js, RallyCard.js): on
// desktop, a landscape phone and an upright phone. Failure modes:
//   - a card over the board's centre, off the map, or clipping its words (the longest line in
//     dialogue.json is 80 characters; the spec uses a 90-character one and a very long name)
//   - Skip below a 44 px target, or its press reaching the board (selecting the unit beneath it)
//   - the card taking the board's taps, or pausing the battle: the player keeps playing under it
//   - Cancel taken from an open unit selection, or not dismissing the card when nothing else is open
//   - a card that stays once skipped, or a line that comes back on a later beat
// The music is not in play: the spec drives the rally from the finale's callback
// (BattleMusicController's `onFinale`), with the bar shortened so the beats come quickly.
import { test, expect } from '@playwright/test';
import { padTap, installSimPad } from './helpers.js';
import {
  DESKTOPS,
  LANDSCAPE_PHONES,
  PORTRAIT_PHONES,
  battleIdle,
  expectPortraitUi,
  openDevBattle,
  phone,
  quietSettings,
  tileOnScreen,
} from './portraitHelpers.js';

test.setTimeout(90_000);

const LONG_LINE =
  'We were never meant to be only a thread. Hold the line, and let the dawn find us standing.';
const VIEWPORTS = [
  ['desktop 640x480', { viewport: DESKTOPS[0] }, false],
  ['desktop 1280x800', { viewport: DESKTOPS[1] }, false],
  ...LANDSCAPE_PHONES.slice(0, 2).map((v) => [`phone ${v.width}x${v.height}`, phone(v), true]),
  ...PORTRAIT_PHONES.slice(0, 2).map((v) => [`upright ${v.width}x${v.height}`, phone(v), true]),
];

const card = (page) => page.locator('.rc-card:not([hidden])');

// A real tap on a board tile: a finger on a phone, a click on the desktop.
async function press(page, touch, col, row) {
  const p = await tileOnScreen(page, col, row);
  if (touch) await page.touchscreen.tap(p.x, p.y);
  else await page.mouse.click(p.x, p.y);
}

// A rally of three: the longest line a speaker could have, a long name and class, and a short one.
async function startRally(page, { bar = 1000 } = {}) {
  await page.evaluate(
    async ({ bar, longLine }) => {
      const { default: EntityRallyController } = await import('/src/ui/EntityRallyController.js');
      const { BattleBeatsController } = await import('/src/ui/BattleBeatsController.js');
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      const edric = s.playerUnits.find((u) => u.name === 'Edric');
      const sera = s.playerUnits.find((u) => u.name === 'Sera');
      const stranger = {
        ...edric,
        name: 'Maximilian Thunderbolt-Ashenvale',
        className: 'Light Priestess',
        isLord: false,
      };
      window.__rallyScene = s;
      // the scene's own beats controller owns the rally, as the music callback leaves it
      s._battleBeats ||= new BattleBeatsController(s);
      s._battleBeats._rallied = true;
      s._entityRally = s._battleBeats._rally = new EntityRallyController(s);
      s._entityRally.start(
        [
          { unit: edric, speaker: edric.name, line: longLine },
          { unit: stranger, speaker: stranger.name, line: 'Wherever it falls, I will be there.' },
          { unit: sera, speaker: sera.name, line: 'It all led here.' },
        ],
        { leadMs: 0, barMs: bar },
      );
    },
    { bar, longLine: LONG_LINE },
  );
}

for (const [name, use, touch] of VIEWPORTS) {
  test.describe(name, () => {
    test.use(use);

    test.beforeEach(async ({ page }) => {
      await quietSettings(page, { guidance: 'off' });
      await openDevBattle(page, { preset: 'combat_actions', slot: null });
      if (name.startsWith('upright')) await expectPortraitUi(page, true);
    });

    test('a card on the map edge: whole, readable, clear of the board centre, with a 44px Skip', async ({
      page,
    }) => {
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await startRally(page);
      await expect(card(page)).toBeVisible();
      await expect(card(page).locator('.rc-line')).toHaveText(LONG_LINE);
      // measure the settled card: fonts in, the arrival animation done
      await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all(
          document
            .querySelector('.rc-card')
            .getAnimations()
            .map((a) => a.finished.catch(() => {})),
        );
      });

      const fit = await page.evaluate(() => {
        const c = document.querySelector('.rc-card');
        const r = c.getBoundingClientRect();
        const canvas = document.querySelector('#game-container canvas').getBoundingClientRect();
        const s = window.__rallyScene;
        const mid = s._guidance.battlefieldRect();
        const line = c.querySelector('.rc-line');
        const skip = c.querySelector('.rc-skip').getBoundingClientRect();
        const cx = skip.left + skip.width / 2;
        const cy = skip.top + skip.height / 2;
        const hitsSkip = (x, y) => document.elementFromPoint(x, y)?.closest('.rc-skip') != null;
        return {
          inViewport: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
          inCanvas:
            r.left >= canvas.left - 1 &&
            r.right <= canvas.right + 1 &&
            r.top >= canvas.top - 1 &&
            r.bottom <= canvas.bottom + 1,
          // the board's centre point must stay uncovered
          coversCentre: (() => {
            const x = mid.left + mid.width / 2;
            const y = mid.top + mid.height / 2;
            return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
          })(),
          lineClipped:
            line.scrollHeight > line.clientHeight + 1 || line.scrollWidth > line.clientWidth + 1,
          cardOverflow: c.scrollWidth > c.clientWidth + 1,
          height: r.height,
          mapHeight: canvas.height,
          skipTall: skip.height,
          // a 44px target: the box plus its invisible margin answers a tap 22px above and below
          skipHit44: hitsSkip(cx, cy - 21) && hitsSkip(cx, cy + 21) && skip.width >= 44 - 1,
          sideways: document.documentElement.scrollWidth - innerWidth,
        };
      });
      expect(fit.inViewport, 'card inside the viewport').toBe(true);
      expect(fit.inCanvas, 'card inside the map frame').toBe(true);
      expect(fit.coversCentre, 'board centre uncovered').toBe(false);
      expect(fit.lineClipped, 'the line is whole').toBe(false);
      expect(fit.cardOverflow, 'nothing pushes the card sideways').toBe(false);
      expect(fit.sideways, 'the page does not scroll sideways').toBeLessThanOrEqual(0);
      expect(fit.height / fit.mapHeight, 'the card is a lower third at most').toBeLessThan(0.34);
      expect(fit.skipHit44, 'Skip answers a 44px target').toBe(true);

      // the next beats: the long name stays on one line (an ellipsis is allowed), the card swaps
      await expect(card(page).locator('.rc-name')).toHaveText(/Maximilian/i, { timeout: 6000 });
      const nameLines = await card(page)
        .locator('.rc-name')
        .evaluate((el) => {
          const r = document.createRange();
          r.selectNodeContents(el);
          return new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size;
        });
      expect(nameLines).toBe(1);
      expect(
        (await page.locator('.rc-card').boundingBox()).x,
        'the card did not leave the screen',
      ).toBeGreaterThanOrEqual(0);
      expect(errors).toEqual([]);
    });

    test('the battle plays on under the card: a tap on a unit, even one it covers, selects it', async ({
      page,
    }) => {
      await startRally(page, { bar: 60_000 });
      await expect(card(page)).toBeVisible();
      // prefer a unit the card sits over: the card is click-through, so the press must reach it
      const where = await page.evaluate(() => {
        const s = window.__rallyScene;
        const r = document.querySelector('.rc-card').getBoundingClientRect();
        const skip = document.querySelector('.rc-skip').getBoundingClientRect();
        const units = s.playerUnits.map((u) => {
          const p = s._guidance.screenPoint(u);
          const under = Boolean(
            p && p.x > r.left && p.x < r.right && p.y > r.top && p.y < r.bottom,
          );
          const onSkip = Boolean(
            p &&
            p.x > skip.left - 12 &&
            p.x < skip.right + 12 &&
            p.y > skip.top - 12 &&
            p.y < skip.bottom + 12,
          );
          return { name: u.name, col: u.col, row: u.row, under: under && !onSkip };
        });
        return units.find((u) => u.under) || units.find((u) => u.name === 'Edric');
      });
      await press(page, touch, where.col, where.row);
      await expect
        .poll(() => page.evaluate(() => window.__rallyScene.selectedUnit?.name || null))
        .toBe(where.name);
      expect(await page.evaluate(() => window.__rallyScene.battleState)).not.toBe('PLAYER_IDLE');
      await expect(card(page)).toBeVisible();
    });

    test('Skip dismisses every line, never touches the board, and nothing comes back', async ({
      page,
    }) => {
      await startRally(page, { bar: 60_000 });
      await expect(card(page)).toBeVisible();
      // count presses that reach the board
      await page.evaluate(() => {
        const s = window.__rallyScene;
        s.__boardPresses = 0;
        const orig = s.onPointerDown.bind(s);
        s.onPointerDown = (...a) => {
          s.__boardPresses += 1;
          return orig(...a);
        };
      });
      const skip = card(page).locator('.rc-skip');
      if (touch) await skip.tap();
      else await skip.click();
      await expect(page.locator('.rc-card')).toHaveCount(0);
      expect(await page.evaluate(() => window.__rallyScene.__boardPresses)).toBe(0);
      expect(await page.evaluate(() => window.__rallyScene.selectedUnit)).toBeNull();
      // every beat still to come is cancelled, so no line returns on its own
      const left = await page.evaluate(() => ({
        skipped: window.__rallyScene._entityRally.skipped,
        timers: window.__rallyScene._entityRally._timers.length,
      }));
      expect(left).toEqual({ skipped: true, timers: 0 });
      await expect(page.locator('.ce-rally-layer')).toHaveCount(0);
    });

    test('Cancel dismisses the card at idle, but a selected unit keeps its Back', async ({
      page,
    }) => {
      // a long bar: the card must still be up after the selection has been backed out of
      await startRally(page, { bar: 60_000 });
      await expect(card(page)).toBeVisible();
      const target = await page.evaluate(() => {
        const s = window.__rallyScene;
        const u = s.playerUnits.find((p) => p.name === 'Edric');
        return { col: u.col, row: u.row };
      });
      await press(page, touch, target.col, target.row);
      await expect
        .poll(() => page.evaluate(() => window.__rallyScene.selectedUnit?.name || null))
        .toBe('Edric');
      const cancel = async () => {
        if (touch) {
          // the rail's Back button: the phone's Cancel (mobile:cancel)
          await page.getByRole('button', { name: 'Back', exact: true }).tap();
        } else {
          await page.keyboard.press('Escape');
        }
      };
      // each Cancel while the unit is selected goes to the unit (the phone's first Back may only
      // close its move range); the card is untouched throughout
      for (let i = 0; i < 4; i++) {
        if ((await page.evaluate(() => window.__rallyScene.battleState)) === 'PLAYER_IDLE') break;
        await cancel();
        await expect(card(page)).toBeVisible();
      }
      await expect
        .poll(() => page.evaluate(() => window.__rallyScene.battleState))
        .toBe('PLAYER_IDLE');
      await expect(card(page)).toBeVisible();
      // idle, nothing else open: now Cancel is the card's
      await cancel();
      await expect(page.locator('.rc-card')).toHaveCount(0);
      // and no pause menu opened for either press
      expect(await page.evaluate(() => Boolean(window.__rallyScene.pauseOverlay?.visible))).toBe(
        false,
      );
      await battleIdle(page);
    });
  });
}

test.describe('the pad and the real finale callback', () => {
  test.use({ viewport: DESKTOPS[1] });

  test("B dismisses the finale's rally started by the music callback", async ({ page }) => {
    await quietSettings(page, { guidance: 'off' });
    await openDevBattle(page, { preset: 'combat_actions', slot: null, query: '&gamepadSim=1' });
    await installSimPad(page);
    await page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      window.__rallyScene = s;
      s._musicCtrl._onFinale({ leadMs: 0, barMs: 1000 });
    });
    // the commander opens, as composed by engine/FinaleRally
    await expect(card(page)).toBeVisible();
    await expect(card(page).locator('.rc-name')).toHaveText(/Edric/i);
    await expect(card(page).locator('.rc-count')).toHaveText(/^1 \/ \d$/);
    await expect(card(page).locator('.rc-face')).toHaveCount(1);
    await padTap(page, 1);
    await expect(page.locator('.rc-card')).toHaveCount(0);
    // once per battle: the callback again composes nothing
    expect(await page.evaluate(() => window.__rallyScene._battleBeats.entityRally().length)).toBe(
      0,
    );
    await expect(page.locator('.rc-card')).toHaveCount(0);
  });
});
