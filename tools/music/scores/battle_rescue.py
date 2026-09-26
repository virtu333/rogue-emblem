"""Recruit battles — "Someone Is Still Out There".

A stranger to save while the hunters close in. Two voices share one rhythm:
the Thread's opening (short, short, quick, and a long held reach), which is
ours, and the stranger's. The Thread climbs C-F-G-C (a fourth, a step, a
fourth); the stranger, in the same rhythm, cries a seventh up and settles:
F-E-flat-C-F. Their answers differ too. The Thread's answer walks down and
stops on the second degree, asking; the stranger's answer turns, falls
G-F-E-flat, drops to B-flat and lands on C over A-flat major: an answer, not
a question. Both answers pass through the same three notes (G-F-E-flat), and
that is where they meet.

  A   the stranger calls, alone over the hunters (oboe)
  A2  the Thread answers: our army (violins, horns)
  B   they meet: the stranger's phrase above, the Thread's an octave below,
      joining in octaves on G-F-E-flat and in unison on the stranger's C
  C   the hunters close in: the two heads call to each other bar by bar,
      climbing through F minor, D-flat, B-flat minor and a G-flat seventh
      (the flat second, the one remote colour), which steps down to F
  D   one of us: the stranger's line, kept note for note, taken up by
      everyone; the first time over its own bass (Fm7 Db Eb Ab), the second
      over ours (Db Bbm7 Cm7 F): its last note, C, is now the fifth of F
      major. Then someone else is still out there, and the loop begins again.

The hunters are a bass that stabs off the beat and walks up B-flat, C, E
into F (the leading tone in the bass, never in the Thread: its tonic cadence
stays reserved). Leitmotif: the Thread's head, in its battle rhythm (Ember
Dusk's), with its answer; never resolved to F.

The hope is in the inner voices (violas, with the horn and trombone pads),
not the bass: Indomitable Will's own inner parts work this way, and the bass
and tunes alone come out plainer and darker. Two colours, both ours, arrive
with the army:
  * the major IV over the tonic. When the Thread reaches its held note
    (A2), F minor turns to B-flat major over the same F: the raised sixth,
    D natural, under the held C. With the next chord the D falls back (to
    D-flat, then the second time to C).
  * the whole-tone shadow of the dominant. Where the Thread's second phrase
    comes home, and where the stranger's line reaches F major in D, the
    leading tone E in the bass carries no C chord. Above it are G-flat,
    B-flat and D: C's seventh with a flat fifth, rootless, all whole-tone.
    In A2 the B-flat and D stay put while the bass moves on, and they become
    the major IV over F. In D all three fall a semitone into F major:
    G–G-flat–F, E-flat–D–C, C–B-flat–A. Then the major IV over F turns the
    last bar back toward F minor and the next stranger.
The stranger's own strains (A, B, and D's first half) keep their plain minor.
"""

from engine.patterns import arp, bass, chart, drums, ostinato, pad
from engine.score import Score

from scores._battle import Battle

KEY = 'music_battle_rescue'

# ------------------------------------------------------------------ the two voices
# the Thread in F (Ember Dusk's head and answer, a third up), ending open on G.
# lint: its held reach (C) over D-flat is Ember Dusk's major seventh, intended
T_HEAD = 'C5q F5q G5e C6q.~ |'
T1 = T_HEAD + ' C6h Bb5e Ab5e Bb5q | G5q. F5e Eb5q F5q | G5w |'
T2 = T_HEAD + ' C6q Eb6q F6e Eb6q. | Db6q. C6e Bb5q G5q | Ab5q. Bb5e G5h |'
# the stranger: the same rhythm, other intervals (+10 -3 +5), its own answer
S_HEAD = 'F4q Eb5q C5e F5q.~ |'
S1 = S_HEAD + ' F5h Eb5e F5e Ab5q | G5q. F5e Eb5q Bb4q | C5w |'
S2 = S_HEAD + ' F5h Eb5e F5e Ab5q | G5q. F5e Eb5q D5q | C5w |'      # ends asking
# B: the Thread under the stranger, meeting it in octaves and then on its C
T_MEET = 'C4q F4q G4e C5q.~ | C5h Bb4e Ab4e Bb4q | G4q. F4e Eb4q F4q | C5w |'

