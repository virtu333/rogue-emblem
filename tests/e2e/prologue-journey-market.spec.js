// The whole first thread on desktop, through ordinary play only (docs/specs/prologue-
// chapter.md §9, "Tests"): New Game's offer, P1's guided steps and its fight, P2 the
// lesson's way (Gaspar chips the Archer, Edric finishes it), the reward card, the fork's
// Market (Tamsin's card, the roster lesson's Withdraw and Equip on the real buttons),
// P3 (Edric Talks to Sera on turn 1, she heals him), the watchtower's Rest, P4's deploy
// screen and formation, Varro felled by the player's own attack, Edric's Seize on the
// gate from the action menu, the ending once, the handoff, Home Base with the grant,
// and a refresh there that pays nothing twice. Nothing calls onVictory, removeUnit,
// completeBattle or a setter: every step is a click or a key (prologueDriver.js), and
// every wait is on state.
import { test, expect } from '@playwright/test';
import { bootDesktop, driver, activeScene, slotMeta, slotRun } from './prologueDriver.js';
import {
  startPrologue,
  playP1,
  playP2,
  toRoute,
  forkStop,
  enterP3,
  playP3TalkFirst,
  watchtower,
  enterP4,
  varroAlive,
  seizeWithEdric,
} from './prologueJourney.js';

test.setTimeout(900_000);

