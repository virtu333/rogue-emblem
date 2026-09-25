"""Escape battles — "One More Crossing".

The pursuit maps, where the objective is to get out before the dark closes.
A steady 12/8 motor (four groups of three eighths, kept low in the middle
register) runs under the Thread in E minor at half speed: every note of it a
dotted half or longer, a broad line moving over fast motion. The motor says
the company is going somewhere; the long line says why.

  A   the Thread, augmented, on horns (calm: oboe), i-bVI-bVII with a hard
      major V (B7) at each phrase end pulling back to E minor.
  B   a minor third up, G minor: the Thread cell at its own speed in the
      violins, urgent, sequenced up the scale.
  A'  the full band; one remote colour, F major (the Neapolitan), under the
      melody's descent.

No choir: that is spent elsewhere. The calm mix keeps the motor on harp and
soft strings with a quiet taiko pulse, the tune on oboe, clarinet and flute.
"""

from engine.patterns import bass, chart, ostinato, pad
from engine.score import Score

from scores._battle import Battle

KEY = 'music_battle_escape'

# each bar is 6 quarter beats (12/8); durations in beats
MEL_A = """
B4:3 E5:3 | F#5:4.5 G5:1.5 | B5:6 | A5:1.5 G5:1.5 F#5:3 |
B4:3 E5:3 | F#5:4.5 A5:1.5 | D6:3 C6:1.5 A5:1.5 | B5:3 A5:1.5 F#5:1.5 |
"""
MEL_B = """
D5:1.5 G5:1.5 A5:1.5 D6:1.5 | C6:3 Bb5:1.5 A5:1.5 | G5:1.5 A5:1.5 Bb5:1.5 C6:1.5 | D6:6 |
Eb6:3 C6:1.5 G5:1.5 | D6:3 Bb5:3 | A5:3 F#5:3 | F#5:3 D#5:3 |
"""
CH_INTRO = chart('Em:6 B7:6')
CH_A = chart('Em:6 D/C:3 D:1.5 G/D:1.5 Em:6 C:3 D:3 Em:6 D/C:3 D:3 G:3 Am:3 B7sus4:3 B7:3')
CH_B = chart('Gm:6 Eb:3 Bb/D:1.5 F:1.5 Gm:6 Bb:6 Cm:6 Gm/Bb:6 D:3 D7:3 B7sus4:3 B7:3')
CH_A2 = chart('Em:6 D/C:3 D:1.5 G/D:1.5 Em:6 F:3 D:3 Em:6 D/C:3 D:3 G:3 Am:3 B7sus4:3 B7:3')

MOTOR = 'e e e e e e e e e e e e'
MOTOR_DEG = '0 2 1 0 2 1 0 2 1 0 2 1'
MOTOR_ACC = '> - - > - - > - - > - -'

# 12/8 kit: kick on the big beats, backbeat on 2 and 4, eighth hats
DRIVE = {'kick': 'x.....x..x..', 'snare': '...x.....x..', 'hat': 'xxxxxxxxxxxx'}
DRIVE_FILL = {'kick': 'x.....x.....', 'snare': '...x.....xxx', 'tom_lo': '......x.x...'}
HALF = {'kick': 'x.....x.....', 'rim': '......x.....', 'ride': 'x..x..x..x..'}