CH_S1 = 'Fm7 Db Eb Ab'
CH_S2 = 'Fm7 Db Eb:3 Bb/D:1 C'
# ours: under the Thread's held reach, F minor turns to B-flat major over the same F
# (the raised sixth, D, and the major IV over the tonic), and falls back to D-flat
CH_T1 = 'Fm:2 Bb/F:2 Db Eb C'
# ...and the second phrase comes home over the leading tone with no dominant on it:
# its whole-tone shadow (G-flat, B-flat, D over E: C's seventh with a flat fifth, no
# root), then C9 over E, then the major IV over F again before the open G
CH_T2 = 'Fm:2 Bb/F:2 Ab Bbm:2 Gbaug/E:1 C7/E:1 Bb/F:2 C:2'
# the stranger's answer over our bass; its third bar takes the hunters' walk-up
# (B-flat, C, E in the bass) into F major, under the stranger's own E-flat and B-flat.
# On the E the chord is the whole-tone shadow again, each voice falling a semitone
# into F major; then the major IV over F, and the loop turns back to F minor
CH_HOME = 'Db Bbm7 Cm7:1 Cm7/Bb:1 Cm7:1 Gbaug/E:1 F:2 Bb/F:2'
# the inner voices that carry those colours (violas, both mixes), one chord per chart
# chord from the strain's first bar; None rests
HOPE_A2 = ['F3 Ab3 C4', 'F3 Bb3 D4', 'F3 Ab3 Db4', None, None,
           'F3 Ab3 C4', 'F3 Bb3 D4', 'Eb3 Ab3 C4', 'F3 Bb3 Db4', 'Gb3 Bb3 D4',
           'G3 Bb3 D4', 'F3 Bb3 D4', 'G3 C4 E4']
HOPE_D = [None] * 4 + ['F3 Ab3 Db4', 'F3 Ab3 Db4', 'G3 C4 Eb4', 'G3 C4 Eb4', 'G3 C4 Eb4',
                       'Gb3 Bb3 D4', 'F3 A3 C4', 'F3 Bb3 D4']

# C: the heads call across the field, each in the chord of its bar
# (over D-flat the stranger's call keeps its pitches: the harmony moves under it)
CALLS_S = ['F4q Eb5q C5e F5q. |', 'F4q Eb5q C5e F5q. |', 'Bb4q Ab5q F5e Bb5q. |',
           'Gb4q E5q Db5e Gb5q. |']
CALLS_T = ['C5q F5q G5e C6q. |', 'Ab4q Db5q Eb5e Ab5q. |', 'F4q Bb4q C5e F5q. |',
           'Db4q Gb4q Ab4e Db5q. |']
CH_C = 'Fm Fm Db Db Bbm Bbm Gb7 Gb7'

# the hunters: stabs off the beat, then the walk-up with the leading tone in the bass
STABS = """
F2q. F2e rq. F2e | rq F2q. F2e rq | F2q. F2e rq. F2e | rq Bb1q C2q E2q |
"""

ROCK = {'kick': 'x.....x.x.......', 'snare': '....x.......x...', 'hat': 'x.x.x.x.x.x.x.x.'}
ROCK2 = {'kick': 'x.....x.x.x.....', 'snare': '....x..x....x...', 'ride': 'X.x.X.x.X.x.X.x.'}
FILL = {'kick': 'x.....x.x.......', 'snare': '....x.......xxXX', 'tom_lo': '..........xx....'}
HUNT = {'kick': 'x.....x....x..x.', 'snare': '....x..x.x..x..x', 'hat': 'xxxxxxxxxxxxxxxx'}
HUNT_FILL = {'kick': 'x.....x.........', 'snare': '....x...xxxxXXXX', 'tom_lo': '......xx........'}


