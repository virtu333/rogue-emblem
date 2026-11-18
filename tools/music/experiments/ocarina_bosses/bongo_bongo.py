"""Bongo Bongo: "Two Hands, No Drummer".

The bottom of the well, under the graveyard. The floor of the room is the skin of
a drum, and two hands with no arms are playing it. Whatever they belong to cannot
be seen. 15/8, C, the darkest mode it has (flat second, flat fifth).

Mechanism: FIVE AGAINST THREE, AND A TUNE THAT CAN ONLY MOVE WHEN A HAND LANDS.

  * A bar is fifteen eighths. The left hand beats it in five (every three eighths),
    the right in three (every five: a heartbeat, 58 to the minute). They agree
    once a bar, on the downbeat, and that is the blow that throws you in the air.
  * Together they make seven strokes a bar, spaced 3 2 1 3 1 2 3: a rhythm that
    reads the same backwards, and the only rhythm in the piece. Every note of
    every tune starts on one of those seven strokes. The body moves only with its
    hands.
  * At first the tune is only ever struck (timpani, plucked basses, the bottom of a
    piano): you hear where it hits, never what it is. Then the lens: the same
    notes, the same strokes, but sung and held by the men of the choir with the
    harmony under them, and you can see what has been hitting you. The lens runs
    out; the tune goes back into the drum.
  * A hand that is stunned stops. With the left hand down the bar has three beats
    and the tune only the three notes that fall on them; with both down there is
    nothing in the room but its floor. Then the eye opens.
  * The Hero's Call has seven notes. The bar has seven strokes. It is played on
    them, one note a stroke: the hero answers in the monster's own rhythm.

Form (15/8 bars, quarter = 144, a bar about three seconds):
  intro 1-4    the well. The right hand alone, a heartbeat. The left arrives.
  A 5-12       both hands. The tune, struck: four bars, and again with more drum.
  B 13-20      the lens: the tune sung and held (men, horns), harmony in the
               strings; then the women an octave above, trumpets.
  A2 21-24     the lens runs out: struck again, a fourth higher.
  C 25-32      it comes for you: the tune a fourth up in the low brass, sung;
               trumpets snarl on the right hand's strokes, an anvil on the left's.
  D 33-38      the left hand is stunned (33-34: three beats, three notes); the
               right (35: the floor, alone); the eye opens (36); the Call on the
               seven strokes, in C and then from the fifth (37-38).
  E 39-46      rage: everything, the hands doubled; the tune's last C is one blow.
Loop 5-46 (42 bars).
"""

from __future__ import annotations

import kit  # noqa: F401
from kit import cresc

from engine.patterns import drums          # noqa: E402
from engine.score import Score               # noqa: E402
from engine.theory import name as pname, pitch   # noqa: E402

TITLE = 'Two Hands, No Drummer (Bongo Bongo)'
OUTRO_BARS = 8
FADE_BARS = 3

INTRO, A, B, A2, C, D, E, END = 1, 5, 13, 21, 25, 33, 39, 47
E8 = 0.5                      # an eighth, in quarter-note beats
BAR = 7.5
LEFT = (0, 3, 6, 9, 12)       # the left hand: five to the bar (eighths)
RIGHT = (0, 5, 10)            # the right hand: three
STROKES = (0, 3, 5, 6, 9, 10, 12)   # both: spaced 3 2 1 3 1 2 3

