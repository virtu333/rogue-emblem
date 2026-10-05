// A named unit's fall in the prologue, through real combat on the enemy phase
// (docs/specs/prologue-chapter.md §8, §9): never a defeat. With no Vision charge (P2),
// "Not this thread" plays and the chapter restarts from its entry. In P3, once the
// chapter's own Vision charge is granted, the fall offers the rewind first: Rewind
// takes the turn back and spends the charge; the next fall, with none left, restarts
// the chapter, the grant reverted with it. The units walk into the enemy's reach by
// ordinary moves (the driver's planner told to seek danger) and the enemy does the rest.
import { test, expect } from '@playwright/test';
import { bootDesktop, driver, activeScene, slotMeta, slotRun } from './prologueDriver.js';
import {
  startPrologue,
  playP1,
  playP2,
  toRoute,
  travel,
  forkStop,
  enterP3,
} from './prologueJourney.js';

test.setTimeout(900_000);

const fellLine = (d) => d.log.some((e) => e.name === '???' && e.text.includes('Not this thread.'));

/**
 * Play turns where `victim` walks into the most danger it can reach and never strikes,
 * the others hold still, until a fall stops the battle (the fate offer, or the line).
 * Returns 'fate' when the rewind is offered, 'line' when the chapter restarts.
 */
async function sacrifice(d, victim, others) {
  for (let n = 0; n < 12; n++) {
    const fate = await d.drain(
      () => {
        const b = window.__emblemRogueGame?.scene?.getScene('Battle');
        return b?.battleState === 'PLAYER_IDLE' && b.turnManager.currentPhase === 'player' && !b._prologue?.isPresenting?.(); // prettier-ignore
      },
      null,
      { stopAt: (top) => top.buttons.includes('Accept Fate') || (top.name === '???' && top.text.includes('Not this thread.')) }, // prettier-ignore
    );
    if (fate) {
      const top = await d.page.evaluate(() => {
        const all = [...document.querySelectorAll('[role="dialog"]')].filter((e) => e.getClientRects().length); // prettier-ignore
        return all.at(-1)?.getAttribute('aria-label');
      });
      return top === '???' ? 'line' : 'fate';
    }
    const s = await d.battleState();
    const v = await d.unit(victim);
    if (v && !v.acted) await d.act(victim, { attack: false, caution: -1 });
    for (const name of others) {
      const u = await d.unit(name);
      const now = await d.battleState();
      if (now.phase !== 'player' || now.turn !== s.turn) break;
      if (u && !u.acted) await d.act(name, { stay: true, attack: false });
    }
    const after = await d.battleState();
    if (after.phase === 'player' && after.turn === s.turn) {
      const all = await d.page.evaluate(() =>
        window.__emblemRogueGame.scene.getScene('Battle').playerUnits.every((u) => u.hasActed),
      );
      if (!all) await d.page.keyboard.press('e');
    }
  }
  throw new Error(`${victim} never fell`);
}

/** The chapter as it opens: who stands where, at what HP, and the turn. */
const entry = (page) =>
  page.evaluate(() => {
    const b = window.__emblemRogueGame.scene.getScene('Battle');
    return {
      turn: b.turnManager.turnNumber,
      players: b.playerUnits.map((u) => [u.name, u.col, u.row, u.currentHP === u.stats.HP]),
      enemies: b.enemyUnits.map((u) => [u.authoredId, u.col, u.row, u.currentHP === u.stats.HP]),
      npcs: (b.npcUnits || []).map((u) => u.name),
      charges: b.runManager.visionChargesRemaining,
    };
  });

