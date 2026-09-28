// E2E: portrait mode through the real default path (docs/portrait-battles.md).
//
// A phone context (portraitHelpers.phone: touch, an iPhone's screen) with no
// ?portrait=1, no forced class and no save (only the quiet audio / hints settings
// every spec stores): portrait mode is on only because the shell's default says so. Each spec asserts what a player would see at every step:
// portrait mode on (html.portrait-ui, no rotate prompt), nothing scrolls sideways,
// the step's primary action is tappable, and no page errors; and it reads back what
// was saved.
//
//   - a slice of a whole run upright: Title, Save Slots, Home Base, Difficulty,
//     Blessing, the route, a battle played through (actions, enemy phase, the win),
//     rewards, the next battle, a village shop (a purchase), and the battle after;
//   - a refresh mid-battle: Resume Battle restores the exact battle (upright, after
//     a turn of the phone, and in landscape) and Continue from Map is the sanctioned
//     revert to the route;
//   - the tutorial and a slotless battle keep the board they started with.
import { test, expect } from '@playwright/test';
import { waitForGame, attachSceneCrashArtifacts } from './helpers.js';
import {
  PORTRAIT_PHONES,
  TAP,
  activeScene,
  attackInPlace,
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
  pageErrors,
  phone,
  quietSettings,
  settleBattle,
  tapTile,
  turnPhone,
} from './portraitHelpers.js';

// Compact battle-rail commands at >= 38 px are accepted by the owner
// (mobile-battle-hud.spec.js); everything else is held to 44.
const RAIL_MIN = 38;

// New runs take their seed from the clock. Pin it so the route and the battles repeat:
// with this seed the act opens battle, battle, village (shop), battle, no fog. The pin
// goes on the class the game itself uses, reached through a live run (a module URL
// imported from the test can be a separate copy of the class once the dev server has
// reloaded that file), so it applies to every run started after it.
const RUN_SEED = 11;

async function pinRunSeed(page, seed = RUN_SEED) {
  await page.evaluate((seed) => {
    const run = window.__emblemRogueGame.scene.getScene('NodeMap').runManager;
    const RunManager = run.constructor;
    const startRun = RunManager.prototype.startRun;
    RunManager.prototype.startRun = function (options = {}) {
      return startRun.call(this, { ...options, runSeed: options.runSeed ?? seed });
    };
  }, seed);
}

test.afterEach(async ({ page }, testInfo) => {
  await attachSceneCrashArtifacts(page, testInfo);
});

// SceneGuard findings this journey also raises in landscape (844x390, the same run,
// seed and taps), so they are not portrait mode's: combat sounds still counted as
// playing while muted (periodically, or at the hand-off to the route, depending on
// timing), and the rewards overlay still flagged open as the battle hands off to the
// route. Any other invariant error fails the journey.
const LANDSCAPE_TOO = [
  /^sound_leak(_periodic)?: /,
  /^shutdown_overlay_leak: 1 overlays still open in Battle$/,
];

async function expectNoNewInvariantErrors(page) {
  const found = await page.evaluate(() => window.__sceneState?.errors || []);
  expect(found.filter((e) => !LANDSCAPE_TOO.some((known) => known.test(e)))).toEqual([]);
}

/** Portrait mode is on, nothing scrolls sideways, the primary action is tappable. */
async function uprightStep(page, errors, primary, { min = TAP } = {}) {
  await expectPortraitUi(page);
  await expectNoSidewaysScroll(page);
  if (primary) await expectTappable(primary, { min });
  expect(errors, 'page errors').toEqual([]);
}

/** Get past the route map's story conversation (if any) to the idle loom. */
async function readyRoute(page) {
  const route = page.locator('.re-node-map');
  const skip = page.getByRole('button', { name: 'Skip conversation', exact: true });
  await expect(route.or(skip).filter({ visible: true }).first()).toBeVisible();
  while (await skip.isVisible()) {
    await skip.tap();
    await expect(route.or(skip).filter({ visible: true }).first()).toBeVisible();
  }
  await expect(route).toBeVisible();
  await page.waitForFunction(() => window.__sceneState?.nodeMap?.state === 'IDLE');
  return route;
}

