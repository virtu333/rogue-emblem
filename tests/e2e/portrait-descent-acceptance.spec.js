// Acceptance, scenario 6: the Descent upright on a phone (docs/portrait-battles.md; the Descent
// ships dark, the review routes switch it on for the page). On the two smallest upright phones,
// in the real portrait shell:
//   - the route map: the Rite chip, its note and a boss card's Rite block, the Vigil's circle note;
//   - the Vigil's battle: every sigil and circle marker on the board, uncovered by the rail or any
//     control; the court's words floating over their Voices in a real enemy phase, inside the
//     board and clear of the rail; the first Voice's last line in the dialogue box, whole, with
//     its Continue control tappable; the pause list's Rite entry (the words so far, live), whole;
//   - the pause list at its fullest (the highest tier's entry beside an open contract): every
//     entry and every action whole, however the device's fonts set them.
// Ways this can fail: something sideways-scrolls the page, a box leaves the viewport or the safe
// area, a label is clipped, a marker or a floating line sits under the rail, or a control drops
// below 44 px. Screenshots go to $ACCEPTANCE_SHOTS when set (else the test's output folder).
import { test, expect } from '@playwright/test';
import {
  NOTCH_PORTRAIT,
  PORTRAIT_PHONES,
  battleRail,
  clippedText,
  emulateSafeArea,
  endPlayerTurn,
  expectInsideSafeArea,
  expectNoSidewaysScroll,
  expectPortraitUi,
  expectTappable,
  expectWholeInViewport,
  openDevBattle,
  pageErrors,
  phone,
  quietSettings,
} from './portraitHelpers.js';
import { IN_ANSWERED, IN_SPOKEN, openRoute, selectNode } from './riteHelpers.js';

test.setTimeout(150_000);

const shot = (page, name) =>
  page.screenshot({
    path: process.env.ACCEPTANCE_SHOTS
      ? `${process.env.ACCEPTANCE_SHOTS}/${name}.png`
      : test.info().outputPath(`${name}.png`),
  });

const VIGIL_QUERY = `&setPiece=the_vigil&act=5&difficulty=hard&descent=1&rite=${IN_SPOKEN}`;
// The pause list's worst case: the Rite's highest tier (its longest entry) and an open contract.
const FULLEST_PAUSE_QUERY = `&setPiece=the_vigil&act=5&difficulty=hard&descent=1&rite=${IN_ANSWERED}&contract=underPar`;

/** Every marker the Vigil draws, with where its tile lands on the page and what is on top there. */
const markerSpots = (page) =>
  page.evaluate(() => {
    const b = window.__emblemRogueGame.scene.getScene('Battle');
    const ctrl = b._vigilCtrl;
    if (!ctrl?.shown) return null;
    const canvas = b.game.canvas;
    const rect = canvas.getBoundingClientRect();
    const tiles = b.battleConfig.vigil;
    const spots = [];
    for (const kind of ['sigils', 'circles']) {
      for (const shown of ctrl.shown[kind]) {
        const tile = tiles[kind].find((t) => t.id === shown.id);
        const world = b.grid.gridToPixel(tile.col, tile.row);
        const screen = b._worldToScreen(world.x, world.y);
        const x = rect.left + (screen.x * rect.width) / b.scale.width;
        const y = rect.top + (screen.y * rect.height) / b.scale.height;
        const hit = document.elementFromPoint(x, y);
        spots.push({
          id: shown.id,
          state: shown.state,
          x,
          y,
          inCanvas: x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom,
          inViewport: x >= 0 && y >= 0 && x <= innerWidth && y <= innerHeight,
          onTop: hit === canvas,
          covering: hit === canvas ? null : hit?.className || hit?.tagName || null,
        });
      }
    }
    return spots;
  });

