// Band cards with a bust (boss intro, recruit/lord join) at phone and desktop sizes:
// the bust is never sliced by its band or pushed out of frame, kickers read in full
// (no ellipsis) and the band spans the battlefield rather than the letterbox.
import { test, expect } from '@playwright/test';
import { waitForScene } from './helpers.js';

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
