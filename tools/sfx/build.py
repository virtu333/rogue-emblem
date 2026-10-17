#!/usr/bin/env python3
"""Synthesize the game's coded sound effects to assets/audio/sfx/.

  python3 tools/sfx/build.py                 # every cue
  python3 tools/sfx/build.py sfx_miss sfx_turn   # some cues
  python3 tools/sfx/build.py --list          # the cues and what each one is
  python3 tools/sfx/build.py --wav DIR       # also keep the 16-bit WAVs in DIR

Each cue is one small function below that returns a mono float signal at 44.1 kHz.
Everything is deterministic: a cue draws its noise from its own fixed numpy seed, so a
rebuild writes the same samples (and, with the same ffmpeg, the same MP3 bytes).

The set shares one voice: plain sines, inharmonic metal and band-passed noise, a gentle
top-end roll-off (the SNES's 32 kHz samples never had much air) and no effects. The
finishing step is the same for every cue (`finish`): a DC block, a click-free fade at
each end, then the cue's loudness (its loudest 400 ms, K-weighted, as BS.1770 measures),
with at least 3 dB of peak headroom. The MP3 matches the shipping sfx files: 44.1 kHz
mono, LAME VBR (-q:a 4). After encoding, the MP3 is decoded again and checked: peak,
loudness, length, DC, silent ends.

Needs numpy and ffmpeg (with libmp3lame). Then run `npm run sync-assets` and
`npm run build:audio` (the hashed audio manifest; `npm run check:audio` fails while it
is stale).
"""

from __future__ import annotations

import argparse
import math
import os
import subprocess
import sys
import tempfile
import wave

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(ROOT, 'assets', 'audio', 'sfx')
SR = 44100
MP3_QUALITY = 4  # LAME VBR, as the shipping sfx and the music (tools/music/engine/render.py)


# ── building blocks ──────────────────────────────────────────────────────────

def t_axis(seconds: float) -> np.ndarray:
    return np.arange(int(round(seconds * SR))) / SR


def silence(seconds: float) -> np.ndarray:
    return np.zeros(int(round(seconds * SR)))


def place(dest: np.ndarray, sig: np.ndarray, at: float, gain: float = 1.0) -> np.ndarray:
    """Mix `sig` into `dest` starting at `at` seconds (clipped to dest's length)."""
    i = int(round(at * SR))
    n = max(0, min(len(sig), len(dest) - i))
    dest[i:i + n] += gain * sig[:n]
    return dest


def exp_decay(t: np.ndarray, seconds: float) -> np.ndarray:
    """Amplitude falling 60 dB over `seconds` (an RT60)."""
    return np.exp(-6.907755 * t / seconds)


def attack(t: np.ndarray, seconds: float) -> np.ndarray:
    """A raised-cosine rise over `seconds`, then 1."""
    if seconds <= 0:
        return np.ones_like(t)
    x = np.clip(t / seconds, 0, 1)
    return 0.5 - 0.5 * np.cos(np.pi * x)


def bell_curve(t: np.ndarray, peak_at: float, rise: float, fall: float) -> np.ndarray:
    """An asymmetric hump: raised-cosine up to `peak_at`, exponential-ish down after."""
    up = attack(t - (peak_at - rise), rise)
    down = np.where(t <= peak_at, 1.0, np.exp(-((t - peak_at) / fall) ** 2))
    return up * down


def partial(t: np.ndarray, freq: float, decay: float, amp: float = 1.0,
            phase: float = 0.0) -> np.ndarray:
    return amp * np.sin(2 * np.pi * freq * t + phase) * exp_decay(t, decay)


def glide(t: np.ndarray, f0: float, f1: float) -> np.ndarray:
    """A sine whose pitch moves exponentially from f0 to f1 over t's span."""
    span = max(t[-1], 1e-9)
    freq = f0 * (f1 / f0) ** (t / span)
    return np.sin(2 * np.pi * np.cumsum(freq) / SR)


