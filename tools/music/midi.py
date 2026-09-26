#!/usr/bin/env python3
"""Export the scores as Standard MIDI Files, for playing, studying or arranging
the music outside the game.

  python3 tools/music/midi.py --all                   # every loop score and stinger
  python3 tools/music/midi.py battle_act1 title       # some scores
  python3 tools/music/midi.py --stingers levelup      # some stingers (none listed: all)
  python3 tools/music/midi.py --all --out /tmp/midi   # somewhere else

Files go to midi/music/<key>.mid and midi/stingers/stinger_<name>.mid, named
like the rendered MP3s: one file per mix variant, holding exactly the parts
that mix plays (`music_battle_act1_calm.mid`, `music_boss_act1_enrage_warchief.mid`).

What a file holds (type 1, 960 ticks per quarter):
  * a conductor track: the title, tempo map (a ramp becomes steps every 32nd
    whose lengths match the score's timing), meters, key signature and, for a
    loop, `loopStart` / `loopEnd` markers around the loop body;
  * one track per part, named after the part and its instrument, with the
    written notes: pitch (the score's transposition applied), velocity from the
    dynamics and accents, length from the written value, staccato and gate;
  * General MIDI sounds, one program per channel, so any GM player plays it
    as scored. A part that changes articulation to a different GM sound
    (strings to pizzicato or tremolo) moves to that sound's channel.

A score often has more parts than MIDI has channels. Parts that share a sound
share a channel; parts are kept on their own channel, most distinctive first,
while channels last (a part that would clash with another on the same keys,
or whose expression or level differs). If a mix has more GM sounds than 15
channels hold, the rarest moves to its nearest sound (tuba to trombones).
A channel's volume (CC7) carries its mix level and its expression (CC11) the
part's expression lane when the channel holds that part alone. Where parts
with different levels or lanes share a channel, the difference goes into
their velocities instead. Levels follow GM's curve
(amplitude ~ value squared), so a -6 dB part plays at 10^(-6/40) of the value.

Percussion plays on channel 10 on the GM/GS drum map. Timpani rolls and the
suspended-cymbal swells (sustained samples in the renders) are written out as
single-stroke rolls, a swell with its crescendo, so a GM player rolls them.
A whole-loop mix (the login screen's) starts at the loop, as the game plays it.

Needs only `mido` (plus what the scores import).
"""

from __future__ import annotations

import argparse
import fnmatch
import importlib
import math
import os
import sys
import unicodedata

import mido

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from engine.instruments import INSTRUMENTS  # noqa: E402
from engine.score import Score  # noqa: E402

# Score keeps a meter change only as beats per bar, and 6/8 and 3/4 both have
# three: remember the written meter too, so the file carries the real one.
_meter_change = Score.meter_change


def _recording_meter_change(self, bar, meter):
    if not hasattr(self, 'written_meters'):
        self.written_meters = {}
    self.written_meters[int(bar)] = tuple(meter)
    return _meter_change(self, bar, meter)


Score.meter_change = _recording_meter_change

ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(ROOT, 'midi')
PPQ = 960
DRUM_CH = 9
MAX_CH = 16

# ------------------------------------------------------------------ sounds
# General MIDI program (0-based) per instrument, and per articulation where
# the articulation is a different sound. Unlisted articulations use 'default'.
STRINGS = {'default': 48, 'sus': 48, 'soft': 49, 'spic': 48, 'stac': 48, 'pizz': 45,
           'trem': 44}
GM_PROGRAM = {
    'violins': STRINGS, 'violins2': STRINGS, 'violas': STRINGS, 'celli': STRINGS,
    'basses': STRINGS,
    'solo_violin': {'default': 40, 'pizz': 45},
    'horns': {'default': 60},
    'trumpets': {'default': 56, 'mute': 59},
    'trombones': {'default': 57},
    'tuba': {'default': 58},
    'flute': {'default': 73},
    'piccolo': {'default': 72},
    'oboe': {'default': 68},
    'clarinet': {'default': 71},
    'bassoon': {'default': 70},
    'harp': {'default': 46},
    'celesta': {'default': 8},
    'glock': {'default': 9},
    'bells': {'default': 14},
    'marimba': {'default': 12},
    'organ': {'default': 19},
    'timpani': {'default': 47},
    'accordion': {'default': 21},
    'choir': {'default': 52},
    'oohs': {'default': 53},
    'grand': {'default': 0},
    'nylon': {'default': 24},
    'rbass': {'default': 33},
    'taiko': {'default': 116},
    'sub': {'default': 38},       # Synth Bass 1
    'pad': {'default': 89},       # Pad 2 (warm)
    'shimmer': {'default': 94},   # Pad 7 (halo)
    'drone': {'default': 92},     # Pad 5 (bowed)
    'boom': {'default': 118},     # Synth Drum
    'riser': {'default': 119},    # Reverse Cymbal
    'reverse': {'default': 119},
}
DRUM_INSTS = {'kit', 'orch_perc'}

