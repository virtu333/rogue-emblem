#!/usr/bin/env python3
"""Export a mix of only some parts (for auditioning / critique).

  python3 tools/music/solo.py battle_act1 kit ebass --start 6 --dur 30 --out /tmp/x.mp3
"""

from __future__ import annotations

import argparse
import importlib
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from engine.dsp import SR  # noqa: E402
from engine.render import Renderer, write_audio  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('score')
    ap.add_argument('parts', nargs='+')
    ap.add_argument('--start', type=float, default=0)
    ap.add_argument('--dur', type=float, default=40)
    ap.add_argument('--out', required=True)
    ap.add_argument('--lufs', type=float, default=-16)
    args = ap.parse_args()
    s = importlib.import_module(f'scores.{args.score}').build()
    gains = {'*': None}
    for p in args.parts:
        gains[p] = 0.0
    s.variant('solo', gains, lufs=args.lufs)
    r = Renderer(s, verbose=False)
    stems = {k: v for k, v in r.stems().items() if k in args.parts}
    y = r.mix(stems, 'solo')
    a = int(args.start * SR)
    write_audio(args.out, y[a:a + int(args.dur * SR)], quality=2)
    print('wrote', args.out)


if __name__ == '__main__':
    main()
