// The prologue run (docs/specs/prologue-chapter.md §4, §9): a fresh slot is offered the
// prologue on New Game; Play opens P1 at once as a run in prologue mode (the route map
// stays hidden); P1's win brings Gaspar in on the prologue's own route map; P2 opens
// with the old hands; P2's win pays its authored loot and opens the row-2 fork (its
// note), where Harrow's Market brings Tamsin in (the recruit card, her bow from the
// rack) and the roster lesson's Withdraw is done with the real button; P3 opens with
// Sera green, Edric reaches her and Talks, she acts at once; P3's win plays the ending
// and lands in Home Base with the grant, whose Begin Run takes the first-run fast path. Skip takes
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

/**
 * Read a Field note to its end: a long note ignores Continue for its first half second
 * (HintDisplay's reading guard), so Continue is pressed until this note is gone.
 */
async function continueNote(page, text) {
  const note = page.getByRole('dialog', { name: 'Field notes', exact: true }).filter({ hasText: text }); // prettier-ignore
  await expect(note).toBeVisible();
  await expect(async () => {
    if (await note.count())
      await note.getByRole('button', { name: 'Continue', exact: true }).click({ timeout: 1000 }).catch(() => {}); // prettier-ignore
    await expect(note).toHaveCount(0, { timeout: 1000 });
  }).toPass();
}

/** The route map's first-visit note (a modal on arrival) is read before anything else. */
async function dismissRouteNote(page) {
  await continueNote(page, 'Tap any node to preview it');
  await expect(page.locator('.re-node-map')).toBeVisible();
}

async function readLine(page, speaker, text) {
  const line = page.getByRole('dialog', { name: speaker, exact: true });
  await expect(line).toContainText(text);
  await line.getByRole('button', { name: 'Continue', exact: true }).click();
}

