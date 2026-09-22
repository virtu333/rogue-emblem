import { test, expect, devices } from '@playwright/test';
import { waitForScene } from './helpers.js';
test.use({ ...devices['iPhone SE'], viewport: { width: 844, height: 390 } });
test.setTimeout(90000);
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
  await page.goto('/?devScene=battle&preset=fresh&seed=42&mobilePreview=1');
  await waitForScene(page, 'Battle');
  for (let i = 0; i < 12; i++) {
    if (
      await page.evaluate(
        () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'PLAYER_IDLE',
      )
    )
      break;
    const skip = page.getByRole('button', { name: 'Skip conversation', exact: true });
    if (await skip.isVisible()) await skip.tap();
    const fight = page.getByRole('button', { name: /^(Fight|Begin battle|Start battle|Deploy)/i });
    if ((await fight.count()) && (await fight.first().isVisible())) await fight.first().tap();
    await page.waitForTimeout(300);
  }
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
    s.runManager.visionChargesRemaining = 3;
    s._captureSuspendCheckpoint();
  });
  return errors;
}
async function digest(page) {
  return page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    return {
      saved: localStorage.getItem('emblem_rogue_slot_1_run'),
      units: s.playerUnits.map((u) => [u.battleEntityId, u.col, u.row, u.currentHP, u.hasActed]),
      rng: s._battleRng.getState(),
    };
  });
}
async function tapAlly(page, index) {
  const p = await page.evaluate((index) => {
    const s = window.__emblemRogueGame.scene.getScene('Battle'),
      u = s.playerUnits[index];
    const w = s.grid.gridToPixel(u.col, u.row),
      p = s._worldToScreen(w.x, w.y),
      r = s.game.canvas.getBoundingClientRect();
    return { x: r.x + (p.x * r.width) / s.scale.width, y: r.y + (p.y * r.height) / s.scale.height };
  }, index);
  await page.touchscreen.tap(p.x, p.y);
}

test('timeline preview is free; cancellation preserves action; confirmed rewind persists across reload', async ({
  page,
}) => {
  const errors = await boot(page);
  await tapAlly(page, 0);
  await page
    .getByRole('complementary', { name: 'Battle commands' })
    .getByRole('button', { name: 'Wait', exact: true })
    .tap();
  await page.getByRole('button', { name: 'Rewind', exact: true }).tap();
  const view = page.getByRole('dialog', { name: 'Battle timeline', exact: true });
  await expect(view).toBeVisible();
  const before = await digest(page);
  if (!(await view.locator('.bt-entry').first().isVisible()))
    await view.getByRole('button', { name: 'History', exact: true }).tap();
  await view.locator('.bt-entry').first().tap();
  await view.locator('.bt-entry').last().tap();
  if (!(await view.locator('.bt-entry').first().isVisible()))
    await view.getByRole('button', { name: 'History', exact: true }).tap();
  await view.locator('.bt-entry').first().tap();
  await expect(view.locator('.bt-entry').first()).toHaveAttribute('aria-pressed', 'true');
  await expect(view.locator('.bt-entry[aria-pressed="true"]')).toHaveCount(1);
  expect(await digest(page)).toEqual(before);
  await page.screenshot({ path: '/tmp/battle-timeline-phone.png' });
  await view.getByRole('button', { name: 'Rewind… · 1 charge', exact: true }).tap();
  const confirm = page.getByRole('dialog', { name: 'Rewind to this point?', exact: true });
  await confirm.getByRole('button', { name: 'Back', exact: true }).tap();
  expect(await digest(page)).toEqual(before);
  if (!(await view.locator('.bt-entry').first().isVisible()))
    await view.getByRole('button', { name: 'History', exact: true }).tap();
  await view.locator('.bt-entry').first().tap();
  await view.getByRole('button', { name: 'Rewind… · 1 charge', exact: true }).tap();
  await confirm.getByRole('button', { name: 'Spend 1 rewind', exact: true }).tap();
  await expect(view).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(
        () => window.__emblemRogueGame.scene.getScene('Battle').runManager.visionChargesRemaining,
      ),
    )
    .toBe(2);
  const after = await digest(page);
  expect(after.units[0][4]).toBe(false);
  const persisted = JSON.parse(after.saved);
  expect(persisted.visionChargesRemaining).toBe(2);
  expect(persisted.battleInProgress.checkpoint.playerUnits[0].hasActed).toBe(false);
  await reloadSavedBattle(page);
  expect(
    await page.evaluate(
      () => window.__emblemRogueGame.scene.getScene('Battle').runManager.visionChargesRemaining,
    ),
  ).toBe(2);
  expect(
    await page.evaluate(
      () => window.__emblemRogueGame.scene.getScene('Battle').playerUnits[0].hasActed,
    ),
  ).toBe(false);
  expect(errors).toEqual([]);
});

