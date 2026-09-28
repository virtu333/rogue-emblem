"""Render a part through lab-palette instruments (kind 'lab'): full-spec SFZ
programs played by sfizz_render with performance data.

A lab instrument names one or more *streams*. Each stream is an SFZ program
rendered in its own sfizz pass (so a legato program sees an unbroken
monophonic line, and a spiccato program its own notes). Per stream the
renderer writes:

  * notes, with the overlaps a legato program needs to trigger its
    transitions and clean gaps before a re-bowed note;
  * the dynamics CC (usually CC1 on these libraries) as a lane: the written
    dynamic, the performer's phrase shaping and the score's expression lane,
    mapped through the program's own CC gain range;
  * per-note CCs (a round-robin select) and static CCs (sustain pedal...).

Then each stream is levelled by a measured calibration (an mf reference
note to -20 dBFS RMS, like the default palette's calibration) and the
streams are summed. The expression lane is folded into the dynamics CC, so
render.py does not apply it again (`expr_cc`).

sfizz_render streams long samples from disk in a background thread and, on a
loaded machine, very occasionally drops a block. Every stream is therefore
rendered until two passes agree bit for bit.
"""

from __future__ import annotations

import hashlib
import json
import math
import os

import numpy as np

from . import perform, sfzlab
from .dsp import SR
from .sfzrender import render_sfz

LIBS = os.path.join(sfzlab.ROOT, 'References', 'music-libs')
SSO = os.path.join(LIBS, 'SSO4', 'Sonatina Symphonic Orchestra')
VPO = os.path.join(LIBS, 'VPO3')
VCSL = os.path.join(LIBS, 'VCSL')
CALIB = os.path.join(sfzlab.LAB_DIR, 'calibration.json')
GRID = 0.01          # dynamics lane resolution (s)
LEGATO_OVERLAP = 0.03


# ------------------------------------------------------------------ programs
def sso(*parts):
    return os.path.join(SSO, *parts)


def vpo(*parts):
    return os.path.join(VPO, *parts)


def vcsl(*parts):
    return os.path.join(VCSL, *parts)


# legato transition speeds: (velocity band of the incoming note, its attack)
# and (CC20 band set before a note, how fast it lets go when the next note takes over)
# (sfizz's off_time is an exponential fade reaching about -60 dB at off_time: 2.5x the
# incoming attack puts the old note near -25 dB just as the new one is fully in)
LEG_ATTACK = [(1, 42, 0.18), (43, 90, 0.10), (91, 127, 0.05)]
LEG_RELEASE = [(0, 42, 0.5), (43, 84, 0.25), (85, 127, 0.12)]
LEG_CC = 20
LEG_BAND_CC = {'slow': 20, 'medium': 64, 'fast': 110}
# the incoming legato note starts its attack at 40% (not from silence): with the
# old note's exponential fade, a crossfade from zero sank the line by 4-6 dB for
# ~60 ms at every slur (measured on the title theme); from 40% the dip is ~1-2 dB
LEG_START = 40
# the finger's slide into a slurred note: the new voice starts a fraction of the
# interval away and glides onto its pitch (pitch EG whose depth two CCs set per
# note: CC22 = start above, CC23 = start below, 1200 cents at 127). Only the new
# voice slides; the old one fades on its own pitch. (slide fraction, glide time)
LEG_SLIDE = {'slow': (0.3, 0.3), 'medium': (0.18, 0.18), 'fast': (0.08, 0.1)}
SLIDE_UP_CC, SLIDE_DOWN_CC = 22, 23


def leg_band(vel: int) -> str:
    return 'slow' if vel <= 42 else ('medium' if vel <= 90 else 'fast')


