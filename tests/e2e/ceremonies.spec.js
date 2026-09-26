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
    // The card dismisses itself after its hold (scene time). Slow the scene
    // clock while it is inspected so a loaded machine measures it first.
    const setTimeScale = (scale) =>
      page.evaluate((k) => {
        window.__emblemRogueGame.scene.getScene('Battle').time.timeScale = k;
      }, scale);
    await setTimeScale(0.1);
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
    const overflowing = await card.evaluate((root) =>
      ['.ce-boss-name', '.ce-boss-epithet', '.ce-kicker'].filter((selector) => {
        const node = root.querySelector(selector);
        return !node || node.scrollWidth > node.clientWidth + 1;
      }),
    );
    expect(overflowing).toEqual([]);
    // The bust breaks out above its band instead of being sliced, and stays in frame;
    // the band spans the battlefield (not the letterbox beside it).
    const framing = await card.evaluate((root) => {
      const layer = root.getBoundingClientRect();
      const band = root.querySelector('.ce-boss-band').getBoundingClientRect();
      const bust = root.querySelector('.ce-boss-portrait')?.getBoundingClientRect();
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      const b = s._getBattleMapBounds();
      const canvas = s.game.canvas.getBoundingClientRect();
      const a = s._worldToScreen(b.left, b.top);
      const z = s._worldToScreen(b.left + b.width, b.top + b.height);
      const mapLeft = canvas.left + (a.x * canvas.width) / s.scale.width;
      const mapRight = canvas.left + (z.x * canvas.width) / s.scale.width;
      const clip = getComputedStyle(root.querySelector('.ce-boss-band')).clipPath;
      return {
        bustAbove: bust ? bust.top < band.top : null,
        bustInside: bust ? bust.top >= layer.top - 1 : null,
        clipsVertically: /inset\(0(px)? /.test(clip),
        bandLeft: band.left,
        bandRight: band.right,
        mapLeft: Math.max(layer.left, mapLeft),
        mapRight: Math.min(layer.right, mapRight),
        layerWidth: layer.width,
      };
    });
    expect(framing.clipsVertically).toBe(false);
    if (framing.bustAbove !== null) expect(framing.bustInside).toBe(true);
    const spanWidth = framing.mapRight - framing.mapLeft;
    if (spanWidth >= Math.min(520, framing.layerWidth)) {
      expect(Math.abs(framing.bandLeft - framing.mapLeft)).toBeLessThan(2);
      expect(Math.abs(framing.bandRight - framing.mapRight)).toBeLessThan(2);
    }
    // Par is on the rail from the first frame, even while the card is up.
    await expect(rail.locator('.mb-counters')).toContainText('Par');
    await page.waitForTimeout(400);
    await page.keyboard.press('Enter');
    await expect(card).toHaveCount(0, { timeout: 10000 });
    await setTimeScale(1);
    await passStory(page);

    // The boss's bar rides the boss on the map; its full reading is in Battle details.
    const presence = () =>
      page.evaluate(() => {
        const s = window.__emblemRogueGame.scene.getScene('Battle');
        const p = s._bossPresence;
        const boss = s.enemyUnits.find((u) => u.isBoss);
        return {
          ...p.view(),
          line: p.summaryLine(),
          shown: p.bar?.visible,
          onBoss:
            Math.abs(p.bar.x - boss.hpBar.bg.x) < 0.5 &&
            Math.abs(p.bar.y - boss.hpBar.bg.y - 1) < 0.5,
          ordinaryHidden: boss.hpBar.bg.alpha === 0,
        };
      });
    await expect.poll(async () => (await presence()).shown).toBe(true);
    let view = await presence();
    expect(view.line).toContain(bossName);
    expect(view.onBoss).toBe(true);
    expect(view.ordinaryHidden).toBe(true);
    // Nothing covers the map any more.
    await expect(page.locator('.ce-bossbar')).toHaveCount(0);
    await page.locator('.mb-battle-info summary').tap();
    await expect(page.locator('.mb-more-content .mb-boss-line')).toContainText(bossName);
    await page.locator('.mb-battle-info summary').tap();

    await page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      const boss = s.enemyUnits.find((u) => u.isBoss);
      boss.currentHP = Math.max(1, Math.round(boss.stats.HP / 2));
      s.updateHPBar(boss);
    });
    view = await presence();
    expect(view.lostPct).toBeGreaterThan(view.fillPct + 20); // the gold "just lost" chunk
    await expect
      .poll(async () => {
        const v = await presence();
        return v.lostPct - v.fillPct;
      })
      .toBeLessThan(1);

    await page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      s.turnManager.turnNumber = 30;
      s.updateAntiTurtlePressure(30);
      s._bossPresence.sync();
    });
    await expect.poll(async () => (await presence()).tone).toBe('ember');
    expect((await presence()).line).toMatch(/Enraged/i);

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
    // The title menu is DOM (Hollow Sun title): Save Slots appears once a slot exists.
    await page.getByRole('button', { name: 'Save Slots', exact: true }).tap();
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
    await expect.poll(async () => (await presence()).shown).toBe(true);
    const restored = await presence();
    expect(restored.hpText).toContain(`${hp} /`);
    expect(restored.tone).toBe('ember');
    expect(Math.abs(restored.lostPct - restored.fillPct)).toBeLessThan(1);
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
      // The band moves on by itself after 1.5 s of scene time; slow the scene
      // clock so a loaded machine still taps first and the tap is what ends it.
      s.time.timeScale = 0.2;
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
    await expect(band).toHaveCount(0, { timeout: 5000 });
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
    // The Eclipse's phase rides the kicker; every run opens Pale.
    await expect(card.locator('.ce-act-kicker')).toHaveText('Act I · Pale');
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

