// Screen drivers for the items/rewards/services art study (dev routes only, no game-code
// changes). Each driver brings a fresh page to one surface that shows items, services or
// upgrades. Used by capture.mjs (audit captures + layout metrics) and mockups.mjs (the
// proposed art composited into the real DOM).
//
// Drivers take (page, base, opts) where opts.mobile picks the phone presentation
// (`mobilePreview=1`, 844x390) or the desktop one (1280x800).

export const PHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';

export async function newPhonePage(browser, { dpr = 3, w = 844, h = 390, reduced = false } = {}) {
  return newStudyPage(browser, { dpr, w, h, reduced, mobile: true });
}

export async function newStudyPage(
  browser,
  { dpr = 2, w = 844, h = 390, reduced = false, mobile = true } = {},
) {
  const ctx = await browser.newContext({
    viewport: { width: w, height: h },
    deviceScaleFactor: dpr,
    hasTouch: mobile,
    ...(mobile ? { userAgent: PHONE_UA } : {}),
    reducedMotion: reduced ? 'reduce' : 'no-preference',
  });
  await ctx.addInitScript(() => {
    localStorage.setItem(
      'emblem_rogue_settings',
      JSON.stringify({ musicVolume: 0, sfxVolume: 0, hints: false }),
    );
    // Dev routes have no save slot; hide the resulting toast (capture artifact).
    new MutationObserver(() => {
      for (const t of document.querySelectorAll('.re-hint-toast'))
        if (/Save failed/.test(t.textContent)) t.style.display = 'none';
    }).observe(document, { childList: true, subtree: true });
  });
  const page = await ctx.newPage();
  page.mobile = mobile;
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  return page;
}

const q = (page, query) => `${query}${page.mobile === false ? '' : '&mobilePreview=1'}`;
const press = (loc, page) => (page.mobile === false ? loc.click() : loc.tap());

export async function waitScene(page, key, timeout = 60000) {
  await page.waitForFunction(
    (k) => {
      const g = window.__emblemRogueGame;
      return g && g.scene.isActive(k);
    },
    key,
    { timeout },
  );
}

async function nodeMap(page, base, preset = 'weapon_arts') {
  await page.goto(`${base}?${q(page, `devScene=nodemap&preset=${preset}&seed=7`)}`);
  await waitScene(page, 'NodeMap');
  const skip = page.getByRole('button', { name: 'Skip conversation', exact: true });
  await skip.waitFor({ timeout: 30000 }).catch(() => {});
  if (await skip.isVisible().catch(() => false)) await press(skip, page);
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('NodeMap');
    s.dialogueOverlay?.hide?.();
    s._storyDialogueActive = false;
  });
  await page.waitForTimeout(600);
}

/** A spread of families with the longest names, for the shop and the icon audit. */
export const STUDY_STOCK = [
  'Silver Sword',
  'Killer Lance',
  'Hand Axe',
  'Longbow',
  'Bolganone',
  'Shine',
  'Physic',
  'Vulnerary',
  'Master Seal',
  'Speedwing',
  'Power Ring',
  "Gambler's Coin",
  'Silver Whetstone',
];

async function openShop(page, names = STUDY_STOCK, opts = {}) {
  await page.evaluate(
    ({ names, opts }) => {
      const s = window.__emblemRogueGame.scene.getScene('NodeMap');
      const d = s.gameData;
      const pools = [...d.weapons, ...d.accessories, ...d.consumables, ...(d.whetstones || [])];
      s.runManager.gold = 6420;
      const n = s.runManager.getAvailableNodes()[0];
      n.type = 'shop';
      n.isAmbush = false;
      const stock = names
        .map((name) => pools.find((x) => x.name === name))
        .filter(Boolean)
        .map((item) => ({
          type: item.type === 'Accessory' ? 'accessory' : 'weapon',
          item: structuredClone(item),
          price: item.price || 1500,
        }));
      s.showShopOverlay(n, stock, { caravan: opts.caravan === true });
    },
    { names, opts },
  );
  await page.locator('.shop-menu').waitFor({ timeout: 20000 });
  await page.waitForTimeout(500);
}

async function giveForgeables(page) {
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('NodeMap');
    const d = s.gameData;
    const pick = (n) => structuredClone(d.weapons.find((w) => w.name === n));
    const u = s.runManager.roster[0];
    const silver = pick('Silver Sword');
    silver._forgeLevel = 2;
    silver._forgeBonuses = { might: 1, hit: 5 };
    u.inventory = [silver, pick('Iron Sword'), ...u.inventory.slice(0, 2)];
  });
}

async function openChurch(page, { ruins = false, fallen = false, promotable = false } = {}) {
  await page.evaluate(
    async ({ ruins, fallen, promotable }) => {
      const s = window.__emblemRogueGame.scene.getScene('NodeMap');
      s.runManager.gold = 6420;
      if (promotable) for (const u of s.runManager.roster) u.level = 10;
      if (fallen) {
        const { createUnit } = await import('/src/engine/UnitManager.js');
        const u = createUnit(
          s.gameData.classes.find((c) => c.name === 'Knight'),
          5,
          s.gameData.weapons,
          { name: 'Brom' },
        );
        s.runManager.fallenUnits = [...(s.runManager.fallenUnits || []), u];
      }
      const n = s.runManager.getAvailableNodes()[0];
      n.type = ruins ? 'ruins' : 'church';
      if (ruins) s.handleRuins(n);
      else s.handleChurch(n);
    },
    { ruins, fallen, promotable },
  );
  await page.waitForTimeout(1200);
}

