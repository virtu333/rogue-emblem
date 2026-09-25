// Save select (the candle shrine): all three slots fit without scrolling at phone and
// desktop sizes, each card reads where its run stands, one primary action per card,
// a small confirmed delete, and an empty slot begins a new run.
import { test, expect } from '@playwright/test';
import { waitForScene } from './helpers.js';

test.setTimeout(120000);

const VIEWPORTS = [
  { width: 844, height: 390, phone: true },
  { width: 667, height: 375, phone: true },
  { width: 1280, height: 800, phone: false },
];

async function openPicker(page, { phone, reduceMotion = false }) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(
    (reduceMotion) =>
      localStorage.setItem(
        'emblem_rogue_settings',
        JSON.stringify({ musicVolume: 0, sfxVolume: 0, reduceMotion }),
      ),
    reduceMotion,
  );
  await page.goto(
    `/?devScene=battle&preset=battle_smoke&seed=42${phone ? '&mobilePreview=1' : ''}`,
  );
  await waitForScene(page, 'Battle');
  await page.evaluate(async () => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const { getMetaKey, getRunKey } = await import('/src/engine/SlotManager.js');
    const metaJson = { totalValor: 1240, totalSupply: 860 };
    const run = s.runManager.toJSON();
    // Slot 1: a veteran slot, suspended mid-battle in Act II.
    const suspended = {
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
    };
    localStorage.setItem(
      getMetaKey(1),
      JSON.stringify({ ...metaJson, runsStarted: 5, runsCompleted: 4, milestones: ['beatAct1'] }),
    );
    localStorage.setItem(getRunKey(1), JSON.stringify(suspended));
    // Slot 2: between runs.
    localStorage.setItem(
      getMetaKey(2),
      JSON.stringify({ ...metaJson, runsStarted: 3, runsCompleted: 3, milestones: [] }),
    );
    localStorage.removeItem(getRunKey(2));
    // Slot 3: empty.
    localStorage.removeItem(getMetaKey(3));
    localStorage.removeItem(getRunKey(3));
    const { ensureSceneLoaded } = await import('/src/utils/sceneLoader.js');
    await ensureSceneLoaded(s, 'SlotPicker');
    s.scene.start('SlotPicker', { gameData: s.gameData });
  });
  await waitForScene(page, 'SlotPicker');
  await expect(page.getByRole('dialog', { name: 'Select save', exact: true })).toBeVisible();
  return errors;
}

for (const vp of VIEWPORTS) {
  test(`all three candles fit without scrolling at ${vp.width}x${vp.height}`, async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      ...(vp.phone ? { hasTouch: true, isMobile: true, deviceScaleFactor: 2 } : {}),
    });
    const page = await context.newPage();
    const errors = await openPicker(page, vp);
    const menu = page.getByRole('dialog', { name: 'Select save', exact: true });
    await expect(menu).toContainText('Battle suspended at River Crossing');
    await expect(menu).toContainText('Edric');
    await expect(menu).toContainText('42 min ago');
    await expect(menu).toContainText('Home Base');
    await expect(menu).toContainText('An unlit candle');
    const layout = await page.evaluate(() => {
      const body = document.querySelector('.sp-shrine .re-menu-body');
      const inView = (el) => {
        const r = el.getBoundingClientRect();
        return (
          r.top >= -0.5 &&
          r.left >= -0.5 &&
          r.bottom <= window.innerHeight + 0.5 &&
          r.right <= window.innerWidth + 0.5
        );
      };
      const cards = [...document.querySelectorAll('.sp-card')];
      return {
        scrolls: body.scrollHeight > body.clientHeight + 1,
        cards: cards.length,
        primaries: cards.map((c) => {
          const b = c.querySelector('.sp-primary');
          const r = b.getBoundingClientRect();
          return { inView: inView(b), height: r.height };
        }),
        deletes: [...document.querySelectorAll('.sp-delete')].map((b) => {
          const r = b.getBoundingClientRect();
          return Math.min(r.width, r.height);
        }),
        // Titles clamp at two lines; nothing spills sideways.
        spill: [...document.querySelectorAll('.sp-card *')].some(
          (el) =>
            el.getBoundingClientRect().right >
            el.closest('.sp-card').getBoundingClientRect().right + 1,
        ),
      };
    });
    expect(layout.scrolls).toBe(false);
    expect(layout.cards).toBe(3);
    expect(layout.primaries.every((p) => p.inView && p.height >= 44)).toBe(true);
    expect(layout.deletes).toHaveLength(2);
    expect(layout.deletes.every((size) => size >= 44)).toBe(true);
    expect(layout.spill).toBe(false);
    // Contract names stay: routing tests select and delete by these.
    await expect(page.getByRole('button', { name: 'Select Slot 1', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Delete Slot 2', exact: true })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'New run in Slot 3', exact: true }),
    ).toBeVisible();
    expect(errors).toEqual([]);
    await context.close();
  });
}

test('delete asks first; an empty candle begins a new run in that slot', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 844, height: 390 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  const errors = await openPicker(page, { phone: true });
  await page.getByRole('button', { name: 'Delete Slot 2', exact: true }).tap();
  const confirm = page.getByRole('dialog', { name: 'Delete Slot 2?', exact: true });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Delete save', exact: true }).tap();
  await expect(confirm).toHaveCount(0);
  await expect(page.locator('.sp-card[data-slot="2"]')).toContainText('An unlit candle');
  expect(await page.evaluate(() => localStorage.getItem('emblem_rogue_slot_2_meta'))).toBeNull();

  await page.getByRole('button', { name: 'New run in Slot 3', exact: true }).tap();
  await expect(page.locator('.sp-card[data-slot="3"]')).toHaveClass(/is-kindling/);
  await waitForScene(page, 'NodeMap');
  expect(
    await page.evaluate(() => ({
      meta: localStorage.getItem('emblem_rogue_slot_3_meta') !== null,
      active: window.__emblemRogueGame.registry.get('activeSlot'),
    })),
  ).toEqual({ meta: true, active: 3 });
  expect(errors).toEqual([]);
  await context.close();
});

test('reduced motion stills the embers and skips the kindle beat', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 844, height: 390 } });
  const page = await context.newPage();
  const errors = await openPicker(page, { phone: true, reduceMotion: true });
  const still = await page.evaluate(() => ({
    still: document.querySelector('.sp-shrine').classList.contains('is-still'),
    embers: getComputedStyle(document.querySelector('.sp-embers')).display,
    flame: getComputedStyle(document.querySelector('.sp-candle.is-lit .sp-flame')).animationName,
  }));
  expect(still).toEqual({ still: true, embers: 'none', flame: 'none' });
  await page.getByRole('button', { name: 'Select Slot 2', exact: true }).click();
  await waitForScene(page, 'HomeBase');
  expect(errors).toEqual([]);
  await context.close();
});