# When a mix needs more GM sounds than there are channels, the sound with the
# fewest notes moves to its nearest neighbour here (earlier = nearer). Tracks
# keep their instrument names; only the GM sound is approximate.
SUBSTITUTES = {
    49: [48], 44: [48, 49], 45: [48, 46], 40: [48, 41], 59: [56, 60], 56: [59, 60],
    57: [58, 60], 58: [57], 60: [57, 56], 72: [73], 73: [72, 71], 68: [71, 73],
    71: [68, 70], 70: [71, 58], 53: [52], 52: [53], 8: [9, 14], 9: [8, 14],
    14: [9, 8], 12: [8, 9], 46: [24, 0], 24: [46, 0], 0: [46, 24], 19: [21, 89],
    21: [19], 47: [116, 118], 116: [47, 118], 118: [116, 47], 38: [33], 33: [38],
    89: [92, 94], 92: [89, 94], 94: [89, 92], 119: [92, 89],
}

# Percussion keys -> GM/GS drum map. The rock kit uses the Virtuosity Drums
# keymap (mostly GM already); orch_perc uses VSCO's GM-style map.
# Keys not listed are the same on both maps.
KIT_TO_GM = {88: 37, 95: 38, 96: 38, 93: 38, 39: 38, 45: 37, 43: 45}
ORCH_TO_GM = {
    32: 35, 33: 35, 34: 35, 35: 35,   # bass drum rubs
    36: 35,                           # concert bass drum (the rock kick keeps 36)
    37: 38, 38: 38, 39: 38, 40: 38, 41: 38,   # snare taps / hits / rolls, snares on and off
    42: 52, 46: 52,                   # gong scrape / hit -> Chinese cymbal
    49: 49,                           # clash cymbals
    51: 57, 59: 59,                   # suspended cymbal: mallet, stick
    53: 54, 54: 54, 55: 54,           # tambourine
    56: 56, 67: 56, 68: 56,           # cowbell, anvil, brake drum
    60: 62, 61: 63, 62: 62, 63: 63, 64: 64, 65: 64,   # quinto, conga, tumba: tap / open
    69: 74, 70: 74, 71: 74, 72: 73,   # ratchet -> long guiro, guiro
    75: 75, 76: 76, 77: 77,           # claves, log drums (wood blocks)
    78: 80, 79: 81, 80: 80, 81: 81,   # triangles
    82: 83, 83: 84, 84: 84, 85: 84, 86: 84,   # sleigh bells, bell tree (GS)
}
# Swelling cymbals (sustained samples in the renders) -> a suspended-cymbal
# roll with a crescendo: key -> (GM key, seconds, crescendo). The length is
# where each VSCO sample peaks, capped at the renderer's 6 s one-shot limit:
# the crescendo swells (short, median, long) and the bowed cymbals.
ORCH_ROLLS = {47: (57, 1.43, True), 48: (57, 3.57, True), 50: (57, 6.0, True),
              101: (57, 3.73, True), 102: (57, 1.19, True), 103: (57, 6.0, True),
              104: (57, 4.32, True)}
ROLLED_ARTS = {('timpani', 'roll')}

INSTRUMENT_NAMES = {
    'violins': 'Violins I', 'violins2': 'Violins II', 'violas': 'Violas', 'celli': 'Cellos',
    'basses': 'Double Basses', 'solo_violin': 'Solo Violin', 'horns': 'Horns',
    'trumpets': 'Trumpets', 'trombones': 'Trombones', 'tuba': 'Tuba', 'flute': 'Flute',
    'piccolo': 'Piccolo', 'oboe': 'Oboe', 'clarinet': 'Clarinet', 'bassoon': 'Bassoon',
    'harp': 'Harp', 'celesta': 'Celesta', 'glock': 'Glockenspiel', 'bells': 'Tubular Bells',
    'marimba': 'Marimba', 'organ': 'Organ', 'timpani': 'Timpani',
    'orch_perc': 'Orchestral Percussion', 'accordion': 'Accordion', 'choir': 'Choir',
    'oohs': 'Choir (oohs)', 'kit': 'Drum Kit', 'rbass': 'Bass Guitar', 'grand': 'Piano',
    'nylon': 'Nylon Guitar', 'taiko': 'Taiko', 'sub': 'Sub Bass (synth)',
    'pad': 'Pad (synth)', 'shimmer': 'Shimmer (synth)', 'drone': 'Drone (synth)',
    'boom': 'Boom (synth)', 'riser': 'Riser (synth)', 'reverse': 'Reverse Swell (synth)',
}

KEY_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']
# Key signature (sharps > 0, flats < 0) -> mido's key names.
SIG_MAJOR = {0: 'C', 1: 'G', 2: 'D', 3: 'A', 4: 'E', 5: 'B', 6: 'F#', -1: 'F', -2: 'Bb',
             -3: 'Eb', -4: 'Ab', -5: 'Db', -6: 'Gb'}
SIG_MINOR = {0: 'Am', 1: 'Em', 2: 'Bm', 3: 'F#m', 4: 'C#m', 5: 'G#m', 6: 'D#m', -1: 'Dm',
             -2: 'Gm', -3: 'Cm', -4: 'Fm', -5: 'Bbm', -6: 'Ebm'}

# The renderer's one-shot stand-in region (render.py): an expression lane in a
# stinger is periodic over it, exactly as rendered.
M_MIN = 4.0


