// The draft on an upright phone (docs/art-direction/choice-screens/README.md,
// "Upright phones"). With html.portrait-ui the shared card layout becomes one
// scrolling column of full-width rows, the footer wraps onto at most two rows
// with the primary action last, and the rewards header never breaks a control
// mid-word. Without the class, landscape and desktop keep the row of cards
// exactly as on main.
//
// Failure modes each check below is written to catch:
//   1. cards stay side by side on a narrow screen and overlap or clip their titles;
//   2. the footer does not wrap, pushing the primary action (Confirm) off-screen;
//   3. the primary action or a footer control is covered, cut off or under 44 px;
//   4. the page (or the dialog, or the list) scrolls sideways;
//   5. a card below the fold cannot be reached, or a tap on it selects the wrong
//      card, or the rebuilt list jumps away from the card just chosen;
//   6. a header control wraps or breaks mid-word (Roster / Menu / View map);
//   7. a portrait rule leaks into landscape or desktop (card boxes move).
// Each flow also completes the real choice (scene change, recruit, reward applied),
// so a layout that looks right but swallows the tap still fails.
//
// The portrait shell sets html.portrait-ui for a real opt-in (the stored preference,
// a touch screen, upright), so the portrait specs opt in; they also set the class
// themselves and hide the rotate prompt for a build without the shell.
import { test, expect } from '@playwright/test';

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';
const DESKTOP_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const TAP = 44;

async function waitForScene(page, key) {
  await page.waitForFunction((k) => window.__sceneState?.activeScene === k, key, {
    timeout: 60_000,
  });
}

async function boot(page, { portrait = false, seeded = false } = {}) {
  await page.addInitScript(() =>
    localStorage.setItem(
      'emblem_rogue_settings',
      JSON.stringify({ musicVolume: 0, sfxVolume: 0, hints: false }),
    ),
  );
  // The mercenary board rolls with Math.random: seed it so a layout comparison
  // always sees the same number of cards. Other code draws from Math.random every
  // frame, so openMercBoard restarts the stream (__reseedRandom) just before the roll.
  if (seeded)
    await page.addInitScript(() => {
      let a = 1234567;
      window.__reseedRandom = () => {
        a = 1234567;
      };
      Math.random = () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    });
  if (portrait)
    await page.addInitScript(() => {
      localStorage.setItem('emblem_rogue_portrait_battles', 'on');
      const apply = () => {
        document.documentElement.classList.add('portrait-ui');
        const style = document.createElement('style');
        style.textContent = '#rotate-prompt{display:none!important}';
        document.documentElement.append(style);
      };
      if (document.documentElement) apply();
      else
        new MutationObserver((_, observer) => {
          if (!document.documentElement) return;
          observer.disconnect();
          apply();
        }).observe(document, { childList: true });
    });
}

// ── Screens ─────────────────────────────────────────────────────────────

async function openDifficulty(page, preview) {
  await page.goto(`/?devScene=difficulty${preview ? '&mobilePreview=1' : ''}`);
  await waitForScene(page, 'DifficultySelect');
  const dialog = page.getByRole('dialog', { name: 'Choose difficulty', exact: true });
  await expect(dialog.locator('.ch-banner')).toHaveCount(3);
  return dialog;
}

/**
 * The widest hand: four blessings with the longest names and the longest costs
 * (the run's own offer is kept aside: only an offered blessing can be taken).
 */
async function longestBlessings(page) {
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('BlessingSelect');
    window.__offered ??= s.options;
    const pool = s.gameData.blessings.costPools || {};
    const ids = ['quartermaster_cache', 'focused_curriculum', 'forbidden_tome', 'war_tutelage'];
    s.options = ids.map((id) => {
      const b = structuredClone(s.gameData.blessings.blessings.find((x) => x.id === id));
      const costs = pool[String(b.tier)];
      if (costs?.length)
        b.rolledCost = costs.reduce((a, c) => (c.label.length > a.label.length ? c : a));
      return b;
    });
    s._draw();
  });
}

async function openBattle(page, preview) {
  await page.goto(
    `/?devScene=battle&preset=battle_smoke&seed=42&battleLab=1${preview ? '&mobilePreview=1' : ''}`,
  );
  await waitForScene(page, 'Battle');
  await page.waitForFunction(() => window.__sceneState?.battle?.state === 'PLAYER_IDLE', null, {
    timeout: 30_000,
  });
}

