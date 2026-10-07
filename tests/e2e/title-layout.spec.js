import { test, expect, devices } from '@playwright/test';
import { waitForScene } from './helpers.js';
import { buildTitleMenu } from '../../src/ui/titleMenuModel.js';

// The title is a DOM screen over The Hollow Sun key art (TitleScreen.js). These checks
// keep its targets real (44px, non-overlapping, inside the safe viewport) at phone sizes.
test.use({ ...devices['iPhone 13'], viewport: { width: 844, height: 390 } });

async function titleBoxes(page) {
  return page.evaluate(() => {
    const root = document.querySelector('.re-title');
    const r = root.getBoundingClientRect();
    const boxes = [...root.querySelectorAll('button')]
      .filter((b) => b.offsetParent)
      .map((b) => {
        const box = b.getBoundingClientRect();
        return {
          label: b.textContent.trim(),
          left: box.left,
          right: box.right,
          top: box.top,
          bottom: box.bottom,
          height: box.height,
          width: box.width,
        };
      });
    const lockup = root.querySelector('.re-keyart-lockup').getBoundingClientRect();
    return {
      root: { left: r.left, right: r.right, top: r.top, bottom: r.bottom },
      lockup: { left: lockup.left, right: lockup.right, top: lockup.top, bottom: lockup.bottom },
      boxes,
    };
  });
}

const overlaps = (a, b) =>
  a.left < b.right - 0.5 &&
  b.left < a.right - 0.5 &&
  a.top < b.bottom - 0.5 &&
  b.top < a.bottom - 0.5;

test('title menu keeps separate 44px targets inside the viewport and opens help by touch', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('emblem_rogue_slot_1_meta', '{}'));
  await page.goto('/?devScene=title&mobilePreview=1');
  await waitForScene(page, 'Title');
  const menu = page.getByRole('group', { name: 'Play' });
  await expect(menu.getByRole('button')).toHaveText([/New Game/, /Save Slots/, /Prologue/]);
  await expect(
    page.getByRole('group', { name: 'Guides and records' }).getByRole('button'),
  ).toHaveText([/How to Play/, /Compendium/, /More Info/, /Records/]);
  expect(
    await page.evaluate(() => window.__emblemRogueGame.scene.getScene('Title')._menuButtons.length),
  ).toBe(7);
  for (const [width, height] of [
    [844, 390],
    [667, 375],
  ]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(150);
    const { root, lockup, boxes } = await titleBoxes(page);
    expect(boxes.length).toBeGreaterThanOrEqual(8);
    for (const b of boxes) {
      expect(b.height, b.label).toBeGreaterThanOrEqual(44);
      expect(b.left, b.label).toBeGreaterThanOrEqual(root.left);
      expect(b.right, b.label).toBeLessThanOrEqual(root.right);
      expect(b.top, b.label).toBeGreaterThanOrEqual(root.top);
      expect(b.bottom, b.label).toBeLessThanOrEqual(root.bottom);
      expect(overlaps(b, lockup), `${b.label} overlaps the lockup`).toBe(false);
    }
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++)
        expect(overlaps(boxes[i], boxes[j]), `${boxes[i].label} / ${boxes[j].label}`).toBe(false);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: `test-results/title-layout-${width}.png` });
  }
  await page.getByRole('button', { name: /^How to Play/ }).tap();
  await expect(page.getByRole('dialog', { name: 'How to play', exact: false })).toBeVisible();
});

