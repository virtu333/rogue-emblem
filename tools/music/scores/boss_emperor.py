"""The Emperor — "Human, Powerful, and Wrong".

He believes he can hold what he's woken. The Empire drill grown into a
chorale for organ, choir and low brass in B-flat minor (with the Phrygian
C-flat); then the same pride turned into a pompous imperial anthem in
B-flat major. The Thread answers in the minor, and at the end it is sung
over the drill itself, now just a bass line under it.
"""

from engine.patterns import chart, pad
from engine.score import Score

from scores._battle import Battle

KEY = 'music_boss_emperor'

CHORALE = """
Bb4h Cb5q Bb4q | Ab4h Gb4h | F4h Gb4q Ab4q | Bb4w |
Db5h Eb5q Db5q | Cb5h Bb4h | Ab4h Gb4q F4q | F4w |
"""
ANTHEM = """
F4q Bb4q. C5e D5q | Eb5h D5h | C5q. Bb4e A4q C5q | Bb4h F4h |
F4q Bb4q. C5e D5q | F5h Eb5h | D5q. C5e Bb4q A4q | Bb4w |
"""
THREAD = """
F4q Bb4q C5e F5q.~ | F5h Eb5q Db5q | Eb5q. Db5e C5q Ab4q | Bb4w |
F4q Bb4q C5e F5q.~ | F5q Ab5q Gb5q F5q | Eb5q. F5e Gb5q Eb5q | F5w |
"""
DRILL_BASS = 'Bb2h. Cb3q | F2h Gb2h | Ab2w | Bb2w | Bb2h. Cb3q | Db3w | Eb3w | F2w |'
CH_A = chart('Bbm Gb Db Bbm Gb Cb:2 Bbm:2 Ab:2 F:2 F')
CH_B = chart('Bb Eb F Bb Bb Eb Gm:2 F:2 Bb')
CH_C = chart('Bbm Db/F:2 Gb:2 Ab Bbm Bbm Db Ebm F')
CH_BUILD = chart('Gb Ab Cb F7')

GRAND = {'kick': 'x.......x.......', 'rim': '........X.......', 'tom_lo': '......x.......xx'}
ANTHEM_BEAT = {'kick': 'x.....x.x.....x.', 'snare': '....x.......x...', 'hat': 'X.x.X.x.X.x.X.x.'}
FILL = {'kick': 'x.......x.......', 'snare': '........xxxxXXXX'}
PUSH = {'kick': 'x.x...x.x.x...x.', 'rim': '....X.......X...', 'ride': 'X.x.X.x.X.x.X.x.'}


