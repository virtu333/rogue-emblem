// The draft: every "choose one" screen as cards side by side
// (docs/art-direction/choice-screens/README.md). Each redesigned screen is
// driven through its real flow at the phone size it was designed for, with
// layout checks (all cards in view, no horizontal scroll, the cost of a
// blessing never faded away), selection semantics, input (touch, keyboard),
// reduced motion and the hand-off to the join ceremony.
import { test, expect } from '@playwright/test';

// Boot can be slow on a busy machine: wait for the scene generously (this is
// a readiness wait, not an assertion about the screens).
async function waitForScene(page, key) {
  await page.waitForFunction((k) => window.__sceneState?.activeScene === k, key, {
    timeout: 60_000,
  });
}

const PHONE = { width: 844, height: 390 };
const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';

const DESKTOP_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

test.use({ viewport: PHONE, hasTouch: true, userAgent: IPHONE_UA });

async function settings(page, extra = {}) {
  await page.addInitScript((extra) => {
    localStorage.setItem(
      'emblem_rogue_settings',
      JSON.stringify({ musicVolume: 0, sfxVolume: 0, hints: false, ...extra }),
    );
  }, extra);
}
async function battle(page) {
  await page.goto('/?devScene=battle&preset=battle_smoke&seed=42&mobilePreview=1&battleLab=1');
  await waitForScene(page, 'Battle');
}
async function snap(page, info, name) {
  await page.screenshot({ path: info.outputPath(`${name}.png`) });
}
/** Every card of a row lies inside the viewport and the dialog never scrolls sideways. */
async function expectDraftInView(page, dialog, selector) {
  const cards = dialog.locator(selector);
  const count = await cards.count();
  expect(count).toBeGreaterThan(0);
  const viewport = page.viewportSize();
  for (let i = 0; i < count; i++) {
    const box = await cards.nth(i).boundingBox();
    expect(box, `card ${i} rendered`).toBeTruthy();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 0.5);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 0.5);
  }
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  return count;
}
async function openBossRecruit(page) {
  await page.evaluate(async () => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const { BossRecruitOverlay } = await import('/src/ui/BossRecruitOverlay.js');
    window.chosen = [];
    new BossRecruitOverlay(s, s.runManager, s.gameData).show((unit) => {
      window.chosen.push(unit?.name ?? null);
    });
  });
  const dialog = page.getByRole('dialog', { name: 'Boss recruit', exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

test('boss recruit: three candidates side by side, compared, chosen and sworn once', async ({
  page,
}, info) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await settings(page);
  await battle(page);
  const dialog = await openBossRecruit(page);
  const cards = dialog.locator('.ch-card');
  const count = await expectDraftInView(page, dialog, '.ch-card');
  expect(count).toBe(3);
  // Each card: PC-98 portrait, class crest, level/HP, seven compared stats.
  for (let i = 0; i < count; i++) {
    const card = cards.nth(i);
    await expect(card.locator('.ch-portrait').first()).toBeVisible();
    await expect(card.locator('.ch-crest')).toHaveCount(1);
    await expect(card.locator('.ch-name')).not.toBeEmpty();
    await expect(card.locator('.ch-stat')).toHaveCount(7);
    await expect(card.locator('.ch-hp')).toContainText(/Lv \d+/);
    // The Cinzel name fits its card (fitted, never clipped sideways).
    expect(await card.locator('.ch-name').evaluate((n) => n.scrollWidth <= n.clientWidth + 1)).toBe(
      true,
    );
  }
  // The draft marks its best: at least one stat leads across three candidates.
  expect(await dialog.locator('.ch-stat.is-best, .ch-hp.is-best').count()).toBeGreaterThan(0);
  await expect(cards.nth(0)).toHaveAttribute('aria-pressed', 'true');
  await snap(page, info, 'boss-first');

  // Touch a second card: it lifts, the first steps back.
  const second = cards.nth(1);
  const name = await second.locator('.ch-name').textContent();
  await second.tap();
  await expect(second).toHaveAttribute('aria-pressed', 'true');
  await expect(cards.nth(0)).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => second.evaluate((el) => getComputedStyle(el).transform)).not.toBe('none');
  await expect
    .poll(() => cards.nth(0).evaluate((el) => Number(getComputedStyle(el).opacity)))
    .toBeLessThan(1);
  await snap(page, info, 'boss-second');

  // Keyboard: arrows walk the cards, Enter selects the focused one.
  await second.focus();
  await page.keyboard.press('ArrowRight');
  await expect(cards.nth(2)).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(second).toBeFocused();

  await dialog.getByRole('button', { name: 'Recruit', exact: true }).tap();
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => window.chosen)).toEqual([name.trim()]);
  expect(errors).toEqual([]);
});

