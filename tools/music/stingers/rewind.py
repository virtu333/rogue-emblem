"""Rewind / Vision — the Thread runs backwards.

A reversed swell rises into the first note, then the celesta plays the
Thread in retrograde (A-E-D-A, falling) with harp harmonics; a high string
halo holds the Thread chord. Under two seconds.
"""

from stingers._common import cue

KEYED = True


def build(transpose=0):
    s = cue('rewind', bpm=100, bars=1, title='Rewind', transpose=transpose, seed=27,
            lufs=-18.5, rt60=2.8)
    rev = s.part('rev', 'reverse', role='fx')
    rev.at(1).play('@mf C4:1.5 rq. rq |')
    cel = s.part('celesta', 'celesta', role='lead')
    cel.at(1).play('@mf rq. A5e E5e D5e A4q |')
    hp = s.part('harp', 'harp', role='keys')
    hp.at(1).play('@mp rq. A6e E6e D6e A5q |')
    vn = s.part('vn', 'violins', role='pad', art='soft')
    vn.at(1).play('@p rq [A5 E6]h. |')
    vn.expr_beats((1, 0.2), (2.5, 0.9), (4, 0.6))
    return s