/**
 * The next knot on the way to `goal` ('shop' or 'battle'): an available node that is
 * the goal, else the available battle closest (in knots) to one.
 */
function nextKnot(page, goal) {
  return page.evaluate((goal) => {
    const rm = window.__emblemRogueGame.scene.getScene('NodeMap').runManager;
    const nodes = rm.nodeMap.nodes;
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const steps = (node) => {
      let frontier = [node];
      for (let d = 0; d < 12 && frontier.length; d++) {
        if (frontier.some((n) => n.type === goal)) return d;
        frontier = frontier.flatMap((n) => n.edges.map((id) => byId.get(id)));
      }
      return Infinity;
    };
    const ranked = rm
      .getAvailableNodes()
      .filter((n) => n.type === goal || n.type === 'battle')
      .map((n) => ({ id: n.id, type: n.type, steps: steps(n) }))
      .sort((a, b) => a.steps - b.steps || a.id.localeCompare(b.id));
    return ranked[0] || null;
  }, goal);
}

/** Tap a knot, check its sheet upright, and Travel. */
async function travel(page, errors, knot) {
  const route = await readyRoute(page);
  const node = route.locator(`.re-node[data-node="${knot.id}"]`);
  await node.scrollIntoViewIfNeeded();
  await node.tap();
  await expect(node).toHaveAttribute('aria-pressed', 'true');
  const go = route.getByRole('button', { name: 'Travel', exact: true });
  await uprightStep(page, errors, go);
  await go.tap();
}

/** From Travel to the player's first turn: conversation, deployment, Formation. */
async function enterBattle(page, errors) {
  await activeScene(page, 'Battle');
  const skip = page.getByRole('button', { name: 'Skip conversation', exact: true });
  const deploy = page.getByRole('dialog', { name: 'Deploy units', exact: true });
  const start = battleRail(page).getByRole('button', { name: 'Start battle', exact: true });
  for (;;) {
    await page.waitForFunction(() => {
      const b = window.__emblemRogueGame.scene.getScene('Battle');
      return (
        ['DEPLOY_SELECTION', 'DEPLOY_POSITIONING', 'PLAYER_IDLE'].includes(b?.battleState) ||
        [...document.querySelectorAll('button')].some(
          (x) => x.textContent.trim() === 'Skip conversation' && x.getClientRects().length,
        )
      );
    });
    if (await skip.isVisible()) {
      await skip.tap();
      continue;
    }
    if (await deploy.isVisible()) {
      const confirm = deploy.getByRole('button', { name: 'Deploy', exact: true });
      await uprightStep(page, errors, confirm);
      await confirm.tap();
      continue;
    }
    if (await start.isVisible()) {
      // Formation (three or more units): take the default placement and start.
      await battleRail(page).getByRole('button', { name: 'Auto-place', exact: true }).tap();
      await uprightStep(page, errors, start, { min: RAIL_MIN });
      await start.tap();
      continue;
    }
    const state = await battleSnapshot(page);
    if (state.state === 'PLAYER_IDLE' && state.phase === 'player') break;
  }
  await battleIdle(page);
  // The board is turned (the player's side at the bottom) and the rail is upright.
  const snap = await battleSnapshot(page);
  expect(snap.rotation).toBe('ccw');
  const classes = await page.evaluate(() => document.documentElement.className);
  expect(classes).toContain('portrait-battle');
  await uprightStep(page, errors, battleRail(page).getByRole('button', { name: /^End turn/ }), {
    min: RAIL_MIN,
  });
}

/**
 * Win through real attacks. Staging only: each foe still standing is left at 1 HP
 * and moved beside (or into weapon range of) a different ally that can still act,
 * on plain ground; the blows themselves are real taps through the forecast. A miss
 * costs a turn: the staging repeats after the enemy phase.
 */
