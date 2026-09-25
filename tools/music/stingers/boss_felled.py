"""Foe vanquished — a boss falls.

An impact on the boss theme's tonic, then the horns lift the Thread
(A-D-E-A) over held strings, ending on the open fifth: relief, not yet the
victory fanfare that follows the band.
"""

from engine.patterns import drums
from stingers._common import cue

KEYED = True


def build(transpose=0):
    s = cue('boss_felled', bpm=120, bars=1.25, meter=(4, 4), title='Foe Vanquished',
            transpose=transpose, seed=23, lufs=-16.0, rt60=2.6)
    tbn = s.part('tbn', 'trombones', role='section')
    tbn.at(1).play('@ff [D3 A3]q> rq rh [D3 A3]q')
    tuba = s.part('tuba', 'tuba', role='low')
    tuba.at(1).play('@ff D2q> rq rh D2q')
    hn = s.part('horns', 'horns', role='lead')
    hn.at(1).play('@f rq A3q D4q E4q | A4q')
    vn = s.part('vn', 'violins', role='section', art='sus')
    vn.at(1).play('@mf rq [A4 E5]h. | [A4 E5]q')
    vn.expr_beats((1, 0.5), (4, 1.0), (5, 0.8))
    vc = s.part('vc', 'celli', role='low', art='sus')
    vc.at(1).play('@f D3w | D3q')
    timp = s.part('timp', 'timpani', role='timp')
    timp.at(1).play('@ff D3q rq rh | D3q')
    perc = s.part('perc', 'orch_perc', role='accent')
    drums(perc, 1, {'crash': 'x', 'bd': 'x'}, vel=0.85)
    return s
