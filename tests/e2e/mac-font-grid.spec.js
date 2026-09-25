// Mac desktop font checks (Retina DPR 2 and browser zoom): Press Start 2P text must
// land on whole device pixels (size × DPR × transform scale a multiple of 8), pixel
// labels must not overflow their boxes, and supersampled canvas text must be
// downsampled smoothly (LINEAR), not by dropping texels.
import { test, expect } from '@playwright/test';
import { waitForScene } from './helpers.js';

const MAC_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

// [label, viewport, deviceScaleFactor]
const MACS = [
  ['MacBook Air 13 (1440x900 @2x)', { width: 1440, height: 900 }, 2],
  ['MacBook Pro 14 (1512x982 @2x)', { width: 1512, height: 982 }, 2],
  ['MacBook Pro 16 (1728x1117 @2x)', { width: 1728, height: 1117 }, 2],
  ['1280x720 window @2x', { width: 1280, height: 720 }, 2],
  ['browser zoom 110% (1309x818 @2.2x)', { width: 1309, height: 818 }, 2.2],
  ['browser zoom 90% (1600x1000 @1.8x)', { width: 1600, height: 1000 }, 1.8],
];

async function auditPixelFonts(page) {
  return page.evaluate(() => {
    const dpr = window.devicePixelRatio;
    const scaleOf = (el) => {
      let scale = 1;
      for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
        const t = getComputedStyle(node).transform;
        if (t && t !== 'none') {
          const m = new DOMMatrixReadOnly(t);
          scale *= Math.hypot(m.a, m.b);
        }
      }
      return scale;
    };
    const problems = [];
    let checked = 0;
    for (const el of document.querySelectorAll('body *')) {
      if (!el.getClientRects().length) continue;
      if (!/Press Start/i.test(getComputedStyle(el).fontFamily.split(',')[0])) continue;
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (!own) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
      if (el.closest('.re-visually-hidden, [aria-hidden="true"]')) continue;
      checked++;
      const rendered = parseFloat(cs.fontSize) * scaleOf(el);
      const fontPx = (rendered * dpr) / 8;
      const label = `${el.tagName.toLowerCase()}.${[...el.classList].join('.')} "${el.textContent.trim().slice(0, 24)}"`;
      if (Math.abs(fontPx - Math.round(fontPx)) > 0.02)
        problems.push(`${label}: ${rendered.toFixed(2)}px × ${dpr} = ${fontPx.toFixed(2)} font px`);
      if (cs.display !== 'inline' && el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1)
        problems.push(`${label}: overflows (${el.scrollWidth} > ${el.clientWidth})`);
    }
    return { dpr, checked, problems };
  });
}

async function boot(page, url, scene) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem(
        'emblem_rogue_settings',
        JSON.stringify({ musicVolume: 0, sfxVolume: 0, hints: false }),
      );
    } catch {
      /* ignore */
    }
  });
  await page.goto(url);
  await waitForScene(page, scene);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(600);
}

for (const [label, viewport, deviceScaleFactor] of MACS) {
  test.describe(`Mac fonts · ${label}`, () => {
    test.use({ viewport, deviceScaleFactor, userAgent: MAC_UA, hasTouch: false, isMobile: false });

    test('title, blessing and node-map pixel labels sit on whole device pixels', async ({
      page,
    }) => {
      test.setTimeout(120_000); // four screens in one test
      const results = [];
      await boot(page, '/', 'Title');
      results.push(['title', await auditPixelFonts(page)]);
      await boot(page, '/?devScene=blessing&preset=weapon_arts', 'BlessingSelect');
      results.push(['blessing', await auditPixelFonts(page)]);
      await boot(page, '/?devScene=nodemap&preset=weapon_arts', 'NodeMap');
      for (let i = 0; i < 4; i++) {
        const skip = page.getByRole('button', { name: /^(Continue|Skip conversation)$/ });
        if (
          !(await skip
            .first()
            .isVisible()
            .catch(() => false))
        )
          break;
        await skip.first().click();
        await page.waitForTimeout(300);
      }
      results.push(['nodemap', await auditPixelFonts(page)]);
      await page
        .getByRole('button', { name: /Roster/ })
        .first()
        .click();
      await page.waitForTimeout(500);
      results.push(['roster', await auditPixelFonts(page)]);
      for (const [screen, result] of results) {
        expect(result.dpr).toBeCloseTo(deviceScaleFactor, 5);
        expect(result.problems, `${screen}: ${result.problems.join('\n')}`).toEqual([]);
      }
      expect(results.find(([s]) => s === 'title')[1].checked).toBeGreaterThan(4);
    });

    test('battle canvas text is downsampled smoothly and DOM labels stay crisp', async ({
      page,
    }) => {
      await boot(page, '/?devScene=battle&preset=battle_smoke&seed=42', 'Battle');
      await page.waitForFunction(
        () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'PLAYER_IDLE',
      );
      const filters = await page.evaluate(() => {
        const s = window.__emblemRogueGame.scene.getScene('Battle');
        const gl = s.game.renderer.gl;
        const texts = s.children.list.filter((o) => o.type === 'Text' && o.visible);
        const supersampled = texts.filter((t) => t.style.resolution > 1);
        return {
          linear: gl ? gl.LINEAR : null,
          count: supersampled.length,
          filters: [...new Set(supersampled.map((t) => t.frame.source.glTexture?.minFilter))],
        };
      });
      expect(filters.count).toBeGreaterThan(0);
      if (filters.linear) expect(filters.filters).toEqual([filters.linear]);
      const result = await auditPixelFonts(page);
      expect(result.problems, result.problems.join('\n')).toEqual([]);
    });
  });
}
