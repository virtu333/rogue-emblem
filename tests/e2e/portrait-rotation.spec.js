// E2E: turning the phone, everywhere, in portrait mode's real default path
// (docs/portrait-battles.md). A phone context (portraitHelpers.phone) with no
// ?portrait=, no forced class: html.portrait-ui comes from the shell alone.
//
// A turn of the phone must never change the game: in battle the board re-opens from
// a save at the player's next clean boundary (or keeps its orientation, with a note,
// when it cannot), and outside battle every screen keeps what the player was doing.
//
//   - mid-battle, both ways and once during the enemy phase: the same battle as a run
//     that never turned (RNG, units, fog, NPCs, temporary terrain, convoy, gold,
//     Vision, deployment), before and after identical actions;
//   - Formation: the switch waits for Start battle and keeps the placement;
//   - with the forecast open: the switch waits, the sheet stays usable, the attack
//     resolves exactly as without the turn;
//   - the title, the route (selected knot and its row), the trade menu (held item and
//     focus), Home Base and the Compendium;
//   - the rotate prompt and the Settings toggle;
//   - ten round trips leak no listeners, observers, cameras or textures;
//   - a failed save during a switch keeps the battle playable and a later turn
//     retries; UI-only actions never advance the gameplay RNG.
import { test, expect } from '@playwright/test';
import { waitForGame, attachSceneCrashArtifacts } from './helpers.js';
import {
  PORTRAIT_PHONES,
  activeScene,
  attachSlot,
  battleDomainState,
  battleIdle,
  battleRail,
  battleSnapshot,
  endPlayerTurn,
  expectNoSidewaysScroll,
  expectPortraitUi,
  expectTappable,
  moveAndWait,
  openDevBattle,
  openSavedRun,
  pageErrors,
  phone,
  quietSettings,
  restoreProfile,
  saveProfile,
  settleBattle,
  tapTile,
  turnPhone,
} from './portraitHelpers.js';

const UPRIGHT = PORTRAIT_PHONES[1];
const SIDEWAYS = { width: 844, height: 390 };
const RAIL_MIN = 38; // compact battle-rail commands (owner-accepted, mobile-battle-hud.spec)

test.use(phone(UPRIGHT));

test.afterEach(async ({ page }, testInfo) => {
  await attachSceneCrashArtifacts(page, testInfo);
});

const scene = (page, fn, arg) => page.evaluate(fn, arg);

/**
 * Stage the fight the comparisons need, then save it: an enemy beside Edric so every
 * enemy phase attacks for real, and a patch of temporary Ice (it thaws turn by turn).
 * Hints off: first-use tips are per-save UI state, not part of the battle.
 */
async function stageAndSave(page) {
  await scene(page, () => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const edric = s.playerUnits.find((u) => u.name === 'Edric');
    const enemy = s.enemyUnits[0];
    const free = (c, r) =>
      c >= 0 &&
      r >= 0 &&
      c < s.grid.cols &&
      r < s.grid.rows &&
      !s.getUnitAt(c, r) &&
      !(s.npcUnits || []).some((n) => n.col === c && n.row === r);
    const tile = [
      [edric.col + 1, edric.row],
      [edric.col, edric.row - 1],
      [edric.col - 1, edric.row],
      [edric.col, edric.row + 1],
    ].find(([c, r]) => free(c, r));
    [enemy.col, enemy.row] = tile;
    s.grid.setTerrainAt(enemy.col, enemy.row, 0);
    s.updateUnitPosition(enemy);
    const ice = [
      [edric.col - 1, edric.row - 1],
      [edric.col + 1, edric.row + 1],
      [edric.col - 1, edric.row + 1],
    ].find(([c, r]) => free(c, r));
    s.grid.setTemporaryTerrain(ice[0], ice[1], 'Ice', 3, edric);
    s.registry.get('settings').setHints(false);
    if (!s._captureSuspendCheckpoint()) throw new Error('setup save failed');
  });
  return saveProfile(page);
}

