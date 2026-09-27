// Shared checks for portrait mode (docs/portrait-battles.md): an upright phone, the
// real shell (html.portrait-ui is set by utils/portraitBattle.js installPortraitUi,
// on by default on a phone), and the measurements every upright surface must meet.
//
// Every upright spec asserts outcomes a player would see:
//   - nothing scrolls the page (or its own root) sideways;
//   - key controls are whole on screen, at least 44 CSS px, and not covered;
//   - labels do not break mid-word or clip;
//   - content clears the notch and the home bar (emulated safe areas).
import { expect, devices } from '@playwright/test';

export const TAP = 44;

/** The three upright phones portrait mode is built for. */
export const PORTRAIT_PHONES = [
  { width: 375, height: 667 }, // iPhone SE / 8
  { width: 390, height: 844 }, // iPhone 13 / 14
  { width: 430, height: 932 }, // iPhone Pro Max
];

/** Landscape phones and desktops that must not regress. */
export const LANDSCAPE_PHONES = [
  { width: 568, height: 320 },
  { width: 667, height: 375 },
  { width: 844, height: 390 },
];
export const DESKTOPS = [
  { width: 640, height: 480 },
  { width: 1280, height: 800 },
];

// iPhone safe areas (CSS px): upright, the notch / Dynamic Island on top and the home
// bar below; sideways, the notch on one side and a thinner home bar.
export const NOTCH_PORTRAIT = { top: 47, bottom: 34, left: 0, right: 0 };
export const NOTCH_LANDSCAPE = { top: 0, bottom: 21, left: 47, right: 47 };

/**
 * A touch phone context (coarse pointer, mobile UA, touch). Spread into test.use()
 * with a viewport: `test.use(phone(PORTRAIT_PHONES[1]))`. The device screen matches
 * the viewport's phone, so portrait mode is on by default (no opt-in needed).
 */
export function phone(viewport) {
  const short = Math.min(viewport.width, viewport.height);
  const long = Math.max(viewport.width, viewport.height);
  return {
    ...devices['iPhone 13'],
    viewport,
    screen: { width: short, height: long },
  };
}

/** Quiet boot: no music or sfx, no teaching hints (the same settings other specs use). */
export async function quietSettings(page, extra = {}) {
  await page.addInitScript(
    (settings) => localStorage.setItem('emblem_rogue_settings', JSON.stringify(settings)),
    { musicVolume: 0, sfxVolume: 0, hints: false, ...extra },
  );
}

/**
 * Emulate the phone's safe areas (env(safe-area-inset-*)) through the DevTools
 * protocol. Returns false where the browser cannot (the check is then skipped).
 */
export async function emulateSafeArea(page, insets = NOTCH_PORTRAIT) {
  try {
    const cdp = await page.context().newCDPSession(page);
    const full = {};
    for (const side of ['top', 'bottom', 'left', 'right']) {
      full[side] = insets[side] || 0;
      full[`${side}Max`] = insets[side] || 0;
    }
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: full });
    return true;
  } catch {
    return false;
  }
}

/** Portrait mode is live on the page: the class is set and the rotate prompt hidden. */
export async function expectPortraitUi(page, on = true) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.classList.contains('portrait-ui')))
    .toBe(on);
  if (on) await expect(page.locator('#rotate-prompt')).toBeHidden();
}

/** Nothing scrolls sideways: the page, the body, and (optionally) one root element. */
export async function expectNoSidewaysScroll(page, rootSelector = null) {
  await page.evaluate(() => document.fonts.ready);
  const fit = await page.evaluate((sel) => {
    const root = sel ? document.querySelector(sel) : null;
    return {
      page: Math.max(0, document.documentElement.scrollWidth - innerWidth),
      body: Math.max(0, document.body.scrollWidth - innerWidth),
      root: root ? Math.max(0, root.scrollWidth - root.clientWidth - 1) : 0,
      right: root ? Math.max(0, root.getBoundingClientRect().right - innerWidth - 0.5) : 0,
    };
  }, rootSelector);
  expect(fit, `sideways overflow${rootSelector ? ` in ${rootSelector}` : ''}`).toEqual({
    page: 0,
    body: 0,
    root: 0,
    right: 0,
  });
}