test.describe('deed card on a small phone', () => {
  test.use(phone);

  test('the band grows to hold every line of the longest card; nothing is squashed or cut', async ({
    page,
  }) => {
    await quietSettings(page);
    await page.goto('/?devScene=battle&preset=battle_smoke&seed=42&mobilePreview=1');
    await waitForScene(page, 'Battle');
    await page.waitForFunction(
      () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'PLAYER_IDLE',
    );
    // The longest real deed name, epithet and lore, a "held beneath" note, an
    // Oath and a batch count: more lines than the band's design height holds.
    await page.evaluate(async () => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      const u = s.playerUnits[0];
      u.deeds = { earned: [{ id: 'avenger', prestige: 4, seq: 1, epithet: 'the Avenger' }] };
      const entry = {
        unit: u,
        unitName: 'Wendeline',
        deedId: 'avenger',
        name: 'Lantern of the March',
        epithet: 'Who Danced at the End',
        form: 'who',
        lore: 'Leaf and root and bowstring hum; the wood keeps faith with those who come.',
        prestige: 5,
        isTitle: false,
      };
      const { growthCeremonies } = await import('/src/ui/GrowthCeremonyController.js');
      void growthCeremonies(s).showDeeds({
        entries: [entry, { ...entry, epithet: 'the Avenger' }],
      });
    });
    const card = page.locator('.gr-deed');
    await expect(card).toBeVisible();
    await expect(page.locator('.gr-deed-oath')).toHaveText('Oath at promotion · Fury');
    await page.getByRole('button', { name: 'Skip', exact: true }).tap(); // reveal fully
    const fit = await page.evaluate(() => {
      const text = document.querySelector('.gr-deed-text');
      const kids = [...text.children];
      return {
        band: text.clientHeight,
        top: kids[0].offsetTop,
        bottom: Math.max(...kids.map((k) => k.offsetTop + k.offsetHeight)),
        clipped: [text, ...text.querySelectorAll('*')]
          .filter((n) => n.scrollHeight > n.clientHeight + 1 || n.scrollWidth > n.clientWidth + 1)
          .map(
            (n) =>
              `${n.className} ${n.scrollHeight}/${n.clientHeight} ${n.scrollWidth}/${n.clientWidth}`,
          ),
        controlsTop: document.querySelector('.gr-deed-controls').getBoundingClientRect().top,
        bandBottom: document.querySelector('.gr-deed-slash').getBoundingClientRect().bottom,
      };
    });
    expect(fit.clipped).toEqual([]);
    expect(fit.top).toBeGreaterThanOrEqual(0);
    expect(fit.bottom).toBeLessThanOrEqual(fit.band);
    // the grown band stays clear of the Next / Skip row (skewed edge: a few px)
    expect(fit.bandBottom).toBeLessThanOrEqual(fit.controlsTop + 24);
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
    // Measure in the same task that opens the band: it closes itself after a
    // short hold, which a loaded machine can outlast between two round trips.
    const { word, box } = await page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      s.showPhaseBanner('enemy', 2);
      // The turn's own band may still be closing underneath; ours is newest.
      const layer = [...document.querySelectorAll('.ce-phase-layer')].at(-1);
      const r = layer?.getBoundingClientRect();
      return {
        word: layer?.querySelector('.ce-phase-word')?.textContent || null,
        box: r ? { x: r.x, width: r.width } : null,
      };
    });
    expect(word).toBe('ENEMY PHASE');
    expect(Math.round(box.x)).toBe(Math.round(canvas.x));
    expect(Math.round(box.width)).toBe(Math.round(canvas.width));
    expect(canvas.x).toBeGreaterThan(100); // truly letterboxed at 1280×720
  });
});