test('turning the phone both ways, once in the enemy phase, plays out like never turning', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const errors = pageErrors(page);
  await quietSettings(page);
  // A recruit battle: an NPC stands on the field beside the army and the enemies.
  await openDevBattle(page, { query: '&devNode=recruit' });
  const saved = await stageAndSave(page);
  const npcs = await scene(page, () =>
    window.__emblemRogueGame.scene.getScene('Battle').npcUnits.map((u) => u.name),
  );
  expect(npcs.length, 'an NPC on the field').toBeGreaterThan(0);

  const play = async (turned) => {
    await restoreProfile(page, saved);
    await page.setViewportSize(UPRIGHT);
    await openSavedRun(page);
    expect((await battleSnapshot(page)).rotation).toBe('ccw');
    const states = [];
    const record = async (label) => states.push({ label, ...(await battleDomainState(page)) });
    await record('resumed upright');
    if (turned) await turnPhone(page, SIDEWAYS, 'none');
    await record('turned sideways at an idle moment');
    await moveAndWait(page, 'Edric');
    await record('after a move');
    let during = null;
    await endPlayerTurn(page, {
      duringEnemyPhase: turned
        ? async () => {
            await page.evaluate(() => {
              window.addEventListener(
                'resize',
                () => {
                  const b = window.__emblemRogueGame.scene.getScene('Battle');
                  window.__turnedDuring = {
                    phase: b.turnManager.currentPhase,
                    rotation: b.grid.board.rotation,
                  };
                },
                { once: true },
              );
            });
            await page.setViewportSize(UPRIGHT);
            // The switch waits for the player's turn; the note says so meanwhile.
            during = await (await page.waitForFunction(() => window.__turnedDuring)).jsonValue();
            await expect(page.locator('.portrait-battle-notice')).toHaveText(
              'The board turns upright when your turn begins.',
            );
          }
        : null,
    });
    if (turned) {
      expect(during, 'the phone turned mid enemy phase').toEqual({
        phase: 'enemy',
        rotation: 'none',
      });
      await expect.poll(async () => (await battleSnapshot(page)).rotation).toBe('ccw');
      await battleIdle(page);
    }
    await record('after the enemy phase');
    await moveAndWait(page, 'Sera');
    await moveAndWait(page, 'Edric');
    await record('after two more moves');
    await endPlayerTurn(page);
    await record('after a second enemy phase');
    return states;
  };
  const control = await play(false);
  const turned = await play(true);

  // Not vacuous: the enemy phases fought and the Ice thawed turn by turn.
  const hp = (s) =>
    [...s.domain.state.playerUnits, ...s.domain.state.enemyUnits].map((u) => u.currentHP);
  expect(hp(control.at(-1))).not.toEqual(hp(control[0]));
  expect(control.at(-1).domain.state.temporaryTerrains).not.toEqual(
    control[0].domain.state.temporaryTerrains,
  );
  expect(control[0].domain.state.npcUnits.length).toBeGreaterThan(0);
  for (let i = 0; i < control.length; i++)
    expect(turned[i].domain, turned[i].label).toEqual(control[i].domain);
  // The only bookkeeping difference: each switch is one more save.
  const extra = turned.map(
    (s, i) => s.bookkeeping.checkpointIndex - control[i].bookkeeping.checkpointIndex,
  );
  expect(extra).toEqual([0, 1, 1, 2, 2, 2]);
  expect(errors).toEqual([]);
});

test('turned during Formation, the board waits for Start battle and keeps the placement', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors = pageErrors(page);
  await quietSettings(page);
  await page.goto('/?devScene=battle&preset=combat_actions&seed=42&formation=1');
  await waitForGame(page);
  await activeScene(page, 'Battle');
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Battle')._formation?.ready === true,
    null,
    { timeout: 30_000 },
  );
  await attachSlot(page);
  expect(await battleSnapshot(page)).toMatchObject({
    rotation: 'ccw',
    state: 'DEPLOY_POSITIONING',
  });
  const rail = battleRail(page);
  await rail.getByRole('button', { name: 'Auto-place', exact: true }).tap();
  const chosen = await scene(page, () => {
    const f = window.__emblemRogueGame.scene.getScene('Battle')._formation;
    return f.units.map((u, i) => [u.name, f.tiles[f.formation.at[i]]]);
  });

  // Sideways mid-Formation: nothing re-opens yet; the note says when it will.
  await page.setViewportSize(SIDEWAYS);
  await expect(page.locator('.portrait-battle-notice')).toHaveText(
    'The board turns back when the battle begins.',
  );
  expect(await battleSnapshot(page)).toMatchObject({
    rotation: 'ccw',
    state: 'DEPLOY_POSITIONING',
  });
  await expectNoSidewaysScroll(page);
  const start = rail.getByRole('button', { name: 'Start battle', exact: true });
  await expectTappable(start, { min: RAIL_MIN });
  await start.tap();

  // Turn 1: the board turns back, every unit on the tile chosen for it.
  await expect.poll(async () => (await battleSnapshot(page)).rotation).toBe('none');
  await battleIdle(page);
  const after = await scene(page, () => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    return {
      turn: s.turnManager.turnNumber,
      units: s.playerUnits.map((u) => [u.name, { col: u.col, row: u.row }]),
    };
  });
  expect(after).toEqual({ turn: 1, units: chosen });
  expect(errors).toEqual([]);
});

/** Open the forecast through real taps: Edric, stay, Attack, the enemy beside him. */
async function openForecast(page) {
  const at = await scene(page, () => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const u = s.playerUnits.find((x) => x.name === 'Edric');
    return [u.col, u.row];
  });
  await tapTile(page, ...at);
  await expect
    .poll(() =>
      scene(page, () => window.__emblemRogueGame.scene.getScene('Battle').selectedUnit?.name),
    )
    .toBe('Edric');
  await tapTile(page, ...at);
  const rail = battleRail(page);
  await rail.getByRole('button', { name: 'Attack', exact: true }).tap();
  await rail.getByRole('group', { name: 'Attack targets' }).getByRole('button').first().tap();
  const forecast = page.getByRole('dialog', { name: 'Combat forecast' });
  await expect(forecast).toBeVisible();
  return forecast;
}

/** The forecast sheet is whole on screen, with Confirm and Cancel uncovered. */
async function expectForecastUsable(page, forecast) {
  await expectNoSidewaysScroll(page);
  await expect(forecast).toBeInViewport({ ratio: 1 });
  for (const name of [/^Confirm attack/, /^Cancel$/]) {
    const button = forecast.getByRole('button', { name });
    await expect(button).toBeInViewport({ ratio: 1 });
    const onTop = await button.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return el === hit || el.contains(hit);
    });
    expect(onTop, `${name} uncovered`).toBe(true);
  }
}