async function reloadSavedBattle(page) {
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
  await page.getByRole('button', { name: 'Resume Battle', exact: true }).tap();
  await waitForScene(page, 'Battle');
  await page.waitForFunction(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    return s.battleState === 'PLAYER_IDLE' || Boolean(s.visionDialog);
  });
}

test('zero charges still allows review, rotation and return to landscape, and keyboard close without mutation', async ({
  page,
}) => {
  const errors = await boot(page);
  await tapAlly(page, 0);
  await page
    .getByRole('complementary', { name: 'Battle commands' })
    .getByRole('button', { name: 'Wait', exact: true })
    .tap();
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    s.runManager.visionChargesRemaining = 0;
    s._captureSuspendCheckpoint();
  });
  await page.getByRole('button', { name: 'Rewind', exact: true }).tap();
  const view = page.getByRole('dialog', { name: 'Battle timeline', exact: true });
  const before = await digest(page);
  if (!(await view.locator('.bt-entry').first().isVisible()))
    await view.getByRole('button', { name: 'History', exact: true }).tap();
  await view.locator('.bt-entry').first().tap();
  await expect(view.locator('.bt-reason')).toContainText('No rewind charges');
  await expect(view.locator('.bt-rewind')).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '/tmp/battle-timeline-portrait.png' });
  // Portrait uses the application's rotation guard; test the return to the
  // supported landscape layout rather than claiming portrait timeline support.
  await page.setViewportSize({ width: 667, height: 375 });
  await expect(view).toBeVisible();
  const fits = await view.evaluate((el) => el.scrollWidth <= el.clientWidth);
  expect(fits).toBe(true);
  await expect(view.locator('.bt-rewind')).toBeInViewport();
  await page.keyboard.press('Escape');
  await expect(view).toHaveCount(0);
  expect(await digest(page)).toEqual(before);
  expect(errors).toEqual([]);
});

test('fatal decision survives reload and Back; accepting fate exposes read-only report', async ({
  page,
}) => {
  const errors = await boot(page);
  // A synthetic fatal attack isolates the terminal UI and real save/reload
  // lifecycle; battle mechanics themselves are covered by engine tests.
  await page.evaluate(async () => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    s.gameData = { ...s.gameData, dialogue: {} };
    // An invalid legacy anchor can be discarded on load while the canonical
    // timeline destination remains valid. It must still allow fatal rewind.
    s.visionSnapshot = null;
    const commander = s.playerUnits.find((u) => u.isCommander);
    commander.currentHP = 0;
    await s.removeUnit(commander, { killer: s.enemyUnits[0] });
    s.checkBattleEnd();
  });
  const decision = page.getByRole('button', { name: 'Review timeline', exact: true });
  await expect(decision).toBeVisible();
  await decision.tap();
  const view = page.getByRole('dialog', { name: 'Battle timeline', exact: true });
  await view.getByRole('button', { name: 'Back to decision', exact: true }).tap();
  await expect(decision).toBeVisible();
  await reloadSavedBattle(page);
  await expect(decision).toBeVisible();
  expect(
    await page.evaluate(() =>
      window.__emblemRogueGame.scene.getScene('Battle').playerUnits.some((u) => u.isCommander),
    ),
  ).toBe(false);
  await page.getByRole('button', { name: 'Accept Fate', exact: true }).tap();
  await waitForScene(page, 'RunComplete');
  const farewell = page.getByRole('button', { name: 'Skip conversation', exact: true });
  if (await farewell.isVisible()) await farewell.tap();
  await page.getByRole('button', { name: 'Battle report', exact: true }).tap();
  await expect(view).toBeVisible();
  await expect(view.locator('.bt-rewind')).toBeDisabled();
  await expect(view.locator('.bt-summary')).toContainText('Defeat. The run has ended.');
  await view.getByRole('button', { name: 'Back', exact: true }).tap();
  expect(errors).toEqual([]);
});

