// Threat sight: while a unit is being moved, enemies that could reach the chosen
// tile next enemy phase get a crimson eye, and the move preview says how many.
import { test, expect, devices } from '@playwright/test';
import { waitForScene } from './helpers.js';

const foes = (n) => `${n} ${n === 1 ? 'foe' : 'foes'}`;
const QUIET = { musicVolume: 0, sfxVolume: 0, hints: false };

async function openBattle(page, settings = QUIET, query = '') {
  await page.addInitScript((value) => {
    localStorage.setItem('emblem_rogue_settings', JSON.stringify(value));
  }, settings);
  await page.goto(`/?devScene=battle&preset=combat_actions&seed=42${query}`);
  await waitForScene(page, 'Battle');
  await page.waitForFunction(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    return s.battleState === 'PLAYER_IDLE' && Boolean(s._playerTurnStartToken);
  });
  // Bring the enemy line within reach of Sera's move range (presentation test only).
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const spots = [
      [6, 4],
      [7, 2],
      [6, 6],
      [8, 5],
    ];
    s.enemyUnits.slice(0, spots.length).forEach((e, i) => {
      [e.col, e.row] = spots[i];
      s.updateUnitPosition(e);
    });
  });
}

const screenOf = (page, col, row) =>
  page.evaluate(
    ([c, r]) => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      const w = s.grid.gridToPixel(c, r);
      const p = s._worldToScreen(w.x, w.y);
      const rect = s.game.canvas.getBoundingClientRect();
      return {
        x: rect.x + (p.x * rect.width) / s.scale.width,
        y: rect.y + (p.y * rect.height) / s.scale.height,
      };
    },
    [col, row],
  );

/** Reachable destination for the selected unit with the most enemies in reach. */
const mostThreatenedTile = (page) =>
  page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const u = s.selectedUnit;
    let best = null;
    for (const [key, entry] of s.movementRange) {
      if (entry.stoppable === false || key === `${u.col},${u.row}`) continue;
      const [col, row] = key.split(',').map(Number);
      const count = s._threatSight.query(u, col, row).count;
      if (!best || count > best.count) best = { col, row, count };
    }
    return best;
  });

const sightState = (page) =>
  page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const c = s._threatSight.current;
    return {
      state: s.battleState,
      tile: c ? [c.col, c.row] : null,
      hovering: c?.hovering ?? null,
      count: c?.result.count ?? null,
      eyes: s._threatSight.sigils.length,
      eyesOnSources: (c?.result.damage || []).every((e) =>
        s._threatSight.sigils.some((g) => Math.abs(g.x - s.grid.gridToPixel(e.col, e.row).x) < 1),
      ),
      info: s.infoText?.text || '',
      rng: s._battleRng?.getState?.() || null,
      rail: document.querySelector('.mb-threat-line')?.textContent || null,
    };
  });

// The rail's longest move-preview lines, set on the selected unit's own tile
// (presentation only: the rail reads threat sight's current answer). Each must stay
// inside the terrain card, wrapping between clauses, and never scroll the page.
const LONG_LINES = [
  { count: 2, staves: 2, fogged: true, text: '2 foes can reach · 2 staves · fog may hide more' },
  { count: 0, staves: 2, fogged: true, text: 'Only 2 staves can reach · fog may hide more' },
  { count: 0, staves: 0, fogged: true, text: 'No foe can reach · fog may hide more' },
];
async function railLineFits(page, line) {
  return page.evaluate(({ count, staves, fogged }) => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const unit = s.selectedUnit;
    s._mobileTerrainFocus = null;
    s._threatSight.current = {
      unit,
      col: unit.col,
      row: unit.row,
      hovering: false,
      result: {
        damage: [],
        ballistas: [],
        status: Array(staves).fill(s.enemyUnits[0]),
        count,
        fogged,
      },
    };
    s._mobileBattleHud.lastSnapshot = '';
    s._mobileBattleHud.sync();
    const el = document.querySelector('.mb-threat-line');
    if (!el) return null;
    const card = el.closest('.mb-terrain').getBoundingClientRect();
    // The rendered text, not the span's box: a nowrap span can shrink while its
    // text spills past it.
    const clauses = [...el.querySelectorAll('.mb-threat-clause')].map((c) =>
      c.getBoundingClientRect(),
    );
    return {
      text: el.textContent,
      inside:
        clauses.length > 0 &&
        el.scrollWidth <= el.clientWidth + 0.5 &&
        clauses.every((b) => b.left >= card.left - 0.5 && b.right <= card.right + 0.5),
      pageScroll: document.documentElement.scrollWidth > window.innerWidth,
    };
  }, line);
}

