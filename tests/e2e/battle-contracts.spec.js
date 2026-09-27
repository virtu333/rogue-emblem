import { test, expect, devices } from '@playwright/test';
const phone = { ...devices['iPhone SE'], viewport: { width: 667, height: 375 } };
delete phone.defaultBrowserType;

async function boot(page, mobile) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(
    `/?devScene=battle&preset=combat_actions&seed=42&battleLab=1${mobile ? '&mobilePreview=1' : ''}`,
  );
  await page.waitForFunction(
    () => window.__emblemRogueGame?.scene.getScene('Battle')?.battleState === 'PLAYER_IDLE',
  );
  return errors;
}
async function tile(page, col, row, mobile) {
  const p = await page.evaluate(
    ({ col, row }) => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      const w = s.grid.gridToPixel(col, row),
        p = s._worldToScreen(w.x, w.y),
        r = s.game.canvas.getBoundingClientRect();
      return {
        x: r.x + (p.x * r.width) / s.scale.width,
        y: r.y + (p.y * r.height) / s.scale.height,
      };
    },
    { col, row },
  );
  if (mobile) await page.touchscreen.tap(p.x, p.y);
  else await page.mouse.click(p.x, p.y);
}
async function action(page, name, mobile) {
  if (mobile) {
    await page
      .getByRole('complementary', { name: 'Battle commands' })
      .getByRole('button', { name, exact: true })
      .tap();
    return;
  }
  // Read the rendered canvas labels, then use the shipping keyboard navigation.
  const steps = await page.evaluate((name) => {
    const menu = window.__emblemRogueGame.scene.getScene('Battle')._menuFocus;
    const index = menu.items.findIndex((item) => item.button.text === name);
    if (index < 0) throw new Error(`Missing canvas action: ${name}`);
    return (index - menu.index + menu.items.length) % menu.items.length;
  }, name);
  for (let i = 0; i < steps; i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
}
async function back(page, mobile) {
  if (mobile)
    await page
      .getByRole('navigation', { name: 'Battle utilities' })
      .getByRole('button', { name: 'Back', exact: true })
      .tap();
  else await page.keyboard.press('Escape');
}
async function idle(page) {
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'PLAYER_IDLE',
  );
}
async function summary(page) {
  return page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    return {
      state: s.battleState,
      turn: s.turnManager.turnNumber,
      village: s._villageState,
      gold: s.goldEarned,
      checkpoint: s.runManager.battleInProgress.checkpoint,
      units: s.playerUnits.map((u) => ({
        name: u.name,
        col: u.col,
        row: u.row,
        hp: u.currentHP,
        moved: u.hasMoved,
        acted: u.hasActed,
        spent: u._movementSpent,
        committed: u._movementCommitted,
        consumables: u.consumables,
      })),
    };
  });
}

for (const mobile of [true, false]) {
  test.describe(mobile ? 'phone action contracts' : 'desktop action contracts', () => {
    test.use(mobile ? phone : { viewport: { width: 1280, height: 800 } });
    test('committed trade survives submenu Back, reselection and another Back', async ({
      page,
    }, testInfo) => {
      test.slow(); // boot, two trades and three Backs; over 30 s on a slow runner
      const errors = await boot(page, mobile);
      await page.evaluate(() => {
        const s = window.__emblemRogueGame.scene.getScene('Battle');
        s.playerUnits.find((u) => u.name === 'Edric').consumables = [
          structuredClone(s.gameData.consumables.find((i) => i.name === 'Vulnerary')),
        ];
        s.playerUnits.find((u) => u.name === 'Sera').consumables = [];
      });
      await tile(page, 3, 3, mobile);
      await tile(page, 2, 2, mobile);
      await page.waitForFunction(
        () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'UNIT_ACTION_MENU',
      );
      await action(page, 'Trade', mobile);
      await tile(page, 2, 3, mobile);
      const trade = page.getByRole('dialog', { name: 'Trade items', exact: true });
      await trade.getByRole('tab', { name: /^Supplies/ }).click();
      await trade.getByRole('button', { name: 'Vulnerary', exact: true }).click();
      // Sera's three free supply slots all read as the same give.
      await trade
        .getByRole('button', { name: 'Give Vulnerary to Sera', exact: true })
        .first()
        .click();
      await trade.getByRole('button', { name: 'Done', exact: true }).click();
      await action(page, 'Trade', mobile);
      await back(page, mobile);
      await back(page, mobile);
      await idle(page);
      await tile(page, 2, 2, mobile);
      await back(page, mobile);
      await tile(page, 6, 2, mobile);
      const result = await summary(page);
      expect(result.units.find((u) => u.name === 'Edric')).toMatchObject({
        col: 2,
        row: 2,
        moved: true,
        spent: 2,
        acted: false,
        committed: true,
        consumables: [],
      });
      expect(result.units.find((u) => u.name === 'Sera').consumables).toHaveLength(1);
      expect(result.checkpoint.playerUnits.find((u) => u.name === 'Edric')).toMatchObject({
        col: 2,
        row: 2,
        _movementCommitted: true,
        hasActed: false,
      });
      expect(result.state).toBe('PLAYER_IDLE');
      await page.screenshot({ path: testInfo.outputPath('trade-movement-committed.png') });
      expect(errors).toEqual([]);
    });
  });
}

