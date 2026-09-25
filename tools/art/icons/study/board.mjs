// Board renderer for the items study: builds an HTML page (Ink & Ember tokens, study
// fonts) and screenshots it with Playwright. Used by every sheet in the study.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const FONT_DIR = path.resolve('docs/art-direction/board/fonts');

export const BOARD_CSS = `
@font-face { font-family: 'Press Start 2P'; src: url('file://${FONT_DIR}/PressStart2P.woff2'); }
@font-face { font-family: 'Cinzel'; src: url('file://${FONT_DIR}/Cinzel-latin-var.woff2'); font-weight: 400 900; }
:root { --bg:#0e0c14; --panel:#17141f; --raised:#201c29; --sel:#3a2c24; --line:#403949; --text:#ddd0bd;
  --muted:#978b94; --gold:#dca044; --gold-hi:#f3cb6c; --crim:#cc4038; --verd:#86b27b; --unl:#a863cc; }
* { box-sizing: border-box; margin: 0; }
body { background: var(--bg); color: var(--text); font: 13px/1.35 system-ui, 'DejaVu Sans', sans-serif; padding: 20px; }
h1 { font: 700 22px 'Cinzel', serif; letter-spacing: .08em; color: var(--gold-hi); margin-bottom: 4px; }
h2 { font: 10px 'Press Start 2P'; color: var(--gold); margin: 18px 0 8px; letter-spacing: .04em; }
.sub { color: var(--muted); margin-bottom: 10px; max-width: 1100px; }
.kicker { font: 8px 'Press Start 2P'; color: var(--muted); letter-spacing: .06em; }
img.px { image-rendering: pixelated; display: block; }
`;

export async function renderBoard(html, file, { width = 1280, dpr = 2, height = null } = {}) {
  const tmp = path.resolve(`References/items-study/.board-${path.basename(file)}.html`);
  fs.mkdirSync(path.dirname(tmp), { recursive: true });
  fs.writeFileSync(tmp, html);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width, height: height || 800 }, deviceScaleFactor: dpr });
  await page.goto(`file://${tmp}`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await page.screenshot({ path: file, fullPage: !height });
  await browser.close();
}

export const fileUrl = (p) => `file://${path.resolve(p)}`;
