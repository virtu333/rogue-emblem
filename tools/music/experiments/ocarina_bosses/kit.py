"""The suite's shared kit: its own instruments, pitch transforms on note strings,
and the one tune every piece shares.

THE HERO'S CALL. Seven notes on the five pitches an ocarina with five holes
plays (D F A B D'), in D Dorian: D A B A F A D', the tonic, the fifth, the Dorian
sixth leaning on it, the third, the fifth, the octave. It is original (it is none
of the songs the game teaches) and it stands for the one who walks into each
room. Each boss does something different to it.

Dorian is its own mirror: turned upside down around its tonic the scale lands on
itself, and the Call's chord, D minor with its sixth (D F A B), becomes G seventh
(G B D F), the same tritone with the fifth turned into a fourth. `mirror()` does
that to any note string, around any axis.
"""

from __future__ import annotations

import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
MUSIC = os.path.abspath(os.path.join(HERE, '..', '..'))
for _p in (MUSIC, HERE):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from engine.instruments import GU, INSTRUMENTS          # noqa: E402
from engine.score import _CHORD_RE, _NOTE_RE, _REST_RE, _TOKEN_RE, parse_duration  # noqa: E402
from engine.theory import name as pitch_name, pitch     # noqa: E402

# ------------------------------------------------------------------ the ocarina
def ocarina_voice(events, n_frames, rng, v=1, vib_cents=13.0, vib_hz=5.0, scoop=38.0,
                  breath=0.095, chiff=0.45, tilt=0.4):
    """A vessel flute, modelled rather than sampled.

    An ocarina is a Helmholtz resonator: its tone is very nearly a sine (weak 2nd
    and 3rd partials that grow with breath), its pitch follows breath pressure (a
    note scoops up into tune as the breath arrives and sags as it leaves), and the
    air is heard as noise riding on the tone. The line is played as a player would:
    notes that touch are slurred on one breath (the pitch steps by fingering, the
    breath does not stop), separated or repeated notes are tongued (a short chiff),
    and a held note takes a slow breath vibrato once it has settled.

    `v` only versions the stem cache (bump it when this code changes)."""
    import numpy as np
    from scipy import signal
    from engine.dsp import SR
    out = np.zeros((n_frames, 2), np.float32)
    evs = sorted(events)
    phrases = []
    for ev in evs:
        if phrases:
            pt, pdur, pkey, _ = phrases[-1][-1]
            if abs(ev[0] - (pt + pdur)) < 0.05 and ev[2] != pkey:
                phrases[-1].append(ev)
                continue
        phrases.append([ev])
    hiss_sos = signal.butter(2, [1800, 7000], 'band', fs=SR, output='sos')
    air_sos = signal.butter(2, 90, 'low', fs=SR, output='sos')
    for ph in phrases:
        t0 = ph[0][0]
        t1 = ph[-1][0] + ph[-1][1]
        rel = 0.11
        n = int((t1 - t0 + rel + 0.08) * SR)
        if n <= 8:
            continue
        tt = np.arange(n) / SR
        semis = np.full(n, float(ph[0][2]))
        lvl = np.full(n, float(ph[0][3]))
        age = tt.copy()
        hold = np.full(n, ph[0][1])
        dip = np.zeros(n)
        off = np.full(n, rng.normal(0, 4.0))          # no finger lands dead on its pitch
        vdep = np.full(n, rng.uniform(0.55, 1.15))    # no two notes are shaken alike
        vdel = np.full(n, rng.uniform(0.14, 0.4))
        for k, (t, dur, key, vel) in enumerate(ph):
            i0 = max(0, int((t - t0) * SR))
            semis[i0:] = key
            lvl[i0:] = vel
            age[i0:] = tt[i0:] - (t - t0)
            hold[i0:] = dur
            off[i0:] = rng.normal(0, 4.0)
            vdep[i0:] = rng.uniform(0.55, 1.15) if rng.random() > 0.18 else 0.15
            vdel[i0:] = rng.uniform(0.14, 0.4)
            if k:
                # the fingers move: the tone thins for an instant
                w = int(0.03 * SR)
                seg = np.hanning(2 * w)
                a0, a1 = max(0, i0 - w), min(n, i0 + w)
                dip[a0:a1] = np.maximum(dip[a0:a1], seg[a0 - (i0 - w):a1 - (i0 - w)])

        def smooth(x, tau):
            a = np.exp(-1.0 / (tau * SR))
            return signal.lfilter([1 - a], [1, -a], x, zi=[x[0] * a])[0]

        semis = smooth(semis, 0.014)
        lvl = smooth(lvl, 0.04)
        # the breath: in over ~40 ms, out over ~100 ms
        env = np.ones(n)
        a = int(0.042 * SR)
        env[:a] = np.sin(np.linspace(0, np.pi / 2, a)) ** 1.5
        i_end = min(n - 1, int((t1 - t0) * SR))
        env[i_end:] = np.exp(-(tt[i_end:] - tt[i_end]) / 0.035)
        # vibrato settles in on notes held long enough to want it
        want = np.clip((hold - 0.42) / 0.45, 0, 1)
        depth = np.clip((age - vdel) / 0.45, 0, 1) * want * vdep
        # a held note blooms and lets go (the breath is not a switch)
        bloom = 1 + 0.16 * want * np.sin(np.pi * np.clip(age / np.maximum(hold, 1e-3), 0, 1))
        rate = vib_hz * (1 + 0.09 * np.sin(2 * np.pi * 0.31 * tt + rng.random() * 6)
                         + 0.05 * np.sin(2 * np.pi * 0.83 * tt + rng.random() * 6))
        vib = np.sin(2 * np.pi * np.cumsum(rate) / SR + rng.random() * 6)
        # pressure bends pitch: flat while the breath arrives and as it leaves,
        # a few cents sharper when blown harder
        cents = (depth * vib_cents * vib - scoop * (1 - env) ** 1.4 + 9.0 * (lvl - 0.6)
                 + off * np.exp(-age / 0.09)
                 + 3.0 * np.sin(2 * np.pi * 0.23 * tt + rng.random() * 6))
        f = 440.0 * 2 ** ((semis - 69) / 12 + cents / 1200)
        phase = 2 * np.pi * np.cumsum(f) / SR
        h2 = 0.035 + 0.075 * lvl
        h3 = 0.008 + 0.03 * lvl ** 2
        tone = np.sin(phase) + h2 * np.sin(2 * phase + 0.4) + h3 * np.sin(3 * phase + 1.1)
        # air riding on the tone, and a little hiss above it
        air = signal.sosfilt(air_sos, rng.standard_normal(n))
        air /= (np.std(air) + 1e-9)
        hiss = signal.sosfilt(hiss_sos, rng.standard_normal(n))
        hiss /= (np.std(hiss) + 1e-9)
        tongue = np.exp(-tt / 0.03)
        flutter = 1 + 0.35 * signal.sosfilt(air_sos, rng.standard_normal(n)) / 0.06
        drift = 1 + 0.04 * np.sin(2 * np.pi * 0.37 * tt + rng.random() * 6)
        # (a pure tone near 1-2 kHz is the loudest thing an ear can hear: high notes ease off)
        high = 2.0 ** (-tilt * np.maximum(semis - 74.0, 0.0) / 12.0)
        amp = (env * (0.3 + 0.7 * lvl) * drift * bloom * (1 + 0.09 * depth * vib)
               * (1 - 0.3 * dip) * high)
        y = amp * (tone * (1 + 0.26 * air)
                   + breath * hiss * np.clip(flutter, 0.3, 2.0) * (1 + 4.0 * chiff * tongue))
        y = (0.5 * y).astype(np.float32)
        i0 = int(t0 * SR)
        if i0 < 0:
            y = y[-i0:]
            i0 = 0
        end = min(n_frames, i0 + len(y))
        if end > i0:
            out[i0:end] += np.stack([y[: end - i0]] * 2, 1)
    return out


