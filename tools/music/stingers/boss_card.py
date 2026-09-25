"""A boss appears (any boss without a card of its own) — the drill, in crimson.

An impact on the boss theme's tonic, then muted horns stamp the Empire cell
(D-Eb-D) over a held low fifth. Keyed to the boss theme under it.
"""

from engine.patterns import drums
from stingers._common import cue

KEYED = True


def build(transpose=0):
    s = cue('boss_card', bpm=112, bars=2, title='Boss', transpose=transpose, seed=31, lufs=-16.5)
    tbn = s.part('tbn', 'trombones', role='section')
    tbn.at(1).play('@ff [D3 A3]h. rq | @f [D3 A3]w |')
    hn = s.part('horns', 'horns', role='lead', art='mute')
    hn.at(1).play('@f rh D4e. Eb4s D4q | rq D4e. Eb4s D4h |')
    tuba = s.part('tuba', 'tuba', role='low')
    tuba.at(1).play('@ff D2w | D2w |')
    timp = s.part('timp', 'timpani', role='timp')
    timp.at(1).play('@ff D3q rq A2q rq | D3q rq %roll A2h |')
    perc = s.part('perc', 'orch_perc', role='accent')
    drums(perc, 1, {'bd': 'x', 'crash': 'x'}, vel=0.8)
    return s
