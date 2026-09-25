"""Act III battle — "Bleached Rite".

The sacred ground, fought over. A limping 7/8 (2+2+3) that never lets the
feet settle; organ and choir instead of warmth. The Thread motif is sung in
E minor with a raised fourth on its descent (A-sharp: a light too bright to
be kind), the B strain blazes in E major like the rite itself, and the
breakdown chants on E and the Phrygian F while something underneath stirs.
"""

from engine.patterns import chart, pad
from engine.score import Score

from scores._battle import Battle

KEY = 'music_battle_act3'

MEL_A = """
B4q E5q F#5q. | B5h F5q. | E5q D5q E5q. | B4h. re |
B4q E5q F#5q. | B5q C6q D6q. | C6q B5q A#5q. | B5h. re |
"""
MEL_B = """
E5q G#5q B5q. | C#6h B5q. | A5q G#5q F#5q. | E5h. re |
E5q G#5q B5q. | D6h C#6q. | B5q A#5q F#5q. | B5h. re |
"""
CH_A = chart('Em:3.5 G:2 F:1.5 Em:3.5 Em:3.5 Em:3.5 C:3.5 Am:2 F#:1.5 B:3.5')
CH_B = chart('E:3.5 A:3.5 F#m:3.5 E:3.5 E:3.5 D:2 A:1.5 B:3.5 B:3.5')
CH_C = chart('Em:3.5 F:3.5 Em:3.5 F:3.5 Dm:3.5 F:3.5 Em:3.5 B:3.5')
CH_BUILD = chart('C:3.5 D:3.5 F:3.5 B:3.5')

BEAT = {'kick': 'x...x..', 'snare': '..x..x.', 'hat': 'xxxxxxx'}
BEAT2 = {'kick': 'x.x.x..', 'rim': '..x..x.', 'ride': 'x.x.x.x'}
FILL = {'kick': 'x...x..', 'snare': '..x.xxx', 'tom_lo': '....x..'}
CHANT = {'kick': 'x...x..', 'tom_lo': '..x..x.', 'tom_hi': '......x'}


def build():
    s = Score('battle_act3', tonic='E', bpm=144, meter=(7, 8), intro_bars=2, loop_bars=44,
              title='Bleached Rite', seed=73)
    s.reverb = dict(rt60=3.0, predelay_ms=32, wet_db=0.0, damp=0.4, bright=1.2)
    s.master = dict(lufs=-14.0, glue_ratio=1.5)
    b = Battle(s, calm_lufs=-17.5, full_lufs=-14.0)
    b.section('intro', 1, chart('Em:3.5 F:3.5')).section('A1', 3, CH_A).section('A1b', 11, CH_A)
    b.section('B', 19, CH_B).section('C', 27, CH_C).section('A2', 35, CH_A)
    b.section('build', 43, CH_BUILD)

    org = b.part('organ', 'organ', role='pad', calm_db=-2)
    for sec in ('intro', 'A1', 'B', 'C', 'A2'):
        pad(org, b.bar(sec), b.chart(sec), n=3, lo=52, hi=71, vel=0.5,
            art='loud' if sec in ('B', 'A2') else None)

    # tunes
    b.lead('A1', MEL_A, inst='violins', dyn='f', art='sus')
    b.lead('A1b', MEL_A, inst='violins', dyn='f')
    b.lead('A1b', MEL_A, inst='horns', transpose=-12, dyn='f', layer='full')
    b.lead('B', MEL_B, inst='trumpets', transpose=-12, dyn='ff', layer='full')
    b.lead('B', MEL_B, inst='violins', dyn='ff')
    b.lead('B', MEL_B, inst='choir', name='choir_lead', transpose=-12, dyn='f', layer='full',
           role='lead2')
    b.lead('A2', MEL_A, inst='violins', dyn='ff')
    b.lead('A2', MEL_A, inst='horns', transpose=-12, dyn='ff', layer='full')
    b.lead('A2', MEL_A, inst='violins2', name='lead8', transpose=-12, dyn='f', role='lead2')
    b.lead('build', 'E5q. G5q C6q | F#5q. A5q D6q | F5q. A5q C6q | D#5q. F#5q B5q |',
           inst='violins', dyn='f')

    # calm voices: a boy-choir-like solo line and the solo violin
    b.lead('A1', MEL_A, inst='solo_violin', dyn='mf', layer='calm')
    b.lead('A1b', MEL_A, inst='flute', dyn='mf', layer='calm')
    b.lead('B', MEL_B, inst='oohs', name='calm_choir', transpose=-12, dyn='mf', layer='calm')
    b.lead('A2', MEL_A, inst='oboe', dyn='mf', layer='calm')

    # strings in 7
    for sec in ('A1', 'A1b', 'C', 'A2', 'build'):
        b.spic8(sec, 'celli', degrees='b b b b b b b', lo=40, hi=57, accents='> - > - > - -')
        b.low(sec, 'q')
    for sec in ('A1b', 'A2'):
        b.spic16(sec, 'violins2', pattern='0 1 2 1 2 1 0', lo=64, hi=83)
    b.pads('B', 'violas', n=2, lo=54, hi=69)
    b.low('B', 'w')
    b.pads('C', 'violins2', n=2, lo=64, hi=79, art='trem', name='c_trem')

    b.choir('A2', 'choir', n=3, lo=55, hi=74, vel=0.64)
    b.choir('C', 'oohs', n=3, lo=52, hi=69, vel=0.6)
    b.brass_pad('C', 'trombones', n=2, lo=40, hi=55, vel=0.55)
    b.brass_pad('build', 'horns', n=3, lo=53, hi=69, vel=0.62)

    # rhythm
    b.groove('A1', BEAT, FILL, every=4)
    b.groove('A1b', BEAT, FILL, every=4)
    b.groove('B', BEAT2, FILL, every=4)
    b.groove('C', CHANT, None, crash=False)
    b.groove('A2', BEAT2, FILL, every=4)
    b.groove('build', {'kick': 'x.x.x..', 'snare': 'xxxxxxx'}, crash=False)
    for sec in ('A1', 'A1b', 'B', 'A2', 'build'):
        b.rbass(sec, rhythm='e e e e e e e', notes='r r r r r r 8', accents='> - > - > - -')
        b.sub(sec)
    b.rbass('C', rhythm='q. q q', notes='r r 8', accents=None)

    b.timp('intro', '@f E2q E2q E2q. | F2q F2q F2e F2e F2e |')
    b.timp('C', '@f E2q rq rq. | F2q rq rq. | E2q rq rq. | F2q rq rq. |'
               ' D2q rq rq. | F2q rq rq. | E2q rq rq. | B2e B2e B2e B2e B2e B2e B2e |')
    b.timp('build', '%roll @mf C3q.~ C3h | D3q.~ D3h | F2q.~ F2h | B2q.~ B2h |')
    for bar in (3, 11, 19, 35):
        b.hit(bar)
    bells = b.part('bells', 'bells', role='accent', calm_db=-4)
    bells.at(27).play('@f E4q rq rq. | F4q rq rq. | E4q rq rq. | F4q rq rq. |'
                      ' D4q rq rq. | F4q rq rq. | E4q rq rq. | F#4q rq rq. |')
    b.riser(33, beats=7)
    b.riser(41, beats=7)

    for sec in ('A1', 'A1b', 'B', 'C', 'A2'):
        b.calm_bed(sec, piano='0 2 4 2 3 2 1', piano_step=0.5, pad_n=0)
    return b.finish()