test('Save Slots follows New Game, corner actions stay clear, keyboard walks the menu', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('emblem_rogue_slot_1_meta', '{}'));
  await page.goto('/?devScene=title&mobilePreview=1');
  await waitForScene(page, 'Title');
  const newGame = await page.getByRole('button', { name: 'New Game', exact: true }).boundingBox();
  const slots = await page.getByRole('button', { name: 'Save Slots', exact: true }).boundingBox();
  expect(slots.x).toBe(newGame.x);
  expect(Math.round(slots.y - (newGame.y + newGame.height))).toBe(6);
  const settings = await page.getByRole('button', { name: 'Settings', exact: true }).boundingBox();
  expect(settings.height).toBeGreaterThanOrEqual(44);
  // The first action owns focus on arrival; arrows walk the menu in focus order.
  await expect(page.getByRole('button', { name: 'New Game', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: 'Save Slots', exact: true })).toBeFocused();
  expect(
    await page.evaluate(() => window.__emblemRogueGame.scene.getScene('Title')._menuFocus.index),
  ).toBe(1);
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await expect(page.getByRole('button', { name: 'Records', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Settings', exact: true }).tap();
  await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/title-settings.png' });
});

test('fresh profile promotes the prologue with NEW badges only where they apply', async ({
  page,
}) => {
  await page.goto('/?devScene=title&mobilePreview=1');
  await waitForScene(page, 'Title');
  const run = page.getByRole('group', { name: 'Play' }).getByRole('button');
  await expect(run).toHaveText([/^Prologue\s*Start here/, /New Game/]);
  await expect(run.first()).toHaveClass(/is-primary/);
  await expect(page.getByRole('button', { name: 'How to Play (new)', exact: true })).toBeVisible();
  await expect(page.locator('.re-title-badge')).toHaveCount(1);
  await expect(page.getByText('Progress saved on this device')).toBeVisible();
  await expect(page.getByText('v0.1.0')).toBeVisible();
  await expect(page.getByText('Alpha testing')).toBeVisible();
});

for (const [milestone, variant] of [
  [null, 'dusk'],
  ['beatGame', 'rising'],
  ['beatHard', 'ashfall'],
]) {
  test(`key art variant is ${variant}${milestone ? ` after ${milestone}` : ' by default'}`, async ({
    page,
  }) => {
    if (milestone)
      await page.addInitScript(
        (m) =>
          localStorage.setItem('emblem_rogue_slot_2_meta', JSON.stringify({ milestones: [m] })),
        milestone,
      );
    await page.goto('/?devScene=title&mobilePreview=1');
    await waitForScene(page, 'Title');
    await expect(page.locator('.re-title')).toHaveAttribute('data-variant', variant);
    await expect(page.locator('.re-title-art.re-keyart-ready canvas')).toHaveCount(1);
    // Phones get the full-viewport plate at an integer device-pixel scale.
    const frame = await page.evaluate(() => {
      const { frame } = window.__emblemRogueGame.scene.getScene('Title').titleView.backdrop;
      return { integer: frame.integer, scale: frame.scale };
    });
    expect(frame.integer).toBe(true);
    expect(Number.isInteger(frame.scale)).toBe(true);
  });
}

test('art pauses while covered or hidden, freezes under reduced motion and is released on exit', async ({
  page,
}) => {
  await page.goto('/?devScene=title&mobilePreview=1');
  await waitForScene(page, 'Title');
  await expect(page.locator('.re-title-art.re-keyart-ready canvas')).toHaveCount(1);
  const animating = () =>
    page.evaluate(
      () => window.__emblemRogueGame.scene.getScene('Title').titleView.backdrop.animating,
    );
  await expect.poll(animating).toBe(true);
  await page.getByRole('button', { name: 'Compendium', exact: true }).tap();
  await expect(page.getByRole('dialog', { name: 'Compendium', exact: true })).toBeVisible();
  await expect.poll(animating).toBe(false);
  await page.keyboard.press('Escape');
  await expect.poll(animating).toBe(true);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(animating).toBe(false);
  await page.evaluate(() => {
    delete document.hidden;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(animating).toBe(true);
  await page.evaluate(() =>
    window.__emblemRogueGame.registry.get('settings').setReduceMotion(true),
  );
  await expect.poll(animating).toBe(false);
  await expect(page.locator('.re-title')).toHaveClass(/is-still/);
  await page.getByRole('button', { name: 'New Game', exact: true }).tap();
  await page.getByRole('button', { name: 'Skip to the first run', exact: true }).tap();
  await waitForScene(page, 'NodeMap');
  await expect(page.locator('.re-title')).toHaveCount(0);
  await expect(page.locator('.re-keyart-canvas')).toHaveCount(0);
});

test.describe('desktop', () => {
  test.use({
    viewport: { width: 1554, height: 1040 },
    isMobile: false,
    hasTouch: false,
    deviceScaleFactor: 1,
    userAgent: devices['Desktop Chrome'].userAgent,
  });

  // Playtest: after New Game's prompt closed, focus went back to New Game and the first
  // action (gold only while focused) turned ink on ink; "Latest save · Slot 1" wrapped
  // its number onto a second line.
  test('the first action keeps its gold after a prompt closes; its subline stays on one line', async ({
    page,
  }) => {
    await page.goto('/?devScene=title');
    await waitForScene(page, 'Title');
    const run = page.getByRole('group', { name: 'Play' }).getByRole('button');
    const primary = run.first();
    await expect(primary).toHaveClass(/is-primary/);
    const fill = () =>
      page.evaluate(() => {
        const probe = document.createElement('span');
        probe.style.backgroundColor = 'var(--re-accent)';
        document.body.append(probe);
        const accent = getComputedStyle(probe).backgroundColor;
        probe.remove();
        const b = getComputedStyle(document.querySelector('.re-title-btn.is-primary'));
        return { accent, bg: b.backgroundColor, image: b.backgroundImage };
      });
    await page.getByRole('button', { name: 'New Game', exact: true }).click();
    const prompt = page.getByRole('dialog');
    await expect(prompt).toBeVisible();
    await prompt.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(prompt).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'New Game', exact: true })).toBeFocused();
    await expect(primary).not.toBeFocused();
    const rest = await fill();
    expect(rest.bg).toBe(rest.accent);
    expect(rest.image).toContain('gradient');
    // The subline Resume carries with several runs going: one line, nothing cut off.
    await expectSublineFits(page);
  });
});

