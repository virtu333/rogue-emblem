// Deeds & Epithets through a real victory (docs/specs/deeds-epithets.md):
// deed progress recorded on the battle's units commits with the win (before
// the save), the title-card rite plays after it, and the epithet then shows
// in the roster. Desktop 1280×800 and phone 844×390.
import { test, expect, devices } from '@playwright/test';

test.setTimeout(120000);

const SHOTS = process.env.DEED_SHOTS || '';

/** Cold dev-server boots on a busy machine can outlast the shared 15 s wait. */
async function waitForBattle(page) {
  await page.waitForFunction(() => window.__sceneState?.activeScene === 'Battle', null, {
    timeout: 60_000,
  });
}

async function quiet(page, speed = 'normal') {
  await page.routeWebSocket(/^ws:\/\/(?:127\.0\.0\.1|localhost):\d+/, (socket) => socket.close());
  await page.addInitScript((speed) => {
    localStorage.setItem(
      'emblem_rogue_settings',
      JSON.stringify({ musicVolume: 0, sfxVolume: 0, hints: false, battleSpeed: speed }),
    );
  }, speed);
}

function collect(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

/**
 * Record two deeds on the first player unit (Edric) through the real
 * DeedSystem entry points the battle calls (three critical hits, the killing
 * blow on a boss), then win the battle.
 */
async function earnDeedsAndWin(page) {
  return page.evaluate(async () => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    s.registry.set('activeSlot', 1);
    const deeds = await import('/src/engine/DeedSystem.js');
    const hero = s.playerUnits[0];
    // Same level as the hero: a boss kill, not also a giant's.
    const boss = { name: 'Iron Captain', faction: 'enemy', isBoss: true, level: hero.level, tier: hero.tier }; // prettier-ignore
    const crit = { type: 'strike', attackerSide: 'attacker', miss: false, isCrit: true, damage: 9 };
    deeds.recordCombat({ events: [crit, crit, crit] }, hero, boss, { phase: 'player' });
    deeds.recordKill(boss, hero, { terrain: 'Plain' });
    s.onVictory();
    return hero.name;
  });
}

