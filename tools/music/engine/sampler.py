"""A small SFZ sampler tuned for the VSCO-2 Community Edition library.

Supports the opcode subset VSCO uses (sample, lokey/hikey, pitch_keycenter,
lovel/hivel, volume, tune, ampeg_*, seq_length/seq_position, lorand/hirand),
plus what orchestral mockups need: leading-silence trimming, high quality
pitch shifting, sustain extension for long notes, legato transitions and
release envelopes.
"""

from __future__ import annotations

import math
import os
import re
from dataclasses import dataclass, field
from fractions import Fraction
from functools import lru_cache

import numpy as np
import soundfile as sf
from scipy import signal

from .dsp import SR


@dataclass
class Region:
    sample: str
    lokey: int
    hikey: int
    keycenter: int
    lovel: int = 0
    hivel: int = 127
    volume: float = 0.0
    tune: float = 0.0
    release: float = 0.4
    attack: float = 0.001
    seq_length: int = 1
    seq_position: int = 1
    lorand: float = 0.0
    hirand: float = 1.0


@dataclass
class SfzInstrument:
    path: str
    regions: list = field(default_factory=list)

    def candidates(self, key: int, vel: int):
        return [r for r in self.regions
                if r.lokey <= key <= r.hikey and r.lovel <= vel <= r.hivel]

    def nearest(self, key: int, vel: int):
        """Regions for out-of-range keys: nearest keycenter, same velocity."""
        pool = [r for r in self.regions if r.lovel <= vel <= r.hivel] or self.regions
        best = min(abs(r.keycenter - key) for r in pool)
        return [r for r in pool if abs(r.keycenter - key) == best]


_OPC = re.compile(r'([a-z_0-9]+)=(.*?)(?=\s+[a-z_0-9]+=|$)')


def parse_sfz(path: str) -> SfzInstrument:
    base = os.path.dirname(path)
    text = open(path, encoding='utf-8', errors='replace').read()
    text = re.sub(r'//[^\n]*', '', text)
    headers = re.split(r'(<[a-z]+>)', text)
    inst = SfzInstrument(path)
    ctl, glob, grp = {}, {}, {}
    cur = None
    for chunk in headers:
        chunk_s = chunk.strip()
        if not chunk_s:
            continue
        if chunk_s.startswith('<'):
            cur = chunk_s
            if cur == '<group>':
                grp = {}
            if cur == '<region>':
                pass
            continue
        ops = {}
        for line in chunk_s.splitlines():
            line = line.strip()
            if not line:
                continue
            for k, v in _OPC.findall(line):
                ops[k] = v.strip()
        if cur == '<control>':
            ctl.update(ops)
        elif cur == '<global>':
            glob.update(ops)
        elif cur == '<group>':
            grp.update(ops)
        elif cur == '<region>':
            o = {**glob, **grp, **ops}
            if 'sample' not in o:
                continue
            dp = ctl.get('default_path', '').replace('\\', '/')
            sample = os.path.normpath(os.path.join(base, dp, o['sample'].replace('\\', '/')))
            key = o.get('key')
            lokey = int(o.get('lokey', key if key is not None else 0))
            hikey = int(o.get('hikey', key if key is not None else 127))
            keycenter = int(o.get('pitch_keycenter', key if key is not None else lokey))
            inst.regions.append(Region(
                sample=sample, lokey=lokey, hikey=hikey, keycenter=keycenter,
                lovel=int(o.get('lovel', 0)), hivel=int(o.get('hivel', 127)),
                volume=float(o.get('volume', 0)), tune=float(o.get('tune', 0)),
                release=float(o.get('ampeg_release', 0.4)),
                attack=float(o.get('ampeg_attack', 0.001)),
                seq_length=int(o.get('seq_length', 1)),
                seq_position=int(o.get('seq_position', 1)),
                lorand=float(o.get('lorand', 0)), hirand=float(o.get('hirand', 1)),
            ))
    if not inst.regions:
        raise ValueError(f'no regions in {path}')
    return inst