/** Boss recruit through the real menu, the candidates renamed to the longest names. */
async function openBossRecruit(page) {
  await page.evaluate(async () => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const { generateBossRecruitCandidates } = await import('/src/engine/BossRecruitSystem.js');
    const { showArrivalMenu } = await import('/src/ui/PartyMenus.js');
    const rm = s.runManager;
    const candidates = generateBossRecruitCandidates(
      rm.currentAct,
      rm.roster,
      s.gameData,
      rm.getEffectiveMetaEffects(),
      [],
    );
    // Longest recruit names in recruits.json's namePool.
    ['Constance', 'Benedetta', 'Emmeline'].forEach((name, i) => {
      if (candidates[i]) candidates[i].unit.name = name;
    });
    window.chosen = [];
    window.__owner = { scene: s, gameData: s.gameData, runManager: rm };
    const resolve = (unit) => {
      window.chosen.push(unit?.name ?? null);
      window.__owner.domMenu.destroy();
    };
    showArrivalMenu(window.__owner, 'Boss recruit', candidates, resolve, { skip: true });
  });
  const dialog = page.getByRole('dialog', { name: 'Boss recruit', exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function openLordArrival(page) {
  await page.evaluate(async () => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    s.runManager.metaEffects.thirdLordMode = 'pick3_reroll';
    const { LordArrivalOverlay } = await import('/src/ui/LordArrivalOverlay.js');
    window.welcomed = [];
    new LordArrivalOverlay(s, s.runManager, s.gameData).show((unit) =>
      window.welcomed.push(unit?.name ?? null),
    );
  });
  const dialog = page.getByRole('dialog', { name: 'Lord arrival', exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Battle rewards with the longest spoils in the data: five cards with the gold. */
async function openRewards(page) {
  await page.evaluate(() => window.__emblemRogueGame.scene.getScene('Battle').onVictory());
  const dialog = page.getByRole('dialog', { name: 'Battle rewards', exact: true });
  await expect(dialog).toBeVisible();
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const r = s._lootController.mobileRewards;
    r.reveal?.skip();
    const find = (list, name) => {
      const item = list.find((x) => x.name === name);
      if (!item) throw new Error(`No ${name} in the game data`);
      return structuredClone(item);
    };
    const consumables = s.gameData.consumables?.consumables || s.gameData.consumables || [];
    const accessories = s.gameData.accessories?.accessories || s.gameData.accessories || [];
    // Mutated in place: the reward record shares this array with its controller.
    r.choices.splice(
      0,
      r.choices.length,
      { type: 'skillScroll', item: find(s.gameData.weapons, "Hunter's Volley Scroll") },
      { type: 'accessory', item: find(accessories, "Bounty Hunter's Mark") },
      { type: 'weapon', item: find(s.gameData.weapons, 'Gale Blade') },
      { type: 'healing', item: find(consumables, 'Infantry Seal'), quantity: 2 },
    );
    r.selected = 0;
    r.render();
  });
  await expect(dialog.locator('.reward-card')).toHaveCount(5);
  await expect(dialog.locator('.ia-revealing')).toHaveCount(0);
  return dialog;
}

async function openMercBoard(page, preview) {
  await page.goto(`/?devScene=nodemap${preview ? '&mobilePreview=1' : ''}`);
  await waitForScene(page, 'NodeMap');
  const skip = page.getByRole('button', { name: 'Skip conversation', exact: true });
  try {
    await skip.waitFor({ state: 'visible', timeout: 8_000 });
    await skip.click();
    await skip.waitFor({ state: 'detached', timeout: 10_000 });
  } catch {
    // No opening conversation on this route.
  }
  await page.evaluate(async () => {
    const s = window.__emblemRogueGame.scene.getScene('NodeMap');
    s.registry.set('activeSlot', 1);
    s.runManager.gold = 5000;
    const { ColosseumOverlay } = await import('/src/ui/ColosseumOverlay.js');
    window.arena = new ColosseumOverlay(s, s.runManager, s.gameData);
    // A seeded page rolls the board from the start of its stream, however many
    // frames ran before the tap.
    const browse = window.arena._showMercBrowse.bind(window.arena);
    window.arena._showMercBrowse = (...args) => {
      window.__reseedRandom?.();
      return browse(...args);
    };
    window.arena.show(s.runManager.getAvailableNodes()[0], () => {});
  });
  await page.getByRole('button', { name: 'Mercenary board', exact: true }).click();
  const board = page.getByRole('dialog', { name: 'Mercenary board', exact: true });
  await expect(board.locator('.ch-card').first()).toBeVisible();
  return board;
}

// ── Portrait checks ─────────────────────────────────────────────────────

/**
 * The draft as a list: every card a full-width row; after scrolling each into
 * view its title is whole (not clipped by the card, the list or the viewport);
 * no two cards overlap; nothing scrolls sideways.
 */
async function expectPortraitDraft(page, dialog, card, title) {
  const cards = dialog.locator(card);
  const count = await cards.count();
  expect(count).toBeGreaterThan(0);
  const viewport = page.viewportSize();
  for (let i = 0; i < count; i++) {
    await cards.nth(i).scrollIntoViewIfNeeded();
    const facts = await cards.nth(i).evaluate((el, title) => {
      const r = (n) => n.getBoundingClientRect();
      const name = el.querySelector(title);
      const list = el.closest('.ch-draft, .ch-contract') || el.parentElement;
      const clip = r(list);
      return {
        card: r(el).toJSON(),
        name: r(name).toJSON(),
        list: clip.toJSON(),
        text: name.textContent.trim(),
        // Whole words, never cut: the title's own box holds its text.
        nameFits: name.scrollWidth <= name.clientWidth + 1,
        listWidth: list.getBoundingClientRect().width,
      };
    }, title);
    const { card: c, name: n, list } = facts;
    expect(facts.text.length, `card ${i} has a title`).toBeGreaterThan(0);
    expect(facts.nameFits, `"${facts.text}" fits its line`).toBe(true);
    // A row: the card spans (almost) the whole list, not a narrow column.
    expect(c.width, `card ${i} is a full-width row`).toBeGreaterThanOrEqual(facts.listWidth - 16);
    expect(n.left).toBeGreaterThanOrEqual(c.left - 0.5);
    expect(n.right).toBeLessThanOrEqual(c.right + 0.5);
    expect(n.top).toBeGreaterThanOrEqual(c.top - 0.5);
    expect(n.bottom).toBeLessThanOrEqual(c.bottom + 0.5);
    expect(n.top, `"${facts.text}" not under the list's top edge`).toBeGreaterThanOrEqual(
      list.top - 0.5,
    );
    expect(n.bottom, `"${facts.text}" not under the list's foot`).toBeLessThanOrEqual(
      list.bottom + 0.5,
    );
    expect(n.left).toBeGreaterThanOrEqual(0);
    expect(n.right).toBeLessThanOrEqual(viewport.width + 0.5);
    expect(n.bottom).toBeLessThanOrEqual(viewport.height + 0.5);
  }
  // No overlap, measured at one scroll position.
  const rects = await cards.evaluateAll((els) =>
    els.map((el) => el.getBoundingClientRect().toJSON()),
  );
  for (let i = 0; i < rects.length; i++)
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i];
      const b = rects[j];
      const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      expect(w > 0.5 && h > 0.5, `cards ${i} and ${j} overlap`).toBe(false);
    }
  await expectNoSidewaysScroll(page, dialog);
  return count;
}

