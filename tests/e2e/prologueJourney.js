// The prologue's chapters as a player plays them (docs/specs/prologue-chapter.md §6), on
// top of prologueDriver.js: every step is ordinary input (clicks and taps on the board,
// the action menu by keyboard or the phone's rail, the DOM's buttons). Each chapter
// helper starts where the previous one leaves the run and returns when the next screen
// is ready, so a spec can play the whole first thread or stop anywhere on the way.
// Decisions read the live board (the driver's planner); waits are on state.
import { expect } from '@playwright/test';
import { activeScene } from './prologueDriver.js';

/** No dialog on screen (the route map, the board, Home Base at rest). */
export const noDialog = () =>
  ![...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].some(
    (e) => e.getClientRects().length > 0,
  );

/** A fresh device's title: the promoted Prologue item starts the run. */
export async function startPrologue(d, { via = 'title' } = {}) {
  const { page } = d;
  if (via === 'new-game') {
    await d.click(page.getByRole('button', { name: 'New Game', exact: true }));
    await d.click(page.getByRole('button', { name: /^Play the Prologue/ }));
  } else await d.click(page.getByRole('button', { name: /^Prologue/ }));
  await activeScene(page, 'Battle');
  await d.idle();
}

export function coach(page) {
  return page.getByRole('region', { name: 'Prologue guide', exact: true });
}

/** The route map at rest (its notes read). */
export async function toRoute(d) {
  await d.drain(
    () =>
      window.__sceneState?.activeScene === 'NodeMap' &&
      Boolean(document.querySelector('.re-node-map')) &&
      ![...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].some(
        (e) => e.getClientRects().length > 0,
      ),
  );
}

/** Choose a route node and Travel (the map's own buttons). */
export async function travel(d, nodeId) {
  const route = d.page.locator('.re-node-map');
  await expect(route.locator(`.re-node[data-node="${nodeId}"]`)).toHaveClass(/is-live/);
  await d.click(route.locator(`.re-node[data-node="${nodeId}"]`));
  await d.click(route.getByRole('button', { name: 'Travel', exact: true }));
}

/** Who is on the board: [name, authored id, col, row, hp]. */
export function board(page) {
  return page.evaluate(() => {
    const b = window.__emblemRogueGame.scene.getScene('Battle');
    return [...b.playerUnits, ...b.enemyUnits, ...(b.npcUnits || [])].map((u) => [
      u.name,
      u.authoredId || '',
      u.col,
      u.row,
      u.currentHP,
    ]);
  });
}

/** Play turns with `order` (and per-unit plan options) until the battle is over. */
export async function fightOut(d, order, optsFor = () => ({}), { maxTurns = 20 } = {}) {
  for (let n = 0; n < maxTurns && !(await d.battleOver()); n++) {
    const s = await d.battleState();
    if (s.phase !== 'player') await d.nextTurn(s.turn);
    else await d.playTurn(order, optsFor);
  }
  expect(await d.battleOver(), 'the battle ended').toBe(true);
}

/**
 * P1, "Banner at Dawn": the guided select and the move onto the Fort, the first
 * forecast (its note) confirmed against the near Fighter, then Edric fights it out.
 * `wrongWay`: the wrong tile before each guided step (each is a nudge, nothing moves).
 * `cancels`: the forecast is cancelled and reopened that many times before Confirm.
 */
export async function playP1(d, { wrongWay = false, cancels = 0 } = {}) {
  const { page } = d;
  const goal = coach(page).locator('.re-coach-goal');
  await expect(goal).toHaveText('Select Edric');
  if (wrongWay) {
    // The Fort first, before anyone is selected: nothing is selected, nobody moves, the
    // step still asks for Edric.
    await d.tile(3, 2);
    expect(await d.battleState()).toMatchObject({ state: 'PLAYER_IDLE', selected: null });
    expect(await d.unit('Edric')).toMatchObject({ col: 0, row: 2 });
    await expect(goal).toHaveText('Select Edric');
  }
  await d.select('Edric');
  await expect(goal).toHaveText('Move onto the Fort');
  if (wrongWay) {
    // A tile beside the Fort, then one past it: nudges, Edric stays put.
    for (const [col, row] of [
      [2, 2],
      [3, 3],
    ]) {
      await d.tile(col, row);
      await expect(coach(page).locator('.re-coach-nudge')).toHaveText(
        'Move Edric to the gold-framed Fort.',
      );
    }
    expect(await d.unit('Edric')).toMatchObject({ col: 0, row: 2 });
  }
  await d.moveSelected(3, 2);
  await d.menu('Attack');
  await d.drain(() => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'SELECTING_TARGET'); // prettier-ignore
  const a = await d.enemy('a');
  await d.tile(a.col, a.row);
  await d.forecastOpen();
  for (let i = 0; i < cancels; i++) {
    await d.cancelForecast();
    // Looking costs nothing: no strike, no HP moved, the forecast opens again.
    expect((await d.enemy('a')).hp).toBe(a.hp);
    await d.tile(a.col, a.row);
    await d.forecastOpen();
  }
  await d.confirmForecast();
  await d.acted('Edric');
  await fightOut(d, ['Edric']);
}