def text(s: str) -> str:
    """MIDI text is Latin-1: fold typographic characters to ASCII."""
    s = s.replace('—', '-').replace('–', '-').replace('’', "'")
    s = s.replace('‘', "'").replace('“', '"').replace('”', '"')
    s = unicodedata.normalize('NFKD', s)
    return s.encode('latin-1', 'ignore').decode('latin-1')


def variant_gain(gains: dict, name: str):
    """render._variant_gain: an exact name beats a glob; among globs the last
    listed wins. None mutes."""
    if name in gains:
        return gains[name]
    val = 0.0
    for pat, g in gains.items():
        if fnmatch.fnmatch(name, pat):
            val = g
    return val


def pitch_class(name: str) -> int:
    base = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}[name[0]]
    return (base + name[1:].count('#') - name[1:].count('b')) % 12


def level(db: float) -> float:
    """A gain in dB as a factor on a GM velocity / volume value."""
    return 10 ** (db / 40)


# ------------------------------------------------------------------ timing
class Timeline:
    """Beat -> tick, and the loop region the renderer uses (for lanes). A file
    may start later than the score (`start`, in beats): a whole-loop mix starts
    at the loop."""

    def __init__(self, s, start=0.0):
        self.s = s
        self.start = start
        self.I_b = s.intro_beats
        if s.one_shot:
            rt = max([s.reverb.get('rt60', 2.2)] + [2.0])
            need_s = max(M_MIN, 1.15 * rt) / 0.8 + 1.0
            self.P_b = math.ceil(need_s * s.bpm_at(max(0.0, self.I_b - 1e-6)) / 60)
        else:
            self.P_b = s.loop_beats
        self.I_s = s.seconds(self.I_b)
        self.P_s = s.seconds(self.I_b + self.P_b) - self.I_s

    def tick(self, beat: float) -> int:
        return max(0, int(round((beat - self.start) * PPQ)))

    def seconds(self, beat: float) -> float:
        """Seconds from the start of the file."""
        return self.s.seconds(max(beat, self.start)) - self.s.seconds(self.start)

    def lane(self, points):
        """render.Renderer._lane as a function of beats: intro points shape the
        intro, loop points are periodic over the loop (the last glides into the
        first a loop later)."""
        s = self.s
        I_b, E_b, P = self.I_b, self.I_b + self.P_b, self.P_s
        intro = [(s.seconds(b), v) for b, v in points if b < I_b - 1e-9]
        loop = sorted((s.seconds(b) - self.I_s, v) for b, v in points
                      if I_b - 1e-9 <= b <= E_b + 1e-9)
        if loop:
            if loop[-1][0] >= P - 1e-6 and len(loop) > 1:
                last = loop.pop()
                if loop[0][0] > 1e-6:
                    loop.insert(0, (0.0, last[1]))
            ext = [(t - P, v) for t, v in loop] + loop + [(t + P, v) for t, v in loop]

            def loop_val(tl):
                return _interp(tl % P, ext)
        else:
            const = intro[-1][1] if intro else 1.0

            def loop_val(tl):
                return const

        def value(beat):
            t = s.seconds(beat)
            if t >= self.I_s:
                return loop_val(t - self.I_s)
            if intro:
                return _interp(t, intro + [(self.I_s, loop_val(0.0))])
            return loop_val(0.0)
        return value


def _interp(x, pts):
    if x <= pts[0][0]:
        return pts[0][1]
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        if x <= x1:
            return y0 if x1 == x0 else y0 + (y1 - y0) * (x - x0) / (x1 - x0)
    return pts[-1][1]


def roll_strokes(s, start, end, bpm_target=14.0):
    """Single-stroke roll from `start` to `end` (beats): strokes at the note
    value (a power-of-two fraction of the beat) nearest 14 strokes a second."""
    bpm = s.bpm_at(start)
    n = min((2 ** k for k in range(0, 7)),
            key=lambda d: abs(math.log(bpm / 60 * d / bpm_target)))
    step = 1.0 / n
    out, b = [], start
    while b < end - 1e-9:
        out.append((b, min(step, end - b)))
        b += step
    return out


def beats_after(s, start, seconds):
    """The beat `seconds` after `start`, under the tempo map."""
    t0 = s.seconds(start)
    lo, hi = start, start + seconds * s.bpm_at(start) / 60 * 4 + 1
    for _ in range(60):
        mid = (lo + hi) / 2
        if s.seconds(mid) - t0 < seconds:
            lo = mid
        else:
            hi = mid
    return hi


# ------------------------------------------------------------------ export
class Voice:
    """One part's notes on one GM sound: the unit channels are made of."""

    def __init__(self, part, program, drums=False):
        self.part = part
        self.program = program
        self.drums = drums
        self.notes = []   # (beat, dur, key, vel 0..1)

    @property
    def name(self):
        return f'{self.part.name}:{self.program}'


class Channel:
    def __init__(self, voices, program, drums=False):
        self.voices = voices
        self.program = program
        self.drums = drums
        self.number = None

    @property
    def parts(self):
        return {v.part.name for v in self.voices}


