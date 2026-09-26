"""Composition helpers that turn chord charts into accompaniment figures.

Melodies are written by hand in note strings; these helpers voice the
harmony (pads with voice leading, arpeggios, ostinati, bass lines) and drum
grids so a chart like "Dm:4 Bb:4 F:2 C:2" drives many parts consistently.
"""

from __future__ import annotations

from .instruments import DRUM_KEYS, ORCH_KEYS
from .score import Part
from .theory import Chord, voice_lead


def _art(part, art):
    """Helpers never inherit a '%switch' left sticky by an earlier play() call."""
    return art or part.opts.get('art') or 'default'


def chart(text: str, default_beats: float = 4.0):
    """'Dm:4 Bb:4 F C/E:2' -> [(Chord, beats), ...]. '%' repeats the previous chord."""
    out = []
    for tok in text.split():
        if tok == '|':
            continue
        if ':' in tok:
            sym, beats = tok.split(':')
            beats = float(eval(beats))  # allows 3/2
        else:
            sym, beats = tok, default_beats
        if sym == '%':
            sym = out[-1][0].symbol
        out.append((Chord(sym), beats))
    return out


def pad(part: Part, bar: float, ch, n: int = 4, lo: int = 55, hi: int = 79, vel=None,
        art=None, spread=False, top: int | None = None, legato_gap: float = 0.0):
    """Sustained chords with smooth voice leading."""
    t = part.score.bar(bar)
    prev = None
    for c, beats in ch:
        v = voice_lead(prev, c, n, lo, hi, spread=spread)
        if top is not None:
            # force the top voice to a specific pitch class if reachable
            pass
        for p in v:
            part.note(t, p, beats - legato_gap, vel=vel, art=_art(part, art), rearticulate=True)
        prev = v
        t += beats
    return t


def arp(part: Part, bar: float, ch, pattern='0 1 2 3 2 1', step=0.5, lo=55, hi=84,
        vel=None, accent_every: float | None = None, accent=0.12, art=None, dur=None,
        n_tones=None):
    """Arpeggiate each chord: pattern indexes the ascending chord tones in [lo, hi]
    starting at the lowest root/chord tone >= lo."""
    idx = [int(x) for x in pattern.split()]
    t = part.score.bar(bar)
    base_vel = part.vel if vel is None else vel
    for c, beats in ch:
        tones = c.tones_in_range(lo, hi)
        if n_tones:
            tones = tones[:n_tones]
        k = 0
        steps = int(round(beats / step))
        for i in range(steps):
            p = tones[idx[k % len(idx)] % len(tones)]
            v = base_vel
            if accent_every and abs(((i * step) / accent_every) - round((i * step) / accent_every)) < 1e-6:
                v = min(1.0, v + accent)
            part.note(t + i * step, p, dur or step, vel=v, art=_art(part, art))
            k += 1
        t += beats
    return t