test.describe('desktop full–full trade', () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  test('keyboard swaps the equipped weapons of two full bags; Attack stays, Wait acts once', async ({
    page,
  }, testInfo) => {
    test.slow(); // boot, a trade and a Wait
    const errors = await boot(page, false);
    // Edric: five weapons, the Iron Sword equipped. Sera (the preset): Glimmer
    // equipped, then Heal, Restore, Rescue Staff and Warp Staff; Light and Staff only.
    const before = await page.evaluate(async () => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      const { ensureItemUid } = await import('/src/utils/itemUid.js');
      const weapon = (name) => structuredClone(s.gameData.weapons.find((w) => w.name === name));
      const edric = s.playerUnits.find((u) => u.name === 'Edric');
      const sera = s.playerUnits.find((u) => u.name === 'Sera');
      edric.inventory.push(...['Steel Sword', 'Rapier', 'Iron Lance', 'Iron Axe'].map(weapon));
      for (const u of [edric, sera]) u.inventory.forEach(ensureItemUid);
      s._timelineBoundary = 'turn_start';
      s._captureSuspendCheckpoint();
      window.__acted = [];
      const unitActed = s.turnManager.unitActed.bind(s.turnManager);
      s.turnManager.unitActed = (unit) => {
        window.__acted.push(unit.name);
        return unitActed(unit);
      };
      const uid = (u, name) => u.inventory.find((w) => w.name === name).uid;
      return {
        edric: ['Iron Sword', 'Steel Sword', 'Rapier', 'Iron Lance', 'Iron Axe'].map((n) =>
          uid(edric, n),
        ),
        sera: ['Glimmer', 'Heal', 'Restore', 'Rescue Staff', 'Warp Staff'].map((n) => uid(sera, n)),
        seraWeapon: sera.weapon.name,
        index: s.runManager.battleInProgress.checkpoint.checkpointIndex,
      };
    });
    expect(before.seraWeapon).toBe('Glimmer');
    // Edric stays on his tile (3,3), beside Sera (2,3) and the Knight (4,3).
    await tile(page, 3, 3, false);
    await tile(page, 3, 3, false);
    await page.waitForFunction(
      () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'UNIT_ACTION_MENU',
    );
    await action(page, 'Trade', false);
    await tile(page, 2, 3, false);
    const trade = page.getByRole('dialog', { name: 'Trade items', exact: true });
    await expect(trade.getByRole('tab', { name: 'Weapons 5/5 · 5/5' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(trade.locator('.tm-notice')).toHaveText("Trading locks in Edric's move.");
    // Keyboard only from here: focus starts on Edric's first item.
    const focused = () => page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
    await expect.poll(focused).toBe('Iron Sword, equipped');
    await page.keyboard.press('Enter');
    await page.keyboard.press('ArrowRight');
    await expect.poll(focused).toBe('Trade Iron Sword for Glimmer');
    const target = trade.locator('.tm-row[data-side="right"][data-index="0"]');
    await expect(target.locator('.tm-warn')).toContainText('Leaves Sera unarmed');
    await page.screenshot({ path: testInfo.outputPath('trade-full-full-held.png') });
    await page.keyboard.press('Enter');
    await expect(trade.locator('.tm-status')).toHaveText('Traded Iron Sword for Glimmer.');
    await expect(trade.locator('.tm-notice')).toBeHidden();
    // By hand: each item takes the other's slot 0. Edric can't use Glimmer, so his first
    // usable weapon (Steel Sword, slot 1) is equipped and moves to slot 0. Sera can't use
    // the Iron Sword and has no other attack, so her first staff (Heal) is equipped.
    const [ironSword, steel, rapier, lance, axe] = before.edric;
    const [glimmer, heal, restore, rescue, warp] = before.sera;
    const expected = {
      Edric: { uids: [steel, glimmer, rapier, lance, axe], weapon: steel },
      Sera: { uids: [heal, ironSword, restore, rescue, warp], weapon: heal },
    };
    const bags = () =>
      page.evaluate(() => {
        const s = window.__emblemRogueGame.scene.getScene('Battle');
        const cp = s.runManager.battleInProgress.checkpoint;
        const view = (u) => ({
          uids: u.inventory.map((w) => w.uid),
          weapon: u.weapon?.uid,
          acted: u.hasActed,
          committed: u._movementCommitted === true,
        });
        const saved = (u) => ({
          uids: u.inventory.map((w) => w.uid),
          weapon: u.inventory[u.equippedInventoryIndex]?.uid,
          acted: u.hasActed,
          committed: u._movementCommitted,
        });
        const pick = (list, fn) =>
          Object.fromEntries(
            list.filter((u) => ['Edric', 'Sera'].includes(u.name)).map((u) => [u.name, fn(u)]),
          );
        return {
          live: pick(s.playerUnits, view),
          saved: pick(cp.playerUnits, saved),
          index: cp.checkpointIndex,
          state: s.battleState,
        };
      });
    const traded = await bags();
    expect(traded.live).toEqual({
      Edric: { ...expected.Edric, acted: false, committed: true },
      Sera: { ...expected.Sera, acted: false, committed: false },
    });
    // The trade is checkpointed: a refresh resumes with the swap and the move locked in.
    expect(traded.saved).toEqual(traded.live);
    expect(traded.index).toBeGreaterThan(before.index);
    // Done (Tab to it, Enter): back to Edric's commands, Attack still offered.
    const focusedText = () => page.evaluate(() => document.activeElement?.textContent);
    for (let i = 0; i < 16 && (await focusedText()) !== 'Done'; i++)
      await page.keyboard.press('Tab');
    expect(await focusedText()).toBe('Done');
    await page.keyboard.press('Enter');
    await expect(trade).toHaveCount(0);
    const menu = await page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      return { state: s.battleState, items: s._menuFocus.items.map((item) => item.label) };
    });
    expect(menu.state).toBe('UNIT_ACTION_MENU');
    expect(menu.items).toEqual(expect.arrayContaining(['Attack', 'Trade', 'Wait']));
    await action(page, 'Wait', false);
    await idle(page);
    const waited = await bags();
    expect(await page.evaluate(() => window.__acted)).toEqual(['Edric']);
    expect(waited.live).toEqual({
      Edric: { ...expected.Edric, acted: true, committed: true },
      Sera: { ...expected.Sera, acted: false, committed: false },
    });
    expect(waited.saved).toEqual(waited.live);
    await page.screenshot({ path: testInfo.outputPath('trade-full-full-waited.png') });
    expect(errors).toEqual([]);
  });
});

