"""DSP building blocks: filters, dynamics, reverb impulse responses, loudness.

All audio is float32/float64 numpy, stereo arrays shaped (n, 2), 44.1 kHz.
"""

from __future__ import annotations

import math

import numpy as np
from numba import njit
from scipy import signal

SR = 44100


# ------------------------------------------------------------------ biquads
def _sos(b, a):
    b = np.asarray(b, float) / a[0]
    a = np.asarray(a, float) / a[0]
    return np.concatenate([b, a])[None, :]


def biquad(kind: str, f0: float, q: float = 0.707, gain_db: float = 0.0, sr: int = SR):
    """RBJ cookbook biquad as an SOS row."""
    A = 10 ** (gain_db / 40)
    w0 = 2 * math.pi * min(f0, sr * 0.49) / sr
    cw, sw = math.cos(w0), math.sin(w0)
    alpha = sw / (2 * q)
    if kind == 'lowpass':
        b = [(1 - cw) / 2, 1 - cw, (1 - cw) / 2]
        a = [1 + alpha, -2 * cw, 1 - alpha]
    elif kind == 'highpass':
        b = [(1 + cw) / 2, -(1 + cw), (1 + cw) / 2]
        a = [1 + alpha, -2 * cw, 1 - alpha]
    elif kind == 'bandpass':
        b = [alpha, 0, -alpha]
        a = [1 + alpha, -2 * cw, 1 - alpha]
    elif kind == 'peak':
        b = [1 + alpha * A, -2 * cw, 1 - alpha * A]
        a = [1 + alpha / A, -2 * cw, 1 - alpha / A]
    elif kind == 'lowshelf':
        sq = 2 * math.sqrt(A) * alpha
        b = [A * ((A + 1) - (A - 1) * cw + sq), 2 * A * ((A - 1) - (A + 1) * cw),
             A * ((A + 1) - (A - 1) * cw - sq)]
        a = [(A + 1) + (A - 1) * cw + sq, -2 * ((A - 1) + (A + 1) * cw),
             (A + 1) + (A - 1) * cw - sq]
    elif kind == 'highshelf':
        sq = 2 * math.sqrt(A) * alpha
        b = [A * ((A + 1) + (A - 1) * cw + sq), -2 * A * ((A - 1) + (A + 1) * cw),
             A * ((A + 1) + (A - 1) * cw - sq)]
        a = [(A + 1) - (A - 1) * cw + sq, 2 * ((A - 1) - (A + 1) * cw),
             (A + 1) - (A - 1) * cw - sq]
    else:
        raise ValueError(kind)
    return _sos(b, a)


def eq(x: np.ndarray, bands) -> np.ndarray:
    """bands: list of (kind, f0, q, gain_db). Zero-latency IIR."""
    if not bands:
        return x
    sos = np.concatenate([biquad(k, f, q, g) for k, f, q, g in bands])
    return signal.sosfilt(sos, x, axis=0).astype(np.float32)


def lowpass(x, f0, order=2):
    sos = signal.butter(order, min(f0, SR * 0.45), 'low', fs=SR, output='sos')
    return signal.sosfilt(sos, x, axis=0)


def highpass(x, f0, order=2):
    sos = signal.butter(order, f0, 'high', fs=SR, output='sos')
    return signal.sosfilt(sos, x, axis=0)


# ------------------------------------------------------------------ gain lanes
def lane(points_sec, n: int, default: float = 1.0) -> np.ndarray:
    """Piecewise-linear automation sampled per audio frame."""
    if not points_sec:
        return np.full(n, default, np.float32)
    xs = np.array([p[0] for p in points_sec]) * SR
    ys = np.array([p[1] for p in points_sec])
    return np.interp(np.arange(n), xs, ys).astype(np.float32)


@njit(cache=True)
def _tv_onepole(x, cutoff, sr):
    """Time-varying one-pole lowpass per channel; cutoff per frame (Hz)."""
    n, ch = x.shape
    y = np.empty_like(x)
    z = np.zeros(ch)
    for i in range(n):
        a = math.exp(-2.0 * math.pi * cutoff[i] / sr)
        for c in range(ch):
            z[c] = (1.0 - a) * x[i, c] + a * z[c]
            y[i, c] = z[c]
    return y