def ostinato(part: Part, bar: float, ch, rhythm: str, degrees: str, lo=48, hi=72,
             vel=None, art=None, accents: str | None = None):
    """Repeat a rhythm over each chord. rhythm: durations ('e e s s e'); degrees:
    chord-tone indices per note ('0 0 1 0 2'), '-' for a rest. accents: '>' marks."""
    from .score import parse_duration
    durs = [parse_duration(d) for d in rhythm.split()]
    degs = degrees.split()
    accs = (accents or '').split() if accents else []
    t = part.score.bar(bar)
    base_vel = part.vel if vel is None else vel
    for c, beats in ch:
        tones = c.tones_in_range(lo, hi)
        pos = 0.0
        i = 0
        while pos < beats - 1e-9:
            d = durs[i % len(durs)]
            dg = degs[i % len(degs)]
            if dg != '-':
                v = base_vel
                if accs and accs[i % len(accs)] == '>':
                    v = min(1.0, v + 0.14)
                if dg.startswith('b'):  # bass note of chord in range
                    p = c.bass_note(lo)
                    if dg[1:]:
                        p += 12 * int(dg[1:])
                else:
                    p = tones[int(dg) % len(tones)] + 12 * (int(dg) // len(tones))
                part.note(t + pos, p, min(d, beats - pos), vel=v, art=_art(part, art))
            pos += d
            i += 1
        t += beats
    return t


def bass(part: Part, bar: float, ch, rhythm: str = 'q q q q', notes: str = 'r r r r',
         floor: int = 33, vel=None, art=None, accents: str | None = None):
    """Bass line: per chord, rhythm with note choices r(oot) 5(th) 8(ve) 3 b(ass/inversion)
    or a literal interval number like '7'. '-' rests."""
    from .score import parse_duration
    durs = [parse_duration(d) for d in rhythm.split()]
    sel = notes.split()
    accs = (accents or '').split() if accents else []
    t = part.score.bar(bar)
    base_vel = part.vel if vel is None else vel
    for c, beats in ch:
        root = c.bass_note(floor)
        pos, i = 0.0, 0
        while pos < beats - 1e-9:
            d = durs[i % len(durs)]
            s = sel[i % len(sel)]
            if s != '-':
                if s == 'r' or s == 'b':
                    p = root
                elif s == '5':
                    p = c.root_note(floor) + 7
                    if p > floor + 14:
                        p -= 12
                elif s == '8':
                    p = root + 12
                elif s == '3':
                    third = [i for i in c.intervals if i in (3, 4)]
                    p = c.root_note(floor) + (third[0] if third else 7)
                elif s.lstrip('-').isdigit():
                    p = root + int(s)
                else:
                    raise ValueError(s)
                v = base_vel
                if accs and accs[i % len(accs)] == '>':
                    v = min(1.0, v + 0.14)
                part.note(t + pos, p, min(d, beats - pos), vel=v, art=_art(part, art))
            pos += d
            i += 1
        t += beats
    return t


def drums(part: Part, bar: float, grid: dict, step: float = 0.25, vel: float = 0.75,
          keys=None, bars: int | None = None, ramp: float = 0.0):
    """Drum grid. grid: {'kick': 'x...x...', ...}; chars per step:
    X accent, x hit, o ghost, f flam(two hits), '.' or '-' rest, '|' ignored."""
    from .instruments import INSTRUMENTS
    keys = keys or INSTRUMENTS[part.inst].get('keys') or (
        ORCH_KEYS if part.inst == 'orch_perc' else DRUM_KEYS)
    t0 = part.score.bar(bar)
    for name, pat in grid.items():
        key = keys[name] if isinstance(name, str) else name
        cells = [c for c in pat if c != '|' and c != ' ']
        for i, c in enumerate(cells):
            if c in '.-':
                continue
            v = {'X': min(1.0, vel + 0.18), 'x': vel, 'o': vel * 0.45, 'f': vel}[c]
            if ramp:
                v = min(1.0, v * (1 - ramp + ramp * (i + 1) / len(cells)))
            part.note(t0 + i * step, key, step, vel=v)
            if c == 'f':
                part.note(t0 + i * step - 0.03, key, step, vel=v * 0.55)
    return t0 + (bars * part.score.bar_beats if bars else 0)


def repeat_bars(part: Part, src_bar: float, n_bars: float, dst_bar: float, times: int = 1,
                transpose: int = 0, vel_scale: float = 1.0):
    """Copy the notes of [src_bar, src_bar+n_bars) to dst_bar (times over)."""
    s = part.score
    a, b = s.bar(src_bar), s.bar(src_bar + n_bars)
    src = [n for n in part.notes if a - 1e-9 <= n.start < b - 1e-9]
    span = b - a
    for k in range(times):
        off = s.bar(dst_bar) + k * span - a
        for n in src:
            part.notes.append(type(n)(**{**n.__dict__, 'start': n.start + off,
                                         'pitch': n.pitch + transpose,
                                         'vel': min(1.0, n.vel * vel_scale)}))


class Kit:
    """A drum kit split into per-piece parts (kick / snare / toms / cymbals) so
    each can be EQ'd and balanced like a real multitrack; grids are routed by
    piece name."""

    PIECES = {
        'kick': ('kick', 'kick2'),
        'snare': ('snare', 'snare_off', 'rim', 'stick', 'xstick', 'flam', 'roll', 'buzz', 'clap'),
        'toms': ('tom_lo', 'tom_floor', 'tom_mid', 'tom_hi', 'tom_rim'),
        'cym': ('hat', 'hat_pedal', 'hat_open', 'crash', 'crash2', 'ride', 'ride_bell', 'splash',
                'china', 'tamb', 'shaker', 'cowbell'),
    }
    OPTS = {
        'kick': dict(role='kick', eq=[('peak', 60, 0.9, 3.0), ('peak', 380, 1.0, -4.0),
                                      ('peak', 3800, 1.0, 3.5)], duckable=False),
        'snare': dict(role='snare', eq=[('peak', 200, 1.0, 2.0), ('peak', 900, 1.0, -2.0),
                                        ('peak', 5000, 0.8, 2.0)]),
        'toms': dict(role='toms', eq=[('peak', 400, 1.0, -3.0), ('peak', 4000, 1.0, 2.0)]),
        'cym': dict(role='cym', hpf=280, eq=[('highshelf', 9000, 0.7, -2.5)]),
    }

    def __init__(self, score, prefix='kit', inst='kit', gains=None):
        self.score = score
        self.parts = {}
        for piece, opts in self.OPTS.items():
            o = {k: v for k, v in opts.items() if k != 'duckable'}
            o['gain'] = (gains or {}).get(piece, 0.0)
            self.parts[piece] = score.part(f'{prefix}_{piece}', inst, **o)
        self.route = {n: piece for piece, names in self.PIECES.items() for n in names}

    def play(self, bar, grid, vel=0.74, ramp=0.0, step=None):
        if step is None:
            cells = max(len([c for c in p if c not in '| ']) for p in grid.values())
            step = self.score.bar_len(bar) / cells if cells >= 4 else 0.25
        by_piece = {}
        for name, pat in grid.items():
            by_piece.setdefault(self.route[name], {})[name] = pat
        for piece, g in by_piece.items():
            drums(self.parts[piece], bar, g, step=step, vel=vel, ramp=ramp)

    def names(self):
        return [p.name for p in self.parts.values()]


def pad_under(part: Part, bar: float, ch, melody: Part, n: int = 3, lo: int = 43, gap: int = 2,
              vel=None, art=None):
    """Voice each chord in n parts beneath a melody: the top of the voicing
    stays at least `gap` semitones under the lowest melody note sounding in
    that chord's span (chorale-style harmonisation)."""
    t = part.score.bar(bar)
    prev = None
    for c, beats in ch:
        mel = [m.pitch for m in melody.notes if m.start < t + beats - 1e-6 and m.end > t + 1e-6]
        hi = (min(mel) - gap) if mel else lo + 24
        v = voice_lead(prev, c, n, lo, max(hi, lo + 7))
        for p in v:
            part.note(t, p, beats, vel=vel, art=_art(part, art), rearticulate=True)
        prev = v
        t += beats
    return t
