"""Pitch, chord and scale helpers.

Pitch names use scientific notation with C4 = MIDI 60. Accidentals: '#', 'b'
(and 'x' / 'bb' for double sharp / flat).
"""

from __future__ import annotations

import re

_LETTER_PC = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}
_PITCH_RE = re.compile(r'^([A-Ga-g])(bb|b|#|x)?(-?\d+)$')
_ACC = {None: 0, '': 0, '#': 1, 'x': 2, 'b': -1, 'bb': -2}


def pitch(name) -> int:
    """'C4' -> 60, 'F#3' -> 54, 'Bb2' -> 46. Integers pass through."""
    if isinstance(name, int):
        return name
    m = _PITCH_RE.match(name.strip())
    if not m:
        raise ValueError(f'bad pitch name: {name!r}')
    letter, acc, octave = m.groups()
    return 12 * (int(octave) + 1) + _LETTER_PC[letter.upper()] + _ACC[acc]


def pc(name) -> int:
    """Pitch class of a note name without octave ('F#' -> 6)."""
    m = re.match(r'^([A-Ga-g])(bb|b|#|x)?$', name.strip())
    if not m:
        raise ValueError(f'bad pitch class: {name!r}')
    letter, acc = m.groups()
    return (_LETTER_PC[letter.upper()] + _ACC[acc]) % 12


def hz(midi: float) -> float:
    return 440.0 * 2 ** ((midi - 69) / 12)


NAMES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']


def name(midi: int) -> str:
    return f'{NAMES_SHARP[midi % 12]}{midi // 12 - 1}'


# ---------------------------------------------------------------- chords

# Quality suffix -> intervals above the root (bass handled separately).
CHORD_QUALITIES = {
    '': [0, 4, 7],
    'maj': [0, 4, 7],
    'm': [0, 3, 7],
    'dim': [0, 3, 6],
    'aug': [0, 4, 8],
    '5': [0, 7],
    'sus2': [0, 2, 7],
    'sus4': [0, 5, 7],
    'sus': [0, 5, 7],
    '6': [0, 4, 7, 9],
    'm6': [0, 3, 7, 9],
    '7': [0, 4, 7, 10],
    'maj7': [0, 4, 7, 11],
    'm7': [0, 3, 7, 10],
    'mmaj7': [0, 3, 7, 11],
    'm7b5': [0, 3, 6, 10],
    'dim7': [0, 3, 6, 9],
    '7sus4': [0, 5, 7, 10],
    'add9': [0, 4, 7, 14],
    'madd9': [0, 3, 7, 14],
    '9': [0, 4, 7, 10, 14],
    'm9': [0, 3, 7, 10, 14],
    'maj9': [0, 4, 7, 11, 14],
    '7b9': [0, 4, 7, 10, 13],
    'm11': [0, 3, 7, 10, 14, 17],
    '5add9': [0, 7, 14],
    'maj7#11': [0, 4, 7, 11, 18],
}

_CHORD_RE = re.compile(r'^([A-G](?:b|#)?)([^/]*)(?:/([A-G](?:b|#)?))?$')


class Chord:
    __slots__ = ('symbol', 'root', 'intervals', 'bass')

    def __init__(self, symbol: str):
        m = _CHORD_RE.match(symbol.strip())
        if not m:
            raise ValueError(f'bad chord symbol: {symbol!r}')
        root, qual, bass = m.groups()
        if qual not in CHORD_QUALITIES:
            raise ValueError(f'unknown chord quality {qual!r} in {symbol!r}')
        self.symbol = symbol
        self.root = pc(root)
        self.intervals = CHORD_QUALITIES[qual]
        self.bass = pc(bass) if bass else self.root

    @property
    def pcs(self):
        return sorted({(self.root + i) % 12 for i in self.intervals})

    def tones_in_range(self, lo: int, hi: int):
        """All chord-tone MIDI pitches in [lo, hi]."""
        pcs = set(self.pcs)
        return [p for p in range(lo, hi + 1) if p % 12 in pcs]

    def bass_note(self, octave_floor: int) -> int:
        """Lowest bass pitch >= octave_floor."""
        p = octave_floor + ((self.bass - octave_floor) % 12)
        return p

    def root_note(self, floor: int) -> int:
        return floor + ((self.root - floor) % 12)

    def __repr__(self):
        return f'Chord({self.symbol})'


def voice_lead(prev: list[int] | None, chord: Chord, n: int, lo: int, hi: int,
               spread: bool = False) -> list[int]:
    """Pick n chord tones in [lo, hi] close to the previous voicing.

    Every chord pitch class is covered when n allows. Brute force over the
    candidate combinations is fine at orchestral voice counts (n <= 5).
    """
    from itertools import combinations

    cands = chord.tones_in_range(lo, hi)
    pcs = chord.pcs
    best, best_cost = None, None
    for combo in combinations(cands, n):
        covered = {p % 12 for p in combo}
        need = min(n, len(pcs))
        if len(covered) < need:
            continue
        # avoid seconds between upper voices unless the chord needs them
        gaps = [b - a for a, b in zip(combo, combo[1:])]
        if min(gaps, default=12) < (3 if spread else 1):
            continue
        if prev:
            cost = sum(abs(a - b) for a, b in zip(sorted(prev), combo))
        else:
            mid = (lo + hi) / 2
            cost = sum(abs(p - mid) for p in combo) * 0.25
        # prefer the root or fifth on top less than the third: neutral
        if best_cost is None or cost < best_cost:
            best, best_cost = list(combo), cost
    if best is None:
        # fall back without coverage constraint
        best = cands[:n] if len(cands) >= n else cands
    return best


def scale(root: str, mode: str) -> list[int]:
    """Pitch classes of a mode starting from root."""
    modes = {
        'major': [0, 2, 4, 5, 7, 9, 11],
        'ionian': [0, 2, 4, 5, 7, 9, 11],
        'dorian': [0, 2, 3, 5, 7, 9, 10],
        'phrygian': [0, 1, 3, 5, 7, 8, 10],
        'lydian': [0, 2, 4, 6, 7, 9, 11],
        'mixolydian': [0, 2, 4, 5, 7, 9, 10],
        'minor': [0, 2, 3, 5, 7, 8, 10],
        'aeolian': [0, 2, 3, 5, 7, 8, 10],
        'harmonic': [0, 2, 3, 5, 7, 8, 11],
        'locrian': [0, 1, 3, 5, 6, 8, 10],
    }
    r = pc(root)
    return [(r + i) % 12 for i in modes[mode]]
