// The prologue run (docs/specs/prologue-chapter.md §4, §9): a fresh slot is offered the
// prologue on New Game; Play opens P1 at once as a run in prologue mode (the route map
// stays hidden); P1's win brings Gaspar in on the prologue's own route map; P2 opens
// with the old hands; P2's win pays its authored loot, plays the ending and lands in
// Home Base with the grant, whose Begin Run takes the first-run fast path. Skip takes
// today's fast path. A refresh mid-chapter resumes the chapter or re-opens it from the
// map. Every wait is on state, never on time.
import { test, expect } from '@playwright/test';
import { waitForScene as waitForSceneQuick } from './helpers.js';

test.setTimeout(300000);

async function waitForScene(page, key) {
  try {
    await waitForSceneQuick(page, key);
  } catch {
    await page.waitForFunction((k) => window.__sceneState?.activeScene === k, key, {
      timeout: 60000,
    });
  }
}

async function boot(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() =>
    localStorage.setItem(
      'emblem_rogue_settings',
      JSON.stringify({ musicVolume: 0, sfxVolume: 0, reduceMotion: true }),
    ),
  );
  await page.goto('/');
  await waitForScene(page, 'Title');
  return { context, page, errors };
}

const battle = (page) =>
  page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    return {
      mode: s.runManager?.mode || null,
      chapter: s.battleParams?.prologueChapter || null,
      nodeId: s.nodeId || null,
      turnPar: s.turnPar,
      units: s.playerUnits.map((u) => u.name),
      transitions: (window.__sceneState?.transitionAudits || []).map((a) => a.to),
    };
  });

async function prologueIdle(page) {
  await page.waitForFunction(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    return s.battleState === 'PLAYER_IDLE' && Boolean(s._prologue) && s.playerUnits.length > 0;
  });
}

const slotRun = (page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('emblem_rogue_slot_1_run') || 'null'));
const slotMeta = (page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('emblem_rogue_slot_1_meta') || 'null'));

async function waitForSuspendSave(page) {
  await page.waitForFunction(() => {
    const run = JSON.parse(localStorage.getItem('emblem_rogue_slot_1_run') || 'null');
    return Boolean(run?.battleInProgress) && run.mode === 'prologue';
  });
}

/** The route map's first-visit note (a modal on arrival) is read before anything else. */
async function dismissRouteNote(page) {
  const note = page.getByRole('dialog', { name: 'Field notes', exact: true });
  await expect(note).toContainText('Tap any node to preview it');
  await note.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(note).toHaveCount(0);
  await expect(page.locator('.re-node-map')).toBeVisible();
}

async function readLine(page, speaker, text) {
  const line = page.getByRole('dialog', { name: speaker, exact: true });
  await expect(line).toContainText(text);
  await line.getByRole('button', { name: 'Continue', exact: true }).click();
}

