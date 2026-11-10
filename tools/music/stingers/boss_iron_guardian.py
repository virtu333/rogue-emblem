"""The Iron Guardian's card — the mark and the fall.

A ping in the dark says where; a ratchet winds while the low brass lean on
the tritone; the hammer lands on the next downbeat, both bare fifths at
once. Written in D like every stinger; heard in C, the key of "No Word to
Stop".
"""

from engine.patterns import drums
from stingers._common import cue

KEYED = False
TONIC = 'C'


def build(transpose=0):
    s = cue('boss_iron_guardian', bpm=92, bars=2, title='The Iron Guardian', transpose=transpose,
            seed=47, lufs=-17.0, rt60=3.0)
    ping = s.part('ping', 'glock', role='accent', fixed_pitch=False)
    ping.at(1).play('@f D7e D7e rq rh |')
    ratchet = s.part('ratchet', 'orch_perc', role='accent')
    drums(ratchet, 1, {'claves': 'x...x...x.x.....', 'log_hi': '............x.x.',
                       'log_lo': '.............x.x'}, vel=0.6, ramp=0.4)
    tbn = s.part('tbn', 'trombones', role='lead')
    tbn.at(1).play('@mf rq [Ab2 Eb3]h. | @ff [D2 D3 A3]h. rq |')
    tbn.expr((1, 0.3), (1.97, 1.0), (2, 1.0))
    tuba = s.part('tuba', 'tuba', role='low')
    tuba.at(1).play('@mf rq Ab1h. | @ff D2h. rq |')
    tuba.expr((1, 0.3), (1.97, 1.0), (2, 1.0))
    hn = s.part('horns', 'horns', role='section')
    hn.at(2).play('@ff [Ab3 Eb4]h. rq |')
    timp = s.part('timp', 'timpani', role='timp')
    timp.at(1).play('%roll @mp Ab2w | %default @ff D2q rq rh |')
    timp.expr((1, 0.25), (1.97, 1.0), (2, 1.0))
    perc = s.part('perc', 'orch_perc', role='accent')
    drums(perc, 2, {'bd': 'X', 'gong': 'x', 'anvil': 'x'}, step=4.0, vel=0.8)
    return s
