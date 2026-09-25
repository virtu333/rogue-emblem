"""Act II battle II — "Steel and Thread".

A tragic counterattack in A minor, driven by a piano ostinato that never
lets go. The strings sing the Thread motif long and high over major-seventh
harmony (E over F: hope hurting), the brass answer in C major, and a
breakdown leaves only the piano, a far choir and a cello before everything
returns at full strength.
"""

from engine.patterns import arp, bass, chart, pad
from engine.score import Score

from scores._battle import Battle

KEY = 'music_battle_act2_2'

MEL_A = """
E5h A5q B5q | E6w | E6q D6q C6q B5q | A5h. E5q |
F5h. E5q | D5q C5q B4q C5q | D5h E5h | E5w |
"""
MEL_B = """
G4q C5q D5e G5q.~ | G5h F5q E5q | F5q. E5e D5q C5q | D5w |
G4q C5q D5e G5q.~ | G5q A5q B5q C6q | D6q. C6e B5q G5q | G#5w |
"""
CELLO_C = 'A3h. C4q | B3w | G3h. B3q | A3w | F3h. A3q | G#3w | A3q B3q C4q E4q | E4w |'

CH_A = chart('Am Fmaj7 C Am Dm G E7sus4:2 E:2 Am')
CH_B = chart('C F Dm7 G C Am G E')
CH_C = chart('F G Em Am Dm E/G# Am E')
CH_BUILD = chart('F G Fmaj7 E7')

ROCK = {'kick': 'x.....x.x.....x.', 'rim': '....x.......x...', 'hat': 'X.x.X.x.X.x.X.x.'}
ROCK2 = {'kick': 'x.....x.x.x...x.', 'rim': '....x.......x...', 'ride': 'X.x.X.x.X.x.X.x.'}
FILL = {'kick': 'x.....x.x.......', 'rim': '....x.......', 'snare': '............xxXX',
        'tom_hi': '........xx......'}
HALF = {'kick': 'x.........x.....', 'xstick': '........x.......', 'hat': 'x.x.x.x.x.x.x.x.'}


