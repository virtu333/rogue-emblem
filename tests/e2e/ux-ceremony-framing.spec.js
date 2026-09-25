// Band cards with a bust (boss intro, recruit/lord join) at phone and desktop sizes:
// the bust is never sliced by its band or pushed out of frame, kickers read in full
// (no ellipsis) and the band spans the battlefield rather than the letterbox.
import { test, expect } from '@playwright/test';
import { waitForScene as waitForSceneQuick } from './helpers.js';

// Asset loading can be slow on a busy machine: allow a full minute per scene.
async function waitForScene(page, key) {
  try {
    await waitForSceneQuick(page, key);
  } catch {
    await page.waitForFunction((k) => window.__sceneState?.activeScene === k, key, {
      timeout: 60000,
    });
  }
}

test.setTimeout(180000);

const VIEWPORTS = [
  { width: 844, height: 390, phone: true },
  { width: 667, height: 375, phone: true },
  { width: 932, height: 430, phone: true },
  { width: 1280, height: 800, phone: false },
];

async function boot(page, phone) {
  await page.addInitScript(() =>
    localStorage.setItem(
      'emblem_rogue_settings',
      JSON.stringify({ musicVolume: 0, sfxVolume: 0, hints: false, reduceMotion: true }),
    ),
  );
  await page.goto(
    `/?devScene=battle&preset=battle_smoke&seed=42${phone ? '&mobilePreview=1' : ''}`,
  );
  await waitForScene(page, 'Battle');
  await page.waitForFunction(() =>
    ['DEPLOY_SELECTION', 'PLAYER_IDLE'].includes(window.__sceneState?.battle?.state),
  );
}

// Opens one card, measures it, closes it. Runs entirely in the page.
function measureCards(kinds) {
  return async ({ kinds }) => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const { growthCeremonies } = await import('/src/ui/GrowthCeremonyController.js');
    const { CeremonyController } = await import('/src/ui/CeremonyController.js');
    const { createUnit, createLordUnit } = await import('/src/engine/UnitManager.js');
    const gd = s.gameData;
    const out = [];
    const measure = (selector, label) => {
      const root = [...document.querySelectorAll(selector)].at(-1);
      if (!root) return { label, missing: true };
      const layer = root.getBoundingClientRect();
      const band = root.querySelector('.ce-boss-band, .gr-join-band');
      const b = band.getBoundingClientRect();
      const img = root.querySelector('.ce-boss-portrait, .gr-join-portrait');
      const i = img?.getBoundingClientRect();
      const kicker = root.querySelector('.ce-kicker, .gr-kicker');
      const clip = getComputedStyle(band).clipPath;
      return {
        label,
        slicedByBand: /inset\(0(px)? /.test(clip) && i && i.top < b.top - 0.5,
        bustInFrame: !i || i.top >= layer.top - 1,
        kickerFits: !kicker || kicker.scrollWidth <= kicker.clientWidth + 1,
        kickerEllipsis: kicker ? getComputedStyle(kicker).textOverflow === 'ellipsis' : false,
        bandInFrame: b.left >= layer.left - 1 && b.right <= layer.right + 1,
      };
    };
    const growth = growthCeremonies(s);
    const ceremonies = new CeremonyController(s);
    const close = async () => {
      document.querySelectorAll('.gr-join-layer, .ce-boss-layer').forEach((n) => n.remove());
      await new Promise((r) => setTimeout(r, 30));
    };
    for (const kind of kinds) {
      if (kind.type === 'lord') {
        const def = gd.lords.find((l) => l.name === kind.name);
        const cls = gd.classes.find((c) => c.name === def.class);
        const u = createLordUnit(def, cls, gd.weapons);
        u.faction = 'player';
        void growth.showRecruit({ unit: u, kind: 'lord' });
      } else if (kind.type === 'recruit') {
        const cls = gd.classes.find((c) => c.name === kind.className);
        const u = createUnit(cls, 5, gd.weapons, { name: 'Aerin-Sunweaver' });
        u.faction = 'player';
        void growth.showRecruit({ unit: u, kind: 'recruit' });
      } else {
        const def = Object.values(gd.enemies.bosses)
          .flat()
          .find((b) => b.name === kind.name);
        // Any base class builds the unit; the boss's own name/class pick its portrait.
        const base = gd.classes.find((c) => c.name === 'Fighter');
        const u = createUnit(base, 10, gd.weapons, { name: def.name });
        Object.assign(u, { faction: 'enemy', isBoss: true, className: def.className });
        void ceremonies.showBossIntro({ unit: u, actId: 'act2' });
      }
      await new Promise((r) => setTimeout(r, 250));
      out.push(
        measure(
          kind.type === 'boss' ? '.ce-boss-layer' : '.gr-join-layer',
          kind.name || kind.className,
        ),
      );
      await close();
    }
    return out;
  };
}