test('a loss with no charges settles immediately and still offers a free report at 640×480', async ({
  page,
}) => {
  const errors = await boot(page);
  await page.setViewportSize({ width: 640, height: 480 });
  await page.evaluate(async () => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    s.gameData = { ...s.gameData, dialogue: {} };
    s.runManager.visionChargesRemaining = 0;
    const commander = s.playerUnits.find((u) => u.isCommander);
    commander.currentHP = 0;
    await s.removeUnit(commander, { killer: s.enemyUnits[0] });
    s.checkBattleEnd();
  });
  await waitForScene(page, 'RunComplete');
  const farewell = page.getByRole('button', { name: 'Skip conversation', exact: true });
  if (await farewell.isVisible()) await farewell.tap();
  await page.getByRole('button', { name: 'Battle report', exact: true }).tap();
  const view = page.getByRole('dialog', { name: 'Battle timeline', exact: true });
  await expect(view.locator('.bt-rewind')).toBeDisabled();
  await expect(view.locator('.bt-summary')).toContainText('Defeat. The run has ended.');
  await expect(view.locator('.bt-rewind')).toBeInViewport();
  await view.getByRole('button', { name: 'Back', exact: true }).tap();
  expect(errors).toEqual([]);
});

test('main-map scrubbing settles exactly, owns a separate camera, and releases its scene on cancel', async ({
  page,
}) => {
  const errors = await boot(page);
  await page.setViewportSize({ width: 640, height: 480 });
  // Exercise the production movement path and completion boundary, then use only
  // viewer controls. This fixture leaves a second ally available to act.
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const u = s.playerUnits[0];
    s.selectUnit(u);
    const target = [...s.movementRange.keys()]
      .map((k) => k.split(',').map(Number))
      .find(
        ([col, row]) =>
          !s.getUnitAt(col, row) && Math.abs(col - u.col) + Math.abs(row - u.row) === 1,
      );
    if (!target) throw Error('No adjacent movement fixture');
    s.moveUnit(u, ...target);
  });
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'UNIT_ACTION_MENU',
  );
  await page
    .getByRole('complementary', { name: 'Battle commands' })
    .getByRole('button', { name: 'Wait', exact: true })
    .tap();
  await page.evaluate(() =>
    window.__emblemRogueGame.scene
      .getScene('Battle')
      .registry.get('settings')
      .setBattleSpeed('normal'),
  );
  const before = await digest(page);
  const camera = await page.evaluate(() => {
    const c = window.__emblemRogueGame.scene.getScene('Battle').cameras.main;
    return [c.scrollX, c.scrollY, c.zoom];
  });
  await page.getByRole('button', { name: 'Rewind', exact: true }).tap();
  const view = page.getByRole('dialog', { name: 'Battle timeline', exact: true });
  await expect(view.locator('.bt-map-viewport')).toBeVisible();
  await page.waitForFunction(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    return s.visionDialog?.surface?.session?.scene?.renderer?.frame;
  });
  expect(
    await page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      const v = s.visionDialog.surface;
      return {
        paused: s.scene.isPaused(),
        distinct: v.session.scene.cameras.main !== s.cameras.main,
        path: v.entries.at(-1).beats.some((b) => b.path?.length > 1),
        busy: v.busy,
      };
    }),
  ).toEqual({ paused: true, distinct: true, path: true, busy: false });
  await view.getByRole('button', { name: 'Previous action', exact: true }).tap();
  await expect(view.locator('.bt-rewind')).toBeDisabled();
  // A newer selection cancels the preceding animation rather than queuing it.
  await view.getByRole('button', { name: 'Next action', exact: true }).tap();
  await view.getByRole('button', { name: 'Previous action', exact: true }).tap();
  await page.waitForFunction(() => {
    const v = window.__emblemRogueGame.scene.getScene('Battle').visionDialog.surface;
    return (
      !v.busy &&
      JSON.stringify(v.session.scene.renderer.frame) ===
        JSON.stringify(v.entries.find((e) => e.id === v.selectedId).preview)
    );
  });
  await page.screenshot({ path: '/tmp/battle-history-map-640.png' });
  await view.getByRole('button', { name: 'Zoom in', exact: true }).tap();
  await view.getByRole('button', { name: 'Map', exact: true }).tap();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Escape');
  await expect(view).toBeVisible();
  await view.getByRole('button', { name: 'Back', exact: true }).tap();
  await expect(view).toHaveCount(0);
  expect(await digest(page)).toEqual(before);
  expect(
    await page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      const c = s.cameras.main;
      return {
        camera: [c.scrollX, c.scrollY, c.zoom],
        active: s.scene.isActive(),
        visible: s.scene.isVisible(),
        historyScenes: Object.keys(s.game.scene.keys).filter((k) => k.startsWith('BattleHistory-'))
          .length,
      };
    }),
  ).toEqual({ camera, active: true, visible: true, historyScenes: 0 });
  expect(errors).toEqual([]);
});