/** The court's floating lines now on screen: their page boxes and the board's and the rail's. */
const floatingLines = (page) =>
  page.evaluate(() => {
    const b = window.__emblemRogueGame.scene.getScene('Battle');
    const rect = b.game.canvas.getBoundingClientRect();
    const rail = document
      .querySelector('[role="complementary"][aria-label="Battle commands"]')
      ?.getBoundingClientRect();
    const toPage = (g) => ({
      left: rect.left + (g.x * rect.width) / b.scale.width,
      top: rect.top + (g.y * rect.height) / b.scale.height,
      right: rect.left + ((g.x + g.width) * rect.width) / b.scale.width,
      bottom: rect.top + ((g.y + g.height) * rect.height) / b.scale.height,
    });
    const lines = [...(b._battleBeats?._live || [])]
      .filter((o) => o?.active && typeof o.text === 'string' && o.alpha > 0.05)
      .map((o) => {
        const box = toPage(o.getBounds());
        // What is on top at the line's centre: the canvas, unless a control covers the line.
        const hit = document.elementFromPoint(
          (box.left + box.right) / 2,
          (box.top + box.bottom) / 2,
        );
        return {
          text: o.text,
          box,
          covered: hit === b.game.canvas ? null : hit?.className || hit?.tagName || 'nothing',
        };
      });
    // The battle's notice bands ("The Voices speak.") on screen now: DOM over the canvas, and
    // they never take input, so a hit test passes through them; their boxes are compared.
    const notices = [...document.querySelectorAll('.ce-notice')]
      .filter((el) => !el.closest('.is-leaving') && Number(getComputedStyle(el).opacity) > 0.05)
      .map((el) => {
        const r = el.getBoundingClientRect();
        return {
          text: el.textContent.trim(),
          left: r.left,
          top: r.top,
          right: r.right,
          bottom: r.bottom,
        };
      });
    return {
      lines,
      notices,
      board: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
      rail: rail
        ? { left: rail.left, top: rail.top, right: rail.right, bottom: rail.bottom }
        : null,
    };
  });

const overlaps = (a, b) =>
  a && b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

