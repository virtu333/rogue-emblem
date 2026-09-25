"""The Lieutenant — "Every Future You Could Reach".

A seer like Sera, whose power fractures the timeline. Her motif is the
Thread's rhythm falling instead of rising (A-D-C-A) and every statement is shadowed
a beat later a tritone away: two futures at once. Octatonic sixteenths run
under it like clockwork that has lost count.

Then the one path she could not block: the main battle theme returns in the
violins and trumpets, the player's own melody, with the Lieutenant's motif
grinding against it in the low brass. The last strain rises a step to E
minor and the choir sings the Thread over everything.
"""

from engine.patterns import chart, ostinato
from engine.score import Score

from scores._battle import Battle
from scores.battle_act1 import MEL_A

KEY = 'music_boss_lieutenant'

LIEUT = """
A5q D5q C5q A4q | Bb4h. Ab4q | G4q C5q Bb4q G4q | A4w |
A5q D5q C5q A4q | Eb5h. D5q | C#5q E5q G5q Bb5q | A5w |
"""
SHADOW = """
rq Eb5q Ab4q Gb4q | Eb4w | rw | rw |
rq Eb5q Ab4q Gb4q | A4w | rw | rw |
"""
LIEUT_LOW = 'A3q D3q C3q A2q | Bb2w | C3w | A2w | A3q D3q C3q A2q | F2w | G2h A2h | D3w |'
OCTA = 'D5s Eb5s F5s F#5s G#5s A5s B5s C6s D6s C6s B5s A5s G#5s F#5s F5s Eb5s |'
AUG = 'A4h D4h | C4h A3h | Bb3w | Ab3w | A4h D4h | Eb4h D4h | C#4w | A3w |'

CH_A = chart('Dm Bbm/Db Gm A Dm Ab/Eb A7:2 Gm:2 A')
CH_B = chart('Dm F Bb Ab Dm Cm:2 Bb:2 A A7')
CH_C = chart('Dm Bbmaj7 C A Dm F Gm:2 A7:2 Dm')
CH_D = chart('Em Cmaj7 D B Em G Am:2 B7:2 Em')
CH_BUILD = chart('C D Eb A7')

FRACTURE = {'kick': 'x..x..x...x..x..', 'rim': '....x.......x...', 'hat': 'x.xxx.xxx.xxx.xx'}
DRIVE = {'kick': 'x.x...x.x.x...x.', 'rim': '....X.......X...', 'ride': 'X.x.X.x.X.x.X.x.'}
FILL = {'kick': 'x.x...x.x.......', 'snare': '........xxxxXXXX', 'tom_hi': '....xx..'}
HALF = {'kick': 'x.........x.....', 'rim': '........X.......', 'ride': 'x.x.x.x.x.x.x.x.'}