test('turned with the forecast open, the switch waits and the attack resolves as without the turn', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const errors = pageErrors(page);
  await quietSettings(page);
  await openDevBattle(page);
  const saved = await stageAndSave(page);

  const play = async (turned) => {
    await restoreProfile(page, saved);
    await page.setViewportSize(UPRIGHT);
    await openSavedRun(page);
    const forecast = await openForecast(page);
    await expectForecastUsable(page, forecast);
    if (turned) {
      await page.setViewportSize(SIDEWAYS);
      await expect(page.locator('.portrait-battle-notice')).toHaveText(
        'The board turns back when this action is done.',
      );
      // A modal holds the board: still turned, still the same forecast.
      expect(await battleSnapshot(page)).toMatchObject({
        rotation: 'ccw',
        state: 'SHOWING_FORECAST',
      });
      await expectForecastUsable(page, forecast);
      // Upright and sideways again while it is open: it reflows, nothing re-opens.
      await page.setViewportSize(UPRIGHT);
      await expectForecastUsable(page, forecast);
      await page.setViewportSize(SIDEWAYS);
      await expectForecastUsable(page, forecast);
    }
    await forecast.getByRole('button', { name: /^Confirm attack/ }).tap();
    await settleBattle(page, () => {
      const b = window.__emblemRogueGame.scene.getScene('Battle');
      const edric = b.playerUnits.find((u) => u.name === 'Edric');
      return b.battleState === 'PLAYER_IDLE' && edric?.hasActed === true;
    });
    if (turned) await expect.poll(async () => (await battleSnapshot(page)).rotation).toBe('none');
    await battleIdle(page);
    return battleDomainState(page);
  };
  const control = await play(false);
  const turned = await play(true);
  expect(turned.domain).toEqual(control.domain);
  expect(turned.bookkeeping.checkpointIndex).toBe(control.bookkeeping.checkpointIndex + 1);
  expect(errors).toEqual([]);
});

/** Portrait mode follows the phone: on upright (no prompt), off sideways. */
async function expectFollows(page, upright) {
  await expectPortraitUi(page, upright);
  await expect(page.locator('#rotate-prompt')).toBeHidden();
  await expectNoSidewaysScroll(page);
}

test('the title follows the phone both ways, its menu tappable each way', async ({ page }) => {
  const errors = pageErrors(page);
  await quietSettings(page);
  await page.goto('/');
  await waitForGame(page);
  await activeScene(page, 'Title');
  const newGame = page.getByRole('button', { name: 'New Game', exact: true });
  for (const [size, upright] of [
    [UPRIGHT, true],
    [SIDEWAYS, false],
    [UPRIGHT, true],
  ]) {
    await page.setViewportSize(size);
    await expectFollows(page, upright);
    await expectTappable(newGame);
    await expectTappable(page.getByRole('button', { name: 'Settings', exact: true }));
  }
  // Nothing was stored: the phone's default is what turned it on.
  expect(await page.evaluate(() => localStorage.getItem('emblem_rogue_portrait_battles'))).toBe(
    null,
  );
  expect(errors).toEqual([]);
});

test('mid-route, the loom keeps the selected knot and its row through a turn and back', async ({
  page,
}) => {
  const errors = pageErrors(page);
  await quietSettings(page);
  await page.goto('/?devScene=nodemap&preset=battle_smoke&seed=42');
  await waitForGame(page);
  await activeScene(page, 'NodeMap');
  await page.getByRole('button', { name: 'Skip conversation', exact: true }).tap();
  const route = page.locator('.re-node-map');
  await expect(route).toBeVisible();
  await expectPortraitUi(page);
  // A far knot, near the top of the act: browse up to it and select it.
  const pick = await scene(page, () => {
    const rm = window.__emblemRogueGame.scene.getScene('NodeMap').runManager;
    const top = Math.max(...rm.nodeMap.nodes.map((n) => n.row));
    const node = rm.nodeMap.nodes.filter((n) => n.row === top - 1).sort((a, b) => a.col - b.col)[0];
    return { id: node.id, row: node.row };
  });
  const knot = route.locator(`.re-node[data-node="${pick.id}"]`);
  await knot.scrollIntoViewIfNeeded();
  await knot.tap();
  await expect(knot).toHaveAttribute('aria-pressed', 'true');
  const card = route.locator('.re-loom-card');
  const cardText = await card.textContent();
  const rowKnots = await scene(
    page,
    (row) =>
      window.__emblemRogueGame.scene
        .getScene('NodeMap')
        .runManager.nodeMap.nodes.filter((n) => n.row === row)
        .map((n) => n.id),
    pick.row,
  );

  for (const [size, upright] of [
    [SIDEWAYS, false],
    [UPRIGHT, true],
  ]) {
    await page.setViewportSize(size);
    await expectFollows(page, upright);
    // The selection, its card and its row are what the loom shows.
    await expect(knot).toHaveAttribute('aria-pressed', 'true');
    await expect(knot).toBeInViewport({ ratio: 1 });
    await expect(card).toHaveText(cardText);
    for (const id of rowKnots)
      await expect(route.locator(`.re-node[data-node="${id}"]`)).toBeInViewport();
    expect(await route.locator('.re-node[aria-pressed="true"]').count()).toBe(1);
  }
  // Still a working route: a live knot selects and Travel is tappable.
  await route.locator('.re-node.is-live').first().tap();
  await expectTappable(route.getByRole('button', { name: 'Travel', exact: true }));
  expect(errors).toEqual([]);
});