async function winBattle(page) {
  for (let round = 0; round < 8; round++) {
    const pairs = await page.evaluate(() => {
      const b = window.__emblemRogueGame.scene.getScene('Battle');
      const plain = b.gameData.terrain.findIndex((t) => t.name === 'Plain');
      const taken = (c, r) =>
        [...b.playerUnits, ...b.enemyUnits, ...(b.npcUnits || [])].some(
          (u) => u.currentHP > 0 && u.col === c && u.row === r,
        );
      const allies = b.playerUnits.filter((u) => u.currentHP > 0 && !u.hasActed);
      const foes = b.enemyUnits.filter((e) => e.currentHP > 0);
      const out = [];
      for (const [i, foe] of foes.entries()) {
        const ally = allies[i];
        if (!ally) break;
        const reach = Number(String(ally.weapon?.range ?? '1').split('-')[0]) || 1;
        let spot = null;
        for (let dc = -reach; dc <= reach && !spot; dc++) {
          const dr = reach - Math.abs(dc);
          for (const r of dr ? [ally.row - dr, ally.row + dr] : [ally.row]) {
            const c = ally.col + dc;
            if (c < 0 || r < 0 || c >= b.grid.cols || r >= b.grid.rows || taken(c, r)) continue;
            spot = [c, r];
            break;
          }
        }
        if (!spot) continue;
        [foe.col, foe.row] = spot;
        b.grid.setTerrainAt(foe.col, foe.row, plain);
        b.updateUnitPosition(foe);
        foe.currentHP = 1;
        out.push([ally.name, foe.battleEntityId]);
      }
      b.updateEnemyVisibility?.();
      b.dangerZoneStale = true;
      return out;
    });
    const turn = await page.evaluate(
      () => window.__emblemRogueGame.scene.getScene('Battle').turnManager.turnNumber,
    );
    for (const [ally, foe] of pairs) {
      const now = await battleSnapshot(page);
      if (now.state !== 'PLAYER_IDLE' || now.phase !== 'player') break;
      await attackInPlace(page, ally, foe);
    }
    await settleBattle(page, () => {
      const b = window.__emblemRogueGame.scene.getScene('Battle');
      return (
        b.battleState === 'BATTLE_END' ||
        (b.battleState === 'PLAYER_IDLE' && b.turnManager.currentPhase === 'player')
      );
    });
    if ((await battleSnapshot(page)).state === 'BATTLE_END') return;
    // A miss: end the turn (unless the last attack already ended it) and stage again.
    const still = await page.evaluate(
      () => window.__emblemRogueGame.scene.getScene('Battle').turnManager.turnNumber,
    );
    if (still === turn) await endPlayerTurn(page);
  }
  throw new Error('the battle was not won');
}

/** Claim the first item reward through the upright rewards screen; returns its name. */
async function claimReward(page, errors) {
  const rewards = page.getByRole('dialog', { name: 'Battle rewards', exact: true });
  await expect(rewards).toBeVisible({ timeout: 30_000 });
  const claim = rewards.getByRole('button', { name: 'Choose reward', exact: true });
  await uprightStep(page, errors, claim);
  const choice = await page.evaluate(() => {
    const c = window.__emblemRogueGame.scene.getScene('Battle')._lootController;
    const i = c.mobileRewards.choices.findIndex((x) => x.item && x.type !== 'skip');
    return { index: i, name: c.mobileRewards.choices[i]?.item?.name ?? null };
  });
  expect(choice.name, 'an item among the rewards').toBeTruthy();
  const card = rewards.locator('.reward-card').nth(choice.index);
  await card.scrollIntoViewIfNeeded();
  await card.tap();
  await expect(card).toHaveAttribute('aria-pressed', 'true');
  await claim.tap();
  // Recipient steps: the first choice is preselected; Continue until Apply.
  const apply = rewards.getByRole('button', { name: 'Apply reward', exact: true });
  const next = rewards.getByRole('button', { name: 'Continue', exact: true });
  for (let i = 0; i < 4 && !(await apply.isVisible()); i++) {
    await expect(apply.or(next).first()).toBeVisible();
    if (await next.isVisible()) await next.tap();
  }
  await uprightStep(page, errors, apply);
  await apply.tap();
  await activeScene(page, 'NodeMap', 30_000);
  return choice.name;
}