/**
 * A control a thumb can hit: whole in the viewport, at least 44 px each way (or
 * `min`), and the topmost element at its centre (nothing covers it).
 */
export async function expectTappable(locator, { min = TAP } = {}) {
  await expect(locator).toBeVisible();
  await locator.scrollIntoViewIfNeeded();
  await expect(locator).toBeInViewport({ ratio: 1 });
  const box = await locator.boundingBox();
  const label = (await locator.getAttribute('aria-label')) || (await locator.innerText());
  expect(box.height, `"${label}" height`).toBeGreaterThanOrEqual(min - 0.5);
  expect(box.width, `"${label}" width`).toBeGreaterThanOrEqual(min - 0.5);
  const onTop = await locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return el === hit || el.contains(hit);
  });
  expect(onTop, `nothing covers "${label}"`).toBe(true);
}

/** Every element matched is on one text line (no mid-word or mid-label breaks). */
export async function expectSingleLine(locator) {
  const n = await locator.count();
  expect(n).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    const info = await locator.nth(i).evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const tops = new Set(
        [...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top)),
      );
      return { lines: tops.size, text: el.textContent.trim() };
    });
    expect(info.lines, `"${info.text}" on one line`).toBeLessThanOrEqual(1);
  }
}

/**
 * Text that is cut off inside `rootSelector`: elements whose content is wider than
 * their box while they hide the overflow (ellipsis counts as intended when the
 * element sets text-overflow: ellipsis and carries a title/aria-label with the
 * full text). Returns [{ text, overflow }] for the caller to assert empty.
 */
export async function clippedText(page, rootSelector) {
  await page.evaluate(() => document.fonts.ready);
  return page.evaluate((sel) => {
    const out = [];
    for (const root of document.querySelectorAll(sel)) {
      for (const el of root.querySelectorAll('*')) {
        if (!el.childNodes.length) continue;
        const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
        if (!hasText) continue;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        const hides = /hidden|clip/.test(cs.overflowX) || /hidden|clip/.test(cs.overflow);
        const over = el.scrollWidth - el.clientWidth;
        if (!hides || over <= 1) continue;
        const labelled = el.title || el.getAttribute('aria-label');
        if (cs.textOverflow === 'ellipsis' && labelled) continue;
        out.push({ text: el.textContent.trim().slice(0, 60), overflow: over });
      }
    }
    return out;
  }, rootSelector);
}

/**
 * Whole boxes of `selector` (visible ones) stay inside the safe area: below the top
 * inset and above the bottom inset. Pass the insets emulated with emulateSafeArea.
 */
export async function expectInsideSafeArea(page, selector, insets = NOTCH_PORTRAIT) {
  const boxes = await page.evaluate((sel) => {
    return [...document.querySelectorAll(sel)]
      .filter((el) => {
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return cs.visibility !== 'hidden' && cs.display !== 'none' && r.width > 0 && r.height > 0;
      })
      .map((el) => {
        const r = el.getBoundingClientRect();
        return {
          label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40),
          top: r.top,
          bottom: r.bottom,
          left: r.left,
          right: r.right,
          vw: innerWidth,
          vh: innerHeight,
        };
      });
  }, selector);
  expect(boxes.length, `${selector} is on screen`).toBeGreaterThan(0);
  for (const b of boxes) {
    expect(b.top, `"${b.label}" clears the notch`).toBeGreaterThanOrEqual(insets.top - 0.5);
    expect(b.bottom, `"${b.label}" clears the home bar`).toBeLessThanOrEqual(
      b.vh - insets.bottom + 0.5,
    );
    expect(b.left, `"${b.label}" clears the left inset`).toBeGreaterThanOrEqual(
      (insets.left || 0) - 0.5,
    );
    expect(b.right, `"${b.label}" clears the right inset`).toBeLessThanOrEqual(
      b.vw - (insets.right || 0) + 0.5,
    );
  }
}

/** Page errors during a test: `const errors = pageErrors(page); … expect(errors).toEqual([])`. */
export function pageErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

