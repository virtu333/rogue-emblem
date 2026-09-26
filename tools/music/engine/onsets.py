"""Onset compensation: how long a note takes to speak, so it can start that early.

A bowed, blown or sung note does not sound the instant it starts: a choir
swells in over a quarter of a second, a soft violin bow bites later than a
hard one. The renderer starts every sampled note early by the time its sound
takes to speak, so what the listener hears lands on the beat.

A note speaks when its envelope (10 ms RMS) first comes within 10 dB of its
early peak (its loudest point in the first 0.6 s). Half the peak (-6 dB), the
old criterion, lands late on slow attacks, which are clearly heard well before
they reach half their level (a quiet violin section swells for half a second),
and on bowed shorts it flips between the bite and the body of the stroke. That
time depends on the key (each
sample, or SoundFont zone, has its own attack) and on the velocity (another
layer, a softer bow: the GeneralUser choir takes far longer at pp than at f).
So it is measured over a grid of keys and velocities, per
articulation, and looked up per note (nearest measured key, linear between
velocities).

A slurred note (a legato transition in the sampler) has no attack of its own:
it takes over from the note before it by a crossfade, and what the listener
hears is the moment the new pitch outweighs the old. For legato articulations
a second table holds that moment, measured on slurs up and down a tone.

Tables are measured the first time a render needs them and kept in
tools/music/onsets.json with a signature of what they depend on (the
articulation's definition, the SoundFont preset, the sfizz program), so a
changed instrument is measured again rather than read stale.
"""

from __future__ import annotations

import hashlib
import json
import os

import numpy as np

from .dsp import SR

PATH = os.path.join(os.path.dirname(__file__), '..', 'onsets.json')
VERSION = 3           # bump when the measurement itself changes
MAX_PRE = 0.35        # seconds: no note starts earlier than this
SPEAKS_DB = -10.0     # a note speaks this far below its early peak
EARLY = 0.6           # seconds: the early peak is the loudest point this soon
# velocity grid: the dynamics, plus both sides of the sampler's attack-shaping
# switch at 0.55 (softer notes keep a slower bow / breath)
VELS = (0.16, 0.26, 0.38, 0.5, 0.549, 0.55, 0.62, 0.76, 0.88, 1.0)
# SoundFonts switch velocity layers anywhere: every MIDI velocity (a note's
# velocity is looked up on this grid exactly, so a layer's edge stays sharp)
SF2_VELS = tuple((v - 1) / 126 for v in range(1, 128))
# slurs: fewer velocities (each point renders four slurs)
LEGATO_VELS = (0.16, 0.38, 0.549, 0.55, 0.62, 0.76, 1.0)
SEEDS = (1, 2, 3, 4, 5)   # round robins: five takes of every note
SPLIT = 0.06          # seconds: takes further apart than this disagree (see _typical)
SPACING = 2.5         # seconds between measured notes
NOTE = 1.2            # measured note length (s)

_TABLE = None


def _load():
    global _TABLE
    if _TABLE is None:
        _TABLE = json.load(open(PATH)) if os.path.exists(PATH) else {}
    return _TABLE


def _save(name):
    """Write one entry, merged into whatever the file holds now (builds running
    side by side measure different instruments)."""
    cur = json.load(open(PATH)) if os.path.exists(PATH) else {}
    cur[name] = _TABLE[name]
    for k, v in cur.items():
        _TABLE.setdefault(k, v)
    tmp = f'{PATH}.{os.getpid()}.tmp'
    # one articulation per line: a few hundred kB instead of tens of thousands of
    # lines (the file is generated data, left out of prettier)
    rows = [f'  {json.dumps(k)}: {json.dumps(cur[k], separators=(",", ":"), sort_keys=True)}'
            for k in sorted(cur)]
    with open(tmp, 'w') as f:
        f.write('{\n' + ',\n'.join(rows) + '\n}\n')
    os.replace(tmp, PATH)


def signature(inst: dict, art_name: str) -> str:
    """What an articulation's onsets depend on."""
    if inst['kind'] == 'sfz':
        what = {k: (os.path.basename(v) if k == 'file' else v)
                for k, v in inst['arts'][art_name].items()}
    elif inst['kind'] == 'sf2':
        what = [os.path.basename(inst['font']), inst['bank'], inst['program']]
    else:
        what = [os.path.basename(inst['sfz']), inst.get('cc'), inst.get('transpose', 0)]
    extra = [inst.get('fixed_pitch', False), inst['ref_key'], list(inst['range'])]
    body = json.dumps([VERSION, what, extra], sort_keys=True, default=str)
    return hashlib.sha1(body.encode()).hexdigest()[:12]


def compensates(inst: dict) -> bool:
    return inst['kind'] in ('sfz', 'sf2', 'sfizz')