/** The slot's saved run holds `name` with a unit, in the convoy or the shared pool. */
function savedRunHolds(page, name) {
  return page.evaluate(async (name) => {
    const { loadRun } = await import('/src/engine/RunManager.js');
    const gameData = window.__emblemRogueGame.scene.getScene('NodeMap').gameData;
    const run = loadRun(gameData, 1);
    const items = [
      ...run.roster.flatMap((u) => [...(u.inventory || []), ...(u.consumables || [])]),
      ...run.roster.map((u) => u.accessory).filter(Boolean),
      ...(run.accessories || []),
      ...(run.convoy?.weapons || []),
      ...(run.convoy?.consumables || []),
    ];
    return items.some((item) => item?.name === name);
  }, name);
}

for (const viewport of [PORTRAIT_PHONES[0], PORTRAIT_PHONES[1]]) {
  test.describe(`${viewport.width}x${viewport.height}`, () => {
    test.use(phone(viewport));

    test('a run slice upright on the default path: menus, a won battle, rewards, a shop, the next battles', async ({
      page,
    }) => {
      test.setTimeout(300_000);
      const errors = pageErrors(page);
      await quietSettings(page, { guidance: 'off' });

      // Title, no save, nothing stored: portrait mode is the phone's default.
      await page.goto('/');
      await waitForGame(page);
      await activeScene(page, 'Title');
      expect(await page.evaluate(() => localStorage.getItem('emblem_rogue_portrait_battles'))).toBe(
        null,
      );
      const newGame = page.getByRole('button', { name: 'New Game', exact: true });
      await uprightStep(page, errors, newGame);

      // A brand-new save goes straight to the route (first-run fast path); the menus
      // this journey is about come with the slot's second run, so leave this one.
      await newGame.tap();
      await activeScene(page, 'NodeMap');
      await readyRoute(page);
      await pinRunSeed(page);
      const menu = page.locator('.re-node-map').getByRole('button', { name: 'Menu', exact: true });
      await uprightStep(page, errors, menu);
      await menu.tap();
      const pause = page.getByRole('dialog', { name: 'Paused', exact: true });
      await pause.getByRole('button', { name: 'Abandon Run', exact: true }).tap();
      const abandon = pause.getByRole('button', { name: 'Abandon run', exact: true });
      await uprightStep(page, errors, abandon);
      await abandon.tap();

      // Title -> Save Slots -> Slot 1 -> Home Base -> Difficulty -> Blessing -> route.
      await activeScene(page, 'Title');
      const slots = page.getByRole('button', { name: 'Save Slots', exact: true });
      await uprightStep(page, errors, slots);
      await slots.tap();
      await activeScene(page, 'SlotPicker');
      const slot = page.getByRole('button', { name: 'Select Slot 1', exact: true });
      await uprightStep(page, errors, slot);
      await slot.tap();
      await activeScene(page, 'HomeBase');
      const begin = page.getByRole('button', { name: 'Begin Run', exact: true });
      await uprightStep(page, errors, begin);
      await begin.tap();
      await activeScene(page, 'DifficultySelect');
      const difficulty = page.getByRole('dialog', { name: 'Choose difficulty' });
      const confirmDifficulty = difficulty.getByRole('button', { name: 'Confirm', exact: true });
      await uprightStep(page, errors, confirmDifficulty);
      await confirmDifficulty.tap();
      await activeScene(page, 'BlessingSelect');
      const blessing = page.getByRole('dialog', { name: 'Choose a blessing' });
      const none = blessing.getByRole('button', { name: 'No blessing', exact: true });
      await uprightStep(page, errors, none);
      await none.tap();
      const confirmBlessing = blessing.getByRole('button', { name: 'Confirm', exact: true });
      await uprightStep(page, errors, confirmBlessing);
      await confirmBlessing.tap();
      await activeScene(page, 'NodeMap');
      expect(
        await page.evaluate(
          () => window.__emblemRogueGame.scene.getScene('NodeMap').runManager.runSeed,
        ),
        'the pinned run seed',
      ).toBe(RUN_SEED);

      // The first battle, played through: two moves, an enemy phase, the win.
      await travel(page, errors, await nextKnot(page, 'shop'));
      await enterBattle(page, errors);
      const army = await page.evaluate(() =>
        window.__emblemRogueGame.scene
          .getScene('Battle')
          .playerUnits.filter((u) => u.currentHP > 0)
          .map((u) => u.name),
      );
      for (const name of army) await moveAndWait(page, name, { toward: false });
      await endPlayerTurn(page);
      await uprightStep(page, errors, battleRail(page).getByRole('button', { name: /^End turn/ }), {
        min: RAIL_MIN,
      });
      expect((await battleSnapshot(page)).rotation).toBe('ccw');
      await winBattle(page);
      const first = await claimReward(page, errors);
      expect(await savedRunHolds(page, first), `${first} saved`).toBe(true);

      // The second battle (the act's second row is always a battle).
      await travel(page, errors, await nextKnot(page, 'shop'));
      await enterBattle(page, errors);
      await winBattle(page);
      await claimReward(page, errors);

      // The village shop: buy something a unit can carry, and it is saved.
      const shopKnot = await nextKnot(page, 'shop');
      expect(shopKnot?.type).toBe('shop');
      await travel(page, errors, shopKnot);
      const shop = page.locator('.shop-menu');
      await expect(shop).toBeVisible({ timeout: 20_000 });
      await uprightStep(page, errors, shop.getByRole('button', { name: 'Leave', exact: true }));
      const entry = await page.evaluate(() => {
        const s = window.__emblemRogueGame.scene.getScene('NodeMap');
        const e = s.shopBuyItems.find(
          (x) => x.price <= s.runManager.gold && !['accessory', 'scroll'].includes(x.type),
        );
        return e ? { name: e.item.name, price: e.price, gold: s.runManager.gold } : null;
      });
      expect(entry, 'an affordable item').not.toBeNull();
      const row = shop
        .locator('.shop-row')
        .filter({ has: page.getByText(entry.name, { exact: true }) });
      await row.first().scrollIntoViewIfNeeded();
      await row.first().tap();
      const buy = shop.locator('.shop-commit button');
      await uprightStep(page, errors, buy);
      await buy.tap();
      const give = page.getByRole('dialog', { name: `Give ${entry.name} to`, exact: true });
      const confirmBuy = give.getByRole('button', { name: 'Confirm', exact: true });
      await uprightStep(page, errors, confirmBuy);
      await confirmBuy.tap();
      await expect
        .poll(() =>
          page.evaluate(() => window.__emblemRogueGame.scene.getScene('NodeMap').runManager.gold),
        )
        .toBe(entry.gold - entry.price);
      expect(await savedRunHolds(page, entry.name), `${entry.name} saved`).toBe(true);
      await shop.getByRole('button', { name: 'Leave', exact: true }).tap();
      await expect(shop).toHaveCount(0);

      // The battle after the shop opens upright and is saved as in progress.
      const after = await nextKnot(page, 'battle');
      expect(after?.type).toBe('battle');
      await travel(page, errors, after);
      await enterBattle(page, errors);
      const saved = await page.evaluate(
        () => JSON.parse(localStorage.getItem('emblem_rogue_slot_1_run'))?.battleInProgress?.nodeId,
      );
      expect(saved).toBe(after.id);
      await expectNoNewInvariantErrors(page);
      expect(errors).toEqual([]);
    });
  });
}

