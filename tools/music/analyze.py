#!/usr/bin/env python3
"""Objective checks for a score: per-part levels in each mix variant, and a
spectrogram / level-over-time plot of the mixes.

  python3 tools/music/analyze.py battle_act1 [--png out.png]
"""

from __future__ import annotations

import argparse
import importlib
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from engine import dsp  # noqa: E402
from engine.dsp import SR  # noqa: E402
from engine.instruments import INSTRUMENTS  # noqa: E402
from engine.render import Renderer, _variant_gain  # noqa: E402


def band_rms(x, lo, hi):
    from scipy import signal
    sos = signal.butter(4, [lo, hi], 'band', fs=SR, output='sos')
    y = signal.sosfilt(sos, x.mean(axis=1))
    return dsp.db(float(np.sqrt(np.mean(y ** 2)) + 1e-12))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('score')
    ap.add_argument('--png')
    args = ap.parse_args()
    mod = importlib.import_module(f'scores.{args.score}')
    s = mod.build()
    r = Renderer(s, verbose=False)
    stems = r.stems()
    a, b = r.loop_start_f, r.loop_end_f
    print(f'{"part":12s} {"inst":12s} ' + ' '.join(f'{v:>8s}' for v in s.variants))
    rows = []
    for name, (x, send) in stems.items():
        part = s.parts[name]
        seg = x[r.I_f:b]
        rms = dsp.db(float(np.sqrt(np.mean(seg.astype(np.float64) ** 2)) + 1e-12))
        cols = []
        for v in s.variants:
            g = _variant_gain(s.variants[v], name)
            cols.append('   muted' if g is None else f'{rms + part.opts.get("gain", 0) + g:8.1f}')
        rows.append((name, part.inst, cols))
    for name, inst, cols in rows:
        print(f'{name:12s} {inst:12s} ' + ' '.join(cols))
    for v in s.variants:
        y = r.mix(stems, v)[r.I_f:b]
        print(f'[{v}] lufs {dsp.lufs(y):.1f}  sub(30-80) {band_rms(y, 30, 80):.1f}  '
              f'low(80-250) {band_rms(y, 80, 250):.1f}  mid(250-2k) {band_rms(y, 250, 2000):.1f}  '
              f'pres(2k-6k) {band_rms(y, 2000, 6000):.1f}  air(6k-16k) {band_rms(y, 6000, 16000):.1f}  '
              f'side/mid {dsp.db(float(np.std(y[:,0]-y[:,1])/ (np.std(y[:,0]+y[:,1])+1e-9))):.1f} dB')
        if args.png:
            import matplotlib
            matplotlib.use('Agg')
            import matplotlib.pyplot as plt
            from scipy import signal
            f, t, S = signal.spectrogram(y.mean(axis=1), SR, nperseg=4096, noverlap=2048)
            fig, ax = plt.subplots(2, 1, figsize=(16, 8), sharex=True)
            ax[0].pcolormesh(t, f, 10 * np.log10(S + 1e-12), shading='auto', vmin=-110, vmax=-30,
                             cmap='magma')
            ax[0].set_yscale('symlog', linthresh=200)
            ax[0].set_ylim(30, 16000)
            hop = SR // 10
            env = [dsp.db(float(np.sqrt(np.mean(y[i:i + hop] ** 2)) + 1e-9)) for i in range(0, len(y) - hop, hop)]
            ax[1].plot(np.arange(len(env)) / 10, env)
            ax[1].set_ylim(-50, 0)
            ax[1].grid(True)
            fig.tight_layout()
            out = args.png.replace('.png', f'_{v}.png')
            fig.savefig(out, dpi=70)
            print('wrote', out)


if __name__ == '__main__':
    main()