// ---------------------------------------------------------------------------
// Battle and run flows shared by the portrait battle, journey and rotation specs.
// Every wait is on game state (window.__sceneState, the Battle scene), never on time.

/**
 * Attach the page's run to a save slot (dev routes have none), so the battle can be
 * saved, re-opened in the other orientation and resumed. The test profile is isolated.
 */
export async function attachSlot(page, slot = 1) {
  await page.evaluate(async (slot) => {
    const game = window.__emblemRogueGame;
    const { getMetaKey, setActiveSlot } = await import('/src/engine/SlotManager.js');
    const meta = game.registry.get('meta');
    meta.storageKey = getMetaKey(slot);
    meta._save();
    game.registry.set('activeSlot', slot);
    setActiveSlot(slot);
  }, slot);
}

/** Board orientation, battle state and a short unit summary of the live battle. */
export function battleSnapshot(page) {
  return page.evaluate(() => {
    const b = window.__emblemRogueGame.scene.getScene('Battle');
    return {
      rotation: b.grid?.board?.rotation ?? null,
      state: b.battleState,
      phase: b.turnManager?.currentPhase ?? null,
      units: [...b.playerUnits, ...b.enemyUnits, ...(b.npcUnits || [])].map((u) => [
        u.name,
        u.col,
        u.row,
        u.currentHP,
        Boolean(u.hasActed),
      ]),
      rng: b._battleRng?.getState?.() ?? null,
    };
  });
}

/**
 * Full domain state of the live battle, through the production checkpoint adapter:
 * units (HP, positions, equipment, conditions), enemies, NPCs, fog knowledge,
 * temporary terrain, village and ballista state, the RNG stream, convoy and gold;
 * plus the turn, Vision charges and the deployment record the run keeps for it.
 * Bookkeeping that legitimately counts saves (the checkpoint index; an orientation
 * switch is one save) is returned apart, never compared as gameplay.
 *
 * Values are compared the way a save stores them, so live play and a restore from
 * the save compare equal: JSON (an unset distance, Infinity, reads back as null,
 * which the game reads as Infinity) and the commander flag as a boolean (a restore
 * writes false where live play leaves it unset). Nothing else is normalized.
 */
export function battleDomainState(page) {
  return page.evaluate(async () => {
    const { captureBattleState } = await import('/src/ui/BattleCheckpointAdapter.js');
    const b = window.__emblemRogueGame.scene.getScene('Battle');
    const state = JSON.parse(JSON.stringify(captureBattleState(b)));
    for (const group of [
      'playerUnits',
      'enemyUnits',
      'npcUnits',
      'escapedUnits',
      'nonDeployedUnits',
    ])
      for (const unit of state[group] || []) unit.isCommander = unit.isCommander === true;
    if (state.fog) {
      state.fog.visible.sort();
      state.fog.everSeen.sort();
    }
    delete state.checkpointIndex; // a capture argument (0 here), not battle state
    const rm = b.runManager;
    const bip = rm?.battleInProgress;
    const bookkeeping = { checkpointIndex: bip?.checkpoint?.checkpointIndex ?? null };
    return {
      bookkeeping,
      domain: {
        state,
        turn: b.turnManager?.turnNumber ?? null,
        phase: b.turnManager?.currentPhase ?? null,
        visionCharges: rm?.visionChargesRemaining ?? null,
        visionCount: rm?.visionCount ?? null,
        deployment: {
          deployCount: b.battleParams?.deployCount ?? null,
          lastDeployment: rm?.lastDeployment ?? null,
          battleParams: bip?.battleParams ?? null,
          entry: bip
            ? {
                nodeId: bip.nodeId,
                isBoss: bip.isBoss,
                isElite: bip.isElite,
                rewindPolicy: bip.rewindPolicy,
                visionChargesAtEntry: bip.visionChargesAtEntry,
                visionCountAtEntry: bip.visionCountAtEntry,
                rngSeedAtEntry: bip.rngSeedAtEntry,
                entryBattleState: bip.entryBattleState,
              }
            : null,
        },
      },
    };
  });
}

/**
 * The CSS point at the centre of a tile, after the camera brings it into view (the
 * same pan a player would make). Works for the turned and the landscape board.
 */
