// Item art on the real screens (docs/art-direction/items/README.md): socketed pixel
// icons from the atlases, painted heroes in detail panes, service vignettes (desktop
// band / phone backdrop), the upgrade purchase moment, and no legacy icon textures.
import { test, expect } from '@playwright/test';
import { waitForGame, waitForScene, collectErrors } from './helpers.js';

const VIEWS = [
  { name: 'phone', width: 844, height: 390, query: '&mobilePreview=1', desktop: false },
  { name: 'desktop', width: 1280, height: 800, query: '', desktop: true },
];

async function nodeMap(page, query) {
  await page.goto(`/?devScene=nodemap&preset=weapon_arts&seed=7${query}`);
  await waitForGame(page);
  await waitForScene(page, 'NodeMap');
  const skip = page.getByRole('button', { name: 'Skip conversation', exact: true });
  if (await skip.isVisible().catch(() => false)) await skip.click();
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('NodeMap');
    s.dialogueOverlay?.hide?.();
    s._storyDialogueActive = false;
    s.registry.set('activeSlot', 1);
  });
}

async function openShop(page, names, { caravan = false } = {}) {
  await page.evaluate(
    ({ names, caravan }) => {
      const s = window.__emblemRogueGame.scene.getScene('NodeMap');
      const d = s.gameData;
      const pools = [...d.weapons, ...d.accessories, ...d.consumables];
      s.runManager.gold = 9000;
      const n = s.runManager.getAvailableNodes()[0];
      n.type = 'shop';
      const stock = names.map((name) => {
        const item = structuredClone(pools.find((x) => x.name === name));
        return {
          type:
            item.type === 'Accessory' ? 'accessory' : item.type === 'Scroll' ? 'scroll' : 'weapon',
          item,
          price: item.price || 1000,
        };
      });
      s.showShopOverlay(n, stock, { caravan });
    },
    { names, caravan },
  );
  const shop = page.locator('.shop-menu');
  await expect(shop).toBeVisible();
  return shop;
}

/** The atlas cell a socketed icon paints (inline background from the manifest). */
async function glyphStyle(locator) {
  return locator
    .locator('.ia-glyph')
    .first()
    .evaluate((el) => ({
      image: el.style.backgroundImage,
      size: el.style.width,
      rendering: getComputedStyle(el).imageRendering,
    }));
}

