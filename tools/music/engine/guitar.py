"""Electric guitar: the Karoryfer Emilyguitar (CC0, clean DI samples) through an
amp chain written here, since the samples carry no amp.

    DI -> noise gate -> (palm: string damping) -> tight + mid push
       -> two 4x-oversampled asymmetric clipping stages with interstage EQ
       -> tone stack -> 4x12-style cabinet (EQ) -> [chorus] -> [delay]

`rig(x, **opts)` is what a part's `amp=dict(rig=True, ...)` runs (render.py).

Double tracking: sfizz picks round robins from a random sequence that is the
same on every render, so two parts playing the same notes would play the same
samples. `take_program(n)` writes a copy of a program whose round robins are
rotated by n, so a second take plays other recordings of every note.
"""

from __future__ import annotations

import os
import re

import numpy as np
from scipy import signal

from . import dsp
from .dsp import SR

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
EMILY = os.path.join(ROOT, 'References', 'music-libs', 'karoryfer.emilyguitar')
TAKES = os.path.join(EMILY, '_takes')   # generated programs (not in the library itself)


def take_program(program: str = 'emily_clean.sfz', take: int = 0) -> str:
    """The program with its note round robins (3 per layer) rotated by `take`."""
    src = os.path.join(EMILY, program)
    if take % 3 == 0:
        return src
    from . import sfzlab
    prog = sfzlab.load(src)
    pat = re.compile(r'(/notes/[a-z0-9]+_(?:p|mp|mf|f)_rr)([123])\.wav$')

    def rot(v):
        m = pat.search(v)
        if not m:
            return v
        n = (int(m.group(2)) - 1 + take) % 3 + 1
        return v[:m.start()] + f'{m.group(1)}{n}.wav'

    prog = [(h, [(k, rot(v) if k == 'sample' else v) for k, v in ops]) for h, ops in prog]
    return sfzlab.write(prog, f'{os.path.splitext(program)[0]}-take{take % 3}',
                        directory=TAKES, ram=False)


# ------------------------------------------------------------------ building blocks
def _gate(x, thresh_db=-58.0, attack_ms=1.0, release_ms=60.0):
    """Close between notes, so the amp's gain does not lift the samples' floor."""
    lvl = np.sqrt(np.mean(x.astype(np.float64) ** 2, axis=1) + 1e-14)
    env = dsp._env_follow(lvl * 1.4, np.exp(-1 / (SR * attack_ms / 1000)),
                          np.exp(-1 / (SR * release_ms / 1000)))
    env_db = 20 * np.log10(env + 1e-12)
    g = np.clip((env_db - thresh_db) / 8.0 + 0.5, 0.0, 1.0)
    return (x * g[:, None]).astype(np.float32)


def _clip(y, drive, bias):
    """Asymmetric soft clipping (a triode-ish stage): tanh with a DC bias that is
    removed again, so even harmonics come in as the stage saturates."""
    return np.tanh(drive * y + bias) - np.tanh(bias)


def _stage(y, drive, bias, os_=4):
    up = signal.resample_poly(y, os_, 1, axis=0)
    up = _clip(up, drive, bias)
    return signal.resample_poly(up, 1, os_, axis=0)


CAB = [   # a closed 4x12 with 12" speakers, as EQ: thump, low-mid hollow, presence, cone roll-off
    ('highpass', 85, 0.8, 0), ('peak', 115, 1.1, 3.0), ('peak', 420, 1.0, -4.5),
    ('peak', 1600, 1.4, 0.5), ('peak', 2700, 1.8, 3.0), ('peak', 4200, 2.0, -2.5),
    ('lowpass', 6000, 0.8, 0), ('lowpass', 7500, 0.7, 0), ('lowpass', 10000, 0.7, 0),
]


def chorus(x, rate=0.8, depth_ms=2.2, base_ms=9.0, mix=0.45):
    """Two modulated delay lines, one per side, in quadrature (a stereo chorus)."""
    n = len(x)
    t = np.arange(n) / SR
    mono = x.mean(axis=1)
    out = np.empty((n, 2), np.float32)
    idx = np.arange(n, dtype=np.float64)
    for ch, ph in ((0, 0.0), (1, np.pi / 2)):
        d = (base_ms + depth_ms * np.sin(2 * np.pi * rate * t + ph)) * SR / 1000
        wet = np.interp(idx - d, idx, mono, left=0.0)
        out[:, ch] = (1 - mix) * mono + mix * wet
    return out


def delay(x, time_s=0.3, feedback=0.3, mix=0.2, lp_hz=3500, spread_ms=12):
    """Filtered feedback echo, the right repeat a little later than the left."""
    n = len(x)
    out = x.astype(np.float32).copy()
    for ch, extra in ((0, 0.0), (1, spread_ms / 1000)):
        d = int((time_s + extra) * SR)
        tap = x[:, ch].astype(np.float32)
        acc = np.zeros(n, np.float32)
        g = 1.0
        for _ in range(8):
            g *= feedback if _ else 1.0
            if d * (_ + 1) >= n or g < 0.02:
                break
            s = np.zeros(n, np.float32)
            s[d * (_ + 1):] = tap[:n - d * (_ + 1)] * g
            acc += s
        acc = dsp.eq(acc[:, None], [('lowpass', lp_hz, 0.7, 0), ('highpass', 300, 0.7, 0)])[:, 0]
        out[:, ch] += mix * acc
    return out


def rig(x, rig=True, gain_db=28.0, palm=False, tight=110.0, mid_hz=750.0, mid_db=5.0,
        bias=0.25, bass_db=0.0, mid2_db=-2.0, treble_db=1.0, presence_db=1.0, cab=True,
        gate_db=-58.0, chorus_mix=0.0, chorus_rate=0.8, delay_mix=0.0, delay_s=0.3,
        delay_fb=0.3, out_db=0.0, stages=2):
    """An amp (see the module docstring). `gain_db` sets how hard the preamp is hit
    (0 about clean, 20 crunch, 30+ high gain); `palm` damps the strings before the
    amp (palm mutes: the pick attack with little of the ring). In a looping cue, pick a
    `chorus_rate` with a whole number of cycles per loop, or the seam will not match."""
    di = x.mean(axis=1, keepdims=True).astype(np.float32)   # a DI is one signal
    di = _gate(di, gate_db)
    if palm:
        di = dsp.eq(di, [('lowpass', 900, 0.6, 0), ('peak', 180, 0.9, 3.0)])
    y = dsp.eq(di, [('highpass', tight, 0.7, 0), ('peak', mid_hz, 0.7, mid_db)])
    y = y * dsp.undb(gain_db)
    for i in range(stages):
        y = _stage(y, 1.0, bias if i == 0 else bias * 0.4)
        if i + 1 < stages:
            # between stages: lose the fizz and the flab before the next one
            y = dsp.eq(y, [('highpass', 140, 0.7, 0), ('lowpass', 7000, 0.7, 0)])
            y = y * dsp.undb(gain_db * 0.35)
    y = dsp.eq(y, [('lowshelf', 120, 0.7, bass_db), ('peak', 650, 0.6, mid2_db),
                   ('highshelf', 2500, 0.7, treble_db), ('peak', 3500, 1.0, presence_db)])
    if cab:
        y = dsp.eq(y, CAB)
    y = np.repeat(y, 2, axis=1) * dsp.undb(out_db - 12)
    if chorus_mix:
        y = chorus(y, rate=chorus_rate, mix=chorus_mix)
    if delay_mix:
        y = delay(y, time_s=delay_s, feedback=delay_fb, mix=delay_mix)
    return y.astype(np.float32)
