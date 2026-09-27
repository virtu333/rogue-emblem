"""Electronic voices and EDM production tools: supersaw stacks, plucks, an 808,
a synth kick layer, noise risers and downlifters, impacts; a resonant
state-variable filter with per-sample cutoff (sweeps), and sidechain pumping.

Voices follow engine/synth.py: fn(events, n_frames, rng, **params), events
(t, dur, key, vel) in seconds; they are registered into synth.VOICES.
Part options (render.py): `sweep=[(bar, hz), ...]` (a 24 dB/oct low-pass whose
cutoff moves, log-interpolated) and `pump=dict(beats=[...], depth_db, release)`
(a sidechain duck shaped like an LFO tool, keyed to the given beats).
"""

from __future__ import annotations

import math

import numpy as np
from numba import njit

from .dsp import SR
from .theory import hz


# ------------------------------------------------------------------ filter
@njit(cache=True)
def _svf(x, cutoff, res, mode):
    """TPT state-variable filter (Zavalishin). x mono float64, cutoff per sample.
    res 0..0.98; mode 0 low-pass, 1 band-pass, 2 high-pass."""
    n = x.shape[0]
    y = np.empty(n)
    k = 2.0 - 2.0 * res
    ic1 = 0.0
    ic2 = 0.0
    for i in range(n):
        fc = cutoff[i]
        if fc > 0.45 * SR:
            fc = 0.45 * SR
        if fc < 10.0:
            fc = 10.0
        g = math.tan(math.pi * fc / SR)
        a1 = 1.0 / (1.0 + g * (g + k))
        a2 = g * a1
        a3 = g * a2
        v3 = x[i] - ic2
        v1 = a1 * ic1 + a2 * v3
        v2 = ic2 + a2 * ic1 + a3 * v3
        ic1 = 2.0 * v1 - ic1
        ic2 = 2.0 * v2 - ic2
        if mode == 0:
            y[i] = v2
        elif mode == 1:
            y[i] = v1
        else:
            y[i] = x[i] - k * v1 - v2
    return y


def svf(x, cutoff, res=0.1, mode=0, poles=2):
    """Filter a mono or stereo buffer; `cutoff` scalar or per-sample. poles=4
    cascades two sections (24 dB/oct)."""
    x = np.asarray(x, np.float64)
    cut = np.broadcast_to(np.asarray(cutoff, np.float64), (len(x),)).copy()
    chans = x[:, None] if x.ndim == 1 else x
    out = np.empty_like(chans)
    for c in range(chans.shape[1]):
        y = _svf(np.ascontiguousarray(chans[:, c]), cut, res, mode)
        if poles == 4:
            y = _svf(y, cut, 0.0 if mode == 0 else res, mode)
        out[:, c] = y
    return out[:, 0] if x.ndim == 1 else out


def sweep_curve(n, points_sec, hi=20000.0):
    """Per-sample cutoff from [(sec, hz)], log-interpolated, held at the ends."""
    ts = np.array([p[0] for p in points_sec]) * SR
    ls = np.log(np.array([p[1] for p in points_sec], np.float64))
    return np.exp(np.interp(np.arange(n), ts, ls))


def lowpass_sweep(x, points_sec, res=0.15):
    """24 dB/oct low-pass sweep; frames where the cutoff is above 18 kHz pass
    untouched (with a short crossfade), so only the swept part is coloured."""
    n = len(x)
    cut = sweep_curve(n, points_sec)
    act = cut < 18000
    if not act.any():
        return x
    idx = np.nonzero(act)[0]
    a, b = max(0, idx[0] - 1000), min(n, idx[-1] + int(0.05 * SR))
    y = x.astype(np.float64).copy()
    seg = svf(x[a:b], cut[a:b], res=res, poles=4)
    w = np.clip((18000 - cut[a:b]) / 3000, 0, 1)[:, None]   # blend back to dry above 15-18 kHz
    y[a:b] = w * seg + (1 - w) * x[a:b]
    return y.astype(np.float32)


def pump_gain(n, times_sec, depth_db=8.0, release=0.25, attack=0.004, shape=1.6):
    """Sidechain envelope: down by depth_db at each key time, back up over
    `release` seconds (an eased curve, like an LFO-tool shape)."""
    g = np.ones(n, np.float64)
    floor = 10 ** (-depth_db / 20)
    A = max(1, int(attack * SR))
    R = max(2, int(release * SR))
    ramp = np.linspace(1.0, floor, A)
    x = np.linspace(0, 1, R)
    rec = floor + (1 - floor) * (0.5 - 0.5 * np.cos(np.pi * x ** (1 / shape)))
    curve = np.concatenate([ramp, rec])
    for t in times_sec:
        s = int(round(t * SR)) - A
        if s >= n:
            continue
        c0 = max(0, -s)
        s0 = max(0, s)
        m = min(n - s0, len(curve) - c0)
        if m > 0:
            g[s0:s0 + m] = np.minimum(g[s0:s0 + m], curve[c0:c0 + m])
    return g.astype(np.float32)


