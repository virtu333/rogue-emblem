#!/usr/bin/env node
// A lighter copy of the music for the iOS app (the TestFlight workflow).
//
//   node tools/ios/compactMusic.mjs --in assets/audio/music --out <dir> [--quality 6]
//
// The app bundles every track, and Apple asks before a cellular download over 200 MB.
// The web game streams and caches music as it plays, so it keeps the build's LAME V4;
// the app gets each track re-encoded at LAME V6 (about a quarter smaller). The encoder
// writes the same gapless header as the build, so the decoded audio keeps its exact
// length and timeline: loop points, adaptive layers and the finale's hum stay
// sample-aligned. Each copy is checked for that, and a track the re-encode wouldn't
// shrink is copied as it is. Needs ffmpeg with libmp3lame on the PATH.
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SAMPLE_RATE = 44100;

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { maxBuffer: 1 << 30, ...opts });
  if (r.error) throw r.error;
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed: ${String(r.stderr || '').trim()}`);
  }
  return r.stdout;
}

/** Decoded length in samples (one channel, at the build's sample rate). */
export function decodedSamples(path) {
  const pcm = run('ffmpeg', [
    '-v',
    'error',
    '-i',
    path,
    '-f',
    's16le',
    '-ac',
    '1',
    '-ar',
    `${SAMPLE_RATE}`,
    '-',
  ]);
  return pcm.length / 2;
}

/** The mp3 files of a directory, sorted. */
export function musicFiles(dir) {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.mp3'))
    .sort();
}

/**
 * Re-encode every track of `inDir` into `outDir`.
 * @returns {{ files: number, before: number, after: number, kept: string[] }} byte totals
 */
export function compactMusic({ inDir, outDir, quality = 6, log = () => {} }) {
  mkdirSync(outDir, { recursive: true });
  const files = musicFiles(inDir);
  if (!files.length) throw new Error(`no mp3 files in ${inDir}`);
  let before = 0;
  let after = 0;
  const kept = [];
  for (const file of files) {
    const src = join(inDir, file);
    const dst = join(outDir, file);
    run('ffmpeg', [
      '-v',
      'error',
      '-y',
      '-i',
      src,
      '-c:a',
      'libmp3lame',
      '-q:a',
      `${quality}`,
      '-ar',
      `${SAMPLE_RATE}`,
      dst,
    ]);
    const want = decodedSamples(src);
    const got = decodedSamples(dst);
    if (got !== want) {
      throw new Error(`${file}: re-encode decodes to ${got} samples, the original to ${want}`);
    }
    const size = statSync(src).size;
    if (statSync(dst).size >= size) {
      copyFileSync(src, dst);
      kept.push(file);
    }
    before += size;
    after += statSync(dst).size;
    log(`${file}: ${size} -> ${statSync(dst).size} bytes`);
  }
  return { files: files.length, before, after, kept };
}

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const inDir = arg('in');
  const outDir = arg('out');
  const quality = Number(arg('quality', '6'));
  if (!inDir || !outDir || !Number.isInteger(quality) || quality < 0 || quality > 9) {
    console.error('usage: compactMusic.mjs --in <dir> --out <dir> [--quality 0-9]');
    process.exit(2);
  }
  const mb = (n) => (n / 1e6).toFixed(1);
  const r = compactMusic({ inDir, outDir, quality, log: (line) => console.error(line) });
  console.log(
    `${r.files} tracks: ${mb(r.before)} MB -> ${mb(r.after)} MB` +
      (r.kept.length ? ` (${r.kept.length} kept as they were)` : ''),
  );
}