for (const [label, device] of [
  ['desktop', { viewport: { width: 1280, height: 800 } }],
  ['phone', { ...devices['iPhone 13'], viewport: { width: 844, height: 390 } }],
]) {
  test.describe(label, () => {
    const { defaultBrowserType: _ignored, ...use } = device;
    test.use(use);

    test(`a victory reveals its deeds, then the roster carries the title (${label})`, async ({
      page,
    }, info) => {
      const errors = collect(page);
      await quiet(page);
      const mobile = label === 'phone' ? '&mobilePreview=1' : '';
      await page.goto(`/?devScene=battle&preset=battle_smoke&seed=42${mobile}`);
      await waitForBattle(page);
      const name = await earnDeedsAndWin(page);

      // Committed before the rite: the saved run already has the title.
      const rite = page.getByRole('dialog', { name: /^Deed\./ });
      await expect(rite).toBeVisible({ timeout: 45000 });
      const saved = await page.evaluate((name) => {
        const run = JSON.parse(localStorage.getItem('emblem_rogue_slot_1_run'));
        const unit = run.roster.find((u) => u.name === name);
        return { epithet: unit?.deeds?.epithet?.text, scratch: '_battleDeeds' in (unit || {}) };
      }, name);
      expect(saved).toEqual({ epithet: 'Bane of the Iron Captain', scratch: false });

      // First card: the boss deed (data order: Bossbane, then Keen Edge).
      await expect(rite.locator('.gr-deed-epithet-text')).toHaveText('Bane of the Iron Captain');
      await expect(rite.locator('.gr-deed-name')).toHaveText(`${name},`);
      await expect(rite.locator('.gr-deed-count')).toHaveText('1 / 2');
      if (SHOTS) await page.waitForTimeout(2600);
      await page.screenshot({ path: info.outputPath(`deed-rite-${label}.png`) });
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/deed-rite-${label}.png` });
      // The epithet fits the card (fitText, wrapping only below the minimum).
      const overflow = await rite
        .locator('.gr-deed-text')
        .evaluate((node) =>
          [node, ...node.querySelectorAll('*')]
            .filter((n) => n.scrollWidth > n.clientWidth + 1)
            .map((n) => `${n.className}: ${n.scrollWidth} > ${n.clientWidth}`),
        );
      expect(overflow).toEqual([]);

      // Reveal, then the next card; then continue out of the rite.
      // (The first press completes a card still revealing; the next moves on.)
      const revealThen = async (label) => {
        const button = rite.getByRole('button', { name: label, exact: true });
        if (!(await button.isVisible())) await page.keyboard.press('Enter');
        await expect(button).toBeVisible();
        await page.keyboard.press('Enter');
      };
      await revealThen('Next deed');
      await expect(rite.locator('.gr-deed-epithet-text')).toHaveText('the Keen Edge');
      await expect(rite.locator('.gr-deed-count')).toHaveText('2 / 2');
      await revealThen('Continue');
      await expect(page.getByRole('dialog', { name: /^Deed\./ })).toHaveCount(0);

      // The rewards follow; the roster shows the title and the Deeds section.
      const rewards = page.getByRole('dialog', { name: 'Battle rewards', exact: true });
      await expect(rewards).toBeVisible();
      await page.evaluate(async () => {
        const s = window.__emblemRogueGame.scene.getScene('Battle');
        const { MobileRosterSheet } = await import('/src/ui/MobileRosterSheet.js');
        window.__deedSheet = new MobileRosterSheet({
          scene: s,
          units: s.runManager.roster,
          gameData: s.gameData,
          onClose: () => window.__deedSheet.destroy(),
        });
      });
      const sheet = page.getByRole('dialog', { name: 'Inspect roster', exact: true });
      await expect(sheet).toBeVisible();
      await expect(sheet.locator('.mr-unit-epithet').first()).toHaveText(
        'Bane of the Iron Captain',
      );
      await expect(sheet.locator('.mr-summary .mr-epithet')).toHaveText('Bane of the Iron Captain');
      await expect(sheet.locator('.mr-deed')).toHaveCount(2);
      await sheet.locator('.mr-deed').first().scrollIntoViewIfNeeded();
      await page.screenshot({ path: info.outputPath(`deed-roster-${label}.png`) });
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/deed-roster-${label}.png` });
      expect(errors).toEqual([]);
    });

    test(`a promotion swears the unit's Oath: chooser, rite and skill (${label})`, async ({
      page,
    }, info) => {
      const errors = collect(page);
      await quiet(page, 'fast');
      const mobile = label === 'phone' ? '&mobilePreview=1' : '';
      await page.goto(`/?devScene=battle&preset=battle_smoke&seed=42${mobile}`);
      await waitForBattle(page);
      await page.waitForFunction(
        () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'PLAYER_IDLE',
        null,
        { timeout: 30000 },
      );
      await page.evaluate(async () => {
        const s = window.__emblemRogueGame.scene.getScene('Battle');
        const deeds = await import('/src/engine/DeedSystem.js');
        const u = s.playerUnits.find((x) => x.name === 'Sera');
        // A Myrmidon (two paths) who held a bridge, with a Master Seal.
        Object.assign(u, {
          name: 'Seraphina',
          isLord: false,
          className: 'Myrmidon',
          tier: 'base',
          level: 10,
          proficiencies: [{ type: 'Sword', rank: 'Prof' }],
          skills: [],
        });
        u._battleDeeds = { v: 1, heldPhases: 3, heldPlaces: ['Bridge', 'Bridge', 'Bridge'] };
        deeds.commitBattleDeeds([u], s.gameData.deeds, { battleKey: 'earlier' });
        const sword = s.gameData.weapons.find((w) => w.name === 'Iron Sword');
        u.inventory = [structuredClone(sword)];
        u.weapon = u.inventory[0];
        u.consumables = [
          structuredClone(s.gameData.consumables.find((i) => i.effect === 'promote')),
        ];
        s.removeUnitGraphic(u);
        s.addUnitGraphic(u);
        s.selectUnit(u);
        const { PromotionController } = await import('/src/ui/PromotionController.js');
        window.__promotion = new PromotionController(s).executePromotion(u, u.consumables[0]);
      });
      const chooser = page.getByRole('dialog', { name: 'Choose promotion', exact: true });
      await expect(chooser).toBeVisible();
      for (const path of await chooser.locator('.gr-path').all()) {
        await expect(path.locator('.gr-path-oath')).toContainText('Oath of the Bridge · Pavise');
        expect(await path.evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
      }
      await page.screenshot({ path: info.outputPath(`oath-chooser-${label}.png`) });
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/oath-chooser-${label}.png` });
      await chooser.getByRole('button', { name: 'Confirm promotion', exact: true }).click();
      const rite = page.getByRole('dialog', { name: 'Promotion', exact: true });
      await expect(rite).toBeVisible();
      await expect(rite.locator('.gr-kicker')).toHaveText(
        'Promotion · Seraphina, Who Held the Bridge',
      );
      await expect(rite.locator('.gr-seal--oath')).toContainText('Pavise');
      await expect(rite.locator('.gr-seal--oath')).toContainText('Oath of the Bridge');
      if (SHOTS) await page.waitForTimeout(3200);
      await page.screenshot({ path: info.outputPath(`oath-rite-${label}.png`) });
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/oath-rite-${label}.png` });
      const skills = await page.evaluate(() => {
        const s = window.__emblemRogueGame.scene.getScene('Battle');
        const u = s.playerUnits.find((x) => x.name === 'Seraphina');
        return { skills: u.skills, oath: u.deeds.oath?.skillId };
      });
      expect(skills.skills).toContain('pavise');
      expect(skills.oath).toBe('pavise');
      expect(errors).toEqual([]);
    });
  });
}

