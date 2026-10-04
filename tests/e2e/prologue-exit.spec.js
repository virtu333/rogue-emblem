// The prologue always has a way out. In the prologue run (a fresh device's Prologue
// item): the coach's Skip and the pause menu's Skip Prologue (phone and desktop) end
// the prologue early, with its ending and the Home Base grant; the pause never offers
// Abandon Run. A fallen commander never ends anything: the chapter restarts from its
// entry. A standalone replay (the title's chapter select once saves exist) leaves for
// the title and never touches the slot.
import { test, expect } from '@playwright/test';
import { waitForScene as waitForSceneQuick } from './helpers.js';

test.setTimeout(150000);

// Asset loading can be slow on a busy machine: allow a full minute per scene.
async function waitForScene(page, key) {
  try {
    await waitForSceneQuick(page, key);
  } catch {
    await page.waitForFunction((k) => window.__sceneState?.activeScene === k, key, {
      timeout: 60000,
    });
  }
}

async function openTitle(browser, { phone, seedSlot = false }) {
  const context = await browser.newContext(
    phone
      ? {
          viewport: { width: 844, height: 390 },
          hasTouch: true,
          isMobile: true,
          deviceScaleFactor: 2,
        }
      : { viewport: { width: 1280, height: 800 } },
  );
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((seed) => {
    localStorage.setItem(
      'emblem_rogue_settings',
      JSON.stringify({ musicVolume: 0, sfxVolume: 0, reduceMotion: true }),
    );
    // A slot that already started a run: the Prologue item is a chapter select.
    if (seed)
      localStorage.setItem(
        'emblem_rogue_slot_1_meta',
        JSON.stringify({ totalValor: 12, totalSupply: 3, runsStarted: 1, savedAt: 1 }),
      );
  }, seedSlot);
  await page.goto(phone ? '/?mobilePreview=1&battleLab=1' : '/');
  await waitForScene(page, 'Title');
  return { context, page, errors };
}

/** The chapter is playable; P1 opens on its first guided step (`gated`). */
async function prologueReady(page, { gated = true } = {}) {
  await waitForScene(page, 'Battle');
  const coach = page.getByRole('region', { name: 'Prologue guide', exact: true });
  await expect(coach).toBeVisible({ timeout: 20000 });
  await page.waitForFunction((gated) => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    return (
      s.battleState === 'PLAYER_IDLE' &&
      Boolean(s._prologue) &&
      (!gated || s._prologue.gate?.kind === 'select')
    );
  }, gated);
  return coach;
}

/** A fresh device: the Prologue item starts the prologue run in slot 1. */
async function openPrologueRun(browser, { phone }) {
  const { context, page, errors } = await openTitle(browser, { phone });
  const prologue = page.getByRole('button', { name: /^Prologue/ });
  if (phone) await prologue.tap();
  else await prologue.click();
  const coach = await prologueReady(page);
  await page.waitForFunction(
    () =>
      JSON.parse(localStorage.getItem('emblem_rogue_slot_1_run') || 'null')?.mode === 'prologue',
  );
  return { context, page, errors, coach };
}

const slotKeys = (page) =>
  page.evaluate(() =>
    Object.keys(localStorage).filter((k) => /^emblem_rogue_slot_\d_(meta|run)$/.test(k)),
  );

/**
 * The ending after a skip in P1 (Edric alone): Sera is a voice not yet met (???), and
 * the lines of those he never met, or that name them, are left out.
 */
async function readEnding(page, click) {
  for (const [speaker, text] of [
    ['???', 'The ring has closed.'],
    ['Edric', 'Something is eating the sun.'],
    ['???', 'The Hollow Sun.'],
    ['???', 'It was never yours to stop.'],
    ['???', 'Not like this. I know this road now.'],
  ]) {
    const line = page.getByRole('dialog', { name: speaker, exact: true });
    await expect(line).toContainText(text);
    await click(line.getByRole('button', { name: 'Continue', exact: true }));
  }
  // A skip claims no win: no PROLOGUE COMPLETE; the handoff still says what counts now.
  await expect(page.locator('.ce-runend-word', { hasText: 'PROLOGUE COMPLETE' })).toHaveCount(0);
  const handoff = page.getByRole('dialog', { name: 'From here, it counts', exact: true });
  await expect(handoff).toContainText('Every run is a thread');
  await expect(handoff).toContainText('The prologue ends');
  await expect(handoff).toContainText('only when your commander falls');
  await click(handoff.getByRole('button', { name: 'To Home Base', exact: true }));
  await waitForScene(page, 'HomeBase');
}