def dynamic_tone(x: np.ndarray, expr: np.ndarray, lo_hz=1400.0, hi_hz=18000.0,
                 amount=1.0) -> np.ndarray:
    """Darken quiet passages: cutoff rises with expression (0..1), two poles."""
    e = np.clip(expr, 0, 1) ** 0.8
    cutoff = lo_hz * (hi_hz / lo_hz) ** (1 - amount + amount * e)
    y = _tv_onepole(x.astype(np.float64), cutoff.astype(np.float64), SR)
    y = _tv_onepole(y, cutoff.astype(np.float64), SR)
    return y.astype(np.float32)


# ------------------------------------------------------------------ dynamics
@njit(cache=True)
def _env_follow(level, att, rel):
    n = level.shape[0]
    out = np.empty(n)
    e = 0.0
    for i in range(n):
        v = level[i]
        if v > e:
            e = att * e + (1 - att) * v
        else:
            e = rel * e + (1 - rel) * v
        out[i] = e
    return out


def compress(x: np.ndarray, thresh_db=-18.0, ratio=2.0, attack_ms=20.0, release_ms=200.0,
             knee_db=6.0, makeup_db=0.0, sidechain: np.ndarray | None = None,
             mix: float = 1.0) -> np.ndarray:
    """Feed-forward RMS-ish stereo-linked compressor."""
    sc = x if sidechain is None else sidechain
    level = np.sqrt(np.mean(sc.astype(np.float64) ** 2, axis=1) + 1e-12)
    att = math.exp(-1.0 / (SR * attack_ms / 1000))
    rel = math.exp(-1.0 / (SR * release_ms / 1000))
    env = _env_follow(level * 1.414, att, rel)
    lvl_db = 20 * np.log10(env + 1e-9)
    over = lvl_db - thresh_db
    # soft knee
    gr = np.where(over <= -knee_db / 2, 0.0,
                  np.where(over >= knee_db / 2, over * (1 - 1 / ratio),
                           (1 - 1 / ratio) * (over + knee_db / 2) ** 2 / (2 * knee_db)))
    g = 10 ** ((-gr + makeup_db) / 20)
    y = x * g[:, None].astype(np.float32)
    if mix < 1.0:
        y = mix * y + (1 - mix) * x
    return y.astype(np.float32)


@njit(cache=True)
def _release(hold, rel):
    out = np.empty_like(hold)
    cur = 1.0
    for i in range(hold.shape[0]):
        target = hold[i]
        if target < cur:
            cur = target
        else:
            cur = rel * cur + (1 - rel) * target
        out[i] = cur
    return out