def _legato(legato_path, accent_path=None, accent_where=None, transition='tuned',
            first_attack=0.11):
    """A library legato program, rebuilt for performance.

    SSO's legato programs use one 0.2 s transition and let the old note fade
    for a full second under the new one (a smear on anything quick); and
    their group-level `offset=20000`, meant to start a legato voice past its
    bow attack, is overridden by every region's own offset, so each legato
    note starts from a fresh attack. Here a transition is a matched
    crossfade from the sustained part of the sample, in one of three speeds:

      * the incoming note's velocity picks its attack (quick inside a run,
        medium, slow and expressive across a leap);
      * CC20, sent before each note, picks how fast that note lets go when
        the next one takes over (off_by/off_time), matched to the next
        note's attack so the line neither dips nor smears.

    First notes of a bow: the sustain from its natural attack; velocity sets
    the bow-in (soft -> slower) and, from 70 up, a marcato bite from the
    library's own accent layer (the short samples its Marcato program layers in).
    """
    base = sfzlab.load(legato_path)
    if transition == 'library':
        return base
    first = sfzlab.regions_only(base, {'trigger': 'first'})
    first = sfzlab.with_opcodes(first, 'group', {'offset': None})
    leg = sfzlab.sustain_offsets(sfzlab.regions_only(base, {'trigger': 'legato'}))
    parts = []
    for clo, chi, off in LEG_RELEASE:
        cc = {f'locc{LEG_CC}': clo, f'hicc{LEG_CC}': chi, 'off_time': off}
        parts.append(sfzlab.with_opcodes(first, 'group', {
            'ampeg_attack': first_attack, 'ampeg_vel2attack': round(-0.9 * first_attack, 3), **cc}))
        for lo, hi, att in LEG_ATTACK:
            glide = LEG_SLIDE[leg_band(lo)][1]
            parts.append(sfzlab.with_opcodes(leg, 'group', {
                'lovel': lo, 'hivel': hi, 'ampeg_attack': att, 'ampeg_start': LEG_START,
                'pitcheg_attack': 0, 'pitcheg_hold': 0.015, 'pitcheg_sustain': 0,
                'pitcheg_decay': glide, 'pitcheg_depth': 0,
                f'pitcheg_depth_oncc{SLIDE_UP_CC}': 1200,
                f'pitcheg_depth_oncc{SLIDE_DOWN_CC}': -1200, **cc}))
    if accent_path:
        accent = sfzlab.regions_only(sfzlab.load(accent_path), dict(accent_where or {}))
        parts.append(sfzlab.with_opcodes(accent, 'group', {'trigger': 'first', 'lovel': 70}))
    prog = list(parts[0])
    for p in parts[1:]:
        prog += [b for b in p if b[0] != 'control']
    return prog


def _violin2_legato(transition='tuned'):
    """SSO4 Solo Violin 2 (see _legato); the accent layer is its Marcato's spiccato."""
    SP = 'Strings - Performance'
    return _legato(sso(SP, 'Violin Solo 2 Legato.sfz'), sso(SP, 'Violin Solo 2 Marcato.sfz'),
                   {'ampeg_decay': '1'}, transition)


def _with(path, **ops):
    """A library program with group opcodes changed (None removes one)."""
    return sfzlab.with_opcodes(sfzlab.load(path), 'group', ops)


def _rr(path, cc=20):
    return sfzlab.round_robin_by_cc(sfzlab.load(path), cc=cc)


def _plain(path):
    return sfzlab.load(path)


def darken(prog, hz):
    """A low-pass on every group: the first filter slot if the group has none
    (sfizz silences a region given only a second filter), else the second."""
    prog = [(h, list(ops)) for h, ops in prog]
    for h, ops in prog:
        if h != 'group':
            continue
        if sfzlab.get(ops, 'fil_type') is None and sfzlab.get(ops, 'cutoff') is None:
            sfzlab.set_op(ops, 'fil_type', 'lpf_2p')
            sfzlab.set_op(ops, 'cutoff', hz)
        else:
            sfzlab.set_op(ops, 'fil2_type', 'lpf_2p')
            sfzlab.set_op(ops, 'cutoff2', hz)
    return prog


CHORUS_ATTACK = (0.5, -0.42)   # attack = a0 + a_vel * velocity/127 (0.08 s at 127)


