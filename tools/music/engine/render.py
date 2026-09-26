"""Score -> stems -> mixes -> seamless-loop MP3s with loop metadata.

Loop model
----------
A score is an intro (I) followed by a loop body (P). Loop notes are rendered
once and the stem is built as  intro + loop + shift(loop, P)  so the second
pass is a sample-exact copy of the first. The exported file covers
[0, I + M + P + extra] and loops [I + M, I + M + P]:

  * M (>= 3 s and longer than the reverb) puts the loop start where the
    intro's tails have died, so the jump is inaudible;
  * any constant decoder delay D < M (MP3 encoder priming) shifts both loop
    points by the same content offset and keeps the loop seamless;
  * `extra` keeps loopEnd inside the decoded audio whatever the padding.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import pickle
import re
import subprocess
import time
import zlib
from dataclasses import asdict

import numpy as np
import soundfile as sf

from . import dsp, palette, tuning
from .dsp import SR
from .instruments import INSTRUMENTS
from .sampler import NoteEvent, SfzVoicer
from .score import Score
from .sf2render import render_sf2
from .sfzrender import render_sfz
from .synth import VOICES

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
CACHE = os.path.join(ROOT, 'References', 'music-cache')


def cache_dir() -> str:
    """Stem cache: MUSIC_CACHE if set; a lab palette keeps its own, so lab
    renders never evict the default palette's stems."""
    if os.environ.get('MUSIC_CACHE'):
        return os.environ['MUSIC_CACHE']
    return palette.cache_dir() if palette.active() else CACHE
_STEM_KEY = re.compile(r'[0-9a-f]{16}\.npy')


def prune_cache(max_age_days: float, directory: str | None = None) -> tuple[int, int]:
    """Delete stems not used for `max_age_days` (a cache hit refreshes a stem's
    time), across every score. Only run when asked: a build never deletes
    another score's stems. Returns (files removed, bytes freed)."""
    d = directory or cache_dir()
    if not os.path.isdir(d):
        return 0, 0
    cutoff = time.time() - max_age_days * 86400
    n = freed = 0
    for f in os.listdir(d):
        p = os.path.join(d, f)
        if not f.endswith('.npy') or '__' not in f:
            continue
        try:
            st = os.stat(p)
            if st.st_mtime < cutoff:
                os.remove(p)
                n += 1
                freed += st.st_size
        except FileNotFoundError:
            pass
    return n, freed


CALIB_PATH = os.path.join(os.path.dirname(__file__), '..', 'calibration.json')
ENGINE_VERSION = 11  # bump to invalidate stem caches

M_MIN = 4.0
EXTRA = 0.6
TAIL = 7.0  # seconds rendered past the region for tails / lookahead


def _h(obj) -> str:
    return hashlib.sha1(pickle.dumps(obj, protocol=4)).hexdigest()[:16]


def _seed(*parts) -> int:
    return zlib.crc32('|'.join(str(p) for p in parts).encode()) & 0x7FFFFFFF


# ------------------------------------------------------------------ calibration
def _load_calib():
    if os.path.exists(CALIB_PATH):
        return json.load(open(CALIB_PATH))
    return {}


def _save_calib():
    # the repo's JSON style (prettier): two-space indent, final newline
    tmp = f'{CALIB_PATH}.{os.getpid()}.tmp'
    with open(tmp, 'w') as f:
        f.write(json.dumps(_CALIB, indent=2, sort_keys=True) + '\n')
    os.replace(tmp, CALIB_PATH)


_CALIB = None


def calibration_db(inst_name: str, art: str = 'default') -> float:
    """Gain (dB) that brings an mf reference note to -20 dBFS RMS."""
    global _CALIB
    if _CALIB is None:
        _CALIB = _load_calib()
    inst = INSTRUMENTS[inst_name]
    if inst['kind'] == 'lab':
        return 0.0   # lab streams are levelled by their own calibration (labrender)
    key = f'{inst_name}:{art}'
    if key in _CALIB:
        return _CALIB[key]
    n = int(3.0 * SR)
    ev = [NoteEvent(t=0.1, dur=1.5, key=inst['ref_key'], vel=0.62, art=art)]
    buf = _render_raw(inst_name, inst, ev, n, seed=1, calibrating=True)
    oneshot = inst['kind'] == 'sfz' and inst['arts'].get(art, inst['arts']['default'])['mode'] != 'sustain'
    win = buf[int(0.1 * SR): int((0.45 if oneshot else 1.4) * SR)]
    rms = math.sqrt(float(np.mean(win.astype(np.float64) ** 2)) + 1e-12)
    g = -20.0 - dsp.db(rms)
    _CALIB[key] = round(g, 2)
    _save_calib()
    return _CALIB[key]


