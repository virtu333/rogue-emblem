"""Score model and the note-string notation used by the compositions.

Notation (whitespace separated tokens):

    D5q  F#4e.  Bb3h~  [D4 F4 A4]q>  rq  | @mf  %spic  D5:1.5

  pitch      C4 = MIDI 60; accidentals # b x bb
  duration   w h q e s x (32nd); dots; '3' = triplet (e3); '+' joins (h+e);
             ':1.5' = explicit beats. Omitted -> previous duration.
  modifiers  ~ tie into next same pitch   ' staccato   > accent
             ^ marcato   _ tenuto (full length)   ! re-articulate (no legato)
  rests      r<dur>
  chords     [p p p]<dur><mods>
  control    |  bar check (cursor must sit on a barline)
             @pp..@fff or @0.7  velocity      %name  articulation switch
             <n  transpose following notes by n semitones (<0 resets)

Beats are quarter notes. Bars are 1-based.
"""

from __future__ import annotations

import bisect
import re
from dataclasses import dataclass, field

from .theory import pitch as parse_pitch

DYNAMICS = {
    'ppp': 0.16, 'pp': 0.26, 'p': 0.38, 'mp': 0.5, 'mf': 0.62,
    'f': 0.76, 'ff': 0.88, 'fff': 1.0,
}
DUR_LETTERS = {'w': 4.0, 'h': 2.0, 'q': 1.0, 'e': 0.5, 's': 0.25, 'x': 0.125}

_TOKEN_RE = re.compile(r'\[[^\]]*\]\S*|\S+')
_DUR_PART = r'[whqesx]\.{0,2}3?'
_NOTE_RE = re.compile(
    r'^(?P<p>[A-G](?:bb|b|#|x)?-?\d)'
    r'(?P<d>(?:' + _DUR_PART + r')(?:\+' + _DUR_PART + r')*|:[0-9./]+)?'
    r'(?P<m>[~\'>^_!]*)$'
)
_CHORD_RE = re.compile(
    r'^\[(?P<ps>[^\]]*)\]'
    r'(?P<d>(?:' + _DUR_PART + r')(?:\+' + _DUR_PART + r')*|:[0-9./]+)?'
    r'(?P<m>[~\'>^_!]*)$'
)
_REST_RE = re.compile(
    r'^r(?P<d>(?:' + _DUR_PART + r')(?:\+' + _DUR_PART + r')*|:[0-9./]+)?$'
)


def parse_duration(spec: str) -> float:
    if spec.startswith(':'):
        val = spec[1:]
        if '/' in val:
            a, b = val.split('/')
            return float(a) / float(b)
        return float(val)
    total = 0.0
    for part in spec.split('+'):
        base = DUR_LETTERS[part[0]]
        rest = part[1:]
        trip = rest.endswith('3')
        if trip:
            rest = rest[:-1]
        dots = len(rest)
        val = base * (2 - 0.5 ** dots)
        if trip:
            val *= 2 / 3
        total += val
    return total


@dataclass
class Note:
    start: float          # beats
    dur: float            # written beats
    pitch: int
    vel: float            # 0..1
    art: str = 'default'
    staccato: bool = False
    tenuto: bool = False
    rearticulate: bool = False
    tie: bool = False
    gate: float = 1.0     # fraction of written length actually held

    @property
    def end(self):
        return self.start + self.dur