/** The battle rewards: a card, then Choose reward (or Take gold for the skip). */
export async function claimReward(d, label = /^150 gold/) {
  const rewards = await d.dialog('Battle rewards');
  await d.click(rewards.getByRole('button', { name: label }));
  await d.click(rewards.getByRole('button', { name: 'Choose reward', exact: true }));
  await expect(rewards).toHaveCount(0);
}

/**
 * P2, "Old Hands". The lesson's way (default): Gaspar's lance chips the Archer, Edric
 * finishes it, then the two fight it out. `gasparKills`: the player ignores the lesson,
 * Edric only ever chips (never a strike that could kill) and Gaspar takes the kills.
 */
export async function playP2(d, { gasparKills = false } = {}) {
  await travel(d, 'prologue_1');
  await activeScene(d.page, 'Battle');
  await d.idle();
  if (gasparKills) {
    await fightOut(d, ['Edric', 'Gaspar'], (name) =>
      name === 'Edric' ? { noKill: 'hits', caution: 3 } : {},
    );
  } else {
    await d.act('Gaspar', { targets: ['a'], noKill: 'hits' });
    await d.act('Edric', { targets: ['a'] });
    await fightOut(d, ['Gaspar', 'Edric']);
  }
  await claimReward(d);
}

/**
 * The row-2 fork. `node`: 'market' (Harrow's Market) or 'chapel' (Harrow's Chapel).
 * Tamsin joins on arrival; the roster lesson runs from the service's Roster button:
 * `lesson` 'core' (Withdraw, then Equip, then Done on the offer) or 'skip-withdraw'
 * (Skip step on Withdraw, then Skip lesson: Tamsin stays unarmed). Leaves the service
 * on the route map.
 */