test('boss recruit in the real flow hands the sworn unit to the join ceremony', async ({
  page,
}) => {
  await settings(page);
  await battle(page);
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    window.rosterBefore = s.runManager.roster.length;
    s.showLootScreen = () => {
      window.lootShown = true;
    };
    s.runManager.shouldTriggerThirdLord = () => false;
    s.showBossRecruitScreen();
  });
  const dialog = page.getByRole('dialog', { name: 'Boss recruit', exact: true });
  await expect(dialog).toBeVisible();
  const third = dialog.locator('.ch-card').nth(2);
  const name = (await third.locator('.ch-name').textContent()).trim();
  await third.tap();
  await dialog.getByRole('button', { name: 'Recruit', exact: true }).tap();
  const join = page.locator('.gr-join-layer');
  await expect(join).toBeVisible();
  await expect(join).toContainText(name);
  expect(
    await page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      return s.runManager.roster.length - window.rosterBefore;
    }),
  ).toBe(1);
  await page.waitForTimeout(250);
  await join.tap();
  await expect.poll(() => page.evaluate(() => window.lootShown === true)).toBe(true);
});

test('reduced motion: cards hold still and the confirm seals at once', async ({ page }) => {
  await settings(page, { reduceMotion: true });
  await battle(page);
  const dialog = await openBossRecruit(page);
  await expect(dialog).toHaveClass(/is-still/);
  const chosen = dialog.locator('.ch-card[aria-pressed="true"]');
  expect(await chosen.evaluate((el) => getComputedStyle(el).transform)).toBe('none');
  const sprite = dialog.locator('.ch-sprite.is-idle').first();
  if (await sprite.count())
    expect(await sprite.evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
  await dialog.getByRole('button', { name: 'Recruit', exact: true }).tap();
  // No sealing beat to wait for: resolved in the same tick as the tap.
  expect(await page.evaluate(() => window.chosen.length)).toBe(1);
});

test('lord arrival: Welcome is required, reroll is offered, the choice resolves once', async ({
  page,
}, info) => {
  await settings(page);
  await battle(page);
  await page.evaluate(async () => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    s.runManager.metaEffects.thirdLordMode = 'pick3_reroll';
    const { LordArrivalOverlay } = await import('/src/ui/LordArrivalOverlay.js');
    window.welcomed = [];
    new LordArrivalOverlay(s, s.runManager, s.gameData).show((unit) =>
      window.welcomed.push(unit?.name),
    );
  });
  const dialog = page.getByRole('dialog', { name: 'Lord arrival', exact: true });
  await expect(dialog).toBeVisible();
  await expectDraftInView(page, dialog, '.ch-card');
  await expect(dialog.locator('.ch-kicker').first()).toContainText('Lord');
  await page.keyboard.press('Escape');
  await expect(dialog.getByRole('status')).toContainText('Choose a lord');
  await expect(dialog.getByRole('button', { name: 'Reroll', exact: true })).toBeVisible();
  await snap(page, info, 'lord-arrival');
  await dialog.locator('.ch-card').last().tap();
  await dialog.getByRole('button', { name: 'Welcome', exact: true }).tap();
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => window.welcomed.length)).toBe(1);
});

