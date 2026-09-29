// Ceremonies, dialogue and the end of a run on an upright phone (portrait mode, on by
// default on a phone). Battles keep their upright classes through BATTLE_END, so every
// post-battle ceremony shows upright; the route map, the church and the run's end are
// upright pages (html.portrait-ui).
//
// Failure modes each check below is written to catch:
//   1. a band card (boss, recruit, deed) keeps its bust beside the words on a 375-430 px
//      frame: a long name wraps or shrinks, the words squeeze into ~140-215 px;
//   2. a word is cut, clamped or ellipsized, leaves its frame or its band, or runs under
//      a button (the rite's corner Continue, the deed's Next / Skip row);
//   3. a bust or a title slides under the notch, or a control under the home bar;
//   4. the promotion rite, squeezed into the short map frame above the rail, scrolls its
//      words under the corner button;
//   5. the level-up card spends a column on its portrait and squeezes the stat rows;
//   6. a control is under 44 px, covered, or off screen (Continue, Rewind / Accept fate,
//      Skip conversation, the result menu's buttons, the Eclipse card's Close);
//   7. a story line keeps a ~215 px column beside the face for its whole length;
//   8. "Old Kingdom Roads · Act II · Turn 12" or "Turn 12 · Par 10 · Rank A" breaks
//      inside a part ("Turn / 12");
//   9. the run's result list or the Eclipse card scrolls sideways or stretches into an
//      empty panel under the notch;
//  10. an upright rule leaks into landscape phones or desktop: boxes move there, with the
//      portrait classes on the page (a landscape battle keeps portrait-battle-capable) or
//      against the layout on main.
// Each flow also completes the real choice (promotion committed once, Accept fate ends
// the run, Skip conversation ends the lines, Close closes the card), so a layout that
// looks right but swallows the tap still fails.
import { test, expect } from '@playwright/test';
import {
  DESKTOPS,
  LANDSCAPE_PHONES,
  NOTCH_LANDSCAPE,
  NO_INSETS,
  NOTCH_PORTRAIT,
  PORTRAIT_PHONES,
  emulateSafeArea,
  expectInsideSafeArea,
  expectNoSidewaysScroll,
  expectPortraitUi,
  expectSingleLine,
  expectTappable,
  pageErrors,
  phone,
  quietSettings,
  safeAreaInsets,
} from './portraitHelpers.js';

test.setTimeout(150_000);

/** phone(viewport) for a describe group (the browser stays the configured Chromium). */
function device(viewport) {
  const { defaultBrowserType: _browser, ...use } = phone(viewport);
  return use;
}

async function waitForScene(page, key) {
  await page.waitForFunction((k) => window.__sceneState?.activeScene === k, key, {
    timeout: 60_000,
  });
}

/** A battle at turn 1 (deployment confirmed where a route asks for it). */
async function bootBattle(page, query = 'preset=battle_smoke&seed=42') {
  await page.goto(`/?devScene=battle&${query}`);
  await waitForScene(page, 'Battle');
  await page.waitForFunction(
    () => ['DEPLOY_SELECTION', 'PLAYER_IDLE'].includes(window.__sceneState?.battle?.state),
    null,
    { timeout: 60_000 },
  );
  await page.evaluate(() => {
    const battle = window.__emblemRogueGame.scene.getScene('Battle');
    if (battle.battleState !== 'DEPLOY_SELECTION') return;
    battle.children.list
      .filter((o) => o.type === 'Rectangle' && o.input?.enabled && o.listenerCount('pointerdown'))
      .at(-1)
      ?.emit('pointerdown');
  });
  await page.waitForFunction(() => window.__sceneState?.battle?.state === 'PLAYER_IDLE', null, {
    timeout: 60_000,
  });
}

/** The longest real words each card can carry (data/*.json, UnitVoice). */
const LONGEST = {
  boss: 'Knight Commander', // enemies.json; epithet "First Lance of the Second Push"
  recruit: 'Constance', // recruits.json namePool
  recruitLine:
    "My master said I wasn't ready. My master was also late to every fight for forty years.",
  quote:
    'I carried my father’s spear this far; I will carry it home, whatever the road asks of me.',
  deed: 'Lantern of the March', // deeds.json
  epithet: 'Who Held Old Kingdom Roads', // "Who Held {place}", the longest place
  lore: 'Twelve killing strokes, logged by a quartermaster who stopped enjoying it.',
};

// Every text box of a ceremony: cut, clamped or ellipsized content, a box outside the
// layer (or outside `bandSel`), under a button, or under the notch / home bar. Returns
// the problems found (the caller expects none).
function auditText({ root, scope = null, bandSel = null, insets }) {
  const layer = [...document.querySelectorAll(root)].at(-1);
  if (!layer) return [`missing ${root}`];
  const frame = layer.getBoundingClientRect();
  const within = scope ? layer.querySelector(scope) : layer;
  const band = bandSel ? layer.querySelector(bandSel)?.getBoundingClientRect() : null;
  const buttons = [...layer.querySelectorAll('button')]
    .filter((b) => b.getClientRects().length)
    .map((b) => b.getBoundingClientRect());
  const bad = [];
  for (const n of within.querySelectorAll('*')) {
    if (n.closest('button') || !n.getClientRects().length) continue;
    if (![...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim())) continue;
    const cs = getComputedStyle(n);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    const name = `${n.className || n.tagName} "${n.textContent.trim().slice(0, 32)}"`;
    if (cs.textOverflow === 'ellipsis' && n.scrollWidth > n.clientWidth + 1)
      bad.push(`ellipsized ${name}`);
    if (/hidden|clip/.test(cs.overflowX) && n.scrollWidth > n.clientWidth + 1)
      bad.push(`cut sideways ${name}`);
    if (/hidden|clip/.test(cs.overflowY) && n.scrollHeight > n.clientHeight + 1)
      bad.push(`cut ${name}`);
    const r = n.getBoundingClientRect();
    if (
      r.top < frame.top - 1 ||
      r.bottom > frame.bottom + 1 ||
      r.left < frame.left - 1 ||
      r.right > frame.right + 1
    )
      bad.push(`off frame ${name}`);
    if (band && (r.top < band.top - 1 || r.bottom > band.bottom + 1))
      bad.push(`outside band ${name}`);
    if (r.top < insets.top - 0.5 || r.bottom > innerHeight - insets.bottom + 0.5)
      bad.push(`under the notch or home bar ${name}`);
    for (const b of buttons)
      if (
        r.bottom > b.top + 1 &&
        r.top < b.bottom - 1 &&
        r.right > b.left + 1 &&
        r.left < b.right - 1
      )
        bad.push(`under a button ${name}`);
  }
  return bad;
}

/**
 * Boxes of a band card: layer, band, bust image and the words' column. The band and the
 * words are laid-out boxes (the deed's slant is a transform: its bounding box would
 * rise at one end and sink at the other).
 */
function bandCardBoxes({ root, band, bust, text }) {
  const layer = [...document.querySelectorAll(root)].at(-1);
  const f = layer.getBoundingClientRect();
  const laid = (sel) => {
    const el = layer.querySelector(sel);
    if (!el) return null;
    let x = 0;
    let y = 0;
    for (let n = el; n && n !== layer; n = n.offsetParent) {
      x += n.offsetLeft;
      y += n.offsetTop;
    }
    const left = f.left + x;
    const top = f.top + y;
    return {
      left,
      top,
      right: left + el.offsetWidth,
      bottom: top + el.offsetHeight,
      width: el.offsetWidth,
    };
  };
  const r = layer.querySelector(bust)?.getBoundingClientRect();
  return {
    frame: { left: f.left, right: f.right, top: f.top, bottom: f.bottom, width: f.width },
    band: laid(band),
    bust: r ? { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width } : null,
    text: laid(text),
  };
}