def svf(x: np.ndarray, cutoff, q: float = 0.707, mode: str = 'bp') -> np.ndarray:
    """A state-variable filter (TPT form), cutoff fixed or one value per sample.

    mode: 'lp', 'bp' (unity peak gain) or 'hp'.
    """
    n = len(x)
    fc = np.broadcast_to(np.asarray(cutoff, dtype=float), (n,))
    g = np.tan(np.pi * np.clip(fc, 10.0, SR * 0.45) / SR)
    k = 1.0 / q
    a1 = 1.0 / (1.0 + g * (g + k))
    a2 = g * a1
    a3 = g * a2
    ic1 = ic2 = 0.0
    out = np.empty(n)
    for i in range(n):
        v3 = x[i] - ic2
        v1 = a1[i] * ic1 + a2[i] * v3
        v2 = ic2 + a2[i] * ic1 + a3[i] * v3
        ic1 = 2 * v1 - ic1
        ic2 = 2 * v2 - ic2
        if mode == 'lp':
            out[i] = v2
        elif mode == 'hp':
            out[i] = x[i] - k * v1 - v2
        else:
            out[i] = k * v1
    return out


def one_pole_lp(x: np.ndarray, cutoff: float) -> np.ndarray:
    a = math.exp(-2 * math.pi * cutoff / SR)
    out = np.empty_like(x)
    y = 0.0
    for i, v in enumerate(x):
        y = (1 - a) * v + a * y
        out[i] = y
    return out


def dc_block(x: np.ndarray, cutoff: float = 20.0) -> np.ndarray:
    r = math.exp(-2 * math.pi * cutoff / SR)
    out = np.empty_like(x)
    prev_x = prev_y = 0.0
    for i, v in enumerate(x):
        prev_y = v - prev_x + r * prev_y
        prev_x = v
        out[i] = prev_y
    return out


def noise(rng: np.random.Generator, seconds: float) -> np.ndarray:
    return rng.uniform(-1.0, 1.0, int(round(seconds * SR)))


def metal(t: np.ndarray, base: float, ratios, decays, amps) -> np.ndarray:
    """A struck piece of metal: inharmonic modes, each with its own ring."""
    out = np.zeros_like(t)
    for ratio, decay, amp in zip(ratios, decays, amps):
        out += partial(t, base * ratio, decay, amp, phase=ratio)  # fixed, non-zero phases
    return out


COIN_RATIOS = (1.0, 1.47, 2.09, 2.76)


def coin(t: np.ndarray, base: float, ring: float = 0.07) -> np.ndarray:
    """One small coin tick: a bright inharmonic ping with a noise-free hard edge."""
    return metal(t, base, COIN_RATIOS, (ring, ring * 0.8, ring * 0.6, ring * 0.45),
                 (1.0, 0.7, 0.45, 0.3))


def bell(t: np.ndarray, f0: float, ring: float, ratios, amps, beat: float = 0.0) -> np.ndarray:
    """A bell: partials that ring shorter the higher they sit; `beat` Hz of shimmer."""
    out = np.zeros_like(t)
    for ratio, amp in zip(ratios, amps):
        f = f0 * ratio
        decay = ring / (0.6 + 0.4 * ratio)
        tone = np.sin(2 * np.pi * f * t + ratio)
        if beat:
            tone = 0.5 * (tone + np.sin(2 * np.pi * (f + beat * ratio) * t + 2 * ratio))
        out += amp * tone * exp_decay(t, decay)
    return out


def snes_air(x: np.ndarray) -> np.ndarray:
    """The set's gentle top roll-off (a 32 kHz sampler's missing air)."""
    return svf(x, 12500.0, 0.6, 'lp')


def db(value: float) -> float:
    return 10 ** (value / 20)


def biquad(x: np.ndarray, b, a) -> np.ndarray:
    b0, b1, b2 = b
    _, a1, a2 = a
    out = np.empty_like(x)
    x1 = x2 = y1 = y2 = 0.0
    for i, v in enumerate(x):
        y = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
        x2, x1, y2, y1 = x1, v, y1, y
        out[i] = y
    return out