def build():
    s = Score('boss_lieutenant', tonic='D', bpm=168, intro_bars=4, loop_bars=44,
              title='Every Future You Could Reach', seed=107)
    s.reverb = dict(rt60=2.4, predelay_ms=26, wet_db=0.0)
    s.master = dict(lufs=-13.2, glue_ratio=1.6)
    b = Battle(s, full_lufs=-13.2, adaptive=False)
    b.section('intro', 1, chart('Dm Dm Ab A')).section('A', 5, CH_A).section('B', 13, CH_B)
    b.section('A2', 21, CH_A).section('C', 29, CH_C).section('D', 37, CH_D)
    b.section('build', 45, CH_BUILD)

    # intro: the clock that lost count (pizzicato in canon)
    clock = b.part('clock', 'violins2', role='ostinato', art='pizz')
    echo = b.part('clock_echo', 'violas', role='ostinato', art='pizz', pan=0.5)
    for bar in range(1, 5):
        clock.at(bar).play('@f A5e D5e A5e D5e A5e D5e A5e D5e |')
        # the same clock a dotted eighth late and a tritone away
        echo.at_beat(s.bar(bar) + 0.75).play('@mf Eb5e Ab4e Eb5e Ab4e Eb5e Ab4e r:0.25')

    # A / A2: the Lieutenant and her shadow
    for sec in ('A', 'A2'):
        b.lead(sec, LIEUT, inst='violins', dyn='ff', art='sus')
        b.lead(sec, LIEUT, inst='violins2', name='lead8', transpose=-12, dyn='f', role='lead2',
               art='sus')
        b.lead(sec, SHADOW, inst='horns', name='shadow_hn', transpose=-12, dyn='f', role='counter')
        b.lead(sec, SHADOW, inst='violas', name='shadow_va', dyn='mf', role='counter', art='sus')
    b.lead('A2', LIEUT, inst='trumpets', transpose=-12, dyn='ff')
    b.choir('A2', 'choir', n=3, lo=53, hi=72, vel=0.66)

    # B: clockwork octatonic runs, the motif augmented in the brass
    osc = b.part('octa', 'violins2', role='ostinato', art='spic')
    osc.at(b.bar('B')).play('@f' + OCTA * 8)
    b.lead('B', AUG, inst='horns', name='aug_hn', dyn='ff', role='lead')
    b.lead('B', AUG, inst='trombones', name='aug_tbn', transpose=-12, dyn='ff', role='lead2')
    b.choir('B', 'oohs', n=3, lo=53, hi=70, vel=0.6)

    # C: the one path she couldn't block (the player's battle theme)
    b.lead('C', MEL_A, inst='violins', dyn='ff')
    b.lead('C', MEL_A, inst='trumpets', transpose=-12, dyn='ff', name='c_tpt')
    b.lead('C', LIEUT_LOW, inst='trombones', name='grind', dyn='ff', role='counter')
    b.lead('C', LIEUT_LOW, inst='tuba', name='grind_tuba', transpose=-12, dyn='f', role='low')
    b.spic16('C', 'violins2', pattern='0 1 2 1', lo=62, hi=81)

    # D: up a step, the choir sings the thread
    b.lead('D', MEL_A, inst='violins', transpose=2, dyn='ff')
    b.lead('D', MEL_A, inst='choir', name='thread_choir', transpose=-10, dyn='ff', role='lead2')
    b.lead('D', MEL_A, inst='horns', name='d_hn', transpose=-22, dyn='ff', role='lead2')
    b.lead('D', MEL_A, inst='trumpets', transpose=-10, dyn='ff', name='d_tpt')
    b.spic16('D', 'violins2', pattern='0 1 2 1', lo=64, hi=83)
    b.lead('build', 'C5q E5q G5q C6q | D5q F#5q A5q D6q | Eb5q G5q Bb5q Eb6q | C#5q E5q G5q A5q |',
           inst='violins', dyn='ff', name='build_vn')

    for sec in ('A', 'A2', 'C', 'D', 'build'):
        b.spic8(sec, 'celli', degrees='b b b b b b b b', lo=38, hi=55)
        b.low(sec, 'q')
    b.low('B', 'w')
    b.pads('A', 'violas', n=2, lo=50, hi=65, art='trem', name='trem_va')
    b.brass_pad('C', 'horns', n=3, lo=52, hi=67, vel=0.58)
    b.choir('C', 'choir', n=3, lo=55, hi=72, vel=0.62)
    b.brass_pad('build', 'horns', n=3, lo=53, hi=69, vel=0.66, name='build_hn')

    b.groove('intro', {'kick': 'x..x..x.x..x..x.'}, crash=False)
    b.groove('A', FRACTURE, FILL, every=4)
    b.groove('B', HALF, FILL, every=8)
    b.groove('A2', FRACTURE, FILL, every=4)
    b.groove('C', DRIVE, FILL, every=4)
    b.groove('D', DRIVE, FILL, every=4)
    b.groove('build', {'kick': 'x...x...x...x...', 'snare': 'x.x.x.x.xxxxxxxx'}, crash=False)
    for sec in ('A', 'A2', 'C', 'D', 'build'):
        b.rbass(sec, rhythm='e e e e e e e e', notes='r r r r r r 8 r')
        b.sub(sec)
    b.rbass('B', rhythm='q. q. q', notes='r r 8', accents='> > -')

    b.timp('intro', '@f D2q rq D2q rq | D2q rq D2e D2e D2q | Ab2q rq Ab2q rq | A2q A2q A2q A2q |')
    for sec, t in (('A', '@ff D2q rq rh |'), ('A2', '@ff D2q rq rh |'), ('C', '@ff D2q rq rh |'),
                   ('D', '@ff E2q rq rh |')):
        b.timp(sec, t)
    b.timp('B', '@f D2q rq D2q rq | F2q rq F2q rq | Bb2q rq Bb2q rq | Ab2q rq Ab2q rq |'
              ' D2q rq D2q rq | C3q rq Bb2q rq | A2q rq A2q rq | A2q A2q A2q A2q |')
    b.timp('build', '%roll @f C3w | D3w | Eb2w | A2w |')
    for bar in (5, 13, 21, 29, 37):
        b.hit(bar)
    b.riser(35, beats=8)
    b.riser(47, beats=8)
    glock = b.part('glass', 'glock', role='accent')
    for bar in (5, 7, 21, 23):
        glock.at(bar).play('@mf A6q D6q C6q A5q | rq Eb6q Ab5q Gb5q |')
    return b.finish()