/**
 * The bust stands over a full-width band: its feet at the band's top edge, whole inside
 * the frame and clear of the notch, and the words spanning the band.
 */
function expectStacked(b, label, insets) {
  expect(b.bust, `${label}: bust`).not.toBeNull();
  expect(b.bust.bottom, `${label}: bust stands on the band`).toBeLessThanOrEqual(b.band.top + 14);
  expect(b.bust.top, `${label}: bust inside the frame`).toBeGreaterThanOrEqual(b.frame.top - 1);
  expect(b.bust.top, `${label}: bust clears the notch`).toBeGreaterThanOrEqual(insets.top - 0.5);
  expect(b.bust.width, `${label}: bust reads (>= 96 px)`).toBeGreaterThanOrEqual(96);
  expect(b.text.left - b.frame.left, `${label}: words start at the frame's edge`).toBeLessThan(24);
  expect(b.frame.right - b.text.right, `${label}: words reach the frame's edge`).toBeLessThan(24);
}

// ── Upright phones ──────────────────────────────────────────────────────

for (const viewport of PORTRAIT_PHONES) {
  const size = `${viewport.width}x${viewport.height}`;
  test.describe(`upright ${size}`, () => {
    test.use(device(viewport));

    test('boss, recruit, deed and level-up cards read in full', async ({ page }) => {
      const errors = pageErrors(page);
      // Reduced motion: every card at its end state at once (no entrance transforms).
      await quietSettings(page, { reduceMotion: true });
      const insets = await safeAreaInsets(page, NOTCH_PORTRAIT);
      await bootBattle(page);
      await expectPortraitUi(page);

      // Boss: the longest name and epithet, through the real encounter card.
      await page.evaluate(async (name) => {
        const s = window.__emblemRogueGame.scene.getScene('Battle');
        s.time.timeScale = 0.01; // hold it while it is measured
        const gd = s.gameData;
        const { createUnit } = await import('/src/engine/UnitManager.js');
        const def = Object.values(gd.enemies.bosses)
          .flat()
          .find((b) => b.name === name);
        const base = gd.classes.find((c) => c.name === 'Fighter');
        const u = createUnit(base, 10, gd.weapons, { name });
        Object.assign(u, { faction: 'enemy', isBoss: true, className: def.className });
        void s._getCeremonies().showBossIntro({ unit: u, actId: 'act2' });
      }, LONGEST.boss);
      const boss = page.locator('.ce-boss-layer');
      await expect(boss.locator('.ce-boss-name')).toHaveText(LONGEST.boss);
      await expectSingleLine(boss.locator('.ce-boss-name'));
      await expectSingleLine(boss.locator('.ce-boss-epithet'));
      const bossFont = await boss
        .locator('.ce-boss-name')
        .evaluate((n) => parseFloat(getComputedStyle(n).fontSize));
      expect(bossFont, 'the name keeps a display size').toBeGreaterThanOrEqual(22);
      expectStacked(
        await page.evaluate(bandCardBoxes, {
          root: '.ce-boss-layer',
          band: '.ce-boss-band',
          bust: '.ce-boss-portrait',
          text: '.ce-boss-text',
        }),
        'boss',
        insets,
      );
      expect(await page.evaluate(auditText, { root: '.ce-boss-layer', insets })).toEqual([]);
      // The skip line stays clear of the band.
      const hint = await page.evaluate(() => {
        const layer = document.querySelector('.ce-boss-layer');
        return {
          hint: layer.querySelector('.ce-skip').getBoundingClientRect().top,
          band: layer.querySelector('.ce-boss-band').getBoundingClientRect().bottom,
        };
      });
      expect(hint.hint).toBeGreaterThanOrEqual(hint.band);
      await page.screenshot({ path: test.info().outputPath(`boss-${size}.png`) });
      await page.waitForTimeout(250); // taps in the first 180 ms after opening are ignored
      await boss.tap();
      await expect(boss).toHaveCount(0);

      // The Entity (the 3x3 final boss): no name; its image fills the band, in frame.
      await page.evaluate(async () => {
        const s = window.__emblemRogueGame.scene.getScene('Battle');
        const gd = s.gameData;
        const { createUnit } = await import('/src/engine/UnitManager.js');
        const base = gd.classes.find((c) => c.name === 'Fighter');
        const u = createUnit(base, 20, gd.weapons, { name: 'The Entity' });
        Object.assign(u, { faction: 'enemy', isBoss: true, isEntity: true });
        void s._getCeremonies().showBossIntro({ unit: u, actId: 'act4' });
      });
      const entity = page.locator('.ce-boss-layer--entity');
      await expect(entity.locator('.ce-boss-mark')).toHaveText('· · ·');
      const entityFit = await entity.evaluate((layer) => {
        const f = layer.getBoundingClientRect();
        const band = layer.querySelector('.ce-boss-band').getBoundingClientRect();
        const mark = layer.querySelector('.ce-boss-mark').getBoundingClientRect();
        return {
          band: band.left >= f.left - 1 && band.right <= f.right + 1 && band.top >= f.top,
          mark: mark.top >= band.top - 1 && mark.bottom <= band.bottom + 1,
        };
      });
      expect(entityFit).toEqual({ band: true, mark: true });
      await page.waitForTimeout(250);
      await entity.tap();
      await expect(entity).toHaveCount(0);

      // Victory: "Turn 12 · Par 10 · Rank A · …" wraps between its parts, inside the band.
      await page.evaluate(() => {
        const s = window.__emblemRogueGame.scene.getScene('Battle');
        s._getCeremonies().showVictory({
          objective: 'rout',
          turn: 12,
          par: 10,
          rating: 'A',
          shadowGain: 3,
          shadowRelief: 1,
        });
      });
      const victory = page.locator('.ce-band-layer--victory');
      await expect(victory.locator('.ce-band-word')).toHaveText('ROUTED');
      await expectSingleLine(victory.locator('.ce-band-word'));
      await expectSingleLine(victory.locator('.ce-band-sub > .ce-part'));
      expect(
        await page.evaluate(auditText, {
          root: '.ce-band-layer--victory',
          bandSel: '.ce-band',
          insets,
        }),
      ).toEqual([]);
      await page.evaluate(() =>
        window.__emblemRogueGame.scene.getScene('Battle')._ceremonies?.destroy(),
      );
      await expect(victory).toHaveCount(0);

      // Recruit: the longest name with a long line, then a lord's legendary arrival.
      for (const kind of ['recruit', 'lord']) {
        await page.evaluate(
          async ({ kind, LONGEST }) => {
            const s = window.__emblemRogueGame.scene.getScene('Battle');
            s.time.timeScale = 0.01;
            const gd = s.gameData;
            const { growthCeremonies } = await import('/src/ui/GrowthCeremonyController.js');
            const { createUnit, createLordUnit } = await import('/src/engine/UnitManager.js');
            let u;
            if (kind === 'lord') {
              const def = gd.lords.find((l) => l.name === 'Sera');
              u = createLordUnit(
                def,
                gd.classes.find((c) => c.name === def.class),
                gd.weapons,
              );
              u.traits = ['overflowing_grace'];
            } else {
              const cls = gd.classes.find((c) => c.name === 'Pegasus Knight');
              u = createUnit(cls, 12, gd.weapons, { name: LONGEST.recruit });
            }
            u.faction = 'player';
            void growthCeremonies(s).showRecruit({ unit: u, kind, line: LONGEST.recruitLine });
          },
          { kind, LONGEST },
        );
        const join = page.locator('.gr-join-layer');
        await expect(join).toBeVisible();
        await expectSingleLine(join.locator('.gr-join-name'));
        expectStacked(
          await page.evaluate(bandCardBoxes, {
            root: '.gr-join-layer',
            band: '.gr-join-band',
            bust: '.gr-join-portrait',
            text: '.gr-join-text',
          }),
          kind,
          insets,
        );
        expect(
          await page.evaluate(auditText, {
            root: '.gr-join-layer',
            scope: '.gr-join-text',
            bandSel: '.gr-join-band',
            insets,
          }),
          kind,
        ).toEqual([]);
        await page.screenshot({ path: test.info().outputPath(`join-${kind}-${size}.png`) });
        await page.waitForTimeout(250);
        await join.tap();
        await expect(join).toHaveCount(0);
      }

      // Deed: the longest name, epithet and lore, a "held beneath" note, an Oath and a
      // batch count; Next deed, then Continue, through real taps.
      await page.evaluate(async (LONGEST) => {
        const s = window.__emblemRogueGame.scene.getScene('Battle');
        const u = s.playerUnits.find((p) => p.name === 'Edric');
        u.deeds = { earned: [{ id: 'avenger', prestige: 4, seq: 1, epithet: 'the Avenger' }] };
        const entry = {
          unit: u,
          unitName: 'Wendeline',
          deedId: 'avenger',
          name: LONGEST.deed,
          epithet: LONGEST.epithet,
          form: 'who',
          lore: LONGEST.lore,
          prestige: 5,
          isTitle: false,
        };
        const { growthCeremonies } = await import('/src/ui/GrowthCeremonyController.js');
        window.__deedsDone = false;
        void growthCeremonies(s)
          .showDeeds({ entries: [entry, { ...entry, epithet: 'the Avenger' }] })
          .then(() => (window.__deedsDone = true));
      }, LONGEST);
      const deed = page.locator('.gr-deed-layer');
      await expect(deed.locator('.gr-deed-oath')).toHaveText('Oath at promotion · Fury');
      await expectSingleLine(deed.locator('.gr-deed-kicker'));
      const deedBoxes = await page.evaluate(bandCardBoxes, {
        root: '.gr-deed-layer',
        band: '.gr-deed-text',
        bust: '.gr-deed-portrait',
        text: '.gr-deed-text',
      });
      expectStacked(deedBoxes, 'deed', insets);
      expect(
        await page.evaluate(auditText, {
          root: '.gr-deed-layer',
          scope: '.gr-deed-text',
          insets,
        }),
      ).toEqual([]);
      // Every line inside the (grown) band, the band clear of the Next / Skip row and the
      // seal clear of the words.
      const deedFit = await page.evaluate(() => {
        const text = document.querySelector('.gr-deed-text');
        const kids = [...text.children];
        const seal = document.querySelector('.gr-deed-seal').getBoundingClientRect();
        const words = kids.map((k) => k.getBoundingClientRect());
        // The slanted band, hit-tested (transforms included) along the top row of the
        // Next / Skip controls: it must end above them.
        const controls = document.querySelector('.gr-deed-controls').getBoundingClientRect();
        const slash = document.querySelector('.gr-deed-slash');
        const xs = [controls.left + 1, (controls.left + controls.right) / 2, controls.right - 1];
        return {
          band: text.clientHeight,
          top: kids[0].offsetTop,
          bottom: Math.max(...kids.map((k) => k.offsetTop + k.offsetHeight)),
          bandOverControls: xs.some((x) =>
            document.elementsFromPoint(x, controls.top + 1).includes(slash),
          ),
          sealOverWords: words.some(
            (r) =>
              r.right > seal.left + 4 &&
              r.left < seal.right &&
              r.bottom > seal.top &&
              r.top < seal.bottom - 4,
          ),
        };
      });
      expect(deedFit.top).toBeGreaterThanOrEqual(0);
      expect(deedFit.bottom).toBeLessThanOrEqual(deedFit.band);
      expect(deedFit.bandOverControls).toBe(false);
      expect(deedFit.sealOverWords).toBe(false);
      await expectTappable(deed.getByRole('button', { name: 'Skip all', exact: true }));
      await expectInsideSafeArea(page, '.gr-deed-controls', NOTCH_PORTRAIT);
      await page.screenshot({ path: test.info().outputPath(`deed-${size}.png`) });
      await page.waitForTimeout(250);
      await deed.getByRole('button', { name: 'Next deed', exact: true }).tap();
      await expect(deed.locator('.gr-deed-count')).toHaveText('2 / 2');
      await page.waitForTimeout(250);
      await deed.getByRole('button', { name: 'Continue', exact: true }).tap();
      await page.waitForFunction(() => window.__deedsDone === true);

      // Level-up: a perfect level of +2/+3 gains, two new skills and the longest line.
      await page.evaluate(async (LONGEST) => {
        const s = window.__emblemRogueGame.scene.getScene('Battle');
        const u = s.playerUnits.find((p) => p.name === 'Edric');
        const gains = { HP: 3, STR: 2, MAG: 2, SKL: 2, SPD: 2, DEF: 2, RES: 2, LCK: 2 };
        const { growthCeremonies } = await import('/src/ui/GrowthCeremonyController.js');
        void growthCeremonies(s).showLevelUp({
          unit: u,
          result: { newLevel: 20, gains, displayStats: u.stats },
          learnedNames: ["Commander's Gambit", 'Tactical Advantage'],
        });
        await new Promise((r) => setTimeout(r, 100));
        const main = document.querySelector('.gr-level-main');
        let quote = main.querySelector('.gr-level-quote');
        if (!quote) {
          quote = document.createElement('p');
          quote.className = 'gr-level-quote';
          main.insertBefore(quote, main.querySelector('.gr-seals--level'));
        }
        quote.textContent = `“${LONGEST.quote}”`;
        window.dispatchEvent(new Event('resize'));
      }, LONGEST);
      const level = page.locator('.gr-level-layer');
      await expect(level.locator('.gr-level-row')).toHaveCount(8);
      await expect
        .poll(() => page.evaluate(auditText, { root: '.gr-level-layer', insets }))
        .toEqual([]);
      const card = await page.evaluate(() => {
        const layer = document.querySelector('.gr-level-layer').getBoundingClientRect();
        const c = document.querySelector('.gr-level');
        const r = c.getBoundingClientRect();
        const main = c.querySelector('.gr-level-main').getBoundingClientRect();
        const portrait = c.querySelector('.gr-level-portrait');
        const stats = c.querySelector('.gr-level-stats').getBoundingClientRect();
        const rows = [...c.querySelectorAll('.gr-level-row')].map((n) => n.getBoundingClientRect());
        const p = portrait?.getClientRects().length ? portrait.getBoundingClientRect() : null;
        return {
          inFrame: r.top >= layer.top - 1 && r.bottom <= layer.bottom + 1,
          mainShare: main.width / r.width,
          statsWidth: stats.width / main.width,
          rowWidth: Math.min(...rows.map((q) => q.width)),
          portraitAboveStats: p ? p.bottom <= stats.top + 1 : null,
        };
      });
      expect(card.inFrame).toBe(true);
      // The words and stats take the card's width; the portrait sits in the header.
      expect(card.mainShare).toBeGreaterThan(0.9);
      expect(card.statsWidth).toBeGreaterThan(0.98);
      expect(card.rowWidth).toBeGreaterThanOrEqual(150);
      if (card.portraitAboveStats !== null) expect(card.portraitAboveStats).toBe(true);
      await expectTappable(level.getByRole('button', { name: 'Continue', exact: true }));
      await page.screenshot({ path: test.info().outputPath(`level-${size}.png`) });
      await page.waitForTimeout(250);
      await level.getByRole('button', { name: 'Continue', exact: true }).tap();
      await expect(level).toHaveCount(0);
      await expectNoSidewaysScroll(page);
      expect(errors).toEqual([]);
    });

    test('Master Seal: path chooser, then the rite over the whole screen; promoted once', async ({
      page,
    }) => {
      // Boots a battle: give it the slow-runner budget (CI runners are slower).
      test.slow();
      const errors = pageErrors(page);
      await quietSettings(page);
      const insets = await safeAreaInsets(page, NOTCH_PORTRAIT);
      await bootBattle(page);
      // A Knight with the longest name, a Master Seal and a deed's Oath: the fullest rite
      // (seven bonuses, two new weapons, a rank, two skills and the Oath, a growth note).
      const name = await page.evaluate((recruit) => {
        const s = window.__emblemRogueGame.scene.getScene('Battle');
        const u = s.playerUnits.find((x) => x.name === 'Sera');
        Object.assign(u, {
          name: recruit,
          isLord: false,
          className: 'Knight',
          tier: 'base',
          level: 10,
          proficiencies: [{ type: 'Lance', rank: 'Prof' }],
          skills: [],
        });
        u.deeds = { earned: [{ id: 'giantslayer', prestige: 3, seq: 1, epithet: 'Giantslayer' }] };
        const lance = s.gameData.weapons.find((w) => w.name === 'Iron Lance');
        u.inventory = [structuredClone(lance)];
        u.weapon = u.inventory[0];
        u.consumables = [
          structuredClone(s.gameData.consumables.find((i) => i.effect === 'promote')),
        ];
        s.removeUnitGraphic(u);
        s.addUnitGraphic(u);
        return u.name;
      }, LONGEST.recruit);
      const point = await page.evaluate((name) => {
        const s = window.__emblemRogueGame.scene.getScene('Battle');
        const u = s.playerUnits.find((x) => x.name === name);
        const w = s.grid.gridToPixel(u.col, u.row);
        const q = s._worldToScreen(w.x, w.y);
        const r = s.game.canvas.getBoundingClientRect();
        return {
          x: r.x + (q.x * r.width) / s.scale.width,
          y: r.y + (q.y * r.height) / s.scale.height,
        };
      }, name);
      await page.touchscreen.tap(point.x, point.y);
      const hud = page.getByRole('complementary', { name: 'Battle commands' });
      await hud.getByRole('button', { name: 'Item', exact: true }).tap();
      await hud.getByRole('button', { name: /^Master Seal/ }).tap();

      const chooser = page.getByRole('dialog', { name: 'Choose promotion', exact: true });
      await expect(chooser.locator('.gr-path')).toHaveCount(2);
      await expectNoSidewaysScroll(page, '.gr-paths');
      await expectSingleLine(chooser.locator('.gr-path-title strong'));
      for (const path of await chooser.locator('.gr-path').all())
        expect(await path.evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
      await chooser.getByRole('button', { name: 'Select Great Knight', exact: true }).tap();
      const confirm = chooser.getByRole('button', { name: 'Confirm promotion', exact: true });
      await expectTappable(confirm);
      await expectInsideSafeArea(page, '.gr-chooser-confirm', NOTCH_PORTRAIT);
      await page.screenshot({ path: test.info().outputPath(`chooser-${size}.png`) });
      await confirm.tap();

      const rite = page.getByRole('dialog', { name: 'Promotion', exact: true });
      await expect(rite).toBeVisible();
      // Upright the rite takes the screen (the rail is inert under it).
      const frame = await rite.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, frame: el.dataset.frame };
      });
      expect(frame).toEqual({ top: 0, bottom: viewport.height, frame: 'screen' });
      // Its end state: every word in view, none under the corner button, nothing scrolls.
      await rite.getByRole('button', { name: /^(Skip|Continue)$/ }).waitFor();
      await page.waitForTimeout(250);
      if (await rite.getByRole('button', { name: 'Skip', exact: true }).count())
        await rite.getByRole('button', { name: 'Skip', exact: true }).tap();
      const cont = rite.getByRole('button', { name: 'Continue', exact: true });
      await expect(cont).toBeVisible();
      await expect(rite.locator('.gr-name--to')).toHaveText('Great Knight');
      await expectSingleLine(rite.locator('.gr-name--to'));
      expect(
        await page.evaluate(auditText, {
          root: '.gr-rite-layer',
          scope: '.gr-rite-text',
          insets,
        }),
      ).toEqual([]);
      const layout = await rite.evaluate((el) => {
        const text = el.querySelector('.gr-rite-text');
        const fig = el.querySelector('.gr-rite-bust').getBoundingClientRect();
        const t = text.getBoundingClientRect();
        return {
          figureAbove: fig.bottom <= t.top + 1,
          figure: fig.height,
          scrolls: text.scrollHeight > text.clientHeight + 1,
          textWidth: t.width / el.getBoundingClientRect().width,
          seals: el.querySelectorAll('.gr-seal').length,
        };
      });
      expect(layout.figureAbove, 'the figure stands over the words').toBe(true);
      expect(layout.figure).toBeGreaterThanOrEqual(96);
      expect(layout.scrolls, 'the words never scroll').toBe(false);
      expect(layout.textWidth).toBeGreaterThan(0.85);
      expect(layout.seals).toBe(6);
      await expectTappable(cont);
      await expectInsideSafeArea(page, '.gr-rite > .gr-continue', NOTCH_PORTRAIT);
      await expectInsideSafeArea(page, '.gr-rite-portrait', NOTCH_PORTRAIT);
      await page.screenshot({ path: test.info().outputPath(`rite-${size}.png`) });
      await cont.tap();
      await expect(rite).toHaveCount(0);
      // Promoted once, the seal spent, and the battle takes input again (a Great Knight
      // may Canto: the rail offers the rest of its move).
      await expect
        .poll(() =>
          page.evaluate((name) => {
            const s = window.__emblemRogueGame.scene.getScene('Battle');
            const u = s.playerUnits.find((x) => x.name === name);
            return {
              className: u.className,
              seals: u.consumables.length,
              locked: s.isStoryInputLocked(),
              railInert: document.querySelector('.mobile-battle-hud').inert,
            };
          }, name),
        )
        .toEqual({ className: 'Great Knight', seals: 0, locked: false, railInert: false });
      expect(errors).toEqual([]);
    });

    test('the lord falls: fate, the thread cut, farewell lines, the run result', async ({
      page,
    }) => {
      // Boots a battle: give it the slow-runner budget (CI runners are slower).
      test.slow();
      const errors = pageErrors(page);
      await quietSettings(page);
      const insets = await safeAreaInsets(page, NOTCH_PORTRAIT);
      await bootBattle(page);
      await page.evaluate(async () => {
        const s = window.__emblemRogueGame.scene.getScene('Battle');
        const { getMetaKey, setActiveSlot } = await import('/src/engine/SlotManager.js');
        const meta = s.registry.get('meta');
        meta.storageKey = getMetaKey(1);
        meta._save();
        s.registry.set('activeSlot', 1);
        setActiveSlot(1);
        s.runManager.visionChargesRemaining = 3;
        s._captureSuspendCheckpoint();
        // A lord who fell to a boss deep in the run: the longest result lines.
        s.runManager.completedBattles = 12;
        const commander = s.playerUnits.find((u) => u.isCommander);
        commander.currentHP = 0;
        await s.removeUnit(commander, { killer: s.enemyUnits[0] });
        s.checkBattleEnd();
      });
      const fate = page.locator('.ce-fate');
      await expect(fate.locator('.ce-band-word')).toHaveText('FALLEN');
      const rewind = page.getByRole('button', { name: 'Rewind · 3 left', exact: true });
      const accept = page.getByRole('button', { name: 'Accept fate', exact: true });
      await expectTappable(rewind);
      await expectTappable(accept);
      await expect
        .poll(() =>
          page.evaluate(() => {
            const map = document.querySelector('#game-container').getBoundingClientRect();
            const offer = document.querySelector('.ce-offer').getBoundingClientRect();
            return offer.left >= 0 && offer.right <= innerWidth && offer.bottom <= map.bottom;
          }),
        )
        .toBe(true);
      await expectSingleLine(fate.locator('.ce-band-word'));
      await page.screenshot({ path: test.info().outputPath(`fate-${size}.png`) });
      await accept.tap();

      await waitForScene(page, 'RunComplete');
      const card = page.locator('.ce-runend-layer');
      await expect(card.locator('.ce-runend-word')).toHaveText('THE THREAD IS CUT');
      await expectSingleLine(card.locator('.ce-runend-word'));
      // The title and its lines clear the notch; each part of the place line is whole.
      await expectInsideSafeArea(page, '.ce-runend-word', NOTCH_PORTRAIT);
      await expectSingleLine(card.locator('.ce-runend-meta > .ce-part'));
      expect(await page.evaluate(auditText, { root: '.ce-runend-layer', insets })).toEqual([]);

      // The farewell lines over the card.
      const dialogue = page.locator('.re-dialogue');
      await expect(dialogue).toBeVisible();
      const skip = dialogue.getByRole('button', { name: 'Skip conversation', exact: true });
      const next = dialogue.getByRole('button', { name: 'Continue', exact: true });
      await expectTappable(next);
      if (await skip.count()) {
        await expectTappable(skip);
        await expectInsideSafeArea(page, '.re-dialogue footer .re-btn', NOTCH_PORTRAIT);
      }
      await page.screenshot({ path: test.info().outputPath(`farewell-${size}.png`) });
      await ((await skip.count()) ? skip : next).tap();

      const result = page.getByRole('dialog', { name: 'Game over', exact: true });
      await expect(result).toBeVisible({ timeout: 20_000 });
      await expectNoSidewaysScroll(page, '.re-run-flow .re-menu-body');
      await expect(result.locator('.re-run-summary dt').first()).toHaveText('Battles won');
      // One full-width list: each value on its label's row, against the right edge.
      const list = await result.evaluate((el) => {
        const dl = el.querySelector('.re-run-summary').getBoundingClientRect();
        const body = el.querySelector('.re-menu-body');
        const pad = parseFloat(getComputedStyle(body).paddingLeft) || 0;
        const inner = body.getBoundingClientRect().width - 2 * pad;
        const rows = [...el.querySelectorAll('.re-run-summary dt')].map((dt) => {
          const dd = dt.nextElementSibling;
          const a = dt.getBoundingClientRect();
          const b = dd.getBoundingClientRect();
          const range = document.createRange();
          range.selectNodeContents(dd);
          const text = range.getBoundingClientRect();
          return { sameRow: Math.abs(a.top - b.top) < 2, rightGap: dl.right - text.right };
        });
        return { share: dl.width / inner, rows };
      });
      expect(list.share).toBeGreaterThan(0.98);
      for (const row of list.rows) {
        expect(row.sameRow).toBe(true);
        expect(row.rightGap).toBeLessThan(1.5);
      }
      for (const label of ['Title', 'Battle report'])
        await expectTappable(result.getByRole('button', { name: label, exact: true }));
      await expectInsideSafeArea(page, '.re-run-flow .re-flow-actions .re-btn', NOTCH_PORTRAIT);
      await page.screenshot({ path: test.info().outputPath(`result-${size}.png`) });
      await result.getByRole('button', { name: 'Home Base', exact: true }).last().tap();
      await waitForScene(page, 'HomeBase');
      expect(errors).toEqual([]);
    });

    test('route map: the act title, story lines and the Eclipse card', async ({ page }) => {
      const errors = pageErrors(page);
      await quietSettings(page);
      await emulateSafeArea(page, NOTCH_PORTRAIT);
      await page.goto('/?devScene=nodemap&preset=eclipse&seed=42');
      await waitForScene(page, 'NodeMap');
      await expectPortraitUi(page);
      // The act title holds over the opening lines, clear of the notch.
      const act = page.locator('.ce-act-layer');
      await expect(act.locator('.ce-act-title')).toHaveText('Old Kingdom Roads');
      await expectSingleLine(act.locator('.ce-act-title'));
      await expectInsideSafeArea(page, '.ce-act-kicker', NOTCH_PORTRAIT);
      const dialogue = page.locator('.re-dialogue');
      const skip = dialogue.getByRole('button', { name: 'Skip conversation', exact: true });
      await expectTappable(skip);
      await expectTappable(dialogue.getByRole('button', { name: 'Continue', exact: true }));
      await expectInsideSafeArea(page, '.re-dialogue footer .re-btn', NOTCH_PORTRAIT);
      await skip.tap();
      await expect(act).toHaveCount(0);
      await expect(page.locator('.re-node-map')).toBeVisible();

      // The longest story line (Act III to IV) through the overlay the act transitions use:
      // the name and first lines beside the face, the rest under it at the panel's width.
      await page.evaluate(async () => {
        const s = window.__emblemRogueGame.scene.getScene('NodeMap');
        const { DialogueOverlay } = await import('/src/ui/DialogueOverlay.js');
        const entries = s.gameData.dialogue.actTransitions.act3_to_act4.base;
        window.__lines = new DialogueOverlay(s);
        window.__linesDone = false;
        void window.__lines.showSequence(entries).then(() => (window.__linesDone = true));
      });
      await expect(dialogue.locator('p')).toContainText('Their captains are broken');
      const wrap = await dialogue.evaluate((el) => {
        const face = el.querySelector('.re-dialogue-copy > img').getBoundingClientRect();
        const copy = el.querySelector('.re-dialogue-copy');
        const pad = copy.getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(el.querySelector('.re-dialogue-copy p'));
        // One entry per line box (its top: the glyph box less the half-leading), with
        // where its first glyph starts.
        const lineHeight = parseFloat(
          getComputedStyle(el.querySelector('.re-dialogue-copy p')).lineHeight,
        );
        const starts = new Map();
        for (const r of range.getClientRects()) {
          if (!(r.width > 1)) continue;
          const top = r.top - (lineHeight - r.height) / 2;
          const line = starts.get(Math.round(top)) || { top, left: Infinity };
          line.left = Math.min(line.left, r.left);
          starts.set(Math.round(top), line);
        }
        // A line box that starts at or below the face's foot is clear of it.
        const under = [...starts.values()]
          .filter((line) => line.top >= face.bottom - 0.01)
          .map((line) => [line.top, line.left]);
        return {
          under: under.length,
          underLeft: Math.max(...under.map(([, left]) => left - pad.left)),
          scrolls: copy.scrollHeight > copy.clientHeight + 1,
          name: (() => {
            const r = document.createRange();
            r.selectNodeContents(el.querySelector('h2'));
            return r.getBoundingClientRect().left > face.right;
          })(),
        };
      });
      expect(wrap.name, 'the name sits beside the face').toBe(true);
      // Below the face's foot every line starts at the panel's edge. On the two
      // narrower phones this line runs past the face (at 430 px it just fits beside it).
      if (viewport.width < 400)
        expect(wrap.under, 'the line wraps under the face').toBeGreaterThan(0);
      if (wrap.under) expect(wrap.underLeft, 'at the panel width').toBeLessThan(2);
      expect(wrap.scrolls).toBe(false);
      await page.screenshot({ path: test.info().outputPath(`story-${size}.png`) });
      const cont = dialogue.getByRole('button', { name: 'Continue', exact: true });
      while (!(await page.evaluate(() => window.__linesDone))) {
        await expectTappable(cont);
        await cont.tap();
      }

      // The Eclipse explainer: a compact card that hugs its words inside the safe area.
      await expect(page.locator('.re-eclipse-toast')).toHaveCount(1, { timeout: 15_000 });
      await page.locator('.re-eclipse-medal').tap();
      const eclipse = page.getByRole('dialog', { name: 'The Eclipse', exact: true });
      await expect(eclipse).toContainText('What darkens it');
      await expectInsideSafeArea(page, '.re-eclipse-card', NOTCH_PORTRAIT);
      await expectNoSidewaysScroll(page, '.re-eclipse-card .re-menu-body');
      const hug = await eclipse.evaluate((el) => {
        const body = el.querySelector('.re-menu-body');
        return {
          empty: body.clientHeight - body.scrollHeight,
          scrolls: body.scrollHeight > body.clientHeight + 1,
        };
      });
      expect(hug.empty, 'no empty panel under the words').toBeLessThanOrEqual(1);
      if (viewport.height >= 800) expect(hug.scrolls).toBe(false);
      await expectTappable(eclipse.getByRole('button', { name: 'Close', exact: true }));
      await page.screenshot({ path: test.info().outputPath(`eclipse-${size}.png`) });
      await eclipse.getByRole('button', { name: 'Close', exact: true }).tap();
      await expect(eclipse).toHaveCount(0);
      expect(errors).toEqual([]);
    });
  });
}