class Exporter:
    def __init__(self, score, variant='full', title=None, tonic=None):
        self.s = score
        self.variant = variant
        self.title = title or score.title
        self.tonic = tonic if tonic is not None else score.tonic
        # a whole-loop mix (the login screen's) is heard as the loop alone
        self.whole_loop = variant in score.whole_loop
        self.tl = Timeline(score, start=score.intro_beats if self.whole_loop else 0.0)
        gains = score.variants.get(variant, {})
        self.parts = []
        self.gain = {}
        for p in score.parts.values():
            g = variant_gain(gains, p.name)
            if not self._notes(p) or g is None:
                continue
            self.parts.append(p)
            # the mix level: the part's own gain plus the variant's offset
            self.gain[p.name] = p.opts.get('gain', 0.0) + g
        self.lanes = {p.name: self.tl.lane(p.expr_points) for p in self.parts
                      if p.expr_points}
        self.expected = []   # (beat, channel, key) of every written note, for verify()

    # -------------------------------------------------------------- notes
    def _notes(self, p):
        return [n for n in p.notes if n.start >= self.tl.start - 1e-9]

    def _voices(self):
        s = self.s
        voices = {}
        for p in self.parts:
            inst = INSTRUMENTS[p.inst]
            drums = p.inst in DRUM_INSTS
            for n in sorted(self._notes(p), key=lambda n: (n.start, n.pitch)):
                art = n.art if n.art != 'default' else p.opts.get('art', 'default')
                if drums:
                    program = -1
                else:
                    table = GM_PROGRAM[p.inst]
                    program = table.get(art, table['default'])
                v = voices.setdefault((p.name, program), Voice(p, program, drums))
                key = n.pitch if inst.get('fixed_pitch') else n.pitch + s.transpose
                held = n.dur * (0.5 if n.staccato else 1.0) * (1.0 if n.tenuto else n.gate)
                start = max(self.tl.start, n.start)
                if p.inst == 'orch_perc' and key in ORCH_ROLLS:
                    gm, secs, cresc = ORCH_ROLLS[key]
                    end = beats_after(s, start, secs)
                    strokes = roll_strokes(s, start, end)
                    for i, (b, d) in enumerate(strokes):
                        f = (0.15 + 0.85 * i / max(1, len(strokes) - 1)) if cresc else 1.0
                        v.notes.append((b, d, gm, n.vel * f, i == 0))
                    continue
                if (p.inst, art) in ROLLED_ARTS:
                    for i, (b, d) in enumerate(roll_strokes(s, start, start + held)):
                        v.notes.append((b, d, key, n.vel, i == 0))
                    continue
                if p.inst == 'kit':
                    key = KIT_TO_GM.get(key, key)
                elif p.inst == 'orch_perc':
                    key = ORCH_TO_GM.get(key, key)
                v.notes.append((start, held, key, n.vel, True))
        return list(voices.values())

    # -------------------------------------------------------------- channels
    def _channels(self, voices):
        """Voices sharing a GM sound share a channel. While channels remain,
        split off the voice whose sharing costs the most (see cost())."""
        drum_voices = [v for v in voices if v.drums]
        pitched = [v for v in voices if not v.drums]
        groups = {}
        for v in pitched:
            groups.setdefault(v.program, []).append(v)
        chans = [Channel(vs, prog) for prog, vs in sorted(groups.items())]
        free = MAX_CH - 1 - len(chans)   # channel 10 is percussion in GM, used or not
        if free < 0:
            raise SystemExit(f'{self.s.name}/{self.variant}: {len(chans)} GM sounds need more '
                             f'than {MAX_CH - 1} channels')

        def cost(ch, v):
            """How many of v's notes lose something by sharing the channel, weighted:
            a key another member holds at the same time (a GM player cuts one of
            them short), its expression lane (baked into velocities), its mix
            level (the same), its instrument's seat and identity."""
            others = [o for o in ch.voices if o is not v]
            if not others:
                return 0.0
            c = 0.1
            if v.part.name in self.lanes:
                c += 1.0
            if abs(self.gain[v.part.name] - self._chan_gain(others)) > 1e-9:
                c += 0.5
            if all(o.part.inst != v.part.inst for o in others):
                c += 0.2
            return c * len(v.notes) + 1.0 * _clashes(v, others)

        while free > 0:
            best = None
            for ch in chans:
                if len(ch.voices) < 2:
                    continue
                for v in ch.voices:
                    c = cost(ch, v)
                    if c > 0 and (best is None or c > best[0]):
                        best = (c, ch, v)
            if best is None:
                break
            _, ch, v = best
            ch.voices.remove(v)
            chans.append(Channel([v], v.program))
            free -= 1
        numbers = [c for c in range(MAX_CH) if c != DRUM_CH]
        for ch, num in zip(sorted(chans, key=lambda c: (c.program, sorted(c.parts))), numbers):
            ch.number = num
        if drum_voices:
            d = Channel(drum_voices, 0, drums=True)
            d.number = DRUM_CH
            chans.append(d)
        return chans

    def _fit_programs(self, voices):
        """Merge GM sounds until they fit the 15 melodic channels, moving the
        fewest notes the shortest way each time. Returns the voices, a part's
        voices that now share a sound joined into one."""
        self.merged = []
        pitched = [v for v in voices if not v.drums]
        while True:
            count = {}
            for v in pitched:
                count[v.program] = count.get(v.program, 0) + len(v.notes)
            if len(count) <= MAX_CH - 1:
                break
            options = [(n * (1 + 0.5 * rank), p, q) for p, n in count.items()
                       for rank, q in enumerate(SUBSTITUTES.get(p, [])) if q in count]
            if not options:
                raise SystemExit(f'{self.s.name}/{self.variant}: {len(count)} GM sounds and '
                                 f'no substitute to merge')
            _, p, q = min(options)
            for v in pitched:
                if v.program == p:
                    v.program = q
            self.merged.append((p, q))
        joined = {}
        for v in voices:
            key = (v.part.name, v.program)
            if key in joined:
                joined[key].notes.extend(v.notes)
                joined[key].notes.sort(key=lambda n: (n[0], n[2]))
            else:
                joined[key] = v
        return list(joined.values())

    def _chan_gain(self, voices):
        # the loudest member sets the channel volume; quieter ones scale velocity
        return max(self.gain[v.part.name] for v in voices)

    # -------------------------------------------------------------- write
    def build(self) -> mido.MidiFile:
        s, tl = self.s, self.tl
        voices = self._fit_programs(self._voices())
        chans = self._channels(voices)
        mid = mido.MidiFile(type=1, ticks_per_beat=PPQ)
        conductor = mido.MidiTrack()
        mid.tracks.append(conductor)
        conductor.append(mido.MetaMessage('track_name', name=text(self.title), time=0))
        events = self._conductor()

        tracks = {}   # part name -> list of (tick, order, msg)
        order = {p.name: i for i, p in enumerate(self.parts)}
        voice_chan = {}
        for ch in chans:
            for v in ch.voices:
                voice_chan[v.name] = ch
        setup_done = set()
        for v in sorted(voices, key=lambda v: (order[v.part.name], v.program)):
            ch = voice_chan[v.name]
            evs = tracks.setdefault(v.part.name, [])
            if ch.number not in setup_done:
                setup_done.add(ch.number)
                evs.extend((0, 0, m) for m in self._setup(ch))
            lane = self.lanes.get(v.part.name)
            carries_lane = lane is not None and ch.parts == {v.part.name}
            if carries_lane:
                evs.extend((t, 1, m) for t, m in self._cc11(lane, v, ch.number))
            scale = level(self.gain[v.part.name] - self._chan_gain(ch.voices))
            by_key = {}
            for beat, dur, key, vel, written in v.notes:
                f = scale
                if lane is not None and not carries_lane:
                    f *= max(0.0, lane(beat)) ** 0.65
                on = tl.tick(beat)
                off = max(on + 1, tl.tick(beat + dur))
                mv = max(1, min(127, int(round(vel * f * 127))))
                by_key.setdefault(key, []).append([on, off, mv])
                if written:
                    self.expected.append((beat, ch.number, key))
            for key, notes in by_key.items():
                notes.sort()
                kept = []
                for n in notes:
                    if kept and n[0] == kept[-1][0]:
                        # the same key struck twice at once (a doubled chord tone)
                        kept[-1][1] = max(kept[-1][1], n[1])
                        kept[-1][2] = max(kept[-1][2], n[2])
                        continue
                    if kept and n[0] < kept[-1][1]:
                        kept[-1][1] = n[0]      # a key re-struck while it sounds
                    kept.append(n)
                for on, off, mv in kept:
                    evs.append((on, 3, mido.Message('note_on', channel=ch.number, note=key,
                                                    velocity=mv)))
                    evs.append((off, 2, mido.Message('note_off', channel=ch.number, note=key,
                                                     velocity=0)))
        end = max([tl.tick(tl.I_b + (0 if s.one_shot else tl.P_b))] +
                  [e[0] for evs in tracks.values() for e in evs])
        _write(conductor, events, end)
        for p in self.parts:
            if p.name not in tracks:
                continue
            tr = mido.MidiTrack()
            label = f'{p.name} ({INSTRUMENT_NAMES.get(p.inst, p.inst)})'
            tr.append(mido.MetaMessage('track_name', name=text(label), time=0))
            tr.append(mido.MetaMessage('instrument_name',
                                       name=text(INSTRUMENT_NAMES.get(p.inst, p.inst)), time=0))
            _write(tr, tracks[p.name], end)
            mid.tracks.append(tr)
        return mid

    def _conductor(self):
        s, tl = self.s, self.tl
        out = []
        out.append(_at(0, mido.MetaMessage('text', text=text(
            f'Rogue Dawn: {self.title}. Score {s.name}, mix "{self.variant}"'
            + (', the loop alone.' if self.whole_loop else '.')))))
        # meters (the one in force where the file starts, then each change)
        first = s.bar_at(tl.start) + 1
        for i, (bar, beats) in enumerate(s._meters):
            nxt = s._meters[i + 1][0] if i + 1 < len(s._meters) else None
            if nxt is not None and nxt <= first:
                continue
            num, den = _meter(s, bar, beats)
            cpc = 36 if den == 8 and num % 3 == 0 else (12 if den == 8 else 24)
            out.append(_at(tl.tick(s.bar(max(bar, first))), mido.MetaMessage(
                'time_signature', numerator=num, denominator=den, clocks_per_click=cpc,
                notated_32nd_notes_per_beat=8)))
        # key
        if self.tonic:
            out.append(_at(0, mido.MetaMessage('key_signature', key=self._key())))
        # tempo: steps, ramps as 32nd-note steps with exact lengths
        segs = s._tempo
        for i, (b0, bpm, ramp) in enumerate(segs):
            b1 = segs[i + 1][0] if i + 1 < len(segs) else None
            if b1 is not None and b1 <= tl.start + 1e-9:
                continue       # over before the file starts
            if ramp is None or b1 is None:
                out.append(_at(tl.tick(b0),
                               mido.MetaMessage('set_tempo', tempo=round(6e7 / bpm))))
                continue
            b = max(b0, tl.start)
            while b < b1 - 1e-9:
                e = min(b1, b + 0.125)
                us = (s.seconds(e) - s.seconds(b)) / (e - b) * 1e6
                out.append(_at(tl.tick(b), mido.MetaMessage('set_tempo', tempo=round(us))))
                b = e
        if not s.one_shot:
            out.append(_at(tl.tick(tl.I_b), mido.MetaMessage('marker', text='loopStart')))
            out.append(_at(tl.tick(tl.I_b + tl.P_b), mido.MetaMessage('marker', text='loopEnd')))
        return out

    def _key(self):
        """The key signature a copyist would write: the tonic's major or minor
        signature, whichever leaves fewer notes (by duration) needing
        accidentals, unless a modal collection does clearly better (by 5% of
        the music): then the mode's (E Phrygian and D Dorian: none). Named
        minor when the tonic's third in it is minor."""
        t = pitch_class(self.tonic)
        hist = [0.0] * 12
        for p in self.parts:
            if p.inst in DRUM_INSTS or INSTRUMENTS[p.inst].get('fixed_pitch'):
                continue
            for n in self._notes(p):
                hist[(n.pitch + self.s.transpose) % 12] += n.dur
        major = (0, 2, 4, 5, 7, 9, 11)

        def inside(k):
            return sum(hist[(k + i) % 12] for i in major)

        def sig(k):
            return (k * 7 + 6) % 12 - 6

        # collections holding the tonic and its fifth (no Locrian)
        modal = [k for k in range(12)
                 if (t - k) % 12 in major and (t + 7 - k) % 12 in major and (t - k) % 12 != 11]
        plain = [t, (t + 3) % 12]          # the tonic's major, and its minor's relative
        best_plain = max(plain, key=lambda k: (inside(k), -abs(sig(k))))
        best_modal = max(modal, key=lambda k: (inside(k), -abs(sig(k))))
        k = best_modal if inside(best_modal) > inside(best_plain) + 0.05 * sum(hist) \
            else best_plain
        sf = sig(k)
        if sf == -6 and '#' in self.tonic:
            sf = 6
        minor = (t + 3 - k) % 12 in major
        return (SIG_MINOR if minor else SIG_MAJOR)[sf]

    def _setup(self, ch):
        num = ch.number
        insts = [INSTRUMENTS[v.part.inst] for v in ch.voices]
        pan = sum(i.get('pan', 0.0) for i in insts) / len(insts)
        depth = sum(i.get('depth', 0.4) for i in insts) / len(insts)
        vol = 100 * level(self._chan_gain(ch.voices))
        msgs = []
        if not ch.drums:
            msgs.append(mido.Message('program_change', channel=num, program=ch.program))
        msgs += [
            mido.Message('control_change', channel=num, control=7,
                         value=max(0, min(127, round(vol)))),
            mido.Message('control_change', channel=num, control=10,
                         value=max(0, min(127, round(64 + 63 * pan)))),
            mido.Message('control_change', channel=num, control=11, value=127),
            mido.Message('control_change', channel=num, control=91,
                         value=round(100 * (0.25 + 0.45 * depth) * 0.6)),
        ]
        if any(v.part.opts.get('pedal') for v in ch.voices):
            msgs.append(mido.Message('control_change', channel=num, control=64, value=127))
        return msgs

    def _cc11(self, lane, v, num):
        """The part's expression lane on CC11, sampled every 32nd note."""
        tl = self.tl
        last_note = max(b + d for b, d, *_ in v.notes)
        end = max(last_note, tl.I_b + (0 if self.s.one_shot else tl.P_b))
        out, prev, b = [], None, tl.start
        while b <= end + 1e-9:
            val = max(0, min(127, round(127 * max(0.0, lane(b)) ** 0.65)))
            if val != prev:
                out.append((tl.tick(b), mido.Message('control_change', channel=num,
                                                     control=11, value=val)))
                prev = val
            b += 0.125
        return out


