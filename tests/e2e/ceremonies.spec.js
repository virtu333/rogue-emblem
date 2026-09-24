// Ceremonies through real flows: the boss encounter card and boss bar on a
// real boss battle (including a saved-battle resume, which must restore the
// bar silently and never replay the card), the victory band, and the Act I
// title framing the run-start lines. Presentation only — each check also
// asserts the battle stays playable afterwards.
import { test, expect, devices } from '@playwright/test';
import { waitForScene } from './helpers.js';

test.setTimeout(120000);
const phone = { ...devices['iPhone SE'], viewport: { width: 667, height: 375 } };
delete phone.defaultBrowserType; // scoped per describe

async function quietSettings(page, extra = {}) {
  await page.routeWebSocket(/^ws:\/\/(?:127\.0\.0\.1|localhost):\d+/, (socket) => socket.close());
  await page.addInitScript(
    (extra) =>
      localStorage.setItem(
        'emblem_rogue_settings',
        JSON.stringify({ musicVolume: 0, sfxVolume: 0, hints: false, ...extra }),
      ),
    extra,
  );
}

async function battle(page) {
  return page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    return { state: s?.battleState, locked: s?.isStoryInputLocked?.() };
  });
}

async function passStory(page) {
  for (let i = 0; i < 40; i++) {
    const { state, locked } = await battle(page);
    if (state === 'PLAYER_IDLE' && !locked) return;
    const skip = page.getByRole('button', { name: 'Skip conversation', exact: true });
    const next = page.getByRole('button', { name: 'Continue', exact: true });
    if (await skip.isVisible().catch(() => false)) await skip.tap();
    else if (await next.isVisible().catch(() => false)) await next.tap();
    await page.waitForTimeout(250);
  }
  throw new Error('battle never became playable');
}

test.describe('boss encounter, bar and resume', () => {
  test.use(phone);

  test('card once, bar follows damage and enrage, resume restores it silently', async ({
    page,
  }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await quietSettings(page);
    await page.goto('/?devScene=battle&devNode=boss&preset=late_act&seed=42&mobilePreview=1');
    await waitForScene(page, 'Battle');
    const card = page.locator('.ce-boss-layer');
    await expect(card).toBeVisible({ timeout: 30000 });
    const bossName = await page.evaluate(
      () => window.__emblemRogueGame.scene.getScene('Battle').enemyUnits.find((u) => u.isBoss).name,
    );
    await expect(card.locator('.ce-boss-name')).toHaveText(bossName);
    await expect(card.locator('.ce-boss-epithet')).not.toBeEmpty();
    // Card covers the map only: the rail stays in view, inert, to its right.
    const cardBox = await card.boundingBox();
    const rail = page.locator('.mobile-battle-hud');
    const railBox = await rail.boundingBox();
    expect(cardBox.x + cardBox.width).toBeLessThanOrEqual(railBox.x + 1);
    expect(await rail.evaluate((el) => el.inert)).toBe(true);
    expect((await battle(page)).locked).toBe(true);
    // Everything fits at 667×375.
    for (const selector of ['.ce-boss-name', '.ce-boss-epithet', '.ce-kicker'])
      expect(
        await card.locator(selector).evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      ).toBe(true);
    await page.waitForTimeout(400);
    await page.keyboard.press('Enter');
    await expect(card).toHaveCount(0);
    await passStory(page);

    const bar = page.locator('.ce-bossbar');
    await expect(bar).toBeVisible();
    await expect(bar.locator('.ce-bossbar-name')).toHaveText(bossName);
    const barBox = await bar.boundingBox();
    expect(barBox.x + barBox.width).toBeLessThanOrEqual(railBox.x);
    expect(barBox.y + barBox.height).toBeLessThanOrEqual(375);

    const widths = () =>
      bar.evaluate((el) => [
        el.querySelector('.ce-bossbar-fill').getBoundingClientRect().width,
        el.querySelector('.ce-bossbar-lost').getBoundingClientRect().width,
      ]);
    await page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      const boss = s.enemyUnits.find((u) => u.isBoss);
      boss.currentHP = Math.max(1, Math.round(boss.stats.HP / 2));
      s.updateHPBar(boss);
    });
    const [fill, lost] = await widths();
    expect(lost).toBeGreaterThan(fill + 20); // the gold "just lost" chunk
    await expect.poll(async () => (await widths())[1] - (await widths())[0]).toBeLessThan(2);

    await page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      s.turnManager.turnNumber = 30;
      s.updateAntiTurtlePressure(30);
    });
    await expect(bar).toHaveClass(/is-ember/);
    await expect(bar.locator('.ce-bossbar-status')).toContainText(/Enraged/i);

    // Save to a slot, reload, resume: no card, bar restored as it stood.
    const hp = await page.evaluate(async () => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      const { getMetaKey, setActiveSlot } = await import('/src/engine/SlotManager.js');
      const meta = s.registry.get('meta');
      meta.storageKey = getMetaKey(1);
      meta._save();
      s.registry.set('activeSlot', 1);
      setActiveSlot(1);
      s._captureSuspendCheckpoint();
      return s.enemyUnits.find((u) => u.isBoss).currentHP;
    });
    await page.evaluate(() => history.replaceState(null, '', '/?mobilePreview=1'));
    await page.reload();
    await waitForScene(page, 'Title');
    await page.waitForTimeout(1400);
    const point = await page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('Title');
      const walk = (nodes) =>
        nodes.flatMap((o) => [o, ...(Array.isArray(o.list) ? walk(o.list) : [])]);
      const object = walk(s.children.list).find((o) => o.text === 'SAVE SLOTS' && o.visible);
      const b = object.getBounds(),
        r = s.game.canvas.getBoundingClientRect();
      return {
        x: r.x + (b.centerX * r.width) / s.scale.width,
        y: r.y + (b.centerY * r.height) / s.scale.height,
      };
    });
    await page.touchscreen.tap(point.x, point.y);
    await waitForScene(page, 'SlotPicker');
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: 'Select Slot 1', exact: true }).tap();
    await page.evaluate(() => {
      window.__sawBossCard = false;
      new MutationObserver(() => {
        if (document.querySelector('.ce-boss-layer')) window.__sawBossCard = true;
      }).observe(document.body, { childList: true, subtree: true });
    });
    await page.getByRole('button', { name: 'Resume Battle', exact: true }).tap();
    await waitForScene(page, 'Battle');
    await page.waitForFunction(
      () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'PLAYER_IDLE',
    );
    await expect(bar).toBeVisible();
    await expect(bar.locator('.ce-bossbar-hp')).toContainText(`${hp} /`);
    await expect(bar).toHaveClass(/is-ember/);
    await expect(bar).not.toHaveClass(/is-entering/);
    const [f2, l2] = await widths();
    expect(Math.abs(l2 - f2)).toBeLessThan(2);
    expect(await page.evaluate(() => window.__sawBossCard)).toBe(false);
    expect(errors).toEqual([]);
  });
});