// A refresh (or a crash, or iOS closing the tab) mid-battle lands on the title. Resume
// Battle restores exactly the battle that was saved; Continue from Map is the
// sanctioned full revert. Portrait mode must not change either.
const UPRIGHT = PORTRAIT_PHONES[1];
const SIDEWAYS = { width: 844, height: 390 };

/** The title's Resume, then the suspended battle's choice. */
async function resumeFromTitle(page, errors, choice, { upright = true } = {}) {
  await page.goto('/');
  await waitForGame(page);
  await activeScene(page, 'Title');
  const resume = page.getByRole('button', { name: /^Resume · Act/ });
  if (upright) await uprightStep(page, errors, resume);
  await resume.tap();
  const pick = page.getByRole('button', { name: choice, exact: true });
  if (upright) await uprightStep(page, errors, pick);
  await pick.tap();
  if (choice === 'Resume Battle') {
    await activeScene(page, 'Battle');
    await battleIdle(page);
  } else await activeScene(page, 'NodeMap');
}

test.describe('refresh mid-battle, upright', () => {
  test.use(phone(UPRIGHT));

  test('Resume Battle restores the exact battle, upright', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = pageErrors(page);
    await quietSettings(page);
    await openDevBattle(page);
    expect((await battleSnapshot(page)).rotation).toBe('ccw');
    await moveAndWait(page, 'Edric');
    await moveAndWait(page, 'Sera');
    await endPlayerTurn(page);
    await moveAndWait(page, 'Edric');
    const before = await battleDomainState(page);

    await resumeFromTitle(page, errors, 'Resume Battle');
    const after = await battleDomainState(page);
    expect(after.domain).toEqual(before.domain);
    expect(await battleSnapshot(page)).toMatchObject({ rotation: 'ccw', state: 'PLAYER_IDLE' });
    await uprightStep(page, errors, battleRail(page).getByRole('button', { name: /^End turn/ }), {
      min: RAIL_MIN,
    });
    // And it plays on: Sera's move and the next enemy phase go through upright.
    await moveAndWait(page, 'Sera');
    await endPlayerTurn(page);
    expect(await battleSnapshot(page)).toMatchObject({ rotation: 'ccw', phase: 'player' });
    expect(errors).toEqual([]);
  });

  test('a refresh after turning the phone restores the same battle', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = pageErrors(page);
    await quietSettings(page);
    await openDevBattle(page);
    await moveAndWait(page, 'Edric');
    const before = await battleDomainState(page);
    // Sideways: the board re-opens from a save written for the switch.
    await turnPhone(page, SIDEWAYS, 'none');
    expect((await battleDomainState(page)).domain).toEqual(before.domain);

    // The refresh comes while the phone is sideways; it resumes sideways...
    await resumeFromTitle(page, errors, 'Resume Battle', { upright: false });
    expect((await battleSnapshot(page)).rotation).toBe('none');
    expect((await battleDomainState(page)).domain).toEqual(before.domain);
    // ...and turned upright again, the same battle stands on the turned board.
    await turnPhone(page, UPRIGHT, 'ccw');
    expect((await battleDomainState(page)).domain).toEqual(before.domain);
    await uprightStep(page, errors, battleRail(page).getByRole('button', { name: /^End turn/ }), {
      min: RAIL_MIN,
    });
  });

  test('Continue from Map reverts to the route, with the Vision spent in battle refunded', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const errors = pageErrors(page);
    await quietSettings(page);
    await openDevBattle(page);
    const entry = await page.evaluate(() => {
      const b = window.__emblemRogueGame.scene.getScene('Battle');
      const bip = b.runManager.battleInProgress;
      return {
        node: bip.nodeId,
        vision: bip.visionChargesAtEntry,
        gold: bip.entryBattleState.gold,
        rngSeed: bip.rngSeedAtEntry,
        start: b.playerUnits.map((u) => [u.name, u.col, u.row]),
      };
    });
    expect(entry.vision).toBeGreaterThan(0);
    // Spend a Vision charge through the upright Rewind, then act again.
    await moveAndWait(page, 'Edric');
    const rail = battleRail(page);
    await rail.getByRole('button', { name: 'Rewind', exact: true }).tap();
    const rewind = page.getByRole('dialog', { name: 'Rewind', exact: true });
    await expect(rewind).toBeVisible();
    await rewind.getByRole('option', { name: /^Start of turn 1/ }).tap();
    const spend = rewind.getByRole('button', { name: /^Rewind here/ });
    await uprightStep(page, errors, spend);
    await spend.tap();
    await expect(rewind).toHaveCount(0);
    await battleIdle(page);
    expect(
      await page.evaluate(
        () => window.__emblemRogueGame.scene.getScene('Battle').runManager.visionChargesRemaining,
      ),
    ).toBe(entry.vision - 1);
    await moveAndWait(page, 'Sera');

    await resumeFromTitle(page, errors, 'Continue from Map');
    await readyRoute(page);
    const run = await page.evaluate(async (node) => {
      const s = window.__emblemRogueGame.scene.getScene('NodeMap');
      const rm = s.runManager;
      const { loadRun } = await import('/src/engine/RunManager.js');
      const saved = loadRun(s.gameData, 1);
      return {
        vision: rm.visionChargesRemaining,
        gold: rm.gold,
        rngSeed: rm.rngSeed,
        inProgress: rm.battleInProgress,
        savedInProgress: saved.battleInProgress,
        savedVision: saved.visionChargesRemaining,
        available: rm.getAvailableNodes().some((n) => n.id === node),
        completed: rm.nodeMap.nodes.find((n) => n.id === node)?.completed === true,
      };
    }, entry.node);
    expect(run).toEqual({
      vision: entry.vision,
      gold: entry.gold,
      rngSeed: entry.rngSeed,
      inProgress: null,
      savedInProgress: null,
      savedVision: entry.vision,
      available: true,
      completed: false,
    });

    // The same battle again, from its start, upright.
    await travel(page, errors, { id: entry.node });
    await enterBattle(page, errors);
    const again = await page.evaluate(() => {
      const b = window.__emblemRogueGame.scene.getScene('Battle');
      return {
        turn: b.turnManager.turnNumber,
        start: b.playerUnits.map((u) => [u.name, u.col, u.row]),
        vision: b.runManager.visionChargesRemaining,
      };
    });
    expect(again).toEqual({ turn: 1, start: entry.start, vision: entry.vision });
    expect(errors).toEqual([]);
  });
});