// The battle trade menu fits every supported screen: phones in landscape with the
// mobile preview (coarse pointer: 44 px rows) and desktop (fine pointer: 32 px rows).
const TRADE_LAYOUTS = [
  { name: 'phone 568×320', width: 568, height: 320, mobile: true },
  { name: 'phone 667×375', width: 667, height: 375, mobile: true },
  { name: 'phone 844×390', width: 844, height: 390, mobile: true },
  { name: 'desktop 640×480', width: 640, height: 480, mobile: false },
  { name: 'desktop 1280×800', width: 1280, height: 800, mobile: false },
];
for (const layout of TRADE_LAYOUTS) {
  test.describe(`battle trade layout ${layout.name}`, () => {
    test.use(
      layout.mobile
        ? { ...phone, viewport: { width: layout.width, height: layout.height } }
        : { viewport: { width: layout.width, height: layout.height } },
    );
    test('two full bags: both columns, Done and the status fit with no sideways overflow', async ({
      page,
    }, testInfo) => {
      const errors = await boot(page, layout.mobile);
      await page.evaluate(() => {
        const s = window.__emblemRogueGame.scene.getScene('Battle');
        const weapon = (name) => structuredClone(s.gameData.weapons.find((w) => w.name === name));
        const edric = s.playerUnits.find((u) => u.name === 'Edric');
        const sera = s.playerUnits.find((u) => u.name === 'Sera');
        // Long names: a forged legend and a tome among full bags.
        const grasp = weapon('Eldritch Grasp');
        grasp.name = 'Eldritch Grasp +3';
        edric.inventory.push(
          grasp,
          weapon('Twisting Vortex'),
          weapon('Silver Sword'),
          weapon('Iron Lance'),
        );
        edric.consumables = ['Vulnerary', 'Elixir', 'Master Seal'].map((n) =>
          structuredClone(s.gameData.consumables.find((c) => c.name === n)),
        );
        s.selectUnit(edric);
        s.executeTrade(edric, { ally: sera });
      });
      const trade = page.getByRole('dialog', { name: 'Trade items', exact: true });
      await expect(trade).toBeVisible();
      // Hold an item so every target row carries its name and warnings (the tallest rows).
      await trade.getByRole('button', { name: 'Iron Sword, equipped', exact: true }).click();
      await expect(trade.locator('.tm-status')).toHaveText(
        "Holding Iron Sword. Sera can't wield Iron Sword. Choose where it goes.",
      );
      const box = async (locator) => {
        const b = await locator.boundingBox();
        expect(b, 'rendered').not.toBeNull();
        return b;
      };
      const within = (b) =>
        b.x >= -0.5 &&
        b.y >= -0.5 &&
        b.x + b.width <= layout.width + 0.5 &&
        b.y + b.height <= layout.height + 0.5;
      expect(within(await box(trade.getByRole('button', { name: 'Done', exact: true })))).toBe(
        true,
      );
      expect(within(await box(trade.locator('.tm-status')))).toBe(true);
      const dialog = await box(trade);
      expect(within(dialog)).toBe(true);
      for (const side of ['left', 'right']) {
        const column = await box(trade.locator(`.tm-col-${side}`));
        expect(within(column), `${side} column on screen`).toBe(true);
        // Two columns share the dialog (capped at 760 px wide on large screens).
        expect(column.width).toBeGreaterThan(dialog.width * 0.4);
        // The first row of each column is on screen, whole.
        expect(within(await box(trade.locator(`.tm-row[data-side="${side}"]`).first()))).toBe(true);
      }
      for (const tab of await trade.getByRole('tab').all())
        expect(within(await box(tab))).toBe(true);
      const measure = () =>
        page.evaluate(() => {
          const root = document.querySelector('.tm-trade');
          const rows = [...root.querySelectorAll('.tm-row')].map((r) => r.getBoundingClientRect());
          const overflowing = [root, ...root.querySelectorAll('.tm-col, .tm-list, .tm-row, header')]
            .filter((el) => el.scrollWidth > el.clientWidth + 1)
            .map((el) => el.className);
          return {
            overflowing,
            page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            minRow: Math.min(...rows.map((r) => r.height)),
            coarse: matchMedia('(pointer: coarse)').matches,
          };
        });
      const tap = layout.mobile ? 44 : 32;
      const weapons = await measure();
      expect(weapons.overflowing).toEqual([]);
      expect(weapons.page).toBeLessThanOrEqual(0);
      expect(weapons.coarse).toBe(layout.mobile);
      expect(weapons.minRow).toBeGreaterThanOrEqual(tap);
      await page.screenshot({ path: testInfo.outputPath(`trade-layout-${layout.width}.png`) });
      // Supplies: Sera's two free slots are one-line "Empty" rows, still a full tap target.
      await trade.getByRole('tab', { name: /^Supplies/ }).click();
      await expect(trade.locator('.tm-row.is-empty')).toHaveCount(2);
      const supplies = await measure();
      expect(supplies.overflowing).toEqual([]);
      expect(supplies.minRow).toBeGreaterThanOrEqual(tap);
      expect(errors).toEqual([]);
    });
  });
}