async function expectNoSidewaysScroll(page, dialog) {
  const widths = await dialog.evaluate((el) => {
    const draft = el.querySelector('.ch-draft');
    return {
      page: document.documentElement.scrollWidth <= window.innerWidth,
      dialog: el.scrollWidth <= el.clientWidth + 1,
      draft: !draft || draft.scrollWidth <= draft.clientWidth + 1,
    };
  });
  expect(widths).toEqual({ page: true, dialog: true, draft: true });
}

/** A control a thumb can hit: whole in the viewport, ≥44 px, and not covered. */
async function expectTappable(page, control) {
  await expect(control).toBeInViewport({ ratio: 1 });
  const box = await control.boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(TAP - 0.5);
  expect(box.width).toBeGreaterThanOrEqual(TAP - 0.5);
  const onTop = await control.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return el === hit || el.contains(hit);
  });
  expect(onTop, 'nothing covers the control').toBe(true);
}

/** Footer: every control tappable, on at most two rows, the primary on the last. */
async function expectFooter(page, footer, primaryName) {
  const buttons = footer.locator(':scope > button');
  const n = await buttons.count();
  for (let i = 0; i < n; i++) await expectTappable(page, buttons.nth(i));
  const primary = footer.getByRole('button', { name: primaryName, exact: true });
  await expectTappable(page, primary);
  const rows = await buttons.evaluateAll((els) => {
    const tops = [...new Set(els.map((el) => Math.round(el.getBoundingClientRect().top)))];
    return tops.sort((a, b) => a - b);
  });
  expect(rows.length, 'footer controls wrap onto at most two rows').toBeLessThanOrEqual(2);
  const primaryTop = Math.round((await primary.boundingBox()).y);
  expect(primaryTop, 'the primary sits on the bottom row').toBe(rows.at(-1));
}

