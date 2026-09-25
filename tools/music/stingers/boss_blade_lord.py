"""The Blade Lord — economy, precision, a long dangerous rest.

Two clipped neighbour notes (A-Bb-A) cut by the violins, then nothing but a
held low note while the listener waits for the next cut; it comes on the
other side (E-F-E) with a single pizzicato snap. In the key of the Act III
boss theme.
"""

from engine.patterns import drums
from stingers._common import cue

KEYED = False
TONIC = 'E'


def build(transpose=0):
    s = cue('boss_blade_lord', bpm=120, bars=2, title='Blade Lord', transpose=transpose,
            seed=43, lufs=-18.5)
    vn = s.part('vn', 'violins', role='lead', art='spic')
    vn.at(1).play('@ff A5s Bb5s A5e rq rh | rh. E5s F5s E5e |')
    vc = s.part('vc', 'celli', role='section', art='pizz')
    vc.at(1).play('@f D3q rq rh | rh. rq |')
    vc.at(2).play('@ff rh. rq')
    vc.note(s.bar(2) + 3.5, 'A2', 0.5, vel=0.9, art='pizz')
    cb = s.part('cb', 'basses', role='low', art='soft')
    cb.at(1).play('@pp D2w | D2w |')
    perc = s.part('perc', 'orch_perc', role='accent')
    drums(perc, 1, {'sus_stick': 'x'}, vel=0.6)
    return s