// The level-up card through a real kill on the turned board (the smallest phone: the
// map frame above the rail is at its shortest there).
test.describe('upright 375x667, a real kill', () => {
  test.use(device(PORTRAIT_PHONES[0]));

  test('the level-up card reads in full and the gains are kept', async ({ page }) => {
    // Boots a battle: give it the slow-runner budget (CI runners are slower).
    test.slow();
    const errors = pageErrors(page);
    await quietSettings(page);
    const insets = await safeAreaInsets(page, NOTCH_PORTRAIT);
    await bootBattle(page);
    const before = await page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      const u = s.playerUnits.find((p) => p.name === 'Edric');
      u.xp = 99;
      u.stats.STR = 999;
      u.weapon.hit = 999;
      const enemy = s.enemyUnits[0];
      const tile = [
        [u.col + 1, u.row],
        [u.col - 1, u.row],
        [u.col, u.row + 1],
        [u.col, u.row - 1],
      ].find(
        ([col, row]) =>
          col >= 0 && row >= 0 && col < s.grid.cols && row < s.grid.rows && !s.getUnitAt(col, row),
      );
      [enemy.col, enemy.row] = tile;
      enemy.name = 'Growth Target';
      enemy.currentHP = 1;
      enemy.skills = [];
      s.grid.setTerrainAt(enemy.col, enemy.row, 0);
      s.updateUnitPosition(enemy);
      s.updateHPBar(enemy);
      return { level: u.level, rotation: s.grid.board.rotation };
    });
    expect(before.rotation).toBe('ccw'); // the board is turned: this is the upright battle
    const tap = async (name, group) => {
      const p = await page.evaluate(
        ({ name, group }) => {
          const s = window.__emblemRogueGame.scene.getScene('Battle');
          const u = s[group].find((x) => x.name === name);
          const w = s.grid.gridToPixel(u.col, u.row);
          const q = s._worldToScreen(w.x, w.y);
          const r = s.game.canvas.getBoundingClientRect();
          return {
            x: r.x + (q.x * r.width) / s.scale.width,
            y: r.y + (q.y * r.height) / s.scale.height,
          };
        },
        { name, group },
      );
      await page.touchscreen.tap(p.x, p.y);
    };
    await tap('Edric', 'playerUnits');
    const hud = page.getByRole('complementary', { name: 'Battle commands' });
    await hud.getByRole('button', { name: 'Attack', exact: true }).tap();
    await tap('Growth Target', 'enemyUnits');
    await page.getByRole('button', { name: 'Confirm attack', exact: true }).tap();
    const card = page.getByRole('dialog', { name: 'Level up', exact: true });
    await expect(card).toBeVisible({ timeout: 25_000 });
    await expect(page.locator('.gr-level-layer')).toHaveClass(/is-done/, { timeout: 5000 });
    expect(await page.evaluate(auditText, { root: '.gr-level-layer', insets })).toEqual([]);
    // Above the rail, inside the map frame; the portrait in the header's corner.
    const fit = await page.evaluate(() => {
      const c = document.querySelector('.gr-level').getBoundingClientRect();
      const rail = document.querySelector('.mobile-battle-hud').getBoundingClientRect();
      const p = document.querySelector('.gr-level-portrait');
      const stats = document.querySelector('.gr-level-stats').getBoundingClientRect();
      const main = document.querySelector('.gr-level-main').getBoundingClientRect();
      const pr = p?.getClientRects().length ? p.getBoundingClientRect() : null;
      return {
        aboveRail: c.bottom <= rail.top + 1,
        portraitInHeader: pr ? pr.bottom <= stats.top + 1 : null,
        mainShare: main.width / c.width,
      };
    });
    expect(fit.aboveRail).toBe(true);
    if (fit.portraitInHeader !== null) expect(fit.portraitInHeader).toBe(true);
    expect(fit.mainShare).toBeGreaterThan(0.9);
    const cont = card.getByRole('button', { name: 'Continue', exact: true });
    await expectTappable(cont);
    await page.screenshot({ path: test.info().outputPath('level-kill-375x667.png') });
    const shown = await page.evaluate(() => ({
      ...window.__emblemRogueGame.scene
        .getScene('Battle')
        .playerUnits.find((p) => p.name === 'Edric').stats,
    }));
    await cont.tap();
    await expect(card).toHaveCount(0);
    await page.waitForFunction(
      () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'PLAYER_IDLE',
      null,
      { timeout: 30_000 },
    );
    // Presentation only: one level gained, the stats shown are the stats kept.
    const after = await page.evaluate(() => {
      const u = window.__emblemRogueGame.scene
        .getScene('Battle')
        .playerUnits.find((p) => p.name === 'Edric');
      return { level: u.level, stats: u.stats };
    });
    expect(after.level).toBe(before.level + 1);
    expect(after.stats).toEqual(shown);
    expect(errors).toEqual([]);
  });
});