test('P2: Gaspar falls on the enemy phase with no Vision: Not this thread, the chapter again from its entry', async ({
  browser,
}) => {
  const { context, page, errors } = await bootDesktop(browser);
  const d = driver(page);
  await startPrologue(d);
  await playP1(d);
  await toRoute(d);
  await travel(d, 'prologue_1');
  await activeScene(page, 'Battle');
  await d.idle();
  const before = await entry(page);
  expect(before.charges).toBe(0);
  await page.evaluate(() => {
    window.__p2Grid = window.__emblemRogueGame.scene.getScene('Battle').grid;
  });
  expect(await sacrifice(d, 'Gaspar', ['Edric'])).toBe('line');
  // The line, then the same node re-entered from its entry: never a defeat.
  await d.drain(() => {
    const b = window.__emblemRogueGame.scene.getScene('Battle');
    return (
      window.__sceneState?.activeScene === 'Battle' &&
      b.grid !== window.__p2Grid &&
      b.battleState === 'PLAYER_IDLE' &&
      !b._prologue?.isPresenting?.()
    );
  });
  expect(fellLine(d)).toBe(true);
  expect(d.lines().some((l) => l.includes('Stand again where the morning found you.'))).toBe(true);
  expect(await entry(page)).toEqual(before);
  const transitions = await page.evaluate(() => (window.__sceneState?.transitionAudits || []).map((a) => a.to)); // prettier-ignore
  expect(transitions).not.toContain('RunComplete');
  const run = await slotRun(page);
  expect(run.mode).toBe('prologue');
  expect(run.status).not.toBe('defeat');
  expect(run.battleInProgress?.nodeId).toBe('prologue_1');
  expect(run.roster.map((u) => u.name)).toEqual(['Edric', 'Gaspar']);
  const meta = await slotMeta(page);
  expect(meta.runsStarted ?? 0).toBe(0);
  expect(meta.prologue).toMatchObject({ state: 'in_progress', chaptersCompleted: ['p1_banner_at_dawn'] }); // prettier-ignore
  expect(errors).toEqual([]);
  await context.close();
});

test("P3: with the chapter's Vision charge a fall offers the rewind first; Rewind spends it; the next fall restarts the chapter and reverts the grant", async ({
  browser,
}) => {
  const { context, page, errors } = await bootDesktop(browser);
  const d = driver(page);
  await startPrologue(d);
  await playP1(d);
  await toRoute(d);
  await playP2(d);
  await toRoute(d);
  await forkStop(d, 'market');
  await enterP3(d);
  const before = await entry(page);
  expect(before.charges).toBe(0);
  // Turn 1 as taught: Edric Talks to Sera, she heals him.
  await d.talk('Edric', { col: 3, row: 2 });
  await d.heal('Sera', 'Edric');
  // Tamsin walks into the Soldiers' reach turn after turn; the rest hold.
  expect(await sacrifice(d, 'Tamsin', ['Gaspar', 'Sera', 'Edric'])).toBe('fate');
  const fate = page.locator('[role="dialog"]').filter({ hasText: 'Accepting fate restarts this chapter' }); // prettier-ignore
  await expect(fate).toContainText('Tamsin has fallen.');
  await expect(fate).toContainText('1 Vision left this run');
  await d.click(fate.getByRole('button', { name: 'Rewind', exact: true }));
  // The rewind picker: the latest point, confirmed for the one charge.
  const picker = await d.dialog('Rewind');
  await d.click(picker.getByRole('button', { name: /^Rewind here/ }));
  await expect(picker).toHaveCount(0);
  await d.idle();
  const rewound = await page.evaluate(() => {
    const b = window.__emblemRogueGame.scene.getScene('Battle');
    const t = b.playerUnits.find((u) => u.name === 'Tamsin');
    return { tamsin: Boolean(t && t.currentHP > 0), charges: b.runManager.visionChargesRemaining };
  });
  expect(rewound).toEqual({ tamsin: true, charges: 0 });
  expect(fellLine(d)).toBe(false);
  // Again, with no charge left: the line, and P3 from its entry, the grant undone.
  expect(await sacrifice(d, 'Tamsin', ['Gaspar', 'Sera', 'Edric'])).toBe('line');
  await d.drain(() => {
    const b = window.__emblemRogueGame.scene.getScene('Battle');
    return (
      window.__sceneState?.activeScene === 'Battle' &&
      b.turnManager.turnNumber === 1 &&
      (b.npcUnits || []).some((u) => u.name === 'Sera') &&
      b.battleState === 'PLAYER_IDLE' &&
      !b._prologue?.isPresenting?.()
    );
  });
  expect(await entry(page)).toEqual(before);
  const run = await slotRun(page);
  expect(run.prologueVisionGranted).toBe(false);
  expect(run.roster.map((u) => u.name)).toEqual(['Edric', 'Gaspar', 'Tamsin']);
  expect(run.status).not.toBe('defeat');
  expect(errors).toEqual([]);
  await context.close();
});