# a sung line: each note lets go as fast as the next arrives (CC20 bands, as for the violin),
# 2.5x the incoming attack (CHORUS_ATTACK at the performer's leg velocities 28 / 72 / 112)
CHORUS_RELEASE = [(0, 42, 1.0), (43, 84, 0.65), (85, 127, 0.33)]


def _chorus(path, darken_hz=None, mono=False, voice=None, release=0.6):
    """A chorus program with a velocity-controlled attack (the libraries' own
    run 0.2-0.8 s: a melody at battle tempo speaks late and blurs) and a
    shorter release (1.25 s smeared every chord change into the next).

    mono: one voice at a time for a sung line; each note hands over to the
    next with a crossfade matched to the next note's attack (CC20 bands),
    instead of the last one's release smearing under it.
    voice: 'female' or 'male' keeps one section's samples over the whole
    keyboard. SSO's 'Mixed Chorus' is a split keyboard (men up to F#4, women
    from G4), so a melody crossing G4 changed choir mid-phrase."""
    prog = sfzlab.load(path)
    if voice:
        prog = sfzlab.keep_regions(prog, lambda r: f'-{voice}-' in os.path.basename(r.get('sample', '')))
    if voice or mono:
        # a line keeps its section: notes past the section's samples are pitched, never
        # moved by an octave
        prog = sfzlab.extend_range(prog)
    if darken_hz:
        # there is no 'ooh' in these libraries: the 'ah' with its brightness taken off
        prog = darken(prog, darken_hz)
    a0, av = CHORUS_ATTACK
    ops = {'ampeg_attack': a0, 'ampeg_vel2attack': av, 'ampeg_release': release}
    if not mono:
        return sfzlab.with_opcodes(prog, 'group', ops)
    ops.update({'group': 1, 'off_by': 1, 'off_mode': 'time'})
    parts = []
    for clo, chi, off in CHORUS_RELEASE:
        parts.append(sfzlab.with_opcodes(prog, 'group', {
            **ops, f'locc{LEG_CC}': clo, f'hicc{LEG_CC}': chi, 'off_time': off}))
    out = list(parts[0])
    for p in parts[1:]:
        out += [b for b in p if b[0] != 'control']
    return out


PROGRAM_BUILDERS = {
    'violin2_legato': _violin2_legato,
    'legato': _legato,
    'rr': _rr,
    'plain': _plain,
    'with': lambda path, ops: _with(path, **dict(ops)),
    'dark': lambda path, hz: darken(sfzlab.load(path), hz),
    'chorus': _chorus,
}

_PROG_CACHE = {}


def program(spec) -> tuple[str, dict]:
    """spec: (builder, *args) -> (generated sfz path, facts {'span', 'dyn_range'})."""
    spec = tuple(spec)
    if spec in _PROG_CACHE:
        return _PROG_CACHE[spec]
    prog = PROGRAM_BUILDERS[spec[0]](*spec[1:])
    name = spec[0] + '-' + hashlib.sha1(repr(spec).encode()).hexdigest()[:6]
    path = sfzlab.write(prog, name)
    rng = 0.0
    for r in sfzlab.regions(prog):
        for k in ('gain_cc1', 'gain_oncc1', 'volume_oncc1', 'amplitude_cc1'):
            if k in r:
                rng = max(rng, float(r[k]) if 'amplitude' not in k else 0.0)
    facts = {'span': sfzlab.key_span(prog), 'dyn_range': rng}
    _PROG_CACHE[spec] = (path, facts)
    return _PROG_CACHE[spec]


# ------------------------------------------------------------------ calibration
_CAL = None


def _cal():
    global _CAL
    if _CAL is None:
        _CAL = json.load(open(CALIB)) if os.path.exists(CALIB) else {}
    return _CAL


def _cal_save():
    os.makedirs(os.path.dirname(CALIB), exist_ok=True)
    tmp = CALIB + f'.{os.getpid()}.tmp'
    json.dump(_CAL, open(tmp, 'w'), indent=1, sort_keys=True)
    os.replace(tmp, CALIB)


