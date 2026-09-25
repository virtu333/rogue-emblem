import { test, expect, devices } from '@playwright/test';
import { waitForScene } from './helpers.js';

// Every kind of player action becomes a rewind point "Before <unit>'s
// <action>", and rewinding to it restores the board exactly (units, HP,
// positions, uses, statuses, ability/art usage, gold and the battle RNG).
// One battle, real phone UI: act → Rewind → confirm → compare, per action.
const { defaultBrowserType: _engine, ...PHONE } = devices['iPhone SE'];
test.use({ ...PHONE, viewport: { width: 844, height: 390 } });
test.setTimeout(420000);

const URL = '/?devScene=battle&preset=combat_actions&seed=42&battleLab=1&mobilePreview=1';

async function boot(page) {
  await page.routeWebSocket(/^ws:\/\/(?:127\.0\.0\.1|localhost):\d+/, (socket) => socket.close());
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() =>
    localStorage.setItem(
      'emblem_rogue_settings',
      JSON.stringify({ musicVolume: 0, sfxVolume: 0, hints: false, battleSpeed: 'instant' }),
    ),
  );
  await page.goto(URL);
  await waitForScene(page, 'Battle');
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'PLAYER_IDLE',
  );
  await page.evaluate(async () => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const { getMetaKey, setActiveSlot } = await import('/src/engine/SlotManager.js');
    const meta = s.registry.get('meta');
    meta.storageKey = getMetaKey(1);
    meta._save();
    s.registry.set('activeSlot', 1);
    setActiveSlot(1);
    s.runManager.visionChargesRemaining = 40;
    // Synthetic loadout only: every action kind is available from the start.
    const patient = s.playerUnits.find((u) => u.name === 'Patient');
    patient.consumables = [
      { name: 'Vulnerary', type: 'Consumable', effect: 'heal', value: 10, uses: 3 },
    ];
    patient._conditions = [{ id: 'poison', turnsRemaining: 3 }];
    s._timelineBoundary = 'turn_start';
    s._captureSuspendCheckpoint();
  });
  return errors;
}

function digest(page) {
  return page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const unit = (u) => ({
      id: u.battleEntityId,
      pos: [u.col, u.row],
      hp: u.currentHP,
      acted: u.hasActed === true,
      moved: u.hasMoved === true,
      committed: u._movementCommitted === true,
      xp: u.xp,
      weapon: u.weapon?.name || null,
      items: (u.inventory || []).map((w) => [w.name, w.uses ?? null, w._usesSpent ?? 0]),
      consumables: (u.consumables || []).map((c) => [c.name, c.uses ?? null]),
      arts: u._battleWeaponArtUsage || null,
      abilities: u._battleAbilityUsage || null,
      buffs: u._battleTimedWeaponArtBuffs || null,
      conditions: (u._conditions || []).map((c) => [c.id, c.turnsRemaining]),
    });
    return {
      turn: s.turnManager.turnNumber,
      phase: s.turnManager.currentPhase,
      players: s.playerUnits.map(unit),
      enemies: s.enemyUnits.map(unit),
      goldEarned: s.goldEarned,
      rng: s._battleRng.getState(),
    };
  });
}

const idle = (page) =>
  page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'PLAYER_IDLE',
    null,
    { timeout: 20000 },
  );
async function tapTile(page, col, row) {
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
  await page.touchscreen.tap(p.x, p.y);
}
async function select(page, name) {
  const pos = await page.evaluate((n) => {
    const u = window.__emblemRogueGame.scene
      .getScene('Battle')
      .playerUnits.find((unit) => unit.name === n);
    return { col: u.col, row: u.row };
  }, name);
  await tapTile(page, pos.col, pos.row);
}
const hud = (page) => page.getByRole('complementary', { name: 'Battle commands' });
const hasActed = (page, name) =>
  page.waitForFunction(
    (n) =>
      window.__emblemRogueGame.scene.getScene('Battle').playerUnits.find((u) => u.name === n)
        ?.hasActed,
    name,
    { timeout: 20000 },
  );