def build():
    s = Score('battle_escape', tonic='E', bpm=162, meter=(12, 8), intro_bars=2, loop_bars=24,
              title='One More Crossing', seed=131)
    s.reverb = dict(rt60=2.1, predelay_ms=24, wet_db=-1.0)
    s.master = dict(lufs=-14.0, glue_ratio=1.5)
    b = Battle(s, calm_lufs=-17.5, full_lufs=-14.0)
    b.section('intro', 1, CH_INTRO).section('A', 3, CH_A).section('B', 11, CH_B)
    b.section('A2', 19, CH_A2)

    # ---------------------------------------------------------------- the motor
    va = b.part('motor_va', 'violas', role='ostinato', art='spic', calm_db=-4)
    hp = b.part('motor_harp', 'harp', role='keys', calm_db=2)
    vc = b.part('motor_vc', 'celli', role='section', art='spic', calm_db=-6)
    for sec in ('intro', 'A', 'B', 'A2'):
        bar, ch = b.sections[sec]
        ostinato(va, bar, ch, MOTOR, MOTOR_DEG, lo=52, hi=67, vel=0.56, accents=MOTOR_ACC)
        ostinato(hp, bar, ch, MOTOR, '0 1 2 1 0 1 2 1 0 1 2 1', lo=55, hi=74, vel=0.44)
        ostinato(vc, bar, ch, 'q. q. q. q.', 'b b b b', lo=40, hi=55, vel=0.6,
                 accents='> - > -')

    # ---------------------------------------------------------------- low end
    cb = b.part('cb', 'basses', role='low', layer='full')
    for sec in ('A', 'B', 'A2'):
        bar, ch = b.sections[sec]
        bass(cb, bar, ch, 'q. q. q. q.', 'r r 5 r', floor=28, vel=0.66, art='spic')
    clow = b.part('c_low', 'basses', role='low', layer='calm', art='soft')
    for sec in ('intro', 'A', 'B', 'A2'):
        bar, ch = b.sections[sec]
        bass(clow, bar, ch, 'w.', 'r', floor=28, vel=0.5, art='soft')

    # ---------------------------------------------------------------- the tune
    b.lead('A', MEL_A, inst='horns', name='a_horns', transpose=-12, dyn='f', layer='full')
    b.lead('A', MEL_A, inst='violins2', name='a_vn2', transpose=-12, dyn='mf', role='lead2',
           layer='full', art='sus')
    b.lead('A', MEL_A, inst='oboe', dyn='mf', layer='calm')
    b.lead('B', MEL_B, inst='violins', name='b_vn', dyn='f', art='sus', layer='full')
    b.lead('B', MEL_B, inst='violins2', name='b_vn8', transpose=-12, dyn='mf', role='lead2',
           art='sus', layer='full')
    b.lead('B', MEL_B, inst='clarinet', transpose=-12, dyn='mf', layer='calm')
    b.lead('A2', MEL_A, inst='violins', name='a2_vn', dyn='ff', art='sus', layer='full')
    b.lead('A2', MEL_A, inst='trumpets', name='a2_tpt', transpose=-12, dyn='f', layer='full')
    b.lead('A2', MEL_A, inst='horns', name='a2_hn', transpose=-12, dyn='f', role='lead2',
           layer='full')
    b.lead('A2', MEL_A, inst='flute', dyn='mf', layer='calm')

    # ---------------------------------------------------------------- harmony
    for sec in ('A', 'B', 'A2'):
        b.pads(sec, inst='violins2', name='pad_vn2', n=2, lo=62, hi=74, vel=0.42, art='soft',
               layer='calm')
    b.brass_pad('B', inst='horns', name='b_hn_pad', n=3, lo=53, hi=67, vel=0.5)
    b.brass_pad('A2', inst='trombones', name='a2_tbn', n=3, lo=45, hi=60, vel=0.52)

    # ---------------------------------------------------------------- drums
    b.groove('A', DRIVE, fill=DRIVE_FILL, every=4, vel=0.7)
    b.groove('B', HALF, fill=DRIVE_FILL, every=8, vel=0.66)
    b.groove('A2', DRIVE, fill=DRIVE_FILL, every=4, vel=0.76)
    tk = b.part('c_taiko', 'taiko', role='drums', layer='calm')
    for bar in range(1, 27):
        tk.at(bar).play('@p D2:1.5 r:1.5 D2:1.5 r:1.5')
    b.timp('A', 'rw. | rw. | rw. | rw. | rw. | rw. | rw. | %roll B2:6 |')
    b.timp('B', 'G2:1.5 r:4.5 | rw. | rw. | rw. | rw. | rw. | rw. | %roll B2:6 |')
    b.timp('A2', 'E2:1.5 r:4.5 | rw. | rw. | rw. | rw. | rw. | rw. | %roll B2:6 |')
    b.hit(3)
    b.hit(19)
    return b.finish()
