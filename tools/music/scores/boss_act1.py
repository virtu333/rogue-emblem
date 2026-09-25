"""Act I boss — "The Border Holds".

The Iron Captain and the Warchief: the first wall. A heavy march in D minor
built from the Empire drill (D-Eb-D-C, down to B-flat), stated by the whole
low orchestra in octaves, answered by a trumpet call that pushes back with
the first four notes of the Thread. When the march turns to F minor the
horns take the harmony, and the last strain stacks both motifs on top of each
other. (No choir: Act I keeps its voices human-sized; see SCORE.md.)
"""

from engine.patterns import chart, drums
from engine.score import Score

from scores import _enrage
from scores._battle import Battle

KEY = 'music_boss_act1'

MARCH = """
D3q. Eb3e D3q C3q | Bb2h. A2q | D3q. Eb3e D3q F3q | Eb3h. D3q |
D3q. Eb3e D3q C3q | Bb2h. G2q | A2q. Bb2e A2q G2q | A2w |
"""
DEFY = """
A4q D5q E5e A5q.~ | A5h G5q F5q | E5q. D5e C#5q E5q | A4w |
A4q D5q E5e A5q.~ | A5q C6q Bb5q A5q | G5q. F5e E5q C#5q | D5w |
"""
# the defiance re-fitted over the march's own harmony, for the stacked strain
DEFY_D = """
A4q D5q E5e A5q.~ | A5q F5q D5q F5q | F5q. E5e D5q A5q | G5w |
A4q D5q E5e A5q.~ | A5q Bb5q D6q Bb5q | A5q. G5e E5q C#5q | E5w |
"""
MARCH_F = """
F3q. Gb3e F3q Eb3q | Db3h. C3q | F3q. Gb3e F3q Ab3q | Gb3h. F3q |
Db3q. Eb3e F3q Gb3q | Ab3h. Bb3q | C4q. Db4e C4q Bb3q | C4w |
"""
CH_A = chart('Dm Bb Dm Eb Dm Gm A A')
CH_B = chart('Dm F:2 C:2 A7 Dm Dm F:2 Bb:2 Gm:2 A:2 Dm')
CH_C = chart('Fm Db Fm Gb Db Ab C C')
CH_BUILD = chart('Bb C Db A')

MARCH_BEAT = {'kick': 'x.......x.......', 'snare': 'x.oox.o.x.oox.oo', 'tom_lo': '....x.......x...'}
MARCH_FILL = {'kick': 'x.......x.......', 'snare': 'x.oox.o.xxxxXXXX'}
DRIVE = {'kick': 'x.x...x.x.x...x.', 'rim': '....X.......X...', 'ride': 'X.x.X.x.X.x.X.x.'}