export function tileOnScreen(page, col, row) {
  return page.evaluate(
    ([col, row]) => {
      const b = window.__emblemRogueGame.scene.getScene('Battle');
      const world = b.grid.gridToPixel(col, row);
      b._battleCamera?.ensureWorldVisible?.(world.x, world.y, 24);
      const screen = b._worldToScreen(world.x, world.y);
      const rect = b.game.canvas.getBoundingClientRect();
      return {
        x: rect.left + (screen.x * rect.width) / b.scale.width,
        y: rect.top + (screen.y * rect.height) / b.scale.height,
      };
    },
    [col, row],
  );
}

/** A real tap on a board tile. */
export async function tapTile(page, col, row) {
  const point = await tileOnScreen(page, col, row);
  await page.touchscreen.tap(point.x, point.y);
}

export function battleRail(page) {
  return page.getByRole('complementary', { name: 'Battle commands' });
}

/** Wait until the player can act (turn ready, nothing selected). */
export async function battleIdle(page, timeout = 30_000) {
  await page.waitForFunction(
    () => {
      const b = window.__emblemRogueGame?.scene?.getScene('Battle');
      return (
        window.__sceneState?.activeScene === 'Battle' &&
        b?.battleState === 'PLAYER_IDLE' &&
        b.turnManager?.currentPhase === 'player' &&
        !b.selectedUnit
      );
    },
    null,
    { timeout },
  );
}

/**
 * Select a unit by tapping it, tap a destination, and Wait from the rail: one whole
 * player action through real input. `dest` ({ col, row }) defaults to the reachable
 * free tile closest to the nearest enemy (`toward: true`) or farthest from every
 * enemy (`toward: false`); ties go to the lowest row, then column, so the same call
 * plays the same move in any orientation.
 */
export async function moveAndWait(page, name, { dest = null, toward = true } = {}) {
  const plan = await page.evaluate(
    ([name, dest, toward]) => {
      const b = window.__emblemRogueGame.scene.getScene('Battle');
      const u = b.playerUnits.find((x) => x.name === name);
      if (!u || u.hasActed) throw new Error(`${name} cannot act`);
      if (dest) return { from: [u.col, u.row], to: [dest.col, dest.row] };
      const occupied = new Set(
        [...b.playerUnits, ...b.enemyUnits, ...(b.npcUnits || [])].map((x) => `${x.col},${x.row}`),
      );
      const foes = b.enemyUnits.filter((e) => e.currentHP > 0);
      const gap = (c, r) => Math.min(...foes.map((e) => Math.abs(e.col - c) + Math.abs(e.row - r)));
      let best = null;
      for (const key of b.grid.getMovementRange(u.col, u.row, u.stats.MOV, u.moveType).keys()) {
        if (occupied.has(key)) continue;
        const [col, row] = key.split(',').map(Number);
        const score = (toward ? gap(col, row) : -gap(col, row)) * 10_000 + row * 100 + col;
        if (!best || score < best.score) best = { col, row, score };
      }
      return { from: [u.col, u.row], to: best ? [best.col, best.row] : [u.col, u.row] };
    },
    [name, dest, toward],
  );
  await tapTile(page, ...plan.from);
  await expect
    .poll(() =>
      page.evaluate(
        () => window.__emblemRogueGame.scene.getScene('Battle').selectedUnit?.name ?? null,
      ),
    )
    .toBe(name);
  await tapTile(page, ...plan.to);
  const wait = battleRail(page).getByRole('button', { name: 'Wait', exact: true });
  await expect(wait).toBeVisible();
  await wait.tap();
  await expect
    .poll(() =>
      page.evaluate(
        (name) =>
          window.__emblemRogueGame.scene.getScene('Battle').playerUnits.find((x) => x.name === name)
            ?.hasActed === true,
        name,
      ),
    )
    .toBe(true);
  return plan.to;
}

/**
 * Attack from where the unit stands, through real input: tap the unit, tap its own
 * tile (stay), Attack, pick the target, Confirm on the forecast. Resolves once the
 * attack has played out (the unit has acted, or the battle ended).
 */
