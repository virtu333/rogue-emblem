"""Promotion, part one — the gather, from the rite opening to the name.

A swell toward the moment the new class name burns in (1.55 s at normal
speed): tremolo strings rising on A, a timpani roll, a riser and a harp
glissando all peaking on beat 3 at 120 bpm (1.5 s). It keeps sustaining a
little longer in case the crown comes late; the crown fades it out.
"""

from stingers._common import cue

KEYED = True


def build(transpose=0):
    s = cue('promotion_gather', bpm=120, bars=1.5, meter=(4, 4),
            title='Promotion — Gather', transpose=transpose, seed=17, lufs=-18.0)
    vn = s.part('vn', 'violins', role='section', art='trem')
    vn.at(1).play('@mf [A4 E5]w [A4 E5]h')
    vn.expr_beats((0, 0.2), (3.0, 1.0), (6, 0.9))
    va = s.part('va', 'violas', role='section', art='trem')
    va.at(1).play('@mf A3w A3h')
    va.expr_beats((0, 0.2), (3.0, 1.0), (6, 0.9))
    vc = s.part('vc', 'celli', role='low', art='trem')
    vc.at(1).play('@mf A2w A2h')
    vc.expr_beats((0, 0.2), (3.0, 1.0), (6, 0.9))
    timp = s.part('timp', 'timpani', role='timp', art='roll')
    timp.at(1).play('@mf A2w A2h')
    timp.expr_beats((0, 0.15), (3.0, 1.0), (6, 0.8))
    hp = s.part('harp', 'harp', role='keys')
    hp.at(1).play('@mf rh A3x D4x E4x A4x D5x E5x A5x D6x rh.')
    rs = s.part('riser', 'riser', role='fx')
    rs.at(1).play('@mp C4:3 rq rh')
    return s
