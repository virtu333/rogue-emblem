// Goddess Dance in the browser (docs/specs/phase3.md 3E): a Bard's once-per-battle refresh of
// every adjacent ally who has acted. The combat_actions lab's Dancer ("Support", (3,4)) is given
// the skill; her three neighbours (Edric above, Patient to the left, Utility to the right) have
// acted. Through the phone's Ability menu and confirm prompt, with a real effect, a spent use and
// refreshed allies who can act again.
import { test, expect, devices } from '@playwright/test';
import { waitForScene } from './helpers.js';

test.use({ ...devices['iPhone SE'], viewport: { width: 667, height: 375 } });
const url = '/?devScene=battle&preset=combat_actions&seed=42&mobilePreview=1&battleLab=1';

async function boot(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url);
  await waitForScene(page, 'Battle');
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'PLAYER_IDLE',
  );
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    s.playerUnits.find((u) => u.name === 'Support').skills.push('goddess_dance');
    // Three allies have already acted this turn.
    for (const name of ['Edric', 'Patient', 'Utility']) {
      const u = s.playerUnits.find((x) => x.name === name);
      u.hasActed = true;
      u.hasMoved = true;
      u._movementCommitted = true;
      s.dimUnit(u);
    }
  });
  return { hud: page.getByRole('complementary', { name: 'Battle commands' }), errors };
}

async function tapTile(page, col, row) {
  const p = await page.evaluate(
    ({ col, row }) => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      const w = s.grid.gridToPixel(col, row);
      const q = s._worldToScreen(w.x, w.y);
      const r = s.game.canvas.getBoundingClientRect();
      return {
        x: r.x + (q.x * r.width) / s.scale.width,
        y: r.y + (q.y * r.height) / s.scale.height,
      };
    },
    { col, row },
  );
  await page.touchscreen.tap(p.x, p.y);
}

const units = (page) =>
  page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    return Object.fromEntries(
      s.playerUnits.map((u) => [
        u.name,
        {
          acted: Boolean(u.hasActed),
          moved: Boolean(u.hasMoved),
          spent: u._movementSpent ?? 0,
          usage: u._battleAbilityUsage?.map?.goddess_dance ?? 0,
        },
      ]),
    );
  });

test('Goddess Dance: the prompt names who, Cancel spends nothing, Confirm refreshes every neighbour that acted', async ({
  page,
}) => {
  test.setTimeout(60_000); // a long, real-input flow on a software-rendered phone canvas
  const { hud, errors } = await boot(page);
  await tapTile(page, 3, 4); // Support, the dancer
  await hud.getByRole('button', { name: 'Ability', exact: true }).tap();
  await expect(hud.getByRole('button', { name: /^Goddess Dance.*1\/1 uses left/s })).toBeEnabled();
  await hud.getByRole('button', { name: /^Goddess Dance/ }).tap();
  await expect(hud.getByRole('button', { name: 'Use Goddess Dance (3 allies)' })).toBeVisible();
  await page.screenshot({ path: 'test-results/goddess-dance-prompt.png' });

  // Cancel: nothing refreshed, nothing spent.
  await hud.getByRole('button', { name: 'Cancel', exact: true }).tap();
  const cancelled = await units(page);
  expect(cancelled.Support).toMatchObject({ acted: false, usage: 0 });
  expect([cancelled.Edric.acted, cancelled.Patient.acted, cancelled.Utility.acted]).toEqual([
    true,
    true,
    true,
  ]);

  await hud.getByRole('button', { name: /^Goddess Dance/ }).tap();
  await hud.getByRole('button', { name: 'Use Goddess Dance (3 allies)' }).tap();
  await expect.poll(async () => (await units(page)).Support.acted).toBe(true);
  const after = await units(page);
  expect(after.Support.usage).toBe(1);
  for (const name of ['Edric', 'Patient', 'Utility'])
    expect(after[name], name).toMatchObject({ acted: false, moved: false });
  // Dance does not give the movement back: the Gambit and Galeforce do, a dance never has.
  expect(after.Edric.spent).toBe(cancelled.Edric.spent);

  // A refreshed ally can be picked and used again.
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'PLAYER_IDLE',
  );
  await tapTile(page, 3, 3);
  await expect(hud.getByRole('button', { name: 'Wait', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('with no neighbour who has acted, Goddess Dance is greyed with its reason', async ({
  page,
}) => {
  const { hud, errors } = await boot(page);
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    for (const u of s.playerUnits) u.hasActed = false;
  });
  await tapTile(page, 3, 4);
  await hud.getByRole('button', { name: 'Ability', exact: true }).tap();
  const row = hud.getByRole('button', { name: /^Goddess Dance/ });
  await expect(row).toBeDisabled();
  await expect(row).toContainText('No valid targets');
  expect(errors).toEqual([]);
});
