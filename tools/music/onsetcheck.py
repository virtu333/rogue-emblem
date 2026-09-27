#!/usr/bin/env python3
"""How late (or early) notes speak, measured through the engine's own render path.

  python3 tools/music/onsetcheck.py choir solo_violin     # these instruments
  python3 tools/music/onsetcheck.py --all                 # every sampled instrument
  python3 tools/music/onsetcheck.py solo_violin --legato  # also legato transitions
  python3 tools/music/onsetcheck.py --all --measure       # fill tools/music/onsets.json

A synthetic one-shot score plays isolated notes (a 1 s note every 2 s, no
humanising, no velocity jitter) across each articulation's range at pp, p,
mf, f and ff. Each note's onset is where its envelope (10 ms RMS) first
comes within 10 dB of its early peak, the definition the onset compensation
(engine/onsets.py) targets; the table prints onset minus the written time.
0 means the note lands on the beat.

--legato plays pairs of slurred notes (up and down a tone and a fourth) and
reports when the pitch arrives: the first moment the new note's harmonics
outweigh the old one's, against the written time of the new note.
"""

from __future__ import annotations

import argparse
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import numpy as np  # noqa: E402

from engine.dsp import SR  # noqa: E402
from engine.onsets import EARLY, rise  # noqa: E402
from engine.instruments import INSTRUMENTS  # noqa: E402
from engine.render import Renderer  # noqa: E402
from engine.score import Score  # noqa: E402

DYN = (('pp', 0.26), ('p', 0.38), ('mf', 0.62), ('f', 0.76), ('ff', 0.88))


def envelope(x):
    return np.sqrt(np.convolve(x.mean(axis=1).astype(np.float64) ** 2, np.ones(441) / 441,
                               'same'))


def onset_s(e, t0, t_on=None, win=EARLY):
    """Seconds from t0 until the note speaks (onsets.rise): its early peak is
    taken within [t_on, t_on + win] (t_on: where the note really starts,
    default t0); the rise is looked
    for from t0 - 0.5 s (a compensated note starts before its beat), after the
    quietest point before the peak (the ring of the previous note does not count)."""
    a = max(0, int((t0 - 0.5) * SR))
    t_on = t0 if t_on is None else max(t_on, t0 - 0.5)
    r = rise(e[a: int((t_on + win) * SR)], peak_from=int(t_on * SR) - a)
    return None if r is None else a / SR + r - t0


def keys_for(inst):
    if inst.get('fixed_pitch'):
        keys = sorted(set(inst.get('keys', {}).values())) or [inst['ref_key']]
        return keys[:12]
    lo, hi = inst['range']
    return sorted({int(round(k)) for k in np.linspace(lo + 2, hi - 2, 6)})


def arts_for(inst):
    if inst['kind'] != 'sfz':
        return ['default']
    seen, out = set(), []
    for name, art in inst['arts'].items():
        k = id(art)
        if k in seen:
            continue
        seen.add(k)
        out.append(name)
    return out


def detached(name, art):
    inst = INSTRUMENTS[name]
    keys = keys_for(inst)
    s = Score(f'onsetcheck_{name}_{art}', bpm=60, intro_bars=len(keys) * len(DYN) * 2 / 4 + 1,
              one_shot=True)
    p = s.part('x', name, humanize_ms=0, vel_jitter=0.0, legato=False)
    grid = []
    beat = 1.0
    for k in keys:
        for dname, vel in DYN:
            p.notes.append(_note(beat, k, vel, art))
            grid.append((k, dname, beat))
            beat += 2.0
    r = Renderer(s, verbose=False)
    e = envelope(r.render_part(p))
    # where each note really starts (its onset pre-roll applied): its early peak
    # is measured from there, as the compensation measured it
    intro, loop = r._events(p, INSTRUMENTS[name])
    starts = {round(ev.beat_start, 6): ev.t for ev in intro + loop}
    out = {}
    for k, dname, b in grid:
        o = onset_s(e, s.seconds(b), starts[round(b, 6)])
        out[(k, dname)] = None if o is None else o * 1000
    return keys, out


def _note(beat, key, vel, art, dur=1.0):
    from engine.score import Note
    return Note(start=beat, dur=dur, pitch=key, vel=vel, art=art, tenuto=True)