// ── Landscape phones and desktop: unchanged ─────────────────────────────
// Two checks per screen. (a) With the portrait classes on the page (a landscape battle
// keeps portrait-battle-capable; a stale portrait-ui during a turn) every box of the
// ceremony sits exactly where it sits without them: the upright rules and the upright
// frame answer to the orientation, not the class alone. (b) The boxes the layout (not
// the system font) decides sit where they sit on main (MAIN, measured on d026b9b5 with
// PORTRAIT_CEREMONIES_DUMP=1).

const LANDSCAPE = [
  ...LANDSCAPE_PHONES.map((v) => ({ ...v, phone: true })),
  ...DESKTOPS.map((v) => ({ ...v, phone: false })),
];

const ROOTS = {
  boss: '.ce-boss-layer',
  join: '.gr-join-layer',
  deed: '.gr-deed-layer',
  level: '.gr-level-layer',
  rite: '.gr-rite-layer',
};

/** Opens one ceremony in the running battle (reduced motion: its end state at once). */
function openCeremony(page, kind) {
  return page.evaluate(
    async ({ kind, LONGEST }) => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      s.time.timeScale = 0.01;
      const gd = s.gameData;
      const { growthCeremonies } = await import('/src/ui/GrowthCeremonyController.js');
      const { promotionPathContent } = await import('/src/ui/growthContent.js');
      const { createUnit } = await import('/src/engine/UnitManager.js');
      const g = growthCeremonies(s);
      const edric = s.playerUnits.find((u) => u.name === 'Edric');
      if (kind === 'boss') {
        const def = Object.values(gd.enemies.bosses)
          .flat()
          .find((b) => b.name === LONGEST.boss);
        const u = createUnit(
          gd.classes.find((c) => c.name === 'Fighter'),
          10,
          gd.weapons,
          {
            name: LONGEST.boss,
          },
        );
        Object.assign(u, { faction: 'enemy', isBoss: true, className: def.className });
        void s._getCeremonies().showBossIntro({ unit: u, actId: 'act2' });
      } else if (kind === 'join') {
        const u = createUnit(
          gd.classes.find((c) => c.name === 'Pegasus Knight'),
          12,
          gd.weapons,
          {
            name: LONGEST.recruit,
          },
        );
        u.faction = 'player';
        void g.showRecruit({ unit: u, kind: 'recruit', line: 'We ride at dawn.' });
      } else if (kind === 'deed') {
        const entry = {
          unit: edric,
          unitName: 'Edric',
          deedId: 'avenger',
          name: 'Held the Line',
          epithet: 'the Unbroken',
          form: 'the',
          lore: 'The line held.',
          prestige: 3,
          isTitle: true,
        };
        void g.showDeeds({ entries: [entry] });
      } else if (kind === 'level') {
        const gains = { HP: 1, STR: 1, MAG: 0, SKL: 1, SPD: 1, DEF: 0, RES: 0, LCK: 1 };
        void g.showLevelUp({
          unit: edric,
          result: { newLevel: 5, gains, displayStats: edric.stats },
        });
      } else {
        const cls = gd.classes.find((c) => c.name === 'Great Lord');
        void g.showPromotionRite({ unit: edric, content: promotionPathContent(edric, cls, gd) });
      }
    },
    { kind, LONGEST },
  );
}