test('New Game offers the prologue; Play opens P1 as a run, P1 joins Gaspar, the fork joins Tamsin, P3 recruits Sera and ends in Home Base with the grant', async ({
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

  // Row 2: the fork. Its own note, two service nodes that say what they hold.
  await waitForScene(page, 'NodeMap');
  await continueNote(page, "Tap a node to see what it holds. Travel commits; you can't come back.");
  expect(
    await page.evaluate(() => [...document.querySelectorAll('.re-node.is-live')].map((n) => n.dataset.node)), // prettier-ignore
  ).toEqual(['prologue_2a', 'prologue_2b']);
  await route.locator('.re-node[data-node="prologue_2a"]').click();
  await expect(route.locator('.re-loom-card')).toContainText("Harrow's Market");
  await expect(route.locator('.re-loom-card')).toContainText('fixed stock: no restock here');
  await route.getByRole('button', { name: 'Travel', exact: true }).click();
  // Tamsin joins on arrival with the standard recruit card. P2's village was never
  // visited here, so the node hands her a bow and her line says so.
  const card = page.getByRole('dialog', { name: 'Tamsin joins your army', exact: true });
  await expect(card).toContainText("There's one on the rack here.");
  await expect(async () => {
    if (await card.count()) await card.click({ timeout: 1000 }).catch(() => {});
    await expect(card).toHaveCount(0, { timeout: 1000 });
  }).toPass();
  const shop = page.getByRole('dialog', { name: 'Village', exact: true });
  await expect(shop).toContainText("This market's stock is fixed while you're here.");
  await expect(shop.getByRole('button', { name: /^Restock/ })).toHaveCount(0);
  const atMarket = await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('NodeMap');
    return {
      roster: s.runManager.roster.map((u) => u.name),
      convoy: s.runManager.convoy.weapons.map((w) => w.name),
      stock: s.shopBuyItems.map((e) => e.item.name),
    };
  });
  expect(atMarket).toEqual({
    roster: ['Edric', 'Gaspar', 'Tamsin'],
    convoy: ['Iron Bow'],
    stock: ['Vulnerary', 'Vulnerary', 'Iron Sword', 'Iron Lance', 'Javelin'],
  });
  // The join is saved before the card: a refresh here keeps her.
  expect((await slotRun(page)).roster.map((u) => u.name)).toContain('Tamsin');
  // The roster lesson: Withdraw done with the real button, then the lesson skipped.
  await shop.getByRole('button', { name: 'Roster', exact: true }).click();
  const roster = page.getByRole('dialog', { name: 'Manage roster', exact: true });
  const lesson = roster.getByRole('region', { name: 'Roster lesson', exact: true });
  await expect(lesson).toContainText('Roster lesson · 1 of 4 · Withdraw');
  await expect(lesson).toContainText('Give Tamsin the Iron Bow from the convoy');
  await expect(roster.locator('.mr-unit-card', { hasText: 'Tamsin' })).toContainText(
    'No weapon. A bow is in the convoy.',
  );
  await roster.locator('.mr-unit-card', { hasText: 'Tamsin' }).click();
  await roster.getByRole('button', { name: 'Convoy', exact: true }).click();
  await roster
    .locator('.mr-item-card', { has: page.locator('h4', { hasText: 'Iron Bow' }) })
    .getByRole('button', { name: 'Withdraw', exact: true })
    .click();
  await expect(lesson).toContainText('Withdraw: done.');
  await expect(lesson).toContainText('2 of 4 · Equip');
  expect(
    await page.evaluate(() => {
      const rm = window.__emblemRogueGame.scene.getScene('NodeMap').runManager;
      return rm.roster.find((u) => u.name === 'Tamsin').weapon?.name;
    }),
  ).toBe('Iron Bow');
  await lesson.getByRole('button', { name: 'Skip lesson', exact: true }).click();
  await expect(lesson).toHaveCount(0);
  expect((await slotRun(page)).prologueRosterLesson).toMatchObject({ dismissed: true });
  await roster.getByRole('button', { name: 'Close', exact: true }).first().click();
  await expect(roster).toHaveCount(0);
  await shop.getByRole('button', { name: 'Leave', exact: true }).click();
  await expect(shop).toHaveCount(0);

  // P3: the seer on the road. Sera green beside a Soldier; Edric reaches her and Talks.
  await expect(route.locator('.re-node[data-node="prologue_3"]')).toHaveClass(/is-live/);
  await route.locator('.re-node[data-node="prologue_3"]').click();
  await expect(route.locator('.re-loom-card')).toContainText('The Seer on the Road');
  await route.getByRole('button', { name: 'Travel', exact: true }).click();
  await waitForScene(page, 'Battle');
  await readLine(page, 'Gaspar', 'A robed woman on the road, and soldiers at her heels.');
  await readLine(page, 'Edric', 'Then we reach her first. Count off and ride.');
  await continueNote(page, 'can join you. Move a Lord next to her and choose Talk');
  await prologueIdle(page);
  const p3 = await battle(page);
  expect(p3).toMatchObject({ mode: 'prologue', chapter: 'p3_seer_on_the_road', turnPar: null });
  expect(p3.units).toEqual(['Edric', 'Gaspar', 'Tamsin']);
  const guide = page.getByRole('region', { name: 'Prologue guide', exact: true });
  await expect(guide).toContainText('Reach Sera and Talk');
  expect(
    await page.evaluate(() =>
      window.__emblemRogueGame.scene
        .getScene('Battle')
        .npcUnits.map((u) => `${u.name}:${u.faction}:${u.col},${u.row}`),
    ),
  ).toEqual(['Sera:npc:4,2']);
  // Edric's own move: a tile beside Sera inside his blue range, then Talk.
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const edric = s.playerUnits.find((u) => u.name === 'Edric');
    const sera = s.npcUnits.find((u) => u.name === 'Sera');
    s.selectUnit(edric);
    const spot = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]
      .map(([dc, dr]) => [sera.col + dc, sera.row + dr])
      .find(([col, row]) => s.movementRange.has(`${col},${row}`) && !s.getUnitAt(col, row));
    if (!spot) throw new Error('Edric cannot reach Sera on turn 1');
    s.moveUnit(edric, ...spot);
  });
  // The action menu (canvas rows on desktop) offers Talk beside her: choose it.
  await page.waitForFunction(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    return (
      s.battleState === 'UNIT_ACTION_MENU' &&
      (s.actionMenu || []).some((row) => row?.text === 'Talk' && typeof row._action === 'function')
    );
  });
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    s.actionMenu.find((row) => row?.text === 'Talk')._action();
  });
  const seraCard = page.getByRole('dialog', { name: 'Sera joins your army', exact: true });
  await expect(seraCard).toContainText('I have seen you before, Edric.');
  await expect(async () => {
    if (await seraCard.count()) await seraCard.click({ timeout: 1000 }).catch(() => {});
    await expect(seraCard).toHaveCount(0, { timeout: 1000 });
  }).toPass();
  await expect(guide).toContainText('Sera acts right away');
  await page.waitForFunction(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const sera = s.playerUnits.find((u) => u.name === 'Sera');
    return s.battleState === 'PLAYER_IDLE' && sera && !sera.hasActed && s.npcUnits.length === 0;
  });

  // P3 won: Sera's lines, then the ending (four unnamed lines, the title card), Home Base.
  await page.evaluate(() => window.__emblemRogueGame.scene.getScene('Battle').onVictory());
  await readLine(page, 'Sera', "I don't stand at the front.");
  await readLine(page, 'Edric', 'Then stand behind us.');
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
    chaptersCompleted: ['p1_banner_at_dawn', 'p2_old_hands', 'p3_seer_on_the_road'],
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
  // Teach one step (select Edric: the gate moves on to the Fort), step back, and
  // checkpoint there: the lesson's place rides the checkpoint.
  const guide = page.getByRole('region', { name: 'Prologue guide', exact: true });
  await expect(guide).toContainText('Select Edric');
  const taught = await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    s.selectUnit(s.playerUnits.find((u) => u.name === 'Edric'));
    s.deselectUnit();
    s._captureSuspendCheckpoint({ session: s._battleSession });
    return s._prologue.snapshot();
  });
  expect(taught.started).toBe(true);
  expect(taught.gate).toMatchObject({ kind: 'move' });
  const coachBefore = (await guide.textContent()).trim();
  expect(coachBefore).not.toContain('Select Edric');
  await page.waitForFunction((fired) => {
    const run = JSON.parse(localStorage.getItem('emblem_rogue_slot_1_run') || 'null');
    const state = run?.battleInProgress?.checkpoint?.prologueState;
    return Boolean(state) && state.fired.length === fired;
  }, taught.fired.length);
  await page.reload();
  await waitForScene(page, 'Title');
  await page.getByRole('button', { name: /^Resume · Act 1/ }).click();
  await page.getByRole('button', { name: 'Resume Battle', exact: true }).click();
  await waitForScene(page, 'Battle');
  await prologueIdle(page);
  // Resume Battle: the coach and the gate as left, and the opening never replays.
  const resumed = await page.evaluate(() =>
    window.__emblemRogueGame.scene.getScene('Battle')._prologue.snapshot(),
  );
  expect(resumed).toMatchObject({
    started: true,
    fired: taught.fired,
    gate: taught.gate,
    coachGoal: taught.coachGoal,
  });
  await expect(guide).toBeVisible();
  expect((await guide.textContent()).trim()).toBe(coachBefore);
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
