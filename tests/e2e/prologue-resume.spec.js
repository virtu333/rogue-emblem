// Refreshes in the middle of the prologue's teaching, reached through ordinary play
// (docs/specs/prologue-chapter.md §9, "Persistence"): P2's reward screen (the reward is
// offered again and paid once), P3's opening note while it is on screen, the action
// after Sera's join, the turn the Vision charge is granted, and P4's seize/par note
// before it is read. Each time Resume Battle brings back the unfinished teaching, once, and nothing
// is paid or taught twice (hint ids, the Vision grant, the gold).
import { test, expect } from '@playwright/test';
import { bootDesktop, driver, activeScene, slotMeta, slotRun } from './prologueDriver.js';
import {
  startPrologue,
  playP1,
  toRoute,
  forkStop,
  enterP3,
  fightOut,
  watchtower,
  travel,
  P3_ORDER,
  p3Opts,
} from './prologueJourney.js';

test.setTimeout(900_000);

/** Reload the page and take the title's Resume, then Resume Battle when it asks. */
async function refreshAndResume(d, { battle = true } = {}) {
  const { page } = d;
  await page.reload();
  await activeScene(page, 'Title');
  await d.click(page.getByRole('button', { name: 'Resume · Prologue', exact: true }));
  if (battle) {
    await d.click(page.getByRole('button', { name: 'Resume Battle', exact: true }));
    await activeScene(page, 'Battle');
  }
}

/** The run's saved checkpoint holds this unread note as pending teaching. */
async function pendingSaved(page, text) {
  await page.waitForFunction((text) => {
    const run = JSON.parse(localStorage.getItem('emblem_rogue_slot_1_run') || 'null');
    const pending = run?.battleInProgress?.checkpoint?.prologueState?.pending || [];
    return pending.some((p) => String(p.text || '').includes(text));
  }, text);
}

const noteShown = (page, text) =>
  page.getByRole('dialog', { name: 'Field notes', exact: true }).filter({ hasText: text });

const seenHints = async (page) => (await slotMeta(page))?.hintState?.seen || [];