async function closeCeremonies(page) {
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    s._growthCeremonies?.destroy();
    s._ceremonies?.destroy();
    s.time.timeScale = 1;
  });
}

/** Every box under `root` (and its font size), keyed by position in the tree. */
function boxMap(root) {
  const layer = [...document.querySelectorAll(root)].at(-1);
  if (!layer) return null;
  const out = {};
  [layer, ...layer.querySelectorAll('*')].forEach((el, i) => {
    const r = el.getBoundingClientRect();
    const key = `${i} ${el.tagName.toLowerCase()}.${[...el.classList].join('.')}`;
    const box = [r.left, r.top, r.width, r.height].map((v) => Math.round(v * 10) / 10);
    out[key] = `${box.join(',')} ${getComputedStyle(el).fontSize}`;
  });
  return out;
}

/** (a): the same boxes with the portrait classes forced onto a landscape page. */
async function expectClassesInert(page, root, label) {
  await page.evaluate(() => document.fonts.ready);
  const plain = await page.evaluate(boxMap, root);
  expect(plain, `${label}: ${root} is showing`).not.toBeNull();
  const added = await page.evaluate(() => {
    const html = document.documentElement;
    const add = ['portrait-ui', 'portrait-battle-capable'].filter(
      (c) => !html.classList.contains(c),
    );
    html.classList.add(...add);
    // Ceremony layers re-measure their frame on this event (as when the phone turns).
    window.dispatchEvent(new CustomEvent('emblem-rogue:portrait-ui', { detail: { active: true } }));
    return add;
  });
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  const forced = await page.evaluate(boxMap, root);
  await page.evaluate((added) => {
    document.documentElement.classList.remove(...added);
    window.dispatchEvent(
      new CustomEvent('emblem-rogue:portrait-ui', { detail: { active: false } }),
    );
  }, added);
  expect(forced, `${label}: ${root} with the portrait classes on a landscape page`).toEqual(plain);
}