test.describe('refresh mid-battle, landscape phone', () => {
  test.use(phone(SIDEWAYS));

  test('Resume Battle in landscape is unchanged by portrait mode', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = pageErrors(page);
    await quietSettings(page);
    await openDevBattle(page);
    await moveAndWait(page, 'Edric');
    const before = await battleDomainState(page);
    await resumeFromTitle(page, errors, 'Resume Battle', { upright: false });
    const after = await battleDomainState(page);
    expect(after.domain).toEqual(before.domain);
    const page_ = await page.evaluate(() => ({
      rotation: window.__emblemRogueGame.scene.getScene('Battle').grid.board.rotation,
      portraitUi: document.documentElement.classList.contains('portrait-ui'),
      upright: document.documentElement.classList.contains('portrait-battle'),
      canvasWide: (() => {
        const b = window.__emblemRogueGame.scene.getScene('Battle');
        return b.scale.width > b.scale.height;
      })(),
      prompt: getComputedStyle(document.getElementById('rotate-prompt')).display,
    }));
    expect(page_).toEqual({
      rotation: 'none',
      portraitUi: false,
      upright: false,
      canvasWide: true,
      prompt: 'none',
    });
    await expectNoSidewaysScroll(page);
    expect(errors).toEqual([]);
  });
});