# ------------------------------------------------------------------ oscillators
def _saw(freq, n, phase0):
    """Band-limited (polyBLEP) saw; freq scalar or per sample."""
    dt = np.broadcast_to(np.asarray(freq, np.float64) / SR, (n,))
    ph = (phase0 + np.cumsum(dt)) % 1.0
    y = 2.0 * ph - 1.0
    m = ph < dt
    t = ph[m] / dt[m]
    y[m] -= t + t - t * t - 1.0
    m = ph > 1.0 - dt
    t = (ph[m] - 1.0) / dt[m]
    y[m] -= t * t + t + t + 1.0
    return y


def _env(n, dur, a, d, s, r):
    t = np.arange(n) / SR
    env = np.where(t < a, t / max(a, 1e-4), s + (1 - s) * np.exp(-(t - a) / max(d, 1e-4)))
    off = t >= dur
    if off.any():
        lvl = float(env[int(min(dur * SR, n - 1))])
        env[off] = lvl * np.exp(-(t[off] - dur) / max(r / 5, 1e-4))
    return env


def _place(out, buf, start):
    end = min(len(out), start + len(buf))
    if end > start >= 0:
        out[start:end] += buf[: end - start]
    elif start < 0 < end:
        out[:end] += buf[-start:-start + end]


# detune pattern of a classic supersaw (fractions of the spread; centre voice at 0)
_SPREAD = [-1.0, -0.62, -0.31, 0.0, 0.29, 0.6, 0.97]


def supersaw(events, n_frames, rng, voices=7, detune=0.28, attack=0.004, decay=0.35,
             sustain=0.75, release=0.25, cutoff=2400.0, env_hz=4000.0, env_decay=0.18,
             res=0.25, key_track=0.5, lfo_hz=0.0, lfo_oct=0.0, trem_depth=0.0,
             width=1.0, drive=1.3, octave=0.0, glide_st=0.0, glide_s=0.06):
    """Detuned saws in unison (spread over the stereo field), a resonant low-pass
    with an envelope and an optional tempo LFO (future-bass wobble: lfo_hz, lfo_oct
    on the cutoff, trem_depth on the level), a pitch scoop (glide_st semitones up
    to the note over glide_s), soft saturation. `octave` mixes a saw an octave up."""
    out = np.zeros((n_frames, 2), np.float32)
    spread = _SPREAD if voices == 7 else list(np.linspace(-1, 1, voices))
    for t, dur, key, vel in events:
        n = int((dur + release + 0.05) * SR)
        tt = np.arange(n) / SR
        f0 = hz(key)
        bend = 2 ** (-glide_st * np.exp(-tt / max(glide_s, 1e-3)) / 12) if glide_st else 1.0
        L = np.zeros(n)
        R = np.zeros(n)
        for i, sp in enumerate(spread):
            f = f0 * 2 ** (sp * detune / 12) * bend
            w = _saw(f, n, rng.random())
            amp = 1.0 if sp == 0 else 0.78
            pan = sp * width
            L += w * amp * math.cos((pan + 1) * math.pi / 4)
            R += w * amp * math.sin((pan + 1) * math.pi / 4)
        if octave:
            w = _saw(f0 * 2 * bend, n, rng.random()) * octave
            L += w * 0.7
            R += w * 0.7
        kt = (f0 / 261.6) ** key_track
        cut = cutoff * kt + env_hz * vel ** 1.5 * np.exp(-tt / env_decay)
        if lfo_hz and lfo_oct:
            cut = cut * 2 ** (lfo_oct * (0.5 - 0.5 * np.cos(2 * np.pi * lfo_hz * tt)) - lfo_oct)
        y = svf(np.stack([L, R], 1), cut, res=res, poles=2) / (len(spread) * 0.55)
        env = _env(n, dur, attack, decay, sustain, release)
        if trem_depth:
            env = env * (1 - trem_depth * (0.5 - 0.5 * np.cos(2 * np.pi * lfo_hz * tt)))
        y = np.tanh(drive * y * env[:, None] * vel) / math.tanh(drive)
        _place(out, y.astype(np.float32), int(round(t * SR)))
    return out