def legato(name, art='default'):
    """(interval, dyn) -> ms from the written time of the second note of a slur
    to the moment its pitch takes over."""
    inst = INSTRUMENTS[name]
    lo, hi = inst['range']
    base = int((lo + hi) / 2) - 3
    s = Score(f'onsetcheck_leg_{name}', bpm=60, intro_bars=16, one_shot=True)
    p = s.part('x', name, humanize_ms=0, vel_jitter=0.0)
    cases = []
    beat = 1.0
    for iv in (2, -2, 5, -5):
        for dname, vel in DYN[1:4]:
            p.notes.append(_note(beat, base, vel, art))
            p.notes.append(_note(beat + 1.0, base + iv, vel, art))
            cases.append((iv, dname, base, base + iv, beat + 1.0))
            beat += 3.5
    r = Renderer(s, verbose=False)
    x = r.render_part(p).mean(axis=1).astype(np.float64)
    out = {}
    for iv, dname, k0, k1, b in cases:
        t0 = s.seconds(b)
        f0, f1 = (440 * 2 ** ((k - 69) / 12) for k in (k0, k1))
        L, hop = int(0.03 * SR), int(0.002 * SR)
        nfft = 1 << 14
        freqs = np.fft.rfftfreq(nfft, 1 / SR)
        win = np.hanning(L)
        t_on = None
        run = 0
        for a in range(int((t0 - 0.2) * SR), int((t0 + 0.3) * SR), hop):
            mag = np.abs(np.fft.rfft(x[a:a + L] * win, nfft))

            def score(f):
                v = 0.0
                for h in range(1, 6):
                    band = (freqs > h * f * 2 ** (-0.3 / 12)) & (freqs < h * f * 2 ** (0.3 / 12))
                    v += mag[band].max() if band.any() else 0.0
                return v
            if score(f1) > score(f0):
                run += 1
                if run == 3:
                    t_on = (a + L / 2) / SR - 2 * hop / SR - t0
                    break
            else:
                run = 0
        out[(iv, dname)] = None if t_on is None else t_on * 1000
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('insts', nargs='*')
    ap.add_argument('--all', action='store_true')
    ap.add_argument('--legato', action='store_true')
    ap.add_argument('--arts', nargs='*', help='only these articulations')
    ap.add_argument('--measure', action='store_true',
                    help='only measure the onset tables (tools/music/onsets.json) that are '
                         'missing or stale, so builds do not have to')
    args = ap.parse_args()
    names = list(INSTRUMENTS) if args.all else args.insts
    if args.measure:
        from engine import onsets
        for name in names:
            if onsets.compensates(INSTRUMENTS[name]):
                for art in onsets.names(name):
                    if not args.arts or art in args.arts:
                        onsets.table(name, art)
                        print('measured', f'{name}:{art}', flush=True)
        return
    summary = []
    for name in names:
        inst = INSTRUMENTS[name]
        if inst['kind'] in ('synth', 'lab'):
            continue
        for art in arts_for(inst):
            if args.arts and art not in args.arts:
                continue
            from engine.sampler import load_sample, pitched, shaped
            for cache in (load_sample, pitched, shaped):   # bounded memory over --all
                cache.cache_clear()
            keys, res = detached(name, art)
            print(f'\n{name}:{art}   onset - written time, ms   ' +
                  ' '.join(f'{d:>6s}' for d, _ in DYN))
            for k in keys:
                print(f'  key {k:3d}                           ' +
                      ' '.join(f'{res[(k, d)]:+6.1f}' if res[(k, d)] is not None else '    --'
                               for d, _ in DYN))
            v = np.array([x for x in res.values() if x is not None])
            mf = np.array([res[(k, 'mf')] for k in keys if res[(k, 'mf')] is not None])
            summary.append((f'{name}:{art}', np.median(mf), np.median(v), v.min(), v.max(),
                            np.mean(np.abs(v))))
            if args.legato and inst['kind'] == 'sfz' and inst['arts'][art].get('legato'):
                lg = legato(name, art)
                print('  legato: pitch arrives (ms after the written time) ' +
                      ', '.join(f'{iv:+d}/{d}: ' + (f'{v:+.0f}' if v is not None else '--')
                                for (iv, d), v in lg.items()))
    print(f'\n{"instrument:art":24s} {"mf med":>7s} {"all med":>8s} {"min":>7s} {"max":>7s}'
          f' {"mean|x|":>8s}')
    for row in summary:
        print(f'{row[0]:24s} {row[1]:+7.1f} {row[2]:+8.1f} {row[3]:+7.1f} {row[4]:+7.1f}'
              f' {row[5]:8.1f}')


if __name__ == '__main__':
    main()
