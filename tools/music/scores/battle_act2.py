"""Act II battle — "Iron Rain".

The Empire's ground. The main riff is the Empire drill itself (C-Db-C-Bb)
hammered in eighths by low strings, bass and trombones under a snare that
marches in sixteenths. The Thread fights back in E-flat major (B strain),
survives a half-time breakdown on a lone trumpet, and returns over the riff
as a full brass-and-violin unison.
"""

from engine.patterns import chart
from engine.score import Score

from scores._battle import Battle

KEY = 'music_battle_act2'

RIFF = ('C3e C3e Db3e C3e Bb2e C3e Ab2e G2e | C3e C3e Db3e C3e Bb2e C3e Eb3e D3e |'
        ' C3e C3e Db3e C3e Bb2e C3e Ab2e G2e | G2e G2e Ab2e G2e F2e G2e B2e D3e |')
HIGH_A = 'G5h. Ab5q | G5w | F5h. Eb5q | D5w | G5h. Ab5q | Bb5h C6h | Ab5h G5h | G5w |'
THREAD_B = """
Bb4q Eb5q F5e Bb5q.~ | Bb5h Ab5q G5q | F5q. G5e Ab5q C6q | Bb5w |
Bb4q Eb5q F5e Bb5q.~ | Bb5q D6q C6q Bb5q | Ab5q. G5e F5q D5q | Eb5w |
"""
MEL_A2 = """
C4q. D4e Eb4q G4q | Ab4h G4h | F4q. Eb4e D4q Bb3q | C4w |
C4q. D4e Eb4q G4q | Ab4h Bb4h | C5q. Bb4e Ab4q F4q | G4w |
"""
LONE = """
Eb4q Ab4q Bb4e Eb5q.~ | Eb5h C5q Ab4q | F4q. Ab4e Db5q F5q | Eb5w |
Eb4q Ab4q Bb4e Eb5q.~ | Eb5q F5q Ab5q C6q | Bb5q. Ab5e F5q Db5q | D5w |
"""

CH_A = chart('Cm Db/C Cm G Cm Ab:2 Bb:2 Fm:2 G:2 G')
CH_B = chart('Eb Ab Fm7 Bb Eb Bb/D Ab:2 Bb:2 Eb')
CH_A2 = chart('Cm Ab:2 Eb/G:2 Bb Cm Cm Ab:2 Bb:2 Fm G')
CH_C = chart('Ab Fm Db Eb Ab Fm Db G')
CH_BUILD = chart('Ab Bb Db G7')

DRILL = {'kick': 'x.x.x.x.x.x.x.x.', 'snare': 'x.oox.oox.oox.xx', 'hat': 'x...x...x...x...'}
DRILL_FILL = {'kick': 'x.x.x.x.x.......', 'snare': 'x.oox.oox.xxXXXX'}
ROCK = {'kick': 'x.....x.x.....x.', 'rim': '....x.......x...', 'ride': 'X.x.X.x.X.x.X.x.'}
ROCK_FILL = {'kick': 'x.....x.x.......', 'rim': '....x.......', 'snare': '............xxXX',
             'tom_lo': '..........xx....'}
HALF = {'kick': 'x.........x.....', 'rim': '........X.......', 'hat': 'x.x.x.x.x.x.x.x.'}
DOUBLE = {'kick': 'x.x.x.x.x.x.x.x.', 'rim': '....X.......X...', 'ride': 'XxXxXxXxXxXxXxXx'}


