"""Act IV battle — "Ashfall".

Night on the Hearth. Heavy and slow for a battle: the Empire
drill has become the ground itself, a riff in C-sharp minor (C#-D-C#-B,
falling to A and G#) under toms and tolling bells. The horns sing the Thread
as a lament; a muted trumpet keeps it alive through the quiet ash; at the
end the violins and choir carry it over the riff at full weight.
"""

from engine.patterns import chart
from engine.score import Score

from scores._battle import Battle

KEY = 'music_battle_act4'

RIFF = 'C#2q. D2e C#2q B1q | A1h. G#1q |'
LAMENT = """
G#3q C#4q D#4e G#4q.~ | G#4h F#4q E4q | F#4q. E4e D#4q B3q | C#4w |
G#3q C#4q D#4e G#4q.~ | G#4q B4q A4q G#4q | F#4q. E4e D#4q C#4q | D#4w |
"""
ASH = """
E5h. C#5q | C#5h A4h | G#4h. E4q | D#4w |
E5h. F#5q | F#5h A4h | B4q. A4e G#4q F#4q | G#4w |
"""
CH_A = chart('C#m A:3 G#:1 C#m A:3 G#:1 C#m A:3 G#:1 C#m A:3 G#:1')
CH_B = chart('C#m E B C#m C#m E F#m:2 B:2 G#')
CH_C = chart('A F#m C#m G# A F#m B G#')
CH_BUILD = chart('A B C D')

DOOM = {'kick': 'x.......x.x.....', 'snare': '........x.......', 'tom_lo': '..x...x.....x.x.',
        'hat': 'x...x...x...x...'}
DOOM_FILL = {'kick': 'x.......x.......', 'snare': '........x...xxxx', 'tom_lo': 'x.x.x.x.....'}
HEAVY = {'kick': 'x.x...x.x.x...x.', 'rim': '....X.......X...', 'ride': 'X.x.X.x.X.x.X.x.'}
ASHBEAT = {'kick': 'x...............', 'tom_lo': '........x.......'}


