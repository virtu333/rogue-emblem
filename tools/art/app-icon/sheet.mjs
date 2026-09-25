// sheet.mjs — comparison sheets for the app-icon candidates (Playwright + sharp).
//
//   comparison-sheet.png  every candidate at 1024 (1:1), then 180 / 60 / 29 px (1:1)
//                         on a dark and a light ground, masked like iOS does
//   homescreen-mock.png   each candidate in a home-screen row beside generic tiles,
//                         on a dark and a light wallpaper, at iPhone 3x scale
//   overview.png          all candidates + the legacy icon at 180 / 60 / 29, one glance
//
// Downscales are real (sharp lanczos3 from the 1024 master), shown without browser
// resampling, so what you see at 60 and 29 is what a device gets from those pixels.

import sharp from 'sharp';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const OUT_DIR = join(root, 'docs', 'art-direction', 'app-icon');
const FONTS = pathToFileURL(join(root, 'docs', 'art-direction', 'board', 'fonts')).href;
const LEGACY = join(root, 'tools', 'icon-src', 'app-icon-winged-sword-legacy.png');
const CHROMIUM = process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium';

async function dataUri(buf) {
  return `data:image/png;base64,${buf.toString('base64')}`;
}
async function sized(file, size) {
  const buf = await readFile(file);
  if (size === 1024) return dataUri(buf);
  return dataUri(await sharp(buf).resize(size, size, { kernel: 'lanczos3' }).png().toBuffer());
}

const CSS = `
@font-face { font-family: Cinzel; src: url(${FONTS}/Cinzel-latin-var.woff2); font-weight: 400 900; }
@font-face { font-family: PS2P; src: url(${FONTS}/PressStart2P.woff2); }
* { box-sizing: border-box; margin: 0; }
body { background: #0e0c14; color: #ece3d0; font: 20px/1.4 'DejaVu Sans', sans-serif; }
.icon { display: block; border-radius: 22.37%; image-rendering: auto; flex: none; }
.kicker { font: 12px PS2P, monospace; letter-spacing: 1px; color: #dca044; text-transform: uppercase; }
h1 { font: 700 44px Cinzel, serif; letter-spacing: 4px; color: #f4ecdb; }
h2 { font: 700 30px Cinzel, serif; letter-spacing: 2px; color: #f4ecdb; }
.note { color: #a89d9f; font-size: 18px; }
.cap { font: 10px PS2P, monospace; color: inherit; opacity: .7; margin-top: 8px; text-align: center; }
`;

function sizesStrip(img, tone) {
  const bg = tone === 'dark' ? '#000000' : '#f2f2f7';
  const fg = tone === 'dark' ? '#ece3d0' : '#1c1c1e';
  return `<div style="background:${bg};color:${fg};padding:18px 22px;display:flex;align-items:flex-end;gap:26px;border-radius:14px;flex:1">
    ${[180, 60, 29]
      .map(
        (s) =>
          `<div style="display:flex;flex-direction:column;align-items:center"><img class="icon" src="${img[s]}" width="${s}" height="${s}"><div class="cap">${s}</div></div>`,
      )
      .join('')}
    <div class="cap" style="margin-left:auto;align-self:flex-start">${tone}</div>
  </div>`;
}

async function renderPage(browser, html, width, file) {
  const page = await browser.newPage({ viewport: { width, height: 200 }, deviceScaleFactor: 1 });
  await page.setContent(
    `<!doctype html><html><head><style>${CSS}</style></head><body>${html}</body></html>`,
    {
      waitUntil: 'load',
    },
  );
  await page.evaluate(() => document.fonts.ready);
  const png = await page.screenshot({ fullPage: true });
  await page.close();
  // Palette PNG: the sheets are flat panels + pixel art; quantisation is visually lossless.
  const out = await sharp(png)
    .png({ palette: true, colours: 256, dither: 0.4, compressionLevel: 9, effort: 10 })
    .toBuffer();
  await writeFile(file, out);
  console.log(`wrote ${file.slice(root.length + 1)} (${(out.length / 1024).toFixed(0)} KB)`);
}

// Generic app tiles for the home-screen mock: plain shapes, no brands.
const GENERIC = [
  {
    label: 'Tasks',
    bg: 'linear-gradient(#ffffff,#e9e9ee)',
    glyph: '<div style="width:44%;height:44%;border-radius:50%;border:14px solid #2f7cf6"></div>',
  },
  {
    label: 'Journal',
    bg: 'linear-gradient(#5fd068,#28a745)',
    glyph: '<div style="width:46%;height:52%;border-radius:12%;background:#fff"></div>',
  },
  {
    label: 'Radio',
    bg: 'linear-gradient(#ff8a4c,#f0503c)',
    glyph:
      '<div style="display:flex;gap:9%;align-items:flex-end;height:46%;width:52%"><i style="flex:1;height:40%;background:#fff;border-radius:6px"></i><i style="flex:1;height:100%;background:#fff;border-radius:6px"></i><i style="flex:1;height:65%;background:#fff;border-radius:6px"></i></div>',
  },
];
function genericTile(g, size) {
  return `<div class="icon" style="width:${size}px;height:${size}px;background:${g.bg};display:flex;align-items:center;justify-content:center">${g.glyph}</div>`;
}

