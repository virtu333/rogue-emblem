"""Act III battle II — "Against the Rite".

The grandest of the field themes: the warband climbing toward the ritual
site. Horns carry the Thread motif in B minor over perpetual-motion strings;
an F-sharp major chord throws the music a third sideways into a soaring
D major chorus; the bridge turns to B7 and the chorus returns a step higher
in E, now with the choir, before the build drops back to B minor.

The chorus never lands: its Thread cell holds the fifth over the tonic
(A over D, then B over E) instead of closing on the root, so an Act III
field battle does not spend the cadence kept for promotion and the run's
end. The choir sings only the second chorus, and no trumpets double it.
"""

from engine.patterns import chart
from engine.score import Score

from scores._battle import Battle

KEY = 'music_battle_act3_2'

MEL_A = """
F#4q B4q C#5e F#5q.~ | F#5h E5q D5q | E5q. D5e C#5q A4q | B4w |
F#4q B4q C#5e F#5q.~ | F#5q A5q G5q F#5q | E5q. F#5e G5q E5q | F#5w |
"""
CHORUS = """
A5h D6q E6q | F#6w | E6q D6q C#6q B5q | A5h F#5h |
G5h. A5q | B5q A5q G5q F#5q | E5h A5h~ | A5w |
"""
BRIDGE = """
B4h D5q G5q | G5h. F#5q | E5h G5q C6q | C6h. B5q |
B4h D5q G5q | G5h A5q B5q | C6q B5q A5q G5q | F#5w |
"""
CH_A = chart('Bm G A Bm Bm D Em:2 A7:2 F#')
CH_B = chart('D Bm G:2 A:2 D G Em A D')
CH_C = chart('G Em C D G Em C B7')
CH_B2 = chart('E C#m A:2 B:2 E A F#m B E')
CH_BUILD = chart('C D Em F#7')

DRIVE = {'kick': 'x.....x.x.....x.', 'rim': '....x.......x...', 'hat': 'X.x.X.x.X.x.X.x.'}
CHORUS_BEAT = {'kick': 'x.x...x.x.x...x.', 'rim': '....X.......X...', 'ride': 'X.x.X.x.X.x.X.x.'}
FILL = {'kick': 'x.....x.x.......', 'rim': '....x.......', 'snare': '............xxXX',
        'tom_lo': '..........xx....'}
BRIDGE_BEAT = {'kick': 'x.......x.......', 'rim': '........X.......', 'ride': 'x.x.x.x.x.x.x.x.'}