def k_weight(x: np.ndarray) -> np.ndarray:
    """ITU-R BS.1770 K-weighting: the head's high shelf, then the low cut."""
    k = math.tan(math.pi * 1681.974450955533 / SR)
    vh = 10 ** (3.999843853973347 / 20)
    vb = vh ** 0.4996667741545416
    q = 0.7071752369554196
    a0 = 1 + k / q + k * k
    shelf_b = ((vh + vb * k / q + k * k) / a0, 2 * (k * k - vh) / a0,
               (vh - vb * k / q + k * k) / a0)
    shelf_a = (1.0, 2 * (k * k - 1) / a0, (1 - k / q + k * k) / a0)
    k = math.tan(math.pi * 38.13547087602444 / SR)
    q = 0.5003270373238773
    a0 = 1 + k / q + k * k
    hp_a = (1.0, 2 * (k * k - 1) / a0, (1 - k / q + k * k) / a0)
    return biquad(biquad(x, shelf_b, shelf_a), (1.0, -2.0, 1.0), hp_a)


def momentary_max(x: np.ndarray) -> float:
    """The loudest 400 ms window (LUFS, momentary): how loud a short cue sounds."""
    y = k_weight(np.concatenate([x, np.zeros(int(0.4 * SR))])) ** 2
    win, hop = int(0.4 * SR), int(0.1 * SR)
    sums = np.concatenate([[0.0], np.cumsum(y)])
    starts = np.arange(0, len(y) - win + 1, hop)
    power = (sums[starts + win] - sums[starts]) / win
    return -0.691 + 10 * math.log10(max(float(np.max(power)), 1e-12))


def soften(x: np.ndarray, drive: float) -> np.ndarray:
    """Gentle saturation: rounds off a ping's first spike so it reads as loud as it peaks."""
    if drive <= 0:
        return x
    peak = np.max(np.abs(x)) or 1.0
    return np.tanh(drive * x / peak) / math.tanh(drive)


PEAK_CEILING_DB = -3.0  # every cue keeps this much headroom (the loudest shipping sfx: -2.8)


def finish(x: np.ndarray, loudness: float, fade_in: float = 0.002,
           fade_out: float = 0.02) -> np.ndarray:
    """DC block, click-free ends, zero mean, then the cue's loudness (momentary max, LUFS)."""
    x = dc_block(np.asarray(x, dtype=float))
    t = np.arange(len(x)) / SR
    x = x * attack(t, fade_in)
    x = x * attack(t[::-1], fade_out)
    # A short transient keeps a net area the DC block has no time to remove: take it out
    # under a window as long as the cue (a bump far below hearing, ends still at zero).
    w = np.hanning(len(x))
    x = x - np.mean(x) * w / np.mean(w)
    if not np.max(np.abs(x)) > 0:
        raise ValueError('silent cue')
    return x * db(loudness - momentary_max(x))


# ── the cues ─────────────────────────────────────────────────────────────────
# Each returns (signal, loudness): the loudest 400 ms in LUFS (`momentary_max`), which is how
# loud a short cue sounds. The shipping sfx measure: weapons -25..-26, hit -23, crit -20,
# cursor -21, confirm -15, gold -16, cancel -28, heal -21. Combat cues sit by the hits,
# the coin and bell cues by gold and heal, the menu whooshes far under every blip.

def sfx_miss():
    """A blade cutting air: band-passed noise sweeping up past the ear and away."""
    rng = np.random.default_rng(101)
    dur = 0.34
    t = t_axis(dur)
    sweep = 520 * (3200 / 520) ** np.clip(t / 0.15, 0, 1)  # up as it passes
    sweep = np.where(t > 0.15, 3200 * (900 / 3200) ** np.clip((t - 0.15) / 0.19, 0, 1), sweep)
    air = svf(noise(rng, dur), sweep, 1.8, 'bp')
    body = svf(noise(rng, dur), sweep * 0.5, 1.2, 'bp') * 0.5
    env = bell_curve(t, 0.11, 0.1, 0.09)
    return snes_air((air + body) * env), -23.0


