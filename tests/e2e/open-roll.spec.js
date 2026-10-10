import { test, expect } from '@playwright/test';
import { waitForScene, collectErrors } from './helpers.js';
import { PORTRAIT_PHONES, phone } from './portraitHelpers.js';

// Open Roll (docs/specs/blessings-v3.md §5.3): a recruit knot's card shows the second candidate
// and a "Meet X instead" button. A tap swaps who waits there: the card's recruit block names
// the other unit, the button now offers the first back, and the choice is saved (a reload into
// the slot shows it). Desktop, phone sideways and phone upright.

test.setTimeout(120_000);
const VIEWPORTS = [
  { label: 'desktop', width: 1280, height: 800, mobile: false },
  { label: 'phone', width: 844, height: 390, mobile: true },
];

async function swapAndReload(page, vp) {
  const errors = collectErrors(page);
  if (vp.width) await page.setViewportSize({ width: vp.width, height: vp.height });
  await page.addInitScript(() =>
    localStorage.setItem(
      'emblem_rogue_settings',
      JSON.stringify({ musicVolume: 0, sfxVolume: 0, hints: false }),
    ),
  );
  await page.goto(
    `/?devScene=nodemap&preset=battle_smoke&seed=42${vp.mobile ? '&mobilePreview=1' : ''}`,
  );
  await waitForScene(page, 'NodeMap');
  await page.getByRole('button', { name: 'Skip conversation', exact: true }).click();
  const route = page.locator('.re-node-map');
  await expect(route).toBeVisible();

  // A save slot (the swap is saved at once), then take the blessing (as an event would).
  const picked = await page.evaluate(async () => {
    const game = window.__emblemRogueGame;
    const { getMetaKey, setActiveSlot } = await import('/src/engine/SlotManager.js');
    const meta = game.registry.get('meta');
    meta.storageKey = getMetaKey(1);
    meta._save();
    game.registry.set('activeSlot', 1);
    setActiveSlot(1);
    const s = game.scene.getScene('NodeMap');
    const rm = s.runManager;
    if (!rm.addBlessingMidRun('open_roll')) return null;
    s.persistRunSave();
    const node = rm.nodeMap.nodes.find(
      (n) =>
        n.type === 'recruit' &&
        !n.completed &&
        !n.eclipse &&
        rm.getRecruitAlternate(n.id) &&
        !rm.getRecruitNodeUnit(n).isLord,
    );
    if (!node) return null;
    return {
      id: node.id,
      first: rm.getRecruitNodeUnit(node).unit.name,
      second: rm.getRecruitNodeUnit(node, { preview: node.recruitAlternate }).unit.name,
    };
  });
  expect(picked, 'seed 42 act II has a recruit knot with a second candidate').not.toBeNull();
  expect(picked.second).not.toBe(picked.first);

  // The slot's saved preview, read straight from storage (the swap's own save must change it).
  const savedPreviewName = () =>
    page.evaluate(
      (id) =>
        JSON.parse(localStorage.getItem('emblem_rogue_slot_1_run') || 'null')?.nodeMap?.nodes?.find(
          (n) => n.id === id,
        )?.recruitPreview?.name ?? null,
      picked.id,
    );
  expect(await savedPreviewName()).toBe(picked.first);

  await route.locator(`.re-node[data-node="${picked.id}"]`).click();
  const card = route.locator('.re-loom-card');
  await expect(card.locator('.re-loom-recruit-name')).toHaveText(picked.first);
  const alt = card.locator('.re-loom-recruit-alt');
  await expect(alt).toContainText(`also waiting: ${picked.second}`);
  const swap = alt.getByRole('button', { name: `Meet ${picked.second} instead`, exact: true });
  await swap.scrollIntoViewIfNeeded();
  await expect(swap).toBeVisible();
  if (vp.label === 'upright') {
    const box = await swap.boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  await swap.click();

  // The card now meets the second candidate and offers the first back; the focus stays on it.
  await expect(card.locator('.re-loom-recruit-name')).toHaveText(picked.second);
  const back = card.getByRole('button', { name: `Meet ${picked.first} instead`, exact: true });
  await expect(back).toBeVisible();
  await expect(back).toBeFocused();
  await expect(card.locator('.re-loom-place')).toHaveText(new RegExp(`^${picked.second}, `));
  // The card stays inside its pane (no sideways overflow), and the page never scrolls sideways.
  expect(await card.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(1);

  // Saved: the swap's own save (NodeMapMenu.onSwapRecruit) puts the second candidate in the slot
  // before anything reloads; the slot held the first one until then.
  await expect.poll(savedPreviewName).toBe(picked.second);

  // Reload into the slot: the knot still meets the second candidate.
  await page.evaluate(() => history.replaceState(null, '', '/'));
  await page.reload();
  await waitForScene(page, 'Title');
  await page.getByRole('button', { name: 'Save Slots', exact: true }).click();
  await waitForScene(page, 'SlotPicker');
  await page.getByRole('button', { name: 'Select Slot 1', exact: true }).click();
  await waitForScene(page, 'NodeMap');
  const skip = page.getByRole('button', { name: 'Skip conversation', exact: true });
  if (await skip.count()) await skip.click();
  const loaded = await page.evaluate((id) => {
    const rm = window.__emblemRogueGame.scene.getScene('NodeMap').runManager;
    const node = rm.nodeMap.nodes.find((n) => n.id === id);
    return rm.getRecruitNodeUnit(node).unit.name;
  }, picked.id);
  expect(loaded).toBe(picked.second);
  await page.locator(`.re-node[data-node="${picked.id}"]`).click();
  await expect(page.locator('.re-loom-card .re-loom-recruit-name')).toHaveText(picked.second);
  await expect(
    page.locator('.re-loom-card').getByRole('button', {
      name: `Meet ${picked.first} instead`,
      exact: true,
    }),
  ).toBeVisible();
  expect(errors).toEqual([]);
}

for (const vp of VIEWPORTS) {
  test(`Open Roll swaps a recruit knot's candidate and keeps it (${vp.label})`, async ({
    page,
  }) => {
    await swapAndReload(page, vp);
  });
}

test.describe('upright phone', () => {
  test.use(phone(PORTRAIT_PHONES[0]));
  test("Open Roll swaps a recruit knot's candidate and keeps it (upright)", async ({ page }) => {
    await swapAndReload(page, { label: 'upright', mobile: false });
  });
});
