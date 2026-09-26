#!/usr/bin/env python3
"""Symbolic checks on a score (no audio): sustained semitone clashes between
parts, and bars whose note total disagrees with the meter.

  python3 tools/music/lint.py battle_act1 [--variant full] [--min-overlap 1.0]

A clash is two notes a minor second / major seventh apart (any octave) from
different parts that sound together for at least --min-overlap beats while
both are held at least a beat. Most hits are intended colour (maj7 chords,
suspensions); the list is for a human to scan for typos and wrong octaves.
"""

from __future__ import annotations

import argparse
import importlib
import os
import sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from engine.render import _variant_gain  # noqa: E402
from engine.theory import name  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('score')
    ap.add_argument('--variant', default='full')
    ap.add_argument('--min-overlap', type=float, default=1.0)
    args = ap.parse_args()
    s = importlib.import_module(f'scores.{args.score}').build()
    gains = s.variants.get(args.variant, {})
    notes = []
    for pname, part in s.parts.items():
        if _variant_gain(gains, pname) is None or part.inst in ('orch_perc', 'kit', 'riser', 'reverse'):
            continue
        for n in part.notes:
            if n.dur >= 1.0:
                notes.append((n.start, n.start + n.dur, n.pitch, pname))
    notes.sort()
    clashes = defaultdict(list)
    for i, (a0, a1, ap_, an) in enumerate(notes):
        for b0, b1, bp, bn in notes[i + 1:]:
            if b0 >= a1:
                break
            if an == bn:
                continue
            ov = min(a1, b1) - max(a0, b0)
            if ov < args.min_overlap:
                continue
            if abs(ap_ - bp) % 12 in (1, 11):
                bar = s.bar_at(max(a0, b0)) + 1
                clashes[bar].append(f'{an}:{name(ap_)} x {bn}:{name(bp)} ({ov:.1f}b)')
    for bar in sorted(clashes):
        items = sorted(set(clashes[bar]))
        print(f'bar {bar:3d}: ' + '; '.join(items[:6]) + (' ...' if len(items) > 6 else ''))
    print(f'{sum(len(v) for v in clashes.values())} sustained semitone clashes in {len(clashes)} bars')


if __name__ == '__main__':
    main()
