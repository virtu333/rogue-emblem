// Traits v2: recruit cards and the roster sheet spell out what each trait does
// for THIS unit (the stat Kindled raises, the perk Slow Oath doubles), at phone
// landscape and desktop. Captures feed docs/art-direction/gameplay/traits-v2/.
import { test, expect } from '@playwright/test';
import { waitForScene } from './helpers.js';

const SHOTS = process.env.TRAITS_V2_SHOTS || null;
const VIEWPORTS = [
  { label: '844x390', width: 844, height: 390 },
  { label: '1280x800', width: 1280, height: 800 },
];

async function bootNodeMap(page) {
  await page.addInitScript(() =>
    localStorage.setItem(
      'emblem_rogue_settings',
      JSON.stringify({ musicVolume: 0, sfxVolume: 0, hints: false }),
    ),
  );
  await page.goto('/?devScene=nodemap&preset=battle_smoke&seed=42&mobilePreview=1');
  await waitForScene(page, 'NodeMap');
  // The act's opening conversation can land a beat after the scene reports ready.
  const skip = page.getByRole('button', { name: 'Skip conversation', exact: true });
  try {
    await skip.waitFor({ state: 'visible', timeout: 10_000 });
    await skip.click();
    await skip.waitFor({ state: 'detached', timeout: 10_000 });
  } catch {
    // No opening conversation on this route.
  }
}

for (const vp of VIEWPORTS) {
  test.describe(`traits v2 at ${vp.label}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test('boss recruit card shows each trait’s concrete effect', async ({ page }) => {
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await bootNodeMap(page);
      await page.evaluate(async () => {
        const s = window.__emblemRogueGame.scene.getScene('NodeMap');
        const { generateBossRecruitCandidates } = await import('/src/engine/BossRecruitSystem.js');
        const { showArrivalMenu } = await import('/src/ui/PartyMenus.js');
        const rm = s.runManager;
        const candidates = generateBossRecruitCandidates(
          'act2',
          rm.roster,
          s.gameData,
          rm.getEffectiveMetaEffects(),
          [],
        );
        const first = candidates[0].unit;
        first.traits = ['slow_oath', 'gifted'];
        if (candidates[1]) candidates[1].unit.traits = ['reckless', 'stalwart'];
        window.__traitOwner = { scene: s, gameData: s.gameData };
        showArrivalMenu(window.__traitOwner, 'Boss recruit', candidates, () => {}, {
          skip: true,
        });
      });
      const dialog = page.getByRole('dialog', { name: 'Boss recruit', exact: true });
      await expect(dialog).toBeVisible();
      // Candidates are draft cards side by side (#79); each trait is a card line: its
      // name in bold, then this unit's concrete effect.
      const cards = dialog.locator('.ch-card.ch-unit');
      const trait = (card, name) =>
        card.locator('.ch-line', { has: page.locator('b', { hasText: new RegExp(`^${name}$`) }) });
      const effect = (card, name) => trait(card, name).locator('.ch-line-text');
      await expect(effect(cards.nth(0), 'Slow Oath')).toHaveText(
        /^\s*Masters its class in 10 battles, not 8; .+ becomes .+ \(from .+\)\.$/,
      );
      await expect(effect(cards.nth(0), 'Kindled')).toHaveText(
        /^\s*\+1 (Str|Mag) and \+10% (Str|Mag) growth \(the stat it (fights|heals) with\)\.$/,
      );
      await expect(dialog).not.toContainText('instead of the class perk');
      const lines = cards.nth(0).locator('.ch-lines');
      await trait(cards.nth(0), 'Slow Oath').scrollIntoViewIfNeeded();
      expect(await lines.evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/boss-recruit-${vp.label}.png` });
      if ((await cards.count()) > 1) {
        await expect(effect(cards.nth(1), 'Reckless')).toHaveText(
          '+3 Atk when it initiates; -2 Def when an enemy initiates.',
        );
        await expect(effect(cards.nth(1), 'Stalwart')).toHaveText(
          '+2 Def when an enemy initiates.',
        );
      }
      expect(errors).toEqual([]);
    });

    test('roster sheet lists traits with this unit’s numbers', async ({ page }) => {
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await bootNodeMap(page);
      await page.evaluate(() => {
        const s = window.__emblemRogueGame.scene.getScene('NodeMap');
        const sera = s.runManager.roster.find((u) => u.name === 'Sera');
        sera.traits = ['gifted', 'slow_oath'];
        s._openRoster();
      });
      const roster = page.locator('.mr-sheet');
      await roster.getByRole('button', { name: /Sera/ }).click();
      await expect(roster).toContainText('Kindled');
      await expect(roster).toContainText('+1 Mag and +10% Mag growth (the stat it fights with).');
      await expect(roster).toContainText(
        /Masters its class in 10 battles, not 8; Radiance becomes \+2 Atk, \+2 Res \(from \+1 Atk, \+1 Res\)\./,
      );
      await expect(roster).toContainText('Radiance ×2');
      await roster.getByText('Kindled', { exact: true }).scrollIntoViewIfNeeded();
      expect(await roster.evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/roster-traits-${vp.label}.png` });
      expect(errors).toEqual([]);
    });
  });
}
