"""Cut a bar range out of a score as a one-shot score (for auditions).

Rendering a whole loop to hear eight bars wastes a shared machine's CPU. An
excerpt keeps bars [a, b): the notes that start there (and notes still
sounding at bar a, re-struck at its start), the tempo map, meters and
expression lanes from that point, and the score's mix settings. It renders as
a one-shot: the last notes ring out.
"""

from __future__ import annotations

import copy

import numpy as np

from .score import Note, Score


def excerpt(s: Score, a: float, b: float, name: str | None = None) -> Score:
    a0, b0 = s.bar(a), s.bar(b)
    x = Score(name or f'{s.name}_x{a:g}_{b:g}', bpm=s.bpm_at(a0), meter=s.meter,
              intro_bars=b - a, title=f'{s.title} (bars {a:g}-{b:g})', seed=s.seed, tonic=s.tonic,
              one_shot=True, transpose=s.transpose)
    # tempo: the segment in force at a0 (a ramp continues from its current bpm)
    tempo = []
    segs = s._tempo
    for i, (tb, bpm, ramp) in enumerate(segs):
        tb1 = segs[i + 1][0] if i + 1 < len(segs) else float('inf')
        if tb1 <= a0 or tb >= b0 + 64:
            continue
        if tb < a0:
            if ramp is not None and tb1 != float('inf'):
                bpm_a = bpm + (ramp - bpm) * (a0 - tb) / (tb1 - tb)
                tempo.append((0.0, bpm_a, ramp))
            else:
                tempo.append((0.0, bpm, None))
        else:
            tempo.append((tb - a0, bpm, ramp))
    x._tempo = tempo or [(0.0, s.bpm_at(a0), None)]
    # meters: renumbered so bar a is bar 1
    meters = [(1, s.bar_len(a))] + [(m - int(a) + 1, bb) for m, bb in s._meters if m > a]
    x._meters = meters
    x.meter = s.meter
    x.bar_beats = meters[0][1]
    x.silent_ok = set()
    x.variants = copy.deepcopy(s.variants)
    x.variant_keys = {}
    x.whole_loop = set()
    x.targets_lufs = dict(s.targets_lufs)
    x.master = copy.deepcopy(s.master)
    x.reverb = copy.deepcopy(s.reverb)
    for pname, p in s.parts.items():
        q = x.part(pname, p.inst, **copy.deepcopy(p.opts))
        for n in p.notes:
            if n.start >= b0 - 1e-9 or n.end <= a0 + 1e-9:
                continue
            if n.start < a0 - 1e-9:
                # still sounding at bar a: struck again at the excerpt's start
                if n.end - a0 < 1.0:
                    continue
                m = copy.copy(n)
                m.start, m.dur = 0.0, n.end - a0
            else:
                m = copy.copy(n)
                m.start = n.start - a0
            q.notes.append(m)
        if p.expr_points:
            xs = np.array([bb for bb, _ in p.expr_points])
            ys = np.array([v for _, v in p.expr_points])
            pts = [(0.0, float(np.interp(a0, xs, ys)))]
            pts += [(bb - a0, v) for bb, v in p.expr_points if a0 < bb < b0]
            pts.append((b0 - a0, float(np.interp(b0, xs, ys))))
            q.expr_points = pts
    return x


__all__ = ['excerpt', 'Note']
