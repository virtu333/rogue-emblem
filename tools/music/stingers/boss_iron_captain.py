"""The Iron Captain — a worn drill that returns to its post.

The Empire cell (D-Eb-D-C) on low brass with snare strokes, but where the
Empire falls away to B-flat the Captain comes back to D: duty, not ambition.
The second statement is softer and ends on the held post. In the key of the
Act I boss theme.
"""

from engine.patterns import drums
from stingers._common import cue

KEYED = False
TONIC = 'D'


def build(transpose=0):
    s = cue('boss_iron_captain', bpm=116, bars=2, title='Iron Captain', transpose=transpose,
            seed=33, lufs=-16.5)
    tbn = s.part('tbn', 'trombones', role='lead')
    tbn.at(1).play('@f [D3 A3]q. [Eb3 Bb3]e [D3 A3]q [C3 G3]q | @mf [D3 A3]h. rq |')
    tuba = s.part('tuba', 'tuba', role='low')
    tuba.at(1).play('@f D2q. Eb2e D2q C2q | @mf D2h. rq |')
    hn = s.part('horns', 'horns', role='section', art='mute')
    hn.at(1).play('@mf D4q. Eb4e D4q C4q | D4h. rq |')
    perc = s.part('perc', 'orch_perc', role='drums')
    drums(perc, 1, {'sn': 'X.x.x.x.X.x.xxx.', 'bd': 'x.......x.......'}, vel=0.7)
    drums(perc, 2, {'sn': 'x...o...o.......'}, vel=0.55)
    timp = s.part('timp', 'timpani', role='timp')
    timp.at(1).play('@f D3q rq A2q rq | D3q rq rh |')
    return s