test('New Game offers the prologue; Play opens P1 as a run, P1 joins Gaspar on the route, P2 ends in Home Base with the grant', async ({
  browser,
}) => {
  const { context, page, errors } = await boot(browser);
  await page.getByRole('button', { name: 'New Game', exact: true }).click();
  const play = page.getByRole('button', { name: /^Play the Prologue/ });
  await expect(play).toBeVisible();
  await expect(play).toHaveText('Play the Prologue · about 20 minutes');
  await expect(play).toHaveClass(/re-btn--primary/);
  await expect(page.getByRole('button', { name: 'Skip to the first run', exact: true })).toBeVisible(); // prettier-ignore
  await play.click();
  await waitForScene(page, 'Battle');
  await prologueIdle(page);
  // P1 as a run in prologue mode: no par, the route map never drawn first.
  const p1 = await battle(page);
  expect(p1).toMatchObject({ mode: 'prologue', chapter: 'p1_banner_at_dawn', turnPar: null });
  expect(p1.nodeId).toBe('prologue_0');
  expect(p1.transitions).not.toContain('NodeMap');
  await expect(page.getByRole('region', { name: 'Prologue guide', exact: true })).toBeVisible();
  expect((await slotMeta(page))?.prologue?.state).toBe('in_progress');
  expect((await slotMeta(page))?.runsStarted ?? 0).toBe(0);
  await waitForSuspendSave(page);

  // P1 won: Gaspar's lines, no handoff; the route map opens with him in the army.
  await page.evaluate(() => window.__emblemRogueGame.scene.getScene('Battle').onVictory());
  await readLine(page, 'Edric', 'You swore you were done with saddles.');
  await readLine(page, 'Gaspar', 'The saddle was not consulted.');
  await waitForScene(page, 'NodeMap');
  await dismissRouteNote(page);
  const route = page.locator('.re-node-map');
  await expect(page.locator('.re-loom-title')).toContainText('Prologue');
  await expect(page.locator('.re-loom-title')).toContainText('The Quarry Road');
  const afterP1 = await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('NodeMap');
    return {
      roster: s.runManager.roster.map((u) => u.name),
      mode: s.runManager.mode,
      shown: s.runManager.hasShownDialogue('runStart'),
      live: [...document.querySelectorAll('.re-node.is-live')].map((n) => n.dataset.node),
    };
  });
  expect(afterP1).toEqual({
    roster: ['Edric', 'Gaspar'],
    mode: 'prologue',
    shown: true,
    live: ['prologue_1'],
  });
  expect((await slotMeta(page))?.prologue?.chaptersCompleted).toEqual(['p1_banner_at_dawn']);
  // No cold open on the prologue's road.
  expect(await page.getByRole('dialog', { name: 'Sera', exact: true }).count()).toBe(0);

  // P2: the old hands.
  await route.locator('.re-node.is-live').first().click();
  await expect(route.locator('.re-loom-card')).toContainText('Old Hands');
  await route.getByRole('button', { name: 'Travel', exact: true }).click();
  await waitForScene(page, 'Battle');
  await readLine(page, 'Gaspar', 'I will ride ahead.');
  await readLine(page, 'Edric', 'Then I watch.');
  await readLine(page, 'Gaspar', 'I leave the opening.');
  await prologueIdle(page);
  const p2 = await battle(page);
  expect(p2).toMatchObject({ mode: 'prologue', chapter: 'p2_old_hands', turnPar: null });
  expect(p2.units).toEqual(['Edric', 'Gaspar']);
  // The pause menu of the prologue run: skip the rest, never Abandon Run.
  await page.keyboard.press('Escape');
  const pause = page.getByRole('dialog', { name: 'Paused', exact: true });
  await expect(pause.getByRole('button', { name: 'Skip Prologue', exact: true })).toBeVisible();
  await expect(pause.getByRole('button', { name: 'Abandon Run', exact: true })).toHaveCount(0);
  await expect(
    pause.getByRole('button', { name: 'Save & Return to Title', exact: true }),
  ).toBeVisible();
  await pause.getByRole('button', { name: 'Resume', exact: true }).click();

  // P2 won: the victory lines, the loot lesson, the authored rewards, the ending.
  await page.evaluate(() => window.__emblemRogueGame.scene.getScene('Battle').onVictory());
  await readLine(page, 'Gaspar', 'The ford is ours.');
  await readLine(page, 'Edric', 'Then we ride for it.');
  const note = page.getByRole('dialog', { name: 'Field notes', exact: true });
  await expect(note).toContainText('Victory pays');
  await note.getByRole('button', { name: 'Continue', exact: true }).click();
  const rewards = page.getByRole('dialog', { name: 'Battle rewards', exact: true });
  await expect(rewards).toBeVisible();
  const offered = await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    return s.runManager.pendingBattleReward.choices.map((c) =>
      c.type === 'gold' ? `gold:${c.goldAmount}` : c.item?.name,
    );
  });
  expect(offered.sort()).toEqual(['Iron Lance', 'Vulnerary', 'gold:150'].sort());
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const index = s.runManager.pendingBattleReward.choices.findIndex((c) => c.type === 'gold');
    s._lootController.activateReward(index);
  });
  const teamXp = page.getByRole('dialog', { name: 'Team XP', exact: true });
  if (await teamXp.isVisible().catch(() => false))
    await teamXp.getByRole('button', { name: 'Continue', exact: true }).click();
  // The ending: four unnamed lines, the title card, then Home Base.
  const ending = page.getByRole('dialog', { name: '???', exact: true });
  await expect(ending).toBeVisible();
  for (let i = 0; i < 4; i++) {
    await expect(ending).toBeVisible();
    await ending.getByRole('button', { name: 'Continue', exact: true }).click();
  }
  await expect(note).toContainText('Every run is a thread');
  await note.getByRole('button', { name: 'Continue', exact: true }).click();
  await waitForScene(page, 'HomeBase');
  const meta = await slotMeta(page);
  expect(meta.prologue).toMatchObject({
    state: 'complete',
    grantPaid: true,
    chaptersCompleted: ['p1_banner_at_dawn', 'p2_old_hands'],
  });
  expect(meta.totalValor).toBe(60);
  expect(meta.totalSupply).toBe(40);
  expect(meta.runsStarted).toBe(0);
  expect(await slotRun(page)).toBeNull();
  await expect(page.locator('.mh-onboarding')).toContainText('This is what persists.');
  // The grant is spendable currency: Upgrades shows both balances.
  await page.getByRole('button', { name: 'Upgrades', exact: true }).click();
  await expect(page.locator('.mu-currency', { hasText: 'Valor 60' })).toBeVisible();
  await expect(page.locator('.mu-currency', { hasText: 'Supply 40' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Begin Run', exact: true })).toBeVisible();
  // Begin Run: the first real run takes the fast path, with the prologue's route note.
  await page.getByRole('button', { name: 'Begin Run', exact: true }).click();
  await waitForScene(page, 'NodeMap');
  const firstRun = await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('NodeMap');
    return {
      mode: s.runManager.mode,
      difficulty: s.runManager.difficultyId,
      blessings: s.runManager.activeBlessings,
      transitions: (window.__sceneState?.transitionAudits || []).map((a) => a.to),
    };
  });
  expect(firstRun.mode).toBe('standard');
  expect(firstRun.difficulty).toBe('normal');
  expect(firstRun.blessings).toEqual([]);
  expect(firstRun.transitions).not.toContain('DifficultySelect');
  expect((await slotMeta(page)).runsStarted).toBe(1);
  // The cold open knows the prologue: Sera's post-prologue line, no Gaspar introduction.
  await expect(page.getByRole('dialog', { name: 'Sera', exact: true })).toContainText(
    'I know this road now.',
  );
  expect(errors).toEqual([]);
  await context.close();
});

