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
import {
  PORTRAIT_PHONES,
  NOTCH_PORTRAIT,
  phone,
  emulateSafeArea,
  expectInsideSafeArea,
  expectPortraitUi,
  expectTappable as tappable,
  expectNoSidewaysScroll as noSideways,
  expectWholeInViewport,
  clippedText,
  engineOf,
  pageErrors,
  safeAreaInsets,
} from './portraitHelpers.js';

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
  await expect(dialog.locator('.ch-banner')).toHaveCount(4);
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
    // The longest price any blessing can roll (v3: catalog labels, a combination joined by
    // " · ", the largest Debt, an intrinsic price's label), on every card.
    const catalog = s.gameData.blessings.priceCatalog || {};
    const labelOf = (option) =>
      (Array.isArray(option) ? option : [option])
        .map((id) => catalog[id].label.replace('{owed}', '7,400'))
        .join(' · ');
    const longest = s.gameData.blessings.blessings
      .flatMap((x) => (x.pact ? [x.pact] : x.prices || []))
      .map(labelOf)
      // An intrinsic price is its own label, not a catalog id.
      .concat(
        s.gameData.blessings.blessings
          .filter((x) => x.intrinsicPrice)
          .map((x) => x.intrinsicPrice.label),
      )
      .reduce((a, c) => (c.length > a.length ? c : a), '');
    const ids = ['quartermaster_cache', 'focused_curriculum', 'forbidden_tome', 'war_tutelage'];
    s.options = ids.map((id) => {
      const b = structuredClone(s.gameData.blessings.blessings.find((x) => x.id === id));
      b.rolledCost = { label: longest, effects: [] };
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
  await expectWholeInViewport(control);
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

// ── Upright phones, the real shell: edges, scroll, recipients, safe areas ──
// These run on a real phone context (portraitHelpers phone(): touch, coarse
// pointer, a phone-sized screen), so portrait mode is on by default and nothing
// forces the class. Safe areas are emulated (the notch above, the home bar below).
//
// Failure modes, one test (or assertion group) each:
//   8. a scrolling list ends in a hard slice under the header or above the footer
//      (no fade), or fades where there is nothing more (a list that fits); a long
//      mercenary contract squeezes its terms panel shorter than its text;
//   9. a tapped card half under a fade stays there after the rebuild, or a tap on
//      a card in plain view moves the list (scroll position lost);
//  10. the spoils open scrolled a few pixels (focus scrolling a tall chosen card),
//      so its first line sits in the fade;
//  11. the chosen spoil's lore (the longest in the data) is cut, or pushes the
//      primary off screen; the dominated skip-gold card does not read as quiet
//      until chosen, or taking it does not pay;
//  12. the recipient step leaves a gap between a short list and the detail, Apply
//      is not on the bottom row, a long roster pushes Apply or the detail off
//      screen, a choice in the list loses its scroll, or Back loses the spoils'
//      place;
//  13. a header or footer control sits under the notch or the home bar.

/** A phone context usable inside a describe group (no browser-type switch). */
function uprightPhone(viewport) {
  const context = phone(viewport);
  delete context.defaultBrowserType;
  return context;
}

/** A list's fade edges as drawn (its computed mask) and its scroll state. */
function listEdges(list) {
  return list.evaluate((el) => {
    const cs = getComputedStyle(el);
    const mask = cs.maskImage && cs.maskImage !== 'none' ? cs.maskImage : cs.webkitMaskImage;
    const clear = '(?:rgba\\(0, 0, 0, 0\\)|transparent)';
    const r = el.getBoundingClientRect();
    return {
      top: new RegExp(`^linear-gradient\\((?:180deg, )?${clear}`).test(mask || ''),
      bottom: new RegExp(`${clear}\\)$`).test(mask || ''),
      fade: parseFloat(cs.getPropertyValue('--ch-fade')) || 0,
      scrollTop: el.scrollTop,
      max: el.scrollHeight - el.clientHeight,
      viewTop: r.top,
      viewBottom: r.bottom,
    };
  });
}

/** Scroll a list to `to` ('start' | 'middle' | 'end') and wait for its edges to follow. */
async function scrollList(list, to) {
  await list.evaluate((el, to) => {
    const max = el.scrollHeight - el.clientHeight;
    el.scrollTop = to === 'start' ? 0 : to === 'end' ? max : Math.round(max / 2);
  }, to);
  await expect
    .poll(async () => {
      const e = await listEdges(list);
      return to === 'start' ? !e.top : to === 'end' ? !e.bottom : e.top && e.bottom;
    })
    .toBe(true);
}

/**
 * A list that scrolls fades exactly where it continues; a list that fits never
 * fades. Returns whether it scrolls.
 */
async function expectSoftEdges(list, label) {
  const first = await listEdges(list);
  if (first.max <= 1) {
    expect(first, `${label}: a list that fits does not fade`).toMatchObject({
      top: false,
      bottom: false,
    });
    return false;
  }
  expect(first.fade, `${label}: a fade length`).toBeGreaterThan(8);
  await scrollList(list, 'start');
  // A list just drawn (or already at its start, so no scroll event) gets its edge
  // classes on the next frame (choiceCards fadeScroll): wait for them.
  await expect
    .poll(() => listEdges(list), { message: `${label} at its start` })
    .toMatchObject({ top: false, bottom: true });
  await scrollList(list, 'middle');
  expect(await listEdges(list), `${label} mid-way`).toMatchObject({ top: true, bottom: true });
  await scrollList(list, 'end');
  expect(await listEdges(list), `${label} at its end`).toMatchObject({ top: true, bottom: false });
  return true;
}

/** The chosen card lies whole inside the list and clear of any fade drawn over it. */
async function expectChosenClear(list, chosen, label) {
  const e = await listEdges(list);
  const card = await chosen.boundingBox();
  expect(card.y, `${label}: top clear of the fade`).toBeGreaterThanOrEqual(
    e.viewTop + (e.top ? e.fade : 0) - 1,
  );
  expect(card.y + card.height, `${label}: bottom clear of the fade`).toBeLessThanOrEqual(
    e.viewBottom - (e.bottom ? e.fade : 0) + 1,
  );
}

/**
 * Tap, with a finger and without scrolling first, the card the bottom fade half
 * covers; it becomes the chosen card, brought clear of the fade.
 */
async function tapUnderBottomFade(page, list, cardSelector, label) {
  await scrollList(list, 'start');
  const e = await listEdges(list);
  const edge = e.viewBottom - e.fade;
  // A card whose top is clear of the fade and whose foot runs under it (`clear`), or
  // one that starts under the fade, at least 12 px on screen.
  const underFade = (clear) =>
    list.locator(cardSelector).evaluateAll(
      (cards, { edge, bottom, clear }) =>
        cards.findIndex((c) => {
          const r = c.getBoundingClientRect();
          return r.top < (clear ? edge : bottom) - 12 && r.bottom > edge;
        }),
      { edge, bottom: e.viewBottom, clear },
    );
  let target = await underFade(true);
  // WebKit's text lines run a pixel or two shorter, so a card can end exactly at the
  // fade's edge and the next one start under it: that is the card the fade covers.
  if (target < 0 && engineOf(page) === 'webkit') target = await underFade(false);
  expect(target, `${label}: a card runs under the bottom fade`).toBeGreaterThanOrEqual(0);
  const card = list.locator(cardSelector).nth(target);
  const box = await card.boundingBox();
  await page.touchscreen.tap(box.x + box.width / 2, box.y + 6);
  await expect(card).toHaveAttribute('aria-pressed', 'true');
  await expectChosenClear(list, card, label);
  return card;
}

/** A tap on a card in plain view leaves the list where it was. */
async function expectTapKeepsScroll(page, list, cardSelector, label) {
  await scrollList(list, 'middle');
  const e = await listEdges(list);
  const target = await list.locator(cardSelector).evaluateAll(
    (cards, { top, bottom }) =>
      cards.findIndex((c) => {
        const r = c.getBoundingClientRect();
        return c.getAttribute('aria-pressed') === 'false' && r.top >= top && r.bottom <= bottom;
      }),
    { top: e.viewTop + e.fade, bottom: e.viewBottom - e.fade },
  );
  expect(target, `${label}: a card in plain view mid-list`).toBeGreaterThanOrEqual(0);
  const card = list.locator(cardSelector).nth(target);
  const box = await card.boundingBox();
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await expect(card).toHaveAttribute('aria-pressed', 'true');
  const after = await listEdges(list);
  expect(
    Math.abs(after.scrollTop - e.scrollTop),
    `${label}: the list stays put`,
  ).toBeLessThanOrEqual(1);
  await expectChosenClear(list, card, label);
}

/** Header and footer controls clear the notch and the home bar; the primary is a thumb target. */
async function expectFrameInSafeArea(page, scope, primary) {
  await expectInsideSafeArea(page, `${scope} :is(header, .re-header, .mu-header) button`);
  await expectInsideSafeArea(page, `${scope} :is(.ch-footer, .service-footer, .mu-actions) button`);
  await tappable(primary);
}

for (const viewport of PORTRAIT_PHONES)
  test.describe(`upright shell ${viewport.width}x${viewport.height}`, () => {
    test.use(uprightPhone(viewport));
    // A short phone (375x667) scrolls every long list; taller ones may fit it.
    const short = viewport.height < 700;

    test('difficulty terms and blessings: soft edges, the chosen card clear, the place kept', async ({
      page,
    }, info) => {
      test.setTimeout(120_000);
      const errors = pageErrors(page);
      await boot(page);
      const insets = await safeAreaInsets(page, NOTCH_PORTRAIT);
      // The height left once the notch and home bar are taken out (the whole screen
      // in WebKit, which cannot emulate them): only a roomy phone may fit four blessings.
      const roomy = viewport.height - insets.top - insets.bottom >= 800;
      const setup = await openDifficulty(page, false);
      await expectPortraitUi(page);
      // Black Sun's terms are the longest: they scroll in their panel and fade there.
      await setup.locator('.ch-banner[data-mode="lunatic"]').tap();
      const terms = setup.locator('.ch-banner-detail');
      await expect(terms).toContainText('Black Sun');
      const scrolls = await expectSoftEdges(terms, 'Black Sun terms');
      if (viewport.height <= 700)
        expect(scrolls, 'Black Sun terms scroll on a short phone').toBe(true);
      await expectFrameInSafeArea(
        page,
        '[aria-label="Choose difficulty"]',
        setup.getByRole('button', { name: 'Confirm', exact: true }),
      );
      await setup.locator('.ch-banner[data-mode="normal"]').tap();
      await setup.getByRole('button', { name: 'Confirm', exact: true }).tap();
      await waitForScene(page, 'BlessingSelect');

      const shrine = page.getByRole('dialog', { name: 'Choose a blessing', exact: true });
      await expect(shrine).toBeVisible();
      await longestBlessings(page);
      const list = shrine.locator('.ch-draft');
      if (await expectSoftEdges(list, 'blessings')) {
        await tapUnderBottomFade(page, list, '.ch-tarot', 'blessings');
        await expectTapKeepsScroll(page, list, '.ch-tarot', 'blessings');
      } else expect(roomy, 'four blessings scroll on all but the tallest phone').toBe(true);
      await expectFrameInSafeArea(
        page,
        '[aria-label="Choose a blessing"]',
        shrine.getByRole('button', { name: 'Confirm', exact: true }),
      );
      await page.screenshot({ path: info.outputPath(`shell-blessings-${viewport.width}.png`) });
      expect(errors).toEqual([]);
    });

    test('boss recruit and lord arrival: soft edges and a chosen card clear of them', async ({
      page,
    }, info) => {
      test.setTimeout(120_000);
      const errors = pageErrors(page);
      await boot(page);
      await emulateSafeArea(page, NOTCH_PORTRAIT);
      await openBattle(page, false);
      await expectPortraitUi(page);
      const recruit = await openBossRecruit(page);
      const list = recruit.locator('.ch-draft');
      const scrolls = await expectSoftEdges(list, 'boss recruit');
      if (short) expect(scrolls, 'three candidates scroll on a short phone').toBe(true);
      if (scrolls) await tapUnderBottomFade(page, list, '.ch-card', 'boss recruit');
      await expectFrameInSafeArea(
        page,
        '[aria-label="Boss recruit"]',
        recruit.getByRole('button', { name: 'Recruit', exact: true }),
      );
      await page.screenshot({ path: info.outputPath(`shell-boss-recruit-${viewport.width}.png`) });
      await recruit.getByRole('button', { name: 'Recruit', exact: true }).tap();
      await expect(recruit).toHaveCount(0);

      const lords = await openLordArrival(page);
      const lordList = lords.locator('.ch-draft');
      const lordsScroll = await expectSoftEdges(lordList, 'lord arrival');
      if (short) expect(lordsScroll, 'three lords scroll on a short phone').toBe(true);
      if (lordsScroll) await tapUnderBottomFade(page, lordList, '.ch-card', 'lord arrival');
      await expectFrameInSafeArea(
        page,
        '[aria-label="Lord arrival"]',
        lords.getByRole('button', { name: 'Welcome', exact: true }),
      );
      expect(errors).toEqual([]);
    });

    test('mercenary board and a long contract fade where they continue', async ({ page }, info) => {
      test.setTimeout(120_000);
      const errors = pageErrors(page);
      await boot(page, { seeded: true });
      await emulateSafeArea(page, NOTCH_PORTRAIT);
      const board = await openMercBoard(page, false);
      await expectPortraitUi(page);
      await expectSoftEdges(board.locator('.ch-draft'), 'mercenary board');
      await expectInsideSafeArea(page, '[aria-label="Mercenary board"] .re-header button');
      // The longest skills in the data make the contract taller than any phone.
      await page.evaluate(() => {
        const unit = window.arena._mercCandidates[0].unit;
        unit.skills = [
          ...new Set([
            ...(unit.skills || []),
            'luna',
            'divine_charge',
            'rally_cry_skill',
            'ensnare',
            'adept',
          ]),
        ];
      });
      const first = board.locator('.ch-card').first();
      const name = (await first.locator('.ch-name').textContent()).trim();
      await first.tap();
      const contract = page.getByRole('dialog', { name: `Hire ${name}`, exact: true });
      await expect(contract.locator('.ch-terms')).toContainText('Luna');
      // The card and the terms each hold their whole text (the contract scrolls).
      for (const part of ['.ch-contract .ch-card', '.ch-terms'])
        expect(
          await contract.locator(part).evaluate((el) => el.scrollHeight - el.clientHeight),
          `${part} holds its text`,
        ).toBeLessThanOrEqual(1);
      const contractScrolls = await expectSoftEdges(contract.locator('.ch-contract'), 'contract');
      if (short) expect(contractScrolls, 'the long contract scrolls on a short phone').toBe(true);
      const hire = contract.getByRole('button', { name: 'Confirm hire', exact: true });
      await expectFrameInSafeArea(page, `[aria-label="Hire ${name}"]`, hire);
      await page.screenshot({ path: info.outputPath(`shell-contract-${viewport.width}.png`) });
      expect(errors).toEqual([]);
    });

    test('battle rewards: open at the top, the longest lore whole, the dominated skip quiet until chosen', async ({
      page,
    }, info) => {
      test.setTimeout(120_000);
      const errors = pageErrors(page);
      await boot(page);
      await emulateSafeArea(page, NOTCH_PORTRAIT);
      await openBattle(page, false);
      await expectPortraitUi(page);
      await page.evaluate(() => window.__emblemRogueGame.scene.getScene('Battle').onVictory());
      const rewards = page.getByRole('dialog', { name: 'Battle rewards', exact: true });
      await expect(rewards).toBeVisible();
      // The longest reading and the longest lore in the data lead the spoils, and a
      // gold card pays at least the skip, so the skip is dominated.
      const { lore, skipGold } = await page.evaluate(() => {
        const s = window.__emblemRogueGame.scene.getScene('Battle');
        const r = s._lootController.mobileRewards;
        r.reveal?.skip();
        const find = (list, name) => structuredClone(list.find((x) => x.name === name));
        const accessories = s.gameData.accessories?.accessories || s.gameData.accessories || [];
        const scroll = find(s.gameData.weapons, 'Glowing Ember Scroll');
        r.choices.splice(
          0,
          r.choices.length,
          { type: 'skillScroll', item: scroll },
          { type: 'accessory', item: find(accessories, "Bounty Hunter's Mark") },
          { type: 'weapon', item: find(s.gameData.weapons, 'Gale Blade') },
          { type: 'gold', goldAmount: r.skipGold + 50, xpAmount: 0 },
        );
        r.selected = 0;
        r.draftScroll = 0;
        // Rebuilt with the chosen (first) card focused, as on arrival.
        r.render();
        return { lore: scroll.lore, skipGold: r.skipGold };
      });
      await expect(rewards.locator('.reward-card')).toHaveCount(5);
      await expect(rewards.locator('.ia-revealing')).toHaveCount(0);
      const list = rewards.locator('.ch-draft');
      // Opens at the very top: the tall chosen scroll's first line is not in a fade.
      await expect
        .poll(() => listEdges(list))
        .toMatchObject({ scrollTop: 0, top: false, bottom: true });
      await expect(rewards.locator('.reward-card').first()).toHaveAttribute('aria-pressed', 'true');

      // The lore, whole, between the list and the footer.
      const loreLine = rewards.locator('.ch-reward-lore');
      await expect(loreLine).toHaveText(lore);
      const [noteBox, loreBox, footerBox, listBox] = await Promise.all([
        rewards.locator('.ch-notes').boundingBox(),
        loreLine.boundingBox(),
        rewards.locator('.ch-rewards-footer').boundingBox(),
        list.boundingBox(),
      ]);
      expect(loreBox.y).toBeGreaterThanOrEqual(noteBox.y - 0.5);
      expect(loreBox.y + loreBox.height).toBeLessThanOrEqual(noteBox.y + noteBox.height + 0.5);
      expect(noteBox.y).toBeGreaterThanOrEqual(listBox.y + listBox.height - 0.5);
      expect(noteBox.y + noteBox.height).toBeLessThanOrEqual(footerBox.y + 0.5);
      expect(await clippedText(page, '.ch-notes')).toEqual([]);
      await expectFrameInSafeArea(
        page,
        '[aria-label="Battle rewards"]',
        rewards.getByRole('button', { name: 'Choose reward', exact: true }),
      );
      await noSideways(page, '.ch-reward-screen');
      await page.screenshot({ path: info.outputPath(`shell-rewards-${viewport.width}.png`) });

      // The dominated skip: quiet while set aside, full once chosen; then it pays.
      const skip = rewards.locator('.reward-card.is-dominated');
      await expect(skip).toHaveCount(1);
      await expect(skip.locator('.ch-reward-name')).toHaveText(`Take ${skipGold} gold instead`);
      const quiet = () => skip.locator('.ch-plate').evaluate((el) => getComputedStyle(el).filter);
      expect(await quiet()).toMatch(/saturate/);
      await skip.scrollIntoViewIfNeeded();
      await skip.tap();
      await expect(skip).toHaveAttribute('aria-pressed', 'true');
      await expectChosenClear(list, skip, 'skip gold');
      expect(await quiet()).toBe('none');
      const take = rewards.getByRole('button', { name: 'Take gold', exact: true });
      await tappable(take);
      const before = await page.evaluate(
        () => window.__emblemRogueGame.scene.getScene('Battle').runManager.gold,
      );
      await take.tap();
      await expect
        .poll(() =>
          page.evaluate(() => window.__emblemRogueGame.scene.getScene('Battle').runManager.gold),
        )
        .toBe(before + skipGold);
      expect(errors).toEqual([]);
    });

    test('reward recipients: the detail under a short list, Apply on the bottom row, a long roster keeps its place', async ({
      page,
    }, info) => {
      test.setTimeout(120_000);
      const errors = pageErrors(page);
      await boot(page);
      await emulateSafeArea(page, NOTCH_PORTRAIT);
      await openBattle(page, false);
      await expectPortraitUi(page);
      const rewards = await openRewards(page);
      const blade = rewards.locator('.reward-card').nth(2);
      await blade.scrollIntoViewIfNeeded();
      await blade.tap();
      await expect(blade).toHaveAttribute('aria-pressed', 'true');
      // Park the spoils mid-way through the places that keep the blade clear of the
      // fades (not where a fresh "bring it into view" would put it).
      const draftPlace = await rewards.locator('.ch-draft').evaluate((el) => {
        const card = el.querySelector('.reward-card[aria-pressed="true"]').getBoundingClientRect();
        const view = el.getBoundingClientRect();
        const fade = parseFloat(getComputedStyle(el).getPropertyValue('--ch-fade')) || 0;
        const top = card.top - view.top + el.scrollTop;
        const low = Math.max(0, top + card.height - el.clientHeight + fade);
        const high = Math.min(el.scrollHeight - el.clientHeight, top - fade);
        el.scrollTop = Math.round((low + high) / 2);
        return el.scrollTop;
      });
      await rewards.getByRole('button', { name: 'Choose reward', exact: true }).tap();
      const apply = rewards.getByRole('button', { name: 'Apply reward', exact: true });
      await expect(apply).toBeVisible();

      // A short list (two lords and the convoy): the detail follows it directly and
      // Apply sits on the bottom row, above the home bar.
      const layout = () =>
        page.evaluate(() => {
          const box = (el) => el.getBoundingClientRect().toJSON();
          const list = document.querySelector('.ch-reward-screen .mu-list');
          const rows = [...list.querySelectorAll('.mh-skill')];
          return {
            lastRow: box(rows.at(-1)),
            list: box(list),
            listScrolls: list.scrollHeight > list.clientHeight + 1,
            copy: box(document.querySelector('.ch-reward-screen .mu-copy')),
            apply: box(document.querySelector('.ch-reward-screen .mu-actions .mu-buy')),
            pageScrolls: document.documentElement.scrollHeight > innerHeight,
            vh: innerHeight,
          };
        });
      let l = await layout();
      expect(l.copy.top - l.list.bottom, 'the detail follows the list').toBeLessThanOrEqual(10);
      if (!l.listScrolls)
        expect(l.copy.top - l.lastRow.bottom, 'no gap above the detail').toBeLessThanOrEqual(16);
      expect(l.apply.top).toBeGreaterThanOrEqual(l.copy.bottom);
      expect(
        l.vh - NOTCH_PORTRAIT.bottom - l.apply.bottom,
        'Apply on the bottom row',
      ).toBeLessThanOrEqual(12);
      await expectFrameInSafeArea(page, '[aria-label="Battle rewards"]', apply);
      await noSideways(page, '.ch-reward-screen');
      await page.screenshot({ path: info.outputPath(`shell-recipient-${viewport.width}.png`) });

      // Back: the spoils return where they were, the blade still chosen and in view.
      await rewards.getByRole('button', { name: 'Back', exact: true }).tap();
      await expect(blade).toHaveAttribute('aria-pressed', 'true');
      expect(
        Math.abs((await rewards.locator('.ch-draft').evaluate((el) => el.scrollTop)) - draftPlace),
      ).toBeLessThanOrEqual(1);
      await expectChosenClear(rewards.locator('.ch-draft'), blade, 'blade after Back');

      // A long roster: the list scrolls in its own box, the detail and Apply stay on screen.
      await page.evaluate(() => {
        const rm = window.__emblemRogueGame.scene.getScene('Battle').runManager;
        const edric = rm.roster[0];
        for (let i = 0; i < 12; i++)
          rm.roster.push({
            ...structuredClone(edric),
            name: `Benedetta ${i + 1}`,
            isLord: false,
            inventory: [],
            weapon: null,
            consumables: [],
          });
      });
      await rewards.getByRole('button', { name: 'Choose reward', exact: true }).tap();
      await expect(apply).toBeVisible();
      l = await layout();
      expect(l.listScrolls).toBe(true);
      expect(l.pageScrolls).toBe(false);
      await tappable(apply);
      await expect(rewards.locator('.mu-copy h2')).toBeInViewport({ ratio: 1 });
      // The list fades where it continues; a row chosen mid-list keeps its place.
      const rowsList = rewards.locator('.mu-list');
      expect(await expectSoftEdges(rowsList, 'recipients')).toBe(true);
      await rowsList.evaluate((el) => (el.scrollTop = (el.scrollHeight - el.clientHeight) / 2));
      const place = await rowsList.evaluate((el) => el.scrollTop);
      const pick = await rowsList.locator('.mh-skill').evaluateAll((rows) => {
        const view = rows[0].parentElement.getBoundingClientRect();
        return rows.findIndex((r) => {
          const b = r.getBoundingClientRect();
          return (
            r.getAttribute('aria-pressed') === 'false' &&
            !r.disabled &&
            b.top >= view.top + 4 &&
            b.bottom <= view.bottom - 4
          );
        });
      });
      expect(pick).toBeGreaterThanOrEqual(0);
      const row = rowsList.locator('.mh-skill').nth(pick);
      const rowName = (await row.locator('strong').textContent()).trim();
      const box = await row.boundingBox();
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
      await expect(rowsList.locator('.mh-skill').nth(pick)).toHaveAttribute('aria-pressed', 'true');
      await expect(rewards.locator('.mu-copy h2')).toHaveText(rowName);
      expect(Math.abs((await rowsList.evaluate((el) => el.scrollTop)) - place)).toBeLessThanOrEqual(
        1,
      );
      await expect(rowsList.locator('.mh-skill').nth(pick)).toBeInViewport({ ratio: 1 });
      await page.screenshot({
        path: info.outputPath(`shell-recipient-long-${viewport.width}.png`),
      });
      await apply.tap();
      await expect
        .poll(() =>
          page.evaluate(
            (name) =>
              window.__emblemRogueGame.scene
                .getScene('Battle')
                .runManager.roster.find((u) => u.name === name)
                ?.inventory?.some((w) => w?.name === 'Gale Blade') ?? false,
            rowName,
          ),
        )
        .toBe(true);
      expect(errors).toEqual([]);
    });
  });

// ── Landscape and desktop: unchanged ────────────────────────────────────
// Card boxes (left, top, width) measured on origin/main with these same flows;
// each screen's cards must sit exactly there (±1 px) and share one row. Heights
// follow the footer's text (a system font), so they are only held to one row.
const MAIN = {
  '844x390': {
    // Four rungs: the same row as four blessings.
    difficulty: [
      [17, 76, 196.5],
      [221.5, 80, 196.5],
      [426, 80, 196.5],
      [630.5, 80, 196.5],
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
      [17, 76, 147],
      [170, 80, 147],
      [323, 80, 147],
      [476, 80, 147],
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
// The reward recipient step and the mercenary contract: [x, width] of each box,
// measured on origin/main (their tops follow the body font, a system face, so
// only the columns are pinned).
const MAIN_STEPS = {
  '844x390': {
    recipient: {
      '.mu-list': [12, 405],
      '.mu-detail': [427, 405],
      '.mu-actions .mu-buy': [438, 383],
    },
    contract: {
      '.ch-contract .ch-card': [17, 395],
      '.ch-terms': [427, 405],
      '.service-footer .re-btn--primary': [12, 820],
    },
  },
  '640x480': {
    recipient: {
      '.mu-list': [12, 295.6],
      '.mu-detail': [317.6, 310.4],
      '.mu-actions .mu-buy': [326.6, 292.4],
    },
    contract: {
      '.ch-contract .ch-card': [17, 293],
      '.ch-terms': [325, 303],
      '.service-footer .re-btn--primary': [12, 616],
    },
  },
};

async function expectColumnsAsOnMain(page, expected, label) {
  const boxes = await page.evaluate(
    (sels) =>
      Object.fromEntries(
        sels.map((sel) => {
          const r = document.querySelector(sel).getBoundingClientRect();
          return [sel, [Math.round(r.left * 10) / 10, Math.round(r.width * 10) / 10]];
        }),
      ),
    Object.keys(expected),
  );
  if (DUMP) {
    console.log(`MAIN ${label} ${JSON.stringify(boxes)}`);
    return;
  }
  for (const [sel, [x, w]] of Object.entries(expected)) {
    expect(Math.abs(boxes[sel][0] - x), `${label} ${sel} left`).toBeLessThanOrEqual(1);
    expect(Math.abs(boxes[sel][1] - w), `${label} ${sel} width`).toBeLessThanOrEqual(1);
  }
}

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

    test('the mercenary board and contract are unchanged', async ({ page }) => {
      test.setTimeout(120_000);
      await boot(page, { seeded: true });
      const board = await openMercBoard(page, preview);
      await expectRowAsOnMain(page, board, '.ch-card', MAIN[key].mercs, `${key} mercenaries`);
      const first = board.locator('.ch-card').first();
      const name = (await first.locator('.ch-name').textContent()).trim();
      await first.click();
      await expect(page.getByRole('dialog', { name: `Hire ${name}`, exact: true })).toBeVisible();
      await expectColumnsAsOnMain(page, MAIN_STEPS[key].contract, `${key} contract`);
    });

    test('the reward recipient step is unchanged', async ({ page }) => {
      test.setTimeout(120_000);
      await boot(page);
      await openBattle(page, preview);
      const rewards = await openRewards(page);
      await rewards.locator('.reward-card').nth(2).click();
      await rewards.getByRole('button', { name: 'Choose reward', exact: true }).click();
      await expect(
        rewards.getByRole('button', { name: 'Apply reward', exact: true }),
      ).toBeVisible();
      await expectColumnsAsOnMain(page, MAIN_STEPS[key].recipient, `${key} recipient`);
      // Side by side, as on main: the list's top row level with the detail.
      const [list, detail] = await Promise.all([
        rewards.locator('.mu-list').boundingBox(),
        rewards.locator('.mu-detail').boundingBox(),
      ]);
      expect(Math.abs(list.y - detail.y)).toBeLessThanOrEqual(1);
    });
  });