test('phone: the coach Skip confirms, then the ending plays and Home Base holds the grant', async ({
  browser,
}) => {
  const { context, page, errors, coach } = await openPrologueRun(browser, { phone: true });
  const skip = coach.getByRole('button', { name: 'Skip the rest of the prologue', exact: true });
  await expect(skip).toHaveText('Skip');
  const box = await skip.boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(44);
  await skip.tap();
  const pause = page.getByRole('dialog', { name: 'Paused', exact: true });
  await expect(pause).toContainText('Skip the rest of the prologue?');
  // Cancel is the safe default and backs out to the battle.
  await expect(pause.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await pause.getByRole('button', { name: 'Cancel', exact: true }).tap();
  await expect(pause.getByRole('button', { name: 'Skip Prologue', exact: true })).toBeVisible();
  await expect(pause.getByRole('button', { name: 'Abandon Run', exact: true })).toHaveCount(0);
  await expect(pause.getByRole('button', { name: 'Leave Prologue', exact: true })).toHaveCount(0);
  await expect(pause).toContainText('Banner at Dawn');
  await expect(pause).toContainText('progress saves automatically');
  await pause.getByRole('button', { name: 'Skip Prologue', exact: true }).tap();
  await pause.getByRole('button', { name: 'Skip prologue', exact: true }).tap();
  await readEnding(page, (button) => button.tap());
  const meta = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('emblem_rogue_slot_1_meta')),
  );
  expect(meta.prologue).toMatchObject({ state: 'complete', grantPaid: true });
  expect(meta.totalValor).toBe(60);
  expect(meta.totalSupply).toBe(40);
  expect(meta.runsStarted).toBe(0);
  expect(await page.evaluate(() => localStorage.getItem('emblem_rogue_slot_1_run'))).toBeNull();
  await expect(page.locator('.mh-onboarding')).toContainText('This is what stays between runs.');
  expect(errors).toEqual([]);
  await context.close();
});

test('desktop: Esc pauses the prologue run; Skip Prologue ends it from the pause menu', async ({
  browser,
}) => {
  const { context, page, errors, coach } = await openPrologueRun(browser, { phone: false });
  await expect(
    coach.getByRole('button', { name: 'Skip the rest of the prologue', exact: true }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  const pause = page.getByRole('dialog', { name: 'Paused', exact: true });
  await expect(pause).toBeVisible();
  await expect(pause.getByRole('button', { name: 'Start First Run', exact: true })).toHaveCount(0);
  await expect(pause.getByRole('button', { name: 'Abandon Run', exact: true })).toHaveCount(0);
  await pause.getByRole('button', { name: 'Skip Prologue', exact: true }).click();
  await pause.getByRole('button', { name: 'Skip prologue', exact: true }).click();
  await readEnding(page, (button) => button.click());
  expect(await slotKeys(page)).toEqual(['emblem_rogue_slot_1_meta']);
  expect(errors).toEqual([]);
  await context.close();
});

test("desktop: the commander's fall plays the unnamed line and restarts the chapter from its entry, never a defeat", async ({
  browser,
}) => {
  const { context, page, errors, coach } = await openPrologueRun(browser, { phone: false });
  const before = await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const edric = s.playerUnits[0];
    return { hp: edric.currentHP, col: edric.col, row: edric.row, grid: Boolean(s.grid) };
  });
  await page.evaluate(() => {
    window.__battleGridMark = window.__emblemRogueGame.scene.getScene('Battle').grid;
  });
  // Edric falls to the near Fighter (the real death funnel, then the battle-end check).
  await page.evaluate(async () => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const edric = s.playerUnits[0];
    edric.currentHP = 0;
    await s.removeUnit(edric, { killer: s.enemyUnits[0] });
    s.checkBattleEnd();
  });
  const line = page.getByRole('dialog', { name: '???', exact: true });
  await expect(line).toContainText('Not this thread.');
  // Still the same battle scene, and never a defeat screen, prompt or run end.
  expect(await page.evaluate(() => window.__sceneState?.activeScene)).toBe('Battle');
  await line.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(line).toContainText('Stand again where the morning found you.');
  await line.getByRole('button', { name: 'Continue', exact: true }).click();
  // The chapter restarts from its entry: a fresh Edric on his spawn, the first step gated.
  await page.waitForFunction(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    return (
      window.__sceneState?.activeScene === 'Battle' &&
      s.grid !== window.__battleGridMark &&
      s.battleState === 'PLAYER_IDLE' &&
      s._prologue?.gate?.kind === 'select' &&
      s.playerUnits.length === 1
    );
  });
  const after = await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const edric = s.playerUnits[0];
    return {
      hp: edric.currentHP,
      col: edric.col,
      row: edric.row,
      enemies: s.enemyUnits.length,
      mode: s.runManager.mode,
      status: s.runManager.status,
      transitions: (window.__sceneState?.transitionAudits || []).map((a) => a.to),
    };
  });
  expect(before.grid).toBe(true);
  expect(after).toMatchObject({
    hp: before.hp,
    col: before.col,
    row: before.row,
    enemies: 2,
    mode: 'prologue',
  });
  expect(after.status).not.toBe('defeat');
  expect(after.transitions).not.toContain('RunComplete');
  await expect(coach.locator('.re-coach-goal')).toHaveText('Select Edric');
  // The run save is the chapter re-entered, never a settled defeat.
  await page.waitForFunction(
    () =>
      JSON.parse(localStorage.getItem('emblem_rogue_slot_1_run') || 'null')?.battleInProgress
        ?.nodeId === 'prologue_0',
  );
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('emblem_rogue_slot_1_run')),
  );
  expect(saved.mode).toBe('prologue');
  expect(saved.status).not.toBe('defeat');
  expect(saved.battleInProgress.checkpoint?.recoveryKind).not.toBe('fatal_pending');
  expect(errors).toEqual([]);
  await context.close();
});

