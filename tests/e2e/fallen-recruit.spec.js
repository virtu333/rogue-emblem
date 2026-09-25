// Playtest 2026-09-25: "my archer died last map and I can't revive him at the
// church … maybe because I lost him on the mission I recruited him". A unit
// recruited by Talk that falls in the same battle is now a fallen ally: after
// the victory (and a reload) the church offers to revive it.
import { test, expect } from '@playwright/test';
import { waitForScene } from './helpers.js';

test.use({ viewport: { width: 1280, height: 800 } });
test.setTimeout(180_000);

// Set PLAYTEST_FIX_SHOTS=docs/art-direction/gameplay/playtest-fixes to refresh the doc screenshots.
const SHOTS = process.env.PLAYTEST_FIX_SHOTS || '';

async function clickThrough(page, done) {
  for (let i = 0; i < 120; i++) {
    if (await page.evaluate(done)) return;
    for (const name of ['Continue', 'Skip', 'Skip conversation', 'Close']) {
      const button = page.getByRole('button', { name, exact: true });
      if (await button.count())
        await button
          .first()
          .click()
          .catch(() => {});
    }
    await page.mouse.click(640, 400).catch(() => {});
    await page.waitForTimeout(250);
  }
  throw new Error('flow did not settle');
}

test('a recruit who joins and falls in the same battle can be revived at the church', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.routeWebSocket(/^ws:\/\/(?:127\.0\.0\.1|localhost):\d+/, (socket) => socket.close());
  await page.addInitScript(() =>
    localStorage.setItem(
      'emblem_rogue_settings',
      JSON.stringify({ musicVolume: 0, sfxVolume: 0, hints: false, battleSpeed: 'instant' }),
    ),
  );
  await page.goto('/?devScene=battle&preset=battle_smoke&seed=42');
  await waitForScene(page, 'Battle');
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'PLAYER_IDLE',
  );
  await page.evaluate(async () => {
    const game = window.__emblemRogueGame;
    const { getMetaKey, setActiveSlot } = await import('/src/engine/SlotManager.js');
    const meta = game.registry.get('meta');
    meta.storageKey = getMetaKey(1);
    meta._save();
    game.registry.set('activeSlot', 1);
    setActiveSlot(1);
    const s = game.scene.getScene('Battle');
    const { createRecruitUnit } = await import('/src/engine/UnitManager.js');
    const lord = s.playerUnits[0];
    const spot = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]
      .map(([dc, dr]) => ({ col: lord.col + dc, row: lord.row + dr }))
      .find(
        (p) =>
          p.col >= 0 &&
          p.row >= 0 &&
          p.col < s.grid.cols &&
          p.row < s.grid.rows &&
          !s.getUnitAt(p.col, p.row),
      );
    const npc = createRecruitUnit(
      { name: 'Daska', level: 3 },
      s.gameData.classes.find((c) => c.name === 'Archer'),
      s.gameData.weapons,
      null,
      null,
      null,
      s.gameData.classes,
      { skillsData: s.gameData.skills },
    );
    Object.assign(npc, spot, { faction: 'npc' });
    s.npcUnits.push(npc);
    s.addUnitGraphic(npc);
    s._captureSuspendCheckpoint();
    window.__talk = s.executeTalk(lord);
  });
  await clickThrough(page, () =>
    window.__emblemRogueGame.scene.getScene('Battle').playerUnits.some((u) => u.name === 'Daska'),
  );
  // The recruit falls; then the last enemies fall and the battle is won.
  await page.evaluate(async () => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    await window.__talk;
    s.battleState = 'PLAYER_IDLE';
    s._captureSuspendCheckpoint();
    window.__death = s.removeUnit(s.playerUnits.find((u) => u.name === 'Daska'));
  });
  await clickThrough(page, () =>
    window.__emblemRogueGame.scene.getScene('Battle').playerUnits.every((u) => u.name !== 'Daska'),
  );
  await page.evaluate(async () => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    await window.__death;
    for (const enemy of [...s.enemyUnits]) await s.removeUnit(enemy, { killer: s.playerUnits[0] });
    s.checkBattleEnd();
  });
  await clickThrough(
    page,
    () =>
      window.__emblemRogueGame.scene
        .getScene('Battle')
        ?.runManager?.fallenUnits?.some((u) => u.name === 'Daska') === true,
  );
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('emblem_rogue_slot_1_run')),
  );
  expect(saved.battleInProgress).toBeNull();
  expect(saved.fallenUnits.map((u) => u.name)).toContain('Daska');
  expect(saved.roster.map((u) => u.name)).not.toContain('Daska');

  // Reload into the saved run and visit a church.
  await page.evaluate(() => history.replaceState(null, '', '/'));
  await page.reload();
  await waitForScene(page, 'Title');
  await page.waitForTimeout(1300);
  await page.getByRole('button', { name: 'Save Slots', exact: true }).click();
  await waitForScene(page, 'SlotPicker');
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Select Slot 1', exact: true }).click();
  await waitForScene(page, 'NodeMap');
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('NodeMap');
    s.runManager.pendingBattleReward = null;
    s.runManager.gold = 20000;
    const node = s.runManager.getAvailableNodes()[0];
    node.type = 'church';
    s.runManager.currentNodeId = node.id;
    s.handleChurch(node);
  });
  const church = page.getByRole('dialog', { name: /church/i });
  await expect(church).toBeVisible();
  const revive = church.getByRole('button', { name: /^Daska · Archer · Revive/ });
  await expect(revive).toBeEnabled();
  // A clear sun has nothing to lift: the Kindle button never reads "−0 shadow".
  await expect(church.getByRole('button', { name: /^Kindle/ })).not.toContainText('−0');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/church-revive-recruit-1280x800.png` });
  await revive.click();
  const confirm = page.getByRole('dialog', { name: 'Revive Daska?' });
  await confirm.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__emblemRogueGame.scene
          .getScene('NodeMap')
          .runManager.roster.some((u) => u.name === 'Daska'),
      ),
    )
    .toBe(true);
  expect(errors).toEqual([]);
});
