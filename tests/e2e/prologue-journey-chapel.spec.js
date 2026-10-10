// The first thread the wrong way round, on desktop, through ordinary play only
// (docs/specs/prologue-chapter.md §9, "Tests"): P1's guided steps tried on the wrong
// tiles first and its forecast cancelled again and again; P2 with Gaspar taking every
// kill (the chip lesson ignored: the chapter still completes and veteran_kills is never
// marked practised); the fork's Chapel (Heal all), the roster lesson's Withdraw skipped
// and the lesson dropped, so Tamsin leaves unarmed: the departure asks, Continue anyway
// goes on; P3 with Tamsin's greyed Attack ("Unarmed"), every Soldier felled before
// anyone Talks (the rout waits on Sera: the battle stays playable, the objective and the
// coach say so), then Edric walks round to Sera's far side and Talks, which wins it; the
// watchtower's Scavenge; P4 without Tamsin, Varro felled by Gaspar's counter on the enemy
// phase, the next turn playable, Edric's Seize, the ending, Home Base with the grant.
import { test, expect } from '@playwright/test';
import { bootDesktop, driver, activeScene, slotMeta, slotRun } from './prologueDriver.js';
import {
  startPrologue,
  playP1,
  playP2,
  toRoute,
  forkStop,
  enterP3,
  talkToSera,
  watchtower,
  enterP4,
  varroAlive,
  seizeWithEdric,
  coach,
} from './prologueJourney.js';

test.setTimeout(900_000);