def build():
    s = Score('battle_rescue', tonic='F', bpm=148, intro_bars=4, loop_bars=40,
              title='Someone Is Still Out There', seed=163)
    s.reverb = dict(rt60=2.2, predelay_ms=24, wet_db=-1.0)
    # two melodic lines at once in B and D: keep the low mids and the bite out of their way
    s.master = dict(lufs=-14.0, glue_ratio=1.5, eq=[('peak', 300, 0.8, -2.5),
                    ('peak', 3200, 1.0, -1.2), ('highshelf', 9000, 0.7, 1.0)])
    b = Battle(s, calm_lufs=-17.0, full_lufs=-14.0)
    INTRO, A, A2, B, C, D = 1, 5, 13, 21, 29, 37
    b.section('intro', INTRO, chart('Fm Fm Fm Bb:1 C:1 E:2'))
    b.section('A', A, chart(f'{CH_S1} {CH_S2}'))
    b.section('A2', A2, chart(f'{CH_T1} {CH_T2}'))
    b.section('B', B, chart(f'{CH_S1} {CH_S1}'))
    b.section('C', C, chart(CH_C))
    b.section('D', D, chart(f'{CH_S1} {CH_HOME}'))
    STRAINS = ('A', 'A2', 'B', 'C', 'D')

    # ================================================================ the stranger
    ob = b.part('stranger', 'oboe', role='lead', calm_db=0, gain=2.5, pan=-0.2,
                eq=[('peak', 1500, 1.0, 2.0)])
    ob.at(A).play('@f ' + S1 + ' ' + S2)
    ob.at(B).play('@f ' + S1 + ' ' + S1)
    ob.at(D).play('@f ' + S1 + ' ' + S1)
    # a lone fiddle doubles the stranger in the full mix: one person, not a section
    sv = b.part('stranger_vn', 'solo_violin', role='lead', layer='full', gain=-3, pan=-0.3,
                eq=[('peak', 3000, 1.0, -3.0)])
    sv.at(A).play('@f ' + S1 + ' ' + S2)
    sv.at(B).play('@f ' + S1 + ' ' + S1)
    sv.at(D).play('@f ' + S1 + ' ' + S1)
    # each phrase leans into its reach and its answer
    pts = []
    for start in (A, A + 4, B, B + 4, D, D + 4):
        pts += [(start, 0.82), (start + 0.9, 1.0), (start + 2.5, 1.0), (start + 3, 0.9),
                (start + 3.9, 0.8)]
    ob.expr(*pts)
    sv.expr(*pts)
    # in the full mix the violins take the stranger's line from B on: someone heard
    vn = b.part('vn', 'violins', role='lead', layer='full', art='sus',
                eq=[('peak', 3000, 1.0, -2.0)])
    vn.at(B + 4).play('@f ' + S1, transpose=12)
    vn.at(D).play('@f ' + S1 + ' @ff ' + S1, transpose=12)
    vn2 = b.part('vn2', 'violins2', role='lead2', layer='full', art='sus')
    vn2.at(B + 4).play('@f ' + S1)
    vn2.at(D).play('@f ' + S1 + ' ' + S1)

    # ================================================================ the Thread
    th = b.part('thread_vn', 'violins', role='lead', layer='full', art='sus',
                eq=[('peak', 3500, 1.0, -3.5), ('highshelf', 7000, 0.7, -2.0)])
    th.at(A2).play('@f ' + T1 + ' ' + T2)
    hn = b.part('hn', 'horns', role='lead2', layer='full', gain=2.0,
                eq=[('peak', 1200, 1.0, 2.0)])
    hn.at(A2).play('@f ' + T1 + ' ' + T2, transpose=-12)
    b.lead('A2', T1 + ' ' + T2, inst='flute', layer='calm', dyn='mf')
    # B: the Thread under the stranger, an octave down, meeting it
    hn.at(B).play('@f ' + T_MEET + ' @ff ' + T_MEET)
    tpt = b.part('tpt', 'trumpets', role='lead2', layer='full', pan=0.35)
    tpt.at(B + 4).play('@f ' + T_MEET, transpose=12)
    b.lead('B', T_MEET, inst='clarinet', layer='calm', dyn='mf', name='calm_meet')
    b.lead('B', 'rw | rw | rw | rw |' + T_MEET, inst='clarinet', layer='calm', dyn='mf',
           name='calm_meet')
    # D: everyone takes the stranger's line
    hn.at(D).play('@f ' + S1 + ' @ff ' + S1, transpose=-12)
    tpt.at(D + 4).play('@f ' + S1)
    b.lead('D', 'rw | rw | rw | rw |' + S1, inst='flute', layer='calm', dyn='mf',
           transpose=12, name='calm_home')

    # ================================================================ C: calls across the field
    for i in range(4):
        ob.at(C + 2 * i).play('@f ' + CALLS_S[i] + ' rw |')
        tpt.at(C + 2 * i + 1).play('@f ' + CALLS_T[i])
    b.lead('C', ''.join(f'rw | {t} ' for t in CALLS_T), inst='flute', layer='calm',
           dyn='mf', name='calm_calls')
    spic = b.part('ost16', 'violins2', role='ostinato', art='spic', layer='full')
    arp(spic, C, b.chart('C'), '0 1 2 1', step=0.25, lo=60, hi=79, vel=0.58, accent_every=1)

    # ================================================================ the hunters
    low = b.part('hunt_low', 'basses', role='low', art='spic', calm_db=-4)
    low.at(INTRO).play('%spic @f ' + STABS)
    tbn = b.part('hunt_tbn', 'trombones', role='section', layer='full', art='stac', gain=-3)
    tbn.at(INTRO).play('%stac @f ' + STABS, transpose=12)
    tuba = b.part('hunt_tuba', 'tuba', role='low', layer='full', art='stac')
    tuba.at(INTRO).play('%stac @f ' + STABS)
    # C: the stabs return under the calls, on each chord's root
    roots = {'Fm': 0, 'Db': -4, 'Bbm': 5, 'Gb7': 1}
    for i, (c, _) in enumerate(b.chart('C')):
        r = roots[c.symbol]
        pat = STABS.strip().split('|')[i % 2].strip() + ' |'
        low.at(C + i).play('%spic @f ' + pat, transpose=r)
        tbn.at(C + i).play('%stac @f ' + pat, transpose=12 + r)
        tuba.at(C + i).play('%stac @f ' + pat, transpose=r)

    # ================================================================ the engine
    for sec in ('A', 'A2', 'D'):     # (B keeps only the celli: two lines must be heard)
        b.spic8(sec, 'violas', degrees='0 1 2 1 0 1 2 1', lo=53, hi=69, vel=0.55,
                accents='> - - - > - - -', layer='full')
    for sec in ('A', 'A2', 'B', 'D'):
        b.spic8(sec, 'celli', degrees='b b b b b b b b', lo=41, hi=57, vel=0.6,
                accents='> - - > - - > -', calm_db=-7)
        bass(low, b.bar(sec), b.chart(sec), 'h h', 'b 5', floor=29, vel=0.62, art='spic')
    # (no horn pads where two lines must be heard: B and D)
    for sec in ('A', 'A2', 'C'):
        b.pads(sec, 'horns', name='hn_pad', n=3, lo=48, hi=62, vel=0.42, layer='full')
    b.low('C', 'w', vel=0.62)

    # the stranger's line over our bass: the harmony arrives with brass and strings
    b.pads('D', 'trombones', name='tbn_pad', n=3, lo=43, hi=60, vel=0.5, layer='full')

    # ================================================================ hope, in the inner voices
    # the raised sixth and the major IV over F, and the whole-tone shadow of the dominant
    # over the leading tone, held by the violas under the tunes (a repeated chord is tied)
    hope = b.part('hope_va', 'violas', role='pad', art='sus', calm_db=0, gain=2.0)
    for sec, voicing, dyn in (('A2', HOPE_A2, 'mp'), ('D', HOPE_D, 'mf')):
        t = s.bar(b.bar(sec))
        held = None                     # [start, beats, voicing]
        for (_, beats), v in zip(b.chart(sec), voicing):
            if held and v == held[2]:
                held[1] += beats
            else:
                if held and held[2]:
                    hope.at_beat(held[0]).play(f'@{dyn} [{held[2]}]:{held[1]}')
                held = [t, beats, v]
            t += beats
        if held and held[2]:
            hope.at_beat(held[0]).play(f'@{dyn} [{held[2]}]:{held[1]}')

    # ================================================================ harp in the holds
    hp = b.part('harp', 'harp', role='keys', calm_db=-2, gain=-2)
    holds = []
    for start in (A, A + 4, B, B + 4, D, D + 4):
        holds += [(start + 1, 2), (start + 3, 4)]             # after the reach; the last bar
    for start in (A2, A2 + 4):
        holds += [(start + 1, 2)]
    for bar, beats in holds:
        # (a hold can span a chord change: the last bar of D turns to B-flat over F)
        arp(hp, bar, _chords_in(b, bar, beats), '0 1 2 3 4 5 6 7', step=0.25, lo=55,
            hi=91, vel=0.5)

    # ================================================================ drums
    b.groove('intro', {'kick': 'x.....x....x..x.', 'snare': '....x.......x...',
                       'tom_lo': '..........x.....'}, crash=False, n_bars=3)
    b.kit.play(INTRO + 3, {'kick': 'x...x...x...x...', 'snare': '....x...x...xxxx'},
               ramp=0.4)
    b.kit.parts['snare'].opts['gain'] = -4.0
    b.groove('A', ROCK, FILL, every=4, vel=0.72)
    b.groove('A2', ROCK2, FILL, every=4, vel=0.76)
    b.groove('B', ROCK2, FILL, every=4, vel=0.78)
    b.groove('C', HUNT, HUNT_FILL, every=4, vel=0.78)
    b.groove('D', ROCK2, FILL, every=4, vel=0.8)
    for sec in STRAINS:
        b.rbass(sec, rhythm='e e e e e e e e', notes='r r r r r r 8 r')
        b.sub(sec)
    b.timp('intro', '@f F2q. F2e rq. F2e | rq F2q. F2e rq | F2q. F2e rq. F2e |'
                    ' rq Bb2q C3q E2q |')
    b.timp('C', '@f F2q. F2e rq. F2e | rw | Db2q. Db2e rq. Db2e | rw |'
                ' Bb2q. Bb2e rq. Bb2e | rw | Gb2q. Gb2e rq. Gb2e | %roll Gb2w |')
    for bar in (A, A2, B, C, D, D + 4):
        b.hit(bar)
    b.riser(C + 6, beats=8)

    # ================================================================ calm bed
    for sec in STRAINS:
        b.calm_bed(sec, piano='0 2 4 2', piano_lo=50, piano_hi=76, heartbeat=True)
    return b.finish()


def _chords_in(b, bar, beats):
    """The chart chords sounding over `beats` from the start of `bar`, clipped to it."""
    a, z = b.s.bar(bar), b.s.bar(bar) + beats
    out = []
    for start, ch in b.sections.values():
        t = b.s.bar(start)
        for c, n in ch:
            lo, hi = max(t, a), min(t + n, z)
            if hi - lo > 1e-6:
                out.append((c, hi - lo))
            t += n
    if abs(sum(n for _, n in out) - beats) > 1e-6:
        raise ValueError(f'no chart covers bar {bar}')
    return out