test('desktop: Skip prologue from a field note opens the pause confirmation', async ({
  browser,
}) => {
  const { context, page, errors } = await openPrologueRun(browser, { phone: false });
  await page.evaluate(() => {
    void window.__emblemRogueGame.scene.getScene('Battle')._prologue.fieldNote('A note.');
  });
  const note = page.getByRole('dialog', { name: 'Field notes', exact: true });
  await expect(note).toContainText('A note.');
  await note.getByRole('button', { name: 'Skip prologue', exact: true }).click();
  const pause = page.getByRole('dialog', { name: 'Paused', exact: true });
  await expect(pause).toContainText('Skip the rest of the prologue?');
  await pause.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(pause.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
  await context.close();
});

test('desktop: with saves, Prologue is a chapter select; a replay never touches the slot and leaves for the title', async ({
  browser,
}) => {
  const { context, page, errors } = await openTitle(browser, { phone: false, seedSlot: true });
  const metaBefore = await page.evaluate(() => localStorage.getItem('emblem_rogue_slot_1_meta'));
  await page.getByRole('button', { name: /^Prologue/ }).click();
  await expect(page.getByRole('button', { name: 'Banner at Dawn', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Old Hands', exact: true }).click();
  await waitForScene(page, 'Battle');
  // P2 opens on the old hands' lines, then the coach.
  for (const [speaker, text] of [
    ['Gaspar', 'I will ride ahead.'],
    ['Edric', 'Then I watch.'],
    ['Gaspar', 'I leave the opening.'],
  ]) {
    const line = page.getByRole('dialog', { name: speaker, exact: true });
    await expect(line).toContainText(text);
    await line.getByRole('button', { name: 'Continue', exact: true }).click();
  }
  const coach = await prologueReady(page, { gated: false }); // P2 has no guided steps
  const replay = await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    return {
      run: s.runManager ?? null,
      chapter: s.battleParams.prologueChapter,
      units: s.playerUnits.map((u) => u.name),
      edricLevel: s.playerUnits.find((u) => u.name === 'Edric')?.level ?? null,
      activeSlot: s.registry.get('activeSlot') ?? null,
    };
  });
  expect(replay).toEqual({
    run: null,
    chapter: 'p2_old_hands',
    units: ['Edric', 'Gaspar'],
    edricLevel: 2,
    activeSlot: null,
  });
  await expect(coach.getByRole('button', { name: 'Leave prologue', exact: true })).toHaveText(
    'Leave',
  );
  await page.keyboard.press('Escape');
  const pause = page.getByRole('dialog', { name: 'Paused', exact: true });
  await expect(pause).toContainText('nothing here is saved');
  await pause.getByRole('button', { name: 'Leave Prologue', exact: true }).click();
  await expect(pause).toContainText('Leave the prologue?');
  await pause.getByRole('button', { name: 'Leave prologue', exact: true }).click();
  await waitForScene(page, 'Title');
  expect(await page.evaluate(() => localStorage.getItem('emblem_rogue_slot_1_meta'))).toBe(
    metaBefore,
  );
  expect(await slotKeys(page)).toEqual(['emblem_rogue_slot_1_meta']);
  expect(errors).toEqual([]);
  await context.close();
});

test('desktop: the Quarry Gate replays from the chapter select: its deploy screen and formation, the canned army, nothing saved', async ({
  browser,
}) => {
  const { context, page, errors } = await openTitle(browser, { phone: false, seedSlot: true });
  const metaBefore = await page.evaluate(() => localStorage.getItem('emblem_rogue_slot_1_meta'));
  await page.getByRole('button', { name: /^Prologue/ }).click();
  await page.getByRole('button', { name: 'The Quarry Gate', exact: true }).click();
  await waitForScene(page, 'Battle');
  // The deploy note, without the Roster advice (a replay has no roster to open).
  const note = page.getByRole('dialog', { name: 'Field notes', exact: true });
  await expect(note).toContainText('Your commander always deploys. Choose who fights: 3 slots.');
  await expect(note).toContainText('swords beat axes.');
  await expect(note).not.toContainText('Roster');
  await expect(async () => {
    if (await note.count())
      await note.getByRole('button', { name: 'Continue', exact: true }).click({ timeout: 1000 }).catch(() => {}); // prettier-ignore
    await expect(note).toHaveCount(0, { timeout: 1000 });
  }).toPass();
  const deploy = page.getByRole('dialog', { name: 'Deploy units', exact: true });
  await expect(deploy).toContainText('/ 3 selected');
  await expect(deploy.getByRole('button', { name: 'Roster', exact: true })).toHaveCount(0);
  // Only the commander is chosen for you (no earlier lineup here): pick Gaspar and Sera.
  await expect(deploy).toContainText('1 / 3 selected · Minimum 2');
  await expect(deploy.getByRole('button', { name: 'Deploy', exact: true })).toBeDisabled();
  for (const name of ['Gaspar', 'Sera']) {
    const row = deploy.locator('.re-party-row', { hasText: name });
    await row.click();
    await expect(row).toHaveAttribute('aria-pressed', 'true');
  }
  await expect(deploy).toContainText('3 / 3 selected');
  await deploy.getByRole('button', { name: 'Deploy', exact: true }).click();
  const formation = page.getByRole('region', { name: 'Formation', exact: true });
  await expect(formation).toContainText('Who stands in front takes the first blow.');
  await formation.getByRole('button', { name: 'Auto-place', exact: true }).click();
  await formation.getByRole('button', { name: 'Start battle', exact: true }).click();
  await expect(note).toContainText('Seize: defeat Captain Varro');
  await expect(note).toContainText('Par: win in 10 turns or fewer');
  await expect(async () => {
    if (await note.count())
      await note.getByRole('button', { name: 'Continue', exact: true }).click({ timeout: 1000 }).catch(() => {}); // prettier-ignore
    await expect(note).toHaveCount(0, { timeout: 1000 });
  }).toPass();
  await prologueReady(page, { gated: false });
  const replay = await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    return {
      run: s.runManager ?? null,
      chapter: s.battleParams.prologueChapter,
      units: s.playerUnits.length,
      gaspar: s.playerUnits.find((u) => u.name === 'Gaspar')?.weapon?.name ?? null,
      varro: s.enemyUnits.find((u) => u.isBoss)?.name ?? null,
      par: s.turnPar,
      activeSlot: s.registry.get('activeSlot') ?? null,
    };
  });
  expect(replay).toEqual({
    run: null,
    chapter: 'p4_quarry_gate',
    units: 3,
    gaspar: 'Iron Sword',
    varro: 'Captain Varro',
    par: 10,
    activeSlot: null,
  });
  await page.keyboard.press('Escape');
  const pause = page.getByRole('dialog', { name: 'Paused', exact: true });
  await pause.getByRole('button', { name: 'Leave Prologue', exact: true }).click();
  await pause.getByRole('button', { name: 'Leave prologue', exact: true }).click();
  await waitForScene(page, 'Title');
  expect(await page.evaluate(() => localStorage.getItem('emblem_rogue_slot_1_meta'))).toBe(
    metaBefore,
  );
  expect(await slotKeys(page)).toEqual(['emblem_rogue_slot_1_meta']);
  expect(errors).toEqual([]);
  await context.close();
});
