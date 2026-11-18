"""Twinrova: "The Sisters Finish Each Other's Sentences".

The desert temple. Two witches, four hundred years old, on brooms: Koume burns,
Kotake freezes, and neither can stop correcting the other. Later they are one
woman. 7/8 (2+2+3), A.

Mechanism: TWO SCALES THAT SHARE ONLY THEIR TONIC AND FIFTH.

  * Koume's scale is fire: A B-flat C-sharp D E F G (Phrygian with a major third:
    its triads are A, B-flat, D minor, G minor: the flat side).
    Kotake's is ice: A B C D-sharp E F-sharp G-sharp (its triads are A minor, E,
    B, G-sharp minor: the sharp side). Between them they own all twelve notes,
    and the only two they share are A and E. Everything that is not fire is ice.
  * Neither sister can sing a note that is not hers, so the tune has to be passed:
    Koume (left: oboe, bassoon, muted trumpet, violas, marimba, the skins) starts
    a sentence, Kotake (right: flute, celesta, glockenspiel, violins, harp)
    finishes it, and the tune changes scale at every hand-over. The joins are
    always on A or E, the only places they can meet.
  * They interrupt sooner and sooner: a bar each, then half a bar. Then the
    chromatic scale itself, in sixteenths, which belongs to both and to neither:
    each plays only her own notes of it, so it flickers from side to side.
  * When they merge, their two tonic chords are sounded together (A major on A
    minor: the split third) and one voice (the women of the choir, violins,
    horns) sings every bar, hot and cold by turns.
  * The mirror shield: the tune is written in scale degrees, so any bar can be
    thrown back in the other sister's scale. Three bars of one element in a row,
    and the brass answer with the Hero's Call in the other (the Call has seven
    notes; a bar has seven eighths). The Call in A Dorian turns out to lie wholly
    inside the ice scale; turned into fire it is A E F E C-sharp E A.
  * At the end the whole orchestra plays the chromatic scale together, and lands
    on the bare fifth A-E: all the two of them ever had in common.

Form (7/8 bars, quarter = 132):
  intro 1-8    night in the desert: each scale alone (oboe rising, flute falling);
               the drums begin.
  A 9-24       the first sentence, four times, each with more players.
  B 25-40      the second (Kotake begins; the bass moves: D minor, E, B-flat).
  C 41-52      bickering: half-bars; the chromatic scale in hocket; they collide
               on E; a silence.
  M 53-56      the split third. Twinrova.
  P 57-80      one voice. Fire, fire, fire: the Call in ice. Ice, ice, ice: the
               Call in fire. Again, the other way round. Then two and two, and no
               answer comes.
  Q 81-92      half-bars, everyone; the chromatic scale, everyone; both Calls; A-E.
Loop 9-92 (84 bars).
"""

from __future__ import annotations

import kit  # noqa: F401
from kit import cresc

from engine.patterns import drums          # noqa: E402
from engine.score import Score               # noqa: E402
from engine.theory import pitch              # noqa: E402

TITLE = "The Sisters Finish Each Other's Sentences (Twinrova)"
OUTRO_BARS = 8
FADE_BARS = 4

INTRO, A, B, C, M, P2, Q, END = 1, 9, 25, 41, 53, 57, 81, 93
E8 = 0.5
BAR = 3.5

# ------------------------------------------------------------------ the two scales
FIRE = (0, 1, 4, 5, 7, 8, 10)      # A Bb C# D E F G
ICE = (0, 2, 3, 6, 7, 9, 11)       # A B  C  D# E F# G#
OWNER = {0: 'both', 7: 'both', **{x: 'F' for x in (1, 4, 5, 8, 10)},
         **{x: 'I' for x in (2, 3, 6, 9, 11)}}
A4 = pitch('A4')


