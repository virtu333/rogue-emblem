import { test, expect } from '@playwright/test';
import {
  battleIdle,
  battleRail,
  endPlayerTurn,
  expectNoSidewaysScroll,
  expectWholeInViewport,
  moveAndWait,
  openDevBattle,
  openSavedRun,
  pageErrors,
  phone as phoneContext,
  quietSettings,
} from './portraitHelpers.js';

// The open contract on the battle HUD (docs/specs/event-nodes-phase2.md §2E): "Contract · Under
// par" beside the turn and par counter, "— missed" once a victory would break it, and its terms
// on hover (desktop), tap (phone) and in Battle details. Derived on every read from the run and
// the live battle, so a rewind and a resume show the same line.
//
// Routes: `&contract=<goal>` opens the contract (600 G kept, Debt 300 G broken) on the battle
// route, `&par=<n>` gives the battle a turn par of n so "Under par" breaks in a few real turns.
//
// Ways this goes wrong:
//   - the line is missing on one of the HUDs (desktop plate, phone rail sideways, rail upright);
//   - it never turns "missed" (the end turn is driven for real), or says missed too early;
//   - it overflows the rail or the plate in its longest wording, or pushes the commands (End turn,
//     Battle details) off the short rail;
//   - the terms are unreachable: no hover tip on desktop, no tap sheet on a phone;
//   - a rewind or a resume shows a different standing than the battle has;
//   - a battle with no contract grows an empty row.

// phone() spreads a device descriptor whose defaultBrowserType would force a new worker
// inside a describe group; the lane runs Chromium either way.
// eslint-disable-next-line no-unused-vars
const phone = (viewport) => (({ defaultBrowserType, ...rest }) => rest)(phoneContext(viewport));

const SHOTS = process.env.CONTRACT_HUD_SHOTS || '';
const shot = (page, name) => (SHOTS ? page.screenshot({ path: `${SHOTS}/${name}.png` }) : null);

const TERMS = /Win the next battle by turn par or sooner\. Kept: \+600 G\. Broken: Debt 300 G\./;
const NO_LOSSES_TERMS = /Win the next battle without losing anyone\./;

const battle = (page, source, arg) =>
  page.evaluate(
    ([src, a]) => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      const Async = Object.getPrototypeOf(async () => {}).constructor;
      return new Async('s', 'a', src)(s, a);
    },
    [source, arg],
  );

const turnOf = (page) => battle(page, 'return s.turnManager.turnNumber');

/** An ally dies the way combat kills one: through the scene's own removal. */
async function fell(page, except = null) {
  const name = await battle(
    page,
    `const victim = s.playerUnits.find((u) => !u.isCommander && u.currentHP > 0 && u.name !== a);
     await s.removeUnit(victim, { killer: s.enemyUnits[0] });
     return victim.name;`,
    except,
  );
  await expect
    .poll(() => battle(page, 'return s.playerUnits.some((u) => u.name === a)', name))
    .toBe(false);
  return name;
}

// ───────── Desktop: the canvas HUD ─────────

