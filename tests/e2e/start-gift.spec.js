// The shrine's gift with a catch (docs/specs/blessings-v3.md §7, PR D5), on a landscape phone: from
// the save's second run, a pinned seed (?runSeed=6, DEV only; tests/StartGifts.test.js pins
// seed 6 -> the Fallen Hoard) offers a fourth card after the three blessings. Keyboard reaches it
// with No blessing still last; taking it begins the run with its two accessories and no blessing;
// after a reload through the slot the run still carries them and the catch's chip (Hunted), taken
// once. Every wait is on state (scenes, dialogs, the slot's save), never on time.
import { test, expect } from '@playwright/test';
import { attachSlot, pageErrors, phone, quietSettings } from './portraitHelpers.js';
import { installSimPad, padTap, waitForScene } from './helpers.js';

test.setTimeout(120_000);
const { defaultBrowserType: _browser, ...use } = phone({ width: 844, height: 390 });
test.use(use);

const SEED = 6;
const PAD = { CONFIRM: 0, UP: 12, DOWN: 13 };
const savedRun = (page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('emblem_rogue_slot_1_run') || 'null'));
/** The live run on the route map: its gift, blessings, accessories and burdens. */
const routeRun = (page) =>
  page.evaluate(() => {
    const rm = window.__emblemRogueGame.scene.getScene('NodeMap').runManager;
    return {
      gift: rm.startGift?.id ?? null,
      blessings: rm.activeBlessings.length,
      accessories: rm.accessories.map((a) => a.name),
      burdens: rm.burdens,
    };
  });
const shrineOffer = (page) =>
  page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('BlessingSelect');
    return {
      seed: s.runManager.runSeed,
      blessings: s.options.map((o) => o.id),
      gift: s.gift?.id ?? null,
      selected: s.selectedIndex,
    };
  });

/** The shrine of a save's second run on the pinned seed. */
async function openShrine(page) {
  await quietSettings(page);
  await page.goto(`/?devScene=difficulty&mobilePreview=1&gamepadSim=1&runSeed=${SEED}`);
  await page.waitForFunction(() => window.__sceneState?.activeScene === 'DifficultySelect', null, {
    timeout: 60_000,
  });
  await attachSlot(page);
  // One run already started on this save: the gift is offered from the second.
  await page.evaluate(() => {
    const meta = window.__emblemRogueGame.registry.get('meta');
    meta.runsStarted = 1;
    meta._save();
  });
  await page.getByRole('button', { name: 'Confirm', exact: true }).tap();
  await waitForScene(page, 'BlessingSelect');
  const shrine = page.getByRole('dialog', { name: 'Choose a blessing', exact: true });
  await expect(shrine).toBeVisible();
  return shrine;
}

