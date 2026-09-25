"""Level up, one stat or none — a small kind acknowledgement, no mockery.

Two celesta notes (D then A, the Thread's first interval turned to a nod)
over a harp dyad and a soft pizzicato root. Under a second of notes.
"""

from stingers._common import cue

KEYED = True


def build(transpose=0):
    s = cue('levelup_blank', bpm=132, bars=1, meter=(2, 4), title='Level Up — Lean',
            transpose=transpose, seed=9, lufs=-19.0)
    cel = s.part('celesta', 'celesta', role='lead')
    cel.at(1).play('@mp D5e A5e~ A5q |')
    hp = s.part('harp', 'harp', role='keys')
    hp.at(1).play('@mp [D4 A4]h |')
    vc = s.part('vc', 'celli', role='low', art='pizz')
    vc.at(1).play('@mp D3q rq |')
    return s