def limit(x: np.ndarray, ceiling_db=-1.0, lookahead_ms=4.0, release_ms=90.0) -> np.ndarray:
    """Lookahead brickwall limiter on 4x-oversampled (true) peaks.

    Gain = box-average(release(hold-min(need))) over L samples, applied to audio
    delayed by L-1. Every term of the average is <= the need of the sample it
    lands on, so the ceiling holds; the output is re-aligned (no net delay).
    """
    from scipy.ndimage import minimum_filter1d

    ceiling = 10 ** (ceiling_db / 20) * 0.99
    L = max(8, int(SR * lookahead_ms / 1000))
    up = signal.resample_poly(x.astype(np.float64), 4, 1, axis=0)
    tp = np.abs(up).max(axis=1)
    tp = tp[: (len(tp) // 4) * 4].reshape(-1, 4).max(axis=1)
    if len(tp) < len(x):
        tp = np.pad(tp, (0, len(x) - len(tp)))
    tp = tp[: len(x)]
    need = np.minimum(1.0, ceiling / np.maximum(tp, 1e-9))
    # backward-looking hold: hold[i] = min(need[i-L+1 .. i])
    hold = minimum_filter1d(need, size=L, origin=(L - 1) // 2, mode='nearest')
    rel = math.exp(-1.0 / (SR * release_ms / 1000))
    r = _release(hold, rel)
    c = np.cumsum(np.concatenate([np.ones(L), r]))
    box = (c[L:] - c[:-L]) / L
    # audio delayed by L-1 -> advance gain instead: y[k] = x[k] * box[k+L-1]
    g = np.concatenate([box[L - 1:], np.full(L - 1, box[-1])])
    return (x * g[:, None]).astype(np.float32)


def soft_clip(x, drive=1.0):
    return np.tanh(x * drive) / np.tanh(drive)


# ------------------------------------------------------------------ reverb
def make_ir(rt60=2.2, length=None, predelay_ms=18.0, damp_hi=0.45, width=1.0,
            er_taps=10, er_level=0.5, seed=7, brightness=1.0, bass_ratio=1.15):
    """Synthetic stereo hall IR: early reflections + banded exponential tail.

    Each octave band decays with its own RT60 (lows longer, highs shorter),
    which is what makes a synthetic tail sound like a room and not noise.
    """
    rng = np.random.default_rng(seed)
    length = length or rt60 * 1.35
    n = int(length * SR)
    pre = int(predelay_ms / 1000 * SR)
    ir = np.zeros((n + pre, 2))
    t = np.arange(n) / SR
    centers = [63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]
    tail = np.zeros((n, 2))
    for fc in centers:
        noise = rng.standard_normal((n, 2))
        lo, hi = fc / math.sqrt(2), min(fc * math.sqrt(2), SR * 0.45)
        sos = signal.butter(2, [lo, hi], 'band', fs=SR, output='sos')
        band = signal.sosfilt(sos, noise, axis=0)
        # frequency dependent RT60
        if fc <= 250:
            rt = rt60 * bass_ratio
        else:
            rt = rt60 * (1 - damp_hi * math.log2(fc / 250) / math.log2(16000 / 250))
        rt = max(rt, 0.15)
        env = np.exp(-6.91 * t / rt)
        gain = 1.0
        if fc >= 4000:
            gain = brightness * (0.7 if fc == 4000 else 0.5 if fc == 8000 else 0.3)
        tail += band * env[:, None] * gain
    # smooth onset of the diffuse tail
    fade_in = np.clip(t / 0.06, 0, 1) ** 1.5
    tail *= fade_in[:, None]
    # decorrelate / width
    mid = (tail[:, 0] + tail[:, 1]) / 2
    side = (tail[:, 0] - tail[:, 1]) / 2 * width
    tail = np.stack([mid + side, mid - side], axis=1)
    tail /= np.sqrt(np.sum(tail ** 2) / 2) + 1e-12
    ir[pre:] += tail
    # early reflections
    for k in range(er_taps):
        d = pre + int(rng.uniform(0.004, 0.075) * SR)
        amp = er_level * (0.85 ** k) * rng.uniform(0.5, 1.0) * 0.08
        ch = k % 2
        if d < len(ir):
            ir[d, ch] += amp * (1 if rng.random() > 0.3 else -1)
            ir[min(len(ir) - 1, d + int(rng.uniform(1, 8) * SR / 1000)), 1 - ch] += amp * 0.6
    return ir.astype(np.float32)


def convolve(x: np.ndarray, ir: np.ndarray) -> np.ndarray:
    """Stereo in -> stereo out, true-stereo-lite (L->L, R->R with mirrored IR)."""
    yl = signal.oaconvolve(x[:, 0], ir[:, 0])[: len(x)]
    yr = signal.oaconvolve(x[:, 1], ir[:, 1])[: len(x)]
    # cross-feed a little so hard-panned sources still bloom on both sides
    yl2 = signal.oaconvolve(x[:, 1], ir[:, 0])[: len(x)]
    yr2 = signal.oaconvolve(x[:, 0], ir[:, 1])[: len(x)]
    return np.stack([yl + 0.35 * yl2, yr + 0.35 * yr2], axis=1).astype(np.float32)


# ------------------------------------------------------------------ stereo
def pan_stereo(x: np.ndarray, pan: float, width: float = 1.0) -> np.ndarray:
    """Pan a stereo signal: narrow it by width, then place its center at pan."""
    mid = (x[:, 0] + x[:, 1]) * 0.5
    side = (x[:, 0] - x[:, 1]) * 0.5 * width
    l, r = mid + side, mid - side
    theta = (pan + 1) * math.pi / 4
    gl, gr = math.cos(theta) * math.sqrt(2), math.sin(theta) * math.sqrt(2)
    # keep some of the opposite channel so pans stay natural
    return np.stack([l * gl, r * gr], axis=1).astype(np.float32)


def haas(x: np.ndarray, ms: float) -> np.ndarray:
    """Delay one channel by a few ms (positive: delay right)."""
    d = int(abs(ms) / 1000 * SR)
    if d == 0:
        return x
    y = x.copy()
    ch = 1 if ms > 0 else 0
    y[d:, ch] = x[:-d, ch]
    y[:d, ch] = 0
    return y


# ------------------------------------------------------------------ loudness
def lufs(x: np.ndarray) -> float:
    import pyloudnorm as pyln
    meter = pyln.Meter(SR)
    return float(meter.integrated_loudness(x.astype(np.float64)))


def db(x):
    return 20 * math.log10(max(x, 1e-12))


def undb(d):
    return 10 ** (d / 20)
