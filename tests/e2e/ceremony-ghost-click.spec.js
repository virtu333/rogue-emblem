// The tap that skips a ceremony must not also press what the skip reveals.
//
// A ceremony (the promotion rite, the "joins your army" card) dismisses on
// pointerdown; the screen underneath is rebuilt before the finger lifts, and the
// click that follows the lift used to land on it. Two real cases from playtests,
// both with real touch input:
//   1. a church promotion rite tapped over the church's Leave button: the click
//      left the church, completing the node, and the run went back to the route map;
//   2. the boss recruit's "joins your army" card tapped over the rewards screen's
//      View map button: the click left the pending reward for the Act 2 route map.
// Each waits on game state (never on time): the tap is held until the ceremony is
// gone, released, and the page's own click log says when the click has happened.
import { test, expect } from '@playwright/test';
import {
  PORTRAIT_PHONES,
  attachSlot,
  pageErrors,
  phone,
  quietSettings,
} from './portraitHelpers.js';
import { waitForScene } from './helpers.js';

test.setTimeout(150_000);
const { defaultBrowserType: _browser, ...use } = phone(PORTRAIT_PHONES[1]);
test.use(use);

/** Log the pointer and click events at document capture (before any handler runs). */
async function logInput(page) {
  await page.evaluate(() => {
    window.__input = [];
    for (const type of ['pointerdown', 'pointerup', 'click'])
      document.addEventListener(type, () => window.__input.push(type), true);
  });
}

const frames = (page, n = 2) =>
  page.evaluate(
    (n) =>
      new Promise((resolve) => {
        const step = (left) => (left ? requestAnimationFrame(() => step(left - 1)) : resolve());
        step(n);
      }),
    n,
  );

/**
 * A real touch at (x, y): pressed, held until `whilePressed` says the screen under
 * the finger has changed, then lifted. Resolves once the browser has dispatched the
 * click that follows the lift and every handler for it has run.
 */
