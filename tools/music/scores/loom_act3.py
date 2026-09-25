"""Route map, Act III — "The Loom: Bleached Rite".

The sacred ground, overfed by the ritual: pale, holy, faintly wrong. A slow
3/4 on organ and wordless choir that alternates E major with the Phrygian
F major beside it, so the light never settles. The solo violin sings the
Thread motif with a raised fourth (A-sharp over E: too bright), then bends it
back down; the celesta repeats it like something remembered wrong.
"""

from engine.patterns import arp, bass, chart, pad
from engine.score import Score

KEY = 'music_explore_act3'

MEL_A = """
B4h E5q | F#5h. | B5h. | A5q G#5q F5q | E5h. | rh. |
B4h E5q | F#5h. | B5h C6q | B5q A5q G#5q | A5h. | G#5h. |
"""
MEL_B = """
E5h A5q | B5h. | C6h. | B5q A5q G5q | F5h. | E5h. |
E5h A5q | B5h. | D6h C6q | B5q A5q G#5q | E5h. | rh. |
"""
CH_A = chart('E:3 E:3 Fmaj7:3 Dm/F:3 E:3 E:3 E:3 Fmaj7:3 Am:3 E/G#:3 Fmaj7:3 E:3')
CH_B = chart('Am:3 Em:3 F:3 G:3 Dm:3 E:3 Am:3 Em:3 Dm:3 Fmaj7:3 E:3 E:3')


def build():
    s = Score('loom_act3', bpm=72, meter=(3, 4), intro_bars=2, loop_bars=24,
              title='The Loom: Bleached Rite', seed=53)
    s.reverb = dict(rt60=4.0, predelay_ms=40, wet_db=1.5, damp=0.4, bright=1.2)
    s.master = dict(lufs=-18.0, glue_ratio=1.2, lead_duck=1.0)
    s.variant('full', {}, lufs=-18.0)
    A, B = 3, 15

    org = s.part('organ', 'organ', role='pad', gain=-2)
    org.at(1).play('@mp [E3 B3 G#4]h.~ | [E3 B3 G#4]h. |')
    pad(org, A, CH_A, n=3, lo=52, hi=71, vel=0.45)
    pad(org, B, CH_B, n=3, lo=52, hi=71, vel=0.45)
    oohs = s.part('oohs', 'oohs', role='choir')
    pad(oohs, A, CH_A, n=3, lo=55, hi=72, vel=0.42)
    pad(oohs, B, CH_B, n=3, lo=55, hi=72, vel=0.48)
    ped = s.part('pedal', 'basses', role='low', art='soft')
    for bar, ch in ((A, CH_A), (B, CH_B)):
        bass(ped, bar, ch, 'h.', 'b', floor=28, vel=0.45, art='soft')

    solo = s.part('solo', 'solo_violin', role='lead')
    solo.at(A).play('@mp' + MEL_A)
    solo.at(B).play('@mf' + MEL_B)
    solo.expr((A, 0.8), (A + 2, 1.0), (A + 4, 0.7), (B, 0.8), (B + 8, 1.0), (B + 11.9, 0.6))
    cel = s.part('celesta', 'celesta', role='accent', gain=-2)
    cel.at(A + 6).play('@mp B5q E6q F#6q | B6h. | rh. | rh. | rh. | rh. |')
    cel.at(B + 6).play('@mp E6q A6q B6q | E7h. | rh. | rh. | rh. | rh. |')
    glock = s.part('glock', 'glock', role='accent', gain=-8)
    glock.at(A + 2).play('@p B6h. | rh. |')
    hp = s.part('harp', 'harp', role='keys', gain=-4)
    arp(hp, B, CH_B, '0 2 4', step=1.0, lo=52, hi=76, vel=0.4)
    vc = s.part('vc', 'celli', role='counter', art='soft')
    vc.at(B).play('@p C4h. | B3h. | A3h. | B3h. | A3h. | G#3h. | C4h. | B3h. | A3h. | A3h. | G#3h. | G#3h. |')
    return s
