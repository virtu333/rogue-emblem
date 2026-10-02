// E2E: Stormcall on an upright phone (docs/specs/aoe-weapon-arts.md §6, Portrait). The
// board is drawn turned a quarter; taps land on the tile drawn under the finger, the
// centre is kept in game coordinates, and the phone turning mid-aim waits for the
// action to finish (the switch needs PLAYER_IDLE).
import { test, expect } from '@playwright/test';
import { attachSceneCrashArtifacts } from './helpers.js';
import {
  PORTRAIT_PHONES,
  battleRail,
  openDevBattle,
  pageErrors,
  phone,
  tapTile,
} from './portraitHelpers.js';

test.use(phone(PORTRAIT_PHONES[1]));

test.afterEach(async ({ page }, testInfo) => {
  await attachSceneCrashArtifacts(page, testInfo);
});

const read = (page) =>
  page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const utility = s.playerUnits.find((u) => u.name === 'Utility');
    const fighter = s.enemyUnits.find((u) => u.className === 'Fighter');
    return {
      rotated: Boolean(s.grid.board?.rotated),
      battleState: s.battleState,
      locked: s._areaTargetingController?.locked || null,
      utility: { hp: utility.currentHP, acted: utility.hasActed },
      fighter: fighter ? { hp: fighter.currentHP, res: fighter.stats.RES } : null,
    };
  });

test('upright: aim by the drawn board, fire, and the centre stays in game coordinates', async ({
  page,
}) => {
  const errors = pageErrors(page);
  await openDevBattle(page, { preset: 'combat_actions', query: '&battleLab=1', slot: null });
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const u = s.playerUnits.find((x) => x.name === 'Utility');
    const tome = structuredClone(s.gameData.weapons.find((w) => w.name === 'Breachbolt'));
    u.proficiencies = [{ type: 'Tome', rank: 'Mast' }];
    u.inventory = [tome];
    u.weapon = tome;
    Object.assign(u.stats, { MAG: 22, HP: 40 });
    u.currentHP = 32;
  });
  expect((await read(page)).rotated).toBe(true);
  const rail = battleRail(page);
  await tapTile(page, 4, 4);
  await rail.getByRole('button', { name: /^Weapon Art/ }).tap();
  await rail.getByRole('button', { name: /Stormcall/ }).tap();
  await expect.poll(async () => (await read(page)).battleState).toBe('SELECTING_AREA_CENTER');
  // Mid-aim the battle is not idle, so a turn of the phone would wait.
  const switchable = await page.evaluate(async () => {
    const { canSwitchBattlePresentation } = await import('/src/utils/portraitBattle.js');
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    return canSwitchBattlePresentation({
      hasRunCheckpoint: true,
      boundary: 'destination',
      phase: 'player',
      battleState: s.battleState,
    });
  });
  expect(switchable).toBe(false);
  await tapTile(page, 6, 5);
  await expect.poll(async () => (await read(page)).locked).toEqual({ col: 6, row: 5 });
  const before = await read(page);
  await rail.getByRole('button', { name: /Fire Stormcall/ }).tap();
  await expect
    .poll(async () => (await read(page)).battleState, { timeout: 15_000 })
    .toBe('PLAYER_IDLE');
  const after = await read(page);
  expect(after.utility).toEqual({ hp: 24, acted: true });
  // (MAG 22 + Breachbolt 8 − RES) × 0.8, rounded down.
  const blow = Math.floor((22 + 8 - before.fighter.res) * 0.8);
  expect(after.fighter.hp).toBe(Math.max(0, before.fighter.hp - blow));
  expect(errors).toEqual([]);
});
