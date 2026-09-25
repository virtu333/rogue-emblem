"""The Archmage — the same calculation, corrected every time.

A four-note celesta figure (D-E-F-A) repeats; every second repetition one
note is corrected a semitone (A to Ab, E to Eb, D to Db) so the sum never
comes out the same. A muted horn and a glockenspiel mark each correction.
In the key of the Act II boss theme.
"""

from stingers._common import cue

KEYED = False
TONIC = 'F'


def build(transpose=0):
    s = cue('boss_archmage', bpm=116, bars=2, title='Archmage', transpose=transpose, seed=39,
            lufs=-18.0, rt60=2.6)
    cel = s.part('celesta', 'celesta', role='lead')
    cel.at(1).play('@mf D5s E5s F5s A5s D5s E5s F5s A5s D5s E5s F5s Ab5s D5s E5s F5s Ab5s | '
                   'D5s Eb5s F5s Ab5s D5s Eb5s F5s Ab5s Db5s Eb5s F5s Ab5s Db5s Eb5s F5s Ab5s |')
    hp = s.part('harp', 'harp', role='keys')
    hp.at(1).play('@mp D4q D4q D4q D4q | D4q D4q Db4q Db4q |')
    gl = s.part('glock', 'glock', role='accent')
    gl.at(1).play('@mp rh Ab5q rq | Eb6q rq Db6q rq |')
    hn = s.part('horns', 'horns', role='section', art='mute')
    hn.at(1).play('@mp A3h Ab3h | G3h Gb3h |')
    va = s.part('va', 'violas', role='pad', art='trem')
    va.at(1).play('@pp [D4 F4]w | [D4 F4]w |')
    return s