test('mercenary board: priced cards, a contract, one hire, the Hired stamp', async ({
  page,
}, info) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await settings(page);
  await page.goto('/?devScene=nodemap&mobilePreview=1');
  await waitForScene(page, 'NodeMap');
  const skip = page.getByRole('button', { name: 'Skip conversation', exact: true });
  await skip.waitFor({ state: 'visible' }).catch(() => {});
  if (await skip.isVisible().catch(() => false)) await skip.tap();
  await page.evaluate(async () => {
    const s = window.__emblemRogueGame.scene.getScene('NodeMap');
    s.registry.set('activeSlot', 1);
    s.runManager.gold = 5000;
    const { ColosseumOverlay } = await import('/src/ui/ColosseumOverlay.js');
    window.arena = new ColosseumOverlay(s, s.runManager, s.gameData);
    window.arena.show(s.runManager.getAvailableNodes()[0], () => {});
  });
  await page.getByRole('button', { name: 'Mercenary board', exact: true }).tap();
  const board = page.getByRole('dialog', { name: 'Mercenary board', exact: true });
  const count = await expectDraftInView(page, board, '.ch-card');
  await expect(board.locator('.ch-seal')).toHaveCount(count);
  await snap(page, info, 'mercenary-board');
  const first = board.locator('.ch-card').first();
  const name = (await first.locator('.ch-name').textContent()).trim();
  const cost = await page.evaluate(() => window.arena._mercCandidates[0].hireCost);
  await first.tap();
  const contract = page.getByRole('dialog', { name: `Hire ${name}`, exact: true });
  await expect(contract).toContainText(`Hire cost: ${cost} G`);
  await expect(contract.locator('.ch-card.is-chosen')).toHaveCount(1);
  await snap(page, info, 'mercenary-contract');
  await contract.getByRole('button', { name: 'Confirm hire', exact: true }).tap();
  const join = page.locator('.gr-join-layer');
  await expect(join).toBeVisible();
  await page.waitForTimeout(250);
  await join.tap();
  await expect(board.locator('.ch-stamp')).toHaveText('Hired');
  expect(await page.evaluate(() => window.arena.runManager.gold)).toBe(5000 - cost);
  expect(errors).toEqual([]);
});

test('battle rewards: rarity-framed cards with art, for whom, and an elite second pick', async ({
  page,
}, info) => {
  await settings(page);
  await battle(page);
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    s.isElite = true;
    s.onVictory();
  });
  const dialog = page.getByRole('dialog', { name: 'Battle rewards', exact: true });
  // An elite victory may speak first (story lines): read through them.
  const story = page.getByRole('dialog', { name: 'Story', exact: true });
  await expect(dialog.or(story)).toBeVisible();
  while (await story.isVisible().catch(() => false)) {
    await story.getByRole('button', { name: 'Continue', exact: true }).tap();
    await page.waitForTimeout(300);
  }
  await expect(dialog).toBeVisible();
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const r = s._lootController.mobileRewards;
    const steel = s.gameData.weapons.find((w) => w.name === 'Steel Sword');
    r.choices[0] = { type: 'weapon', item: structuredClone(steel) };
    r.selected = 0;
    r.render();
  });
  const cards = dialog.locator('.reward-card');
  const count = await expectDraftInView(page, dialog, '.reward-card');
  await expect(dialog.locator('[data-item-art-hook="item-icon"]')).toHaveCount(count);
  await expect(cards.first().locator('.ch-item-icon')).toBeVisible();
  // For whom: the Steel Sword names the wielder who gains the most attack.
  await expect(cards.first().locator('.ch-forwhom')).toContainText(/For \w+/);
  await expect(cards.first().locator('.ch-forwhom')).toContainText(/Atk \d+ → \d+/);
  await expect(cards.last()).toContainText(/Take \d+ gold instead/);
  await snap(page, info, 'rewards');
  // Claim the gold bundle straight away (second card), then the elite pick remains.
  const goldIndex = await page.evaluate(() =>
    window.__emblemRogueGame.scene
      .getScene('Battle')
      ._lootController.mobileRewards.choices.findIndex((c) => c.type === 'gold'),
  );
  test.skip(goldIndex < 0, 'this roll has no gold bundle');
  await cards.nth(goldIndex).tap();
  await expect(cards.nth(goldIndex)).toHaveAttribute('aria-pressed', 'true');
  await dialog.getByRole('button', { name: 'Choose reward', exact: true }).tap();
  await expect(dialog.getByRole('button', { name: 'Choose reward', exact: true })).toBeVisible();
  await expect(cards.nth(goldIndex)).toBeDisabled();
  await expect(cards.nth(goldIndex).locator('.ch-stamp')).toHaveText('Claimed');
  await expect(dialog.locator('button[aria-pressed="true"]')).toBeFocused();
  await snap(page, info, 'rewards-claimed');
});