def sfx_nodamage():
    """A dull clank: a blow turned by armour, short inharmonic modes and a muffled thud."""
    rng = np.random.default_rng(102)
    dur = 0.26
    t = t_axis(dur)
    clank = metal(t, 610.0, (1.0, 1.93, 2.71, 3.58, 4.62),
                  (0.16, 0.11, 0.08, 0.06, 0.045), (1.0, 0.55, 0.42, 0.28, 0.18))
    thud = partial(t, 170.0, 0.06, 0.9) + partial(t, 260.0, 0.05, 0.4)
    tick = svf(noise(rng, dur), 3200.0, 1.4, 'bp') * exp_decay(t, 0.012) * 0.8
    sig = svf(clank * 0.8 + thud + tick, 3800.0, 0.7, 'lp')  # dulled: no ring above 4 kHz
    return soften(sig, 2.2), -25.0


def sfx_shatter():
    """A Revival Stone breaking: an impact, a glassy crack, then shards falling and ringing."""
    rng = np.random.default_rng(103)
    dur = 0.95
    t = t_axis(dur)
    sig = np.zeros_like(t)
    # the crack: bright noise, gone in a breath
    crack = svf(noise(rng, dur), 5200.0, 0.9, 'hp') * exp_decay(t, 0.09)
    sig += crack * 0.9
    sig += svf(noise(rng, dur), 1400.0, 1.0, 'bp') * exp_decay(t, 0.05) * 0.6
    sig += partial(t, 120.0, 0.08, 0.7)  # the stone's own thump
    # the stone's glassy ring: inharmonic, bright, a little long
    sig += metal(t, 1975.0, (1.0, 1.58, 2.13, 2.87, 3.41),
                 (0.55, 0.42, 0.33, 0.25, 0.2), (0.5, 0.42, 0.34, 0.26, 0.2))
    # shards: tiny pings scattered over the first half second, thinning out
    shard_t = t_axis(0.12)
    for i in range(22):
        at = 0.02 + 0.5 * (rng.random() ** 1.7)
        f = rng.uniform(2600.0, 7200.0)
        ring = rng.uniform(0.04, 0.12)
        amp = rng.uniform(0.15, 0.4) * (1 - at)
        ping = partial(shard_t, f, ring, 1.0) + partial(shard_t, f * 1.51, ring * 0.6, 0.4)
        place(sig, ping, at, amp)
    return snes_air(soften(sig, 1.2)), -23.0


def sfx_purchase():
    """Coins into a purse: a soft pouch thump, then a few coins settling."""
    rng = np.random.default_rng(104)
    dur = 0.5
    sig = silence(dur)
    pouch = svf(noise(rng, 0.08), 380.0, 1.0, 'bp') * exp_decay(t_axis(0.08), 0.05)
    place(sig, pouch, 0.0, 0.8)
    coin_t = t_axis(0.2)
    for at, base, amp in ((0.012, 3120.0, 1.0), (0.068, 3480.0, 0.8), (0.112, 2960.0, 0.7),
                          (0.15, 3790.0, 0.55), (0.214, 3300.0, 0.45), (0.268, 3620.0, 0.3)):
        place(sig, coin(coin_t, base, 0.09), at, amp)
    return snes_air(soften(sig, 2.5)), -20.0


def sfx_equip():
    """Gear taken in hand: a short leather slide, then a metal catch."""
    rng = np.random.default_rng(105)
    dur = 0.24
    sig = silence(dur)
    slide_t = t_axis(0.09)
    slide = svf(noise(rng, 0.09), 1300 * (3600 / 1300) ** (slide_t / 0.09), 1.6, 'bp')
    place(sig, slide * bell_curve(slide_t, 0.05, 0.045, 0.03), 0.0, 0.45)
    click_t = t_axis(0.14)
    click = (partial(click_t, 2750.0, 0.035, 1.0) + partial(click_t, 4480.0, 0.025, 0.6)
             + partial(click_t, 1180.0, 0.05, 0.5))
    click += svf(noise(rng, 0.14), 4000.0, 1.2, 'bp') * exp_decay(click_t, 0.006) * 0.9
    place(sig, click, 0.085, 1.0)
    return snes_air(soften(sig, 2.0)), -25.0