// The tutorial and dev routes without a slot have no run save to re-open from: the
// board keeps the orientation it started in, the layout still follows the phone, and
// a note says so. Nothing is restarted and the battle stays playable.
async function markScene(page) {
  await page.evaluate(() => {
    window.__battleSceneMark = window.__emblemRogueGame.scene.getScene('Battle').grid;
  });
}
const sameScene = (page) =>
  page.evaluate(
    () => window.__battleSceneMark === window.__emblemRogueGame.scene.getScene('Battle').grid,
  );

/** The note shows, over the map: clear of the rail and the tutorial guide's buttons. */
async function expectKeepsBoard(page, { tutorial = false } = {}) {
  const notice = page.locator('.portrait-battle-notice');
  await expect(notice).toHaveText('The board keeps its orientation for this battle.');
  // The guide steps aside while the layout turns, then docks over the map again.
  if (tutorial) await expect(page.getByRole('region', { name: 'Tutorial guide' })).toBeVisible();
  await expect(notice).toBeVisible();
  // The guide re-docks over a few frames as the layout turns; the note follows it.
  const covered = () =>
    page.evaluate(() => {
      const note = document.querySelector('.portrait-battle-notice')?.getBoundingClientRect();
      if (!note) return null; // gone before it cleared them: not a pass
      return [...document.querySelectorAll('.re-coach:not([hidden]) button, .mobile-battle-hud')]
        .filter((b) => {
          const r = b.getBoundingClientRect();
          return (
            r.width > 0 &&
            r.left < note.right &&
            r.right > note.left &&
            r.top < note.bottom &&
            r.bottom > note.top
          );
        })
        .map((b) => b.getAttribute('aria-label') || b.textContent.trim().slice(0, 20));
    });
  await expect.poll(covered, { message: 'under the note' }).toEqual([]);
}

