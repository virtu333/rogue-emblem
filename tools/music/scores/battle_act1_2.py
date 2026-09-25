"""Act I battle II — "Border Marches".

Cavalry country: a 6/8 gallop in G minor. The Thread motif leads the charge
(D-G-A-D), strings gallop in dotted figures, and the B strain hands the tune
to Edric's oath in B-flat. The C strain is the Iron Captain's line: the
Empire drill hammered against the gallop in low brass.
"""

from engine.score import Score

from scores._battle import Battle
from engine.patterns import chart, drums

KEY = 'music_battle_act1_2'

MEL_A = """
D5q. G5e A5e D6e~ | D6q. C6e Bb5e A5e | Bb5q G5e A5q F5e | G5q. D5q. |
D5q. G5e A5e D6e~ | D6q. F6e Eb6e D6e | C6q A5e Bb5q G5e | A5q. D5q. |
"""
MEL_A_BR = """
D5q. G5e A5e D6e~ | D6q. C6e Bb5e A5e | Bb5q G5e A5q F5e | G5q. rq. |
D5q. G5e A5e D6e~ | D6q. F6e Eb6e D6e | C6q A5e Bb5q G5e | A5q. rq. |
"""
OATH = """
Bb4q. F5q. | Eb5e F5e Eb5e C5q. | D5q. Bb4q. | C5q. A4q. |
Bb4q. F5q. | A5q. G5e F5e Eb5e | D5q. Eb5q. | F5q. D5q. |
"""
DRILL = """
G3q. Ab3e G3e F3e | Eb3q. rq. | G3q. Ab3e G3e F3e | Eb3q. D3q. |
C3q. Db3e C3e Bb2e | Ab2q. rq. | Bb2q. B2q. | D3q. D3q. |
"""

CH_A = chart('Gm:3 Bb:3 Cm7:1.5 F:1.5 Dsus4:1.5 D:1.5 Gm:3 Bb:3 F:1.5 Gm:1.5 D:3')
CH_B = chart('Bb:3 Cm:3 Bb/D:3 F:3 Bb:3 F/A:3 Bb/D:1.5 F7:1.5 Bb:3')
CH_C = chart('Gm:3 Eb:3 Gm:3 Eb:1.5 D:1.5 Fm:3 Db:3 Eb:1.5 G7:1.5 D:3')
CH_A3 = chart('Am:3 C:3 Dm7:1.5 G:1.5 Esus4:1.5 E:1.5 Am:3 C:3 G:1.5 Am:1.5 E:3')
CH_BUILD = chart('F:3 G:3 Eb:3 D:3')

GALLOP = {'kick': 'x..x..', 'snare': '...x..', 'hat': 'xxxxxx'}
GALLOP_FILL = {'kick': 'x..x..', 'snare': '...xxx', 'tom_hi': '....x.'}
HALF68 = {'kick': 'x.....', 'rim': '...x..', 'ride': 'x.xx.x'}
DRILL68 = {'kick': 'x.xx.x', 'snare': '...x..', 'tom_lo': 'x.....'}