def stable_render(sfz, events, n_frames, cc=None, cc_events=None, tries=6):
    """Render until two passes agree (see the module note on sfizz streaming)."""
    seen = {}
    for _ in range(tries):
        y = render_sfz(sfz, events, n_frames, cc=cc, cc_events=cc_events)
        h = hashlib.sha1(y.tobytes()).hexdigest()
        if h in seen:
            return y
        seen[h] = y
    # no two agree: take the loudest (a dropout only ever removes audio)
    return max(seen.values(), key=lambda a: float(np.abs(a).sum()))


def stream_calibration(sfz_path, facts, st, ref_key, cal_key):
    """(gain dB, onset seconds) for an mf reference note through a stream."""
    c = _cal()
    lo, hi = facts['span']
    k = st['fixed_key'] if 'fixed_key' in st else int(min(max(ref_key, lo), hi))
    key = f'{os.path.basename(sfz_path)}|{cal_key}|{k}|{st.get("cal_vel", 64)}|{sorted(st.get("cc", {}).items())}'
    if key in c:
        return c[key]['gain_db'], c[key]['onset']
    n = int(3.0 * SR)
    vel = st.get('cal_vel', 64)
    cc = dict(st.get('cc', {}))
    if facts['dyn_range'] and st.get('dyn_cc', 1):
        cc[st.get('dyn_cc', 1)] = _cc_from_db(perform.vel_db(0.62), facts['dyn_range'])
    y = stable_render(sfz_path, [(0.1, 1.5, k, (vel - 1) / 126)], n, cc=cc)
    short = st.get('short', False)
    win = y[int(0.1 * SR): int((0.45 if short else 1.4) * SR)]
    rms = math.sqrt(float(np.mean(win.astype(np.float64) ** 2)) + 1e-12)
    gain = -20.0 - 20 * math.log10(rms)
    env = np.sqrt(np.convolve(y.mean(axis=1).astype(np.float64) ** 2, np.ones(441) / 441, 'same'))
    seg = env[int(0.1 * SR):int(0.8 * SR)]
    onset = float(np.nonzero(seg >= 0.5 * seg.max())[0][0] / SR) if seg.max() > 0 else 0.0
    c[key] = {'gain_db': round(gain, 2), 'onset': round(min(onset, 0.2), 4)}
    _cal_save()
    return c[key]['gain_db'], c[key]['onset']


def _cc_from_db(db, rng):
    if not rng:
        return 127
    return int(np.clip(round(127 * (1 + db / rng)), 1, 127))


# ------------------------------------------------------------------ rendering
def _fit_key(key, span, warn):
    lo, hi = span
    k = key
    while k < lo:
        k += 12
    while k > hi:
        k -= 12
    if k != key:
        warn.append(key)
    return k


def _db_lane(played, t_end, lane_fn):
    """Dynamics in dB on a GRID: the loudest sounding note, held through rests."""
    n = int(math.ceil(t_end / GRID)) + 2
    grid = np.full(n, -np.inf)
    for p in played:
        if not p.db:
            continue
        xs = np.array([x for x, _ in p.db])
        ys = np.array([y for _, y in p.db])
        a = max(0, int((xs.min() - 0.03) / GRID))
        b = min(n, int(math.ceil(xs.max() / GRID)) + 1)
        if b <= a:
            continue
        t = np.arange(a, b) * GRID
        grid[a:b] = np.maximum(grid[a:b], np.interp(t, xs, ys))
    # hold values across gaps (the next note's level is set just before it)
    have = np.isfinite(grid)
    if not have.any():
        return np.zeros(n)
    idx = np.where(have, np.arange(n), 0)
    np.maximum.accumulate(idx, out=idx)
    first = int(np.argmax(have))
    idx[:first] = first
    out = grid[idx]
    if lane_fn is not None:
        out = out + lane_fn(np.arange(n) * GRID)
    return out


