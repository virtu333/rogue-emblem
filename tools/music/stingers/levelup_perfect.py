"""Level up, every stat grew — the Thread climbs and is crowned.

The harp run of the ordinary level-up, with the horns stating the Thread
(A-D-E-A) above a rolling timpani on A; then the whole orchestra lands on a
bright D major with the ninth on top (the upper fifth, A-E, ringing in the
violins). The one level-up cue that uses a major third: it is earned.
"""

from engine.patterns import drums
from stingers._common import cue

KEYED = True


def build(transpose=0):
    s = cue('levelup_perfect', bpm=132, bars=2, title='Level Up — Perfect', transpose=transpose,
            seed=7, lufs=-16.0)
    hp = s.part('harp', 'harp', role='keys')
    hp.at(1).play('@mf A3s D4s E4s A4s D5s E5s A5s D6s A3s D4s E4s A4s D5s E5s A5s D6s |')
    hp.at(2).play('@f [D3 A3 D4 F#4 A4 E5]w |')
    hn = s.part('horns', 'horns', role='lead')
    hn.at(1).play('@mf A3q D4q E4q A4q | @f [D4 F#4 A4]w |')
    hn.expr_beats((0, 0.6), (3.5, 1.0), (8, 0.9))
    tpt = s.part('tpt', 'trumpets', role='lead2')
    tpt.at(1).play('@mp rh re A4e D5e E5e | @f [A4 E5]w |')
    vn = s.part('vn', 'violins', role='lead2', art='sus')
    vn.at(1).play('@mp [A4 E5]w | @f [A5 E6]w |')
    vn.expr_beats((0, 0.4), (3.8, 1.0), (8, 0.85))
    va = s.part('va', 'violas', role='pad', art='trem')
    va.at(1).play('@p A3w | %sus @f [D4 F#4]w |')
    vc = s.part('vc', 'celli', role='low', art='trem')
    vc.at(1).play('@p A2w | %sus @f D3w |')
    cb = s.part('cb', 'basses', role='low')
    cb.at(1).play('@p A2w | @f D2w |')
    cel = s.part('celesta', 'celesta', role='accent')
    cel.at(2).play('@mf [A5 D6 E6]h rh |')
    timp = s.part('timp', 'timpani', role='timp')
    timp.at(1).play('%roll @p A2w | %default @f D3q rq rh |')
    timp.expr_beats((0, 0.3), (3.9, 1.0), (4.1, 1.0))
    perc = s.part('perc', 'orch_perc', role='accent')
    drums(perc, 2, {'crash': 'x', 'bd': 'x'}, vel=0.75)
    drums(perc, 1, {'swell_s': '...x'}, vel=0.5)  # the swell peaks 1.5 s in: on the landing
    return s
