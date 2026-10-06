// The Phase 2 Event surfaces (docs/specs/event-nodes-phase2.md §2E), played through the real UI on
// the review route (`?devScene=nodemap&preset=event&seed=N&event=dev_*`; the dev_* events are
// review fixtures, src/utils/devEventFixtures.js, and the shipped events use the same shapes):
//   - a multi-page event: counters, the step just taken, the trail behind it, a refresh;
//   - a roster tell under its choice, with the speaker's face;
//   - a contract: the chip on the route map, the pause list, the victory band's line;
//   - a route edit: the changed place ringed on the loom;
//   - someone who joins the army;
//   - the church's Cleanse vow, with a Debt it will not lift;
//   - a Dark Omen: its medal on the route and its page;
//   - the colosseum's "Bouts left here".
//
// Ways this can fail, a test each:
//   1. a step's news is only behind a closed toggle, a refresh re-rolls or drops the steps taken, or
//      the counters on the page differ from the saved ones;
//   2. a tell shows for no one, never shows its speaker, or appears under the wrong choice;
//   3. a contract the run holds has no chip (or says other terms than the engine's), is missing from
//      the pause list, or its victory line never reaches the band;
//   4. a route edit changes the map and the route map does not say so;
//   5. a join result shows no one, or the roster did not change;
//   6. the Cleanse picker offers a Debt, lifts the wrong burden, does not commit the church's vow
//      or does not save;
//   7. an event that fell to a fight wears the Omen's medal, or a Dark Omen does not;
//   8. the arena does not say how many bouts are left, on any screen that costs a fee;
//   9. any of it overflows the page at 640x480 and the landscape phones.
import { test, expect } from '@playwright/test';
import { collectErrors, finishFormation, waitForScene } from './helpers.js';
import {
  bootEvent,
  chooseThrough,
  enterNode,
  expectFits,
  press,
  refreshFromSlot,
  savedEvent,
} from './eventHelpers.js';

const SIZES = [
  { name: 'desktop 640x480', viewport: { width: 640, height: 480 }, mobile: false },
  { name: 'phone 844x390', viewport: { width: 844, height: 390 }, mobile: true },
  { name: 'phone 667x375', viewport: { width: 667, height: 375 }, mobile: true },
];