def _clashes(v, others):
    """v's notes that overlap a note of the same key in `others` without
    matching it exactly: on one channel a GM player shortens one of the two."""
    held = {}
    for o in others:
        for b, d, key, *_ in o.notes:
            held.setdefault(key, []).append((b, b + d))
    n = 0
    for b, d, key, *_ in v.notes:
        e = b + d
        for b2, e2 in held.get(key, ()):
            if b < e2 - 1e-9 and b2 < e - 1e-9 and (abs(b - b2) > 1e-9 or abs(e - e2) > 1e-9):
                n += 1
                break
    return n


def _meter(s, bar, beats):
    if bar == 1:
        return s.meter
    return getattr(s, 'written_meters', {})[bar]


def _at(tick, msg):
    return (tick, 0, msg)


def _write(track, events, end):
    events = sorted(events, key=lambda e: (e[0], e[1]))
    now = 0
    for tick, _, msg in events:
        track.append(msg.copy(time=tick - now))
        now = tick
    track.append(mido.MetaMessage('end_of_track', time=max(0, end - now)))


# ------------------------------------------------------------------ verify
def verify(ex: Exporter, mid: mido.MidiFile):
    """Read the file back: every written note is there, on its channel and key,
    at the time the score gives it (the tempo map included), and every note is
    released."""
    s = ex.s
    tempo = []
    for tr in mid.tracks[:1]:
        t = 0
        for m in tr:
            t += m.time
            if m.type == 'set_tempo':
                tempo.append((t, m.tempo))

    def secs(tick):
        out, last_t, last_us = 0.0, 0, 500000
        for t, us in tempo:
            if t >= tick:
                break
            out += (t - last_t) / PPQ * last_us / 1e6
            last_t, last_us = t, us
        return out + (tick - last_t) / PPQ * last_us / 1e6

    ons = {}
    open_keys = {}
    for tr in mid.tracks[1:]:
        t = 0
        for m in tr:
            t += m.time
            if m.type == 'note_on' and m.velocity > 0:
                ons.setdefault((m.channel, m.note), []).append(t)
                open_keys[(m.channel, m.note)] = open_keys.get((m.channel, m.note), 0) + 1
            elif m.type in ('note_off', 'note_on'):
                open_keys[(m.channel, m.note)] = open_keys.get((m.channel, m.note), 0) - 1
    stuck = {k: n for k, n in open_keys.items() if n > 0}
    if stuck:
        raise AssertionError(f'{s.name}: notes never released {stuck}')
    want = {}
    for beat, ch, key in ex.expected:
        want.setdefault((ch, key), []).append(beat)
    worst = 0.0
    for k, beats in want.items():
        got = sorted(ons.get(k, []))
        for b in beats:
            tick = ex.tl.tick(b)
            if tick not in got:
                raise AssertionError(f'{s.name}: missing note {k} at beat {b}')
            worst = max(worst, abs(secs(tick) - ex.tl.seconds(b)))
    if worst > 0.002:
        raise AssertionError(f'{s.name}: timing off by {worst * 1000:.2f} ms')
    return worst


