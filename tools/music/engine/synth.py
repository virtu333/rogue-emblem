"""Synthesized voices for what samples don't cover: sub weight, pads,
the Unlight drone, the thread shimmer, risers and cinematic booms.

Each voice renders a list of NoteEvent-like tuples (t, dur, key, vel) into a
stereo buffer.
"""

from __future__ import annotations

import math

import numpy as np
from scipy import signal

from .dsp import SR
from .theory import hz


def _adsr(n, a, d, s, r, hold):
    """Envelope of n frames: attack a, decay d to level s, hold frames, release r (sec)."""
    A, D, R = int(a * SR), int(d * SR), int(r * SR)
    env = np.zeros(n, np.float32)
    i = 0
    seg = min(A, n)
    env[:seg] = np.linspace(0, 1, seg, endpoint=False) if seg else 0
    i = seg
    seg = min(D, n - i)
    if seg > 0:
        env[i:i + seg] = 1 - (1 - s) * (1 - np.exp(-5 * np.linspace(0, 1, seg)))
        i += seg
    hold_end = min(n, max(i, hold))
    if hold_end > i:
        env[i:hold_end] = s if D else 1.0
        i = hold_end
    last = env[i - 1] if i > 0 else 0
    seg = min(R, n - i)
    if seg > 0:
        env[i:i + seg] = last * np.exp(-6 * np.linspace(0, 1, seg))
    return env


def _poly_saw(phase):
    return 2 * (phase % 1.0) - 1


def _place(out, buf, start):
    end = min(len(out), start + len(buf))
    if end > start >= 0:
        out[start:end] += buf[: end - start]


def sub(events, n_frames, rng, attack=0.01, release=0.25, drive=1.2):
    out = np.zeros((n_frames, 2), np.float32)
    for t, dur, key, vel in events:
        n = int((dur + release) * SR)
        f = hz(key)
        tt = np.arange(n) / SR
        x = np.sin(2 * np.pi * f * tt)
        x = np.tanh(drive * x) / np.tanh(drive)
        env = _adsr(n, attack, 0.0, 1.0, release, int(dur * SR))
        y = (x * env * vel).astype(np.float32)
        _place(out, np.stack([y, y], 1), int(t * SR))
    return out


def pad(events, n_frames, rng, attack=1.2, release=2.0, cutoff=1800, detune=0.12,
        voices=5, brightness=1.0):
    """Warm supersaw pad through a gentle lowpass; wide stereo."""
    out = np.zeros((n_frames, 2), np.float32)
    sos = signal.butter(2, cutoff * brightness, 'low', fs=SR, output='sos')
    for t, dur, key, vel in events:
        n = int((dur + release) * SR)
        tt = np.arange(n) / SR
        f = hz(key)
        acc = np.zeros((n, 2))
        for v in range(voices):
            dt = (v - (voices - 1) / 2) / max(1, (voices - 1) / 2) * detune  # semitones
            fv = f * 2 ** (dt / 12)
            ph = rng.random()
            w = _poly_saw(ph + fv * tt)
            pan = (v / max(1, voices - 1)) * 2 - 1
            acc[:, 0] += w * math.cos((pan + 1) * math.pi / 4)
            acc[:, 1] += w * math.sin((pan + 1) * math.pi / 4)
        acc = signal.sosfilt(sos, acc, axis=0) / voices
        env = _adsr(n, attack, 0.3, 0.85, release, int(dur * SR))
        _place(out, (acc * env[:, None] * vel).astype(np.float32), int(t * SR))
    return out


def shimmer(events, n_frames, rng, attack=0.8, release=2.5, vibrato=0.08):
    """The thread: a pure, slightly breathing high tone (sine + soft 2nd/3rd)."""
    out = np.zeros((n_frames, 2), np.float32)
    for t, dur, key, vel in events:
        n = int((dur + release) * SR)
        tt = np.arange(n) / SR
        f = hz(key)
        vib = 1 + vibrato / 100 * np.sin(2 * np.pi * 4.8 * tt + rng.random() * 6) \
            * np.clip(tt / 1.2, 0, 1)
        ph = 2 * np.pi * np.cumsum(f * vib) / SR
        x = np.sin(ph) + 0.18 * np.sin(2 * ph + 0.3) + 0.05 * np.sin(3 * ph + 1.1)
        env = _adsr(n, attack, 0.0, 1.0, release, int(dur * SR))
        y = x * env * vel * 0.5
        l = y * (1 + 0.15 * np.sin(2 * np.pi * 0.13 * tt))
        r = y * (1 - 0.15 * np.sin(2 * np.pi * 0.13 * tt))
        _place(out, np.stack([l, r], 1).astype(np.float32), int(t * SR))
    return out