def pre(inst_name: str, art_name: str, key: int, vel: float, legato: bool = False) -> float:
    """Seconds to start this note early."""
    from .instruments import INSTRUMENTS
    inst = INSTRUMENTS[inst_name]
    if not compensates(inst):
        return 0.0
    grids = _grids(inst_name, art_name)
    keys, pts = grids['legato'] if legato and 'legato' in grids else grids['on']
    if inst['kind'] == 'sf2':
        vel = round(float(np.clip(vel, 0, 1)) * 126) / 126   # the MIDI velocity it plays at
    i = int(np.argmin(np.abs(keys - key)))
    ms = float(np.interp(vel, pts[i][0], pts[i][1]))
    return min(max(ms, 0.0) / 1000.0, MAX_PRE)


_GRIDS = {}


def _grids(inst_name, art_name):
    """The table as arrays, per process (pre() runs for every note)."""
    k = (inst_name, art_name)
    if k not in _GRIDS:
        t = table(inst_name, art_name)
        _GRIDS[k] = {}
        for which in ('on', 'legato'):
            if t.get(which):
                keys = sorted(t[which], key=int)
                _GRIDS[k][which] = (np.array([int(x) for x in keys]),
                                    [(np.array([p[0] for p in t[which][x]]),
                                      np.array([p[1] for p in t[which][x]])) for x in keys])
    return _GRIDS[k]


def table(inst_name: str, art_name: str) -> dict:
    """The onset table of an articulation, measured now if it is missing or stale.
    An articulation defined exactly like one already measured (a string
    section's 'default' is its 'sus') points at it: {'sig', 'same_as'}."""
    from .instruments import INSTRUMENTS
    inst = INSTRUMENTS[inst_name]
    tab = _load()
    # a legacy instrument kept beside a lab one ('horns@legacy') is the registry's
    from .palette import legacy_name
    name = f'{legacy_name(inst_name)}:{art_name}'
    sig = signature(inst, art_name)
    stale = name not in tab or tab[name].get('sig') != sig or \
        ('same_as' in tab[name] and tab.get(tab[name]['same_as'], {}).get('sig') != sig)
    if stale:
        twin = next((k for k, v in sorted(tab.items())
                     if v.get('sig') == sig and 'same_as' not in v and k != name), None)
        if twin:
            tab[name] = {'sig': sig, 'same_as': twin}
        else:
            entry = {'sig': sig, 'on': measure(inst_name, art_name)}
            art = inst['arts'][art_name] if inst['kind'] == 'sfz' else {}
            if art.get('legato') and art.get('mode') == 'sustain' and not inst.get('fixed_pitch'):
                entry['legato'] = measure_legato(inst_name, art_name)
            tab[name] = entry
            _forget(samples=True)
        _save(name)
    t = tab[name]
    return tab[t['same_as']] if 'same_as' in t else t


def names(inst_name: str) -> list:
    """The articulation names a part of this instrument can ask for."""
    from .instruments import INSTRUMENTS
    inst = INSTRUMENTS[inst_name]
    return list(inst['arts']) if inst['kind'] == 'sfz' else ['default']


# ------------------------------------------------------------------ measuring
def _envelope(x):
    """10 ms RMS, centred (as onset_pre always measured it)."""
    p = x.mean(axis=1).astype(np.float64) ** 2 if x.ndim == 2 else x.astype(np.float64) ** 2
    c = np.concatenate([[0.0], np.cumsum(p)])
    h = 220
    i = np.arange(len(p))
    a, b = np.clip(i - h, 0, len(p)), np.clip(i + h + 1, 0, len(p))
    return np.sqrt((c[b] - c[a]) / 441)


def _speaks(e, t):
    """Seconds from t until the note speaks (rise)."""
    return rise(e[int(t * SR): int((t + EARLY) * SR)])


def rise(seg, peak_from=0):
    """Seconds into seg where the note first comes within SPEAKS_DB of its peak
    (the peak taken over seg[peak_from:]), searching forward from the quietest
    point before the peak, so the ring of an earlier note does not count."""
    if len(seg) <= peak_from or seg[peak_from:].max() <= 0:
        return None
    p = peak_from + int(np.argmax(seg[peak_from:]))
    trough = int(np.argmin(seg[:p + 1]))
    up = np.nonzero(seg[trough:p + 1] >= 10 ** (SPEAKS_DB / 20) * seg[p])[0]
    return float((trough + up[0]) / SR)


def _keys(inst, step):
    if inst.get('fixed_pitch'):
        return [inst['ref_key']]
    lo, hi = inst['range']
    ks = list(range(lo, hi + 1, step))
    if ks[-1] != hi:
        ks.append(hi)
    return ks