def build():
    s = Score('boss_emperor', bpm=120, intro_bars=4, loop_bars=36,
              title='Human, Powerful, and Wrong', seed=103)
    s.reverb = dict(rt60=3.0, predelay_ms=32, wet_db=0.5)
    s.master = dict(lufs=-13.5, glue_ratio=1.6)
    b = Battle(s, full_lufs=-13.5, adaptive=False)
    b.section('intro', 1, chart('Bbm Bbm Cb F')).section('A', 5, CH_A).section('B', 13, CH_B)
    b.section('C', 21, CH_C).section('D', 29, CH_C).section('build', 37, CH_BUILD)

    org = b.part('organ', 'organ', role='pad')
    for sec in ('intro', 'A', 'D'):
        pad(org, b.bar(sec), b.chart(sec), n=4, lo=46, hi=72, vel=0.6, art='loud')

    # A: the chorale
    b.lead('A', CHORALE, inst='choir', name='chorale_choir', dyn='ff', role='lead')
    b.lead('A', CHORALE, inst='trombones', name='chorale_tbn', transpose=-12, dyn='ff',
           role='lead2')
    b.lead('A', CHORALE, inst='horns', name='chorale_hn', dyn='f', role='lead2')
    b.lead('A', CHORALE, inst='tuba', name='chorale_tuba', transpose=-24, dyn='f', role='low')
    b.pads('A', 'violas', n=2, lo=53, hi=67, art='trem', name='a_trem')
    b.pads('A', 'violins2', n=2, lo=62, hi=77, art='trem', name='a_trem2')
    b.low('A', 'w')

    # B: the anthem of the Empire
    b.lead('B', ANTHEM, inst='trumpets', dyn='ff')
    b.lead('B', ANTHEM, inst='horns', transpose=-12, dyn='ff', name='anthem_hn', role='lead2')
    b.lead('B', ANTHEM, inst='violins', transpose=12, dyn='f', name='anthem_vn', role='lead2')
    b.brass_pad('B', 'trombones', n=2, lo=43, hi=60, vel=0.62)
    b.spic16('B', 'violins2', pattern='0 1 2 1', lo=62, hi=81)
    b.spic8('B', 'celli', degrees='b b b b b b b b', lo=39, hi=55)
    b.low('B', 'q')

    # C: the thread answers
    b.lead('C', THREAD, inst='violins', transpose=12, dyn='ff', art='sus')
    b.lead('C', THREAD, inst='violins2', name='lead8', dyn='f', role='lead2', art='sus')
    b.spic8('C', 'celli', degrees='b b b b b b b b', lo=39, hi=55)
    b.low('C', 'q')
    b.pads('C', 'violas', n=2, lo=53, hi=67)
    b.brass_pad('C', 'horns', n=3, lo=51, hi=67, vel=0.55)

    # D: the thread over the drill
    b.lead('D', THREAD, inst='violins', transpose=12, dyn='ff')
    b.lead('D', THREAD, inst='horns', transpose=-12, dyn='ff', name='d_hn', role='lead2')
    b.lead('D', THREAD, inst='trumpets', dyn='f', name='d_tpt', role='lead2')
    b.lead('D', DRILL_BASS, inst='trombones', name='drill_tbn', dyn='ff', role='counter')
    b.lead('D', DRILL_BASS, inst='tuba', name='drill_tuba', transpose=-12, dyn='ff', role='low')
    b.lead('D', DRILL_BASS, inst='basses', name='drill_cb', transpose=-12, dyn='f', role='low')
    b.choir('D', 'choir', n=3, lo=53, hi=72, vel=0.7)
    b.spic16('D', 'violins2', pattern='0 1 2 1', lo=62, hi=81)
    b.lead('build', 'Db5q Gb5q Bb5q Db6q | Eb5q Ab5q C6q Eb6q | Eb5q Gb5q B5q Eb6q | F5q A5q C6q Eb6q |',
           inst='violins', transpose=0, dyn='ff', name='build_vn')
    b.brass_pad('build', 'horns', n=3, lo=53, hi=69, vel=0.66)

    b.groove('intro', {'tom_lo': 'x.......x...x.x.'}, crash=False)
    b.groove('A', GRAND, FILL, every=8)
    b.groove('B', ANTHEM_BEAT, FILL, every=4)
    b.groove('C', PUSH, FILL, every=4)
    b.groove('D', PUSH, FILL, every=4)
    b.groove('build', {'kick': 'x...x...x...x...', 'snare': 'x.x.x.x.xxxxxxxx'}, crash=False)
    for sec in ('B', 'C', 'build'):
        b.rbass(sec, rhythm='e e e e e e e e', notes='r r r r r r 8 r')
    b.rbass('D', text=DRILL_BASS, transpose=-12)
    for sec in ('A', 'B', 'C', 'D', 'build'):
        b.sub(sec)

    b.timp('intro', '%roll @p F2w~ | F2w | %default @f Cb3q rq Cb3q rq | F2q F2q F2q F2q |')
    b.timp('A', '@ff Bb2h rh | Gb2h rh | Db3h rh | Bb2h rh | Gb2h rh | Cb3h Bb2h | Ab2h F2h | F2q F2q F2q F2q |')
    b.timp('B', '@ff Bb2q rq F2q rq |')
    b.timp('build', '%roll @f Gb2w | Ab2w | Cb3w | F2w |')
    for bar in (5, 13, 21, 29):
        b.hit(bar, pieces=('crash', 'bd', 'gong') if bar in (5, 29) else ('crash', 'bd'))
    b.riser(35, beats=8)
    bells = b.part('bells', 'bells', role='accent')
    bells.at(5).play('@f Bb4w | rw | rw | rw | Db5w | rw | rw | rw |')
    return b.finish()