test('Skip to the first run takes the fast path and remembers the skip', async ({ browser }) => {
  const { context, page, errors } = await boot(browser);
  await page.getByRole('button', { name: 'New Game', exact: true }).click();
  await page.getByRole('button', { name: 'Skip to the first run', exact: true }).click();
  await waitForScene(page, 'NodeMap');
  const meta = await slotMeta(page);
  expect(meta.prologue.state).toBe('skipped');
  expect(meta.runsStarted).toBe(1);
  expect(
    await page.evaluate(() => window.__emblemRogueGame.scene.getScene('NodeMap').runManager.mode),
  ).toBe('standard');
  expect(errors).toEqual([]);
  await context.close();
});

test('a refresh mid-P1 offers Resume Battle (the chapter as left) and Continue from Map (the chapter re-opened)', async ({
  browser,
}) => {
  const { context, page, errors } = await boot(browser);
  await page.getByRole('button', { name: /^Prologue/ }).click(); // a fresh device: the run
  await waitForScene(page, 'Battle');
  await prologueIdle(page);
  await waitForSuspendSave(page);
  await page.reload();
  await waitForScene(page, 'Title');
  await page.getByRole('button', { name: /^Resume · Act 1/ }).click();
  await page.getByRole('button', { name: 'Resume Battle', exact: true }).click();
  await waitForScene(page, 'Battle');
  await prologueIdle(page);
  expect(await battle(page)).toMatchObject({
    mode: 'prologue',
    chapter: 'p1_banner_at_dawn',
    nodeId: 'prologue_0',
    turnPar: null,
  });
  await waitForSuspendSave(page);
  await page.reload();
  await waitForScene(page, 'Title');
  await page.getByRole('button', { name: /^Resume · Act 1/ }).click();
  await page.getByRole('button', { name: 'Continue from Map', exact: true }).click();
  // The map re-opens the chapter at once: the first thread has no map before P1.
  await waitForScene(page, 'Battle');
  await prologueIdle(page);
  const reopened = await battle(page);
  expect(reopened).toMatchObject({ mode: 'prologue', chapter: 'p1_banner_at_dawn' });
  expect(reopened.transitions.filter((t) => t === 'NodeMap').length).toBeLessThanOrEqual(1);
  expect(
    await page.evaluate(
      () => window.__emblemRogueGame.scene.getScene('Battle').runManager.currentNodeId,
    ),
  ).toBeNull();
  await expect(page.getByRole('region', { name: 'Prologue guide', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
  await context.close();
});