for (const size of SIZES) {
  test.describe(`event pages ${size.name}`, () => {
    test.use({ viewport: size.viewport, hasTouch: size.mobile, isMobile: size.mobile });
    test.describe.configure({ timeout: 150_000 });
    const tap = size.mobile;
    const query = (rest) => `${rest}${size.mobile ? '&mobilePreview=1' : ''}`;

    test('a three-page event: counters, the step just taken, the trail, a tell, a refresh', async ({
      page,
    }, info) => {
      const errors = collectErrors(page);
      await bootEvent(page, query('seed=42&event=dev_mine'), { tap });
      await enterNode(page, 'Event', { tap });
      const dialog = page.getByRole('dialog', { name: 'The Deep Mine', exact: true });
      await expect(dialog).toBeVisible();

      // The first page: the torches, three lit, and the Thief's tell under the choice it speaks to.
      const torches = dialog.locator('.ev-counter[data-counter="torches"]');
      await expect(torches).toHaveAttribute('aria-label', 'Torches: 3 of 3');
      await expect(torches.locator('.ev-pip.is-lit')).toHaveCount(3);
      await expect(torches).toContainText('Torches 3/3');
      const row = dialog
        .locator('.ev-choice-row')
        .filter({ has: page.locator('[data-choice="deeper"]') });
      await expect(row.locator('.ev-tell')).toContainText('Mira: This tunnel breathes.');
      await expect(row.locator('.ev-tell .mr-unit-face')).toHaveCount(1);
      await expect(dialog.locator('.ev-tell')).toHaveCount(1); // not under "Climb out"
      await expect(dialog.locator('.ev-trail-toggle')).toHaveCount(0);
      await expectFits(page, '.ev-menu');
      await page.screenshot({ path: info.outputPath('mine-page-1.png') });

      // Step one: the page changes at once; its news stays in view, the counters moved.
      await chooseThrough(page, dialog, /^Go deeper/, { tap });
      await expect(dialog.locator('.ev-intro')).toContainText('The tunnel narrows');
      const recent = dialog.locator('.ev-recent');
      await expect(recent).toContainText('Just now');
      await expect(recent).toContainText('You chose: Go deeper');
      await expect(recent).toContainText('Ore, glinting in the lamplight.');
      await expect(recent.locator('.ev-result[data-kind="gold"]')).toContainText('Gained 40 G');
      await expect(recent.locator('.ev-result[data-kind="counter"]')).toContainText('Torches −1');
      await expect(recent.locator('.ev-result[data-kind="counter"]')).toContainText('2 left');
      await expect(torches).toHaveAttribute('aria-label', 'Torches: 2 of 3');
      await expect(torches.locator('.ev-pip.is-lit')).toHaveCount(2);
      await expect(dialog.locator('.ev-trail-toggle')).toHaveCount(0); // the one step is the recent one
      await expect(dialog.locator('.ev-tell')).toHaveCount(0);
      expect(await savedEvent(page)).toMatchObject({
        eventId: 'dev_mine',
        page: 'level_two',
        steps: 1,
        choiceId: null,
        counters: { torches: 2 },
        completed: false,
      });
      await expectFits(page, '.ev-menu');
      await page.screenshot({ path: info.outputPath('mine-page-2.png') });

      // Step two: the older step goes behind the toggle, closed; open, it shows what it said.
      await chooseThrough(page, dialog, /^Deeper still/, { tap });
      await expect(dialog.locator('.ev-intro')).toContainText('Something sleeps here');
      await expect(dialog.locator('.ev-recent')).toContainText('An old pay chest');
      const toggle = dialog.locator('.ev-trail-toggle');
      await expect(toggle).toContainText('Earlier on this road · 1 step');
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await expect(dialog.locator('.ev-step')).toHaveCount(0);
      await press(toggle, tap);
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      const step = dialog.locator('.ev-step');
      await expect(step).toHaveCount(1);
      await expect(step).toContainText('You chose: Go deeper');
      await expect(step).toContainText('Ore, glinting in the lamplight.');
      await expect(step.locator('.ev-result[data-kind="gold"]')).toContainText('Gained 40 G');
      await expect(torches).toHaveAttribute('aria-label', 'Torches: 1 of 3');
      await expectFits(page, '.ev-menu');
      await page.screenshot({ path: info.outputPath('mine-page-3-trail-open.png') });

      // A refresh here: the same page, both steps behind a closed toggle, nothing re-rolled.
      const before = await savedEvent(page);
      expect(before).toMatchObject({ page: 'level_three', steps: 2, counters: { torches: 1 } });
      await refreshFromSlot(page);
      await enterNode(page, 'Event', { label: 'Return to the event', tap });
      await expect(dialog.locator('.ev-intro')).toContainText('Something sleeps here');
      await expect(dialog.locator('.ev-recent')).toHaveCount(0);
      await expect(dialog.locator('.ev-trail-toggle')).toContainText(
        'Earlier on this road · 2 steps',
      );
      await expect(dialog.locator('.ev-trail-toggle')).toHaveAttribute('aria-expanded', 'false');
      expect(await savedEvent(page)).toEqual(before);

      // The last step ends the event: the outcome, the trail still there, then Continue.
      await chooseThrough(page, dialog, /^Take the hoard and run/, { tap });
      await expect(dialog.locator('.ev-chosen').first()).toContainText(
        'You chose: Take the hoard and run',
      );
      await expect(dialog.locator('.ev-outcome').first()).toContainText('It does not wake.');
      await expect(dialog.locator('.ev-trail-toggle')).toContainText('2 steps');
      await expect(dialog.getByRole('button', { name: 'Take the hoard and run' })).toHaveCount(0);
      await expect(dialog.locator('.ev-primary')).toHaveText('Continue');
      await expectFits(page, '.ev-menu');
      await page.screenshot({ path: info.outputPath('mine-outcome.png') });
      await press(dialog.locator('.ev-primary'), tap);
      await expect(dialog).toHaveCount(0);
      expect(await savedEvent(page)).toMatchObject({ completed: true, steps: 2 });
      expect(errors).toEqual([]);
    });

    test('the longest strings: a 32-character counter, a long tell, a price and a greyed choice', async ({
      page,
    }, info) => {
      await bootEvent(page, query('seed=42&event=dev_stress'), { tap });
      await enterNode(page, 'Event', { tap });
      const dialog = page.getByRole('dialog', {
        name: 'The Merchant of Unreasonably Long Titles',
        exact: true,
      });
      await expect(dialog).toBeVisible();
      await expect(dialog.locator('.ev-counter')).toHaveCount(2);
      await expect(dialog.locator('.ev-counter[data-counter="favours"] .ev-pip')).toHaveCount(0); // 12: a number only
      await expect(dialog.locator('.ev-tell')).toContainText('Bartholomew-Maximilian: That seal');
      await expect(
        dialog.getByRole('button', { name: /^This choice is greyed out/ }),
      ).toBeDisabled();
      await expect(dialog.locator('.ev-seal')).toHaveText('150 G');
      await expectFits(page, '.ev-menu');
      await page.screenshot({ path: info.outputPath('stress-page.png') });
      // Through to the second page with a burden on the first step's outcome.
      await chooseThrough(page, dialog, /^Buy the Sealed Reliquary/, { tap });
      await expect(dialog.locator('.ev-recent .ev-result[data-kind="burden"]')).toContainText(
        'Burden: Ill Omen',
      );
      await expectFits(page, '.ev-menu');
      await page.screenshot({ path: info.outputPath('stress-page-2.png') });
    });

    test('a contract: the chip on the route, its terms, the pause list, the line on the victory band', async ({
      page,
    }, info) => {
      const errors = collectErrors(page);
      await bootEvent(page, query('seed=7&event=dev_contract'), { tap });
      await expect(page.locator('.re-contract')).toHaveCount(0);
      await enterNode(page, 'Event', { tap });
      const dialog = page.getByRole('dialog', { name: 'The Mercenary Contract', exact: true });
      await chooseThrough(page, dialog, /^Win the next fight under par/, { tap });
      const line = dialog.locator('.ev-result[data-kind="contract"]');
      await expect(line).toContainText('Contract: Under par');
      await expect(line).toContainText('Win the next battle by turn par or sooner.');
      await expect(line).toContainText('Kept: +600 G. Broken: Debt 300 G.');
      expect((await savedEvent(page)).contract).toMatchObject({ goal: 'underPar' });
      await expectFits(page, '.ev-menu');
      await page.screenshot({ path: info.outputPath('contract-outcome.png') });
      await press(dialog.locator('.ev-primary'), tap);

      // The route map carries it: label and short line on the chip, the full terms on a tap.
      const chip = page.locator('.re-contract');
      await expect(chip).toHaveCount(1);
      await expect(chip).toContainText('Contract');
      await expect(chip).toContainText('Under par');
      await expect(chip).toHaveAttribute('title', /Kept: \+600 G\. Broken: Debt 300 G\./);
      await press(chip, tap);
      await expect(page.locator('.re-burden-note')).toContainText(
        'Win the next battle by turn par or sooner. Kept: +600 G. Broken: Debt 300 G.',
      );
      await expectFits(page, '.re-node-map');
      await page.screenshot({ path: info.outputPath('contract-chip.png') });
      await page.getByRole('button', { name: 'Menu', exact: true }).click();
      await expect(page.locator('.mp-burdens')).toContainText('Contract');
      await expect(page.locator('.mp-burdens')).toContainText('Win the next battle by turn par');
      await page.keyboard.press('Escape');
      await expect(page.locator('.mp-burdens')).toHaveCount(0);

      // The next battle, won on turn 1 (under par): the band says the contract was kept.
      await page
        .getByRole('button', { name: /^Battle · Available/ })
        .first()
        .click();
      await page.getByRole('button', { name: 'Travel', exact: true }).click();
      await waitForScene(page, 'Battle');
      await finishFormation(page);
      await page.evaluate(async () => {
        const s = window.__emblemRogueGame.scene.getScene('Battle');
        s.time.timeScale = 0.2; // the band moves on by itself: slow the clock, read it first
        for (const enemy of [...s.enemyUnits]) {
          enemy.currentHP = 0;
          await s.removeUnit(enemy, { killer: s.playerUnits[0] });
        }
        s.checkBattleEnd();
      });
      const band = page.locator('.ce-band-layer--victory');
      await expect(band.locator('.ce-band-sub')).toContainText('Contract kept: +600 G');
      await page.screenshot({ path: info.outputPath('contract-victory-band.png') });
      expect(errors).toEqual([]);
    });

    test('a new road: the place it leads to is ringed on the loom, and the line says so', async ({
      page,
    }, info) => {
      await bootEvent(page, query('seed=2&event=dev_roads'), { tap });
      const before = await page.evaluate(() => {
        const s = window.__emblemRogueGame.scene.getScene('NodeMap');
        const here = s.runManager.nodeMap.nodes.find((n) => n.type === 'event');
        return here.edges.length;
      });
      await enterNode(page, 'Event', { tap });
      const dialog = page.getByRole('dialog', { name: 'The Cartographer', exact: true });
      await chooseThrough(page, dialog, /^Hire her as a guide/, { tap });
      const line = dialog.locator('.ev-result[data-kind="route"]');
      await expect(line).toContainText('A new road opens to a village');
      await expectFits(page, '.ev-menu');
      await page.screenshot({ path: info.outputPath('road-outcome.png') });
      await press(dialog.locator('.ev-primary'), tap);
      // The map has one more road from here; the village at its end is ringed and selected.
      const after = await page.evaluate(() => {
        const s = window.__emblemRogueGame.scene.getScene('NodeMap');
        return s.runManager.nodeMap.nodes.find((n) => n.type === 'event').edges.length;
      });
      expect(after).toBe(before + 1);
      await expect(page.locator('.re-loom-changed')).toHaveCount(1);
      await expect(page.locator('.re-node.is-changed')).toHaveAttribute(
        'aria-label',
        /^Village · Available/,
      );
      await expect(page.locator('.re-eclipse-toast')).toContainText('A new road opens ahead.');
      await expect(page.locator('.re-loom-card')).toContainText(/village/i);
      await expectFits(page, '.re-node-map');
      await page.screenshot({ path: info.outputPath('road-route.png') });
    });

    test('a place redrawn: the line says what it was and the loom rings the new village', async ({
      page,
    }, info) => {
      await bootEvent(page, query('seed=2&event=dev_roads'), { tap });
      await enterNode(page, 'Event', { tap });
      const dialog = page.getByRole('dialog', { name: 'The Cartographer', exact: true });
      await chooseThrough(page, dialog, /^Ask about the road ahead/, { tap });
      const line = dialog.locator('.ev-result[data-kind="route"]');
      await expect(line).toContainText('A place ahead is now a village');
      await expect(line).toContainText(/It was an? (battle|recruit|church|colosseum)\./);
      await page.screenshot({ path: info.outputPath('redraw-outcome.png') });
      await press(dialog.locator('.ev-primary'), tap);
      await expect(page.locator('.re-loom-changed')).toHaveCount(1);
      await expect(page.locator('.re-node.is-changed')).toHaveAttribute(
        'aria-label',
        /^Village · /,
      );
      await expect(page.locator('.re-eclipse-toast')).toContainText('A place ahead has changed.');
      await expectFits(page, '.re-node-map');
      await page.screenshot({ path: info.outputPath('redraw-route.png') });
    });

    test('someone joins: their face and class on the result, and the roster has them', async ({
      page,
    }, info) => {
      await bootEvent(page, query('seed=42&event=dev_join'), { tap });
      const before = (await savedEvent(page)).roster;
      await enterNode(page, 'Event', { tap });
      const dialog = page.getByRole('dialog', { name: 'The Volunteer', exact: true });
      await chooseThrough(page, dialog, /^Take her on/, { tap });
      const line = dialog.locator('.ev-result[data-kind="join"]');
      await expect(line).toContainText('joins the army');
      await expect(line).toContainText(/Archer · Lv \d+/);
      await expect(line.locator('.mr-unit-face')).toHaveCount(1);
      const after = (await savedEvent(page)).roster;
      expect(after).toHaveLength(before.length + 1);
      const joined = after.find((name) => !before.includes(name));
      await expect(line).toContainText(`${joined} joins the army`);
      await expectFits(page, '.ev-menu');
      await page.screenshot({ path: info.outputPath('join-outcome.png') });
    });

    test('Cleanse: a row per burden with its words, Debt greyed, the vow committed and saved', async ({
      page,
    }, info) => {
      const errors = collectErrors(page);
      await bootEvent(page, query('seed=7&as=church&burdens=ill_omen:2,debt:450,hunted'), { tap });
      await enterNode(page, 'Church', { tap });
      const church = page.getByRole('dialog', { name: 'Church', exact: true });
      await expect(church).toBeVisible();
      const hunted = church.getByRole('button', { name: 'Hunted · 2 left' });
      await hunted.scrollIntoViewIfNeeded();
      await expect(church.getByRole('heading', { name: 'Cleanse · Free' })).toBeVisible();
      await expect(church.getByRole('button', { name: 'Ill Omen · 2 left' })).toBeEnabled();
      await expect(church.locator('.church-cleanse-text').first()).toContainText(
        'Each victory gathers more shadow until the omen passes.',
      );
      const debt = church.getByRole('button', { name: 'Debt · 450 G' });
      await expect(debt).toBeDisabled();
      await expect(church.locator('.church-cleanse-debt')).toContainText('The lender has lawyers');
      await expectFits(page, '.service-menu');
      await page.screenshot({ path: info.outputPath('cleanse-section.png') });

      // Backing out of the confirmation lifts nothing.
      await press(hunted, tap);
      const confirm = page.getByRole('dialog', { name: 'Lift Hunted?', exact: true });
      await expect(confirm).toContainText('This is your vow here');
      await press(confirm.getByRole('button', { name: 'Close', exact: true }), tap);
      expect((await savedEvent(page)).burdens).toEqual(['ill_omen', 'debt', 'hunted']);

      await press(hunted, tap);
      await press(confirm.getByRole('button', { name: 'Lift the burden', exact: true }), tap);
      await expect(church.locator('[role="status"]')).toContainText('Hunted lifted.');
      await expect(church.getByRole('button', { name: /^Ill Omen/ })).toHaveCount(0); // the vow is made
      await expect(church.locator('.church-vow-line')).toContainText('Your vow here was Cleansing');
      const saved = await savedEvent(page);
      expect(saved.burdens).toEqual(['ill_omen', 'debt']);
      expect(Object.values(saved.vows)).toEqual(['cleanse']);
      expect(errors).toEqual([]);
    });

    test('a Dark Omen: its medal on the route, its page; a swallowed road is an eclipsed battle', async ({
      page,
    }, info) => {
      await bootEvent(page, query('seed=42&event=drill_yard&omen=1'), { tap });
      const medal = page.getByRole('button', { name: /^Dark Omen · Available/ });
      await expect(medal).toHaveClass(/is-dark-omen/);
      await expect(medal.locator('.re-node-art')).toHaveAttribute('data-frame', '10');
      // The same map, an event that fell to a fight: no Omen medal on it.
      const frames = await page.evaluate(async () => {
        const { nodeFrame } = await import('/src/ui/RouteGraph.js');
        const s = window.__emblemRogueGame.scene.getScene('NodeMap');
        const node = s.runManager.nodeMap.nodes.find((n) => n.darkOmen);
        const swallowed = {
          ...node,
          darkOmen: undefined,
          type: 'battle',
          battleParams: { isElite: true, isEclipsed: true },
        };
        return { omen: nodeFrame(node, 'act1'), swallowed: nodeFrame(swallowed, 'act1') };
      });
      expect(frames).toEqual({ omen: 10, swallowed: 7 });
      await page.screenshot({ path: info.outputPath('omen-route.png') });
      await enterNode(page, 'Dark Omen', { tap });
      const dialog = page.getByRole('dialog', { name: 'The Drill Yard', exact: true });
      await expect(dialog).toBeVisible();
      await expect(dialog.locator('.ev-kicker')).toHaveText('DARK OMEN');
      await expect(dialog).toHaveClass(/is-dark-omen/);
      await expect(dialog.locator('.ev-intro')).toContainText('The yard is dark');
      await expectFits(page, '.ev-menu');
      await page.screenshot({ path: info.outputPath('omen-page.png') });
    });

    test('the colosseum says how many bouts are left on every screen that costs a fee', async ({
      page,
    }, info) => {
      await bootEvent(page, query('seed=7&as=colosseum'), { tap });
      await enterNode(page, 'Colosseum', { tap });
      const menu = page.getByRole('dialog', { name: 'Colosseum', exact: true });
      await expect(menu.locator('.arena-bouts-left')).toHaveText('Bouts left here: 5');
      await expectFits(page, '.service-menu');
      await page.screenshot({ path: info.outputPath('arena-menu.png') });
      await press(menu.getByRole('button', { name: 'Arena', exact: true }), tap);
      const units = page.getByRole('dialog', { name: 'Arena · Choose fighter', exact: true });
      await expect(units.locator('.arena-bouts-left')).toHaveText('Bouts left here: 5');
      await press(units.getByRole('button', { name: /^Edric ·/ }), tap);
      const tiers = page.getByRole('dialog', { name: 'Arena · Choose tier', exact: true });
      await expect(tiers.locator('.arena-bouts-left')).toHaveText('Bouts left here: 5');
      await expectFits(page, '.service-menu');
      await page.screenshot({ path: info.outputPath('arena-tiers.png') });
      await press(tiers.getByRole('button', { name: /^Bronze/ }), tap);
      const forecast = page.getByRole('dialog', { name: 'Arena · Combat forecast', exact: true });
      await expect(forecast.locator('.arena-bouts-left')).toHaveText('Bouts left here: 5');
      await page.screenshot({ path: info.outputPath('arena-forecast.png') });
    });
  });
}