test.describe('desktop hover', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('hovering a destination marks every enemy that can reach it', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await openBattle(page);
    const sera = await page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      const u = s.playerUnits.find((p) => p.name === 'Sera');
      return [u.col, u.row];
    });
    const unitPoint = await screenOf(page, ...sera);
    await page.mouse.click(unitPoint.x, unitPoint.y);
    await expect.poll(() => sightState(page).then((s) => s.state)).toBe('UNIT_SELECTED');
    const rngBefore = (await sightState(page)).rng;

    const target = await mostThreatenedTile(page);
    expect(target.count).toBeGreaterThan(0);
    const p = await screenOf(page, target.col, target.row);
    await page.mouse.move(p.x, p.y);
    await expect
      .poll(() => sightState(page))
      .toMatchObject({ tile: [target.col, target.row], hovering: true, count: target.count });
    const hovered = await sightState(page);
    expect(hovered.eyes).toBeGreaterThanOrEqual(target.count);
    expect(hovered.eyesOnSources).toBe(true);
    expect(hovered.info).toContain(`Threat: ${foes(target.count)} can reach`);
    // Presentation never touches battle RNG.
    expect(hovered.rng).toEqual(rngBefore);
    await page.screenshot({ path: test.info().outputPath('threat-sight-desktop.png') });

    // Leaving the move range keeps the unit's own tile in view.
    const outside = await page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      for (let row = 0; row < s.grid.rows; row++)
        for (let col = s.grid.cols - 1; col >= 0; col--)
          if (!s.movementRange.has(`${col},${row}`) && !s.getUnitAt(col, row)) return [col, row];
      return null;
    });
    const far = await screenOf(page, ...outside);
    await page.mouse.move(far.x, far.y);
    await expect.poll(() => sightState(page).then((s) => s.tile)).toEqual(sera);
    expect((await sightState(page)).hovering).toBe(false);

    // Deselecting clears every marker.
    await page.keyboard.press('Escape');
    await expect.poll(() => sightState(page).then((s) => s.eyes)).toBe(0);
    expect(errors).toEqual([]);
  });

  test('reduced motion keeps the eyes still', async ({ page }) => {
    await openBattle(page, { ...QUIET, reduceMotion: true });
    await page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      s.selectUnit(s.playerUnits.find((p) => p.name === 'Sera'));
    });
    const target = await mostThreatenedTile(page);
    const p = await screenOf(page, target.col, target.row);
    await page.mouse.move(p.x, p.y);
    await expect.poll(() => sightState(page).then((s) => s.eyes)).toBeGreaterThan(0);
    const tweening = await page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      return s._threatSight.sigils.some((g) => s.tweens.isTweening(g));
    });
    expect(tweening).toBe(false);
  });
});

test.describe('touch (844x390)', () => {
  const { defaultBrowserType: _browser, ...iphone } = devices['iPhone 13'];
  test.use({ ...iphone, viewport: { width: 844, height: 390 } });

  test('a tapped destination keeps the eyes and the rail says how many can reach', async ({
    page,
  }) => {
    await openBattle(page);
    const sera = await page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      const u = s.playerUnits.find((p) => p.name === 'Sera');
      return [u.col, u.row];
    });
    const unitPoint = await screenOf(page, ...sera);
    await page.touchscreen.tap(unitPoint.x, unitPoint.y);
    await expect.poll(() => sightState(page).then((s) => s.tile)).toEqual(sera);
    const target = await mostThreatenedTile(page);
    const p = await screenOf(page, target.col, target.row);
    await page.touchscreen.tap(p.x, p.y);
    await expect
      .poll(() => sightState(page))
      .toMatchObject({
        state: 'UNIT_ACTION_MENU',
        tile: [target.col, target.row],
        count: target.count,
      });
    const moved = await sightState(page);
    expect(moved.eyes).toBeGreaterThanOrEqual(target.count);
    expect(moved.rail).toBe(`${foes(target.count)} can reach`);
    await page.screenshot({ path: test.info().outputPath('threat-sight-touch.png') });

    // Back undoes the tentative move; the eyes follow Sera home.
    const hud = page.getByRole('complementary', { name: 'Battle commands' });
    await hud.getByRole('button', { name: 'Back', exact: true }).last().tap();
    await expect.poll(() => sightState(page).then((s) => s.tile)).toEqual(sera);
  });

  test('the longest rail lines stay inside the terrain card', async ({ page }) => {
    await openBattle(page);
    await page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      s.selectUnit(s.playerUnits.find((p) => p.name === 'Sera'));
    });
    await expect.poll(() => sightState(page).then((s) => s.state)).toBe('UNIT_SELECTED');
    for (const line of LONG_LINES) {
      expect(await railLineFits(page, line)).toEqual({
        text: line.text,
        inside: true,
        pageScroll: false,
      });
    }
  });
});

test.describe('portrait rail (390x844)', () => {
  const { defaultBrowserType: _browser, ...iphone } = devices['iPhone 13'];
  test.use({ ...iphone, viewport: { width: 390, height: 844 } });

  test('the longest rail lines stay inside the terrain card', async ({ page }) => {
    await openBattle(page, QUIET, '&portrait=1');
    await page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      s.selectUnit(s.playerUnits.find((p) => p.name === 'Sera'));
    });
    await expect.poll(() => sightState(page).then((s) => s.state)).toBe('UNIT_SELECTED');
    await expect(page.locator('html')).toHaveClass(/portrait-battle/);
    for (const line of LONG_LINES) {
      expect(await railLineFits(page, line)).toEqual({
        text: line.text,
        inside: true,
        pageScroll: false,
      });
    }
  });
});