test('Home Base keeps its tab and Begin Run through a turn and back', async ({ page }) => {
  const errors = pageErrors(page);
  await quietSettings(page);
  await page.goto('/?devScene=homebase');
  await waitForGame(page);
  await activeScene(page, 'HomeBase');
  const home = page.getByRole('dialog', { name: 'Home base', exact: true });
  const skills = home.getByRole('button', { name: 'Starting skills', exact: true });
  await skills.tap();
  await expect(skills).toHaveAttribute('aria-pressed', 'true');
  for (const [size, upright] of [
    [SIDEWAYS, false],
    [UPRIGHT, true],
  ]) {
    await page.setViewportSize(size);
    await expectFollows(page, upright);
    await expect(skills).toHaveAttribute('aria-pressed', 'true');
    await expectTappable(home.getByRole('button', { name: 'Begin Run', exact: true }));
  }
  expect(errors).toEqual([]);
});

test('the Compendium keeps its tab, filter and entry through a turn and back', async ({ page }) => {
  const errors = pageErrors(page);
  await quietSettings(page);
  await page.goto('/');
  await waitForGame(page);
  await activeScene(page, 'Title');
  await page.getByRole('button', { name: 'Compendium', exact: true }).tap();
  const book = page.getByRole('dialog', { name: 'Compendium', exact: true });
  await expect(book).toBeVisible();
  await book.getByRole('button', { name: 'Skills', exact: true }).tap();
  await book.getByRole('button', { name: 'Attack', exact: true }).tap();
  const entry = book.locator('.re-row').filter({ hasText: /^Luna/ });
  await entry.scrollIntoViewIfNeeded();
  await entry.tap();
  // What the reader has chosen, whichever of list and detail the layout shows: the
  // pressed tab, filter and entry where they are drawn, else the open entry's title.
  const chosen = () =>
    book.evaluate((root) => {
      const pressed = (sel) =>
        root.querySelector(`${sel} [aria-pressed="true"]`)?.textContent.trim() ?? null;
      return {
        tab: pressed('nav.re-tabs:not(.re-filter-tabs)'),
        filter: pressed('nav.re-filter-tabs'),
        entry:
          root.querySelector('.re-row[aria-pressed="true"] strong')?.textContent ??
          root.querySelector('.re-reference-detail h3')?.textContent ??
          null,
        detail: root.querySelector('.re-reference-detail h3')?.textContent ?? null,
        focusInside: root.contains(document.activeElement),
      };
    });
  const upright = await chosen();
  expect(upright).toMatchObject({ entry: 'Luna', detail: 'Luna', focusInside: true });
  for (const [size, isUpright] of [
    [SIDEWAYS, false],
    [UPRIGHT, true],
  ]) {
    await page.setViewportSize(size);
    await expectFollows(page, isUpright);
    const now = await chosen();
    expect(now.entry, 'the chosen entry').toBe('Luna');
    expect(now.focusInside, 'focus stays in the Compendium').toBe(true);
    // Where the tabs are drawn, they are the ones chosen (sideways they always are).
    if (now.tab !== null || !isUpright) expect(now.tab).toBe('Skills');
    if (now.filter !== null || !isUpright) expect(now.filter).toBe('Attack');
    await expectTappable(book.getByRole('button', { name: 'Close', exact: true }));
  }
  expect(errors).toEqual([]);
});

test('the trade menu keeps the held item and the focus through a turn and back', async ({
  page,
}) => {
  const errors = pageErrors(page);
  await quietSettings(page);
  await page.goto('/?devScene=nodemap&preset=battle_smoke&seed=42');
  await waitForGame(page);
  await activeScene(page, 'NodeMap');
  await attachSlot(page);
  await page.getByRole('button', { name: 'Skip conversation', exact: true }).tap();
  await page.locator('.re-node-map').getByRole('button', { name: 'Roster', exact: true }).tap();
  const sheet = page.getByRole('dialog', { name: 'Manage roster', exact: true });
  await sheet.getByRole('button', { name: 'Equipment', exact: true }).tap();
  const trade = sheet.getByRole('button', { name: 'Trade…', exact: true }).first();
  await trade.scrollIntoViewIfNeeded();
  await trade.tap();
  const picker = page.getByRole('dialog', { name: 'Trade Iron Sword with…', exact: true });
  await picker.getByRole('button', { name: /^Sera/ }).tap();
  await picker.getByRole('button', { name: 'Trade', exact: true }).tap();
  const menu = page.getByRole('dialog', { name: 'Trade items', exact: true });
  await expect(menu).toBeVisible();
  const status = menu.getByRole('status');
  await expect(status).toContainText('Holding Iron Sword.');
  // Move the focus off its opening place (keyboard/controller), then turn the phone.
  await page.keyboard.press('ArrowDown');
  const target = menu.getByRole('button', { name: 'Trade Iron Sword for Heal', exact: true });
  await expect(target).toBeFocused();
  const heldText = await status.innerText();
  for (const [size, upright] of [
    [SIDEWAYS, false],
    [UPRIGHT, true],
  ]) {
    await page.setViewportSize(size);
    await expectFollows(page, upright);
    await expect(menu).toBeVisible();
    await expect(status).toHaveText(heldText);
    await expect(target).toBeFocused();
    await expectTappable(menu.getByRole('button', { name: 'Done', exact: true }));
    await expect(menu).toBeInViewport();
  }
  // The held item still goes where the focus says: Enter commits the swap, saved.
  await page.keyboard.press('Enter');
  await expect(status).toContainText('Traded Iron Sword for Heal.');
  const saved = await page.evaluate(async () => {
    const { loadRun } = await import('/src/engine/RunManager.js');
    const run = loadRun(window.__emblemRogueGame.scene.getScene('NodeMap').gameData, 1);
    const bag = (name) => run.roster.find((u) => u.name === name).inventory.map((i) => i.name);
    return { edric: bag('Edric'), sera: bag('Sera') };
  });
  expect(saved.edric).toContain('Heal');
  expect(saved.sera).toContain('Iron Sword');
  expect(errors).toEqual([]);
});

