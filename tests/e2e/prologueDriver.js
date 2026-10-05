// Drives the prologue through the game's own input paths (docs/specs/prologue-chapter.md §9,
// "ordinary actions"): a mouse click or a touch tap on a board tile, the keyboard over the
// desktop's canvas action menu (the same MenuFocusController a pad uses), the phone's
// command rail, the DOM forecast / notes / lines / rewards / route map / roster. Nothing
// here calls onVictory, removeUnit, completeBattle or a setter to skip play: the page is
// read (window.__emblemRogueGame) only to decide what a player would click next and to
// wait on state, never on time.
//
// One driver per page: `const d = driver(page, { touch })`. Every dialog the driver reads
// past (a Field note, a spoken line, a recruit card, a level-up) is logged in `d.log`, so a
// spec can assert what was taught and that nothing played twice.
import { expect } from '@playwright/test';

/** Settings for a quiet, fast browser run (the teaching stays on: hints default). */
export const QUIET = { musicVolume: 0, sfxVolume: 0, reduceMotion: true, battleSpeed: 'instant' };

/** A fresh desktop page on the title, with page errors collected. */
export async function bootDesktop(browser, { viewport = { width: 1280, height: 800 } } = {}) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(
    (s) => localStorage.setItem('emblem_rogue_settings', JSON.stringify(s)),
    QUIET,
  );
  await page.goto('/');
  await activeScene(page, 'Title');
  return { context, page, errors };
}

export async function activeScene(page, key, timeout = 60_000) {
  await page.waitForFunction((k) => window.__sceneState?.activeScene === k, key, { timeout });
}

export const slotRun = (page, slot = 1) =>
  page.evaluate((n) => JSON.parse(localStorage.getItem(`emblem_rogue_slot_${n}_run`) || 'null'), slot); // prettier-ignore
export const slotMeta = (page, slot = 1) =>
  page.evaluate((n) => JSON.parse(localStorage.getItem(`emblem_rogue_slot_${n}_meta`) || 'null'), slot); // prettier-ignore

// Dialogs the drain never reads past: the caller decides what to do there.
const DECISION_DIALOGS = new Set([
  'Combat forecast',
  'Battle rewards',
  'Paused',
  'Deploy units',
  'Manage roster',
  'Village',
  'Ruins sanctuary',
  'Church',
  'Rest here?',
  'Rewind',
  'From here, it counts',
  'Team XP',
  'Settings',
  'Trade items',
]);