export async function attackInPlace(page, attacker, target) {
  const at = await page.evaluate(
    ([attacker, target]) => {
      const b = window.__emblemRogueGame.scene.getScene('Battle');
      const u = b.playerUnits.find((x) => x.name === attacker);
      const e = b.enemyUnits.find((x) => x.battleEntityId === target);
      return { unit: [u.col, u.row], enemy: e ? e.name : null };
    },
    [attacker, target],
  );
  await tapTile(page, ...at.unit);
  await expect
    .poll(() =>
      page.evaluate(() => window.__emblemRogueGame.scene.getScene('Battle').selectedUnit?.name),
    )
    .toBe(attacker);
  await tapTile(page, ...at.unit);
  const rail = battleRail(page);
  await rail.getByRole('button', { name: 'Attack', exact: true }).tap();
  const targets = rail.getByRole('group', { name: 'Attack targets' });
  await expect(targets).toBeVisible();
  // The list shows the attackable foes in the scene's order.
  const index = await page.evaluate(
    (target) =>
      window.__emblemRogueGame.scene
        .getScene('Battle')
        .attackTargets.findIndex((e) => e.battleEntityId === target),
    target,
  );
  expect(index, `${at.enemy} is in reach`).toBeGreaterThanOrEqual(0);
  await targets.getByRole('button').nth(index).tap();
  const forecast = page.getByRole('dialog', { name: 'Combat forecast' });
  await expect(forecast).toBeVisible();
  const turn = await page.evaluate(
    () => window.__emblemRogueGame.scene.getScene('Battle').turnManager.turnNumber,
  );
  await forecast.getByRole('button', { name: 'Confirm attack' }).tap();
  // Played out: the battle ended, the turn moved on (the last unit to act ends the
  // phase), or the attacker is done and the player can act again.
  await settleBattle(
    page,
    ([attacker, turn]) => {
      const b = window.__emblemRogueGame.scene.getScene('Battle');
      if (!b || b.battleState === 'BATTLE_END') return true;
      if (b.turnManager.turnNumber !== turn || b.turnManager.currentPhase !== 'player') return true;
      const u = b.playerUnits.find((x) => x.name === attacker);
      return (!u || u.hasActed || u.currentHP <= 0) && b.battleState === 'PLAYER_IDLE';
    },
    [attacker, turn],
  );
}

/**
 * Wait for `done(arg)` in the page, tapping through the progression popups a battle
 * raises on the way (level ups: Continue / Reveal gains).
 */
export async function settleBattle(page, done, arg = null, timeout = 90_000) {
  const popup = page.getByRole('button', { name: /^(Continue|Reveal gains)$/ }).first();
  const deadline = Date.now() + timeout;
  for (;;) {
    const left = deadline - Date.now();
    if (left <= 0) throw new Error('the battle never settled');
    const next = await Promise.race([
      page.waitForFunction(done, arg, { timeout: left }).then(
        () => 'done',
        () => 'timeout',
      ),
      popup.waitFor({ state: 'visible', timeout: left }).then(
        () => 'popup',
        () => 'timeout',
      ),
    ]);
    if (next === 'done') return;
    if (next === 'popup') await popup.tap().catch(() => {});
  }
}

/**
 * End the player turn through the rail (confirming when units have not acted) and
 * wait for the next player turn. `duringEnemyPhase` runs once the enemy phase has
 * begun, before it ends (e.g. to turn the phone mid-phase).
 */
export async function endPlayerTurn(page, { duringEnemyPhase = null } = {}) {
  const rail = battleRail(page);
  const turn = await page.evaluate(
    () => window.__emblemRogueGame.scene.getScene('Battle').turnManager.turnNumber,
  );
  await rail.getByRole('button', { name: /^End turn/ }).tap();
  const confirm = rail.getByRole('button', { name: 'End turn now', exact: true });
  const phase = () =>
    page.evaluate(() => window.__emblemRogueGame.scene.getScene('Battle').turnManager.currentPhase);
  await expect
    .poll(async () => (await confirm.isVisible()) || (await phase()) !== 'player')
    .toBe(true);
  if ((await phase()) === 'player') await confirm.tap();
  if (duringEnemyPhase) {
    await page.waitForFunction(
      () => window.__emblemRogueGame.scene.getScene('Battle').turnManager.currentPhase === 'enemy',
    );
    await duringEnemyPhase();
  }
  await settleBattle(
    page,
    (turn) => {
      const b = window.__emblemRogueGame.scene.getScene('Battle');
      return (
        b.battleState === 'BATTLE_END' ||
        (b.turnManager.turnNumber > turn &&
          b.turnManager.currentPhase === 'player' &&
          b.battleState === 'PLAYER_IDLE')
      );
    },
    turn,
  );
}