def build():
    s = Score('battle_act4', tonic='C#', bpm=132, intro_bars=4, loop_bars=36, title='Ashfall', seed=83)
    s.reverb = dict(rt60=3.0, predelay_ms=30, wet_db=0.5, damp=0.6)
    s.master = dict(lufs=-14.0, glue_ratio=1.5)
    b = Battle(s, calm_lufs=-18.0, full_lufs=-14.0)
    b.section('intro', 1, chart('C#m A:3 G#:1 C#m A:3 G#:1')).section('A', 5, CH_A).section('B', 13, CH_B)
    b.section('C', 21, CH_C).section('A2', 29, CH_B).section('build', 37, CH_BUILD)

    for sec in ('intro', 'A'):
        riff = RIFF * (b._bars(sec) // 2)
        b.lead(sec, riff, inst='basses', name='riff_cb', dyn='f', role='low', art='sus',
               calm_db=-4, transpose=12)
        b.rbass(sec, text=riff, transpose=12)
        if sec != 'intro':
            b.lead(sec, riff, inst='trombones', name='riff_tbn', transpose=24, dyn='ff',
                   layer='full', role='counter')
            b.lead(sec, riff, inst='tuba', name='riff_tuba', transpose=12, dyn='f',
                   layer='full', role='low')
            b.lead(sec, riff, inst='celli', name='riff_vc', transpose=24, dyn='f', role='lead2')

    b.lead('B', LAMENT, inst='horns', dyn='f', layer='full')
    b.lead('B', LAMENT, inst='violins', transpose=12, dyn='mf', name='b_vn', role='lead2')
    b.lead('C', ASH, inst='trumpets', name='ash_tpt', dyn='mf', layer='full', art='mute')
    b.lead('A2', LAMENT, inst='violins', transpose=12, dyn='ff')
    b.lead('A2', LAMENT, inst='choir', name='choir_lead', transpose=12, dyn='f', layer='full',
           role='lead2')
    b.lead('A2', LAMENT, inst='horns', dyn='ff', layer='full')
    b.lead('build', 'E5h A5h | F#5h B5h | G5h C6h | A5h D6h |', inst='violins', dyn='f')

    b.lead('B', LAMENT, inst='oboe', transpose=12, dyn='mf', layer='calm')
    b.lead('C', ASH, inst='solo_violin', dyn='mf', layer='calm')
    b.lead('A2', LAMENT, inst='flute', transpose=12, dyn='mf', layer='calm')
    b.lead('A', 'rw ' * 8, inst='bassoon', dyn='mf', layer='calm')

    b.pads('A', 'violins2', n=2, lo=61, hi=76, art='trem', name='trem_hi')
    b.pads('A', 'violas', n=2, lo=52, hi=66, art='trem', name='trem_va')
    # A2: the lament over its own harmony, the riff players now driving eighths
    b.spic8('A2', 'celli', degrees='b b b b b b b b', lo=37, hi=54)
    b.low('A2', 'q')
    b.rbass('A2', rhythm='e e e e e e e e', notes='r r r r r r 8 r')
    b.brass_pad('A2', 'trombones', n=2, lo=40, hi=58, vel=0.62)
    b.spic16('A2', 'violins2', pattern='0 1 2 1', lo=61, hi=80)
    for sec in ('B', 'C', 'build'):
        b.pads(sec, 'violas', n=2, lo=52, hi=67, art='sus')
        b.low(sec, 'w')
    b.spic8('B', 'celli', degrees='b b b b b b b b', lo=37, hi=54)
    b.spic16('build', 'violins2', pattern='0 1 2 3', lo=60, hi=84)

    b.choir('C', 'oohs', n=3, lo=52, hi=69, vel=0.55)
    b.choir('A', 'oohs', n=3, lo=52, hi=69, vel=0.5)
    b.brass_pad('B', 'trombones', n=2, lo=40, hi=56, vel=0.55)
    b.brass_pad('build', 'horns', n=3, lo=53, hi=69, vel=0.62)

    b.groove('intro', {'tom_lo': 'x.....x.x.......'}, crash=False)
    b.groove('A', DOOM, DOOM_FILL, every=4)
    b.groove('B', HEAVY, DOOM_FILL, every=4)
    b.groove('C', ASHBEAT, None, crash=False)
    b.groove('A2', HEAVY, DOOM_FILL, every=4)
    b.groove('build', {'kick': 'x...x...x...x...', 'tom_lo': 'x.x.x.x.xxxxxxxx'}, crash=False)
    b.rbass('B', rhythm='e e e e e e e e', notes='r r r r r r 8 r')
    b.rbass('C', rhythm='w', notes='r', accents=None)
    b.rbass('build', rhythm='e e e e e e e e', notes='r r r r r r r r')
    for sec in ('A', 'B', 'A2', 'build'):
        b.sub(sec)

    bells = b.part('bells', 'bells', role='accent', calm_db=-2)
    for bar in (1, 5, 9, 29, 33):
        bells.at(bar).play('@f C#5h G#4h |')
    for bar in (21, 25):
        bells.at(bar).play('@mf E5h C#5h |')
    b.timp('intro', '@f C#3q rq C#3q rq | A2q rq A2e A2e G#2q | C#3q rq C#3q rq | A2q A2q A2q G#2q |')
    b.timp('B', '@ff C#3q rq rh |')
    b.timp('build', '%roll @mf A2w | B2w | C3w | D3w |')
    for bar in (5, 13, 29):
        b.hit(bar)
    b.riser(27, beats=8)
    b.riser(39, beats=8)

    for sec in ('A', 'B', 'C', 'A2'):
        b.calm_bed(sec, piano='0 2 4 2', pad_n=2)
    return b.finish()