// The rotate prompt asks for landscape exactly where portrait mode is off on an
// upright touch screen; its "Play upright" is the way back when Settings sits behind it.
test.describe('the rotate prompt and the Settings toggle', () => {
  test('?portrait=0 stores off, and it outlives the link; Play upright turns it back on', async ({
    page,
  }) => {
    const errors = pageErrors(page);
    await quietSettings(page);
    await page.goto('/?portrait=0');
    await waitForGame(page);
    await activeScene(page, 'Title');
    const prompt = page.locator('#rotate-prompt');
    await expectPortraitUi(page, false);
    await expect(prompt).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('emblem_rogue_portrait_battles'))).toBe(
      'off',
    );
    // No link this time: still off.
    await page.goto('/');
    await waitForGame(page);
    await activeScene(page, 'Title');
    await expectPortraitUi(page, false);
    await expect(prompt).toBeVisible();
    const upright = prompt.getByRole('button', { name: 'Play upright', exact: true });
    await expectTappable(upright);
    await upright.tap();
    await expectPortraitUi(page);
    expect(await page.evaluate(() => localStorage.getItem('emblem_rogue_portrait_battles'))).toBe(
      'on',
    );
    // ?portrait=1 stores on as well (the choice, not the default).
    await page.goto('/?portrait=1');
    await waitForGame(page);
    expect(await page.evaluate(() => localStorage.getItem('emblem_rogue_portrait_battles'))).toBe(
      'on',
    );
    expect(errors).toEqual([]);
  });

  test('the Settings toggle stores off and on and never deletes the choice', async ({ page }) => {
    const errors = pageErrors(page);
    await instrumentLeaks(page);
    await quietSettings(page);
    await page.goto('/');
    await waitForGame(page);
    await activeScene(page, 'Title');
    const stored = () => page.evaluate(() => localStorage.getItem('emblem_rogue_portrait_battles'));
    expect(await stored()).toBe(null);
    const listening = () =>
      page.evaluate(
        () => window.__leakProbe().listeners['window emblem-rogue:portrait-battles'] || 0,
      );
    const closed = await listening();
    await page.getByRole('button', { name: 'Settings', exact: true }).tap();
    const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
    const toggle = settings.getByRole('button', { name: /^Portrait mode/ });
    await expect(toggle).toHaveText('Portrait mode · On');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await toggle.tap();
    expect(await stored()).toBe('off');
    // Off upright: the prompt covers the screen at once and offers the way back.
    const prompt = page.locator('#rotate-prompt');
    await expect(prompt).toBeVisible();
    await expectPortraitUi(page, false);
    await prompt.getByRole('button', { name: 'Play upright', exact: true }).tap();
    expect(await stored()).toBe('on');
    await expectPortraitUi(page);
    await expect(toggle).toHaveText('Portrait mode · On');
    await toggle.tap();
    await expect(prompt).toBeVisible();
    // Sideways the game plays as before; the toggle still reads off, and on again.
    await page.setViewportSize(SIDEWAYS);
    await expect(prompt).toBeHidden();
    await expect(toggle).toHaveText('Portrait mode · Off');
    await toggle.tap();
    expect(await stored()).toBe('on');
    await page.setViewportSize(UPRIGHT);
    await expectPortraitUi(page);
    // Closed, the menu stops listening for the preference.
    await settings.getByRole('button', { name: 'Close', exact: true }).tap();
    await expect(settings).toHaveCount(0);
    expect(await listening()).toBe(closed);
    expect(errors).toEqual([]);
  });
});

test.describe('a tablet browser tab', () => {
  test.use(phone({ width: 820, height: 1180 }));

  test('is sideways by default (the prompt shows) and can opt in from it', async ({ page }) => {
    const errors = pageErrors(page);
    await quietSettings(page);
    await page.goto('/');
    await waitForGame(page);
    await activeScene(page, 'Title');
    const prompt = page.locator('#rotate-prompt');
    await expectPortraitUi(page, false);
    await expect(prompt).toBeVisible();
    await prompt.getByRole('button', { name: 'Play upright', exact: true }).tap();
    await expectPortraitUi(page);
    expect(await page.evaluate(() => localStorage.getItem('emblem_rogue_portrait_battles'))).toBe(
      'on',
    );
    expect(errors).toEqual([]);
  });
});

/**
 * Count what a turn of the phone could leak: listeners on window, visualViewport and
 * document (by type), ResizeObserver observations of elements still in the page,
 * Phaser cameras and textures, game and scale-manager listeners, battle scenes, and
 * the battle's singleton DOM (rail, note, canvas).
 */
