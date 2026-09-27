#!/usr/bin/env python3
"""Render "The Roll" (score.py) and write its cue sheet.

  python3 tools/cutscene/hook/music.py            # audio + cues
  python3 tools/cutscene/hook/music.py --cues     # cue sheet only (no render)

Audio: tools/cutscene/hook/the_roll.mp3 (committed: the sample libraries it is
rendered with are not in the repo; see tools/music/README.md). Cues: tools/cutscene/hook/cues.json, the exact
time of every bar and beat (Score.seconds) plus the notes of the parts the picture
follows. No audio analysis: the score is the clock.
"""

import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '../../..'))
sys.path.insert(0, os.path.join(ROOT, 'tools/music'))
sys.path.insert(0, HERE)

import score as roll  # noqa: E402

FOLLOW = ['celesta', 'solo', 'bells', 'knock', 'taiko', 'boom', 'vn_l', 'hn']


def cues(s):
    bars = int(s.intro_bars)
    total = s.bar(bars + 1)
    beats = [round(s.seconds(b), 6) for b in range(int(total) + 1)]
    bar_t = [round(s.seconds(s.bar(n)), 6) for n in range(1, bars + 2)]
    bar_beats = [s.bar_len(n) for n in range(1, bars + 2)]
    parts = {}
    for name in FOLLOW:
        if name in s.parts:
            parts[name] = [[round(s.seconds(n.start), 4), round(s.seconds(n.end) - s.seconds(n.start), 4), n.pitch]
                           for n in sorted(s.parts[name].notes, key=lambda n: n.start)]
    return {'title': s.title, 'bars': bar_t, 'barBeats': bar_beats, 'beats': beats,
            'sections': roll.SECTIONS, 'parts': parts}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--cues', action='store_true')
    a = ap.parse_args()
    s = roll.build()
    with open(os.path.join(HERE, 'cues.json'), 'w') as fh:
        json.dump(cues(s), fh, separators=(',', ':'))
    print('cues.json:', len(s.parts), 'parts; end of bar 44 at',
          round(s.seconds(s.bar(45)), 3), 's')
    if a.cues:
        return
    from engine.form import check_form
    from engine.render import Renderer
    problems = check_form(s)
    if problems:
        raise SystemExit('\n'.join(['form check failed:', *problems]))
    meta = Renderer(s).export('the_roll', variants=['full'], out_dir=HERE)
    print(meta)


if __name__ == '__main__':
    main()