/** Header controls and title stay on one line each (no mid-word breaks). */
async function expectSingleLine(locator) {
  const n = await locator.count();
  expect(n).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    const lines = await locator.nth(i).evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size;
    });
    expect(lines, `"${await locator.nth(i).textContent()}" on one line`).toBe(1);
  }
}

/** Tap the last card (below the fold on a short phone) and keep it in view. */
async function tapLastCard(page, dialog, card) {
  const cards = dialog.locator(card);
  const last = cards.last();
  await last.scrollIntoViewIfNeeded();
  await last.tap();
  await expect(last).toHaveAttribute('aria-pressed', 'true');
  await expect(cards.first()).toHaveAttribute('aria-pressed', 'false');
  // The list is rebuilt on every choice: the chosen card is still whole in view.
  await expect(last).toBeInViewport({ ratio: 0.99 });
  return last;
}

const PHONES = [
  { width: 390, height: 844 },
  { width: 375, height: 667 },
];

for (const phone of PHONES)
  test.describe(`upright phone ${phone.width}x${phone.height}`, () => {
    test.use({ viewport: phone, hasTouch: true, userAgent: IPHONE_UA });

    test('difficulty and blessing: rows, the footer wraps, Confirm under the thumb', async ({
      page,
    }, info) => {
      test.setTimeout(120_000);
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await boot(page, { portrait: true });
      const setup = await openDifficulty(page, false);
      await expectPortraitDraft(page, setup, '.ch-banner', '.ch-banner-name');
      await expectFooter(page, setup.locator('.ch-footer'), 'Confirm');
      // A locked mode can be chosen to read its terms, never confirmed.
      await setup.locator('.ch-banner[data-mode="lunatic"]').tap();
      await expect(setup.locator('.ch-banner[data-mode="lunatic"]')).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await expect(setup.getByRole('button', { name: 'Confirm', exact: true })).toBeDisabled();
      await page.screenshot({ path: info.outputPath(`difficulty-${phone.width}.png`) });
      await setup.locator('.ch-banner[data-mode="normal"]').tap();
      await setup.getByRole('button', { name: 'Confirm', exact: true }).tap();
      await waitForScene(page, 'BlessingSelect');

      const shrine = page.getByRole('dialog', { name: 'Choose a blessing', exact: true });
      await expect(shrine).toBeVisible();
      await longestBlessings(page);
      expect(await expectPortraitDraft(page, shrine, '.ch-tarot', '.ch-tarot-name')).toBe(4);
      // The cost is a price: always inside its card, even folded.
      for (const card of await shrine.locator('.ch-tarot').all()) {
        await card.scrollIntoViewIfNeeded();
        const cardBox = await card.boundingBox();
        const costBox = await card.locator('.ch-cost').boundingBox();
        expect(costBox.y + costBox.height).toBeLessThanOrEqual(cardBox.y + cardBox.height + 0.5);
      }
      await expectFooter(page, shrine.locator('.ch-footer'), 'Confirm');
      await tapLastCard(page, shrine, '.ch-tarot');
      await page.screenshot({ path: info.outputPath(`blessing-${phone.width}.png`) });
      // Take the last card of the run's real offer.
      const chosenId = await page.evaluate(() => {
        const s = window.__emblemRogueGame.scene.getScene('BlessingSelect');
        s.options = window.__offered;
        s.selectedIndex = 0;
        s._draw();
        return s.options.at(-1).id;
      });
      await expectPortraitDraft(page, shrine, '.ch-tarot', '.ch-tarot-name');
      await tapLastCard(page, shrine, '.ch-tarot');
      await shrine.getByRole('button', { name: 'Confirm', exact: true }).tap();
      await waitForScene(page, 'NodeMap');
      expect(
        await page.evaluate(() =>
          window.__emblemRogueGame.scene
            .getScene('NodeMap')
            .runManager.activeBlessings.map((b) => b.id),
        ),
      ).toEqual([chosenId]);
      expect(errors).toEqual([]);
    });

    test('boss recruit and lord arrival: candidates as rows, the chosen one sworn', async ({
      page,
    }, info) => {
      test.setTimeout(120_000);
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await boot(page, { portrait: true });
      await openBattle(page, false);

      const recruit = await openBossRecruit(page);
      expect(await expectPortraitDraft(page, recruit, '.ch-card', '.ch-name')).toBe(3);
      await expectFooter(page, recruit.locator('.ch-footer'), 'Recruit');
      await expectSingleLine(recruit.locator('.re-header button'));
      // The chosen card opens its traits; a card set aside folds them.
      await expect(recruit.locator('.ch-card').first().locator('.ch-lines')).toBeVisible();
      const last = await tapLastCard(page, recruit, '.ch-card');
      await expect(last.locator('.ch-lines')).toBeVisible();
      await expect(recruit.locator('.ch-card').first().locator('.ch-lines')).toBeHidden();
      await expect(recruit.locator('.ch-card').first().locator('.ch-stats')).toBeVisible();
      const name = (await last.locator('.ch-name').textContent()).trim();
      await page.screenshot({ path: info.outputPath(`boss-recruit-${phone.width}.png`) });
      await recruit.getByRole('button', { name: 'Recruit', exact: true }).tap();
      await expect(recruit).toHaveCount(0);
      expect(await page.evaluate(() => window.chosen)).toEqual([name]);

      const lords = await openLordArrival(page);
      await expectPortraitDraft(page, lords, '.ch-card', '.ch-name');
      await expectFooter(page, lords.locator('.ch-footer'), 'Welcome');
      await expectSingleLine(lords.locator('.re-header button'));
      const lord = await tapLastCard(page, lords, '.ch-card');
      const lordName = (await lord.locator('.ch-name').textContent()).trim();
      await page.screenshot({ path: info.outputPath(`lord-arrival-${phone.width}.png`) });
      await lords.getByRole('button', { name: 'Welcome', exact: true }).tap();
      await expect(lords).toHaveCount(0);
      expect((await page.evaluate(() => window.welcomed)).map((n) => n.toUpperCase())).toEqual([
        lordName.toUpperCase(),
      ]);
      expect(errors).toEqual([]);
    });

    test('battle rewards: five spoils as rows, the header on whole words, a reward applied', async ({
      page,
    }, info) => {
      test.setTimeout(120_000);
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await boot(page, { portrait: true });
      await openBattle(page, false);
      const rewards = await openRewards(page);
      expect(await expectPortraitDraft(page, rewards, '.reward-card', '.ch-reward-name')).toBe(5);
      await expectFooter(page, rewards.locator('.ch-rewards-footer'), 'Choose reward');
      // The header: title, gold, tools and the earnings note, none breaking mid-word.
      await expectSingleLine(rewards.locator('.mu-header h1, .mu-header .reward-tools button'));
      for (const b of await rewards.locator('.mu-header button').all())
        await expectTappable(page, b);
      const note = rewards.locator('.mu-header > .mu-help');
      if (await note.count()) {
        const box = await note.boundingBox();
        expect(box.x + box.width).toBeLessThanOrEqual(phone.width + 0.5);
        expect(
          await note.locator('summary').evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
        ).toBe(true);
      }
      await expectNoSidewaysScroll(page, rewards);

      // Tap the Gale Blade (below the fold on a short phone), choose, apply.
      const cards = rewards.locator('.reward-card');
      const blade = cards.nth(2);
      await blade.scrollIntoViewIfNeeded();
      await blade.tap();
      await expect(blade).toHaveAttribute('aria-pressed', 'true');
      await expect(blade).toBeInViewport({ ratio: 0.99 });
      await page.screenshot({ path: info.outputPath(`rewards-${phone.width}.png`) });
      await rewards.getByRole('button', { name: 'Choose reward', exact: true }).tap();
      const apply = rewards.getByRole('button', { name: 'Apply reward', exact: true });
      await expect(apply).toBeVisible();
      await expectTappable(page, apply);
      await expectNoSidewaysScroll(page, rewards);
      await page.screenshot({ path: info.outputPath(`reward-recipient-${phone.width}.png`) });
      await apply.tap();
      await expect
        .poll(() =>
          page.evaluate(() => {
            const rm = window.__emblemRogueGame.scene.getScene('Battle').runManager;
            const has = (list) => (list || []).some((w) => w?.name === 'Gale Blade');
            return rm.roster.some((u) => has(u.inventory)) || has(rm.convoy?.weapons || rm.convoy);
          }),
        )
        .toBe(true);
      expect(errors).toEqual([]);
    });

    test('mercenary board and contract: rows, then Confirm hire under the thumb', async ({
      page,
    }, info) => {
      test.setTimeout(120_000);
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await boot(page, { portrait: true });
      const board = await openMercBoard(page, false);
      await expectPortraitDraft(page, board, '.ch-card', '.ch-name');
      await page.screenshot({ path: info.outputPath(`mercenary-board-${phone.width}.png`) });
      const last = board.locator('.ch-card').last();
      await last.scrollIntoViewIfNeeded();
      const name = (await last.locator('.ch-name').textContent()).trim();
      const index = (await board.locator('.ch-card').count()) - 1;
      const cost = await page.evaluate((i) => window.arena._mercCandidates[i].hireCost, index);
      await last.tap();
      const contract = page.getByRole('dialog', { name: `Hire ${name}`, exact: true });
      await expect(contract).toContainText(`Hire cost: ${cost} G`);
      await expectPortraitDraft(page, contract, '.ch-card', '.ch-name');
      const hire = contract.getByRole('button', { name: 'Confirm hire', exact: true });
      await expectTappable(page, hire);
      await page.screenshot({ path: info.outputPath(`mercenary-contract-${phone.width}.png`) });
      await hire.tap();
      await expect(page.locator('.gr-join-layer')).toBeVisible();
      expect(await page.evaluate(() => window.arena.runManager.gold)).toBe(5000 - cost);
      expect(errors).toEqual([]);
    });
  });

