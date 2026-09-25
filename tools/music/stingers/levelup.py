"""Level up — the Thread climbs.

The four notes of the Thread (A-D-E-A) as a harp run up through two octaves,
the celesta catching the top, strings opening beneath onto the Thread chord
(D-A-E: the open fifth and ninth, no third, so it sits over major and minor
music alike). One bar at 132 (1.8 s of notes); the tail can be cut when the
card closes.
"""

from stingers._common import cue

KEYED = True


def build(transpose=0):
    s = cue('levelup', bpm=132, bars=1, title='Level Up', transpose=transpose, seed=5)
    hp = s.part('harp', 'harp', role='lead')
    hp.at(1).play('@mf A3s D4s E4s A4s D5s E5s A5s D6s~ D6h |')
    cel = s.part('celesta', 'celesta', role='lead2')
    cel.at(1).play('@mf rq. A5e [D6 E6]h |')
    vn = s.part('vn', 'violins', role='pad', art='soft')
    vn.at(1).play('@mp re [A4 E5]q.~ [A4 E5]h |')
    va = s.part('va', 'violas', role='pad', art='soft')
    va.at(1).play('@mp re D4q.~ D4h |')
    vc = s.part('vc', 'celli', role='low', art='soft')
    vc.at(1).play('@mp D3w |')
    vn.expr_beats((0, 0.5), (2, 1.0), (4, 0.8))
    va.expr_beats((0, 0.5), (2, 1.0), (4, 0.8))
    tri = s.part('tri', 'orch_perc', role='accent')
    tri.note(2.0, 79, 1.0, vel=0.5)
    return s