def onset_pre(inst_name: str, art_name: str) -> float:
    """Seconds to start a note early so its perceived onset (the envelope
    reaching half its early peak) lands on the beat. Measured once per
    articulation over several pitches and two dynamics, then cached."""
    global _CALIB
    if _CALIB is None:
        _CALIB = _load_calib()
    key = f'pre|{inst_name}:{art_name}'
    if key in _CALIB:
        return _CALIB[key]
    inst = INSTRUMENTS[inst_name]
    art = inst['arts'][art_name]
    v = _voicer(inst_name, art_name, art)
    lo, hi = inst['range']
    keys = [inst['ref_key']] if inst.get('fixed_pitch') else \
        [int(k) for k in np.linspace(lo + 3, hi - 5, 4)]
    ds = []
    for k in keys:
        for vel in (0.55, 0.8):
            out = np.zeros((int(2 * SR), 2), np.float32)
            v.rng = np.random.default_rng(1)
            v.render(NoteEvent(t=0.5, dur=1.0, key=k, vel=vel, art=art_name), out)
            e = np.sqrt(np.convolve(out.mean(axis=1).astype(np.float64) ** 2,
                                    np.ones(441) / 441, 'same'))
            seg = e[int(0.5 * SR):int(1.1 * SR)]
            if seg.max() <= 0:
                continue
            ds.append(np.nonzero(seg >= 0.5 * seg.max())[0][0] / SR)
    pre = float(min(np.median(ds) if ds else 0.0, 0.15))
    _CALIB[key] = round(pre, 4)
    _save_calib()
    return _CALIB[key]


# ------------------------------------------------------------------ raw rendering
_VOICERS = {}


def _voicer(inst_name, art_name, art):
    k = (inst_name, art_name)
    if k not in _VOICERS:
        opts = {k2: v for k2, v in art.items() if k2 not in ('file', 'pre', 'legato')}
        _VOICERS[k] = SfzVoicer(art['file'], **opts)
    return _VOICERS[k]


def sf2_key_tuning(inst, key_cents=None) -> dict:
    """{key: cents} a SoundFont part is retuned by: the part's own `key_cents`
    when it has them (a score that fitted its own table, e.g. per note length,
    keeps exactly that: the two never stack), otherwise the preset's measured
    correction (tools/music/tuning.json, from tunecheck.py)."""
    if key_cents:
        return {int(k): float(v) for k, v in key_cents.items()}
    return tuning.preset_cents(inst['font'], inst['bank'], inst['program'])


def _render_raw(inst_name, inst, events: list[NoteEvent], n_frames, seed, calibrating=False,
                sustain_pedal=False, key_cents=None, score=None, lane=None):
    """Events -> stereo buffer, no calibration/mix processing. `key_cents` (SoundFont
    parts only, per part) maps a key to a tuning correction in cents; it replaces the
    preset's default correction (sf2_key_tuning)."""
    out = np.zeros((n_frames, 2), np.float32)
    kind = inst['kind']
    if kind == 'sfz':
        by_art = {}
        for ev in events:
            by_art.setdefault(ev.art if ev.art in inst['arts'] else 'default', []).append(ev)
        for art_name, evs in by_art.items():
            art = inst['arts'][art_name]
            v = _voicer(inst_name, art_name, art)
            for ev in evs:
                # per-note RNG: round robins and sustain splicing are a pure
                # function of the note, never of render order
                v.rng = np.random.default_rng(_seed(seed, round(ev.t, 4), ev.key))
                v._rr = {}
                v.render(ev, out)
    elif kind == 'sf2':
        evs = [(ev.t, ev.dur, ev.key, ev.vel) for ev in events]
        cc = {64: 127} if sustain_pedal else None
        out = render_sf2(inst['font'], inst['bank'], inst['program'], evs, n_frames,
                         channel=inst.get('channel', 0), cc=cc,
                         key_tuning=sf2_key_tuning(inst, key_cents))
    elif kind == 'sfizz':
        # `transpose`: a program mapped away from sounding pitch (the Growlybass)
        tr = inst.get('transpose', 0)
        evs = [(ev.t, ev.dur, ev.key + tr, ev.vel) for ev in events]
        out = render_sfz(inst['sfz'], evs, n_frames, cc=inst.get('cc'))
    elif kind == 'synth':
        fn = VOICES[inst['voice']]
        evs = [(ev.t, ev.dur, ev.key, ev.vel) for ev in events]
        out = fn(evs, n_frames, np.random.default_rng(seed), **inst.get('params', {}))
    elif kind == 'lab':
        from . import labrender
        out = labrender.render(inst, events, n_frames, seed, score=score, lane=lane,
                               calibrating=calibrating)
    else:
        raise ValueError(kind)
    return out