// ── Landscape and desktop: unchanged ────────────────────────────────────
// Card boxes (left, top, width) measured on origin/main with these same flows;
// each screen's cards must sit exactly there (±1 px) and share one row. Heights
// follow the footer's text (a system font), so they are only held to one row.
const MAIN = {
  '844x390': {
    difficulty: [
      [17, 76, 264.7],
      [289.7, 80, 264.7],
      [562.3, 80, 264.7],
    ],
    blessing: [
      [17, 76, 196.5],
      [221.5, 80, 196.5],
      [426, 80, 196.5],
      [630.5, 80, 196.5],
    ],
    bossRecruit: [
      [17, 76, 264.7],
      [289.7, 80, 264.7],
      [562.3, 80, 264.7],
    ],
    lordArrival: [
      [17, 76, 264.7],
      [289.7, 80, 264.7],
      [562.3, 80, 264.7],
    ],
    rewards: [
      [17, 74, 155.6],
      [180.6, 78, 155.6],
      [344.2, 78, 155.6],
      [507.8, 78, 155.6],
      [671.4, 78, 155.6],
    ],
    mercs: [
      [17, 117, 264.7],
      [289.7, 117, 264.7],
      [562.3, 117, 264.7],
    ],
  },
  '640x480': {
    difficulty: [
      [17, 76, 198],
      [221, 80, 198],
      [425, 80, 198],
    ],
    blessing: [
      [17, 76, 147],
      [170, 80, 147],
      [323, 80, 147],
      [476, 80, 147],
    ],
    bossRecruit: [
      [17, 76, 198],
      [221, 80, 198],
      [425, 80, 198],
    ],
    lordArrival: [
      [17, 76, 198],
      [221, 80, 198],
      [425, 80, 198],
    ],
    rewards: [
      [17, 81.4, 116.4],
      [139.4, 85.4, 116.4],
      [261.8, 85.4, 116.4],
      [384.2, 85.4, 116.4],
      [506.6, 85.4, 116.4],
    ],
    mercs: [
      [17, 117, 198],
      [221, 117, 198],
      [425, 117, 198],
    ],
  },
};
const DUMP = process.env.PORTRAIT_CARDS_DUMP === '1';

