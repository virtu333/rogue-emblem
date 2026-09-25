"""The blessing shrine — "What the Sun Kept".

Where a run chooses its blessings: gold, warm, reverent without weight.
G major in 3/4, harp and celesta over soft strings, with the Lydian C-sharp
(over C) for the light. The flute's hymn climbs to the leading tone and
stops: the Hollow Sun, still withholding its name, even here. The middle
strain sets the Thread (D-G-A-D) on the celesta over a hush of voices.
"""

from engine.patterns import arp, bass, chart, pad
from engine.score import Score

KEY = 'music_shrine'

HYMN = """
D5h. | E5q F#5q G5q | A5h G5q | F#5h. |
D5h E5q | F#5q G5q A5q | B5h A5q | F#5h rq |
"""
THREAD = """
D5q G5q A5q | D6h. | C6q B5q A5q | G5h. |
D5q G5q A5q | E6h. | D6q C6q B5q | A5h. |
"""
CH_A = chart('G:3 C:3 Em:3 D:3 G:3 C:3 Em:3 D:3')
CH_B = chart('Em:3 C:3 Am:3 G:3 Em:3 C:3 D:3 Dsus4:3')


def build():
    s = Score('shrine', tonic='G', bpm=72, meter=(3, 4), intro_bars=2, loop_bars=24,
              title='What the Sun Kept', seed=139)
    s.reverb = dict(rt60=3.0, predelay_ms=30, wet_db=0.5, bright=1.1)
    s.master = dict(lufs=-19.0, glue_ratio=1.2, lead_duck=1.0)
    s.variant('full', {}, lufs=-19.0)
    A, B, A2 = 3, 11, 19

    hp = s.part('harp', 'harp', role='keys')
    arp(hp, 1, chart('G:3 C:3'), '0 1 2 3 2 1', step=0.5, lo=55, hi=79, vel=0.44)
    for bar, ch in ((A, CH_A), (B, CH_B), (A2, CH_A)):
        arp(hp, bar, ch, '0 1 2 3 2 1', step=0.5, lo=55, hi=79, vel=0.42, accent_every=6,
            accent=0.06)
    va = s.part('pad_va', 'violas', role='pad', art='soft')
    vc = s.part('low_vc', 'celli', role='low', art='soft')
    for bar, ch in ((1, chart('G:3 C:3')), (A, CH_A), (B, CH_B), (A2, CH_A)):
        pad(va, bar, ch, n=2, lo=55, hi=67, vel=0.38, art='soft')
        bass(vc, bar, ch, 'h.', 'r', floor=38, vel=0.42, art='soft')

    fl = s.part('flute', 'flute', role='lead')
    fl.at(A).play('@mp' + HYMN)
    cel = s.part('celesta', 'celesta', role='lead')
    cel.at(B).play('@mp' + THREAD)
    oohs = s.part('oohs', 'oohs', role='choir')
    pad(oohs, B, CH_B, n=3, lo=55, hi=69, vel=0.32)
    vn = s.part('vn', 'violins', role='lead', art='soft')
    vn.at(A2).play('@mp' + HYMN)
    fl.at(A2).play('@p rh. | rh. | rh. | rh. | rq B5q D6q | rh. | rq D6q C#6q | rh. |')
    gl = s.part('glock', 'glock', role='accent')
    for bar in (A, B, A2):
        gl.at(bar).play('@p D6h. |')
    return s