# ------------------------------------------------------------------ main
def list_modules(folder):
    return sorted(f[:-3] for f in os.listdir(os.path.join(HERE, folder))
                  if f.endswith('.py') and not f.startswith('_'))


def save(ex, path):
    mid = ex.build()
    worst = verify(ex, mid)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    mid.save(path)
    chans = sorted({m.channel for tr in mid.tracks for m in tr if hasattr(m, 'channel')})
    print(f'  {os.path.relpath(path, ROOT)}: {len(mid.tracks) - 1} tracks, '
          f'{len(chans)} channels, {mid.length:.1f} s, timing within {worst * 1000:.2f} ms')
    return _index_row(ex, mid, path)


def _clock(sec):
    return f'{int(sec // 60)}:{sec % 60:04.1f}'


def _index_row(ex, mid, path):
    """One line of midi/README.md."""
    s, tl = ex.s, ex.tl
    bpms = []
    for b0, bpm, ramp in s._tempo:
        for v in (bpm, ramp):
            if v is not None and (not bpms or bpms[-1] != v):
                bpms.append(v)
    meters = []
    for bar, beats in s._meters:
        m = '/'.join(map(str, _meter(s, bar, beats)))
        if m not in meters:
            meters.append(m)
    sig = next(m.key for m in mid.tracks[0] if m.type == 'key_signature') if ex.tonic else None
    sf = {name: n for table in (SIG_MAJOR, SIG_MINOR) for n, name in table.items()}.get(sig)
    sig_text = '' if sf is None else ('none' if sf == 0 else
                                      f'{abs(sf)} {"sharp" if sf > 0 else "flat"}'
                                      f'{"s" if abs(sf) > 1 else ""}')
    if s.one_shot:
        form = 'one-shot'
    elif ex.whole_loop:
        form = f'loop only ({_clock(tl.P_s)})'
    else:
        form = f'loop {_clock(tl.I_s)} to {_clock(tl.I_s + tl.P_s)}'
    mix = {'full': ''}.get(ex.variant, ex.variant.replace('_', ' '))
    return dict(file=os.path.basename(path), folder=os.path.basename(os.path.dirname(path)),
                title=ex.title + (f' ({mix})' if mix else ''),
                tempo=' / '.join(f'{b:g}' for b in bpms), meter=', '.join(meters),
                tonic=ex.tonic or '', sig=sig_text, length=_clock(mid.length), form=form,
                parts=len(mid.tracks) - 1)