test('the Market road: New Game to Home Base through ordinary play, Varro to the player, the Seize from the menu', async ({
  browser,
}) => {
  const { context, page, errors } = await bootDesktop(browser);
  const d = driver(page);
  await startPrologue(d, { via: 'new-game' });
  expect((await slotMeta(page)).prologue.state).toBe('in_progress');

  // P1: the guided steps, the forecast's note, then the fight.
  await playP1(d);
  expect(d.notes().filter((n) => n.includes('Reading a forecast'))).toHaveLength(1);
  await toRoute(d);
  expect(d.lines()).toContain('Gaspar: Gaspar The saddle was not consulted. Continue');
  expect((await slotMeta(page)).prologue.chaptersCompleted).toEqual(['p1_banner_at_dawn']);

  // P2: Gaspar's note on his first selection, the doubling note on his forecast, the
  // chip-then-finish practised for real.
  await playP2(d);
  await toRoute(d);
  expect(d.notes().some((n) => n.includes('Gaspar is strong now but barely grows'))).toBe(true);
  expect(d.notes().some((n) => n.includes("Tap a node to see what it holds. Travel commits; you can't come back."))).toBe(true); // prettier-ignore
  const afterP2 = await slotMeta(page);
  expect(afterP2.prologue.chaptersCompleted).toEqual(['p1_banner_at_dawn', 'p2_old_hands']);
  expect(afterP2.prologue.practised).toEqual(expect.arrayContaining(['forecast', 'veteran_kills'])); // prettier-ignore

  // The fork: Harrow's Market, Tamsin's card, the roster lesson's core on the real buttons.
  await forkStop(d, 'market', { lesson: 'core' });
  const atMarket = await slotRun(page);
  expect(atMarket.roster.map((u) => u.name)).toEqual(['Edric', 'Gaspar', 'Tamsin']);
  expect(atMarket.prologueRosterLesson).toMatchObject({ more: 'declined' });
  expect(atMarket.roster.find((u) => u.name === 'Tamsin').weapon?.name).toBe('Iron Bow');

  // P3: armed, so Travel asks nothing; Edric reaches Sera and Talks; she heals him.
  await enterP3(d);
  await playP3TalkFirst(d);
  await toRoute(d);
  expect(d.lines()).toContain(
    "Sera: Sera I don't stand at the front. I stand where they can't reach me. Skip conversation Continue",
  );
  const afterP3 = await slotMeta(page);
  expect(afterP3.prologue.chaptersCompleted).toHaveLength(3);
  expect(afterP3.prologue.practised).toEqual(expect.arrayContaining(['recruit', 'heal']));
  expect((await slotRun(page)).roster.map((u) => u.name)).toContain('Sera');

  // The watchtower: Sera's vision once, then Rest.
  await watchtower(d, { choice: 'rest' });
  expect(d.lines().filter((l) => l.includes('From up here I can see it.'))).toHaveLength(1);

  // P4: the deploy note, the screen, Varro's lines, the formation, the seize/par note.
  // Edric, Gaspar and Sera: swords for the axes, and a healer.
  await enterP4(d, { deploy: ['Gaspar', 'Sera'] });
  expect(d.notes().filter((n) => n.includes('Your commander always deploys.'))).toHaveLength(1);
  expect(d.notes().filter((n) => n.includes('Seize: defeat Captain Varro'))).toHaveLength(1);
  // Fight until Varro falls, every unit choosing its own strike: the boss falls to a
  // strike the player chose (the turn's own attack), never to a script.
  let killer = null;
  for (let n = 0; n < 16 && (await varroAlive(page)); n++) {
    const s = await d.battleState();
    if (s.phase !== 'player') {
      await d.nextTurn(s.turn);
      continue;
    }
    // The guard and the Fighter first. Then Varro, the player's way: Gaspar takes the
    // step below the gate while Varro is too strong for a counter to finish him (his
    // swing meets Gaspar's sword: 8 twice), then Gaspar's own attack ends him. The
    // others hold back out of his reach.
    const guards = await page.evaluate(
      () => window.__emblemRogueGame.scene.getScene('Battle').enemyUnits.filter((u) => !u.isBoss).length, // prettier-ignore
    );
    const varroHp = await page.evaluate(
      () => window.__emblemRogueGame.scene.getScene('Battle').enemyUnits.find((u) => u.isBoss)?.currentHP ?? 0, // prettier-ignore
    );
    const optsFor = (name) => {
      if (guards) return { targets: ['k', 'a'], caution: name === 'Gaspar' ? 1 : 2 };
      if (name === 'Gaspar')
        return varroHp > 16
          ? { attack: false, toward: { col: 9, row: 1 }, caution: 0 }
          : { targets: ['v'], minKill: 0.5, caution: 0 };
      return { attack: false, caution: 3, toward: name === 'Sera' ? { col: 8, row: 4 } : { col: 6, row: 3 } }; // prettier-ignore
    };
    const order = ['Gaspar', 'Sera', 'Edric'];
    for (const name of order) {
      const u = await d.unit(name);
      if (!u || u.acted || !(await varroAlive(page))) continue;
      if ((await d.battleState()).phase !== 'player') break;
      const plan =
        name === 'Sera'
          ? await d.support('Sera', { fallback: optsFor(name) })
          : await d.act(name, optsFor(name));
      if (plan.kind === 'attack' && plan.target === 'v' && !(await varroAlive(page))) killer = name;
    }
    const after = await d.battleState();
    if (after.phase === 'player' && after.turn === s.turn) {
      const all = await page.evaluate(() =>
        window.__emblemRogueGame.scene.getScene('Battle').playerUnits.every((u) => u.hasActed),
      );
      if (!all && (await varroAlive(page))) await d.endTurn();
      else if (all) await d.nextTurn(s.turn);
    }
  }
  expect(killer, 'a player attack felled Varro').not.toBeNull();
  // His fall: Edric's line once, the coach on the gate, the battle still the player's.
  await d.drain(() => {
    const b = window.__emblemRogueGame.scene.getScene('Battle');
    return !b._prologue?.isPresenting?.() && b.turnManager.currentPhase === 'player';
  });
  expect(d.lines().filter((l) => l.includes('Varro is down. The gate is ours to take'))).toHaveLength(1); // prettier-ignore
  await expect(page.getByRole('region', { name: 'Prologue guide', exact: true })).toContainText(
    'A lord: step onto the gate and Seize',
  );
  expect(await page.evaluate(() => window.__emblemRogueGame.scene.getScene('Battle').objectiveText?.text)).toBe('Seize: Capture throne with a Lord!'); // prettier-ignore

  // Edric walks to the gate and Seizes it from the action menu: the ending, once.
  await seizeWithEdric(d);
  const handoff = await d.dialog('From here, it counts');
  // Each ending line once (Varro's last words, the Hollow Sun, Sera's break).
  for (const [speaker, text] of [
    ['Captain Varro', 'Nobody said what was coming up the road.'],
    ['Sera', 'The Hollow Sun.'],
    ['Sera', 'It was never yours to stop.'],
  ])
    expect(
      d.log.filter((e) => e.kind === 'line' && e.name === speaker && e.text.includes(text)),
      `${speaker}: ${text} in ${JSON.stringify(d.lines())}`,
    ).toHaveLength(1);
  await expect(handoff).toContainText('Prologue complete');
  await expect(handoff).toContainText('Losing your commander');
  // Nothing written until it is read.
  expect((await slotMeta(page)).prologue.state).toBe('in_progress');
  // Read slowly (playtest): past the battle's post-loot fallback, which once forced a
  // second exit under the ending and opened "Could not open Run Complete". Wait on the
  // fallback's own clock, beyond its story grace and a recheck.
  await page.waitForFunction(
    () => {
      const b = window.__emblemRogueGame.scene.getScene('Battle');
      return Date.now() - b._postLootTransitionStartedAt > 32_000;
    },
    null,
    { timeout: 60_000, polling: 500 },
  );
  await expect(page.getByText('Transition failed')).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'From here, it counts' })).toHaveCount(1);
  expect(await page.evaluate(() => window.__sceneState?.activeScene)).toBe('Battle');
  await d.click(handoff.getByRole('button', { name: 'To Home Base', exact: true }));
  await activeScene(page, 'HomeBase');
  const meta = await slotMeta(page);
  expect(meta.prologue).toMatchObject({ state: 'complete', grantPaid: true });
  expect(meta.prologue.chaptersCompleted).toEqual([
    'p1_banner_at_dawn',
    'p2_old_hands',
    'p3_seer_on_the_road',
    'p4_quarry_gate',
  ]);
  expect(meta.prologue.practised).toEqual(expect.arrayContaining(['seize', 'deploy']));
  expect([meta.totalValor, meta.totalSupply, meta.runsStarted]).toEqual([50, 35, 0]);
  expect(await slotRun(page)).toBeNull();

  // A refresh at Home Base pays nothing twice.
  await page.reload();
  await activeScene(page, 'Title');
  const again = await slotMeta(page);
  expect([again.totalValor, again.totalSupply, again.prologue.grantPaid]).toEqual([50, 35, true]);
  expect(errors).toEqual([]);
  await context.close();
});