async function openTutorial(page, errors) {
  await page.goto('/');
  await waitForGame(page);
  await activeScene(page, 'Title');
  await page.getByRole('button', { name: /^Tutorial/ }).tap();
  await activeScene(page, 'Battle');
  await battleIdle(page);
  await expect(page.getByRole('region', { name: 'Tutorial guide' })).toBeVisible();
  expect(errors).toEqual([]);
}

test.describe('battles without a run save, upright start', () => {
  test.use(phone(UPRIGHT));

  test('the tutorial keeps its turned board when the phone turns, and stays playable', async ({
    page,
  }) => {
    const errors = pageErrors(page);
    await quietSettings(page);
    await openTutorial(page, errors);
    expect((await battleSnapshot(page)).rotation).toBe('ccw');
    await markScene(page);

    await page.setViewportSize(SIDEWAYS);
    await expectKeepsBoard(page, { tutorial: true });
    expect(await sameScene(page)).toBe(true);
    expect(await battleSnapshot(page)).toMatchObject({ rotation: 'ccw', state: 'PLAYER_IDLE' });
    // The guide's first step works sideways on the turned board: tap Edric.
    const edric = await page.evaluate(() => {
      const u = window.__emblemRogueGame.scene
        .getScene('Battle')
        .playerUnits.find((x) => x.name === 'Edric');
      return [u.col, u.row];
    });
    await tapTile(page, ...edric);
    await expect
      .poll(() =>
        page.evaluate(
          () => window.__emblemRogueGame.scene.getScene('Battle').selectedUnit?.name ?? null,
        ),
      )
      .toBe('Edric');
    await expectNoSidewaysScroll(page);

    // Upright again: the same scene, the same turned board.
    await page.setViewportSize(UPRIGHT);
    await expectPortraitUi(page);
    expect(await sameScene(page)).toBe(true);
    expect((await battleSnapshot(page)).rotation).toBe('ccw');
    expect(errors).toEqual([]);
  });

  test('a battle without a save slot keeps its board and never tries to save', async ({ page }) => {
    // Boots a battle: give it the slow-runner budget (CI runners are slower).
    test.slow();
    const errors = pageErrors(page);
    await quietSettings(page);
    await openDevBattle(page, { slot: null });
    const index = () =>
      page.evaluate(
        () =>
          window.__emblemRogueGame.scene.getScene('Battle').runManager.battleInProgress?.checkpoint
            ?.checkpointIndex ?? null,
      );
    const saves = await index();
    await markScene(page);
    await page.setViewportSize(SIDEWAYS);
    await expectKeepsBoard(page);
    await page.setViewportSize(UPRIGHT);
    await page.setViewportSize(SIDEWAYS);
    await moveAndWait(page, 'Edric');
    expect(await sameScene(page)).toBe(true);
    expect((await battleSnapshot(page)).rotation).toBe('ccw');
    // One save for Edric's action (in memory), none for the turns of the phone.
    expect(await index()).toBe((saves ?? 0) + 1);
    expect(errors).toEqual([]);
  });
});

test.describe('battles without a run save, landscape start', () => {
  test.use(phone(SIDEWAYS));

  test('the tutorial begun sideways keeps its board upright; no rotate prompt', async ({
    page,
  }) => {
    const errors = pageErrors(page);
    await quietSettings(page);
    await openTutorial(page, errors);
    expect((await battleSnapshot(page)).rotation).toBe('none');
    await markScene(page);
    await page.setViewportSize(UPRIGHT);
    await expectKeepsBoard(page, { tutorial: true });
    await expectPortraitUi(page);
    expect(await sameScene(page)).toBe(true);
    expect(await battleSnapshot(page)).toMatchObject({ rotation: 'none', state: 'PLAYER_IDLE' });
    await expectNoSidewaysScroll(page);
    await expectTappable(page.getByRole('button', { name: 'Leave tutorial', exact: true }));
    expect(errors).toEqual([]);
  });
});
