"""A lord falls — the Thread breaks.

A solo cello begins the Thread (A-D-E...) and stops before the last note,
over a soft D minor held by the strings. Not the run's end (Rewind may still
be offered): a wound, not a funeral.
"""

from stingers._common import cue

KEYED = True


def build(transpose=0):
    s = cue('lord_fallen', bpm=72, bars=1, title='A Lord Falls', transpose=transpose, seed=25,
            lufs=-19.0, rt60=3.0)
    vc = s.part('cello', 'celli', role='lead', art='sus')
    vc.at(1).play('@mf A3q. D4e E4q rq |')
    vc.expr_beats((0, 0.8), (1.5, 1.0), (3, 0.3))
    va = s.part('va', 'violas', role='pad', art='soft')
    va.at(1).play('@pp [D4 F4]w |')
    vn = s.part('vn', 'violins2', role='pad', art='soft')
    vn.at(1).play('@pp A4w |')
    cb = s.part('cb', 'basses', role='low', art='soft')
    cb.at(1).play('@pp D2w |')
    return s