// (b): layout boxes as on main: [selector, which sides] per screen, measured by layoutBoxes.
const LAYOUT = {
  boss: [
    ['.ce-boss-layer', 'ltwh'],
    ['.ce-boss-band', 'ltwh'],
    ['.ce-boss-bust', 'ltwh'],
    ['.ce-boss-text', 'lw'],
  ],
  join: [
    ['.gr-join-layer', 'ltwh'],
    ['.gr-join-band', 'lw'],
    ['.gr-join-bust', 'lwh'],
    ['.gr-join-text', 'lw'],
  ],
  deed: [
    ['.gr-deed-layer', 'ltwh'],
    ['.gr-deed-bust', 'lwh'],
    ['.gr-deed-text', 'lw'],
    ['.gr-deed-seal', 'lwh'],
  ],
  level: [
    ['.gr-level-layer', 'ltwh'],
    ['.gr-level', 'lw'],
  ],
  rite: [
    ['.gr-rite-layer', 'ltwh'],
    ['.gr-rite > .gr-continue', 'lt'],
  ],
  dialogue: [
    ['.re-dialogue .re-panel', 'lw'],
    ['.re-dialogue-copy > img', 'lwh'],
  ],
  eclipse: [['.re-eclipse-card', 'ltwh']],
};

function layoutBoxes(spec) {
  return spec.map(([sel, sides]) => {
    const el = [...document.querySelectorAll(sel)].at(-1);
    if (!el) return `${sel} missing`;
    const r = el.getBoundingClientRect();
    const all = { l: r.left, t: r.top, w: r.width, h: r.height };
    return `${sel} ${[...sides].map((k) => `${k}${Math.round(all[k])}`).join(' ')}`;
  });
}

