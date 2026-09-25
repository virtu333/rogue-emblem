"""Sealed — a weapon rank, a new weapon type or a skill is stamped in.

A soft timpani stamp and a rolled harp chord on D-A-E, then the glockenspiel
and a bell ring the Thread's top notes (A, E) like wax cooling. Short.
"""

from stingers._common import cue

KEYED = True


def build(transpose=0):
    s = cue('sealed', bpm=120, bars=1, title='Sealed', transpose=transpose, seed=11,
            lufs=-18.5)
    timp = s.part('timp', 'timpani', role='timp')
    timp.at(1).play('@mf D3q rq rh |')
    hp = s.part('harp', 'harp', role='keys')
    hp.at(1).play('@mf [D3 A3 D4 A4 E5]h rh |')
    gl = s.part('glock', 'glock', role='lead')
    gl.at(1).play('@mp re A5e E6q~ E6h |')
    bells = s.part('bells', 'bells', role='accent')
    bells.at(1).play('@p re A4q.~ A4h |')
    vn = s.part('vn', 'violins', role='pad', art='soft')
    vn.at(1).play('@p [A4 E5]w |')
    vn.expr_beats((0, 0.3), (1.5, 0.9), (4, 0.6))
    return s