def _compress(pts, tol=1.0):
    """Drop velocity points the line through their neighbours predicts within tol ms."""
    pts = [list(p) for p in pts]
    changed = True
    while changed and len(pts) > 2:
        changed = False
        for i in range(1, len(pts) - 1):
            (v0, m0), (v1, m1), (v2, m2) = pts[i - 1], pts[i], pts[i + 1]
            if abs(m0 + (m2 - m0) * (v1 - v0) / (v2 - v0) - m1) < tol:
                del pts[i]
                changed = True
                break
    return pts


def measure(inst_name: str, art_name: str) -> dict:
    """{key: [[vel, ms], ...]}: how long a detached note takes to speak."""
    from .instruments import INSTRUMENTS
    from .render import _render_raw
    from .sampler import NoteEvent
    inst = INSTRUMENTS[inst_name]
    kind = inst['kind']
    vels = SF2_VELS if kind == 'sf2' else VELS
    # every key: a neighbouring key can be another sample with another attack
    # (the solo violin's G6 speaks 0.1 s later than its F#6 at p)
    step = 3 if inst_name == 'grand' else 1
    seeds = SEEDS if kind == 'sfz' else (1,)
    out = {}
    for k in _keys(inst, step):
        evs = [NoteEvent(t=0.5 + i * SPACING, dur=NOTE, key=k, vel=v, art=art_name)
               for i, v in enumerate(vels)]
        n = int((evs[-1].t + SPACING + 0.5) * SR)
        runs = []
        for seed in seeds:
            e = _envelope(_render_raw(inst_name, inst, evs, n, seed=seed, calibrating=True))
            runs.append([_speaks(e, ev.t) for ev in evs])
        pts = []
        for i, v in enumerate(vels):
            ds = [r[i] for r in runs if r[i] is not None]
            if ds:
                pts.append([round(v, 4), round(_typical(ds) * 1000, 1)])
        if kind != 'sf2':
            pts = _despike(pts)
        out[str(k)] = _compress(pts)
        _forget()
    return out


def _despike(pts):
    """Median of each velocity point and its neighbours. A sampler's layers
    crossfade: a single velocity reading far from both neighbours is a note
    with no clear attack caught at an odd moment (a timpani roll read on a late
    stroke), not a real change; a step between two plateaus survives."""
    ms = [p[1] for p in pts]
    out = [list(p) for p in pts]
    for i in range(1, len(pts) - 1):
        out[i][1] = float(np.median(ms[i - 1:i + 2]))
    return out


def _typical(ds):
    """One onset for the takes of a note: their median, unless they split (a
    roll or a quiet swell whose round robins start differently): then the
    earliest-speaking take's, since pulling a take with a quick attack early
    rushes an audible stroke, while a slow one entering a little late does not."""
    ds = sorted(ds)
    return float(ds[0] if ds[-1] - ds[0] > SPLIT else np.median(ds))


def _forget(samples=False):
    """Drop the sampler's transposed-sample caches (and the samples): a sweep
    over every key would otherwise hold gigabytes of them."""
    from .sampler import load_sample, pitched, shaped
    pitched.cache_clear()
    shaped.cache_clear()
    if samples:
        load_sample.cache_clear()


def measure_legato(inst_name: str, art_name: str) -> dict:
    """{key: [[vel, ms], ...]}: when a slurred note takes over from the one
    before it (its envelope overtakes the old note's fading one), from its start."""
    from .instruments import INSTRUMENTS
    from .render import _seed, _voicer
    from .sampler import NoteEvent
    inst = INSTRUMENTS[inst_name]
    art = inst['arts'][art_name]
    v = _voicer(inst_name, art_name, art)
    lo, hi = inst['range']
    out = {}
    for k in _keys(inst, 1):
        pts = []
        for vel in LEGATO_VELS:
            ds = []
            for iv in (2, -2):
                k0 = int(np.clip(k - iv, lo, hi))
                if k0 == k:
                    continue
                for seed in SEEDS[:2]:   # (slurs: two takes each way)
                    a = NoteEvent(t=0.5, dur=1.0, key=k0, vel=vel, art=art_name, legato_out=True)
                    b = NoteEvent(t=1.5, dur=1.0, key=k, vel=vel, art=art_name, legato_in=True)
                    b.prev_key = k0
                    bufs = []
                    for ev in (a, b):
                        buf = np.zeros((int(3.5 * SR), 2), np.float32)
                        v.rng = np.random.default_rng(_seed(seed, round(ev.t, 4), ev.key))
                        v._rr = {}
                        v.render(ev, buf)
                        bufs.append(_envelope(buf))
                    ea, eb = bufs
                    s0, s1 = int(1.5 * SR), int(2.1 * SR)
                    over = np.nonzero(eb[s0:s1] >= ea[s0:s1])[0]
                    ds.append(over[0] / SR if len(over) else 0.6)
            if ds:
                pts.append([vel, round(float(np.median(ds)) * 1000, 1)])
        out[str(k)] = _compress(_despike(pts))
        _forget()
    return out