for (const vp of VIEWPORTS) {
  test(`band cards frame busts and kickers at ${vp.width}x${vp.height}`, async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      ...(vp.phone ? { hasTouch: true, isMobile: true, deviceScaleFactor: 2 } : {}),
    });
    const page = await context.newPage();
    await boot(page, vp.phone);
    const kinds = [
      ...['Edric', 'Sera'].map((name) => ({ type: 'lord', name })),
      ...['Pegasus Knight', 'Myrmidon', 'Mage', 'Fighter'].map((className) => ({
        type: 'recruit',
        className,
      })),
      ...['Warchief', 'Archmage', 'The Emperor', 'Iron Captain'].map((name) => ({
        type: 'boss',
        name,
      })),
    ];
    const results = await page.evaluate(measureCards(kinds), { kinds });
    const bad = results.filter(
      (r) =>
        r.missing ||
        r.slicedByBand ||
        !r.bustInFrame ||
        !r.kickerFits ||
        r.kickerEllipsis ||
        !r.bandInFrame,
    );
    expect(bad).toEqual([]);
    await context.close();
  });
}

// The level-up card and the promotion rite carry a spoken line (UnitVoice, at most
// ~90 characters). It reads in full (no ellipsis), stays inside its card and never
// runs under the Continue button.
const QUOTE =
  'I carried my father’s spear this far; I will carry it home, whatever the road asks of me.';
for (const vp of [...VIEWPORTS, { width: 1000, height: 460, phone: true }]) {
  test(`level-up and rite quotes read in full at ${vp.width}x${vp.height}`, async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      ...(vp.phone ? { hasTouch: true, isMobile: true, deviceScaleFactor: 2 } : {}),
    });
    const page = await context.newPage();
    await boot(page, vp.phone);
    const results = await page.evaluate(
      async ({ QUOTE }) => {
        const s = window.__emblemRogueGame.scene.getScene('Battle');
        const { growthCeremonies } = await import('/src/ui/GrowthCeremonyController.js');
        const { promotionPathContent } = await import('/src/ui/growthContent.js');
        const g = growthCeremonies(s);
        const unit = s.playerUnits.find((u) => u.name === 'Edric');
        const out = [];
        for (const kind of ['level', 'rite']) {
          if (kind === 'level') {
            const gains = { HP: 1, STR: 2, MAG: 0, SKL: 1, SPD: 1, LCK: 1, DEF: 1, RES: 1 };
            void g.showLevelUp({
              unit,
              result: { gains, displayStats: unit.stats },
              learnedNames: ['Sol'],
            });
          } else {
            const cls = s.gameData.classes.find((c) => c.name === 'Great Lord');
            void g.showPromotionRite({
              unit,
              content: promotionPathContent(unit, cls, s.gameData),
            });
          }
          await new Promise((r) => setTimeout(r, 300));
          const root = document.querySelector(
            kind === 'level' ? '.gr-level-layer' : '.gr-rite-layer',
          );
          const cls = kind === 'level' ? 'gr-level-quote' : 'gr-rite-quote';
          let quote = root.querySelector(`.${cls}`);
          if (!quote) {
            // No line rolled for this unit: place the longest one where the card puts it.
            quote = document.createElement('p');
            quote.className = cls;
            const host = root.querySelector(kind === 'level' ? '.gr-level-main' : '.gr-rite-text');
            host.insertBefore(quote, host.querySelector('.gr-seals--level, .gr-level-foot'));
          }
          quote.textContent = `“${QUOTE}”`;
          await new Promise((r) => setTimeout(r, 120));
          const q = quote.getBoundingClientRect();
          const b = root.querySelector('.gr-continue').getBoundingClientRect();
          const card = root.querySelector('.gr-level, .gr-rite').getBoundingClientRect();
          out.push({
            kind,
            clamped: quote.scrollHeight > quote.clientHeight + 1,
            inCard: q.top >= card.top - 1 && q.bottom <= card.bottom + 1,
            underButton: q.bottom > b.top + 1 && q.right > b.left + 1 && q.top < b.bottom,
            buttonInView: b.bottom <= innerHeight + 1 && b.right <= innerWidth + 1,
          });
          root.remove();
          await new Promise((r) => setTimeout(r, 50));
        }
        return out;
      },
      { QUOTE },
    );
    for (const r of results) {
      expect(r, r.kind).toEqual({
        kind: r.kind,
        clamped: false,
        inCard: true,
        underButton: false,
        buttonInView: true,
      });
    }
    await context.close();
  });
}