// Playtest (Oct 2026): on a desktop the stage snaps each pixel-font size to whole device
// pixels, which can lift the 7px subline to the label's own size; "Latest save · Slot 1"
// then ran past the button and was cut ("LATEST SAVE · SL…"). The sizes below are the
// worst snaps measured: 1554x1040 at 1x (7 -> 7.4px, as big as the label) and 1000x700 at
// 2x (7 -> 8.2px, the old line 21px too wide).
async function expectSublineFits(page) {
  // The model's own words with several runs going, for the widest slot number.
  const text = buildTitleMenu({
    hasSlots: true,
    prologueDone: true,
    resumeSlot: { slot: 3, latestOf: 3, actReached: 4 },
  }).find((item) => item.id === 'resume').sub;
  expect(text).toBeTruthy();
  const sub = await page.evaluate((text) => {
    const b = document.querySelector('.re-title-btn.is-primary');
    let s = b.querySelector('.re-title-subtext');
    if (!s) {
      s = document.createElement('span');
      s.className = 're-title-subtext';
      b.classList.add('has-sub');
      b.append(s);
    }
    s.textContent = text;
    // Rendered line boxes (the stage is scaled, so heights are not in font units).
    const range = document.createRange();
    range.selectNodeContents(s);
    const lines = new Set([...range.getClientRects()].map((r) => Math.round(r.top)));
    return { lines: lines.size, clipped: s.scrollWidth > s.clientWidth + 0.5 };
  }, text);
  expect(sub.lines).toBe(1);
  expect(sub.clipped).toBe(false);
}

test.describe('desktop, a Retina screen where the subline snaps up', () => {
  test.use({
    viewport: { width: 1000, height: 700 },
    isMobile: false,
    hasTouch: false,
    deviceScaleFactor: 2,
    userAgent: devices['Desktop Chrome'].userAgent,
  });

  test('the Resume subline stays on one line, nothing cut off', async ({ page }) => {
    await page.goto('/?devScene=title');
    await waitForScene(page, 'Title');
    await expectSublineFits(page);
  });
});
