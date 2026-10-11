import { test, expect } from '@playwright/test';
import { waitForScene, collectErrors } from './helpers.js';
import { PORTRAIT_PHONES, phone } from './portraitHelpers.js';

// Twin Chapel (docs/specs/blessings-v3.md §5.3): a church accepts two different vows. The vow
// line says so before any vow, says the second is still open after the first, and names both
// once they are made; the vow not made stays closed; a reload keeps both. Phone sideways and
// phone upright.

test.setTimeout(120_000);

async function twoVows(page, { preview }) {
  const errors = collectErrors(page);
  await page.addInitScript(() =>
    localStorage.setItem(
      'emblem_rogue_settings',
      JSON.stringify({ musicVolume: 0, sfxVolume: 0, hints: false }),
    ),
  );
  await page.goto(`/?devScene=nodemap&seed=42${preview ? '&mobilePreview=1' : ''}`);
  await waitForScene(page, 'NodeMap');
  const skip = page.getByRole('button', { name: 'Skip conversation', exact: true });
  await skip.waitFor({ state: 'visible' });
  await skip.click();
  const nodeId = await page.evaluate(async () => {
    const game = window.__emblemRogueGame;
    const { getMetaKey, setActiveSlot } = await import('/src/engine/SlotManager.js');
    const { addBurden } = await import('/src/engine/Burdens.js');
    const meta = game.registry.get('meta');
    meta.storageKey = getMetaKey(1);
    meta._save();
    game.registry.set('activeSlot', 1);
    setActiveSlot(1);
    const s = game.scene.getScene('NodeMap');
    const rm = s.runManager;
    rm.addBlessingMidRun('twin_chapel');
    // A burden the altar can lift, so Cleansing is the second vow on offer.
    addBurden(rm, 'ill_omen', {});
    const node = rm.getAvailableNodes()[0];
    node.type = 'church';
    rm.currentNodeId = node.id;
    s.persistRunSave();
    s.handleChurch(node);
    return node.id;
  });
  const church = page.getByRole('dialog', { name: 'Church', exact: true });
  await expect(church).toBeVisible();
  const line = church.locator('.church-vow-line');
  await expect(church.getByRole('heading', { name: 'Your vows here', exact: true })).toBeVisible();
  await expect(line).toHaveText(
    'Promote your units, take a blessing or lift a burden: two different vows per church (Twin Chapel). The first promotion, the blessing or the cleansing makes each.',
  );

  // First vow: a blessing. Its confirmation says a second vow stays open.
  const blessing = church.locator('.church-blessing').first();
  await blessing.scrollIntoViewIfNeeded();
  const blessingName = (await blessing.textContent()).split(' · ')[0];
  await blessing.click();
  const take = page.getByRole('dialog', { name: `Take ${blessingName}?`, exact: true });
  await expect(take).toContainText(
    'Twin Chapel: this is one of your vows here; one more stays open.',
  );
  await take.getByRole('button', { name: 'Take the blessing', exact: true }).click();
  await expect(line).toHaveText(
    'Your vow here was a Blessing. Twin Chapel: one more vow is open, each a different one.',
  );
  await expect(church.locator('.church-blessing')).toHaveCount(0);

  // Second vow: Cleansing. Its confirmation says it is the last vow here.
  const cleanse = church.locator('.church-cleanse[data-burden="ill_omen"]');
  await cleanse.scrollIntoViewIfNeeded();
  await expect(cleanse).toBeEnabled();
  await cleanse.click();
  const lift = page.getByRole('dialog', { name: /^Lift / });
  await expect(lift).toContainText('This is your last vow here: this church will promote no one.');
  await lift.getByRole('button', { name: 'Lift the burden', exact: true }).click();
  await expect(line).toHaveText(
    'Your vows here were a Blessing and Cleansing: this altar promotes no one.',
  );
  const saved = await page.evaluate(
    (id) => JSON.parse(localStorage.getItem('emblem_rogue_slot_1_run')).churchVowByNodeId[id],
    nodeId,
  );
  expect(saved).toEqual(['blessing', 'cleanse']);
  // No sideways scroll on the menu.
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(1);

  // Reload into the slot and re-enter: both vows are kept.
  await page.evaluate(() => history.replaceState(null, '', '/'));
  await page.reload();
  await waitForScene(page, 'Title');
  await page.getByRole('button', { name: 'Save Slots', exact: true }).click();
  await waitForScene(page, 'SlotPicker');
  await page.getByRole('button', { name: 'Select Slot 1', exact: true }).click();
  await waitForScene(page, 'NodeMap');
  await page.evaluate((id) => {
    const s = window.__emblemRogueGame.scene.getScene('NodeMap');
    s.handleChurch(s.runManager.nodeMap.nodes.find((n) => n.id === id));
  }, nodeId);
  await expect(
    page.getByRole('dialog', { name: 'Church', exact: true }).locator('.church-vow-line'),
  ).toHaveText('Your vows here were a Blessing and Cleansing: this altar promotes no one.');
  expect(errors).toEqual([]);
}

test.describe('phone sideways', () => {
  test.use({ viewport: { width: 844, height: 390 } });
  test('Twin Chapel: two different vows at one church, kept across a reload', async ({ page }) => {
    await twoVows(page, { preview: true });
  });
});

test.describe('phone upright', () => {
  test.use(phone(PORTRAIT_PHONES[0]));
  test('Twin Chapel: two different vows at one church, kept across a reload (upright)', async ({
    page,
  }) => {
    await twoVows(page, { preview: false });
  });
});