test('blessings as tarot: the cost is always in view, No blessing sits by Confirm', async ({
  page,
}, info) => {
  await settings(page);
  await page.goto('/?devScene=difficulty&mobilePreview=1');
  await waitForScene(page, 'DifficultySelect');
  await page.getByRole('button', { name: 'Confirm', exact: true }).tap();
  await waitForScene(page, 'BlessingSelect');
  const dialog = page.getByRole('dialog', { name: 'Choose a blessing', exact: true });
  await expect(dialog).toBeVisible();
  // The widest real hand: four blessings with the longest names and costs.
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('BlessingSelect');
    const pool = s.gameData.blessings.costPools || {};
    s.options = ['quartermaster_cache', 'focused_curriculum', 'forbidden_tome', 'war_tutelage'].map(
      (id) => {
        const b = structuredClone(s.gameData.blessings.blessings.find((x) => x.id === id));
        const costs = pool[String(b.tier)];
        if (costs?.length)
          b.rolledCost = costs.reduce((a, c) => (c.label.length > a.label.length ? c : a));
        return b;
      },
    );
    s._draw();
  });
  const count = await expectDraftInView(page, dialog, '.ch-tarot');
  expect(count).toBe(4);
  for (let i = 0; i < count; i++) {
    const card = dialog.locator('.ch-tarot').nth(i);
    const cardBox = await card.boundingBox();
    const costBox = await card.locator('.ch-cost').boundingBox();
    expect(costBox.y + costBox.height).toBeLessThanOrEqual(cardBox.y + cardBox.height + 0.5);
    const nameFits = await card
      .locator('.ch-tarot-name')
      .evaluate((n) => n.scrollWidth <= n.clientWidth + 1 && n.scrollHeight <= n.clientHeight + 1);
    expect(nameFits).toBe(true);
  }
  await dialog.locator('.ch-tarot').nth(2).tap();
  await expect(dialog.locator('[data-focus="choice-2"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog.locator('.ch-footer-lead')).not.toBeEmpty();
  await snap(page, info, 'blessings');
  await dialog.getByRole('button', { name: 'No blessing', exact: true }).tap();
  await expect(dialog.getByRole('button', { name: 'No blessing', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await dialog.getByRole('button', { name: 'Confirm', exact: true }).tap();
  await waitForScene(page, 'NodeMap');
});

test('difficulty banners: locked modes say why, the terms read beneath', async ({ page }, info) => {
  await settings(page);
  await page.goto('/?devScene=difficulty&mobilePreview=1');
  await waitForScene(page, 'DifficultySelect');
  const dialog = page.getByRole('dialog', { name: 'Choose difficulty', exact: true });
  await expect(dialog).toBeVisible();
  expect(await expectDraftInView(page, dialog, '.ch-banner')).toBe(3);
  await expect(dialog.locator('article')).toContainText('the terms');
  await dialog.getByRole('button', { name: /^Hard/ }).tap();
  await expect(dialog.locator('.ch-banner[data-mode="hard"]')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(dialog.locator('article')).toContainText('Beat the game');
  await expect(dialog.locator('.ch-banner[data-mode="hard"] .ch-lock')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Confirm', exact: true })).toBeDisabled();
  await snap(page, info, 'difficulty-hard');
});

for (const { width, height, touch, preview } of [
  { width: 667, height: 375, touch: true, preview: true },
  { width: 1000, height: 460, touch: true, preview: false },
  { width: 1280, height: 800, touch: false, preview: false },
])
  test.describe(`at ${width}x${height}`, () => {
    test.use({
      viewport: { width, height },
      hasTouch: touch,
      userAgent: touch ? IPHONE_UA : DESKTOP_UA,
    });
    test('draft rows fit: recruits and rewards, confirm in view', async ({ page }, info) => {
      await settings(page);
      await page.goto(
        `/?devScene=battle&preset=battle_smoke&seed=42&battleLab=1${preview ? '&mobilePreview=1' : ''}`,
      );
      await waitForScene(page, 'Battle');
      const recruit = await openBossRecruit(page);
      await expectDraftInView(page, recruit, '.ch-card');
      await expect(recruit.getByRole('button', { name: 'Recruit', exact: true })).toBeInViewport();
      await snap(page, info, `boss-${width}`);
      await recruit.getByRole('button', { name: 'Skip recruit', exact: true }).click();
      await expect(recruit).toHaveCount(0);
      await page.evaluate(() => window.__emblemRogueGame.scene.getScene('Battle').onVictory());
      const rewards = page.getByRole('dialog', { name: 'Battle rewards', exact: true });
      await expect(rewards).toBeVisible();
      await expectDraftInView(page, rewards, '.reward-card');
      await expect(
        rewards.getByRole('button', { name: 'Choose reward', exact: true }),
      ).toBeInViewport();
      await snap(page, info, `rewards-${width}`);
    });
  });
