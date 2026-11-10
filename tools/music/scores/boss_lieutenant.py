"""The Lieutenant — "Every Future You Could Reach".

The second version of his theme (Nov 2026; the first, 44 bars, is in the
repository's history). What it keeps from the first: D minor at 168, the pizzicato clock that has lost count, the
sign (the Thread's rhythm falling, A-D-C-A) with its shadow a tritone away
and a beat behind, the octatonic clockwork, the player's battle theme
returning, the last strain a step up in E minor with Sera's violin answering
him once, unshadowed.

What it adds: THE NOTE HE CANNOT SEE. Everything of his is written inside
one octatonic scale (D Eb F F# G# A B C). In that scale his sign fits at
four levels a minor third apart (on A, C, E-flat and F-sharp: every future),
all four end on the same diminished seventh, and the only tonics are D, F,
A-flat and B, each a minor third from the next, so the harmony turns in a
ring and never arrives. The scale has no E. The Thread is A-D-E-A.

Form (bars): intro 1-4 (the clock) | A 5-12 (the sign climbing through its
four futures, each shadowed; a fall down the tonic diminished seventh) |
A' 13-20 (a second tune of his own: it rises like the Thread and slips a
semitone at the top, over basses a tritone apart; then the whole scale,
falling) | B 21-28 (clockwork sixteenths, the sign augmented in the brass) |
P 29-36 (the pile: the sign in four voices a beat apart, one on each
future, freezing on the diminished seventh, over D, F, A-flat, B; last, all
four at once) | X 37-44 (the futures he blocked: the Thread starts in D
minor, F minor, A-flat minor, B minor; each time, on the beat its third
note is due, the sign comes down on it) | D 45-52 (the path he could not
block: Ember Dusk's tune complete in D minor, its E sounding at last, his
sign grinding in the low brass; on the last beat his pile comes down once
more over a B, and so becomes the dominant of E minor) | E 53-60 (the tune
a step up; Sera answers with his own falling line on B, B-E-D-B, which
holds the E his scale does not) | build 61-64. Loop 5-64, 60 bars, 86 s.

Enrage (the shipped idea, kept): he is a beat ahead. His tritone shadow comes
before his sign in A and A', now also on short trumpets, and in the player's
strains his glass plays the player's tune a beat early.
"""

from engine.patterns import chart, drums, pad
from engine.score import Score

from scores import _enrage
from scores._battle import Battle
from scores.battle_act1 import MEL_A

KEY = 'music_boss_lieutenant'

# A: the sign on each of its four futures, climbing, then the fall
SIGN_A = """
A5q D5q C5q A4q | Ab4h. F4q | C6q F5q Eb5q C5q | B4h. Ab4q |
Eb6q Ab5q Gb5q Eb5q | F#6q B5q A5q F#5q | F6q D6q B5q Ab5q | F5q D5h. |
"""
# its shadows: a tritone away, a beat behind
SHADOW_A = """
rq Eb5q Ab4q Gb4q | Eb4w | rq F#5q B4q A4q | F#4w |
rq A5q D5q C5q | rq C6q F5q Eb5q | C5q rq rh | rw |
"""
CH_A = chart('Dm7 Fm Fm7 Abm Abm7 Bm7 Ddim7 Dm')

# A': his own second tune. It rises as the Thread does and slips at the top.
TUNE_B = """
re A4e D5e F5e A5q. Ab5e~ | Ab5h Eb5q C5q | re C5e F5e Ab5e C6q. B5e~ | B5h F#5q D#5q |
D6q. C6e B5e A5e G#5q | F#5q. F5e Eb5e D5e C5q | B4q. D5e F5q. Ab5e | A5h. rq |
"""
CH_A2 = chart('Dm Ab Fm B Dm Ab7 Bdim7 D5')