test.describe('desktop 640x480', () => {
  test.use({ viewport: { width: 640, height: 480 } });

  const line = (page) =>
    battle(
      page,
      `const t = s.contractHudText;
       return t ? { text: t.text, visible: t.visible, color: t.style.color,
         x: t.x, y: t.y, w: t.displayWidth, h: t.displayHeight } : null;`,
    );

  /** The canvas point (CSS px) over a Phaser object's centre. */
  const over = (page, object) =>
    battle(
      page,
      `const t = s[a];
       const r = s.game.canvas.getBoundingClientRect();
       return { x: r.left + ((t.x + t.displayWidth / 2) * r.width) / s.scale.width,
                y: r.top + ((t.y + t.displayHeight / 2) * r.height) / s.scale.height };`,
      object,
    );

  test('underPar: the line sits in the status plate, its terms on hover; end turns past par miss it', async ({
    page,
  }) => {
    const errors = pageErrors(page);
    await quietSettings(page);
    await openDevBattle(page, { query: '&contract=underPar&par=2' });
    await expect
      .poll(() => line(page))
      .toMatchObject({
        text: 'Contract · Under par',
        visible: true,
      });
    const open = await line(page);
    // Inside the canvas, below the turn line it belongs to, clear of the objective plate.
    const hud = await battle(
      page,
      `const t = s.turnCounterText, o = s.objectiveText;
       return { turnBottom: t.y + t.displayHeight, objectiveLeft: o.x - o.displayWidth, width: s.scale.width };`,
    );
    expect(open.y).toBeGreaterThan(hud.turnBottom);
    expect(open.x + open.w).toBeLessThan(hud.objectiveLeft);
    expect(open.x + open.w).toBeLessThan(hud.width);
    await shot(page, 'desktop-open');

    // Hover: the terms, wrapped inside the canvas and clear of the objective.
    const at = await over(page, 'contractHudText');
    await page.mouse.move(at.x, at.y);
    await expect.poll(() => battle(page, 'return s.contractTipText.visible')).toBe(true);
    const tip = await battle(
      page,
      `const t = s.contractTipText, o = s.objectiveText;
       return { text: t.text, right: t.x + t.displayWidth, bottom: t.y + t.displayHeight,
         left: t.x, objectiveLeft: o.x - o.displayWidth, width: s.scale.width, height: s.scale.height };`,
    );
    expect(tip.text).toMatch(TERMS);
    expect(tip.right).toBeLessThanOrEqual(tip.objectiveLeft);
    expect(tip.right).toBeLessThanOrEqual(tip.width);
    expect(tip.bottom).toBeLessThanOrEqual(tip.height);
    await shot(page, 'desktop-terms');
    await page.mouse.move(2, 470);
    await expect.poll(() => battle(page, 'return s.contractTipText.visible')).toBe(false);

    // Par 2: turns 1 and 2 keep it; the end turn into turn 3 breaks it.
    const endTurn = () => over(page, 'endTurnButton');
    for (const turn of [1, 2]) {
      expect(await turnOf(page)).toBe(turn);
      await expect.poll(() => line(page)).toMatchObject({ text: 'Contract · Under par' });
      const point = await endTurn();
      await page.mouse.click(point.x, point.y);
      await battleIdle(page);
      await expect.poll(() => turnOf(page)).toBe(turn + 1);
    }
    await expect
      .poll(() => line(page))
      .toMatchObject({ text: 'Contract · Under par — missed', visible: true });
    const missed = await line(page);
    expect(missed.color).not.toBe(open.color);
    expect(missed.x + missed.w).toBeLessThan(hud.objectiveLeft);
    await page.mouse.move(...Object.values(await over(page, 'contractHudText')));
    await expect
      .poll(() => battle(page, 'return s.contractTipText.text'))
      .toMatch(/Turn par has passed: a victory now breaks the contract\./);
    await shot(page, 'desktop-missed');
    expect(errors).toEqual([]);
  });

  test('noLosses: an ally falling misses it (the longest line)', async ({ page }) => {
    const errors = pageErrors(page);
    await quietSettings(page);
    await openDevBattle(page, { query: '&contract=noLosses' });
    await expect.poll(() => line(page)).toMatchObject({ text: 'Contract · No losses' });
    await fell(page);
    await expect
      .poll(() => line(page))
      .toMatchObject({ text: 'Contract · No losses — missed', visible: true });
    const missed = await line(page);
    const room = await battle(
      page,
      `const o = s.objectiveText; return { objectiveLeft: o.x - o.displayWidth };`,
    );
    expect(missed.x + missed.w).toBeLessThan(room.objectiveLeft);
    await shot(page, 'desktop-no-losses-missed');
    expect(errors).toEqual([]);
  });

  test('no contract: no line, no object', async ({ page }) => {
    await quietSettings(page);
    await openDevBattle(page);
    expect(await line(page)).toBeNull();
    expect(await battle(page, 'return s._contractHud.model()')).toBeNull();
  });
});

// ───────── Phones: the DOM rail, sideways and upright ─────────

const PHONES = [
  { width: 844, height: 390, upright: false },
  { width: 667, height: 375, upright: false },
  { width: 390, height: 844, upright: true },
  { width: 375, height: 667, upright: true },
];

