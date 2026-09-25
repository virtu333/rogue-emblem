#!/usr/bin/env python3
"""Blind A/B listening test of an engine or instrument tweak.

Renders the same excerpt twice (baseline, then with --patch applied to the
instrument registry), asks the critic which is more realistic in both
orders, and prints the verdicts.

  python3 tools/music/ab.py battle_act1 mel_vn --start 6 --dur 20 \
      --patch "INSTRUMENTS['violins']['arts']['sus']['glide_ms'] = 0"
"""

from __future__ import annotations

import argparse
import importlib
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from engine import render as R  # noqa: E402
from engine.dsp import SR  # noqa: E402
from engine.instruments import INSTRUMENTS  # noqa: E402,F401

SCRATCH = os.environ.get('MUSIC_SCRATCH', '/tmp')


def excerpt(score_name, parts, start, dur, out):
    importlib.invalidate_caches()
    mod = importlib.import_module(f'scores.{score_name}')
    s = mod.build()
    gains = {'*': None}
    for p in parts:
        gains[p] = 0.0
    s.variant('solo', gains, lufs=-16)
    r = R.Renderer(s, verbose=False)
    stems = {k: v for k, v in r.stems().items() if k in parts}
    y = r.mix(stems, 'solo')
    a = int(start * SR)
    R.write_audio(out, y[a:a + int(dur * SR)], quality=2)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('score')
    ap.add_argument('parts', nargs='+')
    ap.add_argument('--start', type=float, default=0)
    ap.add_argument('--dur', type=float, default=20)
    ap.add_argument('--patch', required=True, help='python statement applied for version B')
    ap.add_argument('--question', default='Which of the two sounds more like a real, '
                    'expertly performed and recorded orchestra (or band)?')
    args = ap.parse_args()
    a_path = os.path.join(SCRATCH, 'ab_A.mp3')
    b_path = os.path.join(SCRATCH, 'ab_B.mp3')
    excerpt(args.score, args.parts, args.start, args.dur, a_path)
    exec(args.patch, globals())
    R._VOICERS.clear()
    excerpt(args.score, args.parts, args.start, args.dur, b_path)
    q = (args.question + ' The two files render the same music with one production difference. '
         'Answer with the file name you prefer on the first line, then two sentences on the '
         'audible difference.')
    for first, second in ((a_path, b_path), (b_path, a_path)):
        x1 = os.path.join(SCRATCH, 'clip_1.mp3')
        x2 = os.path.join(SCRATCH, 'clip_2.mp3')
        os.replace(first, x1) if False else subprocess.run(['cp', first, x1], check=True)
        subprocess.run(['cp', second, x2], check=True)
        label = {x1: 'A' if first == a_path else 'B', x2: 'A' if second == a_path else 'B'}
        out = subprocess.run([sys.executable, os.path.join(HERE, 'listen.py'), x1, x2,
                              '--prompt', q], capture_output=True, text=True).stdout
        print(f'--- order clip_1={label[x1]} clip_2={label[x2]}')
        print(out.strip())


if __name__ == '__main__':
    main()
