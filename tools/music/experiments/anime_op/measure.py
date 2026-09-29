"""Measure a render: loudness, peaks, clipping, spectrum balance per section,
stem levels per section and the lead's margin over the band.

python3 measure.py out/anime_op.wav [out/stems]
"""
import os
import sys

import numpy as np
import pyloudnorm as pyln
import soundfile as sf
from scipy import signal

path = sys.argv[1]
stems_dir = sys.argv[2] if len(sys.argv) > 2 else None
x, sr = sf.read(path, always_2d=True)
SPB = 0.4
SECTIONS = [('intro', 1, 4), ('hook', 5, 8), ('A1', 9, 16), ('A2', 17, 24), ('B', 25, 31),
            ('build', 32, 32), ('sabi', 33, 48), ('drop', 49, 52), ('outro', 53, 56)]


def seg(y, a, b):
    return y[int((a - 1) * 4 * SPB * sr): int(b * 4 * SPB * sr)]


meter = pyln.Meter(sr)
print(f'file: {len(x) / sr:.2f} s, integrated {meter.integrated_loudness(x):.2f} LUFS')
up = signal.resample_poly(x, 4, 1, axis=0)
print(f'sample peak {20 * np.log10(np.abs(x).max()):.2f} dBFS, true peak (4x) '
      f'{20 * np.log10(np.abs(up).max()):.2f} dBTP, samples >= -0.1 dBFS: '
      f'{int((np.abs(x) >= 10 ** (-0.1 / 20)).sum())}')
# loudness range, short term
st = []
hop = int(sr * 1.0)
for i in range(0, len(x) - 3 * sr, hop):
    try:
        st.append(meter.integrated_loudness(x[i:i + 3 * sr]))
    except Exception:
        pass
st = np.array([v for v in st if v > -70])
print(f'short-term loudness (3 s): p10 {np.percentile(st, 10):.1f}, p95 {np.percentile(st, 95):.1f},'
      f' LRA~{np.percentile(st, 95) - np.percentile(st, 10):.1f} LU')
side = (x[:, 0] - x[:, 1]) / 2
mid = (x[:, 0] + x[:, 1]) / 2
print(f'side/mid energy {10 * np.log10(np.mean(side ** 2) / np.mean(mid ** 2)):.1f} dB, '
      f'L/R corr {np.corrcoef(x[:, 0], x[:, 1])[0, 1]:.2f}')

BANDS = [(20, 60), (60, 120), (120, 250), (250, 500), (500, 1000), (1000, 2000), (2000, 4000),
         (4000, 8000), (8000, 16000)]
print('\nsection    LUFS   ' + ' '.join(f'{lo:>5}' for lo, hi in BANDS) + '   (band dB rel. total)')
for name, a, b in SECTIONS:
    y = seg(x, a, b)
    f, P = signal.welch(y.mean(axis=1), sr, nperseg=8192)
    tot = P.sum()
    vals = [10 * np.log10(P[(f >= lo) & (f < hi)].sum() / tot + 1e-12) for lo, hi in BANDS]
    print(f'{name:8s} {meter.integrated_loudness(y):6.1f}   ' + ' '.join(f'{v:5.1f}' for v in vals))