async function expectRowAsOnMain(page, dialog, card, expected, label) {
  // A resting pointer would lift the card under it (the desktop hover); wait for
  // every card's finite transition to settle (idle sprites loop forever).
  await page.mouse.move(0, 0);
  await page.waitForFunction(
    () =>
      !document
        .getAnimations()
        .some(
          (a) =>
            a.playState === 'running' &&
            a.effect?.getComputedTiming().endTime !== Infinity &&
            a.effect?.target?.closest?.('.ch-card'),
        ),
  );
  const boxes = await dialog.locator(card).evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return [r.left, r.top, r.width, r.height].map((v) => Math.round(v * 10) / 10);
    }),
  );
  if (DUMP) {
    console.log(`MAIN ${label} ${JSON.stringify(boxes.map((b) => b.slice(0, 3)))}`);
    return;
  }
  expect(boxes.length, `${label}: card count`).toBe(expected.length);
  boxes.forEach(([x, y, w], i) => {
    const [ex, ey, ew] = expected[i];
    expect(Math.abs(x - ex), `${label} card ${i} left ${x} vs ${ex}`).toBeLessThanOrEqual(1);
    expect(Math.abs(y - ey), `${label} card ${i} top ${y} vs ${ey}`).toBeLessThanOrEqual(1);
    expect(Math.abs(w - ew), `${label} card ${i} width ${w} vs ${ew}`).toBeLessThanOrEqual(1);
  });
  const heights = new Set(boxes.map((b) => Math.round(b[3])));
  expect(heights.size, `${label}: one row of equal cards`).toBe(1);
}

