#!/usr/bin/env python3
"""Cue sheet for a cutscene: exact bar and beat times of a score, from the score itself.

  python3 tools/cutscene/cuesheet.py title --bars 34 --parts solo,celesta \
      > tools/cutscene/pilot/cues/music_title.json

The music is composed in code (tools/music/scores), so every downbeat is known
exactly: Score.seconds(beat) honours tempo marks and ramps. No audio analysis.
Beat 1 of bar 1 is t = 0 in the rendered file (loop points in musicLoops.js come
later in the file and do not move the bars).

Output: { key, bpm, beatsPerBar, beats: [t...], bars: [t...], parts: { name: [[t, dur, midi]...] } }
beats[i] is the start of beat i (0-based over the whole cue); bars[n-1] is bar n.
`parts` lists the named parts' notes in seconds (for pictures that follow a melody).

Slice 1 moves this into tools/music/build.py (a musicCueSheets.js beside musicLoops.js).
"""

from __future__ import annotations

import argparse
import importlib
import json
import os
import sys

MUSIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'music')
sys.path.insert(0, os.path.abspath(MUSIC))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('score', help='module name in tools/music/scores, e.g. title')
    ap.add_argument('--bars', type=int, default=None, help='bars to export (default: intro + loop)')
    ap.add_argument('--parts', default='', help='comma-separated part names whose notes to export')
    a = ap.parse_args()

    mod = importlib.import_module(f'scores.{a.score}')
    s = mod.build()
    bars = a.bars or int(s.intro_bars + s.loop_bars)
    beats_total = s.bar(bars + 1)
    beats = [round(s.seconds(b), 6) for b in range(int(beats_total) + 1)]
    bar_times = [round(s.seconds(s.bar(n)), 6) for n in range(1, bars + 2)]
    parts = {}
    for name in [p for p in a.parts.split(',') if p]:
        part = s.parts[name]
        parts[name] = [
            [round(s.seconds(n.start), 6), round(s.seconds(n.end) - s.seconds(n.start), 6), n.pitch]
            for n in sorted(part.notes, key=lambda n: n.start)
        ]
    out = {
        'key': getattr(mod, 'KEY', a.score),
        'bpm': s._tempo[0][1],
        'beatsPerBar': s.bar_beats,
        'beats': beats,
        'bars': bar_times,
        'parts': parts,
    }
    json.dump(out, sys.stdout, separators=(',', ':'))
    sys.stdout.write('\n')


if __name__ == '__main__':
    main()
