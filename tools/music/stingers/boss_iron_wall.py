"""The Iron Wall — augmented durations, a tonic that will not move.

Low brass hold the fifth for a whole bar; a lower neighbour (C#) leans on it
for two beats and fails to move it. Timpani keep a slow, heavy pulse. In the
key of the Act III boss theme.
"""

from stingers._common import cue

KEYED = False
TONIC = 'E'


def build(transpose=0):
    s = cue('boss_iron_wall', bpm=96, bars=2, title='Iron Wall', transpose=transpose, seed=45,
            lufs=-17.0, rt60=2.6)
    tbn = s.part('tbn', 'trombones', role='lead')
    tbn.at(1).play('@f [D3 A3]w | [C#3 A3]h [D3 A3]h |')
    tuba = s.part('tuba', 'tuba', role='low')
    tuba.at(1).play('@f D2w | C#2h D2h |')
    hn = s.part('horns', 'horns', role='section')
    hn.at(1).play('@mf A3w | A3w |')
    cb = s.part('cb', 'basses', role='low', art='sus')
    cb.at(1).play('@f D2w | C#2h D2h |')
    timp = s.part('timp', 'timpani', role='timp')
    timp.at(1).play('@f D3h D3h | D3h D3h |')
    return s