def render(inst, events, n_frames, seed, score=None, lane=None, calibrating=False):
    """events: NoteEvent list (one part, one intro/loop group) -> (n_frames, 2)."""
    lab = inst['lab']
    out = np.zeros((n_frames, 2), np.float32)
    if not events:
        return out
    streams = lab['streams']
    mode = lab.get('perform', 'plain')
    if calibrating:
        mode = 'plain'
    if mode == 'auto':
        # a line (one note at a time, chords struck together allowed) is
        # performed; a part whose notes overlap (pads, divisi) is played plainly
        mode = 'line' if is_line(events) else 'plain'
    amap = lab.get('art_map', {})
    if mode == 'line':
        played = perform.perform_line(score, events, seed, arts=tuple(lab.get('line_arts', ())),
                                      shaping=0.5 if lane is not None else 1.0,
                                      style=lab.get('style', 'full'))
        if lab.get('rebow'):
            # the performer's phrasing and short-note choices, but every long note
            # on its own bow from the sustain program (no crossfaded slurs)
            for p in played:
                if p.stream in ('leg', 'first'):
                    p.stream = 'sus'
        for p in played:
            if p.stream not in streams:
                p.stream = amap.get(p.stream, 'chord' if 'chord' in streams else next(iter(streams)))
    else:
        played = []
        for p, e in zip(perform.perform_plain(events), sorted(events, key=lambda e: (e.t, e.key))):
            p.stream = amap.get(e.art, amap.get('default', next(iter(streams))))
            if p.stream not in streams:
                p.stream = next(iter(streams))
            off = streams[p.stream].get('db_offset', 0.0)
            if off:
                p.db = [(x, y + off) for x, y in p.db]
            if lab.get('vel_from_length'):
                # slow-attack programs (choirs): velocity is the attack speed,
                # quick on short or accented notes, gentle on long ones
                d = p.t_off - p.t_on
                p.vel = int(np.clip(round(127 - 70 * min(d, 2.0) / 2.0 + 30 * max(0, e.vel - 0.7)), 30, 127))
            elif streams[p.stream].get('short') or not streams[p.stream].get('dyn_cc', 1):
                p.vel = int(np.clip(round(18 + 118 * min(e.vel, 1.0)), 1, 127))
            elif 'vel' in lab:
                p.vel = lab['vel']
            played.append(p)
    # lane in dB (the score's expression, as render.py would have applied it)
    lane_fn = None
    if lane is not None:
        def lane_fn(t, _lane=lane):
            i = np.clip((np.asarray(t) * SR).astype(np.int64), 0, len(_lane) - 1)
            return 20 * 1.3 * np.log10(np.maximum(_lane[i], 1e-3))
    # a sung line keeps one section of the choir (by where the line lies)
    line_prog = None
    if mode == 'line' and lab.get('line_program'):
        lp = lab['line_program']
        keys = sorted(e.key for e in events)
        line_prog = lp['hi'] if keys[len(keys) // 2] >= lp['split'] else lp['lo']
    # stream name -> the program it plays through (leg and first share one)
    by_prog = {}
    for p in played:
        prog_name = streams[p.stream].get('program_of', p.stream) if p.stream in streams else p.stream
        if line_prog and p.stream in ('leg', 'first'):
            prog_name = line_prog
        by_prog.setdefault(prog_name, []).append(p)
    warn = []
    for sname, ps in by_prog.items():
        st = streams[sname]
        sfz_path, facts = program(st['prog'])
        gain_db, onset = stream_calibration(sfz_path, facts, st, inst['ref_key'],
                                            st.get('cal_key', sname))
        ps = sorted(ps, key=lambda p: p.t_on)
        # onset compensation: a new bow speaks after `onset`; a legato transition
        # (entering at LEG_START) takes over about a fifth of the way into its
        # crossfade (measured: at half-way the new pitch led the beat by ~26 ms)
        for p in ps:
            if st.get('attack'):
                # a velocity-scaled attack: heard about 40% of the way in
                a0, av = st['attack']
                pre = 0.02 + 0.4 * max(0.0, a0 + av * p.vel / 127)
            elif p.stream == 'leg':
                pre = 0.2 * {'slow': 0.18, 'medium': 0.10, 'fast': 0.05}[leg_band(p.vel)]
            else:
                pre = onset * st.get('onset_scale', 1.0)
            p.t_on -= pre
            p.t_off -= pre
            p.db = [(x - pre, y) for x, y in p.db]
        # legato overlaps / clean breaks before a re-bowed note
        mono = st.get('mono', False)
        for a, b in zip(ps, ps[1:]):
            if b.stream == 'leg':
                a.t_off = max(a.t_off, b.t_on + LEGATO_OVERLAP)
            elif mono and a.t_off > b.t_on - 0.012:
                a.t_off = b.t_on - 0.012
        if st.get('legato_cc'):
            # each note lets go at the speed the next note arrives with
            for a, b in zip(ps, ps[1:] + [None]):
                band = leg_band(b.vel) if b is not None and b.stream == 'leg' else 'fast'
                a.cc[LEG_CC] = LEG_BAND_CC[band]
        if st.get('slide'):
            # a slurred note slides in from part of the way (see LEG_SLIDE)
            for a, b in zip([None] + ps, ps):
                up = down = 0
                if a is not None and b.stream == 'leg' and b.key != a.key:
                    frac = LEG_SLIDE[leg_band(b.vel)][0]
                    cents = -frac * (b.key - a.key) * 100      # where the slide starts
                    val = int(round(min(abs(cents), 1200) / 1200 * 127))
                    up, down = (val, 0) if cents > 0 else (0, val)
                b.cc[SLIDE_UP_CC] = up
                b.cc[SLIDE_DOWN_CC] = down
        evs, cce = [], []
        for p in ps:
            if 'key_map' in st:
                # a drum kit's keys onto another instrument's strokes (unmapped: left out)
                k = st['key_map'].get(p.key)
                if k is None:
                    continue
            else:
                k = st['fixed_key'] if 'fixed_key' in st else _fit_key(p.key, facts['span'], warn)
            t_on = max(0.0, p.t_on)
            for c, v in p.cc.items():
                cce.append((max(0.0, t_on - 0.004), c, v))
            evs.append((t_on, max(0.02, p.t_off - t_on), k, (p.vel - 1) / 126))
        cc0 = dict(st.get('cc', {}))
        dyn_cc = st.get('dyn_cc', 1) if facts['dyn_range'] else None
        if dyn_cc:
            t_end = max(p.t_off for p in ps) + 2.0
            dbl = _db_lane(ps, t_end, lane_fn)
            vals = [_cc_from_db(v, facts['dyn_range']) for v in dbl]
            cc0[dyn_cc] = vals[0]
            last = vals[0]
            for i, v in enumerate(vals):
                if v != last:
                    cce.append((i * GRID, dyn_cc, v))
                    last = v
        y = stable_render(sfz_path, evs, n_frames, cc=cc0, cc_events=cce)
        y *= np.float32(10 ** (gain_db / 20))
        if lane is not None and not dyn_cc:
            y *= (np.maximum(lane[:n_frames], 1e-3) ** 1.3)[:, None].astype(np.float32)
        out += y
    if warn:
        print(f'  lab: {len(warn)} notes outside the program range were moved by octaves '
              f'({sorted(set(warn))[:6]})', flush=True)
    return out


def is_line(events, tol=0.03) -> bool:
    """True when no note starts while another (not struck with it) still sounds."""
    evs = sorted(events, key=lambda e: e.t)
    starts = {}
    for e in evs:
        starts.setdefault(round(getattr(e, 'beat_start', e.t), 4), []).append(e)
    groups = sorted(starts.items())
    for (b0, g0), (b1, g1) in zip(groups, groups[1:]):
        end0 = max(getattr(e, 'beat_end', e.t + e.dur) for e in g0)
        if end0 - b1 > tol:
            return False
    return True