def _register():
    from engine import synth
    synth.VOICES.setdefault('ocarina', ocarina_voice)


_register()

# ------------------------------------------------------------------ instruments
# The suite's own voices. They must be registered before the first Renderer is made
# (the palette snapshots the registry then), so importing this module does it.
EXTRA_INSTRUMENTS = {
    # the hero's voice: the modelled ocarina above
    'ocarina': dict(kind='synth', voice='ocarina', params=dict(v=4), range=(55, 98), pan=-0.1,
                    width=0.15, depth=0.3, ref_key=74, bus='winds', humanize_ms=7),
    # the gallery of the forest manor (GeneralUser GS, the SoundFont the engine uses)
    'harpsichord': dict(kind='sf2', font=GU, bank=0, program=6, range=(29, 89), pan=0.12,
                        width=0.5, depth=0.4, ref_key=60, bus='keys', humanize_ms=4),
    # still water, ice
    'glass': dict(kind='sf2', font=GU, bank=0, program=92, range=(48, 96), pan=0.0,
                  width=0.9, depth=0.7, ref_key=72, bus='synth', humanize_ms=0),
    # hand drums (the SoundFont's standard kit, on the drum channel): 60 high bongo,
    # 61 low bongo, 62 muted high conga, 63 open high conga, 64 low conga
    'hands': dict(kind='sf2', font=GU, bank=128, program=0, channel=9, range=(0, 127),
                  pan=0.0, width=0.3, depth=0.35, ref_key=64, bus='perc', humanize_ms=6,
                  fixed_pitch=True),
}
for _name, _spec in EXTRA_INSTRUMENTS.items():
    INSTRUMENTS.setdefault(_name, _spec)