for (const vp of PHONES) {
  test.describe(`phone ${vp.width}x${vp.height}${vp.upright ? ' (upright)' : ''}`, () => {
    test.use(phone({ width: vp.width, height: vp.height }));
    test.setTimeout(120_000);

    const contractLine = (page) => battleRail(page).locator('.mb-contract');
    let shots = 0;

    /** The line and the controls the short rail must keep, all whole on screen. */
    async function expectRailFits(page, { details = true } = {}) {
      const rail = battleRail(page);
      await expect(contractLine(page)).toBeVisible();
      await shot(page, `fit-${vp.width}x${vp.height}-${shots++}`);
      const fit = await page.evaluate(() => {
        const rail = document.querySelector('.mobile-battle-hud');
        const r = rail.getBoundingClientRect();
        const line = document.querySelector('.mb-contract');
        const l = line.getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(line);
        const text = [...range.getClientRects()].filter((c) => c.width > 0);
        return {
          lineInside:
            l.left >= r.left - 0.5 &&
            l.right <= r.right + 0.5 &&
            l.top >= r.top - 0.5 &&
            l.bottom <= r.bottom + 0.5,
          textInside: text.every((c) => c.left >= r.left - 0.5 && c.right <= r.right + 0.5),
          lines: new Set(text.map((c) => Math.round(c.top))).size,
          railSideways: rail.scrollWidth - rail.clientWidth,
        };
      });
      expect(fit.lineInside, 'the line is inside the rail').toBe(true);
      expect(fit.textInside, 'its words are inside the rail').toBe(true);
      expect(fit.railSideways, 'the rail does not scroll sideways').toBeLessThanOrEqual(1);
      expect(fit.lines, 'at most two lines').toBeLessThanOrEqual(2);
      await expectNoSidewaysScroll(page);
      // What the short rail must still show whole: End turn, and the Battle details row.
      await expectWholeInViewport(rail.getByRole('button', { name: /^End turn/ }));
      // After an action the tile's card shares the short rail; its scrolling body then keeps
      // Battle details a scroll away (its "more" cue), as without a contract.
      if (details) await expectWholeInViewport(rail.locator('.mb-battle-info summary'));
      return fit;
    }

    test('underPar: the line, its terms on tap, missed after par (end turns driven for real)', async ({
      page,
    }) => {
      const errors = pageErrors(page);
      await quietSettings(page);
      await openDevBattle(page, { query: '&contract=underPar&par=2' });
      const rail = battleRail(page);
      await expect(contractLine(page)).toHaveText('Contract · Under par');
      await expect(contractLine(page)).toHaveClass(/is-open/);
      await expect(contractLine(page)).toHaveAttribute('title', TERMS);
      await expectRailFits(page);
      // Right under the turn and par counter, before the objective: the header's next row.
      const gap = await page.evaluate(() => {
        const counters = document.querySelector('.mb-counters').getBoundingClientRect();
        const line = document.querySelector('.mb-contract').getBoundingClientRect();
        return { below: line.top - counters.bottom, tall: line.height };
      });
      expect(gap.below).toBeGreaterThanOrEqual(-1);
      expect(gap.below).toBeLessThanOrEqual(30);
      await expect(rail.locator('.mb-counters')).toContainText(/Par \d+ · [SABC] \| Visions/);
      await shot(page, `phone-${vp.width}x${vp.height}-open`);

      // A tap reads the terms.
      await contractLine(page).tap();
      const sheet = page.getByRole('dialog', { name: 'Contract', exact: true });
      await expect(sheet).toBeVisible();
      await expect(sheet).toContainText('Contract · Under par');
      await expect(sheet).toContainText(TERMS);
      await shot(page, `phone-${vp.width}x${vp.height}-terms`);
      await sheet.getByRole('button', { name: /^Close/ }).tap();
      await expect(sheet).toHaveCount(0);
      await expect(contractLine(page)).toBeFocused();

      // Battle details carries the line and its terms too.
      await rail.locator('.mb-battle-info summary').tap();
      await expect(rail.locator('.mb-contract-detail')).toContainText(
        'Contract · Under par. Win the next battle',
      );
      await rail.locator('.mb-battle-info summary').tap();

      // Par 2: turn 2 keeps it, turn 3 breaks it.
      await endPlayerTurn(page);
      expect(await turnOf(page)).toBe(2);
      await expect(contractLine(page)).toHaveText('Contract · Under par');
      await endPlayerTurn(page);
      expect(await turnOf(page)).toBe(3);
      await expect(contractLine(page)).toHaveText('Contract · Under par — missed');
      await expect(contractLine(page)).toHaveClass(/is-missed/);
      await expect(contractLine(page)).toHaveAttribute('title', /Turn par has passed/);
      const missedFit = await expectRailFits(page);
      expect(missedFit.lines).toBeLessThanOrEqual(2);
      await shot(page, `phone-${vp.width}x${vp.height}-missed`);
      expect(errors).toEqual([]);
    });

    test('noLosses: missed when an ally falls, open again when the turn is rewound', async ({
      page,
    }) => {
      const errors = pageErrors(page);
      await quietSettings(page);
      await openDevBattle(page, { query: '&contract=noLosses' });
      const rail = battleRail(page);
      await expect(contractLine(page)).toHaveText('Contract · No losses');
      await expect(contractLine(page)).toHaveAttribute('title', NO_LOSSES_TERMS);
      await expectRailFits(page);

      // One real action first: Vision rewinds to the moment before a completed action.
      const mover = await battle(page, 'return s.playerUnits.find((u) => u.isCommander).name');
      await moveAndWait(page, mover, { toward: false });
      await fell(page, mover);
      await expect(contractLine(page)).toHaveText('Contract · No losses — missed');
      await expect(contractLine(page)).toHaveAttribute('title', /An ally has fallen/);
      await expectRailFits(page, { details: false }); // the longest line
      await shot(page, `phone-${vp.width}x${vp.height}-no-losses-missed`);

      // Vision rewinds the fall: the contract is open again, nothing was stored.
      await rail.getByRole('button', { name: 'Rewind', exact: true }).tap();
      const picker = page.getByRole('dialog', { name: 'Rewind', exact: true });
      await picker.getByRole('button', { name: /^Rewind here/ }).tap();
      await battleIdle(page);
      await expect(contractLine(page)).toHaveText('Contract · No losses');
      await expectRailFits(page, { details: false });
      expect(errors).toEqual([]);
    });

    test('no contract: nothing is drawn and the rail is the rail it was', async ({ page }) => {
      await quietSettings(page);
      await openDevBattle(page);
      await expect(battleRail(page)).toBeVisible();
      await expect(contractLine(page)).toHaveCount(0);
      await expect(battleRail(page).locator('.mb-contract-detail')).toHaveCount(0);
      await expectWholeInViewport(battleRail(page).locator('.mb-battle-info summary'));
    });
  });
}

// ───────── A resume shows the same standing ─────────

test.describe('resume', () => {
  test.use(phone({ width: 390, height: 844 }));
  test.setTimeout(120_000);

  test('a battle left past par resumes missed; one left on its par resumes open', async ({
    page,
  }) => {
    const errors = pageErrors(page);
    await quietSettings(page);
    await openDevBattle(page, { query: '&contract=underPar&par=2' });
    const line = battleRail(page).locator('.mb-contract');
    await endPlayerTurn(page); // turn 2: on par, kept
    await expect(line).toHaveText('Contract · Under par');
    await openSavedRun(page);
    expect(await turnOf(page)).toBe(2);
    expect(await battle(page, 'return s.turnPar')).toBe(2);
    await expect(line).toHaveText('Contract · Under par');
    await endPlayerTurn(page); // turn 3: past par
    await expect(line).toHaveText('Contract · Under par — missed');
    await openSavedRun(page);
    expect(await turnOf(page)).toBe(3);
    await expect(line).toHaveText('Contract · Under par — missed');
    await expect(line).toHaveClass(/is-missed/);
    expect(errors).toEqual([]);
  });
});