INDEX_HEAD = """# Rogue Dawn: the score as MIDI

Every piece of the soundtrack as a Standard MIDI File, exported from the
scores in `tools/music/scores/` and `tools/music/stingers/` by
`tools/music/midi.py`. Regenerate with `python3 tools/music/midi.py --all`
(it needs Python 3 and `mido`); this page is written by the same run.

The files hold the written notes, not the recordings: each part of the score
is a track named after the part and its instrument (`mel_vn (Violins I)`), so
the music can be played on any General MIDI synth, loaded into a DAW and
given better instruments, or imported into notation software. The rendered
audio, with the real mix, is in `assets/audio/`.

## Reading the files

- **Names follow the MP3s.** `music/<key>.mid` for loops, `stingers/stinger_<name>.mid`
  for ceremony cues. A cue with several mixes has one file per mix, each holding
  exactly the parts that mix plays: `_calm` (the quiet layer of an adaptive
  battle theme), `_enrage_<boss>` (a boss theme with that boss's enrage layer
  added), `_hum` (the Entity's stem, played under the finale) and
  `music_login` (the title's calm mix, heard as its loop alone).
- **Loops.** A loop is an intro followed by a loop body the game repeats
  forever. The conductor track marks the body with `loopStart` and `loopEnd`
  markers; set your player's or DAW's loop to them. The file stops at the loop
  end (notes may ring a little past it).
- **Timing** is exact: tempo, tempo ramps (as short tempo steps), meter changes
  and the key signature are all in the conductor track.
- **Sounds.** Each channel carries one GM program, chosen per instrument and
  articulation (sustained strings, pizzicato and tremolo are different
  programs). A mix has up to 38 parts and MIDI 15 melodic channels, so parts
  that share a sound may share a channel. Track names always say what the
  part really is. Percussion is on channel 10 (GM/GS drum map); timpani rolls
  and cymbal swells are written out as rolls. Synth parts (sub bass, pads,
  drone, riser) map to the nearest GM synth sounds.
- **Dynamics** come from the score: velocity from the written dynamics and
  accents; a part's expression lane (swells and fades) on CC11, and its mix
  level on CC7. Where parts share a channel, the lane or level that differs
  from the channel's is folded into that part's velocities.
- **Stingers** are written in D. Most are keyed: the game transposes them
  into the key of whatever music is running, and they are exported in D. The
  act cards, the named bosses' cards and the Entity's answer play in one key
  and are exported in it.

A few things only the audio has: the sampled orchestra, the room, and the mix
(each part leveled to its role, the lead ducking the accompaniment). A GM synth
is a sketch of the real sound. `tools/music/SCORE.md` describes every cue.

"""