# B: the clockwork and the sign augmented
OCTA = 'D5s Eb5s F5s F#5s G#5s A5s B5s C6s D6s C6s B5s A5s G#5s F#5s F5s Eb5s |'
AUG = 'A4h D4h | C4h A3h | Ab3w | B3w | C5h F4h | Eb4h C4h | B3w | D4w |'
CH_B = chart('Dm Dm Fm B Fm Fm Abm D5')

# the player's strains
CH_D = chart('Dm Bbmaj7 C A Dm F Gm:2 A7:2 Dm:3 B7b9:1')
CH_E = chart('Em Cmaj7 D B Em G Am:2 B7:2 Em')
CH_BUILD = chart('C D Eb A7')
LIEUT_LOW = 'A3q D3q C3q A2q | Bb2w | C3w | A2w | A3q D3q C3q A2q | F2w | G2h A2h | D3h. rq |'
# Ember Dusk's tune with its last note cut short for the pile
MEL_CUT = """
A4q D5q E5e A5q.~ | A5h G5e F5e G5q | E5q. D5e C5q D5q | E5w |
A4q D5q E5e A5q.~ | A5q C6q D6e C6q. | Bb5q. A5e G5q E5q | F5q. E5e D5q rq |
"""

INTRO, A, A2, B, P, X, D, E, BUILD = 1, 5, 13, 21, 29, 37, 45, 53, 61
FUTURES = ('A', 'C', 'Eb', 'F#')          # where the sign can begin
ROOTS = ('D', 'F', 'Ab', 'B')             # the ring of tonics

FRACTURE = {'kick': 'x..x..x...x..x..', 'rim': '....x.......x...', 'hat': 'x.xxx.xxx.xxx.xx'}
SLIP = {'kick': 'x..x....x.x..x..', 'snare': '....X.......X...', 'hat': 'x.x.x.x.x.x.x.x.'}
DRIVE = {'kick': 'x.x...x.x.x...x.', 'rim': '....X.......X...', 'ride': 'X.x.X.x.X.x.X.x.'}
FILL = {'kick': 'x.x...x.x.......', 'snare': '........xxxxXXXX', 'tom_hi': '....xx..'}
HALF = {'kick': 'x.........x.....', 'rim': '........X.......', 'ride': 'x.x.x.x.x.x.x.x.'}
PILE = {'kick': 'x...x...x...x...', 'tom_hi': 'x.......', 'tom_mid': '....x...........',
        'tom_lo': '........x.......', 'tom_floor': '............x...'}
PILE_HOLD = {'kick': 'x.....x.x.....x.', 'snare': '....X.......X.xx'}


def _sign(top):
    """The sign from `top` (a MIDI pitch): 5-1-b7-5, falling an octave."""
    return (top, top - 7, top - 9, top - 12)


