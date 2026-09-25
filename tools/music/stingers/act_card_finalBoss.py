"""The last act title — the Deep. One note of the oath, and then only a hum
and a single high A: the place where the Thread goes quiet."""

from stingers._common import cue

KEYED = False
TONIC = 'D'


def build(transpose=0):
    s = cue('act_card_finalBoss', bpm=60, bars=2, title='The Deep', transpose=transpose,
            seed=61, lufs=-21.0, rt60=3.6)
    hn = s.part('horn', 'horns', role='lead')
    hn.at(1).play('@p D4h rh | rw |')
    drone = s.part('drone', 'drone', role='pad')
    drone.at(1).play('@pp [D2 Eb2]w | [D2 Eb2]w |')
    sh = s.part('thread', 'shimmer', role='fx')
    sh.at(2).play('@p A5w |')
    return s