export async function buildSheets(candidates) {
  const imgs = [];
  for (const c of candidates) {
    imgs.push({
      c,
      img: {
        1024: await sized(c.file, 1024),
        180: await sized(c.file, 180),
        60: await sized(c.file, 60),
        29: await sized(c.file, 29),
      },
    });
  }
  let legacy;
  try {
    legacy = {
      180: await sized(LEGACY, 180),
      60: await sized(LEGACY, 60),
      29: await sized(LEGACY, 29),
    };
  } catch {
    legacy = null;
  }
  const browser = await chromium.launch({ executablePath: CHROMIUM });
  try {
    // ------------------------------------------------ comparison sheet (1:1 sizes)
    const cards = imgs
      .map(
        (
          { c, img },
          i,
        ) => `<section style="width:1072px;background:#17141f;border:1px solid #4a4250;border-radius:18px;padding:24px">
        <div class="kicker">#${i + 1} · ${c.id}</div>
        <h2 style="margin:6px 0 4px">${c.name}</h2>
        <p class="note" style="margin-bottom:18px;min-height:52px">${c.concept}</p>
        <img class="icon" src="${img[1024]}" width="1024" height="1024">
        <div class="cap" style="text-align:left;margin:8px 0 16px">1024 · iOS mask</div>
        <div style="display:flex;gap:16px">${sizesStrip(img, 'dark')}${sizesStrip(img, 'light')}</div>
      </section>`,
      )
      .join('');
    await renderPage(
      browser,
      `<div style="padding:40px">
        <div class="kicker">app icon · candidates</div>
        <h1 style="margin:8px 0 6px">ROGUE DAWN</h1>
        <p class="note" style="margin-bottom:32px">Each candidate at 1024, 180, 60 and 29 px, downscaled from the 1024 master and shown 1:1 (no browser scaling), on dark and light grounds, with the iOS corner mask. Ranked best first.</p>
        <div style="display:grid;grid-template-columns:repeat(2,1072px);gap:32px">${cards}</div>
      </div>`,
      2296,
      join(OUT_DIR, 'comparison-sheet.png'),
    );

    // ------------------------------------------------ home-screen mock (iPhone 3x)
    const S = 180;
    const row = (img, labelColor, shadow) => {
      const tiles = [
        `<div style="display:flex;flex-direction:column;align-items:center;gap:12px"><img class="icon" src="${img[180]}" width="${S}" height="${S}"><span style="font:32px 'DejaVu Sans';white-space:nowrap;color:${labelColor};${shadow}">Rogue Dawn</span></div>`,
        ...GENERIC.map(
          (g) =>
            `<div style="display:flex;flex-direction:column;align-items:center;gap:12px">${genericTile(g, S)}<span style="font:32px 'DejaVu Sans';white-space:nowrap;color:${labelColor};${shadow}">${g.label}</span></div>`,
        ),
      ];
      return `<div style="display:grid;grid-template-columns:repeat(4,${S}px);column-gap:81px;justify-content:center">${tiles.join('')}</div>`;
    };
    const wall = (tone) => {
      const bg =
        tone === 'dark'
          ? 'radial-gradient(120% 80% at 30% 10%,#2b2440,#0d0b14 60%,#050408)'
          : 'radial-gradient(120% 80% at 30% 10%,#fdf3ea,#e8ecf6 55%,#cfd8ea)';
      const label = tone === 'dark' ? '#ffffff' : '#1c1c1e';
      const shadow = tone === 'dark' ? 'text-shadow:0 2px 6px rgba(0,0,0,.6)' : '';
      return `<div style="width:1179px;background:${bg};border-radius:48px;padding:70px 0 40px">
        ${imgs
          .map(
            ({ c, img }, i) => `<div style="margin-bottom:46px">
            <div class="cap" style="text-align:left;margin:0 0 14px 108px;color:${label};opacity:.55">#${i + 1} ${c.name}</div>
            ${row(img, label, shadow)}</div>`,
          )
          .join('')}
      </div>`;
    };
    await renderPage(
      browser,
      `<div style="padding:40px">
        <div class="kicker">app icon · home screen</div>
        <h1 style="margin:8px 0 28px">IN THE WILD</h1>
        <div style="display:flex;gap:40px">${wall('dark')}${wall('light')}</div>
      </div>`,
      2478,
      join(OUT_DIR, 'homescreen-mock.png'),
    );

    // ------------------------------------------------ overview (one glance)
    const all = [...imgs.map(({ c, img }, i) => ({ name: `#${i + 1} ${c.name}`, img }))];
    if (legacy) all.push({ name: 'current (legacy)', img: legacy });
    const cell = (tone) => {
      const bg = tone === 'dark' ? '#000' : '#f2f2f7';
      const fg = tone === 'dark' ? '#ece3d0' : '#1c1c1e';
      return all
        .map(
          ({
            name,
            img,
          }) => `<div style="background:${bg};color:${fg};padding:16px;border-radius:12px;display:flex;flex-direction:column;align-items:center;gap:12px">
          <img class="icon" src="${img[180]}" width="180" height="180">
          <div style="display:flex;gap:16px;align-items:flex-end"><img class="icon" src="${img[60]}" width="60" height="60"><img class="icon" src="${img[29]}" width="29" height="29"></div>
          <div class="cap" style="margin:0">${name}</div></div>`,
        )
        .join('');
    };
    await renderPage(
      browser,
      `<div style="padding:32px">
        <div class="kicker" style="margin-bottom:16px">rogue dawn · app icon candidates · 180 / 60 / 29 px, 1:1</div>
        <div style="display:grid;grid-template-columns:repeat(${all.length},212px);gap:12px;margin-bottom:12px">${cell('dark')}</div>
        <div style="display:grid;grid-template-columns:repeat(${all.length},212px);gap:12px">${cell('light')}</div>
      </div>`,
      64 + all.length * 224,
      join(OUT_DIR, 'overview.png'),
    );
  } finally {
    await browser.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { CONCEPTS } = await import('./concepts.mjs');
  await buildSheets(CONCEPTS.map((c) => ({ ...c, file: join(OUT_DIR, `${c.id}.png`) })));
}