def build():
    s = Score('boss_lieutenant', tonic='D', bpm=168, intro_bars=4, loop_bars=60,
              title='Every Future You Could Reach', seed=1107)
    s.reverb = dict(rt60=2.4, predelay_ms=26, wet_db=0.0)
    s.master = dict(lufs=-13.2, glue_ratio=1.6)
    b = Battle(s, full_lufs=-13.2, adaptive=False)
    b.section('intro', INTRO, chart('Dm Dm Ab D5')).section('A', A, CH_A)
    b.section('A2', A2, CH_A2).section('B', B, CH_B)
    b.section('P', P, chart('D7b9 D7b9 F7b9 F7b9 Ab7b9 Ab7b9 B7b9 B7b9'))
    b.section('X', X, chart('Dm:5 D7b9:3 Fm:5 F7b9:3 Abm:5 Ab7b9:3 Bm:5 B7b9:3'))
    b.section('D', D, CH_D).section('E', E, CH_E).section('build', BUILD, CH_BUILD)

    # ================================================================ intro: the clock
    clock = b.part('clock', 'violins2', role='ostinato', art='pizz')
    echo = b.part('clock_echo', 'violas', role='ostinato', art='pizz', pan=0.5)
    for bar in range(1, 5):
        clock.at(bar).play('@f A5e D5e A5e D5e A5e D5e A5e D5e |')
        # the same clock a dotted eighth late and a tritone away
        echo.at_beat(s.bar(bar) + 0.75).play('@mf Eb5e Ab4e Eb5e Ab4e Eb5e Ab4e r:0.25')

    # ================================================================ A: the sign and its futures
    b.lead('A', SIGN_A, inst='violins', dyn='ff', art='sus')
    b.lead('A', SIGN_A, inst='violas', name='lead8', transpose=-12, dyn='f', role='lead2',
           art='sus')
    b.lead('A', SHADOW_A, inst='horns', name='shadow_hn', transpose=-12, dyn='f', role='counter')
    b.lead('A', SHADOW_A, inst='violas', name='shadow_va', dyn='mf', role='counter', art='sus')
    b.pads('A', 'violas', n=2, lo=50, hi=65, art='trem', name='trem_va', vel=0.5)
    glock = b.part('glass', 'glock', role='accent')
    glock.at(A).play('@mf A6q D6q C6q A5q | rw | C7q F6q Eb6q C6q | rw |'
                     ' Eb7q Ab6q Gb6q Eb6q | F#7q B6q A6q F#6q | rw | rw |')

    # ================================================================ A': his second tune
    b.lead('A2', TUNE_B, inst='violins', dyn='ff', art='sus')
    b.lead('A2', TUNE_B, inst='trumpets', name='b_tpt', transpose=-12, dyn='f', role='lead2')
    b.lead('A2', TUNE_B, inst='celli', name='b_vc', transpose=-24, dyn='f', role='lead2',
           art='sus')
    # the tritone under it, held: horns on the two roots of each pair
    hn = b.part('ring_hn', 'horns', role='pad')
    hn.at(A2).play('@f [D3 A3]w | [Ab3 Eb4]w | [F3 C4]w | [B3 F#4]w |'
                   ' [D3 A3]w | [Ab3 Eb4]w | [B3 F4]w | [D3 A3]h. rq |')
    b.spic16('A2', 'violins2', pattern='0 2 1 2', lo=60, hi=79, vel=0.52)
    b.choir('A2', 'oohs', n=3, lo=53, hi=70, vel=0.56)

    # ================================================================ B: clockwork
    osc = b.part('octa', 'violins2', role='ostinato', art='spic')
    osc.at(B).play('@f' + OCTA * 8)
    osc2 = b.part('octa_va', 'violas', role='ostinato', art='spic', pan=0.4)
    # the same scale a tritone away and a sixteenth behind, from the fifth bar
    for bar in range(B + 4, B + 8):
        osc2.at_beat(s.bar(bar) + 0.25).play(
            '@mf G#4s A4s B4s C5s D5s Eb5s F5s F#5s G#5s F#5s F5s Eb5s D5s C5s B4s')
    b.lead('B', AUG, inst='horns', name='aug_hn', dyn='ff', role='lead')
    b.lead('B', AUG, inst='trombones', name='aug_tbn', transpose=-12, dyn='ff', role='lead2')
    b.choir('B', 'oohs', n=3, lo=53, hi=70, vel=0.6)

    # ================================================================ P: the pile
    voices = (b.part('lead_violins', 'violins'),
              b.part('pile_tpt', 'trumpets', role='lead2'),
              b.part('pile_hn', 'horns', role='lead2'),
              b.part('pile_tbn', 'trombones', role='lead2'))
    tops = (81, 72, 63, 54)                  # A5, C5, Eb4, F#3
    for unit in range(3):
        t0 = s.bar(P + 2 * unit)
        order = (0, 1, 2, 3) if unit != 1 else (3, 2, 1, 0)      # second time from the bottom
        for k, v in enumerate(order):
            part, sign = voices[v], _sign(tops[v])
            t = t0 + k
            for i, p in enumerate(sign[:3]):
                part.note(t + i, p, 1.0, vel=0.86 + 0.03 * unit, art='sus' if v == 0 else None,
                          rearticulate=True)
            # the last note holds to the end of the unit: the diminished seventh
            part.note(t + 3, sign[3], 8.0 - (k + 3) - 0.5, vel=0.84 + 0.03 * unit,
                      art='sus' if v == 0 else None, rearticulate=True)
    # last unit: all four at once, the sign in parallel diminished sevenths, twice
    t0 = s.bar(P + 6)
    for rep in range(2):
        for v, part in enumerate(voices):
            for i, p in enumerate(_sign(tops[v] + 12)[:4]):
                last = rep == 1 and i == 3
                part.note(t0 + 4 * rep + i, p, 0.5 if last else 1.0, vel=0.96,
                          art='sus' if v == 0 else None, rearticulate=True)
    choir = b.part('pile_choir', 'choir', role='choir')
    for unit in range(4):
        t0 = s.bar(P + 2 * unit)
        for p in ('A3', 'C4', 'Eb4', 'F#4'):
            choir.note(t0 + (3 if unit < 3 else 0), p, 4.5 if unit < 3 else 7.5,
                       vel=0.6 + 0.05 * unit, rearticulate=True)
    b.pads('P', 'violas', n=2, lo=53, hi=66, art='trem', name='trem_va', vel=0.56)

    # ================================================================ X: the futures he blocked
    reach = b.part('reach', 'violins2', role='lead', art='sus')
    reach_ob = b.part('reach_tpt', 'trumpets', role='lead2')
    block = (b.part('block_hn', 'horns', role='lead'),
             b.part('block_tbn', 'trombones', role='lead2'),
             b.part('block_tuba', 'tuba', role='low'))
    block_tpt = b.part('block_tpt', 'trumpets', role='lead2')
    stab_ch = b.part('block_choir', 'choir', role='choir')
    fifths = (69, 72, 75, 78)                # A4, C5, Eb5, F#5: the Thread's first note in each key
    for unit in range(4):
        t0 = s.bar(X + 2 * unit)
        f = fifths[unit]
        v = 0.6 + 0.08 * unit
        # the Thread: 5, 1 ... and the 2 never sounds
        for part, tr, dv in ((reach, 0, 0.0), (reach_ob, -12, -0.06)):
            part.note(t0, f + tr, 1.0, vel=v + dv, rearticulate=True)
            part.note(t0 + 1, f + 5 + tr, 0.92, vel=v + dv + 0.04, rearticulate=True)
        # the sign comes down on the beat the third note is due, from the note it was reaching for
        h = (69, 72, 63, 66)[unit]            # the horns' first note
        lines = [(block[0], h), (block[1], h - 12), (block[2], h - 24 if h - 36 >= 28 else h - 12)]
        if unit >= 2:
            lines.append((block_tpt, h + 12))
        for part, top in lines:
            for i, p in enumerate(_sign(top)):
                part.note(t0 + 2 + i, p, 1.0 if i < 3 else 1.6, vel=0.9 + 0.02 * unit,
                          rearticulate=True)
        for p in ('A3', 'C4', 'Eb4', 'F#4'):
            stab_ch.note(t0 + 5, p, 1.6, vel=0.62 + 0.04 * unit, rearticulate=True)

    # ================================================================ D: the path he could not block
    b.lead('D', MEL_CUT, inst='violins', dyn='ff')
    b.lead('D', MEL_CUT, inst='trumpets', transpose=-12, dyn='ff', name='c_tpt')
    b.lead('D', LIEUT_LOW, inst='trombones', name='grind', dyn='ff', role='counter')
    b.lead('D', LIEUT_LOW, inst='tuba', name='grind_tuba', transpose=-12, dyn='f', role='low')
    b.spic16('D', 'violins2', pattern='0 1 2 1', lo=62, hi=81)
    b.brass_pad('D', 'horns', n=3, lo=52, hi=67, vel=0.58)
    b.choir('D', 'choir', n=3, lo=55, hi=72, vel=0.62)
    # his last pile, on the last beat, over B: the dominant of E minor
    t = s.bar(E) - 1.0
    for part, p in zip(block, ('F#4', 'Eb4', 'B1')):
        part.note(t, p, 0.9, vel=0.95, rearticulate=True)
    for p in ('A3', 'C4', 'Eb4', 'F#4'):
        stab_ch.note(t, p, 0.9, vel=0.8, rearticulate=True)

    # ================================================================ E: a step up; Sera answers
    b.lead('E', MEL_A, inst='violins', transpose=2, dyn='ff')
    sera = b.part('sera', 'solo_violin', role='lead')
    sera.at(E + 4).play('@ff B5q E5q D5q B4q~ | B4w |')
    sera.expr((E + 4, 1.0), (E + 5, 1.0), (E + 5.9, 0.4))
    b.lead('E', MEL_A, inst='horns', name='d_hn', transpose=-22, dyn='ff', role='lead2')
    b.lead('E', MEL_A, inst='trumpets', transpose=-10, dyn='ff', name='d_tpt')
    b.spic16('E', 'violins2', pattern='0 1 2 1', lo=64, hi=83)
    b.choir('E', 'choir', n=3, lo=55, hi=74, vel=0.66)
    b.lead('build', 'C5q E5q G5q C6q | D5q F#5q A5q D6q | Eb5q G5q Bb5q Eb6q | C#5q E5q G5q A5q |',
           inst='violins', dyn='ff', name='build_vn')
    b.brass_pad('build', 'horns', n=3, lo=53, hi=69, vel=0.66, name='build_hn')

    # ================================================================ the ground
    for sec in ('A', 'A2', 'D', 'E', 'build'):
        b.spic8(sec, 'celli', degrees='b b b b b b b b', lo=38, hi=55)
        b.low(sec, 'q')
    b.low('B', 'w')
    cb = b.part('cb', 'basses')
    vc = b.part('ost8_celli', 'celli')
    eb = b.part('ebass', 'rbass', layer='full', role='bass', duck='kit_kick')
    sub = b.part('sub', 'sub', layer='full', role='sub')
    from engine.theory import pitch
    for unit in range(4):                     # P: the ring of tonics under the pile
        root = pitch(('D2', 'F2', 'Ab1', 'B1')[unit])
        for k in range(16):
            t = s.bar(P + 2 * unit) + 0.5 * k
            acc = 0.12 if k % 8 in (0, 3, 6) else 0.0
            vc.note(t, root + 12, 0.5, vel=0.6 + acc, art='spic')
            eb.note(t, root, 0.5, vel=0.7 + acc)
            if k % 2 == 0:
                cb.note(t, root, 1.0, vel=0.66, art='spic')
        sub.note(s.bar(P + 2 * unit), root, 8.0, vel=0.6)
    for unit in range(4):                     # X: a held root, then the blow
        root = pitch(('D2', 'F2', 'Ab1', 'B1')[unit])
        t0 = s.bar(X + 2 * unit)
        cb.note(t0, root, 2.0, vel=0.6, art='sus', rearticulate=True)
        vc.note(t0, root + 12, 2.0, vel=0.56, art='sus', rearticulate=True)
        for k in range(4, 12):
            t = t0 + 0.5 * k
            vc.note(t, root + 12, 0.5, vel=0.66 + (0.1 if k % 2 == 0 else 0), art='spic')
            eb.note(t, root, 0.5, vel=0.74)
            if k % 2 == 0:
                cb.note(t, root, 1.0, vel=0.7, art='spic')
        sub.note(t0 + 2, root, 4.0, vel=0.6)

    b.groove('intro', {'kick': 'x..x..x.x..x..x.'}, crash=False)
    b.groove('A', FRACTURE, FILL, every=4)
    b.groove('A2', SLIP, FILL, every=8)
    b.groove('B', HALF, FILL, every=8)
    b.groove('D', DRIVE, FILL, every=4)
    b.groove('E', DRIVE, FILL, every=4)
    b.groove('build', {'kick': 'x...x...x...x...', 'snare': 'x.x.x.x.xxxxxxxx'}, crash=False)
    kit = b.kit
    for unit in range(4):
        kit.play(P + 2 * unit, PILE if unit < 3 else PILE_HOLD, vel=0.76)
        kit.play(P + 2 * unit + 1, PILE_HOLD if unit < 3 else FILL, vel=0.76)
        kit.play(P + 2 * unit, {'crash': 'X'})
        # X: the kit is silent while the Thread reaches, and comes down with the sign
        kit.play(X + 2 * unit, {'kick': '........x.x.x.x.', 'snare': '........X...X...',
                                'crash': '........X.......'}, vel=0.8)
        kit.play(X + 2 * unit + 1, {'kick': 'x.x.....x.......', 'snare': '....X...X.......',
                                    'tom_floor': '......x.x.......'}, vel=0.78)
    for sec in ('A', 'A2', 'D', 'E', 'build'):
        b.rbass(sec, rhythm='e e e e e e e e', notes='r r r r r r 8 r')
        b.sub(sec)
    b.rbass('B', rhythm='q. q. q', notes='r r 8', accents='> > -')

    b.timp('intro', '@f D2q rq D2q rq | D2q rq D2e D2e D2q | Ab2q rq Ab2q rq | D2q D2q D2q D2q |')
    for sec, t in (('A', '@ff D2q rq rh |'), ('A2', '@ff D2q rq rh |'), ('D', '@ff D2q rq rh |'),
                   ('E', '@ff E2q rq rh |')):
        b.timp(sec, t)
    b.timp('B', '%default @f D2q rq D2q rq | D2q rq D2q rq | F2q rq F2q rq | B2q rq B2q rq |'
              ' F2q rq F2q rq | F2q rq F2q rq | Ab2q rq Ab2q rq | D2q D2q D2q D2q |')
    b.timp('P', '%default @ff D2q rq rh | rw | F2q rq rh | rw | Ab2q rq rh | rw |'
              ' B2q rq B2q rq | B2q B2q B2e B2e B2e B2e |')
    b.timp('X', '%default @f rh D2q D2q | D2q rq rh | rh F2q F2q | F2q rq rh |'
              ' rh Ab2q Ab2q | Ab2q rq rh | rh B2q B2q | %roll B2w |')
    b.timp('build', '%roll @f C3w | D3w | Eb2w | A2w |')
    for bar in (A, A2, B, P, D, E):
        b.hit(bar)
    b.riser(B + 6, beats=8)
    b.riser(X + 6, beats=8)
    b.riser(BUILD + 2, beats=8)

    # ================================================================ enrage: he is a beat ahead
    # the shipped layer (his shadow before his sign; the player's tune a beat early in
    # his glass), and a voice a phone can hear: muted trumpets on the early shadow
    v = 'enrage_lieutenant'
    his = [b.sections[k] for k in ('A', 'A2')]
    _enrage.lieutenant(b, [], [b.sections[k] for k in ('D', 'E')])
    shadow = s.parts['lt_early_shadow']  # celesta: a tritone up (same notes, in its range)
    early = b.extra(v, 'lt_early_tpt', 'trumpets', role='counter', art='stac', gain=1)
    src = s.parts['lead_violins']
    for bar, _ in his:
        a, z = s.bar(bar), s.bar(bar + 8)
        for n in list(src.notes):
            if a - 1e-9 <= n.start < z - 1e-9:
                early.note(n.start - 1.0, n.pitch - 6, min(n.dur, 0.5), vel=min(1.0, n.vel * 0.9),
                           art='stac')
                shadow.note(n.start - 1.0, n.pitch + 6, n.dur, vel=min(1.0, n.vel * 0.85))
    b.variant_lufs[v] = -12.4
    return b.finish()
