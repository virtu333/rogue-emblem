// NG+ at Home Base (docs/specs/ng-plus.md): buy it, pick who rides again from a Nightfall win,
// bring a veteran, and see the NG+ switch on the difficulty screen. Played by taps on the DOM.
import { test, expect, devices } from '@playwright/test';
import { waitForScene } from './helpers.js';

test.use({ ...devices['iPhone 13'], viewport: { width: 844, height: 390 } });

async function boot(page) {
  await page.goto('/?devScene=homebase&mobilePreview=1');
  await waitForScene(page, 'HomeBase');
  await expect(page.getByRole('dialog', { name: 'Home base', exact: true })).toBeVisible();
}

/** A won Black Sun run's survivors, as the run's end would store them. */
async function seedWin(page) {
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('HomeBase');
    const { meta } = s;
    for (const m of ['beatGame', 'beatDusk', 'beatHard', 'beatLunatic']) meta.milestones.add(m);
    meta.addValor(2000);
    meta.addSupply(2000);
    const elixir = s.gameData.consumables.find((c) => c.name === 'Elixir');
    const axe = s.gameData.weapons.find((w) => w.name === 'Steel Axe');
    meta.ngPlus.pendingRide = {
      runId: 'run-e2e',
      difficultyId: 'lunatic',
      endedAt: 1,
      candidates: [
        {
          ref: 'u1',
          kind: 'lord',
          name: 'Edric',
          className: 'Lord',
          level: 12,
          tier: 'promoted',
          recordId: null,
          identity: null,
          items: [{ ...elixir, uid: 'itm_e2e_elixir' }],
          skills: ['sol'],
          skillKinds: { sol: 'skill' },
        },
        {
          ref: 'u4',
          kind: 'recruit',
          name: 'Bjorn',
          className: 'Warrior',
          level: 8,
          tier: 'promoted',
          recordId: null,
          identity: {
            className: 'Fighter',
            growths: { HP: 80, STR: 55, MAG: 0, SKL: 40, SPD: 35, DEF: 30, RES: 10, LCK: 30 },
            traits: [],
            traitAttackStat: null,
            markId: null,
            portraitVariant: null,
          },
          items: [{ ...axe, uid: 'itm_e2e_axe' }],
          skills: ['vantage', 'shove'],
          skillKinds: { vantage: 'skill', shove: 'ability' },
        },
      ],
    };
    meta.ngPlus.rev += 1;
    meta._save();
    s.mobileHome.render();
  });
}

test('buy NG+, pick who rides again, bring a veteran, and start NG+ on Nightfall', async ({
  page,
}) => {
  await boot(page);
  // A save that has not won Black Sun has no NG+ tab.
  await expect(page.locator('[data-focus="ngplus"]')).toHaveCount(0);
  await seedWin(page);
  await page.locator('[data-focus="ngplus"]').tap();
  const unlock = page.locator('[data-focus="ng-unlock"]');
  await expect(unlock).toBeEnabled();
  await unlock.tap();
  await expect(page.locator('.mu-status')).toHaveText('New Game+ unlocked.');

  // Who rides again: Bjorn keeps Vantage and the Steel Axe.
  await page.locator('[data-focus="ride-u4"]').tap();
  await expect(page.locator('[data-focus="ride-u4"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-focus="keep-skill-vantage"]').tap();
  await page.locator('[data-focus="keep-item-itm_e2e_axe"]').tap();
  await expect(page.locator('[data-focus="keep-skill-vantage"]')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  // Opening Edric and back never drops Bjorn's choices; Edric leaves the pick by his button.
  await page.locator('[data-focus="ride-u1"]').tap();
  await expect(page.locator('[data-focus="keep-skill-sol"]')).toBeVisible();
  await page.locator('[data-focus="ride-u4"]').tap();
  await expect(page.locator('[data-focus="keep-skill-vantage"]')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.locator('[data-focus="ride-u1"]').tap();
  await page.locator('[data-focus="unpick-u1"]').tap();
  await expect(page.locator('[data-focus="ride-u1"]')).toHaveAttribute('aria-pressed', 'false');

  // Begin Run asks once while the pick is open, and the warning says what is unsent.
  await page.locator('[data-focus="begin"]').tap();
  await expect(page.locator('.mu-status')).toContainText('Who rides again? still has');
  await expect(page.locator('[data-focus="begin"]')).toHaveText('Begin anyway');
  await page.locator('[data-focus="ngplus"]').tap();
  await expect(page.locator('[data-focus="begin"]')).toHaveText('Begin Run');
  await page.locator('[data-focus="ride-u4"]').tap();

  await page.locator('[data-focus="ng-commit"]').tap();
  // The pick stays open for the lord's slot; Bjorn is sent and cannot be sent again.
  await expect(page.locator('.mu-status')).toHaveText(
    'Sent to the Barracks. Pick the rest, or tap Done.',
  );
  await expect(page.locator('[data-focus="ride-u4"]')).toBeDisabled();
  await expect(page.locator('[data-focus="ride-u4"]')).toContainText('Sent to the Barracks');

  // Edric then fills the lord's slot, which closes the pick.
  await page.locator('[data-focus="ride-u1"]').tap();
  await page.locator('[data-focus="keep-skill-sol"]').tap();
  await page.locator('[data-focus="ng-commit"]').tap();
  await expect(page.locator('.mu-status')).toHaveText(
    'The Barracks is ready for the next NG+ run.',
  );
  await expect(page.locator('[data-focus^="ride-"]')).toHaveCount(0);

  // The Barracks: bring Bjorn into the next NG+ run, saved across a reload.
  const vet = page.locator('[data-focus^="vet-vet:"]');
  await expect(vet).toContainText('Bjorn');
  await vet.tap();
  await expect(page.locator('.mu-copy')).toContainText('Skills: Vantage');
  await page.locator('[data-focus^="bring-"]').tap();
  await expect(vet).toContainText('Bringing');
  expect(
    await page
      .locator('.mh-screen')
      .evaluate((el) => el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight),
  ).toBe(true);
  await page.reload();
  await waitForScene(page, 'HomeBase');
  await page.locator('[data-focus="ngplus"]').tap();
  await expect(page.locator('[data-focus^="vet-vet:"]')).toContainText('Bringing');

  // The difficulty screen offers NG+ on Nightfall, never on Dusk.
  await page.getByRole('button', { name: 'Begin Run', exact: true }).tap();
  await waitForScene(page, 'DifficultySelect');
  await page.locator('[data-mode="dusk"]').tap();
  await expect(page.locator('[data-focus="ngplus"]')).toHaveCount(0);
  await page.locator('[data-mode="hard"]').tap();
  const toggle = page.locator('[data-focus="ngplus"]');
  await expect(toggle).toHaveText('New Game+: On');
  await expect(page.locator('.ch-banner-detail')).toContainText('1 veteran rides with you');
  await toggle.tap();
  await expect(toggle).toHaveText('New Game+: Off');
});

for (const [width, height] of [
  [640, 480],
  [844, 390],
])
  test(`the NG+ tab fits ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await boot(page);
    await seedWin(page);
    await page.locator('[data-focus="ngplus"]').tap();
    await page.locator('[data-focus="ng-unlock"]').tap();
    await page.locator('[data-focus="ride-u4"]').tap();
    expect(
      await page
        .locator('.mh-screen')
        .evaluate((el) => el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight),
    ).toBe(true);
    const commit = await page.locator('[data-focus="ng-commit"]').boundingBox();
    expect(commit.height).toBeGreaterThanOrEqual(32);
    await page.screenshot({ path: `test-results/ng-plus-${width}.png` });
  });
