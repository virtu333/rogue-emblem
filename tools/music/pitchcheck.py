#!/usr/bin/env python3
"""Which pitch classes sound, window by window, in a rendered file (a quick
objective check that a cue is in the key it should be).

  python3 tools/music/pitchcheck.py assets/audio/stingers/stinger_levelup_D.mp3 [--win 0.25]

Prints the three strongest pitch classes per window (energy from 65 Hz to
2.1 kHz folded to 12 classes) and the level, until the level drops away.
"""

from __future__ import annotations

import argparse
import subprocess

import numpy as np

NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']
SR = 48000


def decode(path):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-f', 'f32le', '-ac', '1',
                          '-ar', str(SR), '-'], capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32)


def chroma(x, win_s):
    n = int(win_s * SR)
    nfft = 1 << 15
    freqs = np.fft.rfftfreq(nfft, 1 / SR)
    band = (freqs > 65) & (freqs < 2100)
    pcs = (np.round(12 * np.log2(freqs[band] / 440.0)) + 9) % 12
    rows = []
    for i in range(0, len(x) - n, n):
        seg = x[i:i + n] * np.hanning(n)
        mag = np.abs(np.fft.rfft(seg, nfft))[band] ** 2
        c = np.bincount(pcs.astype(int), weights=mag, minlength=12)
        level = 10 * np.log10(np.mean(x[i:i + n] ** 2) + 1e-12)
        rows.append((i / SR, c / (c.sum() + 1e-12), level))
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('path')
    ap.add_argument('--win', type=float, default=0.25)
    ap.add_argument('--floor', type=float, default=-45.0, help='stop below this level (dBFS)')
    args = ap.parse_args()
    rows = chroma(decode(args.path), args.win)
    total = np.zeros(12)
    for t, c, level in rows:
        if level < args.floor:
            continue
        total += c
        top = np.argsort(c)[::-1][:3]
        tops = '  '.join(f'{NAMES[k]:2s}{c[k]:.2f}' for k in top)
        print(f'{t:6.2f}s {level:6.1f} dB  {tops}')
    top = np.argsort(total)[::-1][:5]
    print('overall:', '  '.join(f'{NAMES[k]} {total[k] / total.sum():.2f}' for k in top))


if __name__ == '__main__':
    main()