async function touchThrough(page, { x, y }, whilePressed) {
  const cdp = await page.context().newCDPSession(page);
  await logInput(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await whilePressed();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForFunction(() => window.__input.includes('click'));
  await frames(page);
  await cdp.detach();
}

const center = (box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
const inside = (box, { x, y }) =>
  x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height;

test('a promotion rite tapped over the church Leave button leaves the church open', async ({
  page,
}) => {
  const errors = pageErrors(page);
  await quietSettings(page, { battleSpeed: 'fast' });
  await page.goto('/?devScene=nodemap&preset=battle_smoke&seed=42');
  await waitForScene(page, 'NodeMap');
  await page.getByRole('button', { name: 'Skip conversation', exact: true }).tap();
  await expect(page.locator('.re-node-map')).toBeVisible();
  const nodeId = await page.evaluate(async () => {
    const s = window.__emblemRogueGame.scene.getScene('NodeMap');
    s.registry.set('activeSlot', 1);
    const run = s.runManager;
    run.gold = 10000;
    const { createUnit } = await import('/src/engine/UnitManager.js');
    const fighter = s.gameData.classes.find((c) => c.name === 'Fighter');
    run.roster.push(createUnit(fighter, 10, s.gameData.weapons, { name: 'Probe' }));
    const node = run.getAvailableNodes()[0];
    node.type = 'church';
    s.onNodeClick(node);
    return node.id;
  });
  const church = page.getByRole('dialog', { name: 'Church', exact: true });
  await expect(church).toBeVisible();
  const leave = church.getByRole('button', { name: 'Leave', exact: true });
  const leaveAt = center(await leave.boundingBox());

  await church.getByRole('button', { name: /^Probe · Fighter/ }).tap();
  const chooser = page.getByRole('dialog', { name: 'Promote Probe', exact: true });
  await chooser.getByRole('button', { name: /^Promote to / }).tap();
  const rite = page.getByRole('dialog', { name: 'Promotion', exact: true });
  // The rite has played out (its Continue is showing) and the next tap dismisses it.
  await expect(rite.getByRole('button', { name: 'Continue', exact: true })).toBeVisible();
  // The finger must be over the rite, not over its own Continue.
  expect(inside(await rite.getByRole('button', { name: 'Continue' }).boundingBox(), leaveAt)).toBe(
    false,
  );

  await touchThrough(page, leaveAt, () =>
    expect(page.getByRole('dialog', { name: 'Promotion', exact: true })).toHaveCount(0),
  );

  // The promotion happened; the tap that ended the rite did nothing else.
  const after = await page.evaluate((id) => {
    const s = window.__emblemRogueGame.scene.getScene('NodeMap');
    const probe = s.runManager.roster.find((u) => u.name === 'Probe');
    const node = s.runManager.nodeMap.nodes
      ? s.runManager.nodeMap.nodes.find((n) => n.id === id)
      : null;
    return {
      className: probe?.className,
      nodeCompleted: node ? Boolean(node.completed) : null,
      dialogs: [...document.querySelectorAll('[role=dialog]')].map((d) => d.ariaLabel),
    };
  }, nodeId);
  expect(after.className).not.toBe('Fighter');
  expect(after.nodeCompleted).toBe(false);
  await expect(church).toBeVisible();
  expect(after.dialogs.filter((name) => /^Promote /.test(name || ''))).toEqual([]);
  expect(await page.evaluate(() => window.__sceneState?.activeScene)).toBe('NodeMap');
  expect(errors).toEqual([]);
});

const tapMiddle = (page) => page.touchscreen.tap(195, 420);

/**
 * The late-act boss battle, won like a player: the boss card and lines cleared, the
 * victory band skipped, the story and deed cards tapped away, up to the boss recruit
 * draft. Returns the army's size before the recruit and what the victory save held.
 */
async function winBossBattleToDraft(page) {
  await quietSettings(page, { battleSpeed: 'fast' });
  await page.goto('/?devScene=battle&preset=late_act&devNode=boss&seed=7&mobilePreview=1');
  await page.waitForFunction(() => window.__sceneState?.battle?.state === 'PLAYER_IDLE', null, {
    timeout: 90_000,
  });
  await attachSlot(page);
  const continueButton = page.getByRole('button', { name: 'Continue', exact: true });
  // Whatever card or line is up: tap it away, like a player.
  const dismiss = async () => {
    if (await continueButton.count()) await continueButton.first().tap();
    else await tapMiddle(page);
    await frames(page, 6);
  };
  while (await page.locator('.ce-layer').count()) await dismiss();

  const armyBefore = await page.evaluate(
    () => window.__emblemRogueGame.scene.getScene('Battle').runManager.roster.length,
  );
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    for (const e of s.enemyUnits) e.currentHP = 0;
    s.onVictory();
  });
  await page.waitForSelector('.ce-band-layer--victory');
  // What the victory save already holds, while the band is still up.
  const savedAtVictory = await page.evaluate(() => {
    const run = JSON.parse(localStorage.getItem('emblem_rogue_slot_1_run'));
    return {
      offered: run.pendingBossRecruit?.candidates?.length ?? 0,
      rewardOwed: Boolean(run.pendingBattleReward),
    };
  });
  await tapMiddle(page); // the victory band skips on a tap
  const draft = page.getByRole('dialog', { name: 'Boss recruit', exact: true });
  while (!(await draft.isVisible())) await dismiss();
  return { armyBefore, savedAtVictory };
}