/**
 * Turn the phone (a new viewport) and, for a battle, wait until the board shows
 * `rotation` and the player can act again.
 */
export async function turnPhone(page, size, rotation = null) {
  await page.setViewportSize(size);
  if (rotation === null) return;
  await expect
    .poll(() =>
      page.evaluate(
        () => window.__emblemRogueGame.scene.getScene('Battle')?.grid?.board?.rotation ?? null,
      ),
    )
    .toBe(rotation);
  await battleIdle(page);
}

/**
 * Leave the page and put back a saved profile (every localStorage key), so the next
 * load starts from exactly that save. Leaving first keeps anything the game writes
 * on its way out from overwriting the fixture.
 */
export async function restoreProfile(page, saved) {
  await page.goto('/data/terrain.json');
  await page.evaluate((entries) => {
    localStorage.clear();
    for (const [key, value] of JSON.parse(entries)) localStorage.setItem(key, value);
  }, saved);
}

/** Every localStorage key, for restoreProfile. */
export function saveProfile(page) {
  return page.evaluate(() => JSON.stringify(Object.entries(localStorage)));
}

/**
 * The shipping recovery path after a refresh: Title -> Save Slots -> Slot 1, then the
 * suspended battle's choice ('Resume Battle' or 'Continue from Map').
 */
export async function openSavedRun(page, choice = 'Resume Battle') {
  await page.goto('/');
  await activeScene(page, 'Title');
  await page.getByRole('button', { name: /^Save Slots/ }).tap();
  await activeScene(page, 'SlotPicker');
  await page.getByRole('button', { name: 'Select Slot 1', exact: true }).tap();
  await page.getByRole('button', { name: choice, exact: true }).tap();
  if (choice === 'Resume Battle') {
    await activeScene(page, 'Battle');
    await battleIdle(page);
  } else await activeScene(page, 'NodeMap');
}

/** Wait for a scene to be the active one (as helpers.js waitForScene). */
export async function activeScene(page, key, timeout = 20_000) {
  await page.waitForFunction((k) => window.__sceneState?.activeScene === k, key, { timeout });
}

/**
 * A dev-route battle on the phone as it stands (no ?portrait=, so portrait mode is
 * the device default), past deployment to the first player turn. `slot` attaches the
 * run to that save slot (null: a slotless battle, as dev routes are); `query` adds
 * route parameters (e.g. '&devNode=recruit').
 */
export async function openDevBattle(
  page,
  { preset = 'battle_smoke', seed = 42, slot = 1, query = '' } = {},
) {
  await page.goto(`/?devScene=battle&preset=${preset}&seed=${seed}${query}`);
  await page.waitForFunction(() => window.__sceneState?.ready === true, null, { timeout: 20_000 });
  await activeScene(page, 'Battle');
  await page.waitForFunction(
    () => ['DEPLOY_SELECTION', 'PLAYER_IDLE'].includes(window.__sceneState?.battle?.state),
    null,
    { timeout: 30_000 },
  );
  // The dev route's canvas deployment step: take the default deployment.
  await page.evaluate(() => {
    const b = window.__emblemRogueGame.scene.getScene('Battle');
    if (b.battleState !== 'DEPLOY_SELECTION') return;
    b.children.list
      .filter((o) => o.type === 'Rectangle' && o.input?.enabled && o.listenerCount('pointerdown'))
      .at(-1)
      ?.emit('pointerdown');
  });
  await battleIdle(page);
  if (slot != null) await attachSlot(page, slot);
}