for (const { width, height, preview } of [
  { width: 844, height: 390, preview: true },
  { width: 640, height: 480, preview: false },
])
  test.describe(`landscape ${width}x${height} without portrait-ui`, () => {
    const key = `${width}x${height}`;
    test.use({
      viewport: { width, height },
      hasTouch: preview,
      userAgent: preview ? IPHONE_UA : DESKTOP_UA,
    });

    test('difficulty and blessing rows are unchanged', async ({ page }) => {
      test.setTimeout(120_000);
      await boot(page);
      const setup = await openDifficulty(page, preview);
      await expectRowAsOnMain(page, setup, '.ch-banner', MAIN[key].difficulty, `${key} difficulty`);
      await setup.getByRole('button', { name: 'Confirm', exact: true }).click();
      await waitForScene(page, 'BlessingSelect');
      const shrine = page.getByRole('dialog', { name: 'Choose a blessing', exact: true });
      await expect(shrine).toBeVisible();
      await longestBlessings(page);
      await expect(shrine.locator('.ch-tarot')).toHaveCount(4);
      await expectRowAsOnMain(page, shrine, '.ch-tarot', MAIN[key].blessing, `${key} blessing`);
    });

    test('recruit, lord arrival and reward rows are unchanged', async ({ page }) => {
      test.setTimeout(120_000);
      await boot(page);
      await openBattle(page, preview);
      const recruit = await openBossRecruit(page);
      await expectRowAsOnMain(
        page,
        recruit,
        '.ch-card',
        MAIN[key].bossRecruit,
        `${key} boss recruit`,
      );
      await recruit.getByRole('button', { name: 'Recruit', exact: true }).click();
      await expect(recruit).toHaveCount(0);
      const lords = await openLordArrival(page);
      await expectRowAsOnMain(
        page,
        lords,
        '.ch-card',
        MAIN[key].lordArrival,
        `${key} lord arrival`,
      );
      await lords.getByRole('button', { name: 'Welcome', exact: true }).click();
      await expect(lords).toHaveCount(0);
      const rewards = await openRewards(page);
      await expectRowAsOnMain(page, rewards, '.reward-card', MAIN[key].rewards, `${key} rewards`);
    });

    test('the mercenary board is unchanged', async ({ page }) => {
      test.setTimeout(120_000);
      await boot(page, { seeded: true });
      const board = await openMercBoard(page, preview);
      await expectRowAsOnMain(page, board, '.ch-card', MAIN[key].mercs, `${key} mercenaries`);
    });
  });
