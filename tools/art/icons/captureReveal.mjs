#!/usr/bin/env node
// Frames of the reward reveal (face down, turning, rarest flash, settled) at phone and
// desktop sizes, for the production README. Victory is forced on the battle smoke preset
// with injected spoils so the rarest (a Legend) flashes.
//   node tools/art/icons/captureReveal.mjs --base http://127.0.0.1:3157/ --out dir
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { newStudyPage, waitScene } from './study/screens.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : d);
const base = arg('base', 'http://127.0.0.1:3157/');
const out = arg('out', 'References/items-art/captures');
const exe = ['/opt/pw-browsers/chromium'].find((p) => fs.existsSync(p));
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const SPOILS = ['Killer Lance', "Gambler's Coin", 'Ragnarok', 'Energy Drop'];

for (const v of [
  { name: '844x390', w: 844, h: 390, mobile: true, dpr: 2 },
  { name: '1280x800', w: 1280, h: 800, mobile: false, dpr: 1 },
]) {
  const page = await newStudyPage(browser, { dpr: v.dpr, w: v.w, h: v.h, mobile: v.mobile });
  const q = `devScene=battle&preset=battle_smoke&seed=42&battleLab=1${v.mobile ? '&mobilePreview=1' : ''}`;
  await page.goto(`${base}?${q}`);
  await waitScene(page, 'Battle');
  await page.waitForTimeout(1500);
  // Inject the spoils into the reward roll, so the first render reveals them.
  await page.evaluate((names) => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const d = s.gameData;
    const find = (n) =>
      [...d.weapons, ...d.accessories, ...d.consumables].find((x) => x.name === n);
    const spoils = names.map((n) => {
      const item = structuredClone(find(n));
      const type =
        item.type === 'Accessory'
          ? 'accessory'
          : item.type === 'Consumable'
            ? 'consumable'
            : 'weapon';
      return { type, item };
    });
    const rm = s.runManager;
    let record = rm.pendingBattleReward;
    Object.defineProperty(rm, 'pendingBattleReward', {
      configurable: true,
      get: () => record,
      set: (value) => {
        if (value && !value.revealed) value.choices = spoils;
        record = value;
      },
    });
    s.onVictory();
  }, SPOILS);
  const dialog = page.getByRole('dialog', { name: 'Battle rewards' });
  await dialog.waitFor({ timeout: 20000 });
  await page.waitForTimeout(1600); // the live reveal (≈1 s) has finished
  // Re-pose the reveal at chosen instants: the same CSS, paused at negative delays.
  const pose = (t) =>
    page.evaluate((t) => {
      const row = document.querySelector('.ch-rewards, .ia-reveal-rows');
      const cards = [...row.children];
      document.querySelectorAll('.ia-card-back').forEach((b) => b.remove());
      cards.forEach((card, i) => {
        card.classList.remove('ia-face-down', 'ia-flash');
        card.style.animation = '';
        const start = 120 + i * 90;
        if (t < start + 180) {
          card.classList.add('ia-face-down');
          const back = document.createElement('span');
          back.className = 'ia-card-back';
          card.append(back);
          for (const el of [card, back]) {
            el.style.animationDelay = `${start - t}ms`;
            el.style.animationPlayState = 'paused';
          }
        }
      });
      const rarest = cards.findIndex(
        (c) => c.dataset.tier === 'Legend' || c.textContent.includes('Ragnarok'),
      );
      const flashAt = 120 + rarest * 90 + 180;
      if (rarest >= 0 && t >= flashAt && t < flashAt + 520) {
        const card = cards[rarest];
        card.classList.add('ia-flash');
        card.style.animationDelay = `${flashAt - t}ms`;
        card.style.animationPlayState = 'paused';
      }
    }, t);
  const frames = [];
  for (const t of [0, 240, 520, 2000]) {
    await pose(t);
    await page.waitForTimeout(120);
    const file = path.join(out, `reveal-${frames.length}-${v.name}.png`);
    await page.screenshot({ path: file });
    frames.push({ t, file });
  }
  console.log(v.name, frames.map((f) => f.file).join(' '));
  // Strip: the four moments side by side at half size.
  const pick = frames.map((f) => f.file);
  const w = Math.round((v.w * v.dpr) / 2);
  const h = Math.round((v.h * v.dpr) / 2);
  const tiles = await Promise.all(pick.map((f) => sharp(f).resize(w, h).png().toBuffer()));
  await sharp({
    create: { width: w * 2 + 8, height: h * 2 + 8, channels: 4, background: '#0e0c14' },
  })
    .composite(
      tiles.map((input, i) => ({
        input,
        left: (i % 2) * (w + 8),
        top: Math.floor(i / 2) * (h + 8),
      })),
    )
    .png()
    .toFile(path.join(out, `reward-reveal-strip-${v.name}.png`));
  await page.context().close();
}
await browser.close();