@dataclass
class Part:
    score: 'Score'
    name: str
    inst: str
    opts: dict = field(default_factory=dict)
    notes: list = field(default_factory=list)
    expr_points: list = field(default_factory=list)   # (beat, 0..1)
    cursor: float = 0.0
    vel: float = 0.62
    art: str = 'default'
    transpose: int = 0
    _last_dur: float = 1.0
    _bar_anchor: float = 0.0

    # ------------------------------------------------------------ cursor
    def at(self, bar: float) -> 'Part':
        """Move the cursor to the start of a (1-based, may be fractional) bar."""
        self.cursor = self.score.bar(bar)
        self._bar_anchor = self.cursor
        return self

    def at_beat(self, beat: float) -> 'Part':
        self.cursor = beat
        self._bar_anchor = beat
        return self

    def rest(self, beats: float) -> 'Part':
        self.cursor += beats
        return self

    # ------------------------------------------------------------ writing
    def play(self, text: str, vel: float | None = None, art: str | None = None,
             transpose: int | None = None, times: int = 1, gate: float = 1.0) -> 'Part':
        if vel is not None:
            self.vel = vel
        if art is not None:
            self.art = art
        # transposition is scoped to this call (and '<n' tokens to this text)
        self.transpose = transpose or 0
        try:
            for _ in range(times):
                self._parse(text, gate)
        finally:
            self.transpose = 0
        return self

    def note(self, beat: float, p, dur: float, vel: float | None = None,
             art: str | None = None, **flags) -> Note:
        n = Note(start=beat, dur=dur, pitch=parse_pitch(p),
                 vel=self.vel if vel is None else vel,
                 art=art or self.art, **flags)
        self.notes.append(n)
        return n

    def expr(self, *points) -> 'Part':
        """Expression automation: expr((bar, value), ...) with bar positions.

        Values are 0..1 multipliers (1 = full). Linear between points.
        """
        for bar, value in points:
            self.expr_points.append((self.score.bar(bar), float(value)))
        self.expr_points.sort()
        return self

    def expr_beats(self, *points) -> 'Part':
        for beat, value in points:
            self.expr_points.append((beat, float(value)))
        self.expr_points.sort()
        return self

    # ------------------------------------------------------------ parser
    def _parse(self, text: str, gate: float):
        # '@mp' + 'F3w' style concatenations: split a dynamic glued to a note
        text = re.sub(r'(@(?:ppp|pp|mp|mf|fff|ff|p|f|[0-9.]+))(?=[A-Gr\[<|])', r'\1 ', text)
        text = text.replace('|', ' | ')
        pending_ties: dict[int, Note] = {}
        for tok in _TOKEN_RE.findall(text):
            if tok == '|':
                bar_len = self.score.bar_beats
                off = (self.cursor - self._bar_anchor) % bar_len
                if min(off, bar_len - off) > 1e-6:
                    raise ValueError(
                        f'{self.score.name}/{self.name}: bar check failed at beat '
                        f'{self.cursor:.3f} (offset {off:.3f}) near {text[:60]!r}')
                continue
            if tok.startswith('@'):
                v = tok[1:]
                self.vel = DYNAMICS[v] if v in DYNAMICS else float(v)
                continue
            if tok.startswith('%'):
                self.art = tok[1:]
                continue
            if tok.startswith('<'):
                self.transpose = int(tok[1:])
                continue
            m = _REST_RE.match(tok)
            if m:
                pending_ties.clear()          # a rest breaks any tie
                d = parse_duration(m.group('d')) if m.group('d') else self._last_dur
                self._last_dur = d
                self.cursor += d
                continue
            m = _NOTE_RE.match(tok)
            if m:
                pitches = [m.group('p')]
            else:
                m = _CHORD_RE.match(tok)
                if not m:
                    raise ValueError(f'{self.score.name}/{self.name}: bad token {tok!r}')
                pitches = m.group('ps').split()
            d = parse_duration(m.group('d')) if m.group('d') else self._last_dur
            self._last_dur = d
            mods = m.group('m')
            vel = self.vel
            if '>' in mods:
                vel = min(1.0, vel + 0.12)
            if '^' in mods:
                vel = min(1.0, vel + 0.2)
            here = {parse_pitch(pn) + self.transpose for pn in pitches}
            for stale in [p for p in pending_ties if p not in here]:
                del pending_ties[stale]       # a tie only joins the very next event
            for pname in pitches:
                p = parse_pitch(pname) + self.transpose
                if p in pending_ties:
                    prev = pending_ties.pop(p)
                    prev.dur += d
                    if '~' in mods:
                        pending_ties[p] = prev
                    continue
                n = Note(start=self.cursor, dur=d, pitch=p, vel=vel, art=self.art,
                         staccato="'" in mods, tenuto='_' in mods,
                         rearticulate='!' in mods or '^' in mods, gate=gate)
                if '^' in mods:
                    n.gate = min(n.gate, 0.75)
                self.notes.append(n)
                if '~' in mods:
                    pending_ties[p] = n
            self.cursor += d