def build():
    s = Score('battle_act3_2', tonic='B', bpm=156, intro_bars=4, loop_bars=36, title='Against the Rite',
              seed=79)
    s.reverb = dict(rt60=2.4, predelay_ms=26, wet_db=0.0)
    s.master = dict(lufs=-13.8, glue_ratio=1.5)
    b = Battle(s, calm_lufs=-17.0, full_lufs=-13.8)
    b.section('intro', 1, chart('Bm Bm G F#')).section('A', 5, CH_A).section('B', 13, CH_B)
    b.section('C', 21, CH_C).section('B2', 29, CH_B2).section('build', 37, CH_BUILD)

    b.lead('A', MEL_A, inst='horns', transpose=-12, dyn='f', layer='full')
    b.lead('A', MEL_A, inst='violins', dyn='mf', name='a_vn', role='lead2')
    b.lead('B', CHORUS, inst='violins', dyn='ff', art='sus')
    b.lead('B', CHORUS, inst='violins2', name='lead8', transpose=-12, dyn='f', role='lead2',
           art='sus')
    b.lead('C', BRIDGE, inst='celli', name='bridge_vc', dyn='f', transpose=-12, role='lead',
           art='sus')
    b.lead('C', BRIDGE, inst='horns', name='bridge_hn', dyn='mf', transpose=-12, layer='full',
           role='lead2')
    b.lead('B2', CHORUS, inst='violins', transpose=2, dyn='ff')
    b.lead('B2', CHORUS, inst='violins2', name='lead8', transpose=-10, dyn='ff', role='lead2')
    # the choir arrives only for the second chorus (no trumpets on the tune)
    b.lead('B2', CHORUS, inst='choir', name='choir_lead', transpose=-10, dyn='ff', layer='full',
           role='lead2')
    b.lead('build', 'E5q G5q C6q E6q | F#5q A5q D6q F#6q | G5q B5q E6q G6q | A#5q C#6q E6q F#6q |',
           inst='violins', dyn='ff')

    b.lead('A', MEL_A, inst='oboe', dyn='mf', layer='calm')
    b.lead('B', CHORUS, inst='flute', dyn='mf', layer='calm')
    b.lead('C', BRIDGE, inst='clarinet', dyn='mf', layer='calm')
    b.lead('B2', CHORUS, inst='solo_violin', transpose=2, dyn='f', layer='calm')

    for sec in ('intro', 'A', 'B', 'C', 'B2', 'build'):
        b.spic16(sec, 'violins2', pattern='0 1 2 3 2 1 2 1', lo=62, hi=86, vel=0.58,
                 name='perpetual', calm_db=-6)
    for sec in ('A', 'B', 'B2'):
        b.spic8(sec, 'violas', degrees='0 1 2 1 0 1 2 1', lo=52, hi=69, vel=0.58, accents=None)
        b.spic8(sec, 'celli', degrees='b b b b b b b b', lo=40, hi=57)
    for sec in ('A', 'B', 'B2', 'build'):
        b.low(sec, 'q')
    b.low('C', 'w')
    b.pads('C', 'violas', n=2, lo=55, hi=69)

    b.brass_pad('B', 'horns', n=3, lo=53, hi=69, vel=0.6)
    b.brass_pad('B', 'trombones', n=2, lo=43, hi=60, vel=0.55)
    b.brass_pad('B2', 'horns', n=3, lo=55, hi=71, vel=0.66)
    b.brass_pad('B2', 'trombones', n=2, lo=45, hi=62, vel=0.62)
    b.stabs('A', rhythm='q. q. q', lo=62, hi=76)
    b.choir('C', 'oohs', n=3, lo=55, hi=71, vel=0.55)
    b.brass_pad('build', 'horns', n=3, lo=55, hi=69, vel=0.66)

    b.groove('intro', {'kick': 'x...x...x...x...', 'tom_lo': '..x...x...x...xx'}, crash=False)
    b.groove('A', DRIVE, FILL, every=4)
    b.groove('B', CHORUS_BEAT, FILL, every=4)
    b.groove('C', BRIDGE_BEAT, FILL, every=8)
    b.groove('B2', CHORUS_BEAT, FILL, every=4)
    b.groove('build', {'kick': 'x...x...x...x...', 'snare': 'x.x.x.x.xxxxxxxx'}, crash=False)
    for sec in ('A', 'B', 'B2', 'build'):
        b.rbass(sec, rhythm='e e e e e e e e', notes='r r r r r r 8 r')
        b.sub(sec)
    b.rbass('C', rhythm='q. e h', notes='r r 5', accents=None)

    b.timp('intro', '@f B2q rq B2q rq | B2q rq B2e B2e B2q | G2q rq G2q rq | F#2q F#2q F#2q F#2q |')
    for sec, t in (('A', '@f B2q rq rh |'), ('B', '@ff D3q rq rh |'), ('B2', '@ff E2q rq rh |')):
        b.timp(sec, t)
    b.timp('build', '%roll @mf C3w | D3w | E2w | F#2w |')
    for bar in (5, 13, 21, 29):
        b.hit(bar)
    b.riser(27, beats=8)
    b.riser(37, beats=8)
    glock = b.part('glock', 'glock', role='accent', layer='both', calm_db=-3)
    glock.at(13).play('@mf A6h D7q E7q | F#7w | rw | rw |')
    glock.at(29).play('@mf B6h E7q F#7q | G#7w | rw | rw |')

    for sec in ('A', 'B', 'C', 'B2'):
        b.calm_bed(sec)
    return b.finish()