def build():
    s = Score('battle_act2', bpm=160, intro_bars=4, loop_bars=44, title='Iron Rain', seed=67)
    s.reverb = dict(rt60=2.0, predelay_ms=22, wet_db=-1.5, damp=0.55)
    s.master = dict(lufs=-13.5, glue_ratio=1.6)
    b = Battle(s, calm_lufs=-17.0, full_lufs=-13.5)
    b.section('intro', 1, chart('Cm Cm Cm G')).section('A', 5, CH_A).section('B', 13, CH_B)
    b.section('A2', 21, CH_A2).section('C', 29, CH_C).section('D', 37, CH_A2)
    b.section('build', 45, CH_BUILD)

    # the drill riff: celli, basses, bass guitar, trombones in octaves
    for sec in ('intro', 'A', 'A2', 'D'):
        riff = RIFF + RIFF if b._bars(sec) == 8 else RIFF
        b.lead(sec, riff, inst='celli', name='riff_vc', dyn='f', role='lead2', art='spic')
        b.lead(sec, riff, inst='basses', name='riff_cb', transpose=-12, dyn='f', role='low',
               art='spic', calm_db=-6)
        b.rbass(sec, text=riff, transpose=-12)
        if sec != 'intro':
            b.lead(sec, riff, inst='trombones', name='riff_tbn', dyn='f', layer='full',
                   role='counter', art='stac')

    # tunes
    b.lead('A', HIGH_A, inst='violins', name='high', dyn='f', role='counter', art='sus')
    b.lead('B', THREAD_B, inst='violins', dyn='ff', art='sus')
    b.lead('B', THREAD_B, inst='violins2', name='lead8', transpose=-12, dyn='f', role='lead2',
           art='sus')
    b.lead('A2', MEL_A2, inst='horns', dyn='ff', layer='full')
    b.lead('A2', MEL_A2, inst='violins', transpose=12, dyn='f', role='lead2', name='a2_vn')
    b.lead('C', LONE, inst='trumpets', name='lone', dyn='mf', layer='full')
    b.lead('D', MEL_A2, inst='trumpets', transpose=12, dyn='ff', layer='full')
    b.lead('D', MEL_A2, inst='violins', transpose=12, dyn='ff')
    b.lead('D', MEL_A2, inst='horns', dyn='ff', layer='full')
    b.lead('build', 'Eb5q Ab5q C6q Eb6q | D6q Bb5q F5q D5q | Db5q F5q Ab5q Db6q | B5q G5q D5q B4q |',
           inst='violins', dyn='f')

    # calm voices
    b.lead('A', HIGH_A, inst='oboe', dyn='mf', layer='calm', transpose=-12)
    b.lead('B', THREAD_B, inst='flute', dyn='mf', layer='calm')
    b.lead('A2', MEL_A2, inst='clarinet', transpose=12, dyn='mf', layer='calm')
    b.lead('C', LONE, inst='solo_violin', transpose=12, dyn='mf', layer='calm')
    b.lead('D', MEL_A2, inst='flute', transpose=12, dyn='f', layer='calm', name='lead_flute')

    # strings texture
    for sec in ('A', 'A2', 'D'):
        b.spic16(sec, 'violins2', pattern='0 1 2 1', lo=60, hi=79)
    b.spic8('B', 'celli', degrees='b b b b b b b b', lo=39, hi=55)
    b.pads('B', 'violas', n=2, lo=55, hi=70)
    b.pads('C', 'violas', n=2, lo=53, hi=67, art='trem')
    b.pads('C', 'violins2', n=2, lo=63, hi=77, art='soft', name='c_vn2')
    b.low('B', 'q')
    b.low('C', 'w')
    b.low('build', 'w')
    b.spic16('build', 'violins2', pattern='0 1 2 3', lo=60, hi=84)

    # brass & choir
    b.brass_pad('B', 'horns', n=3, lo=51, hi=67, vel=0.58)
    b.stabs('B', rhythm='q. q. q', lo=63, hi=77)
    b.brass_pad('C', 'trombones', n=2, lo=44, hi=58, vel=0.5)
    b.choir('C', 'oohs', n=3, lo=55, hi=72, vel=0.55)
    b.choir('D', 'choir', n=3, lo=55, hi=74, vel=0.66)
    b.brass_pad('build', 'horns', n=3, lo=53, hi=69, vel=0.62)

    # rhythm
    b.groove('intro', {'snare': 'x.oox.oox.oox.oo', 'kick': 'x.......x.......'}, crash=False)
    b.groove('A', DRILL, DRILL_FILL, every=4)
    b.groove('B', ROCK, ROCK_FILL, every=4)
    b.groove('A2', DRILL, DRILL_FILL, every=4)
    b.groove('C', HALF, ROCK_FILL, every=8)
    b.groove('D', DOUBLE, DRILL_FILL, every=4)
    b.groove('build', {'kick': 'x...x...x...x...', 'tom_lo': 'x.x.x.x.xxxxxxxx'}, crash=False)
    b.rbass('B', rhythm='e e e e e e e e', notes='r r r r r r 8 r')
    b.rbass('C', rhythm='h h', notes='r 5', accents=None)
    b.rbass('build', rhythm='e e e e e e e e', notes='r r r r r r r r')
    for sec in ('B', 'C', 'build'):
        b.sub(sec)

    b.timp('intro', '@f C2q rq C2q rq | C2q rq C2e C2e C2q | C2q rq C2q rq | G2q G2q G2q G2q |')
    for sec in ('A', 'A2', 'D'):
        b.timp(sec, '@f C2q rq rh |')
    b.timp('B', '@ff Eb2q rq rh |')
    b.timp('build', '%roll @mf Ab2w | Bb2w | Db3w | G2w |')
    for bar in (5, 13, 21, 29, 37):
        b.hit(bar)
    b.riser(35, beats=8)
    b.riser(47, beats=8)

    for sec in ('A', 'B', 'A2', 'C', 'D'):
        b.calm_bed(sec)
    return b.finish()