def build():
    s = Score('boss_act1', tonic='D', bpm=138, intro_bars=4, loop_bars=36, title='The Border Holds', seed=89)
    s.reverb = dict(rt60=2.4, predelay_ms=26, wet_db=0.0)
    s.master = dict(lufs=-13.5, glue_ratio=1.6)
    b = Battle(s, full_lufs=-13.5, adaptive=False)
    b.section('intro', 1, chart('Dm Dm Bb A')).section('A', 5, CH_A).section('B', 13, CH_B)
    b.section('C', 21, CH_C).section('D', 29, CH_A).section('build', 37, CH_BUILD)

    for sec, text in (('A', MARCH), ('D', MARCH)):
        b.lead(sec, text, inst='trombones', name='march_tbn', dyn='ff')
        b.lead(sec, text, inst='tuba', name='march_tuba', transpose=-12, dyn='ff', role='low')
        b.lead(sec, text, inst='celli', name='march_vc', dyn='f', role='lead2', art='sus')
        b.lead(sec, text, inst='basses', name='march_cb', transpose=-12, dyn='f', role='low',
               art='sus')
        b.rbass(sec, text=text, transpose=-12)
        b.lead(sec, text, inst='horns', name='march_hn', transpose=12, dyn='ff', role='lead')
    b.lead('C', MARCH_F, inst='trombones', name='march_tbn', dyn='ff')
    b.lead('C', MARCH_F, inst='celli', name='march_vc', dyn='f', role='lead2', art='sus')
    b.lead('C', MARCH_F, inst='horns', name='march_hn', transpose=12, dyn='ff')
    b.rbass('C', text=MARCH_F, transpose=-12)
    b.lead('B', DEFY, inst='trumpets', transpose=-12, dyn='ff')
    b.lead('B', DEFY, inst='violins', dyn='ff', art='sus')
    b.lead('D', DEFY_D, inst='violins', dyn='ff')
    b.lead('D', DEFY_D, inst='trumpets', transpose=-12, dyn='ff')
    b.lead('build', 'D5q F5q Bb5q D6q | E5q G5q C6q E6q | F5q Ab5q Db6q F6q | E5q A5q C#6q E6q |',
           inst='violins', dyn='ff')

    b.spic16('A', 'violins2', pattern='0 1 2 1', lo=62, hi=81)
    b.spic16('C', 'violins2', pattern='0 1 2 1', lo=60, hi=80)
    b.spic8('B', 'celli', degrees='b b b b b b b b', lo=38, hi=55, name='b_vc')
    b.low('B', 'q')
    b.pads('B', 'violas', n=2, lo=53, hi=69)
    b.spic16('D', 'violins2', pattern='0 1 2 1', lo=62, hi=81)
    b.spic16('build', 'violins2', pattern='0 1 2 3', lo=60, hi=84)
    b.brass_pad('B', 'horns', n=3, lo=53, hi=69, vel=0.6, name='b_hn')
    b.brass_pad('C', 'horns', n=3, lo=55, hi=70, vel=0.6, name='c_hn')
    b.brass_pad('D', 'horns', n=3, lo=55, hi=70, vel=0.64, name='c_hn')
    b.brass_pad('build', 'horns', n=3, lo=53, hi=69, vel=0.66, name='b_hn')

    b.groove('intro', {'snare': 'x.oox.oox.oox.oo', 'kick': 'x.......x.......'}, crash=False)
    b.groove('A', MARCH_BEAT, MARCH_FILL, every=4)
    b.groove('B', DRIVE, MARCH_FILL, every=4)
    b.groove('C', MARCH_BEAT, MARCH_FILL, every=4)
    b.groove('D', DRIVE, MARCH_FILL, every=4)
    b.groove('build', {'kick': 'x...x...x...x...', 'snare': 'x.x.x.x.xxxxxxxx'}, crash=False)
    b.rbass('B', rhythm='e e e e e e e e', notes='r r r r r r 8 r')
    b.rbass('build', rhythm='e e e e e e e e', notes='r r r r r r r r')
    for sec in ('A', 'B', 'D', 'build'):
        b.sub(sec)

    b.timp('intro', '@f D2q rq D2q rq | D2q rq D2e D2e D2q | Bb2q rq Bb2q rq | A2q A2q A2q A2q |')
    b.timp('A', '@ff D2q rq D2q rq | Bb2q rq rh | D2q rq D2q rq | Eb2q rq rh |'
              ' D2q rq D2q rq | G2q rq rh | A2q A2q A2q A2q | A2q rq rh |')
    b.timp('C', '@ff F2q rq F2q rq | Db3q rq rh | F2q rq F2q rq | Gb2q rq rh |'
              ' Db3q rq Db3q rq | Ab2q rq rh | C3q C3q C3q C3q | C3q rq rh |')
    b.timp('build', '%roll @f Bb2w | C3w | Db3w | A2w |')
    for bar in (5, 13, 21, 29):
        b.hit(bar)
    b.riser(35, beats=8)
    anvil = b.part('anvil', 'orch_perc', role='accent')
    for bar in range(5, 13):
        drums(anvil, bar, {'anvil': '........x.......'}, vel=0.55)
    # enrage layers: one boss-specific behaviour each (scores/_enrage.py)
    loop = [b.sections[k] for k in ['A', 'B', 'C', 'D', 'build']]
    _enrage.iron_captain(b, loop)
    _enrage.warchief(b, loop)
    return b.finish()