def _paper_whoosh(seed: int, rising: bool):
    rng = np.random.default_rng(seed)
    dur = 0.2
    t = t_axis(dur)
    lo, hi = 650.0, 2400.0
    a, b = (lo, hi) if rising else (hi, lo)
    sweep = a * (b / a) ** (t / dur)
    air = svf(noise(rng, dur), sweep, 1.1, 'bp')
    # rising: swells and stops; falling: starts full and settles
    env = bell_curve(t, 0.13, 0.12, 0.035) if rising else bell_curve(t, 0.035, 0.03, 0.09)
    tone = glide(t, 520.0, 780.0) if rising else glide(t, 780.0, 520.0)
    return snes_air(air * env + tone * env * 0.06)


def sfx_menu_open():
    """A menu opening: a soft paper whoosh, upward. Very quiet."""
    return _paper_whoosh(106, rising=True), -30.0


def sfx_menu_close():
    """A menu closing: the same paper whoosh, downward. Very quiet."""
    return _paper_whoosh(107, rising=False), -31.0


def sfx_steal():
    """A quick swipe and a small jingle as the item changes hands."""
    rng = np.random.default_rng(108)
    dur = 0.46
    sig = silence(dur)
    swipe_t = t_axis(0.11)
    swipe = svf(noise(rng, 0.11), 900 * (5200 / 900) ** (swipe_t / 0.11), 2.0, 'bp')
    place(sig, swipe * bell_curve(swipe_t, 0.06, 0.055, 0.03), 0.0, 0.9)
    coin_t = t_axis(0.2)
    for at, base, amp in ((0.1, 4150.0, 0.7), (0.152, 4620.0, 0.55), (0.205, 4380.0, 0.4)):
        place(sig, coin(coin_t, base, 0.08), at, amp)
    return snes_air(soften(sig, 1.8)), -22.0


def sfx_turn():
    """A new phase: a soft, low bell on D, struck with a felt mallet.

    Low, but not below what a phone speaker can play: the strike tone is D4, the hum D3.
    """
    rng = np.random.default_rng(109)
    dur = 1.45
    t = t_axis(dur)
    f0 = 293.66  # D4 (the soundtrack's home key)
    # a church bell's partials (hum, prime, tierce, quint, nominal, upper), softly weighted
    body = bell(t, f0, 1.35, (0.5, 1.0, 1.19, 1.5, 2.0, 2.51, 3.01),
                (0.55, 1.0, 0.42, 0.3, 0.38, 0.12, 0.06), beat=0.6)
    mallet = svf(noise(rng, dur), 700.0, 0.9, 'bp') * exp_decay(t, 0.03) * 0.25
    sig = (body + mallet) * attack(t, 0.006)
    return svf(sig, 4500.0, 0.6, 'lp'), -23.0


def sfx_chime():
    """The church's bell: a bright chime on D, its fifth answering."""
    dur = 1.4
    t = t_axis(dur)
    ratios = (1.0, 2.0, 2.76, 4.07, 5.4)
    amps = (1.0, 0.35, 0.3, 0.12, 0.08)
    first = bell(t, 1174.66, 1.25, ratios, amps, beat=0.9)  # D6
    sig = first * attack(t, 0.002)
    second_t = t_axis(dur - 0.16)
    second = bell(second_t, 1760.0, 1.0, ratios, amps, beat=1.1) * attack(second_t, 0.002)  # A6
    place(sig, second, 0.16, 0.55)
    return snes_air(sig), -20.0


def sfx_loot():
    """A reward revealed: a little rising sparkle on a D major arpeggio."""
    rng = np.random.default_rng(111)
    dur = 0.72
    t = t_axis(dur)
    sig = np.zeros_like(t)
    note_t = t_axis(0.3)
    notes = (1174.66, 1479.98, 1760.0, 2349.32, 2959.96)  # D6 F#6 A6 D7 F#7
    for i, f in enumerate(notes):
        ping = (partial(note_t, f, 0.22, 1.0) + partial(note_t, f * 2.0, 0.12, 0.25)
                + partial(note_t, f * 3.01, 0.07, 0.1)) * attack(note_t, 0.002)
        place(sig, ping, 0.01 + i * 0.055, 0.55 + 0.1 * i)
    glitter = svf(noise(rng, dur), 7000.0, 0.8, 'hp') * bell_curve(t, 0.3, 0.26, 0.16) * 0.12
    return snes_air(sig + glitter), -20.0