# ------------------------------------------------------------------ material
# The tune, four bars: (pitch, length in eighths). Every note begins on a stroke.
TUNE = [
    [('C3', 3), ('Eb3', 2), ('Db3', 1), ('C3', 3), ('Gb3', 1), ('F3', 2), ('Eb3', 3)],
    [('Db3', 3), ('C3', 2), ('Bb2', 1), ('C3', 4), ('Ab2', 2), ('Bb2', 3)],
    [('C3', 3), ('Eb3', 2), ('F3', 1), ('Gb3', 3), ('Ab3', 1), ('Gb3', 2), ('F3', 3)],
    [('Eb3', 5), ('Db3', 1), ('C3', 9)],
]
# its harmony, (notes, eighths) per bar, and its bass
HARM = [
    [('Eb3 Bb3 Eb4', 15)],                                   # C minor seventh, no fifth
    [('F3 Ab3 C4', 15)],                                     # F minor over the same C
    [('Eb3 Ab3 C4', 15)],                                    # A-flat (the tune adds its seventh)
    [('Eb3 Gb3 Bb3', 5), ('Db3 F3 Ab3', 1), ('C3 G3 C4', 9)],   # E-flat minor, D-flat, C bare
]
BASS = [[('C2', 15)], [('C2', 15)], [('Ab1', 15)], [('Eb2', 5), ('Db2', 1), ('C2', 9)]]
# the Hero's Call, one note a stroke (C Dorian), then from the fifth
CALL = [
    [('C4', 3), ('G4', 2), ('A4', 1), ('G4', 3), ('Eb4', 1), ('G4', 2), ('C5', 3)],
    [('G4', 3), ('D5', 2), ('E5', 1), ('D5', 3), ('Bb4', 1), ('D5', 2), ('G5', 3)],
]
for _bar in TUNE + CALL:
    assert sum(n for _, n in _bar) == 15
    _t = 0
    for _, _n in _bar:
        assert _t in STROKES, _t
        _t += _n