def build():
    s = Score('battle_act2_2', tonic='A', bpm=144, intro_bars=4, loop_bars=36, title='Steel and Thread',
              seed=71)
    s.reverb = dict(rt60=2.2, predelay_ms=24, wet_db=-1.0)
    s.master = dict(lufs=-14.0, glue_ratio=1.5)
    b = Battle(s, calm_lufs=-17.0, full_lufs=-14.0)
    b.section('intro', 1, chart('Am Fmaj7 Am E')).section('A', 5, CH_A).section('B', 13, CH_B)
    b.section('C', 21, CH_C).section('A2', 29, CH_A).section('build', 37, CH_BUILD)

    # the piano ostinato: 16ths, shared by both layers
    pno = b.part('ostinato', 'grand', role='keys', calm_db=-3)
    fig = '0 2 4 3 5 4 2 3'
    for sec in ('intro', 'A', 'B', 'C', 'A2', 'build'):
        arp(pno, b.bar(sec), b.chart(sec), fig, step=0.25, lo=57, hi=84, vel=0.56,
            accent_every=1, accent=0.1)
    lh = b.part('piano_lh', 'grand', role='keys', calm_db=-3, gain=-3)
    for sec in ('intro', 'A', 'B', 'C', 'A2', 'build'):
        arp(lh, b.bar(sec), b.chart(sec), '0 0 0 0', step=1.0, lo=33, hi=52, vel=0.55)

    # tunes
    b.lead('A', MEL_A, inst='violins', dyn='f', art='sus')
    b.lead('A', MEL_A, inst='violins2', name='lead8', transpose=-12, dyn='mf', role='lead2',
           art='sus')
    b.lead('B', MEL_B, inst='violins', dyn='ff')
    b.lead('B', MEL_B, inst='horns', transpose=-12, dyn='ff', layer='full')
    b.lead('B', MEL_B, inst='trumpets', transpose=-12, dyn='f', layer='full', role='lead2')
    b.lead('C', CELLO_C, inst='celli', name='cello_solo', dyn='mf', role='lead', art='sus')
    b.lead('A2', MEL_A, inst='violins', dyn='ff')
    b.lead('A2', MEL_A, inst='violins2', name='lead8', transpose=-12, dyn='f', role='lead2')
    b.lead('A2', MEL_A, inst='trumpets', transpose=-12, dyn='f', layer='full', role='lead2')
    b.lead('build', 'C5q F5q A5q C6q | D6q B5q G5q D5q | C6q A5q F5q E5q | G#5q B5q D6q E6q |',
           inst='violins', dyn='f')

    # calm voices
    b.lead('A', MEL_A, inst='solo_violin', dyn='mf', layer='calm')
    b.lead('B', MEL_B, inst='flute', dyn='mf', layer='calm')
    b.lead('A2', MEL_A, inst='oboe', transpose=-12, dyn='mf', layer='calm')
    b.lead('A2', MEL_A, inst='flute', dyn='mf', layer='calm')

    # strings
    for sec in ('A', 'B', 'A2'):
        b.spic8(sec, 'celli', degrees='b b b b b b b b', lo=40, hi=57)
        b.low(sec, 'q')
        b.pads(sec, 'violas', n=2, lo=52, hi=67)
    b.pads('C', 'violins2', n=2, lo=60, hi=76, art='soft', name='c_vn2')
    b.low('C', 'w')
    b.low('build', 'w')
    b.spic16('build', 'violins2', pattern='0 1 2 3', lo=60, hi=84)

    # brass & choir
    b.brass_pad('A', 'horns', n=3, lo=50, hi=65, vel=0.5)
    b.brass_pad('A2', 'trombones', n=2, lo=43, hi=60, vel=0.6)
    b.choir('C', 'oohs', n=3, lo=55, hi=72, vel=0.5)
    b.choir('A2', 'choir', n=3, lo=55, hi=74, vel=0.66)
    b.brass_pad('build', 'horns', n=3, lo=53, hi=69, vel=0.62)

    # rhythm
    b.groove('intro', {'kick': 'x.......x.......'}, crash=False, n_bars=2)
    b.kit.play(3, {'kick': 'x...x...x...x...', 'hat': 'x.x.x.x.x.x.x.x.'})
    b.kit.play(4, {'kick': 'x...x...x.......', 'snare': '........xxxxxxxx'}, ramp=0.5)
    b.groove('A', ROCK, FILL, every=4)
    b.groove('B', ROCK2, FILL, every=4)
    b.groove('C', HALF, None, n_bars=6, crash=False)
    b.kit.play(27, {'kick': 'x...x...x...x...', 'snare': 'x.x.x.x.x.x.x.x.'}, ramp=0.4)
    b.kit.play(28, {'kick': 'x...x...x.x.x.x.', 'snare': 'xxxxxxxxxxxxxxxx'}, ramp=0.5)
    b.groove('A2', ROCK2, FILL, every=4)
    b.groove('build', {'kick': 'x...x...x...x...', 'tom_lo': 'x.x.x.x.xxxxxxxx'}, crash=False)
    for sec in ('A', 'B', 'A2', 'build'):
        b.rbass(sec, rhythm='e e e e e e e e', notes='r r r r r r 8 r')
        b.sub(sec)
    b.rbass('C', rhythm='w', notes='r', accents=None)

    for sec, t in (('A', '@f A2q rq rh |'), ('B', '@ff C3q rq rh |'), ('A2', '@ff A2q rq rh |')):
        b.timp(sec, t)
    b.timp('build', '%roll @mf F2w | G2w | F2w | E2w |')
    for bar in (5, 13, 29):
        b.hit(bar)
    b.riser(27, beats=8)
    b.riser(39, beats=8)

    # calm bed without a second piano (the ostinato already carries it)
    for sec in ('A', 'B', 'C', 'A2'):
        lp = b.part('c_low', 'celli', layer='calm', role='bass', art='soft')
        bass(lp, b.bar(sec), b.chart(sec), 'h h', 'r 5', floor=38, vel=0.5, art='soft')
        vp = b.part('c_pad', 'violas', layer='calm', role='pad', art='soft')
        pad(vp, b.bar(sec), b.chart(sec), n=2, lo=53, hi=69, vel=0.45, art='soft')
    return b.finish()