def deg(scale, d):
    """Scale degree d (1 = A4, 8 = A5, 0 = the seventh below) as a MIDI pitch."""
    return A4 + 12 * ((d - 1) // 7) + scale[(d - 1) % 7]


# ------------------------------------------------------------------ the tune, in degrees
# each bar: (owner, [(degree, eighths), ...]); seven eighths to the bar
A_STRAIN = [
    ('F', [(5, 1), (6, 1), (5, 1), (4, 1), (3, 1), (4, 1), (5, 1)]),   # E F E D C# D E
    ('I', [(5, 1), (4, 1), (3, 1), (2, 1), (1, 3)]),                   # E D# C B A
    ('F', [(1, 1), (2, 1), (3, 1), (4, 1), (5, 1), (6, 1), (5, 1)]),   # A Bb C# D E F E
    ('I', [(7, 1), (6, 1), (5, 2), (8, 3)]),                           # G# F# E A'
]
B_STRAIN = [
    ('I', [(8, 1), (7, 1), (6, 1), (5, 1), (4, 1), (5, 1), (6, 1)]),   # A' G# F# E D# E F#
    ('F', [(6, 1), (7, 1), (8, 1), (7, 1), (5, 3)]),                   # F G A' G E
    ('I', [(3, 1), (4, 1), (5, 1), (6, 1), (7, 1), (6, 1), (5, 1)]),   # C D# E F# G# F# E
    ('F', [(4, 1), (3, 1), (2, 2), (1, 3)]),                           # D C# Bb A
]
FALL = [(7, 1), (6, 1), (5, 1), (4, 1), (3, 1), (2, 1), (1, 1)]        # the scale, down
CALL = [(1, 1), (5, 1), (6, 1), (5, 1), (3, 1), (5, 1), (8, 1)]        # the Hero's Call
# chords: (name -> pitches around A3) and each bar's harmony as (chord, eighths), bass
CHORD = {
    'A': 'A3 C#4 E4', 'Am': 'A3 C4 E4 G#4', 'E': 'G#3 B3 E4', 'Dm': 'A3 D4 F4',
    'Bb': 'Bb3 D4 F4', 'Gm': 'G3 Bb3 D4', 'A5': 'A3 E4 A4', 'Am6': 'A3 C4 E4 F#4',
    'B7': 'A3 B3 D#4 F#4', 'split': 'A3 C4 C#4 E4',
}
ROOT = {'A': 'A2', 'Am': 'A2', 'E': 'E2', 'Dm': 'D2', 'Bb': 'Bb2', 'Gm': 'G2', 'A5': 'A2',
        'Am6': 'A2', 'B7': 'B2', 'split': 'A2'}
HARM_A = [[('A', 7)], [('Am', 7)], [('A', 7)], [('E', 4), ('A5', 3)]]
HARM_B = [[('Am', 7)], [('Dm', 7)], [('E', 7)], [('Bb', 4), ('A5', 3)]]
for _s in (A_STRAIN, B_STRAIN):
    for _o, _cells in _s:
        assert sum(n for _, n in _cells) == 7
        assert all(OWNER[(deg(FIRE if _o == 'F' else ICE, d) - A4) % 12] in (_o, 'both')
                   for d, _ in _cells)


def build():
    s = Score('twinrova', tonic='A', bpm=132, meter=(7, 8), intro_bars=8, loop_bars=84,
              title=TITLE, seed=2000)
    # a great hall of sandstone
    s.reverb = dict(rt60=2.4, predelay_ms=22, wet_db=-3.5, damp=0.5)
    s.master = dict(lufs=-14.5, glue_ratio=1.4, lead_duck=4.0,
                    eq=[('peak', 300, 0.8, -3.5), ('peak', 3600, 1.0, -1.0),
                        ('highshelf', 9000, 0.7, 1.0)])
    P = s.part
    LOWMID = [('peak', 280, 1.0, -3.0)]
    L, R = -0.5, 0.5                       # Koume on the left, Kotake on the right

    # ================================================================ parts
    # Koume: reeds, brass, wood, skin
    ob = P('ob', 'oboe', role='lead', gain=-3.0, pan=L)
    bsn = P('bsn', 'bassoon', role='lead2', gain=-5.0, pan=L - 0.1)
    tpm = P('tpt_mute', 'trumpets', role='lead2', art='mute', gain=-5.0, pan=L)
    va = P('va', 'violas', role='lead2', art='sus', gain=-2.0, pan=L + 0.1)
    hnf = P('hn_f', 'horns', role='lead2', gain=-2.0, pan=L, reverb=0.4)
    mar = P('marimba', 'marimba', role='keys', gain=-3.0, pan=L)
    # Kotake: flutes, metal, glass
    fl = P('fl', 'flute', role='lead', gain=-3.0, pan=R)
    picc = P('picc', 'piccolo', role='lead2', gain=-9.0, pan=R + 0.1)
    cel = P('cel', 'celesta', role='lead2', gain=-5.0, pan=R, eq=[('peak', 4000, 1.0, -3.0)])
    glk = P('glock', 'glock', role='accent', gain=-6.5, pan=R, eq=[('peak', 4000, 1.0, -3.0)])
    vn = P('vn', 'violins', role='lead2', gain=-2.0, pan=R - 0.1,
           eq=[('peak', 3800, 1.0, -3.0), ('highshelf', 6000, 0.7, -2.5)])
    harp = P('harp', 'harp', role='keys', gain=-2.0, pan=R)
    # between them
    pizz = P('pizz', 'basses', role='bass', art='pizz', gain=-1.0)
    hand_l = P('hand_l', 'hands', role='drums', gain=-3.0, pan=-0.3)
    hand_r = P('hand_r', 'hands', role='drums', gain=-3.0, pan=0.3)
    tamb = P('tamb', 'orch_perc', role='accent', gain=-5.0, depth=0.5)
    timp = P('timp', 'timpani', role='timp', gain=3.0)
    troll = P('timp_roll', 'timpani', role='timp', art='roll', gain=-1.0)
    perc = P('perc', 'orch_perc', role='accent', gain=5.0, eq=[('lowshelf', 70, 0.7, 3.0)])
    cym = P('cym', 'orch_perc', role='accent', gain=-2.0)
    boom = P('boom', 'boom', role='accent', gain=6.0)
    snare = P('snare', 'orch_perc', role='accent', gain=-3.0, depth=0.7)
    glass = P('glass', 'glass', role='pad', gain=-9.0)
    drone = P('drone', 'basses', role='low', art='soft', gain=-2.0)
    # Twinrova
    wom = P('women', 'choir', role='lead', gain=4.0, reverb=0.36,
            eq=[('peak', 350, 1.0, -3.0), ('peak', 2800, 1.0, 3.0)])
    men = P('men', 'choir', role='lead2', gain=1.0, reverb=0.42,
            eq=[('peak', 300, 1.0, -3.0), ('peak', 2500, 1.0, 2.0)])
    vn1 = P('vn1', 'violins', role='lead', gain=-1.5,
            eq=[('peak', 3800, 1.0, -3.0), ('highshelf', 6000, 0.7, -2.5)])
    hn = P('hn', 'horns', role='lead2', gain=0.0, reverb=0.4, eq=[('peak', 2400, 1.0, 2.0)])
    tpt = P('tpt', 'trumpets', role='lead', gain=1.0, reverb=0.3,
            eq=[('peak', 2800, 1.0, 2.0), ('highshelf', 7000, 0.7, -2.0)])
    tbn = P('tbn', 'trombones', role='lead2', gain=0.5, reverb=0.3,
            eq=[('peak', 280, 1.0, -5.0), ('peak', 2600, 1.0, 3.0)])
    tuba = P('tuba', 'tuba', role='low', gain=3.0, reverb=0.3)
    cb = P('cb', 'basses', role='low', art='sus', gain=4.0)
    vc = P('vc', 'celli', role='section', art='spic', gain=-2.0, eq=[('peak', 280, 1.0, -5.0)])
    arp_va = P('arp_va', 'violas', role='ostinato', art='spic', gain=-3.0,
               eq=[('peak', 300, 1.0, -5.0)])
    arp_v2 = P('arp_v2', 'violins2', role='ostinato', art='spic', gain=-3.0)

    def at(bar, eighth):
        return s.bar(bar) + eighth * E8

    def sing(part, bar, cells, scale, octave=0, vel=0.7, art=None, short=False, start=0):
        """One bar of the tune (degrees) in a scale, on a part."""
        t = start
        for d, n in cells:
            dur = (E8 * 0.9 if short else n * E8)
            part.note(at(bar, t), deg(scale, d) + 12 * octave, dur,
                      vel=min(1.0, vel + (0.08 if t in (0, 2, 4) else 0.0)),
                      art=art or 'default')
            t += n

    def chord(part, bar, e, name, vel=0.6, dur=E8, octave=0, art=None):
        for x in CHORD[name].split():
            part.note(at(bar, e), pitch(x) + 12 * octave, dur, vel=vel, art=art or 'default',
                      rearticulate=True)

    def groove(bar, level=0.6, low=True):
        """The dance: 2 + 2 + 3. A low hand on each group, high hands filling the three."""
        for e in (0, 4):
            hand_l.note(at(bar, e), 64, E8, vel=min(1.0, level + (0.14 if e == 0 else 0.04)))
        for e, v in ((2, 0.0), (5, -0.12), (6, -0.06)):
            hand_r.note(at(bar, e), 63 if e == 2 else 60, E8, vel=min(1.0, level + v))
        for e in (0, 2, 4):
            tamb.note(at(bar, e), 54, E8, vel=level * 0.8)
        if low:
            perc.note(at(bar, 0), 36, 1.0, vel=min(1.0, level * 0.9))

    def vamp(bar, harm, owner, vel=0.55, bass=True):
        """Under a bar of tune: plucked bass on the three groups; the chord struck by
        the singing sister's side (marimba for fire, harp for ice)."""
        t = 0
        for name, n in harm:
            root = pitch(ROOT[name])
            groups = [e for e in (0, 2, 4) if t <= e < t + n]
            for e in groups:
                if bass:
                    p = root if e != 2 else root + 7
                    pizz.note(at(bar, e), p, E8 * 2, vel=vel + 0.1, art='pizz')
                chord(mar if owner == 'F' else harp, bar, e, name,
                      vel=vel + (0.06 if e == 0 else 0.0), dur=1.0)
            t += n

    FIRE_SIDE = ((ob, 0), (bsn, -1), (tpm, 0), (va, 0), (hnf, -1))
    ICE_SIDE = ((fl, 0), (cel, 1), (vn, 1), (picc, 1), (glk, 1))

    def sentence(bar, strain, harm, level):
        """Four bars of the tune, passed between the sisters. `level` 0-3: how many
        players each has by now."""
        vel = 0.6 + 0.07 * level
        for k, (owner, cells) in enumerate(strain):
            side = FIRE_SIDE if owner == 'F' else ICE_SIDE
            scale = FIRE if owner == 'F' else ICE
            n_voices = (1, 3, 4, 5)[level]
            for part, octave in side[:n_voices]:
                if part is glk and level < 3:
                    continue
                sing(part, bar + k, cells, scale, octave, vel=vel,
                     short=part in (cel, glk))
            vamp(bar + k, harm[k], owner, vel=0.5 + 0.05 * level)
            groove(bar + k, level=0.5 + 0.07 * level, low=level >= 2)

    # ================================================================ intro: night
    for bar in range(INTRO, A, 2):
        drone.at(bar).play('@p [A1 A2]:7')
    drone.expr((INTRO, 0.4), (INTRO + 3, 1.0), (A, 0.9))
    glass.at(INTRO).play('@pp [E5 A5]:14')
    # each scale alone: Koume's rising to the fifth, Kotake's falling back from it
    ob.at(INTRO).play('@mp A4q Bb4q C#5q. | D5q E5:2.5 |')
    fl.at(INTRO + 2).play('@mp E5q D#5q C5q. | B4q A4:2.5 |')
    ob.expr((INTRO, 0.8), (INTRO + 1.5, 1.0), (INTRO + 1.97, 0.8))
    for k in range(4, 8):
        groove(INTRO + k, level=0.36 + 0.05 * (k - 4), low=False)
        for e in (0, 2, 4):
            pizz.note(at(INTRO + k, e), pitch('A2') + (7 if e == 2 else 0), 1.0, vel=0.5,
                      art='pizz')
    ob.at(INTRO + 4).play('@mp A4q Bb4q C#5q. | D5q E5:2.5 |')
    fl.at(INTRO + 6).play('@mp E5q D#5q C5q. | B4q A4:2.5 |')

    # ================================================================ A and B: the sentences
    for i in range(4):
        sentence(A + 4 * i, A_STRAIN, HARM_A, level=i)
        sentence(B + 4 * i, B_STRAIN, HARM_B, level=min(3, i + 1))
    for bar in range(A, B, 2):                 # (the second sentence moves its bass)
        drone.at(bar).play('@p [A1 A2]:7')

    # ================================================================ C: bickering
    # half-bars: one starts (two groups of two), the other cuts in (the three)
    halves = [
        ('F', [(5, 1), (6, 1), (5, 1), (4, 1)], 'I', [(3, 1), (2, 1), (1, 1)]),      # E F E D | C B A
        ('I', [(1, 1), (2, 1), (3, 1), (4, 1)], 'F', [(5, 1), (6, 1), (5, 1)]),      # A B C D# | E F E
        ('F', [(5, 1), (4, 1), (3, 1), (2, 1)], 'I', [(1, 1), (0, 1), (1, 1)]),      # E D C# Bb | A G# A
        ('I', [(5, 1), (6, 1), (7, 1), (8, 1)], 'F', [(9, 1), (8, 1), (7, 1)]),      # E F# G# A | Bb A G
    ]

    def half_bars(bar, voices, vel, tutti=None):
        for k, (o1, c1, o2, c2) in enumerate(halves):
            for owner, cells, start in ((o1, c1, 0), (o2, c2, 4)):
                scale = FIRE if owner == 'F' else ICE
                side = tutti if tutti else (FIRE_SIDE if owner == 'F' else ICE_SIDE)[:voices]
                for part, octave in side:
                    if part is glk:
                        continue
                    sing(part, bar + k, cells, scale, octave, vel=vel, start=start,
                         short=part in (cel,))
            name = 'A' if o1 == 'F' else 'Am'
            vamp(bar + k, [(name, 4), ('Am' if o2 == 'I' else 'A', 3)], o1, vel=0.6)
            groove(bar + k, level=0.66)

    half_bars(C, 4, 0.8)

    def hocket_run(bar, up, vel, voices=4, octave=0):
        """The chromatic scale in sixteenths, A to A: each sister plays only her own
        notes of it (A and E, which are both theirs, together)."""
        steps = list(range(13)) if up else list(range(12, -1, -1))
        for i, st in enumerate(steps):
            t = s.bar(bar) + 0.25 * i
            last = i == 12
            for owner, side in (('F', FIRE_SIDE), ('I', ICE_SIDE)):
                if OWNER[st % 12] not in (owner, 'both'):
                    continue
                for part, o in side[:voices]:
                    if part is glk:
                        continue
                    part.note(t, A4 + st + 12 * (o + octave), 0.5 if last else 0.25,
                              vel=min(1.0, vel + (0.1 if i % 4 == 0 else 0.0)),
                              art='stac' if part in (va, vn) and not last else 'default')

    for k in range(4):
        hocket_run(C + 4 + k, up=k % 2 == 0, vel=0.78 + 0.04 * k, voices=2 + k)
        vamp(C + 4 + k, [('split', 7)], 'F' if k % 2 == 0 else 'I', vel=0.62)
        groove(C + 4 + k, level=0.7 + 0.03 * k)
    # the collision: both on the one note they share, everything shaking
    half_bars(C + 8, 5, 0.9)
    for part, text in ((ob, 'E5'), (fl, 'E6'), (tpm, 'E5'), (hnf, 'E4'), (bsn, 'E3'), (cel, 'E6'),
                       (picc, 'E6')):
        part.notes = [n for n in part.notes if not s.bar(C + 10) - 1e-6 <= n.start < s.bar(M)]
        part.at(C + 10).play(f'@ff {text}:3.5')
    for part, text in ((va, '[E4 E5]'), (vn, '[E5 E6]')):
        part.notes = [n for n in part.notes if not s.bar(C + 10) - 1e-6 <= n.start < s.bar(M)]
        part.at(C + 10).play(f'%trem @ff {text}:3.5')
    for p in (mar, harp, pizz, hand_l, hand_r, tamb, perc):
        p.notes = [n for n in p.notes if not s.bar(C + 10) - 1e-6 <= n.start < s.bar(M)]
    for e in range(7):
        hand_l.note(at(C + 10, e), 64, E8, vel=0.6 + 0.05 * e)
        hand_r.note(at(C + 10, e), 63, E8, vel=0.6 + 0.05 * e)
    troll.at(C + 10).play('@f E3:3.5')
    cresc(troll, C + 10, 1, lo=0.4, hi=1.0)
    # ... and a silence with one cold note in it and a harp running up both scales
    perc.note(at(C + 11, 0), 36, 1.0, vel=0.9)
    cym.note(at(C + 11, 0), 49, 1.0, vel=0.8)
    glk.note(at(C + 11, 2), 'E7', 2.0, vel=0.5)
    t = at(C + 11, 3)
    for i, st in enumerate((0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 16, 19, 24)):
        harp.note(t + 0.125 * i, pitch('A3') + st, 0.5, vel=0.4 + 0.03 * i)
    drums(cym, C + 11, {'swell_m': '..x....'}, step=E8, vel=0.6)

    # ================================================================ M: the split third
    perc.note(at(M, 0), 46, 1.0, vel=0.8)
    for part, notes in ((vc, '[A2 E3]'), (arp_va, '[C4 C#4]'), (arp_v2, '[E4 A4]'), (vn1, '[C5 C#5]'),
                        (cb, 'A1')):
        part.at(M).play(f'%trem @mf {notes}:7 {notes}:7')
        part.expr((M, 0.35), (M + 2, 0.7), (P2 - 0.05, 1.25), (P2, 1.0))
    wom.at(M + 2).play('@mf E5:7')
    men.at(M + 2).play('@mf E4:7')
    for p in (wom, men):
        p.expr((M + 2, 0.3), (P2 - 0.05, 1.2), (P2, 1.0))
    troll.at(M).play('@mf A2:14')
    troll.expr((M, 0.2), (M + 2, 0.5), (P2 - 0.05, 1.0))
    for k in range(4):
        groove(M + k, level=0.5 + 0.1 * k)
    drums(cym, M + 3, {'swell_l': 'x'}, step=BAR, vel=0.75)
    t = s.bar(M + 3)
    for i in range(14):                              # both scales, up the harp
        st = (0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 16)[i]
        harp.note(t + 0.25 * i, pitch('A3') + st, 0.5, vel=0.5 + 0.03 * i)

    # ================================================================ P: one voice
    def twinrova(bar, cells, owner, harm, vel=0.86, voices=3, octave=0):
        """One bar, sung by the merged voice, over the band."""
        scale = FIRE if owner == 'F' else ICE
        lineup = ((wom, 0), (vn1, 1), (hn, -1), (men, -1), (tpt, 0))[:voices]
        for part, o in lineup:
            sing(part, bar, cells, scale, o + octave, vel=vel)
        t = 0
        for name, n in harm:
            root = pitch(ROOT[name])
            tones = [pitch(x) for x in CHORD[name].split()]
            for e in [e for e in (0, 2, 4) if t <= e < t + n]:
                d = (3 if e == 4 else 2) * E8
                for part, o in ((cb, 0), (tuba, 0)):
                    part.note(at(bar, e), root + (7 if e == 2 else 0) + 12 * o, d, vel=0.8,
                              rearticulate=True)
                vc.note(at(bar, e), root + 12, E8, vel=0.72, art='spic')
                timp.note(at(bar, e), pitch('A2') if e != 2 else pitch('E3'), 1.0,
                          vel=0.8 if e == 0 else 0.62)
            # the middle strings run the chord in eighths
            for e in range(t, t + n):
                arp_va.note(at(bar, e), tones[e % len(tones)], E8, vel=0.62, art='spic')
                arp_v2.note(at(bar, e), tones[(e + 1) % len(tones)] + 12, E8, vel=0.58, art='spic')
            t += n
        groove(bar, level=0.8)

    def blast(bar, scale, name, vel=0.95):
        """The shield lets go: the Hero's Call, a note to an eighth, in the scale that
        was not being thrown."""
        for part, o, v in ((tpt, 0, vel), (hn, -1, vel - 0.12), (tbn, -1, vel - 0.05),
                           (vn1, 1, vel - 0.1)):
            sing(part, bar, CALL, scale, o, vel=v, art='stac' if part is tpt else None)
        for e in range(7):
            snare.note(at(bar, e), 38, 0.5, vel=0.72 if e in (0, 2, 4) else 0.56)
        for part in (cb, tuba):
            part.note(at(bar, 0), 'A1' if part is cb else 'A2', BAR, vel=0.9, rearticulate=True)
        chord(mar if scale is FIRE else harp, bar, 0, name, vel=0.8, dur=2.0)
        (glk if scale is ICE else mar).note(at(bar, 6), deg(scale, 8) + 12, 1.0, vel=0.8)
        for e in range(7):
            timp.note(at(bar, e), pitch('A2') if e % 2 == 0 else pitch('E3'), 0.5,
                      vel=0.9 if e == 0 else 0.7)
        perc.note(at(bar, 0), 36, 1.0, vel=1.0)
        boom.note(at(bar, 0), 'A0', 2.0, vel=0.9)
        cym.note(at(bar, 0), 49, 1.0, vel=0.85)
        groove(bar, level=0.9)

    F1, F2, F3 = A_STRAIN[0][1], A_STRAIN[2][1], FALL
    I1, I2, I3 = B_STRAIN[0][1], B_STRAIN[2][1], A_STRAIN[1][1]
    FIRE3 = [(F1, [('A', 7)]), (F2, [('A', 7)]), (F3, [('Gm', 4), ('A', 3)])]
    ICE3 = [(I1, [('Am', 7)]), (I2, [('E', 7)]), (I3, [('B7', 4), ('Am', 3)])]
    perc.note(at(P2, 0), 46, 1.0, vel=0.95)
    boom.note(at(P2, 0), 'A0', 2.0, vel=1.0)
    cym.note(at(P2, 0), 49, 1.0, vel=0.85)
    plan = [('F', FIRE3, ICE, 'Am6'), ('I', ICE3, FIRE, 'A'),      # round one
            ('I', ICE3, FIRE, 'A'), ('F', FIRE3, ICE, 'Am6')]      # round two, the other way
    for r, (owner, three, back, name) in enumerate(plan):
        b = P2 + 4 * r
        for k, (cells, harm) in enumerate(three):
            twinrova(b + k, cells, owner, harm, vel=0.84 + 0.04 * k, voices=3 if r < 2 else 5)
        blast(b + 3, back, name)
    # two and two: the shield never fills, and nothing answers
    b = P2 + 16
    for k, (owner, cells, harm) in enumerate((('F', F1, [('A', 7)]), ('F', F2, [('A', 7)]),
                                              ('I', I1, [('Am', 7)]), ('I', I2, [('E', 7)]),
                                              ('F', F2, [('A', 7)]), ('F', F3, [('Gm', 4), ('A', 3)]),
                                              ('I', I2, [('E', 7)]), ('I', I3, [('B7', 4), ('Am', 3)]))):
        twinrova(b + k, cells, owner, harm, vel=0.92, voices=5)
    for k in (0, 2, 4, 6):
        cym.note(at(b + k, 0), 49, 1.0, vel=0.7)
        perc.note(at(b + k, 0), 46, 1.0, vel=0.6)

    # ================================================================ Q: everything they share
    TUTTI = ((wom, 0), (vn1, 1), (hn, -1), (men, -1), (tpt, 0), (tbn, -1), (ob, 0), (fl, 1))
    half_bars(Q, 0, 0.95, tutti=TUTTI)
    for k in range(4):
        for e in (0, 2, 4):
            for part in (cb, tuba):
                part.note(at(Q + k, e), pitch('A1' if part is cb else 'A2') + (7 if e == 2 else 0),
                          (3 if e == 4 else 2) * E8, vel=0.86, rearticulate=True)
            timp.note(at(Q + k, e), pitch('A2') if e != 2 else pitch('E3'), 1.0, vel=0.8)
    # the chromatic scale, both of them at once: everyone
    for k in range(4):
        steps = list(range(13)) if k % 2 == 0 else list(range(12, -1, -1))
        for i, st in enumerate(steps):
            t = s.bar(Q + 4 + k) + 0.25 * i
            for part, o in ((vn1, 1), (arp_v2, 0), (fl, 1), (ob, 0), (tpt, 0), (vc, -1)):
                part.note(t, A4 + st + 12 * o, 0.5 if i == 12 else 0.2,
                          vel=min(1.0, 0.86 + (0.1 if i % 4 == 0 else 0.0)),
                          art='stac' if part in (vn1, arp_v2, vc, tpt) and i < 12 else 'default')
        for part, p in ((wom, 'E5'), (men, 'E4'), (tbn, 'A3')):
            part.note(s.bar(Q + 4 + k), p, BAR, vel=0.92, rearticulate=True)
        for e in range(7):
            timp.note(at(Q + 4 + k, e), pitch('A2') if e % 2 == 0 else pitch('E3'), 0.5,
                      vel=0.86 if e == 0 else 0.68)
        for part in (cb, tuba):
            part.note(s.bar(Q + 4 + k), 'A1' if part is cb else 'A2', BAR, vel=0.9,
                      rearticulate=True)
        groove(Q + 4 + k, level=0.9)
        perc.note(at(Q + 4 + k, 0), 36, 1.0, vel=0.95)
    for k in range(4):
        groove(Q + k, level=0.86)
    # both Calls, and the fifth
    blast(Q + 8, ICE, 'Am6', vel=1.0)
    blast(Q + 9, FIRE, 'A', vel=1.0)
    for part, notes in ((wom, '[E5 A5]'), (men, '[A3 E4]'), (tpt, '[E5 A5]'), (hn, '[A3 E4]'),
                        (tbn, '[A2 E3]'), (vn1, '[A5 E6]'), (arp_v2, '[E4 A4]'), (arp_va, '[A3 E4]'),
                        (vc, '[A2 E3]'), (cb, 'A1'), (tuba, 'A1'), (fl, 'E6'), (ob, 'E5')):
        part.at(Q + 10).play(f'%sus @fff {notes}:5.5')
    troll.at(Q + 10).play('@ff A2:5.5')
    perc.note(at(Q + 10, 0), 36, 1.0, vel=1.0)
    perc.note(at(Q + 10, 0), 46, 1.0, vel=1.0)
    boom.note(at(Q + 10, 0), 'A0', 2.0, vel=1.0)
    cym.note(at(Q + 10, 0), 49, 1.0, vel=0.9)

    s.notes_text = __doc__
    return s


if __name__ == '__main__':
    sc = build()
    print(sc.title, len(sc.parts), 'parts')