def drone(events, n_frames, rng, release=4.0, beat_hz=0.7, grit=0.35):
    """Unlight: detuned low saws and a formant hum, slowly beating and
    drifting flat, with a filtered noise bed. For the Entity."""
    out = np.zeros((n_frames, 2), np.float32)
    for t, dur, key, vel in events:
        n = int((dur + release) * SR)
        tt = np.arange(n) / SR
        f = hz(key)
        drift = 2 ** (-0.35 * np.clip(tt / max(dur, 1), 0, 1) / 12)
        acc = np.zeros((n, 2))
        for i, (det, pan) in enumerate([(-0.07, -0.8), (0.0, 0.0), (0.09, 0.8), (-12.03, 0.2)]):
            fv = f * 2 ** (det / 12) * drift
            ph = np.cumsum(fv) / SR + rng.random()
            w = _poly_saw(ph)
            acc[:, 0] += w * (1 - pan) / 2
            acc[:, 1] += w * (1 + pan) / 2
        sos = signal.butter(2, [f * 1.5, f * 9], 'band', fs=SR, output='sos')
        acc = signal.sosfilt(sos, acc, axis=0)
        noise = rng.standard_normal((n, 2))
        nsos = signal.butter(2, [80, 900], 'band', fs=SR, output='sos')
        acc += grit * signal.sosfilt(nsos, noise, axis=0) * 0.3
        am = 1 + 0.35 * np.sin(2 * np.pi * beat_hz * tt)
        env = _adsr(n, 2.5, 0.0, 1.0, release, int(dur * SR))
        _place(out, (acc * (env * am * vel)[:, None] * 0.6).astype(np.float32), int(t * SR))
    return out


def boom(events, n_frames, rng, length=2.5):
    """Cinematic low hit: pitch-dropping sine + noise burst."""
    out = np.zeros((n_frames, 2), np.float32)
    for t, dur, key, vel in events:
        n = int(length * SR)
        tt = np.arange(n) / SR
        f0 = hz(key)
        f = f0 * (1 + 1.8 * np.exp(-tt * 18))
        ph = 2 * np.pi * np.cumsum(f) / SR
        body = np.sin(ph) * np.exp(-tt * 1.6)
        body = np.tanh(1.8 * body)
        noise = rng.standard_normal(n) * np.exp(-tt * 14)
        noise = signal.sosfilt(signal.butter(2, 900, 'low', fs=SR, output='sos'), noise)
        y = (body + 0.5 * noise) * vel
        _place(out, np.stack([y, y], 1).astype(np.float32), int(t * SR))
    return out


def riser(events, n_frames, rng):
    """Noise swell whose band rises across the note; ends exactly at note end."""
    out = np.zeros((n_frames, 2), np.float32)
    for t, dur, key, vel in events:
        n = int(dur * SR)
        noise = rng.standard_normal((n, 2))
        tt = np.linspace(0, 1, n)
        y = np.zeros((n, 2))
        blocks = 64
        edges = np.linspace(0, n, blocks + 1).astype(int)
        zi = None
        for b in range(blocks):
            a0, a1 = edges[b], edges[b + 1]
            fc = 200 * (40 ** (b / blocks))
            sos = signal.butter(2, [fc * 0.7, min(fc * 1.6, SR * 0.45)], 'band', fs=SR, output='sos')
            if zi is None:
                zi = np.zeros((sos.shape[0], 2, 2))
            seg, zi = signal.sosfilt(sos, noise[a0:a1], axis=0, zi=zi)
            y[a0:a1] = seg
        env = tt ** 2.2
        _place(out, (y * env[:, None] * vel * 1.5).astype(np.float32), int(t * SR))
    return out


def reverse_swell(events, n_frames, rng):
    """Reversed decaying tone cluster (a reverse cymbal-like swell)."""
    out = np.zeros((n_frames, 2), np.float32)
    for t, dur, key, vel in events:
        n = int(dur * SR)
        tt = np.arange(n) / SR
        noise = rng.standard_normal((n, 2))
        sos = signal.butter(2, [3000, 14000], 'band', fs=SR, output='sos')
        y = signal.sosfilt(sos, noise, axis=0) * np.exp(-tt * 3.5)[:, None]
        y = y[::-1] * vel
        _place(out, y.astype(np.float32), int(t * SR))
    return out


VOICES = {
    'sub': sub, 'pad': pad, 'shimmer': shimmer, 'drone': drone,
    'boom': boom, 'riser': riser, 'reverse': reverse_swell,
}