def sub808(events, n_frames, rng, drop_st=12.0, drop_s=0.035, release=0.12, drive=2.2,
           decay=2.5):
    """808: a sine that falls onto its pitch, held and slowly decaying, driven
    for harmonics a small speaker can show."""
    out = np.zeros((n_frames, 2), np.float32)
    for t, dur, key, vel in events:
        n = int((dur + release) * SR)
        tt = np.arange(n) / SR
        f = hz(key) * 2 ** (drop_st * np.exp(-tt / drop_s) / 12)
        ph = 2 * np.pi * np.cumsum(f) / SR
        x = np.sin(ph)
        env = np.exp(-tt / decay) * np.minimum(1, tt / 0.002)
        off = tt >= dur
        env[off] *= np.exp(-(tt[off] - dur) / (release / 5))
        y = np.tanh(drive * x * env * vel) / math.tanh(drive)
        _place(out, np.stack([y, y], 1).astype(np.float32), int(round(t * SR)))
    return out


def kick_synth(events, n_frames, rng, f_hi=190.0, f_lo=48.0, sweep_s=0.045, decay=0.32,
               click=0.25):
    """An EDM kick layer: a fast pitch sweep into a short sine body, and a click."""
    out = np.zeros((n_frames, 2), np.float32)
    n = int((decay * 4) * SR)
    tt = np.arange(n) / SR
    f = f_lo + (f_hi - f_lo) * np.exp(-tt / sweep_s)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt / decay)
    for t, dur, key, vel in events:
        ck = rng.standard_normal(n) * np.exp(-tt / 0.0025) * click
        y = np.tanh(1.6 * (body + ck)) * vel
        _place(out, np.stack([y, y], 1).astype(np.float32), int(round(t * SR)))
    return out


def noise_riser(events, n_frames, rng, f0=250.0, f1=12000.0, res=0.55, pitch=True):
    """White noise through a resonant band-pass rising across the note, swelling;
    with `pitch`, a detuned saw an octave-and-a-fifth climb underneath. Ends at note end."""
    out = np.zeros((n_frames, 2), np.float32)
    for t, dur, key, vel in events:
        n = int(dur * SR)
        x = np.linspace(0, 1, n)
        cut = f0 * (f1 / f0) ** (x ** 1.5)
        noise = rng.standard_normal((n, 2))
        y = svf(noise, cut, res=res, mode=1) * 0.6 + svf(noise, cut, res=0.1, mode=0) * 0.25
        if pitch:
            f = hz(key) * 2 ** (19 * x ** 2 / 12)
            s = (_saw(f, n, 0.0) + _saw(f * 1.006, n, 0.4)) * 0.25
            y += svf(s, cut, res=0.2)[:, None]
        env = x ** 2.0
        _place(out, (y * env[:, None] * vel).astype(np.float32), int(round(t * SR)))
    return out


def downlifter(events, n_frames, rng, f0=10000.0, f1=180.0):
    """The riser reversed in spirit: filtered noise falling and fading, with a
    sine dropping two octaves."""
    out = np.zeros((n_frames, 2), np.float32)
    for t, dur, key, vel in events:
        n = int(dur * SR)
        x = np.linspace(0, 1, n)
        cut = f0 * (f1 / f0) ** (x ** 0.6)
        noise = rng.standard_normal((n, 2))
        y = svf(noise, cut, res=0.35, mode=0) * 0.7
        f = hz(key) * 2 ** (-24 * x / 12)
        y += (np.sin(2 * np.pi * np.cumsum(f) / SR) * 0.4)[:, None]
        env = (1 - x) ** 1.6 * np.minimum(1, x * 40)
        _place(out, (y * env[:, None] * vel).astype(np.float32), int(round(t * SR)))
    return out


def impact(events, n_frames, rng, length=3.0):
    """Downbeat impact: a sub drop, a noise crack and a dark decaying wash."""
    out = np.zeros((n_frames, 2), np.float32)
    for t, dur, key, vel in events:
        n = int(length * SR)
        tt = np.arange(n) / SR
        f = 32 + 90 * np.exp(-tt / 0.08)
        body = np.tanh(2.0 * np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt / 0.9))
        noise = rng.standard_normal((n, 2))
        crack = svf(noise, 3500.0, res=0.2) * np.exp(-tt / 0.03)[:, None]
        wash = svf(noise, 1800 * np.exp(-tt / 1.2) + 150, res=0.1, poles=4) \
            * (np.exp(-tt / 0.9) * 0.6)[:, None]
        y = body[:, None] * 0.9 + crack * 0.8 + wash
        _place(out, (y * vel).astype(np.float32), int(round(t * SR)))
    return out


VOICES = {
    'supersaw': supersaw, 'sub808': sub808, 'kick_synth': kick_synth,
    'noise_riser': noise_riser, 'downlifter': downlifter, 'impact': impact,
}