test('the Chapel road the wrong way round: nudges, cancelled forecasts, Gaspar takes the kills, Tamsin unarmed, the rout before the Talk, Varro to a counter', async ({
  browser,
}) => {
  const { context, page, errors } = await bootDesktop(browser);
  const d = driver(page);
  await startPrologue(d);

  // P1: the wrong tiles before each guided step, the forecast cancelled three times.
  await playP1(d, { wrongWay: true, cancels: 3 });
  await toRoute(d);
  // The forecast note once, however often the forecast opened.
  expect(d.notes().filter((n) => n.includes('Reading a forecast'))).toHaveLength(1);
  expect((await slotMeta(page)).prologue.practised).toEqual(['forecast']);

  // P2: Gaspar takes every kill. The chapter completes; the lesson is not practised.
  await playP2(d, { gasparKills: true });
  await toRoute(d);
  const afterP2 = await slotMeta(page);
  expect(afterP2.prologue.chaptersCompleted).toEqual(['p1_banner_at_dawn', 'p2_old_hands']);
  expect(afterP2.prologue.practised).not.toContain('veteran_kills');

  // The Chapel: Heal all, then the roster lesson with Withdraw skipped and the lesson
  // dropped. Tamsin leaves unarmed; her bow waits in the convoy.
  await forkStop(d, 'chapel', { lesson: 'skip-withdraw' });
  const atChapel = await slotRun(page);
  expect(atChapel.roster.find((u) => u.name === 'Tamsin').weapon ?? null).toBeNull();
  expect(atChapel.convoy.weapons.map((w) => w.name)).toEqual(['Iron Bow']);
  expect(atChapel.roster.find((u) => u.name === 'Edric').currentHP).toBe(
    atChapel.roster.find((u) => u.name === 'Edric').stats.HP,
  );

  // The departure asks (never blocks): Continue anyway.
  await enterP3(d, { unarmedWarning: true });
  // Tamsin's Attack is greyed with its reason; she Waits.
  await d.select('Tamsin');
  const tamsin = await d.unit('Tamsin');
  await d.moveSelected(tamsin.col, tamsin.row);
  expect((await d.publishedMenu()).find((m) => m.label === 'Attack')).toEqual({
    label: 'Attack',
    disabled: true,
    why: 'Unarmed: no weapon to attack with',
  });
  await d.menu('Wait');
  await d.acted('Tamsin');

  // Nobody Talks: every Soldier falls first. Tamsin keeps out of reach.
  const p3Order = ['Gaspar', 'Edric', 'Tamsin'];
  const p3Opts = (name) => (name === 'Tamsin' ? { attack: false, caution: 10, toward: { col: 0, row: 3 } } : {}); // prettier-ignore
  for (let n = 0; n < 16; n++) {
    const left = await page.evaluate(
      () => window.__emblemRogueGame.scene.getScene('Battle').enemyUnits.length,
    );
    if (!left) break;
    const s = await d.battleState();
    if (s.phase !== 'player') await d.nextTurn(s.turn);
    else await d.playTurn(p3Order, p3Opts);
  }
  // The rout waits on Sera: the battle is still the player's, and says what is left.
  await d.drain(() => {
    const b = window.__emblemRogueGame.scene.getScene('Battle');
    return b.enemyUnits.length === 0 && b.battleState !== 'TUTORIAL_HINT' && !b._prologue.isPresenting(); // prettier-ignore
  });
  expect(await d.battleOver()).toBe(false);
  expect(
    await page.evaluate(() => window.__emblemRogueGame.scene.getScene('Battle').objectiveText?.text), // prettier-ignore
  ).toBe('Rout: Sera must join to win\nRecruit: reach Sera with a lord · Talk');
  await expect(coach(page)).toContainText('Reach Sera and Talk');
  expect(await page.evaluate(() => window.__emblemRogueGame.scene.getScene('Battle').npcUnits.map((u) => u.name))).toEqual(['Sera']); // prettier-ignore

  // Edric walks round to Sera's far side and Talks: her join wins the chapter.
  for (let n = 0; n < 6 && !(await d.battleOver()); n++) {
    const s = await d.battleState();
    if (s.phase !== 'player') {
      await d.nextTurn(s.turn);
      continue;
    }
    const spot = await talkToSera(d, { side: [1, 0] });
    await d.select('Edric');
    const plan = await d.plan('Edric', { attack: false, toward: spot });
    await d.moveSelected(plan.to.col, plan.to.row);
    if ((await d.menuItems()).includes('Talk')) {
      await d.menu('Talk');
      break;
    }
    await d.menu('Wait');
    await d.acted('Edric');
    if (!(await d.battleOver()) && (await d.battleState()).phase === 'player') {
      const all = await page.evaluate(() =>
        window.__emblemRogueGame.scene.getScene('Battle').playerUnits.every((u) => u.hasActed),
      );
      if (all) await d.nextTurn(s.turn);
      else await d.endTurn();
    }
  }
  await toRoute(d);
  expect(d.log.some((e) => e.name === 'Sera joins your army')).toBe(true);
  expect((await slotRun(page)).roster.map((u) => u.name)).toEqual(['Edric', 'Gaspar', 'Tamsin', 'Sera']); // prettier-ignore
  expect((await slotMeta(page)).prologue.chaptersCompleted).toHaveLength(3);

  // The watchtower: Scavenge this time.
  await watchtower(d, { choice: 'scavenge' });

  // P4 without Tamsin. Clear the guard and the Fighter, then Gaspar holds the step
  // below the gate and never strikes Varro: his counter on the enemy phase does it.
  await enterP4(d, { deploy: ['Gaspar', 'Sera'] });
  const below = { col: 9, row: 1 };
  let fellOnEnemyPhase = null;
  for (let n = 0; n < 20 && (await varroAlive(page)); n++) {
    const s = await d.battleState();
    if (s.phase !== 'player') {
      const turn = s.turn;
      await d.drain((turn) => {
        const b = window.__emblemRogueGame.scene.getScene('Battle');
        return !b.enemyUnits.some((u) => u.isBoss) || b.turnManager.currentPhase === 'player' || b.turnManager.turnNumber > turn; // prettier-ignore
      }, turn);
      if (!(await varroAlive(page)) && fellOnEnemyPhase === null)
        fellOnEnemyPhase = (await d.battleState()).phase === 'enemy';
      if (await varroAlive(page)) await d.idle();
      continue;
    }
    const guards = await page.evaluate(
      () =>
      window.__emblemRogueGame.scene.getScene('Battle').enemyUnits.filter((u) => !u.isBoss).length, // prettier-ignore
    );
    for (const name of ['Gaspar', 'Edric', 'Sera']) {
      const u = await d.unit(name);
      if (!u || u.acted) continue;
      if ((await d.battleState()).phase !== 'player' || !(await varroAlive(page))) break;
      if (name === 'Sera')
        await d.support('Sera', { below: 0.8, fallback: { attack: false, caution: 3, toward: { col: 8, row: 3 } } }); // prettier-ignore
      else if (guards) await d.act(name, { targets: ['k', 'a'], caution: 2 });
      else if (name === 'Gaspar') await d.act(name, { attack: false, toward: below, caution: 0 });
      else await d.act(name, { attack: false, caution: 3, toward: { col: 7, row: 3 } });
    }
    const after = await d.battleState();
    if (after.phase === 'player' && after.turn === s.turn && (await varroAlive(page))) {
      const all = await page.evaluate(() =>
        window.__emblemRogueGame.scene.getScene('Battle').playerUnits.every((u) => u.hasActed),
      );
      if (!all) await d.endTurn();
    }
  }
  expect(fellOnEnemyPhase, 'Varro fell on the enemy phase').toBe(true);
  // His line plays once, the phase goes on, and the next player turn is playable.
  await d.idle();
  expect(d.lines().filter((l) => l.includes('Varro is down. The gate is ours to take'))).toHaveLength(1); // prettier-ignore
  await expect(coach(page)).toContainText('A lord: step onto the gate and Seize');

  await seizeWithEdric(d);
  const handoff = await d.dialog('From here, it counts');
  await expect(handoff).toContainText('Prologue complete');
  await d.click(handoff.getByRole('button', { name: 'To Home Base', exact: true }));
  await activeScene(page, 'HomeBase');
  const meta = await slotMeta(page);
  expect(meta.prologue).toMatchObject({ state: 'complete', grantPaid: true });
  expect(meta.prologue.chaptersCompleted).toHaveLength(4);
  expect(meta.prologue.practised).not.toContain('veteran_kills');
  expect([meta.totalValor, meta.totalSupply, meta.runsStarted]).toEqual([50, 35, 0]);
  await page.reload();
  await activeScene(page, 'Title');
  const again = await slotMeta(page);
  expect([again.totalValor, again.totalSupply]).toEqual([50, 35]);
  expect(errors).toEqual([]);
  await context.close();
});