# ------------------------------------------------------------------ sample cache
@lru_cache(maxsize=1200)
def load_sample(path: str):
    """Load a sample as float32 stereo with leading silence trimmed.

    Returns (audio, sustain_end) where sustain_end is the frame where the
    steady part of the note stops (used to extend long notes).
    """
    x, sr = sf.read(path, dtype='float32', always_2d=True)
    if x.shape[1] == 1:
        x = np.repeat(x, 2, axis=1)
    if sr != SR:
        g = math.gcd(SR, sr)
        x = signal.resample_poly(x, SR // g, sr // g, axis=0).astype(np.float32)
    mono = np.abs(x).max(axis=1)
    peak = mono.max() + 1e-9
    above = np.nonzero(mono > peak * 10 ** (-42 / 20))[0]
    start = max(0, above[0] - int(0.002 * SR)) if len(above) else 0
    x = x[start:]
    # fade the first 1 ms to avoid clicks after trimming
    f = min(len(x), int(0.001 * SR))
    x[:f] *= np.linspace(0, 1, f, dtype=np.float32)[:, None]
    # sustain end: last frame where the 50 ms RMS is within 9 dB of its median
    hop = int(0.05 * SR)
    nfr = len(x) // hop
    if nfr > 4:
        rms = np.sqrt((x[: nfr * hop] ** 2).mean(axis=1).reshape(nfr, hop).mean(axis=1))
        body = rms[1:]
        med = np.median(body[body > body.max() * 0.05]) if (body > body.max() * 0.05).any() else body.max()
        ok = np.nonzero(rms > med * 10 ** (-9 / 20))[0]
        sus_end = (ok[-1] + 1) * hop if len(ok) else len(x)
    else:
        sus_end = len(x)
    return x, int(min(sus_end, len(x)))


@lru_cache(maxsize=1600)
def pitched(path: str, cents: int):
    """Sample transposed by `cents` via polyphase resampling (cached)."""
    x, sus_end = load_sample(path)
    if cents == 0:
        return x, sus_end
    ratio = 2 ** (cents / 1200)          # playback speed
    frac = Fraction(1 / ratio).limit_denominator(400)
    up, down = frac.numerator, frac.denominator
    y = signal.resample_poly(x, up, down, axis=0, window=('kaiser', 8.0)).astype(np.float32)
    return y, int(sus_end * up / down)


@lru_cache(maxsize=1600)
def shaped(path: str, cents: int, attack_ms: float):
    """Pitched sample with its attack sharpened so it reaches the sustain level
    by about attack_ms (a transient designer for slow-bowed / soft-tongued
    sustain samples). Gain is only ever added, capped at +15 dB."""
    x, sus_end = pitched(path, cents)
    if not attack_ms:
        return x, sus_end
    T = int(attack_ms / 1000 * SR)
    win = int(0.01 * SR)
    m = np.sqrt(np.convolve((x.astype(np.float64) ** 2).mean(axis=1), np.ones(win) / win, 'same'))
    ref = m[: int(1.0 * SR)]
    if len(ref) == 0 or ref.max() <= 0:
        return x, sus_end
    L = float(np.percentile(ref[ref > 0], 90)) * 0.9
    n = min(len(x), 6 * T)
    t = np.arange(n)
    target = L * np.clip(t / T, 0, 1) ** 0.6
    g = np.clip(target / np.maximum(m[:n], 1e-7), 1.0, 10 ** (15 / 20))
    # only lift the rise: once the sample reaches the target naturally, stop
    reached = np.nonzero(m[:n] >= target * 0.98)[0]
    reached = reached[reached > T // 4]
    stop = int(reached[0]) if len(reached) else n
    g[stop:] = 1.0
    # smooth the gain curve (5 ms) and release it gently back to unity
    k = int(0.005 * SR)
    g = np.convolve(g, np.ones(k) / k, 'same')
    tail = min(int(0.03 * SR), n - stop) if stop < n else 0
    if tail > 0:
        g[stop:stop + tail] = np.linspace(g[stop - 1] if stop > 0 else 1, 1, tail)
    y = x.copy()
    y[:n] *= g[:, None].astype(np.float32)
    return y, sus_end


def extend_sustain(x: np.ndarray, sus_end: int, need: int, rng) -> np.ndarray:
    """Make a sustained sample at least `need` frames long by crossfading
    randomly offset copies of its steady middle section."""
    if len(x) >= need:
        return x
    a = int(sus_end * 0.35)
    b = max(a + int(0.4 * SR), sus_end)
    xf = int(0.18 * SR)
    if b - a < 2 * xf + int(0.1 * SR):
        # too short to loop: repeat whole sample with crossfades
        a, b = 0, len(x)
        xf = min(xf, (b - a) // 3)
    out = x[:b].copy()
    fade = np.sqrt(np.linspace(0, 1, xf, dtype=np.float32))[:, None]
    while len(out) < need:
        s = int(rng.uniform(a, a + (b - a) * 0.25))
        seg = x[s:b]
        if len(seg) <= xf * 2:
            seg = x[a:b]
        head = seg[:xf]
        out[-xf:] = out[-xf:] * fade[::-1] + head * fade
        out = np.concatenate([out, seg[xf:]])
    return out


# ------------------------------------------------------------------ note rendering
@dataclass
class NoteEvent:
    t: float            # seconds (already humanized)
    dur: float          # seconds held (after gate)
    key: int
    vel: float          # 0..1
    art: str
    legato_in: bool = False     # starts as a legato transition
    legato_out: bool = False    # followed by a legato transition


class SfzVoicer:
    """Renders note events of one articulation of one instrument.

    Beyond plain sample playback it adds the things that separate a mockup
    from a MIDI file: velocity-layer crossfades, velocity -> brightness,
    breath/bow swells on long notes, a pitch glide into legato notes, a bite
    transient on short articulations, brass blare at high dynamics and a
    little per-note tuning drift for sections.
    """

    def __init__(self, sfz_path: str, *, mode='sustain', release=None, veltrack_db=14.0,
                 gain_db=0.0, legato_offset=0.07, legato_xfade=0.07, attack=None,
                 max_len=None, transpose=0, tune_cents=0, seed=0, vel_curve=1.0,
                 tone_oct=2.2, swell=0.0, glide_ms=0.0, glide_frac=0.3, bite_db=0.0,
                 blare=0.0, detune_jitter=0.0, layer_xfade=14, soft_attack=0.0,
                 rr_emulate=False, attack_ms=None):
        self.inst = parse_sfz(sfz_path)
        assert mode in ('sustain', 'decay', 'oneshot'), mode
        self.mode = mode
        self.release = release
        self.veltrack_db = veltrack_db
        self.gain_db = gain_db
        self.legato_offset = legato_offset
        self.legato_xfade = legato_xfade
        self.attack = attack
        self.max_len = max_len
        self.transpose = transpose
        self.tune_cents = tune_cents
        self.vel_curve = vel_curve
        self.tone_oct = tone_oct
        self.swell = swell
        self.glide_ms = glide_ms
        self.glide_frac = glide_frac
        self.bite_db = bite_db
        self.blare = blare
        self.detune_jitter = detune_jitter
        self.layer_xfade = layer_xfade
        self.soft_attack = soft_attack
        self.rr_emulate = rr_emulate
        self.attack_ms = attack_ms
        self.rng = np.random.default_rng(seed)
        self._rr = {}
        bounds = sorted({r.lovel for r in self.inst.regions if r.lovel > 0})
        self.layer_bounds = bounds

    # ------------------------------------------------------------ region choice
    def _pick_v(self, key: int, v: int):
        regs = self.inst.candidates(key, v) or self.inst.nearest(key, v)
        seq = [r for r in regs if r.seq_length > 1]
        if seq:
            length = seq[0].seq_length
            pos = int(self.rng.integers(length)) + 1
            regs = [r for r in seq if r.seq_position == pos] or seq
        rand = [r for r in regs if r.lorand > 0 or r.hirand < 1]
        if rand:
            u = self.rng.random()
            regs = [r for r in rand if r.lorand <= u < r.hirand] or rand
        if len(regs) > 1:
            regs = [regs[int(self.rng.integers(len(regs)))]]
        return regs[0]

    def _pick_layers(self, key: int, vel: float):
        """[(region, weight)]: blend neighbouring velocity layers near a boundary."""
        v = int(round(np.clip(vel ** self.vel_curve, 0, 1) * 126)) + 1
        W = self.layer_xfade
        near = [b for b in self.layer_bounds if abs(v - b) < W]
        if not near or W <= 0:
            return [(self._pick_v(key, v), 1.0)]
        b = near[0]
        lo_r = self._pick_v(key, max(1, b - 1))
        hi_r = self._pick_v(key, min(127, b))
        if lo_r.sample == hi_r.sample:
            return [(lo_r, 1.0)]
        w_hi = float(np.clip(0.5 + (v - b) / (2 * W), 0, 1))
        return [(lo_r, 1 - w_hi), (hi_r, w_hi)]

    # ------------------------------------------------------------ shaping helpers
    def _glide(self, buf, semis):
        """Read the first glide_ms of buf with a pitch offset decaying to zero."""
        G = int(self.glide_ms / 1000 * SR)
        if G <= 8 or abs(semis) < 0.5 or len(buf) < G + 8:
            return buf
        s0 = semis * self.glide_frac
        n = np.arange(len(buf))
        delta = np.where(n < G, s0 * (1 - n / G) ** 2, 0.0)
        rate = 2 ** (delta / 12)
        phase = np.concatenate([[0.0], np.cumsum(rate)[:-1]])
        phase = np.clip(phase, 0, len(buf) - 1)
        out = np.empty_like(buf)
        for c in range(buf.shape[1]):
            out[:, c] = np.interp(phase, n, buf[:, c])
        return out

    def _tone(self, buf, vel):
        if self.tone_oct <= 0:
            return buf
        fc = 19000 * 2 ** (-(1 - vel) * self.tone_oct)
        if fc >= 17000:
            return buf
        sos = signal.butter(1, fc, 'low', fs=SR, output='sos')
        return signal.sosfilt(sos, buf, axis=0).astype(np.float32)

    # ------------------------------------------------------------ render
    def _one(self, reg, ev, key):
        jitter = self.rng.normal(0, self.detune_jitter) if self.detune_jitter else 0.0
        cents = int(round((key - reg.keycenter) * 100 + reg.tune + self.tune_cents + jitter))
        if self.attack_ms and not ev.legato_in:
            # softer notes keep more of the natural (slower) bow / breath
            T = self.attack_ms * (1.0 if ev.vel >= 0.55 else 1.8)
            x, sus_end = shaped(reg.sample, cents, round(T, -1))
        else:
            x, sus_end = pitched(reg.sample, cents)
        rel = self.release if self.release is not None else reg.release
        if self.mode in ('oneshot', 'decay'):
            length = len(x)
            if self.max_len:
                length = min(length, int(self.max_len * SR))
            if self.mode == 'decay':
                length = min(length, int((ev.dur + rel) * SR))
            skip = 0
            if self.rr_emulate:
                # fake extra round robins: enter a few ms into the attack
                skip = int(self.rng.uniform(0, 0.006) * SR)
            buf = x[skip:length].copy()
            if self.rr_emulate:
                buf *= np.float32(10 ** (self.rng.normal(0, 0.8) / 20))
            if length < len(x):
                f = min(int(max(rel, 0.02) * SR), len(buf))
                buf[-f:] *= (np.linspace(1, 0, f, dtype=np.float32) ** 2)[:, None]
            if self.attack:
                a = min(int(self.attack * SR), len(buf))
                buf[:a] *= (np.linspace(0, 1, a, dtype=np.float32) ** 1.5)[:, None]
            return buf
        off = int(self.legato_offset * SR) if ev.legato_in else 0
        hold = int(ev.dur * SR)
        xf = int(self.legato_xfade * SR)
        if ev.legato_out:
            hold += xf
            rel_n = xf
        else:
            rel_n = int(rel * SR)
        need = off + hold + rel_n
        src = extend_sustain(x, sus_end, need, self.rng) if len(x) < need else x
        return src[off: off + hold + rel_n].copy()

    def render(self, ev: NoteEvent, out: np.ndarray):
        key = ev.key + self.transpose
        layers = self._pick_layers(key, ev.vel)
        parts = [(self._one(r, ev, key), w, r) for r, w in layers if w > 1e-3]
        n = max(len(b) for b, _, _ in parts)
        buf = np.zeros((n, 2), np.float32)
        vol_db = 0.0
        for b, w, r in parts:
            buf[: len(b)] += b * (w * 10 ** (r.volume / 20))
        start = int(round(ev.t * SR))
        if self.mode == 'sustain':
            rel = self.release if self.release is not None else layers[0][0].release
            hold = int(ev.dur * SR)
            xf = int(self.legato_xfade * SR)
            env = np.ones(n, np.float32)
            if ev.legato_in:
                prev = getattr(ev, 'prev_key', None)
                if prev is not None and self.glide_ms:
                    buf = self._glide(buf, prev - key)
                a = min(xf, n)
                env[:a] = np.sin(np.linspace(0, np.pi / 2, a)) ** 2
            else:
                att = self.attack or 0.0
                # softer dynamics speak more slowly
                att = max(att, self.soft_attack * (1 - ev.vel))
                if att:
                    a = min(int(att * SR), n)
                    env[:a] = np.linspace(0, 1, a) ** 1.5
            # breath / bow swell on long notes: bloom then taper
            if self.swell and ev.dur > 0.5:
                h = min(hold + (xf if ev.legato_out else 0), n)
                t = np.linspace(0, 1, h)
                depth = self.swell * min(1.0, (ev.dur - 0.5) / 1.5)
                peak = 0.3 + 0.15 * self.rng.random()
                shape = np.where(t < peak, 1 - depth * 0.6 * (1 - t / peak) ** 2,
                                 1 - depth * np.clip((t - peak) / (1 - peak), 0, 1) ** 1.6)
                env[:h] *= shape.astype(np.float32)
            r0 = min(hold + (xf if ev.legato_out else 0) - (xf if ev.legato_out else 0), n)
            r0 = min(hold, n)
            r = n - r0
            if r > 0:
                if ev.legato_out:
                    env[r0:] *= np.cos(np.linspace(0, np.pi / 2, r)) ** 2
                else:
                    env[r0:] *= np.exp(-5.0 * np.linspace(0, 1, r)).astype(np.float32)
                    env[-min(r, 64):] *= np.linspace(1, 0, min(r, 64))
            buf *= env[:, None]
        if self.bite_db and not getattr(ev, 'legato_in', False):
            tt = np.arange(min(n, int(0.06 * SR))) / SR
            boost = 1 + (10 ** (self.bite_db * (0.4 + 0.6 * ev.vel) / 20) - 1) * np.exp(-tt / 0.014)
            buf[: len(tt)] *= boost[:, None].astype(np.float32)
        if self.blare and ev.vel > 0.7:
            d = 1 + self.blare * (ev.vel - 0.7) / 0.3
            pk = float(np.abs(buf).max()) + 1e-9
            y = np.tanh(d * buf / pk) / d * pk
            buf = (0.45 * buf + 0.55 * y * (1 + 0.25 * (d - 1))).astype(np.float32)
        buf = self._tone(buf, ev.vel)
        gain = 10 ** ((vol_db + self.gain_db + self.veltrack_db * (ev.vel - 1)) / 20)
        if start < 0:
            buf = buf[-start:]
            start = 0
        end = min(len(out), start + len(buf))
        if end > start:
            out[start:end] += buf[: end - start] * gain
