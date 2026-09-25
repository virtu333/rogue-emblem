"""Reinforcements — the Empire's drills arrive.

A snare roll swells into the band; muted brass stamp the Empire cell
(D-Eb-D) and a low tom answers. Keyed, dry, under two seconds.
"""

from engine.patterns import drums
from stingers._common import cue

KEYED = True


def build(transpose=0):
    s = cue('arrival', bpm=120, bars=1, title='Reinforcements', transpose=transpose, seed=21,
            lufs=-17.0, rt60=1.8)
    perc = s.part('perc', 'orch_perc', role='drums')
    # the roll is built from single strokes: the library's roll sample rings for seconds
    drums(perc, 1, {'sn': 'oooooooxxxxxxxxX'}, step=0.0625, vel=0.62, ramp=0.5)
    drums(perc, 1, {'sn': '....X.x.x.......', 'bd': '....x...x.......'}, vel=0.72)
    tbn = s.part('tbn', 'trombones', role='section')
    tbn.at(1).play('@f rq [D3 A3]e> [Eb3 Bb3]e [D3 A3]q rq |')
    hn = s.part('horns', 'horns', role='section', art='mute')
    hn.at(1).play('@f rq D4e> Eb4e D4q rq |')
    tuba = s.part('tuba', 'tuba', role='low')
    tuba.at(1).play('@f rq D2e Eb2e D2q rq |')
    timp = s.part('timp', 'timpani', role='timp')
    timp.at(1).play('@mf rq A2e rs A2s D3q rq |')
    return s
