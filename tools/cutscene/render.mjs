#!/usr/bin/env node
// Headless renderer for the cutscene pilot (tools/cutscene/pilot).
//
//   node tools/cutscene/render.mjs --stills 12.5,40 --out <dir>     PNG stills at those times
//   node tools/cutscene/render.mjs --sheet --out <dir>              contact sheet: first/last frame of every shot
//   node tools/cutscene/render.mjs --video <file.mp4> [--fps 24] [--workers 4] [--from s] [--to s]
//   --piece hook   renders "The Roll" (tools/cutscene/hook) instead of the pilot
//
// The player's frame is a pure function of t, so frames can be rendered in any order,
// in parallel, and resumed. A Vite dev server is started in-process (the page imports
// game assets by their served paths). ffmpeg: $FFMPEG, else `ffmpeg` on PATH.
// Chromium: Playwright's (PLAYWRIGHT_BROWSERS_PATH), or $CHROMIUM_PATH.

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import sharp from 'sharp';

const argv = process.argv.slice(2);
const has = (k) => argv.includes(`--${k}`);
const arg = (k, d) => (has(k) ? argv[argv.indexOf(`--${k}`) + 1] : d);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const PIECES = {
  pilot: {
    page: '/tools/cutscene/pilot/index.html?export=1',
    music: 'public/assets/audio/music/music_title.mp3',
  },
  hook: {
    page: '/tools/cutscene/hook/index.html?export=1',
    music: 'tools/cutscene/hook/the_roll.mp3',
  },
};
const PIECE = PIECES[arg('piece', 'pilot')];
const PAGE = PIECE.page;
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const MUSIC = path.join(ROOT, PIECE.music);

async function withPlayer(workers, fn) {
  const server = await createServer({
    root: ROOT,
    configFile: false,
    logLevel: 'error',
    optimizeDeps: { noDiscovery: true, entries: [] },
    server: {
      port: Number(arg('port', 3290)),
      strictPort: false,
      host: '127.0.0.1',
      hmr: false,
      watch: null,
    },
  });
  await server.listen();
  const base = server.resolvedUrls.local[0].replace(/\/$/, '');
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--disable-gpu-vsync'],
  });
  try {
    const pages = [];
    for (let i = 0; i < workers; i++) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      page.on('pageerror', (e) => console.error('page error:', e.message));
      page.on('console', (m) => m.type() !== 'log' && console.error('console:', m.text()));
      await page.goto(base + PAGE);
      await page.waitForFunction(() => window.cutscene);
      pages.push(page);
    }
    const info = await pages[0].evaluate(() => window.cutscene.ready);
    return await fn(pages, info);
  } finally {
    await browser.close();
    await server.close();
  }
}

const frame = async (page, t) => {
  const url = await page.evaluate((tt) => window.cutscene.frame(tt), t);
  return Buffer.from(url.split(',')[1], 'base64');
};

async function stills(times, out) {
  fs.mkdirSync(out, { recursive: true });
  await withPlayer(1, async ([page]) => {
    for (const t of times) {
      const f = path.join(out, `t${t.toFixed(2).padStart(7, '0')}.png`);
      fs.writeFileSync(f, await frame(page, t));
      console.log(f);
    }
  });
}

async function sheet(out) {
  fs.mkdirSync(out, { recursive: true });
  await withPlayer(1, async ([page], info) => {
    const times = info.shots.flatMap((s) => [s.from + 0.6, Math.min(s.to, info.duration) - 0.1]);
    const w = 426;
    const h = 240;
    const cols = 4;
    const tiles = [];
    for (const t of times)
      tiles.push(
        await sharp(await frame(page, t))
          .resize(w, h)
          .png()
          .toBuffer(),
      );
    const rows = Math.ceil(tiles.length / cols);
    const f = path.join(out, 'sheet.png');
    await sharp({
      create: { width: cols * w, height: rows * h, channels: 4, background: '#07060b' },
    })
      .composite(
        tiles.map((input, i) => ({ input, left: (i % cols) * w, top: Math.floor(i / cols) * h })),
      )
      .png()
      .toFile(f);
    console.log(f, times.map((t) => t.toFixed(2)).join(' '));
  });
}

async function video(file) {
  const fps = Number(arg('fps', 24));
  const workers = Number(arg('workers', 4));
  const dir = `${file}.frames`;
  fs.mkdirSync(dir, { recursive: true });
  await withPlayer(workers, async (pages, info) => {
    const from = Number(arg('from', 0));
    const to = Math.min(Number(arg('to', info.duration)), info.duration);
    const n0 = Math.round(from * fps);
    const n1 = Math.round(to * fps);
    const todo = [];
    for (let i = n0; i < n1; i++) {
      if (!fs.existsSync(path.join(dir, `${String(i).padStart(6, '0')}.png`))) todo.push(i);
    }
    console.log(`${n1 - n0} frames, ${todo.length} to render, ${workers} workers`);
    let done = 0;
    await Promise.all(
      pages.map(async (page) => {
        while (todo.length) {
          const i = todo.shift();
          const f = path.join(dir, `${String(i).padStart(6, '0')}.png`);
          fs.writeFileSync(`${f}.tmp`, await frame(page, i / fps));
          fs.renameSync(`${f}.tmp`, f);
          if (++done % 240 === 0) console.log(`  ${done}`);
        }
      }),
    );
    const args = [
      '-y',
      '-framerate',
      String(fps),
      '-start_number',
      String(n0),
      '-i',
      path.join(dir, '%06d.png'),
      '-ss',
      String(from),
      '-i',
      MUSIC,
      '-t',
      String(to - from),
      '-af',
      `afade=t=out:st=${Math.max(0, to - from - 2.5)}:d=2.5`,
      '-map',
      '0:v',
      '-map',
      '1:a',
      '-c:v',
      'libx264',
      '-preset',
      'slow',
      '-crf',
      '16',
      '-tune',
      'animation',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-movflags',
      '+faststart',
      file,
    ];
    await new Promise((resolve, reject) => {
      const p = spawn(FFMPEG, args, { stdio: ['ignore', 'inherit', 'inherit'] });
      p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))));
    });
    console.log(file);
  });
}

if (has('stills'))
  await stills(arg('stills').split(',').map(Number), arg('out', 'References/cutscene'));
else if (has('sheet')) await sheet(arg('out', 'References/cutscene'));
else if (has('video')) await video(arg('video'));
else
  console.log('usage: render.mjs --stills t,t | --sheet | --video out.mp4 [--fps 24 --workers 4]');