def sfx_page():
    """A page turned: a short rustle and the flick of the leaf landing."""
    rng = np.random.default_rng(112)
    dur = 0.2
    t = t_axis(dur)
    rustle = svf(noise(rng, dur), 2600.0, 0.8, 'bp') * bell_curve(t, 0.07, 0.065, 0.03) * 0.5
    flick_t = t_axis(0.06)
    flick = svf(noise(rng, 0.06), 4200.0, 1.3, 'bp') * exp_decay(flick_t, 0.02)
    sig = rustle.copy()
    place(sig, flick, 0.095, 0.9)
    return snes_air(sig), -26.0


def sfx_ward_break():
    """A Voice's ward giving way: a glassy shimmer swells, then breaks downward into falling
    chimes, a soft rush of air under it. Brighter and more arcane than the stone's shatter."""
    rng = np.random.default_rng(113)
    dur = 1.05
    t = t_axis(dur)
    sig = np.zeros_like(t)
    # the swell: three detuned high partials rising in level for a breath
    swell_t = t_axis(0.16)
    swell_env = attack(swell_t, 0.14) * np.clip(1 - (swell_t - 0.14) / 0.02, 0, 1)
    swell = sum(np.sin(2 * np.pi * f * swell_t) for f in (2637.0, 2649.0, 3951.0)) * swell_env
    place(sig, swell, 0.0, 0.18)
    # the break: a bright crack and a falling glissando of chimes (E7 down an octave and more)
    crack_t = t_axis(0.2)
    crack = svf(noise(rng, 0.2), 6000.0, 0.9, 'hp') * exp_decay(crack_t, 0.04)
    place(sig, crack, 0.15, 0.7)
    chime_t = t_axis(0.5)
    steps = (2637.02, 2349.32, 1975.53, 1760.0, 1479.98, 1318.51)  # E7 D7 B6 A6 F#6 E6
    for i, f in enumerate(steps):
        ring = (partial(chime_t, f, 0.32, 1.0) + partial(chime_t, f * 2.76, 0.12, 0.3)
                + partial(chime_t, f * 5.4, 0.05, 0.12)) * attack(chime_t, 0.002)
        place(sig, ring, 0.16 + i * 0.07, 0.5 - 0.05 * i)
    # the air rushing out under it
    rush = svf(noise(rng, dur), 3200.0 * (700.0 / 3200.0) ** (t / dur), 0.8, 'bp')
    sig += rush * bell_curve(t, 0.3, 0.14, 0.4) * 0.22
    return snes_air(soften(sig, 1.3)), -22.0


def sfx_hammerfall():
    """The Iron Guardian's hammer meeting stone: a deep falling thump, the floor cracking, an
    iron clang that rings dull, and grit raining back down."""
    rng = np.random.default_rng(104)
    dur = 1.1
    t = t_axis(dur)
    sig = np.zeros_like(t)
    # the weight landing: a low sine falling from 78 to 38 Hz, felt more than heard
    thump = glide(t, 78.0, 38.0) * exp_decay(t, 0.22) * attack(t, 0.003)
    sig += thump * 0.9
    sig += partial(t, 112.0, 0.09, 0.6)
    # the floor cracking: a wide noise burst, low-passed as it dies
    crack = svf(noise(rng, dur), 900.0, 0.8, 'bp') * exp_decay(t, 0.07)
    sig += crack * 1.1
    sig += svf(noise(rng, dur), 3600.0, 0.9, 'hp') * exp_decay(t, 0.025) * 0.5
    # the iron: a heavy, inharmonic clang, dulled above 3 kHz
    clang = metal(t, 196.0, (1.0, 2.41, 3.17, 4.53, 5.88),
                  (0.38, 0.27, 0.19, 0.13, 0.09), (1.0, 0.6, 0.42, 0.26, 0.16))
    sig += svf(clang, 3000.0, 0.7, 'lp') * 0.55
    # grit: small stones falling back over the next half second, thinning out
    grit_t = t_axis(0.05)
    for _ in range(26):
        at = 0.08 + 0.6 * (rng.random() ** 1.5)
        tick = svf(noise(rng, 0.05), rng.uniform(1800.0, 4200.0), 2.0, 'bp')
        place(sig, tick * exp_decay(grit_t, 0.008), at, rng.uniform(0.08, 0.25) * (1.2 - at))
    return snes_air(soften(sig, 2.6)), -21.0