/** Each entry: [title of the new newest row, how to perform the action]. */
const ACTIONS = [
  [
    'Before Patient’s wait',
    async (page) => {
      await select(page, 'Patient');
      await hud(page).getByRole('button', { name: 'Wait', exact: true }).tap();
    },
  ],
  [
    'Before Patient’s move',
    async (page) => {
      await select(page, 'Patient');
      await tapTile(page, 1, 5);
      await hud(page).getByRole('button', { name: 'Wait', exact: true }).tap();
    },
  ],
  [
    'Before Edric’s attack on Knight',
    async (page) => {
      await select(page, 'Edric');
      await hud(page).getByRole('button', { name: 'Attack', exact: true }).tap();
      await tapTile(page, 4, 3);
      await page.getByRole('button', { name: 'Confirm attack', exact: true }).tap();
      await hasActed(page, 'Edric');
    },
  ],
  [
    'Before Edric’s Wrath Strike on Knight',
    async (page) => {
      await select(page, 'Edric');
      await hud(page)
        .getByRole('button', { name: /^Weapon Art/ })
        .tap();
      await hud(page)
        .getByRole('button', { name: /Wrath Strike/ })
        .tap();
      await tapTile(page, 4, 3);
      await page.getByRole('button', { name: 'Confirm attack', exact: true }).tap();
      await hasActed(page, 'Edric');
    },
  ],
  [
    'Before Sera’s heal on Patient',
    async (page) => {
      await select(page, 'Sera');
      await hud(page)
        .getByRole('button', { name: /^Heal \(/ })
        .tap();
      await hud(page)
        .getByRole('button', { name: /^Heal / })
        .tap();
      await tapTile(page, 2, 4);
      await hasActed(page, 'Sera');
    },
  ],
  [
    'Before Sera’s Warp Staff on Patient',
    async (page) => {
      await select(page, 'Sera');
      await hud(page)
        .getByRole('button', { name: /^Heal \(/ })
        .tap();
      await hud(page)
        .getByRole('button', { name: /Warp Staff/ })
        .tap();
      await tapTile(page, 2, 4);
      const dest = await page.evaluate(
        () => window.__emblemRogueGame.scene.getScene('Battle').staffRelocateTiles[0],
      );
      await tapTile(page, dest.col, dest.row);
      await hasActed(page, 'Sera');
    },
  ],
  [
    'Before Sera’s cure on Patient',
    async (page) => {
      await select(page, 'Sera');
      await hud(page)
        .getByRole('button', { name: /^Heal \(/ })
        .tap();
      await hud(page)
        .getByRole('button', { name: /Restore/ })
        .tap();
      await tapTile(page, 2, 4);
      await hasActed(page, 'Sera');
    },
  ],
  [
    'Before Patient’s Vulnerary',
    async (page) => {
      await select(page, 'Patient');
      await hud(page).getByRole('button', { name: 'Item', exact: true }).tap();
      await hud(page)
        .getByRole('button', { name: /^Vulnerary/ })
        .first()
        .tap();
      await hasActed(page, 'Patient');
    },
  ],
  [
    'Before Support’s shove on Patient',
    async (page) => {
      await select(page, 'Support');
      await hud(page).getByRole('button', { name: 'Shove', exact: true }).tap();
      await tapTile(page, 2, 4);
      await hasActed(page, 'Support');
    },
  ],
  [
    'Before Support’s pull on Edric',
    async (page) => {
      await select(page, 'Support');
      await hud(page).getByRole('button', { name: 'Pull', exact: true }).tap();
      await tapTile(page, 3, 3);
      await hasActed(page, 'Support');
    },
  ],
  [
    'Before Utility’s heal on Patient',
    async (page) => {
      await select(page, 'Utility');
      await hud(page).getByRole('button', { name: 'Ability', exact: true }).tap();
      await hud(page)
        .getByRole('button', { name: /^Healing Circle/ })
        .tap();
      await hud(page)
        .getByRole('button', { name: /^Use Healing Circle/ })
        .tap();
      await hasActed(page, 'Utility');
    },
  ],
  [
    'Before Utility’s Rally Cry',
    async (page) => {
      await select(page, 'Utility');
      await hud(page).getByRole('button', { name: 'Ability', exact: true }).tap();
      await hud(page)
        .getByRole('button', { name: /^Rally Cry/ })
        .tap();
      await hud(page)
        .getByRole('button', { name: /^Use Rally Cry/ })
        .tap();
      await hasActed(page, 'Utility');
    },
  ],
  [
    /^Before Utility’s ensnare on \S/,
    async (page) => {
      await select(page, 'Utility');
      await hud(page).getByRole('button', { name: 'Ability', exact: true }).tap();
      await hud(page)
        .getByRole('button', { name: /^Ensnare/ })
        .tap();
      await hud(page)
        .getByRole('button', { name: /^Use Ensnare/ })
        .tap();
      await hasActed(page, 'Utility');
    },
  ],
  [
    'Before Utility’s Blink',
    async (page) => {
      await select(page, 'Utility');
      await hud(page).getByRole('button', { name: 'Ability', exact: true }).tap();
      await hud(page)
        .getByRole('button', { name: /^Blink/ })
        .tap();
      await tapTile(page, 5, 5);
      await hasActed(page, 'Utility');
    },
  ],
];

test('every action kind is a rewind point that restores the board exactly', async ({ page }) => {
  const errors = await boot(page);
  const picker = page.getByRole('dialog', { name: 'Rewind', exact: true });
  const results = [];
  for (const [title, perform] of ACTIONS) {
    const before = await digest(page);
    const charges = await page.evaluate(
      () => window.__emblemRogueGame.scene.getScene('Battle').runManager.visionChargesRemaining,
    );
    await perform(page);
    await idle(page);
    const after = await digest(page);
    expect(after, `${title}: the action changed the board`).not.toEqual(before);
    await page.getByRole('button', { name: 'Rewind', exact: true }).tap();
    await expect(picker.locator('.vr-row').first().locator('.vr-title')).toHaveText(title);
    await picker.getByRole('button', { name: 'Rewind here · 1 charge', exact: true }).tap();
    await expect(picker).toHaveCount(0);
    await idle(page);
    expect(await digest(page), `${title}: restored`).toEqual(before);
    expect(
      await page.evaluate(
        () => window.__emblemRogueGame.scene.getScene('Battle').runManager.visionChargesRemaining,
      ),
    ).toBe(charges - 1);
    results.push(title);
  }
  expect(results).toHaveLength(ACTIONS.length);
  expect(errors).toEqual([]);
});

test('Dance: the danced unit acting again is its own point', async ({ page }) => {
  const errors = await boot(page);
  const picker = page.getByRole('dialog', { name: 'Rewind', exact: true });
  await select(page, 'Patient');
  await hud(page).getByRole('button', { name: 'Wait', exact: true }).tap();
  await idle(page);
  const beforeDance = await digest(page);
  await select(page, 'Support');
  await hud(page).getByRole('button', { name: 'Dance', exact: true }).tap();
  await tapTile(page, 2, 4);
  await hasActed(page, 'Support');
  await idle(page);
  const afterDance = await digest(page);
  await select(page, 'Patient');
  await hud(page).getByRole('button', { name: 'Wait', exact: true }).tap();
  await idle(page);
  await page.getByRole('button', { name: 'Rewind', exact: true }).tap();
  await expect(picker.locator('.vr-row .vr-title')).toHaveText([
    'Before Patient’s wait',
    'Before Support’s dance on Patient',
    'Start of turn 1',
  ]);
  await picker.getByRole('button', { name: 'Rewind here · 1 charge', exact: true }).tap();
  await idle(page);
  expect(await digest(page)).toEqual(afterDance);
  await page.getByRole('button', { name: 'Rewind', exact: true }).tap();
  await picker.locator('.vr-row').first().tap();
  await expect(picker.locator('.vr-row').first().locator('.vr-title')).toHaveText(
    'Before Support’s dance on Patient',
  );
  await picker.getByRole('button', { name: 'Rewind here · 1 charge', exact: true }).tap();
  await idle(page);
  expect(await digest(page)).toEqual(beforeDance);
  expect(errors).toEqual([]);
});

test('End turn: the enemy phase is undone by returning to before ending the turn', async ({
  page,
}) => {
  const errors = await boot(page);
  const picker = page.getByRole('dialog', { name: 'Rewind', exact: true });
  await select(page, 'Patient');
  await hud(page).getByRole('button', { name: 'Wait', exact: true }).tap();
  await idle(page);
  const beforeEnd = await digest(page);
  await hud(page).getByRole('button', { name: 'End turn…', exact: true }).tap();
  await hud(page).getByRole('button', { name: 'End turn now', exact: true }).tap();
  await page.waitForFunction(
    () => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      return (s.turnManager.turnNumber === 2 && s.battleState === 'PLAYER_IDLE') || s.visionDialog;
    },
    null,
    { timeout: 60000 },
  );
  const fatal = await page.evaluate(
    () => !!window.__emblemRogueGame.scene.getScene('Battle').visionDialog,
  );
  if (fatal) await page.getByRole('button', { name: /^Rewind · / }).tap();
  else await page.getByRole('button', { name: 'Rewind', exact: true }).tap();
  await expect(picker).toBeVisible();
  const titles = await picker.locator('.vr-row .vr-title').allTextContents();
  // The handoff itself ("enemies act next") is never offered: it would only
  // replay the same enemy phase.
  expect(titles).toContain('Before ending the turn');
  await picker.locator('.vr-row', { hasText: 'Before ending the turn' }).tap();
  await picker.getByRole('button', { name: 'Rewind here · 1 charge', exact: true }).tap();
  await idle(page);
  expect(await digest(page)).toEqual(beforeEnd);
  expect(errors).toEqual([]);
});