test('recorded combat identifies the observed attacker and victim and reverses a death without gameplay', async ({
  page,
}) => {
  const errors = await boot(page);
  await page.evaluate(async () => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const a = s.playerUnits[0],
      d = s.enemyUnits[0];
    a.col = 1;
    a.row = 5;
    d.col = 2;
    d.row = 5;
    a.stats.STR = 50;
    a.stats.SKL = 50;
    a.stats.HP = 80;
    a.currentHP = 80;
    a.skills = [];
    a.xp = 0;
    a.weapon = { ...a.weapon, hit: 200 };
    d.currentHP = 1;
    d.stats.DEF = 0;
    d.stats.SPD = 0;
    d.skills = [];
    d.affixes = [];
    s.updateUnitPosition(a);
    s.updateUnitPosition(d);
    s._timelineBoundary = 'turn_start';
    s._captureSuspendCheckpoint();
    s.selectedUnit = a;
    await s.executeCombat(a, d);
  });
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'PLAYER_IDLE',
  );
  const before = await digest(page);
  await page.getByRole('button', { name: 'Rewind', exact: true }).tap();
  const view = page.getByRole('dialog', { name: 'Battle timeline', exact: true });
  await page.waitForFunction(() => {
    const v = window.__emblemRogueGame.scene.getScene('Battle').visionDialog?.surface;
    return v?.session?.scene?.renderer?.frame && !v.busy;
  });
  const recorded = await page.evaluate(() => {
    const v = window.__emblemRogueGame.scene.getScene('Battle').visionDialog.surface;
    const row = v.entries.find((e) => e.id === v.selectedId);
    return {
      dead: row.beats.find((b) => b.type === 'defeated')?.targetId,
      attacker: row.actorId,
      hit: row.beats.find((b) => b.outcome?.damage > 0),
      units: v.session.scene.renderer.frame.units.map((u) => u.id),
    };
  });
  expect(recorded.dead).toBeTruthy();
  expect(recorded.hit.actorId).toBe(recorded.attacker);
  expect(recorded.hit.actorPosition).toMatchObject({ col: 1, row: 5 });
  expect(recorded.hit.targetPosition).toMatchObject({ col: 2, row: 5 });
  expect(recorded.units).not.toContain(recorded.dead);
  await expect(view.locator('.bt-details summary')).toContainText('attacked');
  await page.screenshot({ path: '/tmp/battle-history-combat-phone.png' });
  await view.getByRole('button', { name: 'Previous action', exact: true }).tap();
  await page.waitForFunction((dead) => {
    const v = window.__emblemRogueGame.scene.getScene('Battle').visionDialog.surface;
    return !v.busy && v.session.scene.renderer.frame.units.some((u) => u.id === dead && u.hp === 1);
  }, recorded.dead);
  expect(await digest(page)).toEqual(before);
  await view.getByRole('button', { name: 'Back', exact: true }).tap();
  expect(errors).toEqual([]);
});