async function battleRewards(page, base, choices) {
  await page.goto(`${base}?${q(page, 'devScene=battle&preset=battle_smoke&seed=42&battleLab=1')}`);
  await waitScene(page, 'Battle');
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.__emblemRogueGame.scene.getScene('Battle').onVictory());
  await page.getByRole('dialog', { name: 'Battle rewards' }).waitFor({ timeout: 20000 });
  if (choices)
    await page.evaluate((names) => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      const d = s.gameData;
      const r = s._lootController.mobileRewards;
      const find = (n) =>
        [...d.weapons, ...d.accessories, ...d.consumables, ...(d.whetstones || [])].find(
          (x) => x.name === n,
        );
      r.choices = names.map((n) => {
        const item = structuredClone(find(n));
        const type =
          item.type === 'Accessory'
            ? 'accessory'
            : item.type === 'Whetstone'
              ? 'forge'
              : item.type === 'Consumable'
                ? 'consumable'
                : 'weapon';
        return { type, item };
      });
      r.selected = 0;
      r.render();
    }, choices);
  await page.waitForTimeout(800);
}

export const SCREENS = {
  async 'shop-buy'(page, base) {
    await nodeMap(page, base);
    await openShop(page);
  },
  async 'shop-sell'(page, base) {
    await nodeMap(page, base);
    await giveForgeables(page);
    await openShop(page);
    await press(page.locator('.shop-tabs button', { hasText: 'Sell' }), page);
    await page.waitForTimeout(500);
  },
  async 'shop-forge'(page, base) {
    await nodeMap(page, base);
    await giveForgeables(page);
    await openShop(page);
    await press(page.locator('.shop-tabs button', { hasText: 'Forge' }), page);
    await page.waitForTimeout(500);
  },
  async caravan(page, base) {
    await nodeMap(page, base);
    await openShop(page, STUDY_STOCK.slice(0, 6), { caravan: true });
  },
  async church(page, base) {
    await nodeMap(page, base);
    await openChurch(page, { fallen: true, promotable: true });
  },
  async ruins(page, base) {
    await nodeMap(page, base);
    await openChurch(page, { ruins: true });
  },
  async arena(page, base) {
    await nodeMap(page, base);
    await page.evaluate(async () => {
      const s = window.__emblemRogueGame.scene.getScene('NodeMap');
      s.runManager.gold = 6420;
      const { ColosseumOverlay } = await import('/src/ui/ColosseumOverlay.js');
      window.arena = new ColosseumOverlay(s, s.runManager, s.gameData);
      window.arena.show(s.runManager.getAvailableNodes()[0], () => {});
    });
    await page.waitForTimeout(1200);
  },
  async 'arena-tiers'(page, base) {
    await SCREENS.arena(page, base);
    await press(page.getByRole('button', { name: 'Arena', exact: true }), page);
    await press(page.getByRole('button', { name: /Edric.*Fights/ }), page);
    await page.waitForTimeout(800);
  },
  async blessing(page, base) {
    await page.goto(`${base}?${q(page, 'devScene=blessing&seed=7')}`);
    await waitScene(page, 'BlessingSelect');
    await page.waitForTimeout(1500);
  },
  async homebase(page, base) {
    await page.goto(`${base}?${q(page, 'devScene=homebase&preset=weapon_arts')}`);
    await waitScene(page, 'HomeBase');
    await page.waitForTimeout(1500);
  },
  async upgrades(page, base) {
    await SCREENS.homebase(page, base);
    await press(page.getByRole('button', { name: 'Upgrades', exact: true }).first(), page);
    await page.waitForTimeout(1200);
  },
  async 'upgrades-skills'(page, base) {
    await SCREENS.upgrades(page, base);
    await press(page.locator('.mu-tabs button', { hasText: 'Skills' }), page);
    await page.waitForTimeout(600);
  },
  async 'upgrades-economy'(page, base) {
    await SCREENS.upgrades(page, base);
    await press(page.locator('.mu-tabs button', { hasText: 'Economy' }), page);
    await page.waitForTimeout(600);
  },
  async rewards(page, base) {
    await battleRewards(page, base);
  },
  async 'rewards-mixed'(page, base) {
    await battleRewards(page, base, [
      'Killer Lance',
      "Gambler's Coin",
      'Silver Whetstone',
      'Energy Drop',
    ]);
  },
  async 'roster-equipment'(page, base) {
    await nodeMap(page, base);
    await giveForgeables(page);
    await openShop(page);
    await press(page.getByRole('button', { name: 'Roster', exact: true }).last(), page);
    await page.waitForTimeout(800);
    await press(page.getByRole('button', { name: /^Equipment$/i }).first(), page);
    await page.waitForTimeout(800);
  },
  async convoy(page, base) {
    await nodeMap(page, base);
    await page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('NodeMap');
      const d = s.gameData;
      const r = s.runManager;
      const add = (n) => {
        const it = [...d.weapons, ...d.accessories, ...d.consumables].find((x) => x.name === n);
        if (it) r.addToConvoy?.(structuredClone(it));
      };
      ['Steel Axe', 'Elixir', 'Talisman', 'Pursuit Ring', 'Heal'].forEach(add);
    });
    await openShop(page);
    await press(page.getByRole('button', { name: 'Roster', exact: true }).last(), page);
    await page.waitForTimeout(800);
    await press(page.getByRole('button', { name: /^Convoy$/i }).first(), page);
    await page.waitForTimeout(800);
  },
  async nodemap(page, base) {
    await nodeMap(page, base);
    await page.waitForTimeout(800);
  },
};