class Score:
    """A piece: tempo, meter, parts, loop structure and mix variants."""

    def __init__(self, name: str, bpm: float, meter=(4, 4), intro_bars: float = 0,
                 loop_bars: float = 16, title: str | None = None, seed: int = 1,
                 tonic: str | None = None, one_shot: bool = False, transpose: int = 0):
        self.name = name
        # home key's pitch class (e.g. 'D', 'Db'): stingers are rendered to match it
        self.tonic = tonic
        # a cue that plays once (a stinger): no loop region, the tail rings out
        self.one_shot = one_shot
        if one_shot:
            loop_bars = 0
        # semitones applied to every pitched note at render time
        self.transpose = transpose
        self.silent_ok: set = set()
        self.title = title or name
        self.meter = meter
        self.bar_beats = meter[0] * 4 / meter[1]
        self.intro_bars = intro_bars
        self.loop_bars = loop_bars
        self.seed = seed
        self.parts: dict[str, Part] = {}
        # tempo segments: list of (beat, bpm) piecewise constant, or ramps
        self._tempo = [(0.0, float(bpm), None)]  # (beat, bpm, ramp_end_bpm)
        self.variants: dict[str, dict] = {'full': {}}
        self.variant_keys: dict[str, str] = {}   # variant -> output key override
        self.whole_loop: set = set()             # variants exported as one loop period
        self.targets_lufs: dict[str, float] = {}
        self.master: dict = {}
        self.reverb: dict = {}
        self.notes_text = ''

    # ------------------------------------------------------------ time
    def bar(self, n: float) -> float:
        return (n - 1) * self.bar_beats

    @property
    def intro_beats(self):
        return self.intro_bars * self.bar_beats

    @property
    def loop_beats(self):
        return self.loop_bars * self.bar_beats

    def tempo(self, bar: float, bpm: float, ramp_to: float | None = None):
        """Set tempo from a bar on. With ramp_to, tempo glides linearly (in
        beats) from bpm to ramp_to until the next tempo mark."""
        beat = self.bar(bar)
        self._tempo = [t for t in self._tempo if t[0] != beat]
        bisect.insort(self._tempo, (beat, float(bpm), ramp_to))
        return self

    def seconds(self, beat: float) -> float:
        """Beat -> seconds, honoring piecewise tempo and linear ramps."""
        t = 0.0
        segs = self._tempo
        for i, (b0, bpm, ramp) in enumerate(segs):
            b1 = segs[i + 1][0] if i + 1 < len(segs) else float('inf')
            if beat <= b0:
                break
            span = min(beat, b1) - b0
            if ramp is None or b1 == float('inf'):
                t += span * 60.0 / bpm
            else:
                # bpm varies linearly with beat: dt = 60/bpm(b) db
                import math
                k = (ramp - bpm) / (b1 - b0)
                if abs(k) < 1e-9:
                    t += span * 60.0 / bpm
                else:
                    t += 60.0 / k * math.log((bpm + k * span) / bpm)
            if beat <= b1:
                break
        return t

    def bpm_at(self, beat: float) -> float:
        cur = self._tempo[0][1]
        for b0, bpm, _ in self._tempo:
            if b0 <= beat:
                cur = bpm
        return cur

    # ------------------------------------------------------------ parts
    def part(self, name: str, inst: str, **opts) -> Part:
        if name in self.parts:
            raise ValueError(f'duplicate part {name}')
        p = Part(score=self, name=name, inst=inst, opts=opts)
        self.parts[name] = p
        return p

    def variant(self, name: str, gains: dict | None = None, lufs: float | None = None):
        """Declare a mix variant. gains: {part_name_or_glob: dB or None(mute)}."""
        self.variants[name] = gains or {}
        if lufs is not None:
            self.targets_lufs[name] = lufs
        return self
