"""Act III boss — "The Perfect Duel".

The Blade Lord, the Iron Wall, the Berserker King: the Lieutenant's own
champions. E minor at a sprint. The violins fence in sixteenth-note runs and
the brass answer blade for blade; then, for eight bars, the Lieutenant's
sign appears for the first time: the Thread's rhythm falling instead of
rising, shadowed a tritone away, E minor against B-flat, a future split in two.
"""

from engine.patterns import chart
from engine.score import Score

from scores._battle import Battle

KEY = 'music_boss_act3'

BLADE = """
E5s F#5s G5s A5s B5q B5e A5e G5e F#5e | E5q G5e C6e B5q G5q |
F#5s G5s A5s B5s C6q A5e F#5e D5q | D#5h. F#5q |
E5s F#5s G5s A5s B5q E6q D6e B5e | C6q. B5e A5q E5q |
A5e G5e F#5e E5e D#5q F#5q | E5w |
"""
LIEUT = 'B5q E5q D5q B4q | rw | B5q E5q D5q B4q | rw | B5q E5q D5q B4q | G5q C5q B4q G4q | E5w | D#5w |'
SHADOW = 'rq F5q Bb4q Ab4q | F4w | rq F5q Bb4q Ab4q | F4w | rq F5q Bb4q Ab4q | rw | rw | rw |'
CH_A = chart('Em C D B Em Am B7 Em')
CH_B = chart('Em Bb Em Bb Em C Em B')
CH_BUILD = chart('C D C B7')

DUEL = {'kick': 'x.x...x.x.x...x.', 'rim': '....X.......X...', 'hat': 'XxXxXxXxXxXxXxXx'}
DUEL2 = {'kick': 'x.x.x.x.x.x.x.x.', 'rim': '....X.......X...', 'ride': 'X.x.X.x.X.x.X.x.'}
FILL = {'kick': 'x.x...x.x.......', 'snare': '........xxxxXXXX', 'tom_hi': '....xx..'}
SPLIT = {'kick': 'x.......x.......', 'tom_lo': '...x...x...x..xx', 'rim': '........X.......'}


def build():
    s = Score('boss_act3', tonic='E', bpm=172, intro_bars=4, loop_bars=36, title='The Perfect Duel',
              seed=101)
    s.reverb = dict(rt60=2.0, predelay_ms=22, wet_db=-1.0)
    s.master = dict(lufs=-13.5, glue_ratio=1.6)
    b = Battle(s, full_lufs=-13.5, adaptive=False)
    b.section('intro', 1, chart('Em Em C B')).section('A', 5, CH_A).section('A2', 13, CH_A)
    b.section('B', 21, CH_B).section('A3', 29, CH_A).section('build', 37, CH_BUILD)

    b.lead('A', BLADE, inst='violins', dyn='ff', art='sus')
    b.lead('A', BLADE, inst='violins2', name='lead8', transpose=-12, dyn='f', role='lead2',
           art='sus')
    b.lead('A2', BLADE, inst='trumpets', transpose=-12, dyn='ff')
    b.lead('A2', BLADE, inst='horns', transpose=-24, dyn='ff', name='a2_hn', role='lead2')
    b.spic16('A2', 'violins', pattern='0 1 2 3 2 1 2 1', lo=64, hi=88, name='a2_vn')
    b.lead('B', LIEUT, inst='violins', name='lieut', dyn='ff', art='sus')
    b.lead('B', SHADOW, inst='horns', name='shadow', dyn='f', role='counter')
    b.lead('B', SHADOW, inst='violins2', name='shadow_vn', transpose=12, dyn='mf', role='counter')
    b.lead('A3', BLADE, inst='violins', dyn='ff')
    b.lead('A3', BLADE, inst='violins2', name='lead8', transpose=-12, dyn='ff', role='lead2')
    b.lead('A3', BLADE, inst='trumpets', transpose=-12, dyn='ff')
    b.lead('build', 'E5e G5e C6e E6e E5e G5e C6e E6e | F#5e A5e D6e F#6e F#5e A5e D6e F#6e |'
           ' E5e G5e C6e E6e E5e G5e C6e E6e | D#5e F#5e A5e B5e D#6e F#6e A6e B6e |',
           inst='violins', name='build_vn', dyn='ff')

    for sec in ('intro', 'A', 'A2', 'A3', 'build'):
        b.spic8(sec, 'celli', degrees='b b b b b b b b', lo=40, hi=57)
        b.low(sec, 'q')
    for sec in ('A', 'A3'):
        b.spic8(sec, 'violas', degrees='0 1 2 1 0 1 2 1', lo=52, hi=69, vel=0.6, accents=None)
    b.pads('B', 'violas', n=2, lo=52, hi=67, art='trem')
    b.low('B', 'w')

    b.brass_pad('A', 'horns', n=3, lo=52, hi=67, vel=0.55)
    b.stabs('A3', rhythm='q. q. q', lo=62, hi=76)
    b.choir('B', 'choir', n=3, lo=52, hi=71, vel=0.62)
    b.choir('A3', 'choir', n=3, lo=55, hi=74, vel=0.66)
    b.brass_pad('B', 'trombones', n=2, lo=40, hi=56, vel=0.58)
    b.brass_pad('build', 'horns', n=3, lo=53, hi=69, vel=0.66)

    b.groove('intro', {'kick': 'x.x.x.x.x.x.x.x.', 'snare': '....x.......x...'}, crash=False)
    b.groove('A', DUEL, FILL, every=4)
    b.groove('A2', DUEL2, FILL, every=4)
    b.groove('B', SPLIT, None)
    b.groove('A3', DUEL2, FILL, every=4)
    b.groove('build', {'kick': 'x...x...x...x...', 'snare': 'x.x.x.x.xxxxxxxx'}, crash=False)
    for sec in ('intro', 'A', 'A2', 'A3', 'build'):
        b.rbass(sec, rhythm='e e e e e e e e', notes='r r r r r r 8 r')
        b.sub(sec)
    b.rbass('B', rhythm='w', notes='r', accents=None)

    b.timp('intro', '@f E2e E2e E2q E2e E2e E2q | E2e E2e E2q E2e E2e E2q | C3q rq C3q rq | B2q B2q B2q B2q |')
    for sec, t in (('A', '@ff E2q rq rh |'), ('A2', '@ff E2q rq rh |'), ('A3', '@ff E2q rq rh |')):
        b.timp(sec, t)
    b.timp('B', '@f E2q rq rh | Bb2q rq rh | E2q rq rh | Bb2q rq rh |')
    b.timp('build', '%roll @f C3w | D3w | C3w | B2w |')
    for bar in (5, 13, 21, 29):
        b.hit(bar)
    b.riser(35, beats=8)
    return b.finish()