async function instrumentLeaks(page) {
  await page.addInitScript(() => {
    const live = new Map();
    const ids = new WeakMap();
    let next = 1;
    const id = (fn) => (ids.has(fn) ? ids.get(fn) : (ids.set(fn, next++), next - 1));
    const nameOf = (t) =>
      t === window
        ? 'window'
        : t === window.visualViewport
          ? 'visualViewport'
          : t === document
            ? 'document'
            : null;
    const key = (fn, options) =>
      `${id(fn)}:${typeof options === 'boolean' ? options : Boolean(options?.capture)}`;
    const add = EventTarget.prototype.addEventListener;
    const remove = EventTarget.prototype.removeEventListener;
    EventTarget.prototype.addEventListener = function (type, fn, options) {
      const name = nameOf(this);
      // once / signal listeners remove themselves; only plain ones can pile up.
      if (
        name &&
        fn &&
        !(options && typeof options === 'object' && (options.once || options.signal))
      ) {
        const byType = live.get(name) || live.set(name, new Map()).get(name);
        const set = byType.get(type) || byType.set(type, new Set()).get(type);
        set.add(key(fn, options));
      }
      return add.call(this, type, fn, options);
    };
    EventTarget.prototype.removeEventListener = function (type, fn, options) {
      const name = nameOf(this);
      if (name && fn) live.get(name)?.get(type)?.delete(key(fn, options));
      return remove.call(this, type, fn, options);
    };
    const Base = window.ResizeObserver;
    const observers = new Set();
    window.ResizeObserver = class extends Base {
      constructor(callback) {
        super(callback);
        this.targets = new Set();
        observers.add(this);
      }
      observe(target, options) {
        this.targets.add(target);
        return super.observe(target, options);
      }
      unobserve(target) {
        this.targets.delete(target);
        return super.unobserve(target);
      }
      disconnect() {
        this.targets.clear();
        return super.disconnect();
      }
    };
    window.__leakProbe = () => {
      const listeners = {};
      for (const [name, byType] of live)
        for (const [type, set] of byType) if (set.size) listeners[`${name} ${type}`] = set.size;
      let observing = 0;
      for (const o of observers) for (const t of o.targets) if (t.isConnected) observing++;
      const game = window.__emblemRogueGame;
      const count = (emitter) =>
        emitter.eventNames().reduce((n, e) => n + emitter.listenerCount(e), 0);
      return {
        listeners,
        observing,
        cameras: game.scene.scenes.reduce((n, s) => n + (s.cameras?.cameras?.length || 0), 0),
        scenes: game.scene.scenes.length,
        textures: game.textures.getTextureKeys().length,
        gameListeners: count(game.events),
        scaleListeners: count(game.scale),
        rails: document.querySelectorAll('.mobile-battle-hud').length,
        notes: document.querySelectorAll('.portrait-battle-notice').length,
        canvases: document.querySelectorAll('canvas').length,
        coaches: document.querySelectorAll('.re-coach').length,
      };
    };
  });
}

/**
 * The switch note sits over the map: inside its area, clear of the rail, and short
 * enough to read at a glance (at most three lines).
 */
async function expectNoteOverMap(page) {
  const fit = await page.evaluate(() => {
    const note = document.querySelector('.portrait-battle-notice').getBoundingClientRect();
    const map = document.getElementById('game-container').getBoundingClientRect();
    const rail = document.querySelector('.mobile-battle-hud').getBoundingClientRect();
    const line = parseFloat(
      getComputedStyle(document.querySelector('.portrait-battle-notice')).lineHeight,
    );
    return {
      insideMap: note.left >= map.left - 0.5 && note.right <= map.right + 0.5,
      clearOfRail:
        note.right <= rail.left + 0.5 ||
        note.left >= rail.right - 0.5 ||
        note.bottom <= rail.top + 0.5 ||
        note.top >= rail.bottom - 0.5,
      lines: Math.round((note.height - 18) / line),
    };
  });
  expect(fit).toMatchObject({ insideMap: true, clearOfRail: true });
  expect(fit.lines, 'note lines').toBeLessThanOrEqual(3);
}

/**
 * What grew between two probes. A leak piles up with every round trip; a count that
 * holds or falls (a transient note or cache released) is not one.
 */
function growth(before, after) {
  const grown = {};
  for (const [key, value] of Object.entries(after.listeners))
    if (value > (before.listeners[key] || 0))
      grown[`listeners ${key}`] = [before.listeners[key] || 0, value];
  for (const [key, value] of Object.entries(after))
    if (typeof value === 'number' && value > before[key]) grown[key] = [before[key], value];
  return grown;
}

test('ten round trips in battle leak no listeners, observers, cameras or textures', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const errors = pageErrors(page);
  await instrumentLeaks(page);
  await quietSettings(page);
  await openDevBattle(page);
  await moveAndWait(page, 'Edric');
  // The painted terrain texture is built off the main thread after each re-open:
  // count once it is there, so a paint still under way is not read as a change.
  const painted = () =>
    page.waitForFunction(() => {
      const art = window.__emblemRogueGame.scene.getScene('Battle')._battlefieldTerrain;
      return !art || art.painted === true;
    });
  const roundTrip = async () => {
    await turnPhone(page, SIDEWAYS, 'none');
    await painted();
    await turnPhone(page, UPRIGHT, 'ccw');
    await painted();
  };
  // Two round trips first: lazily built art and caches for both orientations exist.
  await roundTrip();
  await roundTrip();
  const probe = () => page.evaluate(() => window.__leakProbe());
  const before = await probe();
  const state = await battleDomainState(page);
  for (let i = 0; i < 10; i++) await roundTrip();
  const after = await probe();
  expect(growth(before, after)).toEqual({});
  expect(after).toMatchObject({ rails: 1, notes: 0 });
  expect(after.canvases).toBe(before.canvases);
  // Twenty re-opens later, still the same battle.
  expect((await battleDomainState(page)).domain).toEqual(state.domain);
  expect(errors).toEqual([]);
});