test('refreshes mid-teaching: the reward, P3 notes, the Vision grant, P4 before its first note', async ({
  browser,
}) => {
  const { context, page, errors } = await bootDesktop(browser);
  const d = driver(page);
  await startPrologue(d);
  await playP1(d);
  await toRoute(d);

  // P2 won, its reward screen open: a refresh offers the reward again, paid once.
  await travel(d, 'prologue_1');
  await activeScene(page, 'Battle');
  await d.idle();
  await d.act('Gaspar', { targets: ['a'], noKill: 'hits' });
  await d.act('Edric', { targets: ['a'] });
  await fightOut(d, ['Gaspar', 'Edric']);
  await d.dialog('Battle rewards');
  const goldBefore = (await slotRun(page)).gold;
  await refreshAndResume(d, { battle: false });
  // Back on the route map with the reward unclaimed: the map says so and its main
  // button returns to the rewards (travel waits until they are chosen).
  await toRoute(d);
  const route = page.locator('.re-node-map');
  await expect(route.locator('.re-loom-card')).toContainText(
    'Choose your remaining battle rewards',
  );
  await d.click(route.getByRole('button', { name: 'Return to rewards', exact: true }));
  const rewards = await d.dialog('Battle rewards');
  await d.click(rewards.getByRole('button', { name: /^150 gold/ }));
  await d.click(rewards.getByRole('button', { name: 'Choose reward', exact: true }));
  await toRoute(d);
  expect((await slotRun(page)).gold).toBe(goldBefore + 150);
  expect((await slotRun(page)).pendingBattleReward ?? null).toBeNull();

  await forkStop(d, 'market');
  await enterP3(d, { idle: false });

  // P3's opening note on screen, unread: a refresh brings it back, once.
  await d.drain(() => false, null, {
    stopAt: (top) => top.name === 'Field notes' && top.text.includes('can join you'),
  });
  await pendingSaved(page, 'can join you');
  await refreshAndResume(d);
  await expect(noteShown(page, 'can join you')).toBeVisible();
  await d.idle();
  // The opening lines were read before the refresh: they never replay.
  expect(d.lines().filter((l) => l.includes('A robed woman on the road'))).toHaveLength(1);
  expect(d.notes().filter((n) => n.includes('can join you'))).toHaveLength(1);
  expect((await seenHints(page)).filter((h) => h === 'guide_recruit_on_map')).toHaveLength(1);

  // Edric Talks: Sera joins. A refresh right after keeps her in the army, her card
  // and her lines never replay, and her join is not offered again.
  await d.talk('Edric', { col: 3, row: 2 });
  await page.waitForFunction(() => {
    const run = JSON.parse(localStorage.getItem('emblem_rogue_slot_1_run') || 'null');
    const cp = run?.battleInProgress?.checkpoint;
    return (cp?.playerUnits || []).some((u) => u.name === 'Sera') && !(cp?.npcUnits || []).length;
  });
  await refreshAndResume(d);
  await d.idle();
  expect(d.log.filter((e) => e.name === 'Sera joins your army')).toHaveLength(1);
  const after = await page.evaluate(() => {
    const b = window.__emblemRogueGame.scene.getScene('Battle');
    return {
      players: b.playerUnits.map((u) => u.name),
      npcs: (b.npcUnits || []).map((u) => u.name),
      edricActed: b.playerUnits.find((u) => u.name === 'Edric').hasActed === true,
    };
  });
  expect(after).toEqual({
    players: ['Edric', 'Gaspar', 'Tamsin', 'Sera'],
    npcs: [],
    edricActed: true,
  });
  await d.support('Sera', { below: 1, fallback: { caution: 2 } });

  // The rest of turn 1, then turn 2: the Vision charge is granted once, across a refresh.
  await d.act('Gaspar');
  await d.act('Tamsin', { caution: 2 });
  await d.nextTurn(1);
  const charges = () =>
    page.evaluate(() => window.__emblemRogueGame.scene.getScene('Battle').runManager.visionChargesRemaining); // prettier-ignore
  const granted = await charges();
  expect(granted).toBe(1);
  expect((await slotRun(page)).prologueVisionGranted).toBe(true);
  await refreshAndResume(d);
  await d.idle();
  expect(await charges()).toBe(granted);
  await fightOut(d, P3_ORDER, p3Opts);
  await toRoute(d);
  expect((await slotRun(page)).visionChargesRemaining).toBeLessThanOrEqual(1);
  const hints = await seenHints(page);
  expect(new Set(hints).size).toBe(hints.length);

  // P4: deployed and formed, its seize/par note up and unread: a refresh brings it back.
  await watchtower(d);
  await travel(d, 'prologue_5');
  await activeScene(page, 'Battle');
  const deploy = await d.dialog('Deploy units');
  await d.click(deploy.getByRole('button', { name: 'Deploy', exact: true }));
  await d.drain(
    () =>
      Boolean(document.querySelector('[aria-label="Formation"]')) &&
      ![...document.querySelectorAll('[role="dialog"]')].some((e) => e.getClientRects().length),
  );
  const formation = page.getByRole('region', { name: 'Formation', exact: true });
  await d.click(formation.getByRole('button', { name: 'Auto-place', exact: true }));
  await d.click(formation.getByRole('button', { name: 'Start battle', exact: true }));
  await d.drain(() => false, null, {
    stopAt: (top) => top.name === 'Field notes' && top.text.includes('Seize: defeat Captain Varro'),
  });
  await pendingSaved(page, 'Seize: defeat Captain Varro');
  await refreshAndResume(d);
  await expect(noteShown(page, 'Seize: defeat Captain Varro')).toBeVisible();
  await d.idle();
  expect(d.notes().filter((n) => n.includes('Seize: defeat Captain Varro'))).toHaveLength(1);
  expect(d.notes().filter((n) => n.includes('Your commander always deploys'))).toHaveLength(1);
  expect(d.lines().filter((l) => l.includes('There is no border.'))).toHaveLength(1);
  expect(await page.locator('[aria-label="Formation"]').count()).toBe(0);
  const p4 = await page.evaluate(() => {
    const b = window.__emblemRogueGame.scene.getScene('Battle');
    return { chapter: b.battleParams.prologueChapter, units: b.playerUnits.length, turn: b.turnManager.turnNumber }; // prettier-ignore
  });
  expect(p4).toEqual({ chapter: 'p4_quarry_gate', units: 3, turn: 1 });
  const p4Hints = await seenHints(page);
  expect(new Set(p4Hints).size).toBe(p4Hints.length);
  expect(errors).toEqual([]);
  await context.close();
});