test.describe('titled surfaces (phone 844×390)', () => {
  const { defaultBrowserType: _ignored, ...use } = {
    ...devices['iPhone 13'],
    viewport: { width: 844, height: 390 },
  };
  test.use(use);

  test('cut-in, level card, fallen band and the Deeds of the March carry the title', async ({
    page,
  }, info) => {
    const errors = collect(page);
    await quiet(page);
    await page.goto('/?devScene=battle&preset=battle_smoke&seed=42&mobilePreview=1');
    await waitForBattle(page);
    await page.waitForFunction(
      () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'PLAYER_IDLE',
      null,
      { timeout: 30000 },
    );
    const shot = async (name) => {
      await page.screenshot({ path: info.outputPath(`${name}.png`) });
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
    };
    await page.evaluate(async () => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      const deeds = await import('/src/engine/DeedSystem.js');
      const edric = s.playerUnits.find((u) => u.isCommander);
      edric._battleDeeds = { v: 1, heldPhases: 3, heldPlaces: ['Bridge', 'Bridge', 'Bridge'] };
      deeds.commitBattleDeeds([edric], s.gameData.deeds, { battleKey: 'earlier' });
      // Crit cut-in, held for the capture (same code path, longer hold).
      const { ProcBannerController } = await import('/src/ui/ProcBannerController.js');
      const c = new ProcBannerController(s);
      const delay = s._awaitSceneDelay;
      s._awaitSceneDelay = (ms, opts) =>
        delay.call(s, opts?.label === 'proc_cutin_hold' ? 5000 : ms, opts);
      window.cutinDone = false;
      c.showCutIn({
        unit: edric,
        unitName: edric.name,
        weaponName: edric.weapon?.name,
        portraitKey: s._getPortraitKey(edric),
        label: 'CRITICAL HIT',
        category: 'offense',
        side: 'left',
      }).finally(() => {
        s._awaitSceneDelay = delay;
        c.destroy();
        window.cutinDone = true;
      });
    });
    const cutIn = page.locator('.ce-cutin-layer');
    await expect(cutIn.locator('.ce-cutin-epithet')).toHaveText('Who Held the Bridge');
    await page.waitForFunction(
      () => Number(document.querySelector('.ce-cutin-layer')?.style.getPropertyValue('--ce-in')) === 1, // prettier-ignore
    );
    await shot('titled-cutin-phone');
    await page.waitForFunction(() => window.cutinDone);

    // Level-up card: the epithet under the name.
    await page.evaluate(async () => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      const { growthCeremonies } = await import('/src/ui/GrowthCeremonyController.js');
      const edric = s.playerUnits.find((u) => u.isCommander);
      window.__levelDone = growthCeremonies(s).showLevelUp({
        unit: edric,
        result: { newLevel: 2, gains: { HP: 1, STR: 1, SPD: 1 }, displayStats: edric.stats },
      });
    });
    const card = page.getByRole('dialog', { name: 'Level up', exact: true });
    await expect(card.locator('.gr-level-epithet')).toHaveText('Who Held the Bridge');
    await page.waitForTimeout(700);
    await shot('titled-levelup-phone');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await expect(card).toHaveCount(0);

    // The commander falls: the FALLEN band names the title.
    await page.evaluate(async () => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      s.gameData = { ...s.gameData, dialogue: {} };
      const commander = s.playerUnits.find((u) => u.isCommander);
      commander.currentHP = 0;
      await s.removeUnit(commander, { killer: s.enemyUnits[0] });
      s.checkBattleEnd();
    });
    await expect(page.locator('.ce-fate .ce-band-sub')).toHaveText(
      'Edric, Who Held the Bridge, has fallen',
    );
    await page.waitForTimeout(900);
    await shot('titled-fallen-phone');

    // Run end: the Deeds of the March (rendered by the run result menu).
    await page.evaluate(async () => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      document.querySelectorAll('.ce-fate, .ce-layer').forEach((n) => n.remove());
      const { runResultMenu } = await import('/src/ui/RunFlowMenus.js');
      const host = Object.assign(Object.create(s), {
        result: 'victory',
        _attemptSceneTransition() {},
      });
      s.runManager.roster.forEach((u) => {
        if (u.name === 'Edric') u.deeds = s.playerUnits[0]?.deeds || u.deeds;
      });
      const deeds = await import('/src/engine/DeedSystem.js');
      const roster = s.runManager.roster;
      roster[0]._battleDeeds = { v: 1, heldPhases: 3, heldPlaces: ['Fort', 'Fort', 'Fort'] };
      deeds.commitBattleDeeds([roster[0]], s.gameData.deeds, { battleKey: 'march' });
      const fallen = structuredClone(roster[1]);
      fallen.name = 'Rhapsody';
      fallen._battleDeeds = { v: 1, bossKills: 1, bossNames: ['Knight Commander'] };
      deeds.commitBattleDeeds([fallen], s.gameData.deeds, { battleKey: 'march' });
      s.runManager.fallenUnits = [fallen];
      window.__runMenu = runResultMenu(host, { currencyMultiplier: 1, valor: 120, supply: 40 }, null); // prettier-ignore
    });
    const march = page.getByRole('region', { name: 'Deeds of the March' });
    await expect(march.locator('li')).toHaveCount(2);
    await expect(march.locator('li').first()).toContainText('Who Held the Fort');
    await expect(march.locator('li.is-fallen')).toContainText('Rhapsody, Bane of the Knight Commander'); // prettier-ignore
    await shot('deeds-of-the-march-phone');
    expect(errors).toEqual([]);
  });
});

test.describe('640×480 canvas design size', () => {
  test.use({ viewport: { width: 640, height: 480 } });
  test('the deed rite fits the design frame', async ({ page }, info) => {
    const errors = collect(page);
    await quiet(page, 'instant');
    await page.goto('/?devScene=battle&preset=battle_smoke&seed=42');
    await waitForBattle(page);
    await earnDeedsAndWin(page);
    const rite = page.getByRole('dialog', { name: /^Deed\./ });
    await expect(rite).toBeVisible({ timeout: 45000 });
    await expect(rite).toHaveClass(/is-done/); // Instant: revealed at once
    const overflow = await rite
      .locator('.gr-deed-text')
      .evaluate((node) => node.scrollWidth > node.clientWidth + 1);
    expect(overflow).toBe(false);
    // Card inside the frame, buttons inside the viewport.
    for (const selector of ['.gr-deed-next', '.gr-deed-seal', '.gr-deed-epithet-text'])
      await expect(rite.locator(selector)).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: info.outputPath('deed-rite-640.png') });
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/deed-rite-640x480.png` });
    expect(errors).toEqual([]);
  });
});