test('ten round trips on the route leak no listeners or observers', async ({ page }) => {
  const errors = pageErrors(page);
  await instrumentLeaks(page);
  await quietSettings(page);
  await page.goto('/?devScene=nodemap&preset=battle_smoke&seed=42');
  await waitForGame(page);
  await activeScene(page, 'NodeMap');
  await page.getByRole('button', { name: 'Skip conversation', exact: true }).tap();
  await expect(page.locator('.re-node-map')).toBeVisible();
  const probe = () => page.evaluate(() => window.__leakProbe());
  const roundTrip = async () => {
    await page.setViewportSize(SIDEWAYS);
    await expectPortraitUi(page, false);
    await page.setViewportSize(UPRIGHT);
    await expectPortraitUi(page);
    await expect(page.locator('.re-node-map .re-node').first()).toBeVisible();
  };
  await roundTrip();
  await roundTrip();
  const before = await probe();
  for (let i = 0; i < 10; i++) await roundTrip();
  expect(growth(before, await probe())).toEqual({});
  expect(errors).toEqual([]);
});

test('a switch whose save fails keeps the battle playable, and turning again retries', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors = pageErrors(page);
  await quietSettings(page);
  await openDevBattle(page);
  await moveAndWait(page, 'Edric');
  const before = await battleDomainState(page);
  await scene(page, () => {
    window.__battleMark = window.__emblemRogueGame.scene.getScene('Battle').grid;
    // Storage refuses the run save from here (full, private mode).
    const setItem = Storage.prototype.setItem;
    window.__failRunWrites = true;
    Storage.prototype.setItem = function (key, value) {
      if (window.__failRunWrites && /^emblem_rogue_slot_\d+_run/.test(key))
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      return setItem.call(this, key, value);
    };
  });
  const sameScene = () =>
    scene(
      page,
      () => window.__battleMark === window.__emblemRogueGame.scene.getScene('Battle').grid,
    );

  await page.setViewportSize(SIDEWAYS);
  const note = page.locator('.portrait-battle-notice');
  await expect(note).toHaveText(
    'The battle could not be saved, so the board stays as it is. Turn the phone again to retry.',
  );
  await expectNoteOverMap(page);
  // Nothing re-opened, nothing changed, and the player can act on the turned board.
  expect(await sameScene()).toBe(true);
  expect(await battleSnapshot(page)).toMatchObject({ rotation: 'ccw', state: 'PLAYER_IDLE' });
  expect((await battleDomainState(page)).domain).toEqual(before.domain);
  expect(
    await scene(page, () => window.__emblemRogueGame.scene.getScene('Battle').input.enabled),
  ).toBe(true);
  await moveAndWait(page, 'Sera');
  // Both units acted: the enemy phase plays on the turned board (its saves fail too).
  await settleBattle(page, () => {
    const b = window.__emblemRogueGame.scene.getScene('Battle');
    return (
      b.turnManager.turnNumber === 2 &&
      b.turnManager.currentPhase === 'player' &&
      b.battleState === 'PLAYER_IDLE'
    );
  });
  expect(await sameScene()).toBe(true);
  expect((await battleSnapshot(page)).rotation).toBe('ccw');
  const played = await battleDomainState(page);

  // Storage recovers. Turning the phone again (upright, then sideways) retries.
  await scene(page, () => {
    window.__failRunWrites = false;
  });
  await page.setViewportSize(UPRIGHT);
  await expectPortraitUi(page);
  expect(await sameScene()).toBe(true);
  await turnPhone(page, SIDEWAYS, 'none');
  expect((await battleDomainState(page)).domain).toEqual(played.domain);
  // It re-opened from a durable save: the slot holds the battle as it stood.
  const savedUnits = await page.evaluate(() => {
    const run = JSON.parse(localStorage.getItem('emblem_rogue_slot_1_run'));
    return run.battleInProgress.checkpoint.playerUnits.map((u) => [
      u.name,
      u.col,
      u.row,
      u.hasActed,
    ]);
  });
  expect(savedUnits).toEqual(
    played.domain.state.playerUnits.map((u) => [u.name, u.col, u.row, u.hasActed]),
  );
  // The other way too: writes fail again, the phone turns upright, the board stays.
  await scene(page, () => {
    window.__failRunWrites = true;
  });
  await page.setViewportSize(UPRIGHT);
  await expect(note).toHaveText(
    'The battle could not be saved, so the board stays as it is. Turn the phone again to retry.',
  );
  await expectNoteOverMap(page);
  expect(await battleSnapshot(page)).toMatchObject({ rotation: 'none', state: 'PLAYER_IDLE' });
  expect((await battleDomainState(page)).domain).toEqual(played.domain);
  expect(errors).toEqual([]);
});