test.describe('phone Canto and rewind contracts', () => {
  test.use(phone);
  for (const ending of ['Back', 'same tile', 'move']) {
    test(`Canto ${ending} claims the final village and saves the action`, async ({
      page,
    }, testInfo) => {
      const errors = await boot(page, true);
      const village = ending === 'move' ? { col: 2, row: 2 } : { col: 3, row: 3 };
      const maxHP = await page.evaluate((pos) => {
        const s = window.__emblemRogueGame.scene.getScene('Battle'),
          u = s.playerUnits.find((u) => u.name === 'Edric');
        u.skills.push('canto');
        u.currentHP -= 10;
        u.consumables = [
          structuredClone(s.gameData.consumables.find((i) => i.name === 'Vulnerary')),
        ];
        s.updateHPBar(u);
        s.battleConfig.villageTile = pos;
        s._villageState = { ...pos, status: 'intact' };
        s.grid.setTerrainAt(
          pos.col,
          pos.row,
          s.gameData.terrain.findIndex((t) => t.name === 'Village'),
        );
        s._villageController._renderMarker();
        // The injected loadout (a fresh Vulnerary instance) is fixture state that belongs
        // to the turn start, not a free bag change between activations: rewind
        // fingerprints items by identity, so record it as the turn-start point.
        s._timelineBoundary = 'turn_start';
        s._captureSuspendCheckpoint();
        return u.stats.HP;
      }, village);
      const before = await summary(page);
      await tile(page, 3, 3, true);
      await action(page, 'Item', true);
      await page
        .getByRole('complementary', { name: 'Battle commands' })
        .getByRole('button', { name: /^Vulnerary/ })
        .tap();
      await page.waitForFunction(
        () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'CANTO_MOVING',
      );
      if (ending === 'Back') await back(page, true);
      else await tile(page, village.col, village.row, true);
      await idle(page);
      const after = await summary(page);
      expect(after.village.status).toBe('visited');
      expect(after.gold).toBeGreaterThan(before.gold);
      expect(after.checkpoint.checkpointIndex).toBe(before.checkpoint.checkpointIndex + 1);
      // The visit's gold and supplies belong to this action's point: nothing is left over
      // for the next activation to record as a free change.
      expect(
        await page.evaluate(() => {
          const s = window.__emblemRogueGame.scene.getScene('Battle');
          return {
            settled: s._visionController.settleParkedActivation(),
            index: s.runManager.battleInProgress.checkpoint.checkpointIndex,
          };
        }),
      ).toEqual({ settled: false, index: after.checkpoint.checkpointIndex });
      expect(after.checkpoint.villageState.status).toBe('visited');
      expect(after.checkpoint.playerUnits.find((u) => u.name === 'Edric')).toMatchObject({
        col: village.col,
        row: village.row,
        hasActed: true,
        currentHP: maxHP,
      });
      expect(after.units.find((u) => u.name === 'Edric').consumables[0].uses).toBe(2);
      await page.screenshot({ path: testInfo.outputPath('canto-village-saved.png') });
      expect(errors).toEqual([]);
    });
  }
  test('Vision preserves resolved turn-start healing and does not heal twice', async ({
    page,
  }, testInfo) => {
    test.slow(); // plays an enemy phase and a Vision rewind
    const errors = await boot(page, true);
    // Rewind now commits an exact saved branch; give this dev fixture a real slot.
    await page.evaluate(async () => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      const { getMetaKey, setActiveSlot } = await import('/src/engine/SlotManager.js');
      const meta = s.registry.get('meta');
      meta.storageKey = getMetaKey(1);
      meta._save();
      s.registry.set('activeSlot', 1);
      setActiveSlot(1);
      s._captureSuspendCheckpoint();
    });
    await page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('Battle'),
        u = s.playerUnits.find((u) => u.name === 'Sera');
      u.skills.push('renewal');
      u.stats.HP = 50;
      u.currentHP = 10;
      s.updateHPBar(u);
      s.enemyUnits.forEach((e, i) => {
        e.col = 9;
        e.row = 5 + i;
        e.mov = 0;
        e.stats.MOV = 0;
        s.updateUnitPosition(e);
      });
    });
    const hud = page.getByRole('complementary', { name: 'Battle commands' });
    await hud.getByRole('button', { name: 'End turn…', exact: true }).tap();
    await hud.getByRole('button', { name: 'End turn now', exact: true }).tap();
    await page.waitForFunction(() => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      return s.turnManager.turnNumber === 2 && s.battleState === 'PLAYER_IDLE';
    });
    const healed = await summary(page);
    expect(healed.units.find((u) => u.name === 'Sera').hp).toBe(15);
    await tile(page, 3, 3, true);
    await action(page, 'Wait', true);
    await idle(page);
    await hud.getByRole('button', { name: 'Rewind', exact: true }).tap();
    const picker = page.getByRole('dialog', { name: 'Rewind', exact: true });
    // The newest point is the start of turn 2, just before Edric's wait.
    await expect(picker.locator('.vr-row').first().locator('.vr-title')).toHaveText(
      'Start of turn 2',
    );
    await picker.getByRole('button', { name: 'Rewind here · 1 charge', exact: true }).tap();
    await idle(page);
    const rewound = await summary(page);
    expect(rewound.turn).toBe(2);
    expect(rewound.units.map((u) => [u.name, u.hp])).toEqual(
      healed.units.map((u) => [u.name, u.hp]),
    );
    expect(rewound.units.find((u) => u.name === 'Edric').acted).toBe(false);
    await page.screenshot({ path: testInfo.outputPath('rewind-preserves-healing.png') });
    expect(errors).toEqual([]);
  });
});
