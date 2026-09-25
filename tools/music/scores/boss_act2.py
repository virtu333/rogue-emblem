"""Act II boss — "Doctrine of Lances".

The Knight Commander, the Archmage, the Dark Rider: the Empire's officers.
F minor at a charge, everything cut 3+3+2 like couched lances. The brass
doctrine marches in dotted quarters; the violins answer with the Thread in
A-flat major; the C strain belongs to the black rider (a chromatic crawl in
the celli under choir) before the doctrine returns with everything behind it.
"""

from engine.patterns import chart, ostinato
from engine.score import Score

from scores._battle import Battle

KEY = 'music_boss_act2'

DOCTRINE = """
C4q. F4q. Ab4q | G4q. Eb4q. Bb3q | Ab4q. F4q. Db4q | E4q. G4q. C5q |
C5q. Ab4q. F4q | F4q. Ab4q. Db5q | Bb4q. Db5q. C5q | C5w |
"""
THREAD = """
Eb5q Ab5q Bb5e Eb6q.~ | Eb6h Db6q C6q | Bb5q. Ab5e G5q Eb5q | Ab5w |
Eb5q Ab5q Bb5e Eb6q.~ | Eb6q F6q Eb6q Db6q | C6q. Bb5e Ab5q G5q | Ab5w |
"""
RIDER = ('F3e Gb3e F3e E3e F3e Gb3e Ab3e G3e | Gb3e G3e Gb3e F3e Gb3e G3e A3e Ab3e |' * 2
         + ' Db3e Eb3e Db3e C3e Db3e Eb3e F3e E3e | Eb3e F3e Eb3e D3e Eb3e F3e G3e Gb3e |'
         + ' C3e Db3e C3e B2e C3e Db3e Eb3e D3e | C3e Db3e C3e B2e C3e E3e G3e C4e |')
CH_A = chart('Fm Eb Db C Fm Db Bbm:3 C:1 C')
CH_B = chart('Ab Db Eb Ab Ab Db Eb Ab')
CH_C = chart('Fm Gb Fm Gb Db Eb C C')
CH_BUILD = chart('Db Eb E C7')

LANCE = {'kick': 'x..x..x.x..x..x.', 'rim': '....x.......x...', 'hat': 'x..x..x.x..x..x.'}
LANCE2 = {'kick': 'x..x..x.x..x..x.', 'rim': '....X.......X...', 'ride': 'X..X..X.X..X..X.'}
FILL = {'kick': 'x..x..x.x.......', 'snare': '........xxxxXXXX'}
RIDE = {'kick': 'x.......x.......', 'tom_lo': 'x..x..x.x..x..x.', 'rim': '....x.......x...'}


def build():
    s = Score('boss_act2', tonic='F', bpm=166, intro_bars=4, loop_bars=36, title='Doctrine of Lances',
              seed=97)
    s.reverb = dict(rt60=2.2, predelay_ms=24, wet_db=-0.5)
    s.master = dict(lufs=-13.5, glue_ratio=1.6)
    b = Battle(s, full_lufs=-13.5, adaptive=False)
    b.section('intro', 1, chart('Fm Fm Db C')).section('A', 5, CH_A).section('B', 13, CH_B)
    b.section('C', 21, CH_C).section('D', 29, CH_A).section('build', 37, CH_BUILD)

    for sec in ('A', 'D'):
        b.lead(sec, DOCTRINE, inst='horns', dyn='ff')
        b.lead(sec, DOCTRINE, inst='trombones', name='doc_tbn', transpose=-12, dyn='ff',
               role='lead2')
        b.lead(sec, DOCTRINE, inst='trumpets', name='doc_tpt', dyn='f',
               role='lead2')
    b.lead('D', DOCTRINE, inst='violins', transpose=12, dyn='ff')
    b.lead('B', THREAD, inst='violins', dyn='ff', art='sus')
    b.lead('B', THREAD, inst='violins2', name='lead8', transpose=-12, dyn='f', role='lead2',
           art='sus')
    b.lead('C', RIDER, inst='celli', name='rider_vc', dyn='f', role='lead', art='spic')
    b.lead('C', RIDER, inst='basses', name='rider_cb', transpose=-12, dyn='f', role='low',
           art='spic')
    b.rbass('C', text=RIDER, transpose=-12)
    b.lead('build', 'Ab5q Db6q F6q Ab6q | Bb5q Eb6q G6q Bb6q | B5q E6q G#6q B6q | Bb5q C6q E6q G6q |',
           inst='violins', dyn='ff')

    stab = b.part('lances', 'violins2', role='ostinato', art='spic')
    for sec in ('intro', 'A', 'D'):
        ostinato(stab, b.bar(sec), b.chart(sec), 'e e e e e e e e', '0 - - 1 - - 2 -',
                 lo=60, hi=79, vel=0.7)
    for sec in ('A', 'B', 'D', 'build'):
        b.spic8(sec, 'celli', degrees='b - - b - - b b', lo=41, hi=57, accents=None)
        b.low(sec, 'q')
    b.spic16('B', 'violas', pattern='0 1 2 1', lo=53, hi=69, name='b_va')
    b.pads('C', 'violins2', n=2, lo=62, hi=78, art='trem', name='c_trem')
    b.pads('C', 'violas', n=2, lo=53, hi=67, art='trem')

    b.brass_pad('B', 'horns', n=3, lo=51, hi=68, vel=0.6, name='b_hn')
    b.brass_pad('B', 'trombones', n=2, lo=44, hi=60, vel=0.55, name='b_tbn')
    b.choir('C', 'choir', n=3, lo=53, hi=72, vel=0.66)
    b.choir('D', 'choir', n=3, lo=55, hi=74, vel=0.66)
    b.brass_pad('build', 'horns', n=3, lo=53, hi=69, vel=0.66, name='b_hn')

    b.groove('intro', {'kick': 'x..x..x.x..x..x.', 'tom_lo': 'x..x..x.x..x..x.'}, crash=False)
    b.groove('A', LANCE, FILL, every=4)
    b.groove('B', LANCE2, FILL, every=4)
    b.groove('C', RIDE, None, crash=True)
    b.groove('D', LANCE2, FILL, every=4)
    b.groove('build', {'kick': 'x...x...x...x...', 'snare': 'x.x.x.x.xxxxxxxx'}, crash=False)
    for sec in ('intro', 'A', 'B', 'D', 'build'):
        b.rbass(sec, rhythm='q. q. q', notes='r r 8', accents='> > -')
        b.sub(sec)

    b.timp('intro', '@f F2q. F2q. F2q | F2q. F2q. F2q | Db3q. Db3q. Db3q | C3q C3q C3q C3q |')
    for sec, t in (('A', '@ff F2q. rq. rq |'), ('B', '@ff Ab2q. rq. rq |'),
                   ('D', '@ff F2q. rq. rq |')):
        b.timp(sec, t)
    b.timp('build', '%roll @f Db3w | Eb2w | E2w | C3w |')
    for bar in (5, 13, 21, 29):
        b.hit(bar)
    b.riser(35, beats=8)
    return b.finish()