test('UI-only actions never advance the gameplay RNG', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = pageErrors(page);
  await quietSettings(page);
  await openDevBattle(page);
  await moveAndWait(page, 'Edric');
  const rail = battleRail(page);
  const rng = () =>
    scene(page, () => window.__emblemRogueGame.scene.getScene('Battle')._battleRng.getState());
  const canvasSize = () =>
    scene(page, () => {
      const r = window.__emblemRogueGame.canvas.getBoundingClientRect();
      return [Math.round(r.width), Math.round(r.height)];
    });
  const start = await battleDomainState(page);
  const actions = {
    'resize without turning (the toolbar shows and hides)': async () => {
      const size = await canvasSize();
      await page.setViewportSize({ width: UPRIGHT.width, height: UPRIGHT.height - 120 });
      await expect.poll(canvasSize).not.toEqual(size);
      await page.setViewportSize(UPRIGHT);
      await expect.poll(canvasSize).toEqual(size);
    },
    'Battle details open and closed': async () => {
      const summary = page.locator('.mb-battle-info > summary');
      await summary.tap();
      await expect(page.locator('.mb-more-content')).toBeVisible();
      await summary.tap();
      await expect(page.locator('.mb-more-content')).toBeHidden();
    },
    'Danger on and off': async () => {
      const danger = rail.getByRole('button', { name: 'Danger', exact: true });
      await danger.tap();
      await expect(danger).toHaveAttribute('aria-pressed', 'true');
      await danger.tap();
      await expect(danger).toHaveAttribute('aria-pressed', 'false');
    },
    Overview: async () => {
      await rail.getByRole('button', { name: 'Overview', exact: true }).tap();
    },
    'the Rewind history, previewed and closed': async () => {
      await rail.getByRole('button', { name: 'Rewind', exact: true }).tap();
      const dialog = page.getByRole('dialog', { name: 'Rewind', exact: true });
      await expect(dialog).toBeVisible();
      await expect
        .poll(() =>
          scene(page, () => {
            const history = window.__emblemRogueGame.scene.scenes.find((s) =>
              s.sys.settings.key.startsWith('BattleHistory-'),
            );
            return history?.renderer?.units?.size || 0;
          }),
        )
        .toBeGreaterThan(0);
      await dialog.getByRole('button', { name: 'Back', exact: true }).tap();
      await expect(dialog).toHaveCount(0);
    },
    'the roster, opened and closed': async () => {
      await rail.getByRole('button', { name: 'Roster', exact: true }).tap();
      const roster = page.getByRole('dialog', { name: 'Inspect roster', exact: true });
      await roster.getByRole('button', { name: 'Equipment', exact: true }).tap();
      await roster.getByRole('button', { name: 'Close', exact: true }).tap();
      await expect(roster).toHaveCount(0);
    },
    'Settings text rebuilt (battle speed, guidance) and the Campaign Map': async () => {
      await rail.getByRole('button', { name: 'Menu', exact: true }).tap();
      const pause = page.getByRole('dialog', { name: 'Paused', exact: true });
      await pause.getByRole('button', { name: 'Settings', exact: true }).tap();
      const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
      for (const name of [/^Battle speed/, /^Guidance/]) {
        const control = settings.getByRole('button', { name });
        const label = await control.textContent();
        await control.tap();
        await expect(control).not.toHaveText(label);
      }
      await settings.getByRole('button', { name: 'Close', exact: true }).tap();
      await pause.getByRole('button', { name: 'Campaign Map', exact: true }).tap();
      const map = page.getByRole('dialog', { name: 'Campaign map', exact: true });
      await expect(map.locator('.re-node').first()).toBeVisible();
      await map.getByRole('button', { name: 'Close', exact: true }).tap();
      await expect(map).toHaveCount(0);
      // Closing the map returns to the pause menu; Resume returns to the battle.
      await expect(pause).toBeVisible();
      await pause.getByRole('button', { name: 'Resume', exact: true }).tap();
      await battleIdle(page);
    },
    'a turn and back while a unit is selected (nothing re-opens)': async () => {
      const at = await scene(page, () => {
        const u = window.__emblemRogueGame.scene
          .getScene('Battle')
          .playerUnits.find((x) => x.name === 'Sera');
        return [u.col, u.row];
      });
      await tapTile(page, ...at);
      await expect
        .poll(() =>
          scene(page, () => window.__emblemRogueGame.scene.getScene('Battle').selectedUnit?.name),
        )
        .toBe('Sera');
      await page.setViewportSize(SIDEWAYS);
      await expect(page.locator('.portrait-battle-notice')).toHaveText(
        'The board turns back when this action is done.',
      );
      await page.setViewportSize(UPRIGHT);
      // Back out: the action menu, then the selection.
      const state = () =>
        scene(page, () => window.__emblemRogueGame.scene.getScene('Battle').battleState);
      for (const next of ['UNIT_SELECTED', 'PLAYER_IDLE']) {
        await rail.getByRole('button', { name: 'Back', exact: true }).tap();
        await expect.poll(state).toBe(next);
      }
      await battleIdle(page);
      expect((await battleSnapshot(page)).rotation).toBe('ccw');
    },
  };
  for (const [label, act] of Object.entries(actions)) {
    const before = await rng();
    await act();
    expect(await rng(), label).toEqual(before);
  }
  expect((await battleDomainState(page)).domain).toEqual(start.domain);
  expect(errors).toEqual([]);
});