test('the fourth card is the gift: reached by keys, taken once, its catch kept through a reload', async ({
  page,
}) => {
  const errors = pageErrors(page);
  const shrine = await openShrine(page);
  const cards = shrine.locator('.ch-tarot');
  await expect(cards).toHaveCount(4);
  const gift = cards.nth(3);
  await expect(gift).toHaveAttribute('data-tier', 'gift');
  await expect(gift).toHaveAttribute('data-focus', 'choice-3');
  await expect(gift.locator('.ch-tarot-name')).toHaveText('Fallen Hoard');
  await expect(gift.locator('.ch-cost')).toContainText('Catch');
  await expect(gift.locator('.ch-cost')).toContainText('Hunted for the next 3 battles');
  await expect(gift.locator('.ch-numeral .ia-icon')).toHaveAttribute(
    'data-icon-id',
    'generic-accessory',
  );
  // Every card, the gift included, is whole on the phone.
  const viewport = page.viewportSize();
  for (let i = 0; i < 4; i++) {
    const box = await cards.nth(i).boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(-0.5);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 0.5);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 0.5);
  }

  const selected = async () => (await shrineOffer(page)).selected;
  const none = shrine.getByRole('button', { name: 'No blessing', exact: true });
  const focusOf = () => page.evaluate(() => document.activeElement?.dataset?.focus ?? null);

  // Keyboard: the arrows walk the cards, the gift after the blessings, then No blessing (the
  // last choice) before Confirm; Enter selects the focused card.
  await cards.nth(0).focus();
  const order = [await focusOf()];
  for (let i = 0; i < 12 && order.at(-1) !== 'confirm'; i++) {
    await page.keyboard.press('ArrowRight');
    order.push(await focusOf());
  }
  expect(order.filter((f) => f?.startsWith('choice-'))).toEqual([
    'choice-0',
    'choice-1',
    'choice-2',
    'choice-3',
    'choice-4',
  ]);
  expect(await none.getAttribute('data-focus')).toBe('choice-4');
  await gift.focus();
  await page.keyboard.press('Enter');
  await expect.poll(selected).toBe(3);
  await expect(gift).toHaveAttribute('aria-pressed', 'true');
  // The chosen gift's catch is spelt out in the footer, in place of its lore.
  await expect(shrine.locator('.ch-footer-lead')).toContainText('Hunted:');

  // Controller: the pad walks to No blessing and back to the gift, and confirms each.
  await installSimPad(page);
  const focusWithPad = async (control, button) => {
    for (let i = 0; i < 20; i++) {
      if (await control.evaluate((el) => el === document.activeElement)) return;
      await padTap(page, button);
    }
    throw new Error('the pad could not reach the control');
  };
  await focusWithPad(none, PAD.DOWN);
  await padTap(page, PAD.CONFIRM);
  await expect.poll(selected).toBe(4);
  await expect(none).toHaveAttribute('aria-pressed', 'true');
  await focusWithPad(shrine.locator('[data-focus="choice-3"]'), PAD.UP);
  await padTap(page, PAD.CONFIRM);
  await expect.poll(selected).toBe(3);

  // Touch: No blessing, then the gift.
  await none.tap();
  await expect.poll(selected).toBe(4);

  // Take it by touch, and begin.
  await gift.tap();
  await expect(gift).toHaveAttribute('aria-pressed', 'true');
  await shrine.getByRole('button', { name: 'Confirm', exact: true }).tap();
  await waitForScene(page, 'NodeMap');
  const run = await routeRun(page);
  expect(run.gift).toBe('fallen_hoard');
  expect(run.blessings).toBe(0);
  expect(run.accessories).toHaveLength(2);
  expect(run.burdens).toEqual([expect.objectContaining({ id: 'hunted', battles: 3 })]);
  // The run began: the save counted it once.
  expect(
    await page.evaluate(() => window.__emblemRogueGame.registry.get('meta').getRunsStarted()),
  ).toBe(2);
  await expect.poll(async () => (await savedRun(page))?.startGift?.id ?? null).toBe('fallen_hoard');

  // Close the game and come back through the slot: the gift was taken once, the catch is shown.
  await page.evaluate(() => history.replaceState(null, '', '/'));
  await page.reload();
  await waitForScene(page, 'Title');
  const slots = page.getByRole('button', { name: 'Save Slots', exact: true });
  await expect(slots).toBeEnabled();
  await slots.tap();
  await waitForScene(page, 'SlotPicker');
  await page.getByRole('button', { name: 'Select Slot 1', exact: true }).tap();
  await waitForScene(page, 'NodeMap');
  const skip = page.getByRole('button', { name: 'Skip conversation', exact: true });
  if (await skip.isVisible()) await skip.tap();
  const chip = page.locator('.re-burden[data-burden="hunted"]');
  await expect(chip).toBeVisible();
  await expect(chip).toContainText('Hunted');
  expect(await routeRun(page)).toEqual(run);
  // The pause list names the gift and its catch.
  await page.evaluate(() => window.__emblemRogueGame.scene.getScene('NodeMap').showPauseMenu());
  const list = page.getByRole('list', { name: 'Blessings', exact: true });
  await expect(list).toBeVisible();
  await expect(list.locator('li > strong').first()).toHaveText('Fallen Hoard · Gift');
  await expect(list).toContainText('Catch: Hunted for the next 3 battles');
  expect(errors).toEqual([]);
});

test('backing out of the shrine and returning offers the same gift', async ({ page }) => {
  const shrine = await openShrine(page);
  await expect(shrine.locator('.ch-tarot[data-tier="gift"] .ch-tarot-name')).toHaveText(
    'Fallen Hoard',
  );
  const offer = async () => {
    const { seed, blessings, gift } = await shrineOffer(page);
    return { seed, blessings, gift };
  };
  const first = await offer();
  // Back to the difficulty (the run is not begun), then the shrine again (no dev seed now: the
  // slot's kept seed alone decides).
  await page.evaluate(() => history.replaceState(null, '', '/?mobilePreview=1'));
  await shrine.getByRole('button', { name: 'Back', exact: true }).tap();
  await waitForScene(page, 'DifficultySelect');
  await page.getByRole('button', { name: 'Confirm', exact: true }).tap();
  await waitForScene(page, 'BlessingSelect');
  await expect(
    page.getByRole('dialog', { name: 'Choose a blessing', exact: true }).locator('.ch-tarot'),
  ).toHaveCount(4);
  expect(await offer()).toEqual(first);
});