# ------------------------------------------------------------------ the Hero's Call
CALL_PITCHES = ('D4', 'A4', 'B4', 'A4', 'F4', 'A4', 'D5')
# in 6/8 (a barcarolle: long, long-short | long-short, long | held)
CALL_68 = 'D4q. A4q B4e | A4q F4e A4q. | D5h. |'
# in 4/4 (two bars)
CALL_44 = 'D4q A4q. B4e A4e F4e | A4q D5h. |'


# ------------------------------------------------------------------ note-string transforms
def _norm(text: str) -> str:
    text = re.sub(r'(@(?:ppp|pp|mp|mf|fff|ff|p|f|[0-9.]+))(?=[A-Gr\[<|])', r'\1 ', text)
    return text.replace('|', ' | ')


def transform(text: str, fn) -> str:
    """Apply fn(midi) -> midi to every pitch of a note string. Durations, rests,
    dynamics, articulations and bar checks pass through unchanged."""
    out = []
    for tok in _TOKEN_RE.findall(_norm(text)):
        m = _NOTE_RE.match(tok)
        if m and not tok.startswith(('@', '%', '<')) and not _REST_RE.match(tok):
            out.append(pitch_name(fn(pitch(m.group('p')))) + (m.group('d') or '') + m.group('m'))
            continue
        m = _CHORD_RE.match(tok)
        if m:
            ps = ' '.join(pitch_name(fn(pitch(p))) for p in m.group('ps').split())
            out.append(f'[{ps}]' + (m.group('d') or '') + m.group('m'))
            continue
        out.append(tok)
    return ' '.join(out)


def mirror(text: str, a='D4', b='D5', shift: int = 0) -> str:
    """Turn a line upside down: the mirror that sends pitch `a` to pitch `b` (and b
    to a). `shift` then moves the result by semitones (an octave is 12)."""
    total = pitch(a) + pitch(b)
    return transform(text, lambda p: total - p + shift)


def shift(text: str, semitones: int) -> str:
    return transform(text, lambda p: p + semitones)


def beats(text: str) -> float:
    """Total length of a note string in quarter-note beats."""
    total, last = 0.0, 1.0
    for tok in _TOKEN_RE.findall(_norm(text)):
        if tok == '|' or tok[0] in '@%<':
            continue
        m = _REST_RE.match(tok) or _NOTE_RE.match(tok) or _CHORD_RE.match(tok)
        if not m:
            raise ValueError(f'bad token {tok!r}')
        if m.group('d'):
            last = parse_duration(m.group('d'))
        total += last
    return total


def pitches(text: str) -> list:
    """The MIDI pitches of a monophonic note string, in order (rests left out)."""
    out = []
    for tok in _TOKEN_RE.findall(_norm(text)):
        m = _NOTE_RE.match(tok)
        if m and not _REST_RE.match(tok) and tok[0] not in '@%<':
            out.append(pitch(m.group('p')))
    return out


def swell(part, bar, bars, lo=0.5, hi=1.0, peak=0.6):
    """An expression arch over `bars` bars from `bar`: lo -> hi at `peak` -> lo."""
    part.expr((bar, lo), (bar + bars * peak, hi), (bar + bars - 0.02, lo))


def cresc(part, bar, bars, lo=0.4, hi=1.0):
    part.expr((bar, lo), (bar + bars - 0.02, hi))


def retrograde(text: str) -> str:
    """A monophonic line played backwards (its notes and rests in reverse order, each
    keeping its own length). Bar checks and dynamics are dropped."""
    items, last = [], 1.0
    for tok in _TOKEN_RE.findall(_norm(text)):
        if tok == '|' or tok[0] in '@%<':
            continue
        r = _REST_RE.match(tok)
        m = r or _NOTE_RE.match(tok)
        if not m:
            raise ValueError(f'retrograde: {tok!r} is not a single note or rest')
        if m.group('d'):
            last = parse_duration(m.group('d'))
        items.append(('r' if r else m.group('p'), last))
    return ' '.join(f'{p}:{d:g}' for p, d in reversed(items))


_ROOT_RE = re.compile(r'[A-G](?:b|#)?')
_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']
_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']


def tchart(text: str, semitones: int, sharps: bool = False) -> str:
    """A chord chart ('Gm:6 Eb:3 Am7b5/C:3') moved by semitones."""
    from engine.theory import pc
    names = _SHARP if sharps else _FLAT
    out = []
    for tok in text.split():
        sym, _, beats = tok.partition(':')
        sym = _ROOT_RE.sub(lambda m: names[(pc(m.group(0)) + semitones) % 12], sym)
        out.append(sym + (':' + beats if beats else ''))
    return ' '.join(out)