def build():
    s = Score('battle_act1_2', tonic='G', bpm=150, meter=(6, 8), intro_bars=2, loop_bars=52,
              title='Border Marches', seed=61)
    s.reverb = dict(rt60=2.0, predelay_ms=24, wet_db=-1.0)
    s.master = dict(lufs=-14.0, glue_ratio=1.5)
    b = Battle(s, calm_lufs=-17.0, full_lufs=-14.0)
    b.section('intro', 1, chart('Gm:3 D:3'))
    b.section('A1', 3, CH_A).section('A2', 11, CH_A).section('B', 19, CH_B)
    b.section('C', 27, CH_C).section('B2', 35, CH_B).section('A3', 43, CH_A3)
    b.section('build', 51, CH_BUILD)

    # ---------------------------------------------------------------- tune
    b.lead('A1', MEL_A, inst='violins', dyn='f', art='sus')
    b.lead('A1', MEL_A, inst='violins2', name='lead8', transpose=-12, dyn='mf', role='lead2',
           art='sus')
    b.lead('A2', MEL_A_BR, inst='horns', transpose=-12, dyn='f', layer='full')
    b.lead('A2', MEL_A, inst='violins', dyn='f')
    b.lead('B', OATH, inst='horns', transpose=-12, dyn='f', layer='full')
    b.lead('B', OATH, inst='violins', dyn='mf')
    b.lead('C', DRILL, inst='trombones', name='drill', dyn='ff', layer='full')
    b.lead('C', DRILL, inst='celli', name='drill_vc', dyn='f', role='lead2', calm_db=-4)
    b.lead('B2', OATH, inst='violins', transpose=12, dyn='ff')
    b.lead('B2', OATH, inst='trumpets', dyn='f', layer='full', role='lead2')
    b.lead('A3', MEL_A, inst='violins', transpose=2, dyn='ff')
    b.lead('A3', MEL_A_BR, inst='trumpets', transpose=-10, dyn='ff', layer='full',
           name='lead_tpt_a3')
    b.lead('A3', MEL_A_BR, inst='horns', transpose=-22, dyn='ff', layer='full')
    b.lead('build', 'A4q. C5q. | B4q. D5q. | Bb4q. Eb5q. | A4q. F#5q. |', inst='violins',
           dyn='f')

    # calm voices
    b.lead('A1', MEL_A, inst='flute', dyn='mf', layer='calm')
    b.lead('A2', MEL_A_BR, inst='oboe', dyn='mf', layer='calm')
    b.lead('B', OATH, inst='clarinet', dyn='mf', layer='calm')
    b.lead('C', DRILL, inst='bassoon', dyn='mf', layer='calm', transpose=12)
    b.lead('B2', OATH, inst='flute', transpose=12, dyn='mf', layer='calm', name='lead_flute')
    b.lead('A3', MEL_A, inst='solo_violin', transpose=2, dyn='f', layer='calm')

    # ---------------------------------------------------------------- strings
    gallop = 'b b b b b b'
    for sec in ('A1', 'A2', 'B2', 'A3', 'build'):
        b.spic8(sec, 'celli', degrees=gallop, accents='> - - > - -', lo=38, hi=55, calm_db=-6)
    for sec in ('A2', 'C', 'A3'):
        b.spic16(sec, 'violins2', pattern='0 1 2 1 2 1', lo=62, hi=81, calm_db=None)
    for sec in ('B', 'B2', 'build'):
        b.pads(sec, 'violas', n=2, lo=53, hi=67, art='sus')
    for sec in ('A1', 'A2', 'C', 'A3'):
        b.spic8(sec, 'violas', degrees='0 1 2 0 1 2', lo=50, hi=67, vel=0.58, accents=None)
    for sec in ('A1', 'A2', 'C', 'A3'):
        b.low(sec, 'q')
    for sec in ('B', 'B2', 'build'):
        b.low(sec, 'w')

    # ---------------------------------------------------------------- brass, choir
    for sec in ('A1', 'B'):
        b.brass_pad(sec, 'horns', n=3, lo=50, hi=65, vel=0.5)
    b.stabs('A2', rhythm='q. q.', lo=60, hi=74)
    b.brass_pad('B2', 'trombones', n=2, lo=43, hi=60, vel=0.6)
    # no choir in Act I: the horns carry the harmony (headroom for later acts)
    b.brass_pad('B2', 'horns', n=3, lo=53, hi=69, vel=0.58, name='b2_hn')
    b.brass_pad('A3', 'horns', n=3, lo=53, hi=69, vel=0.6, name='b2_hn')

    # ---------------------------------------------------------------- rhythm section
    b.groove('intro', {'kick': 'x..x..', 'tom_lo': 'x.xx.x'}, crash=False)
    b.groove('A1', GALLOP, GALLOP_FILL, every=4)
    b.groove('A2', GALLOP, GALLOP_FILL, every=4)
    b.groove('B', HALF68, GALLOP_FILL, every=8)
    b.groove('C', DRILL68, GALLOP_FILL, every=4)
    b.groove('B2', GALLOP, GALLOP_FILL, every=4)
    b.groove('A3', GALLOP, GALLOP_FILL, every=4)
    b.groove('build', {'kick': 'x..x..', 'snare': 'xxxxxx'}, crash=False, vel=0.7)
    for sec in ('A1', 'A2', 'A3', 'build', 'B2'):
        b.rbass(sec, rhythm='e e e e e e', notes='r r r r r 8', accents='> - - > - -')
    b.rbass('B', rhythm='q. q.', notes='r 5', accents=None)
    b.rbass('C', text=DRILL, transpose=-12)
    for sec in ('A1', 'A2', 'B', 'B2', 'A3', 'build'):
        b.sub(sec)

    b.timp('intro', '@f G2q. D2q. | G2q. D2e D2e D2e |')
    for sec in ('A1', 'A2', 'B2'):
        b.timp(sec, '@f G2q. rq. |')
    b.timp('C', '@f G2e G2e G2e D2q. | Eb2e Eb2e Eb2e rq. | G2e G2e G2e D2q. | Eb2q. D2q. |'
              ' F2e F2e F2e rq. | Db3q. rq. | Eb2q. G2q. | D2q. D2q. |')
    b.timp('A3', '@ff A2q. rq. |')
    b.timp('build', '%roll @mf F2q.~ F2q. | G2q.~ G2q. | Eb2q.~ Eb2q. | D2q.~ D2q. |')
    for bar in (3, 11, 19, 27, 35, 43):
        b.hit(bar)
    b.riser(41, beats=6)
    b.riser(49, beats=6)

    for sec in ('A1', 'A2', 'B', 'C', 'B2', 'A3'):
        b.calm_bed(sec, piano='0 2 4', piano_step=1.0)
    return b.finish()