test.describe('victory band and act title', () => {
  test.use(phone);

  test('ROUTED with turn · par · rank; a tap moves on to the rewards', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await quietSettings(page);
    await page.goto('/?devScene=battle&preset=late_act&seed=42&mobilePreview=1');
    await waitForScene(page, 'Battle');
    await passStory(page);
    await page.evaluate(async () => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      for (const enemy of [...s.enemyUnits]) {
        enemy.currentHP = 0;
        await s.removeUnit(enemy, { killer: s.playerUnits[0] });
      }
      s.checkBattleEnd();
    });
    const band = page.locator('.ce-band-layer--victory');
    await expect(band.locator('.ce-band-word')).toHaveText('ROUTED');
    await expect(band.locator('.ce-band-sub')).toContainText(/Turn \d+ · Par \d+ · Rank [SABC]/);
    await page.waitForTimeout(300);
    await band.tap();
    await expect(band).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('Act I title frames the run-start lines and leaves the route map usable', async ({
    page,
  }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await quietSettings(page);
    await page.goto('/?devScene=nodemap&preset=fresh&seed=42&mobilePreview=1');
    await waitForScene(page, 'NodeMap');
    const card = page.locator('.ce-act-layer');
    await expect(card.locator('.ce-act-title')).toHaveText('Border Marches');
    await expect(card.locator('.ce-act-grade')).toHaveText('Ember Dusk');
    await expect(card.locator('.ce-act-kicker')).toHaveText('Act I');
    const skip = page.getByRole('button', { name: 'Skip conversation', exact: true });
    await expect(skip).toBeVisible();
    await skip.tap();
    await expect(card).toHaveCount(0);
    await expect(page.locator('.re-node-map')).toBeVisible();
    await page.locator('.re-node.is-available').first().tap();
    await expect(page.getByRole('button', { name: 'Travel', exact: true })).toBeEnabled();
    expect(errors).toEqual([]);
  });
});

test.describe('desktop', () => {
  test.use({ viewport: { width: 960, height: 720 } });

  test('cut-in and phase band stay inside the letterboxed canvas', async ({ page }) => {
    await quietSettings(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/?devScene=battle&preset=late_act&seed=42');
    await waitForScene(page, 'Battle');
    await passStory(page);
    const canvas = await page.locator('canvas').boundingBox();
    await page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      s.showPhaseBanner('enemy', 2);
    });
    const phase = page.locator('.ce-phase-layer');
    await expect(phase.locator('.ce-phase-word')).toHaveText('ENEMY PHASE');
    const box = await phase.boundingBox();
    expect(Math.round(box.x)).toBe(Math.round(canvas.x));
    expect(Math.round(box.width)).toBe(Math.round(canvas.width));
    expect(canvas.x).toBeGreaterThan(100); // truly letterboxed at 1280×720
  });
});