export async function forkStop(d, node, { lesson = 'core', healAll = true } = {}) {
  const { page } = d;
  const id = node === 'market' ? 'prologue_2a' : 'prologue_2b';
  const route = page.locator('.re-node-map');
  await d.click(route.locator(`.re-node[data-node="${id}"]`));
  await expect(route.locator('.re-loom-card')).toContainText(
    node === 'market' ? "Harrow's Market" : "Harrow's Chapel",
  );
  await d.click(route.getByRole('button', { name: 'Travel', exact: true }));
  const service = await d.dialog(node === 'market' ? 'Village' : 'Church');
  expect(d.log.some((e) => e.name === 'Tamsin joins your army')).toBe(true);
  if (node === 'chapel' && healAll)
    await d.click(service.getByRole('button', { name: /^Heal all/ }));
  await d.click(service.getByRole('button', { name: 'Roster', exact: true }));
  const roster = await d.dialog('Manage roster');
  const strip = roster.getByRole('region', { name: 'Roster lesson', exact: true });
  await expect(strip).toContainText('Roster lesson · 1 of 2 · Withdraw');
  if (lesson === 'core') {
    await d.click(roster.locator('.mr-unit-card', { hasText: 'Tamsin' }));
    await d.click(roster.getByRole('button', { name: 'Convoy', exact: true }));
    await d.click(
      roster
        .locator('.mr-item-card', { has: page.locator('h4', { hasText: 'Iron Bow' }) })
        .getByRole('button', { name: 'Withdraw', exact: true }),
    );
    await expect(strip).toContainText('Withdraw: done.');
    await expect(strip).toContainText('2 of 2 · Equip');
    // Equip: Gaspar's other weapon (whichever he is not holding now).
    await expect(strip).toContainText(/Equip Gaspar's (Iron Sword|Steel Lance)/);
    await d.click(roster.locator('.mr-unit-card', { hasText: 'Gaspar' }));
    await d.click(roster.getByRole('button', { name: 'Equipment', exact: true }));
    await d.click(roster.getByRole('button', { name: 'Equip', exact: true }));
    await expect(strip).toContainText('Equip: done.');
    await expect(strip).toContainText('More, if you like: Trade and Store');
    await d.click(strip.getByRole('button', { name: 'Done', exact: true }));
  } else {
    await d.click(strip.getByRole('button', { name: 'Skip step', exact: true }));
    await expect(strip).toContainText('2 of 2 · Equip');
    await d.click(strip.getByRole('button', { name: 'Skip lesson', exact: true }));
    await expect(strip).toHaveCount(0);
  }
  await d.click(roster.getByRole('button', { name: 'Close', exact: true }).first());
  await expect(roster).toHaveCount(0);
  await d.click(service.getByRole('button', { name: 'Leave', exact: true }));
  await expect(service).toHaveCount(0);
  await toRoute(d);
}

/**
 * P3, "The Seer on the Road". Talk first (default): Edric reaches Sera on turn 1 and
 * Talks, Sera heals the most hurt ally beside her, the rest fight. `routFirst`: nobody
 * Talks until every Soldier is down; then Edric walks to Sera from the east and Talks,
 * which wins the chapter. Returns what the board said along the way.
 */
export async function enterP3(d, { unarmedWarning = false, idle = true } = {}) {
  await travel(d, 'prologue_3');
  if (unarmedWarning) {
    const warning = d.page
      .getByRole('dialog', { name: 'Field notes', exact: true })
      .filter({ hasText: 'Tamsin has no usable weapon.' });
    await expect(warning).toBeVisible();
    await d.click(warning.getByRole('button', { name: 'Continue anyway', exact: true }));
  }
  await activeScene(d.page, 'Battle');
  if (idle) await d.idle();
}

/**
 * P3's army: the fighters first, Sera's staff next (she heals whoever is hurt), Tamsin
 * last, so the frail ones choose their tiles with everyone else already placed.
 */
export const P3_ORDER = ['Gaspar', 'Edric', 'Sera', 'Tamsin'];
export const p3Opts = (name) =>
  name === 'Sera'
    ? { support: { fallback: { caution: 2 } } }
    : name === 'Tamsin'
      ? { caution: 2 }
      : {};

export async function playP3TalkFirst(d) {
  await d.talk('Edric', { col: 3, row: 2 });
  // Sera acts at once: she heals whoever is hurt (Edric, after P2), else she fights.
  await d.support('Sera', { below: 1, fallback: { caution: 2 } });
  await fightOut(d, P3_ORDER, p3Opts);
}

/** Talk to Sera from a free tile beside her, preferring her east side (`side`). */
export async function talkToSera(d, { side = [1, 0] } = {}) {
  const spot = await d.page.evaluate((side) => {
    const b = window.__emblemRogueGame.scene.getScene('Battle');
    const sera = b.npcUnits.find((u) => u.name === 'Sera');
    const sides = [side, [1, 0], [0, 1], [0, -1], [-1, 0]];
    for (const [dc, dr] of sides) {
      const col = sera.col + dc;
      const row = sera.row + dr;
      if (col < 0 || row < 0 || col >= b.grid.cols || row >= b.grid.rows) continue;
      if (!b.getUnitAt(col, row)) return { col, row };
    }
    return null;
  }, side);
  return spot;
}

/**
 * P4 from the watchtower: Rest (or Scavenge), travel to the gate, the deploy screen
 * (`deploy`: names to pick beyond the commander, or null for the default lineup), the
 * formation (Auto-place, Start battle), up to the first player turn.
 */
export async function watchtower(d, { choice = 'rest' } = {}) {
  const { page } = d;
  await travel(d, 'prologue_4');
  const ruins = await d.dialog('Ruins sanctuary');
  if (choice === 'rest') {
    await d.click(ruins.getByRole('button', { name: /^Rest — heal everyone/ }));
    const confirm = await d.dialog('Rest here?');
    await d.click(confirm.getByRole('button', { name: 'Rest', exact: true }));
    await expect(ruins).toContainText('healed');
  } else {
    await d.click(ruins.getByRole('button', { name: /^Scavenge/ }));
    // Scavenge may confirm too, and may hand an item: read past both to the ruins.
    for (let i = 0; i < 4; i++) {
      const top = await page.evaluate(() => {
        const all = [...document.querySelectorAll('[role="dialog"]')].filter((e) => e.getClientRects().length); // prettier-ignore
        const el = all.at(-1);
        return el ? { name: el.getAttribute('aria-label'), buttons: [...el.querySelectorAll('button')].map((b) => b.innerText.trim()) } : null; // prettier-ignore
      });
      if (!top || top.name === 'Ruins sanctuary') break;
      const dialog = page.getByRole('dialog', { name: top.name, exact: true });
      const yes = top.buttons.find((b) => /^(Scavenge|Take|Continue|OK|Return to ruins)/.test(b));
      if (!yes) throw new Error(`Scavenge: no way past ${top.name} (${top.buttons})`);
      await d.click(dialog.getByRole('button', { name: yes, exact: true }));
    }
  }
  await d.click(ruins.getByRole('button', { name: 'Leave', exact: true }));
  await expect(ruins).toHaveCount(0);
  await toRoute(d);
}

export async function enterP4(d, { deploy = null } = {}) {
  const { page } = d;
  await travel(d, 'prologue_5');
  await activeScene(page, 'Battle');
  const screen = await d.dialog('Deploy units');
  if (deploy) {
    // Clear the optional picks, then choose exactly these.
    await d.click(screen.getByRole('button', { name: 'Clear optional selections', exact: true }));
    for (const name of deploy) {
      const row = screen.locator('.re-party-row', { hasText: name });
      await d.click(row);
      await expect(row).toHaveAttribute('aria-pressed', 'true');
    }
  }
  await d.click(screen.getByRole('button', { name: 'Deploy', exact: true }));
  await d.drain(
    () =>
      Boolean(document.querySelector('[aria-label="Formation"]')) &&
      ![...document.querySelectorAll('[role="dialog"]')].some((e) => e.getClientRects().length),
  );
  const formation = page.getByRole('region', { name: 'Formation', exact: true });
  await d.click(formation.getByRole('button', { name: 'Auto-place', exact: true }));
  await d.click(formation.getByRole('button', { name: 'Start battle', exact: true }));
  await d.idle();
}

/** Varro still holds the gate. */
export const varroAlive = (page) =>
  page.evaluate(() =>
    window.__emblemRogueGame.scene.getScene('Battle').enemyUnits.some((u) => u.isBoss),
  );

/**
 * After Varro: Edric walks to the gate (everyone else holds their ground, so nobody
 * stands on it) and chooses Seize on it from the real action menu.
 */
export async function seizeWithEdric(d) {
  const throne = { col: 9, row: 0 };
  for (let n = 0; n < 8 && !(await d.battleOver()); n++) {
    const s = await d.battleState();
    if (s.phase !== 'player') {
      await d.nextTurn(s.turn);
      continue;
    }
    const others =
      (await d.page.evaluate(
        () =>
      window.__emblemRogueGame.scene.getScene('Battle').playerUnits.filter((u) => !u.hasActed && u.name !== 'Edric').map((u) => u.name), // prettier-ignore
      )) || [];
    const edric = await d.unit('Edric');
    if (edric && !edric.acted) {
      await d.select('Edric');
      const plan = await d.plan('Edric', { attack: false, toward: throne });
      await d.moveSelected(plan.to.col, plan.to.row);
      if ((await d.menuItems()).includes('Seize')) {
        await d.menu('Seize');
        await d.drain(() => {
          const b = window.__emblemRogueGame?.scene?.getScene('Battle');
          return window.__sceneState?.activeScene !== 'Battle' || b?.battleState === 'BATTLE_END';
        });
        return;
      }
      await d.menu('Wait');
      await d.acted('Edric');
    }
    for (const name of others) {
      const u = await d.unit(name);
      if (u && !u.acted) await d.act(name, { stay: true });
    }
    const after = await d.battleState();
    if (after.phase === 'player' && after.turn === s.turn && !(await d.battleOver())) {
      const all = await d.page.evaluate(() =>
        window.__emblemRogueGame.scene.getScene('Battle').playerUnits.every((u) => u.hasActed),
      );
      if (all) await d.nextTurn(s.turn);
      else await d.endTurn();
    }
  }
}