test('the boss recruit join card tapped over View map stays on the rewards', async ({ page }) => {
  const errors = pageErrors(page);
  const { armyBefore } = await winBossBattleToDraft(page);
  await page
    .getByRole('dialog', { name: 'Boss recruit', exact: true })
    .getByRole('button', { name: 'Recruit', exact: true })
    .tap();

  const join = page.locator('.gr-join-layer');
  await expect(join).toBeVisible();
  // A card ignores presses for its first 180 ms; wait that out on the page's own clock.
  const shownAt = await page.evaluate(() => performance.now());
  await page.waitForFunction((t) => performance.now() - t > 600, shownAt);

  // The rewards screen is built under the finger; View map sits where it always does
  // on this phone, and the check below fails loudly if the layout ever moves it.
  const viewMapAt = { x: 319, y: 309 };
  const rewards = page.getByRole('dialog', { name: 'Battle rewards', exact: true });
  await touchThrough(page, viewMapAt, () => expect(rewards).toBeVisible());

  const state = await page.evaluate(() => {
    const battle = window.__emblemRogueGame.scene.getScene('Battle');
    return {
      scene: window.__sceneState?.activeScene,
      rewardPending: Boolean(battle.runManager.pendingBattleReward),
      army: battle.runManager.roster.length,
    };
  });
  expect(state).toMatchObject({ scene: 'Battle', rewardPending: true });
  expect(state.army).toBe(armyBefore + 1); // the boss recruit did join
  await expect(rewards).toBeVisible();
  const viewMap = await rewards
    .getByRole('button', { name: 'View map', exact: true })
    .boundingBox();
  expect(inside(viewMap, viewMapAt)).toBe(true); // the finger really was over View map
  expect(errors).toEqual([]);
});

test('a reload before choosing the boss recruit offers the same draft, once', async ({ page }) => {
  const errors = pageErrors(page);
  const { armyBefore, savedAtVictory } = await winBossBattleToDraft(page);
  // The draft is rolled and saved with the reward, before the band, story and deed cards.
  expect(savedAtVictory.rewardOwed).toBe(true);
  expect(savedAtVictory.offered).toBeGreaterThan(0);
  const draft = page.getByRole('dialog', { name: 'Boss recruit', exact: true });
  const offered = await draft
    .locator('.ch-card')
    .evaluateAll((cards) => cards.map((card) => card.getAttribute('aria-label')));
  expect(offered.length).toBeGreaterThan(0);

  // Close the game before choosing, and come back through the slot.
  await page.evaluate(() => history.replaceState(null, '', '/'));
  await page.reload();
  await waitForScene(page, 'Title');
  const slots = page.getByRole('button', { name: 'Save Slots', exact: true });
  await expect(slots).toBeEnabled();
  await slots.tap();
  await waitForScene(page, 'SlotPicker');
  await page.getByRole('button', { name: 'Select Slot 1', exact: true }).tap();
  await waitForScene(page, 'NodeMap');
  await page.getByRole('button', { name: 'Skip conversation', exact: true }).tap();
  await expect(page.locator('.re-node-map')).toBeVisible();

  // The reward is still owed, and the recruit comes before it: the same candidates.
  await page.evaluate(() =>
    window.__emblemRogueGame.scene.getScene('NodeMap').openPendingRewards(),
  );
  await expect(draft).toBeVisible();
  expect(
    await draft
      .locator('.ch-card')
      .evaluateAll((cards) => cards.map((card) => card.getAttribute('aria-label'))),
  ).toEqual(offered);

  await draft.getByRole('button', { name: 'Recruit', exact: true }).tap();
  const rewards = page.getByRole('dialog', { name: 'Battle rewards', exact: true });
  // The join card leaves by itself or on a tap; the rewards follow it.
  await expect(rewards).toBeVisible({ timeout: 20_000 });
  const saved = await page.evaluate(() => {
    const run = JSON.parse(localStorage.getItem('emblem_rogue_slot_1_run'));
    return {
      army: run.roster.length,
      offer: run.pendingBossRecruit,
      reward: run.pendingBattleReward,
    };
  });
  expect(saved.army).toBe(armyBefore + 1); // saved with the recruit in it
  expect(saved.offer).toBeNull(); // and the draft gone
  expect(saved.reward).not.toBeNull(); // the rewards still owed
  expect(errors).toEqual([]);
});