const DUMP = process.env.PORTRAIT_CEREMONIES_DUMP === '1';

async function expectAsOnMain(page, size, screen) {
  const boxes = await page.evaluate(layoutBoxes, LAYOUT[screen]);
  if (DUMP) {
    console.log(`MAIN ${size} ${screen} ${JSON.stringify(boxes)}`);
    return;
  }
  expect(MAIN[size]?.[screen], `MAIN has ${size} ${screen}`).toBeTruthy();
  LAYOUT[screen].forEach(([sel], i) => {
    const line = boxes[i];
    const expected = MAIN[size][screen][i];
    expect(line.startsWith(`${sel} `), line).toBe(true);
    expect(expected.startsWith(`${sel} `), expected).toBe(true);
    // "l47 t0 w252": side letter and px, each within 1 px of main.
    const sides = (text) => text.slice(sel.length + 1).split(' ');
    const got = sides(line);
    const want = sides(expected);
    expect(
      got.map((v) => v[0]),
      `${line} vs ${expected}`,
    ).toEqual(want.map((v) => v[0]));
    got.forEach((v, j) =>
      expect(
        Math.abs(Number(v.slice(1)) - Number(want[j].slice(1))),
        `${line} vs ${expected}`,
      ).toBeLessThanOrEqual(1),
    );
  });
}

/**
 * A landscape phone gets its side notch and home bar (emulated). Returns whether MAIN
 * applies: its phone boxes were measured with those insets, so a browser that cannot
 * emulate them (WebKit) lays the phone out without them; there only the comparison
 * with and without the portrait classes (expectClassesInert) holds.
 */
async function emulateSideNotch(page, vp) {
  if (!vp.phone) return true;
  return (await safeAreaInsets(page, NOTCH_LANDSCAPE)) !== NO_INSETS;
}