# ------------------------------------------------------------------ renderer
class Renderer:
    def __init__(self, score: Score, verbose=True):
        self.s = score
        self.verbose = verbose
        s = score
        self.I_b = s.intro_beats
        self.P_b = s.loop_beats
        self.one_shot = s.one_shot
        if self.one_shot:
            # no loop: a silent stand-in region, long enough to hold the tail margin
            rt = max([s.reverb.get('rt60', 2.2)] + [2.0])
            need_s = max(M_MIN, 1.15 * rt) / 0.8 + 1.0
            self.P_b = math.ceil(need_s * s.bpm_at(max(0.0, self.I_b - 1e-6)) / 60)
        self.I_s = s.seconds(self.I_b)
        self.P_s = s.seconds(self.I_b + self.P_b) - self.I_s
        self.P_f = int(round(self.P_s * SR))
        self.I_f = int(round(self.I_s * SR))
        rt = max([s.reverb.get('rt60', 2.2)] + [2.0])
        self.M_s = max(M_MIN, 1.15 * rt)
        if self.M_s > self.P_s * 0.8:
            raise ValueError('loop too short for margin')
        self.M_f = int(round(self.M_s * SR))
        self.loop_start_f = self.I_f + self.M_f
        self.loop_end_f = self.loop_start_f + self.P_f
        self.file_f = self.loop_end_f + int(EXTRA * SR)
        self.n_f = self.file_f + int(TAIL * SR)
        self.cache = cache_dir()
        os.makedirs(self.cache, exist_ok=True)
        # the cache is shared by every score (and by builds running side by side):
        # a render only ever replaces its own parts' stems (render_part); stale
        # stems of other scores go only when asked (prune_cache, build.py --prune-cache)

    def log(self, *a):
        if self.verbose:
            print(*a, flush=True)

    # -------------------------------------------------------------- events
    def _events(self, part, inst):
        """Split into intro events and loop events (pass-1 positions), with
        humanization, gates and circular legato flags."""
        s = self.s
        rng = np.random.default_rng(_seed(s.seed, s.name, part.name))
        hum = part.opts.get('humanize_ms', inst.get('humanize_ms', 5)) / 1000.0
        notes = sorted(part.notes, key=lambda n: (n.start, n.pitch))
        lo, hi = inst['range']
        end_b = self.I_b + self.P_b
        evs = []
        for n in notes:
            if n.start >= end_b - 1e-9:
                raise ValueError(f'{s.name}/{part.name}: note at beat {n.start} after loop end')
            if self.one_shot and n.start >= self.I_b - 1e-9:
                raise ValueError(f'{s.name}/{part.name}: note at beat {n.start} after the cue ends')
            pitch = n.pitch if inst.get('fixed_pitch') else n.pitch + s.transpose
            if not inst.get('fixed_pitch') and not (lo <= pitch <= hi):
                raise ValueError(f'{s.name}/{part.name}: pitch {pitch} outside {inst["range"]}'
                                 f' at bar {s.bar_at(n.start) + 1}')
            t0 = s.seconds(n.start)
            written = n.dur
            if n.staccato:
                written *= 0.5
            gate = 1.0 if n.tenuto else n.gate
            t1 = s.seconds(min(n.start + written * gate, end_b)) if n.start + written * gate <= end_b \
                else s.seconds(end_b) + (n.start + written * gate - end_b) * 60 / s.bpm_at(end_b - 1e-6)
            art = n.art
            if art == 'default':
                art = part.opts.get('art', 'default')
            art_def = inst['arts'].get(art, inst['arts']['default']) if inst['kind'] == 'sfz' else {}
            pre = art_def.get('pre')
            if pre is None and inst['kind'] == 'sfz':
                art_key = art if art in inst['arts'] else 'default'
                pre = onset_pre(part.inst, art_key)
            pre = pre or 0.0
            jitter = float(np.clip(rng.normal(0, hum / 2), -hum, hum)) if hum > 0 else 0.0
            vj = part.opts.get('vel_jitter', inst.get('vel_jitter', 0.06))
            vel = float(np.clip(n.vel + rng.normal(0, vj), 0.02, 1.0))
            ev = NoteEvent(t=t0 - pre + jitter, dur=max(0.02, t1 - t0), key=pitch, vel=vel, art=art)
            ev.rearticulate = n.rearticulate
            ev.in_loop = n.start >= self.I_b - 1e-9
            ev.beat_start, ev.beat_end = n.start, n.start + n.dur
            if inst['kind'] == 'lab':
                # what the lab palette's performer reads (not part of the note's identity
                # for the default palette, so its cache keys do not change)
                ev.accent, ev.staccato = n.accent, n.staccato
            evs.append(ev)
        # legato flags (sustain arts of legato instruments, monophonic lines)
        if inst['kind'] == 'sfz' and part.opts.get('legato', True):
            self._legato(evs, inst, part)
        intro = [e for e in evs if not e.in_loop]
        loop = [e for e in evs if e.in_loop]
        return intro, loop

    def _legato(self, evs, inst, part):
        def legato_ok(e):
            a = inst['arts'].get(e.art, inst['arts']['default'])
            return a.get('legato') and a['mode'] == 'sustain'

        seq = [e for e in evs if legato_ok(e)]
        if not seq:
            return
        # only apply to monophonic stretches: skip notes overlapping others
        loop = [e for e in seq if e.in_loop]
        intro = [e for e in seq if not e.in_loop]
        tol = 0.06

        def link(a, b, wrap=0.0):
            if b.rearticulate or a.art != b.art:
                return
            gap = (b.beat_start + wrap) - a.beat_end
            if abs(gap) <= tol and not (a.beat_start == b.beat_start):
                a.legato_out = True
                b.legato_in = True
                b.prev_key = a.key

        def chain(lst):
            for a, b in zip(lst, lst[1:]):
                # ignore chords: consecutive notes starting at the same time
                link(a, b)

        chain(intro)
        chain(loop)
        if intro and loop:
            link(intro[-1], loop[0])
            loop[0].legato_in = False  # recomputed circularly below
        if loop:
            link(loop[-1], loop[0], wrap=self.P_b)
        # chords: a note with a simultaneous neighbour cannot be legato
        starts = {}
        for e in seq:
            starts.setdefault(round(e.beat_start, 4), []).append(e)
        for group in starts.values():
            if len(group) > 1:
                for e in group:
                    e.legato_in = e.legato_out = False

    # -------------------------------------------------------------- stems
    def render_part(self, part):
        s = self.s
        inst = INSTRUMENTS[part.inst]
        intro, loop = self._events(part, inst)
        seed = _seed(s.seed, s.name, part.name, 'render')
        key = _h((ENGINE_VERSION, part.inst, inst.get('arts', {}), inst.get('program'),
                  inst.get('params'),
                  [asdict(e) | {'r': e.rearticulate, 'p': getattr(e, 'prev_key', None)} for e in intro],
                  [asdict(e) | {'r': e.rearticulate, 'p': getattr(e, 'prev_key', None)} for e in loop],
                  self.n_f, self.P_f,
                  self.I_f, seed, part.opts.get('pedal', False))
               + (((sorted(part.opts['key_cents'].items()),) if part.opts.get('key_cents')
                   else ()))
               + ((tuning.token(inst),) if inst['kind'] in ('sfz', 'sfizz', 'sf2') else ())
               + (((inst['sfz'], inst.get('cc'), inst.get('transpose', 0)),)
                  if inst['kind'] == 'sfizz' else ())
               + (() if inst['kind'] != 'lab' else (
                   palette.cache_token(inst), part.expr_points, self.I_b, self.P_b,
                   [(e.accent, e.staccato) for e in intro + loop])))
        path = os.path.join(self.cache, f'{s.name}__{part.name}__{key}.npy')
        if os.path.exists(path):
            try:
                os.utime(path)   # last use, for prune_cache
            except OSError:
                pass
            return np.load(path).astype(np.float32)
        self.log(f'  render {part.name:14s} ({part.inst}, {len(intro)}+{len(loop)} notes)')
        pedal = part.opts.get('pedal', False)
        # calibrate per articulation for sfz: render by art groups
        out = np.zeros((self.n_f, 2), np.float32)
        groups = {}
        for tag, evs in (('intro', intro), ('loop', loop)):
            for e in evs:
                a = e.art if inst['kind'] == 'sfz' and e.art in inst['arts'] else 'default'
                groups.setdefault((tag, a), []).append(e)
        loop_len = self.I_f + self.P_f + int(TAIL * SR) + int(self.M_s * SR) + int(2 * SR)
        loop_len = min(loop_len, self.n_f)
        lab = {}
        if inst['kind'] == 'lab':
            lab = dict(score=s, lane=self._lane(part.expr_points, self.n_f)
                       if part.expr_points else None)
        for (tag, a), evs in groups.items():
            g = dsp.undb(calibration_db(part.inst, a))
            buf = _render_raw(part.inst, inst, evs, loop_len if tag == 'loop' else self.n_f,
                              seed=_seed(seed, tag, a), sustain_pedal=pedal,
                              key_cents=part.opts.get('key_cents'), **lab) * g
            if tag == 'intro':
                out += buf
            else:
                n = min(len(buf), self.n_f)
                out[:n] += buf[:n]
                # sample-exact second pass
                sh = self.P_f
                if sh < self.n_f:
                    m = min(len(buf), self.n_f - sh)
                    out[sh:sh + m] += buf[:m]
        # keep one cached version per part of this score (the cache is only an
        # iteration aid). Names are <score>__<part>__<key>.npy: the prefix match
        # never reaches another score's or another part's stems
        prefix = f'{s.name}__{part.name}__'
        for f in os.listdir(self.cache):
            if f.startswith(prefix) and f != os.path.basename(path) \
                    and _STEM_KEY.fullmatch(f[len(prefix):]):
                try:
                    os.remove(os.path.join(self.cache, f))
                except FileNotFoundError:
                    pass   # a concurrent render of the same part got there first
        # written whole, then renamed: a render running beside this one never
        # loads half a stem
        tmp = f'{path}.{os.getpid()}.tmp.npy'
        np.save(tmp, out.astype(np.float16))
        os.replace(tmp, path)
        return out

    def _process_part(self, part, dry):
        """Expression lane, dynamic tone, EQ, role leveling, pan/width -> (dry, send)."""
        s = self.s
        inst = INSTRUMENTS[part.inst]
        x = dry
        hpf = part.opts.get('hpf', inst.get('hpf', HPF_BY_BUS.get(inst.get('bus'), 30)))
        if part.expr_points and not inst.get('expr_cc'):
            # (a lab instrument has already played the lane as its dynamics CC)
            lane = self._lane(part.expr_points, len(x))
            if inst.get('expr_tone') or part.opts.get('expr_tone'):
                x = dsp.dynamic_tone(x, lane, amount=part.opts.get('tone_amount', 0.6))
            x = x * (lane ** 1.3)[:, None]
        # players never hold a line perfectly steady: a slow, loop-periodic drift
        role = part.opts.get('role', ROLE_BY_BUS.get(inst.get('bus'), 'section'))
        life = part.opts.get('life', LIFE_BY_ROLE.get(role, 0.0)
                             if inst.get('bus') in ('strings', 'brass', 'winds', 'choir') else 0.0)
        if life:
            x = x * self._drift(len(x), life, _seed(s.seed, part.name, 'life'))[:, None]
        comp = part.opts.get('comp', inst.get('comp'))
        if comp:
            x = dsp.compress(x, **comp)
        amp = part.opts.get('amp', inst.get('amp'))
        if amp:
            x = amp_sim(x, **amp)
        eq = list(inst.get('eq', [])) + list(part.opts.get('eq', []))
        if hpf:
            eq = [('highpass', hpf, 0.7, 0)] + eq
        if part.opts.get('role') in ('pad', 'choir') and inst.get('bus') != 'synth':
            eq.append(('peak', 320, 0.9, -2.5))   # keep sustained pads out of the mud
        depth = part.opts.get('depth', inst.get('depth', 0.4))
        depth += {'ostinato': 0.15, 'pad': 0.2, 'choir': 0.1, 'lead': -0.1}.get(
            part.opts.get('role'), 0.0)
        depth = min(1.0, max(0.0, depth))
        if depth > 0.3:
            eq.append(('highshelf', 6500, 0.7, -2.5 * (depth - 0.3) / 0.7))
        if eq:
            x = dsp.eq(x, eq)
        # role leveling: bring the part's level while playing to its role target
        role = part.opts.get('role', ROLE_BY_BUS.get(inst.get('bus'), 'section'))
        if role in ROLE_TARGETS:
            act = active_rms_db(x[: self.loop_end_f])
            if act is not None:
                x = x * dsp.undb(ROLE_TARGETS[role] - act)
        width = part.opts.get('width', inst.get('width', 0.6))
        pan = part.opts.get('pan', inst.get('pan', 0.0))
        x = dsp.pan_stereo(x, pan, width)
        send = part.opts.get('reverb', 0.25 + 0.45 * depth)
        return x, send

    def _drift(self, n, depth_db, seed):
        """Smooth random gain curve (0.05-0.35 Hz) that repeats every loop."""
        P = self.P_f
        hop = 441
        m = max(8, P // hop)
        rng = np.random.default_rng(seed)
        spec = np.zeros(m // 2 + 1, complex)
        freqs = np.fft.rfftfreq(m, d=hop / SR)
        band = (freqs > 0.05) & (freqs < 0.35)
        spec[band] = rng.normal(size=band.sum()) + 1j * rng.normal(size=band.sum())
        curve = np.fft.irfft(spec, m)
        curve /= (np.abs(curve).max() + 1e-9)
        t = (np.arange(n) - self.I_f) % P / hop
        vals = np.interp(t, np.arange(m + 1), np.concatenate([curve, curve[:1]]))
        return (10 ** (depth_db * vals / 20)).astype(np.float32)

    def _lane(self, points_beats, n):
        """Expression lane that is exactly periodic over the loop.

        Intro points shape the intro; loop points are interpolated circularly
        (the last point glides into the first one a loop later), so both loop
        passes see the same curve."""
        s = self.s
        I_b, P_b = self.I_b, self.I_b + self.P_b
        intro = [(s.seconds(b), v) for b, v in points_beats if b < I_b - 1e-9]
        loop = [(s.seconds(b) - self.I_s, v) for b, v in points_beats if I_b - 1e-9 <= b <= P_b + 1e-9]
        P = self.P_s
        if loop:
            loop = sorted(loop)
            # a point exactly at the loop end is the same instant as the loop start
            if loop[-1][0] >= P - 1e-6 and len(loop) > 1:
                last = loop.pop()
                if loop[0][0] > 1e-6:
                    loop.insert(0, (0.0, last[1]))
            ext = [(t - P, v) for t, v in loop] + loop + [(t + P, v) for t, v in loop]
            xs = np.array([p[0] for p in ext])
            ys = np.array([p[1] for p in ext])
            def loop_val(tl):
                return np.interp(np.mod(tl, P), xs, ys)
        else:
            const = intro[-1][1] if intro else 1.0
            def loop_val(tl):
                return np.full(np.shape(tl), const)
        t = np.arange(n) / SR
        lane = np.empty(n)
        m = t >= self.I_s
        lane[m] = loop_val(t[m] - self.I_s)
        if (~m).any():
            if intro:
                pts = intro + [(self.I_s, float(loop_val(np.array([0.0]))[0]))]
                lane[~m] = np.interp(t[~m], [p[0] for p in pts], [p[1] for p in pts])
            else:
                lane[~m] = float(loop_val(np.array([0.0]))[0])
        return lane.astype(np.float32)

    # -------------------------------------------------------------- mix
    def stems(self):
        out = {}
        for name, part in self.s.parts.items():
            if not part.notes:
                continue
            dry = self.render_part(part)
            out[name] = self._process_part(part, dry)
            if self.one_shot:
                continue
            err = seam_error_db(out[name][0], self.loop_start_f, self.loop_end_f)
            if err > -50:
                self.log(f'  WARN stem {name} not periodic at the loop point ({err:.1f} dB)')
        return out

    def mix(self, stems, variant: str):
        s = self.s
        gains = s.variants.get(variant, {})
        master = s.master
        buses = {}
        ducks = []
        send_hall = np.zeros((self.n_f, 2), np.float32)
        send_room = np.zeros((self.n_f, 2), np.float32)
        # the tune sits on top: accompaniment dips up to ~2 dB under the lead
        lead_key = None
        for name, (x, send) in stems.items():
            part = s.parts[name]
            v = _variant_gain(gains, name)
            if v is None or part.opts.get('role') != 'lead':
                continue
            y = x * dsp.undb(part.opts.get('gain', 0.0) + v)
            lead_key = y if lead_key is None else lead_key + y
        acc_gain = None
        if lead_key is not None and master.get('lead_duck', 2.0) > 0:
            band = dsp.eq(lead_key, [('highpass', 700, 0.7, 0), ('lowpass', 5000, 0.7, 0)])
            lvl = np.sqrt(np.mean(band.astype(np.float64) ** 2, axis=1) + 1e-12)
            import math as _m
            from .dsp import _env_follow
            env = _env_follow(lvl * 1.4, _m.exp(-1 / (SR * 0.04)), _m.exp(-1 / (SR * 0.35)))
            env_db = 20 * np.log10(env + 1e-9)
            thr = float(np.percentile(env_db[env_db > -80], 40)) if np.any(env_db > -80) else 0
            red = np.clip((env_db - thr) * 0.35, 0, master.get('lead_duck', 2.0))
            acc_gain = (10 ** (-red / 20)).astype(np.float32)[:, None]
        for name, (x, send) in stems.items():
            part = s.parts[name]
            g_db = part.opts.get('gain', 0.0)
            v = _variant_gain(gains, name)
            if v is None:
                continue
            g = dsp.undb(g_db + v)
            bus = part.opts.get('bus', INSTRUMENTS[part.inst].get('bus', 'misc'))
            y = x * g
            if acc_gain is not None and part.opts.get('role') in ('ostinato', 'pad', 'section',
                                                                  'keys', 'choir'):
                y = y * acc_gain
            buses.setdefault(bus, np.zeros((self.n_f, 2), np.float32))
            buses[bus] += y
            if bus == 'drums' or INSTRUMENTS[part.inst].get('room'):
                send_room += y * send
            else:
                send_hall += y * send
            duck = part.opts.get('duck', INSTRUMENTS[part.inst].get('duck'))
            if duck:
                ducks.append((bus, name, duck))
        # sidechain: duck parts (e.g. bass guitar) under the kick's low end
        for bus, name, src in ducks:
            if src not in stems or _variant_gain(gains, src) is None:
                continue
            key_sig = dsp.lowpass(stems[src][0], 110, order=4).astype(np.float32)
            part = s.parts[name]
            y = stems[name][0] * dsp.undb(part.opts.get('gain', 0.0) + (_variant_gain(gains, name) or 0))
            ducked = dsp.compress(y, thresh_db=-30, ratio=3.0, attack_ms=2, release_ms=90,
                                  sidechain=key_sig * 4.0)
            buses[bus] += ducked - y
        # bus processing
        if 'drums' in buses:
            d = buses['drums']
            crush = dsp.compress(d, thresh_db=-24, ratio=5, attack_ms=3, release_ms=120,
                                 makeup_db=8)
            buses['drums'] = d * 0.75 + crush * 0.45
        for bname, cfg in master.get('bus', {}).items():
            if bname in buses and cfg.get('eq'):
                buses[bname] = dsp.eq(buses[bname], cfg['eq'])
            if bname in buses and cfg.get('gain'):
                buses[bname] *= dsp.undb(cfg['gain'])
        dry = sum(buses.values()) if buses else np.zeros((self.n_f, 2), np.float32)
        rv = s.reverb
        ir = _ir('hall', rv.get('rt60', 2.2), rv.get('predelay_ms', 22), rv.get('damp', 0.5),
                 rv.get('bright', 1.0))
        wet = dsp.convolve(dsp.eq(send_hall, [('highpass', 180, 0.7, 0), ('lowpass', 11000, 0.7, 0)]),
                           ir) * dsp.undb(rv.get('wet_db', 0))
        mixbuf = dry + wet
        if np.any(send_room):
            ir_room = _ir('room', 0.9, 8, 0.6, 1.0)
            mixbuf += dsp.convolve(send_room, ir_room) * dsp.undb(rv.get('room_db', -3))
        return self.master_chain(mixbuf, variant)

    def master_chain(self, x, variant):
        s = self.s
        m = s.master
        x = dsp.eq(x, [('highpass', 28, 0.7, 0)] + m.get('eq', [
            ('peak', 300, 0.8, -1.5), ('peak', 3200, 1.0, -0.8), ('highshelf', 9000, 0.7, 1.0)]))
        x = dsp.compress(x, thresh_db=m.get('glue_thresh', -16), ratio=m.get('glue_ratio', 1.8),
                         attack_ms=30, release_ms=250, knee_db=8)
        target = s.targets_lufs.get(variant, m.get('lufs', -15.0))
        a, b = self.norm_region()
        for _ in range(3):
            l = dsp.lufs(x[a:b])
            x = x * dsp.undb(target - l)
            y = dsp.limit(x, ceiling_db=-1.0)
            l2 = dsp.lufs(y[a:b])
            if abs(l2 - target) < 0.3:
                break
            x = x * dsp.undb((target - l2) * 0.9)
        return y

    def norm_region(self):
        """Frames loudness is measured over: the loop, or a one-shot's notes and first second of tail."""
        if self.one_shot:
            return 0, min(self.n_f, self.I_f + SR)
        return self.loop_start_f, self.loop_end_f

    def one_shot_end(self, y, floor_db=-50.0):
        """Frame where a one-shot's tail has decayed below floor_db (plus a short fade)."""
        env = np.abs(y).max(axis=1)
        loud = np.nonzero(env > dsp.undb(floor_db))[0]
        end = int(loud[-1]) + 1 if len(loud) else self.I_f
        return min(max(end, self.I_f), self.n_f)

    # -------------------------------------------------------------- export
    def export(self, key: str, variants=None, out_dir=None, preview_dir=None, mp3=True,
               quality=4):
        s = self.s
        variants = variants or list(s.variants)
        stems = self.stems()
        meta = {}
        for var in variants:
            y = self.mix(stems, var)
            name = s.variant_keys.get(var) or (key if var == 'full' else f'{key}_{var}')
            if self.one_shot:
                meta[name] = self._export_one_shot(name, y, out_dir, preview_dir, mp3, quality)
                continue
            f = y[: self.file_f]
            seam = seam_error_db(f, self.loop_start_f, self.loop_end_f)
            ls, le = self.loop_start_f, self.loop_end_f
            if var in s.whole_loop:
                # a file that is exactly one loop period, for players that can
                # only loop whole files (the HTML login screen)
                f = y[self.loop_start_f: self.loop_end_f]
                ls, le = 0, len(f)
            info = {
                'loopStart': round(ls / SR, 6),
                'loopEnd': round(le / SR, 6),
                'duration': round(len(f) / SR, 3),
                'lufs': round(dsp.lufs(f[ls:le]), 2),
                'seamDb': round(seam, 1),
                'peakDb': round(dsp.db(float(np.abs(f).max())), 2),
            }
            self.log(f'  {name}: {info}')
            if seam > -45:
                raise RuntimeError(f'{name}: loop seam error {seam:.1f} dB (should be < -45)')
            if out_dir:
                os.makedirs(out_dir, exist_ok=True)
                write_audio(os.path.join(out_dir, name + ('.mp3' if mp3 else '.wav')), f,
                            quality=quality)
            if preview_dir:
                os.makedirs(preview_dir, exist_ok=True)
                # what a player hears: the file, then the loop jump and 12 s more
                jump = np.concatenate([f[:le], f[ls: ls + 12 * SR]])
                write_audio(os.path.join(preview_dir, name + '.mp3'), jump, quality=2)
            meta[name] = info
        return meta

    def _export_one_shot(self, name, y, out_dir, preview_dir, mp3, quality):
        end = self.one_shot_end(y)
        fade = min(int(0.25 * SR), end - self.I_f) if end > self.I_f else 0
        f = y[:end].copy()
        if fade:
            f[end - fade:] *= np.linspace(1.0, 0.0, fade, dtype=np.float32)[:, None]
        a, b = self.norm_region()
        info = {
            'duration': round(len(f) / SR, 3),
            'notesEnd': round(self.I_s, 3),
            'lufs': round(dsp.lufs(f[a:min(b, len(f))]), 2),
            'peakDb': round(dsp.db(float(np.abs(f).max())), 2),
        }
        self.log(f'  {name}: {info}')
        for d in (out_dir, preview_dir):
            if d:
                os.makedirs(d, exist_ok=True)
                write_audio(os.path.join(d, name + ('.mp3' if mp3 else '.wav')), f,
                            quality=quality if d == out_dir else 2)
        return info


# level (dBFS RMS while playing) each role is brought to before the mix
ROLE_TARGETS = {
    'lead': -18.0, 'lead2': -21.0, 'counter': -21.0, 'section': -22.0, 'ostinato': -23.0,
    'pad': -25.0, 'bass': -21.0, 'low': -24.0, 'drums': -19.5, 'timp': -24.0,
    'accent': -26.0, 'choir': -24.0, 'keys': -22.5, 'fx': -28.0, 'sub': -25.0,
    'kick': -20.5, 'snare': -21.5, 'toms': -24.0, 'cym': -27.5,
}
LIFE_BY_ROLE = {'lead': 1.0, 'lead2': 1.2, 'counter': 1.4, 'section': 1.4, 'pad': 2.0,
                'choir': 2.0, 'low': 1.2}
ROLE_BY_BUS = {
    'strings': 'section', 'brass': 'section', 'winds': 'section', 'keys': 'keys',
    'perc': 'accent', 'drums': 'drums', 'rhythm': 'bass', 'choir': 'choir', 'synth': 'fx',
}
HPF_BY_BUS = {'strings': 60, 'brass': 45, 'winds': 90, 'keys': 40, 'perc': 30, 'drums': 30,
              'rhythm': 30, 'choir': 90, 'synth': 40}


def amp_sim(x, drive=6.0, tight=110.0, mid_hz=900.0, mid_db=4.0, cab_hz=5200.0, mix=1.0):
    """Guitar amp: tighten lows, push mids into a tanh stage, then a cab-like
    bandlimit with the usual low-mid scoop."""
    y = dsp.eq(x, [('highpass', tight, 0.7, 0), ('peak', mid_hz, 0.8, mid_db)])
    pk = float(np.abs(y).max()) + 1e-9
    y = np.tanh(drive * y / pk) * pk / np.tanh(drive)
    y = dsp.eq(y, [('peak', 2000, 1.2, 2.0)])
    y = np.tanh(drive * 0.5 * y / pk) * pk
    y = dsp.eq(y, [('lowpass', cab_hz, 0.9, 0), ('lowpass', cab_hz * 1.3, 0.7, 0),
                   ('peak', 420, 1.0, -4.0), ('highpass', 75, 0.7, 0)])
    return (mix * y + (1 - mix) * x).astype(np.float32)


def active_rms_db(x, win=int(0.2 * SR), floor_db=30.0):
    """RMS over the windows where the part is actually playing."""
    n = len(x) // win
    if n == 0:
        return None
    w = (x[: n * win].astype(np.float64) ** 2).mean(axis=1).reshape(n, win).mean(axis=1)
    mx = w.max()
    if mx <= 1e-14:
        return None
    act = w[w > mx * 10 ** (-floor_db / 10)]
    return dsp.db(float(np.sqrt(act.mean())))


def _variant_gain(gains: dict, name: str):
    """Variant gain for a part: an exact name beats a glob; among globs the
    last listed wins. None mutes."""
    import fnmatch
    if name in gains:
        return gains[name]
    val = 0.0
    for pat, g in gains.items():
        if fnmatch.fnmatch(name, pat):
            val = g
    return val


_IR_CACHE = {}


def _ir(kind, rt60, predelay, damp, bright):
    k = (kind, rt60, predelay, damp, bright)
    if k not in _IR_CACHE:
        _IR_CACHE[k] = dsp.make_ir(rt60=rt60, predelay_ms=predelay, damp_hi=damp,
                                   brightness=bright, seed=11 if kind == 'hall' else 5)
    return _IR_CACHE[k]


def seam_error_db(f, a, b, win=int(0.5 * SR)):
    """How different the audio after loopEnd is from the audio after loopStart,
    relative to the loop's RMS level. Tiny when the loop is seamless."""
    n = min(win, len(f) - b)
    x1, x2 = f[a:a + n].astype(np.float64), f[b:b + n].astype(np.float64)
    ref = math.sqrt(np.mean(f[a:b].astype(np.float64) ** 2) + 1e-12)
    err = math.sqrt(np.mean((x1 - x2) ** 2) + 1e-15)
    return dsp.db(err / ref)


def write_audio(path, y, quality=4):
    if path.endswith('.wav'):
        sf.write(path, y, SR, subtype='PCM_16')
        return
    tmp = path + '.tmp.wav'
    sf.write(tmp, y, SR, subtype='PCM_24')
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', tmp, '-c:a', 'libmp3lame',
                    '-q:a', str(quality), '-ar', str(SR), path], check=True)
    os.remove(tmp)
