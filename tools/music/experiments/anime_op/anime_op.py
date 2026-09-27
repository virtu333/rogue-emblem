"""欠けた太陽 (The Broken Sun): an anime-opening-style J-rock song, TV size.

150 bpm, 4/4, E minor; the tag lifts a semitone to F minor. Instrumental: the sung
line (melody.py, one note per mora) is played by an overdriven lead guitar, with
violins in unison and a soft piano an octave up in the sabi.

Form: intro 1-8 (band kime, then the hook) | A-melo 9-24 | B-melo 25-32 (half
time) | sabi 33-48 (IV-V-iii-vi, D#dim7 passing into vi) | tag 49-56 (F minor,
the last line again; まだ 終わらない climbs to the leading tone and the band cuts).

Hidden motifs: the sabi opens on the Thread (B-E-F#-B); the verse riff is the
Empire's drill (E-F-E-D, falling to C); the last phrase is the Hollow Sun.
"""

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from engine.patterns import Kit, arp, chart, pad   # noqa: E402
from engine.score import Score                      # noqa: E402
from engine.theory import pc as pitch_class        # noqa: E402

import melody as M                                  # noqa: E402

KEY = 'anime_op'
BAR = 4.0

# ------------------------------------------------------------------ harmony
def chord_list():
    """[(start_beat, beats, symbol)] from melody.CHORDS."""
    out = []
    for bar in sorted(M.CHORDS):
        syms = M.CHORDS[bar].replace(' (hit)', '').split()
        each = BAR / len(syms)
        for i, s in enumerate(syms):
            out.append(((bar - 1) * BAR + i * each, each, s))
    return out


CHORDS = chord_list()


def chord_at(beat):
    for t, d, s in CHORDS:
        if t - 1e-9 <= beat < t + d - 1e-9:
            return s
    return CHORDS[-1][2]


def root_pc(sym):
    base = sym.split('/')[0]
    name = base[:2] if len(base) > 1 and base[1] in '#b' else base[:1]
    return pitch_class(name)


def bass_pc(sym):
    return pitch_class(sym.split('/')[1]) if '/' in sym else root_pc(sym)


def open_chord(sym):
    """Distorted rhythm voicing: a power chord, root in E2..Eb3 (plus octave)."""
    r = 40 + (root_pc(sym) - 4) % 12
    if sym.startswith('D#dim'):
        return [51, 57, 63]          # D#3 A3 D#4: the tritone, for bite
    if 'sus4' in sym:
        return [r, r + 5, r + 7]     # B E F#
    return [r, r + 7, r + 12]


def low_chord(sym):
    """Palm-mute voicing: root and fifth, root in C2..B2."""
    r = 36 + (root_pc(sym) - 0) % 12
    if sym.startswith('D#dim'):
        return [r, r + 6]
    return [r, r + 7]


def bass_note(sym):
    return 28 + (bass_pc(sym) - 4) % 12     # E1..Eb2


# ------------------------------------------------------------------ helpers
STAGGER = 0.014   # beats between strings in a downstroke (~6 ms)


def strum(part, t, dur, notes, vel):
    for i, p in enumerate(notes):
        part.note(t + i * STAGGER, p, max(0.05, dur - i * STAGGER), vel=vel)


def rhythm_events(bars, steps, push=True, gate=0.92):
    """[(beat, beats, symbol, accent)] for strums on `steps` (beats within a bar) over
    `bars`; with `push`, a chord change on a downbeat is struck an eighth early and
    tied over the barline (the anticipation), and the downbeat is not struck again."""
    evs = []
    for bar in bars:
        b0 = (bar - 1) * BAR
        for i, p in enumerate(steps):
            t = b0 + p
            nxt = (b0 + steps[i + 1]) if i + 1 < len(steps) else b0 + BAR
            sym = chord_at(t)
            accent = p in (0.0, 2.0)
            if push and abs(p - 3.5) < 1e-9 and chord_at(b0 + BAR) != sym \
                    and (bar + 1) in bars:
                sym = chord_at(b0 + BAR)
                accent = True
            evs.append([t, nxt - t, sym, accent])
    merged = []
    for e in evs:
        t, d, sym, acc = e
        on_bar = abs((t / BAR) - round(t / BAR)) < 1e-9
        if push and merged and on_bar and merged[-1][2] == sym and \
                abs(merged[-1][0] % BAR - 3.5) < 1e-9 and merged[-1][0] + merged[-1][1] >= t - 1e-9:
            merged[-1][1] += d          # tied over the barline
            continue
        merged.append(e)
    return [(t, d * gate, s, a) for t, d, s, a in merged]