def build():
    s = Score('bongo_bongo', tonic='C', bpm=144, meter=(15, 8), intro_bars=4, loop_bars=42,
              title=TITLE, seed=1999)
    # a stone cistern: close walls, a long dark tail
    s.reverb = dict(rt60=2.4, predelay_ms=18, wet_db=-3.5, damp=0.6)
    s.master = dict(lufs=-14.5, glue_ratio=1.4, lead_duck=4.0,
                    eq=[('peak', 300, 0.8, -3.5), ('peak', 3600, 1.0, -1.0),
                        ('highshelf', 9000, 0.7, 1.0)])
    P = s.part
    LOWMID = [('peak', 280, 1.0, -3.0)]

    # ================================================================ parts
    hand_l = P('hand_l', 'hands', role='drums', gain=1.0, pan=-0.7)
    hand_r = P('hand_r', 'hands', role='drums', gain=1.0, pan=0.7)
    skin_l = P('skin_l', 'taiko', role='drums', gain=2.0, pan=-0.5)
    skin_r = P('skin_r', 'taiko', role='drums', gain=1.0, pan=0.5)
    # the skin itself: a synthesized drum body under each stroke (a giant drum is felt
    # before it is heard), deep for the left hand, a fifth higher for the right
    thump_l = P('thump_l', 'kick_synth', role='kick', gain=-2.0,
                synth=dict(f_hi=110.0, f_lo=33.0, sweep_s=0.07, decay=0.42, click=0.08))
    thump_r = P('thump_r', 'kick_synth', role='kick', gain=-5.0,
                synth=dict(f_hi=150.0, f_lo=49.0, sweep_s=0.05, decay=0.3, click=0.1))
    perc = P('perc', 'orch_perc', role='accent', gain=5.0, eq=[('lowshelf', 70, 0.7, 3.0)])
    cym = P('cym', 'orch_perc', role='accent', gain=-2.0)
    anvil = P('anvil', 'orch_perc', role='accent', gain=-3.0, reverb=0.9, depth=0.9)
    snare = P('snare', 'orch_perc', role='accent', gain=-4.0, depth=0.8)
    boom = P('boom', 'boom', role='accent', gain=7.0)
    # the tune, struck
    timp = P('timp', 'timpani', role='timp', gain=4.0)
    troll = P('timp_roll', 'timpani', role='timp', art='roll', gain=-1.0)
    pizz = P('pizz', 'basses', role='bass', art='pizz', gain=-1.0)
    pno = P('pno', 'grand', role='keys', gain=-3.0, eq=[('lowpass', 2500, 0.7, 0)])
    # the tune, seen
    men = P('men', 'choir', role='lead', gain=3.0, reverb=0.42,
            eq=[('peak', 300, 1.0, -4.0), ('peak', 2500, 1.0, 2.5)])
    wom = P('women', 'choir', role='lead2', gain=1.5, reverb=0.42)
    hn = P('hn', 'horns', role='lead', gain=0.5, reverb=0.4, eq=[('peak', 2400, 1.0, 2.0)])
    tbn = P('tbn', 'trombones', role='lead2', gain=1.0, reverb=0.4,
            eq=LOWMID + [('peak', 2600, 1.0, 2.5)])
    tpt = P('tpt', 'trumpets', role='lead', gain=-2.0, reverb=0.4,
            eq=[('peak', 3800, 1.0, -2.0), ('highshelf', 6000, 0.7, -2.0)])
    vn = P('vn', 'violins', role='lead2', gain=-2.0,
           eq=[('peak', 3800, 1.0, -3.0), ('highshelf', 6000, 0.7, -2.5)])
    bsn = P('bsn', 'bassoon', role='lead2', gain=-5.0)
    # under it
    harm = P('harm', 'violas', role='pad', art='sus', gain=-3.0, eq=[('peak', 280, 1.0, -4.0)])
    harm_vc = P('harm_vc', 'celli', role='pad', art='sus', gain=-3.5,
                eq=[('peak', 280, 1.0, -5.0)])
    tuba = P('tuba', 'tuba', role='low', gain=3.0, reverb=0.3)
    cb = P('cb', 'basses', role='low', art='sus', gain=4.0)
    drone = P('drone', 'basses', role='low', art='soft', gain=-1.0)
    sub_ = P('sub', 'sub', role='sub', gain=1.0)
    shiver = P('shiver', 'violins2', role='pad', art='trem', gain=-8.0,
               eq=[('highshelf', 5000, 0.7, -4.0)])
    glass = P('glass', 'glass', role='pad', gain=-9.0)
    bell = P('bell', 'bells', role='accent', gain=0.0)
    drip = P('drip', 'celesta', role='accent', gain=-2.0)

    def at(bar, eighth):
        return s.bar(bar) + eighth * E8

    # ================================================================ the hands
    def hands(bar, n=1, lv=0.7, rv=0.7, slam=0.9, left=True, right=True, double=False,
              weight=True):
        """n bars of the two hands. The downbeat, where they agree, is the slam.
        `double`: each stroke is led by a quick grace stroke (rage)."""
        for k in range(n):
            b = bar + k
            if left:
                for e in LEFT:
                    v = lv + (0.12 if e == 0 else 0.0) - (0.04 if e in (6, 12) else 0.0)
                    hand_l.note(at(b, e), 64, E8, vel=min(1.0, v))                 # low conga
                    if weight:
                        skin_l.note(at(b, e), 'C2', E8, vel=min(1.0, v))
                        thump_l.note(at(b, e), 36, E8, vel=min(1.0, v))
                    if double and e:
                        hand_l.note(at(b, e) - 0.25, 61, 0.25, vel=min(1.0, v * 0.6))
            if right:
                for e in RIGHT:
                    v = rv + (0.12 if e == 0 else 0.0)
                    hand_r.note(at(b, e), 63, E8, vel=min(1.0, v))                 # open high conga
                    hand_r.note(at(b, e), 60, E8, vel=min(1.0, v * 0.8))           # and a bongo
                    if weight:
                        skin_r.note(at(b, e), 'G2', E8, vel=min(1.0, v))
                        thump_r.note(at(b, e), 36, E8, vel=min(1.0, v))
                    if double and e:
                        hand_r.note(at(b, e) - 0.25, 62, 0.25, vel=min(1.0, v * 0.6))
            if left and right and slam:
                perc.note(at(b, 0), 36, 1.0, vel=min(1.0, slam))
                if slam >= 0.8:
                    boom.note(at(b, 0), 'C1', 2.0, vel=min(1.0, slam))

    # ================================================================ the tune
    def line(part, bar, bars, tr=0, vel=0.7, struck=False, art=None, only=None, tenuto=False):
        """`bars` (a list of bars of (pitch, eighths)) from `bar`. struck: every note a
        short blow. only: keep the notes sounding at these strokes (a stunned hand:
        the tune is cut down to the other hand's beats)."""
        for k, cells in enumerate(bars):
            t = 0
            spans = []
            for p, n in cells:
                spans.append((t, n, pitch(p) + tr))
                t += n
            if only is not None:
                cut = []
                for i, e in enumerate(only):
                    nxt = only[i + 1] if i + 1 < len(only) else 15
                    p = next(pp for (t0, n, pp) in spans if t0 <= e < t0 + n)
                    cut.append((e, nxt - e, p))
                spans = cut
            for t0, n, p in spans:
                d = E8 if struck else n * E8
                part.note(at(bar + k, t0), p, d, vel=min(1.0, vel + (0.08 if t0 == 0 else 0.0)),
                          art=art or 'default', rearticulate=True, tenuto=tenuto)

    def chords(bar, tr=0, vel=0.6, parts=(None,), bars=range(4)):
        for k in bars:
            t = 0
            for names, n in HARM[k]:
                ps = [pitch(x) + tr for x in names.split()]
                for p in ps[1:]:
                    harm.note(at(bar + k, t), p, n * E8, vel=vel, rearticulate=True)
                harm_vc.note(at(bar + k, t), ps[0], n * E8, vel=vel, rearticulate=True)
                t += n

    def bassline(bar, tr=0, vel=0.7, parts=(), bars=range(4)):
        for k in bars:
            t = 0
            for p, n in BASS[k]:
                for part, octave in parts:
                    q = pitch(p) + tr + 12 * octave
                    part.note(at(bar + k, t), q, n * E8, vel=vel, rearticulate=True)
                t += n

    def slam(bar, vel=0.95):
        perc.note(at(bar, 0), 46, 1.0, vel=vel * 0.9)       # the tam-tam
        cym.note(at(bar, 0), 49, 1.0, vel=vel * 0.8)

    # ================================================================ intro: the well
    for bar in range(INTRO, A, 2):
        drone.at(bar).play('@p [C1 C2]:15')
    drone.expr((INTRO, 0.4), (INTRO + 2, 1.0), (A, 1.0))
    bell.at(INTRO).play('@mp C4:6')
    hands(INTRO, 4, rv=0.5, left=False, weight=False)
    hands(INTRO + 2, 2, lv=0.38, right=False, weight=False)
    for (bar, e, p) in ((INTRO, 9, 'G6'), (INTRO + 1, 3, 'C7'), (INTRO + 1, 12, 'Eb6'),
                        (INTRO + 2, 6, 'G6'), (INTRO + 3, 9, 'Db7')):
        drip.note(at(bar, e), p, 0.5, vel=0.4)
    glass.at(INTRO + 2).play('@pp [C5 G5]:15')
    for bar in range(INTRO, A):
        perc.note(at(bar, 0), 36, 1.0, vel=0.3)

    # ================================================================ A: struck
    for half, (lv, rv) in enumerate(((0.56, 0.6), (0.66, 0.68))):
        b = A + 4 * half
        hands(b, 4, lv=lv, rv=rv, slam=0.62 + 0.1 * half)
        line(timp, b, TUNE, vel=0.62 + 0.06 * half, struck=True)
        line(pizz, b, TUNE, tr=-12, vel=0.6, struck=True, art='pizz')
        if half:
            line(pno, b, TUNE, vel=0.6, struck=True)
            line(pno, b, TUNE, tr=-12, vel=0.55, struck=True)
    for bar in range(A, B, 2):
        drone.at(bar).play('@p [C1 C2]:15')
    shiver.at(A + 4).play('@pp [C6 Db6]:15 [C6 Db6]:15')
    shiver.expr((A + 4, 0.2), (A + 7, 0.7), (B - 0.05, 1.2), (B, 0.6))
    drums(cym, B - 1, {'swell_m': '.......x.......'}, step=E8, vel=0.55)

    # ================================================================ B: the lens
    bell.at(B).play('@f [C4 C5]:6')
    glass.at(B).play('@mp [C6 G6]:7.5 [C6 Ab6]:15 [Bb5 Gb6]:3 [C6 G6]:4.5')
    slam(B, 0.8)
    for half in range(2):
        b = B + 4 * half
        v = 0.72 + 0.1 * half
        hands(b, 4, lv=0.62 + 0.08 * half, rv=0.66 + 0.08 * half, slam=0.8 + 0.1 * half)
        line(men, b, TUNE, vel=v)
        line(hn, b, TUNE, vel=v)
        line(timp, b, TUNE, vel=0.6, struck=True)
        chords(b, vel=0.56 + 0.08 * half)
        bassline(b, vel=0.66 + 0.06 * half, parts=((cb, 0), (tuba, 0)))
        bassline(b, vel=0.55, parts=((sub_, 0),))
        if half:
            line(wom, b, TUNE, tr=24, vel=v)
            line(tpt, b, TUNE, tr=24, vel=v - 0.05)
            line(tbn, b, TUNE, vel=v)
            slam(b, 0.85)
    for p in (men, hn):
        for k in range(8):
            p.expr((B + k, 0.88), (B + k + 0.5, 1.0), (B + k + 0.97, 0.9))

    # ================================================================ A2: the lens runs out
    hands(A2, 4, lv=0.6, rv=0.62, slam=0.7)
    line(timp, A2, TUNE, tr=-7, vel=0.64, struck=True)
    line(pizz, A2, TUNE, tr=-7, vel=0.62, struck=True, art='pizz')
    line(pno, A2, TUNE, tr=-7, vel=0.6, struck=True)
    for bar in (A2, A2 + 2):
        drone.at(bar).play('@p [F1 F2]:15')
    shiver.at(A2).play('@p [F6 Gb6]:15 [F6 Gb6]:15 [F6 Gb6]:15 [F6 Gb6]:15')
    shiver.expr((A2, 0.4), (A2 + 3, 0.9), (C - 0.05, 1.5), (C, 1.0))
    troll.at(A2 + 3).play('@mf F2:7.5')
    cresc(troll, A2 + 3, 1, lo=0.15, hi=1.0)
    drums(cym, C - 1, {'swell_m': '.......x.......'}, step=E8, vel=0.6)

    # ================================================================ C: it comes for you
    slam(C, 0.95)
    for half in range(2):
        b = C + 4 * half
        hands(b, 4, lv=0.74, rv=0.78, slam=0.95)
        for part, tr in ((tbn, 5), (hn, 5), (men, 5)):
            line(part, b, TUNE, tr=tr, vel=0.86)
        line(timp, b, TUNE, tr=-7, vel=0.74, struck=True)
        chords(b, tr=5, vel=0.7)
        bassline(b, tr=5, vel=0.78, parts=((cb, 0), (tuba, 0)))
        bassline(b, tr=5, vel=0.55, parts=((sub_, 0),))
        for k in range(4):
            # trumpets snarl on the right hand's strokes: the bar's root and its flat second
            root = pitch(BASS[k][0][0]) + 5
            for e in RIGHT[1:]:
                for p in (root + 36, root + 37):
                    tpt.note(at(b + k, e), p, 1.0, vel=0.8, rearticulate=True)
            for e in LEFT[1:]:
                anvil.note(at(b + k, e), 67, 0.5, vel=0.5 if half == 0 else 0.62)
        if half:
            line(wom, b, TUNE, tr=17, vel=0.86)
            line(vn, b, TUNE, tr=29, vel=0.84, art='trem')
            slam(b, 0.9)

    # ================================================================ D: the hands, the eye
    # the left hand is stunned: three beats to the bar, three notes of the tune
    slam(D, 1.0)
    boom.note(at(D, 0), 'C1', 2.0, vel=1.0)
    perc.note(at(D, 0), 36, 1.0, vel=1.0)
    hands(D, 1, rv=0.6, left=False)
    hands(D + 1, 1, rv=0.5, left=False)
    line(bsn, D, TUNE[:2], vel=0.6, only=RIGHT)
    line(pizz, D, TUNE[:2], tr=-12, vel=0.56, struck=True, art='pizz', only=RIGHT)
    for bar in (D, D + 2):
        drone.at(bar).play('@p [C1 C2]:15')
    # the right hand is stunned: the floor, alone
    perc.note(at(D + 2, 0), 46, 1.0, vel=0.4)
    # the eye opens
    for part, text in ((shiver, '@p [B6 C7]:7.5'), (glass, '@mp [C6 C7]:7.5'),
                       (wom, '@mp C5:7.5')):
        part.at(D + 3).play(text)
    shiver.expr((D + 3, 0.2), (D + 3.95, 2.0), (D + 4, 1.0))
    wom.expr((D + 3, 0.2), (D + 3.95, 1.3), (D + 4, 1.0))
    drone.at(D + 3).play('%sus @mp [C1 C2]:7.5')
    troll.at(D + 3).play('@mf G2:7.5')
    cresc(troll, D + 3, 1, lo=0.1, hi=1.0)
    drums(cym, D + 3, {'swell_l': 'x'}, step=BAR, vel=0.7)
    # the Call, a note to a stroke
    slam(D + 4, 1.0)
    # (brass and strings only: a choir on notes this quick stops sounding like one)
    for part, tr, v in ((tpt, 0, 0.92), (hn, -12, 0.92), (vn, 12, 0.84), (tbn, -12, 0.9)):
        line(part, D + 4, CALL, tr=tr, vel=v)
    line(timp, D + 4, [[('C3', 3), ('C3', 2), ('C3', 1), ('C3', 3), ('C3', 1), ('C3', 2), ('C3', 3)],
                       [('G2', 3), ('G2', 2), ('G2', 1), ('G2', 3), ('G2', 1), ('G2', 2), ('G2', 3)]],
         vel=0.86, struck=True)
    for k, (root, fifth) in enumerate((('C2', 'G2'), ('G1', 'D2'))):
        for part in (cb, tuba, sub_):
            part.note(at(D + 4 + k, 0), root, BAR, vel=0.8 if part is not sub_ else 0.55,
                      rearticulate=True)
        harm_vc.note(at(D + 4 + k, 0), pitch(fifth) + 12, BAR, vel=0.7, rearticulate=True)
        harm.note(at(D + 4 + k, 0), pitch(root) + 24, BAR, vel=0.7, rearticulate=True)
        harm.note(at(D + 4 + k, 0), pitch(fifth) + 24, BAR, vel=0.7, rearticulate=True)
        for e in STROKES:
            perc.note(at(D + 4 + k, e), 36, 0.5, vel=0.7 if e else 0.95)
            snare.note(at(D + 4 + k, e), 38, 0.5, vel=0.6)
    drums(cym, D + 5, {'swell_m': '.......x.......'}, step=E8, vel=0.62)

    # ================================================================ E: rage
    for half in range(2):
        b = E + 4 * half
        slam(b, 1.0)
        hands(b, 4, lv=0.86, rv=0.9, slam=1.0, double=True)
        for part, tr in ((men, 0), (wom, 24), (hn, 0), (tbn, 0), (tpt, 24), (vn, 36)):
            line(part, b, TUNE, tr=tr, vel=0.95, art='trem' if part is vn else None)
        line(timp, b, TUNE, vel=0.86, struck=True)
        line(pno, b, TUNE, tr=-12, vel=0.8, struck=True)
        chords(b, vel=0.78)
        bassline(b, vel=0.86, parts=((cb, 0), (tuba, 0)))
        bassline(b, vel=0.6, parts=((sub_, 0),))
        for k in range(4):
            for e in LEFT[1:]:
                anvil.note(at(b + k, e), 67, 0.5, vel=0.66)
            for e in STROKES[1:]:
                snare.note(at(b + k, e), 38, 0.5, vel=0.56)
    shiver.at(E).play('@mf ' + '[C6 Db6]:15 ' * 4)
    # the tune's last C: one blow, and then nothing sounds but the room
    last = at(E + 7, 6)
    boom.note(last, 'C1', 2.0, vel=1.0)
    perc.note(last, 36, 1.0, vel=1.0)
    perc.note(last, 46, 1.0, vel=0.95)
    cym.note(last, 49, 1.0, vel=0.85)
    for p in s.parts.values():
        if p.name in ('boom', 'perc', 'cym'):
            continue
        p.notes = [n for n in p.notes if not (last + 0.01 < n.start < s.bar(END))]
        for n in p.notes:
            if n.start <= last + 0.01 and n.end > last + 1.0 and n.start >= s.bar(E + 7):
                n.dur = last + 1.0 - n.start

    s.notes_text = __doc__
    return s


if __name__ == '__main__':
    sc = build()
    print(sc.title, len(sc.parts), 'parts', pname(60))