for (const vp of PORTRAIT_PHONES.slice(0, 2)) {
  const size = `${vp.width}x${vp.height}`;
  test.describe(`upright ${size}`, () => {
    // eslint-disable-next-line no-unused-vars
    const { defaultBrowserType, ...context } = phone(vp);
    test.use(context);

    test('the route map: the Rite chip and note, the boss cards, the Vigil’s note', async ({
      page,
    }) => {
      const errors = pageErrors(page);
      await quietSettings(page);
      const route = await openRoute(page, { rite: IN_ANSWERED, row: 2 });
      await expectPortraitUi(page);
      await emulateSafeArea(page);
      const chip = route.locator('.re-burden.re-rite');
      await expect(chip).toBeVisible();
      await expectWholeInViewport(chip);
      await chip.tap();
      const note = route.locator('.re-burden-note');
      await expect(note).toBeVisible();
      await expectWholeInViewport(note);
      expect(await clippedText(page, '.re-burden-note')).toEqual([]);
      await expectNoSidewaysScroll(page);
      await shot(page, `route-rite-note-${size}`);
      await chip.tap();
      await expect(note).toBeHidden();

      // The Vigil's card: its circle note under the node's text, whole.
      await selectNode(page, 'vigil');
      const vigilNote = route.locator('.re-loom-card .re-loom-rite-note-line');
      await expect(vigilNote).toHaveText(
        'Stand on a circle to stop its summons. Its Voice still speaks.',
      );
      await vigilNote.scrollIntoViewIfNeeded();
      await expectWholeInViewport(vigilNote);
      expect(await clippedText(page, '.re-loom-card')).toEqual([]);
      await shot(page, `route-vigil-card-${size}`);

      // The gate's and the Entity's Rite blocks, whole and unclipped.
      for (const key of ['gate', 'entity']) {
        await selectNode(page, key);
        const block = route.locator('.re-loom-card .re-loom-rite');
        await expect(block).toBeVisible();
        await block.scrollIntoViewIfNeeded();
        await expectWholeInViewport(block);
        expect(await clippedText(page, '.re-loom-card')).toEqual([]);
        await expectNoSidewaysScroll(page);
        await shot(page, `route-${key}-card-${size}`);
      }
      expect(errors).toEqual([]);
    });

    test('the Vigil upright: markers, the court’s words, a Voice’s last line, the Rite in Pause', async ({
      page,
    }) => {
      const errors = pageErrors(page);
      await quietSettings(page);
      await openDevBattle(page, { slot: null, query: VIGIL_QUERY });
      await expectPortraitUi(page);
      await emulateSafeArea(page);
      await expectNoSidewaysScroll(page);
      const setPiece = await page.evaluate(
        () => window.__emblemRogueGame.scene.getScene('Battle').battleConfig.templateId,
      );
      expect(setPiece).toBe('setpiece:the_vigil');

      // The Voices open the battle (dialogue.json vigil.entry, once a run): whole, its controls
      // tappable and clear of the notch and the home bar.
      const entry = page.locator('.re-dialogue');
      await expect(entry).toBeVisible();
      await expect(entry).toContainText(/Voice of the/);
      await expectWholeInViewport(entry.locator('.re-panel').first());
      expect(await clippedText(page, '.re-dialogue')).toEqual([]);
      const skip = entry.getByRole('button', { name: 'Skip conversation', exact: true });
      await expectTappable(entry.getByRole('button', { name: 'Continue', exact: true }));
      await expectTappable(skip);
      await expectInsideSafeArea(page, '.re-dialogue footer .re-btn', NOTCH_PORTRAIT);
      await shot(page, `vigil-entry-voices-${size}`);
      await skip.tap();
      await expect(entry).toBeHidden();

      // Every sigil and circle marker is on the board, on screen and under no control (the turn's
      // phase band gone first: it lies over the board by design, for a moment).
      await expect(page.locator('.ce-phase-layer')).toHaveCount(0, { timeout: 15_000 });
      await expect.poll(async () => (await markerSpots(page))?.length).toBe(8);
      const spots = await markerSpots(page);
      for (const s of spots) {
        expect(s.inCanvas && s.inViewport, `${s.id} on the board on screen`).toBe(true);
        expect(s.onTop, `${s.id} is covered by ${s.covering}`).toBe(true);
      }
      expect(spots.filter((s) => s.id.startsWith('sigil')).map((s) => s.state)).toEqual([
        'lit',
        'lit',
        'lit',
        'lit',
      ]);
      await shot(page, `vigil-markers-${size}`);

      // The rail's commands stay whole and tappable beside the Vigil's board.
      const rail = battleRail(page);
      for (const name of ['End turn…', 'Menu'])
        await expectTappable(rail.getByRole('button', { name, exact: true }));

      // A real enemy phase: the Voices speak over themselves (each line under its speaker's name
      // tab), inside the board, clear of the rail and of the notice band announcing them. Every
      // frame the lines are up is sampled, from the first line to the last one fading.
      const samples = [];
      await endPlayerTurn(page, {
        duringEnemyPhase: async () => {
          await expect
            .poll(async () => (await floatingLines(page)).lines.length, {
              timeout: 30_000,
              intervals: [50],
            })
            .toBeGreaterThan(0);
          await shot(page, `vigil-voices-speak-${size}`);
          for (let gone = 0; gone < 3 && samples.length < 400; ) {
            const now = await floatingLines(page);
            if (now.lines.length) samples.push(now);
            gone = now.lines.length ? 0 : gone + 1;
          }
        },
      });
      expect(samples.length).toBeGreaterThan(0);
      const faults = new Set();
      for (const seen of samples) {
        for (const line of seen.lines) {
          const { box } = line;
          const inside =
            box.left >= seen.board.left - 0.5 &&
            box.right <= seen.board.right + 0.5 &&
            box.top >= seen.board.top - 0.5 &&
            box.bottom <= seen.board.bottom + 0.5;
          if (!inside) faults.add(`"${line.text}" leaves the board`);
          // The rail steps aside in the enemy phase; whatever stands, nothing covers a line.
          if (overlaps(box, seen.rail)) faults.add(`"${line.text}" under the rail`);
          if (line.covered) faults.add(`"${line.text}" covered by ${line.covered}`);
          for (const notice of seen.notices)
            if (overlaps(box, notice)) faults.add(`"${line.text}" under "${notice.text}"`);
        }
      }
      expect([...faults]).toEqual([]);
      const words = await page.evaluate(
        () => window.__emblemRogueGame.scene.getScene('Battle')._vigilState.words,
      );
      expect(words).toBeGreaterThan(0);

      // The Rite in Pause: the words so far (the Rite at entry plus this battle's), whole.
      await rail.getByRole('button', { name: 'Menu', exact: true }).tap();
      const pause = page.getByRole('dialog', { name: 'Paused' });
      await expect(pause).toBeVisible();
      const rite = pause.locator('.mp-burdens li.is-rite');
      await expect(rite).toBeVisible();
      await expect(rite.locator('strong')).toContainText(`${IN_SPOKEN + words} words`);
      await rite.scrollIntoViewIfNeeded();
      await expectWholeInViewport(rite);
      expect(await clippedText(page, '.mp-burdens')).toEqual([]);
      await expectInsideSafeArea(page, '.mp-panel', NOTCH_PORTRAIT);
      await expectNoSidewaysScroll(page);
      await shot(page, `vigil-pause-rite-${size}`);
      await pause.getByRole('button', { name: 'Resume', exact: true }).tap();
      await expect(pause).toBeHidden();

      // The first Voice to fall says its last line in the dialogue box (the scene's own fall).
      await page.evaluate(() => {
        const b = window.__emblemRogueGame.scene.getScene('Battle');
        const voice = b.enemyUnits.find((u) => u.authoredId === 'voice_binding');
        void b.removeUnit(voice, { killer: b.playerUnits[0] });
      });
      // A line in battle closes itself after a few seconds: it is measured at once, in one read.
      const dialogue = page.locator('.re-dialogue');
      await expect(dialogue).toContainText('Voice of the Binding');
      await shot(page, `vigil-voice-falls-${size}`);
      const box = await page.evaluate((insets) => {
        const root = document.querySelector('.re-dialogue');
        const panel = root.querySelector('.re-panel').getBoundingClientRect();
        const buttons = [...root.querySelectorAll('footer .re-btn')].map((el) => {
          const r = el.getBoundingClientRect();
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return {
            label: el.textContent.trim(),
            width: r.width,
            height: r.height,
            onTop: el === hit || el.contains(hit),
            inSafeArea: r.top >= insets.top - 0.5 && r.bottom <= innerHeight - insets.bottom + 0.5,
          };
        });
        const clipped = [...root.querySelectorAll('*')].filter((el) => {
          const cs = getComputedStyle(el);
          return /hidden|clip/.test(cs.overflowX) && el.scrollWidth - el.clientWidth > 1;
        }).length;
        return {
          panel: {
            inViewport:
              panel.left >= -0.5 &&
              panel.top >= -0.5 &&
              panel.right <= innerWidth + 0.5 &&
              panel.bottom <= innerHeight + 0.5,
          },
          buttons,
          clipped,
        };
      }, NOTCH_PORTRAIT);
      expect(box.panel.inViewport).toBe(true);
      expect(box.clipped).toBe(0);
      expect(box.buttons.map((b) => b.label)).toContain('Continue');
      for (const b of box.buttons) {
        expect(b.width, `${b.label} width`).toBeGreaterThanOrEqual(43.5);
        expect(b.height, `${b.label} height`).toBeGreaterThanOrEqual(43.5);
        expect(b.onTop, `${b.label} uncovered`).toBe(true);
        expect(b.inSafeArea, `${b.label} inside the safe area`).toBe(true);
      }
      await expect(dialogue).toBeHidden({ timeout: 15_000 });
      // Its sigil goes silent and its circle closes; the markers still clear every control.
      await expect
        .poll(async () =>
          (await markerSpots(page))
            .filter((s) => s.id.endsWith('binding'))
            .map((s) => s.state)
            .sort(),
        )
        .toEqual(['closed', 'silent']);
      for (const s of await markerSpots(page)) expect(s.onTop, `${s.id} uncovered`).toBe(true);
      await shot(page, `vigil-voice-silenced-${size}`);
      expect(errors).toEqual([]);
    });

    // A panel a few pixels too tall for the phone once squeezed its lists to fit, and a list
    // could end shorter than its own entry: no scroll then showed that entry whole (CI's fonts
    // set the Rite's highest tier 3 px taller than the list left for it). Upright, the panel
    // scrolls instead: every list at least as tall as its tallest entry, the actions unsqueezed.
    test('the Pause list at its fullest: every entry and every action whole', async ({ page }) => {
      const errors = pageErrors(page);
      await quietSettings(page);
      await openDevBattle(page, { slot: null, query: FULLEST_PAUSE_QUERY });
      await expectPortraitUi(page);
      await emulateSafeArea(page);
      const entry = page.locator('.re-dialogue');
      await entry.getByRole('button', { name: 'Skip conversation', exact: true }).tap();
      await expect(entry).toBeHidden();

      await battleRail(page).getByRole('button', { name: 'Menu', exact: true }).tap();
      const pause = page.getByRole('dialog', { name: 'Paused' });
      await expect(pause).toBeVisible();
      const rows = pause.locator('.mp-burdens li');
      await expect(rows).toHaveCount(2);
      await expect(pause.locator('.mp-burdens li.is-rite strong')).toContainText('Answered');
      await expect(pause.locator('.mp-burdens li.is-contract')).toHaveCount(1);
      const fit = await pause.evaluate((panel) => {
        const list = panel.querySelector('.mp-burdens');
        const actions = panel.querySelector('.mp-actions');
        return {
          listHeight: list.clientHeight,
          tallestEntry: Math.max(
            ...[...list.children].map((li) => li.getBoundingClientRect().height),
          ),
          actionsScroll: actions.scrollHeight - actions.clientHeight,
        };
      });
      expect(fit.listHeight, 'the list is never shorter than an entry').toBeGreaterThanOrEqual(
        fit.tallestEntry - 0.5,
      );
      expect(fit.actionsScroll, 'the actions keep their full height').toBeLessThanOrEqual(1);
      for (const row of await rows.all()) {
        await row.scrollIntoViewIfNeeded();
        await expectWholeInViewport(row);
      }
      expect(await clippedText(page, '.mp-burdens')).toEqual([]);
      for (const button of await pause.locator('.mp-actions button').all())
        await expectTappable(button);
      await expectInsideSafeArea(page, '.mp-panel', NOTCH_PORTRAIT);
      await expectNoSidewaysScroll(page);
      await shot(page, `pause-fullest-${size}`);
      await pause.getByRole('button', { name: 'Resume', exact: true }).tap();
      await expect(pause).toBeHidden();
      expect(errors).toEqual([]);
    });
  });
}
