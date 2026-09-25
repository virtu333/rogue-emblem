"""The Eclipse deepens — a bell with a missing answer.

A low boom and a dry bell on D; the bell calls A... and the answer that
should follow never comes. A faint drone holds the gap.
"""

from stingers._common import cue

KEYED = True


def build(transpose=0):
    s = cue('eclipse', bpm=66, bars=1, title='The Eclipse', transpose=transpose, seed=29,
            lufs=-19.5, rt60=3.2)
    boom = s.part('boom', 'boom', role='accent')
    boom.at(1).play('@mf D2q rq rh |')
    bells = s.part('bells', 'bells', role='lead')
    bells.at(1).play('@mf D4q A4q rh |')
    drone = s.part('drone', 'drone', role='pad')
    drone.at(1).play('@p D2w |')
    cb = s.part('cb', 'basses', role='low', art='soft')
    cb.at(1).play('@pp rq D2h. |')
    return s