for (const view of VIEWS) {
  test.describe(`item art ${view.name}`, () => {
    test.use({ viewport: { width: view.width, height: view.height } });

    test('shop rows carry socketed icons; the detail leads with the item picture', async ({
      page,
    }) => {
      const errors = collectErrors(page);
      await nodeMap(page, view.query);
      const shop = await openShop(page, ['Killer Lance', 'Sol Scroll', "Gambler's Coin", 'Elixir']);
      const rows = shop.locator('.shop-row');
      await expect(rows).toHaveCount(4);
      await expect(rows.nth(0).locator('.ia-icon')).toHaveAttribute('data-icon-id', 'killer-lance');
      await expect(rows.nth(0).locator('.ia-icon')).toHaveAttribute('data-socket', 'weapon');
      await expect(rows.nth(0).locator('.ia-icon')).toHaveAttribute('data-rim', 'Silver');
      await expect(rows.nth(1).locator('.ia-icon')).toHaveAttribute('data-socket', 'scroll');
      await expect(rows.nth(2).locator('.ia-icon')).toHaveAttribute('data-socket', 'accessory');
      await expect(rows.nth(3).locator('.ia-icon')).toHaveAttribute('data-socket', 'supply');
      const glyph = await glyphStyle(rows.nth(0));
      expect(glyph.image).toMatch(/assets\/ui\/items\/atlas-32\.png\?v=/);
      expect(glyph.size).toBe('32px');
      expect(glyph.rendering).toBe('pixelated');
      // The detail pane: hero picture, kicker, name and numbers side by side.
      const hero = shop.locator('.shop-hero .ia-hero');
      await expect(hero).toBeVisible();
      await expect(hero).toHaveAttribute('data-icon-id', 'killer-lance');
      await expect(shop.locator('.shop-kicker')).toHaveText(/Silver · Lance/i);
      await expect(shop.locator('.shop-hero .shop-mechanics')).toBeInViewport();
      await expect(shop.locator('.shop-lore')).toContainText('thumb');
      const box = await hero.boundingBox();
      // 96 px picture on a plate: 8 px of rim on short phones, 16 px elsewhere.
      expect(Math.round(box.width)).toBe(view.desktop ? 112 : 104);
      await expect(hero).toHaveAttribute('data-art', 'painted');
      expect(
        await hero
          .locator('img')
          .evaluate((i) => i.decode().then(() => [i.naturalWidth, i.clientWidth])),
      ).toEqual([96, 96]);
      // Scroll: the pixel icon at 2x (its glyph is the point).
      await rows.nth(1).click();
      await expect(hero).toHaveAttribute('data-icon-id', 'sol-scroll');
      await expect(hero).toHaveAttribute('data-art', 'pixel');
      expect((await glyphStyle(hero)).size).toBe('96px');
      // The place: a desktop header band, or the painting behind the phone pane.
      const band = shop.locator('.ia-band');
      if (view.desktop) {
        await expect(band).toBeVisible();
        await expect(band.locator('.ia-band-title')).toHaveText('Village');
        expect(await band.evaluate((el) => getComputedStyle(el).backgroundImage)).toMatch(
          /vignettes\/shop\.png/,
        );
      } else {
        await expect(band).toBeHidden();
        const pane = await shop
          .locator('.shop-detail')
          .evaluate((el) => getComputedStyle(el, '::before').backgroundImage);
        expect(pane).toMatch(/vignettes\/shop\.png/);
      }
      // The forge tab swaps to the forge and its sparks.
      await shop.getByRole('button', { name: 'Forge', exact: true }).click();
      await expect(page.locator('.shop-menu')).toHaveAttribute('data-vignette', 'forge');
      await expect(page.locator('.ia-motes--sparks').first()).toBeAttached();
      const overflow = await shop.evaluate((e) => e.scrollWidth > e.clientWidth + 1);
      expect(overflow).toBe(false);
      await page.screenshot({ path: `test-results/item-art-shop-${view.name}.png` });
      expect(errors).toEqual([]);
    });

    test('caravan and church show their places; reduced motion stills the motes', async ({
      page,
    }) => {
      const errors = collectErrors(page);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await nodeMap(page, view.query);
      await openShop(page, ['Iron Sword'], { caravan: true });
      await expect(page.locator('.shop-menu')).toHaveAttribute('data-vignette', 'caravan');
      await page.getByRole('button', { name: 'Leave', exact: true }).click();
      await page.evaluate(() => {
        const s = window.__emblemRogueGame.scene.getScene('NodeMap');
        const n = s.runManager.getAvailableNodes()[0];
        n.type = 'church';
        s.handleChurch(n);
      });
      const church = page.getByRole('dialog', { name: 'Church' });
      await expect(church).toBeVisible();
      await expect(church).toHaveAttribute('data-vignette', 'church');
      const motes = church.locator('.ia-motes--candles').first();
      await expect(motes).toBeAttached();
      expect(await motes.evaluate((el) => getComputedStyle(el).display)).toBe('none');
      if (view.desktop) await expect(church.locator('.ia-band')).toBeVisible();
      else
        expect(
          await church
            .locator('.ia-backdrop')
            .evaluate((el) => getComputedStyle(el, '::before').backgroundImage),
        ).toMatch(/vignettes\/church\.png/);
      expect(errors).toEqual([]);
    });

    test('upgrades: every row has its icon and a purchase stamps the new tier', async ({
      page,
    }) => {
      const errors = collectErrors(page);
      await page.goto(`/?devScene=homebase${view.query}`);
      await waitForScene(page, 'HomeBase');
      await page.getByRole('button', { name: 'Upgrades', exact: true }).first().click();
      const dialog = page.getByRole('dialog', { name: 'Army upgrades' });
      await expect(dialog).toBeVisible();
      await page.evaluate(() => {
        const s = window.__emblemRogueGame.scene.getScene('HomeBase');
        s.meta.totalSupply = 5000;
        s.meta.totalValor = 5000;
        s.mobileUpgrades.render();
      });
      const rows = dialog.locator('.mu-row');
      const count = await rows.count();
      expect(count).toBeGreaterThan(5);
      await expect(dialog.locator('.mu-row .ia-icon')).toHaveCount(count);
      await expect(dialog.locator('[data-upgrade="recruit_str_growth"] .ia-icon')).toHaveAttribute(
        'data-icon-id',
        'upgrade-recruit_str_growth',
      );
      await dialog.locator('.mu-tabs button', { hasText: 'Skills' }).click();
      const sol = dialog.locator('[data-upgrade="unlock_sol"] .ia-icon');
      await expect(sol).toHaveAttribute('data-icon-id', 'upgrade-unlock_sol');
      await dialog.locator('.mu-tabs button', { hasText: 'Economy' }).click();
      const chest = dialog.locator('[data-upgrade="starting_gold"]');
      await chest.click();
      await expect(dialog.locator('.mu-head .ia-icon')).toHaveAttribute('data-size', '64');
      await dialog.locator('.mu-buy').click();
      await expect(dialog.locator('.mu-stamp')).toHaveText(/Tier I/i);
      await expect(chest.locator('.ia-icon')).toHaveAttribute('data-rim', 'fine');
      await expect(chest.locator('.mu-pips .ignite')).toHaveCount(1);
      // Selecting another upgrade clears the moment.
      await dialog.locator('[data-upgrade="battle_gold"]').click();
      await expect(dialog.locator('.mu-stamp')).toHaveCount(0);
      expect(errors).toEqual([]);
    });

    test('battle rewards: spoils turn face up once, with icons and the picture', async ({
      page,
    }) => {
      test.setTimeout(90_000); // The battle scene boots and resolves a victory first.
      const errors = collectErrors(page);
      await page.goto(`/?devScene=battle&preset=battle_smoke&seed=42&battleLab=1${view.query}`);
      await waitForScene(page, 'Battle');
      await page.evaluate(() => {
        const s = window.__emblemRogueGame.scene.getScene('Battle');
        const d = s.gameData;
        const find = (n) =>
          structuredClone([...d.weapons, ...d.accessories].find((x) => x.name === n));
        const spoils = [
          { type: 'weapon', item: find('Killer Lance') },
          { type: 'accessory', item: find("Gambler's Coin") },
          { type: 'weapon', item: find('Ragnarok') },
        ];
        // The roll is replaced before the screen first renders (record is saved first).
        const rm = s.runManager;
        let record = rm.pendingBattleReward;
        Object.defineProperty(rm, 'pendingBattleReward', {
          configurable: true,
          get: () => record,
          set: (value) => {
            if (value && !value.revealed) value.choices = spoils;
            record = value;
          },
        });
        s.onVictory();
      });
      const dialog = page.getByRole('dialog', { name: 'Battle rewards', exact: true });
      await expect(dialog).toBeVisible();
      const list = dialog.locator('.mu-list');
      // Face down first, then turned in order; the record remembers it played.
      await expect(list).toHaveClass(/ia-reveal-rows/);
      await expect(list.locator('.ia-face-down')).toHaveCount(0, { timeout: 3000 });
      await expect(list.locator('.ia-card-back')).toHaveCount(0);
      expect(
        await page.evaluate(
          () =>
            window.__emblemRogueGame.scene.getScene('Battle').runManager.pendingBattleReward
              .revealed,
        ),
      ).toBe(true);
      const rows = dialog.locator('.reward-card');
      await expect(rows).toHaveCount(4);
      await expect(rows.nth(0).locator('.ia-icon')).toHaveAttribute('data-icon-id', 'killer-lance');
      await expect(rows.nth(1).locator('.ia-icon')).toHaveAttribute('data-socket', 'accessory');
      await expect(rows.nth(2).locator('.ia-icon')).toHaveAttribute('data-rim', 'Legend');
      await expect(rows.nth(3).locator('.ia-icon')).toHaveAttribute('data-icon-id', 'gold');
      const hero = dialog.locator('.reward-hero .ia-hero');
      await expect(hero).toHaveAttribute('data-icon-id', 'killer-lance');
      await expect(hero).toHaveAttribute('data-art', 'painted');
      await rows.nth(2).click();
      await expect(hero).toHaveAttribute('data-icon-id', 'ragnarok');
      await expect(rows.nth(2)).toHaveAttribute('aria-pressed', 'true');
      // A reopened screen (resume, back from a step) never replays the reveal.
      await page.evaluate(() => {
        const c = window.__emblemRogueGame.scene.getScene('Battle')._lootController;
        c.mobileRewards.hide();
        c.mobileRewards.open();
      });
      await expect(dialog).toBeVisible();
      await expect(dialog.locator('.ia-face-down')).toHaveCount(0);
      await expect(dialog.locator('.mu-list')).not.toHaveClass(/ia-reveal-rows/);
      const overflow = await dialog.evaluate((e) => e.scrollWidth > e.clientWidth + 1);
      expect(overflow).toBe(false);
      await page.screenshot({ path: `test-results/item-art-rewards-${view.name}.png` });
      expect(errors).toEqual([]);
    });

    test('blessing select: boon icons, the tarot card and its cost seal', async ({ page }) => {
      const errors = collectErrors(page);
      await page.goto(`/?devScene=blessing&seed=7${view.query}`);
      await waitForScene(page, 'BlessingSelect');
      await page.evaluate(() => {
        const s = window.__emblemRogueGame.scene.getScene('BlessingSelect');
        const ids = ['blood_forge', 'quartermaster_cache', 'field_medic'];
        s.options = ids.map((id, i) => s.runManager._resolveBlessingOfferForSelection({ id }, i));
        s.selectedIndex = 0;
        s._draw();
      });
      const rows = page.locator('.re-row.ia-row');
      await expect(rows).toHaveCount(3);
      await expect(rows.nth(0).locator('.ia-icon')).toHaveAttribute(
        'data-icon-id',
        'blessing-blood_forge',
      );
      await expect(rows.nth(0).locator('.ia-icon')).toHaveAttribute('data-socket', 'blessing');
      // "No blessing" stays a plain row.
      await expect(
        page.locator('.re-row', { hasText: 'No blessing' }).locator('.ia-icon'),
      ).toHaveCount(0);
      const card = page.locator('.ia-tarot-detail .ia-tarot');
      await expect(card).toBeVisible();
      await expect(card).toHaveAttribute('data-tier', '4');
      await expect(card.locator('.ia-tarot-numeral')).toHaveText('IV');
      expect(
        await card.locator('.ia-tarot-art').evaluate((el) => getComputedStyle(el).backgroundImage),
      ).toMatch(/moments\/cards\/blood_forge\.png/);
      // A tier IV blessing has a price: crimson seal. Field Medic is a clean gift.
      await expect(page.locator('.ia-cost .ia-seal:not(.is-clean)')).toBeVisible();
      await expect(page.locator('.ia-cost')).toContainText('Cost:');
      await rows.nth(2).click();
      await expect(card).toHaveAttribute('data-blessing', 'field_medic');
      await expect(page.locator('.ia-cost .ia-seal.is-clean')).toBeVisible();
      await expect(page.locator('.ia-cost')).toContainText('clean gift');
      // The terms stay readable beside or under the card.
      await expect(page.locator('.ia-tarot-text h3')).toBeInViewport();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      );
      expect(overflow).toBe(false);
      await page.screenshot({ path: `test-results/item-art-blessing-${view.name}.png` });
      expect(errors).toEqual([]);
    });

    test('roster item cards lead with icons; no legacy icon textures load', async ({ page }) => {
      const errors = collectErrors(page);
      await nodeMap(page, view.query);
      const legacy = await page.evaluate(() =>
        Object.keys(window.__emblemRogueGame.textures.list).filter((k) => k.startsWith('icon_')),
      );
      expect(legacy).toEqual([]);
      // Nothing on the map shows item art, so no atlas has been fetched yet.
      const fetched = await page.evaluate(() =>
        performance
          .getEntriesByType('resource')
          .map((e) => e.name)
          .filter((n) => /assets\/ui\/(items|moments)\//.test(n)),
      );
      expect(fetched).toEqual([]);
      const shop = await openShop(page, ['Iron Sword']);
      await shop.getByRole('button', { name: 'Roster', exact: true }).click();
      const roster = page.getByRole('dialog', { name: 'Manage roster', exact: true });
      await roster.getByRole('button', { name: 'Equipment', exact: true }).click();
      const card = roster.locator('.mr-item-card').first();
      await expect(card.locator('.mr-card-head .ia-icon')).toBeVisible();
      // Every item in data has lore, so About this item always carries the picture.
      const about = card.locator('details', { hasText: 'About this item' });
      await expect(about.locator('.ia-hero')).toBeHidden();
      await about.locator('summary').click();
      await expect(about.locator('.ia-hero')).toBeVisible();
      expect(errors).toEqual([]);
    });
  });
}
