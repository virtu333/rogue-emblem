"""Act II title — Iron Rain. The oath on muted trumpets over a snare drill,
ending minor: the old call marching in the Empire's step."""

from engine.patterns import drums
from stingers._act import OATH
from stingers._common import cue

KEYED = False
TONIC = 'C'


def build(transpose=0):
    s = cue('act_card_act2', bpm=100, bars=2, title='Act II', transpose=transpose, seed=55,
            lufs=-17.0, rt60=2.2)
    tpt = s.part('tpt', 'trumpets', role='lead', art='mute')
    tpt.at(1).play(f'@mf {OATH} | F4h D4h |')
    perc = s.part('perc', 'orch_perc', role='drums')
    drums(perc, 1, {'sn': 'x.o.x.o.x.o.xoxo'}, vel=0.6)
    drums(perc, 2, {'sn': 'x.o.x.o.x.......'}, vel=0.55)
    vc = s.part('vc', 'celli', role='low', art='sus')
    vc.at(1).play('@mf D3w | Bb2h D3h |')
    cb = s.part('cb', 'basses', role='low', art='pizz')
    cb.at(1).play('@mf D2q D2q D2q D2q | Bb1q Bb1q D2h |')
    va = s.part('va', 'violas', role='pad', art='soft')
    va.at(1).play('@p F3w | F3h F3h |')
    return s