const MAIN = {
  '568x320': {
    boss: [
      '.ce-boss-layer l47 t0 w252 h299',
      '.ce-boss-band l47 t86 w252 h128',
      '.ce-boss-bust l53 t122 w91 h91',
      '.ce-boss-text l154 w127',
    ],
    join: [
      '.gr-join-layer l47 t0 w252 h299',
      '.gr-join-band l47 w252',
      '.gr-join-bust l53 w91 h91',
      '.gr-join-text l154 w127',
    ],
    deed: [
      '.gr-deed-layer l47 t0 w252 h299',
      '.gr-deed-bust l55 w81 h81',
      '.gr-deed-text l149 w66',
      '.gr-deed-seal l217 w78 h78',
    ],
    level: ['.gr-level-layer l47 t0 w252 h299', '.gr-level l57 w232'],
    rite: ['.gr-rite-layer l47 t0 w252 h299', '.gr-rite > .gr-continue l183 t253'],
    dialogue: ['.re-dialogue .re-panel l47 w474', '.re-dialogue-copy > img l58 w96 h96'],
    eclipse: ['.re-eclipse-card l54 t12 w460 h296'],
  },
  '667x375': {
    boss: [
      '.ce-boss-layer l47 t0 w351 h354',
      '.ce-boss-band l47 t113 w351 h128',
      '.ce-boss-bust l53 t114 w126 h126',
      '.ce-boss-text l189 w191',
    ],
    join: [
      '.gr-join-layer l47 t0 w351 h354',
      '.gr-join-band l47 w351',
      '.gr-join-bust l53 w126 h126',
      '.gr-join-text l189 w191',
    ],
    deed: [
      '.gr-deed-layer l47 t0 w351 h354',
      '.gr-deed-bust l58 w112 h112',
      '.gr-deed-text l184 w124',
      '.gr-deed-seal l312 w78 h78',
    ],
    level: ['.gr-level-layer l47 t0 w351 h354', '.gr-level l57 w331'],
    rite: ['.gr-rite-layer l47 t0 w351 h354', '.gr-rite > .gr-continue l282 t308'],
    dialogue: ['.re-dialogue .re-panel l47 w573', '.re-dialogue-copy > img l58 w96 h96'],
    eclipse: ['.re-eclipse-card l104 t12 w460 h351'],
  },
  '844x390': {
    boss: [
      '.ce-boss-layer l47 t0 w528 h369',
      '.ce-boss-band l47 t121 w528 h128',
      '.ce-boss-bust l53 t57 w190 h190',
      '.ce-boss-text l253 w304',
    ],
    join: [
      '.gr-join-layer l47 t0 w528 h369',
      '.gr-join-band l47 w528',
      '.gr-join-bust l53 w190 h190',
      '.gr-join-text l253 w304',
    ],
    deed: [
      '.gr-deed-layer l47 t0 w528 h369',
      '.gr-deed-bust l63 w169 h169',
      '.gr-deed-text l246 w226',
      '.gr-deed-seal l482 w78 h78',
    ],
    level: ['.gr-level-layer l47 t0 w528 h369', '.gr-level l57 w508'],
    rite: ['.gr-rite-layer l47 t0 w528 h369', '.gr-rite > .gr-continue l459 t323'],
    dialogue: ['.re-dialogue .re-panel l47 w750', '.re-dialogue-copy > img l58 w96 h96'],
    eclipse: ['.re-eclipse-card l192 t12 w460 h366'],
  },
  '640x480': {
    boss: [
      '.ce-boss-layer l0 t0 w640 h480',
      '.ce-boss-band l60 t176 w520 h128',
      '.ce-boss-bust l66 t116 w187 h187',
      '.ce-boss-text l263 w299',
    ],
    join: [
      '.gr-join-layer l0 t0 w640 h480',
      '.gr-join-band l60 w520',
      '.gr-join-bust l66 w187 h187',
      '.gr-join-text l263 w299',
    ],
    deed: [
      '.gr-deed-layer l0 t0 w640 h480',
      '.gr-deed-bust l19 w192 h192',
      '.gr-deed-text l225 w304',
      '.gr-deed-seal l542 w78 h78',
    ],
    level: ['.gr-level-layer l0 t0 w640 h480', '.gr-level l40 w560'],
    rite: ['.gr-rite-layer l0 t0 w640 h480', '.gr-rite > .gr-continue l524 t434'],
    dialogue: ['.re-dialogue .re-panel l12 w616', '.re-dialogue-copy > img l23 w96 h96'],
    eclipse: ['.re-eclipse-card l90 t12 w460 h456'],
  },
  '1280x800': {
    boss: [
      '.ce-boss-layer l106 t0 w1067 h800',
      '.ce-boss-band l213 t293 w853 h213',
      '.ce-boss-bust l219 t199 w307 h307',
      '.ce-boss-text l536 w512',
    ],
    join: [
      '.gr-join-layer l106 t0 w1067 h800',
      '.gr-join-band l213 w853',
      '.gr-join-bust l219 w307 h307',
      '.gr-join-text l536 w512',
    ],
    deed: [
      '.gr-deed-layer l106 t0 w1067 h800',
      '.gr-deed-bust l138 w341 h341',
      '.gr-deed-text l493 w495',
      '.gr-deed-seal l1010 w130 h130',
    ],
    level: ['.gr-level-layer l106 t0 w1067 h800', '.gr-level l173 w933'],
    rite: ['.gr-rite-layer l106 t0 w1067 h800', '.gr-rite > .gr-continue l977 t754'],
    dialogue: ['.re-dialogue .re-panel l260 w760', '.re-dialogue-copy > img l271 w96 h96'],
    eclipse: ['.re-eclipse-card l410 t120 w460 h560'],
  },
};

for (const vp of LANDSCAPE) {
  const size = `${vp.width}x${vp.height}`;
  test.describe(`landscape ${size} unchanged`, () => {
    test.use(
      vp.phone
        ? device({ width: vp.width, height: vp.height })
        : { viewport: { width: vp.width, height: vp.height } },
    );

    test('battle ceremonies, the run end and its result', async ({ page }) => {
      // Boots a battle: give it the slow-runner budget (CI runners are slower).
      test.slow();
      const errors = pageErrors(page);
      await quietSettings(page, { reduceMotion: true });
      const onMain = await emulateSideNotch(page, vp);
      await bootBattle(page);
      await expectPortraitUi(page, false);
      for (const kind of Object.keys(ROOTS)) {
        await openCeremony(page, kind);
        await expect(page.locator(ROOTS[kind]).last()).toBeVisible();
        await expectClassesInert(page, ROOTS[kind], `${size} ${kind}`);
        if (onMain) await expectAsOnMain(page, size, kind);
        await closeCeremonies(page);
      }

      // The run ends: THE THREAD IS CUT over the farewell lines, then the result.
      await page.evaluate(async () => {
        const s = window.__emblemRogueGame.scene.getScene('Battle');
        const { ensureSceneLoaded } = await import('/src/utils/sceneLoader.js');
        await ensureSceneLoaded(s, 'RunComplete');
        s.runManager.defeatContext = { defeatedBy: 'Knight Commander', wasBoss: true };
        s.scene.start('RunComplete', {
          gameData: s.gameData,
          runManager: s.runManager,
          result: 'defeat',
        });
      });
      await waitForScene(page, 'RunComplete');
      await expect(page.locator('.ce-runend-layer')).toBeVisible();
      await expect(page.locator('.re-dialogue')).toBeVisible();
      await expectClassesInert(page, '.ce-runend-layer', `${size} run end`);
      await expectClassesInert(page, '.re-dialogue', `${size} farewell`);
      if (onMain) await expectAsOnMain(page, size, 'dialogue');
      const skip = page.getByRole('button', { name: 'Skip conversation', exact: true });
      await ((await skip.count()) ? skip : page.getByRole('button', { name: 'Continue' })).click();
      const result = page.getByRole('dialog', { name: 'Game over', exact: true });
      await expect(result).toBeVisible({ timeout: 20_000 });
      await expectClassesInert(page, '.re-run-flow', `${size} result`);
      expect(errors).toEqual([]);
    });

    test('route map: story lines and the Eclipse card', async ({ page }) => {
      const errors = pageErrors(page);
      await quietSettings(page, { reduceMotion: true });
      const onMain = await emulateSideNotch(page, vp);
      await page.goto('/?devScene=nodemap&preset=eclipse&seed=42');
      await waitForScene(page, 'NodeMap');
      await expect(page.locator('.ce-act-layer')).toBeVisible();
      await expect(page.locator('.re-dialogue')).toBeVisible();
      await expectClassesInert(page, '.ce-act-layer', `${size} act title`);
      await expectClassesInert(page, '.re-dialogue', `${size} story lines`);
      if (onMain) await expectAsOnMain(page, size, 'dialogue');
      await page.getByRole('button', { name: 'Skip conversation', exact: true }).click();
      await expect(page.locator('.re-eclipse-toast')).toHaveCount(1, { timeout: 15_000 });
      await page.locator('.re-eclipse-medal').click();
      await expect(page.getByRole('dialog', { name: 'The Eclipse', exact: true })).toBeVisible();
      await expectClassesInert(page, '.re-modal-shield:has(> .re-eclipse-card)', `${size} Eclipse`);
      if (onMain) await expectAsOnMain(page, size, 'eclipse');
      expect(errors).toEqual([]);
    });
  });
}
