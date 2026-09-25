"""The Lieutenant — two futures at once, and she knows your line.

Her motif (A-D-C-A, the Thread's rhythm falling) on celesta with its shadow
a beat later and a tritone away on harp; then the player's Thread begins in
the violins (A-D-E...) and is cut off before its answer: she saw it coming.
In the key of her theme.
"""

from stingers._common import cue

KEYED = False
TONIC = 'D'


def build(transpose=0):
    s = cue('boss_lieutenant_card', bpm=100, bars=2, title='The Lieutenant',
            transpose=transpose, seed=51, lufs=-17.5, rt60=2.8)
    cel = s.part('celesta', 'celesta', role='lead')
    cel.at(1).play('@mf A5q D5q C5q A4q | rw |')
    hp = s.part('harp', 'harp', role='lead2')
    hp.at(1).play('@mf rq Eb5q Ab4q Gb4q | Eb4q rq rh |')
    vn = s.part('vn', 'violins', role='section', art='sus')
    vn.at(1).play('@mp rw | A4q D5q E5e re rq |')
    va = s.part('va', 'violas', role='pad', art='trem')
    va.at(1).play('@pp [D4 A4]w | [D4 A4]h. rq |')
    cb = s.part('cb', 'basses', role='low', art='soft')
    cb.at(1).play('@pp D2w | D2w |')
    return s