def eighths():
    return [i * 0.5 for i in range(8)]


# ------------------------------------------------------------------ build
def build():
    s = Score('anime_op', bpm=M.BPM, intro_bars=56, one_shot=True, tonic='E',
              title='The Broken Sun (anime OP, instrumental)', seed=7)
    s.master = dict(lufs=-10.5, lead_duck=2.5, glue_thresh=-14, glue_ratio=2.0,
                    eq=[('peak', 300, 0.8, -1.5), ('peak', 750, 0.8, -3.0),
                        ('peak', 3000, 1.0, 0.5), ('highshelf', 8000, 0.7, 3.0)])
    s.reverb = dict(rt60=1.5, predelay_ms=25, wet_db=-3, room_db=-4)

    # ------------------------------------------------ parts
    amp_rhythm = dict(rig=True, gain_db=26, mid_hz=650, mid_db=1.5, bias=0.3, treble_db=1.0)
    amp_pm = dict(rig=True, gain_db=24, palm=True, mid_db=1.0, bias=0.3, treble_db=0.5)
    amp_lead = dict(rig=True, gain_db=31, tight=160, mid_hz=850, mid_db=4.5, bias=0.2,
                    treble_db=2.0, presence_db=2.0, delay_mix=0.16, delay_s=0.3,
                    delay_fb=0.32)
    amp_clean = dict(rig=True, gain_db=-8, stages=1, bias=0.05, tight=90, mid_db=0,
                     treble_db=2.0, chorus_mix=0.5, delay_mix=0.12, delay_s=0.3)

    gL = s.part('gtr_L', 'egtr', role='section', pan=-0.9, width=0.0, amp=amp_rhythm,
                reverb=0.06, gain=0.0)
    gR = s.part('gtr_R', 'egtr2', role='section', pan=0.9, width=0.0, amp=amp_rhythm,
                reverb=0.06, gain=0.0)
    pL = s.part('pm_L', 'egtr_pm', role='section', pan=-0.8, width=0.0, amp=amp_pm,
                reverb=0.04, gain=-1.0)
    pR = s.part('pm_R', 'egtr_pm2', role='section', pan=0.8, width=0.0, amp=amp_pm,
                reverb=0.04, gain=-1.0)
    cl = s.part('clean', 'egtr3', role='keys', pan=-0.3, width=0.8, amp=amp_clean,
                reverb=0.25, gain=-2.0)
    lead = s.part('lead', 'egtr', role='lead', pan=0.05, width=0.0, amp=amp_lead,
                  reverb=0.18, gain=1.0, humanize_ms=3)
    bass = s.part('bass', 'rbass', role='bass', gain=0.0)
    vln = s.part('vln', 'violins', role='counter', gain=-6.0)
    strings = s.part('str_pad', 'violas', role='pad', gain=-6.0)
    piano = s.part('piano', 'grand', role='keys', gain=-6.0, pan=0.25)
    riser = s.part('riser', 'riser', role='fx', gain=-8.0)
    kit = Kit(s, gains={'kick': 1.0, 'snare': 1.0, 'toms': 0.0, 'cym': 2.5})

    # faders (dB by bar): the A-melo sits back, the B-melo climbs, the sabi opens up
    BAND = [(1, 0), (24.9, 0), (25, -3), (31, 0), (32.9, 0), (33, -0.5), (48, -0.5),
            (49, -1), (52.9, -1), (53, -3), (55, 0), (57, 0)]
    gL.opts['fader'] = gR.opts['fader'] = BAND
    pL.opts['fader'] = pR.opts['fader'] = [(1, -4.5), (16.9, -4.5), (17, -2), (24, -2),
                                           (54.9, -1), (57, 0)]
    bass.opts['fader'] = [(1, 0), (8.9, 0), (9, -3.5), (16.9, -3.5), (17, -1.5), (24.9, -1.5),
                          (25, -1), (32.9, -1), (33, 0), (57, 0)]
    KIT = [(1, 0), (8.9, 0), (9, -3.5), (16.9, -3.5), (17, -1.5), (32.9, -1.5), (33, 0.5),
           (57, 0.5)]
    for p in kit.parts.values():
        p.opts['fader'] = KIT
    kit.parts['cym'].opts['fader'] = [(1, 0), (8.9, 0), (9, -3.5), (16.9, -3.5), (17, -7),
                                      (24.9, -7), (25, -1.5), (32.9, -1.5), (33, 0.5), (57, 0.5)]
    cl.opts['fader'] = [(1, 0), (16.9, -2.5), (17, -1), (57, -1)]
    lead.opts['fader'] = [(1, 0), (8.9, 0), (9, -2.5), (16.9, -2.5), (17, -1.5), (24.9, -1.5),
                          (25, -0.5), (32.9, -0.5),
                          (33, 0.5), (57, 0.5)]

    def both(fn, *a, **k):
        fn(gL, *a, **k)
        fn(gR, *a, **k)

    def rhythm(bars, steps=None, push=True, gate=0.92, vel=0.74, acc=0.86, parts=(gL, gR),
               voicing=open_chord, dur=None):
        for t, d, sym, a in rhythm_events(list(bars), steps or eighths(), push, gate):
            for i, part in enumerate(parts):
                off = 0.01 * i            # the second take a hair late
                strum(part, t + off, dur or d, voicing(sym), acc if a else vel)

    def bassline(bars, steps=None, push=True, gate=0.9, vel=0.7, acc=0.82):
        for t, d, sym, a in rhythm_events(list(bars), steps or eighths(), push, gate):
            bass.note(t, bass_note(sym), d, vel=acc if a else vel)

    def hits(bar, spec, parts=(gL, gR), voicing=open_chord, vel=0.9, with_bass=True):
        """spec: [(beat in bar, beats, symbol or None)]"""
        b0 = (bar - 1) * BAR
        for p, d, sym in spec:
            sym = sym or chord_at(b0 + p)
            for i, part in enumerate(parts):
                strum(part, b0 + p + 0.01 * i, d, voicing(sym), vel)
            if with_bass:
                bass.note(b0 + p, bass_note(sym), d, vel=vel)

    # ================================================= INTRO 1-8
    # kime: C, D, Bm struck on 1, 2&, 3& and pushed on 4&, then the Empire drill in unison
    hits(1, [(0, 1.0, 'C'), (1.5, 0.5, 'C'), (2.5, 0.75, 'C'), (3.5, 1.5, 'D')])
    hits(2, [(1.5, 0.5, 'D'), (2.5, 0.75, 'D'), (3.5, 1.5, 'Bm')])
    hits(3, [(1.5, 0.5, 'Bm'), (2.5, 0.5, 'Bm')])
    drill = [(0, 1.5, 'E5'), (1.5, 0.5, 'F5'), (2.0, 1.0, 'E5'), (3.0, 1.0, 'D5')]
    for p, d, sym in drill:
        b0 = 3 * BAR
        for i, part in enumerate((gL, gR)):
            r = {'E5': 40, 'F5': 41, 'D5': 38}[sym]
            strum(part, b0 + p + 0.01 * i, d * 0.95, [r, r + 7, r + 12], 0.92)
        bass.note(b0 + p, {'E5': 40, 'F5': 41, 'D5': 38}[sym], d * 0.95, vel=0.92)
    lead.at(1).play('@f B5:1~ B5:0.5 A5:0.5 G5:0.5 A5:1~ A5:0.5 | A5:1.5 G5:0.5 F#5:0.5 '
                    'F#5:1.5~ | F#5:1.5 E5:0.5 D5:0.5 r:1.5 |'
                    ' @ff E5:1.5 F5:0.5 E5:1 D5:1 |')
    # the hook (bars 5-8): the Thread, high, over the drive
    lead.at(5).play('@ff B4e E5e F#5e B5:1.5 A5e G5e | F#5q. E5e F#5q A5q |'
                    ' B5q. A5e F#5q D5q | E5h. rq |')
    rhythm(range(5, 8), push=True)
    hits(8, [(0, 0.45, 'Em'), (0.5, 0.45, 'Em'), (1.0, 0.45, 'Em'), (1.5, 0.45, 'Em'),
             (2.5, 0.4, 'Em'), (3.0, 0.4, 'Em')])
    bassline(range(5, 8))
    # (the drive's C in bar 5 is the drill's fall, D-C)

    # ================================================= A-MELO 9-24
    # 9-16: clean chorused arpeggios ("Again"), the drill palm-muted underneath
    for bar in range(9, 17):
        b0 = (bar - 1) * BAR
        sym = chord_at(b0)
        if sym == 'Em':
            seq = [40, 40, 40, 41, 40, 40, 38, 38]      # E E E F | E E D D : the drill
            for i, r in enumerate(seq):
                for j, part in enumerate((pL, pR)):
                    strum(part, b0 + i * 0.5 + 0.01 * j, 0.28, [r, r + 7],
                          0.82 if i in (0, 3) else 0.66)
                bass.note(b0 + i * 0.5, r, 0.4,
                          vel=0.8 if i in (0, 3) else 0.62)
        else:
            for i in range(8):
                if bar in (12, 16) and i >= 6:
                    continue
                for j, part in enumerate((pL, pR)):
                    strum(part, b0 + i * 0.5 + 0.01 * j, 0.28, low_chord(sym),
                          0.8 if i == 0 else 0.64)
                bass.note(b0 + i * 0.5, bass_note(sym), 0.4, vel=0.78 if i == 0 else 0.6)
    # bars 12 and 16 end on a two-chord kime (the band answers the line)
    hits(12, [(3.0, 0.4, 'D'), (3.5, 0.45, 'D')], vel=0.85)
    hits(16, [(3.0, 0.4, 'B'), (3.5, 0.45, 'B')], vel=0.85)
    cl.vel = 0.55
    arp(cl, 9, chart('Em:4 C:4 Em:4 D:4 Em:4 C:4 Am:4 B:4'), pattern='0 2 4 3 5 4 3 2',
        step=0.5, lo=52, hi=79, dur=1.2, vel=0.55)
    # 17-24: the drive (palm-muted eighths both sides, open accents), arps thinner
    rhythm(range(17, 24), push=True, gate=0.5, parts=(pL, pR), voicing=low_chord,
           vel=0.66, acc=0.84, dur=0.28)
    bassline(range(17, 24), vel=0.68, acc=0.8)
    arp(cl, 17, chart('Am:4 Em/G:4 C:4 D:4 Am:4 Bm:4 C:4'), pattern='0 2 4 2', step=1.0,
        lo=55, hi=79, dur=1.6, vel=0.45)
    # bar 24 (D): open power chords return: build into the B-melo
    hits(24, [(0, 1.5, 'D'), (1.5, 0.5, 'D'), (2.0, 0.5, 'D'), (2.5, 0.5, 'D'),
              (3.0, 0.5, 'D'), (3.5, 0.5, 'D')], vel=0.84)

    # ================================================= B-MELO 25-32 (half time)
    rhythm(range(25, 29), steps=[0.0, 2.5], push=False, gate=0.97, vel=0.78, acc=0.84)
    rhythm(range(29, 31), steps=[0.0, 1.0, 2.0, 3.0], push=False, gate=0.9, vel=0.76,
           acc=0.84)
    rhythm([31], push=False, gate=0.85, vel=0.78, acc=0.88)
    bassline(range(25, 29), steps=[0.0, 2.5, 3.5], push=False, vel=0.72, acc=0.8)
    bassline(range(29, 32), push=False, vel=0.7, acc=0.82)
    hits(32, [(0, 1.0, 'B7')], vel=0.95)
    arp(cl, 25, chart('C:4 D:4 Em:4 Em/D:4 Cmaj7:4 D:4 B7sus4:2 B7:2'),
        pattern='0 1 2 3 4 3 2 1', step=0.5, lo=59, hi=83, dur=1.0, vel=0.5)
    pad(strings, 25, chart('C:4 D:4 Em:4 Em/D:4 Cmaj7:4 D:4 B7sus4:2 B7:2'), n=3, lo=52,
        hi=71, vel=0.5)
    strings.expr((25, 0.55), (31, 0.9), (32, 1.0), (32.3, 0.0), (32.95, 0.0), (33, 1.0))
    # piano: the Thread, one note a beat, a bell over the build
    piano.at(25).play('@mp B5h E6h | F#6h B6h | B5h E6h | F#6h B6h |'
                      ' B5q E6q F#6q B6q | B5q E6q F#6q B6q | rw | rw |')
    riser.note(30 * BAR, 72, 4.0, vel=0.6)

    # ================================================= SABI 33-48
    rhythm(range(33, 48), push=True)
    bassline(range(33, 48))
    hits(48, [(0, 2.0, 'C5')], vel=0.98)
    pad(strings, 33, chart('C:4 D:4 Bm:4 Em:4 C:4 D:4 G:2 D#dim7:2 Em:4 C:4 D:4 Bm:4 '
                           'Em:4 Am:4 D:4 B7sus4:2 B7:2'), n=3, lo=55, hi=74, vel=0.6)

    # ================================================= TAG 49-56 (F minor)
    rhythm(range(49, 53), push=True)
    bassline(range(49, 53))
    pad(strings, 49, chart('Db:4 Eb:4 Cm:4 Fsus2:4 Db:4 Eb:4 C:4'), n=3, lo=56, hi=75, vel=0.62)
    hits(53, [(0, 3.8, 'Db')], vel=0.86)
    hits(54, [(0, 1.9, 'Eb'), (2.0, 1.9, 'Eb')], vel=0.88)
    # 55: C, palm-muted eighths opening up, then the last hit on 56's downbeat
    for i in range(8):
        t = 54 * BAR + i * 0.5
        for j, part in enumerate((pL, pR)):
            strum(part, t + 0.01 * j, 0.28, low_chord('C'), 0.7 + 0.03 * i)
        bass.note(t, 36, 0.4, vel=0.7 + 0.03 * i)
    rhythm([55], steps=[2.0, 2.5, 3.0, 3.5], push=False, gate=0.9, vel=0.84, acc=0.9)
    hits(56, [(0, 0.5, 'C')], vel=1.0)
    for j, part in enumerate((pL, pR)):
        strum(part, 55 * BAR + 0.01 * j, 0.3, low_chord('C'), 0.95)

    # ================================================= the sung line
    mel = M.note_string(start_bar=9)
    lead.at(9).play('@f ' + mel)
    # violins in unison through the sabi and tag; piano an octave up
    names = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']
    for t, d, p, _ in M.notes():
        if t >= 31 * BAR + 2:          # from the sabi's pickup
            vln.note(t, names[p % 12] + str(p // 12 - 1), d, vel=0.62)
            if t < 52 * BAR:
                piano.note(t, p + 12, min(d, 1.0), vel=0.34)
    # lead dynamics: A-melo sits back, the sabi sings out (velocity drives the amp)
    for n in lead.notes:
        if n.start >= 8 * BAR:
            n.vel = 0.62 if n.start < 16 * BAR else 0.68 if n.start < 24 * BAR else \
                0.74 if n.start < 31 * BAR + 2 else 0.86

    # ================================================= drums
    K = kit.play
    kime_hat = 'o.o.o.o.o.o.o.o.'
    K(1, {'kick': 'X.....x...x...X.', 'snare': 'x.....x...x...x.', 'crash': 'X.............X.',
          'hat': kime_hat})
    K(2, {'kick': '......x...x...X.', 'snare': '......x...x...x.', 'crash': '..............X.',
          'hat': kime_hat})
    K(3, {'kick': '......x...x.....', 'snare': '......x...x.xxxx', 'hat': 'o.o.o.o.o.o.....'},
      ramp=0.2)
    K(4, {'kick': 'X.....x.x...x...', 'snare': 'X.....x.x...x...', 'crash': 'X.......x.......'})
    DRIVE = {'kick': 'x.....x.x.....x.', 'snare': '....x.......x...',
             'ride': 'X.x.X.x.X.x.X.x.'}
    for bar in (5, 6, 7):
        K(bar, {**DRIVE, 'crash': 'X...............' if bar == 5 else '..............x.'})
    K(8, {'kick': 'x.x.x.x...X.X...', 'snare': '....x.....X.X...', 'crash': 'X.........X.....',
          'ride': 'x.x.x.x.........'})
    VERSE1 = {'kick': 'x.......x.x.....', 'snare': '....x.......x...',
              'hat': 'x.x.x.x.x.x.x.x.'}
    for bar in range(9, 17):
        g = dict(VERSE1)
        if bar in (12, 16):
            g = {'kick': 'x.......x...X.X.', 'snare': '....x.......X.X.', 'hat': 'x.x.x.x.x.x.....',
                 'crash': '............X...'}
        K(bar, g, vel=0.68)
    K(9, {'crash': 'X...............'}, vel=0.7)
    VERSE2 = {'kick': 'x.x...x.x.x...x.', 'snare': '....x.......x...',
              'hat': 'x.X.x.X.x.X.x.X.'}
    for bar in range(17, 24):
        K(bar, VERSE2, vel=0.74)
    K(17, {'crash': 'X...............'}, vel=0.78)
    K(24, {'kick': 'x...............', 'snare': 'x.........xx..xx', 'tom_hi': '....xx..........',
           'tom_mid': '......xx........', 'tom_lo': '........xx..xx..', 'crash': 'X...............'},
      vel=0.8, ramp=0.25)
    HALF = {'kick': 'x.........x.....', 'snare': '........x.......', 'ride': 'x...x...x...x...'}
    for bar in range(25, 29):
        K(bar, {**HALF, **({'crash': 'X...............'} if bar in (25, 27) else {})}, vel=0.72)
    for bar in (29, 30):
        K(bar, {**HALF, 'tom_lo': 'x.x.x.x.x.x.x.x.', 'crash': 'X.......'}, vel=0.76, ramp=0.2)
    K(31, {'kick': 'x...x...x...x...', 'snare': 'x.x.x.x.xxxxxxxx', 'crash': 'X...............'},
      vel=0.8, ramp=0.35)
    K(32, {'kick': 'X...............', 'snare': 'X.......oxoxxxxx', 'crash': 'X...............',
           'tom_lo': '............x.x.'}, vel=0.84, ramp=0.3)
    CHORUS = {'kick': 'x.....x.x.....x.', 'snare': '....x.......x...',
              'ride': 'X.x.X.x.X.x.X.x.'}
    for bar in list(range(33, 48)) + list(range(49, 53)):
        g = dict(CHORUS)
        if bar in (33, 37, 41, 45, 49):
            g['crash'] = 'X...............'
        if bar == 39:
            g['kick'] = 'x.....x.X.....x.'
            g['crash'] = '........X.......'
        if bar in (36, 40, 44):
            g['snare'] = '....x.......x.xx'
        if bar == 47:
            g = {'kick': 'x.....x.X.......', 'snare': '....x...X...xxxx', 'ride': 'X.x.X.x.',
                 'tom_hi': '..........xx....', 'crash': '........X.......'}
        K(bar, g, vel=0.82)
    K(48, {'kick': 'X...............', 'crash': 'X...............', 'snare': 'X.......xxxxxxxx',
           'tom_mid': '........x.x.....', 'tom_lo': '............x.x.'}, vel=0.84, ramp=0.3)
    K(53, {'kick': 'x...............', 'crash': 'X...............', 'ride': '....x...x...x...'},
      vel=0.72)
    K(54, {'kick': 'x.......x.......', 'snare': '........x.......', 'ride': 'x...x...x...x...'},
      vel=0.74)
    K(55, {'kick': 'x.x.x.x.x.x.x.x.', 'snare': '........xxxxxxxx', 'crash': 'X...............'},
      vel=0.78, ramp=0.4)
    K(56, {'kick': 'X...', 'snare': 'X...', 'crash': 'X...', 'tom_lo': 'X...'}, vel=0.95,
      step=0.25)
    # the last crash is choked with the band
    kit.parts['cym'].expr((1, 1.0), (56.12, 1.0), (56.2, 0.0))

    # the backing track for a sung version: the lead and its violin double out
    s.variant('backing', {'lead': None, 'vln': None}, lufs=-11.4)
    s.silent_ok = set()
    s.notes_text = __doc__
    return s