def write_index(out, rows):
    lines = [INDEX_HEAD]
    for folder, heading in (('music', 'Loops'), ('stingers', 'Stingers')):
        lines.append(f'## {heading}\n')
        lines.append('| File | Title | Tempo | Meter | Tonic | Key signature | Length | Form |')
        lines.append('|---|---|---|---|---|---|---|---|')
        for r in sorted((r for r in rows if r['folder'] == folder), key=lambda r: r['file']):
            lines.append(f"| `{r['file']}` | {r['title']} | {r['tempo']} | {r['meter']} | "
                         f"{r['tonic']} | {r['sig']} | {r['length']} | {r['form']} |")
        lines.append('')
    with open(os.path.join(out, 'README.md'), 'w') as f:
        f.write('\n'.join(lines))


def export_score(name, out):
    mod = importlib.import_module(f'scores.{name}')
    s = mod.build()
    key = getattr(mod, 'KEY', f'music_{name}')
    print(f'[{name}] {s.title}')
    rows = []
    for var in s.variants:
        fname = s.variant_keys.get(var) or (key if var == 'full' else f'{key}_{var}')
        rows.append(save(Exporter(s, var), os.path.join(out, 'music', fname + '.mid')))
    return rows


def export_stinger(name, out):
    """A stinger in the key the game plays it in when it has one (an act card),
    else as written, in D; a keyed stinger is transposed to the running track's
    key in the game."""
    mod = importlib.import_module(f'stingers.{name}')
    fixed = getattr(mod, 'TONIC', None)
    keyed = bool(getattr(mod, 'KEYED', True))
    home = KEY_NAMES[pitch_class(fixed)] if (fixed and not keyed) else None
    # build.offset_from_d: the nearest transposition, -6..+5 semitones from D
    s = mod.build(transpose=(pitch_class(home) - 2 + 6) % 12 - 6 if home else 0)
    print(f'[stinger {name}] {s.title}')
    row = save(Exporter(s, 'full', tonic=home or 'D'),
               os.path.join(out, 'stingers', f'stinger_{name}.mid'))
    if keyed:
        row['form'] = 'one-shot, keyed (the game plays it in the key of the music)'
    return [row]


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('scores', nargs='*')
    ap.add_argument('--all', action='store_true', help='every score and every stinger')
    ap.add_argument('--stingers', nargs='*', help='stingers to export (none listed: all)')
    ap.add_argument('--out', default=OUT)
    args = ap.parse_args()
    scores = list_modules('scores') if args.all else args.scores
    stingers = list_modules('stingers') if args.all else (
        None if args.stingers is None else (args.stingers or list_modules('stingers')))
    if not scores and stingers is None:
        ap.error('name scores, or pass --all or --stingers')
    rows = []
    for name in scores:
        rows += export_score(name, args.out)
    for name in stingers or []:
        rows += export_stinger(name, args.out)
    if args.all:
        write_index(args.out, rows)


if __name__ == '__main__':
    main()