/** Every visible dialog, topmost last: { name, text, buttons }. */
function visibleDialogs(page) {
  return page.evaluate(() => {
    const shown = (el) =>
      el.isConnected &&
      (el.checkVisibility ? el.checkVisibility({ visibilityProperty: true }) : true) &&
      el.getClientRects().length > 0;
    return [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')]
      .filter(shown)
      .map((el) => ({
        name: el.getAttribute('aria-label') || '',
        text: (el.innerText || '').replace(/\s+/g, ' ').trim(),
        buttons: [...el.querySelectorAll('button')]
          .filter(shown)
          .map((b) => b.getAttribute('aria-label') || b.innerText.trim()),
      }));
  });
}

/** Every localStorage key (a profile), for restoreProfile. */
export const saveProfile = (page) =>
  page.evaluate(() => JSON.stringify(Object.entries(localStorage)));

/**
 * Leave the page, put back a saved profile, and open the title on it: the next load
 * starts from exactly that save (as a player reopening the game).
 */
export async function restoreProfile(page, saved) {
  await page.goto('/data/terrain.json');
  await page.evaluate((entries) => {
    localStorage.clear();
    for (const [key, value] of JSON.parse(entries)) localStorage.setItem(key, value);
  }, saved);
  await page.goto('/');
  await activeScene(page, 'Title');
}

export function driver(page, { touch = false } = {}) {
  const log = [];
  const d = {
    page,
    touch,
    log,
    /** Names of the notes read so far (their first words), for assertions. */
    notes: () => log.filter((e) => e.name === 'Field notes').map((e) => e.text),
    lines: () => log.filter((e) => e.kind === 'line').map((e) => `${e.name}: ${e.text}`),

    async click(locator) {
      if (touch) await locator.tap();
      else await locator.click();
    },

    /** The CSS point of a tile's centre (the camera pans to it first, as a player would). */
    async tilePoint(col, row) {
      return page.evaluate(
        ([col, row]) => {
          const b = window.__emblemRogueGame.scene.getScene('Battle');
          const world = b.grid.gridToPixel(col, row);
          b._battleCamera?.ensureWorldVisible?.(world.x, world.y, 24);
          const screen = b._worldToScreen(world.x, world.y);
          const rect = b.game.canvas.getBoundingClientRect();
          return {
            x: rect.left + (screen.x * rect.width) / b.scale.width,
            y: rect.top + (screen.y * rect.height) / b.scale.height,
          };
        },
        [col, row],
      );
    },

    /**
     * A real click (or tap) on a board tile. The canvas must be what is under the
     * pointer: a docked tip over the tile is read first ("Got it", as a player would
     * clear it); anything else covering the board is a failure.
     */
    async tile(col, row) {
      for (let attempt = 0; ; attempt++) {
        const p = await d.tilePoint(col, row);
        const cover = await page.evaluate(({ x, y }) => {
          const el = document.elementFromPoint(x, y);
          if (!el || el.tagName === 'CANVAS') return null;
          const tip = el.closest('.re-guide');
          return {
            tip: tip ? tip.getAttribute('data-guide') : null,
            what: `${el.tagName}.${el.className}`,
          };
        }, p);
        if (!cover) {
          if (touch) await page.touchscreen.tap(p.x, p.y);
          else await page.mouse.click(p.x, p.y);
          return;
        }
        if (cover.tip && attempt < 3) {
          await d.readTip(cover.tip);
          continue;
        }
        throw new Error(`tile ${col},${row} is covered by ${cover.what}`);
      }
    },

    /** Read (dismiss) a docked tip by its data-guide id. */
    async readTip(id) {
      const tip = page.locator(`.re-guide[data-guide="${id}"]`);
      if (!(await tip.count())) return false;
      log.push({ kind: 'tip', name: id, text: (await tip.innerText()).replace(/\s+/g, ' ') });
      await d.click(tip.getByRole('button', { name: 'Got it', exact: true }));
      await expect(tip).toHaveCount(0);
      return true;
    },

    unit(name) {
      return page.evaluate((n) => {
        const b = window.__emblemRogueGame.scene.getScene('Battle');
        const u = [...b.playerUnits, ...(b.npcUnits || [])].find((x) => x.name === n);
        return u ? { col: u.col, row: u.row, hp: u.currentHP, acted: Boolean(u.hasActed) } : null;
      }, name);
    },

    battleState() {
      return page.evaluate(() => {
        const b = window.__emblemRogueGame.scene.getScene('Battle');
        return {
          state: b?.battleState ?? null,
          phase: b?.turnManager?.currentPhase ?? null,
          turn: b?.turnManager?.turnNumber ?? null,
          selected: b?.selectedUnit?.name ?? null,
        };
      });
    },

    /** Wait until the player can act on the board (nothing modal, a player turn). */
    async idle(timeout = 60_000) {
      await d.drain(
        () => {
          const b = window.__emblemRogueGame?.scene?.getScene('Battle');
          return (
            window.__sceneState?.activeScene === 'Battle' &&
            b?.battleState === 'PLAYER_IDLE' &&
            b.turnManager?.currentPhase === 'player' &&
            !b.selectedUnit &&
            !b._prologue?.isPresenting?.()
          );
        },
        null,
        { timeout },
      );
    },

    /**
     * Read past every blocking dialog (a Field note, a spoken line, a recruit card, a
     * level-up) until `done(arg)` holds in the page. Decision dialogs (the forecast,
     * rewards, menus) stop the drain with an error unless `done` already holds, so a
     * spec never clicks through a choice by accident. `stopAt(dialog)` lets a caller
     * stop at a dialog it wants to handle itself (returns true from drain).
     */
    async drain(done, arg = null, { timeout = 90_000, stopAt = null } = {}) {
      const deadline = Date.now() + timeout;
      for (;;) {
        if (await page.evaluate(done, arg)) return false;
        const dialogs = await visibleDialogs(page);
        const top = dialogs.at(-1);
        if (top) {
          if (stopAt?.(top)) return true;
          if (DECISION_DIALOGS.has(top.name)) {
            if (await page.evaluate(done, arg)) return false;
            throw new Error(`drain stopped at "${top.name}": ${top.text.slice(0, 200)}`);
          }
          if (await d.readDialog(top)) continue;
        }
        const left = deadline - Date.now();
        if (left <= 0) {
          const s = await d.battleState().catch(() => null);
          throw new Error(
            `drain timed out; dialogs ${JSON.stringify(dialogs.map((x) => x.name))}, battle ${JSON.stringify(s)}`,
          );
        }
        // Wait for the next thing to happen: the condition, or a dialog to appear/change.
        const before = JSON.stringify(dialogs.map((x) => [x.name, x.text]));
        await page
          .waitForFunction(
            ([doneSrc, arg, before]) => {
              const done = new Function(`return (${doneSrc})`)();
              if (done(arg)) return true;
              const shown = (el) =>
                el.isConnected &&
                (el.checkVisibility ? el.checkVisibility({ visibilityProperty: true }) : true) &&
                el.getClientRects().length > 0;
              const now = JSON.stringify(
                [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')]
                  .filter(shown)
                  .map((el) => [
                    el.getAttribute('aria-label') || '',
                    (el.innerText || '').replace(/\s+/g, ' ').trim(),
                  ]),
              );
              return now !== before;
            },
            [done.toString(), arg, before],
            { timeout: Math.min(left, 15_000), polling: 100 },
          )
          .catch(() => {});
      }
    },

    /**
     * Read past notes and lines until the dialog named `name` is the topmost one on
     * screen; returns its locator.
     */
    async dialog(name, { timeout = 90_000 } = {}) {
      await d.drain(
        (n) => {
          const shown = (el) =>
            el.isConnected &&
            (el.checkVisibility ? el.checkVisibility({ visibilityProperty: true }) : true) &&
            el.getClientRects().length > 0;
          const all = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].filter(shown); // prettier-ignore
          return all.at(-1)?.getAttribute('aria-label') === n;
        },
        name,
        { timeout, stopAt: (top) => top.name === name },
      );
      return page.getByRole('dialog', { name, exact: true });
    },

    /** Read past one non-decision dialog. Returns true when it acted. */
    async readDialog(top) {
      const dialog = page.getByRole('dialog', { name: top.name, exact: true }).last();
      const press = async (name) => {
        const button = dialog.getByRole('button', { name, exact: true });
        if (!(await button.count())) return false;
        // A long note ignores Continue for its first half second (HintDisplay's reading
        // guard): pressing until the dialog changes is the player's own second press.
        await d.click(button.first()).catch(() => {});
        return true;
      };
      const kind =
        top.name === 'Field notes' ? 'note' : /joins your army$/.test(top.name) ? 'card' : 'line';
      const last = log.at(-1);
      if (!(last && last.name === top.name && last.text === top.text))
        log.push({ kind, name: top.name, text: top.text });
      if (top.buttons.includes('Continue')) return press('Continue');
      if (top.buttons.includes('Reveal gains')) return press('Reveal gains');
      if (kind === 'card') {
        await d.click(dialog).catch(() => {});
        return true;
      }
      if (top.buttons.length === 1) return press(top.buttons[0]);
      throw new Error(`no way past dialog "${top.name}" (${top.buttons.join(' | ')})`);
    },

    /** Click a unit's tile and wait until it is the selected unit. */
    async select(name) {
      const u = await d.unit(name);
      if (!u) throw new Error(`${name} is not on the field`);
      await d.tile(u.col, u.row);
      // Selected, and any note the selection raised has been read.
      await d.drain((n) => {
        const b = window.__emblemRogueGame.scene.getScene('Battle');
        return (
          b.selectedUnit?.name === n &&
          ['UNIT_SELECTED', 'UNIT_ACTION_MENU'].includes(b.battleState) &&
          !b._prologue?.isPresenting?.()
        );
      }, name);
    },

    /** Wait for the unit's action menu (the post-move one), reading past notes. */
    async actionMenu() {
      await d.drain(() => {
        const b = window.__emblemRogueGame.scene.getScene('Battle');
        return b.battleState === 'UNIT_ACTION_MENU' && !b._prologue?.isPresenting?.();
      });
    },

    /** The labels the open action menu offers. */
    menuItems() {
      return page.evaluate(() => {
        const b = window.__emblemRogueGame.scene.getScene('Battle');
        return (b._menuFocus?.items || []).map((i) => i.label ?? i.button?.text ?? null);
      });
    },

    /** The open menu as published (every row, greyed ones with their reason). */
    publishedMenu() {
      return page.evaluate(() => {
        const b = window.__emblemRogueGame.scene.getScene('Battle');
        return (b._actionMenuPublished?.items || []).map((i) => ({
          label: i.label,
          disabled: Boolean(i.disabled),
          why: i.description || null,
        }));
      });
    },

    /**
     * Choose an action-menu command. Phone: the command rail's button. Desktop: the
     * keyboard over the canvas menu (arrows to the row, Enter), as MenuFocusController
     * reads it. `label` is a string (exact) or a RegExp.
     */
    async menu(label) {
      const matches = (text) =>
        label instanceof RegExp ? label.test(text || '') : (text || '') === label;
      if (touch) {
        const rail = page.getByRole('complementary', { name: 'Battle commands' });
        const button = rail.getByRole('button', { name: label, exact: typeof label === 'string' }); // prettier-ignore
        await expect(button.first()).toBeVisible();
        await button.first().tap();
        return;
      }
      await expect
        .poll(async () => (await d.menuItems()).some(matches), { timeout: 15_000 })
        .toBe(true);
      const items = await d.menuItems();
      const target = items.findIndex(matches);
      const at = await page.evaluate(
        () => window.__emblemRogueGame.scene.getScene('Battle')._menuFocus.index,
      );
      const n = items.length;
      const down = (((target - at) % n) + n) % n;
      for (let i = 0; i < down; i++) await page.keyboard.press('ArrowDown');
      await expect
        .poll(() =>
          page.evaluate(() => window.__emblemRogueGame.scene.getScene('Battle')._menuFocus.index),
        ) // prettier-ignore
        .toBe(target);
      await page.keyboard.press('Enter');
    },

    /** Move a unit to a tile (select, click the tile) and wait for its action menu. */
    async moveTo(name, col, row) {
      await d.select(name);
      await d.tile(col, row);
      await d.actionMenu();
    },

    /** Move (or stay) and Wait. */
    async moveAndWait(name, col, row) {
      const u = await d.unit(name);
      await d.moveTo(name, col ?? u.col, row ?? u.row);
      await d.menu('Wait');
      await d.acted(name);
    },

    /** Wait until `name` has acted (or left the field) and the board is idle again. */
    async acted(name) {
      await d.drain((n) => {
        const b = window.__emblemRogueGame?.scene?.getScene('Battle');
        if (!b || window.__sceneState?.activeScene !== 'Battle') return true;
        if (b.battleState === 'BATTLE_END') return true;
        const u = b.playerUnits.find((x) => x.name === n);
        if (b.turnManager.currentPhase !== 'player') return true;
        return (!u || u.hasActed) && b.battleState === 'PLAYER_IDLE' && !b._prologue?.isPresenting?.(); // prettier-ignore
      }, name);
    },

    /** The forecast is open (the DOM dialog on a phone, the canvas panel on desktop). */
    async forecastOpen() {
      await d.drain(() => {
        const b = window.__emblemRogueGame.scene.getScene('Battle');
        return b.battleState === 'SHOWING_FORECAST' && !b._prologue?.isPresenting?.();
      });
    },

    forecastTarget() {
      return page.evaluate(() => {
        const t = window.__emblemRogueGame.scene.getScene('Battle').forecastTarget;
        return t ? { col: t.col, row: t.row, name: t.name } : null;
      });
    },

    /** Confirm the open forecast: the phone's Confirm attack, the desktop's click on the target. */
    async confirmForecast() {
      if (touch) {
        await page.getByRole('dialog', { name: 'Combat forecast' }).getByRole('button', { name: 'Confirm attack' }).tap(); // prettier-ignore
        return;
      }
      const t = await d.forecastTarget();
      await d.tile(t.col, t.row);
    },

    /**
     * Choose the forecast's weapon: the arrows on desktop (◀ ▶ cycle the weapons that
     * reach), the forecast's own weapon buttons on a phone. No-op when it already is.
     */
    async forecastWeapon(name) {
      const current = () =>
        page.evaluate(() => {
          const b = window.__emblemRogueGame.scene.getScene('Battle');
          return (b._forecastWeapon || b.selectedUnit?.weapon)?.name ?? null;
        });
      for (let i = 0; i < 6 && (await current()) !== name; i++) {
        if (touch) {
          const next = page.getByRole('dialog', { name: 'Combat forecast' }).getByRole('button', { name: /next weapon/i }); // prettier-ignore
          await next.first().tap();
        } else await page.keyboard.press('ArrowRight');
        await d.forecastOpen();
      }
      expect(await current()).toBe(name);
    },

    /** Cancel the open forecast: the phone's Cancel, Escape on desktop. */
    async cancelForecast() {
      if (touch) {
        await page.getByRole('dialog', { name: 'Combat forecast' }).getByRole('button', { name: 'Cancel', exact: true }).tap(); // prettier-ignore
      } else await page.keyboard.press('Escape');
      await expect
        .poll(() =>
          page.evaluate(() => window.__emblemRogueGame.scene.getScene('Battle').battleState),
        ) // prettier-ignore
        .not.toBe('SHOWING_FORECAST');
    },

    /** Enemy at the authored id (`a`, `b`, `v`...), or null. */
    enemy(id) {
      return page.evaluate((id) => {
        const b = window.__emblemRogueGame.scene.getScene('Battle');
        const e = b.enemyUnits.find((u) => u.authoredId === id && u.currentHP > 0);
        return e ? { col: e.col, row: e.row, hp: e.currentHP, name: e.name, id } : null;
      }, id);
    },

    /**
     * Attack `targetId` with `name`: select, move to `from` (or stay), open the forecast
     * by clicking the foe on the post-move menu, confirm. `onForecast` runs with the
     * forecast open (e.g. to cancel and retry). Resolves when the attack played out.
     */
    async attack(name, targetId, { from = null, onForecast = null } = {}) {
      const u = await d.unit(name);
      const to = from || { col: u.col, row: u.row };
      await d.moveTo(name, to.col, to.row);
      const e = await d.enemy(targetId);
      if (!e) throw new Error(`no living enemy ${targetId}`);
      // Attack, then the foe: on desktop the canvas menu sits beside the unit and can
      // cover an adjacent foe, so the command comes first (the keyboard), then the click.
      await d.menu('Attack');
      await d.drain(() => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'SELECTING_TARGET'); // prettier-ignore
      await d.tile(e.col, e.row);
      await d.forecastOpen();
      if (onForecast) await onForecast();
      await d.confirmForecast();
      await d.acted(name);
    },

    /**
     * What a careful player would do with the selected unit `name` this turn, read
     * from the board (its real blue range, the forecasts, the Danger tiles). Options:
     *   targets   authored enemy ids it may attack (default: any)
     *   noKill    never take an attack that could kill (another unit takes the kill);
     *             'hits': that could kill without a critical
     *   attack    false: only move
     *   toward    {col,row} to walk to when not attacking (default: the nearest foe)
     *   caution   how much a tile's exposure to the next enemy phase weighs (default 1)
     *   stay      true: never move (attack from where it stands, or Wait)
     * Returns { kind: 'attack', from, target } or { kind: 'move', to }.
     */
    plan(name, opts = {}) {
      return page.evaluate(
        async ([name, opts]) => {
          const C = await import('/src/engine/Combat.js');
          const T = await import('/src/engine/ThreatForecast.js');
          const b = window.__emblemRogueGame.scene.getScene('Battle');
          const u = b.playerUnits.find((x) => x.name === name);
          if (b.selectedUnit !== u) throw new Error(`plan: ${name} is not selected`);
          const key = (c, r) => `${c},${r}`;
          const tiles = [{ col: u.col, row: u.row }];
          if (!opts.stay)
            for (const [k, e] of b.movementRange || []) {
              if (e?.stoppable === false) continue;
              const [col, row] = k.split(',').map(Number);
              if (col === u.col && row === u.row) continue;
              if (b.getUnitAt(col, row)) continue;
              tiles.push({ col, row });
            }
          const ctx = b.threatContext();
          const terrain = (c, r) => b.grid.getTerrainAt(c, r);
          const foes = b.enemyUnits.filter(
            (e) =>
              e.currentHP > 0 &&
              T.isThreatSourceVisible(b.grid, e) &&
              (!opts.targets || opts.targets.includes(e.authoredId)),
          );
          const at = (tile) => ({ ...u, col: tile.col, row: tile.row });
          const forecast = (atk, w, def, dw, from, to) =>
            C.getCombatForecast(
              atk,
              w,
              def,
              dw,
              C.gridDistance(from.col, from.row, to.col, to.row),
              terrain(from.col, from.row),
              terrain(to.col, to.row),
            );
          // Worst damage the next enemy phase could deal on `tile` (every strike hits).
          const exposure = (tile, spared = null) => {
            const threats = T.threatsOnTile(ctx, tile.col, tile.row, { mover: u });
            let total = 0;
            for (const e of threats.damage) {
              if (e === spared || !e.weapon) continue;
              const f = forecast(e, e.weapon, at(tile), u.weapon, tile, tile);
              total += (f.attacker.damage || 0) * (f.attacker.attackCount || 0);
            }
            return total;
          };
          const caution = opts.caution ?? 1;
          let best = null;
          const consider = (c) => {
            if (!best || c.score > best.score) best = c;
          };
          // Every weapon it carries and can strike with (the forecast picks one).
          const weapons = (u.inventory || []).filter(
            (w) => w && !C.isStaff(w) && w.type !== 'Scroll' && !(w.uses <= 0) && (!opts.equippedOnly || w === u.weapon), // prettier-ignore
          );
          if (opts.attack !== false) {
            for (const tile of tiles)
              for (const foe of foes)
                for (const w of weapons) {
                  const dist = C.gridDistance(tile.col, tile.row, foe.col, foe.row);
                  if (!C.isInRange(w, dist)) continue;
                  const f = forecast({ ...at(tile), weapon: w }, w, foe, foe.weapon, tile, foe);
                  const a = f.attacker;
                  const hit = Math.max(0, Math.min(100, a.hit || 0)) / 100;
                  const strikes = a.attackCount || 0;
                  const dmg = a.damage || 0;
                  const max = dmg * strikes;
                  const critMax = a.crit > 0 ? dmg * 3 + dmg * Math.max(0, strikes - 1) : max;
                  // noKill: never a strike that could kill; 'hits' leaves crits out of it.
                  if (opts.noKill && (opts.noKill === 'hits' ? max : Math.max(max, critMax)) >= foe.currentHP) continue; // prettier-ignore
                  const need = dmg > 0 ? Math.ceil(foe.currentHP / dmg) : Infinity;
                  const kill =
                    need > strikes ? 0 : need === 1 ? 1 - (1 - hit) ** strikes : hit ** need;
                  const d = f.defender;
                  const counters = d.canCounter === false ? 0 : d.attackCount || 0;
                  const counter = (d.damage || 0) * counters * (Math.max(0, d.hit || 0) / 100);
                  const counterWorst =
                    (d.crit > 0 ? (d.damage || 0) * 3 : d.damage || 0) * Math.min(1, counters) +
                    (d.damage || 0) * Math.max(0, counters - 1);
                  const sure = kill >= 0.999 && hit >= 0.999;
                  const after = exposure(tile, sure ? foe : null);
                  // Lethal: the counter alone could kill, or the counter and the next
                  // enemy phase together (every strike hitting).
                  const lethal =
                    (!sure && counterWorst >= u.currentHP) ||
                    after + (sure ? 0 : counterWorst) >= u.currentHP
                      ? 1
                      : 0;
                  consider({
                    kind: 'attack',
                    from: tile,
                    target: foe.authoredId,
                    weapon: w.name,
                    sure,
                    lethal: Boolean(lethal),
                    score:
                      1000 +
                      kill * 200 +
                      dmg * strikes * hit * 4 -
                      counter * 6 -
                      lethal * 5000 * caution -
                      after * caution -
                      (tile.col === u.col && tile.row === u.row ? 0 : 0.5),
                  });
                }
          }
          // No good strike: walk toward the goal over the road, never onto a lethal tile.
          const goal =
            opts.toward ||
            foes
              .map((e) => ({
                col: e.col,
                row: e.row,
                d: C.gridDistance(u.col, u.row, e.col, e.row),
              })) // prettier-ignore
              .sort((p, q) => p.d - q.d)[0] ||
            null;
          const road = goal ? b.grid.getMovementRange(goal.col, goal.row, 99, u.moveType, null, null) : null; // prettier-ignore
          for (const tile of tiles) {
            const steps = road ? (road.get(key(tile.col, tile.row))?.cost ?? 99) : 0;
            const after = exposure(tile);
            const lethal = after >= u.currentHP ? 1 : 0;
            consider({
              kind: 'move',
              to: tile,
              score: -steps * 10 - lethal * 5000 * caution - after * caution * 0.5,
            });
          }
          return best;
        },
        [name, opts],
      );
    },

    /**
     * One whole action for `name` by the board's own input: select, plan (d.plan), then
     * move/attack/Wait through clicks and the menu. Returns the plan carried out.
     */
    async act(name, opts = {}) {
      await d.select(name);
      let p = await d.plan(name, opts);
      // Hurt (half HP or less) with a Vulnerary in the bag and no sure kill: step to the
      // safest useful tile and drink it (Item → Vulnerary), as P1's tip teaches.
      const drink = await page.evaluate(
        ([n, below]) => {
          const u = window.__emblemRogueGame.scene.getScene('Battle').playerUnits.find((x) => x.name === n); // prettier-ignore
          return (
            u.currentHP <= u.stats.HP * below &&
            (u.consumables || []).some((c) => c.name === 'Vulnerary' && !(c.uses <= 0))
          );
        },
        [name, opts.drinkBelow ?? 0.5],
      );
      if (drink && !(p.kind === 'attack' && p.sure && !p.lethal)) {
        p = await d.plan(name, { ...opts, attack: false, caution: 3 });
        await d.tile(p.to.col, p.to.row);
        await d.actionMenu();
        await d.menu('Item');
        await d.menu(/^Vulnerary/);
        await d.acted(name);
        return { ...p, kind: 'drink' };
      }
      if (p.kind === 'attack') {
        await d.tile(p.from.col, p.from.row);
        await d.actionMenu();
        const e = await d.enemy(p.target);
        await d.menu('Attack');
        await d.drain(() => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'SELECTING_TARGET'); // prettier-ignore
        await d.tile(e.col, e.row);
        await d.forecastOpen();
        await d.forecastWeapon(p.weapon);
        if (opts.onForecast) await opts.onForecast();
        await d.confirmForecast();
      } else {
        await d.tile(p.to.col, p.to.row);
        await d.actionMenu();
        await d.menu('Wait');
      }
      await d.acted(name);
      return p;
    },

    /** Every ready unit acts (in `order`), then the turn ends if it has not already. */
    async playTurn(order, optsFor = () => ({})) {
      const start = await d.battleState();
      for (const name of order) {
        const s = await d.battleState();
        if (s.state === 'BATTLE_END' || s.phase !== 'player' || s.turn !== start.turn) return;
        const u = await d.unit(name);
        if (!u || u.acted) continue;
        const opts = optsFor(name);
        if (opts === null) continue;
        await d.act(name, opts);
      }
      const s = await d.battleState();
      if (s.state === 'BATTLE_END' || (await d.scene()) !== 'Battle') return;
      const allActed = await page.evaluate(() =>
        window.__emblemRogueGame.scene.getScene('Battle').playerUnits.every((u) => u.hasActed),
      );
      // The last unit to act ends the phase by itself; otherwise End Turn.
      if (s.phase === 'player' && s.turn === start.turn && !allActed) await d.endTurn();
      else await d.nextTurn(start.turn);
    },

    scene() {
      return page.evaluate(() => window.__sceneState?.activeScene ?? null);
    },

    /** The battle is over (won: the scene left Battle, or BATTLE_END). */
    battleOver() {
      return page.evaluate(() => {
        const b = window.__emblemRogueGame?.scene?.getScene('Battle');
        return window.__sceneState?.activeScene !== 'Battle' || b?.battleState === 'BATTLE_END';
      });
    },

    /**
     * Heal `target` with `healer`'s staff: move beside it (`to`, or stay), the staff
     * command (Heal (n/m)), then click the target.
     */
    async heal(healer, target, { to = null } = {}) {
      const h = await d.unit(healer);
      const dest = to || { col: h.col, row: h.row };
      await d.moveTo(healer, dest.col, dest.row);
      await d.menu(/^Heal \(/);
      await d.drain(() => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'SELECTING_HEAL_TARGET'); // prettier-ignore
      if (touch) {
        const rail = page.getByRole('complementary', { name: 'Battle commands' });
        const pick = rail.getByRole('button', { name: new RegExp(`^Heal ${target}`) });
        if (await pick.count()) await pick.first().tap();
        else {
          const t = await d.unit(target);
          await d.tile(t.col, t.row);
        }
      } else {
        const t = await d.unit(target);
        await d.tile(t.col, t.row);
      }
      await d.acted(healer);
    },

    /** Move a lord beside a green unit and Talk. */
    async talk(lord, to) {
      await d.moveTo(lord, to.col, to.row);
      await d.menu('Talk');
      await d.acted(lord);
    },

    /** End the player turn (E on desktop; the rail, confirming, on a phone) and wait for the next. */
    async endTurn() {
      const turn = (await d.battleState()).turn;
      if (touch) {
        const rail = page.getByRole('complementary', { name: 'Battle commands' });
        await rail.getByRole('button', { name: /^End turn/ }).tap();
        const confirm = rail.getByRole('button', { name: 'End turn now', exact: true });
        await expect
          .poll(
            async () => (await confirm.isVisible()) || (await d.battleState()).phase !== 'player',
          ) // prettier-ignore
          .toBe(true);
        if ((await d.battleState()).phase === 'player') await confirm.tap();
      } else await page.keyboard.press('e');
      await d.nextTurn(turn);
    },

    /** Wait for the player turn after `turn` (or the battle's end), reading past lines. */
    async nextTurn(turn) {
      await d.drain((turn) => {
        const b = window.__emblemRogueGame?.scene?.getScene('Battle');
        if (!b || window.__sceneState?.activeScene !== 'Battle') return true;
        return (
          b.battleState === 'BATTLE_END' ||
          (b.turnManager.turnNumber > turn &&
            b.turnManager.currentPhase === 'player' &&
            b.battleState === 'PLAYER_IDLE' &&
            !b._prologue?.isPresenting?.())
        );
      }, turn);
    },

    /** Read a spoken line (speaker dialog) that must be showing `text`. */
    async line(speaker, text) {
      const line = page.getByRole('dialog', { name: speaker, exact: true });
      await expect(line).toContainText(text);
      log.push({ kind: 'line', name: speaker, text: (await line.innerText()).replace(/\s+/g, ' ').trim() }); // prettier-ignore
      await d.click(line.getByRole('button', { name: 'Continue', exact: true }));
    },

    /** Read a Field note that must contain `text` to its end. */
    async note(text) {
      const note = page.getByRole('dialog', { name: 'Field notes', exact: true }).filter({ hasText: text }); // prettier-ignore
      await expect(note).toBeVisible();
      log.push({ kind: 'note', name: 'Field notes', text: (await note.innerText()).replace(/\s+/g, ' ').trim() }); // prettier-ignore
      await expect(async () => {
        if (await note.count())
          await d.click(note.getByRole('button', { name: 'Continue', exact: true })).catch(() => {}); // prettier-ignore
        await expect(note).toHaveCount(0, { timeout: 1000 });
      }).toPass();
    },
  };
  return d;
}
