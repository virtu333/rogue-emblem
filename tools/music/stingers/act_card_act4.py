"""Act IV title — Ashfall. The oath's first notes on distant bells; it
breaks off, and a low drone and a timpani heartbeat hold the night."""

from stingers._common import cue

KEYED = False
TONIC = 'B'


def build(transpose=0):
    s = cue('act_card_act4', bpm=72, bars=2, title='Act IV', transpose=transpose, seed=59,
            lufs=-19.0, rt60=3.2)
    bells = s.part('bells', 'bells', role='lead')
    bells.at(1).play('@mf D4q. A4e A4q rq | rw |')
    drone = s.part('drone', 'drone', role='pad')
    drone.at(1).play('@p D2w | D2w |')
    timp = s.part('timp', 'timpani', role='timp')
    timp.at(1).play('@p rh D3q rq | D3q rq D3q rq |')
    cb = s.part('cb', 'basses', role='low', art='soft')
    cb.at(1).play('@pp D2w | D2w |')
    return s