CUES = {
    fn.__name__: fn
    for fn in (sfx_miss, sfx_nodamage, sfx_shatter, sfx_purchase, sfx_equip, sfx_menu_open,
               sfx_menu_close, sfx_steal, sfx_turn, sfx_chime, sfx_loot, sfx_page, sfx_ward_break,
               sfx_hammerfall)
}


# ── writing and checking ─────────────────────────────────────────────────────

def write_wav(path: str, x: np.ndarray) -> None:
    pcm = np.clip(np.round(x * 32767), -32768, 32767).astype('<i2')
    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


def encode_mp3(wav_path: str, mp3_path: str) -> None:
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', wav_path, '-map_metadata', '-1',
                    '-fflags', '+bitexact', '-c:a', 'libmp3lame', '-q:a', str(MP3_QUALITY),
                    '-ar', str(SR), '-ac', '1', mp3_path], check=True)


def decode(path: str) -> np.ndarray:
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-f', 's16le', '-ac', '1',
                          '-ar', str(SR), '-'], check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype='<i2').astype(float) / 32768


def check(name: str, x: np.ndarray, mp3: np.ndarray, loudness: float) -> str:
    """The listen-proxy: what a quick ear would catch, as numbers."""
    problems = []
    peak = 20 * math.log10(max(np.max(np.abs(mp3)), 1e-9))
    if peak > PEAK_CEILING_DB:
        problems.append(f'decoded peak {peak:.1f} dBFS is over {PEAK_CEILING_DB} (soften it)')
    heard = momentary_max(mp3)
    if abs(heard - loudness) > 1.0:
        problems.append(f'decoded loudness {heard:.1f} LUFS, wanted {loudness}')
    dc = float(np.mean(x))
    if abs(dc) > 1e-3:
        problems.append(f'DC offset {dc:.4f}')
    edge = max(abs(x[0]), abs(x[-1]))
    if edge > 1e-4:
        problems.append(f'end sample {edge:.5f}: a click')
    dur = len(x) / SR
    if dur > 1.5:
        problems.append(f'{dur:.2f} s is too long')
    if problems:
        raise SystemExit(f'{name}: ' + '; '.join(problems))
    return f'{dur:.2f} s · {heard:.1f} LUFS (momentary max) · peak {peak:.1f} dBFS'


def build(names, wav_dir=None) -> None:
    os.makedirs(OUT, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        for name in names:
            sig, loudness = CUES[name]()
            x = finish(sig, loudness)
            wav = os.path.join(wav_dir or tmp, f'{name}.wav')
            write_wav(wav, x)
            mp3 = os.path.join(OUT, f'{name}.mp3')
            encode_mp3(wav, mp3)
            report = check(name, x, decode(mp3), loudness)
            print(f'{name:16s} {report} · {os.path.getsize(mp3)} bytes')


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('cues', nargs='*', help='cue names (default: every cue)')
    ap.add_argument('--list', action='store_true', help='list the cues and stop')
    ap.add_argument('--wav', metavar='DIR', help='also keep the WAVs in DIR')
    args = ap.parse_args(argv)
    if args.list:
        for name, fn in CUES.items():
            print(f'{name:16s} {fn.__doc__.strip().splitlines()[0]}')
        return 0
    unknown = [n for n in args.cues if n not in CUES]
    if unknown:
        ap.error(f'unknown cue(s): {", ".join(unknown)}')
    if args.wav:
        os.makedirs(args.wav, exist_ok=True)
    build(args.cues or list(CUES), args.wav)
    return 0


if __name__ == '__main__':
    sys.exit(main())
