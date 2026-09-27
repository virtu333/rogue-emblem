#!/usr/bin/env node
// Pixel-trace every shot over the part of its clip the cut uses (edit.mjs).
//
//   node tools/cutscene/glass/trace.mjs [--only a,b] [--jobs 4]

import { execFile } from 'node:child_process';
import { SHOTS } from './shots.mjs';
import { usedRanges } from './edit.mjs';

// per-shot pixel.py flags, where the defaults don't suit
const FLAGS = {};

const argv = process.argv.slice(2);
const arg = (k, d) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : d);
const only = arg('only') ? new Set(arg('only').split(',')) : null;
const ranges = usedRanges();
const dur = Object.fromEntries(SHOTS.map((s) => [s.id, s.dur]));
const queue = Object.entries(ranges).filter(([id]) => !only || only.has(id));

const run = ([id, [a, b]]) =>
  new Promise((resolve) => {
    const args = ['tools/cutscene/glass/pixel.py', id, '--colors', '28'];
    args.push('--from', a.toFixed(2), '--to', Math.min(b, dur[id]).toFixed(2));
    args.push(...(FLAGS[id] || []));
    execFile('python3', args, (err, stdout, stderr) => {
      console.log(err ? `${id}: ${stderr.trim().split('\n').pop()}` : stdout.trim());
      resolve();
    });
  });

await Promise.all(
  Array.from({ length: Number(arg('jobs', 4)) }, async () => {
    while (queue.length) await run(queue.shift());
  }),
);