if stems_dir:
    names = sorted(n[:-4] for n in os.listdir(stems_dir) if n.endswith('.wav'))
    stems = {n: sf.read(os.path.join(stems_dir, n + '.wav'), always_2d=True)[0] for n in names}
    print('\nstem RMS (dBFS, pre-bus, while playing) per section')
    print('stem      ' + ' '.join(f'{s[0]:>6}' for s in SECTIONS))
    for n in names:
        row = []
        for _, a, b in SECTIONS:
            y = seg(stems[n], a, b)
            w = int(0.1 * sr)
            k = len(y) // w
            if k == 0:
                row.append('   -  ')
                continue
            r = np.sqrt((y[:k * w] ** 2).mean(axis=1).reshape(k, w).mean(axis=1))
            act = r[r > r.max() * 10 ** (-30 / 20)] if r.max() > 1e-6 else []
            row.append(f'{20 * np.log10(np.sqrt(np.mean(np.square(act)))):6.1f}' if len(act) else '   -  ')
        print(f'{n:9s} ' + ' '.join(row))
    # the lead's margin: lead vs everything else in the 1-4 kHz band where it lives
    if 'lead' in stems:
        rest = sum(v for k, v in stems.items() if k != 'lead')
        sos = signal.butter(4, [800, 4000], 'bandpass', fs=sr, output='sos')
        print('\nlead vs rest, 800-4000 Hz band (dB, positive = lead above):')
        for name, a, b in SECTIONS:
            L = signal.sosfilt(sos, seg(stems['lead'], a, b).mean(axis=1))
            R = signal.sosfilt(sos, seg(rest, a, b).mean(axis=1))
            if np.mean(L ** 2) < 1e-10:
                continue
            print(f'  {name:6s} {10 * np.log10(np.mean(L ** 2) / np.mean(R ** 2)):6.1f}')


# ---------------------------------------------------------------- EDM checks
if stems_dir:
    def env_db(y, win=0.01):
        w = int(win * sr)
        k = len(y) // w
        r = np.sqrt((y[:k * w].mean(axis=1) ** 2).reshape(k, w).mean(axis=1) + 1e-12)
        return 20 * np.log10(r)

    print('\nsidechain depth (level 20-50 ms after each quarter vs 300-380 ms, median dB):')
    for n in ('stack', 'wobble', 'synth_pad', 'pluck'):
        if n not in stems:
            continue
        e = env_db(stems[n])
        for name, a, b in (('hook', 5, 7), ('sabi', 33, 47), ('drop', 49, 52)):
            d = []
            for q in range((a - 1) * 4, b * 4):
                t = q * SPB
                i0, i1 = int((t + 0.02) / 0.01), int((t + 0.05) / 0.01)
                j0, j1 = int((t + 0.30) / 0.01), int((t + 0.38) / 0.01)
                if j1 < len(e) and e[j0:j1].mean() > -60:
                    d.append(e[j0:j1].mean() - e[i0:i1].mean())
            if d:
                print(f'  {n:10s} {name:5s} {np.median(d):5.1f} dB')

    print('\nlow end: spectral peak below 150 Hz, and energy below 120 Hz (dB rel. mix), sabi and drop')
    sos = signal.butter(4, 120, 'low', fs=sr, output='sos')
    for name, a, b in (('sabi', 33, 47), ('drop', 49, 52)):
        mixlo = np.mean(signal.sosfilt(sos, seg(x, a, b).mean(axis=1)) ** 2)
        row = []
        for n in ('kit_kick', 'kick_layer', 'sub808', 'bass'):
            if n not in stems:
                continue
            y = seg(stems[n], a, b).mean(axis=1)
            f, P = signal.welch(y, sr, nperseg=16384)
            m = f < 150
            pk = f[m][np.argmax(P[m])]
            lo = np.mean(signal.sosfilt(sos, y) ** 2)
            row.append(f'{n} peak {pk:4.0f} Hz, <120 Hz {10 * np.log10(lo / mixlo + 1e-12):5.1f} dB')
        print(f'  {name}: ' + ' | '.join(row))
    # kick vs sub collisions: 808 level in the 60 ms after each kick vs its level between kicks
    if 'sub808' in stems and 'kit_kick' in stems:
        ek, es = env_db(stems['kit_kick']), env_db(stems['sub808'])
        on = np.nonzero((ek[1:] > ek.max() - 20) & (ek[:-1] <= ek.max() - 20))[0] + 1
        d, both = [], []
        for i in on:
            if i + 20 < len(es) and es[i + 12:i + 20].mean() > -60:
                d.append(es[i + 12:i + 20].mean() - es[i:i + 4].mean())
                both.append(ek[i:i + 4].mean() - es[i:i + 4].mean())
        print(f'808 duck under the kick: median {np.median(d):.1f} dB (level 120-200 ms after '
              f'vs first 40 ms), kick above 808 at the hit: median {np.median(both):.1f} dB, '
              f'{len(d)} kicks')