test('fifty history sessions release textures, shutdown listeners and input ownership', async ({
  page,
}) => {
  const errors = await boot(page);
  const before = await digest(page);
  const counters = () =>
    page.evaluate(async () => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      const { activeInputOwner } = await import('/src/utils/inputFocus.js');
      return {
        textures: Object.keys(s.textures.list),
        shutdown: s.events.listenerCount('shutdown'),
        scenes: Object.keys(s.game.scene.keys).filter((k) => k.startsWith('BattleHistory-')).length,
        active: s.scene.isActive(),
        battleInput: activeInputOwner() === s,
      };
    });
  let baseline;
  for (let i = 0; i < 50; i++) {
    await page.getByRole('button', { name: 'Rewind', exact: true }).tap();
    await page.waitForFunction(() => {
      const v = window.__emblemRogueGame.scene.getScene('Battle').visionDialog?.surface;
      return v?.session?.scene?.renderer?.frame && !v.busy;
    });
    await page
      .getByRole('dialog', { name: 'Battle timeline', exact: true })
      .getByRole('button', { name: 'Back', exact: true })
      .tap();
    if (i === 0) baseline = await counters();
  }
  const { textures, ...finalState } = await counters();
  const { textures: initialTextures, ...initialState } = baseline;
  // Transient host textures may expire, but repeated history must retain none.
  expect(textures.filter((key) => !initialTextures.includes(key))).toEqual([]);
  expect(textures.filter((key) => key.startsWith('BattleHistory-'))).toEqual([]);
  expect(finalState).toEqual(initialState);
  expect(baseline).toMatchObject({ scenes: 0, active: true, battleInput: true });
  expect(await digest(page)).toEqual(before);
  expect(errors).toEqual([]);
});

test('history status labels and animated HP cues never consume battle randomness', async ({
  page,
}) => {
  const errors = await boot(page);
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    s.playerUnits[0]._conditions = [{ id: 'silence', turnsRemaining: 2 }];
    s._captureSuspendCheckpoint();
  });
  const before = await digest(page);
  await page.getByRole('button', { name: 'Rewind', exact: true }).tap();
  await page.waitForFunction(() => {
    const v = window.__emblemRogueGame.scene.getScene('Battle').visionDialog?.surface;
    return v?.session?.scene?.renderer?.frame && !v.busy;
  });
  expect(await digest(page)).toEqual(before);
  await page.evaluate(async () => {
    const v = window.__emblemRogueGame.scene.getScene('Battle').visionDialog.surface;
    const renderer = v.session.scene.renderer;
    const frame = structuredClone(renderer.frame);
    const from = structuredClone(frame);
    from.units[0].hp = Math.max(1, frame.units[0].hp - 1);
    await new Promise((resolve) =>
      renderer.show(
        frame,
        {
          from,
          animate: true,
          beats: [{ actorId: frame.units[0].id, type: 'healed' }],
        },
        resolve,
      ),
    );
  });
  expect(await digest(page)).toEqual(before);
  await page
    .getByRole('dialog', { name: 'Battle timeline', exact: true })
    .getByRole('button', { name: 'Back', exact: true })
    .tap();
  expect(await digest(page)).toEqual(before);
  expect(errors).toEqual([]);
});
